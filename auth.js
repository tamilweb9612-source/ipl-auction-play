// Clerk Auth Integration
const CLERK_PUBLISHABLE_KEY = "pk_test_dGVuZGVyLWtpdC0xMi5jbGVyay5hY2NvdW50cy5kZXYk";
const CLERK_SCRIPT_URL = "https://tender-kit-12.clerk.accounts.dev/npm/@clerk/clerk-js@latest/dist/clerk.browser.js";

const Auth = {
  clerk: null,

  async init() {
    try {
        await this.loadClerkScript();
        await this.initializeClerk();
        this.bindLogout();
    } catch (e) {
        console.error("Clerk Validation Failed", e);
    }
  },

  loadClerkScript() {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${CLERK_SCRIPT_URL}"]`)) {
        return resolve();
      }
      const script = document.createElement("script");
      script.setAttribute("data-clerk-publishable-key", CLERK_PUBLISHABLE_KEY);
      script.async = true;
      script.crossOrigin = "anonymous";
      script.src = CLERK_SCRIPT_URL;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  },

  async initializeClerk() {
    const Clerk = window.Clerk;
    if (!Clerk) return;

    try {
        await Clerk.load();
    } catch(e) {
        console.error("Clerk load error", e);
        return;
    }
    
    this.clerk = Clerk;

    if (Clerk.user) {
        // Logged In
        // Logged In
        const email = Clerk.user.primaryEmailAddress.emailAddress;
        localStorage.setItem("userEmail", email);
        
        const token = await Clerk.session?.getToken();
        if(token) localStorage.setItem("token", token);
        
        // ✨ Fetch IP for Tracking
        let userIp = "Unknown";
        try {
            const ipRes = await fetch('https://api.ipify.org?format=json');
            const ipData = await ipRes.json();
            userIp = ipData.ip;
            localStorage.setItem("user_last_ip", userIp);
        } catch(ipErr) { console.warn("Could not fetch IP", ipErr); }

        // Fetch latest profile from DB via Sync (creates user if new & sends welcome email)
        try {
            const res = await fetch('/api/auth/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: Clerk.user.fullName || Clerk.user.firstName || "User",
                    email: email,
                    avatar: Clerk.user.imageUrl || "",
                    ip: userIp
                })
            });
            
            if (res.ok) {
                const dbUser = await res.json();
                localStorage.setItem("user", JSON.stringify({
                     name: dbUser.name,
                     email: dbUser.email,
                     id: Clerk.user.id,
                     avatar: dbUser.avatar
                }));
                
                // ✨ Store playerId for auto-reconnect feature
                const pid = Clerk.user.id.startsWith("user_") ? Clerk.user.id : "user_" + Clerk.user.id;
                localStorage.setItem("ipl_auction_player_id", pid);
            } else {
                 // Fallback
                 localStorage.setItem("user", JSON.stringify({
                     name: Clerk.user.fullName || Clerk.user.firstName || "User",
                     email: email,
                     id: Clerk.user.id
                }));
                 
                 // ✨ Store playerId for auto-reconnect feature
                 const pid = Clerk.user.id.startsWith("user_") ? Clerk.user.id : "user_" + Clerk.user.id;
                 localStorage.setItem("ipl_auction_player_id", pid);
            }
        } catch(e) {
             // Fallback on error
             localStorage.setItem("user", JSON.stringify({
                 name: Clerk.user.fullName || Clerk.user.firstName || "User",
                 email: email,
                 id: Clerk.user.id
            }));
             
             // ✨ Store playerId for auto-reconnect feature
             const pid = Clerk.user.id.startsWith("user_") ? Clerk.user.id : "user_" + Clerk.user.id;
             localStorage.setItem("ipl_auction_player_id", pid);
        }

        await this.handleLoggedIn();
    } else {
        // Not Logged In
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        localStorage.removeItem("userEmail");
        this.handleLoggedOut();
  }
},

  async handleLoggedIn() {
    const path = window.location.pathname;
    const email = this.clerk.user.primaryEmailAddress.emailAddress;

    // ✨ Step 1: Sync from MongoDB to LocalStorage on login
    try {
        console.log("☁️  Fetching session from MongoDB...");
        const response = await fetch(`/api/auth/session/get/${email}`);
        if (response.ok) {
            const session = await response.json();
            
            // Strip any legacy double-prefixes if found in MongoDB session
            if (session.playerId) {
                let pid = session.playerId;
                if (pid.startsWith("user_user_")) pid = pid.replace("user_user_", "user_");
                localStorage.setItem("ipl_auction_player_id", pid);
            }
            if (session.activeRoomId) localStorage.setItem("auto_reconnect_room", session.activeRoomId);
            if (session.activeTeamKey) localStorage.setItem("auto_reconnect_team", session.activeTeamKey);
            if (session.lastRoomId) localStorage.setItem("ipl_last_room", session.lastRoomId);
            if (session.lastPass) localStorage.setItem("ipl_last_pass", session.lastPass);
            
            if (session.teamKeys) {
                for (const [roomId, key] of Object.entries(session.teamKeys)) {
                    localStorage.setItem(`ipl_team_${roomId}`, key);
                }
            }
            console.log("✅ Session restored from MongoDB");
        }
    } catch (err) {
        console.error("❌ Failed to load session from MongoDB", err);
    }
    
    // Check for active auction room before redirecting
    if (path.includes("login.html") || path.includes("intro.html") || path === "/" || (path.endsWith("/") && !path.includes("dashboard")) || path.includes("dashboard.html")) {
        // User just logged in or is on dashboard - check if they have an active auction
        this.checkAndReconnectToAuction();
    }
    
    // Update UI elements if present (e.g. welcome message)
    const welcome = document.getElementById("userWelcome");
    if (welcome && this.clerk.user) {
        welcome.innerText = "WELCOME, " + (this.clerk.user.firstName || "USER");
    }
    const emailDisplay = document.getElementById("userEmailDisplay");
    if (emailDisplay && this.clerk.user) {
        emailDisplay.innerText = email;
    }
  },

  // ✨ Helper to sync LocalStorage TO MongoDB
  async syncSessionToMongoDB() {
      const user = JSON.parse(localStorage.getItem("user"));
      if (!user || !user.email) return;

      const sessionData = {
          email: user.email,
          session: {
              playerId: localStorage.getItem("ipl_auction_player_id"),
              activeRoomId: localStorage.getItem("auto_reconnect_room"),
              activeTeamKey: localStorage.getItem("auto_reconnect_team"),
              lastRoomId: localStorage.getItem("ipl_last_room"),
              lastPass: localStorage.getItem("ipl_last_pass"),
              teamKeys: {}
          }
      };

      // Find all room team keys
      for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key.startsWith("ipl_team_")) {
              const roomId = key.replace("ipl_team_", "");
              sessionData.session.teamKeys[roomId] = localStorage.getItem(key);
          }
      }

      try {
          await fetch("/api/auth/session/sync", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(sessionData)
          });
          console.log("☁️  Session synced to MongoDB");
      } catch (err) {
          console.error("❌ MongoDB sync failed", err);
      }
  },

  // NEW: Check for active auction and auto-reconnect
  checkAndReconnectToAuction() {
    const pid = localStorage.getItem("ipl_auction_player_id");
    if (!pid) return; // Cannot check without PID

    // Create temporary socket connection to check for active room
    const tempSocket = io({
      transports: ["websocket"],
      auth: {
        playerId: pid
      }
    });

    tempSocket.on("connect", () => {
      tempSocket.emit("check_active_room");
    });

    tempSocket.on("active_room_found", (data) => {
      console.log("🔄 Active auction found! Auto-reconnecting...", data);
      
      // Store room info for auto-join
      localStorage.setItem("auto_reconnect_room", data.roomId);
      localStorage.setItem("auto_reconnect_team", data.teamKey);
      
      // Disconnect temp socket
      tempSocket.disconnect();
      
      // Redirect based on auction state
      if (data.auctionState === "SQUAD_SELECTION" || data.auctionState === "RESULTS") {
        // Go to play.html for tournament
        window.location.href = "play.html";
      } else {
        // Go to auction page (ipl.html or blind-auction.html)
        if (data.gameType === "blind") {
          window.location.href = "blind-auction.html";
        } else {
          window.location.href = "ipl.html";
        }
      }
    });

    tempSocket.on("no_active_room", () => {
      console.log("ℹ️ No active auction found.");
      tempSocket.disconnect();
      // No active room - go to dashboard normally if not already there
      if (!window.location.pathname.includes("dashboard.html")) {
        window.location.href = "dashboard.html";
      }
    });

    // Timeout fallback
    setTimeout(() => {
      if (tempSocket.connected) {
        tempSocket.disconnect();
        if (!window.location.pathname.includes("dashboard.html")) {
          window.location.href = "dashboard.html";
        }
      }
    }, 3000);
  },

  handleLoggedOut() {
    const path = window.location.pathname;
    
    // If we are on login.html, we might want to mount it OR open modal if user prefers popup
    // User requested "pop up" specifically after intro.
    // For login.html, let's keep the mounted version as a fallback, OR redirect to intro/dashboard?
    // Actually, if I change intro to open modal, login.html might not be needed.
    
    if (path.includes("login.html")) {
        const signInDiv = document.getElementById("clerk-sign-in");
        if (signInDiv) {
            this.clerk.mountSignIn(signInDiv, {
                signInUrl: 'login.html',
                signUpUrl: 'login.html',
                afterSignInUrl: 'dashboard.html',
                afterSignUpUrl: 'dashboard.html', // Fix: Go to dashboard after signup
                routing: 'virtual', // Keeps it in the same place
                appearance: {
                   variables: {
                     colorPrimary: '#FFD700', 
                     colorText: '#000000',
                     colorBackground: '#ffffff',
                     colorInputBackground: '#f2f2f2',
                     colorInputText: '#000000'
                   }
                }
            });
        }
    } else {
        const protectedPages = ["dashboard.html", "ipl.html", "blind-auction.html", "profile.html", "play.html"];
        const isProtected = protectedPages.some(p => path.includes(p));
        if (isProtected) {
            window.location.href = "intro.html"; // Redirect to intro for flow
        }
    }
  },
  
  // NEW: Function to be called from Intro or anywhere else to open the Modal
  openAuthModal() {
      if (!this.clerk) return;
      this.clerk.openSignIn({
          afterSignInUrl: 'dashboard.html',
          afterSignUpUrl: 'dashboard.html',
          appearance: {
              variables: {
                  colorPrimary: '#FFD700',
                  colorText: '#000000',
                  colorBackground: '#ffffff',
                  colorInputBackground: '#f2f2f2',
                  colorInputText: '#000000',
                  colorTextSecondary: '#666666'
              },
              elements: {
                  modalContent: {
                      backgroundColor: "#ffffff",
                      borderRadius: "1.5rem",
                      boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
                      border: "none",
                      padding: "20px"
                  },
                  card: {
                      boxShadow: "none" // Remove default card shadow
                  }
              }
          }
      });
  },
  
  bindLogout() {
      const btn = document.getElementById("logoutBtn");
      if(btn) {
          btn.onclick = (e) => {
              e.preventDefault();
              this.logout();
          };
      }
  },
  
  async logout() {
      if(this.clerk) {
          await this.clerk.signOut();
          localStorage.clear();
          window.location.href = "intro.html"; // Go back to intro
      }
  }
};

window.Auth = Auth;
Auth.init();
