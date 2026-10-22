const { TEMPLATES } = require("../src/bots/templates");
const { runBotMove, shutdownPool } = require("../src/bots/runnerPool");
const { compileForSave, runnableOf } = require("../src/bots/languages");
const { checkSource } = require("../src/bots/staticFilter");
const { Chess } = require("chess.js");
const FENS = ["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4", "r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 7"];
(async () => {
  for (const [lang, set] of Object.entries(TEMPLATES)) for (const [name, code] of Object.entries(set)) {
    const f = checkSource(code, lang); if (!f.ok) { console.log(lang, name, "FILTER", f.reason); continue; }
    const c = compileForSave(lang, code); if (!c.ok) { console.log(lang, name, "COMPILE", c.reason); continue; }
    const run = runnableOf({ language: lang, code, compiled: c.compiled });
    for (const fen of FENS) {
      const ch = new Chess(fen);
      const legalMoves = ch.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ""));
      const t = Date.now();
      const r = await runBotMove({ code: run.code, language: run.language, seed: 5, state: { fen, legalMoves, turn: ch.turn(), timeRemainingMs: 60000, incrementMs: 0, history: [] } });
      console.log(lang.padEnd(10), name.padEnd(8), r.ok && legalMoves.includes(r.move) ? "ok " : "BAD", r.ok ? r.move : r.reason, r.libraryCalls, Date.now() - t, "ms");
    }
  }
  shutdownPool(); process.exit(0);
})();
