// File-explorer style rail listing the user's bots, with a per-bot menu for
// flagship / unpublish / delete.
import React, { useEffect, useRef, useState } from "react";

const LANG_BADGE = { javascript: "JS", typescript: "TS", python: "PY", lua: "LUA" };
const DOT = { draft: "bg-ink-600", calibrating: "bg-brass-400 animate-pulse", published: "bg-emerald-500" };

export default function BotsDrawer({ bots, loading, error, currentId, dirty, onOpen, onNew, onFlagship, onUnpublish, onDelete }) {
  const [menu, setMenu] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e) => ref.current && !ref.current.contains(e.target) && setMenu(null);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  return (
    <div className="h-full flex flex-col bg-ink-900 min-w-0" ref={ref}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-ink-700 shrink-0">
        <span className="text-[11px] uppercase tracking-wider text-ink-600">My bots</span>
        <button onClick={onNew} className="text-xs px-2 py-0.5 rounded border border-ink-700 hover:border-brass-500 hover:text-brass-400 transition-colors">
          + New
        </button>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
        {error && <p className="text-ember-300 text-xs px-3 py-2">{error}</p>}
        {loading && <p className="text-ink-600 text-xs italic px-3 py-2">Loading…</p>}
        {!loading && bots.length === 0 && <p className="text-ink-600 text-xs italic px-3 py-2">No bots yet. Write one and save it.</p>}
        {bots.map((b) => (
          <div key={b.botId} className={`group relative flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer ${currentId === b.botId ? "bg-brass-500/10 text-parchment" : "hover:bg-ink-800 text-parchment/90"}`}>
            <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[b.status] || DOT.draft}`} title={b.status} />
            <button className="flex-1 min-w-0 text-left" onClick={() => onOpen(b)}>
              <span className="truncate block">
                {b.isFlagship && <span className="text-brass-500 mr-1" title="Flagship">★</span>}
                {b.name}
                {currentId === b.botId && dirty && <span className="text-brass-400"> ●</span>}
              </span>
            </button>
            <span className="text-[10px] font-mono px-1 rounded border border-ink-700 text-ink-600">{LANG_BADGE[b.language] || "JS"}</span>
            {b.rating && b.status !== "draft" && <span className="text-[11px] font-mono text-ink-600">{Math.round(b.rating.value)}</span>}
            <button onClick={() => setMenu(menu === b.botId ? null : b.botId)} className="opacity-60 hover:opacity-100 px-1" aria-label="Bot actions">
              ⋯
            </button>
            {menu === b.botId && (
              <div className="absolute right-2 top-8 z-20 w-40 bg-ink-800 border border-ink-700 rounded-md shadow-xl text-xs overflow-hidden">
                <MenuItem onClick={() => { setMenu(null); onFlagship(b); }}>{b.isFlagship ? "Unset flagship" : "Set as flagship"}</MenuItem>
                {b.status === "published" && <MenuItem onClick={() => { setMenu(null); onUnpublish(b); }}>Unpublish</MenuItem>}
                <MenuItem danger onClick={() => { setMenu(null); onDelete(b); }}>Delete</MenuItem>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MenuItem({ children, onClick, danger }) {
  return (
    <button onClick={onClick} className={`w-full text-left px-3 py-2 hover:bg-ink-700 ${danger ? "text-ember-300" : ""}`}>
      {children}
    </button>
  );
}
