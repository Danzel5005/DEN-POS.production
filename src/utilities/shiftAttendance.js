export async function syncShiftAttendance(shift, { getDeviceStatus, getPosition, exchange }) {
  try {
    const status = await getDeviceStatus();
    if (!status?.identity?.registered) return { shift, error: null };

    const position = await getPosition();
    const result = await exchange({
      action: "shift-open",
      shift: {
        id: shift.id,
        shiftNum: shift.shiftNum,
        operator: shift.operator,
        openedAt: shift.startTime,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      },
    });
    if (!result?.ok) throw new Error(result?.error || "Presensi Web-App gagal disinkronkan.");

    return {
      shift: { ...shift, attendanceShiftId: result.data?.shiftId, attendanceRadiusM: result.data?.radiusM },
      error: null,
    };
  } catch (error) {
    return { shift, error };
  }
}
