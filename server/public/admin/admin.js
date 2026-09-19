// 智点星谱 · 终端管理界面（纯静态，无构建步骤）
// 功能：登录、终端概览、待处理任务（审核/驳回）、投稿/举报/勘误队列、授权密钥与文件格式（仅终端管理员）
const TOKEN_KEY = 'starmap.admin.token';
const $ = (id) => document.getElementById(id);

const state = { user: null, tasks: [], manage: null };

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
  const lvl = state.user.isOwner ? '终端管理员' : state.user.isAdmin ? '二级管理员' : '普通用户';
  $('who').textContent = `${state.user.username} · ${lvl}`;
  $('settingsCard').hidden = !state.user.isOwner;
  $('ownerActions').hidden = state.user.isOwner;
}

/* ---------------- 终端概览 ---------------- */

async function refreshInfo() {
  const info = await req('/terminal/info');
  $('info').innerHTML = `
    <div><b>终端名称</b><span>${info.name}</span></div>
    <div><b>知识库版本</b><span>v${info.contentVersion}</span></div>
    <div><b>身份指纹</b><span>${info.fingerprint || '—'}</span></div>
    <div><b>授权密钥</b><span>${info.hasAccessKey ? '已设置' : '未设置'}</span></div>`;
}

/* ---------------- 队列 ---------------- */

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
        <span class="tag">${TYPE_LABEL[t.type] || t.type}</span>
        <span class="grow">对象：${t.subjectId || '—'} · ${String(t.createdAt).replace('T', ' ').slice(0, 16)}</span>
        <button class="btn ghost" data-ok="${t.id}">通过</button>
        <button class="btn danger" data-no="${t.id}">驳回</button>
      </div>`
        )
        .join('')
    : '<p class="muted small">暂无待处理任务（由管理 AI 自动处理；也可在此人工审核）</p>';
}

async function refreshManage() {
  const m = await req('/ai-tasks/manage');
  state.manage = m;
  $('submissions').innerHTML = m.submissions.length
    ? m.submissions
        .map(
          (s) => `<div class="item">
        <span class="grow">${s.node_id}</span>
        <span class="tag ${s.status === 'approved' ? 'ok' : s.status === 'ai_reviewed' ? 'warn' : s.status === 'rejected' ? 'bad' : ''}">
          ${SUB_STATE[s.status] || s.status}</span>
        <span class="muted small">${String(s.created_at).replace('T', ' ').slice(0, 16)}</span>
      </div>`
        )
        .join('')
    : '<p class="muted small">暂无投稿</p>';

  $('reports').innerHTML = m.reports.length
    ? m.reports
        .map(
          (r) => `<div class="item">
        <span class="tag warn">举报</span>
        <span class="grow">${r.target_type} / ${r.target_id}：${r.reason}</span>
        <span class="muted small">${r.verdict || r.status}</span>
      </div>`
        )
        .join('')
    : '<p class="muted small">暂无举报</p>';

  $('corrections').innerHTML = m.corrections.length
    ? m.corrections
        .map(
          (c) => `<div class="item">
        <span class="tag">勘误</span>
        <span class="grow">${c.node_title}：${c.body}</span>
      </div>`
        )
        .join('')
    : '<p class="muted small">暂无待审勘误</p>';
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

/* ---------------- 设置（终端管理员） ---------------- */

async function refreshSettings() {
  if (!state.user?.isOwner) return;
  try {
    const k = await req('/terminal/access-key');
    $('accessKey').value = k.key || '';
    const f = await req('/terminal/formats');
    $('formats').value = (f.formats || []).join(',');
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

/* ---------------- 汇总 ---------------- */

async function refreshAll() {
  if (!state.user) return;
  try {
    await Promise.all([refreshInfo(), refreshTasks(), refreshManage()]);
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
  $('btnClaim').onclick = async () => {
    try {
      await req('/auth/claim-owner', { method: 'POST' });
      toast('已成为终端管理员');
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
}

(async function init() {
  bind();
  await refreshMe();
  renderAuth();
  await refreshAll();
})();
