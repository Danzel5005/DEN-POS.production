import { describe, expect, it } from "vitest";
import { averageOrder, buildInsights, buildOmsetSummary, paymentMix, peakHours, topItems } from "./insights.js";

// Transaksi minimal dengan bentuk yang sama seperti dari useCart.processPayment.
const trx = (over = {}) => ({
  id: "T1",
  total: 20000,
  jam: "10",
  metodeBayar: "cash",
  items: [{ nama: "Kopi", qty: 1, harga: 20000 }],
  ...over,
});

describe("insights.peakHours", () => {
  it("buckets by hour and finds the busiest", () => {
    const data = [
      trx({ id: "a", jam: "10", total: 10000 }),
      trx({ id: "b", jam: "10", total: 15000 }),
      trx({ id: "c", jam: "19", total: 5000 }),
    ];
    const { buckets, busiest, hasData } = peakHours(data);
    expect(hasData).toBe(true);
    expect(buckets[10].count).toBe(2);
    expect(buckets[10].revenue).toBe(25000);
    expect(buckets[19].count).toBe(1);
    expect(busiest.hour).toBe(10);
  });

  it("excludes voided transactions", () => {
    const data = [
      trx({ id: "a", jam: "10" }),
      trx({ id: "b", jam: "10", status: "voided" }),
    ];
    const { buckets, busiest } = peakHours(data);
    expect(buckets[10].count).toBe(1);
    expect(busiest.count).toBe(1);
  });

  it("falls back to timestamp when jam is missing", () => {
    const iso = new Date(2026, 0, 1, 14, 30, 0).toISOString();
    const { buckets } = peakHours([trx({ id: "a", jam: undefined, timestamp: iso })]);
    expect(buckets[14].count).toBe(1);
  });

  it("reports no data on an empty list", () => {
    expect(peakHours([]).hasData).toBe(false);
    expect(peakHours([]).busiest).toBe(null);
  });
});

describe("insights.averageOrder", () => {
  it("computes count, revenue, and average", () => {
    const { count, revenue, average } = averageOrder([
      trx({ id: "a", total: 10000 }),
      trx({ id: "b", total: 30000 }),
    ]);
    expect(count).toBe(2);
    expect(revenue).toBe(40000);
    expect(average).toBe(20000);
  });

  it("ignores voided and returns zeroes when empty", () => {
    expect(averageOrder([trx({ status: "voided" })])).toEqual({ count: 0, revenue: 0, average: 0 });
    expect(averageOrder([])).toEqual({ count: 0, revenue: 0, average: 0 });
  });
});

describe("insights.paymentMix", () => {
  it("groups by method, sorted by revenue, using labelOf", () => {
    const mix = paymentMix(
      [
        trx({ id: "a", metodeBayar: "cash", total: 10000 }),
        trx({ id: "b", metodeBayar: "qris", total: 50000 }),
        trx({ id: "c", metodeBayar: "qris", total: 5000 }),
      ],
      (k) => (k === "cash" ? "Tunai" : "QRIS"),
    );
    expect(mix[0].key).toBe("qris");
    expect(mix[0].label).toBe("QRIS");
    expect(mix[0].count).toBe(2);
    expect(mix[1].key).toBe("cash");
  });
});

describe("insights.topItems", () => {
  it("ranks items by qty and respects the limit", () => {
    const data = [
      trx({ id: "a", items: [{ nama: "Kopi", qty: 3, harga: 10000 }, { nama: "Teh", qty: 1, harga: 5000 }] }),
      trx({ id: "b", items: [{ nama: "Kopi", qty: 2, harga: 10000 }] }),
    ];
    const top = topItems(data, 1);
    expect(top).toHaveLength(1);
    expect(top[0].nama).toBe("Kopi");
    expect(top[0].qty).toBe(5);
    expect(top[0].revenue).toBe(50000);
  });
});

describe("insights.buildInsights", () => {
  it("returns a full summary shape", () => {
    const result = buildInsights([trx()], { labelOf: () => "Tunai" });
    expect(result).toHaveProperty("hasData", true);
    expect(result.busiest.hour).toBe(10);
    expect(result.peak.busiest.hour).toBe(10);
    expect(result.average.count).toBe(1);
    expect(result.mix[0].label).toBe("Tunai");
    expect(result.top[0].nama).toBe("Kopi");
  });
});

describe("insights.buildOmsetSummary", () => {
  const labelOf = (key) => ({ cash: "Tunai", qris: "QRIS BCA", debit: "Debit" })[key] || key;

  it("groups used methods, sorts by amount, and totals pax", () => {
    const summary = buildOmsetSummary([
      trx({ id: "a", metodeBayar: "cash", total: 30000, subtotal: 30000, pax: 2 }),
      trx({ id: "b", metodeBayar: "qris", total: 50000, subtotal: 50000, pax: 3 }),
      trx({ id: "c", metodeBayar: "cash", total: 20000, subtotal: 20000, pax: 1 }),
    ], { labelOf });

    expect(summary.methods.map((method) => method.key)).toEqual(["qris", "cash"]);
    expect(summary.methods[0]).toMatchObject({ label: "QRIS BCA", amount: 50000, count: 1 });
    expect(summary.methods[1]).toMatchObject({ label: "Tunai", amount: 50000, count: 2 });
    expect(summary.total).toBe(100000);
    expect(summary.netSubtotal).toBe(100000);
    expect(summary.service).toBe(0);
    expect(summary.pajak).toBe(0);
    expect(summary.trxCount).toBe(3);
    expect(summary.pax).toBe(6);
    expect(summary.avgPerPax).toBeCloseTo(16666.6667);
    expect(summary.avgPerTrx).toBeCloseTo(33333.3333);
  });

  it("handles zero pax and empty transactions", () => {
    expect(buildOmsetSummary([], { labelOf })).toEqual({
      methods: [],
      total: 0,
      netSubtotal: 0,
      discount: 0,
      service: 0,
      pajak: 0,
      trxCount: 0,
      pax: 0,
      avgPerPax: 0,
      avgPerTrx: 0,
    });
    const summary = buildOmsetSummary([trx({ total: 25000, pax: undefined })], { labelOf });
    expect(summary.pax).toBe(0);
    expect(summary.avgPerPax).toBe(0);
  });

  it("excludes voided transactions and keeps method sum equal to total", () => {
    const summary = buildOmsetSummary([
      trx({ id: "a", metodeBayar: "cash", total: 40000, subtotal: 35000, discount: 5000, service: 1750, pajak: 3675, pax: 2 }),
      trx({ id: "b", metodeBayar: "qris", total: 90000, subtotal: 80000, discount: 10000, service: 4000, pajak: 8400, pax: 4, status: "voided" }),
    ], { labelOf });
    expect(summary.trxCount).toBe(1);
    expect(summary.methods.reduce((sum, method) => sum + method.amount, 0)).toBe(summary.total);
    expect(summary.netSubtotal).toBe(35000);
    expect(summary.discount).toBe(5000);
    expect(summary.service).toBe(1750);
    expect(summary.pajak).toBe(3675);
  });
});
