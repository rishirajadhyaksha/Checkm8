const { LuaFactory, LuaLibraries } = require("wasmoon");
(async () => {
  const factory = new LuaFactory();
  const lua = await factory.createEngine({ openStandardLibs: false });
  console.log(Object.keys(LuaLibraries));
  lua.global.loadLibrary(LuaLibraries.Base);
  lua.global.loadLibrary(LuaLibraries.Table);
  lua.global.loadLibrary(LuaLibraries.String);
  lua.global.loadLibrary(LuaLibraries.Math);
  console.log(typeof lua.global.setMemoryMax);
  lua.global.set("__chess", (s) => JSON.stringify({ ok: true, r: s }));
  console.log(await lua.doString("return type(os), type(io), type(require), type(load), type(dofile), type(debug), type(string.rep)"));
  console.log(await lua.doString("return __chess('x')"));
  lua.global.close();
})();
