// 智点星谱 · 库管理界面（纯静态，无构建步骤）
// 管理属于库，不属于界面 —— 个人端不再自带管理页，统一到这里。
// 功能：登录、库概览、待处理任务（通过/驳回）、投稿队列、举报、
//       二创审核（通过/拒绝）、勘误处置（采纳/驳回 + 备注）、
//       学习策略（计时/防沉迷、跃迁额度，可关）、授权密钥与允许文件格式（仅库管理员）
const TOKEN_KEY = 'starmap.admin.token';
const $ = (id) => document.getElementById(id);

const state = { user: null, tasks: [], manage: null, review: { creations: [], corrections: [] } };

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 2600);
}

const token = () => localStorage.getItem(TOKEN_KEY) || '';

async function req(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token()) headers.Authorization = `Bearer ${token()}`;
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 非 JSON */
  }
  if (!res.ok) throw new Error(data?.error?.message || `请求失败（HTTP ${res.status}）`);
  return data;
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const shortTime = (iso) => String(iso || '').replace('T', ' ').slice(0, 16);

/* ---------------- 登录 / 身份 ---------------- */

async function login() {
  $('loginErr').textContent = '';
  try {
    const { token: t } = await req('/auth/login', {
      method: 'POST',
      body: { username: $('u').value.trim(), password: $('p').value },
    });
    localStorage.setItem(TOKEN_KEY, t);
    await refreshMe();
    await refreshAll();
  } catch (e) {
    $('loginErr').textContent = e.message;
  }
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  state.user = null;
  renderAuth();
}

async function refreshMe() {
  try {
    const { user } = await req('/auth/me');
    state.user = user;
  } catch {
    state.user = null;
    localStorage.removeItem(TOKEN_KEY);
  }
}

function renderAuth() {
  const logged = Boolean(state.user);
  $('login').hidden = logged;
  $('app').hidden = !logged;
  $('btnLogout').hidden = !logged;
  if (!logged) {
    $('who').textContent = '';
    return;
  }
  const lvl = state.user.isOwner ? '库管理员' : state.user.isAdmin ? '二级管理员' : '普通用户';
  $('who').textContent = `${state.user.username} · ${lvl}`;
  $('settingsCard').hidden = !state.user.isOwner;
  $('ownerActions').hidden = state.user.isOwner;
}

/* ---------------- 库概览 ---------------- */

async function refreshInfo() {
  const info = await req('/terminal/info');
  $('info').innerHTML = `
    <div><b>库名称</b><span>${esc(info.name)}</span></div>
    <div><b>知识库版本</b><span>v${esc(info.contentVersion)}</span></div>
    <div><b>身份指纹</b><span>${esc(info.fingerprint || '—')}</span></div>
    <div><b>授权密钥</b><span>${info.hasAccessKey ? '已设置' : '未设置'}</span></div>`;
}

/* ---------------- 待处理任务 ---------------- */

const TYPE_LABEL = {
  card_review: '投稿一审',
  report_review: '举报初审',
  correction_review: '勘误审核',
  legal_action: '法定动作',
};
const SUB_STATE = {
  pending: '待审',
  ai_reviewed: '公示中',
  approved: '已过审',
  rejected: '已打回',
  reopened: '有异议',
};

async function refreshTasks() {
  const { tasks } = await req('/ai-tasks');
  state.tasks = tasks;
  $('taskCount').textContent = tasks.length ? `（${tasks.length}）` : '（无）';
  $('tasks').innerHTML = tasks.length
    ? tasks
        .map(
          (t) => `
      <div class="item">
        <span class="tag">${TYPE_LABEL[t.type] || esc(t.type)}</span>
        <span class="grow">对象：${esc(t.subjectId || '—')} · ${shortTime(t.createdAt)}</span>
        <button class="btn ghost" data-ok="${t.id}">通过</button>
        <button class="btn danger" data-no="${t.id}">驳回</button>
      </div>`
        )
        .join('')
    : '<p class="muted small">暂无待处理任务（由管理 AI 自动处理；也可在此人工审核）</p>';
}

async function submitTask(id, verdict) {
  try {
    const r = await req(`/ai-tasks/${id}/result`, { method: 'POST', body: { verdict, model: 'admin-ui' } });
    toast(`已处理：${r.status || verdict}`);
    await refreshAll();
  } catch (e) {
    toast(e.message);
  }
}

/* ---------------- 队列总览（投稿 / 举报） ---------------- */

async function refreshManage() {
  const m = await req('/ai-tasks/manage');
  state.manage = m;
  $('submissions').innerHTML = m.submissions.length
    ? m.submissions
        .map(
          (s) => `<div class="item">
        <span class="grow">${esc(s.node_id)}</span>
        <span class="tag ${s.status === 'approved' ? 'ok' : s.status === 'ai_reviewed' ? 'warn' : s.status === 'rejected' ? 'bad' : ''}">
          ${SUB_STATE[s.status] || esc(s.status)}</span>
        <span class="muted small">${shortTime(s.created_at)}</span>
      </div>`
        )
        .join('')
    : '<p class="muted small">暂无投稿</p>';

  $('reports').innerHTML = m.reports.length
    ? m.reports
        .map(
          (r) => `<div class="item">
        <span class="tag warn">举报</span>
        <span class="grow">${esc(r.target_type)} / ${esc(r.target_id)}：${esc(r.reason)}</span>
        <span class="muted small">${esc(r.verdict || r.status)}</span>
      </div>`
        )
        .join('')
    : '<p class="muted small">暂无举报</p>';
}

/* ---------------- 二创审核 / 勘误处置 ---------------- */

const CREATION_TYPE = { mindmap: '思维导图', game: '小游戏', summary: '总结图' };

async function refreshReview() {
  const q = await req('/admin/review-queue');
  state.review = { creations: q.creations || [], corrections: q.corrections || [] };

  $('creations').innerHTML = state.review.creations.length
    ? state.review.creations
        .map(
          (c) => `<div class="item col">
        <div class="grow"><b>${esc(c.title)}</b>
          <span class="tag">${esc(CREATION_TYPE[c.type] || c.type)}</span>
          <span class="muted small">${esc(c.author)} · 节点 ${esc(c.nodeId)} · ${shortTime(c.createdAt)}</span>
        </div>
        <pre class="body">${esc(String(c.content || '').slice(0, 300))}</pre>
        <div class="row">
          <button class="btn ghost" data-creation-ok="${c.id}">通过</button>
          <button class="btn danger" data-creation-no="${c.id}">拒绝</button>
        </div>
      </div>`
        )
        .join('')
    : '<p class="muted small">暂无待审核二创</p>';

  $('corrections').innerHTML = state.review.corrections.length
    ? state.review.corrections
        .map(
          (c) => `<div class="item col">
        <div class="grow"><b>${esc(c.nodeTitle)}</b>
          <span class="muted small">${esc(c.author)} · 节点 ${esc(c.nodeId)} · ${shortTime(c.createdAt)}</span>
        </div>
        <pre class="body">${esc(c.body)}</pre>
        <input class="input" data-note="${c.id}" maxlength="200" placeholder="审核备注（可选，将展示给提交者）" />
        <div class="row">
          <button class="btn ghost" data-correction-ok="${c.id}">采纳</button>
          <button class="btn danger" data-correction-no="${c.id}">驳回</button>
        </div>
      </div>`
        )
        .join('')
    : '<p class="muted small">暂无待处理勘误</p>';
}

async function reviewCreation(id, action) {
  try {
    await req(`/admin/review/creations/${id}`, { method: 'POST', body: { action } });
    toast(action === 'approve' ? '已通过' : '已拒绝');
    await refreshReview();
  } catch (e) {
    toast(e.message);
  }
}

async function reviewCorrection(id, action) {
  const note = document.querySelector(`[data-note="${id}"]`)?.value?.trim() || undefined;
  try {
    await req(`/admin/review/corrections/${id}`, { method: 'POST', body: { action, note } });
    toast(action === 'approve' ? '已采纳（待合并主库）' : '已驳回');
    await refreshReview();
  } catch (e) {
    toast(e.message);
  }
}

/* ---------------- 设置（库管理员） ---------------- */

async function refreshSettings() {
  if (!state.user?.isOwner) return;
  try {
    const k = await req('/terminal/access-key');
    $('accessKey').value = k.key || '';
    const f = await req('/terminal/formats');
    $('formats').value = (f.formats || []).join(',');
    const { policy } = await req('/terminal/policy');
    $('timerEnabled').checked = Boolean(policy.timerEnabled);
    $('dailyLimit').value = policy.dailyLimitMinutes;
    $('jumpQuotaEnabled').checked = Boolean(policy.jumpQuotaEnabled);
  } catch (e) {
    $('settingsMsg').textContent = e.message;
  }
}

async function keyAction(body) {
  try {
    const r = await req('/terminal/access-key', { method: 'POST', body });
    $('accessKey').value = r.key || '';
    toast(r.hasAccessKey ? '授权密钥已保存' : '授权密钥已清空');
  } catch (e) {
    toast(e.message);
  }
}

async function savePolicy() {
  try {
    const { policy } = await req('/terminal/policy', {
      method: 'POST',
      body: {
        timerEnabled: $('timerEnabled').checked,
        jumpQuotaEnabled: $('jumpQuotaEnabled').checked,
        dailyLimitMinutes: Number($('dailyLimit').value),
      },
    });
    $('dailyLimit').value = policy.dailyLimitMinutes;
    toast('学习策略已保存');
  } catch (e) {
    toast(e.message);
  }
}

/* ---------------- 汇总 ---------------- */

async function refreshAll() {
  if (!state.user) return;
  try {
    await Promise.all([refreshInfo(), refreshTasks(), refreshManage(), refreshReview()]);
    await refreshSettings();
  } catch (e) {
    toast(e.message);
  }
}

function bind() {
  $('btnLogin').onclick = login;
  $('p').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') login();
  });
  $('btnLogout').onclick = logout;
  $('btnRefresh').onclick = () => refreshAll().then(() => toast('已刷新'));
  $('tasks').addEventListener('click', (e) => {
    const ok = e.target.dataset?.ok;
    const no = e.target.dataset?.no;
    if (ok) submitTask(ok, 'approve');
    if (no) submitTask(no, 'reject');
  });
  $('creations').addEventListener('click', (e) => {
    const ok = e.target.dataset?.creationOk;
    const no = e.target.dataset?.creationNo;
    if (ok) reviewCreation(ok, 'approve');
    if (no) reviewCreation(no, 'reject');
  });
  $('corrections').addEventListener('click', (e) => {
    const ok = e.target.dataset?.correctionOk;
    const no = e.target.dataset?.correctionNo;
    if (ok) reviewCorrection(ok, 'approve');
    if (no) reviewCorrection(no, 'reject');
  });
  $('btnClaim').onclick = async () => {
    try {
      await req('/auth/claim-owner', { method: 'POST' });
      toast('已成为库管理员');
      await refreshMe();
      renderAuth();
      await refreshAll();
    } catch (e) {
      toast(e.message);
    }
  };
  $('btnKeySave').onclick = () => keyAction({ key: $('accessKey').value.trim() });
  $('btnKeyGen').onclick = () => keyAction({});
  $('btnKeyClear').onclick = () => keyAction({ action: 'clear' });
  $('btnFmtSave').onclick = async () => {
    try {
      const r = await req('/terminal/formats', { method: 'POST', body: { formats: $('formats').value } });
      $('formats').value = (r.formats || []).join(',');
      toast('文件格式已更新');
    } catch (e) {
      toast(e.message);
    }
  };
  $('btnPolicySave').onclick = savePolicy;
}

(async function init() {
  bind();
  await refreshMe();
  renderAuth();
  await refreshAll();
})();
