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
let gamePhase = "placement"; // "placement" or "movement"
let boardState = {}; // Track all monsters on the board
let currentTurn = null; // For movement phase
let loserQueue = []; // Queue of losers for second round
let nonLoserQueue = []; // Queue of non-losers for second round
let monstersRemoved = { 1: 0, 2: 0, 3: 0, 4: 0 }; // Track monsters removed per player
let eliminatedPlayers = []; // Track eliminated players
let maxRounds = 10; // Maximum number of rounds

let playerScores = {
  1: 0,
  2: 0,
  3: 0,
  4: 0,
};

// Debug logging function
function debugLog(message) {
  console.log(`[SERVER DEBUG] ${message}`);
}

//WEBSOCKET EVENTS
io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Assign player number (1 to 4)
  const currentPlayerCount = Object.keys(players).length;
  if (currentPlayerCount >= 4) {
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
    monsters: [], // Track player's monsters
  };

  socket.emit("playerAssigned", playerId);

  // Notify all players that they can select monsters simultaneously
  io.emit("gameStateUpdate", {
    phase: gamePhase,
    round: currentRound,
    message: "All players can select and place monsters simultaneously",
  });

  // Broadcast current board state to new player
  socket.emit("updateBoardState", boardState);

  // Send current scores to new player
  socket.emit("updateScores", playerScores);

  // NEW-------------------------------------------------------------------
  socket.on("removeBoth", ({ fromRow, fromCol, toRow, toCol }) => {
    const fromKey = `${fromRow},${fromCol}`;
    const toKey = `${toRow},${toCol}`;

    if (gameState.board[fromKey]) delete gameState.board[fromKey];
    if (gameState.board[toKey]) delete gameState.board[toKey];

    io.emit("updateBoard", gameState.board);
  });
  // -------------------------------------------------------------------

  // Handle request for available moves
  socket.on("getAvailableMoves", (data) => {
    const player = players[socket.id];
    if (!player) return;

    const { fromRow, fromCol } = data;
    const availableMoves = calculateAvailableMoves(player.id, fromRow, fromCol);

    debugLog(
      `Sending ${availableMoves.length} available moves to player ${player.id} for monster at (${fromRow},${fromCol})`
    );

    // Send available moves to the player
    socket.emit("availableMoves", availableMoves);
  });

  socket.on("monsterChosen", (monster) => {
    const player = players[socket.id];
    if (!player) return;

    debugLog(`Player ${player.id} chose monster: ${monster}`);

    // Allow all players to choose monsters simultaneously in first round placement phase
    if (gamePhase !== "placement") {
      socket.emit("invalidAction", "Wrong game phase for monster selection");
      return;
    }

    // In second+ rounds, only allow selection if it's this player's turn
    if (currentRound > 1) {
      if (loserQueue.length > 0) {
        if (loserQueue[0] !== socket.id) {
          socket.emit(
            "invalidAction",
            "It's not your turn to select a monster"
          );
          return;
        }
      } else if (nonLoserQueue.length > 0) {
        if (nonLoserQueue[0] !== socket.id) {
          socket.emit(
            "invalidAction",
            "It's not your turn to select a monster"
          );
          return;
        }
      }
    }

    monsterChoices[player.id] = monster;
    socket.emit("monsterSelectionConfirmed", monster);

    // Broadcast only when all players have chosen in first round
    if (
      currentRound === 1 &&
      Object.keys(monsterChoices).length === Object.keys(players).length
    ) {
      io.emit("allMonstersChosen", monsterChoices);
    }
  });

  socket.on("finalMonsterPositions", (positions) => {
    const player = players[socket.id];
    if (!player) return;

    debugLog(
      `Received finalMonsterPositions from player ${
        player.id
      }: ${JSON.stringify(positions)}`
    );

    // Allow all players to place monsters simultaneously in first round placement phase
    if (gamePhase !== "placement") {
      socket.emit("invalidAction", "Wrong game phase for monster placement");
      return;
    }

    // In second+ rounds, only allow placement if it's this player's turn
    if (currentRound > 1) {
      if (loserQueue.length > 0) {
        if (loserQueue[0] !== socket.id) {
          socket.emit("invalidAction", "It's not your turn to place a monster");
          return;
        }
      } else if (nonLoserQueue.length > 0) {
        if (nonLoserQueue[0] !== socket.id) {
          socket.emit("invalidAction", "It's not your turn to place a monster");
          return;
        }
      }
    }

    // Add to final positions
    finalPositions = { ...finalPositions, ...positions };

    // Add to player's monsters list
    for (const [playerId, pos] of Object.entries(positions)) {
      const playerSocketId = Object.keys(players).find(
        (socketId) => players[socketId].id === parseInt(playerId)
      );
      if (playerSocketId) {
        players[playerSocketId].monsters.push({
          type: pos.type,
          row: pos.row,
          col: pos.col,
        });
      }
    }

    // In first round, only update the player's own view of their monster
    if (currentRound === 1) {
      // Only send the player's own monster position back to them
      const playerBoardState = {};
      for (const [pid, pos] of Object.entries(positions)) {
        const key = `${pos.row},${pos.col}`;
        playerBoardState[key] = {
          playerId: parseInt(pid),
          type: pos.type,
          row: pos.row,
          col: pos.col,
        };
      }
      socket.emit("updateBoardState", playerBoardState);
    } else {
      // In later rounds, update board state for all clients
      for (const [playerId, pos] of Object.entries(positions)) {
        const key = `${pos.row},${pos.col}`;
        boardState[key] = {
          playerId: parseInt(playerId),
          type: pos.type,
          row: pos.row,
          col: pos.col,
        };
      }

      // Broadcast updated board state to all clients
      io.emit("updateBoardState", boardState);
    }

    // Notify the player that their position was received
    socket.emit("positionReceived", {
      message: "Your monster position has been received.",
    });

    // For second+ rounds, move to next loser's turn
    if (currentRound > 1 && loserQueue.length > 0) {
      // Remove current player from queue
      loserQueue.shift();

      // If there are more losers, notify the next one
      if (loserQueue.length > 0) {
        const nextLoser = loserQueue[0];
        const nextLoserId = players[nextLoser].id;

        debugLog(`Moving to next loser's turn: Player ${nextLoserId}`);

        // Notify all players about the next turn
        io.emit("gameStateUpdate", {
          phase: gamePhase,
          round: currentRound,
          currentTurn: nextLoserId,
          message: `Round ${currentRound}: Player ${nextLoserId}'s turn to select and place a monster`,
        });

        // Alert the next player that it's their turn
        io.to(nextLoser).emit("yourTurn", {
          message: `It's your turn to select and place a monster!`,
        });

        // Enable monster selection for the next player
        io.to(nextLoser).emit("selectNewMonster");
      } else if (nonLoserQueue.length > 0) {
        // All losers have placed, now it's time for non-losers to take their turns
        debugLog("All losers have placed. Starting non-loser turns.");
        startNonLoserTurns();
      } else {
        // All players have had their turns, process end of round
        debugLog("All players have had their turns. Processing end of round.");
        processEndOfRound();
      }
    }

    // If all players have placed in first round
    if (
      currentRound === 1 &&
      Object.keys(finalPositions).length === Object.keys(players).length
    ) {
      debugLog(
        "All players have placed in first round. Processing end of round."
      );
      processEndOfRound();
    }
  });

  // Handle monster movement
  socket.on("moveMonster", (data) => {
    const player = players[socket.id];
    if (!player) return;

    debugLog(
      `Player ${player.id} attempting to move monster from (${data.fromRow},${data.fromCol}) to (${data.toRow},${data.toCol})`
    );

    // Check if it's this player's turn
    if (player.id !== currentTurn) {
      socket.emit("invalidAction", "It's not your turn");
      return;
    }

    // Check if in movement phase or if this is a non-loser in round 2+
    const isNonLoserInRound2Plus =
      currentRound > 1 &&
      gamePhase === "placement" &&
      nonLoserQueue.length > 0 &&
      nonLoserQueue[0] === socket.id;

    if (gamePhase !== "movement" && !isNonLoserInRound2Plus) {
      socket.emit("invalidAction", "You cannot move monsters in this phase");
      return;
    }

    const { fromRow, fromCol, toRow, toCol } = data;
    const fromKey = `${fromRow},${fromCol}`;
    const toKey = `${toRow},${toCol}`;

    // Check if the monster belongs to the player
    if (!boardState[fromKey] || boardState[fromKey].playerId !== player.id) {
      socket.emit("invalidAction", "You can only move your own monsters");
      return;
    }

    // Check if the move is valid
    const availableMoves = calculateAvailableMoves(player.id, fromRow, fromCol);
    const isValidMove = availableMoves.some(
      (move) =>
        move.fromRow === fromRow &&
        move.fromCol === fromCol &&
        move.toRow === toRow &&
        move.toCol === toCol
    );

    if (!isValidMove) {
      socket.emit("invalidAction", "Invalid move");
      return;
    }

    // Update board state
    const monster = boardState[fromKey];
    delete boardState[fromKey];
    boardState[toKey] = {
      ...monster,
      row: toRow,
      col: toCol,
    };

    // Update player's monster list
    const monsterIndex = player.monsters.findIndex(
      (m) => m.row === fromRow && m.col === fromCol
    );
    if (monsterIndex !== -1) {
      player.monsters[monsterIndex].row = toRow;
      player.monsters[monsterIndex].col = toCol;
    }

    // Notify all clients about the move
    io.emit("monsterMoved", {
      playerId: player.id,
      fromRow,
      fromCol,
      toRow,
      toCol,
      type: monster.type,
    });

    // Add to game history
    addToGameHistory(
      `Player ${player.id} moved a ${monster.type} from (${fromRow},${fromCol}) to (${toRow},${toCol})`
    );

    // Update board state for all clients
    io.emit("updateBoardState", boardState);

    // If this is a non-loser in round 2+, move to next player
    if (isNonLoserInRound2Plus) {
      // Remove current player from queue
      nonLoserQueue.shift();

      // If there are more non-losers, notify the next one
      if (nonLoserQueue.length > 0) {
        const nextNonLoser = nonLoserQueue[0];
        const nextNonLoserId = players[nextNonLoser].id;

        debugLog(`Moving to next non-loser's turn: Player ${nextNonLoserId}`);

        // Notify all players about the next turn
        io.emit("gameStateUpdate", {
          phase: gamePhase,
          round: currentRound,
          currentTurn: nextNonLoserId,
          message: `Round ${currentRound}: Player ${nextNonLoserId}'s turn to move a monster or place a new one`,
        });

        // Alert the next player that it's their turn
        io.to(nextNonLoser).emit("yourTurn", {
          message: `It's your turn! You can move one of your monsters or place a new one.`,
        });

        // Send available moves to the next player
        const nextPlayerAvailableMoves =
          calculateAvailableMoves(nextNonLoserId);
        io.to(nextNonLoser).emit("availableMoves", nextPlayerAvailableMoves);
      } else {
        // All players have had their turns, process end of round
        debugLog(
          "All non-losers have had their turns. Processing end of round."
        );
        processEndOfRound();
      }
    } else {
      // In regular movement phase, move to next player
      debugLog("Moving to next player's turn in movement phase.");
      advanceToNextTurn();
    }
  });

  // Handle placing a new monster (in movement phase or for non-losers in round 2+)
  socket.on("placeNewMonster", (data) => {
    const player = players[socket.id];
    if (!player) return;

    debugLog(
      `Player ${player.id} attempting to place new monster (${data.type}) at (${data.row},${data.col})`
    );

    // Check if it's this player's turn
    if (player.id !== currentTurn) {
      socket.emit("invalidAction", "It's not your turn");
      return;
    }

    // Check if in movement phase or if this is a non-loser in round 2+
    const isNonLoserInRound2Plus =
      currentRound > 1 &&
      gamePhase === "placement" &&
      nonLoserQueue.length > 0 &&
      nonLoserQueue[0] === socket.id;

    if (gamePhase !== "movement" && !isNonLoserInRound2Plus) {
      socket.emit(
        "invalidAction",
        "You cannot place new monsters in this phase"
      );
      return;
    }

    const { row, col, type } = data;
    const key = `${row},${col}`;

    // Check if the cell is empty
    if (boardState[key]) {
      socket.emit("invalidAction", "Cell is already occupied");
      return;
    }

    // Check if the placement is on the player's edge
    let isValidEdge = false;
    const gridSize = 10; // Assuming grid size is 10

    if (player.id === 1 && row === 0) isValidEdge = true;
    else if (player.id === 2 && col === 0) isValidEdge = true;
    else if (player.id === 3 && row === gridSize - 1) isValidEdge = true;
    else if (player.id === 4 && col === gridSize - 1) isValidEdge = true;

    if (!isValidEdge) {
      socket.emit("invalidAction", "You must place your monster on your edge");
      return;
    }

    // Update board state
    boardState[key] = {
      playerId: player.id,
      type,
      row,
      col,
    };

    // Add to player's monsters list
    player.monsters.push({
      type,
      row,
      col,
    });

    // Notify all clients about the new monster
    io.emit("newMonsterPlaced", {
      playerId: player.id,
      row,
      col,
      type,
    });

    // Add to game history
    addToGameHistory(
      `Player ${player.id} placed a new ${type} at (${row},${col})`
    );

    // Update board state for all clients
    io.emit("updateBoardState", boardState);

    // If this is a non-loser in round 2+, move to next player
    if (isNonLoserInRound2Plus) {
      // Remove current player from queue
      nonLoserQueue.shift();

      // If there are more non-losers, notify the next one
      if (nonLoserQueue.length > 0) {
        const nextNonLoser = nonLoserQueue[0];
        const nextNonLoserId = players[nextNonLoser].id;

        debugLog(`Moving to next non-loser's turn: Player ${nextNonLoserId}`);

        // Notify all players about the next turn
        io.emit("gameStateUpdate", {
          phase: gamePhase,
          round: currentRound,
          currentTurn: nextNonLoserId,
          message: `Round ${currentRound}: Player ${nextNonLoserId}'s turn to move a monster or place a new one`,
        });

        // Alert the next player that it's their turn
        io.to(nextNonLoser).emit("yourTurn", {
          message: `It's your turn! You can move one of your monsters or place a new one.`,
        });

        // Send available moves to the next player
        const nextPlayerAvailableMoves =
          calculateAvailableMoves(nextNonLoserId);
        io.to(nextNonLoser).emit("availableMoves", nextPlayerAvailableMoves);
      } else {
        // All players have had their turns, process end of round
        debugLog(
          "All non-losers have had their turns. Processing end of round."
        );
        processEndOfRound();
      }
    } else {
      // In regular movement phase, move to next player
      debugLog("Moving to next player's turn in movement phase.");
      advanceToNextTurn();
    }
  });

  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);
    const player = players[socket.id];
    if (player) {
      delete monsterChoices[player.id];
      delete players[socket.id];

      // Remove from loser queue if present
      const loserIndex = loserQueue.indexOf(socket.id);
      if (loserIndex !== -1) {
        loserQueue.splice(loserIndex, 1);
      }

      // Remove from non-loser queue if present
      const nonLoserIndex = nonLoserQueue.indexOf(socket.id);
      if (nonLoserIndex !== -1) {
        nonLoserQueue.splice(nonLoserIndex, 1);
      }

      // If it was this player's turn in movement phase, advance to next player
      if (gamePhase === "movement" && player.id === currentTurn) {
        advanceToNextTurn();
      }

      // If it was this player's turn in placement phase (second+ round), advance to next player
      if (gamePhase === "placement" && currentRound > 1) {
        if (loserQueue.length > 0 && loserQueue[0] === socket.id) {
          loserQueue.shift();

          if (loserQueue.length > 0) {
            const nextLoser = loserQueue[0];
            const nextLoserId = players[nextLoser].id;

            io.emit("gameStateUpdate", {
              phase: gamePhase,
              round: currentRound,
              currentTurn: nextLoserId,
              message: `Round ${currentRound}: Player ${nextLoserId}'s turn to select and place a monster`,
            });

            io.to(nextLoser).emit("yourTurn", {
              message: `It's your turn to select and place a monster!`,
            });

            io.to(nextLoser).emit("selectNewMonster");
          } else if (nonLoserQueue.length > 0) {
            // All losers have placed or disconnected, start non-loser turns
            startNonLoserTurns();
          } else if (Object.keys(players).length > 0) {
            // All players have placed or disconnected, process end of round
            processEndOfRound();
          }
        } else if (nonLoserQueue.length > 0 && nonLoserQueue[0] === socket.id) {
          nonLoserQueue.shift();

          if (nonLoserQueue.length > 0) {
            const nextNonLoser = nonLoserQueue[0];
            const nextNonLoserId = players[nextNonLoser].id;

            io.emit("gameStateUpdate", {
              phase: gamePhase,
              round: currentRound,
              currentTurn: nextNonLoserId,
              message: `Round ${currentRound}: Player ${nextNonLoserId}'s turn to move a monster or place a new one`,
            });

            io.to(nextNonLoser).emit("yourTurn", {
              message: `It's your turn! You can move one of your monsters or place a new one.`,
            });

            // Send available moves to the next player
            const availableMoves = calculateAvailableMoves(nextNonLoserId);
            io.to(nextNonLoser).emit("availableMoves", availableMoves);
          } else if (Object.keys(players).length > 0) {
            // All players have placed or disconnected, process end of round
            processEndOfRound();
          }
        }
      }
    }
  });
});

// Start turns for non-losers in round 2+
function startNonLoserTurns() {
  if (nonLoserQueue.length === 0) {
    // No non-losers, process end of round
    processEndOfRound();
    return;
  }

  const firstNonLoser = nonLoserQueue[0];
  const firstNonLoserId = players[firstNonLoser].id;
  currentTurn = firstNonLoserId;

  debugLog(`Starting non-loser turns with Player ${firstNonLoserId}`);

  // Notify all players about the next turn
  io.emit("gameStateUpdate", {
    phase: gamePhase,
    round: currentRound,
    currentTurn: firstNonLoserId,
    message: `Round ${currentRound}: Player ${firstNonLoserId}'s turn to move a monster or place a new one`,
  });

  // Alert the player that it's their turn
  io.to(firstNonLoser).emit("yourTurn", {
    message: `It's your turn! You can move one of your monsters or place a new one.`,
  });

  // Send available moves to the player
  const availableMoves = calculateAvailableMoves(firstNonLoserId);
  io.to(firstNonLoser).emit("availableMoves", availableMoves);
}

// Process end of round (resolve conflicts, update board, prepare next round)
function processEndOfRound() {
  debugLog("Processing end of round");
  console.log("All players submitted. Resolving conflicts...");

  // Resolve conflicts
  const resolvedPositions = resolveConflicts(finalPositions);
  console.log("Resolved survivors:", resolvedPositions);

  // Update board state after conflict resolution
  boardState = {};
  for (const [playerId, pos] of Object.entries(resolvedPositions)) {
    const key = `${pos.row},${pos.col}`;
    boardState[key] = {
      playerId: parseInt(playerId),
      type: pos.type,
      row: pos.row,
      col: pos.col,
    };
  }

  // Update each player's monsters list and count removed monsters
  for (const socketId in players) {
    const player = players[socketId];

    // Count monsters before update
    const previousMonsterCount = player.monsters.length;

    // Reset monsters list
    player.monsters = [];

    // Add surviving monsters to player's list
    for (const [pid, pos] of Object.entries(resolvedPositions)) {
      if (parseInt(pid) === player.id) {
        player.monsters.push({
          type: pos.type,
          row: pos.row,
          col: pos.col,
        });
      }
    }

    // Calculate monsters removed this round
    const monstersRemovedThisRound =
      previousMonsterCount - player.monsters.length;
    if (monstersRemovedThisRound > 0) {
      monstersRemoved[player.id] += monstersRemovedThisRound;

      // Check for elimination (10 or more monsters removed)
      if (
        monstersRemoved[player.id] >= 10 &&
        !eliminatedPlayers.includes(player.id)
      ) {
        eliminatedPlayers.push(player.id);
        addToGameHistory(`Player ${player.id} has been eliminated!`);
        io.emit("playerEliminated", {
          playerId: player.id,
          message: `Player ${player.id} has been eliminated!`,
        });
      }
    }
  }

  // Find losers (players with no monsters)
  const losers = Object.keys(players).filter((socketId) => {
    const player = players[socketId];
    return (
      player.monsters.length === 0 && !eliminatedPlayers.includes(player.id)
    );
  });

  // Find non-losers (players with monsters)
  const nonLosers = Object.keys(players).filter((socketId) => {
    const player = players[socketId];
    return player.monsters.length > 0 && !eliminatedPlayers.includes(player.id);
  });

  // Save to round history
  roundHistory.push({
    round: currentRound,
    resolvedPositions,
    losers: losers.map((id) => players[id].id),
    nonLosers: nonLosers.map((id) => players[id].id),
  });

  // Update scores
  for (const [playerId, pos] of Object.entries(resolvedPositions)) {
    playerScores[playerId]++;
  }

  // Broadcast updated scores
  io.emit("updateScores", playerScores);

  // Broadcast updated board state
  io.emit("updateBoardState", boardState);

  // Add to game history
  addToGameHistory(
    `Round ${currentRound} completed. ${
      Object.keys(resolvedPositions).length
    } monsters survived.`
  );

  // Check for game end conditions

  // 1. Check if only one player remains (all others eliminated)
  const remainingPlayers = Object.keys(players).filter(
    (socketId) => !eliminatedPlayers.includes(players[socketId].id)
  );

  if (remainingPlayers.length === 1) {
    const winnerId = players[remainingPlayers[0]].id;
    addToGameHistory(`Player ${winnerId} has won the game!`);
    io.emit("gameWinner", {
      playerId: winnerId,
      message: `Player ${winnerId} has won the game!`,
    });
    resetGame();
    return;
  }

  // 2. Check if maximum rounds reached
  if (currentRound >= maxRounds) {
    // Find player with highest score
    let highestScore = 0;
    let winners = [];

    for (const [playerId, score] of Object.entries(playerScores)) {
      if (score > highestScore) {
        highestScore = score;
        winners = [parseInt(playerId)];
      } else if (score === highestScore) {
        winners.push(parseInt(playerId));
      }
    }

    if (winners.length === 1) {
      addToGameHistory(
        `Player ${winners[0]} has won the game with ${highestScore} points!`
      );
      io.emit("gameWinner", {
        playerId: winners[0],
        message: `Player ${winners[0]} has won the game with ${highestScore} points!`,
      });
    } else {
      const winnersList = winners.join(", ");
      addToGameHistory(
        `Game ended in a tie between Players ${winnersList} with ${highestScore} points each!`
      );
      io.emit("gameTie", {
        message: `Game ended in a tie between Players ${winnersList} with ${highestScore} points each!`,
      });
    }

    resetGame();
    return;
  }

  // Prepare for next round
  currentRound++;
  io.emit("updateRound", currentRound);

  // Reset for next round
  monsterChoices = {};
  finalPositions = {};

  // Shuffle losers and non-losers for random turn order
  loserQueue = shuffleArray(losers);
  nonLoserQueue = shuffleArray(nonLosers);

  debugLog(
    `Next round: ${currentRound}. Losers: ${loserQueue.length}, Non-losers: ${nonLoserQueue.length}`
  );

  // If there are losers, start with them
  if (loserQueue.length > 0) {
    const firstLoser = loserQueue[0];
    const firstLoserId = players[firstLoser].id;
    currentTurn = firstLoserId;

    // Notify all players about the next turn
    io.emit("gameStateUpdate", {
      phase: gamePhase,
      round: currentRound,
      currentTurn: firstLoserId,
      message: `Round ${currentRound}: Player ${firstLoserId}'s turn to select and place a monster`,
    });

    // Alert the player that it's their turn
    io.to(firstLoser).emit("yourTurn", {
      message: `It's your turn to select and place a monster!`,
    });

    // Enable monster selection for the first loser
    io.to(firstLoser).emit("selectNewMonster");

    // Notify non-losers that they're waiting for losers
    for (const nonLoser of nonLosers) {
      io.to(nonLoser).emit("waitForLosers", {
        message: `Waiting for losers to place new monsters...`,
      });
    }
  } else if (nonLoserQueue.length > 0) {
    // No losers, start with non-losers
    startNonLoserTurns();
  } else {
    // No players left, reset game
    resetGame();
  }
}

// Reset game
function resetGame() {
  currentRound = 1;
  gamePhase = "placement";
  boardState = {};
  monsterChoices = {};
  finalPositions = {};
  loserQueue = [];
  nonLoserQueue = [];
  monstersRemoved = { 1: 0, 2: 0, 3: 0, 4: 0 };
  eliminatedPlayers = [];
  playerScores = { 1: 0, 2: 0, 3: 0, 4: 0 };
  currentTurn = null;

  // Reset player monsters
  for (const socketId in players) {
    players[socketId].monsters = [];
  }

  // Notify all players
  io.emit("gameStateUpdate", {
    phase: gamePhase,
    round: currentRound,
    message:
      "Game reset. All players can select and place monsters simultaneously",
  });

  // Update board state for all clients
  io.emit("updateBoardState", boardState);

  // Update scores for all clients
  io.emit("updateScores", playerScores);
}

// Advance to next player's turn in movement phase
function advanceToNextTurn() {
  // Get array of active players (not eliminated)
  const activePlayers = Object.keys(players).filter(
    (socketId) => !eliminatedPlayers.includes(players[socketId].id)
  );

  if (activePlayers.length <= 1) {
    // Game over, only one player left
    if (activePlayers.length === 1) {
      const winnerId = players[activePlayers[0]].id;
      addToGameHistory(`Player ${winnerId} has won the game!`);
      io.emit("gameWinner", {
        playerId: winnerId,
        message: `Player ${winnerId} has won the game!`,
      });
    }
    resetGame();
    return;
  }

  // Find current player index
  let currentPlayerIndex = -1;
  for (let i = 0; i < activePlayers.length; i++) {
    if (players[activePlayers[i]].id === currentTurn) {
      currentPlayerIndex = i;
      break;
    }
  }

  // Move to next player
  currentPlayerIndex = (currentPlayerIndex + 1) % activePlayers.length;
  const nextPlayer = activePlayers[currentPlayerIndex];
  currentTurn = players[nextPlayer].id;

  debugLog(`Moving to next player's turn: Player ${currentTurn}`);

  // Notify all players about the next turn
  io.emit("gameStateUpdate", {
    phase: gamePhase,
    round: currentRound,
    currentTurn,
    message: `Round ${currentRound}: Player ${currentTurn}'s turn`,
  });

  // Alert the player that it's their turn
  io.to(nextPlayer).emit("yourTurn", {
    message: `It's your turn!`,
  });

  // Send available moves to the next player
  const availableMoves = calculateAvailableMoves(currentTurn);
  io.to(nextPlayer).emit("availableMoves", availableMoves);

  // Check if we've completed a full round (all players have had a turn)
  if (currentPlayerIndex === 0) {
    // End of round in movement phase
    processEndOfRound();
  }
}

// Calculate available moves for a player's monster
function calculateAvailableMoves(playerId, fromRow, fromCol) {
  const availableMoves = [];
  const gridSize = 10;

  // If specific monster coordinates are provided, calculate moves for that monster
  if (fromRow !== undefined && fromCol !== undefined) {
    const fromKey = `${fromRow},${fromCol}`;

    // Check if there's a monster at this position and it belongs to the player
    if (!boardState[fromKey] || boardState[fromKey].playerId !== playerId) {
      return [];
    }

    // Check horizontal and vertical moves (any number of squares)
    // Up
    for (let row = fromRow - 1; row >= 0; row--) {
      const key = `${row},${fromCol}`;
      if (boardState[key]) {
        // If it's player's own monster, can move over it
        if (boardState[key].playerId === playerId) {
          continue;
        }
        // If it's another player's monster, can't move further
        break;
      }
      availableMoves.push({ fromRow, fromCol, toRow: row, toCol: fromCol });
    }

    // Down
    for (let row = fromRow + 1; row < gridSize; row++) {
      const key = `${row},${fromCol}`;
      if (boardState[key]) {
        // If it's player's own monster, can move over it
        if (boardState[key].playerId === playerId) {
          continue;
        }
        // If it's another player's monster, can't move further
        break;
      }
      availableMoves.push({ fromRow, fromCol, toRow: row, toCol: fromCol });
    }

    // Left
    for (let col = fromCol - 1; col >= 0; col--) {
      const key = `${fromRow},${col}`;
      if (boardState[key]) {
        // If it's player's own monster, can move over it
        if (boardState[key].playerId === playerId) {
          continue;
        }
        // If it's another player's monster, can't move further
        break;
      }
      availableMoves.push({ fromRow, fromCol, toRow: fromRow, toCol: col });
    }

    // Right
    for (let col = fromCol + 1; col < gridSize; col++) {
      const key = `${fromRow},${col}`;
      if (boardState[key]) {
        // If it's player's own monster, can move over it
        if (boardState[key].playerId === playerId) {
          continue;
        }
        // If it's another player's monster, can't move further
        break;
      }
      availableMoves.push({ fromRow, fromCol, toRow: fromRow, toCol: col });
    }

    // Check diagonal moves (up to 2 squares)
    const diagonalDirections = [
      [-1, -1], // Up-left
      [-1, 1], // Up-right
      [1, -1], // Down-left
      [1, 1], // Down-right
    ];

    for (const [rowDir, colDir] of diagonalDirections) {
      for (let steps = 1; steps <= 2; steps++) {
        const row = fromRow + rowDir * steps;
        const col = fromCol + colDir * steps;

        // Check if within grid bounds
        if (row < 0 || row >= gridSize || col < 0 || col >= gridSize) {
          break;
        }

        const key = `${row},${col}`;
        if (boardState[key]) {
          // If it's player's own monster, can move over it
          if (boardState[key].playerId === playerId) {
            continue;
          }
          // If it's another player's monster, can't move further
          break;
        }

        availableMoves.push({ fromRow, fromCol, toRow: row, toCol: col });
      }
    }

    return availableMoves;
  }

  // If no specific monster coordinates provided, calculate moves for all player's monsters
  for (const key in boardState) {
    if (boardState[key].playerId === playerId) {
      const [row, col] = key.split(",").map(Number);
      const monsterMoves = calculateAvailableMoves(playerId, row, col);
      availableMoves.push(...monsterMoves);
    }
  }

  return availableMoves;
}

// Resolve conflicts between monsters placed on the same cell
function resolveConflicts(positions) {
  const conflicts = {};
  const survivors = {};

  // Group monsters by position
  for (const [playerId, pos] of Object.entries(positions)) {
    const key = `${pos.row},${pos.col}`;
    if (!conflicts[key]) {
      conflicts[key] = [];
    }
    conflicts[key].push({ playerId: parseInt(playerId), type: pos.type });
  }

  // Resolve conflicts
  for (const [key, monsters] of Object.entries(conflicts)) {
    if (monsters.length === 1) {
      // No conflict, monster survives
      const monster = monsters[0];
      survivors[monster.playerId] = {
        ...positions[monster.playerId],
      };
    } else {
      // Conflict, apply rules
      const [row, col] = key.split(",").map(Number);

      // Count monster types
      const vampireCount = monsters.filter((m) => m.type === "vampire").length;
      const werewolfCount = monsters.filter(
        (m) => m.type === "werewolf"
      ).length;
      const ghostCount = monsters.filter((m) => m.type === "ghost").length;

      // Apply rules
      if (vampireCount > 0 && werewolfCount > 0 && ghostCount === 0) {
        // Vampire vs Werewolf: Werewolf wins
        for (const monster of monsters) {
          if (monster.type === "werewolf") {
            survivors[monster.playerId] = {
              ...positions[monster.playerId],
            };
            break; // Only one werewolf survives if multiple
          }
        }
      } else if (vampireCount > 0 && ghostCount > 0 && werewolfCount === 0) {
        // Vampire vs Ghost: Vampire wins
        for (const monster of monsters) {
          if (monster.type === "vampire") {
            survivors[monster.playerId] = {
              ...positions[monster.playerId],
            };
            break; // Only one vampire survives if multiple
          }
        }
      } else if (werewolfCount > 0 && ghostCount > 0 && vampireCount === 0) {
        // Werewolf vs Ghost: Ghost wins
        for (const monster of monsters) {
          if (monster.type === "ghost") {
            survivors[monster.playerId] = {
              ...positions[monster.playerId],
            };
            break; // Only one ghost survives if multiple
          }
        }
      } else if (vampireCount > 0 && werewolfCount > 0 && ghostCount > 0) {
        // All three types: Nobody survives
        // No survivors to add
      } else {
        // Same type conflict: Random survivor
        const randomIndex = Math.floor(Math.random() * monsters.length);
        const survivor = monsters[randomIndex];
        survivors[survivor.playerId] = {
          ...positions[survivor.playerId],
        };
      }
    }
  }

  return survivors;
}

// Add entry to game history with timestamp
function addToGameHistory(message) {
  const timestamp = new Date().toLocaleTimeString();
  io.emit("gameHistoryUpdate", {
    timestamp,
    message,
  });
}

// Shuffle array (Fisher-Yates algorithm)
function shuffleArray(array) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
