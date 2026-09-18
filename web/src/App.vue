<template>
  <div v-if="banner" class="risk-banner" :class="banner.level">
    <span>{{ banner.text }}</span>
    <template v-if="banner.action === 'trust'">
      <button class="btn ghost" @click="acceptNewTerminal">仍要信任该终端</button>
      <button class="btn ghost" @click="revertTerminal">切回默认终端</button>
    </template>
    <template v-else-if="banner.action === 'retry'">
      <button class="btn ghost" @click="retryNow">立即重试</button>
    </template>
  </div>
  <NavBanner v-if="!isLoginPage" />
  <router-view />
  <Fab v-if="!isLoginPage" />
  <Toast />
</template>

<script setup>
// 全局风险提示：离线（终端不可达，已用本地缓存）与终端身份变化（可能不是原来的终端）。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import Fab from './components/Fab.vue';
import Toast from './components/Toast.vue';
import NavBanner from './components/NavBanner.vue';
import {
  isOffline,
  onOfflineChange,
  resetOffline,
  verifyTerminal,
  pinFingerprint,
  forgetFingerprint,
  getTerminalBase,
  getTerminalDefault,
  setTerminal,
} from './api/client.js';

const route = useRoute();
const isLoginPage = computed(() => route.path === '/login');

const offline = ref(isOffline());
const identity = ref(null); // { ok:false, reason:'changed' }
let stopOffline = null;

const banner = computed(() => {
  if (identity.value && identity.value.ok === false && identity.value.reason === 'changed') {
    return {
      level: 'danger',
      action: 'trust',
      text: `⚠ 当前终端（${getTerminalBase()}）的身份与之前不同：可能不是原来的终端（域名被替换/被他人接管）。已暂停自动信任，请确认后再继续。`,
    };
  }
  if (offline.value) {
    return {
      level: 'warn',
      action: 'retry',
      text: '⚡ 终端暂时不可达：已切换为离线（使用本地缓存），并暂停了后续请求以免反复申请占用资源。',
    };
  }
  return null;
});

async function checkIdentity() {
  identity.value = await verifyTerminal();
}

function acceptNewTerminal() {
  // 用户确认"仍要信任" → 重新固定指纹
  if (identity.value?.actual) pinFingerprint(getTerminalBase(), identity.value.actual);
  else forgetFingerprint(getTerminalBase());
  identity.value = null;
}

function revertTerminal() {
  setTerminal(getTerminalDefault());
  location.reload();
}

function retryNow() {
  resetOffline();
  offline.value = false;
  checkIdentity();
}

onMounted(() => {
  stopOffline = onOfflineChange((v) => {
    offline.value = v;
  });
  if (!isLoginPage.value) checkIdentity();
});

onBeforeUnmount(() => {
  if (typeof stopOffline === 'function') stopOffline();
});
</script>
