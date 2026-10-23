create or replace function attendance_pos_close_shift(
  p_device_id text,
  p_shift_id uuid,
  p_overwrite boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_store uuid;
  v_shift attendance_shifts%rowtype;
  v_pending jsonb;
  v_now timestamptz := now();
begin
  select store_id into v_store from devices
  where device_id = p_device_id and status = 'active';
  if v_store is null then raise exception 'DEVICE_NOT_AUTHORIZED'; end if;

  select * into v_shift from attendance_shifts
  where id = p_shift_id and store_id = v_store and device_id = p_device_id for update;
  if not found then raise exception 'SHIFT_NOT_FOUND'; end if;
  if v_shift.status = 'closed' then
    return jsonb_build_object('ok', true, 'closed', true, 'pending', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('userId', user_id, 'name', user_label)), '[]'::jsonb)
  into v_pending from attendance_sessions where shift_id = p_shift_id and status = 'checked_in';
  if jsonb_array_length(v_pending) > 0 and not p_overwrite then
    return jsonb_build_object('ok', false, 'code', 'CHECKOUTS_PENDING', 'pending', v_pending);
  end if;

  if jsonb_array_length(v_pending) > 0 then
    update attendance_sessions set status = 'overridden', checked_out_at = v_now,
      checkout_overwritten = true, updated_at = v_now
    where shift_id = p_shift_id and status = 'checked_in';
    insert into attendance_events (store_id, shift_id, session_id, user_id, event_type,
      actor_device_id, request_id, detail)
    select v_store, p_shift_id, id, user_id, 'forced_check_out', p_device_id,
      gen_random_uuid(), jsonb_build_object('reason', 'Shift ditutup oleh DEN POS')
    from attendance_sessions where shift_id = p_shift_id and status = 'overridden' and updated_at = v_now;
  end if;

  update attendance_shifts set status = 'closed', closed_at = v_now, updated_at = v_now
  where id = p_shift_id;
  return jsonb_build_object('ok', true, 'closed', true, 'overwritten', jsonb_array_length(v_pending));
end;
$$;

revoke all on function attendance_pos_close_shift(text, uuid, boolean) from public, anon, authenticated;
grant execute on function attendance_pos_close_shift(text, uuid, boolean) to service_role;