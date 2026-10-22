const py = require("../src/bots/runtimes/micropython");
const { createBridge } = require("../src/bots/bridge");
const F = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const state = { fen: F, legalMoves: ["e2e4", "d2d4"], turn: "w", timeRemainingMs: 1000, incrementMs: 0, history: [] };
(async () => {
  const tests = {
    simple: `def choose_move(s):\n    m = chess.get_legal_moves(s["fen"])\n    log("n=", len(m))\n    return m[0]`,
    state: `def choose_move(s):\n    return s["legal_moves"][1]`,
    imp: `import chess\nimport random\nimport math\ndef choose_move(s):\n    return random.choice(s["legal_moves"])`,
    print: `def choose_move(s):\n    print("hello")\n    return s["legal_moves"][0]`,
    js: `import js\ndef choose_move(s):\n    return "e2e4"`,
    evl: `def choose_move(s):\n    return eval("'e2e4'")`,
    badfen: `def choose_move(s):\n    return chess.get_legal_moves("zzz")[0]`,
    nomove: `x = 1`,
    board: `def choose_move(s):\n    b = chess.get_board(s["fen"])\n    log(b[7][0], b[3][0])\n    return s["legal_moves"][0]`,
  };
  for (const [k, c] of Object.entries(tests)) {
    const bridge = createBridge({ seed: 7 });
    const r = await py.run({ code: c, state, bridge });
    console.log(k, JSON.stringify(r), bridge.getLog());
  }
  process.exit(0);
})();
