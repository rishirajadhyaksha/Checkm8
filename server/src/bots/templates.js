// Starter bots for every language: random, greedy (one-ply material), and a
// depth-2 material search. All use only the documented chess library.
// state fields: fen, legalMoves (legal_moves in Python/Lua), turn,
// timeRemainingMs (time_remaining_ms), incrementMs (increment_ms), history.

const js = {
  random: `// Random bot: plays any legal move. chess.* is the built-in library;
// random() is seeded so matches are replayable.
function chooseMove(state) {
  const moves = state.legalMoves;
  return moves[Math.floor(random() * moves.length)];
}
`,
  greedy: `// Greedy bot: plays the move that leaves the best material balance,
// takes a checkmate when it sees one, and breaks ties randomly.
function chooseMove(state) {
  const me = state.turn;
  let best = state.legalMoves[0];
  let bestScore = -Infinity;
  for (const move of state.legalMoves) {
    const next = chess.makeMove(state.fen, move);
    const m = chess.getMaterial(next);
    let score = (me === "w" ? m.w - m.b : m.b - m.w) + random() * 0.01;
    if (chess.isCheckmate(next)) score += 1000;
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}
`,
  minimax: `// Depth-2 search on material: for each move, assume the opponent answers
// with their best capture, and pick the move that holds up best. Looking only
// at capture replies keeps it fast and well under the 5,000-call budget.
function material(fen, me) {
  const m = chess.getMaterial(fen);
  return me === "w" ? m.w - m.b : m.b - m.w;
}

function chooseMove(state) {
  const me = state.turn;
  let best = state.legalMoves[0];
  let bestScore = -Infinity;
  for (const move of state.legalMoves) {
    const next = chess.makeMove(state.fen, move);
    if (chess.isCheckmate(next)) return move;
    let worst = material(next, me); // static value, then check every capture reply
    for (const reply of chess.getCaptureMoves(next)) {
      const s = material(chess.makeMove(next, reply), me);
      if (s < worst) worst = s;
    }
    if (worst + random() * 0.01 > bestScore) {
      bestScore = worst;
      best = move;
    }
  }
  return best;
}
`,
};

const ts = {
  random: `// Random bot (TypeScript). Types are stripped when you save.
interface State {
  fen: string;
  legalMoves: string[];
  turn: "w" | "b";
  timeRemainingMs: number;
  incrementMs: number;
  history: string[];
}

function chooseMove(state: State): string {
  const moves = state.legalMoves;
  return moves[Math.floor(random() * moves.length)];
}
`,
  greedy: `interface State {
  fen: string;
  legalMoves: string[];
  turn: "w" | "b";
  timeRemainingMs: number;
  incrementMs: number;
  history: string[];
}

// Greedy bot: best material balance after one move; takes checkmate.
function chooseMove(state: State): string {
  const me = state.turn;
  let best = state.legalMoves[0];
  let bestScore = -Infinity;
  for (const move of state.legalMoves) {
    const next = chess.makeMove(state.fen, move) as string;
    const m = chess.getMaterial(next);
    let score = (me === "w" ? m.w - m.b : m.b - m.w) + random() * 0.01;
    if (chess.isCheckmate(next)) score += 1000;
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}
`,
  minimax: `interface State {
  fen: string;
  legalMoves: string[];
  turn: "w" | "b";
  timeRemainingMs: number;
  incrementMs: number;
  history: string[];
}

function material(fen: string, me: "w" | "b"): number {
  const m = chess.getMaterial(fen);
  return me === "w" ? m.w - m.b : m.b - m.w;
}

// Depth-2 material search: assume the opponent answers with their best capture.
function chooseMove(state: State): string {
  const me = state.turn;
  let best = state.legalMoves[0];
  let bestScore = -Infinity;
  for (const move of state.legalMoves) {
    const next = chess.makeMove(state.fen, move) as string;
    if (chess.isCheckmate(next)) return move;
    let worst = material(next, me); // static value, then check every capture reply
    for (const reply of chess.getCaptureMoves(next)) {
      const s = material(chess.makeMove(next, reply) as string, me);
      if (s < worst) worst = s;
    }
    if (worst + random() * 0.01 > bestScore) {
      bestScore = worst;
      best = move;
    }
  }
  return best;
}
`,
};

const py = {
  random: `# Random bot: plays any legal move. "chess" is the built-in library;
# "random" is seeded so matches are replayable.
import random

def choose_move(state):
    return random.choice(state["legal_moves"])
`,
  greedy: `import random

# Greedy bot: best material balance after one move; takes checkmate.
def choose_move(state):
    me = state["turn"]
    best = state["legal_moves"][0]
    best_score = -1e9
    for move in state["legal_moves"]:
        nxt = chess.make_move(state["fen"], move)
        m = chess.get_material(nxt)
        score = (m["w"] - m["b"] if me == "w" else m["b"] - m["w"]) + random.random() * 0.01
        if chess.is_checkmate(nxt):
            score += 1000
        if score > best_score:
            best_score = score
            best = move
    return best
`,
  minimax: `import random

def material(fen, me):
    m = chess.get_material(fen)
    return m["w"] - m["b"] if me == "w" else m["b"] - m["w"]

# Depth-2 search on material: assume the opponent answers with their best
# capture and pick the move that holds up best (fast, few library calls).
def choose_move(state):
    me = state["turn"]
    best = state["legal_moves"][0]
    best_score = -1e9
    for move in state["legal_moves"]:
        nxt = chess.make_move(state["fen"], move)
        if chess.is_checkmate(nxt):
            return move
        worst = material(nxt, me)  # static value, then every capture reply
        for reply in chess.get_capture_moves(nxt):
            s = material(chess.make_move(nxt, reply), me)
            if s < worst:
                worst = s
        if worst + random.random() * 0.01 > best_score:
            best_score = worst
            best = move
    return best
`,
};

const lua = {
  random: `-- Random bot: plays any legal move. "chess" is the built-in library;
-- random() is seeded so matches are replayable.
function choose_move(state)
  local moves = state.legal_moves
  return moves[math.random(#moves)]
end
`,
  greedy: `-- Greedy bot: best material balance after one move; takes checkmate.
function choose_move(state)
  local me = state.turn
  local best = state.legal_moves[1]
  local best_score = -1e9
  for _, move in ipairs(state.legal_moves) do
    local nxt = chess.make_move(state.fen, move)
    local m = chess.get_material(nxt)
    local score = (me == "w" and m.w - m.b or m.b - m.w) + random() * 0.01
    if chess.is_checkmate(nxt) then score = score + 1000 end
    if score > best_score then
      best_score = score
      best = move
    end
  end
  return best
end
`,
  minimax: `local function material(fen, me)
  local m = chess.get_material(fen)
  if me == "w" then return m.w - m.b end
  return m.b - m.w
end

-- Depth-2 search on material: assume the opponent answers with their best
-- capture and pick the move that holds up best (fast, few library calls).
function choose_move(state)
  local me = state.turn
  local best = state.legal_moves[1]
  local best_score = -1e9
  for _, move in ipairs(state.legal_moves) do
    local nxt = chess.make_move(state.fen, move)
    if chess.is_checkmate(nxt) then return move end
    local worst = material(nxt, me) -- static value, then every capture reply
    for _, reply in ipairs(chess.get_capture_moves(nxt)) do
      local s = material(chess.make_move(nxt, reply), me)
      if s < worst then worst = s end
    end
    if worst + random() * 0.01 > best_score then
      best_score = worst
      best = move
    end
  end
  return best
end
`,
};

const TEMPLATES = { javascript: js, typescript: ts, python: py, lua };
module.exports = { TEMPLATES };
