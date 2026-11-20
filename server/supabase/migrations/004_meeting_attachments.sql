-- Tatva: meeting attachments (PDFs and images shared in a meeting).
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run. Requires 001-003.

-- 1. One row per file attached to a meeting.
create table if not exists public.meeting_attachments (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  meeting_id   uuid not null references public.meetings (id) on delete cascade,
  name         text not null,            -- original (or generated, for pasted screenshots) file name
  storage_path text,                     -- path in the attachments bucket
  mime         text not null,
  kind         text not null check (kind in ('pdf', 'image')),
  bytes        bigint,
  pages        integer,                  -- PDFs only
  label        text,                     -- what the image shows: slide | chart | table | diagram | screenshot | photo | document
  status       text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  error        text,
  text_content text,                     -- PDF text, or the vision model's transcription + description
  summary      text,                     -- one line for the card and the Google Doc
  chunk_count  integer not null default 0
);
create index if not exists meeting_attachments_meeting_idx on public.meeting_attachments (meeting_id, created_at);

drop trigger if exists meeting_attachments_updated_at on public.meeting_attachments;
create trigger meeting_attachments_updated_at before update on public.meeting_attachments
  for each row execute function public.set_updated_at();

alter table public.meeting_attachments enable row level security;

-- 2. Attachment chunks keep the meeting_id (so search can scope to one meeting)
--    and point at their attachment (deleted with it).
alter table public.knowledge_chunks add column if not exists attachment_id uuid references public.meeting_attachments (id) on delete cascade;
create index if not exists knowledge_chunks_attachment_idx on public.knowledge_chunks (attachment_id);

-- 3. Search also returns attachment_id (return type changes, so drop first).
drop function if exists public.match_knowledge_chunks(extensions.vector, integer, double precision, uuid);
create or replace function public.match_knowledge_chunks(
  query_embedding      extensions.vector(384),
  match_count          integer default 8,
  similarity_threshold double precision default 0.2,
  filter_meeting_id    uuid default null
)
returns table (
  id            bigint,
  meeting_id    uuid,
  document_id   uuid,
  attachment_id uuid,
  source_type   text,
  content       text,
  metadata      jsonb,
  similarity    double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select
    kc.id,
    kc.meeting_id,
    kc.document_id,
    kc.attachment_id,
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

-- 4. Private bucket for the files.
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
