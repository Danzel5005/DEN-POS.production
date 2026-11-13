export const ADVANCED_FEATURE_GROUPS = [
  {
    fase: "Laporan Tambahan",
    items: [
      { key: "insights", label: "Insight Penjualan", desc: "Jam ramai dan rata-rata per order, dihitung dari transaksi tersimpan." },
      { key: "pdfReport", label: "Ekspor Laporan PDF", desc: "Simpan laporan sebagai PDF memakai jalur cetak bawaan." },
      { key: "cashFlow", label: "Cash Flow Lanjutan", desc: "Pemasukan/pengeluaran per sumber, laba rugi, pelacakan hutang." },
      { key: "attendance", label: "Presensi", desc: "Sinkronisasi presensi shift dan log presensi Web-App." },
    ],
  },
  {
    fase: "Fitur Pelanggan Tambahan",
    items: [
      { key: "loyalty", label: "Loyalty Tier", desc: "Tingkatan pelanggan (Bronze–Platinum) dan diskon per tier." },
    ],
  },
  {
    fase: "Pengaturan Bahan Baku, Supplier, dan Harga tambahan",
    items: [
      { key: "bahanBaku", label: "Bahan Baku", desc: "Lacak stok bahan mentah terpisah dari menu jual." },
      { key: "supplier", label: "Database Supplier", desc: "Riwayat pembelian dan relasi supplier ke stock-in." },
      { key: "canViewCost", label: "Batasi HPP & Laba", desc: "Sembunyikan modal dan laba dari kasir non-admin." },
      { key: "resepHpp", label: "Resep & HPP Otomatis", desc: "Hitung harga pokok dari resep, bukan input manual." },
    ],
  },
];

export const DEFAULT_ADVANCED_FEATURES = {
  enabled: false,      // saklar induk — mematikan semuanya sekaligus
  insights: false,     
  pdfReport: false,    
  canViewCost: false,  
  loyalty: false,      
  bahanBaku: false,    
  supplier: false,     
  resepHpp: false,     
  cashFlow: false,     
  attendance: false,
};

// Basis perhitungan loyalty tier — dipilih user di Pengaturan (Fitur Lanjutan).
//   "transaction" : tier dihitung dari total transaksi yang sedang dibuat
//   "lifetime"    : tier dihitung dari total belanja kumulatif pelanggan
export const LOYALTY_TIER_BASIS = {
  TRANSACTION: "transaction",
  LIFETIME: "lifetime",
};

export const DEFAULT_LOYALTY_TIER_BASIS = LOYALTY_TIER_BASIS.TRANSACTION;

// Kembalikan basis yang valid; nilai tak dikenal jatuh ke default.
export function normalizeLoyaltyTierBasis(value) {
  return value === LOYALTY_TIER_BASIS.LIFETIME
    ? LOYALTY_TIER_BASIS.LIFETIME
    : DEFAULT_LOYALTY_TIER_BASIS;
}

// Normalisasi objek advancedFeatures dari settings tersimpan. Field yang tidak
// dikenal dibuang; field yang hilang diisi default. Nilai non-boolean diperbaiki.
export function normalizeAdvancedFeatures(input) {
  const src = input && typeof input === "object" ? input : {};
  const next = { ...DEFAULT_ADVANCED_FEATURES };
  for (const key of Object.keys(DEFAULT_ADVANCED_FEATURES)) {
    if (typeof src[key] === "boolean") next[key] = src[key];
  }
  return next;
}

// Guard read dipakai UI: fitur aktif hanya kalau saklar induk DAN sub-flag nyala.
export function isAdvancedFeatureOn(settings, key) {
  const a = settings?.advancedFeatures;
  if (!a || !a.enabled) return false;
  return !!a[key];
}
