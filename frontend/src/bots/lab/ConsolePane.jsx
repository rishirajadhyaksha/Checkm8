// Bottom of the right column: Test case / Result / Output tabs.
import React, { useState } from "react";
import TestBoard, { validateFen } from "./TestBoard";
import { SAMPLE_POSITIONS } from "../libraryClient";

export default function ConsolePane({ fen, onFenChange, result, running, activeTab, onTab }) {
  const tab = activeTab;
  const [editing, setEditing] = useState(false);
  const [fenDraft, setFenDraft] = useState(null);
  const valid = validateFen(fen);

  return (
    <div className="h-full flex flex-col bg-ink-800 min-h-0">
      <div className="flex items-center border-b border-ink-700 text-sm shrink-0" role="tablist">
        {[
          ["test", "Test case"],
          ["result", "Result"],
          ["output", `Output${result && result.logs && result.logs.length ? ` (${result.logs.length})` : ""}`],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => onTab(id)}
            className={`px-4 py-2 border-b-2 transition-colors ${tab === id ? "border-brass-500 text-brass-300" : "border-transparent text-ink-600 hover:text-parchment"}`}
          >
            {label}
          </button>
        ))}
        {running && <span className="ml-auto mr-3 text-xs text-brass-400 animate-pulse">Running…</span>}
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin p-3 min-h-0">
        {tab === "test" && (
          <div className="flex flex-wrap gap-4">
            <TestBoard fen={fen} editing={editing} onFenChange={(f) => { onFenChange(f); setFenDraft(null); }} />
            <div className="flex-1 min-w-[220px] flex flex-col gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-ink-600 mb-1.5">Sample positions</div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(SAMPLE_POSITIONS).map(([k, p]) => (
                    <button
                      key={k}
                      onClick={() => { onFenChange(p.fen); setFenDraft(null); }}
                      className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${fen === p.fen ? "border-brass-500 bg-brass-500/10 text-brass-300" : "border-ink-700 text-ink-600 hover:border-ink-600"}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-ink-600 mb-1.5">FEN</div>
                <input
                  value={fenDraft ?? fen}
                  onChange={(e) => {
                    setFenDraft(e.target.value);
                    if (validateFen(e.target.value).ok) onFenChange(e.target.value);
                  }}
                  spellCheck={false}
                  className={`w-full font-mono text-xs bg-ink-900 border rounded-md px-2.5 py-1.5 focus:outline-none ${valid.ok && (fenDraft == null || validateFen(fenDraft).ok) ? "border-ink-700 focus:border-brass-500" : "border-ember-600"}`}
                />
                {fenDraft != null && !validateFen(fenDraft).ok && <p className="text-xs text-ember-300 mt-1">Not a valid FEN yet.</p>}
              </div>
              <button
                onClick={() => setEditing((e) => !e)}
                className={`self-start text-xs px-2.5 py-1 rounded-md border transition-colors ${editing ? "border-brass-500 text-brass-300 bg-brass-500/10" : "border-ink-700 text-ink-600 hover:border-ink-600"}`}
              >
                {editing ? "Done editing" : "Edit board"}
              </button>
            </div>
          </div>
        )}

        {tab === "result" && (
          <div>
            {!result && <p className="text-sm text-ink-600 italic">Run your bot (Ctrl/Cmd + Enter) to see its move here.</p>}
            {result && (
              <div className="flex flex-wrap gap-4">
                <TestBoard fen={fen} arrow={result.ok ? result.move : null} width={200} />
                <div className="flex-1 min-w-[200px] text-sm">
                  <div className="text-[11px] uppercase tracking-wider text-ink-600 mb-1">{result.source === "server" ? "Server sandbox" : "In your browser"}</div>
                  {result.ok ? (
                    <div className="font-mono space-y-1">
                      <div>
                        move <span className="text-brass-300 font-bold text-base">{result.move}</span>
                        {result.san && <span className="text-ink-600"> ({result.san})</span>}
                      </div>
                      <div className="text-xs text-ink-600">
                        {typeof result.elapsedMs === "number" && <span>{result.elapsedMs} ms</span>}
                        {typeof result.libraryCalls === "number" && <span> · {result.libraryCalls} library calls</span>}
                      </div>
                    </div>
                  ) : (
                    <div className="font-mono text-ember-300 text-sm whitespace-pre-wrap break-words">{result.reason}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "output" && (
          <div>
            {(!result || !result.logs || result.logs.length === 0) && (
              <p className="text-sm text-ink-600 italic">Nothing printed yet. Use log(), print() or console.log() in your bot.</p>
            )}
            {result && result.logs && result.logs.length > 0 && (
              <pre className="font-mono text-xs text-parchment whitespace-pre-wrap break-words">
                {result.logs.map((l, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-ink-600 select-none">{String(i + 1).padStart(2, "0")}</span>
                    <span>{l}</span>
                  </div>
                ))}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
