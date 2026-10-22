// TypeScript is not a runtime: it is a compile step. sucrase strips the type
// annotations (no type-checking server-side; the editor does that) and the
// resulting JavaScript runs in the same QuickJS sandbox as a JS bot.
const { transform } = require("sucrase");

function compileTypeScript(source) {
  try {
    const out = transform(source, { transforms: ["typescript"], disableESTransforms: true });
    return { ok: true, code: out.code };
  } catch (err) {
    const loc = err && err.loc ? ` (line ${err.loc.line}, column ${err.loc.column + 1})` : "";
    const msg = String((err && err.message) || err).replace(/\s*\(\d+:\d+\)\s*$/, "").slice(0, 200);
    return { ok: false, reason: `TypeScript syntax error${loc}: ${msg}` };
  }
}

module.exports = { compileTypeScript };
