// 设置倒计时对话框：输入分钟数（1~1440），显示当日剩余额度
// 额度上限来自所在库的学习策略（可调、可关）；DAILY_LIMIT → 提示今日已达上限
<template>
  <div v-if="visible" class="overlay" @click.self="$emit('close')">
    <div class="panel dialog">
      <h3>设置学习倒计时</h3>
      <p class="muted">
        <template v-if="policy.timerEnabled">
          闯关需先开启倒计时（开启后不可取消）。今日剩余额度：
          <b>{{ timer.dailyRemainingMinutes ?? '…' }} 分钟</b>（每日上限 {{ policy.dailyLimitMinutes }} 分钟）
        </template>
        <template v-else> 本库已关闭计时约束：倒计时仅用于自我计时，不设上限、也不影响闯关。 </template>
      </p>
      <div class="dialog-row">
        <input
          v-model.number="minutes"
          type="number"
          min="1"
          :max="MAX_MINUTES"
          class="input minutes-input"
        />
        <span>分钟</span>
      </div>
      <div class="quick-row">
        <button v-for="m in [10, 25, 40, 60]" :key="m" class="chip" @click="minutes = m">{{ m }}′</button>
      </div>
      <p v-if="error" class="error-text">{{ error }}</p>
      <div class="dialog-actions">
        <button class="btn ghost" @click="$emit('close')">取消</button>
        <button class="btn primary" :disabled="starting" @click="start">
          {{ starting ? '开启中…' : '开始倒计时' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { useTimerStore } from '../stores/timer.js';
import { usePolicyStore } from '../stores/policy.js';

const props = defineProps({
  visible: { type: Boolean, default: false },
});
const emit = defineEmits(['close', 'started']);

const timer = useTimerStore();
const policy = usePolicyStore();
const MAX_MINUTES = 1440;
const minutes = ref(25);
const starting = ref(false);
const error = ref('');

watch(
  () => props.visible,
  (v) => {
    if (v) {
      error.value = '';
      timer.refreshDaily();
    }
  },
);

async function start() {
  error.value = '';
  const m = Math.floor(minutes.value);
  if (!Number.isInteger(m) || m < 1 || m > MAX_MINUTES) {
    error.value = `请输入 1~${MAX_MINUTES} 之间的整数分钟`;
    return;
  }
  starting.value = true;
  try {
    await timer.start(m);
    emit('started');
    emit('close');
  } catch (e) {
    error.value =
      e.code === 'DAILY_LIMIT'
        ? `今日计时已达上限（${policy.dailyLimitMinutes} 分钟），明天再来吧`
        : e.message;
  } finally {
    starting.value = false;
  }
}
</script>
