// 登录态：token（client.js 管）+ user + 跃迁额度（最近一次跃迁响应带回，本地持久化）
import { defineStore } from 'pinia';
import { api, setToken, clearToken } from '../api/client.js';

const USER_KEY = 'starmap.user';
const QUOTA_KEY = 'starmap.quota';
const ADMIN_KEY = 'starmap.is_admin';
const OWNER_KEY = 'starmap.is_owner';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: JSON.parse(localStorage.getItem(USER_KEY) || 'null'),
    quota: localStorage.getItem(QUOTA_KEY) === null ? null : Number(localStorage.getItem(QUOTA_KEY)),
    isAdmin: localStorage.getItem(ADMIN_KEY) === '1',
    isOwner: localStorage.getItem(OWNER_KEY) === '1',
    adminLevel: 0,
  }),
  getters: {
    isLoggedIn: () => Boolean(localStorage.getItem('starmap.token')),
  },
  actions: {
    async login(username, password) {
      const { token, user } = await api.login(username, password);
      this._apply(token, user);
      this.refreshQuota();
    },
    async register(username, password, email, adminKey) {
      const { token, user } = await api.register(username, password, email, adminKey);
      this._apply(token, user);
      this.refreshQuota();
    },
    _apply(token, user) {
      setToken(token);
      this.user = user;
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    },
    // 从 /api/auth/me 刷新跃迁额度与管理级别（1=库管理员 2=二级管理员 0=普通）
    async refreshQuota() {
      try {
        const { user, jumpQuota } = await api.me();
        this.setQuota(jumpQuota);
        this.isAdmin = user.is_admin === true;
        this.isOwner = user.isOwner === true;
        this.adminLevel = user.adminLevel ?? 0;
        localStorage.setItem(ADMIN_KEY, this.isAdmin ? '1' : '0');
        localStorage.setItem(OWNER_KEY, this.isOwner ? '1' : '0');
      } catch {
        /* 离线/未登录时静默 */
      }
    },
    setQuota(q) {
      this.quota = q;
      localStorage.setItem(QUOTA_KEY, String(q));
    },
    logout() {
      clearToken();
      this.user = null;
      this.quota = null;
      this.isAdmin = false;
      this.isOwner = false;
      this.adminLevel = 0;
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(QUOTA_KEY);
      localStorage.removeItem(ADMIN_KEY);
      localStorage.removeItem(OWNER_KEY);
    },
  },
});
