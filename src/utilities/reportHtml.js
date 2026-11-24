// reportHtml.js — pembuat HTML laporan (Fase 1, fitur "Ekspor Laporan PDF").
//
// Fungsi di sini MURNI: menerima angka/array yang sudah dihitung oleh
// ViewLaporan lalu mengembalikan string HTML siap dicetak ke PDF lewat
// ipc "export-report-pdf" (Electron printToPDF + showSaveDialog).
//
// Tidak menyentuh storage, tidak butuh dependensi baru. Layout mengikuti
// lebar kertas resi dan format 210mm tinggi.

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function rupiah(n) {
  return "Rp " + Number(n || 0).toLocaleString("id-ID");
}

function buildReportHTML(opts = {}) {
  const {
    shiftLabel = "",
    cashier = "",
    printedDay = "",
    printedDate = "",
    summary = {},
    paperWidthMm = 80,
  } = opts;
  const width = Math.min(210, Math.max(30, Math.round(Number(paperWidthMm) || 80)));
  const methods = Array.isArray(summary.methods) ? summary.methods : [];
  const methodRows = methods.map((method) =>
    `<div class="kv"><span class="k">${escapeHtml(method.label || method.key)}</span><span class="v">${escapeHtml(rupiah(method.amount))}</span></div>`
  ).join("");

  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8">
<title>LAPORAN OMSET</title>
<style>
  :root { --paper:#fdfdf9; --ink:#1c1c1c; --line:#1c1c1c; --bg:#eceae2; }
  * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; font-weight:700; }
  body { font-family:'Courier New',ui-monospace,Menlo,monospace; font-size:12px; width:${width}mm; padding:3mm; color:var(--ink); background:var(--bg); }
  @media print { @page { size:${width}mm 210mm; margin:0; } body { width:${width}mm; max-width:${width}mm; padding:3mm; background:var(--paper); } }
  .receipt { background:var(--paper); padding:6px 8px 2px; position:relative; }
  .section { position:relative; padding:6px 0; }
  .section + .section { border-top:1px dashed #999; }
  .center { text-align:center; }
  .store-name { font-size:15px; }
  .kv { display:flex; justify-content:space-between; gap:8px; width:100%; min-width:0; font-size:12.5px; margin:2px 0; }
  .kv .k { min-width:0; overflow-wrap:anywhere; }
  .kv .v { min-width:0; max-width:65%; text-align:right; overflow-wrap:anywhere; }
  .period { text-align:center; font-size:11px; margin-top:4px; }
  .methods { margin-top:6px; border-top:1px dashed #999; padding-top:6px; }
  .methods-title { text-align:center; margin-bottom:4px; font-size:12.5px; }
  .totals { margin-top:6px; border-top:1px dashed #999; padding-top:6px; }
  .grand { font-size:14px; padding-top:4px; margin-top:4px; border-top:1px solid var(--line); }
  .footer-note { text-align:center; font-size:11px; margin-top:8px; }
</style></head>
<body>
  <div class="receipt">
    <div class="section header">
      <div class="store-name center">LAPORAN OMSET</div>
      <div class="kv"><span class="k">Hari</span><span class="v">${escapeHtml(printedDay)}</span></div>
      <div class="kv"><span class="k">Tanggal</span><span class="v">${escapeHtml(printedDate)}</span></div>
      <div class="kv"><span class="k">Kasir</span><span class="v">${escapeHtml(cashier)}</span></div>
      <div class="period">${escapeHtml(shiftLabel)}</div>
    </div>
    <div class="section methods">
      <div class="methods-title">Metode Pembayaran</div>
      ${methodRows || '<div class="kv"><span class="k">-</span><span class="v">Rp 0</span></div>'}
      <div class="kv"><span class="k">Hasil Bersih (Subtotal)</span><span class="v">${escapeHtml(rupiah(summary.netSubtotal))}</span></div>
      <div class="kv"><span class="k">Total Biaya Service</span><span class="v">${escapeHtml(rupiah(summary.service))}</span></div>
      <div class="kv"><span class="k">Total Biaya Pajak</span><span class="v">${escapeHtml(rupiah(summary.pajak))}</span></div>
      <div class="kv grand"><span class="k">Total</span><span class="v">${escapeHtml(rupiah(summary.total))}</span></div>
    </div>
    <div class="section totals">
      <div class="kv"><span class="k">Total transaksi</span><span class="v">${escapeHtml(Number(summary.trxCount || 0))}</span></div>
      <div class="kv"><span class="k">Total Pax</span><span class="v">${escapeHtml(Number(summary.pax || 0))}</span></div>
      <div class="kv"><span class="k">Rata-Rata/Pax</span><span class="v">${escapeHtml(rupiah(summary.avgPerPax))}</span></div>
      <div class="kv"><span class="k">Rata-Rata/Transaksi</span><span class="v">${escapeHtml(rupiah(summary.avgPerTrx))}</span></div>
    </div>
    <div class="section">
      <div class="footer-note">Hari cetak : ${escapeHtml(printedDay)}<br/>Tanggal cetak : ${escapeHtml(printedDate)}<br/>Kasir mencetak : ${escapeHtml(cashier)}</div>
      <div class="footer-note">Made by DENPOS</div>
    </div>
  </div>
</body></html>`;
}

export { buildReportHTML, escapeHtml, rupiah };
