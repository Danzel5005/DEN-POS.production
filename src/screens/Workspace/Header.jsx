import { useEffect, useState } from "react";
import { G, OR, W, LT, BD, MT } from "../../constants/design.js";
import { canAccessView, isAdmin } from "../../utilities/permissions.js";
import { api } from "../../utilities/utils.js";
import { ClockBadge } from "../../components/ClockBadge.jsx";

function KdsPendingBadge() {
  const [status, setStatus] = useState({ pendingCount: 0, error: null });
  useEffect(() => {
    let alive = true;
    const refresh = () => api.kdsStatus().then((value) => { if (alive) setStatus(value || { pendingCount: 0 }); }).catch(() => {});
    refresh();
    const timer = setInterval(refresh, 10000);
    const unsubscribe = api.onDeviceSyncEvent((event) => { if (event?.kind === "kds-sync") refresh(); });
    const retryWhenOnline = () => { void api.kdsRetry().then(refresh); };
    window.addEventListener("online", retryWhenOnline);
    return () => { alive = false; clearInterval(timer); unsubscribe?.(); window.removeEventListener("online", retryWhenOnline); };
  }, []);
  if (!status.pendingCount && !status.error) return null;
  return <span role="status" title={status.error || "Tiket menunggu koneksi"} style={{ padding: "4px 8px", background: status.error ? "#fef0f0" : "#fff7ed", color: status.error ? "#b91c1c" : "#92400e", border: `1px solid ${status.error ? "#fecaca" : "#fed7aa"}`, borderRadius: 5, fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>
    {status.pendingCount} tiket KDS menunggu
  </span>;
}

export default function Header({ settingsH, authH, billsH, historyH, view, navigate, logoRef }) {
  // Tombol "Fitur Lanjutan" hanya muncul saat saklar induk dinyalakan, supaya
  // halaman pengelolaan fitur lanjutan ikut hilang/muncul bersama tombolnya.
  const advOn = !!settingsH.settings?.advancedFeatures?.enabled;
  const navItems = [
    { key:"menu", label:"Kasir", hotkey:"K" },
    { key:"bills", label:`Open Bill (${billsH.bills.filter(b=>b.status==="open").length})`, hotkey:"O" },
    { key:"history", label:`Riwayat (${historyH.history.length})`, hotkey:"R" },
    { key:"laporan", label:"Laporan", hotkey:"L" },
    { key:"kelola", label:"Menu", hotkey:"M" },
    ...(advOn ? [{ key:"fitur-lanjutan", label:"Fitur Lanjutan", hotkey:"F" }] : []),
  ];
  return (
    <header style={{background:W,borderBottom:`1px solid ${BD}`,padding:"0 16px",height:56,display:"flex",alignItems:"center",gap:10,flexShrink:0,boxShadow:"0 1px 4px rgba(0,0,0,0.05)"}}>
      {/* Logo */}
      <div style={{position:"relative",flexShrink:0}}>
        <div onClick={()=>logoRef.current.click()} title="Klik untuk upload logo" style={{width:38,height:38,borderRadius:7,overflow:"hidden",border:`2px dashed ${settingsH.logo?G:BD}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",background:settingsH.logo?"transparent":LT}}>
          {settingsH.logo?<img src={settingsH.logo} alt="logo" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span style={{fontSize:9,color:MT}}>Logo</span>}
        </div>
        {settingsH.logo&&<button onClick={(e)=>{e.stopPropagation();settingsH.handleLogoRemove();}} title="Hapus logo" style={{position:"absolute",top:-7,right:-7,width:16,height:16,borderRadius:"50%",border:"none",background:"#e84040",color:"#fff",fontSize:9,lineHeight:"16px",textAlign:"center",cursor:"pointer",padding:0,fontWeight:700}}>✕</button>}
      </div>
      <input id="logo-upload" name="logoUpload" ref={logoRef} type="file" accept=".jpg,.jpeg,.png" style={{display:"none"}} onChange={settingsH.handleLogoUpload}/>
      <div style={{flexShrink:0}}>
        <div style={{fontSize:13,fontWeight:700,color:G}}>Sistem Kasir</div>
        <div style={{fontSize:9,color:OR,fontWeight:600}}>{settingsH.settings.warungName || "Warung"}</div>
      </div>

      {/* Nav */}
      <div style={{display:"flex",gap:2,marginLeft:8}}>
        {navItems.filter(b => canAccessView(authH.currentUser, b.key)).map(b=>(
          <button key={b.key} onClick={()=>navigate(b.key)} title={`Hotkey: ${b.hotkey}`} style={{padding:"4px 11px",borderRadius:5,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:600,background:view===b.key?G:"transparent",color:view===b.key?W:MT,transition:"all 0.15s"}}>
            {b.label}
          </button>
        ))}
      </div>

      <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center"}}>
        {settingsH.settings.kdsSettings?.enabled && <KdsPendingBadge />}
        {isAdmin(authH.currentUser) && <button onClick={() => settingsH.setSettingsModal(true)} title="Pengaturan" style={{padding:"4px 10px",background:LT,color:G,border:`1px solid ${BD}`,borderRadius:6,cursor:"pointer",fontFamily:"inherit",fontSize:10,fontWeight:600}}>
          ⚙️ Pengaturan
        </button>}
        {/* Shift badge */}
        {authH.activeShift&&(
          <div style={{fontSize:10,color:G,padding:"4px 9px",background:"#e8f5ee",borderRadius:5,border:"1px solid #a8d5b8",fontWeight:600}}>
            Shift {authH.activeShift.shiftNum} · {authH.activeShift.startJam} · {authH.activeShift.operator}
          </div>
        )}
        <ClockBadge/>
        {/* Tutup Shift */}
        <button onClick={()=>authH.setClosingShift(true)} style={{padding:"4px 10px",background:"#fef0f0",color:"#e84040",border:"1px solid #f5a8a8",borderRadius:6,cursor:"pointer",fontFamily:"inherit",fontSize:10,fontWeight:700}}>
          Tutup Shift
        </button>
      </div>
    </header>
  );
}
