import { handlePreflight, json, fail } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { verifySignedRequest } from "../_shared/verify.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return fail("METHOD_NOT_ALLOWED", 405);
  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).length > 65536) return fail("BODY_TOO_LARGE", 413);
  let body: { action?: string; shift?: Record<string, unknown>; shiftId?: string; overwrite?: boolean; userId?: string; role?: string; radiusM?: number };
  try { body = JSON.parse(rawBody || "{}"); } catch { return fail("INVALID_JSON", 400); }
  const verified = await verifySignedRequest(req, rawBody);
  if (!verified.ok || !verified.device) return fail(verified.error || "UNAUTHORIZED", verified.status || 401);
  const device = verified.device;
  if (!device.store_id || device.status !== "active") return fail("DEVICE_NOT_PAIRED", 403);
  const db = serviceClient();

  if (body.action === "shift-open") {
    const shift = body.shift || {};
    const latitude = Number(shift.latitude);
    const longitude = Number(shift.longitude);
    if (!shift.id || String(shift.id).length > 120 || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isFinite(Date.parse(String(shift.openedAt || "")))) {
      return fail("INVALID_SHIFT_OR_LOCATION", 400);
    }
    const { data: prior, error: priorError } = await db.from("attendance_shifts")
      .select("id,status,radius_m").eq("store_id", device.store_id).eq("device_id", device.device_id)
      .eq("pos_shift_id", String(shift.id)).maybeSingle();
    if (priorError) return fail("ATTENDANCE_LOOKUP_FAILED", 500);
    if (prior?.status === "closed") return fail("SHIFT_ALREADY_CLOSED", 409);
    const { data: settings } = await db.from("attendance_settings").select("radius_m")
      .eq("store_id", device.store_id).maybeSingle();
    const row = {
      store_id: device.store_id, device_id: device.device_id, pos_shift_id: String(shift.id),
      shift_num: Number.isInteger(Number(shift.shiftNum)) ? Number(shift.shiftNum) : null,
      operator_label: String(shift.operator || "DEN POS").slice(0, 120), status: "open",
      opened_at: String(shift.openedAt), latitude, longitude,
      location_accuracy_m: Number.isFinite(Number(shift.accuracy)) && Number(shift.accuracy) >= 0 ? Number(shift.accuracy) : null,
      location_updated_at: new Date().toISOString(), radius_m: prior?.radius_m || settings?.radius_m || 20,
      updated_at: new Date().toISOString(),
    };
    const query = prior ? db.from("attendance_shifts").update(row).eq("id", prior.id) : db.from("attendance_shifts").insert(row);
    const { data, error } = await query.select("id,radius_m").single();
    if (error) return fail("ATTENDANCE_SHIFT_SAVE_FAILED", 500, { detail: error.message });
    return json({ ok: true, shiftId: data.id, radiusM: data.radius_m });
  }

  if (body.action === "shift-close") {
    if (!body.shiftId || !/^[0-9a-f-]{36}$/i.test(body.shiftId)) return fail("INVALID_SHIFT_ID", 400);
    const { data, error } = await db.rpc("attendance_pos_close_shift", {
      p_device_id: device.device_id, p_shift_id: body.shiftId, p_overwrite: body.overwrite === true,
    });
    if (error) return fail(error.message || "ATTENDANCE_SHIFT_CLOSE_FAILED", 400);
    if (!data?.ok && data?.code === "CHECKOUTS_PENDING") {
      const reminders = (data.pending || []).filter((item: { userId?: string }) => item.userId).map((item: { userId: string }) => ({
        store_id: device.store_id, shift_id: body.shiftId, user_id: item.userId,
        message: "Admin DEN POS akan menutup shift. Segera presensi keluar.",
      }));
      if (reminders.length) await db.from("attendance_reminders").insert(reminders);
    }
    return json(data, data?.ok ? 200 : 409);
  }

  if (body.action === "attendance-log") {
    const { data, error } = await db.from("attendance_sessions")
      .select("id,user_label,status,checked_in_at,checked_out_at,check_in_distance_m,check_out_distance_m,checkout_overwritten,attendance_shifts!inner(shift_num,operator_label)")
      .eq("store_id", device.store_id).order("checked_in_at", { ascending: false }).limit(1000);
    if (error) return fail("ATTENDANCE_LOG_FAILED", 500, { detail: error.message });
    return json({ ok: true, rows: data || [] });
  }

  if (body.action === "attendance-settings") {
    const { data, error } = await db.from("attendance_settings").select("radius_m")
      .eq("store_id", device.store_id).maybeSingle();
    if (error) return fail("ATTENDANCE_SETTINGS_FAILED", 500);
    return json({ ok: true, radiusM: data?.radius_m || 20 });
  }

  if (body.action === "attendance-radius-set") {
    const radius = Number(body.radiusM);
    if (!Number.isInteger(radius) || radius < 1 || radius > 1000) return fail("INVALID_RADIUS", 400);
    const now = new Date().toISOString();
    const { error } = await db.from("attendance_settings").upsert({
      store_id: device.store_id, radius_m: radius, updated_at: now,
    }, { onConflict: "store_id" });
    if (error) return fail("ATTENDANCE_RADIUS_SAVE_FAILED", 500, { detail: error.message });
    const { error: shiftsError } = await db.from("attendance_shifts").update({ radius_m: radius, updated_at: now })
      .eq("store_id", device.store_id).eq("status", "open");
    if (shiftsError) return fail("ATTENDANCE_RADIUS_SHIFT_UPDATE_FAILED", 500, { detail: shiftsError.message });
    return json({ ok: true, radiusM: radius });
  }

  if (body.action === "members-list") {
    const { data: members, error } = await db.from("store_users")
      .select("user_id,web_role,membership_status,permission,created_at")
      .eq("store_id", device.store_id).order("created_at", { ascending: true });
    if (error) return fail("MEMBERS_LOOKUP_FAILED", 500);
    const users = await Promise.all((members || []).map(async (member) => {
      const { data } = await db.auth.admin.getUserById(member.user_id);
      return { ...member, username: data?.user?.user_metadata?.username || data?.user?.email?.split("@")[0] || member.user_id, name: data?.user?.user_metadata?.name || data?.user?.email?.split("@")[0] || "Pengguna" };
    }));
    return json({ ok: true, users });
  }

  if (body.action === "member-role" || body.action === "member-revoke") {
    if (!body.userId || !/^[0-9a-f-]{36}$/i.test(body.userId)) return fail("INVALID_USER_ID", 400);
    if (body.action === "member-role" && !["kasir", "bar", "purchasing", "manager", "admin"].includes(body.role || "")) return fail("INVALID_ROLE", 400);
    const patch = body.action === "member-revoke"
      ? { membership_status: "revoked" }
      : { web_role: body.role, membership_status: "active", permission: "staff" };
    const { error } = await db.from("store_users").update(patch)
      .eq("store_id", device.store_id).eq("user_id", body.userId);
    if (error) return fail("MEMBER_UPDATE_FAILED", 500, { detail: error.message });
    return json({ ok: true });
  }
  return fail("INVALID_ACTION", 400);
});