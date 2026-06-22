-- HyperBeast Supabase setup
-- Run this entire file in: Supabase → SQL Editor → New query → Paste → Run
-- Safe to re-run: uses IF NOT EXISTS / upsert patterns

-- 1. User settings (plan start date + stored plan JSON)
create table if not exists public.user_settings (
  id uuid references auth.users on delete cascade primary key,
  start_iso text not null default '2026-06-15',
  plan_data jsonb,
  plan_name text,
  updated_at timestamptz default now()
);
alter table public.user_settings enable row level security;
drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings for all using (auth.uid() = id);

-- 2. Session tick state (keyed by YYYY-MM-DD calendar date for plan sessions,
--    or "custom_<id>" for user-added sessions)
create table if not exists public.sessions_done (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade not null,
  session_key text not null,
  done boolean not null default true,
  updated_at timestamptz default now(),
  unique(user_id, session_key)
);
alter table public.sessions_done enable row level security;
drop policy if exists "own done" on public.sessions_done;
create policy "own done" on public.sessions_done for all using (auth.uid() = user_id);

-- 3. Custom sessions added by the user
create table if not exists public.custom_sessions (
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
drop policy if exists "own custom" on public.custom_sessions;
create policy "own custom" on public.custom_sessions for all using (auth.uid() = user_id);

-- Add plan columns to user_settings if upgrading from v1
alter table public.user_settings add column if not exists plan_data jsonb;
alter table public.user_settings add column if not exists plan_name text;
