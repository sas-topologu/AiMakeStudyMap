// 勘误提交对话框：textarea（5~2000 字）+ 提交
// 409（VALIDATION）→ 提示勿重复提交；成功 → toast「已提交，审核后将合并入主库」
<template>
  <div v-if="visible" class="overlay" @click.self="$emit('close')">
    <div class="panel dialog">
      <h3>提交勘误</h3>
      <p class="muted small">
        节点：{{ nodeTitle }}<template v-if="section"> · 段落「{{ section }}」</template>
      </p>
      <textarea
        v-model.trim="body"
        class="input"
        rows="5"
        maxlength="2000"
        placeholder="描述你发现的错误（事实错误 / 错别字 / 题目有误等），至少 5 字"
      />
      <p v-if="error" class="error-text">{{ error }}</p>
      <div class="dialog-actions">
        <button class="btn ghost" @click="$emit('close')">取消</button>
        <button class="btn primary" :disabled="body.length < 5 || busy" @click="submit">
          {{ busy ? '提交中…' : '提交勘误' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { api, getToken } from '../api/client.js';
import { useUiStore } from '../stores/ui.js';

const props = defineProps({
  visible: { type: Boolean, default: false },
  nodeId: { type: String, required: true },
  nodeTitle: { type: String, default: '' },
  section: { type: String, default: '' }, // 所在段落标题（仅展示用）
});
const emit = defineEmits(['close']);

const ui = useUiStore();
const body = ref('');
const error = ref('');
const busy = ref(false);

watch(
  () => props.visible,
  (v) => {
    if (v) {
      body.value = '';
      error.value = '';
    }
  },
);

async function submit() {
  if (!getToken()) {
    error.value = '请先登录再提交勘误';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    // 段落标题并入正文，方便审核定位
    const payload = props.section ? `【${props.section}】${body.value}` : body.value;
    await api.submitCorrection(props.nodeId, payload);
    ui.toast('已提交，审核后将合并入主库', 'success', 3200);
    emit('close');
  } catch (e) {
    error.value =
      e.status === 409 ? '你已有一条待处理的勘误，请勿重复提交' : e.message;
  } finally {
    busy.value = false;
  }
}
</script>
