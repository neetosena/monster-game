const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

//SERVER STATIC FILES CLIENT
app.use(express.static(path.join(__dirname, "../client")));

//TRACK OF GAMES AND PLAYERS
let totalGames = 0;
let games = {};
let players = {};

//CREATE A NEW GAME (BASIC PLACEHOLDER LOGIC)
const createGame = (playerID) => {
  const gameID = `game-${Date.now()}`;
  games[gameID] = {
    id: gameID,
    players: [playerID],
    board: Array(10)
      .fill(null)
      .map(() => Array(10).fill(null)),
    removed: {},
    status: "waiting",
  };
  return games[gameID];
};

//WEBSOCKET EVENTS
io.on("connection", (socket) => {
  console.log(`Player connected: ${socket}`);
  players[socket.id] = { wins: 0, losses: 0, currentGame: null };

  //HANDLE JOIN GAME REQUEST
  socket.on("joinGame", () => {
    const game = createGame(socket.id);
    players[socket.id].currentGame = game.id;

    socket.join(game.id);
    socket.emit("gameCreated", game);
    console.log(`Player ${socket.id} joined ${game.id}`);
  });

  //SEND STATS ON REQUEST
  socket.on("getStats", () => {
    socket.emit("stats", { totalGames, playerStats: players[socket.id] });
  });

  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`);
  });

  socket.on("placeMonster", (data) => {
    const { row, col, type } = data;
    const player = players[socket.id];
    const gameId = player.currentGame;
    const game = games[gameId];

    if (!game) return;

    console.log(
      `Monster placed: ${type} at (${row}, ${col}) in game ${gameId} by ${socket.id}`
    );
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
