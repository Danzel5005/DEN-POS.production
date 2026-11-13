import { describe, expect, it } from "vitest";
import { sortShiftsActiveFirst } from "./shiftState.js";

describe("sortShiftsActiveFirst", () => {
  it("places the active shift first, then sorts closed shifts newest to oldest", () => {
    const shifts = [
      { id: "old", shiftNum: 2, status: "closed" },
      { id: "active", shiftNum: 1, status: "open" },
      { id: "new", shiftNum: 9, status: "closed" },
    ];

    expect(sortShiftsActiveFirst(shifts).map((shift) => shift.id)).toEqual(["active", "new", "old"]);
    expect(shifts[0].id).toBe("old");
  });
});
