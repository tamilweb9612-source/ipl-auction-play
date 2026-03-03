// API Integration Module (Gemini AI)
// ===========================================

const https = require('https');
const { TOURNAMENT_CONFIG, ERROR_MESSAGES } = require('./constants');
const { validateApiKey } = require('./validation');
const { runLocalTournament } = require('./tournamentSimulation');

// Load environment variables
require('dotenv').config();

// API Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

/**
 * Call Gemini API
 * @param {string} prompt - Prompt to send
 * @returns {Promise<string>} API response
 */
function callGeminiAPI(prompt) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        response_mime_type: 'application/json',
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
      },
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: TOURNAMENT_CONFIG.API_TIMEOUT_MS,
    };

    const req = https.request(options, (res) => {
      let resBody = '';
      res.on('data', (chunk) => (resBody += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(resBody);
          if (parsed.error) {
            console.error('Gemini API Error:', parsed.error);
            return reject(parsed.error.message || 'Gemini API returned an error');
          }

          if (!parsed.candidates || !parsed.candidates[0]) {
            return reject('No response candidates from Gemini API');
          }

          const text = parsed.candidates[0].content.parts[0].text;
          resolve(text);
        } catch (e) {
          console.error('Parse Error:', e.message, 'Response:', resBody.substring(0, 500));
          reject('Failed to parse Gemini API response: ' + e.message);
        }
      });
    });

    // Timeout handling
    req.setTimeout(TOURNAMENT_CONFIG.API_TIMEOUT_MS, () => {
      req.destroy();
      reject(ERROR_MESSAGES.API_TIMEOUT + ' ' + TOURNAMENT_CONFIG.API_TIMEOUT_MS / 1000 + ' seconds');
    });

    req.on('error', (e) => {
      console.error('Request Error:', e.message);
      reject(ERROR_MESSAGES.NETWORK_ERROR + e.message);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Run full tournament with AI integration
 * @param {Array} tourneyTeams - Tournament teams
 * @param {string} customPrompt - Custom prompt for AI
 * @returns {Promise<Object>} Tournament results
 */
async function runFullTournament(tourneyTeams, customPrompt = '') {
  console.log('🤖 Gemini AI is simulating your tournament...');

  // Check API key
  if (!validateApiKey(GEMINI_API_KEY)) {
    console.error('❌ ERROR: Gemini API Key is missing! Falling back to Local Engine.');
    return runLocalTournament(tourneyTeams);
  }

  // Prepare team data for prompt
  const teamData = tourneyTeams
    .map(team => {
      const squadInfo = team.squad && team.squad.length > 5
        ? team.squad.map(player => `${player.name} (${player.roleKey || 'bat'})`).join(', ')
        : 'Empty squad (AI: Please invent a realistic T20 starting XI for this team name)';
      return `Team: ${team.name}\nPlayers: ${squadInfo}`;
    })
    .join('\n\n');

  const promptText = `
    Act as a professional Cricket Simulation Engine. Simulate a full T20 Cricket Tournament based on these teams:
    
    ${teamData}

    ${customPrompt ? `--- USER CUSTOM DIRECTIVES ---\n${customPrompt}\n------------------------------` : ''}

    REQUIREMENTS:
    - Simulate a FULL tournament with ALL teams provided.
    - If some teams have empty squads, invent a realistic starting XI for them based on their franchise name.
    - Format: Double Round Robin (Each team plays multiple matches).
    - Provide realistic T20 scores based on typical stadium limits.
    - Match results should be consistent with squad strengths and venue characteristics.
    - Calculate top performer awards (Orange Cap, Purple Cap, MVP, Most Sixes, Highest SR, Best Economy, Best Impact).
    - IMPORTANT: "standings" array MUST contain ALL teams with their complete season stats.
    - IMPORTANT: "leagueMatches" should contain a representative selection of match results.

    OUTPUT JSON STRUCTURE:
    Return ONLY a raw JSON object:
    {
      "winner": { "name": "Team Name" },
      "runnerUp": { "name": "Team Name" },
      "standings": [
        { "name": "CSK", "stats": { "played": 18, "won": 10, "lost": 8, "pts": 20, "nrr": 0.12 } }
      ],
      "leagueMatches": [
        { "t1": "CSK", "t2": "MI", "winner": "CSK", "margin": "10 runs", "score1": "180/4", "score2": "170/9", "type": "League" }
      ],
      "playoffs": [
        { "t1": "CSK", "t2": "RCB", "winner": "CSK", "margin": "5 wkts", "score1": "150/5", "score2": "151/5", "type": "Qualifier 1" }
      ],
      "orangeCap": { "name": "Player Name", "val": 750, "team": "CSK" },
      "purpleCap": { "name": "Player Name", "val": 28, "team": "MI" },
      "mvp": { "name": "Player Name", "val": 380, "team": "RCB" },
      "mostSixes": { "name": "Player Name", "val": 42, "team": "SRH" },
      "highestSr": { "name": "Player Name", "val": 185.5, "team": "KKR" },
      "bestEco": { "name": "Player Name", "val": 6.8, "team": "LSG" },
      "bestImpact": { "name": "Player Name", "val": 450, "team": "MI" },
      "tournamentSixes": 1150
    }
    `;

  try {
    const responseText = await callGeminiAPI(promptText);

    // Clean markdown backticks if AI adds them
    let cleanJson = responseText
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();

    // Robust extraction: Find substring between first { and last }
    const firstParen = cleanJson.indexOf('{');
    const lastParen = cleanJson.lastIndexOf('}');
    if (firstParen !== -1 && lastParen !== -1) {
      cleanJson = cleanJson.substring(firstParen, lastParen + 1);
    }

    const data = JSON.parse(cleanJson);

    // Enrich with original team metadata
    if (data.standings && Array.isArray(data.standings)) {
      data.standings.forEach(standing => {
        const original = tourneyTeams.find(t => t.name === standing.name);
        if (original) {
          standing.playerName = original.playerName;
          standing.bidKey = original.bidKey;
        }
      });
    }

    console.log('✅ Gemini Simulation Complete!');
    return data;
  } catch (error) {
    console.error('❌ Tournament Simulation Failed:', error);
    console.warn('⚠️ Falling back to Local Simulation Engine...');
    
    try {
      return runLocalTournament(tourneyTeams);
    } catch (localErr) {
      console.error('❌ Local Simulation also failed:', localErr);
      return {
        error: ERROR_MESSAGES.BOTH_SIMULATIONS_FAILED,
        details: localErr.message,
      };
    }
  }
}

module.exports = {
  callGeminiAPI,
  runFullTournament
};
