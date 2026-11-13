import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../utilities/utils.js";

// ── useDeviceSync — state & aksi Sync Cloud (PLAN-WEBSYNC) ──────────────────
//
// Membungkus `api.device*` (main process) menjadi state React. Aman dipakai di
// browser/dev (tanpa Electron): `available` = false dan semua aksi no-op.
//
// Tugas hook ini:
//  • status & identitas perangkat
//  • simpan URL backend (Supabase Functions)
//  • daftar perangkat → terima kode pairing, lalu POLL sampai dipasangkan
//  • kirim transaksi manual ("Kirim Sekarang")
//  • tampilkan notifikasi hasil auto-sync 5 menit dari main process
//
// Catatan: auto-send 5 menit berjalan di MAIN PROCESS (device-sync-service),
// bukan di hook ini — hook hanya menampilkan peringatan yang diterimanya. Ini
// supaya sync tetap jalan walau modal Settings sedang tertutup.

const POLL_MS = 5000;
const POLL_MAX_MS = 10 * 60 * 1000; // kode pairing berlaku ~10 menit

function useDeviceSync({ toast_, isAdmin = true } = {}) {
  const available = api.deviceAvailable();

  const [identity, setIdentity] = useState(null);
  const [baseUrl, setBaseUrlState] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  const [autoSync, setAutoSync] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pairing, setPairing] = useState(null); // { code, expiresAt, qrPayload }
  const [credential, setCredential] = useState(null); // { deviceId, deviceSecret } — sementara
  const [lastSync, setLastSync] = useState(null); // { ok, sent, at, error }

  const pollRef = useRef(null);
  const credTimerRef = useRef(null);
  const identityRef = useRef(null);
  const pairingRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const refresh = useCallback(async () => {
    if (!available) return null;
    setLoading(true);
    try {
      const res = await api.deviceStatus();
      if (res?.ok) {
        identityRef.current = res.identity || null;
        setIdentity(res.identity || null);
        setBaseUrlState(res.baseUrl || "");
        setPendingCount(Number(res.pendingCount) || 0);
        setAutoSync(Boolean(res.autoSync));
        return res;
      }
      return res;
    } finally {
      setLoading(false);
    }
  }, [available]);

  // Muat saat mount + saat tab dibuka kembali.
  useEffect(() => {
    refresh();
    return () => { stopPolling(); if (credTimerRef.current) clearTimeout(credTimerRef.current); };
  }, [refresh, stopPolling]);

  // Langganan peringatan hasil auto-sync dari main process.
  useEffect(() => {
    if (!available) return undefined;
    const off = api.onDeviceSyncEvent((payload) => {
      if (!payload) return;
      if (payload.kind === "sync-failed") {
        // Peringatan tiap gagal kirim — toast merah + simpan status untuk banner.
        toast_?.(payload.message || "Sinkronisasi cloud gagal", "err");
        setLastSync({ ok: false, at: payload.at || new Date().toISOString(), error: payload.message });
      } else if (payload.kind === "sync-ok") {
        setLastSync({ ok: true, sent: payload.sent, at: payload.at || new Date().toISOString() });
      } else if (payload.kind === "stock-sync-failed") {
        toast_?.(payload.message || "Sinkronisasi stok cloud gagal", "err");
      }
      // Segarkan jumlah tertunda supaya badge akurat setelah auto-sync.
      api.devicePendingCount().then((n) => setPendingCount(Number(n) || 0)).catch(() => {});
    });
    return off;
  }, [available, toast_]);

  const changeBaseUrl = useCallback(async (url) => {
    if (!available) return { ok: false };
    setSaving(true);
    try {
      const res = await api.deviceSetBaseUrl(url);
      if (res?.ok) {
        setBaseUrlState(res.baseUrl || "");
        toast_?.("URL backend disimpan", "ok");
      } else {
        toast_?.(res?.error || "Gagal menyimpan URL", "err");
      }
      return res;
    } finally {
      setSaving(false);
    }
  }, [available, toast_]);

  const stopPollingRef = stopPolling;
  const checkPairing = useCallback(async () => {
    if (!available) return { ok: false };
    const res = await api.deviceCheckPairing();
    if (res?.ok) {
      const wasRegistered = identityRef.current?.registered;
      identityRef.current = res.identity || null;
      setIdentity(res.identity || null);
      if (res.paired) stopPollingRef();
      if (res.paired && pairingRef.current && !wasRegistered) {
        pairingRef.current = null;
        setPairing(null);
        toast_?.("Perangkat berhasil dipasangkan", "ok");
        await refresh();
      }
    }
    return res;
  }, [available, refresh, stopPollingRef, toast_]);

  // Re-check status so a revoke from the Web-App is reflected while Settings
  // remains open. The backend is the source of truth for pairing status.
  useEffect(() => {
    if (!available) return undefined;
    // Do not wait for the first interval: on app restart the local identity
    // may still say registered even though the Web-App already revoked it.
    checkPairing();
    const interval = setInterval(() => { checkPairing(); }, 10000);
    return () => clearInterval(interval);
  }, [available, checkPairing]);

  const startPolling = useCallback(() => {
    stopPolling();
    const startedAt = Date.now();
    pollRef.current = setInterval(() => {
      if (Date.now() - startedAt > POLL_MAX_MS) {
        stopPolling();
        pairingRef.current = null;
        setPairing(null);
        toast_?.("Kode pairing kedaluwarsa. Minta kode baru.", "err");
        return;
      }
      checkPairing();
    }, POLL_MS);
  }, [checkPairing, stopPolling, toast_]);

  const register = useCallback(async () => {
    if (!available) return { ok: false };
    setRegistering(true);
    try {
      const res = await api.deviceRegister({ deviceName: identity?.deviceName });
      if (res?.ok && res.pairingCode) {
        const nextPairing = { code: res.pairingCode, expiresAt: res.expiresAt, qrPayload: res.qrPayload };
        pairingRef.current = nextPairing;
        setPairing(nextPairing);
        if (!identityRef.current?.registered) startPolling();
        toast_?.("Kode pairing dibuat. Masukkan di Web-App.", "ok");
      } else {
        toast_(res?.error || "Gagal mendaftarkan perangkat", "err");
      }
      return res;
    } finally {
      setRegistering(false);
    }
  }, [available, identity?.deviceName, startPolling, toast_]);

  const pushNow = useCallback(async () => {
    if (!available) return { ok: false };
    setPushing(true);
    try {
      const res = await api.devicePushTransactions();
      if (res?.ok) {
        setLastSync({ ok: true, sent: res.sent, at: new Date().toISOString() });
        if (res.sent > 0) toast_?.(`${res.sent} transaksi terkirim`, "ok");
        else toast_?.("Tidak ada data baru untuk dikirim", "ok");
      } else {
        setLastSync({ ok: false, at: new Date().toISOString(), error: res?.error });
        toast_(res?.error || "Gagal mengirim data", "err");
      }
      await refresh();
      return res;
    } finally {
      setPushing(false);
    }
  }, [available, refresh, toast_]);

  const rotate = useCallback(async () => {
    if (!available) return { ok: false };
    setLoading(true);
    try {
      const res = await api.deviceRotateCredential();
      if (res?.ok) {
        pairingRef.current = null;
        setPairing(null);
        stopPolling();
        toast_?.("Kredensial diperbarui. Perangkat perlu dipasangkan ulang.", "ok");
        await refresh();
      } else {
        toast_(res?.error || "Gagal memperbarui kredensial", "err");
      }
      return res;
    } finally {
      setLoading(false);
    }
  }, [available, refresh, stopPolling, toast_]);

  const rename = useCallback(async (name) => {
    if (!available) return { ok: false };
    const res = await api.deviceSetName(name);
    if (res?.ok) { setIdentity(res.identity || null); toast_?.("Nama perangkat disimpan", "ok"); }
    else toast_(res?.error || "Gagal menyimpan nama", "err");
    return res;
  }, [available, toast_]);

  // revealCredential — tampilkan secret 8 detik lalu auto-hide (satu-satunya
  // jalur secret ke UI, dan hanya saat admin memintanya secara eksplisit).
  const revealCredential = useCallback(async () => {
    if (!available) return null;
    const res = await api.deviceCredential();
    if (res?.ok) {
      setCredential({ deviceId: res.deviceId, deviceSecret: res.deviceSecret });
      if (credTimerRef.current) clearTimeout(credTimerRef.current);
      credTimerRef.current = setTimeout(() => setCredential(null), 8000);
    } else {
      toast_(res?.error || "Gagal membaca kredensial", "err");
    }
    return res;
  }, [available, toast_]);

  const hideCredential = useCallback(() => {
    if (credTimerRef.current) clearTimeout(credTimerRef.current);
    setCredential(null);
  }, []);

  return {
    available,
    isAdmin,
    // state
    identity, baseUrl, pendingCount, autoSync, loading, saving, registering,
    pushing, pairing, credential, lastSync,
    paired: Boolean(identity?.registered),
    // aksi
    refresh, changeBaseUrl, register, checkPairing, pushNow, rotate, rename,
    revealCredential, hideCredential, stopPolling,
  };
}

export { useDeviceSync };
