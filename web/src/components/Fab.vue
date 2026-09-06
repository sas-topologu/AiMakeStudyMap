// 悬浮功能按钮组（右下角）：功能按钮收拢进可折叠竖排图标按钮
// 搜索/跃迁 · 大地图 · 我的进度 · 计时状态 · 退出登录；承载对应面板与对话框
<template>
  <div class="fab" :class="{ open }">
    <transition-group name="fab" tag="div" class="fab-stack">
      <template v-if="open">
        <button key="search" class="fab-item" title="搜索 / 跃迁" @click="showSearch = true">🔍</button>
        <button key="map" class="fab-item" title="大地图（宏观视图）" @click="goMap">🌌</button>
        <button v-if="feat.share" key="share" class="fab-item" title="分享星图" @click="goShare">🔗</button>
        <button v-if="auth.isAdmin" key="admin" class="fab-item" title="审核队列" @click="goAdmin">🛡</button>
        <button v-if="auth.isAdmin" key="manage" class="fab-item" title="管理面板（抽查留档）" @click="goManage">🗂</button>
        <button key="changelog" class="fab-item" title="关于 / 更新日志" @click="goChangelog">📜</button>
        <button key="progress" class="fab-item" title="我的进度" @click="showProgress = true">📊</button>
        <button
          v-if="feat.navigation"
          key="hot"
          class="fab-item"
          :class="{ 'hot-active': nav.hotActive }"
          title="热门路径（高通过率边高亮）"
          @click="toggleHot"
        >
          🔥
        </button>
        <button v-if="feat.timer" key="timer" class="fab-item" title="计时状态" @click="onTimer">
          ⏱
          <span v-if="timer.active" class="fab-badge">{{ timer.remainingText }}</span>
        </button>
        <button key="fx" class="fab-item" title="动效设置" @click="showFx = true">⚙</button>
        <button key="logout" class="fab-item danger" title="退出登录" @click="logout">⏻</button>
      </template>
    </transition-group>
    <button class="fab-main" :title="open ? '收起' : '功能'" @click="open = !open">
      {{ open ? '✕' : '☰' }}
    </button>

    <SearchPanel :visible="showSearch" @close="showSearch = false" />
    <ProgressPanel :visible="showProgress" @close="showProgress = false" />
    <TimerDialog :visible="showTimer" @close="showTimer = false" @started="onTimerStarted" />
    <FxSettings :visible="showFx" @close="showFx = false" />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';
import { useTimerStore } from '../stores/timer.js';
import { useUiStore } from '../stores/ui.js';
import { useNavStore } from '../stores/navigation.js';
import { useDevSettings } from '../composables/useDevSettings.js';
import SearchPanel from './SearchPanel.vue';
import ProgressPanel from './ProgressPanel.vue';
import TimerDialog from './TimerDialog.vue';
import FxSettings from './FxSettings.vue';

const auth = useAuthStore();
const timer = useTimerStore();
const ui = useUiStore();
const nav = useNavStore();
const router = useRouter();
const feat = useDevSettings().features;

const open = ref(false);
const showSearch = ref(false);
const showProgress = ref(false);
const showTimer = ref(false);
const showFx = ref(false);

function goMap() {
  open.value = false;
  router.push('/map');
}

function goShare() {
  open.value = false;
  router.push('/share');
}

function goAdmin() {
  open.value = false;
  router.push('/admin');
}

function goManage() {
  open.value = false;
  router.push('/manage');
}

function goChangelog() {
  open.value = false;
  router.push('/changelog');
}

async function toggleHot() {
  try {
    await nav.toggleHot();
    ui.toast(nav.hotActive ? `热门路径已开启（${nav.hotEdges.length} 条边）` : '热门路径已关闭');
  } catch (e) {
    ui.toast(e.message, 'error');
  }
}

function onTimer() {
  if (timer.active) {
    ui.toast(
      `倒计时进行中 ${timer.remainingText} · 今日剩余 ${timer.dailyRemainingMinutes ?? '…'} 分钟`,
      'info',
      3200,
    );
  } else {
    showTimer.value = true;
  }
}

function onTimerStarted() {
  ui.toast('倒计时已开启，去节点详情页开始闯关吧', 'success');
}

function logout() {
  auth.logout();
  open.value = false;
  ui.toast('已退出登录');
  router.push('/login');
}
</script>
