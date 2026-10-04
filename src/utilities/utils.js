import { safeIpc } from "./ipc-guard.js";

const LS = (k,v) => v===undefined ? JSON.parse(localStorage.getItem(k)||"null") : localStorage.setItem(k,JSON.stringify(v));

// healVoidedTrx — repairs transactions whose payload was clobbered by the old
// trx-void handler (which overwrote the whole JSON with only void metadata).
// Such rows carry status:"voided" but lost total/items; we rebuild the minimal
// shape so reports and the history view never choke on them.
const healVoidedTrx = (t) => {
  if (!t || t.status !== "voided") return t;
  return {
    ...t,
    voided: true,
    total: Number.isFinite(t.total) ? t.total : 0,
    subtotal: Number.isFinite(t.subtotal) ? t.subtotal : 0,
    kembalian: Number.isFinite(t.kembalian) ? t.kembalian : 0,
    items: Array.isArray(t.items) ? t.items : [],
  };
};

// mergeVoidStatus — merges a void patch onto an existing transaction without
// discarding the original sale data.
const mergeVoidStatus = (t, patch) => (String(t.id) === String(patch.id) ? { ...t, ...patch.data } : t);

// isVoided — single source of truth for "this sale was cancelled".
// Accepts both the current `status` flag and the legacy `voided` boolean.
const isVoided = (t) => !!t && (t.status === "voided" || t.voided === true);

// nonVoided — filter helper for any sales total that must exclude voids.
const nonVoided = (list) => (Array.isArray(list) ? list.filter((t) => !isVoided(t)) : []);

// stockDeltasFromTrxBrowser — mirror of main process stockDeltasFromTrx for the
// localStorage fallback (Langkah 2b). Unit per item memakai baseQty ?? qty dan
// item tanpa id / qty 0 dilewati.
const stockDeltasFromTrxBrowser = (trx, sign = 1) => {
  const deltas = {};
  for (const it of trx?.items || []) {
    const qty = Math.abs(Number(it.baseQty ?? it.qty) || 0);
    if (!it?.id || qty === 0) continue;
    deltas[it.id] = (deltas[it.id] || 0) + sign * qty;
  }
  return deltas;
};



const api = {
  async loadTrx()         { return window.kasirAPI ? (await window.kasirAPI.loadTrx() || []).map(healVoidedTrx) : (LS("ykk_trx")||[]).map(healVoidedTrx); },
  async saveTrx(t)        { if(window.kasirAPI) return window.kasirAPI.saveTrx(t); const a=LS("ykk_trx")||[]; a.push(t); LS("ykk_trx",a); },
  // Langkah 2b: opts.restoreStock meminta main menambah stok saat transaksi
  // dihapus. Di mode browser kita hitung sendiri delta positif dari item.
  //Pelunasan (settlement): tandai piutang transaksi jadi lunas (bayar = total).
  //Tidak mengubah total pendapatan (penjualan sudah tercatat saat transaksi dibuat).
  async settleTrx(id, actor) {
    if (window.kasirAPI && window.kasirAPI.settleTrx) return window.kasirAPI.settleTrx(id, actor);
    const all = LS("ykk_trx") || [];
    const updated = all.map((t) => String(t.id) === String(id)
      ? { ...t, bayar: Number(t.total || 0), settled: true, settledAt: new Date().toISOString(), settledBy: actor || null }
      : t);
    LS("ykk_trx", updated);
    return { ok: true };
  },

async deleteTrx(id, opts) {
    if (window.kasirAPI) return window.kasirAPI.deleteTrx(id, opts);
    const all = LS("ykk_trx") || [];
    const trx = all.find((t) => String(t.id) === String(id)) || null;
    LS("ykk_trx", all.filter((t) => String(t.id) !== String(id)));
    let applied = {};
    if (opts?.restoreStock && trx && !isVoided(trx)) {
      const r = await api.applyStock(stockDeltasFromTrxBrowser(trx, 1), { type: "trx-delete", ref: id });
      applied = r?.stock || {};
    }
    return { ok: true, trx, applied };
  },
  async restoreTrx(list)  { if(window.kasirAPI) return window.kasirAPI.restoreTrx(list); LS("ykk_trx",list); },
  async clearTrx(opts)    {
    if (window.kasirAPI) return window.kasirAPI.clearTrx(opts);
    const all = (LS("ykk_trx") || []).map(healVoidedTrx);
    let applied = {};
    if (opts?.restoreStock) {
      const agg = {};
      for (const t of all) {
        if (isVoided(t)) continue;
        for (const [id, d] of Object.entries(stockDeltasFromTrxBrowser(t, 1))) {
          agg[id] = (agg[id] || 0) + d;
        }
      }
      const r = await api.applyStock(agg, { type: "trx-clear" });
      applied = r?.stock || {};
    }
    LS("ykk_trx", []);
    return { ok: true, backupFile: null, applied, cleared: all };
  },
  // Langkah 2b: baca-saja — jumlah transaksi & unit yang akan dikembalikan,
  // supaya modal konfirmasi bisa menampilkan "+N unit dari M transaksi".
  async restorePreview(q) {
    if (window.kasirAPI) return window.kasirAPI.restorePreview(q);
    const all = (LS("ykk_trx") || []);
    const pool = q?.all ? all : all.filter((t) => String(t.id) === String(q?.id));
    let trxCount = 0, totalQty = 0, skipped = 0;
    for (const t of pool) {
      if (!t || isVoided(t)) { skipped += 1; continue; }
      const deltas = stockDeltasFromTrxBrowser(t, 1);
      const qty = Object.values(deltas).reduce((s, n) => s + Math.abs(n), 0);
      if (qty === 0) { skipped += 1; continue; }
      trxCount += 1;
      totalQty += qty;
    }
    return { ok: true, trxCount, totalQty, skipped };
  },
  // Undo "Hapus Semua": main process menyimpan snapshot penuh sebelum DELETE,
  // renderer hanya menunjuk file-nya (localStorage tak punya file, jadi no-op).
  async restoreClearedTrx(backupFile) {
    if (window.kasirAPI) return window.kasirAPI.restoreClearedTrx(backupFile);
    return { ok: false, error: "Tidak tersedia di mode browser" };
  },
  async voidTrx(id, { reason, actor, note }) {
    if(window.kasirAPI) return window.kasirAPI.voidTrx(id, { reason, actor, note });
    const all = (LS("ykk_trx") || []).map(healVoidedTrx);
    const patch = { status: "voided", voided: true, voidedAt: new Date().toISOString(), voidedBy: actor || null, voidReason: reason || null, voidNote: note || "" };
    const updated = all.map(t => mergeVoidStatus(t, { id, data: patch }));
    LS("ykk_trx", updated);
    const found = all.find((t) => String(t.id) === String(id));
    return { ok: true, items: Array.isArray(found?.items) ? found.items : [] };
  },
  
  // New: Filtered & paginated transactions (localStorage fallback)
  async loadTrxFiltered({ fFrom, fTo, shiftId, page = 0, pageSize = 100, sort = "desc" }) {
    if (window.kasirAPI) return window.kasirAPI.loadTrxFiltered({ fFrom, fTo, shiftId, page, pageSize, sort });
    // Fallback to localStorage filtering
    const all = (LS("ykk_trx") || []).map(healVoidedTrx);
    let filtered = all.filter(t => {
      const d = new Date(t.timestamp);
      if (fFrom && d < new Date(fFrom)) return false;
      if (fTo && d > new Date(fTo + "T23:59:59")) return false;
      if (shiftId && t.shiftId !== shiftId) return false;
      return true;
    });
    filtered.sort((a, b) => {
      const ta = new Date(a.timestamp).getTime() || 0;
      const tb = new Date(b.timestamp).getTime() || 0;
      return sort === "asc" ? ta - tb : tb - ta;
    });
    const total = filtered.length;
    const transactions = filtered.slice(page * pageSize, (page + 1) * pageSize);
    return { transactions, total, page, pageSize };
  },
  
  async getTrxDailyStats({ fFrom, fTo, shiftId }) {
    if (window.kasirAPI) return window.kasirAPI.getTrxDailyStats({ fFrom, fTo, shiftId });
    // Fallback - compute from localStorage
    const all = LS("ykk_trx") || [];
    const filtered = all.filter(t => {
      const d = new Date(t.timestamp);
      if (fFrom && d < new Date(fFrom)) return false;
      if (fTo && d > new Date(fTo + "T23:59:59")) return false;
      if (shiftId && t.shiftId !== shiftId) return false;
      return true;
    });
    const byDate = {};
    filtered.forEach(t => {
      const date = t.timestamp.slice(0, 10);
      if (!byDate[date]) byDate[date] = { count: 0, total: 0, pax: 0, subtotal: 0 };
      byDate[date].count++;
      byDate[date].total += t.total || 0;
      byDate[date].pax += t.pax || 0;
      byDate[date].subtotal += t.subtotal || 0;
    });
    return Object.entries(byDate).map(([date, stats]) => ({ date, ...stats })).sort((a, b) => b.date.localeCompare(a.date));
  },
  
  async getTrxShiftIds() {
    if (window.kasirAPI) return window.kasirAPI.getTrxShiftIds();
    const all = LS("ykk_trx") || [];
    const ids = [...new Set(all.map(t => t.shiftId).filter(Boolean))];
    return ids.sort().reverse();
  },

  async loadBills()       { return window.kasirAPI ? await window.kasirAPI.loadBills()        : (LS("ykk_bills")||[]); },
  async saveBills(list)   { if(window.kasirAPI) return window.kasirAPI.saveBills(list); LS("ykk_bills",list); },
  async restoreBills(l)   { if(window.kasirAPI) return window.kasirAPI.restoreBills(l); LS("ykk_bills",l); },
  async clearBills()      { if(window.kasirAPI) return window.kasirAPI.clearBills(); LS("ykk_bills",[]); },
  async loadMenu()        { return window.kasirAPI ? await window.kasirAPI.loadMenu()         : LS("ykk_menu"); },
  // Langkah 2: menu pindah ke tabel `products` di main process. Upsert TIDAK
  // menimpa stok baris yang sudah ada; stok hanya berubah lewat applyStock.
  async upsertMenu(item)  {
    if (window.kasirAPI?.upsertMenu) return window.kasirAPI.upsertMenu(item);
    const list = LS("ykk_menu") || [];
    const idx = list.findIndex((m) => String(m.id) === String(item?.id));
    if (idx >= 0) list[idx] = { ...item, stok: list[idx].stok }; else list.push(item);
    LS("ykk_menu", list);
    return { ok: true };
  },
  async deleteMenu(id)    {
    if (window.kasirAPI?.deleteMenu) return window.kasirAPI.deleteMenu(id);
    LS("ykk_menu", (LS("ykk_menu") || []).filter((m) => String(m.id) !== String(id)));
    return { ok: true };
  },
  async replaceMenu(list) {
    if (window.kasirAPI?.replaceMenu) return window.kasirAPI.replaceMenu(list);
    LS("ykk_menu", list || []);
    return { ok: true };
  },
  // Import Excel: upsert banyak item sekaligus (fallback browser). Sama seperti
  // upsertMenu: baris existing tidak menimpa stok, baris baru set stok apa adanya.
  async bulkUpsertMenu(items) {
    if (window.kasirAPI?.bulkUpsertMenu) return window.kasirAPI.bulkUpsertMenu(items);
    const list = LS("ykk_menu") || [];
    const byId = new Map(list.map((m) => [String(m.id), m]));
    let applied = 0;
    let skipped = 0;
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || item.id === undefined || item.id === null) { skipped += 1; continue; }
      const key = String(item.id);
      const existing = byId.get(key);
      byId.set(key, existing ? { ...item, stok: existing.stok } : item);
      applied += 1;
    }
    LS("ykk_menu", [...byId.values()]);
    return { ok: true, applied, skipped };
  },
  // Satu pintu stok. Deltas = { [menuId]: delta }. Mengembalikan { ok, stock:{id:stok} }.
  async applyStock(deltas, meta) {
    if (window.kasirAPI?.applyStock) return window.kasirAPI.applyStock(deltas, meta);
    const list = LS("ykk_menu") || [];
    const stock = {};
    Object.entries(deltas || {}).forEach(([id, delta]) => {
      const it = list.find((m) => String(m.id) === String(id));
      if (!it || it.stok === null || it.stok === undefined) return;
      const d = Number(delta) || 0;
      if (!d) return;
      it.stok = Math.max(0, Number(it.stok) + d);
      stock[id] = it.stok;
    });
    LS("ykk_menu", list);
    return { ok: true, stock };
  },
  // Alias eksplisit supaya pemanggil tidak perlu tahu `applyStock`.
  async adjustStock(deltas, meta) { return this.applyStock(deltas, meta); },
  // Stok masuk (restock). Browser fallback: tambah stok + catat mutasi di LS.
  async stockIn({ id, qty, modalBaru, note, actor } = {}) {
    if (window.kasirAPI?.stockIn) return window.kasirAPI.stockIn({ id, qty, modalBaru, note, actor });
    const addQty = Number(qty) || 0;
    if (!id || addQty <= 0) return { ok: false, error: "qty tidak valid" };
    const list = LS("ykk_menu") || [];
    const it = list.find((m) => String(m.id) === String(id));
    if (!it) return { ok: false, error: "item tak ada" };
    if (it.stok === null || it.stok === undefined) return { ok: false, error: "stok tak terbatas" };
    const before = Number(it.stok);
    const after = Math.max(0, before + addQty);
    it.stok = after;
    if (modalBaru !== undefined && modalBaru !== null && modalBaru !== "") {
      const m = parseInt(modalBaru); if (!Number.isNaN(m) && m >= 0) it.modal = m;
    }
    LS("ykk_menu", list);
    this.logMovementLS({ productId: id, nama: it.nama, type: "in", delta: after - before, stokAfter: after, note, actor });
    return { ok: true, stock: { [id]: after }, menu: list };
  },
  // Set stok langsung tanpa log (peralihan null <-> angka). Browser fallback.
  async stockSet(id, stok) {
    if (window.kasirAPI?.stockSet) return window.kasirAPI.stockSet({ id, stok });
    const list = LS("ykk_menu") || [];
    const it = list.find((m) => String(m.id) === String(id));
    if (!it) return { ok: false, error: "item tak ada" };
    const value = stok === null || stok === "" ? null : Number(stok);
    if (value !== null && (Number.isNaN(value) || value < 0)) return { ok: false, error: "stok tidak valid" };
    it.stok = value; LS("ykk_menu", list);
    return { ok: true, stock: { [id]: value }, menu: list };
  },
  // Opname: set stok fisik, catat selisih sebagai mutasi "opname". Browser fallback.
  async stockOpname(rows, meta) {
    if (window.kasirAPI?.stockOpname) return window.kasirAPI.stockOpname(rows, meta);
    const list = LS("ykk_menu") || [];
    const stock = {};
    (Array.isArray(rows) ? rows : []).forEach((r) => {
      if (!r || r.id === undefined || r.id === null) return;
      const it = list.find((m) => String(m.id) === String(r.id));
      if (!it || it.stok === null || it.stok === undefined) return;
      const counted = Number(r.counted); if (Number.isNaN(counted) || counted < 0) return;
      const delta = counted - Number(it.stok);
      it.stok = counted; stock[r.id] = counted;
      if (delta !== 0) this.logMovementLS({ productId: r.id, nama: it.nama, type: "opname", delta, stokAfter: counted, ...(meta || {}) });
    });
    LS("ykk_menu", list);
    return { ok: true, stock, menu: list };
  },
  // Riwayat mutasi. Browser fallback membaca LS.
  async stockMovements(q) {
    if (window.kasirAPI?.stockMovements) return window.kasirAPI.stockMovements(q);
    const all = LS("ykk_stock_movements") || [];
    const { productId = null, limit = 200 } = q || {};
    const filtered = productId != null ? all.filter((m) => String(m.productId) === String(productId)) : all;
    return filtered.slice(0, Math.max(1, Number(limit) || 200));
  },
  logMovementLS(m) {
    const all = LS("ykk_stock_movements") || [];
    all.unshift({ ...m, createdAt: new Date().toISOString() });
    LS("ykk_stock_movements", all.slice(0, 2000));
  },
  async loadLogo()        { return window.kasirAPI ? await window.kasirAPI.loadLogo()         : LS("ykk_logo"); },
  async saveLogo(data)    { if(window.kasirAPI) return window.kasirAPI.saveLogo(data); LS("ykk_logo",data); },
  async loadCats()        { return window.kasirAPI ? await window.kasirAPI.loadCats()         : (LS("ykk_cats")||[]); },
  async saveCats(list) { if(window.kasirAPI) return window.kasirAPI.saveCats(list); LS("ykk_cats",list); },

  async loadResep(){ if(window.kasirAPI?.loadResep) return await window.kasirAPI.loadResep(); return (LS("ykk_resep") || {}); },
  async saveResep(v){ if(window.kasirAPI?.saveResep) return window.kasirAPI.saveResep(v); LS("ykk_resep", v); return { ok: true }; },
  async loadBahanBaku(){ if(window.kasirAPI?.loadBahanBaku) return await window.kasirAPI.loadBahanBaku(); return (LS("ykk_bahan_baku") || []); },
  async saveBahanBaku(list){ if(window.kasirAPI?.saveBahanBaku) return window.kasirAPI.saveBahanBaku(list); LS("ykk_bahan_baku", list); return { ok: true }; },
  async loadSupplier(){ if(window.kasirAPI?.loadSupplier) return await window.kasirAPI.loadSupplier(); return (LS("ykk_supplier") || []); },
  async saveSupplier(list){ if(window.kasirAPI?.saveSupplier) return window.kasirAPI.saveSupplier(list); LS("ykk_supplier", list); return { ok: true }; },
  async loadLoyaltyTiers(){ if(window.kasirAPI?.loadLoyaltyTiers) return await window.kasirAPI.loadLoyaltyTiers(); return (LS("ykk_loyalty_tiers") || []); },
  async saveLoyaltyTiers(list){ if(window.kasirAPI?.saveLoyaltyTiers) return window.kasirAPI.saveLoyaltyTiers(list); LS("ykk_loyalty_tiers", list); return { ok: true }; },
  // Total belanja kumulatif per pelanggan (untuk loyalty tier basis "lifetime").
  // Fallback browser: agregasi dari ykk_trx bila IPC tidak tersedia.
  async loadCustomerTotals(){
    if(window.kasirAPI?.customerTotals) return await window.kasirAPI.customerTotals();
    const map = {};
    for(const t of (LS("ykk_trx") || [])){
      const cid = t?.customerId;
      if(!cid) continue;
      map[cid] = (map[cid] || 0) + (Number(t?.total) || 0);
    }
    return Object.keys(map).map((customerId) => ({ customerId, total: map[customerId] }));
  },
  async loadSettings()    { return window.kasirAPI ? await window.kasirAPI.loadSettings()     : (LS("ykk_settings")||{}); },
  async saveSettings(d)   { if(window.kasirAPI) return window.kasirAPI.saveSettings(d); LS("ykk_settings",d); },
  async getDataPath()     { return window.kasirAPI ? await window.kasirAPI.getDataPath()      : "localStorage"; },
  async saveCSV(data)     {
    if(window.kasirAPI) return window.kasirAPI.saveCSV(data);
    const blob=new Blob(["\uFEFF"+data.content],{type:"text/csv;charset=utf-8;"}); const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=data.filename; a.click(); URL.revokeObjectURL(url); return {ok:true};
  },
  // Backup & Restore — hanya tersedia di aplikasi desktop (butuh akses folder data)
  isDesktop()             { return !!window.kasirAPI; },
  async backupStats()     { return window.kasirAPI?.backupStats ? safeIpc("Backup stats", () => window.kasirAPI.backupStats()) : { ok:false, error:"Hanya tersedia di aplikasi desktop" }; },
  async backupCreate(t)   { return window.kasirAPI?.backupCreate ? safeIpc("Backup", () => window.kasirAPI.backupCreate(t)) : { ok:false, error:"Hanya tersedia di aplikasi desktop" }; },
  async backupPreview(c)  { return window.kasirAPI?.backupPreview ? safeIpc("Pratinjau backup", () => window.kasirAPI.backupPreview(c)) : { ok:false, error:"Hanya tersedia di aplikasi desktop" }; },
  async backupSummary(c)  { return window.kasirAPI?.backupSummary ? safeIpc("Ringkasan backup", () => window.kasirAPI.backupSummary(c)) : { ok:false, error:"Hanya tersedia di aplikasi desktop" }; },
  async backupRestore(c)  { return window.kasirAPI?.backupRestore ? safeIpc("Pemulihan data", () => window.kasirAPI.backupRestore(c)) : { ok:false, error:"Hanya tersedia di aplikasi desktop" }; },
  async backupListInternal() { return window.kasirAPI?.backupListInternal ? safeIpc("Daftar backup internal", () => window.kasirAPI.backupListInternal(), { fallback:{ backups:[] } }) : { ok:false, backups:[] }; },
  async backupOpenFolder(){ return window.kasirAPI?.backupOpenFolder ? safeIpc("Buka folder data", () => window.kasirAPI.backupOpenFolder()) : { ok:false, error:"Hanya tersedia di aplikasi desktop" }; },
  async backupRelaunch()  { return window.kasirAPI?.backupRelaunch ? safeIpc("Muat ulang aplikasi", () => window.kasirAPI.backupRelaunch()) : { ok:false, error:"Hanya tersedia di aplikasi desktop" }; },
  async getPrinters()     { return window.kasirAPI ? await window.kasirAPI.getPrinters()      : []; },
  async printReceipt(d)   { return window.kasirAPI ? await window.kasirAPI.printReceipt(d)    : {ok:false,error:"Hanya tersedia di aplikasi desktop"}; },

  async exportReportPdf(d) { return (window.kasirAPI) ? await window.kasirAPI.exportReportPdf(d) : { ok: false, error: "Hanya tersedia aplikasi desktop" }; },
  async loadShifts()      { return window.kasirAPI ? await window.kasirAPI.loadShifts?.()     : (LS("ykk_shifts")||[]); },
  async saveShifts(list)  { if(window.kasirAPI&&window.kasirAPI.saveShifts) return window.kasirAPI.saveShifts(list); LS("ykk_shifts",list); },
  // Atomic payment — tulis trx + potong stok + hapus bill sekaligus
  async processPayment(data) {
    if(window.kasirAPI) return window.kasirAPI.processPayment(data);
    // Fallback localStorage (dev browser mode)
    const { trx, activeBillId } = data;
    const a = LS("ykk_trx")||[]; a.unshift(trx); LS("ykk_trx", a);
    if(activeBillId) LS("ykk_bills", (LS("ykk_bills")||[]).filter(b=>b.id!==activeBillId));
    // Potong stok kalau bukan dari open bill (stok sudah dipotong saat hold).
    const stock = {};
    if(!activeBillId && Array.isArray(trx?.items)) {
      const deltas = {};
      trx.items.forEach(it => {
        if(it?.id === undefined || it?.id === null) return;
        const qty = Number(it.baseQty ?? it.qty) || 0;
        if(!qty) return;
        deltas[String(it.id)] = (deltas[String(it.id)] || 0) - qty;
      });
      const r = await this.applyStock(deltas, { type: "sale", ref: trx?.id });
      Object.assign(stock, r?.stock || {});
    }
    return { ok: true, stock };
  },
  // ── Device identity & cloud sync (PLAN-WEBSYNC) ────────────────────────────
  // Desktop-only. Di browser semua mengembalikan { ok:false } agar UI bisa
  // menampilkan pesan "hanya tersedia di aplikasi desktop" tanpa crash.
  deviceAvailable() { return !!window.kasirAPI?.deviceStatus; },
  async deviceStatus() {
    if (window.kasirAPI?.deviceStatus) return safeIpc("Status perangkat", () => window.kasirAPI.deviceStatus());
    return { ok: false, error: "Hanya tersedia di aplikasi desktop", identity: null, baseUrl: "" };
  },
  async deviceSetBaseUrl(url) {
    if (window.kasirAPI?.deviceSetBaseUrl) return safeIpc("Simpan URL backend", () => window.kasirAPI.deviceSetBaseUrl(url));
    return { ok: false, error: "Hanya tersedia di aplikasi desktop" };
  },
  async deviceRegister(opts) {
    if (window.kasirAPI?.deviceRegister) return safeIpc("Daftarkan perangkat", () => window.kasirAPI.deviceRegister(opts));
    return { ok: false, error: "Hanya tersedia di aplikasi desktop" };
  },
  async deviceCheckPairing(opts) {
    if (window.kasirAPI?.deviceCheckPairing) return safeIpc("Cek pairing", () => window.kasirAPI.deviceCheckPairing(opts));
    return { ok: false, error: "Hanya tersedia di aplikasi desktop" };
  },
  async devicePushSync(batch) {
    if (window.kasirAPI?.devicePushSync) return safeIpc("Kirim data sync", () => window.kasirAPI.devicePushSync(batch));
    return { ok: false, error: "Hanya tersedia di aplikasi desktop" };
  },
  async devicePendingCount() {
    if (window.kasirAPI?.devicePendingCount) return safeIpc("Jumlah data tertunda", () => window.kasirAPI.devicePendingCount());
    return 0;
  },
  async kdsSend(tickets) {
    if (window.kasirAPI?.kdsSend) return safeIpc("Kirim tiket KDS", () => window.kasirAPI.kdsSend(tickets));
    return { ok: false, error: "Hanya tersedia di aplikasi desktop" };
  },
  async kdsCancel(sourceRef) {
    if (window.kasirAPI?.kdsCancel) return safeIpc("Batalkan tiket KDS", () => window.kasirAPI.kdsCancel(sourceRef));
    return { ok: false, error: "Hanya tersedia di aplikasi desktop" };
  },
  async kdsStatus() {
    if (window.kasirAPI?.kdsStatus) return safeIpc("Status antrean KDS", () => window.kasirAPI.kdsStatus());
    return { pendingCount: 0, error: null, offline: false };
  },
  async kdsRetry() {
    if (window.kasirAPI?.kdsRetry) return safeIpc("Ulangi pengiriman KDS", () => window.kasirAPI.kdsRetry());
    return { ok: false, error: "Hanya tersedia di aplikasi desktop" };
  },
  async devicePushTransactions() {
    if (window.kasirAPI?.devicePushTransactions) return safeIpc("Kirim transaksi", () => window.kasirAPI.devicePushTransactions());
    return { ok: false, error: "Hanya tersedia di aplikasi desktop" };
  },
  // onDeviceSyncEvent — langganan peringatan hasil auto-sync dari main process.
  // Return fungsi unsubscribe (no-op di browser).
  onDeviceSyncEvent(callback) {
    if (window.kasirAPI?.onDeviceSyncEvent) return window.kasirAPI.onDeviceSyncEvent(callback);
    return () => {};
  },
  async deviceCredential() {
    if (window.kasirAPI?.deviceCredential) return safeIpc("Kredensial perangkat", () => window.kasirAPI.deviceCredential());
    return { ok: false, error: "Hanya tersedia di aplikasi desktop" };
  },
  async deviceRotateCredential() {
    if (window.kasirAPI?.deviceRotateCredential) return safeIpc("Regenerasi kredensial", () => window.kasirAPI.deviceRotateCredential());
    return { ok: false, error: "Hanya tersedia di aplikasi desktop" };
  },
  async deviceSetName(name) {
    if (window.kasirAPI?.deviceSetName) return safeIpc("Ubah nama perangkat", () => window.kasirAPI.deviceSetName(name));
    return { ok: false, error: "Hanya tersedia di aplikasi desktop" };
  },
  // QRIS — simpan terpisah dari settings supaya tidak bloat settings.json
  async loadQris()        { return window.kasirAPI ? await window.kasirAPI.loadQris?.()       : (LS("ykk_qris")||{}); },
  async loadUsers()       { return window.kasirAPI?.loadUsers ? await window.kasirAPI.loadUsers() : (LS("ykk_users")||[]); },
  async saveUsers(list)   { if(window.kasirAPI?.saveUsers) return window.kasirAPI.saveUsers(list); LS("ykk_users",list); },

  // --- Auth (password di-hash scrypt di main process) -----------------------
  // Di browser dev (tanpa Electron) tidak ada main process: verifikasi dilakukan
  // apa adanya terhadap localStorage supaya UI tetap bisa dicoba.
  async authLogin({ username, password } = {}) {
    if (window.kasirAPI?.authLogin) return safeIpc("Login", () => window.kasirAPI.authLogin({ username, password }));
    const users = LS("ykk_users") || [];
    const uname = String(username ?? "").trim();
    const found = users.find(u => String(u?.username ?? "").trim() === uname && u?.password === password);
    if (!found) return { ok: false, reason: "wrong-password" };
    const { password: _pw, ...safeUser } = found;
    return { ok: true, user: safeUser, migrated: false };
  },
  async authCreateUser({ user } = {}) {
    if (window.kasirAPI?.authCreateUser) return safeIpc("Tambah pengguna", () => window.kasirAPI.authCreateUser({ user }));
    const users = LS("ykk_users") || [];
    const uname = String(user?.username ?? "").trim();
    if (!uname || users.some(u => String(u?.username ?? "").trim() === uname)) return { ok: false, reason: "duplicate" };
    LS("ykk_users", [...users, { ...user, username: uname }]);
    return { ok: true };
  },
  async authSetPassword({ username, newPassword } = {}) {
    if (window.kasirAPI?.authSetPassword) return safeIpc("Ubah password", () => window.kasirAPI.authSetPassword({ username, newPassword }));
    const uname = String(username ?? "").trim();
    const users = (LS("ykk_users") || []).map(u => String(u?.username ?? "").trim() === uname ? { ...u, password: newPassword } : u);
    LS("ykk_users", users);
    return { ok: true };
  },
  async authChangePassword({ username, oldPassword, newPassword } = {}) {
    if (window.kasirAPI?.authChangePassword) return safeIpc("Ganti password", () => window.kasirAPI.authChangePassword({ username, oldPassword, newPassword }));
    const uname = String(username ?? "").trim();
    const users = LS("ykk_users") || [];
    const found = users.find(u => String(u?.username ?? "").trim() === uname);
    if (!found || found.password !== oldPassword) return { ok: false, reason: "wrong-password" };
    LS("ykk_users", users.map(u => String(u?.username ?? "").trim() === uname ? { ...u, password: newPassword } : u));
    return { ok: true };
  },
  async loadCustomers()   { return window.kasirAPI?.loadCustomers ? await window.kasirAPI.loadCustomers() : (LS("ykk_customers")||[]); },
  async saveCustomers(list) { if(window.kasirAPI?.saveCustomers) return window.kasirAPI.saveCustomers(list); LS("ykk_customers",list); return { ok: true }; },
  async saveQris(map)     { if(window.kasirAPI?.saveQris) return window.kasirAPI.saveQris(map); LS("ykk_qris",map); },
  async deleteQris(key)   { if(window.kasirAPI?.deleteQris) return window.kasirAPI.deleteQris(key); const m=LS("ykk_qris")||{}; delete m[key]; LS("ykk_qris",m); },
};

export { LS, api, isVoided, nonVoided, healVoidedTrx };