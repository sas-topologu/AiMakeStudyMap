// 二创区 Tab：approved 作品卡片 + lit 用户上传表单
// content 为 URL → 「打开」外链；JSON/文本 → 「查看」弹层
<template>
  <div>
    <section class="panel">
      <div class="discuss-head">
        <h3>二创区</h3>
        <button v-if="isLit" class="btn primary" @click="composing = !composing">
          {{ composing ? '收起' : '上传二创' }}
        </button>
        <span v-else class="muted small">点亮后可上传二创</span>
      </div>

      <div v-if="composing" class="compose">
        <select v-model="newType" class="input">
          <option value="mindmap">🧠 思维导图</option>
          <option value="game">🎮 小游戏</option>
          <option value="summary">🗺 总结图</option>
        </select>
        <input v-model.trim="newTitle" class="input" maxlength="80" placeholder="标题（≤80 字）" />
        <textarea
          v-model.trim="newContent"
          class="input"
          rows="4"
          maxlength="20000"
          placeholder="内容：可填 https:// 链接，或 JSON / 文本"
        />
        <div class="dialog-actions">
          <button class="btn ghost" @click="composing = false">取消</button>
          <button class="btn primary" :disabled="!newTitle || !newContent || busy" @click="submit">
            提交审核
          </button>
        </div>
      </div>

      <p v-if="loading" class="muted">加载中…</p>
      <p v-else-if="!creations.length" class="muted">还没有二创作品。</p>
      <div v-else class="creation-grid">
        <div v-for="c in creations" :key="c.id" class="creation-card">
          <div class="creation-head">
            <span class="creation-icon">{{ TYPE_ICON[c.type] ?? '📦' }}</span>
            <b>{{ c.title }}</b>
          </div>
          <p class="muted small">{{ TYPE_LABEL[c.type] ?? c.type }} · {{ c.author }} · {{ formatTime(c.createdAt) }}</p>
          <a v-if="isUrl(c.content)" class="link-btn" :href="c.content" target="_blank" rel="noopener">
            打开链接 ↗
          </a>
          <button v-else class="link-btn" @click="viewing = c">查看内容</button>
        </div>
      </div>
    </section>

    <!-- 内容查看弹层 -->
    <div v-if="viewing" class="overlay" @click.self="viewing = null">
      <div class="panel dialog">
        <h3>{{ TYPE_ICON[viewing.type] }} {{ viewing.title }}</h3>
        <p class="muted small">{{ viewing.author }} · {{ formatTime(viewing.createdAt) }}</p>
        <pre class="creation-content">{{ pretty(viewing.content) }}</pre>
        <div class="dialog-actions">
          <button class="btn ghost" @click="viewing = null">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { api } from '../api/client.js';
import { useUiStore } from '../stores/ui.js';
import { formatTime } from '../utils/format.js';

const TYPE_ICON = { mindmap: '🧠', game: '🎮', summary: '🗺' };
const TYPE_LABEL = { mindmap: '思维导图', game: '小游戏', summary: '总结图' };

const props = defineProps({
  nodeId: { type: String, required: true },
  state: { type: String, default: 'dim' },
});

const ui = useUiStore();
const creations = ref([]);
const loading = ref(true);
const composing = ref(false);
const newType = ref('mindmap');
const newTitle = ref('');
const newContent = ref('');
const viewing = ref(null);
const busy = ref(false);

const isLit = computed(() => props.state === 'lit');
const isUrl = (s) => /^https?:\/\//.test(s.trim());

function pretty(content) {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

async function load() {
  loading.value = true;
  try {
    const { creations: c } = await api.creations(props.nodeId);
    creations.value = c;
  } catch (e) {
    ui.toast(e.message, 'error');
  } finally {
    loading.value = false;
  }
}

async function submit() {
  busy.value = true;
  try {
    await api.uploadCreation(props.nodeId, newType.value, newTitle.value, newContent.value);
    ui.toast('已提交，审核通过后展示', 'success', 3200);
    composing.value = false;
    newTitle.value = '';
    newContent.value = '';
  } catch (e) {
    ui.toast(e.code === 'FORBIDDEN_STATE' ? '节点点亮后才可上传二创' : e.message, 'error');
  } finally {
    busy.value = false;
  }
}

watch(() => props.nodeId, load);
load();
</script>
