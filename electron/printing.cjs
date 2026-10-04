const fs = require("fs");
const path = require("path");
const ThermalPrinter = require("node-thermal-printer").printer;
const PrinterTypes = require("node-thermal-printer").types;
const { getCategoryLabel } = require("./category-label.cjs");

function createPrintingService({ app, ipcMain, BrowserWindow, dialog, dataDir, ensureDir, rJSON, files, nodePrinterDriver }) {
  const PAGE_WIDTH_MM = 210;
  const PAGE_HEIGHT_MM = 297;
  const DEFAULT_PAPER_WIDTH_MM = 80;
  const MIN_PAPER_WIDTH_MM = 30;
  const MAX_PAPER_WIDTH_MM = 210;
  const normalizePaperWidthMm = (value) => {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return DEFAULT_PAPER_WIDTH_MM;
    return Math.min(MAX_PAPER_WIDTH_MM, Math.max(MIN_PAPER_WIDTH_MM, number));
  };
  const injectReceiptPrintCSS = (rawHtml = "", paperWidthMm = DEFAULT_PAPER_WIDTH_MM, forceA4 = false) => {
    const width = normalizePaperWidthMm(paperWidthMm);
    const pageSize = forceA4 ? `${PAGE_WIDTH_MM}mm ${PAGE_HEIGHT_MM}mm` : `${width}mm auto`;
    const css = `<style id="receipt-override">@media print { header, .header-container { page-break-after: avoid !important; break-after: avoid !important; } @page { size: ${pageSize}; margin: 0; } html, body { width: ${width}mm !important; max-width: ${width}mm !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; background: #ffffff !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } * { box-sizing: border-box !important; word-break: break-word !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } .item, .totals, .payment-note, .footer-note { page-break-inside: avoid !important; break-inside: avoid !important; } .section, .receipt-body { page-break-inside: auto !important; break-inside: auto !important; } .receipt > .section.header { padding-bottom: 0 !important; } .receipt > .section.body { padding-top: 0 !important; } .receipt > .section.body > .item:first-child { margin-top: 0 !important; } header, .receipt-body { display: block !important; float: none !important; position: static !important; margin: 0; padding: 0; } }</style>`;
    if (/<\/body>/i.test(rawHtml)) return rawHtml.replace(/<\/body>/i, `${css}</body>`);
    if (/<\/html>/i.test(rawHtml)) return rawHtml.replace(/<\/html>/i, `${css}</html>`);
    return rawHtml + css;
  };

  ipcMain.handle("get-printers", async () => {
    const wins = BrowserWindow.getAllWindows();
    if (!wins.length) return [];
    try { return await wins[0].webContents.getPrintersAsync(); } catch { return []; }
  });
  ipcMain.handle("print-receipt", async (_e, { html, printerName, paperWidthMm }) => {
    ensureDir();
    const paperW = normalizePaperWidthMm(paperWidthMm);
    const forceA4 = /pdf/i.test(printerName || "");
    const selectedName = printerName || "";

    // Cek printer jika bukan PDF virtual printer
    if (!forceA4 && selectedName) {
      try {
        const wins = BrowserWindow.getAllWindows();
        if (wins.length) {
          const printers = await wins[0].webContents.getPrintersAsync();
          const found = printers.some(p => p.name === selectedName || p.displayName === selectedName);
          if (!found) {
            return { ok: false, error: `Printer tidak ditemukan 404: "${selectedName}" tidak terhubung. Pastikan printer terhubung dan driver terinstall.` };
          }
        }
      } catch {
        // Jika gagal cek printer, lanjutkan saja (print akan gagal nanti dengan error asli)
      }
    }

    const win = new BrowserWindow({ width: Math.ceil((PAGE_WIDTH_MM / 25.4) * 96), height: Math.ceil((PAGE_HEIGHT_MM / 25.4) * 96), show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
    const printFile = path.join(dataDir, "receipt-print.html");
    fs.writeFileSync(printFile, injectReceiptPrintCSS(html, paperW, forceA4), "utf-8");
    win.loadFile(printFile);

    return new Promise((resolve) => {
      win.webContents.once("did-finish-load", () => setTimeout(async () => {
        if (forceA4) {
          try {
            const pdfBuffer = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, scale: 1, margins: { top: 0, bottom: 0, left: 0, right: (PAGE_WIDTH_MM - paperW) / 25.4 } });
            const { filePath, canceled } = await dialog.showSaveDialog(win, { title: "Simpan Struk sebagai PDF", defaultPath: path.join(app.getPath("desktop"), "receipt.pdf"), filters: [{ name: "PDF Files", extensions: ["pdf"] }] });
            win.close();
            if (canceled || !filePath) return resolve({ ok: false, error: "Dibatalkan" });
            fs.writeFileSync(filePath, pdfBuffer);
            return resolve({ ok: true, filePath });
          } catch (err) { win.close(); return resolve({ ok: false, error: err.message }); }
        }
        win.webContents.print({ silent: true, printBackground: true, deviceName: selectedName, margins: { marginType: "none" }, pageSize: { width: paperW * 1000, height: 1000 * 1000 }, scaleFactor: 100 }, (success, errType) => {
          setTimeout(() => win.close(), 500);
          // Jika print gagal karena printer tidak ditemukan, beri error yang jelas
          if (!success && errType && (errType.includes("Invalid printer") || errType.includes("Print job failed") || errType.includes("printer not found") || errType.toLowerCase().includes("printer"))) {
            resolve({ ok: false, error: `Printer tidak ditemukan 404: "${selectedName}" tidak terhubung. Pastikan printer terhubung dan driver terinstall.` });
          } else {
            resolve({ ok: success, error: errType || null });
          }
        });
      }, 250));
      win.webContents.once("did-fail-load", (_event, _code, description) => { setTimeout(() => win.close(), 500); resolve({ ok: false, error: description || "Gagal memuat halaman cetak resi" }); });
    });
  });

  const charsPerLineForWidth = (width) => width <= 58 ? 32 : width >= 80 ? 42 : Math.round(32 + ((width - 58) / 22) * 10);
  const fmtRp = (number) => `Rp ${Number(number || 0).toLocaleString("id-ID")}`;
  const cashPaymentNote = (paid, total) => {
    const difference = Number(paid || 0) - Number(total || 0);
    if (difference > 0) return `Kembalian Rp. ${Math.abs(difference).toLocaleString("id-ID")}`;
    if (difference < 0) return `Kurang Bayar Rp. ${Math.abs(difference).toLocaleString("id-ID")}`;
    return "";
  };
  const kvLine = (printer, label, value) => printer.leftRight(label, value);
  const buildEscPosReceipt = (printer, trx, warungName, warungAddress, warungPhone, operatorName, cats = [], customerEnabled = true, receiptAdditionals = []) => {
    const storeName = warungName || trx.warungName || "Warung";
    printer.alignCenter(); printer.bold(true); printer.setTextDoubleHeight(); printer.println(storeName); printer.setTextNormal(); printer.resetLineSpacing(); printer.bold(false);
    if (warungAddress || trx.warungAddress) printer.println(warungAddress || trx.warungAddress);
    if (warungPhone || trx.warungPhone) printer.println(`Telp: ${warungPhone || trx.warungPhone}`);
    printer.println(`${trx.hari}, ${trx.tgl} ${trx.bln} ${trx.thn} - ${trx.jam}:${trx.mnt}:${trx.dtk}`); printer.alignLeft(); printer.drawLine();
    kvLine(printer, "NO TRX", trx.id); kvLine(printer, "KASIR", operatorName || trx.operator || "Kasir");
    if (customerEnabled && (trx.customerNama || "").trim()) {
      const phone = (trx.customerTelepon || "").trim();
      kvLine(printer, "PELANGGAN", `${trx.customerNama}${phone ? ` (${phone})` : ""}`);
    }
    kvLine(printer, "METODE", trx.metodeBayarLabel || trx.metodeBayar || ""); printer.drawLine();
    (receiptAdditionals || []).filter(field => field.category === "receipt" && field.visible !== false).forEach(field => {
      const value = trx?.[field.key];
      if (value !== undefined && value !== null && String(value) !== "") printer.println(`${field.label}: ${value}`);
    });
    trx.items.forEach((item) => {
      // Langkah 3: unitLabel menandai satuan baris (mis. "2x Dus Teh").
      const unitTag = item.unitLabel ? ` ${item.unitLabel}` : "";
      kvLine(printer, `${item.qty}x ${getCategoryLabel(item.kategori, cats)} ${item.nama}${unitTag}`, fmtRp(item.harga * item.qty));
      printer.println(`   ${fmtRp(item.harga)}`);
    });
    printer.drawLine(); kvLine(printer, "SubTotal", fmtRp(trx.subtotal)); printer.bold(true); kvLine(printer, "TOTAL", fmtRp(trx.total || trx.subtotal)); printer.bold(false);
    if (trx.metodeBayar === "cash") { kvLine(printer, "Bayar", fmtRp(trx.bayar)); printer.println(cashPaymentNote(trx.bayar, trx.total) || "LUNAS"); }
    printer.drawLine(); printer.alignCenter(); printer.println("Barang yang sudah dibeli tidak bisa"); printer.println("dikembalikan"); printer.println("Terimakasih"); printer.cut();
  };
  const printDirect = (driver, printerName, data) => new Promise((resolve, reject) => driver.printDirect({ data, printer: printerName, type: "RAW", docname: false, success: resolve, error: reject }));
  const executeEscPosInChunks = async (printer, printerName) => {
    const buffer = printer.getBuffer(); const driver = printer.Interface?.driver;
    if (!buffer || !buffer.length) throw new Error("Buffer ESC/POS kosong");
    if (!driver?.printDirect) throw new Error("Driver printer RAW tidak tersedia");
    for (let offset = 0; offset < buffer.length; offset += 512) { await printDirect(driver, printerName, buffer.subarray(offset, Math.min(offset + 512, buffer.length))); if (offset + 512 < buffer.length) await new Promise((resolve) => setTimeout(resolve, 25)); }
  };
  
ipcMain.handle("export-report-pdf", async (_e, { html, defaultName }) => {
    ensureDir();
    const reportFile = path.join(dataDir, "report-print.html");
    fs.writeFileSync(reportFile, html || "", "utf-8");
    const win = new BrowserWindow({
      show: false,
      width: PAGE_WIDTH_MM * 3.78,
      height: PAGE_HEIGHT_MM * 3.78,
      webPreferences: { offscreen: true, javascript: false },
    });
    win.loadFile(reportFile);
    return new Promise((resolve) => {
      win.webContents.once("did-finish-load", () => {
        setTimeout(async () => {
          try {
            const pdfBuffer = await win.webContents.printToPDF({
              printBackground: true,
              preferCSSPageSize: true,
              pageSize: "A4",
              scale: 1,
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
            });
            const safeName = (defaultName || "laporan").replace(/[\\/:*?"<>|]/g, "-");
            const defPath = path.join(app.getPath("desktop"), safeName.endsWith(".pdf") ? safeName : safeName + ".pdf");
            const { canceled, filePath } = await dialog.showSaveDialog(win, {
              title: "Simpan Laporan sebagai PDF",
              defaultPath: defPath,
              filters: [{ name: "PDF Files", extensions: ["pdf"] }],
            });
            win.close();
            if (canceled || !filePath) return resolve({ ok: false, error: "Dibatalkan" });
            fs.writeFileSync(filePath, pdfBuffer);
            return resolve({ ok: true, filePath });
          } catch (err) {
            win.close();
            return resolve({ ok: false, error: err.message });
          }
        }, 250);
      });
      win.webContents.once("did-fail-load", (_event, _code, description) => {
        setTimeout(() => win.close(), 500);
        resolve({ ok: false, error: description || "Gagal memuat halaman laporan" });
      });
    });
  });
ipcMain.handle("print-receipt-escpos", async (_e, { trx, printerName, paperWidthMm, warungName, warungAddress, warungPhone, operatorName, cats = [], customerEnabled = true, receiptAdditionals = [] }) => {
    const selectedName = printerName || "auto";
    try {
      const paperW = normalizePaperWidthMm(paperWidthMm);
      if (!selectedName || /pdf/i.test(selectedName)) return { ok: false, error: "Printer yang dipilih bukan printer thermal. Pilih printer thermal fisik atau gunakan printer sistem/PDF." };
      const printer = new ThermalPrinter({ type: PrinterTypes.EPSON, interface: selectedName === "auto" ? "printer:auto" : `printer:${selectedName}`, ...(nodePrinterDriver ? { driver: nodePrinterDriver } : {}), width: charsPerLineForWidth(paperW), removeSpecialCharacters: false, options: { timeout: 5000 } });
      if (!await printer.isPrinterConnected()) return { ok: false, error: `Printer tidak ditemukan 404: "${selectedName}" tidak terhubung. Pastikan printer terhubung dan driver terinstall.` };
      buildEscPosReceipt(printer, trx, warungName, warungAddress, warungPhone, operatorName, [...cats, ...(rJSON(files.cats) || [])], customerEnabled, receiptAdditionals);
      await printer.execute();
      console.log("[ESC/POS] Print successful to:", selectedName);
      return { ok: true };
    } catch (err) { const message = err?.message || String(err); console.error("[ESC/POS] Print failed for:", selectedName, message); const looksHardware = /not found|not connected|timeout|offline|printer|device/i.test(message); return { ok: false, error: looksHardware ? `Printer tidak ditemukan 404: "${selectedName}" tidak terhubung. Pastikan printer terhubung dan driver terinstall.` : message }; }
  });
}

module.exports = { createPrintingService };
