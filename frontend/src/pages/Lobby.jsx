import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { getSocket } from "../socket";
import { useAuth } from "../AuthContext";

const TIME_PRESETS = [
  { label: "1+0", minutes: 1, increment: 0 },
  { label: "3+2", minutes: 3, increment: 2 },
  { label: "5+0", minutes: 5, increment: 0 },
  { label: "10+5", minutes: 10, increment: 5 },
  { label: "15+10", minutes: 15, increment: 10 },
];

const TIERS = [
  { id: "easy", label: "Easy", rating: "~800–1000", desc: "Loose, occasionally random moves." },
  { id: "medium", label: "Medium", rating: "~1500–1650", desc: "Solid club-level play." },
  { id: "hard", label: "Hard", rating: "~2000–2200", desc: "Sharp, calculates deep lines." },
  { id: "expert", label: "Expert", rating: "~2800+", desc: "Full-strength Stockfish. Very tough." },
  { id: "practice", label: "Practice Bot", rating: "~400–600", desc: "Deliberately weak — great for beginners." },
];

export default function Lobby() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Quick match state
  const [qmTimeControl, setQmTimeControl] = useState(TIME_PRESETS[2]);
  const [inQueue, setInQueue] = useState(false);
  const [queueSeconds, setQueueSeconds] = useState(0);
  const [queueCount, setQueueCount] = useState(null);

  // Computer game state
  const [tier, setTier] = useState("medium");
  const [color, setColor] = useState("random");
  const [cpuTimeControl, setCpuTimeControl] = useState(TIME_PRESETS[2]);
  const [noClock, setNoClock] = useState(false);
  const [startingCpu, setStartingCpu] = useState(false);

  // Pending games
  const [pending, setPending] = useState([]);
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [error, setError] = useState("");

  const refreshPending = useCallback(() => {
    api.listPending().then(setPending).catch(() => {});
  }, []);

  useEffect(() => {
    refreshPending();
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    function onGameFound({ gameId }) {
      setInQueue(false);
      navigate(`/game/${gameId}`);
    }
    function onPendingCreated() {
      refreshPending();
    }
    function onPendingRemoved() {
      refreshPending();
    }

    socket.on("game_found", onGameFound);
    socket.on("pending_game_created", onPendingCreated);
    socket.on("pending_game_removed", onPendingRemoved);

    return () => {
      socket.off("game_found", onGameFound);
      socket.off("pending_game_created", onPendingCreated);
      socket.off("pending_game_removed", onPendingRemoved);
    };
  }, [refreshPending, navigate]);

  useEffect(() => {
    let interval;
    if (inQueue) {
      setQueueSeconds(0);
      interval = setInterval(() => setQueueSeconds((s) => s + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [inQueue]);

  async function handleFindMatch() {
    setError("");
    try {
      const res = await api.joinQueue(qmTimeControl.minutes, qmTimeControl.increment);
      setQueueCount(res.waiting);
      setInQueue(true);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCancelQueue() {
    await api.leaveQueue(qmTimeControl.minutes, qmTimeControl.increment).catch(() => {});
    setInQueue(false);
  }

  async function handlePlayComputer() {
    setError("");
    setStartingCpu(true);
    try {
      const game = await api.createComputerGame({
        timeControlMinutes: noClock ? null : cpuTimeControl.minutes,
        incrementSeconds: noClock ? 0 : cpuTimeControl.increment,
        engineTier: tier,
        color,
      });
      navigate(`/game/${game.gameId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setStartingCpu(false);
    }
  }

  async function handleCreateOpenGame() {
    setError("");
    setCreatingOpen(true);
    try {
      await api.createPending(qmTimeControl.minutes, qmTimeControl.increment);
      refreshPending();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatingOpen(false);
    }
  }

  async function handleJoinPending(gameId) {
    setError("");
    try {
      const game = await api.joinPending(gameId);
      navigate(`/game/${game.gameId}`);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10">
      <h1 className="font-display text-3xl font-semibold mb-1">Lobby</h1>
      <p className="text-ink-600 mb-8">Pick your table.</p>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-md bg-ember-600/10 border border-ember-600/30 text-ember-300 text-sm">
          {error}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Quick Match */}
        <section className="bg-ink-800 border border-ink-700 rounded-lg p-6 flex flex-col">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-brass-500">♟</span>
            <h2 className="font-display font-semibold text-lg">Quick Match</h2>
          </div>
          <p className="text-sm text-ink-600 mb-4">Find a human opponent at your rating, fast.</p>

          <TimeControlPicker value={qmTimeControl} onChange={setQmTimeControl} disabled={inQueue} />

          <div className="mt-auto pt-6">
            {!inQueue ? (
              <button
                onClick={handleFindMatch}
                className="w-full py-2.5 rounded-md bg-brass-500 text-ink-950 font-bold hover:bg-brass-400 transition-colors"
              >
                Find Match
              </button>
            ) : (
              <div className="text-center">
                <p className="font-mono text-brass-400 mb-3">
                  Searching… {String(Math.floor(queueSeconds / 60)).padStart(1, "0")}:
                  {String(queueSeconds % 60).padStart(2, "0")}
                </p>
                <button
                  onClick={handleCancelQueue}
                  className="w-full py-2 rounded-md border border-ink-700 hover:border-ember-500 hover:text-ember-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Play vs Computer */}
        <section className="bg-ink-800 border border-ink-700 rounded-lg p-6 flex flex-col">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-brass-500">♞</span>
            <h2 className="font-display font-semibold text-lg">Play vs. Computer</h2>
          </div>
          <p className="text-sm text-ink-600 mb-4">Instant start. No waiting.</p>

          <div className="grid grid-cols-2 gap-2 mb-4">
            {TIERS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTier(t.id)}
                className={`text-left p-3 rounded-md border transition-colors ${
                  tier === t.id ? "border-brass-500 bg-brass-500/10" : "border-ink-700 hover:border-ink-600"
                }`}
              >
                <div className="font-semibold text-sm">{t.label}</div>
                <div className="text-xs text-ink-600">{t.rating}</div>
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-600 mb-4 -mt-2">{TIERS.find((t) => t.id === tier)?.desc}</p>

          <div className="flex gap-2 mb-4">
            {["white", "black", "random"].map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`flex-1 py-1.5 rounded-md text-sm border capitalize transition-colors ${
                  color === c ? "border-brass-500 text-brass-400" : "border-ink-700 text-ink-600"
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-sm mb-3 cursor-pointer">
            <input type="checkbox" checked={noClock} onChange={(e) => setNoClock(e.target.checked)} className="accent-brass-500" />
            No clock
          </label>

          {!noClock && <TimeControlPicker value={cpuTimeControl} onChange={setCpuTimeControl} />}

          <div className="mt-auto pt-4">
            <button
              onClick={handlePlayComputer}
              disabled={startingCpu}
              className="w-full py-2.5 rounded-md bg-brass-500 text-ink-950 font-bold hover:bg-brass-400 transition-colors disabled:opacity-50"
            >
              {startingCpu ? "Starting…" : "Play"}
            </button>
          </div>
        </section>

        {/* Pending Games */}
        <section className="bg-ink-800 border border-ink-700 rounded-lg p-6 flex flex-col">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="text-brass-500">♜</span>
              <h2 className="font-display font-semibold text-lg">Pending Games</h2>
            </div>
            <button
              onClick={handleCreateOpenGame}
              disabled={creatingOpen}
              className="text-xs px-2.5 py-1 rounded-md border border-ink-700 hover:border-brass-500 hover:text-brass-400 transition-colors"
            >
              + Create Open Game
            </button>
          </div>
          <p className="text-sm text-ink-600 mb-4">Join a specific open board.</p>

          <div className="flex-1 overflow-y-auto scrollbar-thin max-h-72 -mx-2 px-2">
            {pending.length === 0 && <p className="text-sm text-ink-600 italic py-6 text-center">No open games right now.</p>}
            <table className="w-full text-sm">
              <tbody>
                {pending.map((p) => (
                  <tr key={p.gameId} className="border-t border-ink-700">
                    <td className="py-2">
                      <div className="font-medium">{p.creatorUsername || "Player"}</div>
                      <div className="text-xs text-ink-600">Rating {p.creatorRating ?? "—"}</div>
                    </td>
                    <td className="py-2 font-mono text-xs text-ink-600">
                      {p.timeControlMinutes}+{p.incrementSeconds}
                    </td>
                    <td className="py-2 text-xs text-ink-600">
                      <div>{timeAgo(p.createdAt)}</div>
                      <ExpiryCountdown pending={p} />
                    </td>
                    <td className="py-2 text-right">
                      {p.creatorId === user.userId ? (
                        <span className="text-xs px-2.5 py-1 text-ink-600 italic">Your game</span>
                      ) : (
                        <button
                          onClick={() => handleJoinPending(p.gameId)}
                          className="text-xs px-2.5 py-1 rounded-md bg-brass-500/10 border border-brass-500/40 text-brass-400 hover:bg-brass-500/20 transition-colors"
                        >
                          Join
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function ExpiryCountdown({ pending }) {
  // Offset between the server's clock and ours, measured when the list loaded.
  const offsetRef = useRef(pending.serverNow ? pending.serverNow - Date.now() : 0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!pending.expiresAt) return null;
  const left = Math.max(0, Math.ceil((pending.expiresAt - (now + offsetRef.current)) / 1000));
  const m = Math.floor(left / 60);
  const s = String(left % 60).padStart(2, "0");
  return <div className={left <= 60 ? "text-ember-300" : "text-ink-600"}>expires in {m}:{s}</div>;
}

function TimeControlPicker({ value, onChange, disabled }) {
  return (
    <div className="flex flex-wrap gap-2">
      {TIME_PRESETS.map((tc) => (
        <button
          key={tc.label}
          disabled={disabled}
          onClick={() => onChange(tc)}
          className={`px-3 py-1.5 rounded-md text-sm font-mono border transition-colors disabled:opacity-40 ${
            value.label === tc.label ? "border-brass-500 text-brass-400" : "border-ink-700 text-ink-600"
          }`}
        >
          {tc.label}
        </button>
      ))}
    </div>
  );
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
