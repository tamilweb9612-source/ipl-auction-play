// Predict the Price Mini-Game
class PredictPriceGame {
  constructor() {
    this.predictions = new Map(); // teamId -> prediction
    this.currentPlayer = null;
    this.gameActive = false;
    this.scores = new Map(); // teamId -> score
    this.userClosedGame = false; // Flag to track if user manually closed the game
    this.init();
  }

  init() {
    this.createGameUI();
    this.setupSocketListeners();
  }

  createGameUI() {
    const gameContainer = document.createElement("div");
    gameContainer.id = "predict-game-container";
    gameContainer.className = "predict-game-container hidden";
    gameContainer.innerHTML = `
            <div class="predict-game-card" id="predict-game-card">
                <div class="predict-header" id="predict-game-container-header" style="cursor: move;">
                    <h3>🎯 Predict the Price!</h3>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <div class="predict-timer">
                            <span id="predict-countdown">10</span>s
                        </div>
                        <button class="predict-minimize-btn" id="predict-minimize-btn">
                            <i class="bi bi-x-lg"></i>
                        </button>
                    </div>
                </div>
                
                <div id="predict-game-content">
                
                <div class="predict-player-info">
                    <div class="predict-player-name" id="predict-player-name">Loading...</div>
                    <div class="predict-player-role" id="predict-player-role"></div>
                </div>

                <div class="predict-input-area">
                    <label>Your Prediction (in Lakhs):</label>
                    <div class="predict-input-group">
                        <span class="predict-currency">₹</span>
                        <input type="number" 
                               id="predict-price-input" 
                               placeholder="Enter amount"
                               min="0"
                               step="5">
                        <span class="predict-unit">L</span>
                    </div>
                    <div class="predict-quick-amounts">
                        <button class="predict-quick-btn" data-amount="50">50L</button>
                        <button class="predict-quick-btn" data-amount="100">1Cr</button>
                        <button class="predict-quick-btn" data-amount="200">2Cr</button>
                        <button class="predict-quick-btn" data-amount="500">5Cr</button>
                    </div>
                </div>

                <button class="predict-submit-btn" id="predict-submit-btn">
                    Submit Prediction
                </button>


                </div><!-- End predict-game-content -->
            </div>
        `;

    document.body.appendChild(gameContainer);
    this.attachEventListeners();
    this.makeDraggable(document.getElementById("predict-game-container"));
  }

  makeDraggable(elmnt) {
    var pos1 = 0,
      pos2 = 0,
      pos3 = 0,
      pos4 = 0;
    const header = document.getElementById(elmnt.id + "-header");
    if (header) {
      header.onmousedown = dragMouseDown;
    }

    function dragMouseDown(e) {
      e = e || window.event;

      // FIX: Ignore drag if clicking the minimize button
      if (e.target.closest("#predict-minimize-btn")) return;

      // e.preventDefault(); // Allow focus on inputs if needed, but usually block for drag
      // get the mouse cursor position at startup:
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      // call a function whenever the cursor moves:
      document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
      e = e || window.event;
      e.preventDefault();
      // calculate the new cursor position:
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      // set the element's new position:
      elmnt.style.top = elmnt.offsetTop - pos2 + "px";
      elmnt.style.left = elmnt.offsetLeft - pos1 + "px";
      elmnt.style.right = "auto"; // Clear right if set by CSS
    }

    function closeDragElement() {
      // stop moving when mouse button is released:
      document.onmouseup = null;
      document.onmousemove = null;
    }
  }

  attachEventListeners() {
    // Quick amount buttons
    document.querySelectorAll(".predict-quick-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const amount = btn.dataset.amount;
        document.getElementById("predict-price-input").value = amount;
      });
    });

    // Toggle Game Button (In Header)
    const toggleBtn = document.getElementById("togglePredictGameBtn");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        const gameContainer = document.getElementById("predict-game-container");
        const isHidden = gameContainer.classList.toggle("hidden");
        // If we just opened it (isHidden is false), we want to respect that preference
        if (!isHidden) {
            this.userClosedGame = false;
        }
      });
    }

    // Minimize/Close Button (In Game Card)
    const closeBtn = document.getElementById("predict-minimize-btn");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        document.getElementById("predict-game-container").classList.add("hidden");
        this.userClosedGame = true; // Mark that user manually closed
      });
    }

    // Submit button
    document
      .getElementById("predict-submit-btn")
      .addEventListener("click", () => {
        this.submitPrediction();
      });

    // Enter key to submit
    document
      .getElementById("predict-price-input")
      .addEventListener("keypress", (e) => {
        if (e.key === "Enter") this.submitPrediction();
      });
  }

  setupSocketListeners() {
    if (typeof socket === "undefined") return;

    socket.on("predict_game_start", (data) => {
      this.startGame(data);
    });

    socket.on("predict_game_results", (data) => {
      this.showResults(data);
    });

    socket.on("predict_leaderboard_update", (data) => {
      this.updateLeaderboard(data);
    });
  }

  startGame(data) {
    this.currentPlayer = data.player;
    this.gameActive = true;
    this.predictions.clear();

    // Reset the user closed flag for new game
    // this.userClosedGame = false; // COMMENTED OUT: Respect user's choice to keep it closed

    this.resetUI(); // Reset UI state first to ensure elements exist

    // Update UI
    const nameEl = document.getElementById("predict-player-name");
    if (nameEl) nameEl.textContent = data.player.name;

    const roleEl = document.getElementById("predict-player-role");
    if (roleEl) roleEl.textContent = data.player.role;

    const inputEl = document.getElementById("predict-price-input");
    if (inputEl) inputEl.value = "";

    // Only show game if user didn't manually close it
    if (!this.userClosedGame) {
      document
        .getElementById("predict-game-container")
        .classList.remove("hidden");
    }

    // Start countdown
    this.startCountdown(data.duration || 10);

    // Show notification
    this.showNotification(`Predict ${data.player.name}'s price!`);
  }

  startCountdown(duration) {
    let timeLeft = duration;
    const countdownEl = document.getElementById("predict-countdown");

    const interval = setInterval(() => {
      timeLeft--;
      countdownEl.textContent = timeLeft;

      if (timeLeft <= 3) {
        countdownEl.style.color = "#ff4444";
      }

      if (timeLeft <= 0) {
        clearInterval(interval);
        this.autoSubmit();
      }
    }, 1000);
  }

  submitPrediction() {
    if (!this.gameActive) return;

    const input = document.getElementById("predict-price-input");
    if (!input) return; // Guard
    const prediction = parseInt(input.value);

    if (!prediction || prediction <= 0) {
      this.showNotification("⚠️ Please enter a valid amount!", "error");
      return;
    }

    // Send to server
    if (typeof socket !== "undefined") {
      socket.emit("submit_prediction", {
        playerId: this.currentPlayer.id,
        prediction: prediction,
      });
    }

    // Disable input
    input.disabled = true;
    document.getElementById("predict-submit-btn").disabled = true;
    document.getElementById("predict-submit-btn").textContent =
      "Prediction Submitted! ✓";

    this.showNotification("✅ Prediction submitted!", "success");
  }

  autoSubmit() {
    const input = document.getElementById("predict-price-input");
    if (input && !input.disabled && this.gameActive) {
      this.showNotification("⏰ Time's up! Auto-submitting...", "warning");
      setTimeout(() => this.submitPrediction(), 500);
    }
  }

  showResults(data) {
    this.gameActive = false;
    const { actualPrice, predictions, winners } = data;
    const safePrice =
      actualPrice !== undefined && actualPrice !== null ? actualPrice : 0;

    const contentDiv = document.getElementById("predict-game-content");
    if (!contentDiv) return;

    // Ensure container is visible ONLY if user hasn't closed it
    if (!this.userClosedGame) {
        document
        .getElementById("predict-game-container")
        .classList.remove("hidden");
    }

    // Swap Content to Results
    contentDiv.innerHTML = `
            <div class="predict-results-panel">
                <div class="predict-actual-price">
                    Actual Price: <span class="price-highlight">₹${safePrice > 0 ? (safePrice / 100000).toFixed(1) + "L" : "UNSOLD"}</span>
                </div>
                
                <div class="predict-winners">
                    <h3>🏆 Closest Predictions</h3>
                    ${
                      winners.length > 0
                        ? winners
                            .map(
                              (w, i) => `
                        <div class="predict-winner-item rank-${i + 1}">
                            <span class="rank">#${i + 1}</span>
                            <span class="team-name">${w.teamName}</span>
                            <span class="prediction">₹${w.prediction / 100000}L</span>
                            <span class="difference">(±${Math.abs(safePrice - w.prediction) / 100000}L)</span>
                            <span class="points">+${w.points} pts</span>
                        </div>
                    `,
                            )
                            .join("")
                        : '<div class="text-center text-white-50">No correct predictions.</div>'
                    }
                </div>

                <div class="text-center mt-3">
                    <button class="predict-submit-btn" id="predict-continue-btn">
                        Continue
                    </button>
                </div>
            </div>
        `;

    // Update scores
    winners.forEach((w) => {
      const currentScore = this.scores.get(w.teamId) || 0;
      this.scores.set(w.teamId, currentScore + w.points);
    });

    // Add handler for continue button
    document
      .getElementById("predict-continue-btn")
      .addEventListener("click", () => {
        this.resetUI();
      });
  }

  resetUI() {
    const contentDiv = document.getElementById("predict-game-content");
    if (contentDiv) {
      contentDiv.innerHTML = `
                <div class="predict-player-info">
                    <div class="predict-player-name" id="predict-player-name">Waiting...</div>
                    <div class="predict-player-role" id="predict-player-role"></div>
                </div>

                <div class="predict-input-area">
                    <label>Your Prediction (in Lakhs):</label>
                    <div class="predict-input-group">
                        <span class="predict-currency">₹</span>
                        <input type="number" 
                               id="predict-price-input" 
                               placeholder="Enter amount"
                               min="0"
                               step="5">
                        <span class="predict-unit">L</span>
                    </div>
                    <div class="predict-quick-amounts">
                        <button class="predict-quick-btn" data-amount="50">50L</button>
                        <button class="predict-quick-btn" data-amount="100">1Cr</button>
                        <button class="predict-quick-btn" data-amount="200">2Cr</button>
                        <button class="predict-quick-btn" data-amount="500">5Cr</button>
                    </div>
                </div>

                <button class="predict-submit-btn" id="predict-submit-btn">
                    Submit Prediction
                </button>


            `;
      // Re-attach listeners since we wiped the HTML
      this.attachEventListeners();
    }
  }

  updateLeaderboard(data) {
    // Leaderboard removed as per request
    /*
    const leaderboard = document.getElementById("predict-leaderboard");
    const scoresContainer = document.getElementById("predict-scores");

    let entries = [];
    if (data.scores instanceof Map) {
        entries = Array.from(data.scores.entries());
    } else if (typeof data.scores === 'object' && data.scores !== null) {
        entries = Object.entries(data.scores);
    }

    const sortedScores = entries.sort((a, b) => b[1] - a[1]);

    scoresContainer.innerHTML = sortedScores
      .map(
        ([teamId, score], i) => `
            <div class="predict-score-item">
                <span class="score-rank">#${i + 1}</span>
                <span class="score-team">${data.teamNames[teamId]}</span>
                <span class="score-points">${score} pts</span>
            </div>
        `,
      )
      .join("");

    leaderboard.classList.remove("hidden");
    */
  }

  showNotification(message, type = "info") {
    const notification = document.createElement("div");
    notification.className = `predict-notification predict-${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => notification.classList.add("show"), 100);
    setTimeout(() => {
      notification.classList.remove("show");
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }
}

// Auto-initialize
const predictPriceGame = new PredictPriceGame();

// Export for use in other files
if (typeof module !== "undefined" && module.exports) {
  module.exports = PredictPriceGame;
}
