const fs = require("fs");
const path = require("path");

function createDatabaseService({ ipcMain, files, ensureDir, rJSON, atomicWrite, walAppend, walClear }) {
  let db = null;

  function initDB() {
    try {
      console.log("[Main] Loading better-sqlite3...");
      const Database = require("better-sqlite3");
      console.log("[Main] better-sqlite3 loaded");
      ensureDir();
      console.log("[Main] DATA_DIR:", files.dataDir);
      console.log("[Main] FILES.db:", files.db);
      console.log("[Main] Opening database...");
      db = new Database(files.db);
      console.log("[Main] Database opened");
      db.pragma("journal_mode = WAL");
      console.log("[Main] WAL mode set");
      db.exec(`
        CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, synced_at DATETIME);
        CREATE TABLE IF NOT EXISTS shifts (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS products (
          id TEXT PRIMARY KEY,
          menu_id TEXT UNIQUE COLLATE NOCASE,
          kategori TEXT,
          stok REAL,
          data TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS stock_movements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id TEXT,
          nama TEXT,
          type TEXT NOT NULL,
          delta REAL NOT NULL,
          stok_after REAL,
          ref TEXT,
          actor TEXT,
          note TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS remote_restock_events (
          event_id TEXT PRIMARY KEY,
          item_type TEXT NOT NULL,
          item_id TEXT NOT NULL,
          item_name TEXT NOT NULL,
          qty REAL NOT NULL,
          status TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_trx_created ON transactions(created_at);
        CREATE INDEX IF NOT EXISTS idx_shifts_created ON shifts(created_at);
        CREATE INDEX IF NOT EXISTS idx_trx_created_date ON transactions(date(created_at));
        CREATE INDEX IF NOT EXISTS idx_products_menu_id ON products(menu_id);
        CREATE INDEX IF NOT EXISTS idx_products_kategori ON products(kategori);
        CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id, created_at);
      `);
      console.log("[Main] Tables created");
      // Migrasi ringan untuk DB lama (file sudah ada sebelum kolom ditambahkan).
      // CREATE TABLE IF NOT EXISTS tidak mengubah tabel yang sudah ada.
      ensureColumn("transactions", "synced_at", "DATETIME");
      // Buat indeks setelah migrasi kolom agar DB lama (yang belum memiliki
      // synced_at) tetap bisa dibuka. Sebelumnya CREATE INDEX di blok awal
      // membuat initDB gagal sebelum ensureColumn sempat berjalan.
      db.exec("CREATE INDEX IF NOT EXISTS idx_trx_synced ON transactions(synced_at)");
      console.log("[DB] SQLite initialized successfully");
      return true;
    } catch (err) {
      console.error("[DB] Failed to initialize SQLite:", err.message, err.stack);
      return false;
    }
  }

  // ensureColumn — tambah kolom hanya jika belum ada (idempoten, aman dijalankan
  // tiap start). Dipakai untuk migrasi ringan tanpa tool migration eksternal.
  function ensureColumn(table, column, type) {
    if (!db) return false;
    try {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all();
      if (cols.some((c) => c.name === column)) return false;
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      console.log(`[DB] Migrated: added ${table}.${column}`);
      return true;
    } catch (err) {
      console.error(`[DB] ensureColumn ${table}.${column} failed:`, err.message);
      return false;
    }
  }

  function migrateJSONToSQLite() {
    if (!db) return;
    try {
      ensureDir();
      if (!fs.existsSync(files.jsonBackups)) fs.mkdirSync(files.jsonBackups, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      for (const [file, table, label] of [[files.trx, "transactions", "Transactions"], [files.shifts, "shifts", "Shifts"]]) {
        if (!fs.existsSync(file)) continue;
        const list = rJSON(file) || [];
        if (!list.length) continue;
        const stmt = db.prepare(`INSERT OR IGNORE INTO ${table} (id, data) VALUES (?, ?)`);
        db.transaction((items) => items.forEach((item) => stmt.run(item.id || null, JSON.stringify(item))))(list);
        const backupPath = `${files.jsonBackups}/${label.toLowerCase()}_${timestamp}.json`;
        fs.copyFileSync(file, backupPath);
        console.log(`[Migration] ${label} migrated to SQLite. Backup: ${backupPath}`);
      }
      migrateMenuToProducts();
    } catch (err) {
      console.error("[Migration] Error during JSON to SQLite migration:", err.message);
    }
  }

  // ── Menu: pindah dari menu.json ke tabel `products`.
  // `data` menyimpan seluruh field JSON item, `menu_id`/`kategori`/`stok`
  // diangkat jadi kolom supaya bisa di-query & di-update tanpa parsing JSON.
  // menu.json TIDAK dihapus supaya bisa rollback & dipakai backup lama.
  function rowToMenu(row) {
    if (!row) return null;
    const extra = row.data ? JSON.parse(row.data) : {};
    return { ...extra, id: row.menu_id ?? extra.id, kategori: row.kategori ?? extra.kategori, stok: row.stok === null || row.stok === undefined ? (extra.stok ?? null) : row.stok };
  }

  // Simpan satu item. PENTING: baris yang sudah ada TIDAK menimpa `stok`
  // (stok hanya berubah lewat applyStockDelta / menu-replace), supaya upsert
  // dari form edit tidak menghapus penjualan yang berjalan bersamaan.
  function upsertMenuRow(item, { overwriteStock = false } = {}) {
    if (!item || item.id === undefined || item.id === null) return false;
    const menuId = String(item.id);
    const kategori = item.kategori ?? null;
    // `stok` non-finite diperlakukan sebagai tak terbatas (null).
    const stok = (item.stok === null || item.stok === undefined || item.stok === "" || !Number.isFinite(Number(item.stok))) ? null : Number(item.stok);
    const data = JSON.stringify(item);
    const existing = db.prepare("SELECT menu_id, data FROM products WHERE menu_id = ?").get(menuId);
    if (!existing) {
      db.prepare("INSERT INTO products (id, menu_id, kategori, stok, data) VALUES (?, ?, ?, ?, ?)").run(menuId, menuId, kategori, stok, data);
      return true;
    }
    if (overwriteStock) {
      db.prepare("UPDATE products SET kategori = ?, stok = ?, data = ? WHERE menu_id = ?").run(kategori, stok, data, menuId);
    } else {
      db.prepare("UPDATE products SET kategori = ?, data = ? WHERE menu_id = ?").run(kategori, data, menuId);
    }
    return true;
  }

  function loadMenuList() {
    if (!db) return rJSON(files.menu) || [];
    try { return db.prepare("SELECT menu_id, kategori, stok, data FROM products ORDER BY created_at ASC").all().map(rowToMenu).filter(Boolean); }
    catch (err) { console.error("[menu-load] Error:", err.message); return []; }
  }

  // Ganti SELURUH tabel products (dipakai clear, undo, restore backup).
  function replaceMenuList(list) {
    const items = Array.isArray(list) ? list : [];
    db.exec("DELETE FROM products");
    const stmt = db.prepare("INSERT INTO products (id, menu_id, kategori, stok, data) VALUES (?, ?, ?, ?, ?)");
    db.transaction((entries) => {
      entries.forEach((item) => {
        if (!item || item.id === undefined || item.id === null) return;
        const menuId = String(item.id);
        const stok = (item.stok === null || item.stok === undefined || item.stok === "" || !Number.isFinite(Number(item.stok))) ? null : Number(item.stok);
        stmt.run(menuId, menuId, item.kategori ?? null, stok, JSON.stringify(item));
      });
    })(items);
  }

  // Upsert BANYAK item dalam SATU transaksi. Dipakai import Excel supaya
  // ratusan baris tidak jadi ratusan transaksi SQLite terpisah (lambat &
  // tidak atomic). Reuse upsertMenuRow supaya aturan "baris existing tidak
  // menimpa stok" otomatis ikut berlaku untuk semua baris import.
  // Return: { applied, skipped } — jumlah baris yang di-upsert / dilewati.
  function bulkUpsertMenu(items) {
    const list = Array.isArray(items) ? items : [];
    let applied = 0;
    let skipped = 0;
    const run = db.transaction((rows) => {
      for (const item of rows) {
        if (!item || item.id === undefined || item.id === null) { skipped += 1; continue; }
        if (upsertMenuRow(item)) applied += 1; else skipped += 1;
      }
    });
    run(list);
    return { applied, skipped };
  }

  function migrateMenuToProducts() {
    if (!db) return { migrated: 0 };
    try {
      const existing = db.prepare("SELECT COUNT(*) as total FROM products").get();
      if (existing && existing.total > 0) return { migrated: 0, skipped: true };
      if (!fs.existsSync(files.menu)) return { migrated: 0 };
      const list = rJSON(files.menu) || [];
      if (!list.length) return { migrated: 0 };
      replaceMenuList(list);
      if (!fs.existsSync(files.jsonBackups)) fs.mkdirSync(files.jsonBackups, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      fs.copyFileSync(files.menu, `${files.jsonBackups}/menu_${stamp}.json`);
      console.log(`[Migration] Menu migrated to SQLite products table (${list.length} items).`);
      return { migrated: list.length };
    } catch (err) {
      console.error("[Migration] Error migrating menu to products:", err.message);
      return { migrated: 0, error: err.message };
    }
  }

  function closeDB() {
    if (db) { db.close(); db = null; }
  }

  // Transaksi void dilewati untuk semua operasi stok (Langkah 2b): stok sudah
  // kembali saat void (Langkah 1), kalau tidak akan dobel.
  function isTrxVoided(trx) {
    return !!trx && (trx.status === "voided" || trx.voided === true);
  }

  // Satu pintu untuk stok (Langkah 2). Menerima delta (bukan overwrite),
  // di-clamp ke 0. Mengembalikan peta `{id: stok}` untuk id yang berubah.
  // Diletakkan di scope createDatabaseService supaya bisa dipakai oleh
  // handler (process-payment, trx-void, apply-stock) DAN diekspor.
  function applyStockDelta(deltas, meta = {}) {
    const map = deltas && typeof deltas === "object" ? deltas : {};
    const stock = {};
    if (!db) return stock;
    const ids = Object.keys(map);
    if (!ids.length) return stock;
    const getRow = db.prepare("SELECT menu_id, stok, data FROM products WHERE menu_id = ?");
    const setRow = db.prepare("UPDATE products SET stok = ? WHERE menu_id = ?");
    // Langkah 6: setiap perubahan stok dicatat ke stock_movements di dalam
    // fungsi ini, jadi log tak mungkin lepas dari stok.
    const logRow = db.prepare(
      "INSERT INTO stock_movements (product_id, nama, type, delta, stok_after, ref, actor, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const logType = meta.type || "adjust";
    const logRef = meta.ref != null ? String(meta.ref) : null;
    const logActor = meta.actor != null ? String(meta.actor) : null;
    const logNote = meta.note != null ? String(meta.note) : null;
    const run = db.transaction(() => {
      for (const id of ids) {
        const row = getRow.get(String(id));
        if (!row) continue; // item tak ada / sudah dihapus
        if (row.stok === null || row.stok === undefined) continue; // stok tak terbatas
        const delta = Number(map[id]) || 0;
        if (delta === 0) continue;
        const next = Math.max(0, Number(row.stok) + delta);
        const applied = next - Number(row.stok);
        setRow.run(next, String(id));
        let nama = id;
        try { nama = JSON.parse(row.data || "{}").nama || id; } catch { /* ignore */ }
        logRow.run(String(id), nama, logType, applied, next, logRef, logActor, logNote);
        stock[id] = next;
      }
    });
    run();
    return stock;
  }

  function applyRemoteMenuRestock(event = {}) {
    if (!db) return { ok: false, error: "database belum siap" };
    const eventId = String(event.id || event.eventId || "");
    const itemId = String(event.item_id || event.itemId || "");
    const qty = Number(event.qty);
    if (!eventId || !itemId || !Number.isFinite(qty) || qty <= 0 || qty > 1000000) {
      return { ok: false, error: "Data restock tidak valid", rejected: true };
    }
    const existing = db.prepare("SELECT status FROM remote_restock_events WHERE event_id = ?").get(eventId);
    if (existing) {
      const row = db.prepare("SELECT stok FROM products WHERE menu_id = ?").get(itemId);
      return { ok: existing.status === "applied", duplicate: true, stockAfter: row?.stok, rejected: existing.status === "rejected" };
    }

    const row = db.prepare("SELECT stok FROM products WHERE menu_id = ?").get(itemId);
    if (!row || row.stok === null || row.stok === undefined) {
      db.prepare("INSERT INTO remote_restock_events (event_id, item_type, item_id, item_name, qty, status) VALUES (?, 'menu', ?, ?, ?, 'rejected')")
        .run(eventId, itemId, String(event.item_name || event.itemName || itemId), qty);
      return { ok: false, error: !row ? "Item menu tidak ditemukan" : "Item tidak memakai stok terukur", rejected: true };
    }

    try {
      const run = db.transaction(() => {
        db.prepare("INSERT INTO remote_restock_events (event_id, item_type, item_id, item_name, qty, status) VALUES (?, 'menu', ?, ?, ?, 'applied')")
          .run(eventId, itemId, String(event.item_name || event.itemName || itemId), qty);
        const stock = applyStockDelta({ [itemId]: qty }, { type: "web-restock", ref: eventId, actor: "web", note: event.note || null });
        return stock[itemId];
      });
      return { ok: true, stockAfter: run() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  function claimIngredientRestock(event = {}) {
    if (!db) return { ok: false, error: "database belum siap" };
    const eventId = String(event.id || event.eventId || "");
    const itemId = String(event.item_id || event.itemId || "");
    const qty = Number(event.qty);
    if (!eventId || !itemId || !Number.isFinite(qty) || qty <= 0 || qty > 1000000) {
      return { ok: false, error: "Data restock tidak valid", rejected: true };
    }
    const result = db.prepare(
      "INSERT OR IGNORE INTO remote_restock_events (event_id, item_type, item_id, item_name, qty, status) VALUES (?, 'ingredient', ?, ?, ?, 'claimed')"
    ).run(eventId, itemId, String(event.item_name || event.itemName || itemId), qty);
    const existing = result.changes ? "claimed" : db.prepare("SELECT status FROM remote_restock_events WHERE event_id = ?").get(eventId)?.status;
    return { ok: true, duplicate: result.changes === 0, status: existing };
  }

  function completeIngredientRestock(eventId) {
    if (!db || !eventId) return { ok: false, error: "Event tidak valid" };
    const result = db.prepare("UPDATE remote_restock_events SET status = 'applied' WHERE event_id = ? AND item_type = 'ingredient' AND status = 'claimed'")
      .run(String(eventId));
    return { ok: result.changes > 0 };
  }

  // ── Stok: helper bersama.
  // Mengembalikan stok untuk item pada transaksi yang di-void. Dipakai oleh
  // kedua cabang trx-void. `menu` opsional: kalau pemanggil sudah memegang
  // array menu (mis. cabang JSON yang baru membacanya), kirim supaya tidak
  // membaca file dua kali. Item dengan `stok === null` (tak terbatas) dan item
  // yang sudah dihapus dari menu DILEWATI. Baris satuan memakai baseQty.
  function restoreStockFromTrx(trx, menu) {
    const list = Array.isArray(menu) ? menu : (rJSON(files.menu) || []);
    const items = Array.isArray(trx?.items) ? trx.items : [];
    if (!items.length || !list.length) return { menu: list, restored: 0 };
    let restored = 0;
    const next = list.map((m) => ({ ...m }));
    const nextById = new Map(next.map((m) => [String(m.id), m]));
    for (const it of items) {
      const target = nextById.get(String(it?.id));
      if (!target) continue; // item sudah dihapus dari menu
      if (target.stok === null || target.stok === undefined) continue; // stok tak terbatas
      const qty = Number(it?.baseQty ?? it?.qty) || 0;
      if (qty === 0) continue;
      target.stok = Number(target.stok) + qty;
      restored += qty;
    }
    return { menu: next, restored };
  }

  function registerHandlers() {
    // ── Menu IPC (Langkah 2). Menu kini di tabel `products`; menu.json tetap
    // ditulis sebagai cermin supaya backup lama & fallback browser tetap jalan.
    ipcMain.handle("menu-load", () => {
      if (!db) return rJSON(files.menu) || [];
      return loadMenuList();
    });
    ipcMain.handle("menu-upsert", (_e, item) => {
      if (!db) {
        const list = rJSON(files.menu) || [];
        const idx = list.findIndex((m) => String(m.id) === String(item?.id));
        if (idx >= 0) list[idx] = { ...item, stok: list[idx].stok }; else list.push(item);
        atomicWrite(files.menu, list);
        return { ok: true };
      }
      try { upsertMenuRow(item); return { ok: true, menu: loadMenuList() }; }
      catch (err) { console.error("[menu-upsert] Error:", err.message); return { ok: false, error: err.message }; }
    });
    ipcMain.handle("menu-delete", (_e, id) => {
      if (!db) { atomicWrite(files.menu, (rJSON(files.menu) || []).filter((m) => String(m.id) !== String(id))); return { ok: true }; }
      try { db.prepare("DELETE FROM products WHERE menu_id = ?").run(String(id)); return { ok: true, menu: loadMenuList() }; }
      catch (err) { console.error("[menu-delete] Error:", err.message); return { ok: false, error: err.message }; }
    });
    ipcMain.handle("menu-replace", (_e, list) => {
      if (!db) { atomicWrite(files.menu, list || []); return { ok: true }; }
      try { replaceMenuList(list); return { ok: true, menu: loadMenuList() }; }
      catch (err) { console.error("[menu-replace] Error:", err.message); return { ok: false, error: err.message }; }
    });
    // Import Excel: upsert banyak baris dalam satu transaksi. Fallback JSON
    // (tanpa SQLite) meniru aturan upsertMenuRow: baris existing tidak menimpa
    // stok, baris baru set stok apa adanya.
    ipcMain.handle("menu-bulk-upsert", (_e, items) => {
      const list = Array.isArray(items) ? items : [];
      if (!db) {
        try {
          const menu = rJSON(files.menu) || [];
          const byId = new Map(menu.map((m) => [String(m.id), m]));
          let applied = 0;
          let skipped = 0;
          for (const item of list) {
            if (!item || item.id === undefined || item.id === null) { skipped += 1; continue; }
            const key = String(item.id);
            const existing = byId.get(key);
            if (existing) byId.set(key, { ...item, stok: existing.stok });
            else byId.set(key, item);
            applied += 1;
          }
          atomicWrite(files.menu, [...byId.values()]);
          return { ok: true, applied, skipped };
        } catch (err) { console.error("[menu-bulk-upsert] Error:", err.message); return { ok: false, error: err.message }; }
      }
      try {
        const { applied, skipped } = bulkUpsertMenu(list);
        return { ok: true, applied, skipped, menu: loadMenuList() };
      } catch (err) { console.error("[menu-bulk-upsert] Error:", err.message); return { ok: false, error: err.message }; }
    });
    // Renderer memakai ini untuk hold/cancel open bill (temuan 1: stok bill
    // dulu hanya di state React, hilang saat restart).
    ipcMain.handle("apply-stock", (_e, deltas, meta) => {
      try { const stock = applyStockDelta(deltas, meta || {}); return { ok: true, stock }; }
      catch (err) { console.error("[apply-stock] Error:", err.message); return { ok: false, error: err.message }; }
    });

    // ── Langkah 6: stok masuk, opname, riwayat mutasi, set stok.
    // `stock-in` menambah stok (type "in") dan opsional memperbarui harga modal
    // (harga beli terakhir). Tanpa `modalBaru`, modal lama dipertahankan.
    ipcMain.handle("stock-in", (_e, { id, qty, modalBaru, note, actor } = {}) => {
      const addQty = Number(qty) || 0;
      if (!id || addQty <= 0) return { ok: false, error: "qty tidak valid" };
      if (!db) return { ok: false, error: "database belum siap" };
      try {
        let stock = {};
        const run = db.transaction(() => {
          stock = applyStockDelta({ [String(id)]: addQty }, { type: "in", ref: null, actor, note });
          if (!Object.keys(stock).length) return;
          const row = db.prepare("SELECT data FROM products WHERE menu_id = ?").get(String(id));
          if (!row) return;
          const data = JSON.parse(row.data || "{}");
          if (modalBaru !== undefined && modalBaru !== null && modalBaru !== "") {
            const m = parseInt(modalBaru);
            if (!Number.isNaN(m) && m >= 0) { data.modal = m; db.prepare("UPDATE products SET data = ? WHERE menu_id = ?").run(JSON.stringify(data), String(id)); }
          }
        });
        run();
        if (!Object.keys(stock).length) return { ok: false, error: "item tak ada atau stok tak terbatas" };
        return { ok: true, stock, menu: loadMenuList() };
      } catch (err) { console.error("[stock-in] Error:", err.message); return { ok: false, error: err.message }; }
    });

    // `stock-opname` menyetel stok fisik hasil hitung (type "opname"). Delta
    // dihitung dari stok sistem saat itu; kalau beda, dicatat sebagai mutasi.
    ipcMain.handle("stock-opname", (_e, rows, meta = {}) => {
      if (!db) return { ok: false, error: "database belum siap" };
      const list = Array.isArray(rows) ? rows : [];
      try {
        const stock = {};
        const getRow = db.prepare("SELECT menu_id, stok, data FROM products WHERE menu_id = ?");
        const setRow = db.prepare("UPDATE products SET stok = ? WHERE menu_id = ?");
        const logRow = db.prepare(
          "INSERT INTO stock_movements (product_id, nama, type, delta, stok_after, ref, actor, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        );
        const run = db.transaction(() => {
          for (const r of list) {
            if (!r || r.id === undefined || r.id === null) continue;
            const row = getRow.get(String(r.id));
            if (!row) continue;
            if (row.stok === null || row.stok === undefined) continue;
            const counted = Number(r.counted);
            if (Number.isNaN(counted) || counted < 0) continue;
            const delta = counted - Number(row.stok);
            setRow.run(counted, String(r.id));
            if (delta !== 0) {
              let nama = r.id;
              try { nama = JSON.parse(row.data || "{}").nama || r.id; } catch { /* ignore */ }
              logRow.run(String(r.id), nama, "opname", delta, counted, meta.ref != null ? String(meta.ref) : null, meta.actor != null ? String(meta.actor) : null, meta.note != null ? String(meta.note) : null);
            }
            stock[r.id] = counted;
          }
        });
        run();
        return { ok: true, stock, menu: loadMenuList() };
      } catch (err) { console.error("[stock-opname] Error:", err.message); return { ok: false, error: err.message }; }
    });

    // `stock-movements` — riwayat mutasi. Filter opsional: productId, limit.
    ipcMain.handle("stock-movements", (_e, { productId = null, limit = 200 } = {}) => {
      if (!db) return [];
      try {
        const lim = Math.max(1, Math.min(2000, Number(limit) || 200));
        if (productId != null) {
          return db.prepare("SELECT * FROM stock_movements WHERE product_id = ? ORDER BY created_at DESC, id DESC LIMIT ?").all(String(productId), lim);
        }
        return db.prepare("SELECT * FROM stock_movements ORDER BY created_at DESC, id DESC LIMIT ?").all(lim);
      } catch (err) { console.error("[stock-movements] Error:", err.message); return []; }
    });

    // `stock-set` menyetel stok langsung tanpa log — HANYA untuk peralihan
    // null (tak terbatas) ↔ angka, sesuai Langkah 6.
    ipcMain.handle("stock-set", (_e, { id, stok } = {}) => {
      if (!db) return { ok: false, error: "database belum siap" };
      if (id === undefined || id === null) return { ok: false, error: "id wajib" };
      try {
        const value = stok === null || stok === "" ? null : Number(stok);
        if (value !== null && (Number.isNaN(value) || value < 0)) return { ok: false, error: "stok tidak valid" };
        const info = db.prepare("UPDATE products SET stok = ? WHERE menu_id = ?").run(value, String(id));
        if (!info.changes) return { ok: false, error: "item tak ada" };
        return { ok: true, stock: { [String(id)]: value }, menu: loadMenuList() };
      } catch (err) { console.error("[stock-set] Error:", err.message); return { ok: false, error: err.message }; }
    });

    ipcMain.handle("trx-load", () => {
      if (!db) return [];
      try { return db.prepare("SELECT id, data FROM transactions ORDER BY created_at DESC").all().map((row) => JSON.parse(row.data)); }
      catch (err) { console.error("[trx-load] Error:", err.message); return []; }
    });

    ipcMain.handle("trx-load-filtered", (_e, { fFrom, fTo, shiftId, page = 0, pageSize = 100, sort = "desc" }) => {
      if (!db) return { transactions: [], total: 0, page, pageSize };
      try {
        const conditions = []; const params = [];
        if (fFrom) { conditions.push("date(created_at) >= date(?)"); params.push(fFrom); }
        if (fTo) { conditions.push("date(created_at) <= date(?)"); params.push(fTo); }
        if (shiftId) { conditions.push("json_extract(data, '$.shiftId') = ?"); params.push(shiftId); }
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const { total } = db.prepare(`SELECT COUNT(*) as total FROM transactions ${where}`).get(...params);
        const order = sort === "asc" ? "ASC" : "DESC";
        const rows = db.prepare(`SELECT id, data, created_at FROM transactions ${where} ORDER BY created_at ${order} LIMIT ? OFFSET ?`).all(...params, pageSize, page * pageSize);
        return { transactions: rows.map((row) => JSON.parse(row.data)), total, page, pageSize };
      } catch (err) { console.error("[trx-load-filtered] Error:", err.message); return { transactions: [], total: 0, page, pageSize }; }
    });

    const filter = (fFrom, fTo, shiftId) => {
      const conditions = []; const params = [];
      if (fFrom) { conditions.push("date(created_at) >= date(?)"); params.push(fFrom); }
      if (fTo) { conditions.push("date(created_at) <= date(?)"); params.push(fTo); }
      if (shiftId) { conditions.push("json_extract(data, '$.shiftId') = ?"); params.push(shiftId); }
      return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", params };
    };
    ipcMain.handle("trx-get-daily-stats", (_e, { fFrom, fTo, shiftId }) => {
      if (!db) return [];
      try { const { where, params } = filter(fFrom, fTo, shiftId); return db.prepare(`SELECT date(created_at) as date, COUNT(*) as count, SUM(json_extract(data, '$.total')) as total, SUM(json_extract(data, '$.pax')) as pax, SUM(json_extract(data, '$.subtotal')) as subtotal FROM transactions ${where} GROUP BY date(created_at) ORDER BY date(created_at) DESC`).all(...params); }
      catch (err) { console.error("[trx-get-daily-stats] Error:", err.message); return []; }
    });
    ipcMain.handle("trx-get-shift-ids", () => {
      if (!db) return [];
      try { return db.prepare("SELECT DISTINCT json_extract(data, '$.shiftId') as shiftId FROM transactions WHERE json_extract(data, '$.shiftId') IS NOT NULL ORDER BY shiftId DESC").all().map((row) => row.shiftId).filter(Boolean); }
      catch (err) { console.error("[trx-get-shift-ids] Error:", err.message); return []; }
    });

    // Total belanja kumulatif per pelanggan (untuk loyalty tier basis "lifetime").
    // Dihitung dari `total` transaksi yang punya customerId. Transaksi void
    // (voided/void) tetap disertakan apa adanya — healing void dilakukan di
    // renderer (healVoidedTrx) dan tidak memengaruhi agregat ini secara material.
    ipcMain.handle("customer-totals", () => {
      if (!db) return [];
      try {
        return db.prepare(
          `SELECT json_extract(data, '$.customerId') as customerId,
                  SUM(json_extract(data, '$.total')) as total
           FROM transactions
           WHERE json_extract(data, '$.customerId') IS NOT NULL
           GROUP BY json_extract(data, '$.customerId')`
        ).all().filter((row) => row.customerId);
      } catch (err) { console.error("[customer-totals] Error:", err.message); return []; }
    });

    ipcMain.handle("trx-save", (_e, trx) => {
      if (!db) { const list = rJSON(files.trx) || []; list.unshift(trx); atomicWrite(files.trx, list); return { ok: true }; }
      try { db.prepare("INSERT INTO transactions (id, data) VALUES (?, ?)").run(trx.id || null, JSON.stringify(trx)); return { ok: true }; }
      catch (err) { console.error("[trx-save] Error:", err.message); return { ok: false, error: err.message }; }
    });

    // ── Cloud sync bookkeeping (PLAN-WEBSYNC) ────────────────────────────────
    // Transaksi dianggap "belum terkirim" selama synced_at IS NULL.
    ipcMain.handle("trx-count-unsynced", () => {
      if (!db) return 0;
      try { return db.prepare("SELECT COUNT(*) as total FROM transactions WHERE synced_at IS NULL").get().total || 0; }
      catch (err) { console.error("[trx-count-unsynced] Error:", err.message); return 0; }
    });

    // Ambil batch transaksi yang belum disinkronkan sebagai payload ringan:
    // { id, occurredAt, payload }. Non-void DAN void tetap dikirim (web-app
    // perlu tahu koreksi/void), jadi tidak ada filter status di sini.
    ipcMain.handle("trx-list-unsynced", (_e, { limit = 2000 } = {}) => {
      if (!db) return [];
      try {
        const rows = db.prepare("SELECT id, data, created_at FROM transactions WHERE synced_at IS NULL ORDER BY created_at ASC LIMIT ?").all(limit);
        return rows.map((row) => {
          let parsed = {};
          try { parsed = JSON.parse(row.data); } catch { parsed = { id: row.id }; }
          return { id: row.id, occurredAt: parsed?.createdAt || row.created_at, payload: parsed };
        });
      } catch (err) { console.error("[trx-list-unsynced] Error:", err.message); return []; }
    });

    // Tandai transaksi sudah terkirim. `syncedAt` = ISO timestamp dari renderer
    // (atau sekarang). Hanya baris dengan synced_at NULL yang disentuh supaya
    // retry tidak menimpa waktu sync sebelumnya.
    ipcMain.handle("trx-mark-synced", (_e, { ids = [], syncedAt } = {}) => {
      if (!db) return { ok: true, updated: 0 };
      try {
        if (!Array.isArray(ids) || ids.length === 0) return { ok: true, updated: 0 };
        const stamp = syncedAt || new Date().toISOString();
        const stmt = db.prepare("UPDATE transactions SET synced_at = ? WHERE id = ? AND synced_at IS NULL");
        let updated = 0;
        db.transaction((list) => { for (const id of list) updated += stmt.run(stamp, String(id)).changes; })(ids);
        return { ok: true, updated };
      } catch (err) { console.error("[trx-mark-synced] Error:", err.message); return { ok: false, error: err.message, updated: 0 }; }
    });
    ipcMain.handle("trx-delete", (_e, id, { restoreStock = false } = {}) => {
      // Langkah 2b: opsi mengembalikan stok saat transaksi dihapus. Transaksi
      // void SELALU dilewati (stoknya sudah kembali saat void, Langkah 1).
      // `applied` = peta {id: stok_akhir} untuk undo (dinegasikan oleh renderer).
      if (!db) {
        const all = rJSON(files.trx) || [];
        const trx = all.find((item) => String(item.id) === String(id)) || null;
        atomicWrite(files.trx, all.filter((item) => String(item.id) !== String(id)));
        let applied = {};
        if (restoreStock && trx && !isTrxVoided(trx)) {
          const { menu } = restoreStockFromTrx(trx);
          if (menu && menu.length) atomicWrite(files.menu, menu);
          applied = stockDeltasFromTrx(trx, 1);
        }
        return { ok: true, trx, applied };
      }
      try {
        const row = db.prepare("SELECT data FROM transactions WHERE id = ?").get(id);
        const trx = row ? JSON.parse(row.data) : null;
        let applied = {};
        const run = db.transaction(() => {
          db.prepare("DELETE FROM transactions WHERE id = ?").run(id);
          if (restoreStock && trx && !isTrxVoided(trx)) {
            applied = applyStockDelta(stockDeltasFromTrx(trx, 1), { type: "trx-delete", ref: id });
          }
        });
        run();
        return { ok: true, trx, applied };
      } catch (err) { console.error("[trx-delete] Error:", err.message); return { ok: false, error: err.message }; }
    });
    ipcMain.handle("trx-void", (_e, id, { reason, actor, note } = {}) => {
      const patch = { status: "voided", voidedAt: new Date().toISOString(), voidedBy: actor || null, voidReason: reason || null, voidNote: note || "" };
      if (!db) {
        const all = rJSON(files.trx) || [];
        const found = all.find((t) => String(t.id) === String(id));
        if (!found) return { ok: false, error: "Transaksi tidak ditemukan" };
        // Cegah restore stok ganda: void dua kali hanya menandai sekali.
        if (found.status === "voided" || found.voided === true) {
          return { ok: false, error: "Transaksi sudah void" };
        }
        const { menu } = restoreStockFromTrx(found);
        if (menu && menu.length) atomicWrite(files.menu, menu);
        const updated = all.map(t => String(t.id) === String(id) ? { ...t, ...patch } : t);
        atomicWrite(files.trx, updated);
        return { ok: true, menu, items: Array.isArray(found.items) ? found.items : [], sourceRef: found.kdsSourceRef || found.id, kdsTicketSent: found.kdsTicketSent === true };
      }
      try {
        const row = db.prepare("SELECT data FROM transactions WHERE id = ?").get(id);
        if (!row) return { ok: false, error: "Transaksi tidak ditemukan" };
        const current = JSON.parse(row.data);
        if (current.status === "voided" || current.voided === true) {
          return { ok: false, error: "Transaksi sudah void" };
        }
        const merged = { ...current, ...patch };
        let menu = null;
        const run = db.transaction(() => {
          db.prepare("UPDATE transactions SET data = ? WHERE id = ?").run(JSON.stringify(merged), id);
          // Void mengembalikan stok (Langkah 1) — lewat satu pintu applyStockDelta.
          applyStockDelta(stockDeltasFromTrx(current, 1), { type: "void", ref: id });
        });
        run();
        menu = loadMenuList();
        atomicWrite(files.menu, menu); // cermin untuk backup lama & fallback
        return { ok: true, menu, items: Array.isArray(current.items) ? current.items : [], sourceRef: current.kdsSourceRef || current.id, kdsTicketSent: current.kdsTicketSent === true };
      } catch (err) {
        console.error("[trx-void] Error:", err.message);
        return { ok: false, error: err.message };
      }
    });
    ipcMain.handle("trx-settle", (_e, id, actor) => {
  const patch = { settled: true, settledAt: new Date().toISOString(), settledBy: actor != null ? actor : null };
  if (!db) {
    const all = rJSON(files.trx) || [];
    const found = all.find((t) => String(t.id) === String(id));
    if (!found) return { ok: false, error: "Transaksi tidak ditemukan" };
    if (found.status === "voided" || found.voided === true) return { ok: false, error: "Transaksi sudah void" };
    const updated = all.map((t) => String(t.id) === String(id) ? Object.assign({}, t, patch, { bayar: Number(t.total || 0) }) : t);
    atomicWrite(files.trx, updated);
    return { ok: true };
  }
  try {
    const row = db.prepare("SELECT data FROM transactions WHERE id = ?").get(id);
    if (!row) return { ok: false, error: "Transaksi tidak ditemukan" };
    const current = JSON.parse(row.data);
    if (current.status === "voided" || current.voided === true) return { ok: false, error: "Transaksi sudah void" };
    const merged = Object.assign({}, current, patch, { bayar: Number(current.total || 0) });
    db.prepare("UPDATE transactions SET data = ? WHERE id = ?").run(JSON.stringify(merged), id);
    return { ok: true };
  } catch (err) {
    console.error("[trx-settle] Error:", err.message);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("trx-restore", (_e, list) => {
      if (!db) { atomicWrite(files.trx, list); return { ok: true }; }
      try { db.exec("DELETE FROM transactions"); const stmt = db.prepare("INSERT INTO transactions (id, data) VALUES (?, ?)"); db.transaction((items) => items.forEach((item) => stmt.run(item.id || null, JSON.stringify(item))))(list); return { ok: true }; }
      catch (err) { console.error("[trx-restore] Error:", err.message); return { ok: false, error: err.message }; }
    });
    ipcMain.handle("trx-clear", (_e, { restoreStock = false } = {}) => {
      // Snapshot SELURUH transaksi ke file dulu, supaya undo "Hapus Semua" tidak
      // bergantung pada satu halaman riwayat di renderer. File juga jadi jaring
      // pengaman setelah jendela undo 9 detik lewat.
      let backupFile = null;
      let all = [];
      try {
        ensureDir();
        all = db
          ? db.prepare("SELECT id, data FROM transactions ORDER BY created_at DESC").all().map((row) => JSON.parse(row.data))
          : (rJSON(files.trx) || []);
        if (all.length) {
          if (!fs.existsSync(files.jsonBackups)) fs.mkdirSync(files.jsonBackups, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          backupFile = `${files.jsonBackups}/trx-cleared-${stamp}.json`;
          atomicWrite(backupFile, all);
        }
      } catch (err) { console.error("[trx-clear] Snapshot error:", err.message); }
      // Agregasi stok untuk SEMUA transaksi non-void (bukan cuma satu halaman
      // history), lalu kembalikan lewat satu pintu applyStockDelta.
      const aggregateDeltas = () => {
        const total = {};
        for (const t of all) {
          if (!t || isTrxVoided(t)) continue;
          for (const [id, qty] of Object.entries(stockDeltasFromTrx(t, 1))) {
            total[id] = (total[id] || 0) + qty;
          }
        }
        return total;
      };
      if (!db) {
        let applied = {};
        if (restoreStock) {
          const deltas = aggregateDeltas();
          const menu = rJSON(files.menu) || [];
          const byId = new Map(menu.map((m) => [String(m.id), { ...m }]));
          applied = {};
          for (const [id, qty] of Object.entries(deltas)) {
            const m = byId.get(String(id));
            if (!m) continue;
            if (m.stok === null || m.stok === undefined) continue;
            m.stok = Math.max(0, Number(m.stok) + qty);
            applied[id] = m.stok;
          }
          if (menu.length) atomicWrite(files.menu, [...byId.values()]);
        }
        atomicWrite(files.trx, []);
        return { ok: true, backupFile, applied, cleared: all };
      }
      try {
        let applied = {};
        const run = db.transaction(() => {
          if (restoreStock) applied = applyStockDelta(aggregateDeltas(), { type: "trx-clear" });
          db.exec("DELETE FROM transactions");
        });
        run();
        // `cleared` dipakai renderer untuk memulihkan stok bahan baku (bahan
        // baku ada di renderer, bukan di main process).
        return { ok: true, backupFile, applied, cleared: all };
      }
      catch (err) { console.error("[trx-clear] Error:", err.message); return { ok: false, error: err.message }; }
    });
    // Langkah 2b: preview baca-saja untuk teks konfirmasi ("+N unit dari M
    // transaksi"). `skipped` = jumlah transaksi yang dilewati (void).
    ipcMain.handle("trx-restore-preview", (_e, { id, all: allFlag } = {}) => {
      try {
        const list = db
          ? db.prepare("SELECT id, data FROM transactions ORDER BY created_at DESC").all().map((row) => JSON.parse(row.data))
          : (rJSON(files.trx) || []);
        const pool = allFlag ? list : list.filter((t) => String(t.id) === String(id));
        let trxCount = 0, totalQty = 0, skipped = 0;
        for (const t of pool) {
          if (!t || isTrxVoided(t)) { skipped += 1; continue; }
          const deltas = stockDeltasFromTrx(t, 1);
          const qty = Object.values(deltas).reduce((s, n) => s + Math.abs(n), 0);
          if (qty === 0) { skipped += 1; continue; }
          trxCount += 1;
          totalQty += qty;
        }
        return { ok: true, trxCount, totalQty, skipped };
      } catch (err) {
        console.error("[trx-restore-preview] Error:", err.message);
        return { ok: false, error: err.message, trxCount: 0, totalQty: 0, skipped: 0 };
      }
    });
    ipcMain.handle("trx-restore-cleared", (_e, backupFile) => {
      // Hanya boleh membaca file di dalam jsonBackups (cegah path traversal).
      try {
        if (!backupFile) return { ok: false, error: "File backup tidak diberikan" };
        const base = path.resolve(files.jsonBackups);
        const target = path.resolve(String(backupFile));
        if (target !== base && !target.startsWith(base + path.sep)) return { ok: false, error: "File di luar folder backup" };
        if (!fs.existsSync(target)) return { ok: false, error: "File backup tidak ditemukan" };
        const list = rJSON(target);
        if (!Array.isArray(list)) return { ok: false, error: "Isi backup tidak valid" };
        if (!db) {
          const all = rJSON(files.trx) || [];
          const seen = new Set(all.map((t) => String(t.id)));
          const merged = [...all, ...list.filter((t) => t && !seen.has(String(t.id)))];
          atomicWrite(files.trx, merged);
          return { ok: true, restored: merged.length - all.length };
        }
        const stmt = db.prepare("INSERT OR IGNORE INTO transactions (id, data) VALUES (?, ?)");
        const info = db.transaction((items) => {
          let n = 0;
          items.forEach((item) => { if (item) n += stmt.run(item.id || null, JSON.stringify(item)).changes; });
          return n;
        })(list);
        return { ok: true, restored: info };
      } catch (err) {
        console.error("[trx-restore-cleared] Error:", err.message);
        return { ok: false, error: err.message };
      }
    });
    // Deltas stok dari item transaksi. Baris satuan memakai baseQty.
    // Item `additionals` tidak memotong stok (bukan SKU).
    function stockDeltasFromTrx(trx, sign) {
      const deltas = {};
      const items = Array.isArray(trx?.items) ? trx.items : [];
      for (const it of items) {
        if (!it || it.id === undefined || it.id === null) continue;
        const qty = Number(it.baseQty ?? it.qty) || 0;
        if (qty === 0) continue;
        deltas[String(it.id)] = (deltas[String(it.id)] || 0) + sign * qty;
      }
      return deltas;
    }

    ipcMain.handle("process-payment", (_e, { trx, updatedMenu, activeBillId }) => {
      try {
        if (!db) {
          const allTrx = rJSON(files.trx) || []; allTrx.unshift(trx); atomicWrite(files.trx, allTrx);
          if (updatedMenu) atomicWrite(files.menu, updatedMenu);
          if (activeBillId) atomicWrite(files.bills, (rJSON(files.bills) || []).filter((bill) => String(bill.id) !== String(activeBillId)));
          return { ok: true, stock: {} };
        }
        walAppend(trx);
        // INSERT transaksi + potong stok dalam SATU transaksi SQLite. Kalau
        // bayar dari open bill, stok sudah dipotong saat bill dibuat -> skip.
        let stock = {};
        const run = db.transaction(() => {
          db.prepare("INSERT INTO transactions (id, data) VALUES (?, ?)").run(trx.id || null, JSON.stringify(trx));
          if (!activeBillId) stock = applyStockDelta(stockDeltasFromTrx(trx, -1), { type: "sale", ref: trx?.id });
        });
        run();
        if (activeBillId) atomicWrite(files.bills, (rJSON(files.bills) || []).filter((bill) => String(bill.id) !== String(activeBillId)));
        walClear();
        return { ok: true, stock };
      } catch (err) { console.error("[process-payment] Error:", err.message); return { ok: false, error: err.message }; }
    });
    ipcMain.handle("shifts-load", () => {
      if (!db) return [];
      try { return db.prepare("SELECT id, data FROM shifts ORDER BY created_at DESC").all().map((row) => JSON.parse(row.data)); }
      catch (err) { console.error("[shifts-load] Error:", err.message); return []; }
    });
    ipcMain.handle("shifts-save", (_e, list) => {
      if (!db) { atomicWrite(files.shifts, list); return { ok: true }; }
      try { db.exec("DELETE FROM shifts"); const stmt = db.prepare("INSERT INTO shifts (id, data) VALUES (?, ?)"); db.transaction((items) => items.forEach((item) => stmt.run(item.id || null, JSON.stringify(item))))(list); return { ok: true }; }
      catch (err) { console.error("[shifts-save] Error:", err.message); return { ok: false, error: err.message }; }
    });
  }

  // loadTrx / loadShifts — baca LANGSUNG dari SQLite (bukan JSON) untuk
  // dipakai layanan backup (Bug #5: transaksi & shift hidup di SQLite, jadi
  // file JSON lama sering kosong/basi). Mengembalikan null kalau DB/mesin
  // tidak tersedia supaya pemanggil bisa jatuh ke JSON.
  function loadTrx() {
    if (!db) return null;
    try { return db.prepare("SELECT id, data FROM transactions ORDER BY created_at DESC").all().map((row) => JSON.parse(row.data)); }
    catch (err) { console.error("[loadTrx] Error:", err.message); return null; }
  }
  function loadShifts() {
    if (!db) return null;
    try { return db.prepare("SELECT id, data FROM shifts ORDER BY created_at DESC").all().map((row) => JSON.parse(row.data)); }
    catch (err) { console.error("[loadShifts] Error:", err.message); return null; }
  }

  // ── Sync helpers (dipakai auto-sync di main process) ──────────────────────
  function countUnsyncedTransactions() {
    if (!db) return 0;
    try { return db.prepare("SELECT COUNT(*) as total FROM transactions WHERE synced_at IS NULL").get().total || 0; }
    catch (err) { console.error("[countUnsyncedTransactions] Error:", err.message); return 0; }
  }
  function listUnsyncedTransactions(limit = 2000) {
    if (!db) return [];
    try {
      const rows = db.prepare("SELECT id, data, created_at FROM transactions WHERE synced_at IS NULL ORDER BY created_at ASC LIMIT ?").all(limit);
      return rows.map((row) => {
        let parsed = {};
        try { parsed = JSON.parse(row.data); } catch { parsed = { id: row.id }; }
        return { id: row.id, occurredAt: parsed?.createdAt || row.created_at, payload: parsed };
      });
    } catch (err) { console.error("[listUnsyncedTransactions] Error:", err.message); return []; }
  }
  function markTransactionsSynced(ids = [], syncedAt) {
    if (!db) return { ok: true, updated: 0 };
    try {
      if (!Array.isArray(ids) || ids.length === 0) return { ok: true, updated: 0 };
      const stamp = syncedAt || new Date().toISOString();
      const stmt = db.prepare("UPDATE transactions SET synced_at = ? WHERE id = ? AND synced_at IS NULL");
      let updated = 0;
      db.transaction((list) => { for (const id of list) updated += stmt.run(stamp, String(id)).changes; })(ids);
      return { ok: true, updated };
    } catch (err) { console.error("[markTransactionsSynced] Error:", err.message); return { ok: false, error: err.message, updated: 0 }; }
  }

  return { initDB, migrateJSONToSQLite, migrateMenuToProducts, closeDB, registerHandlers, applyStockDelta, applyRemoteMenuRestock, claimIngredientRestock, completeIngredientRestock, loadMenuList, replaceMenuList, restoreStockFromTrx, loadTrx, loadShifts, countUnsyncedTransactions, listUnsyncedTransactions, markTransactionsSynced };
}

module.exports = { createDatabaseService };
