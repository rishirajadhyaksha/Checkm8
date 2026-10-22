// frontend/src/bots/botSandbox.worker.js — "Run in browser" for the Bot Lab.
//
// Runs a bot entirely inside this Web Worker, in the same kind of sandbox the
// server uses: QuickJS/WASM for JavaScript and TypeScript, wasmoon (Lua 5.4)
// and MicroPython (WebAssembly) for the others, each with exactly one host
// function — the chess-library bridge — and nothing else. The preludes (the
// glue that exposes chess.*) come from the server so both sides stay
// identical. A fresh Worker is used per run and terminated if it does not
// answer in time (the real limit for Lua/Python, which cannot interrupt
// themselves).
//
// Hardening: before any bot code runs, the worker's own network and storage
// APIs are removed. fetch survives only as a closure that may load same-origin
// .wasm files for the runtimes; bot code (inside a VM) never sees it. The
// worker has no DOM, no localStorage and no access to the app's auth token.

import { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline } from "quickjs-emscripten-core";
import RELEASE_SYNC_VARIANT from "@jitl/quickjs-wasmfile-release-sync";
import luaWasmUrl from "wasmoon/dist/glue.wasm?url";
import mpWasmUrl from "@micropython/micropython-webassembly-pyscript/micropython.wasm?url";
import { createBridge } from "./shared/bridge.js";

const realFetch = self.fetch.bind(self);
const guardedFetch = (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url, self.location.href);
  if (url.origin !== self.location.origin || !url.pathname.endsWith(".wasm")) {
    return Promise.reject(new Error("network access is disabled in the bot sandbox"));
  }
  return realFetch(input, init);
};
for (const key of ["XMLHttpRequest", "WebSocket", "EventSource", "indexedDB", "caches", "BroadcastChannel", "SharedWorker"]) {
  try {
    Object.defineProperty(self, key, { value: undefined, configurable: false });
  } catch {
    /* not defined in this worker */
  }
}
try {
  Object.defineProperty(self, "fetch", { value: guardedFetch, configurable: false });
} catch {
  /* ignore */
}

let quickJSPromise = null;
const loadQuickJS = () => (quickJSPromise ||= newQuickJSWASMModuleFromVariant(RELEASE_SYNC_VARIANT));

const snake = (s) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
const snakeKeys = (v) =>
  Array.isArray(v) ? v.map(snakeKeys) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [snake(k), snakeKeys(x)])) : v;

// Same seeded Math.random as the server (server/src/bots/seed.js).
const seededRandom = (seed) => `
Math.random = (function (seed) {
  var s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})(${seed | 0});
`;

async function runJavaScript({ code, state, seed, deadlineMs, memoryLimitBytes, prelude, bridge }) {
  const QuickJS = await loadQuickJS();
  const runtime = QuickJS.newRuntime();
  const startedAt = Date.now();
  try {
    runtime.setMemoryLimit(memoryLimitBytes);
    runtime.setMaxStackSize(1024 * 1024);
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(startedAt + deadlineMs));
    const context = runtime.newContext();
    try {
      const fn = context.newFunction("__chess", (arg) => context.newString(bridge.handle(context.getString(arg))));
      context.setProp(context.global, "__chess", fn);
      fn.dispose();
      context.unwrapResult(context.evalCode(prelude)).dispose();
      const wrapped = [
        '"use strict";',
        "(function () {",
        typeof seed === "number" ? seededRandom(seed) : "",
        code,
        "",
        "  if (typeof chooseMove !== 'function') throw new Error('chooseMove(state) must be defined as a function.');",
        `  var __state = ${JSON.stringify(state)};`,
        "  return JSON.stringify({ move: chooseMove(__state) });",
        "})()",
      ].join("\n");
      let handle;
      try {
        handle = context.unwrapResult(context.evalCode(wrapped));
      } catch (err) {
        const timedOut = Date.now() - startedAt >= deadlineMs - 5;
        const message = (err && err.message) || String(err);
        if (timedOut) return { ok: false, reason: `Bot exceeded its ${deadlineMs}ms move budget.` };
        if (/out of memory|memory limit/i.test(message)) return { ok: false, reason: "Bot exceeded its memory limit." };
        if (/stack overflow|too much recursion/i.test(message)) return { ok: false, reason: "Bot exceeded its stack size limit (likely infinite recursion)." };
        return { ok: false, reason: `Bot threw an error: ${message}` };
      }
      const raw = context.getString(handle);
      handle.dispose();
      const parsed = JSON.parse(raw);
      if (typeof parsed.move !== "string" || !parsed.move) return { ok: false, reason: "chooseMove(state) must return a non-empty move string." };
      return { ok: true, move: parsed.move, elapsedMs: Date.now() - startedAt };
    } finally {
      context.dispose();
    }
  } finally {
    runtime.dispose();
  }
}

async function runLua({ code, state, memoryLimitBytes, prelude, bridge }) {
  const { LuaFactory, LuaLibraries } = await import("wasmoon");
  const lua = await new LuaFactory(luaWasmUrl).createEngine({ openStandardLibs: false, injectObjects: false, traceAllocations: true });
  const startedAt = Date.now();
  try {
    for (const lib of [LuaLibraries.Base, LuaLibraries.Table, LuaLibraries.String, LuaLibraries.Math]) lua.global.loadLibrary(lib);
    lua.global.setMemoryMax(memoryLimitBytes);
    lua.global.set("__chess", (req) => bridge.handle(String(req)));
    lua.global.set("__state_json", JSON.stringify(snakeKeys(state)));
    await lua.doString(prelude);
    try {
      await lua.doString(code);
    } catch (e) {
      return { ok: false, reason: `Bot threw an error: ${String((e && e.message) || e).split("\n")[0].slice(0, 300)}` };
    }
    let move;
    try {
      move = await lua.doString("if type(choose_move) ~= 'function' then error('choose_move(state) must be defined as a function.') end return __run()");
    } catch (e) {
      return { ok: false, reason: `Bot threw an error: ${String((e && e.message) || e).split("\n")[0].slice(0, 300)}` };
    }
    if (typeof move !== "string" || !move) return { ok: false, reason: "choose_move(state) must return a non-empty move string." };
    return { ok: true, move, elapsedMs: Date.now() - startedAt };
  } finally {
    try {
      lua.global.close();
    } catch {
      /* ignore */
    }
  }
}

async function runPython({ code, state, memoryLimitBytes, prelude, bridge }) {
  const { loadMicroPython } = await import("@micropython/micropython-webassembly-pyscript/micropython.mjs");
  const startedAt = Date.now();
  const out = [];
  let outBytes = 0;
  const mp = await loadMicroPython({
    url: mpWasmUrl,
    heapsize: Math.min(memoryLimitBytes, 8 * 1024 * 1024),
    stdout: (s) => {
      if (outBytes + s.length <= 4096) {
        outBytes += s.length;
        out.push(s);
      }
    },
    stderr: () => {},
  });
  mp.registerJsModule("chesshost", { call: (req) => bridge.handle(String(req)), state: JSON.stringify(snakeKeys(state)) });
  const lastLine = (e) => String((e && e.message) || e).trim().split("\n").pop().slice(0, 300);
  mp.runPython(prelude);
  try {
    mp.runPython(code);
  } catch (e) {
    return { ok: false, reason: `Bot threw an error: ${lastLine(e)}` };
  }
  try {
    mp.runPython("if 'choose_move' not in globals():\n    raise NameError('choose_move(state) must be defined as a function.')\n__move = _run()");
  } catch (e) {
    return { ok: false, reason: `Bot threw an error: ${lastLine(e)}` };
  }
  const move = mp.globals.get("__move");
  if (typeof move !== "string" || !move) return { ok: false, reason: "choose_move(state) must return a non-empty move string." };
  return { ok: true, move, elapsedMs: Date.now() - startedAt, stdout: out.join("") };
}

self.onmessage = async (event) => {
  const { jobId, language = "javascript", code, state, seed, spec, preludes, deadlineMs = 1500, memoryLimitBytes = 16 * 1024 * 1024 } = event.data || {};
  try {
    const bridge = createBridge({ spec, seed });
    let source = code;
    let runtime = language;
    if (language === "typescript") {
      const { transform } = await import("sucrase");
      source = transform(code, { transforms: ["typescript"], disableESTransforms: true }).code;
      runtime = "javascript";
    }
    const args = { code: source, state, seed, deadlineMs, memoryLimitBytes, prelude: preludes[runtime], bridge };
    const result =
      runtime === "lua" ? await runLua(args) : runtime === "python" ? await runPython(args) : await runJavaScript(args);
    const logs = bridge.getLog();
    if (result.stdout) for (const l of String(result.stdout).split("\n")) if (l) logs.push(l);
    delete result.stdout;
    self.postMessage({ jobId, result: { ...result, logs, libraryCalls: bridge.getCalls() } });
  } catch (err) {
    self.postMessage({ jobId, result: { ok: false, reason: `Local sandbox error: ${String((err && err.message) || err).slice(0, 200)}` } });
  }
};
