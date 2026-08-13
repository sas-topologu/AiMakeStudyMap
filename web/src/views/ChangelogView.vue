// 更新日志页（/changelog，公开）：时间线式展示版本/摘要/明细/时间
<template>
  <div class="node-page">
    <header class="node-header">
      <button class="icon-btn" title="返回" @click="$router.back()">←</button>
      <div class="node-head-main"><h1>更新日志</h1></div>
    </header>
    <p v-if="loading" class="muted pad">加载中…</p>
    <p v-else-if="!logs.length" class="muted pad">暂无更新记录。</p>
    <div v-else class="changelog">
      <div v-for="l in logs" :key="l.version" class="changelog-item">
        <div class="changelog-dot" />
        <section class="panel changelog-card">
          <div class="changelog-head">
            <b class="changelog-version">v{{ l.version }}</b>
            <small class="muted">{{ formatTime(l.createdAt) }}</small>
          </div>
          <p class="changelog-summary">{{ l.summary }}</p>
          <p v-if="l.detail" class="muted changelog-detail">{{ l.detail }}</p>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api/client.js';
import { formatTime } from '../utils/format.js';

const logs = ref([]);
const loading = ref(true);

onMounted(async () => {
  try {
    const { logs: l } = await api.changelog(50);
    logs.value = l;
  } finally {
    loading.value = false;
  }
});
</script>
