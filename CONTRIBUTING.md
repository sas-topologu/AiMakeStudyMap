# 贡献指南（CONTRIBUTING）

感谢参与智点星谱共建。本项目以 **AI 自治 + 社区自治** 运作，贡献分为三类，全部经流程化审核，无需人工干预。

## 一、投稿知识卡（主要内容贡献）

**只接受经由 AI 制卡管线的投稿**：任何投稿都先由 AI 按《知识卡制作规范》(v2.1) 生成，再走统一审核。

1. **制作**：
   - 取规范：`GET /api/agent/spec`（返回规范 v2.1 + 模板骨架）。
   - 按规范推导式生成知识卡 JSON（3~6 节递进主线、术语全定义、题库≥6、公式一行、`relations` 引用已入库 id、`version`+1）。
   - 外部教材/论文只作**链接引用**，不入正文（`sources` 字段 + `credibility`）。
2. **投稿**：`POST /api/agent/cards`（需登录）→ 校验（schema/结构/悬空/并图）→ 存待审。
3. **审核（自动）**：
   - 管理 AI 一审 → `ai_reviewed`（公示 7 天）→ 公示期满无异议自动入库，或被第三方 AI 终审提前通过 / 社区异议打回。
   - 打回可修正后重投；本周拒次达阈值，投稿功能将临时冻结（见"功能冻结"）。
4. **入库**：过审即成为星图节点，`content_version` +1，卡内记录贡献者。

**功能冻结**：单一功能（投稿/勘误/举报/发帖）当周违规达阈值即冻结该功能，时长随次数递增（最低 2 小时），每周一零权重置。

## 二、提交代码

1. Fork + 分支；保持后端/前端测试通过：`npm test -w server`、`npm test -w web`、`npm run build`。
2. 涉及内容字段或渲染：跑 `npm run scan` + `npm run audit`。
3. 提交信息用中文、`feat|fix|content` 前缀。
4. Merge 前由 AI 自动 review；建议保留人工 merge（代码合入不追求全无人）。

## 三、社区内容

- **讨论 / 二创 / 拓荒纪念碑**：直接在对应节点发布，遵循平台行为准则（`CODE_OF_CONDUCT.md`）。
- **勘误**：`POST /api/nodes/:id/corrections` → 管理 AI 审批准/驳回。
- **举报**：对违规内容 `POST /api/reports` → 管理 AI 初审（严重即隐藏）。

## 行为规范

- 尊重他人，不发布攻击、骚扰、违法内容；禁止滥用举报/刷屏。
- 知识卡内容须客观、可溯源；未定论事项标 `disputed`。
- 违者由管理 AI 处理（隐藏/功能冻结）；争议走社区公示或复核。

## 环境

- 单机自用：`npm start` 即可，无外部依赖。
- 管理 AI 桥：`cp tools/management-ai/config.example.json tools/management-ai/config.json` 填好 → `npm run management-ai`。
