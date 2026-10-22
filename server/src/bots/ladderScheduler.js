// server/src/bots/ladderScheduler.js — Bot Arena, Phase 2
//
// The background worker bot-arena-design.md's "Execution flow — ladder"
// section describes. Runs in-process (this app is one Node process on one
// small box — a separate OS process/cron for this would be over-engineering
// for the actual scale here), on a plain interval, doing at most ONE unit
// of work per tick: either the next step of a calibration gauntlet, an
// overdue anchor-gauntlet drift correction, or one ladder mini-match. That
// one-thing-at-a-time discipline is what keeps this scheduler's footprint
// on the shared bot-runner pool small — every match here plays its moves
// strictly sequentially (never more than one in flight), so it can never
// approach the pool's concurrency ceiling and starve a live human's bot
// game, which always has spare workers free. See runOneTick()'s own
// concurrency check for the belt-and-suspenders version of that guarantee.
//
// Every rated game — calibration, drift correction, or ladder — funnels
// through the same playAndSettle() helper, which is also exactly what a
// periodic "drift correction" gauntlet is: an ordinary anchor match,
// scored with the bot's current (usually non-provisional) K-factor rather
// than a full reset. That's what "pulls a self-referentially-inflated
// rating back toward the fixed anchors" without needing separate logic.
//
// Exports runOneTick() as the real unit of work (directly callable from
// tests without waiting on a wall-clock interval) plus start()/stop() to
// wire it into a setInterval loop from index.js.

const { v4: uuidv4 } = require("uuid");
const { storage } = require("../db");
const killSwitch = require("./killSwitch");
const { getPool } = require("./runnerPool");
const { playMatch } = require("./matchRunner");
const eloService = require("./eloService");
const { ANCHORS } = require("./anchors");
const { openingFor, OPENING_BOOK } = require("./openingBook");
const { secretSeed } = require("./seed");

const TICK_MS = parseInt(process.env.LADDER_TICK_MS || "20000", 10);
const DAILY_GAME_CAP = parseInt(process.env.LADDER_DAILY_GAME_CAP || "400", 10); // bot-arena-design.md: "~300-500/day"
const DRIFT_CORRECTION_INTERVAL = parseInt(process.env.LADDER_DRIFT_INTERVAL || "200", 10); // "every ~200 ladder games per bot"
const RATING_BAND = 400; // prefer same-band opponents; widen if none available

let intervalHandle = null;
let dayBucket = null;
let gamesPlayedToday = 0;
let tickInFlight = false; // re-entrancy guard — see start()

function todayBucket() {
  return new Date().toISOString().slice(0, 10);
}

function budgetRemaining() {
  const today = todayBucket();
  if (dayBucket !== today) {
    dayBucket = today;
    gamesPlayedToday = 0;
  }
  return DAILY_GAME_CAP - gamesPlayedToday;
}

function recordGamesPlayed(n) {
  todayBucket(); // ensures the bucket is current before we add to it
  gamesPlayedToday += n;
}

function toPlayer(entry) {
  return entry.kind === "bot"
    ? { type: "bot", botId: entry.bot.botId, code: entry.bot.code, language: entry.bot.language, compiled: entry.bot.compiled, name: entry.bot.name }
    : { type: "anchor", anchorId: entry.anchor.anchorId, engineTier: entry.anchor.engineTier, label: entry.anchor.label };
}

function ratingValueOf(entry) {
  return entry.kind === "bot" ? entry.bot.rating.value : entry.anchor.fixedRating;
}

function applyBotResult(bot, opponentRatingValue, score) {
  bot.rating = eloService.applyResult(bot.rating, opponentRatingValue, score);
  if (score === 1) bot.record.wins += 1;
  else if (score === 0) bot.record.losses += 1;
  else bot.record.draws += 1;
  bot.gamesPlayedSinceCalibration = (bot.gamesPlayedSinceCalibration || 0) + 1;
  bot.lastActiveAt = Date.now();
  storage.saveBot(bot);
}

// Plays one game and settles it: Elo update for every bot participant
// (never for an anchor — "they're the ruler, not a participant"), record
// (W/L/D) bookkeeping, and a persisted botMatches row with the codeHash of
// every bot involved pinned at match time, exactly like a human game's
// game.botCodeHash snapshot — see bot-arena-design.md's data-integrity note.
async function playAndSettle({ matchType, whiteEntry, blackEntry, opening }) {
  const matchId = uuidv4();
  const whitePlayer = toPlayer(whiteEntry);
  const blackPlayer = toPlayer(blackEntry);
  const startedAt = Date.now();

  const outcome = await playMatch({ matchId, white: whitePlayer, black: blackPlayer, openingFen: opening.fen });

  const whiteRatingBefore = ratingValueOf(whiteEntry);
  const blackRatingBefore = ratingValueOf(blackEntry);
  const whiteScore = eloService.scoreFor(outcome.resultCode, "w");
  const blackScore = eloService.scoreFor(outcome.resultCode, "b");

  if (whiteEntry.kind === "bot") applyBotResult(whiteEntry.bot, blackRatingBefore, whiteScore);
  if (blackEntry.kind === "bot") applyBotResult(blackEntry.bot, whiteRatingBefore, blackScore);

  const match = {
    matchId,
    matchType, // "calibration" | "ladder"
    participants: [
      {
        botId: whiteEntry.kind === "bot" ? whiteEntry.bot.botId : null,
        anchorId: whiteEntry.kind === "anchor" ? whiteEntry.anchor.anchorId : null,
        codeHash: whiteEntry.kind === "bot" ? whiteEntry.bot.codeHash : null,
        color: "w",
      },
      {
        botId: blackEntry.kind === "bot" ? blackEntry.bot.botId : null,
        anchorId: blackEntry.kind === "anchor" ? blackEntry.anchor.anchorId : null,
        codeHash: blackEntry.kind === "bot" ? blackEntry.bot.codeHash : null,
        color: "b",
      },
    ],
    opponentType: whiteEntry.kind === "anchor" || blackEntry.kind === "anchor" ? "anchor" : "bot",
    openingId: opening.openingId,
    seed: secretSeed(matchId),
    result: outcome.resultCode,
    reason: outcome.reason,
    pgn: outcome.pgn,
    plyCount: outcome.plyCount,
    startedAt,
    finishedAt: Date.now(),
    status: "completed",
  };
  storage.createBotMatch(match);
  recordGamesPlayed(1);
  return match;
}

// Ten games: every anchor, twice, colors alternated, rotating through the
// opening book — bot-arena-design.md's calibration gauntlet exactly. Used
// both for a bot's first calibration (isInitialCalibration: true — flips
// status "calibrating" -> "published" when done) and for the periodic
// drift-correction replay (isInitialCalibration: false — bot stays
// "published" throughout, this just folds ten ordinary anchor-rated games
// into its history to pull any self-referential drift back toward the
// fixed anchors).
async function runAnchorGauntlet(bot, { isInitialCalibration }) {
  let openingCounter = isInitialCalibration ? 0 : Math.floor(Math.random() * OPENING_BOOK.length);
  for (const anchor of ANCHORS) {
    for (const botColor of ["w", "b"]) {
      const opening = openingFor(openingCounter++);
      const botEntry = { kind: "bot", bot };
      const anchorEntry = { kind: "anchor", anchor };
      const whiteEntry = botColor === "w" ? botEntry : anchorEntry;
      const blackEntry = botColor === "w" ? anchorEntry : botEntry;
      await playAndSettle({ matchType: "calibration", whiteEntry, blackEntry, opening });

      // A gauntlet takes several real seconds (ten games' worth of awaited
      // sandbox/engine calls), which is plenty of time for an HTTP request
      // to land in between — the owner could unpublish or delete this very
      // bot while its gauntlet is still running. `bot` is the same live
      // object reference storage.getBot() would return, so an unpublish
      // handler's `bot.status = "draft"` is visible here immediately; if
      // that happened (or the bot was deleted outright), stop rather than
      // keep playing games — and never let the loop's own final save
      // resurrect a deleted bot or silently overwrite the owner's
      // unpublish back to "published" below.
      if (!storage.getBot(bot.botId) || (isInitialCalibration && bot.status !== "calibrating")) {
        return;
      }
    }
  }
  bot.calibratedCodeHash = bot.codeHash;
  bot.lastCalibratedAt = Date.now();
  bot.gamesPlayedSinceCalibration = 0;
  // Re-check right before the final save too — the last game's own await
  // is one more window for a concurrent unpublish/delete to land in.
  if (!storage.getBot(bot.botId)) return;
  if (isInitialCalibration) {
    if (bot.status !== "calibrating") return;
    bot.status = "published";
  }
  storage.saveBot(bot);
}

function pickDriftCorrectionBot() {
  return storage.listLeaderboardBots().find((b) => (b.gamesPlayedSinceCalibration || 0) >= DRIFT_CORRECTION_INTERVAL) || null;
}

function pickLadderPairing() {
  const bots = storage.listLeaderboardBots();
  if (bots.length < 2) return null;
  // Prioritize the bot with the fewest games (most rating uncertainty) —
  // matches the design doc's matchmaking preference.
  const sorted = [...bots].sort((a, b) => a.rating.gamesPlayed - b.rating.gamesPlayed);
  const a = sorted[0];
  let candidates = bots.filter((b) => b.botId !== a.botId && Math.abs(b.rating.value - a.rating.value) <= RATING_BAND);
  if (candidates.length === 0) candidates = bots.filter((b) => b.botId !== a.botId);
  if (candidates.length === 0) return null;
  const b = candidates[Math.floor(Math.random() * candidates.length)];
  return [a, b];
}

async function runLadderMiniMatch(botA, botB) {
  const opening = openingFor(Math.floor(Math.random() * OPENING_BOOK.length));
  await playAndSettle({ matchType: "ladder", whiteEntry: { kind: "bot", bot: botA }, blackEntry: { kind: "bot", bot: botB }, opening });
  await playAndSettle({ matchType: "ladder", whiteEntry: { kind: "bot", bot: botB }, blackEntry: { kind: "bot", bot: botA }, opening });
}

// The real unit of work. Returns a small { didWork, kind, detail } summary
// so callers (tests, an eventual admin/status page) can see what happened
// without re-deriving it from side effects.
async function runOneTick() {
  if (!killSwitch.isEnabled()) return { didWork: false, kind: "skipped", detail: "kill switch disabled" };

  // Soft concurrency guard: don't START new background work if the shared
  // pool was already busy at the top of this tick. See file header for why
  // this is a belt-and-suspenders check rather than the only protection —
  // the scheduler's own one-job-at-a-time footprint is the real guarantee.
  const stats = getPool().stats;
  if (stats.busy > 0 || stats.queued > 0) {
    return { didWork: false, kind: "skipped", detail: "bot-runner pool busy — yielding to live games" };
  }

  if (budgetRemaining() <= 0) {
    return { didWork: false, kind: "skipped", detail: "daily automated-game budget exhausted" };
  }

  const calibrating = storage.listCalibratingBots()[0];
  if (calibrating) {
    await runAnchorGauntlet(calibrating, { isInitialCalibration: true });
    return { didWork: true, kind: "calibration", detail: `${calibrating.name} (${calibrating.botId}) calibrated` };
  }

  const driftBot = pickDriftCorrectionBot();
  if (driftBot) {
    await runAnchorGauntlet(driftBot, { isInitialCalibration: false });
    return { didWork: true, kind: "drift-correction", detail: `${driftBot.name} (${driftBot.botId}) replayed the anchor gauntlet` };
  }

  const pairing = pickLadderPairing();
  if (pairing) {
    const [botA, botB] = pairing;
    await runLadderMiniMatch(botA, botB);
    return { didWork: true, kind: "ladder", detail: `${botA.name} vs ${botB.name}` };
  }

  return { didWork: false, kind: "idle", detail: "nothing to do — fewer than 2 published bots" };
}

function start() {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    // A single tick can run a whole 10-game calibration gauntlet, which
    // takes real seconds — comfortably longer than TICK_MS can be tuned
    // down to. Without this guard, the next interval firing while that
    // gauntlet is still awaited would start a SECOND runOneTick() call
    // concurrently, and (found during Phase 2 verification) both could
    // end up racing to mutate the very same bot's rating/record object at
    // once. One tick's work always finishes before the next one starts.
    if (tickInFlight) return;
    tickInFlight = true;
    runOneTick()
      .catch((err) => console.error("[ladderScheduler] tick failed:", err && err.message))
      .finally(() => {
        tickInFlight = false;
      });
  }, TICK_MS);
  if (intervalHandle.unref) intervalHandle.unref(); // never keep the process alive on its own
}

function stop() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}

module.exports = { runOneTick, start, stop, TICK_MS };
