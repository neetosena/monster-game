const socket = io();
let playerId;
let monsterChoices = {}; // received from server when all chosen
let chosenMonster = null;
let hasPlaced = false;
let myPosition = null;
let boardState = {}; // Current state of the board
let selectedMonster = null; // Currently selected monster for movement
let isMyTurn = false; // Flag to track if it's the current player's turn
let currentGamePhase = "placement"; // "placement" or "movement"
let availableMoves = []; // Available moves for the current player
let currentRound = 1;
let isDragging = false; // Flag to track if a monster is being dragged
let dragStartPos = null; // Starting position of the dragged monster
const gridSize = 10;
const boardEl = document.getElementById("grid");
let gameHistory = []; // Store game history
let waitingForServerResponse = false; // Flag to track if we're waiting for server response

// PLAYERS COLORS
const playerColors = {
  1: "#f28b82", // Player 1 = red
  2: "#fbbc04", // Player 2 = yellow
  3: "#34a853", // Player 3 = green
  4: "#4285f4", // Player 4 = blue
};

// MONSTER EMOJIS
const monsterEmojis = {
  vampire: "🧛",
  werewolf: "🐺",
  ghost: "👻",
};

// Debug logging function
function debugLog(message) {
  console.log(`[CLIENT DEBUG] ${message}`);
  // Add to game history for visibility
  addToGameHistory(`DEBUG: ${message}`);
}

socket.on("playerAssigned", (id) => {
  playerId = id;
  console.log("You are Player", playerId);
  const playerLabel = document.getElementById("player-id");
  playerLabel.textContent = `You are Player ${playerId}`;
  playerLabel.style.color = playerColors[playerId]; // 🎨 apply color

  createBoard();
  highlightPlayerEdge(); // Highlight player's edge immediately after board creation

  // Add initial game history entry
  addToGameHistory(`You joined as Player ${playerId}`);

  // Reset waiting flag
  waitingForServerResponse = false;
});

socket.on("gameStateUpdate", (data) => {
  const { phase, round, currentTurn, message } = data;

  debugLog(
    `Game state update: phase=${phase}, round=${round}, currentTurn=${currentTurn}`
  );

  // Reset waiting flag on any game state update
  waitingForServerResponse = false;

  // Update game phase
  currentGamePhase = phase;
  currentRound = round;

  // Check if it's this player's turn (only relevant in movement phase or second+ round placement)
  isMyTurn = currentTurn === playerId;

  // In first round, all players can act simultaneously
  if (phase === "placement" && round === 1) {
    isMyTurn = true;
  }

  // Update UI to show game state
  const turnIndicator = document.getElementById("turn-indicator");
  turnIndicator.textContent = message;

  if (currentTurn) {
    turnIndicator.style.color = playerColors[currentTurn];
  } else {
    turnIndicator.style.color = "#333"; // Default color for general messages
  }

  // Update round number
  document.getElementById("round-number").textContent = `Round ${round}`;

  // Enable/disable controls based on phase and turn
  if (phase === "placement" && round === 1) {
    // In first round placement phase, all players can select monsters simultaneously
    document.getElementById("monsterSelect").disabled = false;

    // Hide action buttons in first round
    document.getElementById("action-buttons").style.display = "none";

    // Update instruction
    document.getElementById("action-instruction").textContent =
      "Select a monster type and place it on your edge";
  } else if (phase === "placement" && round > 1) {
    // In second+ round placement phase, only current player can act
    if (isMyTurn) {
      // Enable monster selection dropdown for all players in their turn
      document.getElementById("monsterSelect").disabled = false;

      // If player has monsters, show both options
      if (hasPlayerMonsters()) {
        document.getElementById("action-instruction").textContent =
          "Choose an action: Select a monster type to add, or drag your monster to move";
      } else {
        // If player has no monsters (loser), they can only add
        document.getElementById("action-instruction").textContent =
          "Select a monster type and click on your edge to place it";
      }
    } else {
      // Not player's turn, disable controls
      document.getElementById("monsterSelect").disabled = true;
      document.getElementById("action-instruction").textContent =
        "Waiting for other players...";
    }
  } else if (phase === "movement") {
    // In movement phase, only current player can act
    if (isMyTurn) {
      // Enable monster selection dropdown for adding new monsters
      document.getElementById("monsterSelect").disabled = false;
      document.getElementById("action-instruction").textContent =
        "Your turn: Select a monster type to add, or drag your monster to move";

      // Highlight player's monsters that can be moved
      highlightPlayerMonsters();

      // Request available moves for all player's monsters
      requestAvailableMovesForAllMonsters();
    } else {
      // Not player's turn, disable controls
      document.getElementById("monsterSelect").disabled = true;
      document.getElementById("action-instruction").textContent =
        "Waiting for other players...";
      removeAllHighlights();
      highlightPlayerEdge();
    }
  }

  // Always render the board to update monster draggability
  renderBoard();
});

// Request available moves for all player's monsters
function requestAvailableMovesForAllMonsters() {
  debugLog("Requesting available moves for all monsters");

  // Find all player's monsters on the board
  for (const key in boardState) {
    if (boardState[key].playerId === playerId) {
      const [row, col] = key.split(",").map(Number);
      // Request available moves for this monster
      socket.emit("getAvailableMoves", { fromRow: row, fromCol: col });
    }
  }
}

socket.on("yourTurn", (data) => {
  // Alert the player that it's their turn
  alert(data.message);

  // Reset waiting flag
  waitingForServerResponse = false;

  // If player has monsters, request available moves
  if (hasPlayerMonsters()) {
    requestAvailableMovesForAllMonsters();
  }
});

socket.on("selectNewMonster", () => {
  document.getElementById("monsterSelect").disabled = false;
  document.getElementById("monsterSelect").value = ""; // reset
  chosenMonster = null;
  hasPlaced = false;

  // Reset waiting flag
  waitingForServerResponse = false;
});

socket.on("waitForLosers", (data) => {
  // Display message that we're waiting for losers to place
  const turnIndicator = document.getElementById("turn-indicator");
  turnIndicator.textContent = data.message;
  turnIndicator.style.color = "#666"; // Neutral color

  // Disable controls
  document.getElementById("monsterSelect").disabled = true;
  document.getElementById("action-instruction").textContent =
    "Waiting for losers to place new monsters...";

  // Reset waiting flag
  waitingForServerResponse = false;
});

socket.on("monsterSelectionConfirmed", (monster) => {
  // Server confirmed monster selection
  chosenMonster = monster;
  debugLog(`Monster selection confirmed: ${monster}`);

  // Highlight allowed cells for placement
  highlightAllowedCells();

  // Reset waiting flag
  waitingForServerResponse = false;
});

socket.on("positionReceived", (data) => {
  // Server confirmed position received
  debugLog(`Position received: ${data.message}`);

  // Disable monster selection until next round
  document.getElementById("monsterSelect").disabled = true;
  document.getElementById("action-instruction").textContent =
    "Monster placed successfully. Waiting for other players...";

  // Reset waiting flag
  waitingForServerResponse = false;
});

socket.on("invalidAction", (message) => {
  alert(message);

  // Reset waiting flag
  waitingForServerResponse = false;
});

document.getElementById("monsterSelect").addEventListener("change", (e) => {
  const monster = e.target.value;
  if (!monster) return;

  chosenMonster = monster;
  socket.emit("monsterChosen", monster);
  debugLog(`Monster selected: ${monster}`);

  // Set waiting flag
  waitingForServerResponse = true;

  // Highlight allowed cells for placement
  highlightAllowedCells();
});

function hasPlayerMonsters() {
  // Check if player has any monsters on the board
  for (const key in boardState) {
    if (boardState[key].playerId === playerId) {
      return true;
    }
  }
  return false;
}

socket.on("allMonstersChosen", (choices) => {
  monsterChoices = choices;
  debugLog("All monsters chosen. Waiting for all positions...");

  // Reset waiting flag
  waitingForServerResponse = false;
});

socket.on("updateScores", (scores) => {
  displayScores(scores);

  // Reset waiting flag
  waitingForServerResponse = false;
});

socket.on("updateRound", (round) => {
  currentRound = round;
  document.getElementById("round-number").textContent = `Round ${round}`;

  // Reset waiting flag
  waitingForServerResponse = false;
});

socket.on("updateBoardState", (newBoardState) => {
  boardState = newBoardState;
  debugLog("Board state updated");

  renderBoard();
  highlightPlayerEdge(); // Always ensure player's edge is highlighted

  // If it's player's turn, highlight their monsters for movement
  if (isMyTurn && hasPlayerMonsters()) {
    highlightPlayerMonsters();

    // Request available moves for all player's monsters
    requestAvailableMovesForAllMonsters();
  }

  // Reset waiting flag
  waitingForServerResponse = false;
});

socket.on("availableMoves", (moves) => {
  // Update available moves
  availableMoves = moves;
  debugLog(`Received ${moves.length} available moves`);

  // If a monster is currently selected, highlight its moves
  if (selectedMonster) {
    highlightAvailableMoves(selectedMonster.row, selectedMonster.col);
  }

  // Reset waiting flag
  waitingForServerResponse = false;
});

socket.on("monsterMoved", (data) => {
  debugLog(
    `Monster moved: from (${data.fromRow},${data.fromCol}) to (${data.toRow},${data.toCol})`
  );
  // Update will come through updateBoardState

  // Reset waiting flag
  waitingForServerResponse = false;
});

socket.on("newMonsterPlaced", (data) => {
  debugLog(`New monster placed: ${data.type} at (${data.row},${data.col})`);
  // Update will come through updateBoardState

  // Reset waiting flag
  waitingForServerResponse = false;
});

socket.on("gameHistoryUpdate", (entry) => {
  addToGameHistory(`${entry.timestamp}: ${entry.message}`);

  // Reset waiting flag
  waitingForServerResponse = false;
});

socket.on("playerEliminated", (data) => {
  addToGameHistory(`Player ${data.playerId} has been eliminated!`);

  // If it's this player who was eliminated
  if (data.playerId === playerId) {
    alert("You have been eliminated from the game!");
  }

  // Reset waiting flag
  waitingForServerResponse = false;
});

socket.on("gameWinner", (data) => {
  addToGameHistory(`Player ${data.playerId} has won the game!`);

  // If it's this player who won
  if (data.playerId === playerId) {
    alert("Congratulations! You have won the game!");
  } else {
    alert(`Player ${data.playerId} has won the game!`);
  }

  // Reset waiting flag
  waitingForServerResponse = false;
});

socket.on("gameTie", (data) => {
  addToGameHistory(data.message);
  alert(data.message);

  // Reset waiting flag
  waitingForServerResponse = false;
});

socket.on("syncMonsterPositions", (positions) => {
  // Convert positions to boardState format
  const newBoardState = {};

  for (const [playerId, pos] of Object.entries(positions)) {
    const key = `${pos.row},${pos.col}`;
    newBoardState[key] = {
      playerId: parseInt(playerId),
      type: pos.type,
      row: pos.row,
      col: pos.col,
    };
  }

  boardState = newBoardState;
  debugLog("Monster positions synced");
  renderBoard();

  // Reset waiting flag
  waitingForServerResponse = false;
});

function displayScores(scores) {
  const scoreEl = document.getElementById("scores");
  scoreEl.innerHTML = "";
  for (const [playerId, score] of Object.entries(scores)) {
    const color = playerColors[playerId] || "#ccc";
    const p = document.createElement("p");
    p.textContent = `Player ${playerId}: ${score}`;
    p.style.color = color;
    scoreEl.appendChild(p);
  }
}

function addToGameHistory(message) {
  // Add to local history array
  gameHistory.push(message);

  // Update UI
  const historyEl = document.getElementById("game-history");
  if (!historyEl) return; // Safety check

  // Create new entry
  const entry = document.createElement("div");
  entry.className = "history-entry";
  entry.textContent = message;

  // Add to history container
  historyEl.appendChild(entry);

  // Scroll to bottom
  historyEl.scrollTop = historyEl.scrollHeight;

  // Limit history length in UI (keep last 50 entries)
  while (historyEl.children.length > 50) {
    historyEl.removeChild(historyEl.firstChild);
  }
}

// GRID LOGIC
function createBoard() {
  boardEl.innerHTML = "";

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const cell = document.createElement("div");
      cell.classList.add("cell");
      cell.dataset.row = row;
      cell.dataset.col = col;

      // Add event listeners for cell click
      cell.addEventListener("click", () => handleCellClick(row, col, cell));

      // Add event listeners for drag and drop
      cell.addEventListener("dragover", (e) => handleDragOver(e, row, col));
      cell.addEventListener("drop", (e) => handleDrop(e, row, col));

      boardEl.appendChild(cell);
    }
  }
}

// Function to highlight player's edge with their color
function highlightPlayerEdge() {
  const cells = document.querySelectorAll(".cell");

  // Remove previous edge highlights
  cells.forEach((cell) => {
    cell.classList.remove("player-edge");
    cell.style.borderColor = "";
  });

  // Add player's edge highlight
  cells.forEach((cell) => {
    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);

    let isPlayerEdge = false;

    if (playerId === 1 && row === 0) isPlayerEdge = true;
    else if (playerId === 2 && col === 0) isPlayerEdge = true;
    else if (playerId === 3 && row === gridSize - 1) isPlayerEdge = true;
    else if (playerId === 4 && col === gridSize - 1) isPlayerEdge = true;

    if (isPlayerEdge) {
      cell.classList.add("player-edge");

      // Apply player's color to the appropriate border
      if (playerId === 1) {
        // Top edge (Player 1)
        cell.style.borderTopColor = playerColors[playerId];
        cell.style.borderTopWidth = "4px";
      } else if (playerId === 2) {
        // Left edge (Player 2)
        cell.style.borderLeftColor = playerColors[playerId];
        cell.style.borderLeftWidth = "4px";
      } else if (playerId === 3) {
        // Bottom edge (Player 3)
        cell.style.borderBottomColor = playerColors[playerId];
        cell.style.borderBottomWidth = "4px";
      } else if (playerId === 4) {
        // Right edge (Player 4)
        cell.style.borderRightColor = playerColors[playerId];
        cell.style.borderRightWidth = "4px";
      }
    }
  });
}

function highlightAllowedCells() {
  const cells = document.querySelectorAll(".cell");

  // Remove gameplay highlights but keep edge highlighting
  removeAllHighlights();
  highlightPlayerEdge();

  cells.forEach((cell) => {
    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);

    let isAllowed = false;

    if (playerId === 1 && row === 0) isAllowed = true;
    else if (playerId === 2 && col === 0) isAllowed = true;
    else if (playerId === 3 && row === gridSize - 1) isAllowed = true;
    else if (playerId === 4 && col === gridSize - 1) isAllowed = true;

    // Check if cell is empty
    const key = `${row},${col}`;
    if (boardState[key]) {
      isAllowed = false;
    }

    if (isAllowed) {
      cell.classList.add("allowed");
    }
  });
}

function highlightPlayerMonsters() {
  const cells = document.querySelectorAll(".cell");

  // Remove gameplay highlights but keep edge highlighting
  removeAllHighlights();
  highlightPlayerEdge();

  cells.forEach((cell) => {
    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);
    const key = `${row},${col}`;

    // Check if this cell contains player's monster
    if (boardState[key] && boardState[key].playerId === playerId) {
      cell.classList.add("selectable");
    }
  });
}

function highlightAvailableMoves(fromRow, fromCol) {
  const cells = document.querySelectorAll(".cell");

  // Remove move highlights first but keep edge highlighting
  cells.forEach((cell) => cell.classList.remove("move-target"));

  // Request available moves from server if not already available
  if (!availableMoves || availableMoves.length === 0) {
    socket.emit("getAvailableMoves", { fromRow, fromCol });
    return;
  }

  // Find moves for the selected monster
  const moves = availableMoves.filter(
    (move) => move.fromRow === fromRow && move.fromCol === fromCol
  );

  debugLog(
    `Highlighting ${moves.length} available moves for monster at (${fromRow},${fromCol})`
  );

  // Highlight available destination cells
  moves.forEach((move) => {
    const cell = [...cells].find(
      (c) =>
        parseInt(c.dataset.row) === move.toRow &&
        parseInt(c.dataset.col) === move.toCol
    );
    if (cell) {
      cell.classList.add("move-target");
    }
  });
}

function removeAllHighlights() {
  const cells = document.querySelectorAll(".cell");
  cells.forEach((cell) => {
    cell.classList.remove("allowed", "selectable", "selected", "move-target");
    // Note: We don't remove "player-edge" class here as we want to keep edge highlighting
  });
}

// HANDLE PLAYER ACTIONS
function handleCellClick(row, col, cellEl) {
  // If we're waiting for server response, ignore clicks
  if (waitingForServerResponse) {
    debugLog("Ignoring click - waiting for server response");
    return;
  }

  const key = `${row},${col}`;

  // In first round, all players can act simultaneously
  if (currentGamePhase === "placement" && currentRound === 1) {
    // First round placement - standard placement logic
    handlePlacementPhaseClick(row, col, cellEl);
    return;
  }

  // For other rounds, only allow actions if it's player's turn
  if (!isMyTurn) {
    alert("It's not your turn!");
    return;
  }

  // Check if this is a placement action (clicking on edge with monster selected)
  const isOnPlayerEdge =
    (playerId === 1 && row === 0) ||
    (playerId === 2 && col === 0) ||
    (playerId === 3 && row === gridSize - 1) ||
    (playerId === 4 && col === gridSize - 1);

  if (isOnPlayerEdge && chosenMonster && !boardState[key]) {
    // This is a placement action
    handlePlacementPhaseClick(row, col, cellEl);
    return;
  }

  // Check if this is a monster selection for movement
  if (boardState[key] && boardState[key].playerId === playerId) {
    // Select this monster for movement
    selectedMonster = {
      row,
      col,
      type: boardState[key].type,
    };

    debugLog(`Selected monster at (${row},${col}) for movement`);

    // Highlight the selected monster
    cellEl.classList.add("selected");

    // Highlight available moves for this monster
    highlightAvailableMoves(row, col);

    return;
  }

  // Check if this is a move destination for a selected monster
  if (selectedMonster) {
    const isValidMove = availableMoves.some(
      (move) =>
        move.fromRow === selectedMonster.row &&
        move.fromCol === selectedMonster.col &&
        move.toRow === row &&
        move.toCol === col
    );

    if (isValidMove) {
      // Move the monster
      debugLog(
        `Moving monster from (${selectedMonster.row},${selectedMonster.col}) to (${row},${col})`
      );

      socket.emit("moveMonster", {
        fromRow: selectedMonster.row,
        fromCol: selectedMonster.col,
        toRow: row,
        toCol: col,
      });

      // Set waiting flag
      waitingForServerResponse = true;

      // Update local boardState to show the move immediately
      const fromKey = `${selectedMonster.row},${selectedMonster.col}`;
      const toKey = `${row},${col}`;

      if (boardState[fromKey]) {
        boardState[toKey] = { ...boardState[fromKey], row, col };
        delete boardState[fromKey];
        renderBoard();
      }

      // Reset selection
      selectedMonster = null;
      removeAllHighlights();
    } else {
      alert("Invalid move. Please select a highlighted destination.");
    }
  }
}

function handlePlacementPhaseClick(row, col, cellEl) {
  if (!chosenMonster) {
    alert("Choose a monster first from the dropdown menu!");
    return;
  }

  if (hasPlaced && currentRound === 1) {
    alert("You've already placed your monster this round.");
    return;
  }

  const isValid =
    (playerId === 1 && row === 0) ||
    (playerId === 2 && col === 0) ||
    (playerId === 3 && row === gridSize - 1) ||
    (playerId === 4 && col === gridSize - 1);

  if (!isValid) {
    alert("You must place your monster on your edge.");
    return;
  }

  // Check if cell is empty
  const key = `${row},${col}`;
  if (boardState[key]) {
    alert("This cell is already occupied.");
    return;
  }

  // Create a temporary visual representation of the monster
  const tempIcon = document.createElement("div");
  tempIcon.textContent = monsterEmojis[chosenMonster] || "❓";
  tempIcon.className = "icon";
  tempIcon.style.backgroundColor = playerColors[playerId];
  tempIcon.style.color = "white";

  // Add to cell
  cellEl.innerHTML = "";
  cellEl.appendChild(tempIcon);
  cellEl.classList.add("placed");

  // Send to server
  if (currentGamePhase === "movement") {
    // In movement phase, use placeNewMonster
    debugLog(
      `Placing new monster (${chosenMonster}) at (${row},${col}) in movement phase`
    );
    socket.emit("placeNewMonster", {
      row,
      col,
      type: chosenMonster,
    });
  } else {
    // In placement phase, use finalMonsterPositions
    debugLog(
      `Placing monster (${chosenMonster}) at (${row},${col}) in placement phase`
    );
    myPosition = { row, col, type: chosenMonster };
    socket.emit("finalMonsterPositions", { [playerId]: myPosition });
    hasPlaced = true;
  }

  // Set waiting flag
  waitingForServerResponse = true;

  // Update local boardState to show the monster immediately
  boardState[key] = {
    playerId: playerId,
    type: chosenMonster,
    row: row,
    col: col,
  };

  // Reset monster selection
  document.getElementById("monsterSelect").value = "";
  chosenMonster = null;
}

// DRAG AND DROP HANDLERS
function handleDragOver(e, row, col) {
  e.preventDefault();

  // If we're waiting for server response or it's not our turn, ignore drag events
  if (waitingForServerResponse || !isMyTurn) {
    return;
  }

  // Only highlight valid drop targets
  if (selectedMonster) {
    const isValidMove = availableMoves.some(
      (move) =>
        move.fromRow === selectedMonster.row &&
        move.fromCol === selectedMonster.col &&
        move.toRow === row &&
        move.toCol === col
    );

    if (isValidMove) {
      e.dataTransfer.dropEffect = "move";
      e.currentTarget.classList.add("move-target");
    } else {
      e.dataTransfer.dropEffect = "none";
    }
  }
}

function handleDrop(e, row, col) {
  e.preventDefault();

  // If we're waiting for server response or it's not our turn, ignore drop events
  if (waitingForServerResponse || !isMyTurn) {
    debugLog("Ignoring drop - waiting for server response or not your turn");
    return;
  }

  // Get the dragged monster's position from the data transfer
  const data = e.dataTransfer.getData("text/plain");
  if (!data) {
    debugLog("No data in drop event");
    return;
  }

  try {
    const draggedMonster = JSON.parse(data);
    const fromRow = draggedMonster.row;
    const fromCol = draggedMonster.col;

    debugLog(`Drop event: from (${fromRow},${fromCol}) to (${row},${col})`);

    // Check if this is a valid move
    const isValidMove = availableMoves.some(
      (move) =>
        move.fromRow === fromRow &&
        move.fromCol === fromCol &&
        move.toRow === row &&
        move.toCol === col
    );

    if (isValidMove) {
      const fromKey = `${fromRow},${fromCol}`;
      const toKey = `${row},${col}`;
      const attacker = boardState[fromKey];
      const defender = boardState[toKey];

      const outcome = resolveBattle(attacker, defender);

      switch (outcome) {
        case "attackerWins":
          delete boardState[toKey];
          boardState[toKey] = { ...attacker, row, col };
          delete boardState[fromKey];
          socket.emit("moveMonster", {
            fromRow,
            fromCol,
            toRow: row,
            toCol: col,
          });
          break;

        case "defenderWins":
          alert("Your monster was defeated!");
          return;

        case "bothRemoved":
          delete boardState[fromKey];
          delete boardState[toKey];
          socket.emit("removeBoth", {
            fromRow,
            fromCol,
            toRow: row,
            toCol: col,
          });
          break;

        case "none":
          boardState[toKey] = { ...attacker, row, col };
          delete boardState[fromKey];
          socket.emit("moveMonster", {
            fromRow,
            fromCol,
            toRow: row,
            toCol: col,
          });
          break;
      }

      renderBoard();
      waitingForServerResponse = true;
      removeAllHighlights();
      highlightPlayerEdge();
    } else {
      alert("Invalid move. Please drag to a valid destination.");
    }
  } catch (error) {
    debugLog(`Error in drop handler: ${error.message}`);
  }
}

function resolveBattle(attacker, defender) {
  if (!defender) return "none";

  const a = attacker.type;
  const d = defender.type;

  if (
    (a === "vampire" && d === "werewolf") ||
    (a === "werewolf" && d === "ghost") ||
    (a === "ghost" && d === "vampire")
  ) {
    return "attackerWins";
  }

  if (
    (d === "vampire" && a === "werewolf") ||
    (d === "werewolf" && a === "ghost") ||
    (d === "ghost" && a === "vampire")
  ) {
    return "defenderWins";
  }

  if (a === d) {
    return "bothRemoved";
  }

  return "none";
}

// RENDER BOARD
function renderBoard() {
  const cells = document.querySelectorAll(".cell");

  // Clear all cells but keep edge highlighting
  cells.forEach((cell) => {
    cell.innerHTML = "";
    cell.classList.remove("placed");
  });

  // Render monsters on board
  for (const key in boardState) {
    const [row, col] = key.split(",").map(Number);
    const { playerId: monsterId, type } = boardState[key];

    const cell = [...cells].find(
      (c) => parseInt(c.dataset.row) === row && parseInt(c.dataset.col) === col
    );

    if (cell) {
      const monsterContainer = document.createElement("div");
      monsterContainer.className = "monster-container";

      const icon = document.createElement("div");
      icon.textContent = monsterEmojis[type] || "❓";
      icon.className = "icon";
      icon.style.backgroundColor = playerColors[monsterId];
      icon.style.color = "white";

      monsterContainer.appendChild(icon);
      cell.appendChild(monsterContainer);
      cell.classList.add("placed");

      // Make player's own monsters draggable if it's their turn
      if (isMyTurn && monsterId === playerId) {
        monsterContainer.setAttribute("draggable", "true");

        // Add drag start event listener
        monsterContainer.addEventListener("dragstart", (e) => {
          // Store the monster's position in the data transfer
          const monsterData = JSON.stringify({ row, col, type });
          e.dataTransfer.setData("text/plain", monsterData);
          e.dataTransfer.effectAllowed = "move";

          debugLog(`Drag start: monster at (${row},${col})`);

          // Select this monster and highlight available moves
          selectedMonster = { row, col, type };

          // Request available moves for this monster
          socket.emit("getAvailableMoves", { fromRow: row, fromCol: col });

          // Add a class to indicate dragging
          monsterContainer.classList.add("dragging");
          cell.classList.add("selected");
        });

        // Add drag end event listener
        monsterContainer.addEventListener("dragend", (e) => {
          monsterContainer.classList.remove("dragging");

          // If the drop was not successful, reset selection
          if (selectedMonster) {
            selectedMonster = null;
            removeAllHighlights();
            highlightPlayerMonsters();
          }
        });
      }
    }
  }

  // Always highlight player's edge
  highlightPlayerEdge();

  // If it's player's turn, highlight their monsters for movement
  if (isMyTurn && hasPlayerMonsters()) {
    highlightPlayerMonsters();
  }
}
