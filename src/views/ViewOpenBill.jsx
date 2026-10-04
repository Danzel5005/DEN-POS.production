import { useState, memo } from "react";
import { calcPrice } from "../utilities/calculations.js";
import { fmt } from "../utilities/receipt.js";
import { G, OR, W, BD, MT, BG, row, RADIUS, TYPOGRAPHY, COLOR_PALETTE, SPACING } from "../constants/design.js";
import { Tag } from "../components/Tag.jsx";
import BillDetailModal from "../components/BillDetailModal.jsx";

// ViewOpenBill — daftar tagihan terbuka dengan UX modern
function ViewOpenBill({
  bills,
  loadBillToCart,
  setView,
  loadBillAndPay,
  setConfirmDel,
  settingsH,
  pricingConfig,
  customerEnabled = true,
}) {
  const openBills = bills.filter(b => b.status === "open");
  const [selectedBill, setSelectedBill] = useState(null);
  const [showDetail, setShowDetail] = useState(false);

  const formatDuration = (createdAt) => {
    const dur = Math.round((Date.now() - new Date(createdAt)) / 60000);
    return dur < 60 ? `${dur} mnt lalu` : `${Math.floor(dur / 60)} jam lalu`;
  };

  const formatItems = (items) => {
    if (!items?.length) return "—";
    return items.slice(0, 3).map(i => `${i.qty}x ${i.nama}`).join(", ") + (items.length > 3 ? ` +${items.length - 3} lagi` : "");
  };

  const handleOpenDetail = (bill) => {
    setSelectedBill(bill);
    setShowDetail(true);
  };

  const handleCloseDetail = () => {
    setShowDetail(false);
    setSelectedBill(null);
  };

  const handleAddOrder = (bill) => {
    loadBillToCart(bill);
    setView("menu");
  };

  const handlePay = (bill) => {
    loadBillAndPay(bill);
  };

  const handleDelete = (bill) => {
    setConfirmDel({ type: "bill", id: bill.id });
  };

  const handleDeleteAll = () => {
    setConfirmDel({ type: "allBills" });
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: W }}>
      {/* Header */}
      <div style={{
        padding: `${SPACING.md} ${SPACING.lg}`,
        background: W,
        borderBottom: `1px solid ${BD}`,
        flexShrink: 0,
        ...row,
        justifyContent: "space-between"
      }}>
        <div>
          <div style={{ fontSize: TYPOGRAPHY.h3.fontSize, fontWeight: 700, color: G }}>
            Tagihan Berjalan
          </div>
          <div style={{ fontSize: TYPOGRAPHY.caption.fontSize, color: MT, marginTop: 2 }}>
            {openBills.length} tagihan {openBills.length === 1 ? "belum dibayar" : "belum dibayar"}
          </div>
        </div>
        {openBills.length > 0 && (
          <button
            onClick={handleDeleteAll}
            style={{
              padding: `${SPACING.xs} ${SPACING.md}`,
              background: COLOR_PALETTE.dangerLight,
              color: COLOR_PALETTE.danger,
              border: "none",
              borderRadius: RADIUS.sm,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: TYPOGRAPHY.caption.fontSize,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 14
            }}
          >
            Hapus Semua
          </button>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: SPACING.lg }}>
        {openBills.length === 0 ? (
          <div style={{
            textAlign: "center",
            color: MT,
            marginTop: "60px",
            padding: SPACING.xl
          }}>
            <div style={{ fontSize: 48, marginBottom: SPACING.md }}>�</div>
            <div style={{ fontSize: TYPOGRAPHY.body.fontSize, fontWeight: 500, marginBottom: SPACING.xs }}>
              Tidak ada tagihan terbuka
            </div>
            <div style={{ fontSize: TYPOGRAPHY.caption.fontSize, color: MT }}>
              Tagihan baru akan muncul di sini saat pelanggan membuat pesanan
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: SPACING.md }}>
            {openBills.map((bill, index) => {
              const sub = bill.items?.reduce((s, i) => s + (i.harga || 0) * (i.qty || 0), 0) || 0;
              const { pajak: p, service: s, total: tot } = calcPrice(sub, { ...pricingConfig, items: bill.items || [], manualDiscount: { type: bill.manualDiscountType || pricingConfig.manualCartDiscount?.type, value: bill.manualDiscountValue } });
              const itemCount = bill.items?.reduce((sum, i) => sum + (i.qty || 0), 0) || 0;

              return (
                <div
                  key={bill.id}
                  style={{
                    background: W,
                    border: "1px solid",
                    borderColor: bill.tableNum ? "#f0a040" : BD,
                    borderRadius: RADIUS.lg,
                    padding: SPACING.md,
                    boxShadow: "0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)",
                    transition: "all 0.15s ease",
                    cursor: "pointer",
                    position: "relative",
                    overflow: "hidden"
                  }}
                  onClick={() => handleOpenDetail(bill)}
                  onDoubleClick={() => handlePay(bill)}
                >
                  {/* Status indicator */}
                  <div style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: 4,
                    height: "100%",
                    background: bill.tableNum ? OR : G
                  }} />

                  {/* Main content */}
                  <div style={{ ...row, justifyContent: "space-between", alignItems: "flex-start", marginBottom: SPACING.sm }}>
                    <div style={{ display: "flex", alignItems: "center", gap: SPACING.sm, flex: 1, minWidth: 0 }}>
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
                          Meja {(bill.tableNumber || bill.tableNum).toString().trim()}
                        </span>
                      )}
                      {customerEnabled && bill.customerNama && (
                        <span style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: G,
                          background: "#f0fdf4",
                          padding: `${SPACING.xs} ${SPACING.sm}`,
                          borderRadius: RADIUS.md,
                          border: "1px solid #a8d5b8"
                        }}>
                         {String(bill.customerNama).trim()}
                        </span>
                      )}
                    </div>
                    <span style={{
                      fontSize: TYPOGRAPHY.caption.fontSize,
                      color: MT,
                      whiteSpace: "nowrap",
                      marginLeft: SPACING.sm
                    }}>
                      {formatDuration(bill.createdAt)}
                    </span>
                  </div>

                  {/* Items preview */}
                  <div style={{
                    fontSize: TYPOGRAPHY.small.fontSize,
                    color: MT,
                    marginBottom: SPACING.sm,
                    lineHeight: 1.5,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden"
                  }}>
                    {formatItems(bill.items)} {itemCount > 0 && <span style={{ color: MT }}> ({itemCount} item)</span>}
                  </div>

                  {/* Totals & Actions */}
                  <div style={{ ...row, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: SPACING.sm }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 120 }}>
                      <span style={{ fontSize: TYPOGRAPHY.caption.fontSize, color: MT }}>Subtotal</span>
                      <span style={{ fontSize: 16, fontWeight: 700, color: G }}>
                        {fmt(sub)}
                      </span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 120, textAlign: "right" }}>
                      <span style={{ fontSize: TYPOGRAPHY.caption.fontSize, color: MT }}>Total</span>
                      <span style={{ fontSize: 20, fontWeight: 800, color: OR }}>
                        {fmt(tot)}
                      </span>
                    </div>

                    {/* Quick actions on hover/focus */}
                    <div style={{
                      display: "flex",
                      gap: SPACING.xs,
                      opacity: 0,
                      transition: "opacity 0.15s ease",
                      flexShrink: 0
                    }}
                    // Note: We'll use CSS :hover on parent to show actions
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); handleAddOrder(bill); }}
                        style={{
                          padding: `${SPACING.xs} ${SPACING.sm}`,
                          background: COLOR_PALETTE.primaryLight,
                          color: G,
                          border: `1px solid #a8d5b8`,
                          borderRadius: RADIUS.md,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          fontSize: TYPOGRAPHY.caption.fontSize,
                          fontWeight: 600,
                          whiteSpace: "nowrap"
                        }}
                        title="Tambah Pesanan"
                      >
                        + Pesanan
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handlePay(bill); }}
                        style={{
                          padding: `${SPACING.xs} ${SPACING.sm}`,
                          background: OR,
                          color: W,
                          border: "none",
                          borderRadius: RADIUS.md,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          fontSize: TYPOGRAPHY.caption.fontSize,
                          fontWeight: 700,
                          whiteSpace: "nowrap"
                        }}
                        title="Bayar"
                      >
                        Bayar
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(bill); }}
                        style={{
                          padding: `${SPACING.xs} ${SPACING.sm}`,
                          background: COLOR_PALETTE.dangerLight,
                          color: COLOR_PALETTE.danger,
                          border: "none",
                          borderRadius: RADIUS.md,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          fontSize: TYPOGRAPHY.caption.fontSize,
                          fontWeight: 600,
                          whiteSpace: "nowrap"
                        }}
                        title="Hapus"
                      >
                        Hapus
                      </button>
                    </div>
                  </div>

                  {/* Hidden actions - shown on hover via CSS-in-JS workaround */}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bill Detail Modal */}
      {showDetail && selectedBill && (
        <BillDetailModal
          bill={selectedBill}
          receiptAdditionals={settingsH.settings.receiptAdditionals || []}
          pricingConfig={pricingConfig}
          customerEnabled={customerEnabled}
          onClose={handleCloseDetail}
          onAddOrder={() => handleAddOrder(selectedBill)}
          onPay={() => handlePay(selectedBill)}
          onDelete={() => handleDelete(selectedBill)}
        />
      )}
    </div>
  );
}

export default memo(ViewOpenBill);


