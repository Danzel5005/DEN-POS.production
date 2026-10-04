# PANDUAN Phase B — Backend Supabase (Cloud Sync DEN POS)

> Lanjutan dari `PLAN-WEBSYNC-UI-CLOUD.md` §3. Phase A (UI POS) sudah selesai.
> Dokumen ini = **cara memasang & menguji** backend Supabase yang sudah dibuat.

---

## 0. Apa yang sudah dibuat

```
supabase/
├── config.toml                          # verify_jwt=false utk fungsi mesin
├── migrations/
│   └── 0001_init.sql                    # tabel + RLS + can_access_store + pair_device
├── functions/
│   ├── _shared/
│   │   ├── cors.ts                      # header CORS + helper json/fail
│   │   ├── supabase.ts                  # service_role client
│   │   └── verify.ts                    # verifikasi HMAC + anti-replay nonce
│   ├── devices-register/index.ts        # POST /devices-register
│   ├── devices-status/index.ts          # GET  /devices-status/:id
│   ├── devices-heartbeat/index.ts       # POST /devices-heartbeat
│   └── sync-upload/index.ts             # POST /sync-upload
└── sync-parity.test.mjs                 # tes paritas kripto POS↔server
scripts/
└── sign-request.mjs                     # bikin header HMAC utk uji manual
```

---

## 1. Skema kredensial (PENTING — sudah diselaraskan POS↔server)

Server **tidak** menyimpan `device_secret` plaintext. Alih-alih:

```
signingKey      = hexLower( sha256(device_secret) )   ← kunci HMAC
credential_hash = signingKey                          ← yang disimpan server
signature       = hex( HMAC-SHA256(signingKey, `${ts}.${nonce}.${rawBody}`) )
```

- POS menurunkan `signingKey` lewat `identity.getSecretHash()`.
- Saat **register**, POS mengirim `secretProof = signingKey` di body supaya
  server bisa memverifikasi device yang belum terdaftar.
- `device_secret` tetap hanya milik POS, tidak pernah dikirim.

Perubahan POS yang menyertai Phase B (sudah diterapkan):
- `electron/device-identity.cjs` → tambah `getSecretHash()`.
- `electron/device-sync-client.cjs` → menandatangani dengan `getSecretHash()`
  dan mengirim `secretProof` saat register.

---

## 2. Prasyarat

- Node.js (untuk `sign-request.mjs`)
- [Supabase CLI](https://supabase.com/docs/guides/cli): `npm i -g supabase`
- Akun + project Supabase (gratis cukup)
- Docker Desktop **hanya** jika ingin menjalankan stack lokal (`supabase start`)

---

## 3. Setup project Supabase

1. Buat project di [supabase.com](https://supabase.com) → **New project**.
   Catat **Project ref** (Settings → General), mis. `abcdefghijklm`.
2. Ambil kredensial dari **Settings → API**:
   - `anon key` → untuk web-app nanti.
   - `service_role key` → **rahasia**, hanya untuk Edge Function (otomatis
     tersedia sebagai env `SUPABASE_SERVICE_ROLE_KEY` saat deploy).
3. Login & link:
   ```powershell
   supabase login
   supabase link --project-ref <project-ref>
   ```

---

## 4. Jalankan migrasi (tabel + RLS + RPC)

```powershell
supabase db push
```
Ini menerapkan `migrations/0001_init.sql`. Alternatif: tempel isi file itu ke
**SQL Editor** di dashboard.

Verifikasi di SQL Editor:
```sql
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('stores','devices','pairing_codes','store_users','synced_transactions','device_nonces');
-- harus mengembalikan 6 baris
```

---

## 5. Deploy Edge Functions

`config.toml` sudah menyetel `verify_jwt = false` untuk fungsi mesin
(karena auth-nya HMAC device, bukan JWT). Cukup:

```powershell
supabase functions deploy devices-register
supabase functions deploy devices-status
supabase functions deploy devices-heartbeat
supabase functions deploy sync-upload
supabase functions deploy kds-create-ticket
supabase functions deploy kds-cancel-tickets
```

Atau sekaligus:
```powershell
supabase functions deploy devices-register devices-status devices-heartbeat sync-upload kds-create-ticket kds-cancel-tickets
```

> `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` otomatis tersedia di runtime
> Edge Function. Tidak perlu menyetel manual.

**URL dasar** yang dipakai POS:
```
https://<project-ref>.supabase.co/functions/v1
```

---

## 5b. WAJIB deploy ulang setelah memperbaiki kode fungsi

Edge Function yang sudah di-deploy **tidak ikut berubah** saat Anda mengedit
file di repo. Setiap kali `supabase/functions/**` diubah, deploy ulang:

```powershell
supabase functions deploy devices-register devices-status devices-heartbeat sync-upload kds-create-ticket kds-cancel-tickets
```

### Perbaikan penting: GET tidak boleh mengirim body

**Gejala:** web-app bilang pairing "Berhasil", tetapi POS tetap menampilkan
**"Perangkat Belum Dipasangkan"**.

**Sebab:** POS memanggil `devices-status` dengan method **GET** sambil mengirim
body `"{}"`. Node `fetch` menolak ini:
`TypeError: Request with GET/HEAD method cannot have body`. Akibatnya polling
gagal sebelum sempat menghubungi server.

**Perbaikan (dua sisi, sudah diterapkan di repo):**
- `electron/device-sync-client.cjs` — **tidak** mengirim body untuk GET/HEAD,
  tetapi tanda tangan tetap dihitung atas `"{}"`.
- `supabase/functions/devices-status/index.ts` — menormalkan body kosong:
  `const rawBody = (await req.text()) || "{}";`

**Setelah menarik perubahan ini:**
1. **Deploy ulang** `devices-status` (perintah di atas).
2. **Restart** aplikasi POS (`npm run electron:dev`) — perubahan
   `electron/*.cjs` tidak hot-reload.

---

## 6. Hubungkan POS ke Supabase

1. Jalankan aplikasi: `npm run electron:dev`
2. Login **admin** → **Pengaturan → Sync Cloud**
3. Isi **URL Backend** dengan URL di atas → **Simpan**
4. Klik **"Daftarkan & Minta Kode"** → muncul kode pairing (mis. `AB12CD34`).

> ✅ **Path sudah dicocokkan.** POS memanggil nama fungsi Supabase secara
> langsung (tanpa `/api`):
> - `/devices-register`
> - `/devices-status/<deviceId>`
> - `/devices-heartbeat`
> - `/sync-upload`
>
> Jadi `baseUrl` harus `https://<ref>.supabase.co/functions/v1` (tanpa `/api`).
>
> ⚠️ Jika pernah muncul **"Requested function was not found"**, itu karena
> `baseUrl` masih memuat `/api`. Hapus `/api` dari kolom URL Backend.

---

## 7. Uji manual — SATU perintah (`test-register.mjs`)

**Pakai cara ini.** Skrip `scripts/test-register.mjs` menandatangani DAN
mengirim dalam **satu proses Node**, jadi body dijamin identik → tidak akan
kena `BAD_SIGNATURE`.

```powershell
node scripts/test-register.mjs "<device_secret>" "<device_id>" "https://<ref>.supabase.co/functions/v1"
```

Contoh:
```powershell
node scripts/test-register.mjs "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" "dev_475c13148a197a87" "https://uopfinlwlvichryukvng.supabase.co/functions/v1"
```

Harapan:
```json
{ "ok": true, "deviceId": "...", "pairing_code": "9WMF3J99",
  "expires_at": "...", "qr_payload": "denpos://pair?code=9WMF3J99" }
```

> 💡 Skrip otomatis memperbaiki `secretProof` bila `body.json` Anda salah, dan
> mencetak `signature`/`timestamp`/`nonce` agar mudah di-debug.

### ⚠️ Kenapa BUKAN PowerShell + curl?

Cara lama (`sign-request.mjs` → salin header → `curl.exe --data-raw $BODY`)
**rawan** di Windows: PowerShell sering membuang tanda kutip pada `$BODY`
sehingga body yang **dikirim** berbeda dari yang **ditandatangani** →
`BAD_SIGNATURE`. Ini bug alatnya, bukan bug POS.

Kalau tetap ingin memakai `sign-request.mjs` (mis. untuk debugging), simpan body
ke file dan kirim dengan `@file` supaya kutip tak berubah:
```powershell
# body.json HARUS memuat secretProof = sha256(device_secret)
node scripts/sign-request.mjs --secret $SECRET --device $DEVICE --path /devices-register --body (Get-Content -Raw body.json) | ConvertFrom-Json
curl.exe -X POST "$BASE/devices-register" -H "..." --data-binary "@body.json"
```

> Aturan emas: **body yang ditandatangani = body yang dikirim, byte-per-byte**.

---

## 8. Uji pairing (web-app / SQL)

`pair_device` butuh user login (`auth.uid()`), jadi paling mudah diuji lewat
web-app. Untuk cepat, di SQL Editor bisa memeriksa data:

```sql
select device_id, status, store_id, last_seen_at from devices;
select device_id, expires_at, used_at from pairing_codes order by created_at desc limit 5;
```

Setelah web-app memanggil `pair_device('AB12CD34')`, `devices.status` berubah
jadi `active`, `devices.store_id` terisi, dan baris `store_users` dibuat.
POS akan mendeteksi via polling `devices-status` (≤5 detik) dan menandai
perangkat terpasang → auto-send 5 menit mulai berjalan.

---

## 9. Uji negatif (wajib)

| Skenario | Cara | Harapan |
|---|---|---|
| Signature salah | ubah header `X-Device-Signature` | `401 BAD_SIGNATURE` |
| Timestamp basi | set timestamp 1 jam lalu | `401 TIMESTAMP_OUT_OF_RANGE` |
| Nonce diulang | kirim request sama 2× | `409 NONCE_REPLAY` |
| Device revoked | `update devices set status='revoked'` lalu panggil status | `403 DEVICE_REVOKED` |
| Device belum pair upload | `sync-upload` sebelum pairing | `403 DEVICE_NOT_PAIRED` |
| Isolasi store (RLS) | login user A, `select * from synced_transactions` | hanya baris store A |

Contoh revoke:
```sql
update devices set status = 'revoked' where device_id = 'dev_0123456789abcdef';
```
POS akan otomatis `clearRegistration()` saat polling berikutnya (sudah berjalan
di `device-sync-service.cjs`).

---

## 10. Path (SUDAH dicocokkan — tidak perlu diubah lagi)

POS memakai nama fungsi Supabase secara langsung:
```
/devices-register
/devices-status/<deviceId>
/devices-heartbeat
/sync-upload
```

Supabase menyajikan Edge Function di `.../functions/v1/<nama-fungsi>`, jadi
pasangan yang benar:
```
baseUrl : https://<ref>.supabase.co/functions/v1
path    : /devices-register   dst.
```

**Jangan** menambahkan `/api` di `baseUrl` — itu penyebab error
`Requested function was not found` (Supabase mengira ada fungsi bernama `api`).

> `devices-status/index.ts` membaca `deviceId` dari **segmen terakhir path**,
> jadi `/devices-status/dev_xxx` bekerja tanpa perubahan di sisi server.

### Bila Anda TETAP ingin path ber-prefix `/api` (opsional)
Ini hanya perlu bila ada klien lain yang sudah terlanjur memakai `/api/*`.
Gunakan proxy/rewrite (Cloudflare/nginx) yang memetakan `/api/*` →
`/functions/v1/*`. Untuk POS sendiri, cara paling sederhana tetap: pakai path
tanpa `/api` seperti di atas.

---

## 11. Keamanan — checklist

- [x] `device_secret` tidak disimpan plaintext (server hanya `credential_hash`).
- [x] `pairing_codes` disimpan sebagai hash; sekali pakai; kedaluwarsa 10 menit.
- [x] Nonce + timestamp → anti-replay (`device_nonces`).
- [x] RLS = isolasi store (web-app tak bisa lihat store lain).
- [x] `verify_jwt = false` **hanya** untuk fungsi mesin; fungsi memakai
      `service_role` di sisi server, tidak mengekspos data ke client tak sah.
- [ ] Audit log `device_events` — fase lanjutan.
- [ ] Rate limiting per-IP/per-device — lihat §12.

### Pembersihan berkala (opsional)
Jalankan di SQL Editor atau `pg_cron`:
```sql
delete from pairing_codes where expires_at < now() - interval '1 day';
delete from device_nonces  where seen_at    < now() - interval '1 hour';
```

---

## 12. Rate limiting (opsional tapi disarankan)

Edge Function bisa membatasi trial per-device dengan menghitung
`device_nonces` per menit, atau pakai Cloudflare di depan. Contoh cepat di
`verify.ts` (tambahkan sebelum insert nonce):
```ts
const { count } = await db.from("device_nonces")
  .select("device_id", { count: "exact", head: true })
  .eq("device_id", deviceId)
  .gte("seen_at", new Date(Date.now() - 60_000).toISOString());
if ((count ?? 0) > 120) return { ok: false, status: 429, error: "RATE_LIMITED" };
```

---

## 13. Menjalankan lokal (opsional)

Butuh Docker Desktop:
```powershell
supabase start
supabase db reset           # terapkan migrations/0001_init.sql
supabase functions serve devices-register --no-verify-jwt
# baseUrl lokal: http://127.0.0.1:54321/functions/v1
```

---

## 14. Tes otomatis

```powershell
npx vitest run supabase/sync-parity.test.mjs   # paritas kripto POS↔server (5 tes)
npx vitest run                                  # seluruh suite
```

`sync-parity.test.mjs` membuktikan signature yang dibuat POS akan **lulus**
algoritma verifikasi server (dan gagal bila body diubah / memakai secret
mentah), tanpa perlu menjalankan Deno.

---

## 15. Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| `401 BAD_SIGNATURE` | Body berubah antara tanda tangan & kirim (umum di PowerShell+curl), atau `signingKey` bukan `sha256(secret)`. **Uji manual pakai `node scripts/test-register.mjs ...`** (§7). Pastikan POS sudah pakai `getSecretHash()`. |
| `400 INVALID_SECRET_PROOF` | Body register belum memuat `secretProof` (= sha256(secret)). `test-register.mjs` mengisinya otomatis. |
| `400 INVALID_JSON` | Body bukan JSON valid (kutip hilang). Hindari `--data-raw $BODY` di PowerShell; pakai `test-register.mjs`. |
| `404 Requested function was not found` | `baseUrl` masih memuat `/api`, atau fungsi belum di-deploy. Lihat §6 & §10. |
| POS tetap bilang **"Perangkat Belum Dipasangkan"** padahal web-app sudah "Berhasil" | **GET tidak boleh punya body.** Dulu client mengirim body pada GET → fetch melempar `Request with GET/HEAD method cannot have body`, jadi polling gagal total. **Sudah diperbaiki** di `device-sync-client.cjs`. Wajib **deploy ulang** `devices-status`: lihat §5b di bawah. |
| `404 DEVICE_NOT_REGISTERED` | Panggil `devices-register` lebih dulu. |
| `403 DEVICE_REVOKED` | Device di-revoke; admin perlu buka lewat DB atau rotate kredensial di POS. |
| `500 DB_UPSERT_FAILED` | Cek migrasi sudah dijalankan & kolom cocok. |
| POS: "URL backend belum diatur" | Isi kolom URL di tab Sync Cloud. |
| POS: gagal terus tiap 5 menit | Cek **Edge Function logs** (`supabase functions logs <nama>`) dan pastikan path sesuai §10. |
