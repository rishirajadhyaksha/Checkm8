// server/src/bots/eloService.js — Bot Arena, Phase 2
//
// Plain Elo, exactly as specified in bot-arena-design.md's Rating system
// section: E_A = 1 / (1 + 10^((R_B - R_A)/400)), R_A' = R_A + K*(S_A - E_A).
// K-factor follows the provisional schedule (K=40 under 15 games, K=20
// from 15-100, K=10 beyond) so new bots converge fast and settled ones
// stay stable. Anchors keep a fixed rating and never call applyResult on
// themselves — "they're the ruler, not a participant" — so this module
// only ever mutates the non-anchor side of a pairing.

function kFactorFor(gamesPlayed) {
  if (gamesPlayed < 15) return 40;
  if (gamesPlayed < 100) return 20;
  return 10;
}

function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

// resultCode is from the mover's own perspective already resolved to a
// score: 1 (win), 0.5 (draw), 0 (loss).
function applyResult(rating, opponentRating, score) {
  const k = kFactorFor(rating.gamesPlayed);
  const expected = expectedScore(rating.value, opponentRating);
  const value = rating.value + k * (score - expected);
  const gamesPlayed = rating.gamesPlayed + 1;
  return {
    value: Math.round(value * 100) / 100,
    gamesPlayed,
    kFactor: kFactorFor(gamesPlayed),
    provisional: gamesPlayed < 15,
  };
}

// resultCode: "1-0" | "0-1" | "1/2-1/2". color: "w" | "b" — the side this
// rating belongs to in that particular game.
function scoreFor(resultCode, color) {
  if (resultCode === "1/2-1/2") return 0.5;
  if (resultCode === "1-0") return color === "w" ? 1 : 0;
  return color === "w" ? 0 : 1; // "0-1"
}

module.exports = { kFactorFor, expectedScore, applyResult, scoreFor };
