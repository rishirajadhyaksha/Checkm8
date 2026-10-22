// Minimal per-user sliding-window rate limiter — enough to satisfy Section
// 10.6 / 12's "rate-limit /queue/join, /games creation, /games/computer"
// requirement without pulling in an external dependency.

function rateLimit({ windowMs = 10_000, max = 8 } = {}) {
  const hits = new Map(); // userId -> [timestamps]
  return (req, res, next) => {
    const key = req.userId || req.ip;
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      return res.status(429).json({ error: "Too many requests — please slow down." });
    }
    arr.push(now);
    hits.set(key, arr);
    next();
  };
}

module.exports = { rateLimit };
