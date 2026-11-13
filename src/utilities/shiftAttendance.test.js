import { describe, expect, it, vi } from "vitest";
import { syncShiftAttendance } from "./shiftAttendance.js";

const shift = { id: "shift_1", shiftNum: 1, operator: "Kasir", startTime: "2026-11-08T00:00:00Z" };
const getPosition = vi.fn(async () => ({ coords: { latitude: -6, longitude: 106, accuracy: 10 } }));
const getDeviceStatus = vi.fn(async () => ({ identity: { registered: true } }));

describe("syncShiftAttendance", () => {
  it("allows local shift start when geolocation fails", async () => {
    const error = new Error("Network location provider returned HTTP 403");
    const result = await syncShiftAttendance(shift, {
      getDeviceStatus,
      getPosition: vi.fn().mockRejectedValue(error),
      exchange: vi.fn(),
    });

    expect(result).toEqual({ shift, error });
  });

  it("allows local shift start when cloud attendance sync fails", async () => {
    const result = await syncShiftAttendance(shift, {
      getDeviceStatus,
      getPosition,
      exchange: vi.fn().mockResolvedValue({ ok: false, error: "server unavailable" }),
    });

    expect(result.shift).toBe(shift);
    expect(result.error.message).toBe("server unavailable");
  });

  it("adds attendance metadata when cloud sync succeeds", async () => {
    const result = await syncShiftAttendance(shift, {
      getDeviceStatus,
      getPosition,
      exchange: vi.fn().mockResolvedValue({ ok: true, data: { shiftId: "attendance_1", radiusM: 30 } }),
    });

    expect(result).toEqual({
      shift: { ...shift, attendanceShiftId: "attendance_1", attendanceRadiusM: 30 },
      error: null,
    });
  });
});
