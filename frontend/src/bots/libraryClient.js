// Client-side access to the bot library spec + helpers that turn it into
// signatures, snippets and TypeScript declarations. The server owns the spec
// (GET /bots/library-spec); everything here is derived from it.
import { api } from "../api";

let cache = null;
export function loadLabData() {
  if (!cache) {
    cache = Promise.all([api.botLibrarySpec(), api.botLanguages(), api.botTemplates(), api.botPreludes()])
      .then(([spec, languages, templates, preludes]) => ({ spec, languages, templates, preludes }))
      .catch((err) => {
        cache = null;
        throw err;
      });
  }
  return cache;
}

export const isSnake = (language) => language === "python" || language === "lua";
export const methodName = (m, language) => (isSnake(language) ? m.snakeName : m.name);

export function signature(m, language) {
  const args = m.args.map((a) => a.name).join(", ");
  if (language === "typescript") return `chess.${m.name}(${m.args_ts}): ${m.tsReturns}`;
  return `chess.${methodName(m, language)}(${args})`;
}

export function utilitySignature(u) {
  return `${u.name}(${u.args.map((a) => a.name).join(", ")})`;
}

export function snippetFor(m, language) {
  const args = m.args.map((a, i) => "${" + (i + 1) + ":" + a.name + "}").join(", ");
  return `chess.${methodName(m, language)}(${args})`;
}

export function plainCallFor(m, language) {
  return `chess.${methodName(m, language)}(${m.args.map((a) => a.name).join(", ")})`;
}

// TypeScript declarations for Monaco's addExtraLib: gives real type checking
// and completions for chess.* and the State object.
export function typescriptDeclarations(spec) {
  const lines = [
    'type Color = "w" | "b";',
    "interface Piece { type: string; color: Color }",
    "interface PieceOnSquare extends Piece { square: string }",
    "interface State { fen: string; legalMoves: string[]; turn: Color; timeRemainingMs: number; incrementMs: number; history: string[] }",
    "declare const chess: {",
    ...spec.methods.map((m) => `  /** ${m.description} */\n  ${m.name}(${m.args_ts}): ${m.tsReturns};`),
    "};",
    "/** Seeded random number in [0, 1). Use instead of Math.random so matches are replayable. */",
    "declare function random(): number;",
    "/** Writes a line to the Output tab. */",
    "declare function log(...values: any[]): void;",
  ];
  return lines.join("\n");
}

// A tiny bot that calls one library method against a position and logs the
// result — powers the docs panel's "Try it" button.
export function tryItCode(m, language, { fen, turn, firstMove }) {
  const val = (type) => ({ fen: JSON.stringify(fen), move: JSON.stringify(firstMove), square: JSON.stringify(firstMove.slice(0, 2)), color: JSON.stringify(turn), piece: '"q"' }[type]);
  const args = m.args.map((a) => val(a.type)).join(", ");
  const call = `chess.${methodName(m, language)}(${args})`;
  if (language === "python") {
    return `import json\ndef choose_move(state):\n    log(json.dumps(${call}))\n    return state["legal_moves"][0]\n`;
  }
  if (language === "lua") {
    return [
      "local function show(v)",
      "  if type(v) ~= 'table' then return tostring(v) end",
      "  local parts = {}",
      "  if #v > 0 then for i = 1, #v do parts[i] = show(v[i]) end return '[' .. table.concat(parts, ', ') .. ']' end",
      "  for k, x in pairs(v) do parts[#parts + 1] = k .. '=' .. show(x) end",
      "  return '{' .. table.concat(parts, ', ') .. '}'",
      "end",
      `function choose_move(state) log(show(${call})) return state.legal_moves[1] end`,
      "",
    ].join("\n");
  }
  return `function chooseMove(state) {\n  log(JSON.stringify(${call}));\n  return state.legalMoves[0];\n}\n`;
}

export const SAMPLE_POSITIONS = {
  start: { label: "Starting position", fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" },
  "scholars-mate-setup": { label: "Mid-opening", fen: "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR b KQkq - 4 3" },
  endgame_kp: { label: "K+P endgame", fen: "8/8/8/4k3/4P3/4K3/8/8 w - - 0 1" },
};
