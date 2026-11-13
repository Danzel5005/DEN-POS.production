import { useCallback } from "react";
import { api } from "../../utilities/utils.js";

// Factory for printer-related handlers. NOT a hook — receives the single shared
// `settings`/`setSettings` owned by useSettings so the `{...settings, ...patch}`
// spread always reads the latest snapshot (no multi-owner stale closure).
export function createPrinterHandlers({ settings, setSettings, toast_, setPrinterList, setPrinterModal }) {
  // PENTING: membaca settings.printerName LANGSUNG dari closure, bukan lewat
  // functional setState. Wajib [settings, toast_] di deps, atau printHTML akan
  // selalu cetak ke printer dari state pertama kali hook mount (stale).
  const printHTML = useCallback(async (html, successMsg = "Mencetak...") => {
    const res = await api.printReceipt({ html, printerName: settings.printerName || "", paperWidthMm: settings.receiptPaperWidthMm });
    if (res?.ok) toast_(successMsg, "ok");
    else toast_(res?.error || "Gagal cetak", "err");
    return res;
  }, [settings, toast_]);

  const loadPrinters = useCallback(async () => {
    const list = await api.getPrinters();
    setPrinterList(list);
    return list;
  }, []);

  const openPrinterModal = useCallback(async () => {
    await loadPrinters();
    setPrinterModal(true);
  }, [loadPrinters]);

  // PENTING: men-spread `settings` langsung dari closure ({...settings, ...}).
  // Wajib [settings, toast_] di deps — tanpa ini, ganti printer kedua kalinya
  // akan menghapus balik field settings lain yang sudah berubah di antaranya
  // (overwrite dengan snapshot settings yang stale).
  const selectPrinter = useCallback(async (name) => {
    const s = { ...settings, printerName: name };
    await api.saveSettings(s);
    setSettings(s);
    setPrinterModal(false);
    toast_(`Printer: ${name || "Default"}`, "ok");
  }, [settings, toast_]);

  // Receipt paper width (@page size) — clamped to 30–210mm, falls back to 80mm
  const setReceiptPaperWidth = useCallback(async (mm) => {
    const n = Math.round(Number(mm));
    if (!Number.isFinite(n) || n < 30 || n > 210) {
      toast_("Lebar kertas harus antara 30-210 mm", "err");
      return;
    }
    const s = { ...settings, receiptPaperWidthMm: n };
    await api.saveSettings(s);
    setSettings(s);
    toast_("Lebar kertas resi disimpan", "ok");
  }, [settings, toast_]);

  return { printHTML, loadPrinters, openPrinterModal, selectPrinter, setPrinterModal, setReceiptPaperWidth };
}
