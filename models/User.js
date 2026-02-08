const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    otp: {
        code: String,
        expiresAt: Date
    },
    // Profile Statistics
    avatar: { type: String, default: '' }, // URL or base64 image
    welcomeEmailSent: { type: Boolean, default: false },
    stats: {
        matchesPlayed: { type: Number, default: 0 },
        matchesWon: { type: Number, default: 0 },
        auctionsParticipated: { type: Number, default: 0 }
    },
    // Game-specific stats
    normalAuction: {
        matchesPlayed: { type: Number, default: 0 },
        matchesWon: { type: Number, default: 0 },
        winRate: { type: Number, default: 0 }
    },
    blindAuction: {
        matchesPlayed: { type: Number, default: 0 },
        matchesWon: { type: Number, default: 0 },
        winRate: { type: Number, default: 0 },
        exchangesMade: { type: Number, default: 0 },
        exchangesReceived: { type: Number, default: 0 }
    },
    // Auction History - stores each auction's details
    auctionHistory: [{
        gameType: { type: String, enum: ['normal', 'blind'], default: 'normal' },
        roomId: String,
        teamName: String,
        date: { type: Date, default: Date.now },
        result: String, // 'won', 'runner-up', 'eliminated',
        squad: [new mongoose.Schema({
            name: String,
            role: String,
            price: Number,
            type: String
        }, { _id: false })],
        exchangesInvolved: { type: Number, default: 0 } // For blind auction
    }],
    // ✨ Persistent Session Data (Moved from LocalStorage to MongoDB)
    session: {
        playerId: { type: String, default: null },
        activeRoomId: { type: String, default: null },
        activeTeamKey: { type: String, default: null },
        lastRoomId: { type: String, default: null },
        lastPass: { type: String, default: null },
        preferences: {
            theme: { type: String, default: 'dark' },
            notifications: { type: Boolean, default: true }
        },
        teamKeys: { type: Map, of: String, default: {} } // Map of roomId -> teamKey
    },
    // ✨ IP Tracking
    lastIp: { type: String },
    ipHistory: [String],
    createdAt: { type: Date, default: Date.now }
});

// WARNING: Storing passwords in plain text is NOT secure.
// This change was made per user request to see exact passwords in the database.

// Pre-save hook REMOVED to stop hashing
// userSchema.pre('save', async function() {
//     if (!this.isModified('password')) return;
//     this.password = await bcrypt.hash(this.password, 10);
// });

// Compare password method - CHANGED to plain text comparison
userSchema.methods.comparePassword = async function(candidatePassword) {
    // Direct string comparison
    return candidatePassword === this.password;
};

module.exports = mongoose.model('User', userSchema);
