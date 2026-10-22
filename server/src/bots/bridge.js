// server/src/bots/bridge.js — the ONE host function every bot runtime gets:
// __chess(requestJson) -> responseJson. Only JSON strings cross the
// boundary, never objects. Behind it: an operation whitelist (the 24 spec
// methods plus log/random), argument validation derived from the spec, a
// per-move call counter, and size caps on arguments and results.
const { METHODS, T } = require("./librarySpec");
const { createLibrary } = require("./library");

const MAX_CALLS = 5000;
const MAX_ARG_CHARS = 200;
const MAX_RESULT_CHARS = 64 * 1024;
const MAX_LOG_BYTES = 4096;

const VALIDATORS = {
  [T.FEN]: (v) => typeof v === "string" && v.length > 0 && v.length <= MAX_ARG_CHARS,
  [T.MOVE]: (v) => typeof v === "string" && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(v),
  [T.SQUARE]: (v) => typeof v === "string" && /^[a-h][1-8]$/.test(v),
  [T.COLOR]: (v) => v === "w" || v === "b",
  [T.PIECE]: (v) => typeof v === "string" && /^[pnbrqk]$/.test(v),
};

const BY_NAME = new Map(METHODS.map((m) => [m.name, m]));

// Same mulberry32 as seed.js, but driven from the host so Python/Lua get an
// identical, replayable stream. (JavaScript keeps its Math.random override.)
function makeRandom(seed) {
  let s = (seed | 0) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createBridge({ seed, maxCalls = MAX_CALLS } = {}) {
  const lib = createLibrary();
  const random = typeof seed === "number" ? makeRandom(seed ^ 0x9e3779b9) : Math.random;
  let calls = 0;
  let logBytes = 0;
  const logLines = [];

  const fail = (error) => JSON.stringify({ ok: false, error });

  function handle(requestJson) {
    try {
      if (typeof requestJson !== "string" || requestJson.length > 2048) return fail("request too large");
      const req = JSON.parse(requestJson);
      const op = req && req.op;
      const args = Array.isArray(req && req.args) ? req.args : [];

      if (op === "random") return JSON.stringify({ ok: true, result: random() });
      if (op === "log") {
        const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ").slice(0, 500);
        if (logBytes + line.length + 1 <= MAX_LOG_BYTES) {
          logBytes += line.length + 1;
          logLines.push(line);
        }
        return JSON.stringify({ ok: true, result: null });
      }

      const method = BY_NAME.get(op);
      if (!method) return fail(`unknown library method "${String(op).slice(0, 40)}"`);
      if (++calls > maxCalls) return fail(`library call limit exceeded (${maxCalls} calls per move)`);
      if (args.length !== method.args.length) return fail(`${op} takes ${method.args.length} argument(s)`);
      for (let i = 0; i < args.length; i++) {
        const [argName, type] = method.args[i];
        if (!VALIDATORS[type](args[i])) return fail(`invalid ${type} for argument "${argName}" of ${op}`);
      }
      let result;
      try {
        result = lib[op](...args);
      } catch {
        return fail(`invalid position (FEN) passed to ${op}`);
      }
      const out = JSON.stringify({ ok: true, result: result === undefined ? null : result });
      if (out.length > MAX_RESULT_CHARS) return fail("result too large");
      return out;
    } catch {
      return fail("malformed request");
    }
  }

  return { handle, getCalls: () => calls, getLog: () => logLines.slice(), maxCalls };
}

module.exports = { createBridge, MAX_CALLS };
