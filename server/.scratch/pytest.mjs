import { loadMicroPython } from "@micropython/micropython-webassembly-pyscript/micropython.mjs";
const out = [];
const mp = await loadMicroPython({ heapsize: 8 * 1024 * 1024, stdout: (s) => out.push(s) });
mp.registerJsModule("chesshost", { call: (r) => JSON.stringify({ ok: true, result: 1 }), state: "{}" });
mp.runPython(`
import builtins, chesshost, sys
def _blocked(*a, **k):
    raise ImportError("blocked")
_real = builtins.__import__
_allowed = ("math", "json", "random", "chess", "collections")
def _guard(name, *a, **k):
    if name.split(".")[0] not in _allowed:
        raise ImportError("import of '%s' is not allowed" % name)
    return _real(name, *a, **k)
for n in ("eval", "exec", "compile", "open", "input"):
    try:
        setattr(builtins, n, _blocked)
    except Exception as e:
        print("cannot set", n, e)
builtins.__import__ = _guard
`);
const r = mp.runPython("1+1"); console.log("ret", r, typeof r);
const tries = [
  "import js\nprint(js)", "import os", "import sys", "print(__import__('js'))", "print(eval('1+1'))",
  "exec('print(5)')", "print(open)", "import chesshost\nprint(chesshost)", "from collections import OrderedDict\nprint('ok collections')",
  "print(globals().keys())", "print(().__class__.__bases__)", "print(sys)", "print(__builtins__)",
  "x=eval\nprint(x('2'))", "import builtins\nprint(builtins.eval)", "print(__import__)",
];
for (const t of tries) {
  out.length = 0;
  try { mp.runPython(t); console.log("RAN    ", JSON.stringify(t), "=>", out.join("").trim().slice(0,100)); }
  catch (e) { console.log("BLOCKED", JSON.stringify(t), "=>", String(e.message || e).split("\n").slice(-2).join(" | ").slice(0,100)); }
}
process.exit(0);
