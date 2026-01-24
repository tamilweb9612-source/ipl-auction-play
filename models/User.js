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
        result: String, // 'won', 'runner-up', 'eliminated', 'participated'
        squad: [{
            name: String,
            role: String,
            price: Number,
            type: String
        }],
        exchangesInvolved: { type: Number, default: 0 } // For blind auction
    }],
    createdAt: { type: Date, default: Date.now }
});

// Hash password before saving
userSchema.pre('save', async function() {
    if (!this.isModified('password')) return;
    this.password = await bcrypt.hash(this.password, 10);
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
