import { memo } from "react";
import { G, W, BD, MT, RADIUS, TYPOGRAPHY } from "../constants/design.js";
import AdvancedDataPanel from "../components/AdvancedDataPanel.jsx";
import { DEFAULT_ADVANCED_FEATURES } from "../constants/advancedFeatures.js";

// ViewFiturLanjutan — halaman terpisah untuk seluruh fitur tingkat lanjut
// (import Excel menu/bahan/resep, bahan baku, supplier, loyalty tier, resep &
// HPP). Laporan tambahan (insight penjualan, ekspor PDF, cash flow) SENGAJA
// tetap tinggal di halaman Laporan.
//
// Halaman ini hanya dirender App.jsx saat saklar induk "Nyalakan Fitur Tingkat
// Lanjut" AKTIF — jadi ikut hilang/muncul bersama tombolnya.
//
// Props:
//   menu         - daftar menu (untuk editor resep & import)
//   cats         - daftar kategori (untuk import)
//   advancedData - nilai balik useAdvancedData()
//   settings     - objek settings (untuk isAdvancedFeatureOn)
//   toast_       - feedback opsional
function ViewFiturLanjutan({ menu, cats, advancedData, settings, toast_, addUndo, onImported }) {
  const adv = settings?.advancedFeatures || DEFAULT_ADVANCED_FEATURES;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header halaman */}
      <div className="page-toolbar" style={{ padding: "9px 16px", background: W, borderBottom: `1px solid ${BD}`, flexShrink: 0 }}>
        <div style={{ fontSize: TYPOGRAPHY.body.fontSize, fontWeight: 700, color: G }}>Fitur Tingkat Lanjut</div>
        <div style={{ fontSize: TYPOGRAPHY.label.fontSize, color: MT, marginTop: 2 }}>
          Bahan baku, supplier, resep &amp; HPP, loyalty tier, dan impor Excel.
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 16 }}>
        <AdvancedDataPanel
          settings={settings}
          advancedData={advancedData}
          menu={menu}
          cats={cats}
          toast_={toast_}
          addUndo={addUndo}
          onImported={onImported}
        />
      </div>
    </div>
  );
}

export default memo(ViewFiturLanjutan);
