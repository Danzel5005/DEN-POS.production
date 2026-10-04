const crypto = require("crypto");

// ── Device sync client (PLAN-WEBSYNC) ───────────────────────────────────────
//
// Klien tipis untuk cloud backend. Tanggung jawabnya:
//   1. register    — daftarkan device, terima pairing code + QR dari backend.
//   2. status      — cek apakah device sudah dipasangkan (paired) & ambil store_id.
//   3. push        — kirim data sync dengan kredensial device (HMAC-signed).
//
// Semua request ber-signature memakai header sesuai plan:
//   X-Device-ID, X-Device-Timestamp, X-Device-Nonce, X-Device-Signature
// Signature = HMAC-SHA256(device_secret, `${timestamp}.${nonce}.${rawBody}`)
// sehingga body, waktu, dan nonce ikut terikat (tahan replay & tamper).
//
// Modul ini TIDAK tahu soal Electron; `fetchImpl` disuntik agar mudah dites.

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_SYNC_ROWS = 2000;

function normalizeBaseUrl(baseUrl) {
  const trimmed = typeof baseUrl === "string" ? baseUrl.trim().replace(/\/+$/, "") : "";
  return trimmed;
}

function createDeviceSyncClient({ identity, baseUrl = "", fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!identity) throw new Error("createDeviceSyncClient: identity wajib diisi");
  const doFetch = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!doFetch) throw new Error("createDeviceSyncClient: fetch tidak tersedia");

  let cachedBaseUrl = normalizeBaseUrl(baseUrl);

  function setBaseUrl(url) {
    cachedBaseUrl = normalizeBaseUrl(url);
    return cachedBaseUrl;
  }

  async function request(method, apiPath, { body, signed = false, baseUrlOverride } = {}) {
    const base = baseUrlOverride ? normalizeBaseUrl(baseUrlOverride) : cachedBaseUrl;
    // Kembalikan error terstruktur (bukan throw) agar pemanggil IPC tidak
    // menerima promise yang rejeksi tanpa penanganan.
    if (!base) return { ok: false, status: 0, error: "URL backend belum diatur" };
    const url = `${base}${apiPath}`;
    const headers = { Accept: "application/json" };
    let payload;

    if (signed) {
      // Body HARUS deterministik agar signature yang dihitung backend sama.
      payload = JSON.stringify(body || {});
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const nonce = crypto.randomBytes(12).toString("hex");
      headers["X-Device-ID"] = identity.getDeviceId();
      headers["X-Device-Timestamp"] = timestamp;
      headers["X-Device-Nonce"] = nonce;
      // Kunci = sha256(device_secret), BUKAN secret mentah. Server hanya
      // menyimpan turunan ini (credential_hash) sehingga tidak perlu secret.
      const signingKey = typeof identity.getSecretHash === "function"
        ? identity.getSecretHash()
        : identity.getSecret();
      headers["X-Device-Signature"] = crypto
        .createHmac("sha256", signingKey)
        .update(`${timestamp}.${nonce}.${payload}`)
        .digest("hex");
      headers["Content-Type"] = "application/json";
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers["Content-Type"] = "application/json";
    }

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      // GET/HEAD TIDAK boleh punya body (fetch/DOM melempar TypeError).
      // Tanda tangan tetap dihitung atas `payload` ("{}" untuk GET), dan server
      // memverifikasi dengan rawBody "{}" — jadi keduanya tetap cocok.
      const method_ = String(method).toUpperCase();
      const sendBody = method_ !== "GET" && method_ !== "HEAD";
      const res = await doFetch(url, {
        method,
        headers,
        body: sendBody ? payload : undefined,
        signal: controller ? controller.signal : undefined,
      });
      const text = await res.text().catch(() => "");
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text };
      }
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          error: data?.error || data?.message || `HTTP ${res.status}`,
          data,
        };
      }
      return { ok: true, status: res.status, data };
    } catch (err) {
      const aborted = err?.name === "AbortError";
      return {
        ok: false,
        status: 0,
        error: aborted ? "Waktu koneksi habis" : err?.message || "Gagal menghubungi server",
        offline: true,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Daftarkan device ke backend. Backend mengembalikan pairing code + QR
   * (sesuai plan: backend pembuat pairing code, bukan frontend).
   */
  async function register({ baseUrlOverride, deviceName } = {}) {
    const body = {
      deviceId: identity.getDeviceId(),
      deviceName: deviceName || identity.getDeviceName(),
      platform: process.platform,
      appVersion: process.env.npm_package_version || null,
      // Proof kredensial untuk device BARU (server belum punya hash-nya).
      // Ini sha256(device_secret) — sama dengan kunci yang dipakai menandatangani.
      secretProof: typeof identity.getSecretHash === "function" ? identity.getSecretHash() : null,
    };
    const res = await request("POST", "/devices-register", { body, signed: true, baseUrlOverride });
    if (!res.ok) return res;
    const data = res.data || {};
    return {
      ok: true,
      status: res.status,
      deviceId: data.deviceId || body.deviceId,
      pairingCode: data.pairing_code || data.pairingCode || null,
      expiresAt: data.expires_at || data.expiresAt || null,
      qrPayload: data.qr_payload || data.qrPayload || null,
      raw: data,
    };
  }

  /** Cek status pairing device (sudah dipasangkan ke store atau belum). */
  async function getStatus({ baseUrlOverride } = {}) {
    const res = await request("GET", `/devices-status/${encodeURIComponent(identity.getDeviceId())}`, {
      signed: true,
      baseUrlOverride,
    });
    if (!res.ok) return res;
    const data = res.data || {};
    return {
      ok: true,
      paired: Boolean(data.paired),
      storeId: data.store_id || data.storeId || null,
      storeName: data.store_name || data.storeName || null,
      deviceStatus: data.status || null,
      raw: data,
    };
  }

  /** Heartbeat ringan (opsional): menandai device online di web-app. */
  async function heartbeat({ baseUrlOverride } = {}) {
    return request("POST", "/devices-heartbeat", {
      body: { deviceId: identity.getDeviceId(), at: new Date().toISOString() },
      signed: true,
      baseUrlOverride,
    });
  }

  /**
   * Upload batch data sync. Setiap batch diberi `deviceId` + `batchId` unik
   * agar backend bisa idempoten (retry tidak menggandakan data).
   */
  async function push(batch = {}, { baseUrlOverride } = {}) {
    const rows = Array.isArray(batch.rows) ? batch.rows.slice(0, MAX_SYNC_ROWS) : [];
    const body = {
      deviceId: identity.getDeviceId(),
      batchId: batch.batchId || crypto.randomUUID(),
      kind: batch.kind || "transactions",
      sentAt: new Date().toISOString(),
      rows,
    };
    const res = await request("POST", "/sync-upload", { body, signed: true, baseUrlOverride });
    if (!res.ok) return res;
    return { ok: true, status: res.status, accepted: res.data?.accepted ?? rows.length, batchId: body.batchId, raw: res.data };
  }

  async function stockExchange(payload = {}, { baseUrlOverride } = {}) {
    const body = { ...payload, deviceId: identity.getDeviceId() };
    const res = await request("POST", "/stock-exchange", { body, signed: true, baseUrlOverride });
    if (!res.ok) return res;
    return { ok: true, status: res.status, ...(res.data || {}) };
  }

  function sendKdsTicket(payload, { baseUrlOverride } = {}) {
    return request("POST", "/kds-create-ticket", { body: { payload }, signed: true, baseUrlOverride });
  }

  function cancelKdsTickets(sourceRef, { baseUrlOverride } = {}) {
    return request("POST", "/kds-cancel-tickets", { body: { sourceRef: String(sourceRef || "") }, signed: true, baseUrlOverride });
  }

  return {
    setBaseUrl,
    getBaseUrl: () => cachedBaseUrl,
    register,
    getStatus,
    heartbeat,
    push,
    stockExchange,
    sendKdsTicket,
    cancelKdsTickets,
  };
}

module.exports = { createDeviceSyncClient, MAX_SYNC_ROWS };
