// frontend/src/pages/BotDetail.jsx — Bot Arena, Phase 2
//
// bot-arena-design.md's leaderboard section: "a bot's detail page shows
// recent match history with links to full PGNs for transparency and so
// authors can learn from losses." No chess-replay UI here — showing the
// raw PGN text (which any chess app or online viewer can paste in) is
// enough for an MVP; building a full move-by-move replay board is a
// reasonable future addition, not required for this to be useful now.

import React, { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api";

const STATUS_LABEL = { draft: "Draft", calibrating: "Calibrating", published: "Published" };

function opponentLabel(match, viewingBotId) {
  const opponent = match.participants.find((p) => p.botId !== viewingBotId);
  if (!opponent) return "Unknown";
  return opponent.name;
}

function resultLabel(match, viewingBotId) {
  const mine = match.participants.find((p) => p.botId === viewingBotId);
  if (!mine) return match.result;
  if (match.result === "1/2-1/2") return "Draw";
  const iWon = (mine.color === "w" && match.result === "1-0") || (mine.color === "b" && match.result === "0-1");
  return iWon ? "Win" : "Loss";
}

function MatchRow({ match, viewingBotId }) {
  const [showPgn, setShowPgn] = useState(false);
  const outcome = resultLabel(match, viewingBotId);
  const outcomeColor = outcome === "Win" ? "text-brass-400" : outcome === "Loss" ? "text-ember-300" : "text-ink-600";

  return (
    <div className="border-t border-ink-700 py-3 px-4">
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="min-w-0">
          <span className="text-ink-600 text-xs uppercase tracking-wide mr-2">{match.matchType}</span>
          <span className="font-medium">vs {opponentLabel(match, viewingBotId)}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className={`font-semibold ${outcomeColor}`}>{outcome}</span>
          <span className="text-ink-600 text-xs">{match.reason.replace(/_/g, " ")}</span>
          <button onClick={() => setShowPgn((v) => !v)} className="text-xs px-2 py-1 rounded border border-ink-700 hover:border-brass-500 hover:text-brass-400 transition-colors">
            {showPgn ? "Hide PGN" : "View PGN"}
          </button>
        </div>
      </div>
      {showPgn && (
        <pre className="mt-2 p-3 rounded-md bg-ink-900 border border-ink-700 text-xs font-mono overflow-x-auto whitespace-pre-wrap">{match.pgn}</pre>
      )}
    </div>
  );
}

export default function BotDetail() {
  const { botId } = useParams();
  const [bot, setBot] = useState(null);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    setLoading(true);
    Promise.all([api.getBot(botId), api.getBotMatches(botId, 30)])
      .then(([botData, matchData]) => {
        setBot(botData);
        setMatches(matchData);
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [botId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <span className="text-brass-500 animate-pulse">Loading…</span>
      </div>
    );
  }

  if (error || !bot) {
    return (
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-10 text-center">
        <p className="text-ember-300">{error || "Bot not found."}</p>
        <Link to="/leaderboard" className="text-brass-400 text-sm mt-3 inline-block">
          Back to leaderboard
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-10">
      <div className="flex items-center gap-2 mb-1">
        {bot.isFlagship && <span className="text-brass-500 text-2xl" title="Flagship bot">★</span>}
        <h1 className="font-display text-3xl font-semibold">{bot.name}</h1>
      </div>
      <p className="text-ink-600 mb-6">
        by {bot.ownerUsername} · {STATUS_LABEL[bot.status] || bot.status}
      </p>

      <div className="grid sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-ink-800 border border-ink-700 rounded-lg p-4">
          <div className="text-xs uppercase tracking-wide text-ink-600 mb-1">Rating</div>
          <div className="font-mono text-2xl font-semibold">
            {bot.rating ? Math.round(bot.rating.value) : "—"}
          </div>
          {bot.rating?.provisional && <div className="text-xs text-ink-600 mt-1">Provisional</div>}
        </div>
        <div className="bg-ink-800 border border-ink-700 rounded-lg p-4">
          <div className="text-xs uppercase tracking-wide text-ink-600 mb-1">Record</div>
          <div className="font-mono text-2xl font-semibold">
            {bot.record ? `${bot.record.wins}-${bot.record.losses}-${bot.record.draws}` : "—"}
          </div>
          <div className="text-xs text-ink-600 mt-1">W-L-D</div>
        </div>
        <div className="bg-ink-800 border border-ink-700 rounded-lg p-4">
          <div className="text-xs uppercase tracking-wide text-ink-600 mb-1">Games played</div>
          <div className="font-mono text-2xl font-semibold">{bot.rating ? bot.rating.gamesPlayed : "—"}</div>
        </div>
      </div>

      <h2 className="font-display text-lg font-semibold mb-3">Recent matches</h2>
      <div className="bg-ink-800 border border-ink-700 rounded-lg overflow-hidden">
        {matches.length === 0 && <p className="text-ink-600 italic p-4 text-sm">No matches yet.</p>}
        {matches.map((m) => (
          <MatchRow key={m.matchId} match={m} viewingBotId={bot.botId} />
        ))}
      </div>
    </div>
  );
}
