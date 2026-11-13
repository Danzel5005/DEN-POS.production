import { fmt, getCashPaymentNote } from "../../utilities/receipt.js";
import { G, OR, W, LT, BD, TX, MT, row, inp, RADIUS, TYPOGRAPHY, COLOR_PALETTE } from "../../constants/design.js";

export default function PayModal({ cartH, processPayment, setPayModal, paymentMethods = [], receiptAdditionals = [], paxEnabled = false, tableEnabled = false, customer, customerEnabled = true }) {
  // Group payment methods by category
  const groupedMethods = (paymentMethods || []).reduce((acc, method) => {
    const cat = method.category || "custom";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(method);
    return acc;
  }, {});

  // Category labels and colors
  const categoryConfig = {
    cash: { label: "TUNAI", color: COLOR_PALETTE.secondary, colorLight: COLOR_PALETTE.secondaryLight },
    debit: { label: "DEBIT", color: COLOR_PALETTE.info, colorLight: COLOR_PALETTE.infoLight },
    qris: { label: "QRIS", color: G, colorLight: COLOR_PALETTE.primaryLight },
    custom: { label: "LAINNYA", color: COLOR_PALETTE.warning, colorLight: "#fff3e0" },
  };

  const getCategoryColor = (category) => {
    return categoryConfig[category]?.color || TX;
  };

  const getCategoryColorLight = (category) => {
    return categoryConfig[category]?.colorLight || LT;
  };

  const getButtonColor = (isSelected, category) => {
    if (isSelected) return categoryConfig[category]?.color || TX;
    return TX;
  };

  const hasCashPayment = cartH.paid !== "" || cartH.total === 0;
  const cashPaymentNote = hasCashPayment ? getCashPaymentNote(cartH.paidNum, cartH.total) : "";
  const cashPaymentLabel = cashPaymentNote || "Lunas";
  const cashPaymentColor = cashPaymentNote?.startsWith("Kurang") ? COLOR_PALETTE.danger : G;

  return (
    <div
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300 }}
      onClick={e => { if (e.target === e.currentTarget) setPayModal(false); }}
    >
      <div style={{ background:W, borderRadius:RADIUS.lg, width:400, maxWidth:"95vw", boxShadow:"0 20px 60px rgba(0,0,0,0.3)", display:"flex", flexDirection:"column", maxHeight:"80vh", padding:0 }}>

        {/* Header */}
        <div style={{ padding:"20px", flex:"0 0 auto" }}>
          <div style={{ ...row, marginBottom: 0 }}>
            <span style={{ fontSize:TYPOGRAPHY.body.fontSize, fontWeight:700, color:G }}>Pembayaran</span>
            <span style={{ fontSize:TYPOGRAPHY.label.fontSize, color:MT }}>
              {receiptAdditionals && receiptAdditionals.length > 0 ? (
                <>
                  {receiptAdditionals
                    .filter(f => f.category === "receipt" && f.visible !== false)
                    .map((field, idx) => (
                      <span key={field.key} style={{ marginRight: idx > 0 ? " · " : "" }}>
                        {field.label}: {cartH.receiptAdditionalValues?.[field.key] || cartH[field.key] || "-"}
                      </span>
                    ))}
                </>
              ) : (
                <span>—</span>
              )}
              {cartH.activeBill ? ` · Bill #${cartH.activeBill.id}` : ""}
            </span>
          </div>
        </div>

        {/* Body (scrollable) */}
        <div style={{ padding:"0 20px 20px 20px", overflowY:"auto", flex:"1 1 auto" }}>

          {(customerEnabled || tableEnabled || paxEnabled) && (
            <div style={{ background: COLOR_PALETTE.infoLight, borderRadius:RADIUS.md, padding:"8px 11px", marginBottom:11, fontSize:TYPOGRAPHY.label.fontSize, color:TX }}>
              {customerEnabled && <div>Nama Pelanggan: <b>{customer?.name || "-"}</b></div>}
              {tableEnabled && <div>Table: <b>{cartH.tableNumber || "-"}</b></div>}
              {paxEnabled && <div>Pax: <b>{Number(cartH.pax) > 0 ? cartH.pax : "-"}</b></div>}
            </div>
          )}

          {/* Ringkasan order */}
          <div style={{ background:LT, borderRadius:RADIUS.md, padding:"9px 11px", marginBottom:11 }}>
            {cartH.items.map((item, i) => (
              <div key={i} style={{ ...row, fontSize:TYPOGRAPHY.label.fontSize, marginBottom:2 }}>
                <span>{item.qty}x {item.nama}</span>
                <span>{fmt(item.harga * item.qty)}</span>
              </div>
            ))}
            <div style={{ borderTop:`1px solid ${BD}`, marginTop:7, paddingTop:7 }}>
              <div style={{ ...row, fontSize:TYPOGRAPHY.label.fontSize, color:MT }}><span>Subtotal</span><span>{fmt(cartH.subtotal)}</span></div>
              {(cartH.discount || 0) > 0 && <div style={{ ...row, fontSize:TYPOGRAPHY.label.fontSize, color:G }}><span>Diskon</span><span>-{fmt(cartH.discount)}</span></div>}
              {(cartH.pajak || 0) > 0 && <div style={{ ...row, fontSize:TYPOGRAPHY.label.fontSize, color:MT }}><span>Pajak</span><span>{fmt(cartH.pajak)}</span></div>}
              {(cartH.service || 0) > 0 && <div style={{ ...row, fontSize:TYPOGRAPHY.label.fontSize, color:MT }}><span>Service</span><span>{fmt(cartH.service)}</span></div>}
              <div style={{ ...row, fontSize:15, fontWeight:700, marginTop:5 }}>
                <span>Total</span><span style={{ color:OR }}>{fmt(cartH.total)}</span>
              </div>
            </div>
          </div>

          {/* Metode pembayaran — Dynamic dari settings */}
          <div style={{ marginBottom:11 }}>
            <div style={{ fontSize:TYPOGRAPHY.label.fontSize, color:MT, fontWeight:600, marginBottom:6 }}>METODE PEMBAYARAN</div>

            {/* Render grouped payment methods */}
            {Object.entries(groupedMethods).map(([category, methods]) => (
              <div key={category} style={{ marginBottom: 10 }}>
                <div style={{ fontSize:TYPOGRAPHY.label.fontSize - 2, color:getCategoryColor(category), fontWeight:600, marginBottom:4 }}>
                  {categoryConfig[category]?.label || category.toUpperCase()}
                </div>
                <div style={{
                  display:"grid",
                  gridTemplateColumns: category === "cash" ? "1fr" : "1fr 1fr",
                  gap:7,
                  marginBottom:7
                }}>
                  {methods.map(m => (
                    <button
                      key={m.key}
                      onClick={() => cartH.setMetode(m.key)}
                      style={{
                        padding:"8px 5px",
                        border:`2px solid ${cartH.metode===m.key ? getCategoryColor(category) : BD}`,
                        borderRadius:RADIUS.md,
                        background:cartH.metode===m.key ? getCategoryColorLight(category) : W,
                        cursor:"pointer",
                        fontFamily:"inherit",
                        textAlign:"center"
                      }}
                    >
                      <div style={{ fontSize:TYPOGRAPHY.label.fontSize, fontWeight:700, color:getButtonColor(cartH.metode===m.key, category) }}>
                        {m.label}
                      </div>
                      <div style={{ fontSize:TYPOGRAPHY.label.fontSize - 2, color:MT, marginTop:1 }}>
                        {category === "cash" ? "Uang cash" : category === "qris" ? "Scan QR" : category === "debit" ? "Kartu debit" : "Metode lain"}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Input uang (cash) */}
          {cartH.metode === "cash" && (<>
            <div style={{ fontSize:TYPOGRAPHY.label.fontSize, color:MT, fontWeight:600, marginBottom:4 }}>JUMLAH BAYAR (Rp)</div>
            <input
              id="pay-amount"
              name="payAmount"
              type="text"
              value={cartH.paid}
              onChange={e => cartH.setPaid(e.target.value.replace(/\D/g, ""))}
              placeholder="Masukkan jumlah uang..."
              autoFocus
              style={{ ...inp, fontSize:TYPOGRAPHY.body.fontSize, marginBottom:8, border:`2px solid ${cartH.paidNum >= cartH.total ? "#a8d5b8" : BD}` }}
            />
            {hasCashPayment && (
              <div style={{ background:cashPaymentNote?.startsWith("Kurang") ? COLOR_PALETTE.dangerLight : COLOR_PALETTE.primaryLight, border:`1px solid ${cashPaymentNote?.startsWith("Kurang") ? COLOR_PALETTE.danger : "#a8d5b8"}`, borderRadius:RADIUS.md, padding:"7px 10px", marginBottom:8, ...row, fontSize:TYPOGRAPHY.small.fontSize, color:cashPaymentColor }}>
                <span>{cashPaymentLabel}</span>
                {!cashPaymentNote && <span style={{ fontWeight:700 }}>{fmt(cartH.paidNum)}</span>}
              </div>
            )}
          </>)}

          {/* Info non-cash */}
          {cartH.metode !== "cash" && (
            <div style={{
              background: getCategoryColorLight(
                paymentMethods.find(m => m.key === cartH.metode)?.category || "custom"
              ),
              border: `1px solid ${getCategoryColor(paymentMethods.find(m => m.key === cartH.metode)?.category || "custom")}`,
              borderRadius:RADIUS.md, padding:"8px", marginBottom:8, textAlign:"center", fontSize:TYPOGRAPHY.label.fontSize,
              color: getCategoryColor(paymentMethods.find(m => m.key === cartH.metode)?.category || "custom"), fontWeight:600,
            }}>
              {(() => {
                const method = paymentMethods.find(m => m.key === cartH.metode);
                const cat = method?.category;
                const label = method?.label || cartH.metode.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                if (cat === "cash") return `Pembayaran dengan ${label}`;
                if (cat === "debit") return `Pembayaran dengan ${label}`;
                if (cat === "qris") return `Scan ${label} untuk pembayaran`;
                return `Lanjutkan dengan ${label}`;
              })()}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:"14px 20px", borderTop:`1px solid ${BD}`, flex:"0 0 auto" }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            <button
              onClick={() => setPayModal(false)}
              style={{ padding:10, border:`1px solid ${BD}`, borderRadius:RADIUS.md, background:W, cursor:"pointer", fontFamily:"inherit", fontSize:TYPOGRAPHY.small.fontSize, fontWeight:600 }}
            >Batal</button>
            {!processPayment.__isAsync ? (
              <button
                onClick={processPayment}
                disabled={!cartH.canPay}
                style={{ padding:10, border:"none", borderRadius:RADIUS.md, background:cartH.canPay ? OR : "#f0c89a", color:W, cursor:cartH.canPay ? "pointer" : "not-allowed", fontFamily:"inherit", fontSize:TYPOGRAPHY.small.fontSize, fontWeight:700 }}
              >Konfirmasi Bayar</button>
            ) : (
              <button
                onClick={() => processPayment().then(() => setPayModal(false))}
                disabled={!cartH.canPay}
                style={{ padding:10, border:"none", borderRadius:RADIUS.md, background:cartH.canPay ? OR : "#f0c89a", color:W, cursor:cartH.canPay ? "pointer" : "not-allowed", fontFamily:"inherit", fontSize:TYPOGRAPHY.small.fontSize, fontWeight:700 }}
              >Konfirmasi Bayar</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
