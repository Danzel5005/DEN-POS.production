# Rencana Implementasi — KDS (Kitchen Display System) via Supabase

Status: **Implementasi POS, backend, dan layar KDS sudah ditulis; belum go-live.** Migrasi dan Edge Functions belum dideploy, dan migrasi belum bisa diuji pada database lokal yang tidak tersedia.
Eksekusi pakai **Engineer Agent**. Bug yang muncul saat implementasi → Troubleshooter Agent.

Keputusan awal: KDS **hanya lewat Supabase** (tanpa jalur LAN/WebSocket), karena jaringan toko kadang tidak mengizinkan LAN antar-device atau komputer tidak bisa membuat hotspot.

---

## 1. Aturan Tampilan (WAJIB)

**UI selalu menampilkan label, tidak pernah key/ID internal.**

| Yang tampil di layar | Bukan |
|---|---|
| "Es Kopi Susu", "Minuman", "Dapur" | `kopi_susu`, `minuman`, `station_1` |
| "Nomor Meja: 5", "Jumlah Pax: 2" | `nomor_meja`, `jumlah_pax` |
| "Baru", "Diproses", "Siap", "Diantar", "Batal" | `new`, `preparing`, `ready`, `served`, `cancelled` |
| "Tambahan", "Pesanan Baru" | `addition`, `order` |
| satuan: "porsi", "cup" | `unit_porsi` |

Cara menegakkannya:

1. **Snapshot label saat tiket dibuat.** POS menyimpan label (nama item, satuan, kategori, station, meja, kasir) langsung di payload tiket. KDS hanya merender kolom `*_label`; tidak ada lookup key → label di sisi KDS. Dengan begitu KDS tidak bergantung pada menu/kategori yang bisa berubah atau terhapus setelah tiket dikirim.
2. **Fallback label tunggal.** Kategori/station tak dikenal → "Lainnya" (konsisten dengan `getCategoryLabel` di `electron/category-label.cjs`). Jangan membuat fungsi label baru di jalur lain (hindari duplikasi seperti `getCategoryName` vs `getCategoryLabel`).
3. **Status ditampilkan lewat satu konstanta peta** `KDS_STATUS_LABEL` (file bersama), key status hanya dipakai di logika/DB.
4. **Cek di review:** tidak ada `{ticket.status}`, `{item.kategori}`, `{field.key}` yang dirender langsung di JSX. Tambah satu test yang gagal bila komponen KDS merender nilai key (mis. render dengan data berkey khas lalu assert teksnya tidak muncul).

---

## 2. Ruang Lingkup

**Masuk:**
- Pesanan dari kasir (bayar langsung dan open bill) terkirim ke layar dapur/bar secara live.
- Tambahan item pada open bill → tiket "Tambahan". Pengurangan/void → tiket "Batal".
- Layar KDS (web) dengan alur status Baru → Diproses → Siap → Diantar.
- Pemetaan kategori → station (mis. Dapur, Bar), diatur di Settings POS.
- Antrean offline di POS bila internet putus sementara.

**Tidak masuk (sengaja):**
- Tidak ada jalur LAN untuk KDS.
- Tidak mengubah `.ykk_lic`, `checkLicense`, `activateLicense`, protokol pairing LAN (`.ykk_hostlic`), maupun fitur diskon.
- Tidak mengubah logika stok. KDS hanya *membaca* order, bukan sumber stok. Device A tetap arbiter stok.
- Per-item "selesai" di KDS (fase lanjutan, §9).

**Trade-off yang diterima:** karena Supabase-only, **POS dan layar KDS sama-sama butuh internet**. Internet putus → tiket tertahan di outbox POS dan dapur tidak melihatnya sampai tersambung (kasir diberi indikator, §6). Ini harga dari tidak memakai LAN.

---

## 3. Arsitektur

```
POS (Device mana pun yang membuat order)
   │  fetch HTTPS → RPC kds_create_ticket  (outbound saja)
   ▼
Supabase (Postgres + RLS + Realtime)
   ▲  Realtime subscribe + RPC kds_set_status
   │
KDS web (route /kds di DEN-POS-Monitoring, jalan di tablet/browser dapur)
```

- **Siapa yang mengirim:** device mana pun yang membuat order (Device A maupun Client LAN). Tidak perlu lewat Device A, karena Supabase sudah jadi titik temu dan LAN tidak diandalkan.
- **Idempotensi:** tiap tiket punya `client_ticket_id` unik per store; retry dari outbox aman (tidak dobel).
- **Tempat KDS:** route `/kds` di repo Monitoring (sudah ada `react-router-dom`, `vercel.json` rewrite SPA, Supabase client, dan alur auth/pairing). Tidak perlu aplikasi baru; cukup buka URL di tablet. Bila kelak butuh dipisah, route itu bisa diekstrak.
- **POS memakai `fetch` bertanda tangan HMAC ke Supabase Edge Functions**, lalu fungsi memanggil RPC SQL dengan service-role. POS tidak menambah `@supabase/supabase-js`; web KDS memakai `supabase-js` yang sudah terpasang.

### Otentikasi (prasyarat)
POS sudah memiliki pairing cloud melalui `electron/device-identity.cjs` dan `electron/device-sync-service.cjs`; kredensial tersimpan di `userData/.pos_device`, sedangkan URL backend berada di `device-sync.json`. KDS memakai kembali jalur yang sama:

- Tidak ada kredensial KDS kedua dan tidak ada perubahan pada `.ykk_lic`/`.ykk_hostlic`.
- Edge Functions KDS memverifikasi HMAC dan status pairing sebelum memanggil RPC security definer; RPC tulis hanya dapat dipanggil service-role.
- Layar KDS memakai Supabase Auth biasa (akun anggota store, peran `kds`). Satu akun bersama untuk tablet dapur sudah cukup.
- **Jika pairing POS→Supabase dibangun lebih dulu lewat Remote Monitoring, KDS cukup memakainya.** Jika belum, Fase 1 di bawah memuat pairing minimal.

---

## 4. Skema Supabase (migrasi `0005_kds.sql`)

```sql
-- Station: dapur / bar / dst. Label yang tampil di KDS.
create table kds_stations (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references stores(id) on delete cascade,
  label       text not null,              -- "Dapur", "Bar"
  category_keys text[] not null default '{}', -- key kategori POS (internal, tidak ditampilkan)
  sort_order  int  not null default 0,
  unique (store_id, label)
);

create table kds_tickets (
  id               uuid primary key default gen_random_uuid(),
  store_id         uuid not null references stores(id) on delete cascade,
  client_ticket_id text not null,         -- idempoten: "<device_id>:<ref>:<seq>"
  kind             text not null check (kind in ('order','addition','cancel')),
  kind_label       text not null,         -- "Pesanan Baru" | "Tambahan" | "Batal"
  source_ref       text not null,         -- id bill/transaksi di POS (untuk batal & grouping)
  source_label     text not null,         -- "Bill #12" / "Transaksi #0042"
  station_id       uuid references kds_stations(id) on delete set null,
  station_label    text not null,         -- snapshot, fallback "Lainnya"
  table_label      text,                  -- "Meja 5" (sudah berupa teks siap tampil)
  extras           jsonb not null default '[]', -- [{label:"Jumlah Pax", value:"2"}] SUDAH label
  note             text,
  items            jsonb not null,        -- [{label,qty,unit_label,note}] SUDAH label
  status           text not null default 'new'
                   check (status in ('new','preparing','ready','served','cancelled')),
  created_by_label text,                  -- nama kasir
  device_label     text,                  -- nama device pengirim
  created_at       timestamptz not null default now(),
  preparing_at timestamptz, ready_at timestamptz, served_at timestamptz,
  unique (store_id, client_ticket_id)
);
create index on kds_tickets (store_id, status, created_at);
create index on kds_tickets (store_id, source_ref);
```

- **Semua kolom tampil sudah berupa label/teks siap tampil** (§1). Key hanya hidup di `category_keys` dan `status`.
- **RLS:** `select` dibatasi ke anggota store (pola sama dengan tabel lain). **Tidak ada policy insert/update langsung** dari klien; semua tulis lewat RPC security definer.
- **RPC:**
  - `kds_create_ticket(device_id, device_secret, payload)` → insert `on conflict (store_id, client_ticket_id) do nothing`.
  - `kds_cancel_tickets(device_id, device_secret, source_ref)` → tandai tiket aktif milik `source_ref` menjadi `cancelled`.
  - `kds_set_status(ticket_id, new_status)` → state machine ketat: `new→preparing→ready→served`, `*→cancelled`; loncat/mundur ditolak (kecuali "undo" satu langkah, lihat §5). Set kolom `*_at`.
- **Realtime:** `alter publication supabase_realtime add table kds_tickets;` (RLS tetap berlaku di Realtime). KDS subscribe dengan filter `store_id`.
- **Retensi:** hapus tiket `served/cancelled` lebih tua dari N hari (default 7) lewat job terjadwal atau RPC pembersih. Tiket tidak dipakai sebagai laporan; sumber riwayat tetap transaksi.

---

## 5. Perubahan Sisi POS (`DEN-POS.production`)

| # | File | Perubahan |
|---|---|---|
| 1 | `electron/device-sync-service.cjs` | Signed fetch ke Edge Functions; outbox KDS disimpan dalam `device-sync.json` yang sudah ada dan retry melalui service cloud yang sama. |
| 2 | `electron/main.cjs` | Registrasi handler IPC: `kds-send`, `kds-cancel`, `kds-status` (jumlah pending/terkirim), `kds-settings-get/set`. |
| 3 | `electron/preload.js` | Expose `api.kdsSend`, `api.kdsCancel`, `api.kdsStatus` (di dekat `transactionSync`, baris ~95). |
| 4 | `src/utilities/kds.js` (baru) | **Pure function** `buildKdsTickets({items, prevItems, categories, stations, meta})` → daftar tiket (per station, jenis order/addition/cancel) dengan semua label sudah di-snapshot. Dipisah supaya mudah dites. |
| 5 | `src/hooks/useCart.js` — `saveOpenBill` (~baris 241–330) | Setelah bill tersimpan: bill baru → tiket `order` dari seluruh item; update bill → pakai selisih `oldItemsById` vs `newItemsById` yang **sudah dihitung di sana**: selisih positif → `addition`, negatif → `cancel`. Hanya baca data; **tidak mengubah** perhitungan stok/`stockDelta`. |
| 6 | `src/hooks/useCart.js` — `processPayment` (~baris 390–500) | Bayar langsung (tanpa bill) → tiket `order`. Bila item berasal dari open bill yang sudah terkirim, **jangan kirim ulang** (tandai `kdsSent` pada bill). Dipanggil setelah `api.processPayment` sukses, dan kegagalan KDS **tidak boleh** menggagalkan pembayaran. |
| 7 | `src/hooks/useHistoryVoid.js` (`voidTrx`) dan hapus open bill | Panggil `api.kdsCancel(sourceRef)` agar tiket aktif ikut batal. Periksa semua jalur hapus bill (`bills-clear`, hapus manual), bukan hanya satu. |
| 8 | `src/components/modals/settings-tabs/KdsSettingsTab.jsx` (baru) + `index.js` | Tab "KDS": toggle aktif, URL project + pairing, daftar station (label + kategori yang dipetakan, **tampilkan label kategori**), pilihan "kategori tanpa station: tidak dikirim / kirim ke station X". Wajib state: nonaktif, menghubungkan, aktif, error, offline. |
| 9 | `src/components/LanSyncStatus.jsx` (pola) → indikator KDS | Pill kecil di workspace: tersembunyi bila KDS nonaktif; "N tiket menunggu terkirim" bila outbox pending. Tidak mengganggu kasir yang tidak memakai KDS. |

Aturan routing: **hanya kategori yang dipetakan ke station yang dikirim.** Item tanpa station (mis. rokok, barang kemasan di warung) default **tidak** masuk KDS, kecuali diatur lain di tab KDS.

Struktur nilai di tiket (kontrak antara POS dan KDS) memakai teks yang sudah final, contoh:
`items: [{ label: "Es Kopi Susu", qty: 2, unit_label: "cup", note: "kurang manis" }]`.

---

## 6. Perilaku Offline & Kegagalan

| Kondisi | Perilaku |
|---|---|
| Internet POS putus | Transaksi/bill tetap sukses lokal. Tiket masuk outbox; pill menampilkan "N tiket menunggu terkirim". Terkirim otomatis saat tersambung, urut waktu. |
| Retry ganda | Aman, `client_ticket_id` unik. |
| Supabase error / secret ditolak | Pembayaran tidak terganggu; pill berubah ke status error dengan pesan jelas; tiket tetap di outbox. |
| KDS tablet putus | Banner "Terputus — data terakhir jam HH:MM". Saat sambung ulang, muat ulang seluruh tiket aktif (snapshot), lalu lanjut Realtime. |
| Tiket tertahan lama | Tiket menampilkan jam order asli (bukan jam terkirim), supaya dapur tahu umur sebenarnya. |
| Dua tablet KDS menekan status bersamaan | RPC state machine menolak transisi usang; UI memuat ulang tiket itu. |

---

## 7. Layar KDS (route `/kds` di Monitoring)

- Login → pilih station (tampil **label**) atau "Semua".
- Kolom/lane: **Baru | Diproses | Siap**; "Diantar" menghilang dari layar setelah ditekan (tersedia lewat tab Riwayat singkat).
- Kartu tiket: label jenis (Pesanan Baru / Tambahan / Batal), label sumber (Bill #12), label meja, daftar item `qty × label (satuan)` + catatan, nama kasir, **timer umur** (berubah warna melewati batas yang bisa diatur), bunyi tiket baru.
- Aksi: satu tombol besar per kartu ("Proses", "Siap", "Diantar") + "Kembalikan" satu langkah.
- Tiket "Batal" tampil mencolok dan bisa di-dismiss.
- State wajib: loading, kosong ("Belum ada pesanan"), live, terputus, error, tidak ada station.
- Mode layar penuh, huruf besar, target sentuh besar (dipakai di tablet berminyak/basah).

---

## 8. Scalability & Biaya

- **Volume:** tiket ± 1 KB. 300 order/hari ≈ 0,3 MB/hari ≈ 9 MB/bulan; dengan retensi 7 hari, tabel tetap kecil. Index `(store_id, status, created_at)` cukup.
- **Realtime:** per order kira-kira 4 event (insert + 3 perubahan status) × jumlah layar. Jauh di bawah batas wajar untuk satu toko; multi-tenant tambahan hanya menambah trafik linear. **Cek batas plan Supabase saat ini sebelum go-live** (jumlah koneksi Realtime, pesan/bulan, aturan pause project tidak aktif) — angka plan bisa berubah.
- **Satu Supabase project untuk semua toko** (sesuai desain Monitoring); isolasi oleh RLS + `store_id`. Pastikan setiap policy dan RPC diuji lintas-store.
- **Tidak ada beban tambahan di Electron** selain satu `fetch` kecil per order.

---

## 9. Fase Implementasi

**Fase 0 — Prasyarat & kontrak (kode selesai)**
- Putuskan pairing POS→Supabase (reuse Remote Monitoring bila sudah ada). Tentukan format `device_secret`.
- Tulis `src/utilities/kds.js` + test (`buildKdsTickets`, label snapshot, routing station, selisih addition/cancel, fallback "Lainnya").

**Fase 1 — Backend Supabase (kode/migrasi selesai; belum dieksekusi)**
- Migrasi `0003_kds.sql`: tabel, RLS, RPC, publication Realtime, pembersih retensi.
- Test RLS lintas-store dan state machine status.

**Fase 2 — POS kirim tiket (kode selesai)**
- `kds-sync.cjs`, IPC, preload, hook `saveOpenBill`/`processPayment`, outbox, pill status.
- Gate: pembayaran tidak pernah gagal karena KDS; retry tidak menggandakan tiket.

**Fase 3 — Layar KDS (kode selesai)**
- Route `/kds`, Realtime subscribe, aksi status, timer, bunyi, state offline/error.
- Test render: **tidak ada key mentah yang tampil** (§1).

**Fase 4 — Settings POS & batal (kode selesai)**
- `KdsSettingsTab`, pemetaan station, jalur void/hapus bill → `kdsCancel`.

**Fase 5 — Hardening (sebagian; perlu operasionalisasi)**
- Rate limit RPC, rotasi `device_secret`, audit sederhana (siapa mengubah status).
- Uji dunia nyata: internet putus-nyambung, 2 tablet KDS, bill dengan banyak tambahan.

Catatan implementasi: rate limit per store (120 tiket/menit), metadata aktor status terakhir, dan `kds_prune_tickets(7)` sudah dibuat. Jadwalkan RPC pembersih lewat Supabase Cron sebelum go-live. Migrasi, RLS lintas-store, dan Edge Functions belum dijalankan/deploy karena project Supabase tidak tersedia di workspace.

**Fase lanjutan (di luar MVP):** status per item, badge "Siap" di POS (butuh Realtime di sisi POS → pertimbangkan `supabase-js` saat itu), printer tiket dapur sebagai cadangan, statistik waktu saji.

---

## 10. Risiko & Keputusan Terbuka

1. **Ketergantungan internet** (trade-off §2) — diterima; mitigasi: outbox + indikator jelas. Opsi cadangan murah di kemudian hari: cetak tiket ke printer dapur.
2. **Supabase belum dideploy** — migrasi dan fungsi KDS harus diterapkan ke project yang dipakai Monitoring sebelum membuka route `/kds`.
3. **Void/hapus bill punya banyak jalur** — kalau satu jalur lupa memanggil `kdsCancel`, dapur akan memasak pesanan yang sudah batal. Perlu audit semua caller.
4. **Bill yang diubah di Device lain** (Client LAN) — pastikan `kdsSent`/selisih item dihitung dari bill terkini, bukan salinan lokal usang.
5. **Keputusan untuk Danzel:** (a) item tanpa station dikirim atau tidak (default: tidak), (b) retensi tiket (default 7 hari), (c) apakah "Diantar" wajib atau cukup "Siap".

---

## 11. Batasan yang Dipertahankan

- Tidak ada perubahan pada `.ykk_lic`, `checkLicense`, `activateLicense`.
- Tidak ada perubahan pada pairing/aktivasi LAN (`.ykk_hostlic`).
- Fitur diskon tidak disentuh.
- Logika stok dan `stockDelta` hanya dibaca, tidak diubah.
- Kegagalan KDS tidak boleh menggagalkan transaksi atau pembayaran.
- Semua teks di UI KDS dan tab Settings KDS adalah **label**, bukan key.
