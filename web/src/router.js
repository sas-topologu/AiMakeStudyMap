import { createRouter, createWebHistory } from 'vue-router';
import LoginView from './views/LoginView.vue';
import HomeView from './views/HomeView.vue';
import NodeView from './views/NodeView.vue';
import MapView from './views/MapView.vue';
import ShareView from './views/ShareView.vue';
import PublicShareView from './views/PublicShareView.vue';
import ChangelogView from './views/ChangelogView.vue';
import { getToken } from './api/client.js';

// 设计：进入即星图（首页），**不登录也能用**（浏览星图/看知识卡/搜索/刷题）。
// 需要账号的动作（发帖/投稿/分享创作/闯关记录/管理）在各自入口提示登录。
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView, meta: { public: true } }, // 首页＝星图（免登录）
    { path: '/node/:id', name: 'node', component: NodeView, meta: { public: true } }, // 知识卡（免登录）
    { path: '/map', name: 'map', component: MapView, meta: { public: true } }, // 大地图（免登录）
    { path: '/changelog', name: 'changelog', component: ChangelogView, meta: { public: true } },
    { path: '/share/:id', name: 'share-view', component: PublicShareView, meta: { public: true } }, // 公开只读
    { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
    { path: '/share', name: 'share', component: ShareView }, // 创作页（需登录）
    // 管理不在个人端界面里：审核/设置都在库管理界面 /admin（见 docs/概念模型.md §6）
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach((to) => {
  const authed = Boolean(getToken());
  if (!to.meta.public && !authed) return { path: '/login', query: { redirect: to.fullPath } };
  if (to.path === '/login' && authed) return { path: '/' };
  return true;
});
