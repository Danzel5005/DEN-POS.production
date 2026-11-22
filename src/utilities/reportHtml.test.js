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

  it("menghasilkan dokumen HTML A4 yang valid", () => {
    const html = buildReportHTML({
      shiftLabel: "Semua Shift",
      cashier: "admin",
      printedDay: "Minggu",
      printedDate: "22 November 2026",
      summary: {
        methods: [{ key: "cash", label: "Tunai", amount: 100000, count: 2 }],
        total: 100000,
        trxCount: 2,
        pax: 4,
        avgPerPax: 25000,
        avgPerTrx: 50000,
      },
    });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("size: A4");
    expect(html).toContain("LAPORAN OMSET");
    expect(html).toContain("Minggu");
    expect(html).toContain("22 November 2026");
    expect(html).toContain("admin");
    expect(html).toContain("Tunai");
    expect(html).toContain("Rp 100.000");
    expect(html).toContain("Total transaksi");
    expect(html).not.toContain("Total Modal");
    expect(html).not.toContain("Laba Bersih");
    expect(html).not.toContain("Analitik Penjualan");
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
});
