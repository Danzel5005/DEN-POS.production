import { W, BD, MT, RADIUS, TYPOGRAPHY, COLOR_PALETTE } from "../../constants/design.js";

export default function CloseShiftModal({ authH, confirmCloseShift, pendingAttendance = [] }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:400 }}>
      <div style={{ background:W, borderRadius:RADIUS.lg, padding:"24px 22px", width:340, textAlign:"center", boxShadow:"0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ fontSize:32, marginBottom:8 }}>🔒</div>
        <div style={{ fontSize:TYPOGRAPHY.body.fontSize, fontWeight:700, marginBottom:6 }}>
          Tutup Shift {authH.activeShift?.shiftNum}?
        </div>
        <div style={{ fontSize:TYPOGRAPHY.label.fontSize, color:MT, marginBottom:6, lineHeight:1.6 }}>
          Shift ini dimulai pukul <b>{authH.activeShift?.startJam}</b> oleh <b>{authH.activeShift?.operator}</b>.
        </div>
        <div style={{ background:COLOR_PALETTE.secondaryLight, border:`1px solid ${COLOR_PALETTE.border}`, borderRadius:RADIUS.md, padding:"9px 12px", marginBottom:16, fontSize:TYPOGRAPHY.label.fontSize, color:COLOR_PALETTE.warning, textAlign:"left" }}>
          ⚠️ Open bill TIDAK akan dihapus otomatis. Pastikan transaksi yang sudah dibayar sudah diproses (bayar) sebelum menutup shift. Open bill yang belum dibayar tetap tersedia di shift berikutnya.
        </div>
        {pendingAttendance.length > 0 && <div role="alert" style={{ background:"#fff0e8", border:"1px solid #e87c2a", borderRadius:RADIUS.md, padding:"9px 12px", marginBottom:12, fontSize:TYPOGRAPHY.label.fontSize, color:"#8a3b00", textAlign:"left" }}>
          <b>{pendingAttendance.length} user web-app belum presensi keluar:</b> {pendingAttendance.map((item) => item.name).join(", ")}. Anda dapat menunggu atau menutup shift dengan menandai mereka keluar.
        </div>}
        <div style={{ display:"flex", gap:8 }}>
          <button
            onClick={() => authH.setClosingShift(false)}
            style={{ flex:1, padding:10, border:`1px solid ${BD}`, borderRadius:RADIUS.md, background:W, cursor:"pointer", fontFamily:"inherit", fontSize:TYPOGRAPHY.small.fontSize, fontWeight:600 }}
          >Batal</button>
          <button
            onClick={() => confirmCloseShift(pendingAttendance.length > 0)}
            style={{ flex:1, padding:10, background:COLOR_PALETTE.danger, color:W, border:"none", borderRadius:RADIUS.md, cursor:"pointer", fontFamily:"inherit", fontSize:TYPOGRAPHY.small.fontSize, fontWeight:700 }}
          >{pendingAttendance.length ? "Overwrite & Tutup" : "Tutup Shift"}</button>
        </div>
      </div>
    </div>
  );
}
