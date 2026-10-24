import { useState, useRef, useCallback } from "react";

// useToast — paling independen di antara semua hook (tidak depend ke hook lain).
// Constraint arsitektur: hook ini TIDAK boleh import hook lain. Hook lain yang
// butuh toast/undo akan menerima `toast_`/`addUndo` sebagai parameter dari
// App.jsx, bukan import langsung dari sini.
function useToast() {
  const [toast, setToast]   = useState(null);
  // undo buffer: {label, restore: async fn}
  const [undoBuf, setUndoBuf] = useState(null);
  const undoTimer = useRef(null);
  const toastTimer = useRef(null);

  // deps kosong aman: hanya pakai setState (stabil by React) dan setTimeout.
  const toast_ = useCallback((msg, type = "ok", duration = 3000) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), duration);
  }, []);

  // deps kosong aman: hanya pakai undoTimer (ref, stabil) dan setState.
  const addUndo = useCallback((label, restoreFn) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoBuf({ label, restore: restoreFn });
    undoTimer.current = setTimeout(() => setUndoBuf(null), 9000);
  }, []);

  // PENTING: doUndo membaca `undoBuf` LANGSUNG (bukan lewat setter functional
  // update), jadi WAJIB ada di dependency array. Kalau di-useCallback dengan
  // deps [] di sini, doUndo akan selalu menutup ke undoBuf=null dari render
  // pertama — stale closure persis seperti bug Open Bill yang sedang kita
  // hindari. toast_ stabil (deps []), tapi disertakan karena dipanggil di dalam.
  const doUndo = useCallback(async () => {
    if (!undoBuf) return;
    await undoBuf.restore();
    setUndoBuf(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    toast_("Berhasil di-undo", "ok");
  }, [undoBuf, toast_]);

  return { toast, undoBuf, toast_, addUndo, doUndo };
}

export { useToast };
