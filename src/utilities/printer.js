export function isPdfPrinterName(name = "") {
  return typeof name === "string" && /pdf/i.test(name.trim());
}

export function isThermalPrinterName(name = "") {
  const value = typeof name === "string" ? name.trim() : "";
  if (!value) return false;
  if (isPdfPrinterName(value)) return false;

  return /(thermal|epson|star|bom|pos|tm-|ts-|receipt|kiosk|printer)/i.test(value);
}

export function getPrinterSelectionStatus(name = "") {
  const value = typeof name === "string" ? name.trim() : "";

  if (isPdfPrinterName(value)) {
    return { isPdf: true, isThermal: false, fallbackMode: "pdf", name: value };
  }

  if (isThermalPrinterName(value)) {
    return { isPdf: false, isThermal: true, fallbackMode: "thermal", name: value };
  }

  return { isPdf: false, isThermal: false, fallbackMode: "system", name: value };
}

// isAndroidPrint — true saat berjalan di WebView Android dengan bridge kasirAndroid.
export function isAndroidPrint() {
  return typeof window !== "undefined" && !!window.kasirAndroid;
}

export function getAndroidPrintMode() {
  try { return window.kasirAndroid?.getPrintMode?.() || "bluetooth"; } catch { return "bluetooth"; }
}

// androidPrintReceipt — kirim resi ke bridge Android. Saat mode PDF aktif,
// teruskan HTML final ke WebView cetak native.
export async function androidPrintReceipt(printData, buildHTML) {
  let res;
  try { res = JSON.parse(window.kasirAndroid.printReceiptEscPos(JSON.stringify(printData))); }
  catch (err) { return { ok: false, error: String(err?.message || err) }; }
  if (res?.ok) return res;
  if (!res?.usePdf) return res;
  try { return JSON.parse(window.kasirAndroid.printReceiptPdf(buildHTML())); }
  catch (err) { return { ok: false, error: String(err?.message || err) }; }
}
