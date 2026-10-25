-- StudyGlass: run once in the SAME Supabase project used by TradeGlass.
-- Does not alter or delete any TradeGlass tables/data.
create table if not exists public.planner_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_type text not null check (item_type in ('exam','task')),
  title text not null check (char_length(title) between 1 and 120),
  item_date date not null,
  item_time time,
  subject text not null default '' check (char_length(subject) <= 70),
  notes text not null default '' check (char_length(notes) <= 1200),
  completed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists planner_items_user_date_idx on public.planner_items (user_id, item_date, item_time);
alter table public.planner_items enable row level security;
revoke all on table public.planner_items from anon, authenticated;
grant select, insert, update, delete on table public.planner_items to authenticated;

drop policy if exists "Planner: read own" on public.planner_items;
create policy "Planner: read own" on public.planner_items
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Planner: insert own" on public.planner_items;
create policy "Planner: insert own" on public.planner_items
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Planner: update own" on public.planner_items;
create policy "Planner: update own" on public.planner_items
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "Planner: delete own" on public.planner_items;
create policy "Planner: delete own" on public.planner_items
  for delete to authenticated using ((select auth.uid()) = user_id);
