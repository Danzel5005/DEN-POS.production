const { contextBridge, ipcRenderer } = require("electron");

const kasirAPI = {
  // Transactions
  loadTrx:     ()      => ipcRenderer.invoke("trx-load"),
  saveTrx:     (t)     => ipcRenderer.invoke("trx-save", t),
  deleteTrx:   (id, opts) => ipcRenderer.invoke("trx-delete", id, opts),
  restoreTrx:  (list)  => ipcRenderer.invoke("trx-restore", list),
  clearTrx:    (opts)  => ipcRenderer.invoke("trx-clear", opts),
  restoreClearedTrx: (backupFile) => ipcRenderer.invoke("trx-restore-cleared", backupFile),
  restorePreview: (q) => ipcRenderer.invoke("trx-restore-preview", q),
  voidTrx:     (id, data) => ipcRenderer.invoke("trx-void", id, data),
settleTrx: (id, actor) => ipcRenderer.invoke("trx-settle", id, actor),
  // New: Filtered & paginated transactions
  loadTrxFiltered: (filters) => ipcRenderer.invoke("trx-load-filtered", filters),
  getTrxDailyStats: (filters) => ipcRenderer.invoke("trx-get-daily-stats", filters),
  getTrxShiftIds: () => ipcRenderer.invoke("trx-get-shift-ids"),
  // Open Bills
  loadBills:    ()      => ipcRenderer.invoke("bills-load"),
  saveBills:    (list)  => ipcRenderer.invoke("bills-save", list),
  restoreBills: (list)  => ipcRenderer.invoke("bills-restore", list),
  clearBills:   ()      => ipcRenderer.invoke("bills-clear"),
  // Menu
  loadMenu:    ()      => ipcRenderer.invoke("menu-load"),
  upsertMenu:  (item)  => ipcRenderer.invoke("menu-upsert", item),
  deleteMenu:  (id)    => ipcRenderer.invoke("menu-delete", id),
  replaceMenu: (list)  => ipcRenderer.invoke("menu-replace", list),
  bulkUpsertMenu: (items) => ipcRenderer.invoke("menu-bulk-upsert", items),
  applyStock:  (deltas, meta) => ipcRenderer.invoke("apply-stock", deltas, meta),
  stockIn:     (payload) => ipcRenderer.invoke("stock-in", payload),
  stockOpname: (rows, meta) => ipcRenderer.invoke("stock-opname", rows, meta),
  stockMovements: (q) => ipcRenderer.invoke("stock-movements", q),
  stockSet:    (payload) => ipcRenderer.invoke("stock-set", payload),
  // Logo
  loadLogo:    ()      => ipcRenderer.invoke("logo-load"),
  saveLogo:    (data)  => ipcRenderer.invoke("logo-save", data),
  // QRIS
  loadQris:    ()      => ipcRenderer.invoke("qris-load"),
  saveQris:    (map)   => ipcRenderer.invoke("qris-save", map),
  deleteQris:  (key)   => ipcRenderer.invoke("qris-delete", key),
  // Users
  loadUsers:   ()      => ipcRenderer.invoke("users-load"),
  saveUsers:   (list)  => ipcRenderer.invoke("users-save", list),
  // Auth (password disimpan sebagai hash scrypt di main process)
  authLogin:          (payload) => ipcRenderer.invoke("auth-login", payload),
  authSetPassword:    (payload) => ipcRenderer.invoke("auth-set-password", payload),
  authChangePassword: (payload) => ipcRenderer.invoke("auth-change-own-password", payload),
  authCreateUser:     (payload) => ipcRenderer.invoke("auth-create-user", payload),
  loadCustomers: () => ipcRenderer.invoke("customers-load"),
  saveCustomers: (list) => ipcRenderer.invoke("customers-save", list),
  customerTotals: () => ipcRenderer.invoke("customer-totals"),

    // Advanced feature storage (resep/HPP, bahan baku, supplier, loyalty tiers)
    loadResep: () => ipcRenderer.invoke("resep-load"),
    saveResep: (data) => ipcRenderer.invoke("resep-save", data),
    loadBahanBaku: () => ipcRenderer.invoke("bahan-baku-load"),
    saveBahanBaku: (list) => ipcRenderer.invoke("bahan-baku-save", list),
    loadSupplier: () => ipcRenderer.invoke("supplier-load"),
    saveSupplier: (list) => ipcRenderer.invoke("supplier-save", list),
    loadLoyaltyTiers: () => ipcRenderer.invoke("loyalty-tiers-load"),
    saveLoyaltyTiers: (list) => ipcRenderer.invoke("loyalty-tiers-save", list),
  // Categories
  loadCats:    ()      => ipcRenderer.invoke("cats-load"),
  saveCats:    (list)  => ipcRenderer.invoke("cats-save", list),
  // Settings
  loadSettings: ()     => ipcRenderer.invoke("settings-load"),
  saveSettings: (d)    => ipcRenderer.invoke("settings-save", d),
  // CSV
  saveCSV:     (data)  => ipcRenderer.invoke("csv-save", data),
  // Backup & Restore
  backupStats:  ()      => ipcRenderer.invoke("backup-stats"),
  backupCreate: (target) => ipcRenderer.invoke("backup-create", target),
  backupPreview: (candidate) => ipcRenderer.invoke("backup-preview", candidate),
  backupSummary: (candidate) => ipcRenderer.invoke("backup-summary", candidate),
  backupRestore: (candidate) => ipcRenderer.invoke("backup-restore", candidate),
  backupListInternal: () => ipcRenderer.invoke("backup-list-internal"),
  backupOpenFolder: () => ipcRenderer.invoke("backup-open-folder"),
  backupRelaunch: () => ipcRenderer.invoke("backup-relaunch"),
  // Printer
  getPrinters:   ()    => ipcRenderer.invoke("get-printers"),
  printReceiptEscPos: (data) => ipcRenderer.invoke("print-receipt-escpos", data),
  printReceipt:  (data)=> ipcRenderer.invoke("print-receipt", data),
    exportReportPdf: (data)=>ipcRenderer.invoke("export-report-pdf", data),
  // Shifts
  loadShifts:  ()      => ipcRenderer.invoke("shifts-load"),
  saveShifts:  (list)  => ipcRenderer.invoke("shifts-save", list),
  // License
  checkLicense:    ()    => ipcRenderer.invoke("license-check"),
  activateLicense: (key) => ipcRenderer.invoke("license-activate", key),
  getHardwareId:   ()    => ipcRenderer.invoke("license-hwid"),
  // Device identity & cloud sync (PLAN-WEBSYNC)
  deviceIdentity:        ()     => ipcRenderer.invoke("device-identity"),
  deviceStatus:          ()     => ipcRenderer.invoke("device-status"),
  deviceSetBaseUrl:      (url)  => ipcRenderer.invoke("device-set-base-url", url),
  deviceRegister:        (opts) => ipcRenderer.invoke("device-register", opts),
  deviceCheckPairing:    (opts) => ipcRenderer.invoke("device-check-pairing", opts),
  devicePushSync:        (batch)=> ipcRenderer.invoke("device-push-sync", batch),
  devicePushTransactions:()     => ipcRenderer.invoke("device-push-transactions"),
  deviceStockExchange: ()       => ipcRenderer.invoke("device-stock-exchange"),
  deviceRestockAck: (ack)       => ipcRenderer.invoke("device-restock-ack", ack),
  deviceClaimRestock: (eventId) => ipcRenderer.invoke("device-claim-restock", eventId),
  deviceApplyMenuRestock: (event) => ipcRenderer.invoke("device-apply-menu-restock", event),
  deviceClaimIngredientRestock: (event) => ipcRenderer.invoke("device-claim-ingredient-restock", event),
  deviceCompleteIngredientRestock: (eventId) => ipcRenderer.invoke("device-complete-ingredient-restock", eventId),
  devicePendingCount:    ()     => ipcRenderer.invoke("device-pending-count"),
  kdsSend: (tickets) => ipcRenderer.invoke("kds-send", tickets),
  kdsCancel: (sourceRef) => ipcRenderer.invoke("kds-cancel", sourceRef),
  kdsStatus: () => ipcRenderer.invoke("kds-status"),
  kdsRetry: () => ipcRenderer.invoke("kds-retry"),
  deviceCredential:      ()     => ipcRenderer.invoke("device-credential"),
  deviceRotateCredential:()     => ipcRenderer.invoke("device-rotate-credential"),
  deviceSetName:         (name) => ipcRenderer.invoke("device-set-name", name),
  onDeviceSyncEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("device-sync-event", listener);
    return () => ipcRenderer.removeListener("device-sync-event", listener);
  },
  // Info
  getDataPath:  ()      => ipcRenderer.invoke("get-data-path"),
  processPayment: (data) => ipcRenderer.invoke("process-payment", data),
  onBarcodeScanned: (callback) => {
    const listener = (_event, code) => callback(code);
    ipcRenderer.on("barcode-scanned", listener);
    return () => ipcRenderer.removeListener("barcode-scanned", listener);
  },
  onUpdateAvailable: (callback) => {
    const listener = (_event, info) => callback(info);
    ipcRenderer.on("update-available", listener);
    return () => ipcRenderer.removeListener("update-available", listener);
  },
  checkUpdate: () => ipcRenderer.invoke("update-check")
};

contextBridge.exposeInMainWorld("kasirAPI", kasirAPI);
contextBridge.exposeInMainWorld("api", kasirAPI);
