import PayModal from "../../components/modals/PayModal.jsx";
import VoidModal from "../../components/modals/VoidModal.jsx";
import ReceiptModal from "../../components/modals/ReceiptModal.jsx";
import ItemModal from "../../components/modals/ItemModal.jsx";
import CatModal from "../../components/modals/CatModal.jsx";
import SettingsModal from "../../components/modals/SettingsModal.jsx";
import PrinterModal from "../../components/modals/PrinterModal.jsx";
import CloseShiftModal from "../../components/modals/CloseShiftModal.jsx";
import ConfirmDelModal from "../../components/modals/ConfirmDelModal.jsx";
import { G, OR, W, LT, TX, BD, MT } from "../../constants/design.js";

export default function ModalStack({
  payModal,
  cartH,
  processPayment,
  setPayModal,
  settingsH,
  voidH,
  authH,
  receipt,
  printReceipt,
  setReceipt,
  menuH,
  confirmCloseShift,
  closeShiftWarning = [],
  openingCashModal,
  openingCashInput,
  setOpeningCashInput,
  handleSkipOpeningCash,
  handleSaveOpeningCash,
  expenseModal,
  setExpenseModal,
  expenseForm,
  setExpenseForm,
  expenseCategories,
  expenseCategoryDraft,
  setExpenseCategoryDraft,
  handleSaveExpense,
  confirmDel,
  setConfirmDel,
  executeConfirmDel,
  toastH,
  updateInfo,
  setUpdateInfo,
}) {
  return (
    <>
      {/* ══ MODAL: PEMBAYARAN ══════════════════════════════════════════════ */}
      {payModal && (
        <PayModal cartH={cartH} processPayment={processPayment} setPayModal={setPayModal} paymentMethods={settingsH.settings.paymentMethods} receiptAdditionals={settingsH.settings.receiptAdditionals} paxEnabled={settingsH.settings.receiptPaxEnabled} tableEnabled={settingsH.settings.receiptTableEnabled} />
        )}

        {/* VOID MODAL */}
        {voidH?.voidModal && voidH.voidTargetId && (
          <VoidModal
            voidTargetId={voidH.voidTargetId}
            voidReason={voidH.voidReason}
            setVoidReason={voidH.setVoidReason}
            voidNote={voidH.voidNote}
            setVoidNote={voidH.setVoidNote}
            isVoiding={voidH.isVoiding}
            onClose={voidH.closeVoidModal}
            onConfirm={() => voidH.voidTrx(voidH.voidTargetId, voidH.voidReason, authH.currentUser?.username)}
          />
        )}

      {/* ══ MODAL: RESI (klik transaksi atau setelah bayar) ════════════════ */}
      {receipt && (
        <ReceiptModal receipt={receipt} logo={settingsH.logo} printReceipt={printReceipt} setReceipt={setReceipt} receiptAdditionals={settingsH.settings.receiptAdditionals} qrisImages={settingsH.settings.qrisImages} paymentMethods={settingsH.settings.paymentMethods} />
      )}

      {/* ══ MODAL: TAMBAH/EDIT MENU ════════════════════════════════════════ */}
      {menuH.itemModal && (
        <ItemModal menuH={menuH} />
      )}

      {/* ══ MODAL: KELOLA KATEGORI ════════════════════════════════════════ */}
      {menuH.catModal && (
        <CatModal menuH={menuH} />
      )}

      {/* ══ MODAL: SETTINGS (PRINTER & PAYMENT) ════════════════════════════ */}
      {settingsH.settingsModal && (
        <SettingsModal settingsH={settingsH} authH={authH} menu={menuH.menu} cats={menuH.cats} />
      )}

      {/* ══ MODAL: PRINTER (Legacy, kept for backward compatibility) ════════ */}
      {settingsH.printerModal && (
        <PrinterModal settingsH={settingsH} />
      )}

      {/* ══ MODAL: KONFIRMASI TUTUP SHIFT ════════════════════════════════ */}
      {authH.closingShift && (
        <CloseShiftModal authH={authH} confirmCloseShift={confirmCloseShift} pendingAttendance={closeShiftWarning} />
      )}

      {/* ══ MODAL: MASUKAN UANG KAS ════════════════════════════════════════ */}
      {openingCashModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,20,15,0.72)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500 }}>
          <div style={{ background: W, width: 420, maxWidth: "92vw", borderRadius: 16, padding: 24, boxShadow: "0 30px 80px rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: G, marginBottom: 6 }}>Masukan Uang Kas</div>
            <div style={{ fontSize: 12, color: MT, marginBottom: 18 }}>Masukkan jumlah uang kas awal saat mulai shift agar laporan bisa menghitung saldo kas.</div>
            <label style={{ display: "block", fontSize: 11, color: MT, fontWeight: 700, marginBottom: 6 }}>Jumlah Kas (Rp)</label>
            <input
              id="opening-cash-amount"
              name="openingCashAmount"
              autoFocus
              type="text"
              value={openingCashInput}
              onChange={(e) => setOpeningCashInput(e.target.value.replace(/\D/g, ""))}
              placeholder="0"
              style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 10, border: `1.5px solid ${BD}`, fontSize: 18, fontWeight: 700, fontFamily: "inherit", marginBottom: 18 }}
            />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" onClick={handleSkipOpeningCash} style={{ background: LT, color: TX, border: `1px solid ${BD}`, borderRadius: 8, padding: "10px 16px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>Lewati</button>
              <button type="button" onClick={handleSaveOpeningCash} style={{ background: G, color: W, border: "none", borderRadius: 8, padding: "10px 18px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>Simpan</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL: MASUKAN PENGELUARAN ══════════════════════════════════════ */}
      {expenseModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,20,15,0.68)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500 }}>
          <div style={{ background: W, width: 500, maxWidth: "92vw", borderRadius: 16, padding: 24, boxShadow: "0 30px 80px rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: G, marginBottom: 6 }}>Masukan Pengeluaran</div>
            <div style={{ fontSize: 12, color: MT, marginBottom: 18 }}>Catat pengeluaran kas agar laporan keuangan menampilkan total pengeluaran dan laba bersih.</div>
            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, color: MT, fontWeight: 700, marginBottom: 6 }}>Deskripsi</label>
                <input id="expense-deskripsi" name="expenseDeskripsi" value={expenseForm.deskripsi} onChange={(e) => setExpenseForm(f => ({ ...f, deskripsi: e.target.value }))} placeholder="Contoh: Beli gula, bayar listrik, dll" style={{ width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 10, border: `1.5px solid ${BD}`, fontSize: 13, fontFamily: "inherit" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, color: MT, fontWeight: 700, marginBottom: 6 }}>Kategori Pengeluaran</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  {(expenseCategories.length ? expenseCategories : [{ key: "operasional", label: "Operasional" }]).map(cat => (
                    <button key={cat.key} type="button" onClick={() => setExpenseForm(f => ({ ...f, kategori: cat.key }))} style={{ padding: "7px 10px", borderRadius: 8, border: expenseForm.kategori === cat.key ? `1.5px solid ${G}` : `1px solid ${BD}`, background: expenseForm.kategori === cat.key ? "#e8f5ee" : W, color: expenseForm.kategori === cat.key ? G : TX, fontFamily: "inherit", fontWeight: 700, cursor: "pointer" }}>{cat.label}</button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input id="expense-category-draft" name="expenseCategoryDraft" value={expenseCategoryDraft} onChange={(e) => setExpenseCategoryDraft(e.target.value)} placeholder="Tambah kategori baru" style={{ flex: 1, boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: `1.5px solid ${BD}`, fontSize: 12, fontFamily: "inherit" }} />
                  <button type="button" onClick={async () => {
                    const draft = expenseCategoryDraft.trim();
                    if (!draft) return;
                    const exists = expenseCategories.some(c => c.label.toLowerCase() === draft.toLowerCase());
                    if (exists) { toastH.toast_("Kategori sudah ada", "err"); return; }
                    settingsH.setNewExpenseCategoryLabel(draft);
                    await settingsH.addExpenseCategory();
                    setExpenseCategoryDraft("");
                  }} style={{ padding: "10px 14px", border: "none", borderRadius: 8, background: G, color: W, fontFamily: "inherit", fontWeight: 700, cursor: "pointer" }}>Tambah</button>
                </div>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, color: MT, fontWeight: 700, marginBottom: 6 }}>Jumlah Pengeluaran (Rp)</label>
                <input id="expense-jumlah" name="expenseJumlah" value={expenseForm.jumlah} onChange={(e) => setExpenseForm(f => ({ ...f, jumlah: e.target.value.replace(/\D/g, "") }))} placeholder="0" style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 10, border: `1.5px solid ${BD}`, fontSize: 18, fontWeight: 700, fontFamily: "inherit" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
              <button onClick={() => setExpenseModal(false)} style={{ background: LT, color: TX, border: `1px solid ${BD}`, borderRadius: 8, padding: "10px 16px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>Batal</button>
              <button onClick={handleSaveExpense} disabled={!expenseForm.deskripsi.trim() || !expenseForm.jumlah} style={{ background: expenseForm.deskripsi.trim() && expenseForm.jumlah ? G : "#a9b7b0", color: W, border: "none", borderRadius: 8, padding: "10px 18px", cursor: expenseForm.deskripsi.trim() && expenseForm.jumlah ? "pointer" : "not-allowed", fontFamily: "inherit", fontWeight: 700 }}>Simpan</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL: KONFIRMASI HAPUS ════════════════════════════════════════ */}
      {confirmDel && (
        <ConfirmDelModal confirmDel={confirmDel} setConfirmDel={setConfirmDel} executeConfirmDel={executeConfirmDel} />
      )}

      {/* ── UNDO BANNER ──────────────────────────────────────────────────── */}
      {toastH.undoBuf&&(
        <div style={{position:"fixed",bottom:50,left:"50%",transform:"translateX(-50%)",background:"#1a1a1a",color:W,padding:"10px 18px",borderRadius:9,fontSize:12,fontWeight:600,zIndex:400,boxShadow:"0 4px 16px rgba(0,0,0,0.3)",display:"flex",gap:14,alignItems:"center",whiteSpace:"nowrap"}}>
          <span>{toastH.undoBuf.label} dihapus</span>
          <button onClick={toastH.doUndo} style={{background:OR,color:W,border:"none",borderRadius:5,padding:"4px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700}}>Undo</button>
        </div>
      )}

      {/* ── TOAST ────────────────────────────────────────────────────────── */}
      {toastH.toast&&(
        <div style={{position:"fixed",bottom:toastH.undoBuf?95:50,left:"50%",transform:"translateX(-50%)",background:toastH.toast.type==="ok"?"#e8f5ee":"#fef0f0",border:`1px solid ${toastH.toast.type==="ok"?"#a8d5b8":"#f5a8a8"}`,color:toastH.toast.type==="ok"?G:"#e84040",padding:"8px 16px",borderRadius:8,fontSize:11,fontWeight:600,zIndex:400,boxShadow:"0 4px 14px rgba(0,0,0,0.1)",maxWidth:"min(90vw, 640px)",whiteSpace:"normal",overflowWrap:"anywhere",textAlign:"center"}}>
          {toastH.toast.msg}
        </div>
      )}

      {/* ── BANNER: VERSI BARU TERSEDIA (info saja, tidak auto-download) ─── */}
      {updateInfo && (
        <div style={{position:"fixed",top:0,left:0,right:0,background:"#eef4ff",borderBottom:"1px solid #b9cdf5",color:"#1b3a6b",padding:"8px 14px",fontSize:11,fontWeight:600,zIndex:600,display:"flex",gap:10,alignItems:"center",justifyContent:"center",flexWrap:"wrap"}}>
          <span>
            Versi baru {updateInfo.latestVersion} tersedia (saat ini {updateInfo.currentVersion}).
            {updateInfo.notes ? ` ${updateInfo.notes}` : ""}
          </span>
          {updateInfo.url && (
            <a href={updateInfo.url} target="_blank" rel="noreferrer" style={{color:"#1b3a6b",fontWeight:700,textDecoration:"underline"}}>Unduh</a>
          )}
          <button onClick={() => setUpdateInfo(null)} style={{background:"transparent",border:"1px solid #b9cdf5",color:"#1b3a6b",borderRadius:5,padding:"2px 9px",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:700}}>Tutup</button>
        </div>
      )}
    </>
  );
}
