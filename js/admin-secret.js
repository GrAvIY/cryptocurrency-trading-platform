
const ADMIN_EMAIL = process.env.ADMIN_EMAIL; // This is just context, I am not replacing this. I am using multi_replace_file_content tool.

$(document).ready(function () {
    // Wait for Auth to Initialize
    // We can rely on main.js to init firebase-config, so window.auth should be available soon
    const checkInterval = setInterval(() => {
        if (window.auth) {
            clearInterval(checkInterval);
            initStrictAdminCheck();
        }
    }, 100);
});

function initStrictAdminCheck() {
    window.auth.onAuthStateChanged(async (user) => {
        if (user) {
            // Check if truly admin
            // We can also double check against ID or Email directly here for extra safety
            const isAdminEmail = (user.email === ADMIN_EMAIL || user.email === process.env.ADMIN_EMAIL_BACKUP);

            if (isAdminEmail) {
                // Grant Access
                $('#auth-check-overlay').fadeOut();
                $('.admin-sidebar').fadeIn();
                $('#dashboard-content').fadeIn();
                initDashboard();
            } else {
                // Determine if they have the 'admin' role in DB if email doesn't match hardcoded 
                // (though requirements say specific email usually, let's respect DB role too)
                try {
                    const doc = await window.db.collection('users').doc(user.uid).get();
                    if (doc.exists && doc.data().role === 'admin') {
                        $('#auth-check-overlay').fadeOut();
                        $('.admin-sidebar').fadeIn();
                        $('#dashboard-content').fadeIn();
                        initDashboard();
                        return;
                    }
                } catch (e) {
                    console.error("Auth Check Failed", e);
                }

                // Failed
                handleUnauthorized();
            }
        } else {
            // Not logged in
            // Redirect to Login, but maybe we want to be stealthy? 
            // The plan says "Redirect to login"
            window.location.replace('login.html');
        }
    });
}

function handleUnauthorized() {
    // Show 404 or Redirect
    // Requirement: "Show error or redirect"
    // Using a fake 404 alert then redirect to home
    $('#auth-check-overlay').html('<h3>404 - Not Found</h3>');
    setTimeout(() => {
        window.location.replace('login.html');
    }, 2000);
}


function initDashboard() {
    // Initial Load
    loadAndRenderUsers();
    renderCoins();
    loadTotalTransactions();
    loadSystemVolume();
}

// --- Sections Navigation ---
function showSection(sec) {
    // Hide all first
    $('#dashboard-content, #users-content, #coins-content, #transactions-section, #chats-content, #withdrawals-section, #wallets-content, #deposits-content').hide();

    // Reset Sidebar Active
    $('.nav-icon').removeClass('active');

    // Title mapping
    const titleMap = {
        'dashboard': 'Dashboard',
        'users': 'Users',
        'coins': 'Coins',
        'transactions': 'Transactions',
        'transactions': 'Transactions',
        'chats': 'Chats',
        'chats': 'Chats',
        'chats': 'Chats',
        'withdrawals': 'Withdrawals',
        'wallets': 'Wallets',
        'deposits': 'Deposits',
        'futures': 'Futures'
    };

    const title = titleMap[sec];
    if (title) {
        $(`.nav-icon[title="${title}"]`).addClass('active');
    }

    // Show Content
    if (sec === 'dashboard') {
        $('#dashboard-content').fadeIn();
    } else if (sec === 'users') {
        $('#users-content').fadeIn();
    } else if (sec === 'coins') {
        $('#coins-content').fadeIn();
    } else if (sec === 'transactions') {
        $('#transactions-section').fadeIn();
        loadTransactions(true);
    } else if (sec === 'chats') {
        $('#chats-content').fadeIn();
        loadUsersList();
    } else if (sec === 'withdrawals') {
        $('#withdrawals-section').fadeIn();
        loadWithdrawals();
    } else if (sec === 'wallets') {
        $('#wallets-content').fadeIn();
        loadSystemWallets();
    } else if (sec === 'deposits') {
        $('#deposits-content').fadeIn();
        loadDeposits();
    } else if (sec === 'futures') {
        $('#futures-content').fadeIn();
        loadFuturesPositions();
    }
}

// --- Global Transactions Pagination State ---
let lastDoc = null;
let firstDoc = null; // For prev (simplified)
let txPage = 1;
// --- User Management ---
async function loadAndRenderUsers() {
    const $tbody = $('#users-table tbody');
    $tbody.html('<tr><td colspan="6" class="text-center">Loading...</td></tr>');

    try {
        // 1. Get All Users
        const usersSnap = await window.db.collection('users').get();
        const users = [];

        // 2. Prepare Wallet Fetches
        const walletPromises = [];

        usersSnap.forEach(doc => {
            const u = { id: doc.id, ...doc.data() };
            users.push(u);
            // Check wallets/{uid}
            walletPromises.push(window.db.collection('wallets').doc(u.id).get());
        });

        const walletSnaps = await Promise.all(walletPromises);

        // 3. Merge Data
        users.forEach((u, index) => {
            const wDoc = walletSnaps[index];
            if (wDoc.exists) {
                u.displayWallet = wDoc.data();
            } else {
                u.displayWallet = {};
            }
        });

        // 4. Update Stats
        $('#total-users').text(users.length);

        // 5. Render Table
        $tbody.empty();
        users.forEach(u => {
            const usdt = u.displayWallet['USDT'] ? parseFloat(u.displayWallet['USDT']).toFixed(2) : '0.00';
            const email = u.email || 'N/A';
            const name = u.name || 'N/A';
            const country = u.country || 'N/A';
            const phone = u.phone || 'N/A';

            $tbody.append(`
            <tr>
                <td>${email}</td>
                <td>${name}</td>
                <td>${country}</td>
                <td>${phone}</td>
                <td>$${usdt}</td>
                <td>
                    <button class="btn btn-sm btn-outline-info" onclick="openEditModal('${u.id}')" title="Edit"><i class="fas fa-edit"></i></button>
                    <button class="btn btn-sm btn-outline-warning" onclick="showUserHistory('${u.id}', '${email}')" title="History"><i class="fas fa-history"></i></button>
                    ${u.role !== 'admin' ? `<button class="btn btn-sm btn-outline-danger" onclick="deleteUser('${u.id}')" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
                </td>
            </tr>
        `);
        });

    } catch (e) {
        console.error(e);
        $tbody.html(`<tr><td colspan="6" class="text-danger">Error: ${e.message}</td></tr>`);
    }
}

function filterUsers() {
    const filter = $('#user-search').val().toLowerCase();
    const rows = $('#users-table tbody tr');
    rows.each(function () {
        const text = $(this).text().toLowerCase();
        $(this).toggle(text.indexOf(filter) > -1);
    });
}

// --- Coin Management ---
function renderCoins() {
    const $list = $('#coin-list');
    $list.empty();
    if (!window.systemConfig) window.systemConfig = new SystemConfig();

    window.systemConfig.pairs.forEach(p => {
        $list.append(`
        <div class="badge badge-warning p-2 m-1 d-flex align-items-center" style="font-size: 1rem; background: #333; color: white; border: 1px solid #444;">
            ${p} <i class="fas fa-times ml-2" style="cursor: pointer; color: #F6465D;" onclick="removeCoin('${p}')"></i>
        </div>
    `);
    });
}

function addCoin() {
    const sym = $('#new-coin-symbol').val().trim();
    if (!sym) return;
    if (window.systemConfig.addPair(sym)) {
        swal("Success", `Added ${sym}!`, "success");
        renderCoins();
        $('#new-coin-symbol').val('');
    } else {
        swal("Error", "Already exists", "error");
    }
}

function removeCoin(p) {
    window.systemConfig.removePair(p);
    renderCoins();
}

// --- Edit User ---
async function openEditModal(uid) {
    let user = {};
    let walletData = { USDT: 0, BTC: 0 };

    try {
        const userDoc = await window.db.collection('users').doc(uid).get();
        if (userDoc.exists) user = userDoc.data();

        const wDoc = await window.db.collection('wallets').doc(uid).get();
        if (wDoc.exists) walletData = wDoc.data();
    } catch (e) { console.error(e); }

    $('#edit-email').val(user.email || '');
    $('#edit-name').val(user.name || '');
    $('#edit-country').val(user.country || '');
    $('#edit-phone').val(user.phone || '');
    $('#edit-pass').val("******");

    // Dynamic Assets
    const $balContainer = $('#dynamic-balance-inputs');
    $balContainer.empty();

    const assets = window.systemConfig ? window.systemConfig.assets : ['USDT', 'BTC', 'ETH'];
    if (!assets.includes('USDT')) assets.unshift('USDT');

    assets.forEach(asset => {
        const bal = walletData[asset] !== undefined ? walletData[asset] : 0;
        $balContainer.append(`
        <div class="col-6 mb-2">
            <label class="text-muted small">${asset}</label>
            <div class="input-group">
                 <input type="number" class="form-control glass-input form-control-sm" id="edit-balance-${asset}" value="${bal}">
                 <div class="input-group-append">
                    <span class="input-group-text bg-dark border-dark text-muted small">${asset}</span>
                 </div>
            </div>
        </div>
     `);
    });

    $('#editUserModal').data('uid', uid);
    $('#editUserModal').modal('show');
}

async function saveEditUser() {
    const uid = $('#editUserModal').data('uid');
    if (!uid) return;
    const userRef = window.db.collection('users').doc(uid);

    try {
        // Update Profile
        await userRef.update({
            name: $('#edit-name').val(),
            country: $('#edit-country').val(),
            phone: $('#edit-phone').val()
        });

        // Update Wallet
        const walletRef = window.db.collection('wallets').doc(uid);
        const newWalletData = {};

        const assets = window.systemConfig ? window.systemConfig.assets : ['USDT', 'BTC', 'ETH'];
        if (!assets.includes('USDT')) assets.push('USDT');

        assets.forEach(asset => {
            const inputId = `edit-balance-${asset}`;
            const val = parseFloat($(`#${inputId}`).val()) || 0;
            newWalletData[asset] = val;
        });

        await walletRef.set(newWalletData, { merge: true });

        // Audit Log
        const adminTx = {
            uid: uid,
            email: $('#edit-email').val(),
            type: 'Replenished',
            asset: 'MULTI',
            amount: 0,
            price: 0,
            total: 0,
            details: 'Admin updated balances',
            time: firebase.firestore.FieldValue.serverTimestamp(),
            source: 'ADMIN'
        };

        await window.db.collection('transactions').add(adminTx);

        $('#editUserModal').modal('hide');
        swal("Success", "User updated and logged.", "success");
        loadAndRenderUsers();
    } catch (e) {
        console.error(e);
        swal("Error", e.message, "error");
    }
}

function deleteUser(uid) {
    if (confirm("Are you sure? This cannot be undone.")) {
        const p1 = window.db.collection('users').doc(uid).delete();
        const p2 = window.db.collection('wallets').doc(uid).delete();

        Promise.all([p1, p2])
            .then(() => {
                swal("Deleted", "User profile and wallet removed", "success");
                loadAndRenderUsers();
            })
            .catch(e => swal("Error", e.message, "error"));
    }
}

// --- Deposits Management ---
async function loadDeposits() {
    const $tbody = $('#deposits-table tbody');
    $tbody.html('<tr><td colspan="7" class="text-center">Loading...</td></tr>');

    try {
        const snap = await window.db.collection('transactions')
            .where('type', '==', 'DEPOSIT')
            .where('status', '==', 'pending')
            .orderBy('time', 'desc')
            .get();

        $tbody.empty();

        if (snap.empty) {
            $tbody.html('<tr><td colspan="7" class="text-center text-muted">No pending deposits</td></tr>');
            return;
        }

        // Gather User IDs
        const userIds = [];
        snap.forEach(doc => {
            const d = doc.data();
            if (d.uid && !userIds.includes(d.uid)) userIds.push(d.uid);
        });

        // Fetch user wallets
        const walletMap = {};
        if (userIds.length > 0) {
            // Firestore 'in' query limit is 10. Split if needed, but for simplicity assuming <10 pending users at once usually.
            // Better: Promise.all fetches
            try {
                const promises = userIds.map(uid => window.db.collection('wallets').doc(uid).get());
                const docs = await Promise.all(promises);
                docs.forEach((d, i) => {
                    if (d.exists) walletMap[userIds[i]] = d.data();
                });
            } catch (e) { console.warn("Wallet fetch error", e); }
        }

        snap.forEach(doc => {
            const tx = { id: doc.id, ...doc.data() };
            const time = tx.time ? new Date(tx.time.seconds * 1000).toLocaleString() : 'N/A';
            const user = tx.email || tx.userId || tx.uid || 'Unknown';
            const asset = tx.asset || 'USDT';
            const amount = parseFloat(tx.amount || 0);

            let bal = 0;
            if (walletMap[tx.uid] && walletMap[tx.uid][asset] !== undefined) {
                bal = parseFloat(walletMap[tx.uid][asset]);
            }

            $tbody.append(`
                <tr>
                    <td>${time}</td>
                    <td>${user}</td>
                    <td>${asset}</td>
                    <td>${amount.toFixed(2)}</td>
                    <td>${bal.toFixed(2)} ${asset}</td>
                    <td><span class="badge badge-warning">Pending</span></td>
                    <td>
                        <button class="btn btn-sm btn-success mr-2" onclick="approveDeposit('${tx.id}', '${tx.uid}', '${asset}', ${amount})"><i class="fas fa-check"></i> Approve</button>
                        <button class="btn btn-sm btn-danger" onclick="rejectDeposit('${tx.id}')"><i class="fas fa-times"></i> Reject</button>
                    </td>
                </tr>
            `);
        });

    } catch (e) {
        console.error("Load Deposits Error", e);
        $tbody.html(`<tr><td colspan="7" class="text-danger">Error: ${e.message}</td></tr>`);
    }
}




async function loadTransactions(reset = false) {
    const $tbody = $('#tx-table tbody');
    if (reset) {
        $tbody.html('<tr><td colspan="8" class="text-center">Loading...</td></tr>');
        lastDoc = null;
        txPage = 1;
        $('#page-indicator').text(`Page 1`);
    }

    const typeFilter = $('#filter-type').val();
    const assetFilter = $('#filter-asset').val().trim().toUpperCase();
    const userFilter = $('#filter-user').val().trim();
    const limitDetails = parseInt($('#filter-limit').val()) || 50;

    try {
        let ref = window.db.collection('transactions');

        // Basic Filtering
        if (typeFilter) ref = ref.where('type', '==', typeFilter);
        // Firestore limits compound queries, so we might need client-side filtering for some
        // But let's try strict order first. 

        // If filtering by user email, we might need a compound index or client side
        // For now, let's fetch by time and filter client side if complex, or usage specific index

        ref = ref.orderBy('time', 'desc');

        if (lastDoc && !reset) {
            ref = ref.startAfter(lastDoc);
        }

        ref = ref.limit(limitDetails);

        const snap = await ref.get();

        if (reset) $tbody.empty();

        if (snap.empty) {
            if (reset) $tbody.html('<tr><td colspan="8" class="text-center text-muted">No transactions found</td></tr>');
            $('#btn-next').prop('disabled', true);
            return;
        }

        lastDoc = snap.docs[snap.docs.length - 1];
        $('#btn-next').prop('disabled', false);

        snap.forEach(doc => {
            const tx = doc.data();

            // Client Side Filtering for fuzzy matches/search which Firestore lacks natively easily
            if (userFilter) {
                const searchStr = (tx.email || tx.userId || '').toLowerCase();
                if (!searchStr.includes(userFilter.toLowerCase())) return;
            }
            if (assetFilter) {
                const a = (tx.asset || tx.pair || '').toUpperCase();
                if (!a.includes(assetFilter)) return;
            }

            renderTxRow($tbody, tx);
        });

    } catch (e) {
        console.error("Tx Load Error", e);
        $tbody.html(`<tr><td colspan="8" class="text-danger">Error: ${e.message}</td></tr>`);
    }
}

function nextPage() {
    txPage++;
    $('#page-indicator').text(`Page ${txPage}`);
    loadTransactions(false);
    $('#btn-prev').prop('disabled', false);
}

function prevPage() {
    // Firestore pagination backwards is hard without keeping history of 'startAt' docs
    // For this scope, simplified "Reset" or just disable Prev
    if (txPage > 1) {
        swal("Info", "Previous page not implemented in this version. Please refresh to start over.", "info");
        // To implement simple prev: maintain a stack of 'firstDocs' of each page
    }
}

function renderTxRow($container, tx) {
    const time = tx.time ? (tx.time.toDate ? tx.time.toDate().toLocaleString() : new Date(tx.time).toLocaleString()) : 'N/A';
    const user = tx.email || tx.userId || 'Unknown';
    const type = tx.type || '-';
    const asset = tx.asset || tx.pair || '-';
    const amt = tx.amount ? parseFloat(tx.amount).toFixed(6) : '0';
    const price = tx.price ? parseFloat(tx.price).toFixed(2) : '-';
    const total = tx.total ? parseFloat(tx.total).toFixed(2) : '0';
    const status = tx.status || 'Completed'; // Default

    let displayType = type;
    if (type === 'ADMIN_EDIT') displayType = 'Replenished';

    let typeClass = 'text-white';
    if (displayType === 'BUY' || displayType === 'DEPOSIT') typeClass = 'text-success';
    if (displayType === 'SELL' || displayType === 'WITHDRAW') typeClass = 'text-danger';
    if (displayType === 'Replenished') typeClass = 'text-warning';

    $container.append(`
    <tr>
        <td><small>${time}</small></td>
        <td><small>${user}</small></td>
        <td class="${typeClass}"><strong>${displayType}</strong></td>
        <td>${asset}</td>
        <td>${amt}</td>
        <td>$${price}</td>
        <td>$${total}</td>
        <td><span class="badge badge-secondary">${status}</span></td>
    </tr>
`);
}

// --- User History ---
async function showUserHistory(uid, email) {
    $('#hist-user-email').text(email);
    const $tbody = $('#user-hist-table tbody');
    $tbody.html('<tr><td colspan="7" class="text-center">Loading...</td></tr>');
    $('#userHistoryModal').modal('show');

    try {
        console.log(`Fetching history for user: ${uid} (${email})`);
        // Fetch all tx for this user
        const snap = await window.db.collection('transactions')
            .where('uid', '==', uid) // Ensure 'uid' matches your Firestore field
            .orderBy('time', 'desc')
            .limit(100)
            .get();

        $tbody.empty();

        if (snap.empty) {
            $tbody.html('<tr><td colspan="7" class="text-center">No transactions found.</td></tr>');
            return;
        }

        snap.forEach(doc => {
            const tx = doc.data();
            const time = tx.time ? (tx.time.toDate ? tx.time.toDate().toLocaleString() : new Date(tx.time).toLocaleString()) : 'N/A';
            let displayType = tx.type;
            if (displayType === 'ADMIN_EDIT') displayType = 'Replenished';

            let typeClass = 'text-white';
            if (tx.type === 'BUY') typeClass = 'text-success';
            if (tx.type === 'SELL') typeClass = 'text-danger';
            if (displayType === 'Replenished') typeClass = 'text-warning';

            $tbody.append(`
                <tr>
                    <td>${time}</td>
                    <td class="${typeClass}">${displayType}</td>
                    <td>${tx.asset || tx.pair || '-'}</td>
                    <td>${tx.amount ? parseFloat(tx.amount).toFixed(6) : '-'}</td>
                    <td>${tx.price ? parseFloat(tx.price).toFixed(2) : '-'}</td>
                    <td>${tx.total ? parseFloat(tx.total).toFixed(2) : '-'}</td>
                    <td><small>${tx.details || ''}</small></td>
                </tr>
             `);
        });

    } catch (e) {
        console.error(e);
        $tbody.html(`<tr><td colspan="7" class="text-danger">Error: ${e.message}</td></tr>`);
    }
}

// --- Dashboard Stats ---
async function loadTotalTransactions() {
    $('#total-tx').text("Loading...");
    try {
        const snap = await window.db.collection('transactions').get();
        const count = snap.size;
        $('#total-tx').text(count.toLocaleString());
    } catch (e) {
        console.error("Error loading total transactions:", e);
        $('#total-tx').text("N/A");
    }
}

async function loadSystemVolume() {
    $('#system-vol').text("Loading...");
    try {
        const snap = await window.db.collection('transactions').get();
        let totalVol = 0;
        snap.forEach(doc => {
            const data = doc.data();
            if (data.total) {
                totalVol += parseFloat(data.total);
            }
        });

        let formatted = totalVol.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        $('#system-vol').text(formatted + " USD");
    } catch (e) {
        console.error("Error loading system volume:", e);
        $('#system-vol').text("N/A USD");
    }
}

function filterChatUsers() {
    const filter = $('#user-search-input').val().toLowerCase();
    const items = $('#users-list .chat-list-item');
    items.each(function () {
        const email = $(this).find('span.font-weight-bold').text().toLowerCase();
        if (email.indexOf(filter) > -1) {
            $(this).show();
        } else {
            $(this).hide();
        }
    });
}

/* =========================================
   SUPPORT CHAT SYSTEM (Admin Side)
   ========================================= */

let adminChatListUnsubscribe = null;
let adminCurrentChatUnsubscribe = null;
let currentAdminChatUid = null;

function loadUsersList() {
    if (adminChatListUnsubscribe) return;

    // Listen to chats ordered by last update
    const chatsRef = window.db.collection('chats').orderBy('updatedAt', 'desc');

    adminChatListUnsubscribe = chatsRef.onSnapshot(snapshot => {
        const $list = $('#users-list');
        $list.empty();

        if (snapshot.empty) {
            $list.html('<div class="p-3 text-muted text-center">No active chats</div>');
            return;
        }

        snapshot.forEach(doc => {
            const chat = doc.data();
            const time = chat.updatedAt ? new Date(chat.updatedAt.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            const statusClass = chat.status === 'active' ? 'status-active' : 'status-closed';
            const statusLabel = chat.status === 'active' ? 'Active' : 'Closed';
            const unreadCount = chat.unreadCount || 0;
            const unread = unreadCount > 0 ? `<span class="badge badge-danger ml-2">${unreadCount}</span>` : '';

            const activeClass = (currentAdminChatUid === chat.userId) ? 'active' : '';

            $list.append(`
                <div class="chat-list-item ${activeClass}" onclick="openChat('${chat.userId}', '${chat.userEmail}')">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <span class="font-weight-bold text-white">${chat.userEmail}</span>
                            ${unread}
                        </div>
                        <small class="text-muted">${time}</small>
                    </div>
                    <div class="d-flex align-items-center mt-1">
                        <span class="chat-status-dot ${statusClass}"></span>
                        <small class="text-muted">${statusLabel}</small>
                    </div>
                     <div class="text-truncate small text-muted mt-1" style="max-width: 200px;">
                        ${chat.lastMessage || ''}
                    </div>
                </div>
            `);
        });
    });
}

function openChat(uid, email) {
    currentAdminChatUid = uid;
    $('#chat-user-title').text(email);

    $('#chat-placeholder').hide();
    $('#chat-area').show().addClass('d-flex');

    if (adminCurrentChatUnsubscribe) adminCurrentChatUnsubscribe();

    const messagesRef = window.db.collection('chats').doc(uid).collection('messages').orderBy('timestamp', 'asc');

    adminCurrentChatUnsubscribe = messagesRef.onSnapshot(snapshot => {
        const $container = $('#messages-container');

        // If first load (cached or fresh), clear. 
        // If appending, we need more logic, but for now full re-render on snapshot is easiest for sync
        $container.empty();

        if (snapshot.empty) return;

        snapshot.forEach(doc => {
            const msg = doc.data();
            renderMessage(msg, $container);
        });

        $container.scrollTop($container[0].scrollHeight);

        // Mark as read
        if (uid) {
            window.db.collection('chats').doc(uid).update({ unreadCount: 0 }).catch(e => { });
        }
    });

    // Highlight
    $('.chat-list-item').removeClass('active');
}

function renderMessage(msg, $container) {
    const isMe = (msg.senderType === 'admin');
    const typeClass = isMe ? 'message-user' : 'message-admin';
    const time = msg.timestamp ? new Date(msg.timestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    const text = $('<div>').text(msg.text).html();

    $container.append(`
        <div class="message-bubble ${typeClass}">
            ${text}
            <span class="message-time">${time}</span>
        </div>
    `);
}

async function sendAdminMessage() {
    const text = $('#admin-message-input').val().trim();
    if (!text || !currentAdminChatUid) return;

    try {
        const chatDocRef = window.db.collection('chats').doc(currentAdminChatUid);

        await chatDocRef.set({
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastMessage: "Admin: " + text,
            status: 'active',
            unreadCount: 0
        }, { merge: true });

        await chatDocRef.collection('messages').add({
            senderId: 'ADMIN',
            senderType: 'admin',
            text: text,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            read: true
        });

        $('#admin-message-input').val('');

    } catch (e) {
        console.error("Send Error", e);
        swal("Error", "Could not send message.", "error");
    }
}

function closeChat() {
    currentAdminChatUid = null;
    if (adminCurrentChatUnsubscribe) adminCurrentChatUnsubscribe();
    $('#chat-area').hide().removeClass('d-flex');
    $('#chat-placeholder').show();
}

$(document).on('keypress', '#admin-message-input', function (e) {
    if (e.which == 13) sendAdminMessage();
});

// --- Withdrawals ---
async function loadWithdrawals() {
    const $tbody = $('#withdrawals-table tbody');
    $tbody.html('<tr><td colspan="7" class="text-center">Loading...</td></tr>');

    try {
        const snap = await window.db.collection('transactions')
            .where('type', '==', 'WITHDRAW')
            .where('status', '==', 'pending')
            .orderBy('time', 'desc')
            .get();

        $tbody.empty();

        if (snap.empty) {
            $tbody.html('<tr><td colspan="7" class="text-center text-muted">No pending withdrawals</td></tr>');
            return;
        }

        snap.forEach(doc => {
            const tx = { id: doc.id, ...doc.data() };
            const time = tx.time ? new Date(tx.time.seconds * 1000).toLocaleString() : 'N/A';

            $tbody.append(`
                <tr>
                    <td>${time}</td>
                    <td>${tx.email}</td>
                    <td>${tx.asset}</td>
                    <td>${parseFloat(tx.amount).toFixed(8)}</td>
                    <td><small>${tx.address}</small></td>
                    <td><span class="badge badge-warning">Pending</span></td>
                    <td>
                        <button class="btn btn-sm btn-success mr-2" onclick="approveWithdrawal('${tx.id}')">Approve</button>
                        <button class="btn btn-sm btn-danger" onclick="rejectWithdrawal('${tx.id}', '${tx.uid}', '${tx.asset}', ${tx.amount})">Reject</button>
                    </td>
                </tr>
            `);
        });

    } catch (e) {
        console.error(e);
        $tbody.html(`<tr><td colspan="7" class="text-danger">Error: ${e.message}</td></tr>`);
    }
}

async function approveWithdrawal(txId) {
    if (!confirm("Approve this withdrawal?")) return;

    try {
        await window.db.collection('transactions').doc(txId).update({
            status: 'approved',
            processedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        swal("Approved", "Withdrawal marked as complete.", "success");
        loadWithdrawals();
    } catch (e) {
        swal("Error", e.message, "error");
    }
}

async function approveDeposit(txId, uid, asset, amount) {
    if (!confirm("Approve this deposit?")) return;

    try {
        await window.db.runTransaction(async (t) => {
            const txRef = window.db.collection('transactions').doc(txId);
            const walletRef = window.db.collection('wallets').doc(uid);

            // 1. Get Wallet
            const doc = await t.get(walletRef);
            if (!doc.exists) throw "User wallet not found";

            const currentBalance = doc.data()[asset] || 0;
            const newBalance = currentBalance + amount;

            // 2. Update Wallet
            t.update(walletRef, { [asset]: newBalance });

            // 3. Update Transaction
            t.update(txRef, {
                status: 'approved',
                processedAt: firebase.firestore.FieldValue.serverTimestamp(),
                processedBy: (window.auth.currentUser ? window.auth.currentUser.email : 'ADMIN')
            });
        });

        swal("Депозит одобрен", "Средства зачислены на баланс пользователя.", "success");
        loadDeposits();

    } catch (e) {
        console.error("Approve Error", e);
        swal("Error", e.message, "error");
    }
}

async function rejectDeposit(txId) {
    // Prompt for reason
    swal({
        title: "Отклонение депозита",
        text: "Укажите причину отклонения:",
        type: "input",
        showCancelButton: true,
        closeOnConfirm: false,
        inputPlaceholder: "Причина (например: Не поступили средства)"
    }, async function (inputValue) {
        if (inputValue === false) return false;
        if (inputValue === "") {
            swal.showInputError("Укажите причину!");
            return false;
        }

        try {
            await window.db.collection('transactions').doc(txId).update({
                status: 'rejected',
                closeReason: inputValue, // Legacy support
                reason: inputValue, // Consistency with withdrawals
                details: `Rejected: ${inputValue}`, // Visible in history
                processedAt: firebase.firestore.FieldValue.serverTimestamp(),
                processedBy: (window.auth.currentUser ? window.auth.currentUser.email : 'ADMIN')
            });
            swal("Депозит отклонён", "Статус обновлен. Пользователь увидит причину.", "success");
            loadDeposits();
        } catch (e) {
            swal("Error", e.message, "error");
        }
    });
}

async function rejectWithdrawal(txId, uid, asset, amount) {
    const reason = prompt("Enter rejection reason:");
    if (!reason) return;

    try {
        await window.db.runTransaction(async (t) => {
            const txRef = window.db.collection('transactions').doc(txId);
            const walletRef = window.db.collection('wallets').doc(uid);

            // 1. Get Wallet
            const doc = await t.get(walletRef);
            if (!doc.exists) throw "User wallet not found";

            const currentBalance = doc.data()[asset] || 0;
            const newBalance = currentBalance + amount;

            // 2. Update Transaction
            t.update(txRef, {
                status: 'rejected',
                reason: reason,
                processedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // 3. Refund Wallet
            t.update(walletRef, { [asset]: newBalance });
        });

        swal("Rejected", "Withdrawal rejected and funds refunded.", "success");
        loadWithdrawals();
    } catch (e) {
        console.error(e);
        swal("Error", "Failed to reject: " + e.message, "error");
    }
}

// --- Futures Management ---
let allFuturesPositions = [];
let currentManagePosition = null; // { uid, positionIndex, data }

async function loadFuturesPositions() {
    const $tbody = $('#futures-table tbody');
    $tbody.html('<tr><td colspan="8" class="text-center">Loading...</td></tr>');

    console.log('[DEBUG] Starting loadFuturesPositions...');

    try {
        // Optimization: Fetch 'positions' collection directly instead of iterating all users.
        // This requires 'isAdmin' permission on /positions/{uid} which we fixed in rules.
        const posSnap = await window.db.collection('positions').get();
        console.log(`[DEBUG] Found ${posSnap.size} position documents.`);

        allFuturesPositions = [];

        if (posSnap.empty) {
            console.log('[DEBUG] No position documents found.');
            renderFuturesTable();
            return;
        }

        // 2. Fetch Prices for PnL Calc
        let priceMap = {};
        try {
            const tickers = await API.getAllTickers();
            tickers.forEach(t => priceMap[t.symbol] = parseFloat(t.lastPrice));
            console.log('[DEBUG] Prices fetched.');
        } catch (e) {
            console.warn('[DEBUG] Failed to fetch prices', e);
        }

        // 3. Process documents
        const promises = posSnap.docs.map(async (doc) => {
            const uid = doc.id;
            const data = doc.data();
            // Filter out closed positions for the active view
            const list = (data.list || []).filter(p => p.status !== 'closed');

            if (list.length === 0) return;

            // Fetch user email for display
            let email = uid;
            try {
                const uDoc = await window.db.collection('users').doc(uid).get();
                if (uDoc.exists) email = uDoc.data().email || uid;
            } catch (e) {
                console.warn(`[DEBUG] Failed to fetch user email for ${uid}`, e);
            }

            list.forEach((p, index) => {
                // Normalize Data Structure (Backend 'main.js' vs Admin 'admin-secret.js')
                // main.js saves: { symbol, side, entryPrice, margin, leverage, size ... }
                // admin expects: { pair, type, entry, margin, leverage ... }

                const pair = p.symbol || p.pair || 'UNKNOWN';
                const type = p.side || p.type || 'LONG';
                const entry = parseFloat(p.entryPrice || p.entry || 0);
                const margin = parseFloat(p.margin || 0);
                const leverage = parseFloat(p.leverage || 10);
                const size = parseFloat(p.size || 0);

                const currentPrice = (priceMap[pair.replace('/', '').replace('-', '')] || priceMap[pair] || entry);

                allFuturesPositions.push({
                    ...p, // Keep string props
                    uid: uid,
                    email: email,
                    index: index,

                    // Normalized Props
                    pair: pair,
                    type: type,
                    entry: entry,
                    margin: margin,
                    leverage: leverage,
                    size: size,
                    currentPrice: currentPrice
                });
            });
        });

        await Promise.all(promises);
        console.log(`[DEBUG] Processed ${allFuturesPositions.length} individual positions.`);

        renderFuturesTable();

    } catch (e) {
        console.error("Load Futures Error", e);
        $tbody.html(`<tr><td colspan="8" class="text-danger">Error: ${e.message}</td></tr>`);
    }
}

function renderFuturesTable() {
    const $tbody = $('#futures-table tbody');
    $tbody.empty();

    const userFilter = $('#futures-filter-user').val().trim().toLowerCase();
    const assetFilter = $('#futures-filter-asset').val().trim().toUpperCase();
    const typeFilter = $('#futures-filter-type').val();

    if (allFuturesPositions.length === 0) {
        $tbody.html('<tr><td colspan="8" class="text-center text-muted">No active positions.</td></tr>');
        return;
    }

    let hasVisible = false;

    allFuturesPositions.forEach(p => {
        // Filters
        if (userFilter && !p.email.toLowerCase().includes(userFilter)) return;
        if (assetFilter && !p.pair.toUpperCase().includes(assetFilter)) return;
        if (typeFilter && p.type !== typeFilter) return;

        hasVisible = true;

        // Calc PnL
        const entry = p.entry;
        const margin = p.margin;
        const lev = p.leverage;
        const sizeCoins = p.size; // Quantity in Coins
        const notionalUSDT = margin * lev;
        const current = p.currentPrice || entry;

        let pnl = 0;
        let pnlPercent = 0;

        if (p.type === 'LONG') {
            pnl = (current - entry) * sizeCoins;
        } else {
            pnl = (entry - current) * sizeCoins;
        }

        if (margin > 0) pnlPercent = (pnl / margin) * 100;

        const pnlClass = pnl >= 0 ? 'text-success' : 'text-danger';
        const pnlSign = pnl >= 0 ? '+' : '';

        $tbody.append(`
            <tr>
                <td><small>${p.email}</small></td>
                <td>${p.pair}</td>
                <td><span class="badge ${p.type === 'LONG' ? 'badge-success' : 'badge-danger'}">${p.type} x${p.leverage}</span></td>
                <td>$${notionalUSDT.toFixed(2)} <small class="text-muted">(${sizeCoins.toFixed(4)} ${p.pair.replace('/USDT', '')})</small></td>
                <td>${entry.toFixed(4)}</td>
                <td>${current.toFixed(4)}</td>
                <td class="${pnlClass}">
                    <strong>${pnlSign}${pnl.toFixed(2)}</strong>
                    <small>(${pnlSign}${pnlPercent.toFixed(2)}%)</small>
                </td>
                <td>
                    <button class="btn btn-sm btn-outline-info" onclick='openManageModal(${JSON.stringify(p).replace(/'/g, "&apos;")})'>Manage</button>
                </td>
            </tr>
        `);
    });

    if (!hasVisible) {
        $tbody.html('<tr><td colspan="8" class="text-center text-muted">No positions match filters.</td></tr>');
    }
}

function filterFutures() {
    renderFuturesTable();
}

// --- Manage Modal Logic ---

function openManageModal(pos) {
    currentManagePosition = pos;

    $('#mp-user').text(pos.email);
    $('#mp-pair').text(pos.pair);
    $('#mp-type').text(pos.type + " x" + pos.leverage)
        .removeClass('badge-success badge-danger')
        .addClass(pos.type === 'LONG' ? 'badge-success' : 'badge-danger');

    $('#mp-entry').text(pos.entry);
    $('#mp-mark').text(pos.currentPrice);
    $('#mp-size').text((pos.margin * pos.leverage).toFixed(2) + " (" + pos.margin + ")");

    // Initial PnL display
    updateModalPnL(pos.currentPrice);

    // Set input to current price
    $('#mp-close-price').val(pos.currentPrice);

    $('#mp-comment').val('');

    $('#managePositionModal').modal('show');
}

function setClosePriceToMarket() {
    if (currentManagePosition) {
        $('#mp-close-price').val(currentManagePosition.currentPrice);
        updateModalPnL(currentManagePosition.currentPrice);
    }
}

// Watch input
$(document).on('input', '#mp-close-price', function () {
    const val = parseFloat($(this).val());
    if (!isNaN(val)) updateModalPnL(val);
});

function updateModalPnL(closePrice) {
    if (!currentManagePosition) return;
    const p = currentManagePosition;

    const entry = parseFloat(p.entry);
    const margin = parseFloat(p.margin);
    const lev = parseFloat(p.leverage);
    const size = parseFloat(p.size); // Coin Quantity

    let pnl = 0;
    let pnlPercent = 0;

    if (p.type === 'LONG') {
        pnl = (closePrice - entry) * size;
    } else {
        pnl = (entry - closePrice) * size;
    }

    if (margin > 0) pnlPercent = (pnl / margin) * 100;

    const pnlSign = pnl >= 0 ? '+' : '';
    const text = `${pnlSign}${pnl.toFixed(2)} USDT (${pnlSign}${pnlPercent.toFixed(2)}%)`;

    $('#mp-calc-pnl').text(text)
        .removeClass('text-success text-danger')
        .addClass(pnl >= 0 ? 'text-success' : 'text-danger');

    $('#mp-pnl').text(text)
        .removeClass('text-success text-danger')
        .addClass(pnl >= 0 ? 'text-success' : 'text-danger');
}


async function confirmClosePosition() {
    if (!currentManagePosition) return;

    const closePrice = parseFloat($('#mp-close-price').val());
    const comment = $('#mp-comment').val().trim();
    if (isNaN(closePrice) || closePrice <= 0) return swal("Error", "Invalid Close Price", "error");

    // Re-calc final PnL
    // Re-calc final PnL
    const p = currentManagePosition;
    const entry = parseFloat(p.entry);
    const margin = parseFloat(p.margin);
    const lev = parseFloat(p.leverage);
    const size = parseFloat(p.size); // Use pre-calculated/stored size which is coins amount usually in openPosition

    // In openPosition: size = (margin * leverage) / price. This is Quantity in COINS.
    // PnL formula: (Close - Entry) * Size(Coins). 

    // Check if 'size' is Coins or USDT. 
    // In renderFuturesTable: const size = (margin * lev); // This was USDT value, incorrect var name usage conflict?
    // Let's stick to standard formula if we have coin size.

    // If p.size comes from main.js, it is COINS quantity.
    // PnL = (Close - Entry) * Qty

    let pnl = 0;
    if (p.type === 'LONG') {
        pnl = (closePrice - entry) * size;
    } else {
        pnl = (entry - closePrice) * size;
    }

    // Safety Prompt if High Loss
    if (pnl < -(margin * 0.5)) {
        if (!confirm(`WARNING: This will result in a LOSS of ${pnl.toFixed(2)} USDT (>50%). Continue?`)) return;
    }

    try {
        await window.db.runTransaction(async (t) => {
            const userRef = window.db.collection('users').doc(p.uid);
            const posRef = window.db.collection('positions').doc(p.uid);
            const walletRef = window.db.collection('wallets').doc(p.uid);

            // 1. Get Positions Data
            const posDoc = await t.get(posRef);
            if (!posDoc.exists) throw "User positions not found";

            const list = posDoc.data().list || [];
            if (!list[p.index]) throw "Position not found (index mismatch, user may have modified)";
            // Ideally verify ID, but simple index for now

            // We update the list in place now, so no need to filter active list.


            // 2. Update Wallet
            const wDoc = await t.get(walletRef);
            const wData = wDoc.data() || {};
            const currentUSDT = wData['USDT'] || 0;

            // Return Margin + PnL
            // Margin was deducted on open. PnL is the profit/loss on top of margin.
            // Example 1: Margin 100, PnL +50. Return 150. Account +50.
            // Example 2: Margin 100, PnL -50. Return 50. Account -50.
            // Example 3: Margin 100, PnL -150. Return -50? No, max loss is margin usually unless cross. 
            // Assuming isolated/simple: min return is 0 (liquidation).
            // But here we rely on calc. If pnl < -margin, user owes money? Let's cap at 0 return for safety if not handling negative balances.

            let returnAmount = margin + pnl;
            if (returnAmount < 0) returnAmount = 0; // Prevent negative balance addition (bankruptcy)

            const finalBalance = currentUSDT + returnAmount;

            // 3. Update Position Status instead of removing
            // Create a modified list where we update the specific item
            // We need to identify the item accurately. Using index 'p.index' is risky if list changed.
            // But we can check if list[p.index] matches our 'p' data.

            const item = list[p.index];
            // Check match. Raw item has 'symbol'/'entryPrice', 'p' has 'pair'/'entry'.
            // Also handle case if raw item was already normalized (unlikely but safe)
            const rawPair = item.symbol || item.pair;
            const rawEntry = item.entryPrice || item.entry;

            if (rawPair !== p.pair || parseFloat(rawEntry) !== parseFloat(p.entry)) {
                throw "Position mismatch during save. User may have modified positions.";
            }

            list[p.index] = {
                ...item,
                status: 'closed',
                closePrice: closePrice,
                pnl: pnl,
                closedAt: firebase.firestore.Timestamp.now(),
                closedBy: 'ADMIN',
                closeReason: comment || (pnl >= 0 ? 'Take Profit' : 'Stop Loss')
            };

            t.update(posRef, { list: list });
            t.update(walletRef, { 'USDT': finalBalance });

            // 4. Transactions & Audit
            const txRef = window.db.collection('transactions').doc();
            t.set(txRef, {
                uid: p.uid,
                email: p.email,
                type: 'FUTURES_CLOSE',
                asset: p.pair,
                amount: returnAmount, // Total returned
                quantity: size, // Position size
                price: closePrice,
                pnl: pnl,
                details: comment ? comment : (pnl >= 0 ? 'Take Profit' : 'Stop Loss'),
                time: firebase.firestore.FieldValue.serverTimestamp(),
                source: 'ADMIN',
                status: 'completed'
            });

            // Admin Audit (Optional, or combined in above if distinct enough)
            // We can just rely on source: ADMIN in transactions
        });

        swal("Success", `Position Closed. PnL: ${pnl.toFixed(2)} USDT`, "success");
        $('#managePositionModal').modal('hide');
        loadFuturesPositions(); // Refresh
        loadAndRenderUsers(); // Refresh balances if viewing users

    } catch (e) {
        console.error(e);
        swal("Error", "Close Failed: " + e.message, "error");
    }
}
