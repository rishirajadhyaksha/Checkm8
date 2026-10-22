// Deploy-time smoke test: every language template must run through the real
// runner pool (jailed if BOT_RUNNER_JAIL=1) and return a legal move.
// Usage: node scripts/smoke-runtimes.js   (exit 0 = all good)
require("dotenv").config();
const { Chess } = require("chess.js");
const { TEMPLATES } = require("../src/bots/templates");
const { compileForSave, runnableOf } = require("../src/bots/languages");
const { runBotMove, shutdownPool } = require("../src/bots/runnerPool");
const FEN = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
(async () => {
  let bad = 0;
  const ch = new Chess(FEN);
  const legalMoves = ch.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ""));
  for (const [lang, set] of Object.entries(TEMPLATES)) {
    for (const [name, code] of Object.entries(set)) {
      const c = compileForSave(lang, code);
      const run = runnableOf({ language: lang, code, compiled: c.compiled });
      const r = await runBotMove({ ...run, seed: 1, state: { fen: FEN, legalMoves, turn: "w", timeRemainingMs: 60000, incrementMs: 0, history: [] } });
      const ok = r.ok && legalMoves.includes(r.move);
      if (!ok) bad++;
      console.log(`${ok ? "PASS" : "FAIL"} ${lang}/${name} ${r.ok ? r.move : r.reason}`);
    }
  }
  shutdownPool();
  console.log(bad ? `SMOKE FAILED (${bad})` : "SMOKE OK");
  process.exit(bad ? 1 : 0);
})();
