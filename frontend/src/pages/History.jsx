import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../AuthContext";

export default function History() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [games, setGames] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .history(user.userId)
      .then(setGames)
      .catch((err) => setError(err.message));
  }, [user.userId]);

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10">
      <h1 className="font-display text-3xl font-semibold mb-6">History</h1>

      <div className="flex gap-6 mb-8">
        <RatingStat label="Blitz" value={user.ratingBlitz} />
        <RatingStat label="Rapid" value={user.ratingRapid} border />
        <RatingStat label="Bullet" value={user.ratingBullet} border />
      </div>

      {error && <p className="text-ember-300">{error}</p>}

      <div className="bg-ink-800 border border-ink-700 rounded-lg overflow-hidden">
        {games === null && <p className="p-6 text-ink-600 animate-pulse">Loading…</p>}
        {games?.length === 0 && <p className="p-6 text-ink-600 italic">No games yet — go play one.</p>}
        {games?.map((g) => {
          const isWhite = g.whitePlayerId === user.userId;
          const opponent = g.isVsComputer
            ? `Checkm8 Bot · ${g.engineTier}`
            : isWhite
            ? "Opponent (Black)"
            : "Opponent (White)";
          const outcome =
            g.status !== "finished"
              ? "In progress"
              : g.result?.winner == null
              ? "Draw"
              : (g.result.winner === "white") === isWhite
              ? "Win"
              : "Loss";

          return (
            <button
              key={g.gameId}
              onClick={() => navigate(`/game/${g.gameId}`)}
              className="w-full flex items-center justify-between px-5 py-3 border-t border-ink-700 first:border-t-0 hover:bg-ink-700/40 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                {g.isVsComputer && (
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-ink-700 text-ink-600">CPU</span>
                )}
                <div>
                  <div className="font-medium text-sm">{opponent}</div>
                  <div className="text-xs text-ink-600 font-mono">
                    {g.timeControlMinutes ? `${g.timeControlMinutes}+${g.incrementSeconds}` : "No clock"}
                  </div>
                </div>
              </div>
              <span
                className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                  outcome === "Win"
                    ? "bg-brass-500/15 text-brass-400"
                    : outcome === "Loss"
                    ? "bg-ember-600/15 text-ember-300"
                    : "bg-ink-700 text-ink-600"
                }`}
              >
                {outcome}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RatingStat({ label, value, border }) {
  return (
    <div className={border ? "pl-6 border-l border-ink-700" : ""}>
      <div className="text-xs text-ink-600 mb-0.5">{label}</div>
      <div className="font-mono text-xl text-brass-400">{value}</div>
    </div>
  );
}
