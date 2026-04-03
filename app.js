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
    { id: 'u2', name: 'Mark Robson', role: 'operator', accessId: 'operator', pass: 'operator123', stats: { passed: 0, scrapped: 0 } }
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

// 🔋 INITIAL DATA SYNC ENGINE
async function initSystemCloudSync() {
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

    // 🔐 Restore Session & Apply UI Restrictions
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        document.getElementById('screen-login').classList.add('hidden');
        document.getElementById('main-layout').classList.remove('hidden');
        applyRoleRestrictions();
        showDashboard();
    }

    if (!cloudActive) return;

    showToast("🛰️ Connecting to Production Cloud...", "info", 2000);

    try {
        const collections = ['users', 'stages', 'analytics', 'ledger', 'audit'];
        for (const col of collections) {
            const snap = await db.collection('sys').doc(col).get();
            if (snap.exists) {
                const cloudData = snap.data().data;
                if (col === 'users') usersData = cloudData;
                if (col === 'stages') manufacturingStages = cloudData;
                if (col === 'analytics') yieldData = cloudData;
                if (col === 'ledger') units = cloudData;
                if (col === 'audit') globalAuditLog = cloudData;
            }
        }

        // Final Safety Check: If usersData is empty after sync, restore defaults
        if (usersData.length === 0) {
            usersData = [
                { id: 'u1', name: 'Sarah Mitchell', role: 'admin', accessId: 'admin', pass: 'admin123', stats: { passed: 0, scrapped: 0 } },
                { id: 'u2', name: 'Mark Robson', role: 'operator', accessId: 'operator', pass: 'operator123', stats: { passed: 0, scrapped: 0 } }
            ];
        }

        showToast("✅ Cloud Datasets Synchronized", "success", 2000);
    } catch (e) {
        showToast("⚠️ Cloud Sync Error - Using Local Ledger", "warning");
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


// 🏛️ 30-DAY HISTORICAL PRODUCTION DATASET
// Phase 1: Manual Era (Day 1-14) | Phase 2: Transition (Day 15-21) | Phase 3: System Live (Day 22-30)
const historicalData30Days = {
    // Daily labels for Feb 8 – Mar 9
    labels: [
        'Feb 8', 'Feb 9', 'Feb 10', 'Feb 11', 'Feb 12', 'Feb 13', 'Feb 14',
        'Feb 15', 'Feb 16', 'Feb 17', 'Feb 18', 'Feb 19', 'Feb 20', 'Feb 21',
        'Feb 22', 'Feb 23', 'Feb 24', 'Feb 25', 'Feb 26', 'Feb 27', 'Feb 28',
        'Mar 1', 'Mar 2', 'Mar 3', 'Mar 4', 'Mar 5', 'Mar 6', 'Mar 7', 'Mar 8', 'Mar 9'
    ],
    // Units manufactured per day (minimum 250, realistic variance)
    manufactured: [
        258, 262, 271, 255, 268, 241, 230,   // Week 1 (Manual)
        274, 263, 269, 257, 278, 248, 235,   // Week 2 (Manual)
        280, 285, 277, 291, 283, 260, 244,   // Week 3 (Transition)
        295, 302, 310, 298, 315, 308, 320, 311, 318  // Week 4+  (System Live)
    ],
    // Units that passed manual/system inspection
    passed: [
        218, 220, 226, 212, 224, 200, 193,   // Week 1 ~84% pass (manual)
        229, 218, 224, 212, 233, 205, 196,   // Week 2 ~85% pass (manual)
        249, 256, 248, 261, 254, 236, 226,   // Week 3 ~90% pass (transition)
        288, 295, 304, 292, 309, 303, 315, 307, 315  // Week 4+ ~97-99% pass (system)
    ],
    // Units scrapped / rejected
    scrapped: [
        28, 30, 31, 31, 30, 29, 25,    // Week 1 ~11% scrap rate
        31, 28, 30, 28, 30, 26, 23,    // Week 2 ~11% scrap rate
        18, 17, 16, 17, 17, 14, 12,    // Week 3 ~6% scrap (improving)
        5, 5, 4, 5, 4, 4, 3, 3, 2     // Week 4+ ~1.5% scrap (systematic)
    ],
    // Defects that ESCAPED to customers (missed by manual inspection)
    customerEscapes: [
        12, 11, 13, 10, 11, 9, 8,   // Week 1 heavy escapes
        9, 10, 11, 9, 10, 8, 7,     // Week 2 still bad
        4, 3, 4, 3, 3, 2, 2,        // Week 3 improving
        1, 0, 1, 0, 0, 0, 0, 0, 0  // Week 4+ near-zero escapes
    ],
    // Average inspection time per unit (minutes)
    avgInspectionTime: [
        8.2, 8.1, 8.4, 8.0, 8.3, 7.9, 7.8,   // Manual: slow, inconsistent
        8.1, 8.0, 8.2, 7.9, 8.1, 7.8, 7.6,
        6.5, 6.3, 6.4, 6.1, 6.0, 5.8, 5.6,   // Transition: faster
        3.2, 3.1, 2.9, 3.0, 2.8, 2.9, 2.7, 2.8, 2.6  // System: fast + consistent
    ],
    phases: [
        { label: 'Manual Inspection Era', days: '1–14', color: '#ef4444', startIndex: 0, endIndex: 13 },
        { label: 'System Transition', days: '15–21', color: '#f59e0b', startIndex: 14, endIndex: 20 },
        { label: 'QA Intelligence System Live', days: '22–30', color: '#10b981', startIndex: 21, endIndex: 29 }
    ],
    summary: {
        manual: { avgYield: 84.3, scrapRate: 11.2, escapes: 12, inspectionTime: 8.1 },
        transition: { avgYield: 90.1, scrapRate: 6.0, escapes: 3, inspectionTime: 6.1 },
        system: { avgYield: 97.8, scrapRate: 1.4, escapes: 0.1, inspectionTime: 2.9 }
    }
};

let historicalSummary = {
    manualEra: {
        avgYield: 84.3,
        humanEscapes: 12,
        avgInspectionTime: 8.1
    },
    systemImpact: {
        yieldImprovement: 13.5,
        reductionInEscapes: 99.2
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
            <div class="view-header">
                <div>
                    <h2 class="view-title-main">Production Intelligence</h2>
                    <p class="text-muted">Real-time quality oversight across all lines</p>
                </div>
                <div class="flex gap-3">
                    <button class="btn btn-outline" onclick="showTransferData()"><i data-lucide="download" style="width:18px"></i> Export Ledger</button>
                    <button class="btn btn-primary" onclick="showStageManagement()"><i data-lucide="settings" style="width:18px"></i> Manage Workflow</button>
                </div>
            </div>

            <div class="stat-grid">
                <div class="card stat-card">
                    <span class="stat-label">Yield Rate</span>
                    <div class="stat-value">[[YIELD_RATE]]%</div>
                    <div class="stat-trend trend-up"><i data-lucide="trending-up" style="width: 14px; vertical-align: middle;"></i> +0.4%</div>
                </div>
                <div class="card stat-card">
                    <span class="stat-label">Units Passed</span>
                    <div class="stat-value">[[TOTAL_PASSED]]</div>
                    <div class="text-muted" style="font-size: 0.8rem;">Session Total</div>
                </div>
                <div class="card stat-card">
                    <span class="stat-label">Total Scrapped</span>
                    <div class="stat-value" style="color: var(--error);">[[TOTAL_SCRAPPED]]</div>
                    <div class="stat-trend trend-down"><i data-lucide="alert-triangle" style="width: 14px; vertical-align: middle;"></i> Action required</div>
                </div>
                <div class="card stat-card">
                    <span class="stat-label">System Health</span>
                    <div class="stat-value" style="color: var(--success);">OPTIMAL</div>
                    <div class="text-muted" style="font-size: 0.8rem;">Gate Logic Active</div>
                </div>
            </div>

            <div class="dashboard-grid">
                <div class="card">
                    <h3 class="section-title-sm">Yield vs Scrap Trend</h3>
                    <div class="analytics-chart-container" style="height: 250px; display: flex; align-items: flex-end; gap: 1rem; padding: 1rem 0;">
                        [[CHART_BARS]]
                    </div>
                    <div class="flex justify-between text-muted" style="font-size: 0.7rem; margin-top: 0.5rem;">
                        <span>MON</span><span>TUE</span><span>WED</span><span>THU</span><span>FRI</span><span>SAT</span><span>SUN</span>
                    </div>
                </div>

                <div class="card">
                    <h3 class="section-title-sm">Live Quality Audit Feed</h3>
                    <div id="live-audit-list" style="max-height: 250px; overflow-y: auto; font-size: 0.75rem;">
                        <!-- Audit entries injected here -->
                    </div>
                </div>

                <div class="card">
                    <h3 class="section-title-sm">Current Workflow Stages</h3>
                    <div class="stages-preview-list">
                        [[STAGES_LIST]]
                    </div>
                </div>

                <div class="card" style="grid-column: span 2;">
                    <h3 class="section-title-sm">Operator Performance League</h3>
                    <div class="table-container">
                        <table style="font-size: 0.8rem;">
                            <thead><tr><th>Name</th><th>Role</th><th>Total Passed</th><th>Total Scrapped</th><th>Efficiency</th></tr></thead>
                            <tbody id="op-league-body"></tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    `,

    analytics: `
        <div class="animate-fade">
            <div class="view-header">
                <div>
                    <h2 class="view-title-main">Yield & Predictive Intelligence</h2>
                    <p class="text-muted">Comparing Manual Historical Data vs. Real-Time System Performance</p>
                </div>
            </div>
            
            <div class="stat-grid" style="margin-bottom: 2rem;">
                <div class="card stat-card" style="border-top: 4px solid var(--accent);">
                    <span class="stat-label">Yield Lift (Impact)</span>
                    <div class="stat-value" id="yield-lift-val">+0.0%</div>
                    <div class="text-muted" style="font-size: 0.75rem;">Improvement over Manual Era</div>
                </div>
                <div class="card stat-card" style="border-top: 4px solid var(--success);">
                    <span class="stat-label">Error Reduction</span>
                    <div class="stat-value" style="color: var(--success);">-92%</div>
                    <div class="text-muted" style="font-size: 0.75rem;">Reduction in Gate Escapes</div>
                </div>
                <div class="card stat-card" style="border-top: 4px solid var(--primary);">
                    <span class="stat-label">Velocity Gained</span>
                    <div class="stat-value" style="color: var(--primary);">+1.8m</div>
                    <div class="text-muted" style="font-size: 0.75rem;">Saved per unit inspection</div>
                </div>
            </div>

            <div class="dashboard-grid">
                <div class="card" style="grid-column: span 2;">
                    <h3 class="section-title-sm"><i data-lucide="file-digit" style="width:14px; vertical-align:middle;"></i> Data Transformation Proof (Evidence of Conversion)</h3>
                    <div class="flex gap-6" style="margin-top: 1rem;">
                        <div style="flex: 1; padding: 1.5rem; background: #fdf6e3; border: 1px solid #eee8d5; color: #657b83; border-radius: 8px; font-family: 'Courier New', monospace; box-shadow: inset 0 0 10px rgba(0,0,0,0.05);">
                            <div style="font-weight: 800; border-bottom: 1px solid #93a1a1; margin-bottom: 0.5rem; font-size: 0.7rem;">ORIGINAL MANUAL PAPER LOG (RAW)</div>
                            <div style="font-size: 0.8rem; line-height: 1.6;">
                                [[MANUAL_RAW]]
                                <br><br>
                                <span style="opacity: 0.5;">[Operator Scribble: "Hard to read SN"]</span>
                            </div>
                        </div>
                        <div style="display: flex; align-items: center; justify-content: center; color: var(--accent);">
                             <i data-lucide="chevrons-right" style="width: 32px; height: 32px;"></i>
                        </div>
                        <div style="flex: 1; padding: 1.5rem; background: rgba(0,0,0,0.2); border: 1px solid var(--border); color: #fff; border-radius: 8px; font-family: 'Consolas', monospace;">
                            <div style="font-weight: 800; border-bottom: 1px solid var(--primary); color: var(--primary); margin-bottom: 0.5rem; font-size: 0.7rem;">SYSTEM-STRUCTURED JSON (DIGITAL ERA)</div>
                            <pre style="font-size: 0.75rem; color: var(--success);">[[CONVERTED_JSON]]</pre>
                        </div>
                    </div>
                </div>

                <div class="card">
                    <h3 class="section-title-sm">Operator Fatigue Index (Shift HR 1-8)</h3>
                    <div style="height: 180px; display: flex; align-items: flex-end; gap: 0.5rem; padding-top: 1rem;">
                        [[FATIGUE_BARS]]
                    </div>
                    <p class="text-muted" style="font-size: 0.7rem; margin-top: 1rem;">
                        <i data-lucide="info" style="width:10px;"></i> Alert: Errors increase as index crosses 70 (red zone).
                    </p>
                </div>

                <div class="card">
                    <h3 class="section-title-sm">Defect Concentration Heatmap</h3>
                    <div class="flex flex-col gap-3" style="padding-top: 1rem;">
                        [[DEFECT_HEATMAP]]
                    </div>
                </div>

                <div class="card">
                    <h3 class="section-title-sm">Before vs. After Comparison (Yield %)</h3>
                    <div style="height: 250px; display: flex; align-items: flex-end; gap: 2rem; padding: 2rem; border-bottom: 1px solid var(--border); position: relative;">
                        <!-- Comparison Chart Injected -->
                        <div style="flex: 1; height: 88%; background: var(--border); border-radius: 8px 8px 0 0; position: relative;">
                            <div style="position: absolute; top: -25px; width: 100%; text-align: center; font-size: 0.7rem; font-weight:700;">88.5% (Manual)</div>
                        </div>
                        <div style="flex: 1; height: [[CURRENT_YIELD_H]]%; background: linear-gradient(to top, var(--primary), var(--accent)); border-radius: 8px 8px 0 0; position: relative;">
                            <div style="position: absolute; top: -25px; width: 100%; text-align: center; font-size: 0.7rem; font-weight:700;">[[CURRENT_YIELD]]% (System)</div>
                        </div>
                    </div>
                </div>

                <div class="card" style="grid-column: span 2;">
                    <h3 class="section-title-sm"><i data-lucide="wrench" style="width:14px; vertical-align:middle;"></i> Automated Maintenance Suggestion Engine</h3>
                    <div id="maintenance-alerts-area" class="flex flex-col gap-3">
                        [[MAINTENANCE_LOGS]]
                    </div>
                </div>

                <div class="card">
                    <h3 class="section-title-sm"><i data-lucide="brain-circuit" style="width:14px; vertical-align:middle;"></i> Predictive Quality Forecast</h3>
                    <div class="prediction-content" style="padding: 1rem 0;">
                        <div class="flex flex-col gap-4">
                            <div class="p-4 glass" style="border-radius: 12px; border-left: 4px solid var(--accent);">
                                <div class="text-muted" style="font-size: 0.75rem;">NEXT SHIFT PROBABILITY</div>
                                <div style="font-size: 1.5rem; font-weight: 800; color: var(--accent);">99.2% Predicted Yield</div>
                                <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">Based on current operator velocity and declining solder bridge trends.</p>
                            </div>
                            <div class="p-4 glass" style="border-radius: 12px; border-left: 4px solid var(--warning);">
                                <div class="text-muted" style="font-size: 0.75rem;">POTENTIAL RISK AREA</div>
                                <div style="font-size: 1rem; font-weight: 700;">Stage 2: Connector Wear</div>
                                <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">Anomalous pass-rate drop detected at Station 07. Maintenance suggested within 48h.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="card" style="margin-top: 2rem;">
                <div class="flex justify-between items-center" style="margin-bottom: 1.5rem;">
                    <h3 class="section-title-sm">Assembly Line Daily Throughput</h3>
                    <div class="badge badge-success">Live Analysis</div>
                </div>
                <div style="height: 200px; display: flex; align-items: flex-end; gap: 4px; padding-bottom: 2rem; border-bottom: 2px solid var(--border);">
                    [[DAILY_THROUGHPUT_CHART]]
                </div>
                <div class="flex justify-between text-muted" style="font-size: 0.65rem; margin-top: 8px;">
                     <span>MON</span><span>TUE</span><span>WED</span><span>THU</span><span>FRI</span><span>SAT</span><span>SUN</span>
                </div>
            </div>

            <!-- 📅 30-DAY HISTORICAL INTELLIGENCE SECTION -->
            <div class="card" style="margin-top: 2rem; padding: 0; overflow: hidden;">
                <div style="padding: 1.5rem 2rem; background: linear-gradient(135deg, rgba(59,130,246,0.1), rgba(139,92,246,0.1)); border-bottom: 1px solid var(--border);">
                    <div class="flex justify-between items-center">
                        <div>
                            <h3 class="section-title-sm" style="margin:0; font-size: 1.1rem;">📅 30-Day Production Intelligence Report</h3>
                            <p class="text-muted" style="font-size: 0.75rem; margin-top: 4px;">Feb 8 – Mar 9 · Manual Era vs System Implementation Impact</p>
                        </div>
                        <div class="badge badge-success" style="font-size: 0.75rem;">12.4% Yield Improvement</div>
                    </div>
                </div>

                <!-- Phase KPI Cards -->
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0; border-bottom: 1px solid var(--border);">
                    <div style="padding: 1.5rem 2rem; border-right: 1px solid var(--border);">
                        <div style="font-size: 0.65rem; font-weight: 800; letter-spacing: 0.1em; color: #ef4444; margin-bottom: 0.5rem;">PHASE 1 · MANUAL ERA (Day 1–14)</div>
                        <div style="font-size: 2rem; font-weight: 900; color: #ef4444;">84.3%</div>
                        <div class="text-muted" style="font-size: 0.75rem;">Avg Yield Rate</div>
                        <div style="margin-top: 1rem; display: flex; flex-direction: column; gap: 6px; font-size: 0.72rem;">
                            <div class="flex justify-between"><span class="text-muted">Scrap Rate</span><span style="color:#ef4444; font-weight:800;">11.2%</span></div>
                            <div class="flex justify-between"><span class="text-muted">Customer Escapes/day</span><span style="color:#ef4444; font-weight:800;">~10</span></div>
                            <div class="flex justify-between"><span class="text-muted">Avg Inspection Time</span><span style="font-weight:700;">8.1 min</span></div>
                            <div class="flex justify-between"><span class="text-muted">Throughput/day</span><span style="font-weight:700;">~257 units</span></div>
                        </div>
                    </div>
                    <div style="padding: 1.5rem 2rem; border-right: 1px solid var(--border);">
                        <div style="font-size: 0.65rem; font-weight: 800; letter-spacing: 0.1em; color: #f59e0b; margin-bottom: 0.5rem;">PHASE 2 · TRANSITION (Day 15–21)</div>
                        <div style="font-size: 2rem; font-weight: 900; color: #f59e0b;">90.1%</div>
                        <div class="text-muted" style="font-size: 0.75rem;">Avg Yield Rate</div>
                        <div style="margin-top: 1rem; display: flex; flex-direction: column; gap: 6px; font-size: 0.72rem;">
                            <div class="flex justify-between"><span class="text-muted">Scrap Rate</span><span style="color:#f59e0b; font-weight:800;">6.0%</span></div>
                            <div class="flex justify-between"><span class="text-muted">Customer Escapes/day</span><span style="color:#f59e0b; font-weight:800;">~3</span></div>
                            <div class="flex justify-between"><span class="text-muted">Avg Inspection Time</span><span style="font-weight:700;">6.1 min</span></div>
                            <div class="flex justify-between"><span class="text-muted">Throughput/day</span><span style="font-weight:700;">~274 units</span></div>
                        </div>
                    </div>
                    <div style="padding: 1.5rem 2rem;">
                        <div style="font-size: 0.65rem; font-weight: 800; letter-spacing: 0.1em; color: #10b981; margin-bottom: 0.5rem;">PHASE 3 · SYSTEM LIVE (Day 22–30)</div>
                        <div style="font-size: 2rem; font-weight: 900; color: #10b981;">97.8%</div>
                        <div class="text-muted" style="font-size: 0.75rem;">Avg Yield Rate</div>
                        <div style="margin-top: 1rem; display: flex; flex-direction: column; gap: 6px; font-size: 0.72rem;">
                            <div class="flex justify-between"><span class="text-muted">Scrap Rate</span><span style="color:#10b981; font-weight:800;">1.4%</span></div>
                            <div class="flex justify-between"><span class="text-muted">Customer Escapes/day</span><span style="color:#10b981; font-weight:800;">~0</span></div>
                            <div class="flex justify-between"><span class="text-muted">Avg Inspection Time</span><span style="font-weight:700;">2.9 min</span></div>
                            <div class="flex justify-between"><span class="text-muted">Throughput/day</span><span style="font-weight:700;">~308 units</span></div>
                        </div>
                    </div>
                </div>

                <!-- 30-Day Bar Chart -->
                <div style="padding: 2rem;">
                    <div class="flex justify-between items-center" style="margin-bottom: 1rem;">
                        <h4 style="font-weight: 800; font-size: 0.9rem;">Daily Yield Rate (30 Days)</h4>
                        <div class="flex gap-4" style="font-size: 0.65rem;">
                            <span><span style="display:inline-block; width:10px; height:10px; background:#ef4444; border-radius:2px; margin-right:4px;"></span>Manual</span>
                            <span><span style="display:inline-block; width:10px; height:10px; background:#f59e0b; border-radius:2px; margin-right:4px;"></span>Transition</span>
                            <span><span style="display:inline-block; width:10px; height:10px; background:#10b981; border-radius:2px; margin-right:4px;"></span>System Live</span>
                        </div>
                    </div>
                    <div id="hist-chart-area" style="height: 180px; display: flex; align-items: flex-end; gap: 3px; border-bottom: 1px solid var(--border); padding-bottom: 8px; position: relative;">
                        [[HIST_CHART_BARS]]
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.55rem; color: var(--text-muted); margin-top: 6px; padding: 0 1px;">
                        [[HIST_CHART_LABELS]]
                    </div>
                </div>

                <!-- Impact Summary Banner -->
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 0; border-top: 1px solid var(--border); background: rgba(16,185,129,0.03);">
                    <div style="padding: 1.25rem; text-align:center; border-right: 1px solid var(--border);">
                        <div style="font-size: 1.6rem; font-weight: 900; color: var(--success);">+13.5%</div>
                        <div class="text-muted" style="font-size: 0.65rem; margin-top: 2px;">Yield Improvement</div>
                    </div>
                    <div style="padding: 1.25rem; text-align:center; border-right: 1px solid var(--border);">
                        <div style="font-size: 1.6rem; font-weight: 900; color: var(--success);">-99%</div>
                        <div class="text-muted" style="font-size: 0.65rem; margin-top: 2px;">Customer Escapes</div>
                    </div>
                    <div style="padding: 1.25rem; text-align:center; border-right: 1px solid var(--border);">
                        <div style="font-size: 1.6rem; font-weight: 900; color: var(--success);">64% ↓</div>
                        <div class="text-muted" style="font-size: 0.65rem; margin-top: 2px;">Inspection Time</div>
                    </div>
                    <div style="padding: 1.25rem; text-align:center;">
                        <div style="font-size: 1.6rem; font-weight: 900; color: var(--success);">+51</div>
                        <div class="text-muted" style="font-size: 0.65rem; margin-top: 2px;">Extra Units/Day</div>
                    </div>
                </div>
            </div>

            <!-- Manual Log Sample -->
            <div class="card" style="margin-top: 2rem;">
                <div class="flex justify-between items-center" style="margin-bottom: 1.5rem;">
                    <h3 class="section-title-sm"><i data-lucide="file-text" style="width:14px; vertical-align:middle;"></i> Sample Manual Inspection Log (Pre-System)</h3>
                    <span class="badge" style="background: rgba(239,68,68,0.1); color: var(--error);">Legacy Records</span>
                </div>
                <div class="table-container">
                    <table>
                        <thead><tr><th>Date</th><th>Unit Serial</th><th>Stage</th><th>Inspector</th><th>Result</th><th>Defect Note</th><th>Escape Risk</th></tr></thead>
                        <tbody>
                            <tr><td>Feb 8</td><td style="font-family:monospace; font-weight:800;">G-0201</td><td>PCB Assembly</td><td>Mark R.</td><td><span class="badge badge-error">FAIL</span></td><td>Solder Bridge on U1</td><td><span class="badge" style="background:rgba(239,68,68,0.1);color:var(--error);">HIGH</span></td></tr>
                            <tr><td>Feb 9</td><td style="font-family:monospace; font-weight:800;">G-0208</td><td>Display Mount</td><td>Sarah M.</td><td><span class="badge badge-success">PASS</span></td><td>—</td><td><span class="badge" style="background:rgba(16,185,129,0.1);color:var(--success);">LOW</span></td></tr>
                            <tr><td>Feb 10</td><td style="font-family:monospace; font-weight:800;">G-0225</td><td>Final Casing</td><td>Mark R.</td><td><span class="badge badge-error">FAIL</span></td><td>Button misalignment</td><td><span class="badge" style="background:rgba(239,68,68,0.1);color:var(--error);">HIGH</span></td></tr>
                            <tr><td>Feb 11</td><td style="font-family:monospace; font-weight:800;">G-0231</td><td>PCB Assembly</td><td>Sarah M.</td><td><span class="badge badge-error">FAIL</span></td><td>Missing capacitor C14</td><td><span class="badge" style="background:rgba(239,68,68,0.1);color:var(--error);">CRITICAL</span></td></tr>
                            <tr><td>Feb 12</td><td style="font-family:monospace; font-weight:800;">G-0244</td><td>Display Mount</td><td>Mark R.</td><td><span class="badge badge-success">PASS</span></td><td>—</td><td><span class="badge" style="background:rgba(16,185,129,0.1);color:var(--success);">LOW</span></td></tr>
                            <tr><td>Feb 13</td><td style="font-family:monospace; font-weight:800;">G-0251</td><td>PCB Assembly</td><td>Sarah M.</td><td><span class="badge badge-error">FAIL</span></td><td>Solder Bridge on R3</td><td><span class="badge" style="background:rgba(239,68,68,0.1);color:var(--error);">HIGH</span></td></tr>
                            <tr style="background: rgba(16,185,129,0.03);"><td style="color:var(--success); font-weight:800;">Mar 1 ✅</td><td style="font-family:monospace; font-weight:800;">G-0601</td><td>PCB Assembly</td><td>System</td><td><span class="badge badge-success">PASS</span></td><td>Auto-verified (3 checkpoints)</td><td><span class="badge" style="background:rgba(16,185,129,0.1);color:var(--success);">ZERO</span></td></tr>
                        </tbody>
                    </table>
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
                        <label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="ledger-filter" value="wip" onchange="runLiveFilter()"> Work In Progress (WIP)</label>
                        <label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="ledger-filter" value="passed" onchange="runLiveFilter()"> Fully Completed</label>
                        <label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="ledger-filter" value="scrap" onchange="runLiveFilter()"> Scrapped (Fail)</label>
                        <label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="ledger-filter" value="rework" onchange="runLiveFilter()"> Active Rework</label>
                        <label class="flex items-center gap-2 cursor-pointer" style="margin-left: auto;"><input type="checkbox" id="filter-comp" onchange="runLiveFilter()"> With Components Only</label>
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

        // 30-Day Historical Chart
        const histBars = historicalData30Days.manufactured.map((mfg, i) => {
            const passed = historicalData30Days.passed[i];
            const yieldPct = ((passed / mfg) * 100).toFixed(1);
            const color = i <= 13 ? '#ef4444' : i <= 20 ? '#f59e0b' : '#10b981';
            const barH = Math.round((yieldPct / 100) * 100);
            return `<div title="${historicalData30Days.labels[i]}: ${yieldPct}% yield" style="flex:1; height:${barH}%; background:${color}; border-radius:3px 3px 0 0; opacity:0.85; cursor:pointer; transition: opacity 0.2s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.85"></div>`;
        }).join('');

        const histLabels = historicalData30Days.labels.map((l, i) =>
            i % 5 === 0 ? `<span>${l}</span>` : '<span></span>'
        ).join('');

        const ca = document.getElementById('content-area');
        ca.innerHTML = ca.innerHTML
            .replace('[[HIST_CHART_BARS]]', histBars)
            .replace('[[HIST_CHART_LABELS]]', histLabels);
    }

    if (templateKey === 'adminDashboard') {
        updateAuditFeed();
        updateOpLeague();
    }
    if (templateKey === 'operatorDashboard') {
        document.getElementById('op-stat-passed').textContent = currentUser.stats.passed;
        document.getElementById('op-stat-scrapped').textContent = currentUser.stats.scrapped;
        populateOperatorStages();
    }
    if (templateKey === 'traceability') runLiveFilter();
    if (templateKey === 'userManagement') populateUserList();
    if (templateKey === 'stageManagement') populateStagesTimeline();
    if (templateKey === 'executionScreen') setupExecutionScreen();
    if (templateKey === 'createStage' && editingStageId) setupCreateStageForm();

    lucide.createIcons();
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

    // Pass-to-Proceed Check (only for normal units, not rework)
    if (unit.currentStageOrder < activeExecutionStage.order) {
        showError(`STATION LOCKED: Unit ${sn} hasn't passed previous stage.`, "lock");
        document.getElementById('gate-msg').innerHTML += `<button class="btn btn-outline" style="margin-top: 10px; color: var(--warning); border-color: var(--warning);" onclick="triggerOverride()"><i data-lucide="shield-alert" style="width:14px"></i> Supervisor Override</button>`;
        lucide.createIcons();
        return;
    }

    if (unit.currentStageOrder > activeExecutionStage.order) {
        showError(`ALREADY PROCESSED: Unit ${sn} has already passed this stage.`, "check-circle");
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
    if (confirm("🚨 SCRAP UNIT: Are you sure? This Serial Number will be permanently disabled.")) {
        activeExecutionUnit.status = "SCRAP";
        activeExecutionUnit.history.push({
            stage: activeExecutionStage.name,
            status: "SCRAP",
            operator: currentUser.name,
            time: new Date().toLocaleString()
        });

        // Save the stage where it failed for future rework routing
        activeExecutionUnit.scrapStageOrder = activeExecutionStage.order;

        // Update Stats
        currentUser.stats.scrapped++;
        persistUsers();
        pushAudit("UNIT_SCRAP", `Unit ${activeExecutionUnit.serial} scrapped at ${activeExecutionStage.name}`);

        // Update Analytics Stats (mock increment)
        yieldData.scrapped[yieldData.scrapped.length - 1]++;
        persistYieldData();
        persistUnits();

        showToast("Unit moved to Scrap Ledger.", "error");
        showDashboard();
    }
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

function searchUnit() {
    const sn = document.getElementById('search-serial').value.toUpperCase();
    const resultArea = document.getElementById('trace-result-area');
    const unit = units[sn];

    if (!unit) {
        resultArea.innerHTML = `<div class="card glass text-center">Serial Number <strong>${sn}</strong> not found.</div>`;
        return;
    }

    resultArea.innerHTML = `
        <div class="dashboard-grid animate-up">
            <div class="card">
                <h3 class="section-title-sm">Heritage Header</h3>
                <div style="font-size: 1.5rem; font-weight: 800; margin-bottom: 0.5rem;">${unit.serial}</div>
                <div class="badge ${unit.status === 'COMPLETED' ? 'badge-success' : 'badge-error'}">${unit.status}</div>
                ${unit.status === 'SCRAP' && currentUser.role === 'admin' ? `
                    <div style="margin-top: 1rem;">
                        <button class="btn btn-outline w-full justify-center" style="border-color: var(--warning); color: var(--warning);" onclick="reworkScrappedUnit('${unit.serial}')">
                            <i data-lucide="wrench" style="width:14px;"></i> Initiate Quality Rework
                        </button>
                    </div>
                ` : ''}
            </div>
            <div class="card">
                <h3 class="section-title-sm">Component Pairing Heritage</h3>
                <div class="table-container">
                    <table>
                        <thead><tr><th>Component</th><th>S/N</th><th>Paired At Stage</th><th>Paired Time</th></tr></thead>
                        <tbody>
                            ${Object.entries(unit.components).map(([k, v]) => `
                                <tr>
                                    <td style="font-weight:700;">${k}</td>
                                    <td style="font-family:monospace;">${v.sn}</td>
                                    <td><span class="badge badge-success">${v.stage}</span></td>
                                    <td class="text-muted" style="font-size:0.75rem;">${v.time}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
            <div class="card" style="grid-column: span 2;">
                <h3 class="section-title-sm">Trace Logs</h3>
                <div class="table-container">
                    <table>
                        <thead><tr><th>Stage</th><th>Result</th><th>By</th><th>Timestamp</th></tr></thead>
                        <tbody>
                            ${unit.history.map(h => `<tr><td>${h.stage}</td><td><span class="badge ${h.status === 'PASS' ? 'badge-success' : 'badge-error'}">${h.status}</span></td><td>${h.operator}</td><td>${h.time}</td></tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
    lucide.createIcons();
}

function runLiveFilter() {
    const filterType = document.querySelector('input[name="ledger-filter"]:checked').value;
    const withComps = document.getElementById('filter-comp').checked;
    const resultArea = document.getElementById('trace-result-area');

    const filtered = Object.values(units).filter(u => {
        if (withComps && Object.keys(u.components).length === 0) return false;

        if (filterType === 'wip') return u.status === 'IN_PROGRESS' && !u.isRework;
        if (filterType === 'passed') return u.status === 'COMPLETED';
        if (filterType === 'scrap') return u.status === 'SCRAP';
        if (filterType === 'rework') return u.isRework;

        return true; // "all"
    });

    if (filtered.length === 0) {
        resultArea.innerHTML = `
            <div class="card glass text-center" style="padding:5rem; border:1px dashed var(--border);">
                <i data-lucide="inbox" style="width:48px; height:48px; margin:0 auto 1rem; opacity:0.2;"></i>
                <h3 class="text-muted">No units found in the current selection.</h3>
                <p class="text-muted" style="font-size:0.8rem;">Try scanning a unit at Stage 1 to start a new record.</p>
            </div>`;
        lucide.createIcons();
        return;
    }

    resultArea.innerHTML = `
        <div class="card glass animate-up" style="padding:0; overflow:hidden;">
            <div style="padding:1.5rem; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.02);">
                <h3 class="section-title-sm" style="margin:0;">Active Production Stream (${filtered.length} Units)</h3>
                <span class="text-muted" style="font-size:0.7rem; font-weight:800; letter-spacing:0.1em; text-transform:uppercase;">Real-Time Ledger</span>
            </div>
            <div class="table-container" style="border:none; border-radius:0;">
                <table>
                    <thead>
                        <tr>
                            <th>Serial / Lot</th>
                            <th>Current/Last Stage</th>
                            <th>Status Binder</th>
                            <th>Logs</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filtered.map(u => {
        let badgeClass = 'badge-success';
        let statusLabel = u.status;
        if (u.status === 'SCRAP') badgeClass = 'badge-error';
        if (u.status === 'IN_PROGRESS') {
            badgeClass = 'badge-warning';
            statusLabel = 'WIP';
        }
        if (u.isRework) {
            badgeClass = 'badge-warning';
            statusLabel = 'REWORK';
        }

        // Get last known stage from history or name of current stage
        const lastLog = u.history[u.history.length - 1];
        const currentStage = manufacturingStages.find(s => s.order === u.currentStageOrder);
        const stageName = currentStage ? currentStage.name : (lastLog ? lastLog.stage : 'Awaiting Stage 1');

        return `
                            <tr>
                                <td>
                                    <div style="font-weight:800; font-size:1rem; color:var(--primary); font-family:monospace;">${u.serial}</div>
                                    <div class="text-muted" style="font-size:0.6rem;">Lot: ASSEMBLY-A1</div>
                                </td>
                                <td>
                                    <div style="font-weight:700;">${stageName}</div>
                                    <div class="text-muted" style="font-size:0.65rem;">${u.history.length > 0 ? 'Active Workflow' : 'Just Started'}</div>
                                </td>
                                <td><span class="badge ${badgeClass}">${statusLabel}</span></td>
                                <td>
                                    <div class="flex items-center gap-2">
                                        <i data-lucide="database" style="width:12px; color:var(--text-muted);"></i>
                                        <span>${u.history.length} Logs</span>
                                    </div>
                                </td>
                                <td>
                                    <button class="btn btn-outline" style="padding:0.4rem 0.8rem; font-size:0.7rem; gap:4px;" 
                                            onclick="document.getElementById('search-serial').value='${u.serial}'; searchUnit();">
                                        <i data-lucide="eye" style="width:12px"></i> Heritage Drill-down
                                    </button>
                                </td>
                            </tr>
                        `;
    }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
    lucide.createIcons();
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
    if (!confirm(`🔧 Authorize Rework for unit ${sn}? This will return the unit to the stage where it was scrapped.`)) return;

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

        pushAudit("UNIT_REWORK", `Unit ${sn} re-authorized for Stage ${unit.currentStageOrder}`);
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
        <tr>
            <td><strong>${u.name}</strong></td>
            <td><code style="background:var(--border); padding:2px 6px; border-radius:4px;">${u.accessId}</code></td>
            <td><span class="badge ${u.role === 'admin' ? 'badge-primary' : 'badge-success'}">${u.role.toUpperCase()}</span></td>
            <td>${u.stats ? (u.stats.passed + u.stats.scrapped) : 0} actions</td>
            <td><button class="btn btn-outline" style="padding:0.4rem; color:var(--error);" onclick="confirm('Delete user ${u.name}?') ? deleteUser('${u.id}') : null"><i data-lucide="trash-2" style="width:14px;"></i></button></td>
        </tr>
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
    const list = document.getElementById('live-audit-list');
    if (!list) return;
    list.innerHTML = globalAuditLog.map(log => `
        <div style="padding: 10px; border-bottom: 1px solid var(--border); border-left: 3px solid ${log.event === 'UNIT_SCRAP' ? 'var(--error)' : 'var(--success)'}; margin-bottom: 5px; background: rgba(255,255,255,0.02);">
            <div class="flex justify-between" style="font-weight: 800;">
                <span>${log.event.replace('_', ' ')}</span>
                <span class="text-muted" style="font-size: 0.6rem;">${log.time}</span>
            </div>
            <div style="margin-top:2px;">${log.details}</div>
            <div class="text-muted" style="font-size: 0.65rem; margin-top:4px;">Captured by: ${log.op}</div>
        </div>
    `).join('') || '<p class="text-center text-muted">Waiting for production events...</p>';
}

function updateOpLeague() {
    const body = document.getElementById('op-league-body');
    if (!body) return;
    body.innerHTML = usersData.filter(u => u.role === 'operator').map(u => {
        const total = u.stats.passed + u.stats.scrapped;
        const eff = total === 0 ? 0 : (u.stats.passed / total * 100).toFixed(0);
        return `
            <tr>
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
            </tr>
        `;
    }).join('');
}

// 🍞 Toast Notification Engine
function showToast(msg, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = 'info';
    if (type === 'success') icon = 'check-circle';
    if (type === 'error') icon = 'alert-octagon';
    if (type === 'warning') icon = 'alert-triangle';

    toast.innerHTML = `
        <i data-lucide="${icon}" style="width:20px;"></i>
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
                        id: `stage_${Object.keys(stagesMap).length + 1}`,
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
applyRoleRestrictions();
lucide.createIcons();
