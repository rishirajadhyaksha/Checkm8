// server/src/bots/openingBook.js — Bot Arena, Phase 2
//
// "a small rotating set of standard opening positions rather than always
// from the start position (bots are expected to be deterministic given
// identical input, so without opening variation a rematch would just
// replay the same game)" — bot-arena-design.md, ladder execution flow.
// Six well-known positions, one or two plies deep, enough variety that a
// deterministic bot doesn't play the literal same game every time it's
// matched, without needing a real opening-book data file for an MVP.

const OPENING_BOOK = [
  { openingId: "start", label: "Starting position", fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" },
  { openingId: "e4", label: "1. e4", fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1" },
  { openingId: "d4", label: "1. d4", fen: "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1" },
  { openingId: "e4-e5", label: "1. e4 e5", fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2" },
  { openingId: "e4-c5", label: "1. e4 c5 (Sicilian)", fen: "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2" },
  { openingId: "c4", label: "1. c4 (English)", fen: "rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b KQkq - 0 1" },
];

function openingFor(index) {
  return OPENING_BOOK[((index % OPENING_BOOK.length) + OPENING_BOOK.length) % OPENING_BOOK.length];
}

module.exports = { OPENING_BOOK, openingFor };
