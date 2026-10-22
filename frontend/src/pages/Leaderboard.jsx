// frontend/src/pages/Leaderboard.jsx — Bot Arena, Phase 2
//
// bot-arena-design.md's leaderboard product surface: "a ranked list of
// published bots by rating, with games played, win/loss/draw record,
// owner, flagship badge, and last-active time." Every published bot
// appears here (not just each owner's flagship — see routes/leaderboard.js
// for that product-decision note), sorted by rating. A bot still mid
// calibration gauntlet doesn't show up yet — it isn't ranked until the
// gauntlet actually produces a rating estimate.

import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

export default function Leaderboard() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    setLoading(true);
    api
      .leaderboard()
      .then((data) => {
        setRows(data);
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10">
      <h1 className="font-display text-3xl font-semibold mb-1">Leaderboard</h1>
      <p className="text-ink-600 mb-8">
        Published bots, ranked by rating. Every bot starts by playing a calibration gauntlet against
        Checkm8's built-in engine tiers before it's ranked, then plays other bots on an ongoing ladder in
        the background.
      </p>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-md bg-ember-600/10 border border-ember-600/30 text-ember-300 text-sm">
          {error}
        </div>
      )}

      {loading && <p className="text-ink-600 italic">Loading…</p>}

      {!loading && rows.length === 0 && (
        <div className="bg-ink-800 border border-ink-700 rounded-lg p-8 text-center">
          <p className="text-ink-600">No ranked bots yet.</p>
          <p className="text-sm text-ink-600 mt-1">
            Publish one from <span className="text-brass-400">Bot Lab</span> — it'll appear here once its
            calibration gauntlet finishes.
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="bg-ink-800 border border-ink-700 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-700 text-ink-600 text-xs uppercase tracking-wide">
                <th className="text-left py-2.5 px-4">Rank</th>
                <th className="text-left py-2.5 px-4">Bot</th>
                <th className="text-left py-2.5 px-4 hidden sm:table-cell">Owner</th>
                <th className="text-right py-2.5 px-4">Rating</th>
                <th className="text-right py-2.5 px-4 hidden sm:table-cell">Record</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.botId} className="border-t border-ink-700 hover:bg-ink-900/50 transition-colors">
                  <td className="py-2.5 px-4 font-mono text-ink-600">{row.rank}</td>
                  <td className="py-2.5 px-4">
                    <Link to={`/bots/${row.botId}`} className="font-medium hover:text-brass-400 transition-colors inline-flex items-center gap-1.5">
                      {row.isFlagship && <span className="text-brass-500">★</span>}
                      {row.name}
                    </Link>
                  </td>
                  <td className="py-2.5 px-4 text-ink-600 hidden sm:table-cell">{row.ownerUsername}</td>
                  <td className="py-2.5 px-4 text-right font-mono">
                    {Math.round(row.rating.value)}
                    {row.rating.provisional && <span className="text-ink-600 text-xs ml-1">(provisional)</span>}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-xs text-ink-600 hidden sm:table-cell">
                    {row.record.wins}-{row.record.losses}-{row.record.draws}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
