import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock localStorage and window for Node test environment
const store = new Map();
const localStorageMock = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, val) => store.set(key, String(val)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
};

globalThis.localStorage = localStorageMock;
if (typeof globalThis.window === "undefined") {
  globalThis.window = globalThis;
}

import { LS, api, isVoided, nonVoided, healVoidedTrx } from "./utils.js";

describe("utils.js - Void helpers", () => {
  describe("isVoided", () => {
    it("detects the current status flag", () => {
      expect(isVoided({ status: "voided" })).toBe(true);
      expect(isVoided({ status: "paid" })).toBe(false);
    });

    it("detects the legacy voided boolean", () => {
      expect(isVoided({ voided: true })).toBe(true);
      expect(isVoided({ voided: false })).toBe(false);
    });

    it("is falsy for null/undefined", () => {
      expect(isVoided(null)).toBe(false);
      expect(isVoided(undefined)).toBe(false);
    });
  });

  describe("nonVoided", () => {
    it("strips voided transactions and keeps the rest", () => {
      const list = [{ id: 1 }, { id: 2, status: "voided" }, { id: 3, voided: true }, { id: 4 }];
      expect(nonVoided(list).map((t) => t.id)).toEqual([1, 4]);
    });

    it("returns an empty array for non-array input", () => {
      expect(nonVoided(null)).toEqual([]);
      expect(nonVoided(undefined)).toEqual([]);
    });
  });

  describe("healVoidedTrx", () => {
    it("leaves non-voided transactions untouched", () => {
      const t = { id: 1, total: 5000 };
      expect(healVoidedTrx(t)).toBe(t);
    });

    it("repairs a clobbered void row by restoring safe defaults", () => {
      const healed = healVoidedTrx({ id: 9, status: "voided", voidReason: "error" });
      expect(healed.voided).toBe(true);
      expect(healed.total).toBe(0);
      expect(healed.subtotal).toBe(0);
      expect(healed.kembalian).toBe(0);
      expect(healed.items).toEqual([]);
      expect(healed.voidReason).toBe("error");
    });

    it("preserves real financial values on a voided row", () => {
      const healed = healVoidedTrx({ id: 9, status: "voided", total: 25000, items: [{ qty: 2 }] });
      expect(healed.total).toBe(25000);
      expect(healed.items).toEqual([{ qty: 2 }]);
    });
  });
});

describe("utils.js - LocalStorage Helper (LS) & API Wrapper", () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.kasirAPI;
  });

  describe("LS Helper Function", () => {
    it("should set and get values from localStorage with JSON serialization", () => {
      const sampleData = { name: "Kedai Kopi", id: 123 };
      LS("test_key", sampleData);

      const retrieved = LS("test_key");
      expect(retrieved).toEqual(sampleData);
    });

    it("should return null when getting non-existent key from localStorage", () => {
      const retrieved = LS("non_existent_key");
      expect(retrieved).toBeNull();
    });

    it("should correctly handle primitive values like strings, numbers, booleans", () => {
      LS("str_key", "hello");
      expect(LS("str_key")).toBe("hello");

      LS("num_key", 42);
      expect(LS("num_key")).toBe(42);

      LS("bool_key", true);
      expect(LS("bool_key")).toBe(true);
    });
  });

  describe("API Object - Browser LocalStorage Fallback Mode", () => {
    it("should load empty array for transactions if none saved", async () => {
      const trxs = await api.loadTrx();
      expect(trxs).toEqual([]);
    });

    it("should save and load transactions in localStorage", async () => {
      const trx1 = { id: "TRX-1", total: 50000 };
      await api.saveTrx(trx1);

      const trxs = await api.loadTrx();
      expect(trxs).toHaveLength(1);
      expect(trxs[0]).toEqual(trx1);
    });

    it("should delete transaction by ID", async () => {
      await api.saveTrx({ id: "TRX-1", total: 10000 });
      await api.saveTrx({ id: "TRX-2", total: 20000 });

      await api.deleteTrx("TRX-1");
      const trxs = await api.loadTrx();
      expect(trxs).toHaveLength(1);
      expect(trxs[0].id).toBe("TRX-2");
    });

    it("should restore and clear transactions", async () => {
      await api.restoreTrx([{ id: "TRX-A" }, { id: "TRX-B" }]);
      expect(await api.loadTrx()).toHaveLength(2);

      await api.clearTrx();
      expect(await api.loadTrx()).toEqual([]);
    });

    it("deleteTrx menaruh transaksi di tempat sampah (browser)", async () => {
      await api.saveTrx({ id: "TRX-1", total: 10000 });
      await api.deleteTrx("TRX-1");
      const { items } = await api.loadTrash();
      expect(items).toHaveLength(1);
      expect(items[0].trx).toEqual({ id: "TRX-1", total: 10000 });
    });

    it("clearTrx menaruh semua transaksi di tempat sampah (browser)", async () => {
      await api.saveTrx({ id: "TRX-1", total: 1 });
      await api.saveTrx({ id: "TRX-2", total: 2 });
      await api.clearTrx();
      expect((await api.loadTrash()).items.map((i) => i.id).sort()).toEqual(["TRX-1", "TRX-2"]);
    });

    it("trash-restore mengembalikan transaksi dan menahan stok lagi (browser)", async () => {
      LS("ykk_menu", [{ id: "M1", nama: "Kopi", stok: 3 }]);
      await api.saveTrx({ id: "TRX-1", items: [{ id: "M1", qty: 2 }] });
      await api.deleteTrx("TRX-1", { restoreStock: true });
      expect((await api.loadMenu())[0].stok).toBe(5);

      const res = await api.restoreTrash("TRX-1");
      expect(res.restored).toBe(true);
      expect((await api.loadTrx()).map((t) => t.id)).toEqual(["TRX-1"]);
      expect((await api.loadMenu())[0].stok).toBe(3);
      expect((await api.loadTrash()).items).toEqual([]);
    });

    it("trash-restore mengganti nomor yang sudah dipakai transaksi baru (browser)", async () => {
      await api.saveTrx({ id: "TRX-2611261", total: 1 });
      await api.deleteTrx("TRX-2611261");
      await api.processPayment({ trx: { id: "TRX-2611261", total: 2 } });

      const res = await api.restoreTrash("TRX-2611261");

      expect(res.trx.id).toBe("TRX-261126101");
      expect((await api.loadTrx()).map((t) => t.id).sort()).toEqual(["TRX-2611261", "TRX-261126101"]);
    });

    it("trash-delete menghapus permanen (browser)", async () => {
      await api.saveTrx({ id: "TRX-1", total: 1 });
      await api.deleteTrx("TRX-1");
      expect(await api.deleteTrash("TRX-1")).toEqual({ ok: true });
      expect((await api.loadTrash()).items).toEqual([]);
    });

    it("loadTrash membuang entri lebih tua dari 30 hari (browser)", async () => {
      LS("ykk_trx_trash", [{ id: "X", trx: { id: "X" }, deletedAt: new Date(Date.now() - 31 * 86400000).toISOString(), stockRestored: false }]);
      expect((await api.loadTrash()).items).toEqual([]);
    });

    it("deleteTrx with restoreStock adds stock back (browser)", async () => {
      LS("ykk_menu", [
        { id: "M1", nama: "Kopi", stok: 3 },
        { id: "M2", nama: "Teh", stok: 10 },
      ]);
      LS("ykk_trx", [
        { id: "TRX-1", items: [{ id: "M1", qty: 2 }, { id: "M2", baseQty: 1, qty: 6 }] },
      ]);

      const res = await api.deleteTrx("TRX-1", { restoreStock: true });
      expect(res.applied).toEqual({ M1: 5, M2: 11 });
      const menu = await api.loadMenu();
      expect(menu.find((m) => m.id === "M1").stok).toBe(5);
      expect(menu.find((m) => m.id === "M2").stok).toBe(11);
      expect(await api.loadTrx()).toEqual([]);
    });

    it("deleteTrx without restoreStock leaves stock untouched (browser)", async () => {
      LS("ykk_menu", [{ id: "M1", nama: "Kopi", stok: 3 }]);
      LS("ykk_trx", [{ id: "TRX-1", items: [{ id: "M1", qty: 2 }] }]);

      const res = await api.deleteTrx("TRX-1");
      expect(res.applied).toEqual({});
      const menu = await api.loadMenu();
      expect(menu[0].stok).toBe(3);
    });

    it("deleteTrx restoreStock skips voided transactions and unlimited items (browser)", async () => {
      LS("ykk_menu", [
        { id: "M1", nama: "Kopi", stok: 3 },
        { id: "M2", nama: "Teh", stok: null },
      ]);
      LS("ykk_trx", [
        { id: "V1", status: "voided", items: [{ id: "M1", qty: 5 }] },
      ]);
      const voidRes = await api.deleteTrx("V1", { restoreStock: true });
      expect(voidRes.applied).toEqual({});

      LS("ykk_trx", [{ id: "T2", items: [{ id: "M1", qty: 1 }, { id: "M2", qty: 9 }] }]);
      const res = await api.deleteTrx("T2", { restoreStock: true });
      expect(res.applied).toEqual({ M1: 4 });
    });

    it("clearTrx with restoreStock adds sum of non-void transactions (browser)", async () => {
      LS("ykk_menu", [{ id: "M1", nama: "Kopi", stok: 1 }]);
      LS("ykk_trx", [
        { id: "T1", items: [{ id: "M1", qty: 2 }] },
        { id: "T2", items: [{ id: "M1", qty: 3 }] },
        { id: "V1", status: "voided", items: [{ id: "M1", qty: 9 }] },
      ]);

      const res = await api.clearTrx({ restoreStock: true });
      expect(res.applied).toEqual({ M1: 6 });
      expect(await api.loadTrx()).toEqual([]);
      const menu = await api.loadMenu();
      expect(menu[0].stok).toBe(6);
    });

    it("restorePreview counts units & skips void (browser)", async () => {
      LS("ykk_trx", [
        { id: "T1", items: [{ id: "M1", qty: 5 }] },
        { id: "V1", status: "voided", items: [{ id: "M1", qty: 4 }] },
      ]);

      const one = await api.restorePreview({ id: "T1" });
      expect(one).toEqual({ ok: true, trxCount: 1, totalQty: 5, skipped: 0 });

      const all = await api.restorePreview({ all: true });
      expect(all).toEqual({ ok: true, trxCount: 1, totalQty: 5, skipped: 1 });
    });

    it("should process payment atomically in browser mode", async () => {
      // Setup active bills and initial menu
      LS("ykk_bills", [{ id: "BILL-1", meja: "01" }, { id: "BILL-2", meja: "02" }]);
      LS("ykk_menu", [{ id: "M1", nama: "Kopi", stok: 10 }]);

      const paymentData = {
        trx: { id: "TRX-NEW", total: 15000, items: [{ id: "M1", nama: "Kopi", qty: 1 }] },
      };

      const result = await api.processPayment(paymentData);
      expect(result.ok).toBe(true);
      expect(result.stock).toEqual({ M1: 9 }); // stok dihitung di fallback (10 - 1)

      const trxs = await api.loadTrx();
      expect(trxs[0].id).toBe("TRX-NEW");

      const menu = await api.loadMenu();
      expect(menu[0].stok).toBe(9);
    });

    it("allocates browser checkout IDs from stored transaction IDs", async () => {
      LS("ykk_trx", [{ id: "TRX-2411261" }, { id: "TRX-2411263" }]);

      const result = await api.processPayment({
        trx: { id: "TRX-2411261", kdsSourceRef: "TRX-2411261" },
      });

      expect(result.trx.id).toBe("TRX-2411264");
      expect(result.trx.kdsSourceRef).toBe("TRX-2411264");
      expect((await api.loadTrx())[0].id).toBe("TRX-2411264");
    });

    it("should load default settings and handle save settings", async () => {
      const defaultSettings = await api.loadSettings();
      expect(defaultSettings).toEqual({});

      await api.saveSettings({ printerName: "Thermal POS" });
      const updated = await api.loadSettings();
      expect(updated).toEqual({ printerName: "Thermal POS" });
    });

    it("should handle QRIS operations in browser mode", async () => {
      expect(await api.loadQris()).toEqual({});

      await api.saveQris({ bca: "qris_bca_data" });
      expect(await api.loadQris()).toEqual({ bca: "qris_bca_data" });

      await api.deleteQris("bca");
      expect(await api.loadQris()).toEqual({});
    });

    it("should return fallback data for printReceipt and getPrinters in browser mode", async () => {
      const printers = await api.getPrinters();
      expect(printers).toEqual([]);

      const printResult = await api.printReceipt({});
      expect(printResult).toEqual({
        ok: false,
        error: "Hanya tersedia di aplikasi desktop",
      });
    });

    it("should return 'localStorage' for getDataPath in browser mode", async () => {
      const path = await api.getDataPath();
      expect(path).toBe("localStorage");
    });

    it("stockIn adds qty, updates modal & logs an 'in' movement (browser)", async () => {
      LS("ykk_menu", [{ id: "M1", nama: "Kopi", stok: 5, modal: 3000 }]);
      const res = await api.stockIn({ id: "M1", qty: 7, modalBaru: 3500, note: "kulakan" });
      expect(res.ok).toBe(true);
      expect(res.stock).toEqual({ M1: 12 });
      const menu = await api.loadMenu();
      expect(menu[0].stok).toBe(12);
      expect(menu[0].modal).toBe(3500);
      const mv = await api.stockMovements({ productId: "M1" });
      expect(mv).toHaveLength(1);
      expect(mv[0]).toMatchObject({ productId: "M1", type: "in", delta: 7, stokAfter: 12, note: "kulakan" });
    });

    it("stockIn rejects invalid qty and unlimited stock (browser)", async () => {
      LS("ykk_menu", [{ id: "M1", nama: "Kopi", stok: 5 }, { id: "M2", nama: "Teh", stok: null }]);
      expect((await api.stockIn({ id: "M1", qty: 0 })).ok).toBe(false);
      expect((await api.stockIn({ id: "M2", qty: 4 })).ok).toBe(false);
      expect((await api.loadMenu()).find((m) => m.id === "M1").stok).toBe(5);
    });

    it("stockOpname sets physical counts & logs only the diff (browser)", async () => {
      LS("ykk_menu", [{ id: "M1", nama: "Kopi", stok: 10 }, { id: "M2", nama: "Teh", stok: 4 }]);
      const res = await api.stockOpname([{ id: "M1", counted: 8 }, { id: "M2", counted: 4 }], { note: "fisik" });
      expect(res.ok).toBe(true);
      expect(res.stock).toEqual({ M1: 8, M2: 4 });
      const mv = await api.stockMovements();
      expect(mv).toHaveLength(1);
      expect(mv[0]).toMatchObject({ productId: "M1", type: "opname", delta: -2, stokAfter: 8, note: "fisik" });
    });

    it("stockSet flips null<->number without logging (browser)", async () => {
      LS("ykk_menu", [{ id: "M1", nama: "Kopi", stok: null }]);
      expect((await api.stockSet("M1", 20)).ok).toBe(true);
      expect((await api.loadMenu())[0].stok).toBe(20);
      expect((await api.stockSet("M1", null)).ok).toBe(true);
      expect((await api.loadMenu())[0].stok).toBeNull();
      expect(await api.stockMovements()).toEqual([]);
      expect((await api.stockSet("ghost", 1)).ok).toBe(false);
    });

    it("stockMovements filters by product and honours limit (browser)", async () => {
      LS("ykk_menu", [{ id: "M1", nama: "Kopi", stok: 0 }, { id: "M2", nama: "Teh", stok: 0 }]);
      await api.stockIn({ id: "M1", qty: 1 });
      await api.stockIn({ id: "M2", qty: 2 });
      await api.stockIn({ id: "M1", qty: 3 });
      expect(await api.stockMovements({ productId: "M1" })).toHaveLength(2);
      expect(await api.stockMovements({ productId: "M2" })).toHaveLength(1);
      expect(await api.stockMovements({ limit: 2 })).toHaveLength(2);
      expect(await api.stockMovements()).toHaveLength(3);
    });
  });

  describe("API Object - Electron window.kasirAPI Delegated Mode", () => {
    let mockKasirAPI;

    beforeEach(() => {
      mockKasirAPI = {
        loadTrx: vi.fn().mockResolvedValue([{ id: "ELEC-1" }]),
        saveTrx: vi.fn().mockResolvedValue({ ok: true }),
        deleteTrx: vi.fn().mockResolvedValue({ ok: true }),
        restoreTrx: vi.fn().mockResolvedValue({ ok: true }),
        clearTrx: vi.fn().mockResolvedValue({ ok: true }),
        processPayment: vi.fn().mockResolvedValue({ ok: true, id: "ELEC-1" }),
        loadMenu: vi.fn().mockResolvedValue([{ id: "M1" }]),
        upsertMenu: vi.fn().mockResolvedValue({ ok: true }),
        deleteMenu: vi.fn().mockResolvedValue({ ok: true }),
        replaceMenu: vi.fn().mockResolvedValue({ ok: true }),
        applyStock: vi.fn().mockResolvedValue({ ok: true, stock: { M1: 4 } }),
        stockIn: vi.fn().mockResolvedValue({ ok: true, stock: { M1: 9 } }),
        stockSet: vi.fn().mockResolvedValue({ ok: true, stock: { M1: 20 } }),
        stockOpname: vi.fn().mockResolvedValue({ ok: true, stock: { M1: 8 } }),
        stockMovements: vi.fn().mockResolvedValue([{ productId: "M1", type: "in" }]),
        loadSettings: vi.fn().mockResolvedValue({ printDelay: 100 }),
        getDataPath: vi.fn().mockResolvedValue("/app/data"),
        getPrinters: vi.fn().mockResolvedValue([{ name: "POS-58" }]),
        printReceipt: vi.fn().mockResolvedValue({ ok: true }),
      };
      window.kasirAPI = mockKasirAPI;
    });

    it("should forward loadTrx calls to window.kasirAPI", async () => {
      const result = await api.loadTrx();
      expect(mockKasirAPI.loadTrx).toHaveBeenCalled();
      expect(result).toEqual([{ id: "ELEC-1" }]);
    });

    it("should forward processPayment calls to window.kasirAPI", async () => {
      const data = { trx: { id: "ELEC-1" } };
      const res = await api.processPayment(data);
      expect(mockKasirAPI.processPayment).toHaveBeenCalledWith(data);
      expect(res).toEqual({ ok: true, id: "ELEC-1" });
    });

    it("should return desktop path from window.kasirAPI", async () => {
      const path = await api.getDataPath();
      expect(mockKasirAPI.getDataPath).toHaveBeenCalled();
      expect(path).toBe("/app/data");
    });

    it("should delegate stock IPC calls to window.kasirAPI", async () => {
      await api.stockIn({ id: "M1", qty: 5, modalBaru: 2000 });
      expect(mockKasirAPI.stockIn).toHaveBeenCalledWith({ id: "M1", qty: 5, modalBaru: 2000, note: undefined, actor: undefined });
      await api.stockSet("M1", 20);
      expect(mockKasirAPI.stockSet).toHaveBeenCalledWith({ id: "M1", stok: 20 });
      await api.stockOpname([{ id: "M1", counted: 8 }], { note: "x" });
      expect(mockKasirAPI.stockOpname).toHaveBeenCalledWith([{ id: "M1", counted: 8 }], { note: "x" });
      await api.stockMovements({ productId: "M1" });
      expect(mockKasirAPI.stockMovements).toHaveBeenCalledWith({ productId: "M1" });
    });
  });
});
