import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migration = readFileSync(fileURLToPath(new URL("./migrations/0005_kds.sql", import.meta.url)), "utf8");

describe("KDS migration security contract", () => {
  it("limits ticket reads to authenticated store members and denies direct writes", () => {
    expect(migration).toMatch(/alter table kds_tickets enable row level security/i);
    expect(migration).toMatch(/for select to authenticated using \(can_access_store\(store_id\)\)/i);
    expect(migration).toMatch(/revoke all on kds_stations, kds_tickets from anon, authenticated/i);
    expect(migration).not.toMatch(/grant\s+(insert|update|delete|all)\s+on\s+kds_tickets\s+to\s+(anon|authenticated)/i);
  });

  it("keeps device writes idempotent and checks device activity and secret hash", () => {
    expect(migration).toMatch(/credential_hash = encode\(digest\(p_device_secret, 'sha256'\), 'hex'\)/i);
    expect(migration).toMatch(/d.status = 'active'/i);
    expect(migration).toMatch(/on conflict \(store_id, client_ticket_id\) do nothing/i);
    expect(migration).toMatch(/grant execute on function kds_create_ticket\(text, text, jsonb\) to service_role/i);
    expect(migration).not.toMatch(/grant execute on function kds_create_ticket\(text, text, jsonb\) to anon/i);
  });

  it("locks status updates and rejects transitions outside the one-step state machine", () => {
    expect(migration).toMatch(/where id = p_ticket_id for update/i);
    expect(migration).toMatch(/raise exception 'INVALID_STATUS_TRANSITION'/i);
    expect(migration).toMatch(/grant execute on function kds_set_status\(uuid, text\) to authenticated/i);
  });

  it("rate-limits writes, records status actors, and prunes terminal tickets", () => {
    expect(migration).toMatch(/received_at >= now\(\) - interval '1 minute'/i);
    expect(migration).toMatch(/status_changed_by = auth\.uid\(\)/i);
    expect(migration).toMatch(/kds_prune_tickets\(p_retention_days integer default 7\)/i);
    expect(migration).toMatch(/grant execute on function kds_prune_tickets\(integer\) to service_role/i);
  });
});