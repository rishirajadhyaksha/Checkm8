// src/queueService.js — Section 6.6 (persistent-server mode adapter)
//
// The only environment-specific piece: "get me the current queue as an
// array" + how often findMatch gets called. Serverless mode would instead
// react to DynamoDB Streams; here we poll an in-memory Map every 500ms plus
// immediately after every join, exactly as specified.

const { findMatch } = require("./matchmaking");

class QueueService {
  constructor() {
    /** @type {Map<string, Array<{userId, joinedAt, rating}>>} */
    this.queues = new Map();
    this.onMatch = null; // callback(timeControlKey, playerA, playerB)
  }

  getSnapshot(timeControlKey) {
    return this.queues.get(timeControlKey) || [];
  }

  join(timeControlKey, entry) {
    const arr = this.queues.get(timeControlKey) || [];
    // Avoid duplicate entries for the same user/key
    const filtered = arr.filter((p) => p.userId !== entry.userId);
    filtered.push(entry);
    this.queues.set(timeControlKey, filtered);
    this._checkQueue(timeControlKey);
  }

  leave(timeControlKey, userId) {
    const arr = this.queues.get(timeControlKey) || [];
    this.queues.set(timeControlKey, arr.filter((p) => p.userId !== userId));
  }

  leaveAll(userId) {
    for (const key of this.queues.keys()) {
      this.leave(key, userId);
    }
  }

  _checkQueue(timeControlKey) {
    const snapshot = this.getSnapshot(timeControlKey);
    const now = Date.now();
    for (const player of snapshot) {
      const stillWaiting = this.getSnapshot(timeControlKey).some((p) => p.userId === player.userId);
      if (!stillWaiting) continue;
      const rest = this.getSnapshot(timeControlKey).filter((p) => p.userId !== player.userId);
      const match = findMatch(rest, player, now);
      if (match) {
        // Remove both from the queue atomically (single-process, so this is safe)
        this.queues.set(
          timeControlKey,
          this.getSnapshot(timeControlKey).filter((p) => p.userId !== player.userId && p.userId !== match.userId)
        );
        if (this.onMatch) this.onMatch(timeControlKey, player, match);
        return; // one match per tick is enough; interval will catch the rest
      }
    }
  }

  startPolling(intervalMs = 500) {
    this.interval = setInterval(() => {
      for (const key of this.queues.keys()) this._checkQueue(key);
    }, intervalMs);
  }

  stopPolling() {
    if (this.interval) clearInterval(this.interval);
  }

  countWaiting(timeControlKey) {
    return this.getSnapshot(timeControlKey).length;
  }
}

module.exports = { QueueService };
