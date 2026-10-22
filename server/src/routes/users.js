const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const { publicUser } = require("../auth");
const { storage } = require("../db");

const router = express.Router();

router.get("/me", requireAuth, (req, res) => {
  const user = storage.getUser(req.userId);
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json(publicUser(user));
});

router.get("/:id/history", requireAuth, (req, res) => {
  const games = storage.listGamesForUser(req.params.id);
  res.json(
    games.map((g) => ({
      gameId: g.gameId,
      whitePlayerId: g.whitePlayerId,
      blackPlayerId: g.blackPlayerId,
      isVsComputer: g.isVsComputer,
      engineTier: g.engineTier,
      timeControlMinutes: g.timeControlMinutes,
      incrementSeconds: g.incrementSeconds,
      status: g.status,
      result: g.result,
      createdAt: g.createdAt,
    }))
  );
});

module.exports = router;
