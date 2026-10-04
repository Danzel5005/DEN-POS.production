import { useCallback, useMemo, useState } from "react";
import { api } from "../utilities/utils.js";

const VOID_REASONS = [
  { key: "", label: "— Pilih alasan —" },
  { key: "cancel", label: "Pembatalan pelanggan" },
  { key: "refund", label: "Pengembalian" },
  { key: "error", label: "Kesalahan input" },
  { key: "promotion", label: "Promo gratis" },
  { key: "other", label: "Lainnya" },
];

// useHistoryVoid — domain logic for marking a completed transaction as voided.
// Void never deletes the sale: it flags it so reports can exclude it while the
// audit trail (who/when/why) stays intact.
function useHistoryVoid({ toast_, addUndo, onVoided, applyBahanUsage = null, kdsEnabledRef = null } = {}) {
  const [voidModal, setVoidModal] = useState(false);
  const [voidTargetId, setVoidTargetId] = useState(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidNote, setVoidNote] = useState("");
  const [isVoiding, setIsVoiding] = useState(false);

  const voidTrx = useCallback(async (id, reason, actor) => {
    if (!id) return false;
    if (isVoiding) return false;
    setIsVoiding(true);
    try {
      const res = await api.voidTrx(id, { reason, actor, note: voidNote });
      if (res && res.ok === false) throw new Error(res.error || "Gagal void transaksi");
      if (kdsEnabledRef?.current || res?.kdsTicketSent) void api.kdsCancel(String(res?.sourceRef || id));
      // Bahan baku: kembalikan pemakaian transaksi yang di-void (bahan baku ada
      // di renderer; main process hanya tahu stok menu).
      if (applyBahanUsage && Array.isArray(res?.items)) applyBahanUsage(res.items, 1);
      setVoidModal(false);
      setVoidTargetId(null);
      setVoidReason("");
      setVoidNote("");
      toast_("Transaksi ditandai void", "ok");
      // res.menu berisi menu dengan stok yang sudah dikembalikan (Langkah 1).
      // Kalau tidak ada (mis. transaksi void tanpa item berstok), tetap panggil
      // tanpa argumen supaya refresh riwayat tetap jalan.
      onVoided?.(id, res?.menu || null);
      return true;
    } catch (err) {
      toast_(err?.message || "Gagal void transaksi", "err");
      return false;
    } finally {
      setIsVoiding(false);
    }
  }, [toast_, voidNote, onVoided, isVoiding, applyBahanUsage, kdsEnabledRef]);

  const openVoidModal = useCallback((id) => {
    if (!id) return;
    setVoidTargetId(id);
    setVoidReason("");
    setVoidNote("");
    setVoidModal(true);
  }, []);

  const closeVoidModal = useCallback(() => {
    setVoidModal(false);
    setVoidTargetId(null);
    setVoidReason("");
    setVoidNote("");
  }, []);

  return { voidModal, setVoidModal, voidTargetId, setVoidTargetId, isVoiding, voidReason, setVoidReason, voidNote, setVoidNote, voidTrx, openVoidModal, closeVoidModal };
}

export { useHistoryVoid, VOID_REASONS };
