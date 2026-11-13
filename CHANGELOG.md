# Changelog

All notable changes to this project are documented in this file.

## v1.4.2 — Perubahan sejak v1.3.0

### Fitur Baru dan Penyempurnaan

- **Kitchen Display System (KDS):** tampilan pesanan dapur dan pengiriman tiket
  dari kasir ke perangkat KDS melalui pairing Sync Cloud.
- **Pertukaran stok:** inbox restock untuk menerima atau menolak permintaan
  stok dari perangkat/toko lain, dengan konfirmasi status ke cloud.
- **Presensi dan hak akses:** pertukaran data presensi serta kontrol akses
  berbasis peran.
- **Monitoring Web:** dashboard web untuk melihat data sinkronisasi dan
  mengelola perangkat yang terhubung; backend monitoring menggunakan Supabase.
- **Android POS (uji coba):** wrapper Android untuk POS dengan dukungan printer
  thermal Bluetooth. Fitur khusus Electron, termasuk backup dan Sync Cloud,
  belum tersedia pada build Android.

### Perbaikan Bug

- Memperbaiki tampilan kode pairing Sync Cloud agar langsung terlihat setelah
  pendaftaran berhasil, tanpa bergantung pada status pengiriman transaksi.
- Kode pairing tetap ditampilkan selama perangkat menunggu persetujuan; polling
  status "belum dipasangkan" tidak lagi menghapus kode sebelum kedaluwarsa.
- Memperbaiki pemetaan label status/kategori pada monitoring KDS dan mencegah
  render ulang berulang pada antrean tiket KDS.
- Memperbaiki pencetakan struk pada sebagian perangkat Android.

## v1.2.1-D

Rilis perbaikan kedua dan penyempurnaan setelah v1.2.0. Berfokus pada stabilitas fitur lanjutan, pengalaman pengguna (search bar, dropdown, modal), diskon loyalty tier, kustomisasi resi, serta perbaikan import Excel dan backup.

### Ringkasan

- **Baseline:** `v1.2.0` (commit `359b7ec7`, 21 Sep 2026)
- **HEAD saat dokumen ini ditulis:** `a2d24bd4` (commit "HOLY PUSH: UX
  Improvements, search bars on everythang, fitur lanjutan also now included in
  backups", 23 Sep 2026)
- **Rentang:** 23 commit
- **Total perubahan:** 111 file berubah (di luar `node_modules` dan artifact
  rilis) dengan sekitar +6.989 / -3.289 baris

---

### Fitur Baru

#### Fitur Tingkat Lanjut (Advanced Features)

- Master switch "Nyalakan Fitur Tingkat Lanjut" di Settings, dengan sub-flag
  terpisah: `insights`, `pdfReport`, `cashFlow`, `loyalty`, `bahanBaku`,
  `supplier`, `canViewCost`, dan `resepHpp`.
- Halaman **Fitur Lanjutan** tersendiri, hanya tampil saat master switch aktif
  dan hanya bisa diakses admin (hotkey `F` di header).
- Mematikan master switch tidak menghapus sub-flag, hanya menggerbangi
  penggunaannya.
- Implementasi: `src/constants/advancedFeatures.js`,
  `src/hooks/settings/advancedFeatures.js`, `src/views/ViewFiturLanjutan.jsx`,
  serta integrasi pada `App.jsx`, `Header.jsx`, dan `ModalStack.jsx`.

#### Resep dan HPP Otomatis

- HPP (harga modal) menu dihitung dari komposisi bahan baku x harga satuan,
  bukan lagi input manual.
- Data resep disimpan pada `settings.advancedData.resep` (map `menuId ->
  [{ bahanId, qty }]`).
- Helper baru: `hppFromResep()`, `hppForMenus()`, `marginFromResep()`,
  `bahanDeltasFromItems()`, dan `bahanBakuUsage()` di
  `src/utilities/resepHpp.js`.

#### Bahan Baku (Stok Bahan Mentah)

- Pelacakan stok bahan mentah terpisah dari menu jual.
- Pemakaian bahan dari penjualan dihitung otomatis melalui resep, dan
  dikembalikan saat transaksi void/hapus/clear.
- Implementasi: `src/utilities/bahanBaku.js`,
  `src/hooks/useAdvancedData.js`, dan `src/components/AdvancedDataPanel.jsx`.

#### Database Supplier

- Daftar pemasok dengan kontak, catatan, serta relasi ke stock-in dan riwayat
  pembelian.
- Implementasi: `src/utilities/supplier.js`.

#### Loyalty Tier

- Tingkatan pelanggan (Bronze sampai Platinum) beserta diskon per tier.
- Diskot tier otomatis diterapkan ke keranjang dan dapat ditumpuk dengan
  diskon bertingkat yang sudah ada (`loyalDiscountRules()` di
  `src/utilities/loyalty.js`).
- Badge tier tampil pada keranjang dan layar kasir.

#### Import Menu dan HPP dari Excel

- Import dari file `.xls` / `.xlsx` dengan tiga sheet: `Menu`, `BahanBaku`,
  dan `Resep`.
- Status per baris: `new` / `conflict` / `error`.
- Kategori baru dibuat otomatis; stok menu existing tidak pernah ditimpa;
  sheet `Resep` menang atas kolom `modal`.
- Ditambahkan dependensi `xlsx@^0.18.5`.
- Implementasi: `src/utilities/excelImport.js` dan `src/hooks/useExcelImport.js`.

#### Buku Hutang / Settle Transaksi

- Menandai transaksi sebagai `settled` dengan `settledAt` dan `settledBy`,
  termasuk validasi transaksi void.

#### Laporan Lanjutan

- **Insight Penjualan:** distribusi transaksi dan pendapatan per jam (jam
  ramai), rata-rata per order. Transaksi void dikecualikan.
- **Cash Flow Lanjutan:** pemasukan/pengeluaran per sumber, laba rugi,
  pelacakan hutang, pengelompokan per hari (tahan shift lintas-hari), plus
  grafik arus kas.
- **Ekspor PDF:** laporan dirender menjadi HTML lalu dicetak ke PDF melalui
  dialog penyimpanan Windows.

#### Kustomisasi Header dan Footer Resi

- Teks header khusus (di bawah logo/nama warung) dan footer khusus (paling
  bawah resi) dapat diatur dari tab Resi di Settings.
- Mendukung teks multi-baris.
- Teks otomatis di-escape sebelum dimasukkan ke HTML untuk mencegah masalah
  karakter khusus.
- Berlaku baik pada resi yang dicetak maupun pratinjau.

#### Search Bar dan Daftar Ringkas (Bahan Baku, Supplier, Menu, Pelanggan)

- Search bar untuk daftar bahan baku dan supplier. Daftar ringkas dibatasi 5
  item, sisanya dibuka melalui tombol "Lihat semua" ke modal daftar lengkap.
- Searching bahan baku dan supplier dapat dilakukan langsung di dalam modal
  daftar.
- Dropdown pencarian bahan baku pada tiap baris resep, dengan opsi membuka
  modal daftar menu ketika hasil terlalu banyak.
- Pencarian pelanggan pada keranjang Kasir: dropdown alfabetis yang menyempit
  mengikuti ketikan, dengan navigasi keyboard (panah atas/bawah, Enter, Esc).
- Modal baru: `BahanDetailModal`, `BahanListModal`, `MenuListModal`, dan
  `SupplierListModal`.

#### Auto-Update (Perbaikan)

- URL manifest diperbaiki menjadi `Danzel5005/.kasir-warung/master`.
- Hasil `checkForUpdate()` kini di-cache dan diekspos melalui IPC
  `update-check`, sehingga startup tidak pernah gagal.

---

### Perubahan dan Penyempurnaan

#### Basis Perhitungan Loyalty Tier

- Opsi baru "Basis Loyalty Tier" di tab Fitur Lanjutan, muncul hanya saat
  fitur loyalty aktif:
  - **Total transaksi saat ini** (default): tier dihitung dari nilai pesanan
    yang sedang dibuat.
  - **Total belanja pelanggan (lifetime):** tier dihitung dari akumulasi
    seluruh transaksi pelanggan terpilih, diambil dari agregasi
    `customer-totals` pada database.
- Menghindari feedback loop: tier dihitung dari baseline sebelum diskon.

#### Backup dan Restore

- Fitur lanjutan kini ikut serta dalam backup: `resep`, `bahanBaku`,
  `supplier`, dan `loyaltyTiers` ditambahkan ke `BACKUP_KEYS` dan
  `ARRAY_KEYS`.
- Ringkasan backup menampilkan jumlah item baru tersebut.

#### Refresh Menu Setelah Import Excel

- Import Excel kini langsung memperbarui UI tanpa perlu restart aplikasi,
  melalui `refreshFromStore()` pada `useMenu.js`.

#### Resi

- Struktur render teks tambahan distandarkan (`renderTextBlock()`), dengan
  escaping HTML untuk teks yang disediakan pengguna.

#### Editor Baris Resep

- Input resep kini mempertahankan baris dengan jumlah kosong selama diedit,
  namun hanya menyimpan baris valid (punya bahan dan jumlah > 0).

---

### Perubahan Backend (Electron)

- **`electron/main.cjs`** — storage file baru: `resep.json`, `bahan-baku.json`,
  `supplier.json`, `loyalty-tiers.json`, beserta handler IPC load/save. Update
  check di-refactor menjadi IPC `update-check`.
- **`electron/db.cjs`** — handler baru `menu-bulk-upsert`, `trx-settle`, dan
  `customer-totals`. `stock-set` mengembalikan `{ stock: { id: value } }`;
  `trx-void` mengembalikan `items`; `trx-clear` mengembalikan `cleared` (untuk
  pemulihan stok bahan baku).
- **`electron/printing.cjs`** — handler baru `export-report-pdf`; pembacaan
  lebar kertas distandarkan melalui `normalizePaperWidthMm()` dan
  `charsPerLineForWidth()`.
- **`electron/preload.js`** — API baru: `settleTrx`, `bulkUpsertMenu`,
  `loadResep`/`saveResep`, `loadBahanBaku`/`saveBahanBaku`,
  `loadSupplier`/`saveSupplier`, `loadLoyaltyTiers`/`saveLoyaltyTiers`,
  `exportReportPdf`, `checkUpdate`, dan `customerTotals`.

---

### Perubahan Frontend

- **`src/App.jsx`** — wiring `useAdvancedData`, view `fitur-lanjutan`, hotkey
  `F`, perhitungan diskon loyalty otomatis, pemuatan total belanja kumulatif
  pelanggan, serta penerusan header/footer resi ke pencetakan.
- **`Header.jsx`** — navigasi dinamis dan tombol "Fitur Lanjutan" (muncul saat
  master switch aktif).
- **`ViewKasir.jsx`** — badge loyalty tier pada ringkasan keranjang.
- **`ViewLaporan.jsx`** — integrasi insight, cash flow, hutang, dan ekspor PDF.
- **`AdvancedSettingsTab.jsx`** — opsi basis loyalty tier.
- **`ReceiptSettingsTab.jsx`** — editor header dan footer resi.
- Penyesuaian hooks: `useBills`, `useCart`, `useHistory`, `useHistoryVoid`,
  `useSettings`, `useMenu`, `useAdvancedData`.
- Atribut aksesibilitas `id`/`name` ditambahkan pada berbagai modal dan input.

---

### Pengujian

Test baru:

- `src/utilities/advancedData.test.js`
- `src/utilities/cashflow.test.js`
- `src/utilities/customerSearch.test.js`
- `src/utilities/excelImport.test.js`
- `src/utilities/insights.test.js`
- `src/utilities/receipt.test.js`
- `src/utilities/reportHtml.test.js`

Test yang disesuaikan: `electron/db.test.cjs`, `electron/backup-restore.test.cjs`,
`src/utilities/permissions.test.js`, `src/utilities/backup.test.js`, dan
`src/utilities/ipc-guard.test.js` (termasuk regresi urutan z-index modal bahan).

---

### Perbaikan Bug

- Diskon loyalty tier kini benar-benar diterapkan dan dihitung bersama diskon
  lain.
- Setelah import dari file Excel, item langsung muncul di UI tanpa restart.
- Auto-update tidak lagi gagal karena URL manifest lama.
- Modal detail bahan selalu berada di atas modal daftar bahan (urutan z-index).
- Teks header/footer resi di-escape sehingga aman terhadap karakter khusus.

---

### Dokumentasi dan Pembersihan

- **Ditambah:** `updates/EXCEL_TEMPLATE.md`,
  `updates/PLAN_IMPORT_EXCEL_MENU_HPP.md`, dan pembaruan `updates/PLANNING.md`.
- **Dihapus:** banyak dokumen perencanaan lama dan script stress-test lama
  (`stress-test-console.js`, `stress-test-node.cjs`, `stress-test.js`,
  `test-printer.js`, `TestResi40.pdf`).
- `README.md` diperbarui dengan penjelasan fitur lanjutan, loyalitas,
  bahan baku/supplier/resep, serta halaman Fitur Lanjutan.

---

### Catatan Versi

Versi aplikasi disetel ke `1.2.1` di seluruh berkas berikut:

- `package.json` (`version`)
- `package-lock.json` (`version` dan `packages[""].version`)
- `updates/latest.json` (`version` dan `notes`)
- `README.md` (versi aplikasi saat ini)

Rilis ini ditandai sebagai **v1.2.1-Beta**. Dokumen ini mencakup seluruh
perubahan sejak `v1.2.0`.
