-- Tatva Work: Milestone 2 schema.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run (everything is "if not exists" / "or replace").

-- 1. pgvector ------------------------------------------------------------------
create extension if not exists vector with schema extensions;

-- 2. Tables ----------------------------------------------------------------------

create table if not exists public.meetings (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  recorded_at            timestamptz,
  status                 text not null default 'uploaded'
                         check (status in ('uploaded', 'transcribing', 'extracting', 'indexing', 'ready', 'failed')),
  error                  text,
  warnings               text[] not null default '{}',
  source_title           text,            -- browser tab title at recording time
  source_url             text,
  duration_seconds       numeric,
  audio_path             text,            -- path in the meeting-audio bucket
  audio_mime             text,
  audio_bytes            bigint,
  language               text,
  transcript             text,
  title                  text,
  summary                text,
  decisions              jsonb not null default '[]',  -- [{decision, context}]
  stats_mentioned        jsonb not null default '[]',  -- [{value, context, timestamp_sec}]
  key_moments            jsonb not null default '[]',  -- [{timestamp_sec, note}]
  time_saved_minutes     integer,
  time_saved_breakdown   jsonb not null default '[]',  -- [{task, minutes}]
  gdoc_id                text,
  gdoc_url               text,
  processing_started_at  timestamptz,
  processing_finished_at timestamptz
);

create index if not exists meetings_created_at_idx on public.meetings (created_at desc);
create index if not exists meetings_status_idx on public.meetings (status);

create table if not exists public.transcript_segments (
  id         bigint generated always as identity primary key,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  position   integer not null,
  start_sec  numeric not null,
  end_sec    numeric not null,
  text       text not null
);
create index if not exists transcript_segments_meeting_idx on public.transcript_segments (meeting_id, position);

-- Action items and discuss-later items get their own tables (with status) so the
-- tracker and follow-ups in later milestones can update them individually.
create table if not exists public.action_items (
  id         uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  position   integer not null,
  task       text not null,
  owner      text,
  due_text   text,            -- as spoken, e.g. "by Friday"
  due_date   date,            -- resolved date, when possible
  status     text not null default 'open' check (status in ('open', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists action_items_meeting_idx on public.action_items (meeting_id);
create index if not exists action_items_open_idx on public.action_items (status, due_date);

create table if not exists public.discuss_later (
  id                  uuid primary key default gen_random_uuid(),
  meeting_id          uuid not null references public.meetings (id) on delete cascade,
  position            integer not null,
  topic               text not null,
  people              text[] not null default '{}',
  suggested_time_text text,         -- as spoken
  suggested_at        timestamptz,  -- resolved, when possible
  status              text not null default 'open' check (status in ('open', 'scheduled', 'done')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists discuss_later_meeting_idx on public.discuss_later (meeting_id);

-- RAG chunks. meeting_id is null for company documents (SOPs, project plans)
-- added in a later milestone.
create table if not exists public.knowledge_chunks (
  id          bigint generated always as identity primary key,
  meeting_id  uuid references public.meetings (id) on delete cascade,
  source_type text not null,   -- summary | decision | action_item | stat | key_moment | discuss_later | transcript | document
  content     text not null,
  metadata    jsonb not null default '{}',
  embedding   extensions.vector(384) not null,  -- Xenova/all-MiniLM-L6-v2, normalized
  created_at  timestamptz not null default now()
);
create index if not exists knowledge_chunks_meeting_idx on public.knowledge_chunks (meeting_id);
create index if not exists knowledge_chunks_embedding_idx
  on public.knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops);

-- 3. updated_at trigger ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists meetings_updated_at on public.meetings;
create trigger meetings_updated_at before update on public.meetings
  for each row execute function public.set_updated_at();
drop trigger if exists action_items_updated_at on public.action_items;
create trigger action_items_updated_at before update on public.action_items
  for each row execute function public.set_updated_at();
drop trigger if exists discuss_later_updated_at on public.discuss_later;
create trigger discuss_later_updated_at before update on public.discuss_later
  for each row execute function public.set_updated_at();

-- 4. RAG search --------------------------------------------------------------------
-- Cosine similarity search. Called by the server: supabase.rpc('match_knowledge_chunks', ...)
create or replace function public.match_knowledge_chunks(
  query_embedding      extensions.vector(384),
  match_count          integer default 8,
  similarity_threshold double precision default 0.2,
  filter_meeting_id    uuid default null
)
returns table (
  id          bigint,
  meeting_id  uuid,
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

-- 5. Security ------------------------------------------------------------------------
-- RLS on with no policies: only the server's secret key (service role) can read
-- or write. The browser and extension never talk to Supabase directly.
alter table public.meetings            enable row level security;
alter table public.transcript_segments enable row level security;
alter table public.action_items        enable row level security;
alter table public.discuss_later       enable row level security;
alter table public.knowledge_chunks    enable row level security;

revoke all on function public.match_knowledge_chunks(extensions.vector, integer, double precision, uuid) from public, anon, authenticated;
grant execute on function public.match_knowledge_chunks(extensions.vector, integer, double precision, uuid) to service_role;

-- 6. Storage bucket for recordings (private) -------------------------------------------
insert into storage.buckets (id, name, public)
values ('meeting-audio', 'meeting-audio', false)
on conflict (id) do nothing;

-- 7. Make the new tables and function visible to the API immediately ---------------
notify pgrst, 'reload schema';
