// src/db.js
//
// StorageAdapter (Section 5 / Appendix B).
//
// The design doc specifies DynamoDB in the cloud and "DynamoDB Local / SQLite"
// for offline development, both hidden behind one StorageAdapter interface so
// game logic never touches a specific database's SDK directly.
//
// SUBSTITUTION NOTE: this implementation backs the same interface with a
// dependency-free JSON file (loaded into memory, flushed on write) instead of
// SQLite, to avoid requiring native build tooling (python/make/gcc) inside
// this environment. Swapping in real SQLite or DynamoDB later only means
// rewriting this one file — nothing above it changes, which is exactly the
// guarantee the doc's StorageAdapter interface is meant to provide.

const fs = require("fs");
const path = require("path");

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "..", "data", "checkm8-db.json");

function emptyState() {
  return {
    users: {}, // userId -> { userId, username, passwordHash, email, ratingBlitz, ratingRapid, ratingBullet, ratingBullet, createdAt }
    usernameIndex: {}, // username -> userId
    games: {}, // gameId -> META
    moves: {}, // gameId -> [MOVE#n, ...]
    pending: {}, // gameId -> PENDING meta
    connections: {}, // userId -> { socketId, lastSeenAt }
    bots: {}, // botId -> { ... } — Bot Arena Phase 1 + 2, see the comment above listBotsForUser below
    botMatches: {}, // matchId -> { matchId, matchType, participants, openingId, seed, result, pgn, ... } — Bot Arena Phase 2
  };
}

// Bots created before Phase 2 (rating/record/calibration fields) are
// backfilled in place on load so nothing downstream has to defensively
// check for their absence — same "migrate the state shape, not every call
// site" approach as the rest of this file.
function backfillBotFields(bot) {
  if (bot.rating === undefined) bot.rating = null; // null until first published (draft bots are never rated)
  if (bot.record === undefined) bot.record = { wins: 0, losses: 0, draws: 0 };
  if (bot.calibratedCodeHash === undefined) bot.calibratedCodeHash = null;
  if (bot.gamesPlayedSinceCalibration === undefined) bot.gamesPlayedSinceCalibration = 0;
  if (bot.lastCalibratedAt === undefined) bot.lastCalibratedAt = null;
  if (bot.lastActiveAt === undefined) bot.lastActiveAt = null;
  if (!bot.language) bot.language = "javascript"; // Round 2: multi-language bots
  if (bot.compiled === undefined) bot.compiled = null;
  return bot;
}

class JsonStorageAdapter {
  constructor(file) {
    this.file = file;
    this._load();
  }

  _load() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      if (fs.existsSync(this.file)) {
        this.state = JSON.parse(fs.readFileSync(this.file, "utf8"));
        if (!this.state.bots) this.state.bots = {}; // legacy data files predate Bot Arena and lack this key entirely
        if (!this.state.botMatches) this.state.botMatches = {};
        for (const bot of Object.values(this.state.bots)) backfillBotFields(bot);
      } else {
        this.state = emptyState();
        this._flush();
      }
    } catch (err) {
      console.error("[db] failed to load, starting fresh:", err.message);
      this.state = emptyState();
    }
  }

  _flush() {
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }

  // ---- Users ----
  createUser(user) {
    this.state.users[user.userId] = user;
    this.state.usernameIndex[user.username.toLowerCase()] = user.userId;
    this._flush();
    return user;
  }

  getUser(userId) {
    return this.state.users[userId] || null;
  }

  getUserByUsername(username) {
    const id = this.state.usernameIndex[username.toLowerCase()];
    return id ? this.state.users[id] : null;
  }

  updateUserRating(userId, bucket, newRating) {
    const u = this.state.users[userId];
    if (!u) return;
    u[bucket] = newRating;
    this._flush();
  }

  // ---- Games ----
  createGame(game) {
    this.state.games[game.gameId] = game;
    this.state.moves[game.gameId] = [];
    this._flush();
    return game;
  }

  getGame(gameId) {
    return this.state.games[gameId] || null;
  }

  saveGame(game) {
    this.state.games[game.gameId] = game;
    this._flush();
    return game;
  }

  appendMove(gameId, move) {
    if (!this.state.moves[gameId]) this.state.moves[gameId] = [];
    this.state.moves[gameId].push(move);
    this._flush();
  }

  getMoves(gameId) {
    return this.state.moves[gameId] || [];
  }

  // ---- Pending games list (GSI1 equivalent: filter by status) ----
  createPending(pending) {
    this.state.pending[pending.gameId] = pending;
    this._flush();
  }

  removePending(gameId) {
    delete this.state.pending[gameId];
    this._flush();
  }

  listPending() {
    return Object.values(this.state.pending).sort((a, b) => b.createdAt - a.createdAt);
  }

  // ---- Connections ----
  setConnection(userId, socketId) {
    this.state.connections[userId] = { socketId, lastSeenAt: Date.now() };
    this._flush();
  }

  removeConnection(userId) {
    delete this.state.connections[userId];
    this._flush();
  }

  getConnection(userId) {
    return this.state.connections[userId] || null;
  }

  // ---- Bots (Bot Arena Phase 1, bot-arena-design.md) ----
  createBot(bot) {
    this.state.bots[bot.botId] = bot;
    this._flush();
    return bot;
  }

  getBot(botId) {
    return this.state.bots[botId] || null;
  }

  saveBot(bot) {
    this.state.bots[bot.botId] = bot;
    this._flush();
    return bot;
  }

  deleteBot(botId) {
    delete this.state.bots[botId];
    this._flush();
  }

  listBotsForUser(userId) {
    return Object.values(this.state.bots)
      .filter((b) => b.ownerId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  listPublishedBots() {
    return Object.values(this.state.bots)
      .filter((b) => b.status === "published")
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // ---- Bot Arena Phase 2: ladder, calibration, leaderboard ----

  // Every bot currently mid-gauntlet — either freshly published or reset
  // by a code edit on a previously-published bot. The ladder scheduler
  // treats this as its highest-priority queue.
  listCalibratingBots() {
    return Object.values(this.state.bots)
      .filter((b) => b.status === "calibrating")
      .sort((a, b) => a.updatedAt - b.updatedAt); // oldest-waiting first
  }

  // Ranked leaderboard: published bots only (calibrating bots are
  // deliberately excluded — see bot-arena-design.md's ladder execution
  // flow), sorted by rating value descending.
  listLeaderboardBots() {
    return Object.values(this.state.bots)
      .filter((b) => b.status === "published" && b.rating)
      .sort((a, b) => b.rating.value - a.rating.value);
  }

  createBotMatch(match) {
    this.state.botMatches[match.matchId] = match;
    this._flush();
    return match;
  }

  getBotMatch(matchId) {
    return this.state.botMatches[matchId] || null;
  }

  // Most-recent-first match history for one bot's profile page.
  listMatchesForBot(botId, limit = 20) {
    return Object.values(this.state.botMatches)
      .filter((m) => m.participants.some((p) => p.botId === botId))
      .sort((a, b) => b.finishedAt - a.finishedAt)
      .slice(0, limit);
  }

  // ---- Active games (used on startup to re-register live clocks) ----
  listActiveGames() {
    return Object.values(this.state.games).filter((g) => g.status === "active");
  }

  // ---- History ----
  listGamesForUser(userId) {
    return Object.values(this.state.games)
      .filter((g) => g.whitePlayerId === userId || g.blackPlayerId === userId)
      .sort((a, b) => (b.lastMoveServerTimestamp || 0) - (a.lastMoveServerTimestamp || 0));
  }
}

const storage = new JsonStorageAdapter(DATA_FILE);

module.exports = { storage };
