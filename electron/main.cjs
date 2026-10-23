let currentSoftwareUser = null;
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { createLicenseService, getHardwareId } = require("./license.cjs");
const { createBackupService } = require("./backup.cjs");
const { createBackupRestoreService } = require("./backup-restore.cjs");
const { createDatabaseService } = require("./db.cjs");
const { createPrintingService } = require("./printing.cjs");
const { registerAuthHandlers } = require("./auth-ipc.cjs");
const { checkForUpdate } = require("./update-check.cjs");
const { createDeviceIdentity } = require("./device-identity.cjs");
const { createDeviceSyncService } = require("./device-sync-service.cjs");

let NodePrinterDriver = null;
try { NodePrinterDriver = require("electron-printer"); }
catch (err) { console.warn("[Main] electron-printer unavailable; continuing without legacy native printer driver:", err.message); }

// ── Single-instance guard ───────────────────────────────────────────────────
// A stale Electron left behind by Ctrl-C still holds Chromium's singleton lock
// on userData. Without this, a second launch crashes at the C++ level with
// exit code 1 and prints NOTHING (no [Main] logs), which looks like a broken
// app. With the lock, the second instance exits cleanly and focuses the first.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log("[Main] Another instance is already running — focusing it and exiting.");
  // app.quit() is asynchronous; without exiting here the rest of this module
  // would still run (open the DB, create a second window) before the quit
  // lands. Exit immediately instead — a second instance must do nothing.
  app.quit();
  process.exit(0);
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
}

const isDev = !app.isPackaged;
const DATA_DIR = path.join(app.getPath("userData"), "data");
const FILES = {
  dataDir: DATA_DIR,
  trx: path.join(DATA_DIR, "transactions.json"),
  bills: path.join(DATA_DIR, "open-bills.json"),
  menu: path.join(DATA_DIR, "menu.json"),
  logo: path.join(DATA_DIR, "logo.json"),
  cats: path.join(DATA_DIR, "categories.json"),
  settings: path.join(DATA_DIR, "settings.json"),
  shifts: path.join(DATA_DIR, "shifts.json"),
  qris: path.join(DATA_DIR, "qris.json"),
  users: path.join(DATA_DIR, "users.json"),
  customers: path.join(DATA_DIR, "customers.json"),
      resep: path.join(DATA_DIR, "resep.json"),
      bahanBaku: path.join(DATA_DIR, "bahan-baku.json"),
      supplier: path.join(DATA_DIR, "supplier.json"),
      loyaltyTiers: path.join(DATA_DIR, "loyalty-tiers.json"),
  wal: path.join(DATA_DIR, "trx.wal"),
  backups: path.join(DATA_DIR, "backups"),
  db: path.join(DATA_DIR, "kasir.db"),
  jsonBackups: path.join(DATA_DIR, "json-backups"),
};

const backup = createBackupService({ dataDir: DATA_DIR, files: FILES });
const license = createLicenseService(app);
const database = createDatabaseService({ ipcMain, files: FILES, ensureDir: backup.ensureDir, rJSON: backup.rJSON, atomicWrite: backup.atomicWrite, walAppend: backup.walAppend, walClear: backup.walClear });
const backupRestore = createBackupRestoreService({ app, ipcMain, dialog, files: FILES, ensureDir: backup.ensureDir, rJSON: backup.rJSON, closeDB: database.closeDB, initDB: database.initDB, migrateJSONToSQLite: database.migrateJSONToSQLite, loadTrx: database.loadTrx, loadShifts: database.loadShifts });

// Identitas perangkat untuk cloud sync (PLAN-WEBSYNC). Secret disimpan di
// userData (.pos_device) — satu level di atas folder data/, jadi tidak ikut
// ter-backup/ter-restore bersama data bisnis.
const deviceIdentity = createDeviceIdentity({ app });
const deviceSync = createDeviceSyncService({
  app,
  identity: deviceIdentity,
  // Sumber data "belum terkirim" + penanda hasil sync (SQLite via db.cjs).
  pendingCountProvider: () => database.countUnsyncedTransactions(),
  pendingListProvider: () => database.listUnsyncedTransactions(),
  markSynced: (ids, at) => database.markTransactionsSynced(ids, at),
  stockSnapshotProvider: () => {
    const settings = backup.rJSON(FILES.settings) || {};
    const ingredientsEnabled = settings.advancedFeatures?.enabled === true && settings.advancedFeatures?.bahanBaku === true;
    const menuRows = database.loadMenuList().map((item) => ({
      id: String(item.id), type: "menu", name: String(item.nama || item.name || item.id), unit: "pcs",
      stock: item.stok === null || item.stok === undefined ? null : Number(item.stok),
      minStock: Number(item.minStok || 0), updatedAt: item.updatedAt || null,
    }));
    const ingredientRows = ingredientsEnabled
      ? (backup.rJSON(FILES.bahanBaku) || []).map((item) => ({
        id: String(item.id), type: "ingredient", name: String(item.nama || item.id), unit: item.satuan || null,
        stock: Number(item.stok || 0), minStock: Number(item.minStok || 0), updatedAt: item.updatedAt || null,
      }))
      : [];
    return { rows: [...menuRows, ...ingredientRows], features: { ingredientsEnabled } };
  },
  applyMenuRestockProvider: (event) => database.applyRemoteMenuRestock(event),
  claimIngredientRestockProvider: (event) => database.claimIngredientRestock(event),
  completeIngredientRestockProvider: (eventId) => database.completeIngredientRestock(eventId),
    authorizeAttendanceManagement: () => currentSoftwareUser?.role === "admin" || currentSoftwareUser?.username === "admin",
  // Peringatan/sukses sync diteruskan ke renderer (toast "gagal kirim" dsb.).
  notify: (payload) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send("device-sync-event", payload);
    }
  },
});

function registerFileHandlers() {
  ipcMain.handle("bills-load", () => backup.rJSON(FILES.bills) || []);
  ipcMain.handle("bills-save", (_e, list) => { backup.atomicWrite(FILES.bills, list); return { ok: true }; });
  ipcMain.handle("bills-restore", (_e, list) => { backup.atomicWrite(FILES.bills, list); return { ok: true }; });
  ipcMain.handle("bills-clear", () => { backup.atomicWrite(FILES.bills, []); return { ok: true }; });
  // menu-load / menu-save sekarang ditangani db.cjs (tabel `products`, Langkah 2).
  // menu.json tetap ditulis sebagai cermin oleh db.cjs untuk backup lama.
  ipcMain.handle("logo-load", () => (backup.rJSON(FILES.logo) || {}).data || null);
  ipcMain.handle("logo-save", (_e, data) => { backup.atomicWrite(FILES.logo, { data }); return { ok: true }; });
  ipcMain.handle("qris-load", () => backup.rJSON(FILES.qris) || {});
  ipcMain.handle("qris-save", (_e, map) => { backup.atomicWrite(FILES.qris, map); return { ok: true }; });
  ipcMain.handle("qris-delete", (_e, key) => { const current = backup.rJSON(FILES.qris) || {}; delete current[key]; backup.atomicWrite(FILES.qris, current); return { ok: true }; });
  ipcMain.handle("cats-load", () => backup.rJSON(FILES.cats) || []);
  ipcMain.handle("cats-save", (_e, list) => { backup.atomicWrite(FILES.cats, list); return { ok: true }; });
  ipcMain.handle("settings-load", () => backup.rJSON(FILES.settings) || {});
  ipcMain.handle("settings-save", (_e, data) => { backup.atomicWrite(FILES.settings, data); return { ok: true }; });
  ipcMain.handle("users-load", () => backup.rJSON(FILES.users) || []);
  ipcMain.handle("users-save", (_e, list) => { backup.atomicWrite(FILES.users, list); return { ok: true }; });
  ipcMain.handle("customers-load", () => backup.rJSON(FILES.customers) || []);
  ipcMain.handle("customers-save", (_e, list) => { backup.atomicWrite(FILES.customers, list); return { ok: true }; });

  // Advanced feature storage (resep/HPP, bahan baku, supplier, loyalty tiers)
  ipcMain.handle("resep-load", () => backup.rJSON(FILES.resep) || {});
  ipcMain.handle("resep-save", (_e, data) => { backup.atomicWrite(FILES.resep, data); return { ok: true }; });
  ipcMain.handle("bahan-baku-load", () => backup.rJSON(FILES.bahanBaku) || []);
  ipcMain.handle("bahan-baku-save", (_e, list) => { backup.atomicWrite(FILES.bahanBaku, list); return { ok: true }; });
  ipcMain.handle("supplier-load", () => backup.rJSON(FILES.supplier) || []);
  ipcMain.handle("supplier-save", (_e, list) => { backup.atomicWrite(FILES.supplier, list); return { ok: true }; });
  ipcMain.handle("loyalty-tiers-load", () => backup.rJSON(FILES.loyaltyTiers) || []);
  ipcMain.handle("loyalty-tiers-save", (_e, list) => { backup.atomicWrite(FILES.loyaltyTiers, list); return { ok: true }; });
  ipcMain.handle("csv-save", async (_e, { filename, content }) => {
    const { filePath, canceled } = await dialog.showSaveDialog({ title: "Simpan File CSV", defaultPath: filename, filters: [{ name: "CSV Files", extensions: ["csv"] }] });
    if (canceled || !filePath) return { ok: false };
    fs.writeFileSync(filePath, "\uFEFF" + content, "utf-8");
    return { ok: true, filePath };
  });
}

function registerLicenseHandlers() {
  ipcMain.handle("license-check", () => license.checkLicense());
  ipcMain.handle("license-activate", (_e, key) => license.activateLicense(key));
  ipcMain.handle("license-hwid", () => getHardwareId());
  ipcMain.handle("get-data-path", () => DATA_DIR);
}

let rawScanner = null;
let HID = null;
try { HID = require("node-hid"); }
catch (err) { console.warn("[Main] node-hid not available; using keyboard wedge only:", err.message); }

function startRawScannerFallback(win) {
  if (!HID || !win) return;
  try {
    const devices = HID.devices ? HID.devices() : [];
    const candidate = devices.find((device) => /scanner|barcode|reader|usb hid/i.test(`${device.product || ""} ${device.manufacturer || ""} ${device.serialNumber || ""}`.toLowerCase()));
    if (!candidate) { console.warn("[Main] No raw HID scanner detected; keyboard wedge remains primary path"); return; }
    rawScanner = new HID.HID(candidate.vendorId, candidate.productId);
    rawScanner.on("data", (chunk) => {
      const code = Buffer.from(chunk).toString("utf8").replace(/[\r\n]+/g, "").trim();
      if (code) win.webContents.send("barcode-scanned", code);
    });
    rawScanner.on("error", (err) => console.warn("[Main] Raw scanner error:", err?.message || err));
    console.log("[Main] Raw HID barcode scanner connected:", candidate.product || "Unknown device");
  } catch (err) { console.warn("[Main] Raw HID scanner fallback unavailable:", err.message); }
}

registerFileHandlers();
registerAuthHandlers({
  ipcMain,
  onAuthenticatedUser: (user) => { currentSoftwareUser = user; },
  onSessionClear: () => { currentSoftwareUser = null; },
  store: {
    read: () => backup.rJSON(FILES.users) || [],
    write: (list) => backup.atomicWrite(FILES.users, list),
  },
});
database.registerHandlers();
backupRestore.registerHandlers();
registerLicenseHandlers();
deviceSync.registerHandlers(ipcMain);
createPrintingService({ app, ipcMain, BrowserWindow, dialog, dataDir: DATA_DIR, ensureDir: backup.ensureDir, rJSON: backup.rJSON, files: FILES, nodePrinterDriver: NodePrinterDriver });

function createWindow() {
  console.log("[Main] Creating BrowserWindow...");
  const mainWin = new BrowserWindow({ width: 1400, height: 860, minWidth: 1020, minHeight: 680, title: "Kasir — Warung", webPreferences: { preload: path.join(__dirname, "preload.js"), nodeIntegration: false, contextIsolation: true } });
  mainWin.setMenuBarVisibility(false);
  if (isDev) mainWin.loadURL("http://localhost:5173");
  else mainWin.loadFile(path.join(__dirname, "../dist/index.html"));
  mainWin.webContents.on("did-finish-load", () => startRawScannerFallback(mainWin));
  mainWin.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => console.error("[Main] Failed to load:", errorCode, errorDescription));
}

app.whenReady().then(() => {
  console.log("[Main] App ready, initializing...");
  process.on("uncaughtException", (err) => console.error("[Main] Uncaught exception:", err));
  process.on("unhandledRejection", (reason) => console.error("[Main] Unhandled rejection:", reason));
  try {
    database.initDB();
    database.migrateJSONToSQLite();
    database.migrateMenuToProducts();
    const openShift = database.loadShifts().find((shift) => shift.status === "open");
    currentSoftwareUser = (backup.rJSON(FILES.users) || []).find((user) => user.username === openShift?.username) || null;
    backup.walRecover();
    backup.dailyBackup();
    // Mulai auto-sync 5 menit HANYA jika perangkat sudah dipasangkan & URL diatur.
    deviceSync.syncAutoSyncState();
    createWindow();
  } catch (err) { console.error("[Main] Error during startup:", err); }
  const updateCheck = checkForUpdate().catch(() => null);
  ipcMain.handle("update-check", () => updateCheck);
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on("window-all-closed", () => {
  deviceSync.stopAutoSync();
  database.closeDB();
  if (process.platform !== "darwin") app.quit();
});
