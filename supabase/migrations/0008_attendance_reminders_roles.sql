create table if not exists attendance_reminders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  shift_id uuid not null references attendance_shifts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null default 'Silakan presensi keluar sebelum shift ditutup.',
  created_at timestamptz not null default now()
);
create index if not exists idx_attendance_reminders_user
  on attendance_reminders (user_id, created_at desc);
alter table attendance_reminders enable row level security;
revoke all on attendance_reminders from anon, authenticated;
grant select on attendance_reminders to authenticated;
create policy attendance_reminders_own_read on attendance_reminders
  for select to authenticated using (
    user_id = auth.uid() and can_access_active_store(store_id)
  );

-- Pairing the first web account creates the store owner/admin. Later paired
-- accounts join as cashier/staff and receive their role from DEN POS admin.
create or replace function assign_paired_web_role()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.permission = 'owner' and exists (
    select 1 from store_users where store_id = new.store_id and user_id <> new.user_id
  ) then
    new.permission := 'staff';
    new.web_role := 'kasir';
  elsif new.permission = 'owner' then
    new.web_role := 'admin';
  end if;
  return new;
end;
$$;
drop trigger if exists store_users_assign_web_role on store_users;
create trigger store_users_assign_web_role before insert on store_users
  for each row execute function assign_paired_web_role();
revoke all on function assign_paired_web_role() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance_reminders') then
    alter publication supabase_realtime add table public.attendance_reminders;
  end if;
end;
$$;