// server/src/bots/sandbox.js — compatibility wrapper. The real JavaScript
// runtime lives in runtimes/quickjs.js; this keeps the original entry point
// (used by tests and tools) working, with the chess library available.
const quickjs = require("./runtimes/quickjs");
const { createBridge } = require("./bridge");

async function runBotMoveInSandbox({ code, state, limits = {}, seed }) {
  const bridge = createBridge({ seed });
  const result = await quickjs.run({ code, state, seed, limits, bridge });
  if (result.ok) result.libraryCalls = bridge.getCalls();
  result.logs = bridge.getLog();
  return result;
}

module.exports = { runBotMoveInSandbox, DEFAULTS: quickjs.DEFAULTS };
