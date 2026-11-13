import { W, BD, MT, TX, RADIUS, TYPOGRAPHY, COLOR_PALETTE } from "../../constants/design.js";

// BahanListModal — modal daftar SEMUA bahan baku (dibuka dari tombol
// "Lihat semua bahan" di panel Bahan Baku pada halaman Fitur Lanjutan).
// Panel hanya menampilkan 5 bahan; sisanya dibuka di modal ini sebagai daftar
// NAMA saja (tanpa kartu/dropdown, tanpa detail per item). Setiap nama tetap
// clickable untuk membuka detail bahan (onPick -> BahanDetailModal), sehingga
// fitur "klik nama bahan untuk lihat info" tidak hilang.
//
// Props:
//   list       - daftar bahan yang ditampilkan (sudah difilter oleh pemanggil)
//   search     - nilai kata kunci pencarian saat ini
//   onSearch   - callback perubahan kata kunci
//   onPick     - callback saat sebuah bahan dipilih (buka detail)
//   onEdit     - callback saat tombol edit dipilih
//   onDelete   - callback saat tombol hapus dipilih
//   onClose    - callback tutup
export default function BahanListModal({ list = [], search = "", onSearch, onPick, onEdit, onDelete, onClose }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }}
      onClick={onClose}
    >
      <div
        style={{ background: W, borderRadius: RADIUS.lg, width: "min(520px, 92vw)", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BD}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: TYPOGRAPHY.body.fontSize, fontWeight: 700, color: TX }}>Semua Bahan Baku</div>
            <div style={{ fontSize: TYPOGRAPHY.label.fontSize, color: MT }}>{list.length} bahan</div>
          </div>
          <button
            onClick={onClose}
            style={{ border: "none", background: "none", cursor: "pointer", color: MT, fontSize: 16 }}
            aria-label="Tutup"
          >
            &#10005;
          </button>
        </div>

        <div style={{ padding: "10px 16px 6px" }}>
          <input
            id="bahan-list-search"
            name="bahanListSearch"
            value={search}
            onChange={(e) => onSearch?.(e.target.value)}
            placeholder="Cari nama bahan baku..."
            aria-label="Cari bahan baku"
            style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BD}`, borderRadius: RADIUS.sm, padding: "6px 8px", fontSize: TYPOGRAPHY.small.fontSize, fontFamily: "inherit", background: W }}
          />
        </div>

        <div style={{ padding: "4px 16px 14px", overflowY: "auto" }}>
          {list.length === 0 ? (
            <div style={{ fontSize: TYPOGRAPHY.label.fontSize, color: MT, padding: "10px 0" }}>
              Tidak ada bahan cocok.
            </div>
          ) : (
            list.map((b) => (
              <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: `1px solid ${BD}` }}>
                <button
                  type="button"
                  style={{ flex: 1, minWidth: 0, padding: "4px 2px", border: 0, background: "transparent", textAlign: "left", cursor: "pointer", fontFamily: "inherit", fontSize: TYPOGRAPHY.small.fontSize, fontWeight: 600, color: TX }}
                  onClick={() => onPick?.(b)}
                  title="Klik untuk lihat detail bahan"
                >
                  {b.nama} <span style={{ color: MT, fontWeight: 400 }}>({b.satuan || "-"})</span>
                  {Number(b.stok) <= Number(b.minStok) && (
                    <span style={{ display: "inline-block", marginLeft: 6, color: COLOR_PALETTE.danger, fontSize: TYPOGRAPHY.label.fontSize, fontWeight: 700 }}>
                      ⚠ Stok menipis
                    </span>
                  )}
                </button>
                <button type="button" onClick={() => onEdit?.(b)} style={{ border: 0, borderRadius: RADIUS.sm, padding: "5px 9px", background: COLOR_PALETTE.infoLight, color: COLOR_PALETTE.info, cursor: "pointer", fontFamily: "inherit", fontSize: TYPOGRAPHY.label.fontSize, fontWeight: 600 }}>Edit</button>
                <button type="button" onClick={() => onDelete?.(b)} style={{ border: 0, borderRadius: RADIUS.sm, padding: "5px 9px", background: COLOR_PALETTE.dangerLight, color: COLOR_PALETTE.danger, cursor: "pointer", fontFamily: "inherit", fontSize: TYPOGRAPHY.label.fontSize, fontWeight: 600 }}>Hapus</button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
