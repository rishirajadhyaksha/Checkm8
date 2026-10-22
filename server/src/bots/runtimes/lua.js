// server/src/bots/runtimes/lua.js — Lua 5.4 (wasmoon, WebAssembly) with a
// whitelist of standard libraries: base (minus load/dofile/require/...),
// table, string, math. os, io, debug, package and coroutine are never opened.
// Lua cannot interrupt itself mid-loop, so the outer timeout in
// runnerPool.js is the real wall-clock enforcement for this runtime.
const { METHODS } = require("../librarySpec");
const { snake, snakeKeys } = require("./util");

let factoryPromise = null;
async function getFactory() {
  if (!factoryPromise) factoryPromise = import("wasmoon").then((m) => ({ m, factory: new m.LuaFactory() }));
  return factoryPromise;
}

const DEFAULT_MEMORY = 16 * 1024 * 1024;

const PRELUDE = `
local host = __chess
__chess = nil
local sbyte, schar, sfind, ssub, sformat, concat = string.byte, string.char, string.find, string.sub, string.format, table.concat

local function jenc(v)
  local t = type(v)
  if t == "nil" then return "null"
  elseif t == "boolean" then return tostring(v)
  elseif t == "number" then return sformat("%.14g", v)
  elseif t == "string" then
    return '"' .. v:gsub('[%c"\\\\]', function(c) return sformat("\\\\u%04x", sbyte(c)) end) .. '"'
  elseif t == "table" then
    local n = #v
    local parts = {}
    if n > 0 then
      for i = 1, n do parts[i] = jenc(v[i]) end
      return "[" .. concat(parts, ",") .. "]"
    end
    for k, x in pairs(v) do parts[#parts + 1] = jenc(tostring(k)) .. ":" .. jenc(x) end
    return "{" .. concat(parts, ",") .. "}"
  end
  error("cannot encode " .. t)
end

local function jdec(s)
  local pos = 1
  local function ws() pos = sfind(s, "[^ \\t\\r\\n]", pos) or #s + 1 end
  local value
  local function str()
    local out, i = {}, pos + 1
    while true do
      local c = ssub(s, i, i)
      if c == '"' then pos = i + 1; return concat(out)
      elseif c == "\\\\" then
        local n = ssub(s, i + 1, i + 1)
        if n == "u" then
          local code = tonumber(ssub(s, i + 2, i + 5), 16)
          out[#out + 1] = code < 128 and schar(code) or utf8 and "?" or "?"
          i = i + 6
        else
          local map = { n = "\\n", t = "\\t", r = "\\r", b = "\\b", f = "\\f" }
          out[#out + 1] = map[n] or n
          i = i + 2
        end
      elseif c == "" then error("bad json")
      else out[#out + 1] = c; i = i + 1 end
    end
  end
  function value()
    ws()
    local c = ssub(s, pos, pos)
    if c == "{" then
      local obj = {}
      pos = pos + 1; ws()
      if ssub(s, pos, pos) == "}" then pos = pos + 1; return obj end
      while true do
        ws(); local k = str(); ws(); pos = pos + 1
        local v = value()
        obj[k] = v
        ws()
        local d = ssub(s, pos, pos); pos = pos + 1
        if d == "}" then return obj end
      end
    elseif c == "[" then
      local arr, n = {}, 0
      pos = pos + 1; ws()
      if ssub(s, pos, pos) == "]" then pos = pos + 1; return arr end
      while true do
        local v = value()
        n = n + 1
        if v == nil then v = false end
        arr[n] = v
        ws()
        local d = ssub(s, pos, pos); pos = pos + 1
        if d == "]" then return arr end
      end
    elseif c == '"' then return str()
    elseif ssub(s, pos, pos + 3) == "true" then pos = pos + 4; return true
    elseif ssub(s, pos, pos + 4) == "false" then pos = pos + 5; return false
    elseif ssub(s, pos, pos + 3) == "null" then pos = pos + 4; return nil
    else
      local num = s:match("^-?%d+%.?%d*[eE]?[+-]?%d*", pos)
      pos = pos + #num
      return tonumber(num)
    end
  end
  return value()
end

local function call(op, ...)
  local r = jdec(host(jenc({ op = op, args = { ... } })))
  if not r.ok then error(r.error, 3) end
  return r.result
end

chess = {}
local names = NAMES_TABLE
for i = 1, #names do
  local camel, snakeName = names[i][1], names[i][2]
  chess[snakeName] = function(...) return call(camel, ...) end
end
log = function(...)
  local t = {}
  for i, v in ipairs({ ... }) do t[i] = tostring(v) end
  call("log", concat(t, " "))
end
print = log
random = function() return call("random") end
math.random = function(m, n)
  local r = call("random")
  if m == nil then return r end
  if n == nil then return math.floor(r * m) + 1 end
  return math.floor(r * (n - m + 1)) + m
end
math.randomseed = function() end
-- remove everything that can load or inspect code
load, loadstring, dofile, loadfile, require, collectgarbage, getmetatable, setmetatable, rawget, rawset, rawequal, rawlen = nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil
string.dump = nil

__run = function()
  return choose_move(jdec(__state_json))
end
`;

function buildPrelude() {
  const names = "{" + METHODS.map((m) => `{"${m.name}","${snake(m.name)}"}`).join(",") + "}";
  return PRELUDE.replace("NAMES_TABLE", names);
}

async function run({ code, state, limits = {}, bridge }) {
  const { m, factory } = await getFactory();
  const lua = await factory.createEngine({ openStandardLibs: false, injectObjects: false, traceAllocations: true });
  const startedAt = Date.now();
  const logs = [];
  try {
    for (const lib of [m.LuaLibraries.Base, m.LuaLibraries.Table, m.LuaLibraries.String, m.LuaLibraries.Math]) {
      lua.global.loadLibrary(lib);
    }
    lua.global.setMemoryMax(limits.memoryLimitBytes || DEFAULT_MEMORY);
    lua.global.set("__chess", (req) => bridge.handle(String(req)));
    lua.global.set("__state_json", JSON.stringify(snakeKeys(state)));
    try {
      await lua.doString(buildPrelude());
    } catch (e) {
      return { ok: false, reason: "Internal sandbox error — move forfeited." };
    }
    try {
      await lua.doString(code);
    } catch (e) {
      return { ok: false, reason: `Bot threw an error: ${shortErr(e)}` };
    }
    let move;
    try {
      move = await lua.doString("if type(choose_move) ~= 'function' then error('choose_move(state) must be defined as a function.') end return __run()");
    } catch (e) {
      return { ok: false, reason: describe(e) };
    }
    if (typeof move !== "string" || !move) return { ok: false, reason: "choose_move(state) must return a non-empty move string." };
    return { ok: true, move, elapsedMs: Date.now() - startedAt };
  } finally {
    try {
      lua.global.close();
    } catch {
      /* ignore */
    }
  }
}

function shortErr(e) {
  return String((e && e.message) || e).split("\n")[0].slice(0, 300);
}
function describe(e) {
  const msg = shortErr(e);
  if (/memory/i.test(msg)) return "Bot exceeded its memory limit.";
  return `Bot threw an error: ${msg}`;
}

module.exports = { run, buildPrelude };
