const socket = io();

const boardEl = document.getElementById("board");

// Create 10x10 board
function createBoard() {
  boardEl.innerHTML = "";
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      const cell = document.createElement("div");
      cell.classList.add("cell");
      cell.dataset.row = row;
      cell.dataset.col = col;

      // Allow placing only on bottom row (your edge)
      if (row === 9) {
        cell.addEventListener("click", () => {
          placeMonster(row, col);
        });
      }

      boardEl.appendChild(cell);
    }
  }
}

// Add a monster to the board (for now, a Vampire = 🧛)
function placeMonster(row, col) {
  const index = row * 10 + col;
  const cell = boardEl.children[index];

  if (cell.classList.contains("occupied")) {
    alert("Cell already occupied!");
    return;
  }

  // Mark visually
  cell.textContent = "🧛";
  cell.classList.add("occupied");

  // Send to server
  socket.emit("placeMonster", {
    row,
    col,
    type: "vampire",
  });
}

// WebSocket events
document.getElementById("joinBtn").addEventListener("click", () => {
  socket.emit("joinGame");
});

document.getElementById("statsBtn").addEventListener("click", () => {
  socket.emit("getStats");
});

socket.on("gameCreated", (game) => {
  document.getElementById("gameInfo").innerHTML = `
    <p><strong>Game ID:</strong> ${game.id}</p>
    <p><strong>Status:</strong> ${game.status}</p>
  `;
  createBoard(); // draw the board
});

socket.on("stats", (data) => {
  document.getElementById("statsInfo").innerHTML = `
    <p><strong>Total Games Played:</strong> ${data.totalGames}</p>
    <p><strong>Your Wins:</strong> ${data.playerStats.wins}</p>
    <p><strong>Your Losses:</strong> ${data.playerStats.losses}</p>
  `;
});
