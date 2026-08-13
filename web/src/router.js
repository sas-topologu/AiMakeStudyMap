import { createRouter, createWebHistory } from 'vue-router';
import LoginView from './views/LoginView.vue';
import HomeView from './views/HomeView.vue';
import NodeView from './views/NodeView.vue';
import MapView from './views/MapView.vue';
import ShareView from './views/ShareView.vue';
import PublicShareView from './views/PublicShareView.vue';
import AdminView from './views/AdminView.vue';
import ChangelogView from './views/ChangelogView.vue';
import { getToken } from './api/client.js';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
    { path: '/', name: 'home', component: HomeView },
    { path: '/node/:id', name: 'node', component: NodeView },
    { path: '/map', name: 'map', component: MapView },
    { path: '/share', name: 'share', component: ShareView }, // 创作页（需登录）
    { path: '/share/:id', name: 'share-view', component: PublicShareView, meta: { public: true } }, // 公开只读
    { path: '/admin', name: 'admin', component: AdminView, meta: { admin: true } },
    { path: '/changelog', name: 'changelog', component: ChangelogView, meta: { public: true } }, // 公开
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach((to) => {
  const authed = Boolean(getToken());
  if (!to.meta.public && !authed) return { path: '/login' };
  if (to.path === '/login' && authed) return { path: '/' };
  // 管理页：仅 is_admin（标记由 auth store 从 /api/auth/me 刷新）
  if (to.meta.admin && localStorage.getItem('starmap.is_admin') !== '1') return { path: '/' };
  return true;
});
