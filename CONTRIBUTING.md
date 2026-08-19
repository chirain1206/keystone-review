# 贡献指南

感谢你想为 钥石复盘 做贡献！这是一个面向魔兽世界大秘境玩家的 AI 复盘工具，欢迎以任何形式参与：报 bug、提建议、改文档、写代码。

## 参与方式

- **报告问题**：用 [bug 报告模板](https://github.com/chirain1206/keystone-review/issues/new?template=bug_report.md)，写清楚"期望行为 / 实际行为 / 复现步骤 / 环境"。
- **提功能建议**：用 [功能请求模板](https://github.com/chirain1206/keystone-review/issues/new?template=feature_request.md)。
- **改代码**：Fork 本仓库 → 开一个分支 → 改动 → 提 PR。

## 开发环境

- Node.js 24
- 安装依赖：`npm ci`
- 配置环境：`cp .env.example .env.local`（留空即可进入 mock 模式，无需真实密钥）
- 启动：`npm run dev`

## 提交前自检

```bash
npm test          # 全量测试（260 用例）
npm run lint      # ESLint
npm run build     # 生产构建（含 TypeScript 类型检查）
```

请确保以上三项全部通过再提交。

## Pull Request 规范

- 一个 PR 只做一件事（一个功能 / 一个修复）。
- PR 描述写清楚：**动机**（为什么改）、**改动**（改了什么）、**测试**（怎么验证的）。
- 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)，
  例如 `feat: ...`、`fix: ...`、`docs: ...`。
- 涉及隐私 / 安全相关的改动（解析、数据隔离、密钥处理）请特别说明。

## 代码风格

- 遵循项目现有的 ESLint 配置与 `.editorconfig`（缩进 2 空格、LF 换行、UTF-8）。
- 新功能请补测试（本项目用 Vitest）。

## 行为准则

参与本项目即表示你同意遵守 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。

再次感谢你的贡献！
