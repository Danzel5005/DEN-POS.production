import { useCallback, useEffect, useMemo, useState } from "react";
import { attendanceCloud, attendanceCloudConfigured } from "../../services/attendanceCloud.js";
import { G, W, BD, MT } from "../../constants/design.js";

const EMPTY_LOCATION = { id: "", name: "", latitude: "", longitude: "", radius_m: "100", max_accuracy_m: "100", status: "active" };

function message(error, fallback) {
  const code = error?.message || "";
  const known = {
    DEVICE_LIMIT_REACHED: "Batas dua perangkat per karyawan sudah tercapai.",
    STORE_ACCESS_DENIED: "Akun ini bukan admin untuk toko tersebut.",
    OUTSIDE_GEOFENCE: "Di luar radius lokasi.",
    ACCURACY_TOO_LOW: "Akurasi GPS tidak memenuhi batas.",
  };
  return known[code] || code || fallback;
}

function formatTime(value) {
  return value ? new Date(value).toLocaleString("id-ID") : "—";
}

function distanceMeters(a, b) {
  const radians = (value) => value * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLng = radians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function checked({ data, error }) {
  if (error) throw error;
  return data || [];
}

export default function AttendanceAdminTab() {
  const [session, setSession] = useState(null);
  const [storeId, setStoreId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [locations, setLocations] = useState([]);
  const [devices, setDevices] = useState([]);
  const [deviceLocations, setDeviceLocations] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [draft, setDraft] = useState(EMPTY_LOCATION);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const membership = useCallback(async (userId) => {
    const { data, error: queryError } = await attendanceCloud.from("store_users")
      .select("store_id,web_role,membership_status")
      .eq("user_id", userId).eq("membership_status", "active");
    if (queryError) throw queryError;
    const admin = (data || []).find((row) => row.web_role === "admin");
    if (!admin) throw new Error("Akun ini tidak memiliki role admin Supabase pada toko mana pun.");
    setStoreId(admin.store_id);
  }, []);

  useEffect(() => {
    if (!attendanceCloud) return undefined;
    let alive = true;
    const { data: { subscription } } = attendanceCloud.auth.onAuthStateChange((_event, nextSession) => {
      if (!alive) return;
      setSession(nextSession);
      setStoreId("");
    });
    attendanceCloud.auth.getSession().then(({ data, error: sessionError }) => {
      if (!alive) return;
      if (sessionError) setError(sessionError.message);
      setSession(data.session);
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!session?.user?.id) { setStoreId(""); return; }
    let alive = true;
    membership(session.user.id).catch((membershipError) => {
      if (alive) setError(message(membershipError, "Gagal memeriksa role admin."));
    });
    return () => { alive = false; };
  }, [session?.user?.id, membership]);

  const loadData = useCallback(async () => {
    if (!attendanceCloud || !storeId) return;
    setLoading(true);
    try {
      const [locationRows, deviceRows, positionRows, sessionRows, attemptRows] = await Promise.all([
        attendanceCloud.from("attendance_locations").select("*").eq("store_id", storeId).order("created_at", { ascending: false }),
        attendanceCloud.from("registered_devices").select("id,user_id,user_email,device_uuid,device_name,status,last_seen_at,created_at").eq("store_id", storeId).order("created_at", { ascending: false }),
        attendanceCloud.from("device_locations").select("registered_device_id,latitude,longitude,accuracy_m,observed_at"),
        attendanceCloud.from("attendance_sessions").select("id,user_id,user_label,user_email,status,checked_in_at,checked_out_at,check_in_distance_m,check_out_distance_m,location_id,shift_id").eq("store_id", storeId).order("checked_in_at", { ascending: false }).limit(100),
        attendanceCloud.from("attendance_attempts").select("id,user_email,outcome,code,created_at").eq("store_id", storeId).order("created_at", { ascending: false }).limit(50),
      ]);
      setLocations(checked(locationRows));
      setDevices(checked(deviceRows));
      setDeviceLocations(checked(positionRows));
      setSessions(checked(sessionRows));
      setAttempts(checked(attemptRows));
      setError("");
    } catch (loadError) {
      setError(message(loadError, "Gagal memuat data presensi."));
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    if (!attendanceCloud || !storeId) return undefined;
    const channel = attendanceCloud.channel(`attendance-store-${storeId}`, { config: { private: true } })
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_locations", filter: `store_id=eq.${storeId}` }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "registered_devices", filter: `store_id=eq.${storeId}` }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_sessions", filter: `store_id=eq.${storeId}` }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_attempts", filter: `store_id=eq.${storeId}` }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "device_locations" }, loadData)
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setError("Realtime terputus. Data tetap diperbarui berkala; periksa koneksi Supabase.");
        }
      });
    loadData();
    const fallback = setInterval(loadData, 30000);
    return () => {
      clearInterval(fallback);
      attendanceCloud.removeChannel(channel);
    };
  }, [storeId, loadData]);

  const positionsByDevice = useMemo(() => new Map(deviceLocations.map((row) => [row.registered_device_id, row])), [deviceLocations]);

  const login = async (event) => {
    event.preventDefault();
    if (!attendanceCloud) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const { data, error: loginError } = await attendanceCloud.auth.signInWithPassword({ email: email.trim(), password });
      if (loginError) throw loginError;
      setSession(data.session);
      setPassword("");
    } catch (loginError) {
      setError(message(loginError, "Login admin Supabase gagal."));
    } finally {
      setBusy(false);
    }
  };

  const saveLocation = async (event) => {
    event.preventDefault();
    const latitude = Number(draft.latitude), longitude = Number(draft.longitude);
    const radius = Number(draft.radius_m), accuracy = Number(draft.max_accuracy_m);
    if (!draft.name.trim() || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
      || !Number.isInteger(radius) || radius < 1 || radius > 1000
      || !Number.isInteger(accuracy) || accuracy < 1 || accuracy > 1000) {
      setError("Isi nama, koordinat valid, radius 1–1000 m, dan akurasi 1–1000 m.");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    const values = {
      store_id: storeId, name: draft.name.trim(), latitude, longitude,
      radius_m: radius, max_accuracy_m: accuracy, status: draft.status,
      updated_at: new Date().toISOString(),
    };
    try {
      const query = draft.id
        ? attendanceCloud.from("attendance_locations").update(values).eq("id", draft.id).eq("store_id", storeId)
        : attendanceCloud.from("attendance_locations").insert(values);
      const { error: saveError } = await query;
      if (saveError) throw saveError;
      setDraft(EMPTY_LOCATION);
      setNotice("Lokasi presensi tersimpan.");
      await loadData();
    } catch (saveError) {
      setError(message(saveError, "Lokasi gagal disimpan."));
    } finally {
      setBusy(false);
    }
  };

  const setLocationStatus = async (location, status) => {
    setBusy(true); setError("");
    const { error: updateError } = await attendanceCloud.from("attendance_locations")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", location.id).eq("store_id", storeId);
    if (updateError) setError(message(updateError, "Status lokasi gagal diperbarui."));
    else await loadData();
    setBusy(false);
  };

  const setDeviceStatus = async (device, status) => {
    setBusy(true); setError("");
    const { error: updateError } = await attendanceCloud.rpc("set_attendance_device_status", {
      p_device_id: device.id, p_status: status,
    });
    if (updateError) setError(message(updateError, "Status perangkat gagal diperbarui."));
    else {
      setNotice(status === "active" ? "Perangkat disetujui." : "Perangkat dinonaktifkan.");
      await loadData();
    }
    setBusy(false);
  };

  const requestLocationRefresh = async () => {
    setBusy(true); setError(""); setNotice("");
    const channel = attendanceCloud.channel(`attendance-store-${storeId}`, { config: { private: true } });
    try {
      await new Promise((resolve, reject) => {
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") resolve();
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error("Kanal permintaan lokasi tidak tersedia."));
        });
      });
      const result = await channel.send({
        type: "broadcast", event: "refresh-location",
        payload: { requestedAt: new Date().toISOString() },
      });
      if (result !== "ok") throw new Error("Permintaan lokasi gagal dikirim.");
      setNotice("Permintaan dikirim. Browser karyawan yang sedang terbuka akan memperbarui lokasinya.");
    } catch (requestError) {
      setError(message(requestError, "Tidak dapat meminta lokasi perangkat."));
    } finally {
      await attendanceCloud.removeChannel(channel);
      setBusy(false);
    }
  };

  if (!attendanceCloudConfigured) return <div role="alert" style={{ background: "#fff7e6", padding: 14, color: "#7a4b00" }}>
    Presensi cloud belum dikonfigurasi. Untuk build desktop, sediakan <code>VITE_SUPABASE_URL</code> dan <code>VITE_SUPABASE_ANON_KEY</code> publik. Kasir dan sync lama tetap berjalan.
  </div>;

  if (!session) return <section>
    <h3 style={{ color: G, fontSize: 16, fontWeight: 700 }}>Presensi karyawan</h3>
    <p style={{ color: MT, fontSize: 12, margin: "6px 0 14px" }}>Login dengan akun admin web DEN POS. Form ini berada di aplikasi desktop; tidak perlu membuka software lain.</p>
    <form onSubmit={login} style={{ display: "grid", gap: 10, maxWidth: 420 }}>
      <label style={{ fontSize: 12 }}>Email admin<input required type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} style={{ display: "block", width: "100%", boxSizing: "border-box", padding: 9, border: `1px solid ${BD}`, borderRadius: 6 }} /></label>
      <label style={{ fontSize: 12 }}>Password<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} style={{ display: "block", width: "100%", boxSizing: "border-box", padding: 9, border: `1px solid ${BD}`, borderRadius: 6 }} /></label>
      {error && <p role="alert" style={{ color: "#b91c1c", fontSize: 12 }}>{error}</p>}
      <button disabled={busy} style={{ justifySelf: "start", padding: "9px 16px", border: 0, borderRadius: 6, background: G, color: W, fontWeight: 700 }}>{busy ? "Memeriksa…" : "Login admin"}</button>
    </form>
  </section>;

  if (!storeId) return <section>
    {error && <p role="alert" style={{ color: "#b91c1c", fontSize: 12 }}>{error}</p>}
    <p style={{ color: MT, fontSize: 12 }}>Memeriksa hak admin…</p>
    <button onClick={() => attendanceCloud.auth.signOut()} style={{ color: G, textDecoration: "underline", fontSize: 12 }}>Keluar akun cloud</button>
  </section>;

  const firstTwo = deviceLocations.filter((row) => devices.some((device) => device.id === row.registered_device_id)).slice(0, 2);
  const pairDistance = firstTwo.length === 2 ? Math.round(distanceMeters(firstTwo[0], firstTwo[1])) : null;

  return <section style={{ color: "#222", fontSize: 12 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 12 }}>
      <div><h3 style={{ color: G, fontSize: 16, fontWeight: 700 }}>Presensi karyawan</h3><p style={{ color: MT }}>Login: {session.user.email} · {loading ? "Memuat…" : "Realtime aktif"}</p></div>
      <div style={{ display: "flex", gap: 8 }}><button onClick={loadData} disabled={loading} style={{ border: `1px solid ${BD}`, padding: "7px 10px", borderRadius: 5 }}>Muat ulang</button><button onClick={() => attendanceCloud.auth.signOut()} style={{ border: `1px solid ${BD}`, padding: "7px 10px", borderRadius: 5 }}>Keluar</button></div>
    </div>
    {error && <p role="alert" style={{ background: "#fff1f1", color: "#991b1b", padding: 9, marginBottom: 10 }}>{error}</p>}
    {notice && <p role="status" style={{ background: "#e8f5ee", color: G, padding: 9, marginBottom: 10 }}>{notice}</p>}

    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
      <div>
        <h4 style={{ fontWeight: 700, marginBottom: 8 }}>Lokasi presensi</h4>
        <form onSubmit={saveLocation} style={{ display: "grid", gap: 7, padding: 10, border: `1px solid ${BD}`, borderRadius: 7, marginBottom: 10 }}>
          <input aria-label="Nama lokasi" placeholder="Nama lokasi" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} style={{ padding: 7, border: `1px solid ${BD}`, borderRadius: 4 }} />
          <div style={{ display: "flex", gap: 6 }}><input aria-label="Latitude" type="number" step="any" placeholder="Latitude" value={draft.latitude} onChange={(event) => setDraft({ ...draft, latitude: event.target.value })} style={{ minWidth: 0, width: "50%", padding: 7, border: `1px solid ${BD}`, borderRadius: 4 }} /><input aria-label="Longitude" type="number" step="any" placeholder="Longitude" value={draft.longitude} onChange={(event) => setDraft({ ...draft, longitude: event.target.value })} style={{ minWidth: 0, width: "50%", padding: 7, border: `1px solid ${BD}`, borderRadius: 4 }} /></div>
          <div style={{ display: "flex", gap: 6 }}><label style={{ flex: 1 }}>Radius (m)<input type="number" min="1" max="1000" value={draft.radius_m} onChange={(event) => setDraft({ ...draft, radius_m: event.target.value })} style={{ display: "block", width: "100%", boxSizing: "border-box", padding: 7, border: `1px solid ${BD}`, borderRadius: 4 }} /></label><label style={{ flex: 1 }}>Akurasi maks. (m)<input type="number" min="1" max="1000" value={draft.max_accuracy_m} onChange={(event) => setDraft({ ...draft, max_accuracy_m: event.target.value })} style={{ display: "block", width: "100%", boxSizing: "border-box", padding: 7, border: `1px solid ${BD}`, borderRadius: 4 }} /></label></div>
          <div style={{ display: "flex", gap: 6 }}><button disabled={busy} style={{ flex: 1, padding: 8, border: 0, borderRadius: 5, background: G, color: W, fontWeight: 700 }}>{draft.id ? "Simpan perubahan" : "Tambah lokasi"}</button><button type="button" onClick={() => setDraft(EMPTY_LOCATION)} style={{ padding: "7px 10px", border: `1px solid ${BD}`, borderRadius: 5 }}>Reset</button></div>
        </form>
        {!locations.length ? <p style={{ color: MT }}>Belum ada lokasi.</p> : locations.map((location) => <div key={location.id} style={{ borderBottom: `1px solid ${BD}`, padding: "8px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}><b>{location.name}</b><button onClick={() => setLocationStatus(location, location.status === "active" ? "inactive" : "active")} disabled={busy} style={{ color: location.status === "active" ? "#a33" : G }}>{location.status === "active" ? "Nonaktifkan" : "Aktifkan"}</button></div>
          <div style={{ color: MT }}>{location.latitude}, {location.longitude} · radius {location.radius_m} m · akurasi ≤ {location.max_accuracy_m} m · {location.status}</div>
          <button onClick={() => setDraft({ ...location, latitude: String(location.latitude), longitude: String(location.longitude), radius_m: String(location.radius_m), max_accuracy_m: String(location.max_accuracy_m) })} style={{ color: G, textDecoration: "underline", marginTop: 3 }}>Edit</button>
        </div>)}
      </div>

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 5 }}>
          <h4 style={{ fontWeight: 700 }}>Perangkat karyawan</h4>
          <button onClick={requestLocationRefresh} disabled={busy} style={{ border: `1px solid ${BD}`, padding: "6px 8px", borderRadius: 5 }}>Minta refresh lokasi</button>
        </div>
        {pairDistance !== null && <p style={{ margin: "6px 0", color: MT }}>Jarak dua perangkat dengan lokasi terbaru: {pairDistance} m.</p>}
        {!devices.length ? <p style={{ color: MT, marginTop: 8 }}>Belum ada perangkat terdaftar.</p> : devices.map((device) => {
          const point = positionsByDevice.get(device.id);
          const online = device.last_seen_at && Date.now() - new Date(device.last_seen_at).getTime() < 15 * 60 * 1000;
          return <div key={device.id} style={{ borderBottom: `1px solid ${BD}`, padding: "8px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}><b>{device.user_email || "Email tidak tersedia"}</b><span style={{ color: device.status === "active" ? G : "#a35b00" }}>{device.status} · {online ? "online" : "offline"}</span></div>
            <div style={{ color: MT }}>{device.device_name || "Browser"} · terakhir aktif {formatTime(device.last_seen_at)}</div>
            {point && <div style={{ color: MT }}>Lokasi terbaru: {Number(point.latitude).toFixed(5)}, {Number(point.longitude).toFixed(5)} · ±{Math.round(point.accuracy_m)} m · {formatTime(point.observed_at)}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>{device.status !== "active" && <button onClick={() => setDeviceStatus(device, "active")} disabled={busy} style={{ color: G, fontWeight: 700 }}>Setujui</button>}{device.status !== "revoked" && <button onClick={() => setDeviceStatus(device, "revoked")} disabled={busy} style={{ color: "#a33" }}>Nonaktifkan</button>}</div>
          </div>;
        })}
      </div>
    </div>

    <div style={{ marginTop: 16 }}>
      <h4 style={{ fontWeight: 700, marginBottom: 6 }}>Presensi terbaru</h4>
      {!sessions.length ? <p style={{ color: MT }}>Belum ada presensi.</p> : <div style={{ maxHeight: 160, overflow: "auto", border: `1px solid ${BD}` }}>
        {sessions.slice(0, 30).map((row) => <div key={row.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, borderBottom: `1px solid ${BD}`, padding: 7 }}>
          <span>{row.user_email || row.user_label} · masuk {formatTime(row.checked_in_at)}{row.checked_out_at ? ` · keluar ${formatTime(row.checked_out_at)}` : ""}</span>
          <b style={{ color: row.status === "checked_in" ? G : MT }}>{row.status}</b>
        </div>)}
      </div>}
      {!!attempts.length && <details style={{ marginTop: 8 }}><summary style={{ cursor: "pointer", fontWeight: 700 }}>Audit validasi terbaru ({attempts.length})</summary><div style={{ maxHeight: 120, overflow: "auto" }}>{attempts.map((row) => <p key={row.id} style={{ borderBottom: `1px solid ${BD}`, padding: 5 }}>{row.user_email || "—"} · {row.code} · {formatTime(row.created_at)}</p>)}</div></details>}
    </div>
  </section>;
}
