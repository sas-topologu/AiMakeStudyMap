// 知识卡详情页：正文（Markdown + [[术语]] 夹层）、四态闯关区、答题流、结果页
// 讨论区 / 二创区为阶段 6 占位 Tab
<template>
  <div class="node-page">
    <header class="node-header">
      <button class="icon-btn" title="返回星图" @click="back">←</button>
      <div class="node-head-main">
        <h1>{{ card?.title ?? '…' }}</h1>
        <div v-if="card" class="node-meta">
          <span class="badge">{{ card.subject }}</span>
          <span class="badge stars" :title="`难度 ${card.difficulty}`">{{ stars }}</span>
          <span class="badge" :class="credClass">{{ credLabel }}</span>
          <span class="badge state" :class="state">当前：{{ stateLabel }}</span>
        </div>
      </div>
    </header>

    <p v-if="loading" class="muted pad">加载中…</p>
    <p v-else-if="error" class="error-text pad">{{ error }} <button class="link-btn" @click="load">重试</button></p>

    <template v-else-if="card">
      <nav class="node-tabs">
        <button :class="{ active: tab === 'card' }" @click="tab = 'card'">知识卡</button>
        <button :class="{ active: tab === 'discuss' }" @click="tab = 'discuss'">讨论区</button>
        <button :class="{ active: tab === 'create' }" @click="tab = 'create'">二创区</button>
        <button :class="{ active: tab === 'speedrun' }" @click="tab = 'speedrun'">速通榜</button>
      </nav>

      <!-- 知识卡正文（教材化 + 分层折叠 + 阅读模式） -->
      <main v-if="tab === 'card'" class="node-body">
        <!-- 阅读模式工具条 -->
        <div class="reading-toolbar panel">
          <div class="mode-segment">
            <button
              v-for="m in READING_MODES"
              :key="m.key"
              :class="{ active: readingMode === m.key }"
              @click="setReadingMode(m.key)"
            >
              {{ m.label }}
            </button>
          </div>
          <span class="muted small mode-hint">
            {{ { glance: '已掌握：只看骨架', standard: '核心展开，推导/拓展可点开', full: '全部展开' }[readingMode] }}
          </span>
        </div>

        <!-- 学习目标 -->
        <section v-if="card.objectives?.length" class="panel objectives">
          <h2>🎯 学习目标</h2>
          <ul>
            <li v-for="(o, i) in card.objectives" :key="i">{{ o }}</li>
          </ul>
        </section>

        <!-- 核心图（头图；速览隐藏） -->
        <section v-if="coreMedia.length && isSupplementShown(readingMode)" class="panel hero-media">
          <figure v-for="m in coreMedia" :key="m.id">
            <img :src="mediaSrc(m.src)" :alt="m.caption ?? m.id" loading="lazy" />
            <figcaption v-if="m.caption">
              {{ m.caption }}<span v-if="m.type === 'animation'" class="media-badge">动画</span>
            </figcaption>
          </figure>
        </section>

        <!-- 摘要（始终展开） -->
        <section class="panel section-with-errata">
          <button class="errata-btn" title="提交勘误" @click="correctionFor = '摘要'">✎</button>
          <RichText :text="card.summary" class="summary" @term="onTerm" />
        </section>

        <!-- 正文 sections：按 tier 折叠 -->
        <CollapsibleSection
          v-for="(sec, i) in listedSections"
          :key="`${nodeId}:${i}:${sec.heading}`"
          :heading="sec.heading"
          :badge="TIER_LABEL[sec.tier] ?? ''"
          :badge-class="sec.tier ?? 'core'"
          :default-open="isSectionDefaultOpen(sec.tier, readingMode)"
          @errata="correctionFor = sec.heading"
        >
          <RichText :text="sec.body" @term="onTerm" />
        </CollapsibleSection>

        <!-- 例题（解析/答案双层折叠防剧透） -->
        <section v-if="card.examples?.length" class="panel">
          <h2>📝 例题</h2>
          <ExampleItem
            v-for="ex in card.examples"
            :key="`${nodeId}:${ex.id}`"
            :example="ex"
            :show-problem="isExampleProblemShown(readingMode)"
            :steps-default-open="isStepsDefaultOpen(readingMode)"
            :answer-default-open="isAnswerDefaultOpen(readingMode)"
            @term="onTerm"
          />
        </section>

        <!-- 易错点（速览隐藏） -->
        <section v-if="card.pitfalls?.length && isSupplementShown(readingMode)" class="panel pitfalls">
          <h2>⚠️ 易错点</h2>
          <ul>
            <li v-for="(p, i) in card.pitfalls" :key="i">{{ p }}</li>
          </ul>
        </section>

        <!-- 其余 media 图集（速览隐藏；动画类型加角标） -->
        <section v-if="otherMedia.length && isSupplementShown(readingMode)" class="panel media-gallery">
          <h2>🖼 图集</h2>
          <div class="gallery-grid">
            <figure v-for="m in otherMedia" :key="m.id">
              <img :src="mediaSrc(m.src)" :alt="m.caption ?? m.id" loading="lazy" />
              <figcaption v-if="m.caption">
                {{ m.caption }}<span v-if="m.type === 'animation'" class="media-badge">动画</span>
              </figcaption>
            </figure>
          </div>
        </section>

        <!-- 闯关区：按四态呈现 -->
        <section class="panel challenge-box">
          <template v-if="state === 'dim'">
            <p class="muted">🔒 本节点尚未开放。通关相邻节点可解锁，或通过「搜索 / 跃迁」消耗 1 点额度直接开放。</p>
          </template>
          <template v-else-if="state === 'open'">
            <button class="btn primary" @click="startChallenge('pass')">闯关（3 题）</button>
          </template>
          <template v-else-if="state === 'passed'">
            <p class="ok-text">✓ 已通关</p>
            <button class="btn primary" @click="startChallenge('exam')">考核点亮</button>
          </template>
          <template v-else-if="state === 'lit'">
            <p class="ok-text">🌟 已点亮——你已完全掌握本节点</p>
          </template>
          <p v-if="state !== 'dim' && !timer.active" class="muted small">
            闯关需开启学习倒计时（不可取消，到时强制收卷）
          </p>
        </section>
      </main>

      <!-- 社交区（阶段 6）：dim 可浏览不可发言（组件内按 state 控制） -->
      <main v-else-if="tab === 'discuss'" class="node-body">
        <DiscussTab :node-id="nodeId" :state="state" />
      </main>
      <main v-else-if="tab === 'create'" class="node-body">
        <CreateTab :node-id="nodeId" :state="state" />
      </main>
      <main v-else class="node-body">
        <SpeedrunTab :node-id="nodeId" />
      </main>
    </template>

    <!-- 答题页（覆盖层） -->
    <div v-if="view === 'quiz' && paper" class="quiz-overlay">
      <div class="quiz-box panel">
        <header class="quiz-head">
          <span>{{ paper.mode === 'pass' ? '闯关' : '考核点亮' }} · {{ card?.title }}</span>
          <span class="quiz-timer" :class="{ warn: timer.remainingSeconds <= 60 }">⏱ {{ timer.remainingText }}</span>
        </header>
        <ol class="quiz-list">
          <li v-for="q in paper.questions" :key="q.seq">
            <p class="quiz-stem">{{ q.seq }}. {{ q.stem }}</p>
            <div v-if="q.type === 'choice'" class="quiz-options">
              <label v-for="(opt, i) in q.options" :key="i" class="quiz-option">
                <input v-model="answers[q.seq]" type="radio" :name="`q${q.seq}`" :value="i" />
                <span>{{ opt }}</span>
              </label>
            </div>
            <input
              v-else
              v-model="answers[q.seq]"
              class="input"
              placeholder="填写答案"
              @keydown.enter.prevent
            />
          </li>
        </ol>
        <p v-if="quizError" class="error-text">{{ quizError }}</p>
        <div class="dialog-actions">
          <button class="btn ghost" @click="quitQuiz">退出作答</button>
          <button class="btn primary" :disabled="submitting" @click="submit">
            {{ submitting ? '提交中…' : '提交试卷' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 结果页（覆盖层） -->
    <div v-if="view === 'result' && result" class="quiz-overlay">
      <div class="quiz-box panel">
        <header class="quiz-head">
          <span>{{ resultHeadline }}</span>
          <span>{{ result.correct }} / {{ result.total }} 题正确</span>
        </header>
        <p v-if="unlocked.length" class="ok-text">
          解锁了相邻节点：{{ unlocked.map((n) => n.title).join('、') }}
        </p>
        <ol class="quiz-list">
          <li v-for="pq in result.perQuestion" :key="pq.seq" :class="pq.correct ? 'ok' : 'bad'">
            <p class="quiz-stem">
              {{ pq.correct ? '✓' : '✗' }} 第 {{ pq.seq }} 题
              <small>正确答案：{{ answerText(pq) }}</small>
            </p>
            <p class="muted small">{{ pq.explanation }}</p>
          </li>
        </ol>
        <div class="dialog-actions">
          <button v-if="result.result === 'failed'" class="btn primary" @click="retry">返回重试</button>
          <button class="btn ghost" @click="view = 'card'">返回知识卡</button>
        </div>
      </div>
    </div>

    <TermLayers :layers="termLayers" @close="closeTerm" @close-all="termLayers = []" @term="onTerm" />
    <TimerDialog :visible="timerVisible" @close="timerVisible = false" @started="onTimerStarted" />
    <CorrectionDialog
      :visible="correctionFor !== null"
      :node-id="nodeId"
      :node-title="card?.title ?? ''"
      :section="correctionFor ?? ''"
      @close="correctionFor = null"
    />
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/client.js';
import { useTimerStore } from '../stores/timer.js';
import { useStarmapStore } from '../stores/starmap.js';
import { useUiStore } from '../stores/ui.js';
import RichText from '../components/RichText.vue';
import TermLayers from '../components/TermLayers.vue';
import TimerDialog from '../components/TimerDialog.vue';
import DiscussTab from '../components/DiscussTab.vue';
import CreateTab from '../components/CreateTab.vue';
import SpeedrunTab from '../components/SpeedrunTab.vue';
import CorrectionDialog from '../components/CorrectionDialog.vue';
import CollapsibleSection from '../components/CollapsibleSection.vue';
import ExampleItem from '../components/ExampleItem.vue';
import {
  READING_MODES,
  TIER_LABEL,
  isSectionListed,
  isSectionDefaultOpen,
  isExampleProblemShown,
  isStepsDefaultOpen,
  isAnswerDefaultOpen,
  isSupplementShown,
  mediaSrc,
} from '../utils/readingMode.js';

const route = useRoute();
const router = useRouter();
const timer = useTimerStore();
const starmap = useStarmapStore();
const ui = useUiStore();

const nodeId = computed(() => route.params.id);

const card = ref(null);
const state = ref('dim');
const loading = ref(true);
const error = ref('');
const tab = ref('card');

const view = ref('card'); // card | quiz | result
const paper = ref(null);
const answers = ref({});
const result = ref(null);
const unlocked = ref([]);
const submitting = ref(false);
const quizError = ref('');

const timerVisible = ref(false);
const pendingMode = ref('pass');
const termLayers = ref([]);
const correctionFor = ref(null); // 勘误目标段落标题（null=关闭对话框）

// 阅读模式：全局偏好，持久化 localStorage（不随节点变）
const READING_MODE_KEY = 'starmap:readingMode';
const readingMode = ref(
  READING_MODES.some((m) => m.key === localStorage.getItem(READING_MODE_KEY))
    ? localStorage.getItem(READING_MODE_KEY)
    : 'standard',
);
function setReadingMode(mode) {
  readingMode.value = mode;
  localStorage.setItem(READING_MODE_KEY, mode);
}

// media：core 作头图，其余进图集
const coreMedia = computed(() => (card.value?.media ?? []).filter((m) => m.core === true));
const otherMedia = computed(() => (card.value?.media ?? []).filter((m) => m.core !== true));
// 当前模式下应列出的 sections（速览只列 core）
const listedSections = computed(() =>
  (card.value?.sections ?? []).filter((s) => isSectionListed(s.tier, readingMode.value)),
);

const STATE_LABEL = { dim: '暗淡', open: '开放', passed: '通关', lit: '点亮' };
const stateLabel = computed(() => STATE_LABEL[state.value] ?? state.value);
const stars = computed(() =>
  card.value ? '★'.repeat(card.value.difficulty) + '☆'.repeat(Math.max(0, 5 - card.value.difficulty)) : '',
);
const credLabel = computed(() =>
  card.value?.credibility === 'verified' ? '验证通过' : card.value?.credibility === 'disputed' ? '存在争议' : '待审核',
);
const credClass = computed(() =>
  card.value?.credibility === 'verified' ? 'cred-ok' : card.value?.credibility === 'disputed' ? 'cred-warn' : '',
);
const resultHeadline = computed(() => {
  if (!result.value) return '';
  return { passed: '🎉 闯关成功', lit: '🌟 点亮成功', failed: '未通过，再接再厉' }[result.value.result];
});

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const { card: c, state: s } = await api.nodeDetail(nodeId.value);
    card.value = c;
    state.value = s;
    starmap.cacheCard(c);
    localStorage.setItem('starmap.recent', c.id);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

function back() {
  // 返回星图并以本节点为中心
  starmap.centerOn(nodeId.value).catch(() => {});
  router.push('/');
}

// ---- 夹层系统：术语多级浮窗 ----
function onTerm(name, event) {
  const depth = termLayers.value.length;
  termLayers.value.push({
    name,
    text: card.value?.terms?.[name] ?? '本卡未收录该术语的定义。',
    x: Math.min(event.clientX + 14 + depth * 22, window.innerWidth - 330),
    y: Math.min(event.clientY + 8 + depth * 22, window.innerHeight - 220),
  });
}
function closeTerm(i) {
  termLayers.value.splice(i, 1);
}

// ---- 闯关闭环 ----
async function startChallenge(mode) {
  pendingMode.value = mode;
  if (!timer.active) {
    timerVisible.value = true; // 先设置倒计时
    return;
  }
  await openQuiz(mode);
}

async function onTimerStarted() {
  await openQuiz(pendingMode.value);
}

async function openQuiz(mode) {
  quizError.value = '';
  try {
    paper.value = await api.challengeStart(nodeId.value, mode);
    answers.value = {};
    view.value = 'quiz';
  } catch (e) {
    if (e.code === 'NO_TIMER') timerVisible.value = true;
    else if (e.code === 'FORBIDDEN_STATE') ui.toast('节点未开放，不可闯关', 'error');
    else ui.toast(e.message, 'error');
  }
}

function quitQuiz() {
  paper.value = null;
  view.value = 'card';
}

async function submit() {
  // 提交前快照邻域状态，用于通关后提示新解锁节点
  let before = {};
  try {
    const hood = await api.neighborhood(nodeId.value, 1);
    before = Object.fromEntries(hood.nodes.map((n) => [n.id, n.state]));
  } catch {
    /* 快照失败不阻断提交 */
  }

  submitting.value = true;
  quizError.value = '';
  try {
    const r = await api.submitPaper(paper.value.paperId, answers.value);
    result.value = r;
    state.value = r.state;
    view.value = 'result';

    if (r.result === 'passed' || r.result === 'lit') {
      // 对比邻域状态，找出新解锁（dim → 非 dim）的相邻节点
      try {
        const after = await api.neighborhood(nodeId.value, 1);
        unlocked.value = after.nodes.filter(
          (n) => n.id !== nodeId.value && before[n.id] === 'dim' && n.state !== 'dim',
        );
      } catch {
        unlocked.value = [];
      }
      starmap.refreshStates().catch(() => {}); // 状态已变，邻域缓存失效重建
      load(); // 刷新本卡状态
    }
  } catch (e) {
    if (e.code === 'NO_TIMER') {
      quizError.value = '倒计时已结束，本次作答无效';
      paper.value = null;
      view.value = 'card';
    } else {
      quizError.value = e.message;
    }
  } finally {
    submitting.value = false;
  }
}

function answerText(pq) {
  const q = paper.value?.questions.find((x) => x.seq === pq.seq);
  if (q?.type === 'choice' && typeof pq.answer === 'number') {
    return `${String.fromCharCode(65 + pq.answer)}. ${q.options[pq.answer]}`;
  }
  return String(pq.answer);
}

function retry() {
  result.value = null;
  startChallenge(pendingMode.value);
}

// 倒计时结束：强制退出作答回详情页
watch(
  () => timer.active,
  (active, prev) => {
    if (prev && !active && view.value === 'quiz') {
      paper.value = null;
      view.value = 'card';
      ui.toast('倒计时结束，已强制退出作答', 'error', 3600);
    }
  },
);

watch(nodeId, () => {
  termLayers.value = [];
  view.value = 'card';
  tab.value = 'card';
  load();
});

load();
timer.restore();
</script>
