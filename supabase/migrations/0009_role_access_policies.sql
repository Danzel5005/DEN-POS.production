create or replace function can_access_store_role(p_store uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from store_users
    where user_id = auth.uid() and store_id = p_store
      and membership_status = 'active' and web_role = any(p_roles)
  );
$$;
revoke all on function can_access_store_role(uuid, text[]) from public;
grant execute on function can_access_store_role(uuid, text[]) to authenticated;

create or replace function can_access_store(p_store uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from store_users
    where user_id = auth.uid() and store_id = p_store and membership_status = 'active'
  );
$$;

drop policy if exists store_member_read_trx on synced_transactions;
create policy store_report_roles_read_trx on synced_transactions
  for select to authenticated using (can_access_store_role(store_id, array['manager','admin']));

drop policy if exists stock_items_member_read on stock_items;
create policy stock_roles_read_items on stock_items
  for select to authenticated using (can_access_store_role(store_id, array['purchasing','admin']));
drop policy if exists restock_events_member_read on restock_events;
create policy stock_roles_read_restock on restock_events
  for select to authenticated using (can_access_store_role(store_id, array['purchasing','admin']));
drop policy if exists stock_sync_member_read on stock_sync_state;
create policy stock_roles_read_sync on stock_sync_state
  for select to authenticated using (can_access_store_role(store_id, array['purchasing','admin']));

drop policy if exists kds_stations_member_read on kds_stations;
create policy kds_roles_read_stations on kds_stations
  for select to authenticated using (can_access_store_role(store_id, array['kasir','bar','admin']));
drop policy if exists kds_tickets_member_read on kds_tickets;
create policy kds_roles_read_tickets on kds_tickets
  for select to authenticated using (can_access_store_role(store_id, array['kasir','bar','admin']));

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
  if not can_access_store_role(v_ticket.store_id, array['kasir','bar','admin']) then raise exception 'STORE_ACCESS_DENIED'; end if;
  if v_ticket.kind = 'cancel' then raise exception 'CANCELLATION_TICKET_READ_ONLY'; end if;
  v_allowed := (p_new_status = 'cancelled' and v_ticket.status <> 'cancelled')
    or (v_ticket.status = 'new' and p_new_status = 'preparing')
    or (v_ticket.status = 'preparing' and p_new_status in ('new', 'ready'))
    or (v_ticket.status = 'ready' and p_new_status in ('preparing', 'served'))
    or (v_ticket.status = 'served' and p_new_status = 'ready');
  if not v_allowed then raise exception 'INVALID_STATUS_TRANSITION'; end if;
  update kds_tickets set status = p_new_status,
    preparing_at = case when p_new_status = 'preparing' then v_now when p_new_status = 'new' then null else preparing_at end,
    ready_at = case when p_new_status = 'ready' then v_now when p_new_status in ('preparing', 'new') then null else ready_at end,
    served_at = case when p_new_status = 'served' then v_now else null end,
    cancelled_at = case when p_new_status = 'cancelled' then v_now else null end,
    kind = case when p_new_status = 'cancelled' then 'cancel' else kind end,
    kind_label = case when p_new_status = 'cancelled' then 'Batal' else kind_label end,
    status_changed_by = auth.uid(), status_changed_by_device = null, status_changed_at = v_now
  where id = p_ticket_id;
  return p_ticket_id;
end;
$$;