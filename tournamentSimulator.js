// Tournament Simulator - 10 Teams Complete Tournament
// ===========================================

const { runLocalTournament } = require('./ai');
const fs = require('fs');

// Create 10 dummy teams with varied strengths
const createDummyTeams = () => {
  const teamNames = [
    'Super Kings', 'Mumbai Indians', 'Royal Challengers', 'Kolkata Riders',
    'Rajasthan Royals', 'Punjab Kings', 'Delhi Capitals', 'Hyderabad Suns',
    'Lucknow Giants', 'Gujarat Titans'
  ];

  const teamShortCodes = ['CSK', 'MI', 'RCB', 'KKR', 'RR', 'PBKS', 'DC', 'SRH', 'LSG', 'GT'];

  return teamNames.map((name, index) => {
    const shortCode = teamShortCodes[index];
    
    // Create varied squad strengths
    const baseStrength = 60 + (index * 4); // 60 to 96
    const variance = 15;
    
    const squad = [];
    
    // 3 Star Batsmen
    for (let i = 0; i < 3; i++) {
      squad.push({
        name: `Star Batter ${i + 1} ${shortCode}`,
        roleKey: 'bat',
        stats: {
          bat: Math.min(95, baseStrength + Math.random() * variance),
          bowl: 30 + Math.random() * 20,
          luck: 75 + Math.random() * 20
        }
      });
    }
    
    // 2 All-Rounders
    for (let i = 0; i < 2; i++) {
      squad.push({
        name: `All Rounder ${i + 1} ${shortCode}`,
        roleKey: 'ar',
        stats: {
          bat: baseStrength - 10 + Math.random() * variance,
          bowl: baseStrength - 10 + Math.random() * variance,
          luck: 70 + Math.random() * 20
        }
      });
    }
    
    // 4 Bowlers (including 2 star bowlers)
    for (let i = 0; i < 4; i++) {
      const isStar = i < 2;
      squad.push({
        name: `${isStar ? 'Star' : 'Medium'} Bowler ${i + 1} ${shortCode}`,
        roleKey: 'bowl',
        stats: {
          bat: 30 + Math.random() * 20,
          bowl: Math.min(95, isStar ? baseStrength + Math.random() * variance : baseStrength - 5 + Math.random() * 10),
          luck: 70 + Math.random() * 20
        }
      });
    }
    
    // 3 Lower order batsmen
    for (let i = 0; i < 3; i++) {
      squad.push({
        name: `Lower Order ${i + 1} ${shortCode}`,
        roleKey: 'bat',
        stats: {
          bat: baseStrength - 20 + Math.random() * 15,
          bowl: 25 + Math.random() * 15,
          luck: 60 + Math.random() * 20
        }
      });
    }

    return {
      name: name,
      playerName: `Owner${index + 1}`,
      bidKey: shortCode.toLowerCase(),
      squad: squad,
      captain: squad[0].name, // First star batter as captain
      batImpact: squad.find(p => p.roleKey === 'bat'),
      bowlImpact: squad.find(p => p.roleKey === 'bowl')
    };
  });
};

// Format match scorecard for display
const formatMatchScorecard = (match) => {
  const { t1, t2, score1, score2, winner, margin, toss, venue, type, details } = match;
  
  let scorecard = `\n${'='.repeat(80)}\n`;
  scorecard += `MATCH: ${t1} vs ${t2} (${type})\n`;
  scorecard += `Venue: ${venue.name}, ${venue.city}\n`;
  scorecard += `Toss: ${toss}\n`;
  scorecard += `${'='.repeat(80)}\n`;
  
  // First innings
  const i1 = details.i1;
  scorecard += `FIRST INNINGS - ${i1.teamName}\n`;
  scorecard += `Score: ${i1.score}/${i1.wkts} (${i1.balls} balls)\n`;
  
  // Top scorers
  const topBatters = i1.batting
    .filter(b => b.runs > 0)
    .sort((a, b) => b.runs - a.runs)
    .slice(0, 3);
  
  scorecard += `Top Scorers:\n`;
  topBatters.forEach(b => {
    scorecard += `  ${b.name}: ${b.runs} (${b.balls} balls, ${b.fours}x4, ${b.sixes}x6) ${b.status}\n`;
  });
  
  // Top bowlers
  const topBowlers = i1.bowling
    .filter(b => b.wkts > 0 || b.runs > 0)
    .sort((a, b) => b.wkts - a.wkts || a.runs - b.runs)
    .slice(0, 3);
  
  scorecard += `Top Bowlers:\n`;
  topBowlers.forEach(b => {
    const economy = b.balls > 0 ? (b.runs / (b.balls / 6)).toFixed(2) : '0.00';
    scorecard += `  ${b.name}: ${b.wkts}/${b.runs} (${economy} econ)\n`;
  });
  
  scorecard += `${'-'.repeat(40)}\n`;
  
  // Second innings
  const i2 = details.i2;
  scorecard += `SECOND INNINGS - ${i2.teamName}\n`;
  scorecard += `Score: ${i2.score}/${i2.wkts} (${i2.balls} balls)\n`;
  
  // Top scorers
  const topBatters2 = i2.batting
    .filter(b => b.runs > 0)
    .sort((a, b) => b.runs - a.runs)
    .slice(0, 3);
  
  scorecard += `Top Scorers:\n`;
  topBatters2.forEach(b => {
    scorecard += `  ${b.name}: ${b.runs} (${b.balls} balls, ${b.fours}x4, ${b.sixes}x6) ${b.status}\n`;
  });
  
  // Top bowlers
  const topBowlers2 = i2.bowling
    .filter(b => b.wkts > 0 || b.runs > 0)
    .sort((a, b) => b.wkts - a.wkts || a.runs - b.runs)
    .slice(0, 3);
  
  scorecard += `Top Bowlers:\n`;
  topBowlers2.forEach(b => {
    const economy = b.balls > 0 ? (b.runs / (b.balls / 6)).toFixed(2) : '0.00';
    scorecard += `  ${b.name}: ${b.wkts}/${b.runs} (${economy} econ)\n`;
  });
  
  scorecard += `${'='.repeat(80)}\n`;
  scorecard += `RESULT: ${winner} won by ${margin}\n`;
  scorecard += `${'='.repeat(80)}\n`;
  
  return scorecard;
};

// Format tournament standings
const formatStandings = (standings) => {
  let standingsText = `\n${'='.repeat(80)}\n`;
  standingsText += `TOURNAMENT STANDINGS\n`;
  standingsText += `${'='.repeat(80)}\n`;
  standingsText += `Pos | Team           | P  | W  | L  | PTS | NRR   | Owner\n`;
  standingsText += `${'-'.repeat(80)}\n`;
  
  standings.forEach((team, index) => {
    const pos = (index + 1).toString().padStart(2);
    const name = team.name.padEnd(15);
    const played = team.stats.played.toString().padStart(2);
    const won = team.stats.won.toString().padStart(2);
    const lost = team.stats.lost.toString().padStart(2);
    const pts = team.stats.pts.toString().padStart(3);
    const nrr = team.stats.nrr.toFixed(3).padStart(6);
    const owner = team.playerName.padEnd(8);
    
    standingsText += `${pos} | ${name} | ${played} | ${won} | ${lost} | ${pts} | ${nrr} | ${owner}\n`;
  });
  
  standingsText += `${'='.repeat(80)}\n`;
  return standingsText;
};

// Format playoff matches
const formatPlayoffs = (playoffs) => {
  let playoffsText = `\n${'='.repeat(80)}\n`;
  playoffsText += `PLAYOFFS\n`;
  playoffsText += `${'='.repeat(80)}\n`;
  
  playoffs.forEach((match, index) => {
    playoffsText += `\n${match.type.toUpperCase()}\n`;
    playoffsText += `${match.t1} vs ${match.t2}\n`;
    playoffsText += `Score: ${match.score1} vs ${match.score2}\n`;
    playoffsText += `Winner: ${match.winner} (${match.margin})\n`;
    playoffsText += `Venue: ${match.venue.name}\n`;
    playoffsText += `${'-'.repeat(40)}\n`;
  });
  
  return playoffsText;
};

// Format awards
const formatAwards = (awards) => {
  let awardsText = `\n${'='.repeat(80)}\n`;
  awardsText += `TOURNAMENT AWARDS\n`;
  awardsText += `${'='.repeat(80)}\n`;
  awardsText += `Orange Cap (Most Runs): ${awards.orangeCap.name} (${awards.orangeCap.val} runs) - ${awards.orangeCap.team}\n`;
  awardsText += `Purple Cap (Most Wickets): ${awards.purpleCap.name} (${awards.purpleCap.val} wkts) - ${awards.purpleCap.team}\n`;
  awardsText += `Most Valuable Player: ${awards.mvp.name} (${awards.mvp.val} pts) - ${awards.mvp.team}\n`;
  awardsText += `Most Sixes: ${awards.mostSixes.name} (${awards.mostSixes.val} sixes) - ${awards.mostSixes.team}\n`;
  awardsText += `Highest Strike Rate: ${awards.highestSr.name} (${awards.highestSr.val} SR) - ${awards.highestSr.team}\n`;
  awardsText += `Best Economy: ${awards.bestEco.name} (${awards.bestEco.val} econ) - ${awards.bestEco.team}\n`;
  awardsText += `Best Impact: ${awards.bestImpact.name} (${awards.bestImpact.val} impact) - ${awards.bestImpact.team}\n`;
  awardsText += `Total Tournament Sixes: ${awards.tournamentSixes}\n`;
  awardsText += `${'='.repeat(80)}\n`;
  return awardsText;
};

// Main tournament simulation
const runTournament = () => {
  console.log('🏏 Starting 10-Team Tournament Simulation...\n');
  
  // Create teams
  const teams = createDummyTeams();
  console.log('Teams created:');
  teams.forEach(team => {
    console.log(`  ${team.name} (${team.playerName})`);
  });
  
  // Run tournament
  const startTime = Date.now();
  const result = runLocalTournament(teams);
  const endTime = Date.now();
  
  console.log(`\n⏱️ Tournament completed in ${((endTime - startTime) / 1000).toFixed(2)} seconds\n`);
  
  // Prepare complete scorecard file
  let completeScorecard = '';
  
  // Header
  completeScorecard += `${'='.repeat(80)}\n`;
  completeScorecard += `IPL TOURNAMENT 2025 - COMPLETE SCORECARD\n`;
  completeScorecard += `Simulation Date: ${new Date().toLocaleString()}\n`;
  completeScorecard += `Teams: ${teams.length}\n`;
  completeScorecard += `${'='.repeat(80)}\n\n`;
  
  // Winner and Runner-up
  completeScorecard += `🏆 TOURNAMENT WINNER: ${result.winner.name} (${result.winner.playerName})\n`;
  completeScorecard += `🥈 RUNNER-UP: ${result.runnerUp.name} (${result.runnerUp.playerName})\n\n`;
  
  // Final standings
  completeScorecard += formatStandings(result.standings);
  
  // All league matches (sample - show first 10 to avoid huge file)
  completeScorecard += `\n${'='.repeat(80)}\n`;
  completeScorecard += `LEAGUE MATCHES (First 10 of ${result.leagueMatches.length})\n`;
  completeScorecard += `${'='.repeat(80)}\n`;
  
  result.leagueMatches.slice(0, 10).forEach((match, index) => {
    completeScorecard += formatMatchScorecard(match);
  });
  
  if (result.leagueMatches.length > 10) {
    completeScorecard += `\n... and ${result.leagueMatches.length - 10} more league matches\n`;
  }
  
  // Playoffs
  if (result.playoffs && result.playoffs.length > 0) {
    completeScorecard += formatPlayoffs(result.playoffs);
  }
  
  // Awards
  completeScorecard += formatAwards(result);
  
  // Save to file
  const fileName = `tournament_scorecard_${Date.now()}.txt`;
  fs.writeFileSync(fileName, completeScorecard, 'utf8');
  
  console.log(`\n📄 Complete tournament scorecard saved to: ${fileName}`);
  console.log(`\n📊 Tournament Summary:`);
  console.log(`Winner: ${result.winner.name}`);
  console.log(`Runner-up: ${result.runnerUp.name}`);
  console.log(`Total matches: ${result.leagueMatches.length + (result.playoffs?.length || 0)}`);
  console.log(`Orange Cap: ${result.orangeCap.name} (${result.orangeCap.val} runs)`);
  console.log(`Purple Cap: ${result.purpleCap.name} (${result.purpleCap.val} wkts)`);
  console.log(`Total sixes: ${result.tournamentSixes}`);
  
  return result;
};

// Run the tournament
if (require.main === module) {
  runTournament();
}

module.exports = {
  runTournament,
  createDummyTeams,
  formatMatchScorecard,
  formatStandings,
  formatPlayoffs,
  formatAwards
};
