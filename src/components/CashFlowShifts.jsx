import { useEffect, useMemo, useRef, useState } from "react";
import CashFlowChart from "./CashFlowChart.jsx";
import { buildCashFlow } from "../utilities/cashflow.js";
import { fmt } from "../utilities/receipt.js";
import { sortShiftsActiveFirst } from "../utilities/shiftState.js";
import { G, W, BD, TX, MT } from "../constants/design.js";

const card = { background: W, border: `1px solid ${BD}`, borderRadius: 9, padding: "12px 14px" };
const button = { padding: "8px 12px", background: W, color: G, border: `1px solid ${BD}`, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 700 };

export function filterCashFlowShifts(shifts, search) {
  const query = search.trim().toLocaleLowerCase();
  return shifts.filter(s => [s.shiftNum, s.username, s.operator].some(value => String(value ?? "").toLocaleLowerCase().includes(query)));
}

// Each mounted card loads only its own shift; hidden history never loads transactions.
export function CashFlowShift({ shift, loadAllForReport, labelExpense, labelIncome, refreshKey }) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    Promise.resolve().then(() => loadAllForReport(shift.id, { throwOnError: true })).then(
      transactions => { if (!cancelled) setResult({ transactions: transactions || [] }); },
      () => { if (!cancelled) setResult({ error: true }); },
    );
    return () => { cancelled = true; };
  }, [shift.id, loadAllForReport, refreshKey, attempt]);

  const cashFlow = useMemo(() => result && !result.error
    ? buildCashFlow(result.transactions, [shift], labelExpense, labelIncome)
    : null, [result, shift, labelExpense, labelIncome]);
  const hourOf = value => {
    const match = String(value || "").match(/^(\d{1,2}):/);
    return match && Number(match[1]) < 24 ? Number(match[1]) : null;
  };
  const start = hourOf(shift.startJam);
  const end = hourOf(shift.endJam) ?? (shift.status === "open" ? new Date().getHours() : null);
  const hourRange = start != null && end != null && end >= start ? { start, end } : null;
  const multiDay = (cashFlow?.spanDays || 0) > 1;

  return (
    <section aria-label={`Arus kas Shift ${shift.shiftNum}`} style={{ ...card, display: "grid", gap: 10, minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: TX }}>Shift {shift.shiftNum} · {shift.hari} {shift.tgl} {shift.bln} {shift.thn}</div>
      <div style={{ fontSize: 11, color: MT }}>{shift.startJam}{shift.endJam ? `–${shift.endJam}` : ""} · {shift.operator || shift.username || "-"}{shift.username ? ` (@${shift.username})` : ""} · {shift.status === "open" ? "Aktif" : "Ditutup"}</div>
      {!result ? <div role="status">Memuat arus kas…</div> : result.error ? (
        <div role="alert">Gagal memuat arus kas. <button type="button" style={button} onClick={() => setAttempt(n => n + 1)}>Coba lagi</button></div>
      ) : (
        <>
          {multiDay && <div style={{ fontSize: 11, color: "#b87a00" }}>Data shift mencakup lebih dari sehari ({cashFlow.spanDays} hari berisi data). Grafik ditampilkan per hari.</div>}
          {cashFlow.hasData ? <CashFlowChart mode={multiDay ? "day" : "hour"} data={multiDay ? cashFlow.daily : null} hourly={cashFlow.hourly} hourRange={hourRange} /> : <div style={{ color: MT, fontSize: 12 }}>Belum ada data arus kas pada shift ini.</div>}
          {[["Pemasukan per Sumber", cashFlow.incomeBySource], ["Pengeluaran per Kategori", cashFlow.expenseBySource]].map(([title, entries]) => entries.length > 0 && (
            <div key={title} style={card}>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8 }}>{title}</div>
              {entries.map(item => <div key={item.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}><span>{item.label}</span><span style={{ color: MT }}>{fmt(item.total)}</span></div>)}
            </div>
          ))}
          {cashFlow.outstanding > 0 && <div style={card}><div style={{ fontSize: 11, fontWeight: 700 }}>Piutang</div><div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}><span>Total belum dibayar</span><span style={{ color: "#dc2626" }}>{fmt(cashFlow.outstanding)}</span></div></div>}
        </>
      )}
    </section>
  );
}

function AllShiftsModal({ shifts, onClose, ...displayProps }) {
  const dialogRef = useRef(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => {
      dialog.close();
      previousFocus?.focus();
    };
  }, []);
  const matches = useMemo(() => filterCashFlowShifts(shifts, search), [shifts, search]);
  const pages = Math.max(1, Math.ceil(matches.length / 5));
  const currentPage = Math.min(page, pages - 1);
  const displayed = matches.slice(currentPage * 5, currentPage * 5 + 5);
  return (
    <dialog ref={dialogRef} aria-labelledby="cashflow-shifts-title" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ ...card, position: "fixed", inset: 0, margin: "auto", width: "min(850px, 92vw)", maxHeight: "90vh", padding: 0, color: TX }}>
      <style>{`dialog[aria-labelledby="cashflow-shifts-title"]::backdrop { background: rgba(10,20,15,0.68); backdrop-filter: blur(4px); }`}</style>
      <div style={{ padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <h2 id="cashflow-shifts-title" style={{ fontSize: 16 }}>Arus Kas — Semua Shift</h2>
          <button type="button" style={button} onClick={onClose} aria-label="Tutup semua shift">Tutup</button>
        </div>
        <label style={{ display: "grid", gap: 6, fontSize: 12, marginBottom: 12 }}>Cari nomor shift atau username operator
          <input autoFocus type="search" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="Nomor shift / username" style={{ padding: 10, border: `1px solid ${BD}`, borderRadius: 7, font: "inherit" }} />
        </label>
        <nav aria-label="Halaman shift" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
          <button type="button" style={button} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Sebelumnya</button>
          <span role="status" style={{ fontSize: 12 }}>{matches.length} shift · Halaman {currentPage + 1} / {pages}</span>
          <button type="button" style={button} disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Berikutnya</button>
        </nav>
        <div style={{ display: "grid", gap: 12 }}>
          {displayed.length ? displayed.map(shift => <CashFlowShift key={shift.id} shift={shift} {...displayProps} />) : <div role="status">Tidak ada shift yang cocok.</div>}
        </div>
      </div>
    </dialog>
  );
}

export default function CashFlowShifts({ shifts, activeShift, ...displayProps }) {
  const [showAll, setShowAll] = useState(false);
  const allShifts = useMemo(() => {
    const list = [...shifts];
    if (activeShift?.id && !list.some(s => s.id === activeShift.id)) list.push(activeShift);
    return sortShiftsActiveFirst(list);
  }, [shifts, activeShift]);
  const openShifts = allShifts.filter(s => s.status === "open");
  return (
    <section aria-label="Arus Kas" style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <h2 style={{ fontSize: 12, color: G }}>Arus Kas — Shift Aktif</h2>
        <button type="button" style={button} onClick={() => setShowAll(true)}>Tampilkan Semua Shift</button>
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        {openShifts.length ? openShifts.map(shift => <CashFlowShift key={shift.id} shift={shift} {...displayProps} />) : <div style={{ ...card, color: MT }}>Tidak ada shift aktif.</div>}
      </div>
      {showAll && <AllShiftsModal shifts={allShifts} onClose={() => setShowAll(false)} {...displayProps} />}
    </section>
  );
}