// src/matchmaking.js — Section 6.6
//
// Pure function, no AWS SDK calls, no setInterval inside it. Used unmodified
// by both deployment modes (here: the persistent-server/localhost mode).
// This is the ONLY place matching fairness logic lives.

function findMatch(queueSnapshot, joiningPlayer, nowMs) {
  const waitMs = nowMs - joiningPlayer.joinedAt;
  const window = Math.min(2000, 100 + Math.floor(waitMs / 5000) * 100); // widens every 5s, capped
  const candidates = queueSnapshot
    .filter((p) => p.userId !== joiningPlayer.userId)
    .filter((p) => Math.abs(p.rating - joiningPlayer.rating) <= window)
    .sort((a, b) => Math.abs(a.rating - joiningPlayer.rating) - Math.abs(b.rating - joiningPlayer.rating));
  return candidates[0] ?? null;
}

module.exports = { findMatch };
