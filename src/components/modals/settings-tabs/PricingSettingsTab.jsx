import { useEffect, useState } from "react";
import { BD, MT, LT, TX, G, W, inp, row, RADIUS, TYPOGRAPHY, COLOR_PALETTE } from "../../../constants/design.js";
import { fieldStyle, SaveButton } from "./shared.jsx";

function getTargetName(entries, target) { const match = entries.find((entry) => String(entry.key || entry.id) === String(target)); return match?.label || match?.nama || target; }

export function PricingSettingsTab({ settingsH, menu, cats }) {
  const [draft, setDraft] = useState({ type: "percentage", value: "", scope: "global", target: "", minQty: "1", perChunk: false, chunkQty: "5" });
  const [search, setSearch] = useState("");
  const [lowStock, setLowStock] = useState(settingsH.settings.lowStockThreshold ?? 5);
  useEffect(() => setLowStock(settingsH.settings.lowStockThreshold ?? 5), [settingsH.settings.lowStockThreshold]);
  const save = (patch) => settingsH.savePricing(patch);
  const manualCartDiscount = settingsH.settings.manualCartDiscount || { enabled: false, required: false, type: "percentage" };
  const saveManualCartDiscount = (patch) => save({ manualCartDiscount: { ...manualCartDiscount, ...patch } });
  const entries = draft.scope === "category" ? cats : menu;
  const targets = entries.filter((entry) => !search.trim() || `${entry.label || entry.nama || ""} ${entry.key || entry.id || ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  const addDiscount = async () => {
    const value = Number(draft.value);
    if (String(draft.value).trim() === "" || !Number.isFinite(value) || value <= 0) return settingsH.toast_(String(draft.value).trim() === "" ? "Nilai diskon wajib diisi" : "Nilai diskon harus lebih besar dari 0", "err");
    if (draft.type === "percentage" && value > 100) return settingsH.toast_("Persentase diskon maksimal 100%", "err");
    if (draft.scope !== "global" && !draft.target) return settingsH.toast_("Target diskon wajib dipilih", "err");
    if (!Number.isFinite(Number(draft.minQty)) || Number(draft.minQty) < 1) return settingsH.toast_("Jumlah minimum harus minimal 1", "err");
    if (draft.perChunk && (!Number.isFinite(Number(draft.chunkQty)) || Number(draft.chunkQty) < 1)) return settingsH.toast_("Jumlah pembagian harus minimal 1", "err");
    await save({ discounts: [...(settingsH.settings.discounts || []), { id: `discount_${Date.now()}`, enabled: true, type: draft.type, value, scope: draft.scope, target: draft.scope === "global" ? "" : draft.target, minQty: Math.max(1, Number(draft.minQty)), perChunk: draft.perChunk, chunkQty: Math.max(1, Number(draft.chunkQty)) }] });
    setDraft({ ...draft, value: "", target: "" });
  };
  const discounts = settingsH.settings.discounts || [];
  const lowStockPanel = <><div style={{ paddingBottom: 12, borderBottom: `1px solid ${BD}`, marginBottom: 12 }}>
    <div style={{ fontSize: TYPOGRAPHY.label.fontSize, fontWeight: 700, color: G, marginBottom: 8 }}>Batas Stok Menipis</div>
    <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
      <input id="low-stock-threshold" name="lowStockThreshold" type="number" min="1" max="999" value={lowStock} onChange={(event) => setLowStock(event.target.value)} onKeyDown={(event) => event.key === "Enter" && settingsH.setLowStockThreshold(lowStock)} placeholder="5" style={{ ...fieldStyle, width: 90 }} />
      <SaveButton onClick={() => settingsH.setLowStockThreshold(lowStock)} />
    </div>
    <div style={{ fontSize: TYPOGRAPHY.label.fontSize, color: MT, marginTop: 8 }}>Item dengan stok &le; nilai ini akan muncul di peringatan stok menipis pada halaman Kelola Menu. Item tanpa stok (tak terbatas) tidak pernah diperingatkan. Default 5.</div>
  </div><div style={{ padding: 10, background: W, border: `1px solid ${BD}`, borderRadius: RADIUS.sm, marginBottom: 12 }}>
    <div style={{ fontSize: TYPOGRAPHY.label.fontSize, fontWeight: 700, marginBottom: 8 }}>Diskon Manual di Keranjang</div>
    <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: TYPOGRAPHY.label.fontSize, marginBottom: 8 }}>
      <input type="checkbox" checked={manualCartDiscount.enabled} onChange={(event) => saveManualCartDiscount({ enabled: event.target.checked })} />
      Tampilkan kolom diskon manual di keranjang
    </label>
    {manualCartDiscount.enabled && <>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: TYPOGRAPHY.label.fontSize, marginBottom: 8 }}>
        Jenis diskon
        <select value={manualCartDiscount.type} onChange={(event) => saveManualCartDiscount({ type: event.target.value })} style={{ ...inp, flex: 1 }}>
          <option value="percentage">Persentase (%)</option>
          <option value="fixed">Nominal (Rp)</option>
        </select>
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: TYPOGRAPHY.label.fontSize }}>
        <input type="checkbox" checked={manualCartDiscount.required} onChange={(event) => saveManualCartDiscount({ required: event.target.checked })} />
        Wajib diisi sebelum pembayaran
      </label>
      <div style={{ fontSize: TYPOGRAPHY.label.fontSize, color: MT, marginTop: 7 }}>Jika diisi, diskon ini menggantikan diskon otomatis dari aturan harga untuk transaksi tersebut.</div>
    </>}
  </div></>;
  return <div>{lowStockPanel}<div style={{ fontSize: TYPOGRAPHY.label.fontSize, color: MT, marginBottom: 12 }}>Atur diskon bertingkat, pajak, dan service untuk transaksi baru.</div>{["pajak", "service"].map((key) => { const config = settingsH.settings[key] || { enabled: false, value: 0 }; return <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}><input id={`tax-service-${key}-enabled`} name={`taxService_${key}_enabled`} type="checkbox" checked={config.enabled !== false} onChange={(event) => save({ [key]: { ...config, enabled: event.target.checked } })} /><span style={{ width: 70, fontSize: TYPOGRAPHY.small.fontSize, fontWeight: 600 }}>{key === "pajak" ? "Pajak" : "Service"}</span><input id={`tax-service-${key}-value`} name={`taxService_${key}_value`} type="number" min="0" max="100" value={config.value || ""} onChange={(event) => save({ [key]: { ...config, value: Number(event.target.value) || 0 } })} style={{ ...inp, width: 90 }} /><span style={{ fontSize: TYPOGRAPHY.small.fontSize }}>%</span></div>; })}<div style={{ borderTop: `1px solid ${BD}`, paddingTop: 12, marginTop: 12 }}><div style={{ fontSize: TYPOGRAPHY.label.fontSize, fontWeight: 700, color: G, marginBottom: 8 }}>Tambah Diskon</div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}><select id="discount-type" name="discountType" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })} style={inp}><option value="percentage">Persentase (%)</option><option value="fixed">Nominal (Rp)</option></select><input id="discount-value" name="discountValue" type="number" min="0" value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} placeholder="Nilai diskon" style={inp} /><select id="discount-scope" name="discountScope" value={draft.scope} onChange={(event) => { setDraft({ ...draft, scope: event.target.value, target: "" }); setSearch(""); }} style={inp}><option value="global">Semua item</option><option value="category">Kategori</option><option value="item">Item</option></select><input id="discount-min-qty" name="discountMinQty" type="number" min="1" value={draft.minQty} onChange={(event) => setDraft({ ...draft, minQty: event.target.value })} placeholder="Min. jumlah" style={inp} /></div><label style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 8, fontSize: TYPOGRAPHY.small.fontSize }}><input id="discount-per-chunk" name="discountPerChunk" type="checkbox" checked={draft.perChunk} onChange={(event) => setDraft({ ...draft, perChunk: event.target.checked })} />Terapkan diskon per kelompok jumlah</label>{draft.perChunk && <input id="discount-chunk-qty" name="discountChunkQty" type="number" min="1" value={draft.chunkQty} onChange={(event) => setDraft({ ...draft, chunkQty: event.target.value })} placeholder="Jumlah per kelompok (contoh: 5)" style={{ ...inp, width: "100%", marginTop: 7 }} />}{draft.scope !== "global" && <><input type="search" id="discount-target-search" name="discountTargetSearch" autoComplete="off" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Cari ${draft.scope === "category" ? "kategori" : "item"}...`} style={{ ...inp, width: "100%", marginTop: 7 }} /><div style={{ border: `1px solid ${BD}`, borderRadius: RADIUS.md, marginTop: 7, maxHeight: 150, overflowY: "auto" }}>{targets.length ? targets.map((entry) => <button key={entry.key || entry.id} type="button" onClick={() => setDraft({ ...draft, target: entry.key || entry.id })} style={{ display: "block", width: "100%", padding: "8px 10px", border: "none", borderBottom: `1px solid ${BD}`, background: draft.target === (entry.key || entry.id) ? COLOR_PALETTE.primaryLight : W, color: TX, textAlign: "left", cursor: "pointer", fontFamily: "inherit", fontSize: TYPOGRAPHY.small.fontSize }}>{entry.label || entry.nama}</button>) : <div style={{ padding: "8px 10px", color: MT, fontSize: TYPOGRAPHY.small.fontSize }}>Tidak ada nama yang cocok untuk item/kategori tersebut!</div>}</div><div style={{ marginTop: 5, fontSize: TYPOGRAPHY.label.fontSize, color: draft.target ? G : MT }}>{draft.target ? `Terpilih: ${getTargetName(entries, draft.target)}` : `Pilih ${draft.scope === "category" ? "kategori" : "item"} dari hasil pencarian`}</div></>}<SaveButton children="Tambah Diskon" onClick={addDiscount} /></div><div style={{ marginTop: 14 }}><div style={{ fontSize: TYPOGRAPHY.label.fontSize, fontWeight: 700, color: G, marginBottom: 8 }}>Diskon Aktif dan Tersimpan:</div>{discounts.map((rule) => <div key={rule.id} style={{ ...row, alignItems: "flex-start", padding: "8px 10px", background: rule.enabled === false ? LT : COLOR_PALETTE.primaryLight, borderRadius: RADIUS.md, marginBottom: 6 }}><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: TYPOGRAPHY.small.fontSize, fontWeight: 700, color: rule.enabled === false ? MT : TX }}>{rule.scope === "global" ? "Semua item dan kategori" : `${rule.scope === "category" ? "Kategori" : "Item"}: ${getTargetName(rule.scope === "category" ? cats : menu, rule.target)}`}</div><div style={{ fontSize: TYPOGRAPHY.label.fontSize, color: MT, marginTop: 3 }}>Diskon {rule.type === "fixed" ? `Rp ${Number(rule.value || 0).toLocaleString("id-ID")}` : `${rule.value || 0}%`} • Minimal {rule.minQty || 1} item{rule.perChunk ? ` • Per ${rule.chunkQty || 1} item` : ""}</div></div><button onClick={() => save({ discounts: discounts.map((item) => item.id === rule.id ? { ...item, enabled: item.enabled === false } : item) })} style={{ ...inp, width: "auto", padding: "4px 7px", cursor: "pointer" }}>{rule.enabled === false ? "Aktifkan" : "Matikan"}</button><button onClick={() => save({ discounts: discounts.filter((item) => item.id !== rule.id) })} style={{ background: COLOR_PALETTE.dangerLight, color: COLOR_PALETTE.danger, border: "none", borderRadius: RADIUS.sm, padding: "4px 7px", cursor: "pointer" }}>Hapus</button></div>)}</div></div>;
}
