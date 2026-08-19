# 发布清单：v1.0.0

> 阶段 5（发布与部署）产出 · 发布记录
> 本次发布版本：**v1.0.0**（2026-08-19，首个公开发布版本）

## 1. 版本信息

| 项 | 值 | 状态 |
| --- | --- | --- |
| 版本号 | `v1.0.0`（semver） | ✅ |
| CHANGELOG | `CHANGELOG.md` 顶部 `[1.0.0] - 2026-08-19` | ✅ |
| 许可证 | `LICENSE`（MIT） | ✅ |
| README | `README.md`（英）+ `README.zh-CN.md`（中），互含语言切换链接 | ✅ |
| 默认分支 | `main` | ✅ |

> ⚠️ **待主 Agent 处理**：`package.json` 的 `version` 当前为 `0.1.0`（create-next-app 初始值）。
> 发布前请将其改为 `1.0.0`，使"四件套"（package.json → CHANGELOG → tag → Release）完全同步。
> 本次发布材料未改动任何既有代码 / 文档（见"改动范围"）。

## 2. 发布四件套同步（顺序执行）

1. **semver**：将 `package.json` 的 `version` 改为 `1.0.0`。
2. **CHANGELOG**：确认 `CHANGELOG.md` 顶部为 `[1.0.0] - 2026-08-19`（已就绪）。
3. **commit**：提交全部发布材料（Conventional Commits，单个提交即可）：
   ```bash
   git add -A
   git commit -m "docs: 发布材料（README/CHANGELOG/LICENSE/CI/社区文件）"
   ```
4. **tag**：
   ```bash
   git tag -a v1.0.0 -m "{{PRODUCT_NAME}} v1.0.0"
   git push origin main --tags
   ```
5. **Release**（在 GitHub 网页或 CLI 创建）：
   ```bash
   gh release create v1.0.0 \
     --title "{{PRODUCT_NAME}} v1.0.0" \
     --notes "首个公开发布版本。详见 CHANGELOG.md。"
   ```

## 3. 仓库上线后必做（GitHub 设置）

- [ ] 仓库设为 **Public**，description 一句话讲清"魔兽世界大秘境 AI 复盘教练"。
- [ ] 设置 topics：`warcraft-logs`、`mythic-plus`、`world-of-warcraft`、`nextjs`、`ai`、`rag`。
- [ ] 默认分支确认 `main`。

## 4. 徽章验证清单（部署到 GitHub 后逐项 `curl -I` 验证 200）

README 徽章顺序（固定）：License / Release / CI / Last commit / Stars / Dependabot。

| # | 徽章 | 验证 URL（`curl -I` 应返回 200） | 显示值校验 |
| --- | --- | --- | --- |
| 1 | License | `https://img.shields.io/github/license/{{OWNER}}/{{REPO}}` | `MIT License` |
| 2 | Release | `https://img.shields.io/github/v/release/{{OWNER}}/{{REPO}}` | == `v1.0.0` |
| 3 | CI | `https://img.shields.io/github/actions/workflow/status/{{OWNER}}/{{REPO}}/ci.yml?branch=main` | `passing` |
| 4 | Last commit | `https://img.shields.io/github/last-commit/{{OWNER}}/{{REPO}}` | 非空日期 |
| 5 | Stars | `https://img.shields.io/github/stars/{{OWNER}}/{{REPO}}` | ≥ 0 |
| 6 | Dependabot | `https://img.shields.io/badge/Dependabot-enabled-0366d6` | `Dependabot enabled` |

**版本徽章显示值 == git tag == CHANGELOG 顶部 == Release title**，四者必须一致为 `v1.0.0`。

## 5. 发布前必检（安全）

- [ ] 零密钥、零个人路径：`git log -p --all | grep -iE 'sk-[a-z0-9]|api[_-]?key|BEGIN (RSA|OPENSSH|EC) PRIVATE'` 无命中。
- [ ] `.gitignore` 覆盖 `.env*`（保留 `.env.example`）、`/.data/`、`.data-*`、`/node_modules`、`/.next/`、`.vercel`。
- [ ] 提交信息遵循 Conventional Commits。

## 6. 部署与回滚

- **部署目标**：Vercel（一键克隆 + 按 `.env.example` 配置环境变量后部署）。
- **冒烟测试**（部署后跑一遍）：`/api/health` 返回 200；粘贴一个 WCL 链接能走通"选战斗 → 生成复盘"；
  未登录访问被正确引导到登录。
- **回滚方案**：
  - 代码回滚：`git revert <坏提交>` 或 `git reset --hard v1.0.0` 后强制推送 + 重新部署。
  - Vercel 平台回滚：在 Vercel 的 Deployments 列表里选中上一版部署 → "Promote to Production"（一键回退）。
  - 数据库：Supabase 迁移应保持向后兼容；若需回退 schema，用对应迁移的 down 脚本。
- **上线后先看三个指标**：错误率、`/api/health` 健康状态、复盘生成耗时（p95 ≤ 120s）。

## 7. 改动范围（本次发布材料）

仅**新增**以下文件，未改动任何既有代码与既有产品文档（PRD / TECH-DESIGN / 审计报告等）：

- `README.md`（英文，覆盖原 create-next-app 模板）、`README.zh-CN.md`（中文）
- `LICENSE`、`CHANGELOG.md`
- `CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、`SECURITY.md`、`SUPPORT.md`
- `.gitattributes`、`.editorconfig`
- `.github/workflows/ci.yml`、`.github/dependabot.yml`
- `.github/ISSUE_TEMPLATE/bug_report.md`、`.github/ISSUE_TEMPLATE/feature_request.md`
- `docs/RELEASE.md`（本文件）
