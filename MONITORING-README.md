# DEN POS Monitoring Web-App

A web-based monitoring system that watches **only the Laporan (reports)** and **Riwayat (transaction history)** pages of your Kasir Warung POS software, refreshing automatically **every 5 minutes**.

---

## ✅ What Was Built

| Component | Location | Purpose |
|-----------|----------|---------|
| **Planning doc** | `monitoring-plan.md` | Full architecture, hosting options, data flow |
| **Backend API** | `monitoring-backend/` | Reads POS database, serves data, runs 5-min sync |
| **Web Frontend** | `monitoring-frontend/` | Login page + Laporan & Riwayat dashboards |
| **Start script** | `start-monitor.bat` | One-click launch of both services |
| **Deployment guide** | `monitoring-backend/DEPLOYMENT.md` | Hosting options (local/cloud/hybrid) |

---

## 🚀 Quick Start

### Easiest way (Windows)
Double-click **`start-monitor.bat`** in the project root.

### Manual way
```bash
# Terminal 1 — Backend (API + sync)
cd monitoring-backend
npm install
npm start

# Terminal 2 — Frontend (web UI)
cd monitoring-frontend
npm install
npm run dev
```

Then open **http://localhost:3000**

### Login credentials (default)
| Role | Username | Password |
|------|----------|----------|
| Admin | `admin` | `admin123` |
| Manager | `manager` | `manager123` |
| Viewer | `viewer` | `viewer123` |

> ⚠️ Change these before deploying publicly (see `monitoring-backend/DEPLOYMENT.md`).

---

## 🔄 How Data Flows

```
POS writes to SQLite (kasir.db)
        │
        ▼
Backend reads DB every 5 min (read-only, no interference with POS)
        │
        ▼
REST API: /api/data/reports/laporan  +  /api/data/reports/riwayat
        │
        ▼
Frontend fetches + auto-refreshes every 5 min → live dashboard
```

- **Database read is read-only** — the POS keeps working normally.
- **Uses `node:sqlite`** (built into Node 22+) — no native compilation needed.
- **JWT authentication** protects all data endpoints.

---

## 📡 Key API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/login` | ❌ | Login, returns JWT token |
| GET | `/api/data/health` | ❌ | Service + sync status |
| GET | `/api/data/reports/laporan` | ✅ | Financial report data |
| GET | `/api/data/reports/riwayat` | ✅ | Transaction history |
| GET | `/api/data/shifts` | ✅ | Shift list |
| GET | `/api/data/menu` | ✅ | Menu items |
| POST | `/api/data/sync` | ✅ admin | Trigger manual sync |

---

## 🗄️ Database Location

The POS database is stored in Electron's user-data folder:
```
C:\Users\tech aarohi\AppData\Roaming\kasir-warung\data\kasir.db
```
Change `POS_DB_PATH` in `monitoring-backend/.env` if yours differs.

Verify the connection anytime:
```bash
cd monitoring-backend
node scripts/test-database.js
```

---

## 🖥️ Hosting Options (see full guide)

1. **Local network** (free) — run on a store PC, access via LAN.
2. **Cloud** (Vercel + Railway, free tier) — remote access anywhere.
3. **Hybrid** (recommended) — data stays local, exposed via Cloudflare Tunnel.

Full details: **`monitoring-backend/DEPLOYMENT.md`**

---

## 🔐 Production Checklist

- [ ] Change default passwords
- [ ] Set a strong `JWT_SECRET` in `.env`
- [ ] Enable HTTPS (required for tunnels/cloud)
- [ ] Restrict CORS to your frontend domain
- [ ] Add rate limiting on login
- [ ] Set up regular database backups

---

## 🧪 Verified Working

- ✅ Backend connects to real POS database
- ✅ Sync runs every 5 minutes automatically
- ✅ Login authenticates and issues JWT
- ✅ Laporan page shows real revenue/data (Rp 177.000 from live DB)
- ✅ Riwayat page lists transactions with detail modal
- ✅ Frontend production build succeeds

## Supabase Attendance

The current Vercel frontend uses Supabase Auth, the public project URL, and the public anon/publishable key. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel's environment settings and require HTTPS for browser geolocation. Never expose `SUPABASE_SERVICE_ROLE_KEY` or put it in any `VITE_` variable.

For the desktop installer, provide the same two public variables in an ignored root `.env` before running `npm run electron:build`. The desktop attendance module loads only when an admin opens **Pengaturan → Presensi**; missing configuration or Supabase downtime does not block the POS or web routes. Admin sign-in happens inside that desktop tab.

Employee check-in/out uses the server-validated Supabase flow. Offline fingerprint hardware is a separate future integration; select the exact device model and protocol before designing enrollment or syncing offline punches. Do not treat a device clock as a trusted server timestamp.
