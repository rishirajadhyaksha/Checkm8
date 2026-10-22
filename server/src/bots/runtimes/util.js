// Shared helpers for the non-JavaScript runtimes.
const snake = (s) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

// Python and Lua get snake_case state keys (legal_moves, time_remaining_ms...).
function snakeKeys(v) {
  if (Array.isArray(v)) return v.map(snakeKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [snake(k), snakeKeys(x)]));
  return v;
}

const MAX_LOG_BYTES = 4096;
module.exports = { snake, snakeKeys, MAX_LOG_BYTES };
