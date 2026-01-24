const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const cors = require("cors");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const authRoutes = require("./routes/auth");
const Room = require("./models/Room");
const User = require("./models/User");
const Win = require("./models/Win");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json()); // Essential for Auth API
app.use("/api/auth", authRoutes);

// MongoDB Connection (Non-blocking)
mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 5000, // Timeout after 5 seconds
  socketTimeoutMS: 45000,
})
  .then(() => {
    console.log("✅ Connected to MongoDB");
  })
  .catch(err => {
    console.warn("⚠️  MongoDB Connection Failed:", err.message);
    console.warn("⚠️  Server will continue without database features");
    console.warn("⚠️  Blind auction and normal auction will work, but data won't persist");
  });

// Method Change: Create Server
const server = http.createServer(app);

// Method Change: Socket.io setup for production environment
const io = new Server(server, {
  cors: {
    origin: "*", // Allow connections from any domain (crucial for hosting)
    methods: ["GET", "POST"],
  },
  pingTimeout: 60000,
});

const AUCTION_TIMER_SECONDS = 10;

// Method Change: GoDaddy assigns a specific named pipe or port.
const PORT = process.env.PORT || 3001;

// --- SERVE FILES ---
app.use(express.static(path.join(__dirname)));

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

// Load rooms from DB on startup (Persistence)
async function loadRoomsFromDB() {
  // Skip if MongoDB is not connected
  if (mongoose.connection.readyState !== 1) {
    console.log('⚠️  Skipping room restoration - MongoDB not connected');
    return;
  }
  
  try {
    const dbRooms = await Room.find({});
    dbRooms.forEach(dr => {
      rooms[dr.roomId] = dr.toObject();
      rooms[dr.roomId].timerInterval = null;
      rooms[dr.roomId].timerPaused = true;
      rooms[dr.roomId].sellingInProgress = false;
      // We don't restore Intervals here, they restart on user interaction if needed
    });
    console.log(`Restored ${dbRooms.length} rooms from database.`);
  } catch (e) {
    console.error("Failed to restore rooms:", e);
  }
}
loadRoomsFromDB();

// Helper to save room to DB
async function saveRoomToDB(roomId) {
  // Skip if MongoDB is not connected
  if (mongoose.connection.readyState !== 1) {
    return; // Silently skip saving if DB is not available
  }
  
  const r = rooms[roomId];
  if (!r) return;
  
  try {
    // Helper to sanitize object/map for Mongoose Map<String, ...>
    // Ensures all keys are strings to prevent "Mongoose maps do not support..." errors
    const sanitizeMap = (data) => {
        if (!data) return {};
        if (data instanceof Map) return Object.fromEntries(data);
        
        // If it's a plain object, ensure keys are strings
        const sanitized = {};
        for (const [key, value] of Object.entries(data)) {
            sanitized[String(key)] = value;
        }
        return sanitized;
    };

    // Convert Map objects to plain objects for MongoDB
    const roomData = {
      ...r,
      timerInterval: undefined, // Don't save interval
      playerNames: sanitizeMap(r.playerNames),
      squads: sanitizeMap(r.squads)
    };
    
    await Room.findOneAndUpdate(
      { roomId },
      roomData,
      { upsert: true }
    );
  } catch (e) {
    console.error(`Error saving room ${roomId} to DB:`, e.message);
  }
}


// --- TIMER LOGIC ---
function startTimer(roomId) {
  const r = rooms[roomId];
  if (!r) return;

  if (r.timerInterval && r.timer > AUCTION_TIMER_SECONDS - 2) return;

  if (r.timerInterval) clearInterval(r.timerInterval);

  r.timer = AUCTION_TIMER_SECONDS;
  r.timerPaused = false;
  
  r.timerEndTime = Date.now() + (r.timer * 1000);

  io.to(roomId).emit("timer_tick", r.timer);
  io.to(roomId).emit("timer_status", false);

  r.timerInterval = setInterval(() => {
    if (r.timerPaused) {
       r.timerEndTime += 1000;
       return;
    }
    
    const remaining = Math.ceil((r.timerEndTime - Date.now()) / 1000);
    r.timer = remaining;

    io.to(roomId).emit("timer_tick", r.timer);
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
    io.to(roomId).emit("open_squad_selection");
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

  startTimer(roomId);
}

// --- AUTH MIDDLEWARE ---
io.use((socket, next) => {
  const playerId = socket.handshake.auth.playerId;
  socket.playerId = playerId || "guest_" + socket.id;
  next();
});

// --- SOCKET HANDLERS ---
io.on("connection", (socket) => {
  console.log(`User Connected: ${socket.id} (PID: ${socket.playerId})`);

  socket.on("pingServer", () => socket.emit("pongServer"));

  // 1. CREATE ROOM
  socket.on("create_room", ({ roomId, password, config, playerName }) => {
    if (rooms[roomId]) return socket.emit("error_message", "Room Exists!");

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
  socket.on("join_room", ({ roomId, password, playerName }) => {
    const r = rooms[roomId];
    if (!r || r.password !== password)
      return socket.emit("error_message", "Invalid Credentials");

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

    const myTeam = r.teams.find((t) => t.ownerPlayerId === socket.playerId);
    if (myTeam) {
      myTeam.ownerSocketId = socket.id;
      socket.emit("team_claim_success", myTeam.bidKey);
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
    });

    saveRoomToDB(roomId);

    io.to(roomId).emit("lobby_update", {
      teams: r.teams,
      userCount: r.users.length,
    });
  });

  socket.on("request_sync", () => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (r) {
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
      });
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

    // Check if user already owns ANY team
    const existingTeam = r.teams.find((t) => t.ownerPlayerId === socket.playerId);
    
    if (existingTeam) {
      // User already has a team
      if (existingTeam.bidKey === key) {
        // Trying to claim the same team again - just confirm ownership
        existingTeam.ownerSocketId = socket.id;
        if (email) existingTeam.playerEmail = email;
        socket.emit("team_claim_success", key);
        return;
      } else {
        // Trying to claim a different team - BLOCKED
        return socket.emit("error_message", `You already own ${existingTeam.name}! Cannot switch teams.`);
      }
    }

    // User doesn't have a team yet - allow claiming
    const t = r.teams.find((x) => x.bidKey === key);
    
    if (!t) {
      return socket.emit("error_message", "Team not found!");
    }
    
    if (t.isTaken && t.ownerPlayerId !== socket.playerId) {
      return socket.emit("error_message", `${t.name} is already taken by another player!`);
    }
    
    // Claim the team
    t.isTaken = true;
    t.ownerSocketId = socket.id;
    t.ownerPlayerId = socket.playerId;
    
    // Attach player name to team
    if (r.playerNames && r.playerNames[socket.playerId]) {
      t.playerName = r.playerNames[socket.playerId];
    }
    
    // Store player email for profile tracking
    if (email) {
      t.playerEmail = email;
    }
    
    socket.emit("team_claim_success", key);
    saveRoomToDB(roomId);
    io.to(roomId).emit("lobby_update", {
      teams: r.teams,
      userCount: r.users.length,
    });
  });

  socket.on("reclaim_team", (key) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (!r) return;
    const t = r.teams.find((x) => x.bidKey === key);

    if (t && t.ownerPlayerId === socket.playerId) {
      t.ownerSocketId = socket.id;
      socket.emit("team_claim_success", key);
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
          "Host denied your reclaim request."
        );
      }
    }
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
    
    if(!r || !isAdmin(socket)) return;

    const takenTeams = r.teams.filter(t => t.isTaken);
    
    if(takenTeams.length === 0) {
        return socket.emit("error_message", "No active teams joined yet!");
    }

    // 1. Assign Rosters
    if(takenTeams[0]) {
        takenTeams[0].roster = rcb;
        takenTeams[0].totalPlayers = rcb.length;
        takenTeams[0].budget = 10000000;
        console.log(`Auto-assigned RCB roster to ${takenTeams[0].name}`);
    }
    
    if(takenTeams[1]) {
        takenTeams[1].roster = csk;
        takenTeams[1].totalPlayers = csk.length;
        takenTeams[1].budget = 10000000;
        console.log(`Auto-assigned CSK roster to ${takenTeams[1].name}`);
    }

    // 2. Ensure they are marked as valid for simulation
    // (start_auction filters by isTaken, so we are good)
    
    // 3. Sync Updated Rosters to Client
    io.to(roomId).emit("lobby_update", {
        teams: r.teams,
        userCount: r.users.length
    });

    // 4. Skip to Squad Selection
    r.state.isActive = false;
    io.to(roomId).emit("open_squad_selection", { teams: r.teams }); // Send teams directly as fallback
  });

  socket.on("start_auction", ({ queue }) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (r && isAdmin(socket)) {
      const activeTeams = r.teams.filter(t => t.isTaken);
      r.teams = activeTeams.map((t) => ({
        ...t,
        roster: [],
        totalSpent: 0,
        totalPlayers: 0,
      }));
      r.auctionQueue = queue;
      r.state.isActive = true;
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

    saveRoomToDB(roomId);
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

  socket.on("end_auction_trigger", () => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (isAdmin(socket) && r) {
      stopTimer(roomId);
      r.state.isActive = false;
      io.to(roomId).emit("open_squad_selection");
    }
  });

  socket.on("submit_squad", ({ teamKey, squad, batImpact, bowlImpact, captain }) => {
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
  });

  socket.on("startTournament", (data) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (r && isAdmin(socket)) {
      runSimulationLogic(roomId, r);
    }
  });

  socket.on("request_tournament_data", ({ roomId }) => {
    const rId = roomId || getRoomId(socket);
    const r = rooms[rId];
    if (r && r.lastTournamentResults) {
      socket.emit("tournament_data_response", { tournamentResults: r.lastTournamentResults });
    }
  });

  // Chat Message Handler
  socket.on("chat_message", (data) => {
    const roomId = getRoomId(socket);
    if (roomId) {
      // Broadcast message to all players in the room
      io.to(roomId).emit("chat_message", {
        playerName: data.playerName,
        message: data.message,
        timestamp: data.timestamp || Date.now()
      });
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
      const team = r.teams.find(t => t.ownerPlayerId === socket.playerId);
      if (team) {
        team.playerName = data.playerName;
        io.to(roomId).emit("lobby_update", {
          teams: r.teams,
          userCount: r.users.length
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

  // ===================================================================
  // 🎭 BLIND AUCTION HANDLERS
  // ===================================================================

  // Create blind auction room
  socket.on("create_blind_room", ({ roomId, password, playerName, gameType }) => {
    console.log('🎭 CREATE_BLIND_ROOM received:', { roomId, password, playerName, gameType });
    
    let finalRoomId = roomId;
    
    // If room exists, auto-generate a unique ID
    if (rooms[roomId]) {
      console.log('⚠️  Room already exists:', roomId, '- Auto-generating unique ID...');
      
      // Try adding numbers 1-99 to find available room
      let found = false;
      for (let i = 1; i <= 99; i++) {
        const newId = roomId + i;
        if (!rooms[newId]) {
          finalRoomId = newId;
          found = true;
          console.log('✅ Generated unique room ID:', finalRoomId);
          break;
        }
      }
      
      // If still not found, use timestamp
      if (!found) {
        finalRoomId = roomId + Date.now().toString().slice(-4);
        console.log('✅ Generated timestamp-based room ID:', finalRoomId);
      }
    }

    console.log('✅ Creating new blind auction room:', finalRoomId);

    rooms[finalRoomId] = {
      roomId: finalRoomId,
      password,
      gameType: 'blind',
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
        contestBids: {} // teamKey -> amount
      }
    };

    socket.join(finalRoomId);
    rooms[finalRoomId].users.push(socket.id);
    
    if (playerName) {
      rooms[finalRoomId].playerNames[socket.playerId] = playerName;
    }
    
    saveRoomToDB(finalRoomId);
    console.log('✅ Room created successfully, emitting roomcreated event');
    socket.emit("roomcreated", finalRoomId);
  });

  // Join blind auction room
  socket.on("join_blind_room", ({ roomId, password, playerName }) => {
    console.log('🎭 JOIN_BLIND_ROOM received:', { roomId, password, playerName });
    
    const r = rooms[roomId];
    
    if (!r) {
      console.log('❌ Room not found:', roomId);
      return socket.emit("error_message", "Room not found!");
    }
    
    if (r.password !== password) {
      console.log('❌ Invalid password for room:', roomId);
      return socket.emit("error_message", "Invalid password!");
    }

    console.log('✅ Joining room:', roomId);

    socket.join(roomId);
    if (!r.users.includes(socket.id)) r.users.push(socket.id);

    if (playerName) {
      if (!r.playerNames) r.playerNames = {};
      r.playerNames[socket.playerId] = playerName;
    }

    const isAdminReconnected = r.adminPlayerId === socket.playerId;
    if (isAdminReconnected) {
      r.adminSocketId = socket.id;
      console.log('✅ Admin reconnected to room:', roomId);
    }

    console.log('✅ Emitting room_joined event');
    socket.emit("room_joined", {
      roomId,
      isAdmin: isAdminReconnected,
      lobbyState: { teams: r.teams, userCount: r.users.length }
    });

    saveRoomToDB(roomId);
    io.to(roomId).emit("lobby_update", {
      teams: r.teams,
      userCount: r.users.length
    });
    
    console.log(`✅ User joined room ${roomId}. Total users: ${r.users.length}`);
  });

  // Start blind auction
  socket.on("start_blind_auction", ({ exchangeEnabled, queue }) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    
    if (r && isAdmin(socket)) {
      const activeTeams = r.teams.filter(t => t.isTaken);
      r.teams = activeTeams.map((t) => ({
        ...t,
        roster: [],
        totalSpent: 0,
        totalPlayers: 0
      }));

      // Use client queue or fallback to test queue
      r.auctionQueue = queue || buildBlindAuctionQueue();
      r.state.isActive = true;
      r.blindAuction.exchangeEnabled = exchangeEnabled;

      saveRoomToDB(roomId);
      
      io.to(roomId).emit("blind_auction_started", {
        teams: r.teams,
        exchangeEnabled: exchangeEnabled
      });

      // Start first player
      startNextBlindPlayer(roomId);
    }
  });

  // Submit sealed bid
  socket.on("submit_blind_bid", ({ teamKey, amount }) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    
    if (!r || !r.state.isActive || !r.blindAuction.currentPlayer) return;

    const team = r.teams.find(t => t.bidKey === teamKey);
    if (!team) return;

    // Verify ownership
    if (team.ownerSocketId !== socket.id && team.ownerPlayerId !== socket.playerId) {
      return socket.emit("error_message", "Authorization Failed");
    }

    // Store bid
    if (!r.blindAuction.currentBids) r.blindAuction.currentBids = {};
    r.blindAuction.currentBids[teamKey] = {
      teamKey: teamKey,
      teamName: team.name,
      amount: amount,
      submitted: true,
      isPassed: amount === 0
    };

    console.log(`Bid/Pass received from ${team.name}: ₹${amount}`);

    // Check if all teams have bid or passed
    const activeTeams = r.teams.filter(t => t.isTaken);
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

    console.log(`Winner rejected all exchange requests for ${r.blindAuction.currentPlayer.name}`);
    r.blindAuction.requests = {};
    
    io.to(roomId).emit("exchange_requests_rejected", {
        message: "Winner rejected all offers"
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

    // 'fromTeam' in client event is actually the requester's key if called via the new 'OFFER' buttons
    // But let's keep the params consistent: toTeam is the winner, fromTeam is the requester
    if (!r.blindAuction.requests) r.blindAuction.requests = {};
    r.blindAuction.requests[fromTeam] = true;

    console.log(`Exchange request from ${fromTeam} for ${r.blindAuction.currentPlayer.name}`);

    // Notify the winner (toTeam) that someone requested
    io.to(roomId).emit("exchange_requests_updated", {
        requestors: Object.keys(r.blindAuction.requests)
    });
  });

  // Winner clicks Exchange (Accepts the idea of selling)
  socket.on("start_exchange_contest", () => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (!r || !r.blindAuction.winner) return;

    // Verify the one who clicked is the winner
    const team = r.teams.find(t => t.ownerSocketId === socket.id);
    if (!team || team.bidKey !== r.blindAuction.winner.teamKey) return;

    // Stop the decision window timer
    clearBlindAuctionTimers(r);

    const requestorKeys = Object.keys(r.blindAuction.requests || {});
    
    if (requestorKeys.length === 0) return;

    if (requestorKeys.length === 1) {
        // Only one requestor, skip contest and go straight to acceptance
        const targetTeamKey = requestorKeys[0];
        const targetTeam = r.teams.find(t => t.bidKey === targetTeamKey);
        
        if (targetTeam) {
            console.log(`Single requestor ${targetTeam.name}. Auto-accepting exchange.`);
            handleAcceptExchange(roomId, r, r.blindAuction.winner.teamKey, targetTeam);
        }
    } else {
        // MULTIPLE REQUESTORS: Start Contest Round
        r.blindAuction.isContestActive = true;
        r.blindAuction.contestBids = {};
        
        console.log(`Multiple requestors (${requestorKeys.length}). Starting contest.`);
        
        io.to(roomId).emit("exchange_contest_started", {
            requestors: requestorKeys,
            basePrice: r.blindAuction.winner.amount,
            player: r.blindAuction.currentPlayer
        });
    }
  });

  // Submit Contest Bid
  socket.on("submit_contest_bid", ({ amount }) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (!r || !r.blindAuction.isContestActive) return;

    const team = r.teams.find(t => t.ownerSocketId === socket.id);
    if (!team || !r.blindAuction.requests[team.bidKey]) return;

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

    const team = r.teams.find(t => t.ownerSocketId === socket.id);
    if (!team || !r.blindAuction.tieBreakerTeams.includes(team.bidKey)) return;

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

    console.log(`Resolving Tie-Breaker for ${r.blindAuction.currentPlayer.name}`);

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
        const winnerTeam = r.teams.find(t => t.bidKey === bestBidder);
        console.log(`🏆 Contest Winner: ${winnerTeam.name} with ₹${maxAmount}`);

        // Update winner object to the NEW owner and NEW amount
        r.blindAuction.winner = {
            teamKey: winnerTeam.bidKey,
            teamName: winnerTeam.name,
            amount: maxAmount,
            submitted: true
        };

        io.to(roomId).emit("exchange_contest_finalized", {
            winner: winnerTeam.name,
            amount: maxAmount
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
        fromTeam: fromTeamKey
      });

      r.blindAuction.winner = {
        teamKey: toTeamObj.bidKey,
        teamName: toTeamObj.name,
        amount: winner.amount,
        submitted: true
      };

      setTimeout(() => finalizeSale(roomId), 1500);
  }


  // Accept exchange
  socket.on("accept_exchange", ({ fromTeam }) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (!r) return;

    const toTeamObj = r.teams.find(t => t.ownerSocketId === socket.id);
    if (toTeamObj) {
      handleAcceptExchange(roomId, r, fromTeam, toTeamObj);
    }
  });

  // Reject exchange
  socket.on("reject_exchange", ({ fromTeam }) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (!r) return;

    const toTeamObj = r.teams.find(t => t.ownerSocketId === socket.id);
    
    if (toTeamObj) {
      io.to(roomId).emit("exchange_rejected", {
        fromTeam: fromTeam,
        toTeamName: toTeamObj.name
      });
    }
  });

  socket.on("disconnect", () => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (r) {
      r.users = r.users.filter((id) => id !== socket.id);
      io.to(roomId).emit("lobby_update", {
        teams: r.teams,
        userCount: r.users.length,
      });
    }
  });
});

// =================================================================
// 🚀 NEW SIMULATION ENGINE (IMPORTED FROM ai.js)
// =================================================================
const ai = require('./ai');

async function runSimulationLogic(roomId, r) {
    if (!r) return;
    
    // Prepare teams for the AI
    const tourneyTeams = r.teams.filter(t => t.isTaken).map(t => {
        const squad = r.squads[t.bidKey];
        if (!squad) return null;
        return {
            ...t,
            squad: squad.squad,
            batImpact: squad.batImpact,
            bowlImpact: squad.bowlImpact,
            captain: squad.captain
        };
    }).filter(t => t);

    // Call the AI Engine
    try {
        console.log(`Running AI Simulation for Room ${roomId} with ${tourneyTeams.length} teams.`);
        const aiResults = ai.runFullTournament(tourneyTeams);

        // Merge with Room Data for Frontend
        const results = {
            ...aiResults,
            squads: r.squads, 
            teams: r.teams
        };

        // Save for persistence
        r.lastTournamentResults = results;

        // Update user profiles with tournament results
        await updateUserProfiles(roomId, r, aiResults);
        
        // Save win record to database
        await saveWinRecord(roomId, r, aiResults);

        io.to(roomId).emit("tournamentComplete", results);

    } catch (e) {
        console.error("AI Simulation Failed:", e);
        io.to(roomId).emit("simulation_error", e.message);
    }
}

// Helper function to update user profiles after tournament
async function updateUserProfiles(roomId, r, aiResults) {
    try {
        console.log('🔍 Starting profile updates for room:', roomId);
        
        // Determine game type (default to 'normal' for existing rooms)
        const gameType = r.gameType || 'normal';
        console.log('🎮 Game Type:', gameType);
        
        // Determine winner and runner-up
        const winner = aiResults.winner;
        const runnerUp = aiResults.runnerUp;
        
        console.log('🏆 Winner:', winner?.name);
        console.log('🥈 Runner-up:', runnerUp?.name);
        
        // Update each team's owner profile
        const takenTeams = r.teams.filter(t => t.isTaken);
        console.log(`📊 Processing ${takenTeams.length} teams`);
        
        for (const team of takenTeams) {
            console.log(`\n👤 Processing team: ${team.name}`);
            
            // Find user by team's player name or email
            const playerEmail = team.playerEmail || team.ownerEmail;
            console.log(`   Email found: ${playerEmail || 'NONE'}`);
            
            if (!playerEmail) {
                console.log(`   ⚠️  Skipping ${team.name} - no email found`);
                continue;
            }

            const user = await User.findOne({ email: playerEmail });
            if (!user) {
                console.log(`   ❌ User not found in database for email: ${playerEmail}`);
                continue;
            }
            
            console.log(`   ✅ User found: ${user.name}`);

            // Determine result
            let result = 'participated';
            let won = false;
            if (winner && team.name === winner.name) {
                result = 'won';
                won = true;
            } else if (runnerUp && team.name === runnerUp.name) {
                result = 'runner-up';
            }
            
            console.log(`   🎯 Result: ${result}`);

            // Update overall stats
            if (!user.stats) {
                user.stats = { matchesPlayed: 0, matchesWon: 0, auctionsParticipated: 0 };
            }
            user.stats.matchesPlayed += 1;
            user.stats.auctionsParticipated += 1;
            if (won) user.stats.matchesWon += 1;
            
            // Update game-specific stats
            if (gameType === 'normal') {
                if (!user.normalAuction) {
                    user.normalAuction = { matchesPlayed: 0, matchesWon: 0, winRate: 0 };
                }
                user.normalAuction.matchesPlayed += 1;
                if (won) user.normalAuction.matchesWon += 1;
                user.normalAuction.winRate = Math.round((user.normalAuction.matchesWon / user.normalAuction.matchesPlayed) * 100);
                console.log(`   📊 Normal Auction: ${user.normalAuction.matchesPlayed} played, ${user.normalAuction.matchesWon} won`);
            } else if (gameType === 'blind') {
                if (!user.blindAuction) {
                    user.blindAuction = { matchesPlayed: 0, matchesWon: 0, winRate: 0, exchangesMade: 0, exchangesReceived: 0 };
                }
                user.blindAuction.matchesPlayed += 1;
                if (won) user.blindAuction.matchesWon += 1;
                user.blindAuction.winRate = Math.round((user.blindAuction.matchesWon / user.blindAuction.matchesPlayed) * 100);
                
                // Track exchanges if available
                if (team.exchangesMade) user.blindAuction.exchangesMade += team.exchangesMade;
                if (team.exchangesReceived) user.blindAuction.exchangesReceived += team.exchangesReceived;
                
                console.log(`   🎭 Blind Auction: ${user.blindAuction.matchesPlayed} played, ${user.blindAuction.matchesWon} won`);
            }
            
            console.log(`   📈 Overall Stats: ${user.stats.matchesPlayed} played, ${user.stats.matchesWon} won`);

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
                    squad: team.roster.map(player => ({
                        name: player.name,
                        role: player.role,
                        price: player.price,
                        type: player.type
                    })),
                    exchangesInvolved: team.exchangesInvolved || 0
                };
                user.auctionHistory.push(historyEntry);
                console.log(`   📝 Added ${gameType} auction history with ${team.roster.length} players`);
            } else {
                console.log(`   ⚠️  No squad found for ${team.bidKey}`);
            }

            await user.save();
            console.log(`   ✅ Profile saved for ${user.name} (${result})`);
        }
        
        console.log('\n✅ Profile updates completed successfully!');
    } catch (error) {
        console.error('❌ Error updating user profiles:', error);
    }
}

// Helper function to save win record to database
async function saveWinRecord(roomId, r, aiResults) {
    // Skip if MongoDB is not connected
    if (mongoose.connection.readyState !== 1) {
        console.log('⚠️  Skipping win record save - MongoDB not connected');
        return;
    }
    
    try {
        console.log('💾 Saving win record for room:', roomId);
        
        // Determine game type
        const gameType = r.gameType || 'normal';
        
        // Extract winner and runner-up
        const winner = aiResults.winner;
        const runnerUp = aiResults.runnerUp;
        
        if (!winner) {
            console.log('⚠️  No winner found, skipping win record');
            return;
        }
        
        // Build players list
        const players = r.teams.filter(t => t.isTaken).map(team => {
            return {
                playerName: team.playerName || 'Unknown',
                playerEmail: team.playerEmail || team.ownerEmail,
                playerId: team.ownerPlayerId,
                teamName: team.name,
                teamKey: team.bidKey
            };
        });
        
        // Find winner player info
        const winnerTeam = r.teams.find(t => t.name === winner.name);
        const runnerUpTeam = runnerUp ? r.teams.find(t => t.name === runnerUp.name) : null;
        
        // Build standings from aiResults
        const standings = aiResults.standings ? aiResults.standings.map((team, index) => ({
            position: index + 1,
            teamName: team.name,
            played: team.stats?.p || team.stats?.played || 0,
            won: team.stats?.w || team.stats?.won || 0,
            lost: team.stats?.l || team.stats?.lost || 0,
            points: team.stats?.pts || team.stats?.points || 0,
            nrr: team.stats?.nrr || 0
        })) : [];
        
        // Create win record
        const winRecord = new Win({
            roomId: roomId,
            gameType: gameType,
            playedAt: new Date(),
            
            players: players,
            
            winner: {
                teamName: winner.name,
                teamKey: winnerTeam?.bidKey,
                playerName: winnerTeam?.playerName || 'Unknown',
                playerEmail: winnerTeam?.playerEmail || winnerTeam?.ownerEmail,
                playerId: winnerTeam?.ownerPlayerId,
                totalPoints: winner.stats?.pts || winner.stats?.points || 0,
                wins: winner.stats?.w || winner.stats?.won || 0,
                losses: winner.stats?.l || winner.stats?.lost || 0,
                nrr: winner.stats?.nrr || 0
            },
            
            runnerUp: runnerUp ? {
                teamName: runnerUp.name,
                teamKey: runnerUpTeam?.bidKey,
                playerName: runnerUpTeam?.playerName || 'Unknown',
                playerEmail: runnerUpTeam?.playerEmail || runnerUpTeam?.ownerEmail,
                playerId: runnerUpTeam?.ownerPlayerId,
                totalPoints: runnerUp.stats?.pts || runnerUp.stats?.points || 0,
                wins: runnerUp.stats?.w || runnerUp.stats?.won || 0,
                losses: runnerUp.stats?.l || runnerUp.stats?.lost || 0
            } : undefined,
            
            stats: {
                totalMatches: aiResults.leagueMatches?.length || 0,
                totalTeams: r.teams.filter(t => t.isTaken).length,
                orangeCap: aiResults.orangeCap ? {
                    playerName: aiResults.orangeCap.name,
                    runs: aiResults.orangeCap.runs,
                    team: aiResults.orangeCap.team
                } : undefined,
                purpleCap: aiResults.purpleCap ? {
                    playerName: aiResults.purpleCap.name,
                    wickets: aiResults.purpleCap.wkts || aiResults.purpleCap.wickets,
                    team: aiResults.purpleCap.team
                } : undefined,
                mvp: aiResults.mvp ? {
                    playerName: aiResults.mvp.name,
                    points: aiResults.mvp.pts || aiResults.mvp.points,
                    team: aiResults.mvp.team
                } : undefined
            },
            
            standings: standings,
            
            metadata: {
                budget: r.config?.budget || 1000000000,
                totalPlayers: r.auctionQueue?.length || 0,
                exchangeEnabled: r.blindAuction?.exchangeEnabled || false
            }
        });
        
        // Save to database
        await winRecord.save();
        
        console.log('✅ Win record saved successfully!');
        console.log(`   🏆 Winner: ${winner.name}`);
        console.log(`   🥈 Runner-up: ${runnerUp?.name || 'N/A'}`);
        console.log(`   👥 Players: ${players.length}`);
        
    } catch (error) {
        console.error('❌ Error saving win record:', error);
    }
}

// =================================================================
// 🎭 BLIND AUCTION HELPER FUNCTIONS
// =================================================================

function buildBlindAuctionQueue() {
    // Reuse the same player database and queue building logic from normal auction
    // For now, return a simplified queue for testing
    const testPlayers = [
        { name: "Virat Kohli", category: "Indian Batsman", roleKey: "batter", basePrice: 20000000, set: "Marquee" },
        { name: "Rohit Sharma", category: "Indian Batsman", roleKey: "batter", basePrice: 20000000, set: "Marquee" },
        { name: "Jasprit Bumrah", category: "Indian Bowler", roleKey: "bowler", basePrice: 20000000, set: "Marquee" },
        { name: "Hardik Pandya", category: "Indian All-rounder", roleKey: "allrounder", basePrice: 20000000, set: "Marquee" },
        { name: "KL Rahul", category: "Indian Wicketkeeper", roleKey: "wk", basePrice: 15000000, set: "Premium" }
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
        console.log('Blind auction complete! Moving to squad selection...');
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
        timerDuration: r.blindAuction.bidTimer
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
    if (!r) return;

    let timeLeft = r.blindAuction.bidTimer;

    // Clear existing timer
    clearBlindAuctionTimers(r);
    
    // Reset requests
    r.blindAuction.requests = {};
    r.blindAuction.isContestActive = false;
    r.blindAuction.contestBids = {};

    r.blindAuction.timerInterval = setInterval(() => {
        timeLeft--;
        io.to(roomId).emit("blind_timer_tick", timeLeft);

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
    if (!r) return;

    // CLEAR TIMER if it was running (stops it if we revealed early)
    if (r.blindAuction.timerInterval) {
        clearInterval(r.blindAuction.timerInterval);
        r.blindAuction.timerInterval = null;
    }

    console.log('Revealing bids for:', r.blindAuction.currentPlayer.name);

    // Get all bids
    const bids = Object.values(r.blindAuction.currentBids);

    // Add zero bids for teams that didn't bid
    const activeTeams = r.teams.filter(t => t.isTaken);
    activeTeams.forEach(team => {
        if (!r.blindAuction.currentBids[team.bidKey]) {
            bids.push({
                teamKey: team.bidKey,
                teamName: team.name,
                amount: 0,
                submitted: false
            });
        }
    });

    // Sort bids (highest first)
    bids.sort((a, b) => b.amount - a.amount);

    // CHECK FOR TIE-BREAKER
    if (bids.length >= 2 && bids[0].amount > 0 && bids[0].amount === bids[1].amount) {
        // Collect all teams tied for the top amount
        const topAmount = bids[0].amount;
        const tiedTeams = bids.filter(b => b.amount === topAmount);
        
        r.blindAuction.isTieBreakerActive = true;
        r.blindAuction.tieBreakerTeams = tiedTeams.map(t => t.teamKey);
        r.blindAuction.tieBreakerAmount = topAmount;
        r.blindAuction.tieBreakerBids = {};

        console.log(`⚖️ Tie-breaker started between: ${tiedTeams.map(t => t.teamName).join(', ')} at ₹${topAmount}`);
        
        io.to(roomId).emit("tie_breaker_started", {
            teams: tiedTeams,
            amount: topAmount,
            player: r.blindAuction.currentPlayer
        });
        return; // Pause revealBids until tie is broken
    }

    const winner = bids.length > 0 && bids[0].amount > 0 ? bids[0] : null;
    r.blindAuction.winner = winner;

    console.log('Final Bids:', bids.map(b => `${b.teamName}: ₹${b.amount}`).join(', '));

    // Emit reveal
    io.to(roomId).emit("bids_revealed", {
        playerName: r.blindAuction.currentPlayer.name,
        bids: bids,
        winner: winner
    });

    if (winner) {
        // Start a decision window for the winner to see requests
        console.log(`${r.blindAuction.currentPlayer.name} - Highest Bid: ₹${winner.amount} by ${winner.teamName}`);
        
        // Let's give 15 seconds for requesting and winner to decide
        let decisionTime = 15;
        r.blindAuction.timer = decisionTime; // Sync for late joins
        
        // Stop any existing interval (though should be null)
        if (r.blindAuction.timerInterval) clearInterval(r.blindAuction.timerInterval);
        
        r.blindAuction.timerInterval = setInterval(() => {
            decisionTime--;
            r.blindAuction.timer = decisionTime;
            
            // Re-use blind_timer_tick for the exchange window countdown
            io.to(roomId).emit("blind_timer_tick", decisionTime);

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
        
        // Auto-advance after 5 seconds for UNSOLD
        setTimeout(() => {
            const currentRoom = rooms[roomId];
            // Check if room and player are still the same to avoid conflicts
            if (currentRoom && currentRoom.blindAuction.currentPlayer && 
                currentRoom.blindAuction.currentPlayer.name === r.blindAuction.currentPlayer.name) {
                
                console.log(`Auto-skipping unsold player: ${currentRoom.blindAuction.currentPlayer.name}`);
                
                // Clear state for next player
                currentRoom.blindAuction.winner = null;
                clearBlindAuctionTimers(currentRoom);
                
                // Emit to clients so they can hide overlays
                io.to(roomId).emit("unsold_finalized", {
                   message: `${currentRoom.blindAuction.currentPlayer.name} was Unsold`
                });

                // Advance
                currentRoom.auctionIndex++;
                startNextBlindPlayer(roomId);
            }
        }, 5000);
    }
}

function startExchangeTimer(roomId) {
    const r = rooms[roomId];
    if (!r) return;

    let timeLeft = r.blindAuction.exchangeTimer;

    // Clear any existing exchange timer
    if (r.blindAuction.exchangeInterval) {
        clearInterval(r.blindAuction.exchangeInterval);
    }

    r.blindAuction.exchangeInterval = setInterval(() => {
        timeLeft--;

        if (timeLeft <= 0) {
            clearInterval(r.blindAuction.exchangeInterval);
            r.blindAuction.exchangeInterval = null;
            // Auto-finalize if time runs out
            finalizeSale(roomId);
        }
    }, 1000);
}

function finalizeSale(roomId) {
    const r = rooms[roomId];
    if (!r || !r.blindAuction.winner) return;

    const winner = r.blindAuction.winner;
    const team = r.teams.find(t => t.bidKey === winner.teamKey);
    
    // Safety: Reset winner to prevent double-processing if function is called twice
    r.blindAuction.winner = null;
    
    // Clear any active timers
    clearBlindAuctionTimers(r);

    if (team) {
        // Prevent adding same player twice (extra safety)
        const isAlreadyAdded = team.roster.some(p => p.name === r.blindAuction.currentPlayer.name);
        
        if (!isAlreadyAdded) {
            // Add player to team roster
            team.roster.push({
                ...r.blindAuction.currentPlayer,
                price: winner.amount,
                status: "SOLD"
            });
            team.totalSpent += winner.amount;
            team.totalPlayers += 1;
            team.budget -= winner.amount;

            console.log(`✅ ${r.blindAuction.currentPlayer.name} SOLD to ${team.name} for ₹${winner.amount}`);
        } else {
            console.log(`⚠️ ${r.blindAuction.currentPlayer.name} was already in ${team.name}'s roster. Skipping duplicate.`);
        }
    }

    // Emit finalization
    io.to(roomId).emit("exchange_finalized", {
        teams: r.teams,
        message: team ? `${r.blindAuction.currentPlayer.name} sold to ${team.name}` : `${r.blindAuction.currentPlayer.name} sold`
    });

    // Save and move to next player
    saveRoomToDB(roomId);
    
    setTimeout(() => {
        r.auctionIndex++;
        startNextBlindPlayer(roomId);
    }, 2000);
}

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));