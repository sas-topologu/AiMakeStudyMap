// 我的进度面板：账号 / 计时与当日额度 / 跃迁额度 / 最近学习 / 当前邻域状态统计
<template>
  <div v-if="visible" class="overlay" @click.self="$emit('close')">
    <div class="panel dialog">
      <h3>我的进度</h3>
      <ul class="progress-list">
        <li><span>用户</span><b>{{ auth.user?.username ?? '—' }}</b></li>
        <li>
          <span>当前倒计时</span>
          <b>{{ timer.active ? timer.remainingText : '无进行中' }}</b>
        </li>
        <li>
          <span>今日计时额度</span>
          <b>剩余 {{ timer.dailyRemainingMinutes ?? '…' }} / 120 分钟</b>
        </li>
        <li>
          <span>学习成果</span>
          <b>{{ progressText }}</b>
        </li>
        <li>
          <span>跃迁额度</span>
          <b>{{ auth.quota === null ? '获取中…' : `${auth.quota} 点` }}（月赠 1 · 上限 2）</b>
        </li>
        <li>
          <span>最近学习节点</span>
          <b>{{ recentTitle }}</b>
        </li>
      </ul>
      <template v-if="starmap.centerId">
        <h4 class="progress-sub">当前星图邻域（{{ starmap.nodes.length }} 节点）</h4>
        <div class="progress-counts">
          <span v-for="(label, s) in STATE_LABEL" :key="s" class="count-chip" :class="s">
            {{ label }} {{ starmap.stateCounts[s] ?? 0 }}
          </span>
        </div>
      </template>

      <!-- 我的勘误（折叠） -->
      <h4 class="progress-sub">
        <button class="link-btn" @click="toggleCorrections">
          我的勘误 {{ showCorrections ? '▾' : '▸' }}
        </button>
      </h4>
      <div v-if="showCorrections" class="my-corrections">
        <p v-if="corrections === null" class="muted small">加载中…</p>
        <p v-else-if="!corrections.length" class="muted small">还没有提交过勘误。</p>
        <ul v-else>
          <li v-for="c in corrections" :key="c.id">
            <span class="corr-status" :class="c.status">{{ CORR_STATUS[c.status] ?? c.status }}</span>
            <span class="corr-main">
              <b>{{ c.nodeTitle }}</b>
              <small>{{ c.body }}</small>
              <small v-if="c.reviewNote" class="corr-note">审核备注：{{ c.reviewNote }}</small>
            </span>
            <small class="muted corr-time">{{ formatTime(c.createdAt) }}</small>
          </li>
        </ul>
      </div>
      <div class="dialog-actions">
        <button class="btn ghost" @click="$emit('close')">关闭</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { api } from '../api/client.js';
import { useAuthStore } from '../stores/auth.js';
import { useTimerStore } from '../stores/timer.js';
import { useStarmapStore } from '../stores/starmap.js';
import { formatTime } from '../utils/format.js';

const props = defineProps({
  visible: { type: Boolean, default: false },
});
defineEmits(['close']);

const STATE_LABEL = { dim: '暗淡', open: '开放', passed: '通关', lit: '点亮' };
const CORR_STATUS = { pending: '待审核', approved: '已采纳', rejected: '未采纳' };

const auth = useAuthStore();
const timer = useTimerStore();
const starmap = useStarmapStore();

const totals = ref(null); // { passed, lit }（全图统计，graph/all 带 state）
const showCorrections = ref(false);
const corrections = ref(null); // null=未加载

async function toggleCorrections() {
  showCorrections.value = !showCorrections.value;
  if (showCorrections.value) {
    corrections.value = null;
    try {
      const { corrections: list } = await api.myCorrections();
      corrections.value = list;
    } catch {
      corrections.value = [];
    }
  }
}

const recentTitle = computed(() => {
  const id = starmap.recentId;
  if (!id) return '—';
  return starmap.cache.cards[id]?.title ?? starmap.nodesById[id]?.title ?? id;
});

const progressText = computed(() =>
  totals.value ? `通关 ${totals.value.passed} · 点亮 ${totals.value.lit}` : '统计中…',
);

watch(
  () => props.visible,
  async (v) => {
    if (!v) return;
    timer.refreshDaily();
    auth.refreshQuota();
    try {
      const { nodes } = await api.graphAll();
      totals.value = {
        passed: nodes.filter((n) => n.state === 'passed').length,
        lit: nodes.filter((n) => n.state === 'lit').length,
      };
    } catch {
      totals.value = null;
    }
  },
);
</script>
