import { useEffect, useState } from "react";
import { BD, G, LT, MT, TX, W, inp, RADIUS, TYPOGRAPHY } from "../../../constants/design.js";
import { api } from "../../../utilities/utils.js";
import { SaveButton } from "./shared.jsx";

const EMPTY_KDS_SETTINGS = { enabled: false, stations: [], unmappedStationId: "" };

function newStationId() {
  return globalThis.crypto?.randomUUID?.() || `station-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function KdsSettingsTab({ settingsH, cats = [], deviceH }) {
  const savedSettings = settingsH.settings.kdsSettings || EMPTY_KDS_SETTINGS;
  const [draft, setDraft] = useState(savedSettings);
  const [newLabel, setNewLabel] = useState("");
  const [syncStatus, setSyncStatus] = useState({ pendingCount: 0, error: null, offline: false });

  useEffect(() => setDraft(savedSettings), [savedSettings]);
  useEffect(() => {
    let alive = true;
    const refresh = () => api.kdsStatus().then((status) => { if (alive) setSyncStatus(status || { pendingCount: 0 }); }).catch(() => {});
    refresh();
    const timer = setInterval(refresh, 5000);
    const unsubscribe = api.onDeviceSyncEvent((event) => {
      if (event?.kind === "kds-sync") refresh();
    });
    const retryWhenOnline = () => { void api.kdsRetry().then(refresh); };
    window.addEventListener("online", retryWhenOnline);
    return () => { alive = false; clearInterval(timer); unsubscribe?.(); window.removeEventListener("online", retryWhenOnline); };
  }, []);

  const save = async (value) => {
    setDraft(value);
    await settingsH.savePricing({ kdsSettings: value });
  };

  const addStation = () => {
    const label = newLabel.trim();
    if (!label) return settingsH.toast_("Nama station wajib diisi", "err");
    if (draft.stations.some((station) => station.label.toLowerCase() === label.toLowerCase())) return settingsH.toast_("Nama station sudah digunakan", "err");
    setDraft({ ...draft, stations: [...draft.stations, { id: newStationId(), label, categoryKeys: [] }] });
    setNewLabel("");
  };

  const setCategory = (stationId, categoryKey, checked) => {
    const stations = draft.stations.map((station) => ({
      ...station,
      categoryKeys: checked
        ? [...station.categoryKeys.filter((key) => key !== categoryKey), ...(station.id === stationId ? [categoryKey] : [])]
        : station.id === stationId ? station.categoryKeys.filter((key) => key !== categoryKey) : station.categoryKeys,
    }));
    setDraft({ ...draft, stations });
  };

  const connectionLabel = !draft.enabled ? "Nonaktif" : !deviceH?.paired ? "Belum terhubung" : syncStatus.offline ? "Offline" : syncStatus.error ? "Error" : "Aktif";
  const connectionColor = connectionLabel === "Aktif" ? G : connectionLabel === "Nonaktif" ? MT : "#b45309";

  return <div style={{ display: "grid", gap: 14 }}>
    <div style={{ fontSize: TYPOGRAPHY.label.fontSize, color: MT }}>Rute pesanan kasir ke layar dapur memakai pairing Sync Cloud yang sudah ada.</div>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, paddingBottom: 10, borderBottom: `1px solid ${BD}` }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: TYPOGRAPHY.small.fontSize, fontWeight: 700 }}>
        <input type="checkbox" checked={draft.enabled} onChange={(event) => save({ ...draft, enabled: event.target.checked })} />
        Aktifkan KDS
      </label>
      <strong style={{ color: connectionColor, fontSize: TYPOGRAPHY.label.fontSize }}>{connectionLabel}</strong>
    </div>
    {draft.enabled && !deviceH?.paired && <div role="status" style={{ color: "#92400e", background: "#fff7ed", border: "1px solid #fed7aa", padding: 9, borderRadius: RADIUS.sm, fontSize: TYPOGRAPHY.label.fontSize }}>
      Pasangkan perangkat di tab Sync Cloud sebelum tiket dapat dikirim.
    </div>}
    <div>
      <div style={{ fontSize: TYPOGRAPHY.label.fontSize, fontWeight: 700, marginBottom: 7 }}>Station dapur/bar</div>
      <div style={{ display: "flex", gap: 7 }}>
        <input aria-label="Nama station baru" value={newLabel} onChange={(event) => setNewLabel(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addStation()} placeholder="Contoh: Dapur" style={{ ...inp, flex: 1 }} />
        <button type="button" onClick={addStation} style={{ padding: "7px 11px", border: 0, borderRadius: RADIUS.sm, background: G, color: W, cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>Tambah</button>
      </div>
    </div>
    {draft.stations.map((station) => <section key={station.id} style={{ padding: "10px 0", borderTop: `1px solid ${BD}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <strong style={{ flex: 1, fontSize: TYPOGRAPHY.small.fontSize }}>{station.label}</strong>
        <button type="button" aria-label={`Hapus station ${station.label}`} title="Hapus station" onClick={() => setDraft({ ...draft, stations: draft.stations.filter((entry) => entry.id !== station.id), unmappedStationId: draft.unmappedStationId === station.id ? "" : draft.unmappedStationId })} style={{ border: `1px solid ${BD}`, background: W, color: MT, borderRadius: RADIUS.sm, padding: "4px 8px", cursor: "pointer" }}>Hapus</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 6 }}>
        {cats.map((category) => <label key={category.key || category.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: 6, background: station.categoryKeys.includes(category.key || category.id) ? LT : W, border: `1px solid ${BD}`, borderRadius: RADIUS.sm, fontSize: TYPOGRAPHY.label.fontSize }}>
          <input type="checkbox" checked={station.categoryKeys.includes(category.key || category.id)} onChange={(event) => setCategory(station.id, category.key || category.id, event.target.checked)} />
          <span>{category.label || category.name || "Lainnya"}</span>
        </label>)}
      </div>
    </section>)}
    <label style={{ display: "grid", gap: 6, borderTop: `1px solid ${BD}`, paddingTop: 10, fontSize: TYPOGRAPHY.label.fontSize, fontWeight: 600 }}>
      Kategori tanpa station
      <select value={draft.unmappedStationId || ""} onChange={(event) => setDraft({ ...draft, unmappedStationId: event.target.value })} style={inp}>
        <option value="">Tidak dikirim</option>
        {draft.stations.map((station) => <option key={station.id} value={station.id}>{station.label}</option>)}
      </select>
    </label>
    <SaveButton onClick={() => save(draft)}>Simpan Pengaturan KDS</SaveButton>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 10, borderTop: `1px solid ${BD}`, fontSize: TYPOGRAPHY.label.fontSize }}>
      <span style={{ color: syncStatus.error ? "#b91c1c" : MT }}>{syncStatus.error || (syncStatus.offline ? "Menunggu koneksi" : `${syncStatus.pendingCount || 0} tiket menunggu terkirim`)}</span>
      {syncStatus.pendingCount > 0 && <button type="button" onClick={() => api.kdsRetry().then(setSyncStatus)} style={{ border: `1px solid ${BD}`, background: W, color: TX, borderRadius: RADIUS.sm, padding: "5px 8px", cursor: "pointer" }}>Coba lagi</button>}
    </div>
  </div>;
}
