// Visual Effects & Sound Manager
class EffectsManager {
    constructor() {
        this.sounds = {
            bid: null,
            sold: null,
            unsold: null,
            win: null,
            achievement: null,
            notification: null
        };
        this.soundEnabled = true;
        this.init();
    }

    init() {
        this.loadSounds();
        this.setupConfetti();
        this.createSoundToggle();
    }

    loadSounds() {
        // Create audio elements (you'll need to add actual sound files)
        this.sounds.bid = this.createAudio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIGGi77eeeTRAMUKfj8LZjHAY4ktfyzHksBSR3x/DdkEAKFF606+uoVRQKRp/g8r5sIQUrgs7y2Ik2CBlou+3nnk0QDFCn4/C2YxwGOJLX8sx5LAUkd8fw3ZBAC');
        this.sounds.sold = this.createAudio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIGGi77eeeTRAMUKfj8LZjHAY4ktfyzHksBSR3x/DdkEAKFF606+uoVRQKRp/g8r5sIQUrgs7y2Ik2CBlou+3nnk0QDFCn4/C2YxwGOJLX8sx5LAUkd8fw3ZBAC');
        
        // Placeholder - in production, use actual sound files
        console.log('Sound effects initialized (placeholder audio)');
    }

    createAudio(src) {
        const audio = new Audio(src);
        audio.volume = 0.5;
        return audio;
    }

    playSound(type) {
        if (!this.soundEnabled) return;
        
        const sound = this.sounds[type];
        if (sound) {
            sound.currentTime = 0;
            sound.play().catch(e => console.log('Sound play failed:', e));
        }
    }

    setupConfetti() {
        // Load confetti library if not already loaded
        if (typeof confetti === 'undefined') {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js';
            document.head.appendChild(script);
        }
    }

    createSoundToggle() {
        const toggle = document.createElement('button');
        toggle.id = 'soundToggle';
        toggle.className = 'sound-toggle-btn';
        toggle.innerHTML = '<i class="bi bi-volume-up-fill"></i>';
        toggle.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background: rgba(255, 215, 0, 0.2);
            border: 2px solid rgba(255, 215, 0, 0.5);
            color: #FFD700;
            font-size: 1.3rem;
            cursor: pointer;
            z-index: 1000;
            transition: all 0.3s;
            backdrop-filter: blur(10px);
        `;
        
        toggle.onclick = () => this.toggleSound(toggle);
        document.body.appendChild(toggle);
    }

    toggleSound(button) {
        this.soundEnabled = !this.soundEnabled;
        button.innerHTML = this.soundEnabled 
            ? '<i class="bi bi-volume-up-fill"></i>' 
            : '<i class="bi bi-volume-mute-fill"></i>';
        button.style.background = this.soundEnabled 
            ? 'rgba(255, 215, 0, 0.2)' 
            : 'rgba(255, 0, 0, 0.2)';
    }

    // Confetti Effects
    celebrateWin() {
        if (typeof confetti !== 'undefined') {
            confetti({
                particleCount: 100,
                spread: 70,
                origin: { y: 0.6 },
                colors: ['#FFD700', '#FFA500', '#FF6347']
            });
        }
        this.playSound('win');
    }

    celebrateSold() {
        if (typeof confetti !== 'undefined') {
            confetti({
                particleCount: 50,
                angle: 60,
                spread: 55,
                origin: { x: 0 },
                colors: ['#FFD700', '#FFA500']
            });
            confetti({
                particleCount: 50,
                angle: 120,
                spread: 55,
                origin: { x: 1 },
                colors: ['#FFD700', '#FFA500']
            });
        }
        this.playSound('sold');
    }

    celebrateAchievement(rarity = 'common') {
        const colors = {
            common: ['#FFFFFF', '#CCCCCC'],
            rare: ['#4A90E2', '#87CEEB'],
            epic: ['#9B59B6', '#E91E63'],
            legendary: ['#FFD700', '#FF6347', '#FFA500']
        };

        if (typeof confetti !== 'undefined') {
            confetti({
                particleCount: rarity === 'legendary' ? 200 : 100,
                spread: rarity === 'legendary' ? 100 : 70,
                origin: { y: 0.5 },
                colors: colors[rarity] || colors.common,
                ticks: rarity === 'legendary' ? 400 : 200
            });
        }
        this.playSound('achievement');
    }

    screenShake(duration = 500) {
        document.body.style.animation = `shake ${duration}ms`;
        setTimeout(() => {
            document.body.style.animation = '';
        }, duration);
    }

    flashScreen(color = '#FFD700', duration = 200) {
        const flash = document.createElement('div');
        flash.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: ${color};
            opacity: 0.3;
            z-index: 9999;
            pointer-events: none;
            animation: flashFade ${duration}ms;
        `;
        document.body.appendChild(flash);
        setTimeout(() => flash.remove(), duration);
    }

    pulseElement(element, color = '#FFD700') {
        if (!element) return;
        
        element.style.animation = 'pulse 0.5s';
        element.style.boxShadow = `0 0 20px ${color}`;
        
        setTimeout(() => {
            element.style.animation = '';
            element.style.boxShadow = '';
        }, 500);
    }

    showFloatingText(text, x, y, color = '#FFD700') {
        const floater = document.createElement('div');
        floater.textContent = text;
        floater.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y}px;
            color: ${color};
            font-size: 1.5rem;
            font-weight: bold;
            font-family: 'Teko', sans-serif;
            pointer-events: none;
            z-index: 9999;
            animation: floatUp 2s ease-out forwards;
            text-shadow: 0 0 10px ${color};
        `;
        document.body.appendChild(floater);
        setTimeout(() => floater.remove(), 2000);
    }

    rippleEffect(x, y, color = '#FFD700') {
        const ripple = document.createElement('div');
        ripple.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y}px;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            border: 2px solid ${color};
            transform: translate(-50%, -50%);
            pointer-events: none;
            z-index: 9999;
            animation: ripple 1s ease-out forwards;
        `;
        document.body.appendChild(ripple);
        setTimeout(() => ripple.remove(), 1000);
    }
}

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes shake {
        0%, 100% { transform: translateX(0); }
        10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
        20%, 40%, 60%, 80% { transform: translateX(5px); }
    }
    
    @keyframes flashFade {
        0% { opacity: 0.5; }
        100% { opacity: 0; }
    }
    
    @keyframes pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.05); }
    }
    
    @keyframes floatUp {
        0% { opacity: 1; transform: translateY(0); }
        100% { opacity: 0; transform: translateY(-100px); }
    }
    
    @keyframes ripple {
        0% { width: 20px; height: 20px; opacity: 1; }
        100% { width: 200px; height: 200px; opacity: 0; }
    }
`;
document.head.appendChild(style);

// Initialize effects manager
const effects = new EffectsManager();

// Hook into existing events
if (typeof socket !== 'undefined') {
    socket.on('bid_update', () => effects.playSound('bid'));
    socket.on('sale_finalized', (data) => {
        if (data.isUnsold) {
            effects.playSound('unsold');
        } else {
            effects.celebrateSold();
            if (data.soldDetails.soldTeam === mySelectedTeamKey) {
                effects.celebrateWin();
                effects.screenShake(300);
            }
        }
    });
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EffectsManager;
}
