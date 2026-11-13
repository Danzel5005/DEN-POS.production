import { describe, expect, it } from "vitest";
import { mergeOpenBillItems } from "./openBills.js";

describe("mergeOpenBillItems", () => {
  it("adds quantities for the same cart line and keeps different variants separate", () => {
    const merged = mergeOpenBillItems(
      [{ id: "coffee", cartKey: "coffee", nama: "Kopi", harga: 10, qty: 2 }],
      [
        { id: "coffee", cartKey: "coffee", nama: "Kopi", harga: 10, qty: 3 },
        { id: "coffee", cartKey: "coffee@large", unit: "large", nama: "Kopi", harga: 20, qty: 1 },
      ],
    );

    expect(merged).toHaveLength(2);
    expect(merged.find((item) => item.cartKey === "coffee").qty).toBe(5);
    expect(merged.find((item) => item.cartKey === "coffee@large").qty).toBe(1);
  });
});
