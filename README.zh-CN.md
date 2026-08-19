# 钥石复盘

[English](./README.md) · [中文](./README.zh-CN.md)

> 给想进步的大秘境玩家的 AI 复盘教练。粘贴 Warcraft Logs 报告链接，或上传 `WoWCombatLog.txt`，
> 选一场战斗，就能得到一份结构化 6 章复盘报告——还能针对这一场 log 继续提问。

[![License](https://img.shields.io/github/license/chirain1206/keystone-review?style=flat-square&label=License)](https://github.com/chirain1206/keystone-review/blob/main/LICENSE)
[![Release](https://img.shields.io/github/v/release/chirain1206/keystone-review?style=flat-square&label=Release)](https://github.com/chirain1206/keystone-review/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/chirain1206/keystone-review/ci.yml?style=flat-square&label=CI&branch=main)](https://github.com/chirain1206/keystone-review/actions/workflows/ci.yml)
[![Last commit](https://img.shields.io/github/last-commit/chirain1206/keystone-review?style=flat-square)](https://github.com/chirain1206/keystone-review/commits/main)
[![Stars](https://img.shields.io/github/stars/chirain1206/keystone-review?style=flat-square)](https://github.com/chirain1206/keystone-review/stargazers)
[![Dependabot](https://img.shields.io/badge/Dependabot-enabled-0366d6?style=flat-square&logo=dependabot)](https://github.com/chirain1206/keystone-review/security/dependabot)

## 这是什么

`钥石复盘` 是一款面向大秘境玩家的 AI 复盘教练，专门服务"已经能打、但卡层数 / 卡分、想更进一步"的中高端玩家。
你手里本来就有 log——它帮你把 log 变成答案：

- **我到底哪里打错了**（带时间戳和技能证据，而不是"打断不够"这种空话）。
- **哪些看着像失误、其实是高手操作**——工具能理解*战术意图*，不会因为你为了对齐易伤窗口而留爆发就误判你。
- **下一步练什么**，给出 1–3 条可以马上执行的练习。

产品首发面向中文玩家，界面和报告都是简体中文，同时支持全球服与国服 Warcraft Logs。

## 功能

- **两种方式导入日志**
  - 粘贴 Warcraft Logs 报告链接（全球服 `warcraftlogs.com` 或国服 `cn.warcraftlogs.com`）。
  - 上传 `WoWCombatLog.txt` 文件。解析**完全在浏览器本地完成**——原始文件不会上传到任何服务器。
- **6 章复盘报告**（简体中文）：总体概览 → 关键时机分析 → 与顶尖玩家对比 → 可改进点清单 → 战术意图识别 → 下一步练习建议。
- **战术意图理解**——核心特色。"看着像失误、其实是正确决策"的操作会被解释清楚，而不是被误判为失误。
- **社区知识库（RAG）**——按职业 / 专精 / 副本检索社区打法知识，让 AI 能识别那些"只有领域知识才说得通"的意图。
- **疑似高阶技巧发现**——证据链完整、但知识库解释不了的操作，会以"疑似技巧 + 证据"输出，而不是武断判失误。
- **针对 log 的问答**——对当前战斗提问，回答引用真实时间戳和技能，支持连续追问。
- **一键分享**——把报告生成公开只读链接，随时可以关闭。
- **路线指纹与对比**——从原始事件流还原战术波，对比两场 log 的路线相似度（分数 + 差异清单），并给出阵容画像。
- **多 log 挖掘工具**——喂入同一高端玩家的多份 log，以"相似条件下重复出现"为证据主动挖掘高阶技巧。
- **账号**——邮箱验证码登录（无需密码），每日免费额度，历史复盘记录。

## 快速开始（自己跑起来）

环境要求：Node.js 24。

```bash
# 1. 安装依赖
npm ci

# 2. 配置环境变量（完整清单见 .env.example）
cp .env.example .env.local

# 3. 启动开发服务器
npm run dev
```

打开 http://localhost:3000。

> 还没有密钥也没关系——所有变量留空时，应用进入 **mock 模式**：所有外部服务自动降级为本地 mock，
> 可以端到端跑通完整流程。mock 模式下登录验证码会打印在服务端控制台（`[email:mock]` 行）。

## 部署

### 一键部署到 Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/chirain1206/keystone-review)

克隆后在 Vercel 项目设置里，按 [`.env.example`](./.env.example) 配置环境变量，然后部署。

### 环境变量

每个外部服务有各自的密钥。本地开发时全部可选（留空 = mock 模式），但**生产环境必需**——生产环境缺密钥时，
应用会拒绝以 mock 降级运行（fail-fast），不会静默降级。完整注释清单见 [`.env.example`](./.env.example)：

| 变量 | 用途 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase（账号 + 数据库） |
| `RESEND_API_KEY` / `EMAIL_FROM` | 登录验证码邮件 |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | 报告生成与问答 |
| `WCL_CLIENT_ID` / `WCL_CLIENT_SECRET` | Warcraft Logs v2 API |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile（防刷验证） |
| `EMBEDDING_API_KEY` / `EMBEDDING_BASE_URL` / `EMBEDDING_MODEL` | 知识库向量嵌入 |
| `APP_URL` | 对外访问地址（生产环境必须以 `https://` 开头） |

## 隐私与合规

- **原始 log 不离开你的设备。** 上传 `WoWCombatLog.txt` 时，解析在浏览器本地完成，只把解析后的结构化结果发送到服务器，原始文件绝不上传。
- **不碰游戏账号。** 工具从不索取、收集、接触你的游戏账号密码，也没有任何代练 / 交易功能。
- **数据可删除。** 复盘记录可在历史里删除，也可申请注销账号并清除全部数据。

### 免责声明

**钥石复盘 非暴雪官方产品，与暴雪娱乐无关。** 《魔兽世界》及相关商标归其各自权利人所有。
本项目仅用于个人学习与分析，不销售任何游戏内容。应用内免责声明见 [`src/app/legal/disclaimer`](./src/app/legal/disclaimer/page.tsx)。

## 常见问题

**我的 log 会上传到你们的服务器吗？**
不会。上传的 `WoWCombatLog.txt` 在浏览器本地解析，原始文件不会离开你的设备。（通过 Warcraft Logs 链接导入的日志，由服务器从 Warcraft Logs 拉取。）

**需要注册账号吗？**
需要，用于生成复盘和保存历史。登录方式是邮箱验证码，无需设置密码，每个账号每天有少量免费额度。

**支持团本吗？**
第一版暂不支持，只做大秘境。团本分析在后续版本规划中。

**国服能用吗？**
能。同时支持 `cn.warcraftlogs.com` 链接和本地 `WoWCombatLog.txt` 上传。

**为什么有时候"看起来怪怪的"操作反而被判为正确？**
这是战术意图引擎在工作：当一个操作看着反常、但有合理解释（比如留爆发对齐易伤窗口）时，会被解释为正确决策，而不是误判为失误。

**遇到问题 / 发现 bug？**
请用 [bug 报告模板](https://github.com/chirain1206/keystone-review/issues/new?template=bug_report.md) 提 issue。

## 参与贡献

欢迎贡献，详见 [CONTRIBUTING.md](./CONTRIBUTING.md) 与 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。
安全问题请按 [SECURITY.md](./SECURITY.md) 处理。

## 许可证

[MIT](./LICENSE) © 2026 chirain1206
