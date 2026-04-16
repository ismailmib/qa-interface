// � FACTORY INTELLIGENCE CLOUD CORE (v4.0 Firebase)
const firebaseConfig = {
    apiKey: "AIzaSyB93wg-3la1BxETu8gkFLrHrsaBiUnVPyM",
    authDomain: "factory-qa-system.firebaseapp.com",
    projectId: "factory-qa-system",
    storageBucket: "factory-qa-system.firebasestorage.app",
    messagingSenderId: "356457125768",
    appId: "1:356457125768:web:afdcbcf810c1458fdf8c3d",
    measurementId: "G-48BGMGKK2K"
};

// Auto-fallback: If Firebase setup is missing, system remains local-only
let db = null;
let cloudActive = false;

try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    cloudActive = true;
    console.log("🛰️ System: CLOUD SYNC ACTIVE (Firebase Firestore)");
} catch (e) {
    console.warn("⚠️ System: CLOUD OFFLINE - Using Local Fallback Storage");
}

// 🏛️ Manufacturing Stages (Factory Defaults)
// 🏛️ IPQC Manufacturing Stages (From IPQC_Inspection_Points.xlsx)
const DEFAULT_STAGES = [
    {
        id: 'stage_1',
        name: 'Raw Material Inventory',
        order: 1,
        checkpoints: [
            { desc: 'Verify material matches BOM specification', photo: true },
            { desc: 'Part number match (Yes/No)', photo: false },
            { desc: 'Check component labeling accuracy', photo: false },
            { desc: 'Inspect for physical damage (Cracks/Bends)', photo: true },
            { desc: 'Verify PCB quality (No scratches/warping)', photo: true },
            { desc: 'Verify supplier batch traceability', photo: false }
        ]
    },
    {
        id: 'stage_2',
        name: 'PCB Testing',
        order: 2,
        checkpoints: [
            { desc: 'Verify PCB power ON functionality', photo: true },
            { desc: 'Check for short/open circuits (Continuity)', photo: false },
            { desc: 'Validate voltage levels (within range)', photo: true },
            { desc: 'Inspect for solder defects (Bridges/dry joints)', photo: true },
            { desc: 'Verify component placement & alignment', photo: false }
        ]
    },
    {
        id: 'stage_3',
        name: 'Software Flashing Stage 1',
        order: 3,
        checkpoints: [
            { desc: 'Verify correct firmware version matches specification', photo: true },
            { desc: 'Check firmware upload success & device detection', photo: false },
            { desc: 'Monitor for flashing interruptions', photo: false },
            { desc: 'Log flashing execution status (Success/Fail)', photo: true }
        ]
    },
    {
        id: 'stage_4',
        name: 'Software Flashing Stage 2',
        order: 4,
        checkpoints: [
            { desc: 'Verify final firmware configuration', photo: true },
            { desc: 'Validate software integrity & functional validation', photo: false },
            { desc: 'Confirm calibration settings are correct', photo: true },
            { desc: 'Verify readiness for mechanical assembly', photo: false }
        ]
    },
    {
        id: 'stage_5',
        name: 'Mechanical Assembly',
        order: 5,
        checkpoints: [
            { desc: 'Verify component fitting & internal alignment', photo: true },
            { desc: 'Inspect display positioning & keypad response', photo: false },
            { desc: 'Check screw tightening & gap management', photo: true },
            { desc: 'Final mechanical physical damage inspection', photo: true }
        ]
    },
    {
        id: 'stage_6',
        name: 'Packing & Shipping',
        order: 6,
        checkpoints: [
            { desc: 'Verify final functional pass status', photo: true },
            { desc: 'Inspect for cosmetic defects (surface finish)', photo: true },
            { desc: 'Check labeling accuracy & packaging quality', photo: false },
            { desc: 'Ensure all accessories are included in kit', photo: false }
        ]
    }
];

let currentUser = null;
let currentBatchProgress = 84;

// 📊 Global Datasets (Initialized empty, populated from Cloud/Local)
let yieldData = {
    labels: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    inspected: [0, 0, 0, 0, 0, 0, 0],
    passed: [0, 0, 0, 0, 0, 0, 0],
    scrapped: [0, 0, 0, 0, 0, 0, 0]
};
let units = {};
let manufacturingStages = [...DEFAULT_STAGES];
// ✅ START WITH EMPTY — always load from localStorage/Firebase (prevents stale hardcoded list)
let usersData = [];
let globalAuditLog = [];

// ⚡ INSTANT LOCAL LOAD — run synchronously before Firebase connects
// This ensures users are always visible even if Firebase is slow/blocked
try {
    const localUsers = localStorage.getItem('usersData');
    if (localUsers) usersData = JSON.parse(localUsers);
} catch (_) { usersData = []; }

// 🔀 MERGE HELPER — unions cloud + local users by accessId (never wipes either side)
function mergeUsers(cloudList = [], localList = []) {
    const merged = [...localList];
    cloudList.forEach(cloudUser => {
        const exists = merged.find(u => u.accessId === cloudUser.accessId || u.id === cloudUser.id);
        if (!exists) merged.push(cloudUser); // add cloud users not in local
        else {
            // Update stats from cloud (keep freshest data) but don't overwrite name/role/pass
            const idx = merged.indexOf(exists);
            merged[idx] = { ...cloudUser, ...exists }; // local wins on conflicts
        }
    });
    return merged;
}

// 🏺 Persistence Handlers (CLOUD + LOCAL REDUNDANCY)
let cloudWriteLock = false; // 🔒 Prevents snapshot from overwriting during active writes

// 🎮 Simulation Control Flags
let simPaused = false;  // true = loop is frozen mid-run
let simStopped = false;  // true = loop should abort after current unit
let simQueueNext = false; // true = queue another batch after current completes
let simBatchSize = 100;  // default batch size
let currentView = '';       // 📍 Tracks the currently active page/template
let analyticsLiveInterval = null; // 🔄 Polling interval for live analytics refresh
let ledgerWriteLock = false; // 🔒 Prevents snapshot from overwriting freshly-simulated units

async function persistUsers() {
    localStorage.setItem('usersData', JSON.stringify(usersData));
    if (cloudActive) {
        cloudWriteLock = true;
        try {
            await db.collection('sys').doc('users').set({ data: usersData });
        } finally {
            setTimeout(() => { cloudWriteLock = false; }, 1500); // Release lock after 1.5s
        }
    }
}

async function persistStages() {
    localStorage.setItem('manufacturingStages', JSON.stringify(manufacturingStages));
    if (cloudActive) await db.collection('sys').doc('stages').set({ data: manufacturingStages });
}

async function persistYieldData() {
    localStorage.setItem('yieldData', JSON.stringify(yieldData));
    if (cloudActive) await db.collection('sys').doc('analytics').set({ data: yieldData });
}

async function persistUnits() {
    localStorage.setItem('units', JSON.stringify(units)); // always save locally first
    if (cloudActive) {
        ledgerWriteLock = true; // 🔒 prevent snapshot from overwriting our fresh write
        try {
            await db.collection('sys').doc('ledger').set({ data: units });
        } finally {
            setTimeout(() => { ledgerWriteLock = false; }, 3000); // 3s: longer than snapshot round-trip
        }
    }
}

async function pushAudit(event, details) {
    globalAuditLog.unshift({ time: new Date().toLocaleTimeString(), op: currentUser.name || 'System', event: event, details: details });
    if (globalAuditLog.length > 50) globalAuditLog.pop();
    persistAudit();
}

async function persistAudit() {
    localStorage.setItem('globalAuditLog', JSON.stringify(globalAuditLog));
    if (cloudActive) await db.collection('sys').doc('audit').set({ data: globalAuditLog });
}

function updateCloudStatus(isActive, message) {
    const dot = document.getElementById('cloud-status-dot');
    const text = document.getElementById('cloud-status-badge-text');
    const loginDot = document.getElementById('login-cloud-dot');
    const loginText = document.getElementById('login-cloud-text');

    const statusColor = isActive ? 'var(--success)' : (message && message.includes('CONN') ? 'var(--warning)' : 'var(--error)');
    const statusText = message || (isActive ? 'CLOUD SYNC ACTIVE' : 'CLOUD OFFLINE');

    if (dot) dot.style.background = statusColor;
    if (text) {
        text.textContent = statusText;
        text.style.color = statusColor;
    }

    if (loginDot) loginDot.style.background = statusColor;
    if (loginText) {
        loginText.textContent = statusText;
        loginText.style.color = statusColor;
    }
}

// 🔋 INITIAL DATA SYNC ENGINE
async function initSystemCloudSync() {
    updateCloudStatus(false, 'CONNECTING...');

    // 1. Initial Load from Local Storage (Instant UI)
    const localUsers = localStorage.getItem('usersData');
    const localStages = localStorage.getItem('manufacturingStages');
    const localAnalytics = localStorage.getItem('yieldData');
    const localLedger = localStorage.getItem('units');
    const localAudit = localStorage.getItem('globalAuditLog');

    if (localUsers) usersData = JSON.parse(localUsers);
    if (localStages) manufacturingStages = JSON.parse(localStages);
    if (localAnalytics) yieldData = JSON.parse(localAnalytics);
    if (localLedger) units = JSON.parse(localLedger);
    if (localAudit) globalAuditLog = JSON.parse(localAudit);

    /* 🔐 Restore Session Disabled: User prefers starting at Login for sync verification
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        document.getElementById('screen-login').classList.add('hidden');
        document.getElementById('main-layout').classList.remove('hidden');
        applyRoleRestrictions();
        showDashboard();

        const accessInput = document.getElementById('login-access-id');
        if (accessInput && !accessInput.value) accessInput.value = currentUser.accessId;
    }
    */

    if (!cloudActive) {
        updateCloudStatus(false, 'LOCAL ONLY MODE');
        return;
    }

    try {
        // 🔬 FIREBASE DIAGNOSTIC: Test actual read before subscribing
        // This catches expired/blocked security rules immediately
        try {
            await db.collection('sys').doc('users').get();
            console.log('✅ Firebase read test: SUCCESS');
        } catch (testErr) {
            console.error('❌ Firebase read BLOCKED:', testErr.code, testErr.message);
            updateCloudStatus(false, 'RULES BLOCKED — FIX FIREBASE');
            showToast('⚠️ Firebase access denied. Check Firestore Security Rules in Firebase Console.', 'error', 8000);
            return; // Fall through to local-only mode
        }

        const collections = ['users', 'stages', 'analytics', 'ledger', 'audit'];
        for (const col of collections) {
            // 🛰️ REAL-TIME CLOUD HANDSHAKE (onSnapshot)
            db.collection('sys').doc(col).onSnapshot(doc => {
                if (doc.exists) {
                    const cloudData = doc.data().data;
                    // 🔀 USERS: MERGE (not replace) to prevent newly-added users from disappearing
                    if (col === 'users') {
                        if (cloudWriteLock) return; // skip if we just wrote
                        const merged = mergeUsers(cloudData, usersData);
                        // Only update + re-persist if cloud had something new
                        if (merged.length !== usersData.length) {
                            usersData = merged;
                            persistUsers(); // sync merged list back to cloud
                        } else {
                            usersData = merged;
                        }
                    }
                    // 🔒 LEDGER: respect write-lock — don't overwrite fresh simulation data
                    if (col === 'ledger' && !ledgerWriteLock) units = cloudData;
                    if (col === 'analytics') yieldData = cloudData;
                    if (col === 'audit') globalAuditLog = cloudData;

                    // 🛰️ LIVE UI REFRESH: Update dashboard gauges/charts as soon as cloud data arrives
                    if (col === 'ledger' || col === 'analytics') {
                        if (currentView === 'adminDashboard') updateAdminGauges();
                        if (currentView === 'analytics' || currentView === 'executiveAnalytics') {
                            updateAnalyticsSummary();
                            renderExecutiveCharts();
                        }
                    }

                    // Live UI Refreshes (If on correct view)
                    if (col === 'ledger' && document.getElementById('trace-result-area')) runLiveFilter();
                    if (col === 'users' && document.getElementById('mgmt-user-list-body')) populateUserList();
                }
            }, error => {
                console.error(`Subscription Error for ${col}:`, error);
            });
        }

        // ⚡ MASTER MANAGEMENT INJECTION: Ensure executive access is NEVER lost
        const masters = [
            { id: 'u_master_ismail', name: 'Ismail', role: 'admin', accessId: 'ismail', pass: '123', stats: { passed: 0, scrapped: 0 } },
            { id: 'u_master_nitish', name: 'Nitish', role: 'admin', accessId: 'nitish', pass: '123', stats: { passed: 0, scrapped: 0 } }
        ];

        let updated = false;
        masters.forEach(m => {
            if (!usersData.find(u => u.accessId === m.accessId)) {
                usersData.push(m);
                updated = true;
            }
        });

        if (updated) persistUsers(); // Push to cloud if new masters added

        updateCloudStatus(true, 'CLOUD SYNC VERIFIED');
        showToast("✅ Real-Time Firebase Subscription Active", "success", 2000);
    } catch (e) {
        updateCloudStatus(false, 'SYNC ERROR');
        showToast("⚠️ Cloud Connection Error - Using Local Archive", "warning");
    }
}

async function seedCloudData() {
    if (!cloudActive) return;
    showToast("📤 Uploading default factory setup to cloud...", "info");
    await persistUsers();
    await persistStages();
    await persistYieldData();
    await persistUnits();
    showToast("🚀 Cloud Seeding Complete!", "success");
}

// Run Sync at startup
initSystemCloudSync();


// 🏛️ AUTHENTIC LEGACY PRODUCTION DATASET (Oct 2025 - Mar 2026)
// This data is extracted from the manual testing Excel logs provided.
const legacyManualPerformance = {
    months: ['Oct 2025', 'Nov 2025', 'Dec 2025', 'Jan 2026', 'Feb 2026', 'Mar 2026'],
    inventoryPlan: 3000,
    data: {
        'Oct 2025': { s1: { rej: 13, scr: 10, loss: 23, fg: 2977 }, s2: { rej: 18, scr: 3, loss: 21, fg: 2956 }, s3_1: { rej: 83, scr: 5, loss: 88, fg: 2868 }, s3_2: { rej: 98, scr: 2, loss: 100, fg: 2768 }, s4: { rej: 43, scr: 7, loss: 50, fg: 2718 }, s5: { rej: 26, scr: 4, loss: 30, fg: 2688 }, s6: { loss: 54, fg: 2634 }, totalFG: 2634 },
        'Nov 2025': { s1: { rej: 15, scr: 12, loss: 27, fg: 2973 }, s2: { rej: 23, scr: 4, loss: 27, fg: 2946 }, s3_1: { rej: 76, scr: 7, loss: 83, fg: 2863 }, s3_2: { rej: 110, scr: 3, loss: 113, fg: 2750 }, s4: { rej: 45, scr: 8, loss: 53, fg: 2697 }, s5: { rej: 38, scr: 5, loss: 43, fg: 2654 }, s6: { loss: 63, fg: 2591 }, totalFG: 2591 },
        'Dec 2025': { s1: { rej: 15, scr: 7, loss: 22, fg: 2978 }, s2: { rej: 13, scr: 9, loss: 22, fg: 2956 }, s3_1: { rej: 75, scr: 6, loss: 81, fg: 2875 }, s3_2: { rej: 102, scr: 7, loss: 109, fg: 2766 }, s4: { rej: 36, scr: 4, loss: 40, fg: 2726 }, s5: { rej: 25, scr: 8, loss: 33, fg: 2693 }, s6: { loss: 55, fg: 2638 }, totalFG: 2638 },
        'Jan 2026': { s1: { rej: 17, scr: 3, loss: 20, fg: 2980 }, s2: { rej: 22, scr: 5, loss: 27, fg: 2953 }, s3_1: { rej: 85, scr: 5, loss: 90, fg: 2863 }, s3_2: { rej: 95, scr: 5, loss: 100, fg: 2763 }, s4: { rej: 43, scr: 7, loss: 50, fg: 2713 }, s5: { rej: 26, scr: 4, loss: 30, fg: 2683 }, s6: { loss: 70, fg: 2613 }, totalFG: 2613 },
        'Feb 2026': { s1: { rej: 20, scr: 5, loss: 25, fg: 2975 }, s2: { rej: 25, scr: 10, loss: 35, fg: 2940 }, s3_1: { rej: 80, scr: 3, loss: 83, fg: 2857 }, s3_2: { rej: 85, scr: 10, loss: 95, fg: 2762 }, s4: { rej: 30, scr: 25, loss: 55, fg: 2707 }, s5: { rej: 27, scr: 10, loss: 37, fg: 2670 }, s6: { loss: 50, fg: 2620 }, totalFG: 2620 },
        'Mar 2026': { s1: { rej: 24, scr: 8, loss: 32, fg: 2968 }, s2: { rej: 35, scr: 12, loss: 47, fg: 2921 }, s3_1: { rej: 87, scr: 5, loss: 92, fg: 2829 }, s3_2: { rej: 92, scr: 7, loss: 99, fg: 2730 }, s4: { rej: 43, scr: 12, loss: 55, fg: 2675 }, s5: { rej: 18, scr: 7, loss: 25, fg: 2650 }, s6: { loss: 60, fg: 2590 }, totalFG: 2590 }
    }
};

let historicalSummary = {
    manualEra: {
        avgYield: 87.1,
        avgLossPerMonth: 387,
        highestDefectStage: 'Software Flashing (Stages 3.1 & 3.2)'
    },
    systemImpact: {
        improvementTarget: 98.5,
        wasteReduction: 82.4
    }
};

// 📈 Fatigue & Concentration Dataset
let fatigueData = [10, 15, 22, 45, 65, 30, 55, 85]; // Fatigue index over 8hr shift
let defectConcentration = [
    { zone: "Solder Station", rate: 45 },
    { zone: "Display Mount", rate: 25 },
    { zone: "Final Test", rate: 10 },
    { zone: "Packaging", rate: 5 }
];



// (Moved to top to prevent ReferenceError)

// 🔋 MIGRATION & RECOVERY HELPERS
function resetStages() {
    if (confirm("Reset all workflow stages to factory defaults?")) {
        manufacturingStages = [...DEFAULT_STAGES];
        persistStages();
        location.reload();
    }
}


let editingStageId = null;
let activeExecutionUnit = null; // Currently scanned unit in Operator view
let activeExecutionStage = null; // Currently selected stage in Operator view
let draggedStageId = null;
let gateOverrideActive = false;
let activeCheckpointPhotos = {}; // Store photos per checkpoint index



// (Removed Redundant Declarations - Now handled in Cloud Core at top of file)

const templates = {
    adminDashboard: `
        <div class="animate-fade">
            <div class="view-header admin-hero-header" style="margin-bottom: 2rem;">
                <div>
                    <h2 class="view-title-main">Production Oversight & MRB</h2>
                    <p class="text-muted">High-density operational intelligence</p>
                </div>
                <div class="flex gap-3">
                    <button class="btn btn-outline" style="border-color:var(--error); color:var(--error);" onclick="clearCurrentShiftData()"><i data-lucide="trash-2" style="width:18px"></i> Clear Shift Data</button>
                    <button class="btn btn-outline" onclick="showTransferData()"><i data-lucide="download" style="width:18px"></i> Export Ledger</button>
                    <button class="btn btn-primary" onclick="showStageManagement()"><i data-lucide="settings" style="width:18px"></i> Manage Workflow</button>
                </div>
            </div>

            <!-- 🪐 THE BIG THREE: ACTIONABLE OVERVIEW -->
            <div class="stat-grid" style="grid-template-columns: repeat(3, 1fr); margin-bottom: 2rem; align-items: stretch;">
                <!-- LIVE FPY GAUGE -->
                <div class="card glass flex flex-col justify-between" style="padding: 2rem; border-bottom: 4px solid var(--success);">
                    <div style="font-size: 0.7rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.2em; margin-bottom: 1rem;">Live First-Pass Yield</div>
                    <!-- Gauge -->
                    <div style="display:flex; justify-content:center; margin-bottom: 1.25rem;">
                        <div style="position: relative; width: 140px; height: 140px; display: flex; align-items: center; justify-content: center;">
                            <svg viewBox="0 0 100 100" style="width: 100%; transform: rotate(-90deg);">
                                <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="8"></circle>
                                <circle id="fpy-gauge-circle" cx="50" cy="50" r="45" fill="none" stroke="var(--success)" stroke-width="8"
                                        stroke-dasharray="282.7" stroke-dashoffset="15" style="filter: drop-shadow(0 0 8px var(--success)); transition: stroke-dashoffset 0.8s ease;"></circle>
                            </svg>
                            <div style="position: absolute; text-align: center;">
                                <div style="font-size: 2.5rem; font-weight: 900; line-height: 1;" id="live-fpy-val">--%</div>
                                <div class="text-muted" style="font-size: 0.6rem; font-weight: 800;">CURRENT YIELD</div>
                            </div>
                        </div>
                    </div>
                    <!-- Target vs Actual — unique info, not repeated elsewhere -->
                    <div style="border-top: 1px solid var(--border); padding-top: 1rem; display:flex; flex-direction:column; gap:0.5rem;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-size:0.68rem; font-weight:700; color:var(--text-muted);">🎯 Target FPY</span>
                            <span style="font-size:0.85rem; font-weight:900; color:var(--success);">98.5%</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-size:0.68rem; font-weight:700; color:var(--text-muted);">📉 Gap to Target</span>
                            <span style="font-size:0.85rem; font-weight:900; color:var(--warning);" id="fpy-gap-val">--</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-size:0.68rem; font-weight:700; color:var(--text-muted);">📋 Historical Baseline</span>
                            <span style="font-size:0.85rem; font-weight:900; color:var(--text-muted);">87.1%</span>
                        </div>
                    </div>
                </div>

                <!-- SHIFT VOLUME PROGRESS -->
                <div class="card glass flex flex-col justify-between" style="padding: 2rem; border-bottom: 4px solid var(--primary);">
                    <div>
                        <div style="font-size: 0.7rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.2em; margin-bottom: 1rem;">Shift Production Progress</div>
                        <div class="flex justify-between items-end" style="margin-bottom: 0.75rem;">
                            <div style="font-size: 3rem; font-weight: 900; line-height: 1;"><span id="total-shift-pass">0</span><span style="font-size: 1rem; color: var(--text-muted); font-weight: 500;"> / <span id="total-shift-processed">0</span> UNITS</span></div>
                            <div style="font-weight: 800; color: var(--primary);" id="shift-perc-label">0%</div>
                        </div>
                        <div class="progress-bar-container" style="width: 100%; height: 10px; background: rgba(255,255,255,0.05); border-radius: 6px; overflow: hidden; margin-bottom: 1.25rem;">
                            <div style="width: 0%; height: 100%; background: linear-gradient(90deg, var(--primary), var(--accent)); box-shadow: 0 0 15px var(--primary-glow); transition: width 0.8s ease;" id="shift-progress-fill"></div>
                        </div>
                    </div>
                    <!-- Unique production KPIs — not repeated in other cards -->
                    <div style="border-top: 1px solid var(--border); padding-top: 1rem; display:flex; flex-direction:column; gap:0.5rem;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-size:0.68rem; font-weight:700; color:var(--text-muted);">⏱ Shift Duration</span>
                            <span style="font-size:0.85rem; font-weight:900; color:var(--primary);" id="shift-duration-inline">--</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-size:0.68rem; font-weight:700; color:var(--text-muted);">📦 Batches Run</span>
                            <span style="font-size:0.85rem; font-weight:900; color:var(--text-main);" id="shift-batches-inline">--</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-size:0.68rem; font-weight:700; color:var(--text-muted);">⚡ Throughput Rate</span>
                            <span style="font-size:0.85rem; font-weight:900; color:var(--accent);" id="shift-rate-inline">-- u/hr</span>
                        </div>
                    </div>
                </div>

                <!-- MRB STATUS ALERT -->
                <div class="card glass flex flex-col justify-between" style="padding: 2rem; border-bottom: 4px solid var(--error);">
                    <div>
                        <div style="font-size: 0.7rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.2em; margin-bottom: 1.25rem;">Quality Inbox Breakdown</div>

                        <!-- MRB Pending (Hero) -->
                        <div style="display:flex; align-items:center; justify-content:space-between; padding: 0.65rem 0.85rem; border-radius: 8px; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); margin-bottom: 0.5rem;">
                            <div style="display:flex; align-items:center; gap:0.6rem;">
                                <div style="width:8px; height:8px; border-radius:50%; background:var(--error); box-shadow: 0 0 8px var(--error);"></div>
                                <span style="font-size:0.72rem; font-weight:700; color:var(--text-muted);">MRB Pending Decision</span>
                            </div>
                            <span style="font-size:1.4rem; font-weight:900; color:var(--error); line-height:1;" id="total-mrb-count">0</span>
                        </div>

                        <!-- WIP -->
                        <div style="display:flex; align-items:center; justify-content:space-between; padding: 0.55rem 0.85rem; border-radius: 8px; background: rgba(59,130,246,0.06); border: 1px solid rgba(59,130,246,0.15); margin-bottom: 0.5rem;">
                            <div style="display:flex; align-items:center; gap:0.6rem;">
                                <div style="width:8px; height:8px; border-radius:50%; background:var(--primary);"></div>
                                <span style="font-size:0.72rem; font-weight:700; color:var(--text-muted);">Work In Progress (WIP)</span>
                            </div>
                            <span style="font-size:1.4rem; font-weight:900; color:var(--primary); line-height:1;" id="inbox-wip-count">0</span>
                        </div>

                        <!-- Scrap -->
                        <div style="display:flex; align-items:center; justify-content:space-between; padding: 0.55rem 0.85rem; border-radius: 8px; background: rgba(245,158,11,0.06); border: 1px solid rgba(245,158,11,0.15); margin-bottom: 0.5rem;">
                            <div style="display:flex; align-items:center; gap:0.6rem;">
                                <div style="width:8px; height:8px; border-radius:50%; background:var(--warning);"></div>
                                <span style="font-size:0.72rem; font-weight:700; color:var(--text-muted);">Scrapped Units</span>
                            </div>
                            <span style="font-size:1.4rem; font-weight:900; color:var(--warning); line-height:1;" id="inbox-scrap-count">0</span>
                        </div>

                        <!-- Rework -->
                        <div style="display:flex; align-items:center; justify-content:space-between; padding: 0.55rem 0.85rem; border-radius: 8px; background: rgba(168,85,247,0.06); border: 1px solid rgba(168,85,247,0.15); margin-bottom: 0.5rem;">
                            <div style="display:flex; align-items:center; gap:0.6rem;">
                                <div style="width:8px; height:8px; border-radius:50%; background:var(--accent);"></div>
                                <span style="font-size:0.72rem; font-weight:700; color:var(--text-muted);">Authorized Rework</span>
                            </div>
                            <span style="font-size:1.4rem; font-weight:900; color:var(--accent); line-height:1;" id="inbox-rework-count">0</span>
                        </div>

                        <!-- Passed -->
                        <div style="display:flex; align-items:center; justify-content:space-between; padding: 0.55rem 0.85rem; border-radius: 8px; background: rgba(16,185,129,0.06); border: 1px solid rgba(16,185,129,0.15); margin-bottom: 1rem;">
                            <div style="display:flex; align-items:center; gap:0.6rem;">
                                <div style="width:8px; height:8px; border-radius:50%; background:var(--success);"></div>
                                <span style="font-size:0.72rem; font-weight:700; color:var(--text-muted);">Passed / Completed</span>
                            </div>
                            <span style="font-size:1.4rem; font-weight:900; color:var(--success); line-height:1;" id="inbox-passed-count">0</span>
                        </div>
                    </div>
                     <button class="btn btn-primary" onclick="goToMRB()" style="background: var(--error); border:none; width: 100%; justify-content: center; gap: 8px;">
                         <i data-lucide="alert-circle" style="width:16px;"></i> Action Decision Inbox
                     </button>
                </div>
            </div>

            <div class="dashboard-grid" style="grid-template-columns: 2fr 1fr; align-items: stretch;">
                <div class="card glass" style="padding:0; overflow:hidden; display:flex; flex-direction:column;">
                     <div style="padding: 1.5rem; border-bottom: 1px solid var(--border); display:flex; justify-content:space-between; align-items:center; flex-shrink:0;">
                        <h3 class="section-title-sm" style="margin:0;">Factory Operational Heartbeat</h3>
                        <div class="flex items-center gap-2">
                             <div class="status-dot-pulse"></div>
                             <span style="font-size: 0.65rem; font-weight: 800; color: var(--success);">LIVE STREAM ACTIVE</span>
                        </div>
                     </div>
                     <div class="table-container" style="border:none; border-radius:0; flex:1; overflow-y:auto;">
                        <table>
                            <thead><tr><th>RECENT LOGS</th><th>STATION</th><th>EVENT</th><th>TIMESTAMP</th></tr></thead>
                            <tbody id="live-audit-stream">
                                <!-- Recent Events injected here -->
                            </tbody>
                        </table>
                     </div>
                </div>

                <div class="flex flex-col gap-6">
                    <div class="card glass">
                        <div class="flex justify-between items-center" style="margin-bottom: 1.5rem;">
                            <h3 class="section-title-sm" style="margin:0;">Station Yield Heatmap</h3>
                            <i data-lucide="info" style="width:12px; color:var(--text-muted);"></i>
                        </div>
                        <div id="stage-yield-heat-map" class="flex flex-col gap-4">
                            <!-- Heat Map Circles injected -->
                        </div>
                    </div>
                    
                    <div class="card glass" style="border-top: 3px solid var(--primary); padding: 1.25rem;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                            <h4 style="font-size:0.65rem; font-weight:900; text-transform:uppercase; letter-spacing:0.12em; color:var(--text-muted); margin:0;">Current Shift Summary</h4>
                            <div class="status-dot-pulse"></div>
                        </div>
                        <div class="flex flex-col" style="gap:0.55rem;">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-size:0.68rem; font-weight:700; color:var(--text-muted);">Shift Started</span>
                                <span id="shift-started-val" style="font-size:0.72rem; font-weight:800;">--</span>
                            </div>
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-size:0.68rem; font-weight:700; color:var(--text-muted);">Duration</span>
                                <span id="shift-duration-val" style="font-size:0.72rem; font-weight:800; color:var(--primary);">--</span>
                            </div>
                            <div style="border-top:1px solid var(--border); margin:0.2rem 0;"></div>
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-size:0.68rem; font-weight:700; color:var(--text-muted);">Batches Run</span>
                                <span id="shift-batches-val" style="font-size:0.72rem; font-weight:800;">--</span>
                            </div>
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-size:0.68rem; font-weight:700; color:var(--text-muted);">Total Units</span>
                                <span id="shift-units-val" style="font-size:0.72rem; font-weight:800;">--</span>
                            </div>
                            <div style="border-top:1px solid var(--border); margin:0.2rem 0;"></div>
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-size:0.68rem; font-weight:700; color:var(--text-muted);">Avg FPY</span>
                                <span id="shift-fpy-card-val" style="font-size:0.72rem; font-weight:900;">--</span>
                            </div>
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-size:0.68rem; font-weight:700; color:var(--text-muted);">MRB Pending</span>
                                <span id="shift-mrb-card-val" style="font-size:0.72rem; font-weight:900;">--</span>
                            </div>
                        </div>
                    </div>

                    <div class="card glass" style="border-top: 3px solid var(--error); padding: 1.25rem;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                            <h4 style="font-size:0.65rem; font-weight:900; text-transform:uppercase; letter-spacing:0.12em; color:var(--text-muted); margin:0;">⚡ Urgent MRB Queue</h4>
                            <button class="btn btn-outline" style="font-size:0.6rem; padding:3px 10px;" onclick="showTraceability()">View All</button>
                        </div>
                        <div id="quick-mrb-list" class="flex flex-col" style="gap:0.5rem;">
                            <div class="text-muted" style="font-size:0.65rem; text-align:center; padding:1rem 0;">No units awaiting decision.</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `,

    analytics: `
        <div class="animate-fade">
             <div class="view-header">
                <div>
                    <h2 class="view-title-main">Deep-Dive Yield Intelligence</h2>
                    <p class="text-muted">Analyzing current shift performance vs. historical baseline benchmarks</p>
                </div>
            </div>

            <div class="stat-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 2rem;">
                 <div class="card glass">
                    <div class="stat-label">Live System FPY</div>
                    <div class="stat-value" style="color:var(--success)" id="kpi-fpy-val">--</div>
                    <div style="font-size:0.65rem; font-weight:800; color:var(--text-muted); margin-top:0.5rem;" id="kpi-fpy-sub">TARGET: 98.5%</div>
                 </div>
                 <div class="card glass">
                    <div class="stat-label">Digital vs Baseline Gap</div>
                    <div class="stat-value" style="color:var(--primary)" id="kpi-gap-val">--</div>
                    <div style="font-size:0.65rem; font-weight:800; color:var(--text-muted); margin-top:0.5rem;">VS 87.1% BASELINE AVG</div>
                 </div>
                 <div class="card glass">
                    <div class="stat-label">MRB Pending Queue</div>
                    <div class="stat-value" style="color:var(--warning)" id="kpi-mrb-val">--</div>
                    <div style="font-size:0.65rem; font-weight:800; color:var(--text-muted); margin-top:0.5rem;" id="kpi-mrb-sub">UNITS AWAITING DECISION</div>
                 </div>
                 <div class="card glass">
                    <div class="stat-label">Live Scrap Rate</div>
                    <div class="stat-value" style="color:var(--accent)" id="kpi-scrap-val">--</div>
                    <div style="font-size:0.65rem; font-weight:800; color:var(--text-muted); margin-top:0.5rem;" id="kpi-scrap-sub">BASELINE BENCHMARK: 12.9%</div>
                 </div>
            </div>

            <div class="dashboard-grid" style="grid-template-columns: 2fr 1fr;">
                <div class="card glass spc-card-clickable" id="card-spc">
                    <div class="flex justify-between items-center" style="margin-bottom: 1.5rem; cursor: pointer;" onclick="toggleExpandCard('card-spc', 'spc-container')" title="Click to expand for full-screen view">
                        <div style="display:flex; align-items:center; gap: 0.75rem;">
                            <h3 class="section-title-sm" style="margin:0;">Statistical Process Control (SPC) — Batch Yield Window</h3>
                            <span id="spc-expand-hint" style="font-size:0.55rem; font-weight:800; color:var(--primary); text-transform:uppercase; letter-spacing:0.15em; opacity:0.7;">Click to expand ↗</span>
                        </div>
                        <button class="btn btn-icon spc-expand-btn" style="background:rgba(59,130,246,0.1); border:1px solid rgba(59,130,246,0.25); border-radius:8px; color:var(--primary); padding:6px; transition:all 0.2s;" onclick="event.stopPropagation(); toggleExpandCard('card-spc', 'spc-container')" title="Maximize chart">
                            <i data-lucide="maximize-2" id="spc-expand-icon" style="width:16px; height:16px;"></i>
                        </button>
                    </div>
                    <div style="height:300px; position: relative; cursor: pointer;" id="spc-container" onclick="toggleExpandCard('card-spc', 'spc-container')" title="Click to expand chart">
                        <canvas id="spc-yield-chart"></canvas>
                        <div class="chart-loader" style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:0.6rem; color:var(--text-muted); font-weight:800; background:rgba(0,0,0,0.1); border-radius:12px;">ENGINE INITIALIZING...</div>
                    </div>
                    <div class="flex justify-between items-center" style="margin-top: 1rem; font-size: 0.65rem; font-weight: 800; color: var(--text-muted);">
                        <span>UPPER CONTROL LIMIT: <span style="color:var(--error)" id="spc-ucl-label">--</span></span>
                        <span>PROCESS MEAN (X̄): <span style="color:var(--primary)" id="spc-mean-label">--</span></span>
                        <span>LOWER CONTROL LIMIT: <span style="color:var(--warning)" id="spc-lcl-label">--</span></span>
                    </div>
                </div>

                <div class="card glass shadow-lg">
                    <h3 class="section-title-sm" style="color:var(--error)">⚠️ Critical Management Actions</h3>
                    <p class="text-muted" style="font-size: 0.7rem; margin-bottom: 1.5rem;">Stages currently performing below 92% benchmark</p>
                    <div id="bottleneck-action-list" class="flex flex-col gap-3">
                         <!-- Bottlenecks injected here -->
                    </div>
                </div>
            </div>

            <div class="dashboard-grid" style="grid-template-columns: 1fr 1fr; margin-top: 2rem;">
                <div class="card glass">
                    <h3 class="section-title-sm">6-Month Production Transformation (Baseline vs Digital)</h3>
                    <div style="height:250px; margin-top:1.5rem; position: relative;" id="trend-container">
                        <canvas id="monthly-trend-chart"></canvas>
                        <div class="chart-loader" style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:0.6rem; color:var(--text-muted); font-weight:800; background:rgba(0,0,0,0.1); border-radius:12px;">ENGINE INITIALIZING...</div>
                    </div>
                </div>

                <div class="card glass">
                    <h3 class="section-title-sm">📋 Defect Pareto — Rejections by Stage</h3>
                    <p class="text-muted" style="font-size:0.65rem; margin-bottom: 0.5rem;">Ranked by total MRB rejections. Top bar = biggest bottleneck.</p>
                    <div style="height:250px; margin-top:0.5rem; position: relative;" id="pareto-container">
                        <canvas id="pareto-chart"></canvas>
                        <div class="chart-loader" style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:0.6rem; color:var(--text-muted); font-weight:800; background:rgba(0,0,0,0.1); border-radius:12px;">COMPUTING...</div>
                    </div>
                </div>
            </div>
        </div>
    `,
    operatorDashboard: `
        <div class="animate-fade">
            <div class="card operator-hero-card">
                <div class="flex justify-between items-center">
                    <div>
                        <div class="flex items-center gap-2" style="margin-bottom: 0.75rem;">
                             <span class="badge badge-success" style="font-size: 0.65rem;">Live Station</span>
                             <span id="active-station-name" style="font-size: 0.75rem; color: var(--text-muted); font-weight: 700;">STATION G-SERIES</span>
                        </div>
                        <h2 style="font-size: 1.75rem; font-weight: 800; margin-bottom: 1.25rem;">Select Production Stage</h2>
                    </div>
                    <div class="flex gap-4">
                        <div class="card glass text-center" style="padding: 0.75rem 1.5rem;">
                            <div style="font-size: 0.6rem; text-transform: uppercase; color: var(--primary);">Your Today's Passed</div>
                            <div style="font-size: 1.25rem; font-weight: 800;" id="op-stat-passed">0</div>
                        </div>
                        <div class="card glass text-center" style="padding: 0.75rem 1.5rem;">
                            <div style="font-size: 0.6rem; text-transform: uppercase; color: var(--error);">Your Today's Scrapped</div>
                            <div style="font-size: 1.25rem; font-weight: 800;" id="op-stat-scrapped">0</div>
                        </div>
                    </div>
                </div>
                <div class="stage-selector-grid" id="stage-selector-grid">
                    <!-- Injected Stages -->
                </div>
            </div>

            <div id="execution-gate-area" class="hidden">
                 <div class="card glass animate-up" style="margin-top: 2rem;">
                    <div class="flex justify-between items-center" style="margin-bottom: 2rem;">
                        <h3 class="section-title-sm" style="margin: 0;">Stage Gate: <span id="gate-stage-name">---</span></h3>
                        <button class="btn btn-outline" style="padding: 0.5rem;" onclick="closeGate()"><i data-lucide="x" style="width:16px"></i></button>
                    </div>
                    
                    <div class="scan-input-area">
                        <label class="form-label">Scan / Enter Unit Serial Number</label>
                        <div class="flex gap-4">
                            <input type="text" id="unit-scan-input" placeholder="e.g. B-101" style="flex: 1;" onkeyup="if(event.key === 'Enter') validateUnitGate()">
                            <button class="btn btn-primary" onclick="validateUnitGate()"><i data-lucide="scan" style="width:18px"></i> Authenticate Unit</button>
                        </div>
                        <div id="gate-msg" class="hidden animate-up" style="margin-top: 1.5rem; padding: 1rem; border-radius: 8px; font-weight: 700; display: flex; align-items: center; gap: 10px;"></div>
                    </div>
                 </div>
            </div>
        </div>
    `,
    executionScreen: `
        <div class="animate-fade" style="max-width: 900px; margin: 0 auto;">
            <div class="inspection-header">
                <div class="flex items-center gap-4">
                    <button class="btn btn-outline" onclick="showDashboard()" style="padding: 0.6rem; border-radius: 12px;"><i data-lucide="arrow-left" style="width:18px"></i></button>
                    <div>
                        <h2 id="exec-stage-title" style="font-size: 1.5rem; font-weight: 800;">---</h2>
                        <span class="text-muted" style="font-size: 0.8rem;">Unit Validated: <strong id="exec-unit-sn" style="color: var(--primary);">#---</strong></span>
                    </div>
                </div>
                <div class="badge badge-success">S/N AUTHORIZED</div>
            </div>

            <div class="flex flex-col gap-4" id="checkpoint-execution-list">
                <!-- Checkpoints injected here -->
            </div>

            <div id="camera-section" class="hidden" style="margin-top: 2rem;">
                <div class="card glass shadow-lg" style="border: 2px solid var(--primary);">
                    <div class="flex justify-between items-center" style="margin-bottom: 1rem;">
                        <h4 style="font-weight: 800;"><i data-lucide="eye" style="width:18px; margin-right:8px; vertical-align:middle;"></i> Live Production Viewfinder</h4>
                        <span class="badge badge-primary">STATION ACTIVE</span>
                    </div>
                    <div style="position: relative; border-radius: 12px; overflow: hidden; background: #000; width: 100%; height: 260px;">
                        <video id="webcam-preview" autoplay playsinline style="width: 100%; height: 100%; object-fit: cover;"></video>
                        <canvas id="photo-canvas" class="hidden"></canvas>
                        <div id="capture-feedback" class="hidden" style="position: absolute; inset: 0; background: rgba(16, 185, 129, 0.2); display: flex; align-items: center; justify-content: center; z-index: 10;">
                             <i data-lucide="check-circle" style="width: 64px; height: 64px; color: #fff;"></i>
                        </div>
                    </div>
                    <p class="text-muted text-center" style="font-size: 0.7rem; margin-top: 0.75rem;">Framing active. Click <strong>"Capture"</strong> on any checkpoint slot below to take a snapshot.</p>
                </div>
            </div>
                        </button>
                    </div>
                    <div id="upload-status" class="text-muted" style="font-size: 0.75rem; margin-top: 0.5rem; text-align: center;"></div>
                </div>
            </div>

            <div class="card" style="margin-top: 2rem;">
                <h4 style="font-weight: 800; margin-bottom: 1rem;">Nested Component Registration</h4>
                <div class="flex gap-4">
                     <input type="text" id="nested-comp-name" placeholder="Comp Name (e.g. Battery)" style="flex: 1;">
                     <input type="text" id="nested-comp-sn" placeholder="Component S/N" style="flex: 1;">
                     <button class="btn btn-outline" onclick="addNestedComp()"><i data-lucide="plus" style="width:16px"></i> Pair</button>
                </div>
                <div id="paired-components-list" style="margin-top: 1rem; font-size: 0.85rem;" class="flex flex-wrap gap-2"></div>
            </div>

            <div class="flex justify-end gap-4" style="margin-top: 2.5rem; padding-bottom: 3rem;">
                <button class="btn btn-outline" style="border-color: var(--error); color: var(--error);" onclick="scrapUnitAction()">Scrap Unit</button>
                <button class="btn btn-primary" onclick="finalizeStage()">Submit Stage Pass</button>
            </div>
        </div>
    `,
    stageManagement: `
        <div class="animate-fade">
            <div class="view-header">
                <div>
                    <h2 class="view-title-main">Workflow Orchestration</h2>
                    <p class="text-muted">Define the sequential stages and mandatory checkpoints</p>
                </div>
                <div class="flex gap-3">
                    <label class="btn btn-outline" style="cursor: pointer;">
                        <input type="file" id="excel-import" style="display: none;" onchange="importExcelWorkflow(event)">
                        <i data-lucide="file-spreadsheet" style="width:18px"></i> Import IPQC Excel
                    </label>
                    <button class="btn btn-outline" onclick="exportWorkflow()"><i data-lucide="download" style="width:18px"></i> Export Config</button>
                    <button class="btn btn-outline" onclick="resetStages()"><i data-lucide="refresh-cw" style="width:18px"></i> Reset to Default</button>
                    <button class="btn btn-primary" onclick="showCreateStage()"><i data-lucide="plus-circle" style="width:18px"></i> Add New Stage</button>
                </div>
            </div>

            <div class="card">
                <h3 class="section-title-sm">Current Order of Operations</h3>
                <div class="workflow-timeline" id="workflow-timeline-list">
                    <!-- Stages cards injected here -->
                </div>
            </div>
        </div>
    `,
    createStage: `
        <div class="animate-fade" style="max-width: 700px; margin: 0 auto;">
             <div class="flex items-center gap-4" style="margin-bottom: 2.5rem;">
                <button class="btn btn-outline" onclick="showStageManagement()" style="padding: 0.6rem; border-radius:12px;"><i data-lucide="arrow-left" style="width:18px"></i></button>
                <h2 class="view-title-main">[[TITLE]]</h2>
            </div>

            <div class="card glass">
                <form onsubmit="saveStage(event)" class="flex flex-col gap-6">
                    <div>
                        <label class="form-label">Stage Name</label>
                        <input type="text" id="stage-name-input" placeholder="e.g. Casing Assembly" required>
                    </div>
                    <div>
                        <label class="form-label">Stage Sequence Order</label>
                        <input type="number" id="stage-order-input" value="1" min="1" required>
                        <p class="text-muted" style="font-size: 0.75rem; margin-top: 0.4rem;">Units must pass lower numbered stages before this one.</p>
                    </div>
                    
                    <div id="checkpoints-creator-area">
                        <label class="form-label">Stage Checkpoints</label>
                        <div id="cp-builder-list" class="flex flex-col gap-3"></div>
                        <button type="button" class="btn btn-outline w-full justify-center" style="margin-top: 1rem;" onclick="addCPRow()">
                            <i data-lucide="plus" style="width:16px"></i> Add Checkpoint
                        </button>
                    </div>

                    <div class="flex gap-4" style="margin-top: 1rem;">
                        <button type="button" class="btn btn-outline w-full" onclick="showStageManagement()">Cancel</button>
                        <button type="submit" class="btn btn-primary w-full">Save Workflow Stage</button>
                    </div>
                </form>
            </div>
        </div>
    `,
    traceability: `
        <div class="animate-fade">
            <div class="view-header">
                <div>
                    <h2 class="view-title-main">Production Ledger & Traceability</h2>
                    <p class="text-muted">Comprehensive history and real-time status of every unit</p>
                </div>
            </div>

            <div class="card glass" style="margin-bottom: 2rem;">
                <div class="flex flex-col gap-5">
                    <div class="flex gap-4">
                        <input type="text" id="search-serial" placeholder="Lookup Serial (e.g. B-101) for full heritage drill-down..." style="flex: 1;">
                        <button class="btn btn-primary" onclick="searchUnit()"><i data-lucide="search" style="width:18px"></i> Trace Unit</button>
                    </div>
                    <div class="filter-group" style="padding-top: 1rem; border-top: 1px solid var(--border);">
                        <span class="text-muted" style="font-size: 0.65rem; font-weight: 800; text-transform: uppercase; margin-right: 0.5rem;">Quick Filters:</span>
                        <label class="filter-chip"><input type="radio" name="ledger-filter" value="all" checked onchange="runLiveFilter()"> All Units</label>
                        <label class="filter-chip"><input type="radio" name="ledger-filter" value="mrb" onchange="runLiveFilter()"><span style="color:var(--error);">Pending Review (MRB)</span></label>
                        <label class="filter-chip"><input type="radio" name="ledger-filter" value="wip" onchange="runLiveFilter()"> WIP</label>
                        <label class="filter-chip"><input type="radio" name="ledger-filter" value="passed" onchange="runLiveFilter()"> Passed</label>
                        <label class="filter-chip"><input type="radio" name="ledger-filter" value="scrap" onchange="runLiveFilter()"> Scrap</label>
                        <label class="filter-chip"><input type="radio" name="ledger-filter" value="rework" onchange="runLiveFilter()"> Rework</label>
                    </div>
                </div>
            </div>

            <div id="trace-result-area"></div>
        </div>
    `,
    userManagement: `
        <div class="animate-fade">
             <div class="view-header">
                <div>
                    <h2 class="view-title-main">Access & Personnel Control</h2>
                    <p class="text-muted">Manage system administrators and line operators</p>
                </div>
                <button class="btn btn-primary" onclick="showAddUserModal()">+ Add New Member</button>
            </div>

            <div class="card">
                <div class="table-container">
                    <table>
                        <thead><tr><th>Full Name</th><th>Access ID</th><th>Role</th><th>Activity Level</th><th>Action</th></tr></thead>
                        <tbody id="user-list-body"></tbody>
                    </table>
                </div>
            </div>

            <div id="user-modal" class="modal-overlay hidden">
                <div class="modal-content card glass animate-up" style="max-width: 400px;">
                    <h3 style="margin-bottom: 1.5rem;">Add System Member</h3>
                    <form onsubmit="saveNewUser(event)" class="flex flex-col gap-4">
                        <div><label class="form-label">Full Name</label><input type="text" id="new-user-name" required></div>
                        <div><label class="form-label">Access ID (Login)</label><input type="text" id="new-user-id" required></div>
                        <div><label class="form-label">Passcode</label><input type="password" id="new-user-pass" required></div>
                        <div>
                            <label class="form-label">Account Role</label>
                            <select id="new-user-role" style="width: 100%;">
                                <option value="operator">Production Line Operator</option>
                                <option value="admin">QA Manager / Admin</option>
                            </select>
                        </div>
                        <div class="flex gap-2" style="margin-top: 1rem;">
                            <button type="button" class="btn btn-outline w-full" onclick="closeUserModal()">Cancel</button>
                            <button type="submit" class="btn btn-primary w-full">Grant Access</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `
};


// 🛠️ Functions
function simulateBadgeScan() {
    const btn = document.getElementById('badge-btn');
    const originalContent = btn.innerHTML;

    btn.classList.add('scanning');
    btn.innerHTML = `<i data-lucide="loader" class="animate-spin" style="width: 20px;"></i> RECOGNIZING BIOMETRICS...`;
    lucide.createIcons();

    setTimeout(() => {
        btn.classList.remove('scanning');
        btn.innerHTML = `<i data-lucide="check-circle" style="width: 20px;"></i> EMPLOYEE AUTHENTICATED`;
        btn.style.borderColor = 'var(--success)';
        btn.style.color = 'var(--success)';
        lucide.createIcons();

        showToast("Biometric Recognition Successful", "Welcome back, Operator", "success");

        setTimeout(() => {
            // Auto-login as operator for demo
            document.getElementById('login-access-id').value = "EMP-808";
            document.getElementById('login-passcode').value = "8800";
            document.getElementById('login-role').value = "operator";
            handleLogin();
        }, 1200);
    }, 2500);
}

function handleLogin() {
    const accessId = document.getElementById('login-access-id').value;
    const pass = document.getElementById('login-passcode').value;
    const roleReq = document.getElementById('login-role').value;

    // 🏆 MASTER LOGIN BYPASS (Management Resilience: Ismail & Nitish)
    const normalizedID = accessId.toLowerCase().trim();
    const normalizedPass = pass.trim();

    if ((normalizedID === 'ismail' || normalizedID === 'nitish') && normalizedPass === '123') {
        console.log("💎 MASTER KEY ENGAGE: Access Granted for Management Role.");
        currentUser = {
            id: normalizedID === 'ismail' ? 'u_master_ismail' : 'u_master_nitish',
            name: normalizedID === 'ismail' ? 'Ismail' : 'Nitish',
            role: 'admin',
            accessId: normalizedID,
            stats: { passed: 0, scrapped: 0 }
        };
        localStorage.setItem('currentUser', JSON.stringify(currentUser));

        document.getElementById('screen-login').classList.add('hidden');
        document.getElementById('main-layout').classList.remove('hidden');
        applyRoleRestrictions();
        showDashboard();
        showToast(`Welcome back, ${currentUser.name}! Executive access enabled.`, "success");
        return;
    }

    // Check in-memory usersData first
    let user = usersData.find(u =>
        u.accessId.toLowerCase().trim() === normalizedID &&
        u.pass.trim() === normalizedPass &&
        u.role === roleReq
    );

    // ✅ FALLBACK: If not found in memory, read directly from localStorage
    // This handles incognito tabs or cases where cloud sync hasn't loaded yet
    if (!user) {
        try {
            const localRaw = localStorage.getItem('usersData');
            if (localRaw) {
                const localUsers = JSON.parse(localRaw);
                user = localUsers.find(u =>
                    u.accessId.toLowerCase().trim() === normalizedID &&
                    u.pass.trim() === normalizedPass &&
                    u.role === roleReq
                );
                // Merge into memory so rest of session works
                if (user) usersData = localUsers;
            }
        } catch (_) { /* ignore parse errors */ }
    }

    if (!user) {
        showToast("Access Denied: Invalid credentials or role mismatch.", "error");
        return;
    }

    currentUser = user;
    localStorage.setItem('currentUser', JSON.stringify(currentUser));

    document.getElementById('screen-login').classList.add('hidden');
    document.getElementById('main-layout').classList.remove('hidden');

    // Apply Role-Based Sidebars
    applyRoleRestrictions();

    showDashboard();
    showToast(`Session Initialized: Welcome, ${user.name}`, "success");
}

function applyRoleRestrictions() {
    if (!currentUser) return;
    const isAdmin = currentUser.role === 'admin';

    // Sidebar Links
    const mgmtLink = document.getElementById('nav-management');
    const analyticsLink = document.getElementById('nav-analytics');
    const traceabilityLink = document.getElementById('nav-traceability');
    const usersLink = document.getElementById('nav-users');

    if (mgmtLink) mgmtLink.style.display = isAdmin ? 'flex' : 'none';
    if (analyticsLink) analyticsLink.style.display = isAdmin ? 'flex' : 'none';
    if (traceabilityLink) traceabilityLink.style.display = isAdmin ? 'flex' : 'none';
    if (usersLink) usersLink.style.display = isAdmin ? 'flex' : 'none';

    // Profile Update
    document.getElementById('user-display-name').textContent = currentUser.name;
    document.getElementById('user-display-role').textContent = isAdmin ? 'QA Manager / Admin' : 'Production Line Operator';

    const initials = currentUser.name.split(' ').map(n => n[0]).join('').toUpperCase();
    document.getElementById('user-avatar-initials').textContent = initials;
}

function showDashboard() {
    if (currentUser.role === 'admin') {
        render('adminDashboard', 'Control Panel', 'Overview');
    } else {
        render('operatorDashboard', 'Execution Desk', 'Live Tasks');
    }
}

function setActiveNav(templateKey) {
    // Map template keys to their sidebar nav link IDs
    const navMap = {
        adminDashboard: 'nav-dashboard',
        stageManagement: 'nav-management',
        createStage: 'nav-management',
        analytics: 'nav-analytics',
        executiveAnalytics: 'nav-analytics',
        traceability: 'nav-traceability',
        userManagement: 'nav-users',
    };
    // Remove active from all nav links
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    // Add active to the matching one
    const targetId = navMap[templateKey];
    if (targetId) {
        const el = document.getElementById(targetId);
        if (el) el.classList.add('active');
    }
}

function toggleExpandCard(cardId, containerId) {
    // 🚀 NEW APPROACH: Open a dedicated full-screen modal instead of
    // trying to position:fixed the card (which made it invisible on dark overlay).
    openSPCModal();
}

function closeSPCModal() {
    const modal = document.getElementById('spc-fullscreen-modal');
    if (modal) {
        modal.style.opacity = '0';
        modal.style.transform = 'scale(0.97)';
        setTimeout(() => modal.remove(), 300);
    }
    // Restore small hint text
    const hint = document.getElementById('spc-expand-hint');
    if (hint) hint.textContent = 'Click to expand ↗';
    const icon = document.getElementById('spc-expand-icon');
    if (icon) { icon.setAttribute('data-lucide', 'maximize-2'); lucide.createIcons(); }
}

function openSPCModal() {
    // Remove any existing modal first
    const existing = document.getElementById('spc-fullscreen-modal');
    if (existing) { closeSPCModal(); return; }

    // Update hint UI
    const hint = document.getElementById('spc-expand-hint');
    if (hint) hint.textContent = 'ESC or click backdrop to close';
    const icon = document.getElementById('spc-expand-icon');
    if (icon) { icon.setAttribute('data-lucide', 'minimize-2'); lucide.createIcons(); }

    // ── Build the modal shell ──
    const modal = document.createElement('div');
    modal.id = 'spc-fullscreen-modal';
    modal.style.cssText = `
        position: fixed; inset: 0; z-index: 2000;
        display: flex; align-items: center; justify-content: center;
        background: rgba(10, 15, 30, 0.85);
        backdrop-filter: blur(10px);
        transition: opacity 0.3s ease, transform 0.3s ease;
        opacity: 0; transform: scale(0.97);
    `;

    // Click backdrop to close
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeSPCModal();
    });

    // ── Build the inner card ──
    const inner = document.createElement('div');
    inner.style.cssText = `
        background: #0f172a;
        border: 1px solid rgba(59,130,246,0.4);
        border-radius: 20px;
        box-shadow: 0 0 60px rgba(59,130,246,0.2), 0 30px 80px rgba(0,0,0,0.7);
        width: 92vw;
        height: 88vh;
        display: flex;
        flex-direction: column;
        padding: 2rem;
        gap: 1rem;
        overflow: hidden;
    `;

    // ── Header row ──
    const header = document.createElement('div');
    header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; flex-shrink:0;';
    header.innerHTML = `
        <div>
            <div style="font-size:0.6rem; font-weight:800; color:var(--primary); text-transform:uppercase; letter-spacing:0.2em; margin-bottom:4px;">📊 Full-Screen Deep Dive</div>
            <h3 style="margin:0; font-size:1.1rem; font-weight:800; color:#fff;">Statistical Process Control (SPC) — Batch Yield Window</h3>
            <p style="margin:4px 0 0; font-size:0.7rem; color:rgba(255,255,255,0.4); font-weight:600;">Shewhart Control Chart · X̄ ± 3σ · Real-Time Batch Data</p>
        </div>
        <button id="spc-modal-close-btn" style="
            background: rgba(239,68,68,0.1);
            border: 1px solid rgba(239,68,68,0.3);
            border-radius: 10px;
            color: #ef4444;
            padding: 8px 16px;
            cursor: pointer;
            font-size: 0.75rem;
            font-weight: 800;
            display:flex; align-items:center; gap:6px;
            transition: background 0.2s;
        ">✕ Close</button>
    `;
    inner.appendChild(header);

    // ── Chart canvas ──
    const chartWrapper = document.createElement('div');
    chartWrapper.style.cssText = 'flex: 1; position: relative; min-height: 0;';
    const canvas = document.createElement('canvas');
    canvas.id = 'spc-modal-canvas';
    chartWrapper.appendChild(canvas);
    inner.appendChild(chartWrapper);

    // ── Footer stats ──
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex; justify-content:space-between; flex-shrink:0; font-size:0.75rem; font-weight:800; color:rgba(255,255,255,0.5); padding-top:0.75rem; border-top:1px solid rgba(255,255,255,0.06);';
    footer.innerHTML = `
        <span>UPPER CONTROL LIMIT (UCL): <span id="spc-modal-ucl" style="color:#a78bfa;">--</span></span>
        <span>PROCESS MEAN (X̄): <span id="spc-modal-mean" style="color:var(--primary);">--</span></span>
        <span>LOWER CONTROL LIMIT (LCL): <span id="spc-modal-lcl" style="color:#f87171;">--</span></span>
    `;
    inner.appendChild(footer);

    modal.appendChild(inner);
    document.body.appendChild(modal);

    // Animate in
    requestAnimationFrame(() => {
        modal.style.opacity = '1';
        modal.style.transform = 'scale(1)';
    });

    // Wire close button
    document.getElementById('spc-modal-close-btn').onclick = closeSPCModal;

    // ESC key
    const escHandler = (e) => {
        if (e.key === 'Escape') { closeSPCModal(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);

    // ── Render the SPC chart inside the modal ──
    setTimeout(() => renderSPCModalChart(), 100);
}

function renderSPCModalChart() {
    const canvas = document.getElementById('spc-modal-canvas');
    if (!canvas) return;

    // Destroy any existing chart on this canvas
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();


    // ── Group by REAL batch label (per production run) ──
    const batchMap = new Map();
    Object.values(units).forEach(u => {
        const label = u.batchLabel || u.serial.split('-')[0]; // fallback: extract prefix from serial
        if (!batchMap.has(label)) batchMap.set(label, { total: 0, passed: 0 });
        const b = batchMap.get(label);
        b.total++;
        if (u.status === 'COMPLETED') b.passed++;
    });

    const DEMO = [96.5, 97.2, 95.8, 92.4, 98.1, 96.6, 95.2, 97.8, 98.5, 96.2, 94.8, 97.5];
    const useDemo = batchMap.size < 2;

    let allYields, batchYields, labels;
    if (useDemo) {
        allYields = DEMO;
        batchYields = DEMO;
        labels = DEMO.map((_, i) => `Demo ${i + 1}`);
    } else {
        // Convert map to sorted array of yields
        const entries = Array.from(batchMap.entries())
            .sort((a, b) => a[0].localeCompare(b[0])); // sort chronologically by batch prefix
        allYields = entries.map(([, v]) => parseFloat(((v.passed / v.total) * 100).toFixed(1)));
        batchYields = allYields.slice(-20); // show last 20 batches
        const allKeys = entries.map(([k]) => k);
        labels = allKeys.slice(-20).map((k, i) => `Batch ${allYields.length - batchYields.length + i + 1}`);
    }

    const n = allYields.length; // Stats from full dataset
    const mean = allYields.reduce((a, b) => a + b, 0) / n;
    const variance = allYields.reduce((s, y) => s + Math.pow(y - mean, 2), 0) / n;
    const sigma = Math.sqrt(variance);
    const ucl = Math.min(parseFloat((mean + 3 * sigma).toFixed(1)), 100);
    const lcl = Math.max(parseFloat((mean - 3 * sigma).toFixed(1)), 70);

    // Update modal footer
    const uclEl = document.getElementById('spc-modal-ucl');
    const meanEl = document.getElementById('spc-modal-mean');
    const lclEl = document.getElementById('spc-modal-lcl');
    if (uclEl) uclEl.textContent = ucl.toFixed(1) + '%';
    if (meanEl) meanEl.textContent = mean.toFixed(1) + '%';
    if (lclEl) lclEl.textContent = lcl.toFixed(1) + '%';
    // Also sync the inline card labels
    const uclCard = document.getElementById('spc-ucl-label');
    const meanCard = document.getElementById('spc-mean-label');
    const lclCard = document.getElementById('spc-lcl-label');
    if (uclCard) uclCard.textContent = ucl.toFixed(1) + '%';
    if (meanCard) meanCard.textContent = mean.toFixed(1) + '%';
    if (lclCard) lclCard.textContent = lcl.toFixed(1) + '%';

    const pointColors = batchYields.map(y => y < lcl ? '#ef4444' : '#10b981');

    new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Batch Yield %',
                data: batchYields,
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.08)',
                borderWidth: 3,
                tension: 0.4,
                fill: true,
                pointRadius: batchYields.map(y => y < lcl ? 10 : 6),
                pointBackgroundColor: pointColors,
                pointBorderColor: 'rgba(255,255,255,0.6)',
                pointBorderWidth: 2,
                pointHoverRadius: 12
            }, {
                label: `UCL (${ucl.toFixed(1)}%)`,
                data: Array(n).fill(ucl),
                borderColor: 'rgba(167,139,250,0.7)',
                borderWidth: 2,
                borderDash: [6, 4],
                pointStyle: false,
                fill: false
            }, {
                label: `Mean X̄ (${mean.toFixed(1)}%)`,
                data: Array(n).fill(parseFloat(mean.toFixed(1))),
                borderColor: 'rgba(59,130,246,0.9)',
                borderWidth: 2,
                borderDash: [10, 4],
                pointStyle: false,
                fill: false
            }, {
                label: `LCL (${lcl.toFixed(1)}%) — Below = OUT OF CONTROL`,
                data: Array(n).fill(lcl),
                borderColor: 'rgba(248,113,113,0.8)',
                borderWidth: 2,
                borderDash: [6, 4],
                pointStyle: false,
                fill: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 800, easing: 'easeInOutQuart' },
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: 'rgba(255,255,255,0.75)',
                        font: { size: 13, weight: '700' },
                        boxWidth: 30,
                        padding: 20
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(15,23,42,0.95)',
                    borderColor: 'rgba(59,130,246,0.5)',
                    borderWidth: 1,
                    titleColor: '#fff',
                    bodyColor: 'rgba(255,255,255,0.7)',
                    callbacks: {
                        afterLabel(ctx) {
                            if (ctx.datasetIndex === 0) {
                                const y = ctx.parsed.y;
                                if (y < lcl) return '⚠️ OUT OF CONTROL — Below LCL!';
                                if (y > ucl) return '⚠️ ABOVE UCL — Check measurement';
                                return '✅ Process In Control';
                            }
                            return null;
                        }
                    }
                }
            },
            scales: {
                y: {
                    min: Math.max(70, lcl - 5),
                    max: 100,
                    grid: { color: 'rgba(255,255,255,0.06)' },
                    ticks: {
                        color: 'rgba(255,255,255,0.5)',
                        callback: v => v + '%',
                        font: { size: 13, weight: '700' }
                    },
                    title: {
                        display: true,
                        text: 'BATCH YIELD %',
                        color: 'rgba(255,255,255,0.3)',
                        font: { size: 12, weight: '800' },
                        padding: 12
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: {
                        color: 'rgba(255,255,255,0.5)',
                        font: { size: 12, weight: '700' }
                    },
                    title: {
                        display: true,
                        text: 'PRODUCTION BATCH TIMELINE',
                        color: 'rgba(255,255,255,0.3)',
                        font: { size: 12, weight: '800' },
                        padding: 12
                    }
                }
            }
        }
    });
}

function render(templateKey, title, breadcrumb) {
    currentView = templateKey; // 📍 Always track active view for live sync
    setActiveNav(templateKey);
    stopWebcam(); // 🔐 Global: Ensure camera is killed when changing views

    document.getElementById('view-title').textContent = title;
    document.getElementById('breadcrumb-text').textContent = breadcrumb;
    const area = document.getElementById('content-area');
    let html = templates[templateKey];

    // Admin Dashboard Injections
    if (templateKey === 'adminDashboard') {
        const totalPassed = yieldData.passed.reduce((a, b) => a + b, 0);
        const totalScrapped = yieldData.scrapped.reduce((a, b) => a + b, 0);
        const totalInspected = yieldData.inspected.reduce((a, b) => a + b, 0);
        const yieldRate = ((totalPassed / totalInspected) * 100).toFixed(1);

        html = html.replace('[[TOTAL_PASSED]]', totalPassed);
        html = html.replace('[[TOTAL_SCRAPPED]]', totalScrapped);
        html = html.replace('[[YIELD_RATE]]', yieldRate);

        const bars = yieldData.labels.map((l, i) => {
            const h = (yieldData.passed[i] / yieldData.inspected[i] * 100);
            return `<div class="chart-bar" style="height: ${h}%; flex: 1; background: var(--primary); border-radius: 4px 4px 0 0; position:relative;">
                        <div style="position:absolute; top:-15px; width:100%; text-align:center; font-size:0.6rem;">${h.toFixed(0)}%</div>
                    </div>`;
        }).join('');
        html = html.replace('[[CHART_BARS]]', bars);

        const stagesList = manufacturingStages.sort((a, b) => a.order - b.order).map(s => `
            <div class="flex justify-between items-center p-3 glass" style="margin-bottom:0.5rem; border-radius:8px;">
                <span>#${s.order} <strong>${s.name}</strong></span>
                <span class="badge badge-success">${s.checkpoints.length} checks</span>
            </div>
        `).join('');
        html = html.replace('[[STAGES_LIST]]', stagesList);
    }

    if (templateKey === 'createStage') {
        html = html.replace('[[TITLE]]', editingStageId ? 'Edit Stage' : 'Define New Stage');
    }

    area.innerHTML = html;

    // Post Render Logic
    if (templateKey === 'analytics') {
        const totalPassed = yieldData.passed.reduce((a, b) => a + b, 0);
        const totalInspected = yieldData.inspected.reduce((a, b) => a + b, 0);
        const currentYield = (totalPassed / totalInspected * 100).toFixed(1);
        const lift = (currentYield - historicalSummary.manualEra.avgYield).toFixed(1);

        const yieldLiftEl = document.getElementById('yield-lift-val');
        if (yieldLiftEl) yieldLiftEl.textContent = `+${lift}%`;

        // Inject Fatigue Visuals
        const fatigueBars = fatigueData.map((v, i) => `
            <div style="flex: 1; height: ${v}%; background: ${v > 70 ? 'var(--error)' : 'var(--primary)'}; opacity: ${0.4 + (i * 0.07)}; border-radius: 4px; position:relative;">
                <div style="position:absolute; bottom:-18px; width:100%; text-align:center; font-size:0.5rem; color:var(--text-muted);">H${i + 1}</div>
            </div>
        `).join('');

        // Inject Heatmap
        const heatmap = defectConcentration.map(d => `
            <div>
                <div class="flex justify-between text-muted" style="font-size: 0.7rem; margin-bottom: 4px;">
                    <span>${d.zone}</span><span>${d.rate}% Rate</span>
                </div>
                <div style="height: 10px; background: rgba(255,255,255,0.05); border-radius: 10px; overflow: hidden;">
                    <div style="height: 100%; width: ${d.rate}%; background: ${d.rate > 30 ? 'var(--accent)' : 'var(--primary)'};"></div>
                </div>
            </div>
        `).join('');

        // Inject Maintenance Logs
        const maintenanceLogs = defectConcentration.map(d => {
            if (d.rate > 30) {
                return `
                    <div class="p-4 glass flex justify-between items-center" style="border-radius: 12px; border-left: 4px solid var(--error);">
                        <div>
                            <div style="font-weight: 800; color: var(--error);">CRITICAL: ${d.zone} Maintenance Required</div>
                            <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">Defect rate (${d.rate}%) has exceeded the 30% threshold. Immediate inspection suggested.</p>
                        </div>
                        <button class="btn btn-outline" style="font-size: 0.7rem; padding: 0.5rem;" onclick="showToast('Work Order Generated for ${d.zone}', 'success')"><i data-lucide="bell-ring" style="width:14px"></i> Trigger Order</button>
                    </div>
                `;
            } else if (d.rate > 15) {
                return `
                    <div class="p-4 glass flex justify-between items-center" style="border-radius: 12px; border-left: 4px solid var(--warning);">
                        <div>
                            <div style="font-weight: 700; color: var(--warning);">ADVISORY: Monitor ${d.zone}</div>
                            <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">Steady increase in defects detected. Schedule routine tuning.</p>
                        </div>
                    </div>
                `;
            }
            return '';
        }).join('').trim();

        document.getElementById('content-area').innerHTML = document.getElementById('content-area').innerHTML
            .replace('[[MAINTENANCE_LOGS]]', maintenanceLogs || '<p class="text-center text-muted" style="font-size:0.8rem; padding: 1rem;">All stations performing within optimal parameters. No alerts.</p>')
            .replace('[[MANUAL_RAW]]', historicalSummary.manualEra?.avgYield || '')
            .replace('[[CONVERTED_JSON]]', '')
            .replace('[[FATIGUE_BARS]]', fatigueBars)
            .replace('[[DEFECT_HEATMAP]]', heatmap)
            .replace('[[CURRENT_YIELD]]', currentYield)
            .replace('[[CURRENT_YIELD_H]]', currentYield);

        // Day by Day Assembly Productivity
        const throughputBars = yieldData.inspected.map((val, i) => `
            <div style="flex: 1; height: ${(val / 200) * 100}%; background: var(--primary); border-radius: 4px 4px 0 0; position:relative;">
                <div style="position:absolute; top:-18px; width:100%; text-align:center; font-size:0.6rem; font-weight:800; color:var(--text-muted);">${val}u</div>
            </div>
        `).join('');
        document.getElementById('content-area').innerHTML = document.getElementById('content-area').innerHTML.replace('[[DAILY_THROUGHPUT_CHART]]', throughputBars);

        // 🏛️ LEGACY MANUAL PERFORMANCE CHART (6-MONTH ARCHIVE)
        const legacyMonths = legacyManualPerformance.months;
        const histBars = legacyMonths.map((m) => {
            const entry = legacyManualPerformance.data[m];
            const yieldPct = ((entry.totalFG / legacyManualPerformance.inventoryPlan) * 100).toFixed(1);
            const barH = Math.round(yieldPct);
            // Using Manual Red (#ef4444) for legacy records
            return `<div title="${m}: ${yieldPct}% manual conversion" style="flex:1; height:${barH}%; background:#ef4444; border-radius:4px 4px 0 0; opacity:0.85; transition: opacity 0.2s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.85"></div>`;
        }).join('');

        const histLabels = legacyMonths.map(m => `<span>${m}</span>`).join('');

        const ca = document.getElementById('content-area');
        ca.innerHTML = ca.innerHTML
            .replace('[[HIST_CHART_BARS]]', histBars)
            .replace('[[HIST_CHART_LABELS]]', histLabels);
    }

    if (templateKey === 'adminDashboard') {
        updateAdminGauges();
        updateAuditFeed();
        updateStageHeatmap('stage-yield-heat-map');

        // ✨ Simulation Control Center
        const header = document.querySelector('.admin-hero-header');
        if (header && !document.getElementById('sim-control-bar')) {
            const bar = document.createElement('div');
            bar.id = 'sim-control-bar';
            bar.style.cssText = 'display:flex; align-items:center; gap:0.6rem; margin-left:auto; flex-wrap:wrap;';
            bar.innerHTML = `
                <!-- Batch size selector -->
                <div id="sim-batch-selector" style="display:flex; align-items:center; gap:4px; background:rgba(255,255,255,0.05); border:1px solid var(--border); border-radius:8px; padding:3px 6px;">
                    <span style="font-size:0.6rem; color:var(--text-muted); font-weight:800; margin-right:4px;">BATCH</span>
                    <button data-sz="50"  onclick="selectSimBatchSize(50)"  class="sim-sz-btn" style="background:none;border:none;color:var(--text-muted);font-size:0.7rem;font-weight:800;padding:3px 9px;border-radius:5px;cursor:pointer;transition:all 0.15s;">50</button>
                    <button data-sz="100" onclick="selectSimBatchSize(100)" class="sim-sz-btn" style="background:var(--primary);border:none;color:#fff;font-size:0.7rem;font-weight:800;padding:3px 9px;border-radius:5px;cursor:pointer;transition:all 0.15s;">100</button>
                    <button data-sz="200" onclick="selectSimBatchSize(200)" class="sim-sz-btn" style="background:none;border:none;color:var(--text-muted);font-size:0.7rem;font-weight:800;padding:3px 9px;border-radius:5px;cursor:pointer;transition:all 0.15s;">200</button>
                </div>

                <!-- Start button (IDLE state) -->
                <button id="sim-trigger-btn" class="btn btn-outline" onclick="generateMockShiftData()" style="gap:6px;">
                    <i data-lucide="play-circle" style="width:15px;"></i> Simulate Shift
                </button>

                <!-- Pause / Resume (hidden until running) -->
                <button id="sim-pause-btn" class="btn btn-outline" onclick="toggleSimPause()" style="display:none; gap:6px;">
                    <i data-lucide="pause-circle" style="width:15px;"></i> Pause
                </button>

                <!-- Abort (hidden until running/paused) -->
                <button id="sim-stop-btn" class="btn btn-outline" onclick="abortSim()" style="display:none; gap:6px; border-color:var(--error); color:var(--error);">
                    <i data-lucide="stop-circle" style="width:15px;"></i> Abort
                </button>

                <!-- Queue Next Batch (hidden until paused or done) -->
                <button id="sim-next-btn" class="btn btn-outline" onclick="queueNextBatch()" style="display:none; gap:6px; border-color:var(--success); color:var(--success);">
                    <i data-lucide="skip-forward" style="width:15px;"></i> Next Batch
                </button>

                <!-- Progress label -->
                <span id="sim-progress-label" style="font-size:0.65rem; font-weight:800; color:var(--text-muted); display:none;"></span>
            `;
            header.appendChild(bar);
            lucide.createIcons();
        }
    }
    if (templateKey === 'analytics') {
        updateStageHeatmap('analytics-heatmap');
        updateAnalyticsSummary();
    }
    if (templateKey === 'operatorDashboard') {
        document.getElementById('op-stat-passed').textContent = currentUser.stats.passed;
        document.getElementById('op-stat-scrapped').textContent = currentUser.stats.scrapped;
        populateOperatorStages();
    }
    if (templateKey === 'traceability') {
        runLiveFilter();
        const searchInput = document.getElementById('search-serial');
        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') searchUnit();
            });
        }
    }
    if (templateKey === 'userManagement') populateUserList();
    if (templateKey === 'stageManagement') populateStagesTimeline();
    if (templateKey === 'executionScreen') setupExecutionScreen();
    if (templateKey === 'createStage' && editingStageId) setupCreateStageForm();
    // 📈 ANALYTICS & DASHBOARD HOOKS
    if (templateKey === 'adminDashboard') {
        updateAdminGauges();
        updateAuditFeed();
        updateStageHeatmap('stage-yield-heat-map');
    }
    if (templateKey === 'analytics') {
        updateAnalyticsSummary();
        renderExecutiveCharts(); // full render on first load (SPC + Trend + Pareto)
        // 🔄 START LIVE POLLING: only refresh SPC + KPIs every 2.5s (NOT static charts)
        if (analyticsLiveInterval) clearInterval(analyticsLiveInterval);
        analyticsLiveInterval = setInterval(() => {
            if (currentView !== 'analytics' && currentView !== 'executiveAnalytics') {
                clearInterval(analyticsLiveInterval);
                analyticsLiveInterval = null;
                return;
            }
            updateAnalyticsSummary();
            renderSPCChartOnly(); // ✅ only the live SPC chart — NOT Trend/Pareto (static)
        }, 2500);
    } else {
        // ⏹ STOP POLLING when leaving analytics
        if (analyticsLiveInterval) {
            clearInterval(analyticsLiveInterval);
            analyticsLiveInterval = null;
        }
    }

    lucide.createIcons();
}

// ── Simulation Control Helpers ───────────────────────────────────────────────

/** Highlight the selected batch-size button */
function selectSimBatchSize(sz) {
    simBatchSize = sz;
    document.querySelectorAll('.sim-sz-btn').forEach(b => {
        const active = parseInt(b.dataset.sz) === sz;
        b.style.background = active ? 'var(--primary)' : 'none';
        b.style.color = active ? '#fff' : 'var(--text-muted)';
    });
}

/**
 * Single source of truth for button visibility.
 * States:
 *   'idle'   → batch selector on, [Simulate] visible, rest hidden
 *   'running'→ [Pause] + [Abort] visible, progress showing
 *   'paused' → [Resume] + [Next Batch] + [Abort] visible, progress shows PAUSED
 *   'done'   → back to idle appearance, Simulate re-enabled
 */
function setSimControlState(state, progressText) {
    const startBtn = document.getElementById('sim-trigger-btn');
    const pauseBtn = document.getElementById('sim-pause-btn');
    const stopBtn = document.getElementById('sim-stop-btn');
    const nextBtn = document.getElementById('sim-next-btn');
    const sizeBar = document.getElementById('sim-batch-selector');
    const lbl = document.getElementById('sim-progress-label');
    if (!startBtn) return;

    // Helper: show/hide
    const show = el => { if (el) el.style.display = 'flex'; };
    const hide = el => { if (el) el.style.display = 'none'; };
    const txt = el => { if (el) el.style.display = 'block'; };

    if (state === 'idle' || state === 'done') {
        show(startBtn);
        startBtn.disabled = false;
        const total = Object.keys(units).length;
        startBtn.innerHTML = total > 0
            ? `<i data-lucide="play-circle" style="width:15px;"></i> Simulate Shift <span style="font-size:0.65rem;opacity:0.5;">(${total} processed)</span>`
            : `<i data-lucide="play-circle" style="width:15px;"></i> Simulate Shift`;
        if (sizeBar) sizeBar.style.opacity = '1';
        hide(pauseBtn);
        hide(stopBtn);
        hide(nextBtn);
        hide(lbl);
        // Reset pause button back to "Pause" for next run
        if (pauseBtn) {
            pauseBtn.innerHTML = '<i data-lucide="pause-circle" style="width:15px;"></i> Pause';
            pauseBtn.style.borderColor = '';
            pauseBtn.style.color = '';
        }
        lucide.createIcons();

    } else if (state === 'running') {
        hide(startBtn);
        if (sizeBar) sizeBar.style.opacity = '0.4';
        // Pause button: show as "Pause"
        if (pauseBtn) {
            pauseBtn.innerHTML = '<i data-lucide="pause-circle" style="width:15px;"></i> Pause';
            pauseBtn.style.borderColor = '';
            pauseBtn.style.color = '';
        }
        show(pauseBtn);
        show(stopBtn);
        hide(nextBtn);
        txt(lbl);
        if (lbl && progressText) lbl.textContent = progressText;
        lucide.createIcons();

    } else if (state === 'paused') {
        hide(startBtn);
        if (sizeBar) sizeBar.style.opacity = '0.4';
        // Pause button becomes "Resume"
        if (pauseBtn) {
            pauseBtn.innerHTML = '<i data-lucide="play-circle" style="width:15px;"></i> Resume';
            pauseBtn.style.borderColor = 'var(--success)';
            pauseBtn.style.color = 'var(--success)';
        }
        show(pauseBtn);
        show(stopBtn);
        // Reset Next Batch button
        if (nextBtn) {
            nextBtn.disabled = false;
            nextBtn.innerHTML = '<i data-lucide="skip-forward" style="width:15px;"></i> Next Batch';
        }
        show(nextBtn);
        txt(lbl);
        if (lbl) lbl.textContent = '⏸ PAUSED — ' + (progressText || '');
        lucide.createIcons();
    }
}

function toggleSimPause() {
    simPaused = !simPaused;
    if (simPaused) {
        // Get current progress from label for display
        const lbl = document.getElementById('sim-progress-label');
        const cur = lbl ? lbl.textContent.replace('⏸ PAUSED — ', '') : '';
        setSimControlState('paused', cur);
        showToast('⏸ Paused. Click Resume to continue or Next Batch to queue another.', 'warning');
    } else {
        setSimControlState('running');
        showToast('▶️ Resumed.', 'success');
    }
}

function abortSim() {
    if (!confirm('Abort this run? All units processed so far will be saved.')) return;
    simStopped = true;
    simPaused = false;  // unblock the while-loop so it can see simStopped
    setSimControlState('done'); // immediately reset to IDLE — no Resume, no Next Batch
    showToast('🛑 Run aborted. Processed units saved.', 'error');
}

function queueNextBatch() {
    simQueueNext = true;
    // Disable the Next Batch button to prevent double-clicks
    const nextBtn = document.getElementById('sim-next-btn');
    if (nextBtn) {
        nextBtn.disabled = true;
        nextBtn.innerHTML = '<i data-lucide="loader" style="width:15px;"></i> Queued…';
        lucide.createIcons();
    }
    // Auto-resume so the current batch finishes and triggers the next one
    if (simPaused) {
        simPaused = false;
        setSimControlState('running');
        showToast('⏭ Next batch queued — resuming current run…', 'info');
    } else {
        showToast('⏭ Next batch queued — will auto-start when current completes.', 'info');
    }
}

/** 🚀 INTERACTIVE FACTORY STREAM (Live Shift Simulation) */
async function generateMockShiftData(batchSz) {
    const SIZE = batchSz || simBatchSize || 100;

    // Reset control flags
    simPaused = false;
    simStopped = false;
    simQueueNext = false;

    setSimControlState('running');

    // 🆕 FRESH BATCH: Unique time-stamped prefix ensures every run produces new serial numbers
    const now = new Date();
    const batchPrefix = `${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
    const batchSerials = Array.from({ length: SIZE }, (_, i) => `B${batchPrefix}-${(i + 1).toString().padStart(3, '0')}`);

    // 🎲 RANDOMIZED SPLIT every run
    const passCount = Math.round(SIZE * (0.78 + Math.random() * 0.17));
    const scrapCount = Math.round(SIZE * (0.02 + Math.random() * 0.10));

    const stages = manufacturingStages.sort((a, b) => a.order - b.order);
    showToast(`📡 BATCH ${batchPrefix} [${SIZE} units]: ${passCount} PASS | ${scrapCount} MRB | ${SIZE - passCount - scrapCount} WIP`, 'info', 5000);

    for (const [idx, sn] of batchSerials.entries()) {
        // ⏸ PAUSE: wait here until resumed or stopped
        while (simPaused && !simStopped) {
            await new Promise(r => setTimeout(r, 200));
        }
        // 🛑 ABORT
        if (simStopped) break;

        // Update progress label
        const lbl = document.getElementById('sim-progress-label');
        if (lbl) lbl.textContent = `🔄 Unit ${idx + 1} / ${SIZE} — ${batchPrefix}`;

        let status = 'COMPLETED';
        let currOrder = stages.length;
        let failedStage = null;

        if (idx >= passCount && idx < passCount + scrapCount) {
            status = 'MRB_REVIEW';
            const failIdx = Math.max(1, Math.floor(Math.random() * stages.length));
            failedStage = stages[failIdx - 1];
            currOrder = failIdx;
        } else if (idx >= passCount + scrapCount) {
            status = 'IN_PROGRESS';
            currOrder = Math.max(1, Math.floor(Math.random() * stages.length));
        }

        const unit = {
            serial: sn,
            batchLabel: `Batch ${batchPrefix}`, // 🏷️ Tag each unit with its real batch ID
            status,
            currentStageOrder: currOrder,
            scrapStageOrder: failedStage ? failedStage.order : null,
            scrapStageName: failedStage ? failedStage.name : null,
            isRework: false,
            history: [],
            components: {}
        };

        for (let o = 1; o <= currOrder; o++) {
            const stage = stages[o - 1];
            if (!stage) continue;
            unit.history.push({
                stage: stage.name,
                status: (o === currOrder && status === 'MRB_REVIEW') ? 'UNIT_REJECTED' : 'PASS',
                operator: 'Simulation Engine',
                time: new Date().toLocaleTimeString()
            });
        }

        units[sn] = unit;

        // 💾 INCREMENTAL CHECKPOINT: save to localStorage every 10 units
        // This ensures data is safe even if the page is refreshed mid-simulation
        if ((idx + 1) % 10 === 0) {
            localStorage.setItem('units', JSON.stringify(units));
            localStorage.setItem('yieldData', JSON.stringify(yieldData));
        }

        if (yieldData.inspected.length > 0) {
            const lastIdx = yieldData.inspected.length - 1;
            yieldData.inspected[lastIdx]++;
            if (status === 'COMPLETED') yieldData.passed[lastIdx]++;
            if (status === 'MRB_REVIEW') yieldData.scrapped[lastIdx]++;
        }

        globalAuditLog.push({
            event: status === 'MRB_REVIEW' ? 'UNIT_SCRAP' : 'UNIT_PASS',
            details: `S/N ${sn} — ${status === 'MRB_REVIEW' ? 'REJECTED at ' + failedStage?.name : status}.`,
            time: new Date().toLocaleString(),
            op: 'Simulation Engine'
        });

        // 🔄 Live UI updates — Control Panel
        updateAdminGauges();
        updateAuditFeed();
        updateStageHeatmap('stage-yield-heat-map');

        // 📊 Live Analytics sync — if user is on analytics page, update KPIs in real-time
        if (currentView === 'analytics' || currentView === 'executiveAnalytics') {
            updateAnalyticsSummary();
        }

        await new Promise(r => setTimeout(r, 350));

        // simulation continues running even when navigating away — no DOM check needed
    }

    // Final Save
    persistUnits();
    persistYieldData();
    persistAudit();

    if (simStopped) {
        showToast(`🛑 Aborted at unit ${Object.keys(units).length}. Data saved.`, 'warning');
    } else {
        showToast(`✅ BATCH ${batchPrefix} COMPLETE — ${SIZE} units processed.`, 'success');
    }

    setSimControlState('done');

    // 📊 Only refresh SPC chart after batch completes (not Trend/Pareto — they're static)
    if (currentView === 'analytics' || currentView === 'executiveAnalytics') {
        setTimeout(() => {
            updateAnalyticsSummary();
            renderSPCChartOnly(); // ✅ live chart only
        }, 300);
    }

    // Auto-start next batch if queued
    if (simQueueNext && !simStopped) {
        simQueueNext = false;
        showToast(`⏭ Starting next batch of ${SIZE} units...`, 'info', 2000);
        setTimeout(() => generateMockShiftData(SIZE), 1500);
    }
}

/** 📊 DASHBOARD LIVE GAUGE LOGIC 🛰️ */
function updateAdminGauges() {
    const allUnits = Object.values(units);
    const shiftPass = allUnits.filter(u => u.status === 'COMPLETED').length;
    const mrbCount = allUnits.filter(u => u.status === 'MRB_REVIEW').length;
    // ✅ FIX: scrap status is "SCRAP" (not "UNIT_REJECTED")
    const scrapCount = allUnits.filter(u => u.status === 'SCRAP').length;
    // ✅ FIX: rework units go back to "IN_PROGRESS" with isRework=true (no "REWORK" status exists)
    const reworkCount = allUnits.filter(u => u.isRework === true && u.status !== 'COMPLETED').length;
    // ✅ FIX: WIP = IN_PROGRESS but NOT rework (to avoid double-counting)
    const wipCount = allUnits.filter(u => u.status === 'IN_PROGRESS' && !u.isRework).length;
    const totalProcessed = allUnits.length;


    // ✅ FPY: passed / totalProcessed (cumulative, all batches)
    const fpy = totalProcessed > 0 ? ((shiftPass / totalProcessed) * 100).toFixed(1) : "0";
    const fpyEl = document.getElementById('live-fpy-val');
    if (fpyEl) fpyEl.textContent = `${fpy}%`;

    const circle = document.getElementById('fpy-gauge-circle');
    if (circle) {
        // SVG circle circumference is exactly 282.7 (2 * PI * 45)
        const offset = 282.7 - (282.7 * (parseFloat(fpy) / 100));
        circle.style.strokeDashoffset = offset;
    }

    // ✅ Shift Progress: X passed / Y total (cumulative across all simulation runs)
    const passPercent = totalProcessed > 0 ? parseFloat(fpy) : 0;
    const passEl = document.getElementById('total-shift-pass');
    if (passEl) passEl.textContent = shiftPass;

    const totalEl = document.getElementById('total-shift-processed');
    if (totalEl) totalEl.textContent = totalProcessed;

    const percLabel = document.getElementById('shift-perc-label');
    if (percLabel) percLabel.textContent = `${passPercent.toFixed(1)}% PASS RATE`;

    const fill = document.getElementById('shift-progress-fill');
    if (fill) fill.style.width = `${Math.min(passPercent, 100)}%`;

    // MRB Inbox counter (hero number)
    const mrbInboxEl = document.getElementById('total-mrb-count');
    if (mrbInboxEl) mrbInboxEl.textContent = mrbCount;

    // ✅ Quality Inbox breakdown — all unit statuses
    const wipEl = document.getElementById('inbox-wip-count');
    const scrapEl = document.getElementById('inbox-scrap-count');
    const reworkEl = document.getElementById('inbox-rework-count');
    const passedEl = document.getElementById('inbox-passed-count');
    if (wipEl) wipEl.textContent = wipCount;
    if (scrapEl) scrapEl.textContent = scrapCount;
    if (reworkEl) reworkEl.textContent = reworkCount;
    if (passedEl) passedEl.textContent = shiftPass;

    // ✅ FPY card supplementary stats
    const fpyPassedEl = document.getElementById('fpy-passed-count');
    const fpyFailedEl = document.getElementById('fpy-failed-count');
    const fpyTotalEl = document.getElementById('fpy-total-count');
    if (fpyPassedEl) fpyPassedEl.textContent = shiftPass;
    if (fpyFailedEl) fpyFailedEl.textContent = mrbCount + scrapCount + reworkCount;
    if (fpyTotalEl) fpyTotalEl.textContent = totalProcessed;

    // ✅ Shift card mini-breakdown
    const miniPassEl = document.getElementById('shift-mini-pass');
    const miniWipEl = document.getElementById('shift-mini-wip');
    const miniMrbEl = document.getElementById('shift-mini-mrb');
    if (miniPassEl) miniPassEl.textContent = shiftPass;
    if (miniWipEl) miniWipEl.textContent = wipCount;
    if (miniMrbEl) miniMrbEl.textContent = mrbCount + scrapCount;

    updateQuickMRBList();
    updateShiftSummaryCard();
}

/** 🗑️ MANUAL DATA PURGE: Wipes current session from local + cloud */
async function clearCurrentShiftData() {
    if (!confirm("⚠️ WARNING: This will PERMANENTLY WIPE all production units, yield data, and audit logs from both your browser and the FIREBASE CLOUD. This cannot be undone. \n\nAre you absolutely sure?")) return;

    // 1. Wipe Memory
    units = {};
    yieldData = {
        labels: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
        inspected: [0, 0, 0, 0, 0, 0, 0],
        passed: [0, 0, 0, 0, 0, 0, 0],
        scrapped: [0, 0, 0, 0, 0, 0, 0]
    };
    globalAuditLog = [];

    // 2. Wipe Local Storage
    localStorage.removeItem('units');
    localStorage.removeItem('productionUnits');
    localStorage.removeItem('yieldData');
    localStorage.removeItem('globalAuditLog');

    // 3. Wipe Cloud
    if (cloudActive) {
        showToast("🧼 Purging Cloud Data...", "info", 1500);
        await persistUnits();
        await persistYieldData();
        await persistAudit();
    }

    // 4. Force Reload to start fresh
    showToast("✨ System Cleaned. Rebooting...", "success", 2000);
    setTimeout(() => {
        location.reload();
    }, 1500);
}

function updateShiftSummaryCard() {
    const allUnits = Object.values(units);
    if (allUnits.length === 0) return;

    const total = allUnits.length;
    const passed = allUnits.filter(u => u.status === 'COMPLETED').length;
    const mrb = allUnits.filter(u => u.status === 'MRB_REVIEW').length;
    const fpy = ((passed / total) * 100).toFixed(1);

    // ── Count unique batches (B{HHMMSS} prefix) ─────────────────────────
    const batchKeys = new Set();
    allUnits.forEach(u => { const m = u.serial.match(/^(B\d{6})/); if (m) batchKeys.add(m[1]); });

    // ── Shift start: read from earliest batch key's stored history time ─
    const sortedBatches = [...batchKeys].sort(); // BHHMMSS sort = chronological
    const firstBatch = sortedBatches[0];
    let startTimeStr = 'No data';
    let durationStr = '--';
    let durationMs = 0;

    if (firstBatch) {
        const firstUnit = allUnits.find(u => u.serial.startsWith(firstBatch));
        startTimeStr = firstUnit?.history?.[0]?.time || '--';

        const h = parseInt(firstBatch.slice(1, 3));
        const mi = parseInt(firstBatch.slice(3, 5));
        const s = parseInt(firstBatch.slice(5, 7));
        const now = new Date();
        const startMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, mi, s).getTime();
        durationMs = now.getTime() - startMs;
        if (durationMs >= 0) {
            const mm = Math.floor(durationMs / 60000);
            const ss = Math.floor((durationMs % 60000) / 1000);
            durationStr = mm > 0 ? `${mm}m ${ss}s` : `${ss}s`;
        }
    }

    // ── Throughput rate (units per hour) ─────────────────────────────────
    let rateStr = '-- u/hr';
    if (durationMs > 0 && total > 0) {
        const hrs = durationMs / 3600000;
        rateStr = `${Math.round(total / hrs)} u/hr`;
    }

    // ── Update DOM ───────────────────────────────────────────────────────
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('shift-started-val', startTimeStr);
    set('shift-duration-val', durationStr);
    set('shift-batches-val', batchKeys.size > 0 ? `${batchKeys.size} batch${batchKeys.size > 1 ? 'es' : ''}` : '--');
    set('shift-units-val', total);
    set('shift-fpy-card-val', fpy + '%');
    set('shift-mrb-card-val', mrb > 0 ? mrb + ' units' : '✅ Clear');

    // ── Populate unique fields in top 3 cards ────────────────────────────
    // FPY card: gap to target
    const gap = (98.5 - parseFloat(fpy)).toFixed(1);
    const gapEl = document.getElementById('fpy-gap-val');
    if (gapEl) {
        gapEl.textContent = parseFloat(gap) <= 0 ? '✅ On Target' : `-${gap}%`;
        gapEl.style.color = parseFloat(gap) <= 0 ? 'var(--success)' : parseFloat(gap) < 5 ? 'var(--warning)' : 'var(--error)';
    }
    // Shift card: duration, batches, rate
    set('shift-duration-inline', durationStr);
    set('shift-batches-inline', batchKeys.size > 0 ? `${batchKeys.size}` : '--');
    set('shift-rate-inline', rateStr);

    // Colour-code FPY sidebar card
    const fpyEl = document.getElementById('shift-fpy-card-val');
    if (fpyEl) fpyEl.style.color = parseFloat(fpy) >= 98.5 ? 'var(--success)' : parseFloat(fpy) >= 92 ? 'var(--warning)' : 'var(--error)';

    // Colour-code MRB sidebar card
    const mrbEl = document.getElementById('shift-mrb-card-val');
    if (mrbEl) mrbEl.style.color = mrb === 0 ? 'var(--success)' : mrb < 5 ? 'var(--warning)' : 'var(--error)';
}


function updateQuickMRBList() {
    const listEl = document.getElementById('quick-mrb-list');
    if (!listEl) return;

    const mrbUnits = Object.values(units)
        .filter(u => u.status === 'MRB_REVIEW')
        .sort((a, b) => {
            // Newest first
            const timeA = a.history[a.history.length - 1]?.time || '';
            const timeB = b.history[b.history.length - 1]?.time || '';
            return timeB.localeCompare(timeA);
        })
        .slice(0, 5); // Just top 5

    if (mrbUnits.length === 0) {
        listEl.innerHTML = `<div class="text-muted" style="font-size:0.65rem; text-align:center; padding:1rem 0;">No units awaiting decision.</div>`;
        return;
    }

    listEl.innerHTML = mrbUnits.map(u => `
        <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:8px; padding:0.6rem; display:flex; justify-content:space-between; align-items:center;">
            <div>
                <div style="font-size:0.75rem; font-weight:800; color:var(--text-main);">${u.serial}</div>
                <div style="font-size:0.55rem; color:var(--text-muted); font-weight:600; text-transform:uppercase; margin-top:2px;">
                    ${u.history[u.history.length - 1]?.stage || 'Unknown Stage'}
                </div>
            </div>
            <button class="btn btn-outline" style="font-size:0.55rem; padding:4px 10px; border-color:var(--error); color:var(--error);"
                onclick="renderHeritageView(units['${u.serial}'])">
                Review
            </button>
        </div>
    `).join('');
}

function updateStageHeatmap(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const allUnits = Object.values(units);
    container.innerHTML = manufacturingStages.sort((a, b) => a.order - b.order).map(s => {
        const stageEvents = [];
        allUnits.forEach(u => u.history.forEach(h => {
            if (h.stage === s.name) stageEvents.push(h);
        }));

        const passes = stageEvents.filter(e => e.status === 'PASS').length;
        const fails = stageEvents.filter(e => e.status === 'UNIT_REJECTED').length;
        const total = passes + fails;
        const yieldVal = total > 0 ? ((passes / total) * 100).toFixed(1) : "100.0";
        const color = yieldVal > 95 ? 'var(--success)' : (yieldVal > 90 ? 'var(--warning)' : 'var(--error)');

        return `
            <div class="flex flex-col gap-1">
                <div class="flex justify-between" style="font-size: 0.65rem; font-weight: 800;">
                    <span>${s.name}</span>
                    <span style="color: ${color}">${yieldVal}%</span>
                </div>
                <div style="height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden;">
                    <div style="width: ${yieldVal}%; height: 100%; background: ${color}; border-radius: 3px; filter: drop-shadow(0 0 2px ${color});"></div>
                </div>
            </div>
        `;
    }).join('');
}

function updateAnalyticsSummary() {
    const allUnits = Object.values(units);
    const total = allUnits.length;
    const passed = allUnits.filter(u => u.status === 'COMPLETED').length;
    const mrbCount = allUnits.filter(u => u.status === 'MRB_REVIEW').length;
    const scrapCount = allUnits.filter(u => u.status === 'SCRAP').length;

    // ── KPI 1: Live System FPY ─────────────────────────────────────────────
    // Formula: (COMPLETED / total processed) × 100
    // This is the true First-Pass Yield — units that cleared ALL stages first time.
    const fpyNum = total > 0 ? (passed / total) * 100 : 0;
    const fpyStr = total > 0 ? fpyNum.toFixed(1) + '%' : 'No Data';
    const fpyEl = document.getElementById('kpi-fpy-val');
    const fpySubEl = document.getElementById('kpi-fpy-sub');
    if (fpyEl) fpyEl.textContent = fpyStr;
    if (fpyEl) fpyEl.style.color = fpyNum >= 98.5 ? 'var(--success)' : fpyNum >= 92 ? 'var(--warning)' : 'var(--error)';
    if (fpySubEl) fpySubEl.textContent = fpyNum >= 98.5 ? 'TARGET: 98.5% ✅ ACHIEVED' : `TARGET: 98.5% — ${(98.5 - fpyNum).toFixed(1)}% SHORT`;

    // ── KPI 2: Digital vs Legacy Gap ──────────────────────────────────────
    // Formula: Live FPY% − 87.1% (historical legacy 6-month average)
    // Tells management how much better the digital system performs vs manual era.
    const legacyAvg = 87.1;
    const gap = total > 0 ? (fpyNum - legacyAvg).toFixed(1) : null;
    const gapEl = document.getElementById('kpi-gap-val');
    if (gapEl) gapEl.textContent = gap !== null ? (gap >= 0 ? `+${gap}%` : `${gap}%`) : 'No Data';
    if (gapEl) gapEl.style.color = gap > 0 ? 'var(--success)' : 'var(--error)';

    // ── KPI 3: MRB Pending Queue ──────────────────────────────────────────
    // Formula: Count of units in MRB_REVIEW status — units rejected at a stage
    //          but not yet given a final REWORK or SCRAP decision.
    // Management action: if this number is high, MRB decisions are backlogged.
    const mrbEl = document.getElementById('kpi-mrb-val');
    const mrbSubEl = document.getElementById('kpi-mrb-sub');
    if (mrbEl) mrbEl.textContent = total > 0 ? `${mrbCount} units` : 'No Data';
    if (mrbEl) mrbEl.style.color = mrbCount === 0 ? 'var(--success)' : mrbCount < 5 ? 'var(--warning)' : 'var(--error)';
    if (mrbSubEl) mrbSubEl.textContent = mrbCount === 0 ? '✅ QUEUE CLEAR' : `${mrbCount} AWAITING DECISION`;

    // ── KPI 4: Live Scrap Rate ────────────────────────────────────────────
    // Formula: (MRB_REVIEW + final SCRAP) / total × 100
    // Compared against 12.9% — the average baseline scrap rate over 6 months.
    // A lower % = fewer units wasted = money saved.
    const legacyScrapRate = 12.9;
    const liveScrapRate = total > 0 ? ((mrbCount + scrapCount) / total) * 100 : null;
    const scrapEl = document.getElementById('kpi-scrap-val');
    const scrapSubEl = document.getElementById('kpi-scrap-sub');
    if (scrapEl) scrapEl.textContent = liveScrapRate !== null ? liveScrapRate.toFixed(1) + '%' : 'No Data';
    if (scrapEl) scrapEl.style.color = liveScrapRate !== null && liveScrapRate < legacyScrapRate ? 'var(--success)' : 'var(--error)';
    if (scrapSubEl) {
        const improvement = liveScrapRate !== null ? (legacyScrapRate - liveScrapRate).toFixed(1) : null;
        scrapSubEl.textContent = improvement !== null
            ? (improvement >= 0 ? `↓ ${improvement}% BETTER THAN BASELINE` : `↑ ${Math.abs(improvement)}% WORSE THAN BASELINE`)
            : 'BASELINE BENCHMARK: 12.9%';
    }
}

// 👩‍🏭 Operator Workflow
function populateOperatorStages() {
    const grid = document.getElementById('stage-selector-grid');
    grid.innerHTML = manufacturingStages.sort((a, b) => a.order - b.order).map(s => `
        <div class="card action-card" onclick="openStageGate('${s.id}')">
            <div class="flex justify-between">
                <div class="action-card-icon" style="background: rgba(59, 130, 246, 0.1); color: var(--primary);">
                    <i data-lucide="layers" style="width: 18px;"></i>
                </div>
            </div>
            <div style="margin-top: 1rem;">
                <h4 style="font-weight: 800;">${s.name}</h4>
                <p class="text-muted" style="font-size: 0.75rem;">Sequence Order: #${s.order}</p>
            </div>
        </div>
    `).join('');
    lucide.createIcons();
}

function openStageGate(stageId) {
    activeExecutionStage = manufacturingStages.find(s => s.id === stageId);
    document.getElementById('gate-stage-name').textContent = activeExecutionStage.name;
    document.getElementById('execution-gate-area').classList.remove('hidden');
    document.getElementById('unit-scan-input').focus();
    lucide.createIcons();
}

function closeGate() {
    document.getElementById('execution-gate-area').classList.add('hidden');
    activeExecutionStage = null;
}

function validateUnitGate() {
    const sn = document.getElementById('unit-scan-input').value.toUpperCase();
    const msgArea = document.getElementById('gate-msg');
    if (!sn) return;

    let unit = units[sn];

    const showError = (msg, icon = 'lock') => {
        msgArea.innerHTML = `<i data-lucide="${icon}"></i> ${msg}`;
        msgArea.style.background = 'rgba(239, 68, 68, 0.1)';
        msgArea.style.color = 'var(--error)';
        msgArea.style.border = '1px solid var(--error)';
        msgArea.classList.remove('hidden');
        lucide.createIcons();
    };

    // Create new unit if not exists and it's stage 1
    if (!unit) {
        if (activeExecutionStage.order === 1) {
            unit = { serial: sn, status: "IN_PROGRESS", currentStageOrder: 1, history: [], components: {} };
            units[sn] = unit;

            // 📈 Track new unit entry in daily analytics
            yieldData.inspected[yieldData.inspected.length - 1]++;
            persistYieldData();
            persistUnits();
        } else {
            showError("UNIT NOT FOUND: New units must start at Stage 1.", "alert-octagon");
            return;
        }
    }

    // ♻️ PRIORITY CHECK: Smart Rework Auto-Routing
    // This check runs FIRST — before any sequential order validation.
    // A rework unit can be scanned at ANY stage gate and will auto-route to the correct stage.
    if (unit && unit.isRework) {
        const targetStage = manufacturingStages.find(s => s.order === unit.currentStageOrder);

        if (!targetStage) {
            showError(`REWORK ERROR: Could not find target stage for unit ${sn}.`, "alert-octagon");
            return;
        }

        // Override the active stage to the rework target stage
        activeExecutionStage = targetStage;
        activeExecutionUnit = unit;

        // Show prominent amber routing banner
        msgArea.innerHTML = `
            <div>
                <div style="font-size:1rem; font-weight:900; margin-bottom:6px;">
                    <i data-lucide="refresh-cw" style="width:18px; vertical-align:middle;"></i>
                    ♻️ REWORK UNIT DETECTED
                </div>
                <div style="font-size:0.8rem;">Auto-routing to <strong>${targetStage.name}</strong> — the stage where this unit requires rework.</div>
            </div>`;
        msgArea.style.background = 'rgba(245, 158, 11, 0.12)';
        msgArea.style.color = 'var(--warning)';
        msgArea.style.border = '2px solid var(--warning)';
        msgArea.classList.remove('hidden');
        lucide.createIcons();

        showToast(`🔁 Rework Unit → Auto-routing to: ${targetStage.name}`, "warning");

        setTimeout(() => {
            unit.isRework = false;
            render('executionScreen', `Rework: ${targetStage.name}`, targetStage.name);
        }, 3000);
        return;
    }

    // Pass-to-Proceed Check (Target Discovery)
    if (unit.currentStageOrder < activeExecutionStage.order) {
        const nextReqStage = manufacturingStages.find(s => s.order === unit.currentStageOrder);
        msgArea.innerHTML = `
            <div class="flex flex-col gap-2 items-center">
                <div style="font-weight:900; color:var(--error); text-transform:uppercase;">🚨 SEQUENCE LOCKED: WRONG STATION</div>
                <div style="font-size:0.85rem; margin-bottom:0.5rem; text-align:center;">
                    Unit ${sn} must first complete: <strong style="color:var(--primary); font-size:1rem;">${nextReqStage ? nextReqStage.name : 'Unknown Stage'}</strong>
                </div>
                <div class="flex gap-2">
                    <button class="btn btn-outline" style="padding:0.5rem 1.5rem; font-size:0.75rem; border-color:var(--warning); color:var(--warning);" onclick="triggerOverride()">
                        <i data-lucide="shield-alert" style="width:14px"></i> Supervisor Override
                    </button>
                    <button class="btn btn-outline" style="padding:0.5rem 1.5rem; font-size:0.75rem;" onclick="document.getElementById('gate-msg').classList.add('hidden')">
                        Close
                    </button>
                </div>
            </div>`;
        msgArea.style.background = 'rgba(239, 68, 68, 0.1)';
        msgArea.style.color = 'var(--error)';
        msgArea.style.border = '1px solid var(--error)';
        msgArea.classList.remove('hidden');
        lucide.createIcons();
        return;
    }

    if (unit.currentStageOrder > activeExecutionStage.order) {
        const currentLoc = manufacturingStages.find(s => s.order === unit.currentStageOrder);

        msgArea.innerHTML = `
            <div class="flex flex-col gap-2 items-center">
                <div style="font-weight:900; color:var(--success);"><i data-lucide="check-circle" style="width:16px;vertical-align:middle;"></i> ALREADY PROCESSED</div>
                <div style="font-size:0.85rem; margin-bottom:0.5rem; text-align:center;">
                    Unit ${sn} has already passed this stage. Current Location: <strong style="color:var(--primary); font-size:1rem;">${currentLoc ? currentLoc.name : 'Unknown Station'}</strong>
                </div>
                <button class="btn btn-outline" style="padding:0.5rem 1.5rem; font-size:0.75rem;" onclick="document.getElementById('gate-msg').classList.add('hidden')">OK, Understood</button>
            </div>`;
        msgArea.style.background = 'rgba(16, 185, 129, 0.1)';
        msgArea.style.color = 'var(--success)';
        msgArea.style.border = '1px solid var(--success)';
        msgArea.classList.remove('hidden');
        lucide.createIcons();
        return;
    }

    if (unit.status === 'MRB_REVIEW') {
        showError(`PENDING REVIEW: Unit ${sn} is currently at the MRB Board for Admin decision.`, "shield-alert");
        return;
    }

    if (unit.status === 'SCRAP') {
        showError(`UNIT SCRAPPED: Serial ${sn} is flagged for dismantling.`, "trash-2");
        return;
    }

    // Success - Auth Unit (Standard)
    activeExecutionUnit = unit;
    msgArea.innerHTML = `<i data-lucide="unlock"></i> UNIT AUTHORIZED - ACCESS GRANTED`;
    msgArea.style.background = 'rgba(16, 185, 129, 0.1)';
    msgArea.style.color = 'var(--success)';
    msgArea.style.border = '1px solid var(--success)';
    msgArea.classList.remove('hidden');
    lucide.createIcons();

    setTimeout(() => {
        render('executionScreen', 'Inspection Gate', activeExecutionStage.name);
    }, 2000); // ⏳ Increased from 800ms
}

function jumpToCorrectStage(order, sn) {
    const targetStage = manufacturingStages.find(s => s.order === order);
    if (!targetStage) return;

    // Switch context
    activeExecutionStage = targetStage;

    // 1. Return to the stage selector logic
    showToast(`Routing to correct station: ${targetStage.name}`, "info");

    // 2. We essentially "click" that stage in the background
    // and re-open the gate section
    render('operatorDashboard', 'Execution Gate', 'Station');
    setupExecutionGate(targetStage.id);

    // 3. Pre-fill the serial number again for the operator so they just click "Authorize"
    setTimeout(() => {
        const input = document.getElementById('unit-scan-input');
        if (input) {
            input.value = sn;
            // Optionally auto-validate? Better to let them click
        }
    }, 500);
}

function setupExecutionGate(stageId) {
    const stage = manufacturingStages.find(s => s.id === stageId);
    activeExecutionStage = stage;
    activeExecutionUnit = null; // Clear any previous unit context

    document.getElementById('execution-gate-area').classList.remove('hidden');
    document.getElementById('gate-stage-name').textContent = stage.name;
    document.getElementById('unit-scan-input').value = '';
    document.getElementById('unit-scan-input').focus();
    document.getElementById('gate-msg').classList.add('hidden');

    // Scroll smoothly to the gate area
    document.getElementById('execution-gate-area').scrollIntoView({ behavior: 'smooth' });
}

function triggerOverride() {
    const code = prompt("🚨 SUPERVISOR AUTHORIZATION REQUIRED\nEnter override code to bypass sequential gate:");
    if (code === 'SUP-1234') {
        gateOverrideActive = true;
        activeExecutionUnit = units[document.getElementById('unit-scan-input').value.toUpperCase()];
        persistUnits();
        showToast("🛡️ OVERRIDE AUTHORIZED: Sequential gate bypassed. Event logged.", "warning");
        render('executionScreen', 'Inspection Gate (BYPASS)', activeExecutionStage.name);
    } else {
        showToast("INVALID CODE: Access Denied.", "error");
    }
}

function setupExecutionScreen() {
    document.getElementById('exec-stage-title').textContent = activeExecutionStage.name;
    document.getElementById('exec-unit-sn').textContent = "#" + activeExecutionUnit.serial;
    activeCheckpointPhotos = {}; // Reset at stage entry

    // Check if any checkpoint requires a photo
    const needsPhoto = activeExecutionStage.checkpoints.some(cp => cp.photo);
    const cameraSection = document.getElementById('camera-section');
    if (needsPhoto) {
        cameraSection.classList.remove('hidden');
        startWebcam();
    } else {
        cameraSection.classList.add('hidden');
        stopWebcam();
    }

    const list = document.getElementById('checkpoint-execution-list');
    list.innerHTML = activeExecutionStage.checkpoints.map((cp, i) => `
        <div class="checklist-item animate-up" style="animation-delay: ${i * 0.1}s">
            <div class="flex justify-between items-start">
                <div style="flex: 1;">
                    <h4 style="font-weight: 800; margin-bottom: 0.5rem;">${i + 1}. ${cp.desc}</h4>
                    ${cp.photo ? '<p style="color:var(--primary); font-size:0.7rem; font-weight:700;"><i data-lucide="camera" style="width:10px; margin-right:4px;"></i> MANDATORY PHOTO CAPTURE</p>' : ''}
                </div>
                <div class="checkpoint-actions">
                    <button class="action-chip yes" onclick="toggleExec(this, 'pass')">PASS</button>
                    <button class="action-chip no" onclick="toggleExec(this, 'fail')">FAIL</button>
                </div>
            </div>

            <!-- 📸 Checkpoint Specific Photo Handler -->
            ${cp.photo ? `
                <div class="photo-capture-slot card glass" style="margin-top: 1rem; border: 1px dashed var(--border); background:rgba(255,255,255,0.01);">
                    <div class="flex items-center gap-4">
                        <div id="shot-preview-${i}" class="photo-preview-box" style="width: 120px; height: 80px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 0.5rem; color: var(--text-muted);">
                             No Snapshot
                        </div>
                        <div class="flex flex-col gap-2" style="flex: 1;">
                            <div class="flex gap-2">
                                <button class="btn btn-primary" style="font-size: 0.7rem; padding: 0.4rem 0.8rem;" onclick="takeSnapshot(${i})">
                                    <i data-lucide="camera" style="width: 14px;"></i> Capture for Step ${i + 1}
                                </button>
                                <button class="btn btn-outline" style="font-size: 0.65rem; padding: 0.4rem 0.8rem; border-style: dashed;" onclick="overridePhoto(${i})">
                                    <i data-lucide="shield-alert" style="width: 14px;"></i> Supervisor Override
                                </button>
                            </div>
                            <div id="status-tag-${i}" class="text-muted" style="font-size: 0.6rem; font-weight: 700;">Awaiting Vision Capture...</div>
                        </div>
                    </div>
                </div>
            ` : ''}
        </div>
    `).join('');
    lucide.createIcons();
}

let webcamStream = null;
let capturedPhoto = null;
let photoOverridden = false;

async function startWebcam() {
    try {
        webcamStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const video = document.getElementById('webcam-preview');
        if (video) video.srcObject = webcamStream;
    } catch (err) {
        console.error("Camera access denied", err);
        document.getElementById('upload-status').textContent = "⚠️ Camera blocked. Please allow permissions.";
    }
}

function stopWebcam() {
    if (webcamStream) {
        webcamStream.getTracks().forEach(track => track.stop());
        webcamStream = null;
    }
}

function takeSnapshot(index) {
    const video = document.getElementById('webcam-preview');
    const canvas = document.getElementById('photo-canvas');
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const photoData = canvas.toDataURL('image/webp');

    activeCheckpointPhotos[index] = { data: photoData, type: 'IMAGE' };

    // Update local UI for that checkpoint
    const preview = document.getElementById(`shot-preview-${index}`);
    const tag = document.getElementById(`status-tag-${index}`);
    preview.innerHTML = `<img src="${photoData}" style="width:100%; height:100%; object-fit:cover; border-radius:6px;">`;
    tag.innerHTML = `<span style="color:var(--success);"><i data-lucide="check" style="width:12px"></i> PHOTO CAPTURED FOR STEP ${index + 1}</span>`;
    lucide.createIcons();

    // Flash feedback
    const feedback = document.getElementById('capture-feedback');
    feedback.classList.remove('hidden');
    setTimeout(() => feedback.classList.add('hidden'), 500);
}

function overridePhoto(index) {
    activeCheckpointPhotos[index] = { data: null, type: 'OVERRIDE' };

    // Update local UI for that checkpoint
    const preview = document.getElementById(`shot-preview-${index}`);
    const tag = document.getElementById(`status-tag-${index}`);
    preview.innerHTML = `<div style="background:var(--error); opacity:0.1; width:100%; height:100%; display:flex; align-items:center; justify-content:center;"><i data-lucide="shield-alert" style="width:24px; color:var(--error);"></i></div>`;
    tag.innerHTML = `<span style="color:var(--warning); font-weight:800;"><i data-lucide="shield-alert" style="width:12px"></i> VISION BYPASSED</span>`;
    lucide.createIcons();
    showToast(`Step ${index + 1} Vision Override Logged.`, "warning");
}

function toggleExec(btn, res) {
    btn.parentElement.querySelectorAll('.action-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
}

let sessionComponents = {};
function addNestedComp() {
    const name = document.getElementById('nested-comp-name').value;
    const sn = document.getElementById('nested-comp-sn').value;
    if (!name || !sn) return;
    sessionComponents[name] = {
        sn: sn,
        stage: activeExecutionStage.name,
        time: new Date().toLocaleString()
    };
    document.getElementById('paired-components-list').innerHTML += `<span class="badge badge-success">${name}: ${sn}</span>`;
    document.getElementById('nested-comp-name').value = '';
    document.getElementById('nested-comp-sn').value = '';
}

function finalizeStage() {
    // Audit check: all must be passed
    const items = document.querySelectorAll('.checklist-item');
    const allPassed = Array.from(items).every(item => item.querySelector('.action-chip.yes.active'));

    if (!allPassed) {
        showToast("All checkpoints must be PASSED to proceed.", "warning");
        return;
    }

    // Mandatory Photo Check (Checkpoint Specific)
    const mandatoryCount = activeExecutionStage.checkpoints.filter(cp => cp.photo).length;
    const capturedCount = Object.keys(activeCheckpointPhotos).length;

    if (capturedCount < mandatoryCount) {
        showToast(`Missing Vision Capture for ${mandatoryCount - capturedCount} required step(s).`, "warning");
        return;
    }

    // Update Digital Traveler
    activeExecutionUnit.currentStageOrder++;
    activeExecutionUnit.history.push({
        stage: activeExecutionStage.name,
        status: "PASS",
        operator: currentUser.name,
        time: new Date().toLocaleString(),
        photos: { ...activeCheckpointPhotos }
    });

    // Merge Nested Components
    activeExecutionUnit.components = { ...activeExecutionUnit.components, ...sessionComponents };
    if (capturedPhoto) {
        if (!activeExecutionUnit.photos) activeExecutionUnit.photos = [];
        activeExecutionUnit.photos.push(capturedPhoto);
    }

    // Update Stats & Audit
    pushAudit("STAGE_PASS", `Unit ${activeExecutionUnit.serial} passed ${activeExecutionStage.name}`);

    if (activeExecutionStage.order === manufacturingStages.length) {
        activeExecutionUnit.status = "COMPLETED";

        // 🏆 Final Unit Pass - Increment daily stats only on full completion
        currentUser.stats.passed++;
        yieldData.passed[yieldData.passed.length - 1]++;
        persistUsers();
        persistYieldData();
    }
    persistUnits();

    showToast(`Stage ${activeExecutionStage.name} PASSED.`, "success");
    stopWebcam();
    capturedPhoto = null;
    photoOverridden = false;
    sessionComponents = {};
    showDashboard();
}

function scrapUnitAction() {
    if (confirm("🚨 SEND TO REVIEW: Are you sure? This unit will be sent to the Admin Ledger for a final Rework/Scrap decision.")) {
        activeExecutionUnit.status = "MRB_REVIEW";
        activeExecutionUnit.scrapStageOrder = activeExecutionStage.order;
        activeExecutionUnit.scrapStageName = activeExecutionStage.name;
        activeExecutionUnit.history.push({
            stage: activeExecutionStage.name,
            status: "UNIT_REJECTED",
            operator: currentUser.name,
            time: new Date().toLocaleString(),
            note: "Sent to MRB Review"
        });

        // Update Stats
        currentUser.stats.scrapped++;
        persistUsers();
        pushAudit("UNIT_REJECTED", `Unit ${activeExecutionUnit.serial} rejected at ${activeExecutionStage.name}. Pending Admin Review.`);

        // Update Analytics Stats (mock increment)
        yieldData.scrapped[yieldData.scrapped.length - 1]++;
        persistYieldData();
        persistUnits();

        showToast("Unit moved to MRB Review Ledger.", "warning");
        showDashboard();
    }
}

// 👑 MRB Management Functions (Admin Only)
function authorizeRework(sn) {
    const unit = units[sn];
    if (!unit) return;

    unit.status = "IN_PROGRESS";
    unit.isRework = true;
    unit.currentStageOrder = unit.scrapStageOrder || 1; // Return to same stage
    unit.history.push({
        stage: "ADMIN_MRB",
        status: "REWORK_AUTHORIZED",
        operator: currentUser.name,
        time: new Date().toLocaleString(),
        note: "Admin authorized unit to return to production."
    });

    persistUnits();
    pushAudit("MRB_REWORK", `Unit ${sn} authorized for rework by ${currentUser.name}`);
    showToast(`Unit ${sn} authorized for Rework. Operator can now scan it.`, "success");
    updateAdminGauges(); // 🔄 Refresh inbox card immediately
    runLiveFilter();
}

function confirmFinalScrap(sn) {
    const unit = units[sn];
    if (!unit) return;

    unit.status = "SCRAP";
    unit.history.push({
        stage: "ADMIN_MRB",
        status: "FINAL_SCRAP_CONFIRMED",
        operator: currentUser.name,
        time: new Date().toLocaleString(),
        note: "Admin confirmed unit as final scrap/waste."
    });

    persistUnits();
    pushAudit("MRB_FINAL_SCRAP", `Unit ${sn} permanently scrapped by ${currentUser.name}`);
    showToast(`Unit ${sn} permanently removed from production.`, "error");
    updateAdminGauges(); // 🔄 Refresh inbox card immediately
    runLiveFilter();
}

// 👑 Admin Management
function showTraceability() { render('traceability', 'Traceability Search', 'History'); }
function showStageManagement() { render('stageManagement', 'Workflow Setup', 'Stages'); }

function populateStagesTimeline() {
    const list = document.getElementById('workflow-timeline-list');
    list.innerHTML = manufacturingStages.sort((a, b) => a.order - b.order).map(s => `
        <div class="card glass flex justify-between items-center" 
             style="margin-bottom: 1rem; cursor: grab;" 
             draggable="true" 
             ondragstart="handleDragStart(event, '${s.id}')"
             ondragover="handleDragOver(event)"
             ondrop="handleDrop(event, '${s.id}')">
             <div class="flex items-center gap-4">
                <i data-lucide="grip-vertical" class="text-muted" style="width:16px;"></i>
                <div>
                   <span style="color: var(--primary); font-weight: 800; font-size: 0.8rem;">#STAGE ${s.order}</span>
                   <h4 style="font-size: 1.25rem; font-weight: 800;">${s.name}</h4>
                   <p class="text-muted" style="font-size: 0.8rem;">${s.checkpoints.length} Required Quality Checks</p>
                </div>
             </div>
             <div class="flex gap-2">
                 <button class="btn btn-outline" style="padding: 0.5rem;" onclick="editStage('${s.id}')"><i data-lucide="edit-3" style="width:16px;"></i></button>
                 <button class="btn btn-outline" style="padding: 0.5rem; color: var(--error);" onclick="deleteStage('${s.id}')"><i data-lucide="trash-2" style="width:16px;"></i></button>
             </div>
        </div>
    `).join('');
    lucide.createIcons();
}

function handleDragStart(e, id) {
    draggedStageId = id;
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
    e.preventDefault();
}

function handleDrop(e, targetId) {
    e.preventDefault();
    if (draggedStageId === targetId) return;

    const fromIndex = manufacturingStages.findIndex(s => s.id === draggedStageId);
    const toIndex = manufacturingStages.findIndex(s => s.id === targetId);

    const [movedStage] = manufacturingStages.splice(fromIndex, 1);
    manufacturingStages.splice(toIndex, 0, movedStage);

    // Re-assign sequence orders
    manufacturingStages.forEach((s, i) => s.order = i + 1);
    persistStages();
    populateStagesTimeline();
}


function showCreateStage() {
    editingStageId = null;
    render('createStage', 'Workflow Setup', 'Definition');
    addCPRow(); // Start with 1 empty row
}

function addCPRow(desc = '', photo = false) {
    const list = document.getElementById('cp-builder-list');
    const id = Date.now() + Math.random();
    list.insertAdjacentHTML('beforeend', `
        <div class="flex gap-3 items-center" id="row-${id}">
            <input type="text" placeholder="Check description..." class="cp-row-desc" value="${desc}" style="flex: 1;">
            <div class="flex gap-2 items-center">
                <span style="font-size: 0.7rem; font-weight: 800;">PHOTO?</span>
                <input type="checkbox" class="cp-row-photo" ${photo ? 'checked' : ''}>
            </div>
            <button type="button" class="btn-icon" onclick="document.getElementById('row-${id}').remove()"><i data-lucide="x" style="width:14px; color:var(--error);"></i></button>
        </div>
    `);
    lucide.createIcons();
}

function saveStage(e) {
    e.preventDefault();
    const name = document.getElementById('stage-name-input').value;
    const order = parseInt(document.getElementById('stage-order-input').value);

    // Robust checkpoint extraction
    const checkpointResults = [];
    const rows = document.querySelectorAll('#cp-builder-list > div');
    rows.forEach(row => {
        const descInput = row.querySelector('.cp-row-desc');
        const photoCheck = row.querySelector('.cp-row-photo');
        if (descInput && descInput.value.trim()) {
            checkpointResults.push({
                desc: descInput.value.trim(),
                photo: photoCheck ? photoCheck.checked : false
            });
        }
    });

    if (editingStageId) {
        const s = manufacturingStages.find(st => st.id === editingStageId);
        if (s) {
            s.name = name;
            s.order = order;
            s.checkpoints = checkpointResults;
        }
    } else {
        const newStage = {
            id: 'st_' + Date.now(),
            name: name,
            order: order,
            checkpoints: checkpointResults
        };
        manufacturingStages.push(newStage);
    }

    // Ensure sorting is maintained
    manufacturingStages.sort((a, b) => a.order - b.order);
    persistStages();
    showToast(`Workflow stage '${name}' saved.`, "success");
    showStageManagement();
}


function editStage(id) {
    editingStageId = id;
    render('createStage', 'Workflow Setup', 'Editor');
}

function setupCreateStageForm() {
    const s = manufacturingStages.find(st => st.id === editingStageId);
    document.getElementById('stage-name-input').value = s.name;
    document.getElementById('stage-order-input').value = s.order;
    document.getElementById('cp-builder-list').innerHTML = '';
    s.checkpoints.forEach(cp => addCPRow(cp.desc, cp.photo));
}

function deleteStage(id) {
    if (confirm("Delete stage?")) {
        manufacturingStages = manufacturingStages.filter(s => s.id !== id);
        // Re-order remaining
        manufacturingStages.forEach((s, i) => s.order = i + 1);
        persistStages();
        showStageManagement();
    }
}

// 🔍 Traceability
function showTraceability() { render('traceability', 'FG Traceability', 'Heritage'); }

function showAnalytics() { render('analytics', 'Performance Analytics', 'Impact Study'); }

/** 🔎 SMART LEDGER SEARCH (Serials, Stages, or Statuses) */
function searchUnit() {
    const query = document.getElementById('search-serial').value.toUpperCase().trim();
    const resultArea = document.getElementById('trace-result-area');

    // If no query, just re-run the radio filters
    if (!query) {
        runLiveFilter();
        return;
    }

    // ⚡ EXACT SERIAL MATCH: If found, show full Heritage Drill-down
    const unit = units[query];
    if (unit) {
        renderHeritageView(unit);
        return;
    }

    // 🔍 FUZZY TABLE FILTER: Search across Serials, Stages and Status
    const allUnits = Object.values(units);
    const filtered = allUnits.filter(u => {
        const lastStage = u.history.length > 0 ? u.history[u.history.length - 1].stage.toUpperCase() : '';
        const status = u.status.toUpperCase();
        return u.serial.includes(query) || lastStage.includes(query) || status.includes(query);
    });

    if (filtered.length === 0) {
        resultArea.innerHTML = `<div class="card glass text-center p-8"><i data-lucide="search-x" style="margin: 0 auto 1rem; opacity:0.2;"></i> No units or stages matching <strong>"${query}"</strong> found.</div>`;
        lucide.createIcons();
        return;
    }

    renderLedgerTable(filtered, resultArea);
}

function renderHeritageView(unit) {
    let resultArea = document.getElementById('trace-result-area');

    // 🔄 View Switcher: If we are on Dashboard/Analytics, jump to Traceability first
    if (!resultArea) {
        showTraceability();
        resultArea = document.getElementById('trace-result-area');
    }

    // ⚔️ MRB DECISION CONSOLE: Only shows for units requiring management signature
    let mrbConsole = '';
    if (unit.status === 'MRB_REVIEW') {
        mrbConsole = `
            <div class="card" style="background: rgba(239, 68, 68, 0.1); border: 2px solid var(--error); margin-bottom: 2rem; padding: 1.5rem;">
                <div class="flex justify-between items-center">
                    <div>
                        <h4 style="color: var(--error); font-weight: 800; margin-bottom: 0.5rem;"><i data-lucide="shield-alert" style="width:18px; vertical-align:middle; margin-right:8px;"></i> Awaiting Executive Decision</h4>
                        <p style="font-size: 0.75rem; color: var(--text-muted);">This unit failed a critical checkpoint. As a Manager, you must decide its fate.</p>
                    </div>
                    <div class="flex gap-3">
                        <button class="btn btn-outline" style="border-color: var(--success); color: var(--success);" onclick="reworkScrappedUnit('${unit.serial}')">
                            <i data-lucide="rotate-ccw" style="width:16px"></i> Authorize Rework
                        </button>
                        <button class="btn btn-primary" style="background: var(--error); border:none;" onclick="finalScrapUnit('${unit.serial}')">
                            <i data-lucide="trash-2" style="width:16px"></i> Final Scrap (Write-off)
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    resultArea.innerHTML = `
        <div class="animate-up">
            ${mrbConsole}
            
            <div class="dashboard-grid" style="grid-template-columns: 1fr 2fr;">
                <div class="card glass" style="border-left: 5px solid ${unit.status === 'COMPLETED' ? 'var(--success)' : (unit.status === 'MRB_REVIEW' ? 'var(--error)' : 'var(--warning)')}">
                    <h3 class="section-title-sm">Unit Pulse</h3>
                    <div style="font-size: 1.5rem; font-weight: 900; color: var(--text-bright);">${unit.serial}</div>
                    <div class="badge ${unit.status === 'COMPLETED' ? 'badge-success' : (unit.status === 'MRB_REVIEW' ? 'badge-error' : 'badge-warning')}">${unit.status.replace('_', ' ')}</div>
                    <div class="text-muted" style="margin-top:0.5rem; font-size:0.7rem;">Currently at: <strong>${unit.history.length > 0 ? unit.history[unit.history.length - 1].stage : 'Initial Scan'}</strong></div>
                    <button class="btn btn-outline w-full" style="margin-top:1.5rem;" onclick="runLiveFilter(); document.getElementById('search-serial').value='';"><i data-lucide="arrow-left" style="width:14px;"></i> Return to Global Matrix</button>
                </div>
                <div class="card glass" style="padding:0; overflow:hidden;">
                    <h3 class="section-title-sm" style="padding: 1.5rem; margin:0; border-bottom: 1px solid var(--border);">Birth Log: Historical Trace</h3>
                    <div class="table-container" style="border:none;">
                        <table>
                            <thead><tr><th>Stage</th><th>Status</th><th>Operator</th><th>Time</th></tr></thead>
                            <tbody>
                                ${unit.history.slice().reverse().map(h => `<tr><td><strong>${h.stage}</strong></td><td><span class="badge ${h.status === 'PASS' ? 'badge-success' : (h.status === 'SCRAP' || h.status === 'FAIL' || h.status === 'UNIT_REJECTED' ? 'badge-error' : 'badge-warning')}">${h.status}</span></td><td>${h.operator}</td><td class="text-muted">${h.time}</td></tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>`;
    lucide.createIcons();
}

/** 📊 SHARED LEDGER TABLE RENDERER */
function renderLedgerTable(filteredUnits, container) {
    const allUnits = Object.values(units);
    const totalStages = Math.max(manufacturingStages.length, 1);

    // ── Fleet Summary (always from full dataset, not filtered) ──────────
    const summary = {
        total: allUnits.length,
        passed: allUnits.filter(u => u.status === 'COMPLETED').length,
        mrb: allUnits.filter(u => u.status === 'MRB_REVIEW').length,
        wip: allUnits.filter(u => u.status === 'IN_PROGRESS').length,
        scrap: allUnits.filter(u => u.status === 'SCRAP').length,
    };

    // ── Sort: newest batch first, highest unit number first ─────────────
    const getPrefix = sn => { const m = sn.match(/^B(\d{6})-/); return m ? m[1] : '000000'; };
    const getUnitNo = sn => parseInt(sn.split('-').pop()) || 0;
    const sorted = [...filteredUnits].sort((a, b) => {
        const pA = getPrefix(a.serial), pB = getPrefix(b.serial);
        if (pB !== pA) return pB.localeCompare(pA);
        return getUnitNo(b.serial) - getUnitNo(a.serial);
    });

    // ── Group by batch prefix ───────────────────────────────────────────
    const batches = {}, batchOrder = [];
    sorted.forEach(u => {
        const m = u.serial.match(/^(B\d{6})/);
        const key = m ? m[1] : 'BASELINE';
        if (!batches[key]) { batches[key] = []; batchOrder.push(key); }
        batches[key].push(u);
    });

    // ── Helpers ─────────────────────────────────────────────────────────
    const statusBadge = u => {
        const map = {
            COMPLETED: ['badge-success', '✅ PASSED'],
            MRB_REVIEW: ['badge-error', '🔴 MRB REVIEW'],
            IN_PROGRESS: ['badge-warning', '🔄 IN PROGRESS'],
            SCRAP: ['', '⬛ SCRAPPED'],
        };
        const [cls, lbl] = map[u.status] || ['', u.status];
        return `<span class="badge ${cls}" style="font-size:0.6rem; white-space:nowrap;">${u.isRework ? '♻️ REWORK' : lbl}</span>`;
    };

    const rowBg = u => {
        if (u.status === 'MRB_REVIEW') return 'background:rgba(239,68,68,0.07); border-left:3px solid var(--error);';
        if (u.status === 'COMPLETED') return 'border-left:3px solid var(--success);';
        if (u.status === 'SCRAP') return 'background:rgba(100,100,100,0.06); border-left:3px solid #555; opacity:0.7;';
        return 'border-left:3px solid var(--primary);';
    };

    const stageBar = u => {
        const pct = Math.round((Math.min(u.currentStageOrder, totalStages) / totalStages) * 100);
        const color = u.status === 'COMPLETED' ? 'var(--success)' : u.status === 'MRB_REVIEW' ? 'var(--error)' : 'var(--primary)';
        return `<div style="min-width:80px;">
            <div style="height:5px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;">
                <div style="width:${pct}%;height:100%;background:${color};border-radius:3px;"></div>
            </div>
            <div style="font-size:0.52rem;color:var(--text-muted);margin-top:2px;text-align:center;">Stage ${u.currentStageOrder} / ${totalStages}</div>
        </div>`;
    };

    // ── Summary Bar ─────────────────────────────────────────────────────
    const summaryBar = `
        <div style="display:flex;gap:1.25rem;flex-wrap:wrap;align-items:center;padding:0.9rem 1.25rem;
                    background:rgba(255,255,255,0.03);border:1px solid var(--border);
                    border-radius:12px;margin-bottom:1.5rem;">
            <span style="font-size:0.6rem;font-weight:900;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.1em;">Fleet Snapshot</span>
            <span style="font-size:0.8rem;font-weight:800;">${summary.total} <span style="font-size:0.6rem;font-weight:600;color:var(--text-muted);">TOTAL</span></span>
            <span style="color:var(--success);font-size:0.8rem;font-weight:800;">● ${summary.passed} <span style="font-size:0.6rem;font-weight:600;">PASSED</span></span>
            <span style="color:var(--error);font-size:0.8rem;font-weight:800;">■ ${summary.mrb} <span style="font-size:0.6rem;font-weight:600;">MRB</span></span>
            <span style="color:var(--primary);font-size:0.8rem;font-weight:800;">◐ ${summary.wip} <span style="font-size:0.6rem;font-weight:600;">WIP</span></span>
            ${summary.scrap > 0 ? `<span style="color:#888;font-size:0.8rem;font-weight:800;">✕ ${summary.scrap} <span style="font-size:0.6rem;font-weight:600;">SCRAP</span></span>` : ''}
            <span style="margin-left:auto;font-size:0.6rem;color:var(--text-muted);">
                Showing <strong style="color:var(--text);">${filteredUnits.length}</strong> of ${summary.total} units
                &nbsp;•&nbsp; ${batchOrder.length} batch${batchOrder.length !== 1 ? 'es' : ''}
            </span>
        </div>`;

    // ── Batch Groups ────────────────────────────────────────────────────
    const batchGroups = batchOrder.map(key => {
        const bUnits = batches[key];
        const bPassed = bUnits.filter(u => u.status === 'COMPLETED').length;
        const bMRB = bUnits.filter(u => u.status === 'MRB_REVIEW').length;
        const bWIP = bUnits.filter(u => u.status === 'IN_PROGRESS').length;

        // Parse HH:MM:SS from key like B223527
        const h = key.slice(1, 3), mi = key.slice(3, 5), s = key.slice(5, 7);
        const timeStr = key !== 'BASELINE' ? `${h}:${mi}:${s}` : '';
        const batchLabel = key !== 'BASELINE' ? key : 'Historical / Baseline Entries';

        const rows = bUnits.map(u => `
            <tr style="${rowBg(u)}">
                <td style="font-family:monospace;font-weight:800;font-size:0.78rem;">${u.serial}</td>
                <td style="font-size:0.72rem;font-weight:700;max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                    ${u.history.length > 0 ? u.history[u.history.length - 1].stage : '--'}
                </td>
                <td>${statusBadge(u)}</td>
                <td>${stageBar(u)}</td>
                <td class="text-muted" style="font-size:0.62rem;white-space:nowrap;">
                    ${u.history.length > 0 ? u.history[u.history.length - 1].time : '--'}
                </td>
                <td>
                    <button class="btn btn-outline" style="font-size:0.6rem;padding:3px 9px;white-space:nowrap;"
                        onclick="document.getElementById('search-serial').value='${u.serial}'; searchUnit();">
                        View Trace
                    </button>
                </td>
            </tr>`).join('');

        return `
            <div style="margin-bottom:2rem;">
                <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;
                            padding:0.65rem 1rem;background:rgba(255,255,255,0.05);
                            border-radius:10px 10px 0 0;border-bottom:2px solid var(--border);">
                    <i data-lucide="layers" style="width:14px;height:14px;color:var(--text-muted);"></i>
                    <span style="font-family:monospace;font-weight:900;font-size:0.85rem;">${batchLabel}</span>
                    <span style="font-size:0.65rem;color:var(--text-muted);">— ${bUnits.length} units</span>
                    ${timeStr ? `<span style="font-size:0.65rem;color:var(--text-muted);">@ ${timeStr}</span>` : ''}
                    <div style="margin-left:auto;display:flex;gap:0.75rem;align-items:center;">
                        <span style="font-size:0.65rem;font-weight:800;color:var(--success);">✅ ${bPassed} passed</span>
                        ${bMRB > 0 ? `<span style="font-size:0.65rem;font-weight:800;color:var(--error);">🔴 ${bMRB} MRB</span>` : ''}
                        ${bWIP > 0 ? `<span style="font-size:0.65rem;font-weight:800;color:var(--primary);">🔄 ${bWIP} WIP</span>` : ''}
                    </div>
                </div>
                <div class="card glass" style="padding:0;overflow:hidden;border-radius:0 0 12px 12px;border-top:none;margin-top:0;">
                    <div class="table-container" style="border:none;margin:0;">
                        <table>
                            <thead>
                                <tr>
                                    <th>SERIAL</th><th>LAST STAGE</th><th>STATUS</th>
                                    <th>PROGRESS</th><th>TIMESTAMP</th><th>ACTION</th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                </div>
            </div>`;
    }).join('');

    container.innerHTML = summaryBar + batchGroups;
    lucide.createIcons();
}

function runLiveFilter() {
    const filterType = document.querySelector('input[name="ledger-filter"]:checked').value;
    const resultArea = document.getElementById('trace-result-area');
    if (!resultArea) return;

    const filtered = Object.values(units).filter(u => {
        if (filterType === 'wip') return u.status === 'IN_PROGRESS' || u.status === 'IN_PROGRESS';
        if (filterType === 'passed') return u.status === 'COMPLETED';
        if (filterType === 'scrap') return u.status === 'SCRAP';
        if (filterType === 'rework') return u.isRework;
        if (filterType === 'mrb') return u.status === 'MRB_REVIEW';
        return true; // "all"
    }).sort((a, b) => {
        if (a.status === 'MRB_REVIEW' && b.status !== 'MRB_REVIEW') return -1;
        return 0;
    });

    if (filtered.length === 0) {
        resultArea.innerHTML = `<div class="card glass text-center p-8"><i data-lucide="inbox" style="margin: 0 auto 1rem; opacity:0.1;"></i> No units in this category.</div>`;
        lucide.createIcons();
        return;
    }

    renderLedgerTable(filtered, resultArea);
}
function exportWorkflow() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(manufacturingStages, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `factory_blueprint_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

function showTransferData() {
    showToast("Full Production Ledger encoded and ready for CSV Export.", "success");
}

function logout() {
    stopWebcam();
    document.getElementById('main-layout').classList.add('hidden');
    document.getElementById('screen-login').classList.remove('hidden');
}

function reworkScrappedUnit(sn) {
    if (!confirm(`🔧 Authorize Rework for unit ${sn} ? This will return the unit to the stage where it was scrapped.`)) return;

    const unit = units[sn];
    if (unit) {
        unit.status = "IN_PROGRESS";
        unit.isRework = true;
        // Reset current stage to the one it was scrapped at
        unit.currentStageOrder = unit.scrapStageOrder || 1;

        unit.history.push({
            stage: "ADMIN_REWORK",
            status: "RE-AUTHORIZED",
            operator: currentUser.name,
            time: new Date().toLocaleString(),
            note: "Unit restored to Stage " + unit.currentStageOrder
        });

        pushAudit("UNIT_REWORK", `Unit ${sn} re - authorized for Stage ${unit.currentStageOrder}`);
        persistUnits();

        showToast(`\u2705 Rework authorized. Unit ${sn} returned to \'${unit.scrapStageName || 'Stage ' + unit.currentStageOrder}\'. It will resume from there.`, "warning");
        renderHeritageView(unit); // Refresh view
    }
}

// 👥 Personnel Management Logic
function showUserManagement() { render('userManagement', 'Admin Control', 'Users'); }

function populateUserList() {
    const body = document.getElementById('user-list-body');
    if (!body) return;

    body.innerHTML = usersData.map(u => `
    <tr >
            <td><strong>${u.name}</strong></td>
            <td><code style="background:var(--border); padding:2px 6px; border-radius:4px;">${u.accessId}</code></td>
            <td><span class="badge ${u.role === 'admin' ? 'badge-primary' : 'badge-success'}">${u.role.toUpperCase()}</span></td>
            <td>${u.stats ? (u.stats.passed + u.stats.scrapped) : 0} actions</td>
            <td><button class="btn btn-outline" style="padding:0.4rem; color:var(--error);" onclick="confirm('Delete user ${u.name}?') ? deleteUser('${u.id}') : null"><i data-lucide="trash-2" style="width:14px;"></i></button></td>
        </tr >
    `).join('');
    lucide.createIcons();
}

function showAddUserModal() { document.getElementById('user-modal').classList.remove('hidden'); }
function closeUserModal() { document.getElementById('user-modal').classList.add('hidden'); }

async function saveNewUser(e) {
    e.preventDefault();
    const nameVal = document.getElementById('new-user-name').value.trim();
    const idVal = document.getElementById('new-user-id').value.toLowerCase().trim();
    const passVal = document.getElementById('new-user-pass').value.trim();
    const roleVal = document.getElementById('new-user-role').value;

    if (!nameVal || !idVal || !passVal) {
        showToast('All fields are required.', 'error');
        return;
    }

    // Check for duplicates
    if (usersData.find(u => u.accessId.toLowerCase() === idVal)) {
        showToast(`Access ID '${idVal}' already exists. Choose another.`, 'error');
        return;
    }

    const newUser = {
        id: 'u_' + Date.now(),
        name: nameVal,
        accessId: idVal,
        pass: passVal,
        role: roleVal,
        stats: { passed: 0, scrapped: 0 }
    };

    usersData.push(newUser);
    closeUserModal();
    populateUserList();
    showToast(`Uploading ${nameVal} to cloud...`, 'warning');
    await persistUsers(); // ✅ Await so cloud write completes before snapshot can fire
    showToast(`✅ ${nameVal} added. They can log in now.`, 'success');
}

function deleteUser(id) {
    usersData = usersData.filter(u => u.id !== id);
    persistUsers();
    populateUserList();
}

// 📡 Dashboard Live Feed Logic
function updateAuditFeed() {
    const list = document.getElementById('live-audit-stream');
    if (!list) return;

    const recentLogs = globalAuditLog.slice(-10).reverse(); // Last 10 events

    if (recentLogs.length === 0) {
        list.innerHTML = `<tr > <td colspan="4" class="text-center text-muted" style="padding:2rem;">Waiting for factory production events...</td></tr > `;
        return;
    }

    list.innerHTML = recentLogs.map(log => `
    <tr style="border-left: 3px solid ${log.event === 'UNIT_SCRAP' ? 'var(--error)' : (log.event.includes('REWORK') ? 'var(--warning)' : 'var(--success)')}" >
            <td><strong style="color:var(--text-bright);">${log.details.split(' ')[1] || '---'}</strong></td>
            <td><span class="badge" style="background:rgba(255,255,255,0.05); font-size:0.6rem;">${log.event.split('_')[0]}</span></td>
            <td style="font-size:0.75rem;">${log.details}</td>
            <td class="text-muted" style="font-size:0.65rem;">${log.time.split(',')[1] || log.time}</td>
        </tr >
    `).join('');
}

function updateOpLeague() {
    const body = document.getElementById('op-league-body');
    if (!body) return;
    body.innerHTML = usersData.filter(u => u.role === 'operator').map(u => {
        const total = u.stats.passed + u.stats.scrapped;
        const eff = total === 0 ? 0 : (u.stats.passed / total * 100).toFixed(0);
        return `
    <tr >
                <td><strong>${u.name}</strong></td>
                <td><span class="badge badge-success">OPERATOR</span></td>
                <td style="color:var(--success); font-weight:800;">+${u.stats.passed}</td>
                <td style="color:var(--error);">${u.stats.scrapped}</td>
                <td>
                    <div class="flex items-center gap-2">
                        <div style="flex:1; height:6px; background:var(--border); border-radius:10px; overflow:hidden;">
                            <div style="height:100%; width:${eff}%; background:var(--primary);"></div>
                        </div>
                        <span>${eff}%</span>
                    </div>
                </td>
            </tr >
    `;
    }).join('');
}

// 🍞 Toast Notification Engine
function showToast(msg, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type} `;

    let icon = 'info';
    if (type === 'success') icon = 'check-circle';
    if (type === 'error') icon = 'alert-octagon';
    if (type === 'warning') icon = 'alert-triangle';

    toast.innerHTML = `
    <i data-lucide="${icon}" style = "width:20px;" ></i >
        <div style="flex:1; font-size:0.85rem; font-weight:600;">${msg}</div>
        <i data-lucide="x" style="width:14px; opacity:0.5;"></i>
`;

    container.appendChild(toast);
    lucide.createIcons();

    // Click to dismiss
    toast.onclick = () => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 400);
    };

    // Auto dismiss
    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 400);
        }
    }, duration);
}

// 📊 EXCEL WORKFLOW IMPORT ENGINE
function importExcelWorkflow(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];

            // Convert sheet to json
            const jsonData = XLSX.utils.sheet_to_json(worksheet);

            if (jsonData.length === 0) {
                showToast("Excel sheet appears to be empty", "error");
                return;
            }

            // Organize by Stages
            const stagesMap = {};
            jsonData.forEach((row, index) => {
                const stageName = row['Stage'] || row['stage'] || 'General Inspection';
                const checkpointDesc = row['Checkpoint'] || row['checkpoint'] || row['Description'] || 'Verify Parameter';
                const isPhotoMandatory = (row['Type'] || row['type'] || '').toLowerCase().includes('visual') || (row['Photo'] || '').toString().toLowerCase() === 'yes';

                if (!stagesMap[stageName]) {
                    stagesMap[stageName] = {
                        id: `stage_${Object.keys(stagesMap).length + 1} `,
                        name: stageName,
                        order: Object.keys(stagesMap).length + 1,
                        checkpoints: []
                    };
                }

                stagesMap[stageName].checkpoints.push({
                    desc: checkpointDesc,
                    photo: isPhotoMandatory
                });
            });

            // Update System
            manufacturingStages = Object.values(stagesMap);
            persistStages();

            showToast(`Import Success: ${manufacturingStages.length} IPQC Stages created`, "success");
            showStageManagement(); // Refresh view

            if (cloudActive) {
                seedCloudData(); // Sync up
            }

        } catch (err) {
            console.error(err);
            showToast("Failed to parse Excel file. Check format.", "error");
        }
    };
    reader.readAsArrayBuffer(file);
}

// Init
// 🏛️ EXECUTIVE CONTROL & ANALYTICS ENGINE
function goToMRB() {
    render('traceability', 'Production Ledger', 'Real-time Board');
    setTimeout(() => {
        const rad = document.querySelector('input[name="ledger-filter"][value="mrb"]');
        if (rad) {
            rad.checked = true;
            runLiveFilter();
        }
    }, 150);
}

function renderExecutiveCharts() {
    console.log('📊 Chart Engine: Booting...');

    setTimeout(() => {
        try {
            if (typeof Chart === 'undefined') {
                showToast('Chart.js not loaded — check internet connection.', 'error');
                return;
            }

            // ✅ Safe destroy wrapper — works across all Chart.js v3+ builds
            const destroyIfExists = (id) => {
                try {
                    if (typeof Chart.getChart === 'function') {
                        const existing = Chart.getChart(id);
                        if (existing) existing.destroy();
                    }
                } catch (_) { /* safe to ignore */ }
            };

            // Hide loader placeholders
            document.querySelectorAll('.chart-loader').forEach(l => l.style.display = 'none');

            // 1. Live SPC Chart (updates frequently)
            renderSPCChartOnly();

            // 2. 6-Month Trend Chart — STATIC DATA, skip if already rendered
            const trendCanvas = document.getElementById('monthly-trend-chart');
            if (trendCanvas && Chart.getChart(trendCanvas)) {
                // chart already exists and data is static — skip re-render
            } else if (trendCanvas) {
                // first render only
                destroyIfExists('monthly-trend-chart');

                // Unit counts for each baseline month (totalFG / inventoryPlan from legacyManualPerformance)
                const legacyPlan = legacyManualPerformance.inventoryPlan; // 3000
                const legacyUnitsPassed = legacyManualPerformance.months.map(m =>
                    legacyManualPerformance.data[m].totalFG
                ); // [2634, 2591, 2638, 2613, 2620, 2590]

                // Digital current: derive from live yieldData
                const digitalPassed = yieldData.passed.reduce((a, b) => a + b, 0);
                const digitalTotal = yieldData.inspected.reduce((a, b) => a + b, 0);

                // For tooltip: units per bar slot (7 slots: 6 baseline + 1 digital)
                const unitCountsLegacy = [...legacyUnitsPassed, null];
                const unitCountsDigital = [null, null, null, null, null, null, digitalPassed];
                const totalPerSlot = [...Array(6).fill(legacyPlan), digitalTotal || legacyPlan];

                // Inline bar-label plugin (draws text above each bar)
                const barLabelPlugin = {
                    id: 'barUnitLabel',
                    afterDatasetsDraw(chart) {
                        const { ctx, data } = chart;
                        ctx.save();
                        chart.data.datasets.forEach((dataset, dsIdx) => {
                            const meta = chart.getDatasetMeta(dsIdx);
                            meta.data.forEach((bar, i) => {
                                const val = dataset.data[i];
                                if (val === null || val === undefined) return;

                                const units = dsIdx === 0 ? unitCountsLegacy[i] : unitCountsDigital[i];
                                const total = totalPerSlot[i];
                                if (units === null || units === undefined) return;

                                const label = `${units.toLocaleString()} / ${total.toLocaleString()}`;
                                ctx.fillStyle = dsIdx === 1 ? 'rgba(200,180,255,0.95)' : 'rgba(255,255,255,0.55)';
                                ctx.font = 'bold 9px Inter, sans-serif';
                                ctx.textAlign = 'center';
                                ctx.fillText(label, bar.x, bar.y - 6);
                            });
                        });
                        ctx.restore();
                    }
                };

                new Chart(trendCanvas, {
                    type: 'bar',
                    plugins: [barLabelPlugin],
                    data: {
                        labels: ["Oct '25", "Nov '25", "Dec '25", "Jan '26", "Feb '26", "Mar '26", "Current"],
                        datasets: [{
                            label: 'Historical Baseline Yield %',
                            data: [84.2, 85.5, 87.1, 88.4, 86.8, 90.2, null],
                            backgroundColor: 'rgba(255,255,255,0.07)',
                            borderColor: 'rgba(255,255,255,0.15)',
                            borderWidth: 1,
                            borderRadius: 6
                        }, {
                            label: 'Digital System Yield %',
                            data: [null, null, null, null, null, null, 98.8],
                            backgroundColor: 'rgba(139,92,246,0.85)',
                            borderRadius: 6
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        animation: { duration: 700 },
                        layout: { padding: { top: 22 } }, // room for bar labels
                        plugins: {
                            legend: { position: 'bottom', labels: { color: 'rgba(255,255,255,0.6)', font: { size: 10 } } },
                            tooltip: {
                                mode: 'index',
                                intersect: false,
                                callbacks: {
                                    label(ctx) {
                                        const dsIdx = ctx.datasetIndex;
                                        const i = ctx.dataIndex;
                                        const yVal = ctx.parsed.y;
                                        if (yVal === null) return null;
                                        const units = dsIdx === 0 ? unitCountsLegacy[i] : unitCountsDigital[i];
                                        const total = totalPerSlot[i];
                                        const unitStr = (units !== null && units !== undefined)
                                            ? `  •  ${units.toLocaleString()} / ${total.toLocaleString()} units passed`
                                            : '';
                                        return ` ${ctx.dataset.label}: ${yVal}%${unitStr}`;
                                    }
                                }
                            }
                        },
                        scales: {
                            y: { min: 80, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255,255,255,0.4)', callback: v => v + '%' } },
                            x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.4)' } }
                        }
                    }
                });
                console.log('✅ Trend Chart rendered.');
            } else {
                console.warn('⚠️ #monthly-trend-chart canvas not found in DOM.');
            }

            // 3. Defect Pareto Chart — Rejections by Stage
            // ─────────────────────────────────────────────────────────────
            // HOW IT WORKS:
            //   • Scans all MRB_REVIEW units and counts how many failed at each stage
            //     (using unit.scrapStageName stored during simulation)
            //   • Sorts stages descending: stage with most rejections shown first
            //   • A green cumulative % line shows where 80% of rejections come from
            //   • Managers immediately see the single biggest bottleneck to fix
            // ─────────────────────────────────────────────────────────────
            // 3. Defect Pareto Chart — Rejections by Stage
            const paretoCanvas = document.getElementById('pareto-chart');
            if (paretoCanvas && Chart.getChart(paretoCanvas)) {
                // skip re-render
            } else if (paretoCanvas) {
                destroyIfExists('pareto-chart');

                // Build rejection count per stage name
                const rejMap = {};
                Object.values(units).forEach(u => {
                    if (u.status === 'MRB_REVIEW' && u.scrapStageName) {
                        rejMap[u.scrapStageName] = (rejMap[u.scrapStageName] || 0) + 1;
                    }
                });

                // Fallback: if no real data yet, show demo
                const hasRealData = Object.keys(rejMap).length > 0;
                const stageNames = hasRealData
                    ? Object.entries(rejMap).sort((a, b) => b[1] - a[1]).map(e => e[0])
                    : manufacturingStages.map(s => s.name);
                const rejCounts = hasRealData
                    ? Object.entries(rejMap).sort((a, b) => b[1] - a[1]).map(e => e[1])
                    : [12, 9, 6, 4, 2, 1]; // demo

                // Cumulative % line
                const totalRej = rejCounts.reduce((a, b) => a + b, 0);
                let cumSum = 0;
                const cumPct = rejCounts.map(v => { cumSum += v; return parseFloat(((cumSum / totalRej) * 100).toFixed(1)); });

                // Bar colours: red → orange gradient by rank
                const barColors = rejCounts.map((_, i) => {
                    const ratio = i / Math.max(rejCounts.length - 1, 1);
                    const r = Math.round(239 - ratio * 60);
                    const g = Math.round(68 + ratio * 100);
                    return `rgba(${r},${g},68,0.85)`;
                });

                new Chart(paretoCanvas, {
                    type: 'bar',
                    data: {
                        labels: stageNames,
                        datasets: [{
                            label: 'Rejections',
                            data: rejCounts,
                            backgroundColor: barColors,
                            borderRadius: 6,
                            order: 2,
                            yAxisID: 'yLeft'
                        }, {
                            label: 'Cumulative %',
                            data: cumPct,
                            type: 'line',
                            borderColor: 'rgba(16,185,129,0.9)',
                            backgroundColor: 'transparent',
                            pointBackgroundColor: '#10b981',
                            pointRadius: 4,
                            tension: 0.3,
                            order: 1,
                            yAxisID: 'yRight'
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        animation: { duration: 700 },
                        plugins: {
                            legend: { display: true, labels: { color: 'rgba(255,255,255,0.5)', font: { size: 9 }, boxWidth: 18 } },
                            tooltip: {
                                callbacks: {
                                    afterLabel(ctx) {
                                        if (ctx.datasetIndex === 0) {
                                            const pct = ((ctx.parsed.y / totalRej) * 100).toFixed(1);
                                            return `${pct}% of all rejections`;
                                        }
                                        return `${ctx.parsed.y}% cumulative`;
                                    }
                                }
                            }
                        },
                        scales: {
                            yLeft: { position: 'left', title: { display: true, text: 'Rejections', color: 'rgba(255,255,255,0.3)', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: 'rgba(255,255,255,0.4)', stepSize: 1 } },
                            yRight: { position: 'right', title: { display: true, text: 'Cumulative %', color: 'rgba(255,255,255,0.3)', font: { size: 9 } }, min: 0, max: 100, grid: { display: false }, ticks: { color: 'rgba(16,185,129,0.6)', callback: v => v + '%' } },
                            x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 9 } } }
                        }
                    }
                });
                console.log(`✅ Pareto Chart: ${stageNames.length} stages | Total rejections: ${totalRej}${!hasRealData ? ' (demo data)' : ''}`);
            }

        } catch (err) {
            console.error('❌ Chart render error:', err.message);
            showToast('Chart render failed: ' + err.message, 'error');
        }
    }, 200);


    // 3. Critical Management Actions — Live Bottleneck Detection
    //    Reads per-stage pass/fail counts from the actual units object.
    //    Flags any stage whose live FPY drops below 92% benchmark.
    const list = document.getElementById('bottleneck-action-list');
    if (list) {
        const allUnits = Object.values(units);

        // Build per-stage pass/fail counts from unit history (same method as heatmap)
        const stageStats = {};
        manufacturingStages.forEach(s => {
            stageStats[s.name] = { passes: 0, fails: 0, name: s.name, order: s.order };
        });

        allUnits.forEach(u => {
            u.history.forEach(h => {
                if (stageStats[h.stage]) {
                    if (h.status === 'PASS') stageStats[h.stage].passes++;
                    else if (h.status === 'UNIT_REJECTED') stageStats[h.stage].fails++;
                }
            });
        });

        // Find stages below 92% benchmark (only if they have actual data)
        const bottlenecks = Object.values(stageStats)
            .filter(s => {
                const total = s.passes + s.fails;
                if (total === 0) return false; // skip stages with no data yet
                const fpy = (s.passes / total) * 100;
                return fpy < 92;
            })
            .sort((a, b) => {
                // Sort by FPY ascending (worst stage first)
                const fpyA = a.passes / (a.passes + a.fails);
                const fpyB = b.passes / (b.passes + b.fails);
                return fpyA - fpyB;
            });

        if (allUnits.length === 0) {
            list.innerHTML = `<div class="text-center py-8" style="border: 1px dashed rgba(255,255,255,0.1); border-radius: 12px;">
                <i data-lucide="activity" style="width:28px; height:28px; color:var(--text-muted); margin: 0 auto 0.5rem; display:block; opacity:0.4;"></i>
                <p class="text-muted" style="font-size:0.7rem;">No production data yet. Run a simulation to see live bottleneck alerts.</p>
            </div>`;
        } else if (bottlenecks.length === 0) {
            list.innerHTML = `<div class="text-center py-8" style="border: 1px dashed rgba(255,255,255,0.1); border-radius: 12px;">
                <i data-lucide="check-circle-2" style="width:32px; height:32px; color:var(--success); margin: 0 auto 0.5rem; display:block; opacity:0.5;"></i>
                <p class="text-muted" style="font-size:0.7rem;">All stations performing within safety benchmarks (≥ 92%).</p>
            </div>`;
            lucide.createIcons();
        } else {
            list.innerHTML = bottlenecks.map(s => {
                const total = s.passes + s.fails;
                const fpy = ((s.passes / total) * 100).toFixed(1);
                const gap = (92 - parseFloat(fpy)).toFixed(1);
                const color = parseFloat(fpy) < 80 ? 'var(--error)' : 'var(--warning)';
                return `
                    <div style="background:rgba(239,68,68,0.05); border:1px solid rgba(239,68,68,0.2);
                                border-radius:12px; padding:1rem;
                                display:flex; justify-content:space-between; align-items:center; gap:1rem;">
                        <div style="flex:1;">
                            <div style="font-weight:800; font-size:0.82rem; color:${color}; margin-bottom:0.2rem;">
                                ${s.name}
                            </div>
                            <div style="font-size:0.62rem; color:var(--text-muted); font-weight:600;">
                                ⚠️ ${s.fails} rejections &nbsp;|&nbsp; ${gap}% below 92% target
                            </div>
                            <div style="height:4px; background:rgba(255,255,255,0.06); border-radius:2px; margin-top:6px; overflow:hidden;">
                                <div style="width:${fpy}%; height:100%; background:${color}; border-radius:2px;"></div>
                            </div>
                        </div>
                        <div style="text-align:right; min-width:60px;">
                            <div style="font-size:1.25rem; font-weight:900; color:${color};">${fpy}%</div>
                            <button class="btn btn-outline" style="font-size:0.55rem; padding:3px 8px; margin-top:4px; border-color:${color}; color:${color};"
                                onclick="showToast('🔧 Work Order raised for ${s.name}. Station supervisor notified.', 'warning', 4000)">
                                Raise Work Order
                            </button>
                        </div>
                    </div>`;
            }).join('');
        }
        lucide.createIcons();
    }

    // 🔄 Always update bottlenecks even if charts are skipped
    updateBottleneckSummary();
}

function renderSPCChartOnly() {
    try {
        const id = 'spc-yield-chart';
        const canvas = document.getElementById(id);
        if (!canvas) return;

        // Destroy existing for this specific ID
        if (typeof Chart.getChart === 'function') {
            const existing = Chart.getChart(id);
            if (existing) existing.destroy();
        }

        const isExpanded = document.getElementById('card-spc')?.classList.contains('card-expanded') || false;
        const fontSize = isExpanded ? 14 : 9;
        const titleSize = isExpanded ? 16 : 10;
        const lineWeight = isExpanded ? 4 : 2;
        const dotSize = isExpanded ? 10 : 5;
        const activeDotSize = isExpanded ? 14 : 8;

        const batchMap = new Map();
        Object.values(units).forEach(u => {
            const label = u.batchLabel || u.serial.split('-')[0];
            if (!batchMap.has(label)) batchMap.set(label, { total: 0, passed: 0 });
            const b = batchMap.get(label);
            b.total++;
            if (u.status === 'COMPLETED') b.passed++;
        });

        const DEMO = [96.5, 97.2, 95.8, 92.4, 98.1, 96.6, 95.2, 97.8, 98.5, 96.2, 94.8, 97.5];
        const useDemo = batchMap.size < 2;

        let allYields, batchYields, labels;
        if (useDemo) {
            allYields = DEMO;
            batchYields = DEMO;
            labels = DEMO.map((_, i) => `Demo ${i + 1}`);
        } else {
            const entries = Array.from(batchMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
            allYields = entries.map(([, v]) => parseFloat(((v.passed / v.total) * 100).toFixed(1)));
            batchYields = allYields.slice(-20);
            const allKeys = entries.map(([k]) => k);
            labels = allKeys.slice(-20).map((k, i) => `Batch ${allYields.length - batchYields.length + i + 1}`);
        }

        const n = allYields.length;
        const mean = allYields.reduce((a, b) => a + b, 0) / n;
        const variance = allYields.reduce((s, y) => s + Math.pow(y - mean, 2), 0) / n;
        const sigma = Math.sqrt(variance);
        const ucl = Math.min(parseFloat((mean + 3 * sigma).toFixed(1)), 100);
        const lcl = Math.max(parseFloat((mean - 3 * sigma).toFixed(1)), 70);

        // Update footer labels
        const uclEl = document.getElementById('spc-ucl-label');
        const meanEl = document.getElementById('spc-mean-label');
        const lclEl = document.getElementById('spc-lcl-label');
        if (uclEl) uclEl.textContent = ucl.toFixed(1) + '%';
        if (meanEl) meanEl.textContent = mean.toFixed(1) + '%';
        if (lclEl) lclEl.textContent = lcl.toFixed(1) + '%';

        new Chart(canvas, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Batch Yield %',
                    data: batchYields,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.08)',
                    borderWidth: lineWeight,
                    tension: 0.4,
                    fill: true,
                    pointRadius: batchYields.map(y => y < lcl ? activeDotSize : dotSize),
                    pointBackgroundColor: batchYields.map(y => y < lcl ? '#ef4444' : '#10b981'),
                    pointBorderColor: '#fff',
                    pointBorderWidth: isExpanded ? 3 : 2
                }, {
                    label: `UCL (${ucl.toFixed(1)}%)`,
                    data: Array(labels.length).fill(ucl),
                    borderColor: 'rgba(139,92,246,0.5)',
                    borderDash: [4, 4],
                    pointStyle: false,
                    fill: false
                }, {
                    label: `Mean X̄ (${mean.toFixed(1)}%)`,
                    data: Array(labels.length).fill(parseFloat(mean.toFixed(1))),
                    borderColor: 'rgba(59,130,246,0.7)',
                    borderDash: [8, 4],
                    pointStyle: false,
                    fill: false
                }, {
                    label: `LCL (${lcl.toFixed(1)}%)`,
                    data: Array(labels.length).fill(lcl),
                    borderColor: 'rgba(239,68,68,0.7)',
                    borderWidth: isExpanded ? 4 : 2,
                    borderDash: [6, 4],
                    pointStyle: false,
                    fill: false
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                animation: { duration: 700 },
                plugins: {
                    legend: {
                        display: true,
                        labels: {
                            color: 'rgba(255,255,255,0.7)',
                            font: { size: fontSize, weight: '700' }
                        }
                    }
                },
                scales: {
                    y: {
                        min: Math.max(70, lcl - 5), max: 100,
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: 'rgba(255,255,255,0.4)', font: { size: fontSize, weight: '700' } }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: 'rgba(255,255,255,0.4)', font: { size: fontSize, weight: '700' } }
                    }
                }
            }
        });
    } catch (e) {
        console.error('SPC-only refresh failed:', e);
    }
}

function updateBottleneckSummary() {
    const list = document.getElementById('bottleneck-action-list');
    if (!list) return;

    const allUnits = Object.values(units);
    const stageStats = {};
    manufacturingStages.forEach(s => {
        stageStats[s.name] = { passes: 0, fails: 0, name: s.name, order: s.order };
    });

    allUnits.forEach(u => {
        u.history.forEach(h => {
            if (stageStats[h.stage]) {
                if (h.status === 'PASS') stageStats[h.stage].passes++;
                else if (h.status === 'UNIT_REJECTED') stageStats[h.stage].fails++;
            }
        });
    });

    const bottlenecks = Object.values(stageStats)
        .filter(s => {
            const total = s.passes + s.fails;
            if (total === 0) return false;
            const fpy = (s.passes / total) * 100;
            return fpy < 92;
        })
        .sort((a, b) => {
            const fpyA = a.passes / (a.passes + a.fails);
            const fpyB = b.passes / (b.passes + b.fails);
            return fpyA - fpyB;
        });

    if (allUnits.length === 0) {
        list.innerHTML = `<div class="text-center py-8">...</div>`;
    } else if (bottlenecks.length === 0) {
        list.innerHTML = `<div class="text-center py-8">...</div>`;
    } else {
        list.innerHTML = bottlenecks.map(s => {
            const total = s.passes + s.fails;
            const fpy = ((s.passes / total) * 100).toFixed(1);
            const gap = (92 - parseFloat(fpy)).toFixed(1);
            const color = parseFloat(fpy) < 80 ? 'var(--error)' : 'var(--warning)';
            return `
                <div style="background:rgba(239,68,68,0.05); border:1px solid rgba(239,68,68,0.2); border-radius:12px; padding:1rem; display:flex; justify-content:space-between; align-items:center; gap:1rem;">
                    <div style="flex:1;">
                        <div style="font-weight:800; font-size:0.82rem; color:${color};">${s.name}</div>
                        <div style="font-size:0.62rem; color:var(--text-muted);">⚠️ ${s.fails} rejections | ${gap}% below target</div>
                    </div>
                    <div style="font-size:1.25rem; font-weight:900; color:${color};">${fpy}%</div>
                </div>`;
        }).join('');
    }
    lucide.createIcons();
}

function finalScrapUnit(sn) {
    if (!confirm(`⚠️ FINAL DECISION: Are you sure you want to permanently scrap unit ${sn}? This action is final and will log a financial loss.`)) return;

    const unit = units[sn];
    if (unit) {
        unit.status = "SCRAP";
        unit.history.push({
            stage: "MRB_DECISION",
            status: "FINAL_SCRAP",
            operator: currentUser.name,
            time: new Date().toLocaleString(),
            note: "Managerial write-off authorized."
        });
        pushAudit("UNIT_SCRAPPED", `Executive scrap authorization for ${sn}`);
        persistUnits();
        showToast(`Unit ${sn} has been permanently scrapped.`, "error");
        renderHeritageView(unit); // Refresh view
    }
}

// Global System Boot

// ── 1. DAILY RESET CHECK ───────────────────────────────────────────────────
function checkDailyReset() {
    const TODAY = new Date().toISOString().split('T')[0]; // e.g. "2026-04-09"
    const lastReset = localStorage.getItem('lastResetDate');

    if (lastReset && lastReset !== TODAY) {
        // ── Archive yesterday's totals before wiping ───────────────────────
        const allUnits = Object.values(units);
        const yesterdayFPY = allUnits.length > 0
            ? ((allUnits.filter(u => u.status === 'COMPLETED').length / allUnits.length) * 100).toFixed(1)
            : null;

        if (yesterdayFPY !== null) {
            const history = JSON.parse(localStorage.getItem('dailyHistory') || '[]');
            history.push({ date: lastReset, fpy: parseFloat(yesterdayFPY), total: allUnits.length });
            localStorage.setItem('dailyHistory', JSON.stringify(history.slice(-30))); // keep last 30 days
        }

        // ── Wipe current-day shift data ────────────────────────────────
        units = {};
        localStorage.removeItem('productionUnits');
        // Reset yield counters back to zeros (keep 7-slot structure)
        yieldData.inspected = [0, 0, 0, 0, 0, 0, 0];
        yieldData.passed = [0, 0, 0, 0, 0, 0, 0];
        yieldData.scrapped = [0, 0, 0, 0, 0, 0, 0];
        localStorage.removeItem('yieldData');

        // ☁️ CLOUD SYNC: Ensure Firebase is also wiped (prevent old data from syncing back)
        if (cloudActive) {
            persistUnits();
            persistYieldData();
            persistAudit();
        }

        console.log(`🌅 Daily reset triggered: ${lastReset} → ${TODAY}. Yesterday FPY archived: ${yesterdayFPY}%`);
        showToast(`🌅 New day — ${TODAY}. Yesterday’s shift data archived. Fresh slate started.`, 'info', 6000);
    }

    localStorage.setItem('lastResetDate', TODAY);
}

applyRoleRestrictions();
checkDailyReset();
initSystemCloudSync();
lucide.createIcons();
