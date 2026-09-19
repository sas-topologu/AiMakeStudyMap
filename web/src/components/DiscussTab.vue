// 讨论区 Tab：纪念碑（拓荒者金色卡片）+ 帖子列表 + 帖子详情（内嵌状态切换）
// 权限：dim/open 可浏览不可发言；passed+ 可发帖/回复；纪念碑留言仅拓荒者
<template>
  <div>
    <!-- 拓荒者纪念碑 -->
    <section v-if="pioneers.length" class="panel monument">
      <h3>🏆 拓荒者纪念碑</h3>
      <ul class="monument-list">
        <li v-for="p in pioneers" :key="p.username">
          <b>{{ p.username }}</b>
          <span v-if="p.message" class="monument-msg">「{{ p.message }}」</span>
          <span v-else class="muted small">（尚未留言）</span>
          <small class="muted">{{ formatTime(p.createdAt) }}</small>
        </li>
      </ul>
      <div v-if="myPioneer" class="monument-form">
        <textarea
          v-model.trim="monumentMsg"
          class="input"
          rows="2"
          maxlength="500"
          placeholder="留下你的拓荒感言（永久置顶展示，可修改）"
        />
        <button class="btn primary" :disabled="!monumentMsg || busy" @click="submitMonument">
          {{ myPioneer.message ? '修改留言' : '提交留言' }}
        </button>
      </div>
    </section>

    <!-- 帖子列表 -->
    <section v-if="!post" class="panel">
      <div class="discuss-head">
        <h3>讨论区</h3>
        <button v-if="canPost" class="btn primary" @click="composing = !composing">
          {{ composing ? '收起' : '发帖' }}
        </button>
        <span v-else class="muted small">通关后可发言</span>
      </div>

      <div v-if="composing" class="compose">
        <input v-model.trim="newTitle" class="input" maxlength="80" placeholder="标题（≤80 字）" />
        <textarea v-model.trim="newBody" class="input" rows="4" maxlength="5000" placeholder="正文…（支持 [[术语]]、**加粗**、图片）" />
        <div class="compose-tools">
          <button class="btn ghost" :disabled="busy" @click="pickFile('post')">🖼 插入图片</button>
          <span class="muted small">支持：{{ formats.join(' / ') }}</span>
        </div>
        <div class="dialog-actions">
          <button class="btn ghost" @click="composing = false">取消</button>
          <button class="btn primary" :disabled="!newTitle || !newBody || busy" @click="submitPost">
            发布
          </button>
        </div>
      </div>

      <p v-if="loading" class="muted">加载中…</p>
      <p v-else-if="!posts.length" class="muted">还没有帖子，来发第一帖吧。</p>
      <button v-for="p in posts" :key="p.id" class="post-item" @click="openPost(p.id)">
        <span class="post-badges">
          <em v-if="p.pinned" title="置顶">📌</em>
          <em v-if="p.isPioneer" class="badge-pioneer" title="拓荒者">拓荒者</em>
          <em v-if="p.authorRank" class="badge-rank" title="速通榜排名">速通#{{ p.authorRank }}</em>
        </span>
        <span class="post-main">
          <b>{{ p.title }}</b>
          <small class="muted">{{ p.excerpt }}</small>
        </span>
        <span class="post-side">
          <small>{{ p.author }}</small>
          <small class="muted">💬 {{ p.replyCount }} · {{ formatTime(p.createdAt) }}</small>
        </span>
      </button>
    </section>

    <!-- 帖子详情 -->
    <section v-else class="panel">
      <button class="link-btn" @click="backToList">← 返回列表</button>
      <h3 class="post-title">
        <em v-if="post.pinned">📌</em>
        {{ post.title }}
      </h3>
      <p class="post-meta muted small">
        {{ post.author }}
        <em v-if="post.isPioneer" class="badge-pioneer">拓荒者</em>
        <em v-if="post.authorRank" class="badge-rank">速通#{{ post.authorRank }}</em>
        · {{ formatTime(post.createdAt) }}
      </p>
      <RichText :text="post.body" class="post-body" />
      <h4>回复（{{ post.replies.length }}）</h4>
      <ul class="reply-list">
        <li v-for="r in post.replies" :key="r.id">
          <b>{{ r.author }}</b>
          <small class="muted">{{ formatTime(r.createdAt) }}</small>
          <RichText :text="r.body" class="post-body" />
        </li>
      </ul>
      <p v-if="!post.replies.length" class="muted small">还没有回复。</p>
      <div v-if="canPost" class="reply-form">
        <textarea v-model.trim="replyBody" class="input" rows="2" maxlength="5000" placeholder="写下你的回复…（支持图片）" />
        <div class="compose-tools">
          <button class="btn ghost" :disabled="busy" @click="pickFile('reply')">🖼 插入图片</button>
        </div>
        <button class="btn primary" :disabled="!replyBody || busy" @click="submitReply">回复</button>
      </div>
      <p v-else class="muted small">通关后可发言</p>
    </section>

    <!-- 文件选择（发帖/回复共用） -->
    <input ref="fileInput" type="file" class="hidden-file" @change="onFilePicked" />
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { api } from '../api/client.js';
import { useAuthStore } from '../stores/auth.js';
import { useUiStore } from '../stores/ui.js';
import { formatTime } from '../utils/format.js';
import RichText from './RichText.vue';

const props = defineProps({
  nodeId: { type: String, required: true },
  state: { type: String, default: 'dim' },
});

const auth = useAuthStore();
const ui = useUiStore();

const pioneers = ref([]);
const posts = ref([]);
const post = ref(null);
const loading = ref(true);
const composing = ref(false);
const newTitle = ref('');
const newBody = ref('');
const replyBody = ref('');
const monumentMsg = ref('');
const busy = ref(false);
const formats = ref([]);
const fileInput = ref(null);
const uploadTarget = ref('post'); // post | reply

// 允许的文件格式（库可配置）——用于提示与前置校验
async function loadFormats() {
  try {
    const { formats: list } = await api.formatsGet();
    formats.value = list || [];
  } catch {
    /* 离线时忽略 */
  }
}

function pickFile(target) {
  uploadTarget.value = target;
  fileInput.value?.click();
}

async function onFilePicked(e) {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  if (formats.value.length && !formats.value.includes(ext)) {
    ui.toast(`不允许的文件格式 .${ext}（可在库设置中放开）`, 'error');
    return;
  }
  if (f.size > 5 * 1024 * 1024) {
    ui.toast('文件过大（上限 5MB）', 'error');
    return;
  }
  busy.value = true;
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error('读取文件失败'));
      fr.readAsDataURL(f);
    });
    const { url } = await api.uploadFile(f.name, dataUrl);
    const md = `![${f.name}](${url})`;
    if (uploadTarget.value === 'reply') replyBody.value = `${replyBody.value}\n${md}`.trim();
    else newBody.value = `${newBody.value}\n${md}`.trim();
    ui.toast('图片已插入', 'success');
  } catch (err) {
    onError(err);
  } finally {
    busy.value = false;
  }
}

const canPost = computed(() => props.state === 'passed' || props.state === 'lit');
const myPioneer = computed(() =>
  pioneers.value.find((p) => p.username === auth.user?.username) ?? null,
);

function onError(e) {
  if (e.code === 'RATE_LIMITED') {
    ui.toast('当前节点讨论过热，已开启限制发言，请稍后再试', 'error', 3600);
  } else if (e.code === 'FORBIDDEN_STATE') {
    ui.toast('节点通关后才可发言', 'error');
  } else if (e.code === 'FORBIDDEN') {
    ui.toast('仅拓荒者可在纪念碑留言', 'error');
  } else {
    ui.toast(e.message, 'error');
  }
}

async function load() {
  loading.value = true;
  try {
    const [m, p] = await Promise.all([api.monument(props.nodeId), api.posts(props.nodeId)]);
    pioneers.value = m.pioneers;
    posts.value = p.posts;
    if (myPioneer.value) monumentMsg.value = myPioneer.value.message ?? '';
  } catch (e) {
    onError(e);
  } finally {
    loading.value = false;
  }
}

async function openPost(id) {
  busy.value = true;
  try {
    post.value = await api.postDetail(id);
    replyBody.value = '';
  } catch (e) {
    onError(e);
  } finally {
    busy.value = false;
  }
}

async function backToList() {
  post.value = null;
  await load(); // 回复数可能变化，刷新列表
}

async function submitPost() {
  busy.value = true;
  try {
    const { id } = await api.createPost(props.nodeId, newTitle.value, newBody.value);
    ui.toast('发布成功', 'success');
    composing.value = false;
    newTitle.value = '';
    newBody.value = '';
    await load();
    await openPost(id);
  } catch (e) {
    onError(e);
  } finally {
    busy.value = false;
  }
}

async function submitReply() {
  busy.value = true;
  try {
    await api.reply(post.value.id, replyBody.value);
    replyBody.value = '';
    await openPost(post.value.id);
  } catch (e) {
    onError(e);
  } finally {
    busy.value = false;
  }
}

async function submitMonument() {
  busy.value = true;
  try {
    await api.leaveMonument(props.nodeId, monumentMsg.value);
    ui.toast('留言已刻上纪念碑', 'success');
    await load();
  } catch (e) {
    onError(e);
  } finally {
    busy.value = false;
  }
}

watch(() => props.nodeId, () => {
  post.value = null;
  load();
});
load();
loadFormats();
</script>
