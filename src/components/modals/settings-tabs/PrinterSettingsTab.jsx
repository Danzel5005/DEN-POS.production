import { useEffect, useState } from "react";
import { G, W, BD, MT, row, RADIUS, TYPOGRAPHY, COLOR_PALETTE } from "../../../constants/design.js";
import { fieldStyle, SaveButton } from "./shared.jsx";

export function PrinterSettingsTab({ settingsH }) {
  const isAndroid = typeof window !== "undefined" && !!window.kasirAndroid;
  const [loading, setLoading] = useState(false);
  const [paperWidth, setPaperWidth] = useState(settingsH.settings.receiptPaperWidthMm || 80);

  useEffect(() => setPaperWidth(settingsH.settings.receiptPaperWidthMm || 80), [settingsH.settings.receiptPaperWidthMm]);
  useEffect(() => {
    if (!isAndroid && settingsH.printerList.length === 0 && !loading) {
      setLoading(true);
      settingsH.openPrinterModal?.().finally(() => setLoading(false));
    }
  }, [isAndroid, loading, settingsH.printerList.length, settingsH.openPrinterModal]);

  const selectWidth = (width) => {
    setPaperWidth(width);
    settingsH.setReceiptPaperWidth(width);
  };

  if (isAndroid) return <div>
    <div style={{ fontSize: TYPOGRAPHY.label.fontSize, color: MT, fontWeight: 600, marginBottom: 10 }}>Pilih printer thermal Bluetooth atau cetak melalui dialog sistem/PDF.</div>
    <button onClick={() => {
      const result = JSON.parse(window.kasirAndroid.pickPrinter("bluetooth"));
      settingsH.toast_?.(result.message || result.error || "Pilih printer Bluetooth", result.ok ? "ok" : "err");
    }} style={{ width: "100%", padding: "10px", border: `1px solid ${BD}`, borderRadius: RADIUS.md, background: W, cursor: "pointer", fontFamily: "inherit", fontSize: TYPOGRAPHY.small.fontSize, fontWeight: 600, marginBottom: 8 }}>Pilih Printer Bluetooth</button>
    <button onClick={() => {
      const result = JSON.parse(window.kasirAndroid.pickPrinter("pdf"));
      settingsH.toast_?.(result.message || result.error || "Mode PDF", result.ok ? "ok" : "err");
    }} style={{ width: "100%", padding: "10px", border: `1px solid ${BD}`, borderRadius: RADIUS.md, background: W, cursor: "pointer", fontFamily: "inherit", fontSize: TYPOGRAPHY.small.fontSize, fontWeight: 600, marginBottom: 12 }}>Mode PDF (Dialog Cetak)</button>
    <div style={{ paddingTop: 12, borderTop: `1px solid ${BD}` }}>
      <div style={{ fontSize: TYPOGRAPHY.label.fontSize, fontWeight: 600, color: G, marginBottom: 8 }}>Lebar Kertas Resi (mm):</div>
      <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
        <input id="receipt-paper-width" name="receiptPaperWidth" type="number" min="30" max="210" value={paperWidth} onChange={(event) => setPaperWidth(event.target.value)} onKeyDown={(event) => event.key === "Enter" && settingsH.setReceiptPaperWidth(paperWidth)} placeholder="80" style={{ ...fieldStyle, width: 90 }} />
        <SaveButton onClick={() => settingsH.setReceiptPaperWidth(paperWidth)} />
        {[58, 80].map((width) => <button key={width} onClick={() => selectWidth(width)} style={{ padding: "6px 10px", background: Number(settingsH.settings.receiptPaperWidthMm) === width ? COLOR_PALETTE.primaryLight : W, border: `1px solid ${Number(settingsH.settings.receiptPaperWidthMm) === width ? G : BD}`, borderRadius: RADIUS.sm, cursor: "pointer", fontFamily: "inherit", fontSize: TYPOGRAPHY.label.fontSize, fontWeight: 600 }}>{width}mm</button>)}
      </div>
    </div>
  </div>;

  return <div>
    <div style={{ fontSize: TYPOGRAPHY.label.fontSize, color: MT, fontWeight: 600, marginBottom: 10 }}>Pilih printer thermal untuk mencetak resi. Pastikan driver printer sudah terinstall.</div>
    <button onClick={() => settingsH.selectPrinter("")} style={{ width: "100%", padding: "8px 10px", border: `2px solid ${!settingsH.settings.printerName ? G : BD}`, borderRadius: RADIUS.md, background: !settingsH.settings.printerName ? COLOR_PALETTE.primaryLight : W, cursor: "pointer", fontFamily: "inherit", fontSize: TYPOGRAPHY.small.fontSize, fontWeight: 600, textAlign: "left", marginBottom: 6 }}>Default Printer Sistem</button>
    {settingsH.printerList.length === 0 ? <div style={{ fontSize: TYPOGRAPHY.small.fontSize, color: MT, textAlign: "center", padding: "10px 0" }}>Tidak ada printer terdeteksi. Pastikan driver terinstall.</div> : settingsH.printerList.map((printer) => <button key={printer.name} onClick={() => settingsH.selectPrinter(printer.name)} style={{ width: "100%", padding: "8px 10px", border: `2px solid ${settingsH.settings.printerName === printer.name ? G : BD}`, borderRadius: RADIUS.md, background: settingsH.settings.printerName === printer.name ? COLOR_PALETTE.primaryLight : W, cursor: "pointer", fontFamily: "inherit", fontSize: TYPOGRAPHY.small.fontSize, fontWeight: 600, textAlign: "left", marginBottom: 6, ...row }}><span>{printer.name}</span>{settingsH.settings.printerName === printer.name && <span style={{ fontSize: TYPOGRAPHY.label.fontSize, color: G, marginLeft: "auto" }}>✓</span>}</button>)}
    <div style={{ paddingTop: 12, borderTop: `1px solid ${BD}`, marginTop: 10 }}>
      <div style={{ fontSize: TYPOGRAPHY.label.fontSize, fontWeight: 600, color: G, marginBottom: 8 }}>Lebar Kertas Resi (mm):</div>
      <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
        <input id="receipt-paper-width" name="receiptPaperWidth" type="number" min="30" max="210" value={paperWidth} onChange={(event) => setPaperWidth(event.target.value)} onKeyDown={(event) => event.key === "Enter" && settingsH.setReceiptPaperWidth(paperWidth)} placeholder="80" style={{ ...fieldStyle, width: 90 }} />
        <SaveButton onClick={() => settingsH.setReceiptPaperWidth(paperWidth)} />
        {[58, 80].map((width) => <button key={width} onClick={() => selectWidth(width)} style={{ padding: "6px 10px", background: Number(settingsH.settings.receiptPaperWidthMm) === width ? COLOR_PALETTE.primaryLight : W, border: `1px solid ${Number(settingsH.settings.receiptPaperWidthMm) === width ? G : BD}`, borderRadius: RADIUS.sm, cursor: "pointer", fontFamily: "inherit", fontSize: TYPOGRAPHY.label.fontSize, fontWeight: 600 }}>{width}mm</button>)}
      </div>
      <div style={{ fontSize: TYPOGRAPHY.label.fontSize, color: MT, marginTop: 8 }}>Default 80mm. Gunakan 58mm untuk printer thermal mini. Rentang 30-210mm.</div>
    </div>
  </div>;
}
