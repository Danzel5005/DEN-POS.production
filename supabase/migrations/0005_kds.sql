create table kds_stations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  label text not null,
  category_keys text[] not null default '{}',
  sort_order integer not null default 0,
  unique (store_id, label)
);

create table kds_tickets (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  client_ticket_id text not null,
  kind text not null check (kind in ('order', 'addition', 'cancel')),
  kind_label text not null,
  source_ref text not null,
  source_label text not null,
  station_id uuid references kds_stations(id) on delete set null,
  station_label text not null,
  table_label text,
  extras jsonb not null default '[]'::jsonb check (jsonb_typeof(extras) = 'array'),
  note text,
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  status text not null default 'new' check (status in ('new', 'preparing', 'ready', 'served', 'cancelled')),
  created_by_label text,
  device_label text,
  created_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  preparing_at timestamptz,
  ready_at timestamptz,
  served_at timestamptz,
  cancelled_at timestamptz,
  status_changed_by uuid references auth.users(id) on delete set null,
  status_changed_by_device text,
  status_changed_at timestamptz,
  unique (store_id, client_ticket_id)
);

create index kds_tickets_store_status_created on kds_tickets (store_id, status, created_at);
create index kds_tickets_store_source on kds_tickets (store_id, source_ref);
create index kds_tickets_store_created on kds_tickets (store_id, created_at);
create index kds_tickets_store_received on kds_tickets (store_id, received_at);

alter table kds_stations enable row level security;
alter table kds_tickets enable row level security;
revoke all on kds_stations, kds_tickets from anon, authenticated;
grant select on kds_stations, kds_tickets to authenticated;

create policy kds_stations_member_read on kds_stations
  for select to authenticated using (can_access_store(store_id));
create policy kds_tickets_member_read on kds_tickets
  for select to authenticated using (can_access_store(store_id));

create or replace function kds_device_store(p_device_id text, p_device_secret text)
returns table (store_id uuid, device_label text)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
  select d.store_id, coalesce(nullif(d.device_name, ''), 'Kasir')
  from devices d
  where d.device_id = p_device_id
    and (d.credential_hash = p_device_secret
      or d.credential_hash = encode(digest(p_device_secret, 'sha256'), 'hex'))
    and d.status = 'active'
    and d.store_id is not null;

  if not found then raise exception 'DEVICE_NOT_AUTHORIZED'; end if;
end;
$$;

create or replace function kds_create_ticket(p_device_id text, p_device_secret text, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_store_id uuid;
  v_device_label text;
  v_client_ticket_id text;
  v_kind text;
  v_source_ref text;
  v_station_id uuid;
  v_station_label text;
  v_created_at timestamptz;
  v_item jsonb;
  v_items jsonb := '[]'::jsonb;
  v_extras jsonb := '[]'::jsonb;
  v_item_label text;
  v_extra_label text;
  v_qty numeric;
  v_id uuid;
begin
  if p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'INVALID_PAYLOAD'; end if;
  select d.store_id, d.device_label into v_store_id, v_device_label
  from kds_device_store(p_device_id, p_device_secret) d;

  v_client_ticket_id := nullif(btrim(p_payload->>'client_ticket_id'), '');
  v_kind := p_payload->>'kind';
  v_source_ref := nullif(btrim(p_payload->>'source_ref'), '');
  if v_client_ticket_id is null or length(v_client_ticket_id) > 240 then raise exception 'INVALID_TICKET_ID'; end if;
  if v_kind is null or v_kind not in ('order', 'addition', 'cancel') then raise exception 'INVALID_TICKET_KIND'; end if;
  if v_source_ref is null or length(v_source_ref) > 240 then raise exception 'INVALID_SOURCE_REF'; end if;
  select id into v_id from kds_tickets where store_id = v_store_id and client_ticket_id = v_client_ticket_id;
  if v_id is not null then return v_id; end if;
  if (select count(*) from kds_tickets where store_id = v_store_id and received_at >= now() - interval '1 minute') >= 120 then
    raise exception 'KDS_RATE_LIMIT';
  end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array'
    or jsonb_array_length(p_payload->'items') < 1
    or jsonb_array_length(p_payload->'items') > 100 then raise exception 'INVALID_ITEMS'; end if;

  begin
    v_station_id := nullif(p_payload->>'station_id', '')::uuid;
    v_created_at := coalesce(nullif(p_payload->>'created_at', '')::timestamptz, now());
  exception when others then
    raise exception 'INVALID_TICKET_METADATA';
  end;
  v_station_label := coalesce(nullif(left(btrim(p_payload->>'station_label'), 80), ''), 'Lainnya');
  if v_station_id is not null then
    insert into kds_stations (id, store_id, label)
    values (v_station_id, v_store_id, v_station_label)
    on conflict (store_id, label) do update set label = excluded.label
    returning id into v_station_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_payload->'items')
  loop
    if jsonb_typeof(v_item) is distinct from 'object' then raise exception 'INVALID_ITEM'; end if;
    v_item_label := nullif(btrim(v_item->>'label'), '');
    begin v_qty := (v_item->>'qty')::numeric;
    exception when others then raise exception 'INVALID_ITEM'; end;
    if v_item_label is null or length(v_item_label) > 160
      or v_qty is null or v_qty <= 0 or v_qty > 1000000 or v_qty <> round(v_qty, 3) then
      raise exception 'INVALID_ITEM';
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'label', v_item_label,
      'category_label', coalesce(nullif(left(btrim(v_item->>'category_label'), 120), ''), 'Lainnya'),
      'qty', v_qty,
      'unit_label', left(coalesce(v_item->>'unit_label', ''), 40),
      'note', left(coalesce(v_item->>'note', ''), 300)
    ));
  end loop;

  if jsonb_typeof(coalesce(p_payload->'extras', '[]'::jsonb)) is distinct from 'array'
    or jsonb_array_length(coalesce(p_payload->'extras', '[]'::jsonb)) > 20 then raise exception 'INVALID_EXTRAS'; end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_payload->'extras', '[]'::jsonb))
  loop
    v_extra_label := nullif(btrim(v_item->>'label'), '');
    if jsonb_typeof(v_item) is distinct from 'object' or v_extra_label is null or length(v_extra_label) > 80 then
      raise exception 'INVALID_EXTRAS';
    end if;
    v_extras := v_extras || jsonb_build_array(jsonb_build_object(
      'label', v_extra_label, 'value', left(coalesce(v_item->>'value', ''), 200)
    ));
  end loop;

  insert into kds_tickets (
    store_id, client_ticket_id, kind, kind_label, source_ref, source_label,
    station_id, station_label, table_label, extras, note, items,
    created_by_label, device_label, created_at
  ) values (
    v_store_id, v_client_ticket_id, v_kind,
    case v_kind when 'addition' then 'Tambahan' when 'cancel' then 'Batal' else 'Pesanan Baru' end,
    v_source_ref,
    coalesce(nullif(left(btrim(p_payload->>'source_label'), 120), ''), 'Pesanan'),
    v_station_id, v_station_label,
    nullif(left(btrim(p_payload->>'table_label'), 80), ''),
    v_extras,
    nullif(left(btrim(p_payload->>'note'), 1000), ''), v_items,
    nullif(left(btrim(p_payload->>'created_by_label'), 80), ''),
    coalesce(nullif(left(btrim(p_payload->>'device_label'), 80), ''), v_device_label),
    v_created_at
  ) on conflict (store_id, client_ticket_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from kds_tickets where store_id = v_store_id and client_ticket_id = v_client_ticket_id;
  end if;
  return v_id;
end;
$$;

create or replace function kds_cancel_tickets(p_device_id text, p_device_secret text, p_source_ref text)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_store_id uuid;
  v_device_label text;
  v_count integer;
begin
  select d.store_id, d.device_label into v_store_id, v_device_label
  from kds_device_store(p_device_id, p_device_secret) d;
  if nullif(btrim(p_source_ref), '') is null then raise exception 'INVALID_SOURCE_REF'; end if;

  update kds_tickets set
    status = 'cancelled', kind = 'cancel', kind_label = 'Batal', cancelled_at = now(),
    status_changed_by = null, status_changed_by_device = v_device_label, status_changed_at = now()
  where store_id = v_store_id and source_ref = p_source_ref
    and status in ('new', 'preparing', 'ready');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function kds_set_status(p_ticket_id uuid, p_new_status text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ticket kds_tickets%rowtype;
  v_allowed boolean := false;
  v_now timestamptz := now();
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_new_status is null or p_new_status not in ('new', 'preparing', 'ready', 'served', 'cancelled') then raise exception 'INVALID_STATUS'; end if;

  select * into v_ticket from kds_tickets where id = p_ticket_id for update;
  if not found then raise exception 'TICKET_NOT_FOUND'; end if;
  if not can_access_store(v_ticket.store_id) then raise exception 'STORE_ACCESS_DENIED'; end if;
  if v_ticket.kind = 'cancel' then raise exception 'CANCELLATION_TICKET_READ_ONLY'; end if;

  v_allowed := p_new_status = 'cancelled' and v_ticket.status <> 'cancelled'
    or (v_ticket.status = 'new' and p_new_status = 'preparing')
    or (v_ticket.status = 'preparing' and p_new_status in ('new', 'ready'))
    or (v_ticket.status = 'ready' and p_new_status in ('preparing', 'served'))
    or (v_ticket.status = 'served' and p_new_status = 'ready');
  if not v_allowed then raise exception 'INVALID_STATUS_TRANSITION'; end if;

  update kds_tickets set
    status = p_new_status,
    preparing_at = case when p_new_status = 'preparing' then v_now when p_new_status = 'new' then null else preparing_at end,
    ready_at = case when p_new_status = 'ready' then v_now when p_new_status in ('preparing', 'new') then null else ready_at end,
    served_at = case when p_new_status = 'served' then v_now when p_new_status <> 'served' then null else served_at end,
    cancelled_at = case when p_new_status = 'cancelled' then v_now else null end,
    kind = case when p_new_status = 'cancelled' then 'cancel' else kind end,
    kind_label = case when p_new_status = 'cancelled' then 'Batal' else kind_label end,
    status_changed_by = auth.uid(), status_changed_by_device = null, status_changed_at = v_now
  where id = p_ticket_id;
  return p_ticket_id;
end;
$$;

create or replace function kds_prune_tickets(p_retention_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if p_retention_days < 1 or p_retention_days > 90 then raise exception 'INVALID_RETENTION_DAYS'; end if;
  delete from kds_tickets
  where status in ('served', 'cancelled')
    and created_at < now() - make_interval(days => p_retention_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function kds_device_store(text, text) from public, anon, authenticated;
revoke all on function kds_create_ticket(text, text, jsonb) from public, anon, authenticated;
revoke all on function kds_cancel_tickets(text, text, text) from public, anon, authenticated;
revoke all on function kds_set_status(uuid, text) from public, anon;
revoke all on function kds_prune_tickets(integer) from public, anon, authenticated;
grant execute on function kds_create_ticket(text, text, jsonb) to service_role;
grant execute on function kds_cancel_tickets(text, text, text) to service_role;
grant execute on function kds_set_status(uuid, text) to authenticated;
grant execute on function kds_prune_tickets(integer) to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kds_tickets') then
    alter publication supabase_realtime add table public.kds_tickets;
  end if;
end $$;