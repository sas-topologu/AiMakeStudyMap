# AI点星谱 · Agent 接入指南

> 面向**任意 Agent**（学习者自己的 AI / 第三方模型），通过接口使用AI点星谱定制课程、学习、补卡。
> 本项目不内置 AI 推理：所有"AI 能力"都由你（或任何想接入的 Agent）在**外部**自行发挥，平台只提供
> 客观数据与规范接口。本指南告诉你 Agent 怎么接入。

## 一、客户端 / 服务端 · 单机 / 在线

- **客户端（本地）**：学习者的AI点星谱实例。两种模式：
  - **单机模式**：本地 `npm start` 跑起来即可用，数据在本地 `server/data/`，无任何外部依赖。Agent 连 `http://localhost:3000` 即可。
  - **在线模式**：连到公网部署的实例（多人共用）。Agent 连部署地址即可。
- **服务端**：平台运营侧（审核/值班/合规），由平台所有者配置**管理 Agent**（见《服务端管理 Agent 方案》）。学习者无需关心。

> 无论单机/在线，Agent 接入方式完全一致——只是 `http://...` 地址不同。

## 二、接口清单（Agent 接入点）

| 接口 | 鉴权 | 作用 |
|---|---|---|
| `GET /api/agent/graph` | 匿名可读（带 token 标状态） | 读取全量知识图谱：节点 `{id,title,subject,difficulty,summary}` + 边 `{from,to,type}` |
| `POST /api/agent/plan` | 需登录 | 给定技能 → 返回「需要掌握」的前置链（剔除已点亮/无关 related） |
| `POST /api/agent/course` | 匿名可读 | 给定技能 → 返回**按学习顺序**的课程大纲（基础→目标，含每步状态）——Agent 定制课程用 |
| `GET /api/agent/spec` | 公开 | 返回知识卡制作规范 v2.1 + 模板骨架 |
| `POST /api/agent/cards` | 需登录 | 提交制作好的知识卡（校验并入库为星图新节点） |

**鉴权说明**：
- 读操作（graph / course / spec）匿名可用——方便任意 Agent 接入；
- 写操作（plan 需状态标注 / cards 投稿）需登录（带 `Authorization: Bearer <jwt>`）；
- 无 token 时状态一律为 `dim`（未学），`course` 仍可返回学习序列供通用学习。

## 三、定制课程（核心用法，方案乙）

Agent 拿到学习目标后，一键得到完整学习路线：

```http
POST /api/agent/course
Content-Type: application/json
（可选）Authorization: Bearer <jwt>
{ "target": "深度学习" }
```

返回（按学习顺序）：

```json
{
  "target": "ai.neural-network.basics",
  "targetTitle": "神经网络与深度学习",
  "total": 12, "remaining": 12, "mastered": 0, "progressPct": 0,
  "steps": [
    { "id": "math.number.rational", "title": "有理数", "subject": "数学",
      "difficulty": 1, "state": "open", "layer": 0 },
    { "id": "...", "...": "..." },
    { "id": "ai.neural-network.basics", "title": "神经网络与深度学习",
      "subject": "人工智能", "difficulty": 3, "state": "dim", "layer": 8 }
  ]
}
```

- `steps` 已按 `layer` 升序（基础在前、目标最后），同一层按 id 排序——Agent 可直接当作课程大纲。
- `state`：`dim`(未学) / `open`(可学) / `passed` / `lit`；`mastered`/`remaining`/`progressPct` 供 Agent 排进度。
- Agent 可据 `subject`/`difficulty` 自定义（如先学低难、跨学科提示）。

## 四、缺卡补制（技能无对应卡）

若目标没有知识卡：

```json
{ "missing": true, "query": "星核光子引擎",
  "message": "「星核光子引擎」暂未收录为知识卡。可 POST /api/agent/spec 取规范、按规范制作后 POST /api/agent/cards 提交入库，再重新定制课程。" }
```

补制流程（Agent 侧自主完成）：
1. `GET /api/agent/spec` 取制作规范 v2.1 + 模板；
2. 按规范生成知识卡 JSON（或让用户提供授权教材/论文链接）；
3. `POST /api/agent/cards`（需登录）提交，校验（schema/结构/悬空/并图）通过即入库；
4. 再次 `POST /api/agent/course` 得到完整课程。

> 规范要求：`sections` 3~6 节沿**递进主线**、`terms` 全定义、`questionBank`≥6 两题型、`version`+1、`relations` 引用已入库 id、`credibility` 与来源匹配。

## 五、进阶：结合学习状态

带 token 时 `course` 会标注该用户真实进度，Agent 据此给出"下一步学什么"：
- 找 `steps` 中第一个 `state` 为 `open` 或 `dim` 且其前置已 `passed/lit` 的节点。
- 已 `passed/lit` 的节点可跳过或作复习。

## 六、示例（curl）

```bash
# 读图谱（匿名）
curl http://localhost:3000/api/agent/graph

# 定制课程（匿名）
curl -X POST http://localhost:3000/api/agent/course \
  -H "Content-Type: application/json" -d '{"target":"深度学习"}'

# 取制作规范
curl http://localhost:3000/api/agent/spec
```

---

> 平台不做任何用户内容分析（服务端不主动读取/画像）；Agent 需要信息时经上述接口**按需拉取**即可。
