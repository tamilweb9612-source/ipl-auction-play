// ================================================================
// 🚀 FEATURE INTEGRATION - Server-Side Socket Handlers
// ================================================================
// Add this to your server.js file or import as a module

//const Achievement = require('./models/Achievement');

// ================================================================
// 1. PREDICT PRICE GAME - Server Handlers
// ================================================================

function setupPredictPriceGame(io, rooms) {
  const predictions = new Map(); // roomId -> { bets: Map, locked: boolean }
  const gameScores = new Map(); // roomId -> { teamId -> score }

  function startPredictGame(roomId, player) {
    const room = rooms[roomId];
    if (!room) return;

    predictions.set(roomId, { bets: new Map(), locked: false });

    io.to(roomId).emit("predict_game_start", {
      player: {
        id: player.id,
        name: player.name,
        role: player.role,
      },
      duration: 10, // 10 seconds to predict
    });

    // Lock predictions after 10 seconds
    setTimeout(() => {
      const gameData = predictions.get(roomId);
      if (gameData) {
        gameData.locked = true;
      }
    }, 10000);
  }

  function submitPrediction(socket, roomId, data) {
    const { prediction } = data;

    let gameData = predictions.get(roomId);
    if (!gameData) {
        // Recovery if missing
        gameData = { bets: new Map(), locked: false };
        predictions.set(roomId, gameData);
    }

    if (gameData.locked) {
        return socket.emit("error_message", "Predictions are locked!");
    }

    gameData.bets.set(socket.id, {
      teamId: socket.teamId,
      teamName: socket.teamName,
      prediction: prediction,
    });

    // Acknowledge submission
    socket.emit("prediction_submitted", { success: true });
  }

  function endPredictGame(roomId, player, actualPrice) {
    const gameData = predictions.get(roomId);
    if (!gameData) return;
    const roomPredictions = gameData.bets;

    // Calculate winners (closest predictions)
    const results = Array.from(roomPredictions.entries()).map(
      ([socketId, data]) => ({
        socketId,
        teamId: data.teamId,
        teamName: data.teamName,
        prediction: data.prediction,
        difference: Math.abs(actualPrice - data.prediction),
      }),
    );

    results.sort((a, b) => a.difference - b.difference);

    // Award points
    const winners = results.slice(0, 3).map((r, index) => {
      const points = [50, 30, 20][index] || 0;

      // Update scores
      if (!gameScores.has(roomId)) {
        gameScores.set(roomId, new Map());
      }
      const scores = gameScores.get(roomId);
      const currentScore = scores.get(r.teamId) || 0;
      scores.set(r.teamId, currentScore + points);

      return {
        ...r,
        points,
        rank: index + 1,
      };
    });

    io.to(roomId).emit("predict_game_results", {
      actualPrice,
      predictions: results,
      winners,
    });

    // Update leaderboard
    io.to(roomId).emit("predict_leaderboard_update", {
      scores: gameScores.get(roomId),
      teamNames: {}, // Populate from room data
    });

    // Cleanup
    predictions.delete(roomId);
  }

  return {
    startPredictGame,
    submitPrediction,
    endPredictGame,
  };
}

// ================================================================
// 2. TRADE SYSTEM - Server Handlers
// ================================================================

// ================================================================
// 2. TRADE SYSTEM - Server Handlers
// ================================================================

// ================================================================
// 2. TRADE SYSTEM - Server Handlers
// ================================================================

// ================================================================
// 2. TRADE SYSTEM - Server Handlers
// ================================================================

function setupTradeSystem(io, rooms) {
  const tradeData = new Map();

  function initRoom(roomId) {
    if (!tradeData.has(roomId)) {
      tradeData.set(roomId, {
        requests: [],
        history: [],
      });
    }
    return tradeData.get(roomId);
  }

  // Helper: check if player is locked in another active trade
  function isPlayerLocked(store, playerName) {
    return store.requests.some(
      (r) => r.status === "OPEN" && r.details.playerName === playerName, // Locked if being offered by owner
    );
  }

  // Helper: robust category matcher
  function matchCategory(player, category) {
    if (!player || !category) return false;
    const pRole = (player.role || "").toLowerCase();
    const cat = category.toLowerCase();

    // Direct Match
    if (pRole.includes(cat)) return true;

    // Synonyms / Mapping
    if (cat === "pacer" || cat === "fast bowler") {
      return (
        pRole.includes("fast") ||
        pRole.includes("medium") ||
        pRole.includes("seam")
      );
    }
    if (cat === "spinner" || cat === "spin") {
      return (
        pRole.includes("spin") || pRole.includes("leg") || pRole.includes("off")
      );
    }
    if (cat === "wicketkeeper" || cat === "wk") {
      return (
        pRole.includes("keeper") || pRole.includes("wk") || player.type === "wk"
      );
    }
    if (cat === "all rounder") {
      return pRole.includes("all") || player.type === "ar";
    }
    if (cat === "opener") {
      return (
        pRole.includes("opener") || pRole.includes("1") || pRole.includes("2")
      );
    }
    if (cat === "finisher") {
      return (
        pRole.includes("finisher") || pRole.includes("6") || pRole.includes("7")
      );
    }

    return false;
  }

  // 1. Create Trade Request
  function createTradeRequest(socket, roomId, data) {
    const room = rooms[roomId];
    if (!room) return;

    // 3. Trade Lock removed per user request

    const store = initRoom(roomId);

    // Trade Rules: Min 2 players
    const activeTeams = room.teams.filter((t) => t.isTaken);
    const valid = activeTeams.every((t) => t.totalPlayers >= 2);

    const senderTeam = room.teams.find((t) => t.bidKey === socket.teamId);
    if (!senderTeam) return socket.emit("error_message", "Team not found");

    // 4. Player Locking Check
    if (data.type !== "CASH_TRADE") {
      // PLAYER_TRADE or PLAYER_TO_CASH
      if (isPlayerLocked(store, data.details.playerName)) {
        return socket.emit(
          "error_message",
          `${data.details.playerName} is already in an active trade request!`,
        );
      }
      // Verify ownership
      const pExists = senderTeam.roster.find(
        (p) => p.name === data.details.playerName,
      );
      if (!pExists)
        return socket.emit("error_message", "Player not in your squad");
    }

    const requestId =
      Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

    const newRequest = {
      id: requestId,
      type: data.type,
      senderTeamId: senderTeam.bidKey,
      senderTeamName: senderTeam.name,
      details: data.details,
      status: "OPEN",
      createdAt: Date.now(),
      proposals: [],
    };

    store.requests.push(newRequest);
    io.to(roomId).emit("trade_update", {
      requests: store.requests,
      history: store.history,
    });

    socket.to(roomId).emit("notification", {
      title: "New Trade Request",
      message: `${senderTeam.name} has posted a new request.`,
    });
  }

  // 2. Submit Proposal
  function submitProposal(socket, roomId, data) {
    const { requestId, offerDetails } = data;
    const room = rooms[roomId];
    if (!room) return;

    // 3. Trade Lock removed per user request

    const store = initRoom(roomId);
    const request = store.requests.find((r) => r.id === requestId);

    if (!request || request.status !== "OPEN")
      return socket.emit("error_message", "Request not active");

    const proposerTeam = rooms[roomId].teams.find(
      (t) => t.bidKey === socket.teamId,
    );
    if (!proposerTeam) return;

    // 1. Category Filter Logic (Backend Verification)
    if (
      request.details.categories &&
      request.details.categories.length > 0 &&
      offerDetails.offeredPlayers
    ) {
      const reqCats = request.details.categories;

      for (const p of offerDetails.offeredPlayers) {
        const rosterP = proposerTeam.roster.find((rp) => rp.name === p.name);
        if (!rosterP) continue;

        // Check ANY match (OR logic between categories usually)
        const matches = reqCats.some((c) => matchCategory(rosterP, c));

        if (!matches) {
          return socket.emit(
            "error_message",
            `Player ${p.name} does not match requested categories.`,
          );
        }
      }
    }

    const existingIndex = request.proposals.findIndex(
      (p) => p.proposerTeamId === proposerTeam.bidKey,
    );

    const proposal = {
      id: "prop_" + Date.now(),
      proposerTeamId: proposerTeam.bidKey,
      proposerTeamName: proposerTeam.name,
      offer: offerDetails,
      timestamp: Date.now(),
    };

    if (existingIndex >= 0) request.proposals[existingIndex] = proposal;
    else request.proposals.push(proposal);

    io.to(roomId).emit("trade_update", {
      requests: store.requests,
      history: store.history,
    });
  }

  // 3. Accept Proposal (Execute Trade)
  function acceptProposal(socket, roomId, data, tradeInfo) {
    const { requestId, proposalId } = data;
    const room = rooms[roomId];
    if (!room) return;

    // 3. Trade Lock removed per user request

    const store = initRoom(roomId);

    const request = store.requests.find((r) => r.id === requestId);
    if (!request || request.status !== "OPEN")
      return socket.emit("error_message", "Request invalid");

    // SPECIAL HANDLING FOR DIRECT COMPLEX TRADES
    if (request.type === "DIRECT_COMPLEX") {
      console.log(`[TRADE] Executing DIRECT_COMPLEX trade ${requestId}`);
      const team1 = room.teams.find((t) => t.bidKey === request.senderTeamId); // Initiator
      const team2 = room.teams.find((t) => t.bidKey === request.targetTeamId); // Receiver (You)

      if (socket.teamId !== request.targetTeamId)
        return socket.emit(
          "error_message",
          "Not authorized to accept this trade",
        );
      if (!team1 || !team2)
        return socket.emit("error_message", "Teams invalid");

      // Verify Assets (Cash)
      const cash1 = request.details.offeredCash || 0;
      const cash2 = request.details.requestedCash || 0;

      if (team1.budget < cash1)
        return socket.emit("error_message", "Initiator lacks funds");
      if (team2.budget < cash2)
        return socket.emit("error_message", "You lack funds");

      // Verify Assets (Players) - Final safeguard
      const p1Names = request.details.offeredPlayerNames || [];
      const p2Names = request.details.requestedPlayerNames || [];

      for (const n of p1Names)
        if (!team1.roster.find((p) => p.name === n))
          return socket.emit("error_message", `Initiator no longer has ${n}`);
      for (const n of p2Names)
        if (!team2.roster.find((p) => p.name === n))
          return socket.emit("error_message", `You no longer have ${n}`);

      // EXECUTE
      // 1. Adjust Budget + Spent for Cash Transfer
      // NOTE: cash1 is raw value.
      const cashMultiplier = 1; // It is already raw

      // T1 pays T2
      team1.budget -= cash1;
      team1.totalSpent += cash1; // Outgoing cash = spent
      team2.budget += cash1;
      // team2 receives cash -> reduces net spend? Or just extra budget?
      // Usually "Spent" is strictly Auction + Player Buys.
      // If I sell a player for cash, my "Net Spend" goes down, effectively increasing budget.
      // Let's treat incoming cash as reducing 'totalSpent' to keep (100 - Spent = Budget) invariant true.
      team2.totalSpent -= cash1;

      // T2 pays T1
      team2.budget -= cash2;
      team2.totalSpent += cash2;
      team1.budget += cash2;
      team1.totalSpent -= cash2;

      // 2. Adjust Budget for Player Swaps (Cap Space Management)
      // Moving a player OUT releases thier price back to budget.
      // Moving a player IN consumes budget equal to their price.

      // Swap Players
      console.log(
        `[TRADE] Swapping players. T1->T2: ${p1Names.join(",")}, T2->T1: ${p2Names.join(",")}`,
      );
      p1Names.forEach((name) => {
        const idx = team1.roster.findIndex((p) => p.name === name);
        if (idx > -1) {
          const p = team1.roster.splice(idx, 1)[0];
          team1.totalPlayers--;

          // Budget Adjustment (T1 releases p, T2 absorbs p)
          const price = p.price || 0;
          team1.budget += price;
          team1.totalSpent -= price; // Refund spend
          
          team2.budget -= price;
          team2.totalSpent += price; // Add spend

          team2.roster.push(p);
          console.log(
            `[TRADE] Moved ${name} from ${team1.name} to ${team2.name} (Val: ${price})`,
          );
          team2.totalPlayers++;
        }
      });

      p2Names.forEach((name) => {
        const idx = team2.roster.findIndex((p) => p.name === name);
        if (idx > -1) {
          const p = team2.roster.splice(idx, 1)[0];
          team2.totalPlayers--;

          // Budget Adjustment (T2 releases p, T1 absorbs p)
          const price = p.price || 0;
          team2.budget += price;
          team2.totalSpent -= price; // Refund spend

          team1.budget -= price;
          team1.totalSpent += price; // Add spend

          team1.roster.push(p);
          console.log(
            `[TRADE] Moved ${name} from ${team2.name} to ${team1.name} (Val: ${price})`,
          );
          team1.totalPlayers++;
        }
      });

      request.status = "COMPLETED";
      store.requests = store.requests.filter((r) => r.id !== requestId);

      // History - Enhanced with full details
      const histText = `DIRECT TRADE: ${team1.name} exchanged [${p1Names.join(", ")} + ₹${cash1 / 10000000}Cr] for [${p2Names.join(", ")} + ₹${cash2 / 10000000}Cr] from ${team2.name}`;
      store.history.unshift({
        id: Date.now(),
        text: histText,
        timestamp: Date.now(),
        details: tradeInfo || {
          team1: team1.name,
          team2: team2.name,
          playersGiven: p1Names,
          playersReceived: p2Names,
          cashGiven: cash1 / 10000000,
          cashReceived: cash2 / 10000000,
          type: "DIRECT_COMPLEX",
          message: request.details.message || "",
        },
      });

      io.to(roomId).emit("trade_update", {
        requests: store.requests,
        history: store.history,
      });
      io.to(roomId).emit("lobby_update", {
        teams: room.teams,
        userCount: room.users.length,
      });

      // Notify Initiator (Team1)
      if (team1.ownerSocketId) {
          io.to(team1.ownerSocketId).emit("trade_notification", `${team2.name} accepted your trade!`);
      }
      return;
    }

    if (request.senderTeamId !== socket.teamId)
      return socket.emit("error_message", "Not your request");

    const proposal = request.proposals.find((p) => p.id === proposalId);
    if (!proposal) return socket.emit("error_message", "Proposal not found");

    const team1 = room.teams.find((t) => t.bidKey === request.senderTeamId); // Request Sender
    const team2 = room.teams.find((t) => t.bidKey === proposal.proposerTeamId); // Proposer

    if (!team1 || !team2) return socket.emit("error_message", "Teams invalid");

    // EXECUTE TRADE LOGIC
    let multiplier = 10000000;

    // CASH TRADE: Team1 pays Cash, gets Players
    // CASH TRADE: Team1 pays Cash, gets Players
    if (request.type === "CASH_TRADE") {
      const amountToPay = parseFloat(request.details.amount);
      const payRaw = amountToPay * multiplier;
      
      if (team1.budget < payRaw)
        return socket.emit("error_message", "Insufficient budget");

      // 1. Transaction (Transfer Fee)
      team1.budget -= payRaw;
      team1.totalSpent += payRaw;
      
      team2.budget += payRaw;
      team2.totalSpent -= payRaw;

      // 1.5 Handle Fairness Refund if present
      if (request.details.refundCash) {
        const refund = parseFloat(request.details.refundCash);
        const refundRaw = refund * multiplier;
        team1.budget += refundRaw;
        team1.totalSpent -= refundRaw;
      }

      // 2. Asset Movement (Salary Cap Adjustment)
      if (proposal.offer.offeredPlayers) {
        proposal.offer.offeredPlayers.forEach((pData) => {
          const playerIndex = team2.roster.findIndex(
            (p) => p.name === pData.name,
          );
          if (playerIndex > -1) {
            const player = team2.roster.splice(playerIndex, 1)[0];
            team2.totalPlayers--;

            // Cap Adjustment
            const price = player.price || 0;
            team2.budget += price; // Release Cap
            team2.totalSpent -= price;
            
            team1.budget -= price; // Absorb Cap
            team1.totalSpent += price;

            team1.roster.push(player);
            team1.totalPlayers++;
          }
        });
      }
    }
    // PLAYER TRADE / PLAYER TO CASH
    else if (
      request.type === "PLAYER_TRADE" ||
      request.type === "PLAYER_TO_CASH"
    ) {
      const t1PlayerName = request.details.playerName;
      const t1PlayerIdx = team1.roster.findIndex(
        (p) => p.name === t1PlayerName,
      );
      if (t1PlayerIdx === -1)
        return socket.emit("error_message", "Player no longer in squad");

      const t2Cash = parseFloat(proposal.offer.offeredCash || 0);
      const t2CashRaw = t2Cash * multiplier;
      
      if (team2.budget < t2CashRaw)
        return socket.emit("error_message", "Opponent insufficient budget");

      // 1. Transaction
      team2.budget -= t2CashRaw;
      team2.totalSpent += t2CashRaw;
      
      team1.budget += t2CashRaw;
      team1.totalSpent -= t2CashRaw;

      // 2. Asset Movement (T1 -> T2)
      const playerT1 = team1.roster.splice(t1PlayerIdx, 1)[0];
      team1.totalPlayers--;

      // Cap Adjustment
      const priceT1 = playerT1.price || 0;
      team1.budget += priceT1; // Release
      team1.totalSpent -= priceT1;
      
      team2.budget -= priceT1; // Absorb
      team2.totalSpent += priceT1;

      team2.roster.push(playerT1);
      team2.totalPlayers++;

      // 3. Asset Movement (T2 -> T1) (If any)
      if (proposal.offer.offeredPlayers) {
        proposal.offer.offeredPlayers.forEach((pData) => {
          const playerIndex = team2.roster.findIndex(
            (p) => p.name === pData.name,
          );
          if (playerIndex > -1) {
            const player = team2.roster.splice(playerIndex, 1)[0];
            team2.totalPlayers--;

            // Cap Adjustment
            const price = player.price || 0;
            team2.budget += price; // Release
            team2.totalSpent -= price;
            
            team1.budget -= price; // Absorb
            team1.totalSpent += price;

            team1.roster.push(player);
            team1.totalPlayers++;
          }
        });
      }
    }

    // 2. Auto Reject Logic
    request.status = "COMPLETED"; // Closes the trade
    store.requests = store.requests.filter((r) => r.id !== requestId); // Remove from public list? Or keep as closed?
    // Usually keep as history. But here we move to 'history' array.

    // Add to History - Enhanced with trade details
    let historyText = "";
    if (request.type === "CASH_TRADE") {
      const players = proposal.offer.offeredPlayers
        ? proposal.offer.offeredPlayers.map((p) => p.name).join(", ")
        : "No Players";
      historyText = `${team1.name} bought ${players} from ${team2.name} for ₹${request.details.amount} Cr`;
    } else {
      const t2Players =
        proposal.offer.offeredPlayers &&
        proposal.offer.offeredPlayers.length > 0
          ? proposal.offer.offeredPlayers.map((p) => p.name).join(", ")
          : "";
      const t2Cash =
        proposal.offer.offeredCash && proposal.offer.offeredCash > 0
          ? ` + ₹${proposal.offer.offeredCash} Cr`
          : "";
      let received = t2Players + t2Cash;
      if (received.startsWith(" +")) received = received.substring(3);
      historyText = `${team1.name} traded ${request.details.playerName} to ${team2.name} for ${received || "nothing"}`;
    }

    store.history.unshift({
      id: Date.now(),
      text: historyText,
      timestamp: Date.now(),
      details: tradeInfo || {
        team1: team1.name,
        team2: team2.name,
        playersGiven:
          request.type === "CASH_TRADE" ? [] : [request.details.playerName],
        playersReceived: proposal.offer.offeredPlayers
          ? proposal.offer.offeredPlayers.map((p) => p.name)
          : [],
        cashGiven: request.type === "CASH_TRADE" ? request.details.amount : 0,
        cashReceived: proposal.offer.offeredCash || 0,
        type: request.type,
        message: request.details.message || "",
      },
    });

    // Broadcast
    io.to(roomId).emit("trade_update", {
      requests: store.requests,
      history: store.history,
    });
    io.to(roomId).emit("lobby_update", {
      teams: room.teams,
      userCount: room.users.length,
    });

    // Notify Proposer
    if (team2.ownerSocketId) {
        io.to(team2.ownerSocketId).emit("trade_notification", `${team1.name} accepted your offer!`);
    }
  }

  function getTradeState(socket, roomId) {
    const store = initRoom(roomId);
    const room = rooms[roomId];
    
    const payload = {
      teams: room ? room.teams : [],
      requests: store.requests,
      proposals: store.requests, // Legacy/Alt name support
      history: store.history,
    };

    socket.emit("trade_system_init", payload);
    return store;
  }

  function rejectProposal(socket, roomId, data, tradeInfo) {
    const { requestId, proposalId } = data;
    const store = initRoom(roomId);
    const request = store.requests.find((r) => r.id === requestId);
    if (!request) return;

    if (request.senderTeamId !== socket.teamId) return;

    const proposal = request.proposals.find((p) => p.id === proposalId);
    request.proposals = request.proposals.filter((p) => p.id !== proposalId);

    // Add rejection to history if desired for tracking
    if (proposal && tradeInfo) {
      const historyText = `Trade proposal between ${tradeInfo.team1} and ${tradeInfo.team2} was REJECTED`;
      store.history.unshift({
        id: Date.now(),
        text: historyText,
        timestamp: Date.now(),
        status: "rejected",
        details: tradeInfo,
      });
    }

    io.to(roomId).emit("trade_update", {
      requests: store.requests,
      history: store.history,
    });

    // Notify Creator or Proposer of Rejection
    if (request.type === 'DIRECT_COMPLEX') {
        const initiator = room.teams.find(t => t.bidKey === request.senderTeamId);
        if (initiator && initiator.ownerSocketId) {
            io.to(initiator.ownerSocketId).emit("trade_notification", `Your trade offer was rejected by ${socket.teamName || "the team"}`);
        }
    } else if (proposal) {
        const proTeam = room.teams.find(t => t.bidKey === proposal.proposerTeamId);
        if (proTeam && proTeam.ownerSocketId) {
            io.to(proTeam.ownerSocketId).emit("trade_notification", `Your Marketplace offer was rejected.`);
        }
    }
  }

  // 4. Create Complex Direct Trade
  function createComplexTrade(socket, roomId, data) {
    console.log(`[TRADE] createComplexTrade called by ${socket.id} in room ${roomId}`);
    const room = rooms[roomId];
    if (!room) return;

    // Lock Check removed per user request

    const store = initRoom(roomId);
    const senderTeam = room.teams.find((t) => t.bidKey === socket.teamId);
    if (!senderTeam) {
        console.log(`[TRADE] ERROR: Sender team not found for socket ${socket.id} (teamId: ${socket.teamId})`);
        return socket.emit("error_message", "Team not found");
    }

    // Validation
    const targetTeam = room.teams.find((t) => t.bidKey === data.targetTeamId);
    if (!targetTeam) {
        console.log(`[TRADE] ERROR: Target team not found: ${data.targetTeamId}`);
        return socket.emit("error_message", "Target team not found");
    }

    // Verify ownership of offered players
    for (const name of data.offeredPlayerNames) {
      if (!senderTeam.roster.find((p) => p.name === name)) {
        return socket.emit("error_message", `You do not own ${name}`);
      }
    }

    // Verify ownership of requested players (by target)
    for (const name of data.requestedPlayerNames) {
      if (!targetTeam.roster.find((p) => p.name === name)) {
        return socket.emit("error_message", `Target does not own ${name}`);
      }
    }

    const requestId =
      "trade_" + Date.now() + Math.random().toString(36).substr(2, 5);

    const newRequest = {
      id: requestId,
      type: "DIRECT_COMPLEX",
      senderTeamId: senderTeam.bidKey, // Standardized
      sender: senderTeam.bidKey, // Legacy support
      senderTeamName: senderTeam.name,
      targetTeamId: targetTeam.bidKey, // Standardized
      receiver: targetTeam.bidKey, // Legacy support
      details: {
        offeredPlayerNames: data.offeredPlayerNames,
        requestedPlayerNames: data.requestedPlayerNames,
        offeredCash: data.offeredCash,
        requestedCash: data.requestedCash,
        message: data.message,
      },
      status: "OPEN",
      createdAt: Date.now(),
      proposals: [],
    };
    
    console.log(`[TRADE] Created Request:`, newRequest);

    store.requests.push(newRequest);
    io.to(roomId).emit("trade_update", {
      requests: store.requests,
      history: store.history,
    });

    // Notify Target
    if (targetTeam.ownerSocketId) {
      console.log(`[TRADE] Notifying target ${targetTeam.name} at socket ${targetTeam.ownerSocketId}`);
      io.to(targetTeam.ownerSocketId).emit("trade_notification", `New Direct Trade Offer from ${senderTeam.name}`);
    } else {
      console.log(`[TRADE] WARNING: Target ${targetTeam.name} has no active ownerSocketId`);
    }
  }

  return {
    createTradeRequest,
    submitProposal,
    acceptProposal,
    rejectProposal,
    getTradeState,
    createComplexTrade,
  };
}

// ================================================================
// 3. ACHIEVEMENT SYSTEM - Server Handlers (DISABLED)
// ================================================================

function setupAchievementSystem(io) {
  // const achievementDefs = require('./achievements'); // Removed

  async function checkAchievements(userId, eventType, eventData) {
    // Disabled
  }

  async function getUserAchievements(socket, userId) {
    // Disabled
    socket.emit("user_achievements", { achievements: [] });
  }

  return {
    checkAchievements,
    getUserAchievements,
  };
}

// ================================================================
// 4. ANALYTICS - Server Handlers
// ================================================================

function setupAnalytics(io, rooms) {
  const analyticsData = new Map(); // roomId -> analytics data

  function trackBid(roomId, data) {
    if (!analyticsData.has(roomId)) {
      analyticsData.set(roomId, {
        bids: [],
        sales: [],
        teams: {},
      });
    }

    const analytics = analyticsData.get(roomId);
    analytics.bids.push({
      ...data,
      timestamp: Date.now(),
    });
  }

  function trackSale(roomId, data) {
    if (!analyticsData.has(roomId)) {
      analyticsData.set(roomId, {
        bids: [],
        sales: [],
        teams: {},
      });
    }

    const analytics = analyticsData.get(roomId);
    analytics.sales.push({
      ...data,
      timestamp: Date.now(),
    });

    // Broadcast updated analytics
    io.to(roomId).emit("analytics_update", {
      totalSpent: analytics.sales.reduce((sum, s) => sum + s.price, 0),
      totalPlayers: analytics.sales.length,
      avgPrice:
        analytics.sales.reduce((sum, s) => sum + s.price, 0) /
        analytics.sales.length,
      mostExpensive: analytics.sales.reduce(
        (max, s) => (s.price > (max?.price || 0) ? s : max),
        null,
      ),
    });
  }

  function getAnalytics(socket, roomId) {
    const analytics = analyticsData.get(roomId);
    if (analytics) {
      socket.emit("analytics_data", analytics);
    }
  }

  return {
    trackBid,
    trackSale,
    getAnalytics,
  };
}

// ================================================================
// 5. EXPORT INTEGRATION FUNCTIONS
// ================================================================

module.exports = {
  setupPredictPriceGame,
  setupTradeSystem, // Export Trade System
  setupAchievementSystem,
  setupAnalytics,
};

// ================================================================
// 6. USAGE EXAMPLE (Add to your server.js)
// ================================================================

/*
const featureIntegration = require('./feature-integration');

// Initialize features
const predictGame = featureIntegration.setupPredictPriceGame(io, rooms);
const tradeSystem = featureIntegration.setupTradeSystem(io, rooms);
const achievements = featureIntegration.setupAchievementSystem(io);
const analytics = featureIntegration.setupAnalytics(io, rooms);

// Add socket event listeners
io.on('connection', (socket) => {
    
    // Predict Price Game
    socket.on('submit_prediction', (data) => {
        predictGame.submitPrediction(socket, socket.roomId, data);
    });

    // Trade System
    socket.on('create_trade', (data) => {
        tradeSystem.createTrade(socket, socket.roomId, data);
    });

    socket.on('accept_trade', (data) => {
        tradeSystem.acceptTrade(socket, socket.roomId, data.tradeId);
    });

    socket.on('reject_trade', (data) => {
        tradeSystem.rejectTrade(socket, socket.roomId, data.tradeId);
    });

    socket.on('get_active_trades', () => {
        tradeSystem.getActiveTrades(socket, socket.roomId);
    });

    // Achievements
    socket.on('get_achievements', (data) => {
        achievements.getUserAchievements(socket, data.userId);
    });

    // Analytics
    socket.on('get_analytics', () => {
        analytics.getAnalytics(socket, socket.roomId);
    });

    // Track events for achievements and analytics
    socket.on('player_sold', (data) => {
        analytics.trackSale(socket.roomId, data);
        achievements.checkAchievements(socket.userId, 'player_sold', data);
    });

    socket.on('bid_placed', (data) => {
        analytics.trackBid(socket.roomId, data);
    });
});
*/
