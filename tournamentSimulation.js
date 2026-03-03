// Tournament Simulation Module
// ===========================================

const { 
  TOURNAMENT_CONFIG, 
  AWARDS_CONFIG, 
  ERROR_MESSAGES 
} = require('./constants');
const { validateTournamentTeams } = require('./validation');
const { simulateMatch } = require('./matchSimulation');
const { getVenueForTeam } = require('./venues');

/**
 * Run a complete tournament simulation
 * @param {Array} tourneyTeams - Tournament teams
 * @param {Function} seededRandom - Random function
 * @returns {Object} Tournament results
 */
function runLocalTournament(tourneyTeams, seededRandom = Math.random) {
  // Validate input
  validateTournamentTeams(tourneyTeams);

  // Initialize tournament data
  const allStats = {};
  const playerToTeam = {};
  const formTracker = {};

  // Initialize teams
  initializeTeams(tourneyTeams, playerToTeam);

  const matches = [];
  
  // League stage (double round robin)
  simulateLeagueStage(tourneyTeams, matches, allStats, playerToTeam, formTracker, seededRandom);

  // Calculate standings
  const standings = calculateStandings(tourneyTeams);

  // Playoffs
  const { playoffs, champion, runnerUp } = simulatePlayoffs(standings, allStats, playerToTeam, formTracker, seededRandom);

  // Calculate awards
  const awards = calculateAwards(allStats);

  return {
    winner: { name: champion.name, playerName: champion.playerName },
    runnerUp: { name: runnerUp.name, playerName: runnerUp.playerName },
    standings: standings.map(s => ({
      name: s.name,
      playerName: s.playerName,
      stats: s.stats,
    })),
    leagueMatches: matches,
    playoffs,
    ...awards,
  };
}

/**
 * Initialize teams for tournament
 * @param {Array} teams - Tournament teams
 * @param {Object} playerToTeam - Player to team mapping
 */
function initializeTeams(teams, playerToTeam) {
  teams.forEach(team => {
    if (!team.squad) team.squad = [];
    
    // Auto-fill dummy players if needed
    while (team.squad.length < 12) {
      team.squad.push({
        name: `Player_${team.name}_${team.squad.length + 1}`,
        roleKey: 'ar',
        stats: { bat: 60, bowl: 60, luck: 50 },
      });
    }
    
    // Map players to teams
    team.squad.forEach(player => {
      playerToTeam[player.name] = team.name;
    });
    
    // Initialize team stats
    team.stats = {
      played: 0,
      won: 0,
      lost: 0,
      pts: 0,
      nrr: 0,
      rs: 0, // runs scored
      rc: 0, // runs conceded
      of: 0, // overs faced
      ob: 0, // overs bowled
    };
  });
}

/**
 * Simulate league stage
 * @param {Array} teams - Tournament teams
 * @param {Array} matches - Matches array to populate
 * @param {Object} allStats - All statistics
 * @param {Object} playerToTeam - Player to team mapping
 * @param {Object} formTracker - Form tracker
 * @param {Function} seededRandom - Random function
 */
function simulateLeagueStage(teams, matches, allStats, playerToTeam, formTracker, seededRandom) {
  // Double round robin
  for (let i = 0; i < teams.length; i++) {
    for (let j = 0; j < teams.length; j++) {
      if (i === j) continue;
      
      const match = simulateMatch(
        teams[i], 
        teams[j], 
        'League', 
        allStats, 
        playerToTeam, 
        formTracker, 
        seededRandom
      );
      
      handleLeaguePoints(match, teams);
      matches.push(match);
    }
  }
}

/**
 * Handle league points and NRR calculation
 * @param {Object} match - Match result
 * @param {Array} teams - Tournament teams
 */
function handleLeaguePoints(match, teams) {
  const t1 = teams.find(t => t.name === match.t1);
  const t2 = teams.find(t => t.name === match.t2);
  if (!t1 || !t2) return;

  t1.stats.played++;
  t2.stats.played++;

  // Award points
  if (match.winnerName === 'Tie') {
    t1.stats.pts += TOURNAMENT_CONFIG.POINTS_TIE;
    t2.stats.pts += TOURNAMENT_CONFIG.POINTS_TIE;
  } else if (match.winnerName === t1.name) {
    t1.stats.won++;
    t1.stats.pts += TOURNAMENT_CONFIG.POINTS_WIN;
    t2.stats.lost++;
  } else {
    t2.stats.won++;
    t2.stats.pts += TOURNAMENT_CONFIG.POINTS_WIN;
    t1.stats.lost++;
  }

  // Update NRR data
  updateNRRData(match, t1, t2);
}

/**
 * Update Net Run Rate data
 * @param {Object} match - Match result
 * @param {Object} t1 - Team 1
 * @param {Object} t2 - Team 2
 */
function updateNRRData(match, t1, t2) {
  const i1 = match.details.i1;
  const i2 = match.details.i2;

  const updateInningsStats = (innings, battingTeam, bowlingTeam) => {
    const runs = innings.score;
    const overs = innings.wkts === 10 ? 20 : innings.balls / 6;

    battingTeam.stats.rs += runs;
    battingTeam.stats.of += overs;
    bowlingTeam.stats.rc += runs;
    bowlingTeam.stats.ob += overs;
  };

  updateInningsStats(i1, 
    i1.teamName === t1.name ? t1 : t2, 
    i1.teamName === t1.name ? t2 : t1
  );
  updateInningsStats(i2, 
    i2.teamName === t1.name ? t1 : t2, 
    i2.teamName === t1.name ? t2 : t1
  );
}

/**
 * Calculate final standings
 * @param {Array} teams - Tournament teams
 * @returns {Array} Sorted standings
 */
function calculateStandings(teams) {
  // Calculate NRR for each team
  teams.forEach(team => {
    const rr = team.stats.of > 0 ? team.stats.rs / team.stats.of : 0;
    const ra = team.stats.ob > 0 ? team.stats.rc / team.stats.ob : 0;
    team.stats.nrr = parseFloat((rr - ra).toFixed(3));
  });

  // Sort by points, then NRR
  return [...teams].sort((a, b) => 
    b.stats.pts - a.stats.pts || b.stats.nrr - a.stats.nrr
  );
}

/**
 * Simulate playoffs
 * @param {Array} standings - Tournament standings
 * @param {Object} allStats - All statistics
 * @param {Object} playerToTeam - Player to team mapping
 * @param {Object} formTracker - Form tracker
 * @param {Function} seededRandom - Random function
 * @returns {Object} Playoffs results
 */
function simulatePlayoffs(standings, allStats, playerToTeam, formTracker, seededRandom) {
  const playoffs = [];
  let champion = standings[0];
  let runnerUp = standings[1];

  if (standings.length >= TOURNAMENT_CONFIG.PLAYOFF_TEAMS) {
    // Qualifier 1
    const q1 = simulateMatch(
      standings[0], standings[1], 'Qualifier 1', 
      allStats, playerToTeam, formTracker, seededRandom
    );
    
    // Eliminator
    const eli = simulateMatch(
      standings[2], standings[3], 'Eliminator', 
      allStats, playerToTeam, formTracker, seededRandom
    );

    const winnerQ1 = q1.winnerName === standings[0].name ? standings[0] : standings[1];
    const loserQ1 = q1.winnerName === standings[0].name ? standings[1] : standings[0];
    const winnerEli = eli.winnerName === standings[2].name ? standings[2] : standings[3];

    // Qualifier 2
    const q2 = simulateMatch(
      loserQ1, winnerEli, 'Qualifier 2', 
      allStats, playerToTeam, formTracker, seededRandom
    );
    const winnerQ2 = q2.winnerName === loserQ1.name ? loserQ1 : winnerEli;

    // Final
    const final = simulateMatch(
      winnerQ1, winnerQ2, 'Final', 
      allStats, playerToTeam, formTracker, seededRandom
    );

    champion = final.winnerName === winnerQ1.name ? winnerQ1 : winnerQ2;
    runnerUp = final.winnerName === winnerQ1.name ? winnerQ2 : winnerQ1;

    playoffs.push(q1, eli, q2, final);
  } else if (standings.length >= 2) {
    // Direct final for 2-3 teams
    const final = simulateMatch(
      standings[0], standings[1], 'Final', 
      allStats, playerToTeam, formTracker, seededRandom
    );
    
    champion = final.winnerName === standings[0].name ? standings[0] : standings[1];
    runnerUp = final.winnerName === standings[0].name ? standings[1] : standings[0];
    playoffs.push(final);
  }

  return { playoffs, champion, runnerUp };
}

/**
 * Calculate tournament awards
 * @param {Object} allStats - All statistics
 * @returns {Object} Awards data
 */
function calculateAwards(allStats) {
  const getTop = (key, minPlayed = 1) => {
    let best = { name: 'N/A', val: -1, team: 'N/A' };
    for (const playerName in allStats) {
      if (allStats[playerName][key] > best.val) {
        best = { 
          name: playerName, 
          val: allStats[playerName][key], 
          team: allStats[playerName].team 
        };
      }
    }
    return best;
  };

  const getBestSR = (minBalls = AWARDS_CONFIG.MIN_BALLS_FOR_SR) => {
    let best = { name: 'N/A', val: 0, team: 'N/A' };
    for (const playerName in allStats) {
      const player = allStats[playerName];
      if (player.ballsFaced >= minBalls) {
        const sr = (player.runs / player.ballsFaced) * 100;
        if (sr > best.val) {
          best = { 
            name: playerName, 
            val: parseFloat(sr.toFixed(1)), 
            team: player.team 
          };
        }
      }
    }
    return best;
  };

  const getBestEco = (minBalls = AWARDS_CONFIG.MIN_BALLS_FOR_ECONOMY) => {
    let best = { name: 'N/A', val: 99, team: 'N/A' };
    for (const playerName in allStats) {
      const player = allStats[playerName];
      if (player.ballsBowled >= minBalls) {
        const eco = player.runsConceded / (player.ballsBowled / 6);
        if (eco < best.val) {
          best = { 
            name: playerName, 
            val: parseFloat(eco.toFixed(2)), 
            team: player.team 
          };
        }
      }
    }
    return best.val === 99 ? { name: 'N/A', val: 0, team: 'N/A' } : best;
  };

  const getBestImpact = () => {
    let best = { name: 'N/A', val: 0, team: 'N/A' };
    for (const playerName in allStats) {
      const player = allStats[playerName];
      const impact = player.runs * AWARDS_CONFIG.IMPACT_RUNS_MULTIPLIER + 
                   player.wkts * AWARDS_CONFIG.IMPACT_WKTS_MULTIPLIER + 
                   player.sixes * AWARDS_CONFIG.IMPACT_SIXES_MULTIPLIER;
      if (impact > best.val) {
        best = { 
          name: playerName, 
          val: Math.round(impact), 
          team: player.team 
        };
      }
    }
    return best;
  };

  const tournamentSixes = Object.values(allStats).reduce(
    (sum, player) => sum + (player.sixes || 0), 0
  );

  return {
    orangeCap: getTop('runs'),
    purpleCap: getTop('wkts'),
    mvp: getTop('pts'),
    mostSixes: getTop('sixes'),
    highestSr: getBestSR(),
    bestEco: getBestEco(),
    bestImpact: getBestImpact(),
    tournamentSixes,
  };
}

module.exports = {
  runLocalTournament,
  initializeTeams,
  simulateLeagueStage,
  calculateStandings,
  simulatePlayoffs,
  calculateAwards
};
