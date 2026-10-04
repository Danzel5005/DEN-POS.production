import { useState, useCallback } from "react";
import { api } from "../utilities/utils.js";

// useBills — array open bills + ID counter + CRUD murni.
// SENGAJA tidak menyimpan activeBill (itu di useCart, keputusan eksplisit
// user karena activeBill selalu di-reset bersamaan dengan clearCart()).
// saveOpenBill & loadBillToCart juga TIDAK di sini — mereka menulis ke
// state cart secara langsung, jadi tinggal di useCart untuk menghindari
// dua hook saling menulis ke state satu sama lain.
function useBills({ toast_, addUndo, applyBahanUsage = null, kdsEnabledRef = null }) {
  const [bills, setBills] = useState([]);
  const [billId, setBillId] = useState(1);

  // deps kosong aman: hanya setter, tidak baca state apapun.
  const loadInitial = useCallback((savedBills) => {
    const list = (savedBills || []).filter(b => b.status === "open" || !b.status);
    setBills(list);
    const maxB = list.reduce((m, b) => Math.max(m, Number(b.id) || 0), 0);
    setBillId(maxB + 1);
  }, []);

  // Close single bill — update state, persist, add undo
  // Uses functional update to avoid stale closure
  const closeBill = useCallback(async (id) => {
    if (!id) return;
    setBills(prev => {
      const billToClose = prev.find(b => String(b.id) === String(id));
      const snap = [...prev];
      const updated = prev.filter(b => String(b.id) !== String(id));
      api.saveBills(updated);
      if (billToClose && (kdsEnabledRef?.current || billToClose.kdsSent)) void api.kdsCancel(String(id));
      if (kdsEnabledRef?.current || billToCancel.kdsSent) void api.kdsCancel(String(id));
      addUndo("Hapus Open Bill", async () => {
        await api.saveBills(snap);
        setBills(snap);
      });
      return updated;
    });
  }, [addUndo, kdsEnabledRef]);

  // Close single bill WITHOUT payment (cancel) - restore stock
  // This is called when user deletes an open bill without paying.
  // Langkah 2: stok dipulihkan lewat api.applyStock (delta positif),
  // dihitung dari item bill. Tidak ada perhitungan menu di renderer.
  const cancelBill = useCallback(async (id, { applyStockView } = {}) => {
    if (!id) return;
    setBills(prev => {
      const billToCancel = prev.find(b => String(b.id) === String(id));
      if (!billToCancel) return prev;
      
      const snap = [...prev];
      const updated = prev.filter(b => String(b.id) !== String(id));
      api.saveBills(updated);
      if (kdsEnabledRef?.current) void api.kdsCancel(String(id));

      // Delta positif: kembalikan stok item bill yang dibatalkan.
      const deltas = (billToCancel.items || []).reduce((acc, item) => {
        acc[item.id] = (acc[item.id] || 0) + (item.qty || 0);
        return acc;
      }, {});
      if (Object.keys(deltas).length > 0) {
        api.applyStock(deltas, { type: "cancel", ref: String(id) })
          .then((res) => { if (res?.ok && res.stock && applyStockView) applyStockView(res.stock); })
          .catch(() => {});
      }
      // Bahan baku: kembalikan pemakaian item bill yang dibatalkan.
      if (applyBahanUsage) applyBahanUsage(billToCancel.items || [], 1);

      addUndo("Batalkan Open Bill", async () => {
        await api.saveBills(snap);
        setBills(snap);
        // Re-deduct stock when undoing the cancellation: pakai delta negatif
        // (kebalikan dari restore di atas).
        const reDeduct = (billToCancel.items || []).reduce((acc, item) => {
          acc[item.id] = (acc[item.id] || 0) - (item.qty || 0);
          return acc;
        }, {});
        if (Object.keys(reDeduct).length > 0) {
          const res = await api.applyStock(reDeduct, { type: "uncancel", ref: String(id) });
          if (res?.ok && res.stock && applyStockView) applyStockView(res.stock);
        }
        // Bahan baku: potong kembali pemakaian saat undo pembatalan.
        if (applyBahanUsage) applyBahanUsage(billToCancel.items || [], -1);
      });
      return updated;
    });
  }, [addUndo, applyBahanUsage, kdsEnabledRef]);

  // Clear all bills
  const clearAllBills = useCallback(async () => {
    setBills(prev => {
      const snap = [...prev];
      api.clearBills();
      snap.filter((bill) => kdsEnabledRef?.current || bill.kdsSent).forEach((bill) => { void api.kdsCancel(String(bill.id)); });
      addUndo("Hapus Semua Open Bill", async () => {
        await api.restoreBills(snap);
        setBills(snap);
      });
      return [];
    });
  }, [addUndo, kdsEnabledRef]);

  // Persist bills (called from useCart.saveOpenBill and after payment)
  // Uses functional update to avoid stale closure
  const persistBills = useCallback(async (updated) => {
    if (!Array.isArray(updated)) return;
    await api.saveBills(updated);
    setBills(updated);
  }, []);

  // Local-only removal (called after successful payment)
  // Main process already removed from file atomically
  const removeBillLocal = useCallback((billIdToRemove) => {
    if (!billIdToRemove) return;
    setBills(prev => prev.filter(b => String(b.id) !== String(billIdToRemove)));
  }, []);

  // Create new bill
  const createBill = useCallback(async (billData) => {
    const newBill = {
      id: billId,
      ...billData,
      status: "open",
      createdAt: billData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const updated = [...bills, newBill];
    await persistBills(updated);
    setBillId(n => n + 1);
    return newBill;
  }, [billId, bills, persistBills]);

  // Update existing bill
  const updateBill = useCallback(async (billId, updates) => {
    setBills(prev => {
      const updated = prev.map(b =>
        String(b.id) === String(billId)
          ? { ...b, ...updates, updatedAt: new Date().toISOString() }
          : b
      );
      api.saveBills(updated);
      return updated;
    });
  }, []);

  // Get open bills count
  const openCount = bills.filter(b => b.status === "open").length;

  return {
    bills,
    billId,
    setBillId,
    openCount,
    loadInitial,
    closeBill,
    cancelBill,
    clearAllBills,
    persistBills,
    removeBillLocal,
    createBill,
    updateBill,
  };
}

export { useBills };
