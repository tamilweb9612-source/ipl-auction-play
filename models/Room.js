const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
    roomId: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    adminPlayerId: { type: String, required: true },
    config: mongoose.Schema.Types.Mixed,
    users: [String], // Array of socket IDs or Player IDs
    playerNames: { type: Map, of: String },
    teams: [{
        name: String,
        bidKey: String,
        isTaken: Boolean,
        ownerPlayerId: String,
        playerName: String,
        playerEmail: String,
        budget: Number,
        totalSpent: Number,
        totalPlayers: Number,
        roster: [mongoose.Schema.Types.Mixed]
    }],
    auctionQueue: [mongoose.Schema.Types.Mixed],
    auctionIndex: { type: Number, default: 0 },
    currentBid: { type: Number, default: 0 },
    currentBidder: String,
    currentPlayer: mongoose.Schema.Types.Mixed,
    state: {
        isActive: { type: Boolean, default: false }
    },
    squads: { type: Map, of: mongoose.Schema.Types.Mixed },
    lastTournamentResults: mongoose.Schema.Types.Mixed,
    isFinalized: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now, expires: 86400 } // Auto-delete after 24 hours
});

module.exports = mongoose.model('Room', roomSchema);
