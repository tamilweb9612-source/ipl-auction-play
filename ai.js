// =================================================================
// 🚀 AI ENGINE: Batting, Bowling & Tournament Logic
// =================================================================

// --- 1. CONFIGURATION & WEIGHTS ---
// Enhanced realism: More realistic T20 outcome distributions based on IPL data
const OUTCOME_WEIGHTS = {
  anchor:     { 0: 28, 1: 38, 2: 18, 3: 4, 4: 7, 6: 2, 'W': 2, 'WD': 1, 'NB': 0 }, // Consolidate - Focus on singles
  normal:     { 0: 24, 1: 32, 2: 22, 3: 6, 4: 8, 6: 4, 'W': 5, 'WD': 2, 'NB': 1 }, // Standard T20 batting
  controlled: { 0: 20, 1: 35, 2: 25, 3: 7, 4: 7, 6: 3, 'W': 4, 'WD': 2, 'NB': 1 }, // Strike rotation focus
  aggressive: { 0: 18, 1: 26, 2: 18, 3: 8, 4: 12, 6: 10, 'W': 7, 'WD': 2, 'NB': 2 }, // Attacking play
  desperate:  { 0: 12, 1: 18, 2: 14, 3: 6, 4: 14, 6: 18, 'W': 14, 'WD': 3, 'NB': 4 }, // All-out attack
  powerplay:  { 0: 20, 1: 30, 2: 20, 3: 5, 4: 12, 6: 6, 'W': 6, 'WD': 2, 'NB': 1 }, // Powerplay specific
  death:      { 0: 16, 1: 22, 2: 16, 3: 7, 4: 15, 6: 14, 'W': 9, 'WD': 2, 'NB': 3 }  // Death overs specific
};

const PITCH_EFFECTS = {
  flat:   { 4: 3, 6: 3, 'W': -2 },
  green:  { 'W': 3, 0: 4, 4: -2 }, // Swing helps bowlers
  dusty:  { 'W': 2, 0: 3, 1: -2 }, // Spin grip
  slow:   { 6: -3, 2: 4, 1: 3 }    // Hard to hit boundaries
};

// VENUE MAP provided by User
const VENUE_MAP = {
  "CSK": { name: "M. A. Chidambaram Stadium", city: "Chennai", range: [160, 185], chaseProb: 0.55, pitch: "dusty", boundary: "large" },
  "MI": { name: "Wankhede Stadium", city: "Mumbai", range: [190, 225], chaseProb: 0.65, pitch: "flat", boundary: "small" }, // Capped at 0.65
  "RCB": { name: "M. Chinnaswamy Stadium", city: "Bengaluru", range: [200, 240], chaseProb: 0.70, pitch: "flat", boundary: "tiny" }, // Capped at 0.70
  "GT": { name: "Narendra Modi Stadium", city: "Ahmedabad", range: [170, 200], chaseProb: 0.60, pitch: "green", boundary: "large" },
  "LSG": { name: "Ekana Cricket Stadium", city: "Lucknow", range: [140, 165], chaseProb: 0.40, pitch: "slow", boundary: "large" },
  "PBKS": { name: "PCA Stadium Mohali", city: "Mohali", range: [175, 205], chaseProb: 0.60, pitch: "green", boundary: "medium" },
  "KKR": { name: "Eden Gardens", city: "Kolkata", range: [185, 220], chaseProb: 0.65, pitch: "slow", boundary: "medium" },
  "RR": { name: "Sawai Mansingh Stadium", city: "Jaipur", range: [170, 195], chaseProb: 0.50, pitch: "dusty", boundary: "large" },
  "DC": { name: "Arun Jaitley Stadium", city: "Delhi", range: [180, 210], chaseProb: 0.65, pitch: "flat", boundary: "small" },
  "SRH": { name: "Rajiv Gandhi Intl", city: "Hyderabad", range: [195, 235], chaseProb: 0.45, pitch: "flat", boundary: "medium" }
};

let rngSeed = Date.now();
function seededRandom() {
  rngSeed = (rngSeed * 9301 + 49297) % 233280;
  return rngSeed / 233280;
}

// Global Form Tracker
const formTracker = {}; 
function getForm(name) {
    if(!formTracker[name]) formTracker[name] = 1.0;
    return formTracker[name];
}
function updateForm(name, runs, balls) {
    if(!formTracker[name]) formTracker[name] = 1.0;
    if(balls > 10) {
        const sr = (runs/balls)*100;
        if(sr > 160) formTracker[name] = Math.min(1.25, formTracker[name] + 0.05);
        else if(sr < 100) formTracker[name] = Math.max(0.75, formTracker[name] - 0.05);
    }
}
function updateBowlingForm(name, figures) {
    if(!formTracker[name]) formTracker[name] = 1.0;
    // figures: { runs, wkts }
    if(figures.wkts >= 2) formTracker[name] = Math.min(1.2, formTracker[name] + 0.05);
    else if(figures.runs > 50 && figures.wkts === 0) formTracker[name] = Math.max(0.8, formTracker[name] - 0.05);
}

// Helper for Venue Mapping
function getVenueForTeam(teamName) {
    // Try to match team name directly with keys
    for (const key of Object.keys(VENUE_MAP)) {
        if (teamName.toUpperCase().includes(key)) return VENUE_MAP[key];
    }
    // Default fallback: Random venue instead of always Wankhede
    const venueKeys = Object.keys(VENUE_MAP);
    return VENUE_MAP[venueKeys[Math.floor(seededRandom() * venueKeys.length)]];
}

// --- 2. BOWLING LOGIC ---
const bowlingLogic = {
  getBowlerType: (player) => {
    const role = (player.roleKey?.toLowerCase() || player.role?.toLowerCase() || '');
    const name = (player.name || '').toLowerCase();
    let type = 'pacer';
    
    if (role.includes('off') || name.includes('ashwin') || name.includes('narine')) type = 'off-spinner';
    else if (role.includes('leg') || name.includes('chahal') || name.includes('rashid')) type = 'leg-spinner';
    else if (role.includes('spin') || name.includes('jadeja')) type = 'spinner';
    else if (role.includes('fast') || role.includes('pace')) type = 'pacer';
    
    if (role.includes('ar') || role.includes('all')) {
      const bat = player.stats?.bat || 0;
      const bowl = player.stats?.bowl || 0;
      if (bat >= 80 && bowl >= 60) return `ar-balanced-${type}`;
      return `ar-bowler-${type}`;
    }
    return type;
  },

  prepareBowlersForInnings: (playing11) => {
    // 1. Filter, then Map to NEW Objects to break reference accumulation
    let bowlers = playing11
        .filter(p => {
            const r = (p.roleKey || p.role || '').toLowerCase();
            if(r.includes('wk')) return false;
            return (r.includes('bowl') || r.includes('fast') || r.includes('spin') || r.includes('ar') || r.includes('all'));
        })
        .map(p => ({
            ...p, // Copy basic props
            maxOvers: 4,
            remaining: 4,
            oversUsed: 0,
            balls: 0,
            wkts: 0,
            runs: 0,
            lastBowledOver: -2,
            economy: 0,
            oversDisplay: "0.0"
        }));

    // 2. Calculate Capacity
    let totalCapacity = bowlers.reduce((sum, b) => sum + b.remaining, 0);

    // 3. Fill Shortage with Non-Bowlers if needed
    if (totalCapacity < 20) {
        // Find others who are NOT in the bowlers list
        const others = playing11.filter(p => !bowlers.find(b => b.name === p.name));
        
        let otherIndex = 0;
        while(totalCapacity < 20 && otherIndex < others.length) {
             const newBowler = {
                 ...others[otherIndex], 
                 isPartTime: true,
                 maxOvers: 4, // Give full quota to ensure we cross 20
                 remaining: 4,
                 oversUsed: 0,
                 balls: 0,
                 wkts: 0,
                 runs: 0,
                 lastBowledOver: -2,
                 economy: 0,
                 oversDisplay: "0.0"
             };
             bowlers.push(newBowler);
             totalCapacity += 4;
             otherIndex++;
        }
    }
    
    // 4. Emergency Fallback: If still < 20 (e.g. very small squad), force over-bowling
    if(totalCapacity < 20 && bowlers.length > 0) {
         let i = 0;
         while(totalCapacity < 20) {
             bowlers[i % bowlers.length].remaining++;
             bowlers[i % bowlers.length].maxOvers++;
             totalCapacity++;
             i++;
         }
    }

    // Sort by skill for selection priority
    const ranked = bowlers.sort((a,b) => (b.stats?.bowl || 0) - (a.stats?.bowl || 0));

    return ranked;
  },

  selectBowlerForOver: (bowlable, overNumber, phase) => {
    // Candidates who have overs left and didn't bowl the last over
    let candidates = bowlable.filter(b => b.remaining > 0 && b.lastBowledOver !== overNumber - 1);
    
    // Fallback: If no one is eligible (e.g. only 1 bowler left with overs), pick ANYONE with overs
    if(candidates.length === 0) {
        const any = bowlable.filter(b => b.remaining > 0).sort((a,b) => b.remaining - a.remaining)[0];
        if(!any) return null; // Truly no overs left
        return any;
    }

    // Phase Priorities
    const type = (b) => bowlingLogic.getBowlerType(b);
    
    // Sort by suitability for phase
    // Sort by suitability for phase
    candidates.sort((a, b) => {
        let scoreA = a.stats?.bowl || 50;
        let scoreB = b.stats?.bowl || 50;  

        // Death: Pacers + High Skill
        if(phase === 'death') {
            if(type(a).includes('pacer')) scoreA += 25; // Boost pacers
            if(type(b).includes('pacer')) scoreB += 25;
        }
        // PP: Swing / Pacers
        if(phase === 'pp') {
            if(type(a).includes('pacer')) scoreA += 15;
            if(type(b).includes('pacer')) scoreB += 15;
        }
        // Mid: Spinners
        if(phase === 'mid') {
            if(type(a).includes('spin')) scoreA += 10;
            if(type(b).includes('spin')) scoreB += 10;
        }

        // Economy influence (don't pick expensive bowlers in death if avoided)
        if (a.runs > 11 * (a.oversUsed || 1)) scoreA -= 15;
        if (b.runs > 11 * (b.oversUsed || 1)) scoreB -= 15;
        
        return (scoreB + seededRandom()*15) - (scoreA + seededRandom()*15);
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
      const eco = totalOvers > 0 ? (bowler.runs / totalOvers) : 0;
      bowler.economy = eco.toFixed(2); 
  }
};

function layoutOvers(balls) {
    if(!balls) return "0.0";
    const o = Math.floor(balls/6);
    const b = balls%6;
    return `${o}.${b}`;
}

// --- 3. BATTING LOGIC ---
const battingLogic = {
  // Enhanced role detection with more player types for realistic simulation
  getRole: (p) => {
      const n = (p.name || '').toLowerCase();
      const role = (p.roleKey || p.role || '').toLowerCase();
      
      // Finishers - Big hitters who accelerate in death overs
      const finishers = ['russell', 'sky', 'maxwell', 'hardik', 'pollard', 'pant', 'jadeja', 'sam curran', 'stoinis', 'miller', 'tewatia', 'rinku'];
      if(finishers.some(f => n.includes(f))) return 'finisher';
      
      // Anchors - Build innings with consistent scoring
      const anchors = ['kohli', 'rohit', 'williamson', 'rahul', 'du plessis', 'gill', 'dhawan', 'iyer', 'head', 'conway'];
      if(anchors.some(a => n.includes(a))) return 'anchor';
      
      // Power Hitters - Aggressive openers
      const powerHitters = ['warner', 'bairstow', 'buttler', 'gayle', 'narine', 'salt', 'gaikwad', 'shaw'];
      if(powerHitters.some(h => n.includes(h))) return 'powerHitter';
      
      // Accumulators - Strike rotators (typically WK batters)
      if(role.includes('wk')) return 'accumulator';
      
      // Default based on batting position in squad (if available)
      return 'normal';
  },

  getWicketType: (batter, bowler, phase) => {
      const r = seededRandom();
      // 1. Run Outs are rare/situational events (approx 5% overall, higher in death)
      // Death Phase Pressure: Slightly higher chance of mix-ups
      if(phase === 'death' && r < 0.10) return 'run out';
      if(phase !== 'death' && r < 0.03) return 'run out';

      // 2. Normal Wickets: Re-roll for distribution
      const wR = seededRandom();
      
      if(bowlingLogic.getBowlerType(bowler).includes('spin')) {
          if(wR < 0.50) return 'caught';
          if(wR < 0.75) return 'lbw';
          if(wR < 0.90) return 'bowled';
          return 'stumped';
      } else {
          // Pacers
          if(wR < 0.60) return 'caught';
          if(wR < 0.85) return 'bowled'; // Pacers get more bowled/lbw
          return 'lbw';
      }
  },

  calculateBallOutcome: (batter, bowler, matchState, venue) => {
      const { phase, reqRR, isChasing, recentCollpase, momentum, ballsLeft, currentScore, ballsBowled, dewActive } = matchState;
      let mode = 'normal';
      const role = battingLogic.getRole(batter);

      // --- VENUE RANGE LOGIC ---
      let rangeAggression = 0;
      if (venue.range) {
          const oversBowled = (120 - ballsLeft) / 6;
          const safeOvers = oversBowled === 0 ? 1 : oversBowled; 
          const estimatedTotal = (currentScore / safeOvers) * 20; 
          const targetMin = venue.range[0];
          const targetMax = venue.range[1];

          // Check only after 10 overs (60 balls) to avoid early game bias
          if(ballsBowled > 60) { 
              if (estimatedTotal < targetMin) rangeAggression = 1; 
              if (estimatedTotal > targetMax) rangeAggression = -1; 
          }
      }

      // 1. Situation Analysis - Enhanced with phase-specific weights
      if (recentCollpase) {
          mode = 'anchor'; // Rebuild after wickets
      } else if (phase === 'pp') {
          mode = 'powerplay'; // Use dedicated powerplay weights
      } else if (phase === 'death') {
          mode = 'death'; // Use dedicated death over weights
      } else if (momentum > 2) {
          mode = 'aggressive'; // Riding the wave
      }

      // Role-based adjustments for more realistic player behavior
      if(role === 'finisher' && (phase === 'death' || (phase === 'mid' && ballsLeft < 30))) {
           mode = 'death'; // Finishers go all out in death
      }
      if(role === 'powerHitter' && phase === 'pp') {
           mode = 'aggressive'; // Power hitters attack in powerplay
      }
      if(role === 'accumulator') {
           mode = (mode === 'desperate') ? 'aggressive' : 'controlled'; // Strike rotators
      }
      if(role === 'anchor' && recentCollpase) {
           // Anchors get extra consolidation bonus after wickets
           mode = 'anchor';
      }

      // Chase Pressure - More realistic run rate based decisions
      if (isChasing) {
          if (reqRR > 14 || (reqRR > 12 && ballsLeft < 18)) mode = 'desperate';
          else if (reqRR > 11) mode = 'death'; // Death mode for high RRR
          else if (reqRR > 9) mode = 'aggressive';
          else if (reqRR < 6) mode = 'controlled';
          
          if(dewActive && mode === 'normal') mode = 'aggressive';
      } else if (rangeAggression === 1 && mode !== 'desperate') {
          mode = 'aggressive';
      } else if (rangeAggression === -1 && (mode === 'aggressive' || mode === 'death')) {
           mode = 'controlled'; 
      }
      
      // 2. Base Weights from Mode (now uses phase-specific weights)
      let weights = { ...OUTCOME_WEIGHTS[mode] };

      // Dew Factor
      if(dewActive) {
           weights['W'] = Math.max(1, weights['W'] - 2);
           weights[4] += 2; 
           weights[6] += 1;
           // Slippery ball: More extras
           if(weights['WD'] !== undefined) weights['WD'] += 1;
           if(weights['NB'] !== undefined) weights['NB'] += 1;
      }
      
      // 3. Venue & Pitch Adjustments
      if(VENUE_EFFECTS[venue.pitch]) {
           const eff = VENUE_EFFECTS[venue.pitch];
           for(let k in eff) {
               if(weights[k] !== undefined) weights[k] += eff[k];
           }
      }
      if(venue.boundary === 'tiny') { weights[6] += 4; weights[4] += 3; }
      if(venue.boundary === 'large') { 
          weights[1] += 2; weights[2] += 2; weights[6] -= 2; 
          weights[0] = Math.max(0, weights[0] - 2); 
      }

      // 4. Form & Skill Diff
      const f = getForm(batter.name);
      const batSkill = (batter.stats?.bat || 75) * f;
      const bowlSkill = (bowler.stats?.bowl || 75) * getForm(bowler.name);
      
      const diff = batSkill - bowlSkill;

      if (diff > 15) {
          weights[4] += 5; weights[6] += 3; weights['W'] = Math.max(1, weights['W'] - 4);
      } else if (diff < -15) {
          weights[0] += 6; weights['W'] += 5; weights[6] -= 2;
      }
      
      // Death Over Acceleration
      if(phase === 'death') {
          weights[4] += 3; weights[6] += 4;
      }

      // 5. Select Outcome
      const total = Object.values(weights).reduce((a,b)=>a+b,0);
      let r = seededRandom() * total;
      let result = '0';
      for(const [k,v] of Object.entries(weights)) {
          r -= v;
          if(r <= 0) { result = k; break; }
      }

      let out = { runs: 0, wicket: false, extra: null, wicketType: null };
      
      if (result === 'W') {
          out.wicket = true;
          out.wicketType = battingLogic.getWicketType(batter, bowler, phase);
      } else if (result === 'WD' || result === 'NB') {
          out.extra = result;
          out.runs = 1; // 1 run for extra
      } else {
          out.runs = parseInt(result);
      }
      return out;
  }
};

// Helper for Pitch effects (renamed for clarity inside logic)
const VENUE_EFFECTS = PITCH_EFFECTS;

const allStats = {};
const playerToTeam = {};

const getPStat = (name, currentTeamName = "Unknown Team") => {
    if (!allStats[name]) {
        allStats[name] = { 
            name, 
            team: playerToTeam[name] || currentTeamName, 
            runs: 0, wkts: 0, pts: 0, fours: 0, sixes: 0 
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

    const unwanted = mode === 'bat' ? bowlImp.name : batImp.name;
    return squad.filter(p => p.name !== unwanted).slice(0, 11);
}

function simInnings(batTeam, bowlTeam, target, innIndex) {
    const batXI = getActiveXI(batTeam, 'bat');
    const bowlXI = getActiveXI(bowlTeam, 'bowl');
    let batOrder = [...batXI];
    const bowlers = bowlingLogic.prepareBowlersForInnings(bowlXI);
    
    let score = 0, wkts = 0, balls = 0;
    let striker = 0, nonStriker = 1;
    let nextBat = 2;
    let recentWickets = 0; 
    let momentum = 0;
    const ballLog = [];
    
    // FIX: Initialize dew effect properly
    // Dew is more likely in 2nd innings at certain venues
    const dewActive = (innIndex === 2 && seededRandom() < 0.4); // 40% chance in 2nd innings
    
    // Bat Cards Init
    const bCards = batOrder.map(p => ({ name: p.name, runs: 0, balls: 0, status: 'dnb', fours:0, sixes:0 }));
    if(bCards[0]) bCards[0].status = 'not out';
    if(bCards[1]) bCards[1].status = 'not out';

    for(let over=0; over<20; over++) {
        if(wkts>=10 || (target && score > target)) break;

        const phase = over<6?'pp':over<15?'mid':'death';
        
        const bowler = bowlingLogic.selectBowlerForOver(bowlers, over, phase);
        if(!bowler) break; 

        // Reset momentum slightly
        if(momentum > 0) momentum--;

        let legalBallsInOver = 0;
        while(legalBallsInOver < 6) {
            if(wkts>=10 || (target && score > target)) break;

            const bat = batOrder[striker];
            const bStat = bCards[striker];
            
            let reqRR = 0;
            if(target) {
                const remRuns = target - score;
                const remBalls = 120 - balls;
                reqRR = remBalls > 0 ? (remRuns/(remBalls/6)) : 99;
            }

            const recentCollpase = recentWickets > 0;
            const outcome = battingLogic.calculateBallOutcome(bat, bowler, {
                phase, reqRR, isChasing: !!target, recentCollpase, momentum, 
                ballsLeft: 120-balls, ballsBowled: balls, currentScore: score,
                dewActive: dewActive // FIX: Now properly passed
            }, getVenueForTeam(batTeam.name)); // Pass venue here

            score += outcome.runs;
            bowlingLogic.updateBowlerStats(bowler, outcome.runs);
            
            if(!outcome.extra) bowler.balls++; 
            
            ballLog.push({ over: `${over}.${legalBallsInOver+1}`, bat: bat.name, bowl: bowler.name, ...outcome });

            // Global Stats (Bowler)
            const bs = getPStat(bowler.name, bowlTeam.name);
            if(!bs.runsConceded) bs.runsConceded = 0;
            if(!bs.ballsBowled) bs.ballsBowled = 0;
            
            bs.runsConceded += outcome.runs; 
            if(!outcome.extra) bs.ballsBowled++;

            if(outcome.wicket) {
                wkts++;
                recentWickets = 2; 
                momentum = 0;
                bStat.status = 'out';
                bStat.balls++;
                updateForm(bat.name, bStat.runs, bStat.balls); 
                
                // FIX: Only credit bowler if NOT a run out
                if(outcome.wicketType !== 'run out') {
                    bs.wkts++; 
                    bs.pts+=25;
                    bowler.wkts++;
                }

                if(nextBat < batOrder.length) {
                    striker = nextBat++;
                    bCards[striker].status = 'not out';
                } else {
                    striker = -1;
                }
            } else {
                if(!outcome.extra) {
                    bStat.runs += outcome.runs;
                    bStat.balls++;
                    
                    if(outcome.runs >= 4) momentum++;
                    else momentum = Math.max(0, momentum-1);

                    const ps = getPStat(bat.name, batTeam.name);
                    if(!ps.ballsFaced) ps.ballsFaced = 0;
                    
                    ps.runs += outcome.runs; 
                    ps.ballsFaced++;
                    ps.pts += outcome.runs;
                    
                    if(outcome.runs===4) { ps.fours++; bStat.fours++; }
                    if(outcome.runs===6) { ps.sixes++; bStat.sixes++; }

                    if(outcome.runs % 2 !== 0) {
                        [striker, nonStriker] = [nonStriker, striker];
                    }
                }
            }
            if(!outcome.extra) {
                balls++;
                legalBallsInOver++;
            }
        }

        bowlingLogic.endBowlerOver(bowler);
        [striker, nonStriker] = [nonStriker, striker];
        if(recentWickets > 0) recentWickets--;
    }
    
    bCards.forEach(c => {
        if(c.status === 'not out') updateForm(c.name, c.runs, c.balls);
    });

    return { team: batTeam.name, score, wkts, balls, batting: bCards, bowling: bowlers, ballLog };
}

function simulateMatch(t1, t2, type = "LEAGUE") {
    // TOSS & CHASE DECISION
    let firstBat, secondBat;
    const tossWinner = seededRandom() > 0.5 ? t1 : t2; 
    const tossLoser = tossWinner === t1 ? t2 : t1;
    let electedTo = "bat";

    const venue = getVenueForTeam(t1.name); // Venue based on t1 (home team)

    if (seededRandom() < venue.chaseProb) { 
        firstBat = tossLoser;
        secondBat = tossWinner;
        electedTo = "bowl";
    } else { 
        firstBat = tossWinner;
        secondBat = tossLoser;
    }

    // Innings 1: firstBat batting (ActiveXI='bat'), secondBat bowling (ActiveXI='bowl')
    const i1 = simInnings(firstBat, secondBat, null, 1);
    
    // Innings 2: secondBat batting (ActiveXI='bat'), firstBat bowling (ActiveXI='bowl')
    // This implicitly handles the SWAP because simInnings calls getActiveXI(team, mode)
    const i2 = simInnings(secondBat, firstBat, i1.score, 2);

    // Determine Winner (Robust)
    const s1 = parseInt(i1.score);
    const s2 = parseInt(i2.score);
    
    let winner = s1 > s2 ? firstBat.name : secondBat.name;
    if(s1 === s2) winner = "Tie";

    // Margin Logic
    let margin = "Tie";
    if(winner === firstBat.name) {
        margin = `${s1 - s2} runs`;
    } else if (winner === secondBat.name) {
        margin = `${10 - i2.wkts} wickets`;
    } // Tie case handled implicitly

    // Correctly map scores to t1 and t2
    const t1Score = firstBat.name === t1.name ? i1 : i2;
    const t2Score = firstBat.name === t2.name ? i1 : i2;

    return {
        t1: t1.name, t2: t2.name,
        score1: `${t1Score.score}/${t1Score.wkts}`,
        score2: `${t2Score.score}/${t2Score.wkts}`,
        winner: winner,  
        winnerName: winner,
        margin: margin,
        toss: `${tossWinner.name} won toss & chose to ${electedTo}`,
        tossDetails: { winner: tossWinner.name, decision: electedTo },
        venue: venue,
        type,
        details: { 
            i1: { ...i1, teamName: firstBat.name }, 
            i2: { ...i2, teamName: secondBat.name } 
        },
        batFirst: firstBat.name 
    };
}

// --- 4. TOURNAMENT SIMULATION ---
// --- 4. TOURNAMENT SIMULATION ---
function runLocalTournament(tourneyTeams) {
    if(!tourneyTeams || tourneyTeams.length < 2) throw new Error("Need at least 2 teams to simulate.");

    // Clear stats for new tournament
    for (const key in allStats) delete allStats[key];
    for (const key in playerToTeam) delete playerToTeam[key];

    // Safety: Ensure all teams have minimal squad to prevent crash
    tourneyTeams.forEach(t => {
        if(!t.squad) t.squad = [];
        // Auto-fill dummy players if < 11
        while(t.squad.length < 12) {
             t.squad.push({
                 name: `Player_${t.name}_${t.squad.length+1}`, 
                 roleKey: 'ar', 
                 stats: { bat: 60, bowl: 60, luck: 50 }
             });
        }
        // Map players to teams for awards
        t.squad.forEach(p => playerToTeam[p.name] = t.name);
        t.stats = { played:0, won:0, lost:0, pts:0, nrr:0, rs:0, rc:0, of:0, ob:0 };
    });

    const matches = [];

    // Helper to update NRR and Points
    function handleLeaguePoints(match) {
        const t1 = tourneyTeams.find(t => t.name === match.t1);
        const t2 = tourneyTeams.find(t => t.name === match.t2);
        if(!t1 || !t2) return;

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

        // --- NRR Logic ---
        // Parse scores: "180/5" -> 180 runs, 5 wkts
        const [r1, w1] = match.score1.split('/').map(Number);
        const [r2, w2] = match.score2.split('/').map(Number);

        t1.stats.rs += r1; t1.stats.rc += r2;
        t2.stats.rs += r2; t2.stats.rc += r1;

        // Overs faced/bowled
        // Simplified: Assume 20 overs unless all out (simplified version)
        const o1 = w1 === 10 ? 20 : 20; 
        const o2 = w2 === 10 ? 20 : 20;

        t1.stats.of += o1; t1.stats.ob += o2;
        t2.stats.of += o2; t2.stats.ob += o1;
    }

    // 1. League Stage (Single Round Robin)
    for (let i = 0; i < tourneyTeams.length; i++) {
        for (let j = i + 1; j < tourneyTeams.length; j++) {
            const m = simulateMatch(tourneyTeams[i], tourneyTeams[j], "League");
            handleLeaguePoints(m);
            matches.push(m);
        }
    }

    // 2. Final Standings
    tourneyTeams.forEach(t => {
        const rr = t.stats.of > 0 ? (t.stats.rs / t.stats.of) : 0;
        const ra = t.stats.ob > 0 ? (t.stats.rc / t.stats.ob) : 0;
        t.stats.nrr = parseFloat((rr - ra).toFixed(3));
    });

    const standings = [...tourneyTeams].sort((a,b) => b.stats.pts - a.stats.pts || b.stats.nrr - a.stats.nrr);

    // 3. Playoffs
    const playoffs = [];
    let champion = standings[0];
    let runnerUp = standings[1];

    if (standings.length >= 4) {
        const q1 = simulateMatch(standings[0], standings[1], "Qualifier 1");
        const eli = simulateMatch(standings[2], standings[3], "Eliminator");
        
        const winnerQ1 = q1.winnerName === standings[0].name ? standings[0] : standings[1];
        const loserQ1 = q1.winnerName === standings[0].name ? standings[1] : standings[0];
        const winnerEli = eli.winnerName === standings[2].name ? standings[2] : standings[3];
        
        const q2 = simulateMatch(loserQ1, winnerEli, "Qualifier 2");
        const winnerQ2 = q2.winnerName === loserQ1.name ? loserQ1 : winnerEli;
        
        const final = simulateMatch(winnerQ1, winnerQ2, "Final");
        
        champion = final.winnerName === winnerQ1.name ? winnerQ1 : winnerQ2;
        runnerUp = final.winnerName === winnerQ1.name ? winnerQ2 : winnerQ1;
        
        playoffs.push(q1, eli, q2, final);
    }

    // Awards Function
    const getTop = (key) => {
        let best = { name: "TBA", val: -1, team: "TBA" };
        for(let p in allStats) {
            if(allStats[p][key] > best.val) {
                best = { name: p, val: allStats[p][key], team: allStats[p].team };
            }
        }
        return best;
    };

    return {
        winner: { name: champion.name, playerName: champion.playerName },
        runnerUp: { name: runnerUp.name, playerName: runnerUp.playerName },
        standings: standings.map(s => ({
            name: s.name,
            playerName: s.playerName,
            stats: s.stats
        })),
        leagueMatches: matches,
        playoffs: playoffs,
        orangeCap: getTop('runs'),
        purpleCap: getTop('wkts'),
        mvp: getTop('pts'),
        mostSixes: getTop('sixes'),
        highestSr: { name: "N/A", val: 0, team: "N/A" },
        bestEco: { name: "N/A", val: 0, team: "N/A" },
        tournamentSixes: Object.values(allStats).reduce((sum, p) => sum + (p.sixes || 0), 0)
    };
}


// =================================================================
// 🚀 AI ENGINE: GEMINI API INTEGRATION (Gemini 2.0 Flash)
// =================================================================
const https = require('https');
require('dotenv').config(); // Load environment variables

// ✅ SECURE: Using environment variable for API key
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const API_TIMEOUT_MS = 30000; // 30 second timeout for API calls 

async function runFullTournament(tourneyTeams, customPrompt = "") {
    console.log("🤖 Gemini AI is simulating your tournament...");

    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes("YOUR_")) {
        console.error("❌ ERROR: Gemini API Key is missing! Falling back to Local Engine.");
        return runLocalTournament(tourneyTeams);
    }

    // 1. Prepare data for the prompt
    const teamData = tourneyTeams.map(t => {
        const squadInfo = (t.squad && t.squad.length > 5) 
            ? t.squad.map(p => `${p.name} (${p.roleKey || 'bat'})`).join(", ") 
            : "Empty squad (AI: Please invent a realistic T20 starting XI for this team name)";
        return `Team: ${t.name}\nPlayers: ${squadInfo}`;
    }).join("\n\n");

    const promptText = `
    Act as a professional Cricket Simulation Engine. Simulate a full T20 Cricket Tournament based on these teams:
    
    ${teamData}

    ${customPrompt ? `--- USER CUSTOM DIRECTIVES ---\n${customPrompt}\n------------------------------` : ""}

    REQUIREMENTS:
    - Simulate a League stage (Single Round Robin).
    - Simulate Playoffs (Qualifier 1, Eliminator, Qualifier 2, Final).
    - Provide realistic T20 scores (140-230 range).
    - Calculate top performer awards (Orange Cap, Purple Cap, MVP, Most Sixes, Highest SR, Best Economy).
    - IMPORTANT: Ensure "standings" array is fully populated with ALL teams.
    - IMPORTANT: Ensure "leagueMatches" contains ALL match results.

    OUTPUT JSON STRUCTURE:
    Return ONLY a raw JSON object matching this structure:
    {
      "winner": { "name": "Team Name" },
      "runnerUp": { "name": "Team Name" },
      "standings": [
        { "name": "CSK", "stats": { "played": 14, "won": 8, "lost": 6, "pts": 16, "nrr": 0.12 } },
        { "name": "MI", "stats": { "played": 14, "won": 7, "lost": 7, "pts": 14, "nrr": -0.05 } }
      ],
      "leagueMatches": [
        { "t1": "CSK", "t2": "MI", "winner": "CSK", "margin": "10 runs", "score1": "180/4", "score2": "170/9", "type": "League" }
      ],
      "playoffs": [
        { "t1": "CSK", "t2": "RCB", "winner": "CSK", "margin": "5 wkts", "score1": "150/5", "score2": "151/5", "type": "Qualifier 1" }
      ],
      "orangeCap": { "name": "Player Name", "val": 650, "team": "Team Code" },
      "purpleCap": { "name": "Player Name", "val": 24, "team": "Team Code" },
      "mvp": { "name": "Player Name", "val": 350, "team": "Team Code" },
      "mostSixes": { "name": "Player Name", "val": 35, "team": "Team Code" },
      "highestSr": { "name": "Player Name", "val": 210.5, "team": "Team Code" },
      "bestEco": { "name": "Player Name", "val": 6.2, "team": "Team Code" },
      "tournamentSixes": 450
    }
    `;

    // 2. Call the API
    try {
        const responseText = await callGeminiAPI(promptText);
        
        // Clean markdown backticks if AI adds them
        let cleanJson = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
        
        // Robust Extraction: Find substring between first { and last }
        const firstParen = cleanJson.indexOf('{');
        const lastParen = cleanJson.lastIndexOf('}');
        if(firstParen !== -1 && lastParen !== -1) {
            cleanJson = cleanJson.substring(firstParen, lastParen + 1);
        }

        const data = JSON.parse(cleanJson);
        
        // Enrich with original team metadata (e.g. Owner Name)
        if(data.standings && Array.isArray(data.standings)) {
            data.standings.forEach(s => {
               const original = tourneyTeams.find(t => t.name === s.name);
               if(original) {
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
        } catch(localErr) {
             console.error("❌ Local Simulation also failed:", localErr);
             return { error: "Both AI and Local Simulation Failed", details: localErr.message };
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
                // Forces the model to output valid JSON
                response_mime_type: "application/json",
                temperature: 0.7, // Slightly lower for more consistent realistic results
                topP: 0.9,
                topK: 40
            }
        });

        const options = {
            hostname: 'generativelanguage.googleapis.com',
            // ✅ UPGRADED: Using Gemini 2.0 Flash for better accuracy
            path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            timeout: API_TIMEOUT_MS // Request timeout
        };

        const req = https.request(options, (res) => {
            let resBody = '';
            res.on('data', (chunk) => resBody += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(resBody);
                    if (parsed.error) {
                        console.error("Gemini API Error:", parsed.error);
                        return reject(parsed.error.message || "Gemini API returned an error");
                    }
                    
                    if (!parsed.candidates || !parsed.candidates[0]) {
                        return reject("No response candidates from Gemini API");
                    }
                    
                    const text = parsed.candidates[0].content.parts[0].text;
                    resolve(text);
                } catch (e) {
                    console.error("Parse Error:", e.message, "Response:", resBody.substring(0, 500));
                    reject("Failed to parse Gemini API response: " + e.message);
                }
            });
        });

        // ✅ Timeout handling - prevents hanging indefinitely
        req.setTimeout(API_TIMEOUT_MS, () => {
            req.destroy();
            reject("Gemini API request timed out after " + (API_TIMEOUT_MS/1000) + " seconds");
        });

        req.on('error', (e) => {
            console.error("Request Error:", e.message);
            reject("Network error: " + e.message);
        });
        
        req.write(postData);
        req.end();
    });
}


module.exports = { runFullTournament, simulateMatch };
