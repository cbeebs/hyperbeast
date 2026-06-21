-- HyperBeast Supabase setup
-- Run this entire file in: Supabase → SQL Editor → New query → Paste → Run

-- 1. User settings (plan start date)
create table public.user_settings (
  id uuid references auth.users on delete cascade primary key,
  start_iso text not null default '2026-06-15',
  updated_at timestamptz default now()
);
alter table public.user_settings enable row level security;
create policy "own settings" on public.user_settings for all using (auth.uid() = id);

-- 2. Session tick state
create table public.sessions_done (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade not null,
  session_key text not null,
  done boolean not null default true,
  updated_at timestamptz default now(),
  unique(user_id, session_key)
);
alter table public.sessions_done enable row level security;
create policy "own done" on public.sessions_done for all using (auth.uid() = user_id);

-- 3. Custom sessions added by the user
create table public.custom_sessions (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade not null,
  week_n integer not null,
  dow integer not null,
  title text not null,
  km numeric,
  session_type text default 'EASY',
  note text,
  created_at timestamptz default now()
);
alter table public.custom_sessions enable row level security;
create policy "own custom" on public.custom_sessions for all using (auth.uid() = user_id);
