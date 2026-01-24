// =================================================================
// 🚀 AI ENGINE: Batting, Bowling & Tournament Logic (FINAL v4)
// =================================================================

// --- 1. CONFIGURATION & WEIGHTS ---
const OUTCOMEWEIGHTS = {
    anchor:      { 0: 30, 1: 40, 2: 15, 3: 5, 4: 6, 6: 2, 'W': 2, 'WD': 0, 'NB': 0 },
    normal:      { 0: 26, 1: 34, 2: 21, 3: 8, 4: 5, 6: 2, 'W': 6, 'WD': 2, 'NB': 1 },
    controlled:  { 0: 22, 1: 36, 2: 23, 3: 9, 4: 6, 6: 3, 'W': 7, 'WD': 2, 'NB': 1 },
    aggressive:  { 0: 21, 1: 29, 2: 17, 3: 10, 4: 8, 6: 7, 'W': 8, 'WD': 2, 'NB': 2 },
    desperate:   { 0: 14, 1: 22, 2: 12, 3: 8, 4: 10, 6: 14, 'W': 16, 'WD': 3, 'NB': 3 }
};

const PITCHEFFECTS = {
    flat:   { 4: 2, 6: 2, 'W': -1 },
    green:  { 'W': 3, 0: 4, 4: -2 },
    dusty:  { 'W': 2, 0: 3, 1: -2 },
    slow:   { 6: -3, 2: 4, 1: 3 } 
};

const VENUEMAP = {
    "CSK": { name: "M. A. Chidambaram Stadium", city: "Chennai", range: [160, 185], chaseProb: 0.55, pitch: "dusty", boundary: "large", dewChance: 0.60 },
    "MI": { name: "Wankhede Stadium", city: "Mumbai", range: [190, 225], chaseProb: 0.60, pitch: "flat", boundary: "small", dewChance: 0.80 }, 
    "RCB": { name: "M. Chinnaswamy Stadium", city: "Bengaluru", range: [200, 240], chaseProb: 0.65, pitch: "flat", boundary: "tiny", dewChance: 0.40 }, 
    "GT": { name: "Narendra Modi Stadium", city: "Ahmedabad", range: [170, 200], chaseProb: 0.60, pitch: "green", boundary: "large", dewChance: 0.50 },
    "LSG": { name: "Ekana Cricket Stadium", city: "Lucknow", range: [140, 165], chaseProb: 0.40, pitch: "slow", boundary: "large", dewChance: 0.20 },
    "PBKS": { name: "PCA Stadium Mohali", city: "Mohali", range: [175, 205], chaseProb: 0.60, pitch: "green", boundary: "medium", dewChance: 0.30 },
    "KKR": { name: "Eden Gardens", city: "Kolkata", range: [185, 220], chaseProb: 0.60, pitch: "slow", boundary: "medium", dewChance: 0.70 },
    "RR": { name: "Sawai Mansingh Stadium", city: "Jaipur", range: [170, 195], chaseProb: 0.50, pitch: "dusty", boundary: "large", dewChance: 0.30 },
    "DC": { name: "Arun Jaitley Stadium", city: "Delhi", range: [180, 210], chaseProb: 0.65, pitch: "flat", boundary: "small", dewChance: 0.60 },
    "SRH": { name: "Rajiv Gandhi Intl", city: "Hyderabad", range: [195, 235], chaseProb: 0.50, pitch: "flat", boundary: "medium", dewChance: 0.30 }
};

// --- 4. TOURNAMENT SIMULATION (Main Wrapper) ---
function runFullTournament(tourneyTeams) {
    if(tourneyTeams.length < 2) throw new Error("Need at least 2 teams to simulate.");

    let rngSeed = Date.now();
    const formTracker = {};
    const allStats = {};
    const impactPlayerStats = {}; 

    function seededRandom() {
        rngSeed = (rngSeed * 9301 + 49297) % 233280;
        return rngSeed / 233280;
    }

    // Normalize only active players to avoid unrealistic bench decay.
    function normalizeForm(activePlayerNames) {
        if(!activePlayerNames) return;
        activePlayerNames.forEach(name => {
            if(formTracker[name]) {
                // Decay form towards 1.0 by 30% only if they played
                formTracker[name] = 1.0 + (formTracker[name] - 1.0) * 0.7;
            }
        });
    }

    function getForm(name) {
        if(!formTracker[name]) formTracker[name] = 1.0;
        return formTracker[name];
    }

    function updateForm(name, runs, balls) {
        if(!formTracker[name]) formTracker[name] = 1.0;
        if(balls > 8) { 
            const sr = (runs/balls) * 100;
            if(sr > 175) formTracker[name] = Math.min(1.30, formTracker[name] + 0.05);
            else if(sr < 100) formTracker[name] = Math.max(0.70, formTracker[name] - 0.05);
        }
    }

    function getVenueForTeam(teamName) {
        for (const key of Object.keys(VENUEMAP)) {
            if (teamName.toUpperCase().includes(key)) return VENUEMAP[key];
        }
        const venueKeys = Object.keys(VENUEMAP);
        return VENUEMAP[venueKeys[Math.floor(seededRandom() * venueKeys.length)]];
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

        prepareBowlersForInnings: (playing11, maxOversPerBowler = 4) => {
            const bowlers = playing11
                .filter(p => {
                    const r = (p.roleKey || p.role || '').toLowerCase();
                    if(r.includes('wk')) return false;
                    return (r.includes('bowl') || r.includes('fast') || r.includes('spin') || r.includes('ar') || r.includes('all'));
                })
                .map(p => ({
                    ...p,
                    maxOvers: maxOversPerBowler,
                    remaining: maxOversPerBowler,
                    oversUsed: 0,
                    balls: 0,
                    wkts: 0,
                    runs: 0,
                    lastBowledOver: -2,
                    economy: 0,
                    oversDisplay: "0.0"
                }));

            if (bowlers.length < 5) {
                const others = playing11.filter(p => !bowlers.find(b => b.name === p.name));
                if(others.length > 0) {
                     bowlers.push({
                         ...others[0], 
                         isPartTime: true,
                         maxOvers: Math.min(2, maxOversPerBowler),
                         remaining: Math.min(2, maxOversPerBowler),
                         oversUsed: 0, balls: 0, wkts: 0, runs: 0,
                         lastBowledOver: -2, economy: 0, oversDisplay: "0.0"
                     });
                }
            }

            const ranked = bowlers.sort((a,b) => (b.stats?.bowl || 0) - (a.stats?.bowl || 0));

            ranked.forEach(b => {
                if(b.isPartTime) { 
                    b.maxOvers = Math.min(2, maxOversPerBowler); 
                    b.remaining = Math.min(2, maxOversPerBowler); 
                }
            });

            if(ranked.length >= 6 && maxOversPerBowler >= 2) {
                if(ranked[4]) { ranked[4].maxOvers = 2; ranked[4].remaining = 2; }
                if(ranked[5]) { ranked[5].maxOvers = 2; ranked[5].remaining = 2; }
            }

            return ranked;
        },

        selectBowlerForOver: (bowlable, overNumber, phase) => {
            let candidates = bowlable.filter(b => b.remaining > 0 && b.lastBowledOver !== overNumber - 1);
            
            if(candidates.length === 0) {
                candidates = bowlable.filter(b => b.remaining > 0).sort((a,b) => b.remaining - a.remaining);
                if(candidates.length === 0) return null;
            }

            const type = (b) => bowlingLogic.getBowlerType(b);
            
            candidates.sort((a, b) => {
                let scoreA = a.stats?.bowl || 50;
                let scoreB = b.stats?.bowl || 50;  

                if(phase === 'death') {
                    if(type(a).includes('pacer')) scoreA += 30; 
                    if(type(b).includes('pacer')) scoreB += 30;
                }
                if(phase === 'pp') {
                    if(type(a).includes('pacer')) scoreA += 15;
                    if(type(b).includes('pacer')) scoreB += 15;
                }
                if(phase === 'mid') {
                    if(type(a).includes('spin')) scoreA += 15;
                    if(type(b).includes('spin')) scoreB += 15;
                }

                if (a.runs > 11 * (a.oversUsed || 1)) scoreA -= 20; 
                if (b.runs > 11 * (b.oversUsed || 1)) scoreB -= 20;
                
                return (scoreB + seededRandom() * 15) - (scoreA + seededRandom() * 15);
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
             bowler.oversUsed++;

             const overs = Math.floor(bowler.balls / 6);
             const balls = bowler.balls % 6;
             bowler.oversDisplay = `${overs}.${balls}`;

             const totalOvers = bowler.balls / 6;
             const eco = totalOvers > 0 ? (bowler.runs / totalOvers) : 0;
             bowler.economy = parseFloat(eco.toFixed(2)); 
        }
    };

    // --- 3. BATTING LOGIC ---
    const battingLogic = {
        getRole: (p) => {
             const n = (p.name || '').toLowerCase();
             if(n.includes('russell') || n.includes('sky') || n.includes('maxwell') || n.includes('poor')) return 'finisher';
             if(n.includes('kohli') || n.includes('rohit') || n.includes('williamson')) return 'anchor';
             return 'normal';
        },

        getWicketType: (batter, bowler, phase) => {
             const r = seededRandom();
             if(phase === 'death' && r < 0.01) return 'run out'; 
             if(phase !== 'death' && r < 0.003) return 'run out';

             const wR = seededRandom();
             const bType = bowlingLogic.getBowlerType(bowler);
             
             if(bType.includes('spin')) {
                 if(wR < 0.55) return 'caught'; 
                 if(wR < 0.75) return 'lbw';
                 if(wR < 0.90) return 'bowled';
                 return 'stumped';
             } else {
                 if(wR < 0.65) return 'caught';
                 if(wR < 0.85) return 'bowled';
                 return 'lbw';
             }
        },

        calculateBallOutcome: (batter, bowler, matchState, venue) => {
             const { phase, reqRR, isChasing, recentCollpase, momentum, ballsLeft, currentScore, ballsBowled, dewActive } = matchState;
             let mode = 'normal';
             const role = battingLogic.getRole(batter);

             let rangeAggression = 0;
             if (venue.range) {
                 const safeOvers = ballsBowled / 6 || 1; 
                 const estimatedTotal = (currentScore / safeOvers) * 20; 
                 
                 if(ballsBowled > 36) { 
                     if (estimatedTotal < venue.range[0]) rangeAggression = 1; 
                     if (estimatedTotal > venue.range[1]) rangeAggression = -1; 
                 }
             }

             mode = 'normal';
             if (recentCollpase) mode = 'anchor';
             
             if (isChasing && reqRR < 6) mode = 'controlled';
             if (rangeAggression === -1) mode = 'controlled';
             
             if (phase === 'death') mode = 'aggressive';
             if (momentum > 2) mode = 'aggressive';
             
             if (role === 'finisher' && (phase === 'death' || (phase === 'mid' && ballsLeft < 18))) mode = 'aggressive';
             
             if (isChasing && reqRR > 10) mode = 'aggressive';
             if (dewActive && isChasing) mode = 'aggressive';
             if (rangeAggression === 1) mode = 'aggressive';
             
             if (isChasing && (reqRR > 13 || (reqRR > 0 && ballsLeft < 18))) mode = 'desperate';
             
             let weights = { ...OUTCOMEWEIGHTS[mode] };

             if(dewActive) {
                 weights['W'] = Math.max(1, weights['W'] - 1); 
                 weights[4] += 1; 
                 weights[6] += 1;
                 if(weights['WD'] !== undefined) weights['WD'] += 1; 
                 if(weights['NB'] !== undefined) weights['NB'] += 0; 
             }
             
             if(PITCHEFFECTS[venue.pitch]) {
                 const eff = PITCHEFFECTS[venue.pitch];
                 for(let k in eff) {
                     if(weights[k] !== undefined) weights[k] += eff[k];
                 }
             }
             
             if(venue.boundary === 'tiny') { 
                 if(phase === 'death' || momentum > 2) { weights[6] += 4; weights[4] += 3; } 
                 else { weights[6] += 2; weights[4] += 1; }
             }
             if(venue.boundary === 'small') {
                 if(phase === 'death' || momentum > 2) { weights[6] += 2; weights[4] += 2; }
                 else { weights[6] += 1; weights[4] += 1; }
             }
             if(venue.boundary === 'large') { 
                 weights[1] += 2; weights[2] += 2; weights[6] -= 2; 
                 weights[0] = Math.max(0, weights[0] - 2); 
             }

             const f = getForm(batter.name);
             const batSkill = (batter.stats?.bat || 75) * f;
             const bowlSkill = (bowler.stats?.bowl || 75) * getForm(bowler.name);
             const diff = batSkill - bowlSkill;

             if (diff > 15) {
                 weights[4] += 5; weights[6] += 3; weights['W'] = Math.max(1, weights['W'] - 4);
             } else if (diff < -15) {
                 weights[0] += 6; weights['W'] += 5; weights[6] -= 2;
             }
             
             if(weights['WD'] > 5) weights['WD'] = 5;
             if(weights['NB'] > 3) weights['NB'] = 3;

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
                 out.runs = 1; 
             } else {
                 out.runs = parseInt(result);
             }
             return out;
        }
    };

    const getPStat = (name) => {
        if(!allStats[name]) allStats[name] = { name, runs:0, wkts:0, pts:0, fours:0, sixes:0 };
        return allStats[name];
    };

    const getImpactStat = (name) => {
        if(!impactPlayerStats[name]) impactPlayerStats[name] = { name, gamesAsImpact: 0, impactRuns: 0, impactWickets: 0, impactPoints: 0 };
        return impactPlayerStats[name];
    };

    tourneyTeams.forEach(t => {
        t.stats = { played:0, won:0, lost:0, tied:0, pts:0, nrr:0, rs:0, rc:0, of:0, ob:0 };
    });

    // --- SUPER OVER SIMULATION ---
    function simulateSuperOver(team1, team2, venue) {
        function getStarBatsmen(xi) {
            return xi.sort((a,b) => (b.stats?.bat || 0) - (a.stats?.bat || 0)).slice(0, 3);
        }

        function getStarBowler(xi) {
            const bowlers = xi.filter(p => {
                const r = (p.roleKey || p.role || '').toLowerCase();
                return (r.includes('bowl') || r.includes('fast') || r.includes('spin') || r.includes('ar'));
            });
            return bowlers.sort((a,b) => ((b.stats?.bowl || 0) + (b.roleKey?.includes('fast') ? 10 : 0)) - ((a.stats?.bowl || 0) + (a.roleKey?.includes('fast') ? 10 : 0)))[0];
        }

        function simSuperOverInning(batTeam, bowlTeam) {
            const batXI = batTeam.playing11 || batTeam.squad.slice(0, 11);
            const bowlXI = bowlTeam.playing11 || bowlTeam.squad.slice(0, 11);
            
            const batsmen = getStarBatsmen(batXI);
            const bowler = getStarBowler(bowlXI);

            if (!bowler) return { score: 0, wickets: 2, balls: 6, boundaries: 0 };

            let score = 0, wickets = 0, balls = 0, boundaries = 0;
            let striker = 0, nonStriker = 1;
            let nextBat = 2;

            const bowlerObj = {
                ...bowler,
                maxOvers: 1, remaining: 1, oversUsed: 0, balls: 0,
                wkts: 0, runs: 0, economy: 0, oversDisplay: "0.0"
            };

            let legalBalls = 0;
            while(legalBalls < 6 && wickets < 2) {
                const bat = batsmen[striker];
                if (!bat) break;

                const outcome = battingLogic.calculateBallOutcome(bat, bowlerObj, {
                    phase: 'death',
                    reqRR: 0, isChasing: false, recentCollpase: false, momentum: 3,
                    ballsLeft: 6 - legalBalls, ballsBowled: legalBalls, currentScore: score, dewActive: false
                }, venue);

                score += outcome.runs;
                bowlerObj.runs += outcome.runs;
                
                if(!outcome.extra) {
                    if(outcome.runs === 4 || outcome.runs === 6) boundaries++;
                }

                if(!outcome.extra) {
                    bowlerObj.balls++;
                    legalBalls++;
                    balls++;
                }

                if(outcome.wicket) {
                    wickets++;
                    if(nextBat < batsmen.length && wickets < 2) {
                        striker = nextBat++;
                    }
                } else {
                    if(!outcome.extra && outcome.runs % 2 !== 0) {
                        [striker, nonStriker] = [nonStriker, striker];
                    }
                }
            }
            return { score, wickets, balls: legalBalls, boundaries };
        }

        const so1 = simSuperOverInning(team1, team2);
        const so2 = simSuperOverInning(team2, team1);

        let winner = null;
        let margin = "Super Over";

        if(so1.score > so2.score) {
            winner = team1.name;
            margin = `Super Over (${so1.score}/${so1.wickets} vs ${so2.score}/${so2.wickets})`;
        } else if(so2.score > so1.score) {
            winner = team2.name;
            margin = `Super Over (${so2.score}/${so2.wickets} vs ${so1.score}/${so1.wickets})`;
        } else {
            if(so1.boundaries > so2.boundaries) {
                winner = team1.name;
                margin = `Super Over - Boundary Count (${so1.boundaries} vs ${so2.boundaries})`;
            } else if (so2.boundaries > so1.boundaries) {
                winner = team2.name;
                margin = `Super Over - Boundary Count (${so2.boundaries} vs ${so1.boundaries})`;
            } else {
                winner = seededRandom() > 0.5 ? team1.name : team2.name;
                margin = "Super Over - Draw (Coin Toss)";
            }
        }

        return { winner, margin, so1, so2 };
    }

    function simulateMatch(t1, t2, type) {
        const venue = getVenueForTeam(t1.name);

        const isDewyNight = seededRandom() < (venue.dewChance || 0.3);

        function getActiveXI(team, mode) {
            const squad = team.squad || [];
            const batImp = team.batImpact;
            const bowlImp = team.bowlImpact;

            if (!batImp || !bowlImp) return squad.slice(0, 11);
            if (batImp.name === bowlImp.name) return squad.slice(0, 11);

            const unwanted = mode === 'bat' ? bowlImp.name : batImp.name;
            const wantedImpact = mode === 'bat' ? batImp : bowlImp;
            
            const filtered = squad.filter(p => p.name !== unwanted);
            if (filtered.length < 11) return squad.slice(0, 11);
            
            const hasWanted = filtered.find(p => p.name === wantedImpact.name);
            if(!hasWanted) {
                filtered.pop(); 
                filtered.push(wantedImpact);
            }
            
            return filtered.slice(0, 11);
        }

        function simInnings(batTeam, bowlTeam, target, innIndex) {
            const batXI = getActiveXI(batTeam, 'bat');
            const bowlXI = getActiveXI(bowlTeam, 'bowl');
            
            batTeam.playing11 = batXI;
            bowlTeam.playing11 = bowlXI;
            
            let batOrder = [...batXI];
            const bowlers = bowlingLogic.prepareBowlersForInnings(bowlXI);
            
            let score = 0, wkts = 0, balls = 0;
            let striker = 0, nonStriker = 1;
            let nextBat = 2;
            let recentWickets = 0; 
            let momentum = 0;
            let consecutiveDots = 0; 
            
            const dewActive = (innIndex === 1 && isDewyNight); 
            
            const bCards = batOrder.map(p => ({ name: p.name, runs: 0, balls: 0, status: 'dnb', fours:0, sixes:0 }));
            if(bCards[0]) bCards[0].status = 'not out';
            if(bCards[1]) bCards[1].status = 'not out';

            for(let over=0; over<20; over++) {
                if(wkts>=10 || (target && score >= target)) break;

                const phase = over<6?'pp':over<15?'mid':'death';
                const bowler = bowlingLogic.selectBowlerForOver(bowlers, over, phase);
                if(!bowler) break; 

                // Track Impact usage
                if(bowlTeam.bowlImpact && bowlTeam.bowlImpact.name === bowler.name) {
                     const impStat = getImpactStat(bowler.name);
                     if (!impStat.hasPlayedThisMatch) {
                         impStat.gamesAsImpact++;
                         impStat.hasPlayedThisMatch = true;
                     }
                }

                let legalBallsInOver = 0;
                while(legalBallsInOver < 6) {
                    if(wkts>=10 || (target && score >= target)) break;

                    const bat = batOrder[striker];
                    const bStat = bCards[striker];
                    
                    // Track Impact usage
                    if(batTeam.batImpact && batTeam.batImpact.name === bat.name) {
                        const impStat = getImpactStat(bat.name);
                        if (!impStat.hasPlayedThisMatch) {
                            impStat.gamesAsImpact++;
                            impStat.hasPlayedThisMatch = true;
                        }
                    }

                    let reqRR = 0;
                    if(target) {
                        const remRuns = target - score;
                        const remBalls = 120 - balls;
                        reqRR = remBalls > 0 ? (remRuns/(remBalls/6)) : 99;
                    }

                    const outcome = battingLogic.calculateBallOutcome(bat, bowler, {
                        phase, reqRR, isChasing: !!target, recentCollpase: recentWickets > 0, momentum, 
                        ballsLeft: 120-balls, ballsBowled: balls, currentScore: score, dewActive
                    }, venue);

                    score += outcome.runs;
                    bowlingLogic.updateBowlerStats(bowler, outcome.runs);
                    if(!outcome.extra) bowler.balls++; 
                    
                    const bs = getPStat(bowler.name);
                    if(!bs.runsConceded) bs.runsConceded = 0;
                    if(!bs.ballsBowled) bs.ballsBowled = 0;
                    
                    bs.runsConceded += outcome.runs; 
                    if(!outcome.extra) bs.ballsBowled++;

                    const isImpactBatter = batTeam.batImpact && batTeam.batImpact.name === bat.name;
                    const isImpactBowler = bowlTeam.bowlImpact && bowlTeam.bowlImpact.name === bowler.name;

                    if(outcome.wicket) {
                        wkts++;
                        recentWickets = 1; 
                        momentum = 0; 
                        consecutiveDots = 0;
                        bStat.status = 'out';
                        bStat.balls++;
                        updateForm(bat.name, bStat.runs, bStat.balls); 
                        
                        if(outcome.wicketType !== 'run out') {
                            bs.wkts++; 
                            bs.pts+=25;
                            bowler.wkts++;
                            
                            if(isImpactBowler) {
                                const impStat = getImpactStat(bowler.name);
                                impStat.impactWickets++;
                                impStat.impactPoints += 25;
                            }
                        } else {
                             momentum = 0;
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
                            
                            if(outcome.runs >= 4) {
                                momentum++;
                                consecutiveDots = 0;
                            } else if (outcome.runs === 0) {
                                consecutiveDots++;
                                if(consecutiveDots >= 2) momentum = Math.max(0, momentum-1);
                            } else {
                                consecutiveDots = 0;
                            }

                            const ps = getPStat(bat.name);
                            if(!ps.ballsFaced) ps.ballsFaced = 0;
                            
                            ps.runs += outcome.runs; 
                            ps.ballsFaced++;
                            ps.pts += outcome.runs;
                            
                            if(outcome.runs===4) { 
                                ps.fours++; bStat.fours++; ps.pts += 1; 
                                if(isImpactBatter) getImpactStat(bat.name).impactPoints += 1; 
                            }
                            if(outcome.runs===6) { 
                                ps.sixes++; bStat.sixes++; ps.pts += 2; 
                                if(isImpactBatter) getImpactStat(bat.name).impactPoints += 2;
                            }

                            if(isImpactBatter) {
                                const impStat = getImpactStat(bat.name);
                                impStat.impactRuns += outcome.runs;
                                impStat.impactPoints += outcome.runs;
                            }

                            if(outcome.runs % 2 !== 0) [striker, nonStriker] = [nonStriker, striker];
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

            return { team: batTeam.name, score, wkts, balls, batting: bCards, bowling: bowlers };
        }

        let firstBat, secondBat;
        const tossWinner = seededRandom() > 0.5 ? t1 : t2; 
        const tossLoser = tossWinner === t1 ? t2 : t1;
        
        const effectiveChaseProb = venue.chaseProb + (isDewyNight ? 0.15 : 0);

        let electedTo = "bat";
        if (seededRandom() < effectiveChaseProb) { 
            firstBat = tossLoser;
            secondBat = tossWinner;
            electedTo = "bowl";
        } else { 
            firstBat = tossWinner;
            secondBat = tossLoser;
        }

        // Clean slate for new match impact tracking
        Object.values(impactPlayerStats).forEach(s => delete s.hasPlayedThisMatch);

        const inn1 = simInnings(firstBat, secondBat, null, 0);
        const inn2 = simInnings(secondBat, firstBat, inn1.score + 1, 1);
        
        const activePlayers = new Set();
        [...inn1.batting, ...inn1.bowling, ...inn2.batting, ...inn2.bowling].forEach(p => activePlayers.add(p.name));
        normalizeForm(Array.from(activePlayers));

        let result = {};
        if (inn2.score > inn1.score) {
            result = {
                winner: secondBat.name,
                margin: `${10 - inn2.wkts} wickets`,
                score: `${inn2.score}/${inn2.wkts} (${(inn2.balls/6).toFixed(1)})`
            };
            secondBat.stats.won++; secondBat.stats.pts += 2;
            firstBat.stats.lost++;
        } else if (inn1.score > inn2.score) {
            result = {
                winner: firstBat.name,
                margin: `${inn1.score - inn2.score} runs`,
                score: `${inn2.score}/${inn2.wkts} (${(inn2.balls/6).toFixed(1)})`
            };
            firstBat.stats.won++; firstBat.stats.pts += 2;
            secondBat.stats.lost++;
        } else {
            const superOver = simulateSuperOver(firstBat, secondBat, venue);
            result = {
                winner: superOver.winner,
                margin: superOver.margin,
                score: "Tie",
                superOver: true
            };
            if(superOver.winner === firstBat.name) {
                firstBat.stats.won++; firstBat.stats.pts += 2;
                secondBat.stats.lost++;
            } else {
                secondBat.stats.won++; secondBat.stats.pts += 2;
                firstBat.stats.lost++;
            }
            firstBat.stats.tied++;
            secondBat.stats.tied++;
        }

        // Note: Standard IPL NRR rule - 1st innings is always 20 overs denominator if completed/all-out.
        firstBat.stats.rs += inn1.score;
        firstBat.stats.of += 20; 
        firstBat.stats.rc += inn2.score; 
        firstBat.stats.ob += inn2.balls/6;

        secondBat.stats.rs += inn2.score;
        secondBat.stats.of += inn2.balls/6;
        secondBat.stats.rc += inn1.score;
        secondBat.stats.ob += 20;

        // Cleanup temporary memory for impact stats
        Object.values(impactPlayerStats).forEach(s => delete s.hasPlayedThisMatch);

        return { inn1, inn2, result, venue };
    }

    // --- MAIN MATCH LOOP ---
    const results = [];
    for(let i=0; i<tourneyTeams.length; i++) {
        for(let j=i+1; j<tourneyTeams.length; j++) {
            results.push(simulateMatch(tourneyTeams[i], tourneyTeams[j], 'league'));
            results.push(simulateMatch(tourneyTeams[j], tourneyTeams[i], 'league'));
        }
    }

    tourneyTeams.forEach(t => {
        if(t.stats.of > 0 && t.stats.ob > 0) {
            const batRate = t.stats.rs / t.stats.of;
            const bowlRate = t.stats.rc / t.stats.ob;
            t.stats.nrr = (batRate - bowlRate).toFixed(3);
        }
        t.stats.played = t.stats.won + t.stats.lost + t.stats.tied;
    });

    // Sort teams by points and NRR
    tourneyTeams.sort((a, b) => b.stats.pts - a.stats.pts || parseFloat(b.stats.nrr) - parseFloat(a.stats.nrr));

    // --- PLAYOFFS ---
    const playoffs = [];
    let champion = tourneyTeams[0]?.name;
    let runnerUp = tourneyTeams[1]?.name;

    if (tourneyTeams.length >= 4) {
        // Simulate playoffs (simplified - just use standings)
        const q1Winner = tourneyTeams[0];
        const q2Winner = tourneyTeams[1];
        
        playoffs.push({
            type: "Qualifier 1",
            t1: tourneyTeams[0].name,
            t2: tourneyTeams[1].name,
            winner: q1Winner.name,
            margin: "Qualified for Final"
        });
        
        playoffs.push({
            type: "Eliminator",
            t1: tourneyTeams[2].name,
            t2: tourneyTeams[3].name,
            winner: tourneyTeams[2].name,
            margin: "Qualified for Qualifier 2"
        });
        
        playoffs.push({
            type: "Qualifier 2",
            t1: tourneyTeams[1].name,
            t2: tourneyTeams[2].name,
            winner: q2Winner.name,
            margin: "Qualified for Final"
        });
        
        playoffs.push({
            type: "FINAL",
            t1: q1Winner.name,
            t2: q2Winner.name,
            winner: champion,
            margin: "Champions!"
        });
    }

    // --- AWARDS ---
    const statsArr = Object.values(allStats);
    const orange = statsArr.sort((a,b) => b.runs - a.runs)[0] || { name: "N/A", runs: 0 };
    const purple = statsArr.sort((a,b) => b.wkts - a.wkts)[0] || { name: "N/A", wkts: 0 };
    const mvp = statsArr.sort((a,b) => b.pts - a.pts)[0] || { name: "N/A", pts: 0 };
    const sixes = statsArr.sort((a,b) => b.sixes - a.sixes)[0] || { name: "N/A", sixes: 0 };

    const bestSR = statsArr.filter(p => p.runs > 50).sort((a,b) => {
        const srA = (a.runs / Math.max(1, a.ballsFaced || 1)) * 100;
        const srB = (b.runs / Math.max(1, b.ballsFaced || 1)) * 100;
        return srB - srA;
    })[0];

    const bestEco = statsArr.filter(p => p.ballsBowled > 24).sort((a,b) => {
        const ecoA = (a.runsConceded || 0) / (a.ballsBowled / 6 || 1);
        const ecoB = (b.runsConceded || 0) / (b.ballsBowled / 6 || 1);
        return ecoA - ecoB;
    })[0];

    // Convert results to match format
    const leagueMatches = results.map((r, idx) => ({
        matchId: idx + 1,
        t1: r.inn1.team,
        t2: r.inn2.team,
        score1: `${r.inn1.score}/${r.inn1.wkts}`,
        score2: `${r.inn2.score}/${r.inn2.wkts}`,
        winner: r.result.winner,
        winnerName: r.result.winner,
        margin: r.result.margin,
        venue: r.venue,
        type: "League",
        details: {
            i1: r.inn1,
            i2: r.inn2
        }
    }));

    return {
        champion,
        winner: tourneyTeams[0],
        runnerUp: tourneyTeams[1],
        standings: tourneyTeams,
        pointsTable: tourneyTeams,
        matches: leagueMatches,
        leagueMatches,
        playoffs,
        orangeCap: orange,
        purpleCap: purple,
        mvp: mvp,
        awards: {
            orange: { name: orange.name, val: orange.runs },
            purple: { name: purple.name, val: purple.wkts },
            mvp: { name: mvp.name, val: mvp.pts },
            sixes: { name: sixes.name, val: sixes.sixes },
            impact: { name: mvp.name, val: mvp.pts },
            sr: { name: bestSR?.name || "N/A", val: bestSR ? ((bestSR.runs / bestSR.ballsFaced) * 100).toFixed(2) : 0 },
            eco: { name: bestEco?.name || "N/A", val: bestEco ? ((bestEco.runsConceded / (bestEco.ballsBowled / 6)).toFixed(2)) : 0 }
        },
        allTeamsData: tourneyTeams,
        impactPlayerStats
    };
}

module.exports = { runFullTournament };