import { useCallback, useEffect, useState } from "react";
import { W, BD, MT, LT, G, row, RADIUS, TYPOGRAPHY, COLOR_PALETTE } from "../../../constants/design.js";
import { api } from "../../../utilities/utils.js";
import { fmt } from "../../../utilities/receipt.js";

const RETENTION_DAYS = 30;

// Sisa hari sebelum transaksi dibuang permanen oleh main process.
function daysLeft(expiresAt) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 86400000)) : 0;
}

const buttonBase = { border: "none", borderRadius: RADIUS.sm, padding: "4px 9px", cursor: "pointer", fontFamily: "inherit", fontSize: TYPOGRAPHY.label.fontSize, fontWeight: 700 };

export function RecycleBinSettingsTab({ historyH, applyStockView }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.loadTrash();
    setItems(Array.isArray(res?.items) ? res.items : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const restore = async (id) => {
    setBusyId(id);
    const ok = await historyH?.restoreTrashTrx?.(id, { applyStockView });
    setBusyId(null);
    if (ok) { setConfirmId(null); await load(); }
  };

  const purge = async (id) => {
    setBusyId(id);
    const ok = await historyH?.purgeTrashTrx?.(id);
    setBusyId(null);
    if (ok) { setConfirmId(null); await load(); }
  };

  return <div>
    <div style={{ fontSize: TYPOGRAPHY.label.fontSize, fontWeight: 600, color: G, marginBottom: 8 }}>Transaksi Terhapus:</div>
    <div style={{ fontSize: TYPOGRAPHY.label.fontSize, color: MT, marginBottom: 12 }}>Transaksi yang dihapus disimpan {RETENTION_DAYS} hari, lalu dibuang otomatis. Pulihkan untuk mengembalikannya ke riwayat.</div>
    {loading
      ? <div style={{ fontSize: TYPOGRAPHY.small.fontSize, color: MT, textAlign: "center", padding: "18px 0" }}>Memuat…</div>
      : !items.length
        ? <div style={{ padding: "22px 12px", textAlign: "center", background: LT, border: `1px dashed ${BD}`, borderRadius: RADIUS.md }}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>&#128465;</div>
            <div style={{ fontSize: TYPOGRAPHY.small.fontSize, fontWeight: 600, color: G }}>Tempat sampah kosong</div>
            <div style={{ fontSize: TYPOGRAPHY.label.fontSize, color: MT, marginTop: 4 }}>Transaksi yang dihapus akan muncul di sini.</div>
          </div>
        : items.map((item) => {
            const trx = item.trx || {};
            const left = daysLeft(item.expiresAt);
            const busy = busyId === item.id;
            return <div key={item.id} style={{ background: W, border: `1px solid ${BD}`, borderRadius: RADIUS.md, padding: "9px 10px", marginBottom: 6 }}>
              <div style={{ ...row, marginBottom: 4, gap: 8 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: TYPOGRAPHY.small.fontSize, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>TRX #{trx.id ?? item.id}</div>
                  <div style={{ fontSize: TYPOGRAPHY.label.fontSize, color: MT }}>
                    {new Date(item.deletedAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}
                    {Number.isFinite(Number(trx.total)) ? ` · ${fmt(trx.total)}` : ""}
                  </div>
                </div>
                <span style={{ flexShrink: 0, fontSize: TYPOGRAPHY.label.fontSize, fontWeight: 700, color: left <= 3 ? COLOR_PALETTE.danger : G, background: left <= 3 ? COLOR_PALETTE.dangerLight : COLOR_PALETTE.primaryLight, borderRadius: RADIUS.sm, padding: "3px 7px" }}>
                  {left === 0 ? "Hari ini" : `${left} hari lagi`}
                </span>
              </div>
              <div style={{ ...row, gap: 8 }}>
                <div style={{ minWidth: 0, fontSize: TYPOGRAPHY.label.fontSize, color: MT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {[trx.metodeBayarLabel || trx.metodeBayar, trx.status === "voided" ? "VOID" : null].filter(Boolean).join(" · ") || "Rincian tidak tersedia"}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button disabled={busy} onClick={() => restore(item.id)} style={{ ...buttonBase, background: COLOR_PALETTE.primaryLight, color: G, opacity: busy ? 0.6 : 1, cursor: busy ? "not-allowed" : "pointer" }}>Pulihkan</button>
                  {confirmId === item.id
                    ? <>
                        <button disabled={busy} onClick={() => purge(item.id)} style={{ ...buttonBase, background: COLOR_PALETTE.danger, color: W, opacity: busy ? 0.6 : 1 }}>Yakin?</button>
                        <button disabled={busy} onClick={() => setConfirmId(null)} style={{ ...buttonBase, background: LT, color: MT, border: `1px solid ${BD}`, fontWeight: 600 }}>Batal</button>
                      </>
                    : <button disabled={busy} onClick={() => setConfirmId(item.id)} style={{ ...buttonBase, background: COLOR_PALETTE.dangerLight, color: COLOR_PALETTE.danger, opacity: busy ? 0.6 : 1 }}>Hapus Permanen</button>}
                </div>
              </div>
            </div>;
          })}
  </div>;
}
