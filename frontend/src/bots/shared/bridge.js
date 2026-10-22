// Browser twin of server/src/bots/bridge.js: the one host function every
// runtime gets, __chess(requestJson) -> responseJson. The method list and
// argument types come from the server's spec (GET /bots/library-spec), so
// the server stays the single source of truth.
import { createLibrary } from "./library.js";

const MAX_CALLS = 5000;
const MAX_ARG_CHARS = 200;
const MAX_RESULT_CHARS = 64 * 1024;
const MAX_LOG_BYTES = 4096;

const VALIDATORS = {
  fen: (v) => typeof v === "string" && v.length > 0 && v.length <= MAX_ARG_CHARS,
  move: (v) => typeof v === "string" && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(v),
  square: (v) => typeof v === "string" && /^[a-h][1-8]$/.test(v),
  color: (v) => v === "w" || v === "b",
  piece: (v) => typeof v === "string" && /^[pnbrqk]$/.test(v),
};

function makeRandom(seed) {
  let s = (seed | 0) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createBridge({ spec, seed, maxCalls = MAX_CALLS }) {
  const lib = createLibrary();
  const byName = new Map(spec.methods.map((m) => [m.name, m]));
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
      const method = byName.get(op);
      if (!method) return fail(`unknown library method "${String(op).slice(0, 40)}"`);
      if (++calls > maxCalls) return fail(`library call limit exceeded (${maxCalls} calls per move)`);
      if (args.length !== method.args.length) return fail(`${op} takes ${method.args.length} argument(s)`);
      for (let i = 0; i < args.length; i++) {
        if (!VALIDATORS[method.args[i].type](args[i])) return fail(`invalid ${method.args[i].type} for argument "${method.args[i].name}" of ${op}`);
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
  return { handle, getCalls: () => calls, getLog: () => logLines.slice() };
}
