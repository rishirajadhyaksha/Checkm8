// src/chatDraw.js — PvP chat + draw offers (design: "Game Room Fixes", sections 4/6).
//
// Mixed into GameManager's prototype. Chat state lives in memory while a game
// is live and is written to game.chat once, in _endGame (the JSON storage
// adapter rewrites the whole file on every write, so no per-message saves).

const { storage } = require("./db");
const { serverNow } = require("./clock");

const MAX_TEXT = 200;
const MAX_MESSAGES = 200;
const MIN_PLIES_FOR_DRAW = 4;
const POST_GAME_CHAT_MS = 2 * 60 * 1000;
const MIN_GAP_MS = 700;
const PER_MINUTE = 20;

// control chars, zero-width, bidi overrides/isolates, line/paragraph separators
const STRIP = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2069\\ufeff]", "g");

function cleanText(raw) {
  if (typeof raw !== "string") return "";
  return raw.replace(STRIP, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
}

const methods = {
  _isPvp(game) {
    return !!game && !game.isVsComputer && !game.isVsBot && game.whitePlayerId !== "ENGINE" && game.blackPlayerId !== "BOT";
  },

  _playerColor(game, userId) {
    if (game.whitePlayerId === userId) return "white";
    if (game.blackPlayerId === userId) return "black";
    return null;
  },

  _chatOf(game) {
    if (!this.chats) this.chats = new Map();
    let c = this.chats.get(game.gameId);
    if (!c) {
      const messages = Array.isArray(game.chat) ? game.chat : [];
      c = {
        messages,
        seq: messages.reduce((m, x) => Math.max(m, x.id || 0), 0),
        buckets: new Map(), // userId -> timestamps
        declinedAt: {}, // userId -> own-move count when their offer last ended without a draw
        closesAt: game.chatClosesAt || null,
      };
      this.chats.set(game.gameId, c);
    }
    return c;
  },

  _pendingOffer(c) {
    return c.messages.find((m) => m.kind === "draw_offer" && m.status === "pending") || null;
  },

  _ownMoveCount(game, userId) {
    const n = storage.getMoves(game.gameId).length;
    return this._playerColor(game, userId) === "white" ? Math.ceil(n / 2) : Math.floor(n / 2);
  },

  _pushChat(game, c, entry) {
    c.seq += 1;
    const msg = { id: c.seq, at: serverNow(), ...entry };
    c.messages.push(msg);
    if (c.messages.length > MAX_MESSAGES) {
      const idx = c.messages.findIndex((m) => m.kind === "chat");
      if (idx !== -1) c.messages.splice(idx, 1);
    }
    return msg;
  },

  _emitChat(game, message) {
    this.emit("chat_message", { gameId: game.gameId, players: [game.whitePlayerId, game.blackPlayerId], message });
  },

  _emitChatUpdate(game, message) {
    this.emit("chat_update", { gameId: game.gameId, players: [game.whitePlayerId, game.blackPlayerId], id: message.id, status: message.status });
  },

  _chatGate(gameId, userId) {
    const game = storage.getGame(gameId);
    if (!game) return { error: "Game not found." };
    if (!this._isPvp(game)) return { error: "Chat is only available in player-vs-player games." };
    if (!this._playerColor(game, userId)) return { error: "Only the players can chat." };
    return { game };
  },

  chatSend(gameId, userId, rawText) {
    const g = this._chatGate(gameId, userId);
    if (g.error) return g;
    const { game } = g;
    const c = this._chatOf(game);
    const now = serverNow();
    if (game.status !== "active" && !(c.closesAt && now < c.closesAt)) return { error: "Chat is closed for this game." };
    const text = cleanText(rawText);
    if (!text) return { dropped: true };
    const stamps = (c.buckets.get(userId) || []).filter((t) => now - t < 60_000);
    if (stamps.length && now - stamps[stamps.length - 1] < MIN_GAP_MS) return { error: "You're sending messages too fast." };
    if (stamps.length >= PER_MINUTE) return { error: "Too many messages — wait a moment." };
    stamps.push(now);
    c.buckets.set(userId, stamps);
    const message = this._pushChat(game, c, { kind: "chat", userId, text });
    if (game.status !== "active") {
      game.chat = c.messages;
      storage.saveGame(game);
    }
    this._emitChat(game, message);
    return { message };
  },

  drawOffer(gameId, userId) {
    const g = this._chatGate(gameId, userId);
    if (g.error) return g;
    const { game } = g;
    if (game.status !== "active") return { error: "The game is over." };
    const c = this._chatOf(game);
    const plies = storage.getMoves(gameId).length;
    if (plies < MIN_PLIES_FOR_DRAW) return { error: "Draw offers open after two moves each." };
    const pending = this._pendingOffer(c);
    if (pending) {
      if (pending.userId !== userId) {
        // Crossing offers: offering back is accepting.
        return this.drawRespond(gameId, userId, pending.id, true);
      }
      return { error: "You already have a draw offer open." };
    }
    const last = c.declinedAt[userId];
    if (last !== undefined && this._ownMoveCount(game, userId) <= last) {
      return { error: "Make a move before offering a draw again." };
    }
    const message = this._pushChat(game, c, { kind: "draw_offer", userId, status: "pending", atPly: plies });
    this._emitChat(game, message);
    return { message };
  },

  drawRespond(gameId, userId, offerId, accept) {
    const g = this._chatGate(gameId, userId);
    if (g.error) return g;
    const { game } = g;
    if (game.status !== "active") return { error: "The game is over." };
    const c = this._chatOf(game);
    const offer = this._pendingOffer(c);
    if (!offer || offer.id !== offerId) return { error: "This offer is no longer open." };
    if (offer.userId === userId) return { error: "You can't answer your own offer." };
    if (!accept) {
      offer.status = "declined";
      c.declinedAt[offer.userId] = this._ownMoveCount(game, offer.userId);
      this._emitChatUpdate(game, offer);
      return { update: offer };
    }
    offer.status = "accepted";
    this._emitChatUpdate(game, offer);
    const result = this._endGame(game, "agreement", null);
    return { update: offer, ended: result };
  },

  drawCancel(gameId, userId, offerId) {
    const g = this._chatGate(gameId, userId);
    if (g.error) return g;
    const { game } = g;
    const c = this._chatOf(game);
    const offer = this._pendingOffer(c);
    if (!offer || offer.id !== offerId) return { error: "This offer is no longer open." };
    if (offer.userId !== userId) return { error: "Only the player who offered can cancel." };
    offer.status = "cancelled";
    this._emitChatUpdate(game, offer);
    return { update: offer };
  },

  // Called by applyMove after a legal move: the recipient moving declines.
  _onMoveForDraw(game, moverId) {
    if (!this.chats || !this.chats.has(game.gameId)) return;
    const c = this._chatOf(game);
    const offer = this._pendingOffer(c);
    if (offer && offer.userId !== moverId) {
      offer.status = "expired";
      c.declinedAt[offer.userId] = this._ownMoveCount(game, offer.userId);
      this._emitChatUpdate(game, offer);
    }
  },

  // Called from _endGame before the game is saved.
  _finalizeChat(game, reason) {
    if (!this._isPvp(game)) return;
    const c = this._chatOf(game);
    const offer = this._pendingOffer(c);
    if (offer) {
      offer.status = "expired";
      this._emitChatUpdate(game, offer);
    }
    game.chat = c.messages;
    game.chatClosesAt = serverNow() + POST_GAME_CHAT_MS;
    c.closesAt = game.chatClosesAt;
    const t = setTimeout(() => this.chats && this.chats.delete(game.gameId), POST_GAME_CHAT_MS + 5000);
    if (t.unref) t.unref();
  },

  // Extra fields for GET /games/:id — players of a PvP game only.
  chatStateFor(game, viewerId) {
    if (!this._isPvp(game) || !viewerId || !this._playerColor(game, viewerId)) return {};
    const c = this._chatOf(game);
    const pending = this._pendingOffer(c);
    return { chat: c.messages, drawOffer: pending ? pending.id : null, chatClosesAt: c.closesAt || null };
  },
};

function install(GameManager) {
  Object.assign(GameManager.prototype, methods);
}

module.exports = { install, cleanText, MAX_TEXT };
