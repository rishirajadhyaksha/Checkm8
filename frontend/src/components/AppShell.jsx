import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { useActiveGame } from "../ActiveGameContext";
import { api } from "../api";

/**
 * Section 9.1 — a hard requirement, not a nice-to-have. Every route is
 * wrapped in this single shared component so it is structurally impossible
 * to add a page that lacks the persistent home nav.
 */
export default function AppShell({ children }) {
  const { user, logout } = useAuth();
  const { activeGame, clearActiveGame } = useActiveGame();
  const navigate = useNavigate();
  const [modalOpen, setModalOpen] = useState(false);

  // Native back-button / tab-close guard during an active game.
  useEffect(() => {
    function handleBeforeUnload(e) {
      if (activeGame) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [activeGame]);

  function handleLogoClick(e) {
    e.preventDefault();
    if (activeGame) {
      setModalOpen(true);
    } else {
      navigate("/lobby");
    }
  }

  async function handleResignAndGoHome() {
    try {
      await api.resign(activeGame.gameId);
    } catch {
      /* game may have already ended server-side; proceed regardless */
    }
    clearActiveGame();
    setModalOpen(false);
    navigate("/lobby");
  }

  function handleJustGoHome() {
    // Game keeps running in the background, exactly as a disconnect would (7.5).
    clearActiveGame();
    setModalOpen(false);
    navigate("/lobby");
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 border-b border-ink-700 bg-ink-900/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-14 flex items-center justify-between">
          <a
            href="/lobby"
            onClick={handleLogoClick}
            className="flex items-center gap-2 group focus:outline-none focus-visible:ring-2 focus-visible:ring-brass-500 rounded"
          >
            <span className="text-2xl leading-none text-brass-500 group-hover:rotate-[8deg] transition-transform">♞</span>
            <span className="font-display font-semibold tracking-tight text-lg">
              Checkm<span className="text-brass-500">8</span>
            </span>
          </a>

          {user && (
            <div className="flex items-center gap-4 text-sm">
              <Link to="/history" className="text-ink-600 hover:text-parchment transition-colors hidden sm:inline">
                History
              </Link>
              <Link to="/bots/lab" className="text-ink-600 hover:text-parchment transition-colors hidden sm:inline">
                Bot Lab
              </Link>
              <Link to="/bots/arena" className="text-ink-600 hover:text-parchment transition-colors hidden sm:inline">
                Bot Arena
              </Link>
              <Link to="/leaderboard" className="text-ink-600 hover:text-parchment transition-colors hidden sm:inline">
                Leaderboard
              </Link>
              <span className="flex items-center text-ink-600">
                {user.username}
                <span className="border-l border-ink-700 ml-3 pl-3 font-mono text-brass-400">{user.ratingBlitz}</span>
              </span>
              <button
                onClick={logout}
                className="px-3 py-1.5 rounded-md border border-ink-700 hover:border-brass-500 hover:text-brass-400 transition-colors"
              >
                Log out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1">{children}</main>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="bg-ink-800 border border-ink-700 rounded-xl max-w-sm w-full p-6 shadow-2xl">
            <h2 className="font-display text-lg font-semibold mb-2">Leave this game?</h2>
            <p className="text-sm text-ink-600 mb-6">
              You can resign or just minimize — leaving without resigning may forfeit on time if you don't come back.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleResignAndGoHome}
                className="w-full py-2 rounded-md bg-ember-600/10 border border-ember-600/40 text-ember-300 hover:bg-ember-600/20 transition-colors font-medium"
              >
                Resign &amp; go home
              </button>
              <button
                onClick={handleJustGoHome}
                className="w-full py-2 rounded-md bg-brass-500/10 border border-brass-500/40 text-brass-400 hover:bg-brass-500/20 transition-colors font-medium"
              >
                Just go home (game keeps running)
              </button>
              <button
                onClick={() => setModalOpen(false)}
                className="w-full py-2 rounded-md border border-ink-700 hover:border-ink-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
