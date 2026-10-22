// server/src/bots/library.js — host-side implementation of the bot chess
// library. Runs in the runner process (never inside a bot VM). Every
// function is stateless: it takes a FEN and returns plain JSON-safe data.
const { Chess } = require("chess.js");

const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const uci = (m) => `${m.from}${m.to}${m.promotion || ""}`;
const parseMove = (mv) => ({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv.length > 4 ? mv[4] : undefined });

function createLibrary() {
  const cache = new Map(); // fen -> Chess (per move, never shared across runs)
  function pos(fen) {
    let c = cache.get(fen);
    if (!c) {
      c = new Chess(fen); // throws on a malformed FEN; the bridge turns that into an error value
      if (cache.size >= 64) cache.delete(cache.keys().next().value);
      cache.set(fen, c);
    }
    return c;
  }
  const movesCache = new Map();
  const legal = (fen) => {
    let m = movesCache.get(fen);
    if (!m) {
      m = pos(fen).moves({ verbose: true });
      if (movesCache.size >= 64) movesCache.delete(movesCache.keys().next().value);
      movesCache.set(fen, m);
    }
    return m;
  };
  // Play a move on the cached position and restore it afterwards.
  const after = (fen, mv, fn) => {
    const c = pos(fen);
    const p = parseMove(mv);
    const made = c.move({ from: p.from, to: p.to, promotion: p.promotion });
    try {
      return fn(c, made);
    } finally {
      c.undo();
    }
  };
  const find = (fen, mv) => {
    const p = parseMove(mv);
    return legal(fen).find((m) => m.from === p.from && m.to === p.to && (m.promotion || undefined) === p.promotion) || null;
  };
  const scan = (fen) => {
    const out = [];
    pos(fen).board().forEach((row, r) =>
      row.forEach((cell, f) => {
        if (cell) out.push({ type: cell.type, color: cell.color, square: "abcdefgh"[f] + (8 - r) });
      })
    );
    return out;
  };

  return {
    getLegalMoves: (fen) => legal(fen).map(uci),
    getMovesFrom: (fen, sq) => pos(fen).moves({ square: sq, verbose: true }).map(uci),
    getCaptureMoves: (fen) => legal(fen).filter((m) => m.flags.includes("c") || m.flags.includes("e")).map(uci),
    makeMove: (fen, mv) => (find(fen, mv) ? after(fen, mv, (c) => c.fen()) : null),
    isLegal: (fen, mv) => !!find(fen, mv),
    toSan: (fen, mv) => {
      const m = find(fen, mv);
      return m ? m.san : null;
    },
    getTurn: (fen) => pos(fen).turn(),
    getPiece: (fen, sq) => {
      const p = pos(fen).get(sq);
      return p ? { type: p.type, color: p.color } : null;
    },
    getBoard: (fen) => pos(fen).board().map((row) => row.map((c) => (c ? { type: c.type, color: c.color } : null))),
    hashPosition: (fen) => {
      pos(fen); // validates
      const key = fen.split(" ").slice(0, 4).join(" ");
      let h = 0x811c9dc5;
      for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      return h >>> 0;
    },
    getPieces: (fen, color) => scan(fen).filter((p) => p.color === color),
    getKingSquare: (fen, color) => {
      const k = scan(fen).find((p) => p.type === "k" && p.color === color);
      return k ? k.square : null;
    },
    getMaterial: (fen) => {
      const out = { w: 0, b: 0 };
      for (const p of scan(fen)) out[p.color] += VALUES[p.type];
      return out;
    },
    pieceValue: (type) => VALUES[type],
    isCheck: (fen) => pos(fen).isCheck(),
    isCheckmate: (fen) => pos(fen).isCheckmate(),
    isStalemate: (fen) => pos(fen).isStalemate(),
    isDraw: (fen) => pos(fen).isDraw(),
    isGameOver: (fen) => pos(fen).isGameOver(),
    isCapture: (fen, mv) => {
      const m = find(fen, mv);
      return !!m && (m.flags.includes("c") || m.flags.includes("e"));
    },
    isPromotion: (fen, mv) => {
      const m = find(fen, mv);
      return !!m && !!m.promotion;
    },
    givesCheck: (fen, mv) => {
      return find(fen, mv) ? after(fen, mv, (c) => c.isCheck()) : false;
    },
    getAttackers: (fen, sq, color) => pos(fen).attackers(sq, color),
    isSquareAttacked: (fen, sq, color) => pos(fen).isAttacked(sq, color),
  };
}

module.exports = { createLibrary };
