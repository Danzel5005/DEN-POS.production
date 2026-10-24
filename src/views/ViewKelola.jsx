import { memo, useMemo, useState, useCallback } from "react";
import { fmt } from "../utilities/receipt.js";
import { G, W, BD, MT, row, RADIUS, TYPOGRAPHY, COLOR_PALETTE } from "../constants/design.js";
import StockBadge from "../components/StockBadge.jsx";
import StockAlertPanel from "../components/StockAlertPanel.jsx";
import { isAdvancedFeatureOn } from "../constants/advancedFeatures.js";
import StockInModal from "../components/modals/StockInModal.jsx";
import OpnameModal from "../components/modals/OpnameModal.jsx";
import { csvRestock } from "../utilities/csvbuild.js";
import { api } from "../utilities/utils.js";
import { DEFAULT_LOW_STOCK_THRESHOLD } from "../utilities/stock.js";
import ImportExcelPanel from "../components/advanced/ImportExcelPanel.jsx";

// ViewKelola — kelola menu, kategori (CRUD).
function ViewKelola({
  menu, cats, allCats,                  // menuH
  setCatModal, openAdd, openEdit,       // menuH
  applyStockView,                       // menuH — sinkron stok ke state
  setConfirmDel,                        // App.jsx local
  search, setSearch,                    // search from menuH
  lowStockThreshold = DEFAULT_LOW_STOCK_THRESHOLD,
advancedFeatures,
advancedData = null,
toast_ = null,                        // optional feedback hook
onImported,
}) {
  const [stockInItem, setStockInItem] = useState(null);
  const [opnameOpen, setOpnameOpen] = useState(false);

  // Sinkronkan stok baru hasil stok-masuk / opname ke state menu React.
  const syncStock = useCallback((res) => {
    if (res?.stock && applyStockView) applyStockView(res.stock);
  }, [applyStockView]);

  // Group items by their actual category (kategori field), not just categories in cats array
  // This ensures ALL items show even if their category is missing from cats
  const groupedItems = useMemo(() => {
    const groups = {};
    const searchLower = search.toLowerCase();
    menu.forEach(item => {
      // Filter by search term
      if (!item.nama.toLowerCase().includes(searchLower)) return;
      
      const catKey = item.kategori || "unknown";
      if (!groups[catKey]) groups[catKey] = [];
      groups[catKey].push(item);
    });
    return groups;
  }, [menu, search]);

  // Get category labels from cats array, fallback to key if not found
  const getCatLabel = (key) => {
    const cat = cats.find(c => c.key === key);
    return cat ? cat.label : key;
  };

  // Sort category keys for consistent ordering (default cats first, then alphabetical)
  const catKeys = useMemo(() => {
    const defaultOrder = ["kopi", "teh", "non-kopi", "sandwich", "indomie", "snack", "main-course"];
    const keys = Object.keys(groupedItems);
    return keys.sort((a, b) => {
      const ai = defaultOrder.indexOf(a);
      const bi = defaultOrder.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [groupedItems]);

  // Export the low-stock restock list as CSV (Windows-friendly, BOM added by saveCSV).
  const showResepHpp = isAdvancedFeatureOn({ advancedFeatures }, "resepHpp");

 const exportRestock = (restockRows) => {
    if (!restockRows || restockRows.length === 0) return;
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
    const now = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const filename = `Daftar_Restock_${stamp}.csv`;
    api.saveCSV({ filename, content: csvRestock(restockRows, now) })
      .then((res) => {
        if (!toast_) return;
        const path = res?.path || res?.filePath;
        if (res?.ok) toast_(path ? `Daftar Restock disimpan: ${path}` : "Daftar Restock disimpan", "ok", path ? 8000 : 3000);
        else if (res !== undefined) toast_(res?.error || "Unduhan CSV dibatalkan", "err");
      })
      .catch(() => { if (toast_) toast_("Gagal menyimpan CSV", "err"); });
  };

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div className="page-toolbar" style={{padding:"9px 16px",background:W,borderBottom:`1px solid ${BD}`,...row,flexShrink:0}}>
        <div>
          <div style={{fontSize:TYPOGRAPHY.body.fontSize,fontWeight:700,color:G}}>Kelola Menu & Kategori</div>
          <div style={{fontSize:TYPOGRAPHY.label.fontSize,color:MT}}>{menu.length} item · {cats.length} kategori</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {/* Search bar */}
          <div style={{display:"flex",alignItems:"center",gap:8,background:COLOR_PALETTE.grayLight,border:`1px solid ${BD}`,borderRadius:RADIUS.md,padding:"6px 10px",minWidth:200}}>
            <span style={{color:MT,fontSize:13}}>&#128269;</span>
            <input 
              id="kelola-search" name="kelolaSearch"
              value={search} 
              onChange={e=>setSearch(e.target.value)} 
              placeholder="Cari menu..." 
              style={{border:"none",background:"transparent",outline:"none",fontSize:12,fontFamily:"inherit",width:"100%"}}
            />
            {search&&<button onClick={()=>setSearch("")} style={{border:"none",background:"none",cursor:"pointer",color:MT,fontSize:12}}>&#10005;</button>}
          </div>
          <button onClick={()=>setCatModal(true)} style={{background:COLOR_PALETTE.infoLight,color:COLOR_PALETTE.info,border:"none",borderRadius:RADIUS.md,padding:"6px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:TYPOGRAPHY.small.fontSize,fontWeight:700}}>Kelola Kategori</button>
          <button onClick={openAdd} style={{background:G,color:W,border:"none",borderRadius:RADIUS.md,padding:"6px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:TYPOGRAPHY.small.fontSize,fontWeight:700}}>+ Tambah Menu</button>
        {menu.length>0 && (
         <button onClick={()=>setConfirmDel({type:"allMenu"})}
          style={{background:"#fef0f0",color:"#e84040",border:"none",borderRadius:7,padding:"6px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:700}}>
           Hapus Semua Menu
         </button>)}
        </div>
      </div>
<div style={{flex:1,overflowY:"auto",padding:"10px 16px"}}>
      <details style={{marginBottom:12}}>
        <summary style={{cursor:"pointer",fontSize:12,fontWeight:700,color:G,padding:"8px 0"}}>Import menu dari Excel</summary>
        <ImportExcelPanel menu={menu} cats={cats} advancedData={advancedData} toast_={toast_} onImported={onImported} />
      </details>
      {menu.length > 0 && (
        <div style={{padding:"10px 16px 0",flexShrink:0}}>
          <StockAlertPanel
            menu={menu}
            cats={cats}
            threshold={lowStockThreshold}
            onOpenItem={openEdit}
            onExportCSV={exportRestock}
            onStockIn={(item) => setStockInItem(item)}
            onOpname={() => setOpnameOpen(true)}
          />
        </div>
      )}
        {catKeys.map(catKey => {
          const items_ = groupedItems[catKey];
          return(
            <div key={catKey} style={{marginBottom:16}}>
              <div style={{fontSize:TYPOGRAPHY.small.fontSize,fontWeight:700,color:G,padding:"3px 8px",background:COLOR_PALETTE.primaryLight,borderRadius:RADIUS.sm,marginBottom:6}}>{getCatLabel(catKey)} ({items_.length})</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(185px,1fr))",gap:8}}>
                {items_.map(item=>
                  <div key={item.id} style={{background:W,border:`1px solid ${BD}`,borderRadius:RADIUS.md,overflow:"hidden",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                    <div style={{padding:"6px 9px"}}>
                      <div style={{...row,marginBottom:1}}><span style={{fontSize:TYPOGRAPHY.small.fontSize,fontWeight:700}}>{item.nama}</span><StockBadge stok={item.stok} threshold={lowStockThreshold}/></div>
                      {item.desc&&<div style={{fontSize:TYPOGRAPHY.label.fontSize,color:MT,marginBottom:2}}>{item.desc}</div>}
                      <div style={{fontSize:TYPOGRAPHY.small.fontSize,fontWeight:700,color:G}}>{fmt(item.harga)}</div>
                      <div style={{fontSize:TYPOGRAPHY.label.fontSize,color:MT}}>Modal: {item.modal?fmt(item.modal):<span style={{color:"#e8a040"}}>Belum diisi</span>}</div>
{showResepHpp&&advancedData&&advancedData.hppFor(item.id)!=null&&(()=>{const h=advancedData.hppFor(item.id);const m=advancedData.marginFor(item.id,item.harga);return(<div style={{fontSize:TYPOGRAPHY.label.fontSize,color:MT}}>HPP: {fmt(h)}{m&&<span style={{color:m.profit>=0?G:"#d32f2f"}}> &middot; margin {(Number(m.marginPct) * 100).toFixed(0)}%</span>}</div>);})()}
                      <div style={{display:"flex",gap:5,marginTop:6}}>
                        <button onClick={()=>openEdit(item)} style={{flex:1,background:COLOR_PALETTE.infoLight,color:COLOR_PALETTE.info,border:"none",borderRadius:RADIUS.sm,padding:"4px 0",cursor:"pointer",fontFamily:"inherit",fontSize:TYPOGRAPHY.label.fontSize,fontWeight:600}}>Edit</button>
                        {item.stok !== null && item.stok !== undefined && (
                          <button onClick={()=>setStockInItem(item)} style={{flex:1,background:"#e8f5ee",color:G,border:"none",borderRadius:RADIUS.sm,padding:"4px 0",cursor:"pointer",fontFamily:"inherit",fontSize:TYPOGRAPHY.label.fontSize,fontWeight:600}}>Stok Masuk</button>
                        )}
                        <button onClick={()=>setConfirmDel({type:"item",id:item.id})} style={{flex:1,background:COLOR_PALETTE.dangerLight,color:COLOR_PALETTE.danger,border:"none",borderRadius:RADIUS.sm,padding:"4px 0",cursor:"pointer",fontFamily:"inherit",fontSize:TYPOGRAPHY.label.fontSize,fontWeight:600}}>Hapus</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {stockInItem && (
        <StockInModal item={stockInItem} toast_={toast_} onClose={()=>setStockInItem(null)} onDone={syncStock} />
      )}
      {opnameOpen && (
        <OpnameModal menu={menu} toast_={toast_} onClose={()=>setOpnameOpen(false)} onDone={syncStock} />
      )}
    </div>
  );
}

export default memo(ViewKelola);