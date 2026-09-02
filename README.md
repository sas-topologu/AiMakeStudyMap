# 知识星图（Knowledge Starmap）

> 公益知识图谱学习平台：每个知识点是星图上的一颗星，通过前置/相关关系连成技能树式闯关学习路线。

## 这是什么

- **学习端（客户端/本地）**：Canvas 星图 + 知识卡（推演式讲解 + 题库），闯关点亮知识。
- **任意 Agent 可接入**：通过 `/api/agent/*` 接口，学习者可用自己的 AI 定制课程、补缺卡、规划路线（见 `docs/agent-接入指南.md`）。
- **社区共创**：知识卡投稿、勘误、二创、讨论、速通榜、拓荒者纪念碑。
- **服务端 AI 自治**：投稿审核、勘误、举报由「管理 Agent 桥」全自动处理（平台所有者配置后即运行，见 `docs/服务端管理Agent-方案.md`）。

## 快速开始

```bash
npm install
npm run build        # 构建前端（web/dist）
npm run import       # 内容入库
npm start            # 启动 http://localhost:3000
```

前端为构建产物 `web/dist`，由 `server` 静态托管。改后端后需重启服务。

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm test -w server` / `npm test -w web` | 后端 / 前端测试 |
| `npm run scan` | 结构健康检查（环/孤岛/空洞） |
| `npm run audit` | 知识卡规范全量审计 |
| `npm run management-ai` | 启动管理 AI 桥（配置见 `tools/management-ai/config.example.json`） |
| `npm run import` | 内容入库（自动 content_version+1） |

## 目录结构

```
web/        前端（Vue3 + Vite + Canvas 自研渲染）
server/     后端（Node + Express + SQLite）
content/    知识卡内容 + 制卡/校验/审计工具 + 制作规范
docs/       工程/维护/部署/规范/Agent接入/管理Agent方案
tools/      管理 AI 桥等
```

## 单机 / 在线

- **单机**：`npm start` 本地运行，数据在 `server/data/`，无外部依赖；连本地 Ollama + 管理桥即全自动运营。
- **在线**：部署到公网，多人共用；学习者各自的 Agent 接入。

## 内容与许可

- 知识卡制作遵循 `docs/知识卡制作规范.md`（v2.1，推演式）。
- 代码 AGPL-3.0；知识卡内容 CC BY-SA 4.0（见 `LICENSE`）。

## 社区

- [贡献指南](CONTRIBUTING.md)　[行为准则](CODE_OF_CONDUCT.md)
- 投稿/勘误/举报由管理 AI 处理；平台**不主动读取用户内容**。
- 账号注册绑定邮箱（找回密码），见 `docs/用户协议与隐私政策.md`。
