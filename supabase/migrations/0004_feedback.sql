-- ============================================================
-- 钥石复盘 · 用户反馈收集（FEEDBACK）
-- public.feedback：内测用户 / 访客提交的意见（bug / 建议 / 其他）。
-- 可重复执行：create table if not exists / create index if not exists。
--
-- 安全（仿 kb_documents，见 0003 迁移注释）：
--   feedback 为服务端专用表 —— 不启用 RLS。写入/读取全部走应用服务端
--   （POST/GET/PATCH /api/feedback）以 service role 连接。
--   本项目已在数据库层设置 default privileges 自动授予 service_role，
--   因此本文件无需显式 grant；但为纵深防御，仍显式回收 anon / authenticated
--   的全部权限，任何客户端直连路径都无法读写。
-- ============================================================

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null,            -- 登录用户关联（可空：访客提交无关联）
  email text null,              -- 访客自填邮箱（可空；登录用户由服务端自动关联，无需填写）
  category text not null check (category in ('bug', 'suggestion', 'other')),
  content text not null,
  page_url text null,           -- 前端附上的当前页面路径
  status text not null default 'new' check (status in ('new', 'read', 'resolved')),
  created_at timestamptz not null default now()
);

-- 列表按提交时间倒序（专家查看页最近 100 条）
create index if not exists feedback_created_at_idx
  on public.feedback (created_at);

-- 服务端专用：显式回收客户端角色权限（即便未来默认授权策略变化也安全）
revoke all on table public.feedback from anon, authenticated;
