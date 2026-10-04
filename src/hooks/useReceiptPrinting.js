import { useCallback, useState } from "react";
import { buildReceiptHTML, buildPreviewHTML } from "../utilities/receipt.js";
import { getPrinterSelectionStatus } from "../utilities/printer.js";

// useReceiptPrinting — domain logic for printing receipts and bill previews.
//
// Dua jalur cetak dibedakan dari tipe printer terpilih (settings.printerName):
//   1. Printer thermal  -> ESC/POS langsung (bypass driver Windows) lewat IPC
//      `printReceiptEscPos`, supaya hasil rapi tanpa dialog driver.
//   2. Printer PDF virtual / printer biasa -> render HTML via buildReceiptHTML
//      (atau buildPreviewHTML untuk preview tagihan) lalu printHTML generik.
//
// Hook ini SENGAJA tidak meng-import hook lain. Semua dependensi domain
// disuntik lewat parameter supaya urutan deklarasi tetap dimiliki App.jsx
// (pola sama seperti useHistoryVoid / useCustomers).
//
// Params:
//   settingsH - nilai balik useSettings() (settings, logo, printHTML)
//   menuH     - nilai balik useMenu() (kategori untuk label struk)
//   cartH     - nilai balik useCart() (items/pricing untuk preview)
//   toast_    - feedback opsional
//
// Return: { printReceipt, printPreview, printingPreview }
function useReceiptPrinting({ settingsH, menuH, cartH, toast_ }) {
  // printingPreview — status cetak preview untuk men-disable tombol preview.
  const [printingPreview, setPrintingPreview] = useState(false);

  // printReceipt(trx) — thermal fisik pakai ESC/POS langsung (bypass driver
  // Windows), printer PDF virtual (mis. "Microsoft Print to PDF") tetap lewat
  // buildReceiptHTML + printToPDF.
  const printReceipt = useCallback(async (trx) => {
    const printerName = settingsH.settings.printerName || "";
    const selection = getPrinterSelectionStatus(printerName);

    if (selection.isThermal) {
      const res = await window.api.printReceiptEscPos({
        trx,
        printerName,
        paperWidthMm: settingsH.settings.receiptPaperWidthMm,
        warungName: settingsH.settings.warungName,
        warungAddress: settingsH.settings.warungAddress,
        warungPhone: settingsH.settings.warungPhone,
        operatorName: trx.operator,
        cats: menuH.cats,
        customerEnabled: settingsH.settings.customerEnabled !== false,
        receiptAdditionals: settingsH.settings.receiptAdditionals,
      });
      if (res?.ok) toast_("Selesai Mencetak Resi", "ok");
      else toast_(res?.error || "Gagal cetak thermal", "err");
      return res;
    }

    if (selection.isPdf) {
      const html = buildReceiptHTML(trx, settingsH.logo, settingsH.settings.receiptAdditionals, settingsH.settings.qrisImages, settingsH.settings.warungName, menuH.cats, settingsH.settings.warungAddress, settingsH.settings.warungPhone, settingsH.settings.paymentMethods, settingsH.settings.receiptPaperWidthMm, settingsH.settings.customerEnabled !== false, settingsH.settings.receiptHeaderText, settingsH.settings.receiptFooterText);
      const res = await settingsH.printHTML(html, "Selesai Mencetak Resi");
      return res;
    }

    const html = buildReceiptHTML(trx, settingsH.logo, settingsH.settings.receiptAdditionals, settingsH.settings.qrisImages, settingsH.settings.warungName, menuH.cats, settingsH.settings.warungAddress, settingsH.settings.warungPhone, settingsH.settings.paymentMethods, settingsH.settings.receiptPaperWidthMm, settingsH.settings.customerEnabled !== false, settingsH.settings.receiptHeaderText, settingsH.settings.receiptFooterText);
    const res = await settingsH.printHTML(html, "Selesai Mencetak Resi");
    return res;
  }, [settingsH.logo, settingsH.printHTML, settingsH.settings.printerName, settingsH.settings.receiptAdditionals, settingsH.settings.qrisImages, settingsH.settings.warungName, settingsH.settings.warungAddress, settingsH.settings.warungPhone, menuH.cats, settingsH.settings.paymentMethods, settingsH.settings.receiptPaperWidthMm, settingsH.settings.customerEnabled, settingsH.settings.receiptHeaderText, settingsH.settings.receiptFooterText, toast_]);

  // printPreview — depend ke cart (items/receiptAdditionalValues), pakai
  // printHTML generic dari settings. PENTING: membaca cartH.items/
  // receiptAdditionalValues dan settingsH.logo langsung. Semua wajib di deps.
  const printPreview = useCallback(async () => {
    if (!cartH.items.length) { toast_("Isi pesanan dulu", "err"); return; }
    setPrintingPreview(true);
    try {
      const html = buildPreviewHTML(cartH.receiptAdditionalValues, cartH.items, settingsH.logo, settingsH.settings.receiptAdditionals, settingsH.settings.warungName, menuH.cats, settingsH.settings.warungAddress, settingsH.settings.warungPhone, settingsH.settings.receiptPaperWidthMm, { ...cartH.pricingConfig, manualDiscount: cartH.manualDiscount }, cartH.paidNum, cartH.metode, settingsH.settings.receiptHeaderText, settingsH.settings.receiptFooterText);
      await settingsH.printHTML(html, "Mencetak preview tagihan...");
    } finally {
      setPrintingPreview(false);
    }
  }, [cartH.items, cartH.receiptAdditionalValues, cartH.pricingConfig, cartH.manualDiscount, cartH.paidNum, cartH.metode, toast_, settingsH.logo, settingsH.printHTML, settingsH.settings.receiptAdditionals, settingsH.settings.warungName, settingsH.settings.warungAddress, settingsH.settings.warungPhone, menuH.cats, settingsH.settings.receiptPaperWidthMm, settingsH.settings.receiptHeaderText, settingsH.settings.receiptFooterText]);

  return { printReceipt, printPreview, printingPreview };
}

export { useReceiptPrinting };
