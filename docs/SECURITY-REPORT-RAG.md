# 安全审计报告：RAG 社区知识库（批次 5，T14–T19）

> 阶段 4（开发与质量）· 环节⑦安全审计 · 独立审计员（未参与本批次开发，职责分离）
> 审计范围：批次 5（FR-11 知识库 + FR-5 第三档"疑似高阶技巧"）全部 git 跟踪文件 + 迁移 0003 + 运行配置
> 审计依据：docs/PRD.md（FR-11 安全条款 / FR-5 第三档）、docs/TECH-DESIGN.md（ADR-002）、docs/DEV-HANDOVER-REPORT.md 第五节、docs/SECURITY-REPORT.md（上一轮基线）
> 审计日期：2026-08-19 · 结论版本：v1.0

## 一、审计结论（先看这里）

**未发现致命（Critical）与高危（High）问题。** RAG 的核心安全链路实现正确：候选条目（inferred/candidate）绝不自动注入、SSRF 无、密钥管理规范、入库无 SQL 注入、依赖 0 漏洞、全量 132 用例全绿。

**但存在 2 个中危（Medium）项，建议列为发布前置条件**（详见第四节 M-RAG-1 / M-RAG-2），另有 4 个低危、3 个提示项。

**结论：RAG 模块达到"可发布安全基线（附条件）"**——即：完成 M-RAG-1、M-RAG-2 两项整改（或明确接受风险）后，方可随产品进入阶段 5 发布。核心判定依据：**候选路径受控（绝不注入）、正式路径依赖人工审核 + 定界隔离**；SSRF / 密钥 / 数据暴露 / 上一轮修复项回归均通过。

---

## 二、审计重点逐项核查（含证据：文件:行号）

### 1. 提示词注入（本轮最高优先）—— ⚠️ 中危 M-RAG-1

**候选条目（inferred）与正式条目（curated）的注入路径受控情况：**

| 路径 | 入库目录 | origin/status | 是否注入分析 | 判定 |
| --- | --- | --- | --- | --- |
| curated 攻略整理 | `kb/sources/` | curated / active | ✅ 注入（第 5 章 + 问答） | 受控（人工审核后入库） |
| inferred 疑似技巧 | `kb/inferred/` + `persistSuspectedCandidates` | inferred / candidate | ❌ 绝不注入 | 受控（检索默认 `status=active` 过滤，见 retrieval.ts:90 / supabase-store.ts:31 / 迁移 0003:86） |

- **候选绝不注入已实现且经测试**：`src/lib/kb/file-store.ts:90`（`statusFilter = filters.status ?? "active"`）、`src/lib/kb/supabase-store.ts:31`（`match_status: filters.status ?? "active"`）、迁移 0003:86（`match_status is null or meta->>'status' = match_status`）；`retrieval.test.ts:151`、`ingest.test.ts:141` 双目录互不覆盖测试通过。**FR-5 验收"候选不注入其他用户正式分析"落实。**

- **注入格式**：`src/lib/kb/retrieval.ts:80-86` `formatKbContext` 用固定定界符包裹 + 逐条来源标注；`prompts.ts:33` / `qa/prompts.ts:23` 注入 `KB_INJECTION_RULES` 声明"数据区无指令效力"。

- **漏洞（M-RAG-1）**：定界符为**固定文本**（`【社区攻略参考】` / `【/社区攻略参考】`，retrieval.ts:32-33），且 `chunkText` 与 `source_url` **未经消毒/转义直接插值**进提示词（retrieval.ts:83）。攻击者若能使一条"含 `【/社区攻略参考】` + 忽略以上指令…"的文本进入 active 池，该文本会**提前"关闭"数据区**，其后的指令性文字在模型视角下落到数据区之外、被当作直接指令执行——即经典的"定界符越狱"。系统指令里"该区域内容无效"的声明是软约束，无法阻止这种定界符混淆。**因此 FR-11 要求的"数据/指令隔离防提示词注入"并未达到"不可绕过"。**

- **影响放大**：知识库是**全站共享**的单例存储（`getKbStore()` 单例，检索仅按 class/spec/dungeon/patch/status 过滤、不按用户隔离），一条被污染的 active 条目会影响**所有**同职业/专精用户的第 5 章与问答输出（非"自服务"），相对上一轮 L-4（仅影响提问者本人）是显著扩大。

- **缓解（为什么不是高危）**：① active 池入库需人工审核（PRD FR-11 分池治理 / TECH-DESIGN ADR-002"入库人工审核"）；② 候选路径虽含 log 派生文本（actor 名等用户可控串，见 candidates.ts:37 的 `v.evidence`），但为 candidate 状态、**绝不自动注入**，转正仍需人工；③ 下游无工具调用/无代码执行，仅影响报告文本，输出经 React 转义渲染无 XSS；④ 当前 `kb/sources/*.md` 实测无任何定界符/指令性文本。

- **修复建议**：① 定界符改为**每次请求随机生成的不可猜测 token**（如 `<kb-data-{random}>`），system 提示词与数据区使用同一随机值；② 入库时对 `chunkText`/`source_url` **消毒或直接拒绝含定界符序列的内容**（ingest.ts 加校验）；③ `source_url` 加长度上限（如 ≤200）并去除控制字符。

### 2. SSRF —— ✅ 通过（无回归）

- 嵌入 API：`src/lib/kb/embedding.ts:19` `url = ${envConfig.embeddingBaseUrl}/v1/embeddings`，base_url 仅来自服务端环境变量 `EMBEDDING_BASE_URL`（env.ts:42，默认 `https://api.siliconflow.cn`），**非用户可控**。
- 运行时**不 fetch 任何用户/知识内容提供的 URL**：全仓库 `fetch(` 扫描仅命中——`embedding.ts`（env）、`ai/provider.ts`（`deepseekBaseUrl` env）、`email/provider.ts`（硬编码 api.resend.com）、`wcl/adapter.ts`（硬编码 www/cn.warcraftlogs.com）、`turnstile/adapter.ts`（硬编码 challenges.cloudflare.com）。`kb.meta.source_url` 仅作为文本标注注入提示词，**从不被 fetch**。
- WCL 适配器未回归：`wcl/adapter.ts:39-40` 正则已收紧为 `^https://`（上一轮 I-5 已修复），fetch 主机仍硬编码 `www/cn.warcraftlogs.com`（adapter.ts:61,79），code 作为 GraphQL 变量传入。

### 3. 入库脚本安全 —— ✅ 通过（2 项提示）

- **路径遍历：无。** `scripts/ingest-kb.mjs` 读取 `fs.readdir(sourcesDir)` 的 basename + `path.join`（ingest.ts:180-192），readdir 不返回 `..`；`argDir`（CLI argv[2]）为运维可控，非 Web 输入。
- **frontmatter 解析：无 YAML 注入。** 手写逐行 `key: value` 解析器（ingest.ts:42-64），**未引入 YAML 库**，不存在 YAML 反序列化类攻击（原型污染/别名炸弹等）；值为单行，无多行注入。这同时回答"新增依赖"：**批次 5 未新增任何依赖**（package.json 与基线一致，无 yaml 解析器）。
- **幂等 upsert SQL：参数化，无注入。** `supabase-store.ts:53-55` `.upsert(rows, { onConflict: "source_hash" })`、`supabase-repo.ts:367-370` `.rpc("increment_daily_usage", { p_user, p_day })`、`supabase-store.ts:25-33` `.rpc("match_kb_documents", {...})` 均为 supabase-js 参数化，无字符串拼接 SQL。
- **source_hash**：`ingest.ts:119-123` sha256(fileName + JSON.stringify(frontmatter) + 归一化文本)，含 origin/status（ingest.ts:202-210）→ 双目录互不覆盖；幂等测试通过（ingest.test.ts:128-139 二次入库 0 新增）。
- **是否可能把非 kb/ 目录文件入库**：脚本默认只读 `kb/sources` 与 `kb/inferred`，`readdir` 非递归、只取 `.md`；无 Web 暴露面，不会误入库。提示见 I-RAG-2（`【意图:` mock 判定块防误入生产内容）。

### 4. 数据暴露 —— ✅ 通过表权限 / ⚠️ 中危 M-RAG-2 函数权限

- **kb_documents 表：✅ 未授权 anon/authenticated。** 迁移 0003:41 `revoke all on table public.kb_documents from anon, authenticated;`，未启用 RLS（服务端专用，0003:12-15 注释）。PostgreSQL 新建表默认无任何角色授权（除属主），故 anon/authenticated 无法直连读写。代码仅以 service role 连接（supabase-store.ts:13-17）。
- **M-RAG-2：函数 `match_kb_documents` 的 PUBLIC 默认 EXECUTE 未被回收。** PostgreSQL `CREATE FUNCTION` **默认授予 PUBLIC EXECUTE**；迁移 0003:42 仅 `revoke ... from anon, authenticated`，**未 `revoke ... from public`**，因此 anon/authenticated 仍可执行该函数。当前为 `SECURITY INVOKER`（0003:48-63 无 `security definer`），函数内部 `select ... from kb_documents` 以调用者权限执行，因表权限已回收而报"permission denied"→ **今日无数据泄露**；但"服务端专用、回收 anon/authenticated 全部权限"的声明在 DB 层**未完全落实**，若未来误授表 SELECT 即成为泄露通道。
- **关联发现（回归核查暴露）**：迁移 0002 的 `increment_daily_usage` 为 **SECURITY DEFINER** 且**无任何 revoke**（0002:22-33），默认 PUBLIC EXECUTE → anon/authenticated 可执行它原子递增任意 `(user_id, day)` 的计数。因 `user_id` 为不可猜测的 UUID，实际攻击者只能自增自己额度（自 DoS，无收益），故归入 M-RAG-2 一并修复。
- **FileKbStore 本地文件**：写 `.data/kb_documents.json`（file-store.ts:18-19 `DATA_DIR` 缺省 `.data`）；`.data/` 已 gitignore（.gitignore:41），`.data-*` 已 gitignore（.gitignore:34，上一轮 I-2 已修复）；文件为默认 umask 0644、仅开发 mock、内容为公开攻略摘要无敏感信息。测试 fixture 用 `os.tmpdir()`（rag-injection.test.ts:20、ingest.test.ts:24），不会误入库。
- **修复建议（M-RAG-2）**：`revoke all on function public.match_kb_documents(...) from public, anon, authenticated;` 与 `revoke all on function public.increment_daily_usage(uuid, text) from public, anon, authenticated;`；并在真实 Supabase 上核对 `\df+` 的 ACL（本机无 supabase CLI/docker，无法实测，属阶段 5 部署验证项）。

### 5. 密钥 —— ✅ 通过

- `EMBEDDING_API_KEY` / `EMBEDDING_BASE_URL` / `EMBEDDING_MODEL` 均为**服务端** `env()` 读取（env.ts:41-43），**非 `NEXT_PUBLIC_`**，不泄露到浏览器。
- 生产 fail-fast **已含这三项**：env.ts:79-81（`EMBEDDING_API_KEY / EMBEDDING_BASE_URL / EMBEDDING_MODEL` 均列入 `PRODUCTION_REQUIRED_ENV`），health 路由缺失即 503（health/route.ts:11-17）；`getKbStore()` 生产缺 Supabase 三密钥直接抛错、禁止静默回退 FileKbStore（kb/index.ts:18-22）。
- `.env.example` 更新：`EMBEDDING_API_KEY=` 空值（.env.example:33）；`EMBEDDING_BASE_URL/MODEL` 为非敏感默认值（:34-35）。✅ 只含空值/非敏感默认。

### 6. 回归核查（上一轮修复项）—— ✅ 无绕过/破坏

| 上一轮项 | 批次 5 结果 | 证据 |
| --- | --- | --- |
| 生产 fail-fast（M-2） | ✅ 含 EMBEDDING 三项，未回归 | env.ts:79-81；kb/index.ts:18-22；health 503 |
| 额度原子计数（M-3） | ✅ 已原子化（RPC + 唯一键），未回归 | quota.ts:64-66 先增后查；0002 唯一键 + 原子 upsert |
| userId 守卫 | ✅ RAG 无新用户接口，全服务端，无回归 | api 路由仍 12 个（无新增）；kb 仅 server 侧引用 |
| 安全头（L-1/L-2） | ⚠️ 未回归但**仍未修复**（不在批次 5 范围） | proxy.ts CSP 仍含 'unsafe-inline'；API 路由仍无安全头 |
| L-4 错误文案 | ✅ 已修复且新代码同口径 | provider.ts:82、embedding.ts:31、generate/route.ts:46 均友好文案 |
| 全量测试 | ✅ 132/132 全绿 | `vitest run` 18 文件 132 用例通过（本次复跑） |

### 7. 依赖 —— ✅ 通过

- `npm audit`：**0 漏洞**（本次复跑确认）。
- **批次 5 未新增依赖**：package.json 依赖仍为 next/react/zod/@supabase/*（无 yaml 解析器、无新库），frontmatter 手写解析，故无新增许可证/漏洞面。`tsx` 为既有 devDependency（ingest-kb.mjs 复用）。

---

## 三、通过项清单（审计确认安全）

| 项 | 结论 |
| --- | --- |
| 候选条目（inferred/candidate）绝不注入 | ✅ 检索默认 status=active 过滤，双目录互不覆盖，测试覆盖 |
| SSRF | ✅ 嵌入/模型 base_url 仅来自 env，运行时不 fetch 任何用户/知识 URL |
| 密钥 | ✅ EMBEDDING 三项服务端、非 NEXT_PUBLIC、生产 fail-fast 含三项、.env.example 空值 |
| SQL 注入 | ✅ 全参数化（supabase-js upsert/rpc） |
| 路径遍历 | ✅ readdir basename + 非递归，仅 CLI 运维可控 |
| YAML 注入 | ✅ 手写 frontmatter 解析，无 YAML 库 |
| kb_documents 表权限 | ✅ 显式 revoke anon/authenticated + 无 RLS + 仅 service role |
| 幂等入库 | ✅ source_hash 含 origin/status，二次入库 0 新增 |
| 上一轮 M-2/M-3/L-4 修复 | ✅ 未回归（EMBEDDING 已纳入 fail-fast；额度原子；错误友好文案） |
| 依赖 | ✅ npm audit 0 漏洞，无新增依赖 |

---

## 四、问题清单（按严重度）

### 🔴 致命（Critical）
无。

### 🟠 高（High）
无。

### 🟡 中（Medium）

#### M-RAG-1 提示词注入定界可被"定界符越狱"绕过，数据/指令隔离未达"不可绕过"
- **证据**：`src/lib/kb/retrieval.ts:32-33`（固定文本定界符）、`retrieval.ts:80-86`（`chunkText`/`source_url` 直接插值、无消毒/转义）、`src/lib/kb/ingest.ts:140-163`（不校验 chunkText 是否含定界符序列）、`src/lib/ai/prompts.ts:33` 与 `src/lib/qa/prompts.ts:23`（`KB_INJECTION_RULES` 软声明）。
- **影响**：含 `【/社区攻略参考】` + "忽略以上指令…" 的知识条目可提前关闭数据区，劫持第 5 章/问答输出；KB 全站共享，影响所有同职业用户（非自服务）。
- **修复建议**：随机不可猜测定界符（每请求）+ 入库消毒/拒绝含定界符内容 + source_url 长度上限。

#### M-RAG-2 RPC 函数 PUBLIC 默认 EXECUTE 未回收，"服务端专用"声明未在 DB 层落实
- **证据**：`supabase/migrations/0003_kb_documents.sql:41-42`（仅 revoke from anon/authenticated，未 from public）、`0003:48-63`（`match_kb_documents` 无 security definer、PUBLIC EXECUTE 未回收）；关联：`0002_daily_usage.sql:22-33`（`increment_daily_usage` SECURITY DEFINER、无任何 revoke）。
- **影响**：`match_kb_documents` 当前因 SECURITY INVOKER + 表权限回收而无泄露，但授权意图未完全达成；`increment_daily_usage` 为 SECURITY DEFINER 写原语、anon 可执行（受 UUID 不可猜测所限，实际仅自 DoS）。
- **修复建议**：对两函数 `revoke all ... from public, anon, authenticated`；真实 Supabase 部署时核对 ACL。

### 🔵 低（Low）

- **L-RAG-1** `source_url` 仅校验 `^https?://` 前缀（ingest.ts:152-154）、无长度/内容约束，且被直接插值进提示词（retrieval.ts:83）。→ 加长度上限（≤200）+ 去除控制字符，建议白名单域名（NGA/Wowhead/B站等）。
- **L-RAG-2** 候选条目 `source_url` 用不可路由占位域名 `https://wow-analyzer.local/inferred/…`（candidates.ts:46），转正后出处不可追溯。→ 转正时替换为真实出处。
- **L-RAG-3** `candidateSourceHash` 不含 dungeon/origin/status（candidates.ts:21-27），跨副本/跨状态的同 evidence 候选会哈希碰撞被幂等去重。→ 哈希纳入 dungeon + origin + status（正确性，非安全）。
- **L-RAG-4（回归遗留，非批次 5 引入）** L-1（API 无安全头）、L-2（CSP `'unsafe-inline'`）、L-6（请求体无大小上限）仍开放。→ 随阶段 5 一并处理。

### ⚪ 提示（Info）

- **I-RAG-1** `KB_INJECTION_RULES` 措辞"以…开头…结尾"与实际注入位置不符（第 5 章注入在消息末尾 generate.ts:119、问答注入在消息中间 qa/service.ts:126）。→ 改为"被【社区攻略参考】…【/社区攻略参考】包裹的区域"。
- **I-RAG-2** mock 提供器的 `extractKbRegion`（provider.ts:154-163）与真实模型定界逻辑两处重复维护；`【意图:` 结构化判定块（intent-engine.ts:45-52）会随 chunkText 进入真实模型提示词，注释称生产内容不含该结构（当前属实）。→ 入库 lint：拒绝含 `【意图:` 的 chunkText，防止 mock 判定块误入生产。
- **I-RAG-3** FileKbStore 数据文件 `.data/kb_documents.json` 为默认 0644、仅开发 mock、已 gitignore、内容为公开攻略摘要——可接受，记录备案。

---

## 五、发布前整改清单（建议作为阶段 5 前置条件）

1. [ ] M-RAG-1：提示词注入定界加固（随机定界符 + 入库消毒/拒绝定界符内容 + source_url 上限）（**必须**）
2. [ ] M-RAG-2：`match_kb_documents` 与 `increment_daily_usage` 追加 `revoke ... from public`，真实 Supabase 核对 ACL（**必须**）
3. [ ] L-RAG-1：source_url 长度/内容约束（**强烈建议**）
4. [ ] L-RAG-4：L-1/L-2/L-6 遗留低危随阶段 5 处理

> 备注：本审计未修改任何代码，仅出具报告。迁移 0003 的 revoke 执行效果需在真实 Supabase 上验证（本机无 supabase CLI/docker），属阶段 5 部署验证事项；审计已按迁移脚本静态核对。
