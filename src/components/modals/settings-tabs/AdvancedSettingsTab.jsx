import { lazy, Suspense } from "react";
import { G, W, LT, BD, MT, TX, RADIUS, TYPOGRAPHY, COLOR_PALETTE } from "../../../constants/design.js";
import { ADVANCED_FEATURE_GROUPS, DEFAULT_ADVANCED_FEATURES, LOYALTY_TIER_BASIS, normalizeLoyaltyTierBasis } from "../../../constants/advancedFeatures.js";
import { isAdmin } from "../../../utilities/permissions.js";

const AttendanceAdminTab = lazy(() => import("../AttendanceAdminTab.jsx"));
const WebAttendanceUsersTab = lazy(() => import("../WebAttendanceUsersTab.jsx"));

// ToggleSwitch — saklar gaya iOS minimal, tanpa dependensi. Dipakai untuk
// saklar induk maupun tiap sub-fitur supaya tidak ada dua gaya kontrol.
function ToggleSwitch({ checked, onChange, disabled }) {
  const width = 38;
  const height = 20;
  const knob = 16;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width,
        height,
        borderRadius: height / 2,
        border: "none",
        padding: 2,
        background: disabled ? "#d8d8d0" : checked ? G : "#c9c9c1",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: checked ? "flex-end" : "flex-start",
        transition: "background 0.15s",
        flexShrink: 0,
      }}
    >
      <span style={{ width: knob, height: knob, borderRadius: "50%", background: W, boxShadow: "0 1px 2px rgba(0,0,0,0.25)", transition: "all 0.15s" }} />
    </button>
  );
}

export function AdvancedSettingsTab({ settingsH, authH }) {
  const adv = settingsH.settings.advancedFeatures || DEFAULT_ADVANCED_FEATURES;
  const masterOn = !!adv.enabled;
  const attendanceOn = masterOn && !!adv.attendance;
  const admin = isAdmin(authH?.currentUser);

  return <div>
    <div style={{ fontSize: TYPOGRAPHY.label.fontSize, color: MT, fontWeight: 600, marginBottom: 10 }}>
      Fitur tingkat lanjut bersifat opsional. Nyalakan hanya yang Anda butuhkan — semuanya mati secara default.
    </div>

    {/* Saklar induk */}
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: masterOn ? COLOR_PALETTE.primaryLight : LT, border: `1px solid ${masterOn ? "#a8d5b8" : BD}`, borderRadius: RADIUS.md, marginBottom: 14 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: TYPOGRAPHY.body.fontSize, fontWeight: 700, color: masterOn ? G : TX }}>Nyalakan Fitur Tingkat Lanjut</div>
        <div style={{ fontSize: TYPOGRAPHY.label.fontSize, color: MT, marginTop: 3 }}>
          {masterOn ? "Saklar induk aktif — pilih fitur di bawah." : "Saklar induk mati — semua fitur lanjutan disembunyikan."}
        </div>
      </div>
      <ToggleSwitch checked={masterOn} onChange={(v) => settingsH.setAdvancedEnabled(v)} />
    </div>

    {/* Daftar sub-fitur per fase */}
    <div style={{ opacity: masterOn ? 1 : 0.45, transition: "opacity 0.15s" }}>
      {ADVANCED_FEATURE_GROUPS.map((group) => (
        <div key={group.fase} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: TYPOGRAPHY.label.fontSize, fontWeight: 700, color: G, marginBottom: 7 }}>{group.fase}</div>
          <div style={{ display: "grid", gap: 7 }}>
            {group.items.map((item) => (
              <div key={item.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: W, border: `1px solid ${BD}`, borderRadius: RADIUS.md }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: TYPOGRAPHY.small.fontSize, fontWeight: 700, color: TX }}>{item.label}</div>
                  <div style={{ fontSize: TYPOGRAPHY.label.fontSize, color: MT, marginTop: 2 }}>{item.desc}</div>
                </div>
                <ToggleSwitch
                  checked={!!adv[item.key]}
                  disabled={!masterOn}
                  onChange={(v) => settingsH.toggleAdvancedFeature(item.key, v)}
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Opsi basis loyalty tier — hanya muncul saat fitur Loyalty Tier aktif. */}
      {adv.loyalty && (
        <div style={{ padding: "10px 12px", background: W, border: `1px solid ${BD}`, borderRadius: RADIUS.md, marginBottom: 14 }}>
          <div style={{ fontSize: TYPOGRAPHY.small.fontSize, fontWeight: 700, color: TX }}>Basis Loyalty Tier</div>
          <div style={{ fontSize: TYPOGRAPHY.label.fontSize, color: MT, marginTop: 2, marginBottom: 8 }}>
            Tentukan dari mana total belanja untuk menghitung tingkatan pelanggan.
          </div>
          {[
            { value: LOYALTY_TIER_BASIS.TRANSACTION, label: "Total transaksi saat ini", desc: "Tier dihitung dari nilai pesanan yang sedang dibuat." },
            { value: LOYALTY_TIER_BASIS.LIFETIME, label: "Total belanja pelanggan (lifetime)", desc: "Tier dihitung dari akumulasi seluruh transaksi pelanggan terpilih." },
          ].map((opt) => {
            const active = normalizeLoyaltyTierBasis(settingsH.settings.loyaltyTierBasis) === opt.value;
            return (
              <label
                key={opt.value}
                style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px", marginBottom: 6, border: `1px solid ${active ? "#a8d5b8" : BD}`, background: active ? COLOR_PALETTE.primaryLight : W, borderRadius: RADIUS.md, cursor: "pointer" }}
              >
                <input
                  type="radio"
                  id={`loyalty-basis-${opt.value}`}
                  name="loyaltyTierBasis"
                  checked={active}
                  onChange={() => settingsH.setLoyaltyTierBasis(opt.value)}
                  style={{ marginTop: 2 }}
                />
                <span style={{ flex: 1 }}>
                  <span style={{ display: "block", fontSize: TYPOGRAPHY.small.fontSize, fontWeight: 700, color: active ? G : TX }}>{opt.label}</span>
                  <span style={{ display: "block", fontSize: TYPOGRAPHY.label.fontSize, color: MT, marginTop: 2 }}>{opt.desc}</span>
                </span>
              </label>
            );
          })}
        </div>
      )}
      {attendanceOn && admin && (
        <section style={{ padding: "12px 14px", background: W, border: `1px solid ${BD}`, borderRadius: RADIUS.md, marginBottom: 14 }}>
          <div style={{ fontSize: TYPOGRAPHY.body.fontSize, fontWeight: 700, color: G, marginBottom: 10 }}>Pengaturan Presensi</div>
          <Suspense fallback={<p style={{ color: MT, fontSize: 12 }}>Memuat pengaturan presensi…</p>}>
            <WebAttendanceUsersTab isAdmin={admin} />
            <AttendanceAdminTab />
          </Suspense>
        </section>
      )}
    </div>
  </div>;
}
