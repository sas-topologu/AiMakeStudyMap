<template>
  <!-- 右上角：未登录显示「登录 / 注册」，已登录显示用户名与退出 -->
  <div class="topbar">
    <template v-if="auth.isLoggedIn">
      <span class="topbar-user" :title="auth.isOwner ? '库管理员' : auth.isAdmin ? '二级管理员' : '已登录'">
        {{ auth.user?.username ?? '用户' }}
        <em v-if="auth.isOwner" class="topbar-badge owner">库管理员</em>
        <em v-else-if="auth.isAdmin" class="topbar-badge">二级管理员</em>
      </span>
      <button class="btn ghost topbar-btn" @click="logout">退出</button>
    </template>
    <template v-else>
      <router-link class="btn primary topbar-btn" :to="{ path: '/login' }">登录 / 注册</router-link>
    </template>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';
import { useUiStore } from '../stores/ui.js';

const auth = useAuthStore();
const ui = useUiStore();
const router = useRouter();

function logout() {
  auth.logout();
  ui.toast('已退出登录');
  if (router.currentRoute.value.path !== '/') router.push('/');
}
</script>
