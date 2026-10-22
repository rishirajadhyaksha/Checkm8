const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const { rateLimit } = require("../middleware/rateLimit");
const { storage } = require("../db");
const { queueService } = require("../queueRuntime");

const router = express.Router();

router.post("/join", requireAuth, rateLimit({ windowMs: 10_000, max: 10 }), (req, res) => {
  const { timeControlMinutes, incrementSeconds } = req.body;
  if (!timeControlMinutes || timeControlMinutes < 1 || timeControlMinutes > 60) {
    return res.status(400).json({ error: "timeControlMinutes must be between 1 and 60." });
  }
  const user = storage.getUser(req.userId);
  const timeControlKey = `${timeControlMinutes}+${incrementSeconds || 0}`;
  queueService.join(timeControlKey, {
    userId: req.userId,
    joinedAt: Date.now(),
    rating: user.ratingBlitz,
  });
  res.json({ ok: true, timeControlKey, waiting: queueService.countWaiting(timeControlKey) });
});

router.delete("/leave", requireAuth, (req, res) => {
  const { timeControlMinutes, incrementSeconds } = req.body;
  const timeControlKey = `${timeControlMinutes}+${incrementSeconds || 0}`;
  queueService.leave(timeControlKey, req.userId);
  res.json({ ok: true });
});

module.exports = router;
