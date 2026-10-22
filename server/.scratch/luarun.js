const lua = require("../src/bots/runtimes/lua");
const { createBridge } = require("../src/bots/bridge");
const F = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const state = { fen: F, legalMoves: ["e2e4", "d2d4"], turn: "w", timeRemainingMs: 1000, incrementMs: 0, history: [] };
(async () => {
  const tests = {
    simple: `function choose_move(s) local m = chess.get_legal_moves(s.fen); log("n=", #m); return m[1] end`,
    state: `function choose_move(s) return s.legal_moves[2] end`,
    board: `function choose_move(s) local b = chess.get_board(s.fen); log(b[8][1].type, b[4][1]); return s.legal_moves[1] end`,
    rand: `function choose_move(s) log(math.random(1,10), random()); return s.legal_moves[1] end`,
    os: `function choose_move(s) return os.getenv("HOME") end`,
    load: `function choose_move(s) return load("return 'e2e4'")() end`,
    badfen: `function choose_move(s) return chess.get_legal_moves("zzz")[1] end`,
    nomove: `x = 1`,
  };
  for (const [k, code] of Object.entries(tests)) {
    const bridge = createBridge({ seed: 7 });
    const r = await lua.run({ code, state, bridge });
    console.log(k, JSON.stringify(r), bridge.getLog());
  }
  process.exit(0);
})();
