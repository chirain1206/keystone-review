# 技术设计：WoW M+ AI 复盘教练（暂名）

> 阶段 3（技术设计）产出 · 版本 v1.0 · 依据 docs/PRD.md
> 所有技术决策由主 Agent 做出并已通过架构评审子 Agent 交叉审查。

## 方案概述（大白话）

一个网页应用：用户打开网页 → 粘贴 Warcraft Logs 链接、或在浏览器里选择自己的战斗日志文件（文件在**本地解析**，原始文件不上传）→ 系统把日志整理成精简数据 → AI（DeepSeek）生成 6 章复盘报告（**6 章并行生成**，边生成边显示）→ 用户可在报告页继续提问。

整件事用一套技术做完（前后端一体），部署在免费云平台上，基础设施费用 0 元，唯一的花销是 AI 调用费（估算每月 15–30 美元，按 1000 次复盘/月）。

## 架构评审记录（子 Agent 交叉审查）

评审结论：方案可行，提出 8 处调整，**全部采纳**：

| # | 评审意见 | 采纳情况 |
| --- | --- | --- |
| 1 | FR-10"缩减≥90%"验收不充分，改用 token 预算（≤50K token） | ✅ 已改 PRD FR-10 |
| 2 | 200MB 原始文件不应上传，改为浏览器 Web Worker 本地解析，只传结构化 JSON | ✅ 已改 PRD FR-2 与本文档 |
| 3 | 逐章生成重复发上下文会超支（~$90/月），需开上下文缓存 + 每章只发相关片段 | ✅ 见"成本模型" |
| 4 | Vercel 60s 上限 + vercel.app 国内不可直连：需输出封顶 + 自定义域名 + 兜底方案 | ✅ 见"风险与对策" |
| 5 | WCL API 拉全量事件最耗配额最脆弱：文件上传为主数据源，WCL 只做轻量查询 | ✅ 见"数据获取" |
| 6 | Supabase 免费档邮件有频率限制：接 Resend 免费档 SMTP | ✅ 见"技术选型" |
| 7 | 分享链接需 128-bit 随机 token 防枚举、可撤销 | ✅ 见"数据模型" |
| 8 | 缺降级与防滥用：指数退避重试 + 历史缓存 + Turnstile 防刷 | ✅ 见"风险与对策" |

## 技术选型（选什么 / 为什么 / 放弃什么）

| 选型 | 选择 | 为什么 | 放弃的选项 |
| --- | --- | --- | --- |
| 框架 | **Next.js（App Router）+ TypeScript**，前后端一体 | 一个仓库、一次部署、一种语言；AI 辅助开发最熟悉；Vercel 一键部署 | 静态前端+独立后端（多一套部署运维，违背 KISS）；SvelteKit（AI 熟悉度低） |
| 部署 | **Vercel Hobby（免费档）**，fluid compute，函数 maxDuration=60s | 免费；流式响应可跑满时长；与 Next.js 原生契合 | Render 免费档（15 分钟休眠冷启动，对 p95 指标致命）；纯 Cloudflare Workers（CPU 计费模型不适合解析类代码，但作为流式接口兜底） |
| 数据/账号 | **Supabase 免费层**：Postgres + Auth（passwordless 邮箱验证码 OTP，天然满足"无密码"）+ Storage（几乎不用，原始文件不上传） | 免费额度充足（DB 500MB、MAU 50k）；OTP 现成；RLS 行级安全（仅对 anon 客户端直连路径生效） | 自建后端鉴权（工作量大）；Firebase（国内访问差） |
| 邮件 | **Resend 免费档 SMTP**（3000 封/月） | Supabase 内置邮件限流（约 2 封/小时/用户）且易进垃圾箱；Resend 免费档够用 | 自建邮件服务（过度设计） |
| AI | **DeepSeek deepseek-chat，流式输出，开启上下文缓存** | 流式支持、128K 上下文、价格极低（输入 $0.28/M，缓存命中 $0.028/M，输出 $0.42/M）；缓存命中价是未命中的 1/10 | GPT/Claude（贵 5–10 倍）；本地模型（个人开发者不可运维） |
| 日志解析 | **自研 TypeScript 解析器**（浏览器 Web Worker 内分块解析 WoWCombatLog.txt，格式为公开规范 COMBAT_LOG_EVENT） | 避开许可证风险；只解析需要的子集，简单可控 | WoWAnalyzer 解析器（**AGPL-3.0 传染性协议，服务端引用有开源义务风险**）；npm wow-combat-log-parser（活跃度低、许可证未确认） |
| WCL 数据 | **WCL v2 GraphQL API**（免费注册 client；cn 与 www 同一套 API） | 官方途径，合规 | 爬取网页（脆、合规风险） |
| 防滥用 | **Cloudflare Turnstile**（免费人机验证） | 免费、体验好 | 付费验证码服务 |
| 知识库存储/检索 | **Supabase pgvector**（调研确认免费层支持；注意免费层 1 周不活跃会暂停，部署阶段处理） | 复用现有 Supabase，不引入新服务；几千~几万片段规模足够 | Pinecone/Weaviate（多一套服务、付费）；SQLite+sqlite-vec（本地备选） |
| 嵌入模型 | **SiliconFlow bge-m3**（1024 维，调研确认：中文效果最佳、几乎免费、国内直连稳；备选 Jina 免费档） | 中文效果好 + 极低价 + API 稳定；DeepSeek 官方无嵌入 API | OpenAI embeddings（英文为主、按量付费） |

## 系统架构

```
浏览器（用户）
 ├─ 页面：首页上传 / 战斗选择 / 报告页(章节+问答) / 我的复盘 / 分享页
 ├─ Web Worker：本地解析 log 文件 → 结构化 JSON（FR-10）
 └─ 直连 Supabase Auth（登录态）+ 调 Vercel API（流式 SSE）

Vercel（Next.js 服务端，免费档 60s/函数）
 ├─ API：报告创建 / 章节生成(流式) / 问答(流式) / 历史 / 分享
 ├─ 调用：DeepSeek API（流式）、WCL v2 API（轻量）、Turnstile 验证
 └─ 数据：Supabase Postgres（应用层 user_id 隔离；RLS 兜底 anon 直连路径）

外部服务
 ├─ DeepSeek：deepseek-chat 流式（报告生成、问答）
 ├─ WCL v2 API：报告元数据 + 对比基准（失败可降级）
 └─ Resend：验证码邮件
```

### 核心决策：报告 6 章并行生成（ADR-001）

- **决策**：6 章报告由服务端**并行**发起 6 个 DeepSeek 流式调用，汇成一条 SSE 流返回浏览器；每章独立存储、独立断点重试。
- **理由**：单章输出约 1800 token ≈ 40–60 秒（正好顶在 Vercel 60s 上限边缘）；若 6 章串行总时长 4–6 分钟，违反 PRD"报告 p95 ≤120s"。并行后总时长 ≈ 最慢一章 ≈ 60s。
- **成本**：每章只发该章相关的数据片段（不是全量 50K），共享前缀命中 DeepSeek 上下文缓存，单次复盘总成本约 $0.02–0.03。
- **放弃项**：串行逐章（超时）；单次生成整份报告（输出 6–12K token，100–200s，顶破 60s）。

### 核心决策：社区打法知识库 RAG（ADR-002，用户拍板"一步到位"）

- **背景**：战术意图分两类——"时间轴可推理型"（爆发药对齐易伤，log 内证据可判）与"领域知识依赖型"（如某职业怪聚齐前打资源/赌 buff 触发、聚齐后带最佳增益爆发——log 只记录动作，不记录原因）。后者必须依赖社区打法知识。用户拍板：一步到位做完整 RAG。
- **决策**：建立"职业/专精打法知识库"（意图模式、爆发规划、资源管理、副本机制要点、补丁变动），分析时按"专精/副本/可疑操作"检索 top-k（k≤5）注入提示词。
- **内容与更新（知识保鲜闭环，非一次性注入）**：调研确认当前为《至暗之夜》补丁 12.1、大秘境第 2 赛季；来源优先级 **NGA 各职业精华帖 > Wowhead 中/英文指南 > B站（头部攻略 up）> Icy Veins > 17173/网易大神**。所有站点无公开 API、ToS 禁止爬取 → 全自动抓取不可行，保鲜靠三层机制：
  1. **补丁触发更新（主通道）**：补丁/热修上线 → 调研员按 patch notes + 社区差异起草 → 主 Agent 审核 → 入库，SLA ≤1 周；
  2. **社区反哺**（阶段 7 运营搭通道）：玩家反馈新手法/纠错 → 团队验证 → 入库；
  3. **log 数据挖掘**（远期第二版）：从顶尖玩家 log 聚类"新兴打法模式"，自动产出候选知识条目。
  **版本治理**：kb_documents.meta.patch 标记内容版本；检索默认只注入活跃补丁内容（部署变量 ACTIVE_PATCH），跨版本通用知识（如职业资源循环原理）标记 patch=general；旧内容保留不物理删除（可回滚）；ingest 脚本按 source_hash 幂等重建。**只存要点摘要与出处链接，不整篇搬运**（版权合规）。详细调研见 docs/rag-community-knowledge-feasibility.md。
- **存储与检索**：Supabase pgvector（调研确认免费层支持；片段 = 文本 + meta（class/spec/dungeon/patch/type/source_url）+ bge-m3 嵌入（1024 维））；运行时只查自己的库（无 SSRF）；免费层 1 周不活跃暂停 → 部署阶段加保活 cron 或接受冷启动。
- **嵌入**：SiliconFlow bge-m3（中文最佳、几乎免费；备选 Jina 免费档）；DeepSeek 无嵌入 API（已核实），必须外接。
- **安全**：知识库内容为**外部不可信数据**——与用户 log 同样做数据/指令隔离，防提示词注入；注入片段带来源标注；入库前人工审核。
- **降级**：知识库为空/未命中 → 仅 log 证据分析，不报错（FR-11）。
- **成本**：嵌入调用按条计费（入库一次性），检索每次查询 1 次嵌入调用，预估 $0–5/月。
- **放弃项**：运行时实时抓取攻略站（SSRF/版权/不稳定）；纯 prompt 内置知识（过时不可维护）；自托管嵌入模型（运维负担）。

## 数据模型（Supabase Postgres，服务端经 service role 连接，数据隔离由应用层显式 user_id 过滤保证；RLS 仅对 anon 客户端直连路径生效）

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| profiles | id, email, timezone, created_at | 用户档案（时区用于"每天 3 次"计数） |
| reports | id, user_id, source_type(file/link), dungeon, level, spec, result, status, compare_meta jsonb, created_at | 一次复盘 = 一条 report |
| processed_logs | report_id(唯一), events jsonb, summary jsonb, raw_size, token_estimate | FR-10 预处理后的结构化数据（原始文件永不入库） |
| report_chapters | report_id, chapter_no(1–6), title, content, status, tokens_in/out, cost | 章节独立存储 → 断点重试 |
| conversations / messages | report_id, role, content, created_at | 问答记录（单场 ≤10 轮） |
| shares | report_id, token(128-bit 随机), enabled, expires_at | 分享链接：防枚举、可撤销、只读 |
| kb_documents | chunk_text, embedding vector, meta jsonb(class/spec/dungeon/patch/type/source_url) | FR-11 知识库片段（团队维护，非用户数据；pgvector 检索） |

## 接口契约（API 清单）

| 接口 | 说明 |
| --- | --- |
| POST /api/reports（JSON） | 接收浏览器解析好的结构化数据（服务端校验 ≤50K token 预算）→ 建 report |
| POST /api/reports/from-link | 粘贴 WCL 链接 → 拉元数据（副本/层数/角色专精）+ 可选对比基准；事件拉取失败/配额不足 → 降级提示改用文件 |
| POST /api/reports/:id/generate（SSE 流式） | 并行生成 6 章，逐章回传进度；已生成章节跳过（幂等） |
| POST /api/reports/:id/chapters/:n（SSE 流式） | 单章重试接口（某章失败只重跑该章） |
| POST /api/reports/:id/qa（SSE 流式） | 问答：上下文 = 结构化事件切片 + 前几轮；≤10 轮；违规问题礼貌拒绝 |
| GET /api/reports、GET /api/reports/:id、DELETE /api/reports/:id | 历史列表 / 详情 / 删除（级联删分享与问答） |
| POST/DELETE /api/reports/:id/share | 开启/关闭分享 |
| GET /s/:token（页面） | 公开分享页：免登录只读，无任何写操作 |

## 失败场景与对策

| 场景 | 对策 |
| --- | --- |
| 某章生成超时/失败 | 章节独立状态，客户端显示"第 N 章失败，点击重试"，只重跑该章 |
| DeepSeek 限流/不可用 | 指数退避重试 ×3 → 标记失败提示稍后重试；**历史报告可正常查看（本地缓存）**，不做多模型切换（KISS） |
| 用户生成中途关页面 | 章节已存库，重开报告页即可续看/续跑 |
| WCL API 配额耗尽/失败 | 降级：提示"请改用文件上传"或"本场不含对比章节"，不阻塞复盘 |
| 知识库未命中/为空 | 降级为"仅 log 证据分析"，不报错（FR-11） |
| 恶意刷接口 | Turnstile 人机验证 + 每账号每日 3 次 + IP/邮箱频控 |
| 分享链接被猜/泄露 | 128-bit 随机 token 不可枚举；用户随时关闭 |

## 成本模型（月，按 1000 次复盘估算）

| 项 | 成本 |
| --- | --- |
| Vercel Hobby + Supabase 免费层 + Cloudflare 免费 + Resend 免费档 | $0 |
| DeepSeek（每场 6 章约 $0.02–0.03，含缓存命中） | $20–30 |
| 问答（假设场均 3 轮） | 含在上项量级内 |
| 知识库嵌入/检索调用 | $0–5 |
| **合计** | **约 $20–35/月** |

## 风险与对策

| 风险 | 对策 |
| --- | --- |
| Vercel 60s 上限余量薄（单章 40–60s） | 每章输出封顶 1800 token + QA 阶段压测；若实测超时，把流式接口单独搬到 Cloudflare Worker（无 wall-clock 上限），其余架构不动 |
| vercel.app 域名国内间歇不可直连 | 绑定自定义域名 + Cloudflare 加速（阶段 5 处理）；文档说明国服访问注意事项 |
| DeepSeek 价格/模型变动 | 模型名走配置项，随时可换；成本面板监控（阶段 5） |
| WCL API 配额/条款不确定 | 只做轻量查询；文件上传为主数据源；申请 client 时确认配额 |
| AGPL 传染 | 解析器完全自研，仅参考公开格式规范 |
| Supabase 免费层配额（DB 500MB） | 只存结构化数据（原始文件不落库）；超限后升级付费档（$25/月）也在预算内 |
| 战术意图识别准确率不达标 | 样例集（≥10 案例 + FR-11 新增 ≥5 个知识依赖型案例）在 QA 阶段实测，通过率 ≥80% 才放行（FR-5/FR-11） |
| 知识库内容被提示词注入 | 数据/指令隔离 + 入库人工审核 + 来源标注；安全审计复检该链路 |
| 攻略内容版权 | 只存要点摘要 + 出处链接，不整篇搬运；报告引用标注来源 |
| 打法知识随补丁过时 | 片段带 patch 版本元数据；团队补丁周期更新流程（≤1 周） |

## 部署形态（阶段 5 执行）

- 代码仓库：GitHub 公开（含 README/LICENSE/CHANGELOG）
- 部署：Vercel（关联 GitHub 自动部署）+ Supabase 项目 + DeepSeek/Resend/WCL 密钥（环境变量）
- 域名与国服访问优化在阶段 5（发布准备）处理
