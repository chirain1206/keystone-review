-- ============================================================
-- WoW M+ AI 复盘教练 · 每日额度原子计数（M-3）
-- 目的：修复"先数后插"的 TOCTOU 并发绕过——并发请求可突破每账号每日 3 次。
-- 方案：以 (user_id, day) 唯一键 + 单条原子 upsert 递增，返回新 count。
-- 可重复执行：create table if not exists / create or replace function。
-- ============================================================

-- 每日用量表（服务端专用，不启用 RLS）：
--   day 为用户所在时区的自然日（YYYY-MM-DD），由应用层按用户时区计算。
create table if not exists public.daily_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day text not null,
  count int not null default 0,
  primary key (user_id, day)
);

-- 原子递增并返回新 count。
-- 采用 INSERT ... ON CONFLICT DO UPDATE（单条原子语句），
-- 等价于"UPDATE ...; IF NOT FOUND THEN INSERT ... RETURNING count"，
-- 但避免了两个并发首插竞争主键的竞态，从根上消除 TOCTOU。
-- SECURITY DEFINER：由 service role 客户端调用；即使未来以受限角色调用也能正确计数。
create or replace function public.increment_daily_usage(p_user uuid, p_day text)
returns int
language sql
security definer
set search_path = public
as $$
  insert into public.daily_usage (user_id, day, count)
  values (p_user, p_day, 1)
  on conflict (user_id, day)
  do update set count = public.daily_usage.count + 1
  returning count;
$$;

-- 权限收敛（M-RAG-2）：PostgreSQL CREATE FUNCTION 默认授予 PUBLIC EXECUTE，
-- 本函数为 SECURITY DEFINER 写原语，必须回收 PUBLIC 与 anon/authenticated，
-- 仅 service_role（服务端私有密钥）可执行。revoke/grant 幂等，可重复执行。
revoke all on function public.increment_daily_usage(uuid, text) from public;
revoke all on function public.increment_daily_usage(uuid, text) from anon, authenticated;
grant execute on function public.increment_daily_usage(uuid, text) to service_role;
