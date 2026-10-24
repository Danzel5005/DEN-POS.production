import { memo, useState, useCallback } from "react";
import { csvByDay, TRX_HEADER, trxRow } from "../utilities/csvbuild.js";
import { fmt } from "../utilities/receipt.js";
import { METODE_LABELS } from "../constants/payments.js";
import { G, OR, W, LT, BD, TX, MT, METODE_COLORS, inp, row } from "../constants/design.js";
import { Tag } from "../components/Tag.jsx";

// Human-readable labels for void reasons (kept in sync with useHistoryVoid.js).
const VOID_REASON_LABELS = {
  cancel: "Pembatalan pelanggan",
  refund: "Pengembalian",
  error: "Kesalahan input",
  promotion: "Promo gratis",
  other: "Lainnya",
};
const voidReasonLabel = (key) => (key ? VOID_REASON_LABELS[key] || key : "");

// ViewRiwayat — riwayat transaksi dengan filter tanggal, collapse-by-day,
// view per shift, pagination, dan CSV download.
function ViewRiwayat({
  fFrom, setFFrom, fTo, setFTo,           // historyH
  history, histByDay,                     // historyH (current page data)
  expandedDays, setExpandedDays,           // historyH
  doCSV, at,                               // historyH
  setConfirmDel,                           // App.jsx local
  canDelete = false,
  canVoid = false,                         // App.jsx - admin-only void permission
  setReceipt,                              // App.jsx local
  // New: shift-based view
  viewMode, setViewMode,                   // historyH
  shiftIdFilter, setShiftIdFilter,         // historyH
  histByShift,                             // historyH
  shifts,                                  // authH
  paymentMethods = [],                     // settingsH - for custom payment method labels
  menuH = null,                            // menuH - for category labels
  // Pagination
  totalCount, currentPage, pageSize, isLoading, hasMore, loadMore, refresh, loadAllForExport, sortOrder, toggleSort,
  voidProps = {},                          // App.jsx - void transaction controls
}) {
  const { isVoiding = false, voidTrx = null, openVoidModal = null } = voidProps;
  const [showAllShifts, setShowAllShifts] = useState(false);
  const [expandedShifts, setExpandedShifts] = useState(null);
  const SHIFT_COLLAPSE_LIMIT = 5;

  // ── Build shift labels lookup from shifts array
  const shiftLabels = {};
  shifts.forEach(s => {
    shiftLabels[s.id] = `Shift ${s.shiftNum} — ${s.hari} ${s.tgl} ${s.bln} ${s.thn} · ${s.operator}`;
  });

  // ── Get sorted shift keys, with collapse for > 5
  const shiftKeys = Object.keys(histByShift).sort((a, b) => {
    // "Tanpa Shift" always last
    if (a === "Tanpa Shift") return 1;
    if (b === "Tanpa Shift") return -1;
    // sort by shiftNum descending (newest first)
    const sa = histByShift[a].shift;
    const sb = histByShift[b].shift;
    return (sb?.shiftNum || 0) - (sa?.shiftNum || 0);
  });

  const displayedShiftKeys = showAllShifts
    ? shiftKeys
    : shiftKeys.slice(0, SHIFT_COLLAPSE_LIMIT);
  const hiddenCount = shiftKeys.length - SHIFT_COLLAPSE_LIMIT;

  // ── Check if a shift group is expanded
  const isShiftExpanded = (shiftKey, idx) => {
    if (expandedShifts && Object.prototype.hasOwnProperty.call(expandedShifts, shiftKey)) {
      return expandedShifts[shiftKey];
    }
    return idx === 0; // default: first one expanded
  };

  const toggleShift = (shiftKey) => {
    setExpandedShifts(prev => {
      const current = prev && Object.prototype.hasOwnProperty.call(prev, shiftKey)
        ? prev[shiftKey]
        : false; // default collapsed when user clicks first time
      return { ...(prev||{}), [shiftKey]: !current };
    });
  };

  // ── Helper to render a transaction row
  const renderTrx = (t) => {
    const isVoid = t.status === "voided" || t.voided === true;
    const reasonLabel = voidReasonLabel(t.voidReason);
    const metodeLabel = t.metodeBayarLabel ?? paymentMethods.find(m => m.key === t.metodeBayar)?.label ?? METODE_LABELS[t.metodeBayar] ?? String(t.metodeBayar || "-").replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return (
      <div key={t.id} onClick={() => setReceipt(t)}
        className="history-transaction"
        style={{ background:isVoid ? "#fafafa" : W, border:`1px solid ${isVoid ? "#e0d0d0" : BD}`, borderRadius:8, padding:"9px 12px", marginBottom:5, cursor:"pointer", transition:"border 0.15s", opacity:isVoid ? 0.75 : 1 }}
        onMouseEnter={e => e.currentTarget.style.borderColor=isVoid ? "#d8b8b8" : "#a8d5b8"}
        onMouseLeave={e => e.currentTarget.style.borderColor=isVoid ? "#e0d0d0" : BD}
      >
        <div style={{ ...row, marginBottom:5 }}>
          <div style={{ display:"flex", gap:5, flexWrap:"wrap", alignItems:"center" }}>
            <Tag label={`TRX #${t.id}`} bg={isVoid ? "#f0e8e8" : "#e8f5ee"} tc={isVoid ? "#b03030" : G}/>
            <Tag label={metodeLabel}
              bg={(METODE_COLORS[t.metodeBayar] || {bg:"#f0f0f0"}).bg}
              tc={(METODE_COLORS[t.metodeBayar] || {tc:MT}).tc}/>
            {isVoid && <Tag label={`VOID${reasonLabel ? ` · ${reasonLabel}` : ""}`} bg="#fdecec" tc="#c02020"/>}
          </div>
          <div style={{ display:"flex", gap:7, alignItems:"center" }}>
            <span style={{ fontSize:9, color:MT }}>{t.jam}:{t.mnt}:{t.dtk}</span>
            {!isVoid && <span style={{ fontSize:9, color:MT, fontStyle:"italic" }}>klik untuk lihat resi</span>}
            {!isVoid && canVoid && voidTrx && (
              <button title="Void transaksi ini"
                onClick={e => { e.stopPropagation(); openVoidModal?.(t.id); }}
                style={{ background:"none", border:"none", cursor:"pointer", color:"#c02020", fontSize:10, fontWeight:700, padding:"0 2px" }}>
                Void
              </button>
            )}
            {canDelete && <button onClick={e => { e.stopPropagation(); setConfirmDel({type:"trx", id:t.id}); }}
              style={{ background:"none", border:"none", cursor:"pointer", color:"#4b4b4b", fontSize:24, padding:0 }}>
              &times;
            </button>}
          </div>
        </div>
        <div style={{ fontSize:10, color:MT, marginBottom:4 }}>
          {t.items.length ? t.items.map(i => `${i.qty}x ${i.nama}`).join(" · ") : <span style={{ fontStyle:"italic" }}>Rincian item tidak tersedia</span>}
        </div>
        <div style={{ display:"flex", gap:10, fontSize:10, flexWrap:"wrap" }}>
          <span>Sub: <b>{fmt(t.subtotal)}</b></span>
          <span style={{ color:isVoid ? MT : G, fontWeight:700, textDecoration:isVoid ? "line-through" : "none" }}>Total: {fmt(t.total)}</span>
          {t.metodeBayar === "cash" && !isVoid && <span style={{ color:"#2a8a2a" }}>Kembalian: {fmt(t.kembalian)}</span>}
        </div>
        {isVoid && (
          <div style={{ fontSize:9, color:"#b03030", marginTop:4, fontStyle:"italic" }}>
            Dibatalkan{t.voidedAt ? ` · ${new Date(t.voidedAt).toLocaleString("id-ID")}` : ""}{t.voidedBy ? ` oleh ${t.voidedBy}` : ""}{t.voidNote ? ` · "${t.voidNote}"` : ""}
          </div>
        )}
        {/* Show shift info if in day mode but trx has shift data */}
        {viewMode === "day" && t.shiftNum && (
          <div style={{ fontSize:8, color:MT, marginTop:4, fontStyle:"italic" }}>
            Shift {t.shiftNum}
          </div>
        )}
      </div>
    );
  };

  // ── Handle CSV export with all data (not just current page)
  const handleCSVExport = useCallback(async () => {
    const allTrx = await loadAllForExport();
    if (!allTrx.length) return;
    doCSV("Transaksi", csvByDay(allTrx, TRX_HEADER, (t, at) => trxRow(t, at, menuH?.cats || [], paymentMethods), at()));
  }, [loadAllForExport, doCSV, menuH, paymentMethods]);

  // ── Infinite scroll handler
  const handleScroll = useCallback((e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 200 && hasMore && !isLoading) {
      loadMore();
    }
  }, [hasMore, isLoading, loadMore]);

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      {/* ── Filter bar ── */}
      <div className="page-toolbar history-toolbar" style={{ padding:"8px 16px", background:W, borderBottom:`1px solid ${BD}`, display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", flexShrink:0 }}>
        <div style={{ fontWeight:700, fontSize:12, color:G }}>Riwayat Transaksi</div>

        {/* Toggle view mode */}
        <div style={{ display:"flex", gap:4, marginLeft:8 }}>
          <button onClick={() => { setViewMode("day"); setShiftIdFilter(null); }}
            style={{ padding:"4px 9px", border:`1px solid ${viewMode === "day" ? G : BD}`, borderRadius:5,
              background:viewMode === "day" ? "#e8f5ee" : W, color:viewMode === "day" ? G : TX,
              cursor:"pointer", fontFamily:"inherit", fontSize:10, fontWeight:600 }}>
            &#128197; Hari
          </button>
          <button onClick={() => { setViewMode("shift"); setShiftIdFilter(null); }}
            style={{ padding:"4px 9px", border:`1px solid ${viewMode === "shift" ? G : BD}`, borderRadius:5,
              background:viewMode === "shift" ? "#e8f5ee" : W, color:viewMode === "shift" ? G : TX,
              cursor:"pointer", fontFamily:"inherit", fontSize:10, fontWeight:600 }}>
            &#128196; Shift
          </button>
        </div>

        <div style={{ display:"flex", gap:6, alignItems:"center", marginLeft:"auto", flexWrap:"wrap" }}>
          <input type="date" id="history-from" name="historyFrom" value={fFrom} onChange={e => setFFrom(e.target.value)}
            style={{ ...inp, width:"auto", padding:"4px 7px", fontSize:11 }}/>
          <span style={{ fontSize:11, color:MT }}>s/d</span>
          <input type="date" id="history-to" name="historyTo" value={fTo} onChange={e => setFTo(e.target.value)}
            style={{ ...inp, width:"auto", padding:"4px 7px", fontSize:11 }}/>
          {(fFrom || fTo) &&
            <button onClick={() => { setFFrom(""); setFTo(""); }}
              style={{ fontSize:10, color:"#e84040", background:"none", border:"none", cursor:"pointer" }}>Reset</button>}
          
          {/* Sort toggle */}
          <button onClick={toggleSort}
            style={{ padding:"4px 9px", background:W, border:`1px solid ${BD}`, borderRadius:5,
              color:TX, cursor:"pointer", fontFamily:"inherit", fontSize:10, fontWeight:600 }}>
            {sortOrder === "desc" ? "⬇ Terbaru" : "⬆ Terlama"}
          </button>
          
          <button onClick={handleCSVExport}
            disabled={!totalCount}
            style={{ padding:"4px 9px", background:totalCount ? "#e8f5ee" : LT,
              color:totalCount ? G : MT, border:`1px solid ${totalCount ? "#b8ddc8" : BD}`,
              borderRadius:5, cursor:totalCount ? "pointer" : "not-allowed",
              fontFamily:"inherit", fontSize:10, fontWeight:600 }}>Unduh CSV</button>
          {canDelete && <button onClick={() => totalCount && setConfirmDel({type:"all"})}
            disabled={!totalCount}
            style={{ padding:"4px 9px", background:totalCount ? "#fef0f0" : LT,
              color:totalCount ? "#e84040" : MT, border:`1px solid ${totalCount ? "#f5a8a8" : BD}`,
              borderRadius:5, cursor:totalCount ? "pointer" : "not-allowed",
              fontFamily:"inherit", fontSize:10, fontWeight:600 }}>Hapus Semua</button>}
        </div>
        <div className="history-summary" style={{ width:"100%", fontSize:10, color:MT }}>
          {totalCount} transaksi total · Menampilkan halaman {currentPage + 1} ({history.length} item) · Total: <b style={{ color:G }}>{fmt(history.reduce((s,t) => s + t.total, 0))}</b>
          {' · '}{history.reduce((s,t) => s + (t.pax||0), 0)} pax halaman ini
        </div>
      </div>

      {/* ── Shift selector (when viewMode === "shift") ── */}
      {viewMode === "shift" && (
        <div style={{ padding:"7px 16px", background:LT, borderBottom:`1px solid ${BD}`, display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
          <span style={{ fontSize:10, color:MT, fontWeight:600 }}>Filter Shift:</span>
          <button onClick={() => setShiftIdFilter(null)}
            style={{ padding:"3px 8px", border:`1px solid ${!shiftIdFilter ? G : BD}`, borderRadius:5,
              background:!shiftIdFilter ? "#e8f5ee" : W, color:!shiftIdFilter ? G : TX,
              cursor:"pointer", fontFamily:"inherit", fontSize:10, fontWeight:600 }}>
            Semua
          </button>
          {[...shifts].reverse().slice(0, 20).map(s => (
            <button key={s.id} onClick={() => setShiftIdFilter(s.id)}
              style={{ padding:"3px 8px", border:`1px solid ${shiftIdFilter === s.id ? G : BD}`, borderRadius:5,
                background:shiftIdFilter === s.id ? "#e8f5ee" : W, color:shiftIdFilter === s.id ? G : TX,
                cursor:"pointer", fontFamily:"inherit", fontSize:10, fontWeight:600 }}>
              Shift {s.shiftNum} {s.startJam}
            </button>
          ))}
        </div>
      )}

      {/* ── Transaction list ── */}
      <div style={{ flex:1, overflowY:"auto", padding:"10px 16px" }} onScroll={handleScroll}>
        {viewMode === "day" && (
          // ── VIEW BY DAY ──
          !Object.keys(histByDay).length && !isLoading
            ? <div style={{ textAlign:"center", color:MT, marginTop:70, fontSize:13 }}>Tidak ada transaksi</div>
            : Object.entries(histByDay).map(([dayLabel, dayTrx], dayIdx) => {
                const dayTotal = dayTrx.reduce((s,t) => s + t.total, 0);
                const dayPax = dayTrx.reduce((s,t) => s + (t.pax||0), 0);
                const isExpanded = expandedDays && Object.prototype.hasOwnProperty.call(expandedDays, dayLabel)
                  ? expandedDays[dayLabel]
                  : dayIdx === 0;
                const toggleDay = () => setExpandedDays(prev => ({ ...(prev||{}), [dayLabel]: !isExpanded }));
                return (
                  <div key={dayLabel} style={{ marginBottom:16 }}>
                    <div onClick={toggleDay}
                      style={{ ...row, padding:"5px 10px", background:G, borderRadius:6, marginBottom:6, cursor:"pointer" }}>
                      <span style={{ color:W, fontWeight:700, fontSize:11 }}>
                        {isExpanded ? "▾" : "▸"} {dayLabel}
                      </span>
                      <span style={{ color:"rgba(255,255,255,0.8)", fontSize:10 }}>
                        {dayTrx.length} trx · {dayPax} pax · <b style={{ color:"#a8ffcc" }}>{fmt(dayTotal)}</b>
                      </span>
                    </div>
                    {isExpanded && dayTrx.map(renderTrx)}
                  </div>
                );
              })
        )}

        {viewMode === "shift" && (
          // ── VIEW BY SHIFT ──
          !shiftKeys.length && !isLoading
            ? <div style={{ textAlign:"center", color:MT, marginTop:70, fontSize:13 }}>Tidak ada transaksi</div>
            : displayedShiftKeys.map((shiftKey, idx) => {
                const group = histByShift[shiftKey];
                const isUncategorized = shiftKey === "Tanpa Shift";
                const shiftTotal = group.trxs.reduce((s,t) => s + t.total, 0);
                const shiftPax = group.trxs.reduce((s,t) => s + (t.pax||0), 0);
                const label = isUncategorized
                  ? "Tanpa Shift"
                  : shiftLabels[shiftKey] || `Shift ${group.shift?.shiftNum || "?"}`;
                const exp = isShiftExpanded(shiftKey, idx);
                return (
                  <div key={shiftKey} style={{ marginBottom:16 }}>
                    <div onClick={() => toggleShift(shiftKey)}
                      style={{ ...row, padding:"5px 10px", background:isUncategorized ? "#888" : "#2a5a8a", borderRadius:6, marginBottom:6, cursor:"pointer" }}>
                      <span style={{ color:W, fontWeight:700, fontSize:11 }}>
                        {exp ? "▾" : "▸"} {label}
                      </span>
                      <span style={{ color:"rgba(255,255,255,0.8)", fontSize:10 }}>
                        {group.trxs.length} trx · {shiftPax} pax · <b style={{ color:"#a8ffcc" }}>{fmt(shiftTotal)}</b>
                      </span>
                    </div>
                    {exp && group.trxs.map(renderTrx)}
                  </div>
                );
              })
        )}

        {/* Loading indicator */}
        {isLoading && (
          <div style={{ textAlign:"center", padding:"20px", color:MT }}>
            <div style={{ display:"inline-block", width:20, height:20, border:"2px solid", borderColor:`${G} transparent`, borderRadius:"50%", animation:"spin 1s linear infinite" }} />
            <style>{"@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}"}</style>
            <span style={{ display:"block", marginTop:8, fontSize:12 }}>Memuat...</span>
          </div>
        )}

        {/* Load more trigger (invisible div at bottom) */}
        {hasMore && !isLoading && (
          <div style={{ height: 1 }} />
        )}

        {/* ── "Lihat semua" collapsible for shifts > 5 ── */}
        {viewMode === "shift" && !showAllShifts && hiddenCount > 0 && (
          <div style={{ textAlign:"center", marginTop:4, marginBottom:8 }}>
            <button onClick={() => setShowAllShifts(true)}
              style={{ padding:"6px 16px", background:W, border:`1px solid ${BD}`, borderRadius:6,
                color:G, cursor:"pointer", fontFamily:"inherit", fontSize:11, fontWeight:600 }}>
              &#9660; Lihat semua ({hiddenCount} shift lainnya)
            </button>
          </div>
        )}
        {viewMode === "shift" && showAllShifts && shiftKeys.length > SHIFT_COLLAPSE_LIMIT && (
          <div style={{ textAlign:"center", marginTop:4, marginBottom:8 }}>
            <button onClick={() => setShowAllShifts(false)}
              style={{ padding:"6px 16px", background:W, border:`1px solid ${BD}`, borderRadius:6,
                color:MT, cursor:"pointer", fontFamily:"inherit", fontSize:11, fontWeight:600 }}>
              &#9650; Tampilkan lebih sedikit
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(ViewRiwayat);
