<template>
  <div v-if="visible" class="overlay" @click.self="$emit('close')">
    <div class="panel dialog">
      <h3>
        错题复盘
        <span v-if="due.length" class="muted small">· 到期 {{ due.length }}</span>
      </h3>

      <template v-if="!current">
        <p class="muted">今天没有到期的错题。</p>
        <p v-if="stats.total" class="muted small">
          队列里还有 {{ stats.total }} 题，下次到期：{{ nextText }}
        </p>
        <p v-else class="muted small">还没有错题 —— 闯关/刷题答错的题会自动进这里。</p>
      </template>

      <template v-else>
        <p class="muted small">
          {{ current.nodeTitle }} · 第 {{ current.seq }} 题 · 已错 {{ current.wrongCount }} 次 · 第
          {{ (current.level ?? 0) + 1 }} 阶
        </p>
        <p class="review-stem">{{ current.stem }}</p>

        <div v-if="current.type === 'choice'" class="review-options">
          <button
            v-for="(opt, i) in current.options"
            :key="i"
            class="review-option"
            :class="{ picked: picked === i }"
            @click="picked = i"
          >
            {{ String.fromCharCode(65 + i) }}. {{ opt }}
          </button>
        </div>
        <input
          v-else
          v-model.trim="fill"
          class="input"
          placeholder="填写答案"
          @keyup.enter="submit"
        />

        <p v-if="feedback" class="small" :class="feedback.ok ? 'ok-text' : 'error-text'">
          {{ feedback.text }}
        </p>
        <p v-if="feedback" class="muted small">
          正确答案：{{ answerText(current) }}<br />{{ current.explanation }}
        </p>
      </template>

      <div class="dialog-actions">
        <button class="btn ghost" @click="$emit('close')">稍后再来</button>
        <button v-if="current && !feedback" class="btn primary" :disabled="!canSubmit" @click="submit">
          提交
        </button>
        <button v-else-if="current" class="btn primary" @click="next">下一题</button>
      </div>
    </div>
  </div>
</template>

<script setup>
// 错题复盘（全局入口）：按间隔重复排出**今天该复习的题**，答对升阶、答错回到起点
import { computed, ref, watch } from 'vue';
import { dueQueue, reviewAnswer, reviewStats } from '../utils/reviewStore.js';

const props = defineProps({
  visible: { type: Boolean, default: false },
});
defineEmits(['close']);

const due = ref([]);
const stats = ref({ total: 0, due: 0, nextDueAt: null });
const idx = ref(0);
const picked = ref(null);
const fill = ref('');
const feedback = ref(null);

function resetInput() {
  picked.value = null;
  fill.value = '';
  feedback.value = null;
}

function reload() {
  due.value = dueQueue(20);
  idx.value = 0;
  stats.value = reviewStats();
  resetInput();
}

watch(
  () => props.visible,
  (v) => {
    if (v) reload();
  },
);

const current = computed(() => due.value[idx.value] ?? null);
const canSubmit = computed(() => {
  if (!current.value) return false;
  return current.value.type === 'choice' ? picked.value !== null : fill.value.length > 0;
});

const nextText = computed(() => {
  if (!stats.value.nextDueAt) return '—';
  const d = new Date(stats.value.nextDueAt);
  return `${d.toLocaleString('zh-CN', { hour12: false }).slice(5, 16)}`;
});

const answerText = (q) =>
  q.type === 'choice' && typeof q.answer === 'number'
    ? `${String.fromCharCode(65 + q.answer)}. ${q.options?.[q.answer] ?? ''}`
    : String(q.answer);

function submit() {
  const q = current.value;
  if (!q) return;
  const ok = q.type === 'choice' ? Number(picked.value) === Number(q.answer) : fill.value === String(q.answer);
  const r = reviewAnswer(q.nodeId, q.seq, ok);
  feedback.value = {
    ok,
    text: ok
      ? `答对了 ✓ ${r?.graduated ? '已掌握，移出队列' : `下次复习：${r?.intervalLabel}后`}`
      : '答错了 —— 回到第一阶，10 分钟后再来',
  };
  stats.value = reviewStats();
}

function next() {
  idx.value += 1;
  resetInput();
  if (idx.value >= due.value.length) reload();
}
</script>
