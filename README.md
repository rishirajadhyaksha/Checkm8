# Checkm8 — Implementation of the v2.0 Design Doc

This is a working implementation of the **persistent-server mode** described
in the design doc (Section 3 "Mode B", Section 15, Appendix B). It implements:

- Account creation & JWT login
- Quick Match queue (shared, pure `findMatch` matching function, Section 6.6)
- Open "Pending Games" lobby, joinable by anyone — **both the creator and
  the joiner are correctly placed into the same active game**
- **Play vs. Computer** at 5 tiers (Easy / Medium / Hard / Expert / Practice
  Bot) — Easy/Medium/Hard/Expert drive a **real Stockfish binary** over UCI
  when one is installed on the host (`apt install stockfish`), with
  automatic fallback to a built-in minimax engine if it isn't
- Real-time play over Socket.IO with server-authoritative move validation
- Server-authoritative, drift-free clocks with increments (Section 7.3)
- Full game-over checklist: checkmate, stalemate, threefold repetition,
  50-move rule, insufficient material, timeout, resignation (Section 11)
- Reconnect/resync, 60s abandonment forfeiture (Section 7.5, 7.6)
- Persistent home nav with the "leave game" confirmation modal (Section 9.1)
- Game history + Elo-style ratings per bucket, computer games excluded
  from rating (Appendix A)
- Opponent info (username, rating, time control) shown throughout a match
- Click-to-move (in addition to drag-and-drop), with legal-move highlighting
- Proper pawn promotion — choose Queen/Rook/Bishop/Knight, both client and
  server validate the choice
- Rematch: instant for computer games, request/accept flow for human games,
  new game with swapped colors and the same time control
- End-of-game overlay showing the result and rating change, dismissible

## Stockfish (real chess engine)

Easy/Medium/Hard/Expert now drive an actual Stockfish binary via the UCI
protocol (`server/src/engines/stockfishEngine.js`), matching the original
design doc's intent. **Install it on whatever machine runs the server:**

```bash
# Ubuntu/Debian (including AWS Lightsail):
sudo apt install -y stockfish
```

If no Stockfish binary is found at startup, the server automatically falls
back to a built-in minimax engine (`tieredEngine.js`) so computer games still
work — just at a lower strength ceiling. Check your server logs for a line
starting with `[engineService]` to see which one is active. The **Practice
Bot** tier never uses Stockfish — it's the hand-written placeholder engine
from Section 10.4, unchanged.

## One remaining documented substitution

**Storage**: the doc calls for SQLite (local) / DynamoDB (cloud) behind a
`StorageAdapter` interface. This build uses a dependency-free JSON-file
store implementing that same interface (`server/src/db.js`), so it runs
anywhere with zero native build tools. Swappable later without touching game
logic.

Not built: the AWS serverless path (Section 16) — this build targets the
persistent-server / Lightsail path (Appendix C) end-to-end instead.

## Running it locally

Requires Node.js 18+ (LTS recommended) and, for full-strength bots, a
Stockfish binary on your PATH (`apt install stockfish` on Ubuntu/Debian,
`brew install stockfish` on Mac).

```bash
# Terminal 1 — backend
cd server
npm install
cp .env.example .env
npm run start:local
# → Checkm8 server listening on http://localhost:4000

# Terminal 2 — frontend
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

Open **http://localhost:5173**, sign up, and:
- Click **Play vs. Computer** → pick a tier → **Play** for an instant game.
- Or click **Find Match** and open a second incognito window with a second
  account to test human-vs-human matchmaking.
- Or **Create Open Game** and join it from the second window's Pending
  Games list — both windows should land in the same game.

Data persists to `server/data/checkm8-db.json` between restarts. Delete that
file to reset to a clean slate.

## Project layout

```
server/
  src/
    index.js            Express + Socket.IO entrypoint
    db.js               StorageAdapter (JSON-file; swap for SQLite/DynamoDB)
    auth.js             Signup/login, JWT issuance
    matchmaking.js       Section 6.6 — the shared, pure findMatch()
    queueService.js      In-memory queue + 500ms poll loop (persistent-server adapter)
    queueRuntime.js       Wires queueService -> gameManager
    clock.js             Section 7.3 — server-authoritative clock math
    gameManager.js        Section 7 / 11 — move validation, game-over checklist,
                          abandonment, reconnect resync
    engines/
      engineService.js    Section 10.2 — single interface for all 4 tiers
      tieredEngine.js      Easy/Medium/Hard (minimax substitute for Stockfish)
      practiceEngine.js    Section 10.4 — verbatim placeholder bot
    routes/               REST endpoints (Section 8.1)
    middleware/           JWT auth guard, rate limiting (Section 10.6/12)
    sockets.js            Realtime events (Section 8.2)
frontend/
  src/
    App.jsx               Routes
    AuthContext.jsx        Login/session state
    ActiveGameContext.jsx  Tracks in-progress game for the home-nav guard
    api.js / socket.js     REST + Socket.IO clients
    components/AppShell.jsx  Section 9.1 — persistent home nav, hard requirement
    pages/
      Landing.jsx           Login / sign up
      Lobby.jsx              Quick Match / Play vs. Computer / Pending Games
      GameRoom.jsx           Board, clocks, move list, resign
      History.jsx            Past games + ratings
```

## Verified end-to-end

Signup → computer-game creation at each tier → human move → server-validated
engine reply with correct clock increments → illegal-move rejection →
reconnect resync → resignation → rating correctly left unchanged for
computer games → human-vs-human queue matchmaking producing matched
`game_found` events for both players.
