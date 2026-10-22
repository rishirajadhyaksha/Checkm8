// Left pane: Library reference (searchable, per-language signatures, Insert /
// Try it), Guide (the bot contract) and Examples (starter bots).
import React, { useMemo, useState } from "react";
import { methodName, signature, utilitySignature, snippetFor, plainCallFor } from "../libraryClient";

const CATEGORY_ORDER = ["Moves", "Position", "Pieces", "Tactics", "Utility"];

export default function DocsPane({ data, language, onInsert, onTry, onInsertTemplate, tryResult }) {
  const [tab, setTab] = useState("library");
  return (
    <div className="h-full flex flex-col bg-ink-800 min-w-0">
      <div className="flex border-b border-ink-700 text-sm shrink-0" role="tablist">
        {[
          ["library", "Library"],
          ["guide", "Guide"],
          ["examples", "Examples"],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`px-4 py-2.5 border-b-2 transition-colors ${tab === id ? "border-brass-500 text-brass-300" : "border-transparent text-ink-600 hover:text-parchment"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {!data && <p className="p-4 text-sm text-ink-600 italic">Loading reference…</p>}
        {data && tab === "library" && <LibraryTab data={data} language={language} onInsert={onInsert} onTry={onTry} tryResult={tryResult} />}
        {data && tab === "guide" && <GuideTab data={data} language={language} />}
        {data && tab === "examples" && <ExamplesTab data={data} language={language} onInsertTemplate={onInsertTemplate} />}
      </div>
    </div>
  );
}

function LibraryTab({ data, language, onInsert, onTry, tryResult }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(null);
  const { spec } = data;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = [
      ...spec.methods.map((m) => ({ kind: "method", key: m.name, category: m.category, m })),
      ...spec.utilities.map((u) => ({ kind: "utility", key: u.name, category: "Utility", u })),
    ].filter((it) => {
      if (!q) return true;
      const m = it.m || it.u;
      return (methodName(m, language) + " " + (m.description || "")).toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
    });
    const byCat = {};
    for (const it of items) (byCat[it.category] ||= []).push(it);
    return CATEGORY_ORDER.filter((c) => byCat[c]).map((c) => [c, byCat[c]]);
  }, [spec, query, language]);

  return (
    <div className="p-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search methods…"
        className="w-full text-sm bg-ink-900 border border-ink-700 rounded-md px-3 py-1.5 mb-3 focus:outline-none focus:border-brass-500"
      />
      <p className="text-xs text-ink-600 mb-3">
        Every method takes a FEN string. Moves are UCI strings like <code className="text-brass-400">e2e4</code>.
        {language === "python" || language === "lua" ? " Names are snake_case in this language." : ""}
      </p>
      {groups.length === 0 && <p className="text-sm text-ink-600 italic">No methods match "{query}".</p>}
      {groups.map(([category, items]) => (
        <section key={category} className="mb-4">
          <h3 className="text-[11px] uppercase tracking-wider text-ink-600 mb-1.5">{category}</h3>
          <ul className="flex flex-col gap-1">
            {items.map((it) => {
              const m = it.m || it.u;
              const isOpen = open === it.key;
              const sig = it.kind === "method" ? signature(m, language) : utilitySignature(m);
              return (
                <li key={it.key} className="border border-ink-700 rounded-md bg-ink-900/60">
                  <button onClick={() => setOpen(isOpen ? null : it.key)} className="w-full text-left px-2.5 py-1.5 flex items-center justify-between gap-2">
                    <code className="text-[12.5px] text-parchment truncate">{sig}</code>
                    <span className="text-ink-600 text-xs shrink-0">{isOpen ? "−" : "+"}</span>
                  </button>
                  {isOpen && (
                    <div className="px-2.5 pb-2.5 text-xs text-ink-600 border-t border-ink-700 pt-2">
                      <p className="text-parchment/90 mb-1.5">{m.description}</p>
                      <p className="mb-1.5">
                        Returns <code className="text-brass-400">{m.returns}</code>
                      </p>
                      {it.kind === "method" && (
                        <pre className="bg-ink-950 border border-ink-700 rounded p-2 font-mono text-[11.5px] text-parchment overflow-x-auto mb-2 whitespace-pre-wrap break-all">
                          {m.examples[language]}
                        </pre>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => onInsert(it.kind === "method" ? snippetFor(m, language) : m.name === "log" ? "log()" : "random()")}
                          className="px-2 py-0.5 rounded border border-ink-700 hover:border-brass-500 hover:text-brass-400 transition-colors"
                        >
                          Insert
                        </button>
                        {it.kind === "method" && (
                          <button onClick={() => onTry(m)} className="px-2 py-0.5 rounded border border-ink-700 hover:border-brass-500 hover:text-brass-400 transition-colors">
                            Try it
                          </button>
                        )}
                      </div>
                      {tryResult && tryResult.key === it.key && (
                        <pre className="mt-2 bg-ink-950 border border-ink-700 rounded p-2 font-mono text-[11.5px] text-brass-300 whitespace-pre-wrap break-all">{tryResult.text}</pre>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function GuideTab({ data, language }) {
  const info = data.languages.find((l) => l.id === language);
  const snake = language === "python" || language === "lua";
  const entry = info ? info.entry : "chooseMove";
  const fields = snake
    ? [["fen", "Position as a FEN string"], ["legal_moves", "List of legal moves, e.g. \"e2e4\", \"e7e8q\""], ["turn", "\"w\" or \"b\""], ["time_remaining_ms", "Your clock"], ["increment_ms", "Increment per move"], ["history", "Moves played so far (SAN)"]]
    : [["fen", "Position as a FEN string"], ["legalMoves", "Array of legal moves, e.g. \"e2e4\", \"e7e8q\""], ["turn", "\"w\" or \"b\""], ["timeRemainingMs", "Your clock"], ["incrementMs", "Increment per move"], ["history", "Moves played so far (SAN)"]];
  return (
    <div className="p-4 text-sm leading-relaxed space-y-4">
      <section>
        <h3 className="font-semibold mb-1">The contract</h3>
        <p className="text-ink-600">
          Define <code className="text-brass-400">{entry}(state)</code>. It runs once per move and must return exactly one string from the legal moves. Return anything else, throw, or run out of time and the bot forfeits that game.
        </p>
        {info && info.beta && <p className="mt-2 text-xs text-brass-400 border border-brass-500/40 rounded px-2 py-1">{info.label} support is in beta.</p>}
      </section>
      <section>
        <h3 className="font-semibold mb-1">The state object</h3>
        <table className="w-full text-xs">
          <tbody>
            {fields.map(([k, d]) => (
              <tr key={k} className="border-t border-ink-700">
                <td className="py-1 pr-2 font-mono text-brass-400 whitespace-nowrap">{k}</td>
                <td className="py-1 text-ink-600">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-ink-600 mt-2">
          <code>history</code> already includes the move that triggered your turn, so playing Black first it has length 1.
        </p>
      </section>
      <section>
        <h3 className="font-semibold mb-1">Limits</h3>
        <ul className="text-ink-600 text-xs list-disc pl-4 space-y-0.5">
          <li>{info ? info.limits.deadlineMs : 1500} ms per move, {info ? info.limits.memoryMB : 16} MB of memory</li>
          <li>{info ? Math.round(info.limits.maxSourceBytes / 1024) : 20} KB of source</li>
          <li>{info ? info.limits.maxLibraryCalls : 5000} library calls per move</li>
          <li>No network, files, or timers. Output is capped at 4 KB.</li>
        </ul>
      </section>
      <section>
        <h3 className="font-semibold mb-1">Determinism</h3>
        <p className="text-ink-600 text-xs">
          Use <code className="text-brass-400">{language === "javascript" || language === "typescript" ? "random()" : language === "python" ? "random.random()" : "random()"}</code> for randomness: it is seeded per match, so any game can be replayed exactly. The same position and seed always give the same move.
        </p>
      </section>
      {language === "python" && (
        <section>
          <h3 className="font-semibold mb-1">Python notes</h3>
          <p className="text-ink-600 text-xs">
            MicroPython, a lean subset of Python 3. You can <code>import math, json, random, collections, chess</code>; other imports are blocked. <code>chess</code> and <code>log</code> are already in scope.
          </p>
        </section>
      )}
      {language === "lua" && (
        <section>
          <h3 className="font-semibold mb-1">Lua notes</h3>
          <p className="text-ink-600 text-xs">
            Lua 5.4 with the base, table, string and math libraries. Arrays are 1-indexed, and empty squares in <code>get_board</code> are <code>false</code>.
          </p>
        </section>
      )}
    </div>
  );
}

function ExamplesTab({ data, language, onInsertTemplate }) {
  const set = data.templates[language] || {};
  const labels = { random: ["Random", "Plays any legal move."], greedy: ["Greedy", "Best material after one move, takes mate."], minimax: ["Material search", "Depth-2 search assuming the best capture reply."] };
  return (
    <div className="p-3 flex flex-col gap-3">
      {Object.entries(set).map(([key, code]) => (
        <div key={key} className="border border-ink-700 rounded-md bg-ink-900/60">
          <div className="flex items-center justify-between px-3 py-2">
            <div>
              <div className="text-sm font-medium">{(labels[key] || [key])[0]}</div>
              <div className="text-xs text-ink-600">{(labels[key] || ["", ""])[1]}</div>
            </div>
            <button onClick={() => onInsertTemplate(code)} className="text-xs px-2 py-1 rounded border border-ink-700 hover:border-brass-500 hover:text-brass-400 transition-colors">
              Use
            </button>
          </div>
          <pre className="px-3 pb-3 text-[11.5px] font-mono text-ink-600 overflow-x-auto max-h-40">{code.split("\n").slice(0, 8).join("\n")}…</pre>
        </div>
      ))}
    </div>
  );
}
