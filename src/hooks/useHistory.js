import { useState, useMemo, useCallback, useEffect } from "react";
import { api, nonVoided } from "../utilities/utils.js";
import { isAdmin } from "../utilities/permissions.js";

// useHistory — transaksi history dengan server-side filtering & pagination untuk skalabilitas
// collapse-by-day UI state, delete + undo, dan CSV download generic.
// Juga mendukung view mode per shift (shiftIdFilter).
function useHistory({ toast_, addUndo, getNow, authH, applyBahanUsage = null }) {
  // ── State untuk pagination & filtering
  const [history, setHistory] = useState([]);       // current page transactions
  const [totalCount, setTotalCount] = useState(0);  // total matching transactions
  const [currentPage, setCurrentPage] = useState(0);
  const [pageSize] = useState(100);                 // fixed page size
  const [isLoading, setIsLoading] = useState(false);
  
  const [fFrom, setFFrom]     = useState("");
  const [fTo, setFTo]         = useState("");
  const [expandedDays, setExpandedDays] = useState(null);
  const [viewMode, setViewMode] = useState("day");
  const [shiftIdFilter, setShiftIdFilter] = useState(null);
  const [sortOrder, setSortOrder] = useState("desc");

  // Generate TRX ID in format: TRX-ddmmyyN where N is sequential for the day
  const generateTrxId = useCallback((date = new Date()) => {
    const d = getNow ? getNow() : {
      tgl: String(date.getDate()).padStart(2, "0"),
      blnNum: String(date.getMonth() + 1).padStart(2, "0"),
      thn: String(date.getFullYear())
    };
    const dateStr = `${d.tgl}${d.blnNum}${d.thn.slice(-2)}`;
    // Count transactions for this date from loaded history
    const count = history.filter(t => {
      const tDate = new Date(t.timestamp);
      return tDate.getDate() === date.getDate() &&
             tDate.getMonth() === date.getMonth() &&
             tDate.getFullYear() === date.getFullYear();
    }).length + 1;
    return `TRX-${dateStr}${count}`;
  }, [history, getNow]);

  // ── Core: Load filtered & paginated transactions from backend
  const loadFiltered = useCallback(async (page = 0, filters = {}) => {
    setIsLoading(true);
    try {
      const { fFrom: ff = fFrom, fTo: ft = fTo, shiftId = shiftIdFilter, sort = sortOrder } = filters;
      const result = await api.loadTrxFiltered({
        fFrom: ff,
        fTo: ft,
        shiftId,
        page,
        pageSize,
        sort
      });
      setHistory(result.transactions || []);
      setTotalCount(result.total || 0);
      setCurrentPage(result.page || 0);
    } catch (err) {
      console.error("[useHistory] loadFiltered error:", err);
      setHistory([]);
      setTotalCount(0);
    } finally {
      setIsLoading(false);
    }
  }, [fFrom, fTo, shiftIdFilter, sortOrder, pageSize]);

  // Initial load (backward compatible - loads first page)
  const loadInitial = useCallback((savedTrx) => {
    // If data is passed directly (e.g., from initial load), use it
    if (savedTrx && savedTrx.length) {
      const list = savedTrx;
      setHistory(list.slice(0, pageSize));
      setTotalCount(list.length);
      setCurrentPage(0);
    } else {
      // Otherwise load from backend with current filters
      loadFiltered(0);
    }
  }, [loadFiltered, pageSize]);

  // Load more (next page)
  const loadMore = useCallback(() => {
    if (!isLoading && (currentPage + 1) * pageSize < totalCount) {
      loadFiltered(currentPage + 1);
    }
  }, [currentPage, pageSize, totalCount, isLoading, loadFiltered]);

  // Refresh current page (after filter changes, delete, etc.)
  const refresh = useCallback(() => {
    loadFiltered(currentPage);
  }, [currentPage, loadFiltered]);

  // Auto-load when filters change
  useEffect(() => {
    loadFiltered(0, { fFrom, fTo, shiftId: shiftIdFilter, sort: sortOrder });
  }, [fFrom, fTo, shiftIdFilter, sortOrder, loadFiltered]);

  // Memoized sorted history (already sorted by backend, but keep for safety)
  const sortedHistory = useMemo(() => [...history].sort((a, b) => {
    const ta = new Date(a.timestamp).getTime() || 0;
    const tb = new Date(b.timestamp).getTime() || 0;
    return sortOrder === "asc" ? ta - tb : tb - ta;
  }), [history, sortOrder]);

  // Group by day for day-view
  const histByDay = useMemo(() => sortedHistory.reduce((acc, t) => {
    const k = `${t.hari}, ${t.tgl} ${t.bln} ${t.thn}`;
    if (!acc[k]) acc[k] = [];
    acc[k].push(t);
    return acc;
  }, {}), [sortedHistory]);

  // ── Shift-based filtering & grouping (client-side on current page)
  // Note: shift filtering is done server-side via shiftIdFilter
  // This groups the current page by shift for shift-view mode
  const histByShift = useMemo(() => {
    const base = sortedHistory; // Already filtered by shiftId if set
    const map = {};
    base.forEach(t => {
      if (!t.shiftId) {
        const k = "Tanpa Shift";
        if (!map[k]) map[k] = { shift: null, trxs: [] };
        map[k].trxs.push(t);
        return;
      }
      const k = t.shiftId;
      if (!map[k]) map[k] = { shift: { id: t.shiftId, shiftNum: t.shiftNum }, trxs: [] };
      map[k].trxs.push(t);
    });
    return map;
  }, [sortedHistory]);

  // For CSV export - we need all filtered transactions, not just current page
  // We'll fetch all (or a large batch) when CSV is requested
  const filteredHistoryForExport = useMemo(() => sortedHistory, [sortedHistory]);

  // Append new transaction (optimistic update)
  const appendHistory = useCallback((trx) => {
    setHistory(h => [trx, ...h].slice(0, pageSize));
    setTotalCount(c => c + 1);
  }, [pageSize]);

  // Delete transaction
  const deleteTrx = useCallback(async (id, { restoreStock = false, applyStockView } = {}) => {
    // Only admin can delete transactions
    if (!isAdmin(authH?.currentUser)) {
      toast_("Hanya admin yang dapat menghapus riwayat transaksi", "err");
      return;
    }
    const res = await api.deleteTrx(id, { restoreStock });
    // Ambil objek transaksi yang BENAR-BENAR dihapus dari main process. Kalau
    // tidak ada (baris di luar halaman yang dimuat), jatuh ke history sebagai
    // cadangan. Undo memakai saveTrx (INSERT tunggal) — bukan restoreTrx yang
    // menimpa SELURUH tabel dengan satu halaman riwayat.
    const deleted = res?.trx || history.find(t => t.id === id) || null;
    // Langkah 2b: main mengembalikan peta stok final {id: stok}; patch view.
    const applied = res?.applied || {};
    if (Object.keys(applied).length && applyStockView) applyStockView(applied);
    // Bahan baku: kembalikan pemakaian bila stok diminta dipulihkan.
    const restorable = restoreStock && deleted && deleted.status !== "voided" && !deleted.voided;
    if (restorable && applyBahanUsage) applyBahanUsage(deleted.items || [], 1);
    setHistory(h => h.filter(t => t.id !== id));
    setTotalCount(c => c - 1);
    addUndo("Hapus Transaksi", async () => {
      if (!deleted) return false;
      await api.saveTrx(deleted);
      setHistory(h => [deleted, ...h]);
      setTotalCount(c => c + 1);
      // Kembalikan stok ke kondisi semula: delta dinegasikan (Langkah 2b).
      if (Object.keys(applied).length) {
        // Hitung ulang dari trx yang dihapus: delta negatif dari item transaksi
        // tsb (negasi penuh tak selalu benar karena clamp 0 di main).
        const reDeduct = (deleted.items || []).reduce((acc, it) => {
          const q = Math.abs(Number(it.baseQty ?? it.qty) || 0);
          if (it?.id && q) acc[it.id] = (acc[it.id] || 0) - q;
          return acc;
        }, {});
        const r = await api.applyStock(reDeduct, { type: "un-delete-trx", ref: id });
        if (r?.ok && r.stock && applyStockView) applyStockView(r.stock);
        if (applyBahanUsage) applyBahanUsage(deleted.items || [], -1);
      }
      return true;
    });
  }, [history, totalCount, addUndo, authH, toast_, applyBahanUsage]);

  // Clear all transactions
  const clearAllTrx = useCallback(async ({ restoreStock = false, applyStockView } = {}) => {
    if (!isAdmin(authH?.currentUser)) {
      toast_("Hanya admin yang dapat menghapus riwayat transaksi", "err");
      return;
    }
    const res = await api.clearTrx({ restoreStock });
    const backupFile = res?.backupFile || null;
    const applied = res?.applied || {};
    if (Object.keys(applied).length && applyStockView) applyStockView(applied);
    // Bahan baku: kembalikan pemakaian seluruh transaksi non-void bila diminta.
    if (restoreStock && applyBahanUsage && Array.isArray(res?.cleared)) {
      for (const t of res.cleared) {
        if (t && t.status !== "voided" && !t.voided) applyBahanUsage(t.items || [], 1);
      }
    }
    setHistory([]);
    setTotalCount(0);
    addUndo("Hapus Semua Riwayat", async () => {
      if (!backupFile) return false;
      const r = await api.restoreClearedTrx(backupFile);
      if (!r?.ok) return false;
      await refresh();
      return true;
    });
  }, [refresh, addUndo, authH, toast_, applyBahanUsage]);

  // CSV timestamp
  const at = useCallback(() => {
    const t = getNow();
    return `${t.hari} ${t.tgl}-${t.bln}-${t.thn} ${t.jam}:${t.mnt}:${t.dtk}`;
  }, [getNow]);

  // CSV export
  const doCSV = useCallback(async (filename, content) => {
    const t = getNow();
    const fn = `${filename}_${t.tgl}-${t.blnNum}-${t.thn}.csv`;
    try {
      const res = await api.saveCSV({ filename: fn, content });
      const path = res?.path || res?.filePath;
      if (res?.ok) toast_(path ? `${filename} disimpan: ${path}` : `${filename} disimpan`, "ok", path ? 8000 : 3000);
      else toast_(res?.error || "Unduhan CSV dibatalkan", "err");
    } catch (error) {
      toast_(error?.message || "Gagal menyimpan CSV", "err");
    }
  }, [getNow, toast_]);

  // Load all for export (fetch all pages)
  const loadAllForExport = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await api.loadTrxFiltered({
        fFrom,
        fTo,
        shiftId: shiftIdFilter,
        page: 0,
        pageSize: 10000, // Large page size to get all
        sort: sortOrder
      });
      // Exclude voided sales from every CSV export. A voided trx is kept in the
      // DB for audit but must never contribute to exported totals, sales-rate,
      // per-menu or per-metode figures.
      return nonVoided(result.transactions || []);
    } catch (err) {
      console.error("[useHistory] loadAllForExport error:", err);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [fFrom, fTo, shiftIdFilter, sortOrder]);

  const loadAllForReport = useCallback(async (shiftId, { throwOnError = false } = {}) => {
    try {
      const pageSizeForReport = 10000;
      const transactions = [];
      let page = 0;
      let total = 0;
      do {
        const result = await api.loadTrxFiltered({
          page,
          pageSize: pageSizeForReport,
          shiftId: shiftId || undefined,
          sort: sortOrder,
        });
        transactions.push(...(result.transactions || []));
        total = Number(result.total || transactions.length);
        page += 1;
        if (!result.transactions?.length) break;
      } while (transactions.length < total);
      return transactions;
    } catch (err) {
      console.error("[useHistory] loadAllForReport error:", err);
      if (throwOnError) throw err;
      return [];
    }
  }, [sortOrder]);

  // Toggle sort order
  const toggleSort = useCallback(() => {
    setSortOrder(prev => prev === "asc" ? "desc" : "asc");
  }, []);

  return {
    // Data
    history,              // current page transactions
    filteredHistory: filteredHistoryForExport, // for backward compat (used in CSV)
    histByDay,
    histByShift,
    
    // Pagination
    totalCount,
    currentPage,
    pageSize,
    isLoading,
    hasMore: (currentPage + 1) * pageSize < totalCount,
    loadMore,
    refresh,
    
    // Filters
    fFrom, fTo, setFFrom, setFTo,
    shiftIdFilter, setShiftIdFilter,
    viewMode, setViewMode,
    sortOrder, toggleSort,
    
    // UI state
    expandedDays, setExpandedDays,
    
    // Actions
    generateTrxId,
    loadInitial,
    appendHistory,
    deleteTrx,
    clearAllTrx,
    at,
    doCSV,
    loadAllForExport,
    loadAllForReport,
  };
}

export { useHistory };
