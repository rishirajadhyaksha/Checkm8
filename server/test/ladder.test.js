// server/test/ladder.test.js — Bot Arena, Phase 2
//
// Covers the ladder/calibration/Elo pipeline end to end at the module
// level (no HTTP, no sockets): eloService's math in isolation, matchRunner
// determinism and forfeit handling, and ladderScheduler.runOneTick()
// driving a real bot from "calibrating" through a full anchor gauntlet to
// "published" with a plausible rating, then pairing two calibrated bots
// on the ladder and confirming both ratings move and a match record with
// a real PGN gets stored. Uses a scratch DATA_FILE so it never touches
// Rishi's real local data, same pattern as the Phase 0/1 curl/socket
// scripts used during manual verification, just automated this time.

const path = require("path");
const fs = require("fs");
const os = require("os");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const SCRATCH_DATA_FILE = path.join(os.tmpdir(), `checkm8-ladder-test-${Date.now()}.json`);
process.env.DATA_FILE = SCRATCH_DATA_FILE;
process.env.LADDER_SCHEDULER_ENABLED = "false"; // this test drives ticks manually
process.env.BOT_RUNNER_POOL_SIZE = "4";

const { storage } = require("../src/db");
const eloService = require("../src/bots/eloService");
const { playMatch } = require("../src/bots/matchRunner");
const ladderScheduler = require("../src/bots/ladderScheduler");
const { freshRating, freshRecord } = require("../src/bots/ratingDefaults");
const { shutdownPool } = require("../src/bots/runnerPool");

const RANDOM_BOT_CODE = "function chooseMove(state){ return state.legalMoves[Math.floor(Math.random()*state.legalMoves.length)]; }";
const FIRST_MOVE_BOT_CODE = "function chooseMove(state){ return state.legalMoves[0]; }";

function makeBot(overrides = {}) {
  const now = Date.now();
  const bot = {
    botId: overrides.botId || `bot-${Math.random().toString(36).slice(2)}`,
    ownerId: "test-owner",
    name: overrides.name || "Test Bot",
    code: RANDOM_BOT_CODE,
    codeHash: "test-hash",
    status: "draft",
    isFlagship: false,
    rating: null,
    record: freshRecord(),
    calibratedCodeHash: null,
    gamesPlayedSinceCalibration: 0,
    lastCalibratedAt: null,
    lastActiveAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  storage.createBot(bot);
  return bot;
}

test.after(() => {
  shutdownPool();
  fs.rmSync(SCRATCH_DATA_FILE, { force: true });
});

// ---- eloService ----

test("eloService: kFactorFor follows the provisional schedule", () => {
  assert.equal(eloService.kFactorFor(0), 40);
  assert.equal(eloService.kFactorFor(14), 40);
  assert.equal(eloService.kFactorFor(15), 20);
  assert.equal(eloService.kFactorFor(99), 20);
  assert.equal(eloService.kFactorFor(100), 10);
  assert.equal(eloService.kFactorFor(500), 10);
});

test("eloService: expectedScore is symmetric around equal ratings", () => {
  assert.equal(eloService.expectedScore(1200, 1200), 0.5);
  const higher = eloService.expectedScore(1400, 1200);
  const lower = eloService.expectedScore(1200, 1400);
  assert.ok(higher > 0.5, "higher-rated side should be favored");
  assert.ok(Math.abs(higher + lower - 1) < 1e-9, "expected scores for both sides should sum to 1");
});

test("eloService: applyResult moves rating toward the result and increments gamesPlayed", () => {
  const rating = freshRating();
  const afterWin = eloService.applyResult(rating, 1200, 1); // beat an equally-rated opponent
  assert.ok(afterWin.value > 1200, "a win against an equal opponent should raise rating");
  assert.equal(afterWin.gamesPlayed, 1);
  assert.equal(afterWin.provisional, true);

  const afterLoss = eloService.applyResult(rating, 1200, 0);
  assert.ok(afterLoss.value < 1200, "a loss against an equal opponent should lower rating");
});

test("eloService: scoreFor maps result codes correctly for each color", () => {
  assert.equal(eloService.scoreFor("1-0", "w"), 1);
  assert.equal(eloService.scoreFor("1-0", "b"), 0);
  assert.equal(eloService.scoreFor("0-1", "w"), 0);
  assert.equal(eloService.scoreFor("0-1", "b"), 1);
  assert.equal(eloService.scoreFor("1/2-1/2", "w"), 0.5);
  assert.equal(eloService.scoreFor("1/2-1/2", "b"), 0.5);
});

// ---- matchRunner ----

test("matchRunner: a deterministic bot pairing replays byte-for-byte given the same matchId", async () => {
  const args = {
    matchId: "determinism-test-match",
    white: { type: "bot", botId: "b1", code: RANDOM_BOT_CODE, name: "A" },
    black: { type: "bot", botId: "b2", code: RANDOM_BOT_CODE, name: "B" },
    openingFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  };
  const r1 = await playMatch(args);
  const r2 = await playMatch(args);
  assert.equal(r1.pgn, r2.pgn, "identical matchId + opening should produce an identical PGN");
  assert.ok(["1-0", "0-1", "1/2-1/2"].includes(r1.resultCode));
});

test("matchRunner: a bot that never returns a legal move forfeits immediately", async () => {
  const brokenCode = "function chooseMove(state){ return 'zz99'; }";
  const result = await playMatch({
    matchId: "forfeit-test-match",
    white: { type: "bot", botId: "b3", code: brokenCode, name: "Broken" },
    black: { type: "anchor", anchorId: "anchor-practice", engineTier: "practice", label: "Practice Bot" },
    openingFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  });
  assert.equal(result.reason, "forfeit");
  assert.equal(result.forfeitColor, "w");
  assert.equal(result.resultCode, "0-1");
  assert.ok(result.pgn.includes('[Result "0-1"]'));
});

// ---- ladderScheduler: calibration -> published, then a ladder pairing ----

test("ladderScheduler: a calibrating bot completes its full anchor gauntlet and gets published", async () => {
  const bot = makeBot({
    name: "Calibrating Bot",
    status: "calibrating",
    rating: freshRating(),
    code: FIRST_MOVE_BOT_CODE,
    codeHash: "hash-a",
  });

  // One tick == one full 10-game gauntlet (see ladderScheduler.runOneTick).
  const tickResult = await ladderScheduler.runOneTick();
  assert.equal(tickResult.didWork, true);
  assert.equal(tickResult.kind, "calibration");

  const updated = storage.getBot(bot.botId);
  assert.equal(updated.status, "published", "bot should be published after its gauntlet completes");
  assert.equal(updated.rating.gamesPlayed, 10, "5 anchors x 2 games each = 10 games");
  assert.equal(updated.calibratedCodeHash, updated.codeHash);
  assert.ok(updated.lastCalibratedAt, "lastCalibratedAt should be set");
  assert.equal(updated.record.wins + updated.record.losses + updated.record.draws, 10);

  const matches = storage.listMatchesForBot(bot.botId, 20);
  assert.equal(matches.length, 10);
  assert.ok(matches.every((m) => m.matchType === "calibration"));
  assert.ok(matches.every((m) => m.pgn && m.pgn.includes("[Result")), "every match should have a real PGN");
  assert.ok(matches.every((m) => m.opponentType === "anchor"));
});

test("ladderScheduler: calibration is prioritized over ladder pairing when both are pending", async () => {
  // A second bot ready to ladder-pair, plus a fresh bot still calibrating —
  // the scheduler should do the calibration first (see runOneTick's
  // priority order).
  makeBot({
    name: "Already Published",
    status: "published",
    rating: { value: 1200, gamesPlayed: 20, kFactor: 20, provisional: false },
    code: RANDOM_BOT_CODE,
    codeHash: "hash-b",
    calibratedCodeHash: "hash-b",
  });
  const stillCalibrating = makeBot({
    name: "Second Calibrating Bot",
    status: "calibrating",
    rating: freshRating(),
    code: RANDOM_BOT_CODE,
    codeHash: "hash-c",
  });

  const tickResult = await ladderScheduler.runOneTick();
  assert.equal(tickResult.kind, "calibration");
  assert.equal(storage.getBot(stillCalibrating.botId).status, "published");
});

test("ladderScheduler: two published bots get paired on the ladder and both ratings update", async () => {
  const before = storage.listLeaderboardBots();
  assert.ok(before.length >= 2, "should have at least 2 published bots from earlier tests to pair");
  const beforeSnapshot = Object.fromEntries(before.map((b) => [b.botId, b.rating.value]));

  const tickResult = await ladderScheduler.runOneTick();
  assert.equal(tickResult.kind, "ladder");

  const after = storage.listLeaderboardBots();
  const changed = after.filter((b) => beforeSnapshot[b.botId] !== undefined && b.rating.value !== beforeSnapshot[b.botId]);
  assert.ok(changed.length >= 2, "a ladder mini-match should move both participants' ratings");

  // listLeaderboardBots should stay sorted by rating descending.
  for (let i = 1; i < after.length; i++) {
    assert.ok(after[i - 1].rating.value >= after[i].rating.value, "leaderboard should be sorted by rating descending");
  }
});

test("ladderScheduler: runOneTick is a no-op when the kill switch is disabled", async () => {
  const killSwitch = require("../src/bots/killSwitch");
  killSwitch.disable("test");
  try {
    const result = await ladderScheduler.runOneTick();
    assert.equal(result.didWork, false);
    assert.equal(result.kind, "skipped");
  } finally {
    killSwitch.enable();
  }
});
