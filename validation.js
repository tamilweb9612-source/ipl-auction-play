// Input Validation Module
// ===========================================

const { TOURNAMENT_CONFIG, MATCH_CONFIG, SKILL_RANGES, ERROR_MESSAGES } = require('./constants');

/**
 * Validate tournament teams array
 * @param {Array} teams - Teams array
 * @throws {Error} If validation fails
 */
function validateTournamentTeams(teams) {
  if (!Array.isArray(teams)) {
    throw new Error(ERROR_MESSAGES.NEED_MIN_TEAMS);
  }

  if (teams.length < TOURNAMENT_CONFIG.MIN_TEAMS) {
    throw new Error(ERROR_MESSAGES.NEED_MIN_TEAMS);
  }

  // Validate each team
  teams.forEach((team, index) => {
    validateTeam(team, index);
  });
}

/**
 * Validate individual team
 * @param {Object} team - Team object
 * @param {number} index - Team index for error messages
 * @throws {Error} If validation fails
 */
function validateTeam(team, index = 0) {
  if (!team || typeof team !== 'object') {
    throw new Error(`Team at index ${index} is not a valid object`);
  }

  if (!team.name || typeof team.name !== 'string') {
    throw new Error(`Team at index ${index} must have a valid name`);
  }

  // Validate squad if present
  if (team.squad) {
    validateSquad(team.squad, team.name);
  }
}

/**
 * Validate team squad
 * @param {Array} squad - Squad array
 * @param {string} teamName - Team name for error messages
 * @throws {Error} If validation fails
 */
function validateSquad(squad, teamName) {
  if (!Array.isArray(squad)) {
    throw new Error(`Squad for team ${teamName} must be an array`);
  }

  if (squad.length > MATCH_CONFIG.MAX_SQUAD_SIZE) {
    throw new Error(`Squad for team ${teamName} exceeds maximum size of ${MATCH_CONFIG.MAX_SQUAD_SIZE}`);
  }

  // Validate each player
  squad.forEach((player, index) => {
    validatePlayer(player, `${teamName} player ${index}`);
  });
}

/**
 * Validate individual player
 * @param {Object} player - Player object
 * @param {string} context - Context for error messages
 * @throws {Error} If validation fails
 */
function validatePlayer(player, context = 'Player') {
  if (!player || typeof player !== 'object') {
    throw new Error(`${context} is not a valid object`);
  }

  if (!player.name || typeof player.name !== 'string') {
    throw new Error(`${context} must have a valid name`);
  }

  // Validate stats if present
  if (player.stats) {
    validatePlayerStats(player.stats, context);
  }
}

/**
 * Validate player stats
 * @param {Object} stats - Stats object
 * @param {string} context - Context for error messages
 * @throws {Error} If validation fails
 */
function validatePlayerStats(stats, context = 'Player') {
  if (!stats || typeof stats !== 'object') {
    return; // Stats are optional
  }

  // Validate batting rating
  if (stats.bat !== undefined) {
    if (typeof stats.bat !== 'number' || stats.bat < SKILL_RANGES.MIN_RATING || stats.bat > SKILL_RANGES.MAX_RATING) {
      throw new Error(`${context} batting rating must be between ${SKILL_RANGES.MIN_RATING} and ${SKILL_RANGES.MAX_RATING}`);
    }
  }

  // Validate bowling rating
  if (stats.bowl !== undefined) {
    if (typeof stats.bowl !== 'number' || stats.bowl < SKILL_RANGES.MIN_RATING || stats.bowl > SKILL_RANGES.MAX_RATING) {
      throw new Error(`${context} bowling rating must be between ${SKILL_RANGES.MIN_RATING} and ${SKILL_RANGES.MAX_RATING}`);
    }
  }

  // Validate luck rating
  if (stats.luck !== undefined) {
    if (typeof stats.luck !== 'number' || stats.luck < SKILL_RANGES.MIN_RATING || stats.luck > SKILL_RANGES.MAX_RATING) {
      throw new Error(`${context} luck rating must be between ${SKILL_RANGES.MIN_RATING} and ${SKILL_RANGES.MAX_RATING}`);
    }
  }
}

/**
 * Validate match state object
 * @param {Object} matchState - Match state object
 * @throws {Error} If validation fails
 */
function validateMatchState(matchState) {
  if (!matchState || typeof matchState !== 'object') {
    throw new Error('Match state must be a valid object');
  }

  // Validate phase
  if (matchState.phase && !['pp', 'mid', 'death'].includes(matchState.phase)) {
    throw new Error('Match phase must be one of: pp, mid, death');
  }

  // Validate numeric values
  const numericFields = ['ballsLeft', 'ballsBowled', 'currentScore', 'wkts', 'reqRR'];
  numericFields.forEach(field => {
    if (matchState[field] !== undefined && (typeof matchState[field] !== 'number' || matchState[field] < 0)) {
      throw new Error(`Match state ${field} must be a non-negative number`);
    }
  });

  // Validate boolean values
  const booleanFields = ['isChasing', 'recentCollapse', 'dewActive', 'isKnockout', 'isPlayoffs'];
  booleanFields.forEach(field => {
    if (matchState[field] !== undefined && typeof matchState[field] !== 'boolean') {
      throw new Error(`Match state ${field} must be a boolean`);
    }
  });
}

/**
 * Validate venue object
 * @param {Object} venue - Venue object
 * @throws {Error} If validation fails
 */
function validateVenue(venue) {
  if (!venue || typeof venue !== 'object') {
    throw new Error('Venue must be a valid object');
  }

  if (!venue.name || typeof venue.name !== 'string') {
    throw new Error('Venue must have a valid name');
  }

  if (!venue.pitch || !['flat', 'green', 'dusty', 'slow'].includes(venue.pitch)) {
    throw new Error('Venue pitch must be one of: flat, green, dusty, slow');
  }

  if (!venue.boundary || !['tiny', 'small', 'medium', 'large'].includes(venue.boundary)) {
    throw new Error('Venue boundary must be one of: tiny, small, medium, large');
  }

  // Validate numeric venue properties
  const numericFields = ['pace', 'spin', 'six', 'chaseProb'];
  numericFields.forEach(field => {
    if (venue[field] !== undefined && (typeof venue[field] !== 'number' || venue[field] < 0 || venue[field] > 2)) {
      throw new Error(`Venue ${field} must be a number between 0 and 2`);
    }
  });
}

/**
 * Validate API key
 * @param {string} apiKey - API key string
 * @returns {boolean} True if valid
 */
function validateApiKey(apiKey) {
  return apiKey && typeof apiKey === 'string' && !apiKey.includes('YOUR_');
}

/**
 * Sanitize string input
 * @param {string} input - Input string
 * @returns {string} Sanitized string
 */
function sanitizeString(input) {
  if (typeof input !== 'string') {
    return '';
  }
  return input.trim().replace(/[<>]/g, '');
}

/**
 * Validate and sanitize player name
 * @param {string} name - Player name
 * @returns {string} Sanitized name
 */
function validatePlayerName(name) {
  const sanitized = sanitizeString(name);
  if (!sanitized || sanitized.length < 2) {
    throw new Error('Player name must be at least 2 characters long');
  }
  return sanitized;
}

module.exports = {
  validateTournamentTeams,
  validateTeam,
  validateSquad,
  validatePlayer,
  validatePlayerStats,
  validateMatchState,
  validateVenue,
  validateApiKey,
  sanitizeString,
  validatePlayerName
};
