// Bowling Logic Module
// ===========================================

const { MATCH_CONFIG, SKILL_RANGES } = require('./constants');
const { getCompletePlayerData } = require('./playerCache');

/**
 * Get bowler type for a player
 * @param {Object} player - Player object
 * @returns {string} Bowler type
 */
function getBowlerType(player) {
  const dbEntry = getCompletePlayerData(player.name, player);
  const combined = [
    player.roleKey || player.role || '',
    dbEntry.role || '',
    dbEntry.type || ''
  ].join(' ').toLowerCase();

  let type = 'pacer';

  if (combined.includes('off-spin') || combined.includes('mystery')) {
    type = 'off-spinner';
  } else if (combined.includes('leg-spin') || combined.includes('china') || combined.includes('wrist')) {
    type = 'leg-spinner';
  } else if (combined.includes('spin') || combined.includes('orth')) {
    type = 'spinner';
  } else if (combined.includes('fast') || combined.includes('pace') || combined.includes('seam') || combined.includes('swing')) {
    type = 'pacer';
  }

  // All-rounder detection
  if (combined.includes('ar') || combined.includes('all') || dbEntry.type === 'ar') {
    const bat = dbEntry.bat || player.stats?.bat || SKILL_RANGES.DEFAULT_BAT_RATING;
    const bowl = dbEntry.bowl || player.stats?.bowl || SKILL_RANGES.DEFAULT_BOWL_RATING;
    
    if (bat >= 80 && bowl >= 60) return `ar-balanced-${type}`;
    if (bat >= 80) return `ar-batter-${type}`;
    return `ar-bowler-${type}`;
  }

  return type;
}

/**
 * Select bowlers from playing XI
 * @param {Array} playing11 - Playing 11 players
 * @returns {Array} Selected bowlers with details
 */
function selectBowlers(playing11) {
  // Filter out wicketkeepers
  const eligibleBowlers = playing11.filter(player => {
    const dbEntry = getCompletePlayerData(player.name, player);
    return dbEntry.type !== 'wk' && (player.roleKey || '').toLowerCase() !== 'wk';
  });

  // Create bowler objects with ratings
  let bowlers = eligibleBowlers.map(player => {
    const dbEntry = getCompletePlayerData(player.name, player);
    const bowlRating = dbEntry.bowl || player.stats?.bowl || 0;
    
    return {
      ...player,
      bowlRating,
      maxOvers: MATCH_CONFIG.OVERS_PER_INNINGS,
      remaining: MATCH_CONFIG.OVERS_PER_INNINGS,
      oversUsed: 0,
      balls: 0,
      wkts: 0,
      runs: 0,
      lastBowledOver: -2,
      economy: 0,
      oversDisplay: '0.0',
      isPartTime: (dbEntry.type !== 'bowl' && bowlRating < 70) || 
                  (player.role && player.role.toLowerCase().includes('part-timer')),
    };
  });

  // Sort by bowling rating
  bowlers.sort((a, b) => b.bowlRating - a.bowlRating);

  // Assign roles and limit overs
  return bowlers.map((bowler, index) => {
    bowler.bowlingRank = index + 1;
    bowler.isCompulsory = index < 3;
    bowler.isBackup = index >= 3 && index < 6;
    bowler.remaining = index < 6 ? MATCH_CONFIG.OVERS_PER_INNINGS : 0;
    return bowler;
  });
}

/**
 * Prepare bowlers for innings
 * @param {Array} playing11 - Playing 11 players
 * @returns {Array} Prepared bowlers
 */
function prepareBowlersForInnings(playing11) {
  return selectBowlers(playing11);
}

/**
 * Select bowler for a specific over
 * @param {Array} bowlable - Available bowlers
 * @param {number} overNumber - Over number
 * @param {string} phase - Match phase
 * @param {Function} seededRandom - Random function
 * @returns {Object|null} Selected bowler
 */
function selectBowlerForOver(bowlable, overNumber, phase, seededRandom) {
  // Get candidates who didn't bowl last over
  let candidates = bowlable.filter(bowler => 
    bowler.remaining > 0 && bowler.lastBowledOver !== overNumber - 1
  );

  // Fallback to any bowler with overs left
  if (candidates.length === 0) {
    candidates = bowlable.filter(bowler => bowler.remaining > 0);
    if (candidates.length === 0) return null;
  }

  // Sort candidates by priority
  candidates.sort((a, b) => {
    let scoreA = a.bowlRating;
    let scoreB = b.bowlRating;

    // Compulsory bowler bonus
    if (a.isCompulsory) scoreA += 50;
    if (b.isCompulsory) scoreB += 50;

    // Phase suitability
    const typeA = getBowlerType(a);
    const typeB = getBowlerType(b);
    const dbInfoA = getCompletePlayerData(a.name, a);
    const dbInfoB = getCompletePlayerData(b.name, b);
    const roleA = (dbInfoA.role || '').toLowerCase();
    const roleB = (dbInfoB.role || '').toLowerCase();

    if (phase === 'pp') {
      if (typeA.includes('pacer')) scoreA += 15;
      if (typeB.includes('pacer')) scoreB += 15;
      if (roleA.includes('powerplay')) scoreA += 25;
      if (roleB.includes('powerplay')) scoreB += 25;
    }
    
    if (phase === 'death') {
      if (typeA.includes('pacer')) scoreA += 15;
      if (typeB.includes('pacer')) scoreB += 15;
      if (roleA.includes('death')) scoreA += 30;
      if (roleB.includes('death')) scoreB += 30;
    }
    
    if (phase === 'mid') {
      if (typeA.includes('spin')) scoreA += 20;
      if (typeB.includes('spin')) scoreB += 20;
      if (a.isBackup) scoreA += 10;
      if (b.isBackup) scoreB += 10;
    }

    // Urgency factor
    const oversLeft = MATCH_CONFIG.OVERS_PER_INNINGS * 6 - overNumber * 6;
    if (a.isCompulsory && a.remaining > oversLeft / 3) scoreA += 40;
    if (b.isCompulsory && b.remaining > oversLeft / 3) scoreB += 40;

    return scoreB - scoreA + (seededRandom() * 10 - 5);
  });

  const selected = candidates[0];
  selected.lastBowledOver = overNumber;
  return selected;
}

/**
 * Update bowler statistics after a ball
 * @param {Object} bowler - Bowler object
 * @param {number} runs - Runs conceded
 */
function updateBowlerStats(bowler, runs) {
  bowler.runs += runs;
}

/**
 * Finalize bowler over statistics
 * @param {Object} bowler - Bowler object
 */
function endBowlerOver(bowler) {
  bowler.remaining--;
  bowler.oversUsed++;

  // Update overs display
  const overs = Math.floor(bowler.balls / 6);
  const balls = bowler.balls % 6;
  bowler.oversDisplay = `${overs}.${balls}`;

  // Calculate economy
  const totalOvers = bowler.balls / 6;
  const economy = totalOvers > 0 ? bowler.runs / totalOvers : 0;
  bowler.economy = economy.toFixed(2);
}

/**
 * Format overs display
 * @param {number} balls - Number of balls
 * @returns {string} Formatted overs string
 */
function layoutOvers(balls) {
  if (!balls) return '0.0';
  const overs = Math.floor(balls / 6);
  const ballsInOver = balls % 6;
  return `${overs}.${ballsInOver}`;
}

module.exports = {
  getBowlerType,
  selectBowlers,
  prepareBowlersForInnings,
  selectBowlerForOver,
  updateBowlerStats,
  endBowlerOver,
  layoutOvers
};
