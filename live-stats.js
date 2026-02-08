// Live Auction Statistics Dashboard
class LiveStatsManager {
    constructor() {
        this.stats = {
            mostExpensivePlayer: { name: '', price: 0, team: '' },
            hottestTeam: { name: '', bidCount: 0 },
            averagePrice: 0,
            totalSpent: 0,
            playersSold: 0,
            playersUnsold: 0,
            auctionStartTime: Date.now(),
            budgetRemaining: {},
            recentSales: []
        };
        this.isMinimized = false;
        this.init();
    }

    init() {
        this.createDashboard();
        this.attachEventListeners();
    }

    createDashboard() {
        const dashboard = document.createElement('div');
        dashboard.id = 'liveStatsDashboard';
        dashboard.className = 'live-stats-dashboard';
        dashboard.innerHTML = `
            <div class="stats-header">
                <div class="stats-title">📊 Live Stats</div>
                <button class="stats-toggle" onclick="liveStats.toggle()">
                    <i class="bi bi-dash-circle"></i>
                </button>
            </div>
            <div class="stats-content">
                <div class="stat-item gold">
                    <div class="stat-label">💰 Most Expensive</div>
                    <div class="stat-value" id="statMostExpensive">---</div>
                    <div class="stat-subvalue" id="statMostExpensiveTeam"></div>
                </div>
                
                <div class="stat-item blue">
                    <div class="stat-label">🔥 Hottest Team</div>
                    <div class="stat-value" id="statHottestTeam">---</div>
                    <div class="stat-subvalue" id="statHottestBids"></div>
                </div>
                
                <div class="stat-item green">
                    <div class="stat-label">📈 Average Price</div>
                    <div class="stat-value" id="statAvgPrice">₹0</div>
                    <div class="stat-subvalue">
                        <span id="statTotalSold">0</span> players sold
                    </div>
                </div>
                
                <div class="stat-item purple">
                    <div class="stat-label">⏱️ Auction Duration</div>
                    <div class="stat-value" id="statDuration">00:00</div>
                </div>
                
                <div class="stat-item purple" style="border-left: 4px solid #9c27b0;">
                    <div class="stat-label">🎯 Predict Game</div>
                    <div class="stat-value" style="font-size: 1rem; margin-top:0;" id="statPredictLeaderboard"></div>
                </div>
            </div>
        `;
        
        document.body.appendChild(dashboard);
        
        // Start duration timer
        this.startDurationTimer();
    }

    attachEventListeners() {
        // Listen to auction events
        if (typeof socket !== 'undefined') {
            // Normal Auction Events
            socket.on('sale_finalized', (data) => this.updateOnSale(data));
            socket.on('bid_update', (data) => this.updateOnBid(data));
            socket.on('predict_leaderboard_update', (data) => this.updatePredictLeaderboard(data));

            // Blind Auction Events
            socket.on('exchange_finalized', (data) => {
                // Determine details from data message or team roster
                // Since data only contains teams and a message, we parse the message or find the last added player
                this.updateOnBlindSale(data);
            });
            // Listen for individual blind bids if we want "hottest team" to work
            // Note: Blind bids are secret, so we might only count them after reveal or approximate 'activity'
            socket.on('bids_revealed', (data) => this.updateOnBlindReveal(data));
        }
    }

    updateOnSale(data) {
        if (data.isUnsold) {
            this.stats.playersUnsold++;
        } else {
            this.stats.playersSold++;
            this.stats.totalSpent += data.price;
            
            // Update most expensive
            if (data.price > this.stats.mostExpensivePlayer.price) {
                this.stats.mostExpensivePlayer = {
                    name: data.soldPlayer.name,
                    price: data.price,
                    team: data.soldDetails.soldTeam
                };
            }
            
            // Add to recent sales
            this.stats.recentSales.push({
                player: data.soldPlayer.name,
                price: data.price,
                team: data.soldDetails.soldTeam
            });
            if (this.stats.recentSales.length > 5) {
                this.stats.recentSales.shift();
            }
            
            // Calculate average
            this.stats.averagePrice = this.stats.totalSpent / this.stats.playersSold;
        }
        
        this.render();
    }

    updateOnBid(data) {
        const teamName = data.teamName || (data.team ? data.team.name : 'Unknown');
        // Track hottest team
        if (!this.stats.budgetRemaining[teamName]) {
            this.stats.budgetRemaining[teamName] = { bidCount: 0 };
        }
        this.stats.budgetRemaining[teamName].bidCount++;
        
        // Find hottest team
        let maxBids = 0;
        let hottestTeam = '';
        for (const [team, info] of Object.entries(this.stats.budgetRemaining)) {
            if (info.bidCount > maxBids) {
                maxBids = info.bidCount;
                hottestTeam = team;
            }
        }
        
        this.stats.hottestTeam = { name: hottestTeam, bidCount: maxBids };
        this.render();
    }

    updateOnBlindSale(data) {
        // Extract sold player and price from the updated teams data
        // We find the team that just bought a player (status SOLD, high index)
        let found = false;
        
        data.teams.forEach(team => {
            if (found) return;
            if (team.roster && team.roster.length > 0) {
                const lastPlayer = team.roster[team.roster.length - 1];
                // Check if this player is "new" to our stats (simplistic check)
                const isRecorded = this.stats.recentSales.some(s => s.player === lastPlayer.name);
                
                if (!isRecorded && lastPlayer.status === 'SOLD') {
                     this.stats.playersSold++;
                     this.stats.totalSpent += lastPlayer.price;

                     if (lastPlayer.price > this.stats.mostExpensivePlayer.price) {
                         this.stats.mostExpensivePlayer = {
                             name: lastPlayer.name,
                             price: lastPlayer.price,
                             team: team.name
                         };
                     }

                     this.stats.recentSales.push({
                         player: lastPlayer.name,
                         price: lastPlayer.price,
                         team: team.name
                     });
                     if (this.stats.recentSales.length > 5) this.stats.recentSales.shift();
                     
                     this.stats.averagePrice = this.stats.totalSpent / this.stats.playersSold;
                     found = true;
                }
            }
        });
        
        if (!found) {
             // Maybe it was unsold?
             // Since exchange_finalized implies a sale usually, but let's be safe.
        }

        this.render();
    }

    updateOnBlindReveal(data) {
        // data.bids is an array of { teamName, amount, ... }
        if (data.bids) {
            data.bids.forEach(bid => {
                if (bid.amount > 0) {
                     if (!this.stats.budgetRemaining[bid.teamName]) {
                        this.stats.budgetRemaining[bid.teamName] = { bidCount: 0 };
                    }
                    this.stats.budgetRemaining[bid.teamName].bidCount++;
                }
            });
            
             // Recalculate hottest team
            let maxBids = 0;
            let hottestTeam = '';
            for (const [team, info] of Object.entries(this.stats.budgetRemaining)) {
                if (info.bidCount > maxBids) {
                    maxBids = info.bidCount;
                    hottestTeam = team;
                }
            }
            this.stats.hottestTeam = { name: hottestTeam, bidCount: maxBids };
            this.render();
        }
    }

    render() {
        if (this.isMinimized) return;
        
        // Most Expensive
        document.getElementById('statMostExpensive').innerText = 
            this.stats.mostExpensivePlayer.name || '---';
        document.getElementById('statMostExpensiveTeam').innerText = 
            this.stats.mostExpensivePlayer.price > 0 
                ? `${formatAmount(this.stats.mostExpensivePlayer.price)} - ${this.stats.mostExpensivePlayer.team}`
                : '';
        
        // Hottest Team
        document.getElementById('statHottestTeam').innerText = 
            this.stats.hottestTeam.name || '---';
        document.getElementById('statHottestBids').innerText = 
            this.stats.hottestTeam.bidCount > 0 
                ? `${this.stats.hottestTeam.bidCount} bids placed`
                : '';
        
        // Average Price
        document.getElementById('statAvgPrice').innerText = 
            this.stats.averagePrice > 0 ? formatAmount(this.stats.averagePrice) : '₹0';
        document.getElementById('statTotalSold').innerText = this.stats.playersSold;
        
        // Prediction Game Stats
        const predictContainer = document.getElementById('statPredictLeaderboard');
        if (predictContainer) {
            if (this.stats.topPredictors && this.stats.topPredictors.length > 0) {
                predictContainer.innerHTML = this.stats.topPredictors.map((p, i) => `
                    <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
                        <span>#${i+1} ${p.name}</span>
                        <span class="text-warning">${p.score} pts</span>
                    </div>
                `).join('');
            } else {
                predictContainer.innerHTML = '<div style="opacity:0.7">No scores yet</div>';
            }
        }
    }
    
    // updatePredictLeaderboard (Added method)
    updatePredictLeaderboard(data) {
        // data.scores is a Map or Object { teamId: score }
        // data.teamNames is { teamId: name }
        
        let scores = [];
        if (data.scores instanceof Map) {
            data.scores.forEach((score, id) => {
                 scores.push({ name: data.teamNames[id] || 'Unknown', score: score });
            });
        } else {
            Object.entries(data.scores).forEach(([id, score]) => {
                scores.push({ name: data.teamNames[id] || 'Unknown', score: score });
            });
        }
        
        // Sort by score desc
        scores.sort((a, b) => b.score - a.score);
        
        // Take top 2
        this.stats.topPredictors = scores.slice(0, 2);
        this.render();
    }

    startDurationTimer() {
        setInterval(() => {
            const duration = Date.now() - this.stats.auctionStartTime;
            const minutes = Math.floor(duration / 60000);
            const seconds = Math.floor((duration % 60000) / 1000);
            document.getElementById('statDuration').innerText = 
                `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }, 1000);
    }

    toggle() {
        this.isMinimized = !this.isMinimized;
        const dashboard = document.getElementById('liveStatsDashboard');
        dashboard.classList.toggle('minimized');
        
        const icon = dashboard.querySelector('.stats-toggle i');
        icon.className = this.isMinimized ? 'bi bi-plus-circle' : 'bi bi-dash-circle';
    }

    reset() {
        this.stats = {
            mostExpensivePlayer: { name: '', price: 0, team: '' },
            hottestTeam: { name: '', bidCount: 0 },
            averagePrice: 0,
            totalSpent: 0,
            playersSold: 0,
            playersUnsold: 0,
            auctionStartTime: Date.now(),
            budgetRemaining: {},
            recentSales: []
        };
        this.render();
    }
}

// Initialize when auction starts
let liveStats = null;

// Auto-initialize when auction dashboard is shown
const originalAuctionStart = document.getElementById('auctionDashboard');
if (originalAuctionStart) {
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.target.style.display !== 'none' && !liveStats) {
                liveStats = new LiveStatsManager();
            }
        });
    });
    observer.observe(originalAuctionStart, { attributes: true, attributeFilter: ['style'] });
}
