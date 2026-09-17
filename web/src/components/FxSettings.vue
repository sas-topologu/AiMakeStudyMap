// 设置面板（Fab「⚙」打开）：动效开关、流星速度换挡、开发者模式滑扭
// 开发者模式：用滑扭微调速度/距离/字号/大小等界面要素（人类实际体验后调参）
<template>
  <div v-if="visible" class="overlay" @click.self="$emit('close')">
    <div class="panel dialog">
      <h3>设置</h3>

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

      <!-- 星光拼形粒子：四档速度 -->
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

      <!-- 流星速度换挡（快捷按钮） -->
      <div class="fx-row">
        <span>
          <b>流星速度</b>
          <small class="muted">中心视图左右区相关节点流星的快慢</small>
        </span>
        <span class="mode-segment fx-segment">
          <button
            v-for="g in METEOR_GEARS"
            :key="g.v"
            :class="{ active: dev.settings.meteorSpeed === g.v }"
            @click="dev.set('meteorSpeed', g.v)"
          >
            {{ g.label }}
          </button>
        </span>
      </div>

      <p v-if="fx.reducedMotion.value" class="muted small">
        系统已开启「减少动态效果」（prefers-reduced-motion），动画已强制关闭。
      </p>

      <!-- 开发者模式 -->
      <div class="fx-row">
        <span>
          <b>开发者模式</b>
          <small class="muted">用滑扭微调字体、节点、距离、速度等界面要素</small>
        </span>
        <button class="chip" :class="{ active: dev.devMode.value }" @click="dev.toggleDevMode()">
          {{ dev.devMode.value ? '已开启' : '开启' }}
        </button>
      </div>

      <div v-if="dev.devMode.value" class="dev-sliders">
        <label v-for="s in DEV_SLIDERS" :key="s.key" class="dev-row">
          <span class="dev-label">
            {{ s.label }}
            <small class="muted">{{ formatVal(s) }}{{ s.unit }}</small>
          </span>
          <input
            type="range"
            :min="s.min"
            :max="s.max"
            :step="s.step"
            :value="dev.settings[s.key]"
            @input="dev.set(s.key, Number($event.target.value))"
          />
        </label>
        <button class="btn ghost block" @click="dev.reset()">恢复默认</button>
      </div>

      <!-- 终端指向（客户端可指向任意终端：本地/云端） -->
      <div class="fx-row fx-col">
        <span>
          <b>终端</b>
          <small class="muted">
            当前：{{ termBase }}（{{ termIsLocal ? '单机模式' : '云端模式' }}）
          </small>
        </span>
        <div class="fx-terminal">
          <input v-model.trim="termInput" class="input" placeholder="终端地址，如 https://example.com" />
          <button class="btn ghost" :disabled="!termInput" @click="switchTerminal()">切换</button>
        </div>
        <div v-if="termList.length" class="fx-terminal-list">
          <button
            v-for="u in termList"
            :key="u"
            class="chip"
            :class="{ active: u === termBase }"
            @click="switchTerminal(u)"
          >
            {{ u }}
          </button>
        </div>
        <button
          v-if="termBase !== termDefault"
          class="btn ghost block"
          @click="resetTerminal"
        >
          恢复默认（本地终端）
        </button>
        <small class="muted">
          单机模式（终端在本机）下，社区/分享类功能不可用；切换终端后会重新加载。
        </small>
      </div>

      <!-- 功能模块开关（最小可行性：可关闭模块） -->
      <div class="fx-row fx-col">
        <span>
          <b>功能模块</b>
          <small class="muted">关闭后对应入口/效果隐藏（默认全开）</small>
        </span>
        <label
          v-for="m in MODULES"
          :key="m.key"
          class="fx-module"
          :class="{ off: !dev.available(m.key) }"
        >
          <span>
            {{ m.label }}
            <small class="muted">{{ dev.available(m.key) ? m.desc : '单机模式不可用（连云端终端后可用）' }}</small>
          </span>
          <input
            type="checkbox"
            :checked="dev.features[m.key]"
            :disabled="!dev.available(m.key)"
            @change="dev.toggleFeature(m.key)"
          />
        </label>
      </div>

      <div class="dialog-actions">
        <button class="btn ghost" @click="$emit('close')">关闭</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useFxSettings } from '../composables/useFxSettings.js';
import { useDevSettings, METEOR_GEARS, DEV_SLIDERS, MODULES } from '../composables/useDevSettings.js';
import { useTerminal } from '../composables/useTerminal.js';

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
const dev = useDevSettings();

// 终端指向
const term = useTerminal();
const termBase = term.base;
const termList = term.list;
const termIsLocal = term.isLocal;
const termDefault = term.defaultBase;
const termInput = ref('');

function switchTerminal(url) {
  const u = url || termInput.value;
  if (!u) return;
  term.set(u);
  // 切换后重新拉取该终端的数据
  location.reload();
}
function resetTerminal() {
  term.reset();
  location.reload();
}

function formatVal(s) {
  const v = dev.settings[s.key];
  return Number.isInteger(v) ? v : v.toFixed(2);
}
</script>
