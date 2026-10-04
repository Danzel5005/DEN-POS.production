import { useState, useCallback } from "react";
import { calcPrice } from "../utilities/calculations.js";
import { api } from "../utilities/utils.js";
import { resolveLine, stockQty, cartKeyFor, unitOptions, linePricing, stepQtyForUnit, computeStockErrors } from "../utilities/units.js";
import { buildKdsTickets } from "../utilities/kds.js";

// lineBaseQty — qty baris keranjang SELALU disimpan dalam SATUAN DASAR.
// Jadi untuk baris yang sudah tersimpan, qty-nya langsung dipakai (JANGAN
// dikali factor lagi — itulah sumber bug "50 x 50 = 2500" saat ganti satuan).
// Fungsi ini beda dengan stockQty(item, qty, unitKey) di units.js yang
// mengonversi "jumlah dalam satuan tertentu" → satuan dasar.
function lineBaseQty(line) {
  const qty = Number(line?.qty);
  return Number.isFinite(qty) ? qty : 0;
}

// Koersi angka yang aman (NaN/undefined → 0).
function num_(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Beri label satuan pada baris (dipakai struk HTML & ESC/POS). Satuan dasar
// tidak diberi label supaya struk lama tidak berubah.
function withUnitLabel(items) {
  return items.map(i => {
    if (!i.unit) return i;
    const u = unitOptions(i).find(o => String(o.key) === String(i.unit));
    return { ...i, unitLabel: u ? (u.label || u.key) : i.unit };
  });
}

// useCart — cart, activeBill (KEPUTUSAN EKSPLISIT USER: activeBill tetap di
// sini, BUKAN di useBills, karena dia selalu direset bersamaan dengan
// clearCart() — menyatukan mereka membuat relasi itu eksplisit di satu hook).
//
// Ini hook paling cross-cutting di seluruh app: processPayment butuh data
// dari shift (activeShift.id), bills (persistBills untuk hapus bill yang
// dibayar), menu (computeStockDeduction), history (append trx), dan
// printer (printHTML). SEMUA itu diterima sebagai parameter dari App.jsx,
// tidak ada import hook lain di sini.
//
// CATATAN BUG YANG BELUM DI-ROOT-CAUSE (Lag_Fix.md Tahap 2):
// loadBillToCart dipanggil dari tombol "Bayar" di view Open Bill, diikuti
// `setTimeout(()=>setPayModal(true), 300)` — pola asli ini DIPERTAHANKAN
// PERSIS di App.jsx (tidak diubah di sini), supaya kalau bug race condition
// activeBill masih muncul setelah migrasi, itu bukan disebabkan oleh
// perubahan pola di migrasi ini.
//
// PERHATIAN KHUSUS untuk useCallback di file ini: processPayment membaca
// `activeBill` langsung dari closure — variabel yang SAMA yang diduga
// terlibat dalam race condition Tahap 2. Dependency array di bawah
// diverifikasi dengan sangat hati-hati: salah satu deps hilang di sini
// bisa MENCIPTAKAN stale closure baru, bukan cuma gagal mencegah yang lama.
function useCart({ toast_, getNow, receiptAdditionals: initialReceiptAdditionals = [], menu = [], categories = [], applyBahanUsage = null }) {
  const [cart, setCart]         = useState({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [receiptAdditionalValues, setReceiptAdditionalValues] = useState({}); // { "nomor_meja": "5", "jumlah_pax": "2" }
  const [pax, setPax] = useState("");
  const [paxEnabled, setPaxEnabled] = useState(false);
  const [tableEnabled, setTableEnabled] = useState(false);
  const [tableNumber, setTableNumber] = useState("");
  const [metode, setMetode]     = useState("cash");
  const [paid, setPaid]         = useState("");
  const [manualDiscountValue, setManualDiscountValue] = useState("");
  const [manualDiscountType, setManualDiscountType] = useState("");
  const [activeBill, setActiveBill] = useState(null);
  const [additionalsModal, setAdditionalsModal] = useState({ open: false, item: null });
  const [pendingItem, setPendingItem] = useState(null);
  // Reactive state for receiptAdditionals - initialized from props, can be updated via setter
  const [receiptAdditionals, setReceiptAdditionals] = useState(initialReceiptAdditionals);
  const [pricingConfig, setPricingConfig] = useState({
    discounts: [],
    pajak: { enabled: false, value: 0 },
    service: { enabled: false, value: 0 },
  });
  const [kdsSettings, setKdsSettings] = useState({ enabled: false, stations: [], unmappedStationId: "" });

  const queueKdsTickets = useCallback(async ({ items: ticketItems, prevItems, meta }) => {
    if (!kdsSettings.enabled) return { ok: false, queued: 0 };
    try {
      const deviceStatus = await api.deviceStatus();
      const tickets = buildKdsTickets({
        items: ticketItems,
        prevItems,
        categories,
        stations: kdsSettings.stations || [],
        meta: { ...meta, deviceId: deviceStatus?.identity?.deviceId || "pos", unmappedStationId: kdsSettings.unmappedStationId },
      });
      return tickets.length ? { ...(await api.kdsSend(tickets)), ticketCount: tickets.length } : { ok: true, queued: 0, ticketCount: 0 };
    } catch {
      return { ok: false, queued: 0 };
    }
  }, [categories, kdsSettings]);

  // items — baris keranjang dengan harga/modal EFEKTIF per satuan dasar.
  // Harga dihitung ulang setiap render dari qty & satuan aktif lewat
  // linePricing(), sehingga:
  //   - tier harga aktif begitu qty baris melewati minQty (Bug #4)
  //   - harga satuan tambahan memakai unit.harga/factor (Bug #4)
  // State `cart` TIDAK dimutasi; kita hanya memetakan untuk konsumsi UI &
  // kalkulasi supaya tidak ada harga basi (stale) yang tersimpan.
  const items    = Object.values(cart).map(line => {
    const p = linePricing(line);
    return { ...line, harga: p.harga, modal: p.modal, tierHarga: p.tierHarga };
  });
  const subtotal = items.reduce((s, i) => s + i.harga * i.qty, 0);
  const manualDiscountConfig = pricingConfig.manualCartDiscount || {};
  const effectiveManualDiscountType = manualDiscountType || manualDiscountConfig.type || "percentage";
  const manualDiscount = (manualDiscountConfig.enabled || (activeBill && String(manualDiscountValue).trim() !== ""))
    ? { type: effectiveManualDiscountType, value: manualDiscountValue }
    : undefined;
  const { pajak, service, discount, total } = calcPrice(subtotal, { ...pricingConfig, items, manualDiscount });
  const paidNum   = parseInt(paid.replace(/\D/g, "")) || 0;
  const kembalian = paidNum - total;

  // Check if all required receipt additionals are filled (moved before canPay to avoid TDZ)
  const checkRequiredAdditionals = useCallback((additionals) => {
    if (!additionals) return true;
    return additionals.every(field => {
      if (!field.required) return true;
      const value = receiptAdditionalValues[field.key];
      return value && String(value).trim() !== "";
    });
  }, [receiptAdditionalValues]);

  // stockErrors — daftar baris keranjang yang melebihi stok tersedia (Bug #2).
  // Stok tersedia = stok menu saat ini + qty yang SUDAH dipotong oleh open
  // bill aktif (karena baris bill dimuat kembali ke keranjang, stoknya sudah
  // berkurang — kalau tidak ditambahkan kembali, bill valid malah dianggap
  // kelebihan stok). `stok === null` berarti tak terbatas.
  // Logikanya murni di units.js (computeStockErrors) supaya bisa dites.
  const stockErrors = computeStockErrors({
    menu,
    cartItems: items,
    heldItems: activeBill?.items || [],
    baseQtyOf: lineBaseQty,
  });

  // Use checkRequiredAdditionals to validate all required receipt additionals (not just tableNum)
  const checkRequiredManualDiscount = useCallback(() => !manualDiscountConfig.enabled || !manualDiscountConfig.required || String(manualDiscountValue).trim() !== "", [manualDiscountConfig.enabled, manualDiscountConfig.required, manualDiscountValue]);
  const canPay = items.length > 0 && stockErrors.length === 0 && checkRequiredAdditionals(receiptAdditionals) && checkRequiredManualDiscount() && (!paxEnabled || Number(pax) > 0) && (metode !== "cash" || paidNum > 0 || total === 0);
  const getCanPay = useCallback((additionals) => items.length > 0 && stockErrors.length === 0 && checkRequiredAdditionals(additionals) && checkRequiredManualDiscount() && (!paxEnabled || Number(pax) > 0) && (metode !== "cash" || paidNum > 0 || total === 0), [items, stockErrors, checkRequiredAdditionals, checkRequiredManualDiscount, metode, paidNum, total, paxEnabled, pax]);

  // PENTING: pakai functional update setCart(c=>...), TIDAK baca `cart`
  // langsung dari closure — pattern paling stabil. Tapi memanggil toast_,
  // jadi tetap perlu [toast_] di deps (toast_ sendiri stabil/[]).
  const addToCart = useCallback((item, additionals = null) => {
  // Check if stock is depleted
  if (item.stok === 0) { toast_(`Stok "${item.nama}" habis`, "err"); return; }

  // Langkah 3: satuan dasar → cartKey = id (kompatibel data lama);
  // satuan lain → id@unitKey. `additionals` digabung setelahnya supaya
  // varian additionals + satuan tidak bertabrakan.
  const unitKey = item.unit || "";
  const baseKey = additionals
    ? `${cartKeyFor(item.id, unitKey)}_${JSON.stringify(additionals)}`
    : cartKeyFor(item.id, unitKey);

  // Satu baris keranjang menyimpan qty dalam SATUAN DASAR supaya
  // `harga * qty` (kalkulasi/struk/laporan) tetap konsisten. Untuk satuan
  // lain, 1 "klik" = factor satuan dasar.
  const perUnitBaseQty = stockQty({ ...item, units: item.units }, 1, unitKey);

  // Calculate current total quantity of this item in cart (across all additionals variations)
  // We need to read current cart state, so we use a functional update with a check
  setCart(c => {
    // Sum up all BASE quantities for this item ID across additionals & satuan
    const currentTotalQty = Object.values(c)
      .filter(cartItem => cartItem.id === item.id)
      .reduce((sum, cartItem) => sum + lineBaseQty(cartItem), 0);

    // Check if adding one more would exceed stock (stok selalu satuan dasar)
    if (item.stok !== null && currentTotalQty + perUnitBaseQty > item.stok) {
      toast_(`Stok "${item.nama}" tidak mencukupi (tersisa ${item.stok - currentTotalQty})`, "err");
      return c; // Return unchanged cart
    }

    return {
      ...c,
      [baseKey]: {
        ...item,
        id: item.id, // Keep original id for stock tracking
        cartKey: baseKey, // Store unique cart key
        unit: unitKey, // "" = satuan dasar
        qty: (c[baseKey]?.qty || 0) + perUnitBaseQty,
        additionals: additionals || undefined,
      }
    };
  });
}, [toast_]);

  // Langkah 3: ganti satuan sebuah baris keranjang tanpa kehilangan qty.
  // Qty lama dikonversi ke satuan dasar lalu dibagi factor satuan baru.
  // Kalau hasilnya bukan bilangan bulat (mis. 2 dus → pack tidak pas),
  // pembulatan ke atas supaya stok tidak pernah kurang dipotong.
  const setUnit = useCallback((cartKey, unitKey) => {
    setCart(c => {
      const line = c[cartKey];
      if (!line) return c;
      const oldKey = line.unit || "";
      if (String(oldKey) === String(unitKey || "")) return c;

      // qty baris sudah dalam SATUAN DASAR → pakai apa adanya (bukan stockQty,
      // yang akan mengalikannya dengan factor lagi).
      const baseQty = lineBaseQty(line);
      const opts = unitOptions(line);
      const target = opts.find(o => String(o.key) === String(unitKey || "")) || opts[0];
      const factor = target.factor || 1;
      const newQty = Math.max(factor, Math.ceil(baseQty / factor) * factor);

      const nextKey = cartKeyFor(line.id, unitKey || "");
      if (c[nextKey]) return c; // jangan gabung paksa, biarkan baris terpisah

      const n = { ...c };
      delete n[cartKey];
      n[nextKey] = { ...line, unit: unitKey || "", cartKey: nextKey, qty: newQty };
      return n;
    });
  }, []);

  // deps kosong aman: functional update penuh, tidak baca state luar sama sekali.
  // Note: id parameter is now cartKey which may include additionals in the format "itemId_{...}"
  const decCart = useCallback((cartKey) => setCart(c => { 
    const n = { ...c }; 
    const line = n[cartKey];
    if (!line) return c;
    // Satu "klik" minus = kurangi SATU SATUAN TAMPILAN (factor), bukan 1
    // satuan dasar — qty baris disimpan dalam satuan dasar (Bug #1).
    const step = stepQtyForUnit(line); // default 1 untuk satuan dasar
    const nextQty = num_(line.qty) - step;
    if (nextQty <= 0) delete n[cartKey];
    else n[cartKey] = { ...line, qty: nextQty };
    return n; 
  }), []);
  const delCart = useCallback((cartKey) => setCart(c => { 
    const n = { ...c }; 
    delete n[cartKey]; 
    return n; 
  }), []);

  // deps kosong aman: semua setter dengan nilai konstan, tidak baca state.
  const clearCart = useCallback(() => {
    setCart({}); setPaid(""); setManualDiscountValue(""); setManualDiscountType(""); setMetode("cash"); setActiveBill(null); setReceiptAdditionalValues({}); setPax(""); setTableNumber(""); setAdditionalsModal({ open: false, item: null }); setDrawerOpen(false);
  }, []);

  // Update a single receipt additional field value
  const updateReceiptAdditionalValue = useCallback((fieldKey, value) => {
    setReceiptAdditionalValues(prev => ({ ...prev, [fieldKey]: value }));
  }, []);

  // Dynamic canPay - includes receipt additionals validation
  // saveOpenBill & loadBillToCart tinggal di sini (bukan useBills) karena
  // mereka menulis langsung ke state cart/activeBill yang dimiliki hook ini.
  // `bills`/`billId`/`persistBills`/`setBillId` adalah ARGUMEN PANGGILAN
  // (dipass tiap kali dipanggil dari App.jsx), bukan closure dependency —
  // jadi TIDAK masuk deps array, sesuai aturan exhaustive-deps untuk
  // parameter fungsi.
  //
  // PENTING: items, tableNum, activeBill, pax dibaca LANGSUNG dari closure.
  // Tanpa activeBill di deps, saveOpenBill akan selalu mengira tidak ada
  // activeBill (selalu masuk cabang "buat baru" bukan "update") — bug baru
  // yang jauh lebih parah dari yang sedang kita selidiki.
  const saveOpenBill = useCallback(async ({ 
    bills, billId, persistBills, setBillId,
    applyStockView,  // NEW (Langkah 2): stok dihitung di main process
    customer = null, paxEnabled = false, tableEnabled = false,
  }) => {
    if (!items.length || !checkRequiredAdditionals(receiptAdditionals) || !checkRequiredManualDiscount() || (paxEnabled && Number(pax) <= 0)) { toast_("Isi field wajib dan pesanan dulu", "err"); return; }
    if (stockErrors.length > 0) {
      const e = stockErrors[0];
      toast_(`Stok "${e.nama}" tidak mencukupi: butuh ${e.needed}, tersedia ${e.available}`, "err");
      return;
    }
    const t = getNow();
    
    // Customer is DENORMALIZED (name/phone copied, not just id) into the bill
    // so the open-bill detail stays readable even if the customer record is
    // later renamed or removed. Mirrors processPayment's trx snapshot.
    const customerData = {
      customerId: customer?.id || null,
      customerNama: customer?.name || "",
      customerTelepon: customer?.phone || "",
    };
    const partyData = {
      ...(paxEnabled ? { pax: Math.max(1, Math.floor(Number(pax) || 1)) } : {}),
      ...(tableEnabled ? { tableNumber: String(tableNumber || "").trim() } : {}),
    };

    // Build receipt additional values for the bill
    const receiptAdditionalData = {};
    if (receiptAdditionals) {
      receiptAdditionals
        .filter(f => f.category === "receipt" && f.visible !== false)
        .forEach(field => {
          receiptAdditionalData[field.key] = receiptAdditionalValues[field.key] || "";
        });
    }
    
    let updatedBills;
    let stockDelta = null;
    if (activeBill) {
      // Calculate stock delta: new items - old items.
      // qty baris (bill lama & keranjang) SUDAH dalam SATUAN DASAR → pakai
      // apa adanya lewat lineBaseQty(). JANGAN stockQty() — itu akan
      // mengalikannya dengan factor lagi (sumber bug "50 x 50 = 2500").
      const oldItemsById = (activeBill.items || []).reduce((acc, item) => {
        const existing = acc[item.id] || { qty: 0 };
        acc[item.id] = { ...existing, qty: existing.qty + lineBaseQty(item) };
        return acc;
      }, {});
      const newItemsById = items.reduce((acc, item) => {
        const existing = acc[item.id] || { qty: 0 };
        acc[item.id] = { ...existing, qty: existing.qty + lineBaseQty(item) };
        return acc;
      }, {});
      
      // Compute delta (new - old) — dikirim ke main process, bukan dihitung di renderer
      const allItemIds = new Set([...Object.keys(oldItemsById), ...Object.keys(newItemsById)]);
      stockDelta = {};
      for (const id of allItemIds) {
        const oldQty = oldItemsById[id]?.qty || 0;
        const newQty = newItemsById[id]?.qty || 0;
        const diff = newQty - oldQty;
        if (diff !== 0) {
          stockDelta[id] = diff;
        }
      }

      // Bahan baku: kembalikan pemakaian bill lama lalu potong sesuai keranjang
      // terkini. Dua langkah agar perubahan komposisi item tetap akurat.
      if (applyBahanUsage) {
        applyBahanUsage(activeBill.items || [], 1);
        applyBahanUsage(items, -1);
      }
      
      updatedBills = bills.map(b =>
        String(b.id) === String(activeBill.id)
          ? { ...b, items: withUnitLabel(items), updatedAt: t.timestamp, manualDiscountValue, manualDiscountType: effectiveManualDiscountType, ...customerData, ...partyData, ...receiptAdditionalData }
          : b
      );
      toast_('Open Bill diperbarui', "ok");
    } else {
      // New bill - all items are new stock deduction (dalam satuan dasar)
      stockDelta = items.reduce((acc, item) => {
        acc[item.id] = (acc[item.id] || 0) - lineBaseQty(item);
        return acc;
      }, {});

      // Bahan baku: potong sesuai resep untuk seluruh item bill baru.
      if (applyBahanUsage) applyBahanUsage(items, -1);
      
      const bill = { id: billId, items: withUnitLabel(items), createdAt: t.timestamp, updatedAt: t.timestamp, status: "open", manualDiscountValue, manualDiscountType: effectiveManualDiscountType, ...customerData, ...partyData, ...receiptAdditionalData };
      updatedBills = [...bills, bill];
      setBillId(n => n + 1);
      toast_('Open Bill dibuat', "ok");
    }
    
    // Deduct stock when saving open bill (only delta for updates).
    // Stok dihitung di main process (Langkah 2) dan persist ke SQLite/JSON;
    // view di-patch dari hasil { stock } supaya UI tetap akurat.
    if (stockDelta && Object.keys(stockDelta).length > 0) {
      const res = await api.applyStock(stockDelta, { type: "openbill", ref: activeBill?.id || billId });
      if (res?.ok && res.stock && applyStockView) applyStockView(res.stock);
    }
    
    await persistBills(updatedBills);
    try {
      const priorBill = activeBill && (bills.find((bill) => String(bill.id) === String(activeBill.id)) || activeBill);
      const billRef = activeBill?.id || billId;
      const kdsResult = await queueKdsTickets({
        items,
        prevItems: priorBill?.kdsSent ? priorBill.items || [] : undefined,
        meta: {
          sourceRef: String(billRef),
          sourceLabel: `Bill #${billRef}`,
          clientTicketId: `${billRef}:${t.timestamp}`,
          createdAt: t.timestamp,
          tableLabel: partyData.tableNumber ? `Meja ${partyData.tableNumber}` : "",
          extras: receiptAdditionals.filter((field) => field.category === "receipt" && receiptAdditionalData[field.key]).map((field) => ({ label: field.label, value: receiptAdditionalData[field.key] })),
        },
      });
      if (kdsResult.ok && kdsResult.ticketCount > 0) {
        updatedBills = updatedBills.map((bill) => String(bill.id) === String(billRef) ? { ...bill, kdsSent: true } : bill);
        await persistBills(updatedBills);
      }
    } catch { /* KDS must never block saving an open bill. */ }
    clearCart();
    setDrawerOpen(false);
  }, [items, receiptAdditionalValues, receiptAdditionals, activeBill, toast_, getNow, clearCart, stockErrors, applyBahanUsage, pax, tableNumber, manualDiscountValue, effectiveManualDiscountType, checkRequiredManualDiscount, bills, queueKdsTickets]);

  // deps: needs receiptAdditionals to read current receipt additionals config
  const loadBillToCart = useCallback((bill) => {
    const c = {};
    // Langkah 3: pakai cartKey kalau ada, supaya varian satuan/additionals
    // tidak saling menimpa (bug ini sudah ada untuk additionals).
    bill.items.forEach(i => { c[i.cartKey || i.id] = { ...i }; });
    setCart(c);
    setPax(bill.pax == null ? "" : String(bill.pax));
    setTableNumber(bill.tableNumber || "");
    setManualDiscountValue(bill.manualDiscountValue == null ? "" : String(bill.manualDiscountValue));
    setManualDiscountType(bill.manualDiscountType || "");
    // Load receipt additional values from bill
    if (receiptAdditionals) {
      receiptAdditionals
        .filter(f => f.category === "receipt" && f.visible !== false)
        .forEach(field => {
          if (bill[field.key] !== undefined) {
            setReceiptAdditionalValues(prev => ({ ...prev, [field.key]: bill[field.key] }));
          }
        });
    }
    setActiveBill(bill);
    setDrawerOpen(true);
  }, [receiptAdditionals]);

  // processPayment — paling cross-cutting. Semua dependency lintas-domain
  // (generateTrxId, activeShift, computeStockDeduction, dst) adalah ARGUMEN
  // PANGGILAN, bukan closure dependency — TIDAK masuk deps array.
  //
  // PENTING — baca dengan teliti: items, subtotal, metode,
// paidNum, kembalian, cart SEMUA dibaca langsung dari closure.
// activeBill DIHAPUS dari deps — billIdToClose sekarang dikirim sebagai
// parameter eksplisit dari App.jsx (via cartH.activeBill) untuk menghindari
// race condition pada setTimeout di loadBillAndPay.
const processPayment = useCallback(async ({
  generateTrxId, activeShift,
  applyStockView,  // NEW (Langkah 2): patch view dari { stock } hasil IPC
  appendHistory,
  removeBillLocal,
  onSuccess,
  billIdToClose,
  paymentMethods = [],
  customer = null, // Selected customer/member snapshot (denormalized into trx)
  paxEnabled = false,
  tableEnabled = false,
  kdsSent = false,
  kdsPreviousItems = [],
}) => {
    if (stockErrors.length > 0) {
      const e = stockErrors[0];
      toast_(`Stok "${e.nama}" tidak mencukupi: butuh ${e.needed}, tersedia ${e.available}`, "err");
      return null;
    }
  if (!checkRequiredManualDiscount()) { toast_("Isi diskon manual terlebih dahulu", "err"); return null; }
  const t = getNow();
  const { pajak: p, service: s, discount: d, total: tot } = calcPrice(subtotal, { ...pricingConfig, items, manualDiscount });
  
  // Build receipt additional values for the transaction
  const receiptAdditionalData = {};
  if (receiptAdditionals) {
    receiptAdditionals
      .filter(f => f.category === "receipt" && f.visible !== false)
      .forEach(field => {
        receiptAdditionalData[field.key] = receiptAdditionalValues[field.key] || "";
      });
  }
  
  // Resolve payment method label for the transaction (never show key)
  const savedSettingsLabel = (() => {
    try {
      const savedSettings = JSON.parse(localStorage.getItem("ykk_settings") || "{}");
      const storedMethod = (savedSettings?.paymentMethods || []).find(m => String(m.key || "").trim() === String(metode || "").trim());
      return storedMethod?.label || "";
    } catch (_) {
      return "";
    }
  })();

  const metodeLabel = paymentMethods.find(m => String(m.key || "").trim() === String(metode || "").trim())?.label
    ?? savedSettingsLabel
    ?? globalThis.METODE_LABELS?.[metode]
    ?? metode.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  
  const trxId = generateTrxId();
  const trx = {
    id: trxId, ...t, items: withUnitLabel(items),
    subtotal, pajak: p, service: s, discount: d, total: tot,
    kdsSourceRef: String(billIdToClose || trxId),
    kdsTicketSent: kdsSettings.enabled || kdsSent,
    manualDiscountValue,
    manualDiscountType: effectiveManualDiscountType,
    metodeBayar: metode,
    metodeBayarLabel: metodeLabel, // NEW: store label in transaction
    bayar: metode === "cash" ? paidNum : tot,
    kembalian: metode === "cash" ? kembalian : 0,
    shiftId: activeShift?.id || null, shiftNum: activeShift?.shiftNum || null,
    operator: activeShift?.operator || "Kasir", // [2] nama pengguna yang login
    // Customer is DENORMALIZED (name/phone copied, not just id) so that the
    // receipt of an old transaction stays readable even after the customer
    // record is renamed or deleted.
    customerId: customer?.id || null,
    customerNama: customer?.name || "",
    customerTelepon: customer?.phone || "",
    ...(paxEnabled ? { pax: Math.max(1, Math.floor(Number(pax) || 1)) } : {}),
    ...(tableEnabled ? { tableNumber: String(tableNumber || "").trim() } : {}),
    ...receiptAdditionalData, // Include receipt additional fields
  };
  // Stok TIDAK dihitung di renderer (Langkah 2). Main process yang
  // menghitung & menulis delta di dalam SATU transaksi SQLite bersama
  // INSERT transaksi. Open bill: stok sudah dikurangi saat bill dibuat,
  // main process melewatkan deduksi ulang karena activeBillId dikirim.
  const result = await api.processPayment({ trx, activeBillId: billIdToClose });

  if (!result.ok) { toast_("Gagal menyimpan transaksi", "err"); return null; }

  if (kdsSettings.enabled) {
    await queueKdsTickets({
      items,
      prevItems: billIdToClose && kdsSent ? kdsPreviousItems : undefined,
      meta: {
        sourceRef: String(billIdToClose || trx.id),
        sourceLabel: billIdToClose ? `Bill #${billIdToClose}` : `Transaksi #${trx.id}`,
        clientTicketId: `${billIdToClose || trx.id}:${t.timestamp}`,
        createdAt: t.timestamp,
        tableLabel: trx.tableNumber ? `Meja ${trx.tableNumber}` : "",
        extras: receiptAdditionals.filter((field) => field.category === "receipt" && receiptAdditionalData[field.key]).map((field) => ({ label: field.label, value: receiptAdditionalData[field.key] })),
        createdByLabel: trx.operator,
      },
    });
  }

  if (result.stock && applyStockView) applyStockView(result.stock); // patch view setelah IPC sukses
  // Bahan baku: potong sesuai resep hanya untuk penjualan langsung (bukan
  // pelunasan open bill — stok bahan sudah dipotong saat bill dibuat).
  if (applyBahanUsage && !billIdToClose) applyBahanUsage(trx.items, -1);
  appendHistory(trx);          // setHistory(h=>[trx,...h])
  // Remove the paid bill from open bills using explicit billIdToClose
  removeBillLocal(billIdToClose);
  clearCart();
  if (onSuccess) onSuccess(trx);
  return trx;
}, [items, subtotal, pricingConfig, manualDiscount, manualDiscountValue, effectiveManualDiscountType, checkRequiredManualDiscount, metode, paidNum, kembalian, cart, toast_, getNow, clearCart, stockErrors, applyBahanUsage, pax, tableNumber, receiptAdditionals, kdsSettings.enabled, queueKdsTickets]);

  return {
    cart, drawerOpen, receiptAdditionalValues, receiptAdditionals, metode, paid, activeBill, pax, setPax, setPaxEnabled, setTableEnabled, tableNumber, setTableNumber, manualDiscountValue, setManualDiscountValue, kdsSettings, setKdsSettings,
    items, subtotal, pajak, service, discount, total, pricingConfig, manualDiscount, paidNum, kembalian, canPay,
    stockErrors,
    setDrawerOpen, updateReceiptAdditionalValue, setMetode, setPaid,
    addToCart, decCart, delCart, clearCart,
    setUnit, resolveLine,
    saveOpenBill, loadBillToCart, processPayment, checkRequiredAdditionals, checkRequiredManualDiscount, getCanPay,
    setReceiptAdditionals,
    setPricingConfig,
  };
}

export { useCart };