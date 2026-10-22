const { QueueService } = require("./queueService");
const { gameManager } = require("./gameManager");

const queueService = new QueueService();

queueService.onMatch = (timeControlKey, playerA, playerB) => {
  const [minutes, increment] = timeControlKey.split("+").map(Number);
  const game = gameManager.createMatchedGame(playerA, playerB, minutes, increment);
  gameManager.emit("game_found", { gameId: game.gameId, players: [playerA.userId, playerB.userId], game });
};

queueService.startPolling(500);

module.exports = { queueService };
