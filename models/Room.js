const mongoose = require('mongoose');

const PlayerSchema = new mongoose.Schema({
    id: String,
    name: String,
    role: String,
    basePrice: Number,
    soldPrice: Number,
    isSold: { type: Boolean, default: false },
    owner: String, // Team ID
});

const TeamSchema = new mongoose.Schema({
    bidKey: String,
    name: String,
    abbreviation: String,
    budget: Number,
    totalSpent: { type: Number, default: 0 },
    roster: [PlayerSchema],
    ownerSocketId: String,
    isTaken: { type: Boolean, default: false },
    ownerName: String, // User name
    ownerPlayerId: String, // Persistent player ID for reconnection
});

const RoomSchema = new mongoose.Schema({
    roomId: { type: String, required: true, unique: true },
    password: { type: String }, // Store room password
    hostId: String,
    adminPlayerId: String, // Persistent admin ID
    adminSocketId: String,
    gameType: { type: String, default: 'normal' }, // normal or blind
    config: { type: Object, default: {} }, // Room settings (budget, etc)
    teams: [TeamSchema],
    auctionQueue: [Object], // List of players for auction
    auctionIndex: { type: Number, default: 0 },
    currentLotIndex: { type: Number, default: 0 },
    currentSetIndex: { type: Number, default: 0 },
    auctionState: { type: String, default: 'LOBBY' }, // LOBBY, AUCTION, SQUAD_SELECTION, RESULTS
    players: [PlayerSchema], // All players in the auction
    sets: [Object], // Structure of sets
    playerNames: { type: Map, of: String }, // Map of playerId -> name
    squads: { type: Object, default: {} }, // Map of teamKey -> squad data
    createdAt: { type: Date, default: Date.now },
    lastActivity: { type: Date, default: Date.now },
    completedAt: { type: Date }, // Set when auction/tournament completes
});

// Auto-delete completed rooms after 12 hours (43200 seconds)
RoomSchema.index({ "completedAt": 1 }, { expireAfterSeconds: 43200 });

module.exports = mongoose.model('Room', RoomSchema);
