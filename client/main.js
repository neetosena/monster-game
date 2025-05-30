const socket = io();
let playerId;
let monsterChoices = {}; // FIXED: define globally

const gridSize = 10;
const boardEl = document.getElementById("grid");

// Assign player
socket.on("playerAssigned", (id) => {
  playerId = id;
  console.log("You are Player", playerId);
  createBoard();
});

// Game full
socket.on("gameFull", () => {
  alert("Game is full!");
});

// Monster chosen
document.getElementById("chooseMonsterBtn").addEventListener("click", () => {
  const monster = document.getElementById("monsterSelect").value;
  if (!monster) return alert("Select a monster first!");
  socket.emit("monsterChosen", monster);
});

// Draw initial board
function createBoard() {
  boardEl.innerHTML = "";
  for (let row = 0; row < gridSize; row++) {
    // const rowDiv = document.createElement("div");
    // rowDiv.style.display = "flex";

    for (let col = 0; col < gridSize; col++) {
      const cell = document.createElement("div");
      cell.classList.add("cell");
      cell.dataset.row = row;
      cell.dataset.col = col;
      // rowDiv.appendChild(cell);
      boardEl.appendChild(cell);
    }
  }
}

// Render monsters
function renderFinalMonsters(positions) {
  createBoard(); // clear board first

  Object.values(positions).forEach((pos) => {
    const { row, col, type } = pos;
    const index = row * gridSize + col;
    const cell = boardEl.children[index];

    const icon = document.createElement("i");
    icon.className = getMonsterIconClass(type);
    icon.style.fontSize = "20px";
    icon.style.color =
      type === "vampire" ? "red" : type === "werewolf" ? "brown" : "purple";

    cell.appendChild(icon);
  });
}

// FontAwesome icons
function getMonsterIconClass(monster) {
  switch (monster) {
    case "vampire":
      return "fa-solid fa-user-ninja";
    case "werewolf":
      return "fa-solid fa-dog";
    case "ghost":
      return "fa-solid fa-ghost";
    default:
      return "";
  }
}

// When all monsters are chosen
socket.on("allMonstersChosen", (choices) => {
  monsterChoices = choices;
  console.log("All monsters chosen:", monsterChoices);

  // Enable final placement
  document.getElementById("placeBtn").disabled = false;
});

document.getElementById("placeBtn").addEventListener("click", () => {
  if (Object.keys(monsterChoices).length !== 4) {
    return alert("Wait for all players to choose their monster!");
  }

  const placed = new Set();
  const positions = {};

  Object.entries(monsterChoices).forEach(([id, monster]) => {
    const pid = parseInt(id);
    let row, col;

    do {
      switch (pid) {
        case 1:
          row = 0;
          col = Math.floor(Math.random() * gridSize);
          break;
        case 2:
          row = Math.floor(Math.random() * gridSize);
          col = gridSize - 1;
          break;
        case 3:
          row = gridSize - 1;
          col = Math.floor(Math.random() * gridSize);
          break;
        case 4:
          row = Math.floor(Math.random() * gridSize);
          col = 0;
          break;
      }
    } while (placed.has(`${row}-${col}`));

    placed.add(`${row}-${col}`);
    console.log("placed: ", placed);
    positions[pid] = { row, col, type: monster };
  });

  socket.emit("finalMonsterPositions", positions);
});

// Receive synced positions
socket.on("syncMonsterPositions", (positions) => {
  console.log("Synced monster positions received", positions);
  renderFinalMonsters(positions);
});
