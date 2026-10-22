// server/src/routes/bots.js — Bot Arena, Phase 0 + Phase 1 + Phase 2
//
// Phase 0 (status/sample-positions/test-run): a diagnostic sandbox
// exerciser, no persistence. Phase 1: real bot CRUD, publish/unpublish, and
// the flagship flag. Bots created here can actually be played against — see
// routes/games.js's POST /vs-bot/:botId and gameManager.js's
// createBotGame/_triggerBotMove. Phase 2 adds the calibration/publish state
// machine below (draft -> calibrating -> published, with the ladder
// scheduler in bots/ladderScheduler.js doing the actual gauntlet/ladder
// play in the background) and GET /:id/matches for a bot's PGN history —
// see bots/eloService.js and bots/matchRunner.js, and GET /leaderboard in
// routes/leaderboard.js for the ranked list. See bot-arena-design.md
// (project docs) for the full rollout plan.

const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const express = require("express");
const { Chess } = require("chess.js");
const { requireAuth } = require("../middleware/authMiddleware");
const { rateLimit } = require("../middleware/rateLimit");
const { checkSource, MAX_SOURCE_BYTES } = require("../bots/staticFilter");
const { runBotMove, getPool } = require("../bots/runnerPool");
const killSwitch = require("../bots/killSwitch");
const { storage } = require("../db");
const { freshRating, freshRecord } = require("../bots/ratingDefaults");
const { getAnchor } = require("../bots/anchors");
const { LANGUAGES, DEFAULT_LANGUAGE, isLanguage, compileForSave, runnableOf } = require("../bots/languages");
const { buildSpec } = require("../bots/librarySpec");
const { TEMPLATES } = require("../bots/templates");
const { scrubText } = require("../bots/scrub");
const audit = require("../bots/audit");

function anchorLabel(anchorId) {
  const anchor = getAnchor(anchorId);
  return anchor ? anchor.label : "Unknown anchor";
}

const router = express.Router();

const DEFAULT_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const MAX_NAME_LENGTH = 60;

// A few fixed sample positions for local iteration — matches what the
// in-browser local test mode offers, so results are comparable.
const SAMPLE_POSITIONS = {
  start: DEFAULT_FEN,
  "scholars-mate-setup": "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR b KQkq - 4 3",
  endgame_kp: "8/8/8/4k3/4P3/4K3/8/8 w - - 0 1",
};

// JavaScript keeps the original plain hash so every existing bot's
// calibration stays valid; other languages hash language + NUL + code, so
// the same text in two languages is two different bots.
function hashBot(language, code) {
  const input = language && language !== "javascript" ? `${language}\0${code}` : code;
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function languageInfo() {
  return Object.entries(LANGUAGES).map(([id, l]) => ({
    id,
    label: l.label,
    entry: l.entry,
    monaco: l.monaco,
    beta: l.beta,
    enabled: killSwitch.isLanguageEnabled(l.runtime === "quickjs" ? "javascript" : l.runtime),
    template: TEMPLATES[id] && TEMPLATES[id].random,
    limits: { maxSourceBytes: MAX_SOURCE_BYTES, deadlineMs: 1500, memoryMB: 16, maxLibraryCalls: 5000 },
  }));
}

function runtimeLanguageOf(language) {
  return language === "typescript" ? "javascript" : language;
}

// A single shared budget across create/edit/publish, per bot-arena-design.md
// ("10 per user per day") — one middleware instance, applied to all three
// mutating routes, so they draw from the same counter rather than each
// getting its own independent 10/day allowance.
const botMutationRateLimit = rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 10 });

// Never send a bot's source code to anyone but its owner — private by
// default, per bot-arena-design.md's leaderboard section, applied from the
// first version of this endpoint rather than bolted on later.
function publicView(bot, { includeCode = false } = {}) {
  const owner = storage.getUser(bot.ownerId);
  const view = {
    botId: bot.botId,
    ownerId: bot.ownerId,
    ownerUsername: owner ? owner.username : "Unknown",
    name: bot.name,
    language: bot.language || DEFAULT_LANGUAGE,
    status: bot.status, // "draft" | "calibrating" | "published"
    isFlagship: bot.isFlagship,
    rating: bot.rating, // null for a bot that's never been published; public once it exists (Phase 2 leaderboard)
    record: bot.record,
    lastCalibratedAt: bot.lastCalibratedAt,
    createdAt: bot.createdAt,
    updatedAt: bot.updatedAt,
  };
  if (includeCode) view.code = bot.code;
  return view;
}

router.get("/status", requireAuth, (req, res) => {
  res.json({ killSwitch: killSwitch.getStatus(), pool: getPool().stats, maxSourceBytes: MAX_SOURCE_BYTES });
});

router.get("/languages", requireAuth, (req, res) => {
  res.json(languageInfo());
});

router.get("/library-spec", requireAuth, (req, res) => {
  res.json(buildSpec());
});

// Prelude sources (the glue that exposes chess.* inside each runtime) so the
// browser's local runner uses the exact same code as the server.
router.get("/preludes", requireAuth, (req, res) => {
  res.json({
    javascript: require("../bots/runtimes/quickjs").PRELUDE,
    lua: require("../bots/runtimes/lua").buildPrelude(),
    python: require("../bots/runtimes/micropython").buildPrelude(),
  });
});

router.get("/templates", requireAuth, (req, res) => {
  res.json(TEMPLATES);
});

// Emergency switch: turn one language (or all bot execution) off/on without
// a deploy. Disabled unless BOT_ADMIN_TOKEN is set on the server.
router.post("/admin/language", (req, res) => {
  const token = process.env.BOT_ADMIN_TOKEN;
  if (!token || req.get("x-admin-token") !== token) return res.status(404).json({ error: "Not found." });
  const { language, enabled } = req.body || {};
  if (!isLanguage(language) && language !== "all") return res.status(400).json({ error: "unknown language" });
  if (language === "all") {
    enabled ? killSwitch.enable() : killSwitch.disable("admin request");
  } else {
    const rt = runtimeLanguageOf(language);
    enabled ? killSwitch.enableLanguage(rt) : killSwitch.disableLanguage(rt, "admin request");
  }
  audit.record("admin_language_toggle", { language, enabled: !!enabled });
  res.json({ ok: true, languages: killSwitch.getLanguageStatus(), killSwitch: killSwitch.getStatus() });
});

router.get("/audit", (req, res) => {
  const token = process.env.BOT_ADMIN_TOKEN;
  if (!token || req.get("x-admin-token") !== token) return res.status(404).json({ error: "Not found." });
  res.json(audit.recent(100));
});

router.get("/sample-positions", requireAuth, (req, res) => {
  res.json(SAMPLE_POSITIONS);
});

router.post("/test-run", requireAuth, rateLimit({ windowMs: 10_000, max: 15 }), async (req, res) => {
  const { code, fen, positionKey } = req.body;
  const language = isLanguage(req.body.language) ? req.body.language : DEFAULT_LANGUAGE;

  const filterResult = checkSource(code, language);
  if (!filterResult.ok) {
    return res.status(400).json({ ok: false, reason: `Rejected by static filter: ${filterResult.reason}` });
  }
  const compiledResult = compileForSave(language, code);
  if (!compiledResult.ok) return res.status(400).json({ ok: false, reason: compiledResult.reason });

  const chosenFen = (positionKey && SAMPLE_POSITIONS[positionKey]) || fen || DEFAULT_FEN;
  let chess;
  try {
    chess = new Chess(chosenFen);
  } catch {
    return res.status(400).json({ ok: false, reason: "Invalid FEN." });
  }

  const legalMoves = chess.moves({ verbose: true }).map((m) => `${m.from}${m.to}${m.promotion || ""}`);
  const state = {
    fen: chosenFen,
    legalMoves,
    turn: chess.turn(),
    timeRemainingMs: 60_000,
    incrementMs: 0,
    history: [],
  };

  const run = runnableOf({ language, code, compiled: compiledResult.compiled });
  const result = await runBotMove({ code: run.code, language: run.language, state });

  // Re-validate exactly like a real game would — the sandbox's answer is
  // never trusted on its own, here or anywhere else this gets wired into.
  if (result.ok && !legalMoves.includes(result.move)) {
    return res.json({ ok: false, reason: `chooseMove returned "${result.move}", which is not a legal move in this position.`, legalMoves });
  }

  res.json({ ...result, fen: chosenFen, legalMoves });
});

// ---------------------------------------------------------------------
// Phase 1 — real CRUD, publish/unpublish, flagship.
// ---------------------------------------------------------------------

router.get("/mine", requireAuth, (req, res) => {
  res.json(storage.listBotsForUser(req.userId).map((b) => publicView(b, { includeCode: true })));
});

router.get("/published", requireAuth, (req, res) => {
  res.json(storage.listPublishedBots().map((b) => publicView(b)));
});

router.get("/:id", requireAuth, (req, res) => {
  const bot = storage.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: "Bot not found." });
  const isOwner = bot.ownerId === req.userId;
  if (!isOwner && bot.status !== "published") return res.status(404).json({ error: "Bot not found." });
  res.json(publicView(bot, { includeCode: isOwner }));
});

router.post("/", requireAuth, botMutationRateLimit, (req, res) => {
  const { name, code } = req.body;
  const language = req.body.language === undefined ? DEFAULT_LANGUAGE : req.body.language;
  if (!isLanguage(language)) return res.status(400).json({ error: "Unknown language." });
  if (typeof name !== "string" || !name.trim() || name.length > MAX_NAME_LENGTH) {
    return res.status(400).json({ error: `name must be a non-empty string up to ${MAX_NAME_LENGTH} characters.` });
  }
  const filterResult = checkSource(code, language);
  if (!filterResult.ok) {
    return res.status(400).json({ error: `Rejected by static filter: ${filterResult.reason}` });
  }
  const compiledResult = compileForSave(language, code);
  if (!compiledResult.ok) return res.status(400).json({ error: compiledResult.reason });
  const now = Date.now();
  const bot = {
    botId: uuidv4(),
    ownerId: req.userId,
    name: name.trim(),
    language,
    code,
    compiled: compiledResult.compiled,
    codeHash: hashBot(language, code),
    status: "draft",
    isFlagship: false,
    rating: null, // set the first time it's published — see POST /:id/publish
    record: freshRecord(),
    calibratedCodeHash: null,
    gamesPlayedSinceCalibration: 0,
    lastCalibratedAt: null,
    lastActiveAt: null,
    createdAt: now,
    updatedAt: now,
  };
  storage.createBot(bot);
  res.status(201).json(publicView(bot, { includeCode: true }));
});

router.put("/:id", requireAuth, botMutationRateLimit, (req, res) => {
  const bot = storage.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: "Bot not found." });
  if (bot.ownerId !== req.userId) return res.status(403).json({ error: "You don't own this bot." });

  const { name, code } = req.body;
  const newLanguage = req.body.language === undefined ? bot.language || DEFAULT_LANGUAGE : req.body.language;
  if (!isLanguage(newLanguage)) return res.status(400).json({ error: "Unknown language." });
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim() || name.length > MAX_NAME_LENGTH) {
      return res.status(400).json({ error: `name must be a non-empty string up to ${MAX_NAME_LENGTH} characters.` });
    }
    bot.name = name.trim();
  }
  if (code !== undefined || newLanguage !== (bot.language || DEFAULT_LANGUAGE)) {
    const nextCode = code !== undefined ? code : bot.code;
    const filterResult = checkSource(nextCode, newLanguage);
    if (!filterResult.ok) {
      return res.status(400).json({ error: `Rejected by static filter: ${filterResult.reason}` });
    }
    const compiledResult = compileForSave(newLanguage, nextCode);
    if (!compiledResult.ok) return res.status(400).json({ error: compiledResult.reason });
    const codeActuallyChanged = nextCode !== bot.code || newLanguage !== (bot.language || DEFAULT_LANGUAGE);
    bot.language = newLanguage;
    bot.code = nextCode;
    bot.compiled = compiledResult.compiled;
    bot.codeHash = hashBot(newLanguage, nextCode);
    // bot-arena-design.md: "on any published edit, the rating resets to
    // 'calibrating' and the gauntlet re-runs... silently carrying a rating
    // over a materially different implementation would make the
    // leaderboard untrustworthy." A published (or still-mid-gauntlet)
    // bot whose code actually changed goes straight back into
    // calibration — not all the way to "draft", which would require a
    // separate manual re-publish — so the ladder scheduler picks it back
    // up on its own. Games already in progress are unaffected either way,
    // since they run off a code snapshot taken at game-creation time, not
    // a live lookup.
    if (codeActuallyChanged && (bot.status === "published" || bot.status === "calibrating")) {
      bot.status = "calibrating";
      bot.rating = freshRating();
      bot.record = freshRecord();
      bot.gamesPlayedSinceCalibration = 0;
    }
  }
  bot.updatedAt = Date.now();
  storage.saveBot(bot);
  res.json(publicView(bot, { includeCode: true }));
});

router.post("/:id/publish", requireAuth, botMutationRateLimit, async (req, res) => {
  const bot = storage.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: "Bot not found." });
  if (bot.ownerId !== req.userId) return res.status(403).json({ error: "You don't own this bot." });

  // A real sandbox smoke test before going live — catches a bot that's
  // syntactically broken or missing chooseMove entirely before it can be
  // challenged (or enter the calibration gauntlet) and immediately forfeit
  // every game.
  const chess = new Chess(DEFAULT_FEN);
  const legalMoves = chess.moves({ verbose: true }).map((m) => `${m.from}${m.to}${m.promotion || ""}`);
  const runnable = runnableOf(bot);
  const smokeTest = await runBotMove({
    code: runnable.code,
    language: runnable.language,
    state: { fen: DEFAULT_FEN, legalMoves, turn: "w", timeRemainingMs: 60_000, incrementMs: 0, history: [] },
  });
  if (!smokeTest.ok || !legalMoves.includes(smokeTest.move)) {
    return res.status(400).json({
      error: `Bot failed its publish smoke test from the starting position: ${smokeTest.reason || "returned an illegal move"}`,
    });
  }

  // If this exact code was already calibrated before (a plain
  // unpublish -> republish with no edit in between), skip straight back to
  // "published" and keep the existing rating — nothing about the bot
  // actually changed, so re-running the gauntlet would just be noise.
  // Otherwise this is either a first-ever publish or code that's changed
  // since the last calibration, so it goes into "calibrating" and
  // bots/ladderScheduler.js picks up the gauntlet in the background.
  if (bot.calibratedCodeHash && bot.calibratedCodeHash === bot.codeHash) {
    bot.status = "published";
  } else {
    bot.status = "calibrating";
    bot.rating = freshRating();
    bot.record = freshRecord();
    bot.gamesPlayedSinceCalibration = 0;
  }
  bot.updatedAt = Date.now();
  storage.saveBot(bot);
  res.json(publicView(bot, { includeCode: true }));
});

router.post("/:id/unpublish", requireAuth, (req, res) => {
  const bot = storage.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: "Bot not found." });
  if (bot.ownerId !== req.userId) return res.status(403).json({ error: "You don't own this bot." });
  // Drops out of the leaderboard and the calibration queue immediately
  // (both only ever look at status === "published"/"calibrating"). Rating,
  // record, and calibratedCodeHash are deliberately left alone: if the
  // owner republishes this same code later with no edits in between,
  // POST /:id/publish recognizes that and skips straight back to
  // "published" without re-running the gauntlet.
  bot.status = "draft";
  bot.updatedAt = Date.now();
  storage.saveBot(bot);
  res.json(publicView(bot, { includeCode: true }));
});

// Recent match history for a bot's profile page — bot-arena-design.md's
// "GET /api/bots/:id/matches ... match history + PGN links". Anyone can
// see a published (or previously-published) bot's matches; a still-draft
// bot has none to show, and an owner can always see their own.
router.get("/:id/matches", requireAuth, (req, res) => {
  const bot = storage.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: "Bot not found." });
  const isOwner = bot.ownerId === req.userId;
  if (!isOwner && bot.status === "draft") return res.status(404).json({ error: "Bot not found." });

  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  const matches = storage.listMatchesForBot(bot.botId, limit).map((m) => ({
    matchId: m.matchId,
    matchType: m.matchType,
    opponentType: m.opponentType,
    participants: m.participants.map((p) => ({
      color: p.color,
      botId: p.botId,
      anchorId: p.anchorId,
      name: p.botId ? (storage.getBot(p.botId)?.name ?? "Deleted bot") : anchorLabel(p.anchorId),
    })),
    openingId: m.openingId,
    result: m.result,
    reason: m.reason,
    plyCount: m.plyCount,
    finishedAt: m.finishedAt,
    pgn: m.pgn,
  }));
  res.json(matches);
});

router.put("/:id/flagship", requireAuth, (req, res) => {
  const bot = storage.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: "Bot not found." });
  if (bot.ownerId !== req.userId) return res.status(403).json({ error: "You don't own this bot." });

  const makeFlagship = !!req.body.isFlagship;
  if (makeFlagship) {
    // Only one flagship at a time — matches the original idea ("their
    // flagship strategy") and Phase 2's per-bot rating/leaderboard framing.
    for (const other of storage.listBotsForUser(req.userId)) {
      if (other.botId !== bot.botId && other.isFlagship) {
        other.isFlagship = false;
        storage.saveBot(other);
      }
    }
  }
  bot.isFlagship = makeFlagship;
  bot.updatedAt = Date.now();
  storage.saveBot(bot);
  res.json(publicView(bot, { includeCode: true }));
});

router.delete("/:id", requireAuth, (req, res) => {
  const bot = storage.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: "Bot not found." });
  if (bot.ownerId !== req.userId) return res.status(403).json({ error: "You don't own this bot." });
  storage.deleteBot(bot.botId);
  res.json({ ok: true });
});

module.exports = router;
