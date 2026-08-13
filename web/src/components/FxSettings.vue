// 动效设置面板（Fab「⚙」打开）
// 本阶段：切换动画开关；1d 将在此追加粒子速度等（面板一次成型，直接加配置行即可）
<template>
  <div v-if="visible" class="overlay" @click.self="$emit('close')">
    <div class="panel dialog">
      <h3>动效设置</h3>
      <label class="fx-row">
        <span>
          <b>切换动画</b>
          <small class="muted">中心节点切换时的弹簧牵引过渡</small>
        </span>
        <input
          type="checkbox"
          :checked="fx.settings.transition"
          :disabled="fx.reducedMotion.value"
          @change="(e) => fx.setTransition(e.target.checked)"
        />
      </label>
      <p v-if="fx.reducedMotion.value" class="muted small">
        系统已开启「减少动态效果」（prefers-reduced-motion），动画已强制关闭。
      </p>
      <!-- 星光拼形粒子（1d）：四档速度 -->
      <div class="fx-row">
        <span>
          <b>星光拼形</b>
          <small class="muted">中心节点周边星点组成核心公式/图片，循环组散</small>
        </span>
        <span class="mode-segment fx-segment">
          <button
            v-for="opt in SPEED_OPTIONS"
            :key="opt.v"
            :class="{ active: fx.settings.particleSpeed === opt.v }"
            :disabled="fx.reducedMotion.value"
            @click="fx.setParticleSpeed(opt.v)"
          >
            {{ opt.label }}
          </button>
        </span>
      </div>
      <p v-if="fx.particleAutoOff.value" class="error-text small">
        检测到帧率过低，星光拼形已因性能自动关闭；可手动重新开启。
      </p>
      <div class="dialog-actions">
        <button class="btn ghost" @click="$emit('close')">关闭</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useFxSettings } from '../composables/useFxSettings.js';

defineProps({
  visible: { type: Boolean, default: false },
});
defineEmits(['close']);

const SPEED_OPTIONS = [
  { v: 0, label: '关' },
  { v: 0.5, label: '慢' },
  { v: 1, label: '中' },
  { v: 2, label: '快' },
];

const fx = useFxSettings();
</script>
