// 开发者模式：可调界面要素（速度 / 距离 / 字号 / 大小）。
// 前端 UI 效果难以文字精确描述，需要人类实际体验后微调——此处把「距离与速度」相关的要素集中为滑扭，
// 持久化到 localStorage（`starmap:dev` / `starmap:devMode`）。
import { reactive, ref } from 'vue';

const DEV_KEY = 'starmap:dev';
const MODE_KEY = 'starmap:devMode';

// 默认值取近似（换算不必严格）
export const DEV_DEFAULTS = {
  meteorSpeed: 50, // 流星屏幕速度 px/s
  meteorTail: 44, // 流星尾迹长度 px
  centerFont: 1.0, // 中心视图字号倍率
  macroFont: 1.0, // 宏观视图字号倍率
  nodeSize: 1.0, // 节点大小倍率
  edgeWidth: 1.0, // 连线粗细倍率
  ringStep: 1.0, // 环带间距倍率
};

// 流星速度换挡预设（px/s）
export const METEOR_GEARS = [
  { v: 25, label: '慢' },
  { v: 50, label: '中' },
  { v: 100, label: '快' },
];

// 滑扭定义（开发者模式面板用）
export const DEV_SLIDERS = [
  { key: 'meteorSpeed', label: '流星速度', min: 10, max: 200, step: 5, unit: 'px/s' },
  { key: 'meteorTail', label: '流星尾巴', min: 10, max: 120, step: 2, unit: 'px' },
  { key: 'centerFont', label: '中心字体', min: 0.6, max: 2.5, step: 0.05, unit: '×' },
  { key: 'macroFont', label: '宏观字体', min: 0.6, max: 2.5, step: 0.05, unit: '×' },
  { key: 'nodeSize', label: '节点大小', min: 0.5, max: 2.5, step: 0.05, unit: '×' },
  { key: 'edgeWidth', label: '连线粗细', min: 0.5, max: 2.5, step: 0.05, unit: '×' },
  { key: 'ringStep', label: '环带间距', min: 0.6, max: 2.0, step: 0.05, unit: '×' },
];

function load() {
  try {
    return { ...DEV_DEFAULTS, ...JSON.parse(localStorage.getItem(DEV_KEY) || '{}') };
  } catch {
    return { ...DEV_DEFAULTS };
  }
}

const settings = reactive(load());
const devMode = ref(localStorage.getItem(MODE_KEY) === '1');

function persist() {
  localStorage.setItem(DEV_KEY, JSON.stringify(settings));
}

export function useDevSettings() {
  return {
    settings,
    devMode,
    set(field, value) {
      settings[field] = value;
      persist();
    },
    toggleDevMode() {
      devMode.value = !devMode.value;
      localStorage.setItem(MODE_KEY, devMode.value ? '1' : '0');
    },
    reset() {
      Object.assign(settings, DEV_DEFAULTS);
      persist();
    },
  };
}
