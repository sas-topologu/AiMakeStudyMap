// 我的进度面板：账号 / 计时与当日额度 / 跃迁额度 / 最近学习 / 当前邻域状态统计
<template>
  <div v-if="visible" class="overlay" @click.self="$emit('close')">
    <div class="panel dialog">
      <h3>我的进度</h3>
      <ul class="progress-list">
        <li><span>用户</span><b>{{ auth.user?.username ?? '—' }}</b></li>
        <li>
          <span>当前倒计时</span>
          <b>{{ timer.active ? timer.remainingText : '无进行中' }}</b>
        </li>
        <li v-if="policy.timerEnabled">
          <span>今日计时额度</span>
          <b>剩余 {{ timer.dailyRemainingMinutes ?? '…' }} / {{ policy.dailyLimitMinutes }} 分钟</b>
        </li>
        <li>
          <span>学习成果</span>
          <b>{{ progressText }}</b>
        </li>
        <li v-if="policy.jumpQuotaEnabled">
          <span>跃迁额度</span>
          <b>{{ auth.quota === null ? '获取中…' : `${auth.quota} 点` }}（月赠 1 · 上限 2）</b>
        </li>
        <li>
          <span>错题复盘</span>
          <b v-if="review.due">到期 {{ review.due }} 题（共 {{ review.total }}）</b>
          <b v-else-if="review.total">共 {{ review.total }} 题 · 今日无到期</b>
          <b v-else>暂无错题</b>
        </li>
        <li>
          <span>最近学习节点</span>
          <b>{{ recentTitle }}</b>
        </li>
      </ul>
      <template v-if="starmap.centerId">
        <h4 class="progress-sub">当前星图邻域（{{ starmap.nodes.length }} 节点）</h4>
        <div class="progress-counts">
          <span v-for="(label, s) in STATE_LABEL" :key="s" class="count-chip" :class="s">
            {{ label }} {{ starmap.stateCounts[s] ?? 0 }}
          </span>
        </div>
      </template>

      <!-- 我的勘误（折叠） -->
      <h4 class="progress-sub">
        <button class="link-btn" @click="toggleCorrections">
          我的勘误 {{ showCorrections ? '▾' : '▸' }}
        </button>
      </h4>
      <div v-if="showCorrections" class="my-corrections">
        <p v-if="corrections === null" class="muted small">加载中…</p>
        <p v-else-if="!corrections.length" class="muted small">还没有提交过勘误。</p>
        <ul v-else>
          <li v-for="c in corrections" :key="c.id">
            <span class="corr-status" :class="c.status">{{ CORR_STATUS[c.status] ?? c.status }}</span>
            <span class="corr-main">
              <b>{{ c.nodeTitle }}</b>
              <small>{{ c.body }}</small>
              <small v-if="c.reviewNote" class="corr-note">审核备注：{{ c.reviewNote }}</small>
            </span>
            <small class="muted corr-time">{{ formatTime(c.createdAt) }}</small>
          </li>
        </ul>
      </div>
      <!-- 数据带走：个人进度导出 / 导入 -->
      <h4 class="progress-sub">数据带走（导出 / 导入）</h4>
      <p class="muted small">
        进度只存在当前数据源里；导出成一个文件，换设备或换库时能带过去。
        导入时<b>只升不降</b>：不会覆盖更高的进度；认证只在导回同一个库时保留。
      </p>
      <p v-if="dataMsg" class="muted small">{{ dataMsg }}</p>
      <div class="dialog-actions left">
        <button class="btn ghost" :disabled="busyData" @click="exportProgress">
          {{ busyData ? '处理中…' : '导出进度文件' }}
        </button>
        <button class="btn ghost" :disabled="busyData" @click="pickFile">导入进度文件</button>
        <input
          ref="fileEl"
          type="file"
          accept="application/json,.json"
          class="hidden-file"
          @change="importProgress"
        />
      </div>

      <div class="dialog-actions">
        <button class="btn ghost" @click="$emit('close')">关闭</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { api } from '../api/client.js';
import { useAuthStore } from '../stores/auth.js';
import { useTimerStore } from '../stores/timer.js';
import { useStarmapStore } from '../stores/starmap.js';
import { usePolicyStore } from '../stores/policy.js';
import { useLocalProgressStore } from '../stores/localProgress.js';
import {
  buildProgressFile,
  parseProgressFile,
  progressFileName,
} from '../utils/progressFile.js';
import { formatTime } from '../utils/format.js';
import { reviewStats } from '../utils/reviewStore.js';

const props = defineProps({
  visible: { type: Boolean, default: false },
});
defineEmits(['close']);

const STATE_LABEL = { dim: '暗淡', open: '开放', passed: '通关', lit: '点亮' };
const CORR_STATUS = { pending: '待审核', approved: '已采纳', rejected: '未采纳' };

const auth = useAuthStore();
const timer = useTimerStore();
const starmap = useStarmapStore();
const policy = usePolicyStore();
const localProgress = useLocalProgressStore();

const totals = ref(null); // { passed, lit }（全图统计，graph/all 带 state）
const review = ref(reviewStats()); // { total, due, nextDueAt }
const showCorrections = ref(false);
const corrections = ref(null); // null=未加载
const fileEl = ref(null);
const busyData = ref(false);
const dataMsg = ref('');

// ---- 数据带走：导出 / 导入 ----
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportProgress() {
  busyData.value = true;
  dataMsg.value = '';
  try {
    // 库侧进度 + 本地离线成果，合成一份可带走的文件
    const server = await api.progressExport();
    const local = Object.entries(localProgress.items).map(([nodeId, v]) => ({
      nodeId,
      state: v.state,
      passSeconds: v.passSeconds,
    }));
    const file = buildProgressFile({ source: server.source, states: server.states, local });
    download(progressFileName(file.exportedAt), JSON.stringify(file, null, 2));
    dataMsg.value = `已导出 ${file.states.length} 个节点的进度（本地未上报的 ${local.length} 条也一并带上）`;
  } catch (e) {
    dataMsg.value = `导出失败：${e.message}`;
  } finally {
    busyData.value = false;
  }
}

function pickFile() {
  dataMsg.value = '';
  fileEl.value?.click();
}

async function importProgress(event) {
  const input = event.target;
  const f = input.files?.[0];
  input.value = ''; // 允许重复选同一个文件
  if (!f) return;
  busyData.value = true;
  dataMsg.value = '';
  try {
    const parsed = parseProgressFile(await f.text());
    if (!parsed.ok) {
      dataMsg.value = `导入失败：${parsed.error}`;
      return;
    }
    const r = await api.progressImport({ source: parsed.data.source, states: parsed.data.states });
    const extra = r.ignored?.length ? `，${r.ignored.length} 个节点本库没有（已忽略）` : '';
    const cert = r.sameLibrary ? '' : '；跨库导入：认证不保留（本库没见证过）';
    dataMsg.value = `导入完成：新增 ${r.imported} 条，跳过 ${r.skipped} 条${extra}${cert}`;
    await starmap.refreshStates().catch(() => {});
    await refreshTotals();
  } catch (e) {
    dataMsg.value = `导入失败：${e.message}`;
  } finally {
    busyData.value = false;
  }
}

async function toggleCorrections() {
  showCorrections.value = !showCorrections.value;
  if (showCorrections.value) {
    corrections.value = null;
    try {
      const { corrections: list } = await api.myCorrections();
      corrections.value = list;
    } catch {
      corrections.value = [];
    }
  }
}

const recentTitle = computed(() => {
  const id = starmap.recentId;
  if (!id) return '—';
  return starmap.cache.cards[id]?.title ?? starmap.nodesById[id]?.title ?? id;
});

const progressText = computed(() =>
  totals.value ? `通关 ${totals.value.passed} · 点亮 ${totals.value.lit}` : '统计中…',
);

watch(
  () => props.visible,
  async (v) => {
    if (!v) return;
    timer.refreshDaily();
    auth.refreshQuota();
    review.value = reviewStats(); // 每次打开都重新算到期错题
    await refreshTotals();
  },
);

async function refreshTotals() {
  try {
    const { nodes } = await api.graphAll();
    totals.value = {
      passed: nodes.filter((n) => n.state === 'passed').length,
      lit: nodes.filter((n) => n.state === 'lit').length,
    };
  } catch {
    totals.value = null;
  }
}
</script>
