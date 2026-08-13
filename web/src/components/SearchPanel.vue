// 搜索 / 跃迁 / 导航面板
// 选择结果后：前往中心（非 dim）或跃迁确认（dim，耗 1 额度）；「导航至此」→ 选路线类型 → 进入导航模式
// NO_ROUTE：提示建议跃迁并给一键跃迁按钮
<template>
  <div v-if="visible" class="overlay" @click.self="$emit('close')">
    <div class="panel dialog search-panel">
      <h3>
        搜索 / 跃迁 / 导航
        <button class="panel-close" title="关闭" @click="$emit('close')">✕</button>
      </h3>
      <input
        ref="inputEl"
        v-model.trim="q"
        class="input"
        placeholder="输入关键词（标题 / 简介 / 编号）"
        @input="onInput"
      />
      <div class="search-results">
        <p v-if="!q" class="muted">输入关键词开始搜索</p>
        <p v-else-if="searching" class="muted">搜索中…</p>
        <p v-else-if="!results.length" class="muted">没有匹配的节点</p>
        <template v-else>
          <button
            v-for="r in results"
            :key="r.id"
            class="search-item"
            :class="{ selected: selected?.id === r.id }"
            @click="select(r)"
          >
            <span class="state-dot" :class="r.state" />
            <span class="search-item-main">
              <b>{{ r.title }}</b>
              <small>{{ r.subject }} · 难度 {{ '★'.repeat(r.difficulty) }}</small>
            </span>
            <span class="search-item-state">{{ stateLabel(r.state) }}</span>
          </button>
        </template>
      </div>

      <!-- 选中目标后的操作区 -->
      <div v-if="selected && !navChoosing" class="target-actions">
        <p class="target-line">
          目标：<b>{{ selected.title }}</b>
          <span class="muted">（{{ stateLabel(selected.state) }}）</span>
        </p>
        <div class="dialog-actions left">
          <button v-if="selected.state !== 'dim'" class="btn ghost" @click="goDirect">前往中心视图</button>
          <button v-else class="btn ghost" @click="confirming = selected">跃迁至此（耗 1 额度）</button>
          <button class="btn primary" @click="navChoosing = true">导航至此</button>
        </div>
      </div>

      <!-- 路线类型选择 -->
      <div v-if="navChoosing" class="nav-choose">
        <p class="target-line">选择路线类型（目标：<b>{{ selected.title }}</b>）：</p>
        <button
          v-for="(t, key) in ROUTE_TYPES"
          :key="key"
          class="nav-type-option"
          :class="{ active: navType === key }"
          @click="navType = key"
        >
          <b>{{ t.label }}</b>
          <small>{{ t.hint }}</small>
        </button>
        <p v-if="routeError" class="error-text">{{ routeError }}</p>
        <div v-if="noRoute" class="dialog-actions left">
          <button class="btn ghost" :disabled="jumping" @click="quickJump">
            {{ jumping ? '跃迁中…' : '一键跃迁（耗 1 额度）' }}
          </button>
        </div>
        <div class="dialog-actions">
          <button class="btn ghost" @click="navChoosing = false">返回</button>
          <button class="btn primary" :disabled="routing" @click="makeRoute">
            {{ routing ? '生成中…' : '生成路线' }}
          </button>
        </div>
      </div>

      <!-- dim 节点跃迁确认 -->
      <div v-if="confirming" class="jump-confirm">
        <p>
          「<b>{{ confirming.title }}</b>」尚未开放，跃迁将消耗 1 点额度（当前
          <b>{{ auth.quota ?? '未知' }}</b> 点；每月赠 1 点、上限 2 点）。确认跃迁？
        </p>
        <p v-if="jumpError" class="error-text">{{ jumpError }}</p>
        <div class="dialog-actions">
          <button class="btn ghost" @click="confirming = null">取消</button>
          <button class="btn primary" :disabled="jumping" @click="doJump">
            {{ jumping ? '跃迁中…' : '确认跃迁' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client.js';
import { useAuthStore } from '../stores/auth.js';
import { useStarmapStore } from '../stores/starmap.js';
import { useUiStore } from '../stores/ui.js';
import { useNavStore, ROUTE_TYPES } from '../stores/navigation.js';

const props = defineProps({
  visible: { type: Boolean, default: false },
});
const emit = defineEmits(['close']);

const STATE_LABEL = { dim: '暗淡', open: '开放', passed: '通关', lit: '点亮' };
const stateLabel = (s) => STATE_LABEL[s] ?? s;

const auth = useAuthStore();
const starmap = useStarmapStore();
const ui = useUiStore();
const nav = useNavStore();
const router = useRouter();

const q = ref('');
const results = ref([]);
const searching = ref(false);
const selected = ref(null);
const confirming = ref(null);
const jumping = ref(false);
const jumpError = ref('');
const navChoosing = ref(false);
const navType = ref('shortest');
const routing = ref(false);
const routeError = ref('');
const noRoute = ref(false);
const inputEl = ref(null);
let debounceTimer = null;

// Escape 或失去焦点关闭
function onKey(e) {
  if (e.key === 'Escape') emit('close');
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

watch(
  () => props.visible,
  async (v) => {
    if (v) {
      q.value = '';
      results.value = [];
      selected.value = null;
      confirming.value = null;
      navChoosing.value = false;
      routeError.value = '';
      noRoute.value = false;
      await nextTick();
      inputEl.value?.focus();
    }
  },
);

function onInput() {
  clearTimeout(debounceTimer);
  if (!q.value) {
    results.value = [];
    return;
  }
  debounceTimer = setTimeout(async () => {
    searching.value = true;
    try {
      const { results: r } = await api.search(q.value);
      results.value = r;
    } catch (e) {
      ui.toast(e.message, 'error');
    } finally {
      searching.value = false;
    }
  }, 300);
}

function select(r) {
  selected.value = r;
  confirming.value = null;
  navChoosing.value = false;
  routeError.value = '';
  noRoute.value = false;
}

async function goCenter(id, { fresh = false } = {}) {
  await starmap.centerOn(id, { force: fresh });
  if (router.currentRoute.value.path !== '/') router.push('/');
  emit('close');
}

async function goDirect() {
  try {
    await goCenter(selected.value.id);
  } catch (e) {
    ui.toast(e.message, 'error');
  }
}

// 导航：当前星图中心（或最近学习节点）为起点
async function makeRoute() {
  const from = starmap.centerId ?? starmap.recentId;
  if (!from) {
    routeError.value = '请先在星图中选择一个起点节点';
    return;
  }
  routing.value = true;
  routeError.value = '';
  noRoute.value = false;
  try {
    const data = await api.navRoute(from, selected.value.id, navType.value);
    nav.start({
      type: data.type,
      from,
      to: selected.value.id,
      toTitle: selected.value.title,
      routes: data.routes,
    });
    emit('close');
    if (router.currentRoute.value.path !== '/') router.push('/');
    ui.toast(`已生成${ROUTE_TYPES[data.type]?.label ?? ''}：${data.routes.length} 条路线`, 'success');
  } catch (e) {
    if (e.code === 'NO_ROUTE') {
      routeError.value = '该目标与当前节点无前置依赖链，建议使用跃迁';
      noRoute.value = true;
    } else {
      routeError.value = e.message;
    }
  } finally {
    routing.value = false;
  }
}

// NO_ROUTE 后的一键跃迁（dim 扣 1 额度；非 dim 免费放行）
async function quickJump() {
  jumping.value = true;
  routeError.value = '';
  try {
    const { quota } = await api.jump(selected.value.id);
    auth.setQuota(quota);
    ui.toast(`已到达「${selected.value.title}」`, 'success');
    await goCenter(selected.value.id, { fresh: true });
  } catch (e) {
    routeError.value = e.code === 'NO_QUOTA' ? '跃迁额度不足（每月赠 1 点、上限 2 点）' : e.message;
  } finally {
    jumping.value = false;
  }
}

async function doJump() {
  const target = confirming.value;
  jumping.value = true;
  jumpError.value = '';
  try {
    const { quota } = await api.jump(target.id);
    auth.setQuota(quota);
    ui.toast(`跃迁成功，「${target.title}」已开放`, 'success');
    confirming.value = null;
    selected.value = null;
    await goCenter(target.id, { fresh: true }); // 状态已变，强制刷新邻域
  } catch (e) {
    jumpError.value = e.code === 'NO_QUOTA' ? '跃迁额度不足（每月赠 1 点、上限 2 点）' : e.message;
  } finally {
    jumping.value = false;
  }
}
</script>
