import { useEffect, useRef } from "react";
import { calcPrice } from "../utilities/calculations.js";
import { fmt } from "../utilities/receipt.js";
import { G, OR, W, BD, MT, BG, LT, row, RADIUS, TYPOGRAPHY, COLOR_PALETTE, SPACING } from "../constants/design.js";
import { Tag } from "./Tag.jsx";

// BillDetailModal — detail tagihan dengan aksi lengkap
export default function BillDetailModal({
  bill,
  receiptAdditionals = [],
  pricingConfig = {},
  customerEnabled = true,
  onClose,
  onAddOrder,
  onPay,
  onDelete,
}) {
  const overlayRef = useRef(null);
  const contentRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (overlayRef.current && !contentRef.current?.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const sub = bill.items?.reduce((s, i) => s + (i.harga || 0) * (i.qty || 0), 0) || 0;
  // Must mirror ViewOpenBill: pass bill.items + pricingConfig, otherwise the
  // modal would show different discount/tax/service/total than the bill card.
  const { pajak: p, service: s, discount: disc, total: tot } = calcPrice(sub, { ...pricingConfig, items: bill.items || [], manualDiscount: { type: bill.manualDiscountType || pricingConfig.manualCartDiscount?.type, value: bill.manualDiscountValue } });
  const itemCount = bill.items?.reduce((sum, i) => sum + (i.qty || 0), 0) || 0;
  const created = new Date(bill.createdAt);
  const timeStr = created.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  const dateStr = created.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" });

  const formatReceiptAdditionals = () => {
    if (!bill || !receiptAdditionals?.length) return [];
    return receiptAdditionals
      .filter(f => f.category === "receipt" && f.visible !== false)
      .map(field => {
        const val = bill[field.key];
        // Keep the row even when empty so the cashier can SEE that the field
        // exists (and was not filled) — hiding it made the modal look like
        // the receipt additionals were lost.
        const isEmpty = val === undefined || val === null || val === "";
        // Use field's icon if available, otherwise default
        let icon = field.icon || "📋";
        // Fallback icons for common fields
        if (field.key === "tableNum" || field.key === "nomor_meja") icon = "🪑";
        else if (field.key === "jumlah_pax") icon = "👥";
        else if (field.key === "catatan") icon = "📝";
        return { label: field.label, value: isEmpty ? "—" : val, icon, isEmpty };
      })
      .filter(Boolean);
  };

  const receiptFields = formatReceiptAdditionals();

  // Customer/member snapshot denormalized on the bill (see useCart.saveOpenBill).
  const customerNama = (bill?.customerNama || "").trim();
  const customerTelepon = (bill?.customerTelepon || "").trim();

  return (
    <div
      ref={overlayRef}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 400,
        animation: "fadeIn 0.15s ease"
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bill-detail-title"
    >
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
      `}</style>

      <div
        ref={contentRef}
        style={{
          background: W,
          borderRadius: `${RADIUS.xl} ${RADIUS.xl} 0 0`,
          width: "100%",
          maxWidth: 420,
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 -10px 40px rgba(0,0,0,0.15)",
          animation: "slideUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)"
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div style={{
          width: 36,
          height: 4,
          background: BD,
          borderRadius: 2,
          margin: `${SPACING.md} auto ${SPACING.sm}`,
          cursor: "grab"
        }} />

        {/* Header */}
        <div style={{
          padding: `0 ${SPACING.lg} ${SPACING.md}`,
          borderBottom: `1px solid ${BD}`,
          ...row,
          justifyContent: "space-between",
          alignItems: "flex-start"
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ ...row, alignItems: "center", gap: SPACING.sm, marginBottom: SPACING.xs }}>
              <Tag label="BELUM DIBAYAR" bg="#fff4e0" tc="#b87a00" size="sm" />
              {(bill.tableNumber || bill.tableNum) && (
                <span style={{
                  fontSize: TYPOGRAPHY.body.fontSize,
                  fontWeight: 700,
                  color: G,
                  background: "#f0fdf4",
                  padding: `${SPACING.xs} ${SPACING.sm}`,
                  borderRadius: RADIUS.md,
                  border: "1px solid #a8d5b8"
                }}>
                  Meja {bill.tableNumber || bill.tableNum}
                </span>
              )}
            </div>
            <div style={{ fontSize: TYPOGRAPHY.caption.fontSize, color: MT }}>
              {dateStr} • {timeStr}
              {Number(bill.pax) > 0 && <> • 👥 {bill.pax} Pax</>}
              {customerEnabled && customerNama && <> • 👤 {customerNama}</>}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: SPACING.xs,
              background: "transparent",
              border: "none",
              borderRadius: RADIUS.md,
              cursor: "pointer",
              color: MT,
              fontSize: 20,
              lineHeight: 1,
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>

        {/* Items */}
        <div style={{ padding: SPACING.lg }}>
          <div style={{
            fontSize: TYPOGRAPHY.caption.fontSize,
            fontWeight: 600,
            color: MT,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            marginBottom: SPACING.sm
          }}>
            Item Pesanan ({itemCount})
          </div>

          <div style={{ display: "grid", gap: SPACING.sm }}>
            {bill.items?.map((item, idx) => (
              <div
                key={item.id || idx}
                style={{
                  background: LT,
                  borderRadius: RADIUS.md,
                  padding: SPACING.sm,
                  ...row,
                  justifyContent: "space-between",
                  alignItems: "center"
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: TYPOGRAPHY.small.fontSize,
                    fontWeight: 600,
                    color: G,
                    marginBottom: 2
                  }}>
                    {item.nama}
                  </div>
                  {item.catatan && (
                    <div style={{
                      fontSize: TYPOGRAPHY.caption.fontSize,
                      color: MT,
                      fontStyle: "italic"
                    }}>
                      {item.catatan}
                    </div>
                  )}
                </div>
                <div style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  gap: 2,
                  marginLeft: SPACING.md
                }}>
                  <span style={{
                    fontSize: TYPOGRAPHY.small.fontSize,
                    fontWeight: 600,
                    color: G
                  }}>
                    {fmt(item.harga * item.qty)}
                  </span>
                  <span style={{
                    fontSize: TYPOGRAPHY.caption.fontSize,
                    color: MT
                  }}>
                    {item.qty}x @{fmt(item.harga)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Pelanggan / Member */}
          {customerEnabled && (
          <div style={{ marginTop: SPACING.lg, paddingTop: SPACING.lg, borderTop: `1px solid ${BD}` }}>
            <div style={{
              fontSize: TYPOGRAPHY.caption.fontSize,
              fontWeight: 600,
              color: MT,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              marginBottom: SPACING.sm
            }}>
              Pelanggan
            </div>
            {customerNama ? (
              <div style={{
                ...row,
                alignItems: "center",
                gap: SPACING.sm,
                padding: `${SPACING.xs} ${SPACING.sm}`,
                background: "#f0fdf4",
                border: "1px solid #a8d5b8",
                borderRadius: RADIUS.md
              }}>
                <span style={{ fontSize: TYPOGRAPHY.small.fontSize }}>👤</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: TYPOGRAPHY.caption.fontSize, color: MT }}>
                    Nama Pelanggan
                  </div>
                  <div style={{ fontSize: TYPOGRAPHY.small.fontSize, fontWeight: 700, color: G }}>
                    {customerNama}
                    {customerTelepon && <span style={{ fontWeight: 500, color: MT }}> · {customerTelepon}</span>}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{
                padding: `${SPACING.xs} ${SPACING.sm}`,
                background: LT,
                borderRadius: RADIUS.md,
                fontSize: TYPOGRAPHY.caption.fontSize,
                color: MT,
                fontStyle: "italic"
              }}>
                Tanpa pelanggan
              </div>
            )}
          </div>
          )}

          {/* Receipt Additionals */}
          {receiptFields.length > 0 && (
            <div style={{ marginTop: SPACING.lg, paddingTop: SPACING.lg, borderTop: `1px solid ${BD}` }}>
              <div style={{
                fontSize: TYPOGRAPHY.caption.fontSize,
                fontWeight: 600,
                color: MT,
                textTransform: "uppercase",
                letterSpacing: 0.5,
                marginBottom: SPACING.sm
              }}>
                Informasi Tambahan
              </div>
              <div style={{ display: "grid", gap: SPACING.xs }}>
                {receiptFields.map((field, idx) => (
                  <div
                    key={idx}
                    style={{
                      ...row,
                      alignItems: "center",
                      gap: SPACING.sm,
                      padding: `${SPACING.xs} ${SPACING.sm}`,
                      background: LT,
                      borderRadius: RADIUS.md
                    }}
                  >
                    <span style={{ fontSize: TYPOGRAPHY.small.fontSize }}>{field.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: TYPOGRAPHY.caption.fontSize,
                        color: MT
                      }}>
                        {field.label}
                      </div>
                      <div style={{
                        fontSize: TYPOGRAPHY.small.fontSize,
                        fontWeight: 500,
                        color: G
                      }}>
                        {field.value}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Totals */}
          <div style={{
            marginTop: SPACING.lg,
            paddingTop: SPACING.md,
            borderTop: `2px solid ${BD}`
          }}>
            <div style={{ ...row, justifyContent: "space-between", marginBottom: SPACING.xs }}>
              <span style={{ fontSize: TYPOGRAPHY.small.fontSize, color: MT }}>Subtotal</span>
              <span style={{ fontSize: TYPOGRAPHY.small.fontSize, fontWeight: 500, color: G }}>{fmt(sub)}</span>
            </div>
            {disc > 0 && (
              <div style={{ ...row, justifyContent: "space-between", marginBottom: SPACING.xs }}>
                <span style={{ fontSize: TYPOGRAPHY.small.fontSize, color: MT }}>Diskon</span>
                <span style={{ fontSize: TYPOGRAPHY.small.fontSize, fontWeight: 500, color: COLOR_PALETTE.danger }}>-{fmt(disc)}</span>
              </div>
            )}
            {p > 0 && (
              <div style={{ ...row, justifyContent: "space-between", marginBottom: SPACING.xs }}>
                <span style={{ fontSize: TYPOGRAPHY.small.fontSize, color: MT }}>Pajak</span>
                <span style={{ fontSize: TYPOGRAPHY.small.fontSize, fontWeight: 500, color: G }}>{fmt(p)}</span>
              </div>
            )}
            {s > 0 && (
              <div style={{ ...row, justifyContent: "space-between", marginBottom: SPACING.xs }}>
                <span style={{ fontSize: TYPOGRAPHY.small.fontSize, color: MT }}>Service</span>
                <span style={{ fontSize: TYPOGRAPHY.small.fontSize, fontWeight: 500, color: G }}>{fmt(s)}</span>
              </div>
            )}
            <div style={{
              ...row,
              justifyContent: "space-between",
              paddingTop: SPACING.sm,
              borderTop: `1px dashed ${BD}`
            }}>
              <span style={{ fontSize: TYPOGRAPHY.body.fontSize, fontWeight: 700, color: G }}>Total</span>
              <span style={{ fontSize: TYPOGRAPHY.h2.fontSize, fontWeight: 800, color: OR }}>{fmt(tot)}</span>
            </div>
          </div>

          {/* Actions */}
          <div style={{
            marginTop: SPACING.lg,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: SPACING.sm
          }}>
            <button
              onClick={() => { onAddOrder(); onClose(); }}
              style={{
                padding: `${SPACING.xxl} ${SPACING.xxl}`,
                background: COLOR_PALETTE.primaryLight,
                color: G,
                border: `1px solid #a8d5b8`,
                borderRadius: RADIUS.md,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: TYPOGRAPHY.small.fontSize,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: SPACING.xs
              }}
            >
              + Tambah Pesanan
            </button>
            <button
              onClick={() => { onPay(); onClose(); }}
              style={{
                padding: `${SPACING.lg} ${SPACING.lg} ${SPACING.lg} ${SPACING.lg}`,
                background: OR,
                color: W,
                border: "none",
                borderRadius: RADIUS.lg,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: TYPOGRAPHY.small.fontSize,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: SPACING.lg
  
              }}
            >
            Bayar {fmt(tot)}
            </button>
          </div>

          {/* Delete action */}
          <button
            onClick={() => { onDelete(); onClose(); }}
            style={{
              width: "100%",
              marginTop: SPACING.sm,
              padding: `${SPACING.sm} ${SPACING.md}`,
              background: COLOR_PALETTE.dangerLight,
              color: COLOR_PALETTE.danger,
              border: "none",
              borderRadius: RADIUS.md,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: TYPOGRAPHY.small.fontSize,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: SPACING.xs
            }}
          >
          Hapus Tagihan
          </button>
        </div>

        {/* Bottom safe area */}
        <div style={{ height: "env(safe-area-inset-bottom, 20px)" }} />
      </div>
    </div>
  );
}