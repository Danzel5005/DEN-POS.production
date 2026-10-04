import { describe, expect, it } from "vitest";
import { KDS_STATUS_LABEL } from "../../shared/kds-contract.js";
import { buildKdsTickets } from "./kds.js";

const categories = [{ key: "cat_coffee", label: "Minuman" }];
const stations = [{ id: "station_bar", label: "Bar", categoryKeys: ["cat_coffee"] }];
const meta = {
  clientTicketId: "dev_a:bill_4:save_1",
  sourceRef: "bill_4",
  sourceLabel: "Bill #4",
  tableLabel: "Meja 5",
  createdByLabel: "Ayu",
  deviceLabel: "Kasir depan",
  createdAt: "2026-10-04T10:00:00.000Z",
};

describe("buildKdsTickets", () => {
  it("snapshots labels and routes only categories mapped to a station", () => {
    const tickets = buildKdsTickets({
      items: [
        { id: "kopi_susu", nama: "Es Kopi Susu", kategori: "cat_coffee", qty: 2, unit: "cup", unitLabel: "cup" },
        { id: "snack", nama: "Keripik", kategori: "cat_snack", qty: 1 },
      ],
      categories,
      stations,
      meta,
    });

    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ kind_label: "Pesanan Baru", station_label: "Bar", source_label: "Bill #4", table_label: "Meja 5" });
    expect(tickets[0].items).toEqual([{ label: "Es Kopi Susu", category_label: "Minuman", qty: 2, unit_label: "cup", note: "" }]);
    expect([tickets[0].kind_label, tickets[0].source_label, tickets[0].station_label, tickets[0].items[0].category_label]).not.toContain("cat_coffee");
    expect([tickets[0].station_label, tickets[0].items[0].category_label]).not.toContain("station_bar");
  });

  it("creates addition and cancellation deltas for changed open bills", () => {
    const before = [{ id: "kopi_susu", nama: "Es Kopi Susu", kategori: "cat_coffee", qty: 3 }];
    const after = [{ ...before[0], qty: 1 }, { id: "teh", nama: "Teh", kategori: "cat_coffee", qty: 2 }];
    const tickets = buildKdsTickets({ items: after, prevItems: before, categories, stations, meta });

    expect(tickets.map((ticket) => [ticket.kind, ticket.items[0].label, ticket.items[0].qty])).toEqual([
      ["cancel", "Es Kopi Susu", 2],
      ["addition", "Teh", 2],
    ]);
  });

  it("uses the configured station for unmapped categories and a human fallback", () => {
    const tickets = buildKdsTickets({
      items: [{ id: "tea", nama: "Teh", kategori: "unknown_category", qty: 1 }],
      categories,
      stations: [...stations, { id: "station_other", label: "", categoryKeys: [] }],
      meta: { ...meta, unmappedStationId: "station_other" },
    });
    expect(tickets[0].station_label).toBe("Lainnya");
  });

  it("does not create a retry-unsafe ticket without a stable event identity", () => {
    const tickets = buildKdsTickets({
      items: [{ id: "kopi", nama: "Kopi", kategori: "cat_coffee", qty: 1 }],
      categories,
      stations,
      meta: { sourceRef: "bill_4" },
    });
    expect(tickets).toEqual([]);
  });

  it("uses one display-label map for statuses and does not emit raw status keys", () => {
    expect(KDS_STATUS_LABEL).toEqual({ new: "Baru", preparing: "Diproses", ready: "Siap", served: "Diantar", cancelled: "Batal" });
    expect(Object.values(KDS_STATUS_LABEL)).not.toContain("new");
  });
});