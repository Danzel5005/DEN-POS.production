import { useCallback, useEffect, useState } from "react";
import { api } from "../../utilities/utils.js";

const ROLES = ["kasir", "bar", "purchasing", "manager", "admin"];

export default function WebAttendanceUsersTab({ isAdmin }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [radius, setRadius] = useState(20);
  const [radiusDraft, setRadiusDraft] = useState("20");
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    const [result, settings] = await Promise.all([
      api.deviceAttendanceExchange({ action: "members-list" }),
      api.deviceAttendanceExchange({ action: "attendance-settings" }),
    ]);
    if (result?.ok && result.data?.ok) setUsers(result.data.users || []);
    else setError(result?.error || "Gagal memuat pengguna web-app.");
    if (settings?.ok && settings.data?.ok) {
      const value = Number(settings.data.radiusM) || 20;
      setRadius(value); setRadiusDraft(String(value));
    }
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const update = async (userId, role) => {
    setBusy(userId); setError("");
    const result = await api.deviceAttendanceExchange({ action: "member-role", userId, role });
    if (result?.ok) await refresh(); else setError(result?.error || "Gagal menyimpan role.");
    setBusy("");
  };
  const revoke = async (user) => {
    if (!window.confirm(`Cabut akses web-app untuk ${user.username}?`)) return;
    setBusy(user.user_id); setError("");
    const result = await api.deviceAttendanceExchange({ action: "member-revoke", userId: user.user_id });
    if (result?.ok) await refresh(); else setError(result?.error || "Gagal mencabut akses.");
    setBusy("");
  };
  const saveRadius = async (event) => {
    event.preventDefault();
    const value = Number(radiusDraft);
    if (!Number.isInteger(value) || value < 1 || value > 1000) { setError("Jarak presensi harus 1–1000 meter."); return; }
    setBusy("radius"); setError("");
    const result = await api.deviceAttendanceExchange({ action: "attendance-radius-set", radiusM: value });
    if (result?.ok && result.data?.ok) { setRadius(value); setError(""); }
    else setError(result?.error || "Gagal menyimpan jarak presensi.");
    setBusy("");
  };

  if (!isAdmin) return null;
  return <section>
    <div style={{ borderBottom: "1px solid #ddd", marginBottom: 14, paddingBottom: 14 }}>
      <h3 style={{ fontWeight: 700, fontSize: 15 }}>Jarak Presensi</h3>
      <p style={{ color: "#777", fontSize: 11, margin: "4px 0 10px" }}>Hanya admin software DEN POS yang dapat mengubah batas jarak. Berlaku langsung untuk shift aktif.</p>
      <form onSubmit={saveRadius} style={{ display: "flex", alignItems: "end", gap: 8 }}>
        <label style={{ color: "#555", fontSize: 11 }}>Jarak maksimum (meter)<input type="number" min="1" max="1000" value={radiusDraft} onChange={(event) => setRadiusDraft(event.target.value)} style={{ display: "block", width: 140, height: 36, marginTop: 4, border: "1px solid #ccc", borderRadius: 5, padding: "0 8px" }} /></label>
        <button type="submit" disabled={busy === "radius" || loading} style={{ height: 36, background: "#1a5c38", color: "white", border: 0, borderRadius: 5, padding: "0 12px", fontWeight: 700 }}>{busy === "radius" ? "Menyimpan…" : "Simpan"}</button>
        <span style={{ color: "#777", fontSize: 11 }}>Saat ini: {radius} m</span>
      </form>
    </div>
    <div className="mb-3 flex items-center justify-between"><div><h3 style={{ fontWeight: 700, fontSize: 15 }}>Pengguna Web-App</h3><p style={{ color: "#777", fontSize: 11 }}>Atur role dan akses dari DEN POS.</p></div><button onClick={refresh} disabled={loading} style={{ border: "1px solid #ddd", padding: "7px 10px", borderRadius: 5 }}>Muat ulang</button></div>
    {error && <p role="alert" style={{ color: "#b91c1c", background: "#fff1f1", padding: 9, fontSize: 12 }}>{error}</p>}
    {loading ? <p style={{ padding: 12 }}>Memuat pengguna…</p> : !users.length ? <p style={{ padding: 12, color: "#777" }}>Belum ada pengguna yang terhubung ke toko ini.</p> : <div style={{ display: "grid", gap: 8 }}>{users.map((user) => <div key={user.user_id} style={{ display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #eee", padding: "9px 0" }}>
      <div style={{ flex: 1, minWidth: 0 }}><b style={{ display: "block", fontSize: 12 }}>{user.name} (@{user.username})</b><small style={{ color: "#777" }}>{user.membership_status === "active" ? "Aktif" : "Akses dicabut"}</small></div>
      <select aria-label={`Role ${user.username}`} value={user.web_role} disabled={busy === user.user_id || user.membership_status !== "active"} onChange={(event) => update(user.user_id, event.target.value)} style={{ height: 36, border: "1px solid #ccc", borderRadius: 5, padding: "0 6px" }}>{ROLES.map((role) => <option key={role} value={role}>{role[0].toUpperCase() + role.slice(1)}</option>)}</select>
      {user.membership_status === "active" && <button onClick={() => revoke(user)} disabled={busy === user.user_id} style={{ color: "#b91c1c", border: "1px solid #f1b5b5", borderRadius: 5, padding: "7px 9px", fontSize: 11 }}>Cabut</button>}
    </div>)}</div>}
  </section>;
}