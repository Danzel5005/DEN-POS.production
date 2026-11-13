// Shared bits for the Settings modal tabs.
//
// `fieldStyle` and `SaveButton` are used by more than one tab, so they live
// here instead of being duplicated in every tab file (and instead of every
// tab importing from a sibling tab).
import { useState } from "react";
import { G, W, BD, MT, RADIUS, TYPOGRAPHY } from "../../../constants/design.js";

export const fieldStyle = {
  padding: "8px 10px",
  border: `1px solid ${BD}`,
  borderRadius: RADIUS.md,
  fontFamily: "inherit",
  fontSize: TYPOGRAPHY.small.fontSize,
};

export function SaveButton({ children = "Simpan", onClick, disabled = false }) {
  return <button onClick={onClick} disabled={disabled} style={{ padding: "8px 14px", background: G, color: W, border: "none", borderRadius: RADIUS.md, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1, fontFamily: "inherit", fontSize: TYPOGRAPHY.small.fontSize, fontWeight: 700 }}>{children}</button>;
}

// PasswordInput — same `{ value, onChange, placeholder, style, compact }`
// contract as before, shared by the Users tab (self password + new user form).
export function PasswordInput({ value, onChange, placeholder, style, compact = false, id, name, autoComplete }) {
  const [show, setShow] = useState(false);
  const hide = () => setShow(false);
  const iconSize = compact ? 13 : 16;
  return <div style={{ position: "relative", width: "100%" }}>
    <input
      id={id || "password-input"}
      name={name || "password"}
      autoComplete={autoComplete || "current-password"}
      type={show ? "text" : "password"}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      style={{ ...style, paddingRight: compact ? 26 : 36 }}
    />
    <button
      type="button"
      onMouseDown={() => setShow(true)}
      onMouseUp={hide}
      onMouseLeave={hide}
      onTouchStart={(event) => { event.preventDefault(); setShow(true); }}
      onTouchEnd={hide}
      onTouchCancel={hide}
      aria-label={show ? "Sembunyikan password" : "Tampilkan password"}
      style={{ position: "absolute", right: compact ? 3 : 6, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", cursor: "pointer", padding: compact ? 2 : 4, display: "flex", alignItems: "center", justifyContent: "center", color: MT }}
    >
      {show
        ? <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
        : <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
    </button>
  </div>;
}
