// server/src/bots/seed.js — Bot Arena, Phase 2
//
// bot-arena-design.md's Bot API contract section: "if Math.random is
// exposed at all, it must be seeded deterministically per match... That
// keeps every match byte-for-byte replayable later." This module is the
// one place that owns both halves of that: hashSeed() turns a
// human-readable identifier (matchId:plyIndex, or gameId:plyIndex for a
// human game) into a 32-bit integer, and MULBERRY32_SOURCE is the literal
// JS source of a tiny deterministic PRNG that sandbox.js splices into the
// wrapped bot source to override Math.random before the bot's own code
// runs. Keeping the algorithm in one string here (rather than duplicated
// between sandbox.js and the frontend's botSandbox.worker.js) means both
// sandboxes stay byte-for-byte consistent with each other.

// FNV-1a, 32-bit. Cheap, deterministic, not cryptographic — exactly what's
// needed to turn "matchId:ply" into a seed integer, nothing more.
function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32 — small, fast, good-enough statistical quality for game
// variety (not security). Takes over Math.random entirely so a bot that
// calls Math.random() during chooseMove() gets a deterministic sequence
// derived only from the seed, never real entropy.
const MULBERRY32_SOURCE = `
Math.random = (function (seed) {
  var s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})(__SEED__);
`;

function seededRandomPrelude(seedInt) {
  return MULBERRY32_SOURCE.replace("__SEED__", String(seedInt | 0));
}

// Server-secret seeds: with BOT_SEED_SECRET set, a seed is HMAC(secret,
// "id:ply") so knowing a public gameId/matchId no longer lets anyone
// predict (and pre-compute against) a bot's random choices. The same secret
// must stay stable for matches to remain replayable; without it we fall back
// to the plain hash.
const crypto = require("crypto");
function secretSeed(str) {
  const secret = process.env.BOT_SEED_SECRET;
  if (!secret) return hashSeed(str);
  return crypto.createHmac("sha256", secret).update(str).digest().readUInt32BE(0);
}

module.exports = { hashSeed, secretSeed, seededRandomPrelude };
