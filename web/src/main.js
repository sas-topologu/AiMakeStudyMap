import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router.js';
import { setUnauthorizedHandler } from './api/client.js';
import { useAuthStore } from './stores/auth.js';
import './style.css';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);

// API 401：清登录态并回登录页（回调方式注入，避免 client ↔ router 循环依赖）
setUnauthorizedHandler(() => {
  useAuthStore(pinia).logout();
  if (router.currentRoute.value.path !== '/login') router.push('/login');
});

app.mount('#app');
