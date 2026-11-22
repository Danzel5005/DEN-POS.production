# Prompt Copilot — Redesign "Ekspor PDF" menjadi LAPORAN OMSET + Cetak Printer Resi

> **Cara pakai**
> 1. Buka repo `DEN-POS.production` di VS Code, mode **Agent** di Copilot Chat.
> 2. Pilih agent **Engineer** (`Engineer.agent.md`) — ini fitur baru.
> 3. Attach: **`Template_Laporan_Perhari.pdf`** (template visual). File kode lain TIDAK perlu di-attach, Copilot membacanya dari repo lewat path di bawah.
> 4. Paste seluruh isi di bawah garis ini.

---

## Tugas

Ubah fitur **"Ekspor PDF"** di halaman Laporan (`src/views/ViewLaporan.jsx`) supaya hasilnya mengikuti template `Template_Laporan_Perhari.pdf` (judul **LAPORAN OMSET**), lalu tambahkan opsi **cetak ke printer resi (thermal)** dengan isi yang sama.

Ikuti urutan kerja Engineer Agent: pahami sistem → cek UX → blast radius → scalability check → **laporkan risiko/konflik SEBELUM coding** → implementasi → laporan akhir.

## Kondisi kode saat ini (sudah diverifikasi, jangan ditebak ulang)

| Bagian | Lokasi | Catatan |
|---|---|---|
| Tombol & handler | `src/views/ViewLaporan.jsx` → `handleExportPdf`, tombol "Ekspor PDF" (dibungkus `showPdfReport` = fitur lanjutan `pdfReport`) | Memanggil `buildReportHTML(...)` lalu `api.exportReportPdf({ html, defaultName })` |
| Pembuat HTML | `src/utilities/reportHtml.js` → `buildReportHTML`, `escapeHtml`, `rupiah` | Fungsi murni, layout A4 berupa kartu ringkasan + analitik. Ada tes di `reportHtml.test.js` |
| IPC PDF | `electron/printing.cjs` → `ipcMain.handle("export-report-pdf")` | `printToPDF` A4 + `showSaveDialog` |
| Preload | `electron/preload.js` → `exportReportPdf`, `printReceiptEscPos`, `getPrinters` | Semua IPC baru wajib didaftarkan di sini |
| Cetak thermal struk | `electron/printing.cjs` → `print-receipt-escpos`, `buildEscPosReceipt`, `charsPerLineForWidth` (58mm=32 kolom, 80mm=42 kolom) | Pakai `node-thermal-printer` (EPSON, ESC/POS) |
| Deteksi jenis printer | `src/utilities/printer.js` → `getPrinterSelectionStatus(name)` → `isThermal / isPdf / system` | Printer dipilih di `settings.printerName`, lebar kertas `settings.receiptPaperWidthMm` |
| Contoh alur cetak thermal | `src/App.jsx` → `printReceipt` | Cabang thermal → `window.api.printReceiptEscPos`; PDF/system → `settingsH.printHTML` |
| Data laporan | `ViewLaporan.jsx` → `shiftTrx` dari `loadAllForReport(reportShiftId)` | **Data penuh satu shift/semua shift (bukan halaman paginasi), transaksi void sudah dibuang via `isVoided`** |
| Field transaksi | `t.total`, `t.metodeBayar` (key), `t.metodeBayarLabel`, `t.pax`, `t.operator`, `t.hari/tgl/bln/thn/jam/mnt/dtk` | Label metode: `labelOf(key)` di ViewLaporan (pakai `paymentMethods` settings) |
| User login | `currentUser.username`, `currentUser.nama` (props sudah masuk ke `ViewLaporan`) | |
| Helper yang sudah ada | `insights.js` → `paymentMix`, `averageOrder` | Dasar hitung **berbeda** dari `rev` (lihat Risiko #1) |

## Spesifikasi template (dibaca dari PDF; ini yang harus tampil)

Judul: **LAPORAN OMSET**

1. **Header**: `Hari`, `Tanggal`, `Kasir`
   - Hari & Tanggal = **waktu laporan diekspor/dicetak** (hari dalam bahasa Indonesia, mis. "Minggu", dan tanggal "22 November 2026").
   - Kasir = **username user yang sedang login dan mengekspor/mencetak** (`currentUser.username`).
   - Tambahkan satu baris kecil periode laporan (`shiftLabel`) supaya jelas data shift mana — ini satu-satunya tambahan di luar template.
2. **Bagian "Metode Pembayaran"** (label `Table :` di template = tabel/daftar ini): satu baris per metode bayar yang **benar-benar dipakai** pada periode itu, `nama metode ........ jumlah rupiah`, diurutkan dari terbesar.
   - Baris penutup **Total** = jumlah seluruh metode.
3. **Ringkasan**:
   - Total transaksi
   - Total Pax
   - Rata-Rata/Pax = Total omset ÷ Total Pax
   - Rata-Rata/Transaksi = Total omset ÷ Total transaksi
4. **Footer**: hari cetak, tanggal cetak, username yang mencetak (sesuai tiga baris terakhir template).

Aturan hitung:
- Pembagian dengan nol (pax = 0 atau transaksi = 0) → tampilkan `Rp 0`, jangan `NaN`/`Infinity`.
- Pax = `Number(t.pax) || 0` (data lama tanpa pax tetap aman).
- Format rupiah: pakai `rupiah()` dari `reportHtml.js` (format `id-ID`). Jangan buat formatter baru.

## Yang harus dibangun

### 1) Ekspor PDF mengikuti template
- Ganti isi `buildReportHTML` agar menghasilkan layout **LAPORAN OMSET** di atas (A4). Boleh ganti signature opsinya, tapi **cari semua pemanggil dulu** (`ViewLaporan.jsx`, `reportHtml.test.js`) dan perbarui.
- Kartu Total Modal / Laba Bersih / HPP / Analitik lama **tidak ada di template** → jangan tampilkan di laporan ini. Jangan hapus data/hitungannya di `ViewLaporan` (masih dipakai UI lain); cukup tidak dikirim ke HTML laporan.
- Semua teks dinamis wajib lewat `escapeHtml`.
- `export-report-pdf` di `printing.cjs` **tidak perlu diubah** kecuali memang terbukti perlu.

### 2) Perhitungan dipisah jadi fungsi murni
- Buat **satu** fungsi murni (mis. `buildOmsetSummary(transactions, { labelOf })` di `src/utilities/` — cek dulu apakah lebih cocok ditaruh di `insights.js`) yang mengembalikan:
  `{ methods: [{ key, label, amount, count }], total, trxCount, pax, avgPerPax, avgPerTrx }`
- **Satu sumber data** dipakai oleh PDF **dan** cetak thermal, supaya angka keduanya tidak bisa berbeda.
- Wajib ada test (vitest, pola sama dengan `reportHtml.test.js`): beberapa metode, pax 0, tanpa transaksi, transaksi void tidak ikut, jumlah metode == total.

### 3) Cetak ke printer resi (thermal)
- Tambah tombol **"Cetak Laporan"** di sebelah "Ekspor PDF" di `ViewLaporan.jsx`, dengan state loading + toast sukses/gagal seperti `handleExportPdf`.
- Tambah IPC **baru** `print-report-escpos` di `electron/printing.cjs` (dan daftarkan di `electron/preload.js`). **Jangan memodifikasi** `print-receipt-escpos`, `buildEscPosReceipt`, `print-receipt`, `injectReceiptPrintCSS`, maupun `executeEscPosInChunks` — jalur ESC/POS dan jalur HTML adalah dua jalur independen; perubahan di satu tidak boleh menyentuh yang lain.
- Printer & lebar kertas diambil dari `settings.printerName` dan `settings.receiptPaperWidthMm` (sama seperti `printReceipt` di `App.jsx`). Logika cabang:
  - `getPrinterSelectionStatus(...).isThermal` → ESC/POS via IPC baru (struk teks 58mm/80mm, rata kiri-kanan pakai `printer.leftRight`, garis pembatas `drawLine`, lalu `cut`).
  - `isPdf` atau printer sistem biasa → fallback ke jalur HTML/Ekspor PDF yang sudah ada (jangan menulis jalur ketiga).
  - Printer belum dipilih → toast yang jelas ("Pilih printer di Pengaturan Printer"), bukan error mentah.
- Isi struk thermal = isi template yang sama (LAPORAN OMSET, Hari/Tanggal/Kasir, daftar metode, Total, Total transaksi, Total Pax, Rata-Rata/Pax, Rata-Rata/Transaksi, footer). Nama metode panjang harus dipotong/dibungkus sesuai `charsPerLineForWidth`, jangan meluap.
- Gunakan pola error handling & pesan "Printer tidak ditemukan" yang sudah ada di handler struk.

### 4) Hak akses & gating
- Tombol baru mengikuti gating yang sama dengan "Ekspor PDF" (`showPdfReport`), kecuali kamu menemukan alasan kuat lain — kalau berbeda, sebutkan di laporan.
- Jangan membuka data modal/laba (`canViewCost`) di laporan ini; laporan omset hanya berisi angka penjualan.

## Risiko yang HARUS dibahas Copilot sebelum coding

1. **Basis angka berbeda.** `rev` di `ViewLaporan` (Total Pendapatan di layar) dihitung dari `paidOf(t)` (dibayar, dibatasi ≤ total), sedangkan `insights.paymentMix` memakai `t.total`. Pilih **satu** basis untuk LAPORAN OMSET (rekomendasi: `t.total`, karena ini "omset") dan jelaskan kalau angkanya bisa berbeda dari "Total Pendapatan" di layar pada transaksi kurang bayar.
2. **Paginasi.** Jangan hitung dari `history` (hanya satu halaman, maks 100). Pakai `shiftTrx` dari `loadAllForReport`.
3. **Duplikasi implementasi lintas proses** (renderer vs `electron/*.cjs`) pernah menyebabkan bug label. Format teks thermal dibuat di sisi main process dari data ringkasan yang dikirim renderer — **jangan** menghitung ulang total di main process.
4. Jalur cetak thermal vs HTML: pastikan perubahan tidak menyentuh fix yang sudah ada.

Kalau ada konflik UX/scalability, **berhenti dan laporkan dulu** sebelum implementasi.

## Kriteria selesai

- [ ] PDF hasil ekspor sesuai template: Hari/Tanggal, Kasir (username pengekspor), tiap metode + Total, Total transaksi, Total Pax, Rata-Rata/Pax, Rata-Rata/Transaksi.
- [ ] Cetak thermal 58mm & 80mm tidak meluap, ter-cut normal, isi identik dengan PDF.
- [ ] Angka PDF == angka thermal (satu fungsi hitung).
- [ ] State loading/gagal/sukses jelas; tidak ada klik ganda yang mencetak dua kali.
- [ ] Tes vitest baru lulus dan seluruh tes lama tetap lulus (`npm test` / vitest).
- [ ] Tidak ada perubahan perilaku di jalur cetak struk dan fitur diskon.

## Laporan akhir (wajib, format Engineer Agent)

Daftar file yang diubah, keputusan basis angka (risiko #1), perubahan perilaku yang disengaja, hasil tes, dan hal yang belum bisa diverifikasi tanpa printer fisik (Epson TM-T82X).
