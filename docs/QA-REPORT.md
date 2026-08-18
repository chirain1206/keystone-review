# QA 验收报告：WoW M+ AI 复盘教练

> 阶段 4（开发与质量）QA 环节 · 独立 QA 工程师产出（与开发职责分离）
> 日期：2026-08-19 · 依据 docs/PRD.md（FR-1~FR-10 唯一验收标准）、docs/tasks.md、docs/TECH-DESIGN.md、docs/DEV-HANDOVER-REPORT.md
> 环境：DSH 沙箱 · Next.js 16.3.1 `next start -p 3101`（mock 模式，无任何真实密钥）· Node v24.19.0

---

## 一、测试执行结果

| 项 | 结果 |
| --- | --- |
| 命令 | `node --import ./scripts/sandbox-shim.mjs ./node_modules/vitest/vitest.mjs run --pool=threads` |
| 测试文件 | 12 passed |
| 用例 | **82 passed / 0 failed** |
| 耗时 | 430ms（transform 755ms） |
| 退出码 | 0 |

测试文件明细：smoke(2)、intent-eval(1)、wcl/adapter(6)、ai/intent-engine(19)、parser(11)、quota(6)、db/file-repo(4)、share(4)、auth(10)、qa(8)、security/audit(4)、report/generate(7)。

**结论：全部单元/集成测试通过，无失败用例。**

---

## 二、端到端 HTTP 流程结果（http://127.0.0.1:3101，mock 模式）

| # | 步骤 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | GET /api/health | ✅ 200 | `{"ok":true,"service":"wow-analyzer","modes":{"supabase":"mock","ai":"mock","email":"mock","wcl":"mock","turnstile":"mock"}}` |
| 2 | GET /api/reports（未登录） | ✅ 401 | `{"ok":false,"error":"请先登录"}` |
| 3 | GET /api/auth/me（未登录） | ✅ 401 | `{"ok":false,"error":"未登录"}` |
| 4 | POST /api/auth/request-code | ✅ 200 | `{"ok":true,"mockMode":true}`；验证码打印于服务端日志 `[email:mock]` 行 |
| 5 | POST /api/auth/verify-code（正确码） | ✅ 200 | 建立会话 cookie `wa_session` |
| 6 | GET /api/auth/me（带会话） | ✅ 200 | `{"ok":true,"user":{"id":"mock-m8084y","email":"qa-e2e-user@test.local"}}` |
| 7 | POST /api/reports（创建复盘） | ✅ 200 | `{"ok":true,"id":"79d687be-…"}` |
| 8 | POST /api/reports/:id/generate（SSE） | ✅ 200 | 6 章全部 `done`；最终 `event: done` status=ready；第 3 章（无对比）直接 done |
| 9 | 报告详情（6 章内容） | ✅ | 章节顺序 1–6、中文、技能名保留原名、可改进点带时间戳、第 5 章意图识别 |
| 10 | QA 提问（爆发为什么打低） | ✅ | 回答带时间戳 2:05/4:05/10:36 Combustion + 技能证据，roundsLeft=9 |
| 11 | QA 违规问题（代练） | ✅ refused | `event: refused` reason=代练 + 礼貌拒绝文案 |
| 12 | QA 笼统问题（上 3000 分） | ✅ | "（此为通用建议，不是基于本场数据；跨场综合分析将在后续版本提供。）" |
| 13 | QA 10 轮上限 | ✅ | Q1–Q10 ok（roundsUsed 1→10）；Q11 refused "本轮对话已结束，可重新开始。" |
| 14 | 分享开启 | ✅ 200 | 返回 32 位 hex token（128-bit） |
| 15 | 公开分享页（有效 token，未登录） | ✅ 200 | 报告全文 + 6 章 + 无邮箱泄露；明示"只读、不包含账户信息" |
| 16 | 关闭分享 | ✅ | 原链接立即失效（页面显示"分享链接无效"） |
| 17 | 每日额度（3 次） | ✅ 429 | 第 4 次创建 `{"ok":false,"error":"今日次数已用完，明天再来；深度复盘即将上线","quota":{"used":3,"limit":3}}` |
| 18 | 历史列表 | ✅ 200 | 3 条按 createdAt 倒序 |
| 19 | 删除复盘 | ✅ 200 | 详情 → 404，分享页 → 失效 |
| 20 | WCL 链接（www / cn） | ✅ 200 | 均返回副本/层数元数据（Mists of Tirna Scithe 15 层） |
| 21 | WCL 团本链接 | ✅ 400 | `NOT_MYTHIC`："该链接是团本记录，第一版仅支持大秘境分析…" |
| 22 | WCL 非 WCL 链接 | ✅ 400 | `INVALID_LINK`："不是 WCL 链接，请粘贴 warcraftlogs.com 报告链接…" |
| 23 | 数据隔离（用户 B 访问用户 A 报告） | ✅ 404 | `{"ok":false,"error":"复盘不存在"}` |

---

## 三、FR-1 ~ FR-10 逐条对照验收

| 需求 | 结果 | 证据 | 部署阶段验证项（mock 无法覆盖） |
| --- | --- | --- | --- |
| FR-1 WCL 链接上传 | ✅ | 有效链接 www/cn 均 200 并返回副本/层数/专精；团本→400"仅支持大秘境"；非 WCL→400"不是 WCL 链接" | 真实 WCL v2 API 拉取与配额耗尽降级（FETCH_FAILED→502） |
| FR-2 原生文件上传 | ✅ | 解析器 parser.test.ts 11 用例（战斗列表/非日志报错/团本提示/噪声降噪）；服务端只收结构化 JSON（原始文件不上传） | 真实 200MB log 在浏览器 Web Worker 的解析耗时 |
| FR-3 战斗选择与对比 | ✅ | from-link 支持 compareUrl；无对比时第 3 章为空（实测 done 且空）；对比失败降级不阻塞 | 真实 WCL 对比基准数据 |
| FR-4 AI 复盘报告 | ✅ | 6 章顺序正确；可改进点带时间戳+技能（"9:20 Mymage 死亡"、"2:05 开启 Combustion"）；中文+技能原名保留 | 真实 DeepSeek 的 120s p95、1800 token 封顶质量 |
| FR-5 战术意图识别 | ✅ | 5:36 喝药对齐易伤→第 5 章"✅ 正确决策（5:36）…卡 CD 对齐易伤"；真实失误（2:05 爆发空转）→第 4 章；intent-engine 19 用例 + eval 16/16 | 真实 DeepSeek 模型意图准确率 ≥80% 复测 |
| FR-6 对话问答 | ✅ | 爆发问答带时间戳+技能；违规拒绝；笼统问题标"通用建议/跨场后续版本"；10 轮上限 Q11 拒绝；追问上下文（conversationId+最近 8 轮） | 真实模型 30s p95、追问质量 |
| FR-7 账号与登录 | ✅ | 邮箱验证码登录全流程实测；未登录 401；每日 3 次第 4 次 429；错 5 次锁 10 分钟（auth.test.ts 10 用例）；10 分钟 TTL | 真实 Resend 邮件送达、真实 Supabase OTP 频控 |
| FR-8 历史记录 | ✅ | 列表按时间倒序；详情含报告+问答；删除级联（详情 404、分享失效）；A/B 隔离 404 | 真实 Supabase RLS 策略执行 |
| FR-9 一键分享 | ✅ | 128-bit token；未登录只读查看；关闭立即失效；分享页无邮箱/历史泄露 | — |
| FR-10 预处理与降噪 | ✅ | parser.test.ts 覆盖 token≤50K+缩减≥90%；服务端 413 再校验（audit.test.ts 4 用例）；报告只引用关键事件、时间戳一致 | 真实 log 的缩减率复测 |

### 非功能需求对照

| 项 | 结果 | 说明 |
| --- | --- | --- |
| 安全 | ✅ | 安全头实测下发（CSP/X-Frame-Options DENY/nosniff/Referrer-Policy/Permissions-Policy）；受保护接口 401；数据隔离 404；zod 输入校验 |
| 隐私 | ✅ | /legal/privacy、/legal/terms、/legal/disclaimer 三页齐全，含"收集什么/如何删除" |
| 性能 | ⚠️ | 首屏页面秒开（mock）；报告 p95≤120s / 问答 p95≤30s 需真实模型压测 |
| 兼容性 | ⚠️ | viewport 响应式已配；桌面浏览器实测需部署阶段真机 |
| 合规 | ✅ | 所有页面 footer"非暴雪官方产品，与暴雪娱乐无关"；免责声明页另有显式声明 |
| 可靠性 | ✅ | AI 异常走 error 事件"服务繁忙，请稍后重试"；章节幂等可断点重试 |

---

## 四、页面检查

| 页面 | 状态 | 关键元素 |
| --- | --- | --- |
| / | 200 | h1"看懂你的 log，练对下一把"；首页上传表单；footer 非暴雪声明 |
| /login | 200 | h1"登录 / 注册"；邮箱输入框；"无需密码…6 位验证码" |
| /history | 200 | h1"我的复盘"；client 组件加载列表（数据客户端渲染） |
| /reports/[id] | 200 | 标题"复盘 c3451c1f"；client 组件加载报告 |
| /legal/privacy | 200 | h1"隐私政策"；"原始文件绝不上传服务器" |
| /legal/terms | 200 | h1"用户协议"；"每日可生成 3 次复盘" |
| /legal/disclaimer | 200 | h1"免责声明"；显式"非暴雪官方产品，与暴雪娱乐无关" alert |
| /s/[token]（有效） | 200 | 报告全文 + 6 章 + 只读声明；无邮箱泄露 |
| /s/[token]（无效） | 200（软 404） | "分享链接无效"（见缺陷 D1） |
| /不存在路径 | 404 | "页面不存在"中文 404 页 |

**"非暴雪官方产品，与暴雪娱乐无关"声明：所有 9 个抓取页面 100% 覆盖**（布局 footer 统一渲染 + 免责声明页显式声明）。

---

## 五、复核主 Agent 的两个发现

### ① 无效分享 token 返回 HTTP 200 + "分享链接无效"（软 404）
- **实测确认**：属实。关闭分享/删除报告后访问 `/s/:token` 返回 HTTP 200，页面渲染"分享链接无效…请向分享者索取新的链接"。
- **按 FR-9 判定**：**可接受，不阻塞发布**。FR-9 验收标准是"原链接立即失效"——从用户视角"失效"已达成（不再展示报告内容），且无任何数据泄露。PRD 未强制要求 HTTP 404。软 404 是分享链接类产品的常见做法（保留友好提示页）。
- **建议**（可选优化，非必须）：`getPublicShareData` 返回 null 时用 `notFound()` 返回真 404，利于 SEO/语义正确。严重度：**轻微**。

### ② vitest 运行 Vite 原生配置加载警告（vitest.config.mts 用 `__dirname`）
- **实测确认**：属实。运行测试时输出：
  `(!) Your Vite config uses features that are unsupported by configLoader: 'native' … \`__dirname\` (vitest.config.mts:7:25). Use \`import.meta.dirname\` instead`
- **是否影响产品**：**不影响**。① 该文件仅测试/开发时使用，不在产品运行时路径；② 测试 82/82 通过（`__dirname` 目前仍由 Vite 旧配置加载器注入，可用）。风险在于 Vite 未来大版本将 native 配置加载器设为默认后，`__dirname` 会失效导致测试配置加载失败。
- **建议**：将 `vitest.config.mts` 第 7 行 `path.resolve(__dirname, "src")` 改为 `path.resolve(import.meta.dirname, "src")`，消除未来兼容性风险。严重度：**轻微**。

---

## 六、缺陷清单

| # | 标题 | 严重度 | 详情 |
| --- | --- | --- | --- |
| D1 | 无效分享 token 返回 200 软 404 而非 404 | 轻微 | 见上 ①。复现：`GET /s/（已关闭或已删除的 token）` → 200 + "分享链接无效"。期望：语义上 404；实际 200。可接受，建议后续优化。 |
| D2 | vitest.config.mts 用 `__dirname`，Vite 警告 | 轻微 | 见上 ②。复现：跑测试即见警告。期望/实际：测试通过但存在未来 break 风险。建议改 `import.meta.dirname`。 |
| D3 | .env.example 注释与实现不符（"验证码固定 888888"） | 轻微（文档） | .env.example 第 4–5 行写"登录验证码固定 888888"，但 `mock-auth.ts` 的 `generateOtpCode()` 实际生成随机 6 位码（实测 301543/603221 均随机）。随机码是更安全的行为，文档过时。建议更新注释。 |

**严重度分级说明**：本报告未发现"致命/严重/一般"级缺陷；全部为"轻微"。

---

## 七、结论

**达到可发布状态（mock 功能验收通过）。**

- 单元/集成测试 **82/82 通过**，无失败。
- FR-1~FR-10 **逐条验收通过**（✅），核心闭环（链接/文件→预处理→6 章报告→意图识别→问答→账号/额度→历史→分享→数据隔离）在 mock 模式全流程跑通。
- 无致命/严重/一般缺陷；3 个轻微缺陷（软 404、vitest 配置警告、文档注释过时）均不阻塞发布，建议进入阶段 5 前一并顺手修复。
- **进入阶段 5（发布部署）前必须完成的部署阶段验证项**（mock 无法覆盖，均已在 DEV-HANDOVER 遗留事项中列出）：
  1. 真实 Supabase RLS 策略执行验证；
  2. 真实 Resend 验证码邮件送达；
  3. 真实 DeepSeek：意图准确率 ≥80% 复测（`npm run eval:intent`）+ 报告 120s/问答 30s 压测（Vercel 60s 余量风险）；
  4. 真实 WCL v2 API 拉取与配额降级；
  5. Turnstile 人机验证开启后脚本请求 403；
  6. ≥3 个真实 log（含噪声、200MB 级）复跑 FR-2/FR-10；
  7. 绑定 HTTPS/自定义域名（APP_URL=https://… 使会话 cookie 加 Secure）。

---

*本报告由独立 QA 子 Agent 产出，未修改任何应用代码。测试产生的 mock 数据落在 `.data/`（gitignored）与若干 `.data-qa-*` 临时证据文件（可安全删除）。*
