// insights.js — analitik penjualan turunan (Fase 1).
//
// Semua fungsi di sini MURNI: hanya membaca transaksi yang sudah tersimpan,
// tidak menyentuh storage, tidak butuh AI, tidak butuh dependensi baru. Ini
// yang mengalahkan klaim "AI" kompetitor dengan SQL sederhana.

import { isVoided } from "./utils.js";

// Jam dari transaksi. `t.jam` adalah string "HH" dari getNow(); kalau hilang,
// turunkan dari timestamp ISO supaya data lama tetap terhitung.
function hourOf(trx) {
  const j = Number(trx?.jam);
  if (Number.isFinite(j) && j >= 0 && j <= 23) return j;
  const ts = trx?.timestamp ? new Date(trx.timestamp) : null;
  if (ts && !Number.isNaN(ts.getTime())) return ts.getHours();
  return null;
}

// peakHours — distribusi transaksi & pendapatan per jam (0-23).
// Voided dikecualikan supaya jam ramai mencerminkan penjualan nyata.
// Return: array 24 entri { hour, label, count, revenue } + jam puncak.
function peakHours(transactions = []) {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    count: 0,
    revenue: 0,
  }));

  for (const trx of Array.isArray(transactions) ? transactions : []) {
    if (isVoided(trx)) continue;
    const h = hourOf(trx);
    if (h === null) continue;
    buckets[h].count += 1;
    buckets[h].revenue += Number(trx.total || 0);
  }

  let busiest = null;
  for (const b of buckets) {
    if (b.count > 0 && (!busiest || b.count > busiest.count)) busiest = b;
  }

  return { buckets, busiest, hasData: buckets.some((b) => b.count > 0) };
}

// averageOrder — rata-rata nilai transaksi, plus jumlah transaksi.
// Dihitung dalam satu lintasan, bukan reduce terpisah bertumpuk.
function averageOrder(transactions = []) {
  const list = (Array.isArray(transactions) ? transactions : []).filter((t) => !isVoided(t));
  if (!list.length) return { count: 0, revenue: 0, average: 0 };
  const revenue = list.reduce((sum, t) => sum + Number(t.total || 0), 0);
  return { count: list.length, revenue, average: revenue / list.length };
}

// paymentMix — pendapatan per metode bayar, terurut dari terbesar.
// `labelOf(key)` dipetakan oleh pemanggil (settings label) supaya util ini
// tidak bergantung pada konfigurasi settings.
function paymentMix(transactions = [], labelOf = (k) => k) {
  const map = new Map();
  for (const trx of Array.isArray(transactions) ? transactions : []) {
    if (isVoided(trx)) continue;
    const key = String(trx?.metodeBayar || "cash");
    const entry = map.get(key) || { key, label: labelOf(key), count: 0, revenue: 0 };
    entry.count += 1;
    entry.revenue += Number(trx.total || 0);
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

// Ringkasan omset tunggal untuk PDF dan cetak thermal.
// Basis penjualan adalah t.total, bukan jumlah yang dibayar.
function buildOmsetSummary(transactions = [], { labelOf = (k) => k } = {}) {
  const methodsMap = new Map();
  let total = 0;
  let netSubtotal = 0;
  let service = 0;
  let pajak = 0;
  let trxCount = 0;
  let pax = 0;

  for (const trx of Array.isArray(transactions) ? transactions : []) {
    if (isVoided(trx)) continue;
    const amount = Number(trx?.total || 0);
    const key = String(trx?.metodeBayar || "cash").trim() || "cash";
    const entry = methodsMap.get(key) || { key, label: labelOf(key), amount: 0, count: 0 };
    entry.amount += amount;
    entry.count += 1;
    methodsMap.set(key, entry);
    total += amount;
    netSubtotal += Number(trx?.subtotal || 0);
    service += Number(trx?.service || 0);
    pajak += Number(trx?.pajak || 0);
    trxCount += 1;
    pax += Math.max(0, Math.floor(Number(trx?.pax) || 0));
  }

  const methods = [...methodsMap.values()].sort((a, b) =>
    b.amount - a.amount || a.label.localeCompare(b.label, "id")
  );

  return {
    methods,
    total,
    netSubtotal,
    service,
    pajak,
    trxCount,
    pax,
    avgPerPax: pax > 0 ? total / pax : 0,
    avgPerTrx: trxCount > 0 ? total / trxCount : 0,
  };
}

// topItems — item terlaris berdasarkan qty, dengan pendapatan.
function topItems(transactions = [], limit = 5) {
  const map = new Map();
  for (const trx of Array.isArray(transactions) ? transactions : []) {
    if (isVoided(trx)) continue;
    for (const item of trx.items || []) {
      const nama = item?.nama;
      if (!nama) continue;
      const qty = Number(item.qty || 0);
      const entry = map.get(nama) || { nama, qty: 0, revenue: 0 };
      entry.qty += qty;
      entry.revenue += qty * Number(item.harga || 0);
      map.set(nama, entry);
    }
  }
  return [...map.values()].sort((a, b) => b.qty - a.qty).slice(0, limit);
}

// buildInsights — satu panggilan yang merangkum semuanya untuk ViewLaporan.
function buildInsights(transactions = [], { labelOf } = {}) {
  const { buckets, busiest, hasData } = peakHours(transactions);
  const average = averageOrder(transactions);
  return {
    hasData,
    busiest,
    peak: { buckets, busiest },
    average,
    mix: paymentMix(transactions, labelOf),
    top: topItems(transactions, 5),
  };
}

export { peakHours, averageOrder, paymentMix, buildOmsetSummary, topItems, buildInsights };
