// reportHtml.js — pembuat HTML laporan (Fase 1, fitur "Ekspor Laporan PDF").
//
// Fungsi di sini MURNI: menerima angka/array yang sudah dihitung oleh
// ViewLaporan lalu mengembalikan string HTML siap dicetak ke PDF lewat
// ipc "export-report-pdf" (Electron printToPDF + showSaveDialog).
//
// Tidak menyentuh storage, tidak butuh dependensi baru. Layout memakai
// ukuran A4 (210mm x 297mm) dengan margin cetak.

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
  } = opts;
  const methods = Array.isArray(summary.methods) ? summary.methods : [];
  const methodRows = methods.map((method) =>
    `<div class="method"><span>${escapeHtml(method.label || method.key)}</span><strong>${escapeHtml(rupiah(method.amount))}</strong></div>`
  ).join("");

  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8">
<title>LAPORAN OMSET</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #222; margin: 0; font-size: 12px; }
  h1 { font-size: 20px; margin: 0 0 18px; text-align: center; }
  .info, .method, .summary-row { display: flex; justify-content: space-between; gap: 12px; }
  .info { margin: 3px 0; }
  .period { margin: 12px 0 18px; font-size: 10px; color: #666; }
  h2 { font-size: 13px; margin: 18px 0 8px; }
  .method { padding: 5px 0; border-bottom: 1px dotted #ccc; }
  .method strong { white-space: nowrap; }
  .total { display: flex; justify-content: space-between; font-weight: 700; padding: 7px 0; border-top: 1px solid #222; }
  .summary { margin-top: 16px; }
  .summary-row { padding: 5px 0; }
  .footer { margin-top: 32px; }
  .footer div { margin: 3px 0; }
</style></head>
<body>
  <h1>LAPORAN OMSET</h1>
  <div class="info"><span>Hari</span><strong>${escapeHtml(printedDay)}</strong></div>
  <div class="info"><span>Tanggal</span><strong>${escapeHtml(printedDate)}</strong></div>
  <div class="info"><span>Kasir</span><strong>${escapeHtml(cashier)}</strong></div>
  <div class="period">${escapeHtml(shiftLabel)}</div>
  <h2>Metode Pembayaran</h2>
  ${methodRows || '<div class="method"><span>-</span><strong>Rp 0</strong></div>'}
  <div class="total"><span>Total</span><strong>${escapeHtml(rupiah(summary.total))}</strong></div>
  <div class="summary">
    <div class="summary-row"><span>Total transaksi</span><strong>${escapeHtml(Number(summary.trxCount || 0))}</strong></div>
    <div class="summary-row"><span>Total Pax</span><strong>${escapeHtml(Number(summary.pax || 0))}</strong></div>
    <div class="summary-row"><span>Rata-Rata/Pax</span><strong>${escapeHtml(rupiah(summary.avgPerPax))}</strong></div>
    <div class="summary-row"><span>Rata-Rata/Transaksi</span><strong>${escapeHtml(rupiah(summary.avgPerTrx))}</strong></div>
  </div>
  <div class="footer">
    <div>Hari cetak : ${escapeHtml(printedDay)}</div>
    <div>Tanggal cetak : ${escapeHtml(printedDate)}</div>
    <div>Kasir mencetak : ${escapeHtml(cashier)}</div>
  </div>
</body></html>`;
}

export { buildReportHTML, escapeHtml, rupiah };
