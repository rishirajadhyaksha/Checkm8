// server/src/bots/botEngineService.js — Bot Arena, Phase 1
//
// The bot-game counterpart to ../engines/engineService.js: given a game's
// current position, produce the next move for a user-submitted bot.
//
// Deliberately DIFFERENT from engineService's philosophy in one important
// way: engineService falls back to a random legal move if a *built-in*
// engine implementation throws, so a bug there never gets a game stuck.
// A user's bot gets no such bailout — per bot-arena-design.md's fairness
// section, a bot that fails to produce a legal move forfeits the game.
// Falling back to a random move on its behalf would quietly mask a broken
// or malicious bot instead of surfacing it. See gameManager._triggerBotMove
// for how the forfeit is applied.
//
// Takes the bot's code as a plain argument (from game.botCode) rather than
// looking the bot up by id — the code is snapshotted onto the game record
// at game-creation time specifically so that editing or deleting a bot can
// never change what's playing in a game that's already started. Phase 2's
// ladder pins a codeHash per match for the identical reason.

const { Chess } = require("chess.js");
const { runBotMove } = require("./runnerPool");
const { storage } = require("../db");
const { secretSeed } = require("./seed");
const { runnableOf } = require("./languages");

/**
 * @param {object} game - the stored game record (must have botCode set)
 * @param {"w"|"b"} botColor
 * @returns {Promise<{ok: true, from: string, to: string, promotion?: string} | {ok: false, reason: string}>}
 */
async function getBotMove(game, botColor) {
  if (!game.botCode) return { ok: false, reason: "This game has no bot code attached." };

  const chess = new Chess(game.fen);
  const legalMoves = chess.moves({ verbose: true }).map((m) => `${m.from}${m.to}${m.promotion || ""}`);
  const history = storage.getMoves(game.gameId).map((m) => m.san);
  const state = {
    fen: game.fen,
    legalMoves,
    turn: game.turn,
    timeRemainingMs: (botColor === "w" ? game.whiteTimeMs : game.blackTimeMs) ?? 60_000,
    incrementMs: (game.incrementSeconds || 0) * 1000,
    history,
  };

  // Deterministic per-move seed (bot-arena-design.md's Bot API contract —
  // see bots/seed.js), derived from this game and how many moves have been
  // played so far, so a disputed or interesting human-vs-bot game is just
  // as replayable as a ladder match.
  const seed = secretSeed(`${game.gameId}:${history.length}`);

  const run = runnableOf({ language: game.botLanguage, code: game.botCode, compiled: game.botCompiled });
  const result = await runBotMove({ code: run.code, language: run.language, state, seed });

  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }
  if (!legalMoves.includes(result.move)) {
    return { ok: false, reason: `Bot returned "${result.move}", which is not a legal move in this position.` };
  }

  return {
    ok: true,
    from: result.move.slice(0, 2),
    to: result.move.slice(2, 4),
    promotion: result.move.length > 4 ? result.move.slice(4) : undefined,
  };
}

module.exports = { getBotMove };
