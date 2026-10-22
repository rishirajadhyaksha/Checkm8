// Worker thread entry: runs the synchronous minimax search off the main
// event loop so a deep search can never stall clocks or sockets.
const { parentPort, workerData } = require("worker_threads");
const { getTieredMove } = require("./tieredEngine");
try {
  parentPort.postMessage({ ok: true, move: getTieredMove(workerData.fen, workerData.tier) });
} catch (err) {
  parentPort.postMessage({ ok: false, error: err.message });
}
