// server/src/bots/librarySpec.js — the single source of truth for the bot
// chess library. The server-side validator (bridge.js), the docs panel, the
// editor autocomplete/hover text and the TypeScript declarations are all
// generated from this one list. Adding a method = adding one entry here and
// one implementation in library.js.
//
// Names are camelCase (JavaScript/TypeScript); Python and Lua use the
// snake_case form of the same name. Moves are UCI strings ("e2e4", "e7e8q").

const T = { FEN: "fen", MOVE: "move", SQUARE: "square", COLOR: "color", PIECE: "piece" };

const METHODS = [
  // ---- Moves ----
  { name: "getLegalMoves", category: "Moves", args: [["fen", T.FEN]], returns: "string[]", description: "All legal moves in the position, as UCI strings." },
  { name: "getMovesFrom", category: "Moves", args: [["fen", T.FEN], ["square", T.SQUARE]], returns: "string[]", description: "Legal moves for the piece standing on one square." },
  { name: "getCaptureMoves", category: "Moves", args: [["fen", T.FEN]], returns: "string[]", description: "Legal moves that capture a piece (including en passant)." },
  { name: "makeMove", category: "Moves", args: [["fen", T.FEN], ["move", T.MOVE]], returns: "string | null", description: "Plays a move and returns the resulting FEN, or null if the move is illegal. Does not change the original position." },
  { name: "isLegal", category: "Moves", args: [["fen", T.FEN], ["move", T.MOVE]], returns: "boolean", description: "Whether a move is legal in this position." },
  { name: "toSan", category: "Moves", args: [["fen", T.FEN], ["move", T.MOVE]], returns: "string | null", description: "A move in standard algebraic notation, such as Nf3. Null if the move is illegal." },
  // ---- Position ----
  { name: "getTurn", category: "Position", args: [["fen", T.FEN]], returns: '"w" | "b"', description: "The side to move." },
  { name: "getPiece", category: "Position", args: [["fen", T.FEN], ["square", T.SQUARE]], returns: "{type, color} | null", description: "The piece on a square, or null if it is empty." },
  { name: "getBoard", category: "Position", args: [["fen", T.FEN]], returns: "(Piece | null)[][]", description: "All 64 squares as an 8x8 grid, rank 8 first. Each cell is {type, color} or null." },
  { name: "hashPosition", category: "Position", args: [["fen", T.FEN]], returns: "number", description: "A stable integer hash of the position (placement, turn, castling, en passant). Useful for transposition tables." },
  // ---- Pieces ----
  { name: "getPieces", category: "Pieces", args: [["fen", T.FEN], ["color", T.COLOR]], returns: "{type, color, square}[]", description: "Every piece of one color, with its square." },
  { name: "getKingSquare", category: "Pieces", args: [["fen", T.FEN], ["color", T.COLOR]], returns: "string | null", description: "The square a king stands on." },
  { name: "getMaterial", category: "Pieces", args: [["fen", T.FEN]], returns: "{w: number, b: number}", description: "Material count per side using 1, 3, 3, 5, 9." },
  { name: "pieceValue", category: "Pieces", args: [["piece", T.PIECE]], returns: "number", description: "Standard value of a piece type (p=1, n=3, b=3, r=5, q=9, k=0)." },
  // ---- Tactics ----
  { name: "isCheck", category: "Tactics", args: [["fen", T.FEN]], returns: "boolean", description: "The side to move is in check." },
  { name: "isCheckmate", category: "Tactics", args: [["fen", T.FEN]], returns: "boolean", description: "The side to move is checkmated." },
  { name: "isStalemate", category: "Tactics", args: [["fen", T.FEN]], returns: "boolean", description: "The side to move is stalemated." },
  { name: "isDraw", category: "Tactics", args: [["fen", T.FEN]], returns: "boolean", description: "Draw by the fifty-move rule, insufficient material, stalemate, or repetition." },
  { name: "isGameOver", category: "Tactics", args: [["fen", T.FEN]], returns: "boolean", description: "Checkmate or any kind of draw." },
  { name: "isCapture", category: "Tactics", args: [["fen", T.FEN], ["move", T.MOVE]], returns: "boolean", description: "Whether a legal move captures (including en passant)." },
  { name: "isPromotion", category: "Tactics", args: [["fen", T.FEN], ["move", T.MOVE]], returns: "boolean", description: "Whether a legal move promotes a pawn." },
  { name: "givesCheck", category: "Tactics", args: [["fen", T.FEN], ["move", T.MOVE]], returns: "boolean", description: "Whether playing the move puts the opponent in check." },
  { name: "getAttackers", category: "Tactics", args: [["fen", T.FEN], ["square", T.SQUARE], ["color", T.COLOR]], returns: "string[]", description: "Squares of the pieces of that color that attack the given square." },
  { name: "isSquareAttacked", category: "Tactics", args: [["fen", T.FEN], ["square", T.SQUARE], ["color", T.COLOR]], returns: "boolean", description: "Whether that color attacks the given square." },
];

// Always-available helpers that are not chess-library calls.
const UTILITIES = [
  { name: "random", category: "Utility", args: [], returns: "number", description: "A seeded random number in [0, 1). Use this instead of the language's own random so matches stay replayable." },
  { name: "log", category: "Utility", args: [["...values", "any"]], returns: "void", description: "Writes a line to the Output tab (print / console.log do the same). Output is capped at 4 KB." },
];

const toSnake = (s) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

function nameFor(method, language) {
  return language === "python" || language === "lua" ? toSnake(method.name) : method.name;
}

const SAMPLE = { fen: '"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"', move: '"e2e4"', square: '"e2"', color: '"w"', piece: '"q"' };

function exampleFor(method, language) {
  const args = method.args.map(([, t]) => SAMPLE[t]).join(", ");
  const n = nameFor(method, language);
  if (language === "python") return `chess.${n}(${args})`;
  if (language === "lua") return `chess.${n}(${args})`;
  return `chess.${n}(${args})`;
}

const TS_RETURNS = {
  getLegalMoves: "string[]", getMovesFrom: "string[]", getCaptureMoves: "string[]", makeMove: "string | null", isLegal: "boolean",
  toSan: "string | null", getTurn: '"w" | "b"', getPiece: "Piece | null", getBoard: "(Piece | null)[][]", hashPosition: "number",
  getPieces: "PieceOnSquare[]", getKingSquare: "string | null", getMaterial: "{ w: number; b: number }", pieceValue: "number",
  isCheck: "boolean", isCheckmate: "boolean", isStalemate: "boolean", isDraw: "boolean", isGameOver: "boolean", isCapture: "boolean",
  isPromotion: "boolean", givesCheck: "boolean", getAttackers: "string[]", isSquareAttacked: "boolean",
};
const TS_ARG = { fen: "string", move: "string", square: "string", color: '"w" | "b"', piece: "string" };

const LANGUAGES = ["javascript", "typescript", "python", "lua"];

function buildSpec() {
  const methods = METHODS.map((m) => ({
    name: m.name,
    snakeName: toSnake(m.name),
    category: m.category,
    args: m.args.map(([name, type]) => ({ name, type })),
    returns: m.returns,
    tsReturns: TS_RETURNS[m.name] || "any",
    args_ts: m.args.map(([name, type]) => `${name}: ${TS_ARG[type]}`).join(", "),
    description: m.description,
    examples: Object.fromEntries(LANGUAGES.map((l) => [l, exampleFor(m, l)])),
  }));
  return { version: 1, methods, utilities: UTILITIES, limits: { maxCallsPerMove: 5000, maxArgChars: 200 } };
}

module.exports = { METHODS, UTILITIES, buildSpec, toSnake, T };
