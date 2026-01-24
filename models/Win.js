const mongoose = require('mongoose');

const winSchema = new mongoose.Schema({
    // Room Information
    roomId: { 
        type: String, 
        required: true,
        index: true 
    },
    gameType: { 
        type: String, 
        enum: ['normal', 'blind'],
        default: 'normal'
    },
    
    // Game Details
    playedAt: { 
        type: Date, 
        default: Date.now 
    },
    
    // Players Information
    players: [{
        playerName: String,
        playerEmail: String,
        playerId: String,
        teamName: String,
        teamKey: String
    }],
    
    // Winner Information
    winner: {
        teamName: { type: String, required: true },
        teamKey: String,
        playerName: String,
        playerEmail: String,
        playerId: String,
        totalPoints: Number,
        wins: Number,
        losses: Number,
        nrr: Number
    },
    
    // Runner-up Information
    runnerUp: {
        teamName: String,
        teamKey: String,
        playerName: String,
        playerEmail: String,
        playerId: String,
        totalPoints: Number,
        wins: Number,
        losses: Number
    },
    
    // Tournament Statistics
    stats: {
        totalMatches: Number,
        totalTeams: Number,
        orangeCap: {
            playerName: String,
            runs: Number,
            team: String
        },
        purpleCap: {
            playerName: String,
            wickets: Number,
            team: String
        },
        mvp: {
            playerName: String,
            points: Number,
            team: String
        }
    },
    
    // Final Standings (Points Table)
    standings: [{
        position: Number,
        teamName: String,
        played: Number,
        won: Number,
        lost: Number,
        points: Number,
        nrr: Number
    }],
    
    // Additional Data
    metadata: {
        budget: Number,
        totalPlayers: Number,
        auctionDuration: Number,
        exchangeEnabled: Boolean
    }
}, {
    timestamps: true // Adds createdAt and updatedAt automatically
});

// Indexes for faster queries
winSchema.index({ roomId: 1, playedAt: -1 });
winSchema.index({ 'winner.playerEmail': 1 });
winSchema.index({ 'players.playerEmail': 1 });
winSchema.index({ gameType: 1 });

module.exports = mongoose.model('Win', winSchema);
