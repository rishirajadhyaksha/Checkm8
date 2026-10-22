// server/test/bots.test.js — Bot Arena, Phase 0
//
// Covers the actual security-critical properties of the sandbox pipeline:
// normal execution works, disallowed source is rejected before it ever
// runs, and a bot cannot escape its resource limits (time, memory) no
// matter how it misbehaves. Also covers that a worker crash is contained
// and the pool recovers — see the note in runnerPool.js about the
// recursion-triggered abort this suite is built to guard against
// regressing on.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { checkSource } = require("../src/bots/staticFilter");
const { runBotMoveInSandbox } = require("../src/bots/sandbox");
const { runBotMove, getPool, shutdownPool } = require("../src/bots/runnerPool");

const STATE = {
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  legalMoves: ["e2e4", "e2e3", "g1f3"],
  turn: "w",
  timeRemainingMs: 60_000,
  incrementMs: 0,
  history: [],
};

test("staticFilter: accepts a plain valid bot", () => {
  const result = checkSource("function chooseMove(state) { return state.legalMoves[0]; }");
  assert.equal(result.ok, true);
});

test("staticFilter: rejects fetch, require, eval, process, globalThis, await", () => {
  const badSamples = [
    "function chooseMove(s){ fetch('http://evil.example'); return s.legalMoves[0]; }",
    "function chooseMove(s){ const fs = require('fs'); return s.legalMoves[0]; }",
    "function chooseMove(s){ eval('1+1'); return s.legalMoves[0]; }",
    "function chooseMove(s){ return process.env.SECRET; }",
    "function chooseMove(s){ return typeof globalThis; }",
    "async function chooseMove(s){ await 1; return s.legalMoves[0]; }",
  ];
  for (const src of badSamples) {
    const result = checkSource(src);
    assert.equal(result.ok, false, `expected rejection for: ${src}`);
  }
});

test("staticFilter: rejects missing chooseMove and oversized source", () => {
  assert.equal(checkSource("function notChooseMove(){ return 1; }").ok, false);
  assert.equal(checkSource("function chooseMove(s){ return " + "'a'.repeat(30000)" + "; }" + "x".repeat(21000)).ok, false);
});

test("sandbox: runs a normal bot and returns its move", async () => {
  const result = await runBotMoveInSandbox({
    code: "function chooseMove(state) { return state.legalMoves[0]; }",
    state: STATE,
  });
  assert.equal(result.ok, true);
  assert.equal(result.move, "e2e4");
});

test("sandbox: has no process/require/fetch global available at runtime", async () => {
  const result = await runBotMoveInSandbox({
    code: "function chooseMove(state) { return (typeof process) + ',' + (typeof require) + ',' + (typeof fetch); }",
    state: STATE,
  });
  assert.equal(result.ok, true);
  assert.equal(result.move, "undefined,undefined,undefined");
});

test("sandbox: rejects a non-string / missing move", async () => {
  const r1 = await runBotMoveInSandbox({ code: "function chooseMove(){ return 42; }", state: STATE });
  assert.equal(r1.ok, false);
  const r2 = await runBotMoveInSandbox({ code: "function notChooseMove(){ return 'e2e4'; }", state: STATE });
  assert.equal(r2.ok, false);
});

test("sandbox: kills an infinite loop at the deadline, doesn't hang", async () => {
  const start = Date.now();
  const result = await runBotMoveInSandbox({
    code: "function chooseMove(state) { while(true) {} }",
    state: STATE,
    limits: { deadlineMs: 300 },
  });
  const elapsed = Date.now() - start;
  assert.equal(result.ok, false);
  assert.ok(elapsed < 1000, `expected the sandbox to cut the bot off quickly, took ${elapsed}ms`);
});

test("sandbox: enforces the memory limit on a bot that allocates unboundedly", async () => {
  const result = await runBotMoveInSandbox({
    code: "function chooseMove(state) { var a=[]; while(true){ a.push(new Array(1e6).fill(1)); } }",
    state: STATE,
    limits: { deadlineMs: 2000, memoryLimitBytes: 4 * 1024 * 1024 },
  });
  assert.equal(result.ok, false);
});

test("runnerPool: a crash-inducing bot resolves as a clean forfeit, pool recovers", async () => {
  const before = getPool().stats;
  assert.ok(before.poolSize >= 1);

  const crashResult = await runBotMove({
    code: "function chooseMove(state) { function r(n){ return r(n+1); } return r(0); }",
    state: STATE,
    limits: { deadlineMs: 1500 },
  });
  assert.equal(crashResult.ok, false);

  // The pool should still work normally right after replacing that worker.
  const after = await runBotMove({
    code: "function chooseMove(state) { return state.legalMoves[1]; }",
    state: STATE,
  });
  assert.equal(after.ok, true);
  assert.equal(after.move, "e2e3");
});

test("runnerPool: several concurrent jobs all resolve correctly", async () => {
  const jobs = Array.from({ length: 6 }, (_, i) =>
    runBotMove({ code: `function chooseMove(state){ return state.legalMoves[${i % 3}]; }`, state: STATE })
  );
  const results = await Promise.all(jobs);
  for (const r of results) assert.equal(r.ok, true);
});

// Shut down every forked worker process the pool spawned during these
// tests so `node --test` can exit cleanly instead of hanging on them.
test.after(() => {
  shutdownPool();
});
