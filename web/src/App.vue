<template>
  <NavBanner v-if="!isLoginPage" />
  <router-view />
  <Fab v-if="!isLoginPage" />
  <Toast />
</template>

<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import Fab from './components/Fab.vue';
import Toast from './components/Toast.vue';
import NavBanner from './components/NavBanner.vue';

const route = useRoute();
const isLoginPage = computed(() => route.path === '/login');
</script>
