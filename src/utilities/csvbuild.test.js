import { describe, it, expect } from "vitest";
import {
  csvByDay,
  trxRow,
  TRX_HEADER,
  LAP_HEADER,
  csvLaporan,
  csvSalesRate,
  csvPerMenu,
  csvMetodeBayar,
  csvStok,
  csvRestock,
} from "./csvbuild.js";
import { calcPrice } from "./calculations.js";
import { resolveShiftTarget, nextShiftNum } from "./shiftState.js";

describe("csvbuild.js - CSV Generator Utilities", () => {
  const timeDownload = "2025-01-15 10:00:00";

  const sampleTrx1 = {
    id: "TRX-001",
    timestamp: "2025-01-15T10:00:00.000Z",
    hari: "Rabu",
    tgl: "15",
    bln: "Januari",
    thn: "2025",
    jam: "10",
    mnt: "00",
    dtk: "00",
    meja: "01",
    pax: 2,
    metodeBayar: "cash",
    subtotal: 50000,
    total: 58300,
    bayar: 100000,
    kembalian: 41700,
    items: [
      { nama: "Kopi Black", harga: 20000, qty: 1, modal: 8000 },
      { nama: "Roti Bakar", harga: 30000, qty: 1, modal: 12000 },
    ],
  };

  const sampleTrx2 = {
    id: "TRX-002",
    timestamp: "2025-01-15T11:30:00.000Z",
    hari: "Rabu",
    tgl: "15",
    bln: "Januari",
    thn: "2025",
    jam: "11",
    mnt: "30",
    dtk: "00",
    meja: "02",
    pax: 1,
    metodeBayar: "qris-bca",
    subtotal: 20000,
    total: 23320,
    bayar: 23320,
    kembalian: 0,
    items: [{ nama: "Kopi Black", harga: 20000, qty: 1, modal: 8000 }],
  };

  const sampleTrxDay2 = {
    id: "TRX-003",
    timestamp: "2025-01-16T09:00:00.000Z",
    hari: "Kamis",
    tgl: "16",
    bln: "Januari",
    thn: "2025",
    jam: "09",
    mnt: "00",
    dtk: "00",
    meja: "03",
    pax: 3,
    metodeBayar: "transfer-bca",
    subtotal: 100000,
    total: 116600,
    bayar: 116600,
    kembalian: 0,
    items: [{ nama: "Matcha Latte", harga: 50000, qty: 2, modal: 20000 }],
  };

  const mockMenuList = [
    { nama: "Kopi Black", kategori: "Minuman", harga: 20000, modal: 8000 },
    { nama: "Roti Bakar", kategori: "Makanan", harga: 30000, modal: 12000 },
    { nama: "Matcha Latte", kategori: "Minuman", harga: 50000, modal: 20000 },
    { nama: "Teh Manis", kategori: "Minuman", harga: 10000, modal: 3000 },
  ];

  describe("trxRow and csvByDay", () => {
    it("should generate CSV rows for transaction items via trxRow", () => {
      const rows = trxRow(sampleTrx1, timeDownload, [], []);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toContain("TRX-001");
      expect(rows[0]).toContain('"Kopi Black"');
      expect(rows[0]).toContain(timeDownload);
    });

    it("includes subtotal, service, and tax amounts in transaction export", () => {
      const trx = { ...sampleTrx1, discount: 2000, service: 2400, pajak: 5040 };
      const values = trxRow(trx, timeDownload, [], [])[0].split(",");
      const headers = TRX_HEADER.split(",");

      expect(values[headers.indexOf("Hasil Bersih (Subtotal)")]).toBe("48000");
      expect(headers).not.toContain("Diskon Trx");
      expect(values[headers.indexOf("Total Biaya Service")]).toBe("2400");
      expect(values[headers.indexOf("Total Biaya Pajak")]).toBe("5040");
      expect(values[headers.indexOf("Total Trx")]).toBe(String(trx.total));
    });

    it("should handle trxRow with missing modal, pax, bayar, or kembalian gracefully", () => {
      const minimalTrx = {
        id: "TRX-MIN",
        timestamp: "2025-01-15T12:00:00.000Z",
        hari: "Rabu",
        tgl: "15",
        bln: "Januari",
        thn: "2025",
        jam: "12",
        mnt: "00",
        dtk: "00",
        meja: "01",
        subtotal: 20000,
        items: [{ nama: "Kopi Plain", harga: 20000, qty: 1 }],
      };
      const rows = trxRow(minimalTrx, timeDownload, [], []);
      expect(rows[0]).toContain("Tunai"); // fallback metode
      expect(rows[0]).toContain(",0,"); // default pax/modal
    });

    it("should group transactions by date and sort chronologically in csvByDay", () => {
      const trxs = [sampleTrxDay2, sampleTrx2, sampleTrx1];
      const result = csvByDay(trxs, TRX_HEADER, (t, at) => trxRow(t, at, [], []), timeDownload);

      expect(result).toContain("===== Rabu, 15 Januari 2025 =====");
      expect(result).toContain("===== Kamis, 16 Januari 2025 =====");
      // Ensures Rabu section appears before Kamis section due to chronological sorting
      const rabuIndex = result.indexOf("===== Rabu, 15 Januari 2025 =====");
      const kamisIndex = result.indexOf("===== Kamis, 16 Januari 2025 =====");
      expect(rabuIndex).toBeLessThan(kamisIndex);
    });

    it("should return empty string if transactions array is empty in csvByDay", () => {
      const result = csvByDay([], TRX_HEADER, (t, at) => trxRow(t, at, [], []), timeDownload);
      expect(result).toBe("");
    });
  });

  describe("csvLaporan", () => {
    it("should generate daily report summary CSV including total row and LABA status", () => {
      const csv = csvLaporan([sampleTrx1, sampleTrx2], timeDownload);
      expect(csv).toContain(LAP_HEADER);
      expect(csv).toContain("Rabu");
      expect(csv).toContain("15 Januari 2025");
      expect(csv).toContain("LABA");
      expect(csv).toContain("TOTAL");
    });

    it("should report 'Modal belum diinput' if total modal is 0", () => {
      const noModalTrx = {
        ...sampleTrx1,
        items: [{ nama: "Water", harga: 5000, qty: 1, modal: 0 }],
      };
      const csv = csvLaporan([noModalTrx], timeDownload);
      expect(csv).toContain("Modal belum diinput");
    });

    it("should report 'RUGI' when total cost exceeds total gross income", () => {
      const lossTrx = {
        id: "TRX-LOSS",
        timestamp: "2025-01-15T10:00:00.000Z",
        hari: "Rabu",
        tgl: "15",
        bln: "Januari",
        thn: "2025",
        jam: "10",
        mnt: "00",
        dtk: "00",
        meja: "01",
        pax: 2,
        metodeBayar: "cash",
        subtotal: 10000,
        items: [{ nama: "Expensive Item", harga: 10000, qty: 1, modal: 50000 }],
      };
      // Calculate total with service and tax
      const { total } = calcPrice(lossTrx.subtotal);
      lossTrx.total = total;
      const csv = csvLaporan([lossTrx], timeDownload);
      expect(csv).toContain("RUGI");
    });

    it("should include starting cash and expenses in the financial summary export", () => {
      const csv = csvLaporan([sampleTrx1, sampleTrx2], timeDownload, {
        openingCash: 150000,
        totalExpenses: 25000,
      });
      expect(csv).toContain("Kas Awal");
      expect(csv).toContain("Total Pengeluaran");
      expect(csv).toContain("150000");
      expect(csv).toContain("25000");
    });

    it("should handle zero pax without divide-by-zero error", () => {
      const zeroPaxTrx = { ...sampleTrx1, pax: 0 };
      const csv = csvLaporan([zeroPaxTrx], timeDownload);
      expect(csv).not.toContain("NaN");
    });
  });

  describe("shift state resolution", () => {
    it("should prefer the persisted open shift over a stale activeShift when saving opening cash", () => {
      const staleActiveShift = { id: "shift_old", status: "closed", openingCash: 0 };
      const persistedShifts = [
        { id: "shift_old", status: "closed", openingCash: 0 },
        { id: "shift_new", status: "open", openingCash: 0 },
      ];

      const result = resolveShiftTarget({
        shifts: persistedShifts,
        activeShift: staleActiveShift,
        selectedShiftId: null,
      });

      expect(result.id).toBe("shift_new");
      expect(result.status).toBe("open");
    });
  });

  describe("shift numbering (running, not per day)", () => {
    it("should start at 1 when there is no shift yet", () => {
      expect(nextShiftNum([])).toBe(1);
    });

    it("should continue across days instead of restarting at 1", () => {
      const shifts = [
        { id: "s1", shiftNum: 1, dateKey: "18-9-2026", status: "closed" },
        { id: "s2", shiftNum: 2, dateKey: "18-9-2026", status: "closed" },
      ];
      // Shift pertama pada hari berikutnya harus jadi 3, bukan 1.
      expect(nextShiftNum(shifts)).toBe(3);
    });

    it("should use the highest existing number so it never decreases", () => {
      const shifts = [
        { id: "s1", shiftNum: 1 },
        { id: "s5", shiftNum: 5 },
        { id: "s3", shiftNum: 3 },
      ];
      expect(nextShiftNum(shifts)).toBe(6);
    });

    it("should ignore shifts with missing or invalid numbers", () => {
      const shifts = [{ id: "s1" }, { id: "s2", shiftNum: null }, { id: "s3", shiftNum: "abc" }];
      expect(nextShiftNum(shifts)).toBe(1);
    });
  });

  describe("csvSalesRate", () => {
    it("should structure sales rate CSV into TOP 10, BOTTOM 10, and UNSOLD sections", () => {
      const csv = csvSalesRate([sampleTrx1, sampleTrx2], mockMenuList, timeDownload);
      expect(csv).toContain("TOP 10 MENU TERLAKU");
      expect(csv).toContain("TOP 10 MENU PALING SEDIKIT TERJUAL");
      expect(csv).toContain("MENU BELUM TERJUAL SAMA SEKALI");
      expect(csv).toContain('"Teh Manis"'); // unsold menu item
    });

    it("should process transactions with items not present in default menuList", () => {
      const unknownItemTrx = {
        ...sampleTrx1,
        items: [{ nama: "Custom Cake", harga: 40000, qty: 2, modal: 15000 }],
      };
      const csv = csvSalesRate([unknownItemTrx], mockMenuList, timeDownload);
      expect(csv).toContain('"Custom Cake"');
    });
  });

  describe("csvPerMenu", () => {
    it("should output per-menu performance report with margin calculations", () => {
      const csv = csvPerMenu([sampleTrx1], mockMenuList, timeDownload, []);
      expect(csv).toContain("Nama Menu,Kategori,Harga Jual");
      expect(csv).toContain('"Kopi Black",Minuman,20000,8000,1,20000,8000,12000');
      expect(csv).toContain('"Teh Manis",Minuman,10000,3000,0,0,0,0,N/A,Belum Terjual');
    });

    it("includes total service and tax charges in the Sales Report CSV", () => {
      const csv = csvPerMenu([{ ...sampleTrx1, discount: 3000, service: 2400, pajak: 5040 }], mockMenuList, timeDownload, []);
      expect(csv).toContain("Hasil Bersih (Subtotal),47000");
      expect(csv).not.toContain("Total Diskon");
      expect(csv).toContain("Total Biaya Service,2400");
      expect(csv).toContain("Total Biaya Pajak,5040");
    });
  });

  describe("csvMetodeBayar", () => {
    it("should summarize payments by method and handle legacy normalized method keys", () => {
      const trxs = [sampleTrx1, sampleTrx2, sampleTrxDay2];
      const csv = csvMetodeBayar(trxs, timeDownload);

      expect(csv).toContain("=== DETAIL PER HARI ===");
      expect(csv).toContain("=== RINGKASAN TOTAL ===");
      expect(csv).toContain("Debit BCA"); // transfer-bca normalized
      expect(csv).toContain("QRIS BCA"); // qris-bca
      expect(csv).toContain("GRAND TOTAL");
    });

    it("should prefer transaction payment label over raw custom key when settings are stale", () => {
      const customTrx = {
        ...sampleTrx1,
        id: "TRX-CUSTOM-001",
        metodeBayar: "custom_1787620237595",
        metodeBayarLabel: "Saku Bank",
        total: 25000,
        subtotal: 25000,
        bayar: 25000,
        kembalian: 0,
      };

      const csv = csvMetodeBayar([customTrx], timeDownload, []);

      expect(csv).toContain("Saku Bank");
      expect(csv).not.toContain("custom_1787620237595");
    });

    it("should handle empty transaction list in csvMetodeBayar", () => {
      const csv = csvMetodeBayar([], timeDownload);
      expect(csv).toContain("GRAND TOTAL");
      expect(csv).toContain("Semua Metode,0,0");
    });
  });

  describe("csvStok", () => {
it("appends bahan baku section only when bahanRows given", () => {
  const rows = [{ nama: "Gula", satuan: "kg", stok: 2, minStok: 5, hargaSatuan: 15000, dipakai: ["Kopi Black"] }];
  expect(csvStok(mockMenuList, [], timeDownload, rows)).toContain("STOK BAHAN BAKU (RESEP HPP)");
  expect(csvStok(mockMenuList, [], timeDownload)).not.toContain("BAHAN BAKU");
});

    it("should generate stock report CSV with categories and status", () => {
      const mockCategories = [
        { key: "Minuman", label: "Minuman" },
        { key: "Makanan", label: "Makanan" }
      ];
      const csv = csvStok(mockMenuList, mockCategories, timeDownload);
      expect(csv).toContain("Nama Menu,Kategori,Harga Jual,Modal,Stok Tersedia,Status,Waktu Unduh");
      expect(csv).toContain('"Kopi Black",Minuman');
      expect(csv).toContain("TERSEDIA");
    });

    it("should handle items without stock (null) showing 'Tidak Dibatasi'", () => {
      const menuWithNullStock = [
        { nama: "Air Mineral", kategori: "Minuman", harga: 5000, modal: 2000, stok: null }
      ];
      const csv = csvStok(menuWithNullStock, [], timeDownload);
      expect(csv).toContain("Tidak Dibatasi");
    });

    it("should show 'HABIS' status when stock is 0", () => {
      const menuEmptyStock = [
        { nama: "Kopi Habis", kategori: "Minuman", harga: 10000, modal: 5000, stok: 0 }
      ];
      const csv = csvStok(menuEmptyStock, [], timeDownload);
      expect(csv).toContain("HABIS");
    });

    it("should show 'RENDAH' status when stock <= 5", () => {
      const menuLowStock = [
        { nama: "Kopi Sedikit", kategori: "Minuman", harga: 10000, modal: 5000, stok: 3 }
      ];
      const csv = csvStok(menuLowStock, [], timeDownload);
      expect(csv).toContain("RENDAH");
    });

    it("should resolve category label from key using categories array", () => {
      const menuWithCatKey = [
        { nama: "Test Item", kategori: "Minuman", harga: 10000, modal: 5000, stok: 10 }
      ];
      const categories = [
        { key: "Minuman", label: "Minuman Premium" }
      ];
      const csv = csvStok(menuWithCatKey, categories, timeDownload);
      expect(csv).toContain("Minuman Premium");
    });
  });

  describe("csvRestock", () => {
    it("should emit the restock header even for an empty list", () => {
      const csv = csvRestock([], timeDownload);
      expect(csv).toContain("Nama Menu");
      expect(csv).toContain("Saran Restock");
      expect(csv.split("\n")).toHaveLength(1);
    });

    it("should mark out-of-stock rows as HABIS and low rows as STOK MENIPIS", () => {
      const rows = [
        { id: 1, nama: "Kopi Hitam", kategori: "kopi", stok: 0, level: "out", suggestQty: 15 },
        { id: 2, nama: "Teh Manis", kategori: "teh", stok: 3, level: "low", suggestQty: 12 },
      ];
      const csv = csvRestock(rows, timeDownload);
      const lines = csv.split("\n");
      expect(lines).toHaveLength(3);
      expect(lines[1]).toContain("HABIS");
      expect(lines[1]).toContain("15");
      expect(lines[2]).toContain("STOK MENIPIS");
      expect(lines[2]).toContain("12");
    });

    it("should quote names so commas do not break the CSV columns", () => {
      const rows = [
        { id: 1, nama: "Kopi, Susu", kategori: "kopi", stok: 1, level: "low", suggestQty: 14 },
      ];
      const csv = csvRestock(rows, timeDownload);
      expect(csv).toContain('"Kopi, Susu"');
    });

    it("should tolerate a missing category", () => {
      const rows = [{ id: 9, nama: "Air Mineral", stok: 0, level: "out", suggestQty: 15 }];
      const csv = csvRestock(rows, timeDownload);
      expect(csv).not.toContain("undefined");
    });
  });
});
