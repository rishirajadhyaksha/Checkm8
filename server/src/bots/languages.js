// server/src/bots/languages.js — which languages exist, how each one runs,
// and how to turn a stored bot into something the runner can execute.
// TypeScript is a compile step (sucrase -> JavaScript); the runner only ever
// sees "javascript", "python" or "lua".
const { compileTypeScript } = require("./compilers/typescript");

const LANGUAGES = {
  javascript: { label: "JavaScript", entry: "chooseMove", runtime: "quickjs", monaco: "javascript", beta: false },
  typescript: { label: "TypeScript", entry: "chooseMove", runtime: "quickjs", monaco: "typescript", beta: false },
  python: { label: "Python", entry: "choose_move", runtime: "micropython", monaco: "python", beta: true },
  lua: { label: "Lua", entry: "choose_move", runtime: "lua", monaco: "lua", beta: false },
};
const DEFAULT_LANGUAGE = "javascript";

const isLanguage = (l) => Object.prototype.hasOwnProperty.call(LANGUAGES, l);
const normalizeLanguage = (l) => (isLanguage(l) ? l : DEFAULT_LANGUAGE);

/** Compile step at save time. Returns {ok, compiled} (compiled null when none is needed). */
function compileForSave(language, code) {
  if (language === "typescript") {
    const r = compileTypeScript(code);
    return r.ok ? { ok: true, compiled: r.code } : { ok: false, reason: r.reason };
  }
  return { ok: true, compiled: null };
}

/**
 * What the runner executes for a stored bot / game snapshot:
 * { language: runtime language, code }.
 */
function runnableOf({ language, code, compiled }) {
  const lang = normalizeLanguage(language);
  if (lang === "typescript") return { language: "javascript", code: compiled || code };
  return { language: lang, code };
}

module.exports = { LANGUAGES, DEFAULT_LANGUAGE, isLanguage, normalizeLanguage, compileForSave, runnableOf };
