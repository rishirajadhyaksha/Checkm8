// server/src/bots/runtimes/quickjs.js — JavaScript runtime (also runs TypeScript
// and, later, Java, after they are compiled to JavaScript). A QuickJS
// WebAssembly VM with exactly one host function: __chess(json) -> json.
// Memory cap + interrupt-handler deadline are enforced inside the VM.
const { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline } = require("quickjs-emscripten-core");
const RELEASE_SYNC_VARIANT = require("@jitl/quickjs-wasmfile-release-sync");
const { seededRandomPrelude } = require("../seed");
const { METHODS } = require("../librarySpec");

let modulePromise = null;
function loadQuickJS() {
  if (!modulePromise) modulePromise = newQuickJSWASMModuleFromVariant(RELEASE_SYNC_VARIANT);
  return modulePromise;
}

const DEFAULTS = {
  memoryLimitBytes: 16 * 1024 * 1024,
  maxStackSizeBytes: 1024 * 1024,
  deadlineMs: 1500,
};

// Idiomatic wrapper over the single host bridge. The host function is
// captured in a closure and removed from the global object so bot code
// cannot call it with hand-built requests.
const PRELUDE = `
var chess = {};
(function (host) {
  function call(op, args) {
    var r = JSON.parse(host(JSON.stringify({ op: op, args: args })));
    if (!r.ok) throw new Error(r.error);
    return r.result;
  }
  var names = ${JSON.stringify(METHODS.map((m) => m.name))};
  names.forEach(function (n) {
    chess[n] = function () { return call(n, Array.prototype.slice.call(arguments)); };
  });
  var log = function () { call("log", Array.prototype.slice.call(arguments)); };
  globalThis.log = log;
  globalThis.print = log;
  globalThis.console = { log: log, info: log, warn: log, error: log };
  globalThis.random = function () { return Math.random(); };
  delete globalThis.__chess;
})(__chess);
`;

function buildSource(userCode, state, seed) {
  return [
    '"use strict";',
    "(function () {",
    typeof seed === "number" ? seededRandomPrelude(seed) : "",
    userCode,
    "",
    "  if (typeof chooseMove !== 'function') {",
    "    throw new Error('chooseMove(state) must be defined as a function.');",
    "  }",
    `  var __state = ${JSON.stringify(state)};`,
    "  var __move = chooseMove(__state);",
    "  return JSON.stringify({ move: __move });",
    "})()",
  ].join("\n");
}

function describeError(err, startedAt, deadlineMs) {
  if (Date.now() - startedAt >= deadlineMs - 5) return `Bot exceeded its ${deadlineMs}ms move budget.`;
  const message = (err && err.message) || (err && err.name) || String(err);
  if (/out of memory|memory limit/i.test(message)) return "Bot exceeded its memory limit.";
  if (/stack overflow|too much recursion/i.test(message)) return "Bot exceeded its stack size limit (likely infinite recursion).";
  return `Bot threw an error: ${message}`;
}

/** @returns {Promise<{ok:true,move:string,elapsedMs:number}|{ok:false,reason:string}>} */
async function run({ code, state, seed, limits = {}, bridge }) {
  const { memoryLimitBytes, maxStackSizeBytes, deadlineMs } = { ...DEFAULTS, ...limits };
  const QuickJS = await loadQuickJS();
  const runtime = QuickJS.newRuntime();
  const startedAt = Date.now();
  try {
    runtime.setMemoryLimit(memoryLimitBytes);
    runtime.setMaxStackSize(maxStackSizeBytes);
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(startedAt + deadlineMs));
    const context = runtime.newContext();
    try {
      if (bridge) {
        const fn = context.newFunction("__chess", (arg) => context.newString(bridge.handle(context.getString(arg))));
        context.setProp(context.global, "__chess", fn);
        fn.dispose();
      } else {
        const fn = context.newFunction("__chess", () => context.newString(JSON.stringify({ ok: false, error: "library unavailable" })));
        context.setProp(context.global, "__chess", fn);
        fn.dispose();
      }
      // Prelude is trusted code and runs outside the user's strict-mode wrapper.
      try {
        context.unwrapResult(context.evalCode(PRELUDE)).dispose();
      } catch (e) {
        return { ok: false, reason: "Internal sandbox error — move forfeited." };
      }
      let handle;
      try {
        handle = context.unwrapResult(context.evalCode(buildSource(code, state, seed)));
      } catch (evalErr) {
        return { ok: false, reason: describeError(evalErr, startedAt, deadlineMs) };
      }
      const raw = context.getString(handle);
      handle.dispose();
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { ok: false, reason: "chooseMove's return value could not be serialized to JSON." };
      }
      if (typeof parsed.move !== "string" || !parsed.move) {
        return { ok: false, reason: "chooseMove(state) must return a non-empty move string." };
      }
      return { ok: true, move: parsed.move, elapsedMs: Date.now() - startedAt };
    } finally {
      context.dispose();
    }
  } finally {
    runtime.dispose();
  }
}

module.exports = { run, DEFAULTS, PRELUDE };
