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
let yieldData = { labels: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], inspected: [120, 150, 140, 180, 160, 90, 110], passed: [115, 142, 138, 172, 155, 88, 108], scrapped: [5, 8, 2, 8, 5, 2, 2] };
let units = {};
let manufacturingStages = [...DEFAULT_STAGES];
let usersData = [
    { id: 'u1', name: 'Sarah Mitchell', role: 'admin', accessId: 'admin', pass: 'admin123', stats: { passed: 0, scrapped: 0 } },
    { id: 'u2', name: 'Mark Robson', role: 'operator', accessId: 'operator', pass: 'operator123', stats: { passed: 0, scrapped: 0 } },
    { id: 'u3', name: 'Ismail', role: 'admin', accessId: 'ismail', pass: '123', stats: { passed: 0, scrapped: 0 } }
];
let globalAuditLog = [];

// 🏺 Persistence Handlers (CLOUD + LOCAL REDUNDANCY)
async function persistUsers() {
    localStorage.setItem('usersData', JSON.stringify(usersData));
    if (cloudActive) await db.collection('sys').doc('users').set({ data: usersData });
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
    localStorage.setItem('units', JSON.stringify(units));
    if (cloudActive) await db.collection('sys').doc('ledger').set({ data: units });
}

async function pushAudit(event, details) {
    globalAuditLog.unshift({ time: new Date().toLocaleTimeString(), op: currentUser.name, event: event, details: details });
    if (globalAuditLog.length > 50) globalAuditLog.pop();
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
        const collections = ['users', 'stages', 'analytics', 'ledger', 'audit'];
        for (const col of collections) {
            // 🛰️ REAL-TIME CLOUD HANDSHAKE (onSnapshot)
            db.collection('sys').doc(col).onSnapshot(doc => {
                if (doc.exists) {
                    const cloudData = doc.data().data;
                    if (col === 'users') usersData = cloudData;
                    if (col === 'stages') manufacturingStages = cloudData;
                    if (col === 'analytics') yieldData = cloudData;
                    if (col === 'ledger') units = cloudData;
                    if (col === 'audit') globalAuditLog = cloudData;

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
        showToast("⚠️ Cloud Connection Error - Using Local Legacy", "warning");
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
                    <button class="btn btn-outline" onclick="showTransferData()"><i data-lucide="download" style="width:18px"></i> Export Ledger</button>
                    <button class="btn btn-primary" onclick="showStageManagement()"><i data-lucide="settings" style="width:18px"></i> Manage Workflow</button>
                </div>
            </div>

            <!-- 🪐 THE BIG THREE: ACTIONABLE OVERVIEW -->
            <div class="stat-grid" style="grid-template-columns: repeat(3, 1fr); margin-bottom: 2rem;">
                <!-- LIVE FPY GAUGE -->
                <div class="card glass text-center flex flex-col items-center justify-center" style="padding: 2rem; border-bottom: 4px solid var(--success);">
                    <div style="font-size: 0.7rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.2em; margin-bottom: 1rem;">Live First-Pass Yield</div>
                    <div style="position: relative; width: 140px; height: 140px; display: flex; align-items: center; justify-content: center;">
                        <svg viewBox="0 0 100 100" style="width: 100%; transform: rotate(-90deg);">
                            <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="8"></circle>
                            <circle id="fpy-gauge-circle" cx="50" cy="50" r="45" fill="none" stroke="var(--success)" stroke-width="8" 
                                    stroke-dasharray="282.7" stroke-dashoffset="15" style="filter: drop-shadow(0 0 8px var(--success));"></circle>
                        </svg>
                        <div style="position: absolute; text-align: center;">
                            <div style="font-size: 2.5rem; font-weight: 900; line-height: 1;" id="live-fpy-val">--%</div>
                            <div class="text-muted" style="font-size: 0.6rem; font-weight: 800;">CURRENT YIELD</div>
                        </div>
                    </div>
                </div>

                <!-- SHIFT VOLUME PROGRESS -->
                <div class="card glass flex flex-col justify-between" style="padding: 2rem; border-bottom: 4px solid var(--primary);">
                    <div>
                        <div style="font-size: 0.7rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.2em; margin-bottom: 1rem;">Shift Production Progress</div>
                        <div class="flex justify-between items-end" style="margin-bottom: 1rem;">
                            <div style="font-size: 3rem; font-weight: 900; line-height: 1;"><span id="total-shift-pass">0</span><span style="font-size: 1rem; color: var(--text-muted); font-weight: 500;">/100 UNITS</span></div>
                            <div style="font-weight: 800; color: var(--primary);" id="shift-perc-label">0%</div>
                        </div>
                    </div>
                    <div class="progress-bar-container" style="width: 100%; height: 12px; background: rgba(255,255,255,0.05); border-radius: 6px; overflow: hidden;">
                        <div style="width: 0%; height: 100%; background: linear-gradient(90deg, var(--primary), var(--accent)); box-shadow: 0 0 15px var(--primary-glow);" id="shift-progress-fill"></div>
                    </div>
                </div>

                <!-- MRB STATUS ALERT -->
                <div class="card glass flex flex-col justify-between" style="padding: 2rem; border-bottom: 4px solid var(--error);">
                    <div>
                        <div style="font-size: 0.7rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.2em; margin-bottom: 1rem;">MRB Quality Inbox</div>
                        <div style="font-size: 3rem; font-weight: 900; line-height: 1; color: var(--error);" id="total-mrb-count">0</div>
                        <p class="text-muted" style="font-size: 0.8rem; margin-top: 0.5rem; font-weight: 600;">UNITS AWAITING YOUR DECISION</p>
                    </div>
                     <button class="btn btn-primary" onclick="goToMRB()" style="background: var(--error); border:none; width: 100%; justify-content: center; gap: 8px;">
                         <i data-lucide="alert-circle" style="width:16px;"></i> Action Decision Inbox
                     </button>
                </div>
            </div>

            <div class="dashboard-grid" style="grid-template-columns: 2fr 1fr;">
                <div class="card glass" style="padding:0; overflow:hidden;">
                     <div style="padding: 1.5rem; border-bottom: 1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
                        <h3 class="section-title-sm" style="margin:0;">Factory Operational Heartbeat</h3>
                        <div class="flex items-center gap-2">
                             <div class="status-dot-pulse"></div>
                             <span style="font-size: 0.65rem; font-weight: 800; color: var(--success);">LIVE STREAM ACTIVE</span>
                        </div>
                     </div>
                     <div class="table-container" style="border:none; border-radius:0; max-height: 350px;">
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
                    
                    <div class="card" style="background: linear-gradient(135deg, var(--primary), var(--accent)); border:none; text-align:center; padding: 1.5rem;">
                         <i data-lucide="zap" style="width: 24px; height: 24px; color: white; margin: 0 auto 0.75rem;"></i>
                         <h4 style="color: white; font-weight: 800; font-size: 0.9rem;">Broadcast Alert</h4>
                         <p style="color: rgba(255,255,255,0.8); font-size: 0.65rem; margin-bottom: 1rem;">Send production memo to all stations.</p>
                         <button class="btn btn-outline" style="background: white; color: var(--primary); width: 100%; justify-content: center; border:none; font-weight: 800; font-size: 0.7rem;">Open Intercom</button>
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
                    <p class="text-muted">Analyzing current shift performance vs. manual era benchmarks</p>
                </div>
            </div>

            <div class="stat-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 2rem;">
                 <div class="card glass">
                    <div class="stat-label">Projected Yield</div>
                    <div class="stat-value" style="color:var(--success)">98.8%</div>
                    <div style="font-size:0.65rem; font-weight:800; color:var(--text-muted); margin-top:0.5rem;">TARGET: 98.5% ✅</div>
                 </div>
                 <div class="card glass">
                    <div class="stat-label">Impact Gap</div>
                    <div class="stat-value" style="color:var(--primary)">+11.7%</div>
                    <div style="font-size:0.65rem; font-weight:800; color:var(--text-muted); margin-top:0.5rem;">VS 87.1% LEGACY</div>
                 </div>
                 <div class="card glass">
                    <div class="stat-label">Ave. Processing Time</div>
                    <div class="stat-value">2.4m</div>
                    <div style="font-size:0.65rem; font-weight:800; color:var(--success); margin-top:0.5rem;">↑ 54% EFFICIENCY</div>
                 </div>
                 <div class="card glass">
                    <div class="stat-label">Material Loss</div>
                    <div class="stat-value" style="color:var(--accent)">-82%</div>
                    <div style="font-size:0.65rem; font-weight:800; color:var(--text-muted); margin-top:0.5rem;">REDUCED SCRAP VOLUME</div>
                 </div>
            </div>

            <div class="dashboard-grid" style="grid-template-columns: 2fr 1fr;">
                <div class="card glass">
                    <h3 class="section-title-sm">Statistical Process Control (SPC) - 10-Unit Yield Window</h3>
                    <div style="height:300px; margin-top:1.5rem; position: relative;" id="spc-container">
                        <canvas id="spc-yield-chart"></canvas>
                        <div class="chart-loader" style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:0.6rem; color:var(--text-muted); font-weight:800; background:rgba(0,0,0,0.1); border-radius:12px;">ENGINE INITIALIZING...</div>
                    </div>
                    <div class="flex justify-between items-center" style="margin-top: 1rem; font-size: 0.65rem; font-weight: 800; color: var(--text-muted);">
                        <span>UPPER CONTROL LIMIT: <span style="color:var(--error)">99.5%</span></span>
                        <span>PROCESS MEAN: <span style="color:var(--primary)">96.2%</span></span>
                        <span>LOWER CONTROL LIMIT: <span style="color:var(--warning)">92.0%</span></span>
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

            <div class="card glass" style="margin-top: 2rem;">
                <h3 class="section-title-sm">6-Month Production Transformation (Legacy vs Digital)</h3>
                <div style="height:250px; margin-top:1.5rem; position: relative;" id="trend-container">
                    <canvas id="monthly-trend-chart"></canvas>
                    <div class="chart-loader" style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:0.6rem; color:var(--text-muted); font-weight:800; background:rgba(0,0,0,0.1); border-radius:12px;">ENGINE INITIALIZING...</div>
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
                    <div class="flex flex-wrap gap-x-8 gap-y-4 items-center" style="font-size: 0.75rem; padding-top: 1rem; border-top: 1px solid var(--border);">
                        <span class="text-muted" style="font-weight: 800;">QUICK FILTERS:</span>
                        <label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="ledger-filter" value="all" checked onchange="runLiveFilter()"> All Units</label>
                        <label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="ledger-filter" value="mrb" onchange="runLiveFilter()"><span style="color:var(--error); font-weight:800;">Pending Review (MRB)</span></label>
                        <label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="ledger-filter" value="wip" onchange="runLiveFilter()"> WIP</label>
                        <label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="ledger-filter" value="passed" onchange="runLiveFilter()"> Passed</label>
                        <label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="ledger-filter" value="scrap" onchange="runLiveFilter()"> Scrap</label>
                        <label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="ledger-filter" value="rework" onchange="runLiveFilter()"> Rework</label>
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

    const user = usersData.find(u => u.accessId === accessId && u.pass === pass && u.role === roleReq);

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

function render(templateKey, title, breadcrumb) {
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

        document.getElementById('yield-lift-val').textContent = `+${lift}%`;

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

        // ✨ Add a Simulation Trigger for Admin testing
        const header = document.querySelector('.admin-hero-header');
        if (header && !document.getElementById('sim-trigger-btn')) {
            const btn = document.createElement('button');
            btn.id = 'sim-trigger-btn';
            btn.className = 'btn btn-outline';
            btn.innerHTML = '<i data-lucide="play-circle" style="width:16px;"></i> Simulate 100-Unit Shift';
            btn.style.marginLeft = 'auto';
            btn.onclick = generateMockShiftData;
            header.appendChild(btn);
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
        renderExecutiveCharts();
    }

    lucide.createIcons();
}

/** 🚀 INTERACTIVE FACTORY STREAM (Live Shift Simulation) */
async function generateMockShiftData() {
    if (!confirm("🏭 Start Live Production Stream? This will process 100 units one-by-one to demonstrate the real-time nature of the system.")) return;

    const btn = document.getElementById('sim-trigger-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<div class="status-dot-pulse"></div> Line Active...';
    }

    showToast("📡 PRODUCTION STREAM ENGAGED: Units arriving at gates...", "info", 5000);
    const serials = Array.from({ length: 100 }, (_, i) => `A-${200 + i}`);
    const stages = manufacturingStages.sort((a, b) => a.order - b.order);

    for (const [idx, sn] of serials.entries()) {
        // Distribute: 85 Pass, 10 Scrap/MRB, 5 WIP
        let status = "COMPLETED";
        let currOrder = stages.length;

        if (idx >= 85 && idx < 95) {
            status = "MRB_REVIEW";
            currOrder = Math.floor(Math.random() * (stages.length - 1)) + 1;
        } else if (idx >= 95) {
            status = "IN_PROGRESS";
            currOrder = Math.floor(Math.random() * stages.length) + 1;
        }

        const unit = { serial: sn, status: status, currentStageOrder: currOrder, history: [], components: {} };

        for (let o = 1; o <= currOrder; o++) {
            const stage = stages.find(s => s.order === o);
            unit.history.push({
                stage: stage.name,
                status: (o === currOrder && status === "MRB_REVIEW") ? "SCRAP" : "PASS",
                operator: "System Bot",
                time: new Date().toLocaleTimeString()
            });
        }

        // ADD to ledger (Don't clear it)
        units[sn] = unit;

        // INCREMENT yield counters in real-time
        if (yieldData.inspected.length > 0) {
            const lastIdx = yieldData.inspected.length - 1;
            yieldData.inspected[lastIdx]++;
            if (status === "COMPLETED") yieldData.passed[lastIdx]++;
            if (status === "MRB_REVIEW") yieldData.scrapped[lastIdx]++;
        }

        // 🪐 CLOUD OVERHEAT PROTECTION: We push to Audit log but skip full persist per-unit to keep UI snappy
        globalAuditLog.push({
            event: status === "MRB_REVIEW" ? "UNIT_SCRAP" : "UNIT_PASS",
            details: `S/N ${sn} ${status.toLowerCase()} at final checkpoint.`,
            time: new Date().toLocaleString(),
            op: "Simulation Engine"
        });

        // 🔄 TRIGGER LIVE UI UPDATES (The "Show" part)
        updateAdminGauges();
        updateAuditFeed();
        updateStageHeatmap('stage-yield-heat-map');

        // Visual processing delay (350ms per unit)
        await new Promise(r => setTimeout(r, 350));

        // Stop if Admin navigates away
        if (!document.getElementById('sim-trigger-btn')) break;
    }

    // Final Save
    persistUnits();
    persistYieldData();
    persistAudit();
    showToast("✅ PRODUCTION STREAM COMPLETE: Shift totals synchronized.", "success");
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="play-circle" style="width:16px;"></i> Restart Stream Simulation';
        lucide.createIcons();
    }
}

/** 📊 DASHBOARD LIVE GAUGE LOGIC 🛰️ */
function updateAdminGauges() {
    const allUnits = Object.values(units);
    const shiftPass = allUnits.filter(u => u.status === 'COMPLETED').length;
    const mrbCount = allUnits.filter(u => u.status === 'MRB_REVIEW').length;
    const totalProcessed = allUnits.length;

    // Live FPY Calculation
    const fpy = totalProcessed > 0 ? ((shiftPass / 100) * 100).toFixed(1) : "0"; // Using 100 as plan target
    const fpyEl = document.getElementById('live-fpy-val');
    if (fpyEl) fpyEl.textContent = `${fpy}%`;

    const circle = document.getElementById('fpy-gauge-circle');
    if (circle) {
        // SVG circle circumference is exactly 282.7 (2 * PI * 45)
        const offset = 282.7 - (282.7 * (parseFloat(fpy) / 100));
        circle.style.strokeDashoffset = offset;
    }

    // Shift Progress
    const progressVal = Math.min(shiftPass, 100);
    const passEl = document.getElementById('total-shift-pass');
    if (passEl) passEl.textContent = shiftPass;

    const percLabel = document.getElementById('shift-perc-label');
    if (percLabel) percLabel.textContent = `${progressVal}% REACHED`;

    const fill = document.getElementById('shift-progress-fill');
    if (fill) fill.style.width = `${progressVal}%`;

    // MRB Inbox
    const mrbEl = document.getElementById('total-mrb-count');
    if (mrbEl) mrbEl.textContent = mrbCount;
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
        const fails = stageEvents.filter(e => e.status === 'SCRAP').length;
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
    // Basic summary calculation
    const allUnits = Object.values(units);
    const completed = allUnits.filter(u => u.status === 'COMPLETED').length;
    const fpy = allUnits.length > 0 ? ((completed / allUnits.length) * 100).toFixed(1) : "98.8";

    // Optional: Dynamic Gap Analysis calculation
    const gap = (parseFloat(fpy) - 87.1).toFixed(1);

    // Update labels if they exist
    const gapEl = document.querySelector('.analytics-stat-gap');
    if (gapEl) gapEl.textContent = `+${gap}%`;
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
    runLiveFilter();
}

// 👑 Admin Management
function showAnalytics() { render('analytics', 'Analytics Dashboard', 'Performance'); }
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
    const resultArea = document.getElementById('trace-result-area');

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
                                ${unit.history.slice().reverse().map(h => `<tr><td><strong>${h.stage}</strong></td><td><span class="badge ${h.status === 'PASS' ? 'badge-success' : (h.status === 'SCRAP' || h.status === 'FAIL' ? 'badge-error' : 'badge-warning')}">${h.status}</span></td><td>${h.operator}</td><td class="text-muted">${h.time}</td></tr>`).join('')}
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
    container.innerHTML = `
        <div class="card glass animate-up" style="padding:0; overflow:hidden;">
            <div class="table-container" style="border:none;">
                <table>
                    <thead>
                        <tr><th>SERIAL / ID</th><th>LAST KNOWN STAGE</th><th>LIVE STATUS</th><th>LAST EVENT</th><th>HERITAGE</th></tr>
                    </thead>
                    <tbody>
                        ${filteredUnits.map(u => `
                            <tr>
                                <td style="font-family:monospace; font-weight:800;">${u.serial}</td>
                                <td><span style="font-size:0.75rem; font-weight:800;">${u.history.length > 0 ? u.history[u.history.length - 1].stage : '--'}</span></td>
                                <td>
                                    <span class="badge ${u.status === 'COMPLETED' ? 'badge-success' : (u.status === 'MRB_REVIEW' ? 'badge-error' : 'badge-warning')}">
                                        ${u.status.replace('_', ' ')}
                                    </span>
                                </td>
                                <td class="text-muted" style="font-size:0.65rem;">${u.history.length > 0 ? u.history[u.history.length - 1].time : '--'}</td>
                                <td><button class="btn btn-outline" style="font-size:0.65rem; padding: 4px 10px;" onclick="document.getElementById('search-serial').value='${u.serial}'; searchUnit();">View Full Trace</button></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
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

        showToast(`Unit ${sn} has been returned to Stage ${unit.currentStageOrder}.`, "warning");
        searchUnit(); // Refresh view
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

function saveNewUser(e) {
    e.preventDefault();
    const newUser = {
        id: 'u_' + Date.now(),
        name: document.getElementById('new-user-name').value,
        accessId: document.getElementById('new-user-id').value,
        pass: document.getElementById('new-user-pass').value,
        role: document.getElementById('new-user-role').value,
        stats: { passed: 0, scrapped: 0 }
    };
    usersData.push(newUser);
    persistUsers();
    closeUserModal();
    populateUserList();
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
    console.log("📊 Chart System: Booting Executive Visuals...");

    // ⚡ Resilience Delay: Ensure canvas is in DOM
    setTimeout(() => {
        try {
            if (typeof Chart === 'undefined') {
                showToast("Chart Engine missing. Refreshing library connection...", "warning");
                return;
            }

            // Remove loaders
            document.querySelectorAll('.chart-loader').forEach(l => l.style.display = 'none');

            // 1. SPC Chart
            const spcCtx = document.getElementById('spc-yield-chart');
            if (spcCtx) {
                new Chart(spcCtx, {
                    type: 'line',
                    data: {
                        labels: ['10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30', '11:45', '12:00', '12:15'],
                        datasets: [{
                            label: 'Live Yield %',
                            data: [96.5, 97.2, 95.8, 92.4, 98.1, 96.6, 95.2, 97.8, 98.5, 96.2],
                            borderColor: '#10b981',
                            backgroundColor: 'rgba(16, 185, 129, 0.1)',
                            tension: 0.4,
                            fill: true,
                            pointRadius: 4,
                            pointBackgroundColor: '#10b981'
                        }, {
                            label: 'LCL (Warning)',
                            data: Array(10).fill(92.0),
                            borderColor: 'rgba(239, 68, 68, 0.4)',
                            borderDash: [5, 5],
                            pointStyle: false,
                            fill: false
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: {
                            y: { min: 85, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255,255,255,0.4)' } },
                            x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.4)' } }
                        }
                    }
                });
                console.log("✅ SPC Chart Rendered.");
            }

            // 2. Monthly Trend Chart
            const trendCtx = document.getElementById('monthly-trend-chart');
            if (trendCtx) {
                new Chart(trendCtx, {
                    type: 'bar',
                    data: {
                        labels: ["Oct '25", "Nov '25", "Dec '25", "Jan '26", "Feb '26", "Mar '26", "Current (Digital)"],
                        datasets: [{
                            label: 'Legacy Manual Yield %',
                            data: [84.2, 85.5, 87.1, 88.4, 86.8, 90.2, null],
                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                            borderRadius: 4
                        }, {
                            label: 'Digital System Yield %',
                            data: [null, null, null, null, null, null, 98.8],
                            backgroundColor: '#8b5cf6',
                            borderRadius: 4
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { position: 'bottom', labels: { color: 'white', font: { size: 10 } } } },
                        scales: {
                            y: { min: 80, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255,255,255,0.4)' } },
                            x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.4)' } }
                        }
                    }
                });
                console.log("✅ Trend Chart Rendered.");
            }
        } catch (err) {
            console.error("❌ Chart Execution Error:", err);
        }
    }, 150);

    // 3. Bottleneck Analysis Logic (Immediate)
    const list = document.getElementById('bottleneck-action-list');
    if (list) {
        const bottlenecks = manufacturingStages.filter(s => {
            const data = yieldData[s.id] || { ins: 0, pass: 0 };
            const yieldVal = data.ins === 0 ? 100 : (data.pass / data.ins * 100);
            return yieldVal < 92;
        });

        if (bottlenecks.length === 0) {
            list.innerHTML = `<div class="text-center py-8" style="border: 1px dashed rgba(255,255,255,0.1); border-radius: 12px;"><i data-lucide="check-circle-2" style="width:32px; height:32px; color:var(--success); margin: 0 auto 0.5rem; opacity:0.5;"></i><p class="text-muted" style="font-size:0.7rem;">All stations performing within safety benchmarks.</p></div>`;
            lucide.createIcons();
        } else {
            list.innerHTML = bottlenecks.map(s => {
                const data = yieldData[s.id];
                const yieldVal = (data.pass / data.ins * 100).toFixed(1);
                return `
                    <div style="background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.2); border-radius:12px; padding: 1rem; display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <div style="font-weight:800; font-size:0.85rem; color:var(--error); margin-bottom:0.2rem;">${s.name}</div>
                            <div style="font-size:0.65rem; color:var(--text-muted); font-weight:600;">⚠️ ${data.ins - data.pass} REJECTIONS</div>
                        </div>
                        <div style="text-align:right;"><div style="font-size: 1.25rem; font-weight: 900; color: var(--error);">${yieldVal}%</div></div>
                    </div>`;
            }).join('');
        }
    }
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
applyRoleRestrictions();
initSystemCloudSync();
lucide.createIcons();
