import { describe, it, expect } from "vitest";
import { fmt, fmtNum, getCashPaymentNote, buildReceiptHTML, buildPreviewHTML, DEFAULT_WARUNG, DEFAULT_PAPER_WIDTH_MM } from "./receipt.js";

describe("receipt.js - Receipt utilities and HTML builders", () => {
  describe("fmt and fmtNum Formatting Helpers", () => {
    it("should format currency with Rp prefix and Indonesian number formatting", () => {
      const formatted = fmt(50000);
      expect(formatted).toMatch(/^Rp\s*50[.,]000/);
    });

    it("should handle 0, null, undefined, and empty string in fmt", () => {
      expect(fmt(0)).toMatch(/^Rp\s*0/);
      expect(fmt(null)).toMatch(/^Rp\s*0/);
      expect(fmt(undefined)).toMatch(/^Rp\s*0/);
      expect(fmt("")).toMatch(/^Rp\s*0/);
    });

    it("should format negative numbers in fmt", () => {
      expect(fmt(-15000)).toMatch(/^-?Rp\s*-?15[.,]000/);
    });

    it("should format raw numbers with fmtNum without Rp prefix", () => {
      expect(fmtNum(1234567)).toMatch(/^1[.,]234[.,]567/);
      expect(fmtNum(0)).toBe("0");
      expect(fmtNum(null)).toBe("0");
      expect(fmtNum(undefined)).toBe("0");
    });

    it("should describe cash change and underpayment", () => {
      expect(getCashPaymentNote(100000, 58300)).toBe("Kembalian Rp. 41.700");
      expect(getCashPaymentNote(50000, 58300)).toBe("Kurang Bayar Rp. 8.300");
      expect(getCashPaymentNote(58300, 58300)).toBe("");
    });
  });

  describe("buildReceiptHTML", () => {
    it("prints table number and Pax when present", () => {
      const html = buildReceiptHTML({ ...mockTrxCash, tableNumber: "4", pax: 4 }, null, [], {});
      expect(html).toContain("Table</span><span class=\"v\">4");
      expect(html).toContain("Pax</span><span class=\"v\">4");
    });
    const mockTrxCash = {
      id: "TRX-101",
      hari: "Senin",
      tgl: "15",
      bln: "Januari",
      thn: "2025",
      jam: "14",
      mnt: "30",
      dtk: "00",
      operator: "Kasir 1",
      warungName: "Warung Test",
      metodeBayar: "cash",
      subtotal: 50000,
      bayar: 100000,
      kembalian: 41700,
      items: [
        { nama: "Kopi Susu", harga: 25000, qty: 2, kategori: "Minuman" }
      ]
    };

    it("should render full HTML string with transaction details and logo", () => {
      const html = buildReceiptHTML(mockTrxCash, "data:image/png;base64,mocklogo", [], {});
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Warung Test");
      expect(html).toContain("TRX-101");
      expect(html).toContain("KASIR");
      expect(html).toContain("METODE");
      expect(html).toContain("2x Kopi Susu");
      expect(html).not.toContain("2 Minuman Kopi Susu");
      expect(html).toContain("Bayar");
      expect(html).toContain("Kembalian");
    });

    it("should use DEFAULT_WARUNG when warungName is not provided", () => {
      const trxNoName = { ...mockTrxCash, warungName: undefined };
      const html = buildReceiptHTML(trxNoName, null, [], {});
      expect(html).toContain(DEFAULT_WARUNG);
    });

    it("should hide Bayar and Kembalian for non-cash payment methods", () => {
      const trxQris = { ...mockTrxCash, metodeBayar: "qris-bca" };
      const html = buildReceiptHTML(trxQris, null, [], {});
      expect(html).not.toContain("<span class=\"k\">Bayar</span>");
      expect(html).not.toContain("<span class=\"k\">Kembalian</span>");
      expect(html).not.toContain(">LUNAS<"); // LUNAS only shown for cash
      expect(html).toContain("<div class=\"payment-note\">____</div>");
    });

    it("should print an underpayment note instead of a negative change", () => {
      const html = buildReceiptHTML({ ...mockTrxCash, subtotal: 58300, total: 58300, bayar: 50000, kembalian: -8300 }, null, [], {});
      expect(html).toContain("Kurang Bayar Rp. 8.300");
      expect((html.match(/Kurang Bayar Rp\. 8\.300/g) || [])).toHaveLength(1);
      expect(html).not.toContain("Kembalian Rp. -8.300");
    });

    it("should render QRIS image when provided", () => {
      const trxQris = { ...mockTrxCash, metodeBayar: "qris-bca" };
      const qrisImages = { "qris-bca": "data:image/png;base64,qrisimage" };
      const html = buildReceiptHTML(trxQris, null, [], qrisImages);
      expect(html).toContain("data:image/png;base64,qrisimage");
    });

    it("should default @page size to 80mm when paperWidthMm is not provided", () => {
      const html = buildReceiptHTML(mockTrxCash, null, [], {});
      expect(html).toContain("@page{size:80mm auto;margin:0mm;}");
      expect(html).toContain("width:80mm;");
      expect(DEFAULT_PAPER_WIDTH_MM).toBe(80);
    });

    it("should use custom paper width in @page and body width", () => {
      const html = buildReceiptHTML(mockTrxCash, null, [], {}, null, [], "", "", [], 58);
      expect(html).toContain("@page{size:58mm auto;margin:0mm;}");
      expect(html).not.toContain("size:80mm");
    });

    it("should clamp out-of-range paper widths to 30-210mm", () => {
      const htmlSmall = buildReceiptHTML(mockTrxCash, null, [], {}, null, [], "", "", [], 10);
      expect(htmlSmall).toContain("@page{size:30mm auto;margin:0mm;}");
      const htmlBig = buildReceiptHTML(mockTrxCash, null, [], {}, null, [], "", "", [], 999);
      expect(htmlBig).toContain("@page{size:210mm auto;margin:0mm;}");
    });

    it("should fall back to 80mm for invalid paper widths", () => {
      const html = buildReceiptHTML(mockTrxCash, null, [], {}, null, [], "", "", [], "abc");
      expect(html).toContain("@page{size:80mm auto;margin:0mm;}");
    });

    it("should omit the PELANGGAN row when the transaction has no customer", () => {
      const html = buildReceiptHTML(mockTrxCash, null, [], {});
      expect(html).not.toContain("PELANGGAN");
      expect(html).toContain("KASIR"); // the neighbouring rows are still present
      expect(html).toContain("METODE");
    });

    it("should render the customer name and phone when attached", () => {
      const html = buildReceiptHTML(
        { ...mockTrxCash, customerId: "cust_1", customerNama: "Budi Santoso", customerTelepon: "08123456789" },
        null, [], {}
      );
      expect(html).toContain("PELANGGAN");
      expect(html).toContain("Budi Santoso (08123456789)");
      // PELANGGAN must sit between KASIR and METODE
      expect(html.indexOf("KASIR")).toBeLessThan(html.indexOf("PELANGGAN"));
      expect(html.indexOf("PELANGGAN")).toBeLessThan(html.indexOf("METODE"));
    });

    it("should render the customer without parentheses when no phone is stored", () => {
      const html = buildReceiptHTML(
        { ...mockTrxCash, customerNama: "Siti", customerTelepon: "" },
        null, [], {}
      );
      expect(html).toContain("PELANGGAN");
      expect(html).toContain(">Siti<");
      expect(html).not.toContain("Siti (");
    });

    it("should ignore whitespace-only customer names", () => {
      const html = buildReceiptHTML({ ...mockTrxCash, customerNama: "   " }, null, [], {});
      expect(html).not.toContain("PELANGGAN");
    });

    it("should omit the PELANGGAN row when the customer feature is disabled", () => {
      const html = buildReceiptHTML(
        { ...mockTrxCash, customerNama: "Budi Santoso", customerTelepon: "08123456789" },
        null, [], {}, null, [], "", "", [], 80, false
      );
      expect(html).not.toContain("PELANGGAN");
      expect(html).not.toContain("Budi Santoso");
      expect(html).toContain("KASIR");
      expect(html).toContain("METODE");
    });

    it("should render custom header and footer text when configured", () => {
      const html = buildReceiptHTML(
        mockTrxCash, null, [], {}, "Warung Test", [], "", "", [], 80, true,
        "Cabang Sukamaju", "Terima kasih atas kunjungan Anda"
      );
      expect(html).toContain('class="receipt-note"');
      expect(html).toContain("Cabang Sukamaju");
      expect(html).toContain("Terima kasih atas kunjungan Anda");
    });

    it("renders custom receipt add-ons by their label and escapes user values", () => {
      const trx = { ...mockTrxCash, catatan_pesanan: "Gak pake sayur <b>" };
      const fields = [{ key: "catatan_pesanan", label: "Catatan", category: "receipt", visible: true }];
      const html = buildReceiptHTML(trx, null, fields, {});
      expect(html).toContain("CATATAN");
      expect(html).toContain("Gak pake sayur &lt;b&gt;");
      expect(html).not.toContain("Gak pake sayur <b>");
    });

    it("should not render receipt-note blocks when header/footer are empty", () => {
      const html = buildReceiptHTML(mockTrxCash, null, [], {}, "Warung Test");
      expect(html).not.toContain('class="receipt-note"');
    });

    it("should escape HTML in header/footer text to prevent injection", () => {
      const html = buildReceiptHTML(
        mockTrxCash, null, [], {}, "Warung Test", [], "", "", [], 80, true,
        "<script>alert(1)</script>", "A & B"
      );
      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(html).toContain("A &amp; B");
    });

    it("should overwrite the hardcoded footer when a custom footer is set", () => {
      const html = buildReceiptHTML(
        mockTrxCash, null, [], {}, "Warung Test", [], "", "", [], 80, true,
        "", "Terima kasih sudah berbelanja"
      );
      expect(html).toContain("Terima kasih sudah berbelanja");
      // The hardcoded default footer must be gone entirely.
      expect(html).not.toContain("Barang yang sudah dibeli");
      expect(html).not.toContain("Terimakasih");
    });

    it("should keep the hardcoded footer when no custom footer is set", () => {
      const html = buildReceiptHTML(mockTrxCash, null, [], {}, "Warung Test");
      expect(html).toContain("Barang yang sudah dibeli");
    });
  });

  describe("buildPreviewHTML", () => {
    it("should generate receipt preview HTML with calculated totals", () => {
      const items = [
        { nama: "Espresso", harga: 20000, qty: 1, kategori: "Minuman" },
        { nama: "Croissant", harga: 25000, qty: 2, kategori: "Makanan" }
      ];
      const receiptAdditionalValues = {};
      const html = buildPreviewHTML(receiptAdditionalValues, items, "logo.png", [], "Warung Test");

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Warung Test");
      expect(html).not.toContain("-- PREVIEW TAGIHAN --");
      expect(html).toContain("1x Espresso");
      expect(html).toContain("2x Croissant");
      expect(html).not.toContain("1 Minuman Espresso");
      expect(html).not.toContain("2 Makanan Croissant");
      expect(html).toContain("Belum Lunas");
    });

    it("should handle preview with empty items array", () => {
      const html = buildPreviewHTML({}, [], null, [], "Warung Test");
      expect(html).toContain("Warung Test");
      expect(html).not.toContain("Pax");
      expect(html).not.toContain("-- PREVIEW TAGIHAN --");
      expect(html).toContain("Belum Lunas");
    });

    it("should use custom paper width in preview @page size", () => {
      const items = [{ nama: "Teh", harga: 5000, qty: 1, kategori: "Minuman" }];
      const html = buildPreviewHTML({}, items, null, [], "Warung Test", [], "", "", 58);
      expect(html).toContain("@page{size:58mm auto;margin:0mm;}");
    });

    it("should show the cash note in preview when a payment has been entered", () => {
      const items = [{ nama: "Teh", harga: 58300, qty: 1, kategori: "Minuman" }];
      const html = buildPreviewHTML({}, items, null, [], "Warung Test", [], "", "", 80, {}, 50000, "cash");
      expect(html).toContain("Kurang Bayar Rp. 8.300");
    });

    it("should render custom header/footer text in preview", () => {
      const items = [{ nama: "Teh", harga: 5000, qty: 1, kategori: "Minuman" }];
      const html = buildPreviewHTML({}, items, null, [], "Warung Test", [], "", "", 80, {}, 0, "cash", "Header Preview", "Footer Preview");
      expect(html).toContain("Header Preview");
      expect(html).toContain("Footer Preview");
      expect(html).toContain('class="receipt-note"');
    });

    it("renders custom receipt add-ons in the unpaid preview", () => {
      const fields = [{ key: "catatan_pesanan", label: "Catatan", category: "receipt", visible: true }];
      const html = buildPreviewHTML({ catatan_pesanan: "Gak pake sayur" }, [], null, fields, "Warung Test");
      expect(html).toContain("CATATAN");
      expect(html).toContain("Gak pake sayur");
    });
  });
});
