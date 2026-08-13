// 设置倒计时对话框：输入分钟数（1~120），显示当日剩余额度
// DAILY_LIMIT → 提示今日已达上限；成功后抛 started 事件
<template>
  <div v-if="visible" class="overlay" @click.self="$emit('close')">
    <div class="panel dialog">
      <h3>设置学习倒计时</h3>
      <p class="muted">
        闯关需先开启倒计时（开启后不可取消）。今日剩余额度：
        <b>{{ timer.dailyRemainingMinutes ?? '…' }} 分钟</b>（每日上限 120 分钟）
      </p>
      <div class="dialog-row">
        <input
          v-model.number="minutes"
          type="number"
          min="1"
          max="120"
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

const props = defineProps({
  visible: { type: Boolean, default: false },
});
const emit = defineEmits(['close', 'started']);

const timer = useTimerStore();
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
  if (!Number.isInteger(m) || m < 1 || m > 120) {
    error.value = '请输入 1~120 之间的整数分钟';
    return;
  }
  starting.value = true;
  try {
    await timer.start(m);
    emit('started');
    emit('close');
  } catch (e) {
    error.value = e.code === 'DAILY_LIMIT' ? '今日计时已达上限（120 分钟），明天再来吧' : e.message;
  } finally {
    starting.value = false;
  }
}
</script>
