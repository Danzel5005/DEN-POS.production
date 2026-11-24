import { describe, it, expect } from "vitest";
import { buildReportHTML, escapeHtml, rupiah } from "./reportHtml.js";

describe("reportHtml", () => {
  it("escapeHtml menetralkan tag berbahaya", () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
    );
  });

  it("rupiah memformat angka dengan pemisah ribuan", () => {
    expect(rupiah(1234567)).toBe("Rp 1.234.567");
    expect(rupiah(0)).toBe("Rp 0");
    expect(rupiah(undefined)).toBe("Rp 0");
  });

  it("menghasilkan dokumen HTML format resi", () => {
    const html = buildReportHTML({
      shiftLabel: "Semua Shift",
      cashier: "admin",
      printedDay: "Minggu",
      printedDate: "22 November 2026",
      summary: {
        methods: [{ key: "cash", label: "Tunai", amount: 100000, count: 2 }],
        total: 100000,
        netSubtotal: 85000,
        service: 5000,
        pajak: 10000,
        trxCount: 2,
        pax: 4,
        avgPerPax: 25000,
        avgPerTrx: 50000,
      },
    });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("size:80mm 210mm");
    expect(html).toContain("LAPORAN OMSET");
    expect(html).toContain("Minggu");
    expect(html).toContain("22 November 2026");
    expect(html).toContain("admin");
    expect(html).toContain("Tunai");
    expect(html).toContain("Hasil Bersih (Subtotal)");
    expect(html).toContain("Rp 85.000");
    expect(html).toContain("Total Biaya Service");
    expect(html).toContain("Rp 5.000");
    expect(html).toContain("Total Biaya Pajak");
    expect(html).toContain("Rp 100.000");
    expect(html).toContain("Total transaksi");
    expect(html).not.toContain("Total Modal");
    expect(html).not.toContain("Laba Bersih");
    expect(html).not.toContain("Analitik Penjualan");
    expect(html).toContain("Made by DENPOS");
  });

  it("escape semua data dinamis", () => {
    const html = buildReportHTML({
      shiftLabel: "<b>shift</b>",
      cashier: 'admin"><script>',
      summary: { methods: [{ key: "x", label: "<QR>", amount: 0, count: 1 }], total: 0, trxCount: 0, pax: 0, avgPerPax: 0, avgPerTrx: 0 },
    });
    expect(html).not.toContain("<b>shift</b>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;QR&gt;");
  });

  it("mengikuti lebar kertas 58mm dan 80mm untuk cetak laporan", () => {
    const summary = { methods: [{ key: "cash", label: "Tunai", amount: 100000, count: 1 }], total: 100000, trxCount: 1, pax: 2, avgPerPax: 50000, avgPerTrx: 100000 };
    const html58 = buildReportHTML({ summary, paperWidthMm: 58 });
    const html80 = buildReportHTML({ summary, paperWidthMm: 80 });
    expect(html58).toContain("size:58mm 210mm");
    expect(html58).toContain("width:58mm");
    expect(html58).toContain("max-width:65%");
    expect(html58).toContain("overflow-wrap:anywhere");
    expect(html80).toContain("size:80mm 210mm");
    expect(html80).toContain("width:80mm");
  });
});
