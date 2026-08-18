# 社区打法知识库（RAG）可行性调研报告

> 调研对象：魔兽世界大秘境 AI 复盘教练 —「社区打法知识库」模块
> 调研日期：2026 年 8 月
> 调研员：虚拟产品团队·调研子 Agent

---

## A 版本与攻略源（含源优先级列表）

### A1. 当前版本（2026 年 8 月）

- **资料片**：《魔兽世界：至暗之夜》（World of Warcraft: Midnight），当前补丁 **12.1**（诅咒 Ula'tek / Curse of Ula'tek 更新，并开放蛇岛）。
- **大秘境赛季**：**Midnight 第 2 赛季（Season 2）**，于 2026 年 8 月 18 日那周上线（NA 服务器 8 月 18 日维护后解锁 S2，低保/词缀规则同步变更）。
- 来源：
  - [Icy Veins — Everything Unlocking This Week in WoW: Midnight Season 2](https://www.icy-veins.com/wow/news/everything-unlocking-this-week-in-wow-midnight-season-2-and-the-rewards-you-can-earn/)
  - [Wowhead CN — 8 月 18 日 S2 维护公告](https://www.wowhead.com/cn/news/4-hours-of-scheduled-maintenance-for-na-servers-on-august-18th-for-season-2-382484)
  - [Method.gg — WoW Midnight Season 2 Mythic+ Dungeon Rotation](https://www.method.gg/guides/wow-midnight-season-2-mythic-dungeon-rotation)
  - [163 网易 — 12.1 首周低保规则突变（蓝贴）](https://www.163.com/dy/article/L388DM6H0526CPHV.html)
  - [IGN LATAM — Midnight 12.1 上线](https://latam.ign.com/world-of-warcraft-midnight/114128/isla-serpenteante-world-of-warcraft)

### A2. 中文攻略源（首发国服优先）

1. **NGA（bbs.nga.cn）** — 国服第一手、最活跃的中文职业攻略社区。
   - 现状：**活跃**，各职业版面持续产出「精华帖」（如 12.0 至暗之夜 S1 三系猎人发育攻略、痛苦术进阶、暗牧大秘境指南等），是「意图模式/爆发规划/副本机制」类战术知识密度最高的来源。
   - 结构/API：**无官方公开 API**，但有社区逆向整理的接口文档（[AgMonk/nga-api-doc](https://raw.githubusercontent.com/AgMonk/nga-api-doc/main/README.md) 及 README_v2），也有第三方 [NGA MCP Server](https://raw.githubusercontent.com/yixiaowang2001/nga-mcp-server/main/README.md)。页面是传统论坛 HTML，无结构化数据导出。
   - 抓取态度：有反爬（反机器人）机制，ToS 不允许大规模爬取；**人工整理 + 周期性回看精华帖更新**是现实路径。
   - 样本：[NGA 12.0 至暗之夜 S1 三系猎人发育攻略 By Luna](https://bbs.nga.cn/read.php?tid=46306031&rand=899#1)
2. **Wowhead 中文站（cn.wowhead.com）** — 有简体中文数据库、蓝贴追踪与部分职业指南页；近期还上线了繁体中文资料库。中文站以「数据查询 + 蓝贴翻译」为主，职业指南页多为英文站内容的翻译/镜像，深度战术（意图模式、爆发规划）不如 NGA 精华帖细。
   - 来源：[Wowhead CN 蓝贴追踪](https://www.wowhead.com/cn/blue-tracker/topic/us/midnight-season-1-mythic-now-available-2265758)、[PTT 关于 Wowhead 繁体中文数据库](https://www.pttweb.cc/bbs/WOW/M.1744607461.A.3BA#1)
3. **B 站攻略 up 主** — 视频生态，头部且持续产出大秘境战术的 up 主有「**天空大秘境**」（战士 T 视角、高层限时教学、MDT 路线、副本精简教学）等；整体是「视频 + 第一视角」为主，**无结构化数据**，适合人工看稿提炼要点。
   - 样本：[天空大秘境 — 12 通灵限时教学/高层 MDT 路线](https://www.bilibili.com/video/BV1MU1RYZERp/)、[天空大秘境 — 战士T 圣焰隐修院抗怪](https://www.bilibili.com/video/BV1a7RRYHE5A/)
4. **网易大神 / 官方攻略** — 网易大神有攻略社区，暴雪官方有论坛与蓝贴；17173 / B 站游戏中心（biligame）也有中文聚合攻略（如「12.0 全职业 40 专精天赋推荐」）。适合做「补位与版本变更速览」。
   - 样本：[17173 — Midnight 12.0.5 全职业最佳天赋指南](https://news.17173.com/content/04222026/062553649.shtml)、[网易大神/17173 — 12.0 全职业 40 专精天赋](https://www.17173.hl.cn/intel-station/mssj120zazyqzy40zjtftjszby/)

### A3. 英文攻略源

1. **Wowhead（wowhead.com）** — 最权威的综合站，有全职业/专精 class guides、M+ 副本指南、蓝贴追踪与数据挖掘（datamining）。
2. **Icy Veins（icy-veins.com）** — 结构最清晰、定期更新的职业/专精指南与赛季速览，适合做「结构化对照源」。
3. **Method.gg** — 头部公会的 M+ 路线/赛季轮换等指南。
4. **各职业 Discord 资源汇总站** — 如德鲁伊的 [Dreamgrove.gg（Resto Druid Compendium）](https://www.dreamgrove.gg/blog/resto/compendium)，各类职业 Discord 是「意图模式/爆发规划」最前沿但最零散的一手来源。
5. **SkyCoach** — 代练/辅导服务，非公开知识库，价值有限。

### A4. 内容获取方式与抓取政策

- **Wowhead**：**无官方公开 API、未提供 XML sitemap**（[scorank 对 wowhead.com 的扫描报告](https://scorank.com/resources/pdf-reports/wowhead.com_851257.pdf) 明确「no XML Sitemap found」）；页面数据（含 power.js 等）可被浏览器读到，但 **ToS 明确禁止抓取/导出**，datamining 属灰色地带。官方合规路线是 **Blizzard Developer API**（develop.battle.net），但它只提供游戏数据（物品/法术/角色/排行榜），**不含攻略文本**。
  - 相关讨论：[Wowhead 论坛 — Scraping items data](https://www.wowhead.com/fr/forums/topic/scraping-specific-items-data-from-wowhead-337684)、[Blizzard 论坛 — Developer API ToU](https://us.forums.blizzard.com/en/blizzard/t/questions-about-blizzard-developer-api-terms-of-use/57897)
- **NGA**：无官方公开 API，有社区逆向接口文档；有反爬与 ToS 限制，**不适合自动抓取**。
- **结论**：攻略类文本（意图模式、爆发规划）本质是「编辑/玩家撰写的内容」，无法通过 Blizzard 官方 API 获得；两个主要候选源（Wowhead / NGA）都**不支持合规自动抓取**。因此对个人开发者而言，**「人工整理 + 定期更新」的工作流是现实且推荐的**：攻略更新频率本就按赛季/热修节奏（约每周热修 + 每赛季大更），人工维护几千到几万条片段完全可行，且能保证「领域知识依赖型战术意图」这类高质量、需专业判断的内容质量。

### A5. 建议源优先级列表（3-5 个）

| 优先级 | 来源 | 定位 | 获取方式 |
|---|---|---|---|
| 1 | **NGA 各职业版精华帖** | 国服中文、意图模式/爆发规划最详实 | 人工整理精华帖，周期回看 |
| 2 | **Wowhead（中文站 + 英文站）职业指南** | 权威、结构化、有数据支撑 | 人工整理 + Blizzard API 辅助元数据 |
| 3 | **B 站头部 up 主（天空大秘境等）** | 高层实战路线/第一视角 | 人工看稿提炼要点 |
| 4 | **Icy Veins** | 结构清晰、赛季速览、对照校准 | 人工整理 |
| 5 | **17173 / biligame / 网易大神** | 中文聚合、版本变更速览 | 人工整理（补位） |

---

## B 存储与检索（结论 + 推荐）

### B1. Supabase 免费层 + pgvector

- **支持 pgvector**：是。Supabase 是托管 Postgres，`pgvector` 扩展在所有套餐（含免费层）可一键开启，直接用 SQL 做向量检索，且可与业务表同库共存。
- **免费额度**：500 MB 数据库、2 个免费项目、**无流量费用**；免费项目**约 1 周无活动会自动暂停**（可手动唤醒）。Pro 档 $25/月。
- 来源：[Supabase Pricing](https://supabase.com/pricing)、[Supabase Vector 免费 API（DEV）](https://dev.to/0012303/supabase-vector-has-a-free-api-build-ai-search-in-minutes-ckh)、[2026 Supabase 免费层解读](https://uibakery.io/blog/supabase-pricing)

### B2. 其他免费/低成本备选

- **Cloudflare Vectorize**：免费档为**每月 500 万「被查询向量维度」+ 免费存储 10 万条向量**（超出按维度计费）。适合 Cloudflare 生态（配 Workers AI 嵌入 + AI Gateway），但绑定 Cloudflare，单飞集成不如 Supabase 顺。
  - 来源：[Cloudflare Vectorize Pricing](https://developers.cloudflare.com/vectorize/platform/pricing/)
- **Pinecone**：Starter 免费档约 10 万向量 / 2GB，无需绑卡；超量需付费。**Qdrant Cloud**：免费 1GB / 1 集群。**Weaviate Cloud**：免费 Sandbox 多为 14 天试用或 25 万对象上限。
  - 来源：[OpenHelm — Pinecone vs Weaviate vs Qdrant vs Chroma](https://www.openhelm.ai/blog/pinecone-vs-weaviate-vs-qdrant-vs-chroma-vector-search)、[awesome-rag-production 向量库对比](https://github.com/Yigtwxx/awesome-rag-production/blob/main/vector-database-comparison.md)
- **自托管 sqlite-vec**：SQLite 的向量扩展（[sqlite-vec](https://pkg.go.dev/github.com/viant/sqlite-vec) 由 Alex Garcia 维护），单文件、零成本、无网络依赖，适合本地/离线/原型，[LangChain 有集成](https://docs.langchain.com/oss/python/integrations/vectorstores/sqlitevec)；缺点是无托管、多机/并发扩展弱。

### B3. 结论（针对「个人开发者 + 几千到几万条片段 + 每次分析检索 top 5-10」）

- **最简单可靠 = Supabase 免费层 + pgvector**：几万条 768~1024 维向量占用远低于 500MB；一套 Postgres 同时承担业务数据 + 向量检索 + RLS 权限，免运维、免费、SQL 直观，后续要上规模也能平滑升 Pro。唯一注意点是**免费项目 1 周不活跃会暂停**，需定期触发或升 Pro。
- **零成本纯本地备选 = SQLite + sqlite-vec**：若想完全离线、不发任何数据出本地，用 sqlite-vec 单文件即可，代码也最简单。
- 不建议首发就用 Pinecone/Qdrant/Weaviate 托管向量库（无必要复杂度）；Cloudflare Vectorize 只有在整套后端已选 Cloudflare 时才划算。

---

## C 嵌入模型（对比表 + 推荐）

### C1. 候选对比

| 方案 | 中文效果 | 价格 | 免费额度 | 稳定性/备注 |
|---|---|---|---|---|
| **SiliconFlow（硅基流动）BGE 系列**（`BAAI/bge-large-zh-v1.5`、`BAAI/bge-m3`） | ★★★★★ 中文专用/多语 M3 均强 | 极便宜，量级每百万 tokens 不足 ¥1（约 0.0007 元/千 tokens，以官方价格页为准） | 新用户送免费额度（约 ¥14） | 国内直连、对国服产品最稳；bge-m3 还支持多语言 + 稠密/稀疏/多向量混合检索 |
| **Jina Embeddings**（`jina-embeddings-v2-base-zh` 中文专用 / `v3` 多语） | ★★★★☆ | 免费额度后付费 | **每月 100 万 tokens 免费** | API 稳定、有中文专用模型，适合起步白嫖 |
| **OpenAI text-embedding**（`-3-small` / `-3-large`） | ★★★☆☆（多语可用，中文非最专） | small $0.02/百万、large $0.13/百万 tokens | 无长期免费，仅新账户试用金 | 生态成熟，但国服产品需代理、成本高于 BGE |
| **Cloudflare Workers AI**（`@cf/baai/bge-*-en` / `bge-m3`） | ★★★★☆（靠 bge-m3 多语覆盖中文） | 免费档额度 | **每日免费额度**（历史 1 万 neurons/天，2026 报道约 10 万次/天） | 适合已在 Cloudflare 生态内；bge-m3 可做中文，但有日配额 |
| **Voyage / Cohere**（`voyage-multilingual-2` / `embed-multilingual-v3`） | ★★★☆（多语通用，非中文主打） | 付费 | 少量试用金 | 非中文最优解，不优先 |

### C2. 推荐

- **首选：SiliconFlow 的 BGE 系列（`bge-m3` 或 `bge-large-zh-v1.5`）** — 中文效果最好、几乎免费、API 国内直连最稳定，与「国服中文玩家」产品定位完全契合。若需要多语言（后续做英文对照源），选 `bge-m3`；纯中文选 `bge-large-zh-v1.5`。
- **免费起步备选：Jina `jina-embeddings-v2-base-zh` / `v3`** — 每月 100 万 tokens 免费，足够覆盖几千到几万条片段的首次向量化 + 增量更新。
- 来源：[SiliconFlow 模型中心](https://siliconflow.cn/models)、[Jina AI 免费 API（1M tokens）](https://yangmao.ai/en/providers/jina-ai/free-api/)、[OpenAI text-embedding-3-small 模型页](https://developers.openai.com/api/docs/models/text-embedding-3-small)、[Cloudflare Workers AI 免费额度](https://yangmao.ai/zh/providers/cloudflare-workers-ai/)、[免费向量库 + 免费 Embedding API 组合指南](https://yangmao.ai/en/blog/free-embedding-vector-db-guide/)

### C3. DeepSeek 官方嵌入 API

- **确认：没有。** DeepSeek 官方 API 只提供对话模型（deepseek-chat / deepseek-reasoner），**不提供 embedding 端点**；官方仓库明确「there is no dedicated embedding for any of the deep seek models」。
- 来源：[deepseek-ai/DeepSeek-V3 Issue #806](https://github.com/deepseek-ai/DeepSeek-V3/issues/806)、[Milvus — What APIs does DeepSeek provide](https://milvus.io/ai-quick-reference/what-apis-does-deepseek-provide-for-model-access)
- 因此 RAG 的「向量化」必须外接嵌入模型（即 C2 推荐），DeepSeek 只负责最终「生成/问答」环节。

---

## 综合建议（RAG 技术栈一句话方案 + 风险）

**一句话方案**：用 **SiliconFlow 的 `bge-m3`（或 `bge-large-zh-v1.5`）做中文嵌入 → Supabase 免费层 + `pgvector` 存片段并检索 top 5-10 → 把命中片段注入 DeepSeek 提示词做「领域知识依赖型战术意图」识别与复盘问答**；攻略内容以 **NGA 精华帖 → Wowhead 指南 → B 站头部 up 主** 为优先级，**人工整理 + 按赛季/热修节奏定期更新**入库。

**风险与注意事项**：
1. **版权/抓取合规**：Wowhead 与 NGA 均禁止自动抓取，务必走「人工整理」而非爬虫；攻略文本是玩家/编辑原创内容，公开产品需注意标注来源、避免整篇复制。
2. **免费层休眠**：Supabase 免费项目 1 周不活跃会暂停，需做健康心跳或尽早升 Pro（$25/月）；Cloudflare Workers AI 有日配额，批量向量化几十万条时可能撞限，改用 SiliconFlow 按量付费更省心。
3. **版本漂移**：攻略按赛季/热修高频变化，知识库必须带「版本/补丁」字段并定期失效重建，否则 AI 会引用过期打法。
4. **嵌入模型切换成本**：不同嵌入模型的向量不可混用，选型后若要换模型需全量重建向量；建议一开始就锁定 bge 系列。

---

## 来源链接

- [Icy Veins — Midnight Season 2 解锁](https://www.icy-veins.com/wow/news/everything-unlocking-this-week-in-wow-midnight-season-2-and-the-rewards-you-can-earn/)
- [Wowhead CN — 8/18 S2 维护公告](https://www.wowhead.com/cn/news/4-hours-of-scheduled-maintenance-for-na-servers-on-august-18th-for-season-2-382484)
- [Method.gg — Midnight S2 M+ 副本轮换](https://www.method.gg/guides/wow-midnight-season-2-mythic-dungeon-rotation)
- [163 网易 — 12.1 低保规则蓝贴](https://www.163.com/dy/article/L388DM6H0526CPHV.html)
- [IGN LATAM — Midnight 12.1](https://latam.ign.com/world-of-warcraft-midnight/114128/isla-serpenteante-world-of-warcraft)
- [NGA 精华帖样本 — 12.0 至暗之夜三系猎人](https://bbs.nga.cn/read.php?tid=46306031&rand=899#1)
- [nga-api-doc（社区逆向接口）](https://raw.githubusercontent.com/AgMonk/nga-api-doc/main/README.md)
- [NGA MCP Server](https://raw.githubusercontent.com/yixiaowang2001/nga-mcp-server/main/README.md)
- [PTT — Wowhead 繁体中文资料库](https://www.pttweb.cc/bbs/WOW/M.1744607461.A.3BA#1)
- [B 站 — 天空大秘境 12 通灵限时教学](https://www.bilibili.com/video/BV1MU1RYZERp/)
- [17173 — 12.0.5 全职业天赋指南](https://news.17173.com/content/04222026/062553649.shtml)
- [Dreamgrove.gg — Resto Druid Compendium](https://www.dreamgrove.gg/blog/resto/compendium)
- [scorank — wowhead.com 无 sitemap 报告](https://scorank.com/resources/pdf-reports/wowhead.com_851257.pdf)
- [Wowhead 论坛 — Scraping items data](https://www.wowhead.com/fr/forums/topic/scraping-specific-items-data-from-wowhead-337684)
- [Blizzard 论坛 — Developer API ToU](https://us.forums.blizzard.com/en/blizzard/t/questions-about-blizzard-developer-api-terms-of-use/57897)
- [Supabase Pricing](https://supabase.com/pricing)
- [Supabase Vector 免费 API（DEV）](https://dev.to/0012303/supabase-vector-has-a-free-api-build-ai-search-in-minutes-ckh)
- [2026 Supabase 免费层解读](https://uibakery.io/blog/supabase-pricing)
- [Cloudflare Vectorize Pricing](https://developers.cloudflare.com/vectorize/platform/pricing/)
- [OpenHelm — 向量库对比](https://www.openhelm.ai/blog/pinecone-vs-weaviate-vs-qdrant-vs-chroma-vector-search)
- [awesome-rag-production 向量库对比](https://github.com/Yigtwxx/awesome-rag-production/blob/main/vector-database-comparison.md)
- [sqlite-vec](https://pkg.go.dev/github.com/viant/sqlite-vec)
- [LangChain SQLiteVec 集成](https://docs.langchain.com/oss/python/integrations/vectorstores/sqlitevec)
- [SiliconFlow 模型中心](https://siliconflow.cn/models)
- [Jina AI 免费 API（1M tokens）](https://yangmao.ai/en/providers/jina-ai/free-api/)
- [OpenAI text-embedding-3-small](https://developers.openai.com/api/docs/models/text-embedding-3-small)
- [Cloudflare Workers AI 免费额度](https://yangmao.ai/zh/providers/cloudflare-workers-ai/)
- [免费向量库 + 免费 Embedding 组合指南](https://yangmao.ai/en/blog/free-embedding-vector-db-guide/)
- [deepseek-ai/DeepSeek-V3 Issue #806（无 embedding）](https://github.com/deepseek-ai/DeepSeek-V3/issues/806)
- [Milvus — DeepSeek 提供哪些 API](https://milvus.io/ai-quick-reference/what-apis-does-deepseek-provide-for-model-access)
