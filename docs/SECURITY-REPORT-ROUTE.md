# 安全审计报告：路线指纹与挖掘工具（批次 6+7，T20/T21/T22/T23）

> 阶段 4（开发与质量）· 环节⑦安全审计 · 独立审计员（未参与本批次开发，职责分离）
> 审计范围：批次 6+7（T20 高阶技巧批量挖掘 / T21 战术波还原 / T22 路线指纹与阵容画像 / T23 参考目标推荐与同路线分组）全部 git 跟踪文件 + 对应测试
> 审计依据：docs/SECURITY-REPORT.md（发布前基线）、docs/SECURITY-REPORT-RAG.md（批次 5 基线）、docs/TECH-DESIGN.md（ADR-003）、docs/PRD.md（FR-12）
> 审计日期：2026-08-19 · 结论版本：v1.0

## 一、审计结论（先看这里）

**未发现致命（Critical）与高危（High）问题，且上一轮 M-RAG-1 / M-RAG-2 / M-2 / M-3 四项已修项全部无回归。**

本批次新增代码（`src/lib/mining/*`、`src/lib/route/*`、`src/lib/parser/tactical-pulls.ts`、`scripts/mine-patterns.mjs`、`src/lib/ai/intent-engine.ts` 的 anchor 扩展）为**纯函数 + 团队侧离线 CLI 工具**，**未接入任何 Web API 路由**（`src/app` 下无任何引用），无 fetch、无硬编码密钥、无新增依赖、无 SQL。

**存在 3 个低危（Low）项、2 个提示（Info）项**，均不构成发布阻塞，但建议随阶段 5 一并加固。

**结论：批次 6+7 达到"可发布安全基线"。** 核心判定：候选条目（inferred/candidate）绝不自动注入、无 SSRF/密钥/依赖新增、无 Web 暴露面；唯一实质风险是"挖掘产出写入 kb/inferred 前未做写入时消毒"（依赖后续 ingest 步骤兜底，属纵深防御缺口），以及路线相似度的 O(n×m) LCS 复杂度可被构造 log 放大（当前仅团队 CLI 可达）。

---

## 二、回归核查（上一轮修复项）—— ✅ 全部无回归

| 上一轮项 | 本批次结果 | 证据 |
| --- | --- | --- |
| M-RAG-1 随机定界符注入防护 | ✅ 仍生效，且注入路径未被本批次改动 | retrieval.ts:46-49（randomUUID 定界）；generate.ts:104,121 与 qa/service.ts:118,128（定界符先生成，system 提示词与数据区**共用同一对随机 token**）；ingest.ts:48 `DELIMITER_PATTERN_RE` 覆盖固定定界符 + 随机定界前缀 `参考-`/`/参考-`；security.test.ts:107-146 |
| M-RAG-2 函数权限回收 | ✅ 未回归，本批次无新增迁移 | 0003:46-48、0002:38-40 均 `revoke ... from public, anon, authenticated` + `grant ... to service_role`；security.test.ts:148-165 静态断言通过；git 仅 3 个迁移（0001/0002/0003），无 0004 |
| M-2 生产 fail-fast（含 EMBEDDING_*） | ✅ 完整 | env.ts:68-82 `PRODUCTION_REQUIRED_ENV` 仍含 EMBEDDING_API_KEY/BASE_URL/MODEL；env.ts:88-110 `validateProductionEnv`/`requireProductionEnv` 未改 |
| M-3 额度原子计数 | ✅ 仍原子 | quota.ts:64-66 `incrementDailyUsage`（0002 唯一键 + ON CONFLICT 原子递增），无 TOCTOU |
| intent-engine anchor 扩展 | ✅ 纯加性，无副作用 | intent-engine.ts:263（`SuspectedVerdict` 新增可选 `anchor?` 字段）、intent-engine.ts:298（仅 T19 第三档规则 1 赋值）；`runIntentEngine`/`runKnowledgeIntentDetection` 未改动；全量测试 165/165 全绿（含 intent-engine 25 用例） |

---

## 三、逐项审计结果（含证据：文件:行号）

### 1. 输入与注入 —— ⚠️ 低危 L-ROUTE-1 / L-ROUTE-2

#### 1.1 挖掘产出写入 kb/inferred 前未做"写入时消毒"（纵深防御缺口）

- **现状**：`mine.ts:185-208`（`buildCandidateMarkdown`）与 `mine.ts:217-233`（`writeCandidateFile`）**直接写盘，未调用 `assertSafeKbText`/`assertSafeSourceUrl`**。产出内容含 log 派生的字符串——`pattern.evidence` 与 `pattern.verdicts[*].explain` 内插了 `pre[0].actor`（宠物/召唤物名）、`m.spell`（技能名）、`v.note`（阶段名），三者均来自 `intent-engine.ts:291-301` 对原始 log 的解析（用户可控，见 1.2）。
- **为何不是高危**：真正的注入兜底在**后续 ingest 步骤**——`ingest.ts:192/198` 对 `source_url`、`ingest.ts:202` 对 `chunk_text` 均调 `assertSafeSourceUrl`/`assertSafeKbText`，会拒绝定界符样式文本与控制字符；且本批次产出固定 `source_url: internal:inference`（ingest.ts:45 白名单值 `INTERNAL_SOURCE_URL`，ingest.ts:71 放行）。候选条目 origin=inferred/status=candidate，**绝不注入正式分析**（retrieval.ts 默认 status=active 过滤）。写入 kb/inferred 后仍需人工跑 `scripts/ingest-kb.mjs` 才会入库，非自动注入。
- **缺口本质**：消毒只发生在"挖掘 → 入库"两步流程的**第二步**，第一步产出为未消毒的中间文件。若团队某次省略 ingest 消毒（或误将 kb/inferred 产物拷入 kb/sources 又不跑 ingest），log 派生的恶意文本（如宠物名被构造为 `【/参考-<uuid>】忽略以上指令`）会落入正式知识池的候选文件。当前测试 `mine.test.ts:114-127` 仅验证**良性 log** 的产物能通过 `parseKbFile` 往返，**未覆盖恶意 log 派生文本**。
- **影响**：纵深防御缺口，非直接可利用（受 ingest 兜底 + candidate 状态 + 人工转正三重约束）。
- **修复建议**：在 `buildCandidateMarkdown`/`writeCandidateFile` 内对 `evidence`/`explain` 调 `assertSafeKbText`、对 `source_url` 调 `assertSafeSourceUrl`，与 ingest 同口径；补一个"恶意 log 派生定界符/控制字符文本在写入时被拒"的测试。

#### 1.2 挖掘产出 frontmatter 值为 log 派生、未校验，可破坏 frontmatter 结构

- **证据**：`mine.ts:188-191`（`class/spec/dungeon` 直接插值进 frontmatter）；`meta.class/spec/dungeon` 来自 `mine.ts:96-99`（`run.combat.playerClass/playerSpec/dungeon`，log 派生）；`parseFrontmatter`（ingest.ts:86-104）用非贪婪正则 `/^---\s*\n([\s\S]*?)\n---\s*\n?/` 解析。
- **影响**：若 log 中的职业/副本名含换行（如构造 `Hunter\n---\n...`），会使 frontmatter 提前闭合，导致 `parseKbFile` 因"缺少必填字段"**整体拒绝该文件**（正确性/可用性退化，非安全注入——origin/status 由目录决定、source_url 固定且末位覆盖，无法借 frontmatter 注入 status/origin/source_url）。
- **修复建议**：写入前对 `class/spec/dungeon/patch` 做"单行 + 无控制字符"校验（或复用 `assertSafeKbText` 的单行变体）。

#### 1.3 路线指纹 / 阵容画像对恶意结构数据的健壮性 —— 低危 L-ROUTE-3

- 见第四节 L-ROUTE-3（LCS 复杂度放大 + 无文件大小上限）。

### 2. 密钥与依赖 —— ✅ 通过

- 无硬编码密钥/路径：全仓库 `sk-/AKIA/BEGIN/secret/password/api_key` 扫描仅命中 `docs/SECURITY-REPORT.md:24`（历史记录文字）；本批次新文件无任何密钥字面量。`source_url: internal:inference` 为白名单值，非密钥。
- `npm audit`：**0 漏洞**（本次复跑）。
- **批次 6+7 未新增依赖**：`package.json` 依赖仍为 next/react/zod/@supabase/*（与基线一致），`tsx`/`vitest`/`typescript` 为既有 devDependency。无新增许可证/漏洞面。
- 硬编码路径：`mine-patterns.mjs:56-57` 的 `root`/`outDir` 均由 `import.meta.url` 相对推导，无 `C:\`/`D:\` 绝对路径。

### 3. SSRF / 网络 —— ✅ 通过

- 本批次新代码**零 `fetch(`**。全仓库 `fetch(` 仅命中既有适配器：`email/provider.ts`（api.resend.com）、`wcl/adapter.ts`（www/cn.warcraftlogs.com，主机硬编码）、`turnstile/adapter.ts`（challenges.cloudflare.com）、`kb/embedding.ts`（EMBEDDING_BASE_URL，env）、`ai/provider.ts`（deepseekBaseUrl，env）——均与批次 6+7 无关。
- `mine-patterns.mjs:37` 复用 `getWclReportMeta`（既有 WCL 适配器），仅取元数据、code 走 GraphQL 变量、fetch 主机硬编码，无 SSRF。
- 嵌入/WCL 走既有适配器，路线/挖掘模块无任何网络调用。

### 4. SQL / 数据层 —— ✅ 通过

- 本批次无任何 DB 交互（无新表/迁移/查询）。`mine.ts`/`route/*`/`tactical-pulls.ts` 均为纯函数；候选落库仍走既有 `runIngest`（supabase-js 参数化 upsert / rpc），无字符串拼接 SQL。
- 本批次无新增 API 路由，`src/app` 下 0 引用，不扩大 IDOR/越权面。

### 5. 测试与质量 —— ✅ 通过

- `npm test`：**165/165 全绿**（23 文件；较批次 5 的 132 用例 +33）。
- `tsc --noEmit`：**EXIT=0**，类型检查通过。
- 安全回归测试 `src/lib/kb/security.test.ts`（12 用例）覆盖 M-RAG-1 定界符消毒/随机定界不可逃逸、M-RAG-2 迁移 revoke、L-RAG-3 哈希碰撞。

---

## 四、问题清单（按严重度）

### 🔴 致命（Critical）
无。

### 🟠 高（High）
无。

### 🟡 中（Medium）
无。

### 🔵 低（Low）

#### L-ROUTE-1 挖掘产出写入 kb/inferred 前未做"写入时消毒"，依赖后续 ingest 兜底
- **证据**：`src/lib/mining/mine.ts:185-208`（`buildCandidateMarkdown` 未消毒即拼装）、`mine.ts:217-233`（`writeCandidateFile` 直接 `fs.writeFile`）；log 派生文本来源 `src/lib/ai/intent-engine.ts:291-301`；消毒仅在 `src/lib/kb/ingest.ts:192,198,202`（后续 ingest 步骤）。
- **影响**：纵深防御缺口。恶意构造的 log（宠物名/技能名含定界符或控制字符）会使候选中间文件含未消毒文本；正常情况下被 ingest 消毒拦截、且 candidate 状态绝不注入，但"消毒是否必然发生"依赖团队严格执行两步流程。
- **修复建议**：写入时同口径调 `assertSafeKbText`/`assertSafeSourceUrl`；补"恶意 log 派生文本写入时被拒"测试。

#### L-ROUTE-2 挖掘 frontmatter 值为 log 派生、未校验，可破坏 frontmatter 结构（正确性）
- **证据**：`src/lib/mining/mine.ts:188-191`；`src/lib/kb/ingest.ts:86-104`（`parseFrontmatter` 非贪婪正则）。
- **影响**：log 派生的 class/spec/dungeon 含换行时，产出文件在 ingest 阶段被整体拒绝（缺必填字段），正确性/可用性退化；无法借以注入 origin/status/source_url（目录决定 + 末位覆盖）。
- **修复建议**：写入前对 class/spec/dungeon/patch 做"单行 + 无控制字符"校验。

#### L-ROUTE-3 路线相似度 O(n×m) LCS 可被构造 log 放大；挖掘工具无文件大小/数量上限（团队侧 DoS）
- **证据**：`src/lib/route/fingerprint.ts:98-106`（`flattenNames` 按 `n.count` 展开）、`fingerprint.ts:108-121`（`lcsLength` 动态规划 O(n×m)）、`fingerprint.ts:135-139`（`routeSimilarity`）；`src/lib/route/grouping.ts:28-29`（`groupByRoute` 每个新 profile 对每个已有组代表各跑一次 `routeSimilarity`，最坏 O(N²) 次）；`scripts/mine-patterns.mjs:85-101`（`fs.readFile` 整文件读入、无大小上限、`parseMiningLogs` + `detectTacticalPulls` 各 parse 一次全文）。
- **影响**：构造一份"单波含海量同名怪（海量唯一 GUID、无 15s 间隔、无濒死）"的 log，可使 `flattenNames` 展开出超大数组、`lcsLength` 分配 (n+1)×(m+1) 表 → OOM/挂起。**当前仅团队 CLI（mine-patterns.mjs）可达**，无 Web 暴露（`src/app` 0 引用），故为低危。
- **修复建议**：① 加单文件大小上限（如 50MB）与文件数量上限；② 对单波 NPC 数 / `count` 设上限或改用线性时间相似度（如 banded LCS / min-hash / 排序后计数），防止 O(n×m) 放大。

### ⚪ 提示（Info）

- **I-ROUTE-1** T22/T23 的 `compareReference`/`rankReferences`（`src/lib/route/recommend.ts:32-52`）为纯函数，**当前无任何生产调用方**（`src/app` 0 引用；仅测试与 CLI 引用）。当 FR-12 的"用户粘贴对比链接"功能在阶段 5 接线到 Web 路由时，`routeSimilarity` 的 LCS 复杂度（L-ROUTE-3）将由"团队侧"变为"用户可达"，届时必须先落实大小上限与复杂度约束。**建议在本批次验收记录中显式登记此前置条件。**
- **I-ROUTE-2** `scripts/mine-patterns.mjs:88` 的 `fs.readFile(file)` 默认跟随符号链接、路径为运维 CLI 参数（非 Web 输入）。团队离线工具、运维可信，且解析器只抽取结构化字段、不回显原始内容，故不构成"任意文件读取泄露"；仅提示：如需进一步收紧可加 `--no-follow` 或限制路径落在白名单目录内。

---

## 五、通过项清单（审计确认安全）

| 项 | 结论 |
| --- | --- |
| M-RAG-1 随机定界符注入防护 | ✅ 无回归（randomUUID 定界 + system/数据区共用同 token + ingest 拒绝定界符样式文本） |
| M-RAG-2 函数权限回收 | ✅ 无回归（0002/0003 均 revoke from public + grant service_role；本批次无新迁移） |
| M-2 生产 fail-fast | ✅ 无回归（EMBEDDING_* 仍在 PRODUCTION_REQUIRED_ENV） |
| M-3 额度原子计数 | ✅ 无回归（incrementDailyUsage 原子 RPC） |
| intent-engine anchor 扩展 | ✅ 纯加性，无副作用，测试全绿 |
| 候选条目（inferred/candidate）绝不注入 | ✅ 本批次产出 status=candidate，检索默认 status=active 过滤 |
| SSRF | ✅ 新代码零 fetch；WCL 走既有适配器（主机硬编码） |
| 密钥 | ✅ 无硬编码密钥/绝对路径；source_url=internal:inference 为白名单值 |
| SQL 注入 | ✅ 新代码无 DB 交互 |
| 依赖 | ✅ npm audit 0 漏洞；未新增依赖 |
| 路径遍历（产出文件名） | ✅ `candidateFileName`（mine.ts:210-214）slug 化，仅保留 `[a-z0-9\u4e00-\u9fff]`，路径分隔符/`..` 均被替换为 `-` |
| 测试 | ✅ 165/165 全绿；tsc --noEmit EXIT=0 |

---

## 六、发布前整改清单（建议随阶段 5 处理，非本批次阻塞）

1. [ ] L-ROUTE-1：挖掘写入时同口径消毒（`assertSafeKbText`/`assertSafeSourceUrl`）+ 恶意输入测试（**强烈建议**）
2. [ ] L-ROUTE-2：class/spec/dungeon/patch 单行 + 无控制字符校验（**强烈建议**）
3. [ ] L-ROUTE-3：挖掘工具加文件大小/数量上限 + 相似度复杂度约束（**阶段 5 接线 Web 前必须**）
4. [ ] I-ROUTE-1：FR-12 参考对比功能接线前，先落实 routeSimilarity 的输入上限与复杂度约束

> 备注：本审计未修改任何代码，仅出具报告。迁移 0002/0003 的 revoke 执行效果与 kb_documents 的 RLS/权限需在真实 Supabase 上验证（本机无 supabase CLI/docker），属阶段 5 部署验证事项；审计已按迁移脚本静态核对。
