import { useState, useEffect } from "react";
import {
  G, W, BD, MT, LT, TX, row, RADIUS, TYPOGRAPHY, COLOR_PALETTE,
  inp,
} from "../../../constants/design.js";
import { isAdmin } from "../../../utilities/permissions.js";
import { SaveButton } from "./shared.jsx";

// CloudSyncSettingsTab — UI admin untuk pairing + kirim data ke cloud
// (PLAN-WEBSYNC). Auto-send tiap 5 menit dijalankan di main process; tab ini
// menampilkan status & memberi tombol aksi manual.

const CLOUD_SYNC_HOOK_UNAVAILABLE = "Fitur Sync Cloud hanya tersedia di aplikasi desktop.";

function StatusPill({ tone = "muted", children }) {
  const map = {
    ok: { bg: COLOR_PALETTE.primaryLight, color: G },
    warn: { bg: COLOR_PALETTE.warningLight, color: COLOR_PALETTE.warning },
    err: { bg: COLOR_PALETTE.dangerLight, color: COLOR_PALETTE.danger },
    muted: { bg: LT, color: MT },
  };
  const c = map[tone] || map.muted;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: RADIUS.full, background: c.bg, color: c.color, fontSize: TYPOGRAPHY.caption.fontSize, fontWeight: 700 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: c.color }} />
      {children}
    </span>
  );
}

function Section({ title, children, right }) {
  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${BD}` }}>
      <div style={{ ...row, marginBottom: 8 }}>
        <span style={{ fontSize: TYPOGRAPHY.label.fontSize, fontWeight: 700, color: G }}>{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

function ghostBtn(disabled) {
  return {
    padding: "6px 12px",
    background: W,
    color: disabled ? MT : G,
    border: `1px solid ${BD}`,
    borderRadius: RADIUS.md,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
    fontSize: TYPOGRAPHY.caption.fontSize,
    fontWeight: 700,
  };
}

function formatTime(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }); }
  catch { return iso; }
}

async function copyText(text, toast_) {
  if (!text) {
    toast_?.("Tidak ada kode untuk disalin", "err");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast_?.("Disalin ke clipboard", "ok");
  } catch {
    try {
      const input = document.createElement("textarea");
      input.value = text;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      toast_?.(copied ? "Disalin ke clipboard" : "Gagal menyalin. Salin manual dari kotak.", copied ? "ok" : "err");
    } catch {
      toast_?.("Gagal menyalin. Salin manual dari kotak.", "err");
    }
  }
}

export function CloudSyncSettingsTab({ authH, deviceH }) {
  // deviceH disuntik dari SettingsPanel; kalau tidak ada (mis. di luar modal) → pesan.
  const d = deviceH;
  const admin = isAdmin(authH?.currentUser);
  const [urlDraft, setUrlDraft] = useState(d?.baseUrl || "");

  useEffect(() => { if (d?.baseUrl !== undefined) setUrlDraft(d.baseUrl); }, [d?.baseUrl]);

  if (!admin) {
    return <div style={{ fontSize: TYPOGRAPHY.small.fontSize, color: MT, fontStyle: "italic" }}>
      Hanya admin yang dapat mengatur Sync Cloud.
    </div>;
  }
  if (!d) {
    return <div style={{ fontSize: TYPOGRAPHY.small.fontSize, color: MT }}>{CLOUD_SYNC_HOOK_UNAVAILABLE}</div>;
  }
  if (!d.available) {
    return <div style={{ fontSize: TYPOGRAPHY.small.fontSize, color: MT }}>{CLOUD_SYNC_HOOK_UNAVAILABLE}</div>;
  }

  const identity = d.identity || {};
  const paired = d.paired;
  const lastSync = d.lastSync;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: TYPOGRAPHY.label.fontSize, color: MT, fontWeight: 600 }}>
        Sinkronkan data kasir ke cloud. Pengiriman otomatis tiap 5 menit
        berjalan selama perangkat sudah dipasangkan.
      </div>

      {/* Status ringkas */}
      <div style={{ ...row, marginTop: 10 }}>
          {lastSync && !lastSync.ok ? (
          <StatusPill tone="err">⚠ Gagal kirim: {lastSync.error || "tidak diketahui"} ({formatTime(lastSync.at)})</StatusPill>
          ): 
        paired
          ? <StatusPill tone="ok">Terhubung{identity.storeId ? ` • ${identity.storeId}` : ""}</StatusPill>
          : <StatusPill tone="muted">Belum terhubung</StatusPill>
        }
        <span style={{ fontSize: TYPOGRAPHY.caption.fontSize, color: MT }}>
          {d.autoSync ? "Auto-sync: aktif (5 menit)" : "Auto-sync: nonaktif"}
        </span>
        </div>
      {/* URL backend */}
      <Section title="URL Backend">
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={inp}
            placeholder="https://(...)"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            disabled={d.saving}
          />
          <SaveButton onClick={() => d.changeBaseUrl(urlDraft)}>
            {d.saving ? "Menyimpan…" : "Simpan"}
          </SaveButton>
        </div>
        <div style={{ fontSize: TYPOGRAPHY.caption.fontSize, color: MT, marginTop: 6 }}>
          Tanpa URL, daftar & kirim data tidak dapat dijalankan.
        </div>
      </Section>

      {/* Identitas perangkat */}
      <Section title="Perangkat Ini">
        <div style={{ display: "grid", gap: 6, fontSize: TYPOGRAPHY.caption.fontSize }}>
          <div style={{ ...row }}>
            <span style={{ color: MT }}>Nama</span>
            <span style={{ fontWeight: 700, color: TX }}>{identity.deviceName || "—"}</span>
          </div>
          <div style={{ ...row }}>
            <span style={{ color: MT }}>Device ID</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <code style={{ fontSize: TYPOGRAPHY.code.fontSize }}>{identity.deviceId || "—"}</code>
              {identity.deviceId && (
                <button style={ghostBtn(false)} onClick={() => copyText(identity.deviceId, authH?.toast_)}>Salin</button>
              )}
            </span>
          </div>
          <div style={{ ...row }}>
            <span style={{ color: MT }}>Dibuat</span>
            <span style={{ color: TX }}>{formatTime(identity.createdAt)}</span>
          </div>
        </div>
      </Section>

      {/* Pairing */}
      <Section title="Pairing Perangkat">
        {paired && (
          <div style={{ fontSize: TYPOGRAPHY.caption.fontSize, color: G, fontWeight: 600, marginBottom: 8 }}>
            ✓ Perangkat terhubung. Anda tetap dapat meminta kode untuk user Web-App lain.
          </div>
        )}
        <SaveButton onClick={() => d.register()} disabled={d.registering || d.loading}>
          {d.registering ? "Meminta kode…" : paired ? "Minta Kode Pairing Tambahan" : "Daftarkan & Minta Kode"}
        </SaveButton>
        {d.pairing && (
          <div style={{ marginTop: 10, padding: 12, background: LT, borderRadius: RADIUS.md, textAlign: "center" }}>
            <div style={{ fontSize: TYPOGRAPHY.caption.fontSize, color: MT, marginBottom: 4 }}>
              Masukkan kode ini di Web-App → &quot;Hubungkan Perangkat&quot;
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 4, color: G, fontFamily: "monospace" }}>
              {String(d.pairing.code || "").toUpperCase()}
            </div>
            {d.pairing.expiresAt && (
              <div style={{ fontSize: TYPOGRAPHY.caption.fontSize, color: MT, marginTop: 4 }}>
                Berlaku sampai {formatTime(d.pairing.expiresAt)}
              </div>
            )}
            <button style={{ ...ghostBtn(false), marginTop: 8 }} onClick={() => copyText(d.pairing.code, authH?.toast_)}>
              Salin kode
            </button>
            <div style={{ fontSize: TYPOGRAPHY.caption.fontSize, color: MT, marginTop: 8 }}>
              {paired ? "Gunakan kode ini untuk menghubungkan user tambahan." : "Menunggu persetujuan…"}
            </div>
          </div>
        )}
      </Section>

      {/* Kirim data */}
      <Section title="Kirim Data">
        <div style={{ ...row }}>
          <div style={{ fontSize: TYPOGRAPHY.caption.fontSize, color: MT }}>
            Transaksi belum terkirim: <b style={{ color: TX }}>{d.pendingCount}</b>
          </div>
          <SaveButton onClick={() => d.pushNow()}>
            {d.pushing ? "Mengirim…" : "Kirim Sekarang"}
          </SaveButton>
        </div>
        {!paired && (
          <div style={{ fontSize: TYPOGRAPHY.caption.fontSize, color: MT, marginTop: 6 }}>
            Pasangkan perangkat dulu sebelum mengirim data.
          </div>
        )}
      </Section>

      {/* Lanjutan */}
      <Section title="Lanjutan">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={ghostBtn(false)} onClick={() => d.revealCredential()}>
            Tampilkan kredensial
          </button>
          <button
            style={{ ...ghostBtn(false), color: COLOR_PALETTE.danger, borderColor: COLOR_PALETTE.danger }}
            onClick={() => {
              if (window.confirm("Regenerasi kredensial? Perangkat harus dipasangkan ulang dari awal.")) d.rotate();
            }}
          >
            Regenerasi kredensial
          </button>
        </div>
        {d.credential && (
          <div style={{ marginTop: 10, padding: 10, background: COLOR_PALETTE.warningLight, borderRadius: RADIUS.md }}>
            <div style={{ fontSize: TYPOGRAPHY.caption.fontSize, color: COLOR_PALETTE.warning, fontWeight: 700, marginBottom: 6 }}>
              Jangan bagikan. Tersembunyi otomatis dalam 8 detik.
            </div>
            <div style={{ fontSize: TYPOGRAPHY.code.fontSize, fontFamily: "monospace", wordBreak: "break-all", color: TX }}>
              <div><b>device_id:</b> {d.credential.deviceId}</div>
              <div><b>device_secret:</b> {d.credential.deviceSecret}</div>
            </div>
            <button style={{ ...ghostBtn(false), marginTop: 8 }} onClick={() => d.hideCredential()}>Sembunyikan</button>
          </div>
        )}
      </Section>
    </div>
  );
}
