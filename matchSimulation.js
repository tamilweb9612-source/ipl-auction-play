// Match Simulation Module
// ===========================================

const { 
  MATCH_CONFIG, 
  TOURNAMENT_CONFIG, 
  FORM_CONFIG, 
  MULTIPLIERS,
  PHASE_CONFIG,
  VENUE_CONFIG
} = require('./constants');
const { getCompletePlayerData } = require('./playerCache');
const { validateTeam, validateVenue } = require('./validation');
const { calculateBallOutcome } = require('./battingLogic');
const { 
  prepareBowlersForInnings, 
  selectBowlerForOver, 
  updateBowlerStats, 
  endBowlerOver 
} = require('./bowlingLogic');
const { getVenueForTeam, generateStadiumCommentary } = require('./venues');

/**
 * Get active XI based on team and mode
 * @param {Object} team - Team object
 * @param {string} mode - 'bat' or 'bowl'
 * @returns {Array} Active XI players
 */
function getActiveXI(team, mode) {
  const squad = team.squad || [];
  const batImp = team.batImpact;
  const bowlImp = team.bowlImpact;

  if (!batImp || !bowlImp) return squad.slice(0, MATCH_CONFIG.MIN_SQUAD_SIZE);

  const unwanted = mode === 'bat' ? bowlImp.name : batImp.name;
  return squad.filter(player => player.name !== unwanted).slice(0, MATCH_CONFIG.MIN_SQUAD_SIZE);
}

/**
 * Calculate team strength
 * @param {Object} team - Team object
 * @param {string} type - 'bat' or 'bowl'
 * @returns {number} Team strength rating
 */
function calculateTeamStrength(team, type) {
  if (!team?.squad?.length) return 75;
  
  const ratings = team.squad
    .map(player => {
      const db = getCompletePlayerData(player.name, player);
      return type === 'bat' ? db.bat || 60 : db.bowl || 60;
    })
    .sort((a, b) => b - a);

  // Weighted average - top players matter more
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < Math.min(MATCH_CONFIG.MIN_SQUAD_SIZE, ratings.length); i++) {
    const w = MATCH_CONFIG.MIN_SQUAD_SIZE - i;
    sum += ratings[i] * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : 75;
}

/**
 * Update player form after batting
 * @param {string} name - Player name
 * @param {number} runs - Runs scored
 * @param {number} balls - Balls faced
 * @param {Object} formTracker - Form tracker object
 */
function updateForm(name, runs, balls, formTracker) {
  if (!formTracker[name]) formTracker[name] = 1.0;
  if (balls > 10) {
    const strikeRate = (runs / balls) * 100;
    if (strikeRate > FORM_CONFIG.HIGH_STRIKE_RATE) {
      formTracker[name] = Math.min(FORM_CONFIG.MAX_FORM, formTracker[name] + FORM_CONFIG.FORM_INCREMENT);
    } else if (strikeRate < FORM_CONFIG.LOW_STRIKE_RATE) {
      formTracker[name] = Math.max(FORM_CONFIG.MIN_FORM, formTracker[name] - FORM_CONFIG.FORM_DECREMENT);
    }
  }
}

/**
 * Update bowling form
 * @param {string} name - Player name
 * @param {Object} figures - Bowling figures {runs, wkts}
 * @param {Object} formTracker - Form tracker object
 */
function updateBowlingForm(name, figures, formTracker) {
  if (!formTracker[name]) formTracker[name] = 1.0;
  
  if (figures.wkts >= 2) {
    formTracker[name] = Math.min(FORM_CONFIG.BOWLING_MAX_FORM, formTracker[name] + FORM_CONFIG.BOWLING_FORM_INCREMENT);
  } else if (figures.runs > FORM_CONFIG.BOWLING_FORM_RUNS_THRESHOLD && figures.wkts === 0) {
    formTracker[name] = Math.max(FORM_CONFIG.BOWLING_MIN_FORM, formTracker[name] - FORM_CONFIG.BOWLING_FORM_DECREMENT);
  }
}

/**
 * Get player statistics object
 * @param {string} name - Player name
 * @param {string} currentTeamName - Current team name
 * @param {Object} allStats - All statistics object
 * @param {Object} playerToTeam - Player to team mapping
 * @returns {Object} Player stats object
 */
function getPStat(name, currentTeamName = 'Unknown Team', allStats, playerToTeam) {
  const stringName = String(name);
  if (!allStats[stringName]) {
    allStats[stringName] = {
      name: stringName,
      team: playerToTeam[stringName] || currentTeamName,
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
  return allStats[stringName];
}

/**
 * Simulate a single innings
 * @param {Object} batTeam - Batting team
 * @param {Object} bowlTeam - Bowling team
 * @param {number|null} target - Target to chase (null for first innings)
 * @param {number} innIndex - Innings number (1 or 2)
 * @param {Object} venue - Venue object
 * @param {boolean} isKnockout - Is knockout match
 * @param {boolean} isPlayoffs - Is playoffs match
 * @param {Object} allStats - All statistics object
 * @param {Object} playerToTeam - Player to team mapping
 * @param {Object} formTracker - Form tracker object
 * @param {Function} seededRandom - Random function
 * @returns {Object} Innings result
 */
function simInnings(
  batTeam,
  bowlTeam,
  target,
  innIndex,
  venue,
  isKnockout = false,
  isPlayoffs = false,
  allStats = {},
  playerToTeam = {},
  formTracker = {},
  seededRandom = Math.random
) {
  // Validate inputs
  validateTeam(batTeam);
  validateTeam(bowlTeam);
  validateVenue(venue);

  const batStrength = calculateTeamStrength(batTeam, 'bat');
  const bowlStrength = calculateTeamStrength(bowlTeam, 'bowl');

  const batXI = getActiveXI(batTeam, 'bat');
  const bowlXI = getActiveXI(bowlTeam, 'bowl');
  let batOrder = [...batXI];
  const bowlers = prepareBowlersForInnings(bowlXI);

  let score = 0;
  let wkts = 0;
  let balls = 0;
  let striker = 0;
  let nonStriker = 1;
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
  let currentOverBalls = 0; // Track balls in current over
  let lastOverWickets = 0; // Track wickets in last over
  const partnerships = [];
  const ballLog = [];

  // Dew factor
  const dewActive = innIndex === 2 && seededRandom() < MULTIPLIERS.DEW_FACTOR_CHANCE;

  // Pressure bonus for defending massive total
  const defendPressureBoost = target && target > VENUE_CONFIG.HUGE_TARGET ? MULTIPLIERS.DEFEND_PRESSURE_BOOST : 1.0;

  // Bowler confidence tracking
  const bConfidenceMap = {};

  // Captain leadership boost
  const captainName = batTeam.captain?.name || batTeam.captain;
  const captain = batOrder.find(p => p.name === captainName) ||
                  batOrder.find(p => (getCompletePlayerData(p.name, p).role || '').toLowerCase().includes('captain'));
  const leadershipBoost = captain ? MULTIPLIERS.LEADERSHIP_BOOST : 1.0;

  // Initialize bowler confidence
  bowlers.forEach(bowler => {
    bConfidenceMap[bowler.name] = defendPressureBoost * (dewActive ? MULTIPLIERS.DEW_BOWLER_PENALTY : 1.0) * leadershipBoost;
  });

  // Initialize batting cards
  const bCards = batOrder.map(player => ({
    name: player.name,
    runs: 0,
    balls: 0,
    status: 'dnb',
    fours: 0,
    sixes: 0,
    consecutiveDots: 0,
    wicketType: null,
    fielder: null,
    bowler: null,
  }));
  
  if (bCards[0]) bCards[0].status = 'not out';
  if (bCards[1]) bCards[1].status = 'not out';

  // Main innings loop
  for (let over = 0; over < MATCH_CONFIG.OVERS_PER_INNINGS; over++) {
    if (wkts >= MATCH_CONFIG.MAX_WICKETS || wkts >= batOrder.length - 1 || (target && score > target)) {
      break;
    }

    const phase = over < PHASE_CONFIG.POWERPLAY_OVERS ? 'pp' : 
                  over < PHASE_CONFIG.MID_OVERS_END ? 'mid' : 'death';
    const bowler = selectBowlerForOver(bowlers, over, phase, seededRandom);
    if (!bowler) break;

    // Initialize bowler confidence
    if (!bConfidenceMap[bowler.name]) bConfidenceMap[bowler.name] = 1.0;

    // Reset over tracking
    currentOverBalls = 0;
    lastOverWickets = 0;
    recentWickets = 0;

    let legalBallsInOver = 0;
    while (legalBallsInOver < MATCH_CONFIG.BALLS_PER_OVER) {
      if (wkts >= MATCH_CONFIG.MAX_WICKETS || wkts >= batOrder.length - 1 || (target && score > target)) {
        break;
      }

      const bat = batOrder[striker];
      const bStat = bCards[striker];
      if (!bat || !bStat) break;

      // Calculate required run rate
      let reqRR = 0;
      if (target) {
        const remRuns = target - score;
        const remBalls = MATCH_CONFIG.OVERS_PER_INNINGS * 6 - balls;
        reqRR = remBalls > 0 ? remRuns / (remBalls / 6) : 99;
      }

      // Calculate range aggression
      let rangeAggression = 0;
      if (venue.range && balls > 0) {
        const oversBowled = balls / 6;
        const safeOvers = oversBowled < 1 ? 1 : oversBowled;
        const estimatedTotal = (score / safeOvers) * MATCH_CONFIG.OVERS_PER_INNINGS;
        const targetMin = venue.range[0];
        const targetMax = venue.range[1];

        if (balls > 48) {
          if (estimatedTotal < targetMin - 5) rangeAggression = 1;
          if (estimatedTotal > targetMax - 5) rangeAggression = -1;
          if (estimatedTotal > targetMax + 5) rangeAggression = -2;
        } else if (balls > 24) {
          if (estimatedTotal > targetMax + 30) rangeAggression = -1;
        }
      }

      // Calculate ball outcome
      const outcome = calculateBallOutcome(
        bat,
        bowler,
        {
          phase,
          reqRR,
          isChasing: !!target,
          recentCollapse: recentWickets > 0,
          momentum,
          ballsLeft: MATCH_CONFIG.OVERS_PER_INNINGS * 6 - balls,
          ballsBowled: balls,
          currentScore: score,
          wkts,
          dewActive,
          batterBalls: bStat.balls,
          batterRuns: bStat.runs,
          bowlerConfidence: bConfidenceMap[bowler.name],
          isKnockout,
          partnershipRuns,
          partnershipBalls,
          innIndex,
          consecutiveDots: bStat.consecutiveDots,
          teamBatStrength: batStrength,
          teamBowlStrength: bowlStrength,
          bowlTeam,
          isPlayoffs,
          rangeAggression,
          currentOverBalls, // Track balls in current over
          recentWickets, // Track recent wickets
        },
        venue,
        seededRandom,
        formTracker
      );

      score += outcome.runs;
      updateBowlerStats(bowler, outcome.runs);

      if (!outcome.extra) bowler.balls++;

      // Track wickets for realistic protection
      if (outcome.wicket) {
        wkts++;
        recentWickets++;
        lastOverWickets++;
        momentum = 0;
      }

      // Update over ball counter
      if (!outcome.extra) {
        currentOverBalls++;
        balls++;
        legalBallsInOver++;
      } else {
        currentOverBalls++; // Count extras as balls for over tracking
      }

      // Generate commentary
      const commentary = generateStadiumCommentary(outcome, bat, bowler, venue, phase);

      ballLog.push({
        over: `${over}.${legalBallsInOver + 1}`,
        bat: bat.name,
        bowl: bowler.name,
        bat1: { name: bStat.name, runs: bStat.runs, balls: bStat.balls },
        bat2: bCards[nonStriker] ? {
          name: bCards[nonStriker].name,
          runs: bCards[nonStriker].runs,
          balls: bCards[nonStriker].balls,
        } : null,
        venue: venue.name,
        pitch: venue.pitch,
        boundary: venue.boundary,
        dew: dewActive,
        phase,
        commentary: commentary.text,
        stadiumContext: commentary.stadiumContext,
        boundaryContext: commentary.boundaryContext,
        city: commentary.city,
        ...outcome,
      });

      // Track partnership
      if (!outcome.extra) {
        if (!currentPartnership.batter1) {
          currentPartnership.batter1 = bat.name;
          currentPartnership.batter2 = bCards[nonStriker]?.name;
          currentPartnership.startOver = over;
        }
        currentPartnership.runs += outcome.runs;
        currentPartnership.balls++;
      }

      // Update bowling stats
      const bs = getPStat(bowler.name, bowlTeam.name, allStats, playerToTeam);
      bs.runsConceded += outcome.runs;
      if (!outcome.extra) bs.ballsBowled++;

      // Handle wickets
      if (outcome.wicket) {
        // Save partnership
        if (currentPartnership.batter1 && currentPartnership.runs > 0) {
          partnerships.push({
            ...currentPartnership,
            endOver: over,
            endReason: outcome.wicketType || 'out',
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

        bStat.status = 'out';
        bStat.balls++;
        bStat.wicketType = outcome?.wicketType || 'defaultWicketType';
        bStat.fielder = outcome?.fielder || 'defaultFielder';
        bStat.bowler = bowler?.name || 'defaultBowler';
        
        updateForm(bat.name, bStat.runs, bStat.balls, formTracker);

        // Update bowler confidence
        bConfidenceMap[bowler.name] = Math.min(
          FORM_CONFIG.CONFIDENCE_MAX,
          bConfidenceMap[bowler.name] + FORM_CONFIG.CONFIDENCE_WICKET_BOOST
        );

        if (outcome.wicketType !== 'run out') {
          bs.wkts++;
          bs.pts += 25;
          bowler.wkts++;
        }

        // Next batter
        if (nextBat < batOrder.length) {
          striker = nextBat++;
          bCards[striker].status = 'not out';
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
        // Handle runs and extras
        if (!outcome.extra) {
          bStat.runs += outcome.runs;
          bStat.balls++;
          partnershipRuns += outcome.runs;
          partnershipBalls++;

          if (outcome.runs >= 4) {
            momentum++;
            // Drop bowler confidence on boundaries
            const drop = outcome.runs === 6 ? FORM_CONFIG.CONFIDENCE_BOUNDARY_DROP_SIX : FORM_CONFIG.CONFIDENCE_BOUNDARY_DROP_FOUR;
            bConfidenceMap[bowler.name] = Math.max(
              FORM_CONFIG.CONFIDENCE_MIN,
              bConfidenceMap[bowler.name] - drop
            );
          } else {
            momentum = Math.max(0, momentum - 1);
            // Gain confidence on dot balls
            if (outcome.runs === 0) {
              bStat.consecutiveDots++;
              bConfidenceMap[bowler.name] = Math.min(
                FORM_CONFIG.CONFIDENCE_MAX,
                bConfidenceMap[bowler.name] + FORM_CONFIG.CONFIDENCE_DOT_GAIN
              );
            } else {
              bStat.consecutiveDots = 0;
            }
          }

          // Update batting stats
          const ps = getPStat(bat.name, batTeam.name, allStats, playerToTeam);
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

          // Rotate strike on odd runs
          if (outcome.runs % 2 !== 0) {
            [striker, nonStriker] = [nonStriker, striker];
          }
        }
      }
    }

    endBowlerOver(bowler);
    [striker, nonStriker] = [nonStriker, striker];
    if (recentWickets > 0) recentWickets--;
  }

  // Add final partnership
  if (currentPartnership.batter1 && currentPartnership.runs > 0) {
    partnerships.push({
      ...currentPartnership,
      endOver: MATCH_CONFIG.OVERS_PER_INNINGS,
      endReason: 'not out',
    });
  }

  // Update form for not-out batsmen
  bCards.forEach(card => {
    if (card.status === 'not out') {
      updateForm(card.name, card.runs, card.balls, formTracker);
    }
  });

  // Update bowling form
  bowlers.forEach(bowler => {
    updateBowlingForm(bowler.name, { runs: bowler.runs, wkts: bowler.wkts }, formTracker);
  });

  return {
    team: batTeam.name,
    score,
    wkts,
    balls,
    batting: bCards,
    bowling: bowlers,
    ballLog,
    partnerships,
  };
}

/**
 * Simulate super over
 * @param {Object} t1 - Team 1
 * @param {Object} t2 - Team 2
 * @param {Object} venue - Venue object
 * @param {Object} allStats - All statistics
 * @param {Object} playerToTeam - Player to team mapping
 * @param {Object} formTracker - Form tracker
 * @param {Function} seededRandom - Random function
 * @returns {Object} Super over result
 */
function simulateSuperOver(t1, t2, venue, allStats, playerToTeam, formTracker, seededRandom) {
  const simSingleOver = (bat, bowl) => {
    let score = 0;
    let wkts = 0;
    let balls = 0;
    const bOrder = bat.squad.slice(0, 3); // Top 3
    const bowler = bowl.squad.find(p => 
      (p.roleKey || p.role || '').toLowerCase().includes('bowl')
    ) || bowl.squad[0];

    for (let i = 0; i < MATCH_CONFIG.SUPER_OVER_BALLS; i++) {
      const outcome = calculateBallOutcome(
        bOrder[wkts],
        bowler,
        {
          phase: 'death',
          ballsLeft: MATCH_CONFIG.SUPER_OVER_BALLS - i,
          momentum: 0,
          isChasing: false,
          reqRR: 12,
          partnershipRuns: score,
          innIndex: 2,
          consecutiveDots: 0,
          teamBatStrength: calculateTeamStrength(bat, 'bat'),
          teamBowlStrength: calculateTeamStrength(bowl, 'bowl'),
          bowlTeam: bowl,
          isPlayoffs: true,
          rangeAggression: 0,
        },
        venue,
        seededRandom,
        formTracker
      );
      
      score += outcome.runs;
      if (outcome.wicket) wkts++;
      if (wkts >= MATCH_CONFIG.SUPER_OVER_MAX_WICKETS) break;
    }
    return { score, wkts };
  };

  const i1 = simSingleOver(t1, t2);
  const i2 = simSingleOver(t2, t1);

  if (i1.score > i2.score) return { winner: t1.name, margin: 'Super Over' };
  if (i2.score > i1.score) return { winner: t2.name, margin: 'Super Over' };
  
  return {
    winner: seededRandom() > 0.5 ? t1.name : t2.name,
    margin: 'Super Over (Cointoss)',
  };
}

/**
 * Simulate a complete match
 * @param {Object} t1 - Team 1
 * @param {Object} t2 - Team 2
 * @param {string} type - Match type
 * @param {Object} allStats - All statistics
 * @param {Object} playerToTeam - Player to team mapping
 * @param {Object} formTracker - Form tracker
 * @param {Function} seededRandom - Random function
 * @returns {Object} Match result
 */
function simulateMatch(t1, t2, type = 'League', allStats = {}, playerToTeam = {}, formTracker = {}, seededRandom = Math.random) {
  const isKnockout = type !== 'League' && type !== 'LEAGUE';
  const isPlayoffs = type !== 'League' && type !== 'LEAGUE';
  
  let firstBat, secondBat;
  const tossWinner = seededRandom() > 0.5 ? t1 : t2;
  const tossLoser = tossWinner === t1 ? t2 : t1;
  let electedTo = 'bat';
  let tossReason = 'looking at pitch';

  const venue = getVenueForTeam(t1.name, seededRandom);

  // Tactical toss decision
  if (venue.chaseProb > VENUE_CONFIG.CHASE_PROBABILITY_THRESHOLD) {
    electedTo = 'bowl';
    tossReason = 'due to potential dew factor and easier chasing conditions';
  } else if (venue.spin > VENUE_CONFIG.SPN_FRIENDLY_THRESHOLD) {
    electedTo = 'bat';
    tossReason = 'as the track is expected to slow down and assist spinners later';
  } else if (seededRandom() < venue.chaseProb) {
    electedTo = 'bowl';
    tossReason = 'standard match strategy for this venue';
  }

  if (electedTo === 'bowl') {
    firstBat = tossLoser;
    secondBat = tossWinner;
  } else {
    firstBat = tossWinner;
    secondBat = tossLoser;
  }

  const i1 = simInnings(firstBat, secondBat, null, 1, venue, isKnockout, isPlayoffs, allStats, playerToTeam, formTracker, seededRandom);
  const i2 = simInnings(secondBat, firstBat, i1.score, 2, venue, isKnockout, isPlayoffs, allStats, playerToTeam, formTracker, seededRandom);

  const s1 = parseInt(i1.score.toString());
  const s2 = parseInt(i2.score.toString());

  let winner, margin;

  if (s1 === s2) {
    // Tie - simulate super over
    const superOver = simulateSuperOver(firstBat, secondBat, venue, allStats, playerToTeam, formTracker, seededRandom);
    winner = superOver.winner;
    margin = superOver.margin;
  } else {
    winner = s1 > s2 ? firstBat.name : secondBat.name;
    margin = s1 > s2 ? `${s1 - s2} runs` : `${MATCH_CONFIG.MAX_WICKETS - i2.wkts} wickets`;
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

module.exports = {
  getActiveXI,
  calculateTeamStrength,
  simInnings,
  simulateMatch,
  simulateSuperOver,
  getPStat,
  updateForm,
  updateBowlingForm
};
