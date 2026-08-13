// 动效设置（localStorage `starmap:fx`，模块级单例）
// 本阶段：transition 切换动画开关；1d 粒子速度等设置复用同一存储与本 composable
// prefers-reduced-motion: reduce → 强制关闭（无视设置）
import { reactive, ref, computed } from 'vue';

const FX_KEY = 'starmap:fx';

function load() {
  try {
    return { transition: true, particleSpeed: 1, ...JSON.parse(localStorage.getItem(FX_KEY) || '{}') };
  } catch {
    return { transition: true, particleSpeed: 1 };
  }
}

const settings = reactive(load());
const particleAutoOff = ref(false); // 性能自动降级到关闭（会话内标记，面板提示用）
const reducedMotion = ref(false);
if (typeof window !== 'undefined' && window.matchMedia) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion.value = mq.matches;
  mq.addEventListener?.('change', (e) => {
    reducedMotion.value = e.matches;
  });
}

function persist() {
  localStorage.setItem(FX_KEY, JSON.stringify(settings));
}

export function useFxSettings() {
  return {
    settings, // 原始设置（面板双向绑定用）
    reducedMotion,
    particleAutoOff,
    // 实际生效值：设置开 且 非 reduced-motion
    transitionEnabled: computed(() => settings.transition && !reducedMotion.value),
    // 粒子速度实际生效值（reduced-motion 强制 0=关）
    particleSpeedEffective: computed(() => (reducedMotion.value ? 0 : settings.particleSpeed)),
    setTransition(v) {
      settings.transition = Boolean(v);
      persist();
    },
    setParticleSpeed(v) {
      settings.particleSpeed = v;
      particleAutoOff.value = false; // 手动调整即清除自动关闭标记
      persist();
    },
    // 粒子系统性能降级到自动关闭时调用
    markParticleAutoOff() {
      settings.particleSpeed = 0;
      particleAutoOff.value = true;
      persist();
    },
  };
}
