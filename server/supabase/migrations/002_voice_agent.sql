-- Tatva Work: Milestone 3 schema (voice agent tools).
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run. Requires 001_init.sql (uses public.set_updated_at()).

-- People the agent can email / mention ("email Priya" -> contacts.email).
create table if not exists public.contacts (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  email        text,
  slack_handle text,
  aliases      text[] not null default '{}',  -- other spellings, e.g. {'Mira'} for Meera
  created_at   timestamptz not null default now()
);

-- Every tool call the voice agent makes (reads and actions).
create table if not exists public.activity_log (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  session_id  text,
  tool        text not null,
  args        jsonb not null default '{}',
  status      text not null check (status in ('ok', 'error', 'pending', 'confirmed', 'cancelled')),
  result      jsonb,
  error       text,
  duration_ms integer
);
create index if not exists activity_log_created_at_idx on public.activity_log (created_at desc);
create index if not exists activity_log_session_idx on public.activity_log (session_id, created_at desc);

-- Send/create actions wait here until the user says "yes".
create table if not exists public.pending_actions (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  session_id text not null,
  kind       text not null check (kind in ('send_email', 'post_to_slack', 'create_calendar_event', 'add_tracker_row')),
  args       jsonb not null,
  summary    text not null,   -- what the agent read back
  status     text not null default 'pending' check (status in ('pending', 'done', 'failed', 'cancelled', 'expired')),
  result     jsonb,
  error      text
);
create index if not exists pending_actions_session_idx on public.pending_actions (session_id, status, created_at desc);

drop trigger if exists pending_actions_updated_at on public.pending_actions;
create trigger pending_actions_updated_at before update on public.pending_actions
  for each row execute function public.set_updated_at();

alter table public.contacts        enable row level security;
alter table public.activity_log    enable row level security;
alter table public.pending_actions enable row level security;

notify pgrst, 'reload schema';
