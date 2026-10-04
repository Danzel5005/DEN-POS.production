const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ── Device sync service (IPC bridge) ────────────────────────────────────────
//
// Menyatukan `device-identity` (kredensial lokal) + `device-sync-client`
// (koneksi cloud) menjadi satu API IPC untuk renderer.
//
// PENTING: secret device TIDAK pernah dikirim mentah ke renderer kecuali
// diminta eksplisit lewat `device-credential` (alur pairing manual). Semua
// operasi jaringan berjalan di main process.

const DEFAULT_AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 menit (PLAN: otomatis)

function createDeviceSyncService({
  app,
  identity,
  client,
  configPath,
  fetchImpl,
  // Hook data transaksi (disuntik dari main.cjs → db.cjs). Semua opsional;
  // kalau tidak ada, fitur kirim data dinonaktifkan dengan aman.
  pendingCountProvider = () => 0,
  pendingListProvider = () => [],
  markSynced = () => ({ ok: true, updated: 0 }),
  // Notifikasi ke renderer (disuntik dari main.cjs; default no-op).
  notify = () => {},
  autoSyncIntervalMs = DEFAULT_AUTO_SYNC_INTERVAL_MS,
  stockSnapshotProvider = null,
  applyMenuRestockProvider = () => ({ ok: false, error: "Database belum siap" }),
  claimIngredientRestockProvider = () => ({ ok: false, error: "Database belum siap" }),
  completeIngredientRestockProvider = () => ({ ok: false, error: "Database belum siap" }),
  stockSyncIntervalMs = 60 * 1000,
} = {}) {
  if (!identity) throw new Error("createDeviceSyncService: identity wajib diisi");

  const resolveConfigPath = () =>
    configPath ||
    (app && typeof app.getPath === "function"
      ? path.join(app.getPath("userData"), "device-sync.json")
      : path.join(require("os").tmpdir(), "device-sync.json"));

  function readConfig() {
    try {
      return JSON.parse(fs.readFileSync(resolveConfigPath(), "utf8")) || {};
    } catch {
      return {};
    }
  }

  function writeConfig(patch) {
    const next = { ...readConfig(), ...patch };
    const file = resolveConfigPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
    fs.renameSync(tmp, file);
    return next;
  }

  const stockStatePath = () => `${resolveConfigPath()}.stock-state.json`;
  function readStockState() {
    try { return JSON.parse(fs.readFileSync(stockStatePath(), "utf8")) || {}; }
    catch { return {}; }
  }
  function writeStockState(value) {
    const file = stockStatePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(value), "utf8");
    fs.renameSync(`${file}.tmp`, file);
  }

  // Client bisa disuntik (tes) atau dibangun lazy dari config tersimpan.
  let sync = client || null;
  let baseUrl = readConfig().baseUrl || "";
  if (sync && baseUrl) sync.setBaseUrl?.(baseUrl);

  function ensureClient() {
    if (sync) return sync;
    const { createDeviceSyncClient } = require("./device-sync-client.cjs");
    sync = createDeviceSyncClient({ identity, baseUrl, fetchImpl });
    return sync;
  }

  function getBaseUrl() {
    return baseUrl || readConfig().baseUrl || "";
  }

  function setBaseUrl(url) {
    baseUrl = typeof url === "string" ? url.trim().replace(/\/+$/, "") : "";
    writeConfig({ baseUrl });
    if (sync) sync.setBaseUrl?.(baseUrl);
    return { ok: true, baseUrl };
  }

  /** Status lengkap untuk UI: identitas publik + URL + status pairing lokal. */
  function getStatus() {
    return {
      ok: true,
      identity: identity.getPublicIdentity(),
      baseUrl: getBaseUrl(),
      configured: Boolean(getBaseUrl()),
      pendingCount: getPendingCount(),
      kdsPendingCount: getKdsStatus().pendingCount,
      autoSync: isAutoSyncRunning(),
    };
  }

  /** Identitas aman untuk ditampilkan (tanpa secret). */
  function getIdentity() {
    return identity.getPublicIdentity();
  }

  /**
   * Kredensial untuk alur pairing manual. Mengembalikan secret karena user
   * memang butuh menyalin/memindainya — jangan pakai untuk polling rutin.
   */
  function getCredentialForPairing() {
    const cred = identity.getCredential();
    return { ok: true, deviceId: cred.deviceId, deviceSecret: cred.deviceSecret, deviceName: cred.deviceName };
  }

  async function register(opts = {}) {
    const c = ensureClient();
    const target = opts.baseUrl ? setBaseUrl(opts.baseUrl).baseUrl : getBaseUrl();
    if (!target) return { ok: false, error: "URL backend belum diatur" };
    const res = await c.register({ deviceName: opts.deviceName || identity.getDeviceName() });
    if (res.ok && res.storeId) identity.markRegistered(res.storeId);
    syncAutoSyncState();
    return res;
  }

  async function checkPairing(opts = {}) {
    const c = ensureClient();
    if (!getBaseUrl()) return { ok: false, error: "URL backend belum diatur" };
    const res = await c.getStatus(opts);
    if (res.ok) {
      if (res.paired && res.storeId) {
        if (!identity.isRegistered()) identity.markRegistered(res.storeId);
      } else if (!res.paired && identity.isRegistered()) {
        // Backend bilang belum paired -> sinkronkan status lokal (mis. di-revoke).
        identity.clearRegistration();
      }
    }
    syncAutoSyncState();
    if (res.paired) void flushKdsOutbox().catch(() => {});
    return { ...res, identity: identity.getPublicIdentity() };
  }

  async function push(batch = {}) {
    const c = ensureClient();
    if (!getBaseUrl()) return { ok: false, error: "URL backend belum diatur" };
    if (!identity.isRegistered()) return { ok: false, error: "Perangkat belum dipasangkan" };
    return c.push(batch);
  }

  function getKdsStatus() {
    const config = readConfig();
    const outbox = Array.isArray(config.kdsOutbox) ? config.kdsOutbox : [];
    const lastError = config.kdsLastError || null;
    return { pendingCount: outbox.length, error: lastError?.message || null, offline: Boolean(lastError?.offline) };
  }

  let kdsFlushInFlight = null;
  let kdsRetryTimer = null;
  let kdsRetryAttempt = 0;
  function scheduleKdsRetry() {
    if (kdsRetryTimer || !identity.isRegistered() || !getBaseUrl()) return;
    const delay = Math.min(15000 * (2 ** kdsRetryAttempt), 5 * 60 * 1000);
    kdsRetryAttempt += 1;
    kdsRetryTimer = setTimeout(() => {
      kdsRetryTimer = null;
      void flushKdsOutbox().catch(() => {});
    }, delay);
    kdsRetryTimer.unref?.();
  }
  function stopKdsRetry() {
    if (kdsRetryTimer) clearTimeout(kdsRetryTimer);
    kdsRetryTimer = null;
    kdsRetryAttempt = 0;
  }

  async function flushKdsOutbox() {
    if (kdsFlushInFlight) return kdsFlushInFlight;
    const work = (async () => {
      if (!identity.isRegistered() || !getBaseUrl()) return { ok: false, ...getKdsStatus(), error: "Perangkat KDS belum dipasangkan" };
      while (true) {
        const entry = (readConfig().kdsOutbox || [])[0];
        if (!entry) {
          stopKdsRetry();
          writeConfig({ kdsOutbox: [], kdsLastError: null });
          return { ok: true, pendingCount: 0 };
        }
        let result;
        try {
          result = entry.type === "cancel"
            ? await ensureClient().cancelKdsTickets(entry.sourceRef)
            : await ensureClient().sendKdsTicket(entry.ticket);
        } catch (err) {
          result = { ok: false, error: err?.message || "Gagal mengirim tiket KDS", offline: true };
        }
        if (!result?.ok) {
          const message = result?.error || "Gagal mengirim tiket KDS";
          writeConfig({ kdsLastError: { message, offline: Boolean(result?.offline), at: new Date().toISOString() } });
          const status = getKdsStatus();
          notify({ kind: "kds-sync", ...status });
          scheduleKdsRetry();
          return { ok: false, ...status, error: message };
        }
        const remaining = (readConfig().kdsOutbox || []).filter((queued) => queued.id !== entry.id);
        writeConfig({ kdsOutbox: remaining, kdsLastError: null });
      }
    })();
    kdsFlushInFlight = work;
    try { return await work; }
    finally { kdsFlushInFlight = null; }
  }

  async function kdsSend(tickets) {
    const rows = Array.isArray(tickets) ? tickets.slice(0, 100) : [];
    if (!rows.length || rows.some((ticket) => !ticket?.client_ticket_id || JSON.stringify(ticket).length > 100000)) {
      return { ok: false, ...getKdsStatus(), error: "Ticket KDS tidak valid" };
    }
    const config = readConfig();
    const outbox = Array.isArray(config.kdsOutbox) ? config.kdsOutbox : [];
    const known = new Set(outbox.filter((entry) => entry.type === "ticket").map((entry) => entry.ticket?.client_ticket_id));
    const additions = rows.filter((ticket) => !known.has(ticket.client_ticket_id)).map((ticket) => ({
      id: `ticket:${ticket.client_ticket_id}`,
      type: "ticket",
      ticket,
      createdAt: new Date().toISOString(),
    }));
    if (outbox.length + additions.length > 2000) return { ok: false, ...getKdsStatus(), error: "Antrean KDS penuh; sambungkan internet sebelum menambah tiket." };
    writeConfig({ kdsOutbox: [...outbox, ...additions] });
    if (identity.isRegistered() && getBaseUrl()) void flushKdsOutbox().catch(() => {});
    const status = getKdsStatus();
    notify({ kind: "kds-sync", ...status });
    return { ok: true, queued: additions.length, ...status };
  }

  async function kdsCancel(sourceRef) {
    const ref = String(sourceRef || "").trim();
    if (!ref || ref.length > 240) return { ok: false, ...getKdsStatus(), error: "Referensi pesanan tidak valid" };
    const config = readConfig();
    const outbox = Array.isArray(config.kdsOutbox) ? config.kdsOutbox : [];
    const entry = { id: `cancel:${crypto.randomUUID()}`, type: "cancel", sourceRef: ref, createdAt: new Date().toISOString() };
    if (outbox.length >= 2000) return { ok: false, ...getKdsStatus(), error: "Antrean KDS penuh; sambungkan internet sebelum membatalkan pesanan." };
    writeConfig({ kdsOutbox: [...outbox, entry] });
    if (identity.isRegistered() && getBaseUrl()) void flushKdsOutbox().catch(() => {});
    const status = getKdsStatus();
    notify({ kind: "kds-sync", ...status });
    return { ok: true, queued: 1, ...status };
  }

  function rotateCredential() {
    // WAJIB dipasangkan ulang setelah rotate (deviceId berubah).
    const id = identity.rotate();
    return { ok: true, identity: identity.getPublicIdentity(), deviceId: id.deviceId };
  }

  function setDeviceName(name) {
    identity.setName(name);
    return { ok: true, identity: identity.getPublicIdentity() };
  }

  // ── Data transaksi (unsynced) ─────────────────────────────────────────────
  function getPendingCount() {
    try { return Number(pendingCountProvider()) || 0; } catch { return 0; }
  }

  /**
   * Kirim satu batch transaksi yang belum tersinkron, lalu tandai terkirim.
   * Dipakai manual ("Kirim Sekarang") maupun oleh timer 5 menit.
   * Return: { ok, sent, accepted, duplicates, error?, offline? }
   */
  async function pushTransactions() {
    if (!getBaseUrl()) return { ok: false, error: "URL backend belum diatur" };
    if (!identity.isRegistered()) return { ok: false, error: "Perangkat belum dipasangkan" };
    const rows = pendingListProvider() || [];
    if (!rows.length) return { ok: true, sent: 0, accepted: 0, duplicates: 0 };

    const res = await push({ kind: "transactions", rows });
    if (!res.ok) return { ...res, sent: 0, accepted: 0, duplicates: 0 };

    // Tandai terkirim hanya jika backend menerima (accepted > 0 atau sukses).
    // Duplikat (sudah ada di backend) tetap ditandai agar tidak dikirim ulang.
    const ids = rows.map((r) => r.id).filter((id) => id !== undefined && id !== null);
    const mark = markSynced(ids, new Date().toISOString());
    return {
      ok: true,
      sent: rows.length,
      accepted: res.accepted ?? rows.length,
      duplicates: res.duplicates ?? 0,
      marked: mark?.updated ?? ids.length,
    };
  }

  let stockTimer = null;
  let stockExchangeInFlight = null;

  async function exchangeStock(options = {}) {
    if (!getBaseUrl()) return { ok: false, error: "URL backend belum diatur" };
    if (!identity.isRegistered()) return { ok: false, error: "Perangkat belum dipasangkan" };
    if (stockExchangeInFlight) {
      if (options.claim?.length || readConfig().stockAcks?.length) {
        await stockExchangeInFlight;
        return exchangeStock(options);
      }
      return { ok: true, skipped: true };
    }
    stockExchangeInFlight = performStockExchange(options);
    try { return await stockExchangeInFlight; }
    finally { stockExchangeInFlight = null; }
  }

  async function performStockExchange({ claim = [] } = {}) {
    try {
      const snapshot = typeof stockSnapshotProvider === "function" ? stockSnapshotProvider() || {} : {};
      const allRows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
      const previous = readStockState();
      const current = Object.fromEntries(allRows.map((row) => [`${row.type}:${row.id}`, row]));
      const full = previous.forceFull || !previous.rows;
      const rows = full ? allRows : allRows.filter((row) => JSON.stringify(previous.rows[`${row.type}:${row.id}`]) !== JSON.stringify(row));
      const deletedIds = !previous.rows ? [] : Object.keys(previous.rows).filter((key) => !current[key]).map((key) => {
        const split = key.indexOf(":");
        return { type: key.slice(0, split), id: key.slice(split + 1) };
      });
      const pendingAcks = readConfig().stockAcks || [];
      const result = await ensureClient().stockExchange({
        mode: full ? "full" : "delta",
        features: snapshot.features || {},
        rows,
        deletedIds,
        ack: pendingAcks,
        claim,
      });
      if (!result.ok) return result;

      const acked = new Set(pendingAcks.map((ack) => ack.eventId));
      writeConfig({ stockAcks: (readConfig().stockAcks || []).filter((ack) => !acked.has(ack.eventId)) });
      writeStockState({ rows: current, forceFull: result.needFull === true });
      const events = Array.isArray(result.pending) ? result.pending : [];
      if (events.length) notify({ kind: "restock-incoming", events });
      return { ok: true, needFull: result.needFull === true, pending: events, claimedEventIds: result.claimedEventIds || [] };
    } catch (err) {
      return { ok: false, error: err?.message || "Sinkronisasi stok gagal", offline: true };
    }
  }

  function queueRestockAck(ack) {
    if (!ack?.eventId || !["applied", "rejected"].includes(ack.status)) return { ok: false, error: "Ack tidak valid" };
    const existing = readConfig().stockAcks || [];
    writeConfig({ stockAcks: [...existing.filter((item) => item.eventId !== ack.eventId), ack] });
    return exchangeStock();
  }

  async function claimRestock(eventId) {
    if (!eventId) return { ok: false, error: "Event tidak valid" };
    const result = await exchangeStock({ claim: [String(eventId)] });
    if (!result.ok) return result;
    const claimed = (result.claimedEventIds || []).includes(String(eventId));
    return { ok: true, claimed };
  }

  // ── Auto-sync tiap 5 menit (hanya jika sudah dipasangkan) ─────────────────
  // Tidak ada timer yang jalan saat belum paired → hemat & tidak spam notifikasi.
  let autoTimer = null;

  function maybeStartAutoSync() {
    if (autoTimer || !autoSyncIntervalMs || autoSyncIntervalMs <= 0) return false;
    if (!identity.isRegistered() || !getBaseUrl()) return false;
    autoTimer = setInterval(async () => {
      // Re-cek kondisi tiap tick: pairing bisa dicabut kapan saja.
      if (!identity.isRegistered() || !getBaseUrl()) { stopAutoSync(); return; }
      await flushKdsOutbox();
      if (getPendingCount() <= 0) return; // tidak ada yang perlu dikirim

      const res = await pushTransactions();
      if (!res.ok) {
        // Peringatan setiap gagal kirim (PLAN: "warning every time it failed").
        notify({
          kind: "sync-failed",
          title: "Sinkronisasi cloud gagal",
          message: res.error || "Gagal mengirim data ke cloud",
          detail: res.offline ? "Tidak ada koneksi ke server." : "",
          at: new Date().toISOString(),
        });
      } else if (res.sent > 0) {
        notify({ kind: "sync-ok", message: `${res.sent} transaksi terkirim`, at: new Date().toISOString() });
      }
    }, autoSyncIntervalMs);
    if (typeof autoTimer.unref === "function") autoTimer.unref?.();
    return true;
  }

  function stopAutoSync() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    stopKdsRetry();
  }

  function maybeStartStockSync() {
    if (typeof stockSnapshotProvider !== "function") return false;
    if (stockTimer || !stockSyncIntervalMs || stockSyncIntervalMs <= 0) return false;
    if (!identity.isRegistered() || !getBaseUrl()) return false;
    stockTimer = setInterval(async () => {
      if (!identity.isRegistered() || !getBaseUrl()) { stopStockSync(); return; }
      try {
        const result = await exchangeStock();
        if (!result.ok) notify({ kind: "stock-sync-failed", message: result.error || "Sinkronisasi stok gagal" });
      } catch (err) {
        notify({ kind: "stock-sync-failed", message: err?.message || "Sinkronisasi stok gagal" });
      }
    }, stockSyncIntervalMs);
    stockTimer.unref?.();
    exchangeStock().then((result) => {
      if (!result.ok) notify({ kind: "stock-sync-failed", message: result.error || "Sinkronisasi stok gagal" });
    }).catch((err) => notify({ kind: "stock-sync-failed", message: err?.message || "Sinkronisasi stok gagal" }));
    return true;
  }

  function stopStockSync() {
    if (stockTimer) { clearInterval(stockTimer); stockTimer = null; }
  }

  /** Dipanggil service saat status pairing berubah (paired → start, else stop). */
  function syncAutoSyncState() {
    if (identity.isRegistered() && getBaseUrl()) { maybeStartAutoSync(); maybeStartStockSync(); }
    else { stopAutoSync(); stopStockSync(); }
    return isAutoSyncRunning();
  }

  function isAutoSyncRunning() {
    return Boolean(autoTimer);
  }

  /**
   * Daftarkan semua handler IPC. Channel sengaja diberi prefix `device-`.
   * Return objek untuk keperluan tes / shutdown.
   */
  function registerHandlers(ipcMain) {
    if (!ipcMain || typeof ipcMain.handle !== "function") {
      throw new Error("registerHandlers: ipcMain tidak valid");
    }
    ipcMain.handle("device-identity", () => getIdentity());
    ipcMain.handle("device-status", () => getStatus());
    ipcMain.handle("device-set-base-url", (_e, url) => setBaseUrl(url));
    ipcMain.handle("device-register", (_e, opts) => register(opts || {}));
    ipcMain.handle("device-check-pairing", (_e, opts) => checkPairing(opts || {}));
    ipcMain.handle("device-push-sync", (_e, batch) => push(batch || {}));
    ipcMain.handle("device-push-transactions", () => pushTransactions());
    ipcMain.handle("device-stock-exchange", () => exchangeStock());
    ipcMain.handle("device-restock-ack", (_e, ack) => queueRestockAck(ack));
    ipcMain.handle("device-claim-restock", (_e, eventId) => claimRestock(eventId));
    ipcMain.handle("device-apply-menu-restock", (_e, event) => applyMenuRestockProvider(event));
    ipcMain.handle("device-claim-ingredient-restock", (_e, event) => claimIngredientRestockProvider(event));
    ipcMain.handle("device-complete-ingredient-restock", (_e, eventId) => completeIngredientRestockProvider(eventId));
    ipcMain.handle("device-pending-count", () => getPendingCount());
    ipcMain.handle("kds-send", (_e, tickets) => kdsSend(tickets));
    ipcMain.handle("kds-cancel", (_e, sourceRef) => kdsCancel(sourceRef));
    ipcMain.handle("kds-status", () => getKdsStatus());
    ipcMain.handle("kds-retry", () => flushKdsOutbox());
    ipcMain.handle("device-credential", () => getCredentialForPairing());
    ipcMain.handle("device-rotate-credential", () => rotateCredential());
    ipcMain.handle("device-set-name", (_e, name) => setDeviceName(name));
    syncAutoSyncState();
    return { getStatus, getIdentity, register, checkPairing, push, pushTransactions, exchangeStock, kdsSend, kdsCancel, getKdsStatus, flushKdsOutbox, startAutoSync: maybeStartAutoSync, stopAutoSync, stopStockSync };
  }

  return {
    getStatus,
    getIdentity,
    getCredentialForPairing,
    getBaseUrl,
    setBaseUrl,
    register,
    checkPairing,
    push,
    pushTransactions,
    exchangeStock,
    queueRestockAck,
    claimRestock,
    applyMenuRestock: applyMenuRestockProvider,
    claimIngredientRestock: claimIngredientRestockProvider,
    completeIngredientRestock: completeIngredientRestockProvider,
    getPendingCount,
    kdsSend,
    kdsCancel,
    getKdsStatus,
    flushKdsOutbox,
    rotateCredential,
    setDeviceName,
    maybeStartAutoSync,
    stopAutoSync,
    maybeStartStockSync,
    stopStockSync,
    syncAutoSyncState,
    isAutoSyncRunning,
    registerHandlers,
  };
}

module.exports = { createDeviceSyncService };
