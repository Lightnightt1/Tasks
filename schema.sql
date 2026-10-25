-- StudyGlass schema for Supabase project: Tasks (ozhiklonwyjlerpouglf).
-- Safe to run more than once; does not delete existing task records.
create table if not exists public.planner_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_type text not null check (item_type in ('exam','task')),
  title text not null check (char_length(title) between 1 and 120),
  item_date date not null,
  item_time time without time zone,
  subject text not null default '' check (char_length(subject) <= 70),
  notes text not null default '' check (char_length(notes) <= 1200),
  completed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists planner_items_user_date_idx on public.planner_items(user_id, item_date, item_time);
alter table public.planner_items enable row level security;
revoke all on table public.planner_items from anon, authenticated;
grant select, insert, update, delete on public.planner_items to authenticated;
drop policy if exists "Planner: read own" on public.planner_items;
create policy "Planner: read own" on public.planner_items for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Planner: insert own" on public.planner_items;
create policy "Planner: insert own" on public.planner_items for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Planner: update own" on public.planner_items;
create policy "Planner: update own" on public.planner_items for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Planner: delete own" on public.planner_items;
create policy "Planner: delete own" on public.planner_items for delete to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.studyglass_reminder_logs (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.planner_items(id) on delete cascade,
  item_date date not null,
  reminder_type text not null check (reminder_type in ('day_before','same_day')),
  recipient_email text,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, item_date, reminder_type)
);
create index if not exists studyglass_reminder_logs_status_idx on public.studyglass_reminder_logs(status, updated_at);
alter table public.studyglass_reminder_logs enable row level security;
revoke all on public.studyglass_reminder_logs from anon, authenticated;
grant select, insert, update, delete on public.studyglass_reminder_logs to service_role;
