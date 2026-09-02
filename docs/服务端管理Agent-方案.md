# 服务端 · 管理 Agent 方案

> 面向**平台所有者（服务端运营者）**：用 AI 自动完成平台管理（审核/值班/合规），你只做低频抽查。
> 设计定位：平台**不内置 AI 推理**；运营侧 AI 是一个**独立、可配置、开箱即跑**的管理 Agent 桥。
> （学习者侧 Agent 接入见《agent-接入指南》，两者通过同一"任务桥"协议、权限隔离。）

## 一、为什么是"配置"而不是"写代码"

你（一人、非技术）不需要懂后端。管理 Agent = 一个带配置文件的独立小程序：

```
你的管理 Agent 桥（外部进程，可填配置即跑）
   │ 长轮询领「管理任务」
   ├─ 投稿一审     → 读卡 + 制作规范 → 出评分卡 → 回写 approve / 打回(理由)
   ├─ 勘误判定     → 读写内容↔卡一致性 → 有效 / 无效 → 回写
   ├─ 举报初审     → 严重 → 隐藏+留档；一般 → 转社区公示 → 回写
   └─ 法定邮件     → 收信（你提供的邮箱）→ 判定 → 下架/隐藏 → 留档
   │
   ▼
 回写 POST /api/ai-tasks/:id/result  → 平台按结果执行状态机（冻结/公示/入库）
```

## 二、配置步骤（三步，均在管理面板/配置文件完成）

| 步骤 | 你做什么 | 示例 |
|---|---|---|
| 1. 选模型 | 本地 Ollama（推荐：免费/单机/隐私）或任一同类云 API（OpenAI 兼容，填 key，可离线单机） | `ollama run llama3` |
| 2. 填配置 | 复制 `config.example.json`，填：模型名、API 地址、key、`managementToken`（面板一键生成） | `{ "model":"llama3", "api":"http://localhost:11434", "managementToken":"<token>" }` |
| 3. 启动 | 一条命令或双击启动脚本 | `npm run management-ai` |

之后全自动；你仅偶尔打开**管理面板**抽查留档（只读列表：任务、结论、时间、是否人工复核）。

## 三、任务桥协议（平台 ↔ 管理 Agent）

| 项目 | 说明 |
|---|---|
| 领任务 | `GET /api/ai-tasks?role=operator&status=pending`（长轮询；需运营者 token） |
| 回写 | `POST /api/ai-tasks/:id/result`：`{ verdict, score, reason, model }` |
| 任务类型 | `card_review`(投稿一审) / `correction_review` / `report_review` / `legal_action` |
| 权限 | 运营者凭证只能领管理任务；普通用户执行者领不到 |
| 超时 | 无人接管 → 进入社区自治路径（公示/投票）或搁置提示，**不阻塞平台** |
| 留档 | 平台记录 任务/结论/模型指纹/时间；内容不预打包，Agent 按需经授权接口拉取 |

## 四、与单机 / 在线对齐

- **单机模式**：本地服务 + Ollama + 管理桥 → 你一个人全自动运营（审核/值班都归管理桥）。
- **在线模式**：多人平台 + 你的管理桥（管理）+ 各学习者自己的 Agent（普通任务）。
- 管理桥只在**你需要**时跑：不跑时平台照样运行，只是管理任务挂起等待（或转社区公示）。

## 五、边界（服务端不主动读信息）

- 平台不分析用户发布内容/帖子正文，不做画像；AI 只在**用户显式触发**（投稿/举报/@AI）时经任务桥介入。
- 管理 Agent 检查对象时，按需经授权只读接口拉取**该对象**内容，不扫描全量。
- 法定邮件由管理 Agent 收信处理，平台只记录"动作+时间+执行者"，不存原信。

## 六、实现状态（已落地第一、二、三步）

1. ✅ **任务桥基础设施**：`server/src/services/cardIngest.js`（校验/入库/投稿中心化）、`server/src/routes/aiTasks.js`（`GET /api/ai-tasks`、`GET /api/ai-tasks/:id` 读卡、`POST /api/ai-tasks/:id/result` 回写、管理员权限判定、`ai_tasks`/`card_submissions` 表）。
2. ✅ **管理 Agent 桥程序**：`tools/management-ai/`（`config.example.json` + `index.mjs`，配置即跑：登录→轮询→LLM 评分→回写）。
3. ✅ **接入审核状态机**：`POST /api/agent/cards` 现为**投稿**（校验→存待审→建 `card_review` 任务→返回 pending），**未过审不进主库**；管理桥回写 `approve` 才入库（版本号+1），`reject` 打回并留原因。
4. ⏳ **其余任务类型**（勘误/举报/法定邮件动作）：任务表与回写框架已就绪，接入具体业务入口待后续。

> 运行管理桥：`cp tools/management-ai/config.example.json tools/management-ai/config.json`（填模型/账号）→ `npm run management-ai`。
> 说明：本文件为**设计**，当前已覆盖大部分落地；任务①（本地端 agent 接入）也已落地（`/agent/course` + 《agent-接入指南》）。

