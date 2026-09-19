// 动效设置（localStorage `starmap:fx.v2`，模块级单例）
// 本阶段：transition 切换动画开关；1d 粒子速度等设置复用同一存储与本 composable
// prefers-reduced-motion: reduce → 强制关闭（无视设置）
// v2：星光拼形默认「快」（particleSpeed=2）
import { reactive, ref, computed } from 'vue';

const FX_KEY = 'starmap:fx.v2';

// 移动端/小屏：默认关闭星光粒子（性能优先；用户可在设置里手动打开）
function mobileLike() {
  try {
    const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
    const small = Math.min(window.innerWidth || 9999, window.innerHeight || 9999) <= 820;
    return Boolean(coarse || small);
  } catch {
    return false;
  }
}

function load() {
  const saved = localStorage.getItem(FX_KEY);
  if (saved) {
    try {
      return { transition: true, particleSpeed: 2, ...JSON.parse(saved) };
    } catch {
      /* 落回默认 */
    }
  }
  // 首次使用（无保存）：移动端默认关粒子，桌面端默认「快」
  return { transition: true, particleSpeed: mobileLike() ? 0 : 2 };
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
