const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const cors = require("cors");
const mongoose = require("mongoose");
const { DocumentArray } = mongoose.Types;

const authRoutes = require("./routes/auth");
const Room = require("./models/Room");
const User = require("./models/User");
const Win = require("./models/Win");
const featureIntegration = require("./feature-integration");
const AI = require("./ai");
const PLAYER_DATABASE = require("./player-database").PLAYER_DATABASE;
const NORMALIZED_PLAYER_DB = {};
if (PLAYER_DATABASE) {
  Object.keys(PLAYER_DATABASE).forEach((k) => {
    NORMALIZED_PLAYER_DB[k.toLowerCase()] = PLAYER_DATABASE[k];
  });
}

function getPlayerFromDB(name) {
  if (!name) return { name: "Unknown" };
  return (
    PLAYER_DATABASE[name] ||
    NORMALIZED_PLAYER_DB[name.toLowerCase()] || { name }
  );
}
const liveMatchModule = require("./live-match");

console.log("-----------------------------------------");
console.log("SERVER STARTUP ENV CHECK:");
console.log(
  "MONGODB_URI:",
  process.env.MONGODB_URI
    ? "LOADED (Starts with " + process.env.MONGODB_URI.substring(0, 10) + "...)"
    : "UNDEFINED",
);
console.log("-----------------------------------------");

const app = express();
app.use(cors());
app.use(express.json()); // Essential for Auth API
app.use("/api/auth", authRoutes);

// 🛠️ DISABLE CACHING (Fix for updates not showing)
app.set("etag", false);
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  next();
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    database: mongoConnected ? "connected" : "disconnected",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// NEW: API Route to fetch Match Details
app.get("/api/matches/:roomId", async (req, res) => {
  const rid = req.params.roomId;
  console.log(`📡 [API] Fetching Match Details for Room: ${rid}`);
  try {
    // Find most recent win record for this roomId
    const winRecord = await Win.findOne({ roomId: rid }).sort({ playedAt: -1 });

    if (!winRecord) {
      console.warn(`⚠️  [API] No Win record found for Room: ${rid}`);
      return res.status(404).json({ message: "Match details not found" });
    }

    console.log(
      `✅ [API] Found Win record for ${rid} (Played: ${winRecord.playedAt})`,
    );
    res.json(winRecord);
  } catch (err) {
    console.error(`❌ [API] Error fetching match details for ${rid}:`, err);
    res.status(500).json({ message: "Server error" });
  }
});

// Endpoint removed (Test residue)

// MongoDB Connection (Non-blocking with retry and monitoring)
let mongoConnected = false;

function connectMongoDB(retries = 3) {
  mongoose
    .connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 30000, // Increased to 30s for more stable cloud connection
      socketTimeoutMS: 45000,
      maxPoolSize: 10, // Connection pool
      retryWrites: true,
    })
    .then(() => {
      mongoConnected = true;
      console.log(
        "✅ [DATABASE] Connected to MongoDB Atlas - Database: auction_db",
      );
      loadRoomsFromDB(); // Function call moved here to ensure DB is ready
    })
    .catch((err) => {
      mongoConnected = false;
      console.warn("⚠️  [DATABASE] Connection Failed:", err.message);

      if (retries > 0) {
        console.log(
          `   [DATABASE] Retrying connection in 5 seconds... (${retries} attempts left)`,
        );
        setTimeout(() => connectMongoDB(retries - 1), 5000);
      } else {
        console.error(
          "❌ [DATABASE] FATAL: Exhausted all retries. Persistent storage disabled.",
        );
        require("fs").writeFileSync(
          "db-error.log",
          `[${new Date().toISOString()}] ${err.stack || err.message}\n`,
          { flag: "a" },
        );
      }
    });
}

// Monitor connection events
mongoose.connection.on("disconnected", () => {
  console.warn("⚠️  MongoDB disconnected. Attempting to reconnect...");
  mongoConnected = false;
  setTimeout(() => connectMongoDB(2), 3000);
});

mongoose.connection.on("reconnected", () => {
  console.log("✅ MongoDB reconnected!");
  mongoConnected = true;
});

mongoose.connection.on("error", (err) => {
  console.error("❌ MongoDB error:", err.message);
  // Don't close on transient errors - mongoose handles reconnection
});

// Initial connection
connectMongoDB();

// Method Change: Create Server
const server = http.createServer(app);

// Method Change: Socket.io setup for production environment
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  pingTimeout: 60000,
  allowEIO3: true, // Support older clients
  transports: ["polling", "websocket"], // Explicitly support both
});

const AUCTION_TIMER_SECONDS = 10;

// Method Change: GoDaddy assigns a specific named pipe or port.
const PORT = process.env.PORT || 3000;

// --- SERVE FILES ---
app.use(express.static(path.join(__dirname)));

app.get("/IMG-20260204-WA0000.jpg", (req, res) => {
  res.sendFile(path.join(__dirname, "IMG-20260204-WA0000.jpg"));
});

app.get("/IMG-20260204-WA0001.jpg", (req, res) => {
  res.sendFile(path.join(__dirname, "IMG-20260204-WA0001.jpg"));
});

// Serve the main file
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "intro.html"));
});

// --- UTILS ---
function getRoomId(socket) {
  return [...socket.rooms].find((r) => r !== socket.id);
}

function isAdmin(socket) {
  const roomId = getRoomId(socket);
  const r = rooms[roomId];
  return r && r.adminSocketId === socket.id;
}

// --- GLOBAL STATE ---
let rooms = {};

// Initialize features

const tradeSystem = featureIntegration.setupTradeSystem(io, rooms, (roomId) =>
  saveRoomToDB(roomId, true),
); // Initialize Trade System
const achievements = featureIntegration.setupAchievementSystem(io);
const analytics = featureIntegration.setupAnalytics(io, rooms);
const liveMatch = liveMatchModule.setupLiveMatch(io, rooms);

// --- DB SANITIZATION HELPERS ---
function deepSanitizePlayers(input) {
  if (!input) return [];
  let data = input;
  // If it's a string, try to parse it
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch (e) {
      return [];
    }
  }
  // Now it must be an array
  if (!Array.isArray(data)) return [];

  // Recursively sanitize each element (Mongoose CastError prevention)
  return data
    .map((item) => {
      if (typeof item === "string") {
        try {
          return JSON.parse(item);
        } catch (e) {
          return null;
        }
      }
      return item;
    })
    .filter(Boolean);
}

function deepSanitizeTeams(input) {
  if (!input) return [];
  let data = input;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch (e) {
      return [];
    }
  }
  if (!Array.isArray(data)) return [];

  return data
    .map((team) => {
      let t = team;
      if (typeof t === "string") {
        try {
          t = JSON.parse(t);
        } catch (e) {
          return null;
        }
      }
      if (!t) return null;

      // Sanitize Roster inside team
      if (t.roster) t.roster = deepSanitizePlayers(t.roster);
      return t;
    })
    .filter(Boolean);
}

// Load rooms from DB on startup (Persistence)
async function loadRoomsFromDB() {
  // Skip if MongoDB is not connected
  if (mongoose.connection.readyState !== 1) {
    console.log("⚠️  Skipping room restoration - MongoDB not connected");
    return;
  }

  try {
    const dbRooms = await Room.find({}).sort({ createdAt: -1 });
    dbRooms.forEach((dr) => {
      // PRO-TIP: Don't overwrite rooms that are CURRENTLY ACTIVE in memory
      // This prevents crashes if DB connects/reconnects while a game is running
      if (rooms[dr.roomId]) {
        console.log(
          `ℹ️ [DATABASE] skipping restoration for active room ${dr.roomId}`,
        );
        return;
      }

      // Need to convert Mongoose Doc to Plain JS Object fully
      const roomObj = dr.toObject();

      // Fix: Deep sanitize fields to prevent Mongoose CastErrors
      if (roomObj.players)
        roomObj.players = new DocumentArray(deepSanitizePlayers(roomObj.players));
      if (roomObj.teams)
        roomObj.teams = new DocumentArray(deepSanitizeTeams(roomObj.teams));
      if (roomObj.auctionQueue)
        roomObj.auctionQueue = new DocumentArray(deepSanitizePlayers(roomObj.auctionQueue));

      // Restore runtime properties that aren't in DB Schema
      rooms[dr.roomId] = {
        ...roomObj,
        users: [],
        currentBid: 0,
        currentBidder: null,
        currentPlayer: null,
        timer: AUCTION_TIMER_SECONDS,
        timerInterval: null,
        timerPaused: true,
        sellingInProgress: false,
        auctionQueue: roomObj.auctionQueue || [],
        players: roomObj.players, // Now sanitized
        auctionIndex: roomObj.auctionIndex || 0,
        auctionState: roomObj.auctionState || "LOBBY",
        // Mark as active if auction is ongoing
        state: {
          isActive:
            roomObj.auctionState === "AUCTION" ||
            roomObj.auctionState === "BLIND_AUCTION",
        },
        playerNames: roomObj.playerNames || {},
        squads: roomObj.squads || {},
        chatHistory: roomObj.chatHistory || [],
        tradeRequests: roomObj.tradeRequests || [],
        tradeHistory: roomObj.tradeHistory || [],

        // Initialize blind auction state if it's a blind room
        blindAuction:
          roomObj.gameType === "blind"
            ? {
                exchangeEnabled: true,
                bidTimer: 12,
                exchangeTimer: 10,
                currentBids: {},
                currentPlayer: null,
                timerInterval: null,
                requests: {},
                isContestActive: false,
                contestBids: {},
              }
            : undefined,
      };
    });
    console.log(`✅ Restored ${dbRooms.length} rooms from database.`);
  } catch (e) {
    console.error("Failed to restore rooms:", e);
  }
}
// loadRoomsFromDB(); // Moved to connectMongoDB success callback

// Helper to save room to DB
async function saveRoomToDB(roomId, delayed = false) {
  // Skip if MongoDB is not connected
  if (mongoose.connection.readyState !== 1) return;

  const r = rooms[roomId];
  if (!r) return;

  // If delayed save requested (to batch updates)
  if (delayed) {
    if (r.saveTimeout) clearTimeout(r.saveTimeout);
    r.saveTimeout = setTimeout(() => saveRoomToDB(roomId), 2000);
    return;
  }

  try {
    // Clone and sanitize for DB
    const roomData = {
      roomId: r.roomId,
      password: r.password,
      config: r.config,
      gameType: r.gameType || "normal",
      teams: r.teams,
      adminSocketId: r.adminSocketId,
      adminPlayerId: r.adminPlayerId,
      auctionQueue: r.auctionQueue,
      auctionIndex: r.auctionIndex,
      // players: r.players, // Current players list status
      auctionState: r.auctionState,
      currentLotIndex: r.currentLotIndex,
      currentSetIndex: r.currentSetIndex,
      sets: r.sets,
      playerNames: r.playerNames,
      squads: r.squads,
      chatHistory: r.chatHistory || [],
      tradeRequests: r.tradeRequests || [],
      tradeHistory: r.tradeHistory || [],
      lastActivity: new Date(),
    };

    // Fix: Deep sanitize fields before DB save
    roomData.players = deepSanitizePlayers(r.players);
    roomData.teams = deepSanitizeTeams(r.teams);
    roomData.auctionQueue = deepSanitizePlayers(r.auctionQueue);

    // Upsert: Update if exists, Insert if new
    await Room.findOneAndUpdate({ roomId }, roomData, {
      upsert: true,
      new: true,
    });
  } catch (e) {
    console.error(`Error saving room ${roomId} to DB:`, e.message);
  }
}

// 🧹 AUTO-CLEANUP INACTIVE ROOMS (Store for 5 days)
setInterval(
  async () => {
    const FIVE_DAYS = 5 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    // 1. Clean Memory (Unload from RAM if inactive for 4 hours, but keep in DB)
    for (const roomId in rooms) {
      const r = rooms[roomId];
      const lastActive = new Date(r.lastActive).getTime();
      if (typeof now === "number" && typeof lastActive === "number" && now - lastActive > 4 * 60 * 60 * 1000) {
        console.log(`🧹 Unloading inactive room from memory: ${roomId}`);
        await saveRoomToDB(roomId);
        delete rooms[roomId];
      }
    }

    // 2. Archive DB (Mark as completed if sitting in DB for > 5 days without activity)
    try {
      const cutoff = new Date(Date.now() - FIVE_DAYS);
      const result = await Room.updateMany(
        {
          lastActivity: { $lt: cutoff },
          completedAt: { $exists: false },
        },
        {
          $set: {
            completedAt: new Date(),
            auctionState: "CLOSED",
          },
        },
      );
      if (result.modifiedCount > 0) {
        console.log(`📦 Archived ${result.modifiedCount} old rooms.`);
      }
    } catch (e) {
      console.error("Error in DB cleanup:", e);
    }
  },
  60 * 60 * 1000,
); // Run every hour

// Function kept for backward compatibility but modified to NOT delete
function scheduleRoomCleanup(roomId) {
  console.log(
    `ℹ️ Room ${roomId} finished. It will be stored in MongoDB for 5 days.`,
  );
  // We no longer delete immediately. MongoDB TTL will handle it after 5 days.
}

// --- TIMER LOGIC ---
// --- TIMER LOGIC ---
function startTimer(roomId) {
  const r = rooms[roomId];
  if (!r) return;

  // New Bid or Next Lot
  if (r.timerInterval && r.timer > AUCTION_TIMER_SECONDS - 2) return; // Debounce
  r.timer = AUCTION_TIMER_SECONDS;

  // Clear existing interval to avoid duplicates
  if (r.timerInterval) clearInterval(r.timerInterval);

  r.timerPaused = false;
  r.timerEndTime = Date.now() + r.timer * 1000; // Fix for sync

  // Notify clients
  io.to(roomId).emit("timer_tick", r.timer);
  io.to(roomId).emit("timer_status", false);

  // Use simple decrement to allow easy pausing without complexity
  r.timerInterval = setInterval(() => {
    if (r.timerPaused) {
      r.timerEndTime = Date.now() + r.timer * 1000; // Adjust end time while paused
      return;
    }

    r.timer--;

    io.to(roomId).emit("timer_tick", r.timer);

    // Check Sale
    if (r.timer <= 0) {
      processSale(roomId);
    }
  }, 1000);
}

function stopTimer(roomId) {
  const r = rooms[roomId];
  if (r && r.timerInterval) {
    clearInterval(r.timerInterval);
    r.timerInterval = null;
  }
}

function processSale(roomId, source = "UNKNOWN") {
  const r = rooms[roomId];
  if (!r || !r.currentPlayer || r.sellingInProgress) return;

  r.sellingInProgress = true;
  stopTimer(roomId);
  io.to(roomId).emit("timer_ended");

  let soldPrice = 0;
  let soldTeamName = null;
  let isUnsold = true;

  if (r.currentBidder) {
    const team = r.teams.find((t) => t.bidKey === r.currentBidder);
    if (team) {
      soldPrice = r.currentBid;
      team.roster.push({
        ...r.currentPlayer,
        price: soldPrice,
        status: "SOLD",
      });
      team.totalSpent += soldPrice;
      team.totalPlayers += 1;
      team.budget -= soldPrice;
      soldTeamName = team.name;
      isUnsold = false;

      // Analytics & Predict Game
      analytics.trackSale(roomId, {
        player: r.currentPlayer,
        price: soldPrice,
        teamName: team.name,
        teamId: team.bidKey,
      });
    }
  }

  r.currentPlayer.status = isUnsold ? "UNSOLD" : "SOLD";
  r.currentPlayer.soldPrice = soldPrice;

  io.to(roomId).emit("sale_finalized", {
    soldPlayer: r.currentPlayer,
    isUnsold: isUnsold,
    soldDetails: { soldTeam: soldTeamName },
    price: soldPrice,
    updatedTeams: r.teams,
  });

  r.auctionIndex++;

  setTimeout(() => {
    rooms[roomId].sellingInProgress = false;
    saveRoomToDB(roomId);
    startNextLot(roomId);
  }, 4000);
}

function startNextLot(roomId) {
  const r = rooms[roomId];
  if (!r) return;

  if (r.auctionIndex >= r.auctionQueue.length) {
    r.state.isActive = false;
    r.auctionState = "SQUAD_SELECTION";
    saveRoomToDB(roomId);
    io.to(roomId).emit("open_squad_selection", { teams: r.teams });
    return;
  }

  r.currentPlayer = r.auctionQueue[r.auctionIndex];

  if (r.currentPlayer.status) {
    r.auctionIndex++;
    startNextLot(roomId);
    return;
  }

  r.currentBid = r.currentPlayer.basePrice;
  r.currentBidder = null;
  r.sellingInProgress = false;

  io.to(roomId).emit("update_lot", {
    player: r.currentPlayer,
    currentBid: r.currentBid,
    lotNumber: r.auctionIndex + 1,
  });

  // Start fresh timer
  startTimer(roomId, false);
}

// --- AUTH MIDDLEWARE ---
io.use((socket, next) => {
  const playerId = socket.handshake.auth.playerId;
  socket.playerId = playerId || `guest_${socket.id}`;
  next();
});

// --- SOCKET HANDLERS ---
io.on("connection", (socket) => {
  console.log(`User Connected: ${socket.id} (PID: ${socket.playerId})`);

  socket.on("pingServer", () => socket.emit("pongServer"));

  const ip =
    socket.handshake.headers["x-forwarded-for"] || socket.handshake.address;
  console.log(`[CONN] ${socket.id} (${socket.playerId}) IP: ${ip}`);

  socket.on("submit_squads", async (data) => {
    // data contains { teamA: [...], teamB: [...] }
    const matchResult = await AI.simulateMatch(data.teamA, data.teamB);

    // Send the result ONLY to the players in this specific session/room
    const roomId = getRoomId(socket);
    if (roomId) {
      io.to(roomId).emit("display_result", matchResult);
    } else {
      socket.emit("display_result", matchResult);
    }
  });

  // --- NEW FEATURES: INTEGRATION HANDLERS ---

  // 🔍 GET ACTIVE GAMES FOR USER (DASHBOARD)
  socket.on("get_my_active_games", async (userData) => {
    try {
      // Allow searching by email or playerId (for guests or different auth methods)
      const userEmail = userData.email;
      const playerId = userData.id || socket.playerId || "unknown";

      if (!userEmail && !playerId) {
        socket.emit("active_games_list", []);
        return;
      }

      // 🛡️ Guard: Ensure DB is connected
      if (mongoose.connection.readyState !== 1) {
        console.warn(
          `⏳ DB not ready for get_my_active_games (readyState: ${mongoose.connection.readyState})`,
        );
        socket.emit("active_games_list", []);
        return;
      }

      console.log(`🔍 Searching active games for: ${userEmail} / ${playerId}`);

      // Query DB for active rooms involving this user
      // We look for rooms where auctionState is NOT completed ('RESULTS' usually end state,
      // but let's check completedAt for sure)

      const query = {
        $or: [
          { "teams.ownerEmail": userEmail },
          { "teams.ownerPlayerId": playerId },
          { "teams.playerEmail": userEmail }, // Sometimes stored here
        ],
        completedAt: { $exists: false }, // Only incomplete games
        auctionState: { $ne: "RESULTS" }, // Double check state
      };

      const activeRooms = await Room.find(query)
        .select("roomId gameType auctionState teams createdAt lastActivity")
        .sort({ lastActivity: -1 })
        .limit(5);

      // Map to simplified object for frontend
      const gamesList = activeRooms.map((r) => {
        // Find user's specific team in this room
        const team = r.teams.find(
          (t) =>
            (userEmail && t.ownerEmail === userEmail) ||
            (playerId && t.ownerPlayerId === playerId) ||
            (userEmail && t.playerEmail === userEmail),
        );

        return {
          roomId: r.roomId,
          gameType: r.gameType || "normal", // Default to IPL/Normal
          state: r.auctionState,
          teamName: team ? team.name : "Unknown",
          teamId: team ? team.bidKey : null,
          lastActive: r.lastActivity,
        };
      });

      console.log(`✅ Found ${gamesList.length} active games for user.`);
      socket.emit("active_games_list", gamesList);
    } catch (e) {
      console.error("❌ Error fetching active games:", e);
      socket.emit("active_games_list", []);
    }
  });

  // � GET COMPLETED GAMES FOR USER
  socket.on("get_my_completed_games", async (userData) => {
    try {
      const userEmail = userData.email;
      const playerId = userData.id || socket.playerId || "unknown";

      if (!userEmail && !playerId) {
        socket.emit("completed_games_list", []);
        return;
      }

      // 🛡️ Guard: Ensure DB is connected
      if (mongoose.connection.readyState !== 1) {
        console.warn(
          `⏳ DB not ready for get_my_completed_games (readyState: ${mongoose.connection.readyState})`,
        );
        socket.emit("completed_games_list", []);
        return;
      }

      console.log(
        `📜 Searching COMPLETED games for: ${userEmail} / ${playerId}`,
      );

      const query = {
        $or: [
          { "teams.ownerEmail": userEmail },
          { "teams.ownerPlayerId": playerId },
          { "teams.playerEmail": userEmail },
        ],
        completedAt: { $exists: true }, // ONLY completed games
      };

      const completedRooms = await Room.find(query)
        .select(
          "roomId gameType auctionState teams createdAt completedAt lastActivity",
        )
        .sort({ completedAt: -1 })
        .limit(10); // More history for completed ones

      const gamesList = completedRooms.map((r) => {
        const team = r.teams.find(
          (t) =>
            (userEmail &&
              (t.ownerEmail === userEmail || t.playerEmail === userEmail)) ||
            (playerId && t.ownerPlayerId === playerId),
        );

        return {
          roomId: r.roomId,
          gameType: r.gameType || "normal",
          state: r.auctionState,
          teamName: team ? team.name : "Unknown",
          teamId: team ? team.bidKey : null,
          finishedAt: r.completedAt,
        };
      });

      socket.emit("completed_games_list", gamesList);
    } catch (e) {
      console.error("❌ Error fetching completed games:", e);
      socket.emit("completed_games_list", []);
    }
  });

  // �🗑️ DISMISS ACTIVE GAME (Remove from list/MongoDB)
  socket.on("dismiss_active_game", async (data) => {
    try {
      const { roomId, email, playerId } = data;
      const r = rooms[roomId];

      console.log(
        `🗑️ Dismiss request for room ${roomId} by ${email || playerId}`,
      );

      if (r) {
        // Find team owned by user
        const team = r.teams.find(
          (t) =>
            (email && t.ownerEmail === email) ||
            (playerId && t.ownerPlayerId === playerId) ||
            (email && t.playerEmail === email),
        );

        if (team) {
          console.log(`   Removing ownership for team: ${team.name}`);
          team.isTaken = false;
          team.ownerSocketId = null;
          team.ownerEmail = null; // Clear ownership
          team.ownerPlayerId = null;
          team.playerEmail = null;
          team.playerName = null;

          saveRoomToDB(roomId);
          io.to(roomId).emit("lobby_update", {
            teams: r.teams,
            userCount: r.users.length,
          });
        }
      }

      // Also update MongoDB directly
      const roomDoc = await Room.findOne({ roomId: roomId });
      if (roomDoc) {
        let updated = false;
        roomDoc.teams.forEach((t) => {
          if (
            (email && t.ownerEmail === email) ||
            (playerId && t.ownerPlayerId === playerId) ||
            (email && t.playerEmail === email)
          ) {
            t.isTaken = false;
            t.ownerSocketId = null;
            t.ownerEmail = null;
            t.ownerPlayerId = null;
            t.playerEmail = null;
            t.playerName = null;
            updated = true;
          }
        });
        if (updated) {
          await roomDoc.save();
          console.log("   ✅ Dismissed in MongoDB.");
        }
      }

      socket.emit("game_dismissed_success", roomId);
    } catch (e) {
      console.error("❌ Error dismissing game:", e);
    }
  });

  // 🚀 RESUME GAME (Direct Join Bypass)
  socket.on("resume_game", ({ roomId, email, playerId }) => {
    console.log(`🚀 RESUME REQUEST: ${roomId} for ${email || playerId}`);

    const r = rooms[roomId];
    if (!r) {
      console.log("   ⚠️ Room not in memory. Failing resume.");
      socket.emit("resume_failed", "Room inactive.");
      return;
    }

    // Verify User is Owner/Player
    const team = r.teams.find(
      (t) =>
        (email && t.ownerEmail === email) ||
        (playerId && t.ownerPlayerId === playerId) ||
        (email && t.playerEmail === email),
    );

    let isAdminUser = r.adminPlayerId === playerId;

    if (team || isAdminUser) {
      console.log(`   ✅ User verified. Joining room directly.`);
      socket.join(roomId);
      if (!r.users.includes(socket.id)) r.users.push(socket.id);

      // ✨ Update Admin if re-joining
      if (r.adminPlayerId === playerId) {
        r.adminSocketId = socket.id;
        isAdminUser = true; // Ensure consistency
      }

      // Reclaim logic
      if (team) {
        team.ownerSocketId = socket.id;

        // Set essential socket properties for chat/trade center
        socket.teamId = team.bidKey;
        socket.teamName = team.name;
        socket.userId = playerId;

        socket.emit("team_claim_success", team.bidKey);
      } else if (isAdminUser) {
        socket.userId = playerId; // Admin has no team but needs userId
      }

      saveRoomToDB(roomId); // Update lastActive

      io.to(roomId).emit("lobby_update", {
        teams: r.teams,
        userCount: r.users.length,
      });

      socket.emit("room_joined", {
        roomId: roomId,
        isAdmin: isAdminUser,
        playerId: playerId,
        state: {
          isActive: r.state.isActive,
          teams: r.teams,
          queue: r.auctionQueue,
        },
        lobbyState: {
          teams: r.teams,
          userCount: r.users.length,
        },
        config: r.config,
        chatHistory: r.chatHistory || [],
      });

      // Handle mid-tournament states
      if (r.auctionState === "SQUAD_SELECTION") {
        socket.emit("open_squad_selection", { teams: r.teams });
      } else if (r.auctionState === "RESULTS" && r.lastTournamentResults) {
        socket.emit("tournamentComplete", r.lastTournamentResults);
      }
    } else {
      console.log("   ❌ User is not part of this room.");
      socket.emit("resume_failed", "Not a participant.");
    }
  });

  // Trade System Handlers
  socket.on("create_trade_request", (data) => {
    const roomId = getRoomId(socket);
    if (roomId) tradeSystem.createTradeRequest(socket, roomId, data);
  });

  socket.on("create_complex_trade", (data) => {
    const roomId = getRoomId(socket);
    if (roomId) tradeSystem.createComplexTrade(socket, roomId, data);
  });

  socket.on("submit_proposal", (data) => {
    const roomId = getRoomId(socket);
    if (!roomId) return;

    // 1. Direct Trade Creation (Target Team Specified)
    if (data.targetTeam) {
      const complexTradeData = {
        targetTeamId: data.targetTeam,
        offeredPlayerNames: data.details.offeredPlayerNames || [],
        requestedPlayerNames: data.details.requestedPlayerNames || [],
        offeredCash: data.details.offeredCash || 0,
        requestedCash: data.details.requestedCash || 0,
        message: data.details.message,
      };
      tradeSystem.createComplexTrade(socket, roomId, complexTradeData);
    }
    // 2. New Market Request (Broadcast)
    else if (data.type === "MARKET_REQUEST") {
      tradeSystem.createTradeRequest(socket, roomId, data);
    }
    // 3. Response/Proposal to Existing Request
    else {
      tradeSystem.submitProposal(socket, roomId, data);
    }
  });

  socket.on("accept_proposal", (data) => {
    const roomId = getRoomId(socket);
    if (roomId) tradeSystem.acceptProposal(socket, roomId, data);
  });

  socket.on("reject_proposal", (data) => {
    const roomId = getRoomId(socket);
    if (roomId) tradeSystem.rejectProposal(socket, roomId, data);
  });

  socket.on("respond_to_proposal", (data) => {
    const roomId = getRoomId(socket);
    if (roomId) {
      // Handle both new format with tradeInfo and legacy format
      if (data.status === "accepted") {
        tradeSystem.acceptProposal(
          socket,
          roomId,
          { proposalId: data.proposalId },
          data.tradeInfo,
        );
      } else if (data.status === "rejected") {
        tradeSystem.rejectProposal(
          socket,
          roomId,
          { proposalId: data.proposalId },
          data.tradeInfo,
        );
      } else if (data.status === "cancelled") {
        tradeSystem.rejectProposal(
          socket,
          roomId,
          { proposalId: data.proposalId },
          data.tradeInfo,
        );
      }
    }
  });

  socket.on("get_trade_state", () => {
    const roomId = getRoomId(socket);
    if (roomId) tradeSystem.getTradeState(socket, roomId);
  });

  socket.on("init_trade_system", () => {
    const roomId = getRoomId(socket);
    if (roomId) tradeSystem.getTradeState(socket, roomId);
  });

  socket.on("request_trade_history", () => {
    const roomId = getRoomId(socket);
    if (roomId) tradeSystem.getTradeState(socket, roomId);
  });

  // Achievements
  socket.on("get_achievements", (data) => {
    achievements.getUserAchievements(socket, data.userId);
  });

  // Analytics
  socket.on("get_analytics", () => {
    const roomId = getRoomId(socket);
    if (roomId) analytics.getAnalytics(socket, roomId);
  });

  // Track events
  socket.on("client_player_sold", (data) => {
    const roomId = getRoomId(socket);
    if (!roomId) return;
    analytics.trackSale(roomId, data);
    achievements.checkAchievements(socket.playerId, "player_sold", data);
  });

  socket.on("client_bid_placed", (data) => {
    const roomId = getRoomId(socket);
    if (roomId) analytics.trackBid(roomId, data);
  });

  // --- LIVE MATCH SYSTEM ---
  socket.on("send_match_challenge", (data) => {
    const roomId = getRoomId(socket);
    if (roomId) liveMatch.handleMatchChallenge(socket, { ...data, roomId });
  });

  socket.on("respond_match_challenge", (data) => {
    const roomId = getRoomId(socket);
    if (roomId) liveMatch.handleChallengeResponse(socket, { ...data, roomId });
  });

  socket.on("match_toss_select", (data) => {
    liveMatch.handleTossSelection(socket, data);
  });

  socket.on("match_toss_decision", (data) => {
    liveMatch.handleTossDecision(socket, data);
  });

  socket.on("match_player_select", (data) => {
    liveMatch.handlePlayerSelection(socket, data);
  });

  socket.on("match_next_ball", (data) => {
    liveMatch.simulateBall(socket, data);
  });

  // Placeholder for any other specific simulation-related emissions if needed
  // Note: Combined with the general request_tournament_data handler below

  // 1. CREATE ROOM
  socket.on("create_room", async ({ roomId, password, config, playerName }) => {
    // Check if room exists in memory
    if (rooms[roomId]) {
      console.log(
        `❌ Create Room failed: Room ${roomId} already active in memory.`,
      );
      return socket.emit(
        "error_message",
        "Room already exists! Please use a different ID.",
      );
    }

    // CHECK DATABASE: Ensure room ID is not taken globally
    try {
      const dbExists = await Room.exists({ roomId });
      if (dbExists) {
        console.log(
          `❌ Create Room failed: Room ${roomId} exists in database.`,
        );
        return socket.emit(
          "error_message",
          "Room ID already taken! Please use a different ID.",
        );
      }
    } catch (dbErr) {
      console.error("DB Check failed in create_room:", dbErr);
    }

    console.log(
      `🏠 Creating new room: ${roomId} (PID: ${socket.playerId}, Name: ${playerName})`,
    );

    rooms[roomId] = {
      roomId, // Ensure roomId is stored
      password,
      config,
      users: [],
      teams: [],
      auctionQueue: [],
      auctionIndex: 0,
      currentBid: 0,
      currentBidder: null,
      currentPlayer: null,
      timer: AUCTION_TIMER_SECONDS,
      timerInterval: null,
      timerPaused: true,
      state: { isActive: false },
      auctionState: "LOBBY",
      adminSocketId: socket.id,
      adminPlayerId: socket.playerId,
      sellingInProgress: false,
      squads: {},
      playerNames: {}, // Store player names
    };
    socket.join(roomId);
    rooms[roomId].users.push(socket.id);

    // Store player name
    if (playerName) {
      rooms[roomId].playerNames[socket.playerId] = playerName;
    }

    // Save to DB
    saveRoomToDB(roomId);

    socket.emit("roomcreated", roomId);
  });

  // 2. JOIN ROOM
  socket.on("join_room", async ({ roomId, password, playerName }) => {
    // 1. Persistence Check (Restore if missing from memory)
    // Persistence check removed. New game only.

    const r = rooms[roomId];
    if (!r) {
      console.log(`❌ Join attempt failed: Room ${roomId} not found.`);
      return socket.emit("error_message", "Room not found!");
    }

    console.log(
      `📡 Player ${socket.playerId} (${playerName || "Unknown"}) attempting to join room ${roomId}`,
    );

    // Standard password check (No reconnection logic)
    const rPassword = r.password || r.roomPassword;
    if (rPassword && rPassword !== password) {
      console.log(
        `❌ Invalid password for room: ${roomId}. PID: ${socket.playerId}`,
      );
      return socket.emit("error_message", "Invalid Password");
    }

    socket.join(roomId);
    if (!r.users.includes(socket.id)) r.users.push(socket.id);

    // Store player name
    if (playerName) {
      if (!r.playerNames) r.playerNames = {};
      r.playerNames[socket.playerId] = playerName;
    }

    let isAdminReconnected = false;
    if (r.adminPlayerId === socket.playerId) {
      r.adminSocketId = socket.id;
      isAdminReconnected = true;
    }

    // --- NEW: Persistent Identity for Teams (Hidden Bug Fix) ---
    const myTeam = r.teams.find((t) => t.ownerPlayerId === socket.playerId);
    if (myTeam) {
      myTeam.ownerSocketId = socket.id;
      socket.teamId = myTeam.bidKey;
      socket.teamName = myTeam.name;
      socket.userId = socket.playerId;
      console.log(
        `📡 Linked team ${myTeam.name} to reconnected socket ${socket.id}`,
      );
    }

    socket.emit("room_joined", {
      roomId,
      isAdmin: isAdminReconnected,
      lobbyState: { teams: r.teams, userCount: r.users.length },
      state: {
        isActive: r.state.isActive,
        teams: r.teams,
        queue: r.auctionQueue,
      },
      chatHistory: r.chatHistory || [],
    });

    saveRoomToDB(roomId);

    io.to(roomId).emit("lobby_update", {
      teams: r.teams,
      userCount: r.users.length,
    });

    if (r.auctionState === "SQUAD_SELECTION") {
      socket.emit("open_squad_selection", { teams: r.teams });
    } else if (r.auctionState === "RESULTS" && r.lastTournamentResults) {
      socket.emit("tournamentComplete", r.lastTournamentResults);
    }
  });

  socket.on("request_sync", () => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (r) {
      if (r.gameType === "blind") {
        // Blind Auction Sync
        let remaining = r.blindAuction.timer || 0;
        if (!r.timerPaused && r.blindAuction.timerEndTime) {
          remaining = Math.ceil(
            (r.blindAuction.timerEndTime - Date.now()) / 1000,
          );
          if (remaining < 0) remaining = 0;
        }

        socket.emit("sync_data", {
          teams: r.teams,
          queue: r.auctionQueue,
          auctionIndex: r.auctionIndex,
          currentLot: r.blindAuction.currentPlayer, // Use blind auction player
          currentBid: 0, // Hidden
          currentBidder: null,
          timer: remaining,
          timerPaused: r.timerPaused,
          isActive: r.state.isActive,
          gameType: "blind",
          // Add extra state info if needed
          blindState: {
            exchangeActive: r.blindAuction.isContestActive,
            winner: r.blindAuction.winner,
          },
        });
      } else {
        // Normal Auction Sync
        let remaining = r.timer;
        if (!r.timerPaused && r.timerEndTime) {
          remaining = Math.ceil((r.timerEndTime - Date.now()) / 1000);
          if (remaining < 0) remaining = 0;
        }

        socket.emit("sync_data", {
          teams: r.teams,
          queue: r.auctionQueue,
          auctionIndex: r.auctionIndex,
          currentLot: r.currentPlayer,
          currentBid: r.currentBid,
          currentBidder: r.currentBidder,
          timer: remaining,
          timerPaused: r.timerPaused,
          isActive: r.state.isActive,
          gameType: "normal",
        });
      }
    }
  });

  socket.on("update_lobby_teams", (teams) => {
    const roomId = getRoomId(socket);
    if (!isAdmin(socket)) return;
    if (rooms[roomId]) {
      rooms[roomId].teams = teams;
      io.to(roomId).emit("lobby_update", {
        teams,
        userCount: rooms[roomId].users.length,
      });
    }
  });

  socket.on("claim_lobby_team", ({ key, email }) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (!r) return;
    const existingTeam = r.teams.find(
      (t) => t.ownerPlayerId === socket.playerId,
    );

    if (existingTeam) {
      // User already has a team
      if (existingTeam.bidKey === key) {
        // Trying to claim the same team again - just confirm ownership
        existingTeam.ownerSocketId = socket.id;
        if (email) existingTeam.playerEmail = email;
        // Set socket properties for trade system
        socket.teamId = existingTeam.bidKey;
        socket.teamName = existingTeam.name;
        socket.userId = socket.playerId;
        socket.emit("team_claim_success", key);
        return;
      } else {
        // Trying to claim a different team - BLOCKED
        return socket.emit(
          "error_message",
          `You already own ${existingTeam.name}! Cannot switch teams.`,
        );
      }
    }

    // User doesn't have a team yet - allow claiming
    const t = r.teams.find((x) => x.bidKey === key);

    if (!t) {
      return socket.emit("error_message", "Team not found!");
    }

    if (t.isTaken && t.ownerPlayerId !== socket.playerId) {
      return socket.emit(
        "error_message",
        `${t.name} is already taken by another player!`,
      );
    }

    // Claim the team
    // The condition `if (t && !t.isTaken)` is implicitly handled by the checks above.
    // If we reach here, `t` exists and is either not taken or taken by the current player (which is handled by existingTeam check).
    // So, we proceed with claiming if it's not taken by someone else.
    t.isTaken = true;
    t.ownerSocketId = socket.id;
    t.ownerName = r.playerNames[socket.playerId] || "Unknown"; // Add ownerName
    t.ownerPlayerId = socket.playerId; // Save for reconnection

    // Attach player name to team
    if (r.playerNames && r.playerNames[socket.playerId]) {
      t.playerName = r.playerNames[socket.playerId];
    }

    // Store player email for profile tracking
    if (email) {
      t.playerEmail = email;
      t.ownerEmail = email; // Ensure ownerEmail is set for dashboard
    }

    // Set socket properties for trade system
    socket.teamId = t.bidKey;
    socket.teamName = t.name;
    socket.userId = socket.playerId;

    socket.emit("team_claim_success", key);
    saveRoomToDB(roomId);
    io.to(roomId).emit("lobby_update", {
      teams: r.teams,
      userCount: r.users.length,
    });
  });

  // ✨ RECLAIM TEAM (Auto-Join Logic)
  socket.on("reclaim_team", (key) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (!r) return;

    const t = r.teams.find((x) => x.bidKey === key);
    if (t && t.ownerPlayerId === socket.playerId) {
      t.ownerSocketId = socket.id;
      socket.teamId = t.bidKey;
      socket.teamName = t.name;
      socket.userId = socket.playerId;
      socket.emit("team_claim_success", key);
      console.log(`✅ ${socket.playerId} reclaimed ${t.name} in ${roomId}`);
    }
  });

  socket.on("request_reclaim_manual", ({ teamKey }) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (!r) return;

    const targetTeam = r.teams.find((t) => t.bidKey === teamKey);
    if (!targetTeam) return;

    if (r.adminSocketId) {
      io.to(r.adminSocketId).emit("admin_reclaim_request", {
        teamKey: teamKey,
        teamName: targetTeam.name,
        requesterId: socket.id,
        requesterPid: socket.playerId,
      });
    }
  });

  socket.on(
    "admin_reclaim_decision",
    ({ approved, teamKey, requesterId, requesterPid }) => {
      const roomId = getRoomId(socket);
      const r = rooms[roomId];
      if (!r || !isAdmin(socket)) return;

      if (approved) {
        const team = r.teams.find((t) => t.bidKey === teamKey);
        if (team) {
          team.ownerSocketId = requesterId;
          team.ownerPlayerId = requesterPid;
          io.to(requesterId).emit("team_claim_success", teamKey);
          io.to(roomId).emit("lobby_update", {
            teams: r.teams,
            userCount: r.users.length,
          });
        }
      } else {
        io.to(requesterId).emit(
          "error_message",
          "Host denied your reclaim request.",
        );
      }
    },
  );

  socket.on("admin_rename_team", ({ key, newName }) => {
    const roomId = getRoomId(socket);
    if (!isAdmin(socket)) return;
    const t = rooms[roomId].teams.find((x) => x.bidKey === key);
    if (t) t.name = newName;
    io.to(roomId).emit("lobby_update", {
      teams: rooms[roomId].teams,
      userCount: rooms[roomId].users.length,
    });
  });

  socket.on("admin_auto_test", ({ rcb, csk }) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];

    if (!r || !isAdmin(socket)) return;

    const takenTeams = r.teams.filter((t) => t.isTaken);

    if (takenTeams.length === 0) {
      return socket.emit("error_message", "No active teams joined yet!");
    }

    // 1. Assign Rosters
    if (takenTeams[0]) {
      takenTeams[0].roster = rcb;
      takenTeams[0].totalPlayers = rcb.length;
      const spent = rcb.reduce((sum, p) => sum + (p.price || 0), 0);
      takenTeams[0].totalSpent = spent;
      takenTeams[0].budget = (r.config?.budget || 1000000000) - spent;
      console.log(
        `Auto-assigned RCB roster to ${takenTeams[0].name}. Spent: ${spent}`,
      );
    }

    if (takenTeams[1]) {
      takenTeams[1].roster = csk;
      takenTeams[1].totalPlayers = csk.length;
      const spent = csk.reduce((sum, p) => sum + (p.price || 0), 0);
      takenTeams[1].totalSpent = spent;
      takenTeams[1].budget = (r.config?.budget || 1000000000) - spent;
      console.log(
        `Auto-assigned CSK roster to ${takenTeams[1].name}. Spent: ${spent}`,
      );
    }

    // 2. Ensure they are marked as valid for simulation
    // (start_auction filters by isTaken, so we are good)

    // 3. Sync Updated Rosters to Client
    io.to(roomId).emit("lobby_update", {
      teams: r.teams,
      userCount: r.users.length,
    });

    // 4. Skip to Squad Selection
    r.state.isActive = false;
    io.to(roomId).emit("open_squad_selection", { teams: r.teams }); // Send teams directly as fallback
  });

  socket.on("start_auction", ({ queue }) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (r && isAdmin(socket)) {
      const activeTeams = r.teams.filter((t) => t.isTaken);
      r.teams = activeTeams.map((t) => ({
        ...t,
        roster: [],
        totalSpent: 0,
        totalPlayers: 0,
      }));
      r.auctionQueue = queue;
      r.state.isActive = true;
      r.auctionState = "AUCTION";
      saveRoomToDB(roomId);
      io.to(roomId).emit("auction_started", {
        teams: r.teams,
        queue: r.auctionQueue,
      });
      startNextLot(roomId);
    }
  });

  socket.on("place_bid", ({ teamKey, amount }) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (
      !r ||
      !r.state.isActive ||
      r.timerPaused ||
      r.sellingInProgress ||
      !r.currentPlayer
    )
      return;

    const team = r.teams.find((t) => t.bidKey === teamKey);
    if (!team) return;

    if (team.ownerSocketId !== socket.id) {
      if (team.ownerPlayerId === socket.playerId) {
        team.ownerSocketId = socket.id;
      } else {
        return socket.emit("error_message", "Authorization Failed");
      }
    }

    if (r.currentBidder === teamKey) return;
    if (team.budget < amount) return socket.emit("error_message", "No Budget!");
    if (amount <= r.currentBid && r.currentBidder)
      return socket.emit("error_message", "Bid too low!");

    r.currentBid = amount;
    r.currentBidder = teamKey;

    saveRoomToDB(roomId, true);
    io.to(roomId).emit("bid_update", { amount, team });
    startTimer(roomId);
  });

  socket.on("toggle_timer", () => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (r && isAdmin(socket)) {
      r.timerPaused = !r.timerPaused;
      io.to(roomId).emit("timer_status", r.timerPaused);
    }
  });

  socket.on("finalize_sale", () => {
    const roomId = getRoomId(socket);
    if (isAdmin(socket)) {
      processSale(roomId, "ADMIN");
    }
  });

  // 🪄 AUTO WIN (Admin Instant Claim)
  socket.on("auto_win_bid", () => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (!r || !isAdmin(socket) || !r.currentPlayer) return;

    // Find admin's team
    const adminTeam = r.teams.find((t) => t.ownerPlayerId === socket.playerId);
    if (!adminTeam)
      return socket.emit("error_message", "You need to join a team first!");

    // Force bid
    const nextBid = r.currentBidder
      ? r.currentBid + (r.config.increment || 2500000)
      : r.currentPlayer.basePrice;

    if (adminTeam.budget < nextBid)
      return socket.emit("error_message", "Insufficient Budget!");

    r.currentBid = nextBid;
    r.currentBidder = adminTeam.bidKey;

    // Instantly process sale
    processSale(roomId, "AUTO_WIN");
  });

  socket.on("end_auction_trigger", () => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (isAdmin(socket) && r) {
      stopTimer(roomId);
      r.state.isActive = false;
      r.auctionState = "SQUAD_SELECTION";
      saveRoomToDB(roomId);
      io.to(roomId).emit("open_squad_selection");
    }
  });

  // ⚡ FAST FINISH (Skip to Scorecard)
  socket.on("force_fast_finish", () => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (isAdmin(socket) && r) {
      console.log(`⚡ Fast Finishing Room ${roomId}`);
      stopTimer(roomId);
      r.state.isActive = false;
      r.auctionState = "SIMULATING";

      // Auto-fill squads for all active teams if empty
      const activeTeams = r.teams.filter((t) => t.isTaken);
      activeTeams.forEach((t) => {
        if (!r.squads[t.bidKey]) {
          // Fallback: use first 11 players from roster or just the roster
          const squad = t.roster.slice(0, 11).map((p) => p.name);
          r.squads[t.bidKey] = {
            squad: squad,
            batImpact: squad[0] || null,
            bowlImpact: squad[1] || null,
            captain: squad[0] || null,
          };
        }
      });

      saveRoomToDB(roomId);
      runSimulationLogic(roomId, r);
    }
  });

  // ⛔ CLOSE ROOM (Manual End / Archive)
  socket.on("close_room", () => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (isAdmin(socket) && r) {
      console.log(`⛔ Manually Closing Room ${roomId}`);
      r.state.isActive = false;
      r.auctionState = "CLOSED";
      r.completedAt = new Date(); // This removes it from Active Sessions list

      saveRoomToDB(roomId);
      io.to(roomId).emit("room_closed");
      io.to(roomId).emit("force_redirect", "dashboard.html"); // Send everyone back
    }
  });

  socket.on(
    "submit_squad",
    ({ teamKey, squad, batImpact, bowlImpact, captain }) => {
      const roomId = getRoomId(socket);
      const r = rooms[roomId];
      if (r) {
        r.squads[teamKey] = { squad, batImpact, bowlImpact, captain };
        io.to(roomId).emit("squad_submission_update", {
          submittedCount: Object.keys(r.squads).length,
          totalTeams: r.teams.filter((t) => t.isTaken).length,
        });

        const activeTeamsCount = r.teams.filter((t) => t.isTaken).length;
        if (Object.keys(r.squads).length === activeTeamsCount) {
          console.log("All squads submitted. Auto-starting simulation...");
          runSimulationLogic(roomId, r);
        }
      }
    },
  );

  socket.on("startTournament", (data) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (r) {
      console.log(
        `🏏 Tournament start requested by ${socket.playerId} in room ${roomId}`,
      );
      runSimulationLogic(roomId, r);
    } else {
      console.log(`⚠️ Cannot start tournament - room ${roomId} not found`);
      socket.emit(
        "simulation_error",
        "Room not found or not properly initialized",
      );
    }
  });

  socket.on("request_tournament_data", async ({ roomId, prompt }) => {
    const rId = roomId || getRoomId(socket);
    const r = rooms[rId];

    if (!r) {
      console.log(`⚠️ Room ${rId} not found for tournament data request`);
      return socket.emit(
        "simulation_error",
        `Room "${rId}" not found. Please ensure the room exists.`,
      );
    }

    // Return cached results if available and no fresh prompt provided
    if (r.lastTournamentResults && !prompt) {
      console.log(`✅ Sending cached tournament results for room ${rId}`);
      return socket.emit("tournament_data_response", {
        tournamentResults: r.lastTournamentResults,
      });
    }

    // Otherwise, trigger simulation (if matches or squads exist)
    try {
      console.log(`🚀 Triggering simulation for room ${rId}...`);
      await runSimulationLogic(rId, r);
    } catch (e) {
      console.error("Simulation failed:", e);
      socket.emit("simulation_error", "Failed to generate simulation results.");
    }
  });

  // Chat Message Handler
  socket.on("chat_message", (data) => {
    const roomId = getRoomId(socket);
    if (roomId && rooms[roomId]) {
      const r = rooms[roomId];
      const chatMsg = {
        playerName: data.playerName,
        message: data.message,
        timestamp: data.timestamp || Date.now(),
        id: data.id || Date.now().toString(),
      };

      // Store in memory
      if (!r.chatHistory) r.chatHistory = [];
      r.chatHistory.push(chatMsg);

      // Keep history manageable (last 50 messages)
      if (r.chatHistory.length > 50) r.chatHistory.shift();

      // Broadcast message to all players in the room
      io.to(roomId).emit("chat_message", chatMsg);

      // Save to DB (delayed)
      saveRoomToDB(roomId, true);
    }
  });

  // Typing Indicators
  socket.on("typing_start", () => {
    const roomId = getRoomId(socket);
    if (roomId) {
      const r = rooms[roomId];
      const name = r?.playerNames?.[socket.playerId] || "Someone";
      socket.to(roomId).emit("user_typing", { userName: name });
    }
  });

  socket.on("typing_stop", () => {
    const roomId = getRoomId(socket);
    if (roomId) {
      socket.to(roomId).emit("user_stopped_typing");
    }
  });

  // Message Reactions
  socket.on("add_reaction", (data) => {
    const roomId = getRoomId(socket);
    if (roomId) {
      io.to(roomId).emit("message_reaction", data);
    }
  });

  // Update Player Name Handler
  socket.on("update_player_name", (data) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (r && data.playerName) {
      if (!r.playerNames) r.playerNames = {};
      r.playerNames[socket.playerId] = data.playerName;

      // Update team if player has already claimed one
      const team = r.teams.find((t) => t.ownerPlayerId === socket.playerId);
      if (team) {
        team.playerName = data.playerName;
        io.to(roomId).emit("lobby_update", {
          teams: r.teams,
          userCount: r.users.length,
        });
      }
    }
  });

  // Voice Chat Signaling
  socket.on("voice_ready", ({ roomId }) => {
    // Notify all other users in the room
    socket.to(roomId).emit("voice_user_ready", { userId: socket.id });
  });

  socket.on("voice_offer", ({ to, offer }) => {
    io.to(to).emit("voice_offer", { from: socket.id, offer });
  });

  socket.on("voice_answer", ({ to, answer }) => {
    io.to(to).emit("voice_answer", { from: socket.id, answer });
  });

  socket.on("voice_ice_candidate", ({ to, candidate }) => {
    io.to(to).emit("voice_ice_candidate", { from: socket.id, candidate });
  });

  socket.on("voice_stopped", ({ roomId }) => {
    socket.to(roomId).emit("voice_user_stopped", { userId: socket.id });
  });

  // Check for active room for auto-reconnect

  // ===================================================================
  // 🎭 BLIND AUCTION HANDLERS
  // ===================================================================

  // Create blind auction room
  socket.on(
    "create_blind_room",
    async ({ roomId, password, playerName, gameType }) => {
      console.log("🎭 CREATE_BLIND_ROOM received:", {
        roomId,
        password,
        playerName,
        gameType,
      });

      let finalRoomId = roomId;

      // Ensure ID is truly unique (Memory + DB)
      let roomCollision =
        !!rooms[finalRoomId] || (await Room.exists({ roomId: finalRoomId }));

      if (roomCollision) {
        console.log(
          `❌ Create Room failed: Room ${finalRoomId} already exists.`,
        );
        return socket.emit(
          "error_message",
          "Room already exists! Please use a different ID.",
        );
      }

      console.log(
        `✅ Creating new blind auction room: ${finalRoomId} for player: ${playerName}`,
      );

      rooms[finalRoomId] = {
        roomId: finalRoomId,
        password,
        gameType: "blind",
        users: [],
        teams: [],
        auctionQueue: [],
        auctionIndex: 0,
        state: { isActive: false },
        adminSocketId: socket.id,
        adminPlayerId: socket.playerId,
        playerNames: {},
        squads: {},

        // Blind auction specific
        blindAuction: {
          exchangeEnabled: true,
          bidTimer: 12,
          exchangeTimer: 10,
          currentBids: {},
          currentPlayer: null,
          timerInterval: null,
          requests: {}, // teamKey -> bool
          isContestActive: false,
          contestBids: {}, // teamKey -> amount
        },
      };

      socket.join(finalRoomId);
      rooms[finalRoomId].users.push(socket.id);

      if (playerName) {
        rooms[finalRoomId].playerNames[socket.playerId] = playerName;
        console.log(
          `   [LOG] Stored admin name: ${playerName} for PID: ${socket.playerId}`,
        );
      }

      saveRoomToDB(finalRoomId);
      console.log(
        `✅ Room ${finalRoomId} created successfully. Emitting 'roomcreated'.`,
      );
      socket.emit("roomcreated", finalRoomId);
    },
  );

  // Join blind auction room
  socket.on("join_blind_room", ({ roomId, password, playerName }) => {
    console.log(
      `🎭 JOIN_BLIND_ROOM request: Room=${roomId}, Player=${playerName}, PID=${socket.playerId}`,
    );

    const r = rooms[roomId];

    if (!r) {
      console.log(`❌ Join failed: Room ${roomId} not found in memory.`);
      return socket.emit("error_message", "Room not found!");
    }

    if (r.password !== password) {
      console.log(`❌ Join failed: Invalid password for ${roomId}.`);
      return socket.emit("error_message", "Invalid password!");
    }

    console.log(`✅ Join authorized for ${roomId}. PID: ${socket.playerId}`);

    socket.join(roomId);
    if (!r.users.includes(socket.id)) r.users.push(socket.id);

    if (playerName) {
      if (!r.playerNames) r.playerNames = {};
      r.playerNames[socket.playerId] = playerName;
      console.log(
        `   [LOG] Stored player name: ${playerName} for PID: ${socket.playerId}`,
      );
    }

    const isAdminReconnected = r.adminPlayerId === socket.playerId;
    if (isAdminReconnected) {
      r.adminSocketId = socket.id;
      console.log("✅ Admin reconnected to room:", roomId);
    }

    // --- NEW: Persistent Identity for Teams (Hidden Bug Fix) ---
    const myTeam = r.teams.find((t) => t.ownerPlayerId === socket.playerId);
    if (myTeam) {
      myTeam.ownerSocketId = socket.id;
      socket.teamId = myTeam.bidKey;
      socket.teamName = myTeam.name;
      socket.userId = socket.playerId;
      console.log(
        `📡 Linked team ${myTeam.name} to reconnected socket ${socket.id} (BLIND)`,
      );
    }

    console.log("✅ Emitting room_joined event");
    socket.emit("room_joined", {
      roomId,
      isAdmin: isAdminReconnected,
      lobbyState: { teams: r.teams, userCount: r.users.length },
    });

    saveRoomToDB(roomId);
    io.to(roomId).emit("lobby_update", {
      teams: r.teams,
      userCount: r.users.length,
    });

    console.log(
      `✅ User joined room ${roomId}. Total users: ${r.users.length}`,
    );
  });

  // Start blind auction
  socket.on("start_blind_auction", ({ exchangeEnabled, queue }) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];

    console.log(
      `🎬 Request to start blind auction in room: ${roomId} by ${socket.id}`,
    );

    if (r && isAdmin(socket)) {
      const activeTeams = r.teams.filter((t) => t.isTaken);

      if (activeTeams.length === 0) {
        console.log("❌ Cannot start: No active teams.");
        return socket.emit("error_message", "No active teams joined!");
      }

      r.teams = activeTeams.map((t) => ({
        ...t,
        roster: [],
        totalSpent: 0,
        totalPlayers: 0,
      }));

      // Use client queue or fallback to test queue
      r.auctionQueue =
        queue && queue.length > 0 ? queue : buildBlindAuctionQueue();
      console.log(`✅ Auction Queue Size: ${r.auctionQueue.length}`);

      r.state.isActive = true;
      r.auctionState = "AUCTION"; // Ensure state is synced
      r.blindAuction.exchangeEnabled = exchangeEnabled;

      saveRoomToDB(roomId);

      io.to(roomId).emit("blind_auction_started", {
        teams: r.teams,
        exchangeEnabled: exchangeEnabled,
        queue: r.auctionQueue, // Send queue to all clients
      });

      console.log(`📢 Emitted 'blind_auction_started' to room ${roomId}`);

      // Start first player
      setTimeout(() => startNextBlindPlayer(roomId), 1000);
    } else {
      console.log("❌ Start failed: Room not found or Not Admin");
      if (!r) socket.emit("error_message", "Room not found (expired?)");
      else if (!isAdmin(socket))
        socket.emit("error_message", "Only Host can start!");
    }
  });

  // Submit sealed bid
  socket.on("submit_blind_bid", ({ teamKey, amount }) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];

    if (!r || !r.state.isActive || !r.blindAuction.currentPlayer) return;

    const team = r.teams.find((t) => t.bidKey === teamKey);
    if (!team) return;

    // Verify ownership
    if (
      team.ownerSocketId !== socket.id &&
      team.ownerPlayerId !== socket.playerId
    ) {
      return socket.emit("error_message", "Authorization Failed");
    }

    // Budget Check
    if (team.budget < amount) {
      return socket.emit("error_message", "Insufficient Budget!");
    }

    // Store bid
    if (!r.blindAuction.currentBids) r.blindAuction.currentBids = {};
    r.blindAuction.currentBids[teamKey] = {
      teamKey: teamKey,
      teamName: team.name,
      amount: amount,
      submitted: true,
      isPassed: amount === 0,
    };

    console.log(`Bid/Pass received from ${team.name}: ₹${amount}`);

    // Check if all teams have bid or passed
    const activeTeams = r.teams.filter((t) => t.isTaken);
    const submittedBids = Object.keys(r.blindAuction.currentBids).length;

    if (submittedBids >= activeTeams.length) {
      // All teams have acted, reveal immediately
      revealBids(roomId);
    }
  });

  // Keep player (no exchange)
  socket.on("keep_player", () => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (!r) return;

    // Finalize sale to current winner
    finalizeSale(roomId);
  });

  // Reject all exchange requests
  socket.on("reject_all_requests", () => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (!r) return;

    console.log(
      `Winner rejected all exchange requests for ${r.blindAuction.currentPlayer.name}`,
    );
    r.blindAuction.requests = {};

    io.to(roomId).emit("exchange_requests_rejected", {
      message: "Winner rejected all offers",
    });

    // Optionally auto-finalize
    // finalizeSale(roomId);
  });

  // Finalize exchange
  socket.on("finalize_exchange", () => {
    const roomId = getRoomId(socket);
    if (isAdmin(socket)) {
      finalizeSale(roomId);
    }
  });

  // Proceed to next player
  socket.on("proceed_to_next_player", () => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (r && isAdmin(socket)) {
      r.auctionIndex++;
      startNextBlindPlayer(roomId);
    }
  });

  // Request exchange (can be multiple teams now)
  socket.on("request_exchange", ({ fromTeam, toTeam, player }) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (!r) return;

    // fromTeam is the requestor
    if (r.blindAuction.winner && r.blindAuction.winner.teamKey === fromTeam) {
      return socket.emit("error_message", "You already won this player!");
    }

    // Validate requestor budget
    const requestorTeam = r.teams.find((t) => t.bidKey === fromTeam);
    if (!requestorTeam) return;

    if (
      r.blindAuction.winner &&
      requestorTeam.budget < r.blindAuction.winner.amount
    ) {
      return socket.emit(
        "error_message",
        "Insufficient budget to request exchange!",
      );
    }

    if (!r.blindAuction.requests) r.blindAuction.requests = {};

    // Check if this is a new request (not already requested)
    const isNewRequest = !r.blindAuction.requests[fromTeam];
    r.blindAuction.requests[fromTeam] = true;

    console.log(
      `Exchange request from ${fromTeam} for ${r.blindAuction.currentPlayer.name}`,
    );

    // ADD 5 SECONDS TO TIMER if this is a new request
    if (isNewRequest && r.blindAuction.timer !== undefined) {
      r.blindAuction.timer += 5;
      console.log(
        `⏱️ Added 5 seconds to decision timer. New time: ${r.blindAuction.timer}s`,
      );

      // Emit timer update to all clients
      io.to(roomId).emit("blind_timer_tick", r.blindAuction.timer);
      io.to(roomId).emit("timer_extended", {
        teamName: requestorTeam.name,
        newTime: r.blindAuction.timer,
        message: `${requestorTeam.name} requested exchange! +5 seconds added.`,
      });
    }

    // Notify the winner (or all) that someone requested
    io.to(roomId).emit("exchange_requests_updated", {
      requestors: Object.keys(r.blindAuction.requests),
    });
  });

  // 🛑 ADMIN CLOSE ROOM IMMEDIATELY
  socket.on("admin_close_room", () => {
    const roomId = getRoomId(socket);
    if (!isAdmin(socket)) return;

    if (rooms[roomId]) {
      // Notify all clients to leave
      io.to(roomId).emit("room_closed_by_admin");

      // Delete from DB immediately
      Room.deleteOne({ roomId: roomId })
        .then(() => {
          console.log(`🛑 Room ${roomId} CLOSED and DELETED by Admin.`);
        })
        .catch((err) => console.error("Error deleting room:", err));

      // Remove from memory
      delete rooms[roomId];
    }
  });

  // Winner clicks Exchange (Accepts the idea of selling)
  socket.on("start_exchange_contest", () => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (!r || !r.blindAuction.winner) return;

    // Verify the one who clicked is the winner
    const team = r.teams.find((t) => t.ownerSocketId === socket.id);
    if (!team || team.bidKey !== r.blindAuction.winner.teamKey) return;

    // Stop the decision window timer
    clearBlindAuctionTimers(r);

    const requestorKeys = Object.keys(r.blindAuction.requests || {});

    if (requestorKeys.length === 0) return;

    if (requestorKeys.length === 1) {
      // Only one requestor, skip contest and go straight to acceptance
      const targetTeamKey = requestorKeys[0];
      const targetTeam = r.teams.find((t) => t.bidKey === targetTeamKey);

      if (targetTeam) {
        console.log(
          `Single requestor ${targetTeam.name}. Auto-accepting exchange.`,
        );
        handleAcceptExchange(
          roomId,
          r,
          r.blindAuction.winner.teamKey,
          targetTeam,
        );
      }
    } else {
      // MULTIPLE REQUESTORS: Start Contest Round
      r.blindAuction.isContestActive = true;
      r.blindAuction.contestBids = {};

      console.log(
        `Multiple requestors (${requestorKeys.length}). Starting contest.`,
      );

      io.to(roomId).emit("exchange_contest_started", {
        requestors: requestorKeys,
        basePrice: r.blindAuction.winner.amount,
        player: r.blindAuction.currentPlayer,
        timer: 15, // 15 seconds for contest
      });

      // Start Contest Timer (Fix for hanging auction)
      startExchangeTimer(roomId, 15);
    }
  });

  // Submit Contest Bid
  socket.on("submit_contest_bid", ({ amount }) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (!r || !r.blindAuction.isContestActive) return;

    // Find team by socket ID or player ID (for reconnection support)
    const team = r.teams.find(
      (t) =>
        t.ownerSocketId === socket.id || t.ownerPlayerId === socket.playerId,
    );
    if (!team || !r.blindAuction.requests[team.bidKey]) {
      return socket.emit(
        "error_message",
        "You are not in the exchange contest!",
      );
    }

    // Budget Check
    if (team.budget < amount) {
      return socket.emit(
        "error_message",
        "Insufficient Budget for contest bid!",
      );
    }

    r.blindAuction.contestBids[team.bidKey] = amount;
    console.log(`Contest Bid: ${team.name} - ₹${amount}`);

    const requestorCount = Object.keys(r.blindAuction.requests).length;
    const bidCount = Object.keys(r.blindAuction.contestBids).length;

    if (bidCount >= requestorCount) {
      // All have bid in contest, find highest
      finalizeContest(roomId);
    }
  });

  // Submit Tie-Breaker Bid
  socket.on("submit_tie_bid", ({ amount }) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (!r || !r.blindAuction.isTieBreakerActive) return;

    // Find team by socket ID or player ID (for reconnection support)
    const team = r.teams.find(
      (t) =>
        t.ownerSocketId === socket.id || t.ownerPlayerId === socket.playerId,
    );
    if (!team || !r.blindAuction.tieBreakerTeams.includes(team.bidKey)) {
      return socket.emit("error_message", "You are not in the tie-breaker!");
    }

    // Budget check
    if (team.budget < amount) {
      return socket.emit(
        "error_message",
        "Insufficient Budget for tie-breaker bid!",
      );
    }

    r.blindAuction.tieBreakerBids[team.bidKey] = amount;
    console.log(`Tie-Breaker Bid: ${team.name} - ₹${amount}`);

    const tiedCount = r.blindAuction.tieBreakerTeams.length;
    const bidCount = Object.keys(r.blindAuction.tieBreakerBids).length;

    if (bidCount >= tiedCount) {
      finalizeTieBreaker(roomId);
    }
  });

  function finalizeTieBreaker(roomId) {
    const r = rooms[roomId];
    if (!r) return;

    console.log(
      `Resolving Tie-Breaker for ${r.blindAuction.currentPlayer.name}`,
    );

    // Update the original currentBids with the new tie-breaker amounts
    for (const [key, amount] of Object.entries(r.blindAuction.tieBreakerBids)) {
      if (r.blindAuction.currentBids[key]) {
        r.blindAuction.currentBids[key].amount = amount;
      }
    }

    r.blindAuction.isTieBreakerActive = false;
    r.blindAuction.tieBreakerTeams = [];
    r.blindAuction.tieBreakerBids = {};

    // Run revealBids again, it will now find a clear winner (or another tie if they are unlucky)
    revealBids(roomId);
  }

  function finalizeContest(roomId) {
    const r = rooms[roomId];
    if (!r) return;

    let bestBidder = null;
    let maxAmount = -1;

    for (const [key, amount] of Object.entries(r.blindAuction.contestBids)) {
      if (amount > maxAmount) {
        maxAmount = amount;
        bestBidder = key;
      }
    }

    if (bestBidder) {
      const winnerTeam = r.teams.find((t) => t.bidKey === bestBidder);
      console.log(`🏆 Contest Winner: ${winnerTeam.name} with ₹${maxAmount}`);

      // Update winner object to the NEW owner and NEW amount
      r.blindAuction.winner = {
        teamKey: winnerTeam.bidKey,
        teamName: winnerTeam.name,
        amount: maxAmount,
        submitted: true,
      };

      io.to(roomId).emit("exchange_contest_finalized", {
        winner: winnerTeam.name,
        amount: maxAmount,
      });

      setTimeout(() => finalizeSale(roomId), 2000);
    } else {
      // No bids? Keep original winner
      finalizeSale(roomId);
    }

    r.blindAuction.isContestActive = false;
  }

  function handleAcceptExchange(roomId, r, fromTeamKey, toTeamObj) {
    const winner = r.blindAuction.winner;

    console.log(`✅ EXCHANGED to ${toTeamObj.name}`);

    io.to(roomId).emit("exchange_accepted", {
      player: r.blindAuction.currentPlayer,
      toTeamName: toTeamObj.name,
      fromTeam: fromTeamKey,
    });

    r.blindAuction.winner = {
      teamKey: toTeamObj.bidKey,
      teamName: toTeamObj.name,
      amount: winner.amount,
      submitted: true,
    };

    setTimeout(() => finalizeSale(roomId), 1500);
  }

  // Accept exchange
  socket.on("accept_exchange", ({ fromTeam }) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (!r) return;

    const toTeamObj = r.teams.find((t) => t.ownerSocketId === socket.id);
    if (toTeamObj) {
      handleAcceptExchange(roomId, r, fromTeam, toTeamObj);
    }
  });

  // Reject exchange
  socket.on("reject_exchange", ({ fromTeam }) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (!r) return;

    const toTeamObj = r.teams.find((t) => t.ownerSocketId === socket.id);

    if (toTeamObj) {
      io.to(roomId).emit("exchange_rejected", {
        fromTeam: fromTeam,
        toTeamName: toTeamObj.name,
      });
    }
  });

  // --- VOICE CHAT SIGNALING ---
  socket.on("voice_ready", ({ roomId }) => {
    socket.to(roomId).emit("voice_user_ready", { userId: socket.id });
  });

  socket.on("voice_offer", ({ to, offer }) => {
    io.to(to).emit("voice_offer", { from: socket.id, offer });
  });

  socket.on("voice_answer", ({ to, answer }) => {
    io.to(to).emit("voice_answer", { from: socket.id, answer });
  });

  socket.on("voice_ice_candidate", ({ to, candidate }) => {
    io.to(to).emit("voice_ice_candidate", { from: socket.id, candidate });
  });

  socket.on("voice_stopped", ({ roomId }) => {
    socket.to(roomId).emit("voice_user_stopped", { userId: socket.id });
  });

  socket.on("disconnect", () => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (r) {
      r.users = r.users.filter((id) => id !== socket.id);

      // Notify voice chat that user left
      socket.to(roomId).emit("voice_user_stopped", { userId: socket.id });

      io.to(roomId).emit("lobby_update", {
        teams: r.teams,
        userCount: r.users.length,
      });
    }
  });
});

// 🚀 NEW SIMULATION ENGINE (IMPORTED FROM ai.js)
// AI variable is already defined at top of file

async function runSimulationLogic(roomId, r) {
  if (!r) return;

  // Prepare teams for the AI - use default teams if no teams are taken
  // Prepare teams for the AI - only include teams that have been taken
  let tourneyTeams = r.teams
    .filter((t) => t.isTaken)
    .map((t) => {
      const squadData = r.squads[t.bidKey];

      // Hydrate squad players
      const hydratedSquad = (squadData?.squad || []).map((entry) => {
        const playerName =
          typeof entry === "string" ? entry : entry.name || "Unknown";
        const dbPlayer = getPlayerFromDB(playerName);
        return {
          name: playerName,
          role: dbPlayer.role || "Normal",
          type: dbPlayer.type || "bat",
          stats: {
            bat: dbPlayer.bat || 70,
            bowl: dbPlayer.bowl || 60,
            luck: dbPlayer.luck || 70,
          },
          trait: dbPlayer.trait || "normal",
        };
      });

      return {
        ...t,
        squad: hydratedSquad,
        batImpact: squadData ? squadData.batImpact : null,
        bowlImpact: squadData ? squadData.bowlImpact : null,
        captain: squadData ? squadData.captain : null,
      };
    });

  // If too few teams are taken, fill with default AI teams to make a competitive 4-team tournament
  if (tourneyTeams.length < 2) {
    console.log(
      `Too few teams (${tourneyTeams.length}) in room ${roomId}, adding default AI teams.`,
    );
    const defaultTeams = [
      { name: "CSK", bidKey: "csk", playerName: "AI Bot", isTaken: true },
      { name: "MI", bidKey: "mi", playerName: "AI Bot", isTaken: true },
      { name: "RCB", bidKey: "rcb", playerName: "AI Bot", isTaken: true },
      { name: "KKR", bidKey: "kkr", playerName: "AI Bot", isTaken: true },
    ]
      .filter((dt) => !tourneyTeams.find((tt) => tt.name === dt.name))
      .slice(0, 4 - tourneyTeams.length);

    // Hydrate AI teams with realistic squads from database
    const hydratedAI = defaultTeams.map((team) => {
      // Select some players from DB based on team name (very basic heuristic)
      const players = Object.keys(PLAYER_DATABASE).slice(0, 15); // Just grab some top players
      const squad = players.slice(0, 11).map((pName) => {
        const dbP = getPlayerFromDB(pName);
        return {
          name: pName,
          role: dbP.role || "Normal",
          type: dbP.type || "bat",
          stats: {
            bat: dbP.bat || 70,
            bowl: dbP.bowl || 60,
            luck: dbP.luck || 70,
          },
          trait: dbP.trait || "normal",
        };
      });
      return { ...team, squad, roster: squad };
    });

    tourneyTeams = [...tourneyTeams, ...hydratedAI];
  }

  // Call the AI Engine
  try {
    console.log(
      `Running AI Simulation for Room ${roomId} with ${tourneyTeams.length} teams.`,
    );
    const aiResults = await AI.runFullTournament(tourneyTeams);

    // Merge with Room Data for Frontend
    const results = {
      ...aiResults,
      squads: r.squads,
      teams: r.teams,
    };

    // Save for persistence
    r.lastTournamentResults = results;
    r.auctionState = "RESULTS";

    // Mark room as completed for auto-cleanup (12 hours)
    r.completedAt = new Date();

    // Update user profiles with tournament results
    await updateUserProfiles(roomId, r, aiResults);

    // Save win record to database
    await saveWinRecord(roomId, r, aiResults, tourneyTeams);

    // Save to DB with completedAt timestamp
    await saveRoomToDB(roomId);

    io.to(roomId).emit("tournamentComplete", results);
  } catch (e) {
    console.error("AI Simulation Failed:", e);
    io.to(roomId).emit("simulation_error", e.message);
  }
}

// Helper function to update user profiles after tournament
async function updateUserProfiles(roomId, r, aiResults) {
  try {
    console.log("🔍 Starting profile updates for room:", roomId);

    // Determine game type (default to 'normal' for existing rooms)
    const gameType = r.gameType || "normal";
    console.log("🎮 Game Type:", gameType);

    // Determine winner and runner-up with fuzzy matching fallback
    const winner = aiResults.winner;
    const runnerUp = aiResults.runnerUp;

    const winnerName = winner?.name || winner?.teamName || "Unknown";
    const runnerUpName = runnerUp?.name || runnerUp?.teamName || "Unknown";

    console.log("🏆 Winner (Raw):", winnerName);
    console.log("🥈 Runner-up (Raw):", runnerUpName);

    // Update each team's owner profile
    const takenTeams = r.teams.filter((t) => t.isTaken);
    console.log(`📊 Processing ${takenTeams.length} teams`);

    for (const team of takenTeams) {
      console.log(`\n👤 Processing team: ${team.name}`);

      // Find user by team's player name or email
      const playerEmail = team.playerEmail || team.ownerEmail;
      console.log(`   Email found: ${playerEmail || "NONE"}`);

      if (!playerEmail) {
        console.log(`   ⚠️  Skipping ${team.name} - no email found`);
        continue;
      }

      const user = await User.findOne({ email: playerEmail });
      if (!user) {
        console.log(
          `   ❌ User not found in database for email: ${playerEmail}`,
        );
        continue;
      }

      console.log(`   ✅ User found: ${user.name}`);

      // Determine result (Fuzzy match)
      let result = "participated";
      let won = false;

      const teamMatch = (tName, compareName) => {
        if (!tName || !compareName) return false;
        const t = tName.toLowerCase().replace(/\s/g, "");
        const c = compareName.toLowerCase().replace(/\s/g, "");
        return t === c || t.includes(c) || c.includes(t);
      };

      if (winnerName && teamMatch(team.name, winnerName)) {
        result = "won";
        won = true;
      } else if (runnerUpName && teamMatch(team.name, runnerUpName)) {
        result = "runner-up";
      }

      console.log(`   🎯 Result: ${result}`);

      // Update overall stats
      if (!user.stats) {
        user.stats = {
          matchesPlayed: 0,
          matchesWon: 0,
          auctionsParticipated: 0,
        };
      }
      user.stats.matchesPlayed += 1;
      user.stats.auctionsParticipated += 1;
      if (won) user.stats.matchesWon += 1;

      // Update game-specific stats
      if (gameType === "normal") {
        if (!user.normalAuction) {
          user.normalAuction = { matchesPlayed: 0, matchesWon: 0, winRate: 0 };
        }
        user.normalAuction.matchesPlayed += 1;
        if (won) user.normalAuction.matchesWon += 1;
        user.normalAuction.winRate = Math.round(
          (user.normalAuction.matchesWon / user.normalAuction.matchesPlayed) *
            100,
        );
        console.log(
          `   📊 Normal Auction: ${user.normalAuction.matchesPlayed} played, ${user.normalAuction.matchesWon} won`,
        );
      } else if (gameType === "blind") {
        if (!user.blindAuction) {
          user.blindAuction = {
            matchesPlayed: 0,
            matchesWon: 0,
            winRate: 0,
            exchangesMade: 0,
            exchangesReceived: 0,
          };
        }
        user.blindAuction.matchesPlayed += 1;
        if (won) user.blindAuction.matchesWon += 1;
        user.blindAuction.winRate = Math.round(
          (user.blindAuction.matchesWon / user.blindAuction.matchesPlayed) *
            100,
        );

        // Track exchanges if available
        if (team.exchangesMade)
          user.blindAuction.exchangesMade += team.exchangesMade;
        if (team.exchangesReceived)
          user.blindAuction.exchangesReceived += team.exchangesReceived;

        console.log(
          `   🎭 Blind Auction: ${user.blindAuction.matchesPlayed} played, ${user.blindAuction.matchesWon} won`,
        );
      }

      console.log(
        `   📈 Overall Stats: ${user.stats.matchesPlayed} played, ${user.stats.matchesWon} won`,
      );

      // Add auction history
      if (!user.auctionHistory) {
        user.auctionHistory = [];
      }

      const squad = r.squads[team.bidKey];
      if (squad) {
        const historyEntry = {
          gameType: gameType,
          roomId: roomId,
          teamName: team.name,
          date: new Date(),
          result: result,
          squad: team.roster.map((player) => ({
            name: String(player.name || "Unknown"),
            role: String(player.role || "Unknown"),
            price: Number(player.price) || 0,
            type: String(player.type || "Unknown"),
          })),
          exchangesInvolved: team.exchangesInvolved || 0,
        };
        user.auctionHistory.push(historyEntry);
        console.log(
          `   📝 Added ${gameType} auction history with ${team.roster.length} players`,
        );
      } else {
        console.log(`   ⚠️  No squad found for ${team.bidKey}`);
      }

      await user.save();
      console.log(`   ✅ Profile saved for ${user.name} (${result})`);
    }

    console.log("\n✅ Profile updates completed successfully!");
  } catch (error) {
    console.error("❌ Error updating user profiles:", error);
  }
}

// Helper function to save win record to database
async function saveWinRecord(roomId, r, aiResults, tourneyTeams) {
  // Skip if MongoDB is not connected
  if (mongoose.connection.readyState !== 1) {
    console.log("⚠️  Skipping win record save - MongoDB not connected");
    return;
  }

  try {
    console.log("💾 Saving win record for room:", roomId);

    // Determine game type
    const gameType = r.gameType || "normal";

    // Extract winner and runner-up
    const winner = aiResults.winner;
    const runnerUp = aiResults.runnerUp;

    // Robust extraction of winner data
    const winnerName = winner?.name || winner?.teamName || "CHAMPIONS";
    const runnerUpName = runnerUp?.name || runnerUp?.teamName || "FINALISTS";

    if (!winner && !aiResults.standings) {
      console.log(
        "⚠️  AI Results missing winner & standings, skipping saveWinRecord",
      );
      return;
    }

    // Build players list (Only human users)
    const players = r.teams
      .filter((t) => t.isTaken)
      .map((team) => {
        return {
          playerName: team.playerName || "Unknown",
          playerEmail: team.playerEmail || team.ownerEmail,
          playerId: team.ownerPlayerId,
          teamName: team.name,
          teamKey: team.bidKey,
        };
      });

    // Find winner player info
    const winnerTeam = r.teams.find((t) => t.name === winner.name);
    const runnerUpTeam = runnerUp
      ? r.teams.find((t) => t.name === runnerUp.name)
      : null;

    // Build standings from aiResults
    const standings = aiResults.standings
      ? aiResults.standings.map((team, index) => ({
          position: index + 1,
          teamName: team.name,
          played: team.stats?.p || team.stats?.played || 0,
          won: team.stats?.w || team.stats?.won || 0,
          lost: team.stats?.l || team.stats?.lost || 0,
          points: team.stats?.pts || team.stats?.points || 0,
          nrr:
            typeof team.stats?.nrr === "number"
              ? team.stats.nrr
              : parseFloat(team.stats?.nrr || 0),
        }))
      : [];

    // Build rosters list using FULL tourneyTeams (includes AI)
    // If tourneyTeams is provided, use it. Otherwise fallback to r.teams logic.
    let rostersSource = tourneyTeams || r.teams.filter((t) => t.isTaken);

    const rosters = rostersSource.map((team) => {
      // Map squad to expected format
      const squadList = team.squad || team.roster || [];
      return {
        teamName: team.name,
        teamKey: team.bidKey,
        playerName: team.playerName || "AI Bot",
        players: squadList.map((p) => ({
          name: p.name,
          role: p.role || p.roleKey || "Player",
          price: Number(p.price) || 0,
          type: p.type || "bat",
        })),
      };
    });

    // Create win record
    const winRecord = new Win({
      roomId: roomId,
      gameType: gameType,
      playedAt: new Date(),

      players: players,

      winner: {
        teamName: winnerName,
        teamKey: winnerTeam?.bidKey || "winner",
        playerName:
          winnerTeam?.playerName || winner?.playerName || "Unknown Player",
        playerEmail: winnerTeam?.playerEmail || winnerTeam?.ownerEmail,
        playerId: winnerTeam?.ownerPlayerId,
        totalPoints: winner.stats?.pts || winner.stats?.points || 0,
        wins: winner.stats?.w || winner.stats?.won || 0,
        losses: winner.stats?.l || winner.stats?.lost || 0,
        nrr: winner.stats?.nrr || 0,
      },

      runnerUp: runnerUp
        ? {
            teamName: runnerUpName,
            teamKey: runnerUpTeam?.bidKey || "runnerup",
            playerName:
              runnerUpTeam?.playerName ||
              runnerUp?.playerName ||
              "Unknown Player",
            playerEmail: runnerUpTeam?.playerEmail || runnerUpTeam?.ownerEmail,
            playerId: runnerUpTeam?.ownerPlayerId,
            totalPoints: runnerUp.stats?.pts || runnerUp.stats?.points || 0,
            wins: runnerUp.stats?.w || runnerUp.stats?.won || 0,
            losses: runnerUp.stats?.l || runnerUp.stats?.lost || 0,
          }
        : undefined,

      stats: {
        totalMatches: aiResults.leagueMatches?.length || 0,
        totalTeams: r.teams.filter((t) => t.isTaken).length,
        orangeCap: aiResults.orangeCap
          ? {
              playerName: aiResults.orangeCap.name,
              runs: aiResults.orangeCap.val || aiResults.orangeCap.runs,
              team: aiResults.orangeCap.team,
            }
          : undefined,
        purpleCap: aiResults.purpleCap
          ? {
              playerName: aiResults.purpleCap.name,
              wickets:
                aiResults.purpleCap.val ||
                aiResults.purpleCap.wkts ||
                aiResults.purpleCap.wickets,
              team: aiResults.purpleCap.team,
            }
          : undefined,
        mvp: aiResults.mvp
          ? {
              playerName: aiResults.mvp.name,
              points:
                aiResults.mvp.val || aiResults.mvp.pts || aiResults.mvp.points,
              team: aiResults.mvp.team,
            }
          : undefined,
      },

      standings: standings,
      rosters: rosters,

      leagueMatches: (Array.isArray(aiResults.leagueMatches)
        ? aiResults.leagueMatches
        : []
      )
        .map((m) => {
          if (!m || typeof m !== "object") return null;
          return {
            t1: m.t1 || m.team1 || "Unknown",
            t2: m.t2 || m.team2 || "Unknown",
            winner: m.winnerName || m.winner || "Draw",
            margin: m.margin || "N/A",
            score1: m.score1 || "0/0",
            score2: m.score2 || "0/0",
            type: m.type || "League",
            batFirst: m.batFirst || "Unknown",
          };
        })
        .filter((m) => m !== null),

      playoffs: (Array.isArray(aiResults.playoffs) ? aiResults.playoffs : [])
        .map((m) => {
          if (!m || typeof m !== "object") return null;
          return {
            t1: m.t1 || m.team1 || "Unknown",
            t2: m.t2 || m.team2 || "Unknown",
            winner: m.winnerName || m.winner || "Draw",
            margin: m.margin || "N/A",
            score1: m.score1 || "0/0",
            score2: m.score2 || "0/0",
            type: m.type || "Playoff",
            batFirst: m.batFirst || "Unknown",
          };
        })
        .filter((m) => m !== null),

      metadata: {
        budget: r.config?.budget || 1000000000,
        totalPlayers: r.auctionQueue?.length || 0,
        exchangeEnabled: r.blindAuction?.exchangeEnabled || false,
      },
    });

    // Save to database
    await winRecord.save();

    console.log("✅ Win record saved successfully!");
    console.log(`   🏆 Winner: ${winner.name}`);
    console.log(`   🥈 Runner-up: ${runnerUp?.name || "N/A"}`);
    console.log(`   👥 Players: ${players.length}`);
  } catch (error) {
    console.error("❌ Error saving win record:", error);
  }
}

// =================================================================
// 🎭 BLIND AUCTION HELPER FUNCTIONS
// =================================================================

function buildBlindAuctionQueue() {
  // Reuse the same player database and queue building logic from normal auction
  // For now, return a simplified queue for testing
  const testPlayers = [
    {
      name: "Virat Kohli",
      category: "Indian Batsman",
      roleKey: "batter",
      basePrice: 20000000,
      set: "Marquee",
    },
    {
      name: "Rohit Sharma",
      category: "Indian Batsman",
      roleKey: "batter",
      basePrice: 20000000,
      set: "Marquee",
    },
    {
      name: "Jasprit Bumrah",
      category: "Indian Bowler",
      roleKey: "bowler",
      basePrice: 20000000,
      set: "Marquee",
    },
    {
      name: "Hardik Pandya",
      category: "Indian All-rounder",
      roleKey: "allrounder",
      basePrice: 20000000,
      set: "Marquee",
    },
    {
      name: "KL Rahul",
      category: "Indian Wicketkeeper",
      roleKey: "wk",
      basePrice: 15000000,
      set: "Premium",
    },
  ];

  return testPlayers;
}

function startNextBlindPlayer(roomId) {
  const r = rooms[roomId];
  if (!r) return;

  // Clear previous bids
  r.blindAuction.currentBids = {};

  // Check if auction is complete
  if (r.auctionIndex >= r.auctionQueue.length) {
    console.log("Blind auction complete! Moving to squad selection...");
    io.to(roomId).emit("open_squad_selection");
    return;
  }

  // Get next player
  const player = r.auctionQueue[r.auctionIndex];
  r.blindAuction.currentPlayer = player;

  console.log(`Starting blind bidding for: ${player.name}`);

  // Emit to all clients
  io.to(roomId).emit("new_blind_player", {
    player: player,
    timerDuration: r.blindAuction.bidTimer,
  });

  // Start timer
  startBlindBidTimer(roomId);
}

function clearBlindAuctionTimers(r) {
  if (r.blindAuction.timerInterval) {
    clearInterval(r.blindAuction.timerInterval);
    r.blindAuction.timerInterval = null;
  }
  if (r.blindAuction.exchangeInterval) {
    clearInterval(r.blindAuction.exchangeInterval);
    r.blindAuction.exchangeInterval = null;
  }
}

function startBlindBidTimer(roomId) {
  const r = rooms[roomId];
  if (!r || !r.blindAuction) return;

  let timeLeft = r.blindAuction.bidTimer;
  r.blindAuction.timer = timeLeft;
  r.blindAuction.timerEndTime = Date.now() + timeLeft * 1000; // Sync Fix

  // Clear existing timer
  clearBlindAuctionTimers(r);

  // Reset requests
  r.blindAuction.requests = {};
  r.blindAuction.isContestActive = false;
  r.blindAuction.contestBids = {};

  // Ensure timer is running when function is called
  r.timerPaused = false;
  io.to(roomId).emit("timer_status", false);

  r.blindAuction.timerInterval = setInterval(() => {
    // Check global pause state
    if (r.timerPaused) {
      r.blindAuction.timerEndTime = Date.now() + r.blindAuction.timer * 1000;
      return;
    }

    timeLeft--;
    r.blindAuction.timer = timeLeft;
    io.to(roomId).emit("timer_tick", timeLeft);

    if (timeLeft <= 0) {
      clearInterval(r.blindAuction.timerInterval);
      r.blindAuction.timerInterval = null;

      // Time's up, reveal bids
      setTimeout(() => revealBids(roomId), 500);
    }
  }, 1000);
}

function revealBids(roomId) {
  const r = rooms[roomId];
  if (!r || !r.blindAuction) return;

  // CLEAR TIMER if it was running (stops it if we revealed early)
  if (r.blindAuction.timerInterval) {
    clearInterval(r.blindAuction.timerInterval);
    r.blindAuction.timerInterval = null;
  }

  console.log("Revealing bids for:", r.blindAuction.currentPlayer.name);

  // Get all bids
  const bids = Object.values(r.blindAuction.currentBids);

  // Add zero bids for teams that didn't bid
  const activeTeams = r.teams.filter((t) => t.isTaken);
  activeTeams.forEach((team) => {
    if (!r.blindAuction.currentBids[team.bidKey]) {
      bids.push({
        teamKey: team.bidKey,
        teamName: team.name,
        amount: 0,
        submitted: false,
      });
    }
  });

  // Sort bids (highest first)
  bids.sort((a, b) => b.amount - a.amount);

  // CHECK FOR TIE-BREAKER
  if (
    bids.length >= 2 &&
    bids[0].amount > 0 &&
    bids[0].amount === bids[1].amount
  ) {
    // Collect all teams tied for the top amount
    const topAmount = bids[0].amount;
    const tiedTeams = bids.filter((b) => b.amount === topAmount);

    r.blindAuction.isTieBreakerActive = true;
    r.blindAuction.tieBreakerTeams = tiedTeams.map((t) => t.teamKey);
    r.blindAuction.tieBreakerAmount = topAmount;
    r.blindAuction.tieBreakerBids = {};

    console.log(
      `⚖️ Tie-breaker started between: ${tiedTeams.map((t) => t.teamName).join(", ")} at ₹${topAmount}`,
    );

    io.to(roomId).emit("tie_breaker_started", {
      teams: tiedTeams,
      amount: topAmount,
      player: r.blindAuction.currentPlayer,
    });
    return; // Pause revealBids until tie is broken
  }

  const winner = bids.length > 0 && bids[0].amount > 0 ? bids[0] : null;
  r.blindAuction.winner = winner;

  console.log(
    "Final Bids:",
    bids.map((b) => `${b.teamName}: ₹${b.amount}`).join(", "),
  );

  // Emit reveal
  io.to(roomId).emit("bids_revealed", {
    playerName: r.blindAuction.currentPlayer.name,
    bids: bids,
    winner: winner,
  });

  if (winner) {
    // Start a decision window for the winner to see requests
    console.log(
      `${r.blindAuction.currentPlayer.name} - Highest Bid: ₹${winner.amount} by ${winner.teamName}`,
    );

    // Let's give 5 seconds for requesting and winner to decide
    let decisionTime = 5;
    r.blindAuction.timer = decisionTime; // Sync for late joins

    // Stop any existing interval (though should be null)
    if (r.blindAuction.timerInterval)
      clearInterval(r.blindAuction.timerInterval);

    // Ensure timer is running
    r.timerPaused = false;
    io.to(roomId).emit("timer_status", false);

    r.blindAuction.timerInterval = setInterval(() => {
      // Check global pause state
      if (r.timerPaused) return;

      decisionTime--;
      r.blindAuction.timer = decisionTime;

      // Re-use timer_tick for the exchange window countdown
      io.to(roomId).emit("timer_tick", decisionTime);

      if (decisionTime <= 0) {
        clearInterval(r.blindAuction.timerInterval);
        r.blindAuction.timerInterval = null;

        // If the contest hasn't started and no exchange accepted, auto-finalize the original winner
        const currentRoom = rooms[roomId];
        if (currentRoom && !currentRoom.blindAuction.isContestActive) {
          finalizeSale(roomId);
        }
      }
    }, 1000);
  } else {
    // No bids, player unsold
    console.log(`${r.blindAuction.currentPlayer.name} - UNSOLD`);

    // Update status in auctionQueue
    if (r.auctionQueue) {
      const qPlayer = r.auctionQueue.find(
        (p) => p.name === r.blindAuction.currentPlayer.name,
      );
      if (qPlayer) {
        qPlayer.status = "UNSOLD";
      }
    }

    // Emit IMMEDIATE update so clients see "UNSOLD"
    io.to(roomId).emit("unsold_finalized", {
      message: `${r.blindAuction.currentPlayer.name} was UNSOLD`,
      player: r.blindAuction.currentPlayer,
      queue: r.auctionQueue,
    });

    // Auto-advance after 1 second for UNSOLD (Quick transition)
    setTimeout(() => {
      const currentRoom = rooms[roomId];
      // Check if room and player are still the same to avoid conflicts
      if (
        currentRoom &&
        currentRoom.blindAuction.currentPlayer &&
        currentRoom.blindAuction.currentPlayer.name ===
          r.blindAuction.currentPlayer.name
      ) {
        console.log(
          `Auto-skipping unsold player: ${currentRoom.blindAuction.currentPlayer.name}`,
        );

        // Clear state for next player
        currentRoom.blindAuction.winner = null;
        clearBlindAuctionTimers(currentRoom);

        // Advance
        currentRoom.auctionIndex++;
        // Explicitly check index bound before calling next
        if (currentRoom.auctionIndex < currentRoom.auctionQueue.length) {
          startNextBlindPlayer(roomId);
        } else {
          // End of auction
          console.log(
            "Blind auction complete (after unsold). Open squad selection.",
          );
          io.to(roomId).emit("open_squad_selection");
        }
      }
    }, 1000); // Reduced from 5000ms to 1000ms
  }
}

function startExchangeTimer(roomId, explicitDuration = null) {
  const r = rooms[roomId];
  if (!r) return;

  let timeLeft = explicitDuration || r.blindAuction.exchangeTimer;
  r.blindAuction.timer = timeLeft;
  r.blindAuction.timerEndTime = Date.now() + timeLeft * 1000; // Sync Fix

  // Clear any existing exchange timer
  if (r.blindAuction.exchangeInterval) {
    clearInterval(r.blindAuction.exchangeInterval);
  }

  // Ensure timer is running
  r.timerPaused = false;
  io.to(roomId).emit("timer_status", false);

  r.blindAuction.exchangeInterval = setInterval(() => {
    // Check global pause state
    if (r.timerPaused) {
      r.blindAuction.timerEndTime = Date.now() + r.blindAuction.timer * 1000;
      return;
    }

    timeLeft--;
    r.blindAuction.timer = timeLeft;
    // Emit tick update to main timer
    io.to(roomId).emit("timer_tick", timeLeft);

    if (timeLeft <= 0) {
      clearInterval(r.blindAuction.exchangeInterval);
      r.blindAuction.exchangeInterval = null;

      // Check if we are in contest mode
      if (r.blindAuction.isContestActive) {
        console.log(`⏰ Contest Time Up! Finalizing contest for ${roomId}`);
        finalizeContest(roomId);
      } else {
        // Auto-finalize if time runs out (standard exchange)
        finalizeSale(roomId);
      }
    }
  }, 1000);
}

function finalizeSale(roomId) {
  const r = rooms[roomId];
  if (!r || !r.blindAuction.winner) return;

  const winner = r.blindAuction.winner;
  const team = r.teams.find((t) => t.bidKey === winner.teamKey);

  // Safety: Reset winner to prevent double-processing if function is called twice
  r.blindAuction.winner = null;

  // Clear any active timers
  clearBlindAuctionTimers(r);

  if (team) {
    // Prevent adding same player twice (extra safety)
    const isAlreadyAdded = team.roster.some(
      (p) => p.name === r.blindAuction.currentPlayer.name,
    );

    if (!isAlreadyAdded) {
      // Add player to team roster
      team.roster.push({
        ...r.blindAuction.currentPlayer,
        price: winner.amount,
        status: "SOLD",
      });
      team.totalSpent += winner.amount;
      team.totalPlayers += 1;
      team.budget -= winner.amount;

      console.log(
        `✅ ${r.blindAuction.currentPlayer.name} SOLD to ${team.name} for ₹${winner.amount}`,
      );
    } else {
      console.log(
        `⚠️ ${r.blindAuction.currentPlayer.name} was already in ${team.name}'s roster. Skipping duplicate.`,
      );
    }
  }

  // Update status in auctionQueue
  if (r.auctionQueue) {
    const qPlayer = r.auctionQueue.find(
      (p) => p.name === r.blindAuction.currentPlayer.name,
    );
    if (qPlayer) {
      qPlayer.status = "SOLD";
      qPlayer.soldPrice = winner.amount;
      qPlayer.winnerKey = winner.teamKey;
    }
  }

  // Emit finalization
  io.to(roomId).emit("exchange_finalized", {
    teams: r.teams,
    queue: r.auctionQueue,
    message: team
      ? `${r.blindAuction.currentPlayer.name} sold to ${team.name}`
      : `${r.blindAuction.currentPlayer.name} sold`,
  });

  // Save and move to next player
  saveRoomToDB(roomId);

  setTimeout(() => {
    r.auctionIndex++;
    // Explicitly check index bound before calling next
    if (r.auctionIndex < r.auctionQueue.length) {
      startNextBlindPlayer(roomId);
    } else {
      console.log("Blind auction complete. Open squad selection.");
      io.to(roomId).emit("open_squad_selection");
    }
  }, 2000);
}

if (require.main === module) {
  server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;

// MONGODB_URI=mongodb+srv://tamil_18:tamil18@cluster0.gk2bbeg.mongodb.net/booking?retryWrites=true&w=majority
