# 安全审计报告：WoW M+ AI 复盘教练（发布前）

> 阶段 4（开发与质量）· 环节⑦安全审计 · 独立审计员（与开发职责分离）
> 审计范围：D:\Workspace\wow-analyzer 全部 git 跟踪文件 + 运行配置 + 依赖
> 审计依据：docs/PRD.md（非功能需求-安全/隐私/合规）、docs/TECH-DESIGN.md、docs/DEV-HANDOVER-REPORT.md
> 审计日期：2026-08-19 · 结论版本：v1.0

## 一、审计结论（先看这里）

**未发现致命（Critical）与高危（High）问题。** 代码整体防御意识良好：密钥管理规范、无 SQL 注入、无 SSRF、无跨用户数据越权（IDOR）、无 XSS、依赖 0 已知漏洞、无 AGPL/GPL 传染性依赖。

**但存在 3 个中危（Medium）项，建议列为发布前置条件**（详见第四节 M-1/M-2/M-3），另有 6 个低危、8 个提示项需在发布前处理或记录备案。

**结论：代码层面达到"可发布安全基线"（附条件）**——即：完成 M-1、M-2、M-3 三项整改（或明确接受风险）后，方可进入阶段 5 发布。当前不建议直接上线生产。

---

## 二、逐项审计结果（含证据：文件:行号）

### 1. 密钥泄露 —— ✅ 通过（含 2 项提示）

- `.env*` 未入库：`git ls-files` 仅含 `.env.example`（值全空）；`.gitignore:34-35` 用 `.env*` + `!.env.example` 正确覆盖；`git check-ignore .env .env.local .env.production` 三者均被忽略。
- 历史密钥：`git log --oneline` 共 14 个提交，`git log --all --oneline -- '*.env' '.env*'` 仅命中 T1 提交（新增 `.env.example`），**无任何 `.env.local`/真实密钥进过历史**。
- 硬编码密钥扫描：`grep` 全仓库 `api_key|apiKey|secret|password|sk-|AKIA|-----BEGIN` 无匹配；命中的 `Bearer ${envConfig.xxx}` 均为运行时读环境变量（`src/lib/ai/provider.ts:63`、`src/lib/email/provider.ts:32`、`src/lib/wcl/adapter.ts:84`、`src/lib/turnstile/adapter.ts:26`）。
- NEXT_PUBLIC 泄露：`src/lib/env.ts:16-17,37` 仅将 `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`（Supabase 官方公开值）与 `NEXT_PUBLIC_TURNSTILE_SITE_KEY`（Turnstile 公开值）暴露给浏览器；`SUPABASE_SERVICE_ROLE_KEY / DEEPSEEK_API_KEY / RESEND_API_KEY / WCL_CLIENT_SECRET / TURNSTILE_SECRET_KEY` 全部为非 `NEXT_PUBLIC` 服务端变量，**未泄露服务端密钥**。且客户端组件（HomeUpload/ReportView/TopBar 等）无任何 `process.env` 服务端密钥引用。
- 提示 I-2：仓库根残留未跟踪调试产物 `.data-qa-report-body.json`、`.data-qa-test-output*.txt`（未纳入 `.gitignore`，`git add .` 可能误提交）。

### 2. 个人路径/敏感信息 —— ✅ 通过（1 项提示）

- 跟踪代码（`src/`）无 `C:\Users\`、邮箱、调试痕迹。
- 提示 I-1：本机路径 `D:\Workspace\wow-analyzer` 出现在 `docs/DEV-HANDOFF.md:8`、`docs/DEV-HANDOVER-REPORT.md:34`（内部交接文档，非敏感，建议发布前清理）。

### 3. 依赖安全 —— ✅ 通过

- `npm audit`：**0 漏洞**（info/low/moderate/high/critical 全 0，共 501 依赖）。
- 许可证：无 AGPL/GPL；仅 1 个 LGPL-3.0-or-later（`@img/sharp-win32-x64`，Next.js 图片优化的传递二进制包，LGPL 弱传染、以二进制动态链接使用不触发开源义务）。**解析器完全自研**（`src/lib/parser/`），未引入 WoWAnalyzer（AGPL）或未确认许可的 npm 解析器，符合 TECH-DESIGN 避坑决策。

### 4. OWASP 适用项

#### 4.1 注入 —— ✅ 通过（SQL/日志解析）/ ⚠️ 低危（LLM 提示注入）

- **SQL 注入：无。** 全部经 supabase-js 参数化查询（`.eq/.insert/.update/.delete`），无字符串拼接 SQL；迁移脚本 `supabase/migrations/0001_init.sql` 为静态 DDL + 触发器。
- **log 解析输入校验：通过。** 服务端只收结构化 JSON，`src/lib/parser/schema.ts:93` 用 zod 严格校验（字段类型/枚举/结构），`src/app/api/reports/route.ts:59` 拒绝非法结构；原始文件只在浏览器本地解析（`src/lib/parser/worker.ts`），永不上传。
- **LLM 提示注入：低危 L-4。** 问答将用户问题以 `玩家问题：${question}`（`src/lib/qa/service.ts:100`）直接拼入上下文，无明确"数据/指令"隔离边界；报告章节把全量结构化 JSON（含 WCL 报告标题/玩家名等外部可控字符串）拼入提示词（`src/lib/ai/prompts.ts:131-137`、`src/app/api/reports/from-link/route.ts:56-72`）。影响：仅作用于提问者本人的报告/问答（自服务），且 AI 输出经 React 转义渲染无 XSS；但恶意 WCL 标题/玩家名可诱导 AI 输出错误内容。加固建议：对问题与 log 文本做"不可信数据"定界包裹 + 服务端关键词/长度双重过滤（已有规则层守卫 `src/lib/qa/guard.ts`）。

#### 4.2 SSRF —— ✅ 通过

- WCL 链接仅用于解析 `code`（`src/lib/wcl/adapter.ts:39-50` 正则锚定 `warcraftlogs.com/reports/[A-Za-z0-9]+`），**fetch 目标主机硬编码**为 `www.warcraftlogs.com` / `cn.warcraftlogs.com`（`adapter.ts:61,79`），code 作为 GraphQL 变量传入（非拼 URL）。不 fetch 用户提供的 URL，无 SSRF。
- 提示 I-5：正则 `^https?://` 允许 `http://`（`adapter.ts:40`），虽无 SSRF 影响，建议收紧为 `https://`。

#### 4.3 失效访问控制 —— ✅ 通过（1 项中危 M-1）

- 受保护路由清单（均需登录，`getCurrentUser` 401）：`/api/reports`（GET/POST）、`/api/reports/[id]`（GET/DELETE）、`/api/reports/[id]/generate`、`/api/reports/[id]/chapters/[n]`、`/api/reports/[id]/qa`、`/api/reports/[id]/share`（POST/DELETE）、`/api/reports/from-link`、`/api/auth/me`。公开（设计如此）：`/api/health`、`/api/auth/request-code`、`/api/auth/verify-code`、`/api/auth/logout`、`/s/[token]`。
- **未发现未保护接口**：逐一核对全部 14 个 route 文件，除公开设计项外均含登录校验。
- 用户 A 访问 B 数据：服务层 `getReport(userId, id)` 先行属主校验再取关联数据（`src/app/api/reports/[id]/route.ts:23-29`），repo 层再按 `user_id` 过滤（`src/lib/db/supabase-repo.ts:102-110`），双重校验；非属主返回 404（不泄露存在性）。
- 分享 token 强度与撤销：`randomBytes(16)` → 128-bit/32 hex（`src/lib/share/service.ts:29-32`），不可枚举；开启/关闭即时生效（`share/route.ts:12-48`），删除报告级联失效（`0001_init.sql` 外键 ON DELETE CASCADE + `file-repo` 级联）。
- **中危 M-1（详见第四节）**：数据层以 service role 连接，绕过 RLS，实际隔离仅靠应用层过滤。

#### 4.4 敏感数据泄露 —— ✅ 通过（1 项低危 L-4）

- 错误响应：SSE `error` 事件回传 `err.message`（`src/app/api/reports/[id]/generate/route.ts:44-46` 等），其中 DeepSeek 错误携带上游 body 前 300 字符（`src/lib/ai/provider.ts:76`）——泄露上游服务细节，但**不含密钥、不含堆栈**。
- 分享页：`src/app/s/[token]/page.tsx` 只读渲染副本/层数/专精/角色名/章节/问答，**不含邮箱、历史列表等账户信息**，符合 FR-9（页面明确标注"不包含任何账户信息"）。角色名（游戏内角色名，非账号）会公开，属可接受范围。

#### 4.5 安全头 —— ⚠️ 低危（L-1、L-2）

- 已配置（`src/proxy.ts:12-29`）：`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy`、`Permissions-Policy`、CSP（default-src 'self' 等）。
- L-1：`proxy.ts:34` matcher 排除 `api` 前缀，**API/SSE 响应无安全头**。
- L-2：CSP `script-src` 含 `'unsafe-inline'`（`proxy.ts:21`），削弱 XSS 防护（Next.js 内联启动脚本所致，可评估 nonce）。

#### 4.6 滥用防护 —— ⚠️ 中危 M-3 / 低危 L-5、L-6

- 额度：每账号每日 3 次按用户时区自然日（`src/lib/quota/quota.ts:58-72`，Intl 时区边界二分 `quota.ts:37-47`）。
- Turnstile：配密钥强制、未配放行（`src/lib/turnstile/adapter.ts:14-16`）；客户端无 site key 时不生成 token（`src/lib/client/turnstile.ts:40-41`）。真实模式强制逻辑正确；风险在于"未配密钥静默放行"（见 M-2）。
- 验证码频控：邮箱 3 次/10min + IP 5 次/10min（`src/app/api/auth/request-code/route.ts:32-45`）+ 错 5 次锁 10 分钟（持久化 `src/lib/auth/guard.ts:63-73`）。
- **M-3**：额度计数"先数后插"非原子，并发可绕过 3 次/天；频控为进程内存（`guard.ts:19-41`），多实例失效。
- L-5：`x-forwarded-for` 取最左值直接信任（`request-code/route.ts:19`、`quota/enforce.ts:16`），透传代理下可伪造 IP。
- L-6：`req.json()` 无显式 body 大小上限（`reports/route.ts:49`），zod 字符串/数组无 `.max()`（`parser/schema.ts`）。

#### 4.7 上传与输入 —— ✅ 通过（1 项低危 L-6、1 项提示）

- 50K token 预算：客户端解析器硬压缩（`src/lib/parser/parser.ts:344-374`）→ 服务端 zod 校验 + 复算拒绝 413（`src/app/api/reports/route.ts:59-77`，`1 token ≈ 3 字符`，`src/lib/ai/tokens.ts`）。预算封顶存储数据约 150K 字符，**不可绕过**（校验基于序列化长度，非客户端自报）。
- 文件大小/格式：原始文件不上传（隐私设计）；`accept=".txt"` 与"≤200MB"仅为文案（`HomeUpload.tsx:205-213`），**无客户端大小硬校验**（提示级，仅影响本地解析体验，不影响服务端）。
- L-6（同上）：请求体无显式大小上限。

### 5. 其他

#### 5.1 会话 cookie 属性 —— ✅ 通过（1 项低危 L-3）

- mock 会话 cookie：`HttpOnly + SameSite=Lax + Secure(按 APP_URL) + Path=/`（`src/lib/auth/types.ts:39-63`），token 为 256-bit 随机（`mock-auth.ts:86`）。
- Supabase cookie：`@supabase/ssr` setAll 同样 `HttpOnly/SameSite=Lax/Secure`（`supabase-auth.ts:32-44`）。
- L-3：`Secure` 依赖 `APP_URL` 以 `https://` 开头（`types.ts:37`、`supabase-auth.ts:33`）；APP_URL 未配 https 时降级无 Secure。生产必须 `APP_URL=https://…`。

#### 5.2 .gitignore 覆盖 —— ✅ 通过（1 项提示 I-2）

- 已覆盖 `/node_modules`、`/.next/`、`/out/`、`.env*`（保留 `.env.example`）、`/.data/`、`*.pem`、`*.tsbuildinfo`（`.gitignore:1-45`）。
- I-2：仓库根 `.data-qa-*.json/.txt` 未被忽略（`.gitignore` 的 `/.data/` 只匹配目录，不匹配 `.data-*` 文件）。

---

## 三、通过项清单（审计确认安全）

| 项 | 结论 |
| --- | --- |
| 密钥管理 | 全部走环境变量，`.env*` 不入库，历史无密钥，NEXT_PUBLIC 无服务端密钥 |
| SQL 注入 | 无（全参数化） |
| SSRF | 无（fetch 主机硬编码，code 走 GraphQL 变量） |
| 跨用户越权（IDOR） | 无（服务层属主校验 + repo 层 user_id 过滤，双重） |
| XSS | 无 `dangerouslySetInnerHTML/innerHTML/eval`，AI 内容经 React 转义 |
| 分享 token | 128-bit 随机、可撤销、只读、不含账户信息 |
| 依赖漏洞 | `npm audit` 0 漏洞 |
| 传染性许可证 | 无 AGPL/GPL，仅 1 个 LGPL 传递二进制（sharp），解析器自研 |
| 原始文件隐私 | 浏览器本地解析，永不上传（FR-2 硬约束落实） |
| 输出封顶 | 1800 token/章 + 本地硬截断 |
| 违规内容 | 规则层 + 提示词层双守卫 |

---

## 四、问题清单（按严重度）

### 🔴 致命（Critical）
无。

### 🟠 高（High）
无。

### 🟡 中（Medium）

#### M-1 RLS 被 service role 绕过，隔离仅靠应用层过滤（纵深防御缺失、安全声明失真）
- **证据**：`src/lib/db/supabase-repo.ts:27-31`（`createClient(url, SUPABASE_SERVICE_ROLE_KEY)` 连接全部数据操作）；`supabase/migrations/0001_init.sql:98-211`（RLS 策略以 `auth.uid()` 判定，service role 天然绕过）；`docs/TECH-DESIGN.md:33,66` 与 `docs/DEV-HANDOVER-REPORT.md:48-49` 声称"RLS 天然实现用户 A 看不到用户 B"。
- **影响**：数据库层 RLS 对服务端路径**实际不生效**，隔离 100% 依赖应用层 `.eq("user_id", userId)` 过滤（当前完整正确，审计逐方法核对无遗漏）。但这是单点：未来任何新查询若漏加 user_id 过滤即产生 IDOR，且无 DB 层兜底；同时文档的安全承诺与实现不符。
- **修复建议**：① 用户作用域读取改用该用户的 JWT（anon key + `auth.getUser()` 返回的 access_token）让 RLS 真正执行；或 ② 保留 service role，但新增自动化测试/lint 强制"每个带 userId 的 repo 方法必须显式 user_id 过滤"，并把 TECH-DESIGN/交接文档的"RLS 隔离"表述更正为"应用层隔离 + RLS 仅对 anon 路径生效"。

#### M-2 生产缺 fail-fast：密钥缺失时静默降级 mock，鉴权/防滥用/持久化静默失效
- **证据**：`src/lib/env.ts:19-21`（supabaseEnabled）、`src/lib/db/index.ts:15-21`（缺 service role 回退 FileRepo）、`src/lib/auth/provider.ts:12-17`（缺 Supabase 回退 mock auth）、`src/lib/turnstile/adapter.ts:14-16`（无 secret 直接放行）、`src/app/api/health/route.ts:14-19`（对外暴露各服务 mock/real）。
- **影响**：部署漏配任一密钥，应用**不报错**而静默以 mock 运行——Turnstile 失效（可被脚本刷）、数据落本地 `.data/` 文件（serverless 下不共享/易丢失）、且存在"URL+anon key 已配但 service role 未配"时 auth=Supabase 真实、repo=FileRepo 的错配（登录成功但数据存本地）。
- **修复建议**：生产（`NODE_ENV=production`）启动时校验关键密钥（Supabase 三项、Resend、DeepSeek、Turnstile）齐全，缺任一则启动失败或 `/api/health` 返回 503，禁止静默 mock；把 `/api/health` 的 modes 从公开探针改为仅鉴权可读或移除。

#### M-3 每日额度 TOCTOU 并发绕过 + 频控进程内存级（生产多实例失效）
- **证据**：`src/lib/quota/quota.ts:58-72`（先 `listReportsByUser` 计数、后 `createReport` 插入，二者非原子）；`src/lib/quota/enforce.ts:24-32` 与 `src/lib/auth/guard.ts:19-41`（`windows` 内存 Map，进程级）。
- **影响**：并发请求可突破 3 次/天（放大 DeepSeek 调用成本）；IP/账号频控在 Vercel 多实例/冷启动下每实例独立计数，形同虚设。
- **修复建议**：每日额度改为原子计数（DB 唯一键按 `user_id + 时区日` 或事务 `select for update`）；频控迁移到分布式存储（如 Upstash Redis），否则在文档中明确"当前频控仅单实例有效、以每日额度为最终防线"。

### 🔵 低（Low）

- **L-1** 安全响应头未覆盖 API 路由：`src/proxy.ts:33-35` matcher 排除 `api`。→ 在 `next.config.ts` 加全局 headers 或扩展 matcher。
- **L-2** CSP `script-src 'unsafe-inline'`：`src/proxy.ts:21`。→ 评估 nonce 化或至少记录风险接受。
- **L-3** 会话 cookie `Secure` 依赖 APP_URL 为 https：`src/lib/auth/types.ts:37`、`supabase-auth.ts:33`。→ 生产强制 `APP_URL=https://…`。
- **L-4** SSE 错误事件回传上游错误细节：`src/app/api/reports/[id]/generate/route.ts:44-46`、`src/lib/ai/provider.ts:76`。→ 服务端统一友好文案，细节只写服务端日志。
- **L-5** `x-forwarded-for` 取最左值信任：`src/app/api/auth/request-code/route.ts:19`、`src/lib/quota/enforce.ts:16`。→ 信任平台注入的最右值或配置化 trusted proxy。
- **L-6** 请求体无显式大小上限：`src/app/api/reports/route.ts:49` + `src/lib/parser/schema.ts` 无 `.max()`。→ 加 body 大小上限与 schema `.max()`。

### ⚪ 提示（Info）

- **I-1** 本机路径 `D:\Workspace\wow-analyzer` 残留于 `docs/DEV-HANDOFF.md:8`、`docs/DEV-HANDOVER-REPORT.md:34`。
- **I-2** 仓库根未跟踪且未忽略的调试产物 `.data-qa-report-body.json`、`.data-qa-test-output*.txt`（合成样例数据，无密钥）；删除或加 `.data-*` 到 `.gitignore`。
- **I-3** mock 模式会话/验证码明文存本地 `.data/auth_kv.json`（仅开发；`.data/` 已忽略，生产用 Supabase 后不存在）。
- **I-4** `README.md` 仍为 create-next-app 模板（发布前需替换：项目说明、环境变量、隐私/免责、"非暴雪官方"声明）。
- **I-5** WCL 链接正则允许 `http://`（`src/lib/wcl/adapter.ts:40`），建议收紧为 `https://`。
- **I-6** 每章提示词重复嵌入全量 `combat+aggregate` JSON（`src/lib/ai/prompts.ts:131-137`、`src/lib/qa/service.ts:98`），成本约 6 倍放大，与设计"只发相关片段"不符（非安全问题，建议优化）。
- **I-7** 依赖含 1 个 LGPL-3.0 传递二进制 `@img/sharp-win32-x64`（Next.js 图片优化用，弱传染，不触发开源义务）——记录备案。
- **I-8** OTP 为 6 位数字 + 错 5 次锁 10 分钟（`src/lib/auth/types.ts:70-72`）：1M 空间 + 频控 + Turnstile 下风险可控，如需更强可加长或缩短 TTL。

---

## 五、发布前整改清单（建议作为阶段 5 前置条件）

1. [ ] M-2：生产 fail-fast 校验全部密钥，禁止静默 mock（**必须**）
2. [ ] M-3：额度计数原子化；频控明确其单实例局限或迁分布式（**必须**）
3. [ ] M-1：更正 RLS 安全声明，并补 DB 层隔离兜底或自动化过滤校验（**强烈建议**）
4. [ ] L-1/L-3：安全头覆盖 API + 生产 APP_URL=https 启用 Secure cookie（**必须**）
5. [ ] L-4：错误响应统一友好文案，上游细节只进日志
6. [ ] I-1/I-2：清理本机路径与根目录调试产物
7. [ ] I-4：替换 README（含"非暴雪官方"声明与部署说明）

> 备注：本审计未修改任何代码，仅出具报告。RLS 在真实 Supabase 上的执行效果（`0001_init.sql` 的 7 表策略）尚未在线上验证，属阶段 5 部署验证事项；审计已按迁移脚本静态核对策略正确性。
