// 管理面板（admin，服务端管理 AI 抽查留档）
// 只读展示：投稿队列/公示状态、举报队列、待审核勘误、待处理任务计数 —— 供平台所有者"偶尔抽查"。
<template>
  <div class="manage-page">
    <header class="panel manage-head">
      <h2>管理面板 · 抽查留档</h2>
      <span class="muted">投稿由管理 AI 一审（公示期后自动入库），此页仅供你偶尔核对，不参与日常处理。</span>
      <button class="btn ghost" @click="load">刷新</button>
    </header>

    <p v-if="loading" class="macro-status">加载中…</p>
    <p v-else-if="error" class="error-text">{{ error }}</p>
    <template v-else>
      <div class="manage-row">
        <section class="panel manage-box">
          <h3>待处理任务（管理 AI 队列）</h3>
          <p v-if="!overview.pendingTasks.length" class="muted">暂无待处理任务</p>
          <ul v-else>
            <li v-for="pt in overview.pendingTasks" :key="pt.type">
              {{ TYPE_LABEL[pt.type] ?? pt.type }}：<b>{{ pt.n }}</b>
            </li>
          </ul>
        </section>
        <section class="panel manage-box">
          <h3>投稿队列（{{ overview.submissions.length }}）</h3>
          <table class="manage-table">
            <thead><tr><th>节点</th><th>状态</th><th>公示至</th><th>时间</th></tr></thead>
            <tbody>
              <tr v-for="s in overview.submissions" :key="s.id">
                <td>{{ s.node_id }}</td>
                <td><span class="state-dot" :class="s.status" />{{ STATE_CN[s.status] ?? s.status }}</td>
                <td>{{ fmt(s.review_due_at) }}</td>
                <td>{{ fmt(s.created_at) }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
      <div class="manage-row">
        <section class="panel manage-box">
          <h3>举报队列（{{ overview.reports.length }}）</h3>
          <table class="manage-table">
            <thead><tr><th>对象</th><th>类型</th><th>原因</th><th>状态</th></tr></thead>
            <tbody>
              <tr v-for="r in overview.reports" :key="r.id">
                <td>{{ r.target_type }}</td>
                <td>{{ r.target_id }}</td>
                <td class="manage-wrap">{{ r.reason }}</td>
                <td>{{ r.verdict || r.status }}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section class="panel manage-box">
          <h3>待审核勘误（{{ overview.corrections.length }}）</h3>
          <table class="manage-table">
            <thead><tr><th>节点</th><th>内容</th></tr></thead>
            <tbody>
              <tr v-for="c in overview.corrections" :key="c.id">
                <td>{{ c.node_title }}</td>
                <td class="manage-wrap">{{ c.body }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api/client.js';

const TYPE_LABEL = { card_review: '投稿一审', report_review: '举报初审', correction_review: '勘误审核', legal_action: '法定动作' };
const STATE_CN = { pending: '待审', ai_reviewed: '公示中', approved: '已过审', rejected: '打回', reopened: '异议' };

const overview = ref({ submissions: [], reports: [], corrections: [], pendingTasks: [] });
const loading = ref(true);
const error = ref('');

const fmt = (iso) => (iso ? iso.replace('T', ' ').slice(0, 16) : '—');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    overview.value = await api.manageOverview();
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>
