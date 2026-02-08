const mongoose = require('mongoose');

const achievementSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    achievements: [{
        id: String,
        name: String,
        description: String,
        icon: String,
        unlockedAt: Date,
        rarity: {
            type: String,
            enum: ['common', 'rare', 'epic', 'legendary'],
            default: 'common'
        }
    }],
    stats: {
        totalAchievements: { type: Number, default: 0 },
        commonCount: { type: Number, default: 0 },
        rareCount: { type: Number, default: 0 },
        epicCount: { type: Number, default: 0 },
        legendaryCount: { type: Number, default: 0 }
    }
}, { timestamps: true });

module.exports = mongoose.model('Achievement', achievementSchema);
