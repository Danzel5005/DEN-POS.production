import { useState, useEffect } from "react";
import { LT, BD, MT, RADIUS, TYPOGRAPHY } from "../constants/design.js";

const HARI  = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
const BULAN = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

function getNow() {
  const d = new Date();
  return {
    hari:HARI[d.getDay()], tgl:String(d.getDate()).padStart(2,"0"),
    bln:BULAN[d.getMonth()], jam:String(d.getHours()).padStart(2,"0"),
    mnt:String(d.getMinutes()).padStart(2,"0"),
  };
}

// Komponen terpisah dari Kasir() — tick 1 detik di sini TIDAK memicu
// re-render Kasir() induk (yang menyimpan history 300+ item).
function ClockBadge() {
  const [now, setNow] = useState(getNow());
  useEffect(() => {
    const t = setInterval(() => setNow(getNow()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <div className="workspace-date" style={{fontSize:TYPOGRAPHY.label.fontSize,color:MT,padding:"4px 8px",background:LT,borderRadius:RADIUS.sm,border:`1px solid ${BD}`}}>{now.hari}, {now.tgl} {now.bln}</div>
      <div className="workspace-time" style={{fontSize:TYPOGRAPHY.label.fontSize,color:MT,padding:"4px 8px",background:LT,borderRadius:RADIUS.sm,border:`1px solid ${BD}`}}>{now.jam}:{now.mnt} WIB</div>
    </>
  );
}

export { ClockBadge };
