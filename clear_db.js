const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Room = require('./models/Room');
const User = require('./models/User');
const Win = require('./models/Win');
const Achievement = require('./models/Achievement');

dotenv.config();

console.log('🗑️  DATABASE CLEANUP UTILITY');
console.log('============================');
console.log('This will DELETE ALL stored data from MongoDB');
console.log('Collections to clear: Rooms, Users, Wins, Achievements');
console.log('');

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB');
    console.log('');
    
    try {
        // Clear all collections
        const roomsResult = await Room.deleteMany({});
        console.log(`🗑️  Rooms: Deleted ${roomsResult.deletedCount} documents`);
        
        const usersResult = await User.deleteMany({});
        console.log(`🗑️  Users: Deleted ${usersResult.deletedCount} documents`);
        
        const winsResult = await Win.deleteMany({});
        console.log(`🗑️  Wins: Deleted ${winsResult.deletedCount} documents`);
        
        const achievementsResult = await Achievement.deleteMany({});
        console.log(`🗑️  Achievements: Deleted ${achievementsResult.deletedCount} documents`);
        
        console.log('');
        console.log('✅ DATABASE CLEARED SUCCESSFULLY!');
        console.log('All stored data has been removed from MongoDB.');
        console.log('');
        console.log('⚠️  NOTE: Client-side localStorage is NOT cleared by this script.');
        console.log('Users should clear browser cache/localStorage manually or use Ctrl+Shift+Delete');
        
    } catch (e) {
        console.error('❌ Error clearing database:', e);
    } finally {
        mongoose.disconnect();
        console.log('');
        console.log('🔌 Disconnected from MongoDB');
        process.exit(0);
    }
  })
  .catch(err => {
    console.error('❌ MongoDB Connection Failed:', err);
    process.exit(1);
  });
