const test = require("node:test");
const assert = require("node:assert");
const { applyMoveClock, checkFlag, computeCurrentTimes, FLAG_GRACE_MS } = require("../src/clock");

function game(over = {}) {
  return {
    status: "active", turn: "w", timeControlMinutes: 1, incrementSeconds: 0,
    whiteTimeMs: 60000, blackTimeMs: 60000, clockStarted: true,
    turnStartServerTimestamp: Date.now(), ...over,
  };
}

test("clock does not run before the first move", () => {
  const g = game({ clockStarted: false, turnStartServerTimestamp: Date.now() - 120000 });
  assert.equal(checkFlag(g).flagged, false);
  assert.deepEqual(computeCurrentTimes(g), { whiteTimeMs: 60000, blackTimeMs: 60000 });
  const r = applyMoveClock(g, "w", 5);
  assert.equal(r.flagged, false);
  assert.equal(r.newRemaining, 60000); // no cost, no increment
  assert.equal(r.startsClock, true);
});

test("flag only after grace window", () => {
  const justPast = game({ turnStartServerTimestamp: Date.now() - (60000 + FLAG_GRACE_MS - 100) });
  assert.equal(checkFlag(justPast).flagged, false);
  const wayPast = game({ turnStartServerTimestamp: Date.now() - (60000 + FLAG_GRACE_MS + 200) });
  assert.equal(checkFlag(wayPast).flagged, true);
  assert.equal(applyMoveClock(wayPast, "w", 0).flagged, true);
});

test("move inside grace clamps to zero then adds increment", () => {
  const g = game({ turnStartServerTimestamp: Date.now() - (60000 + 100) });
  const r = applyMoveClock(g, "w", 2);
  assert.equal(r.flagged, false);
  assert.equal(r.newRemaining, 2000);
});

test("legacy games without clockStarted keep running", () => {
  const g = game({ turnStartServerTimestamp: Date.now() - 10000 });
  delete g.clockStarted;
  const t = computeCurrentTimes(g);
  assert.ok(t.whiteTimeMs <= 50100 && t.whiteTimeMs >= 49800);
});

test("computeCurrentTimes never goes below zero", () => {
  const g = game({ turnStartServerTimestamp: Date.now() - 90000 });
  assert.equal(computeCurrentTimes(g).whiteTimeMs, 0);
});
