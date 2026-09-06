# 智点星谱 · 项目交接文档（AGENTS.md）

> 本文件供 AI 编码 Agent（DeepSeek Harness / Claude Code / Codex / Copilot 等）在本项目内接手开发时使用。
> 先读本文件，再读 `docs/工程规划.md`、`docs/维护手册.md`、`docs/知识卡制作规范.md`（制卡必读）。

## 1. 项目是什么

公益知识图谱学习平台「智点星谱」：节点是知识卡（一颗星），前置/相关关系连成星图（技能树式闯关学习）。前端 Canvas 星图（自研渲染器），后端 Node/Express/SQLite。

- 内容：`content/cards/*.json`（75 张卡，数理化生+计算机 6 学科，内容版本 v15）
- 运行：`http://localhost:3000`（前端为构建产物 `web/dist`，由 server 静态托管）

## 2. 技术栈与目录

- **web/**：Vue 3 + Vite + Pinia + Vue Router；Canvas 自研渲染（无图库）：
  - `src/starmap/canvasBase.js`（相机/星空基座：平移缩放旋转、`drawScreenText` 文字保持水平）
  - `renderer.js`（中心视图：四态+连线风格）、`macroRenderer.js`（一体大地图四档 LOD：星系→星团→节点）
  - `macroLayout.js`（纯函数布局：蛛网 + 圆堆积自适应，`layoutWorld`/`layoutConstellation`）
  - `particles.js`（粒子拼形）、`emblemVector.js`、`shareRenderer.js`
- **server/**：Node 24 + Express + better-sqlite3 + JWT + zod
  - `src/services/quizService.js`（闯关 pass/exam/刷题 practice）、`stateService.js`（四态）、`timerService.js`（学习倒计时）
  - `data/starmap.db`：SQLite 数据库（git 忽略，内容由 import 写入）
- **content/**：知识卡内容 + 工具
  - `schema/knowledge-card.schema.js`（zod 字段裁决）、`tools/import.js`（校验+入库）、`tools/audit.js`（规范审计）、`tools/scan.js`
  - ⚠️ `content/package.json` 是 `"type": "module"`：**content/tools 里必须用 ESM（import，不可 require/__dirname）**
- **docs/**：工程规划、维护手册、知识卡制作规范（v2.1，制卡唯一标准）

## 3. 常用命令（在项目根目录，Windows PowerShell）

```bash
npm start          # 启动服务（后台常驻，端口 3000）
npm run build      # 构建前端（web/dist）
npm test -w web    # 前端测试（当前 60）
npm test -w server # 后端测试（当前 69）
npm run import     # 内容入库（自动 content_version+1）
npm run scan       # 结构健康检查（环/孤岛/空洞）
npm run audit      # 规范全量审计（--file xxx 单卡，--list 概览）
```

**服务器重启**（改后端后必须）：

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }
npm start          # 前台验证输出，或后台运行
```

## 4. 知识卡制作流程（最高优先级遵守）

1. **推演式制作（最高原则，用户定调）**：基础内容（中小学+大学本科）必须以「推演」制作——模仿知识诞生过程，从更基础的知识一步步推演，**禁止词条式堆砌**（定义-性质清单）。每卡结构：动机问题 → 推演步骤（不跳步、每步写依据）→ 结论 → 应用。
2. 完整字段（v2.1）：id/title/subject/category/credibility/difficulty/summary/objectives/sections(tier + 节内 examples/pitfalls/tools)/terms/relations/questionBank/version。
3. 规范要点：
   - sections **3~6 节沿递进主线**（引入→原理→推导→应用→小结），多而不精要合并或拆卡
   - 例题/易错点**内嵌在所属节后**（`section.examples`/`section.pitfalls`），不在卡底堆砌
   - 有公式表的学科提供节内 `tools`（如积分表）；**公式一式一行**（前端自动居中）
   - 正文每个 `[[术语]]` 必须在 `terms` 有定义（校验强制）；`terms` 定义里可嵌套 `[[...]]`
   - questionBank ≥6 题、两题型（choice/fill）、有梯度；例题与题库不得互抄
   - emblems 1~3 个 formula 型（不引 media 最稳）；version 修改 +1
4. **流程**：新卡放 `content/staging/` → `node content/tools/import.js --dir content/staging --check --with-db server/data/starmap.db` → 移入 `content/cards/` → `npm run import` → `npm run scan` → `npm run audit`
5. **制卡坑（血泪教训）**：
   - `related` 只能引用**已入库** id（引用未来卡会校验失败）
   - 修改已入库卡时 version 必须 +1
   - JSON 文件用 LF；编辑器里 `\n` 要写成字面 `\n`（别让真实换行进 JSON 字符串）
   - 交叉学科 pre 允许（如光合作用前置化学键），但要符合学习逻辑

## 5. 前端星图约定（修改前必读）

- 布局是**纯函数 + 确定性**（`macroLayout`），加节点不加参数自动重排（圆堆积自适应）
- 相机模型：`camera={x,y,scale,rot}`，x/y 是屏幕中心的世界坐标；旋转围绕屏幕中心；**平移要补偿 rot**（`R(-rot)@(dx,dy)/scale`）
- 文字用 `drawScreenText`（世界坐标→屏幕、自动反向旋转保持水平、字号恒定）
- 连线风格（`renderer.js` EDGE_MODES）：legacy/skilltree/depth/trunk，localStorage `starmap:edgeMode`
- 中心视图/宏观视图/分享图共用 `canvasBase`；改相机数学会影响三者
- 呼吸/粒子循环是 rAF 节流，遵守 `fx.reducedMotion` 与页面可见性（`onVisibility`）

## 6. 后端约定

- 四态：`dim`(未开放)/`open`(可闯关)/`passed`(已通关)/`lit`(点亮)；闯关需学习倒计时；practice 模式不计时不落状态
- 服务架构：`app.js` 组装，`db/connection.js` 单例；服务层负责状态变更（不经路由直接改库）
- API 鉴权：JWT，`middleware/auth.js`；试卷存内存（quizService papers Map），重启即失效

## 7. 质量红线

- 每次改动后：`npm run build` + `npm test -w web` + `npm test -w server` + 相关 `npm run audit`
- 后端改动后必须重启服务并浏览器实测（Playwright）
- 浏览器验证 canvas 用像素统计（RGB 通道，canvas 不透明 alpha 恒 255；对称布局验证旋转要逐像素 diff）
- 前端/后端任何行为变化保持 git 提交习惯（提交信息中文、feat/fix/content 前缀）
