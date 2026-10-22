// server/src/routes/leaderboard.js — Bot Arena, Phase 2
//
// bot-arena-design.md's leaderboard product surface: "a ranked list of
// published bots by rating, with games played, win/loss/draw record,
// owner, flagship badge, and last-active time." Calibrating bots are
// deliberately excluded (see db.js's listLeaderboardBots) — a bot isn't
// ranked until its gauntlet actually produces a rating estimate.
//
// Open product decision from the design doc, resolved for this v1: every
// published bot appears here, not just each owner's flagship — flagship
// is shown as a badge, not a filter, since the doc frames it as "one
// flagship plus optional others" rather than "only the flagship is
// public." Worth revisiting later if the list gets crowded with a single
// owner's many bots.

const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const { storage } = require("../db");

const router = express.Router();

router.get("/", requireAuth, (req, res) => {
  const ranked = storage.listLeaderboardBots().map((bot, index) => {
    const owner = storage.getUser(bot.ownerId);
    return {
      rank: index + 1,
      botId: bot.botId,
      name: bot.name,
      ownerUsername: owner ? owner.username : "Unknown",
      isFlagship: bot.isFlagship,
      rating: bot.rating,
      record: bot.record,
      lastActiveAt: bot.lastActiveAt,
      lastCalibratedAt: bot.lastCalibratedAt,
    };
  });
  res.json(ranked);
});

module.exports = router;
