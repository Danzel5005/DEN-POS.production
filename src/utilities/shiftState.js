function resolveShiftTarget({ shifts = [], activeShift = null, selectedShiftId = null }) {
  const persistedOpen = (shifts || []).find((shift) => shift && shift.status === "open");
  const preferred = persistedOpen || activeShift || null;
  const targetShiftId = preferred?.id || selectedShiftId;

  if (!targetShiftId) return null;

  const found = (shifts || []).find((shift) => shift && shift.id === targetShiftId) || preferred;
  return found || null;
}

// nextShiftNum — nomor shift berjalan GLOBAL, bukan per hari.
// Shift pertama yang pernah dibuat = 1. Membuka shift baru di hari berikutnya
// melanjutkan nomor sebelumnya (mis. jadi 2), bukan kembali ke 1.
// Diambil dari shiftNum tertinggi yang sudah ada, lalu ditambah 1, supaya tetap
// benar walau ada data lama / shift dihapus (tidak bisa menurunkan nomor).
function nextShiftNum(shifts = []) {
  const max = (shifts || []).reduce((acc, shift) => {
    const n = Number(shift?.shiftNum);
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);
  return max + 1;
}

function compareShiftsActiveFirst(a, b) {
  const activeOrder = Number(b?.status === "open") - Number(a?.status === "open");
  return activeOrder || Number(b?.shiftNum || 0) - Number(a?.shiftNum || 0);
}

function sortShiftsActiveFirst(shifts = []) {
  return [...shifts].sort(compareShiftsActiveFirst);
}

export { resolveShiftTarget, nextShiftNum, compareShiftsActiveFirst, sortShiftsActiveFirst };
