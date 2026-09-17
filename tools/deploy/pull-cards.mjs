// 可选：从某个「终端」拉取整份知识库（知识卡 JSON）到本地，供本地终端使用。
// 用法：node tools/deploy/pull-cards.mjs <终端地址> [目标目录]
//   例：node tools/deploy/pull-cards.mjs https://aimakestudymap.online
//       node tools/deploy/pull-cards.mjs http://127.0.0.1:3000 content/cards
// 拉取完成后执行：npm run import
// 说明：这是「可选」的来源之一——工具不依赖内置知识库，也可用 AI 制卡或其他渠道的卡。
import fs from 'node:fs';
import path from 'node:path';

const [, , urlArg, dirArg] = process.argv;
if (!urlArg) {
  console.error('用法：node tools/deploy/pull-cards.mjs <终端地址> [目标目录]');
  process.exit(1);
}
const base = urlArg.replace(/\/+$/, '');
const outDir = path.resolve(dirArg || 'content/cards');

async function main() {
  console.log(`从终端拉取知识库：${base}`);
  let data;
  try {
    const res = await fetch(`${base}/api/sync?since=0`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    console.error(`拉取失败：${e.message}`);
    process.exit(1);
  }
  const nodes = data?.nodes ?? [];
  if (!nodes.length) {
    console.error('该终端没有返回任何知识卡。');
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  let written = 0;
  for (const card of nodes) {
    if (!card?.id) continue;
    fs.writeFileSync(path.join(outDir, `${card.id}.json`), JSON.stringify(card, null, 2));
    written += 1;
  }
  console.log(`已写入 ${written} 张知识卡 → ${outDir}（内容版本 v${data.version}）`);
  console.log('下一步：npm run import');
}

main();
