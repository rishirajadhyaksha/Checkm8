const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

function authHeaders() {
  const token = localStorage.getItem("checkm8_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  signup: (username, password, email) => request("/auth/signup", { method: "POST", body: { username, password, email } }),
  login: (username, password) => request("/auth/login", { method: "POST", body: { username, password } }),
  me: () => request("/users/me"),
  history: (userId) => request(`/users/${userId}/history`),

  joinQueue: (timeControlMinutes, incrementSeconds) =>
    request("/queue/join", { method: "POST", body: { timeControlMinutes, incrementSeconds } }),
  leaveQueue: (timeControlMinutes, incrementSeconds) =>
    request("/queue/leave", { method: "DELETE", body: { timeControlMinutes, incrementSeconds } }),

  listPending: () => request("/games/pending"),
  createPending: (timeControlMinutes, incrementSeconds) =>
    request("/games", { method: "POST", body: { timeControlMinutes, incrementSeconds } }),
  joinPending: (gameId) => request(`/games/${gameId}/join`, { method: "POST" }),

  createComputerGame: (opts) => request("/games/computer", { method: "POST", body: opts }),

  getGame: (gameId) => request(`/games/${gameId}`),
  resign: (gameId) => request(`/games/${gameId}/resign`, { method: "POST" }),

  // Bot Arena — Phase 0 (sandbox test route, see bot-arena-design.md)
  botStatus: () => request("/bots/status"),
  botSamplePositions: () => request("/bots/sample-positions"),
  botTestRun: (code, positionKey, language = "javascript", fen) =>
    request("/bots/test-run", { method: "POST", body: { code, positionKey, language, fen } }),
  botLanguages: () => request("/bots/languages"),
  botLibrarySpec: () => request("/bots/library-spec"),
  botTemplates: () => request("/bots/templates"),
  botPreludes: () => request("/bots/preludes"),

  // Bot Arena — Phase 1 (bot CRUD, publish flow, human-vs-bot games)
  botsMine: () => request("/bots/mine"),
  botsPublished: () => request("/bots/published"),
  getBot: (botId) => request(`/bots/${botId}`),
  createBot: (name, code, language = "javascript") => request("/bots", { method: "POST", body: { name, code, language } }),
  updateBot: (botId, { name, code, language }) => request(`/bots/${botId}`, { method: "PUT", body: { name, code, language } }),
  publishBot: (botId) => request(`/bots/${botId}/publish`, { method: "POST" }),
  unpublishBot: (botId) => request(`/bots/${botId}/unpublish`, { method: "POST" }),
  deleteBot: (botId) => request(`/bots/${botId}`, { method: "DELETE" }),
  setBotFlagship: (botId, isFlagship) => request(`/bots/${botId}/flagship`, { method: "PUT", body: { isFlagship } }),
  createBotGame: (botId, opts) => request(`/games/vs-bot/${botId}`, { method: "POST", body: opts }),

  // Bot Arena — Phase 2 (ladder, Elo, leaderboard, match history)
  leaderboard: () => request("/leaderboard"),
  getBotMatches: (botId, limit = 20) => request(`/bots/${botId}/matches?limit=${limit}`),
};

export { API_URL };
