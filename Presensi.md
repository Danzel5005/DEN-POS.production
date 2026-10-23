# Bikinin fitur presensi di web-app 
Dengan patokan lokasi dari Hardware yang memiliki software DEN POS yang tersinkron pada web-app tersebut
- User yang login di web-app harus memberikan izin akses GPS (minta izin dulu ya!), begitu juga untuk software DEN POS
- Berikan petunjuk jika device user (web-app atau software) tidak dapat menemukan lokasi mereka. Berikan semacam solusi troubleshooting gitulah, tapi pakai bahasa Indonesia yang baik dan benar ya.
- Buat Halaman baru "Presensi". Untuk sekarang, dapat diakses oleh seluruh role.

### Cara Kerja
- User Web-App Harus berada pada jarak maksimum 20 meter dari hardware yang memiliki software kasir yang telah di sinkronisasi `(default nya 20 meter, dapat diubah oleh user)`
- Ada "log presensi" untuk setiap shift, buatkan log presensi ini di halaman "Laporan"
- Log presensi dapat di export ke PDF
- Pada DEN POS, user dapat melihat user web-app, dan hanya `Admin software DEN POS` dapat mengubah (edit & revoke) role user web-app tersebut (Kasir, Bar, Purchasing, Manager, Admin)
- Larang user web-app untuk presensi masuk jika software DEN POS belum membuka shift.
- Larang user software DEN POS untuk menutup shift jika masih ada user web-app yang belum presensi keluar. Berikan warning, tetapi berikan opsi untuk overwrite status presesnsi user web-app untuk menutup shift.
- Berikan notifikasi pengingat untuk para user web-app untuk presensi keluar, jika user software DEN POS ingin menutup shift

## Peran User Role Web-App
Semua user memiliki akses untuk:
- Halaman Akun
- Halaman Perangkat

### Akses Role Kasir 
- Halaman Dapur
### Akses Role Bar
- Halaman Dapur
### Akses Role Purchasing
- Halaman Isi Stok
### Akses Role Manager
- Halaman Laporan
- Halaman Riwayat
- Halaman Data Tersinkron
### Akses Role Admin
- Semua Halaman

# PENTING
- Jalankan dengan teliti, jangan ada yang terlewat.
- Sekalian update versi jadi 1.4.0
- Test otomatis gausah lah, test di ``` npm run build ``` aja untuk vercel, sama software DEN POS. nitip ``` supabase db push ``` buat push fungsi baru ke supabase (kalau ada).
- Kalau sempat (PRIORITAS TERAKHIR) Pastikan fitur bekerja untuk Iphone/Android (OS apapun untuk mobile device)