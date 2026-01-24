// Auth State Management
const Auth = {
    token: localStorage.getItem('token'),
    user: JSON.parse(localStorage.getItem('user')),

    init() {
        this.bindEvents();
        this.checkAuth();
    },

    checkAuth() {
        // Current Page detection
        const path = window.location.pathname;
        const isLoginPage = path.includes('login.html') || path.endsWith('/login');
        const isIntroPage = path.includes('intro.html');
        
        if (isIntroPage) return; // Intro handles its own redirect

        if (this.token) {
            // Already logged in
            if (isLoginPage || path === '/' || path.endsWith('index.html')) {
                window.location.href = 'dashboard.html';
            }
        } else {
            // Not logged in
            if (!isLoginPage) {
                // If trying to access protected pages, redirect to login
                // (Intro redirects to login naturally)
                window.location.href = 'login.html';
            } else {
                // On login page - ensure UI is ready
                const authScreen = document.getElementById('authScreen');
                const lobbyScreen = document.getElementById('lobbyScreen');
                if(authScreen) authScreen.style.display = 'flex';
                if(lobbyScreen) lobbyScreen.style.display = 'none';
            }
        }
    },

    async login(email, password) {
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if (res.ok) {
                this.saveSession(data.token, data.user);
                // Save email separately for profile tracking
                localStorage.setItem('userEmail', data.user.email);
                this.showSuccess('Login Successful!');
                setTimeout(() => this.checkAuth(), 1000);
            } else {
                this.showError(data.message);
            }
        } catch (e) {
            this.showError('Login failed. Server unreachable.');
        }
    },

    async signup(name, email, password) {
        try {
            const res = await fetch('/api/auth/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password })
            });
            const data = await res.json();
            if (res.ok) {
                this.showSuccess('Signup successful! Please login.');
                setTimeout(() => this.toggleTab('login'), 2000);
            } else {
                this.showError(data.message);
            }
        } catch (e) {
            this.showError('Signup failed. Server unreachable.');
        }
    },

    async forgotPassword(email) {
        try {
            const res = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await res.json();
            if (res.ok) {
                document.getElementById('otpEmailInput').style.display = 'none';
                document.getElementById('otpVerifyInput').style.display = 'block';
                
                // If in mock mode, show the OTP
                if (data.mockMode && data.otp) {
                    this.showSuccess(`${data.message}\n\nYour OTP: ${data.otp}`);
                    // Auto-fill OTP for convenience
                    document.getElementById('verifyOtp').value = data.otp;
                } else {
                    this.showSuccess(data.message || 'OTP sent to your email.');
                }
            } else {
                this.showError(data.message);
            }
        } catch (e) {
            this.showError('Failed to send OTP.');
        }
    },

    async resetPassword(email, otp, newPassword) {
        try {
            const res = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, otp, newPassword })
            });
            const data = await res.json();
            if (res.ok) {
                this.showSuccess('Password reset successful! Redirecting to login...');
                setTimeout(() => {
                    this.toggleTab('login');
                    document.getElementById('otpEmailInput').style.display = 'block';
                    document.getElementById('otpVerifyInput').style.display = 'none';
                }, 2000);
            } else {
                this.showError(data.message);
            }
        } catch (e) {
            this.showError('Reset failed.');
        }
    },

    saveSession(token, user) {
        this.token = token;
        this.user = user;
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
    },

    logout() {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        location.reload();
    },

    toggleTab(tab) {
        document.getElementById('loginSection').style.display = tab === 'login' ? 'block' : 'none';
        document.getElementById('signupSection').style.display = tab === 'signup' ? 'block' : 'none';
        document.getElementById('forgotSection').style.display = tab === 'forgot' ? 'block' : 'none';
        document.getElementById('authError').innerText = '';
        document.getElementById('authSuccess').innerText = '';
        
        const titles = { 'login': 'SIGN IN', 'signup': 'CREATE ACCOUNT', 'forgot': 'RESET PASS' };
        document.querySelector('#authScreen .lobby-title').innerText = titles[tab];
    },

    showError(msg) {
        const err = document.getElementById('authError');
        err.innerText = msg;
        err.style.display = 'block';
        setTimeout(() => err.innerText = '', 5000);
    },

    showSuccess(msg) {
        const succ = document.getElementById('authSuccess');
        succ.innerText = msg;
        succ.style.display = 'block';
        setTimeout(() => succ.innerText = '', 5000);
    },

    bindEvents() {
        // Toggle Buttons
        document.getElementById('showSignupBtn').onclick = () => this.toggleTab('signup');
        document.getElementById('showLoginBtn').onclick = () => this.toggleTab('login');
        document.getElementById('showForgotBtn').onclick = () => this.toggleTab('forgot');
        document.getElementById('backToLoginBtn').onclick = () => this.toggleTab('login');

        // Logout
        const lBtn = document.getElementById('logoutBtn');
        if (lBtn) lBtn.onclick = () => this.logout();

        // Action Buttons
        document.getElementById('doLoginAuthBtn').onclick = () => {
            const e = document.getElementById('loginEmail').value;
            const p = document.getElementById('loginPass').value;
            if (e && p) this.login(e, p);
            else this.showError('Please fill all fields');
        };

        document.getElementById('doSignupAuthBtn').onclick = () => {
            const n = document.getElementById('signupName').value;
            const e = document.getElementById('signupEmail').value;
            const p = document.getElementById('signupPass').value;
            if (n && e && p) this.signup(n, e, p);
            else this.showError('Please fill all fields');
        };

        document.getElementById('sendOtpBtn').onclick = () => {
            const e = document.getElementById('forgotEmail').value;
            if (e) this.forgotPassword(e);
            else this.showError('Email required');
        };

        document.getElementById('resetPassBtn').onclick = () => {
            const e = document.getElementById('forgotEmail').value;
            const o = document.getElementById('verifyOtp').value;
            const n = document.getElementById('newPass').value;
            if (o && n) this.resetPassword(e, o, n);
            else this.showError('OTP and New Password required');
        };
    }
};

Auth.init();
