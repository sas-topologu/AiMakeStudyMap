// 管理端审核页（/admin，仅 is_admin）
// 两个分区：待审核二创（通过/拒绝）、待处理勘误（采纳/驳回 + 可选备注）；操作后从列表移除
<template>
  <div class="node-page">
    <header class="node-header">
      <button class="icon-btn" title="返回" @click="$router.push('/')">←</button>
      <div class="node-head-main">
        <h1>审核队列</h1>
        <div class="node-meta">
          <span class="badge">二创 {{ creations.length }}</span>
          <span class="badge">勘误 {{ corrections.length }}</span>
        </div>
      </div>
    </header>

    <p v-if="loading" class="muted pad">加载中…</p>

    <template v-else>
      <!-- 待审核二创 -->
      <h2 class="admin-section-title">待审核二创</h2>
      <p v-if="!creations.length" class="muted pad">没有待审核的二创作品。</p>
      <div v-else class="node-body">
        <section v-for="c in creations" :key="c.id" class="panel review-item">
          <div class="creation-head">
            <span class="creation-icon">{{ TYPE_ICON[c.type] ?? '📦' }}</span>
            <b>{{ c.title }}</b>
            <small class="muted">{{ TYPE_LABEL[c.type] ?? c.type }}</small>
          </div>
          <p class="muted small">
            {{ c.author }} · 节点 <code>{{ c.nodeId }}</code> · {{ formatTime(c.createdAt) }}
          </p>
          <pre class="creation-content">{{ preview(c.content) }}</pre>
          <div class="dialog-actions left">
            <button class="btn primary" :disabled="busyId === `c${c.id}`" @click="reviewCreation(c, 'approve')">
              通过
            </button>
            <button class="btn ghost danger-text" :disabled="busyId === `c${c.id}`" @click="reviewCreation(c, 'reject')">
              拒绝
            </button>
          </div>
        </section>
      </div>

      <!-- 待处理勘误 -->
      <h2 class="admin-section-title">待处理勘误</h2>
      <p v-if="!corrections.length" class="muted pad">没有待处理的勘误。</p>
      <div v-else class="node-body">
        <section v-for="c in corrections" :key="c.id" class="panel review-item">
          <div class="creation-head">
            <b>{{ c.nodeTitle }}</b>
            <small class="muted"><code>{{ c.nodeId }}</code></small>
          </div>
          <p class="muted small">{{ c.author }} · {{ formatTime(c.createdAt) }}</p>
          <pre class="creation-content">{{ c.body }}</pre>
          <input
            v-model.trim="notes[c.id]"
            class="input"
            maxlength="200"
            placeholder="审核备注（可选，将展示给提交者）"
          />
          <div class="dialog-actions left">
            <button class="btn primary" :disabled="busyId === `k${c.id}`" @click="reviewCorrection(c, 'approve')">
              采纳
            </button>
            <button class="btn ghost danger-text" :disabled="busyId === `k${c.id}`" @click="reviewCorrection(c, 'reject')">
              驳回
            </button>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api/client.js';
import { useUiStore } from '../stores/ui.js';
import { formatTime } from '../utils/format.js';

const TYPE_ICON = { mindmap: '🧠', game: '🎮', summary: '🗺' };
const TYPE_LABEL = { mindmap: '思维导图', game: '小游戏', summary: '总结图' };

const ui = useUiStore();
const creations = ref([]);
const corrections = ref([]);
const notes = ref({}); // correctionId → 备注
const loading = ref(true);
const busyId = ref(null);

const preview = (s) => (s.length > 300 ? `${s.slice(0, 300)}…` : s);

async function load() {
  loading.value = true;
  try {
    const data = await api.reviewQueue();
    creations.value = data.creations ?? [];
    corrections.value = data.corrections ?? [];
  } catch (e) {
    ui.toast(e.message, 'error');
  } finally {
    loading.value = false;
  }
}

async function reviewCreation(c, action) {
  busyId.value = `c${c.id}`;
  try {
    await api.reviewCreation(c.id, action);
    creations.value = creations.value.filter((x) => x.id !== c.id);
    ui.toast(action === 'approve' ? '已通过' : '已拒绝', 'success');
  } catch (e) {
    ui.toast(e.message, 'error');
  } finally {
    busyId.value = null;
  }
}

async function reviewCorrection(c, action) {
  busyId.value = `k${c.id}`;
  try {
    await api.reviewCorrection(c.id, action, notes.value[c.id] || undefined);
    corrections.value = corrections.value.filter((x) => x.id !== c.id);
    ui.toast(action === 'approve' ? '已采纳（待合并主库）' : '已驳回', 'success');
  } catch (e) {
    ui.toast(e.message, 'error');
  } finally {
    busyId.value = null;
  }
}

onMounted(load);
</script>
