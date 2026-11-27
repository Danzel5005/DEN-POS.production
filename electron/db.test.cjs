import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// better-sqlite3 adalah native module yang di-rebuild untuk ABI Electron
// (lihat script postinstall `@electron/rebuild`), jadi binary-nya TIDAK bisa
// di-require dari Node biasa yang dipakai Vitest. Supaya tes tetap deterministik
// di mesin mana pun, kita suntik implementasi in-memory dengan semantik SQL
// terbatas yang benar-benar dipakai db.cjs (lihat FakeStatement/FakeDatabase).
// ---------------------------------------------------------------------------
class FakeStatement {
  constructor(db, sql) { this.db = db; this.sql = sql; }
  run(...params) { return this.db._run(this.sql, params); }
  get(...params) { return this.db._all(this.sql, params)[0]; }
  all(...params) { return this.db._all(this.sql, params); }
}

const DATE_EXPR = String.raw`date\(created_at\)`;
const SHIFT_EXPR = String.raw`json_extract\(data, '\$\.shiftId'\)`;
const NUM = /^-?\d+(\.\d+)?$/;

class FakeDatabase {
  constructor() { this.tables = { transactions: [], shifts: [] }; this.closed = false; this.nextRowid = 1; }
  pragma() { return "wal"; }
  exec(sql) {
    for (const stmt of String(sql).split(";").map((s) => s.trim()).filter(Boolean)) {
      const del = /^DELETE\s+FROM\s+(\w+)$/i.exec(stmt);
      if (del) { this.tables[del[1]] = []; continue; }
      if (/^(CREATE|PRAGMA|BEGIN|COMMIT)/i.test(stmt)) continue; // DDL di tidak diuji
      throw new Error(`FakeDatabase.exec belum mendukung: ${stmt}`);
    }
  }
  prepare(sql) { return new FakeStatement(this, sql.replace(/\s+/g, " ").trim()); }
  transaction(fn) { return (...args) => fn(...args); }
  close() { this.closed = true; }

  _rows(table) { return this.tables[table] || []; }

  // Mengevaluasi ekspresi SELECT/WHERE yang dipakai db.cjs terhadap satu baris.
  _value(row, expr) {
    const e = expr.trim();
    if (e === "id") return row.id;
    if (e === "event_id") return row.event_id;
    if (e === "status") return row.status;
    if (e === "data") return row.data;
    if (e === "created_at") return row.created_at;
    if (e === "synced_at") return row.synced_at;
    if (e === "deleted_at") return row.deleted_at;
    if (e === "stock_restored") return row.stock_restored;
    if (e === "menu_id") return row.menu_id;
    if (e === "kategori") return row.kategori;
    if (e === "stok") return row.stok;
    if (e === "product_id") return row.product_id;
    if (e === "nama") return row.nama;
    if (e === "type") return row.type;
    if (e === "delta") return row.delta;
    if (e === "stok_after") return row.stok_after;
    if (e === "ref") return row.ref;
    if (e === "actor") return row.actor;
    if (e === "note") return row.note;
    if (new RegExp(`^${DATE_EXPR}$`).test(e)) return row.created_at.slice(0, 10);
    const j = new RegExp(`^json_extract\\(data, '\\$\\.(\\w+)'\\)$`).exec(e);
    if (j) { try { return JSON.parse(row.data)?.[j[1]]; } catch { return undefined; } }
    if (e === "COUNT(*) as total" || e === "COUNT(*) as count") return null;
    if (/^SUM\(/.test(e)) return null;
    throw new Error(`FakeDatabase._value belum mendukung ekspresi: ${e}`);
  }

  _sort(rows, clause) {
    const m = /ORDER BY (.+?)(?: LIMIT|$)/i.exec(clause || "");
    if (!m) return rows;
    const desc = /DESC/i.test(m[1]);
    const lower = m[1].toLowerCase();
    const sorted = [...rows].sort((a, b) => {
      if (lower.includes("json_extract")) {
        const av = this._value(a, `json_extract(data, '$.shiftId')`) ?? "";
        const bv = this._value(b, `json_extract(data, '$.shiftId')`) ?? "";
        return av === bv ? 0 : (av < bv ? -1 : 1);
      }
      if (lower.includes("date(created_at)")) {
        const av = a.created_at.slice(0, 10); const bv = b.created_at.slice(0, 10);
        return av === bv ? 0 : (av < bv ? -1 : 1);
      }
      const av = lower === "id" ? a.id : lower === "deleted_at" ? a.deleted_at : a.created_at;
      const bv = lower === "id" ? b.id : lower === "deleted_at" ? b.deleted_at : b.created_at;
      return av === bv ? 0 : (av < bv ? -1 : 1);
    });
    return desc ? sorted.reverse() : sorted;
  }

  _where(row, clause) {
    const m = /WHERE (.+?)(?: GROUP BY| ORDER BY| LIMIT|$)/i.exec(clause || "");
    if (!m || m[1].trim() === "") return true;
    const cond = m[1].trim();

    const isNull = new RegExp(`^${SHIFT_EXPR} IS NOT NULL$`, "i").exec(cond);
    if (isNull) {
      const v = this._value(row, `json_extract(data, '$.shiftId')`);
      return v !== undefined && v !== null;
    }

    // synced_at IS NULL / IS NOT NULL — untuk query pending cloud sync.
    const syncedNull = /^synced_at\s+IS\s+(NOT\s+)?NULL$/i.exec(cond);
    if (syncedNull) {
      const isNullValue = row.synced_at === undefined || row.synced_at === null;
      return syncedNull[1] ? !isNullValue : isNullValue;
    }

    const like = /^(.+?)\s+LIKE\s+\?$/i.exec(cond);
    if (like) {
      const value = this._value(row, like[1]);
      const pattern = String(this._lastParams?.[this._popped++] ?? "");
      return pattern.endsWith("%") && String(value).startsWith(pattern.slice(0, -1));
    }

    const cmp = /^(.+?)\s*(>=|<=|!=|=)\s*(\?|\d+|'[^']*')$/i.exec(cond);
    if (cmp) {
      const left = this._value(row, cmp[1]);
      const op = cmp[2];
      const right = cmp[3] === "?" ? this._lastParams?.[this._popped++] : cmp[3].replace(/^'|'$/g, "");
      if (op === "=") return String(left) === String(right);
      if (op === "!=") return String(left) !== String(right);
      if (op === ">=") return String(left) >= String(right);
      if (op === "<=") return String(left) <= String(right);
    }

    // Kondisi gabungan "A = ? AND B IS NULL" (dipakai penanda synced_at).
    const andParts = cond.split(/\s+AND\s+/i);
    if (andParts.length > 1) {
      return andParts.every((part) => this._where(row, `WHERE ${part}`));
    }
    throw new Error(`FakeDatabase._where belum mendukung kondisi: ${cond}`);
  }

  _all(sql, params) {
    // PRAGMA table_info(<table>) — dipakai db.cjs ensureColumn untuk migrasi.
    const pragma = /^PRAGMA\s+table_info\((\w+)\)$/i.exec(sql);
    if (pragma) {
      const table = pragma[1];
      // FakeDatabase hanya memodelkan kolom yang benar-benar dipakai db.cjs.
      const base = table === "transactions"
        ? ["id", "data", "created_at", "synced_at"]
        : ["id", "data", "created_at"];
      return base.map((name, cid) => ({ cid, name }));
    }
    const table = /FROM\s+(\w+)/i.exec(sql)?.[1];
    if (!table) throw new Error(`FakeDatabase: tidak menemukan tabel di: ${sql}`);
    this._lastParams = params;
    // PENTING: tiap baris membaca ulang parameter `?` yang sama, jadi pointer
    // parameter harus di-reset PER BARIS. Kalau hanya di-reset sekali di sini,
    // WHERE yang cocok bukan dengan baris pertama akan salah menilai (bug laten
    // yang muncul begitu ada query `WHERE id = ?` pada tabel berisi >1 baris).
    let rows = this._rows(table).filter((row) => { this._popped = 0; return this._where(row, sql); });

    if (/GROUP BY/i.test(sql)) {
      const grouped = new Map();
      for (const row of rows) {
        const key = row.created_at.slice(0, 10);
        const cur = grouped.get(key) || { date: key, count: 0, total: 0, pax: 0, subtotal: 0 };
        cur.count += 1;
        try {
          const d = JSON.parse(row.data) || {};
          cur.total += Number(d.total) || 0;
          cur.pax += Number(d.pax) || 0;
          cur.subtotal += Number(d.subtotal) || 0;
        } catch { /* baris rusak diabaikan */ }
        grouped.set(key, cur);
      }
      return this._sort([...grouped.values()], sql);
    }

    const select = sql.slice(0, sql.search(/\s+FROM\s/i)).replace(/^SELECT\s+/i, "");
    if (select.trim() !== "*") {
      // trx-get-shift-ids: SELECT DISTINCT json_extract(data, '$.shiftId') as shiftId
      // Dicek SEBELUM regex generik supaya tidak salah masuk jalur proyeksi kolom.
      if (new RegExp(`^DISTINCT\\s+${SHIFT_EXPR} as shiftId$`, "i").test(select.trim())) {
        const seen = new Set();
        const out = [];
        for (const row of rows) {
          const v = this._value(row, `json_extract(data, '$.shiftId')`);
          if (v !== undefined && v !== null && !seen.has(v)) { seen.add(v); out.push({ shiftId: v }); }
        }
        return out.sort((a, b) => (a.shiftId === b.shiftId ? 0 : (a.shiftId < b.shiftId ? 1 : -1)));
      }
      const wants = (expr) => new RegExp(`(^|,\\s*)${expr}(\\s*(as\\s+\\w+)?)?\\s*(,|$)`).test(select);
      const projection = {};
      if (wants("id")) projection.id = (row) => row.id;
      if (wants("event_id")) projection.event_id = (row) => row.event_id;
      if (wants("status")) projection.status = (row) => row.status;
      if (wants("menu_id")) projection.menu_id = (row) => row.menu_id;
      if (wants("kategori")) projection.kategori = (row) => row.kategori;
      if (wants("stok")) projection.stok = (row) => row.stok;
      if (wants("data")) projection.data = (row) => row.data;
      if (wants("created_at")) projection.created_at = (row) => row.created_at;
      if (wants("deleted_at")) projection.deleted_at = (row) => row.deleted_at;
      if (wants("stock_restored")) projection.stock_restored = (row) => row.stock_restored;
      // COUNT(*) as total / as count — dipakai trx-load-filtered.
      if (/^COUNT\(\*\) as (total|count)$/i.test(select.trim())) {
        const alias = /\bas\s+(total|count)$/i.exec(select.trim())[1];
        return [{ [alias]: rows.length }];
      }
      const done = new RegExp(`(^|,\\s*)(COUNT|SUM|${DATE_EXPR}|${SHIFT_EXPR})`, "i");
      if (done.test(select)) {
        // Query agregat/ekspresi khusus: hanya trx-get-shift-ids yang dipakai.
        if (new RegExp(`^${SHIFT_EXPR} as shiftId$`, "i").test(select.trim())) {
          const seen = new Set();
          const out = [];
          for (const row of rows) {
            const v = this._value(row, `json_extract(data, '$.shiftId')`);
            if (v !== undefined && v !== null && !seen.has(v)) { seen.add(v); out.push({ shiftId: v }); }
          }
          return out.sort((a, b) => (a.shiftId === b.shiftId ? 0 : (a.shiftId < b.shiftId ? 1 : -1)));
        }
        throw new Error(`FakeDatabase: SELECT tidak didukung: ${select}`);
      }
      rows = rows.map((row) => {
        const out = {};
        for (const [key, fn] of Object.entries(projection)) out[key] = fn(row);
        return out;
      });
    } else {
      // SELECT * — bentuk kolom bergantung tabel. transactions/shifts hanya
      // punya (id, data, created_at); stock_movements diekspos utuh.
      if (table === "stock_movements") {
        rows = rows.map((row) => ({ ...row }));
      } else {
        rows = rows.map((row) => ({ id: row.id, data: row.data, created_at: row.created_at }));
      }
    }

    rows = this._sort(rows, sql);

    // LIMIT ? OFFSET ?, atau LIMIT <n> [OFFSET <n>]. Nilai "?" diambil dari
    // parameter SETELAH parameter WHERE yang sudah dikonsumsi.
    const limit = /LIMIT\s+(\?|\d+)\s*(?:OFFSET\s+(\?|\d+))?/i.exec(sql);
    if (limit) {
      const pick = (token, index) => (token === "?" ? params[index] : Number(token));
      let size = pick(limit[1], this._popped);
      let offset = limit[2] ? pick(limit[2], this._popped + (limit[1] === "?" ? 1 : 0)) : 0;
      size = Number(size);
      if (Number.isFinite(size) && Number.isFinite(offset)) rows = rows.slice(offset, offset + size);
    }
    return rows;
  }

  _run(sql, params) {
    const remoteInsert = /^INSERT (OR IGNORE )?INTO\s+remote_restock_events\s*\(/i.exec(sql);
    if (remoteInsert) {
      const tableRows = this.tables.remote_restock_events || (this.tables.remote_restock_events = []);
      const existing = tableRows.some((row) => row.event_id === params[0]);
      if (existing && remoteInsert[1]) return { changes: 0 };
      if (existing) throw new Error("UNIQUE constraint failed");
      const itemType = /'ingredient'/i.test(sql) ? "ingredient" : "menu";
      const status = /'claimed'/i.test(sql) ? "claimed" : /'rejected'/i.test(sql) ? "rejected" : "applied";
      tableRows.push({ event_id: params[0], item_type: itemType, item_id: params[1], item_name: params[2], qty: params[3], status, created_at: new Date().toISOString() });
      return { changes: 1 };
    }
    const insert = /^INSERT (OR IGNORE |OR REPLACE )?INTO\s+(\w+)\s*\((.*?)\)\s*VALUES\s*\((.*?)\)$/i.exec(sql);
    if (insert) {
      const [, mode, table, colsRaw] = insert;
      const ignore = mode === "OR IGNORE ";
      const replace = mode === "OR REPLACE ";
      const cols = colsRaw.split(",").map((c) => c.trim());
      const rows = this.tables[table] || (this.tables[table] = []);
      const row = { rowid: this.nextRowid++, created_at: new Date().toISOString() };
      cols.forEach((col, i) => { row[col] = params[i]; });
      const uniqueColumn = cols.includes("id") ? "id" : cols.includes("event_id") ? "event_id" : null;
      if (replace && uniqueColumn) {
        const idx = rows.findIndex((r) => r[uniqueColumn] === row[uniqueColumn]);
        if (idx >= 0) { rows[idx] = row; return { changes: 1 }; }
      }
      if (ignore && uniqueColumn && rows.some((r) => r[uniqueColumn] === row[uniqueColumn])) return { changes: 0 };
      if (uniqueColumn && rows.some((r) => r[uniqueColumn] === row[uniqueColumn])) {
        const err = new Error("UNIQUE constraint failed");
        err.code = "SQLITE_CONSTRAINT_PRIMARYKEY";
        throw err;
      }
      rows.push(row);
      return { changes: 1 };
    }

    const update = /^UPDATE\s+(\w+)\s+SET\s+data\s*=\s*\?\s+WHERE\s+id\s*=\s*\?$/i.exec(sql);
    if (update) {
      const rows = this.tables[update[1]] || [];
      const target = rows.find((r) => r.id === params[1]);
      if (!target) return { changes: 0 };
      target.data = params[0];
      return { changes: 1 };
    }

    const completeRestock = /^UPDATE\s+remote_restock_events\s+SET\s+status\s*=\s*'applied'\s+WHERE\s+event_id\s*=\s*\?\s+AND\s+item_type\s*=\s*'ingredient'\s+AND\s+status\s*=\s*'claimed'$/i.exec(sql);
    if (completeRestock) {
      const target = (this.tables.remote_restock_events || []).find((row) => row.event_id === params[0] && row.item_type === "ingredient" && row.status === "claimed");
      if (!target) return { changes: 0 };
      target.status = "applied";
      return { changes: 1 };
    }

    // UPDATE transactions SET synced_at = ? WHERE id = ? AND synced_at IS NULL
    const updSynced = /^UPDATE\s+(\w+)\s+SET\s+synced_at\s*=\s*\?\s+WHERE\s+id\s*=\s*\?\s+AND\s+synced_at\s+IS\s+NULL$/i.exec(sql);
    if (updSynced) {
      const rows = this.tables[updSynced[1]] || [];
      const target = rows.find((r) => String(r.id) === String(params[1]) && (r.synced_at === undefined || r.synced_at === null));
      if (!target) return { changes: 0 };
      target.synced_at = params[0];
      return { changes: 1 };
    }

    // UPDATE products: dua bentuk (upsertMenuRow) — dengan & tanpa stok.
    const updStock = /^UPDATE\s+(\w+)\s+SET\s+kategori\s*=\s*\?\s*,\s*stok\s*=\s*\?\s*,\s*data\s*=\s*\?\s+WHERE\s+menu_id\s*=\s*\?$/i.exec(sql);
    if (updStock) {
      const rows = this.tables[updStock[1]] || [];
      const target = rows.find((r) => String(r.menu_id) === String(params[3]));
      if (!target) return { changes: 0 };
      target.kategori = params[0]; target.stok = params[1]; target.data = params[2];
      return { changes: 1 };
    }
    const updNoStock = /^UPDATE\s+(\w+)\s+SET\s+kategori\s*=\s*\?\s*,\s*data\s*=\s*\?\s+WHERE\s+menu_id\s*=\s*\?$/i.exec(sql);
    if (updNoStock) {
      const rows = this.tables[updNoStock[1]] || [];
      const target = rows.find((r) => String(r.menu_id) === String(params[2]));
      if (!target) return { changes: 0 };
      target.kategori = params[0]; target.data = params[1];
      return { changes: 1 };
    }
    const updStockOnly = /^UPDATE\s+(\w+)\s+SET\s+stok\s*=\s*\?\s+WHERE\s+menu_id\s*=\s*\?$/i.exec(sql);
    if (updStockOnly) {
      const rows = this.tables[updStockOnly[1]] || [];
      const target = rows.find((r) => String(r.menu_id) === String(params[1]));
      if (!target) return { changes: 0 };
      target.stok = params[0];
      return { changes: 1 };
    }
    // UPDATE products SET data = ? WHERE menu_id = ? (stock-in modal baru).
    const updData = /^UPDATE\s+(\w+)\s+SET\s+data\s*=\s*\?\s+WHERE\s+menu_id\s*=\s*\?$/i.exec(sql);
    if (updData) {
      const rows = this.tables[updData[1]] || [];
      const target = rows.find((r) => String(r.menu_id) === String(params[1]));
      if (!target) return { changes: 0 };
      target.data = params[0];
      return { changes: 1 };
    }

    const del = /^DELETE\s+FROM\s+(\w+)\s+WHERE\s+id\s*=\s*\?$/i.exec(sql);
    if (del) {
      const rows = this.tables[del[1]] || [];
      const before = rows.length;
      this.tables[del[1]] = rows.filter((r) => r.id !== params[0]);
      return { changes: before - this.tables[del[1]].length };
    }
    const delMenu = /^DELETE\s+FROM\s+(\w+)\s+WHERE\s+menu_id\s*=\s*\?$/i.exec(sql);
    if (delMenu) {
      const rows = this.tables[delMenu[1]] || [];
      const before = rows.length;
      this.tables[delMenu[1]] = rows.filter((r) => String(r.menu_id) !== String(params[0]));
      return { changes: before - this.tables[delMenu[1]].length };
    }
    // Purge tempat sampah: DELETE FROM trx_deleted WHERE deleted_at < ?
    const delExpired = /^DELETE\s+FROM\s+(\w+)\s+WHERE\s+deleted_at\s*<\s*\?$/i.exec(sql);
    if (delExpired) {
      const rows = this.tables[delExpired[1]] || [];
      const before = rows.length;
      this.tables[delExpired[1]] = rows.filter((r) => String(r.deleted_at) >= String(params[0]));
      return { changes: before - this.tables[delExpired[1]].length };
    }

    throw new Error(`FakeDatabase: statement tidak didukung: ${sql}`);
  }
}

class FakeBetterSqlite3 {
  static instances = [];
  constructor() { this.inner = new FakeDatabase(); FakeBetterSqlite3.instances.push(this.inner); }
  pragma(sql) { return this.inner.pragma(sql); }
  exec(sql) { return this.inner.exec(sql); }
  prepare(sql) { return this.inner.prepare(sql); }
  transaction(fn) { return this.inner.transaction(fn); }
  close() { return this.inner.close(); }
}

const dbPath = require.resolve("better-sqlite3");
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true, exports: FakeBetterSqlite3,
  children: [], paths: [],
};

const { createDatabaseService } = require("./db.cjs");

// ---------------------------------------------------------------------------
// Gap #2 — tes unit db.cjs memakai better-sqlite3 yang asli (sudah jadi
// dependency) dan `ipcMain` palsu berbentuk registry nama->handler.
// ---------------------------------------------------------------------------

let dir;
let files;
let services;

function makeService({ withWal = true } = {}) {
  const registry = {};
  const services = {
    registry,
    writes: [],
    wal: [],
    walCleared: 0,
  };
  const svc = createDatabaseService({
    ipcMain: { handle: (name, fn) => { registry[name] = fn; } },
    files,
    ensureDir: () => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); },
    rJSON: (file) => {
      if (!fs.existsSync(file)) return null;
      try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return null; }
    },
    atomicWrite: (file, data) => {
      services.writes.push({ file, data });
      fs.writeFileSync(file, JSON.stringify(data), "utf-8");
    },
    walAppend: withWal ? (trx) => services.wal.push(trx) : undefined,
    walClear: withWal ? () => { services.walCleared += 1; } : undefined,
  });
  // Nilai primitif (walCleared) TIDAK boleh di-spread: spread menyalin nilainya
  // saat itu juga, jadi closure yang menaikkan counter tidak akan terlihat oleh
  // tes. Kembalikan objek hidup yang sama.
  services.svc = svc;
  return services;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kasir-db-test-"));
  files = {
    dataDir: dir,
    db: path.join(dir, "kasir.db"),
    trx: path.join(dir, "transactions.json"),
    shifts: path.join(dir, "shifts.json"),
    menu: path.join(dir, "menu.json"),
    bills: path.join(dir, "open-bills.json"),
    jsonBackups: path.join(dir, "json-backups"),
  };
  // PENTING: hasilnya harus di-assign balik ke variabel module-level `services`.
  // Kalau tidak, badan tes membaca objek lama (counter walCleared tetap 0)
  // sementara handler menulis ke objek baru -> assertion gagal palsu.
  const built = makeService();
  services = built;
});

afterEach(() => {
  try { services.svc.closeDB(); } catch { /* sudah tertutup */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("db.cjs: initDB & registerHandlers", () => {
  it("initDB mengembalikan true dan mendaftarkan seluruh handler", () => {
    expect(services.svc.initDB()).toBe(true);
    services.svc.registerHandlers();
    expect(Object.keys(services.registry).sort()).toEqual([
      "apply-stock", "customer-totals",
      "menu-bulk-upsert", "menu-delete", "menu-load", "menu-replace", "menu-upsert",
      "process-payment", "shifts-load", "shifts-save",
      "stock-in", "stock-movements", "stock-opname", "stock-set",
      "trash-delete", "trash-load", "trash-restore",
      "trx-clear", "trx-count-unsynced", "trx-delete", "trx-get-daily-stats", "trx-get-shift-ids",
      "trx-list-unsynced",
      "trx-load", "trx-load-filtered", "trx-mark-synced", "trx-restore", "trx-restore-cleared",
      "trx-restore-preview",
      "trx-save", "trx-settle", "trx-void",
    ]);
  });

  it("handler aman dipanggil sebelum initDB (db null) tanpa melempar", () => {
    services.svc.registerHandlers();
    expect(services.registry["trx-load"]()).toEqual([]);
    expect(services.registry["shifts-load"]()).toEqual([]);
    expect(services.registry["trx-get-shift-ids"]()).toEqual([]);
    expect(services.registry["trx-get-daily-stats"](null, {})).toEqual([]);
  });
});

describe("db.cjs: CRUD transaksi (jalur SQLite)", () => {
  beforeEach(() => {
    services.svc.initDB();
    services.svc.registerHandlers();
  });

  const call = (name, ...args) => services.registry[name](null, ...args);

  it("trx-save lalu trx-load mengembalikan transaksi utuh", () => {
    expect(call("trx-save", { id: "t1", total: 25000, shiftId: "s1" })).toEqual({ ok: true });
    const loaded = call("trx-load");
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual({ id: "t1", total: 25000, shiftId: "s1" });
  });

  it("id duplikat ditolak sebagai error, bukan crash", () => {
    call("trx-save", { id: "t1", total: 1 });
    const dup = call("trx-save", { id: "t1", total: 2 });
    expect(dup.ok).toBe(false);
    expect(call("trx-load")).toHaveLength(1);
  });

  it("trx-delete menghapus tepat satu transaksi", () => {
    call("trx-save", { id: "a", total: 1 });
    call("trx-save", { id: "b", total: 2 });
    expect(call("trx-delete", "a")).toMatchObject({ ok: true });
    expect(call("trx-load").map((t) => t.id)).toEqual(["b"]);
  });

  it("trx-void mem-patch data dan menandai status voided", () => {
    call("trx-save", { id: "v1", total: 5000 });
    const res = call("trx-void", "v1", { reason: "salah input", actor: "admin", note: "n" });
    expect(res.ok).toBe(true);
    const [trx] = call("trx-load");
    expect(trx.status).toBe("voided");
    expect(trx.voidReason).toBe("salah input");
    expect(trx.voidedBy).toBe("admin");
    expect(trx.total).toBe(5000);
  });

  it("trx-void untuk id tak dikenal mengembalikan ok:false", () => {
    expect(call("trx-void", "tidak-ada", {})).toMatchObject({ ok: false });
  });

  it("trx-void mengembalikan stok item (baseQty) dan mengembalikan menu terbaru", () => {
    call("menu-replace", [
      { id: "m1", nama: "Kopi", stok: 3 },
      { id: "m2", nama: "Teh", stok: 10 },
      { id: "m3", nama: "Air", stok: null }, // stok tak terbatas -> dilewati
    ]);
    call("trx-save", {
      id: "v-stok",
      items: [
        { id: "m1", qty: 2, baseQty: 2 }, // 3 + 2 = 5
        { id: "m2", qty: 1 },             // tanpa baseQty -> pakai qty -> 11
        { id: "m3", qty: 1 },             // stok null -> dilewati
        { id: "m-hapus", qty: 5 },        // tidak ada di menu -> dilewati
      ],
    });
    const res = call("trx-void", "v-stok", { reason: "refund" });
    expect(res.ok).toBe(true);
    const menu = call("menu-load");
    const byId = Object.fromEntries(menu.map((m) => [m.id, m]));
    expect(byId.m1.stok).toBe(5);
    expect(byId.m2.stok).toBe(11);
    expect(byId.m3.stok).toBe(null);
  });

  it("trx-void dua kali ditolak supaya stok tidak kembali dua kali", () => {
    call("menu-replace", [{ id: "m1", nama: "Kopi", stok: 3 }]);
    call("trx-save", { id: "v2x", items: [{ id: "m1", qty: 2 }] });
    expect(call("trx-void", "v2x", {}).ok).toBe(true);
    const second = call("trx-void", "v2x", {});
    expect(second.ok).toBe(false);
    const byId = Object.fromEntries(call("menu-load").map((m) => [m.id, m]));
    expect(byId.m1.stok).toBe(5); // bukan 7
  });

  it("trx-restore mengganti SELURUH isi tabel", () => {
    call("trx-save", { id: "lama", total: 1 });
    expect(call("trx-restore", [{ id: "x", total: 9 }])).toEqual({ ok: true });
    expect(call("trx-load").map((t) => t.id)).toEqual(["x"]);
  });

  it("trx-clear mengosongkan tabel", () => {
    call("trx-save", { id: "a", total: 1 });
    expect(call("trx-clear")).toMatchObject({ ok: true });
    expect(call("trx-load")).toEqual([]);
  });

  it("trx-get-shift-ids mengembalikan shift unik dan mengabaikan yang kosong", () => {
    call("trx-save", { id: "a", shiftId: "s1" });
    call("trx-save", { id: "b", shiftId: "s1" });
    call("trx-save", { id: "c", shiftId: "s2" });
    call("trx-save", { id: "d" });
    const ids = call("trx-get-shift-ids");
    expect([...ids].sort()).toEqual(["s1", "s2"]);
  });

  it("trx-get-daily-stats mengagregasi total per hari", () => {
    call("trx-save", { id: "a", total: 1000, pax: 2, subtotal: 900, shiftId: "s1" });
    call("trx-save", { id: "b", total: 2000, pax: 3, subtotal: 1800, shiftId: "s1" });
    const stats = call("trx-get-daily-stats", {});
    expect(stats).toHaveLength(1);
    expect(stats[0].count).toBe(2);
    expect(stats[0].total).toBe(3000);
    expect(stats[0].pax).toBe(5);
  });

  it("trx-load-filtered memfilter berdasarkan shiftId", () => {
    call("trx-save", { id: "a", total: 1, shiftId: "s1" });
    call("trx-save", { id: "b", total: 2, shiftId: "s2" });
    const result = call("trx-load-filtered", { shiftId: "s1", page: 0, pageSize: 10 });
    expect(result.total).toBe(1);
    expect(result.transactions.map((t) => t.id)).toEqual(["a"]);
  });

  it("trx-load-filtered mem-paginate dan melaporkan total keseluruhan", () => {
    for (let i = 0; i < 5; i += 1) call("trx-save", { id: `t${i}`, total: i });
    const page1 = call("trx-load-filtered", { page: 0, pageSize: 2 });
    const page2 = call("trx-load-filtered", { page: 1, pageSize: 2 });
    expect(page1.total).toBe(5);
    expect(page1.transactions).toHaveLength(2);
    expect(page2.transactions).toHaveLength(2);
    expect(page1.transactions.map((t) => t.id)).not.toEqual(page2.transactions.map((t) => t.id));
  });
});

// Regresi bug "undo hapus bisa menghapus data": dulu undo memakai trx-restore,
// yang menimpa SELURUH tabel dengan satu halaman riwayat dari renderer. Sekarang
// undo hapus-satu memakai trx-save (INSERT tunggal) dan undo hapus-semua memakai
// snapshot penuh yang ditulis main process sebelum DELETE.
describe("db.cjs: undo hapus transaksi tidak menghapus data lain", () => {
  beforeEach(() => {
    services.svc.initDB();
    services.svc.registerHandlers();
  });
  const call = (name, ...args) => services.registry[name](null, ...args);

  it("trx-delete mengembalikan baris yang dihapus supaya bisa di-undo via trx-save", () => {
    call("trx-save", { id: "a", total: 1 });
    call("trx-save", { id: "b", total: 2 });
    const res = call("trx-delete", "a");
    expect(res.ok).toBe(true);
    expect(res.trx).toEqual({ id: "a", total: 1 });
    expect(call("trx-load").map((t) => t.id)).toEqual(["b"]);

    // Undo: INSERT tunggal, bukan restore yang menimpa tabel.
    call("trx-save", res.trx);
    expect(call("trx-load").map((t) => t.id).sort()).toEqual(["a", "b"]);
  });

  it("trx-delete id tak dikenal mengembalikan trx null tanpa melempar", () => {
    const res = call("trx-delete", "tidak-ada");
    expect(res.ok).toBe(true);
    expect(res.trx).toBeNull();
  });

  it("baris di luar halaman renderer tetap aman: hapus 1 lalu simpan ulang, total tetap", () => {
    for (let i = 0; i < 3; i += 1) call("trx-save", { id: `t${i}`, total: i });
    const res = call("trx-delete", "t1");
    call("trx-save", res.trx); // undo
    expect(call("trx-load").map((t) => t.id).sort()).toEqual(["t0", "t1", "t2"]);
  });

  it("trx-clear menulis snapshot SEMUA baris ke jsonBackups lalu mengosongkan tabel", () => {
    for (let i = 0; i < 3; i += 1) call("trx-save", { id: `t${i}`, total: i });
    const res = call("trx-clear");
    expect(res.ok).toBe(true);
    expect(typeof res.backupFile).toBe("string");
    expect(res.backupFile).toContain("trx-cleared-");
    expect(fs.existsSync(res.backupFile)).toBe(true);
    expect(call("trx-load")).toEqual([]);

    const snap = JSON.parse(fs.readFileSync(res.backupFile, "utf-8"));
    expect(snap.map((t) => t.id).sort()).toEqual(["t0", "t1", "t2"]);
  });

  it("trx-restore-cleared mengembalikan SEMUA baris snapshot (bukan cuma satu halaman)", () => {
    for (let i = 0; i < 3; i += 1) call("trx-save", { id: `t${i}`, total: i });
    const { backupFile } = call("trx-clear");
    const res = call("trx-restore-cleared", backupFile);
    expect(res.ok).toBe(true);
    expect(res.restored).toBe(3);
    expect(call("trx-load").map((t) => t.id).sort()).toEqual(["t0", "t1", "t2"]);
  });

  it("trx-restore-cleared bersifat idempotent (INSERT OR IGNORE)", () => {
    call("trx-save", { id: "a", total: 1 });
    const { backupFile } = call("trx-clear");
    expect(call("trx-restore-cleared", backupFile).restored).toBe(1);
    expect(call("trx-restore-cleared", backupFile).restored).toBe(0);
    expect(call("trx-load")).toHaveLength(1);
  });

  it("trx-restore-cleared menolak file di luar folder jsonBackups", () => {
    const outside = path.join(dir, "jahat.json");
    fs.writeFileSync(outside, JSON.stringify([{ id: "x" }]), "utf-8");
    const res = call("trx-restore-cleared", outside);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/di luar folder backup/i);
  });

  it("trx-restore-cleared menolak path traversal lewat '..'", () => {
    const res = call("trx-restore-cleared", path.join(files.jsonBackups, "..", "transactions.json"));
    expect(res.ok).toBe(false);
  });

  it("trx-clear tanpa transaksi tidak membuat file backup", () => {
    const res = call("trx-clear");
    expect(res.ok).toBe(true);
    expect(res.backupFile).toBeNull();
  });
});

describe("db.cjs: tempat sampah transaksi (30 hari)", () => {
  beforeEach(() => {
    services.svc.initDB();
    services.svc.registerHandlers();
  });
  const call = (name, ...args) => services.registry[name](null, ...args);
  const trashTable = () => FakeBetterSqlite3.instances.at(-1).tables.trx_deleted || [];

  it("trx-delete menaruh transaksi di tempat sampah dengan masa simpan 30 hari", () => {
    call("trx-save", { id: "a", total: 5000 });
    call("trx-delete", "a");
    const { ok, items } = call("trash-load");
    expect(ok).toBe(true);
    expect(items).toHaveLength(1);
    expect(items[0].trx).toEqual({ id: "a", total: 5000 });
    const days = (new Date(items[0].expiresAt) - new Date(items[0].deletedAt)) / 86400000;
    expect(Math.round(days)).toBe(30);
  });

  it("trx-clear menaruh SEMUA transaksi di tempat sampah", () => {
    call("trx-save", { id: "a", total: 1 });
    call("trx-save", { id: "b", total: 2 });
    call("trx-clear");
    expect(call("trash-load").items.map((i) => i.id).sort()).toEqual(["a", "b"]);
  });

  it("trash-restore mengembalikan transaksi ke riwayat dan mengosongkan tempat sampah", () => {
    call("trx-save", { id: "a", total: 5000 });
    call("trx-delete", "a");
    const res = call("trash-restore", "a");
    expect(res).toMatchObject({ ok: true, restored: true });
    expect(call("trx-load").map((t) => t.id)).toEqual(["a"]);
    expect(call("trash-load").items).toEqual([]);
  });

  it("trash-restore mengganti nomor yang sudah dipakai transaksi baru (+100)", () => {
    call("trx-save", { id: "TRX-2611261", total: 1 });
    call("trx-delete", "TRX-2611261");
    // Transaksi baru memakai ulang nomor yang baru saja dihapus.
    call("process-payment", { trx: { id: "TRX-2611261", total: 2 } });
    expect(call("trx-load").map((t) => t.id)).toEqual(["TRX-2611261"]);

    const res = call("trash-restore", "TRX-2611261");

    expect(res).toMatchObject({ ok: true, restored: true });
    expect(res.trx.id).toBe("TRX-261126101");
    expect(call("trx-load").map((t) => t.id).sort()).toEqual(["TRX-2611261", "TRX-261126101"]);
    expect(call("trash-load").items).toEqual([]);
  });

  it("trash-restore menaikkan lompatan ke +1000 bila +100 juga bentrok", () => {
    call("trx-save", { id: "TRX-2611261", total: 1 });
    call("trx-delete", "TRX-2611261");
    call("process-payment", { trx: { id: "TRX-2611261", total: 2 } });
    call("trx-save", { id: "TRX-261126101", total: 3 });

    const res = call("trash-restore", "TRX-2611261");

    expect(res.trx.id).toBe("TRX-2611261001");
    expect(call("trx-load").map((t) => t.id).sort()).toEqual(["TRX-2611261", "TRX-2611261001", "TRX-261126101"]);
  });

  it("trash-restore memakai id lama bila belum bentrok", () => {
    call("trx-save", { id: "TRX-2611261", kdsSourceRef: "TRX-2611261" });
    call("trx-delete", "TRX-2611261");
    const res = call("trash-restore", "TRX-2611261");
    expect(res.trx).toMatchObject({ id: "TRX-2611261", kdsSourceRef: "TRX-2611261" });
  });

  it("undo 9 detik (trx-save) mengeluarkan transaksi dari tempat sampah", () => {
    call("trx-save", { id: "a", total: 1 });
    call("trx-delete", "a");
    call("trx-save", { id: "a", total: 1 }); // undo 9 detik sempat mengembalikan
    expect(call("trx-load")).toHaveLength(1);
    expect(call("trash-load").items).toEqual([]);
    expect(call("trash-restore", "a")).toMatchObject({ ok: false });
  });

  it("trash-restore menahan stok lagi bila stok dikembalikan saat dihapus", () => {
    call("menu-replace", [{ id: "m1", nama: "Kopi", stok: 3 }]);
    call("trx-save", { id: "d1", items: [{ id: "m1", qty: 2 }] });
    call("trx-delete", "d1", { restoreStock: true }); // 3 -> 5
    expect(call("menu-load")[0].stok).toBe(5);
    const res = call("trash-restore", "d1");
    expect(res.applied).toEqual({ m1: 3 });
    expect(call("menu-load")[0].stok).toBe(3);
  });

  it("trash-restore TIDAK menyentuh stok bila stok tidak dikembalikan saat dihapus", () => {
    call("menu-replace", [{ id: "m1", nama: "Kopi", stok: 3 }]);
    call("trx-save", { id: "d2", items: [{ id: "m1", qty: 2 }] });
    call("trx-delete", "d2");
    expect(call("trash-restore", "d2").applied).toEqual({});
    expect(call("menu-load")[0].stok).toBe(3);
  });

  it("trash-delete menghapus permanen tanpa menyentuh riwayat", () => {
    call("trx-save", { id: "a", total: 1 });
    call("trx-save", { id: "b", total: 2 });
    call("trx-delete", "a");
    expect(call("trash-delete", "a")).toEqual({ ok: true });
    expect(call("trash-load").items).toEqual([]);
    expect(call("trx-load").map((t) => t.id)).toEqual(["b"]);
  });

  it("trash-load membuang baris yang lebih tua dari 30 hari", () => {
    call("trx-save", { id: "lama", total: 1 });
    call("trx-delete", "lama");
    const table = trashTable();
    table[0].deleted_at = new Date(Date.now() - 31 * 86400000).toISOString();
    expect(call("trash-load").items).toEqual([]);
  });
});

describe("db.cjs: shifts", () => {
  beforeEach(() => {
    services.svc.initDB();
    services.svc.registerHandlers();
  });
  const call = (name, ...args) => services.registry[name](null, ...args);

  it("shifts-save mengganti isi tabel dan shifts-load membacanya kembali", () => {
    call("shifts-save", [{ id: "s1", status: "open" }]);
    expect(call("shifts-load")).toEqual([{ id: "s1", status: "open" }]);
    call("shifts-save", [{ id: "s2", status: "closed" }]);
    expect(call("shifts-load").map((s) => s.id)).toEqual(["s2"]);
  });
});

describe("db.cjs: Langkah 2b — restore stok saat hapus/clear", () => {
  beforeEach(() => {
    services.svc.initDB();
    services.svc.registerHandlers();
  });

  const call = (name, ...args) => services.registry[name](null, ...args);
  const stokOf = (id) => call("menu-load").find((m) => m.id === id)?.stok;

  it("trx-delete dengan {restoreStock:true} menambah stok sebesar baseQty/qty", () => {
    call("menu-replace", [{ id: "m1", nama: "Kopi", stok: 3 }, { id: "m2", nama: "Teh", stok: 10 }]);
    call("trx-save", { id: "d1", items: [{ id: "m1", qty: 2, baseQty: 2 }, { id: "m2", qty: 1 }] });
    const res = call("trx-delete", "d1", { restoreStock: true });
    expect(res.ok).toBe(true);
    expect(res.trx.id).toBe("d1");
    expect(res.applied).toEqual({ m1: 5, m2: 11 });
    expect(stokOf("m1")).toBe(5);
    expect(stokOf("m2")).toBe(11);
    expect(call("trx-load")).toEqual([]);
  });

  it("trx-delete TANPA opsi tidak mengubah stok", () => {
    call("menu-replace", [{ id: "m1", nama: "Kopi", stok: 3 }]);
    call("trx-save", { id: "d2", items: [{ id: "m1", qty: 2 }] });
    const res = call("trx-delete", "d2", {});
    expect(res.ok).toBe(true);
    expect(res.applied).toEqual({});
    expect(stokOf("m1")).toBe(3);
  });

  it("trx-delete transaksi VOID tidak menambah stok (hindari dobel)", () => {
    call("menu-replace", [{ id: "m1", nama: "Kopi", stok: 5 }]);
    // Void sudah mengembalikan stok 3 -> 5. Hapus dengan restoreStock harus no-op.
    call("trx-save", { id: "d3", items: [{ id: "m1", qty: 2 }], status: "voided" });
    const res = call("trx-delete", "d3", { restoreStock: true });
    expect(res.ok).toBe(true);
    expect(res.applied).toEqual({});
    expect(stokOf("m1")).toBe(5);
  });

  it("trx-clear dengan {restoreStock:true} menambah sebesar Σ transaksi non-void", () => {
    call("menu-replace", [{ id: "m1", nama: "Kopi", stok: 0 }]);
    call("trx-save", { id: "c1", items: [{ id: "m1", qty: 2 }] });
    call("trx-save", { id: "c2", items: [{ id: "m1", qty: 3 }] });
    call("trx-save", { id: "c3", items: [{ id: "m1", qty: 9 }], status: "voided" }); // dilewati
    const res = call("trx-clear", { restoreStock: true });
    expect(res.ok).toBe(true);
    expect(res.applied).toEqual({ m1: 5 }); // 2 + 3, void dilewati
    expect(stokOf("m1")).toBe(5);
    expect(call("trx-load")).toEqual([]);
  });

  it("trx-restore-preview({id}) menghitung unit & melewati void", () => {
    call("trx-save", { id: "p1", items: [{ id: "m1", qty: 2 }, { id: "m2", qty: 3 }] });
    const one = call("trx-restore-preview", { id: "p1" });
    expect(one).toMatchObject({ ok: true, trxCount: 1, totalQty: 5, skipped: 0 });
  });

  it("trx-restore-preview({all:true}) mengagregasi seluruh non-void", () => {
    call("trx-save", { id: "pa", items: [{ id: "m1", qty: 2 }] });
    call("trx-save", { id: "pb", items: [{ id: "m1", qty: 3 }], status: "voided" });
    call("trx-save", { id: "pc", items: [{ id: "m1", qty: 4 }] });
    const all = call("trx-restore-preview", { all: true });
    expect(all).toMatchObject({ ok: true, trxCount: 2, totalQty: 6, skipped: 1 });
  });

});

describe("db.cjs: process-payment", () => {
  const call = (name, ...args) => services.registry[name](null, ...args);

  it("jalur SQLite menulis trx, menu, bill, dan memakai WAL", () => {
    services.svc.initDB();
    services.svc.registerHandlers();
    // Seed satu produk berstok supaya deduksi stok benar-benar terjadi.
    call("menu-upsert", { id: "m1", nama: "Kopi", stok: 10 });
    const res = call("process-payment", {
      trx: { id: "p1", total: 100, items: [{ id: "m1", nama: "Kopi", qty: 2 }] },
    });
    expect(res.ok).toBe(true);
    expect(res.stock).toEqual({ m1: 8 }); // 10 - 2
    expect(call("trx-load").map((t) => t.id)).toEqual(["p1"]);
    // Menu di tabel products ikut ter-deduksi.
    expect(call("menu-load").find((m) => m.id === "m1").stok).toBe(8);
    // WAL ditulis lalu dibersihkan setelah transaksi sukses.
    expect(services.wal.map((t) => t.id)).toEqual(["p1"]);
    expect(services.walCleared).toBe(1);
  });

  it("jalur fallback (tanpa SQLite) memakai JSON store dan tetap sukses", () => {
    services.svc.registerHandlers();
    fs.writeFileSync(files.menu, JSON.stringify([{ id: "m2", nama: "Teh", stok: 5 }]), "utf-8");
    // Bill aktif ikut ditulis supaya penghapusan bill juga terverifikasi.
    fs.writeFileSync(files.bills, JSON.stringify([{ id: "bill-2" }, { id: "bill-9" }]), "utf-8");
    const res = call("process-payment", {
      trx: { id: "p2", total: 50, items: [{ id: "m2", nama: "Teh", qty: 3 }] },
      activeBillId: "bill-2",
    });
    expect(res.ok).toBe(true);
    expect(services.wal).toHaveLength(0);
    expect(fs.existsSync(files.trx)).toBe(true);
    expect(JSON.parse(fs.readFileSync(files.trx, "utf-8")).map((t) => t.id)).toEqual(["p2"]);
    expect(JSON.parse(fs.readFileSync(files.bills, "utf-8")).map((b) => b.id)).toEqual(["bill-9"]);
  });

  it("alokasi ID mengabaikan created_at transaksi hasil migrasi", () => {
    const restored = { id: "TRX-0101991", timestamp: "1998-12-31T17:00:00.000Z", total: 10 };
    fs.writeFileSync(files.trx, JSON.stringify([restored]), "utf-8");
    services.svc.initDB();
    services.svc.registerHandlers();
    services.svc.migrateJSONToSQLite();
    const migratedRow = FakeBetterSqlite3.instances.at(-1).tables.transactions.find((row) => row.id === restored.id);
    migratedRow.created_at = "1999-01-02 00:00:00";
    expect(migratedRow.created_at.slice(0, 10)).not.toBe("1999-01-01");

    const res = call("process-payment", {
      trx: { ...restored, id: "TRX-0101991", kdsSourceRef: "TRX-0101991" },
    });

    expect(res.trx.id).toBe("TRX-0101992");
    expect(res.trx.kdsSourceRef).toBe("TRX-0101992");
  });

  it("checkout memakai suffix tertinggi setelah transaksi tengah dihapus", () => {
    services.svc.initDB();
    services.svc.registerHandlers();
    call("trx-save", { id: "TRX-0201261" });
    call("trx-save", { id: "TRX-0201262" });
    call("trx-save", { id: "TRX-0201263" });
    call("trx-delete", "TRX-0201262");

    const res = call("process-payment", { trx: { id: "TRX-0201263" } });

    expect(res.trx.id).toBe("TRX-0201264");
  });

  it("checkout tidak bentrok dengan transaksi pukul 00:00 WIB", () => {
    services.svc.initDB();
    services.svc.registerHandlers();
    call("trx-save", {
      id: "TRX-2401261",
      timestamp: "2026-01-23T17:00:00.000Z",
    });
    // 17:00 UTC is 00:00 WIB; SQLite's UTC date is still the previous day.
    FakeBetterSqlite3.instances.at(-1).tables.transactions[0].created_at = "2026-01-23 17:00:00";

    const res = call("process-payment", {
      trx: { id: "TRX-2401261", timestamp: "2026-01-24T05:00:00.000Z" },
    });

    expect(res.trx.id).toBe("TRX-2401262");
  });
});

describe("db.cjs: migrateJSONToSQLite", () => {
  it("memindahkan transactions.json ke SQLite lalu membuat cadangan", () => {
    fs.writeFileSync(files.trx, JSON.stringify([{ id: "j1", total: 10 }, { id: "j2", total: 20 }]), "utf-8");
    services.svc.initDB();
    services.svc.registerHandlers();
    services.svc.migrateJSONToSQLite();

    expect(services.registry["trx-load"]().map((t) => t.id).sort()).toEqual(["j1", "j2"]);
    expect(fs.existsSync(files.jsonBackups)).toBe(true);
    expect(fs.readdirSync(files.jsonBackups).some((f) => f.startsWith("transactions_"))).toBe(true);
  });

  it("INSERT OR IGNORE: migrasi dua kali tidak menggandakan data", () => {
    fs.writeFileSync(files.trx, JSON.stringify([{ id: "j1", total: 10 }]), "utf-8");
    services.svc.initDB();
    services.svc.registerHandlers();
    services.svc.migrateJSONToSQLite();
    services.svc.migrateJSONToSQLite();
    expect(services.registry["trx-load"]()).toHaveLength(1);
  });

  it("tidak melakukan apa pun bila db belum diinisialisasi atau file JSON kosong", () => {
    expect(() => services.svc.migrateJSONToSQLite()).not.toThrow();
    services.svc.initDB();
    expect(() => services.svc.migrateJSONToSQLite()).not.toThrow();
  });
});

describe("db.cjs: closeDB", () => {
  it("idempoten dan membuat handler kembali ke mode fallback JSON", () => {
    services.svc.initDB();
    services.svc.registerHandlers();
    services.registry["trx-save"](null, { id: "a", total: 1 });
    services.svc.closeDB();
    expect(() => services.svc.closeDB()).not.toThrow();
    // Setelah closeDB, db null -> jalur JSON dipakai dan tidak melempar.
    expect(services.registry["trx-save"](null, { id: "b", total: 2 })).toEqual({ ok: true });
  });
});

describe("db.cjs: Langkah 6 — stok masuk, opname, mutasi", () => {
  beforeEach(() => {
    services.svc.initDB();
    services.svc.registerHandlers();
  });

  const call = (name, ...args) => services.registry[name](null, ...args);
  const stokOf = (id) => call("menu-load").find((m) => m.id === id)?.stok;
  const movements = (q) => call("stock-movements", q);

  it("stock-in menambah stok, mencatat mutasi type 'in', dan memperbarui modal", () => {
    call("menu-replace", [{ id: "m1", nama: "Kopi", stok: 5, modal: 3000 }]);
    const res = call("stock-in", { id: "m1", qty: 7, modalBaru: 3500, note: "kulakan" });
    expect(res.ok).toBe(true);
    expect(res.stock).toEqual({ m1: 12 });
    expect(stokOf("m1")).toBe(12);
    // Modal (harga beli terakhir) ikut diperbarui.
    expect(call("menu-load").find((m) => m.id === "m1").modal).toBe(3500);
    const mv = movements({ productId: "m1" });
    expect(mv).toHaveLength(1);
    expect(mv[0]).toMatchObject({ product_id: "m1", nama: "Kopi", type: "in", delta: 7, stok_after: 12, note: "kulakan" });
  });

  it("stock-in menolak qty tidak valid dan item berstok tak terbatas", () => {
    // stok null = tak terbatas -> tidak ada delta yang tercatat.
    call("menu-replace", [{ id: "m1", nama: "Kopi", stok: 5 }, { id: "m2", nama: "Teh", stok: null }]);
    expect(call("stock-in", { id: "m1", qty: 0 }).ok).toBe(false);
    expect(call("stock-in", { id: "m1", qty: -3 }).ok).toBe(false);
    expect(call("stock-in", { id: "m2", qty: 4 }).ok).toBe(false);
    expect(stokOf("m1")).toBe(5);
  });

  it("stock-opname menyetel stok fisik dan mencatat selisih sebagai 'opname'", () => {
    call("menu-replace", [{ id: "m1", nama: "Kopi", stok: 10 }, { id: "m2", nama: "Teh", stok: 4 }]);
    const res = call("stock-opname", [{ id: "m1", counted: 8 }, { id: "m2", counted: 4 }], { note: "hitung fisik" });
    expect(res.ok).toBe(true);
    expect(res.stock).toEqual({ m1: 8, m2: 4 });
    expect(stokOf("m1")).toBe(8);
    expect(stokOf("m2")).toBe(4);
    // Hanya baris yang berubah (delta != 0) yang menyisakan mutasi.
    const all = movements();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ product_id: "m1", type: "opname", delta: -2, stok_after: 8, note: "hitung fisik" });
  });

  it("stock-movements memfilter per produk dan menghormati limit", () => {
    call("menu-replace", [{ id: "m1", nama: "Kopi", stok: 0 }, { id: "m2", nama: "Teh", stok: 0 }]);
    call("stock-in", { id: "m1", qty: 1 });
    call("stock-in", { id: "m2", qty: 2 });
    call("stock-in", { id: "m1", qty: 3 });
    expect(movements({ productId: "m1" })).toHaveLength(2);
    expect(movements({ productId: "m2" })).toHaveLength(1);
    expect(movements({ limit: 2 })).toHaveLength(2);
    expect(movements()).toHaveLength(3);
  });

  it("stock-set mengubah stok transisi null↔angka TANPA mencatat mutasi", () => {
    call("menu-replace", [{ id: "m1", nama: "Kopi", stok: null }]);
    expect(call("stock-set", { id: "m1", stok: 20 }).ok).toBe(true);
    expect(stokOf("m1")).toBe(20);
    expect(call("stock-set", { id: "m1", stok: null }).ok).toBe(true);
    expect(stokOf("m1")).toBeNull();
    // Tidak ada satu pun mutasi tercatat oleh stock-set.
    expect(movements()).toHaveLength(0);
    expect(call("stock-set", { id: "ghost", stok: 1 }).ok).toBe(false);
  });

  it("apply-stock dengan meta.type 'sale' ikut menulis mutasi", () => {
    call("menu-replace", [{ id: "m1", nama: "Kopi", stok: 10 }]);
    const res = call("apply-stock", { m1: -3 }, { type: "sale", ref: "trx-1", actor: "kasir" });
    expect(res.ok).toBe(true);
    expect(res.stock).toEqual({ m1: 7 });
    const mv = movements({ productId: "m1" });
    expect(mv).toHaveLength(1);
    expect(mv[0]).toMatchObject({ type: "sale", delta: -3, stok_after: 7, ref: "trx-1", actor: "kasir" });
  });

  it("remote menu restock idempotent: event yang sama menambah stok dan mutasi sekali", () => {
    call("menu-replace", [{ id: "m1", nama: "Kopi", stok: 5 }]);
    const event = { id: "evt-1", item_id: "m1", item_name: "Kopi", qty: 4 };
    expect(services.svc.applyRemoteMenuRestock(event)).toMatchObject({ ok: true, stockAfter: 9 });
    expect(services.svc.applyRemoteMenuRestock(event)).toMatchObject({ ok: true, duplicate: true, stockAfter: 9 });
    expect(stokOf("m1")).toBe(9);
    expect(movements({ productId: "m1" })).toHaveLength(1);
  });

  it("ingredient restock claim tidak bisa diproses dua kali dan baru complete sekali", () => {
    const event = { id: "evt-bahan-1", item_id: "b1", item_name: "Beras", qty: 10 };
    expect(services.svc.claimIngredientRestock(event)).toMatchObject({ ok: true, duplicate: false, status: "claimed" });
    expect(services.svc.claimIngredientRestock(event)).toMatchObject({ ok: true, duplicate: true, status: "claimed" });
    expect(services.svc.completeIngredientRestock(event.id)).toEqual({ ok: true });
    expect(services.svc.completeIngredientRestock(event.id)).toEqual({ ok: false });
  });

  it("INVARIANT: stok awal + Σdelta = stok akhir", () => {
    call("menu-replace", [{ id: "m1", nama: "Kopi", stok: 10 }]);
    call("stock-in", { id: "m1", qty: 5 });                       // +5 -> 15
    call("apply-stock", { m1: -3 }, { type: "sale", ref: "t1" }); // -3 -> 12
    call("apply-stock", { m1: 3 }, { type: "void", ref: "t1" });  // +3 -> 15
    call("stock-opname", [{ id: "m1", counted: 13 }], { note: "opname" }); // -2 -> 13

    const awal = 10;
    const sum = movements({ productId: "m1" }).reduce((acc, m) => acc + Number(m.delta), 0);
    expect(sum).toBe(3); // 5 - 3 + 3 - 2
    expect(awal + sum).toBe(stokOf("m1")); // 10 + 3 === 13
  });
});

describe("db.cjs: cloud sync bookkeeping (synced_at)", () => {
  beforeEach(() => {
    services.svc.initDB();
    services.svc.registerHandlers();
  });

  const call = (name, ...args) => services.registry[name](null, ...args);

  it("initDB menambah kolom synced_at (migrasi ringan)", () => {
    // Kolom harus ada sejak awal: semua transaksi baru synced_at NULL.
    call("trx-save", { id: "t1", total: 100 });
    expect(call("trx-count-unsynced")).toBe(1);
  });

  it("transaksi baru dihitung sebagai belum terkirim", () => {
    call("trx-save", { id: "a", total: 1 });
    call("trx-save", { id: "b", total: 2 });
    expect(call("trx-count-unsynced")).toBe(2);
  });

  it("trx-list-unsynced mengembalikan payload & occurredAt", () => {
    call("trx-save", { id: "a", total: 5, createdAt: "2026-01-01T10:00:00.000Z" });
    const rows = call("trx-list-unsynced", {});
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("a");
    expect(rows[0].occurredAt).toBe("2026-01-01T10:00:00.000Z");
    expect(rows[0].payload).toMatchObject({ id: "a", total: 5 });
  });

  it("trx-mark-synced menandai & mengurangi jumlah tertunda", () => {
    call("trx-save", { id: "a", total: 1 });
    call("trx-save", { id: "b", total: 2 });
    const res = call("trx-mark-synced", { ids: ["a"], syncedAt: "2026-01-01T11:00:00.000Z" });
    expect(res).toEqual({ ok: true, updated: 1 });
    expect(call("trx-count-unsynced")).toBe(1);
    // Hanya "b" yang tersisa sebagai pending.
    expect(call("trx-list-unsynced", {}).map((r) => r.id)).toEqual(["b"]);
  });

  it("trx-mark-synced idempoten (tidak menimpa waktu sync lama)", () => {
    call("trx-save", { id: "a", total: 1 });
    call("trx-mark-synced", { ids: ["a"], syncedAt: "2026-01-01T11:00:00.000Z" });
    const again = call("trx-mark-synced", { ids: ["a"], syncedAt: "2026-01-02T00:00:00.000Z" });
    expect(again.updated).toBe(0); // sudah tersinkron -> tidak disentuh
    expect(call("trx-count-unsynced")).toBe(0);
  });

  it("helper langsung (count/list/mark) konsisten dengan IPC", () => {
    call("trx-save", { id: "x", total: 9 });
    expect(services.svc.countUnsyncedTransactions()).toBe(1);
    const list = services.svc.listUnsyncedTransactions();
    expect(list.map((r) => r.id)).toEqual(["x"]);
    services.svc.markTransactionsSynced(["x"], "2026-02-02T00:00:00.000Z");
    expect(services.svc.countUnsyncedTransactions()).toBe(0);
  });

  it("trx-list-unsynced menghormati limit", () => {
    for (let i = 0; i < 5; i += 1) call("trx-save", { id: `t${i}`, total: i });
    expect(call("trx-list-unsynced", { limit: 2 })).toHaveLength(2);
  });
});
