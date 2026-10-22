// Round 2 — chess library, bridge limits, and the per-language escape-attempt
// corpus. Every break-out attempt must end in a clean forfeit (ok:false) and
// leave the runner pool healthy and usable afterwards.
process.env.DATA_FILE = require("path").join(require("os").tmpdir(), `c8-lang-${Date.now()}.json`);
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Chess } = require("chess.js");
const { createLibrary } = require("../src/bots/library");
const { createBridge } = require("../src/bots/bridge");
const { buildSpec } = require("../src/bots/librarySpec");
const { runBotMove, shutdownPool } = require("../src/bots/runnerPool");
const { checkSource } = require("../src/bots/staticFilter");
const { compileForSave, runnableOf } = require("../src/bots/languages");
const { TEMPLATES } = require("../src/bots/templates");
const { scrubText } = require("../src/bots/scrub");
const killSwitch = require("../src/bots/killSwitch");

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const FENS = [
  START,
  "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4", // Qxf7 mate available
  "8/P7/8/8/8/8/k6K/8 w - - 0 1", // promotion
  "rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3", // en passant
  "k7/8/8/8/8/8/5q2/7K w - - 0 1", // stalemate-ish / check variants
  "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", // stalemate
];
const uci = (m) => `${m.from}${m.to}${m.promotion || ""}`;

test("library: 24 methods, matches chess.js on a fixed set of FENs", () => {
  const spec = buildSpec();
  assert.equal(spec.methods.length, 24);
  const lib = createLibrary();
  for (const fen of FENS) {
    const c = new Chess(fen);
    const moves = c.moves({ verbose: true });
    assert.deepEqual(lib.getLegalMoves(fen), moves.map(uci));
    assert.equal(lib.getTurn(fen), c.turn());
    assert.equal(lib.isCheck(fen), c.isCheck());
    assert.equal(lib.isCheckmate(fen), c.isCheckmate());
    assert.equal(lib.isStalemate(fen), c.isStalemate());
    assert.equal(lib.isGameOver(fen), c.isGameOver());
    assert.deepEqual(lib.getCaptureMoves(fen), moves.filter((m) => m.captured).map(uci));
    for (const m of moves) {
      const copy = new Chess(fen);
      copy.move(m);
      assert.equal(lib.makeMove(fen, uci(m)), copy.fen());
      assert.equal(lib.isLegal(fen, uci(m)), true);
      assert.equal(lib.toSan(fen, uci(m)), m.san);
      assert.equal(lib.givesCheck(fen, uci(m)), copy.isCheck());
      assert.equal(lib.isPromotion(fen, uci(m)), !!m.promotion);
      assert.equal(lib.isCapture(fen, uci(m)), m.flags.includes("c") || m.flags.includes("e"));
    }
    assert.equal(lib.makeMove(fen, "a1a1"), null);
    assert.equal(lib.isLegal(fen, "h1h8"), false);
    const board = lib.getBoard(fen);
    assert.equal(board.length, 8);
    assert.equal(board[0].length, 8);
    assert.deepEqual(lib.getKingSquare(fen, "w"), c.board().flat().find((p) => p && p.type === "k" && p.color === "w").square);
  }
  assert.deepEqual(lib.getMaterial(START), { w: 39, b: 39 });
  assert.equal(lib.pieceValue("q"), 9);
  assert.deepEqual(lib.getPiece(START, "e1"), { type: "k", color: "w" });
  assert.equal(lib.getPiece(START, "e4"), null);
  assert.equal(lib.getPieces(START, "w").length, 16);
  assert.equal(lib.isSquareAttacked(START, "e3", "w"), true);
  assert.equal(lib.isSquareAttacked(START, "e5", "w"), false);
  assert.deepEqual(lib.getAttackers(START, "f3", "w").sort(), ["e2", "g1", "g2"]);
  assert.equal(lib.hashPosition(START), lib.hashPosition(START));
  assert.notEqual(lib.hashPosition(START), lib.hashPosition(FENS[1]));
});

test("bridge: validation, unknown ops, malformed FEN, and the call cap", () => {
  const b = createBridge({ seed: 1, maxCalls: 5 });
  const call = (op, args) => JSON.parse(b.handle(JSON.stringify({ op, args })));
  assert.equal(call("getLegalMoves", [START]).ok, true);
  assert.equal(call("nope", []).ok, false);
  assert.equal(call("getLegalMoves", ["not a fen"]).ok, false);
  assert.equal(call("getMovesFrom", [START, "z9"]).ok, false);
  assert.equal(call("getLegalMoves", ["x".repeat(500)]).ok, false);
  assert.equal(call("isLegal", [START]).ok, false); // wrong arity
  assert.match(call("getTurn", [START]).error || "", /limit exceeded/);
  assert.equal(JSON.parse(b.handle("{not json")).ok, false);
  assert.equal(JSON.parse(b.handle("x".repeat(5000))).ok, false);
  assert.equal(call("random", []).ok, true);
});

test("bridge: seeded random is deterministic", () => {
  const r = (seed) => {
    const b = createBridge({ seed });
    return [0, 1, 2].map(() => JSON.parse(b.handle('{"op":"random","args":[]}')).result);
  };
  assert.deepEqual(r(42), r(42));
  assert.notDeepEqual(r(42), r(43));
});

const STATE = { fen: START, legalMoves: ["e2e4", "d2d4", "g1f3"], turn: "w", timeRemainingMs: 60000, incrementMs: 0, history: [] };
const bot = (language, code) => runBotMove({ language, code, state: STATE, seed: 3 });
const forfeit = async (language, code, label) => {
  const r = await bot(language, code);
  assert.equal(r.ok, false, `${label}: expected forfeit, got ${JSON.stringify(r)}`);
  assert.equal(typeof r.reason, "string");
  assert.ok(r.reason.length < 600);
  return r;
};

test("every template runs in its language and returns a legal move", async () => {
  for (const [lang, set] of Object.entries(TEMPLATES)) {
    for (const [name, code] of Object.entries(set)) {
      assert.equal(checkSource(code, lang).ok, true, `${lang}/${name} passes its filter`);
      const compiled = compileForSave(lang, code);
      assert.equal(compiled.ok, true, `${lang}/${name} compiles`);
      const run = runnableOf({ language: lang, code, compiled: compiled.compiled });
      const r = await runBotMove({ ...run, state: STATE, seed: 9 });
      assert.equal(r.ok, true, `${lang}/${name}: ${r.reason}`);
      assert.ok(STATE.legalMoves.includes(r.move), `${lang}/${name} returned ${r.move}`);
    }
  }
});

test("library from every language gives identical answers", async () => {
  const js = `function chooseMove(s){ log(JSON.stringify(chess.getLegalMoves(s.fen).length), chess.isCheck(s.fen), chess.getMaterial(s.fen).w); return s.legalMoves[0]; }`;
  const py = `def choose_move(s):\n    log(len(chess.get_legal_moves(s["fen"])), chess.is_check(s["fen"]), chess.get_material(s["fen"])["w"])\n    return s["legal_moves"][0]`;
  const lua = `function choose_move(s) log(#chess.get_legal_moves(s.fen), chess.is_check(s.fen), chess.get_material(s.fen).w); return s.legal_moves[1] end`;
  const a = await bot("javascript", js);
  const b = await bot("python", py);
  const c = await bot("lua", lua);
  for (const r of [a, b, c]) assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(a.logs[0], "20 false 39");
  assert.equal(b.logs[0], "20 False 39");
  assert.equal(c.logs[0], "20 false 39");
});

test("library call cap is enforced inside a bot", async () => {
  const r = await forfeit("javascript", `function chooseMove(s){ for (var i=0;i<6000;i++) chess.getTurn(s.fen); return s.legalMoves[0]; }`, "cap");
  assert.match(r.reason, /limit exceeded/);
});

const ESCAPES = {
  javascript: {
    "require": `function chooseMove(s){ return require('fs').readFileSync('/etc/passwd','utf8'); }`,
    "process": `function chooseMove(s){ return String(process.env.HOME); }`,
    "constructor chain": `function chooseMove(s){ return (function(){}).constructor('return process')().version; }`,
    "bad return number": `function chooseMove(s){ return 42; }`,
    "bad return object": `function chooseMove(s){ return {a:1}; }`,
    "throws": `function chooseMove(s){ throw new Error('boom at /home/ubuntu/secret'); }`,
    "memory bomb": `function chooseMove(s){ var a=[]; while(true){ a.push(new Array(100000).fill(1)); } }`,
    "recursion bomb": `function chooseMove(s){ function f(){ return f()+1; } return f(); }`,
    "infinite loop": `function chooseMove(s){ while(true){} }`,
    "huge string": `function chooseMove(s){ var x='a'; for (var i=0;i<40;i++) x+=x; return x; }`,
  },
  python: {
    "import js": `import js\ndef choose_move(s):\n    return "e2e4"`,
    "import os": `import os\ndef choose_move(s):\n    return os.getcwd()`,
    "import sys": `import sys\ndef choose_move(s):\n    return str(sys.modules)`,
    "__import__": `def choose_move(s):\n    return str(__import__("js"))`,
    "eval": `def choose_move(s):\n    return eval("'e2e4'")`,
    "exec": `def choose_move(s):\n    exec("x=1")\n    return "e2e4"`,
    "open": `def choose_move(s):\n    return open("/etc/passwd").read()`,
    "from json import sys": `import json\ndef choose_move(s):\n    return str(json.sys)`,
    "class walk": `def choose_move(s):\n    return str(().__class__.__bases__[0].__subclasses__())`,
    "bad return": `def choose_move(s):\n    return 5`,
    "memory bomb": `def choose_move(s):\n    x = [0] * (10 ** 9)\n    return "e2e4"`,
    "recursion bomb": `def f():\n    return f() + 1\ndef choose_move(s):\n    return str(f())`,
    "infinite loop": `def choose_move(s):\n    while True:\n        pass`,
  },
  lua: {
    "os": `function choose_move(s) return os.getenv("HOME") end`,
    "io": `function choose_move(s) return io.open("/etc/passwd"):read("*a") end`,
    "load": `function choose_move(s) return load("return 'e2e4'")() end`,
    "require": `function choose_move(s) return require("os").getenv("HOME") end`,
    "debug": `function choose_move(s) return debug.getinfo(1).source end`,
    "metatable": `function choose_move(s) return getmetatable("").__index.rep("x", 3) end`,
    "bad return": `function choose_move(s) return {1,2} end`,
    "memory bomb": `function choose_move(s) local t = {} for i = 1, 1e9 do t[i] = string.rep("x", 1000000) end return "e2e4" end`,
    "recursion bomb": `local function f() return 1 + f() end function choose_move(s) return tostring(f()) end`,
    "infinite loop": `function choose_move(s) while true do end end`,
  },
};

for (const [language, cases] of Object.entries(ESCAPES)) {
  for (const [label, code] of Object.entries(cases)) {
    test(`escape corpus [${language}] ${label} -> clean forfeit`, async () => {
      // Run WITHOUT the static filter so the runtime itself is what is tested.
      const r = await forfeit(language, code, label);
      assert.doesNotMatch(r.reason, /\/home\/|\/Users\/|\/etc\/passwd/, "no host paths leak into reasons");
    });
  }
  test(`pool stays healthy after the [${language}] corpus`, async () => {
    const ok = {
      javascript: `function chooseMove(s){ return s.legalMoves[0]; }`,
      python: `def choose_move(s):\n    return s["legal_moves"][0]`,
      lua: `function choose_move(s) return s.legal_moves[1] end`,
    }[language];
    const r = await bot(language, ok);
    assert.equal(r.ok, true, JSON.stringify(r));
  });
}

test("no host objects are visible from inside any runtime", async () => {
  const js = await bot("javascript", `function chooseMove(s){ return typeof __chess === 'undefined' && typeof process === 'undefined' && typeof require === 'undefined' ? 'clean' : 'LEAK'; }`);
  assert.equal(js.move, "clean");
  const py = await bot("python", `def choose_move(s):\n    return ",".join(sorted(globals().keys()))`);
  for (const bad of ["sys", "builtins", "chesshost", "js", "_real", "json"]) assert.ok(!py.move.split(",").includes(bad), `python globals expose ${bad}: ${py.move}`);
  const lua = await bot("lua", `function choose_move(s) local seen = {} for k, v in pairs(_G) do seen[#seen+1] = k end table.sort(seen) return table.concat(seen, ",") end`);
  for (const bad of ["__chess", "os", "io", "debug", "package", "require", "load", "dofile", "setmetatable", "getmetatable"]) assert.ok(!lua.move.split(",").includes(bad), `lua globals expose ${bad}: ${lua.move}`);
});

test("static filter: rejects dangerous Python/Lua source and accepts the templates", () => {
  for (const code of ["import os\ndef choose_move(s): pass", "import js\ndef choose_move(s): pass", "x = eval('1')\ndef choose_move(s): pass", "x = ().__class__.__bases__\ndef choose_move(s): pass"]) {
    assert.equal(checkSource(code, "python").ok, false, code);
  }
  for (const code of ["os.exit()\nfunction choose_move(s) end", "function choose_move(s) return load('x') end", "x = _G\nfunction choose_move(s) end"]) {
    assert.equal(checkSource(code, "lua").ok, false, code);
  }
  assert.equal(checkSource("class A:\n    def __init__(self):\n        pass\ndef choose_move(s):\n    return 'e2e4'", "python").ok, true);
});

test("typescript: compile errors report a line; valid source compiles", () => {
  assert.equal(compileForSave("typescript", "function chooseMove(s: string): string { return s; }").ok, true);
  const bad = compileForSave("typescript", "function chooseMove( {");
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /line \d+/);
});

test("scrub: paths, tokens and the canary are removed from output", () => {
  const { CANARY } = require("../src/bots/scrub");
  const out = scrubText(`failed at /home/ubuntu/checkm8/server/.env with eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghi and ${CANARY}`);
  assert.doesNotMatch(out, /\/home\/ubuntu/);
  assert.doesNotMatch(out, /eyJhbGci/);
  assert.ok(!out.includes(CANARY));
});

test("kill switch: a disabled language refuses to run, others still work", async () => {
  killSwitch.disableLanguage("lua", "test");
  const r = await bot("lua", `function choose_move(s) return s.legal_moves[1] end`);
  assert.equal(r.ok, false);
  assert.match(r.reason, /disabled/);
  const js = await bot("javascript", `function chooseMove(s){ return s.legalMoves[0]; }`);
  assert.equal(js.ok, true);
  killSwitch.enableLanguage("lua");
  const again = await bot("lua", `function choose_move(s) return s.legal_moves[1] end`);
  assert.equal(again.ok, true);
});

test.after(() => shutdownPool());
