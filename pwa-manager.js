// PWA Install Manager
class PWAManager {
    constructor() {
        this.deferredPrompt = null;
        this.isInstalled = false;
        this.init();
    }

    init() {
        // Register service worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/service-worker.js')
                .then(reg => console.log('✅ Service Worker registered:', reg))
                .catch(err => console.log('❌ Service Worker registration failed:', err));
        }

        // Listen for install prompt
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            this.showInstallButton();
        });

        // Check if already installed
        window.addEventListener('appinstalled', () => {
            console.log('✅ PWA installed successfully!');
            this.isInstalled = true;
            this.hideInstallButton();
        });

        // Detect if running as PWA
        if (window.matchMedia('(display-mode: standalone)').matches) {
            this.isInstalled = true;
            console.log('📱 Running as PWA');
        }
    }

    showInstallButton() {
        // Create install button if it doesn't exist
        if (document.getElementById('pwa-install-btn')) return;

        const installBtn = document.createElement('button');
        installBtn.id = 'pwa-install-btn';
        installBtn.className = 'pwa-install-button';
        installBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Install App
        `;
        installBtn.onclick = () => this.installPWA();

        document.body.appendChild(installBtn);

        // Show toast notification
        this.showToast('📱 Install this app for a better experience!');
    }

    hideInstallButton() {
        const btn = document.getElementById('pwa-install-btn');
        if (btn) btn.remove();
    }

    async installPWA() {
        if (!this.deferredPrompt) return;

        // Show install prompt
        this.deferredPrompt.prompt();

        // Wait for user choice
        const { outcome } = await this.deferredPrompt.userChoice;
        console.log(`User response: ${outcome}`);

        if (outcome === 'accepted') {
            this.showToast('✅ App installed! Check your home screen.');
        }

        this.deferredPrompt = null;
        this.hideInstallButton();
    }

    showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'pwa-toast';
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => toast.classList.add('show'), 100);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    // Check online/offline status
    checkConnectionStatus() {
        const updateOnlineStatus = () => {
            if (navigator.onLine) {
                this.showToast('🟢 Back online!');
            } else {
                this.showToast('🔴 You are offline. Some features may be limited.');
            }
        };

        window.addEventListener('online', updateOnlineStatus);
        window.addEventListener('offline', updateOnlineStatus);
    }

    // Request notification permission
    async requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                this.showToast('🔔 Notifications enabled!');
            }
        }
    }
}

// Auto-initialize PWA manager
const pwaManager = new PWAManager();
pwaManager.checkConnectionStatus();

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PWAManager;
}
