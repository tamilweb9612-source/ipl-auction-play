// Player Database Cache Module
// ===========================================

const { SKILL_RANGES } = require('./constants');

// Cache for player database lookups
const playerCache = new Map();
const normalizedPlayerCache = new Map();

/**
 * Initialize player database with caching
 * @param {Object} playerDatabase - Raw player database
 */
function initializePlayerCache(playerDatabase) {
  // Clear existing cache
  playerCache.clear();
  normalizedPlayerCache.clear();
  
  // Cache original database
  if (playerDatabase) {
    Object.keys(playerDatabase).forEach(key => {
      playerCache.set(key, playerDatabase[key]);
      // Cache normalized (lowercase) version for case-insensitive lookup
      normalizedPlayerCache.set(key.toLowerCase(), playerDatabase[key]);
    });
  }
}

/**
 * Get player from database with caching and fallback
 * @param {string} name - Player name
 * @returns {Object} Player data or default stats
 */
function getPlayerFromCache(name) {
  if (!name || typeof name !== 'string') {
    return getDefaultPlayerStats();
  }

  // Try exact match first
  if (playerCache.has(name)) {
    return playerCache.get(name);
  }

  // Try case-insensitive match
  const lowerName = name.toLowerCase();
  if (normalizedPlayerCache.has(lowerName)) {
    return normalizedPlayerCache.get(lowerName);
  }

  // Return default stats if not found
  return getDefaultPlayerStats();
}

/**
 * Get default player stats for missing entries
 * @returns {Object} Default player stats
 */
function getDefaultPlayerStats() {
  return {
    bat: SKILL_RANGES.DEFAULT_BAT_RATING,
    bowl: SKILL_RANGES.DEFAULT_BOWL_RATING,
    luck: SKILL_RANGES.NEUTRAL_LUCK,
    role: "normal",
    type: "bat",
    hand: "rhb",
    trait: "normal"
  };
}

/**
 * Validate player data
 * @param {Object} player - Player object to validate
 * @returns {Object} Validated player data
 */
function validatePlayerData(player) {
  if (!player || typeof player !== 'object') {
    return getDefaultPlayerStats();
  }

  return {
    bat: Math.max(SKILL_RANGES.MIN_RATING, Math.min(SKILL_RANGES.MAX_RATING, player.bat || SKILL_RANGES.DEFAULT_BAT_RATING)),
    bowl: Math.max(SKILL_RANGES.MIN_RATING, Math.min(SKILL_RANGES.MAX_RATING, player.bowl || SKILL_RANGES.DEFAULT_BOWL_RATING)),
    luck: Math.max(SKILL_RANGES.MIN_RATING, Math.min(SKILL_RANGES.MAX_RATING, player.luck || SKILL_RANGES.NEUTRAL_LUCK)),
    role: player.role || "normal",
    type: player.type || "bat",
    hand: player.hand || "rhb",
    trait: player.trait || "normal"
  };
}

/**
 * Get player with fallback to squad stats
 * @param {string} name - Player name
 * @param {Object} squadPlayer - Squad player object with stats
 * @returns {Object} Complete player data
 */
function getCompletePlayerData(name, squadPlayer = {}) {
  const dbPlayer = getPlayerFromCache(name);
  
  // If database has complete info, use it
  if (dbPlayer.bat && dbPlayer.bowl) {
    return validatePlayerData(dbPlayer);
  }

  // Merge with squad stats if available
  const mergedPlayer = {
    ...dbPlayer,
    ...(squadPlayer.stats || {}),
    role: squadPlayer.role || dbPlayer.role,
    type: squadPlayer.type || dbPlayer.type,
    hand: squadPlayer.hand || dbPlayer.hand,
    trait: squadPlayer.trait || dbPlayer.trait
  };

  return validatePlayerData(mergedPlayer);
}

/**
 * Clear cache (useful for tournaments)
 */
function clearCache() {
  playerCache.clear();
  normalizedPlayerCache.clear();
}

/**
 * Get cache statistics
 * @returns {Object} Cache stats
 */
function getCacheStats() {
  return {
    originalEntries: playerCache.size,
    normalizedEntries: normalizedPlayerCache.size,
    totalMemory: playerCache.size + normalizedPlayerCache.size
  };
}

module.exports = {
  initializePlayerCache,
  getPlayerFromCache,
  getCompletePlayerData,
  validatePlayerData,
  getDefaultPlayerStats,
  clearCache,
  getCacheStats
};
