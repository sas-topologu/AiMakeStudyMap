// 群体端管理 Agent 桥：平台所有者的"运营 AI"。配置即跑，全自动接管群体端管理任务。
// - 登录平台（管理员账号）获得凭证
// - 轮询 /api/ai-tasks 领「管理任务」（投稿一审 / 勘误 / 举报 / 法定动作）
// - 对 card_review：读投稿卡 → 用 LLM 按制作规范评分 → 回写 approve/reject
// - 其余类型：调用 LLM 判定 → 回写结论（平台执行留档/隐藏）
// 用 Node 18+ 运行（内置 fetch）。复制 config.example.json → config.json 填好即可。
//
// 需要先启动平台（npm start），且用管理员账号（首个注册用户即为管理员）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

const { baseUrl, username, password, model, api, key, intervalMs = 5000, maxRounds = 0 } = CONFIG;

let token = null;
let rounds = 0;

async function req(method, urlPath, body, headers = {}) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${urlPath} -> ${res.status}: ${text}`);
  return data;
}

async function login() {
  const { token: t } = await req('POST', '/api/auth/login', { username, password });
  token = t;
  console.log(`[bridge] 已登录 ${username}`);
}

// 调用 LLM（OpenAI 兼容 /chat/completions；Ollama 也兼容）
async function callLLM(system, user) {
  const res = await fetch(api, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.1,
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json?.choices?.[0]?.message?.content ?? '';
}

const SPEC = `你是知识星图的卡片审核员。严格按以下规范判定一张知识卡是否合格，只回答 JSON：
{"verdict":"approve"|"reject","score":1-5,"reason":"一句话结论：不合格指出具体缺失","fits":["符合点..."]}
规范要点：①推演式主线（动机→推导→结论→应用，不跳步，禁止词条堆砌）②sections 3~6 节带 tier ③节内嵌例题/易错/工具表 ④[[术语]]全定义 ⑤题库≥6、两题型、有梯度、不抄例题 ⑥公式一行 ⑦credibility 与来源匹配。
score 4 及以上 approve；低于 4 reject。只输出那个 JSON 对象，不要多余文字。`;

async function reviewCard(task) {
  const detail = await req('GET', `/api/ai-tasks/${task.id}`);
  if (!detail.card) return;
  const out = await callLLM(SPEC, `知识卡：\n${JSON.stringify(detail.card, null, 2)}\n\n请判定。`);
  let parsed = null;
  try { parsed = JSON.parse(out.replace(/```/g, '').trim()); } catch { parsed = null; }
  const verdict = parsed?.verdict === 'approve' ? 'approve' : 'reject';
  const body = { verdict, score: parsed?.score, reason: parsed?.reason || 'AI 审核', model };
  const result = await req('POST', `/api/ai-tasks/${task.id}/result`, body);
  console.log(`[bridge] 审核 ${task.id} (${task.type} ${task.subjectId}) -> ${verdict}（${parsed?.score ?? '-'} 分）${result.ok ? '' : ' 回写失败'}`);
}

async function handle(task) {
  if (task.type === 'card_review') return reviewCard(task);
  // 其他管理任务（correction/report/legal）：让 LLM 给结论，平台执行
  const out = await callLLM(
    '你是平台管理员助手，根据任务类型对给定内容给处置结论。只回复 JSON：{"action":"ok"|"remove"|"flag","reason":"..."}',
    `任务类型：${task.type}；对象id：${task.subjectId}；请输出处置 JSON。`,
  );
  let a = null;
  try { a = JSON.parse(out.replace(/```/g, '').trim()); } catch { a = null; }
  await req('POST', `/api/ai-tasks/${task.id}/result`, { verdict: a?.action || 'done', reason: a?.reason || '', model });
  console.log(`[bridge] 处理 ${task.type} ${task.subjectId} -> ${a?.action ?? 'done'}`);
}

async function loop() {
  try {
    // 先推进「公示到期」的投稿自动通过（一审 approve 后卡进公示，期满无异议入库）
    try {
      const s = await req('POST', '/api/ai-tasks/settle-expired', {});
      if (s?.settled?.length) console.log(`[bridge] 公示到期自动通过 ${s.settled.length} 张`);
    } catch { /* 无需处理 */ }
    const { tasks } = await req('GET', '/api/ai-tasks?role=operator');
    if (tasks.length) {
      console.log(`[bridge] 领取 ${tasks.length} 个任务`);
      for (const t of tasks) {
        try { await handle(t); } catch (e) { console.error(`[bridge] 处理 ${t.id} 出错：${e.message}`); }
      }
    }
  } catch (e) {
    console.error(`[bridge] 轮询出错：${e.message}`);
  }
}

(async () => {
  await login();
  console.log(`[bridge] 运行中，模型 ${model}，每 ${intervalMs}ms 轮询（Ctrl+C 退出）`);
  for (;;) {
    if (maxRounds && rounds++ >= maxRounds) break;
    await loop();
    await new Promise((r) => setTimeout(r, intervalMs));
  }
})();
