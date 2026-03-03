// Main AI Engine - Refactored Modular Version
// ===========================================

// Import all modules
const { initializePlayerCache, getPlayerFromCache } = require('./playerCache');
const { validateTournamentTeams } = require('./validation');
const { runLocalTournament } = require('./tournamentSimulation');
const { runFullTournament } = require('./apiIntegration');
const { calculateTeamStrength } = require('./matchSimulation');
const { getBattingRole, calculateBallOutcome } = require('./battingLogic');
const { 
  getBowlerType, 
  selectBowlers, 
  prepareBowlersForInnings, 
  selectBowlerForOver,
  updateBowlerStats,
  endBowlerOver,
  layoutOvers
} = require('./bowlingLogic');
const { 
  VENUES, 
  PITCH_EFFECTS, 
  getVenueForTeam, 
  generateStadiumCommentary 
} = require('./venues');

// Initialize player database
const { PLAYER_DATABASE: PD_INT } = typeof require !== 'undefined'
  ? require('./player-database')
  : {
      PLAYER_DATABASE:
        (typeof global !== 'undefined' ? global['PLAYER_DATABASE'] : null) ||
        (typeof window !== 'undefined' ? window['PLAYER_DATABASE'] : null) ||
        {},
    };

const PLAYER_DATABASE = PD_INT;

// Initialize player cache
initializePlayerCache(PLAYER_DATABASE);

// Global form tracker (for backward compatibility)
const formTracker = {};

// Seeded random number generator
let rngSeed = Date.now();
function seededRandom() {
  rngSeed = (rngSeed * 9301 + 49297) % 233280;
  return rngSeed / 233280;
}

// Form tracking functions (for backward compatibility)
function getForm(name) {
  if (!formTracker[name]) formTracker[name] = 1.0;
  return formTracker[name];
}

function updateForm(name, runs, balls) {
  const { updateForm: updateFormLocal } = require('./matchSimulation');
  updateFormLocal(name, runs, balls, formTracker);
}

function updateBowlingForm(name, figures) {
  const { updateBowlingForm: updateBowlingFormLocal } = require('./matchSimulation');
  updateBowlingFormLocal(name, figures, formTracker);
}

// Helper function for case-insensitive player lookup (backward compatibility)
function getPlayerFromDB(name) {
  return getPlayerFromCache(name);
}

// Legacy exports for backward compatibility
const battingLogic = {
  getRole: getBattingRole,
  getWicketType: (batter, bowler, phase, bowlTeam) => {
    const { getWicketType } = require('./battingLogic');
    return getWicketType(batter, bowler, phase, bowlTeam, seededRandom);
  },
  calculateBallOutcome: (batter, bowler, matchState, venue) => {
    return calculateBallOutcome(batter, bowler, matchState, venue, seededRandom, formTracker);
  },
};

const bowlingLogic = {
  getBowlerType,
  selectBowlers,
  prepareBowlersForInnings,
  selectBowlerForOver: (bowlable, overNumber, phase) => {
    return selectBowlerForOver(bowlable, overNumber, phase, seededRandom);
  },
  updateBowlerStats,
  endBowlerOver,
};

// All stats and player to team mapping for backward compatibility
const allStats = {};
const playerToTeam = {};

function getPStat(nameInput, currentTeamName = 'Unknown Team') {
  const { getPStat: getPStatLocal } = require('./matchSimulation');
  return getPStatLocal(nameInput, currentTeamName, allStats, playerToTeam);
}

// Helper functions
function getActiveXI(team, mode) {
  const { getActiveXI: getActiveXILocal } = require('./matchSimulation');
  return getActiveXILocal(team, mode);
}

// Legacy simInnings function for backward compatibility
function simInnings(batTeam, bowlTeam, target, innIndex, venue, isKnockout = false, isPlayoffs = false) {
  const { simInnings: simInningsLocal } = require('./matchSimulation');
  return simInningsLocal(batTeam, bowlTeam, target, innIndex, venue, isKnockout, isPlayoffs, allStats, playerToTeam, formTracker, seededRandom);
}

// Legacy simulateMatch function for backward compatibility
function simulateMatch(t1, t2, type = 'LEAGUE') {
  const { simulateMatch: simulateMatchLocal } = require('./matchSimulation');
  return simulateMatchLocal(t1, t2, type, allStats, playerToTeam, formTracker, seededRandom);
}

// Legacy runLocalTournament function for backward compatibility
function runLocalTournamentLegacy(tourneyTeams) {
  // Clear stats and re-seed RNG for new tournament
  rngSeed = Date.now();
  for (const key in allStats) delete allStats[key];
  for (const key in playerToTeam) delete playerToTeam[key];
  for (const key in formTracker) delete formTracker[key];

  return runLocalTournament(tourneyTeams, seededRandom);
}

// Export everything needed
module.exports = {
  // Core modules
  battingLogic,
  bowlingLogic,
  PLAYER_DATABASE,
  
  // Tournament functions
  runFullTournament,
  simulateMatch,
  runLocalTournament: runLocalTournamentLegacy,
  
  // Utility functions
  calculateTeamStrength,
  layoutOvers,
  
  // Legacy compatibility
  getForm,
  updateForm,
  updateBowlingForm,
  getPlayerFromDB,
  getPStat,
  getActiveXI,
  simInnings,
  
  // Constants and data
  VENUES,
  PITCH_EFFECTS,
  allStats,
  playerToTeam,
  formTracker,
  
  // Seeded random for consistent results
  seededRandom,
};
