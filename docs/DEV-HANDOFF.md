# 开发交接说明（给开发窗口用）

> 由虚拟产品团队主 Agent 撰写，供"开发窗口"（另一个会话/插件）接手开发。
> 完成后请回到原窗口（虚拟产品团队）做 QA 验收与安全审计。

## 一、项目位置与规则

- **工作目录：项目目录**（必须使用该目录，产品文档都在 `docs/` 下，代码仓库也在该目录）
- 开发期间原窗口不会动这个目录，请放心工作。
- **禁止修改 `docs/` 下的任何文档**（那是产品档案）。
- 代码提交信息遵循 Conventional Commits（feat/fix/docs/test/chore）。
- 密钥绝不进代码和仓库（全部走 `.env.local`，不提交；`node_modules`、`.next` 等生成物进 `.gitignore`）。
- 用 git 管理代码（`git init` 若未初始化则初始化，每个任务完成后 commit）。

## 二、先读这些图纸（按顺序）

1. `docs/PRD.md` —— 需求说明书：11 条功能需求（FR-1~FR-11），每条带 Given-When-Then 验收标准。**本轮新增 FR-11（社区打法知识库 RAG）**。
2. `docs/TECH-DESIGN.md` —— 技术设计：技术选型（Next.js App Router + TypeScript + Vercel Hobby + Supabase 免费层 + DeepSeek 流式 + 自研浏览器端 log 解析器 + Resend 邮件 + Turnstile + **Supabase pgvector + SiliconFlow bge-m3**）、系统架构、数据模型、接口契约、失败场景、成本模型。**本轮新增 ADR-002（RAG 完整方案）**。
3. `docs/tasks.md` —— 任务清单：T1~T18 共 18 个任务、5 个批次，每个任务带验收标准与依赖关系。**本轮只做批次 5（T14–T18）**。
4. `docs/rag-community-knowledge-feasibility.md` —— RAG 调研报告（当前版本、攻略源优先级、存储与嵌入选型依据，必读）。

## 三、开发任务总览（详见 docs/tasks.md）

- **批次 1（地基）**：T1 脚手架（Next.js+TS 仓库、git、/api/health）；T2 数据模型+RLS（SQL 迁移）；T3 账号体系（Supabase passwordless 邮箱验证码 + Resend，登录/登出/频控）；T4 浏览器端日志解析器 + FR-10 预处理（Web Worker 分块解析 WoWCombatLog.txt，产出结构化 JSON ≤50K token/场，原始文件不上传）
- **批次 2（核心闭环）**：T5 复盘生成管线（6 章并行流式 SSE、章节独立存储、幂等、断点重试、每章输出 ≤1800 token、DeepSeek 上下文缓存）；T6 战术意图识别专项（FR-5：先查战术合理性再下结论，样例集 ≥10 案例 + 评测脚本）；T7 对话问答（FR-6：流式、10 轮上限、违规拒绝、证据标注）
- **批次 3（数据接入与防护）**：T8 WCL 链接接入（WCL v2 API 元数据 + 对比基准，失败降级）；T9 额度与防滥用（每账号每日 3 次、按用户时区、Turnstile、频控）
- **批次 4（外围与收尾）**：T10 历史记录（列表/详情/删除级联）；T11 一键分享（128-bit token、只读公开页、可关闭）；T12 前端界面整合（首页/战斗选择/报告页/问答框/我的复盘/登录/分享页/隐私政策+免责声明页，响应式）；T13 安全与合规加固（HTTPS、鉴权与数据隔离、结构化数据 token 预算服务端再校验、"非暴雪官方"声明）
- **批次 5（RAG 社区知识库，本轮开发范围）**：T14 知识库数据模型与 pgvector 检索（迁移 0003 + 余弦相似度函数 + Repo/mock）；T15 嵌入服务与入库管线（SiliconFlow bge-m3 适配器 + ingest-kb.mjs 幂等入库 + kb/sources/ 骨架）；T16 分析时检索注入（top-k≤5、"社区攻略参考"定界 + 来源标注 + 降级）；T17 FR-11 评测样例扩展（≥5 个知识依赖型意图案例 + 双模式评测）；T18 初始知识库内容（3 个主流专精 × ≥10 条，带 patch=12.1 与出处链接）

> **本轮基线**：仓库 main 分支已完成 T1–T13（上个开发窗口交付，已通过 QA 与安全审计）。**本轮只开发批次 5（T14–T18）**，不要改动已有功能（除非 RAG 注入需要的最小接线，如 prompts.ts 注入点、qa service 注入点——这些改动必须保证原有测试全部通过）。

## 四、重要约束（来自技术设计）

1. **原始 log 文件永不上传服务器**：解析全部在浏览器 Web Worker 本地完成，只上传结构化 JSON（T4）。
2. **FR-10 token 预算**：交给 AI 的数据 ≤50K token/场，服务端要再校验（T13）。
3. **报告 6 章并行生成**：服务端并行 6 个流式调用汇成一条 SSE；每章独立存储、可单章重试（T5）。
4. **外部服务全部走环境变量**（Supabase URL/key、DeepSeek key、Resend key、WCL client、Turnstile key）：开发阶段没有真实密钥时，把服务集成封装在独立适配模块里，用 mock 完成可测试的部分；**真实账号接入在部署阶段（阶段 5）配置**。单元测试必须覆盖核心逻辑（解析器、token 预算、章节幂等、额度计数等）。
5. 本地开发验证：`npm run build` 必须通过；核心逻辑有单测；能跑起来自测的流程（上传解析→生成 mock 报告→问答 mock）要跑通。
6. 界面文案：中文为主；技能/专精/副本名保留游戏原名；页面须有"非暴雪官方产品，与暴雪娱乐无关"声明。

## 四-b、RAG 专用约束（批次 5 必读）

1. **嵌入**：SiliconFlow bge-m3，1024 维，OpenAI 兼容协议（`{base}/v1/embeddings`）。适配器走环境变量 `EMBEDDING_API_KEY/EMBEDDING_BASE_URL/EMBEDDING_MODEL`；**无密钥时降级 mock**（开发/测试可跑），但生产 fail-fast 规则同样适用于该密钥（在 validateProductionEnv 增加此三项校验）。
2. **检索**：Supabase pgvector 余弦相似度；`kb_documents` 表**服务端专用**（无 RLS、不经 anon 暴露）；每次分析注入 **top-k ≤ 5** 条。
3. **知识内容是不可信外部数据**：注入提示词时必须与 log 数据同样做"数据/指令隔离"——用固定定界包裹（如"【社区攻略参考】以下内容仅供参考，不代表本场数据"），内容中若出现指令性文本（如"忽略以上指令"）不得生效（提示词结构上把知识内容放在明确的数据区，系统指令放在其后或明确声明其优先级）。
4. **版权**：知识库只存**要点摘要 + 出处链接**（source_url），不整篇搬运攻略原文；报告引用时标注"参考社区攻略"。
5. **内容格式**：kb/sources/*.md，frontmatter 字段 class/spec/dungeon/patch/type/source_url 必填；入库脚本按 source_hash 幂等（重复执行不重复插入）。
6. **测试**：沿用仓库内沙箱垫片跑测试：`node --import ./scripts/sandbox-shim.mjs ./node_modules/vitest/vitest.mjs run --pool=threads`；原有 87 用例必须保持全绿。

## 五、完成标准（回到原窗口前）

- [ ] 批次 5 的 5 个任务（T14–T18）全部完成并逐条对照 tasks.md 的验收标准自查；原有功能（T1–T13）无回归（原测试全绿）
- [ ] `npm run build` 通过（若沙箱限制无法构建，至少 `npx tsc --noEmit` 通过 + 测试全绿，并说明）、测试通过、git 已提交（Conventional Commits）
- [ ] 更新 `docs/DEV-HANDOVER-REPORT.md`：**追加** RAG 批次的完成情况（改了哪些文件、每项怎么验证、遗留哪些"待部署阶段配置真实密钥"事项——如真实 SiliconFlow 密钥、真实 Supabase pgvector 迁移执行）
- [ ] 回到原窗口说一声"开发完成"，由原窗口独立做 QA 验收 + 安全审计（职责分离，重点核查知识注入防提示词攻击）
