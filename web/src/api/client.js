// API 封装：统一 fetch
// - 自动携带 JWT（localStorage）
// - 错误统一抛 { code, message, status }
// - 401 清 token 并触发 onUnauthorized 回调（由 main.js 注入跳转逻辑）
// - 【去中心化】数据源：个人端可指向任意数据源。默认指向「你自己的库」
//   （构建时注入 VITE_TERMINAL_URL；未注入则用当前页面地址＝部署所在的库）；可切换并记住历史。
const TOKEN_KEY = 'starmap.token';
const TERMINAL_CUR = 'starmap:terminal.current';
const TERMINAL_LIST = 'starmap:terminal.list';

// 内置默认数据源（唯一）：VITE_TERMINAL_URL > 当前页面 origin（部署在哪，库就在哪）
const DEFAULT_TERMINAL = (() => {
  try {
    return import.meta.env?.VITE_TERMINAL_URL || (typeof window !== 'undefined' ? window.location.origin : '');
  } catch {
    return typeof window !== 'undefined' ? window.location.origin : '';
  }
})();

export function getTerminalBase() {
  return localStorage.getItem(TERMINAL_CUR) || DEFAULT_TERMINAL;
}
export function getTerminalDefault() {
  return DEFAULT_TERMINAL;
}
export function getTerminalList() {
  try {
    const l = JSON.parse(localStorage.getItem(TERMINAL_LIST) || '[]');
    return Array.isArray(l) ? l.filter(Boolean) : [];
  } catch {
    return [];
  }
}
export function setTerminal(url) {
  const u = String(url || '').trim().replace(/\/+$/, '');
  if (!u) return;
  localStorage.setItem(TERMINAL_CUR, u);
  const list = getTerminalList();
  const next = [u, ...list.filter((x) => x !== u)].slice(0, 12);
  localStorage.setItem(TERMINAL_LIST, JSON.stringify(next));
}
export function resetTerminal() {
  localStorage.removeItem(TERMINAL_CUR);
}

// ---- 离线熔断：数据源不可达时进入离线态，在冷却期内"快速失败"而不再发起网络请求，
//      避免反复申请导致空转、占用计算机资源。冷却结束后自动尝试恢复一次。----
const OFFLINE_COOLDOWN_MS = 30000;
let offlineUntil = 0;
const offlineListeners = new Set();

export function isOffline() {
  return Date.now() < offlineUntil;
}
export function offlineRemainingSeconds() {
  return Math.max(0, Math.ceil((offlineUntil - Date.now()) / 1000));
}
export function onOfflineChange(cb) {
  offlineListeners.add(cb);
  return () => offlineListeners.delete(cb);
}
function setOffline(ms) {
  const was = isOffline();
  offlineUntil = ms > 0 ? Date.now() + ms : 0;
  if (was !== isOffline()) {
    for (const cb of offlineListeners) {
      try {
        cb(isOffline());
      } catch {
        /* 忽略监听器异常 */
      }
    }
  }
}
export function resetOffline() {
  setOffline(0);
}

// ---- 数据源身份指纹（防仿冒 / 防域名被夺后被替换）----
// 首次连接某数据源时记住其指纹（TOFU）；之后若指纹变化 → 说明"不是原来的库"，应拦截并提示。
const TERMINAL_FP_KEY = 'starmap:terminal.fp';
function readFpMap() {
  try {
    const m = JSON.parse(localStorage.getItem(TERMINAL_FP_KEY) || '{}');
    return m && typeof m === 'object' ? m : {};
  } catch {
    return {};
  }
}
export function getKnownFingerprint(base) {
  return readFpMap()[base] || '';
}
export function pinFingerprint(base, fp) {
  const m = readFpMap();
  m[base] = fp;
  localStorage.setItem(TERMINAL_FP_KEY, JSON.stringify(m));
}
export function forgetFingerprint(base) {
  const m = readFpMap();
  delete m[base];
  localStorage.setItem(TERMINAL_FP_KEY, JSON.stringify(m));
}

// 校验数据源身份：返回 { ok, reason?, fingerprint?, expected? }
export async function verifyTerminal(base = getTerminalBase()) {
  try {
    const res = await fetch(`${base}/api/terminal/info`, { cache: 'no-store' });
    if (!res.ok) return { ok: false, reason: 'unreachable' };
    const info = await res.json();
    const fp = info?.fingerprint || '';
    if (!fp) return { ok: true, unknown: true };
    const known = getKnownFingerprint(base);
    if (!known) {
      pinFingerprint(base, fp);
      return { ok: true, pinned: true, fingerprint: fp };
    }
    if (known !== fp) return { ok: false, reason: 'changed', expected: known, actual: fp };
    return { ok: true, fingerprint: fp };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

export class ApiError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(path, { method = 'GET', body } = {}) {
  // 离线熔断：冷却期内不发起网络请求（快速失败），避免反复申请占用资源
  if (isOffline()) {
    throw new ApiError(
      'OFFLINE',
      `离线中（数据源约 ${offlineRemainingSeconds()} 秒后自动重试）：这个操作需要联网 —— 社区、审核、云端的计时与额度都要连上库才能用；看卡、刷题、闯关仍可离线进行`,
    );
  }
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${getTerminalBase()}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    setOffline(OFFLINE_COOLDOWN_MS); // 进入离线态，暂停后续请求
    throw new ApiError('NETWORK', '无法连接数据源，已切换为离线（看卡、刷题、闯关可继续；需要联网的操作请等恢复）');
  }
  resetOffline(); // 有响应即视为可达

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 非 JSON 响应 */
  }

  if (!res.ok) {
    const err = data?.error ?? {};
    // 仅当原本有登录态时才视为"登录失效"并登出；游客（无 token）收到 401 不应被弹去登录页
    if (res.status === 401 && token) {
      clearToken();
      onUnauthorized?.();
    }
    throw new ApiError(err.code || 'UNKNOWN', err.message || `请求失败（HTTP ${res.status}）`, res.status);
  }
  return data;
}

export const api = {
  // 认证
  register: (username, password, email, adminKey) =>
    request('/auth/register', { method: 'POST', body: { username, password, email: email || undefined, adminKey: adminKey || undefined } }),
  login: (username, password) => request('/auth/login', { method: 'POST', body: { username, password } }),
  me: () => request('/auth/me'),
  // 允许的文件格式（只读：讨论区上传前校验；管理设置在库管理界面 /admin）
  formatsGet: () => request('/terminal/formats'),
  // 学习策略（计时/防沉迷、跃迁额度开关）：由库提供，个人端据此显示或隐藏入口
  policyGet: () => request('/terminal/policy'),
  uploadFile: (name, data) => request('/upload', { method: 'POST', body: { name, data } }),
  // 星图
  neighborhood: (id, depth = 2) => request(`/graph/neighborhood/${encodeURIComponent(id)}?depth=${depth}`),
  graphAll: () => request('/graph/all'),
  nodeDetail: (id) => request(`/nodes/${encodeURIComponent(id)}`),
  // 搜索 / 跃迁
  search: (q) => request(`/search?q=${encodeURIComponent(q)}`),
  jump: (nodeId) => request('/jump', { method: 'POST', body: { nodeId } }),
  // 计时
  timerStart: (minutes) => request('/timer/start', { method: 'POST', body: { minutes } }),
  timerCurrent: () => request('/timer'),
  // 闯关
  challengeStart: (nodeId, mode) =>
    request(`/nodes/${encodeURIComponent(nodeId)}/challenge/start`, { method: 'POST', body: { mode } }),
  submitPaper: (paperId, answers) =>
    request(`/papers/${encodeURIComponent(paperId)}/submit`, { method: 'POST', body: { answers } }),
  // 成果上报：离线完成的成果联网后上传（库一律接收，不盖认证章）
  achievementsUpload: (items) => request('/achievements', { method: 'POST', body: { items } }),
  // 版本同步
  metaVersion: () => request('/meta/version'),
  sync: (since) => request(`/sync?since=${since}`),
  // 导航
  navRoute: (from, to, type) =>
    request(`/nav/route?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&type=${type}`),
  navHot: () => request('/nav/hot'),
  // AI 辅助路线规划
  agentGraph: () => request('/agent/graph'),
  agentPlan: (target) => request('/agent/plan', { method: 'POST', body: { target } }),
  agentSpec: () => request('/agent/spec'),
  agentCards: (cards) => request('/agent/cards', { method: 'POST', body: { cards } }),
  mySubmissions: () => request('/agent/submissions/mine'),
  // 社交：讨论区 / 纪念碑 / 速通榜
  monument: (id) => request(`/nodes/${encodeURIComponent(id)}/monument`),
  leaveMonument: (id, message) =>
    request(`/nodes/${encodeURIComponent(id)}/monument`, { method: 'POST', body: { message } }),
  posts: (id) => request(`/nodes/${encodeURIComponent(id)}/posts`),
  createPost: (id, title, body) =>
    request(`/nodes/${encodeURIComponent(id)}/posts`, { method: 'POST', body: { title, body } }),
  postDetail: (id) => request(`/posts/${id}`),
  reply: (id, body) => request(`/posts/${id}/replies`, { method: 'POST', body: { body } }),
  speedrun: (id, limit = 50) => request(`/nodes/${encodeURIComponent(id)}/speedrun?limit=${limit}`),
  // 二创
  creations: (id) => request(`/nodes/${encodeURIComponent(id)}/creations`),
  uploadCreation: (id, type, title, content) =>
    request(`/nodes/${encodeURIComponent(id)}/creations`, { method: 'POST', body: { type, title, content } }),
  // 管理端审核置于库管理界面 /admin（管理属于库，不属于个人端界面）
  // 星图分享
  shareCreate: (config) => request('/share', { method: 'POST', body: { config } }),
  shareGet: (id) => request(`/share/${encodeURIComponent(id)}`),
  // 个人数据导出（个人知识画像文档）
  profileExport: () => request('/profile/export'),
  // 个人进度导出 / 导入（去中心化：数据可带走）
  progressExport: () => request('/profile/progress'),
  progressImport: (payload) => request('/profile/progress', { method: 'POST', body: payload }),
  // 勘误 / 更新日志
  submitCorrection: (nodeId, body) =>
    request(`/nodes/${encodeURIComponent(nodeId)}/corrections`, { method: 'POST', body: { body } }),
  myCorrections: () => request('/corrections/mine'),
  changelog: (limit = 20) => request(`/changelog?limit=${limit}`),
};
