// Batting Logic Module
// ===========================================

const { 
  PHASE_CONFIG, 
  FATIGUE_CONFIG, 
  VENUE_CONFIG, 
  MULTIPLIERS, 
  WEIGHT_ADJUSTMENTS, 
  MIN_WICKET_RATES,
  FORM_CONFIG,
  TEAM_STRENGTH
} = require('./constants');
const { getCompletePlayerData } = require('./playerCache');
const { validateMatchState, validateVenue } = require('./validation');

// Player traits configuration
const TRAITS = {
  clutch: 1.15,
  finisher: 1.12,
  anchor: 1.05,
  aggressor: 1.1,
  nervous: 0.92,
  choker: 0.85,
  normal: 1.0,
};

// Base outcome weights for different batting modes
const OUTCOME_WEIGHTS = {
  anchor: { 0: 32, 1: 40, 2: 15, 3: 2, 4: 6, 6: 2, W: 5.0, WD: 1, NB: 0 },
  normal: { 0: 26, 1: 34, 2: 18, 3: 3, 4: 10, 6: 6, W: 6.0, WD: 2, NB: 1 },
  controlled: { 0: 24, 1: 36, 2: 20, 3: 4, 4: 8, 6: 4, W: 5.5, WD: 2, NB: 1 },
  aggressive: { 0: 18, 1: 22, 2: 12, 3: 4, 4: 15, 6: 15, W: 10.0, WD: 2, NB: 2 },
  desperate: { 0: 12, 1: 14, 2: 8, 3: 4, 4: 18, 6: 20, W: 12.0, WD: 3, NB: 4 },
  powerplay: { 0: 22, 1: 30, 2: 18, 3: 3, 4: 15, 6: 10, W: 6.0, WD: 2, NB: 1 },
  death: { 0: 14, 1: 18, 2: 10, 3: 4, 4: 18, 6: 18, W: 11.0, WD: 2, NB: 2 },
};

/**
 * Get batting role for a player
 * @param {Object} player - Player object
 * @returns {string} Batting role
 */
function getBattingRole(player) {
  const dbEntry = getCompletePlayerData(player.name, player);
  const combined = [
    player.roleKey || player.role || '',
    dbEntry.role || '',
    dbEntry.type || ''
  ].join(' ').toLowerCase();

  // Priority-based role detection
  if (combined.includes('finisher')) return 'finisher';
  if (combined.includes('power hitter') || combined.includes('360') || combined.includes('aggressor')) return 'powerHitter';
  if (combined.includes('anchor') || combined.includes('captain')) return 'anchor';
  if (combined.includes('opener') || combined.includes('wk') || combined.includes('wicket keeper')) return 'accumulator';
  
  // Fallback to skill-based role
  if (dbEntry.bat > 90) return 'powerHitter';
  if (dbEntry.bat > 82) return 'accumulator';
  
  return 'normal';
}

/**
 * Determine wicket type based on bowler and match conditions
 * @param {Object} batter - Batter object
 * @param {Object} bowler - Bowler object
 * @param {string} phase - Match phase
 * @param {Object} bowlTeam - Bowling team
 * @param {Function} seededRandom - Random function
 * @returns {Object} Wicket type info
 */
function getWicketType(batter, bowler, phase, bowlTeam, seededRandom) {
  const r = seededRandom();

  // Helper to get random fielder
  const getRandomFielder = () => {
    if (!bowlTeam?.squad?.length) return null;
    const fielders = bowlTeam.squad.filter(p => p.name !== bowler.name);
    return fielders.length > 0 ? fielders[Math.floor(seededRandom() * fielders.length)].name : null;
  };

  // Run outs (situational)
  if (phase === 'death' && r < 0.1) return { type: 'run out', fielder: getRandomFielder() };
  if (phase !== 'death' && r < 0.03) return { type: 'run out', fielder: getRandomFielder() };

  // Normal wickets
  const wR = seededRandom();
  const bowlerType = getBowlerType(bowler);
  let wicketType = 'caught';
  let fielder = null;

  if (bowlerType.includes('spin')) {
    if (wR < 0.5) {
      wicketType = 'caught';
      fielder = getRandomFielder();
    } else if (wR < 0.75) {
      wicketType = 'lbw';
    } else if (wR < 0.9) {
      wicketType = 'bowled';
    } else {
      wicketType = 'stumped';
      fielder = getRandomFielder();
    }
  } else {
    // Pacers
    if (wR < 0.6) {
      wicketType = 'caught';
      fielder = getRandomFielder();
    } else if (wR < 0.85) {
      wicketType = 'bowled';
    } else {
      wicketType = 'lbw';
    }
  }

  return { type: wicketType, fielder };
}

/**
 * Get bowler type (simplified version)
 * @param {Object} bowler - Bowler object
 * @returns {string} Bowler type
 */
function getBowlerType(bowler) {
  const dbEntry = getCompletePlayerData(bowler.name, bowler);
  const combined = [
    bowler.roleKey || bowler.role || '',
    dbEntry.role || '',
    dbEntry.type || ''
  ].join(' ').toLowerCase();

  if (combined.includes('off-spin') || combined.includes('mystery')) return 'off-spinner';
  if (combined.includes('leg-spin') || combined.includes('china') || combined.includes('wrist')) return 'leg-spinner';
  if (combined.includes('spin') || combined.includes('orth')) return 'spinner';
  if (combined.includes('fast') || combined.includes('pace') || combined.includes('seam') || combined.includes('swing')) return 'pacer';
  
  return 'pacer';
}

/**
 * Calculate batting mode based on match situation
 * @param {Object} matchState - Match state
 * @param {string} role - Batter role
 * @returns {string} Batting mode
 */
function calculateBattingMode(matchState, role) {
  const { phase, recentCollapse, momentum, isChasing, reqRR, dewActive, rangeAggression } = matchState;
  let mode = 'normal';

  // Situation-based mode selection
  if (recentCollapse) mode = 'anchor';
  else if (phase === 'pp') mode = 'powerplay';
  else if (phase === 'death') mode = 'death';
  else if (momentum > 2) mode = 'aggressive';

  // Role-based adjustments
  if (role === 'finisher' && (phase === 'death' || (phase === 'mid' && matchState.ballsLeft < 30))) {
    mode = 'death';
  }
  if (role === 'powerHitter' && phase === 'pp') mode = 'aggressive';
  if (role === 'accumulator') mode = mode === 'desperate' ? 'aggressive' : 'controlled';
  if (role === 'anchor' && recentCollapse) mode = 'anchor';

  // Chase pressure
  if (isChasing) {
    if (reqRR > VENUE_CONFIG.HIGH_CHASE_RATE || (reqRR > VENUE_CONFIG.MODERATE_CHASE_RATE && matchState.ballsLeft < 18)) mode = 'desperate';
    else if (reqRR > VENUE_CONFIG.AGGRESSIVE_CHASE_RATE) mode = 'death';
    else if (reqRR > VENUE_CONFIG.CONTROLLED_CHASE_RATE) mode = 'aggressive';
    else if (reqRR < VENUE_CONFIG.CONSERVATIVE_CHASE_RATE) mode = 'controlled';
    else if (reqRR < VENUE_CONFIG.VERY_CONSERVATIVE_CHASE_RATE) mode = 'anchor';
    
    if (dewActive && mode === 'normal' && reqRR > 7) mode = 'aggressive';
  } else if (rangeAggression === 1 && mode !== 'desperate') {
    mode = 'aggressive';
  } else if (rangeAggression === -1) {
    mode = 'controlled';
  } else if (rangeAggression === -2) {
    mode = 'anchor';
  }

  return mode;
}

/**
 * Apply venue-specific adjustments to weights
 * @param {Object} weights - Current weights
 * @param {Object} venue - Venue object
 * @param {string} phase - Match phase
 */
function applyVenueAdjustments(weights, venue, phase) {
  // Boundary size effects
  if (venue.boundary === 'tiny') {
    weights[6] += WEIGHT_ADJUSTMENTS.TINY_BOUNDARY_SIX_BONUS;
    weights[4] += WEIGHT_ADJUSTMENTS.TINY_BOUNDARY_FOUR_BONUS;
  } else if (venue.boundary === 'large') {
    weights[1] += WEIGHT_ADJUSTMENTS.LARGE_BOUNDARY_SINGLE_BONUS;
    weights[2] += WEIGHT_ADJUSTMENTS.LARGE_BOUNDARY_DOUBLE_BONUS;
    weights[3] += WEIGHT_ADJUSTMENTS.LARGE_BOUNDARY_TRIPLE_BONUS;
    weights[6] -= 2;
    weights[0] = Math.max(0, weights[0] - 2);
  }

  // Phase-specific venue effects
  if (phase === 'pp') {
    weights[6] += WEIGHT_ADJUSTMENTS.POWERPLAY_SIX_BONUS;
    weights[4] += WEIGHT_ADJUSTMENTS.POWERPLAY_FOUR_BONUS;
  } else if (phase === 'death') {
    weights[6] += WEIGHT_ADJUSTMENTS.DEATH_SIX_BONUS;
    weights[4] += WEIGHT_ADJUSTMENTS.DEATH_FOUR_BONUS;
  }
}

/**
 * Apply pitch effects to weights
 * @param {Object} weights - Current weights
 * @param {Object} venue - Venue object
 * @param {number} innIndex - Innings number
 * @param {number} ballsBowled - Balls bowled
 */
function applyPitchEffects(weights, venue, innIndex, ballsBowled) {
  const pitchEffects = {
    flat: { 4: 5, 6: 6, W: 0 },
    green: { W: 6.0, 0: 4, 4: -3 },
    dusty: { W: 5.5, 0: 6, 1: -2, 6: -2 },
    slow: { 6: -2.5, 2: 4, 1: 3, W: 4.5 },
  };

  if (pitchEffects[venue.pitch]) {
    const eff = pitchEffects[venue.pitch];
    for (const k in eff) {
      if (weights[k] !== undefined) weights[k] += eff[k];
    }
  }

  // Pitch deterioration
  const oversDone = ballsBowled / 6;
  if (innIndex === 2 || oversDone > 12) {
    if (venue.pitch === 'dusty' || venue.pitch === 'slow') {
      weights['W'] += 1;
      weights[0] += 2;
      weights[6] -= 1;
    }
  }
}

/**
 * Calculate skill difference and apply adjustments
 * @param {Object} weights - Current weights
 * @param {number} batSkill - Batter skill
 * @param {number} bowlSkill - Bowler skill
 */
function applySkillDifference(weights, batSkill, bowlSkill) {
  const diff = batSkill - bowlSkill;

  if (diff > 12) {
    weights[4] += 2;
    weights[6] += 1;
    weights['W'] = Math.max(1.0, weights['W'] - 1.5);
  } else if (diff < -12) {
    weights[0] += 3;
    weights['W'] += 3;
    weights[6] = Math.max(0, weights[6] - 2);
  }
}

/**
 * Apply partnership momentum effects
 * @param {Object} weights - Current weights
 * @param {number} partnershipRuns - Partnership runs
 * @param {number} partnershipBalls - Partnership balls
 */
function applyPartnershipMomentum(weights, partnershipRuns, partnershipBalls) {
  let partnershipMomentum = 0;
  if (partnershipRuns > 20) partnershipMomentum = 1;
  if (partnershipRuns > 50) partnershipMomentum = 2;
  if (partnershipRuns > 80) partnershipMomentum = 3;
  if (partnershipRuns > 120) partnershipMomentum = 4;

  const partnershipTime = partnershipBalls / 6;
  if (partnershipTime > 5) {
    weights['W'] -= partnershipMomentum * 0.5;
  }
}

/**
 * Apply bowler fatigue effects
 * @param {Object} weights - Current weights
 * @param {Object} bowler - Bowler object
 * @param {string} phase - Match phase
 */
function applyBowlerFatigue(weights, bowler, phase) {
  let bowlerFatigue = 0;
  if (bowler.oversUsed >= FATIGUE_CONFIG.BOWLER_FATIGUE_OVERS[0]) bowlerFatigue = 1;
  if (bowler.oversUsed >= FATIGUE_CONFIG.BOWLER_FATIGUE_OVERS[1]) bowlerFatigue = 2;
  if (phase === 'death' && bowler.oversUsed >= FATIGUE_CONFIG.DEATH_FATIGUE_OVERS) bowlerFatigue += 1;

  if (bowlerFatigue > 0) {
    weights[4] += bowlerFatigue;
    weights[6] += bowlerFatigue * 0.5;
  }
}

/**
 * Apply milestone pressure effects
 * @param {Object} weights - Current weights
 * @param {number} batterRuns - Batter's current runs
 */
function applyMilestonePressure(weights, batterRuns) {
  if (batterRuns >= PHASE_CONFIG.NERVOUS_NINETIES_RANGE[0] && batterRuns < PHASE_CONFIG.NERVOUS_NINETIES_RANGE[1]) {
    weights['W'] += 2.5;
    weights[0] += 3;
    weights[1] -= 1;
  } else if (batterRuns >= PHASE_CONFIG.NERVOUS_EIGHTIES_RANGE[0] && batterRuns < PHASE_CONFIG.NERVOUS_EIGHTIES_RANGE[1]) {
    weights['W'] += 1.5;
    weights[0] += 2;
  } else if (PHASE_CONFIG.MILESTONE_RUNS.includes(batterRuns)) {
    weights['W'] += 0.5;
    weights[0] += 1;
  }
}

/**
 * Apply consecutive dots pressure
 * @param {Object} weights - Current weights
 * @param {number} consecutiveDots - Consecutive dot balls
 */
function applyConsecutiveDotsPressure(weights, consecutiveDots) {
  if (consecutiveDots >= FATIGUE_CONFIG.CONSECUTIVE_DOTS_PRESSURE) {
    weights[6] += WEIGHT_ADJUSTMENTS.CONSECUTIVE_DOTS_SIX_BONUS;
    weights[4] += WEIGHT_ADJUSTMENTS.CONSECUTIVE_DOTS_FOUR_BONUS;
    weights['W'] += Math.min(FATIGUE_CONFIG.MAX_PRESSURE_PENALTY, consecutiveDots * WEIGHT_ADJUSTMENTS.CONSECUTIVE_DOTS_WICKET_BONUS);
    weights[0] -= 2;
  }
}

/**
 * Calculate final ball outcome
 * @param {Object} batter - Batter object
 * @param {Object} bowler - Bowler object
 * @param {Object} matchState - Match state
 * @param {Object} venue - Venue object
 * @param {Function} seededRandom - Random function
 * @param {Object} formTracker - Form tracker object
 * @returns {Object} Ball outcome
 */
function calculateBallOutcome(batter, bowler, matchState, venue, seededRandom, formTracker = {}) {
  // Validate inputs
  validateMatchState(matchState);
  validateVenue(venue);

  const role = getBattingRole(batter);
  const mode = calculateBattingMode(matchState, role);
  
  // Get base weights
  let weights = { ...OUTCOME_WEIGHTS[mode] };

  // Apply venue and pitch effects
  applyVenueAdjustments(weights, venue, matchState.phase);
  applyPitchEffects(weights, venue, matchState.innIndex || 1, matchState.ballsBowled || 0);

  // Get player data with caching
  const batterData = getCompletePlayerData(batter.name, batter);
  const bowlerData = getCompletePlayerData(bowler.name, bowler);

  // Calculate skills with form and luck
  const batterForm = formTracker[batter.name] || 1.0;
  const bowlerForm = formTracker[bowler.name] || 1.0;
  
  let batSkill = batterData.bat * batterForm;
  let bowlSkill = bowlerData.bowl * bowlerForm * (matchState.bowlerConfidence || 1.0);

  // Apply luck factors
  const luckRoll = seededRandom();
  const batterLuck = (batterData.luck || 75) / 75;
  const bowlerLuck = (bowlerData.luck || 75) / 75;
  
  batSkill *= (MULTIPLIERS.LUCK_MIN_MULTIPLIER + luckRoll * MULTIPLIERS.LUCK_VARIANCE * batterLuck);
  bowlSkill *= (MULTIPLIERS.LUCK_MIN_MULTIPLIER + (1 - luckRoll) * MULTIPLIERS.LUCK_VARIANCE * bowlerLuck);

  // Apply team strength differences
  const teamDiff = (matchState.teamBatStrength || 75) - (matchState.teamBowlStrength || 75);
  applyTeamStrengthEffects(batSkill, bowlSkill, teamDiff, matchState.isPlayoffs);

  // Apply individual bonuses
  applyIndividualBonuses(batSkill, bowlSkill, batterData, bowlerData, matchState);

  // Apply partnership and fatigue effects
  applyPartnershipMomentum(weights, matchState.partnershipRuns || 0, matchState.partnershipBalls || 0);
  applyBowlerFatigue(weights, bowler, matchState.phase);
  applyMilestonePressure(weights, matchState.batterRuns || 0);
  applyConsecutiveDotsPressure(weights, matchState.consecutiveDots || 0);

  // Apply anchor collapse stabilization
  batSkill = applyAnchorCollapseStabilization(weights, matchState, batterData, batSkill, matchState.innIndex || 1);

  // Apply skill difference
  applySkillDifference(weights, batSkill, bowlSkill);

  // Apply venue range enforcement
  applyVenueRangeEnforcement(weights, matchState.rangeAggression, mode);

  // Apply chase pressure
  if (matchState.isChasing && matchState.reqRR > VENUE_CONFIG.CONTROLLED_CHASE_RATE) {
    const chasePressureModifier = Math.min(FATIGUE_CONFIG.MAX_PRESSURE_PENALTY, (matchState.reqRR - VENUE_CONFIG.CONTROLLED_CHASE_RATE) * 1.0);
    weights['W'] += chasePressureModifier;
  }

  // Apply minimum wicket protection
  applyMinimumWicketProtection(weights, venue, matchState.phase, matchState.isPlayoffs, teamDiff);

  // Apply realistic wicket protection to prevent unrealistic all-outs
  applyRealisticWicketProtection(weights, matchState, teamDiff, matchState.isPlayoffs);

  // Apply playoff balance for closer matches
  applyPlayoffBalance(weights, matchState, teamDiff, matchState.isPlayoffs);

  // Select outcome
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = seededRandom() * total;
  let result = '0';
  
  for (const [k, v] of Object.entries(weights)) {
    r -= v;
    if (r <= 0) {
      result = k;
      break;
    }
  }

  // Build outcome object
  const outcome = {
    runs: 0,
    wicket: false,
    extra: null,
    wicketType: null,
    fielder: null,
  };

  if (result === 'W') {
    outcome.wicket = true;
    const wicketInfo = getWicketType(batter, bowler, matchState.phase, matchState.bowlTeam, seededRandom);
    outcome.wicketType = wicketInfo.type;
    outcome.fielder = wicketInfo.fielder;
  } else if (result === 'WD' || result === 'NB') {
    outcome.extra = result;
    outcome.runs = 1;
  } else {
    outcome.runs = parseInt(result);
  }

  return outcome;
}

/**
 * Apply team strength effects
 * @param {number} batSkill - Batter skill
 * @param {number} bowlSkill - Bowler skill
 * @param {number} teamDiff - Team difference
 * @param {boolean} isPlayoffs - Is playoffs
 */
function applyTeamStrengthEffects(batSkill, bowlSkill, teamDiff, isPlayoffs) {
  const luckFactor = Math.random();
  const upsetThreshold = isPlayoffs ? TEAM_STRENGTH.UPSET_CHANCE_PLAYOFFS : TEAM_STRENGTH.UPSET_CHANCE_LEAGUE;
  const isUpset = luckFactor < upsetThreshold;
  
  if (isUpset) {
    const upsetMultiplier = isPlayoffs ? TEAM_STRENGTH.UPSET_MULTIPLIER_PLAYOFFS : TEAM_STRENGTH.UPSET_MULTIPLIER_LEAGUE;
    batSkill *= upsetMultiplier;
    bowlSkill *= 0.85;
  } else {
    const strengthMultiplier = isPlayoffs ? TEAM_STRENGTH.DOMINANT_MULTIPLIER : 1.0;
    
    if (teamDiff > TEAM_STRENGTH.MASSIVE_ADVANTAGE) {
      batSkill *= 1.22 * strengthMultiplier;
      bowlSkill *= 0.85;
    } else if (teamDiff > TEAM_STRENGTH.STRONG_ADVANTAGE) {
      batSkill *= 1.12 * strengthMultiplier;
      bowlSkill *= 0.90;
    } else if (teamDiff > TEAM_STRENGTH.MODERATE_ADVANTAGE) {
      batSkill *= 1.06 * strengthMultiplier;
      bowlSkill *= 0.96;
    } else if (teamDiff < -TEAM_STRENGTH.MASSIVE_ADVANTAGE) {
      batSkill *= 0.85;
      bowlSkill *= 1.22 * strengthMultiplier;
    } else if (teamDiff < -TEAM_STRENGTH.STRONG_ADVANTAGE) {
      batSkill *= 0.90;
      bowlSkill *= 1.12 * strengthMultiplier;
    } else if (teamDiff < -TEAM_STRENGTH.MODERATE_ADVANTAGE) {
      batSkill *= 0.96;
      bowlSkill *= 1.06 * strengthMultiplier;
    }
  }
}

/**
 * Apply individual player bonuses
 * @param {number} batSkill - Batter skill
 * @param {number} bowlSkill - Bowler skill
 * @param {Object} batterData - Batter data
 * @param {Object} bowlerData - Bowler data
 * @param {Object} matchState - Match state
 */
function applyIndividualBonuses(batSkill, bowlSkill, batterData, bowlerData, matchState) {
  // Star player consistency
  if (batterData.bat > 85) {
    batSkill *= (MULTIPLIERS.STAR_PLAYER_MIN_MULTIPLIER + Math.random() * MULTIPLIERS.STAR_PLAYER_VARIANCE);
  }
  if (bowlerData.bowl > 85) {
    bowlSkill *= (MULTIPLIERS.STAR_PLAYER_MIN_MULTIPLIER + Math.random() * MULTIPLIERS.STAR_PLAYER_VARIANCE);
  }

  // Sight/settled bonuses
  if (matchState.batterBalls > PHASE_CONFIG.SET_BATTER_BALLS) batSkill *= MULTIPLIERS.SIGHT_BONUS_10_BALLS;
  if (matchState.batterBalls > PHASE_CONFIG.SETTLED_BATTER_BALLS) batSkill *= MULTIPLIERS.SIGHT_BONUS_25_BALLS;

  // Partnership bonuses
  if (matchState.partnershipRuns > 40) batSkill *= MULTIPLIERS.PARTNERSHIP_BONUS_40_RUNS;
  if (matchState.partnershipRuns > 75) batSkill *= MULTIPLIERS.PARTNERSHIP_BONUS_75_RUNS;

  // Traits
  if (TRAITS[batterData.trait]) batSkill *= TRAITS[batterData.trait];
  if (TRAITS[bowlerData.trait]) bowlSkill *= TRAITS[bowlerData.trait];

  // Clutch/choker in pressure situations
  if (matchState.isKnockout || (matchState.isChasing && matchState.ballsLeft < 30 && matchState.reqRR > 9)) {
    if (batterData.trait === 'clutch') batSkill *= 1.15;
    if (batterData.trait === 'choker') batSkill *= 0.8;
    if (bowlerData.trait === 'clutch') bowlSkill *= 1.15;
    if (bowlerData.trait === 'choker') bowlSkill *= 0.8;
  }
}

/**
 * Apply venue range enforcement
 * @param {Object} weights - Current weights
 * @param {number} rangeAggression - Range aggression factor
 * @param {string} mode - Current batting mode
 */
function applyVenueRangeEnforcement(weights, rangeAggression, mode) {
  if (rangeAggression === -1) {
    weights[6] *= 0.5;
    weights[4] *= 0.7;
    weights['W'] += 1;
  } else if (rangeAggression === -2) {
    weights[6] = 0;
    weights[4] = Math.max(0, weights[4] * 0.1);
    weights[0] += 12;
    weights[1] += 5;
  } else if (rangeAggression === 1 && mode !== 'anchor') {
    weights[6] += 3;
    weights[4] += 4;
  }
}

/**
 * Apply anchor collapse stabilization effects
 * @param {Object} weights - Current weights
 * @param {Object} matchState - Match state
 * @param {Object} batterData - Batter data
 * @param {number} batSkill - Current batting skill
 * @param {number} innIndex - Innings number
 * @returns {number} Updated batting skill
 */
function applyAnchorCollapseStabilization(weights, matchState, batterData, batSkill, innIndex) {
  const { recentCollapse, wkts, ballsBowled, isChasing, reqRR, batterBalls } = matchState;
  
  // Check if anchor is at crease during collapse
  const isAnchorAtCrease = batterData.role?.includes('anchor') || 
                           batterData.role?.includes('captain') ||
                           (batterData.role || '').toLowerCase().includes('anchor') ||
                           (batterData.role || '').toLowerCase().includes('captain');

  // Count actual recent wickets from match state
  const recentWicketCount = recentCollapse ? 3 : 0;
  
  // Early game collapse protection
  const isEarlyCollapse = ballsBowled < 24 && recentCollapse;

  if (recentCollapse && isAnchorAtCrease) {
    // Anchor gets immediate stabilization boost during collapse
    const anchorResilience = Math.min(3, recentWicketCount + 1);

    if (batterBalls > 0) {
      // Anchor gets harder to dismiss as collapse gets worse (mental toughness)
      weights["W"] = Math.max(2.0, weights["W"] - anchorResilience * 0.8);

      // Anchor starts taking more singles to rotate strike and rebuild
      weights[1] += anchorResilience * 3;
      weights[2] += anchorResilience * 1.5;

      // Reduce risky shots but can still hit sixes
      weights[6] = Math.max(1, weights[6] - anchorResilience * 0.8);
      
      // Skill boost for anchors during collapse - they step up
      const skillBoost = 1 + anchorResilience * 0.03; // 12% max boost
      return batSkill * skillBoost;
    }

    // Once settled (10+ balls), anchor can stabilize innings significantly
    if (batterBalls > 10) {
      weights["W"] = Math.max(1.0, weights["W"] - 1.5);
      weights[1] += 3; // Take singles, rotate strike
      const settledBoost = 1.05; // 5% boost
      return batSkill * settledBoost;
    }

    // Settled anchor (20+ balls) becomes fortress
    if (batterBalls > 20) {
      weights["W"] = Math.max(0.8, weights["W"] - 1.0);
      weights[4] += 1; // Can find boundaries but limited
      const fortressBoost = 1.08; // 8% boost
      return batSkill * fortressBoost;
    }

    // In chase, anchor gets clutch bonus (single-handed win potential)
    if (isChasing && reqRR > 10 && batterBalls > 20) {
      weights[6] += 2; // Can hit sixes when needed
      weights["W"] = Math.max(0.8, weights["W"] - 1.0);
      const clutchBoost = 1.10; // 10% clutch bonus
      return batSkill * clutchBoost;
    }
  }
  
  // Early collapse protection for non-anchors
  if (isEarlyCollapse && !isAnchorAtCrease) {
    // Non-anchors also get some protection to prevent 5 wickets in 4 overs
    weights["W"] = Math.max(1.2, weights["W"] * 0.8);
  }
  
  return batSkill;
}

/**
 * Apply realistic wicket protection to prevent unrealistic all-outs
 * @param {Object} weights - Current weights
 * @param {Object} matchState - Match state
 * @param {number} teamDiff - Team difference
 * @param {boolean} isPlayoffs - Is playoffs
 */
function applyRealisticWicketProtection(weights, matchState, teamDiff, isPlayoffs) {
  const { wkts, ballsBowled, currentOverBalls, recentWickets } = matchState;
  
  // Prevent unrealistic all-outs in early overs
  const oversDone = ballsBowled / 6;
  
  // Early innings protection (first 6 overs)
  if (oversDone < 6 && wkts >= 3) {
    weights['W'] *= 0.3; // 70% reduction in wicket chance
    weights[0] += 8; // More dot balls
    weights[1] += 4; // More singles
  }
  
  // Mid innings protection (overs 6-15)
  if (oversDone >= 6 && oversDone < 15 && wkts >= 7) {
    weights['W'] *= 0.5; // 50% reduction
    weights[0] += 5;
    weights[1] += 3;
  }
  
  // Death overs protection (last 5 overs)
  if (oversDone >= 15 && wkts >= 9) {
    weights['W'] *= 0.4; // 60% reduction
    weights[1] += 5; // Focus on singles
    weights[2] += 2; // Some doubles
  }
  
  // Weak team protection
  if (teamDiff < -15) { // Weak batting team vs strong bowling
    weights['W'] *= MIN_WICKET_RATES.WEAK_TEAM_PROTECTION; // 30% reduction
    weights[1] += 3; // More singles to survive
    weights[2] += 2; // More doubles
  }
  
  // Strong bowling penalty (prevent too many wickets)
  if (teamDiff > 15) { // Strong bowling vs weak batting
    weights['W'] *= MIN_WICKET_RATES.STRONG_BOWLING_PENALTY; // 20% reduction
  }
  
  // Consecutive wickets protection
  if (recentWickets >= 2) {
    weights['W'] *= 0.4; // 60% reduction after 2 quick wickets
    weights[0] += 6; // More dot balls to settle
    weights[1] += 4; // More singles
  }
  
  // Minimum balls between wickets
  if (currentOverBalls && currentOverBalls < MIN_WICKET_RATES.MIN_BALLS_PER_WICKET && wkts > 0) {
    weights['W'] *= 0.2; // 80% reduction in first 6 balls after wicket
  }
}

/**
 * Apply minimum wicket protection
 * @param {Object} weights - Current weights
 * @param {Object} venue - Venue object
 * @param {string} phase - Match phase
 * @param {boolean} isPlayoffs - Is playoffs
 * @param {number} teamDiff - Team difference
 */
function applyMinimumWicketProtection(weights, venue, phase, isPlayoffs, teamDiff) {
  let minWkt = isPlayoffs ? MIN_WICKET_RATES.BASE_PLAYOFFS : MIN_WICKET_RATES.BASE_LEAGUE;
  
  if (venue.pitch === 'dusty' || venue.pitch === 'slow') {
    minWkt = isPlayoffs ? MIN_WICKET_RATES.DUSTY_PITCH_PLAYOFFS : MIN_WICKET_RATES.DUSTY_PITCH_LEAGUE;
  } else if (venue.pitch === 'green') {
    minWkt = isPlayoffs ? MIN_WICKET_RATES.GREEN_PITCH_PLAYOFFS : MIN_WICKET_RATES.GREEN_PITCH_LEAGUE;
  }
  
  if (phase === 'pp') {
    minWkt = isPlayoffs ? MIN_WICKET_RATES.POWERPLAY_PLAYOFFS : MIN_WICKET_RATES.POWERPLAY_LEAGUE;
  }

  if (teamDiff < -15) {
    minWkt += MIN_WICKET_RATES.WEAK_TEAM_COLLAPSE_BONUS;
    weights['W'] += 2.0; // Reduced from 4.0
  }
  
  // Apply realistic minimum wicket rates
  weights['W'] = Math.max(minWkt * 0.7, weights['W']); // Additional 30% reduction
}

/**
 * Apply playoff balance effects for closer matches
 * @param {Object} weights - Current weights
 * @param {Object} matchState - Match state
 * @param {number} teamDiff - Team difference
 * @param {boolean} isPlayoffs - Is playoffs
 */
function applyPlayoffBalance(weights, matchState, teamDiff, isPlayoffs) {
  if (!isPlayoffs) return;

  // Playoff-specific balancing for closer matches
  const { isChasing, reqRR, currentScore, wkts } = matchState;

  // Reduce dominant team advantage in playoffs
  if (Math.abs(teamDiff) > TEAM_STRENGTH.STRONG_ADVANTAGE) {
    // Cap the maximum advantage in playoffs
    const maxAdvantage = TEAM_STRENGTH.STRONG_ADVANTAGE;
    const adjustedDiff = Math.sign(teamDiff) * Math.min(Math.abs(teamDiff), maxAdvantage);
    
    // Apply balancing
    if (teamDiff > 0) {
      // Stronger batting team - reduce their advantage slightly
      weights[6] *= 0.9; // Fewer sixes
      weights[4] *= 0.95; // Fewer boundaries
    } else {
      // Weaker batting team - give them slight boost
      weights[1] += 2; // More singles
      weights[2] += 1; // More doubles
    }
  }

  // Chase balancing in playoffs - make targets more achievable
  if (isChasing && reqRR > 8 && reqRR < 12) {
    // Moderate chase rates - make them more competitive
    weights[4] += 1; // Slightly more boundaries
    weights[6] += 0.5; // Slightly more sixes
    weights["W"] *= 0.9; // Fewer wickets
  }

  // Close match situation - enhance drama
  if (isChasing && currentScore > 120 && currentScore < 160 && wkts < 4) {
    // Tight finish scenario
    weights[1] += 1; // More singles for tension
    weights[2] += 0.5; // More doubles
    weights["W"] *= 0.95; // Slightly fewer wickets
  }
}

module.exports = {
  getBattingRole,
  getWicketType,
  calculateBallOutcome,
  TRAITS,
  OUTCOME_WEIGHTS
};
