// 主页：星图中心视图
// 初始中心：最近学习节点，否则取全量列表第一个节点
// 单击星点 → 以其为中心重新加载；双击/长按 → 详情页
<template>
  <div class="home-page">
    <StarMap
      :nodes="starmap.nodes"
      :edges="starmap.edges"
      :center-id="starmap.centerId"
      :highlight="navHighlight"
      :hot-edges="navHotEdges"
      :edge-mode="edgeMode"
      :nav-next-id="navNextId"
      :nav-prev-id="navPrevId"
      @recenter="onRecenter"
      @open="onOpen"
    />
    <header class="home-header">
      <div class="home-center-info">
        <template v-if="starmap.centerNode">
          <b>{{ starmap.centerNode.title }}</b>
          <small>{{ starmap.centerNode.subject }} · {{ stateLabel(starmap.centerNode.state) }}</small>
        </template>
        <template v-else-if="starmap.loading">加载星图中…</template>
        <template v-else-if="loadError">
          <span class="error-text">{{ loadError }}</span>
          <button class="link-btn" @click="boot">重试</button>
        </template>
      </div>
    </header>
    <p class="home-hint">单击星点切换中心 · 双击 / 长按打开知识卡 · 滚轮缩放</p>

    <!-- 空知识库引导：工具不依赖内置知识库，空库也能用 -->
    <div
      v-if="!starmap.loading && !loadError && starmap.nodes.length === 0"
      class="panel empty-kb"
    >
      <b>知识库还是空的</b>
      <p class="muted">这个工具不依赖内置知识库，空库也能正常使用。你可以用以下任一方式补充知识卡：</p>
      <ul class="muted">
        <li>让 AI 按规范制作知识卡（搜索/导航 → AI 辅助路线规划 → 缺卡可让 AI 制作），审核通过即入库</li>
        <li>把已有知识卡 JSON 放进 <code>content/cards/</code>，再运行 <code>npm run import</code></li>
        <li>可选：从群体端拉取一份 —— <code>node tools/deploy/pull-cards.mjs &lt;数据源地址&gt;</code>，再 <code>npm run import</code></li>
      </ul>
    </div>

    <!-- 连线风格切换（多风格对比挑选） -->
    <div class="edge-mode-panel panel">
      <span class="muted small">连线风格</span>
      <div class="mode-segment">
        <button
          v-for="m in EDGE_MODES"
          :key="m.key"
          :class="{ active: edgeMode === m.key }"
          :title="EDGE_MODE_HINTS[m.key]"
          @click="edgeMode = m.key"
        >
          {{ m.label }}
        </button>
      </div>
      <span class="muted small edge-mode-hint">{{ EDGE_MODE_HINTS[edgeMode] }}</span>
    </div>

    <LegendPanel />
  </div>
</template>

<script setup>
import { onMounted, ref, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import StarMap from '../starmap/StarMap.vue';
import LegendPanel from '../components/LegendPanel.vue';
import { EDGE_MODES } from '../starmap/renderer.js';
import { useAuthStore } from '../stores/auth.js';
import { useStarmapStore } from '../stores/starmap.js';
import { useTimerStore } from '../stores/timer.js';
import { useUiStore } from '../stores/ui.js';
import { useNavStore } from '../stores/navigation.js';

const STATE_LABEL = { dim: '暗淡', open: '开放', passed: '通关', lit: '点亮' };
const stateLabel = (s) => STATE_LABEL[s] ?? s;

const EDGE_MODE_HINTS = {
  legacy: '全部前后连线一视同仁（相关为流星）',
  skilltree: '按学习状态分档：已点亮亮、可解锁呼吸、未探索隐去',
  depth: '越远离中心的连线越淡越细',
  trunk: '只画前后主干（均匀），相关为流星',
};

const EDGE_MODE_KEY = 'starmap:edgeMode';
const edgeMode = ref(localStorage.getItem(EDGE_MODE_KEY) ?? 'skilltree');
watch(edgeMode, (m) => localStorage.setItem(EDGE_MODE_KEY, m));

const auth = useAuthStore();
const starmap = useStarmapStore();
const timer = useTimerStore();
const ui = useUiStore();
const nav = useNavStore();
const router = useRouter();

// 导航路线（金色）与热门路径（青色）叠加层
const navHighlight = computed(() =>
  nav.active ? { nodes: nav.routeNodeIds, edges: nav.routeEdgePairs } : { nodes: [], edges: [] },
);
const navHotEdges = computed(() => (nav.hotActive ? nav.hotEdges : []));

// 导航：中心节点在路线上的上一步/下一步，用于中心视图「后续指向导航终点」的锚点排布
const routeNodes = computed(() => (nav.active ? (nav.route?.nodes ?? []) : []));
const centerRouteIndex = computed(() => routeNodes.value.findIndex((n) => n.id === starmap.centerId));
const navNextId = computed(() =>
  centerRouteIndex.value >= 0 ? (routeNodes.value[centerRouteIndex.value + 1]?.id ?? null) : null,
);
const navPrevId = computed(() =>
  centerRouteIndex.value >= 0 ? (routeNodes.value[centerRouteIndex.value - 1]?.id ?? null) : null,
);

const loadError = ref('');

async function boot() {
  loadError.value = '';
  try {
    await starmap.init(auth.user?.id ?? null);
    if (!starmap.centerId) {
      const id = await starmap.resolveInitialCenter();
      if (!id) {
        loadError.value = '节点库为空';
        return;
      }
      await starmap.centerOn(id);
    } else {
      await starmap.centerOn(starmap.centerId);
    }
  } catch (e) {
    loadError.value = e.message;
  }
}

async function onRecenter(id) {
  try {
    await starmap.centerOn(id);
  } catch (e) {
    ui.toast(e.message, 'error');
  }
}

function onOpen(id) {
  router.push(`/node/${encodeURIComponent(id)}`);
}

onMounted(() => {
  boot();
  if (auth.isLoggedIn) timer.restore(); // 游客无计时接口权限，跳过（避免无谓 401）
});
</script>
