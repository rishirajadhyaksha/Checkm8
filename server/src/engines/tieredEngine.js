// engines/tieredEngine.js
//
// SUBSTITUTION NOTE: the design doc (Section 10.3) specifies driving the real
// Stockfish engine over UCI, via the `stockfish` npm WASM build in
// persistent-server mode or a Lambda Layer binary in serverless mode. This
// sandbox has no way to spawn/verify a native Stockfish binary or a
// multi-threaded WASM worker, so this file implements a small in-process
// minimax/alpha-beta engine with a material+mobility evaluation instead,
// exposed through the EXACT SAME TIER_CONFIG shape and EngineService
// contract (Section 10.2). Swapping this module for real Stockfish later
// is a drop-in change — nothing above `EngineService` needs to know.

const { Chess } = require("chess.js");

const TIER_CONFIG = {
  easy: { depth: 1, blunderChance: 0.3, noise: 0.6 },
  medium: { depth: 2, blunderChance: 0.05, noise: 0.2 },
  hard: { depth: 3, blunderChance: 0, noise: 0.02 },
};

const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Small positional nudge tables (white's perspective; mirrored for black).
const PAWN_PST = [
  0, 0, 0, 0, 0, 0, 0, 0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
  5, 5, 10, 25, 25, 10, 5, 5,
  0, 0, 0, 20, 20, 0, 0, 0,
  5, -5, -10, 0, 0, -10, -5, 5,
  5, 10, 10, -20, -20, 10, 10, 5,
  0, 0, 0, 0, 0, 0, 0, 0,
];

function squareIndex(square) {
  const file = square.charCodeAt(0) - "a".charCodeAt(0);
  const rank = parseInt(square[1], 10) - 1;
  return (7 - rank) * 8 + file;
}

function evaluateBoard(chess) {
  let score = 0;
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      let value = PIECE_VALUES[piece.type];
      if (piece.type === "p") {
        const idx = r * 8 + c;
        value += piece.color === "w" ? PAWN_PST[idx] : PAWN_PST[63 - idx];
      }
      score += piece.color === "w" ? value : -value;
    }
  }
  // Small mobility term
  score += chess.turn() === "w" ? chess.moves().length : -chess.moves().length;
  return score;
}

function minimax(chess, depth, alpha, beta, maximizing) {
  if (depth === 0 || chess.isGameOver()) {
    return { score: evaluateBoard(chess) };
  }
  const moves = chess.moves({ verbose: true });
  let best = null;

  if (maximizing) {
    let value = -Infinity;
    for (const m of moves) {
      chess.move(m);
      const { score } = minimax(chess, depth - 1, alpha, beta, false);
      chess.undo();
      if (score > value) {
        value = score;
        best = m;
      }
      alpha = Math.max(alpha, value);
      if (beta <= alpha) break;
    }
    return { score: value, move: best };
  } else {
    let value = Infinity;
    for (const m of moves) {
      chess.move(m);
      const { score } = minimax(chess, depth - 1, alpha, beta, true);
      chess.undo();
      if (score < value) {
        value = score;
        best = m;
      }
      beta = Math.min(beta, value);
      if (beta <= alpha) break;
    }
    return { score: value, move: best };
  }
}

function pickRandomLegalMove(chess) {
  const moves = chess.moves({ verbose: true });
  return moves[Math.floor(Math.random() * moves.length)];
}

/** Given a FEN and tier, returns { from, to, promotion? }. */
function getTieredMove(fen, tier) {
  const cfg = TIER_CONFIG[tier];
  const chess = new Chess(fen);

  if (Math.random() < cfg.blunderChance) {
    return toUci(pickRandomLegalMove(chess));
  }

  const maximizing = chess.turn() === "w";
  const { move } = minimax(chess, cfg.depth, -Infinity, Infinity, maximizing);
  const chosen = move || pickRandomLegalMove(chess);
  return toUci(chosen);
}

function toUci(move) {
  return { from: move.from, to: move.to, promotion: move.promotion };
}

const path = require("path");
const { Worker } = require("worker_threads");

/** Async version: runs the search in a worker thread with a hard timeout. */
function getTieredMoveAsync(fen, tier, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "minimaxWorker.js"), { workerData: { fen, tier } });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("minimax worker timed out"));
    }, timeoutMs);
    worker.once("message", (msg) => {
      clearTimeout(timer);
      worker.terminate();
      msg.ok ? resolve(msg.move) : reject(new Error(msg.error));
    });
    worker.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

module.exports = { getTieredMove, getTieredMoveAsync, TIER_CONFIG };
