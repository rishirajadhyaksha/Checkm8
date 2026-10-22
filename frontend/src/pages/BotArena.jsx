// frontend/src/pages/BotArena.jsx — Bot Arena, Phase 1
//
// Browse published community bots and start a game against one. This is
// deliberately separate from "Bot Lab" (writing/publishing your own bot)
// and from the built-in "Checkm8 Bot" computer opponent on the Lobby page
// — three different things that all involve the word "bot" in this app,
// so this page is careful to always show a bot's own name rather than a
// generic label, to avoid confusing the two systems.

import React, { useEffect, useState, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "../api";

const TIME_PRESETS = [
  { label: "1+0", minutes: 1, increment: 0 },
  { label: "3+2", minutes: 3, increment: 2 },
  { label: "5+0", minutes: 5, increment: 0 },
  { label: "10+5", minutes: 10, increment: 5 },
  { label: "15+10", minutes: 15, increment: 10 },
];

export default function BotArena() {
  const navigate = useNavigate();
  const [bots, setBots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [challenging, setChallenging] = useState(null); // botId | null
  const [color, setColor] = useState("random");
  const [timeControl, setTimeControl] = useState(TIME_PRESETS[2]);
  const [noClock, setNoClock] = useState(false);
  const [starting, setStarting] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    api
      .botsPublished()
      .then((list) => {
        setBots(list);
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function openChallenge(botId) {
    setChallenging(botId);
    setError("");
  }

  async function handleStart(botId) {
    setStarting(true);
    setError("");
    try {
      const game = await api.createBotGame(botId, {
        color,
        timeControlMinutes: noClock ? null : timeControl.minutes,
        incrementSeconds: noClock ? 0 : timeControl.increment,
      });
      navigate(`/game/${game.gameId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10">
      <h1 className="font-display text-3xl font-semibold mb-1">Bot Arena</h1>
      <p className="text-ink-600 mb-8">
        Challenge community-written bots from <span className="text-brass-400">Bot Lab</span>. These games are
        unrated — the ladder and leaderboard are coming in a future update.
      </p>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-md bg-ember-600/10 border border-ember-600/30 text-ember-300 text-sm">
          {error}
        </div>
      )}

      {loading && <p className="text-ink-600 italic">Loading bots…</p>}
      {!loading && bots.length === 0 && (
        <div className="bg-ink-800 border border-ink-700 rounded-lg p-8 text-center">
          <p className="text-ink-600">No published bots yet.</p>
          <p className="text-sm text-ink-600 mt-1">
            Head to <span className="text-brass-400">Bot Lab</span> to write and publish one.
          </p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        {bots.map((bot) => (
          <div key={bot.botId} className="bg-ink-800 border border-ink-700 rounded-lg p-5 flex flex-col">
            <div className="flex items-center gap-1.5 mb-1">
              {bot.isFlagship && <span title="Flagship bot" className="text-brass-500">★</span>}
              <Link to={`/bots/${bot.botId}`} className="font-display font-semibold text-lg hover:text-brass-400 transition-colors">
                {bot.name}
              </Link>
            </div>
            <p className="text-xs text-ink-600 mb-4">
              by {bot.ownerUsername || "unknown"}
              {bot.rating && (
                <span className="font-mono ml-2">
                  · {Math.round(bot.rating.value)}
                  {bot.rating.provisional && <span className="opacity-70"> (provisional)</span>}
                </span>
              )}
            </p>

            {challenging === bot.botId ? (
              <div className="mt-auto">
                <div className="flex gap-2 mb-3">
                  {["white", "black", "random"].map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={`flex-1 py-1.5 rounded-md text-xs border capitalize transition-colors ${
                        color === c ? "border-brass-500 text-brass-400" : "border-ink-700 text-ink-600"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>

                <label className="flex items-center gap-2 text-xs mb-3 cursor-pointer">
                  <input type="checkbox" checked={noClock} onChange={(e) => setNoClock(e.target.checked)} className="accent-brass-500" />
                  No clock
                </label>

                {!noClock && (
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {TIME_PRESETS.map((tc) => (
                      <button
                        key={tc.label}
                        onClick={() => setTimeControl(tc)}
                        className={`px-2.5 py-1 rounded-md text-xs font-mono border transition-colors ${
                          timeControl.label === tc.label ? "border-brass-500 text-brass-400" : "border-ink-700 text-ink-600"
                        }`}
                      >
                        {tc.label}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => handleStart(bot.botId)}
                    disabled={starting}
                    className="flex-1 py-2 rounded-md bg-brass-500 text-ink-950 font-bold hover:bg-brass-400 transition-colors disabled:opacity-50"
                  >
                    {starting ? "Starting…" : "Start"}
                  </button>
                  <button
                    onClick={() => setChallenging(null)}
                    className="px-3 py-2 rounded-md border border-ink-700 hover:border-ink-600 transition-colors text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => openChallenge(bot.botId)}
                className="mt-auto w-full py-2 rounded-md border border-brass-500/40 text-brass-400 hover:bg-brass-500/10 transition-colors text-sm font-medium"
              >
                Challenge
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
