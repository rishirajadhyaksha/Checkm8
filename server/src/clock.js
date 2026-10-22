// src/clock.js — Section 7.3
//
// Clocks are always server-computed. Remaining time is derived from a
// wall-clock subtraction at the instant it's needed — never decremented on
// a timer "tick" that could be missed, double-fired, or drift.
//
// Clock-fix changes (Oct 2026):
//  - No clock runs until White has made the first move (`clockStarted`).
//  - A small grace window (FLAG_GRACE_MS) absorbs network jitter before a
//    clock is considered flagged.

const FLAG_GRACE_MS = Number(process.env.FLAG_GRACE_MS || 400);

function serverNow() {
  return Date.now();
}

// Games saved before this change have no `clockStarted` field; treat them as
// already running so nothing in flight changes behaviour.
function isClockRunning(game) {
  return game.clockStarted !== false;
}

/**
 * Applies a move's time cost to the mover's clock and hands the running
 * clock to the other side. Returns { flagged, newRemaining, nextTurnStart }.
 * Throws nothing; caller checks `flagged` to decide whether to reject the
 * move and end the game as a timeout loss instead.
 */
function applyMoveClock(game, movingColor, incrementSeconds) {
  if (game.timeControlMinutes == null) {
    // "No clock" games (Section 10.5) skip clock logic entirely.
    return { flagged: false, newRemaining: null, nextTurnStart: null };
  }
  const now = serverNow();
  const remainingKey = movingColor === "w" ? "whiteTimeMs" : "blackTimeMs";

  if (!isClockRunning(game)) {
    // First move of the game: costs nothing and earns no increment. The
    // opponent's clock starts now.
    return { flagged: false, newRemaining: game[remainingKey], nextTurnStart: now, startsClock: true };
  }

  const elapsed = now - game.turnStartServerTimestamp;
  const newRemaining = game[remainingKey] - elapsed;

  if (newRemaining <= -FLAG_GRACE_MS) {
    return { flagged: true, newRemaining: 0, nextTurnStart: null };
  }

  // Inside the grace window the clock is clamped to 0 before the increment.
  const withIncrement = Math.max(0, newRemaining) + incrementSeconds * 1000;
  return { flagged: false, newRemaining: withIncrement, nextTurnStart: now };
}

/**
 * Read-and-verify check used by the periodic "flag detection" loop
 * (setInterval(1000) in persistent-server mode). Never a source of truth by
 * itself — just recomputes the same math on demand.
 */
function checkFlag(game) {
  if (game.timeControlMinutes == null || game.status !== "active") return { flagged: false };
  if (!isClockRunning(game)) return { flagged: false };
  const now = serverNow();
  const turn = game.turn; // 'w' | 'b'
  const remainingKey = turn === "w" ? "whiteTimeMs" : "blackTimeMs";
  const elapsed = now - game.turnStartServerTimestamp;
  const remaining = game[remainingKey] - elapsed;
  if (remaining <= -FLAG_GRACE_MS) {
    return { flagged: true, loser: turn };
  }
  return { flagged: false };
}

/** Freshly computes both sides' current remaining time for a GET /games/{id} response. */
function computeCurrentTimes(game) {
  if (game.timeControlMinutes == null) {
    return { whiteTimeMs: null, blackTimeMs: null };
  }
  if (game.status !== "active" || !isClockRunning(game)) {
    return { whiteTimeMs: game.whiteTimeMs, blackTimeMs: game.blackTimeMs };
  }
  const now = serverNow();
  const elapsed = now - game.turnStartServerTimestamp;
  if (game.turn === "w") {
    return { whiteTimeMs: Math.max(0, game.whiteTimeMs - elapsed), blackTimeMs: game.blackTimeMs };
  }
  return { whiteTimeMs: game.whiteTimeMs, blackTimeMs: Math.max(0, game.blackTimeMs - elapsed) };
}

module.exports = { serverNow, applyMoveClock, checkFlag, computeCurrentTimes, isClockRunning, FLAG_GRACE_MS };
