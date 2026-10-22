const { verifyToken } = require("./auth");
const { storage } = require("./db");
const { gameManager } = require("./gameManager");

function setupSockets(io) {
  // Connection lifecycle (Section 7.1) — JWT validated before connection is accepted.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Missing auth token."));
    try {
      const payload = verifyToken(token);
      socket.userId = payload.userId;
      socket.username = payload.username;
      next();
    } catch (err) {
      next(new Error("Invalid or expired token."));
    }
  });

  io.on("connection", (socket) => {
    storage.setConnection(socket.userId, socket.id);
    socket.join(`user:${socket.userId}`);
    gameManager.markReconnected.bind(gameManager); // no-op reference to avoid unused warnings

    socket.on("spectate", ({ gameId }) => {
      socket.join(`game:${gameId}`);
    });

    socket.on("join_game", ({ gameId }) => {
      socket.join(`game:${gameId}`);
      gameManager.markReconnected(gameId, socket.userId);
    });

    socket.on("move", ({ gameId, from, to, promotion }) => {
      const result = gameManager.applyMove(gameId, socket.userId, { from, to, promotion });
      if (result.rejected) {
        socket.emit("move_rejected", { reason: result.reason, fen: result.fen });
      } else if (result.error) {
        socket.emit("move_rejected", { reason: result.error });
      }
      // On success, the "move_made" (and possibly "game_over") events are
      // broadcast globally by the gameManager event listeners wired below.
    });

    socket.on("resign", ({ gameId }) => {
      const result = gameManager.resign(gameId, socket.userId);
      if (result.error) socket.emit("move_rejected", { reason: result.error });
    });

    // Rematch flow (item 6): request -> relay to opponent -> accept/decline -> new game for both.
    socket.on("request_rematch", ({ gameId }) => {
      const game = storage.getGame(gameId);
      if (!game || game.isVsComputer || game.isVsBot) return; // computer/bot rematches are just a new game-creation call, no negotiation needed
      const opponentId = game.whitePlayerId === socket.userId ? game.blackPlayerId : game.whitePlayerId;
      if (!opponentId || opponentId === socket.userId) return;
      io.to(`user:${opponentId}`).emit("rematch_requested", { gameId, fromUserId: socket.userId, fromUsername: socket.username });
    });

    socket.on("respond_rematch", ({ gameId, accept }) => {
      const game = storage.getGame(gameId);
      if (!game || game.isVsComputer || game.isVsBot) return;
      const opponentId = game.whitePlayerId === socket.userId ? game.blackPlayerId : game.whitePlayerId;
      if (!accept) {
        if (opponentId) io.to(`user:${opponentId}`).emit("rematch_declined", { gameId });
        return;
      }
      const result = gameManager.createRematchGame(gameId);
      if (result.error) {
        socket.emit("move_rejected", { reason: result.error });
        return;
      }
      io.to(`user:${game.whitePlayerId}`).emit("rematch_started", { gameId: result.game.gameId });
      io.to(`user:${game.blackPlayerId}`).emit("rematch_started", { gameId: result.game.gameId });
    });

    // ---- PvP chat + draw offers (players only; delivered via user rooms, never the game room that spectators join) ----
    const chatErr = (result) => {
      if (result && result.error) socket.emit("chat_error", { reason: result.error });
    };
    socket.on("chat_send", (data) => {
      const { gameId, text } = data || {};
      if (typeof gameId !== "string") return;
      chatErr(gameManager.chatSend(gameId, socket.userId, text));
    });
    socket.on("draw_offer", (data) => {
      const { gameId } = data || {};
      if (typeof gameId !== "string") return;
      chatErr(gameManager.drawOffer(gameId, socket.userId));
    });
    socket.on("draw_respond", (data) => {
      const { gameId, offerId, accept } = data || {};
      if (typeof gameId !== "string") return;
      chatErr(gameManager.drawRespond(gameId, socket.userId, offerId, !!accept));
    });
    socket.on("draw_cancel", (data) => {
      const { gameId, offerId } = data || {};
      if (typeof gameId !== "string") return;
      chatErr(gameManager.drawCancel(gameId, socket.userId, offerId));
    });

    socket.on("disconnect", () => {
      storage.removeConnection(socket.userId);
      // Section 7.5 — start abandonment timers for any active games this user is in.
      const games = storage.listGamesForUser(socket.userId).filter((g) => g.status === "active");
      for (const g of games) {
        if (!g.isVsComputer && !g.isVsBot) gameManager.markDisconnected(g.gameId, socket.userId);
      }
    });
  });

  // gameManager broadcasts — identical payloads regardless of transport (Section 8.2)
  gameManager.on("move_made", (payload) => {
    io.to(`game:${payload.gameId}`).emit("move_made", payload);
  });
  gameManager.on("engine_thinking", (payload) => {
    io.to(`game:${payload.gameId}`).emit("engine_thinking", payload);
  });
  gameManager.on("game_over", (payload) => {
    io.to(`game:${payload.gameId}`).emit("game_over", payload);
  });
  gameManager.on("chat_message", ({ gameId, players, message }) => {
    for (const id of players) io.to(`user:${id}`).emit("chat_message", { gameId, message });
  });
  gameManager.on("chat_update", ({ gameId, players, id, status }) => {
    for (const pid of players) io.to(`user:${pid}`).emit("chat_update", { gameId, id, status });
  });
  gameManager.on("game_found", (payload) => {
    for (const userId of payload.players) {
      const color = payload.game.whitePlayerId === userId ? "white" : "black";
      const opponentId = color === "white" ? payload.game.blackPlayerId : payload.game.whitePlayerId;
      const opponentUser = storage.getUser(opponentId);
      io.to(`user:${userId}`).emit("game_found", {
        gameId: payload.gameId,
        color,
        opponent: {
          userId: opponentId,
          isComputer: false,
          username: opponentUser ? opponentUser.username : "Opponent",
          rating: opponentUser ? opponentUser.ratingBlitz : null,
        },
      });
    }
  });
  gameManager.on("pending_game_created", (payload) => {
    io.emit("pending_game_created", payload);
  });
  gameManager.on("pending_game_removed", (payload) => {
    io.emit("pending_game_removed", payload);
  });
}

module.exports = { setupSockets };
