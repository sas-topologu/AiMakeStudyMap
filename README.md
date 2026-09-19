# 智点星谱（Knowledge Starmap）

> 公益知识图谱学习平台：每个知识点是星图上的一颗星，通过前置/相关关系连成技能树式闯关学习路线。

> **术语基准**：全项目只有两种东西 —— **个人端**（属于一个人的全功能学习工具）与 **群体端**（一群人共用的知识库 + 社区）。
> 客户端 / 用户端 / 前端 / 服务端 / 后台 / 本地端 / 云端 / 终端 / 单机版等旧说法一律废弃，详见 [`docs/概念模型.md`](docs/概念模型.md)。

## 这是什么

- **个人端**：Canvas 星图 + 知识卡（推演式讲解 + 题库），闯关点亮知识；**单机即全功能**，不连群体端也能用。
- **任意 Agent 可接入**：通过 `/api/agent/*` 接口，学习者可用自己的 AI 定制课程、补缺卡、规划路线（见 `docs/agent-接入指南.md`）。
- **群体端 · 社区共创**：知识卡投稿、勘误、二创、讨论、速通榜、拓荒者纪念碑。
- **群体端 · AI 自治**：投稿审核、勘误、举报由「管理 Agent 桥」全自动处理（平台所有者配置后即运行，见 `docs/群体端管理Agent-方案.md`）。

## 快速开始

```bash
npm install
npm run build        # 构建个人端界面（web/dist）
npm run import       # 内容入库
npm start            # 启动服务内核 http://localhost:3000
```

个人端界面为构建产物 `web/dist`，由服务内核托管；服务内核**只对本机**提供学习界面，公网访问只返回群体端信息与管理界面。改后端后需重启服务。

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
web/        个人端界面（Vue3 + Vite + Canvas 自研渲染）
server/     服务内核（Node + Express + SQLite）：个人端与群体端共用，归属由「库的主人」决定
content/    知识卡内容 + 制卡/校验/审计工具 + 制作规范
docs/       概念模型 / 工程 / 维护 / 部署 / 规范 / Agent 接入 / 管理 Agent 方案
tools/      管理 AI 桥等
```

## 两种运行形态

- **只有个人端**：`npm start` 本地运行，数据在 `server/data/`，无外部依赖；全部学习功能可用，社区类功能自动不可用。连本地 Ollama + 管理桥即全自动运营。
- **个人端 + 群体端**：把服务内核部署到公网当群体端，多人共用一份知识库；学习者各自的 Agent 接入。

## 内容与许可

- 知识卡制作遵循 `docs/知识卡制作规范.md`（v2.1，推演式）。
- 代码 AGPL-3.0；知识卡内容 CC BY-SA 4.0（见 `LICENSE`）。

## 社区

- [贡献指南](CONTRIBUTING.md)　[行为准则](CODE_OF_CONDUCT.md)
- 投稿/勘误/举报由管理 AI 处理；平台**不主动读取用户内容**。
- 账号注册绑定邮箱（找回密码），见 `docs/用户协议与隐私政策.md`。
