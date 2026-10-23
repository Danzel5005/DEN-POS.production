const { hashPassword, verifyPasswordWithLegacy, isHashed } = require("./auth.cjs");

// Handler autentikasi dipisah dari main.cjs supaya bisa diuji tanpa Electron.
// `ipcMain` cukup punya `.handle(name, fn)`; `store` butuh `read()`/`write(list)`.
function registerAuthHandlers({ ipcMain, store, onAuthenticatedUser = () => {}, onSessionClear = () => {} }) {
  // Login: verifikasi password. Bila user masih memakai plaintext lama (data
  // sebelum hashing) dan login SUKSES, langsung di-upgrade ke hash scrypt.
  ipcMain.handle("auth-login", (_e, { username, password } = {}) => {
    const uname = String(username ?? "").trim();
    if (!uname || typeof password !== "string") return { ok: false, reason: "invalid" };

    const users = store.read();
    const index = users.findIndex((u) => String(u?.username ?? "").trim() === uname);
    if (index < 0) return { ok: false, reason: "not-found" };

    const user = users[index];
    if (!verifyPasswordWithLegacy(password, user.password)) return { ok: false, reason: "wrong-password" };

    let migrated = false;
    if (!isHashed(user.password)) {
      users[index] = { ...user, password: hashPassword(password) };
      store.write(users);
      migrated = true;
      console.log(`[Auth] Password pengguna "${uname}" di-upgrade ke hash scrypt`);
    }

    const { password: _pw, ...safeUser } = users[index];
    onAuthenticatedUser(safeUser);
    return { ok: true, user: safeUser, migrated };
  });

  ipcMain.handle("auth-session-clear", () => { onSessionClear(); return { ok: true }; });

  // Set / ubah password: selalu disimpan dalam bentuk hash.
  ipcMain.handle("auth-set-password", (_e, { username, newPassword } = {}) => {
    const uname = String(username ?? "").trim();
    if (!uname || typeof newPassword !== "string" || newPassword.length === 0) {
      return { ok: false, reason: "invalid" };
    }

    const users = store.read();
    const index = users.findIndex((u) => String(u?.username ?? "").trim() === uname);
    if (index < 0) return { ok: false, reason: "not-found" };

    users[index] = { ...users[index], password: hashPassword(newPassword) };
    store.write(users);
    return { ok: true };
  });

  // Ganti password milik sendiri: butuh password lama yang benar.
  ipcMain.handle("auth-change-own-password", (_e, { username, oldPassword, newPassword } = {}) => {
    const uname = String(username ?? "").trim();
    if (!uname || typeof oldPassword !== "string" || typeof newPassword !== "string" || newPassword.length === 0) {
      return { ok: false, reason: "invalid" };
    }

    const users = store.read();
    const index = users.findIndex((u) => String(u?.username ?? "").trim() === uname);
    if (index < 0) return { ok: false, reason: "not-found" };
    if (!verifyPasswordWithLegacy(oldPassword, users[index].password)) return { ok: false, reason: "wrong-password" };

    users[index] = { ...users[index], password: hashPassword(newPassword) };
    store.write(users);
    return { ok: true };
  });

  // Buat user baru / timpa password secara paksa (dipakai admin menambah user).
  ipcMain.handle("auth-create-user", (_e, { user } = {}) => {
    if (!user || typeof user !== "object" || !user.username) return { ok: false, reason: "invalid" };
    if (typeof user.password !== "string" || user.password.length === 0) return { ok: false, reason: "invalid" };

    const users = store.read();
    const uname = String(user.username).trim();
    if (users.some((u) => String(u?.username ?? "").trim() === uname)) return { ok: false, reason: "duplicate" };

    const next = [...users, { ...user, username: uname, password: hashPassword(user.password) }];
    store.write(next);
    return { ok: true };
  });
}

module.exports = { registerAuthHandlers };
