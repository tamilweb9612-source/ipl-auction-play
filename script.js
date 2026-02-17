// ======================================================
// 🔧 0. PERSISTENT IDENTITY (THE WRISTBAND)
// ======================================================
let myPersistentId = localStorage.getItem("ipl_auction_player_id");

// ✨ BOOTSTRAP: Attempt to get or create identity
if (!myPersistentId) {
    myPersistentId = "user_" + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    localStorage.setItem("ipl_auction_player_id", myPersistentId);
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
  if (!roleKey) return "Unknown";
  return roleMap[roleKey.toLowerCase()] || roleKey;
}

// Helper function to convert player type
function getPlayerTypeFullName(playerType) {
  if (playerType === "Foreign") return "Overseas Player";
  return "Domestic Player";
}

// Initialize Sound Toggle
document.addEventListener("DOMContentLoaded", () => {
  // 1. Show lobby ASAP to prevent blank page
  const lobby = document.getElementById("lobbyScreen");
  if (lobby && !myRoomId) {
    lobby.style.display = "flex";
    console.log("🚀 Lobby screen shown.");
  }

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

  // Initialize Speech Synthesis
  if (typeof loadVoices === "function") {
    loadVoices();
    if (window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }

  // Initialize audio button when it becomes available
  initializeSoundButton();

  // Password Visibility Toggle
  document.querySelectorAll(".toggle-pass").forEach((btn) => {
    btn.onclick = () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (input) {
        if (input.type === "password") {
          input.type = "text";
          btn.innerHTML = '<i class="bi bi-eye-slash"></i>';
        } else {
          input.type = "password";
          btn.innerHTML = '<i class="bi bi-eye"></i>';
        }
      }
    };
  });

  // ✨ NEW: Auto-reconnect feature

  // Attach Create/Join Listeners
  attachCreateRoomListener();
  attachJoinRoomListener();
});

// NEW: Check for auto-reconnect and join room automatically

// Function to attach listener for Create Room button
function attachCreateRoomListener() {
  const btn = document.getElementById("doCreateBtn");
  if (!btn) return;

  // Use a flag to prevent double attachment
  if (btn.dataset.listenerAttached) return;
  btn.dataset.listenerAttached = "true";

  btn.addEventListener("click", () => {
    if (!socket.connected) {
      const lobbyError = document.getElementById("lobbyError");
      if (lobbyError) lobbyError.innerText = "Connection lost. Reconnecting...";
      return;
    }

    const roomIdInput = document.getElementById("createRoomId");
    const passInput = document.getElementById("createPass");

    if (!roomIdInput || !passInput) return;

    const roomId = roomIdInput.value.trim().toUpperCase();
    const password = passInput.value.trim();
    const lobbyError = document.getElementById("lobbyError");

    if (!roomId || password.length !== 4) {
      if (lobbyError)
        lobbyError.innerText = "Invalid Room ID (Any) or Password (4 Digits)";
      return;
    }

    localStorage.setItem("ipl_auction_player_name", myPlayerName);
    const playerName = myPlayerName || localStorage.getItem("userName") || "";

    socket.emit("create_room", {
      roomId,
      password,
      config: {
        budget: parseInt(
          document.getElementById("budget")?.value || 1000000000,
        ),
      },
      playerName: playerName || "", // Ensure it's not undefined
    }, (response) => {
       // Optional callback if server supports it, but we rely on events
       console.log("Create room emit acknowledged", response);
    });

    if (lobbyError) {
      lobbyError.innerHTML = '<div class="spinner-border spinner-border-sm text-warning" role="status"></div> Creating room...';
    }
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-gear-fill spin"></i> INITIALIZING...';
  });
}

// Function to attach listener for Join Room button
function attachJoinRoomListener() {
  const btn = document.getElementById("doJoinBtn");
  if (!btn) return;

  // Use a flag to prevent double attachment
  if (btn.dataset.listenerAttached) return;
  btn.dataset.listenerAttached = "true";

  btn.addEventListener("click", () => {
    if (!socket.connected) {
      const lobbyError = document.getElementById("lobbyError");
      if (lobbyError) lobbyError.innerText = "Connection lost. Reconnecting...";
      return;
    }

    const roomIdInput = document.getElementById("joinRoomId");
    const passInput = document.getElementById("joinPass");

    if (!roomIdInput || !passInput) return;

    const roomId = roomIdInput.value.trim().toUpperCase();
    const password = passInput.value.trim();
    const lobbyError = document.getElementById("lobbyError");

    if (!roomId || password.length !== 4) {
      if (lobbyError) lobbyError.innerText = "Invalid Room ID or Password";
      return;
    }

    localStorage.setItem("ipl_auction_player_name", myPlayerName);
    const playerName = myPlayerName || localStorage.getItem("userName") || "";

    socket.emit("join_room", {
      roomId,
      password,
      playerName,
    });

    if (lobbyError) {
      lobbyError.innerHTML = '<div class="spinner-border spinner-border-sm text-primary" role="status"></div> Joining room...';
    }
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-door-open-fill"></i> JOINING...';
  });
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
  if (!window.speechSynthesis) return;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return;
  
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

// Initial safe socket check
let socket;
if (typeof io !== "undefined") {
  socket = io({
    transports: ["polling", "websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    timeout: 20000,
    auth: {
      playerId: myPersistentId,
    },
  });
} else {
  console.error("❌ Socket.IO library (io) not found! Page may be broken.");
  // Provide a dummy socket object to prevent downstream crashes
  socket = {
    on: () => {},
    emit: () => {},
    off: () => {},
    connected: false,
  };
}
window.socket = socket;

const lobbyScreen = document.getElementById("lobbyScreen");
const gameContainer = document.getElementById("gameContainer");
const lobbyError = document.getElementById("lobbyError");

// --- GLOBAL VARIABLES ---
var myRoomId = null;
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

  // 🚀 RESUME CHECK
  const urlParams = new URLSearchParams(window.location.search);
  const action = urlParams.get("action");
  const rid = urlParams.get("roomId");

  if (action === "resume" && rid) {
    console.log("🚀 Resuming Game:", rid);
    if (lobbyError) lobbyError.innerText = "Resuming Session...";
    const user = JSON.parse(localStorage.getItem("user"));
    socket.emit("resume_game", {
      roomId: rid,
      email: user?.email,
      playerId: localStorage.getItem("ipl_auction_player_id"),
    });
  }
});

socket.on("resume_failed", (msg) => {
  alert("Resume Failed: " + msg);
  window.location.href = "dashboard.html";
});

socket.on("disconnect", (reason) => {
  socketAlive = false;
  console.warn("⚠️ Socket disconnected:", reason);
  logEvent("⚠️ Connection lost. Reconnecting...", true);
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

// PLAYER_DATABASE is now centrally managed in player-database.js
// Player data is now centrally managed in player-database.js
const PLAYER_DATA_CLEANUP = true;

// Redundant PLAYER_DATABASE removed
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

// 🖼️ PLAYER_IMAGE_MAP and NORMALIZED_IMAGE_MAP are now centrally managed in player-database.js

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
  if (!role) return 6;
  return ROLE_ORDER[role.toLowerCase()] || 6;
}

function getRoleIcon(role) {
  if (!role) return "👤";
  role = role.toLowerCase();
  if (role === "wk") return "🧤";
  if (role === "batter" || role === "bat") return "🏏";
  if (role === "allrounder" || role === "ar") return "🏏⚾";
  if (role === "spinner" || role === "spin") return "🌪️";
  if (role.includes("fast") || role.includes("pace") || role === "bowl")
    return "⚡";
  if (role === "bowler") return "⚾";
  return "👤";
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
  const dbEntry =
    window.NORMALIZED_PLAYER_DB?.[name.toLowerCase()] ||
    window.PLAYER_DATABASE?.[name];

  if (dbEntry)
    return {
      bat: dbEntry.bat,
      bowl: dbEntry.bowl,
      luck: dbEntry.luck,
      role: dbEntry.role || dbEntry.type,
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

// --- REPLACED LISTENERS ---
// Create and Join Room listeners have been moved to the DOMContentLoaded block
// and use the modernized 'attachCreateRoomListener' and 'attachJoinRoomListener' functions.

// --- SOCKET EVENTS ---

socket.on("error_message", (msg) => {
  console.error("Server Error:", msg);
  alert(`⚠️ Error: ${msg}`);

  // Reset Lobby Buttons
  const createBtn = document.getElementById("doCreateBtn");
  const joinBtn = document.getElementById("doJoinBtn");
  const lobbyError = document.getElementById("lobbyError");

  if (createBtn) {
    createBtn.disabled = false;
    createBtn.innerHTML = "CREATE ROOM";
  }
  if (joinBtn) {
    joinBtn.disabled = false;
    joinBtn.innerHTML = "JOIN ROOM";
  }
  if (lobbyError) {
    lobbyError.innerText = msg;
  }
});

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

    // Resume logic removed.
    // Clean state for new game experience.

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

    // Only switch if we already have a team (e.g. resume) or if we are admin
    if (mySelectedTeamKey || isAdmin) {
      switchToAuctionMode(data.state.teams);
      if (data.state.queue) auctionQueue = data.state.queue;
      socket.emit("request_sync");
    } else {
      if (lobbyError)
        lobbyError.innerText = "⚠️ Auction is LIVE! Pick a team quickly.";
    }
  }

  // Restore Chat History
  if (data.chatHistory) {
    const chatContainer = document.getElementById("chatMessages");
    if (chatContainer) {
      chatContainer.innerHTML = `
              <div class="text-center text-white-50 small mb-2">
                  Welcome back! Previous messages restored.
              </div>
          `;
      data.chatHistory.forEach((msg) => appendChatMessage(msg));
    }
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
    auctionStarted = !!data.isActive; // Keep state in sync
    if (data.isActive) {
      // Only switch if we have a team or are admin
      if (mySelectedTeamKey || isAdmin) {
        switchToAuctionMode(globalTeams);
      } else {
        renderLobbyTeams();
      }
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
    }

    const bidBtn = document.getElementById("placeBidBtn");
    bidBtn.disabled = false;
    updateBidControlsState(p);
  }
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

  // Handle Waiting State for non-admins who have a team
  const waitingState = document.getElementById("waitingState");
  if (!isAdmin && mySelectedTeamKey) {
    const myTeam = globalTeams.find((t) => t.bidKey === mySelectedTeamKey);
    if (myTeam) {
      container.style.display = "none";
      if (waitingState) {
        waitingState.style.display = "block";
        document.getElementById("waitingTeamName").innerText = `YOUR TEAM: ${myTeam.name}`;
      }
      const waitingText = document.getElementById("waitingText");
      if (waitingText) waitingText.style.display = "none";
    }
  } else {
    container.style.display = "grid";
    if (waitingState) waitingState.style.display = "none";
    const waitingText = document.getElementById("waitingText");
    if (waitingText) waitingText.style.display = "block";
  }

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

document.getElementById("startBtn").addEventListener("click", () => {
  if (!isAdmin) return;
  const activeTeams = globalTeams.filter((t) => t.isTaken);
  if (activeTeams.length < 2) {
    alert("Need at least 2 active teams to start!");
    return;
  }
  auctionQueue = buildAuctionQueue();
  socket.emit("start_auction", { teams: activeTeams, queue: auctionQueue });
});

socket.off("auction_started");
socket.on("auction_started", (data) => {
  auctionStarted = true;
  // Only switch if we have a team or are admin
  if (mySelectedTeamKey || isAdmin) {
    switchToAuctionMode(data.teams);
  } else {
    if (lobbyError)
      lobbyError.innerText = "⚠️ Auction is LIVE! Pick a team quickly.";
  }
  auctionQueue = data.queue;
  logEvent(`<strong>AUCTION STARTED</strong>`, true);
  playHammerSound();
  speakText(
    "Ladies and Gentlemen, welcome to the IPL Mega Auction. Let the bidding begin!",
  );
});

function enterGame(roomId) {
  myRoomId = roomId;
  window.myRoomId = roomId;
  document.getElementById("currentRoomDisplay").innerText = roomId;
  
  // Smoothly hide lobby and show game
  if (lobbyScreen) {
    lobbyScreen.style.setProperty("display", "none", "important");
  }
  
  if (gameContainer) {
    gameContainer.style.display = "block";
  }
  
  const setupSection = document.getElementById("setupSection");
  if (setupSection) {
    setupSection.style.display = "flex";
  }
  
  document.getElementById("auctionDashboard").style.display = "none";
  auctionStarted = false;

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
    
    // ✨ Sync to MongoDB
    if (typeof Auth !== "undefined") Auth.syncSessionToMongoDB();

    // Hide name entry section
    const nameSection = document.getElementById("nameEntrySection");
    if (nameSection) {
      nameSection.style.display = "none";
    }
  }

  // Send player name to server first if we have one
  if (myPlayerName) {
    socket.emit("update_player_name", { playerName: myPlayerName });
    // ✨ Also sync identity
    if (typeof Auth !== "undefined") Auth.syncSessionToMongoDB();
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
  // Update sidebar if auction is active
  if (document.getElementById("auctionDashboard").style.display !== "none") {
    updateTeamSidebar(globalTeams);
  }
});

socket.off("team_claim_success");
socket.on("team_claim_success", (key) => {
  mySelectedTeamKey = key;
  if (myRoomId) {
    localStorage.setItem(`ipl_team_${myRoomId}`, key);
    // ✨ Sync to MongoDB immediately
    if (typeof Auth !== "undefined") Auth.syncSessionToMongoDB();
  }
  renderLobbyTeams();
  lobbyError.innerText = "✅ Team ownership granted!";
  logEvent("✅ Team ownership restored.", true);

  // Switch to wait mode if auction hasn't started
  if (!isAdmin && !auctionStarted) {
    const waitingState = document.getElementById("waitingState");
    const container = document.getElementById("teamNamesContainer");
    const myTeam = globalTeams.find((t) => t.bidKey === key);
    
    if (container) container.style.display = "none";
    if (waitingState) {
        waitingState.style.display = "block";
        if (myTeam) document.getElementById("waitingTeamName").innerText = `YOUR TEAM: ${myTeam.name}`;
    }
    const waitingText = document.getElementById("waitingText");
    if (waitingText) waitingText.style.display = "none";
  }

  if (!isAdmin && auctionStarted) {
    switchToAuctionMode(globalTeams);
  }
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
  const domWK = RAW_DATA["Domestic"].wicketkeepers.map((n) =>
    createPlayer(
      { name: n, type: "Uncapped" },
      "Domestic Set",
      "wk",
      2000000,
      500000,
    ),
  );
  const domAR = RAW_DATA["Domestic"].allrounders.map((n) =>
    createPlayer(
      { name: n, type: "Uncapped" },
      "Domestic Set",
      "ar",
      2000000,
      500000,
    ),
  );
  safePush(shuffle([...domBat, ...domBowl, ...domWK, ...domAR]));

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
socket.off("update_lot");
socket.on("update_lot", (data) => {
  const p = data.player;
  currentActivePlayer = p;
  saleProcessing = false;
  document.getElementById("currentSet").innerText = p.set;
  document.getElementById("lotNoDisplay").innerText = `LOT #${data.lotNumber
    .toString()
    .padStart(3, "0")}`;
  document.getElementById("pName").innerText = p.name;
  document.getElementById("pCat").innerText = p.category;
  document.getElementById("pBase").innerText = formatAmount(p.basePrice);
  document.getElementById("pTypeBadge").innerText = p.roleKey.toUpperCase();

  const timerEl = document.getElementById("auctionTimer");
  timerEl.innerText = "10";
  timerEl.classList.remove("timer-danger", "timer-paused");

  document.getElementById("skipBtn").disabled = false;
  document.getElementById("soldBtn").disabled = true;

  const avatar = document.getElementById("pInitials");
  if (p.img) {
    avatar.innerText = "";
    avatar.style.backgroundImage = `url('${p.img}')`;
  } else {
    avatar.style.backgroundImage = "none";
    avatar.innerText = p.name.substring(0, 2).toUpperCase();
  }

  document.getElementById("pBid").innerText = formatAmount(data.currentBid);
  document.getElementById("pTeam").innerHTML =
    `<span class="text-white-50">Opening Bid</span>`;
  currentHighestBidderKey = null;

  const bidBtn = document.getElementById("placeBidBtn");
  bidBtn.disabled = false;
  updateBidControlsState(p);

  // For first bid, show base price only. For subsequent bids, show increment
  bidBtn.innerHTML = `BID ${formatAmount(data.currentBid)} <i class="bi bi-hammer"></i>`;
  bidBtn.style.background = "";
  bidBtn.style.color = "";

  updateTeamSidebar(globalTeams);
  logEvent(`<strong>LOT UP:</strong> ${p.name}`, true);

  if (lastAnnouncedLotId !== data.lotNumber) {
    lastAnnouncedLotId = data.lotNumber;

    // Build announcement text
    let announcement = "";

    // Check if set has changed - announce the new set
    if (lastAnnouncedSet !== p.category) {
      lastAnnouncedSet = p.category;
      announcement = `${p.category} Set. `;
    }

    // Player details
    const roleName = getRoleFullName(p.roleKey);
    const playerTypeName = getPlayerTypeFullName(p.playerType);
    const priceInCrores = (p.basePrice / 10000000).toFixed(2);

    announcement += `Next player. ${p.name}. ${roleName}. ${playerTypeName}. Base price ${priceInCrores} crore rupees.`;

    speakText(announcement);
  }
});

// 🔧 BID UPDATE
socket.off("bid_update");
socket.on("bid_update", (data) => {
  const bidEl = document.getElementById("pBid");
  bidEl.innerText = formatAmount(data.amount);
  bidEl.classList.add("price-pulse");
  setTimeout(() => bidEl.classList.remove("price-pulse"), 200);

  document.getElementById("pTeam").innerHTML =
    `<span class="text-warning">${data.team.name}</span>`;
  currentHighestBidderKey = data.team.bidKey;

  document.getElementById("skipBtn").disabled = true;
  document.getElementById("soldBtn").disabled = false;

  const timerEl = document.getElementById("auctionTimer");
  timerEl.innerText = "10";
  timerEl.classList.remove("timer-danger");

  if (currentActivePlayer) {
    const input = document.getElementById("customBidInput");
    if (input) input.value = currentActivePlayer.incrementStep;
  }

  const bidBtn = document.getElementById("placeBidBtn");
  if (currentHighestBidderKey === mySelectedTeamKey) {
    bidBtn.disabled = true;
    bidBtn.innerHTML = `WINNING <i class="bi bi-check-circle"></i>`;
    bidBtn.style.background = "#333";
    bidBtn.style.color = "#888";
  } else {
    bidBtn.disabled = false;
    const inc = parseInt(document.getElementById("customBidInput").value);
    const nextBid = data.amount + inc;
    bidBtn.innerHTML = `BID ${formatAmount(
      nextBid,
    )} <i class="bi bi-hammer"></i>`;
    bidBtn.style.background = "";
    bidBtn.style.color = "";
  }
  updateTeamSidebar(globalTeams);
  logEvent(`${data.team.name} bids ${formatAmount(data.amount)}`);
  playBidSound();

  // Voice announcement for bid (only amount, no team name)
  const bidInCrores = (data.amount / 10000000).toFixed(2);
  speakText(`${bidInCrores} crores.`);
});

// 🛑 SUBMIT BID (FIXED LOGIC)
function submitMyBid() {
  if (!socketAlive) return alert("Connection lost. Please wait…");
  if (
    !auctionStarted ||
    document.getElementById("saleOverlay").classList.contains("overlay-active")
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

  // FIXED: Logic for first bid vs subsequent bids
  const currentBidText = document.getElementById("pBid").innerText;
  const inc = parseInt(document.getElementById("customBidInput").value);

  let bidAmount;

  // Check if this is the FIRST bid (no one has bid yet)
  if (currentHighestBidderKey === null) {
    // First bid = exactly base price (no increment)
    bidAmount = currentActivePlayer.basePrice;
  } else {
    // Subsequent bids = current bid + increment
    const parsed = parsePrice(currentBidText);
    const current = parsed > 0 ? parsed : currentActivePlayer.basePrice;
    bidAmount = current + inc;
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

document.getElementById("placeBidBtn").addEventListener("click", submitMyBid);
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

function setupBidControls() {
  const inputContainer = document.querySelector(".input-group");
  if (inputContainer) {
    inputContainer.className = "d-flex align-items-center gap-2";
    inputContainer.style.maxWidth = "250px";
    const oldSpan = inputContainer.querySelector("span");
    if (oldSpan) oldSpan.remove();

    inputContainer.innerHTML = `
            <div class="flex-grow-1">
                <div class="small text-center text-white-50" style="font-size: 0.6rem; letter-spacing:1px;">INCREMENT</div>
                <input type="number" id="customBidInput" class="form-control bg-dark text-warning border-secondary fw-bold text-center p-0 display-font fs-4" value="2500000" readonly style="height: 35px;">
            </div>
            <button id="incBidBtn" class="btn btn-outline-success fw-bold" style="height: 45px; width: 45px; border-radius: 8px;">+</button>
        `;
    document
      .getElementById("incBidBtn")
      .addEventListener("click", () => adjustIncrement(true));
  }
}

function adjustIncrement(isIncrease) {
  const input = document.getElementById("customBidInput");
  let val = parseInt(input.value);
  const step = 2500000;
  if (isIncrease) val += step;
  input.value = val;
  const bidBtn = document.getElementById("placeBidBtn");
  if (currentHighestBidderKey === mySelectedTeamKey) {
    bidBtn.disabled = true;
    bidBtn.innerHTML = `WINNING <i class="bi bi-check-circle"></i>`;
    bidBtn.style.background = "#333";
    bidBtn.style.color = "#888";
  } else {
    bidBtn.disabled = false;
    // Fix: Using current bid amount from UI
    const currentAmount = parsePrice(document.getElementById("pBid").innerText);
    const nextBid = currentAmount + val;
    bidBtn.innerHTML = `BID ${formatAmount(
      nextBid,
    )} <i class="bi bi-hammer"></i>`;
    bidBtn.style.background = "";
    bidBtn.style.color = "";
  }
}

function updateBidControlsState(player) {
  const input = document.getElementById("customBidInput");
  if (input) input.value = player.incrementStep;
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

      const clickAction =
        !isMine && !t.isTaken && !mySelectedTeamKey
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
                        ${!isMine && !t.isTaken && !mySelectedTeamKey ? '<br><span class="badge bg-success" style="font-size:0.5rem">JOIN FREE TEAM</span>' : ""}
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

document.getElementById("soldBtn")?.addEventListener("click", () => {
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

document.getElementById("skipBtn")?.addEventListener("click", () => {
  if (!isAdmin || saleProcessing) return;
  saleProcessing = true;
  socket.emit("finalize_sale", { isUnsold: true });
});

document.getElementById("timerToggleBtn")?.addEventListener("click", () => {
  console.log("⏯️ Timer Toggle Clicked. Admin?", isAdmin);
  if (isAdmin) socket.emit("toggle_timer");
});
document
  .getElementById("endAuctionBtn")
  ?.addEventListener(
    "click",
    () =>
      isAdmin && confirm("End Auction?") && socket.emit("end_auction_trigger"),
  );

document.getElementById("autoWinBtn")?.addEventListener("click", () => {
  if (!isAdmin || saleProcessing) return;
  if (confirm("⚡ Claim this player for your team instantly?")) {
    saleProcessing = true;
    socket.emit("auto_win_bid");
  }
});

document.getElementById("fastFinishBtn")?.addEventListener("click", () => {
  if (!isAdmin) return;
  if (
    confirm(
      "⚠️ FAST FINISH?\n(This will skip all remaining players, auto-fill squads, and run simulation immediately)",
    )
  ) {
    socket.emit("force_fast_finish");
  }
});

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
  saleProcessing = false; // Reset lock

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
  const cappedRuns = Math.min(parseInt(runs) || 0, 400); // Increased cap significantly for realism
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

  console.log("Rendering Roster for", myTeam.name, myTeam.roster);
  const sortedRoster = [...myTeam.roster].sort(
    (a, b) => getRolePriority(a.roleKey) - getRolePriority(b.roleKey),
  );

  sortedRoster.forEach((p, i) => {
    console.log("Adding player to UI:", p.name, p.roleKey);
    const originalIndex = myTeam.roster.findIndex(x => x.name === p.name);
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

document.getElementById("submitSquadBtn").addEventListener("click", () => {
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
    waitMsg.innerHTML += `<br><button onclick="forceRunSim()" class="btn btn-sm btn-outline-warning mt-2">FORCE START SIMULATION</button>`;
  }
});

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
  mb.innerHTML = "";
  globalTeams.forEach((t) => {
    let h =
      '<div class="table-responsive"><table class="table table-dark table-sm table-bordered"><thead><tr><th>Player</th><th>Price</th></tr></thead><tbody>';
    if (t.roster)
      t.roster.forEach(
        (p) =>
          (h += `<tr><td>${p.name}</td><td>${formatAmount(p.price)}</td></tr>`),
      );
    h += "</tbody></table></div>";
    mb.innerHTML += `<div class="card bg-black border-secondary mb-3"><div class="card-header white border-secondary d-flex justify-content-between"><span class="text-warning fw-bold">${
      t.name
    }</span><span class="text-warning fw-bold">Spent: ${formatAmount(
      t.totalSpent,
    )}</span></div><div class="card-body p-2">${h}</div></div>`;
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

  // --- QUICK START / AUTO JOIN LOGIC ---
  const urlParams = new URLSearchParams(window.location.search);
  const action = urlParams.get("action");
  const roomParam = urlParams.get("room");
  const passParam = urlParams.get("pass");

  if (action === "new" || (roomParam && passParam)) {
    console.log("🚀 Custom flow detected. Redirecting...");
    if (lobby) lobby.style.display = "none";

    setTimeout(() => {
      if (action === "new") {
        const createRoomInput = document.getElementById("createRoomId");
        const createPassInput = document.getElementById("createPass");
        const doCreateBtn = document.getElementById("doCreateBtn");

        if (createRoomInput && createPassInput && doCreateBtn) {
          createRoomInput.value = Math.floor(
            100000 + Math.random() * 900000,
          ).toString();
          createPassInput.value = "0000";

          if (socket.connected) doCreateBtn.click();
          else socket.on("connect", () => doCreateBtn.click());
        }
      } else if (roomParam && passParam) {
        const joinRoomInput = document.getElementById("joinRoomId");
        const joinPassInput = document.getElementById("joinPass");
        const doJoinBtn = document.getElementById("doJoinBtn");

        if (joinRoomInput && joinPassInput && doJoinBtn) {
          joinRoomInput.value = roomParam;
          joinPassInput.value = passParam;

          if (socket.connected) doJoinBtn.click();
          else socket.on("connect", () => doJoinBtn.click());
        }
      }
    }, 800);
  }
});

/* =========================================
   AUTO TEST FEATURE (SKIP AUCTION)
   ========================================= */

// 🔥 CSK (STRONG TEAM – like RCB 2025 power squad)
// ⚡ KKR (Balanced power + spin core)
// 🔴 RCB (STRONG SQUAD – Power batting + quality pace + spin)



// 🟡 CSK (MEDIUM SQUAD – Balanced but slightly weaker than RCB)
const AUTO_RCB_NAMES = [
  "Virat Kohli",         // Retained - Opener
  "Phil Salt",           // NEW - Explosive Opener (WK)
  "Rajat Patidar",       // Retained - Captain / No.3
  "Liam Livingstone",    // NEW - Power Hitter / Spin
  "Jitesh Sharma",       // NEW - Finisher (WK)
  "Krunal Pandya",       // NEW - Spin All-rounder
  "Tim David",           // NEW - Finisher
  "Bhuvneshwar Kumar",   // NEW - Swing Specialist
  "Josh Hazlewood",      // NEW - Pace Spearhead
  "Yash Dayal",          // Retained - Left-arm Pace
  "Suyash Sharma",       // NEW - Leg-spinner
  "Devdutt Padikkal",    // NEW - Bench / Top order
  "Rasikh Salam Dar"     // NEW - Bench / Death Bowling
];
const AUTO_CSK_NAMES = [
  "Ruturaj Gaikwad",     // Retained - Captain / Opener
  "Devon Conway",        // RE-BOUGHT - Opener
  "Rachin Ravindra",     // RE-BOUGHT - No.3 / Spin
  "Shivam Dube",         // Retained - Power Hitter
  "Ravindra Jadeja",     // Retained - All-rounder
  "Sam Curran",          // NEW - Pace All-rounder
  "MS Dhoni",            // Retained - Finisher (WK)
  "Ravichandran Ashwin", // NEW - Spin (Homecoming)
  "Noor Ahmad",          // NEW - X-Factor Spinner
  "Khaleel Ahmed",       // NEW - Left-arm Pace
  "Matheesha Pathirana", // Retained - Death Specialist
  "Rahul Tripathi",      // NEW - Bench / Middle order
  "Nathan Ellis"         // NEW - Bench / Death Pace
];

// Explanation

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
function formatOver(balls) {
  if (!balls) return "0.0";
  const o = Math.floor(balls / 6);
  const b = balls % 6;
  return `${o}.${b}`;
}
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
  // Remove welcome message if it exists
  const welcome = document.querySelector('.chat-welcome-msg');
  if (welcome) welcome.remove();
  appendChatMessage(data);
});

function appendChatMessage(data) {
  const chatContainer = document.getElementById("chatMessages");
  if (!chatContainer) return;

  // Create message element
  const messageDiv = document.createElement("div");
  // Check if it's our own message
  const isMe = data.playerName === myPlayerName;
  messageDiv.className = `chat-message ${isMe ? "self" : "other"}`;

  messageDiv.innerHTML = `
    <div class="chat-name">${escapeHtml(data.playerName)}</div>
    <div class="chat-text">${escapeHtml(data.message)}</div>
    ${data.timestamp ? `<div class="chat-time">${new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>` : ""}
  `;

  chatContainer.appendChild(messageDiv);

  // Auto-scroll to bottom
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

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

  // Initial Welcome Message
  setTimeout(initChatWelcome, 1000);
});

function initChatWelcome() {
  const chatContainer = document.getElementById("chatMessages");
  if (chatContainer && chatContainer.children.length === 0) {
    const welcomeDiv = document.createElement("div");
    welcomeDiv.className = "chat-welcome-msg";
    welcomeDiv.innerHTML = `
      <i class="fa-solid fa-comments"></i>
      Welcome to the Live Auction Chat!<br>
      Stay respectful and enjoy the bidding war.
    `;
    chatContainer.appendChild(welcomeDiv);
  }
}

// Show name entry section if no name is set
function checkAndShowNameEntry() {
  if (!myPlayerName) {
    const nameSection = document.getElementById("nameEntrySection");
    if (nameSection) {
      nameSection.style.display = "block";
    }
  }
}

// ===================================
// 🛑 CLOSE ROOM PERMANENTLY (ADMIN)
// ===================================
function closeRoomPermanently() {
  if (!isAdmin) {
    alert("Only the Host can close the room.");
    return;
  }

  if (
    confirm(
      "⚠️ ARE YOU SURE?\n\nThis will DELETE the room and kick all players.\nThe game will NOT be resumable.",
    )
  ) {
    socket.emit("close_room");
  }
}

// 🚪 HANDLE ROOM CLOSED EVENT
socket.on("room_closed", () => {
  alert(
    "🛑 HOST HAS CLOSED THE ROOM.\n\nThank you for playing!\nYou will now be redirected to the dashboard.",
  );

  // Clear local storage for this room
  if (myRoomId) {
    localStorage.removeItem(`ipl_team_${myRoomId}`);
  }
  localStorage.removeItem("auto_reconnect_room");
  localStorage.removeItem("auto_reconnect_team");

  window.location.href = "dashboard.html";
});

// ======================================================
// 🏆 GO TO TOURNAMENT BUTTON HANDLER
// ======================================================
// Listen for when all squads are ready
socket.on("all_squads_ready", () => {
  console.log("✅ All squads submitted! Showing GO button");
  
  // Hide waiting message
  const waitingMsg = document.getElementById("waitingMsg");
  if (waitingMsg) {
    waitingMsg.classList.add("d-none");
  }
  
  // Show the GO TO TOURNAMENT button
  const goBtn = document.getElementById("goToTournamentBtn");
  if (goBtn) {
    goBtn.classList.remove("d-none");
  }
});

// Handle GO TO TOURNAMENT button click
// Wrapped in DOMContentLoaded just in case, though usually script.js is at the end
document.addEventListener("DOMContentLoaded", () => {
  const goBtn = document.getElementById("goToTournamentBtn");
  if (goBtn) {
    goBtn.addEventListener("click", () => {
      console.log("🚀 Navigating to tournament page...");
      // Store current room and team if not already set
      const roomId = myRoomId || localStorage.getItem("ipl_room_id");
      const teamKey = mySelectedTeamKey || localStorage.getItem(`ipl_team_${roomId}`);
      
      if (roomId) localStorage.setItem("tournament_room_id", roomId);
      if (teamKey) localStorage.setItem("tournament_team_key", teamKey);
      
      // Navigate to tournament page
      window.location.href = "play.html";
    });
  }
});

// --- PLAYER STATS POPUP LOGIC ---
document.getElementById('playerInfoBtn')?.addEventListener('click', () => {
    let playerName;
    if (typeof currentActivePlayer !== 'undefined' && currentActivePlayer) {
        playerName = currentActivePlayer.name;
    } else {
        // Fallback: try to read from UI
        playerName = document.getElementById('pName')?.innerText;
    }
    
    if (playerName) showPlayerStats(playerName);
});

function showPlayerStats(playerName) {
    if (!playerName) return;
    
    // Normalize name
    playerName = playerName.trim();
    if(playerName.includes(" ")) playerName = playerName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' '); // Capitalize

    // getPlayerCareerStats is from stats.js (global)
    let stats = {};
    if (typeof getPlayerCareerStats === 'function') {
        stats = getPlayerCareerStats(playerName);
    } else {
        console.warn('stats.js not loaded or getPlayerCareerStats missing');
        stats = { matches:0, runs:0, wickets:0, hs:0, best:'-' };
    }
    
    // Database info (for role/type if needed)
    const db = (window.PLAYER_DATABASE && window.PLAYER_DATABASE[playerName]) || {};
    
    // Populate Modal
    const nameEl = document.getElementById('statsPlayerName');
    if(nameEl) nameEl.innerText = playerName.toUpperCase();
    
    const roleEl = document.getElementById('statsPlayerRole');
    if(roleEl) roleEl.innerText = (db.role || (typeof currentActivePlayer !== 'undefined' ? currentActivePlayer.roleKey : 'Icon')).toUpperCase();
    
    const typeEl = document.getElementById('statsPlayerType');
    if(typeEl) typeEl.innerText = (db.type || (typeof currentActivePlayer !== 'undefined' ? currentActivePlayer.playerType : 'Indian')) === 'Foreign' ? '✈️ OVERSEAS' : '🇮🇳 INDIAN';
    
    // Image
    const imgEl = document.getElementById('statsPlayerImage');
    if(imgEl) {
        let imgUrl = '';
        // Check currentActivePlayer if name matches
        if (typeof currentActivePlayer !== 'undefined' && currentActivePlayer && currentActivePlayer.name === playerName && currentActivePlayer.img) {
            imgUrl = currentActivePlayer.img;
        } else if (stats.img) {
            imgUrl = stats.img;
        } else if (window.PLAYER_IMAGE_MAP) {
            if (window.PLAYER_IMAGE_MAP[playerName]) {
                imgUrl = window.PLAYER_IMAGE_MAP[playerName];
            } else if (window.PLAYER_IMAGE_MAP[playerName.toLowerCase()]) {
                imgUrl = window.PLAYER_IMAGE_MAP[playerName.toLowerCase()];
            }
        }
        
        if (imgUrl) {
            imgEl.src = imgUrl;
        } else {
             imgEl.src = `https://ui-avatars.com/api/?name=${playerName}&background=random`;
        }
    }

    // Stats Grid
    const grid = document.getElementById('statsGrid');
    if(grid) {
        grid.innerHTML = '';
        const createItem = (label, value, color='white') => `
            <div class="col-4">
                <div class="p-2 rounded" style="background: rgba(255,255,255,0.05);">
                    <div class="text-white-50 small text-uppercase" style="font-size:0.6rem; letter-spacing:1px;">${label}</div>
                    <div class="fw-bold text-${color} fs-4 display-font">${value}</div>
                </div>
            </div>
        `;

        let html = '';
        html += createItem('MATCHES', stats.matches || 0, 'white');
        html += createItem('RUNS', stats.runs || 0, 'warning');
        html += createItem('WICKETS', stats.wickets || 0, 'info');
        html += createItem('HIGH SCORE', stats.hs || 0, 'white');
        html += createItem('BEST BOWL', stats.best || '-', 'white');
        
        // NEW SKILLS
        const pDb = (typeof PLAYER_DATABASE !== 'undefined') ? (PLAYER_DATABASE[playerName] || {}) : {};
        if (pDb.bat) html += createItem('BAT SKILL', pDb.bat, 'warning');
        if (pDb.bowl) html += createItem('BOWL SKILL', pDb.bowl, 'info');
        
        grid.innerHTML = html;
    }
    
    // Show Modal
    const modalEl = document.getElementById('playerStatsModal');
    if(modalEl) {
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    }
}


