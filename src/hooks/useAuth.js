import { useState, useCallback } from "react";
import { DEFAULT_USERS, isAdminUser } from "../utilities/users.js";
import { LS, api } from "../utilities/utils.js";
import { nextShiftNum } from "../utilities/shiftState.js";

// SESSION_KEY — menyimpan identitas user yang sedang login (hanya username).
//
// PENTING: `currentUser` sebelumnya hanya hidup di React state. Saat renderer
// reload (dev restart / HMR / relaunch), `activeShift` ter-restore dari
// shifts.json TAPI `currentUser` kembali null — sehingga app masuk ke UI kasir
// dengan currentUser null, dan isAdmin(null) === false. Akibatnya admin
// kehilangan seluruh hak admin ("sama seperti non-admin") sampai login ulang.
//
// Kita simpan hanya USERNAME (bukan objek user / password) supaya password
// tidak pernah ditulis ke storage. Role SELALU di-resolve ulang dari daftar
// users terbaru saat restore — jadi akun yang dihapus/diturunkan haknya tidak
// bisa "hidup kembali" sebagai admin dari sesi lama.
const SESSION_KEY = "ykk_session_user";

// resolveSessionUser — keputusan murni: user mana (kalau ada) yang boleh
// dipulihkan sebagai sesi login.
//
// Diekspor agar bisa diuji tanpa me-render hook (env test = node).
// Aturan:
//  - tanpa shift terbuka  -> null (sesi memang berakhir saat shift ditutup)
//  - shift terbuka        -> user harus SUDAH ADA di daftar users terbaru
//                            (akun dihapus / diganti tidak terpulihkan)
export function resolveSessionUser({ hasOpenShift, sessionUsername, users }) {
  if (!hasOpenShift || !sessionUsername) return null;
  return (users || []).find(u => u.username === sessionUsername) || null;
}

// useAuth — login & shift lifecycle.
// Constraint: tidak import useBills/useCart langsung. Saat shift ditutup,
// cart dikosongkan lewat clearCart (dipanggil App.jsx), BUKAN import langsung.
// PENTING: open bill TIDAK PERNAH dihapus otomatis saat tutup shift — hanya
// dihapus jika user sudah membayar (processPayment -> removeBillLocal).
//

function useAuth({ getNow, toast_ }) {
  const [activeShift, setActiveShift] = useState(null);
  const [shifts, setShifts]           = useState([]);
  const [loginForm, setLoginForm]     = useState({ username: "", password: "", error: "" });
  const [closingShift, setClosingShift] = useState(false);
  const [selectedShiftId, setSelectedShiftId] = useState(null); // null = aktif
  const [users, setUsers]             = useState([]); // dynamic users from storage
  const [currentUser, setCurrentUser] = useState(null); // logged-in user object

  // deps kosong aman: hanya setter, tidak baca state apapun.
  const loadInitial = useCallback((savedShifts, savedUsers) => {
    const allShifts = savedShifts || [];
    setShifts(allShifts);
    const openShift = allShifts.find(s => s.status === "open");
    if (openShift) {
      setActiveShift(openShift);
      setSelectedShiftId(openShift.id);
    }
    // Load users: jika storage kosong, pakai default
    const userList = savedUsers && savedUsers.length ? savedUsers : DEFAULT_USERS;
    setUsers(userList);
    // First-run: tulis user default (dengan password TER-HASH) ke storage lewat
    // main process. Tanpa ini, store tetap kosong dan hash baru dibuat saat login.
    if (!savedUsers || !savedUsers.length) {
      Promise.all(DEFAULT_USERS.map((user) => api.authCreateUser({ user }))).catch(() => { /* lazy-migration saat login tetap jadi fallback */ });
    }

    // Restore sesi login. Hanya dipulihkan bila shift masih terbuka — kalau
    // shift sudah ditutup, user memang diminta login lagi (lihat showLoginScreen
    // di App.jsx). Role/identitas di-resolve ulang dari userList terbaru, jadi
    // akun yang sudah dihapus atau bukan admin lagi tidak ikut terpulihkan.
    if (openShift) {
      const restored = resolveSessionUser({
        hasOpenShift: true,
        sessionUsername: LS(SESSION_KEY),
        users: userList,
      });
      if (restored) {
        setCurrentUser(restored);
      } else {
        // Sesi lama tidak valid (akun dihapus / storage dibersihkan).
        LS(SESSION_KEY, null);
      }
    }
  }, []);

  // PENTING: membaca loginForm, shifts, dan getNow LANGSUNG dari closure.
  // Verifikasi password sekarang dilakukan di MAIN PROCESS (scrypt hash);
  // renderer tidak lagi membandingkan password mentah.
  const doLogin = useCallback(async (beforeOpenShift) => {
    const result = await api.authLogin({ username: loginForm.username, password: loginForm.password });
    if (!result?.ok || !result.user) {
      setLoginForm(f => ({ ...f, error: "Username atau password salah" }));
      return false;
    }
    const u = result.user;
    // Migrasi lazy: password lama (plaintext) baru di-hash setelah login sukses,
    // jadi daftar `users` di state perlu disegarkan agar tidak menyimpan nilai basi.
    if (result.migrated) {
      try {
        const fresh = await api.loadUsers();
        if (Array.isArray(fresh)) setUsers(fresh);
      } catch { /* tidak fatal: verifikasi berikutnya tetap lewat main process */ }
    }
    const t = getNow();
    const todayKey = `${t.tgl}-${t.blnNum}-${t.thn}`;
    // Nomor shift berjalan GLOBAL (lanjut antar hari), bukan per hari.
    const shiftNum = nextShiftNum(shifts);
    const shift = {
      id: `shift_${Date.now()}`,
      shiftNum,
      dateKey: todayKey,
      hari: t.hari, tgl: t.tgl, bln: t.bln, blnNum: t.blnNum, thn: t.thn,
      startTime: t.timestamp,
      startJam: `${t.jam}:${t.mnt}`,
      endTime: null,
      endJam: null,
      operator: u.nama,
      username: u.username,
      status: "open",
      openingCash: 0,
      expenses: [],
    };
    const preparedShift = typeof beforeOpenShift === "function" ? await beforeOpenShift(shift) : shift;
    if (!preparedShift) return false;
    const next = [...shifts, preparedShift];
    await api.saveShifts(next);
    setShifts(next);
    setActiveShift(preparedShift);
    setSelectedShiftId(preparedShift.id);
    // Simpan user yang login saat ini (untuk cek hak admin saat kelola pengguna)
    setCurrentUser(u);
    // Persist identitas sesi supaya hak admin tetap ada setelah reload/restart.
    LS(SESSION_KEY, u.username);
    setLoginForm({ username: "", password: "", error: "" });
    return true;
  }, [loginForm, shifts, getNow]);

  const updateShift = useCallback(async (shiftId, patch, sourceShifts = shifts) => {
    if (!shiftId) return false;

    const source = Array.isArray(sourceShifts) ? sourceShifts : [];
    const next = source.map(s => s.id === shiftId ? { ...s, ...patch } : s);
    const updatedShift = next.find(s => s.id === shiftId) || (activeShift && activeShift.id === shiftId ? { ...activeShift, ...patch } : null);
    if (!updatedShift) return false;

    const result = await api.saveShifts(next);
    if (result?.ok === false) return false;
    setShifts(next);
    setActiveShift(updatedShift);
    setSelectedShiftId(shiftId);
    return true;
  }, [activeShift, shifts]);

  // onShiftClosed: {clearCart} — dipass dari App.jsx SAAT DIPANGGIL
  // (argumen panggilan, bukan closure dependency), jadi TIDAK masuk deps array.
  // PENTING: membaca activeShift dan shifts LANGSUNG dari closure. Wajib
  // [activeShift, shifts, getNow, toast_] di deps.
  // CATATAN: clearBills DIHAPUS — open bill TIDAK PERNAH dihapus otomatis saat tutup shift.
  // Open bill hanya dihapus jika user sudah membayar/bayar (proses payment).
  const confirmCloseShift = useCallback(async ({ clearCart }) => {
    const t = getNow();
    const closed = { ...activeShift, endTime: t.timestamp, endJam: `${t.jam}:${t.mnt}`, status: "closed" };
    const next = shifts.map(s => s.id === closed.id ? closed : s);
    await api.saveShifts(next);
    setShifts(next);
    setActiveShift(null);
    setClosingShift(false);
    setSelectedShiftId(null);
    // Shift ditutup = sesi berakhir. Bersihkan currentUser + session tersimpan
    // supaya user harus login lagi (dan tidak "bangun" sebagai admin lama).
    setCurrentUser(null);
    LS(SESSION_KEY, null);
    await api.authSessionClear?.();
    // HAPUS: clearBills() — open bill TIDAK dihapus otomatis
    // Open bill hanya dihapus melalui proses bayar (processPayment) yang memanggil removeBillLocal
    clearCart();
    toast_(`Shift ${closed.shiftNum} ditutup — ${closed.startJam} s/d ${closed.endJam}`, "ok");
  }, [activeShift, shifts, getNow, toast_]);

  // ── User management (admin only) ──
  // PENTING: membaca users LANGSUNG dari closure. Wajib [users, toast_] di deps.
  const addUser = useCallback(async ({ username, password, nama }) => {
    if (!isAdminUser(currentUser)) {
      toast_("Hanya admin yang dapat menambah pengguna", "err");
      return false;
    }
    if (users.find(u => u.username === username.trim())) {
      toast_("Username sudah terdaftar", "err");
      return false;
    }
    const newUser = { username: username.trim(), password, nama: nama.trim(), role: "cashier" };
    // Password di-hash di main process — JANGAN tulis password mentah ke store.
    const result = await api.authCreateUser({ user: newUser });
    if (result?.ok === false) {
      toast_("Gagal menambah pengguna", "err");
      return false;
    }
    // Simpan salinan tanpa password di state renderer (state hanya untuk tampilan).
    const { password: _pw, ...safeUser } = newUser;
    const next = [...users, safeUser];
    setUsers(next);
    toast_(`Pengguna "${nama}" ditambahkan`, "ok");
    return true;
  }, [users, currentUser, toast_]);

  // PENTING: membaca users & currentUser LANGSUNG dari closure. Wajib [users, currentUser, toast_] di deps.
  const deleteUser = useCallback(async (username) => {
    // Hanya admin yang boleh hapus pengguna.
    if (!isAdminUser(currentUser)) {
      toast_("Hanya admin yang dapat menghapus pengguna", "err");
      return;
    }
    // Cegah hapus admin utama
    if (username === "admin") {
      toast_("Tidak dapat menghapus pengguna utama", "err");
      return;
    }
    // Admin tidak bisa hapus dirinya sendiri
    if (currentUser && currentUser.username === username) {
      toast_("Tidak dapat menghapus akun sendiri", "err");
      return;
    }
    const next = users.filter(u => u.username !== username);
    await api.saveUsers(next);
    setUsers(next);
    toast_(`Pengguna "${username}" dihapus`, "ok");
  }, [users, currentUser, toast_]);

  const changePassword = useCallback(async (username, newPassword) => {
    if (!isAdminUser(currentUser)) {
      toast_("Hanya admin yang dapat mengubah password", "err");
      return false;
    }
    const targetUsername = String(username || "").trim();
    const password = String(newPassword || "").trim();
    // Admin hanya boleh mengubah password akun LAIN (non-admin) dari daftar
    // pengguna. Untuk akun sendiri, gunakan fitur "Ganti Password Saya" yang
    // mewajibkan verifikasi password saat ini.
    if (currentUser && targetUsername === currentUser.username) {
      toast_('Gunakan fitur "Ganti Password Saya" untuk mengubah password akun Anda', "err");
      return false;
    }
    if (!targetUsername || password.length < 4) {
      toast_("Password minimal 4 karakter", "err");
      return false;
    }
    if (!users.some((user) => user.username === targetUsername)) {
      toast_("Akun tidak ditemukan", "err");
      return false;
    }
    // Jangan gunakan jalur ini untuk menyetel ulang password admin.
    const targetUser = users.find((user) => user.username === targetUsername);
    if (isAdminUser(targetUser)) {
      toast_("Password akun admin tidak dapat diubah dari daftar pengguna", "err");
      return false;
    }
    // Password di-hash di main process; state renderer tidak menyimpan password.
    const result = await api.authSetPassword({ username: targetUsername, newPassword: password });
    if (result?.ok === false) {
      toast_("Gagal mengubah password", "err");
      return false;
    }
    toast_(`Password akun "${targetUsername}" berhasil diubah`, "ok");
    return true;
  }, [currentUser, users, toast_]);

  const changeOwnPassword = useCallback(async (currentPassword, newPassword, confirmation) => {
    if (!currentUser) return false;
    const password = String(newPassword || "").trim();
    if (password.length < 4) {
      toast_("Password minimal 4 karakter", "err");
      return false;
    }
    if (password !== String(confirmation || "")) {
      toast_("Konfirmasi password tidak sama", "err");
      return false;
    }
    // Verifikasi password lama + penulisan hash keduanya di main process.
    const result = await api.authChangePassword({
      username: currentUser.username,
      oldPassword: String(currentPassword || ""),
      newPassword: password,
    });
    if (result?.ok === false) {
      toast_(result.reason === "wrong-password" ? "Password saat ini salah" : "Gagal mengubah password", "err");
      return false;
    }
    toast_("Password Anda berhasil diubah", "ok");
    return true;
  }, [currentUser, users, toast_]);

  return {
    activeShift, shifts, loginForm, closingShift, selectedShiftId, users, currentUser,
    setLoginForm, setClosingShift, setSelectedShiftId,
    loadInitial, doLogin, updateShift, confirmCloseShift,
    addUser, deleteUser, changePassword, changeOwnPassword,
  };
}

export { useAuth };
