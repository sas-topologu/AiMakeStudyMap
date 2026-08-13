// 登录 / 注册（同页切换）
<template>
  <div class="login-page">
    <div class="panel login-card">
      <h1 class="login-title">知识星图</h1>
      <p class="muted">知识如山，亦如星网</p>
      <div class="login-tabs">
        <button :class="{ active: mode === 'login' }" @click="mode = 'login'">登录</button>
        <button :class="{ active: mode === 'register' }" @click="mode = 'register'">注册</button>
      </div>
      <form @submit.prevent="submit">
        <input
          v-model.trim="username"
          class="input"
          placeholder="用户名（3~20 位字母、数字、下划线、中文或短横线）"
          autocomplete="username"
        />
        <input
          v-model="password"
          class="input"
          type="password"
          placeholder="密码（至少 6 位）"
          autocomplete="current-password"
        />
        <p v-if="error" class="error-text">{{ error }}</p>
        <button class="btn primary block" :disabled="loading" type="submit">
          {{ loading ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录' }}
        </button>
      </form>
      <p class="login-footer">
        <router-link to="/changelog" class="link-btn">更新日志</router-link>
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';

const auth = useAuthStore();
const router = useRouter();

const mode = ref('login');
const username = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    if (mode.value === 'login') await auth.login(username.value, password.value);
    else await auth.register(username.value, password.value);
    router.push('/');
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
</script>
