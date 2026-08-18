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
