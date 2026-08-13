// 知识卡规范审计工具：对照《知识卡制作规范 v2.0》扫描全部（或指定）卡片
// 用法：
//   node content/tools/audit.js              全量审计（有违规退出码 1）
//   node content/tools/audit.js --file xxx  审计指定单卡
//   node content/tools/audit.js --list       仅列出问题卡概览
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(HERE, '..', 'cards');
const ASSETS_DIR = join(HERE, '..', 'assets');
const TIERS = new Set(['core', 'detail', 'extended']);
const termRefs = (text) => [...String(text).matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);

function auditCard(card, allIds) {
  const issues = [];
  const put = (cond, label) => { if (!cond) issues.push(label); };

  // 基本字段
  put(!!card.summary?.length, 'summary 缺失');
  put((card.objectives ?? []).length >= 3, `objectives <3 条（${card.objectives?.length ?? 0}）`);
  put((card.objectives ?? []).length <= 5, `objectives >5 条（${card.objectives?.length ?? 0}）`);
  put(card.difficulty >= 1 && card.difficulty <= 5, `difficulty 非法（${card.difficulty}）`);
  put(['verified', 'disputed'].includes(card.credibility), `credibility 非法（${card.credibility}）`);
  put(['自然科学', '人文科学'].includes(card.category), `category 非法（${card.category}）`);

  // sections 与 tier
  put((card.sections ?? []).length >= 4, `sections <4 节（${card.sections?.length ?? 0}）`);
  const noTier = (card.sections ?? []).filter((s) => !TIERS.has(s.tier)).map((s) => s.heading);
  put(noTier.length === 0, `${noTier.length} 节无 tier 标注（${noTier.slice(0, 3).join('、')}）`);
  put((card.sections ?? []).some((s) => s.tier === 'core'), '无 core 节');

  // 术语闭合
  const termKeys = new Set(Object.keys(card.terms ?? {}));
  const bodies = (card.sections ?? []).map((s) => s.body)
    .concat((card.examples ?? []).flatMap((e) => [e.problem, ...(e.steps ?? []), e.answer]))
    .concat([card.summary]);
  const missingTerms = [...new Set(bodies.flatMap(termRefs))].filter((t) => !termKeys.has(t));
  put(missingTerms.length === 0, `正文术语未定义：${missingTerms.slice(0, 5).join('、')}`);
  const nested = Object.values(card.terms ?? {}).flatMap(termRefs).filter((t) => !termKeys.has(t));
  put(nested.length === 0, `terms 嵌套未闭合：${nested.slice(0, 5).join('、')}`);

  // emblems
  put((card.emblems ?? []).length >= 1, '无 emblems');
  put((card.emblems ?? []).length <= 3, `emblems >3（${card.emblems?.length}）`);
  const mediaIds = new Set((card.media ?? []).map((m) => m.id));
  const badEmblem = (card.emblems ?? []).filter((e) => !['formula', 'image'].includes(e.type) || (e.type === 'image' && !mediaIds.has(e.content)));
  put(badEmblem.length === 0, `${badEmblem.length} 个 emblem 非法（类型或 image 未引用本卡 media）`);

  // 题库
  const bank = card.questionBank ?? [];
  put(bank.length >= 6, `题库 <6 题（${bank.length}）`);
  const badChoice = bank.filter((q) => q.type === 'choice' && !(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < (q.options ?? []).length));
  put(badChoice.length === 0, `${badChoice.length} 道 choice 的 answer 非法`);
  const badFill = bank.filter((q) => q.type === 'fill' && !String(q.answer ?? '').trim());
  put(badFill.length === 0, `${badFill.length} 道 fill 答案为空`);
  const badDiff = bank.filter((q) => !(q.difficulty >= 1 && q.difficulty <= 5));
  put(badDiff.length === 0, `${badDiff.length} 道题难度非法`);
  const badExp = bank.filter((q) => !q.explanation?.trim());
  put(badExp.length === 0, `${badExp.length} 道题缺 explanation`);
  put(bank.some((q) => q.difficulty <= 2), '无中低难度题（通关需至少 3 道可答）');
  put(new Set(bank.map((q) => q.type)).size >= 2, '题型 <2 种');

  // 例题与易错点
  put((card.examples ?? []).length >= 2, `例题 <2 道（${card.examples?.length ?? 0}）`);
  const badSteps = (card.examples ?? []).filter((e) => !Array.isArray(e.steps) || e.steps.length < 2 || !e.answer?.trim());
  put(badSteps.length === 0, `${badSteps.length} 道例题分步不足或缺 answer`);
  put((card.pitfalls ?? []).length >= 2, `pitfalls <2 条（${card.pitfalls?.length ?? 0}）`);

  // media
  const coreCount = (card.media ?? []).filter((m) => m.core === true).length;
  put(coreCount <= 1, `core 头图 >1（${coreCount}）`);
  const missingFile = (card.media ?? []).filter((m) => !/^https?:\/\//.test(m.src) && !existsSync(join(ASSETS_DIR, m.src)));
  put(missingFile.length === 0, `media 文件缺失：${missingFile.map((m) => m.src).join('、')}`);
  const noCaption = (card.media ?? []).filter((m) => !m.caption?.trim());
  put(noCaption.length === 0, `${noCaption.length} 个 media 缺图注`);

  // relations
  const pre = card.relations?.prerequisites ?? [];
  const rel = card.relations?.related ?? [];
  const badRef = [...pre, ...rel].filter((x) => x === card.id || !allIds.has(x));
  put(badRef.length === 0, `relations 引用无效：${badRef.join('、')}`);

  return issues;
}

const files = readdirSync(CARDS_DIR).filter((f) => f.endsWith('.json'));
const listOnly = process.argv.includes('--list');
const fileArg = process.argv.includes('--file') ? process.argv[process.argv.indexOf('--file') + 1] : null;
const targets = fileArg ? files.filter((f) => f.includes(fileArg)) : files;
if (fileArg && targets.length === 0) {
  console.error(`未找到包含 "${fileArg}" 的卡`);
  process.exit(2);
}

const allIds = new Set(files.map((f) => JSON.parse(readFileSync(join(CARDS_DIR, f), 'utf8')).id).filter(Boolean));

let problemCards = 0;
let totalIssues = 0;
for (const f of targets.sort()) {
  const card = JSON.parse(readFileSync(join(CARDS_DIR, f), 'utf8'));
  const issues = auditCard(card, allIds);
  if (!issues.length) continue;
  problemCards += 1;
  totalIssues += issues.length;
  if (listOnly) {
    console.log(`${card.id} 《${card.title}》[${card.subject}] ${issues.length} 项问题`);
  } else {
    console.log(`\n❌ ${card.id} 《${card.title}》 [${card.subject}] ${issues.length} 项问题`);
    for (const x of issues) console.log(`   - ${x}`);
  }
}
console.log(`\n===== 审计完成：${targets.length} 张卡，${problemCards} 张有问题，共 ${totalIssues} 项 =====`);
process.exit(totalIssues > 0 ? 1 : 0);
