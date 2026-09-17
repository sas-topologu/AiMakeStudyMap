// 开发者模式：可调界面要素（速度 / 距离 / 字号 / 大小）+ 可关闭功能模块。
// 前端 UI 效果难以文字精确描述，需要人类实际体验后微调——此处把「距离与速度」相关的要素集中为滑扭，
// 持久化到 localStorage（`starmap:dev` / `starmap:devMode` / `starmap:features.v1`）。
import { reactive, ref } from 'vue';
import { useTerminal } from './useTerminal.js';

const DEV_KEY = 'starmap:dev.v2'; // v2：新默认基线（旧 starmap:dev 不再读取）
const MODE_KEY = 'starmap:devMode';
const FEATURE_KEY = 'starmap:features.v1';

// 默认值取近似（换算不必严格）；v2 基线由用户指定：
// 流星速度中=50px/s、流星尾巴52px、中心字体1.2×、宏观字体1.6×、节点1.3×、连线1.2×、环带1×
export const DEV_DEFAULTS = {
  meteorSpeed: 50, // 流星屏幕速度 px/s（中档）
  meteorTail: 52, // 流星尾迹长度 px
  centerFont: 1.2, // 中心视图字号倍率
  macroFont: 1.6, // 宏观视图字号倍率
  nodeSize: 1.3, // 节点大小倍率
  edgeWidth: 1.2, // 连线粗细倍率
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

// 可关闭功能模块（最小可行性）：前端按开关隐藏对应入口/效果。
// 每个模块一个 bool，持久化到 localStorage；默认全开。
export const MODULES = [
  { key: 'navigation', label: '导航', desc: '路线导航/热门路径入口' },
  { key: 'community', label: '社区', desc: '讨论/二创/分享入口' },
  { key: 'ai', label: 'AI 助手', desc: 'AI路线规划/缺卡制卡' },
  { key: 'share', label: '分享星图', desc: '分享/导出入口' },
  { key: 'timer', label: '计时', desc: '学习倒计时' },
  { key: 'meteor', label: '流星', desc: '中心视图流星特效' },
  { key: 'particles', label: '星光粒子', desc: '粒子拼形/星光标题特效' },
];

const FEATURE_ALL_ON = Object.fromEntries(MODULES.map((m) => [m.key, true]));
function loadFeatures() {
  try {
    const saved = JSON.parse(localStorage.getItem(FEATURE_KEY) || '{}');
    return { ...FEATURE_ALL_ON, ...saved };
  } catch {
    return { ...FEATURE_ALL_ON };
  }
}

const settings = reactive(load());
const devMode = ref(localStorage.getItem(MODE_KEY) === '1');
const features = reactive(loadFeatures());

// 单机模式（终端在本机）下不可用的模块：社区/分享依赖云端多人环境
export const LOCAL_UNAVAILABLE = ['community', 'share'];

function persist() {
  localStorage.setItem(DEV_KEY, JSON.stringify(settings));
}
function persistFeatures() {
  localStorage.setItem(FEATURE_KEY, JSON.stringify(features));
}

export function useDevSettings() {
  const terminal = useTerminal();
  // 最终是否启用 = 用户开关 且 （非单机模式 或 该模块在单机下可用）
  const enabled = (key) => {
    if (!features[key]) return false;
    if (terminal.isLocal.value && LOCAL_UNAVAILABLE.includes(key)) return false;
    return true;
  };
  // 该模块在当前终端模式下是否可用（供 UI 提示灰显原因）
  const available = (key) => !(terminal.isLocal.value && LOCAL_UNAVAILABLE.includes(key));

  return {
    settings,
    devMode,
    features,
    enabled,
    available,
    isLocalMode: terminal.isLocal,
    set(field, value) {
      settings[field] = value;
      persist();
    },
    toggleFeature(key) {
      features[key] = !features[key];
      persistFeatures();
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
