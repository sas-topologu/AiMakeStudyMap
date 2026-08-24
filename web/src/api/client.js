// API 客户端：统一 fetch 封装
// - 自动携带 JWT（localStorage）
// - 错误统一抛 { code, message, status }
// - 401 清 token 并触发 onUnauthorized 回调（由 main.js 注入跳转逻辑）
const TOKEN_KEY = 'starmap.token';

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
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('NETWORK', '无法连接服务器，请检查网络或后端是否启动');
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 非 JSON 响应 */
  }

  if (!res.ok) {
    const err = data?.error ?? {};
    if (res.status === 401) {
      clearToken();
      onUnauthorized?.();
    }
    throw new ApiError(err.code || 'UNKNOWN', err.message || `请求失败（HTTP ${res.status}）`, res.status);
  }
  return data;
}

export const api = {
  // 认证
  register: (username, password) => request('/auth/register', { method: 'POST', body: { username, password } }),
  login: (username, password) => request('/auth/login', { method: 'POST', body: { username, password } }),
  me: () => request('/auth/me'),
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
  // 管理端审核
  reviewQueue: () => request('/admin/review-queue'),
  reviewCreation: (id, action) =>
    request(`/admin/review/creations/${id}`, { method: 'POST', body: { action } }),
  // 星图分享
  shareCreate: (config) => request('/share', { method: 'POST', body: { config } }),
  shareGet: (id) => request(`/share/${encodeURIComponent(id)}`),
  // 个人数据导出（个人知识画像文档）
  profileExport: () => request('/profile/export'),
  // 勘误 / 更新日志
  submitCorrection: (nodeId, body) =>
    request(`/nodes/${encodeURIComponent(nodeId)}/corrections`, { method: 'POST', body: { body } }),
  myCorrections: () => request('/corrections/mine'),
  reviewCorrection: (id, action, note) =>
    request(`/admin/review/corrections/${id}`, { method: 'POST', body: { action, note } }),
  changelog: (limit = 20) => request(`/changelog?limit=${limit}`),
};
