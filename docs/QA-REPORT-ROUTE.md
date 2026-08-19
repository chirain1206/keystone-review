# QA 报告：路线指纹与相似度（批次 6+7：T20–T23）

> 独立 QA 工程师验收 · 未参与本批代码编写
> 验收依据：docs/tasks.md（T20–T23 验收标准，唯一依据）、docs/PRD.md（FR-12 / FR-11 / FR-10）、docs/TECH-DESIGN.md（ADR-003）
> 结论前置：**mock 级达到可发布状态**，无阻塞缺陷；4 项低/中严重度遗留如实记录。

---

## 0. 环境与回归

| 项 | 命令 | 结果 |
|---|---|---|
| 全量测试 | `npm test` | ✅ **165/165 通过**（23 个测试文件） |
| 类型检查 | `node node_modules/typescript/bin/tsc --noEmit` | ✅ 退出码 0，无类型错误 |
| 生产构建 | `npm run build` | ✅ 退出码 0，路由清单正常 |
| 意图评测单独跑 | `npx vitest run src/lib/ai/intent-eval.test.ts` | ✅ 1/1 通过（规则引擎基线双模式，≥80% 阈值断言通过） |

注：全量测试已包含意图评测（intent-eval.test.ts），单跑为回归确认；真实模型评测（DEEPSEEK_API_KEY）仍属阶段 5，本批次不涉及。

---

## 1. T20 端到端实测（主动挖掘工具）

### 实测过程
1. 构造 3 份合成 log（复用 mine.test.ts 同款"转阶段前宠物提前就位"场景）：`log1.txt`（宠物 178/182/186s 位移）、`log2.txt`（176/180/184s）、`control.txt`（无宠物位移）。
2. 运行 `npx tsx scripts/mine-patterns.mjs log1 log2 control --class=Hunter --spec="Beast Mastery" --patch=12.1 --out=<temp>`。

### 实测结果（逐条对照 T20 验收标准）

| 验收点 | 结果 |
|---|---|
| 多 log 输入 → 重复模式检测 | ✅ 检出 1 个重复模式「宠物提前就位」 |
| 证据汇总（N/M 份 log，锚点前 X±Y 秒） | ✅ `2/3 份 log 中，在「Vulnerable」前 23±2 秒出现「宠物提前就位」` |
| 置信度评分 | ✅ 80%（≥ 高置信阈值 0.7） |
| 幂等写入 kb/inferred/ | ✅ 首次"已写入"；重复运行"已存在（幂等跳过）"，写入候选 0 |
| origin=inferred / status=candidate | ✅ 由入库目录 `kb/inferred/` 决定（ingest-kb.mjs 硬编码 inferred→candidate，见下） |
| source_url=internal:inference | ✅ 写入 frontmatter（实测文件已核对） |
| 单份对照不误报 | ✅ 仅 control.txt → `未发现重复模式` |

### 关键机制确认（origin/status 来源）
- `buildCandidateMarkdown` 的 frontmatter 仅含 `class/spec/dungeon/patch/type=intent_pattern/source_url=internal:inference`，**不含 origin/status**。
- origin/status 由 `scripts/ingest-kb.mjs` 的目录映射决定：`kb/sources → curated/active`、`kb/inferred → inferred/candidate`；`ingest.ts` 的 `runIngest` 用目录参数覆写 `finalMeta.origin/status`，且 `source_hash` 含 origin/status，保证两目录互不覆盖。
- 结论：**设计正确**——候选条目绝不会因 frontmatter 笔误被误入 active 池；`source_url=internal:inference` 是 `assertSafeSourceUrl` 放行的内部约定值。

---

## 2. T21 战术波还原（chain 检测）

### 逻辑审查（tactical-pulls.ts）
- **进战斗判定**：以 `touch()` 记录怪物 GUID 首次出现在任意 COMBAT_LOG_EVENT 的毫秒时间戳（`firstMs`），并按 `guidType === "creature"` 过滤，符合"怪物首次进入战斗毫秒级时间戳"。
- **濒死代理**：`nearDeath = 已死亡数(且 deathMs ≤ 当前新怪 firstMs) / 当前波怪物数 ≥ 0.5`。注释明确"未来死亡不计入"，避免把同波稍后自然死亡误判为接波——**逻辑正确**。
- **拆分条件**：`gap ≥ 15s（自然脱战）或 nearDeath（chain 接波）` → 拆新波；`chainFromPrev` 仅 nearDeath 为 true（自然脱战不算 chain）。BOSS 自成一波作时间锚。
- **FR-10/token 预算兼容**：本模块是独立小结构、按需计算，不写回 FR-10 结构化数据（parser.ts 产出的 `processed_logs`），不占 token 预算。✅

### 测试验证（tactical-pulls.test.ts，4 用例全绿）
- ✅ chain 样例（两波被断后接上合成一波）→ 正确拆回两波，`pulls[1].chainFromPrev === true`，起止时间正确。
- ✅ 纯单波样例不误拆（多怪同时进战斗仍为单波）。
- ✅ BOSS 自成一波（ENCOUNTER_START 标记）。

### 领域观察（非阻塞）
- **"濒死"仅用死亡事件代理，无血量百分比**：真实 M+ 的 chain 常是"当前波残血（未死）时坦克提前接下一波"，此时无 UNIT_DIED，`nearDeath=false` 且 gap<15s → 会被合并为单波。此为 by-design 简化，由指纹的"合波/拆波不敏感"兜底（见 T22），对路线比对结论无实质影响。**严重度 Low**。

---

## 3. T22 路线指纹与相似度 + 阵容画像

### 指纹与相似度（fingerprint.ts）
- **指纹构成**：每波 = 怪物签名（name+count）+ `relTime`（进本归一化 0–1）+ `bossAnchor`（之前 boss 波数）；另存 `trashWaves` 过滤。✅
- **相似度公式**：`0.5 × 内容重叠（怪物多重集 Jaccard）+ 0.5 × 顺序相似（压平怪物名序列 LCS 归一）`。✅
- **合波/拆波不敏感推理正确**：压平序列 + 多重集天然忽略波次边界——同一批怪无论拆成几波，压平顺序与多重集不变。实测：合波 `[AA DD]` vs 拆波 `[AA][DD]` → 相似度 **1.0**。✅
- **法刀大波 vs 菜刀短平快（不同怪物集）→ 低相似**：不同怪物名 → 多重集重叠 0、LCS 0 → 相似度 0。✅
- **差异清单**：Needleman-Wunsch 波级对齐（模糊匹配奖励 + 缺口惩罚 0.6）产出 extra-a / extra-b / composition；"内容 vs 顺序"落差判 order 差异。测试验证多/少哪波、顺序差异均正确。✅

### 阵容画像与相似度（comp-profile.ts）
- **"可替换职业"规则 = 伤害类型分布（0.7）+ 功能性重叠（0.3）**：不查具体职业身份，只看近战/远程分布 + 功能标签并集。实测菜刀队 `Rogue → Paladin` 互换 → 相似度 **0.876**（≥0.6 阈值）。✅ 覆盖常见菜刀近战互换。
- **法刀 vs 菜刀 → 低相似**：分布差异 1.0 → dmgSim=0 → 相似度 0。✅
- **粗标签仅辅助**：`ranged≥3 → 法刀；melee≥3 → 菜刀；否则混合`，不强制二分。✅

### 领域判断（有魔兽知识）
- ⚠️ **Shaman 归类为 `ranged`（领域错误）**：增强萨（Enhancement）是近战专精，但画像把萨满整类归远程。因解析器当前 `spec 恒为 "Unknown"`，无法区分增强/元素；含增强萨的菜刀队会被误计入远程位，可能翻转"法刀/菜刀"标签并降低与其它菜刀队相似度。**建议**：`Shaman` 改为 `hybrid`（更稳妥的中性默认），待 spec 补全后细分。**严重度 Medium（领域正确性）**。
- ⚠️ 次要：`Hunter` 归 ranged（生存猎 Survival 为近战）、`Paladin` 归 melee（神圣骑 Holy 为远程治疗）、`Monk` 归 melee（织雾 Mistweaver 偏远程）——均为 best-effort 简化，spec 未知前提下可接受。**严重度 Low**。
- ✅ 13 个职业全覆盖，无遗漏；未知职业（Unknown/空）不参与画像（有测试）。

### 观察（非缺陷）
- ⚠️ **`relTime`/`bossAnchor` 已计算但 `routeSimilarity` 未使用**：当前相似度只看怪物构成+顺序，不看"哪一段 boss 锚/归一化时间"。同怪物同顺序但不同波次段（如把同一批怪在 1 号 boss 前 vs 3 号 boss 前拉）会判为相似度 1.0。时间锚目前是"存储供后续/展示"，未参与判定。**严重度 Low**（FR-12 验收未要求时间维度判别，属已知简化）。
- ⚠️ 文档不一致：`WaveSignature.npcs` 注释"按 name 排序"与实现"保持拉怪进入顺序"矛盾（实现正确——顺序信息供压平序列对齐）。**严重度 Trivial**。

---

## 4. T23 推荐排序与挖掘分组

### recommend.ts
- ✅ 排序：`rankReferences` 按 `combined`（可用维度均值）降序，`combined=null` 者排最后（`?? -1`）。
- ✅ 降级：无任何可用维度 → `combined=null`、`note=null`，不抛错不阻塞；部分维度可用仍给出参考（有测试）。
- ✅ 单测：排序正确（same 第一、no-data 最后）、全缺维度降级、部分维度降级——4 用例全绿。

### grouping.ts
- ✅ 贪心聚类：以组内首个成员指纹为代表，`routeSimilarity ≥ 0.6` 判同组；同路线不同波次（合波变体）归同组。
- ✅ 无路线数据 → 独立组（`sameRoute=false`），**不丢数据源**（有测试：4 个输入全保留）。
- ✅ 端到端：实测 3 份同路线 log（1 boss 结构）正确归 1 组一起挖掘。

### from-link 对比链路降级行为（如实记录遗留）
- `wcl/adapter.ts` 的 `getWclReportMeta` 仅返回元数据（副本/层数/词缀），`playerClass/playerSpec` 均为 `"Unknown"`，**无事件流、无阵容、无 pull/NPC 数据**。
- 因此粘贴 WCL 链接作为对比目标时，`route` 与 `comp` 均为 null → `compareReference` 返回 `combined=null/note=null`，**当前无法对 from-link 目标计算任何相似度**，只能降级不阻塞。
- **遗留项（部署阶段补）**：需补 WCL v2 `ReportDungeonPull/ReportDungeonPullNPC/ReportFight`（含玩家 roster）字段，才能给 from-link 目标算路线/阵容相似度。本批次的推荐/分组纯函数已就绪，本地原始 log 路径可用（T20 已实测）。**严重度 Medium（遗留，非本批缺陷）**，已在 recommend.ts 头注释与 ADR-003 中如实标注。

---

## 5. FR-12 Given-When-Then 对照表

| # | Given / When / Then | 结果 | 证据 |
|---|---|---|---|
| 1 | Given 两份"战术上同路线"但 WCL 波次不同的 log（一份中途交减伤断了 chain）When 比对 Then 路线相似度 ≥ 判定阈值 | ✅ | T21 chain 拆分正确（tactical-pulls.test.ts）；T22 合波 vs 拆波 → 相似度 1.0（route.test.ts 断言 ≥0.6 且 ≈1） |
| 2 | Given 阵容相似但个别职业可替换（菜刀队近战互换）When 比对 Then 阵容相似度高；法刀大波 vs 菜刀短平快则低 | ✅ | 菜刀 Rogue→Paladin 相似度 0.876；法刀 vs 菜刀 相似度 0（route.test.ts / comp 断言均过） |
| 3 | Given 用户上传 log 与多个候选参考 log When 选对比目标 Then 给出"路线+阵容相似度"参考排序 | ✅（本地）/ ⚠️（from-link） | rankReferences 降序、无数据排最后（recommend.test.ts）；但 from-link 目标当前无 route/comp → 降级为 null（遗留，见 §4） |
| 4 | Given 挖掘工具处理多份 log When 分组素材 Then 同路线 log（哪怕波次不同）归同组一起挖掘，不丢数据源 | ✅ | groupByRoute 不丢数据源（recommend.test.ts）；端到端 3 份同路线 log 归 1 组挖掘 |

FR-11 候选沉淀（origin/status/source_url）与 FR-10 token 预算兼容性均已在 §1、§2 逐条确认。

---

## 6. 缺陷清单（五要素 + 严重度）

| # | 现象 | 影响 | 定位 | 建议 | 严重度 |
|---|---|---|---|---|---|
| 1 | Shaman 整类归 `ranged`，增强萨实为近战 | 含增强萨的菜刀队近战/远程分布失真，可能翻转"法刀/菜刀"标签、降低同菜刀队相似度 | comp-profile.ts `CLASS_ATTRS.Shaman` | 改 `hybrid`；spec 补全后再按专精细分 | **Medium**（领域） |
| 2 | from-link 对比目标无事件/阵容数据，无法算相似度 | 粘贴 WCL 链接作对比时只能降级为 null，体验不完整 | wcl/adapter.ts（仅元数据，playerClass=Unknown） | 部署阶段补 WCL ReportDungeonPull/NPC/Fight roster 字段 | **Medium**（遗留，非本批缺陷） |
| 3 | chain"濒死"仅用死亡事件代理，无血量 | 真正"残血未死即接波"会被合并为单波 | tactical-pulls.ts | 可选：解析 SPELL_DAMAGE 血量近似濒死；由指纹合波/拆波不敏感兜底 | Low（by-design） |
| 4 | `relTime`/`bossAnchor` 计算但相似度未使用 | 同怪物同顺序但不同 boss 段/时间会判高相似 | fingerprint.ts `routeSimilarity` | 后续将 boss 锚段/时间纳入相似度权重 | Low |
| 5 | `WaveSignature.npcs` 注释"按 name 排序"与实现不符 | 文档误导 | fingerprint.ts 行 22 | 改注释为"保持拉怪进入顺序" | Trivial |

**结论：无阻塞性缺陷（无 ❌）。** 缺陷 2 为已文档化的部署阶段遗留；缺陷 1 为领域正确性建议，建议在 spec 数据补全前以 `Shaman→hybrid` 一行修复降低误判面。

---

## 7. 总结论

- 全量测试 165/165、tsc、build、intent-eval 全部通过。
- T20 端到端实测：多 log 检测 → 证据汇总 → 置信度 → 幂等写入 → 单份不误报，**全部符合验收标准**。
- T21/T22/T23 逻辑与测试均达验收标准；差异清单、可替换职业、排序、分组、降级行为正确。
- FR-12 四条 Given-When-Then 本地路径全部 ✅；from-link 路径因数据缺失降级（已如实记录）。
- **达到 mock 级可发布状态**；上表 5 项为建议性/遗留项，不阻塞本批次交付。
