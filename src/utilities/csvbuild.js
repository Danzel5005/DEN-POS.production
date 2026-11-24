import { calcPrice } from "./calculations.js";

// Helper to get category label from key
const getCategoryLabel = (catKey, categories = []) => {
  if (!catKey) return "Lainnya";
  if (categories && categories.length) {
    const found = categories.find(c => c.key === catKey);
    if (found) return found.label;
  }
  return catKey;
};

// Helper to get payment method label from key
const getPaymentMethodLabel = (key, paymentMethods = [], fallbackLabel = "") => {
  const normalizedKey = key || "cash";
  if (paymentMethods && paymentMethods.length) {
    const found = paymentMethods.find(m => String(m.key || "").trim() === String(normalizedKey).trim());
    if (found?.label) return found.label;
  }
  if (fallbackLabel && String(fallbackLabel).trim()) return String(fallbackLabel).trim();

  try {
    const savedSettings = JSON.parse(localStorage.getItem("ykk_settings") || "{}");
    const savedMethods = Array.isArray(savedSettings?.paymentMethods) ? savedSettings.paymentMethods : [];
    const foundSaved = savedMethods.find(m => String(m.key || "").trim() === String(normalizedKey).trim());
    if (foundSaved?.label) return foundSaved.label;
  } catch (_) {
    // ignore localStorage access errors in non-browser/test contexts
  }

  // Fallback to defaults
  const defaults = {
    "cash": "Tunai",
    "debit-bca": "Debit BCA",
    "debit-bni": "Debit BNI",
    "qris-bca": "QRIS BCA",
    "qris-bni": "QRIS BNI",
    "transfer-bca": "Debit BCA",
    "qris": "QRIS BCA"
  };
  return defaults[normalizedKey] ?? String(normalizedKey).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

function csvByDay(trxs, header, rowFn, at) {
  const byDay = {};
  [...trxs].sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp)).forEach(t=>{
    const k=`${t.hari}, ${t.tgl} ${t.bln} ${t.thn}`;
    if(!byDay[k]) byDay[k]=[];
    byDay[k].push(t);
  });
  const sections = Object.entries(byDay).map(([day,dayTrx])=>{
    const rows = dayTrx.flatMap(t=>rowFn(t,at));
    return [`===== ${day} =====`, header, ...rows, ""].join("\n");
  });
  return sections.join("\n");
}

const TRX_HEADER = "No.Trx,Hari,Tanggal,Jam,Metode,Nama Item,Kategori,Qty,Harga Jual,Modal,Subtotal Jual,Subtotal Modal,Laba Item,Subtotal Trx,Diskon Trx,Hasil Bersih (Subtotal),Total Biaya Service,Total Biaya Pajak,Total Trx,Bayar,Kembalian,Status,Alasan Void,Waktu Unduh";
function trxRow(t, at, categories = [], paymentMethods = []) {
  const total = Number(t.total ?? calcPrice(t.subtotal).total);
  const netSubtotal = Number(t.subtotal || 0);
  const isVoid = t.status === "voided" || t.voided === true;
  const statusLabel = isVoid ? "VOID" : "LUNAS";
  const voidReason = isVoid ? (t.voidReason || "") : "";
  return t.items.map(item=>{
    const subJ=item.harga*item.qty; const subM=(item.modal||0)*item.qty;
    const metodeLabel = getPaymentMethodLabel(t.metodeBayar || "cash", paymentMethods, t.metodeBayarLabel);
    const catLabel = getCategoryLabel(item.kategori, categories);
    return [t.id,t.hari,`${t.tgl} ${t.bln} ${t.thn}`,`${t.jam}:${t.mnt}:${t.dtk}`,metodeLabel,`"${item.nama}"`,catLabel,item.qty,item.harga,item.modal||0,subJ,subM,subJ-subM,t.subtotal,t.discount||0,netSubtotal,t.service||0,t.pajak||0,total,t.bayar||0,t.kembalian||0,statusLabel,voidReason,at].join(",");
  });
}

const LAP_HEADER = "Hari,Tanggal,Jumlah Trx,Pendapatan Kotor (Rp),Total Bersih (Rp),Total Modal Item (Rp),Laba Kotor (Rp),Kas Awal (Rp),Total Pengeluaran (Rp),Kas Akhir (Rp),Laba Bersih (Rp),Keterangan,Waktu Unduh";
function lapRow(t) { return [t]; } // placeholder, grouped below

function csvLaporan(trxs, at, meta = {}) {
  const byDay={};
  const shiftTotals = new Map((meta.shifts || []).map((shift) => [shift.id, shift]));

  trxs.forEach(t=>{
    const k=`${t.hari}||${t.tgl} ${t.bln} ${t.thn}`;
    if(!byDay[k]) byDay[k]={hari:t.hari,tgl:`${t.tgl} ${t.bln} ${t.thn}`,trx:0,pendapatan:0,modal:0,shifts:new Set()};
    byDay[k].trx++;
    byDay[k].pendapatan+=Number(t.total)||0;
    if (t.shiftId != null) byDay[k].shifts.add(t.shiftId);
    t.items.forEach(i=>{byDay[k].modal+=(i.modal||0)*i.qty;});
  });

  const rows=Object.values(byDay).map(d=>{
    const totalRevenue = d.pendapatan;
    const grossProfit = totalRevenue - d.modal;
    const shifts = [...d.shifts].map((id) => shiftTotals.get(id)).filter(Boolean);
    const openingCash = shifts.reduce((sum, shift) => sum + (Number(shift.openingCash) || 0), 0);
    const totalExpenses = shifts.reduce((sum, shift) => sum + (shift.expenses || []).reduce((inner, item) => inner + (Number(item.jumlah) || 0), 0), 0);
    const cashFinal = openingCash + totalRevenue - totalExpenses;
    const ket = d.modal === 0 ? "Modal belum diinput" : cashFinal >= 0 ? "LABA" : "RUGI";
    return [d.hari,d.tgl,d.trx,d.pendapatan,totalRevenue,d.modal,grossProfit,openingCash,totalExpenses,cashFinal,grossProfit-totalExpenses,ket,at].join(",");
  });

  const tot={trx:0,pend:0,mod:0};
  trxs.forEach(t=>{tot.trx++;tot.pend+=Number(t.total)||0;t.items.forEach(i=>{tot.mod+=(Number(i.modal)||0)*(Number(i.qty)||0);});});
  const allShifts = [...new Set(trxs.map((t) => t.shiftId).filter((id) => id != null))].map((id) => shiftTotals.get(id)).filter(Boolean);
  const openingCash = allShifts.length ? allShifts.reduce((sum, shift) => sum + (Number(shift.openingCash) || 0), 0) : Number(meta.openingCash) || 0;
  const totalExpenses = allShifts.length ? allShifts.reduce((sum, shift) => sum + (shift.expenses || []).reduce((inner, item) => inner + (Number(item.jumlah) || 0), 0), 0) : Number(meta.totalExpenses) || 0;
  const totGross = tot.pend;
  const totGrossProfit = totGross - tot.mod;
  const totCashFinal = openingCash + totGross - totalExpenses;
  const totNetProfit = totGrossProfit - totalExpenses;
  rows.push(["TOTAL","",tot.trx,tot.pend,totGross,tot.mod,totGrossProfit,openingCash,totalExpenses,totCashFinal,totNetProfit,tot.mod===0?"Modal belum diinput":totCashFinal>=0?"LABA":"RUGI",at].join(","));
  return [LAP_HEADER,...rows].join("\n");
}

function csvSalesRate(trxs, menuList, at) {
  const map={};
  menuList.forEach(m=>{ map[m.nama]={nama:m.nama,qty:0,rev:0,modal:0}; });
  trxs.forEach(t=>{t.items.forEach(i=>{
    if(!map[i.nama]) map[i.nama]={nama:i.nama,qty:0,rev:0,modal:0};
    map[i.nama].qty+=i.qty; map[i.nama].rev+=i.harga*i.qty; map[i.nama].modal+=(i.modal||0)*i.qty;
  });});
  const sorted=Object.values(map).sort((a,b)=>b.qty-a.qty);
  const h="Peringkat,Nama Menu,Total Qty,Pendapatan (Rp),Modal (Rp),Laba (Rp),Status,Waktu Unduh";
  const rowsFn=(list)=>list.map((m,i)=>[i+1,`"${m.nama}"`,m.qty,m.rev,m.modal,m.rev-m.modal,m.qty===0?"BELUM TERJUAL":"Terjual",at].join(","));
  const top10=sorted.slice(0,10); const bot10=[...sorted].reverse().slice(0,10);
  const unsold=sorted.filter(m=>m.qty===0);
  return [
    "TOP 10 MENU TERLAKU", h, ...rowsFn(top10), "",
    "TOP 10 MENU PALING SEDIKIT TERJUAL", h, ...rowsFn(bot10), "",
    "MENU BELUM TERJUAL SAMA SEKALI", h, ...rowsFn(unsold),
  ].join("\n");
}

function csvPerMenu(trxs, menuList, at, categories = []) {
  const h="Nama Menu,Kategori,Harga Jual,Modal,Total Qty,Pendapatan,Total Modal,Laba,Margin (%),Status,Waktu Unduh";
  const map={};
  trxs.forEach(t=>{t.items.forEach(i=>{
    if(!map[i.nama]) map[i.nama]={qty:0,rev:0,modal:0};
    map[i.nama].qty+=i.qty; map[i.nama].rev+=i.harga*i.qty; map[i.nama].modal+=(i.modal||0)*i.qty;
  });});
  const rows=menuList.map(m=>{
    const d=map[m.nama]||{qty:0,rev:0,modal:0};
    const laba=d.rev-d.modal; const margin=d.rev>0?((laba/d.rev)*100).toFixed(1):"N/A";
    const status=d.qty===0?"Belum Terjual":"Terjual";
    const catLabel = getCategoryLabel(m.kategori, categories);
    return [`"${m.nama}"`,catLabel,m.harga,m.modal||0,d.qty,d.rev,d.modal,laba,margin,status,at].join(",");
  });
  const subtotalTotal = trxs.reduce((sum, trx) => sum + (Number(trx.subtotal) || 0), 0);
  const discountTotal = trxs.reduce((sum, trx) => sum + (Number(trx.discount) || 0), 0);
  const serviceTotal = trxs.reduce((sum, trx) => sum + (Number(trx.service) || 0), 0);
  const pajakTotal = trxs.reduce((sum, trx) => sum + (Number(trx.pajak) || 0), 0);
  return [h,...rows,"","RINGKASAN TRANSAKSI","Komponen,Total (Rp)",`Hasil Bersih (Subtotal),${subtotalTotal}`,`Total Diskon,${discountTotal}`,`Total Biaya Service,${serviceTotal}`,`Total Biaya Pajak,${pajakTotal}`].join("\n");
}

// Stock Report CSV - Laporan Stok
function csvStok(menuList, categories = [], at) {
  const h = "Nama Menu,Kategori,Harga Jual,Modal,Stok Tersedia,Status,Waktu Unduh";
  const rows = menuList.map(m => {
    const catLabel = getCategoryLabel(m.kategori, categories);
    const stok = m.stok === null ? "Tidak Dibatasi" : String(m.stok || 0);
    const status = m.stok === null ? "Tidak Dibatasi" : (m.stok <= 0 ? "HABIS" : m.stok <= 5 ? "RENDAH" : "TERSEDIA");
    return [`"${m.nama}"`, catLabel, m.harga, m.modal || 0, stok, status, at].join(",");
  });
  return [h, ...rows].join("\n");
}

function csvMetodeBayar(trxs, at, paymentMethods = []) {
  const normalize = m => {
    if (!m || typeof m !== "string") return "cash";
    return m === "transfer-bca" ? "debit-bca" : m === "qris" ? "qris-bca" : m;
  };

  const seenMethods = new Set();
  trxs.forEach(t => {
    const key = normalize(t.metodeBayar);
    seenMethods.add(key);
  });

  const METHODS = [
    ...new Set([
      ...paymentMethods.map(m => normalize(m.key)),
      ...Array.from(seenMethods),
      "cash",
      "debit-bca",
      "debit-bni",
      "qris-bca",
      "qris-bni",
    ])
  ];

  const LABELS_M = Object.fromEntries([
    ...paymentMethods.map(m => [normalize(m.key), m.label]),
    ...trxs.map(t => [normalize(t.metodeBayar), getPaymentMethodLabel(t.metodeBayar, paymentMethods, t.metodeBayarLabel)])
  ]);

  const getLabel = (key) => LABELS_M[key] ?? getPaymentMethodLabel(key, paymentMethods);

  // Per hari per metode
  const byDay = {};
  trxs.forEach(t => {
    const k = `${t.hari}||${t.tgl} ${t.bln} ${t.thn}`;
    const m = normalize(t.metodeBayar);
    if(!byDay[k]) byDay[k] = {hari:t.hari, tgl:`${t.tgl} ${t.bln} ${t.thn}`, data:{}};
    if(!byDay[k].data[m]) byDay[k].data[m] = {trx:0,total:0};
    byDay[k].data[m].trx++;
    byDay[k].data[m].total += t.total;
  });

  const h = "Hari,Tanggal,Metode Bayar,Jumlah Trx,Total Pendapatan (Rp),Waktu Unduh";
  const rows = [];
  Object.values(byDay).forEach(day => {
    METHODS.forEach(m => {
      const d = day.data[m];
      if(d) rows.push([day.hari, day.tgl, getLabel(m), d.trx, d.total, at].join(","));
    });
    rows.push("");
  });

  // Ringkasan total
  const sumRows = METHODS.map(m => {
    const filtered = trxs.filter(t => normalize(t.metodeBayar)===m);
    const tot = filtered.reduce((s,t)=>s+t.total,0);
    return ["TOTAL","Semua Hari", getLabel(m), filtered.length, tot, at].join(",");
  });
  const grandTotal = trxs.reduce((s,t)=>s+t.total,0);
  sumRows.push(["GRAND TOTAL","","Semua Metode",trxs.length,grandTotal,at].join(","));

return ["=== DETAIL PER HARI ===", h, ...rows, "=== RINGKASAN TOTAL ===", h, ...sumRows].join("\n");
}




// Restock Report CSV — daftar belanja untuk item yang habis / stok menipis.
function csvRestock(restockRows = [], at) {
  const h = "Nama Menu,Kategori,Stok Saat Ini,Status,Saran Restock (Qty),Waktu Unduh";
  const rows = restockRows.map((r) => {
    const status = r.level === "out" ? "HABIS" : "STOK MENIPIS";
    return [`"${r.nama}"`, r.kategori || "", r.stok, status, r.suggestQty, at].join(",");
  });
  return [h, ...rows].join("\n");
}

export {csvByDay,TRX_HEADER, LAP_HEADER, csvLaporan, csvSalesRate, csvPerMenu, csvMetodeBayar, csvStok, csvRestock, trxRow};