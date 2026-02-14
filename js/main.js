/*
|-------------------------------------------------------------
| File: main.js
| Project: CryptoEX - Core Logic
| Description: Handles Auth, Admin, Trading, and Data Fetching
|-------------------------------------------------------------
*/
'use strict';

window.userSystem = null;
window.tradingSystem = null;
window.systemConfig = null;

// Touch Device Detection & Optimization
const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
if (isTouchDevice) {
  document.documentElement.classList.add('is-touch');
  // Prevent double-tap to zoom on buttons
  document.addEventListener('click', (event) => {
    if (event.target.matches('button, .btn, a')) {
      // Logic handled by touch-action: manipulation in CSS, but explicit handling can go here if needed
    }
  }, { passive: true });
}



/**
 * Admin Logic
 */
window.isAdmin = function () {
  const user = window.userSystem ? window.userSystem.currentUser : null;
  if (!user) {
    console.log('User not authorized');
    return false;
  }

  // Strict checks
  if (user.uid === 'ansron55@gamil.com' || user.email === 'ansron55@gamil.com' || user.email === 'ansron55@gmail.com') return true;
  if (user.isAdmin === true) return true;
  if (user.role === 'admin') return true;

  return false;
};



/**
 * System Configuration (Dynamic Pairs/Assets)
 */
class SystemConfig {
  constructor() {
    this.pairs = JSON.parse(localStorage.getItem('sys_pairs')) || ['BTCUSDT', 'ETHUSDT', 'LTCUSDT', 'XRPUSDT', 'BNBUSDT'];
    this.assets = JSON.parse(localStorage.getItem('sys_assets')) || ['USDT', 'BTC', 'ETH', 'LTC', 'XRP', 'BNB'];
  }

  addPair(symbol) {
    // expect symbol like 'DOGE'
    const upper = symbol.toUpperCase();
    const pair = `${upper}USDT`;

    if (this.pairs.includes(pair)) return false;

    this.pairs.push(pair);
    if (!this.assets.includes(upper)) this.assets.push(upper);

    this.save();
    return true;
  }

  removePair(pair) {
    this.pairs = this.pairs.filter(p => p !== pair);
    // We keep asset in wallet list to avoid errors if they have balance
    this.save();
  }

  save() {
    localStorage.setItem('sys_pairs', JSON.stringify(this.pairs));
    localStorage.setItem('sys_assets', JSON.stringify(this.assets));
  }
}

/**
 * User System: Auth, Roles, Persistence
 */
class UserSystem {
  constructor() {
    this.currentUser = null; // Will be set by onAuthStateChanged
    this.isAdmin = false;
    this.initAuthListener();
  }

  initAuthListener() {
    if (!window.auth) return;
    window.auth.onAuthStateChanged(async (user) => {
      // Prevent listener from overwriting if we are in the middle of registration
      if (window.isRegistering) {
        console.log("Registration in progress, skipping auth listener logic.");
        return;
      }

      const path = window.location.pathname;
      const page = path.split("/").pop();

      if (user) {
        // User is signed in
        if (!this.currentUser) {
          this.currentUser = { uid: user.uid, email: user.email, role: 'user', wallet: {} };
        }

        // 2. Fetch/Create Firestore Profile
        try {
          const doc = await window.db.collection('users').doc(user.uid).get();

          // --- REAL WALLET IMPLEMENTATION ---
          let walletData = { USDT: 0, BTC: 0, TRX: 0 };
          try {
            const walletDoc = await window.db.collection('wallets').doc(user.uid).get();
            if (walletDoc.exists) {
              walletData = walletDoc.data();
            } else {
              // Create default wallet if missing
              console.log("Creating new real wallet...");
              await window.db.collection('wallets').doc(user.uid).set(walletData);
            }
          } catch (e) {
            console.error("Wallet Fetch Error", e);
            // Fallback to empty wallet to prevent crash
            walletData = {};
          }
          // ----------------------------------

          if (doc.exists) {
            // Merge firestore data
            this.currentUser = { ...this.currentUser, ...doc.data(), wallet: walletData };
          } else {
            console.log("Profile missing, creating MINIMAL defaults...");
            // Requirement 2: Create with minimal fields
            const newProfile = {
              email: user.email,
              name: 'User',
              role: 'user',
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            await window.db.collection('users').doc(user.uid).set(newProfile);
            // Also ensure wallet doc exists (empty)
            if (!walletData || Object.keys(walletData).length === 0) {
              await window.db.collection('wallets').doc(user.uid).set({});
            }

            this.currentUser = { ...this.currentUser, ...newProfile, wallet: walletData };
          }
        } catch (e) {
          console.error("Profile Fetch Error", e);
        }



        this.isAdmin = (this.currentUser.role === 'admin');

        // Redirect logic for Login/Register pages
        if (page === 'login.html' || page === 'register.html') {
          window.location.href = 'trade.html';
        }

      } else {
        // User is signed out
        this.currentUser = null;
        this.isAdmin = false;

        // Redirect protected pages
        if (page === 'profile.html' || page === 'admin.html') {
          window.location.href = 'login.html';
        }
      }

      this.updateAuthUI();
      this.updateAuthUI();
      if (window.tradingSystem) {
        try { window.tradingSystem.syncWithUser(); } catch (e) { console.warn("Trading sync error", e); }
      }
      if (window.futuresSystem) {
        try { window.futuresSystem.syncWithUser(); } catch (e) { console.warn("Futures sync error", e); }
      }
      if (typeof initGlobalChatListener === 'function') {
        try { initGlobalChatListener(user.uid); } catch (e) { console.warn("Chat listener error", e); }
      }
    });
  }

  async register(name, email, password, phone, country) {
    if (!window.auth) return swal("Error", "Firebase not initialized", "error");

    // Set Flag to BLOCK listener from interfering
    window.isRegistering = true;

    try {
      const cred = await window.auth.createUserWithEmailAndPassword(email, password);
      const user = cred.user;

      // Send verification email
      user.sendEmailVerification().catch(err => console.error("Email verification failed", err));

      // Create Firestore Profile IMMEDIATELY
      const newUserProfile = {
        name: name,
        email: email,
        phone: phone,
        country: country,
        role: "user",
        wallet: { 'USDT': 10000 }, // Bonus for new users
        transactions: [],
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      // Initialize 0 balance for known assets
      if (window.systemConfig) window.systemConfig.assets.forEach(a => { if (!newUserProfile.wallet[a]) newUserProfile.wallet[a] = 0; });

      await window.db.collection('users').doc(user.uid).set(newUserProfile);
      console.log("User profile created explicitly in register.");

      swal("Success", "Account created!", "success");

      // Allow listener to take over on next page load or manually set state
      // Manually set state to avoid listener race
      this.currentUser = { ...newUserProfile, uid: user.uid };
      this.updateAuthUI();

      setTimeout(() => {
        window.isRegistering = false;
        window.location.href = 'trade.html';
      }, 1500);

    } catch (error) {
      console.error("Register Error", error);
      swal("Error", error.message, "error");
      window.isRegistering = false;
    }
  }

  async login(email, password) {
    if (!window.auth) return swal("Error", "Firebase not initialized", "error");
    try {
      await window.auth.signInWithEmailAndPassword(email, password);
      swal("Success", "Welcome back!", "success");
      // Redirect handled by listener
    } catch (error) {
      swal("Error", error.message, "error");
    }
  }

  async logout() {
    if (!window.auth) return;
    try {
      await window.auth.signOut();
      this.currentUser = null;
      this.isAdmin = false;
      swal("Logged Out", "You have been logged out.", "success");
      // Redirect handled by listener
    } catch (e) {
      console.error(e);
    }
  }

  async updateProfile(data) {
    const user = window.auth.currentUser;
    if (!user) return swal("Error", "You must be logged in.", "error");

    try {
      data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      await window.db.collection('users').doc(user.uid).update(data);
      // Update local state if it matches
      if (this.currentUser && this.currentUser.uid === user.uid) {
        Object.assign(this.currentUser, data);
      }
      swal("Success", "Profile updated successfully.", "success");
      // NO reload, UI should update reactively or via callback
    } catch (e) {
      swal("Error", "Could not update profile: " + e.message, "error");
    }
  }

  async saveUser() {
    // Sync current user state to Firestore
    // NOTE: We do NOT save wallet here anymore, as it's handled transactionally in buy/sell
    // We only save profile data if needed
    if (!this.currentUser || !this.currentUser.uid) return;
    try {
      await window.db.collection('users').doc(this.currentUser.uid).update({
        // wallet: this.currentUser.wallet, // DISABLED
        // transactions: this.currentUser.transactions, // DISABLED
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {
      console.error("Save User Sync Error", e);
    }
  }

  updateAuthUI() {
    requestAnimationFrame(() => {
      if (this.currentUser) {
        $('.guest-only').hide();
        $('.user-only').removeClass('d-none').show().css('display', 'flex');
      } else {
        $('.user-only').hide();
        $('.admin-only').hide();
        $('.guest-only').removeClass('d-none').show();
      }
    });
  }
}

/**
 * Trading System
 */
class TradingSystem {
  constructor() {
    this.currentPair = window.systemConfig ? systemConfig.pairs[0] : 'BTCUSDT';
    this.quoteAsset = 'USDT';
    this.baseAsset = this.currentPair.replace('USDT', '');
    this.currentPrices = {};

    // Chart Config
    this.chartType = localStorage.getItem('chartType') || 'candlestick';
    this.chartRef = null;
    this.chartData = []; // Cache for data
    this.simInterval = null;

    this.wallet = {};
    this.transactions = [];

    this.syncWithUser();

    // Defer pair parsing to ensure DOM needs
    setTimeout(() => {
      this.parsePair(this.currentPair);
      this.startSimulation();
    }, 500);
  }

  syncWithUser() {
    if (window.userSystem && window.userSystem.currentUser) {
      this.wallet = window.userSystem.currentUser.wallet || {};
      this.transactions = window.userSystem.currentUser.transactions || [];
    } else {
      this.wallet = {};
      // Demo logic: Show 0 for guests to encourage login
      if (window.systemConfig) systemConfig.assets.forEach(a => this.wallet[a] = 0);
      this.transactions = [];
    }
    this.updateUI();
  }

  setChartType(type) {
    if (this.chartType === type) return;
    this.chartType = type;
    localStorage.setItem('chartType', type);

    // update btn styles
    this.updateChartTypeButtons();

    // re-render preserving data
    this.renderChart(true);
  }

  updateChartTypeButtons() {
    // Just a visual helper if buttons exist
    const types = ['candlestick', 'line', 'area'];
    types.forEach(t => {
      // You might want to update DOM classes here if specific IDs existed
      // For now, we rely on the click action which is enough
    });
  }

  parsePair(pair) {
    this.currentPair = pair;
    this.baseAsset = pair.replace('USDT', '');

    // UI Updates
    $('.coin-name span').text(`${this.baseAsset}/${this.quoteAsset}`);
    $('.base-asset-name').text(this.baseAsset);
    $('.quote-asset-name').text(this.quoteAsset);
    $('#buy-amount, #sell-amount, #buy-total, #sell-total').val('');

    // Reset Data Cache
    this.chartData = [];

    // Fetch Data & Render
    this.renderChart();

    // Trigger tick immediately
    if (window.refreshDataApp) window.refreshDataApp();
    this.updateUI();
  }



  async renderChart(useCache = false) {
    const containerId = 'DARK_CHART_BTC';
    const container = document.getElementById(containerId);
    if (!container) return;

    // SHADOW DATA FETCHING: Necessary to power the Simulation loop and Trading Forms.
    // Even though we show TradingView, we need 'this.chartData' populated for the app logic.
    if (!useCache || this.chartData.length === 0) {
      let data = await API.getKlines(this.currentPair);
      if (!data || data.length === 0) {
        // Fallback to internal Mock Data if API fails
        data = this.generateMockUsage();
      }
      this.chartData = data;
    }

    // Clear previous chart if needed
    container.innerHTML = "";

    // Map internal pair to Binance symbol format
    const symbol = "BINANCE:" + this.currentPair;

    // Map chartType to TradingView style
    let tvStyle = "1"; // Default Candle
    if (this.chartType === 'line') tvStyle = "2";
    if (this.chartType === 'area') tvStyle = "3";

    new TradingView.widget({
      "width": "100%",
      "height": 450,
      "symbol": symbol,
      "interval": "60",
      "timezone": "Etc/UTC",
      "theme": "dark",
      "style": tvStyle,
      "locale": "en",
      "toolbar_bg": "#0a0a0f",
      "enable_publishing": false,
      "hide_side_toolbar": false,
      "allow_symbol_change": true,
      "container_id": containerId,
      "studies": [
        "RSI@tv-basicstudies"
      ]
    });

    this.chartRef = true; // Just a flag to say we have rendered
  }

  generateMockUsage() {
    // 50 candles
    let data = [];
    let date = new Date();
    date.setHours(date.getHours() - 50);
    let price = 50000;

    for (let i = 0; i < 50; i++) {
      let open = price;
      let close = price + (Math.random() * 200 - 100);
      let high = Math.max(open, close) + Math.random() * 50;
      let low = Math.min(open, close) - Math.random() * 50;

      data.push({
        date: new Date(date),
        open, high, low, close
      });

      price = close;
      date.setHours(date.getHours() + 1);
    }
    return data;
  }

  // --- Real-Time Simulation Engine ---
  startSimulation() {
    if (this.simInterval) clearInterval(this.simInterval);

    let trendDir = 0; // -1 down, 1 up, 0 random
    let trendSteps = 0;

    this.simInterval = setInterval(() => {
      if (!this.chartData || this.chartData.length === 0) return;

      // Get last candle
      if (!this.chartData || this.chartData.length === 0) return;

      let lastStats = this.chartData[this.chartData.length - 1];
      if (!lastStats) return; // Safety check

      let price = lastStats.close;

      // 1. Calculate Trend
      if (trendSteps <= 0) {
        // Pick new trend
        const r = Math.random();
        if (r > 0.6) trendDir = 1; // Bullish
        else if (r < 0.4) trendDir = -1; // Bearish
        else trendDir = 0; // Sideways
        trendSteps = Math.floor(Math.random() * 5) + 3; // 3 to 8 steps
      }
      trendSteps--;

      // 2. Calculate Volatility
      // 0.02% to 0.1% change
      const volatility = price * (0.0002 + Math.random() * 0.0008);
      let change = Math.random() * volatility;

      if (trendDir === 1) price += change;
      else if (trendDir === -1) price -= change;
      else price += (Math.random() > 0.5 ? change : -change);

      // 3. Update Candle
      if (price > lastStats.high) lastStats.high = price;
      if (price < lastStats.low) lastStats.low = price;
      lastStats.close = price;

      // 4. Update UI
      this.updatePrice(this.currentPair, price);

      // 5. Update Chart (Optimized)
      // TradingView handles its own real-time updates via WebSocket internally.
      // We don't need to manually push data to it.
    }, 1500); // Update every 1.5s
  }

  updatePrice(symbol, price) {
    this.currentPrices[symbol] = parseFloat(price);
    if (symbol === this.currentPair) {
      // Calculate change based on Open of the day (first candle logic simplified)
      // or just random stored open. For now, use prev close or logic.
      // Let's rely on Ticker for 24h stats, and this for live price.

      $('#buy-price, #sell-price').val(price.toFixed(price < 1 ? 6 : 2));
      $('.current-price-display').text(price.toFixed(price < 1 ? 6 : 2));

      // Update Title Price
      $('.coin-body-lastp').text(price.toFixed(2));

      // Update Tab Price Little Text
      $(`.price-${symbol}`).text(price.toFixed(2));
    }
  }

  async buy(amount) {
    if (!userSystem.currentUser) return swal("Login Required", "Please login to trade.", "info");

    if (!amount || amount <= 0) return;
    const price = this.currentPrices[this.currentPair];
    const total = amount * price;
    const uid = userSystem.currentUser.uid;

    // Check local balance first (optimistic)
    const balance = this.wallet[this.quoteAsset] || 0;
    if (total > balance) return swal("Insufficient Funds", "Not enough USDT", "error");

    try {
      // --- REAL WALLET TRANSACTION ---
      const walletRef = window.db.collection('wallets').doc(uid);

      await window.db.runTransaction(async (t) => {
        const doc = await t.get(walletRef);
        if (!doc.exists) throw "Wallet not found";

        const data = doc.data();
        const currentUSDT = data[this.quoteAsset] || 0;
        const currentAsset = data[this.baseAsset] || 0;

        const newUSDT = currentUSDT - total;
        const newAsset = currentAsset + amount;

        if (total > currentUSDT) throw "Insufficient Funds (USDT) for transaction"; // Validation
        // Prevent negative balances strictly
        if (newUSDT < 0) throw "Negative balance detected";

        t.update(walletRef, {
          [this.quoteAsset]: newUSDT,
          [this.baseAsset]: newAsset
        });

        // Log Transaction (Unified Schema)
        const newTx = {
          uid: uid,
          email: userSystem.currentUser.email,
          type: 'BUY',
          asset: this.baseAsset,
          amount: amount,
          price: price,
          total: total,
          time: firebase.firestore.FieldValue.serverTimestamp(),
          source: 'USER'
        };
        t.set(window.db.collection('transactions').doc(), newTx);

        // Update Local State for UI
        this.wallet[this.quoteAsset] = newUSDT;
        this.wallet[this.baseAsset] = newAsset;
        userSystem.currentUser.wallet = this.wallet;
      });

      swal("Success", `Bought ${amount} ${this.baseAsset}`, "success");
      this.updateUI();

    } catch (e) {
      console.error(e);
      swal("Transaction Failed", e.message || e, "error");
    }
  }

  async sell(amount) {
    if (!userSystem.currentUser) return swal("Login Required", "Please login to trade.", "info");

    if (!amount || amount <= 0) return;
    const price = this.currentPrices[this.currentPair];
    const uid = userSystem.currentUser.uid;

    const balance = this.wallet[this.baseAsset] || 0;
    if (amount > balance) return swal("Insufficient Funds", `Not enough ${this.baseAsset}`, "error");

    try {
      // --- REAL WALLET TRANSACTION ---
      const walletRef = window.db.collection('wallets').doc(uid);

      await window.db.runTransaction(async (t) => {
        const doc = await t.get(walletRef);
        if (!doc.exists) throw "Wallet not found";

        const data = doc.data();
        const currentAsset = data[this.baseAsset] || 0;
        const currentUSDT = data[this.quoteAsset] || 0;

        const newAsset = currentAsset - amount;
        const newUSDT = currentUSDT + (amount * price);

        if (amount > currentAsset) throw "Insufficient Assets for transaction"; // Validation
        // Prevent negative balances strictly
        if (newAsset < 0) throw "Negative balance detected";

        t.update(walletRef, {
          [this.baseAsset]: newAsset,
          [this.quoteAsset]: newUSDT
        });

        // Log Transaction (Unified Schema)
        const newTx = {
          uid: uid,
          email: userSystem.currentUser.email,
          type: 'SELL',
          asset: this.baseAsset,
          amount: amount,
          price: price,
          total: (amount * price),
          time: firebase.firestore.FieldValue.serverTimestamp(),
          source: 'USER'
        };
        t.set(window.db.collection('transactions').doc(), newTx);

        // Update Local State for UI
        this.wallet[this.baseAsset] = newAsset;
        this.wallet[this.quoteAsset] = newUSDT;
        userSystem.currentUser.wallet = this.wallet;
      });

      swal("Success", `Sold ${amount} ${this.baseAsset}`, "success");
      this.updateUI();

    } catch (e) {
      console.error(e);
      swal("Transaction Failed", e.message || e, "error");
    }
  }

  addTransaction(type, amount, price, total) {
    this.transactions.unshift({
      id: Date.now(), time: new Date().toLocaleTimeString(),
      pair: this.currentPair, type, amount, price, total
    });
    if (this.transactions.length > 50) this.transactions.pop();
    this.saveState();
  }

  saveState() {
    if (window.userSystem && window.userSystem.currentUser) {
      window.userSystem.currentUser.wallet = this.wallet;
      window.userSystem.currentUser.transactions = this.transactions;
      window.userSystem.saveUser();
    }
    this.updateUI();
  }

  updateUI() {
    const qAmt = this.wallet[this.quoteAsset] || 0;
    const bAmt = this.wallet[this.baseAsset] || 0;
    $('.available-quote').text(`${qAmt.toFixed(2)} ${this.quoteAsset}`);
    $('.available-base').text(`${bAmt.toFixed(6)} ${this.baseAsset}`);

    const $hist = $('#active-orders tbody');
    if ($hist.length) {
      $hist.empty();
      this.transactions.forEach(tx => {
        let displayType = tx.type;
        if (displayType === 'ADMIN_EDIT') displayType = 'Replenished';

        let c = 'text-white';
        if (displayType === 'BUY' || displayType === 'DEPOSIT') c = 'text-success';
        if (displayType === 'SELL' || displayType === 'WITHDRAW') c = 'text-danger';
        if (displayType === 'Replenished') c = 'text-warning';

        const reason = tx.closeReason || 'Manual';
        const sl = tx.stopLoss ? 'SL:' + tx.stopLoss + '%' : '';
        const tp = tx.takeProfit ? 'TP:' + tx.takeProfit : '';
        let details = (sl || tp) ? `${sl} ${tp}` : '—';

        // Add Status for Deposit/Withdraw
        if (tx.status && tx.status !== 'completed') {
          details += ` <span class="badge badge-warning">${tx.status}</span>`;
        } else if (tx.status === 'completed' || tx.status === 'approved') {
          details += ` <span class="badge badge-success">Success</span>`;
        } else if (tx.status === 'rejected') {
          details += ` <span class="badge badge-danger">Rejected</span>`;
        }

        $hist.append(`<tr><td>${tx.time}</td><td>${tx.pair || tx.asset}</td><td class="${c}"><strong>${displayType}</strong></td><td>${parseFloat(tx.price || 0).toFixed(2)}</td><td>${parseFloat(tx.amount || 0).toFixed(6)}</td><td>${parseFloat(tx.total || 0).toFixed(2)}</td><td>${reason}</td><td><small>${details}</small></td></tr>`);
      });
    }

    const $bal = $('#balance tbody');
    if ($bal.length) {
      $bal.empty();
      // Show Non-Zero balances
      for (const [c, a] of Object.entries(this.wallet)) {
        if (a > 0 || c === 'USDT' || c === 'BTC') $bal.append(`<tr><th>${c}</th><td>${a.toFixed(8)}</td></tr>`);
      }
    }
  }
}

/**
 * API & Ticker
 */
const API = {
  baseUrl: 'https://api.binance.com/api/v3',
  async getKlines(s) {
    try {
      return (await fetch(`${this.baseUrl}/klines?symbol=${s}&interval=1h&limit=50`).then(r => r.json())).map(c => ({
        date: new Date(c[0]), open: +c[1], high: +c[2], low: +c[3], close: +c[4]
      }));
    } catch (e) { return []; }
  },
  async getOrderBook(s) { try { return await fetch(`${this.baseUrl}/depth?symbol=${s}&limit=5`).then(r => r.json()) } catch (e) { return { bids: [], asks: [] } } },
  async getTrades(s) { try { return await fetch(`${this.baseUrl}/trades?symbol=${s}&limit=20`).then(r => r.json()) } catch (e) { return [] } },
  async getTicker(s) { try { return await fetch(`${this.baseUrl}/ticker/24hr?symbol=${s}`).then(r => r.json()) } catch (e) { return {} } },
  async getAllTickers() { try { return await fetch(`${this.baseUrl}/ticker/24hr`).then(r => r.json()) } catch (e) { return [] } }

};

/**
 * Futures Trading System
 */
class FuturesSystem {
  constructor() {
    this.positions = [];
    this.history = []; // Init history
    this.leverage = 10;
    this.initListeners();
  }

  initListeners() {
    // Leverage Slider
    $('#leverage-slider').on('input', (e) => {
      this.leverage = parseInt(e.target.value);
      this.updateEstLiq();
    });

    // Amount Input
    $('#f-amount').on('input', () => this.updateEstLiq());

    // Buttons
    const bindClickOrTouch = (selector, handler) => {
      $(selector).on('click touchstart', function (e) {
        e.stopPropagation(); // Prevent ghost clicks
        if (e.type === 'touchstart') {
          $(this).off('click'); // momentarily disable click to prevent double firing if not using stopProp
          setTimeout(() => $(this).on('click', function (e) { e.stopPropagation(); }), 400);
        }
        handler(e);
      });
    };

    $('.btn-long-trigger').click((e) => { e.preventDefault(); this.openPosition('LONG'); });
    $('.btn-short-trigger').click((e) => { e.preventDefault(); this.openPosition('SHORT'); });
  }

  async syncWithUser() {
    const user = window.userSystem.currentUser;
    if (!user) {
      this.positions = [];
      this.history = []; // New history array
      this.updateUI();
      return;
    }

    // Load positions from Firestore: positions/{uid}
    try {
      const doc = await window.db.collection('positions').doc(user.uid).get();
      if (doc.exists) {
        const allPositions = doc.data().list || [];
        this.positions = allPositions.filter(p => p.status !== 'closed');
        this.history = allPositions.filter(p => p.status === 'closed').sort((a, b) => (b.closedAt?.seconds || 0) - (a.closedAt?.seconds || 0));
      } else {
        this.positions = [];
        this.history = [];
      }
      this.updateUI();
      this.renderHistory(); // Render history
    } catch (e) {
      console.error("Failed to load positions", e);
    }
  }

  // ... (savePositions remains same)

  renderHistory() {
    const $tbody = $('#history-positions tbody');
    $tbody.empty();

    if (this.history.length === 0) {
      $tbody.html('<tr><td colspan="7" class="text-center text-muted">No closed positions</td></tr>');
      return;
    }

    this.history.forEach(p => {
      // Normalize fields
      const pair = p.pair || p.symbol || 'UNKNOWN';
      const type = p.type || p.side || 'LONG';
      const entry = parseFloat(p.entry || p.entryPrice || 0);
      const closePrice = parseFloat(p.closePrice || 0);
      const pnl = parseFloat(p.pnl || 0);

      // Normalize Reason
      let reason = p.closeReason || '-';
      // Strict sanitization of legacy data
      if (reason.toLowerCase().includes('admin')) {
        reason = pnl >= 0 ? 'Take Profit' : 'Stop Loss';
      }

      const pnlClass = pnl >= 0 ? 'text-success' : 'text-danger';
      const pnlSign = pnl >= 0 ? '+' : '';
      const timeStr = p.closedAt ? new Date(p.closedAt.seconds * 1000).toLocaleString() : '-';

      const row = `
            <tr>
                <td><small>${timeStr}</small></td>
                <td>${pair}</td>
                <td><span class="badge badge-${type === 'LONG' ? 'success' : 'danger'}">${type}</span></td>
                <td>${entry.toFixed(2)}</td>
                <td>${closePrice.toFixed(2)}</td>
                <td class="${pnlClass} font-weight-bold">${pnlSign}${pnl.toFixed(2)} USDT</td>
                <td><small>${reason}</small></td>
            </tr>
        `;
      $tbody.append(row);
    });
  }

  updateEstLiq() {
    const margin = parseFloat($('#f-amount').val()) || 0;
    if (margin <= 0 || !tradingSystem.currentPrices[tradingSystem.currentPair]) {
      $('#est-liq').text('---');
      $('#est-margin').text('0.00');
      return;
    }

    const price = tradingSystem.currentPrices[tradingSystem.currentPair];
    const size = (margin * this.leverage) / price; // Size in Coins
    const entry = price;

    // Bankruptcy Price simplified
    // Long: Entry * (1 - 1/Lev)
    // Short: Entry * (1 + 1/Lev)
    const liqLong = entry * (1 - 1 / this.leverage);
    const liqShort = entry * (1 + 1 / this.leverage);

    $('#est-margin').text(margin.toFixed(2) + ' USDT');
    $('#est-liq').text(`L: ${liqLong.toFixed(2)} | S: ${liqShort.toFixed(2)}`);
  }

  async openPosition(side) {
    if (!window.userSystem.currentUser) return swal("Login Required", "Please login to trade futures.", "info");

    const margin = parseFloat($('#f-amount').val());
    if (!margin || margin <= 0) return swal("Invalid Amount", "Please enter a valid margin amount.", "error");

    // 1. Validate Balance Local (Fast Fail)
    const currentBalance = window.userSystem.currentUser.wallet['USDT'] || 0;
    if (margin > currentBalance) return swal("Insufficient Balance", "Not enough USDT in wallet.", "error");

    const pair = tradingSystem.currentPair;
    const price = tradingSystem.currentPrices[pair];
    const uid = window.userSystem.currentUser.uid;
    const size = (margin * this.leverage) / price;

    // Read SL/TP (Prices)
    let sl = parseFloat($('#f-sl').val());
    let tp = parseFloat($('#f-tp').val());

    // Validation Logic (Price based)
    if (side === 'LONG') {
      if (sl > 0 && sl >= price) return swal("Invalid Stop Loss", "For LONG, Stop Loss must be lower than entry price.", "error");
      if (tp > 0 && tp <= price) return swal("Invalid Take Profit", "For LONG, Take Profit must be higher than entry price.", "error");
    } else {
      // SHORT
      if (sl > 0 && sl <= price) return swal("Invalid Stop Loss", "For SHORT, Stop Loss must be higher than entry price.", "error");
      if (tp > 0 && tp >= price) return swal("Invalid Take Profit", "For SHORT, Take Profit must be lower than entry price.", "error");
    }

    try {
      // --- REAL WALLET TRANSACTION ---
      await window.db.runTransaction(async (t) => {
        const walletRef = window.db.collection('wallets').doc(uid);
        const posRef = window.db.collection('positions').doc(uid);

        // --- READS FIRST (Strict Order) ---
        const doc = await t.get(walletRef);
        const posDoc = await t.get(posRef);

        // --- LOGIC ---
        let walletData = {};
        if (doc.exists) walletData = doc.data();

        const currentUSDT = walletData['USDT'] || 0;

        if (margin > currentUSDT) throw "Insufficient USDT Balance (Server Check)";
        const newUSDT = currentUSDT - margin;

        if (newUSDT < 0) throw "Negative Balance Detected";

        // Prepare Position List
        let list = [];
        if (posDoc.exists) list = posDoc.data().list || [];

        const position = {
          id: Date.now(),
          symbol: pair,
          side: side,
          size: size,
          entryPrice: price,
          leverage: this.leverage,
          margin: margin,
          liqPrice: side === 'LONG' ? price * (1 - 1 / this.leverage) : price * (1 + 1 / this.leverage),
          stopLoss: (sl > 0) ? sl : null,
          takeProfit: (tp > 0) ? tp : null,
          timestamp: Date.now()
        };

        list.push(position);

        // --- WRITES LAST (Strict Order) ---

        // 1. Update Wallet
        if (!doc.exists) {
          t.set(walletRef, { 'USDT': newUSDT });
        } else {
          t.update(walletRef, { 'USDT': newUSDT });
        }

        // 2. Update Positions
        if (!posDoc.exists) {
          t.set(posRef, { list: list, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        } else {
          t.update(posRef, { list: list, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        }

        // 3. Log Transaction
        const newTx = {
          uid: uid,
          email: window.userSystem.currentUser.email,
          type: side === 'LONG' ? 'OPEN LONG' : 'OPEN SHORT',
          asset: pair,
          amount: size,
          price: price,
          total: margin, // Margin used
          time: firebase.firestore.FieldValue.serverTimestamp(),
          source: 'FUTURES',
          details: `Lev: ${this.leverage}x`
        };
        t.set(window.db.collection('transactions').doc(), newTx);

        // Update Local State immediately
        this.positions = list;
        window.userSystem.currentUser.wallet['USDT'] = newUSDT;
      });

      console.log(`[Futures] Opened ${side} position using ${margin} USDT`);
      this.updateUI();
      swal("Success", `${side} ${this.leverage}x Opened! Balance Updated.`, "success");

    } catch (e) {
      console.error("Open Position Error", e);
      swal("Trade Failed", e.message || e, "error");
    }
  }

  async closePosition(id, reason = 'Manual') {
    const idx = this.positions.findIndex(p => p.id === id);
    if (idx === -1) return;

    const pos = this.positions[idx];
    const price = tradingSystem.currentPrices[pos.symbol] || pos.entryPrice;
    const uid = window.userSystem.currentUser.uid;

    console.log(`[Futures] Attempting to close position ${id}. Reason: ${reason}`);

    try {
      await window.db.runTransaction(async (t) => {
        // 1. Get Wallet
        const walletRef = window.db.collection('wallets').doc(uid);
        const wDoc = await t.get(walletRef);
        if (!wDoc.exists) throw "Wallet not found for closing position";

        const wData = wDoc.data();
        const currentUSDT = wData['USDT'] || 0;

        // 2. Refetch positions to ensure existence in DB (avoid race)
        const posRef = window.db.collection('positions').doc(uid);
        const pDoc = await t.get(posRef);
        if (!pDoc.exists) throw "Position list not found";

        let list = pDoc.data().list || [];
        const freshIdx = list.findIndex(p => p.id === id);

        if (freshIdx === -1) {
          // If already closed by another trigger, just return silently or throw
          console.warn("Position already closed in DB.");
          return;
        }

        // 3. Calculate PnL
        // Use passed price which is current market price
        let pnl = 0;
        if (pos.side === 'LONG') {
          pnl = (price - pos.entryPrice) * pos.size;
        } else {
          pnl = (pos.entryPrice - price) * pos.size;
        }

        const returnAmount = pos.margin + pnl;
        const newUSDT = currentUSDT + returnAmount;

        // Prevent Negative Wallet Balance even if PnL is huge loss?
        // Usually exchange allows 0 but not negative. 
        // If returnAmount is negative (loss > margin), it means user OWES money?
        // Standard Futures: Maximum loss is Margin (Liquidation). 
        // Ideally Liquidation triggers before this. 
        // If returnAmount < 0, we set to 0 (Bankruptcy coverage not implemented, assuming isolated margin logic where you lose max margin).
        // But let's apply simple math:

        let finalUpdateUSDT = newUSDT;
        if (finalUpdateUSDT < 0) finalUpdateUSDT = 0; // Simple protection

        // 4. Update Wallet
        t.update(walletRef, { 'USDT': finalUpdateUSDT });

        // 5. Update Positions (Remove)
        list.splice(freshIdx, 1);
        t.update(posRef, { list: list, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });

        // 6. Log Transaction
        const newTx = {
          uid: uid,
          email: window.userSystem.currentUser.email,
          type: pos.side === 'LONG' ? 'CLOSE LONG' : 'CLOSE SHORT',
          asset: pos.symbol,
          amount: pos.size,
          price: price,
          total: returnAmount, // Net change to wallet (Margin + PnL)
          pnl: pnl,
          stopLoss: pos.stopLoss ? pos.stopLoss + '%' : '—',
          takeProfit: pos.takeProfit ? pos.takeProfit : '—',
          closeReason: reason,
          time: firebase.firestore.FieldValue.serverTimestamp(),
          source: 'FUTURES'
        };
        t.set(window.db.collection('transactions').doc(), newTx);

        // 7. Update Local State
        this.positions = list;
        window.userSystem.currentUser.wallet['USDT'] = finalUpdateUSDT;
      });

      this.updateUI();

      // Custom message based on reason
      let msgType = "success";
      if (reason === 'Liquidation') msgType = "error";
      else if (reason.includes("Stop Loss")) msgType = "warning";

      // Calc PnL for display
      let pnlDisplay = 0;
      if (pos.side === 'LONG') pnlDisplay = (price - pos.entryPrice) * pos.size;
      else pnlDisplay = (pos.entryPrice - price) * pos.size;

      if (reason === 'Manual') {
        swal(`Closed: ${reason}`, `PnL: ${pnlDisplay.toFixed(2)} USDT. Balance Updated.`, msgType);
      } else {
        // Toast or small notification for auto-close?
        console.log(`Auto-closed position: ${reason}. PnL: ${pnlDisplay}`);
        // If user is watching, show Alert
        // swal(`Auto-Closed: ${reason}`, `PnL: ${pnlDisplay.toFixed(2)} USDT`, msgType);
      }

    } catch (e) {
      console.error("Close Position Error", e);
      if (reason === 'Manual') swal("Close Failed", e.message || e, "error");
    }
  }

  update(currentPrices) {
    if (this.positions.length === 0) return;

    const $rows = $('#active-positions tbody tr');

    this.positions.forEach((p, index) => {
      const price = currentPrices[p.symbol];
      if (!price) return;

      // PnL Calc
      let pnl = 0;
      let roe = 0;
      if (p.side === 'LONG') {
        pnl = (price - p.entryPrice) * p.size;
        roe = (pnl / p.margin) * 100;
      } else {
        pnl = (p.entryPrice - price) * p.size;
        roe = (pnl / p.margin) * 100;
      }

      // Liquidation Check
      let liquidated = false;
      if (p.side === 'LONG' && price <= p.liqPrice) liquidated = true;
      if (p.side === 'SHORT' && price >= p.liqPrice) liquidated = true;

      // Stop Loss / Take Profit Check (Price Based)
      let slTriggered = false;
      let tpTriggered = false;

      if (!liquidated) {
        if (p.stopLoss) {
          if (p.side === 'LONG' && price <= p.stopLoss) slTriggered = true;
          if (p.side === 'SHORT' && price >= p.stopLoss) slTriggered = true;
        }
        if (p.takeProfit) {
          if (p.side === 'LONG' && price >= p.takeProfit) tpTriggered = true;
          if (p.side === 'SHORT' && price <= p.takeProfit) tpTriggered = true;
        }
      }

      if (liquidated) {
        this.closePosition(p.id, 'Liquidation');
        return;
      }

      if (slTriggered || tpTriggered) {
        const reason = slTriggered ? "Stop Loss" : "Take Profit";
        this.closePosition(p.id, reason);
        return;
      }

      // Update specific row if exists, else redraw all (lazy redraw for now in updateUI called sparingly, 
      // but for real-time we should update DOM elements directly. 
      // For simplicity let's update text if row exists.
      const $row = $(`#pos-${p.id}`);
      if ($row.length) {
        const color = pnl >= 0 ? 'text-success' : 'text-danger';
        $row.find('.pnl-cell').html(`<span class="${color}">${pnl.toFixed(2)} (${roe.toFixed(2)}%)</span>`);
        $row.find('.mark-price-cell').text(price.toFixed(2));
      }
    });
  }

  updateUI() {
    const $tbody = $('#active-positions tbody');
    $tbody.empty();

    this.positions.forEach(p => {
      const price = tradingSystem.currentPrices[p.symbol] || p.entryPrice;
      let pnl = 0;
      let roe = 0;
      // Recalc for initial render
      if (p.side === 'LONG') {
        pnl = (price - p.entryPrice) * p.size;
        roe = (pnl / p.margin) * 100;
      } else {
        pnl = (p.entryPrice - price) * p.size;
        roe = (pnl / p.margin) * 100;
      }

      const color = pnl >= 0 ? 'text-success' : 'text-danger';
      const sideColor = p.side === 'LONG' ? 'text-success' : 'text-danger';

      const slText = p.stopLoss ? parseFloat(p.stopLoss).toFixed(2) : '—';
      const tpText = p.takeProfit ? parseFloat(p.takeProfit).toFixed(2) : '—';

      $tbody.append(`
        <tr id="pos-${p.id}">
          <td><strong>${p.symbol.replace('USDT', '')}</strong> <span class="${sideColor} small">${p.side} ${p.leverage}x</span></td>
          <td>${p.size.toFixed(4)}</td>
          <td>${p.entryPrice.toFixed(2)}</td>
          <td class="mark-price-cell">${price.toFixed(2)}</td>
          <td class="text-warning">${p.liqPrice.toFixed(2)}</td>
          <td>${p.margin.toFixed(2)}</td>
          <td>
            <small class="d-block text-danger">SL: ${slText}</small>
            <small class="d-block text-success">TP: ${tpText}</small>
          </td>
          <td class="pnl-cell"><span class="${color}">${pnl.toFixed(2)} (${roe.toFixed(2)}%)</span></td>
          <td><button class="btn btn-sm btn-outline-danger" onclick="futuresSystem.closePosition(${p.id})">Close</button></td>
        </tr>
      `);
    });
  }
}

$(document).ready(function () {
  window.systemConfig = new SystemConfig();
  window.userSystem = new UserSystem();
  window.tradingSystem = new TradingSystem();
  window.futuresSystem = new FuturesSystem();

  // Auth Listeners
  $('#login-form').on('submit', function (e) {
    e.preventDefault();
    const email = $('#login1-email').val();
    const pass = $('#login1-password').val();
    userSystem.login(email, pass);
  });

  $('#register-form').on('submit', function (e) {
    e.preventDefault();
    const p1 = $('#password').val();
    if (p1 !== $('#confirm-password').val()) return swal("Error", "Passwords do not match", "error");
    userSystem.register(
      $('#name').val(),
      $('#email').val(),
      p1,
      $('#phone').val(),
      $('#country').val()
    );
  });



  // Ticker Logic (Marquee)
  if ($('#ticker-wrapper').length) {
    setInterval(() => {
      API.getAllTickers().then(data => {
        if (!data || !Array.isArray(data)) return;
        // Filter only our configured pairs or just top 20
        const relevant = data.filter(t => systemConfig.pairs.includes(t.symbol) || parseFloat(t.volume) > 0).sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 15);
        const $mq = $('#ticker-content');
        $mq.empty();
        relevant.forEach(t => {
          const chg = parseFloat(t.priceChangePercent);
          const color = chg >= 0 ? 'text-success' : 'text-danger';
          $mq.append(`<span class="ticker-item">${t.symbol.replace('USDT', '')} <span class="${color}">${parseFloat(t.lastPrice).toFixed(2)} (${chg.toFixed(2)}%)</span></span>`);
        });
      }).catch(err => console.warn("Ticker update failed:", err));
    }, 5000); // Every 5s update ticker data
  }

  // Trading Page Setup
  if ($('#buy-amount').length) {
    // Tab Generation
    const $tabs = $('#crypt-tab');
    $tabs.empty();
    systemConfig.pairs.forEach((p, i) => {
      const cls = i === 0 ? 'active show' : '';
      $tabs.append(`
                <li class="nav-item">
                    <a href="#${p}" class="nav-link ${cls} text-center" data-toggle="tab" onclick="tradingSystem.parsePair('${p}')">
                        <strong>${p.replace('USDT', '')}</strong><br><small class="price-${p}">...</small>
                    </a>
                </li>
             `);
    });

    // Loop
    window.refreshDataApp = function () {
      if (!tradingSystem) return;
      const pair = tradingSystem.currentPair;

      API.getTicker(pair).then(t => {
        if (t.lastPrice) {
          // tradingSystem.updatePrice(pair, t.lastPrice); // Disabled: Allow simulation to control price
          const chg = parseFloat(t.priceChangePercent);
          // $('.coin-body-lastp').text(parseFloat(t.lastPrice).toFixed(2)); // Disabled
          $('.coin-body-lastpc-mini span').text(chg.toFixed(2) + '%').removeClass('text-success text-danger').addClass(chg >= 0 ? 'text-success' : 'text-danger');
        }
      });

      // Update sidebar prices (Skip current pair to avoid jump)
      systemConfig.pairs.forEach(p => {
        if (p !== pair) {
          API.getTicker(p).then(t => $(`.price-${p}`).text(parseFloat(t.lastPrice).toFixed(2)));
        }
      });

      // Books/Trades
      API.getOrderBook(pair).then(d => {
        $('#asks-body').empty().append(d.asks.slice(0, 5).reverse().map(a => `<tr><td class="text-danger">${parseFloat(a[0]).toFixed(2)}</td><td>${parseFloat(a[1]).toFixed(6)}</td></tr>`).join(''));
        $('#bids-body').empty().append(d.bids.slice(0, 5).map(b => `<tr><td class="text-success">${parseFloat(b[0]).toFixed(2)}</td><td>${parseFloat(b[1]).toFixed(6)}</td></tr>`).join(''));
      });
      API.getTrades(pair).then(d => {
        $('#recent-trades tbody').empty().append(d.slice(0, 15).map(t => {
          const c = t.isBuyerMaker ? 'text-danger' : 'text-success';
          return `<tr><td>${parseFloat(t.price).toFixed(2)}</td><td class="${c}">${parseFloat(t.qty).toFixed(6)}</td><td>${new Date(t.time).toLocaleTimeString()}</td></tr>`;
        }).join(''));
      });

      // Update Futures
      if (window.futuresSystem) window.futuresSystem.update(tradingSystem.currentPrices);
    }
    setInterval(window.refreshDataApp, 2000);
    window.refreshDataApp();

    // Input logic
    $('#buy-amount').on('input', function () { $('#buy-total').val((this.value * tradingSystem.currentPrices[tradingSystem.currentPair]).toFixed(2)); });
    $('.btn-buy-trigger').click(() => tradingSystem.buy(parseFloat($('#buy-amount').val())));
    $('.btn-sell-trigger').click(() => tradingSystem.sell(parseFloat($('#sell-amount').val())));
  }
});

// Sidebar Toggle
window.toggleSidebar = function () {
  const drawer = document.getElementById('sideDrawer');
  const overlay = document.querySelector('.side-drawer-overlay');
  if (drawer) {
    drawer.classList.toggle('open');
    overlay.classList.toggle('open');
  }
};

// Deposit Modal
window.openDepositModal = async function () {
  if (!window.userSystem || !window.userSystem.currentUser) return swal("Login Required", "Please login to deposit funds.", "info");
  $('#depositModal').modal('show');

  // Reset fields
  $('#deposit-amount').val('');
  $('#dep-equiv').text('0.00');
  $('#deposit-address').val('Loading...');
  $('#deposit-qr').hide();

  // Load System Wallets Config
  let walletConfig = {};
  try {
    const doc = await window.db.collection('system').doc('wallets').get();
    if (doc.exists) walletConfig = doc.data();
  } catch (e) { console.error("Wallet Config Load Error", e); }

  // Store config globally or on window for helper access
  window._systemWalletConfig = walletConfig;

  // Populate Select
  const $select = $('#deposit-network');
  $select.empty();

  // 1. Get User Balance for display
  let userWallet = {};
  if (window.userSystem && window.userSystem.currentUser) {
    try {
      const wDoc = await window.db.collection('wallets').doc(window.userSystem.currentUser.uid).get();
      if (wDoc.exists) userWallet = wDoc.data();
    } catch (e) { console.log("Error fetching wallet for modal", e); }
  }

  // Default Assets + Configged Keys
  const assets = window.systemConfig ? window.systemConfig.assets : ['USDT', 'BTC', 'ETH'];

  // Safe defaults
  const options = ['USDT', 'BTC', 'ETH', 'LTC', 'XRP', 'BNB'];
  // Merge with system assets if not present
  assets.forEach(a => {
    // Avoid adding duplicates or legacy network keys if we want strict USDT
    if (!options.includes(a) && !a.includes('_')) options.push(a);
  });

  options.forEach(opt => {
    let label = opt.replace('_', ' ');
    // Attempt to find balance for this asset
    // Asset key in wallet usually matches the ticker (BTC, ETH, USDT)
    let ticker = opt.split('_')[0];
    let bal = userWallet[ticker] || 0;

    $select.append(`<option value="${opt}">${label} - Bal: ${parseFloat(bal).toFixed(4)}</option>`);
  });

  updateDepositAddress();
};

window.updateDepositAddress = function () {
  const network = document.getElementById('deposit-network').value;
  const addressInput = document.getElementById('deposit-address');
  const qrImg = document.getElementById('deposit-qr');
  const warning = document.getElementById('deposit-warning');
  const tickerSpan = document.getElementById('deposit-ticker');

  // Determine Ticker for pricing
  let ticker = network.split('_')[0]; // USDT -> USDT
  tickerSpan.innerText = ticker;

  // Fetch Address from loaded config
  let address = "";
  if (window._systemWalletConfig) {
    // Try exact match first
    if (window._systemWalletConfig[network]) {
      address = window._systemWalletConfig[network];
    }
    // If USDT, fallback to TRC20/ERC20 keys if exact 'USDT' key missing
    else if (network === 'USDT') {
      if (window._systemWalletConfig['USDT_TRC20']) address = window._systemWalletConfig['USDT_TRC20'];
      else if (window._systemWalletConfig['USDT_ERC20']) address = window._systemWalletConfig['USDT_ERC20'];
    }
  }

  if (!address) {
    // Fallback defaults if NOT configured in Admin (to avoid completely broken UI)
    if (network === 'USDT') address = "T9yD14Nj9j7xAB4dbGeiZd1h8jn5zzzzzz"; // Default TRC20
    else if (network === 'BTC') address = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
    else address = "Please contact support for address";
  }

  addressInput.value = address;

  if (address && !address.includes("contact support")) {
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${address}`;
    qrImg.style.display = 'inline-block';
    warning.innerText = `Only send ${network.replace('_', ' ')} to this address.`;
  } else {
    qrImg.style.display = 'none';
    warning.innerText = "Deposits for this asset are currently disabled.";
  }

  calculateDepositEquivalent();
};

window.calculateDepositEquivalent = function () {
  const amt = parseFloat($('#deposit-amount').val()) || 0;
  const ticker = $('#deposit-ticker').text();
  let price = 1; // Default for USDT

  if (ticker !== 'USDT') {
    // Try fetch from TradingSystem
    if (window.tradingSystem && window.tradingSystem.currentPrices) {
      // Try Pair like BTCUSDT
      const pair = `${ticker}USDT`;
      if (window.tradingSystem.currentPrices[pair]) {
        price = window.tradingSystem.currentPrices[pair];
      } else {
        // Try inverse? No.
        // Just keep 1 or try API?
        // For now allow it to be 0 or 1 if price unknown?
        // Let's assume price is 1 if unknown to avoid blocking, or show '...'
      }
    }
  }

  const eq = amt * price;
  $('#dep-equiv').text(eq.toFixed(2));
};

window.copyDepositAddress = function () {
  const copyText = document.getElementById("deposit-address");
  copyText.select();
  document.execCommand("copy");
  swal("Copied!", "Address copied to clipboard.", "success");
};

window.confirmDeposit = async function () {
  const amt = parseFloat($('#deposit-amount').val());
  const asset = document.getElementById('deposit-network').value;
  const address = $('#deposit-address').val();

  if (!amt || amt <= 0) return swal("Error", "Please enter a valid amount", "error");
  if (!address || address.includes("contact support")) return swal("Error", "Invalid Wallet Address", "error");

  $('#depositModal').modal('hide');

  try {
    const uid = window.userSystem.currentUser.uid;
    const email = window.userSystem.currentUser.email;

    const newTx = {
      uid: uid,
      email: email,
      type: 'DEPOSIT',
      asset: asset,
      amount: amt,
      walletAddress: address,
      status: 'pending',
      time: firebase.firestore.FieldValue.serverTimestamp(),
      source: 'USER',
      details: 'Awaiting Approval'
    };

    await window.db.collection('transactions').add(newTx);

    // Update Local History (Hack to show it immediately without reload)
    if (window.tradingSystem) {
      // We need a strictly formatted object for the local array
      const localTx = {
        ...newTx,
        time: new Date().toLocaleTimeString(), // Approx
        total: amt * 1, // Approx logic for display
        price: 1, // Stub
        pair: asset
      };
      window.tradingSystem.transactions.unshift(localTx);
      if (window.tradingSystem.transactions.length > 50) window.tradingSystem.transactions.pop();
      window.tradingSystem.updateUI();
    }

    swal("Запрос отправлен", "Запрос на депозит отправлен. Ожидайте подтверждения.", "success");

  } catch (e) {
    console.error(e);
    swal("Error", "Could not submit deposit: " + e.message, "error");
  }
};

/* =========================================
   WITHDRAWAL SYSTEM
   ========================================= */

window.openWithdrawModal = function () {
  if (!window.userSystem || !window.userSystem.currentUser) return swal("Login Required", "Please login to withdraw funds.", "info");
  $('#withdrawModal').modal('show');
  updateWithdrawBalance();
  // Reset inputs
  $('#withdraw-amount').val('');
  $('#withdraw-address').val('');
};

window.updateWithdrawBalance = function () {
  const asset = $('#withdraw-asset').val();
  const user = window.userSystem.currentUser;
  const balance = (user && user.wallet && user.wallet[asset]) ? user.wallet[asset] : 0;

  $('#withdraw-balance').text(balance.toFixed(8));
  $('#withdraw-ticker').text(asset);

  // Estimate Fee (Mock)
  let fee = 0;
  if (asset === 'USDT') fee = 1;
  if (asset === 'BTC') fee = 0.0005;
  if (asset === 'ETH') fee = 0.005;
  if (asset === 'LTC') fee = 0.01;
  if (asset === 'XRP') fee = 0.25;
  if (asset === 'BNB') fee = 0.001;

  $('#withdraw-fee').text(`${fee} ${asset}`);
};

window.withdrawAll = function () {
  const asset = $('#withdraw-asset').val();
  const user = window.userSystem.currentUser;
  const balance = (user && user.wallet && user.wallet[asset]) ? user.wallet[asset] : 0;

  // Use slightly less than max to cover fee if needed? 
  // Requirement says "MAX" -> "automatically fills max balance"
  // Let's fill max, validation will handle fee check if we implemented fee deduction logic from balance or amount.
  // Simpler: Fill max.
  $('#withdraw-amount').val(balance);
  updateWithdrawTotal();
};

// Helper to update total display
$('#withdraw-amount').on('input', updateWithdrawTotal);
function updateWithdrawTotal() {
  const amount = parseFloat($('#withdraw-amount').val()) || 0;
  $('#withdraw-total').text(amount.toFixed(8));
}

window.confirmWithdraw = async function () {
  if (!window.userSystem || !window.userSystem.currentUser) return;

  const asset = $('#withdraw-asset').val();
  const amount = parseFloat($('#withdraw-amount').val());
  const address = $('#withdraw-address').val().trim();
  const uid = window.userSystem.currentUser.uid;
  const email = window.userSystem.currentUser.email;

  // Validation
  if (!amount || amount <= 0) return swal("Invalid Amount", "Please enter a valid amount.", "error");
  if (!address) return swal("Invalid Address", "Please enter a wallet address.", "error");

  // Validate Address Format (Basic Regex)
  let valid = true;
  if (asset === 'BTC' && !/^[13bc1][a-zA-Z0-9]{25,59}$/.test(address)) valid = false;
  if (asset === 'ETH' && !/^0x[a-fA-F0-9]{40}$/.test(address)) valid = false;
  // Add more if needed, or keep lenient for now as per requirement "Validate format"
  // Let's use a generic length check if specific regex fails or for other coins
  if (address.length < 10) valid = false;

  if (!valid) {
    // Warning but maybe allow if it's a test? No, requirement says "Validate format".
    // Let's be strict for BTC/ETH, loose for others.
    if (asset === 'BTC' || asset === 'ETH') return swal("Invalid Address", `Please enter a valid ${asset} address.`, "error");
  }

  try {
    await window.db.runTransaction(async (t) => {
      const walletRef = window.db.collection('wallets').doc(uid);
      const doc = await t.get(walletRef);
      if (!doc.exists) throw "Wallet not found";

      const walletData = doc.data();
      const currentBalance = walletData[asset] || 0;

      if (amount > currentBalance) throw `Insufficient ${asset} balance.`;

      const newBalance = currentBalance - amount;
      if (newBalance < 0) throw "Negative balance detected.";

      // Deduct
      t.update(walletRef, { [asset]: newBalance });

      // Create Transaction
      const newTx = {
        uid: uid,
        email: email,
        type: 'WITHDRAW',
        asset: asset,
        amount: amount,
        address: address, // Store address
        status: 'pending', // Key status for admin
        time: firebase.firestore.FieldValue.serverTimestamp(),
        source: 'USER'
      };
      t.set(window.db.collection('transactions').doc(), newTx);

      // Update Local
      if (window.userSystem.currentUser.wallet) {
        window.userSystem.currentUser.wallet[asset] = newBalance;
      }
    });

    $('#withdrawModal').modal('hide');
    swal("REQUEST SUBMITTED", "Your withdrawal request has been submitted and is pending admin approval.", "success");

    // Update UI
    if (window.tradingSystem) window.tradingSystem.updateUI();
    if (window.updateWithdrawBalance) window.updateWithdrawBalance(); // useful if modal kept open, but we closed it.

  } catch (e) {
    console.error("Withdraw Error", e);
    swal("Withdraw Failed", e.message || e, "error");
  }
};

// Theme Toggle
// Theme Logic - Forced Dark
window.initTheme = function () {
  document.documentElement.setAttribute('data-theme', 'dark');
}

window.initTheme();

// Support
window.showSupport = function () {
  swal({
    title: "Support",
    text: "Please contact support@fxbit.io or use the Live Chat widget.",
    type: "info",
    confirmButtonText: "Close"
  });
  if ($('.side-drawer').hasClass('open')) toggleSidebar();
};

// Language
window.changeLanguage = function () {
  swal("Language", "Language selection is currently fixed to English (EN).", "info");
  if ($('.side-drawer').hasClass('open')) toggleSidebar();
};

// Logout (from sidebar)
window.logout = function () {
  if (window.userSystem) window.userSystem.logout();
  if ($('.side-drawer').hasClass('open')) toggleSidebar();
};

/* =========================================
   SUPPORT CHAT SYSTEM (User Side)
   ========================================= */

let chatUnsubscribe = null;
let currentChatId = null;

function openSupportChat() {
  if (!window.userSystem || !window.userSystem.currentUser) return swal("Login Required", "Please login to contact support.", "info");

  $('#supportModal').modal('show');
  const uid = window.userSystem.currentUser.uid;
  currentChatId = uid;

  // Subscribe to messages
  if (chatUnsubscribe) chatUnsubscribe(); // Unsubscribe prev if any

  const chatRef = window.db.collection('chats').doc(uid).collection('messages').orderBy('timestamp', 'asc');

  chatUnsubscribe = chatRef.onSnapshot(snapshot => {
    const $container = $('#chat-messages');
    // If we are starting fresh and snapshot is empty, we might want to keep the "How can I help" message
    // But if we have messages, clear it.

    if (snapshot.empty) {
      // Keep default placeholder if exists, else do nothing
      return;
    }

    $container.empty();
    snapshot.forEach(doc => {
      const msg = doc.data();
      renderMessage(msg, $container);
    });

    // Scroll to bottom
    $container.scrollTop($container[0].scrollHeight);

    // Mark messages as read if from admin
    markMessagesAsRead(uid);
  }, error => {
    console.error("❌ Snapshot Error:", error);
  });
}

function markMessagesAsRead(uid) {
  // We can't query and update in one go easily without a cloud function or batch loop client side.
  // Client side loop:
  window.db.collection('chats').doc(uid).collection('messages')
    .where('senderType', '==', 'admin')
    .where('read', '==', false)
    .get()
    .then(snap => {
      if (snap.empty) return;
      const batch = window.db.batch();
      snap.forEach(doc => {
        batch.update(doc.ref, { read: true });
      });
      batch.commit();
    });
}

// Global Listener for Badge
let globalChatListener = null;
function initGlobalChatListener(uid) {
  if (globalChatListener) globalChatListener();

  globalChatListener = window.db.collection('chats').doc(uid).collection('messages')
    .where('senderType', '==', 'admin')
    .where('read', '==', false)
    .onSnapshot(snap => {
      const count = snap.size;
      if (count > 0) {
        $('.support-badge-sidebar').text(count).show();
        $('.support-unread-badge').text(count).show();
      } else {
        $('.support-badge-sidebar').hide();
        $('.support-unread-badge').hide();
      }
    });
}

function renderMessage(msg, $container) {
  const isMe = (msg.senderType === 'user');
  const typeClass = isMe ? 'message-user' : 'message-admin';
  const time = msg.timestamp ? new Date(msg.timestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  // Simple sanitization
  const text = $('<div>').text(msg.text).html();

  $container.append(`
        <div class="message-bubble ${typeClass}">
            ${text}
            <span class="message-time">${time}</span>
        </div>
    `);
}

async function sendSupportMessage() {
  const text = $('#chat-input').val().trim();
  if (!text) return;

  if (!window.userSystem.currentUser) return;
  const uid = window.userSystem.currentUser.uid;
  const email = window.userSystem.currentUser.email || 'User';

  console.log('Sending message...', { uid, email, text });

  try {
    const chatDocRef = window.db.collection('chats').doc(uid);

    // Use batch or simple serial writes
    // 1. Update/Create Chat Parent
    await chatDocRef.set({
      userId: uid,
      userEmail: email,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastMessage: text,
      status: 'active',
      unreadCount: 0
    }, { merge: true });

    // 2. Add Message
    await chatDocRef.collection('messages').add({
      senderId: uid,
      senderType: 'user',
      text: text,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      read: false
    });

    console.log('✅ Message sent successfully');
    $('#chat-input').val('');

  } catch (e) {
    console.error("❌ Send Error", e);
    console.error("Code:", e.code);
    console.error("Message:", e.message);
    swal("Error", "Could not send message: " + e.message, "error");
  }
}

// Enter to send
$(document).on('keypress', '#chat-input', function (e) {
  if (e.which == 13) sendSupportMessage();
});