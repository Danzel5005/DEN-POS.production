import { handlePreflight, json, fail } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { verifySignedRequest } from "../_shared/verify.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return fail("METHOD_NOT_ALLOWED", 405);

  const rawBody = await req.text();
  let body: { payload?: unknown };
  try { body = JSON.parse(rawBody || "{}"); }
  catch { return fail("INVALID_JSON", 400); }

  const verified = await verifySignedRequest(req, rawBody);
  if (!verified.ok || !verified.device) return fail(verified.error || "UNAUTHORIZED", verified.status || 401);
  if (!verified.device.store_id || verified.device.status !== "active") return fail("DEVICE_NOT_PAIRED", 403);
  if (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) return fail("INVALID_PAYLOAD", 400);

  const { data, error } = await serviceClient().rpc("kds_create_ticket", {
    p_device_id: verified.device.device_id,
    p_device_secret: verified.device.credential_hash,
    p_payload: body.payload,
  });
  if (error) return fail(error.message || "KDS_TICKET_FAILED", 400);
  return json({ ok: true, ticketId: data });
});
