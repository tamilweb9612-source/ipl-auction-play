// ======================================================
// 🔄 TRADE SYSTEM (Client Side)
// ======================================================

class TradeSystem {
  constructor() {
    this.isOpen = false;
    this.teams = [];
    this.myTeam = null;
    this.tradeHistory = [];
    this.activeProposals = [];
    this.selectedTargetTeam = null;
    this.listenersAttached = false;
    this.currentCategoryFilter = "all"; // Default filter
    this.init();
  }

  // --- FILTER LOGIC ---
  setPlayerFilter(category) {
      this.currentCategoryFilter = category.toLowerCase();
      // Re-render both squads
      this.renderMySquad();
      if(this.selectedTargetTeam) {
          this.onTargetTeamChange(this.selectedTargetTeam.bidKey);
      }
      // Update UI buttons if they exist
      document.querySelectorAll('.filter-btn').forEach(btn => {
          if(btn.dataset.filter === this.currentCategoryFilter) {
              btn.classList.remove('btn-outline-secondary');
              btn.classList.add('btn-success');
          } else {
              btn.classList.add('btn-outline-secondary');
              btn.classList.remove('btn-success');
          }
      });
  }

  applyFilter(roster) {
      if(!roster) return [];
      if(this.currentCategoryFilter === 'all') return roster;
      return roster.filter(p => {
          const role = (p.roleKey || p.role || "").toLowerCase();
          const cat = (p.category || "").toLowerCase();
          // Map simplified categories
          if(this.currentCategoryFilter === 'batsman') return role.includes('bat') || role.includes('batter');
          if(this.currentCategoryFilter === 'wick') return role.includes('wk') || role.includes('wicket');
          if(this.currentCategoryFilter === 'spinner') return role.includes('spin') || cat.includes('spin');
          if(this.currentCategoryFilter === 'fast bowler') return role.includes('fast') || role.includes('pace') || cat.includes('fast');
          if(this.currentCategoryFilter === 'all rounder') return role.includes('all') || role.includes('ar');
          if(this.currentCategoryFilter === 'bowler') return role.includes('bowl') || role.includes('pacer') || role.includes('spinner');
          return true;
      });
  }

  init() {
    // Initialize when socket is ready
    if (window.socket) {
      this.setupSocketListeners();
    } else {
      document.addEventListener("DOMContentLoaded", () =>
        this.setupSocketListeners(),
      );
    }

    // Add Trade Button if not exists (in case HTML didn't add it)
    this.ensureTradeButton();
  
    // FIX: Ensure Modal Cleanup
    const modalEl = document.getElementById("tradeCenterModal");
    if (modalEl) {
        modalEl.addEventListener('hidden.bs.modal', () => {
            this.isOpen = false;
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
            const backdrops = document.querySelectorAll('.modal-backdrop');
            backdrops.forEach(b => b.remove());
        });
    }
  }

  setupSocketListeners() {
    const socket = window.socket;

    socket.on("trade_system_init", (data) => {
      this.teams = data.teams;
      this.activeProposals = data.proposals || [];
      this.updateTradeUI();
    });

    socket.on("trade_update", (data) => {
      if (data.teams) this.teams = data.teams;
      if (data.proposals) this.activeProposals = data.proposals;
      this.updateTradeUI();

      // Refresh main specific UI if open
      if (this.isOpen) {
        this.renderTradeCenter();
      }
    });

    socket.on("trade_notification", (msg) => {
      // Show toaster notification (Top Right)
      // Check if it's an offer/proposal to link to 'my' offers tab
      const isProposal = msg.toLowerCase().includes("proposal") || msg.toLowerCase().includes("offer");
      
      this.showNotification(msg, "info", isProposal ? () => this.openTradeCenter('my') : null);

      // Log to existing system if available
      if (typeof logEvent === "function") {
        logEvent(`🔔 TRADE: ${msg}`, true);
      }
      if (!this.isOpen && isProposal) {
        const btn = document.getElementById("tradeCenterBtn");
        if (btn) btn.classList.add("btn-pulse-green");
      }

      // Detect Completion Msg to show summary
      // Msg format usually: "Trade completed between X and Y"
      if (msg.toLowerCase().includes("trade completed")) {
        this.triggerTradeSummaryIfRelevant();
      }
    });

    socket.on("trade_history", (history) => {
      this.tradeHistory = history;
      this.renderHistory();
    });

    // Request init data when joining
    socket.emit("init_trade_system");
  }

  ensureTradeButton() {
    // We will manually add the button in the header if it's missing
    // or attach listener if it exists
    const btn = document.getElementById("tradeCenterBtn");
    if (btn) {
      btn.addEventListener("click", () => this.openTradeCenter());
    }
  }

  openTradeCenter(tabName = 'create') {
    this.isOpen = true;
    
    // Ensure modal exists safely
    const modalEl = document.getElementById("tradeCenterModal");
    let modal = bootstrap.Modal.getInstance(modalEl);
    if(!modal) modal = new bootstrap.Modal(modalEl);
    modal.show();

    // Remove pulse if active
    const btn = document.getElementById("tradeCenterBtn");
    if (btn) btn.classList.remove("btn-pulse-green");

    // Refresh data
    if (window.socket) {
        window.socket.emit("init_trade_system");
        window.socket.emit("request_trade_history");
    }
    
    // Default to passed tab, or 'my' if we have incoming offers and no specific tab requested
    // Logic: if tabName is default 'create', but we have incoming proposals, maybe switch to 'my'?
    // For now, respect the argument.
    this.switchTradeTab(tabName);
    
    // this.renderTradeCenter(); // switchTradeTab calls render
    this.addDynamicListeners();
  }

  switchTradeTab(tab) {
    if (window.switchTradeTab) {
       window.switchTradeTab(tab);
       return;
    }
    // Fallback if global not found
    this.renderTradeCenter();
  }

  renderTradeCenter() {
    // 1. Identify My Team
    this.myTeam = this.teams.find((t) => t.bidKey === window.mySelectedTeamKey);
    if (!this.myTeam) {
      document.getElementById("tradeMainContent").innerHTML =
        '<div class="text-center text-white-50 p-5">You must join a team to trade!</div>';
      return;
    }

    this.renderMySquad();
    this.renderMySquad();
    this.renderTargetSelection();
    this.renderSummaryBox();
  }

  renderMySquad() {
    const container = document.getElementById("myTradeSquad");
    if (!container) return;

    container.innerHTML = "";
    if (!this.myTeam.roster || this.myTeam.roster.length === 0) {
      container.innerHTML =
        '<div class="text-white-50 small p-3">Your squad is empty. Buy players first!</div>';
      return;
    }

    let filteredRoster = this.applyFilter(this.myTeam.roster);
    
    // SORTING: Price Descending
    filteredRoster.sort((a, b) => (b.price || 0) - (a.price || 0));

    if(filteredRoster.length === 0) {
         container.innerHTML = '<div class="text-white-50 small p-3">No players match filter.</div>';
         return;
    }

    filteredRoster.forEach((p) => {
      const div = document.createElement("div");
      div.className = "trade-player-card";
      div.onclick = () => this.toggleSelection(div, p.name, "my");
      const pid = `p-my-${this.sanitizeId(p.name)}`;
      div.innerHTML = `
                <input type="checkbox" class="player-checkbox" id="${pid}" data-name="${p.name}" style="pointer-events: none;">
                <div class="player-info">
                    <div class="player-name">${p.name}</div>
                    <div class="player-role">${p.roleKey}</div>
                </div>
                <div class="player-price">${this.formatMoney(p.price)}</div>
            `;
      container.appendChild(div);
    });
  }

  renderTargetSelection() {
    const select = document.getElementById("targetTeamSelect");
    if (!select) return;

    // Save current selection
    const currentVal = select.value;

    select.innerHTML = '<option value="">Select Target Team...</option>';
    this.teams.forEach((t) => {
      if (t.bidKey !== this.myTeam.bidKey && t.isTaken) {
        const opt = document.createElement("option");
        opt.value = t.bidKey;
        opt.innerText = `${t.name} (${this.formatMoney(t.budget || 0)})`;
        select.appendChild(opt);
      }
    });

    select.value = currentVal;
    select.onchange = () => this.onTargetTeamChange(select.value);

    // If value exists, render their squad
    if (currentVal) this.onTargetTeamChange(currentVal);
  }

  onTargetTeamChange(teamKey) {
    this.selectedTargetTeam = this.teams.find((t) => t.bidKey === teamKey);
    const container = document.getElementById("targetTradeSquad");
    if (!container) return;

    container.innerHTML = "";

    if (!this.selectedTargetTeam) return;

    if (
      !this.selectedTargetTeam.roster ||
      this.selectedTargetTeam.roster.length === 0
    ) {
      container.innerHTML =
        '<div class="text-white-50 small p-3">Their squad is empty.</div>';
      return;
    }
    
    // Apply Filter AND Sort
    let targetFiltered = this.applyFilter(this.selectedTargetTeam.roster);
    targetFiltered.sort((a, b) => (b.price || 0) - (a.price || 0));

    if(targetFiltered.length === 0) {
        container.innerHTML = '<div class="text-white-50 small p-3">No players match filter.</div>';
        return;
    }

    targetFiltered.forEach((p) => {
      const div = document.createElement("div");
      div.className = "trade-player-card";
      div.onclick = () => this.toggleSelection(div, p.name, "target");
      const pid = `p-target-${this.sanitizeId(p.name)}`;
      div.innerHTML = `
                <input type="checkbox" class="player-checkbox" id="${pid}" data-name="${p.name}">
                <div class="player-info">
                    <div class="player-name">${p.name}</div>
                    <div class="player-role">${p.roleKey}</div>
                </div>
                <div class="player-price">${this.formatMoney(p.price)}</div>
            `;
      container.appendChild(div);
    });
  }

  renderSummaryBox() {
    // Replaces footer with dynamic summary AND message input
    // This is called by renderTradeCenter
    // But static HTML usually holds the footer. We need to inject the message input if missing.
    const footer = document.querySelector(".trade-summary-box");
    if (footer && !document.getElementById("tradeMessageInput")) {
      const msgDiv = document.createElement("div");
      msgDiv.className = "mb-2";
      msgDiv.innerHTML = `<input type="text" id="tradeMessageInput" class="form-control bg-dark text-white border-secondary" placeholder="Message / Negotiation Note (Optional)">`;
      footer.insertBefore(msgDiv, footer.firstChild);
    }
  }

  toggleSelection(card, name, side) {
    const cb = card.querySelector('input[type="checkbox"]');
    cb.checked = !cb.checked;
    if (cb.checked) card.classList.add("selected");
    else card.classList.remove("selected");

    this.calculateTradeTotals();
  }

  calculateTradeTotals() {
    // Auto-balance logic based on player values
    const myPlayers = this.getSelectedPlayersData("myTradeSquad", this.myTeam);
    const targetPlayers = this.getSelectedPlayersData(
      "targetTradeSquad",
      this.selectedTargetTeam,
    );

    const myValue = myPlayers.reduce((sum, p) => sum + (p.price || 0), 0);
    const targetValue = targetPlayers.reduce(
      (sum, p) => sum + (p.price || 0),
      0,
    );

    const diff = myValue - targetValue; // Positive = I am giving more value

    const offerInput = document.getElementById("offerCashInput");
    const reqInput = document.getElementById("reqCashInput");

    // Prevent auto-calc overlapping user message/negotiation
    // But still useful for value visualization

    if (!offerInput || !reqInput) return;

    if (
      offerInput.dataset.isUserEdited === "true" ||
      reqInput.dataset.isUserEdited === "true"
    ) {
      return; // Don't overwrite user manual input
    }

    // Auto-fill inputs to balance the trade
    if (diff > 0) {
      // I offered more value. I should request the difference.
      reqInput.value = (diff / 10000000).toFixed(2);
      offerInput.value = 0;
    } else if (diff < 0) {
      // They offered more value. I should pay the difference.
      offerInput.value = (Math.abs(diff) / 10000000).toFixed(2);
      reqInput.value = 0;
    } else {
      // Values are equal
      offerInput.value = 0;
      reqInput.value = 0;
    }

    console.log(
      `[TradeCalc] MyVal: ${myValue}, TheirVal: ${targetValue}, Gap: ${diff}`,
    );
  }

  getSelectedPlayersData(containerId, teamSource) {
    const container = document.getElementById(containerId);
    if (!container || !teamSource) return [];
    const selected = [];
    container.querySelectorAll(".player-checkbox:checked").forEach((cb) => {
      const name = cb.getAttribute("data-name");
      // Standardize: Ensure we return Objects if possible, or handle strings later
      const p = teamSource.roster.find((player) => player.name === name);
      if (p) selected.push(p);
    });
    return selected;
  }

  sanitizeId(name) {
    return name.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  }

  sendTradeProposal() {
    if (!this.myTeam || !this.selectedTargetTeam) {
      alert("Select a target team first.");
      return;
    }

    // Gather Data
    const myCashInput = document.getElementById("offerCashInput").value;
    const targetCashInput = document.getElementById("reqCashInput").value;
    const messageInput = document.getElementById("tradeMessageInput").value;
    
    // FIX: Use Data Objects for Payload to ensure Price/Role availability on server if needed
    // But primarily to ensure consistency.
    const myPlayers = this.getSelectedPlayersData("myTradeSquad", this.myTeam);
    const targetPlayers = this.getSelectedPlayersData("targetTradeSquad", this.selectedTargetTeam);

    // Validation
    const hasOffer = myPlayers.length > 0 || parseFloat(myCashInput || 0) > 0;
    const hasRequest =
      targetPlayers.length > 0 || parseFloat(targetCashInput || 0) > 0;
    const hasMessage = messageInput && messageInput.trim().length > 0;

    // Allow "Empty" trade ONLY if message is present (Negotiation Starter)
    if (!hasOffer && !hasRequest) {
      if (!hasMessage) {
        alert("Trade cannot be empty! Add a message to start negotiation.");
        return;
      }
      // If message exists, we allow 0/0 trade as a "Chat/Negotiation"
    } else {
      // Standard Checks for actual value trades
      if (hasOffer && !hasRequest) {
        // Check if it's strictly cash -> message? No, strictly forbids gifts unless message?
        // User wanted "Free Gifting" blocked.
        // But "10 Cr -> Batsman" (via message) is "Offer 10, Request 0".
        // If we strictly block this, they can't negotiate.
        // So, if Message is present, relax the "Gift" check?
        if (!hasMessage) {
          alert(
            "You cannot give items for free. Request something or add a message explaining the deal.",
          );
          return;
        }
      }

      if (!hasOffer && hasRequest) {
        if (!hasMessage) {
          alert(
            "You cannot request items for free. Offer something or add a message.",
          );
          return;
        }
      }
    }

    const type = this.determineTradeType(
      myPlayers,
      targetPlayers,
      myCashInput,
      targetCashInput,
    );

    const payload = {
      type: type,
      targetTeam: this.selectedTargetTeam.bidKey,
      details: {
        offeredPlayers: myPlayers,
        requestedPlayers: targetPlayers,
        // BACKEND COMPATIBILITY: Provide names list as server often iterates names for complex trades
        offeredPlayerNames: myPlayers.map(p => p.name),
        requestedPlayerNames: targetPlayers.map(p => p.name),
        offeredCash: parseFloat(myCashInput) || 0,
        requestedCash: parseFloat(targetCashInput) || 0,
        message: messageInput,
      },
    };

    // ======== BALANCE REFUND LOGIC FOR CASH → PLAYER ========
    if (
      type === "CASH_TRADE" &&
      myPlayers.length === 0 &&
      targetPlayers.length > 0
    ) {
      const offeredCash = parseFloat(myCashInput || 0);

      // Get player values
      const targetValues = this.getSelectedPlayersData(
        "targetTradeSquad",
        this.selectedTargetTeam,
      ).reduce((sum, p) => sum + (p.price || 0), 0);

      const offeredCr = offeredCash * 10000000;

      // If offered > player price
      if (offeredCr > targetValues) {
        const refundValue = offeredCr - targetValues;
        const refundCr = refundValue / 10000000;

        // Adjust cash sent to be exactly the player value
        payload.details.offeredCash = targetValues / 10000000;

        // Add refund return for my side (Logic: I pay 10, but 3 comes back immediately)
        // Actually, server handles deducting offeredCash.
        // If we send 7, we deduct 7. The User input 10.
        // So effectively they keep 3.

        // Update UI or Notify?
        console.log(
          `[FairTrade] Adjusted Offer: ${offeredCash} -> ${payload.details.offeredCash} Cr (Refund keeping: ${refundCr} Cr)`,
        );

        // Optional: We could just send the 'refundCash' field if server supports it,
        // But changing offeredCash locally is safer if server only deducts offeredCash.
        // The prompt says "payload.details.refundCash = refundCr".
        // And "Server must apply: team1.budget += refundCash".
        // But if we simply REDUCE offeredCash, we achieve the same result without changing server logic?
        // Wait, if I offer 10, and change payload to 7.
        // Server deducts 7. I keep 3. Result: I pay 7. Matches.
        // BUT, the prompt says "payload.details.refundCash".
        // Let's stick to the prompt's request to be safe, but reduction is cleaner.
        // Actually, if we reduce offeredCash to 7, the other team receives 7. Correct.
        // Does the other team need to know I offered 10 originally? Maybe for negotiation context.
        // Let's attach the refund info.

        payload.details.originalOffer = offeredCash;
        payload.details.refundCash = refundCr;
      }
    }

    // If Cash Only, format differently?
    // Server feature-integration.js handles createTradeRequest (Lines 188+)
    // It checks type: CASH_TRADE, PLAYER_SWAP, etc.
    // Let's standardise to DIRECT_COMPLEX for everything involving Mixed,
    // or let the server logic handle it.
    // Actually the server has specific listeners for specific types?
    // No, 'create_trade_request' handles all.

    // WAIT: Server expects specific structure for CASH_TRADE.
    // Line 206: if (type === 'CASH_TRADE') ...
    // But the 'createTradeRequest' function logic (Line 188) is incomplete in my view.
    // Ah, 'submit_proposal' (Line 237) handles the complexity.
    // 'create_trade_request' just notifies the target?
    // No, 'create_trade_request' creates the proposal ID and stores it.

    // Budget Check (Client Side)
    const mCash = parseFloat(myCashInput || 0);
    const tCash = parseFloat(targetCashInput || 0);

    if (type === "DIRECT_COMPLEX" || type === "CASH_TRADE") {
      if (this.myTeam.budget < mCash * 10000000) {
        alert(
          `Insufficient Budget! You have ${this.formatMoney(this.myTeam.budget)}`,
        );
        return;
      }
      // We can't strictly check target budget easily without trusting local data, but good to warn
      if (this.selectedTargetTeam.budget < tCash * 10000000) {
        alert(
          `Target team has insufficient budget (${this.formatMoney(this.selectedTargetTeam.budget)}) for this request.`,
        );
        return;
      }
    }

    window.socket.emit("submit_proposal", payload);

    // Wait for confirmation - removed premature reset
    // Listen for specific success event if available, or just wait for update
  }

  determineTradeType(myP, theirP, myC, theirC) {
    // Logic to match server switch cases
    // The server looks at payload.type directly.
    // We should send 'DIRECT_COMPLEX' for most things as it is versatile.
    // But if it's purely Cash for Player, use CASH_TRADE?
    // Server 'CASH_TRADE' logic seems simple: One player for Cash.
    // Let's stick to 'DIRECT_COMPLEX' which handles everything (Lines 301-337 server side).
    // Wait, does 'DIRECT_COMPLEX' exist in server 'submitproposal'?
    // Line 256: case 'DIRECT_COMPLEX': ...
    // Yes. It validates budget.

    if (myP.length === 0 && theirP.length === 0) return "CASH_TRADE"; // Should technically be impossible based on validation
    // But if just cash -> players (one way), it's CASH_TRADE or DIRECT_COMPLEX
    // Server CASH_TRADE expects: Type: CASH_TRADE, details: { amount, ... }
    // Our payload structure is unified. Let's stick to DIRECT_COMPLEX unless purely CASH -> PLAYERS

    const myCash = parseFloat(myC || 0);
    const theirCash = parseFloat(theirC || 0);

    // CASH → PLAYER (Strict: I give Cash, they give Players, no other assets)
    if (
      myP.length === 0 &&
      myCash > 0 &&
      theirP.length > 0 &&
      theirCash === 0
    ) {
      return "CASH_TRADE";
    }

    return "DIRECT_COMPLEX";
  }

  getSelectedPlayers(containerId) {
    const container = document.getElementById(containerId);
    const selected = [];
    container.querySelectorAll(".player-checkbox:checked").forEach((cb) => {
      selected.push(cb.getAttribute("data-name"));
    });
    return selected;
  }

  updateTradeUI() {
    this.renderProposals();
  }

  renderProposals() {
    const container = document.getElementById("activeProposalsList");
    if (!container) return;
    container.innerHTML = "";

    // Filter proposals involving me
  const myProposals = this.activeProposals.filter((p) => {
    const s = p.sender || p.senderTeamId;
    const r = p.receiver || p.targetTeamId;
    return s === window.mySelectedTeamKey || r === window.mySelectedTeamKey;
  });

  if (myProposals.length === 0) {
    container.innerHTML =
      '<div class="text-white-50 text-center p-3">No active proposals.</div>';
    return;
  }

  myProposals.forEach((p) => {
    const s = p.sender || p.senderTeamId;
    const r = p.receiver || p.targetTeamId;
    
    const isIncoming = r === window.mySelectedTeamKey;
    const isPending = p.status === "pending" || p.status === "OPEN";
    const statusColor = isPending ? "warning" : "secondary";

    const card = document.createElement("div");
    card.className = "card bg-dark border-secondary mb-2";
    card.innerHTML = `
              <div class="card-body p-2">
                  <div class="d-flex justify-content-between">
                      <span class="badge bg-${isIncoming ? "info" : "secondary"}">${isIncoming ? "INCOMING" : "OUTGOING"}</span>
                      <span class="badge bg-${statusColor}">${p.status.toUpperCase()}</span>
                  </div>
                  <div class="small mt-2 text-white">
                      <strong>${this.getTeamName(s)}</strong> ➡ <strong>${this.getTeamName(r)}</strong>
                  </div>
              ${
                p.details.message
                  ? `<div class="mt-2 text-white small f-italic border-top border-secondary pt-1">
                  "${p.details.message}"
              </div>`
                  : ""
              }
                  <div class="row mt-2 small text-white-50">
                      <div class="col-6 border-end border-secondary">
                          <strong class="text-success d-block mb-1">OFFER</strong>
                          ${this.formatDetails(p.details.offeredPlayers || p.details.offeredPlayerNames, p.details.offeredCash)}
                      </div>
                      <div class="col-6">
                          <strong class="text-warning d-block mb-1">REQUEST</strong>
                           ${this.formatDetails(p.details.requestedPlayers || p.details.requestedPlayerNames, p.details.requestedCash)}
                      </div>
                  </div>
                  ${this.renderActionButtons(p, isIncoming)}
              </div>
          `;
    container.appendChild(card);
  });
}

  renderActionButtons(p, isIncoming) {
    if (p.status !== "pending" && p.status !== "OPEN") return "";

    if (isIncoming) {
      return `
                <div class="mt-2 d-flex gap-2" data-id="${p.id}">
                    <button class="btn btn-sm btn-success flex-grow-1 action-accept">ACCEPT</button>
                    <button class="btn btn-sm btn-primary flex-grow-1 action-counter">COUNTER</button>
                    <button class="btn btn-sm btn-danger flex-grow-1 action-reject">REJECT</button>
                </div>
            `;
    } else {
      // ... outgoing buttons
      return `
                <div class="mt-2 text-center" data-id="${p.id}">
                    <button class="btn btn-sm btn-outline-secondary action-cancel">CANCEL</button>
                </div>
            `;
    }
  }

  // Add Global Listeners for Buttons inside Container
  addDynamicListeners() {
    if (this.listenersAttached) return;

    const container = document.getElementById("activeProposalsList");
    if (!container) return;

    container.addEventListener("click", (e) => {
      const card = e.target.closest("div[data-id]");
      if (!card) return;
      const id = card.dataset.id;

      if (e.target.classList.contains("action-accept")) {
        // Show Confirmation Modal
        this.showAcceptConfirmation(id);
      } else if (e.target.classList.contains("action-reject")) {
        this.respond(id, "rejected");
      } else if (e.target.classList.contains("action-cancel")) {
        this.respond(id, "cancelled");
      } else if (e.target.classList.contains("action-counter")) {
        this.prepareCounterOffer(id);
      }
    });

    // Add listener for the new Confirm Modal button
    document.body.addEventListener("click", (e) => {
      if (e.target.id === "btn-confirm-trade-accept") {
        const id = e.target.dataset.proposalId;
        if (id) this.confirmAcceptTrade(id);
      }
      if (e.target.id === "btn-confirm-cash-trade") {
        this.confirmCashTrade();
      }
    });

    this.listenersAttached = true;
  }

  showAcceptConfirmation(proposalId) {
    const p = this.activeProposals.find((prop) => prop.id === proposalId);
    if (!p) return;

    // Ensure Modal Exists (Lazy Load) - SIMPLIFIED MATCHING USER SCREENSHOT
    if (!document.getElementById("tradeConfirmModal")) {
      const modalHtml = `
            <div class="modal fade" id="tradeConfirmModal" tabindex="-1">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content text-white" style="background-color: #1e2124; border: 1px solid #36393f; box-shadow: 0 0 20px rgba(0,0,0,0.5);">
                        <div class="modal-header border-bottom border-secondary py-2">
                            <h6 class="modal-title text-uppercase fw-bold text-white mb-0" style="letter-spacing: 1px;">ACCEPT DIRECT OFFER</h6>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body p-4">
                            <div class="mb-3 small text-white-50 text-uppercase fw-bold" id="trade-from-team">From: ---</div>
                            
                            <div class="p-3 border rounded" style="background-color: #0b0c15; border-color: #444 !important;">
                                <!-- RECEIVE SECTION -->
                                <div class="mb-3">
                                    <div class="text-success small fw-bold text-uppercase mb-1">You Receive</div>
                                    <div id="confirm-get-players" class="text-white fw-bold mb-1"></div>
                                    <div id="confirm-get-cash" class="text-white-50 small"></div>
                                </div>
                                
                                <!-- GIVE SECTION -->
                                <div>
                                    <div class="text-danger small fw-bold text-uppercase mb-1">You Give</div>
                                    <div id="confirm-give-players" class="text-white fw-bold mb-1"></div>
                                    <div id="confirm-give-cash" class="text-white-50 small"></div>
                                </div>
                            </div>

                             <!-- Trade Message (Optional) -->
                            <div id="trade-message-section" class="mt-3" style="display:none;">
                                <div id="trade-message-text" class="text-white-50 small f-italic"></div>
                            </div>

                        </div>
                        <div class="modal-footer border-top-0 p-3 pt-0">
                             <button type="button" class="btn btn-outline-secondary px-4 fw-bold" data-bs-dismiss="modal">CANCEL</button>
                             <button type="button" class="btn btn-success px-4 fw-bold" id="btn-confirm-trade-accept" data-bs-dismiss="modal">ACCEPT</button>
                        </div>
                    </div>
                </div>
            </div>`;
      document.body.insertAdjacentHTML("beforeend", modalHtml);
    }

    // Populate Data matching the NEW SIMPLIFIED MODAL
    const senderTeam = this.teams.find((t) => t.bidKey === p.sender);
    const receiverTeam = this.teams.find((t) => t.bidKey === p.receiver); // Me (usually)

    // Determine roles: Who is 'From'?
    const fromName = senderTeam ? senderTeam.name : "Unknown Team";
    document.getElementById("trade-from-team").innerHTML =
      `From: <span class="text-white">${fromName}</span>`;

    // Is this incoming to me?
    const isIncoming = p.receiver === window.mySelectedTeamKey;

    // What I GET (Their Offer)
    const iGetPlayers = isIncoming
      ? p.details.offeredPlayers || p.details.offeredPlayerNames || []
      : p.details.requestedPlayers || p.details.requestedPlayerNames || [];
    const iGetCash = isIncoming
      ? parseFloat(p.details.offeredCash || 0)
      : parseFloat(p.details.requestedCash || 0);

    // What I GIVE (Their Request)
    const iGivePlayers = isIncoming
      ? p.details.requestedPlayers || p.details.requestedPlayerNames || []
      : p.details.offeredPlayers || p.details.offeredPlayerNames || [];
    const iGiveCash = isIncoming
      ? parseFloat(p.details.requestedCash || 0)
      : parseFloat(p.details.offeredCash || 0);

    // --- POPULATE UI ---

    // 1. RECEIVE SECTION
    const getListHtml = this.formatPlayersListSimple(iGetPlayers);
    document.getElementById("confirm-get-players").innerHTML =
      getListHtml || '<span class="text-white-50">Nothing</span>';

    // Format Cash: The value in 'details' is mostly likely in Cr units (e.g. 7 for 7Cr) 
    // OR raw value if mock data is weird. 
    // Logic: formatMoney expects raw bytes (70000000). 
    // If trade system uses Cr, we must assume '7' means 7Cr.
    // Let's use standard formatMoney logic but checking range.
    let getCashStr = "";
    if (iGetCash > 0) {
      if (iGetCash < 1000) {
        // Likely Cr unit
        getCashStr = `₹${iGetCash} Cr`;
      } else {
        // Likely raw bytes
        getCashStr = this.formatMoney(iGetCash);
      }
    } else {
      getCashStr = '<span class="text-white-50">No Cash</span>';
    }
    document.getElementById("confirm-get-cash").innerHTML = getCashStr;


    // 2. GIVE SECTION
    const giveListHtml = this.formatPlayersListSimple(iGivePlayers);
    document.getElementById("confirm-give-players").innerHTML =
      giveListHtml || '<span class="text-white-50">Nothing</span>';

    let giveCashStr = "";
    if (iGiveCash > 0) {
      if (iGiveCash < 1000) {
        giveCashStr = `₹${iGiveCash} Cr`;
      } else {
        giveCashStr = this.formatMoney(iGiveCash);
      }
    } else {
      giveCashStr = '<span class="text-white-50">No Cash</span>';
    }
    document.getElementById("confirm-give-cash").innerHTML = giveCashStr;


    // 3. Message
    const msgDiv = document.getElementById("trade-message-section");
    if (p.details.message && p.details.message.trim()) {
      msgDiv.style.display = "block";
      document.getElementById("trade-message-text").textContent =
        `"${p.details.message}"`;
    } else {
      msgDiv.style.display = "none";
    }

    // Bind Button
    document.getElementById("btn-confirm-trade-accept").dataset.proposalId =
      proposalId;

    // Show
    const bsModal = new bootstrap.Modal(
      document.getElementById("tradeConfirmModal"),
    );
    bsModal.show();
  }

  // Simple formatter for the new modal style
  formatPlayersListSimple(players) {
    if (!players || players.length === 0) return null;
    return players
      .map((p) => {
        let name = "Unknown";
        if (typeof p === "string") name = p;
        else if (p && p.name) name = p.name;
        
        return `<div class="fw-bold border-bottom border-secondary pb-1 mb-1">${name}</div>`;
      })
      .join("");
  }

  // NEW: Handle cash-only trades with category selection
  showCashOnlyTradeModal(proposalId) {
    const p = this.activeProposals.find((prop) => prop.id === proposalId);
    if (!p) return;

    // Check if this is a cash-only trade (no players offered)
    const offeredPlayers =
      p.details.offeredPlayers || p.details.offeredPlayerNames || [];
    if (offeredPlayers.length > 0) {
      // Has players, use normal confirmation
      this.showAcceptConfirmation(proposalId);
      return;
    }

    const cashAmount = p.details.offeredCash || 0;
    const senderTeam = this.teams.find((t) => t.bidKey === p.sender);

    // Ensure Modal Exists
    if (!document.getElementById("cashOnlyTradeModal")) {
      const modalHtml = `
        <div class="modal fade" id="cashOnlyTradeModal" tabindex="-1">
          <div class="modal-dialog modal-lg modal-dialog-centered">
            <div class="modal-content bg-dark border-warning text-white">
              <div class="modal-header border-bottom border-warning bg-dark">
                <h5 class="modal-title text-warning">
                  <i class="fas fa-money-bill me-2"></i>CASH TRADE - SELECT PLAYERS
                </h5>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body">
                <div class="alert alert-warning border-warning mb-3">
                  <i class="fas fa-exclamation-triangle me-2"></i>
                  <strong>${senderTeam?.name || "Team"}</strong> offers <strong>₹${cashAmount} Cr</strong>
                </div>

                <!-- Category Selection -->
                <div class="mb-3">
                  <label class="form-label fw-bold text-info">Select Player Category:</label>
                  <div class="btn-group w-100" role="group" id="categoryBtnGroup">
                    <input type="radio" class="btn-check category-btn" name="category" id="cat-bat" value="bat" checked>
                    <label class="btn btn-outline-success" for="cat-bat">🏏 BATSMAN</label>
                    
                    <input type="radio" class="btn-check category-btn" name="category" id="cat-bowl" value="bowl">
                    <label class="btn btn-outline-primary" for="cat-bowl">🎯 BOWLER</label>
                    
                    <input type="radio" class="btn-check category-btn" name="category" id="cat-all" value="all">
                    <label class="btn btn-outline-info" for="cat-all">⭐ ALL-ROUNDER</label>
                  </div>
                </div>

                <!-- Players List -->
                <div class="mb-3 border border-secondary rounded p-3 bg-black bg-opacity-50" style="max-height: 400px; overflow-y: auto;">
                  <h6 class="text-info mb-3">Available Players:</h6>
                  <div id="categoryPlayersList" class="row g-2">
                    <div class="text-white-50 text-center">Loading players...</div>
                  </div>
                </div>

                <!-- Selected Players -->
                <div class="p-3 border-2 border-success rounded bg-success bg-opacity-10">
                  <h6 class="text-success mb-2">✅ Selected Players:</h6>
                  <div id="selectedPlayersList" class="text-white-50 small">
                    <em>Select players above...</em>
                  </div>
                  <div id="selectionCount" class="text-warning small mt-2"></div>
                </div>
              </div>
              <div class="modal-footer border-top border-secondary justify-content-center gap-2">
                <button type="button" class="btn btn-outline-danger" data-bs-dismiss="modal">CANCEL</button>
                <button type="button" class="btn btn-success fw-bold" id="btn-confirm-cash-trade">ACCEPT & SELECT</button>
              </div>
            </div>
          </div>
        </div>`;
      document.body.insertAdjacentHTML("beforeend", modalHtml);
    }

    // Store proposal ID for later
    this.currentCashTradeProposalId = proposalId;
    this.selectedCashTradePlayersIds = new Set();

    // Category change handler
    document.querySelectorAll(".category-btn").forEach((btn) => {
      btn.addEventListener("change", () => this.loadPlayersByCategory());
    });

    // Load initial players
    this.loadPlayersByCategory();

    // Show modal
    const bsModal = new bootstrap.Modal(
      document.getElementById("cashOnlyTradeModal"),
    );
    bsModal.show();
  }

  loadPlayersByCategory() {
    const category =
      document.querySelector('input[name="category"]:checked')?.value || "bat";
    const container = document.getElementById("categoryPlayersList");

    // Get our team's players in this category
    const ourTeam = this.myTeam;
    // FIX: Unified to use .roster instead of .squad (server usually sends 'roster')
    if (!ourTeam || (!ourTeam.roster && !ourTeam.squad)) {
      container.innerHTML =
        '<div class="text-danger">Team data not available</div>';
      return;
    }

    const roster = ourTeam.roster || ourTeam.squad || [];

    const categoryPlayers = roster.filter((p) => {
      const playerType = (p.roleKey || p.role || p.type || "bat").toLowerCase();
      // Improved matching for standardized roles
      if(category === 'bat') return playerType.includes('bat');
      if(category === 'bowl') return playerType.includes('bowl');
      if(category === 'all') return playerType.includes('all');
      if(category === 'wk') return playerType.includes('wk') || playerType.includes('wicket');
      return true; 
    });

    if (categoryPlayers.length === 0) {
      container.innerHTML = `<div class="text-white-50">No ${this.getCategoryName(category)} available</div>`;
      return;
    }

    container.innerHTML = categoryPlayers
      .map((p) => {
        const playerId = `cash-trade-player-${this.sanitizeId(p.name)}`;
        const isSelected = this.selectedCashTradePlayersIds.has(playerId);
        return `
        <div class="col-md-6">
          <div class="p-2 border rounded cursor-pointer ${isSelected ? "border-success bg-success bg-opacity-10" : "border-secondary"}" 
               onclick="tradeSystem.toggleCashTradePlayer('${playerId}', '${p.name}')">
            <div class="small fw-bold text-white">${p.name}</div>
            <div class="text-warning tiny">₹${p.price || 0}</div>
            <div class="text-info tiny">${p.role || category}</div>
            ${isSelected ? '<div class="text-success small"><i class="fas fa-check"></i> Selected</div>' : ""}
          </div>
        </div>
      `;
      })
      .join("");

    this.updateCashTradeSelection();
  }

  toggleCashTradePlayer(playerId, playerName) {
    if (this.selectedCashTradePlayersIds.has(playerId)) {
      this.selectedCashTradePlayersIds.delete(playerId);
    } else {
      this.selectedCashTradePlayersIds.add(playerId);
    }
    this.loadPlayersByCategory();
  }

  updateCashTradeSelection() {
    const playerNames = Array.from(this.selectedCashTradePlayersIds).map(
      (id) => {
        return id.replace("cash-trade-player-", "");
      },
    );

    const selectedList = document.getElementById("selectedPlayersList");
    if (playerNames.length === 0) {
      selectedList.innerHTML =
        '<em class="text-white-50">Select players above...</em>';
    } else {
      selectedList.innerHTML = playerNames
        .map(
          (name) => `<span class="badge bg-success me-1 mb-1">${name}</span>`,
        )
        .join("");
    }

    document.getElementById("selectionCount").innerHTML =
      `<strong>${playerNames.length}</strong> player(s) selected`;
  }

  getCategoryName(cat) {
    return { bat: "Batsmen", bowl: "Bowlers", all: "All-Rounders" }[cat] || cat;
  }

  confirmCashTrade() {
    const playerIds = Array.from(this.selectedCashTradePlayersIds);
    const playerNames = playerIds.map((id) =>
      id.replace("cash-trade-player-", ""),
    );

    if (playerNames.length === 0) {
      alert("Please select at least one player");
      return;
    }

    // Send accept with selected players
    this.respond(this.currentCashTradeProposalId, "accepted", playerNames);

    // Close modal
    const modal = bootstrap.Modal.getInstance(
      document.getElementById("cashOnlyTradeModal"),
    );
    if (modal) modal.hide();
  }

  confirmAcceptTrade(id) {
    // DISABLE BUTTON TO PREVENT DOUBLE CLICK
    const btn = document.getElementById("btn-confirm-trade-accept");
    if(btn) {
        if(btn.disabled) return; // Prevent double execution
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Processing...';
        setTimeout(() => {
             // Re-enable after timeout just in case of error (safety net)
             btn.disabled = false;
             btn.innerHTML = 'CONFIRM TRADE'; 
        }, 5000);
    }

    // PRE-CHECK: Budget
    const p = this.activeProposals.find(prop => prop.id === id);
    if(p) {
        const isIncoming = p.receiver === window.mySelectedTeamKey;
        // If I am accepting, I am paying "requestedCash" (if receiving) or "offeredCash" (if I am sender, but I can't accept my own).
        // Standard flow: incoming proposal. I pay what they requested.
        const cashToPay = isIncoming ? (parseFloat(p.details.requestedCash) || 0) : 0;
        
        if(cashToPay > 0 && this.myTeam.budget < cashToPay * 10000000) {
             alert(`Cannot accept: You need ₹${cashToPay} Cr but have ${this.formatMoney(this.myTeam.budget)}`);
             return;
        }
    }

    this.respond(id, "accepted");
    // Trigger generic success notification via toaster if available, or simpler:
    // alert('Trade Accepted! Processing...');
    // No, UI updates automatically via socket event.
  }

  showRejectConfirmation(proposalId) {
    const p = this.activeProposals.find((prop) => prop.id === proposalId);
    if (!p) return;

    if (!document.getElementById("tradeRejectModal")) {
      const modalHtml = `
        <div class="modal fade" id="tradeRejectModal" tabindex="-1">
          <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content bg-dark border-danger text-white">
              <div class="modal-header border-bottom border-danger">
                <h5 class="modal-title text-danger">REJECT TRADE</h5>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body">
                <p class="small text-white-50">Are you sure you want to reject this trade?</p>
                <div class="p-2 border rounded bg-black bg-opacity-25">
                  <div class="fw-bold text-white">From: ${this.getTeamName(p.sender)}</div>
                  <div class="small text-white-50 mt-1">Offer: ${this.formatDetails(p.details.offeredPlayers || p.details.offeredPlayerNames, p.details.offeredCash)}</div>
                  <div class="small text-white-50 mt-1">Request: ${this.formatDetails(p.details.requestedPlayers || p.details.requestedPlayerNames, p.details.requestedCash)}</div>
                </div>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">CANCEL</button>
                <button type="button" class="btn btn-danger" id="btn-confirm-trade-reject">REJECT</button>
              </div>
            </div>
          </div>
        </div>`;
      document.body.insertAdjacentHTML("beforeend", modalHtml);

      // Add click handler for reject button
      document.body.addEventListener("click", (e) => {
        if (e.target && e.target.id === "btn-confirm-trade-reject") {
          const modalEl = document.getElementById("tradeRejectModal");
          const bs =
            bootstrap.Modal.getInstance(modalEl) ||
            new bootstrap.Modal(modalEl);
          bs.hide();
          this.respond(proposalId, "rejected");
        }
      });
    }

    const bsModal = new bootstrap.Modal(
      document.getElementById("tradeRejectModal"),
    );
    bsModal.show();
  }

  prepareCounterOffer(proposalId) {
    const p = this.activeProposals.find((prop) => prop.id === proposalId);
    if (!p) return;

    // 1. Open Trade Center (if not already fully visible/reset)
    this.openTradeCenter();

    // 2. Set Target Team to the ORIGINAL SENDER
    const senderKey = p.sender;
    const select = document.getElementById("targetTeamSelect");
    if (select) {
      select.value = senderKey;
      this.onTargetTeamChange(senderKey); // Load their squad
    }

    // 3. Invert Values (What they offered is now what I request, what they requested is now what I offer)
    // My Offer = Their Request
    const myOfferNames = p.details.requestedPlayerNames || []; // They requested these from me
    const myOfferCash = p.details.requestedCash || 0;

    // My Request = Their Offer
    const myReqNames = p.details.offeredPlayerNames || []; // They offered these to me
    const myReqCash = p.details.offeredCash || 0;

    // 4. Pre-fill UI (Needs small timeout for DOM to update after onTargetTeamChange)
    setTimeout(() => {
      // Select My Players (The ones they wanted)
      myOfferNames.forEach((name) => {
        const cleanId = `p-my-${this.sanitizeId(name)}`;
        const cb = document.getElementById(cleanId);
        if (cb) {
          cb.checked = true;
          cb.parentElement.classList.add("selected");
        }
      });

      // Select Target Players (The ones they offered)
      myReqNames.forEach((name) => {
        const cleanId = `p-target-${this.sanitizeId(name)}`;
        const cb = document.getElementById(cleanId);
        if (cb) {
          cb.checked = true;
          cb.parentElement.classList.add("selected");
        }
      });

      // Set Cash
      const offerInput = document.getElementById("offerCashInput");
      const reqInput = document.getElementById("reqCashInput");
      if (offerInput) {
        offerInput.value = myOfferCash;
        offerInput.dataset.isUserEdited = "true";
      }
      if (reqInput) {
        reqInput.value = myReqCash;
        reqInput.dataset.isUserEdited = "true";
      }

      // Set Message
      const msgInput = document.getElementById("tradeMessageInput");
      if (msgInput)
        msgInput.value = `Counter to: ${p.details.message || "your Offer"}`;

      // Recalc
      this.calculateTradeTotals();
    }, 300);
  }

  openProposalInTradeCenter(proposalId) {
    const p = this.activeProposals.find((prop) => prop.id === proposalId);
    if (!p) return;

    // Open Trade Center
    this.openTradeCenter();

    // Set target to the original sender so Trade Center shows the same mapping
    const senderKey = p.sender;
    const select = document.getElementById("targetTeamSelect");
    if (select) {
      select.value = senderKey;
      this.onTargetTeamChange(senderKey);
    }

    // After DOM updates, mark selections to reflect the proposal (but keep inputs disabled for review)
    setTimeout(() => {
      // Mark my players (those requested from me)
      const myOfferNames =
        p.details.requestedPlayerNames || p.details.requestedPlayers || [];
      myOfferNames.forEach((name) => {
        const cb = document.getElementById(`p-my-${this.sanitizeId(name)}`);
        if (cb) {
          cb.checked = true;
          cb.parentElement.classList.add("selected");
          cb.disabled = true;
        }
      });

      // Mark target players (those offered to me)
      const myReqNames =
        p.details.offeredPlayerNames || p.details.offeredPlayers || [];
      myReqNames.forEach((name) => {
        const cb = document.getElementById(`p-target-${this.sanitizeId(name)}`);
        if (cb) {
          cb.checked = true;
          cb.parentElement.classList.add("selected");
          cb.disabled = true;
        }
      });

      // Cash inputs: offer = what I give, request = what I get
      const offerInput = document.getElementById("offerCashInput");
      const reqInput = document.getElementById("reqCashInput");
      if (offerInput) {
        offerInput.value = p.details.requestedCash || 0;
        offerInput.dataset.isUserEdited = "true";
        offerInput.disabled = true;
      }
      if (reqInput) {
        reqInput.value = p.details.offeredCash || 0;
        reqInput.dataset.isUserEdited = "true";
        reqInput.disabled = true;
      }

      // Message
      const msgInput = document.getElementById("tradeMessageInput");
      if (msgInput) {
        msgInput.value = p.details.message || "";
        msgInput.disabled = true;
      }

    // Insert a temporary action bar for Accept / Reject in Trade Center header
    const footer = document.querySelector(".trade-summary-box");
    if (footer) {
      // Remove any existing review action bar
      const existing = document.getElementById("proposalReviewActions");
      if (existing) existing.remove();

      const bar = document.createElement("div");
      bar.id = "proposalReviewActions";
      bar.className = "d-flex gap-2 justify-content-center my-2";
      bar.innerHTML = `
        <button class="btn btn-outline-secondary" id="proposal-review-cancel">Close</button>
        <button class="btn btn-danger" id="proposal-review-reject">Reject</button>
        <button class="btn btn-success" id="proposal-review-accept">Accept</button>
      `;
      footer.parentElement.insertBefore(bar, footer);

      // Disable Controls during review
      const targetSelect = document.getElementById("targetTeamSelect");
      if(targetSelect) targetSelect.disabled = true;
      
      const filterBtns = document.querySelectorAll(".filter-btn");
      filterBtns.forEach(b => {
          b.classList.add("disabled"); // Visual disable
          b.style.pointerEvents = "none"; // Functional disable
          b.style.opacity = "0.5";
      });

      // Handlers
      bar.querySelector("#proposal-review-cancel").onclick = () => {
        // Re-enable inputs and remove bar
        this.clearProposalReviewState(proposalId);
      };
      bar.querySelector("#proposal-review-reject").onclick = () => {
        this.clearProposalReviewState(proposalId);
        this.respond(proposalId, "rejected");
      };
      bar.querySelector("#proposal-review-accept").onclick = () => {
        this.clearProposalReviewState(proposalId);
        this.confirmAcceptTrade(proposalId); // Use confirm method to do budget check
      };
    }
  }, 300);
}

clearProposalReviewState(proposalId) {
  // Re-enable inputs and remove action bar
  const inputs = document.querySelectorAll(
    "#myTradeSquad .player-checkbox, #targetTradeSquad .player-checkbox",
  );
  inputs.forEach((cb) => {
    cb.disabled = false;
    if (!cb.checked) cb.parentElement.classList.remove("selected");
  });
  const offerInput = document.getElementById("offerCashInput");
  const reqInput = document.getElementById("reqCashInput");
  const msgInput = document.getElementById("tradeMessageInput");
  if (offerInput) {
    offerInput.disabled = false;
    offerInput.dataset.isUserEdited = "false";
  }
  if (reqInput) {
    reqInput.disabled = false;
    reqInput.dataset.isUserEdited = "false";
  }
  if (msgInput) {
    msgInput.disabled = false;
  }

  // Re-enable Controls
  const targetSelect = document.getElementById("targetTeamSelect");
  if(targetSelect) targetSelect.disabled = false;
  
  const filterBtns = document.querySelectorAll(".filter-btn");
  filterBtns.forEach(b => b.classList.remove("disabled"));

  const bar = document.getElementById("proposalReviewActions");
  if (bar) bar.remove();
}

respond(id, status, selectedPlayers = []) {
  // Include full trade details with the response
  const proposal = this.activeProposals.find((p) => p.id === id);
  if (!proposal) {
    window.socket.emit("respond_to_proposal", {
      proposalId: id,
      status: status,
      selectedPlayers: selectedPlayers,
    });
    return;
  }

  // Send detailed trade information for history logging
  const senderTeam = this.teams.find((t) => t.bidKey === proposal.sender);
  const receiverTeam = this.teams.find((t) => t.bidKey === proposal.receiver);
  const isIncoming = proposal.receiver === window.mySelectedTeamKey;

  // If selectedPlayers provided (cash-only trade), use them as received players
  const receivedPlayers =
    selectedPlayers.length > 0
      ? selectedPlayers
      : proposal.details.offeredPlayerNames ||
        proposal.details.offeredPlayers ||
        [];

  const tradeDetails = {
    proposalId: id,
    status: status,
    selectedPlayers: selectedPlayers,
    tradeInfo: {
      timestamp: new Date().toISOString(),
      senderTeam: senderTeam?.name || "Unknown",
      receiverTeam: receiverTeam?.name || "Unknown",
      playersExchanged: {
        given:
          proposal.details.requestedPlayerNames ||
          proposal.details.requestedPlayers ||
          [],
        received: receivedPlayers,
      },
      cashExchanged: {
        given: isIncoming
          ? proposal.details.requestedCash || 0
          : proposal.details.offeredCash || 0,
        received: isIncoming
          ? proposal.details.offeredCash || 0
          : proposal.details.requestedCash || 0,
      },
      message: proposal.details.message || "",
      type: proposal.type || "UNKNOWN",
    },
  };

  window.socket.emit("respond_to_proposal", tradeDetails);
}

  renderHistory() {
    const container = document.getElementById("tradeHistoryList");
    if (!container) return;
    container.innerHTML = "";

    this.activeProposals.forEach(p => {
        if(p.type === 'MARKET_REQUEST') {
            const div = document.createElement("div");
            div.className = "small text-white-50 border-bottom border-secondary py-2 f-italic";
            div.innerHTML = `MARKET: ${this.getTeamName(p.sender)} requested ${p.details.requestedRole} for ${p.details.offeredCash} Cr`;
            container.appendChild(div);
        }
    });

    this.tradeHistory.forEach((h) => {
      const div = document.createElement("div");
      div.className = "small text-white-50 border-bottom border-secondary py-2";
      div.innerHTML =
        h.text || h.description ||
        `Trade between ${this.getTeamName(h.team1)} and ${this.getTeamName(h.team2)}`;
      container.appendChild(div);
    });
  }

  // --- MARKETPLACE LOGIC ---

  renderMarketplace() {
      const container = document.getElementById("tradeContentArea");
      if(!container) return;

      container.innerHTML = `
        <div class="row">
            <!-- CREATE REQUEST -->
            <div class="col-md-4 border-end border-secondary">
                <h5 class="text-info mb-3"><i class="bi bi-broadcast me-2"></i>BROADCAST REQUEST</h5>
                <p class="text-white-50 small">Ask all teams for a specific player type.</p>
                
                <div class="mb-3">
                    <label class="text-white small">I want a:</label>
                    <select id="marketRoleSelect" class="form-select bg-dark text-white border-secondary">
                        <option value="BATSMAN">Values.Batsman</option>
                        <option value="BOWLER">Values.Bowler</option>
                        <option value="ALL ROUNDER">Values.All-Rounder</option>
                        <option value="WICKETKEEPER">Values.WicketKeeper</option>
                    </select>
                </div>

                <div class="mb-3">
                    <label class="text-white small">I will pay (Max Cr):</label>
                    <input type="number" id="marketBudgetInput" class="form-control bg-dark text-white border-secondary" placeholder="e.g. 7">
                </div>

                <div class="mb-3">
                    <label class="text-white small">Note (Optional):</label>
                    <textarea id="marketNoteInput" class="form-control bg-dark text-white border-secondary" rows="2" placeholder="Specific requirements..."></textarea>
                </div>

                <button class="btn btn-info w-100" onclick="window.tradeSystem.sendMarketRequest()">POST REQUEST</button>
            </div>

            <!-- ACTIVE REQUESTS -->
            <div class="col-md-8">
                <h5 class="text-warning mb-3"><i class="bi bi-globe me-2"></i>LIVE MARKET REQUESTS</h5>
                <div id="marketRequestsList" class="d-flex flex-column gap-2" style="max-height: 400px; overflow-y: auto;">
                    <!-- Injected Items -->
                </div>
            </div>
        </div>
      `;

      this.renderMarketList();
  }

  renderMarketList() {
      const list = document.getElementById("marketRequestsList");
      if(!list) return;
      list.innerHTML = "";

      const marketProposals = this.activeProposals.filter(p => p.type === 'MARKET_REQUEST' && p.sender !== window.mySelectedTeamKey);

      if(marketProposals.length === 0) {
          list.innerHTML = '<div class="text-white-50 text-center p-4 border border-secondary border-dashed rounded">No active market requests from other teams.</div>';
          return;
      }

      marketProposals.forEach(p => {
          const div = document.createElement("div");
          div.className = "card bg-dark border-secondary";
          div.innerHTML = `
            <div class="card-body d-flex justify-content-between align-items-center">
                <div>
                     <div class="text-info fw-bold mb-1">${this.getTeamName(p.sender)} <span class="text-white font-weight-normal">wants a</span> ${p.details.requestedRole}</div>
                     <div class="text-success fw-bold">Paying: ₹${p.details.offeredCash} Cr</div>
                     ${p.details.message ? `<div class="text-white-50 small f-italic mt-1">"${p.details.message}"</div>` : ''}
                </div>
                <button class="btn btn-outline-success btn-sm px-3" onclick="window.tradeSystem.openMarketOffer('${p.id}', '${p.details.requestedRole}', ${p.details.offeredCash})">
                    ACCEPT / OFFER
                </button>
            </div>
          `;
          list.appendChild(div);
      });
  }

  sendMarketRequest() {
      // COOLDOWN CHECK
      const now = Date.now();
      if(this.lastMarketRequestTime && (now - this.lastMarketRequestTime < 30000)) { // 30s
          const wait = Math.ceil((30000 - (now - this.lastMarketRequestTime))/1000);
          alert(`Please wait ${wait} seconds before posting another request.`);
          return;
      }

      const role = document.getElementById("marketRoleSelect").value;
      const budget = parseFloat(document.getElementById("marketBudgetInput").value);
      const note = document.getElementById("marketNoteInput").value;

      if(!budget || budget <= 0) {
          alert("Please enter a valid budget amount.");
          return;
      }
      
      this.lastMarketRequestTime = now;

      const payload = {
          type: "MARKET_REQUEST",
          details: {
              requestedRole: role,
              offeredCash: budget,
              message: note
          }
      };

      window.socket.emit("submit_proposal", payload);
      alert("Broadcast sent to all teams!");
      
      // Cleanup UI
      document.getElementById("marketBudgetInput").value = "";
      document.getElementById("marketNoteInput").value = "";
  }

  openMarketOffer(proposalId, role, cash) {
      // Find my players matching the role
      let filterKey = role.toLowerCase();
      if(filterKey === 'wicketkeeper') filterKey = 'wk'; 
      if(filterKey === 'all rounder') filterKey = 'all';

      // Use a temp filter to get players
      this.currentCategoryFilter = filterKey; 
      const eligiblePlayers = this.applyFilter(this.myTeam?.roster || []);
      // Restore filter
      this.currentCategoryFilter = "all"; 

      if(eligiblePlayers.length === 0) {
          alert(`You have no players matching role: ${role}`);
          return;
      }

      // Show Modal to select player AND Set Price
      if (!document.getElementById("marketRespondModal")) {
          const modalHtml = `
            <div class="modal fade" id="marketRespondModal" tabindex="-1">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content bg-dark border-info text-white">
                        <div class="modal-header border-bottom border-secondary">
                            <h5 class="modal-title">Select Player to Offer</h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                             <div class="alert alert-info border-info mb-3 small">
                                Request for <strong>${role}</strong>. Target Budget: <strong>₹${cash} Cr</strong>.
                             </div>
                             
                             <div class="mb-3">
                                <label class="small text-white-50">Your Asking Price (Cr):</label>
                                <input type="number" id="marketRespondPrice" class="form-control bg-black text-info border-secondary" value="${cash}">
                             </div>

                             <div class="small text-white-50 mb-2">Select Player:</div>
                             <div id="marketPlayerSelectContainer" class="d-flex flex-column gap-2" style="max-height: 300px; overflow-y: auto;"></div>
                        </div>
                    </div>
                </div>
            </div>
          `;
          document.body.insertAdjacentHTML("beforeend", modalHtml);
      } else {
          // Update the existing modal's default value if it exists
           const input = document.getElementById("marketRespondPrice");
           if(input) input.value = cash;
      }

      const container = document.getElementById("marketPlayerSelectContainer");
      container.innerHTML = "";
      
      eligiblePlayers.forEach(p => {
          const btn = document.createElement("button");
          btn.className = "btn btn-outline-light text-start p-2 d-flex justify-content-between align-items-center";
          btn.innerHTML = `
            <span>${p.name} <span class="badge bg-secondary ms-2">${p.roleKey}</span></span>
            <span class="text-success small">Value: ${this.formatMoney(p.price)}</span>
          `;
          btn.onclick = () => {
              const askingPrice = parseFloat(document.getElementById("marketRespondPrice").value) || cash;
              this.finaliseMarketTrade(proposalId, p.name, askingPrice);
          };
          container.appendChild(btn);
      });

      new bootstrap.Modal(document.getElementById("marketRespondModal")).show();
  }

  finaliseMarketTrade(marketProposalId, playerName, askingPrice) {
      // Get the original proposal to find the sender
      const original = this.activeProposals.find(p => p.id === marketProposalId);
      if(!original) return;

      const payload = {
          type: "DIRECT_COMPLEX", // Standard trade
          targetTeam: original.sender,
          details: {
              offeredPlayerNames: [playerName],
              requestedCash: askingPrice, // Use the user-defined price
              message: `Response to Market Request: ${playerName} for ₹${askingPrice} Cr`
          }
      };

      window.socket.emit("submit_proposal", payload);
      
      // Hide modal
      const modalEl = document.getElementById("marketRespondModal");
      const modal = bootstrap.Modal.getInstance(modalEl);
      modal.hide();

      alert(`Offer sent to ${this.getTeamName(original.sender)}: ${playerName} for ₹${askingPrice} Cr`);
  }

  getTeamName(key) {
    const t = this.teams.find((x) => x.bidKey === key);
    return t ? t.name : key;
  }

  formatMoney(amount) {
    if (!amount) return "₹0";
    if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`;
    return `₹${(amount / 100000).toFixed(1)} L`;
  }

  formatDetails(players, cash) {
    let text = [];
    if (players && players.length > 0) {
      // Check if players is array of strings or objects
      // The data structure might be inconsistent (sometimes objects with 'name', sometimes direct strings)
      // We standardize it here.
      const names = players.map((p) => {
        if (typeof p === "string") return p;
        if (p && p.name) return p.name;
        return "Unknown Player";
      });
      text.push(`Players: ${names.join(", ")}`);
    }
    if (cash && cash > 0) text.push(`Cash: ${cash} Cr`);

    return text.join(" | ") || "None";
  }
  triggerTradeSummaryIfRelevant() {
    // Wait a small bit for history to sync
    setTimeout(() => {
      if (this.tradeHistory.length > 0) {
        const latest = this.tradeHistory[0];
        // Check if I was involved
        // History text: "DIRECT TRADE: [Team1] exchanged ... from [Team2]"
        // Or simplified history text from server.
        // We check if my team name is in the text.
        if (latest.text && latest.text.includes(this.myTeam.name)) {
          this.showTradeExecutionSummary(latest.text);
        }
      }
    }, 800);
  }

  showTradeExecutionSummary(detailsText) {
    // Ensure Modal Exists
    if (!document.getElementById("tradeSuccessModal")) {
      const modalHtml = `
            <div class="modal fade" id="tradeSuccessModal" tabindex="-1">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content bg-dark border-gold text-white" style="box-shadow: 0 0 50px rgba(255, 215, 0, 0.3);">
                        <div class="modal-header border-bottom border-warning bg-black">
                            <h5 class="modal-title display-font text-warning"><i class="bi bi-check-circle-fill me-2"></i>TRADE COMPLETE</h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body text-center p-4">
                            <div class="display-1 text-success mb-3"><i class="bi bi-box-seam"></i></div>
                            <h4 class="text-white mb-3 font-monospace">DEAL SEALED!</h4>
                            <div class="p-3 border border-secondary rounded bg-white bg-opacity-10 text-start">
                                <div id="success-trade-details" class="small text-white-50" style="line-height: 1.6;"></div>
                            </div>
                        </div>
                        <div class="modal-footer border-top border-secondary justify-content-center">
                             <button type="button" class="btn btn-gold w-50 fw-bold" data-bs-dismiss="modal">AWESOME</button>
                        </div>
                    </div>
                </div>
            </div>`;
      document.body.insertAdjacentHTML("beforeend", modalHtml);
    }

    document.getElementById("success-trade-details").innerText = detailsText
      ? detailsText
      : "Trade successfully processed.";
    const bsModal = new bootstrap.Modal(
      document.getElementById("tradeSuccessModal"),
    );
    bsModal.show();
  }
  showNotification(message, type = "info", onClickAction = null) {
      // 1. Create Container if missing
      let container = document.getElementById("trade-toast-container");
      if (!container) {
          const div = document.createElement("div");
          div.id = "trade-toast-container";
          Object.assign(div.style, {
              position: "fixed",
              top: "20px",
              right: "20px",
              zIndex: "10000",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              pointerEvents: "none" // Allow clicks through container
          });
          document.body.appendChild(div);
          container = div;
      }

      // 2. Create Toast
      const toast = document.createElement("div");
      toast.className = "trade-toast";
      
      // Colors based on content
      let borderColor = "#0dcaf0"; // info
      let iconClass = "bi-info-circle-fill";
      
      const lowerMsg = message.toLowerCase();
      if(lowerMsg.includes("proposal") || lowerMsg.includes("offer") || lowerMsg.includes("request")) {
          borderColor = "#ffc107"; // warning/gold
          iconClass = "bi-exclamation-circle-fill";
      }
      if(lowerMsg.includes("accepted") || lowerMsg.includes("completed") || lowerMsg.includes("success")) {
          borderColor = "#198754"; // success
          iconClass = "bi-check-circle-fill";
      }
      if(lowerMsg.includes("rejected") || lowerMsg.includes("failed") || lowerMsg.includes("error")) {
          borderColor = "#dc3545"; // danger
          iconClass = "bi-x-circle-fill";
      }

      Object.assign(toast.style, {
          background: "rgba(18, 20, 30, 0.95)",
          color: "white",
          padding: "15px 20px",
          borderRadius: "8px",
          borderLeft: `5px solid ${borderColor}`,
          boxShadow: "0 5px 20px rgba(0,0,0,0.6)",
          width: "320px",
          maxWidth: "400px",
          pointerEvents: "auto",
          backdropFilter: "blur(10px)",
          border: `1px solid rgba(255,255,255,0.1)`,
          borderLeftWidth: "4px",
          fontFamily: "'Rajdhani', sans-serif",
          fontSize: "1.1rem",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          marginBottom: "10px",
          position: "relative",
          cursor: onClickAction ? "pointer" : "default",
          transition: "transform 0.3s ease-out, opacity 0.3s ease-out",
          transform: "translateX(100%)", // Start off-screen
          opacity: "0"
      });

      toast.innerHTML = `
        <i class="bi ${iconClass}" style="color: ${borderColor}; font-size: 1.5rem;"></i>
        <div style="flex-grow: 1;">
            <div class="d-flex justify-content-between align-items-center mb-1">
                <span class="fw-bold text-white-50" style="font-size: 0.75rem; letter-spacing: 1px; text-transform: uppercase;">TRADE ALERT</span>
                <button class="btn-close btn-close-white close-toast-btn" style="font-size: 0.7rem; opacity: 0.8;"></button>
            </div>
            <div style="line-height: 1.3; font-size: 0.95rem;">${message}</div> 
            ${onClickAction ? '<div style="font-size: 0.75rem; text-decoration: underline; color: #aaa; margin-top: 4px;">Click to view</div>' : ''}
        </div>
      `;

      // Add close handler
      toast.querySelector('.close-toast-btn').onclick = (e) => {
          e.stopPropagation();
          this.removeToast(toast);
      };

      // Add click action handler
      if (onClickAction) {
          toast.addEventListener('click', () => {
              onClickAction();
              this.removeToast(toast);
          });
      }

      container.appendChild(toast);

      // Animate In
      requestAnimationFrame(() => {
          toast.style.transform = "translateX(0)";
          toast.style.opacity = "1";
      });
      
      // Auto Remove (5 seconds)
      setTimeout(() => {
          this.removeToast(toast);
      }, 5000);
  }

  removeToast(toast) {
      if (!toast) return;
      toast.style.transform = "translateX(100%)";
      toast.style.opacity = "0";
      setTimeout(() => {
          if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
  }
}

// Global Instance
const tradeSystem = new TradeSystem();
window.tradeSystem = tradeSystem;
