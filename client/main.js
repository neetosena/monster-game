const socket = io();
let playerId;
let monsterChoices = {}; // received from server when all chosen
let chosenMonster = null;
let hasPlaced = false;
let myPosition = null;
let allFinalPositions = {}; // merge of all positions
const gridSize = 10;
const boardEl = document.getElementById("grid");

// PLAYERS COLORS
const playerColors = {
  1: "#f28b82", // Player 1 = red
  2: "#fbbc04", // Player 2 = yellow
  3: "#34a853", // Player 3 = green
  4: "#4285f4", // Player 4 = blue
};

socket.on("playerAssigned", (id) => {
  playerId = id;
  console.log("You are Player", playerId);
  const playerLabel = document.getElementById("player-id");
  playerLabel.textContent = `You are Player ${playerId}`;
  playerLabel.style.color = playerColors[playerId]; // 🎨 apply color

  createBoard();
});

socket.on("selectNewMonster", () => {
  document.getElementById("monsterSelect").disabled = false;
  document.getElementById("monsterSelect").value = ""; // reset
  chosenMonster = null;
  hasPlaced = false;
});

document.getElementById("monsterSelect").addEventListener("change", (e) => {
  const monster = e.target.value;
  if (!monster) return;

  chosenMonster = monster;
  socket.emit("monsterChosen", monster);
  console.log("Monster selected:", monster);
  // alert("Now click on your edge to place the monster.");
});

socket.on("allMonstersChosen", (choices) => {
  monsterChoices = choices;
  console.log("All monsters chosen. Waiting for all positions...");
});

socket.on("updateScores", (scores) => {
  displayScores(scores);
});

function displayScores(scores) {
  const scoreEl = document.getElementById("scores");
  scoreEl.innerHTML = "<h3>Scores</h3>";
  for (const [playerId, score] of Object.entries(scores)) {
    const color = playerColors[playerId] || "#ccc";
    const p = document.createElement("p");
    p.textContent = `Player ${playerId}: ${score}`;
    p.style.color = color;
    scoreEl.appendChild(p);
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

      cell.addEventListener("click", () => handleCellClick(row, col, cell));

      boardEl.appendChild(cell);
    }
  }

  highlightAllowedCells();
}

function highlightAllowedCells() {
  const cells = document.querySelectorAll(".cell");

  cells.forEach((cell) => {
    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);

    let isAllowed = false;

    if (playerId === 1 && row === 0) isAllowed = true;
    else if (playerId === 2 && col === 0) isAllowed = true;
    else if (playerId === 3 && row === gridSize - 1) isAllowed = true;
    else if (playerId === 4 && col === gridSize - 1) isAllowed = true;

    if (isAllowed) {
      cell.classList.add("allowed");
    } else {
      cell.classList.remove("allowed");
    }
  });
}

// HANDLE PLAYER PLACEMENT
function handleCellClick(row, col, cellEl) {
  if (!chosenMonster) return alert("Choose a monster first!");
  if (hasPlaced) return;

  const isValid =
    (playerId === 1 && row === 0) ||
    (playerId === 2 && col === 0) ||
    (playerId === 3 && row === gridSize - 1) ||
    (playerId === 4 && col === gridSize - 1);

  if (!isValid) return alert("You must place your monster on your edge.");

  myPosition = { row, col, type: chosenMonster };

  socket.emit("finalMonsterPositions", { [playerId]: myPosition });

  hasPlaced = true;
  alert("Position sent. Waiting for other players...");
}

// GET AND RENDER FINAL RESULTS
socket.on("syncMonsterPositions", (positions) => {
  allFinalPositions = positions; // No need to merge anymore

  renderFinalMonsters(allFinalPositions); // Always render survivors
});

function renderFinalMonsters(positions) {
  createBoard(); // clear board
  const cells = document.querySelectorAll(".cell");

  Object.entries(positions).forEach(([playerId, pos]) => {
    const { row, col, type } = pos;
    const cell = [...cells].find(
      (c) => c.dataset.row == row && c.dataset.col == col
    );

    const icon = document.createElement("div");
    icon.textContent = `${getMonsterIconEmoji(type)}`;
    icon.className = "icon";
    icon.style.backgroundColor = playerColors[playerId];
    icon.style.color = "white";

    cell.appendChild(icon);
    cell.classList.add("placed");
  });
}

function getMonsterIconEmoji(monster) {
  switch (monster) {
    case "vampire":
      return "🧛";
    case "werewolf":
      return "🐺";
    case "ghost":
      return "👻";
    default:
      return "";
  }
}
