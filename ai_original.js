// PLAYER DATABASE
const { PLAYER_DATABASE: PD_INT } =
  typeof require !== "undefined"
    ? require("./player-database")
    : {
        PLAYER_DATABASE:
          (typeof global !== "undefined" ? global["PLAYER_DATABASE"] : null) ||
          (typeof window !== "undefined" ? window["PLAYER_DATABASE"] : null) ||
          {},
      };
const PLAYER_DATABASE = PD_INT;
const NORMALIZED_PLAYER_DB = {};
if (PLAYER_DATABASE) {
  Object.keys(PLAYER_DATABASE).forEach((k) => {
    NORMALIZED_PLAYER_DB[k.toLowerCase()] = PLAYER_DATABASE[k];
  });
}

/**
 * Helper for case-insensitive player lookup
 */
function getPlayerFromDB(name) {
  if (!name) return {};
  return (
    PLAYER_DATABASE[name] || NORMALIZED_PLAYER_DB[name.toLowerCase()] || {}
  );
}

// Define player traits
const TRAITS = {
  clutch: 1.15, // Performs better under pressure
  finisher: 1.12, // High strike rate in death overs
  anchor: 1.05, // Harder to dismiss
  aggressor: 1.1, // Higher chance of boundaries
  nervous: 0.92, // Lower performance under pressure
  choker: 0.85, // Fails in crucial moments
  normal: 1.0,
};

// =================================================================
// 🚀 AI ENGINE: Batting, Bowling & Tournament Logic
// =================================================================

// --- 1. CONFIGURATION & WEIGHTS ---
// Enhanced realism: T20 outcome distributions based on actual IPL data
// Wicket rates tuned to ~6-7 wickets per innings average (realistic IPL)
const OUTCOME_WEIGHTS = {
  anchor: { 0: 32, 1: 40, 2: 15, 3: 2, 4: 6, 6: 2, W: 5.0, WD: 1, NB: 0 },
  normal: { 0: 26, 1: 34, 2: 18, 3: 3, 4: 10, 6: 6, W: 6.0, WD: 2, NB: 1 },
  controlled: { 0: 24, 1: 36, 2: 20, 3: 4, 4: 8, 6: 4, W: 5.5, WD: 2, NB: 1 },
  aggressive: { 0: 18, 1: 22, 2: 12, 3: 4, 4: 15, 6: 15, W: 10.0, WD: 2, NB: 2 },
  desperate: { 0: 12, 1: 14, 2: 8, 3: 4, 4: 18, 6: 20, W: 12.0, WD: 3, NB: 4 },
  powerplay: { 0: 22, 1: 30, 2: 18, 3: 3, 4: 15, 6: 10, W: 6.0, WD: 2, NB: 1 },
  death: { 0: 14, 1: 18, 2: 10, 3: 4, 4: 18, 6: 18, W: 11.0, WD: 2, NB: 2 },
};

const PITCH_EFFECTS = {
  flat: { 4: 5, 6: 6, W: 0 }, // Neutral for wickets
  green: { W: 6.0, 0: 4, 4: -3 }, // Strong pace boost (more wickets)
  dusty: { W: 5.5, 0: 6, 1: -2, 6: -2 }, // Strong spin boost
  slow: { 6: -2.5, 2: 4, 1: 3, W: 4.5 }, // Hard to hit, wickets fall
};

// VENUES provided by User
const VENUES = {
  CSK: {
    name: "M. A. Chidambaram Stadium",
    city: "Chennai",
    range: [70, 190], // Chennai: Low 70, Avg 164, High 246/5
    chaseProb: 0.5,
    pitch: "dusty",
    boundary: "large",
    six: 0.52, // +30% six ratio (0.4 → 0.52)
    pace: 0.5,
    spin: 1.0,
  },
  MI: {
    name: "Wankhede Stadium",
    city: "Mumbai",
    range: [67, 190], // Mumbai: Low 67, Avg 170, High 235/1
    chaseProb: 0.6,
    pitch: "flat",
    boundary: "small",
    six: 0.98, // +30% six ratio (0.75 → 0.98)
    pace: 0.8,
    spin: 0.5,
  },
  RCB: {
    name: "M. Chinnaswamy Stadium",
    city: "Bengaluru",
    range: [82, 230], // Bangalore: Low 82, Avg 175, High 287/3
    chaseProb: 0.62,
    pitch: "flat",
    boundary: "tiny",
    six: 1.24, // +30% six ratio (0.95 → 1.24)
    pace: 0.7,
    spin: 0.4,
  },
  GT: {
    name: "Narendra Modi Stadium",
    city: "Ahmedabad",
    range: [89, 200], // Ahmedabad: Low 89, Avg 178, High 243/5
    chaseProb: 0.6,
    pitch: "green",
    boundary: "large",
    six: 0.65, // +30% six ratio (0.5 → 0.65)
    pace: 0.7,
    spin: 0.6,
  },
  LSG: {
    name: "Ekana Cricket Stadium",
    city: "Lucknow",
    range: [108, 190], // Lucknow: Low 108, Avg 167, High 235/6
    chaseProb: 0.4,
    pitch: "slow",
    boundary: "large",
    six: 0.39, // +30% six ratio (0.3 → 0.39)
    pace: 0.5,
    spin: 0.9,
  },
  PBKS: {
    name: "PCA Stadium Mohali",
    city: "Mohali",
    range: [90, 200], // Mohali: Low 90, Avg 175, High 220+
    chaseProb: 0.6,
    pitch: "green",
    boundary: "medium",
    six: 0.78, // +30% six ratio (0.6 → 0.78)
    pace: 0.7,
    spin: 0.5,
  },
  KKR: {
    name: "Eden Gardens",
    city: "Kolkata",
    range: [90, 200], // Kolkata: Low 90, Avg 175, High 200+
    chaseProb: 0.65,
    pitch: "slow",
    boundary: "medium",
    six: 0.65, // +30% six ratio (0.5 → 0.65)
    pace: 0.4,
    spin: 0.8,
  },
  RR: {
    name: "Sawai Mansingh Stadium",
    city: "Jaipur",
    range: [100, 195], // Jaipur: Low 59, Avg 163, High 219
    chaseProb: 0.5,
    pitch: "dusty",
    boundary: "large",
    six: 0.52, // +30% six ratio (0.4 → 0.52)
    pace: 0.6,
    spin: 0.7,
  },
  DC: {
    name: "Arun Jaitley Stadium",
    city: "Delhi",
    range: [100, 210], // Delhi: Low 100, Avg 180, High 200+
    chaseProb: 0.65,
    pitch: "flat",
    boundary: "small",
    six: 0.78, // +30% six ratio (0.6 → 0.78)
    pace: 0.7,
    spin: 0.5,
  },
  SRH: {
    name: "Rajiv Gandhi Intl",
    city: "Hyderabad",
    range: [80, 235], // Hyderabad: Low 80, Avg 200, High 286/6
    chaseProb: 0.45,
    pitch: "flat",
    boundary: "medium",
    six: 0.91, // +30% six ratio (0.7 → 0.91)
    pace: 0.6,
    spin: 0.5,
  },
};

// --- REAL-TIME STADIUM COMMENTARY GENERATOR ---
function generateStadiumCommentary(ballOutcome, batter, bowler, venue, phase) {
  const { runs, wicket, wicketType, extra } = ballOutcome;
  let commentary = "";
  let stadiumEffect = "";
  
  // Venue-specific context
  const venueComments = {
    dusty: "The surface is taking turn",
    green: "The pitch is offering assistance to the seamers",
    flat: "True bounce on this batting-friendly surface",
    slow: "Two-paced surface making timing difficult",
  };
  
  const boundaryComments = {
    tiny: "Tiny boundaries here",
    small: "Short boundaries in play",
    medium: "Standard boundary sizes",
    large: "Large boundaries making big shots difficult",
  };
  
  // Build stadium context
  if (runs === 6) {
    if (venue.boundary === "large") {
      stadiumEffect = " Over the huge boundary! Massive hit!";
    } else if (venue.boundary === "tiny") {
      stadiumEffect = " Cleared the short boundary with ease.";
    } else {
      stadiumEffect = " Into the stands!";
    }
    if (venue.six > 0.8) {
      stadiumEffect += ` ${venue.name} is a six-hitting paradise!`;
    }
  } else if (runs === 4) {
    if (venue.boundary === "large") {
      stadiumEffect = " Found the gap on this big ground.";
    } else {
      stadiumEffect = " Racing to the fence!";
    }
  } else if (wicket) {
    if (venue.pitch === "dusty" && wicketType === "bowled") {
      stadiumEffect = ` The turning pitch at ${venue.name} does the trick!`;
    } else if (venue.pitch === "green" && wicketType === "caught") {
      stadiumEffect = " The extra bounce takes the edge!";
    } else if (phase === "death") {
      stadiumEffect = ` Pressure mounts at ${venue.name}!`;
    }
  } else if (runs === 0 && !extra) {
    if (venue.pitch === "slow") {
      stadiumEffect = " The slow pitch making it hard to score.";
    } else if (venue.spin > 0.8) {
      stadiumEffect = " Spinners keeping it tight.";
    }
  }
  
  // Generate ball description
  if (wicket) {
    commentary = `${batter.name} ${wicketType === "run out" ? "is RUN OUT" : wicketType === "caught" ? `caught${ballOutcome.fielder ? ` by ${ballOutcome.fielder}` : ""}` : wicketType === "stumped" ? "is STUMPED" : wicketType === "lbw" ? "is LBW" : "is BOWLED"}!${stadiumEffect}`;
  } else if (runs === 6) {
    commentary = `SIX! ${batter.name} launches it!${stadiumEffect}`;
  } else if (runs === 4) {
    commentary = `FOUR! ${batter.name} finds the boundary!${stadiumEffect}`;
  } else if (extra === "WD") {
    commentary = `Wide ball by ${bowler.name}.`;
  } else if (extra === "NB") {
    commentary = `No ball! Free hit coming up.`;
  } else {
    commentary = `${runs === 0 ? "Dot ball" : `${runs} run${runs > 1 ? "s" : ""}`}.${stadiumEffect}`;
  }
  
  return {
    text: commentary,
    stadiumContext: venueComments[venue.pitch] || "",
    boundaryContext: boundaryComments[venue.boundary] || "",
    venue: venue.name,
    city: venue.city,
  };
}

let rngSeed = Date.now();
function seededRandom() {
  rngSeed = (rngSeed * 9301 + 49297) % 233280;
  return rngSeed / 233280;
}

// Global Form Tracker
const formTracker = {};
function getForm(name) {
  if (!formTracker[name]) formTracker[name] = 1.0;
  return formTracker[name];
}
function updateForm(name, runs, balls) {
  if (!formTracker[name]) formTracker[name] = 1.0;
  if (balls > 10) {
    const sr = (runs / balls) * 100;
    if (sr > 160) formTracker[name] = Math.min(1.25, formTracker[name] + 0.05);
    else if (sr < 100)
      formTracker[name] = Math.max(0.75, formTracker[name] - 0.05);
  }
}
function updateBowlingForm(name, figures) {
  if (!formTracker[name]) formTracker[name] = 1.0;
  // figures: { runs, wkts }
  if (figures.wkts >= 2)
    formTracker[name] = Math.min(1.2, formTracker[name] + 0.05);
  else if (figures.runs > 50 && figures.wkts === 0)
    formTracker[name] = Math.max(0.8, formTracker[name] - 0.05);
}

// Helper for Venue Mapping
function getVenueForTeam(teamName) {
  // Try to match team name directly with keys
  for (const key of Object.keys(VENUES)) {
    if (teamName.toUpperCase().includes(key)) return VENUES[key];
  }
  // Default fallback: Random venue instead of always Wankhede
  const venueKeys = Object.keys(VENUES);
  return VENUES[venueKeys[Math.floor(seededRandom() * venueKeys.length)]];
}

// --- 2. BOWLING LOGIC ---
const bowlingLogic = {
  getBowlerType: (player) => {
    const name = player.name || "";
    // Look up in database (Primary Source of Truth)
    const dbEntry = PLAYER_DATABASE[name] || {};

    // Combine all available role info
    const roleStr = (player.roleKey || player.role || "").toLowerCase();
    const dbRole = (dbEntry.role || "").toLowerCase();
    const dbType = (dbEntry.type || "").toLowerCase();
    const combinedRole = (roleStr + " " + dbRole + " " + dbType).toLowerCase();

    let type = "pacer"; // Default

    if (combinedRole.includes("off-spin") || combinedRole.includes("mystery"))
      type = "off-spinner";
    else if (
      combinedRole.includes("leg-spin") ||
      combinedRole.includes("china") ||
      combinedRole.includes("wrist")
    )
      type = "leg-spinner";
    else if (combinedRole.includes("spin") || combinedRole.includes("orth"))
      type = "spinner";
    else if (
      combinedRole.includes("fast") ||
      combinedRole.includes("pace") ||
      combinedRole.includes("seam") ||
      combinedRole.includes("swing")
    )
      type = "pacer";

    // All-rounder detection
    if (
      combinedRole.includes("ar") ||
      combinedRole.includes("all") ||
      dbType === "ar"
    ) {
      const bat = dbEntry.bat || player.stats?.bat || 60;
      const bowl = dbEntry.bowl || player.stats?.bowl || 60;
      if (bat >= 80 && bowl >= 60) return `ar-balanced-${type}`;
      if (bat >= 80) return `ar-batter-${type}`;
      return `ar-bowler-${type}`;
    }
    return type;
  },

  selectBowlers: (playing11) => {
    // Filter out wicketkeepers - they should never bowl
    const eligibleBowlers = playing11.filter((p) => {
      const dbEntry = PLAYER_DATABASE[p.name] || {};
      // Exclude wicketkeepers from bowling
      if (dbEntry.type === "wk") return false;
      if ((p.roleKey || "").toLowerCase() === "wk") return false;
      return true;
    });

    // Select top 6 bowlers from eligible players based on their bowling rating
    let bowlers = eligibleBowlers.map((p) => {
      const dbEntry = PLAYER_DATABASE[p.name] || {};
      const bowlRating = dbEntry.bowl || p.stats?.bowl || 0;
      return {
        ...p,
        bowlRating,
        maxOvers: 4,
        remaining: 4,
        oversUsed: 0,
        balls: 0,
        wkts: 0,
        runs: 0,
        lastBowledOver: -2,
        economy: 0,
        oversDisplay: "0.0",
        isPartTime:
          (dbEntry.type !== "bowl" && bowlRating < 70) ||
          (p.role && p.role.toLowerCase().includes("part-timer")),
      };
    });

    // Sort by rating (e.g. 95, 94, 91, 89, 85, 80 as requested)
    bowlers.sort((a, b) => b.bowlRating - a.bowlRating);

    // Tag the top 6 and assign roles
    return bowlers.map((b, i) => {
      b.bowlingRank = i + 1;
      if (i < 3) b.isCompulsory = true;
      if (i >= 3 && i < 6) b.isBackup = true;

      // Limit to 4 overs max as per standard T20 rules
      b.remaining = i < 6 ? 4 : 0;
      return b;
    });
  },

  prepareBowlersForInnings: (playing11) => {
    return bowlingLogic.selectBowlers(playing11);
  },

  selectBowlerForOver: (bowlable, overNumber, phase) => {
    // Candidates who have overs left and didn't bowl the last over
    let candidates = bowlable.filter(
      (b) => b.remaining > 0 && b.lastBowledOver !== overNumber - 1,
    );

    if (candidates.length === 0) {
      // Fallback: Pick any bowler with overs left (ignoring "last bowled" restriction if no other option)
      candidates = bowlable.filter((b) => b.remaining > 0);
      if (candidates.length === 0) return null;
    }

    // Sort by priority
    candidates.sort((a, b) => {
      let scoreA = a.bowlRating;
      let scoreB = b.bowlRating;

      // Rule: 1, 2, 3 are compulsory (highest priority)
      if (a.isCompulsory) scoreA += 50;
      if (b.isCompulsory) scoreB += 50;

      // Phase Suitability
      const type = (p) => bowlingLogic.getBowlerType(p);
      const dbInfo = PLAYER_DATABASE[a.name] || {};
      const dbInfoB = PLAYER_DATABASE[b.name] || {};
      const roleA = (dbInfo.role || "").toLowerCase();
      const roleB = (dbInfoB.role || "").toLowerCase();

      if (phase === "pp") {
        if (type(a).includes("pacer")) scoreA += 15;
        if (type(b).includes("pacer")) scoreB += 15;
        if (roleA.includes("powerplay")) scoreA += 25;
        if (roleB.includes("powerplay")) scoreB += 25;
      }
      if (phase === "death") {
        if (type(a).includes("pacer")) scoreA += 15;
        if (type(b).includes("pacer")) scoreB += 15;
        if (roleA.includes("death")) scoreA += 30;
        if (roleB.includes("death")) scoreB += 30;
      }
      if (phase === "mid") {
        if (type(a).includes("spin")) scoreA += 20;
        if (type(b).includes("spin")) scoreB += 20;
        if (a.isBackup) scoreA += 10;
        if (b.isBackup) scoreB += 10;
      }

      // Urgency: If a compulsory bowler has many overs left, pick them!
      const oversLeft = 20 - overNumber;
      if (a.isCompulsory && a.remaining > oversLeft / 3) scoreA += 40;
      if (b.isCompulsory && b.remaining > oversLeft / 3) scoreB += 40;

      return scoreB - scoreA + (seededRandom() * 10 - 5);
    });

    const selected = candidates[0];
    selected.lastBowledOver = overNumber;
    return selected;
  },

  updateBowlerStats: (bowler, runs) => {
    bowler.runs += runs;
  },

  endBowlerOver: (bowler) => {
    bowler.remaining--;
    bowler.oversUsed++; // FIX: Increment oversUsed for accurate economy penalty calculation

    // Accurate Overs Display
    const overs = Math.floor(bowler.balls / 6);
    const balls = bowler.balls % 6;
    bowler.oversDisplay = `${overs}.${balls}`;

    // Accurate Economy (avoid division by zero)
    const totalOvers = bowler.balls / 6;
    const eco = totalOvers > 0 ? bowler.runs / totalOvers : 0;
    bowler.economy = eco.toFixed(2);
  },
};

function layoutOvers(balls) {
  if (!balls) return "0.0";
  const o = Math.floor(balls / 6);
  const b = balls % 6;
  return `${o}.${b}`;
}

// --- 3. BATTING LOGIC ---
const battingLogic = {
  getRole: (p) => {
    const name = p.name || "";
    // Look up in database (Primary Source of Truth)
    const dbEntry = getPlayerFromDB(name);

    // Combine all available role info
    const roleStr = (p.roleKey || p.role || "").toLowerCase();
    const dbRole = (dbEntry.role || "").toLowerCase();
    const dbType = (dbEntry.type || "").toLowerCase();
    const combined = (roleStr + " " + dbRole + " " + dbType).toLowerCase();

    // Priority 1: Finishers
    if (combined.includes("finisher")) return "finisher";

    // Priority 2: Power Hitters
    if (
      combined.includes("power hitter") ||
      combined.includes("360") ||
      combined.includes("aggressor")
    )
      return "powerHitter";

    // Priority 3: Anchors
    if (combined.includes("anchor") || combined.includes("captain"))
      return "anchor";

    // Priority 4: Accumulators / Openers
    if (
      combined.includes("opener") ||
      combined.includes("wk") ||
      combined.includes("wicket keeper")
    )
      return "accumulator";

    // Fallback: If DB entry exists, use bat skill to determine role
    if (dbEntry.bat) {
      if (dbEntry.bat > 90) return "powerHitter";
      if (dbEntry.bat > 82) return "accumulator";
    }

    return "normal";
  },
  getWicketType: (batter, bowler, phase, bowlTeam) => {
    const r = seededRandom();

    // Helper to get random fielder from bowling team (for caught/stumped/run out)
    const getRandomFielder = () => {
      if (!bowlTeam || !bowlTeam.squad || bowlTeam.squad.length === 0)
        return null;
      // Filter out the bowler (they rarely catch their own bowling)
      const fielders = bowlTeam.squad.filter((p) => p.name !== bowler.name);
      if (fielders.length === 0) return null;
      return fielders[Math.floor(seededRandom() * fielders.length)].name;
    };

    // 1. Run Outs are rare/situational events (approx 5% overall, higher in death)
    // Death Phase Pressure: Slightly higher chance of mix-ups
    if (phase === "death" && r < 0.1)
      return { type: "run out", fielder: getRandomFielder() };
    if (phase !== "death" && r < 0.03)
      return { type: "run out", fielder: getRandomFielder() };

    // 2. Normal Wickets: Re-roll for distribution
    const wR = seededRandom();
    let wicketType = "caught";
    let fielder = null;

    if (bowlingLogic.getBowlerType(bowler).includes("spin")) {
      if (wR < 0.5) {
        wicketType = "caught";
        fielder = getRandomFielder();
      } else if (wR < 0.75) wicketType = "lbw";
      else if (wR < 0.9) wicketType = "bowled";
      else {
        wicketType = "stumped";
        fielder = getRandomFielder();
      }
    } else {
      // Pacers
      if (wR < 0.6) {
        wicketType = "caught";
        fielder = getRandomFielder();
      } else if (wR < 0.85) wicketType = "bowled";
      else wicketType = "lbw";
    }

    return { type: wicketType, fielder };
  },

  calculateBallOutcome: (batter, bowler, matchState, venue) => {
    const {
      phase,
      reqRR,
      isChasing,
      recentCollapse,
      momentum,
      ballsLeft,
      currentScore,
      ballsBowled,
      dewActive,
      batterBalls = 0, // NEW: track how 'set' the batter is
      bowlerConfidence = 1.0, // NEW: track bowler's current state
      isKnockout = false, // NEW: for clutch/choker trait
      partnershipRuns = 0, // NEW: track current partnership
      partnershipBalls = 0, // NEW: track partnership balls for momentum
      innIndex = 1, // NEW: track innings for deterioration
      consecutiveDots = 0, // NEW: track pressure on batter
    } = matchState;
    let mode = "normal";
    const role = battingLogic.getRole(batter);

    // --- VENUE RANGE LOGIC (Progressive Ceiling) ---
    let rangeAggression = 0;
    if (venue.range && ballsBowled > 0) {
      const oversBowled = (120 - ballsLeft) / 6;
      const safeOvers = oversBowled < 1 ? 1 : oversBowled;
      const estimatedTotal = (currentScore / safeOvers) * 20;
      const targetMin = venue.range[0];
      const targetMax = venue.range[1];

      // Progressive control starts getting stricter after 8 overs to allow natural flow
      if (ballsBowled > 48) {
        if (estimatedTotal < targetMin - 5) rangeAggression = 1; // Behind
        if (estimatedTotal > targetMax - 5) rangeAggression = -1; // Approaching Max
        if (estimatedTotal > targetMax + 5) rangeAggression = -2; // Exceeded Max
      } else if (ballsBowled > 24) {
        // Mild control for powerplay/mid
        if (estimatedTotal > targetMax + 30) rangeAggression = -1;
      }
    }

    // 1. Situation Analysis - Enhanced with phase-specific weights
    if (recentCollapse) {
      mode = "anchor"; // Rebuild after wickets
    } else if (phase === "pp") {
      mode = "powerplay"; // Use dedicated powerplay weights
    } else if (phase === "death") {
      mode = "death"; // Use dedicated death over weights
    } else if (momentum > 2) {
      mode = "aggressive"; // Riding the wave
    }

    // Role-based adjustments for more realistic player behavior
    if (
      role === "finisher" &&
      (phase === "death" || (phase === "mid" && ballsLeft < 30))
    ) {
      mode = "death"; // Finishers go all out in death
    }
    if (role === "powerHitter" && phase === "pp") {
      mode = "aggressive"; // Power hitters attack in powerplay
    }
    if (role === "accumulator") {
      mode = mode === "desperate" ? "aggressive" : "controlled"; // Strike rotators
    }
    if (role === "anchor" && recentCollapse) {
      // Anchors get extra consolidation bonus after wickets
      mode = "anchor";
    }

    // Chase Pressure - More realistic run rate based decisions
    if (isChasing) {
      if (reqRR > 14 || (reqRR > 12 && ballsLeft < 18)) mode = "desperate";
      else if (reqRR > 11) mode = "death";
      else if (reqRR > 9) mode = "aggressive";
      else if (reqRR < 6.5) mode = "controlled";
      else if (reqRR < 5) mode = "anchor";

      if (dewActive && mode === "normal" && reqRR > 7) mode = "aggressive";
    } else if (rangeAggression === 1 && mode !== "desperate") {
      mode = "aggressive";
    } else if (rangeAggression === -1) {
      mode = "controlled";
    } else if (rangeAggression === -2) {
      mode = "anchor";
    }

    // 2. Base Weights from Mode (now uses phase-specific weights)
    let weights = { ...OUTCOME_WEIGHTS[mode] };

    // Powerplay scoring boost - more aggressive batting in first 6 overs
    if (phase === "pp") {
      weights[6] += 2; // Extra sixes in powerplay
      weights[4] += 1;
    }

    // Death overs boundary boost - more sixes and fours in final overs
    if (phase === "death") {
      weights[6] += 2; // More sixes in death overs
      weights[4] += 1;
    }

    // Dew Factor
    if (dewActive) {
      weights["W"] = Math.max(1, weights["W"] - 2);
      weights[4] += 2;
      weights[6] += 1;
      // Slippery ball: More extras
      if (weights["WD"] !== undefined) weights["WD"] += 1;
      if (weights["NB"] !== undefined) weights["NB"] += 1;
    }

    // --- NEW: PITCH DETERIORATION (Second Innings / Late Match) ---
    const oversDone = (120 - ballsLeft) / 6;
    if (innIndex === 2 || oversDone > 12) {
      if (venue.pitch === "dusty" || venue.pitch === "slow") {
        weights["W"] += 1; // More grip, harder to hit
        weights[0] += 2;
        weights[6] -= 1;
      }
    }

    // 3. Venue & Pitch Adjustments
    if (PITCH_EFFECTS[venue.pitch]) {
      const eff = PITCH_EFFECTS[venue.pitch];
      for (let k in eff) {
        if (weights[k] !== undefined) weights[k] += eff[k];
      }
    }
    if (venue.boundary === "tiny") {
      weights[6] += 4;
      weights[4] += 3;
    }
    if (venue.boundary === "large") {
      weights[1] += 2;
      weights[2] += 2;
      weights[6] -= 2;
      weights[0] = Math.max(0, weights[0] - 2);
    }

    // 4. Form & Skill Diff - Using PLAYER_DATABASE directly
    const f = getForm(batter.name);

    // List up stats from centralized database (single source of truth)
    let dbEntryBatter = getPlayerFromDB(batter.name);
    let dbEntryBowler = getPlayerFromDB(bowler.name);

    // Fallback: Use provided squad stats if DB lookup fails (e.g. for synthetic AI players)
    if ((!dbEntryBatter || !dbEntryBatter.bat) && batter.stats) {
      dbEntryBatter = {
        ...batter.stats,
        role: batter.role || dbEntryBatter.role,
      };
    }
    // Ensure batter stats exist to prevent NaN
    if (!dbEntryBatter.bat)
      dbEntryBatter = { bat: 50, bowl: 10, luck: 50, role: "normal" };

    if ((!dbEntryBowler || !dbEntryBowler.bowl) && bowler.stats) {
      dbEntryBowler = {
        ...bowler.stats,
        role: bowler.role || dbEntryBowler.role,
      };
    }
    // Ensure bowler stats exist
    if (!dbEntryBowler.bowl)
      dbEntryBowler = { bat: 10, bowl: 50, luck: 50, role: "bg" };

    // Calculate team strength difference for one-sided matches
    const teamBatStrength = matchState.teamBatStrength || 75;
    const teamBowlStrength = matchState.teamBowlStrength || 75;
    const teamDiff = teamBatStrength - teamBowlStrength; // Positive = batting team stronger

    let batSkill = dbEntryBatter.bat * f;
    let bowlSkill =
      dbEntryBowler.bowl * getForm(bowler.name) * bowlerConfidence;

    // --- LUCK FACTOR: Adds randomness to performance (0.85 to 1.15 range) ---
    const batterLuck = (dbEntryBatter.luck || 75) / 75; // 75 = neutral (1.0)
    const bowlerLuck = (dbEntryBowler.luck || 75) / 75;

    // Luck creates variance: high luck = can exceed normal, low luck = underperform
    // Random luck roll for this ball (weighted by player's luck stat)
    const luckRoll = seededRandom();
    const batterLuckMultiplier = 0.85 + luckRoll * 0.3 * batterLuck; // 0.85 to 1.15 range - more variance
    const bowlerLuckMultiplier = 0.85 + (1 - luckRoll) * 0.3 * bowlerLuck; // Inverse roll for bowler

    batSkill *= batterLuckMultiplier;
    bowlSkill *= bowlerLuckMultiplier;

    // Apply team strength difference for one-sided matches (90/10 RULE IMPLEMENTED)
    // Strong teams win 90% of the time, but weak teams have 10% luck factor chance
    
    // First, calculate base luck factor (0-1 range, higher = more randomness)
    const luckFactor = seededRandom();
    const isUpsetChance = luckFactor < 0.10; // 10% chance for underdog to win via pure luck
    
    // PLAYOFFS MODE: Stronger teams dominate even more (95/5 rule)
    const isPlayoffs = matchState.isPlayoffs || false;
    const upsetThreshold = isPlayoffs ? 0.05 : 0.10; // Only 5% upsets in playoffs
    const isPlayoffUpset = luckFactor < upsetThreshold;
    
    // 90/10 Rule: If it's an upset chance, reverse the team strength advantage
    if (isPlayoffUpset || (!isPlayoffs && isUpsetChance)) {
      // Underdog gets massive boost via luck - can upset the stronger team
      const upsetMultiplier = isPlayoffs ? 1.15 : 1.20; // Smaller boost in playoffs
      batSkill *= upsetMultiplier; 
      bowlSkill *= 0.85;
    } else {
      // Normal case: Strong team advantage applies (90% of matches)
      // In playoffs, stronger team advantage is enhanced
      const strengthMultiplier = isPlayoffs ? 1.5 : 1.0; // 50% stronger advantage in playoffs
      
      if (teamDiff > 20) {
        // Massive advantage - dominant win
        batSkill *= 1.22 * strengthMultiplier;
        bowlSkill *= 0.85;
      } else if (teamDiff > 12) {
        // Strong batting team dominates
        batSkill *= 1.12 * strengthMultiplier;
        bowlSkill *= 0.90;
      } else if (teamDiff > 6) {
        // Moderate advantage
        batSkill *= 1.06 * strengthMultiplier;
        bowlSkill *= 0.96;
      } else if (teamDiff < -20) {
        // Massive bowling advantage
        batSkill *= 0.85;
        bowlSkill *= 1.22 * strengthMultiplier;
      } else if (teamDiff < -12) {
        // Strong bowling team dominates
        batSkill *= 0.90;
        bowlSkill *= 1.12 * strengthMultiplier;
      } else if (teamDiff < -6) {
        // Moderate advantage
        batSkill *= 0.96;
        bowlSkill *= 1.06 * strengthMultiplier;
      }
    }

    // Individual player luck contribution (good players contribute more)
    // Star players (bat > 85) get extra consistency boost
    if (dbEntryBatter.bat > 85) {
      batSkill *= (0.95 + seededRandom() * 0.15); // 0.95 to 1.10 range (more consistent)
    }
    if (dbEntryBowler.bowl > 85) {
      bowlSkill *= (0.95 + seededRandom() * 0.15); // 0.95 to 1.10 range
    }

    // --- NEW: SIGHT / SETTLED BONUS ---
    if (batterBalls > 10) batSkill *= 1.06; // 6% boost after 10 balls
    if (batterBalls > 25) batSkill *= 1.12; // 12% boost after 25 balls

    // --- NEW: PARTNERSHIP BONUS ---
    if (partnershipRuns > 40) batSkill *= 1.05; // Confidence together
    if (partnershipRuns > 75) batSkill *= 1.08;

    // --- NEW: MATCHUP LOGIC ---
    const bowlerType = bowlingLogic.getBowlerType(bowler);
    const batterRoleStr = (dbEntryBatter.role || "").toLowerCase();
    const bowlerRoleStr = (dbEntryBowler.role || "").toLowerCase();

    // 1. Venue Skill Modifiers (Pitch/Conditions)
    if (bowlerType.includes("spin") && venue.spin) {
      bowlSkill *= 1 + (venue.spin - 0.5) * 0.2; // Up to 10% swing based on venue stats
    }
    if (bowlerType.includes("pacer") && venue.pace) {
      bowlSkill *= 1 + (venue.pace - 0.5) * 0.2;
    }

    // 2. Batter vs Bowler Type Matchups
    if (
      bowlerType.includes("spin") &&
      (batterRoleStr.includes("spin basher") || batterRoleStr.includes("360"))
    ) {
      batSkill *= 1.15; // Advantage against spin
    }
    if (bowlerType.includes("pacer") && batterRoleStr.includes("pace basher")) {
      batSkill *= 1.12;
    }

    // --- SPIN MATCHUP LOGIC with LUCK FACTOR ---
    // Leg spin vs Right Hand Batsman (RHB) - Leg spin turns away from RHB (googly threat)
    // Off spin vs Left Hand Batsman (LHB) - Off spin turns away from LHB
    // When ball turns AWAY from batter = higher wicket chance (but batter can also score)
    // When ball turns INTO batter = easier to play but fewer scoring opportunities

    const batterHand = dbEntryBatter.hand || "rhb"; // Default right hand
    const isRHB = batterHand === "rhb" || batterHand === "right";
    const isLHB = batterHand === "lhb" || batterHand === "left";

    // Leg spinner vs RHB - ball turning away, LHB - ball turning in
    if (bowlerType.includes("leg-spin")) {
      const spinLuck = seededRandom(); // Luck determines how well bowler/batter handle matchup
      if (isRHB) {
        // Leg spin turns AWAY from RHB - creates wicket chances (lbw, bowled, stumped)
        // But also risk of being hit for runs if batter reads it
        if (spinLuck < 0.4 * bowlerLuck) {
          // Bowler wins the matchup - turns it away perfectly
          bowlSkill *= 1.12;
          weights["W"] += 2; // Extra wicket chance on turning away deliveries
          weights[6] -= 1; // Harder to hit sixes when ball turns away sharply
        } else if (spinLuck > 0.7 * batterLuck) {
          // Batter wins - uses the turn to score
          batSkill *= 1.08;
          weights[4] += 1;
        }
        // Else: even contest, no adjustment
      } else if (isLHB) {
        // Leg spin turns INTO LHB - easier to play, lower wicket risk
        bowlSkill *= 0.95;
        weights["W"] -= 1;
      }
    }

    // Off spinner vs LHB - ball turning away (arm ball threat)
    if (bowlerType.includes("off-spin")) {
      const spinLuck = seededRandom();
      if (isLHB) {
        // Off spin turns AWAY from LHB - creates wicket chances
        if (spinLuck < 0.4 * bowlerLuck) {
          bowlSkill *= 1.12;
          weights["W"] += 2;
          weights[6] -= 1;
        } else if (spinLuck > 0.7 * batterLuck) {
          batSkill *= 1.08;
          weights[4] += 1;
        }
      } else if (isRHB) {
        // Off spin turns INTO RHB - easier to play
        bowlSkill *= 0.95;
        weights["W"] -= 1;
      }
    }

    // Mystery spin (both leg-break and off-break) - unpredictable, higher variance
    if (bowlerType.includes("mystery") || bowlerRoleStr.includes("mystery")) {
      const mysteryLuck = seededRandom();
      // Mystery spinners rely heavily on luck - can be unplayable or hittable
      if (mysteryLuck < 0.35 * bowlerLuck) {
        // Mystery bowler gets it right - batter confused
        bowlSkill *= 1.18;
        weights["W"] += 3;
      } else if (mysteryLuck > 0.75 * batterLuck) {
        // Batter reads it well - mystery ineffective
        batSkill *= 1.15;
        weights[4] += 2;
        weights[6] += 1;
      }
      // Middle ground - slight advantage to bowler for unpredictability
      else {
        bowlSkill *= 1.05;
      }
    }

    // --- SPIN-FRIENDLY PITCH BONUS ---
    // On dusty/slow pitches, spinners get additional wicket weight boost
    if (
      (venue.pitch === "dusty" || venue.pitch === "slow") &&
      bowlerType.includes("spin")
    ) {
      const pitchSpinLuck = seededRandom();
      // Pitch helps spinners more when luck favors them
      if (pitchSpinLuck < 0.5 * bowlerLuck) {
        weights["W"] += 2; // More grip = more wickets
        bowlSkill *= 1.1;
      }
      // Always some benefit on turning tracks
      weights[0] += 1; // More dot balls as batters struggle
      weights[6] -= 1; // Harder to hit big shots
    }

    // 3. Phase-Specific Role Boosts
    if (phase === "pp") {
      if (batterRoleStr.includes("powerplay specialist")) batSkill *= 1.1;
      if (bowlerRoleStr.includes("swing") || bowlerRoleStr.includes("new ball"))
        bowlSkill *= 1.12;
    }
    if (phase === "death") {
      if (batterRoleStr.includes("finisher")) batSkill *= 1.15;
      if (bowlerRoleStr.includes("death")) bowlSkill *= 1.15;
    }

    // 4. Mystery Spirit / Unsettled Batter
    if (bowlerRoleStr.includes("mystery") && batterBalls < 10) {
      bowlSkill *= 1.15; // Hard to read early on
    }

    // 5. Specialized Bowler Skills
    if (bowlerRoleStr.includes("yorker king")) {
      if (phase === "death") bowlSkill *= 1.25; // Elite death bowling
      weights[4] -= 2;
      weights[6] -= 2; // Harder to hit boundaries
    }
    if (bowlerRoleStr.includes("express") || bowlerRoleStr.includes("pace")) {
      // High pace = high volatility
      weights[6] += 2; // Easier to use pace for sixes
      weights["W"] += 1; // Also more likely to beat the bat
      if (batterBalls < 5) bowlSkill *= 1.1; // Intimidation factor
    }
    if (
      bowlerRoleStr.includes("control") ||
      bowlerRoleStr.includes("line & length")
    ) {
      weights[0] += 3; // More dot balls
      weights[4] -= 2;
    }
    if (
      (bowlerRoleStr.includes("slower ball") ||
        bowlerRoleStr.includes("cutter")) &&
      (venue.pitch === "slow" || venue.pitch === "dusty")
    ) {
      bowlSkill *= 1.15; // Specialized for these pitches
    }

    // --- NEW: TRAITS INTEGRATION ---
    const batterTrait = dbEntryBatter.trait || "normal";
    const bowlerTrait = dbEntryBowler.trait || "normal";

    // Apply trait multipliers from TRAITS object
    if (TRAITS[batterTrait]) batSkill *= TRAITS[batterTrait];

    // Special Trait: Clutch / Choker in high-pressure moments
    if (isKnockout || (isChasing && ballsLeft < 30 && reqRR > 9)) {
      if (batterTrait === "clutch") batSkill *= 1.15;
      if (batterTrait === "choker") batSkill *= 0.8;
      if (bowlerTrait === "clutch") bowlSkill *= 1.15;
      if (bowlerTrait === "choker") bowlSkill *= 0.8;
    }

    // --- NEW: NERVOUS NINETIES PRESSURE (REALISM) ---
    // Batsmen get nervous approaching milestones (90s, 49s, 74s for anchors)
    let milestonePressure = 0;
    const batterRuns = matchState.batterRuns || 0;
    if (batterRuns >= 90 && batterRuns < 100) {
      milestonePressure = 2; // 90s are hardest
      weights["W"] += 2.5; // Increased pressure
      weights[0] += 3;
      weights[1] -= 1;
    } else if (batterRuns >= 80 && batterRuns < 90) {
      milestonePressure = 1.5; // 80s also have pressure
      weights["W"] += 1.5;
      weights[0] += 2;
    } else if (batterRuns === 49 || batterRuns === 74) {
      milestonePressure = 1; // 49, 74 have slight pressure
      weights["W"] += 0.5;
      weights[0] += 1;
    }

    // --- NEW: PARTNERSHIP MOMENTUM (REALISM) ---
    // Partnerships build pressure on bowlers and confidence for batters
    let partnershipMomentum = 0;
    if (partnershipRuns > 20) partnershipMomentum = 1;
    if (partnershipRuns > 50) partnershipMomentum = 2;
    if (partnershipRuns > 80) partnershipMomentum = 3;
    if (partnershipRuns > 120) partnershipMomentum = 4;

    // Partnership bonus increases with time
    const partnershipTime = partnershipBalls / 6; // overs together
    if (partnershipTime > 5) {
      batSkill *= 1 + partnershipMomentum * 0.03; // Up to 12% boost
      weights["W"] -= partnershipMomentum * 0.5; // Harder to break big partnerships
    }

    // --- NEW: BOWLER FATIGUE (REALISM) ---
    // Bowlers tire after consecutive overs or at end of spell
    let bowlerFatigue = 0;
    if (bowler.oversUsed >= 3) bowlerFatigue = 1;
    if (bowler.oversUsed >= 4) bowlerFatigue = 2;
    // Death overs (16-20) are physically harder
    if (phase === "death" && bowler.oversUsed >= 2) bowlerFatigue += 1;

    if (bowlerFatigue > 0) {
      bowlSkill *= 1 - bowlerFatigue * 0.05; // 5% per fatigue level
      weights[4] += bowlerFatigue; // Easier to hit boundaries
      weights[6] += bowlerFatigue * 0.5;
    }

    // --- NEW: GROUND FIELDING EFFECTS (REALISM) ---
    // Large boundaries = harder to clear but more 2s/3s
    // Small boundaries = easier sixes but fielders closer for singles
    if (venue.boundary === "large") {
      // Ground fielding matters more - dots and singles
      weights[0] += 1;
      weights[1] += 1;
      weights[2] += 2; // Running hard between wickets
      weights[3] += 1; // Triples more likely on big grounds
    }
    if (venue.boundary === "small") {
      // Fielders are in - harder to get singles
      weights[1] -= 1;
      weights[0] += 1; // More dots due to ring field
    }

    // --- NEW: DEATH BOWLING REALISM ---
    // Yorker specialists are more effective in death
    if (phase === "death") {
      if (bowlerRoleStr.includes("yorker") || bowlerRoleStr.includes("death")) {
        bowlSkill *= 1.25; // 25% boost for specialists
        weights[4] -= 1; // Harder to hit fours
        weights[6] -= 1; // But still can hit sixes
        weights["W"] += 2; // Yorker threat
      } else {
        // Non-death bowlers struggle more in death
        bowlSkill *= 0.85; // 15% penalty
        weights[6] += 4; // Easier to hit sixes
        weights[4] += 2;
      }
    }

    const diff = batSkill - bowlSkill;

    // --- ANCHOR COLLAPSE STABILIZATION (REALISM) ---
    // When team is collapsing (3+ recent wickets) and anchor is at crease,
    // anchor gets massive bonuses to stabilize and potentially save the game
    const isAnchorAtCrease =
      batterRoleStr.includes("anchor") ||
      (dbEntryBatter.role || "").toLowerCase().includes("anchor");

    // Count actual recent wickets from match state for more accurate collapse detection
    const recentWicketCount = recentCollapse ? 3 : 0;
    
    // Early game collapse protection - reduce wickets in first 4 overs
    const isEarlyCollapse = ballsBowled < 24 && recentCollapse;

    if (recentCollapse && isAnchorAtCrease) {
      // Anchor is at crease during collapse - give immediate stabilization boost
      const anchorResilience = Math.min(3, recentWicketCount + 1); // Reduced to 3x multiplier

      if (batterBalls > 0) {
        // Anchor gets harder to dismiss as collapse gets worse (mental toughness)
        // REDUCED PROTECTION: allow wickets to fall even if anchor is there
        weights["W"] = Math.max(2.0, weights["W"] - anchorResilience * 0.8);

        // Anchor starts taking more singles to rotate strike and rebuild
        weights[1] += anchorResilience * 3;
        weights[2] += anchorResilience * 1.5;

        // Reduce risky shots
        weights[6] = Math.max(1, weights[6] - anchorResilience * 0.8); // Can still hit sixes
        
        // Skill boost for anchors during collapse - they step up
        batSkill *= 1 + anchorResilience * 0.03; // Reduced to 12% max boost
      }

      // Once settled (10+ balls), anchor can stabilize innings significantly
      if (batterBalls > 10) {
        batSkill *= 1.05; // Reduced to 5% boost
        weights["W"] = Math.max(1.0, weights["W"] - 1.5); // Can still get out
        weights[1] += 3; // Take singles, rotate strike
      }

      // Settled anchor (20+ balls) becomes fortress
      if (batterBalls > 20) {
        batSkill *= 1.08; // Reduced to 8% boost
        weights["W"] = Math.max(0.8, weights["W"] - 1.0); // Still gettable
        weights[4] += 1; // Can find boundaries but limited
      }

      // In chase, anchor gets clutch bonus (single-handed win potential)
      if (isChasing && reqRR > 10 && batterBalls > 20) {
        batSkill *= 1.10; // Reduced clutch bonus
        weights[6] += 2; // Can hit sixes when needed
        weights["W"] = Math.max(0.8, weights["W"] - 1.0); // Still gettable
      }
    }
    
    // Early collapse protection - if wickets falling too fast in first 4 overs, reduce wicket chance
    if (isEarlyCollapse && !isAnchorAtCrease) {
      // Non-anchors also get some protection to prevent 5 wickets in 4 overs
      weights["W"] = Math.max(1.2, weights["W"] * 0.8); // Reduced protection
    }

    // --- NEW: ROLE-BASED WEIGHT ADJUSTMENTS ---
    if (batterRoleStr.includes("anchor") || mode === "anchor") {
      weights["W"] = Math.max(1.5, weights["W"] - 2); // Reduced protection - can get out
      weights[6] = Math.max(1, weights[6] - 1.5); // But takes fewer risks
      weights[1] += 2;
    }
    if (
      batterRoleStr.includes("power hitter") ||
      batterRoleStr.includes("aggressor")
    ) {
      weights[6] += 4;
      weights[4] += 2;
      weights["W"] += 2; // High risk high reward
    }
    if (batterRoleStr.includes("360")) {
      weights[4] += 3;
      weights[2] += 2; // Finding gaps
    }

    // --- NEW: TENSION / DOT BALL PRESSURE (REALISM) ---
    if (consecutiveDots >= 3) {
      weights[6] += 2; // Desperate for boundary
      weights[4] += 1;
      weights["W"] += Math.min(3, consecutiveDots * 0.8); // Pressure builds, but capped
      weights[0] -= 2; // Fewer dots as they swing
    }

    // --- SKILL DIFFERENCE ADJUSTMENTS REALISM ---
    if (diff > 12) {
      weights[4] += 2;
      weights[6] += 1;
      weights["W"] = Math.max(1.0, weights["W"] - 1.5); // Better batters harder to dismiss but not impossible
    } else if (diff < -12) {
      weights[0] += 3;
      weights["W"] += 3; // Elite bowlers get more wickets
      weights[6] = Math.max(0, weights[6] - 2);
    }

    // --- NEW: STRICT VENUE RANGE ENFORCEMENT ---
    if (rangeAggression === -1) {
      // Approaching max - slow down
      weights[6] *= 0.5;
      weights[4] *= 0.7;
      weights["W"] += 1; // Extra pressure
    } else if (rangeAggression === -2) {
      // Beyond max - Hard scoring cap
      weights[6] = 0;
      weights[4] = Math.max(0, weights[4] * 0.1);
      weights[0] += 12;
      weights[1] += 5;
    } else if (rangeAggression === 1 && mode !== "anchor") {
      // Behind - Boost aggression
      weights[6] += 3;
      weights[4] += 4;
    }

    // Chase Pressure Penalty: Higher the RRR, higher the Wicket chance
    if (isChasing && reqRR > 9) {
      const chasePressureModifier = Math.min(6, (reqRR - 9) * 1.0); // Capped pressure penalty
      weights["W"] += chasePressureModifier;
      // High target (200+) psychological pressure
      if (reqRR > 10.5) weights[0] += 3;
    }

    // --- NEW: REALISM ENHANCEMENTS ---
    
    // 1. Settled Batter Acceleration (20+ balls)
    // Once set, batters take calculated risks for boundaries
    if (batterBalls > 20) {
        weights[4] += 3; 
        weights[6] += 2;
        weights[0] -= 2; // Fewer dots
    }

    // 2. New Batter Nerves (First 6 balls)
    // Unless playing "finisher" role in death overs, new batters struggle to time it
    if (batterBalls < 6 && phase !== "death" && mode !== "aggressive") {
        weights[0] += 4; // More dots (settling in)
        weights[4] -= 2;
        weights[6] -= 2;
    }

    // 3. Tailender / Lower Order Collapse (6+ Wickets Down)
    // If deep in the lineup, wickets tend to fall in clusters
    const currentWickets = matchState.wkts || 0;
    if (currentWickets >= 6) {
        weights["W"] += 3.0; // Tailenders get out easier
        // Desperate slogging by tail
        if (phase === "death") {
             weights[6] += 4; // Edges fly for six or get caught
             weights["W"] += 2.0; // Even higher risk
        }
    }

    // --- FINAL WICKET WEIGHT PROTECTION ---
    // Ensure W never drops too low even with skill diff and mode adjustments
    // This prevents the "0 wicket" bug in high-scoring games
    let minWkt = 4.0; // Increased base wicket rate for realistic matches
    
    // PLAYOFFS MODE: Moderate wicket rates (not too low, not too high)
    if (isPlayoffs) {
      minWkt = 3.5; // Moderate wickets in playoffs for balance
      if (venue.pitch === "dusty" || venue.pitch === "slow") minWkt = 4.5; 
      if (venue.pitch === "green") minWkt = 4.5;
      if (phase === "pp") minWkt = 3.0; // Some powerplay wickets in playoffs
    } else {
      // League matches normal wicket rates
      if (venue.pitch === "dusty" || venue.pitch === "slow") minWkt = 5.0; 
      if (venue.pitch === "green") minWkt = 5.5;
      if (phase === "pp") minWkt = 3.5;
    }

    // WEAK BATTING COLLAPSE LOGIC
    if (teamDiff < -15) {
        // Significantly weak batting team vs strong bowling
        minWkt += 3.0; // Force collapse
        weights["W"] += 4.0;
    }
    
    weights["W"] = Math.max(minWkt, weights["W"]);

    // 5. Select Outcome
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    let r = seededRandom() * total;
    let result = "0";
    for (const [k, v] of Object.entries(weights)) {
      r -= v;
      if (r <= 0) {
        result = k;
        break;
      }
    }

    let out = {
      runs: 0,
      wicket: false,
      extra: null,
      wicketType: null,
      fielder: null,
    };

    if (result === "W") {
      out.wicket = true;
      const wicketInfo = battingLogic.getWicketType(
        batter,
        bowler,
        phase,
        matchState.bowlTeam,
      );
      out.wicketType = wicketInfo.type;
      out.fielder = wicketInfo.fielder;
    } else if (result === "WD" || result === "NB") {
      out.extra = result;
      out.runs = 1; // 1 run for extra
    } else {
      out.runs = parseInt(result);
    }
    return out;
  },
};

// Helper for Pitch effects (renamed for clarity inside logic)
const VENUE_EFFECTS = PITCH_EFFECTS;

const allStats = {};
const playerToTeam = {};

const getPStat = (nameInput, currentTeamName = "Unknown Team") => {
  const name = String(nameInput); // Ensure name is always a string to prevent [object Object] keys
  if (!allStats[name]) {
    allStats[name] = {
      name,
      team: playerToTeam[name] || currentTeamName,
      runs: 0,
      wkts: 0,
      pts: 0,
      fours: 0,
      sixes: 0,
      ballsFaced: 0,
      ballsBowled: 0,
      runsConceded: 0,
    };
  }
  return allStats[name];
};

// --- HELPER: GET XI BASED ON ROLE ---
function getActiveXI(team, mode) {
  const squad = team.squad || []; // 12 Players
  const batImp = team.batImpact;
  const bowlImp = team.bowlImpact;

  if (!batImp || !bowlImp) return squad.slice(0, 11); // Fallback

  const unwanted = mode === "bat" ? bowlImp.name : batImp.name;
  return squad.filter((p) => p.name !== unwanted).slice(0, 11);
}
// --- HELPER: CALCULATE TEAM STRENGTH ---
const calculateTeamStrength = (team, type) => {
  if (!team || !team.squad || team.squad.length === 0) return 75;
  const ratings = team.squad
    .map((p) => {
      const db = getPlayerFromDB(p.name);
      return type === "bat" ? db.bat || 60 : db.bowl || 60;
    })
    .sort((a, b) => b - a);
  // Weighted average - top players matter more
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < Math.min(11, ratings.length); i++) {
    const w = 11 - i; // Higher weight for better players
    sum += ratings[i] * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : 75;
};

function simInnings(
  batTeam,
  bowlTeam,
  target,
  innIndex,
  venue,
  isKnockout = false,
  isPlayoffs = false,
) {
  const batStrength = calculateTeamStrength(batTeam, "bat");
  const bowlStrength = calculateTeamStrength(bowlTeam, "bowl");

  const batXI = getActiveXI(batTeam, "bat");
  const bowlXI = getActiveXI(bowlTeam, "bowl");
  let batOrder = [...batXI];
  const bowlers = bowlingLogic.prepareBowlersForInnings(bowlXI);

  let score = 0,
    wkts = 0,
    balls = 0;
  let striker = 0,
    nonStriker = 1;
  let nextBat = 2;
  let recentWickets = 0;
  let momentum = 0;
  let partnershipRuns = 0;
  let partnershipBalls = 0;
  let currentPartnership = {
    batter1: null,
    batter2: null,
    runs: 0,
    balls: 0,
    startOver: 0,
  };
  const partnerships = []; // Track all partnerships for scorecard
  const ballLog = [];

  // Dew Factor (Reduced to 25% chance)
  const dewActive = innIndex === 2 && seededRandom() < 0.25;

  // Pressure Bonus for defending a massive total (200+)
  const defendPressureBoost = target && target > 200 ? 1.1 : 1.0;

  // Bowler Confidence tracking
  const bConfidenceMap = {};

  // NEW: Captain Leadership Boost
  // Prioritize explicitly selected captain from team object, fallback to role lookup
  const captainName = batTeam.captain?.name || batTeam.captain;
  const captain =
    batOrder.find((p) => p.name === captainName) ||
    batOrder.find((p) =>
      (getPlayerFromDB(p.name).role || "").toLowerCase().includes("captain"),
    );
  const leadershipBoost = captain ? 1.05 : 1.0;

  bowlers.forEach((b) => {
    // Initial confidence: Higher if defending huge total, lower if dew is heavy
    // Added Leadership boost if captain is present
    bConfidenceMap[b.name] =
      (defendPressureBoost || 1.0) * (dewActive ? 0.95 : 1.0) * leadershipBoost;
  });

  // Bat Cards Init
  const bCards = batOrder.map((p) => ({
    name: p.name,
    runs: 0,
    balls: 0,
    status: "dnb",
    fours: 0,
    sixes: 0,
    consecutiveDots: 0,
    wicketType: null,
    fielder: null,
    bowler: null,
  }));
  if (bCards[0]) bCards[0].status = "not out";
  if (bCards[1]) bCards[1].status = "not out";

  for (let over = 0; over < 20; over++) {
    if (wkts >= 10 || wkts >= batOrder.length - 1 || (target && score > target))
      break;

    const phase = over < 6 ? "pp" : over < 15 ? "mid" : "death";
    const bowler = bowlingLogic.selectBowlerForOver(bowlers, over, phase);
    if (!bowler) break;

    // Initialize/Fetch confidence
    if (!bConfidenceMap[bowler.name]) bConfidenceMap[bowler.name] = 1.0;

    // Reset momentum slightly
    if (momentum > 0) momentum--;

    let legalBallsInOver = 0;
    while (legalBallsInOver < 6) {
      if (
        wkts >= 10 ||
        wkts >= batOrder.length - 1 ||
        (target && score > target)
      )
        break;

      const bat = batOrder[striker];
      const bStat = bCards[striker];

      if (!bat || !bStat) break;

      let reqRR = 0;
      if (target) {
        const remRuns = target - score;
        const remBalls = 120 - balls;
        reqRR = remBalls > 0 ? remRuns / (remBalls / 6) : 99;
      }

      const outcome = battingLogic.calculateBallOutcome(
        bat,
        bowler,
        {
          phase,
          reqRR,
          isChasing: !!target,
          recentCollapse: recentWickets > 0,
          momentum,
          ballsLeft: 120 - balls,
          ballsBowled: balls,
          currentScore: score,
          wkts: wkts, // NEW: Pass wickets for tailender logic
          dewActive: dewActive,
          batterBalls: bStat.balls, // Sight bonus
          batterRuns: bStat.runs, // For nervous nineties logic
          bowlerConfidence: bConfidenceMap[bowler.name], // Pressure/Confidence
          isKnockout,
          partnershipRuns,
          partnershipBalls, // NEW: For partnership momentum calculation
          innIndex,
          consecutiveDots: bStat.consecutiveDots,
          teamBatStrength: batStrength, // Pass team strengths
          teamBowlStrength: bowlStrength,
          bowlTeam: bowlTeam, // Pass bowling team for fielder selection
          isPlayoffs, // Playoffs mode flag
        },
        venue,
      );

      score += outcome.runs;
      bowlingLogic.updateBowlerStats(bowler, outcome.runs);

      if (!outcome.extra) bowler.balls++;

      // Generate real-time stadium commentary
      const commentary = generateStadiumCommentary(outcome, bat, bowler, venue, phase);

      ballLog.push({
        over: `${over}.${legalBallsInOver + 1}`,
        bat: bat.name,
        bowl: bowler.name,
        bat1: { name: bStat.name, runs: bStat.runs, balls: bStat.balls },
        bat2: bCards[nonStriker]
          ? {
              name: bCards[nonStriker].name,
              runs: bCards[nonStriker].runs,
              balls: bCards[nonStriker].balls,
            }
          : null,
        venue: venue.name,
        pitch: venue.pitch,
        boundary: venue.boundary,
        dew: dewActive,
        phase: phase,
        commentary: commentary.text,
        stadiumContext: commentary.stadiumContext,
        boundaryContext: commentary.boundaryContext,
        city: commentary.city,
        ...outcome,
      });

      // --- PARTNERSHIP TRACKING ---
      if (!outcome.extra) {
        if (!currentPartnership.batter1) {
          currentPartnership.batter1 = bat.name;
          currentPartnership.batter2 = bCards[nonStriker]?.name;
          currentPartnership.startOver = over;
        }
        currentPartnership.runs += outcome.runs;
        currentPartnership.balls++;
      }

      const bs = getPStat(bowler.name, bowlTeam.name);
      bs.runsConceded += outcome.runs;
      if (!outcome.extra) bs.ballsBowled++;

      if (outcome.wicket) {
        wkts++;
        recentWickets = 2;
        momentum = 0;

        // Save completed partnership before reset
        if (currentPartnership.batter1 && currentPartnership.runs > 0) {
          partnerships.push({
            ...currentPartnership,
            endOver: over,
            endReason: outcome.wicketType || "out",
          });
        }

        partnershipRuns = 0;
        partnershipBalls = 0;
        currentPartnership = {
          batter1: null,
          batter2: null,
          runs: 0,
          balls: 0,
          startOver: 0,
        };
        bStat.status = "out";
        bStat.balls++;
        bStat.wicketType = outcome?.wicketType || "defaultWicketType";
        bStat.fielder = outcome?.fielder || "defaultFielder";
        bStat.bowler = bowler?.name || "defaultBowler";
        updateForm(bat.name, bStat.runs, bStat.balls);

        // Confidence Boost for Wicket
        bConfidenceMap[bowler.name] = Math.min(
          1.2,
          bConfidenceMap[bowler.name] + 0.05,
        );

        if (outcome.wicketType !== "run out") {
          bs.wkts++;
          bs.pts += 25;
          bowler.wkts++;
        }

        if (nextBat < batOrder.length) {
          striker = nextBat++;
          bCards[striker].status = "not out";
          // Reset current partnership with new batter
          currentPartnership = {
            batter1: bCards[striker].name,
            batter2: bCards[nonStriker]?.name,
            runs: 0,
            balls: 0,
            startOver: over,
          };
        } else {
          striker = -1;
        }
      } else {
        if (!outcome.extra) {
          bStat.runs += outcome.runs;
          bStat.balls++;
          partnershipRuns += outcome.runs;
          partnershipBalls++;

          if (outcome.runs >= 4) {
            momentum++;
            // Pressure Drop for Bowler on boundaries
            const drop = outcome.runs === 6 ? 0.08 : 0.04;
            bConfidenceMap[bowler.name] = Math.max(
              0.8,
              bConfidenceMap[bowler.name] - drop,
            );
          } else {
            momentum = Math.max(0, momentum - 1);
            // Confidence Gain for Dot Balls
            if (outcome.runs === 0) {
              bStat.consecutiveDots++;
              bConfidenceMap[bowler.name] = Math.min(
                1.2,
                bConfidenceMap[bowler.name] + 0.01,
              );
            } else {
              bStat.consecutiveDots = 0;
            }
          }

          const ps = getPStat(bat.name, batTeam.name);
          ps.runs += outcome.runs;
          ps.ballsFaced++;
          ps.pts += outcome.runs;

          if (outcome.runs === 4) {
            ps.fours++;
            bStat.fours++;
          }
          if (outcome.runs === 6) {
            ps.sixes++;
            bStat.sixes++;
          }

          if (outcome.runs % 2 !== 0) {
            [striker, nonStriker] = [nonStriker, striker];
          }
        }
      }
      if (!outcome.extra) {
        balls++;
        legalBallsInOver++;
      }
    }

    bowlingLogic.endBowlerOver(bowler);
    [striker, nonStriker] = [nonStriker, striker];
    if (recentWickets > 0) recentWickets--;
  }

  // Add final partnership if exists
  if (currentPartnership.batter1 && currentPartnership.runs > 0) {
    partnerships.push({
      ...currentPartnership,
      endOver: 20,
      endReason: "not out",
    });
  }

  bCards.forEach((c) => {
    if (c.status === "not out") updateForm(c.name, c.runs, c.balls);
  });

  // Update Bowling Form
  bowlers.forEach((b) => {
    updateBowlingForm(b.name, { runs: b.runs, wkts: b.wkts });
  });

  return {
    team: batTeam.name,
    score,
    wkts,
    balls,
    batting: bCards,
    bowling: bowlers,
    ballLog,
    partnerships, // NEW: Partnership data for scorecard
  };
}

// --- NEW: SUPER OVER LOGIC ---
function simulateSuperOver(t1, t2, venue) {
  // Simple 1-over shootout
  const simSingleOver = (bat, bowl) => {
    let s = 0,
      w = 0,
      b = 0;
    const bOrder = bat.squad.slice(0, 3); // Top 3
    const bowler =
      bowl.squad.find((p) =>
        (p.roleKey || p.role || "").toLowerCase().includes("bowl"),
      ) || bowl.squad[0];

    for (let i = 0; i < 6; i++) {
      const out = battingLogic.calculateBallOutcome(
        bOrder[w],
        bowler,
        {
          phase: "death",
          ballsLeft: 6 - i,
          momentum: 0,
          isChasing: false,
          reqRR: 12,
          partnershipRuns: s,
          innIndex: 2,
          consecutiveDots: 0,
        },
        venue,
      );
      s += out.runs;
      if (out.wicket) w++;
      if (w >= 2) break; // 2 wickets and you're out in Super Over
    }
    return { score: s, wkts: w };
  };

  const i1 = simSingleOver(t1, t2);
  const i2 = simSingleOver(t2, t1);

  if (i1.score > i2.score) return { winner: t1.name, margin: "Super Over" };
  if (i2.score > i1.score) return { winner: t2.name, margin: "Super Over" };
  // If still tie, coin toss
  return {
    winner: seededRandom() > 0.5 ? t1.name : t2.name,
    margin: "Super Over (Cointoss)",
  };
}

function simulateMatch(t1, t2, type = "LEAGUE") {
  const isKnockout = type !== "League" && type !== "LEAGUE";
  const isPlayoffs = type !== "League" && type !== "LEAGUE"; // Playoffs = knockout matches
  let firstBat, secondBat;
  const tossWinner = seededRandom() > 0.5 ? t1 : t2;
  const tossLoser = tossWinner === t1 ? t2 : t1;
  let electedTo = "bat";
  let tossReason = "looking at the pitch";

  const venue = getVenueForTeam(t1.name);

  // Tactical logic for toss decision
  if (venue.chaseProb > 0.6) {
    electedTo = "bowl";
    tossReason = "due to potential dew factor and easier chasing conditions";
  } else if (venue.spin > 0.7) {
    electedTo = "bat";
    tossReason =
      "as the track is expected to slow down and assist spinners later";
  } else if (seededRandom() < venue.chaseProb) {
    electedTo = "bowl";
    tossReason = "standard match strategy for this venue";
  }

  if (electedTo === "bowl") {
    firstBat = tossLoser;
    secondBat = tossWinner;
  } else {
    firstBat = tossWinner;
    secondBat = tossLoser;
  }

  const i1 = simInnings(firstBat, secondBat, null, 1, venue, isKnockout, isPlayoffs);
  const i2 = simInnings(secondBat, firstBat, i1.score, 2, venue, isKnockout, isPlayoffs);

  const s1 = parseInt(i1.score.toString());
  const s2 = parseInt(i2.score.toString());

  let winner, margin;

  if (s1 === s2) {
    // TIE: Simulate Super Over
    const superOver = simulateSuperOver(firstBat, secondBat, venue);
    winner = superOver.winner;
    margin = superOver.margin;
  } else {
    winner = s1 > s2 ? firstBat.name : secondBat.name;
    margin = s1 > s2 ? `${s1 - s2} runs` : `${10 - i2.wkts} wickets`;
  }

  const t1Score = firstBat.name === t1.name ? i1 : i2;
  const t2Score = firstBat.name === t2.name ? i1 : i2;

  const tossFullText = `${tossWinner.name} won the toss and elected to ${electedTo} ${tossReason}`;

  return {
    t1: t1.name,
    t2: t2.name,
    score1: `${t1Score.score}/${t1Score.wkts}`,
    score2: `${t2Score.score}/${t2Score.wkts}`,
    winner: winner,
    winnerName: winner,
    margin: margin,
    toss: tossFullText,
    tossDetails: {
      winner: tossWinner.name,
      decision: electedTo,
      reason: tossReason,
    },
    venue: venue,
    type,
    details: {
      i1: { ...i1, teamName: firstBat.name },
      i2: { ...i2, teamName: secondBat.name },
    },
    batFirst: firstBat.name,
  };
}

// --- 4. TOURNAMENT SIMULATION ---
// --- 4. TOURNAMENT SIMULATION ---
function runLocalTournament(tourneyTeams) {
  if (!tourneyTeams || tourneyTeams.length < 2)
    throw new Error("Need at least 2 teams to simulate.");

  // Clear stats and re-seed RNG for new tournament
  rngSeed = Date.now();
  for (const key in allStats) delete allStats[key];
  for (const key in playerToTeam) delete playerToTeam[key];
  for (const key in formTracker) delete formTracker[key];

  // Safety: Ensure all teams have minimal squad to prevent crash
  tourneyTeams.forEach((t) => {
    if (!t.squad) t.squad = [];
    // Auto-fill dummy players if < 11
    while (t.squad.length < 12) {
      t.squad.push({
        name: `Player_${t.name}_${t.squad.length + 1}`,
        roleKey: "ar",
        stats: { bat: 60, bowl: 60, luck: 50 },
      });
    }
    // Map players to teams for awards
    t.squad.forEach((p) => (playerToTeam[p.name] = t.name));
    t.stats = {
      played: 0,
      won: 0,
      lost: 0,
      pts: 0,
      nrr: 0,
      rs: 0,
      rc: 0,
      of: 0,
      ob: 0,
    };
  });

  const matches = [];

  // Helper to update N N and Points
  function handleLeaguePoints(match) {
    const t1 = tourneyTeams.find((t) => t.name === match.t1);
    const t2 = tourneyTeams.find((t) => t.name === match.t2);
    if (!t1 || !t2) return;

    t1.stats.played++;
    t2.stats.played++;

    if (match.winnerName === "Tie") {
      t1.stats.pts += 1;
      t2.stats.pts += 1;
    } else if (match.winnerName === t1.name) {
      t1.stats.won++;
      t1.stats.pts += 2;
      t2.stats.lost++;
    } else {
      t2.stats.won++;
      t2.stats.pts += 2;
      t1.stats.lost++;
    }

    // --- NRR Logic Corrected ---
    const i1 = match.details.i1;
    const i2 = match.details.i2;

    // Helper to update stats for a specific innings
    const updateInningsStats = (innings, isInnings1) => {
      const battingTeamName = innings.teamName;
      // Determine if t1 or t2 was batting
      const battingTeam =
        battingTeamName === t1.name
          ? t1
          : battingTeamName === t2.name
            ? t2
            : null;
      const bowlingTeam = battingTeamName === t1.name ? t2 : t1;

      if (battingTeam && bowlingTeam) {
        const runs = innings.score;
        // Overs faced/bowled - If all out, count as full 20 overs (standard NRR rule)
        const overs = innings.wkts === 10 ? 20 : innings.balls / 6;

        // Update Batting Team Stats
        battingTeam.stats.rs += runs;
        battingTeam.stats.of += overs;

        // Update Bowling Team Stats
        bowlingTeam.stats.rc += runs;
        bowlingTeam.stats.ob += overs;
      }
    };

    updateInningsStats(i1, true);
    updateInningsStats(i2, false);
  }

  // 1. League Stage (Double Round Round: Home & Away)
  for (let i = 0; i < tourneyTeams.length; i++) {
    for (let j = 0; j < tourneyTeams.length; j++) {
      if (i === j) continue;
      const m = simulateMatch(tourneyTeams[i], tourneyTeams[j], "League");
      handleLeaguePoints(m);
      matches.push(m);
    }
  }

  // Debug: If 2 teams, each should play 2 matches.
  console.log(
    `Tournament: ${tourneyTeams.length} teams, ${matches.length} matches simulated.`,
  );

  // 2. Final Standings
  tourneyTeams.forEach((t) => {
    const rr = t.stats.of > 0 ? t.stats.rs / t.stats.of : 0;
    const ra = t.stats.ob > 0 ? t.stats.rc / t.stats.ob : 0;
    t.stats.nrr = parseFloat((rr - ra).toFixed(3));
  });

  const standings = [...tourneyTeams].sort(
    (a, b) => b.stats.pts - a.stats.pts || b.stats.nrr - a.stats.nrr,
  );

  // 3. Playoffs
  const playoffs = [];
  let champion = standings[0];
  let runnerUp = standings[1];

  if (standings.length >= 4) {
    const q1 = simulateMatch(standings[0], standings[1], "Qualifier 1");
    const eli = simulateMatch(standings[2], standings[3], "Eliminator");

    const winnerQ1 =
      q1.winnerName === standings[0].name ? standings[0] : standings[1];
    const loserQ1 =
      q1.winnerName === standings[0].name ? standings[1] : standings[0];
    const winnerEli =
      eli.winnerName === standings[2].name ? standings[2] : standings[3];

    const q2 = simulateMatch(loserQ1, winnerEli, "Qualifier 2");
    const winnerQ2 = q2.winnerName === loserQ1.name ? loserQ1 : winnerEli;

    const final = simulateMatch(winnerQ1, winnerQ2, "Final");

    champion = final.winnerName === winnerQ1.name ? winnerQ1 : winnerQ2;
    runnerUp = final.winnerName === winnerQ1.name ? winnerQ2 : winnerQ1;

    playoffs.push(q1, eli, q2, final);
  } else if (standings.length >= 2) {
    // If fewer than 4 teams, just do a direct Final between top 2
    const final = simulateMatch(standings[0], standings[1], "Final");
    champion =
      final.winnerName === standings[0].name ? standings[0] : standings[1];
    runnerUp =
      final.winnerName === standings[0].name ? standings[1] : standings[0];
    playoffs.push(final);
  }

  // Awards Function
  const getTop = (key, minPlayed = 1) => {
    let best = { name: "N/A", val: -1, team: "N/A" };
    for (let p in allStats) {
      if (allStats[p][key] > best.val) {
        best = { name: p, val: allStats[p][key], team: allStats[p].team };
      }
    }
    return best;
  };

  const getBestSR = (minBalls = 30) => {
    let best = { name: "N/A", val: 0, team: "N/A" };
    for (let p in allStats) {
      const ps = allStats[p];
      if (ps.ballsFaced >= minBalls) {
        const sr = (ps.runs / ps.ballsFaced) * 100;
        if (sr > best.val) {
          best = { name: p, val: parseFloat(sr.toFixed(1)), team: ps.team };
        }
      }
    }
    return best;
  };

  const getBestEco = (minBalls = 24) => {
    let best = { name: "N/A", val: 99, team: "N/A" };
    for (let p in allStats) {
      const ps = allStats[p];
      if (ps.ballsBowled >= minBalls) {
        const eco = ps.runsConceded / (ps.ballsBowled / 6);
        if (eco < best.val) {
          best = { name: p, val: parseFloat(eco.toFixed(2)), team: ps.team };
        }
      }
    }
    return best.val === 99 ? { name: "N/A", val: 0, team: "N/A" } : best;
  };

  const getBestImpact = () => {
    let best = { name: "N/A", val: 0, team: "N/A" };
    for (let p in allStats) {
      const ps = allStats[p];
      // Impact = (Runs*1 + Wkts*25 + Sixes*2) / matches_factor (simplified)
      const impact = ps.runs + ps.wkts * 25 + ps.sixes * 2;
      if (impact > best.val) {
        best = { name: p, val: Math.round(impact), team: ps.team };
      }
    }
    return best;
  };

  return {
    winner: { name: champion.name, playerName: champion.playerName },
    runnerUp: { name: runnerUp.name, playerName: runnerUp.playerName },
    standings: standings.map((s) => ({
      name: s.name,
      playerName: s.playerName,
      stats: s.stats,
    })),
    leagueMatches: matches,
    playoffs: playoffs,
    orangeCap: getTop("runs"),
    purpleCap: getTop("wkts"),
    mvp: getTop("pts"),
    mostSixes: getTop("sixes"),
    highestSr: getBestSR(),
    bestEco: getBestEco(),
    bestImpact: getBestImpact(),
    tournamentSixes: Object.values(allStats).reduce(
      (sum, p) => sum + (p.sixes || 0),
      0,
    ),
  };
}

// =================================================================
// 🚀 AI ENGINE: GEMINI API INTEGRATION (Gemini 2.0 Flash)
// =================================================================
const https = require("https");
require("dotenv").config(); // Load environment variables

// ✅ SECURE: Using environment variable for API key
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const API_TIMEOUT_MS = 30000; // 30 second timeout for API calls

async function runFullTournament(tourneyTeams, customPrompt = "") {
  console.log("🤖 Gemini AI is simulating your tournament...");

  if (!GEMINI_API_KEY || GEMINI_API_KEY.includes("YOUR_")) {
    console.error(
      "❌ ERROR: Gemini API Key is missing!",
      "back to Local Engine.",
    );
    return runLocalTournament(tourneyTeams);
  }

  // 1. Prepare data for the prompt
  const teamData = tourneyTeams
    .map((t) => {
      const squadInfo =
        t.squad && t.squad.length > 5
          ? t.squad.map((p) => `${p.name} (${p.roleKey || "bat"})`).join(", ")
          : "Empty squad (AI: Please invent a realistic T20 starting XI for this team name)";
      return `Team: ${t.name}\nPlayers: ${squadInfo}`;
    })
    .join("\n\n");

  const promptText = `
    Act as a professional Cricket Simulation Engine. Simulate a full T20 Cricket Tournament based on these teams:
    
    ${teamData}

    ${customPrompt ? `--- USER CUSTOM DIRECTIVES ---\n${customPrompt}\n------------------------------` : ""}

    REQUIREMENTS:
    - Simulate a FULL tournament with ALL 10 teams provided.
    - If some teams have empty squads, invent a realistic starting XI for them based on their franchise name.
    - Format: Double Round Robin (Each team plays 18 match: 9 Home, 9 Away).
    - Provide realistic T20 scores based on typical stadium limits (140-230 range, but strictly follow stadium nature).
    - Match results should be consistent with squad strengths and venue characteristics.
    - Calculate top performer awards (Orange Cap, Purple Cap, MVP, Most Sixes, Highest SR, Best Economy, Best Impact).
    - IMPORTANT: "standings" array MUST contain ALL 10 teams with their 18-match season stats.
    - IMPORTANT: "leagueMatches" should contain a representative selection of match results if too many to list all.

    OUTPUT JSON STRUCTURE:
    Return ONLY a raw JSON object:
    {
      "winner": { "name": "Team Name" },
      "runnerUp": { "name": "Team Name" },
      "standings": [
        { "name": "CSK", "stats": { "played": 18, "won": 10, "lost": 8, "pts": 20, "nrr": 0.12 } }
      ],
      "leagueMatches": [
        { "t1": "CSK", "t2": "MI", "winner": "CSK", "margin": "10 runs", "score1": "180/4", "score2": "170/9", "type": "League" }
      ],
      "playoffs": [
        { "t1": "CSK", "t2": "RCB", "winner": "CSK", "margin": "5 wkts", "score1": "150/5", "score2": "151/5", "type": "Qualifier 1" }
      ],
      "orangeCap": { "name": "Player Name", "val": 750, "team": "CSK" },
      "purpleCap": { "name": "Player Name", "val": 28, "team": "MI" },
      "mvp": { "name": "Player Name", "val": 380, "team": "RCB" },
      "mostSixes": { "name": "Player Name", "val": 42, "team": "SRH" },
      "highestSr": { "name": "Player Name", "val": 185.5, "team": "KKR" },
      "bestEco": { "name": "Player Name", "val": 6.8, "team": "LSG" },
      "bestImpact": { "name": "Player Name", "val": 450, "team": "MI" },
      "tournamentSixes": 1150
    }
    `;

  // 2. Call the API
  try {
    const responseText = await callGeminiAPI(promptText);

    // Clean markdown backticks if AI adds them
    let cleanJson = responseText
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    // Robust Extraction: Find substring between first { and last }
    const firstParen = cleanJson.indexOf("{");
    const lastParen = cleanJson.lastIndexOf("}");
    if (firstParen !== -1 && lastParen !== -1) {
      cleanJson = cleanJson.substring(firstParen, lastParen + 1);
    }

    const data = JSON.parse(cleanJson);

    // Enrich with original team metadata (e.g. Owner Name)
    if (data.standings && Array.isArray(data.standings)) {
      data.standings.forEach((s) => {
        const original = tourneyTeams.find((t) => t.name === s.name);
        if (original) {
          s.playerName = original.playerName; // Map Owner Name
          s.bidKey = original.bidKey; // Map ID if needed
        }
      });
    }

    console.log("✅ Gemini Simulation Complete!");
    return data;
  } catch (error) {
    console.error("❌ Tournament Simulation Failed:", error);
    console.warn("⚠️ Falling back to Local Simulation Engine...");
    try {
      return runLocalTournament(tourneyTeams);
    } catch (localErr) {
      console.error("❌ Local Simulation also failed:", localErr);
      return {
        error: "Both AI and Local Simulation Failed",
        details: localErr.message,
      };
    }
  }
}

/**
 * Native Node.js HTTPS request to Gemini API (No SDK required)
 * Uses Gemini 2.0 Flash for better performance and accuracy
 * Includes timeout handling to prevent hanging requests
 */
function callGeminiAPI(prompt) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        // Forces s model to output valid JSON
        response_mime_type: "application/json",
        temperature: 0.7, // Slightly lower for more consistent realistic results
        topP: 0.9,
        topK: 40,
      },
    });

    const options = {
      hostname: "generativelanguage.googleapis.com",
      // ✅ UPGRADED: Using Gemini 2.0 Flash for better accuracy
      path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
      timeout: API_TIMEOUT_MS, // Request timeout
    };

    const req = https.request(options, (res) => {
      let resBody = "";
      res.on("data", (chunk) => (resBody += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(resBody);
          if (parsed.error) {
            console.error("Gemini API Error:", parsed.error);
            return reject(
              parsed.error.message || "Gemini API returned an error",
            );
          }

          if (!parsed.candidates || !parsed.candidates[0]) {
            return reject("No response candidates from Gemini API");
          }

          const text = parsed.candidates[0].content.parts[0].text;
          resolve(text);
        } catch (e) {
          console.error(
            "Parse Error:",
            e.message,
            "Response:",
            resBody.substring(0, 500),
          );
          reject("Failed to parse Gemini API response: " + e.message);
        }
      });
    });

    // ✅ Timeout handling - prevents hanging indefinitely
    req.setTimeout(API_TIMEOUT_MS, () => {
      req.destroy();
      reject(
        "Gemini API request timed out after " +
          API_TIMEOUT_MS / 1000 +
          " seconds",
      );
    });

    req.on("error", (e) => {
      console.error("Request Error:", e.message);
      reject("Network error: " + e.message);
    });

    req.write(postData);
    req.end();
  });
}

module.exports = {
  battingLogic,
  bowlingLogic,
  PLAYER_DATABASE,
  runFullTournament,
  simulateMatch,
  runLocalTournament,
  calculateTeamStrength,
};
