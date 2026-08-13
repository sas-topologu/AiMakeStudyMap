// 导航模式横幅：路线信息（类型/节点数/难度/高难数）、多路线切换、横排步骤条、退出
// 步骤点击 → 中心视图以该节点为中心；当前学习节点（星图中心）自动勾选
<template>
  <div v-if="nav.active && nav.route" class="nav-banner panel">
    <div class="nav-head">
      <span class="nav-type">{{ typeLabel }}</span>
      <span class="nav-target">→ {{ nav.toTitle || nav.to }}</span>
      <span class="nav-meta">
        {{ nav.route.nodes.length }} 节点 · 平均难度 ★{{ nav.avgDifficulty.toFixed(1) }}
        <template v-if="nav.hardCount"> · <b class="nav-hard">含 {{ nav.hardCount }} 高难</b></template>
      </span>
      <span class="toolbar-spacer" />
      <span v-if="nav.routes.length > 1" class="nav-switcher">
        <button
          v-for="(r, i) in nav.routes"
          :key="i"
          class="chip"
          :class="{ active: i === nav.routeIndex }"
          @click="nav.setRouteIndex(i)"
        >
          路线 {{ i + 1 }}
        </button>
      </span>
      <button class="icon-btn" title="退出导航" @click="nav.exit()">✕</button>
    </div>

    <div class="nav-steps">
      <button
        v-for="(n, i) in nav.route.nodes"
        :key="n.id"
        class="nav-step"
        :class="{ current: n.id === starmap.centerId }"
        :title="`${n.title} · 难度 ${n.difficulty}`"
        @click="goNode(n.id)"
      >
        <span class="step-idx">{{ i + 1 }}</span>
        <span class="state-dot" :class="n.state ?? 'dim'" />
        <span class="step-title">{{ n.title }}</span>
        <small class="step-diff">{{ '★'.repeat(n.difficulty) }}</small>
        <em v-if="n.hard" class="step-hard">高难</em>
        <span v-if="n.id === starmap.centerId" class="step-check">✓</span>
      </button>
    </div>

    <div v-if="nav.route.expansions?.length" class="nav-expansions">
      <span class="muted">相关拓展：</span>
      <template v-for="ex in nav.route.expansions" :key="ex.at">
        <button
          v-for="n in ex.nodes"
          :key="n.id"
          class="chip expansion"
          :title="`挂在「${hostTitle(ex.at)}」的拓展`"
          @click="goNode(n.id)"
        >
          {{ n.title }}<small> @{{ hostTitle(ex.at) }}</small>
        </button>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useNavStore, ROUTE_TYPES } from '../stores/navigation.js';
import { useStarmapStore } from '../stores/starmap.js';
import { useUiStore } from '../stores/ui.js';

const nav = useNavStore();
const starmap = useStarmapStore();
const ui = useUiStore();
const router = useRouter();

const typeLabel = computed(() => ROUTE_TYPES[nav.type]?.label ?? nav.type);
const hostTitle = computed(() => (id) => nav.route?.nodes.find((n) => n.id === id)?.title ?? id);

async function goNode(id) {
  try {
    await starmap.centerOn(id);
    if (router.currentRoute.value.path !== '/') router.push('/');
  } catch (e) {
    ui.toast(e.message, 'error');
  }
}
</script>
