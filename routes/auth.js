const express = require('express');
const router = express.Router();
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

// Helper to send OTP email (Mock if no credentials)
async function sendOTPEmail(email, otp) {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.log(`[MOCK EMAIL] To: ${email}, OTP: ${otp}`);
        return;
    }
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });
    await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Your Password Reset OTP',
        text: `Your OTP is ${otp}. It expires in 10 minutes.`
    });
}

// SIGNUP
router.post('/signup', async (req, res) => {
    try {
        console.log('📝 Signup request received:', { name: req.body.name, email: req.body.email });
        
        const { name, email, password } = req.body;
        
        if (!name || !email || !password) {
            return res.status(400).json({ message: 'All fields are required' });
        }
        
        const existing = await User.findOne({ email });
        if (existing) {
            console.log('⚠️  Email already exists:', email);
            return res.status(400).json({ message: 'Email already exists' });
        }

        console.log('✅ Creating new user...');
        const user = new User({ name, email, password });
        await user.save();
        
        console.log('✅ User created successfully:', email);
        res.status(201).json({ message: 'User created successfully' });
    } catch (e) {
        console.error('❌ Signup error:', e);
        res.status(500).json({ message: e.message });
    }
});

// LOGIN
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user || !(await user.comparePassword(password))) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        const token = jwt.sign({ id: user._id, name: user.name }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { name: user.name, email: user.email } });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// FORGOT PASSWORD
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ message: 'User not found' });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        user.otp = { code: otp, expiresAt: Date.now() + 600000 }; // 10 mins
        await user.save();

        // Try to send email, but don't fail if it doesn't work
        try {
            await sendOTPEmail(email, otp);
            
            // Check if we're in mock mode
            if (!process.env.EMAIL_USER || process.env.EMAIL_USER === 'your_email@gmail.com') {
                // Mock mode - return OTP in response for testing
                console.log('🔐 MOCK MODE - OTP:', otp);
                return res.json({ 
                    message: 'Email not configured. Your OTP is displayed below (for testing only)',
                    otp: otp,
                    mockMode: true
                });
            }
            
            res.json({ message: 'OTP sent to your email' });
        } catch (emailError) {
            console.error('Email send failed:', emailError.message);
            // Email failed, but still return success with OTP for testing
            console.log('🔐 EMAIL FAILED - Showing OTP:', otp);
            res.json({ 
                message: 'Email service unavailable. Your OTP is displayed below (for testing only)',
                otp: otp,
                mockMode: true
            });
        }
    } catch (e) {
        console.error('Forgot password error:', e);
        res.status(500).json({ message: e.message });
    }
});

// RESET PASSWORD
router.post('/reset-password', async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        const user = await User.findOne({ email });
        if (!user || user.otp.code !== otp || user.otp.expiresAt < Date.now()) {
            return res.status(400).json({ message: 'Invalid or expired OTP' });
        }

        user.password = newPassword;
        user.otp = undefined; // Clear OTP
        await user.save();
        res.json({ message: 'Password reset successful' });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// Helper to send Email (Generic)
async function sendEmail(to, subject, text) {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || process.env.EMAIL_PASS === 'your_app_password_here') {
        console.log(`[MOCK EMAIL] To: ${to}, Subject: ${subject}`);
        console.log(`Body: ${text}`);
        console.log("⚠️  To send real emails, please set EMAIL_PASS in your .env file with a Gmail App Password.");
        return;
    }
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });
    await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: to,
        subject: subject,
        text: text
    });
}

// SYNC USER (Login/Signup via Clerk)
router.post('/sync', async (req, res) => {
    try {
        const { name, email, avatar } = req.body;
        let user = await User.findOne({ email });
        
        if (!user) {
            console.log(`🆕 Creating new user from Clerk: ${email}`);
            user = new User({ 
                name: name || 'User', 
                email, 
                password: 'clerk_auth_login', // Dummy password
                avatar: avatar || ''
            });
            await user.save();
        }

        // Check/Send Welcome Email
        if (!user.welcomeEmailSent) {
            console.log(`📧 Sending Welcome Email to ${email}`);
            const welcomeSubject = "Welcome to IPL Auction World";
            const welcomeBody = `Welcome to our world!
            
If you have any errors or doubts, please contact: ipl.live.auction@gmail.com`;

            sendEmail(email, welcomeSubject, welcomeBody).catch(err => console.error(err));
            
            user.welcomeEmailSent = true;
            await user.save();
        }
        
        // ✨ IP Tracking
        const currentIp = req.body.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        user.lastIp = currentIp;
        if (!user.ipHistory) user.ipHistory = [];
        if (!user.ipHistory.includes(currentIp)) {
            user.ipHistory.push(currentIp);
        }
        await user.save();
        
        res.json(user);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// GET PROFILE (by email) - Restore missing route
router.get('/profile/:email', async (req, res) => {
    try {
        let user = await User.findOne({ email: req.params.email }).select('-password -otp');
        if (!user) {
            // Create user on the fly if using Clerk and not in DB
            console.log(`⚠️ User not found in GET /profile, creating placeholder: ${req.params.email}`);
            user = new User({ 
                name: 'Guest User', 
                email: req.params.email, 
                password: 'placeholder_password', 
                avatar: '' 
            });
            await user.save();
        }
        res.json(user);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// SEARCH USERS
router.get('/search', async (req, res) => {
    try {
        const { query } = req.query;
        if (!query || query.length < 2) {
            return res.status(400).json({ message: 'Search query too short' });
        }
        
        const users = await User.find({
            $or: [
                { name: { $regex: query, $options: 'i' } },
                { email: { $regex: query, $options: 'i' } }
            ]
        }).select('name email avatar stats').limit(10);
        
        res.json(users);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// UPDATE PROFILE
router.put('/profile', async (req, res) => {
    try {
        const { email, avatar, name } = req.body;
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        if (avatar) user.avatar = avatar;
        if (name) user.name = name;
        
        await user.save();
        res.json({ message: 'Profile updated successfully', user: { name: user.name, email: user.email, avatar: user.avatar } });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// UPDATE STATS (called after tournament)
router.post('/update-stats', async (req, res) => {
    try {
        const { email, won } = req.body;
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        if (!user.stats) {
            user.stats = { matchesPlayed: 0, matchesWon: 0, auctionsParticipated: 0 };
        }
        
        user.stats.matchesPlayed += 1;
        user.stats.auctionsParticipated += 1;
        if (won) user.stats.matchesWon += 1;
        
        await user.save();
        res.json({ message: 'Stats updated successfully' });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// ADD AUCTION HISTORY
router.post('/add-auction-history', async (req, res) => {
    try {
        const { email, roomId, teamName, result, squad } = req.body;
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        if (!user.auctionHistory) {
            user.auctionHistory = [];
        }
        
        user.auctionHistory.push({
            roomId,
            teamName,
            date: new Date(),
            result,
            squad
        });
        
        await user.save();
        res.json({ message: 'Auction history added successfully' });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// CLEAR SQUAD (remove specific auction history)
router.delete('/clear-squad/:email/:roomId', async (req, res) => {
    try {
        const { email, roomId } = req.params;
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        user.auctionHistory = user.auctionHistory.filter(auction => auction.roomId !== roomId);
        await user.save();
        
        res.json({ message: 'Squad cleared successfully' });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// ✨ AUTH SESSION SYNC (MongoDB storage for LocalStorage data)
router.get('/session/get/:email', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.params.email });
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json(user.session || {});
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

router.post('/session/sync', async (req, res) => {
    try {
        const { email, session } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ message: 'User not found' });

        // Update session fields
        if (!user.session) user.session = {};
        
        // Merge session data
        if (session.playerId) user.session.playerId = session.playerId;
        if (session.activeRoomId) user.session.activeRoomId = session.activeRoomId;
        if (session.activeTeamKey) user.session.activeTeamKey = session.activeTeamKey;
        if (session.lastRoomId) user.session.lastRoomId = session.lastRoomId;
        if (session.lastPass) user.session.lastPass = session.lastPass;
        
        if (session.teamKeys) {
            if (!user.session.teamKeys) user.session.teamKeys = new Map();
            for (const [key, value] of Object.entries(session.teamKeys)) {
                user.session.teamKeys.set(key, value);
            }
        }

        await user.save();
        res.json({ message: 'Session synced with MongoDB', session: user.session });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

module.exports = router;