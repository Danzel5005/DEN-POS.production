import { memo, useEffect, useState } from "react";
import { csvByDay, TRX_HEADER, trxRow, csvLaporan, csvSalesRate, csvPerMenu, csvMetodeBayar, csvStok } from "../utilities/csvbuild.js";
import { fmt, fmtNum } from "../utilities/receipt.js";
import { METODE_LABELS } from "../constants/payments.js";
import { G, OR, W, LT, BD, TX, MT, METODE_COLORS } from "../constants/design.js";
import { isVoided, api } from "../utilities/utils.js";
import { buildInsights } from "../utilities/insights.js";
import { buildCashFlow } from "../utilities/cashflow.js";
import { buildReportHTML } from "../utilities/reportHtml.js";
import CashFlowShifts from "../components/CashFlowShifts.jsx";

function AttendanceReportSection({ toast_ }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    let alive = true;
    api.deviceAttendanceExchange({ action: "attendance-log" }).then((result) => {
      if (alive && result?.ok) setRows(result.data?.rows || []);
      if (alive) setLoading(false);
    }).catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  const exportPdf = async () => {
    setExporting(true);
    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
    const body = rows.map((row) => `<tr><td>${escapeHtml(row.attendance_shifts?.shift_num || "-")}</td><td>${escapeHtml(row.user_label)}</td><td>${escapeHtml(new Date(row.checked_in_at).toLocaleString("id-ID"))}</td><td>${escapeHtml(row.checked_out_at ? new Date(row.checked_out_at).toLocaleString("id-ID") : "Belum presensi keluar")}</td><td>${escapeHtml(row.checkout_overwritten ? "Ditutup admin DEN POS" : row.status)}</td></tr>`).join("");
    const html = `<!doctype html><meta charset="utf-8"><h1>Log Presensi</h1><p>Dicetak ${escapeHtml(new Date().toLocaleString("id-ID"))}</p><table border="1" cellspacing="0" cellpadding="6"><thead><tr><th>Shift</th><th>Pengguna</th><th>Masuk</th><th>Keluar</th><th>Status</th></tr></thead><tbody>${body}</tbody></table>`;
    try {
      const result = await api.exportReportPdf({ html, defaultName: "Log-Presensi.pdf" });
      if (result?.ok) toast_?.("Log presensi PDF disimpan", "ok");
      else if (result?.error && result.error !== "Dibatalkan") toast_?.(result.error, "err");
    } catch (error) { toast_?.(error.message || "Gagal mengekspor log presensi", "err"); }
    finally { setExporting(false); }
  };
  return <section style={{ borderTop: `1px solid ${BD}`, paddingTop: 14, marginTop: 18 }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}><div><b style={{ color: G, fontSize: 12 }}>Log Presensi</b><div style={{ color: MT, fontSize: 10 }}>{loading ? "Memuat…" : `${rows.length} catatan terbaru`}</div></div><button type="button" disabled={!rows.length || exporting} onClick={exportPdf} style={{ background: G, color: W, border: 0, borderRadius: 6, padding: "8px 12px", fontWeight: 700, cursor: rows.length ? "pointer" : "not-allowed" }}>{exporting ? "Menyiapkan…" : "Ekspor PDF"}</button></div>
    <div style={{ overflowX: "auto", background: W, border: `1px solid ${BD}` }}><table style={{ width: "100%", minWidth: 640, borderCollapse: "collapse", fontSize: 10 }}><thead><tr>{["Shift", "Pengguna", "Masuk", "Keluar", "Status"].map((label) => <th key={label} style={{ padding: 8, textAlign: "left", borderBottom: `1px solid ${BD}` }}>{label}</th>)}</tr></thead><tbody>{rows.slice(0, 100).map((item) => <tr key={item.id}><td style={{ padding: 8 }}>Shift {item.attendance_shifts?.shift_num || "-"}</td><td style={{ padding: 8 }}>{item.user_label}</td><td style={{ padding: 8 }}>{new Date(item.checked_in_at).toLocaleString("id-ID")}</td><td style={{ padding: 8 }}>{item.checked_out_at ? new Date(item.checked_out_at).toLocaleString("id-ID") : "Belum keluar"}</td><td style={{ padding: 8 }}>{item.checkout_overwritten ? "Ditutup admin" : item.status}</td></tr>)}</tbody></table>{!loading && !rows.length && <p style={{ padding: 10, color: MT, fontSize: 11 }}>Belum ada log presensi.</p>}</div>
  </section>;
}

// ViewLaporan — laporan keuangan & penjualan per shift, dengan CSV export.
function ViewLaporan({
  selectedShiftId, setSelectedShiftId,   // authH
  shifts, activeShift,                   // authH
  history,                                // historyH
  menu,                                   // menuH.menu (array)
  menuH,                                  // menuH (hook object with cats)
  doCSV, at, loadAllForReport,            // historyH
  paymentMethods,                         // settingsH
  expenseCategories = [],
  openingCash = 0,
  totalExpenses = 0,
  onOpenExpenseModal,
  onOpenCashModal, advancedFeatures, isAdvancedActive, warungName, warungAddress, warungPhone, currentUser, toast_, advancedData, }) {
  const selShift = shifts.find(s=>s.id===selectedShiftId) || activeShift;
  const reportShiftId = selectedShiftId === "all" ? undefined : selectedShiftId || activeShift?.id;
  const [shiftTrx, setShiftTrx] = useState([]);
  const [isReportLoading, setIsReportLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsReportLoading(true);
    loadAllForReport(reportShiftId).then((transactions) => {
      if (cancelled) return;
      // Voids are excluded from every financial total below, but counted so the
      // report can disclose how many sales were cancelled in the period.
      setShiftTrx((transactions || []).filter((t) => !isVoided(t)));
      setIsReportLoading(false);
    });
    return () => { cancelled = true; };
  }, [loadAllForReport, reportShiftId]);

  const shiftLabel = selectedShiftId==="all"
    ? "Semua Shift"
    : selShift
      ? `Shift ${selShift.shiftNum} — ${selShift.hari} ${selShift.tgl} ${selShift.bln} ${selShift.thn} · ${selShift.operator}`
      : "Pilih shift di atas";

  const paidOf=(t)=>{const total=Number(t?.total||0);const bayar=t?.bayar??t?.paid;const paid=bayar==null?total:Number(bayar);return Math.max(0,Math.min(paid,total));};
const revList=shiftTrx.reduce((s,t)=>s+Number(t?.total||0),0);
const rev=shiftTrx.reduce((s,t)=>s+paidOf(t),0);
  const totalPax = shiftTrx.reduce((sum, trx) => sum + Math.max(0, Math.floor(Number(trx?.pax) || 0)), 0);
  const spendPerPax = totalPax ? rev / totalPax : 0;
  const mod=shiftTrx.reduce((s,t)=>{t.items.forEach(i=>{s+=(i.modal||0)*i.qty;});return s;},0);
  const sub=shiftTrx.reduce((s,t)=>s+t.subtotal,0);
  const laba=revList-mod;
  const hasModal=shiftTrx.some(t=>t.items.some(i=>i.modal>0));
  const selectedShiftList = selectedShiftId === "all"
    ? shifts
    : selShift
      ? [selShift]
      : activeShift
        ? [activeShift]
        : [];
  const reportOpeningCash = selectedShiftList.reduce((sum, shift) => sum + Number(shift?.openingCash || 0), 0) || Number(openingCash || 0);
  const reportTotalExpenses = selectedShiftList.reduce((sum, shift) => sum + Number((shift?.expenses || []).reduce((inner, item) => inner + Number(item.jumlah || 0), 0)), 0) || Number(totalExpenses || 0);
  const netProfit = laba - reportTotalExpenses;
  // Saldo kas shift mencakup kas awal, pendapatan, dan pengeluaran shift.
  const cashBalance = reportOpeningCash + rev - reportTotalExpenses;
  const advFeatures = advancedFeatures || {};
  const advOn = (key) => (advFeatures.enabled === true) && (advFeatures[key] === true);
  const showPdfReport = advOn("pdfReport");
  const showInsights = advOn("insights");
  const canViewCost=!advOn("canViewCost")||(currentUser&&currentUser.role==="admin");
  const showResepHpp=advOn("resepHpp");
  // Estimasi HPP dari resep (untuk item yang belum punya modal manual).
  const resepMissingCount={n:0};
  const hppResep=showResepHpp&&advancedData&&advancedData.hppFor
    ? shiftTrx.reduce((s,t)=>{
        (t.items||[]).forEach(it=>{
          const manual=Number(it.modal||0);
          if(manual>0)return;
          const h=advancedData.hppFor(it.id);
          if(h==null){resepMissingCount.n++;return;}
          s+=Number(h||0)*Number(it.qty||0);
        });
        return s;
      },0)
    : 0;
  const hasHppResep=showResepHpp&&hppResep>0;
 const showCashFlow = advOn("cashFlow");
  const labelOf = (key) => {
    const k = String(key || "cash").trim();
    const m = (paymentMethods || []).find((x) => String(x.key || "").trim() === k);
    if (m && m.label) return m.label;
    return METODE_LABELS[k] || k;
  };
  const insights = showInsights ? buildInsights(shiftTrx, { labelOf }) : null;
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const handleExportPdf = async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      const html = buildReportHTML({
        warungName,
        warungAddress,
        warungPhone,
        shiftLabel,
        generatedAt: new Date().toLocaleString("id-ID"),
        rev, mod, sub, netProfit, totalExpenses: reportTotalExpenses,
                hasModal,
        showCost: canViewCost,
        hppResep: showResepHpp && hasHppResep ? { total: hppResep, missing: resepMissingCount.n } : null,
        insights, transactions: shiftTrx,
      });
      const safeShift = String(shiftLabel || "laporan").replace(/[^a-zA-Z0-9]+/g, "-");
      const res = await api.exportReportPdf({ html, defaultName: `Laporan-${safeShift}.pdf` });
      if (res && res.ok) {
        (toast_ || (() => {}))("Laporan PDF disimpan", "ok");
      } else if (res && res.error && res.error !== "Dibatalkan") {
        (toast_ || (() => {}))(res.error || "Gagal menyimpan PDF", "err");
      }
    } catch (err) {
      (toast_ || (() => {}))(err.message || "Gagal menyimpan PDF", "err");
    } finally {
      setIsExportingPdf(false);
    }
  };
  const [detailType, setDetailType] = useState(null);
  const [selectedExpenseCategory, setSelectedExpenseCategory] = useState(null);
  const [selectedIncomeMethod, setSelectedIncomeMethod] = useState(null);

  const getExpenseCategoryLabel = (key) => {
    const normalizedKey = String(key || "lainnya").trim();
    const found = expenseCategories.find((cat) => String(cat.key || "").trim() === normalizedKey);
    return found?.label || normalizedKey;
  };
  const cashFlow = showCashFlow ? buildCashFlow(shiftTrx, selectedShiftList, getExpenseCategoryLabel, labelOf) : null;
//Pelunasan manual (buku hutang): tandai piutang pelanggan jadi lunas.
  const handleSettleDebt = async (debt) => {
    const name = String(debt?.name || "").trim();
    if (!name) return;
    const targets = (shiftTrx || []).filter((t) => {
      if (!t || isVoided(t)) return false;
      const tName = String(t.customerNama || t.customer || "Pelanggan Umum").trim() || "Pelanggan Umum";
      if (tName !== name) return false;
      const total = Number(t.total || 0);
      const bayar = Number(t.bayar ?? t.paid ?? total);
      return total - bayar > 0;
    });
    if (!targets.length) { if (toast_) toast_("Tidak ada piutang untuk ditandai lunas.", "info"); return; }
    if (typeof window !== "undefined" && window.confirm && !window.confirm(`Tandai lunas piutang "${name}" sebesar ${fmt(debt.total)}`)) return;
    try {
      for (const t of targets) {
        await api.settleTrx(t.id, currentUser?.username || null);
      }
      const reloaded = await loadAllForReport(reportShiftId);
      setShiftTrx((reloaded || []).filter((t) => !isVoided(t)));
      if (toast_) toast_(`Piutang "${name}" ditandai lunas.`, "success");
    } catch (e) {
      if (toast_) toast_(`Gagal melunasi: ${e?.message || e}`, "error");
    }
  };


  const resolvePaymentMethodLabel = (trx) => {
    const key = String(trx?.metodeBayar || "cash").trim();
    const transactionLabel = String(trx?.metodeBayarLabel || "").trim();
    if (transactionLabel) return transactionLabel;

    const methodFromSettings = paymentMethods.find((m) => String(m.key || "").trim() === key);
    if (methodFromSettings?.label) return methodFromSettings.label;

    try {
      const savedSettings = JSON.parse(localStorage.getItem("ykk_settings") || "{}");
      const savedMethod = (savedSettings?.paymentMethods || []).find((m) => String(m.key || "").trim() === key);
      if (savedMethod?.label) return savedMethod.label;
    } catch (_) {
      // ignore missing localStorage in non-browser/test contexts
    }

    const defaults = {
      cash: "Tunai",
      "debit-bca": "Debit BCA",
      "debit-bni": "Debit BNI",
      "qris-bca": "QRIS BCA",
      "qris-bni": "QRIS BNI",
      "transfer-bca": "Debit BCA",
      qris: "QRIS BCA",
    };

    return defaults[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const incomeBreakdown = shiftTrx.length
    ? shiftTrx.reduce((acc, trx) => {
        const key = String(trx?.metodeBayar || "cash").trim();
        const label = resolvePaymentMethodLabel(trx);
        const existing = acc.find((entry) => entry.key === key || entry.label === label);
        const total = paidOf(trx);

        if (existing) {
          existing.total += total;
          existing.count += 1;
          existing.items.push(trx);
          return acc;
        }

        acc.push({ key, label, total, count: 1, items: [trx] });
        return acc;
      }, []).filter((item) => item.total > 0)
    : [{ key: "none", label: "Tidak ada metode bayar", total: rev, count: shiftTrx.length, items: shiftTrx }];

  const expenseEntries = selectedShiftList.flatMap((shift) => (shift?.expenses || []).map((item) => {
    const categoryKey = String(item?.kategori || item?.category || "lainnya");
    return {
      ...item,
      categoryKey,
      categoryLabel: getExpenseCategoryLabel(categoryKey),
      shiftLabel: shift?.shiftNum ? `Shift ${shift.shiftNum}` : "Shift aktif",
      operator: shift?.operator || "-",
    };
  }));

  const expenseBreakdown = expenseEntries.reduce((acc, item) => {
    const key = item?.categoryKey || "lainnya";
    const label = item?.categoryLabel || getExpenseCategoryLabel(key);
    const jumlah = Number(item?.jumlah || 0);
    const existing = acc.find((entry) => entry.key === key);
    if (existing) {
      existing.total += jumlah;
      existing.items.push(item);
    } else {
      acc.push({ key, label, total: jumlah, count: 1, items: [item] });
    }
    return acc;
  }, []).filter((item) => item.total > 0);

  return (
    <div style={{flex:1,overflowY:"auto",padding:"16px 20px"}}>
      <div className="page-toolbar" style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,marginBottom:12}}>
        <div>
          <div style={{fontSize:14,fontWeight:700,color:G,marginBottom:3}}>Laporan Keuangan & Penjualan</div>
          <div style={{fontSize:11,color:MT}}>CSV diunduh terpisah per hari. Isi harga modal di Kelola Menu untuk laporan laba/rugi.</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
          <button onClick={onOpenCashModal} style={{padding:"8px 12px",background:"#e8f5ee",color:G,border:`1px solid #a8d5b8`,borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700}}>
            Total Kas Shift ini: {fmt(cashBalance)}
          </button>
          <button onClick={onOpenExpenseModal} style={{padding:"8px 12px",background:W,color:G,border:`1px solid ${BD}`,borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700}}>
            Masukan Pengeluaran
          </button>        
        {showPdfReport && (
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={isExportingPdf}
            style={{padding:"8px 12px",background:G,color:"#fff",border:`1px solid ${G}`,borderRadius:8,cursor:isExportingPdf?"wait":"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,opacity:isExportingPdf?0.7:1}}
          >
            {isExportingPdf ? "Menyiapkan..." : "Ekspor PDF"}
          </button>
        )}
        </div>
      </div>

      {/* ── Selector Shift ── */}
      <div style={{background:W,border:`1px solid ${BD}`,borderRadius:10,padding:"12px 14px",marginBottom:18}}>
        <div style={{fontSize:11,fontWeight:700,color:TX,marginBottom:8}}>Pilih Shift</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
          <button onClick={()=>setSelectedShiftId("all")} style={{padding:"6px 12px",border:`2px solid ${selectedShiftId==="all"?G:BD}`,borderRadius:7,background:selectedShiftId==="all"?"#e8f5ee":W,color:selectedShiftId==="all"?G:TX,cursor:"pointer",fontFamily:"inherit",fontSize:10,fontWeight:700}}>
            Semua Shift
          </button>
          {[...shifts].reverse().map(s=>(
            <button key={s.id} onClick={()=>setSelectedShiftId(s.id)}
              style={{padding:"6px 12px",border:`2px solid ${selectedShiftId===s.id?G:BD}`,borderRadius:7,background:selectedShiftId===s.id?"#e8f5ee":W,color:selectedShiftId===s.id?G:TX,cursor:"pointer",fontFamily:"inherit",fontSize:10,fontWeight:700,textAlign:"left"}}>
              <span style={{display:"block"}}>Shift {s.shiftNum} · {s.tgl} {s.bln} {s.thn}</span>
              <span style={{fontSize:9,color:MT,fontWeight:400}}>{s.startJam}{s.endJam?`–${s.endJam}`:""} · {s.operator} {s.status==="open"?"🟢 Aktif":""}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{fontSize:11,fontWeight:700,color:G,marginBottom:10}}>{shiftLabel} — {isReportLoading ? "memuat..." : `${shiftTrx.length} transaksi`}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(170px,1fr))",gap:10,marginBottom:12}}>
        {[{l:"Total Pax",v:isReportLoading?"Memuat...":fmtNum(totalPax),s:"jumlah pengunjung dari transaksi ber-Pax"},{l:"Rata-rata Belanja / Pax",v:totalPax?fmt(spendPerPax):"—",s:"pendapatan dibagi jumlah Pax"}].map(card=><div key={card.l} style={{background:W,border:`1px solid ${BD}`,borderRadius:9,padding:"12px 14px"}}><div style={{fontSize:10,color:MT,marginBottom:4}}>{card.l}</div><div style={{fontSize:15,fontWeight:700,color:G}}>{card.v}</div><div style={{fontSize:9,color:MT,marginTop:2}}>{card.s}</div></div>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(170px,1fr))",gap:10,marginBottom:20}}>
        {[
          {l:"Total Pendapatan",v:fmt(rev),c:G,s:`dari ${shiftTrx.length} trx`,key:"income"},
          {l:"Total Pengeluaran",v:fmt(reportTotalExpenses),c:"#e84040",s:`${(selShift?.expenses || []).length || 0} catatan`,key:"expense"},
          {l:"Total Modal",v:hasModal?fmt(mod):"Belum diinput",c:"#b87a00",s:hasModal?`dari sub ${fmt(sub)}`:"-",key:"modal"},
          {l:"Laba Bersih",v:fmt(netProfit),c:netProfit>=0?G:"#e84040",s:hasModal?`margin ${sub>0?((netProfit/(sub||1))*100).toFixed(1):0}%`:"-",key:"profit"},
          {l:"Margin",v:sub>0?`${((netProfit/(sub||1))*100).toFixed(1)}%`:"-",c:"#1a5fb4",s:hasModal?"laba bersih / sub total":"belum ada modal",key:"margin"},
            ...(showResepHpp?[{l:"HPP dari Resep",v:hasHppResep?fmt(hppResep):"Belum ada resep",c:"#1a5fb4",s:hasHppResep?`${resepMissingCount.n>0?`${resepMissingCount.n} item tanpa resep`:"estimasi otomatis"}`:"-",key:"hppresep"}]:[]),
        ].map((s,i)=>{
          const cardStyle = {background:W,border:`1px solid ${BD}`,borderRadius:9,padding:"12px 14px",boxShadow:"0 1px 4px rgba(0,0,0,0.04)",textAlign:"left",fontFamily:"inherit",cursor:"default",width:"100%",height:"100%"};
          const content = (
            <>
              <div style={{fontSize:10,color:MT,marginBottom:4}}>{s.l}</div>
              <div style={{fontSize:15,fontWeight:700,color:s.c}}>{s.v}</div>
              <div style={{fontSize:9,color:MT,marginTop:2}}>{s.s}</div>
            </>
          );

          if (s.key === "income" || s.key === "expense") {
            return (
              <button
                key={i}
                type="button"
                onClick={() => setDetailType(detailType === s.key ? null : s.key)}
                style={{...cardStyle, cursor:"pointer"}}
              >
                {content}
              </button>
            );
          }

          return (
            <div key={i} style={cardStyle}>
              {content}
            </div>
          );
        })}
      </div>

      {detailType && (
        <div style={{background:W,border:`1px solid ${BD}`,borderRadius:10,padding:"12px 14px",marginBottom:20}}>
          <div style={{fontSize:11,fontWeight:700,color:TX,marginBottom:8}}>
            {detailType === "income" ? "Rincian Total Pendapatan" : "Rincian Total Pengeluaran"}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:8}}>
            {(detailType === "income" ? incomeBreakdown : expenseBreakdown).length ? (
              (detailType === "income" ? incomeBreakdown : expenseBreakdown).map((item, index) => {
                const card = (
                  <div style={{background:detailType === "income" ? "#eef8f0" : "#fff1f1", border:`1px solid ${detailType === "income" ? "#cfead6" : "#f5c5c5"}`, borderRadius:8, padding:"10px 12px"}}>
                    <div style={{fontSize:10,color:MT,marginBottom:4}}>{item.label}</div>
                    <div style={{fontSize:13,fontWeight:700,color:detailType === "income" ? G : "#e84040"}}>{fmt(item.total)}</div>
                    <div style={{fontSize:9,color:MT,marginTop:2}}>{item.count || 0} {detailType === "income" ? "transaksi" : "catatan"}</div>
                  </div>
                );

                if (detailType === "expense") {
                  return (
                    <button key={index} type="button" onClick={() => setSelectedExpenseCategory({ key: item.key, label: item.label })} style={{background:"transparent", border:"none", padding:0, textAlign:"left", cursor:"pointer", fontFamily:"inherit"}}>
                      {card}
                    </button>
                  );
                }

                return (
                  <button key={index} type="button" onClick={() => setSelectedIncomeMethod(item.label)} style={{background:"transparent", border:"none", padding:0, textAlign:"left", cursor:"pointer", fontFamily:"inherit"}}>
                    {card}
                  </button>
                );
              })
            ) : (
              <div style={{fontSize:10,color:MT,gridColumn:"1/-1"}}>
                {detailType === "income" ? "Belum ada pendapatan untuk shift ini." : "Belum ada pengeluaran untuk shift ini."}
              </div>
            )}
          </div>
        </div>
      )}

      {showInsights && insights && (
        <div style={{marginBottom:20}}>
          <div style={{fontSize:11,fontWeight:700,color:G,marginBottom:10}}>Analitik Penjualan</div>
          {!insights.hasData ? (
            <div style={{fontSize:11,color:MT}}>Belum ada transaksi untuk dianalisis pada periode ini.</div>
          ) : (
            <div style={{display:"grid",gap:12}}>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:8}}>
                <div style={{background:W,border:`1px solid ${BD}`,borderRadius:9,padding:"12px 14px"}}>
                  <div style={{fontSize:10,color:MT,marginBottom:4}}>Jam Ramai</div>
                  <div style={{fontSize:15,fontWeight:700,color:G}}>{insights.busiest ? `${insights.busiest.label}` : "-"}</div>
                  <div style={{fontSize:9,color:MT,marginTop:2}}>{insights.busiest ? `${insights.busiest.count} transaksi` : ""}</div>
                </div>
                <div style={{background:W,border:`1px solid ${BD}`,borderRadius:9,padding:"12px 14px"}}>
                  <div style={{fontSize:10,color:MT,marginBottom:4}}>Rata-rata / Order</div>
                  <div style={{fontSize:15,fontWeight:700,color:G}}>{fmt(insights.average.average)}</div>
                  <div style={{fontSize:9,color:MT,marginTop:2}}>{insights.average.count} transaksi</div>
                </div>
              </div>
              {insights.mix && insights.mix.length > 0 && (
                <div style={{background:W,border:`1px solid ${BD}`,borderRadius:9,padding:"12px 14px"}}>
                  <div style={{fontSize:11,fontWeight:700,color:TX,marginBottom:8}}>Metode Pembayaran</div>
                  <div style={{display:"grid",gap:6}}>
                    {insights.mix.map((m) => (
                      <div key={m.key} style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:11,color:TX}}>
                        <span>{m.label}</span>
                        <span style={{color:MT}}>{m.count}x · {fmt(m.revenue)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {insights.top && insights.top.length > 0 && (
                <div style={{background:W,border:`1px solid ${BD}`,borderRadius:9,padding:"12px 14px"}}>
                  <div style={{fontSize:11,fontWeight:700,color:TX,marginBottom:8}}>Menu Terlaris</div>
                  <div style={{display:"grid",gap:6}}>
                    {insights.top.map((item, idx) => (
                      <div key={idx} style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:11,color:TX}}>
                        <span>{idx + 1}. {item.nama}</span>
                        <span style={{color:MT}}>{item.qty}x · {fmt(item.revenue)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showCashFlow && <CashFlowShifts shifts={shifts} activeShift={activeShift} loadAllForReport={loadAllForReport} labelExpense={getExpenseCategoryLabel} labelIncome={labelOf} refreshKey={shiftTrx} />}
      {showCashFlow && (
        <div style={{marginBottom:20}}>
          <div style={{fontSize:11,fontWeight:700,color:G,marginBottom:10}}>Buku Hutang</div>
          {!cashFlow || cashFlow.debts.length === 0 ? (
            <div style={{background:W,border:`1px solid ${BD}`,borderRadius:9,padding:"12px 14px",color:MT,fontSize:12}}>Tidak ada piutang pada periode ini. Semua transaksi tunai sudah lunas.</div>
          ) : (
            <div style={{background:W,border:`1px solid ${BD}`,borderRadius:9,padding:"12px 14px"}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,fontWeight:700,color:TX,marginBottom:8}}>
                <span>Piutang per Pelanggan</span>
                <span style={{color:"#dc2626"}}>{fmt(cashFlow.outstanding)}</span>
              </div>
              <div style={{display:"grid",gap:6}}>
                {cashFlow.debts.map((d, idx) => (
                  <div key={idx} style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,color:TX,gap:8}}>
                    <span>
                      {d.name}
                      <span style={{color:MT}}> ({d.count} transaksi)</span>
                    </span>
                    <span style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{color:"#dc2626"}}>{fmt(d.total)}</span>
                      <button
                        type="button"
                        onClick={() => handleSettleDebt(d)}
                        style={{background:G,color:"#fff",border:"none",borderRadius:6,padding:"4px 10px",fontSize:11,fontWeight:600,cursor:"pointer"}}
                      >Tandai Lunas</button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <AttendanceReportSection toast_={toast_} />


      {selectedExpenseCategory && (
        <div onClick={() => setSelectedExpenseCategory(null)} style={{position:"fixed", inset:0, background:"rgba(17,24,39,0.28)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:50, padding:16}}>
          <div onClick={(e) => e.stopPropagation()} style={{width:"min(420px, 92vw)", background:W, border:`1px solid ${BD}`, borderRadius:12, boxShadow:"0 18px 50px rgba(0,0,0,0.18)", padding:"14px 16px"}}>
            <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10}}>
              <div style={{fontSize:12,fontWeight:700,color:TX}}>{selectedExpenseCategory.label}</div>
              <button type="button" onClick={() => setSelectedExpenseCategory(null)} style={{background:"transparent", border:"none", color:MT, cursor:"pointer", fontSize:16, fontWeight:700, fontFamily:"inherit"}}>×</button>
            </div>
            <div style={{display:"grid", gap:8, maxHeight:260, overflowY:"auto"}}>
              {(expenseEntries.filter((item) => (item.categoryKey || "lainnya") === selectedExpenseCategory.key) || []).map((entry, idx) => (
                <div key={`${entry.id || idx}-${entry.createdAt || idx}`} style={{background:"#fff7f7", border:`1px solid #f3d0d0`, borderRadius:8, padding:"10px 12px"}}>
                  <div style={{fontSize:9,color:MT,marginBottom:4}}>{entry.shiftLabel} · {entry.operator}</div>
                  <div style={{fontSize:12,fontWeight:700,color:TX}}>{entry.deskripsi || "Catatan pengeluaran"}</div>
                  <div style={{fontSize:11,color:"#e84040", fontWeight:700, marginTop:4}}>{fmt(Number(entry.jumlah || 0))}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedIncomeMethod && (
        <div onClick={() => setSelectedIncomeMethod(null)} style={{position:"fixed", inset:0, background:"rgba(17,24,39,0.28)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:50, padding:16}}>
          <div onClick={(e) => e.stopPropagation()} style={{width:"min(420px, 92vw)", background:W, border:`1px solid ${BD}`, borderRadius:12, boxShadow:"0 18px 50px rgba(0,0,0,0.18)", padding:"14px 16px"}}>
            <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10}}>
              <div style={{fontSize:12,fontWeight:700,color:TX}}>{selectedIncomeMethod}</div>
              <button type="button" onClick={() => setSelectedIncomeMethod(null)} style={{background:"transparent", border:"none", color:MT, cursor:"pointer", fontSize:16, fontWeight:700, fontFamily:"inherit"}}>×</button>
            </div>
            <div style={{display:"grid", gap:8, maxHeight:260, overflowY:"auto"}}>
              {(incomeBreakdown.find((item) => item.label === selectedIncomeMethod)?.items || []).map((trx, idx) => (
                <div key={`${trx.id || idx}-${trx.createdAt || idx}`} style={{background:"#eef8f0", border:`1px solid #cfead6`, borderRadius:8, padding:"10px 12px"}}>
                  <div style={{fontSize:9,color:MT,marginBottom:4}}>{trx.hari || "-"} · {trx.tgl || "-"} {trx.bln || "-"} {trx.thn || ""}</div>
                  <div style={{fontSize:12,fontWeight:700,color:TX}}>{resolvePaymentMethodLabel(trx)}</div>
                  <div style={{fontSize:11,color:G, fontWeight:700, marginTop:4}}>{fmt(paidOf(trx))}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Breakdown per metode - dynamic from settings */}
      <div style={{marginBottom:20}}>
        <div style={{fontSize:11,fontWeight:700,color:TX,marginBottom:8}}>Pendapatan per Metode Bayar</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(145px,1fr))",gap:8}}>
          {paymentMethods && paymentMethods.length > 0 ? paymentMethods.map((m) => {
            const mTrxs = shiftTrx.filter(t=>t.metodeBayar===m.key);
            const mTotal = mTrxs.reduce((s,t)=>s+t.total,0);
            const mc = METODE_COLORS[m.key]||{bg:LT,tc:MT};
            return(
              <div key={m.key} style={{background:mc.bg,border:`1px solid ${BD}`,borderRadius:9,padding:"11px 13px",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
                <div style={{fontSize:10,fontWeight:700,color:mc.tc,marginBottom:4}}>{m.label}</div>
                <div style={{fontSize:14,fontWeight:700,color:TX}}>{fmt(mTotal)}</div>
                <div style={{fontSize:9,color:MT,marginTop:2}}>{mTrxs.length} transaksi</div>
              </div>
            );
          }) : (
            <div style={{fontSize:10,color:MT,gridColumn:"1/-1",textAlign:"center"}}>Tidak ada metode bayar di setting</div>
          )}
        </div>
      </div>

      {/* CSV cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12}}>
        {[
          {title:"Sales Rate",
            desc:"Top 10 terlaku, top 10 paling sedikit, dan semua menu yang belum terjual sama sekali.",
            btn:"Unduh CSV Sales Rate",
              fn:()=>doCSV(`Sales_Rate_${selectedShiftId==="all"?"Semua":`Shift${selShift?.shiftNum||""}`}`,
                csvSalesRate(shiftTrx,menu,at()))},
          {title:"Sales Report",
            desc:"Total qty, pendapatan, modal, laba, dan margin % untuk setiap item.",
            btn:"Unduh CSV Per Item",
            fn:()=>doCSV(`Rangkuman_Per_Menu_${selectedShiftId==="all"?"Semua":`Shift${selShift?.shiftNum||""}`}`,
              csvPerMenu(shiftTrx,menu,at(), menuH?.cats || []))},
          {title:"Laporan Stok",
            desc:"Daftar stok semua menu dengan kategori, harga, dan status ketersediaan.",
            btn:"Unduh CSV Stok",
            fn:()=>doCSV(`Laporan_Stok_${selectedShiftId==="all"?"Semua":`Shift${selShift?.shiftNum||""}`}`,
              csvStok(menu, menuH?.cats || [], at()))},
          {title:"Semua Transaksi Detail",
            desc:"Detail setiap transaksi, terpisah per hari dalam file CSV. Termasuk metode bayar.",
            btn:"Unduh CSV Transaksi",
              fn:()=>doCSV(`Transaksi_${selectedShiftId==="all"?"Semua":`Shift${selShift?.shiftNum||""}`}`,
              csvByDay(shiftTrx,TRX_HEADER,(t, at) => trxRow(t, at, menuH?.cats || [], paymentMethods), at()))},
          {title:"Laporan Per Metode Bayar",
            desc:"Rincian jumlah transaksi dan total pendapatan per metode pembayaran",
            btn:"Unduh CSV Metode Bayar",
              fn:()=>doCSV(`Metode_Bayar_${selectedShiftId==="all"?"Semua":`Shift${selShift?.shiftNum||""}`}`,
              csvMetodeBayar(shiftTrx,at()))},
        ].map((c,i)=>(
          <div key={i} style={{background:W,border:`1px solid ${BD}`,borderRadius:10,padding:"14px 16px",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:5}}>{c.title}</div>
            <div style={{fontSize:11,color:MT,marginBottom:12,lineHeight:1.6}}>{c.desc}</div>
            <button onClick={c.fn} disabled={!shiftTrx.length} style={{width:"100%",padding:"9px 0",background:shiftTrx.length?G:LT,color:shiftTrx.length?W:MT,border:"none",borderRadius:7,cursor:shiftTrx.length?"pointer":"not-allowed",fontFamily:"inherit",fontSize:11,fontWeight:700}}>
              {c.btn}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(ViewLaporan);
