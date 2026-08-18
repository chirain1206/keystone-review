-- ============================================================
-- WoW M+ AI 复盘教练 · 数据模型与 RLS（T2）
-- Supabase Postgres 迁移。可重复执行：全部使用
-- create table if not exists / drop policy if exists / create or replace。
-- 对应 TECH-DESIGN.md「数据模型」7 张表：
--   profiles / reports / processed_logs / report_chapters
--   / conversations / messages / shares
-- ============================================================

-- ---------- 扩展 ----------
create extension if not exists "pgcrypto";

-- ---------- profiles（用户档案，时区用于"每天 3 次"计数） ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  timezone text not null default 'Asia/Shanghai',
  created_at timestamptz not null default now()
);

-- ---------- reports（一次复盘 = 一条 report） ----------
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_type text not null check (source_type in ('file', 'link')),
  dungeon text not null,
  level int not null check (level >= 1),
  spec text not null,
  player_name text not null default '',
  player_class text not null default '',
  result boolean,
  status text not null default 'parsed' check (status in ('parsed', 'generating', 'ready', 'failed')),
  compare_meta jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reports_user_created_idx on public.reports (user_id, created_at desc);

-- ---------- processed_logs（FR-10 结构化数据，原始文件永不入库） ----------
create table if not exists public.processed_logs (
  report_id uuid primary key references public.reports(id) on delete cascade,
  events jsonb not null,
  raw_size bigint not null default 0,
  raw_lines int not null default 0,
  token_estimate int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- report_chapters（6 章独立存储 → 断点重试） ----------
create table if not exists public.report_chapters (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  chapter_no int not null check (chapter_no between 1 and 6),
  title text not null,
  content text not null default '',
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  cost numeric(10, 6) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_id, chapter_no)
);
create index if not exists report_chapters_report_idx on public.report_chapters (report_id, chapter_no);

-- ---------- conversations / messages（问答，单场 ≤10 轮由应用层控制） ----------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists conversations_report_idx on public.conversations (report_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  report_id uuid not null references public.reports(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists messages_conv_idx on public.messages (conversation_id, created_at);
create index if not exists messages_report_idx on public.messages (report_id, created_at);

-- ---------- shares（128-bit 随机 token、可撤销、只读） ----------
create table if not exists public.shares (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  token text not null unique check (length(token) = 32),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create index if not exists shares_token_idx on public.shares (token);

-- ============================================================
-- RLS：所有表按 user_id 隔离。用户 A 无法读写用户 B 的任何行。
-- 策略通过 auth.uid()（Supabase Auth JWT）判定属主。
-- ============================================================
alter table public.profiles enable row level security;
alter table public.reports enable row level security;
alter table public.processed_logs enable row level security;
alter table public.report_chapters enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.shares enable row level security;

-- profiles：只能读写自己的档案
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (id = auth.uid());
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (id = auth.uid());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid());

-- reports：属主全权
drop policy if exists reports_select_own on public.reports;
create policy reports_select_own on public.reports
  for select using (user_id = auth.uid());
drop policy if exists reports_insert_own on public.reports;
create policy reports_insert_own on public.reports
  for insert with check (user_id = auth.uid());
drop policy if exists reports_update_own on public.reports;
create policy reports_update_own on public.reports
  for update using (user_id = auth.uid());
drop policy if exists reports_delete_own on public.reports;
create policy reports_delete_own on public.reports
  for delete using (user_id = auth.uid());

-- processed_logs：经 reports 判定属主
drop policy if exists processed_logs_select_own on public.processed_logs;
create policy processed_logs_select_own on public.processed_logs
  for select using (exists (
    select 1 from public.reports r where r.id = report_id and r.user_id = auth.uid()
  ));
drop policy if exists processed_logs_insert_own on public.processed_logs;
create policy processed_logs_insert_own on public.processed_logs
  for insert with check (exists (
    select 1 from public.reports r where r.id = report_id and r.user_id = auth.uid()
  ));

-- report_chapters：经 reports 判定属主
drop policy if exists chapters_select_own on public.report_chapters;
create policy chapters_select_own on public.report_chapters
  for select using (exists (
    select 1 from public.reports r where r.id = report_id and r.user_id = auth.uid()
  ));
drop policy if exists chapters_insert_own on public.report_chapters;
create policy chapters_insert_own on public.report_chapters
  for insert with check (exists (
    select 1 from public.reports r where r.id = report_id and r.user_id = auth.uid()
  ));
drop policy if exists chapters_update_own on public.report_chapters;
create policy chapters_update_own on public.report_chapters
  for update using (exists (
    select 1 from public.reports r where r.id = report_id and r.user_id = auth.uid()
  ));

-- conversations：经 reports 判定属主
drop policy if exists conversations_select_own on public.conversations;
create policy conversations_select_own on public.conversations
  for select using (exists (
    select 1 from public.reports r where r.id = report_id and r.user_id = auth.uid()
  ));
drop policy if exists conversations_insert_own on public.conversations;
create policy conversations_insert_own on public.conversations
  for insert with check (exists (
    select 1 from public.reports r where r.id = report_id and r.user_id = auth.uid()
  ));

-- messages：经 conversations → reports 判定属主
drop policy if exists messages_select_own on public.messages;
create policy messages_select_own on public.messages
  for select using (exists (
    select 1 from public.conversations c
    join public.reports r on r.id = c.report_id
    where c.id = conversation_id and r.user_id = auth.uid()
  ));
drop policy if exists messages_insert_own on public.messages;
create policy messages_insert_own on public.messages
  for insert with check (exists (
    select 1 from public.conversations c
    join public.reports r on r.id = c.report_id
    where c.id = conversation_id and r.user_id = auth.uid()
  ));

-- shares：属主全权（公开只读由服务端 service role 提供，anon 无任何策略）
drop policy if exists shares_select_own on public.shares;
create policy shares_select_own on public.shares
  for select using (exists (
    select 1 from public.reports r where r.id = report_id and r.user_id = auth.uid()
  ));
drop policy if exists shares_insert_own on public.shares;
create policy shares_insert_own on public.shares
  for insert with check (exists (
    select 1 from public.reports r where r.id = report_id and r.user_id = auth.uid()
  ));
drop policy if exists shares_update_own on public.shares;
create policy shares_update_own on public.shares
  for update using (exists (
    select 1 from public.reports r where r.id = report_id and r.user_id = auth.uid()
  ));
drop policy if exists shares_delete_own on public.shares;
create policy shares_delete_own on public.shares
  for delete using (exists (
    select 1 from public.reports r where r.id = report_id and r.user_id = auth.uid()
  ));

-- ---------- 触发器：注册新用户时自动建 profile ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, timezone)
  values (new.id, coalesce(new.email, ''), 'Asia/Shanghai')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
