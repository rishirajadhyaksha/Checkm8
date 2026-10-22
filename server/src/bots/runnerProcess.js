// server/src/bots/runnerProcess.js — entry point for a forked (or jailed)
// bot-runner worker process. Never require()'d by the main server: it is
// started by runnerPool.js as its own OS process so anything that goes wrong
// while executing bot code is contained to one disposable process.
//
// Transport: IPC (process.send) when forked directly; newline-delimited JSON
// on stdin/stdout when started inside the OS jail (sudo + unshare + setpriv),
// where an inherited IPC channel is not available.
//
// A worker that hits any unexpected (non-bot-fault) error reports the
// result and then retires itself; the pool replaces it with a fresh one.
const { createBridge } = require("./bridge");
const { scrubText, containsCanary } = require("./scrub");

const runtimes = {
  javascript: () => require("./runtimes/quickjs"),
  python: () => require("./runtimes/micropython"),
  lua: () => require("./runtimes/lua"),
};

async function execute({ language = "javascript", code, state, limits, seed }) {
  const load = runtimes[language];
  if (!load) return { ok: false, reason: `Unsupported language "${String(language).slice(0, 20)}".` };
  const bridge = createBridge({ seed });
  const result = await load().run({ code, state, seed, limits, bridge });
  const logs = bridge.getLog();
  if (result.stdout) for (const line of String(result.stdout).split("\n")) if (line) logs.push(line.slice(0, 500));
  delete result.stdout;
  // Checked BEFORE scrubbing: the canary lives only in this process's
  // environment, so seeing it in any output means bot code reached it.
  if (containsCanary(result) || containsCanary(logs)) {
    return { ok: false, reason: "Internal sandbox error — move forfeited.", canary: true };
  }
  if (!result.ok) result.reason = scrubText(result.reason);
  result.logs = logs.slice(0, 50).map((l) => scrubText(l));
  result.libraryCalls = bridge.getCalls();
  return result;
}

const useIpc = typeof process.send === "function";
function send(msg) {
  if (useIpc) process.send(msg);
  else process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handle(msg) {
  if (!msg || msg.type !== "run") return;
  const { jobId } = msg;
  let reply;
  let retireAfter = false;
  try {
    reply = { jobId, result: await execute(msg) };
  } catch (err) {
    reply = { jobId, result: { ok: false, reason: "Internal sandbox error — move forfeited." }, retire: true };
    retireAfter = true;
    console.error(`[bots/runnerProcess pid=${process.pid}] unexpected error, retiring worker:`, scrubText(err && err.message));
  }
  send(reply);
  if (retireAfter) setTimeout(() => process.exit(1), 50);
}

if (useIpc) {
  process.on("message", handle);
} else {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        handle(JSON.parse(line));
      } catch {
        /* ignore malformed lines */
      }
    }
  });
  process.stdin.on("end", () => process.exit(0));
}

process.on("uncaughtException", (err) => {
  console.error(`[bots/runnerProcess pid=${process.pid}] uncaught exception, exiting:`, scrubText(err && err.message));
  process.exit(1);
});

send({ type: "ready", pid: process.pid });
