const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");

process.env.DATA_FILE = path.join(os.tmpdir(), `c8-chat-${Date.now()}.json`);
const { gameManager } = require("../src/gameManager");
const { storage } = require("../src/db");
const { cleanText } = require("../src/chatDraw");

function newGame(opts = {}) {
  return gameManager.createGameRecord({ whitePlayerId: "w1", blackPlayerId: "b1", timeControlMinutes: 10, incrementSeconds: 0, ...opts });
}
function play(g, moves, white = true) {
  for (const [from, to] of moves) {
    const r = gameManager.applyMove(g.gameId, white ? "w1" : "b1", { from, to });
    assert.ok(!r.error && !r.rejected, `move ${from}${to}: ${JSON.stringify(r)}`);
    white = !white;
  }
}
const FOUR = [["e2", "e4"], ["e7", "e5"], ["g1", "f3"], ["b8", "c6"]];
function resetRate(g) {
  const c = gameManager.chats.get(g.gameId);
  if (c) c.buckets.clear();
}
function events(names) {
  const log = [];
  for (const n of names) gameManager.on(n, (p) => log.push([n, p]));
  return log;
}

test("cleanText strips control/bidi chars, collapses whitespace, caps length", () => {
  assert.strictEqual(cleanText("  hi\u0000‮   there \n now "), "hi there now");
  assert.strictEqual(cleanText("x".repeat(500)).length, 200);
  assert.strictEqual(cleanText(42), "");
  assert.strictEqual(cleanText("​​"), "");
});

test("chat: players only, PvP only", () => {
  const g = newGame();
  assert.ok(gameManager.chatSend(g.gameId, "w1", "hello").message);
  assert.match(gameManager.chatSend(g.gameId, "spectator", "hi").error, /Only the players/);
  const cpu = newGame({ blackPlayerId: "ENGINE", isVsComputer: true });
  assert.match(gameManager.chatSend(cpu.gameId, "w1", "hi").error, /player-vs-player/);
  const bot = newGame({ blackPlayerId: "BOT", isVsBot: true, botId: "x" });
  assert.match(gameManager.chatSend(bot.gameId, "w1", "hi").error, /player-vs-player/);
  assert.match(gameManager.chatSend("nope", "w1", "hi").error, /not found/);
});

test("chat: empty after cleaning is dropped, rate limits trip", () => {
  const g = newGame();
  assert.ok(gameManager.chatSend(g.gameId, "w1", "​ ").dropped);
  assert.ok(gameManager.chatSend(g.gameId, "w1", "one").message);
  assert.match(gameManager.chatSend(g.gameId, "w1", "two").error, /too fast/);
  // per-minute cap: 20 spaced messages ok, 21st refused
  const c = gameManager.chats.get(g.gameId);
  c.buckets.set("w1", Array.from({ length: 20 }, (_, i) => Date.now() - 50_000 + i * 100));
  assert.match(gameManager.chatSend(g.gameId, "w1", "three").error, /Too many/);
  // other player is independent
  assert.ok(gameManager.chatSend(g.gameId, "b1", "hey").message);
});

test("chat: 200-entry cap keeps draw offers", () => {
  const g = newGame();
  play(g, FOUR);
  assert.ok(gameManager.drawOffer(g.gameId, "w1").message);
  for (let i = 0; i < 230; i++) {
    resetRate(g);
    gameManager.chatSend(g.gameId, "b1", "m" + i);
  }
  const state = gameManager.chatStateFor(storage.getGame(g.gameId), "w1");
  assert.ok(state.chat.length <= 200);
  assert.ok(state.chat.some((m) => m.kind === "draw_offer"));
});

test("draw: not before 4 plies", () => {
  const g = newGame();
  play(g, FOUR.slice(0, 3));
  assert.match(gameManager.drawOffer(g.gameId, "b1").error, /after two moves each/);
});

test("draw: offer -> accept ends as agreement, rated draw", () => {
  storage.state.users.w1 = { userId: "w1", username: "w1", ratingBlitz: 1200, ratingRapid: 1200, ratingBullet: 1200 };
  storage.state.users.b1 = { userId: "b1", username: "b1", ratingBlitz: 1400, ratingRapid: 1400, ratingBullet: 1400 };
  const g = newGame();
  play(g, FOUR);
  const log = events(["chat_message", "chat_update", "game_over"]);
  const offer = gameManager.drawOffer(g.gameId, "w1").message;
  assert.strictEqual(offer.status, "pending");
  assert.match(gameManager.drawOffer(g.gameId, "w1").error, /already have/);
  assert.match(gameManager.drawRespond(g.gameId, "w1", offer.id, true).error, /own offer/);
  assert.match(gameManager.drawRespond(g.gameId, "b1", 999, true).error, /no longer open/);
  const r = gameManager.drawRespond(g.gameId, "b1", offer.id, true);
  assert.strictEqual(r.ended.reason, "agreement");
  const done = storage.getGame(g.gameId);
  assert.strictEqual(done.status, "finished");
  assert.strictEqual(done.result.winner, null);
  // lower-rated white gains from a draw vs higher-rated black
  const over = log.find(([n, p]) => n === "game_over" && p.gameId === g.gameId)[1];
  assert.ok(over.ratingChanges.w1.after > 1200);
  assert.ok(log.some(([n, p]) => n === "chat_update" && p.id === offer.id && p.status === "accepted"));
  assert.ok(Array.isArray(done.chat) && done.chat.some((m) => m.kind === "draw_offer" && m.status === "accepted"));
  // stale card after the game ended
  assert.match(gameManager.drawRespond(g.gameId, "b1", offer.id, true).error, /over/);
});

test("draw: decline cooldown until the offerer moves again", () => {
  const g = newGame();
  play(g, FOUR);
  const o = gameManager.drawOffer(g.gameId, "w1").message;
  assert.strictEqual(gameManager.drawRespond(g.gameId, "b1", o.id, false).update.status, "declined");
  assert.match(gameManager.drawOffer(g.gameId, "w1").error, /Make a move/);
  play(g, [["d2", "d3"]]); // white moves
  assert.ok(gameManager.drawOffer(g.gameId, "w1").message);
});

test("draw: cancel only by offerer; recipient move expires the offer", () => {
  const g = newGame();
  play(g, FOUR);
  const o = gameManager.drawOffer(g.gameId, "w1").message;
  assert.match(gameManager.drawCancel(g.gameId, "b1", o.id).error, /Only the player who offered/);
  assert.strictEqual(gameManager.drawCancel(g.gameId, "w1", o.id).update.status, "cancelled");
  assert.match(gameManager.drawCancel(g.gameId, "w1", o.id).error, /no longer open/);
  const o2 = gameManager.drawOffer(g.gameId, "w1").message;
  play(g, [["d2", "d3"]]); // white (the offerer) moves: offer stays
  assert.strictEqual(gameManager._pendingOffer(gameManager.chats.get(g.gameId)).id, o2.id);
  play(g, [["d7", "d6"]], false); // black (recipient) moves: expires
  assert.strictEqual(gameManager._pendingOffer(gameManager.chats.get(g.gameId)), null);
  assert.strictEqual(gameManager.chats.get(g.gameId).messages.find((m) => m.id === o2.id).status, "expired");
});

test("draw: crossing offers end the game", () => {
  const g = newGame();
  play(g, FOUR);
  gameManager.drawOffer(g.gameId, "w1");
  const r = gameManager.drawOffer(g.gameId, "b1");
  assert.strictEqual(r.ended.reason, "agreement");
});

test("draw: resignation expires a pending offer", () => {
  const g = newGame();
  play(g, FOUR);
  const o = gameManager.drawOffer(g.gameId, "w1").message;
  gameManager.resign(g.gameId, "w1");
  const msgs = storage.getGame(g.gameId).chat;
  assert.strictEqual(msgs.find((m) => m.id === o.id).status, "expired");
});

test("draw: computer/bot games refuse offers", () => {
  const cpu = newGame({ blackPlayerId: "ENGINE", isVsComputer: true });
  assert.match(gameManager.drawOffer(cpu.gameId, "w1").error, /player-vs-player/);
});

test("getFullState: chat only for players", () => {
  const g = newGame();
  gameManager.chatSend(g.gameId, "w1", "gg");
  assert.ok(gameManager.getFullState(g.gameId, "w1").chat.length === 1);
  assert.ok(gameManager.getFullState(g.gameId, "b1").chat.length === 1);
  const spec = gameManager.getFullState(g.gameId, "someone");
  assert.strictEqual(spec.chat, undefined);
  assert.strictEqual(spec.drawOffer, undefined);
  assert.strictEqual(gameManager.getFullState(g.gameId).chat, undefined);
});

test("chat: stays open ~2 minutes after the game, then closes", () => {
  const g = newGame();
  gameManager.resign(g.gameId, "w1");
  resetRate(g);
  assert.ok(gameManager.chatSend(g.gameId, "b1", "gg").message);
  const stored = storage.getGame(g.gameId);
  assert.ok(stored.chat.some((m) => m.text === "gg"));
  stored.chatClosesAt = Date.now() - 1;
  gameManager.chats.get(g.gameId).closesAt = stored.chatClosesAt;
  resetRate(g);
  assert.match(gameManager.chatSend(g.gameId, "b1", "late").error, /closed/);
});

test.after(() => setTimeout(() => process.exit(0), 50));
