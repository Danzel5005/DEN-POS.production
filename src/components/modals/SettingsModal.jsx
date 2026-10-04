import { useState } from "react";
import { G, W, BD, MT, row, RADIUS, TYPOGRAPHY, COLOR_PALETTE } from "../../constants/design.js";
import {
  PrinterSettingsTab,
  WarungSettingsTab,
  PaymentSettingsTab,
  QrisSettingsTab,
  ReceiptSettingsTab,
  PricingSettingsTab,
  BackupSettingsTab,
  UsersSettingsTab,
  AdvancedSettingsTab,
  CloudSyncSettingsTab,
  KdsSettingsTab,
} from "./settings-tabs/index.js";
import { useDeviceSync } from "../../hooks/useDeviceSync.js";

const SETTINGS_TABS = [
  ["printer", "Printer"],
  ["warung", "Nama Warung"],
  ["payment", "Metode Bayar"],
  ["qris", "QRIS"],
  ["receipt", "Resi"],
  ["pricing", "Harga"],
  ["backup", "Backup"],
  ["users", "Kelola Pengguna"],
  ["advanced", "Fitur Lanjutan"],
  ["cloud", "Sync Cloud"],
  ["kds", "KDS"],
];

function SettingsTabButton({ tab, activeTab, onSelect, children }) {
  return <button onClick={() => onSelect(tab)} style={{ display: "flex", alignItems: "center", flexShrink: 0, width: "100%", boxSizing: "border-box", minHeight: 38, padding: "10px 13px", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 600, textAlign: "left", background: activeTab === tab ? "rgba(255,255,255,0.18)" : "transparent", color: W, borderLeft: activeTab === tab ? "3px solid #fff" : "3px solid transparent", transition: "all 0.15s" }}>{children}</button>;
}

function SettingsPanel({ tab, settingsH, authH, menu, cats, deviceH }) {
  const panelProps = { settingsH, menu, cats };
  switch (tab) {
    case "printer": return <PrinterSettingsTab {...panelProps} />;
    case "warung": return <WarungSettingsTab {...panelProps} />;
    case "payment": return <PaymentSettingsTab {...panelProps} />;
    case "qris": return <QrisSettingsTab {...panelProps} />;
    case "receipt": return <ReceiptSettingsTab {...panelProps} />;
    case "pricing": return <PricingSettingsTab {...panelProps} />;
    case "backup": return <BackupSettingsTab {...panelProps} />;
    case "users": return <UsersSettingsTab authH={authH} />;
    case "advanced": return <AdvancedSettingsTab {...panelProps} />;
    case "cloud": return <CloudSyncSettingsTab authH={authH} deviceH={deviceH} />;
    case "kds": return <KdsSettingsTab settingsH={settingsH} cats={cats} deviceH={deviceH} />;
    default: return null;
  }
}

export default function SettingsModal({ settingsH, authH, menu = [], cats = [] }) {
  const [tab, setTab] = useState("printer");
  // Hook harus dipanggil di level komponen (bukan di dalam switch), dan hidup
  // selama modal terbuka. Auto-send 5 menit sendiri berjalan di main process.
  const deviceH = useDeviceSync({ toast_: settingsH?.toast_, isAdmin: true });
  const close = () => settingsH.setSettingsModal(false);

  return <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300 }} onClick={(event) => event.target === event.currentTarget && close()}>
    <div style={{ background: W, borderRadius: RADIUS.lg, padding: 20, width: 755.25, height: 559.19, minWidth: 755.25, minHeight: 559.19, boxSizing: "border-box", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ ...row, marginBottom: 14 }}>
        <span style={{ fontSize: TYPOGRAPHY.body.fontSize, fontWeight: 700, color: G }}>Pengaturan</span>
        <button onClick={close} aria-label="Tutup pengaturan" style={{ background: "none", border: `1px solid ${BD}`, borderRadius: RADIUS.sm, width: 24, height: 24, cursor: "pointer", fontSize: TYPOGRAPHY.small.fontSize }}>&#10005;</button>
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0, marginBottom: 14, border: `1px solid ${BD}`, borderRadius: RADIUS.md, overflow: "hidden" }}>
        <aside style={{ width: 146, minWidth: 146, boxSizing: "border-box", background: G, display: "flex", flexDirection: "column", flexShrink: 0, overflowY: "auto" }}>
          {SETTINGS_TABS.map(([key, label]) => <SettingsTabButton key={key} tab={key} activeTab={tab} onSelect={setTab}>{label}</SettingsTabButton>)}
        </aside>
        <div style={{ flex: 1, overflowY: "auto", padding: 16, minWidth: 0 }}>
          <SettingsPanel tab={tab} settingsH={settingsH} authH={authH} menu={menu} cats={cats} deviceH={deviceH} />
        </div>
      </div>
      <div style={{ ...row }}><button onClick={close} style={{ marginLeft: "auto", padding: "8px 16px", background: COLOR_PALETTE.primaryLight, color: G, border: "none", borderRadius: RADIUS.md, cursor: "pointer", fontFamily: "inherit", fontSize: TYPOGRAPHY.small.fontSize, fontWeight: 700 }}>Tutup</button></div>
    </div>
  </div>;
}
