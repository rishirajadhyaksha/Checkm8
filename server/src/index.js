require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const queueRoutes = require("./routes/queue");
const gameRoutes = require("./routes/games");
const botRoutes = require("./routes/bots"); // Bot Arena Phase 0/1/2 — sandbox test route, CRUD/publish, calibration state machine
const leaderboardRoutes = require("./routes/leaderboard"); // Bot Arena Phase 2
const { shutdownPool } = require("./bots/runnerPool");
const ladderScheduler = require("./bots/ladderScheduler"); // Bot Arena Phase 2 — background calibration/ladder worker
const { setupSockets } = require("./sockets");
require("./queueRuntime"); // starts the in-memory matchmaking poll loop (Section 6.6)

const PORT = process.env.PORT || 4000;
const MODE = process.env.DEPLOYMENT_MODE || "local";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ ok: true, mode: MODE, storage: "json-file", engine: "in-process-minimax" });
});

app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/queue", queueRoutes);
app.use("/games", gameRoutes);
app.use("/bots", botRoutes);
app.use("/leaderboard", leaderboardRoutes);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CORS_ORIGIN, credentials: true } });
setupSockets(io);

server.listen(PORT, () => {
  console.log(
    `Checkm8 server listening on http://localhost:${PORT} (mode: ${MODE}, storage: json-file, engine: tiered-minimax)`
  );
  if (process.env.LADDER_SCHEDULER_ENABLED !== "false") {
    ladderScheduler.start();
    console.log(`[ladderScheduler] started (tick every ${ladderScheduler.TICK_MS}ms)`);
  } else {
    console.log("[ladderScheduler] disabled via LADDER_SCHEDULER_ENABLED=false");
  }
});

process.on("SIGINT", () => {
  console.log("\nShutting down Checkm8 server...");
  ladderScheduler.stop();
  shutdownPool(); // don't leave forked bot-runner workers behind
  process.exit(0);
});
