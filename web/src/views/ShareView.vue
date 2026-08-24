// 星图分享创作页（/share，需登录）
// 流程：POST /api/share（草稿）→ 拿 shareId → GET /api/share/:id → 渲染（所见即所分享）
// 调整主题/折叠开关 → 重新 POST 生成新链接；支持导出 PNG 与复制链接
<template>
  <div class="share-page">
    <header class="share-header panel">
      <button class="icon-btn" title="返回" @click="$router.back()">←</button>
      <b>分享我的知识星图</b>
      <span class="toolbar-spacer" />
      <div class="theme-picker">
        <button
          v-for="(t, key) in SHARE_THEMES"
          :key="key"
          class="chip"
          :class="{ active: theme === key }"
          @click="theme = key"
        >
          {{ t.label }}
        </button>
      </div>
      <label class="collapse-toggle">
        <input v-model="collapseRelated" type="checkbox" />
        折叠相关连线
      </label>
      <button class="btn primary" :disabled="creating" @click="regenerate">
        {{ creating ? '生成中…' : '生成新链接' }}
      </button>
      <button class="btn ghost" :disabled="!shareId" @click="copyLink">复制分享链接</button>
      <button class="btn ghost" :disabled="!shareId || !nodes.length" @click="downloadPng">导出 PNG</button>
      <button class="btn ghost" :disabled="exporting" @click="downloadProfile">
        {{ exporting ? '整理中…' : '导出个人数据文档' }}
      </button>
    </header>

    <div class="share-canvas-box panel">
      <p v-if="loading" class="macro-status">正在生成分享…</p>
      <p v-else-if="error" class="macro-status error-text">{{ error }}</p>
      <template v-else-if="!nodes.length">
        <div class="share-empty">
          <p class="muted">还没有通关 / 点亮的节点，星图暂无内容可分享。</p>
          <button class="btn primary" @click="$router.push('/')">去星图学习</button>
        </div>
      </template>
      <ShareCanvas
        v-else
        ref="canvasRef"
        :nodes="nodes"
        :edges="edges"
        :theme="theme"
        :collapse-related="collapseRelated"
      />
    </div>
    <p v-if="shareUrl" class="share-url muted">{{ shareUrl }}</p>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api/client.js';
import { useUiStore } from '../stores/ui.js';
import ShareCanvas from '../components/ShareCanvas.vue';
import { SHARE_THEMES } from '../starmap/shareRenderer.js';
import { buildProfileDoc } from '../utils/profileDoc.js';

const ui = useUiStore();

const theme = ref('default');
const collapseRelated = ref(false);
const shareId = ref('');
const nodes = ref([]);
const edges = ref([]);
const loading = ref(true);
const creating = ref(false);
const exporting = ref(false);
const error = ref('');
const canvasRef = ref(null);

const shareUrl = computed(() =>
  shareId.value ? `${window.location.origin}/share/${shareId.value}` : '',
);

async function createAndLoad() {
  creating.value = true;
  error.value = '';
  try {
    const { shareId: id } = await api.shareCreate({
      theme: theme.value,
      collapseRelated: collapseRelated.value,
    });
    shareId.value = id;
    const data = await api.shareGet(id);
    nodes.value = data.nodes;
    edges.value = data.edges;
  } catch (e) {
    error.value = e.message;
  } finally {
    creating.value = false;
    loading.value = false;
  }
}

async function regenerate() {
  await createAndLoad();
  if (!error.value) ui.toast('已生成新分享链接', 'success');
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(shareUrl.value);
    ui.toast('链接已复制', 'success');
  } catch {
    // 剪贴板不可用时降级：手动选择复制
    window.prompt('复制以下链接：', shareUrl.value);
  }
}

function downloadPng() {
  const dataUrl = canvasRef.value?.exportPng();
  if (!dataUrl) return;
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `starmap-${shareId.value}.png`;
  a.click();
}

// 导出个人知识画像文档（Markdown）：闯关进度 + 学习投入 + 公开发布内容等，
// 发给 AI 可迅速了解用户，可用于训练个人助手。
async function downloadProfile() {
  exporting.value = true;
  try {
    const data = await api.profileExport();
    const md = buildProfileDoc(data);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `个人知识画像-${data.user?.username ?? 'user'}.md`;
    a.click();
    URL.revokeObjectURL(url);
    ui.toast('已导出个人数据文档', 'success');
  } catch (e) {
    ui.toast(`导出失败：${e.message}`, 'error');
  } finally {
    exporting.value = false;
  }
}

onMounted(createAndLoad);
</script>
