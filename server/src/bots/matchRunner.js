// server/src/bots/matchRunner.js — Bot Arena, Phase 2
//
// Plays one complete, unattended game between two players — each either a
// user bot ({type:"bot", botId, code}) or a fixed anchor engine
// ({type:"anchor", anchorId, engineTier}) — for the calibration gauntlet
// and the ladder. Deliberately separate from botEngineService.js (which
// drives a bot's move in a live human game one move at a time, called from
// gameManager): this module owns the whole game loop itself, since nothing
// here is waiting on a human or a socket connection.
//
// Every principle from bot-arena-design.md's human-vs-bot flow still
// applies: a bot's returned move is never trusted directly, it's
// re-validated against chess.js's own legal-move list before being played,
// on every single ply, no exception for "trusted" ladder/calibration
// contexts. A bot that fails to produce a legal move forfeits immediately
// — same fairness principle as botEngineService, no fallback move on its
// behalf. An anchor "player" goes through the existing engines/engineService
// (which already has its own forgiving random-move fallback for *its own*
// bugs, same as it does for human-vs-computer games).

const { Chess } = require("chess.js");
const { runBotMove } = require("./runnerPool");
const engineService = require("../engines/engineService");
const { secretSeed } = require("./seed");
const { runnableOf } = require("./languages");

const MAX_PLIES = 120; // 60 full moves — bounded so a background ladder/calibration match against a
// weak, deterministic bot (which tends to shuffle rather than resign or get mated quickly) can't run away
// in wall-clock time when paired against a slower anchor tier (depth-3 minimax at ~0.5-1s/move). Still
// generous enough for a decisive result in the vast majority of real games at this engine strength.
const SYNTHETIC_TIME_BUDGET_MS = 30_000; // ladder/calibration games have no real human clock; see the status doc for why

function uciFor(move) {
  return `${move.from}${move.to}${move.promotion || ""}`;
}

function describePlayer(player) {
  if (player.type === "anchor") return player.label || player.anchorId;
  return player.name || `bot:${player.botId}`;
}

async function getBotPlyMove(player, chess, matchId, plyIndex) {
  const legalMoves = chess.moves({ verbose: true }).map(uciFor);
  const state = {
    fen: chess.fen(),
    legalMoves,
    turn: chess.turn(),
    timeRemainingMs: SYNTHETIC_TIME_BUDGET_MS,
    incrementMs: 0,
    history: chess.history(),
  };
  const seed = secretSeed(`${matchId}:${plyIndex}`);
  const run = runnableOf({ language: player.language, code: player.code, compiled: player.compiled });
  const result = await runBotMove({ code: run.code, language: run.language, state, seed });
  if (!result.ok) return { ok: false, reason: result.reason };
  if (!legalMoves.includes(result.move)) {
    return { ok: false, reason: `Bot returned "${result.move}", which is not a legal move in this position.` };
  }
  return { ok: true, move: result.move };
}

// Automated ladder/calibration play calls the anchor engine far more often
// per unit time than a human ever would (a whole 10-game gauntlet back to
// back, unattended), and depth-3 minimax on the hard/expert tiers is
// synchronous, CPU-bound JS with no yield point — measured directly during
// Phase 2 verification, a single bot-vs-hard-anchor game routinely took
// 45-60+ real seconds, which a setTimeout-based race can't bound since
// nothing yields back to the event loop mid-computation. Rather than
// weakening what a human actually plays against (engines/engineService.js
// and tieredEngine.js are untouched), AUTOMATED matches specifically play
// the hard/expert anchors at the medium tier's depth instead — still a
// real, non-random minimax opponent, just shallow enough (~depth 2) to
// keep a whole unattended gauntlet's wall-clock cost sane on the single
// small box bot-arena-design.md's non-functional requirements call for.
// The anchors' fixed calibration ratings (bots/anchors.js) are unchanged
// by this — they're reference points for the ladder, not a promise that
// automated play is byte-identical in strength to the human-facing tier
// at every ply.
const AUTOMATED_ANCHOR_TIER_OVERRIDE = { hard: "medium", expert: "medium" };

async function getAnchorPlyMove(player, chess) {
  try {
    const tier = AUTOMATED_ANCHOR_TIER_OVERRIDE[player.engineTier] || player.engineTier;
    const move = await engineService.getMove(chess.fen(), tier);
    return { ok: true, move: uciFor(move) };
  } catch (err) {
    // engineService already falls back internally on its own errors; this
    // catch is only a last-resort backstop so a match can never hang.
    return { ok: false, reason: `Anchor engine error: ${err && err.message}` };
  }
}

function getPlyMove(player, chess, matchId, plyIndex) {
  return player.type === "anchor" ? getAnchorPlyMove(player, chess) : getBotPlyMove(player, chess, matchId, plyIndex);
}

/**
 * @param {object} args
 * @param {string} args.matchId - used to derive per-ply deterministic seeds
 * @param {object} args.white - {type:"bot",botId,code,name} | {type:"anchor",anchorId,engineTier,label}
 * @param {object} args.black - same shape as white
 * @param {string} args.openingFen
 * @returns {Promise<{resultCode: "1-0"|"0-1"|"1/2-1/2", reason: string, pgn: string, plyCount: number, forfeitColor: "w"|"b"|null, forfeitReason: string|null}>}
 */
async function playMatch({ matchId, white, black, openingFen }) {
  const chess = new Chess(openingFen);
  let plyIndex = 0;
  let forfeitColor = null;
  let forfeitReason = null;

  while (!chess.isGameOver() && plyIndex < MAX_PLIES) {
    const mover = chess.turn() === "w" ? white : black;
    const plyResult = await getPlyMove(mover, chess, matchId, plyIndex);
    if (!plyResult.ok) {
      forfeitColor = chess.turn();
      forfeitReason = plyResult.reason;
      break;
    }
    const uci = plyResult.move;
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci.slice(4) : undefined });
    plyIndex++;
  }

  let resultCode;
  let reason;
  if (forfeitColor) {
    resultCode = forfeitColor === "w" ? "0-1" : "1-0";
    reason = "forfeit";
  } else if (chess.isCheckmate()) {
    resultCode = chess.turn() === "w" ? "0-1" : "1-0"; // side to move is the one checkmated
    reason = "checkmate";
  } else if (chess.isStalemate()) {
    resultCode = "1/2-1/2";
    reason = "stalemate";
  } else if (chess.isThreefoldRepetition()) {
    resultCode = "1/2-1/2";
    reason = "threefold_repetition";
  } else if (chess.isInsufficientMaterial()) {
    resultCode = "1/2-1/2";
    reason = "insufficient_material";
  } else if (chess.isDrawByFiftyMoves()) {
    resultCode = "1/2-1/2";
    reason = "fifty_move_rule";
  } else if (plyIndex >= MAX_PLIES) {
    resultCode = "1/2-1/2";
    reason = "move_limit";
  } else {
    resultCode = "1/2-1/2";
    reason = "draw";
  }

  chess.header("White", describePlayer(white), "Black", describePlayer(black), "Result", resultCode);
  const pgn = chess.pgn();

  return { resultCode, reason, pgn, plyCount: plyIndex, forfeitColor, forfeitReason };
}

module.exports = { playMatch, MAX_PLIES };
