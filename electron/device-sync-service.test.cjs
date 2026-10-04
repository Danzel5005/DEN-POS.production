import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";

const require = createRequire(import.meta.url);
const { createDeviceIdentity } = require("./device-identity.cjs");
const { createDeviceSyncService } = require("./device-sync-service.cjs");
const { createDeviceSyncClient } = require("./device-sync-client.cjs");

// ---------------------------------------------------------------------------
// Device sync service — menyatukan identity + client + IPC. Client disuntik
// dengan fetch palsu supaya tes tidak menyentuh jaringan.
// ---------------------------------------------------------------------------

function makeFetch(responder) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const { status = 200, body = {} } = (typeof responder === "function" ? responder(url, init) : responder) || {};
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  };
  fn.calls = calls;
  return fn;
}

let dir;
let identity;
let fetchImpl;
let svc;

function build(responder, extra = {}) {
  fetchImpl = makeFetch(responder);
  identity = createDeviceIdentity({ secretPath: path.join(dir, ".pos_device") });
  const client = createDeviceSyncClient({ identity, fetchImpl });
  svc = createDeviceSyncService({ identity, client, configPath: path.join(dir, "device-sync.json"), ...extra });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-device-svc-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("device-sync-service: status & konfigurasi", () => {
  it("getStatus mengembalikan identitas publik tanpa secret", () => {
    build({});
    const s = svc.getStatus();
    expect(s.ok).toBe(true);
    expect(s.identity.deviceId).toMatch(/^dev_/);
    expect(s.identity).not.toHaveProperty("deviceSecret");
    expect(s.configured).toBe(false);
  });

  it("setBaseUrl menormalkan, persist ke file, & memengaruhi client", () => {
    build({});
    svc.setBaseUrl("https://cloud.denpos.id/");
    expect(svc.getBaseUrl()).toBe("https://cloud.denpos.id");
    const persisted = JSON.parse(fs.readFileSync(path.join(dir, "device-sync.json"), "utf8"));
    expect(persisted.baseUrl).toBe("https://cloud.denpos.id");
    expect(svc.getStatus().configured).toBe(true);
  });

  it("baseUrl tersimpan dimuat ulang oleh instance baru", () => {
    build({});
    svc.setBaseUrl("https://cloud.denpos.id");
    const reopened = createDeviceSyncService({
      identity,
      client: createDeviceSyncClient({ identity, fetchImpl }),
      configPath: path.join(dir, "device-sync.json"),
    });
    expect(reopened.getBaseUrl()).toBe("https://cloud.denpos.id");
  });

  it("getCredentialForPairing mengembalikan secret untuk alur pairing manual", () => {
    build({});
    const c = svc.getCredentialForPairing();
    expect(c.ok).toBe(true);
    expect(c.deviceSecret).toBe(identity.getSecret());
  });
});

describe("device-sync-service: register & pairing", () => {
  it("register tanpa baseUrl -> error", async () => {
    build({});
    const res = await svc.register();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/URL backend/i);
  });

  it("register sukses mengembalikan pairing code", async () => {
    build({ body: { deviceId: "dev_x", pairing_code: "XY99", expires_at: "2026-01-01T00:10:00Z" } });
    svc.setBaseUrl("https://cloud.denpos.id");
    const res = await svc.register();
    expect(res.ok).toBe(true);
    expect(res.pairingCode).toBe("XY99");
  });

  it("checkPairing paired=true menandai identitas terdaftar", async () => {
    build({ body: { paired: true, store_id: "store_7", store_name: "Toko A" } });
    svc.setBaseUrl("https://cloud.denpos.id");
    const res = await svc.checkPairing();
    expect(res.paired).toBe(true);
    expect(res.identity.registered).toBe(true);
    expect(res.identity.storeId).toBe("store_7");
  });

  it("checkPairing paired=false mencabut status terdaftar (revoke dari web)", async () => {
    build({ body: { paired: true, store_id: "store_7" } });
    svc.setBaseUrl("https://cloud.denpos.id");
    await svc.checkPairing();
    expect(identity.isRegistered()).toBe(true);

    build({ body: { paired: false } });
    svc.setBaseUrl("https://cloud.denpos.id");
    const res = await svc.checkPairing();
    expect(res.paired).toBe(false);
    expect(identity.isRegistered()).toBe(false);
  });
});

describe("device-sync-service: push", () => {
  it("push tanpa pairing -> ditolak", async () => {
    build({ body: {} });
    svc.setBaseUrl("https://cloud.denpos.id");
    const res = await svc.push({ rows: [{ id: 1 }] });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/belum dipasangkan/i);
  });

  it("push setelah pairing diteruskan ke client", async () => {
    build({ body: { accepted: 1 } });
    svc.setBaseUrl("https://cloud.denpos.id");
    identity.markRegistered("store_1");
    const res = await svc.push({ rows: [{ id: 1 }] });
    expect(res.ok).toBe(true);
    expect(res.accepted).toBe(1);
  });
});

describe("device-sync-service: KDS outbox", () => {
  it("persists offline tickets, deduplicates retries, then drains after reconnect", async () => {
    let attempt = 0;
    build(() => (++attempt === 1
      ? { status: 503, body: { error: "TEMPORARY_OUTAGE" } }
      : { body: { ok: true } }), { autoSyncIntervalMs: 0, stockSyncIntervalMs: 0 });
    svc.setBaseUrl("https://cloud.denpos.id/functions/v1");
    const ticket = { client_ticket_id: "dev:bill:1:station:order", source_ref: "bill-1" };

    const queued = await svc.kdsSend([ticket]);
    expect(queued).toMatchObject({ ok: true, pendingCount: 1 });
    expect(await svc.kdsSend([ticket])).toMatchObject({ ok: true, queued: 0, pendingCount: 1 });
    expect(JSON.parse(fs.readFileSync(path.join(dir, "device-sync.json"), "utf8")).kdsOutbox).toHaveLength(1);

    identity.markRegistered("store_1");
    expect(await svc.flushKdsOutbox()).toMatchObject({ ok: false, pendingCount: 1 });
    const retried = await svc.flushKdsOutbox();
    expect(retried).toMatchObject({ ok: true, pendingCount: 0 });
    expect(JSON.parse(fs.readFileSync(path.join(dir, "device-sync.json"), "utf8")).kdsOutbox).toEqual([]);
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it("queues cancellation commands while offline", async () => {
    build({}, { autoSyncIntervalMs: 0, stockSyncIntervalMs: 0 });
    const res = await svc.kdsCancel("bill-22");
    expect(res).toMatchObject({ ok: true, pendingCount: 1 });
    expect(JSON.parse(fs.readFileSync(path.join(dir, "device-sync.json"), "utf8")).kdsOutbox[0]).toMatchObject({ type: "cancel", sourceRef: "bill-22" });
  });

  it("returns after durable enqueue without waiting for the cloud request", async () => {
    let finishRequest;
    build({}, {
      autoSyncIntervalMs: 0,
      stockSyncIntervalMs: 0,
      client: {
        sendKdsTicket: () => new Promise((resolve) => { finishRequest = resolve; }),
        cancelKdsTickets: async () => ({ ok: true }),
      },
    });
    svc.setBaseUrl("https://cloud.denpos.id/functions/v1");
    identity.markRegistered("store_1");

    const queued = await svc.kdsSend([{ client_ticket_id: "ticket-nonblocking" }]);
    expect(queued).toMatchObject({ ok: true, pendingCount: 1 });
    expect(finishRequest).toBeTypeOf("function");
    finishRequest({ ok: true });
    await svc.flushKdsOutbox();
    expect(svc.getKdsStatus().pendingCount).toBe(0);
  });
});

describe("device-sync-service: stock exchange", () => {
  it("mengirim full pertama, hanya delta berikutnya, dan membersihkan ack setelah sukses", async () => {
    let rows = [{ id: "m1", type: "menu", name: "Kopi", stock: 4 }];
    build({ body: { needFull: false, pending: [] } }, {
      autoSyncIntervalMs: 0,
      stockSyncIntervalMs: 0,
      stockSnapshotProvider: () => ({ rows, features: { ingredientsEnabled: false } }),
    });
    svc.setBaseUrl("https://cloud.denpos.id");
    identity.markRegistered("store_1");

    expect((await svc.exchangeStock()).ok).toBe(true);
    expect(JSON.parse(fetchImpl.calls[0].init.body)).toMatchObject({ mode: "full", rows });

    rows = [{ ...rows[0], stock: 5 }];
    expect((await svc.exchangeStock()).ok).toBe(true);
    expect(JSON.parse(fetchImpl.calls[1].init.body)).toMatchObject({ mode: "delta", rows });

    expect((await svc.queueRestockAck({ eventId: "evt-1", status: "applied", stockAfter: 6 })).ok).toBe(true);
    const config = JSON.parse(fs.readFileSync(path.join(dir, "device-sync.json"), "utf8"));
    expect(JSON.parse(fetchImpl.calls[2].init.body).ack).toEqual([{ eventId: "evt-1", status: "applied", stockAfter: 6 }]);
    expect(config.stockAcks).toEqual([]);
  });

  it("mengembalikan hasil cloud claim untuk satu event sebelum POS menerapkan restock", async () => {
    build((_url, init) => ({ body: { pending: [], claimedEventIds: JSON.parse(init.body).claim } }), {
      autoSyncIntervalMs: 0,
      stockSyncIntervalMs: 0,
      stockSnapshotProvider: () => ({ rows: [], features: {} }),
    });
    svc.setBaseUrl("https://cloud.denpos.id");
    identity.markRegistered("store_1");

    await expect(svc.claimRestock("evt-claim")).resolves.toEqual({ ok: true, claimed: true });
    expect(JSON.parse(fetchImpl.calls[0].init.body).claim).toEqual(["evt-claim"]);
  });

  it("mengirim item menu dan bahan baku dalam snapshot yang sama saat fitur bahan aktif", async () => {
    const rows = [
      { id: "m1", type: "menu", name: "Kopi", stock: 4, unit: "pcs" },
      { id: "b1", type: "ingredient", name: "Beras", stock: 1200, unit: "gram" },
    ];
    build({ body: { needFull: false, pending: [] } }, {
      autoSyncIntervalMs: 0,
      stockSyncIntervalMs: 0,
      stockSnapshotProvider: () => ({ rows, features: { ingredientsEnabled: true } }),
    });
    svc.setBaseUrl("https://cloud.denpos.id");
    identity.markRegistered("store_1");

    expect((await svc.exchangeStock()).ok).toBe(true);
    const sent = JSON.parse(fetchImpl.calls[0].init.body);
    expect(sent.features.ingredientsEnabled).toBe(true);
    expect(sent.rows.map((row) => row.type)).toEqual(["menu", "ingredient"]);
    expect(sent.rows[1]).toMatchObject({ id: "b1", name: "Beras", stock: 1200, unit: "gram" });
  });
});

describe("device-sync-service: rotate & nama", () => {
  it("rotateCredential mengubah deviceId dan menghapus pairing", () => {
    build({});
    identity.markRegistered("store_1");
    const before = svc.getIdentity().deviceId;
    const res = svc.rotateCredential();
    expect(res.ok).toBe(true);
    expect(svc.getIdentity().deviceId).not.toBe(before);
    expect(svc.getIdentity().registered).toBe(false);
  });

  it("setDeviceName memperbarui identitas publik", () => {
    build({});
    svc.setDeviceName("Kasir Lantai 2");
    expect(svc.getIdentity().deviceName).toBe("Kasir Lantai 2");
  });
});

describe("device-sync-service: IPC handlers", () => {
  it("mendaftarkan seluruh channel device-*", () => {
    build({});
    const registered = new Map();
    const ipcMain = { handle: (ch, fn) => registered.set(ch, fn) };
    svc.registerHandlers(ipcMain);
    for (const ch of [
      "device-identity",
      "device-status",
      "device-set-base-url",
      "device-register",
      "device-check-pairing",
      "device-push-sync",
      "device-push-transactions",
      "device-pending-count",
      "kds-send",
      "kds-cancel",
      "kds-status",
      "kds-retry",
      "device-credential",
      "device-rotate-credential",
      "device-set-name",
    ]) {
      expect(registered.has(ch), `channel ${ch} terdaftar`).toBe(true);
    }
  });

  it("ipcMain tidak valid -> throw", () => {
    build({});
    expect(() => svc.registerHandlers(null)).toThrow();
  });

  it("handler device-status mengembalikan identitas publik", () => {
    build({});
    const registered = new Map();
    svc.registerHandlers({ handle: (ch, fn) => registered.set(ch, fn) });
    const out = registered.get("device-status")();
    expect(out.identity.deviceId).toMatch(/^dev_/);
    expect(out.identity).not.toHaveProperty("deviceSecret");
  });
});

describe("device-sync-service: kirim transaksi (pending)", () => {
  function withPending(rows, extra = {}) {
    const marked = [];
    build({ body: { accepted: rows.length } }, {
      pendingCountProvider: () => rows.length,
      pendingListProvider: () => rows,
      markSynced: (ids, at) => { marked.push({ ids, at }); return { ok: true, updated: ids.length }; },
      ...extra,
    });
    return marked;
  }

  it("getStatus menyertakan pendingCount", () => {
    withPending([{ id: "a" }, { id: "b" }]);
    expect(svc.getStatus().pendingCount).toBe(2);
  });

  it("pushTransactions tanpa pairing -> ditolak", async () => {
    withPending([{ id: "a" }]);
    svc.setBaseUrl("https://cloud.denpos.id");
    const res = await svc.pushTransactions();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/belum dipasangkan/i);
  });

  it("pushTransactions tanpa data -> sukses tanpa fetch", async () => {
    withPending([]);
    svc.setBaseUrl("https://cloud.denpos.id");
    identity.markRegistered("store_1");
    const res = await svc.pushTransactions();
    expect(res).toMatchObject({ ok: true, sent: 0 });
    expect(fetchImpl.calls.length).toBe(0);
  });

  it("pushTransactions mengirim & menandai terkirim", async () => {
    const marked = withPending([{ id: "t1" }, { id: "t2" }]);
    svc.setBaseUrl("https://cloud.denpos.id");
    identity.markRegistered("store_1");
    const res = await svc.pushTransactions();
    expect(res).toMatchObject({ ok: true, sent: 2 });
    expect(marked.length).toBe(1);
    expect(marked[0].ids).toEqual(["t1", "t2"]);
    expect(marked[0].at).toBeTruthy();
  });

  it("gagal kirim -> TIDAK menandai terkirim", async () => {
    const marked = withPending([{ id: "t1" }]);
    // ganti fetch jadi gagal
    fetchImpl = null;
    svc.setBaseUrl("https://cloud.denpos.id");
    identity.markRegistered("store_1");
    // client sudah dibuat dengan fetchImpl lama; buat ulang service dengan fetch gagal
    build(() => ({ status: 500, body: { error: "SERVER_ERROR" } }), {
      pendingCountProvider: () => 1,
      pendingListProvider: () => [{ id: "t1" }],
      markSynced: (ids) => { marked.push({ ids }); return { ok: true, updated: ids.length }; },
    });
    svc.setBaseUrl("https://cloud.denpos.id");
    identity.markRegistered("store_1");
    const res = await svc.pushTransactions();
    expect(res.ok).toBe(false);
    expect(marked.length).toBe(0);
  });
});

describe("device-sync-service: auto-sync 5 menit", () => {
  it("tidak jalan saat belum paired", () => {
    build({}, { autoSyncIntervalMs: 60_000 });
    expect(svc.isAutoSyncRunning()).toBe(false);
    svc.syncAutoSyncState();
    expect(svc.isAutoSyncRunning()).toBe(false);
    svc.stopAutoSync();
  });

  it("mulai saat paired + URL diatur", () => {
    build({}, { autoSyncIntervalMs: 60_000, pendingCountProvider: () => 0 });
    svc.setBaseUrl("https://cloud.denpos.id");
    identity.markRegistered("store_1");
    svc.syncAutoSyncState();
    expect(svc.isAutoSyncRunning()).toBe(true);
    svc.stopAutoSync();
    expect(svc.isAutoSyncRunning()).toBe(false);
  });

  it("berhenti saat pairing dicabut", () => {
    build({}, { autoSyncIntervalMs: 60_000 });
    svc.setBaseUrl("https://cloud.denpos.id");
    identity.markRegistered("store_1");
    svc.syncAutoSyncState();
    expect(svc.isAutoSyncRunning()).toBe(true);
    identity.clearRegistration();
    svc.syncAutoSyncState();
    expect(svc.isAutoSyncRunning()).toBe(false);
  });

  it("autoSyncIntervalMs=0 menonaktifkan timer (untuk tes)", () => {
    build({}, { autoSyncIntervalMs: 0 });
    svc.setBaseUrl("https://cloud.denpos.id");
    identity.markRegistered("store_1");
    svc.syncAutoSyncState();
    expect(svc.isAutoSyncRunning()).toBe(false);
  });
});

describe("device-sync-service: auto-sync tick (fake timers)", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("tiap 5 menit mengirim transaksi tertunda & menandainya", async () => {
    const marked = [];
    const notify = [];
    const rows = [{ id: "t1" }, { id: "t2" }];
    build({ body: { accepted: 2 } }, {
      autoSyncIntervalMs: 5 * 60 * 1000,
      pendingCountProvider: () => rows.length,
      pendingListProvider: () => rows,
      markSynced: (ids, at) => { marked.push({ ids, at }); return { ok: true, updated: ids.length }; },
      notify: (p) => notify.push(p),
    });
    svc.setBaseUrl("https://cloud.denpos.id");
    identity.markRegistered("store_1");

    vi.useFakeTimers();
    svc.syncAutoSyncState();
    expect(svc.isAutoSyncRunning()).toBe(true);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(fetchImpl.calls.length).toBe(1);
    expect(marked[0].ids).toEqual(["t1", "t2"]);
    expect(notify.some((p) => p.kind === "sync-ok")).toBe(true);
    svc.stopAutoSync();
  });

  it("gagal kirim -> emit peringatan 'sync-failed' tiap tick", async () => {
    const notify = [];
    build(() => ({ status: 500, body: { error: "SERVER_ERROR" } }), {
      autoSyncIntervalMs: 5 * 60 * 1000,
      pendingCountProvider: () => 1,
      pendingListProvider: () => [{ id: "t1" }],
      markSynced: () => ({ ok: true, updated: 0 }),
      notify: (p) => notify.push(p),
    });
    svc.setBaseUrl("https://cloud.denpos.id");
    identity.markRegistered("store_1");

    vi.useFakeTimers();
    svc.syncAutoSyncState();

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    const failures = notify.filter((p) => p.kind === "sync-failed");
    expect(failures.length).toBe(2); // sekali per tick yang gagal
    expect(failures[0].title).toMatch(/gagal/i);
    expect(failures[0].message).toMatch(/SERVER_ERROR/);
    svc.stopAutoSync();
  });

  it("offline (fetch throw) -> peringatan dengan penanda koneksi", async () => {
    const notify = [];
    const failing = async () => { throw new Error("ECONNREFUSED"); };
    build({}, {
      autoSyncIntervalMs: 5 * 60 * 1000,
      pendingCountProvider: () => 1,
      pendingListProvider: () => [{ id: "t1" }],
      markSynced: () => ({ ok: true, updated: 0 }),
      notify: (p) => notify.push(p),
    });
    // ganti client ke fetch yang throw
    svc = createDeviceSyncService({
      identity,
      client: createDeviceSyncClient({ identity, fetchImpl: failing }),
      configPath: path.join(dir, "device-sync.json"),
      autoSyncIntervalMs: 5 * 60 * 1000,
      pendingCountProvider: () => 1,
      pendingListProvider: () => [{ id: "t1" }],
      markSynced: () => ({ ok: true, updated: 0 }),
      notify: (p) => notify.push(p),
    });
    svc.setBaseUrl("https://cloud.denpos.id");
    identity.markRegistered("store_1");

    vi.useFakeTimers();
    svc.syncAutoSyncState();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    const failures = notify.filter((p) => p.kind === "sync-failed");
    expect(failures.length).toBe(1);
    expect(failures[0].detail).toMatch(/koneksi/i);
    svc.stopAutoSync();
  });

  it("tidak memanggil jaringan saat tidak ada data tertunda", async () => {
    build({}, {
      autoSyncIntervalMs: 5 * 60 * 1000,
      pendingCountProvider: () => 0,
      pendingListProvider: () => [],
      notify: () => {},
    });
    svc.setBaseUrl("https://cloud.denpos.id");
    identity.markRegistered("store_1");

    vi.useFakeTimers();
    svc.syncAutoSyncState();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(fetchImpl.calls.length).toBe(0);
    svc.stopAutoSync();
  });
});
