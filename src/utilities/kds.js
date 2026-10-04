import { KDS_KIND_LABEL } from "../../shared/kds-contract.js";

const clean = (value) => String(value ?? "").trim();

function itemKey(item) {
  return clean(item.cartKey || item.id) + "|" + clean(item.unit) + "|" + clean(item.kategori ?? item.categoryKey ?? item.category) + "|" + JSON.stringify(item.additionals || {}) + "|" + clean(item.catatan || item.note);
}

function unitLabel(item) {
  if (clean(item.unitLabel)) return clean(item.unitLabel);
  const unit = (item.units || []).find((entry) => clean(entry.key) === clean(item.unit));
  return clean(unit?.label || item.satuan);
}

function categoryLabel(key, categories) {
  const category = categories.find((entry) => clean(entry.key ?? entry.id) === clean(key));
  return clean(category?.label || category?.name) || "Lainnya";
}

function getStation(item, categories, stations, unmappedStationId) {
  const key = clean(item.kategori ?? item.categoryKey ?? item.category);
  const station = stations.find((entry) => (entry.categoryKeys || []).some((value) => clean(value) === key))
    || stations.find((entry) => clean(entry.id ?? entry.key) === clean(unmappedStationId));
  if (!station) return null;
  const stationId = station.id ?? station.key ?? null;
  return {
    id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean(stationId)) ? stationId : null,
    label: clean(station.label || station.name) || "Lainnya",
    categoryLabel: categoryLabel(key, categories),
  };
}

function ticketItem(item, qty) {
  return {
    label: clean(item.nama || item.name || item.label) || "Item",
    qty,
    unit_label: unitLabel(item),
    note: clean(item.catatan || item.note),
  };
}

export function buildKdsTickets({ items = [], prevItems, categories = [], stations = [], meta = {} } = {}) {
  const sourceRef = clean(meta.sourceRef);
  if (!sourceRef || !Array.isArray(items) || !Array.isArray(stations)) return [];
  const eventId = clean(meta.clientTicketId || meta.sequence || meta.createdAt);
  if (!eventId) return [];

  const changes = new Map();
  const collect = (rows, sign) => {
    for (const item of rows || []) {
      const qty = Math.abs(Number(item?.qty) || 0);
      if (!item || !qty) continue;
      const key = itemKey(item);
      const current = changes.get(key) || { item, qty: 0 };
      current.qty += sign * qty;
      if (sign > 0) current.item = item;
      changes.set(key, current);
    }
  };

  if (Array.isArray(prevItems)) collect(prevItems, -1);
  collect(items, 1);

  const grouped = new Map();
  for (const { item, qty: delta } of changes.values()) {
    if (!delta) continue;
    const station = getStation(item, categories, stations, meta.unmappedStationId);
    if (!station) continue;
    const kind = Array.isArray(prevItems) ? (delta > 0 ? "addition" : "cancel") : "order";
    const groupKey = `${String(station.id || "")}:${kind}`;
    const group = grouped.get(groupKey) || { station, kind, items: [] };
    group.items.push({ ...ticketItem(item, Math.abs(delta)), category_label: station.categoryLabel });
    grouped.set(groupKey, group);
  }

  const baseId = [clean(meta.deviceId), sourceRef, eventId].filter(Boolean).join(":");
  const createdAt = meta.createdAt || new Date().toISOString();
  return [...grouped.values()].map(({ station, kind, items: ticketItems }) => ({
    client_ticket_id: `${baseId}:${String(station.id || "other")}:${kind}`,
    kind,
    kind_label: KDS_KIND_LABEL[kind],
    source_ref: sourceRef,
    source_label: clean(meta.sourceLabel) || "Pesanan",
    station_id: station.id,
    station_label: station.label,
    table_label: clean(meta.tableLabel) || null,
    extras: Array.isArray(meta.extras) ? meta.extras : [],
    note: clean(meta.note),
    items: ticketItems,
    status: "new",
    created_by_label: clean(meta.createdByLabel) || null,
    device_label: clean(meta.deviceLabel) || null,
    created_at: createdAt,
  }));
}