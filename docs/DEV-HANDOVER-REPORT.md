# 开发交接报告（DEV-HANDOVER-REPORT）

> 由开发窗口撰写，交回虚拟产品团队做 QA 验收与安全审计。
> 依据：docs/DEV-HANDOFF.md · docs/PRD.md · docs/TECH-DESIGN.md · docs/tasks.md
> 日期：2026-08-19 · 分支：main（13 个任务各一个 Conventional Commit）

## 一、结论

**13 个开发任务（T1–T13）全部完成**：`npm run build` 通过、单元测试 81/81 通过、
FR-5 意图识别样例集评测 16/16（100%，QA 阈值 ≥80%）、上传解析 → 生成报告 → 问答 → 分享
的 mock 全流程已在本机自测跑通。产品档案（docs/ 下既有文档）未做任何修改。

## 二、完成情况与验证方式（逐任务对照 tasks.md 验收标准）

| 任务 | 完成内容 | 验证方式 |
| --- | --- | --- |
| T1 | Next.js 16 App Router + TS 仓库、git、`.env.example`/`.env.local` 隔离、`GET /api/health` | build ✓；`/api/health` 实测返回 `{"ok":true}` 及各服务 mock/real 模式；**Vercel 部署为阶段 5 事项（无账号）** |
| T2 | 7 表 SQL 迁移（可重复执行：if not exists / drop policy if exists）+ RLS（仅对 anon 客户端直连路径生效）+ 应用层 user_id 过滤隔离 + FK 级联 + profile 触发器；Repo 接口双实现（Supabase / 本地文件） | `file-repo.test.ts`：A/B 用户隔离、级联删除、章节 upsert 幂等（4 用例）；**RLS 策略真实执行需部署阶段在 Supabase 上验证** |
| T3 | Supabase passwordless OTP（生产路径）+ Resend REST 适配器 + mock 认证；登录/登出/me 接口；错 5 次锁 10 分钟；邮箱/IP 频控 | `auth.test.ts` 10 用例（锁定、TTL、频控、会话生命周期）；HTTP 实测：发码→验证→会话→登出后 401 |
| T4 | 自研 COMBAT_LOG_EVENT 解析器（纯函数）+ Web Worker 分块解析 + FR-10 白名单降噪（打断/死亡/爆发/易伤全保留，普通施放与伤害按分钟聚合） | `parser.test.ts` 11 用例：5 个合成样例（含 1.2MB 噪声文件）——战斗列表正确、**token ≤50K 且缩减 ≥90%**、时间戳一致、噪声不入结构化数据、团本/无效文件明确报错 |
| T5 | 6 章并行流式 SSE（章节独立存储、幂等跳过、单章重试接口、1800 token 输出封顶、章节级切片 + 共享前缀命中 DeepSeek 上下文缓存、tokens/cost 落库） | `generate.test.ts` 7 用例（幂等、单章重试、输出封顶、切片预算）；HTTP 实测 SSE：6 章并行生成、`done` 事件、章节 tokensIn/Out/cost 可见 |
| T6 | FR-5 意图引擎（10 意图模式 + 6 失误模式，先查战术合理性再下结论）、16 条样例集（eval/intent-samples.json）、评测脚本 | `npm run eval:intent` 实测 16/16=100%；`intent-engine.test.ts` 19 用例（含 PRD 经典 5:36 案例：归入意图并解释、真实失误不误判） |
| T7 | 问答流式 SSE、上下文组装（切片+最近 8 轮）、10 轮上限、违规双重守卫（规则层+提示词层）、"通用建议非本场数据"标注 | `qa.test.ts` 8 用例；HTTP 实测：爆发问题回答带时间戳与技能证据、代练问题被拒、剩余轮数回传 |
| T8 | WCL v2 适配器（OAuth client_credentials + GraphQL，www/cn 双域）、链接校验、团本/无效链接/获取失败三种明确中文提示、对比基准失败降级 | `adapter.test.ts` 6 用例；HTTP 实测 from-link 创建（含国服链接）、失败降级文案 |
| T9 | 每账号每日 3 次（按用户时区自然日，Intl 时区边界二分）、用尽精确提示、Turnstile 适配器（配密钥强制，mock 放行）、登录/创建接口 IP+账号频控 | `quota.test.ts` 6 用例（时区边界、跨日恢复）；HTTP 实测第 4 次创建被 429 拒绝且文案与 PRD 一致 |
| T10 | 历史列表/详情/删除接口（级联删除章节/问答/分享，属主校验） | 复用 `file-repo.test.ts` 级联与隔离用例 + 接口层 404 隔离测试（T13） |
| T11 | 128-bit 随机 token（32 hex）、`GET /s/:token` 公开只读分享页、开启/关闭即时生效 | `share.test.ts` 4 用例（200 个 token 唯一、关闭立即失效、删除级联失效）；HTTP 实测开关后公开页即时切换 |
| T12 | 首页（WCL 链接 / 文件上传+Worker 进度+战斗列表选择+专精修正）、报告页（章节进度+SSE 流式渲染+单章重试+问答+分享+删除）、我的复盘、登录页、政策/协议/免责页；响应式；页面均含"非暴雪官方"声明 | 全部页面 HTTP 实测 200；报告生成/问答/分享交互经 API 实测；声明文案在布局统一渲染（首页实测包含） |
| T13 | 全局安全头（CSP/禁内嵌/nosniff）、受保护接口未登录 401 审计测试（10 个接口）、接口层 A/B 数据隔离（404）、50K token 预算服务端再校验（413）、中文 404/错误页、隐私/协议/免责文案 | `audit.test.ts` 4 用例；HTTP 实测安全头、未登录 401、404 中文页 |

## 三、运行方式（原窗口 QA 自测）

```bash
cd <项目目录>
npm install
npm run dev          # 或 npm run build && npm start（本机用 PORT=3100，避免与现有 3080 冲突）
```

- **mock 模式即开即用**：无需任何密钥。登录验证码打印在服务端控制台（`[email:mock]` 行，6 位数字）。
- 首页「上传文件」需要真实 WoWCombatLog.txt；没有时可用 `npx tsx` 调
  `src/lib/parser/samples.ts` 生成合成样例文件自测解析。
- 测试：`npm test`（81 用例）；意图评测：`npm run eval:intent`。

## 四、遗留事项（全部属于"阶段 5 部署阶段配置真实密钥"，架构已预留）

1. **Supabase**：创建项目后执行 `supabase/migrations/0001_init.sql`，配置
   `NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY`，
   数据层与账号体系自动切换为真实实现（db/index.ts、auth/provider.ts 工厂，业务代码零改动）。
   RLS 策略已写好但**未在真实 Supabase 上执行验证**（本机无 supabase CLI/docker）。
   注意：服务端经 service role 连接（RLS 对服务端路径不生效），数据隔离由应用层显式
   user_id 过滤保证；RLS 仅对 anon 客户端直连路径生效。
2. **Resend**：配置 `RESEND_API_KEY + EMAIL_FROM` 即真实发验证码；同时把 Supabase Auth
   SMTP 指到 Resend（TECH-DESIGN 方案）。
3. **DeepSeek**：配置 `DEEPSEEK_API_KEY`（可选 `DEEPSEEK_BASE_URL/DEEPSEEK_MODEL`）即真实
   流式生成；上下文缓存由服务端自动命中（章节共享前缀）。**QA 阶段需以真实模型跑**
   `npm run eval:intent`（≥80% 放行）与报告 120s/问答 30s 压测（Vercel 60s 余量风险见 TECH-DESIGN）。
4. **WCL**：申请 v2 client 后配置 `WCL_CLIENT_ID/SECRET`；当前 mock 返回合成数据。
5. **Turnstile**：配置 `NEXT_PUBLIC_TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY` 后登录/创建接口强制人机验证（脚本请求将被 403）。
6. **Vercel 部署**（阶段 5）：关联 GitHub、配置上述环境变量、`APP_URL=https://…`（自动给
   会话 cookie 加 Secure）、自定义域名与国内访问优化、成本面板。
7. **真实 log 回归**：解析器按公开 COMBAT_LOG_EVENT 格式实现并用合成样例测试；QA 阶段请用
   ≥3 个真实 log（含噪声、200MB 级）复跑 FR-2/FR-10 验收（token ≤50K、缩减 ≥90%、时间戳一致）。
8. 已知取舍：WCL 链接源只有元数据（无事件级时间线，AI 会按"数据不足"回答）——按 TECH-DESIGN
   "WCL 只做轻量查询、文件上传为主数据源"；mock 数据层为本地 JSON 文件（生产自动切 Supabase）。
9. 已知取舍：邮箱/IP 频控为进程内存（**仅单实例有效**），每日额度已原子化计数
   （daily_usage 唯一键 + RPC 原子递增）作为最终防线。

## 五、批次 5（RAG 社区知识库，T14–T19）追加

> 追加日期：2026-08-19 · 范围：FR-11 知识库 + FR-5 第三档"疑似高阶技巧"（含用户补充要求：
> meta 增 origin/status、双源目录、status=active 过滤、T19）。基线：原有 87 用例全绿（现 132 用例）。

### 完成情况与验证方式

| 任务 | 完成内容 | 验证方式 |
| --- | --- | --- |
| T14 | 迁移 `0003_kb_documents.sql`（pgvector + kb_documents：chunk_text/embedding vector(1024)/meta(jsonb，含 class/spec/dungeon/patch/type/source_url/**origin/status**)/source_hash 唯一键；余弦检索函数 match_kb_documents；**服务端专用：无 RLS 且显式 revoke anon/authenticated**）；KbStore 接口 + FileKbStore（关键词匹配 mock）+ SupabaseKbStore | `file-store.test.ts` 12 用例：命中/空结果/class-spec-dungeon-type-patch 过滤/**status=active 默认过滤（候选绝不注入）**/top-k≤5/幂等 upsert/patch 比较；迁移可重复执行（if not exists / create or replace） |
| T15 | SiliconFlow bge-m3 适配器（OpenAI 兼容 `{base}/v1/embeddings`，1024 维；无密钥 mock 确定性伪向量）；`scripts/ingest-kb.mjs`（frontmatter 校验→分节切块→嵌入→source_hash 幂等 upsert）；**双源目录互不覆盖**：kb/sources/（curated→active）与 kb/inferred/（inferred→candidate），各含骨架样例；EMBEDDING_API_KEY/BASE_URL/MODEL + ACTIVE_PATCH 环境变量与生产 fail-fast | `ingest.test.ts` 12 用例：frontmatter 必填校验、节内覆写、长节切块、**真实目录入库两次幂等（第二次 0 新增）**、**双目录互不覆盖（curated 检索不含 candidate）**、mock 嵌入 1024 维确定性；**沙箱内 tsx 子进程受限**，脚本逻辑由测试全量覆盖（正常开发环境可直接 `node scripts/ingest-kb.mjs`） |
| T16 | 检索服务：query=class/spec+副本+章节/问答 → 嵌入 → top-k≤5；**仅注入 status=active**；patch 过滤（ACTIVE_PATCH 优先，缺省库内最新非 general；patch=general 始终可见）；注入格式：`【社区攻略参考】…【/社区攻略参考】` 定界 + 逐条"参考社区攻略：source_url"标注 + 系统指令声明数据区无指令效力（防提示词注入）；第 5 章与问答注入；降级（空库/未命中/嵌入或检索失败 → 仅 log 证据，不报错） | `retrieval.test.ts` 7 用例（定界/来源/≤5、候选不注入、ACTIVE_PATCH 切换、未命中 null、检索异常降级）；`rag-injection.test.ts` 端到端：第 5 章知识意图标注来源、问答回答含"参考社区攻略"；原 87 用例全绿 |
| T17 | intent-samples.json 新增 **5 个领域知识依赖型意图案例**（赌 buff 聚怪、留爆发对齐下一波易伤、资源循环停手、延后打断控链、宠物提前就位）+ 配套 kbFixtures + **1 个疑似案例**；评测双模式（A 无检索 / B 有检索）输出对比 | `intent-eval.test.ts`：知识依赖样例**注入知识后正确率 100%（≥80%）**、无检索时 0%（体现注入价值）、非知识依赖样例 ≥80%、疑似案例两模式均判"疑似"不判失误 |
| T18 | 初始知识库内容：**火焰法师（12 条）/ 兽王猎人（11 条）/ 防护战士（11 条）**，均为至暗之夜 12.1 大秘境 S2 要点摘要（意图模式/爆发规划/资源管理/副本机制/补丁变动），frontmatter 带 patch=12.1 + 出处链接（NGA/Wowhead/B 站等，取自调研报告） | `ingest.test.ts` 内容合规用例：3 个文件 ≥10 条/文件、patch=12.1、source_url http(s)、单条 ≤1200 字符（要点摘要非整篇搬运）；出处链接来源见 docs/rag-community-knowledge-feasibility.md（QA 可打开验证） |
| T19 | 第 5 章提示词**三档结论**：正确决策 / 可改进点 / **疑似高阶技巧**（知识库解释不了但证据链完整 → "疑似技巧+证据+推断理由"，不武断判失误）；疑似发现**幂等落库** origin=inferred、status=candidate（绝不注入正式分析）；mock 提供器同步实现（宠物提前就位样例：判疑似而非失误；知识解释同一事件时自动升为意图） | `candidates.test.ts` 5 用例（判定、落库可查、正式检索不注入、幂等）；`rag-injection.test.ts`：第 5 章同时出现"✅ 正确决策（参考社区攻略）"与"🔎 疑似高阶技巧"，候选落库 1 条且重跑不重复；样例 `suspected-01` 判疑似不判失误 |

### 批次 5 遗留事项（阶段 5 部署/QA 执行）

1. **真实嵌入密钥**：配置 `EMBEDDING_API_KEY / EMBEDDING_BASE_URL / EMBEDDING_MODEL`（SiliconFlow bge-m3）
   后嵌入走真实 API；生产 fail-fast 已含这三项（缺任一拒绝以 mock 运行）。
2. **真实 Supabase pgvector 迁移执行**：`supabase/migrations/0003_kb_documents.sql` 需在 Supabase
   控制台启用 pgvector 扩展并执行（本机无 supabase CLI/docker，未实测执行；文件可重复执行）。
   同理 `0002_daily_usage.sql`。
3. **真实模型 QA**：配置 DeepSeek 后跑 `npm run eval:intent`（双模式对比；知识依赖案例 ≥80% 放行）、
   报告 120s/问答 30s 压测；重点核查**知识注入防提示词攻击**（数据区指令隔离）与疑似技巧输出格式。
4. **入库流程运维**（正常开发环境执行）：`node scripts/ingest-kb.mjs`（双目录、幂等）；
   补丁更新 SLA ≤1 周由调研员→主 Agent 审核→入库；候选技巧转正走主 Agent 初审 + 内测专家终审。
5. **构建说明**：本沙箱禁止子进程，`npm run build` 的类型检查步骤 spawn EPERM（编译已通过
   "✓ Compiled successfully"）；以 `node node_modules/typescript/bin/tsc --noEmit`（通过，exit 0）
   + 132/132 测试全绿作为类型与回归证据；正常环境请复跑 `npm run build`。
