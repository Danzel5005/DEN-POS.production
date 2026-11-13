-- Employee attendance uses Supabase Auth for employees and keeps the existing
-- shift-based attendance tables readable for historical POS attendance.

create table if not exists attendance_locations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_m integer not null check (radius_m between 1 and 1000),
  max_accuracy_m integer not null default 100 check (max_accuracy_m between 1 and 1000),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, id)
);

create index if not exists attendance_locations_store_status
  on attendance_locations (store_id, status);

create table if not exists registered_devices (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  user_id uuid not null,
  device_uuid uuid not null,
  device_name text,
  user_email text,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'revoked')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (user_id, store_id)
    references store_users(user_id, store_id) on delete cascade,
  unique (store_id, user_id, device_uuid),
  unique (store_id, user_id, id)
);

create index if not exists registered_devices_user_status
  on registered_devices (store_id, user_id, status);

create table if not exists device_locations (
  registered_device_id uuid primary key
    references registered_devices(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision not null check (accuracy_m >= 0),
  observed_at timestamptz not null default now()
);

alter table attendance_sessions alter column shift_id drop not null;
alter table attendance_sessions
  add column if not exists user_email text,
  add column if not exists location_id uuid,
  add column if not exists registered_device_id uuid;

alter table attendance_sessions
  drop constraint if exists attendance_sessions_location_fk,
  add constraint attendance_sessions_location_fk
    foreign key (store_id, location_id)
    references attendance_locations(store_id, id),
  drop constraint if exists attendance_sessions_device_fk,
  add constraint attendance_sessions_device_fk
    foreign key (store_id, user_id, registered_device_id)
    references registered_devices(store_id, user_id, id);

alter table attendance_events alter column shift_id drop not null;

create unique index if not exists attendance_sessions_one_active_per_user
  on attendance_sessions (user_id)
  where status = 'checked_in';

create index if not exists attendance_sessions_location_recent
  on attendance_sessions (store_id, location_id, checked_in_at desc);

create or replace function attendance_lock_active_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.status = 'checked_in' then
    perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
    if exists (
      select 1 from attendance_sessions
      where user_id = new.user_id and status = 'checked_in'
        and (tg_op = 'INSERT' or id <> new.id)
    ) then
      raise exception 'ALREADY_CHECKED_IN';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_sessions_lock_active_user on attendance_sessions;
create trigger attendance_sessions_lock_active_user
  before insert or update of status on attendance_sessions
  for each row execute function attendance_lock_active_user();

create table if not exists attendance_attempts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text,
  device_uuid uuid,
  request_id uuid not null,
  outcome text not null check (outcome in ('accepted', 'rejected')),
  code text not null,
  created_at timestamptz not null default now(),
  unique (store_id, request_id)
);

create index if not exists attendance_attempts_user_recent
  on attendance_attempts (user_id, created_at desc);

-- Existing shift-based RPCs also snapshot the authenticated account email.
create or replace function attendance_snapshot_user_email()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.user_email is null then
    select email into new.user_email
    from auth.users
    where id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_sessions_snapshot_email on attendance_sessions;
create trigger attendance_sessions_snapshot_email
  before insert on attendance_sessions
  for each row execute function attendance_snapshot_user_email();

drop trigger if exists registered_devices_snapshot_email on registered_devices;
create trigger registered_devices_snapshot_email
  before insert on registered_devices
  for each row execute function attendance_snapshot_user_email();

update attendance_sessions a
set user_email = u.email
from auth.users u
where a.user_id = u.id and a.user_email is null;

update registered_devices d
set user_email = u.email
from auth.users u
where d.user_id = u.id and d.user_email is null;

create or replace function attendance_log_attempt(
  p_store_id uuid,
  p_user_id uuid,
  p_device_uuid uuid,
  p_request_id uuid,
  p_outcome text,
  p_code text
)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  insert into attendance_attempts (store_id, user_id, user_email, device_uuid, request_id, outcome, code)
  values (
    p_store_id, p_user_id,
    (select email from auth.users where id = p_user_id),
    p_device_uuid, p_request_id, p_outcome, p_code
  )
  on conflict (store_id, request_id) do nothing;
$$;

create or replace function register_attendance_device(
  p_store_id uuid,
  p_device_uuid uuid,
  p_device_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_existing registered_devices%rowtype;
  v_count integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_store_id is null or p_device_uuid is null then raise exception 'INVALID_DEVICE'; end if;
  if not can_access_active_store(p_store_id) then raise exception 'STORE_ACCESS_DENIED'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_store_id::text || ':' || v_user::text, 0));

  select * into v_existing from registered_devices
  where store_id = p_store_id and user_id = v_user and device_uuid = p_device_uuid
  for update;
  if found then
    if v_existing.status = 'revoked' then raise exception 'DEVICE_REVOKED'; end if;
    return jsonb_build_object('ok', true, 'deviceId', v_existing.id, 'status', v_existing.status);
  end if;

  select count(*) into v_count from registered_devices
  where store_id = p_store_id and user_id = v_user and status in ('pending', 'active');
  if v_count >= 2 then raise exception 'DEVICE_LIMIT_REACHED'; end if;

  insert into registered_devices (store_id, user_id, device_uuid, device_name)
  values (p_store_id, v_user, p_device_uuid, left(nullif(trim(p_device_name), ''), 120))
  returning * into v_existing;
  return jsonb_build_object('ok', true, 'deviceId', v_existing.id, 'status', v_existing.status);
end;
$$;

create or replace function submit_attendance(
  p_store_id uuid,
  p_device_uuid uuid,
  p_type text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_device registered_devices%rowtype;
  v_location attendance_locations%rowtype;
  v_session attendance_sessions%rowtype;
  v_event attendance_events%rowtype;
  v_distance double precision;
  v_attempt_count integer;
  v_existing attendance_sessions%rowtype;
  v_now timestamptz := now();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_store_id is null or not can_access_active_store(p_store_id) then
    raise exception 'STORE_ACCESS_DENIED';
  end if;
  if p_request_id is null or p_device_uuid is null or p_type is null or p_type not in ('check_in', 'check_out') then
    if p_request_id is not null then
      perform attendance_log_attempt(p_store_id, v_user, p_device_uuid, p_request_id, 'rejected', 'INVALID_REQUEST');
    end if;
    return jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  select * into v_device from registered_devices
  where store_id = p_store_id and user_id = v_user and device_uuid = p_device_uuid
    and status = 'active';
  if not found then
    perform attendance_log_attempt(p_store_id, v_user, p_device_uuid, p_request_id, 'rejected', 'DEVICE_NOT_APPROVED');
    return jsonb_build_object('ok', false, 'code', 'DEVICE_NOT_APPROVED');
  end if;

  select * into v_event from attendance_events
  where store_id = p_store_id and request_id = p_request_id;
  if found then
    if v_event.user_id <> v_user or v_event.event_type <> p_type then
      return jsonb_build_object('ok', false, 'code', 'REQUEST_ID_CONFLICT');
    end if;
    return jsonb_build_object('ok', true, 'replayed', true, 'sessionId', v_event.session_id);
  end if;

  select email into v_email from auth.users where id = v_user;
  if v_email is null then
    perform attendance_log_attempt(p_store_id, v_user, p_device_uuid, p_request_id, 'rejected', 'EMAIL_REQUIRED');
    return jsonb_build_object('ok', false, 'code', 'EMAIL_REQUIRED');
  end if;

  select count(*) into v_attempt_count from attendance_attempts
  where user_id = v_user and device_uuid = p_device_uuid
    and created_at > v_now - interval '5 minutes';
  if v_attempt_count >= 10 then
    perform attendance_log_attempt(p_store_id, v_user, p_device_uuid, p_request_id, 'rejected', 'RATE_LIMITED');
    return jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  end if;

  if p_latitude is null or p_longitude is null or p_accuracy_m is null
    or p_latitude not between -90 and 90 or p_longitude not between -180 and 180
    or p_accuracy_m < 0 or p_accuracy_m > 10000 then
    perform attendance_log_attempt(p_store_id, v_user, p_device_uuid, p_request_id, 'rejected', 'INVALID_LOCATION');
    return jsonb_build_object('ok', false, 'code', 'INVALID_LOCATION');
  end if;

  select * into v_location
  from attendance_locations
  where store_id = p_store_id and status = 'active'
  order by attendance_distance_m(latitude, longitude, p_latitude, p_longitude)
  limit 1;
  if not found then
    perform attendance_log_attempt(p_store_id, v_user, p_device_uuid, p_request_id, 'rejected', 'NO_ACTIVE_LOCATION');
    return jsonb_build_object('ok', false, 'code', 'NO_ACTIVE_LOCATION');
  end if;

  if p_accuracy_m > v_location.max_accuracy_m then
    perform attendance_log_attempt(p_store_id, v_user, p_device_uuid, p_request_id, 'rejected', 'ACCURACY_TOO_LOW');
    return jsonb_build_object('ok', false, 'code', 'ACCURACY_TOO_LOW');
  end if;
  v_distance := attendance_distance_m(v_location.latitude, v_location.longitude, p_latitude, p_longitude);
  if v_distance > v_location.radius_m then
    perform attendance_log_attempt(p_store_id, v_user, p_device_uuid, p_request_id, 'rejected', 'OUTSIDE_GEOFENCE');
    return jsonb_build_object('ok', false, 'code', 'OUTSIDE_GEOFENCE');
  end if;

  select * into v_existing from attendance_sessions
  where user_id = v_user and status = 'checked_in'
  for update;

  if p_type = 'check_in' then
    if found then
      perform attendance_log_attempt(p_store_id, v_user, p_device_uuid, p_request_id, 'rejected', 'ALREADY_CHECKED_IN');
      return jsonb_build_object('ok', false, 'code', 'ALREADY_CHECKED_IN');
    end if;

    insert into attendance_sessions (
      store_id, shift_id, user_id, user_label, user_email, status,
      check_in_latitude, check_in_longitude, check_in_accuracy_m, check_in_distance_m,
      location_id, registered_device_id, checked_in_at, created_at, updated_at
    )
    values (
      p_store_id, null, v_user,
      coalesce(nullif(auth.jwt()->'user_metadata'->>'name', ''),
        nullif(auth.jwt()->'user_metadata'->>'username', ''), v_email),
      v_email, 'checked_in', p_latitude, p_longitude, p_accuracy_m, v_distance,
      v_location.id, v_device.id, v_now, v_now, v_now
    ) returning * into v_session;
  else
    if not found then
      perform attendance_log_attempt(p_store_id, v_user, p_device_uuid, p_request_id, 'rejected', 'ATTENDANCE_NOT_STARTED');
      return jsonb_build_object('ok', false, 'code', 'ATTENDANCE_NOT_STARTED');
    end if;
    if v_existing.store_id <> p_store_id then
      perform attendance_log_attempt(p_store_id, v_user, p_device_uuid, p_request_id, 'rejected', 'ATTENDANCE_OTHER_STORE');
      return jsonb_build_object('ok', false, 'code', 'ATTENDANCE_OTHER_STORE');
    end if;

    update attendance_sessions
    set status = 'checked_out', checked_out_at = v_now,
      check_out_latitude = p_latitude, check_out_longitude = p_longitude,
      check_out_accuracy_m = p_accuracy_m, check_out_distance_m = v_distance,
      updated_at = v_now
    where id = v_existing.id
    returning * into v_session;
  end if;

  insert into attendance_events (
    store_id, shift_id, session_id, user_id, event_type, actor_device_id, request_id, detail, created_at
  )
  values (
    p_store_id, v_session.shift_id, v_session.id, v_user, p_type, p_device_uuid::text, p_request_id,
    jsonb_build_object('locationId', v_location.id, 'accuracyM', p_accuracy_m, 'distanceM', v_distance),
    v_now
  );
  perform attendance_log_attempt(p_store_id, v_user, p_device_uuid, p_request_id, 'accepted', p_type);
  update registered_devices set last_seen_at = v_now where id = v_device.id;
  insert into device_locations (registered_device_id, latitude, longitude, accuracy_m, observed_at)
  values (v_device.id, p_latitude, p_longitude, p_accuracy_m, v_now)
  on conflict (registered_device_id) do update set
    latitude = excluded.latitude, longitude = excluded.longitude,
    accuracy_m = excluded.accuracy_m, observed_at = excluded.observed_at;

  return jsonb_build_object(
    'ok', true, 'sessionId', v_session.id, 'type', p_type,
    'distanceM', v_distance, 'status', v_session.status, 'recordedAt', v_now
  );
end;
$$;

create or replace function record_attendance_location(
  p_device_uuid uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_device registered_devices%rowtype;
  v_now timestamptz := now();
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_device_uuid is null or p_latitude is null or p_longitude is null or p_accuracy_m is null
    or p_latitude not between -90 and 90 or p_longitude not between -180 and 180
    or p_accuracy_m < 0 or p_accuracy_m > 10000 then
    raise exception 'INVALID_LOCATION';
  end if;

  select * into v_device from registered_devices
  where user_id = auth.uid() and device_uuid = p_device_uuid and status = 'active'
  for update;
  if not found then raise exception 'DEVICE_NOT_APPROVED'; end if;

  insert into device_locations (registered_device_id, latitude, longitude, accuracy_m, observed_at)
  values (v_device.id, p_latitude, p_longitude, p_accuracy_m, v_now)
  on conflict (registered_device_id) do update set
    latitude = excluded.latitude, longitude = excluded.longitude,
    accuracy_m = excluded.accuracy_m, observed_at = excluded.observed_at;

  update registered_devices set last_seen_at = v_now where id = v_device.id;
end;
$$;

create or replace function heartbeat_attendance_device(p_device_uuid uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  update registered_devices set last_seen_at = now()
  where user_id = auth.uid() and device_uuid = p_device_uuid and status = 'active';
  if not found then raise exception 'DEVICE_NOT_APPROVED'; end if;
end;
$$;

create or replace function set_attendance_device_status(p_device_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_device registered_devices%rowtype;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_status not in ('active', 'revoked') then raise exception 'INVALID_DEVICE_STATUS'; end if;

  select * into v_device from registered_devices where id = p_device_id for update;
  if not found or not can_access_store_role(v_device.store_id, array['admin']) then
    raise exception 'STORE_ACCESS_DENIED';
  end if;

  if p_status = 'active' and v_device.status = 'revoked' then
    if (select count(*) from registered_devices
      where store_id = v_device.store_id and user_id = v_device.user_id
        and status in ('pending', 'active')) >= 2 then
      raise exception 'DEVICE_LIMIT_REACHED';
    end if;
  end if;

  update registered_devices set status = p_status,
    approved_by = case when p_status = 'active' then auth.uid() else approved_by end,
    approved_at = case when p_status = 'active' then now() else approved_at end
  where id = p_device_id;
end;
$$;

alter table attendance_locations enable row level security;
alter table registered_devices enable row level security;
alter table device_locations enable row level security;
alter table attendance_attempts enable row level security;

revoke all on attendance_locations, registered_devices, device_locations, attendance_attempts
  from anon, authenticated;
grant select on attendance_locations, registered_devices, device_locations to authenticated;
grant insert, update on attendance_locations to authenticated;
grant select on attendance_attempts to authenticated;

create policy attendance_locations_member_read on attendance_locations
  for select to authenticated using (can_access_active_store(store_id) and status = 'active');
create policy attendance_locations_admin_read on attendance_locations
  for select to authenticated using (can_access_store_role(store_id, array['admin']));
create policy attendance_locations_admin_insert on attendance_locations
  for insert to authenticated with check (can_access_store_role(store_id, array['admin']));
create policy attendance_locations_admin_update on attendance_locations
  for update to authenticated using (can_access_store_role(store_id, array['admin']))
  with check (can_access_store_role(store_id, array['admin']));

create policy registered_devices_scoped_read on registered_devices
  for select to authenticated using (
    user_id = auth.uid()
    or can_access_store_role(store_id, array['admin'])
  );

create policy device_locations_scoped_read on device_locations
  for select to authenticated using (
    exists (
      select 1 from registered_devices d
      where d.id = registered_device_id
        and (d.user_id = auth.uid() or can_access_store_role(d.store_id, array['admin']))
    )
  );

create policy attendance_attempts_admin_read on attendance_attempts
  for select to authenticated using (can_access_store_role(store_id, array['admin']));

create policy attendance_store_members_receive_broadcast on realtime.messages
  for select to authenticated using (
    exists (
      select 1 from store_users m
      where m.user_id = auth.uid() and m.membership_status = 'active'
        and realtime.topic() = 'attendance-store-' || m.store_id::text
    )
  );

create policy attendance_store_admin_send_broadcast on realtime.messages
  for insert to authenticated with check (
    exists (
      select 1 from store_users m
      where m.user_id = auth.uid() and m.membership_status = 'active'
        and m.web_role = 'admin'
        and realtime.topic() = 'attendance-store-' || m.store_id::text
    )
  );

revoke all on function attendance_snapshot_user_email() from public, anon, authenticated;
revoke all on function attendance_lock_active_user() from public, anon, authenticated;
revoke all on function attendance_log_attempt(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function register_attendance_device(uuid, uuid, text) from public, anon;
revoke all on function submit_attendance(uuid, uuid, text, double precision, double precision, double precision, uuid) from public, anon;
revoke all on function record_attendance_location(uuid, double precision, double precision, double precision) from public, anon;
revoke all on function heartbeat_attendance_device(uuid) from public, anon;
revoke all on function set_attendance_device_status(uuid, text) from public, anon;
grant execute on function register_attendance_device(uuid, uuid, text) to authenticated;
grant execute on function submit_attendance(uuid, uuid, text, double precision, double precision, double precision, uuid) to authenticated;
grant execute on function record_attendance_location(uuid, double precision, double precision, double precision) to authenticated;
grant execute on function heartbeat_attendance_device(uuid) to authenticated;
grant execute on function set_attendance_device_status(uuid, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance_locations') then
      alter publication supabase_realtime add table public.attendance_locations;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'registered_devices') then
      alter publication supabase_realtime add table public.registered_devices;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'device_locations') then
      alter publication supabase_realtime add table public.device_locations;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance_attempts') then
      alter publication supabase_realtime add table public.attendance_attempts;
    end if;
  end if;
end;
$$;
