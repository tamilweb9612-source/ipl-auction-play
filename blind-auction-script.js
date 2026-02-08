// ======================================================
// 🔧 0. PERSISTENT IDENTITY (THE WRISTBAND)
// ======================================================
let myPersistentId = localStorage.getItem("ipl_auction_player_id");

if (!myPersistentId) {
  myPersistentId = localStorage.getItem("ipl_auction_player_id");
  if (!myPersistentId) {
    myPersistentId = "user_" + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    localStorage.setItem("ipl_auction_player_id", myPersistentId);
  }
}

// Player Name Storage
let myPlayerName = localStorage.getItem("ipl_auction_player_name") || "";

// ======================================================
// 🔊 REALISTIC SOUND & TTS ENGINE
// ======================================================
let isSoundEnabled = false;
let audioCtx = null;
let synthesisVoice = null;
let lastAnnouncedLotId = -1;
let lastAnnouncedSet = null;
let knownTakenTeams = new Set();

// Helper function to convert role key to full name for voice
function getRoleFullName(roleKey) {
  const roleMap = {
    wk: "Wicket Keeper",
    bat: "Batsman",
    bowl: "Bowler",
    ar: "All-rounder",
    allrounder: "All-rounder",
  };
  return roleMap[roleKey.toLowerCase()] || roleKey;
}

// Helper function to convert player type
function getPlayerTypeFullName(playerType) {
  if (playerType === "Foreign") return "Overseas Player";
  return "Domestic Player";
}

// Initialize Sound Toggle
document.addEventListener("DOMContentLoaded", () => {
  try {
    // Sync User Identity from Auth
    const u = localStorage.getItem("user");
    const userData = u ? JSON.parse(u) : null;
    if (userData) {
      if (document.getElementById("userWelcome") && userData.name) {
        document.getElementById("userWelcome").innerText =
          `WELCOME, ${userData.name.toUpperCase()}`;
      }
      if (document.getElementById("userEmailDisplay")) {
        document.getElementById("userEmailDisplay").innerText =
          userData.email || "";
      }
      myPlayerName = userData.name || "";
      localStorage.setItem("ipl_auction_player_name", myPlayerName);
    }
  } catch (err) {
    console.warn("Failed to parse user data:", err);
  }

  loadVoices();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  // Initialize audio button when it becomes available
  initializeSoundButton();

  // Show lobby screen by default
  const lobby = document.getElementById("lobbyScreen");
  if (lobby) {
    lobby.style.setProperty("display", "flex", "important");
  }

  // ✨ NEW: Auto-reconnect feature
  checkAutoReconnect();
});

// NEW: Check for auto-reconnect and join room automatically
function checkAutoReconnect() {
  const autoRoomId = localStorage.getItem("auto_reconnect_room");
  const autoTeamKey = localStorage.getItem("auto_reconnect_team");
  
  if (autoRoomId && autoTeamKey) {
    console.log("🔄 Auto-reconnecting to room:", autoRoomId);
    
    // Clear the flags
    localStorage.removeItem("auto_reconnect_room");
    localStorage.removeItem("auto_reconnect_team");
    
    // Wait for socket to connect
    if (socket.connected) {
      performAutoJoin(autoRoomId);
    } else {
      socket.on("connect", () => {
        performAutoJoin(autoRoomId);
      });
    }
  }
}

// Perform the actual auto-join
function performAutoJoin(roomId) {
  // Emit join_room without password (server will recognize the player)
  const playerName = localStorage.getItem("ipl_auction_player_name") || 
                     localStorage.getItem("userName") || "";
  
  socket.emit("join_room", {
    roomId: roomId,
    password: "", // Server will allow reconnect based on playerId
    playerName: playerName
  });
  
  myRoomId = roomId;
  
  // Show loading message
  if (lobbyError) {
    lobbyError.innerText = "🔄 Reconnecting to your auction...";
    lobbyError.style.color = "#4CAF50";
  }
}

// Function to initialize sound button (can be called multiple times safely)
function initializeSoundButton() {
  const btn = document.getElementById("soundToggleBtn");

  if (btn && !btn.dataset.initialized) {
    btn.dataset.initialized = "true"; // Mark as initialized

    btn.addEventListener("click", () => {
      isSoundEnabled = !isSoundEnabled;
      btn.classList.toggle("active", isSoundEnabled);
      btn.innerHTML = isSoundEnabled
        ? '<i class="bi bi-volume-up-fill"></i>'
        : '<i class="bi bi-volume-mute-fill"></i>';

      if (isSoundEnabled) {
        if (!audioCtx) {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (AudioContext) audioCtx = new AudioContext();
        }
        if (audioCtx && audioCtx.state === "suspended") {
          audioCtx.resume();
        }
        playHammerSound(); // Test the heavy hammer
        speakText("Audio system active.");
      } else {
        speakText("Audio system disabled.");
      }
    });
  }
}

function loadVoices() {
  const voices = window.speechSynthesis.getVoices();
  synthesisVoice =
    voices.find((v) => v.name.includes("Google US English")) ||
    voices.find((v) => v.name.includes("Microsoft Zira")) ||
    voices.find((v) => v.name.includes("Samantha")) ||
    voices.find((v) => v.lang === "en-US") ||
    voices[0];
}

function speakText(text) {
  if (!isSoundEnabled) return;
  if (!window.speechSynthesis) return;

  window.speechSynthesis.cancel(); // Cut off previous speech

  const utterance = new SpeechSynthesisUtterance(text);
  if (synthesisVoice) utterance.voice = synthesisVoice;

  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  utterance.volume = 1.0; // Max voice volume

  window.speechSynthesis.speak(utterance);
}

// 🔨 HEAVY HAMMER SOUND (Boosted Volume)
function playHammerSound() {
  if (typeof isSoundEnabled !== "undefined" && !isSoundEnabled) return;
  if (!audioCtx) return;

  try {
    const t = audioCtx.currentTime;

    // MASTER VOLUME & COMPRESSOR
    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-50, t);
    compressor.knee.setValueAtTime(40, t);
    compressor.ratio.setValueAtTime(12, t);
    compressor.attack.setValueAtTime(0, t);
    compressor.release.setValueAtTime(0.25, t);
    compressor.connect(audioCtx.destination);

    const masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(6.0, t);
    masterGain.connect(compressor);

    // 1. WOODEN BODY
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    const filter1 = audioCtx.createBiquadFilter();

    osc1.type = "triangle";
    osc1.frequency.setValueAtTime(330, t);
    osc1.frequency.exponentialRampToValueAtTime(60, t + 0.2);

    filter1.type = "lowpass";
    filter1.frequency.setValueAtTime(1200, t);

    gain1.gain.setValueAtTime(1.5, t);
    gain1.gain.exponentialRampToValueAtTime(0.01, t + 0.25);

    osc1.connect(filter1);
    filter1.connect(gain1);
    gain1.connect(masterGain);

    osc1.start(t);
    osc1.stop(t + 0.25);

    // 2. THE CRACK
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();

    osc2.type = "sine";
    osc2.frequency.setValueAtTime(2500, t);
    osc2.frequency.exponentialRampToValueAtTime(100, t + 0.05);

    gain2.gain.setValueAtTime(1.2, t);
    gain2.gain.exponentialRampToValueAtTime(0.01, t + 0.05);

    osc2.connect(gain2);
    gain2.connect(masterGain);

    osc2.start(t);
    osc2.stop(t + 0.05);

    // 3. IMPACT TEXTURE
    const bufferSize = audioCtx.sampleRate * 0.1;
    const noiseBuffer = audioCtx.createBuffer(
      1,
      bufferSize,
      audioCtx.sampleRate,
    );
    const data = noiseBuffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = audioCtx.createBufferSource();
    const noiseGain = audioCtx.createGain();
    const noiseFilter = audioCtx.createBiquadFilter();

    noise.buffer = noiseBuffer;
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.value = 2000;

    noiseGain.gain.setValueAtTime(2.5, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(masterGain);

    noise.start(t);
    noise.stop(t + 0.1);
  } catch (e) {
    console.error("Audio Error:", e);
  }
}

// 🔔 SHARP BID SOUND
function playBidSound() {
  if (!isSoundEnabled || !audioCtx) return;

  try {
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.type = "triangle";
    osc.frequency.setValueAtTime(800, t);
    osc.frequency.exponentialRampToValueAtTime(100, t + 0.1);

    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);

    osc.start(t);
    osc.stop(t + 0.1);
  } catch (e) {
    console.error("Audio Error:", e);
  }
}

// ======================================================
// 🔧 1. ROBUST SOCKET INITIALIZATION
// ======================================================

const socket = io({
  transports: ["websocket"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 2000,
  timeout: 20000,
  auth: {
    playerId: myPersistentId,
  },
});
window.socket = socket;

const lobbyScreen = document.getElementById("lobbyScreen");
const gameContainer = document.getElementById("gameContainer");
const lobbyError = document.getElementById("lobbyError");

// --- GLOBAL VARIABLES ---
let myRoomId = null;
var mySelectedTeamKey = null; // Defined with var to be accessible via window.mySelectedTeamKey
let isAdmin = false;
let saleProcessing = false;
let auctionQueue = [];
let globalTeams = [];
let currentActivePlayer = null;
let auctionStarted = false;
let currentHighestBidderKey = null;
let connectedUsersCount = 1;
let lastTournamentData = null;

// ======================================================
// 🍞 TOAST NOTIFICATION SYSTEM
// ======================================================
window.showToast = function(message, type = 'info') {
    // Remove existing toasts
    document.querySelectorAll('.pwa-toast').forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = 'pwa-toast';
    
    // Icon based on type
    let icon = '🔔';
    if (type === 'error') icon = '⚠️';
    if (type === 'success') icon = '✅';
    if (type === 'warning') icon = '⚠️';

    toast.innerHTML = `
        <div class="d-flex align-items-center gap-2">
            <span style="font-size: 1.2em;">${icon}</span>
            <span>${message}</span>
        </div>
    `;

    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    // Auto dismiss
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Override window.alert to use toast (Global Safety)
window.alert = function(msg) {
    showToast(msg, 'warning');
};

const ALL_IPL_TEAMS = [
  "CSK",
  "MI",
  "RCB",
  "LSG",
  "SRH",
  "DC",
  "GT",
  "RR",
  "KKR",
  "PBKS",
];

// ======================================================
// 🔧 2. SOCKET HEALTH + HEARTBEAT
// ======================================================
let socketAlive = true;

setInterval(() => {
  if (socket.connected) {
    socket.emit("pingServer");
  }
}, 25000);

// --- SOCKET STATUS HANDLERS ---
socket.on("connect", () => {
  socketAlive = true;
  if (lobbyError) lobbyError.innerText = "";
});

socket.on("disconnect", (reason) => {
  socketAlive = false;
  console.warn("⚠️ Socket disconnected:", reason);
  showToast("⚠️ Connection lost. Reconnecting...", "error");
});

socket.on("error_message", (msg) => {
  showToast(msg, "error");
});

socket.on("reconnect", () => {
  socketAlive = true;
  logEvent("🔁 Reconnected to server", true);

  if (document.getElementById("setupSection").style.display === "none") {
    auctionStarted = true;
  }

  if (myRoomId) {
    socket.emit("request_sync");
    const savedTeamKey = localStorage.getItem(`ipl_team_${myRoomId}`);
    if (savedTeamKey) {
      socket.emit("reclaim_team", savedTeamKey);
    }
  }
});

socket.on("pongServer", () => {});

if (!window._beforeUnloadBound) {
  window._beforeUnloadBound = true;
  window.addEventListener("beforeunload", (e) => {
    e.preventDefault();
    e.returnValue = "";
    return "";
  });
}

// ======================================================
// 📊 PLAYER DATABASE (RESTORED)
// ======================================================
const PLAYER_DATABASE = {
  // --- MARQUEE & TOP BATTERS ---

  // --- INDIAN BATTERS (Tier 1) ---
  "Virat Kohli": { bat: 98, bowl: 10, luck: 90, type: "bat", role: "Opener, Anchor" },
  "Rohit Sharma": { bat: 95, bowl: 15, luck: 92, type: "bat", role: "Opener, Captain" },
  "Shubman Gill": { bat: 92, bowl: 5, luck: 88, type: "bat", role: "Opener, Captain" },
  "Suryakumar Yadav": { bat: 96, bowl: 5, luck: 85, type: "bat", role: "Middle Order, 360, Power Hitter" },
  "Yashasvi Jaiswal": { bat: 91, bowl: 10, luck: 85, type: "bat", role: "Opener, Powerplay Specialist" },
  "Ruturaj Gaikwad": { bat: 89, bowl: 5, luck: 88, type: "bat", role: "Opener, Anchor, Captain" },
  "Rinku Singh": { bat: 90, bowl: 5, luck: 95, type: "bat", role: "Finisher, Power Hitter" },
  "Shreyas Iyer": { bat: 89, bowl: 10, luck: 88, type: "bat", role: "Middle Order, Captain, Spin Basher" },
  "Sanju Samson": { bat: 91, bowl: 0, luck: 85, type: "wk", role: "Wicket Keeper, Top Order, Captain" },
  "Rishabh Pant": { bat: 92, bowl: 0, luck: 90, type: "wk", role: "Wicket Keeper, Middle Order, Captain" },
  "KL Rahul": { bat: 90, bowl: 0, luck: 85, type: "wk", role: "Wicket Keeper, Opener, Anchor" },
  "Ishan Kishan": { bat: 87, bowl: 0, luck: 80, type: "wk", role: "Wicket Keeper, Opener" },
  "Abhishek Sharma": { bat: 89, bowl: 50, luck: 85, type: "ar", role: "Opener, Power Hitter" },
  "Tilak Varma": { bat: 88, bowl: 15, luck: 85, type: "bat", role: "Middle Order, Finisher" },
  "Shyam Khan": { bat: 80, bowl: 80, luck: 85, type: "ar", role: "Finisher, All Rounder, Spinner" },
  "Siva": { bat: 85, bowl: 85, luck: 85, type: "ar", role: "Finisher, All Rounder, Spinner" },

  // --- FOREIGN BATTERS (Tier 1) ---
  "Travis Head": { bat: 94, bowl: 20, luck: 88, type: "bat", role: "Opener, Power Hitter" },
  "Heinrich Klaasen": { bat: 96, bowl: 0, luck: 90, type: "wk", role: "Wicket Keeper, Finisher, Spin Basher" },
  "Jos Buttler": { bat: 93, bowl: 0, luck: 88, type: "wk", role: "Wicket Keeper, Opener, Power Hitter" },
  "Faf du Plessis": { bat: 88, bowl: 5, luck: 82, type: "bat", role: "Opener, Captain" },
  "David Warner": { bat: 84, bowl: 5, luck: 75, type: "bat", role: "Opener, Legend" }, // Nerfed due to age/form
  "Nicholas Pooran": { bat: 92, bowl: 0, luck: 88, type: "wk", role: "Wicket Keeper, Finisher" },
  "Glenn Maxwell": { bat: 90, bowl: 75, luck: 80, type: "ar", role: "Finisher, All Rounder, Spinner" },
  "Quinton de Kock": { bat: 88, bowl: 0, luck: 85, type: "wk", role: "Wicket Keeper, Opener" },
  "David Miller": { bat: 89, bowl: 5, luck: 90, type: "bat", role: "Finisher, Power Hitter" },
  "Phil Salt": { bat: 89, bowl: 0, luck: 82, type: "wk", role: "Wicket Keeper, Opener, Power Hitter" },
  "Tristan Stubbs": { bat: 90, bowl: 15, luck: 85, type: "wk", role: "Wicket Keeper, Finisher, Power Hitter" }, // Buffed (Delhi standout)
  "Jake Fraser-McGurk": { bat: 89, bowl: 5, luck: 88, type: "bat", role: "Opener, Power Hitter" },
  "Will Jacks": { bat: 88, bowl: 60, luck: 85, type: "ar", role: "Opener, All Rounder, Spinner" },
  "Rachin Ravindra": { bat: 85, bowl: 75, luck: 82, type: "ar", role: "Opener, All Rounder, Spinner" },

  // --- ALL-ROUNDERS (Top Tier) ---
  "Sunil Narine": { bat: 92, bowl: 90, luck: 92, type: "ar", role: "Opener, Spinner, Mystery Spin, MVP" }, // Role Updated
  "Andre Russell": { bat: 94, bowl: 82, luck: 90, type: "ar", role: "Finisher, All Rounder, Pacer" },
  "Hardik Pandya": { bat: 85, bowl: 80, luck: 85, type: "ar", role: "Finisher, All Rounder, Pacer" }, // Nerfed slightly
  "Ravindra Jadeja": { bat: 85, bowl: 88, luck: 90, type: "ar", role: "Spinner, All Rounder, Left Arm Orth" },
  "Axar Patel": { bat: 85, bowl: 88, luck: 88, type: "ar", role: "Spinner, All Rounder, Left Arm Orth" },
  "Marcus Stoinis": { bat: 88, bowl: 75, luck: 88, type: "ar", role: "Finisher, All Rounder, Pacer" },
  "Liam Livingstone": { bat: 87, bowl: 70, luck: 80, type: "ar", role: "Finisher, All Rounder, Spinner" },
  "Sam Curran": { bat: 80, bowl: 85, luck: 85, type: "ar", role: "All Rounder, Pacer, Swing" },
  "Cameron Green": { bat: 86, bowl: 82, luck: 85, type: "ar", role: "Top Order, All Rounder, Pacer" },
  "Pat Cummins": { bat: 78, bowl: 92, luck: 95, type: "ar", role: "Pacer, Captain, All Rounder" },
  "Nitish Kumar Reddy": { bat: 85, bowl: 78, luck: 88, type: "ar", role: "Middle Order, All Rounder, Pacer" }, // Added/Buffed

  // --- INDIAN BATTERS (Mid/Domestic) ---
  "Sai Sudharsan": { bat: 89, bowl: 5, luck: 85, type: "bat", role: "Middle Order, Anchor" },
  "Rajat Patidar": { bat: 86, bowl: 5, luck: 82, type: "bat", role: "Middle Order, Spin Basher" },
  "Shivam Dube": { bat: 88, bowl: 40, luck: 85, type: "bat", role: "Finisher, Spin Basher" },
  "Riyan Parag": { bat: 86, bowl: 40, luck: 82, type: "ar", role: "Middle Order, All Rounder" }, // Buffed
  "Rahul Tripathi": { bat: 81, bowl: 5, luck: 75, type: "bat", role: "Top Order, Aggressor" },
  "Ajinkya Rahane": { bat: 80, bowl: 5, luck: 75, type: "bat", role: "Top Order, Anchor" },
  "Prithvi Shaw": { bat: 80, bowl: 5, luck: 70, type: "bat", role: "Opener, Powerplay Specialist" },
  "Nehal Wadhera": { bat: 82, bowl: 15, luck: 80, type: "bat", role: "Middle Order, Finisher" },
  "Ashutosh Sharma": { bat: 84, bowl: 5, luck: 88, type: "bat", role: "Finisher" },
  "Shashank Singh": { bat: 85, bowl: 10, luck: 88, type: "bat", role: "Finisher" },
  "Sameer Rizvi": { bat: 78, bowl: 10, luck: 75, type: "bat", role: "Finisher" },
  "Dhruv Jurel": { bat: 84, bowl: 0, luck: 82, type: "wk", role: "Wicket Keeper, Finisher" },
  "Jitesh Sharma": { bat: 82, bowl: 0, luck: 78, type: "wk", role: "Wicket Keeper, Finisher" },

  // --- FOREIGN BATTERS (Mid) ---
  "Harry Brook": { bat: 85, bowl: 10, luck: 75, type: "bat", role: "Middle Order, Power Hitter" },
  "Kane Williamson": { bat: 86, bowl: 15, luck: 82, type: "bat", role: "Middle Order, Anchor, Captain" },
  "Shimron Hetmyer": { bat: 85, bowl: 5, luck: 85, type: "bat", role: "Finisher, Power Hitter" },
  "Rovman Powell": { bat: 82, bowl: 15, luck: 80, type: "bat", role: "Finisher, Power Hitter" },
  "Tim David": { bat: 86, bowl: 10, luck: 85, type: "bat", role: "Finisher, Power Hitter" },
  "Finn Allen": { bat: 83, bowl: 5, luck: 75, type: "bat", role: "Opener, Power Hitter" },
  "Jonny Bairstow": { bat: 88, bowl: 0, luck: 85, type: "wk", role: "Wicket Keeper, Opener" },
  "Aiden Markram": { bat: 84, bowl: 45, luck: 82, type: "ar", role: "Middle Order, Captain" },
  "Daryl Mitchell": { bat: 85, bowl: 50, luck: 82, type: "ar", role: "Middle Order, All Rounder" },

  // --- BOWLERS (Fast - Tier 1) ---
  "Jasprit Bumrah": { bat: 20, bowl: 99, luck: 95, type: "bowl", role: "Pacer, Death Bowler, Yorker King" },
  "Trent Boult": { bat: 20, bowl: 90, luck: 88, type: "bowl", role: "Pacer, Powerplay Specialist, Swing" },
  "Mitchell Starc": { bat: 30, bowl: 92, luck: 88, type: "bowl", role: "Pacer, Powerplay Specialist" },
  "Matheesha Pathirana": { bat: 5, bowl: 92, luck: 88, type: "bowl", role: "Pacer, Death Bowler" },
  "Mohammed Shami": { bat: 15, bowl: 91, luck: 85, type: "bowl", role: "Pacer, Seam" },
  "Mohammed Siraj": { bat: 10, bowl: 88, luck: 85, type: "bowl", role: "Pacer, Powerplay Specialist" },
  "Kagiso Rabada": { bat: 25, bowl: 89, luck: 85, type: "bowl", role: "Pacer, Express" },
  "Jofra Archer": { bat: 40, bowl: 89, luck: 80, type: "bowl", role: "Pacer, Express" },
  "Arshdeep Singh": { bat: 10, bowl: 88, luck: 85, type: "bowl", role: "Pacer, Death Bowler" },
  "Harshit Rana": { bat: 45, bowl: 88, luck: 85, type: "bowl", role: "Pacer, Death Bowler, Aggressor" }, // Major Buff
  "T Natarajan": { bat: 5, bowl: 88, luck: 82, type: "bowl", role: "Pacer, Death Bowler" },

  // --- BOWLERS (Fast - Tier 2/Mid) ---
  "Mayank Yadav": { bat: 10, bowl: 88, luck: 85, type: "bowl", role: "Pacer, Express" },
  "Gerald Coetzee": { bat: 20, bowl: 86, luck: 85, type: "bowl", role: "Pacer" },
  "Lockie Ferguson": { bat: 20, bowl: 87, luck: 85, type: "bowl", role: "Pacer, Express" },
  "Anrich Nortje": { bat: 10, bowl: 86, luck: 80, type: "bowl", role: "Pacer, Express" },
  "Bhuvneshwar Kumar": { bat: 30, bowl: 85, luck: 85, type: "bowl", role: "Pacer, Swing" },
  "Deepak Chahar": { bat: 30, bowl: 84, luck: 82, type: "bowl", role: "Pacer, Swing" },
  "Mohit Sharma": { bat: 10, bowl: 85, luck: 85, type: "bowl", role: "Pacer, Slower Ball" },
  "Harshal Patel": { bat: 40, bowl: 88, luck: 88, type: "bowl", role: "Pacer, Death Bowler, Slower Ball" }, // Purple Cap Contender
  "Avesh Khan": { bat: 15, bowl: 85, luck: 80, type: "bowl", role: "Pacer" },
  "Khaleel Ahmed": { bat: 10, bowl: 86, luck: 82, type: "bowl", role: "Pacer" },
  "Mukesh Kumar": { bat: 10, bowl: 85, luck: 82, type: "bowl", role: "Pacer, Death Bowler" },
  "Yash Dayal": { bat: 10, bowl: 84, luck: 80, type: "bowl", role: "Pacer" },
  "Vaibhav Arora": { bat: 15, bowl: 83, luck: 80, type: "bowl", role: "Pacer" },
  "Akash Madhwal": { bat: 10, bowl: 83, luck: 80, type: "bowl", role: "Pacer" },
  "Simarjeet Singh": { bat: 15, bowl: 82, luck: 75, type: "bowl", role: "Pacer" },
  "Nuwan Thushara": { bat: 10, bowl: 83, luck: 80, type: "bowl", role: "Pacer, Sling" },
  "Mustafizur Rahman": { bat: 10, bowl: 86, luck: 85, type: "bowl", role: "Pacer, Cutter Specialist" },
  "Naveen-ul-Haq": { bat: 10, bowl: 86, luck: 82, type: "bowl", role: "Pacer, Slower Ball" },
  "Spencer Johnson": { bat: 20, bowl: 84, luck: 80, type: "bowl", role: "Pacer" },
  "Azmatullah Omarzai": { bat: 80, bowl: 78, luck: 78, type: "ar", role: "All Rounder, Pacer" },

  // --- SPINNERS (Tier 1) ---
  "Rashid Khan": { bat: 65, bowl: 96, luck: 92, type: "bowl", role: "Spinner, Leg Spin, Mystery Spin" },
  "Varun Chakravarthy": { bat: 10, bowl: 94, luck: 85, type: "bowl", role: "Spinner, Mystery Spin, Death Bowler" }, // Major Buff
  "Kuldeep Yadav": { bat: 10, bowl: 93, luck: 88, type: "bowl", role: "Spinner, Chinaman" },
  "Yuzvendra Chahal": { bat: 5, bowl: 93, luck: 88, type: "bowl", role: "Spinner, Leg Spin" },
  "Ravi Bishnoi": { bat: 10, bowl: 90, luck: 85, type: "bowl", role: "Spinner, Leg Spin" },
  "Wanindu Hasaranga": { bat: 50, bowl: 90, luck: 85, type: "bowl", role: "Spinner, Leg Spin" },
  "Maheesh Theekshana": { bat: 20, bowl: 87, luck: 80, type: "bowl", role: "Spinner, Mystery Spin" },
  "Noor Ahmad": { bat: 15, bowl: 88, luck: 85, type: "bowl", role: "Spinner, Chinaman" },

  // --- SPINNERS (Tier 2/Mid) ---
  "Rahul Chahar": { bat: 20, bowl: 84, luck: 80, type: "bowl", role: "Spinner, Leg Spin" },
  "Piyush Chawla": { bat: 35, bowl: 85, luck: 88, type: "bowl", role: "Spinner, Leg Spin" },
  "R Sai Kishore": { bat: 25, bowl: 86, luck: 82, type: "bowl", role: "Spinner, Left Arm Orth" },
  "Suyash Sharma": { bat: 5, bowl: 84, luck: 80, type: "bowl", role: "Spinner, Mystery Spin" },
  "Washington Sundar": { bat: 75, bowl: 84, luck: 80, type: "ar", role: "All Rounder, Spinner" },
  "Krunal Pandya": { bat: 78, bowl: 82, luck: 80, type: "ar", role: "All Rounder, Spinner" },
  "Abishek Porel": { bat: 84, bowl: 0, luck: 80, type: "wk", role: "Wicket Keeper, Top Order" },
  "Manimaran Siddharth": { bat: 10, bowl: 80, luck: 75, type: "bowl", role: "Spinner, Left Arm Orth" },
  "Allah Ghazanfar": { bat: 10, bowl: 82, luck: 82, type: "bowl", role: "Spinner, Mystery Spin" },

  // --- LEGENDS (Active in Spirit/Impact Player) ---
  "MS Dhoni": { bat: 85, bowl: 0, luck: 99, type: "wk", role: "Wicket Keeper, Finisher, Captain, Legend" }

};

const MARQUEE_PLAYERS = {
  batter: [
    { name: "Virat Kohli", type: "Indian" },
    { name: "Rohit Sharma", type: "Indian" },
    { name: "Shubman Gill", type: "Indian" },
    { name: "Suryakumar Yadav", type: "Indian" },
    { name: "Travis Head", type: "Foreign" },
    { name: "Yashasvi Jaiswal", type: "Indian" },
    { name: "Ruturaj Gaikwad", type: "Indian" },
    { name: "Shreyas Iyer", type: "Indian" },
    { name: "Abhishek Sharma", type: "Indian" },
    { name: "Rinku Singh", type: "Indian" },
  ],
  bowler: [
    { name: "Jasprit Bumrah", type: "Indian" },
    { name: "Mitchell Starc", type: "Foreign" },
    { name: "Pat Cummins", type: "Foreign" },
    { name: "Mohammed Shami", type: "Indian" },
    { name: "Rashid Khan", type: "Foreign" },
    { name: "Trent Boult", type: "Foreign" },
    { name: "Kagiso Rabada", type: "Foreign" },
    { name: "Yuzvendra Chahal", type: "Indian" },
    { name: "Mohammed Siraj", type: "Indian" },
    { name: "Arshdeep Singh", type: "Indian" },
    { name: "Kuldeep Yadav", type: "Indian" },
    { name: "Matheesha Pathirana", type: "Foreign" },
  ],
  allrounder: [
    { name: "Hardik Pandya", type: "Indian" },
    { name: "Ravindra Jadeja", type: "Indian" },
    { name: "Andre Russell", type: "Foreign" },
    { name: "Glenn Maxwell", type: "Foreign" },
    { name: "Sunil Narine", type: "Foreign" },
    { name: "Axar Patel", type: "Indian" },
    { name: "Cameron Green", type: "Foreign" },
    { name: "Sam Curran", type: "Foreign" },
    { name: "Marcus Stoinis", type: "Foreign" },
    { name: "Shyam Khan", type: "Indian" },
    { name: "Siva", type: "Indian" },
  ],
  wicketkeeper: [
    { name: "MS Dhoni", type: "Indian" },
    { name: "Rishabh Pant", type: "Indian" },
    { name: "Jos Buttler", type: "Foreign" },
    { name: "Heinrich Klaasen", type: "Foreign" },
    { name: "Sanju Samson", type: "Indian" },
    { name: "KL Rahul", type: "Indian" },
    { name: "Nicholas Pooran", type: "Foreign" },
    { name: "Quinton de Kock", type: "Foreign" },
    { name: "Ishan Kishan", type: "Indian" },
    { name: "Phil Salt", type: "Foreign" },
  ],
};

const RAW_DATA = {
  Batsmen: {
    foreign: [
      "Faf du Plessis",
      "David Miller",
      "Harry Brook",
      "Kane Williamson",
      "Shimron Hetmyer",
      "Rovman Powell",
      "Will Jacks",
      "Steve Smith",
      "Devon Conway",
      "Daryl Mitchell",
      "Jake Fraser-McGurk",
      "Dewald Brevis",
      "Tim David",
      "Aiden Markram",
      "Finn Allen",
      "Rilee Rossouw",
      "Jason Roy",
      "David Warner",
    ],
    indian: [
      "Sai Sudharsan",
      "Tilak Varma",
      "Shikhar Dhawan",
      "Ajinkya Rahane",
      "Prithvi Shaw",
      "Venkatesh Iyer",
      "Rajat Patidar",
      "Nitish Rana",
      "Rahul Tripathi",
      "Shivam Dube",
      "Manish Pandey",
      "Devdutt Padikkal",
      "Sameer Rizvi",
      "Nehal Wadhera",
    ],
  },
  "Fast Bowlers": {
    foreign: [
      "Anrich Nortje",
      "Josh Hazlewood",
      "Jofra Archer",
      "Mark Wood",
      "Lockie Ferguson",
      "Gerald Coetzee",
      "Marco Jansen",
      "Spencer Johnson",
      "Alzarri Joseph",
      "Dilshan Madushanka",
      "Nuwan Thushara",
      "Mustafizur Rahman",
      "Fazalhaq Farooqi",
      "Nathan Ellis",
      "Naveen-ul-Haq",
    ],
    indian: [
      "Deepak Chahar",
      "Shardul Thakur",
      "Bhuvneshwar Kumar",
      "T Natarajan",
      "Mohit Sharma",
      "Umesh Yadav",
      "Prasidh Krishna",
      "Avesh Khan",
      "Harshal Patel",
      "Khaleel Ahmed",
      "Mukesh Kumar",
      "Ishant Sharma",
      "Umran Malik",
      "Harshit Rana",
      "Akash Deep",
      "Yash Dayal",
      "Mayank Yadav",
    ],
  },
  Spinners: {
    foreign: [
      "Wanindu Hasaranga",
      "Maheesh Theekshana",
      "Adam Zampa",
      "Mujeeb Ur Rahman",
      "Noor Ahmad",
      "Mitchell Santner",
      "Keshav Maharaj",
      "Adil Rashid",
      "Tabraiz Shamsi",
      "Allah Ghazanfar",
    ],
    indian: [
      "Ravichandran Ashwin",
      "Ravi Bishnoi",
      "Varun Chakravarthy",
      "Washington Sundar",
      "Rahul Chahar",
      "Amit Mishra",
      "Piyush Chawla",
      "Karn Sharma",
      "Mayank Markande",
      "R Sai Kishore",
      "Suyash Sharma",
    ],
  },
  Wicketkeeper: {
    foreign: [
      "Jonny Bairstow",
      "Rahmanullah Gurbaz",
      "Josh Inglis",
      "Shai Hope",
      "Tristan Stubbs",
      "Ryan Rickelton",
      "Donovan Ferreira",
    ],
    indian: [
      "Jitesh Sharma",
      "Dhruv Jurel",
      "Dinesh Karthik",
      "Wriddhiman Saha",
      "Anuj Rawat",
      "Prabhsimran Singh",
      "KS Bharat",
      "Vishnu Vinod",
      "Abishek Porel",
    ],
  },
  "All-rounders": {
    foreign: [
      "Liam Livingstone",
      "Moeen Ali",
      "Mitchell Marsh",
      "Rachin Ravindra",
      "Azmatullah Omarzai",
      "Romario Shepherd",
      "Mohammad Nabi",
      "Jason Holder",
      "Chris Woakes",
      "Daniel Sams",
      "Kyle Mayers",
      "Sikandar Raza",
    ],
    indian: [
      "Krunal Pandya",
      "Deepak Hooda",
      "Rahul Tewatia",
      "Vijay Shankar",
      "Riyan Parag",
      "Shahrukh Khan",
      "Shahbaz Ahmed",
      "Ramandeep Singh",
      "Lalit Yadav",
      "Nitish Kumar Reddy",
    ],
  },
  Domestic: {
    batsmen: [
      "Vaibhav Suryavanshi",
      "Priyansh Arya",
      "Angkrish Raghuvanshi",
      "Ashutosh Sharma",
      "Naman Dhir",
      "Ayush Mhatre",
      "Yash Dhull",
      "Sarfaraz Khan",
      "Musheer Khan",
      "Shashank Singh",
      "Abdul Samad",
      "Swastik Chikara",
      "Andre Siddarth",
      "Aniket Verma",
    ],
    bowlers: [
      "Akash Madhwal",
      "Vidwath Kaverappa",
      "Tushar Deshpande",
      "Vaibhav Arora",
      "Yash Thakur",
      "Kartik Tyagi",
      "Chetan Sakariya",
      "Simarjeet Singh",
      "Manimaran Siddharth",
      "Arjun Tendulkar",
      "Rasikh Salam",
      "Mohsin Khan",
      "Digvesh Rathi",
      "Ashwani Kumar",
    ],
    wicketkeepers: [
      "Robin Minz",
      "Urvil Patel",
      "Kumar Kushagra",
      "Avanish Aravelly",
      "Luvnith Sisodia",
    ],
    allrounders: [
      "Suryansh Shedge",
      "Vipraj Nigam",
      "Prashant Veer",
      "Tanush Kotian",
      "Arshin Kulkarni",
    ],
  },
};

const PLAYER_IMAGE_MAP = {
  "David Warner":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRy2UoIz9RctCjtDw0iTDr9W8lq_jMqGo0JpQ&s",
  "Virat Kohli":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSXd7IOQ0NKyGMznUdvuNfPqT1PjyLLWs2PlA&s",
  "Shyam Khan": "IMG-20260204-WA0000.jpg",
  "Siva": "IMG-20260204-WA0001.jpg",
  "rohit sharma":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ3sfdazCnce91FbLAu66M2aa49A2OJ_UfWRg&s",
  "rishabh pant":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR5UKPHZLy9Mb72EvFlbnmH6PA3ySNWbxvLWA&s",
  "kl rahul":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQs5YIL9kZU5kRl0nW4CMDXezaXSrn_7d1cWw&s",
  "jasprit bumrah":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSOhggyxRW4R8C5stRZeM6xF_-MLpKGeTTnNQ&s",
  "hardik pandya":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSMl97E5YCG_qhtODqspjhQbiVKdgkGSQoj2w&s",
  "axar patel":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTZq-Wt00Pd8Olb3f8vzTE7ud9xeUv5yMcgsg&s",
  "rashid khan":
    "https://www.iplbetonline.in/wp-content/uploads/2023/04/218.png",
  "heinrich klaasen":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQiFL5rG_FgzbJjvdATUOQrhdsE90YPI4fuug&s",
  "sanju samson":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR8Xp0CvnGYY2QCwxVow7kvpP3ZTkzVus1MGg&s",
  "yashasvi jaiswal":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTMMIlG4UCovEfziX_SI09qkf3_Cg2SX-P-Lg&s",
  "mitchell starc":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRPGz1TkJbf1sCV4pLRxdmXi6-QqjDAV3EKbw&s",
  "nicholas pooran":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQttQw5G5G4LV07_JzAAlJwQYzTiJHDO-7JRQ&s",
  "yuzvendra chahal":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSl2t1XzBVcHqNBLVc1n75AaJd2-tcnk4g48g&s",
  "kuldeep yadav":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ3BdPeWcBfg_ShlOT1BJcl1uhXwd6_jWxBoA&s",
  "sai sudharsan":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQYqNPZ_ROZnx8SiGAG9uWubwN7ghfjPq3XXA&s",
  "varun chakravarthy": "https://static.toiimg.com/photo/119129071.cms",
  "t natarajan":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRqUl5j0TmK38vQvoxg9ngJVAUVhEzar1tT_w&s",
  "abhishek sharma":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSvUeLIbFDGe9Whp3BX3CSqQ93dQoeZubgwBw&s",
  "mohammed shami":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTnFzvB9NG74q7rS8MjSW_zD1pBRBat5YDHmw&s",
  "daryl mitchell":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQsC0r1IFYQLEPXhy2OtS1VJp07YA80CCcd8Q&s",
  "dewald brevis":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRTQivnVww3TfhkuUmwYJZQuR6wroS0svAppA&s",
  "ms dhoni":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQlUHTyVfbyG3PgcyaRzLI_KE9HHqUqgrFIFQ&s",
  "suryakumar yadav":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRHid9tiHpmtLTokHjhRy5N6vkVcxzL7thkeQ&s",
  "travis head":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQdPCSKpkwcuZDMlFoiDm3R3BAo1EzRtNdiPg&s",
  "ravindra jadeja":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRI8Z-1QJiEVn2_eCbhrW5MyXhUJn9HE2XdAA&s",
  "trent boult":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQIoXfsx5jBlVAr1H3fGk0S_c-0MNn-r-4o9Q&s",
  "arshdeep singh":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRz9QMCpjUJj5Smz5WS0If_WXhC-9F2-Tvs3w&s",
  "glenn maxwell":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTH8L43Zy6vc06DL4pDJKRxaazWyqeJFs_xdw&s",
  "sam curran":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR-X04hvyAKngMVDfBpYVahZeB58Rb4ryXO0A&s",
  "krunal pandya":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRRTGdJoU_Hofobj-hU3tpyPMAKg_jtq9Lg1A&s",
  "romario shepherd":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQJvAy_9pMhWWvU7jvLjvq4IjAD_kluu7Kh2A&s",
  "aiden markram":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTOajmONNd7d64dfVUFmUbVEsO3yPHHnAx8Yg&s",
  "liam livingstone":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTflymyT3ojb12YfLmIWYwvK7maoqsYvftyIw&s",
  "shivam dube":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRGsxQpnbZyU0mtKlvBgnhPErZiGHehmb4YuA&s",
  "quinton de kock":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS1husYcqQxzXbB2jYZctsHKUO1r5KYMUxyrA&s",
  "dhruv jurel":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQZm_mMkVrBrfrY9bs0swEN5Td1hE-aRz9n2w&s",
  "jos buttler":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRJyXqCruiGYygsRkxwF7NIrT7IpAPR5fJJJA&s",
  "andre russell":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRiGYYt9ovNiRcFSjadP2AksRsd0Mdi1dNZDg&s",
  "ruturaj gaikwad":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSXGbBtm6R4GJT2j2ZxvROVEeV7UbrIuRDleA&s",
  "shubman gill":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRtakT_H1Gyp9KF85UHvLv0MjQbT0OXLJlsEQ&s",
  "shreyas iyer":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRO10-jV4zy9JtIxbWzRZiJagKzkYR4l507Cw&s",
  "tilak varma":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTfMM-hv47GDNhi-6WrbcBfD-AUAPy0qnjSnw&s",
  "devon conway":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcREdCc6o0V15HYS4vv_HFww4fUehf5t9ByGxA&s",
  "devdatt padikal":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSAuY6qP02fFUlKZ4ld7Wrhm-alVVJeTcNv2A&s",
  "kane williamson":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRGpOxgmrjBEe7v76wwMov_YFuAoogFSrZ_zg&s",
  "will jacks":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR6J3WVvja_9EB2qJ8er90GqkEDTCGv5hQBag&s",
  "harry brook":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRAArvrYHQzYLSlOugAi6drdAg5IzIibCyjaw&s",
  "ibrahim zadran":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSS0O-R0JSfMt0maVI6v6OU1a0SSIj8ijeOnQ&s",
  "lockie ferguson":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQGQmTjuxXSYhQHZcRi9U8UlqMyYiYBLn2cBg&s",
  "josh hazlewood":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ-4ZjUwjHrvhukWLmMNoM2P69feAJ9zck9uQ&s",
  "harshit rana":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQpcXQmpK-CbFtlnQnmCoN9FmPS3xbOGLwUDQ&s",
  "prasidh krishna":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTOhgXERAAoBAuhwRRZf2wMWISXjnIYDlrEmA&s",
  "kagiso rabada":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQxvidFiausg2Me1UfVNU7f1cx_jYsLdeUwaQ&s",
  "harshal patel":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQFgJDXgf0In2PO3Ie9mO4_8VjqwwRkRP2e8Q&s",
  "pat cummins":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS9nkSiV6jtCApLRnOFSKUAUQspjV5hpJOdBQ&s",
  "matheesha pathirana":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR4TerGmA61_rrVaNBeBHejm5J60vzQs0rWTg&s",
  "mark wood":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT61NLgM2DT5tYUhLKRjLyylZzRbxc4wTb_3A&s",
  "mukesh kumar":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS8hgsxXLIMkdEMRyqIzCMlnwpGjG2nKV1hGw&s",
  "anrich nortje":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQp_INFjiNgN1e9CgcoGSYEoHR7d863BrAEkg&s",
  "tushar deshpande":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ2chrGKb_zLMRCjpQh2rSEG6AewNxP5L3k7Q&s",
  "sunil narine":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRWsWXzcPF-5GJEEjgr9IaPPn-yCHMyZxCMqA&s",
  "wanindu hasaranga":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTOd5ea0dPuQ2Piq3gCg0k2XdaF810mFPWFoA&s",
  "mujeeb ur rahman":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTC9WDInYus_x1b86moJX9kYdTW3Le84sDrWg&s",
  "rahmanullah gurbaz":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRW2tuWnal4q-leOBRU4aWfcngk1NWbY04XnQ&s",
  "noor ahmad":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT4Aw3GMm7PPUQOM4Z1csrE8n5rxcfLZfu5sg&s",
  "maheesh theekshana":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRprnzQmcBvOhfS1eqZHcporjcEYFWqQmVMnQ&s",
  "murugan ashwin":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQZp4FDSxl5b3K9mouAdn5zJJ_cyrXQvhf0mg&s",
  "adam zampa":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQqVlUCngLKUeqaRirZaRWkeQIsEmHmoAIuqw&s",
  "mayank markande":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTAR6Wt6xq1oPl5upF_8CiXxmc37xT-CisXLw&s",
  "ravi bishnoi":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRQvLEQRAinM5V7CwTqzdau9AqiOC7erIisKw&s",
  "alex carey":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR3fx9oUbwobdrMkbA2eWpUwzRWazNT3Sk1ug&s",
  "dinesh karthik":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRQ7EgmJkgCRpcfBrFV0CXGx6bIKjtk5wEeVQ&s",
  "jitesh sharma":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTjeHFwIBbAbF_tpPcXNUp0-5D1LOANzxLxWA&s",
  "washington sundar":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRkWDcgskNJH3SvDpogZ-QXE7WQnstEvuk8Kg&s",
  "riyan parag":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTNQGzq26UBlFu_dPv--OOFgCiyHBGTnqBumw&s",
  "nitish rana":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQJLQfDqFWetnMsl8WmFsRZhQBCLlDv7fiT1Q&s",
  "mitchell marsh":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSctxL2Fnj4DdMI8wf84B8Zku6tdXqBMs3lrw&s",
  "tim david":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRFdb361FkQD3qyQTu2z9oqHQ7MJLXTKYuSsA&s",
  "cameron green":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR1x3cvTR2n1ab-W6LhAwKcyUuHUuDMqzMiSw&s",
  "marcus stoinis":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS7TaJF3IIbU7FPkYCHT0j3LQGVrVhnzIDR7Q&s",
  "rinku singh":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQzbWiyOzr11AFN-yAzFYWzQmEu5F3JsRyRrw&s",
  "deepak hooda":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTF918ic4VnyxQvakJJsXT1OKmeBIuIkwKyhA&s",
  "rahul tewatia":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTeCWXJoDrKnXVVrV3IYBNhhrUwwBaOi_l5NA&s",
  "phil salt":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ6CRh_5YOiZaB_s-OO5w1z5AvBNEM0X-qDDw&s",
  "shahrukh khan":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR8Xp0CvnGYY2QCwxVow7kvpP3ZTkzVus1MGg&s",
  "Faf du Plessis":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRuw5WAznke_M1y83XWQl3WyTpj8mmvquREPA&s",
  "David Miller":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQZzfUcZmOT3vo7ucCn8zdlh3FTFcB0gs_t8w&s",
  "Shimron Hetmyer":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQHPHEGd-TGdia5MOHN8DEeNoQm5g4cMpx9SQ&s",
  "Jake Fraser-McGurk":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRHbxIFZAqNHXoUfusHxX38_9EPuS5f4V_y6w&s",
  "Shikhar Dhawan":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTmSJKeitXBUIzCdNM51xg6URHrI3QbqOijrw&s",
  "Ajinkya Rahane":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSOalqxPGHCV7hgvZXyVQB4xOHofBssMM1QWA&s",
  "Prithvi Shaw":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQO8FOcrG-t8xbjHLMkPJd2Z3PKYkD51LcuaQ&s",
  "Venkatesh Iyer":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQxQXScapO97PkWzl-KejLhLg2U6BsTNrRfRA&s",
  "Rajat Patidar":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTJtqyJBHfsL7M4Vn9pthbqPEoSEPHP7IcTXg&s",
  "Manish Pandey":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTVwDd6V2GJLNk8EElhqC_Yj-W1DJ6130r64A&s",
  "Jofra Archer":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTo8gIuGKKIp3GOCRLEKfTeeWCn7c3FiwjUxQ&s",
  "Gerald Coetzee":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTB6jCTyyHld0Ac-GnphqAk9h-MgYs6y3OoDQ&s",
  "Marco Jansen":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTy_tiNO9KkLrz_axRUXa-4DGdut8N_5nWi-Q&s",
  "Mustafizur Rahman":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQOlM0BXEu-szyb97Gj6ORu1DfDYIosi_BCUg&s",
  "Fazalhaq Farooqi":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTlD694z3N59mxkGYeLAM6YTJFHHvBNvU3ntQ&s",
  "Mohammed Siraj":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSVAwAb_htAQ9WCy0gaJKmQJiPluMal9hNwLw&s",
  "Deepak Chahar":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTHSk-8Xek9lTIVSC9tslRP0_Gxt6tU2QvEbg&s",
  "Shardul Thakur":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRHQBozbzAgGAzQ5JDOLRcr6YQkXoWM1eEyQg&s",
  "Bhuvneshwar Kumar":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQT6Ikzu_k3_jaV12gy2td03yTJFJanJcNn-A&s",
  "Mohit Sharma":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQt9Q8umC9f5_f-8YyvFlqNxNZpKiQ00DqHnQ&s",
  "Khaleel Ahmed":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRPGM9mnxrIQvVNL5T5BJ5H0r1FLqCX2_56SA&s",
  "Mitchell Santner":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSyCFUEjnNWNYhNQWt2pVY-nraaeT7Xp5CLDw&s",
  "Ravichandran Ashwin":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTP-_GveSb4AACOwVRgOXYTISPvlt4XFaeNlg&s",
  "Rahul Chahar":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRlgntjI0Wv5sx8A2bzstHCl7wMJW6pHv5tkw&s",
  "R Sai Kishore":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSyhgmmkhP8CIvTQRT-WwI-k1PVHzm1usIwHw&s",
  "Vijay Shankar":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRa0X4bPB_8GWQh2bnPVKLjLhMnCvuGpx0jUw&s",
  "Shahbaz Ahmed":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR_A8dTo3ziPjrxTsNrnMOdA0lIg1mKuQHIhg&s",
  "Moeen Ali":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRnblRwkKMZo2eRojywZhyIznpY6h-ct0LFog&s",
  "Rachin Ravindra":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcScrUYzDrJV6lwAh-h9ZKzBF72Dh-apAivglg&s",
  "Azmatullah Omarzai":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSI_vHDCuM1AWo_zEDwUbc_sG2I-4mJDlNgbw&s",
  "Mohammad Nabi":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRgPYEEBo2iJrQeUxClBQIq8ZA0cr6AryKh3g&s",
  "Jason Holder":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT949IOng4bWbSkMePYOjMBXKbOQKYkVsm95w&s",
  "Chris Woakes":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSdPCTRMrjZ4gtWa6kx7mhsUxOM_IXsDPQsNg&s",
  "Ishan Kishan":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRvI17T3mE31eNA35OSyvuvIVvtGLjlOYFLGw&s",
  "Wriddhiman Saha":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQLxziLIljwF5qLn-CsUtL1k5MFCOoz_fkL_Q&s",
  "Tristan Stubbs":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQgVBnKUGvBQjHnNvaw_A9lKO7c6MwP2EqHlQ&s",
  "Josh Inglis":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ96_gVuW8JTbxirRPH9mVAjB59jbtQRt6UtQ&s",
    "Shyam Khan":"IMG"
};

// FIX: Runtime Normalization of Image Keys to Lowercase
const NORMALIZED_IMAGE_MAP = {};
Object.keys(PLAYER_IMAGE_MAP).forEach((k) => {
  NORMALIZED_IMAGE_MAP[k.toLowerCase()] = PLAYER_IMAGE_MAP[k];
});

// --- CONSTANTS ---
const ROLE_ORDER = {
  wk: 1,
  batter: 2,
  bat: 2,
  allrounder: 3,
  ar: 3,
  spinner: 4,
  spin: 4,
  fast: 5,
  pace: 5,
  bowler: 5,
  bowl: 5,
};

function getRolePriority(role) {
  return ROLE_ORDER[role.toLowerCase()] || 6;
}

function getRoleIcon(role) {
  role = role.toLowerCase();
  if (role === "wk") return "🧤";
  if (role === "batter" || role === "bat") return "🏏";
  if (role === "allrounder" || role === "ar") return "🏏⚾";
  if (role === "spinner" || role === "spin") return "🌪️";
  if (role.includes("fast") || role.includes("pace") || role === "bowl")
    return "⚡";
  if (role === "bowler") return "⚾";
  return "";
}

function formatAmount(amount) {
  if (typeof amount !== "number") return "₹-";
  if (amount >= 10000000)
    return "₹" + (amount / 10000000).toFixed(2).replace(/\.00$/, "") + " Cr";
  if (amount >= 100000)
    return "₹" + (amount / 100000).toFixed(1).replace(/\.0$/, "") + " L";
  return "₹" + amount.toLocaleString("en-IN");
}

function parsePrice(text) {
  if (!text || text === "₹-" || text === "") return 0;
  if (text.includes("Cr"))
    return parseFloat(text.replace("₹", "").replace(" Cr", "")) * 10000000;
  if (text.includes("L"))
    return parseFloat(text.replace("₹", "").replace(" L", "")) * 100000;
  return parseFloat(text.replace("₹", "").replace(/,/g, ""));
}

function logEvent(message, highlight = false) {
  const logEl = document.getElementById("log");
  if (!logEl) return;
  const div = document.createElement("div");
  div.className = highlight ? "text-warning mb-1" : "mb-1";
  div.innerHTML = `<span class="text-secondary me-2">[${new Date().toLocaleTimeString(
    "en-GB",
    { hour12: false },
  )}]</span> ${message}`;
  logEl.prepend(div);
}

function getPlayerStats(name, roleHint = "bat") {
  if (PLAYER_DATABASE[name])
    return {
      bat: PLAYER_DATABASE[name].bat,
      bowl: PLAYER_DATABASE[name].bowl,
      luck: PLAYER_DATABASE[name].luck,
      role: PLAYER_DATABASE[name].role || PLAYER_DATABASE[name].type,
    };
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const consistentRand = () => {
    let t = Math.sin(hash++) * 10000;
    return t - Math.floor(t);
  };
  const isBowler =
    roleHint.toLowerCase().includes("bowl") ||
    roleHint.toLowerCase().includes("fast") ||
    roleHint.toLowerCase().includes("spin");
  const isAllRounder = roleHint.toLowerCase().includes("all");
  let bat = 40 + Math.floor(consistentRand() * 40);
  let bowl = 10 + Math.floor(consistentRand() * 40);
  let luck = 50 + Math.floor(consistentRand() * 40);
  if (isBowler) {
    bat = 20 + Math.floor(consistentRand() * 30);
    bowl = 70 + Math.floor(consistentRand() * 20);
  }
  if (isAllRounder) {
    bat = 60 + Math.floor(consistentRand() * 25);
    bowl = 60 + Math.floor(consistentRand() * 25);
  }
  return { bat, bowl, luck, role: roleHint };
}

// --- DOM EVENT LISTENERS ---

// 1. HOST: Create Room
function attachCreateRoomListener() {
  const btn = document.getElementById("doCreateBtn");
  if (!btn) {
    setTimeout(attachCreateRoomListener, 300);
    return;
  }

  if (btn.dataset.listenerAttached) return;
  btn.dataset.listenerAttached = "true";

  btn.addEventListener("click", () => {
    if (!socketAlive)
      return (lobbyError.innerText = "Connection lost. Reconnecting...");

    const roomId = document.getElementById("createRoomId").value.toUpperCase();
    const pass = document.getElementById("createPass").value;

    if (!roomId || pass.length !== 4)
      return (lobbyError.innerText = "Invalid Room ID or Password");

    localStorage.setItem("ipl_last_room", roomId);
    localStorage.setItem("ipl_last_pass", pass);

    // Get player name from session if available
    const savedName = sessionStorage.getItem("ipl_auction_player_name") || localStorage.getItem("userName") || "";
    
    socket.emit("create_blind_room", {
      roomId,
      password: pass,
      config: {},
      gameType: "blind",
      playerName: savedName,
    });
  });
}

// 2. JOIN: Join Room
function attachJoinRoomListener() {
  const btn = document.getElementById("doJoinBtn");
  if (!btn) {
    setTimeout(attachJoinRoomListener, 300);
    return;
  }

  if (btn.dataset.listenerAttached) return;
  btn.dataset.listenerAttached = "true";

  btn.addEventListener("click", () => {
    if (!socketAlive)
      return (lobbyError.innerText = "Connection lost. Reconnecting...");

    const roomId = document.getElementById("joinRoomId").value.toUpperCase();
    const pass = document.getElementById("joinPass").value;

    if (!roomId || pass.length !== 4)
      return (lobbyError.innerText = "Check Credentials");

    localStorage.setItem("ipl_last_room", roomId);
    localStorage.setItem("ipl_last_pass", pass);

    // Get player name from session if available
    const savedName = sessionStorage.getItem("ipl_auction_player_name") || localStorage.getItem("userName") || "";
    
    socket.emit("join_blind_room", { roomId, password: pass, playerName: savedName });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    attachCreateRoomListener();
    attachJoinRoomListener();
  });
} else {
  setTimeout(() => {
    attachCreateRoomListener();
    attachJoinRoomListener();
  }, 100);
}

// --- SOCKET EVENTS ---

socket.off("roomcreated");
socket.on("roomcreated", (roomId) => {
  isAdmin = true;
  enterGame(roomId);
  document.body.classList.add("is-admin");
  document.getElementById("waitingText").style.display = "none";
  document.getElementById("startBtn").style.display = "block";
  initLobbyState();

  // Always show name entry for confirmation
  setTimeout(() => {
    const nameSection = document.getElementById("nameEntrySection");
    const nameInput = document.getElementById("lobbyPlayerName");
    if (nameSection) {
      nameSection.style.display = "block";
      if (nameInput && myPlayerName) {
        nameInput.value = myPlayerName;
      }
    }
  }, 300);
});

socket.off("room_joined");
socket.on("room_joined", (data) => {
  enterGame(data.roomId);
  isAdmin = data.isAdmin;
  if (isAdmin) {
    document.body.classList.add("is-admin");
    document.getElementById("waitingText").style.display = "none";
    logEvent("✅ Admin privileges restored.", true);
  } else {
    document.body.classList.remove("is-admin");
    document.getElementById("startBtn").style.display = "none";
    document.getElementById("waitingText").style.display = "block";
  }

  if (data.lobbyState) {
    globalTeams = data.lobbyState.teams;
    connectedUsersCount = data.lobbyState.userCount;
    document.getElementById("joinedCount").innerText = connectedUsersCount;

    const savedTeamKey = localStorage.getItem(`ipl_team_${data.roomId}`);
    if (savedTeamKey) {
      socket.emit("reclaim_team", savedTeamKey);
    } else {
      const myTeam = globalTeams.find(
        (t) => t.ownerPlayerId === myPersistentId,
      );
      if (myTeam) mySelectedTeamKey = myTeam.bidKey;
    }

    globalTeams.forEach((t) => {
      if (t.isTaken) knownTakenTeams.add(t.bidKey);
    });

    renderLobbyTeams();
  }

  // Always show name entry for confirmation
  setTimeout(() => {
    const nameSection = document.getElementById("nameEntrySection");
    const nameInput = document.getElementById("lobbyPlayerName");
    if (nameSection) {
      nameSection.style.display = "block";
      if (nameInput && myPlayerName) {
        nameInput.value = myPlayerName;
      }
    }
  }, 300);

  if (data.state && data.state.isActive) {
    auctionStarted = true;
    switchToAuctionMode(data.state.teams);
    if (data.state.queue) auctionQueue = data.state.queue;
    socket.emit("request_sync");
  }
});

function initLobbyState() {
  globalTeams = [];
  ALL_IPL_TEAMS.forEach((name, i) => {
    globalTeams.push({
      id: i,
      bidKey: `T${i}`,
      name: name,
      ownerSocketId: null,
      budget: parseInt(document.getElementById("budget").value),
      isTaken: false,
    });
  });
  socket.emit("update_lobby_teams", globalTeams);
  renderLobbyTeams();
}

// Update all team budgets when admin changes purse amount
window.updateAllTeamBudgets = function () {
  if (!isAdmin) return;

  const newBudget = parseInt(document.getElementById("budget").value);

  // Update all teams' budgets
  globalTeams.forEach((team) => {
    team.budget = newBudget;
  });

  // Broadcast to all players
  socket.emit("update_lobby_teams", globalTeams);
  renderLobbyTeams();

  logEvent(`💰 Host changed team purse to ${formatAmount(newBudget)}`, true);
};

// FIX: Add missing sync_data listener
socket.off("sync_data");
socket.on("sync_data", (data) => {
  if (data.teams) {
    globalTeams = data.teams;
    if (data.isActive) {
      switchToAuctionMode(globalTeams);
    } else {
      renderLobbyTeams();
    }
  }
  if (data.queue) auctionQueue = data.queue;

  if (data.currentLot) {
    // Restore current lot view
    // Simulate 'update_lot' behavior
    const p = data.currentLot;
    currentActivePlayer = p;
    saleProcessing = false;

    // Update UI elements manually or trigger logic
    document.getElementById("currentSet").innerText = p.set;
    document.getElementById("lotNoDisplay").innerText = `LOT #${(
      data.auctionIndex + 1
    )
      .toString()
      .padStart(3, "0")}`;
    document.getElementById("pName").innerText = p.name;
    document.getElementById("pCat").innerText = p.category;
    document.getElementById("pBase").innerText = formatAmount(p.basePrice);
    document.getElementById("pTypeBadge").innerText = p.roleKey.toUpperCase();

    const avatar = document.getElementById("pInitials");
    if (p.img) {
      avatar.innerText = "";
      avatar.style.backgroundImage = `url('${p.img}')`;
    } else {
      avatar.style.backgroundImage = "none";
      avatar.innerText = p.name.substring(0, 2).toUpperCase();
    }

    document.getElementById("pBid").innerText = formatAmount(data.currentBid);

    // Update Bidder/Team Info
    if (data.currentBidder) {
      const bidderTeam = globalTeams.find(
        (t) => t.bidKey === data.currentBidder,
      );
      if (bidderTeam) {
        document.getElementById("pTeam").innerHTML =
          `<span class="text-warning">${bidderTeam.name}</span>`;
        currentHighestBidderKey = data.currentBidder;
        document.getElementById("skipBtn").disabled = true;
        document.getElementById("soldBtn").disabled = false;
      }
    } else {
      document.getElementById("pTeam").innerHTML =
        `<span class="text-white-50">Opening Bid</span>`;
      currentHighestBidderKey = null;
      document.getElementById("skipBtn").disabled = false;
      document.getElementById("soldBtn").disabled = true;
    }

    // Resume Timer
    const timerEl = document.getElementById("auctionTimer");
    if (timerEl) {
      timerEl.innerText = data.timer;
      if (data.timerPaused) timerEl.classList.add("timer-paused");
      else timerEl.classList.remove("timer-paused");

      // SYNC PAUSE BUTTON STATE
      if (isAdmin && typeof updatePauseButtonState === "function") {
        updatePauseButtonState(data.timerPaused);
      }
    }

    const bidBtn = document.getElementById("placeBidBtn");
    bidBtn.disabled = false;
    updateBidControlsState(p);
  }
});

// 🔧 GLOBAL ERROR HANDLER
socket.on("error_message", (msg) => {
  alert("⚠️ ERROR: " + msg);
  logEvent("❌ " + msg, true);
});

function escapeHtml(text) {
  if (typeof text !== "string") return text;
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderLobbyTeams() {
  const container = document.getElementById("teamNamesContainer");
  container.innerHTML = "";
  const iHaveATeam = mySelectedTeamKey !== null;

  globalTeams.forEach((t) => {
    let isMyTeam = t.bidKey === mySelectedTeamKey;
    let statusClass,
      statusText,
      clickAction = "";

    if (t.isTaken) {
      if (isMyTeam) {
        statusClass = "my-choice";
        statusText = "YOUR TEAM";
      } else {
        statusClass = "taken";
        statusText = "TAKEN";
        clickAction = `onclick="requestReclaim('${t.bidKey}')"`;
      }
    } else {
      statusClass = "available";
      statusText = "CLICK TO JOIN";
      if (iHaveATeam) {
        clickAction = `onclick="alert('You have already joined a team!')" style="cursor: not-allowed; opacity: 0.5;"`;
      } else {
        clickAction = `onclick="claimLobbyTeam('${t.bidKey}')"`;
      }
    }

    const safeName = escapeHtml(t.name);
    let nameInput = isAdmin
      ? `<input type="text" class="form-control form-control-sm text-center bg-dark text-white border-secondary" value="${safeName}" onchange="adminRenameTeam('${t.bidKey}', this.value)">`
      : `<div class="fs-4 fw-bold text-white">${safeName}</div>`;

    // Display player name if team is taken
    const playerNameDisplay = t.playerName
      ? `<div class="small text-warning mt-1" style="font-size: 0.85rem;">${t.playerName}</div>`
      : "";

    container.innerHTML += `<div class="lobby-team-card ${statusClass}" ${clickAction}><span class="lobby-status-badge ${
      statusClass === "available"
        ? "bg-success"
        : statusClass === "my-choice"
          ? "bg-warning text-dark"
          : "bg-danger"
    }">${statusText}</span>${nameInput}${playerNameDisplay}<div class="small text-white-50">Budget: ${formatAmount(
      t.budget,
    )}</div></div>`;
  });

  if (isAdmin) {
    const startBtn = document.getElementById("startBtn");
    const takenCount = globalTeams.filter((t) => t.isTaken).length;

    if (takenCount < 2) {
      startBtn.disabled = true;
      startBtn.innerText = "WAITING FOR PLAYERS (Need 2+)";
      startBtn.classList.remove("btn-gold");
      startBtn.classList.add("btn-secondary");
    } else {
      startBtn.disabled = false;
      startBtn.innerText = `START AUCTION (${takenCount} Teams)`;
      startBtn.classList.remove("btn-secondary");
      startBtn.classList.add("btn-gold");
    }
  }
}

// Safely attach startBtn listener with proper null checks
function attachStartBtnListener() {
  const startBtn = document.getElementById("startBtn");
  if (!startBtn) {
    console.warn("⚠️ startBtn not found in DOM, retrying in 500ms...");
    setTimeout(attachStartBtnListener, 500);
    return;
  }

  if (startBtn.dataset.listenerAttached) {
    console.log("✓ startBtn listener already attached");
    return;
  }

  startBtn.dataset.listenerAttached = "true";

  startBtn.addEventListener("click", () => {
    if (!isAdmin) {
      alert("Only the host can start the auction!");
      return;
    }
    const activeTeams = globalTeams.filter((t) => t.isTaken);
    console.log("DEBUG: Active Teams Count:", activeTeams.length);

    // Relaxed check to unblock user if sync is slightly off
    if (activeTeams.length < 1) {
      console.warn(
        "⚠️ Warning: Client thinks there are 0 active teams, but DOM says otherwise. Sending request anyway.",
      );
      console.log("DEBUG: globalTeams dump:", JSON.stringify(globalTeams));
      // Continue instead of returning, relying on Server validation
    }

    try {
      console.log("🏗️ Building Auction Queue...");
      auctionQueue = buildAuctionQueue();
      console.log(`✅ Queue Built: ${auctionQueue.length} players`);

      socket.emit("start_blind_auction", {
        exchangeEnabled: true,
        queue: auctionQueue,
      });
      console.log("🚀 Sent 'start_blind_auction' event");

      // Visual Feedback
      startBtn.innerText = "STARTING...";
      startBtn.disabled = true;
    } catch (e) {
      console.error("❌ Error building queue:", e);
      alert("Error starting auction: " + e.message);
      logEvent("Error starting auction: " + e.message);
    }
  });

  console.log("✓ startBtn listener attached successfully");
}

// Try to attach listener immediately and also on DOMContentLoaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", attachStartBtnListener);
} else {
  setTimeout(attachStartBtnListener, 100);
}

socket.off("auction_started");
socket.off("blind_auction_started");
socket.on("blind_auction_started", (data) => {
  console.log("✓ blind_auction_started event received", data);
  auctionStarted = true;
  switchToAuctionMode(data.teams);
  // auctionQueue is managed by server, we just wait for new_blind_player
  logEvent(`<strong>BLIND AUCTION STARTED</strong>`, true);
  playHammerSound();
  speakText(
    "Ladies and Gentlemen, welcome to the Blind Auction. Get your bids ready!",
  );
});

function enterGame(roomId) {
  myRoomId = roomId;
  document.getElementById("currentRoomDisplay").innerText = roomId;
  lobbyScreen.style.setProperty("display", "none", "important");
  gameContainer.style.display = "block";
  document.getElementById("setupSection").style.display = "flex";

  // Initialize sound button now that gameContainer is visible
  initializeSoundButton();
}

function claimLobbyTeam(key) {
  if (mySelectedTeamKey) {
    alert("You have already joined a team!");
    return;
  }

  // Check if name input field has a value (user might not have pressed Enter yet)
  const nameInput = document.getElementById("lobbyPlayerName");
  if (nameInput && nameInput.value.trim()) {
    const name = nameInput.value.trim();
    myPlayerName = name;
    localStorage.setItem("ipl_auction_player_name", name);

    // Hide name entry section
    const nameSection = document.getElementById("nameEntrySection");
    if (nameSection) {
      nameSection.style.display = "none";
    }
  }

  // Send player name to server first if we have one
  if (myPlayerName) {
    socket.emit("update_player_name", { playerName: myPlayerName });
  } else {
    // If no name is set, prompt user
    alert("Please enter your name first!");
    const nameSection = document.getElementById("nameEntrySection");
    if (nameSection) {
      nameSection.style.display = "block";
      if (nameInput) nameInput.focus();
    }
    return;
  }

  // Small delay to ensure name is received before claiming
  setTimeout(() => {
    const userEmail = localStorage.getItem("userEmail") || "";
    socket.emit("claim_lobby_team", { key, email: userEmail });
  }, 100);
}

function requestReclaim(bidKey) {
  if (
    confirm(
      "This team is taken. Do you want to request the Host to reclaim it?",
    )
  ) {
    socket.emit("request_reclaim_manual", { teamKey: bidKey });
    lobbyError.innerText = "Request sent to Host... Waiting for approval.";
  }
}

function adminRenameTeam(key, newName) {
  socket.emit("admin_rename_team", { key, newName });
}

socket.off("lobby_update");
socket.on("lobby_update", (data) => {
  globalTeams = data.teams;
  connectedUsersCount = data.userCount;
  document.getElementById("joinedCount").innerText = connectedUsersCount;

  if (isSoundEnabled) {
    globalTeams.forEach((t) => {
      if (t.isTaken && !knownTakenTeams.has(t.bidKey)) {
        speakText(`${t.name} has joined.`);
        knownTakenTeams.add(t.bidKey);
      }
    });
  }
  renderLobbyTeams();
});

socket.off("team_claim_success");
socket.on("team_claim_success", (key) => {
  mySelectedTeamKey = key;
  if (myRoomId) localStorage.setItem(`ipl_team_${myRoomId}`, key);
  renderLobbyTeams();
  lobbyError.innerText = "✅ Team ownership granted!";
  logEvent("✅ Team ownership restored.", true);
});

// --- AUCTION QUEUE BUILDER ---
function buildAuctionQueue() {
  const queue = [];
  const seen = new Set();
  const shuffle = (array) => array.sort(() => Math.random() - 0.5);

  const safePush = (players) => {
    players.forEach((p) => {
      if (!seen.has(p.name)) {
        seen.add(p.name);
        queue.push(p);
      }
    });
  };

  const createPlayer = (dataObj, setName, roleHint, basePrice, increment) => {
    let name = typeof dataObj === "object" ? dataObj.name : dataObj;
    let type = typeof dataObj === "object" ? dataObj.type : "Unknown";
    const stats = getPlayerStats(name, roleHint);
    // FIX: Use normalized map for case-insensitive lookup
    const safeKey = name.toLowerCase();
    const imageSrc =
      NORMALIZED_IMAGE_MAP[safeKey] || PLAYER_IMAGE_MAP[name] || null;
    return {
      name,
      category: `${type} ${roleHint}`,
      roleKey: roleHint.toLowerCase(),
      basePrice,
      incrementStep: increment,
      set: setName,
      img: imageSrc,
      stats: stats,
      playerType: type,
      isProcessed: false,
      status: null,
    };
  };

  const marqueeBat = MARQUEE_PLAYERS.batter.map((p) =>
    createPlayer(p, "Marquee Set (Bat)", "batter", 20000000, 2500000),
  );
  const marqueeBowl = MARQUEE_PLAYERS.bowler.map((p) =>
    createPlayer(p, "Marquee Set (Bowl)", "bowler", 20000000, 2500000),
  );
  const marqueeAR = MARQUEE_PLAYERS.allrounder.map((p) =>
    createPlayer(p, "Marquee Set (AR)", "allrounder", 20000000, 2500000),
  );
  const marqueeWK = MARQUEE_PLAYERS.wicketkeeper.map((p) =>
    createPlayer(p, "Marquee Set (WK)", "wk", 20000000, 2500000),
  );

  safePush(
    shuffle([...marqueeBat, ...marqueeBowl, ...marqueeAR, ...marqueeWK]),
  );

  const processCategory = (categoryName, roleName, foreignList, indianList) => {
    const f = foreignList.map((n) =>
      createPlayer(
        { name: n, type: "Foreign" },
        `${categoryName} (Foreign)`,
        roleName,
        15000000,
        2500000,
      ),
    );
    const i = indianList.map((n) =>
      createPlayer(
        { name: n, type: "Indian" },
        `${categoryName} (Indian)`,
        roleName,
        10000000,
        2500000,
      ),
    );
    return shuffle([...f, ...i]);
  };

  safePush(
    processCategory(
      "Batters",
      "batter",
      RAW_DATA["Batsmen"].foreign,
      RAW_DATA["Batsmen"].indian,
    ),
  );
  safePush(
    processCategory(
      "Fast Bowlers",
      "fast",
      RAW_DATA["Fast Bowlers"].foreign,
      RAW_DATA["Fast Bowlers"].indian,
    ),
  );

  safePush(
    processCategory(
      "Spinners",
      "spinner",
      RAW_DATA["Spinners"].foreign,
      RAW_DATA["Spinners"].indian,
    ),
  );
  safePush(
    processCategory(
      "Wicketkeepers",
      "wk",
      RAW_DATA["Wicketkeeper"].foreign,
      RAW_DATA["Wicketkeeper"].indian,
    ),
  );
  safePush(
    processCategory(
      "All-Rounders",
      "allrounder",
      RAW_DATA["All-rounders"].foreign,
      RAW_DATA["All-rounders"].indian,
    ),
  );

  const domBat = RAW_DATA["Domestic"].batsmen.map((n) =>
    createPlayer(
      { name: n, type: "Uncapped" },
      "Domestic Set",
      "batter",
      2500000,
      500000,
    ),
  );
  const domBowl = RAW_DATA["Domestic"].bowlers.map((n) =>
    createPlayer(
      { name: n, type: "Uncapped" },
      "Domestic Set",
      "bowler",
      2500000,
      500000,
    ),
  );
  safePush(shuffle([...domBat, ...domBowl]));

  return queue;
}

function switchToAuctionMode(teams) {
  globalTeams = teams;
  document.getElementById("setupSection").style.display = "none";
  document.getElementById("auctionDashboard").style.display = "flex";
  updateTeamSidebar(teams);
  setupBidControls();
}

// 🔧 UPDATE LOT (New Player)
// 🔧 NEW BLIND PLAYER (Replaces Update Lot)
socket.off("new_blind_player");
socket.on("new_blind_player", (data) => {
  const p = data.player;
  currentActivePlayer = p;
  saleProcessing = false;

  // UI Updates
  document.getElementById("currentSet").innerText = p.set || "General";
  document.getElementById("pName").innerText = p.name;
  document.getElementById("pCat").innerText = p.category;
  document.getElementById("pBase").innerText = formatAmount(p.basePrice);
  document.getElementById("pTypeBadge").innerText = p.roleKey
    ? p.roleKey.toUpperCase()
    : "UNK";

  // Image
  const avatar = document.getElementById("pInitials");
  if (p.img) {
    avatar.innerText = "";
    avatar.style.backgroundImage = `url('${p.img}')`;
  } else {
    avatar.style.backgroundImage = "none";
    avatar.innerText = p.name.substring(0, 2).toUpperCase();
  }

  // Reset Bid Display
  document.getElementById("pBid").innerText = formatAmount(p.basePrice);
  document.getElementById("pTeam").innerHTML =
    `<span class="text-white-50">Waiting for Bids...</span>`;

  // Controls
  const bidBtn = document.getElementById("placeBidBtn");
  bidBtn.disabled = false;
  bidBtn.innerHTML = `SUBMIT BID <i class="bi bi-envelope-check"></i>`;
  bidBtn.classList.remove("btn-secondary");
  bidBtn.classList.add("btn-gold");
  bidBtn.onclick = submitBlindBid; // Change handler

  // Input Setup
  const input = document.getElementById("customBidInput");
  if (input) {
    input.value = p.basePrice;
    input.min = p.basePrice;
    input.step = 500000;
  }

  // Admin Controls
  document.getElementById("skipBtn").disabled = true;
  document.getElementById("soldBtn").disabled = true;

  // HIDE OVERLAY (fixes stuck results page)
  const overlay = document.getElementById("saleOverlay");
  overlay.style.display = "none";
  overlay.classList.remove("overlay-visible");

  updateTeamSidebar(globalTeams);

  // Re-setup controls with current player data
  setupBidControls(p);

  // RESET INPUT AREA (Re-enable)
  const bidInputArea = document.getElementById("bidInputArea");
  if (bidInputArea) {
    bidInputArea.style.opacity = "1";
    bidInputArea.style.pointerEvents = "auto";
  }

  // AUTO-CLOSE BID INPUT AFTER 10 SECONDS
  if (window.bidInputTimeoutId) {
    clearTimeout(window.bidInputTimeoutId);
  }
  // Sync with server's blind auction timer (12 seconds by default)
  window.bidInputTimeoutId = setTimeout(() => {
    // Close/disable bid input after 10 seconds
    const bidInputArea = document.getElementById("bidInputArea");
    if (bidInputArea) {
      bidInputArea.style.opacity = "0.5";
      bidInputArea.style.pointerEvents = "none";
    }
    const bidInputEl = document.getElementById("customBidInput");
    if (bidInputEl) {
      bidInputEl.disabled = true;
    }
    const placeBidBtn = document.getElementById("placeBidBtn");
    if (placeBidBtn) {
      placeBidBtn.disabled = true;
      placeBidBtn.innerHTML = 'BIDDING CLOSED <i class="bi bi-lock"></i>';
    }
    const passBidBtn = document.getElementById("passBidBtn");
    if (passBidBtn) {
      passBidBtn.disabled = true;
    }
    logEvent("Bidding input closed - time's up!", true);
  }, 12000);

  logEvent(`<strong>LOT UP:</strong> ${p.name}`, true);
  speakText(`Next player. ${p.name}. Base price ${formatAmount(p.basePrice)}.`);
});

// 🔧 BLIND TIMER TICK
socket.off("blind_timer_tick");
socket.on("blind_timer_tick", (timeLeft) => {
  const timerEl = document.getElementById("auctionTimer");
  if (timerEl) {
    timerEl.innerText = timeLeft;
    if (timeLeft <= 3) timerEl.classList.add("timer-danger");
    else timerEl.classList.remove("timer-danger");
  }
});

// 🔧 SMART BID PARSER
function parseBidValue(val) {
  if (!val) return 0;
  // Remove commas if any
  let cleaned = val.toString().replace(/,/g, "");
  let num = parseFloat(cleaned);
  if (isNaN(num)) return 0;

  // Use a threshold: If entered value is less than 1000, assume it's in Short Notation (Crores)
  // 10.25 -> 10.25 Crore
  // 0.5 -> 50 Lakhs
  // 50 -> 50 Crore (If they want 50 Lakhs, they should enter 0.5 or 5000000)
  if (num < 1000) {
    return Math.round(num * 10000000);
  }

  return Math.round(num);
}

// 🔧 SUBMIT BLIND BID
function submitBlindBid() {
  if (!socketAlive) return alert("Connection lost!");
  if (!currentActivePlayer) return;
  if (!mySelectedTeamKey) return alert("You don't have a team!");

  const myTeam = globalTeams.find((t) => t.bidKey === mySelectedTeamKey);
  const rawVal = document.getElementById("customBidInput").value;
  const amount = parseBidValue(rawVal);

  // Validation
  if (!rawVal || isNaN(amount) || amount <= 0) {
    alert("Please enter a valid amount!");
    return;
  }
  if (amount < currentActivePlayer.basePrice) {
    alert(
      "Bid must be at least Base Price (" +
        formatAmount(currentActivePlayer.basePrice) +
        ")!",
    );
    return;
  }
  if (myTeam.budget < amount) {
    alert("Insufficient Budget!");
    return;
  }

  socket.emit("submit_blind_bid", {
    teamKey: mySelectedTeamKey,
    amount: amount,
  });

  // UI Feedback
  disableBidControls(true);

  logEvent(`You submitted a bid of ${formatAmount(amount)}`, true);
}

function submitBlindPass() {
  if (!socketAlive) return;
  if (!mySelectedTeamKey) return;

  socket.emit("submit_blind_bid", {
    teamKey: mySelectedTeamKey,
    amount: 0, // 0 means Not Interested
  });

  disableBidControls(true);
  logEvent(`You skipped this player (Not Interested)`, true);
}

function disableBidControls(disabled) {
  const placeBtn = document.getElementById("placeBidBtn");
  const passBtn = document.getElementById("passBidBtn");
  const input = document.getElementById("customBidInput");

  if (placeBtn) placeBtn.disabled = disabled;
  if (passBtn) passBtn.disabled = disabled;
  if (input) input.disabled = disabled;

  if (disabled) {
    if (placeBtn)
      placeBtn.innerHTML = `SUBMITTED <i class="bi bi-check-lg"></i>`;
  } else {
    if (placeBtn) placeBtn.innerHTML = `SUBMIT <i class="bi bi-send-fill"></i>`;
    if (input) {
      input.value = "";
      input.focus();
    }
  }
}

// 🛑 SUBMIT BID (UNIFIED LOGIC)
function submitMyBid() {
  if (!socketAlive) return alert("Connection lost. Please wait…");

  // Check if controls are disabled
  if (document.getElementById("placeBidBtn").disabled) return;

  // If in blind mode (pBid says SEALED), use submitBlindBid
  if (document.getElementById("pBid").innerText === "SEALED") {
    submitBlindBid();
    return;
  }

  if (
    !auctionStarted ||
    document
      .getElementById("saleOverlay")
      .classList.contains("overlay-active") ||
    document.getElementById("saleOverlay").classList.contains("overlay-visible")
  )
    return;
  if (currentHighestBidderKey === mySelectedTeamKey) return;
  if (!mySelectedTeamKey) return alert("You don't have a team!");
  if (!currentActivePlayer) return;

  const myTeam = globalTeams.find((t) => t.bidKey === mySelectedTeamKey);
  if (!myTeam) return;

  const currentSquadSize = myTeam.roster ? myTeam.roster.length : 0;
  if (currentSquadSize >= 25) {
    alert("SQUAD FULL! You have reached 25 players.");
    return;
  }

  if (currentActivePlayer.playerType === "Foreign") {
    const foreignCount = myTeam.roster
      ? myTeam.roster.filter((p) => p.playerType === "Foreign").length
      : 0;
    if (foreignCount >= 8) {
      alert("FOREIGN QUOTA FULL! Max 8 allowed.");
      return;
    }
  }

  // Logic for increment in normal mode
  const currentBidText = document.getElementById("pBid").innerText;
  const incValue =
    parseInt(document.getElementById("customBidInput").value) || 2500000;

  let bidAmount;

  if (currentHighestBidderKey === null) {
    bidAmount = currentActivePlayer.basePrice;
  } else {
    const parsed = parsePrice(currentBidText);
    const current = parsed > 0 ? parsed : currentActivePlayer.basePrice;
    bidAmount = current + incValue;
  }

  if (myTeam.budget < bidAmount) {
    alert("INSUFFICIENT BUDGET!");
    return;
  }

  socket.emit("place_bid", {
    teamKey: mySelectedTeamKey,
    teamName: myTeam.name,
    amount: bidAmount,
  });
}

// 🔧 BIDS REVEALED
socket.off("bids_revealed");
socket.on("bids_revealed", (data) => {
  console.log("BIDS REVEALED:", data);
  const bids = data.bids; // Sorted highest first
  const winner = data.winner;

  if (currentActivePlayer) {
    currentActivePlayer.winnerKey = winner ? winner.teamKey : null;
  }

  let html = `<div class="reveal-container">
        <h3 class="display-font text-warning mb-4 text-center">AUCTION RESULTS: ${data.playerName}</h3>
        <div class="d-flex flex-column gap-2">
    `;

  bids.forEach((b, index) => {
    if (b.amount <= 0) return; // Skip zero bids (Not Interested)

    const isWin = winner && winner.teamKey === b.teamKey;

    let rowClass = "reveal-row";
    let statusBadge = "";
    let actionBtn = "";

    if (isWin) {
      rowClass += " winner";
      statusBadge = `<span class="winner-label">WON</span>`;
    } else {
      // ALL OTHER TEAMS HAVE OFFER BUTTON
      if (winner && winner.teamKey === mySelectedTeamKey) {
        // If I am the winner, others can see "OFFER" (handled by they being current user)
      } else if (!isWin && winner) {
        // If I am NOT the winner, show the OFFER button
        actionBtn = `<button class="request-btn" onclick="requestExchange('${mySelectedTeamKey}', '${winner.teamKey}')">OFFER</button>`;
      }
    }

    html += `
            <div class="${rowClass}">
                <div class="d-flex align-items-center">
                    <span class="reveal-team">${b.teamName}</span>
                    ${statusBadge}
                </div>
                <div class="d-flex align-items-center gap-3">
                    <span class="reveal-amount">${formatAmount(b.amount)}</span>
                    ${actionBtn}
                </div>
            </div>
        `;
  });

  if (!winner) {
    html += `<div class="reveal-row justify-content-center text-danger border-danger">UNSOLD</div>`;
  }

  html += `</div>
    <div id="exchangeArea" class="mt-4 w-100"></div>`;

  if (winner && winner.teamKey === mySelectedTeamKey) {
    html += `
            <div id="selfKeepArea" class="mt-4 p-3 border border-success rounded bg-success bg-opacity-10 text-center w-100">
                <div class="text-success fw-bold mb-2">🎉 YOU WON THE BID!</div>
                <div class="small text-white-50 mb-2">Wait for other teams to send exchange offers...</div>
                <div id="exchangeTimerDisplay" class="text-warning fw-bold mb-3" style="font-size: 1.2rem;">⏱️ Time remaining: <span id="exchangeTimerValue">5</span>s</div>
                <div class="d-flex gap-3 w-100">
                    <button class="bid-submit-btn flex-grow-1" onclick="socket.emit('keep_player')">KEEP THIS PLAYER</button>
                    <button class="btn btn-warning flex-grow-1 py-3 display-font" onclick="socket.emit('start_exchange_contest')">EXCHANGE</button>
                </div>
            </div>
         `;
  }

  if (isAdmin && !winner) {
    html += `<button onclick="socket.emit('proceed_to_next_player')" class="btn btn-warning w-100 mt-3">NEXT PLAYER</button>`;
  }

  html += `</div>`;

  // Use Sale Overlay
  const overlay = document.getElementById("saleOverlay");
  overlay.innerHTML = html;
  overlay.classList.add("overlay-visible");
  overlay.style.display = "flex";
  overlay.style.flexDirection = "column";
  overlay.style.zIndex = "2000";
  overlay.style.background = "rgba(0,0,0,0.95)";

  playHammerSound();

  if (winner) {
    speakText(
      `${data.playerName} won by ${winner.teamName} for ${formatAmount(winner.amount)}.`,
    );
  } else {
    speakText("Unsold.");
  }
});

// 🔧 EXCHANGE REQUEST UPDATED
socket.off("exchange_requests_updated");
socket.on("exchange_requests_updated", (data) => {
  const selfKeep = document.getElementById("selfKeepArea");
  if (!selfKeep || mySelectedTeamKey !== currentActivePlayer.winnerKey) return;

  const count = data.requestors.length;
  if (count > 0 && selfKeep && selfKeep.style.display !== "none") {
    selfKeep.innerHTML = `
             <div class="text-warning fw-bold mb-2">📩 ${count} EXCHANGE REQUESTS RECEIVED!</div>
             <div class="d-flex gap-2 mb-2">
                <button class="btn btn-success flex-grow-1 py-3 display-font" onclick="socket.emit('keep_player')">KEEP PLAYER</button>
                <button class="btn btn-primary flex-grow-1 py-3 display-font" onclick="socket.emit('start_exchange_contest')">EXCHANGE</button>
             </div>
             <button class="btn btn-outline-danger w-100 py-2 display-font" onclick="socket.emit('reject_all_requests')">REJECT ALL OFFERS</button>
        `;
  }
});

socket.off("exchange_requests_rejected");
socket.on("exchange_requests_rejected", (data) => {
  const selfKeep = document.getElementById("selfKeepArea");
  if (selfKeep && mySelectedTeamKey === currentActivePlayer.winnerKey) {
    selfKeep.innerHTML = `
            <div class="text-success fw-bold mb-2">🎉 YOU WON THE BID!</div>
            <div class="small text-white-50 mb-3">Wait for other teams to send exchange offers...</div>
            <div class="d-flex gap-3 w-100">
                <button class="bid-submit-btn flex-grow-1" onclick="socket.emit('keep_player')">KEEP THIS PLAYER</button>
                <button class="btn btn-warning flex-grow-1 py-3 display-font" onclick="socket.emit('start_exchange_contest')">EXCHANGE</button>
            </div>
        `;
  }
  logEvent(data.message, true);
});

// 🔧 EXCHANGE CONTEST STARTED
socket.off("exchange_contest_started");
socket.on("exchange_contest_started", (data) => {
  const overlay = document.getElementById("saleOverlay");
  const isRequestor = data.requestors.includes(mySelectedTeamKey);

  let html = `<div class="reveal-container text-center">
        <h3 class="display-font text-info mb-3">🔥 EXCHANGE CONTEST: ${data.player.name}</h3>
        <p class="text-white-50">Current Winning Price: <span class="text-warning fw-bold">${formatAmount(data.basePrice)}</span></p>
    `;

  if (isRequestor) {
    html += `
            <div class="mt-4 p-4 border border-info rounded bg-info bg-opacity-10">
                <h4 class="text-white mb-3">SUBMIT YOUR CHALLENGE BID</h4>
                <div class="amount-entry-box mb-3">
                    <input type="text" id="contestBidInput" class="amount-input" placeholder="ENTER NEW AMOUNT" inputmode="decimal">
                </div>
                <button class="bid-submit-btn w-100" id="submitContestBtn">SUBMIT CHALLENGE</button>
            </div>
        `;
  } else {
    html += `
            <div class="mt-4 p-4 text-white-50">
                <div class="spinner-border text-info mb-3"></div>
                <p>Requesting teams are placing their final bids...</p>
            </div>
        `;
  }
  html += "</div>";

  overlay.innerHTML = html;

  if (isRequestor) {
    document.getElementById("submitContestBtn").onclick = () => {
      const rawVal = document.getElementById("contestBidInput").value;
      const amount = parseBidValue(rawVal);
      if (amount <= data.basePrice) {
        return alert(
          "Challenge bid must be higher than " + formatAmount(data.basePrice),
        );
      }
      // Budget check for contest bid
      const myTeam = globalTeams.find((t) => t.bidKey === mySelectedTeamKey);
      if (myTeam && myTeam.budget < amount) {
        return alert("Insufficient Budget for this bid!");
      }
      socket.emit("submit_contest_bid", { amount: amount });
      document.getElementById("submitContestBtn").disabled = true;
      document.getElementById("submitContestBtn").innerText = "BID SUBMITTED";
    };
  }
});

// ⚖️ TIE-BREAKER JUST STARTED
socket.off("tie_breaker_started");
socket.on("tie_breaker_started", (data) => {
  const overlay = document.getElementById("saleOverlay");
  const isTied = data.teams.some((t) => t.teamKey === mySelectedTeamKey);

  let html = `<div class="reveal-container text-center">
        <h2 class="display-font text-warning mb-3">⚖️ TIE DETECTED!</h2>
        <p class="text-white-50 mb-4">Teams ${data.teams.map((t) => t.teamName).join(" & ")} bid the same amount: <span class="text-success fw-bold">${formatAmount(data.amount)}</span></p>
    `;

  if (isTied) {
    html += `
            <div class="mt-4 p-4 border border-warning rounded bg-warning bg-opacity-10">
                <h4 class="text-white mb-3">RE-SUBMIT YOUR BID TO BREAK TIE</h4>
                <div class="amount-entry-box mb-3">
                    <input type="text" id="tieBidInput" class="amount-input" placeholder="ENTER NEW AMOUNT" inputmode="decimal">
                </div>
                <button class="bid-submit-btn w-100" id="submitTieBtn">SUBMIT TIE-BREAKER</button>
                <p class="small text-white-50 mt-3">Bid must be higher than ${formatAmount(data.amount)} to win.</p>
            </div>
        `;
  } else {
    html += `
            <div class="mt-4 p-4 text-white-50">
                <div class="spinner-border text-warning mb-3"></div>
                <p>Tied teams are re-submitting their bids...</p>
            </div>
        `;
  }
  html += "</div>";

  overlay.innerHTML = html;
  overlay.classList.add("overlay-visible");
  overlay.style.display = "flex";
  overlay.style.background = "rgba(0,0,0,0.95)";

  if (isTied) {
    document.getElementById("submitTieBtn").onclick = () => {
      const rawVal = document.getElementById("tieBidInput").value;
      const amount = parseBidValue(rawVal);
      if (amount <= data.amount) {
        return alert(
          "Tie-breaker bid must be higher than " + formatAmount(data.amount),
        );
      }
      // Budget check for tie-breaker bid
      const myTeam = globalTeams.find((t) => t.bidKey === mySelectedTeamKey);
      if (myTeam && myTeam.budget < amount) {
        return alert("Insufficient Budget for this bid!");
      }
      socket.emit("submit_tie_bid", { amount: amount });
      document.getElementById("submitTieBtn").disabled = true;
      document.getElementById("submitTieBtn").innerText = "BID SUBMITTED";
    };
  }

  playBidSound();
  speakText("A tie has been detected. Tied teams please re-submit your bids.");
});

socket.off("exchange_contest_finalized");
socket.on("exchange_contest_finalized", (data) => {
  const overlay = document.getElementById("saleOverlay");
  overlay.innerHTML = `
        <div class="reveal-container text-center">
            <h1 class="display-font text-success mb-3">🏆 EXCHANGE WINNER!</h1>
            <h2 class="display-3 text-white mb-2">${data.winner}</h2>
            <h3 class="text-warning">${formatAmount(data.amount)}</h3>
            <div class="mt-4 text-white-50">Transferring player...</div>
        </div>
    `;
  playHammerSound();
  speakText(
    `Exchange contest won by ${data.winner} for ${formatAmount(data.amount)}.`,
  );
});

socket.off("exchange_accepted");
socket.on("exchange_accepted", (data) => {
  const overlay = document.getElementById("saleOverlay");
  overlay.innerHTML = `
        <div class="reveal-container text-center">
            <h1 class="display-font text-info mb-3">🤝 EXCHANGE ACCEPTED!</h1>
            <h2 class="display-3 text-white mb-2">${data.toTeamName}</h2>
            <h4 class="text-info">${data.player.name} transferred</h4>
            <div class="mt-4 text-white-50">Finalizing sale...</div>
        </div>
    `;
  playHammerSound();
  speakText(
    `Exchange accepted. ${data.player.name} transferred to ${data.toTeamName}.`,
  );
});

// Exchange Helper
window.requestExchange = function (fromTeam, toTeam) {
  socket.emit("request_exchange", {
    fromTeam: fromTeam,
    toTeam: toTeam,
    player: currentActivePlayer, // Pass current player info
  });

  // Update the button locally to show it was sent
  const btn = event.currentTarget;
  if (btn) {
    btn.disabled = true;
    btn.innerText = "REQUESTED";
    btn.classList.add("btn-secondary");
  }
};

// 🔧 EXCHANGE REQUEST RECEIVED
socket.off("exchange_request_received");
socket.on("exchange_request_received", (data) => {
  // Show Custom Overlay to Target Team instead of confirm()
  if (data.toTeam === mySelectedTeamKey) {
    const overlay = document.getElementById("saleOverlay");
    const price = data.player.soldPrice || data.player.basePrice || "---";

    overlay.innerHTML = `
            <div class="reveal-container text-center animate__animated animate__fadeInUp" style="max-width: 400px;">
                <h3 class="display-font text-warning mb-3">EXCHANGE OFFER!</h3>
                <div class="p-3 bg-white bg-opacity-10 rounded mb-4 position-relative" style="border: 1px solid rgba(255,255,255,0.1); overflow: hidden;">
                    <!-- Team Logo Background/Watermark -->
                    <div style="position: absolute; top: 10px; right: 10px; opacity: 0.2;">
                         <img src="assets/teams/${data.fromTeam}.png" onerror="this.style.display='none'" style="width: 60px; height: 60px; object-fit: contain;">
                    </div>

                    <p class="text-white-50 small mb-1">TEAM ${data.fromTeam} wants to give you</p>
                    
                    <div class="d-flex align-items-center gap-3 justify-content-center my-3">
                        <img src="${data.player.img || 'assets/players/default.png'}" 
                             style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover; border: 2px solid #ffc107; box-shadow: 0 0 15px rgba(255, 193, 7, 0.3);">
                        <div class="text-start">
                             <h2 class="text-white display-font mb-0" style="font-size: 1.8rem;">${data.player.name}</h2>
                             <div class="text-info small">${data.player.role || 'Player'}</div>
                        </div>
                    </div>

                    <div class="fs-4 text-success fw-bold mb-2">${formatAmount(price)}</div>
                    <p class="small text-muted mb-0">Do you want this player?</p>
                </div>
                <div class="d-flex gap-3 justify-content-center">
                    <button class="btn btn-success btn-lg px-4 flex-grow-1 display-font" id="cfAcceptBtn">YES</button>
                    <button class="btn btn-danger btn-lg px-4 flex-grow-1 display-font" id="cfRejectBtn">NO</button>
                </div>
            </div>
        `;

    overlay.classList.add("overlay-visible");
    overlay.style.display = "flex";
    overlay.style.background = "rgba(0,0,0,0.92)";

    document.getElementById("cfAcceptBtn").onclick = () => {
      socket.emit("accept_exchange", { fromTeam: data.fromTeam });
      overlay.style.display = "none";
      overlay.classList.remove("overlay-visible");
    };

    document.getElementById("cfRejectBtn").onclick = () => {
      socket.emit("reject_exchange", { fromTeam: data.fromTeam });
      overlay.style.display = "none";
      overlay.classList.remove("overlay-visible");
    };
  }
});

socket.off("exchange_finalized");
socket.on("exchange_finalized", (data) => {
  // Hide overlay
  const overlay = document.getElementById("saleOverlay");
  overlay.style.display = "none";
  overlay.classList.remove("overlay-visible");
  
  // Clear any client side timer text just in case
  const timerEl = document.getElementById("exchangeTimerValue");
  if(timerEl) timerEl.innerText = "0";

  globalTeams = data.teams;
  updateTeamSidebar(globalTeams);
  logEvent(data.message, true);
});

// NEW: Handle Decision Timer Tick
socket.off("blind_timer_tick");
socket.on("blind_timer_tick", (timeLeft) => {
    const el = document.getElementById("exchangeTimerValue");
    if(el) {
        el.innerText = timeLeft;
        if(timeLeft <= 5) {
             el.style.color = "red";
             el.parentElement.classList.add("animate__animated", "animate__flash");
             playTickSound();
        }
    }
});

// Handle Timer Extension (when someone requests exchange)
socket.off("timer_extended");
socket.on("timer_extended", (data) => {
    console.log(`⏱️ Timer extended: ${data.message}`);
    
    // Show toast notification
    showToast(`⏱️ ${data.message}`, "info");
    
    // Log the event
    logEvent(`⏱️ ${data.message}`, true);
    
    // Play a sound effect
    playBeep(600, 0.1);
});

socket.off("exchange_rejected");
socket.on("exchange_rejected", (data) => {
  // If I am the one who sent the request, show alert
  if (data.fromTeam === mySelectedTeamKey) {
    alert(`Exchange offer was REJECTED by ${data.toTeamName}`);
  }
});

// 🔧 EXCHANGE TIMER TICK
socket.off("exchange_timer_tick");
socket.on("exchange_timer_tick", (timeLeft) => {
  const timerValue = document.getElementById("exchangeTimerValue");
  if (timerValue) {
    timerValue.innerText = timeLeft;
    if (timeLeft <= 2) {
      timerValue.style.color = "#ff4444";
    }
  }
});

socket.off("unsold_finalized");
socket.on("unsold_finalized", (data) => {
  const overlay = document.getElementById("saleOverlay");
  overlay.style.display = "none";
  overlay.classList.remove("overlay-visible");
  logEvent(data.message, true);
});

// 🎯 OPEN SQUAD SELECTION (Auction Complete)
socket.off("open_squad_selection");
socket.on("open_squad_selection", () => {
  console.log("✅ Auction complete! Opening squad selection...");
  
  // Hide any overlays
  const overlay = document.getElementById("saleOverlay");
  if (overlay) {
    overlay.style.display = "none";
    overlay.classList.remove("overlay-visible");
  }
  
  // Show squad selection section if it exists
  const squadSection = document.getElementById("squadSelectionSection");
  if (squadSection) {
    squadSection.style.display = "block";
    document.getElementById("auctionDashboard").style.display = "none";
  }
  
  // Notify the user
  logEvent("<strong>🎉 AUCTION COMPLETE!</strong> Proceed to squad selection.", true);
  speakText("The auction is complete! Please proceed to select your playing eleven.");
  playHammerSound();
  
  // Show a completion notification
  showToast("Auction Complete! 🎉 Proceed to squad selection.", "success");
});

// 🛑 SUBMIT BID (FIXED LOGIC)

// Safely attach placeBidBtn listener
function attachPlaceBidListener() {
  const placeBidBtn = document.getElementById("placeBidBtn");
  if (!placeBidBtn) {
    console.warn("⚠️ placeBidBtn not found, retrying in 300ms...");
    setTimeout(attachPlaceBidListener, 300);
    return;
  }

  if (placeBidBtn.dataset.listenerAttached) return;
  placeBidBtn.dataset.listenerAttached = "true";

  placeBidBtn.addEventListener("click", submitMyBid);
  console.log("✓ placeBidBtn listener attached");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", attachPlaceBidListener);
} else {
  setTimeout(attachPlaceBidListener, 100);
}

// NOTE: Removed duplicate listener attachment to prevent double-bid submissions
// The attachPlaceBidListener function handles all cases properly

// Logout functionality
document.getElementById("logoutBtn")?.addEventListener("click", () => {
  localStorage.removeItem("token");
  sessionStorage.removeItem("ipl_auction_player_name");
  window.location.href = "login.html";
});
document.addEventListener("keydown", (e) => {
  if (lobbyScreen.style.display !== "none") return;

  // Prevent actions if typing in an input field (except custom bid)
  if (
    document.activeElement.tagName === "INPUT" &&
    document.activeElement.id !== "customBidInput"
  )
    return;

  // BID SHORTCUTS (Space/Enter)
  if (e.code === "Space" || e.code === "Enter") {
    e.preventDefault();
    submitMyBid();
  }

  // HOST SHORTCUTS (S = Sold, U = Unsold/Skip)
  if (isAdmin) {
    if (e.key.toLowerCase() === "s") {
      document.getElementById("soldBtn").click();
    }
    if (e.key.toLowerCase() === "u") {
      document.getElementById("skipBtn").click();
    }
  }
});

socket.off("timer_tick");
socket.on("timer_tick", (val) => {
  const timerEl = document.getElementById("auctionTimer");
  if (timerEl) {
    timerEl.innerText = val;

    // Calculate percentage (Assuming 10s max as per server logic)
    const MAX_TIME = 10;
    const percentage = (val / MAX_TIME) * 100;
    timerEl.style.setProperty("--progress", `${percentage}%`);

    timerEl.classList.remove("timer-paused", "timer-danger");
    if (val <= 3) timerEl.classList.add("timer-danger");
  }
});

socket.off("timer_status");
socket.on("timer_status", (isPaused) => {
  const timerEl = document.getElementById("auctionTimer");
  if (isAdmin) updatePauseButtonState(isPaused);
  if (timerEl)
    isPaused
      ? timerEl.classList.add("timer-paused")
      : timerEl.classList.remove("timer-paused");
});

socket.off("timer_ended");
socket.on("timer_ended", () => {
  const timerEl = document.getElementById("auctionTimer");
  if (timerEl) {
    timerEl.innerText = "0";
    timerEl.classList.add("timer-danger");
  }
  speakText("Time is up.");
});

socket.off("sale_finalized");
socket.on("sale_finalized", (data) => {
  globalTeams = data.updatedTeams;
  const pIndex = auctionQueue.findIndex((p) => p.name === data.soldPlayer.name);
  if (pIndex > -1) {
    auctionQueue[pIndex].status = data.isUnsold ? "UNSOLD" : "SOLD";
    auctionQueue[pIndex].soldPrice = data.price;
  }

  const overlay = document.getElementById("saleOverlay");
  const stamp = document.getElementById("finalStamp");

  document.getElementById("soldPlayerName").innerText = data.soldPlayer.name;
  document.getElementById("soldPlayerRole").innerText =
    data.soldPlayer.roleKey.toUpperCase();
  document.getElementById("soldPlayerImg").src = data.soldPlayer.img || "";

  if (!data.isUnsold) {
    logEvent(
      `<strong>SOLD:</strong> ${data.soldPlayer.name} to ${data.soldDetails.soldTeam}`,
      true,
    );
    document.getElementById("soldToSection").style.display = "block";
    document.getElementById("soldPriceSection").style.display = "block";
    document.getElementById("soldTeamName").innerText =
      data.soldDetails.soldTeam;
    document.getElementById("soldFinalPrice").innerText = formatAmount(
      data.price,
    );
    stamp.innerText = "SOLD";
    stamp.className = "stamp-overlay";

    playHammerSound();
    const priceInCrores = (data.price / 10000000).toFixed(2);
    speakText(
      `${data.soldPlayer.name}. Sold to ${data.soldDetails.soldTeam} for ${priceInCrores} crore rupees.`,
    );
  } else {
    logEvent(`<strong>UNSOLD:</strong> ${data.soldPlayer.name}`, true);
    document.getElementById("soldToSection").style.display = "none";
    document.getElementById("soldPriceSection").style.display = "none";
    stamp.innerText = "UNSOLD";
    stamp.className = "stamp-overlay unsold-stamp";

    playHammerSound();
    speakText(`${data.soldPlayer.name}. Unsold.`);
  }
  updateTeamSidebar(globalTeams);
  overlay.classList.add("overlay-active");

  setTimeout(() => {
    overlay.classList.remove("overlay-active");
  }, 3500);
});

window.setBidAmount = function (amount) {
  const input = document.getElementById("customBidInput");
  if (input) {
    input.value = amount;
  }
};

function setupBidControls(p) {
  const quickArea = document.getElementById("quickBidArea");
  if (!quickArea) return;

  const isDomestic = p && p.playerType === "Uncapped";

  let html = "";
  if (isDomestic) {
    // Domestic: Only Lakhs
    [20, 30, 50, 70, 90].forEach((v) => {
      html += `<div class="quick-bid-chip lakh" onclick="setBidAmount(${v * 100000})">${v} L</div>`;
    });
  } else {
    // Normal: Only Crores
    [2, 3, 5, 7, 10, 15, 20].forEach((v) => {
      html += `<div class="quick-bid-chip crore" onclick="setBidAmount(${v * 10000000})">${v} CR</div>`;
    });
  }

  quickArea.innerHTML = html;

  // Add event listener for Enter key on the input
  const input = document.getElementById("customBidInput");
  if (input) {
    input.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        submitBlindBid();
      }
    });
    // Clear value for new player
    input.value = "";
    input.focus();
  }

  // Handle Admin Controls visibility
  const adminHeader = document.getElementById("adminHeaderControls");
  const adminFooter = document.getElementById("adminFooterControls");

  if (isAdmin) {
    if (adminHeader) {
      adminHeader.classList.remove("d-none");
      adminHeader.classList.add("d-flex");
    }
    if (adminFooter) {
      adminFooter.classList.remove("d-none");
      adminFooter.classList.add("d-flex");
    }
  } else {
    if (adminHeader) {
      adminHeader.classList.remove("d-flex");
      adminHeader.classList.add("d-none"); // Header might need d-none if not admin
    }
    if (adminFooter) {
      adminFooter.classList.remove("d-flex");
      adminFooter.classList.add("d-none");
    }
  }

  // Place bid button listener - safe with null checks
  const placeBidBtn = document.getElementById("placeBidBtn");
  const passBidBtn = document.getElementById("passBidBtn");

  if (placeBidBtn) placeBidBtn.onclick = submitBlindBid;
  if (passBidBtn) passBidBtn.onclick = submitBlindPass;

  // Enable buttons for new player
  disableBidControls(false);
}

function updateTeamSidebar(teams) {
  const container = document.getElementById("teams");
  const isMobile = window.innerWidth <= 768;

  if (container.children.length !== teams.length) {
    container.innerHTML = "";
    teams.forEach((t) => {
      const isMine = mySelectedTeamKey === t.bidKey;
      const card = document.createElement("div");
      card.id = `team-card-${t.bidKey}`;
      card.className = "franchise-card";
      if (isMine) card.classList.add("my-team");

      // Display player name if available
      const playerNameDisplay = t.playerName
        ? `<div style="font-size: 0.65rem; color: #888; margin-top: 2px;">${t.playerName}</div>`
        : "";

      const clickAction = (!isMine && !t.isTaken && !mySelectedTeamKey) 
        ? `onclick="claimLobbyTeam('${t.bidKey}')" style="cursor: pointer;"` 
        : "";

      card.innerHTML = `
                <div class="f-header" ${clickAction}>
                    <div class="f-name text-white text-truncate" style="max-width: 120px;">
                        ${t.name} ${
                          isMine
                            ? '<i class="bi bi-person-fill text-success"></i>'
                            : ""
                        }
                        ${playerNameDisplay}
                        ${(!isMine && !t.isTaken && !mySelectedTeamKey) ? '<br><span class="badge bg-success" style="font-size:0.5rem">JOIN FREE TEAM</span>' : ''}
                    </div>
                    <div class="f-budget">${formatAmount(t.budget)}</div> 
                </div>
                <div class="mobile-squad-info" style="display: ${
                  isMobile ? "block" : "none"
                }; font-size: 0.7rem; color: #aaa; margin-top: 4px;">
                    SQUAD: <span class="sq-count">0</span>/25
                    <div class="mobile-progress-bar" style="height: 4px; background: #333; margin-top: 2px; border-radius: 2px;">
                        <div class="sq-progress" style="width: 0%; height: 100%; background: #00E676;"></div>
                    </div>
                </div>
                <div class="f-stats-grid" style="display: flex; justify-content: space-between; margin-top: 5px; font-size: 0.7rem; color: #888;">
                    <div class="f-stat-item"><div class="f-stat-label">Ply</div><div class="f-stat-value sq-val">0</div></div>
                    <div class="f-stat-item"><div class="f-stat-label">Frgn</div><div class="f-stat-value frgn-val">0</div></div>
                    <div class="f-stat-item"><div class="f-stat-label">RTM</div><div class="f-stat-value rtm-val">0</div></div>
                </div>
            `;
      container.appendChild(card);
    });
  }

  teams.forEach((t) => {
    const card = document.getElementById(`team-card-${t.bidKey}`);
    if (!card) return;
    const isHighest = currentHighestBidderKey === t.bidKey;
    if (isHighest) card.classList.add("active-bidder");
    else card.classList.remove("active-bidder");
    const squadCount = t.roster ? t.roster.length : 0;
    const foreignCount = t.roster
      ? t.roster.filter((p) => p.playerType === "Foreign").length
      : 0;
    const rtmCount = t.rtmsUsed || 0;
    card.querySelector(".f-budget").innerText = formatAmount(t.budget);
    const sqCountEl = card.querySelector(".sq-count");
    if (sqCountEl) sqCountEl.innerText = squadCount;
    const sqProgEl = card.querySelector(".sq-progress");
    if (sqProgEl) sqProgEl.style.width = `${(squadCount / 25) * 100}%`;
    card.querySelector(".sq-val").innerText = squadCount;
    card.querySelector(".frgn-val").innerText = foreignCount;
    card.querySelector(".rtm-val").innerText = rtmCount;
  });
}

document.getElementById("soldBtn").addEventListener("click", () => {
  if (!isAdmin || saleProcessing) return;
  if (!currentHighestBidderKey) return alert("No active bidder!");
  saleProcessing = true;
  let price = parsePrice(document.getElementById("pBid").innerText);
  socket.emit("finalize_sale", {
    isUnsold: false,
    soldTo: { bidKey: currentHighestBidderKey },
    price: price,
  });
});

document.getElementById("skipBtn").addEventListener("click", () => {
  if (!isAdmin || saleProcessing) return;
  saleProcessing = true;
  socket.emit("finalize_sale", { isUnsold: true });
});

const timerToggleBtn = document.getElementById("timerToggleBtn");
if (timerToggleBtn) {
  timerToggleBtn.addEventListener("click", () => {
    console.log("Timer toggle clicked. Is Admin:", isAdmin);
    if (isAdmin) {
      socket.emit("toggle_timer");
    } else {
      console.warn("Ignored toggle timer: User is not admin");
    }
  });
}

// Safely attach endAuctionBtn listener
function attachEndAuctionListener() {
  const btn = document.getElementById("endAuctionBtn");
  if (!btn) {
    setTimeout(attachEndAuctionListener, 300);
    return;
  }

  if (btn.dataset.listenerAttached) return;
  btn.dataset.listenerAttached = "true";

  btn.addEventListener("click", () => {
    if (!isAdmin) {
      alert("Only the host can end the auction.");
      return;
    }

    if (
      confirm(
        "Are you sure you want to end the auction? This cannot be undone.",
      )
    ) {
      // Disable button to prevent double-click
      btn.disabled = true;
      btn.innerHTML = 'ENDING... <i class="bi bi-hourglass-end"></i>';
      socket.emit("end_auction_trigger");
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", attachEndAuctionListener);
} else {
  setTimeout(attachEndAuctionListener, 100);
}

function updatePauseButtonState(isPaused) {
  const btn = document.getElementById("timerToggleBtn");
  btn.innerHTML = isPaused
    ? '<i class="bi bi-play-fill"></i>'
    : '<i class="bi bi-pause-fill"></i>';
  btn.className = isPaused
    ? "btn-custom btn-action text-success border-success"
    : "btn-custom btn-action text-warning border-warning";
}

let mySelectedSquad = [];
let myBattingImpact = null;
let myBowlingImpact = null;
let mySelectedCaptain = null;

// --- OPEN SQUAD SELECTION ---
socket.off("open_squad_selection");
socket.on("open_squad_selection", (data) => {
  console.log("📢 SQUAD SELECTION OPENED", data);

  if (data && data.teams) {
    globalTeams = data.teams;

    // Auto-recover mySelectedTeamKey if lost/mismatch
    const myTeam = globalTeams.find(
      (t) =>
        t.ownerPlayerId === myPersistentId || t.ownerSocketId === socket.id,
    );
    if (myTeam) {
      mySelectedTeamKey = myTeam.bidKey;
      console.log("✅ Recovered Team Key:", mySelectedTeamKey);
    }
  }

  document
    .getElementById("squadSelectionScreen")
    .classList.add("overlay-active");

  renderMySquadSelection();
  speakText(
    "The auction has ended. All teams, please select your playing eleven and impact players.",
  );
});

function countForeigners(list) {
  return list.filter((p) => p.playerType === "Foreign").length;
}
function countKeepers(list) {
  // FIXED: Strict check as requested
  return list.filter((p) => p.roleKey && p.roleKey.toLowerCase() === "wk")
    .length;
}

// --- GLOBAL HELPERS (Moved from socket handlers) ---
function normalizeTeamStats(team) {
  return {
    p: team.stats?.played ?? 0,
    w: team.stats?.won ?? 0,
    l: team.stats?.lost ?? 0,
    pts: team.stats?.pts ?? 0,
    nrr: team.stats?.nrr?.toFixed?.(3) ?? "0.000",
    name: team.name,
  };
}

function clampT20Score(scoreStr) {
  if (!scoreStr) return "0/0";
  const [runs, wkts = "0"] = scoreStr.toString().split("/");
  const cappedRuns = Math.min(parseInt(runs) || 0, 280); // Increased cap lightly
  return `${cappedRuns}/${wkts}`;
}

function formatOver(balls) {
  if (!balls) return "0.0";
  const o = Math.floor(balls / 6);
  const b = balls % 6;
  return `${o}.${b}`;
}

function renderMySquadSelection() {
  const myTeam = globalTeams.find((t) => t.bidKey === mySelectedTeamKey);
  const list = document.getElementById("playing11List");
  const impList = document.getElementById("impactList");
  list.innerHTML =
    '<small class="text-warning d-block mb-2 text-center" style="font-size:0.75rem;">Select 12 Players (Batting Order Priority)</small>';
  impList.innerHTML =
    '<small class="text-warning d-block mb-2 text-center" style="font-size:0.75rem;">Assign Roles (Bat Impact & Bowl Impact)</small>';

  if (!myTeam || !myTeam.roster || myTeam.roster.length === 0)
    return (list.innerHTML =
      "<div class='text-white-50 text-center mt-5'>No players bought!</div>");

  const sortedRoster = [...myTeam.roster].sort(
    (a, b) => getRolePriority(a.roleKey) - getRolePriority(b.roleKey),
  );

  sortedRoster.forEach((p, i) => {
    const originalIndex = myTeam.roster.indexOf(p);
    const isForeign = p.playerType === "Foreign";
    const badge = isForeign
      ? '<span class="badge bg-danger ms-2" style="font-size:0.6rem">✈️</span>'
      : "";
    const roleIcon = getRoleIcon(p.roleKey);
    const isSelected = mySelectedSquad.find((x) => x.name === p.name);
    const isCapt = mySelectedCaptain === p.name;
    const num = isSelected ? mySelectedSquad.indexOf(isSelected) + 1 : "";

    const captainBtn = isSelected
      ? `<button class="btn btn-sm ${
          isCapt ? "btn-warning" : "btn-outline-secondary"
        } ms-2 rounded-circle" style="width:30px;height:30px;padding:0;" onclick="event.stopPropagation(); setCaptain('${
          p.name
        }')">C</button>`
      : "";

    list.innerHTML += `<div class="player-check-card p11-card" id="p11-${originalIndex}" onclick="toggleSquadMember(${originalIndex}, '${p.name}')"><span class="squad-number">${num}</span><div class="fw-bold text-white flex-grow-1">${p.name} <span class="role-icon">${roleIcon}</span> ${badge}</div>${captainBtn}</div>`;
  });

  // Render Role Selection (Only from Selected Squad)
  mySelectedSquad.forEach((p, i) => {
    const isBatImp = myBattingImpact && myBattingImpact.name === p.name;
    const isBowlImp = myBowlingImpact && myBowlingImpact.name === p.name;
    const roleIcon = getRoleIcon(p.roleKey);

    impList.innerHTML += `
      <div class="player-check-card impact-card d-flex gap-2 align-items-center p-1" style="cursor:default;">
         <div class="fw-bold text-white small flex-grow-1 text-truncate">${p.name}</div>
         <button class="btn btn-xs ${isBatImp ? "btn-danger" : "btn-outline-danger"} small-impact-btn" onclick="setBatImpact('${p.name}')">BAT IMP</button>
         <button class="btn btn-xs ${isBowlImp ? "btn-primary" : "btn-outline-primary"} small-impact-btn" onclick="setBowlImpact('${p.name}')">BOWL IMP</button>
      </div>`;
  });

  updateSquadUI();
}

function toggleSquadMember(i, name) {
  const team = globalTeams.find((t) => t.bidKey === mySelectedTeamKey);
  const p = team.roster.find((x) => x.name === name);

  if (!p) return;

  const idx = mySelectedSquad.findIndex((x) => x.name === name);
  if (idx > -1) {
    // Remove
    mySelectedSquad.splice(idx, 1);
    // Clear roles if removed
    if (mySelectedCaptain === name) mySelectedCaptain = null;
    if (myBattingImpact && myBattingImpact.name === name)
      myBattingImpact = null;
    if (myBowlingImpact && myBowlingImpact.name === name)
      myBowlingImpact = null;
  } else {
    // Add
    if (mySelectedSquad.length >= 12)
      return alert("Max 12 Players (11 + Impact Pair)");
    const currentForeignCount = countForeigners(mySelectedSquad);
    if (p.playerType === "Foreign" && currentForeignCount >= 4)
      return alert("MAX 4 FOREIGN PLAYERS ALLOWED IN SQUAD!");
    mySelectedSquad.push(p);
  }
  renderMySquadSelection();
}

function setBatImpact(name) {
  const p = mySelectedSquad.find((x) => x.name === name);
  if (myBowlingImpact && myBowlingImpact.name === name) {
    myBowlingImpact = null; // Swap roles if clicking same
  }
  myBattingImpact = myBattingImpact && myBattingImpact.name === name ? null : p;
  renderMySquadSelection();
}

function setBowlImpact(name) {
  const p = mySelectedSquad.find((x) => x.name === name);
  if (myBattingImpact && myBattingImpact.name === name) {
    myBattingImpact = null;
  }
  myBowlingImpact = myBowlingImpact && myBowlingImpact.name === name ? null : p;
  renderMySquadSelection();
}

function setCaptain(name) {
  mySelectedCaptain = name;
  renderMySquadSelection();
}

function updateSquadUI() {
  document.querySelectorAll(".p11-card").forEach((e) => {
    if (e.querySelector(".squad-number").innerText !== "")
      e.classList.add("checked");
    else e.classList.remove("checked");
  });

  const fCount = countForeigners(mySelectedSquad);
  const fColor = fCount > 4 ? "text-danger" : "text-white-50";
  const wkCount = countKeepers(mySelectedSquad);
  const wkColor = wkCount < 1 ? "text-danger" : "text-white-50";

  document.getElementById("p11Count").innerText =
    `${mySelectedSquad.length}/12 Selected`;
  document.getElementById("foreignCountDisplay").innerHTML =
    `<span class="${fColor}">Foreign: ${fCount}/4</span>`;
  document.getElementById("wkCountDisplay").innerHTML =
    `<span class="${wkColor}">WK: ${wkCount}/1</span>`;

  // Impact Count Display Update
  const impactReady = myBattingImpact && myBowlingImpact;
  document.getElementById("impactCount").innerHTML = impactReady
    ? "<span class='text-success'>Roles Set</span>"
    : "<span class='text-danger'>Select Batsman & Bowler Impact</span>";

  const isValid =
    mySelectedSquad.length === 12 &&
    myBattingImpact &&
    myBowlingImpact &&
    mySelectedCaptain;
  document.getElementById("submitSquadBtn").disabled = !isValid;
}

// Safely attach submitSquadBtn listener
function attachSubmitSquadListener() {
  const btn = document.getElementById("submitSquadBtn");
  if (!btn) {
    setTimeout(attachSubmitSquadListener, 300);
    return;
  }

  if (btn.dataset.listenerAttached) return;
  btn.dataset.listenerAttached = "true";

  btn.addEventListener("click", () => {
    // Ensure removal of old listener if any (though usually one-shot)
    socket.emit("submit_squad", {
      teamKey: mySelectedTeamKey,
      squad: mySelectedSquad,
      batImpact: myBattingImpact,
      bowlImpact: myBowlingImpact,
      captain: mySelectedCaptain,
    });

    document.getElementById("submitSquadBtn").innerHTML =
      "SUBMITTED <i class='bi bi-check'></i>";
    document.getElementById("submitSquadBtn").disabled = true;
    const waitMsg = document.getElementById("waitingMsg");
    waitMsg.classList.remove("d-none");
    if (isAdmin) {
      clearTimeout(squadSubmitTimeout);
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", attachSubmitSquadListener);
} else {
  setTimeout(attachSubmitSquadListener, 100);
}

// FIXED: Emit the exact event name the server expects to START the tournament
function forceRunSim() {
  socket.emit("startTournament", { teams: globalTeams });
}

socket.off("squad_submission_update");
socket.on("squad_submission_update", (d) => {
  const msgEl = document.getElementById("waitingMsg");
  msgEl.innerHTML = `WAITING... (${d.submittedCount}/${d.totalTeams} SUBMITTED)`;

  if (isAdmin) {
    // Check if button already exists to prevent duplicates
    if (!document.getElementById("forceStartBtn")) {
      const btn = document.createElement("button");
      btn.id = "forceStartBtn";
      btn.className = "btn btn-sm btn-outline-warning mt-2 d-block mx-auto";
      btn.innerText = "FORCE START SIMULATION (AI FILL)";
      btn.onclick = forceRunSim;
      msgEl.appendChild(btn);
    }
  }
});

socket.off("simulation_error");
socket.on("simulation_error", (msg) => {
  alert("SIMULATION FAILED: " + msg);
  document.getElementById("waitingMsg").innerText = "ERROR: " + msg;
});

// FIXED: Listen for "tournamentComplete" to match Server
socket.off("tournamentComplete");
socket.on("tournamentComplete", (results) => {
  if (!results.orangeCap)
    results.orangeCap = { name: "Simulated", runs: "N/A" };
  if (!results.purpleCap)
    results.purpleCap = { name: "Simulated", wkts: "N/A" };
  if (!results.mvp) results.mvp = { name: "Simulated", pts: "N/A" };
  if (!results.leagueMatches) results.leagueMatches = [];
  if (!results.playoffs) results.playoffs = [];

  if (results.standings && !Array.isArray(results.standings)) {
    const arr = [];
    Object.keys(results.standings).forEach((key) => {
      arr.push({
        name: key,
        stats: {
          p: results.standings[key].played,
          w: results.standings[key].won,
          l: results.standings[key].played - results.standings[key].won,
          nrr: 0,
          pts: results.standings[key].points,
        },
      });
    });
    results.standings = arr.sort((a, b) => b.stats.pts - a.stats.pts);
  }

  // Save results to session storage for play.html to pick up
  sessionStorage.setItem("IPL_RESULTS", JSON.stringify(results));
  sessionStorage.setItem("currentRoomId", myRoomId);

  // Redirect to play.html
  window.location.href = `play.html?room=${myRoomId}`;
});

// --- MATCH FILTER LOGIC ---
window.filterMatchLogs = function (teamName) {
  const mLog = document.getElementById("matchLogContainer");
  mLog.innerHTML = "";

  if (!lastTournamentData || !lastTournamentData.leagueMatches) return;

  const allMatches = lastTournamentData.leagueMatches;
  const filtered =
    teamName === "ALL"
      ? allMatches
      : allMatches.filter((m) => m.t1 === teamName || m.t2 === teamName);

  if (filtered.length > 0) {
    filtered.forEach(
      (m, i) => (mLog.innerHTML += createMatchCard(m, false, i)),
    );
  } else {
    mLog.innerHTML =
      "<div class='text-center text-white-50 p-4'>No matches found for " +
      teamName +
      "</div>";
  }
};

function renderAllTeams(teamsData) {
  const container = document.getElementById("allTeamsContainer");
  container.innerHTML = "";
  const dataToRender = teamsData || globalTeams;

  dataToRender.forEach((team) => {
    let p11Html = "",
      benchHtml = "";
    const playingList = team.playing11 || [];
    const playingNames = playingList.map((p) => p.name);

    playingList.forEach((p) => {
      const icon = getRoleIcon(p.roleKey || "bat");
      const isCapt =
        team.captain === p.name ? '<span class="captain-badge">C</span>' : "";
      p11Html += `<div class="team-player-row" style="border-left: 3px solid #00E676; padding-left:8px;"><span class="text-white">${icon} ${
        p.name
      } ${isCapt}</span><span class="text-white-50">${formatAmount(
        p.price || 0,
      )}</span></div>`;
    });

    const fullRoster = team.roster || [];
    fullRoster.forEach((p) => {
      if (!playingNames.includes(p.name)) {
        const icon = getRoleIcon(p.roleKey || "bat");
        benchHtml += `<div class="team-player-row" style="opacity:0.5;"><span class="text-white">${icon} ${
          p.name
        } (Bench)</span><span class="text-white-50">${formatAmount(
          p.price || 0,
        )}</span></div>`;
      }
    });

    container.innerHTML += `<div class="team-squad-box"><div class="team-squad-header"><span>${
      team.name
    }</span><span class="fs-6 text-white-50">${
      playingNames.length
    } Played</span></div><div class="mb-2"><small class="text-success">PLAYING XI (Batting Order)</small>${p11Html}</div>${
      benchHtml
        ? `<div><small class="text-muted">BENCH</small>${benchHtml}</div>`
        : ""
    }</div>`;
  });
}

// --- MATCH CARD CREATOR ---
function createMatchCard(m, isPlayoff = false, index) {
  const topScorerName = m.topScorer ? m.topScorer.name : "-";
  const topScorerRuns = m.topScorer ? m.topScorer.runs : "0";
  const bestBowlerName = m.bestBowler ? m.bestBowler.name : "-";
  const bestBowlerFigs = m.bestBowler ? m.bestBowler.figures : "0-0";
  const momName = m.topScorer ? m.topScorer.name : m.winnerName || "-";

  let footerHtml = `<div class="d-flex justify-content-between w-100 px-2"><div class="perf-item"><span class="role-badge role-bat me-2">BAT</span> <span class="text-white">${topScorerName} <span class="text-warning">(${topScorerRuns})</span></span></div><div class="perf-item"><span class="role-badge role-bowl me-2">BOWL</span> <span class="text-white">${bestBowlerName} <span class="text-info">(${bestBowlerFigs})</span></span></div></div>`;

  // ADDED: Click handler to open scorecard
  const clickFn = `onclick="openScorecard('${
    isPlayoff ? "playoff" : "league"
  }', ${index})"`;

  return `<div class="match-card ${
    isPlayoff ? "playoff" : ""
  }" ${clickFn} style="cursor: pointer;"><div class="match-header"><div class="match-type-label">${m.type.toUpperCase()}</div><div class="mom-star"><i class="bi bi-star-fill"></i> ${momName}</div></div><div class="match-content"><div class="team-score-box"><div class="ts-name">${
    m.t1
  }</div><div class="ts-score">${
    clampT20Score(m.score1).split("/")[0]
  }<span class="fs-6 text-white-50">/${
    m.score1.split("/")[1]
  }</span></div></div><div class="vs-tag">VS</div><div class="team-score-box"><div class="ts-name">${
    m.t2
  }</div><div class="ts-score">${
    clampT20Score(m.score2).split("/")[0]
  }<span class="fs-6 text-white-50">/${
    m.score2.split("/")[1]
  }</span></div></div></div><div class="win-status">${m.winnerName} won by ${
    m.margin
  }</div><div class="match-footer" style="flex-direction:column; align-items:stretch;">${footerHtml}</div></div>`;
}

// --- OPEN SCORECARD (DETAILED) ---
function openScorecard(type, index) {
  if (!lastTournamentData) return;

  // 1. Fetch Data
  const matchData =
    type === "league"
      ? lastTournamentData.leagueMatches[index]
      : lastTournamentData.playoffs[index];

  if (!matchData) {
    console.error("Match data not found for", type, index);
    return;
  }

  // 2. Delegate to the global UI renderer (defined in play.html)
  if (typeof window.showScorecard === "function") {
    window.showScorecard(matchData);
  } else {
    console.error("showScorecard function not found!");
    alert("Error: Scorecard viewer not loaded.");
  }
}

function renderPlayerPool() {
  const a = document.getElementById("availableList"),
    s = document.getElementById("soldList"),
    u = document.getElementById("unsoldList");
  a.innerHTML = "";
  s.innerHTML = "";
  u.innerHTML = "";
  auctionQueue.forEach((p) => {
    const card = `<div class="col-md-6"><div class="player-list-card" style="background:rgba(255,255,255,0.05);border:1px solid #333;padding:10px;border-radius:6px;display:flex;gap:10px;"><div class="p-list-img" style="width:50px;height:50px;border-radius:50%;background-size:cover;${
      p.img ? `background-image:url('${p.img}')` : "background-color:#333"
    }"></div><div><div class="fw-bold text-white">${
      p.name
    }</div><div class="text-white-50 small">${p.category} [${p.set}]</div>${
      p.status === "SOLD"
        ? `<div class="text-success small">Sold: ${formatAmount(
            p.soldPrice,
          )}</div>`
        : ""
    }</div></div></div>`;
    if (p.status === "SOLD") s.innerHTML += card;
    else if (p.status === "UNSOLD") u.innerHTML += card;
    else a.innerHTML += card;
  });
}

function renderSquads() {
  const mb = document.getElementById("teamStatusOverview");
  if (!mb) return;
  mb.innerHTML = "";

  // Filter teams that have players
  const teamsWithPlayers = globalTeams.filter(
    (t) => t.roster && t.roster.length > 0,
  );

  if (teamsWithPlayers.length === 0) {
    mb.innerHTML = `<div class="text-center p-5 text-white-50 fs-4">
      <i class="bi bi-info-circle mb-3 d-block fs-1"></i>
      No players have been bought yet.
    </div>`;
    return;
  }

  teamsWithPlayers.forEach((t) => {
    const isMine = mySelectedTeamKey === t.bidKey;
    let h =
      '<div class="table-responsive"><table class="table table-dark table-sm table-bordered mb-0"><thead><tr><th>Player</th><th>Price</th></tr></thead><tbody>';

    t.roster.forEach(
      (p) =>
        (h += `<tr><td>${p.name}</td><td>${formatAmount(p.price)}</td></tr>`),
    );
    h += "</tbody></table></div>";

    // Show claimant name if available
    const claimantInfo = t.playerName
      ? `<span class="badge bg-secondary ms-2 fw-normal" style="font-size: 0.75rem;">OWNER: ${t.playerName}</span>`
      : "";
    const myBadge = isMine
      ? `<span class="badge bg-warning text-dark ms-2">YOUR TEAM</span>`
      : "";

    mb.innerHTML += `
      <div class="card bg-black border-secondary mb-3 ${isMine ? "border-warning" : ""}" style="box-shadow: ${isMine ? "0 0 15px rgba(255, 193, 7, 0.2)" : "none"};">
        <div class="card-header white border-secondary d-flex justify-content-between align-items-center bg-dark bg-opacity-50">
          <div>
            <span class="text-warning fw-bold fs-5">${t.name}</span>
            ${claimantInfo}
            ${myBadge}
          </div>
          <span class="text-white fw-bold">Spent: ${formatAmount(t.totalSpent)}</span>
        </div>
        <div class="card-body p-0">${h}</div>
      </div>`;
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const introContainer = document.querySelector(".shake-container");
  if (introContainer) introContainer.style.display = "none";
  const lobby = document.getElementById("lobbyScreen");
  if (
    lobby &&
    document.getElementById("gameContainer").style.display === "none"
  ) {
    lobby.style.display = "flex";
  }

  // Pre-fill player name if stored
  if (myPlayerName) {
    const createNameInput = document.getElementById("createPlayerName");
    const joinNameInput = document.getElementById("joinPlayerName");
    if (createNameInput) createNameInput.value = myPlayerName;
    if (joinNameInput) joinNameInput.value = myPlayerName;
  }

  if (
    localStorage.getItem("ipl_last_room") &&
    localStorage.getItem("ipl_last_pass")
  ) {
    const r = localStorage.getItem("ipl_last_room");
    const p = localStorage.getItem("ipl_last_pass");
    document.getElementById("joinRoomId").value = r;
    document.getElementById("joinPass").value = p;
  }
});

/* =========================================
   AUTO TEST FEATURE (SKIP AUCTION)
   ========================================= */

const AUTO_RCB_NAMES = [
  "Virat Kohli",
  "Faf du Plessis",
  "Rajat Patidar",
  "Suyash Prabhudessai",
  "Dinesh Karthik",
  "Anuj Rawat",
  "Glenn Maxwell",
  "Will Jacks",
  "Cameron Green",
  "Mahipal Lomror",
  "Mohammed Siraj",
  "Reece Topley",
  "Akash Deep",
];
const AUTO_CSK_NAMES = [
  "Ruturaj Gaikwad",
  "Devon Conway",
  "Ajinkya Rahane",
  "Sameer Rizvi",
  "MS Dhoni",
  "Ravindra Jadeja",
  "Moeen Ali",
  "Shivam Dube",
  "Rachin Ravindra",
  "Matheesha Pathirana",
  "Maheesh Theekshana",
  "Tushar Deshpande",
];

function getPlayerForTest(name) {
  const db = PLAYER_DATABASE[name] || {
    bat: 75,
    bowl: 75,
    luck: 75,
    type: "bat",
  }; // fallback stats

  let region = "Indian";
  let roleKey = db.type || "bat";

  // Determine Region (Foreign/Indian) from RAW_DATA
  for (const cat in RAW_DATA) {
    if (RAW_DATA[cat].foreign && RAW_DATA[cat].foreign.includes(name))
      region = "Foreign";
    if (RAW_DATA[cat].indian && RAW_DATA[cat].indian.includes(name))
      region = "Indian";

    // Also check if role matches category loose check
    if (
      (RAW_DATA[cat].foreign && RAW_DATA[cat].foreign.includes(name)) ||
      (RAW_DATA[cat].indian && RAW_DATA[cat].indian.includes(name))
    ) {
      if (cat.toLowerCase().includes("keep")) roleKey = "wk";
      else if (cat.toLowerCase().includes("round")) roleKey = "ar";
      else if (cat.toLowerCase().includes("bowl")) roleKey = "bowl";
      else roleKey = "bat";
    }
  }

  // Override roleKey from DB if explicit
  if (db.type) roleKey = db.type;

  return {
    name: name,
    price: 10000000, // Dummy price
    roleKey: roleKey,
    playerType: region,
    stats: db,
    cat: roleKey.toUpperCase(),
    set: 1,
  };
}

document.getElementById("autoTestBtn")?.addEventListener("click", () => {
  if (!isAdmin) {
    alert("Only Host can run auto test.");
    return;
  }

  if (
    !confirm(
      "⚠️ FORCE SKIP to Squad Selection with Auto-Filled Teams?\n(This skips the auction completely)",
    )
  )
    return;

  const rcbRoster = AUTO_RCB_NAMES.map((name) => getPlayerForTest(name));
  const cskRoster = AUTO_CSK_NAMES.map((name) => getPlayerForTest(name));

  socket.emit("admin_auto_test", { rcb: rcbRoster, csk: cskRoster });
});
window.formatOver = formatOver;

// ======================================================
// 💬 LIVE CHAT SYSTEM
// ======================================================

// Send Chat Message
function sendChatMessage() {
  const input = document.getElementById("chatInput");
  const message = input.value.trim();

  if (!message) return;
  if (!myPlayerName) {
    // Alert user to enter name first
    alert("Please enter your name first before chatting!");
    const nameSection = document.getElementById("nameEntrySection");
    if (nameSection) {
      nameSection.style.display = "block";
      const nameInput = document.getElementById("lobbyPlayerName");
      if (nameInput) nameInput.focus();
    }
    input.value = "";
    return;
  }

  // Emit chat message to server
  socket.emit("chat_message", {
    playerName: myPlayerName,
    message: message,
    timestamp: Date.now(),
  });

  // Clear input
  input.value = "";
}

// Receive Chat Message
socket.off("chat_message");
socket.on("chat_message", (data) => {
  const chatContainer = document.getElementById("chatMessages");
  if (!chatContainer) return;

  // Create message element
  const messageDiv = document.createElement("div");
  messageDiv.className = "chat-message";

  messageDiv.innerHTML = `
    <div class="chat-name">${escapeHtml(data.playerName)}:</div>
    <div class="chat-text">${escapeHtml(data.message)}</div>
  `;

  chatContainer.appendChild(messageDiv);

  // Auto-scroll to bottom
  chatContainer.scrollTop = chatContainer.scrollHeight;
});

// Send button click
document.addEventListener("DOMContentLoaded", () => {
  const sendBtn = document.getElementById("sendChatBtn");
  const chatInput = document.getElementById("chatInput");

  if (sendBtn) {
    sendBtn.addEventListener("click", sendChatMessage);
  }

  if (chatInput) {
    // Send on Enter key
    chatInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }

  // Name Entry System
  const lobbyPlayerName = document.getElementById("lobbyPlayerName");

  if (lobbyPlayerName) {
    const submitName = () => {
      const name = lobbyPlayerName.value.trim();
      if (!name) {
        // Just return if empty, no alert
        return;
      }

      // Store name
      myPlayerName = name;
      localStorage.setItem("ipl_auction_player_name", name);

      // Hide name entry section
      document.getElementById("nameEntrySection").style.display = "none";

      // Send name to server
      socket.emit("update_player_name", { playerName: name });

      // Show success message
      logEvent(`✅ Welcome, ${name}!`, true);
    };

    // Enter key support
    lobbyPlayerName.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitName();
      }
    });
  }
});

// Show name entry section if no name is set
function checkAndShowNameEntry() {
  if (!myPlayerName) {
    const nameSection = document.getElementById("nameEntrySection");
    if (nameSection) {
      nameSection.style.display = "block";
    }
  }
}

// ======================================================
// 10. TRADE CENTER LOGIC
// ======================================================
let currentTradeRequests = [];
let currentTradeHistory = [];

socket.on("trade_update", (data) => {
  currentTradeRequests = data.requests || [];
  currentTradeHistory = data.history || [];

  // Refresh UI if modal is open
  const modal = document.getElementById("tradeCenterModal");
  if (modal && modal.classList.contains("show")) {
    // Re-render current tab
    const activeTab = document.querySelector("#tradeCenterModal .active").id;
    if (activeTab === "tabTradeCreate") renderTradeCreate();
    else if (activeTab === "tabTradeMarket") renderTradeMarket();
    else if (activeTab === "tabTradeMy") renderTradeMy();
    else if (activeTab === "tabTradeHistory") renderTradeHistory();
  }

  // Also re-check button visibility
  checkTradeEligibility();
});

window.checkTradeEligibility = function () {
  // Check globalTeams or state to see if all taken teams have >= 2 players
  // This is called from updateLobbyUI typically

  // We need robust access to teams. 'globalTeams' is updated in 'lobby_update'
  const activeTeams = globalTeams.filter((t) => t.isTaken);
  if (activeTeams.length < 2) return; // Need at least 2 teams to trade

  const allHaveTwo = activeTeams.every((t) => (t.totalPlayers || 0) >= 2);
  const btn = document.getElementById("btnTradeCenter");

  if (btn) {
    if (allHaveTwo) {
      btn.classList.remove("d-none");
    } else {
      btn.classList.add("d-none");
    }
  }
};

// Hook into lobby update to check eligibility
const originalUpdateLobbyUI =
  typeof updateLobbyUI === "function" ? updateLobbyUI : function () {};
updateLobbyUI = function (teams, userCount) {
  if (typeof originalUpdateLobbyUI === "function")
    originalUpdateLobbyUI(teams, userCount);
  globalTeams = teams; // Ensure global tracking
  checkTradeEligibility();

  // Refresh Squad Modal if Open
  const statusModal = document.getElementById("teamStatusModal");
  if (statusModal && statusModal.classList.contains("show")) {
    renderSquads();
  }
};

// --- TRADE HELPERS ---
function resetTradeState() {
  tradeState = {
    partnerTeamId: "",
    myOfferPlayers: new Set(),
    theirOfferPlayers: new Set(),
    payCash: 0,
    requestCash: 0,
    filter: "All",
  };
}

window.openTradeCenter = function () {
  socket.emit("get_trade_state");
  resetTradeState();
  switchTradeTab("create");
};

window.switchTradeTab = function (tab) {
  // Update Tabs
  document.querySelectorAll("#tradeCenterModal .nav-link").forEach((b) => {
    b.classList.remove("active");
  });

  const activeBtn = document.getElementById(
    tab === "create"
      ? "tabTradeCreate"
      : tab === "market"
        ? "tabTradeMarket"
        : tab === "my"
          ? "tabTradeMy"
          : tab === "money"
            ? "tabTradeMoney"
            : "tabTradeHistory",
  );

  if (activeBtn) {
    activeBtn.classList.add("active");
  }

  if (tab === "create") renderTradeCreate();
  else if (tab === "market") renderTradeMarket();
  else if (tab === "my") renderTradeMy();
  else if (tab === "money") renderTradeMoney();
  else if (tab === "history") renderTradeHistory();
};

// --- TRADE CENTER STATE ---
let tradeState = {
  partnerTeamId: "",
  myOfferPlayers: new Set(),
  theirOfferPlayers: new Set(),
  payCash: 0,
  requestCash: 0,
  filter: "All",
};

function renderTradeCreate() {
  const container = document.getElementById("tradeContentArea");
  const myTeam = globalTeams.find((t) => t.bidKey === window.mySelectedTeamKey);
  if (!myTeam) return (container.innerHTML = "Error: Team not found.");

  // Get potential partners (everyone except me)
  const partners = globalTeams.filter(
    (t) => t.bidKey !== window.mySelectedTeamKey && t.isTaken,
  );

  let html = `
    <div class="d-flex flex-column gap-3 h-100">
        <!-- 1. Header: Select Team & Filter -->
        <div class="row g-3">
            <div class="col-md-6">
                <label class="text-white-50 small mb-1">Select Team to Trade With:</label>
                <select id="tradePartnerSelect" class="trade-select" onchange="onTradePartnerChange(this.value)">
                    <option value="" disabled ${!tradeState.partnerTeamId ? "selected" : ""}>Choose a team...</option>
                    ${partners.map((p) => `<option value="${p.bidKey}" ${tradeState.partnerTeamId === p.bidKey ? "selected" : ""}>${p.name}</option>`).join("")}
                </select>
            </div>
            
            <div class="col-md-6">
                <label class="text-white-50 small mb-1">Select Category:</label>
                <div class="category-filters">
                    ${["All", "Batsman", "Wick", "All Rounder", "Spinner", "Fast Bowler"]
                      .map(
                        (cat) =>
                          `<div class="filter-chip ${tradeState.filter === cat ? "active" : ""}" onclick="setTradeFilter('${cat}')">
                            ${cat === "All" ? '<i class="bi bi-check2"></i>' : ""} ${cat}
                         </div>`,
                      )
                      .join("")}
                </div>
            </div>
        </div>

        <!-- 2. Main Lists Area -->
        <div class="row g-3 flex-grow-1">
            <!-- Left: MY PLAYERS -->
            <div class="col-md-5">
                <div class="trade-section-title">YOUR PLAYERS (OFFER)</div>
                <div class="trade-card-container" id="myTradeList">
                    ${renderPlayerListHTML(myTeam.roster, "mine")}
                </div>
            </div>

            <!-- Middle: Arrow -->
            <div class="col-md-2 d-flex justify-content-center align-items-center">
                <div class="center-arrow"><i class="bi bi-arrow-right"></i></div>
            </div>

            <!-- Right: TARGET PLAYERS -->
            <div class="col-md-5">
                <div class="trade-section-title">TARGET PLAYERS (REQUEST)</div>
                <div class="trade-card-container" id="theirTradeList">
                    ${tradeState.partnerTeamId ? renderTargetPlayerList() : '<div class="text-center text-white-50 mt-5">Select a team to view players</div>'}
                </div>
            </div>
        </div>

        <!-- Summary & Send (Cash/Msg removed as per request) -->
        <div class="mt-auto">
            <div class="trade-summary-box mt-3">
                <div class="summary-row">
                    <span>Selected (You):</span>
                    <span id="sumMyCount">0 Players</span>
                </div>
                <div class="summary-row">
                    <span>Selected (Them):</span>
                    <span id="sumTheirCount">0 Players</span>
                </div>
                <div class="summary-row summary-total">
                    <span>Net Value:</span>
                    <span id="sumNetVal">₹0 Cr</span>
                </div>
            </div>

            <button class="btn-trade-action mt-3" onclick="submitComplexTrade()">Send Trade Proposal</button>
        </div>
    </div>
  `;

  container.innerHTML = html;

  // Re-run calculations to update totals
  updateTradeTotals();
}

// --- NEW TRADE HELPERS ---

window.onTradePartnerChange = function (val) {
  tradeState.partnerTeamId = val;
  // Clear their selections when team changes
  tradeState.theirOfferPlayers.clear();
  // Re-render
  const theirList = document.getElementById("theirTradeList");
  if (theirList) theirList.innerHTML = renderTargetPlayerList();
  updateTradeTotals();
};

window.setTradeFilter = function (cat) {
  tradeState.filter = cat;
  renderTradeCreate(); // Full re-render to update chips and lists
};

window.updateTradeCash = function (type, val) {
  const num = parseFloat(val) || 0;
  if (type === "pay") tradeState.payCash = num;
  else tradeState.requestCash = num;
  updateTradeTotals();
};

function renderTargetPlayerList() {
  if (!tradeState.partnerTeamId) return "";
  const team = globalTeams.find((t) => t.bidKey === tradeState.partnerTeamId);
  if (!team) return '<div class="text-danger">Team not found</div>';
  return renderPlayerListHTML(team.roster || [], "theirs");
}

function renderPlayerListHTML(roster, side) {
  // Filter
  const filtered = roster.filter((p) => {
    if (tradeState.filter === "All") return true;

    // Map filter names to internal roles or types
    const role = (p.roleKey || "").toLowerCase();
    const cat = (p.category || "").toLowerCase();
    
    if (tradeState.filter === "Batsman" && (role.includes("bat") || role.includes("batter"))) return true;
    if (tradeState.filter === "Wick" && (role.includes("wk") || role.includes("wicket"))) return true;
    if (tradeState.filter === "Spinner" && (role.includes("spin") || cat.includes("spin"))) return true;
    if (tradeState.filter === "Fast Bowler" && (role.includes("fast") || role.includes("pace") || cat.includes("fast"))) return true;
    if (tradeState.filter === "All Rounder" && (role.includes("all") || role.includes("ar"))) return true;
    if (tradeState.filter === "Bowler" && (role.includes("bowl") || role.includes("pacer") || role.includes("spinner"))) return true;

    return false;
  });

  if (filtered.length === 0)
    return '<div class="text-white-50 small p-2">No players match filter</div>';

  return filtered
    .map((p) => {
      const isSelected =
        side === "mine"
          ? tradeState.myOfferPlayers.has(p.name)
          : tradeState.theirOfferPlayers.has(p.name);
      const nameEsc = p.name.replace(/'/g, "\\'");

      return `
        <div class="trade-player-card ${isSelected ? "selected" : ""}" onclick="toggleTradePlayer('${nameEsc}', '${side}')">
            <input type="checkbox" class="player-checkbox" ${isSelected ? "checked" : ""}>
            <div class="player-info">
                <div class="player-name">${p.name}</div>
                <div class="player-role text-white-50" style="font-size:0.7em">${p.roleKey ? p.roleKey.toUpperCase() : "PLAYER"}</div>
            </div>
            <div class="player-price">${formatAmount(p.price)}</div>
        </div>`;
    })
    .join("");
}

window.toggleTradePlayer = function (name, side) {
  const list =
    side === "mine" ? tradeState.myOfferPlayers : tradeState.theirOfferPlayers;
  if (list.has(name)) list.delete(name);
  else list.add(name);

  // Efficient Re-render of just the list container would be better, but full render is safer for sync
  const containerId = side === "mine" ? "myTradeList" : "theirTradeList";
  const team =
    side === "mine"
      ? globalTeams.find((t) => t.bidKey === window.mySelectedTeamKey)
      : globalTeams.find((t) => t.bidKey === tradeState.partnerTeamId);

  document.getElementById(containerId).innerHTML = renderPlayerListHTML(
    team.roster,
    side,
  );
  updateTradeTotals();
};

function updateTradeTotals() {
  // Calculate My Value
  const myTeam = globalTeams.find((t) => t.bidKey === window.mySelectedTeamKey);
  let myVal = 0;
  if (myTeam) {
    tradeState.myOfferPlayers.forEach((name) => {
      const p = myTeam.roster.find((x) => x.name === name);
      if (p) myVal += p.price;
    });
  }

  // Calculate Their Value
  let theirVal = 0;
  if (tradeState.partnerTeamId) {
    const theirTeam = globalTeams.find(
      (t) => t.bidKey === tradeState.partnerTeamId,
    );
    if (theirTeam) {
      tradeState.theirOfferPlayers.forEach((name) => {
        const p = theirTeam.roster.find((x) => x.name === name);
        if (p) theirVal += p.price;
      });
    }
  }

  // Add Cash (Cr input -> number)
  // IMPORTANT: Input is in Crores, price is in raw number
  const payRaw = (tradeState.payCash || 0) * 10000000;
  const reqRaw = (tradeState.requestCash || 0) * 10000000;

  // My Total Output Value = Players I give + Cash I pay
  const myTotalOut = myVal + payRaw;

  // Their Total Output Value (My Input) = Players I get + Cash I get
  const myTotalIn = theirVal + reqRaw;

  const net = myTotalIn - myTotalOut;

  const myCountEl = document.getElementById("sumMyCount");
  const theirCountEl = document.getElementById("sumTheirCount");
  if(myCountEl) myCountEl.innerText = `${tradeState.myOfferPlayers.size} Players`;
  if(theirCountEl) theirCountEl.innerText = `${tradeState.theirOfferPlayers.size} Players`;

  const netEl = document.getElementById("sumNetVal");
  if (netEl) {
    netEl.innerText = (net >= 0 ? "+" : "") + formatAmount(net);
    netEl.className = net >= 0 ? "text-success fw-bold" : "text-danger fw-bold";
  }
}

window.submitComplexTrade = function () {
  if (!tradeState.partnerTeamId) return alert("Select a team to trade with.");

  // Validation
  if (
    tradeState.myOfferPlayers.size === 0 &&
    tradeState.payCash === 0 &&
    tradeState.theirOfferPlayers.size === 0 &&
    tradeState.requestCash === 0
  ) {
    return alert("Trade cannot be empty.");
  }

  const payload = {
    targetTeamId: tradeState.partnerTeamId,
    offeredPlayerNames: Array.from(tradeState.myOfferPlayers),
    requestedPlayerNames: Array.from(tradeState.theirOfferPlayers),
    offeredCash: tradeState.payCash * 10000000,
    requestedCash: tradeState.requestCash * 10000000,
    message: (document.getElementById("tradeMsgInput")?.value) || "Direct Trade Request",
  };

  socket.emit("create_complex_trade", payload);

  // Reset and close or switch tab
  alert("Trade Proposal Sent!");
  switchTradeTab("my");

  // Reset state partially
  tradeState.myOfferPlayers.clear();
  tradeState.theirOfferPlayers.clear();
  tradeState.payCash = 0;
  tradeState.requestCash = 0;
};

function renderTradeMoney() {
  const container = document.getElementById("tradeContentArea");
  const partners = globalTeams.filter(
    (t) => t.bidKey !== window.mySelectedTeamKey && t.isTaken,
  );

  let html = `
    <div class="d-flex flex-column gap-3 h-100">
        <div class="d-flex justify-content-between align-items-center">
            <h4 class="text-warning display-font m-0"><i class="bi bi-cash-coin me-2"></i>MONEY TRADE</h4>
            <span class="badge bg-warning text-dark">NEW</span>
        </div>
        <p class="text-white-50 small mb-1">Buy or sell players for cash. Select a team and a player below.</p>

        <div class="row g-3">
            <div class="col-md-4">
                <label class="text-white-50 small mb-1">Trade Partner:</label>
                <select id="tradePartnerSelect" class="trade-select" onchange="onTradePartnerChange(this.value)">
                    <option value="" disabled ${!tradeState.partnerTeamId ? "selected" : ""}>Choose team...</option>
                    ${partners.map((p) => `<option value="${p.bidKey}" ${tradeState.partnerTeamId === p.bidKey ? "selected" : ""}>${p.name}</option>`).join("")}
                </select>
            </div>
            <div class="col-md-4">
                <label class="text-white-50 small mb-1">You Pay (Cr):</label>
                <input type="number" class="form-control trade-input" id="tradePayInput" 
                       value="${tradeState.payCash || ""}" placeholder="0" oninput="updateTradeCash('pay', this.value)">
            </div>
            <div class="col-md-4">
                <label class="text-white-50 small mb-1">You Request (Cr):</label>
                <input type="number" class="form-control trade-input" id="tradeRequestInput"
                       value="${tradeState.requestCash || ""}" placeholder="0" oninput="updateTradeCash('request', this.value)">
            </div>
        </div>

        <div class="row g-3 flex-grow-1">
            <div class="col-md-6 border-end border-secondary border-opacity-25">
                 <div class="text-white-50 small mb-2 text-uppercase fw-bold letter-spacing-1">Their Players</div>
                 <div class="trade-card-container h-100" id="theirTradeList" style="max-height: 300px;">
                    ${tradeState.partnerTeamId ? renderTargetPlayerList() : '<div class="text-center text-white-50 mt-5">Select a team...</div>'}
                 </div>
            </div>
            <div class="col-md-6">
                 <div class="text-white-50 small mb-2 text-uppercase fw-bold letter-spacing-1">Your Players (Optional)</div>
                 <div class="trade-card-container h-100" id="myTradeList" style="max-height: 300px;">
                    ${renderPlayerListHTML(globalTeams.find(t => t.bidKey === window.mySelectedTeamKey).roster, "mine")}
                 </div>
            </div>
        </div>

        <button class="btn-trade-action mt-3" onclick="submitComplexTrade()">PROPOSE MONEY TRADE</button>
    </div>
  `;
  container.innerHTML = html;
  updateTradeTotals();
}

function renderTradeMarket() {
  const container = document.getElementById("tradeContentArea");
  // Filter: Requests NOT from me, Status OPEN, AND Public (no targetTeamId)
  const market = currentTradeRequests.filter(
    (r) =>
      r.senderTeamId !== window.mySelectedTeamKey &&
      r.status === "OPEN" &&
      !r.targetTeamId,
  );

  if (market.length === 0) {
    container.innerHTML =
      '<div class="text-center text-white-50 mt-5"><h4>No Active Public Trades</h4><div class="small">Use "Direct Trade" to make specific offers</div></div>';
    return;
  }

  let html = '<div class="row g-3">';
  market.forEach((req) => {
    // Old legacy rendering for public market items (keeping it simple for now)
    // Or we could upgrade this too, but let's focus on Direct Trade for now.
    // Preserving legacy card style but slightly updated
    let badge =
      req.type === "CASH_TRADE" ? "bg-warning text-dark" : "bg-info text-dark";
    let icon = req.type === "CASH_TRADE" ? "bi-cash-stack" : "bi-person-fill";
    let title =
      req.type === "CASH_TRADE"
        ? `WANTS PLAYERS`
        : `OFFERS ${req.details.playerName}`;
    let sub =
      req.type === "CASH_TRADE"
        ? `Offering: ₹${req.details.amount} Cr`
        : `Looking for: ${req.details.categories.join(", ") || "Any Offer"}`;

    html += `
        <div class="col-md-6">
            <div class="p-3 border border-secondary rounded position-relative" style="background: rgba(255,255,255,0.05);">
                <span class="badge ${badge} position-absolute top-0 end-0 m-2">${req.type.replace("_", " ")}</span>
                <div class="h5 text-white mb-1"><i class="bi ${icon} me-2"></i>${req.senderTeamName}</div>
                <div class="fw-bold text-white fs-4">${title}</div>
                <div class="text-info mb-3">${sub}</div>
                <button class="btn btn-outline-light w-100" onclick="openProposalModal('${req.id}')">MAKE OFFER</button>
            </div>
        </div>
        `;
  });
  html += "</div>";
  container.innerHTML = html;
}

window.acceptDirectOffer = function (reqId) {
  try {
    const req = (typeof currentTradeRequests !== 'undefined') ? currentTradeRequests.find(r => r.id === reqId) : null;
    if (req) {
      // Build modal if not exists
      if (!document.getElementById('directOfferAcceptModal')) {
        const modalHtml = `
                <div class="modal fade" id="directOfferAcceptModal" tabindex="-1">
                  <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content bg-dark border-info text-white">
                      <div class="modal-header">
                        <h5 class="modal-title">ACCEPT DIRECT OFFER</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                      </div>
                      <div class="modal-body">
                        <div class="small text-white-50">From: <strong id="directOfferFrom"></strong></div>
                        <div class="mt-2 p-2 border rounded bg-black bg-opacity-25">
                          <div id="directOfferDetails" class="small text-white-50"></div>
                        </div>
                      </div>
                      <div class="modal-footer">
                        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">CANCEL</button>
                        <button type="button" class="btn btn-success" id="btn-confirm-direct-accept">ACCEPT</button>
                      </div>
                    </div>
                  </div>
                </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        document.body.addEventListener('click', (e) => {
          if (e.target && e.target.id === 'btn-confirm-direct-accept') {
            const rid = document.getElementById('btn-confirm-direct-accept').dataset.requestId;
            if (rid) {
              socket.emit('accept_proposal', { requestId: rid });
              const modalEl = document.getElementById('directOfferAcceptModal');
              const bs = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
              bs.hide();
            }
          }
        });
      }

      // Populate modal
      document.getElementById('directOfferFrom').innerText = req.senderTeamName || req.sender || 'Team';
      const playersOffered = req.details.offeredPlayerNames ? req.details.offeredPlayerNames.join(', ') : '';
      const cashOffered = req.details.offeredCash ? `₹${req.details.offeredCash} Cr` : '';
      const playersReq = req.details.requestedPlayerNames ? req.details.requestedPlayerNames.join(', ') : '';
      const cashReq = req.details.requestedCash ? `₹${req.details.requestedCash} Cr` : '';
      const offerStr = [playersOffered, cashOffered].filter(Boolean).join(' + ') || 'Nothing';
      const reqStr = [playersReq, cashReq].filter(Boolean).join(' + ') || 'Nothing';
      document.getElementById('directOfferDetails').innerHTML = `
                <div class="fw-bold text-success">You Receive</div>
                <div class="mb-2">${offerStr}</div>
                <div class="fw-bold text-danger">You Give</div>
                <div>${reqStr}</div>
            `;

      // store request id on confirm button
      document.getElementById('btn-confirm-direct-accept').dataset.requestId = reqId;

      // show modal
      const bs = new bootstrap.Modal(document.getElementById('directOfferAcceptModal'));
      bs.show();
      return;
    }
  } catch (e) {
    console.warn('Error rendering direct offer modal:', e);
  }

  // Fallback: try tradeSystem modal, then native confirm
  try {
    if (window.tradeSystem && typeof window.tradeSystem.showAcceptConfirmation === 'function') {
      window.tradeSystem.showAcceptConfirmation(reqId);
      return;
    }
  } catch (e) {
    console.warn('tradeSystem modal unavailable:', e);
  }

  if (confirm("Are you sure you want to accept this trade irrevocably?")) {
    socket.emit("accept_proposal", { requestId: reqId });
  }
};

window.rejectDirectOffer = function (reqId) {
  // Try in-app reject via tradeSystem if available
  try {
    if (window.tradeSystem && typeof window.tradeSystem.showRejectConfirmation === 'function') {
      window.tradeSystem.showRejectConfirmation(reqId);
      return;
    }
  } catch (e) {
    console.warn('tradeSystem reject modal unavailable:', e);
  }

  if (confirm('Reject this offer?')) {
    socket.emit('reject_proposal', { requestId: reqId });
  }
};


window.cancelMyRequest = function (reqId) {
  if (confirm("Cancel this request?")) {
    // To cancel my own request, I treat it like rejecting/closing.
    // Backend 'rejectProposal' expects (requestId, proposalId).
    // If I delete the request entirely?
    // There isn't a dedicated 'delete_request' endpoint in the code I read.
    // But 'rejectProposal' removes a specific proposal.

    // I'll emit 'reject_proposal' with a dummy ID, maybe the backend logic needs looking at?
    // Backend: request.proposals = request.proposals.filter(p => p.id !== proposalId);
    // That only removes a proposal. It doesn't delete the request.

    // Wait, the current system doesn't seem to have a "Delete Request" feature for the sender?
    // Only "Reject Proposal".
    // I'll leave it as non-cancellable for now or assume users just wait.
    alert("Feature not available in this version.");
  }
};

function renderTradeMy() {
  const container = document.getElementById("tradeContentArea");

  // 1. INCOMING OFFERS (Direct Trades targeting ME)
  const incoming = currentTradeRequests.filter(
    (r) => r.targetTeamId === window.mySelectedTeamKey && r.status === "OPEN",
  );

  // 2. OUTGOING REQUESTS (Direct or Public)
  const outgoing = currentTradeRequests.filter(
    (r) => r.senderTeamId === window.mySelectedTeamKey && r.status === "OPEN",
  );

  if (incoming.length === 0 && outgoing.length === 0) {
    container.innerHTML =
      '<div class="text-center text-white-50 mt-5"><h4>No Active Offers or Requests</h4></div>';
    return;
  }

  let html = '<div class="row g-4">';

  // INCOMING SECTION
  if (incoming.length > 0) {
    html +=
      '<div class="col-12"><h5 class="text-info border-bottom border-secondary pb-2">INCOMING OFFERS</h5></div>';
    incoming.forEach((req) => {
      const cashOffered = req.details.offeredCash
        ? `₹${req.details.offeredCash / 10000000} Cr`
        : "";
      const playersOffered =
        req.details.offeredPlayerNames &&
        req.details.offeredPlayerNames.length > 0
          ? req.details.offeredPlayerNames.join(", ")
          : "";
      const cashReq = req.details.requestedCash
        ? `₹${req.details.requestedCash / 10000000} Cr`
        : "";
      const playersReq =
        req.details.requestedPlayerNames &&
        req.details.requestedPlayerNames.length > 0
          ? req.details.requestedPlayerNames.join(", ")
          : "";

      let offerStr = [playersOffered, cashOffered].filter(Boolean).join(" + ");
      let reqStr = [playersReq, cashReq].filter(Boolean).join(" + ");
      if (!offerStr) offerStr = "Nothing";
      if (!reqStr) reqStr = "Nothing";

      html += `
            <div class="col-md-6">
                <div class="p-3 border border-info rounded bg-dark position-relative">
                    <span class="badge bg-info text-dark position-absolute top-0 end-0 m-2">DIRECT OFFER</span>
                    <div class="h5 text-white mb-1">${req.senderTeamName}</div>
                    <div class="small text-white-50 mb-2">${new Date(req.createdAt).toLocaleTimeString()}</div>
                    
                    <div class="d-flex justify-content-between mb-3 px-2">
                        <div class="text-success text-start" style="width: 48%;">
                            <div class="tiny text-white-50 text-uppercase mb-1">You Receive</div>
                            <div class="fw-bold" style="font-size: 0.9rem;">${offerStr}</div>
                        </div>
                        <div class="text-danger text-end" style="width: 48%;">
                             <div class="tiny text-white-50 text-uppercase mb-1">You Give</div>
                             <div class="fw-bold" style="font-size: 0.9rem;">${reqStr}</div>
                        </div>
                    </div>
                    
                    ${req.details.message ? `<div class="alert alert-dark p-2 small text-white-50 mb-3">"${req.details.message}"</div>` : ""}

                    <div class="d-flex gap-2">
                         <button class="btn btn-success flex-grow-1" onclick="acceptDirectOffer('${req.id}')">ACCEPT</button>
                         <!-- <button class="btn btn-outline-danger" onclick="rejectDirectOffer('${req.id}')">REJECT</button> -->
                    </div>
                </div>
            </div>`;
    });
  }

  // OUTGOING SECTION
  if (outgoing.length > 0) {
    html +=
      '<div class="col-12"><h5 class="text-warning border-bottom border-secondary pb-2 mt-4">OUTGOING REQUESTS</h5></div>';
    outgoing.forEach((req) => {
      if (req.targetTeamId) {
        // Direct Outgoing
        const cashOffered = req.details.offeredCash
          ? `₹${req.details.offeredCash / 10000000} Cr`
          : "";
        const playersOffered =
          req.details.offeredPlayerNames &&
          req.details.offeredPlayerNames.length > 0
            ? req.details.offeredPlayerNames.join(", ")
            : "";
        let offerStr = [playersOffered, cashOffered]
          .filter(Boolean)
          .join(" + ");

        html += `
                <div class="col-md-6">
                    <div class="p-3 border border-secondary rounded bg-dark position-relative">
                         <span class="badge bg-secondary position-absolute top-0 end-0 m-2">PENDING</span>
                         <div class="h5 text-white mb-1">To: ${req.targetTeamId}</div> 
                         <!-- Note: We don't have targetTeamName easily available in Request object unless added. For now updated to ID or need lookup -->
                         <div class="small text-white-50">You offered: ${offerStr || "Nothing"}</div>
                    </div>
                </div>`;
      } else {
        // Legacy Public Request logic...
        const propCount = req.proposals.length;
        html += `
                <div class="col-md-6">
                    <div class="border border-secondary rounded p-3 bg-dark h-100">
                        <div class="d-flex justify-content-between align-items-center mb-2"> 
                            <span class="badge bg-secondary">${req.type}</span>
                            <span class="text-white-50 small">${new Date(req.createdAt).toLocaleTimeString()}</span>
                        </div>
                        <div class="fw-bold text-white mb-2">${req.type === "CASH_TRADE" ? `Offering ₹${req.details.amount} Cr` : `Selling ${req.details.playerName}`}</div>
                        
                        <h6 class="text-warning mt-3 border-top border-secondary pt-2">Proposals (${propCount})</h6>
                        ${
                          propCount === 0
                            ? '<div class="text-white-50 small fst-italic">Waiting for offers...</div>'
                            : req.proposals
                                .map(
                                  (p) =>
                                    `<div class="bg-black bg-opacity-50 p-2 rounded mb-1 small text-white d-flex justify-content-between"><span>${p.proposerTeamName}: ${formatOffer(p.offer)}</span><div><button class="btn btn-sm btn-success py-0" onclick="acceptProposal('${req.id}', '${p.id}')">✓</button></div></div>`,
                                )
                                .join("")
                        }
                    </div>
                </div>`;
      }
    });
  }

  html += "</div>";
  container.innerHTML = html;
}

function formatOffer(offer) {
  let str = [];
  if (offer.offeredPlayers && offer.offeredPlayers.length > 0) {
    str.push(offer.offeredPlayers.map((x) => x.name).join(", "));
  }
  if (offer.offeredCash && offer.offeredCash > 0) {
    str.push(`₹${offer.offeredCash} Cr`);
  }
  return str.join(" + ");
}

function renderTradeHistory() {
  const container = document.getElementById("tradeContentArea");
  if (currentTradeHistory.length === 0) {
    container.innerHTML =
      '<div class="text-center text-white-50 mt-5"><h4>No History</h4></div>';
    return;
  }

  let html = '<ul class="list-group list-group-flush">';
  currentTradeHistory.forEach((h) => {
    html += `<li class="list-group-item bg-transparent text-white-50 border-secondary">
            <i class="bi bi-clock-history me-2"></i> ${h.text} <span class="float-end tiny">${new Date(h.timestamp).toLocaleTimeString()}</span>
        </li>`;
  });
  html += "</ul>";
  container.innerHTML = html;
}

// Proposals
let activeProposalReqId = null;

window.openProposalModal = function (reqId) {
  activeProposalReqId = reqId;
  const req = currentTradeRequests.find((r) => r.id === reqId);
  if (!req) return;

  const modalBody = document.getElementById("proposalBody");
  const myTeam = globalTeams.find((t) => t.bidKey === window.mySelectedTeamKey);
  const myPlayers = myTeam ? myTeam.roster : [];

  // Filter players based on requested category
  let filteredPlayers = myPlayers;

  if (
    req.type === "CASH_TRADE" &&
    req.details.categories &&
    req.details.categories.length > 0
  ) {
    filteredPlayers = myPlayers.filter((p) => {
      // Handle players without role or with various role formats
      const playerRole = p.role || p.category || "";
      if (!playerRole) return false;

      // Check if any requested category matches the player's role
      return req.details.categories.some((cat) => {
        const roleStr = playerRole.toLowerCase();
        const catStr = cat.toLowerCase();
        return roleStr.includes(catStr);
      });
    });
  }

  let html = `
        <div class="alert alert-dark border-secondary mb-3">
             <small class="text-warning">THEY WANT:</small><br>
             ${req.type === "CASH_TRADE" ? "Players matching: " + (req.details.categories && req.details.categories.length > 0 ? req.details.categories.join(", ") : "Any Role") : "Cash or Players"}
        </div>
        
        <div class="mb-3">
            <label class="text-white">Offer Cash (Cr)</label>
            <input type="number" id="propCash" class="form-control bg-dark text-white border-secondary" value="0">
        </div>
         <div class="mb-3">
            <label class="text-white">Offer Players (Select multiple)</label>
            <div class="card bg-dark border-secondary p-2" style="max-height: 300px; overflow-y:auto;">
                ${
                  filteredPlayers.length > 0
                    ? filteredPlayers
                        .map(
                          (p) => `
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" value="${p.name}" id="popt_${p.name.replace(/ /g, "")}">
                        <label class="form-check-label text-white-50" for="popt_${p.name.replace(/ /g, "")}">
                            ${p.name} <span class="badge bg-secondary ms-1">${p.role || p.category || "N/A"}</span>
                        </label>
                    </div>
                `,
                        )
                        .join("")
                    : '<div class="text-warning small"><i>No matching players in your roster</i></div>'
                }
            </div>
        </div>
    `;

  modalBody.innerHTML = html;

  // Submit Handler Hook
  document.getElementById("btnSubmitProposal").onclick = function () {
    // Gather Data
    const cash = document.getElementById("propCash").value;
    const selectedPlayers = [];
    filteredPlayers.forEach((p) => {
      const cb = document.getElementById(`popt_${p.name.replace(/ /g, "")}`);
      if (cb && cb.checked) {
        selectedPlayers.push({ name: p.name, role: p.role }); // Send needed info
      }
    });

    if (selectedPlayers.length === 0 && (!cash || cash <= 0)) {
      return alert("Offer something!");
    }

    socket.emit("submit_proposal", {
      requestId: activeProposalReqId,
      offerDetails: {
        offeredCash: parseInt(cash) || 0,
        offeredPlayers: selectedPlayers,
      },
    });

    const m = bootstrap.Modal.getInstance(
      document.getElementById("proposalModal"),
    );
    m.hide();
    setTimeout(() => {
      const tc = bootstrap.Modal.getInstance(
        document.getElementById("tradeCenterModal"),
      );
      if (!tc._isShown)
        new bootstrap.Modal(document.getElementById("tradeCenterModal")).show();
    }, 500);
  };

  // Show Modal
  new bootstrap.Modal(document.getElementById("proposalModal")).show();
};

window.acceptProposal = function (reqId, propId) {
  if (confirm("Accept this trade? This is final.")) {
    socket.emit("accept_proposal", { requestId: reqId, proposalId: propId });
  }
};

window.rejectProposal = function (reqId, propId) {
  socket.emit("reject_proposal", { requestId: reqId, proposalId: propId });
};

// Redefine checkTradeEligibility to be called periodically or on events
// Added above in socket listener
