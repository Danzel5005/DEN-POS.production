import { useCallback, useEffect } from "react";
import { G, W, BD, MT, TX, LT, RADIUS, TYPOGRAPHY, COLOR_PALETTE } from "../../constants/design.js";

function ConfirmationModal({ isOpen, onConfirm, onCancel, title, message, confirmText = "Ya", cancelText = "Tidak" }) {
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === "Escape" && isOpen) onCancel();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={styles.title}>{title || "Konfirmasi"}</h3>
          <button style={styles.closeButton} onClick={onCancel}>
            ×
          </button>
        </div>

        <div style={styles.body}>
          <div style={styles.message}>{message}</div>
        </div>

        <div style={styles.footer}>
          <button style={{ ...styles.button, ...styles.cancelButton }} onClick={onCancel}>
            {cancelText}
          </button>
          <button style={{ ...styles.button, ...styles.confirmButton }} onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },

  modal: {
    backgroundColor: W,
    borderRadius: RADIUS.lg,
    padding: 0,
    boxShadow: "0 10px 25px rgba(0, 0, 0, 0.2)",
    width: "90%",
    maxWidth: 500,
    maxHeight: "80vh",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },

  header: {
    padding: "16px 20px",
    borderBottom: `1px solid ${BD}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLOR_PALETTE.primaryLight,
  },

  title: {
    fontSize: TYPOGRAPHY.body.fontSize,
    fontWeight: 700,
    color: G,
    margin: 0,
  },

  closeButton: {
    backgroundColor: "transparent",
    border: "none",
    fontSize: "20px",
    cursor: "pointer",
    color: MT,
    padding: "4px",
    borderRadius: RADIUS.sm,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  body: {
    padding: "20px",
  },

  message: {
    fontSize: TYPOGRAPHY.label.fontSize,
    color: TX,
    lineHeight: 1.5,
    whiteSpace: "pre-line",
    textAlign: "left",
  },

  footer: {
    padding: "16px 20px",
    borderTop: `1px solid ${BD}`,
    display: "flex",
    gap: 8,
    justifyContent: "flex-end",
  },

  button: {
    padding: "8px 16px",
    borderRadius: RADIUS.sm,
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: TYPOGRAPHY.label.fontSize,
    fontWeight: 600,
    transition: "background-color 0.15s",
  },

  confirmButton: {
    backgroundColor: COLOR_PALETTE.primary,
    color: W,
  },

  confirmButtonHover: {
    backgroundColor: COLOR_PALETTE.primaryDark,
  },

  cancelButton: {
    backgroundColor: W,
    color: MT,
    border: `1px solid ${BD}`,
  },

  cancelButtonHover: {
    backgroundColor: LT,
  },
};

export default ConfirmationModal;