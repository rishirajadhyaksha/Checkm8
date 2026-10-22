// engines/stockfishEngine.js — Section 10.3, for real this time.
//
// Drives an actual Stockfish binary over the UCI protocol via child_process,
// exactly as the design doc specifies. Requires the `stockfish` package to
// be installed on the host (Ubuntu/Debian: `apt install stockfish`, which
// puts the binary at /usr/games/stockfish). If the binary genuinely isn't
// present, getStockfishMove() throws and engineService.js falls back to the
// in-process minimax engine (tieredEngine.js) so computer games never break
// on a machine that hasn't installed the binary yet.

const { spawn } = require("child_process");

const CANDIDATE_PATHS = ["/usr/games/stockfish", "/usr/bin/stockfish", "/usr/local/bin/stockfish", "stockfish"];

const TIER_CONFIG = {
  easy: { skillLevel: 1, depth: 5, moveTimeMs: 300 },
  medium: { skillLevel: 8, depth: 10, moveTimeMs: 600 },
  hard: { skillLevel: 15, depth: 14, moveTimeMs: 1000 },
  expert: { skillLevel: 20, depth: 18, moveTimeMs: 1500 },
};

let resolvedPath = null;
let engineProcess = null;
let readyPromise = null;
let pendingResolvers = [];
let outputBuffer = "";

function trySpawn(path) {
  return new Promise((resolve, reject) => {
    try {
      const proc = spawn(path, [], { stdio: ["pipe", "pipe", "pipe"] });
      let settled = false;
      proc.on("error", (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      proc.stdout.once("data", () => {
        if (!settled) {
          settled = true;
          resolve(proc);
        }
      });
      proc.stdin.write("uci\n");
      setTimeout(() => {
        if (!settled) {
          settled = true;
          proc.kill();
          reject(new Error("Stockfish did not respond to 'uci' handshake in time."));
        }
      }, 2000);
    } catch (err) {
      reject(err);
    }
  });
}

async function ensureEngine() {
  if (engineProcess && !engineProcess.killed) return engineProcess;

  for (const path of CANDIDATE_PATHS) {
    try {
      const proc = await trySpawn(path);
      resolvedPath = path;
      engineProcess = proc;
      outputBuffer = "";
      engineProcess.stdout.on("data", (chunk) => {
        outputBuffer += chunk.toString();
        flushLines();
      });
      engineProcess.on("exit", () => {
        engineProcess = null;
      });
      await sendAndAwait("isready", "readyok");
      return engineProcess;
    } catch {
      /* try the next candidate path */
    }
  }
  throw new Error("No working Stockfish binary found (tried: " + CANDIDATE_PATHS.join(", ") + ")");
}

function flushLines() {
  let idx;
  while ((idx = outputBuffer.indexOf("\n")) !== -1) {
    const line = outputBuffer.slice(0, idx).trim();
    outputBuffer = outputBuffer.slice(idx + 1);
    if (pendingResolvers.length > 0 && pendingResolvers[0].test(line)) {
      const { resolve } = pendingResolvers.shift();
      resolve(line);
    }
  }
}

function sendAndAwait(command, expectPrefix) {
  return new Promise((resolve, reject) => {
    pendingResolvers.push({
      test: (line) => line === expectPrefix || line.startsWith(expectPrefix),
      resolve,
    });
    engineProcess.stdin.write(command + "\n");
    setTimeout(() => reject(new Error(`Stockfish timed out waiting for "${expectPrefix}"`)), 5000);
  });
}

/**
 * @param {string} fen
 * @param {"easy"|"medium"|"hard"|"expert"} tier
 * @returns {Promise<{from: string, to: string, promotion?: string}>}
 */
let engineQueue = Promise.resolve();

function getStockfishMove(fen, tier) {
  // A single Stockfish process can only think about one position at a time.
  // Serialize calls so two simultaneous computer games never cross-talk by
  // interleaving 'position'/'go' commands meant for different boards.
  const run = () => getStockfishMoveInternal(fen, tier);
  const result = engineQueue.then(run, run);
  engineQueue = result.catch(() => {}); // keep the chain alive even if one call fails
  return result;
}

async function getStockfishMoveInternal(fen, tier) {
  const cfg = TIER_CONFIG[tier] || TIER_CONFIG.medium;
  await ensureEngine();

  engineProcess.stdin.write(`setoption name Skill Level value ${cfg.skillLevel}\n`);
  engineProcess.stdin.write(`position fen ${fen}\n`);

  const bestMoveLine = await new Promise((resolve, reject) => {
    pendingResolvers.push({
      test: (line) => line.startsWith("bestmove"),
      resolve,
    });
    engineProcess.stdin.write(`go depth ${cfg.depth} movetime ${cfg.moveTimeMs}\n`);
    setTimeout(() => reject(new Error("Stockfish timed out computing a move")), cfg.moveTimeMs + 5000);
  });

  const match = bestMoveLine.match(/bestmove\s+(\S+)/);
  if (!match || match[1] === "(none)") throw new Error("Stockfish returned no legal move.");
  return parseUciMove(match[1]);
}

function parseUciMove(uci) {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci.slice(4, 5) : undefined,
  };
}

function isAvailable() {
  return ensureEngine()
    .then(() => true)
    .catch(() => false);
}

module.exports = { getStockfishMove, isAvailable, TIER_CONFIG };
