import { useEffect, useState } from "react";
import { fmt, getCashPaymentNote } from "../../utilities/receipt.js";
import { METODE_LABELS} from "../../constants/payments.js";
import { METODE_COLORS, G, OR, W, BD, MT, TX, row, RADIUS, TYPOGRAPHY, COLOR_PALETTE } from "../../constants/design.js";

export default function ReceiptModal({ receipt, logo, printReceipt, setReceipt, receiptAdditionals, qrisImages, paymentMethods = [], customerEnabled = true, paxEnabled = false, tableEnabled = false }) {
  const [isPrinting, setIsPrinting] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!isPrinting) return undefined;
    const interval = window.setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) return prev;
        return Math.min(90, Math.round(prev + 12 + Math.random() * 10));
      });
    }, 180);
    return () => window.clearInterval(interval);
  }, [isPrinting]);

  if (!receipt) return null;

  const paymentKey = String(receipt.metodeBayar || "");
  const cashPaymentNote = paymentKey === "cash" ? getCashPaymentNote(receipt.bayar, receipt.total) : "";

  const handlePrint = async () => {
    if (isPrinting) return;
    setIsPrinting(true);
    setProgress(10);
    try {
      await printReceipt(receipt);
      setProgress(100);
    } finally {
      window.setTimeout(() => {
        setIsPrinting(false);
        setProgress(0);
      }, 450);
    }
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300 }}>
      <div style={{ background:W, width:295, borderRadius:RADIUS.lg, boxShadow:"0 20px 60px rgba(0,0,0,0.3)", display:"flex", flexDirection:"column", maxHeight:"80vh", padding:0, fontFamily:"'Courier New',monospace", position:"relative" }}>
        {isPrinting && (
          <div style={{ position:"absolute", inset:0, background:"rgba(255,255,255,0.93)", zIndex:5, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
            <div style={{ width:"100%", maxWidth:240 }}>
              <div style={{ fontSize:TYPOGRAPHY.small.fontSize, fontWeight:700, color:G, marginBottom:10, textAlign:"center" }}>
                {progress >= 100 ? "Resi selesai" : "Mencetak resi..."}
              </div>
              <div style={{ height:8, width:"100%", background:"#e9ecef", borderRadius:RADIUS.full, overflow:"hidden", marginBottom:8 }}>
                <div style={{ height:"100%", width:`${progress}%`, background:`linear-gradient(90deg, ${G} 0%, ${OR} 100%)`, transition:"width 0.2s ease" }} />
              </div>
              <div style={{ display:"grid", gap:6 }}>
                {[1,2,3,4].map((s) => (
                  <div key={s} style={{ height:8, borderRadius:RADIUS.full, background:"#f1f3f5", overflow:"hidden" }}>
                    <div style={{ width:`${65 + s * 7}%`, height:"100%", background:"#e5e7eb" }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div style={{ padding:"20px 17px", flex:"0 0 auto", textAlign:"center" }}>
          {logo && <img src={logo} alt="logo" style={{ width:42, height:42, objectFit:"cover", borderRadius:RADIUS.md, marginBottom:5 }}/>}
          <div style={{ fontWeight:700, fontSize:TYPOGRAPHY.body.fontSize, color:G }}>
            {receipt.warungName || "Warung"}
          </div>
          <div style={{ fontSize:TYPOGRAPHY.label.fontSize, color:MT }}>{receipt.hari}, {receipt.tgl} {receipt.bln} {receipt.thn}</div>
          {receiptAdditionals && receiptAdditionals.length > 0 ? (
            <div style={{ fontSize:TYPOGRAPHY.label.fontSize, color:COLOR_PALETTE.info, fontWeight:700, marginTop:2 }}>
              {receiptAdditionals
                .filter(f => f.category === "receipt" && f.visible !== false)
                .map((field, idx) => (
                  <span key={field.key} style={{ marginRight: idx > 0 ? " · " : "" }}>
                    {field.label}: {receipt[field.key] || "-"}
                  </span>
                ))}
              · TRX #{receipt.id}
            </div>
          ) : (
            <div style={{ fontSize:TYPOGRAPHY.label.fontSize, color:COLOR_PALETTE.info, fontWeight:700, marginTop:2 }}>
              TRX #{receipt.id}
            </div>
          )}
          {(() => {
            // Use stored label from transaction (metodeBayarLabel), fallback to lookup, NEVER show raw key
            const metodeLabel = receipt.metodeBayarLabel
              ?? paymentMethods.find(m => m.key === paymentKey)?.label
              ?? METODE_LABELS[paymentKey]
              ?? (paymentKey ? paymentKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : "Metode tidak diketahui");
            const isQris = paymentMethods.find(m => m.key === paymentKey)?.category === "qris"
              || paymentKey.startsWith("qris");
            const qrisImage = isQris && qrisImages && qrisImages[paymentKey];
            return (
              <>
                <div style={{ fontSize:TYPOGRAPHY.label.fontSize, fontWeight:700, color:(METODE_COLORS[paymentKey] || { tc:MT }).tc }}>
                  {metodeLabel}
                </div>
                <div style={{ borderTop:"1px dashed #ccc", margin:"7px 0" }}/>
                {/* QRIS Image for QRIS payments */}
                {qrisImage ? (
                  <div style={{ marginBottom: 10 }}>
                    <img 
                      src={qrisImage} 
                      alt={`QRIS ${metodeLabel}`} 
                      style={{ maxWidth: "100%", maxHeight: "150px", borderRadius: RADIUS.md, border: `1px solid ${BD}` }} 
                    />
                  </div>
                ) : null}
              </>
            );
          })()}
        </div>

        {/* Body (scrollable) */}
        <div style={{ padding:"0 17px 17px", overflowY:"auto", flex:"1 1 auto" }}>
          {(customerEnabled || tableEnabled || paxEnabled) && (
            <div style={{ fontSize:TYPOGRAPHY.label.fontSize, color:TX, marginBottom:8 }}>
              {customerEnabled && <div>Nama Pelanggan: <b>{receipt.customerNama || "-"}</b></div>}
              {tableEnabled && <div>Table: <b>{receipt.tableNumber || "-"}</b></div>}
              {paxEnabled && <div>Pax: <b>{Number(receipt.pax) > 0 ? receipt.pax : "-"}</b></div>}
            </div>
          )}
          {receipt.items.map((item, i) => (
            <div key={i} style={{ ...row, fontSize:TYPOGRAPHY.small.fontSize, marginBottom:2 }}>
              <span>{item.qty}x {item.nama}</span>
              <span>{fmt(item.harga * item.qty)}</span>
            </div>
          ))}
          <div style={{ borderTop:"1px dashed #ccc", margin:"7px 0" }}/>

          {/* Custom receipt additionals fields (if any) */}
          {receiptAdditionals && receiptAdditionals.length > 0 && (
            receiptAdditionals
              .filter(f => f.category === "receipt" && f.visible !== false)
              .map((field, idx) => (
                <div key={field.key} style={{ ...row, fontSize:TYPOGRAPHY.label.fontSize, color:MT, marginBottom:2 }}>
                  <span>{field.label}</span>
                  <span>{receipt[field.key] || "-"}</span>
                </div>
              ))
          )}

          <div style={{ ...row, fontSize:TYPOGRAPHY.label.fontSize, color:MT }}><span>Subtotal</span><span>{fmt(receipt.subtotal)}</span></div>
          {(receipt.discount || 0) > 0 && <div style={{ ...row, fontSize:TYPOGRAPHY.label.fontSize, color:G }}><span>Diskon</span><span>-{fmt(receipt.discount)}</span></div>}
          {(receipt.pajak || 0) > 0 && <div style={{ ...row, fontSize:TYPOGRAPHY.label.fontSize, color:MT }}><span>Pajak</span><span>{fmt(receipt.pajak)}</span></div>}
          {(receipt.service || 0) > 0 && <div style={{ ...row, fontSize:TYPOGRAPHY.label.fontSize, color:MT }}><span>Service</span><span>{fmt(receipt.service)}</span></div>}
          <div style={{ ...row, fontSize:TYPOGRAPHY.body.fontSize, fontWeight:700, marginTop:3 }}>
            <span>TOTAL</span><span style={{ color:OR }}>{fmt(receipt.total)}</span>
          </div>
          {paymentKey === "cash" && <div style={{ ...row, fontSize:TYPOGRAPHY.small.fontSize, color:cashPaymentNote ? OR : G, fontWeight:700, marginTop:4 }}>
            <span>{cashPaymentNote || "LUNAS"}</span>
            {!cashPaymentNote && <span>{fmt(receipt.bayar)}</span>}
          </div>}
          <div style={{ borderTop:"1px dashed #ccc", margin:"7px 0" }}/>

          {/* QRIS Image for QRIS payments (also at bottom) */}
          {(() => {
            // Use stored label from transaction (metodeBayarLabel), fallback to lookup, NEVER show raw key
            const metodeLabel = receipt.metodeBayarLabel
              ?? paymentMethods.find(m => m.key === paymentKey)?.label
              ?? METODE_LABELS[paymentKey]
              ?? (paymentKey ? paymentKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : "Metode tidak diketahui");
            const isQris = paymentMethods.find(m => m.key === paymentKey)?.category === "qris"
              || paymentKey.startsWith("qris");
            const qrisImage = isQris && qrisImages && qrisImages[paymentKey];
            return qrisImage ? (
              <div style={{ textAlign: "center", marginBottom: 10 }}>
                <img 
                  src={qrisImage} 
                  alt={`QRIS ${metodeLabel}`} 
                  style={{ maxWidth: "100%", maxHeight: "150px", borderRadius: RADIUS.md, border: `1px solid ${BD}` }} 
                />
              </div>
            ) : null;
          })()}

          <div style={{ textAlign:"center", fontSize:TYPOGRAPHY.label.fontSize, color:MT }}>Terima kasih atas kunjungan Anda!</div>
        </div>

        {/* Footer */}
        <div style={{ padding:"12px 17px", borderTop:`1px solid ${BD}`, flex:"0 0 auto" }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            <button
              onClick={handlePrint}
              disabled={isPrinting}
              style={{ padding:8, border:`1px solid ${G}`, borderRadius:RADIUS.md, background:isPrinting?"#d7e8dd":COLOR_PALETTE.primaryLight, color:G, cursor:isPrinting?"default":"pointer", fontFamily:"inherit", fontSize:TYPOGRAPHY.small.fontSize, fontWeight:700, opacity:isPrinting?0.8:1 }}
            >{isPrinting ? "Mencetak..." : "Cetak Resi"}</button>
            <button
              onClick={() => setReceipt(null)}
              style={{ padding:8, background:G, color:W, border:"none", borderRadius:RADIUS.md, cursor:"pointer", fontFamily:"inherit", fontSize:TYPOGRAPHY.small.fontSize, fontWeight:700 }}
            >Tutup</button>
          </div>
        </div>
      </div>
    </div>
  );
}