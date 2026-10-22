// server/src/bots/runtimes/micropython.js — Python via MicroPython compiled
// to WebAssembly. BETA: this is the weakest of the sandbox boundaries,
// because MicroPython ships a built-in "js" module that can see the host's
// globals. Defenses, in order: (1) the host never registers a real "js"
// module reachable from user code — only a tiny "chesshost" module that
// the prelude captures in a closure; (2) a replaced __import__ whitelist
// (math, json, random, collections, chess); (3) eval/exec/compile/open/
// input replaced; (4) nothing sensitive in globals (the prelude runs inside
// a function so sys/builtins/chesshost never land in __main__); (5) the
// static filter in staticFilter.js; (6) the runner process's OS jail.
// Python cannot interrupt itself, so the outer timeout in runnerPool.js is
// the real wall-clock limit.
const { METHODS } = require("../librarySpec");
const { snake, snakeKeys, MAX_LOG_BYTES } = require("./util");

let loaderPromise = null;
function getLoader() {
  if (!loaderPromise) {
    loaderPromise = import("@micropython/micropython-webassembly-pyscript/micropython.mjs").then((m) => m.loadMicroPython);
  }
  return loaderPromise;
}

function buildPrelude() {
  const pairs = METHODS.map((m) => `("${m.name}", "${snake(m.name)}")`).join(", ");
  return `
def _setup():
    import builtins, sys, json, chesshost
    class _Chess:
        pass
    ch = _Chess()
    def _call(op, *args):
        r = json.loads(chesshost.call(json.dumps({"op": op, "args": list(args)})))
        if not r["ok"]:
            raise ValueError(r["error"])
        return r["result"]
    def _mk(camel):
        def f(*a):
            return _call(camel, *a)
        return f
    for camel, snk in (${pairs}):
        setattr(ch, snk, _mk(camel))

    class _Random:
        def random(self):
            return _call("random")
        def randint(self, a, b):
            return a + int(_call("random") * (b - a + 1))
        def randrange(self, a, b=None):
            if b is None:
                a, b = 0, a
            return a + int(_call("random") * (b - a))
        def choice(self, seq):
            return seq[int(_call("random") * len(seq))]
        def shuffle(self, seq):
            for i in range(len(seq) - 1, 0, -1):
                j = int(_call("random") * (i + 1))
                seq[i], seq[j] = seq[j], seq[i]
        def uniform(self, a, b):
            return a + (b - a) * _call("random")
        def seed(self, *a):
            pass
    rnd = _Random()

    def _blocked(*a, **k):
        raise ImportError("this builtin is not allowed")
    real = builtins.__import__
    allowed = ("math", "umath", "json", "ujson", "random", "chess", "collections", "ucollections")
    def guard(name, *a, **k):
        if name.split(".")[0] not in allowed:
            raise ImportError("import of '%s' is not allowed" % name)
        return real(name, *a, **k)
    sys.modules["chess"] = ch
    sys.modules["random"] = rnd
    for n in ("eval", "exec", "compile", "open", "input"):
        setattr(builtins, n, _blocked)
    builtins.__import__ = guard

    state = json.loads(chesshost.state)
    def run():
        return choose_move(state)
    def logf(*a):
        _call("log", " ".join([str(x) for x in a]))
    return ch, rnd, run, logf

chess, random, _run, log = _setup()
del _setup
`;
}

async function run({ code, state, limits = {}, bridge }) {
  const loadMicroPython = await getLoader();
  const startedAt = Date.now();
  const out = [];
  let outBytes = 0;
  const mp = await loadMicroPython({
    heapsize: limits.memoryLimitBytes || 8 * 1024 * 1024,
    stdout: (s) => {
      if (outBytes + s.length <= MAX_LOG_BYTES) {
        outBytes += s.length;
        out.push(s);
      }
    },
    stderr: () => {},
  });
  mp.registerJsModule("chesshost", { call: (req) => bridge.handle(String(req)), state: JSON.stringify(snakeKeys(state)) });
  try {
    mp.runPython(buildPrelude());
  } catch (e) {
    return { ok: false, reason: "Internal sandbox error — move forfeited." };
  }
  try {
    mp.runPython(code);
  } catch (e) {
    return { ok: false, reason: `Bot threw an error: ${pyErr(e)}` };
  }
  try {
    mp.runPython(
      "if 'choose_move' not in globals():\n    raise NameError('choose_move(state) must be defined as a function.')\n__move = _run()"
    );
  } catch (e) {
    return { ok: false, reason: describe(e) };
  }
  const move = mp.globals.get("__move");
  if (typeof move !== "string" || !move) return { ok: false, reason: "choose_move(state) must return a non-empty move string." };
  return { ok: true, move, elapsedMs: Date.now() - startedAt, stdout: out.join("") };
}

function pyErr(e) {
  const lines = String((e && e.message) || e).trim().split("\n");
  return lines[lines.length - 1].slice(0, 300);
}
function describe(e) {
  const msg = pyErr(e);
  if (/MemoryError|memory/i.test(msg)) return "Bot exceeded its memory limit.";
  return `Bot threw an error: ${msg}`;
}

module.exports = { run, buildPrelude };
