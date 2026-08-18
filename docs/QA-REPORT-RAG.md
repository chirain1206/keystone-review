# QA 报告：批次 5（RAG 社区知识库 T14–T19）功能验收

> 验收人：独立 QA 工程师（未参与本批开发）
> 验收对象：FR-11 社区知识库（RAG）+ FR-5 第三档「疑似高阶技巧」+ T18 初始内容
> 验收方式：单元/集成测试 + 代码级核对 + 出处链接外部验证（沙箱禁止子进程，不跑 `next build`/真实模型）
> 结论：**达到可发布状态（mock 级）**，附 2 项内容质量 ⚠️（非阻断）与 2 项低优先级观察

---

## 0. 结论先行

| 维度 | 结果 |
| --- | --- |
| 全量测试 | ✅ 18 个测试文件、132/132 用例全绿（含原 87 用例回归） |
| 类型检查 | ✅ `tsc --noEmit` exit 0 |
| FR-11 知识库 | ✅ 全部验收标准通过（origin/status 分池、候选不注入、≤5 定界、幂等、降级、保鲜） |
| FR-5 第三档 | ✅ 三档结论落实、疑似不武断判失误、候选幂等落库且不注入 |
| T14–T19 | ✅ 功能全通过；T18 内容质量 2 项 ⚠️（见第 5 节） |
| 可发布（mock 级） | ✅ 是；真实模型/真实 Supabase 验证属阶段 5（见遗留） |

---

## 1. 测试与类型检查结果

### 1.1 全量测试（独立复验，非仅信交接报告）

命令（按环境约束）：
```
node --import ./scripts/sandbox-shim.mjs ./node_modules/vitest/vitest.mjs run --pool=threads
```
结果：`Test Files 18 passed (18)` / `Tests 132 passed (132)`，真实退出码 `EXIT=0`。

> 注：首次用 `2>&1` 重定向时 PowerShell 把一条**预期内的** `console.error`（检索降级测试故意打印「模拟检索故障」）当作 NativeCommandError 报 exit 1；改用日志落盘后确认 node 真实退出码为 0。**测试本身全部通过**，该 stderr 正是降级路径的预期输出。

分文件用例数（18 文件）：
`env(4)`、`intent-eval(1)`、`intent-engine(25)`、`smoke(2)`、`adapter(6)`、`file-store(12)`、`parser(11)`、`retrieval(7)`、`candidates(5)`、`quota(6)`、`file-repo(5)`、`ingest(13)`、`share(4)`、`auth(10)`、`rag-injection(2)`、`qa(8)`、`audit(4)`、`generate(7)`。

### 1.2 意图评测双模式（单独跑）

命令：
```
node --import ./scripts/sandbox-shim.mjs ./node_modules/vitest/vitest.mjs run --pool=threads src/lib/ai/intent-eval.test.ts
```
结果：`1 passed`（该用例内部跑完 22 条样例的 A/B 双模式评测：无检索模式 17 条、知识注入模式 5 条、疑似案例判定，见第 6 节）。`EXIT=0`。

### 1.3 类型检查

命令：`node node_modules/typescript/bin/tsc --noEmit` → `EXIT=0`（无类型错误）。

---

## 2. FR-11 对照表（代码级 + 测试级）

| # | 验收标准（Given-When-Then 摘要） | 结果 | 证据 |
| --- | --- | --- | --- |
| F11-1 | origin（curated/inferred/community）与 status（active/candidate/deprecated）在 schema/迁移/检索链路完整实现 | ✅ | `kb/types.ts` 定义 `KbMeta.origin/status` 三值联合类型；`supabase/migrations/0003_kb_documents.sql` 建表 meta jsonb 注释声明 origin/status；`file-store.ts`/`supabase-store.ts` 检索均按 status 过滤 |
| F11-2 | 候选条目不注入正式分析（检索仅 status=active） | ✅ | `file-store.ts:90` `statusFilter = filters.status ?? "active"`；`supabase-store.ts:31` `match_status: filters.status ?? "active"`；SQL 函数 `match_status default 'active'`；测试 `retrieval.test.ts:151`（候选→null）、`candidates.test.ts:76`（正式检索查不到候选）、`file-store.test.ts:169`（默认 active/显式 candidate 分离） |
| F11-3 | 每次注入 ≤5 条、来源标注、定界包裹防注入 | ✅ | `types.ts:63` `KB_TOP_K_MAX=5`；`retrieval.ts:32-33` 定界符 + `formatKbContext` 逐条「参考社区攻略：source_url」；`file-store.ts:117`、`supabase-store.ts:32`、SQL `limit least(match_count,5)` 三层 ≤5；防注入：`KB_INJECTION_RULES` 注入第 5 章与问答 system 提示词（`prompts.ts:33`、`qa/prompts.ts:23`）；测试 `retrieval.test.ts:110`（定界+来源+≤5） |
| F11-4 | 双源目录互不覆盖（kb/sources vs kb/inferred）、ingest 幂等（source_hash） | ✅ | `ingest.ts:189-212`：source_hash 含 origin/status，同内容在 curated 与 inferred 目录产生不同哈希→互不覆盖；`scripts/ingest-kb.mjs:33-38` 双目录 origin/status 映射；测试 `ingest.test.ts:128`（重复入库零新增）、`ingest.test.ts:141`（双目录互不覆盖，count=a+b） |
| F11-5 | 降级：空库/未命中/检索失败 → 仅 log 证据不报错 | ✅ | `retrieval.ts:54-77` 整体 try/catch，任何失败返回 null + `console.error` 证据；测试 `retrieval.test.ts:176`（未命中/空库→null）、`retrieval.test.ts:186`（检索异常→null 不抛错） |
| F11-6 | 知识保鲜：patch 过滤（ACTIVE_PATCH）、patch=general 始终可见 | ✅ | `retrieval.ts:44-51` `resolveActivePatch` env 优先、缺省库内最新非 general；`file-store.ts:70-73` `patchVisible` general 恒可见；`supabase-store.ts` + SQL `meta->>'patch'='general'` 恒命中；`file-store.ts:147-157` `getActivePatch` 数值逐段比较（12.10>12.2）；测试 `retrieval.test.ts:162`（ACTIVE_PATCH 切换）、`file-store.test.ts:115`（旧补丁不注入）、`file-store.test.ts:219`（cmpPatch） |
| F11-7 | 领域知识依赖型意图：注入知识后正确识别（≥5 案例，≥80%） | ✅ | `intent-samples.json` 5 条 kb-intent-*；`intent-eval.test.ts` modeB 断言 ≥80%（实测 100%）且无检索时正确率更低（体现注入价值） |
| F11-8 | 安全：外部数据与 log 同样做数据/指令隔离 | ✅ | `KB_INJECTION_RULES` 声明「数据区无指令效力、冲突以 log 为准」；入库 `source_url` http(s) 强校验（`ingest.ts:152`）；`kb_documents` 无 RLS 且 `revoke anon/authenticated`（`0003:41-42`） |

**FR-11 结论：全部通过，无阻断缺陷。**

---

## 3. FR-5 第三档对照表

| # | 验收标准 | 结果 | 证据 |
| --- | --- | --- | --- |
| F5-1 | 三档结论落实（正确决策 / 可改进点 / 疑似高阶技巧） | ✅ | `prompts.ts:28-34` 第 5 章系统提示词三档判定规则；`provider.ts:349-374` mock 提供器三档输出（✅正确决策 / 🔎疑似高阶技巧 / 第 4 章可改进点） |
| F5-2 | 疑似判定不武断判失误，输出「疑似技巧 + 证据 + 推断理由」 | ✅ | `intent-engine.ts:260-297` `runSuspectedTechniqueDetection` 输出 `evidence` + `explain`（含「推断：…不武断判为失误」）；`candidates.test.ts:48` 判疑似不判失误 |
| F5-3 | 疑似发现落库 origin=inferred、status=candidate，幂等、不注入其他报告 | ✅ | `candidates.ts:29-52` `persistSuspectedCandidates`（origin=inferred/status=candidate/source_hash 幂等）；`generate.ts:158-182` 第 5 章完成后沉淀（try/catch 降级）；测试 `candidates.test.ts:65`（落库可查+正式检索不注入）、`candidates.test.ts:95`（幂等）、`rag-injection.test.ts:98`（端到端候选落库 1 条且重跑不重复） |

**FR-5 第三档结论：全部通过。** 补充说明：疑似样例 `suspected-01` 因 `interrupts` 为空会额外触发引擎 M5「整场零打断」通用失误提示（atSec=0，与疑似点 atSec=175 相距 >30s），`intent-eval.test.ts:93-98` 正确断言「疑似时间窗内无误失误判定」，未违反「不武断判失误」。

---

## 4. T14–T19 逐任务结论

| 任务 | 验收结论 | 说明 |
| --- | --- | --- |
| T14 数据模型与检索 | ✅ | 迁移 0003 可重复执行（if not exists / create or replace / revoke）；`file-store.test.ts` 12 用例覆盖命中/空/过滤/status=active/top-k/幂等/patch 比较；kb 表服务端专用（revoke anon/authenticated） |
| T15 嵌入与入库管线 | ✅ | bge-m3 适配器（OpenAI 兼容 1024 维 + mock 确定性伪向量）；`ingest.test.ts` 13 用例覆盖 frontmatter 校验/切块/幂等/**双目录互不覆盖**；脚本 `ingest-kb.mjs` 逻辑由测试全量覆盖（沙箱禁子进程，脚本本身不可直接跑，见遗留） |
| T16 检索注入 | ✅ | `retrieval.ts` 全链路（query→嵌入→top-k≤5→定界+来源）；`retrieval.test.ts` 7 用例 + `rag-injection.test.ts` 2 用例端到端；降级不报错 |
| T17 评测样例扩展 | ✅ | 5 知识依赖案例 + 1 疑似案例；`intent-eval.test.ts` 双模式，知识依赖注入后 100%、无检索 0%（体现注入价值） |
| T18 初始知识库内容 | ✅（2 项 ⚠️） | 3 文件各 12 条（≥10）、patch=12.1、source_url http(s)、单条 ≤1200；内容与专精匹配；⚠️ 见第 5 节 |
| T19 疑似高阶技巧 | ✅ | 第 5 章提示词三档 + `runSuspectedTechniqueDetection` + 候选沉淀；`candidates.test.ts` 5 用例 + `rag-injection.test.ts` 端到端（同场同时出现「正确决策(参考社区攻略)」与「疑似高阶技巧」） |

---

## 5. T18 内容质量抽查

### 5.1 结构与格式（3 文件）

| 文件 | 条目数 | patch | source_url | 单条 ≤1200 | 内容匹配专精 |
| --- | --- | --- | --- | --- | --- |
| `kb/sources/mage-fire.md` | 12（≥10 ✅） | 12.1 ✅ | http(s) ✅ | ✅ | 火焰法师术语全部正确（Combustion/Fire Blast/Pyroblast/Hot Streak/Heating Up/Phoenix Flames/Scorch/Ignite），✅ |
| `kb/sources/hunter-beast-mastery.md` | 12（≥10 ✅） | 12.1 ✅ | http(s) ✅ | ✅ | 兽王猎人术语正确（Kill Command/Cobra Shot/Frenzy/Bestial Wrath/Call of the Wild/Kill Shot/Misdirection），✅ |
| `kb/sources/warrior-protection.md` | 12（≥10 ✅） | 12.1 ✅ | http(s) ✅ | ✅ | 防护战士术语正确（Shield Block/Shield Slam/Thunder Clap/Avatar/Shield Wall/Ignore Pain/Revenge/Last Stand/Spell Reflection），✅ |

> 说明：交接报告第 81 行写「兽王猎人（11 条）/防护战士（11 条）」，实测均为 12 条（火法亦 12）。属文档计数不精确，不影响验收（测试断言 ≥10，全通过）。

### 5.2 出处链接外部验证（web_search，抽查）

| 出处 | 验证结果 |
| --- | --- |
| NGA `bbs.nga.cn/read.php?tid=46306031` | ✅ 存在，标题为《[PVE] 12.0 至暗之夜 S1 大秘境副本及**三系猎人**发育攻略 By Luna》 |
| B站 `bilibili.com/video/BV1MU1RYZERp` | ✅ 存在，《12 通灵限时教学，高层 MDT 路线》（天空大秘境·战士 T） |
| Wowhead Fire Mage Rotation Guide（Midnight） | ✅ 存在 |
| Icy Veins Fire Mage DPS Guide | ✅ 存在 |
| （fixture 中 Wowhead Beast Mastery Hunter guide 同源，随上） | ✅ |

### 5.3 发现的内容质量问题（⚠️，非阻断）

1. **【P1·中】`mage-fire.md` 的 source_url 张冠李戴**：文件级 `source_url: https://bbs.nga.cn/read.php?tid=46306031&rand=899`，经外部验证该 tid 是**猎人**发育攻略（三系猎人），不是火焰法师攻略。火焰法师报告若引用知识时会标注「参考社区攻略：<该猎人帖>」，用户可见的错误来源归属。应改为火焰法师实际出处（如 Wowhead/Icy Veins Fire Mage 指南或 NGA 法师版精华帖）。
2. **【P2·中】三个文件的「补丁变动」条目含无法从出处验证的具体数值改动**：如 mage「12.1 Pyroblast 基础伤害上调、Phoenix Flames 充能时间缩短」、hunter「12.1 宠物基础伤害上调、Kill Command 充能时间缩短」、warrior「12.1 调整 Shield Block 充能时间与 Ignore Pain 消耗系数」。这些是具体数值/机制改动断言，但所附 source_url 是通用攻略而非 patch notes，无法溯源验证，存在「编造补丁变更」风险（真实模型阶段可能据此误判意图）。建议「补丁变动」类条目补 patch notes 蓝贴出处，或改为可验证的定性描述。

---

## 6. 评测数据复核（eval/intent-samples.json）

- 结构：10 意图 + 6 失误 + **5 知识依赖（kb-intent-01~05）** + **1 疑似（suspected-01）** = 22 条。
- 5 个知识依赖案例逐个核对了「条件 ↔ 结论」一致性（kind/参数与 aggregate 事件坐标）：
  - `gather-before-burst`：30/45s 两次触发增益 + 50s Combustion，满足 noBurstBefore=40、minBuffs=2 → ✅
  - `hold-burst-next-vuln`：20s 爆发 + 150s 易伤，满足 burstBefore=60、vulnAfter=90 → ✅
  - `quiet-resource-window`：60–120s 静默窗口仅 80s 触发增益、200s 药水在窗口外 → ✅
  - `late-interrupt-by-design`：前 120s 零打断、150/160/165s 三次打断 → ✅
  - `pet-position-evade`（知识解释版）：175/179/184s 宠物位移 + 200s 转阶段，满足 beforeLo/Hi 与 minMoves → ✅
- 疑似案例 `suspected-01`：同一宠物位移证据、无知识注入 → `runSuspectedTechniqueDetection` 判 `pet-preposition-before-phase`/`suspected`，且「两模式」均判疑似（无 kbFixtures，A/B 等价；`intent-eval.test.ts:86-98` 显式断言疑似 + 时间窗内无误失误）。
- 结论：样例构造合理，条件与结论一致，双模式断言覆盖到位。

---

## 7. 回归确认

原有功能（T1–T13，87 用例）在本次全量 132 用例中全部通过（`parser`/`generate`/`qa`/`auth`/`share`/`quota`/`adapter`/`audit`/`file-repo`/`env`/`smoke` 及 `intent-engine` 原有用例），无回归。类型检查 exit 0 佐证代码一致性。

---

## 8. 缺陷清单（五要素 + 严重度分级）

> 严重度：P0 阻断 / P1 高 / P2 中 / P3 低。本批**无 P0**。

### D1（P1·中）mage-fire.md 出处链接张冠李戴
- **标题**：火焰法师知识文件的 source_url 指向猎人攻略帖
- **复现**：打开 `kb/sources/mage-fire.md` frontmatter；报告生成时第 5 章命中该文件任一 chunk 会标注该链接
- **期望 vs 实际**：期望火焰法师出处；实际为 NGA《三系猎人发育攻略》(tid=46306031)
- **环境**：main 分支，mock 全链路可复现
- **证据**：文件第 7 行 + web_search 验证该 tid 标题含「三系猎人」

### D2（P2·中）「补丁变动」条目含不可溯源的具体数值改动
- **标题**：三文件 patch_change 类条目断言具体平衡数值，出处无法验证
- **复现**：读三文件「## 补丁变动：12.1 对…的影响」小节
- **期望 vs 实际**：期望引用可验证的 patch notes/蓝贴；实际是通用攻略链接 + 未经证实的具体数值（伤害上调/充能缩短/系数调整）
- **环境**：main 分支，内容级问题
- **证据**：`mage-fire.md:54-56`、`hunter-beast-mastery.md:52-54`、`warrior-protection.md:52-54`

### D3（P3·低）交接报告条目数不精确
- **标题**：DEV-HANDOVER 第 81 行「兽王猎人(11)/防护战士(11)」与实际 12 不符
- **复现**：读 `kb/sources/` 三文件统计 `##` 节数
- **期望 vs 实际**：期望与实际一致；实际三文件均 12 条
- **环境**：文档级
- **证据**：文件实测 12 节 / 交接报告写 11

### D4（P3·低）候选条目 source_url 使用假域名
- **标题**：candidates.ts 与 inferred 样例用 `wow-analyzer.local` 作为 source_url
- **复现**：`candidates.ts:46` 生成 `https://wow-analyzer.local/inferred/<hash>`；`kb/inferred/candidates-sample.md` 同理
- **期望 vs 实际**：候选不注入正式分析故当前无害；但**人工转正（candidate→active）时若未补真实出处**，会向报告注入死链
- **环境**：main 分支；属「转正流程」需注意项，非阻断
- **证据**：`candidates.ts:46`、`candidates-sample.md:7`

---

## 9. 结论

**达到可发布状态（mock 级）。** FR-11 与 FR-5 第三档的代码与测试全部通过，T14–T19 功能验收通过；缺陷均为内容质量/文档级（P1×1、P2×1、P3×2），无 P0 阻断。

**放行建议**：可进入下一阶段；D1/D2 建议在「补丁更新流程（调研员→主 Agent 审核→入库）」中一并修正火焰法师出处与「补丁变动」条目的溯源，不阻塞 mock 级发布。

**阶段 5（部署/真实环境）遗留**（本批沙箱无法执行，交接报告已列，QA 复核确认）：
1. 真实 `EMBEDDING_API_KEY`（SiliconFlow bge-m3）与真实 Supabase pgvector 迁移执行；
2. 真实 DeepSeek 跑 `npm run eval:intent`（双模式，知识依赖 ≥80% 放行）+ 报告 120s/问答 30s 压测 + 知识注入防提示词攻击实测；
3. `node scripts/ingest-kb.mjs` 在正常开发环境实跑（沙箱禁子进程，逻辑已由 `ingest.test.ts` 覆盖）。
