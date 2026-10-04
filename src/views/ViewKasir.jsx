import { memo, useState } from "react";
import { fmt } from "../utilities/receipt.js";
import { G, OR, W, LT, BD, TX, MT, inp, row } from "../constants/design.js";
import StockBadge from "../components/StockBadge.jsx";
import AdditionalsModal from "../components/modals/AdditionalsModal.jsx";
import { unitOptions } from "../utilities/units.js";

// ViewKasir — sidebar kategori, search, grid menu, FAB, dan cart drawer.
// Props per-field (bukan {menuH, cartH} utuh) supaya React.memo efektif.
function ViewKasir({
  // dari menuH
  allCats, kategori, setKategori, search, setSearch, displayMenu, cats,
  // dari cartH
  cart, drawerOpen, setDrawerOpen,
  receiptAdditionalValues, receiptAdditionals, updateReceiptAdditionalValue,
  pax, setPax, tableNumber, setTableNumber, paxEnabled = false, tableEnabled = false,
  manualDiscountConfig = {}, manualDiscountValue = "", setManualDiscountValue = () => {}, checkRequiredManualDiscount = () => true,
  customerPicker = null,
  customerEnabled = true,
  loyaltyTier = null,
  items, subtotal, service, pajak, discount, total, activeBill,
  addToCart, decCart, delCart, clearCart, setUnit,
  // App.jsx wrapper functions (sudah di-useCallback di App.jsx)
  saveOpenBill, printPreview, printingPreview, setPayModal,
  // validation
  checkRequiredAdditionals,
  stockErrors = [],
  // ref
  searchRef,
}) {
  const [additionalsModal, setAdditionalsModal] = useState({ open: false, item: null });

  // Check if item belongs to drinks category
  const isDrinkItem = (item) => {
    const itemCat = cats?.find(c => c.key === item.kategori);
    return itemCat?.tags?.includes("drinks");
  };

  // Handle item click - show additionals modal for drinks, add directly otherwise
  const handleItemClick = (item) => {
    if (isDrinkItem(item)) {
      setAdditionalsModal({ open: true, item });
    } else {
      addToCart(item);
    }
  };

  // Handle additionals confirm
  const handleAdditionalsConfirm = (additionals) => {
    if (additionalsModal.item) {
      addToCart(additionalsModal.item, additionals);
    }
  };

  // Format additionals for display
  const formatAdditionals = (additionals) => {
    if (!additionals) return "";
    const parts = [];
    if (additionals.cupsize) parts.push(additionals.cupsize);
    if (additionals.sugar) parts.push(additionals.sugar);
    if (additionals.temperature) {
      if (additionals.temperature === "ice" && additionals.ice_level) {
        parts.push(`${additionals.temperature} (${additionals.ice_level})`);
      } else {
        parts.push(additionals.temperature);
      }
    }
    return parts.join(" • ");
  };

  return (
    <>
      <style>{"@keyframes preview-shimmer{from{transform:translateX(-100%)}to{transform:translateX(100%)}}"}</style>
      {/* Sidebar kategori */}
      <aside style={{width:146,background:G,display:"flex",flexDirection:"column",flexShrink:0,overflowY:"auto"}}>
        {allCats.map(k=>(
          <button key={k.key} onClick={()=>setKategori(k.key)} style={{display:"flex",alignItems:"center",padding:"10px 13px",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:600,textAlign:"left",background:kategori===k.key?"rgba(255,255,255,0.18)":"transparent",color:W,borderLeft:kategori===k.key?"3px solid #fff":"3px solid transparent",transition:"all 0.15s"}}>
            {k.label}
          </button>
        ))}
      </aside>

      <main style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        {/* Search */}
        <div style={{padding:"8px 12px",background:W,borderBottom:`1px solid ${BD}`,flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8,background:LT,border:`1px solid ${BD}`,borderRadius:7,padding:"6px 10px"}}>
            <span style={{color:MT,fontSize:13}}>&#128269;</span>
            <input id="kasir-search" name="kasirSearch" ref={searchRef} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari menu / Menu ID... (tekan / untuk fokus)" style={{border:"none",background:"transparent",outline:"none",fontSize:12,fontFamily:"inherit",width:"100%"}}/>
            {search&&<button onClick={()=>setSearch("")} style={{border:"none",background:"none",cursor:"pointer",color:MT,fontSize:12}}>&#10005;</button>}
          </div>
        </div>

        {/* Grid menu */}
        <div style={{flex:1,overflowY:"auto",padding:"10px 12px"}}>
          {displayMenu.length===0?<div style={{textAlign:"center",color:MT,marginTop:60,fontSize:13}}>Tidak ada menu ditemukan</div>
          :<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(175px,1fr))",gap:10}}>
            {displayMenu.map(item=>{
              const itemCartEntries = Object.entries(cart).filter(([key]) => key.startsWith(`${item.id}_`) || key === item.id);
              const qty = itemCartEntries.reduce((sum, [, val]) => sum + (val?.qty || 0), 0);
              const habis = item.stok === 0;
              return(
                <div key={item.id} onClick={()=>!habis&&handleItemClick(item)} style={{background:W,border:`1px solid ${qty>0?"#a8d5b8":BD}`,borderRadius:9,overflow:"hidden",boxShadow:qty>0?"0 0 0 2px #a8d5b8":"0 1px 3px rgba(0,0,0,0.05)",cursor:habis?"not-allowed":"pointer",opacity:habis?0.55:1,transition:"all 0.12s"}}>
                  <div style={{padding:"7px 9px 9px"}}>
                    <div style={{...row,gap:4,marginBottom:2}}><span style={{fontSize:11,fontWeight:700,lineHeight:1.3}}>{item.nama}</span><StockBadge stok={item.stok}/></div>
                    {item.desc&&<div style={{fontSize:9,color:MT,marginBottom:4}}>{item.desc}</div>}
                    <div style={{...row,marginTop:4}}>
                      <span style={{fontSize:12,fontWeight:700}}>{fmt(item.harga)}</span>
                      <div onClick={e=>{e.stopPropagation();if(!habis)handleItemClick(item);}} style={{width:24,height:24,background:habis?"#ccc":G,borderRadius:5,display:"flex",alignItems:"center",justifyContent:"center",color:W,fontSize:15,fontWeight:700,cursor:habis?"not-allowed":"pointer"}}>{qty>0?qty:"+"}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>}
        </div>
      </main>

      {/* FAB */}
      <button onClick={()=>setDrawerOpen(o=>!o)} title="Hotkey: P" style={{position:"absolute",bottom:20,right:20,zIndex:100,width:52,height:52,borderRadius:"50%",background:drawerOpen?"#333":OR,color:W,border:"none",cursor:"pointer",fontSize:20,boxShadow:"0 4px 14px rgba(0,0,0,0.25)",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.2s"}}>
        {drawerOpen?"✕":"🛒"}
        {!drawerOpen&&items.length>0&&<span style={{position:"absolute",top:3,right:3,background:"#e84040",color:W,borderRadius:"50%",width:17,height:17,fontSize:9,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>{items.length}</span>}
      </button>

      {drawerOpen&&<div onClick={()=>setDrawerOpen(false)} style={{position:"absolute",inset:0,zIndex:90,background:"rgba(0,0,0,0.3)"}}/>}

      {/* ─ Cart Drawer ─ */}
      <div style={{position:"absolute",top:0,right:0,bottom:0,zIndex:95,width:340,background:W,borderLeft:`1px solid ${BD}`,display:"flex",flexDirection:"column",transform:drawerOpen?"translateX(0)":"translateX(100%)",transition:"transform 0.3s cubic-bezier(.4,0,.2,1)",boxShadow:drawerOpen?"-5px 0 20px rgba(0,0,0,0.1)":"none"}}>
        <div style={{background:G,padding:"10px 13px",...row}}>
          <div>
            <span style={{color:W,fontWeight:700,fontSize:13}}>Pesanan</span>
            {activeBill&&<span style={{marginLeft:8,fontSize:10,color:"rgba(255,255,255,0.7)"}}>Open Bill #
              {activeBill.id}</span>}
          </div>
          <div style={{display:"flex",gap:6}}>
            {items.length>0&&<button onClick={clearCart} style={{background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.3)",color:W,borderRadius:4,padding:"2px 7px",cursor:"pointer",fontFamily:"inherit",fontSize:10}}>Reset</button>}
            <button onClick={()=>setDrawerOpen(false)} style={{background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.3)",color:W,borderRadius:4,width:22,height:22,cursor:"pointer",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
          </div>
        </div>

        {printingPreview && (
          <div style={{padding:"8px 12px",borderBottom:`1px solid ${BD}`,background:"#f7fbf8"}}>
            <div style={{fontSize:10,color:G,fontWeight:700,marginBottom:6}}>Mempersiapkan Print Preview…</div>
            <div style={{height:7,borderRadius:999,background:"#e7efe8",overflow:"hidden",position:"relative"}}>
              <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.75) 50%, transparent 100%)",animation:"preview-shimmer 1.1s linear infinite"}} />
            </div>
          </div>
        )}

        {/* Order details stay in the cart drawer so they are saved with open bills. */}
        {drawerOpen && <div style={{padding:"8px 12px",borderBottom:`1px solid ${BD}`,background:"#f9faf9"}}>
          {customerEnabled && customerPicker}
          {(paxEnabled || tableEnabled) && <div style={{display:"grid",gridTemplateColumns:paxEnabled&&tableEnabled?"1fr 1fr":"1fr",gap:7,marginBottom:7}}>
            {tableEnabled && <label style={{fontSize:10,color:MT,fontWeight:600}}>Table<input aria-label="Table" type="text" value={tableNumber} onChange={e=>setTableNumber(e.target.value)} placeholder="Nomor meja" style={{...inp,fontSize:12,marginTop:3}} /></label>}
            {paxEnabled && <label style={{fontSize:10,color:MT,fontWeight:600}}>Pax<input aria-label="Pax" type="number" min="1" step="1" value={pax} onChange={e=>setPax(e.target.value)} placeholder="Jumlah orang" style={{...inp,fontSize:12,marginTop:3}} /></label>}
          </div>}
          {receiptAdditionals && receiptAdditionals
            .filter(f => f.category === "receipt" && f.visible !== false)
            .map((field) => (
              <div key={field.key} style={{ marginBottom: 7 }}>
                <div style={{fontSize:10,color:MT,fontWeight:600,marginBottom:3}}>
                  {field.label} {field.required && <span style={{color:"#e84040"}}>*</span>}
                </div>
                {field.type === "number" ? (
                  <input type="number" id={`receipt-add-${field.key}`} name={`receiptAdditional_${field.key}`} min="1" 
                    value={receiptAdditionalValues[field.key] || ""} 
                    onChange={e => updateReceiptAdditionalValue(field.key, e.target.value)}
                    placeholder={field.placeholder || `Masukkan ${field.label.toLowerCase()}...`}
                    style={{...inp,fontSize:12}}
                  />
                ) : (
                  <input type="text" id={`receipt-add-${field.key}`} name={`receiptAdditional_${field.key}`}
                    value={receiptAdditionalValues[field.key] || ""} 
                    onChange={e => updateReceiptAdditionalValue(field.key, e.target.value)}
                    placeholder={field.placeholder || `Masukkan ${field.label.toLowerCase()}...`}
                    style={{...inp,fontSize:12}}
                  />
                )}
              </div>
            ))}
          {manualDiscountConfig.enabled && <label style={{display:"block",fontSize:10,color:MT,fontWeight:600,marginTop:8}}>
            Diskon Manual{manualDiscountConfig.required && <span style={{color:"#e84040"}}> *</span>}
            <div style={{display:"flex",alignItems:"center",gap:6,marginTop:3}}>
              <input aria-label="Diskon manual" type="number" min="0" max={manualDiscountConfig.type === "percentage" ? 100 : undefined} step="any" value={manualDiscountValue} onChange={event=>setManualDiscountValue(event.target.value)} placeholder="Isi diskon" style={{...inp,fontSize:12}} />
              <span>{manualDiscountConfig.type === "fixed" ? "Rp" : "%"}</span>
            </div>
          </label>}
        </div>}

        {/* Header kolom */}
        {items.length>0&&<div style={{display:"grid",gridTemplateColumns:"1fr 60px 46px 60px 20px",gap:3,padding:"5px 12px",borderBottom:`1px solid ${BD}`,background:LT}}>
          {["Item","Harga","Qty","Sub",""].map((h,i)=><div key={i} style={{fontSize:9,color:MT,fontWeight:700,textAlign:i>0?"center":undefined}}>{h}</div>)}
        </div>}

        {/* Items */}
        <div style={{flex:1,overflowY:"auto"}}>
          {items.length===0?<div style={{textAlign:"center",color:MT,marginTop:50,fontSize:12}}><div style={{fontSize:32,marginBottom:6}}>&#128722;</div>Belum ada pesanan</div>
          :items.map((item,idx)=>{
            const cartKey = item.cartKey || item.id;
            const additionalStr = formatAdditionals(item.additionals);
            const uOpts = unitOptions(item);
            const hasUnits = uOpts.length > 1;
            const activeUnit = uOpts.find(o=>String(o.key)===String(item.unit||"")) || uOpts[0];
            return(
              <div key={`${cartKey}_${idx}`} style={{padding:"7px 12px",borderBottom:`1px solid ${LT}`,background:item.additionals?"#f9faf9":W}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 60px 46px 60px 20px",gap:3,alignItems:"center",marginBottom:item.additionals?4:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={{width:26,height:26,background:"#e8f5ee",borderRadius:4,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:7,color:"#5a8a6a",fontWeight:600}}>YKK</span></div>
                    <span style={{fontSize:10,fontWeight:600,lineHeight:1.3}}>{item.nama}</span>
                  </div>
                  <div style={{fontSize:10,color:MT,textAlign:"center"}}>{fmt(item.harga)}</div>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:2}}>
                    <button onClick={()=>decCart(cartKey)} style={{width:16,height:16,borderRadius:3,border:`1px solid ${BD}`,background:LT,cursor:"pointer",fontSize:10,display:"flex",alignItems:"center",justifyContent:"center"}}>-</button>
                    <span style={{fontSize:10,fontWeight:700,minWidth:13,textAlign:"center"}}>{item.qty}</span>
                    <button onClick={()=>addToCart(item,item.additionals)} style={{width:16,height:16,borderRadius:3,border:`1px solid ${BD}`,background:LT,cursor:"pointer",fontSize:10,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
                  </div>
                  <div style={{fontSize:10,fontWeight:600,textAlign:"center"}}>{fmt(item.harga*item.qty)}</div>
                  <button onClick={()=>delCart(cartKey)} style={{background:"none",border:"none",cursor:"pointer",color:"#ccc",fontSize:11}}>&times;</button>
                </div>
                {additionalStr && (
                  <div style={{fontSize:8,color:"#888",marginLeft:32,marginTop:2,fontStyle:"italic"}}>
                    {additionalStr}
                  </div>
                )}
                {hasUnits && (
                  <div style={{display:"flex",gap:3,alignItems:"center",marginLeft:32,marginTop:3,flexWrap:"wrap"}}>
                    {uOpts.map(o=>{
                      const on = String(o.key)===String(item.unit||"");
                      return(
                        <button key={o.key||"base"} onClick={()=>setUnit&&setUnit(cartKey,o.key)} title={o.factor>1?`1 ${o.label||o.key} = ${o.factor}`:""}
                          style={{fontSize:8,padding:"1px 6px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",
                            border:`1px solid ${on?G:BD}`,background:on?"#e8f5ee":W,color:on?G:MT,fontWeight:on?700:500}}>
                          {o.label||o.key||"dasar"}
                        </button>
                      );
                    })}
                    {activeUnit&&activeUnit.factor>1&&(
                      <span style={{fontSize:8,color:MT,fontStyle:"italic"}}>
                        {Math.ceil((item.qty||0)/activeUnit.factor)} {activeUnit.label||activeUnit.key}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Summary */}
        {items.length>0&&(
          <div style={{padding:"10px 13px",borderTop:`1px solid ${BD}`}}>
            <div style={{...row,fontSize:11,color:MT,marginBottom:3}}><span>Subtotal</span><span style={{fontWeight:600,color:TX}}>{fmt(subtotal)}</span></div>
            {loyaltyTier && (
              <div style={{...row,fontSize:11,color:G,marginBottom:3}}>
                <span>
                  <span style={{display:"inline-block",background:"#eaf6ee",border:"1px solid #a8d5b8",borderRadius:4,padding:"0 5px",fontWeight:700,fontSize:10,color:G}}>{loyaltyTier.label}</span>
                  {loyaltyTier.discountPct > 0 ? ` · diskon ${loyaltyTier.discountPct}%` : " · tanpa diskon"}
                </span>
              </div>
            )}
            {discount > 0 && <div style={{...row,fontSize:11,color:G,marginBottom:3}}><span>Diskon</span><span style={{fontWeight:600}}>-{fmt(discount)}</span></div>}
            <div style={{...row,borderTop:`1px solid ${BD}`,paddingTop:7,marginBottom:9}}>
              <span style={{fontSize:14,fontWeight:700}}>Total</span>
              <span style={{fontSize:15,fontWeight:700,color:OR}}>{fmt(total)}</span>
            </div>
            {stockErrors.length>0&&(
              <div style={{background:"#fdecec",border:"1px solid #f3b8b8",borderRadius:6,padding:"6px 8px",marginBottom:8}}>
                <div style={{fontSize:10,fontWeight:700,color:"#c0392b",marginBottom:2}}>Stok tidak mencukupi</div>
                {stockErrors.map(e=>(
                  <div key={e.id} style={{fontSize:9,color:"#c0392b",lineHeight:1.4}}>
                    {e.nama}: butuh {e.needed}, tersedia {e.available}
                  </div>
                ))}
              </div>
            )}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
              <button onClick={saveOpenBill}
              disabled={!checkRequiredAdditionals(receiptAdditionals) || !checkRequiredManualDiscount() || stockErrors.length>0}
              style={{padding:"8px 0",
              border:`2px solid ${checkRequiredAdditionals(receiptAdditionals)&&checkRequiredManualDiscount()&&stockErrors.length===0?"#a8d5b8":BD}`,
              borderRadius:7,
              background:checkRequiredAdditionals(receiptAdditionals)&&checkRequiredManualDiscount()&&stockErrors.length===0?"#e8f5ee":LT,
              color:checkRequiredAdditionals(receiptAdditionals)&&checkRequiredManualDiscount()&&stockErrors.length===0?G:MT,
              cursor:checkRequiredAdditionals(receiptAdditionals)&&checkRequiredManualDiscount()&&stockErrors.length===0?"pointer":"not-allowed",
              fontFamily:"inherit",fontSize:10,fontWeight:700}}>
                {activeBill?"Perbarui Open Bill":"Simpan Open Bill"}
              </button>

              <button onClick={printPreview} disabled={!items.length || !checkRequiredAdditionals(receiptAdditionals) || printingPreview || (paxEnabled&&!(Number(pax)>0))}
                style={{flex:1,
                padding:10,
                border:`1px solid ${G}`,
                borderRadius:7,
background: items.length && checkRequiredAdditionals(receiptAdditionals) && !printingPreview ? "#e8f5ee" : LT,
color: items.length && checkRequiredAdditionals(receiptAdditionals) && !printingPreview ? G : MT,
cursor: items.length && checkRequiredAdditionals(receiptAdditionals) && !printingPreview ? "pointer" : "not-allowed",
fontFamily:"inherit", fontSize:10, fontWeight:700}}>
{printingPreview ? "Mencetak..." : "Cetak Invoice"}
</button>
              <button onClick={
                ()=>checkRequiredAdditionals(receiptAdditionals)&&checkRequiredManualDiscount()&&stockErrors.length===0&&(!paxEnabled||Number(pax)>0)&&setPayModal(true)
              }
               disabled={!checkRequiredAdditionals(receiptAdditionals) || !checkRequiredManualDiscount() || stockErrors.length>0 || (paxEnabled&&!(Number(pax)>0))}
                style={{
                  padding:"8px 0",
                  border:"none",
                  borderRadius:7,
                  background:checkRequiredAdditionals(receiptAdditionals)&&checkRequiredManualDiscount()&&stockErrors.length===0&&(!paxEnabled||Number(pax)>0)?OR:"#f0c89a",
                  color:W,
                  cursor:checkRequiredAdditionals(receiptAdditionals)&&checkRequiredManualDiscount()&&stockErrors.length===0&&(!paxEnabled||Number(pax)>0)?"pointer":"not-allowed",
                  fontFamily:"inherit",
                  fontSize:10,
                  fontWeight:700}}>
                Bayar Sekarang
              </button>
            </div>
            {stockErrors.length>0&&<div style={{fontSize:9,color:"#e84040",
              textAlign:"center",marginTop:4}}>
                Kurangi jumlah item agar tidak melebihi stok</div>}
            {!checkRequiredAdditionals(receiptAdditionals)&&<div style={{fontSize:9,color:"#e84040",
              textAlign:"center",marginTop:4}}>
                Isi field wajib terlebih dahulu</div>}
            {!checkRequiredManualDiscount()&&<div style={{fontSize:9,color:"#e84040",textAlign:"center",marginTop:4}}>Isi diskon manual terlebih dahulu</div>}
          </div>
        )}
      </div>

      {/* Additionals Modal */}
      <AdditionalsModal
        item={additionalsModal.item}
        isOpen={additionalsModal.open}
        onClose={() => setAdditionalsModal({ open: false, item: null })}
        onConfirm={handleAdditionalsConfirm}
        cats={cats}
      />
    </>
  );
}

export default memo(ViewKasir);
