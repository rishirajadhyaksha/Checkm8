// engines/engineService.js — Section 10.2
//
// All tiers implement one interface so the game-logic layer never needs to
// know which is in use. Easy/Medium/Hard/Expert now drive a REAL Stockfish
// binary over UCI (stockfishEngine.js) — the doc's original intent — with
// automatic fallback to the in-process minimax engine (tieredEngine.js) if
// no Stockfish binary is installed on the host, so computer games never
// hard-break on a machine that hasn't run `apt install stockfish` yet.
// Practice Bot remains the hand-written placeholder from Section 10.4.

const { Chess } = require("chess.js");
const stockfishEngine = require("./stockfishEngine");
const { getTieredMoveAsync } = require("./tieredEngine");
const practiceEngine = require("./practiceEngine");

let stockfishChecked = false;
let stockfishOk = false;

async function checkStockfishOnce() {
  if (!stockfishChecked) {
    stockfishChecked = true;
    stockfishOk = await stockfishEngine.isAvailable();
    if (stockfishOk) {
      console.log("[engineService] Real Stockfish binary found — using it for easy/medium/hard/expert.");
    } else {
      console.warn("[engineService] No Stockfish binary found — falling back to the built-in minimax engine. Run `apt install stockfish` on the host for stronger, more realistic play.");
    }
  }
  return stockfishOk;
}

/**
 * @param {string} fen
 * @param {"easy"|"medium"|"hard"|"expert"|"practice"} tier
 * @returns {Promise<{from: string, to: string, promotion?: string}>}
 */
async function getMove(fen, tier) {
  try {
    if (tier === "practice") {
      const chess = new Chess(fen);
      const move = practiceEngine.chooseMove(chess);
      return { from: move.from, to: move.to, promotion: move.promotion };
    }

    const hasStockfish = await checkStockfishOnce();
    if (hasStockfish) {
      try {
        return await stockfishEngine.getStockfishMove(fen, tier);
      } catch (err) {
        console.error(`[engineService] Stockfish call failed (${err.message}), falling back to minimax for this move.`);
        // fall through to minimax below
      }
    }
    return await getTieredMoveAsync(fen, tier === "expert" ? "hard" : tier);
  } catch (err) {
    // A bad/buggy engine implementation can at worst throw — fall back to a
    // uniformly random legal move so the game never gets stuck (Section 10.4).
    console.error(`[engineService] tier=${tier} threw, falling back to random move:`, err.message);
    const chess = new Chess(fen);
    const moves = chess.moves({ verbose: true });
    const m = moves[Math.floor(Math.random() * moves.length)];
    return { from: m.from, to: m.to, promotion: m.promotion };
  }
}

module.exports = { getMove };
