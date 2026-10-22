const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const { rateLimit } = require("../middleware/rateLimit");
const { storage } = require("../db");
const { gameManager, PENDING_TTL_MS } = require("../gameManager");
const { TIER_CONFIG } = require("../engines/tieredEngine");
const { publicGame } = require("../serialize");

const router = express.Router();
const VALID_TIERS = new Set(["easy", "medium", "hard", "expert", "practice"]);

router.get("/pending", requireAuth, (req, res) => {
  const now = Date.now();
  res.json(storage.listPending().map((p) => ({ ...p, expiresAt: p.createdAt + PENDING_TTL_MS, serverNow: now })));
});

router.post("/", requireAuth, rateLimit({ windowMs: 10_000, max: 10 }), (req, res) => {
  const { timeControlMinutes, incrementSeconds } = req.body;
  if (!timeControlMinutes || timeControlMinutes < 1 || timeControlMinutes > 60) {
    return res.status(400).json({ error: "timeControlMinutes must be between 1 and 60." });
  }
  const pending = gameManager.createPendingGame(req.userId, { timeControlMinutes, incrementSeconds: incrementSeconds || 0 });
  res.json(publicGame(pending));
});

router.post("/:id/join", requireAuth, (req, res) => {
  const result = gameManager.joinPendingGame(req.params.id, req.userId);
  if (result.error) return res.status(409).json({ error: result.error });
  res.json(publicGame(result.game));
});

// Section 10.6 — hard-tier moveTimeMs etc. is a server-side constant (TIER_CONFIG),
// never accepted from the client; only the tier NAME is client-supplied here.
router.post("/computer", requireAuth, rateLimit({ windowMs: 10_000, max: 10 }), (req, res) => {
  const { timeControlMinutes, incrementSeconds, engineTier, color } = req.body;
  if (!VALID_TIERS.has(engineTier)) {
    return res.status(400).json({ error: `engineTier must be one of ${[...VALID_TIERS].join(", ")}` });
  }
  if (!["white", "black", "random"].includes(color)) {
    return res.status(400).json({ error: "color must be white, black, or random." });
  }
  // timeControlMinutes may be omitted entirely for "No clock" (Section 10.5).
  if (timeControlMinutes != null && (timeControlMinutes < 1 || timeControlMinutes > 60)) {
    return res.status(400).json({ error: "timeControlMinutes must be between 1 and 60, or omitted for No Clock." });
  }
  const game = gameManager.createComputerGame(req.userId, {
    timeControlMinutes: timeControlMinutes ?? null,
    incrementSeconds: incrementSeconds || 0,
    engineTier,
    color,
  });
  res.json(publicGame(game));
});

// Bot Arena Phase 1 — play against a published, user-submitted bot. See
// bot-arena-design.md and gameManager.createBotGame.
router.post("/vs-bot/:botId", requireAuth, rateLimit({ windowMs: 10_000, max: 10 }), (req, res) => {
  const { timeControlMinutes, incrementSeconds, color } = req.body;
  if (!["white", "black", "random"].includes(color)) {
    return res.status(400).json({ error: "color must be white, black, or random." });
  }
  if (timeControlMinutes != null && (timeControlMinutes < 1 || timeControlMinutes > 60)) {
    return res.status(400).json({ error: "timeControlMinutes must be between 1 and 60, or omitted for No Clock." });
  }
  const result = gameManager.createBotGame(req.userId, req.params.botId, {
    timeControlMinutes: timeControlMinutes ?? null,
    incrementSeconds: incrementSeconds || 0,
    color,
  });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(publicGame(result.game));
});

router.get("/:id", requireAuth, (req, res) => {
  const state = gameManager.getFullState(req.params.id, req.userId);
  if (!state) return res.status(404).json({ error: "Game not found." });
  res.json(state);
});

router.post("/:id/resign", requireAuth, (req, res) => {
  const result = gameManager.resign(req.params.id, req.userId);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

module.exports = router;
