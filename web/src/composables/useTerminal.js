// 终端指向（客户端）：客户端可指向任意「终端」（本地或云端）。
// - 默认指向「本地终端」（当前页面地址 = 你在本机启动的终端）
// - 可切换并记住历史（多终端列表）
// - 单机模式（终端在本机）下：社区类功能不可用（与模块开关联动）
// 说明：切换终端后需要重新拉取数据，调用方负责 location.reload()。
import { computed, reactive } from 'vue';
import {
  getTerminalBase,
  getTerminalDefault,
  getTerminalList,
  setTerminal as apiSetTerminal,
  resetTerminal as apiResetTerminal,
} from '../api/client.js';

// 判定是否"本机终端"（单机模式）：localhost / 127.0.0.1 / 内网地址
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'];
export function isLocalUrl(url) {
  try {
    const h = new URL(url).hostname;
    if (LOCAL_HOSTS.includes(h)) return true;
    if (/^192\.168\./.test(h) || /^10\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    if (h.endsWith('.local')) return true;
    return false;
  } catch {
    return false;
  }
}

const state = reactive({
  base: getTerminalBase(),
  list: getTerminalList(),
  defaultBase: getTerminalDefault(),
});

function sync() {
  state.base = getTerminalBase();
  state.list = getTerminalList();
}

export function useTerminal() {
  return {
    state,
    base: computed(() => state.base),
    list: computed(() => state.list),
    defaultBase: computed(() => state.defaultBase),
    isLocal: computed(() => isLocalUrl(state.base)),
    mode: computed(() => (isLocalUrl(state.base) ? 'local' : 'cloud')),
    // 切换终端（切换后需重载以重新拉取数据）
    set(url) {
      apiSetTerminal(url);
      sync();
    },
    // 恢复默认（本地终端）
    reset() {
      apiResetTerminal();
      sync();
    },
  };
}
