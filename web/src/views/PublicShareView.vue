// 公开分享页（/share/:id，免登录）：按分享 config 只读渲染星座图
<template>
  <div class="share-page">
    <header class="share-header panel">
      <b>来自 {{ owner || '…' }} 的知识星图</b>
      <span class="toolbar-spacer" />
      <button class="btn primary" @click="$router.push('/login')">我也要点亮星图</button>
    </header>
    <div class="share-canvas-box panel">
      <p v-if="loading" class="macro-status">加载中…</p>
      <p v-else-if="error" class="macro-status error-text">{{ error }}</p>
      <p v-else-if="!nodes.length" class="macro-status muted">这张星图还是空的。</p>
      <ShareCanvas
        v-else
        :nodes="nodes"
        :edges="edges"
        :theme="config.theme ?? 'default'"
        :collapse-related="config.collapseRelated === true"
      />
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api/client.js';
import ShareCanvas from '../components/ShareCanvas.vue';

const route = useRoute();
const owner = ref('');
const config = ref({});
const nodes = ref([]);
const edges = ref([]);
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    const data = await api.shareGet(route.params.id);
    owner.value = data.owner;
    config.value = data.config ?? {};
    nodes.value = data.nodes;
    edges.value = data.edges;
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
});
</script>
