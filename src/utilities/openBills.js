import { linePricing } from "./units.js";

export function mergeOpenBillItems(existingItems = [], addedItems = []) {
  const merged = new Map();
  for (const item of existingItems) {
    const key = item.cartKey || String(item.id);
    merged.set(key, { ...item });
  }
  for (const item of addedItems) {
    const key = item.cartKey || String(item.id);
    const existing = merged.get(key);
    merged.set(key, existing
      ? { ...existing, ...item, cartKey: key, qty: Number(existing.qty || 0) + Number(item.qty || 0) }
      : { ...item, cartKey: key });
  }
  return [...merged.values()].map((item) => {
    const { harga, modal, tierHarga } = linePricing(item);
    return { ...item, harga, modal, tierHarga };
  });
}
