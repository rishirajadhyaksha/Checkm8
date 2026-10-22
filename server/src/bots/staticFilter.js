// server/src/bots/staticFilter.js — Bot Arena, Phase 0
//
// A cheap pre-publish text scan that rejects obviously disallowed patterns
// in submitted bot source. This is DEFENSE IN DEPTH ON TOP OF the sandbox
// in sandbox.js, never a substitute for it — the sandbox already exposes
// none of these capabilities to the VM regardless of what the source text
// contains, so this filter's job is just to reject clearly-bad submissions
// early with a clear message, and to catch a bot author's honest mistake
// (e.g. pasting code that assumes fetch/require exist) before they waste a
// sandbox run on it. A determined attacker who avoids these literal tokens
// gains nothing, because the sandbox has no such bindings to reach either
// way.

const MAX_SOURCE_BYTES = 20 * 1024; // 20KB, per bot-arena-design.md

// Word-boundary-ish regexes so we don't false-positive on substrings inside
// an unrelated identifier (e.g. a variable named `importantValue`).
const DISALLOWED_PATTERNS = [
  { pattern: /\bfetch\s*\(/, reason: "network access (fetch) is not allowed" },
  { pattern: /\bXMLHttpRequest\b/, reason: "network access (XMLHttpRequest) is not allowed" },
  { pattern: /\brequire\s*\(/, reason: "require(...) is not allowed" },
  { pattern: /\bimport\s*\(/, reason: "dynamic import(...) is not allowed" },
  { pattern: /^\s*import\s+/m, reason: "import statements are not allowed" },
  { pattern: /\bprocess\s*\./, reason: "process access is not allowed" },
  { pattern: /\beval\s*\(/, reason: "eval(...) is not allowed" },
  { pattern: /\bnew\s+Function\s*\(/, reason: "the Function constructor is not allowed" },
  { pattern: /\.constructor\s*\.\s*constructor/, reason: "constructor-chain sandbox-escape patterns are not allowed" },
  { pattern: /\bWebAssembly\b/, reason: "WebAssembly access is not allowed" },
  { pattern: /\bglobalThis\b/, reason: "globalThis access is not allowed" },
  { pattern: /\basync\s+function\b|\basync\s*\(/, reason: "async functions are not allowed — chooseMove must be synchronous" },
  { pattern: /\bawait\b/, reason: "await is not allowed — chooseMove must be synchronous" },
  { pattern: /__proto__/, reason: "__proto__ access is not allowed" },
];

const PY_ALLOWED_IMPORTS = new Set(["math", "json", "random", "chess", "collections"]);
const PY_PATTERNS = [
  { pattern: /\b(exec|eval|compile|open|input|getattr|setattr|delattr|globals|locals|vars|dir|breakpoint|memoryview)\s*\(/, reason: "that builtin is not allowed in Python bots" },
  { pattern: /__(import|class|bases|subclasses|dict|globals|builtins|mro|code|module|getattr|getattribute|reduce|loader|spec)__/, reason: "that dunder attribute is not allowed in Python bots" },
  { pattern: /\b(js|ffi|os|sys|builtins|chesshost|micropython|machine|gc|uos|usys)\b\s*\./, reason: "access to host modules is not allowed" },
];
const LUA_PATTERNS = [
  { pattern: /\b(os|io|debug|package|coroutine)\b\s*[.\[:]/, reason: "that Lua library is not available" },
  { pattern: /\b(require|load|loadstring|dofile|loadfile|getfenv|setfenv|setmetatable|getmetatable|rawset|rawget|collectgarbage)\b/, reason: "that Lua function is not allowed" },
  { pattern: /\b_G\b|\b_ENV\b|string\s*\.\s*dump/, reason: "access to the global environment is not allowed" },
];

function checkPython(source) {
  for (const m of source.matchAll(/^[ \t]*(?:import|from)[ \t]+([A-Za-z_][\w.]*)(?:[ \t]+import\b|[ \t]*,|[ \t]+as\b|[ \t]*$)/gm)) {
    const root = m[1].split(".")[0];
    if (!PY_ALLOWED_IMPORTS.has(root)) return { ok: false, reason: `import of "${root}" is not allowed (allowed: ${[...PY_ALLOWED_IMPORTS].join(", ")})` };
  }
  if (/^[ \t]*import[ \t]+[\w.]+[ \t]*,/m.test(source)) return { ok: false, reason: "import one module per line" };
  for (const { pattern, reason } of PY_PATTERNS) if (pattern.test(source)) return { ok: false, reason };
  if (!/^def\s+choose_move\s*\(/m.test(source)) return { ok: false, reason: "Source must define def choose_move(state)." };
  return { ok: true };
}

function checkLua(source) {
  for (const { pattern, reason } of LUA_PATTERNS) if (pattern.test(source)) return { ok: false, reason };
  if (!/\bfunction\s+choose_move\s*\(/.test(source) && !/\bchoose_move\s*=/.test(source)) {
    return { ok: false, reason: "Source must define function choose_move(state)." };
  }
  return { ok: true };
}

/**
 * @param {string} source
 * @param {string} [language] javascript (default) | typescript | python | lua
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
function checkSource(source, language = "javascript") {
  if (typeof source !== "string" || !source.trim()) {
    return { ok: false, reason: "Bot source must be a non-empty string." };
  }
  const byteLength = Buffer.byteLength(source, "utf8");
  if (byteLength > MAX_SOURCE_BYTES) {
    return { ok: false, reason: `Bot source is ${byteLength} bytes, over the ${MAX_SOURCE_BYTES}-byte limit.` };
  }
  if (language === "python") return checkPython(source);
  if (language === "lua") return checkLua(source);
  for (const { pattern, reason } of DISALLOWED_PATTERNS) {
    if (pattern.test(source)) {
      return { ok: false, reason };
    }
  }
  if (!/\bfunction\s+chooseMove\s*\(/.test(source) && !/\bchooseMove\s*=/.test(source)) {
    return { ok: false, reason: "Source must define a chooseMove(state) function." };
  }
  return { ok: true };
}

module.exports = { checkSource, MAX_SOURCE_BYTES };
