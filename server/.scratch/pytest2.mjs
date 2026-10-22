import { loadMicroPython } from "@micropython/micropython-webassembly-pyscript/micropython.mjs";
const out = [];
const mp = await loadMicroPython({ heapsize: 8 * 1024 * 1024, stdout: (s) => out.push(s) });
mp.registerJsModule("chesshost", { call: (r) => JSON.stringify({ ok: true, result: 1 }), state: "{}" });
mp.runPython(`
def _setup():
    import builtins, sys, json, chesshost
    class _Chess:
        pass
    ch = _Chess()
    def _blocked(*a, **k):
        raise ImportError("blocked")
    real = builtins.__import__
    allowed = ("math", "umath", "json", "ujson", "random", "chess", "collections", "ucollections")
    def guard(name, *a, **k):
        if name.split(".")[0] not in allowed:
            raise ImportError("import of '%s' is not allowed" % name)
        return real(name, *a, **k)
    sys.modules["chess"] = ch
    for n in ("eval", "exec", "compile", "open", "input"):
        setattr(builtins, n, _blocked)
    builtins.__import__ = guard
    return ch
chess = _setup()
del _setup
`);
console.log("globals get:", typeof mp.globals.get, mp.globals.get("chess") !== undefined);
const tries = [
  "import sys", "print(sys)", "print(globals().keys())", "print(chesshost)", "print(builtins)", "print(json)",
  "import chess\nprint(chess)", "import json\nprint(json.dumps([1]))", "import math\nprint(math.sqrt(4))",
  "import collections\nprint(collections)", "x = 5",
];
for (const t of tries) {
  out.length = 0;
  try { mp.runPython(t); console.log("RAN    ", JSON.stringify(t), "=>", out.join("").trim().slice(0,160)); }
  catch (e) { console.log("BLOCKED", JSON.stringify(t), "=>", String(e.message || e).split("\n").slice(-2).join(" | ").slice(0,100)); }
}
console.log("x via globals:", mp.globals.get("x"));
process.exit(0);
