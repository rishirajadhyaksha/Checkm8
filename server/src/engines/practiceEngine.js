// engines/practiceEngine.js — Section 10.4
//
// This is a PLACEHOLDER engine. It is intentionally simple and intentionally
// weak. Swap out the body of `chooseMove` with any strategy you like —
// it just needs to return one move from the `legalMoves` array it's given.
//
// Ideas to try:
//   - Prefer moves that capture the opponent's most valuable piece
//   - Prefer moves that give check
//   - Add a tiny 1-ply material-count lookahead
//   - Weight move choice by a difficulty "temperature" you expose as a setting

const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function chooseMove(chessJsGame) {
  const legalMoves = chessJsGame.moves({ verbose: true });

  // --- PLACEHOLDER STRATEGY (edit me!) ---
  // Very weak on purpose: mostly random, with a slight, easily-defeated bias
  // toward capturing whatever's the most valuable piece it can take for free.
  const captures = legalMoves.filter((m) => m.captured);
  if (captures.length > 0 && Math.random() < 0.5) {
    captures.sort((a, b) => PIECE_VALUES[b.captured] - PIECE_VALUES[a.captured]);
    return captures[0];
  }
  return legalMoves[Math.floor(Math.random() * legalMoves.length)];
  // --- END PLACEHOLDER STRATEGY ---
}

module.exports = { chooseMove };
