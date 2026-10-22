import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

// In-site replacement for window.confirm.
//   const { confirm, closeConfirm } = useConfirm();
//   if (!(await confirm({ title, body, confirmLabel, cancelLabel, danger }))) return;
// closeConfirm() dismisses an open dialog (resolves false) — used when the
// thing being confirmed stops being relevant (e.g. the game ended underneath it).

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null); // { opts, resolve } | null
  const dialogRef = useRef(null);
  dialogRef.current = dialog;

  const settle = useCallback((value) => {
    const d = dialogRef.current;
    if (!d) return;
    dialogRef.current = null;
    setDialog(null);
    d.resolve(value);
  }, []);

  const confirm = useCallback(
    (opts) =>
      new Promise((resolve) => {
        // A second request while one is open cancels the first.
        if (dialogRef.current) dialogRef.current.resolve(false);
        const next = { opts: opts || {}, resolve };
        dialogRef.current = next;
        setDialog(next);
      }),
    []
  );

  const closeConfirm = useCallback(() => settle(false), [settle]);
  const value = useMemo(() => ({ confirm, closeConfirm }), [confirm, closeConfirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {dialog && createPortal(<ConfirmModal opts={dialog.opts} onResult={settle} />, document.body)}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}

// True while a confirm dialog is mounted — other keyboard handlers check this.
export function isConfirmOpen() {
  return !!document.querySelector("[data-confirm-dialog]");
}

function ConfirmModal({ opts, onResult }) {
  const { title = "Are you sure?", body, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false } = opts;
  const cancelRef = useRef(null);
  const boxRef = useRef(null);
  const returnFocus = useRef(typeof document !== "undefined" ? document.activeElement : null);
  const titleId = "confirm-title";

  useEffect(() => {
    cancelRef.current?.focus();
    const prev = returnFocus.current;
    return () => {
      try {
        prev && prev.focus && prev.focus();
      } catch {
        /* element gone */
      }
    };
  }, []);

  function onKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onResult(false);
      return;
    }
    if (e.key === "Tab") {
      const nodes = boxRef.current?.querySelectorAll("button");
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  return (
    <div
      data-confirm-dialog
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onResult(false);
      }}
      onKeyDown={onKeyDown}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-ink-800 border border-ink-700 rounded-xl max-w-sm w-full p-6 shadow-2xl"
      >
        <h2 id={titleId} className="font-display text-lg font-semibold mb-2">
          {title}
        </h2>
        {body && <p className="text-sm text-ink-600 mb-5 whitespace-pre-line">{body}</p>}
        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={() => onResult(false)}
            className="px-4 py-2 rounded-md border border-ink-700 hover:border-ink-600 transition-colors text-sm"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => onResult(true)}
            className={`px-4 py-2 rounded-md text-sm font-bold transition-colors ${
              danger ? "bg-ember-600 text-parchment hover:bg-ember-500" : "bg-brass-500 text-ink-950 hover:bg-brass-400"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
