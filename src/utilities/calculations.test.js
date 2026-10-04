import { describe, it, expect } from "vitest";
import { calcPrice } from "./calculations.js";

describe("calculations.js - calcPrice", () => {
  describe("Basic Calculation (no tax, no service)", () => {
    it("should return subtotal as total when no tax/service", () => {
      const res = calcPrice(100000);
      expect(res).toEqual({
        service: 0,
        pajak: 0,
        discount: 0,
        discountedSubtotal: 100000,
        total: 100000,
      });
    });

    it("should handle subtotal of 0", () => {
      const res = calcPrice(0);
      expect(res).toEqual({
        service: 0,
        pajak: 0,
        discount: 0,
        discountedSubtotal: 0,
        total: 0,
      });
    });

    it("should round up total using Math.ceil", () => {
      const res = calcPrice(150.5);
      expect(res).toEqual({
        service: 0,
        pajak: 0,
        discount: 0,
        discountedSubtotal: 151,
        total: 151,
      });
    });

    it("should handle typical coffee order amounts", () => {
      const res = calcPrice(35000);
      expect(res.service).toBe(0);
      expect(res.pajak).toBe(0);
      expect(res.discount).toBe(0);
      expect(res.total).toBe(35000);
    });
  });

  describe("Edge Cases", () => {
    it("should handle large total amounts without losing precision", () => {
      const res = calcPrice(1_000_000_000);
      expect(res.service).toBe(0);
      expect(res.pajak).toBe(0);
      expect(res.discount).toBe(0);
      expect(res.total).toBe(1_000_000_000);
    });

    it("should handle floating point subtotal inputs", () => {
      const res = calcPrice(100.55);
      expect(Number.isInteger(res.service)).toBe(true);
      expect(Number.isInteger(res.pajak)).toBe(true);
      expect(Number.isInteger(res.discount)).toBe(true);
      expect(Number.isInteger(res.total)).toBe(true);
    });
  });

  describe("Negative Cases & Defensive Behavior", () => {
    it("should handle negative subtotal predictably", () => {
      const res = calcPrice(-10000);
      expect(res.service).toBe(0);
      expect(res.pajak).toBe(0);
      expect(res.total).toBe(-10000);
    });
  });

  it("compounds percentage discounts and applies quantity conditions", () => {
    const res = calcPrice(0, {
      items: [{ id: "coffee", kategori: "drink", harga: 100000, qty: 5 }],
      discounts: [
        { type: "percentage", value: 10, scope: "global" },
        { type: "percentage", value: 5, scope: "item", target: "coffee", minQty: 5 },
      ],
    });
    expect(res.discountedSubtotal).toBe(427500);
    expect(res.discount).toBe(72500);
    expect(res.total).toBe(427500);
  });

  it("applies fixed discounts and compounds tax then service", () => {
    const res = calcPrice(0, {
      items: [{ id: "tea", kategori: "drink", harga: 10000, qty: 2 }],
      discounts: [{ type: "fixed", value: 5000, scope: "category", target: "drink" }],
      pajak: { enabled: true, value: 10 },
      service: { enabled: true, value: 5 },
    });
    expect(res.discount).toBe(5000);
    expect(res.pajak).toBe(1500);
    expect(res.service).toBe(825);
    expect(res.total).toBe(17325);
  });

  it("applies one fixed global discount to the whole cart", () => {
    const res = calcPrice(0, {
      items: [
        { id: "a", harga: 10000, qty: 1 },
        { id: "b", harga: 20000, qty: 1 },
      ],
      discounts: [{ type: "fixed", value: 5000, scope: "global" }],
    });
    expect(res.discount).toBe(5000);
    expect(res.total).toBe(25000);
  });

  it("applies percentage discount to each complete quantity chunk", () => {
    const res = calcPrice(0, {
      items: [{ id: "rice", harga: 2000, qty: 10 }],
      discounts: [{ type: "percentage", value: 5, scope: "item", target: "rice", minQty: 5, perChunk: true, chunkQty: 5 }],
    });
    expect(res.discount).toBe(1000);
    expect(res.total).toBe(19000);
  });

  it("does not discount an incomplete quantity chunk", () => {
    const res = calcPrice(0, {
      items: [{ id: "rice", harga: 2000, qty: 7 }],
      discounts: [{ type: "percentage", value: 5, scope: "item", target: "rice", minQty: 5, perChunk: true, chunkQty: 5 }],
    });
    expect(res.discount).toBe(500);
    expect(res.total).toBe(13500);
  });

  it("manual percentage discount replaces configured discounts before tax and service", () => {
    const res = calcPrice(0, {
      items: [{ id: "coffee", harga: 100000, qty: 1 }],
      discounts: [{ type: "fixed", value: 50000, scope: "global" }],
      manualDiscount: { type: "percentage", value: 10 },
      pajak: { enabled: true, value: 10 },
      service: { enabled: true, value: 5 },
    });
    expect(res.discount).toBe(10000);
    expect(res.pajak).toBe(9000);
    expect(res.service).toBe(4950);
    expect(res.total).toBe(103950);
  });

  it("caps manual nominal discount at subtotal and falls back to configured rules when blank", () => {
    const options = {
      items: [{ id: "tea", harga: 10000, qty: 1 }],
      discounts: [{ type: "percentage", value: 10, scope: "global" }],
    };
    expect(calcPrice(0, { ...options, manualDiscount: { type: "fixed", value: 20000 } }).total).toBe(0);
    expect(calcPrice(0, { ...options, manualDiscount: { type: "fixed", value: "" } }).total).toBe(9000);
  });
});
