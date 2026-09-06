// 个人知识画像文档生成（纯函数，无副作用）
// 输入 GET /profile/export 的聚合数据，输出 Markdown 文档：
// - 开头「画像速览」段供 AI 快速读取（主攻学科 / 掌握度 / 学习风格 / 兴趣线索）
// - 中间为完整结构化明细（学习投入 / 逐学科掌握 / 逐节点状态 / 公开发布原文）
// - 结尾「兴趣画像」给出可进一步对话的切入点
// 全部统计由数据驱动（不依赖 LLM），确定性、可单测。

const STATE_CN = { dim: '未学习', open: '学习中', passed: '已通关', lit: '已点亮' };
const ORDER = ['lit', 'passed', 'open', 'dim'];

export function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtMinutes(sec) {
  if (sec == null || sec <= 0) return '—';
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} 分钟`;
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分钟`;
}

function bySubjectStat(nodes) {
  const map = new Map();
  for (const n of nodes) {
    const s = n.subject ?? '未分类';
    if (!map.has(s)) map.set(s, { subject: s, total: 0, dim: 0, open: 0, passed: 0, lit: 0 });
    const st = map.get(s);
    st.total += 1;
    if (n.state) st[n.state] += 1;
    else st.dim += 1;
  }
  return [...map.values()].sort((a, b) =>
    b.lit + b.passed - (a.lit + a.passed) || b.open - a.open || (a.subject < b.subject ? -1 : 1),
  );
}

function topSubjects(stat, n) {
  return stat.slice(0, n).map((s) => s.subject);
}

// 画像速览 + 兴趣画像（AI 友好，由统计数据推断）
function buildPortrait(d) {
  const stat = bySubjectStat(d.nodes);
  const total = d.nodes.length;
  const cnt = { dim: 0, open: 0, passed: 0, lit: 0 };
  for (const n of d.nodes) cnt[n.state ?? 'dim'] += 1;
  const learned = cnt.open + cnt.passed + cnt.lit;
  const mastered = cnt.passed + cnt.lit;
  const masteryPct = total ? Math.round((mastered / total) * 100) : 0;

  const daily = d.usage?.daily ?? [];
  const totalSec = daily.reduce((s, r) => s + r.seconds, 0);
  const activeDays = daily.length;
  const avgMin = activeDays ? Math.round(totalSec / 60 / activeDays) : 0;
  const spanDays = daily.length >= 2
    ? Math.round((new Date(daily[daily.length - 1].day) - new Date(daily[0].day)) / 86400000) + 1
    : daily.length;

  // 内容投入
  const contentCounts = {
    发帖: d.posts?.length ?? 0,
    回复: (d.posts?.reduce((s, p) => s + (p.replies?.length ?? 0), 0) ?? 0) + (d.replies?.length ?? 0),
    二创: d.creations?.length ?? 0,
    勘误: d.corrections?.length ?? 0,
    纪念碑: d.monument?.length ?? 0,
  };
  const contentSummary = Object.entries(contentCounts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k} ${v}`)
    .join('、') || '暂无';

  // 兴趣线索：发布内容涉及的节点标题（去重取前 12）
  const topicTitles = new Set();
  for (const p of d.posts ?? []) topicTitles.add(p.nodeTitle);
  for (const r of d.replies ?? []) topicTitles.add(r.nodeTitle);
  for (const c of d.creations ?? []) topicTitles.add(c.nodeTitle);
  for (const m of d.monument ?? []) topicTitles.add(m.nodeTitle);
  for (const c of d.corrections ?? []) topicTitles.add(c.nodeTitle);
  const topics = [...topicTitles].slice(0, 12);

  // 学习风格推断
  const pace = avgMin >= 60 ? '高强度（日均 ≥1 小时）' : avgMin >= 30 ? '稳定投入（日均 30~60 分钟）' : activeDays > 0 ? '轻量规律（日均 <30 分钟）' : '暂无计时数据';
  const breadth = new Set(d.nodes.filter((n) => n.state && n.state !== 'dim').map((n) => n.subject)).size;
  const depth = learned ? Math.round((mastered / learned) * 100) : 0;
  const focus = topSubjects(stat, 3).join('、') || '—';
  const latest = d.nodes
    .filter((n) => n.litAt || n.state === 'open')
    .sort((a, b) => (b.litAt ?? '') < (a.litAt ?? '') ? -1 : 1)[0];

  const portrait = {
    total, ...cnt, learned, mastered, masteryPct,
    totalSec, activeDays, avgMin, spanDays,
    focus, breadth, depth, pace, topics, latest,
    contentCounts, contentSummary,
  };
  return { stat, cnt, portrait };
}

export function buildProfileDoc(d) {
  const { stat, portrait: p } = buildPortrait(d);
  const L = [];
  const push = (s = '') => L.push(s);

  push(`# 个人知识画像 · ${d.user?.username ?? '用户'}`);
  push('');
  push(`> 生成时间：${fmtTime(d.generatedAt)}（智点星谱自动导出）`);
  push('> 本文档汇总用户在「智点星谱」的闯关进度、学习投入与公开发布内容，');
  push('> 供 AI 助手快速了解其知识结构、兴趣领域与学习风格，可直接作为个人助手/个性化模型的背景资料。');
  push('');
  push('---');
  push('');
  push('## 一、画像速览');
  push('');
  push(`- **学习投入**：累计 ${fmtMinutes(p.totalSec)}（${p.activeDays} 个活跃日，跨度约 ${p.spanDays} 天）`);
  push(`- **知识掌握**：共 ${p.total} 个知识节点，已开始 ${p.learned} 个（学习中 ${p.open} / 已通关 ${p.passed} / 已点亮 ${p.lit}），掌握率 ${p.masteryPct}%`);
  push(`- **主攻学科**：${p.focus}`);
  push(`- **内容贡献**：${p.contentSummary}`);
  push(`- **兴趣线索**：${p.topics.join('、') || '暂无'}`);
  push(`- **一句话画像**：${p.masteryPct >= 40 ? '深度学习者' : p.learned > 0 ? '持续探索者' : '新用户'}，${p.pace}，覆盖 ${p.breadth} 个学科，已掌握内容中通关/点亮占 ${p.depth}%。`);
  push('');

  push('## 二、学习投入');
  push('');
  push('| 指标 | 数值 |');
  push('|---|---|');
  push(`| 累计学习时长 | ${fmtMinutes(p.totalSec)} |`);
  push(`| 活跃天数 | ${p.activeDays} 天 |`);
  push(`| 日均学习 | ${p.avgMin} 分钟 |`);
  push(`| 最近活跃 | ${(d.usage?.daily ?? []).length ? (d.usage.daily[d.usage.daily.length - 1].day) : '—'} |`);
  if (p.activeDays) {
    push('');
    push('| 日期 | 时长 |');
    push('|---|---|');
    for (const r of d.usage.daily) push(`| ${r.day} | ${fmtMinutes(r.seconds)} |`);
  }
  push('');

  push('## 三、知识掌握（按学科）');
  push('');
  push('| 学科 | 总数 | 未学习 | 学习中 | 已通关 | 已点亮 |');
  push('|---|---|---|---|---|---|');
  for (const s of stat) {
    push(`| ${s.subject} | ${s.total} | ${s.dim} | ${s.open} | ${s.passed} | ${s.lit} |`);
  }
  push('');

  const masteredNodes = d.nodes.filter((n) => n.state === 'passed' || n.state === 'lit');
  const openNodes = d.nodes.filter((n) => n.state === 'open');
  push(`### 已通关 / 已点亮节点明细（${masteredNodes.length}）`);
  push('');
  if (!masteredNodes.length) {
    push('（暂无）');
  } else {
    push('| 学科 | 节点 | 难度 | 状态 | 通关用时 | 点亮时间 |');
    push('|---|---|---|---|---|---|');
    for (const n of masteredNodes) {
      push(`| ${n.subject} | ${n.title} | ${n.difficulty} | ${STATE_CN[n.state]} | ${fmtMinutes(n.passSeconds)} | ${fmtTime(n.litAt)} |`);
    }
  }
  push('');
  push(`### 学习中节点明细（${openNodes.length}）`);
  push('');
  if (!openNodes.length) {
    push('（暂无）');
  } else {
    push('| 学科 | 节点 | 难度 |');
    push('|---|---|---|');
    for (const n of openNodes) push(`| ${n.subject} | ${n.title} | ${n.difficulty} |`);
  }
  push('');

  push('## 四、公开发布内容');
  push('');
  const posts = d.posts ?? [];
  if (posts.length) {
    push(`### 讨论帖（${posts.length}）`);
    push('');
    for (const p of posts) {
      push(`#### 《${p.title}》 · ${p.nodeTitle} · ${fmtTime(p.createdAt)}`);
      push('');
      push(p.body || '（无正文）');
      push('');
      const replies = p.replies ?? [];
      if (replies.length) {
        push(`回复（${replies.length}）：`);
        push('');
        for (const r of replies) {
          push(`- ${r.isMine ? '**我**' : r.username}（${fmtTime(r.created_at)}）：${r.body}`);
        }
        push('');
      }
    }
  }
  const replies = d.replies ?? [];
  if (replies.length) {
    push(`### 我在他人帖子下的回复（${replies.length}）`);
    push('');
    for (const r of replies) {
      push(`- 《${r.post_title}》（${r.nodeTitle} · ${fmtTime(r.created_at)}）：${r.body}`);
    }
    push('');
  }
  const creations = d.creations ?? [];
  if (creations.length) {
    push(`### 二创作品（${creations.length}）`);
    push('');
    for (const c of creations) {
      push(`- **[${c.type}] ${c.title}**（${c.nodeTitle} · 状态：${c.status} · ${fmtTime(c.created_at)}）`);
      const body = c.content || '';
      push(`  ${body.length > 400 ? `${body.slice(0, 400)}…（全文 ${body.length} 字，站内可查看）` : body}`);
      push('');
    }
  }
  const monument = d.monument ?? [];
  if (monument.length) {
    push(`### 拓荒者纪念碑留言（${monument.length}）`);
    push('');
    for (const m of monument) push(`- ${m.nodeTitle}（${fmtTime(m.created_at)}）：${m.message || '（无留言）'}`);
    push('');
  }
  const corrections = d.corrections ?? [];
  if (corrections.length) {
    push(`### 勘误提交（${corrections.length}）`);
    push('');
    for (const c of corrections) push(`- ${c.nodeTitle}（${fmtTime(c.created_at)} · 状态：${c.status}）：${c.body}`);
    push('');
  }

  push('## 五、兴趣画像（AI 参考）');
  push('');
  push(`- **主攻方向**：${p.focus}`);
  push(`- **知识深度**：掌握率 ${p.masteryPct}%（已开始内容中 ${p.depth}% 通关/点亮）；学科广度 ${p.breadth} 个`);
  push(`- **学习风格**：${p.pace}；${p.breadth > 2 ? '多学科并行探索' : '专注单一主线'}`);
  push(`- **兴趣话题**：${p.topics.join('、') || '暂无公开内容线索'}`);
  if (p.latest) {
    push(`- **最新动态**：最近在学习「${p.latest.title}」（${p.latest.subject}）`);
  }
  push('');
  push('> 建议：向 AI 提问时，可从主攻学科与兴趣话题切入；上述「已掌握节点」可作为能力清单。');
  push('');

  return L.join('\n');
}
