# Kasir Warung

Aplikasi Point of Sale (POS) desktop untuk warung dan usaha makanan/minuman. Aplikasi berjalan sebagai aplikasi Windows berbasis Electron dengan antarmuka React, menyimpan data transaksi secara lokal, dan mendukung pencetakan struk thermal maupun PDF.

Dokumen ini mengikuti struktur dan perilaku kode yang ada di repository. Versi aplikasi saat ini adalah `1.3.0` untuk Windows 10 ke atas.

Selain fungsi kasir inti, aplikasi menyediakan sekumpulan fitur lanjutan yang dikelompokkan menjadi tiga grup — laporan tambahan, fitur pelanggan tambahan, serta bahan baku, supplier, dan harga — dan dapat dinyalakan secara terpisah dari Settings pada tab Fitur Lanjutan.

Sejak versi `1.3.0`, aplikasi juga memiliki **Sync Cloud (Web Sync)**: transaksi yang tersimpan secara lokal dikirim otomatis ke backend cloud (Supabase) setiap 5 menit selama perangkat sudah dipasangkan (*paired*). Data yang tersinkron dapat dipantau dari web-app terpisah di folder `monitoring-frontend/`.

## Ruang Lingkup Fitur

### Kasir dan transaksi

- Login pengguna dan pemilihan operator aktif.
- Shift kerja dengan nomor shift, uang kas awal, pengeluaran, status aktif/tertutup, dan ringkasan penutupan.
- Pencarian menu, filter kategori, keranjang, ubah kuantitas, hapus item, dan drawer keranjang.
- Dukungan barcode melalui keyboard wedge. Pada Windows, aplikasi juga mencoba membaca scanner USB HID secara langsung melalui `node-hid`.
- Harga menu, harga modal, stok terbatas atau stok tanpa batas.
- Diskon bertingkat berdasarkan kuantitas item.
- Diskon loyalty tier yang dapat ditumpuk dengan diskon bertingkat ketika fitur pelanggan tambahan aktif.
- Pajak dan service yang dapat diaktifkan serta dikonfigurasi dari Settings.
- Field tambahan checkout dan struk yang dapat dibuat, diubah, diwajibkan, disembunyikan, atau dihapus.
- Data pelanggan atau member yang dipilih dari pemilih pelanggan, lalu disimpan pada transaksi dan ditampilkan di struk.
- Open bill untuk menyimpan pesanan yang belum dibayar, melanjutkan pesanan, menambah atau menghapus item, membayar, serta membatalkan dengan pengembalian stok.
- Pembayaran tunai, QRIS, metode debit, transfer, dan metode custom yang dikelola dari Settings.
- Perhitungan kembalian untuk pembayaran tunai.
- Pencegahan pemotongan stok ganda ketika open bill dibayar.
- Void transaksi oleh admin dengan alasan, catatan, waktu, dan operator pencatat void.

### Pelanggan dan member

- Pemilih pelanggan pada layar kasir untuk mengaitkan transaksi ke pelanggan atau member.
- Saat fitur pelanggan aktif dan keyboard masuk ke kolom nama pelanggan, daftar pelanggan yang tersimpan langsung muncul sebagai dropdown yang bisa diklik, berurutan secara alfabet, dan menyempit mengikuti ketikan. Navigasi keyboard `↑`/`↓`/`Enter`/`Esc` juga didukung.
- Data pelanggan disimpan pada transaksi dalam bentuk salinan (`customerId`, `customerNama`, `customerTelepon`) sehingga riwayat dan struk lama tetap terbaca meskipun pelanggan kemudian diubah namanya atau dihapus.
- Nama pelanggan, atau nama beserta telepon jika tersedia, ditampilkan pada baris `PELANGGAN` di struk dan pada jalur thermal ESC/POS.
- Pelanggan yang dipilih otomatis dilepas setelah transaksi selesai agar tidak terbawa ke transaksi berikutnya.

### Pembatalan transaksi (void)

- Void hanya tersedia bagi pengguna dengan peran admin.
- Modal void meminta alasan dari daftar yang tersedia dan catatan tambahan.
- Transaksi void menyimpan status, alasan, catatan, waktu, dan operator yang melakukan void, lalu ditampilkan sebagai baris dengan label `VOID` pada Riwayat.
- Transaksi void dikeluarkan dari seluruh total laporan keuangan dan dari seluruh ekspor CSV, termasuk laporan keuangan, sales rate, rangkuman per item, dan rincian transaksi.
- Ekspor transaksi menambahkan kolom `Status` dan `Alasan Void`.

### Minuman dan kategori

Kategori dapat diberi tag `Drinks`. Item pada kategori tersebut meminta pilihan tambahan saat dimasukkan ke keranjang:

- Ukuran cup: Small, Medium, atau Large.
- Gula: Less, Normal, atau More.
- Suhu: Ice dengan tingkat Less, Normal, atau More, atau Hot.

Pilihan tambahan tidak mengubah harga dan item dengan pilihan berbeda menjadi baris keranjang yang berbeda. Data tambahan ditampilkan di keranjang, preview, dan struk.

### Riwayat, laporan, dan ekspor

- Riwayat transaksi dengan filter tanggal, filter shift, pengurutan, pagination, dan tampilan per hari atau per shift.
- Tampilan per shift dapat dipilih melalui pemilih shift dan dikelompokkan per shift. Ketika terdapat lebih dari lima shift, daftar ditampilkan secara ringkas dengan opsi menampilkan semua shift.
- Detail transaksi dan penghapusan transaksi individual.
- Penghapusan seluruh transaksi dengan buffer undo selama 9 detik.
- Laporan keuangan per shift atau seluruh shift: pendapatan, modal, laba/rugi, dan margin.
- Sales rate: item terlaris, item paling sedikit terjual, serta item yang belum pernah terjual.
- Rangkuman per item: kuantitas, pendapatan, modal, laba, dan margin.
- Laporan stok.
- Rincian transaksi.
- Ringkasan pendapatan berdasarkan metode pembayaran mengikuti metode bayar yang dikonfigurasi di Settings.
- Ekspor laporan ke CSV melalui dialog penyimpanan Windows.

### Laporan lanjutan

Fitur laporan lanjutan aktif ketika grup "Laporan Tambahan" dinyalakan dari tab Fitur Lanjutan di Settings.

- Insight penjualan: jam tersibuk, hari tersibuk, tren penjualan per periode, serta perbandingan performa antar periode.
- Cash flow: analitik arus kas yang menggabungkan pendapatan transaksi dan pengeluaran shift, dikelompokkan per hari beserta grafik arus kas.
- Ekspor laporan ke PDF melalui dialog penyimpanan Windows, dihasilkan dari HTML laporan yang dirender oleh aplikasi.
- Seluruh perhitungan laporan lanjutan menggunakan kode murni di `src/utilities/insights.js` dan `src/utilities/cashflow.js`, dengan transaksi void dikeluarkan dari total.

### Loyalty tier dan diskon pelanggan

Fitur loyalty aktif ketika grup "Fitur Pelanggan Tambahan" dinyalakan dari tab Fitur Lanjutan di Settings.

- Tingkat loyalty (tier) didefinisikan sebagai daftar tingkatan dengan ambang total belanja dan persentase diskon.
- Tier pelanggan ditentukan otomatis dari total belanja pelanggan tersebut dan diskon tier otomatis diterapkan pada keranjang.
- Dasar perhitungan tier dapat dipilih dari Settings pada tab Harga:
	- `Transaksi` (default): tier dihitung dari subtotal transaksi yang sedang berjalan.
	- `Lifetime`: tier dihitung dari akumulasi seluruh belanja pelanggan, diambil dari agregasi `customer-totals` pada database.
- Badge tier pelanggan ditampilkan pada keranjang dan pada layar kasir.
- Tingkatan tier dapat diatur dan diubah dari panel loyalty, dengan normalisasi nilai agar data tier yang tersimpan tetap valid.

### Bahan baku, supplier, dan resep (HPP)

Fitur ini aktif ketika grup "Pengaturan Bahan Baku, Supplier, dan Harga tambahan" dinyalakan dari tab Fitur Lanjutan di Settings.

- Bahan baku: daftar bahan dengan satuan, harga beli, dan stok, beserta operasi tambah, ubah, dan hapus.
- Supplier: daftar pemasok dengan kontak dan catatan, beserta operasi tambah, ubah, dan hapus.
- Resep dan HPP: setiap menu dapat memiliki resep berisi bahan baku beserta jumlah pemakaian. Harga modal (HPP) menu dihitung dari resep, sehingga biaya modal tidak lagi diisi manual.
- Pemakaian bahan baku dari resep ikut dipotong ketika transaksi berhasil dibayar.
- Opsi `canViewCost` mengatur apakah harga modal dan laba ditampilkan pada antarmuka.

### Halaman Fitur Lanjutan

Halaman Fitur Lanjutan tampil ketika master switch fitur lanjutan dinyalakan, dan hanya dapat diakses oleh admin.

- Menampilkan status ringkasan tiap fitur lanjutan yang aktif.
- Menyediakan akses ke impor menu dari Excel, pengelolaan bahan baku, supplier, resep dan HPP, serta pengaturan loyalty tier.
- Laporan tambahan (insight penjualan, cash flow, ekspor PDF) tetap berada pada halaman Laporan.

### Impor menu dan HPP dari Excel

- Impor membaca satu file `.xlsx` dengan tiga sheet yang dikenali: `Menu`, `BahanBaku`, dan `Resep`.
- Setiap baris divalidasi dan diklasifikasikan sebagai baris baru, baris yang bertentangan dengan data yang ada, atau baris error, lalu ditampilkan sebagai rencana impor sebelum diterapkan.
- Kategori baru dibuat otomatis ketika belum tersedia.
- Stok yang sudah ada tidak pernah ditimpa oleh nilai dari file impor.
- Ketika sheet `Resep` terisi, nilai tersebut yang dipakai dan mengalahkan nilai `modal` manual pada sheet menu.
- Pemrosesan Excel memakai modul `xlsx` yang diimpor secara dinamis di `src/utilities/excelImport.js`.

### Piutang dan penyelesaian transaksi

- Open bill yang belum dibayar dapat dibayar sebagian atau diselesaikan di lain waktu.
- Penyelesaian transaksi (`trx-settle`) memproses pelunasan dan memperbarui status open bill menjadi transaksi selesai.
- Riwayat open bill dan transaksi selesai dapat dibedakan dari statusnya.

### Peringatan stok menipis

- Panel peringatan stok pada halaman Kelola Menu yang memisahkan item habis (`stok` sama dengan 0) dan item menipis.
- Ambang batas stok menipis diatur dari Settings pada tab Harga dan dibatasi ke rentang 1 sampai 999, dengan default 5.
- Item dengan stok tanpa batas (`stok` bernilai `null`) tidak pernah memicu peringatan. Nilai `NaN` dan `Infinity` tidak diperlakukan sebagai stok yang valid.
- Saran jumlah pembelian ulang untuk tiap item yang perlu diisi kembali.
- Ekspor daftar pengisian ulang ke CSV.
- Kecepatan penjualan per item dihitung dari transaksi, dengan transaksi void dikecualikan agar saran pengisian mencerminkan permintaan nyata.

### Pengguna

- Pengelolaan pengguna dari Settings pada tab Kelola Pengguna, termasuk menambah pengguna dan menghapus pengguna.
- Akun `admin` dan pengguna yang sedang aktif tidak dapat dihapus.
- Setiap pengguna dapat mengubah password miliknya sendiri dari Settings.

### Struk dan printer

- Preview struk sebelum transaksi dicetak.
- Printer thermal melalui ESC/POS dan `node-thermal-printer`.
- Printer sistem atau printer PDF melalui API print Electron.
- Lebar kertas yang dapat diatur. Kode printer membatasi nilai ke rentang 30 sampai 210 mm, dengan default 80 mm.
- Kompatibilitas format 58 mm dan 80 mm melalui jumlah karakter per baris yang disesuaikan.
- Isi struk dapat mencakup logo, nama warung, alamat, telepon, waktu, nomor transaksi, kasir, pelanggan, metode pembayaran, item, tambahan minuman, subtotal, pajak, service, diskon, total, pembayaran, kembalian, gambar QRIS, dan catatan footer.
- Nama warung pada struk mengikuti nilai yang diisi pengguna di Settings, bukan label umum.
- Baris pelanggan hanya muncul ketika nama pelanggan tersedia, dan menampilkan nama beserta telepon jika nomor telepon ada.
- Gambar QRIS yang diunggah pengguna pada pengaturan QRIS tampil pada struk ketika pembayaran memakai metode QRIS.
- Pajak dan service hanya muncul pada struk ketika diaktifkan di Settings.
- Printer dipilih dari Settings. Printer PDF tidak diproses sebagai printer thermal ESC/POS.

### Settings

Settings ditampilkan sebagai modal dengan tab berikut:

| Tab | Isi |
| --- | --- |
| `Printer` | Daftar printer, pemilihan printer, dan lebar kertas struk. |
| `Nama Warung` | Nama warung, alamat, dan nomor telepon yang tampil di struk. |
| `Metode Bayar` | Metode pembayaran beserta kategori cash, QRIS, atau custom. |
| `QRIS` | Gambar QRIS per metode pembayaran yang sesuai. |
| `Resi` | Field struk dan tambahan checkout, status wajib isi, serta pajak dan service. |
| `Harga` | Diskon bertingkat, pajak dan service, serta ambang batas stok menipis. |
| `Backup` | Backup, restore, dan pemeriksaan data. |
| `Kelola Pengguna` | Menambah dan menghapus pengguna, serta mengubah password. |
| `Fitur Lanjutan` | Master switch fitur lanjutan dan pengaturan per grup: laporan tambahan, fitur pelanggan tambahan, serta bahan baku, supplier, dan harga. |

Catatan:

- Nama warung memakai nilai yang diisi pengguna, sehingga struk menampilkan nama tempat usaha dan bukan label umum.
- Metode pembayaran dapat ditambah dan dihapus, dengan minimal satu metode aktif.
- Field struk dapat ditambah, diubah, diwajibkan, atau dihapus, termasuk field bawaan seperti nomor meja dan jumlah pax.
- Diskon bertingkat dan kategori pengeluaran shift tetap dikelola dari Settings.
- Basis tier loyalty (`Transaksi` atau `Lifetime`) diatur dari tab Harga.
- Tab Fitur Lanjutan mengatur master switch dan tiap grup fitur lanjutan; halaman Fitur Lanjutan dan tab ini hanya dapat diakses oleh admin.

### Backup dan restore

- Backup dibuat dari panel pada tab Backup dan disimpan sebagai file JSON dengan format `kasir-warung-backup`.
- Backup mencakup penyimpanan data utama: menu, kategori, settings, pengguna, pelanggan, QRIS, open bill, shift, transaksi, dan logo.
- File backup dapat divalidasi dan diringkas sebelum dipulihkan.
- Pemulihan menulis snapshot pengaman sebelum perubahan, menutup database, menulis ulang penyimpanan JSON, menghapus `kasir.db` beserta `-wal` dan `-shm`, lalu menjalankan ulang inisialisasi dan migrasi.
- Snapshot internal dibuat otomatis dan dibatasi hingga 20 file terbaru.
- Setelah pemulihan, aplikasi menyarankan restart.
- Folder data dapat dibuka dari panel backup.

### Lisensi

Aplikasi memeriksa lisensi sebelum memuat workspace utama. Lisensi terikat ke hardware ID yang dibaca dari `node-machine-id`.

- Hardware ID ditampilkan dalam format empat kelompok karakter.
- License key dibuat untuk hardware ID tertentu menggunakan HMAC-SHA256 pada modul generator internal.
- Lisensi yang aktif disimpan sebagai payload JSON yang di-encode Base64 di file `.ykk_lic` pada direktori user-data Electron.
- Kunci lisensi dan `electron/license-secret.cjs` adalah artefak sensitif. Seharusnya jangan menaruh secret produksi di repository publik, tapi gapapalah.

### Sync Cloud (Web Sync)

Sync Cloud menghubungkan aplikasi kasir desktop (POS) dengan sebuah backend cloud berbasis Supabase, sehingga transaksi yang terjadi di warung dapat dipantau dari web-app terpisah. Fitur ini bersifat opsional: tanpa URL backend dan tanpa pairing, aplikasi tetap berjalan normal secara lokal.

Cara kerja singkat:

- Setiap perangkat memiliki **identitas perangkat** sendiri (`deviceId` + `deviceSecret`) yang dibuat otomatis dan disimpan secara lokal.
- Perangkat **dipasangkan (pairing)** ke sebuah store pada web-app menggunakan **kode pairing** sekali pakai. Kode ditampilkan oleh POS pada tab Sync Cloud dan dimasukkan pada halaman "Hubungkan Perangkat" di web-app.
- Setelah terpasang, POS **mengirim transaksi yang belum tersinkron secara otomatis setiap 5 menit** (auto-sync). Pengiriman manual juga tersedia.
- Transaksi yang sudah berhasil dikirim ditandai `synced_at` pada database lokal, sehingga tidak dikirim ulang. Transaksi yang gagal **tidak** ditandai, dan akan dicoba lagi pada siklus berikutnya.
- Setiap request ditandatangani dengan **HMAC-SHA256** (`timestamp.nonce.rawBody`) memakai kunci turunan dari device secret; server memverifikasi tanda tangan, batas waktu (300 detik), dan mencegah pengiriman ulang (replay) melalui tabel nonce.

Komponen sisi POS:

| Lokasi | Isi dan fungsi |
| --- | --- |
| `electron/device-identity.cjs` | Membuat, membaca, dan menandatangani identitas perangkat. Credential disimpan base64-JSON di `userData/.pos_device` (di luar `data/`, sehingga tidak ikut backup bisnis). |
| `electron/device-sync-client.cjs` | Klien HTTP (fetch) bertanda tangan untuk register, status, heartbeat, dan upload transaksi. |
| `electron/device-sync-service.cjs` | Menggabungkan identitas + klien, menyimpan `baseUrl` di `userData/device-sync.json`, menjalankan timer auto-sync 5 menit, dan mendaftarkan IPC. |
| `electron/main.cjs` | Membuat `deviceIdentity` + `deviceSync`, menyuntikkan helper database dan `notify`, serta menghentikan auto-sync saat keluar. |
| `src/hooks/useDeviceSync.js` | State + aksi UI (register, cek pairing, push manual, ubah URL) dan langganan notifikasi sync. |
| `src/components/modals/settings-tabs/CloudSyncSettingsTab.jsx` | Tab admin "Sync Cloud" pada modal Settings. |

Komponen sisi cloud (folder `supabase/`):

- `supabase/migrations/0001_init.sql` — tabel `stores`, `devices`, `pairing_codes`, `store_users`, `synced_transactions`, `device_nonces`, beserta RLS dan RPC `pair_device(code)`.
- `supabase/migrations/0002_device_management.sql` — RPC `revoke_device(text)` dan `activate_device(text)`.
- `supabase/migrations/0003_fix_search_path.sql` — perbaikan `search_path` (`public, extensions`) untuk fungsi security definer (pgcrypto).
- `supabase/migrations/0005_kds.sql` — tiket KDS, station, RLS, state machine, rate limit, audit status, dan RPC retensi.
- `supabase/functions/` — Edge Function `devices-register`, `devices-status`, `devices-heartbeat`, dan `sync-upload`.
- `supabase/functions/kds-create-ticket` dan `kds-cancel-tickets` — endpoint KDS bertanda tangan HMAC.
- `supabase/config.toml` — konfigurasi `verify_jwt=false` untuk fungsi mesin.

Web-app pemantau ada di folder `monitoring-frontend/` (React + Vite) dan memakai Supabase Auth + RLS pada project yang sama. Halaman utamanya mencakup Laporan, Riwayat, Data Tersinkron, Perangkat (pairing/revoke), dan Akun.

Panduan operasional: `supabase/PANDUAN-PHASE-B.md` (setup backend), `monitoring-frontend/PANDUAN-WEBAPP-SYNC.md` (integrasi web-app), serta `updates/PLAN-WEBSYNC.md` dan `updates/PLAN-WEBSYNC-UI-CLOUD.md` (dokumen desain).

Catatan:

- Endpoint Edge Function **tidak** diperbarui otomatis. Deploy `kds-create-ticket` dan `kds-cancel-tickets` saat mengaktifkan KDS.
- Perubahan pada `electron/*.cjs` memerlukan restart aplikasi POS.
- Rotasi credential perangkat mengubah `deviceId` + secret dan melepas pairing, sehingga perangkat harus dipasangkan ulang.

## Teknologi dan Dependensi

Versi di bawah ini adalah versi yang tercatat di `package.json` saat dokumentasi ini dibuat.

### Dependensi runtime

| Paket | Versi | Kegunaan |
| --- | --- | --- |
| `react` | `^18.3.1` | Komponen dan state antarmuka |
| `react-dom` | `^18.3.1` | Render React ke halaman aplikasi |
| `better-sqlite3` | `^11.8.1` | Database SQLite lokal untuk transaksi dan shift |
| `node-hid` | `^2.0.0` | Pembacaan scanner USB HID sebagai fallback |
| `node-machine-id` | `^1.1.12` | Pembentukan hardware ID untuk lisensi |
| `node-thermal-printer` | `^4.6.1` | Pembuatan dan pengiriman data ESC/POS |
| `xlsx` | `^0.18.5` | Pembacaan file Excel untuk impor menu, bahan baku, dan resep |

### Dependensi pengembangan dan build

| Paket | Versi | Kegunaan |
| --- | --- | --- |
| `electron` | `^31.7.7` | Shell desktop dan Electron main process |
| `vite` | `^5.4.10` | Development server dan bundling renderer |
| `@vitejs/plugin-react` | `^4.3.1` | Integrasi React untuk Vite |
| `electron-builder` | `^25.1.8` | Pembuatan installer Windows NSIS |
| `@electron/rebuild` | `^3.6.0` | Rebuild native module untuk Electron |
| `node-gyp` | `^13.0.1` | Toolchain native module |
| `concurrently` | `^8.2.2` | Menjalankan Vite dan Electron bersamaan |
| `wait-on` | `^8.0.1` | Menunggu Vite siap sebelum Electron dijalankan |
| `vitest` | `^4.1.10` | Unit test |

`npm install` menjalankan `postinstall`, yaitu `npx @electron/rebuild -f -w node-hid`. Native dependency dapat memerlukan toolchain Windows yang sesuai.

## Persyaratan Sistem

### Minimum praktis untuk menjalankan aplikasi

- Windows 10 atau Windows 11 64-bit.
- CPU dua inti 64-bit, sekitar 2 GHz atau lebih.
- RAM 4 GB.
- Ruang kosong 1 GB untuk aplikasi, cache, dan data operasi awal. Sediakan ruang tambahan untuk database, gambar, backup, serta installer.
- Layar minimal 1020 x 680 piksel. Ukuran minimum ini sesuai dengan `BrowserWindow` aplikasi.
- Hak akses untuk memasang aplikasi dan mengakses direktori user-data.

### Perangkat tambahan

- Printer thermal 58 mm atau 80 mm jika ingin mencetak struk fisik.
- Scanner barcode USB yang mendukung keyboard wedge atau USB HID.
- Koneksi internet tidak diperlukan untuk transaksi lokal setelah aplikasi dan lisensi tersedia. Internet mungkin diperlukan untuk distribusi installer, dukungan, atau proses lisensi di luar aplikasi.

Persyaratan RAM dan ruang di atas adalah batas operasional yang disarankan untuk Windows dan Electron, bukan hasil benchmark formal. Database dan jumlah gambar yang besar membutuhkan ruang tambahan.

## Struktur Repository

### File root

| File | Isi dan fungsi |
| --- | --- |
| `package.json` | Metadata aplikasi, versi, dependensi, script development/test/build, serta konfigurasi electron-builder. |
| `index.html` | Dokumen HTML entry point untuk renderer Vite. |
| `vite.config.js` | Konfigurasi Vite dan plugin React. |
| `vitest.config.mjs` | Konfigurasi Vitest. |
| `menuandcat.json` | Data atau fixture menu dan kategori yang digunakan untuk kebutuhan repository tertentu, bukan lokasi data runtime utama. |
| `generator.cjs` | Generator license key berbasis runtime CommonJS. Gunakan hanya di lingkungan yang dipercaya. |
| `generator.py` | Generator atau utilitas license key berbasis Python untuk kebutuhan operasional pengembang. |
| `fix_photo.py` | Utilitas Python untuk perbaikan atau pemrosesan foto menu. |
| `test-app-printer.js` | Skrip pengujian integrasi aplikasi/printer. |
| `test-db.js` | Skrip pengujian akses database. |
| `test-printer.js` | Skrip pengujian printer. |
| `LICENSE` | Lisensi repository. |
| `README.md` | Dokumentasi penggunaan, build, dan pemeliharaan. |

### `electron/`

| File | Isi dan fungsi |
| --- | --- |
| `main.cjs` | Electron main process: membuat window, mendaftarkan IPC, menginisialisasi database, migrasi, recovery WAL, backup harian, lisensi, scanner, dan printing. |
| `preload.js` | Context bridge terisolasi yang mengekspos API `kasirAPI` dan alias `api` ke renderer. |
| `db.cjs` | SQLite service, tabel transaksi/shift, query terfilter, pagination, penyimpanan, pembayaran atomik, dan migrasi data JSON lama. |
| `backup.cjs` | Pembacaan JSON, atomic write, WAL recovery, dan backup transaksi harian dengan retensi 30 file. |
| `backup-restore.cjs` | Layanan backup penuh dan restore: validasi file backup, ringkasan, snapshot pengaman, penggantian penyimpanan JSON, dan daftar snapshot internal. |
| `printing.cjs` | Printer enumeration, print HTML/PDF, print thermal ESC/POS, normalisasi lebar kertas, dan format struk langsung. |
| `print-manager.cjs` | Modul pendukung alur manajemen printing. |
| `license.cjs` | Pembacaan hardware ID, validasi license key, aktivasi, dan penyimpanan lisensi. |
| `license-secret.cjs` | Implementasi secret/generator kunci lisensi. Lindungi dari publikasi. |
| `auth.cjs` | Hashing password scrypt, verifikasi panjang-tetap, migrasi lazy dari plaintext, dan penyimpanan sesi pengguna. |
| `auth-ipc.cjs` | Registrasi handler IPC untuk autentikasi dan pengelolaan sesi login. |
| `category-label.cjs` | Resolusi label kategori untuk output printer. |
| `update-check.cjs` | Pemeriksaan versi terbaru dari feed update dan perbandingan versi semantik. |
| `device-identity.cjs` | Identitas perangkat (device ID + secret), pembuatan, penandatanganan HMAC, dan penyimpanan credential. |
| `device-sync-client.cjs` | Klien HTTP bertanda tangan untuk register, status, heartbeat, dan upload transaksi ke cloud. |
| `device-sync-service.cjs` | Layanan Sync Cloud: menggabungkan identitas + klien, menyimpan `baseUrl`, timer auto-sync 5 menit, dan handler IPC `device-*`. |
| `dev-runner.cjs` | Runner development yang memantau perubahan pada `electron/` dan me-restart main process secara otomatis. Tidak digunakan pada build produksi. |
| `free-port.cjs` | Utilitas development untuk membebaskan port yang tertahan sebelum menjalankan Vite/Electron. |
| `kill-electron.cjs` | Utilitas development untuk menghentikan proses Electron yang masih berjalan. |

### `src/`

| Lokasi | Isi dan fungsi |
| --- | --- |
| `App.jsx` | Koordinator aplikasi: lifecycle lisensi/login/shift, pemuatan data, navigasi, hotkey, pembayaran, printing, dan wiring antar-hook. |
| `main.jsx` | Entry point React renderer. |
| `assets/` | Ikon dan aset statis, termasuk ikon aplikasi. |
| `components/` | Komponen UI bersama seperti detail bill, jam, loader, badge stok, panel peringatan stok, pemilih pelanggan, panel backup/restore, panel data lanjutan, grafik cash flow, error boundary, dan tag. |
| `components/modals/` | Modal item, kategori, additionals minuman, pembayaran, struk, printer, settings, pengguna, konfirmasi, dan tutup shift. |
| `components/modals/settings-tabs/` | Implementasi panel tiap tab Settings: printer, warung, pembayaran, QRIS, receipt, pricing, backup, pengguna, fitur lanjutan, dan Sync Cloud, dengan `index.js` sebagai barrel. |
| `constants/` | Konfigurasi kategori, menu, pembayaran, additionals, receipt fields, fitur lanjutan (`advancedFeatures.js`), dan design tokens. `design.js` adalah sumber token visual utama saat ini. |
| `hooks/` | Domain state dan operasi untuk auth/shift, barcode, bills, cart, customers, history, license, menu, settings, users, data lanjutan, impor Excel, Sync Cloud (`useDeviceSync.js`), dan toast/undo. |
| `utilities/` | Logika murni dan adapter untuk barcode, kalkulasi harga, kategori, CSV, i18n, printer, receipt, shift, stock, user, backup, ipc guard, IPC API, loyalty, pencarian pelanggan, bahan baku, supplier, resep dan HPP, cash flow, insight, report HTML, dan impor Excel. Banyak utilitas memiliki file test berdekatan. |
| `views/` | Layar Kasir, Open Bill, Riwayat, Laporan, Kelola Menu/Kategori, dan Fitur Lanjutan. |

### `supabase/`

Backend cloud (Supabase) untuk Sync Cloud. Berisi migration, Edge Function, konfigurasi, dan panduan:

- `migrations/` — skema tabel (`stores`, `devices`, `pairing_codes`, `store_users`, `synced_transactions`, `device_nonces`), RLS, dan RPC (`pair_device`, `revoke_device`, `activate_device`).
- `functions/` — Edge Function `devices-register`, `devices-status`, `devices-heartbeat`, dan `sync-upload`.
- `config.toml` — konfigurasi project Supabase.
- `PANDUAN-PHASE-B.md` — panduan setup backend.
- `sync-parity.test.mjs` — tes keccocokan skema/parity sinkronisasi.

### `monitoring-frontend/` dan `monitoring-backend/`

Web-app pemantau (React + Vite) di `monitoring-frontend/` memakai Supabase Auth + RLS pada project yang sama dengan POS. Halaman utamanya: Laporan, Riwayat, Data Tersinkron, Perangkat (pairing/revoke), dan Akun. Panduan integrasi ada di `monitoring-frontend/PANDUAN-WEBAPP-SYNC.md`. Folder `monitoring-backend/` berisi layanan backend tambahan untuk pemantauan.

### `scripts/`

Skrip bantu untuk pengujian integrasi Sync Cloud: `sign-request.mjs` (menandatangani request), `test-register.mjs` (registrasi perangkat), dan `test-status.mjs` (cek status perangkat).

### `updates/`

Dokumentasi internal perubahan, desain, rencana, checklist pengujian, format struk, dan catatan implementasi. Berkas di folder ini membantu memahami keputusan historis, tetapi source code dan `package.json` tetap menjadi sumber kebenaran untuk perilaku saat ini.

Untuk panduan menambahkan menu — ditulis untuk pengguna awam sekaligus developer yang ingin berkontribusi — lihat [`updates/TUTORIAL-MENAMBAH-MENU.md`](updates/TUTORIAL-MENAMBAH-MENU.md).

### Direktori generated atau distribusi

- `dist/` dibuat oleh `npm run build` dan berisi renderer production.
- `release/` dibuat oleh electron-builder dan berisi installer, artefak update, serta output packaging lainnya.
- `license-key-generator-android/` adalah project Android terpisah untuk generator lisensi; tidak digunakan sebagai dependency runtime aplikasi Electron.

## Data Runtime dan Persistensi

Data runtime tidak disimpan di folder repository. Electron menggunakan `app.getPath("userData")`, lalu membuat subfolder `data`.

Pada Windows, lokasi umumnya adalah:

```text
%APPDATA%\kasir-warung\data\
```

Lokasi aktual dapat dilihat dari aplikasi melalui API `getDataPath`.

| Path | Isi |
| --- | --- |
| `kasir.db` | Database SQLite untuk tabel `transactions` dan `shifts`. SQLite menggunakan journal mode WAL. |
| `transactions.json` | Format lama atau fallback transaksi ketika database tidak tersedia. |
| `shifts.json` | Format lama atau fallback shift ketika database tidak tersedia. |
| `menu.json` | Daftar menu, harga, harga modal, stok, barcode, kategori, dan metadata menu. |
| `categories.json` | Kategori menu dan tags, termasuk tag `Drinks`. |
| `open-bills.json` | Open bill yang belum dibayar. |
| `customers.json` | Daftar pelanggan atau member untuk pemilih pelanggan. |
| `settings.json` | Identitas warung, printer, payment methods, QRIS, receipt fields, pricing, dan expense categories. |
| `users.json` | Akun pengguna dan role. |
| `resep.json` | Resep per menu beserta daftar bahan baku dan jumlah pemakaiannya untuk perhitungan HPP. |
| `bahan-baku.json` | Daftar bahan baku dengan satuan, harga beli, dan stok. |
| `supplier.json` | Daftar supplier dengan kontak dan catatan. |
| `loyalty-tiers.json` | Daftar tingkatan loyalty tier beserta ambang total belanja dan persentase diskon. |
| `logo.json` | Logo dalam bentuk data yang disimpan aplikasi. |
| `qris.json` | Gambar QRIS per metode pembayaran. |
| `trx.wal` | Catatan transaksi sementara untuk recovery setelah crash saat pembayaran. |
| `backups/` | Backup harian transaksi dengan retensi maksimal 30 file. |
| `json-backups/` | Salinan `transactions.json` dan `shifts.json` saat migrasi ke SQLite. |
| `receipt-print.html` | HTML sementara yang digunakan alur print HTML/PDF. |
| `.pos_device` | Identitas perangkat (`deviceId` + secret) untuk Sync Cloud, disimpan dengan permission ketat. |
| `device-sync.json` | State Sync Cloud: URL backend, status pairing, kode pairing, dan waktu sync terakhir. |

Penulisan JSON menggunakan file temporary, `fsync`, lalu rename. Saat startup, urutannya adalah inisialisasi SQLite, migrasi JSON lama, recovery WAL, backup harian, lalu pembuatan window.

## Menyiapkan Development

### Prasyarat

1. Windows 10/11 64-bit untuk pengujian Electron dan build installer.
2. Node.js versi LTS. Node.js 20 LTS adalah pilihan yang disarankan; versi yang kompatibel harus dapat memasang Electron 31, `better-sqlite3`, dan `node-hid`.
3. npm yang ikut bersama Node.js.
4. Untuk native module di Windows, siapkan toolchain yang dibutuhkan `node-gyp` jika prebuilt binary tidak tersedia, termasuk Python dan Visual Studio Build Tools dengan workload C++.

### Instalasi

```powershell
git clone <url-repository>
Set-Location .kasir-warung
npm install
```

Jangan menyalin data runtime ke repository. Untuk mempertahankan data pengguna, backup direktori user-data aplikasi sebelum mengganti build.

### Menjalankan

```powershell
# Vite renderer saja; cocok untuk pekerjaan UI
npm run dev

# Vite dan Electron bersamaan; gunakan untuk menguji IPC, database, lisensi,
# barcode, dan printer
npm run electron:dev

# Vite dan Electron tanpa supervisor restart; fallback untuk electron:dev
npm run electron:plain
```

`npm run dev` hanya menjalankan renderer. API Electron seperti SQLite, printer, scanner HID, dan lisensi tidak tersedia sepenuhnya di browser biasa.

`npm run electron:dev` menjalankan Vite dan Electron melalui `electron/dev-runner.cjs`, yang memantau perubahan pada folder `electron/` dan me-restart main process secara otomatis. Main process Electron tidak ikut hot reload oleh Vite, sehingga restart otomatis ini diperlukan ketika mengubah file seperti `main.cjs`, `db.cjs`, atau `printing.cjs`.

Pesan seperti `No handler registered for '<nama>'` pada renderer umumnya berarti main process yang sedang berjalan masih memuat kode lama. Restart aplikasi, bukan menelusuri source code renderer.

## Testing dan Pemeriksaan

```powershell
# Menjalankan seluruh test Vitest satu kali
npm test

# Mode watch
npm run test:watch

# Build renderer tanpa membuat installer
npm run build
```

Test unit renderer berada di `src/utilities/` dan `src/hooks/`, mencakup barcode, kalkulasi, category management, CSP, CSV, printer, receipt, stock, backup, ipc guard, pemulihan sesi login, utilitas IPC, data fitur lanjutan, cash flow, insight penjualan, report HTML, impor Excel, resep/HPP, dan Sync Cloud.

Test unit main process berada di `electron/` dan ikut dijalankan oleh `npm test`:

| Berkas test | Cakupan |
| --- | --- |
| `electron/auth.test.cjs` | Hashing scrypt, verifikasi panjang-tetap, migrasi lazy dari plaintext, seluruh handler IPC `auth-*`. |
| `electron/backup.test.cjs` | `atomicWrite`, `rJSON`, WAL append/clear/recover, backup harian dan pruning. |
| `electron/db.test.cjs` | CRUD transaksi, void, filter/paginasi, agregasi harian, shifts, `process-payment`, migrasi JSON ke SQLite. |
| `electron/backup-restore.test.cjs` | `stats`, `createBackup`, `previewBackup`, `restoreBackup` (termasuk safety snapshot), `listInternalBackups`, registrasi handler. |
| `electron/license.test.cjs` | `generateKey`, aktivasi, penolakan key perangkat lain, lisensi rusak, hardware ID tidak terbaca. |
| `electron/update-check.test.cjs` | `compareVersions`, deteksi versi baru, dan jaminan tidak melempar saat offline. |
| `electron/device-identity.test.cjs` | Pembuatan/pembacaan identity perangkat, penyimpanan secret dengan permission ketat, dan `rotate()` yang mengganti `deviceId` + secret. |
| `electron/device-sync-client.test.cjs` | Penandatanganan request HMAC (header `ts`/`nonce`/`sign`), pemanggilan Edge Function, dan penanganan respons gagal. |
| `electron/device-sync-service.test.cjs` | Orkestrasi pairing, heartbeat, dan push transaksi bertanda `synced_at`, termasuk retry saat offline. |

Catatan penting saat menambah test baru di `electron/`:

- Modul main process memakai pola factory dengan dependency injection, jadi cukup menyuntik stub `ipcMain`/`app`/`dialog` — Electron asli tidak perlu dijalankan.
- `better-sqlite3` di-rebuild untuk ABI Electron oleh script `postinstall`, sehingga binary-nya **tidak bisa** di-require dari Node yang dipakai Vitest. `electron/db.test.cjs` mengganti modul itu dengan implementasi in-memory lewat `require.cache` agar tes tetap deterministik.
- Modul `electron` tidak bisa di-`vi.mock` dari test CJS karena `require` bawaan Node melewati mock registry Vitest. Untuk nilai yang bergantung runtime Electron, gunakan opsi injeksi seperti `getCurrentVersion` pada `update-check.cjs`.

Skrip `test-db.js`, `test-printer.js`, dan `test-app-printer.js` adalah pemeriksaan manual/integrasi terpisah dari `npm test`. `electron/main.cjs` dan `electron/printing.cjs` belum punya test otomatis — keduanya butuh `BrowserWindow` asli, jadi tetap diverifikasi dengan `node --check` dan pengujian manual melalui `npm run electron:dev`.

## Build Installer Windows

Build production saat ini didefinisikan sebagai:

```powershell
npm run electron:build
```

Script tersebut menjalankan `vite build`, lalu `electron-builder --win`. Konfigurasi packaging berada di `package.json`:

- Product name: `DEN POS`.
- App ID: `com.warung.kasir`.
- Target: installer NSIS Windows x64.
- Output: `release/`.
- Ikon: `src/assets/icon.ico`.
- Installer bukan one-click; pengguna dapat memilih folder instalasi.
- Desktop shortcut dan Start Menu shortcut dibuat otomatis.
- Nama shortcut: `DEN POS`.
- File yang dipaketkan: `dist/**/*`, `electron/**/*`, secret lisensi yang ditentukan konfigurasi, `node_modules/**/*`, dan `package.json`.

File installer yang dihasilkan mengikuti versi `package.json`, sehingga nama file tidak boleh diasumsikan selalu sama. Periksa isi `release/` setelah build.

## Prosedur Update dan Release

1. Backup direktori `%APPDATA%\kasir-warung\data\` pada komputer pengguna. Pastikan backup mencakup `kasir.db`, JSON konfigurasi, `open-bills.json`, `customers.json`, dan folder `backups`. Aplikasi juga menyediakan backup penuh melalui Settings pada tab Backup.
2. Catat perubahan dan naikkan `version` di `package.json` sesuai jenis release.
3. Perbarui source code secara lokal dan jangan menghapus file data pengguna.
4. Jalankan `npm install` jika dependency berubah. `postinstall` akan melakukan Electron rebuild untuk `node-hid`.
5. Jalankan `npm test`.
6. Jalankan `npm run build` untuk memastikan renderer production berhasil dibundel.
7. Jalankan `npm run electron:build` pada Windows x64 untuk membuat installer.
8. Uji installer di komputer bersih: instalasi, startup, license screen, login, shift, tambah menu, transaksi, open bill, pembayaran, pelanggan, void transaksi, peringatan stok, laporan, ekspor CSV, backup dan restore, dan printing.
9. Verifikasi fitur berikut sebelum distribusi:
	- **Void transaksi**: lakukan void pada satu transaksi sebagai admin, pastikan transaksi tetap tampil dengan penanda void dan alasan, bukan terhapus, dan tidak lagi dihitung pada total laporan.
	- **Pelanggan pada nota**: pilih pelanggan, selesaikan penjualan, lalu pastikan baris `PELANGGAN` muncul di nota thermal dan preview (format `Nama (telepon)` bila nomor tersedia). Setelah pembayaran selesai, pastikan pilihan pelanggan tereset untuk transaksi berikutnya.
	- **Peringatan stok**: atur "Batas Stok Menipis" di Settings → Pricing, pastikan panel peringatan stok muncul di Kelola Menu dan ekspor daftar restock (CSV) berisi item yang perlu ditambah.
	- **Ekspor CSV bebas void**: ekspor dari Riwayat dan Laporan, lalu pastikan transaksi yang sudah di-void tidak ikut menyumbang angka pada file CSV.
	- **Backup & Restore**: buat backup dari Settings → Backup, pulihkan dari file, dan pastikan aplikasi meminta restart, data kembali utuh, serta snapshot pengaman `pre-restore_<stamp>.json` terbentuk.
	- **Fitur lanjutan**: nyalakan master switch di Settings → Fitur Lanjutan, pastikan halaman Fitur Lanjutan dapat dibuka oleh admin melalui hotkey `F`, dan tampil ringkasan status tiap grup.
	- **Loyalty tier**: atur tier, pilih pelanggan, lalu pastikan badge tier muncul dan diskon tier otomatis diterapkan pada keranjang. Uji kedua basis tier (`Transaksi` dan `Lifetime`).
	- **Bahan baku, supplier, dan resep**: tambah bahan baku dan supplier, isi resep sebuah menu, lalu pastikan HPP menu mengikuti resep dan pemakaian bahan baku terpotong setelah transaksi dibayar.
	- **Impor Excel**: siapkan file `.xlsx` dengan sheet `Menu`, `BahanBaku`, dan `Resep`, lalu pastikan rencana impor menandai baris baru, konflik, dan error dengan benar tanpa menimpa stok yang sudah ada.
	- **Laporan lanjutan**: buka halaman Laporan dan pastikan insight penjualan, cash flow, dan ekspor PDF berjalan serta konsisten dengan transaksi yang ada.
10. Uji printer thermal pada lebar yang dipakai dan uji printer PDF secara terpisah.
11. Simpan installer dan checksum internal sesuai prosedur distribusi. Jangan memasukkan license secret atau license key pelanggan ke repository.
12. Saat upgrade pada komputer pengguna, tutup aplikasi lebih dahulu, pasang installer baru, lalu verifikasi data dan lisensi. Migrasi JSON ke SQLite dilakukan saat startup dan membuat salinan migrasi di `json-backups`.

## Pemeliharaan dan Troubleshooting

### Data tidak tampil atau transaksi perlu dipulihkan

1. Tutup aplikasi.
2. Salin seluruh `%APPDATA%\kasir-warung\data\` sebagai backup baru.
3. Periksa `kasir.db`, `trx.wal`, dan `backups/`.
4. Jalankan aplikasi kembali. Recovery WAL dilakukan saat startup.
5. Jangan mengedit SQLite atau JSON secara manual sebelum membuat salinan.

### Printer thermal gagal

- Pastikan printer terlihat di Windows dan dipilih dari Settings.
- Pastikan printer bukan printer PDF atau virtual ketika memakai jalur ESC/POS.
- Pastikan ukuran kertas Settings sesuai dengan printer.
- Gunakan `test-printer.js` atau `test-app-printer.js` untuk pemeriksaan terarah.
- Periksa log Electron untuk pesan koneksi printer atau driver RAW.

### Scanner barcode gagal

- Pastikan scanner mengirim input keyboard dengan suffix Enter atau terdeteksi sebagai USB HID.
- Pastikan barcode menu tersimpan sesuai nilai yang dipindai.
- Jalur keyboard wedge adalah jalur utama; pembacaan HID mentah hanya fallback dan bergantung pada perangkat serta driver.

### Native dependency gagal dipasang

- Hapus `node_modules` hanya setelah memastikan tidak ada perubahan lokal yang perlu disimpan, lalu jalankan `npm install` kembali.
- Pastikan Node.js, Python, dan Visual Studio Build Tools kompatibel dengan `node-gyp`.
- Jalankan `npm rebuild` atau `npx @electron/rebuild -f -w node-hid` setelah perubahan versi Electron.

### Lisensi tidak cocok setelah pindah perangkat

Lisensi memang terikat hardware ID. Catat hardware ID yang tampil pada layar aktivasi dan gunakan proses reset atau penerbitan ulang lisensi yang dikelola pemilik sistem. Jangan menyalin file `.ykk_lic` dari komputer lain sebagai solusi.

### Backup atau restore gagal

- Pastikan file backup memiliki format `kasir-warung-backup` yang dikenali. Gunakan preview sebelum memulihkan.
- Restore menulis ulang penyimpanan JSON, menghapus `kasir.db` beserta `-wal` dan `-shm`, lalu menjalankan ulang migrasi. Tutup aplikasi sebelum penggantian file secara manual.
- Setelah restore, jalankan ulang aplikasi sesuai anjuran restart pada panel backup.
- Snapshot pengaman dan snapshot internal dapat diperiksa dari folder data aplikasi.

### Transaksi void tidak muncul atau hilang dari laporan

- Void hanya dapat dilakukan oleh admin, dan transaksi yang sudah void tidak dapat diproses ulang.
- Transaksi void tetap terlihat pada Riwayat dengan label `VOID`, tetapi sengaja dikeluarkan dari total laporan keuangan serta seluruh ekspor CSV.
- Nilai laporan yang lebih kecil setelah void adalah perilaku yang benar, bukan kehilangan data.

### Fitur lanjutan tidak muncul

- Pastikan master switch fitur lanjutan menyala di Settings → Fitur Lanjutan. Halaman Fitur Lanjutan, tombol navigasi, dan hotkey `F` hanya tampil ketika master switch aktif.
- Pastikan pengguna yang login memiliki peran admin. Halaman Fitur Lanjutan bersifat khusus admin.
- Grup per fitur (laporan tambahan, fitur pelanggan tambahan, bahan baku/supplier/harga) menyala secara terpisah. Aktifkan grup yang sesuai agar bagian terkait muncul di Kasir dan Laporan.
- Ketika basis tier loyalty diatur ke `Lifetime`, tier dihitung dari agregasi total belanja pelanggan melalui query `customer-totals`. Pastikan transaksi pelanggan tersebut sudah tersimpan pada database.

### Impor Excel gagal atau sebagian baris ditolak

- Pastikan file berekstensi `.xlsx` dan memiliki sheet bernama `Menu`, `BahanBaku`, atau `Resep`.
- Baris yang bertentangan dengan data yang ada ditandai sebagai konflik dan baris tidak valid ditandai sebagai error pada rencana impor, bukan langsung diterapkan.
- Stok yang sudah ada tidak ditimpa oleh file impor; perbarui stok melalui pengelolaan menu atau bahan baku.
- Ketika sheet `Resep` terisi, nilai HPP mengikuti resep dan mengabaikan kolom `modal` manual pada sheet menu.

## Hotkey Aplikasi

Hotkey hanya diproses ketika fokus tidak berada di input, textarea, atau select:

| Tombol | Aksi |
| --- | --- |
| `K` | Buka Kasir |
| `O` | Buka Open Bill |
| `R` | Buka Riwayat |
| `L` | Buka Laporan |
| `M` | Buka Kelola Menu |
| `F` | Buka Fitur Lanjutan. Ketika fitur lanjutan tidak menyala, navigasi dialihkan ke Kasir; halaman hanya dirender untuk admin |
| `P` | Buka atau tutup drawer keranjang |
| `/` | Buka Kasir dan fokus ke pencarian |

## Keamanan dan Operasional

- Context isolation dan `nodeIntegration: false` digunakan pada window utama.
- Renderer mengakses kemampuan native melalui preload bridge, bukan melalui akses Node.js langsung.
- Panggilan IPC yang dilewatkan utilitas backup dibungkus `safeIpc` sehingga kegagalan handler dilaporkan sebagai hasil terstruktur, bukan promise yang tidak tertangani.
- `ErrorBoundary` menangkap error render pada level React dan menampilkan layar pemulihan, bukan window kosong.
- Harusnya jangan mengirim `electron/license-secret.cjs`, license key, file `.ykk_lic`, database produksi, atau data pelanggan ke repository publik, tapi yaudahlah, pake lah.
- Backup harus dilakukan sebelum upgrade, migrasi, pemindahan komputer, atau tindakan pemulihan.
- `package.json` dan source code adalah sumber kebenaran untuk script, versi, dependensi, dan konfigurasi packaging.

## Lisensi dan Kontak

Repository menyertakan file `LICENSE`. Pemilik dan kontak yang tercatat di `package.json`:

- Danzel Tampilang
- `danzeltampilang@gmail.com`
