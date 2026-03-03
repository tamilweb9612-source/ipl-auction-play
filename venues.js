// Venues Module
// ===========================================

const { VENUE_CONFIG } = require('./constants');

// Venue definitions with realistic characteristics
const VENUES = {
  CSK: {
    name: "M. A. Chidambaram Stadium",
    city: "Chennai",
    range: [100, 190],
    chaseProb: 0.5,
    pitch: "dusty",
    boundary: "large",
    six: 0.52,
    pace: 0.5,
    spin: 1.0,
  },
  MI: {
    name: "Wankhede Stadium",
    city: "Mumbai",
    range: [120, 190],
    chaseProb: 0.6,
    pitch: "flat",
    boundary: "small",
    six: 0.98,
    pace: 0.8,
    spin: 0.5,
  },
  RCB: {
    name: "M. Chinnaswamy Stadium",
    city: "Bengaluru",
    range: [140, 230],
    chaseProb: 0.62,
    pitch: "flat",
    boundary: "tiny",
    six: 1.24,
    pace: 0.7,
    spin: 0.4,
  },
  GT: {
    name: "Narendra Modi Stadium",
    city: "Ahmedabad",
    range: [120, 200],
    chaseProb: 0.6,
    pitch: "green",
    boundary: "large",
    six: 0.65,
    pace: 0.7,
    spin: 0.6,
  },
  LSG: {
    name: "Ekana Cricket Stadium",
    city: "Lucknow",
    range: [108, 190],
    chaseProb: 0.4,
    pitch: "slow",
    boundary: "large",
    six: 0.39,
    pace: 0.5,
    spin: 0.9,
  },
  PBKS: {
    name: "PCA Stadium Mohali",
    city: "Mohali",
    range: [110, 200],
    chaseProb: 0.6,
    pitch: "green",
    boundary: "medium",
    six: 0.78,
    pace: 0.7,
    spin: 0.5,
  },
  KKR: {
    name: "Eden Gardens",
    city: "Kolkata",
    range: [120, 200],
    chaseProb: 0.65,
    pitch: "slow",
    boundary: "medium",
    six: 0.65,
    pace: 0.4,
    spin: 0.8,
  },
  RR: {
    name: "Sawai Mansingh Stadium",
    city: "Jaipur",
    range: [120, 195],
    chaseProb: 0.5,
    pitch: "dusty",
    boundary: "large",
    six: 0.52,
    pace: 0.6,
    spin: 0.7,
  },
  DC: {
    name: "Arun Jaitley Stadium",
    city: "Delhi",
    range: [130, 210],
    chaseProb: 0.65,
    pitch: "flat",
    boundary: "small",
    six: 0.78,
    pace: 0.7,
    spin: 0.5,
  },
  SRH: {
    name: "Rajiv Gandhi Intl",
    city: "Hyderabad",
    range: [140, 235],
    chaseProb: 0.45,
    pitch: "flat",
    boundary: "medium",
    six: 0.91,
    pace: 0.6,
    spin: 0.5,
  },
};

// Pitch effects configuration
const PITCH_EFFECTS = {
  flat: { 4: 5, 6: 6, W: 0 },
  green: { W: 6.0, 0: 4, 4: -3 },
  dusty: { W: 5.5, 0: 6, 1: -2, 6: -2 },
  slow: { 6: -2.5, 2: 4, 1: 3, W: 4.5 },
};

/**
 * Get venue for team based on team name
 * @param {string} teamName - Team name
 * @param {Function} seededRandom - Random function for fallback
 * @param {boolean} isPlayoffs - Is this a playoff match
 * @returns {Object} Venue object
 */
function getVenueForTeam(teamName, seededRandom = Math.random, isPlayoffs = false) {
  const venue = VENUES[teamName];
  if (!venue) {
    // Fallback to random venue if team not found
    const venueKeys = Object.keys(VENUES);
    const randomKey = venueKeys[Math.floor(seededRandom() * venueKeys.length)];
    return VENUES[randomKey];
  }

  // Playoff adjustments for closer matches
  if (isPlayoffs) {
    const adjustedVenue = { ...venue };
    
    // Reduce range variance in playoffs for closer matches
    const rangeDiff = venue.range[1] - venue.range[0];
    const reducedDiff = Math.floor(rangeDiff * 0.7); // 30% less variance
    
    // Adjust ranges to be tighter
    adjustedVenue.range = [
      Math.max(venue.range[0] + 10, venue.range[0] + Math.floor(rangeDiff * 0.15)), // Higher minimum
      Math.max(venue.range[1] - 10, venue.range[0] + reducedDiff)  // Lower maximum
    ];
    
    return adjustedVenue;
  }

  return venue;
}

/**
 * Generate stadium commentary for ball outcome
 * @param {Object} ballOutcome - Ball outcome object
 * @param {Object} batter - Batter object
 * @param {Object} bowler - Bowler object
 * @param {Object} venue - Venue object
 * @param {string} phase - Match phase
 * @returns {Object} Commentary object
 */
function generateStadiumCommentary(ballOutcome, batter, bowler, venue, phase) {
  const { runs, wicket, wicketType, extra } = ballOutcome;
  let commentary = '';
  let stadiumEffect = '';

  // Venue-specific comments
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
    if (venue.boundary === 'large') {
      stadiumEffect = " Over the huge boundary! Massive hit!";
    } else if (venue.boundary === 'tiny') {
      stadiumEffect = " Cleared the short boundary with ease.";
    } else {
      stadiumEffect = " Into the stands!";
    }
    if (venue.six > 0.8) {
      stadiumEffect += ` ${venue.name} is a six-hitting paradise!`;
    }
  } else if (runs === 4) {
    if (venue.boundary === 'large') {
      stadiumEffect = " Found the gap on this big ground.";
    } else {
      stadiumEffect = " Racing to the fence!";
    }
  } else if (wicket) {
    if (venue.pitch === 'dusty' && wicketType === 'bowled') {
      stadiumEffect = ` The turning pitch at ${venue.name} does the trick!`;
    } else if (venue.pitch === 'green' && wicketType === 'caught') {
      stadiumEffect = " The extra bounce takes the edge!";
    } else if (phase === 'death') {
      stadiumEffect = ` Pressure mounts at ${venue.name}!`;
    }
  } else if (runs === 0 && !extra) {
    if (venue.pitch === 'slow') {
      stadiumEffect = " The slow pitch making it hard to score.";
    } else if (venue.spin > 0.8) {
      stadiumEffect = " Spinners keeping it tight.";
    }
  }

  // Generate ball description
  if (wicket) {
    commentary = `${batter.name} ${wicketType === 'run out' ? 'is RUN OUT' : 
      wicketType === 'caught' ? `caught${ballOutcome.fielder ? ` by ${ballOutcome.fielder}` : ''}` :
      wicketType === 'stumped' ? 'is STUMPED' :
      wicketType === 'lbw' ? 'is LBW' : 'is BOWLED'}!${stadiumEffect}`;
  } else if (runs === 6) {
    commentary = `SIX! ${batter.name} launches it!${stadiumEffect}`;
  } else if (runs === 4) {
    commentary = `FOUR! ${batter.name} finds the boundary!${stadiumEffect}`;
  } else if (extra === 'WD') {
    commentary = `Wide ball by ${bowler.name}.`;
  } else if (extra === 'NB') {
    commentary = `No ball! Free hit coming up.`;
  } else {
    commentary = `${runs === 0 ? 'Dot ball' : `${runs} run${runs > 1 ? 's' : ''}`}.${stadiumEffect}`;
  }

  return {
    text: commentary,
    stadiumContext: venueComments[venue.pitch] || '',
    boundaryContext: boundaryComments[venue.boundary] || '',
    venue: venue.name,
    city: venue.city,
  };
}

/**
 * Validate venue object
 * @param {Object} venue - Venue to validate
 * @returns {boolean} True if valid
 */
function validateVenue(venue) {
  if (!venue || typeof venue !== 'object') return false;
  if (!venue.name || typeof venue.name !== 'string') return false;
  if (!venue.pitch || !VENUE_CONFIG.PITCH_TYPES.includes(venue.pitch)) return false;
  if (!venue.boundary || !VENUE_CONFIG.BOUNDARY_SIZES.includes(venue.boundary)) return false;
  return true;
}

/**
 * Get all available venues
 * @returns {Array} Array of venue objects
 */
function getAllVenues() {
  return Object.values(VENUES);
}

/**
 * Get venue by key
 * @param {string} key - Venue key (e.g., 'CSK', 'MI')
 * @returns {Object|null} Venue object or null if not found
 */
function getVenueByKey(key) {
  return VENUES[key.toUpperCase()] || null;
}

module.exports = {
  VENUES,
  PITCH_EFFECTS,
  getVenueForTeam,
  generateStadiumCommentary,
  validateVenue,
  getAllVenues,
  getVenueByKey
};
