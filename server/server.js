const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const PORT = process.env.PORT || 3000;

//SERVER STATIC FILES CLIENT
app.use(express.static(path.join(__dirname, "../client")));

//TRACK OF GAMES AND PLAYERS
let totalGames = 0;
let games = {};

let players = {};
let monsterChoices = {};
let finalPositions = {};
let currentRound = 1;
let roundHistory = []; // Array to store results of each round

let playerScores = {
  1: 0,
  2: 0,
  3: 0,
  4: 0,
};

//WEBSOCKET EVENTS
io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}, ${socket}`);

  // Assign player number (1 to 4)
  const currentPlayerCount = Object.keys(players).length;
  if (currentPlayerCount > 4) {
    socket.emit("gameFull");
    return;
  }
  const playerId = currentPlayerCount + 1;
  // Store player object with ID and stats
  players[socket.id] = {
    id: playerId,
    wins: 0,
    losses: 0,
    currentGame: null,
  };

  socket.emit("playerAssigned", playerId);

  socket.on("monsterChosen", (monster) => {
    const player = players[socket.id];
    monsterChoices[player.id] = monster;

    // Broadcast only when all 4 have chosen
    if (Object.keys(monsterChoices).length === 4) {
      io.emit("allMonstersChosen", monsterChoices);
    }

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

  socket.on("finalMonsterPositions", (positions) => {
    console.log(
      "Received finalMonsterPositions from player",
      players[socket.id]?.id,
      positions
    );
    finalPositions = { ...finalPositions, ...positions };

    if (Object.keys(finalPositions).length === 4) {
      console.log("All players submitted. Resolving...");

      // Call your function that filters survivors
      const resolvedPositions = resolveConflicts(finalPositions);
      console.log("Resolved survivors:", resolvedPositions);

      const losers = Object.keys(players).filter(
        (socketId) => !resolvedPositions.hasOwnProperty(players[socketId].id)
      );

      losers.forEach((socketId) => {
        io.to(socketId).emit("selectNewMonster");
      });
      console.log("Losers who can select a new monster:", losers);

      // Save to round history
      roundHistory.push({
        round: currentRound,
        survivors: resolvedPositions,
        allPositions: finalPositions,
      });

      // Send updated board
      io.emit("syncMonsterPositions", resolvedPositions);

      // Send current round info
      io.emit("updateRound", currentRound);

      // Score survivors
      for (const survivorId of Object.keys(resolvedPositions)) {
        playerScores[survivorId]++;
      }

      // Send scores to all clients
      io.emit("updateScores", playerScores);

      // Prepare for next round

      currentRound++;
      monsterChoices = resolvedPositions;
      finalPositions = {};
    }
  });

  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);
    const player = players[socket.id];
    if (player) {
      delete monsterChoices[player.id];
      delete players[socket.id];
    }
  });
});

function resolveConflicts(positions) {
  const posMap = {}; // key = "row,col", value = array of {playerId, type}

  // Group positions by coordinates
  for (const [playerId, pos] of Object.entries(positions)) {
    const key = `${pos.row},${pos.col}`;
    if (!posMap[key]) posMap[key] = [];
    posMap[key].push({ playerId, type: pos.type });
  }

  const survivors = {};

  for (const [key, arr] of Object.entries(posMap)) {
    if (arr.length === 1) {
      // No conflict
      const { playerId } = arr[0];
      survivors[playerId] = positions[playerId];
    } else if (arr.length === 2) {
      const [a, b] = arr;
      const winner = resolveTwoMonsters(a, b);
      if (winner) {
        survivors[winner.playerId] = positions[winner.playerId];
      }
    }
    // If 3 or 4 monsters chose same cell → all eliminated (you can customize this)
  }

  return survivors;
}

function resolveTwoMonsters(a, b) {
  const rules = {
    vampire: "werewolf",
    werewolf: "ghost",
    ghost: "vampire",
  };

  if (a.type === b.type) return null; // both removed

  if (rules[a.type] === b.type) return a; // a wins
  if (rules[b.type] === a.type) return b; // b wins

  return null; // unexpected case
}

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
