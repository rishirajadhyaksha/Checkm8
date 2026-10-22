// src/gameManager.js
//
// Ties together chess.js (rules), clock.js (Section 7.3), engineService.js
// (Section 10), and the storage adapter (Section 5) into the single
// authoritative move-handling path described in Section 7.2, and the
// game-over checklist in Section 11.

const { Chess } = require("chess.js");
const { v4: uuidv4 } = require("uuid");
const { EventEmitter } = require("events");
const { storage } = require("./db");
const { applyMoveClock, checkFlag, computeCurrentTimes, serverNow, isClockRunning } = require("./clock");
const engineService = require("./engines/engineService");
const botEngineService = require("./bots/botEngineService"); // Bot Arena Phase 1

const RATING_BUCKETS = { bullet: "ratingBullet", blitz: "ratingBlitz", rapid: "ratingRapid" };
const ABANDONMENT_GRACE_MS = 60 * 1000;
const PENDING_TTL_MS = Number(process.env.PENDING_TTL_MS || 10 * 60 * 1000);
const UNSTARTED_ABORT_MS = Number(process.env.UNSTARTED_ABORT_MS || 60 * 1000);
const STALL_THRESHOLD_MS = 1500; // a flag-loop tick this late means the event loop was blocked

const chatDraw = require("./chatDraw");

class GameManager extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, Chess>} live chess.js instances for active games */
    this.liveGames = new Map();
    /** @type {Map<string, NodeJS.Timeout>} abandonment timers keyed by gameId+color */
    this.abandonTimers = new Map();
    this._shiftActiveGamesForRestart();
    this._startFlagLoop();
  }

  // ---------- helpers ----------

  _bucketFor(minutes) {
    if (minutes == null) return null;
    if (minutes < 3) return "bullet";
    if (minutes <= 10) return "blitz";
    return "rapid"; // classical folded into rapid bucket for simplicity in this v2 build
  }

  _getLive(gameId) {
    let chess = this.liveGames.get(gameId);
    if (!chess) {
      const game = storage.getGame(gameId);
      if (!game) return null;
      chess = new Chess();
      if (game.pgn) chess.loadPgn(game.pgn);
      this.liveGames.set(gameId, chess);
    }
    return chess;
  }

  // ---------- game creation ----------

  createGameRecord({ gameId, whitePlayerId, blackPlayerId, timeControlMinutes, incrementSeconds, isVsComputer, engineTier, isVsBot, botId }) {
    gameId = gameId || uuidv4();
    const now = serverNow();
    const startMs = timeControlMinutes != null ? timeControlMinutes * 60 * 1000 : null;
    const game = {
      gameId,
      whitePlayerId,
      blackPlayerId,
      isVsComputer: !!isVsComputer,
      engineTier: engineTier || null,
      isVsBot: !!isVsBot, // Bot Arena Phase 1
      botId: botId || null,
      timeControlMinutes: timeControlMinutes ?? null,
      incrementSeconds: incrementSeconds || 0,
      status: "active",
      fen: new Chess().fen(),
      pgn: "",
      turn: "w",
      whiteTimeMs: startMs,
      blackTimeMs: startMs,
      lastMoveServerTimestamp: now,
      turnStartServerTimestamp: now,
      clockStarted: false, // clock does not run until White makes the first move
      result: null,
      createdAt: now,
    };
    storage.createGame(game);
    this.liveGames.set(gameId, new Chess());
    return game;
  }

  createComputerGame(userId, { timeControlMinutes, incrementSeconds, engineTier, color }) {
    let resolvedColor = color;
    if (resolvedColor === "random") resolvedColor = Math.random() < 0.5 ? "white" : "black";
    const whitePlayerId = resolvedColor === "white" ? userId : "ENGINE";
    const blackPlayerId = resolvedColor === "white" ? "ENGINE" : userId;
    const game = this.createGameRecord({
      whitePlayerId,
      blackPlayerId,
      timeControlMinutes,
      incrementSeconds,
      isVsComputer: true,
      engineTier,
    });

    // If the engine plays White, it must move first.
    if (whitePlayerId === "ENGINE") {
      this._triggerEngineMove(game.gameId);
    }
    return game;
  }

  // Bot Arena Phase 1 — mirrors createComputerGame, but for a user-submitted
  // bot rather than a built-in engine tier. See bot-arena-design.md.
  createBotGame(userId, botId, { timeControlMinutes, incrementSeconds, color }) {
    const bot = storage.getBot(botId);
    if (!bot) return { error: "Bot not found." };
    if (bot.status !== "published") return { error: "This bot is not published." };

    let resolvedColor = color;
    if (resolvedColor === "random") resolvedColor = Math.random() < 0.5 ? "white" : "black";
    const whitePlayerId = resolvedColor === "white" ? userId : "BOT";
    const blackPlayerId = resolvedColor === "white" ? "BOT" : userId;

    const game = this.createGameRecord({
      whitePlayerId,
      blackPlayerId,
      timeControlMinutes,
      incrementSeconds,
      isVsBot: true,
      botId: bot.botId,
    });

    // Snapshot the bot's code (and a content hash of it) onto the game
    // record at creation time, rather than looking the bot up live on every
    // move. This means editing or deleting the bot later can never change
    // what's actually playing in a game that's already underway — the same
    // integrity principle Phase 2's ladder applies with a pinned codeHash
    // per match, just applied here from the first bot-vs-human game on.
    game.botCode = bot.code;
    game.botCodeHash = bot.codeHash;
    game.botLanguage = bot.language || "javascript";
    game.botCompiled = bot.compiled || null;
    game.botName = bot.name;
    storage.saveGame(game);

    if (whitePlayerId === "BOT") {
      this._triggerBotMove(game.gameId);
    }
    return { game };
  }

  createPendingGame(userId, { timeControlMinutes, incrementSeconds }) {
    const gameId = uuidv4();
    const creator = storage.getUser(userId);
    const bucket = RATING_BUCKETS[this._bucketFor(timeControlMinutes)] || "ratingBlitz";
    const pending = {
      gameId,
      creatorId: userId,
      creatorUsername: creator ? creator.username : "Player",
      creatorRating: creator ? creator[bucket] : 1200,
      timeControlMinutes,
      incrementSeconds,
      createdAt: serverNow(),
    };
    storage.createPending(pending);
    this.emit("pending_game_created", pending);
    return pending;
  }

  joinPendingGame(gameId, userId) {
    const pending = storage.listPending().find((p) => p.gameId === gameId);
    if (!pending) return { error: "Game not found or already taken." };
    if (serverNow() - pending.createdAt >= PENDING_TTL_MS) {
      storage.removePending(gameId);
      this.emit("pending_game_removed", { gameId, expired: true });
      return { error: "This game has expired." };
    }
    if (pending.creatorId === userId) return { error: "You can't join your own game." };
    storage.removePending(gameId); // conditional-write equivalent: single process, first caller wins
    this.emit("pending_game_removed", { gameId });

    const creatorFirst = Math.random() < 0.5;
    const whitePlayerId = creatorFirst ? pending.creatorId : userId;
    const blackPlayerId = creatorFirst ? userId : pending.creatorId;
    // Reuse the pending game's id so anyone with the link/id lands on the real game.
    const game = this.createGameRecord({
      gameId,
      whitePlayerId,
      blackPlayerId,
      timeControlMinutes: pending.timeControlMinutes,
      incrementSeconds: pending.incrementSeconds,
      isVsComputer: false,
    });
    // Bug fix: the creator was never told the game had started — only the
    // joiner got the new game back, via the REST response. Emit the same
    // game_found event the queue matchmaker uses so BOTH players (including
    // the original creator, who's just sitting on the Lobby page) get
    // redirected into the new game room.
    this.emit("game_found", { gameId, players: [whitePlayerId, blackPlayerId], game });
    return { game };
  }

  createMatchedGame(playerA, playerB, timeControlMinutes, incrementSeconds) {
    const whiteFirst = Math.random() < 0.5;
    const whitePlayerId = whiteFirst ? playerA.userId : playerB.userId;
    const blackPlayerId = whiteFirst ? playerB.userId : playerA.userId;
    return this.createGameRecord({ whitePlayerId, blackPlayerId, timeControlMinutes, incrementSeconds, isVsComputer: false });
  }

  // ---------- moves ----------

  /**
   * Section 7.2 — server-authoritative move handling, shared by human and
   * (indirectly, via _triggerEngineMove) computer moves.
   */
  applyMove(gameId, userId, { from, to, promotion }) {
    const game = storage.getGame(gameId);
    if (!game) return { error: "Game not found." };
    if (game.status !== "active") return { error: "Game is not active." };

    const movingColor = game.turn;
    const expectedPlayerId = movingColor === "w" ? game.whitePlayerId : game.blackPlayerId;
    if (expectedPlayerId !== userId) return { error: "It is not your turn." };

    const chess = this._getLive(gameId);

    // Clock check happens BEFORE the move is applied, per Section 7.3.
    const clockResult = applyMoveClock(game, movingColor, game.incrementSeconds || 0);
    if (clockResult.flagged) {
      return this._endGame(game, "timeout", movingColor === "w" ? "black" : "white", { flaggedColor: movingColor });
    }

    let moveResult;
    try {
      moveResult = chess.move({ from, to, promotion: promotion || "q" });
    } catch (err) {
      moveResult = null;
    }
    if (!moveResult) {
      // Illegal move: reject, re-sync mover to server FEN. Game state untouched.
      return { rejected: true, reason: "Illegal move.", fen: game.fen };
    }

    // Legal move: commit clock + board state.
    if (game.timeControlMinutes != null) {
      game[movingColor === "w" ? "whiteTimeMs" : "blackTimeMs"] = clockResult.newRemaining;
      game.turnStartServerTimestamp = clockResult.nextTurnStart;
      if (clockResult.startsClock) game.clockStarted = true;
    }
    game.fen = chess.fen();
    game.pgn = chess.pgn();
    game.turn = chess.turn();
    game.lastMoveServerTimestamp = serverNow();

    const moveRecord = {
      moveNumber: storage.getMoves(gameId).length + 1,
      from,
      to,
      san: moveResult.san,
      fenAfter: game.fen,
      playerTimeRemainingMs: game.timeControlMinutes != null ? game[movingColor === "w" ? "whiteTimeMs" : "blackTimeMs"] : null,
      timestamp: game.lastMoveServerTimestamp,
    };
    storage.appendMove(gameId, moveRecord);
    storage.saveGame(game);
    this._onMoveForDraw(game, userId);

    this.emit("move_made", {
      gameId,
      fen: game.fen,
      san: moveResult.san,
      from: moveResult.from,
      to: moveResult.to,
      whiteTimeMs: game.whiteTimeMs,
      blackTimeMs: game.blackTimeMs,
      turn: game.turn,
      turnStartServerTimestamp: game.turnStartServerTimestamp,
      clockStarted: isClockRunning(game),
      serverNow: serverNow(),
    });

    // Section 11 checklist — exhaustive game-over check after EVERY move.
    const overResult = this._checkGameOver(game, chess);
    if (overResult) {
      return this._endGame(game, overResult.reason, overResult.winner);
    }

    // Section 7.2 step 5 — if vs. computer AND it's now the engine's turn to
    // move, immediately request & apply the reply. (Guarding on turn here,
    // not just isVsComputer, avoids emitting a spurious "thinking" event
    // right after the engine's own move, when it's actually the human's turn.)
    const engineColor = game.whitePlayerId === "ENGINE" ? "w" : game.blackPlayerId === "ENGINE" ? "b" : null;
    if (game.isVsComputer && engineColor && game.turn === engineColor) {
      this.emit("engine_thinking", { gameId });
      // Fire and forget; resolves quickly (in-process minimax, Section 10 substitute).
      setImmediate(() => this._triggerEngineMove(gameId));
    }

    // Bot Arena Phase 1 — identical pattern to the engine branch above, just
    // for a user-submitted bot's turn. Reuses the same "engine_thinking"
    // event rather than adding a parallel one: conceptually it's the same
    // "the code-driven opponent is computing its move" signal, and it means
    // GameRoom.jsx needs no new listener to show a thinking indicator here.
    const botColor = game.whitePlayerId === "BOT" ? "w" : game.blackPlayerId === "BOT" ? "b" : null;
    if (game.isVsBot && botColor && game.turn === botColor) {
      this.emit("engine_thinking", { gameId });
      setImmediate(() => this._triggerBotMove(gameId));
    }

    return { ok: true, game };
  }

  async _triggerEngineMove(gameId) {
    const game = storage.getGame(gameId);
    if (!game || game.status !== "active") return;
    const engineColor = game.whitePlayerId === "ENGINE" ? "w" : "b";
    if (game.turn !== engineColor) return;

    const move = await engineService.getMove(game.fen, game.engineTier);
    // The engine's move goes through the IDENTICAL applyMove path as a human's.
    this.applyMove(gameId, "ENGINE", move);
  }

  // Bot Arena Phase 1 — the bot counterpart to _triggerEngineMove above.
  // Unlike the engine path, a failure here is NOT retried or bailed out
  // with a fallback move — see botEngineService.js's header comment. The
  // bot simply forfeits the game.
  async _triggerBotMove(gameId) {
    const game = storage.getGame(gameId);
    if (!game || game.status !== "active") return;
    const botColor = game.whitePlayerId === "BOT" ? "w" : "b";
    if (game.turn !== botColor) return;

    let result;
    try {
      result = await botEngineService.getBotMove(game, botColor);
    } catch (err) {
      // Defensive: getBotMove/runnerPool should never throw (see their own
      // docs), but if something unexpected does escape, treat it as a
      // forfeit rather than letting an unhandled rejection take the server
      // down or leave the game stuck waiting on a move that will never come.
      result = { ok: false, reason: `Unexpected error: ${err && err.message}` };
    }

    if (!result.ok) {
      console.warn(`[gameManager] bot forfeit in game ${gameId} (bot ${game.botId}): ${result.reason}`);
      this._endGame(game, "bot_error", botColor === "w" ? "black" : "white");
      return;
    }

    // The bot's move goes through the IDENTICAL applyMove path as a human's
    // or the built-in engine's.
    this.applyMove(gameId, "BOT", { from: result.from, to: result.to, promotion: result.promotion });
  }

  _checkGameOver(game, chess) {
    if (chess.isCheckmate()) {
      const winner = chess.turn() === "w" ? "black" : "white"; // side to move is checkmated
      return { reason: "checkmate", winner };
    }
    if (chess.isStalemate()) return { reason: "stalemate", winner: null };
    if (chess.isThreefoldRepetition()) return { reason: "threefold_repetition", winner: null };
    if (chess.isDraw()) {
      // Covers 50-move rule and insufficient material via chess.js internals.
      return { reason: "draw", winner: null };
    }
    return null;
  }

  resign(gameId, userId) {
    const game = storage.getGame(gameId);
    if (!game || game.status !== "active") return { error: "Game is not active." };
    const resignerColor = game.whitePlayerId === userId ? "white" : game.blackPlayerId === userId ? "black" : null;
    if (!resignerColor) return { error: "You are not a player in this game." };
    const winner = resignerColor === "white" ? "black" : "white";
    return this._endGame(game, "resignation", winner);
  }

  _endGame(game, reason, winner, opts = {}) {
    // Freeze the true final clock values so every client (and a later reload)
    // shows what the server actually had, not the last banked value.
    if (game.timeControlMinutes != null) {
      const times = computeCurrentTimes(game);
      game.whiteTimeMs = times.whiteTimeMs;
      game.blackTimeMs = times.blackTimeMs;
      if (reason === "timeout") {
        const flagged = opts.flaggedColor || (winner === "white" ? "b" : "w");
        game[flagged === "w" ? "whiteTimeMs" : "blackTimeMs"] = 0;
      }
    }
    game.status = "finished";
    game.result = { reason, winner };
    this._finalizeChat(game, reason);
    storage.saveGame(game);
    this._clearAbandonTimer(game.gameId, "white");
    this._clearAbandonTimer(game.gameId, "black");
    this.liveGames.delete(game.gameId);

    let ratingChanges = null;
    // Bot Arena Phase 1 — bot games are unrated for the human too, same as
    // computer games (there's no bot rating system yet; that's Phase 2's
    // ladder). Revisit once Phase 2 ships if human-vs-bot should ever
    // affect the human's own rating (bot-arena-design.md leans no).
    if (!game.isVsComputer && !game.isVsBot && reason !== "aborted") {
      ratingChanges = this._updateRatings(game, winner);
    }

    this.emit("game_over", {
      gameId: game.gameId,
      result: reason,
      winner,
      ratingChanges,
      whiteTimeMs: game.whiteTimeMs,
      blackTimeMs: game.blackTimeMs,
      serverNow: serverNow(),
    });
    return { ok: true, ended: true, reason, winner, ratingChanges };
  }

  _updateRatings(game, winner) {
    // Appendix A — simplified Elo. Skipped entirely for isVsComputer (Section 11).
    const bucket = RATING_BUCKETS[this._bucketFor(game.timeControlMinutes)] || "ratingBlitz";
    const white = storage.getUser(game.whitePlayerId);
    const black = storage.getUser(game.blackPlayerId);
    if (!white || !black) return null;
    const scoreWhite = winner === "white" ? 1 : winner === "black" ? 0 : 0.5;
    const scoreBlack = 1 - scoreWhite;
    const K = 32;
    const expWhite = 1 / (1 + Math.pow(10, (black[bucket] - white[bucket]) / 400));
    const expBlack = 1 - expWhite;
    const whiteBefore = white[bucket];
    const blackBefore = black[bucket];
    const whiteAfter = Math.round(whiteBefore + K * (scoreWhite - expWhite));
    const blackAfter = Math.round(blackBefore + K * (scoreBlack - expBlack));
    storage.updateUserRating(white.userId, bucket, whiteAfter);
    storage.updateUserRating(black.userId, bucket, blackAfter);
    return {
      [white.userId]: { before: whiteBefore, after: whiteAfter },
      [black.userId]: { before: blackBefore, after: blackAfter },
    };
  }

  // ---------- rematch ----------

  createRematchGame(oldGameId) {
    const oldGame = storage.getGame(oldGameId);
    if (!oldGame) return { error: "Original game not found." };
    if (oldGame.isVsComputer) return { error: "Computer rematches don't need this — just start a new computer game directly." };
    // Swap colors from the previous game so it's fair over a rematch series.
    const game = this.createGameRecord({
      whitePlayerId: oldGame.blackPlayerId,
      blackPlayerId: oldGame.whitePlayerId,
      timeControlMinutes: oldGame.timeControlMinutes,
      incrementSeconds: oldGame.incrementSeconds,
      isVsComputer: false,
    });
    return { game };
  }

  // ---------- reconnect / resync (Section 7.6) ----------

  getFullState(gameId, viewerId) {
    const game = storage.getGame(gameId);
    if (!game) return null;
    const times = computeCurrentTimes(game);
    const bucket = RATING_BUCKETS[this._bucketFor(game.timeControlMinutes)] || "ratingBlitz";
    const describe = (playerId) => {
      if (playerId === "ENGINE") return { userId: "ENGINE", username: null, rating: null };
      if (playerId === "BOT") return { userId: "BOT", username: game.botName || "Bot", rating: null };
      const u = storage.getUser(playerId);
      return { userId: playerId, username: u ? u.username : "Player", rating: u ? u[bucket] : null };
    };
    return {
      gameId: game.gameId,
      fen: game.fen,
      pgn: game.pgn,
      status: game.status,
      turn: game.turn,
      whitePlayerId: game.whitePlayerId,
      blackPlayerId: game.blackPlayerId,
      whitePlayer: describe(game.whitePlayerId),
      blackPlayer: describe(game.blackPlayerId),
      isVsComputer: game.isVsComputer,
      engineTier: game.engineTier,
      isVsBot: game.isVsBot, // Bot Arena Phase 1
      botId: game.botId,
      botName: game.botName,
      timeControlMinutes: game.timeControlMinutes,
      incrementSeconds: game.incrementSeconds,
      whiteTimeMs: times.whiteTimeMs,
      blackTimeMs: times.blackTimeMs,
      // Deadline-style clock data: banked times as of turnStartServerTimestamp.
      bankedWhiteTimeMs: game.whiteTimeMs,
      bankedBlackTimeMs: game.blackTimeMs,
      turnStartServerTimestamp: game.turnStartServerTimestamp,
      clockStarted: isClockRunning(game),
      serverNow: serverNow(),
      result: game.result,
      moves: storage.getMoves(gameId),
      ...this.chatStateFor(game, viewerId),
    };
  }

  // ---------- abandonment (Section 7.5) ----------

  markDisconnected(gameId, userId) {
    const game = storage.getGame(gameId);
    if (!game || game.status !== "active") return;
    const color = game.whitePlayerId === userId ? "white" : game.blackPlayerId === userId ? "black" : null;
    if (!color) return;
    const key = `${gameId}:${color}`;
    if (this.abandonTimers.has(key)) return;
    const timer = setTimeout(() => {
      const g = storage.getGame(gameId);
      if (g && g.status === "active") {
        const winner = color === "white" ? "black" : "white";
        this._endGame(g, "abandonment", winner);
      }
      this.abandonTimers.delete(key);
    }, ABANDONMENT_GRACE_MS);
    this.abandonTimers.set(key, timer);
  }

  markReconnected(gameId, userId) {
    const game = storage.getGame(gameId);
    if (!game) return;
    const color = game.whitePlayerId === userId ? "white" : game.blackPlayerId === userId ? "black" : null;
    if (color) this._clearAbandonTimer(gameId, color);
  }

  _clearAbandonTimer(gameId, color) {
    const key = `${gameId}:${color}`;
    const timer = this.abandonTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.abandonTimers.delete(key);
    }
  }

  // ---------- flag detection loop (Section 7.3) ----------

  _startFlagLoop() {
    this.lastTickAt = serverNow();
    this.flagInterval = setInterval(() => {
      const now = serverNow();
      const lateBy = now - this.lastTickAt - 1000;
      this.lastTickAt = now;
      // If this tick ran much later than scheduled, the event loop was blocked
      // (e.g. the synchronous minimax fallback). Don't charge players for a
      // server-side stall: push every running clock's turn start forward.
      if (lateBy > STALL_THRESHOLD_MS) {
        console.warn(`[gameManager] event loop stalled ~${lateBy}ms; shifting active clocks forward`);
        for (const gameId of this.liveGames.keys()) {
          const g = storage.getGame(gameId);
          if (g && g.status === "active" && g.timeControlMinutes != null && isClockRunning(g)) {
            g.turnStartServerTimestamp += lateBy;
            storage.saveGame(g);
          }
        }
      }
      for (const gameId of this.liveGames.keys()) {
        const game = storage.getGame(gameId);
        if (!game || game.status !== "active") continue;
        if (!game.pgn && now - game.createdAt >= UNSTARTED_ABORT_MS) {
          // Nobody made a first move within the window: abort, unrated.
          this._endGame(game, "aborted", null);
          continue;
        }
        const { flagged, loser } = checkFlag(game);
        if (flagged) {
          const winner = loser === "w" ? "black" : "white";
          this._endGame(game, "timeout", winner, { flaggedColor: loser });
        }
      }
      this._sweepExpiredPending(now);
    }, 1000);
  }

  // Pending (open) games that nobody joined within PENDING_TTL_MS go away.
  _sweepExpiredPending(now = serverNow()) {
    let list;
    try {
      list = storage.listPending();
    } catch (err) {
      return;
    }
    for (const p of list) {
      if (now - p.createdAt >= PENDING_TTL_MS) {
        storage.removePending(p.gameId);
        this.emit("pending_game_removed", { gameId: p.gameId, expired: true });
      }
    }
  }

  // On startup, downtime must not be charged to anyone: restart every running
  // clock from "now". Banked time is unchanged.
  _shiftActiveGamesForRestart() {
    try {
      const now = serverNow();
      for (const g of storage.listActiveGames ? storage.listActiveGames() : []) {
        if (g.timeControlMinutes != null && isClockRunning(g)) {
          g.turnStartServerTimestamp = now;
          storage.saveGame(g);
        }
        // Re-register so the flag loop watches games that survived the restart.
        if (g.status === "active") this._getLive(g.gameId);
      }
      this._sweepExpiredPending(now);
    } catch (err) {
      console.warn("[gameManager] startup clock shift skipped:", err.message);
    }
  }

  stop() {
    clearInterval(this.flagInterval);
  }
}

const gameManager = new GameManager();
chatDraw.install(GameManager);

module.exports = { gameManager, RATING_BUCKETS , PENDING_TTL_MS };
