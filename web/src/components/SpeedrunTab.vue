// 速通榜 Tab：点亮耗时排行（前三金银铜；当前登录用户行高亮；空榜虚位以待）
// **榜单只接受已认证成果**（服务端已过滤，见 docs/概念模型.md §4.3）；未认证的不上榜，
// 但成果本身照常算进度、照常解锁后续节点。
<template>
  <section class="panel">
    <h3>⚡ 速通榜</h3>
    <p v-if="loading" class="muted">加载中…</p>
    <p v-else-if="!ranks.length" class="muted">虚位以待——第一个点亮本节点的人将永远留在这里。</p>
    <table v-else class="rank-table">
      <thead>
        <tr><th>名次</th><th>用户</th><th>点亮用时</th><th>点亮时间</th></tr>
      </thead>
      <tbody>
        <tr
          v-for="r in ranks"
          :key="r.username"
          :class="{ me: r.username === auth.user?.username }"
        >
          <td><span class="rank-medal" :class="`r${r.rank}`">{{ medal(r.rank) }}</span></td>
          <td>
            {{ r.username }}
            <em v-if="r.certified" class="badge-certified" title="榜上均为本库当场见证的成果">已认证</em>
          </td>
          <td>{{ formatDuration(r.seconds) }}</td>
          <td class="muted">{{ formatTime(r.litAt) }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup>
import { ref, watch } from 'vue';
import { api } from '../api/client.js';
import { useAuthStore } from '../stores/auth.js';
import { useUiStore } from '../stores/ui.js';
import { formatTime, formatDuration } from '../utils/format.js';

const props = defineProps({
  nodeId: { type: String, required: true },
});

const auth = useAuthStore();
const ui = useUiStore();
const ranks = ref([]);
const loading = ref(true);

const medal = (rank) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`);

async function load() {
  loading.value = true;
  try {
    const { ranks: r } = await api.speedrun(props.nodeId);
    ranks.value = r;
  } catch (e) {
    ui.toast(e.message, 'error');
  } finally {
    loading.value = false;
  }
}

watch(() => props.nodeId, load);
load();
</script>
