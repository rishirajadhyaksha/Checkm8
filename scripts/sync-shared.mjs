// Copies server/src/bots/library.js into the frontend as an ESM module so the
// in-browser runner uses exactly the same chess library as the server.
// Run from the repo root: node scripts/sync-shared.mjs
import fs from "node:fs";
let s = fs.readFileSync("server/src/bots/library.js", "utf8");
s = s.replace('const { Chess } = require("chess.js");', 'import { Chess } from "chess.js";');
s = s.replace("module.exports = { createLibrary };", "export { createLibrary };");
s = s.replace("// server/src/bots/library.js — host-side", "// frontend/src/bots/shared/library.js — GENERATED COPY of server/src/bots/library.js\n// (ESM). Do not edit here: change the server file and run `node scripts/sync-shared.mjs`.\n// host-side");
fs.writeFileSync("frontend/src/bots/shared/library.js", s);
console.log("synced frontend/src/bots/shared/library.js");
