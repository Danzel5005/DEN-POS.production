function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function appliesToItem(rule, item) {
  if (rule.scope === "global") return true;
  if (rule.scope === "category") return String(rule.target || "") === String(item.kategori || "");
  return String(rule.target || "") === String(item.id || "");
}

function calculateDiscountedSubtotal(items, discounts) {
  const prices = items.map(item => asNumber(item.harga) * asNumber(item.qty));
  for (const rule of discounts) {
    if (rule.enabled === false) continue;
    const indexes = items
      .map((item, index) => appliesToItem(rule, item) && asNumber(item.qty) >= asNumber(rule.minQty) ? index : -1)
      .filter(index => index >= 0);
    if (!rule.perChunk) {
      if (rule.type === "fixed") {
        const matchingTotal = indexes.reduce((sum, index) => sum + prices[index], 0);
        const reduction = Math.min(matchingTotal, Math.max(0, asNumber(rule.value)));
        if (matchingTotal > 0) {
          indexes.forEach(index => { prices[index] -= reduction * prices[index] / matchingTotal; });
        }
      } else {
        const rate = Math.min(Math.max(0, asNumber(rule.value)), 100) / 100;
        indexes.forEach(index => { prices[index] *= 1 - rate; });
      }
      continue;
    }
    items.forEach((item, index) => {
      const quantity = asNumber(item.qty);
      if (!appliesToItem(rule, item) || quantity < asNumber(rule.minQty)) return;
      const chunkQty = Math.max(1, asNumber(rule.chunkQty));
      const discountedQuantity = rule.perChunk
        ? Math.floor(quantity / chunkQty) * chunkQty
        : quantity;
      const eligibleRatio = quantity > 0 ? discountedQuantity / quantity : 0;
      const eligiblePrice = prices[index] * eligibleRatio;
      const value = Math.max(0, asNumber(rule.value));
      const reduction = rule.type === "fixed"
        ? Math.min(eligiblePrice, value * (rule.perChunk ? Math.floor(quantity / chunkQty) : 1))
        : eligiblePrice * Math.min(value, 100) / 100;
      prices[index] -= reduction;
    });
  }
  return prices.reduce((sum, price) => sum + price, 0);
}

function calcPrice(subtotal, options = {}) {
  const items = Array.isArray(options.items) ? options.items : null;
  const discounts = Array.isArray(options.discounts) ? options.discounts : [];
  const itemSubtotal = items
    ? items.reduce((sum, item) => sum + asNumber(item.harga) * asNumber(item.qty), 0)
    : asNumber(subtotal);
  const hasManualDiscount = options.manualDiscount?.value !== undefined
    && options.manualDiscount?.value !== null
    && String(options.manualDiscount.value).trim() !== "";
  const manualDiscountValue = Math.max(0, asNumber(options.manualDiscount?.value));
  const manualDiscountAmount = hasManualDiscount
    ? Math.min(Math.max(0, itemSubtotal), options.manualDiscount?.type === "percentage"
      ? itemSubtotal * Math.min(manualDiscountValue, 100) / 100
      : manualDiscountValue)
    : null;
  const discountedSubtotal = hasManualDiscount
    ? itemSubtotal - manualDiscountAmount
    : items
    ? calculateDiscountedSubtotal(items, discounts)
    : calculateDiscountedSubtotal([{ id: "", kategori: "", harga: itemSubtotal, qty: 1 }], discounts);
  const discount = hasManualDiscount ? manualDiscountAmount : Math.max(0, itemSubtotal - discountedSubtotal);

  let base = discountedSubtotal;
  const pajakRate = options.pajak?.enabled === false ? 0 : asNumber(options.pajak?.value);
  const serviceRate = options.service?.enabled === false ? 0 : asNumber(options.service?.value);
  const pajak = base * Math.max(0, pajakRate) / 100;
  base += pajak;
  const service = base * Math.max(0, serviceRate) / 100;
  base += service;

  return {
    pajak: pajak > 0 ? Math.ceil(pajak) : 0,
    service: service > 0 ? Math.ceil(service) : 0,
    discount: Math.ceil(discount),
    discountedSubtotal: Math.ceil(discountedSubtotal),
    total: Math.ceil(base),
  };
}


export {calcPrice};