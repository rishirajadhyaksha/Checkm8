// Small board used by the console: shows the test position, draws the bot's
// chosen move as an arrow, and (in edit mode) lets you build a custom
// position by placing/removing pieces.
import React, { useMemo, useState } from "react";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";

const PALETTE = ["wK", "wQ", "wR", "wB", "wN", "wP", "bK", "bQ", "bR", "bB", "bN", "bP"];
const GLYPH = { wK: "♔", wQ: "♕", wR: "♖", wB: "♗", wN: "♘", wP: "♙", bK: "♚", bQ: "♛", bR: "♜", bB: "♝", bN: "♞", bP: "♟" };

export function fenToMap(fen) {
  const out = {};
  const rows = fen.split(" ")[0].split("/");
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += Number(ch);
      else {
        out["abcdefgh"[f] + (8 - r)] = (ch === ch.toUpperCase() ? "w" : "b") + ch.toUpperCase();
        f++;
      }
    }
  });
  return out;
}

export function mapToFen(map, turn) {
  const rows = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = "";
    let empty = 0;
    for (const file of "abcdefgh") {
      const p = map[file + rank];
      if (!p) empty++;
      else {
        if (empty) row += empty;
        empty = 0;
        row += p[0] === "w" ? p[1] : p[1].toLowerCase();
      }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join("/")} ${turn} - - 0 1`;
}

export function validateFen(fen) {
  try {
    const c = new Chess(fen);
    return { ok: true, turn: c.turn() };
  } catch (e) {
    return { ok: false, reason: "That isn't a valid position (each side needs exactly one king, and the side not to move can't be in check)." };
  }
}

export default function TestBoard({ fen, arrow, editing, onFenChange, width = 220 }) {
  const [palette, setPalette] = useState(null);
  const valid = validateFen(fen);
  const map = useMemo(() => (valid.ok ? fenToMap(fen) : {}), [fen, valid.ok]);
  const turn = valid.ok ? valid.turn : "w";

  function commit(next, nextTurn = turn) {
    onFenChange(mapToFen(next, nextTurn));
  }

  return (
    <div className="flex flex-col gap-2" style={{ width }}>
      <Chessboard
        id={`test-board-${editing ? "edit" : "view"}`}
        boardWidth={width}
        position={valid.ok ? fen : "8/8/8/8/8/8/8/8 w - - 0 1"}
        arePiecesDraggable={!!editing}
        onPieceDrop={(from, to) => {
          if (!editing) return false;
          const next = { ...map };
          next[to] = next[from];
          delete next[from];
          commit(next);
          return true;
        }}
        onSquareClick={(sq) => {
          if (!editing) return;
          const next = { ...map };
          if (palette) next[sq] = palette;
          else delete next[sq];
          commit(next);
        }}
        customDarkSquareStyle={{ backgroundColor: "#7c6142" }}
        customLightSquareStyle={{ backgroundColor: "#e9ddc4" }}
        customArrows={arrow ? [[arrow.slice(0, 2), arrow.slice(2, 4), "#c9a15a"]] : []}
        animationDuration={120}
      />
      {editing && (
        <>
          <div className="flex flex-wrap gap-1">
            {PALETTE.map((p) => (
              <button
                key={p}
                onClick={() => setPalette(palette === p ? null : p)}
                className={`w-7 h-7 rounded border text-lg leading-none ${palette === p ? "border-brass-500 bg-brass-500/20" : "border-ink-700 hover:border-ink-600"}`}
                title={palette === p ? "Click a square to place; click again to switch to erase" : "Place this piece"}
              >
                {GLYPH[p]}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-ink-600">{palette ? "Click a square to place the piece." : "Drag pieces to move them, or click a piece's square to erase it."}</p>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-ink-600">Side to move</span>
            {["w", "b"].map((t) => (
              <button key={t} onClick={() => commit(map, t)} className={`px-2 py-0.5 rounded border ${turn === t ? "border-brass-500 text-brass-300" : "border-ink-700 text-ink-600"}`}>
                {t === "w" ? "White" : "Black"}
              </button>
            ))}
          </div>
        </>
      )}
      {!valid.ok && <p className="text-xs text-ember-300">{valid.reason}</p>}
    </div>
  );
}
