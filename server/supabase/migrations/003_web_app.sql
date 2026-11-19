-- Tatva Work: Milestone 4 schema (web app: contacts roles, issues, documents).
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run. Requires 001_init.sql and 002_voice_agent.sql.

-- 1. Contacts get a role ("Vendor Manager") shown in the app and used for context.
alter table public.contacts add column if not exists role text;

-- 2. Tracker items: tasks from meetings, plus issues logged by voice or in the app.
alter table public.action_items alter column meeting_id drop not null;
alter table public.action_items add column if not exists kind text not null default 'task';
alter table public.action_items add column if not exists context text;      -- one-line detail
alter table public.action_items add column if not exists source text not null default 'meeting';
alter table public.action_items drop constraint if exists action_items_kind_check;
alter table public.action_items add constraint action_items_kind_check check (kind in ('task', 'issue'));
alter table public.action_items drop constraint if exists action_items_source_check;
alter table public.action_items add constraint action_items_source_check check (source in ('meeting', 'voice', 'web'));
alter table public.action_items alter column position set default 0;

-- 3. Pending actions can also log an issue.
alter table public.pending_actions drop constraint if exists pending_actions_kind_check;
alter table public.pending_actions add constraint pending_actions_kind_check
  check (kind in ('send_email', 'post_to_slack', 'create_calendar_event', 'add_tracker_row', 'log_issue'));

-- 4. Company documents (PDFs) in the knowledge base.
create table if not exists public.documents (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  name         text not null,          -- original file name
  storage_path text,                   -- path in the documents bucket
  mime         text not null default 'application/pdf',
  bytes        bigint,
  pages        integer,
  status       text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  error        text,
  summary      text,                   -- first lines of the text, for the card
  chunk_count  integer not null default 0
);
create index if not exists documents_created_at_idx on public.documents (created_at desc);

drop trigger if exists documents_updated_at on public.documents;
create trigger documents_updated_at before update on public.documents
  for each row execute function public.set_updated_at();

alter table public.knowledge_chunks add column if not exists document_id uuid references public.documents (id) on delete cascade;
create index if not exists knowledge_chunks_document_idx on public.knowledge_chunks (document_id);

-- 5. Search now also returns document_id (return type changes, so drop first).
drop function if exists public.match_knowledge_chunks(extensions.vector, integer, double precision, uuid);
create or replace function public.match_knowledge_chunks(
  query_embedding      extensions.vector(384),
  match_count          integer default 8,
  similarity_threshold double precision default 0.2,
  filter_meeting_id    uuid default null
)
returns table (
  id          bigint,
  meeting_id  uuid,
  document_id uuid,
  source_type text,
  content     text,
  metadata    jsonb,
  similarity  double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select
    kc.id,
    kc.meeting_id,
    kc.document_id,
    kc.source_type,
    kc.content,
    kc.metadata,
    1 - (kc.embedding <=> query_embedding) as similarity
  from public.knowledge_chunks kc
  where (filter_meeting_id is null or kc.meeting_id = filter_meeting_id)
    and 1 - (kc.embedding <=> query_embedding) >= similarity_threshold
  order by kc.embedding <=> query_embedding
  limit least(match_count, 50);
$$;
revoke all on function public.match_knowledge_chunks(extensions.vector, integer, double precision, uuid) from public, anon, authenticated;
grant execute on function public.match_knowledge_chunks(extensions.vector, integer, double precision, uuid) to service_role;

-- 6. Security + storage.
alter table public.documents enable row level security;

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
