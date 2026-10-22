const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");

process.env.DATA_FILE = path.join(os.tmpdir(), `c8-abort-${Date.now()}.json`);
process.env.UNSTARTED_ABORT_MS = "1200";
const { gameManager } = require("../src/gameManager");
const { storage } = require("../src/db");
const { publicGame } = require("../src/serialize");

test("unstarted game is aborted unrated", async () => {
  const g = gameManager.createGameRecord({ whitePlayerId: "a", blackPlayerId: "b", timeControlMinutes: 5, incrementSeconds: 0 });
  let over = null;
  gameManager.once("game_over", (p) => (over = p));
  await new Promise((r) => setTimeout(r, 3300));
  assert.ok(over, "game_over emitted");
  assert.strictEqual(over.result, "aborted");
  assert.strictEqual(over.ratingChanges, null);
  assert.strictEqual(storage.getGame(g.gameId).status, "finished");
});

test("publicGame strips bot source", () => {
  const out = publicGame({ gameId: "x", botCode: "secret", botCodeHash: "h", seed: 1, fen: "f" });
  assert.deepStrictEqual(out, { gameId: "x", fen: "f" });
});
