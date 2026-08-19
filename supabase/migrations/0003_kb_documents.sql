-- ============================================================
-- WoW M+ AI 复盘教练 · 社区打法知识库（FR-11，T14）
-- kb_documents：知识片段 + bge-m3 嵌入（vector(1024)）+ 元数据 + 幂等键。
-- 可重复执行：create extension if not exists / create table if not exists
--            / create or replace function。
--
-- meta 字段约定：class/spec/dungeon/patch/type/source_url
--   + origin（curated=攻略整理 / inferred=log 推断 / community=社区反馈）
--   + status（active=生效 / candidate=候选 / deprecated=弃用）
-- 检索只注入 status=active；candidate 条目绝不进入正式分析（T16/T19）。
--
-- 安全（TECH-DESIGN ADR-002 / T14 验收）：
--   kb_documents 为服务端专用表 —— 不启用 RLS，并显式回收
--   anon / authenticated 角色的所有权限，任何客户端直连路径都无法读写。
--   只有 service_role（服务端私有密钥，绝不进浏览器）可访问。
-- ============================================================

create extension if not exists vector;

create table if not exists public.kb_documents (
  id uuid primary key default gen_random_uuid(),
  chunk_text text not null,
  embedding vector(1024) not null,
  meta jsonb not null default '{}'::jsonb,
  source_hash text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 向量索引（余弦距离）+ 元数据索引
create index if not exists kb_documents_embedding_idx
  on public.kb_documents using hnsw (embedding vector_cosine_ops);
create index if not exists kb_documents_meta_idx
  on public.kb_documents using gin (meta jsonb_path_ops);
create index if not exists kb_documents_patch_idx
  on public.kb_documents ((meta ->> 'patch'));
create index if not exists kb_documents_status_idx
  on public.kb_documents ((meta ->> 'status'));

-- 服务端专用：显式回收客户端角色权限（即便未来默认授权策略变化也安全）
revoke all on table public.kb_documents from anon, authenticated;

-- 余弦相似度检索：按 class/spec/dungeon/patch/status 过滤，top-k 由 match_count 控制。
-- patch 过滤约定：match_patch = 活跃补丁；meta.patch = 'general' 的内容始终可见。
-- spec 过滤约定：meta.spec = '*' 表示该职业全专精通用，始终命中（与 dungeon='*' 同款约定）。
-- dungeon 过滤约定：meta.dungeon = '*' 表示全副本通用，始终命中。
-- status 过滤约定：缺省 'active'（候选/弃用条目绝不注入正式分析）。
create or replace function public.match_kb_documents(
  query_embedding vector(1024),
  match_class text default null,
  match_spec text default null,
  match_dungeon text default null,
  match_patch text default null,
  match_status text default 'active',
  match_count int default 5
)
returns table (
  id uuid,
  chunk_text text,
  meta jsonb,
  similarity float
)
language plpgsql
stable
as $$
begin
  return query
  select
    kb.id,
    kb.chunk_text,
    kb.meta,
    (1 - (kb.embedding <=> query_embedding)) as similarity
  from public.kb_documents kb
  where (match_class is null or kb.meta ->> 'class' = match_class)
    and (
      match_spec is null
      or kb.meta ->> 'spec' = match_spec
      or kb.meta ->> 'spec' = '*'
    )
    and (
      match_dungeon is null
      or kb.meta ->> 'dungeon' = match_dungeon
      or kb.meta ->> 'dungeon' = '*'
    )
    and (
      match_patch is null
      or kb.meta ->> 'patch' = match_patch
      or kb.meta ->> 'patch' = 'general'
    )
    and (match_status is null or kb.meta ->> 'status' = match_status)
  order by kb.embedding <=> query_embedding
  limit least(match_count, 5);
end;
$$;

-- 权限收敛（M-RAG-2）：PostgreSQL CREATE FUNCTION 默认授予 PUBLIC EXECUTE，
-- 需同时回收 PUBLIC 与 anon/authenticated，仅 service_role 可执行。
-- 注意顺序：必须在函数创建（上方 create or replace）之后执行。
-- revoke/grant 幂等，可重复执行。
revoke all on function public.match_kb_documents(vector, text, text, text, text, text, int) from public;
revoke all on function public.match_kb_documents(vector, text, text, text, text, text, int) from anon, authenticated;
grant execute on function public.match_kb_documents(vector, text, text, text, text, text, int) to service_role;

