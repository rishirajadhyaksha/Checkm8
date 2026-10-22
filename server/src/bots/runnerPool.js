// server/src/bots/runnerPool.js — Bot Arena, Phase 0
//
// Owns a small, FIXED-SIZE pool of forked bot-runner processes (see
// runnerProcess.js) and is the single choke point every bot execution goes
// through. Once human-vs-bot games and (later) ladder matches both exist,
// they will BOTH call runBotMove() here and share this same pool rather
// than each getting an independent one — that's what makes the pool size
// an honest, enforced cap on how much of the box bot execution can ever
// consume at once, and what stops a busy ladder from ever being able to
// slow down somebody's live game. See bot-arena-design.md's Security
// section ("Resource exhaustion") for the reasoning.
//
// Every job also gets a hard OUTER timeout here, independent of the
// per-call deadline enforced inside the sandbox itself (sandbox.js). This
// is the backstop for the case where the in-VM interrupt mechanism doesn't
// fire for some reason: if a worker doesn't reply in time, this pool kills
// that OS process outright and replaces it, rather than trusting it to
// recover on its own.

const { fork } = require("child_process");
const path = require("path");
const crypto = require("crypto");
const killSwitch = require("./killSwitch");
const audit = require("./audit");
const { CANARY, scrubText } = require("./scrub");
const { spawn, spawnSync } = require("child_process");

const POOL_SIZE = parseInt(process.env.BOT_RUNNER_POOL_SIZE || "4", 10);
const OUTER_TIMEOUT_SLACK_MS = 1000; // grace period on top of the job's own deadlineMs
const DEFAULT_DEADLINE_MS = 1500;

const RUNNER_ENTRY = path.join(__dirname, "runnerProcess.js");

// OS-level jail (Linux): runner runs as a separate unprivileged user inside
// an empty network namespace (no network at all). Enabled with
// BOT_RUNNER_JAIL=1 (set by the deploy); falls back to a plain fork with a
// loud warning if the probe fails, so a misconfigured host never breaks bots.
const JAIL_USER = process.env.BOT_RUNNER_USER || "botrunner";
let jailMode = null;
function jailEnabled() {
  if (jailMode !== null) return jailMode;
  jailMode = false;
  if (process.env.BOT_RUNNER_JAIL !== "1") return jailMode;
  try {
    const probe = spawnSync("sudo", ["-n", ...jailPrefix(), process.execPath, "-e", "process.exit(0)"], { timeout: 8000, stdio: "ignore" });
    jailMode = probe.status === 0;
  } catch {
    jailMode = false;
  }
  audit.record(jailMode ? "runner_jail_active" : "runner_jail_unavailable", { user: JAIL_USER });
  return jailMode;
}
function jailPrefix() {
  return ["/usr/bin/unshare", "--net", "--", "/usr/bin/setpriv", "--reuid", JAIL_USER, "--regid", JAIL_USER, "--clear-groups", "--no-new-privs", "/usr/bin/env", `BOT_CANARY=${CANARY}`, "NODE_ENV=production", `PATH=${process.env.PATH}`];
}

class Worker {
  constructor(pool) {
    this.pool = pool;
    this.busy = false;
    this.currentJob = null;
    this.spawn();
  }

  spawn() {
    // Deliberately minimal env — a bot-runner worker has no business
    // seeing the main app's secrets (JWT signing key, DB paths, etc.),
    // whether or not the sandbox itself ever leaks them. This is an
    // application-level step toward the "secrets" isolation layer in the
    // design doc; the stronger OS-level version (separate unprivileged
    // user, cgroups, no network route) is a deployment-time task, not
    // something this Node code can do to itself — see the README this
    // module ships next to.
    this.jailed = jailEnabled();
    if (this.jailed) {
      this.child = spawn("sudo", ["-n", ...jailPrefix(), process.execPath, RUNNER_ENTRY], { stdio: ["pipe", "pipe", "pipe"] });
      let buf = "";
      this.child.stdout.setEncoding("utf8");
      this.child.stdout.on("data", (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          try {
            this.handleMessage(JSON.parse(line));
          } catch {
            /* not protocol output; ignore */
          }
        }
      });
      this.child.stderr.on("data", (d) => process.stderr.write(`[bot-worker ${this.child.pid}] ${scrubText(d, { max: 2000 })}\n`));
      this.child.on("exit", (code, signal) => this.handleExit(code, signal));
      return;
    }
    this.child = fork(RUNNER_ENTRY, [], {
      env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV || "production", BOT_CANARY: CANARY },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    this.child.stdout.on("data", (d) => process.stdout.write(`[bot-worker ${this.child.pid}] ${d}`));
    this.child.stderr.on("data", (d) => process.stderr.write(`[bot-worker ${this.child.pid}] ${d}`));
    this.child.on("error", () => {});
    this.child.on("message", (msg) => this.handleMessage(msg));
    this.child.on("exit", (code, signal) => this.handleExit(code, signal));
  }

  handleMessage(msg) {
    if (!msg || msg.type === "ready") return;
    const job = this.currentJob;
    if (!job || msg.jobId !== job.jobId) return; // stale or unexpected — ignore
    let result = msg.result;
    const mustRetire = !!(msg.retire || (result && result.canary));
    if (result && result.canary) {
      // Something reached the runner's environment: switch that language off.
      killSwitch.disableLanguage(job.language, "canary token seen in bot output");
      audit.record("canary_tripped", { language: job.language });
      result = { ok: false, reason: "Internal sandbox error — move forfeited." };
    }
    if (mustRetire) return this.retireWith(result);
    this.finishJob(result);
  }

  // Kill this worker, resolve its job, and replace it with a fresh one
  // BEFORE any queued job can be handed to it (a dying worker would turn the
  // next job into an EPIPE).
  retireWith(result) {
    const job = this.currentJob;
    this.dead = true;
    this.child.removeAllListeners("exit");
    this.child.on("error", () => {});
    try {
      this.child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
    if (job) {
      clearTimeout(job.timer);
      this.currentJob = null;
      this.busy = false;
      job.resolve(result);
    }
    this.pool.replaceWorker(this);
  }

  send(msg) {
    try {
      if (this.jailed) this.child.stdin.write(JSON.stringify(msg) + "\n");
      else this.child.send(msg);
    } catch {
      /* the exit handler resolves the job */
    }
  }

  handleExit(code, signal) {
    const job = this.currentJob;
    if (job) {
      this.finishJob({ ok: false, reason: `Bot runner worker exited unexpectedly (code=${code}, signal=${signal}).` });
    }
    this.pool.replaceWorker(this); // always respawn so the pool stays at full size
  }

  finishJob(result) {
    const job = this.currentJob;
    if (!job) return;
    clearTimeout(job.timer);
    this.currentJob = null;
    this.busy = false;
    job.resolve(result);
    this.pool.onWorkerFree();
  }

  runJob(job) {
    this.busy = true;
    this.currentJob = job;
    const deadlineMs = (job.limits && job.limits.deadlineMs) || DEFAULT_DEADLINE_MS;
    job.timer = setTimeout(() => {
      // Didn't reply even with slack beyond its own internal deadline —
      // assume it's wedged, not just slow, and kill it outright.
      this.retireWith({ ok: false, reason: "Bot runner worker did not respond in time (killed)." });
    }, deadlineMs + OUTER_TIMEOUT_SLACK_MS);
    this.send({ type: "run", jobId: job.jobId, language: job.language, code: job.code, state: job.state, limits: job.limits, seed: job.seed });
  }
}

class RunnerPool {
  constructor(size) {
    this.size = size;
    this.workers = [];
    this.queue = [];
    for (let i = 0; i < size; i++) this.workers.push(new Worker(this));
  }

  replaceWorker(deadWorker) {
    const idx = this.workers.indexOf(deadWorker);
    if (idx !== -1) this.workers[idx] = new Worker(this);
    this.drainQueue();
  }

  onWorkerFree() {
    this.drainQueue();
  }

  drainQueue() {
    if (this.queue.length === 0) return;
    const free = this.workers.find((w) => !w.busy);
    if (!free) return;
    const job = this.queue.shift();
    free.runJob(job);
  }

  run({ code, state, limits, seed, language }) {
    return new Promise((resolve) => {
      const job = { jobId: crypto.randomUUID(), language: language || "javascript", code, state, limits, seed, resolve };
      const free = this.workers.find((w) => !w.busy);
      if (free) {
        free.runJob(job);
      } else {
        this.queue.push(job);
      }
    });
  }

  get stats() {
    return {
      poolSize: this.size,
      busy: this.workers.filter((w) => w.busy).length,
      queued: this.queue.length,
    };
  }

  // Cleanly shuts down every worker process in the pool. Used by tests
  // and graceful-shutdown handling so forked children never linger.
  destroyAll() {
    for (const w of this.workers) {
      try {
        w.child.removeAllListeners();
        w.child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
    this.workers = [];
    this.queue = [];
  }
}

let pool = null;
function getPool() {
  if (!pool) pool = new RunnerPool(POOL_SIZE);
  return pool;
}

/**
 * The single entry point every bot execution should go through — see the
 * file header. Never throws for a bot-caused failure; only refuses outright
 * if the kill switch is off.
 *
 * @param {{code: string, state: object, limits?: object}} args
 * @returns {Promise<{ok: true, move: string, elapsedMs?: number} | {ok: false, reason: string}>}
 */
async function runBotMove({ code, state, limits, seed, language = "javascript" }) {
  if (!killSwitch.isEnabled()) {
    return { ok: false, reason: "Bot execution is currently disabled." };
  }
  if (!killSwitch.isLanguageEnabled(language)) {
    return { ok: false, reason: `Bot execution for ${language} is currently disabled.` };
  }
  return getPool().run({ code, state, limits, seed, language });
}

function shutdownPool() {
  if (pool) {
    pool.destroyAll();
    pool = null;
  }
}

module.exports = { runBotMove, getPool, shutdownPool };
