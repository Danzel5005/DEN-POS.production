import { createClient } from "jsr:@supabase/supabase-js@2";
import { handlePreflight, json, fail } from "../_shared/cors.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_STATUS: Record<string, number> = {
  DEVICE_NOT_APPROVED: 403,
  STORE_ACCESS_DENIED: 403,
  NO_ACTIVE_LOCATION: 409,
  ALREADY_CHECKED_IN: 409,
  ATTENDANCE_NOT_STARTED: 409,
  ATTENDANCE_OTHER_STORE: 409,
  OUTSIDE_GEOFENCE: 422,
  ACCURACY_TOO_LOW: 422,
  INVALID_LOCATION: 400,
  INVALID_REQUEST: 400,
  EMAIL_REQUIRED: 400,
  RATE_LIMITED: 429,
};

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return fail("METHOD_NOT_ALLOWED", 405);

  const authorization = req.headers.get("authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return fail("AUTH_REQUIRED", 401);

  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).length > 8192) return fail("BODY_TOO_LARGE", 413);

  let body: Record<string, unknown>;
  try { body = JSON.parse(rawBody || "{}"); }
  catch { return fail("INVALID_JSON", 400); }

  if (!UUID.test(String(body.storeId || ""))
    || !UUID.test(String(body.deviceId || ""))
    || !UUID.test(String(body.requestId || ""))
    || !["check_in", "check_out"].includes(String(body.type))
    || typeof body.latitude !== "number"
    || typeof body.longitude !== "number"
    || typeof body.accuracy !== "number") {
    return fail("INVALID_REQUEST", 400);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    console.error("[submit-attendance] Missing Supabase URL or anon key.");
    return fail("SERVER_CONFIGURATION_ERROR", 500);
  }

  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await client.auth.getUser(token);
  if (authError || !authData.user) return fail("AUTH_REQUIRED", 401);

  const { data, error } = await client.rpc("submit_attendance", {
    p_store_id: body.storeId,
    p_device_uuid: body.deviceId,
    p_type: body.type,
    p_latitude: body.latitude,
    p_longitude: body.longitude,
    p_accuracy_m: body.accuracy,
    p_request_id: body.requestId,
  });
  if (error) {
    console.error("[submit-attendance] Database request failed:", error.message);
    return fail("ATTENDANCE_SUBMIT_FAILED", 500);
  }
  if (!data?.ok) return json(data, ERROR_STATUS[data?.code] || 400);
  return json(data);
});
