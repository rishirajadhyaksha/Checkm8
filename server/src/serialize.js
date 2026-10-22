// Allow-list serializer for game records. Never return a raw stored game:
// stored records carry bot source (botCode), its hash, and other internals.
const SECRET_KEYS = new Set(["botCode", "botCodeHash", "botCompiled", "seed", "runnerId"]);

function publicGame(game) {
  if (!game || typeof game !== "object") return game;
  const out = {};
  for (const [k, v] of Object.entries(game)) {
    if (!SECRET_KEYS.has(k)) out[k] = v;
  }
  return out;
}

module.exports = { publicGame };
