-- Attendance foundation for web users linked to a POS store.
-- POS shifts are mirrored by the signed attendance Edge Function; web users
-- can only check in/out through the authenticated RPCs below.

alter table store_users
  add column if not exists web_role text not null default 'kasir',
  add column if not exists membership_status text not null default 'active';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'store_users_web_role_check') then
    alter table store_users add constraint store_users_web_role_check
      check (web_role in ('kasir', 'bar', 'purchasing', 'manager', 'admin'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'store_users_membership_status_check') then
    alter table store_users add constraint store_users_membership_status_check
      check (membership_status in ('active', 'revoked'));
  end if;
end;
$$;

-- Preserve the existing owner permission model while making paired owners
-- administrators in the web-app's role model.
update store_users set web_role = 'admin' where permission = 'owner' and web_role = 'kasir';
create index if not exists idx_store_users_store_active
  on store_users (store_id, membership_status, web_role);

create or replace function can_access_active_store(p_store uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from store_users
    where user_id = auth.uid()
      and store_id = p_store
      and membership_status = 'active'
  );
$$;

create or replace function can_view_attendance_report(p_store uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from store_users
    where user_id = auth.uid()
      and store_id = p_store
      and membership_status = 'active'
      and web_role in ('manager', 'admin')
  );
$$;

create table if not exists attendance_settings (
  store_id uuid primary key references stores(id) on delete cascade,
  radius_m integer not null default 20 check (radius_m between 1 and 1000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists attendance_shifts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  device_id text not null,
  pos_shift_id text not null,
  shift_num integer,
  operator_label text,
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_at timestamptz not null,
  closed_at timestamptz,
  latitude double precision,
  longitude double precision,
  location_accuracy_m double precision,
  location_updated_at timestamptz,
  radius_m integer not null default 20 check (radius_m between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, device_id, pos_shift_id),
  check ((latitude is null and longitude is null) or
    (latitude between -90 and 90 and longitude between -180 and 180)),
  check (location_accuracy_m is null or location_accuracy_m >= 0),
  check ((status = 'open' and closed_at is null) or
    (status = 'closed' and closed_at is not null))
);
create index if not exists idx_attendance_shifts_store_status
  on attendance_shifts (store_id, status, opened_at desc);
create index if not exists idx_attendance_shifts_device
  on attendance_shifts (device_id, pos_shift_id);

create table if not exists attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  shift_id uuid not null references attendance_shifts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  user_label text not null,
  status text not null default 'checked_in'
    check (status in ('checked_in', 'checked_out', 'overridden')),
  checked_in_at timestamptz not null default now(),
  check_in_latitude double precision not null,
  check_in_longitude double precision not null,
  check_in_accuracy_m double precision,
  check_in_distance_m double precision not null check (check_in_distance_m >= 0),
  checked_out_at timestamptz,
  check_out_latitude double precision,
  check_out_longitude double precision,
  check_out_accuracy_m double precision,
  check_out_distance_m double precision,
  checkout_overwritten boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shift_id, user_id),
  check (check_in_latitude between -90 and 90 and check_in_longitude between -180 and 180),
  check ((check_out_latitude is null and check_out_longitude is null) or
    (check_out_latitude between -90 and 90 and check_out_longitude between -180 and 180)),
  check (check_in_accuracy_m is null or check_in_accuracy_m >= 0),
  check (check_out_accuracy_m is null or check_out_accuracy_m >= 0),
  check (check_out_distance_m is null or check_out_distance_m >= 0),
  check ((status = 'checked_in' and checked_out_at is null and not checkout_overwritten) or
    (status = 'checked_out' and checked_out_at is not null and not checkout_overwritten) or
    (status = 'overridden' and checked_out_at is not null and checkout_overwritten))
);
create index if not exists idx_attendance_sessions_store_shift
  on attendance_sessions (store_id, shift_id, checked_in_at);
create index if not exists idx_attendance_sessions_user_recent
  on attendance_sessions (user_id, checked_in_at desc);
create index if not exists idx_attendance_sessions_open
  on attendance_sessions (shift_id, status) where status = 'checked_in';

create table if not exists attendance_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  shift_id uuid not null references attendance_shifts(id) on delete cascade,
  session_id uuid references attendance_sessions(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete restrict,
  event_type text not null
    check (event_type in ('check_in', 'check_out', 'forced_check_out')),
  actor_device_id text,
  request_id uuid,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now(),
  unique (store_id, request_id)
);
create index if not exists idx_attendance_events_store_shift
  on attendance_events (store_id, shift_id, created_at desc);
create index if not exists idx_attendance_events_user
  on attendance_events (user_id, created_at desc);

alter table attendance_settings enable row level security;
alter table attendance_shifts enable row level security;
alter table attendance_sessions enable row level security;
alter table attendance_events enable row level security;

revoke all on attendance_settings, attendance_shifts, attendance_sessions, attendance_events
  from anon, authenticated;
grant select on attendance_settings, attendance_shifts, attendance_sessions, attendance_events
  to authenticated;

create policy attendance_settings_member_read on attendance_settings
  for select to authenticated using (can_access_active_store(store_id));
create policy attendance_shifts_member_read on attendance_shifts
  for select to authenticated using (can_access_active_store(store_id));
create policy attendance_sessions_member_read on attendance_sessions
  for select to authenticated using (
    can_access_active_store(store_id)
    and (user_id = auth.uid() or can_view_attendance_report(store_id))
  );
create policy attendance_events_member_read on attendance_events
  for select to authenticated using (
    can_access_active_store(store_id)
    and (user_id = auth.uid() or can_view_attendance_report(store_id))
  );

create or replace function attendance_distance_m(
  p_lat_a double precision,
  p_lon_a double precision,
  p_lat_b double precision,
  p_lon_b double precision
)
returns double precision
language sql
immutable
strict
set search_path = public, extensions
as $$
  select 6371000 * 2 * asin(sqrt(least(1::double precision,
    power(sin(radians(p_lat_b - p_lat_a) / 2), 2)
    + cos(radians(p_lat_a)) * cos(radians(p_lat_b))
    * power(sin(radians(p_lon_b - p_lon_a) / 2), 2)
  )));
$$;

create or replace function attendance_check_in(
  p_shift_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision default null,
  p_request_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_shift attendance_shifts%rowtype;
  v_session attendance_sessions%rowtype;
  v_label text;
  v_distance double precision;
  v_existing attendance_events%rowtype;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_shift_id is null or p_request_id is null
    or p_latitude is null or p_longitude is null
    or p_latitude not between -90 and 90 or p_longitude not between -180 and 180
    or (p_accuracy_m is not null and (p_accuracy_m < 0 or p_accuracy_m > 10000)) then
    raise exception 'INVALID_LOCATION';
  end if;

  select * into v_shift from attendance_shifts where id = p_shift_id for update;
  if not found or not can_access_active_store(v_shift.store_id) then raise exception 'STORE_ACCESS_DENIED'; end if;
  if v_shift.status <> 'open' then raise exception 'SHIFT_NOT_OPEN'; end if;
  if v_shift.latitude is null or v_shift.longitude is null then raise exception 'POS_LOCATION_UNAVAILABLE'; end if;

  select * into v_existing from attendance_events
    where store_id = v_shift.store_id and request_id = p_request_id;
  if found then
    if v_existing.shift_id <> p_shift_id or v_existing.user_id <> v_user or v_existing.event_type <> 'check_in' then
      raise exception 'REQUEST_ID_CONFLICT';
    end if;
    select * into v_session from attendance_sessions where id = v_existing.session_id;
    return jsonb_build_object('ok', true, 'sessionId', v_session.id,
      'distanceM', v_session.check_in_distance_m, 'status', v_session.status);
  end if;

  v_distance := attendance_distance_m(v_shift.latitude, v_shift.longitude, p_latitude, p_longitude);
  if v_distance > v_shift.radius_m then raise exception 'OUTSIDE_GEOFENCE'; end if;
  perform pg_advisory_xact_lock(hashtext(v_shift.store_id::text), hashtext(v_user::text));
  if exists (select 1 from attendance_sessions where shift_id = p_shift_id and user_id = v_user) then
    raise exception 'ALREADY_CHECKED_IN';
  end if;

  v_label := coalesce(nullif(auth.jwt()->'user_metadata'->>'name', ''),
    nullif(auth.jwt()->'user_metadata'->>'username', ''), auth.jwt()->>'email', 'Pengguna');
  insert into attendance_sessions (
    store_id, shift_id, user_id, user_label, check_in_latitude, check_in_longitude,
    check_in_accuracy_m, check_in_distance_m
  ) values (
    v_shift.store_id, p_shift_id, v_user, left(v_label, 120), p_latitude, p_longitude,
    p_accuracy_m, v_distance
  ) returning * into v_session;

  insert into attendance_events (store_id, shift_id, session_id, user_id, event_type, request_id, detail)
  values (v_shift.store_id, p_shift_id, v_session.id, v_user, 'check_in', p_request_id,
    jsonb_build_object('latitude', p_latitude, 'longitude', p_longitude,
      'accuracyM', p_accuracy_m, 'distanceM', v_distance));
  return jsonb_build_object('ok', true, 'sessionId', v_session.id,
    'distanceM', v_distance, 'status', v_session.status);
end;
$$;

create or replace function attendance_check_out(
  p_shift_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision default null,
  p_request_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_shift attendance_shifts%rowtype;
  v_session attendance_sessions%rowtype;
  v_distance double precision;
  v_existing attendance_events%rowtype;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_shift_id is null or p_request_id is null
    or p_latitude is null or p_longitude is null
    or p_latitude not between -90 and 90 or p_longitude not between -180 and 180
    or (p_accuracy_m is not null and (p_accuracy_m < 0 or p_accuracy_m > 10000)) then
    raise exception 'INVALID_LOCATION';
  end if;

  select * into v_shift from attendance_shifts where id = p_shift_id for update;
  if not found or not can_access_active_store(v_shift.store_id) then raise exception 'STORE_ACCESS_DENIED'; end if;
  if v_shift.status <> 'open' then raise exception 'SHIFT_NOT_OPEN'; end if;
  if v_shift.latitude is null or v_shift.longitude is null then raise exception 'POS_LOCATION_UNAVAILABLE'; end if;

  select * into v_existing from attendance_events
    where store_id = v_shift.store_id and request_id = p_request_id;
  if found then
    if v_existing.shift_id <> p_shift_id or v_existing.user_id <> v_user or v_existing.event_type <> 'check_out' then
      raise exception 'REQUEST_ID_CONFLICT';
    end if;
    select * into v_session from attendance_sessions where id = v_existing.session_id;
    return jsonb_build_object('ok', true, 'sessionId', v_session.id,
      'distanceM', v_session.check_out_distance_m, 'status', v_session.status);
  end if;

  select * into v_session from attendance_sessions
    where shift_id = p_shift_id and user_id = v_user for update;
  if not found then raise exception 'ATTENDANCE_NOT_STARTED'; end if;
  if v_session.status <> 'checked_in' then raise exception 'ALREADY_CHECKED_OUT'; end if;

  v_distance := attendance_distance_m(v_shift.latitude, v_shift.longitude, p_latitude, p_longitude);
  if v_distance > v_shift.radius_m then raise exception 'OUTSIDE_GEOFENCE'; end if;

  update attendance_sessions set
    status = 'checked_out', checked_out_at = now(), check_out_latitude = p_latitude,
    check_out_longitude = p_longitude, check_out_accuracy_m = p_accuracy_m,
    check_out_distance_m = v_distance, updated_at = now()
  where id = v_session.id returning * into v_session;
  insert into attendance_events (store_id, shift_id, session_id, user_id, event_type, request_id, detail)
  values (v_shift.store_id, p_shift_id, v_session.id, v_user, 'check_out', p_request_id,
    jsonb_build_object('latitude', p_latitude, 'longitude', p_longitude,
      'accuracyM', p_accuracy_m, 'distanceM', v_distance));
  return jsonb_build_object('ok', true, 'sessionId', v_session.id,
    'distanceM', v_distance, 'status', v_session.status);
end;
$$;

create or replace function set_attendance_radius(p_store_id uuid, p_radius_m integer)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_radius_m is null or p_radius_m not between 1 and 1000 then raise exception 'INVALID_RADIUS'; end if;
  if not exists (
    select 1 from store_users where user_id = v_user and store_id = p_store_id
      and membership_status = 'active' and (permission = 'owner' or web_role in ('manager', 'admin'))
  ) then raise exception 'STORE_ACCESS_DENIED'; end if;

  insert into attendance_settings (store_id, radius_m, updated_by, updated_at)
  values (p_store_id, p_radius_m, v_user, now())
  on conflict (store_id) do update set
    radius_m = excluded.radius_m, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return p_radius_m;
end;
$$;

revoke all on function can_access_active_store(uuid) from public;
revoke all on function can_view_attendance_report(uuid) from public;
revoke all on function attendance_distance_m(double precision, double precision, double precision, double precision) from public;
revoke all on function attendance_check_in(uuid, double precision, double precision, double precision, uuid) from public;
revoke all on function attendance_check_out(uuid, double precision, double precision, double precision, uuid) from public;
revoke all on function set_attendance_radius(uuid, integer) from public;
grant execute on function can_access_active_store(uuid) to authenticated;
grant execute on function can_view_attendance_report(uuid) to authenticated;
grant execute on function attendance_check_in(uuid, double precision, double precision, double precision, uuid) to authenticated;
grant execute on function attendance_check_out(uuid, double precision, double precision, double precision, uuid) to authenticated;
grant execute on function set_attendance_radius(uuid, integer) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance_shifts') then
      alter publication supabase_realtime add table public.attendance_shifts;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance_sessions') then
      alter publication supabase_realtime add table public.attendance_sessions;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance_events') then
      alter publication supabase_realtime add table public.attendance_events;
    end if;
  end if;
end;
$$;