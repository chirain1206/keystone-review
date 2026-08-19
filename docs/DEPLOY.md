# 部署文档：钥石复盘（keystone-review）

> 阶段 5（发布与部署）产出 · 2026-08-19

## 一、部署方式

- **代码**：GitHub https://github.com/chirain1206/keystone-review（公开，v1.0.0 tag + Release）
- **托管**：Vercel Hobby（项目 keystone-review），GitHub 主分支自动/CLI 部署
- **域名**：keystone-review.online（第三方注册商：腾讯云）→ NS 托管于 Cloudflare（kanye/sydney.ns.cloudflare.com）
- **国内访问链路**：用户 → Cloudflare 边缘（橙云代理）→ Vercel。Vercel 源站国内被墙，**必须保持 Cloudflare 橙云（Proxied）**
- **数据**：Supabase 免费层（项目 suwqhghsjpahjaznaubc；表 0001/0002/0003 + spec 通配热更新已执行）
- **服务密钥**：DeepSeek / SiliconFlow(bge-m3) / WCL v2 / Cloudflare Turnstile / Supabase Auth 内置邮件（EMAIL_MODE=supabase）

## 二、DNS 记录（Cloudflare，全部 Proxied 橙云）

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| CNAME | @（keystone-review.online） | 405e8a5bda88823c.vercel-dns-017.com |
| CNAME | www | 405e8a5bda88823c.vercel-dns-017.com |

> 注意：Vercel 新 IP 段启用后，旧值 cname.vercel-dns.com / 76.76.21.21 为 legacy；以 Vercel 面板"View DNS configuration"显示为准。

## 三、环境变量（Vercel Production，全部 Sensitive）

APP_URL=https://keystone-review.online；NEXT_PUBLIC_SUPABASE_URL/ANON_KEY；SUPABASE_SERVICE_ROLE_KEY；DEEPSEEK_API_KEY；EMBEDDING_API_KEY/BASE_URL(https://api.siliconflow.cn)/MODEL(BAAI/bge-m3)；WCL_CLIENT_ID/SECRET；TURNSTILE_SECRET_KEY/NEXT_PUBLIC_TURNSTILE_SITE_KEY；ACTIVE_PATCH=12.1；EMAIL_MODE=supabase；EXPERT_EMAILS=白名单邮箱逗号分隔。

## 四、冒烟测试结果

| 项 | 结果 |
| --- | --- |
| vercel.app 生产部署 | ✅ 构建/路由全绿（Ready） |
| 自定义域名 DNS/验证 | ✅ Vercel 面板 Valid Configuration |
| 自定义域名 HTTP 服务 | ✅ 通过（200）——最终根因：Vercel Framework Preset 误判为 Other（静态站）导致无路由；改为 Next.js 后恢复。访问链路=Cloudflare 橙云直连 Vercel（Worker 反代方案已弃用并删除） |
| 本地全链路（3102） | ✅ 用户验收通过（链接/文件双通道、报告、问答、分享、专家页） |

## 五、回滚方案

1. **代码回滚**：`npx vercel rollback`（立即回到上一个 Ready 部署）或 GitHub revert + 自动部署；
2. **域名回滚**：Cloudflare 记录切回灰云直连，或删除 CNAME 指向临时 vercel.app；
3. **配置回滚**：`vercel env rm <KEY> production` 后重新部署（APP_URL 变更会导致会话重建，可接受）；
4. **数据回滚**：Supabase 备份（Dashboard → Database → Backups）恢复。

## 六、上线检查清单（Gate 5）

- [x] GitHub 发布规范（README 中英/LICENSE/CHANGELOG/CI/徽章/tag/Release）
- [x] 生产密钥全部配置（零密钥入库）
- [x] 数据库迁移 + 授权 + 知识库灌入（56 条）
- [x] 自定义域名绑定 + DNS + 证书
- [ ] 域名边缘生效后线上冒烟（登录→贴链接→报告→问答→分享）
- [ ] Turnstile widget 已加 keystone-review.online（用户已操作）
- [ ] 内测邀请方案（见下）

## 七、内测计划（待域名生效后执行）

1. EXPERT_EMAILS 加入用户与朋友邮箱（Vercel env 更新后重新部署）；
2. 用户邀请 3-5 位高端玩家朋友注册试用（登录用邮箱验证码，提醒查垃圾箱）；
3. 内测反馈通道：微信群/QQ 群（用户定）+ GitHub Issues；
4. 内测期重点验证：真实 DeepSeek 意图识别准确率（样例集 ≥80%）、报告质量、专家提交/审核闭环、WCL 配额余量；
5. 达标后再进入阶段 6（宣传与冷启动）。
