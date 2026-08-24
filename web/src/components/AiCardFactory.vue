<script setup>
import { ref } from 'vue';
import { api } from '../api/client.js';
import { useUiStore } from '../stores/ui.js';

const props = defineProps({
  query: { type: String, required: true }, // 缺卡的技能关键词
});
const emit = defineEmits(['close', 'imported']);

const ui = useUiStore();
const loading = ref(false);
const spec = ref(null); // { version, spec, template }
const specError = ref('');
const cardJson = ref('');
const submitting = ref(false);
const submitError = ref('');

// 获取制作资料：规范文本 + 模板骨架，展示供用户复制给个人 AI
async function fetchSpec() {
  if (loading.value) return;
  loading.value = true;
  specError.value = '';
  try {
    spec.value = await api.agentSpec();
  } catch (e) {
    specError.value = e.message;
  } finally {
    loading.value = false;
  }
}

function parseCards() {
  const text = cardJson.value.trim();
  if (!text) throw new Error('请粘贴制作好的知识卡 JSON');
  const parsed = JSON.parse(text);
  const cards = Array.isArray(parsed) ? parsed : [parsed];
  if (!cards.length) throw new Error('没有卡片');
  return cards;
}

async function submit() {
  let cards;
  try {
    cards = parseCards();
  } catch (e) {
    submitError.value = e.message;
    return;
  }
  submitting.value = true;
  submitError.value = '';
  try {
    const r = await api.agentCards(cards);
    ui.toast(
      `入库成功：新增 ${r.created?.length ?? 0} / 更新 ${r.updated?.length ?? 0} 张，内容版本 ${r.newContentVersion}`,
      'success',
    );
    emit('imported');
  } catch (e) {
    submitError.value = e.message;
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="ai-card-factory">
    <div class="ai-factory-head">
      <b>「{{ query }}」暂未收录</b>
      <span class="muted">可由你的个人 AI 按规范制作，制作完成提交入库即成为星图新节点</span>
      <span class="toolbar-spacer" />
      <button class="icon-btn" title="关闭" @click="$emit('close')">✕</button>
    </div>
    <p v-if="specError" class="error-text">{{ specError }}</p>
    <div class="ai-plan-row">
      <button
        v-if="!spec"
        class="btn primary"
        :disabled="loading"
        @click="fetchSpec"
      >
        {{ loading ? '获取中…' : '获取制作资料' }}
      </button>
      <span class="muted">将制作规范交给个人 AI，由其按规范制作知识卡</span>
    </div>

    <!-- 制作规范 + 模板（供复制给个人 AI） -->
    <details v-if="spec" class="ai-spec">
      <summary>制作规范 v{{ spec.version }}（点开查看 / 复制）</summary>
      <pre class="ai-spec-text">{{ spec.spec }}</pre>
      <div class="ai-tpl">
        <b>模板骨架（JSON）：</b>
        <pre class="ai-spec-text">{{ JSON.stringify(spec.template, null, 2) }}</pre>
      </div>
      <p class="muted ai-spec-note">{{ spec.note }}</p>
    </details>

    <!-- 提交制作好的卡 -->
    <div class="ai-submit">
      <div class="dialog-actions left">
        <span class="muted">制作完成粘贴卡 JSON（单卡或数组）</span>
      </div>
      <textarea
        v-model="cardJson"
        class="input ai-card-input"
        placeholder='例如：[{"id":"math.new.topic","title":"…",...}]'
        spellcheck="false"
      />
      <p v-if="submitError" class="error-text">{{ submitError }}</p>
      <div class="dialog-actions left">
        <button class="btn ghost" @click="$emit('close')">取消</button>
        <button class="btn primary" :disabled="submitting" @click="submit">
          {{ submitting ? '提交中…' : '提交入库' }}
        </button>
      </div>
    </div>
  </div>
</template>
