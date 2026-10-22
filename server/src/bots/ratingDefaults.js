// server/src/bots/ratingDefaults.js — Bot Arena, Phase 2
//
// The starting rating object a bot gets the moment it first enters the
// calibration gauntlet (see routes/bots.js's publish handler). 1200 is an
// arbitrary but reasonable midpoint starting point — the actual anchor
// gauntlet (bots/ladderScheduler.js) is what pulls it toward something
// meaningful within its first 10 games, well inside the K=40 provisional
// window (see bots/eloService.js).

function freshRating() {
  return { value: 1200, gamesPlayed: 0, kFactor: 40, provisional: true };
}

function freshRecord() {
  return { wins: 0, losses: 0, draws: 0 };
}

module.exports = { freshRating, freshRecord };
