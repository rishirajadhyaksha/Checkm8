import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";

// The final position of the fastest common mate in chess — Scholar's Mate,
// 1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6?? 4. Qxf7#. Ranks 8→1, files a→h.
const MATE_POSITION = [
  "r.bqkb.r",
  "pppp.Qpp",
  "..n..n..",
  "....p...",
  "..B.P...",
  "........",
  "PPPP.PPP",
  "RNB.K.NR",
];
const GLYPH = { r: "♜", n: "♞", b: "♝", q: "♛", k: "♚", p: "♟", R: "♖", N: "♘", B: "♗", Q: "♕", K: "♔", P: "♙" };

function MateDiagram() {
  return (
    <div className="animate-diagram-in">
      <div className="grid grid-cols-8 w-full max-w-[280px] rounded-md overflow-hidden border border-ink-700 shadow-xl">
        {MATE_POSITION.map((row, ri) =>
          [...row].map((ch, fi) => {
            const isDark = (fi + (7 - ri)) % 2 === 0;
            const isMateSquare = ri === 1 && fi === 5; // f7
            return (
              <div
                key={`${ri}-${fi}`}
                className="aspect-square flex items-center justify-center relative text-xl sm:text-2xl select-none"
                style={{ backgroundColor: isDark ? "#7c6142" : "#e9ddc4" }}
              >
                {isMateSquare && (
                  <span className="absolute inset-0.5 rounded-sm ring-2 ring-ember-500/80" />
                )}
                {ch !== "." && (
                  <span
                    className={ch === ch.toUpperCase() ? "text-white drop-shadow" : "text-ink-950"}
                    style={{ filter: ch === ch.toUpperCase() ? "drop-shadow(0 1px 1px rgba(0,0,0,.5))" : "none" }}
                  >
                    {GLYPH[ch]}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
      <p className="mt-3 font-mono text-xs text-ink-600 max-w-[280px] leading-relaxed">
        1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6?? 4.Qxf7#
        <br />
        The four-move loss. Every beginner falls for it once.
      </p>
    </div>
  );
}

export default function Landing() {
  const { user, login, signup } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login"); // 'login' | 'signup'
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    if (user) navigate("/lobby");
  }, [user]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "login") await login(username, password);
      else await signup(username, password);
      navigate("/lobby");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative overflow-hidden">
      <div className="mx-auto max-w-6xl px-6 pt-16 pb-24 grid md:grid-cols-2 gap-16 items-center">
        <div>
          <h1 className="font-display text-5xl sm:text-6xl font-semibold leading-[1.08] tracking-tight mb-6">
            Chess whenever
            <br />
            you're ready to play.
          </h1>
          <p className="text-ink-600 text-lg max-w-md mb-8 leading-relaxed">
            Queue into a rated match, open a board for anyone to join, or sit down across
            from an engine tuned to five different strengths. No lobby, no waiting room.
          </p>

          <div className="hidden sm:block">
            <MateDiagram />
          </div>
        </div>

        <div className="tick-frame bg-ink-800 border border-ink-700 rounded-lg p-8 shadow-2xl">
          <div className="flex mb-6 rounded-md bg-ink-900 p-1">
            <button
              className={`flex-1 py-2 rounded text-sm font-semibold transition-colors ${
                mode === "login" ? "bg-brass-500 text-ink-950" : "text-ink-600"
              }`}
              onClick={() => setMode("login")}
            >
              Log in
            </button>
            <button
              className={`flex-1 py-2 rounded text-sm font-semibold transition-colors ${
                mode === "signup" ? "bg-brass-500 text-ink-950" : "text-ink-600"
              }`}
              onClick={() => setMode("signup")}
            >
              Sign up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="text-xs text-ink-600 mb-1 block">Username</label>
              <input
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-ink-900 border border-ink-700 rounded-md px-3 py-2 focus:outline-none focus:border-brass-500"
                required
                minLength={3}
              />
            </div>
            <div>
              <label className="text-xs text-ink-600 mb-1 block">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-ink-900 border border-ink-700 rounded-md px-3 py-2 focus:outline-none focus:border-brass-500"
                required
                minLength={6}
              />
            </div>
            {error && <p className="text-ember-300 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="mt-2 py-2.5 rounded-md bg-brass-500 text-ink-950 font-bold hover:bg-brass-400 transition-colors disabled:opacity-50"
            >
              {loading ? "Please wait…" : mode === "login" ? "Play now" : "Create account"}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-ink-700 flex gap-5 text-xs text-ink-600">
            <span>Server-authoritative clocks</span>
            <span>5 bot strengths</span>
          </div>
        </div>

        <div className="sm:hidden -mt-4">
          <MateDiagram />
        </div>
      </div>
    </div>
  );
}
