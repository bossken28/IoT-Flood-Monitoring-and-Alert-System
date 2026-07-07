
        let adminChartInstance = null;
        let adminMapInstance = null;

        let LIMIT_ALERT = 1.5;
        let LIMIT_DANGER = 2.5;
        let LIMIT_CRITICAL = 4.0;
        
        let automaticSmsTriggered = false; 
        let audioCtx = null;
        let soundInterval = null;
        let currentSystemState = "SAFE";
        let isAudioAllowed = false;
        let userDismissedBanner = false;
        let lastLoggedState = "";
        let firebaseDb = null;
        let firebaseReady = false;
        let waterSimulationTimer = null;
        let systemState = createDefaultSystemState();
        const STATE_KEY = 'mamatidFloodSystemState';

        function createDefaultSystemState() {
            return {
                waterLevel: 1.25,
                thresholds: { alert: 1.5, danger: 2.5, critical: 4.0 },
                automationEnabled: true,
                intervalSeconds: 2,
                offsetMeters: 0,
                smsCount: 0,
                subscribers: {},
                lastBroadcast: '',
                lastOperation: 'System monitoring active',
                lastUpdated: Date.now()
            };
        }

        function getFirebaseConfig() {
            return window.FIREBASE_CONFIG || {
                apiKey: 'AIzaSyDUMMY-KEY',
                authDomain: 'flood-monitoring-system.firebaseapp.com',
                databaseURL: 'https://flood-monitoring-system-default-rtdb.firebaseio.com',
                projectId: 'flood-monitoring-system',
                storageBucket: 'flood-monitoring-system.firebasestorage.app',
                messagingSenderId: '000000000000',
                appId: '1:000000000000:web:000000000000'
            };
        }

        function initRealtimeSync() {
            const config = getFirebaseConfig();
            const hasRealFirebaseConfig = config.projectId && config.projectId !== 'flood-monitoring-system' && !config.projectId.includes('YOUR') && config.databaseURL && config.databaseURL.includes('firebaseio.com');

            if (hasRealFirebaseConfig) {
                try {
                    firebase.initializeApp(config);
                    firebaseDb = firebase.database();
                    firebaseReady = true;
                    firebaseDb.ref('mamatidSystem').on('value', (snapshot) => {
                        if (snapshot.exists()) {
                            applyRemoteState(snapshot.val());
                        }
                    });
                } catch (error) {
                    console.warn('Firebase unavailable, switching to local sync.', error);
                    firebaseReady = false;
                }
            }

            if (!firebaseReady) {
                const savedState = localStorage.getItem(STATE_KEY);
                if (savedState) {
                    applyRemoteState(JSON.parse(savedState));
                }
                window.addEventListener('storage', (event) => {
                    if (event.key === STATE_KEY && event.newValue) {
                        applyRemoteState(JSON.parse(event.newValue));
                    }
                });
            }
        }

        function applyRemoteState(payload) {
            const baseState = createDefaultSystemState();
            systemState = {
                ...baseState,
                ...payload,
                thresholds: {
                    ...baseState.thresholds,
                    ...(payload?.thresholds || {})
                },
                subscribers: payload?.subscribers || {}
            };
            syncAdminUiFromState();
        }

        function persistState(partialState) {
            const mergedState = {
                ...systemState,
                ...partialState,
                thresholds: {
                    ...systemState.thresholds,
                    ...(partialState?.thresholds || {})
                },
                lastUpdated: Date.now()
            };
            systemState = mergedState;

            if (firebaseReady && firebaseDb) {
                firebaseDb.ref('mamatidSystem').set(mergedState);
            } else {
                localStorage.setItem(STATE_KEY, JSON.stringify(mergedState));
            }
        }

        function syncAdminUiFromState() {
            const state = systemState;
            LIMIT_ALERT = Number(state.thresholds?.alert || 1.5);
            LIMIT_DANGER = Number(state.thresholds?.danger || 2.5);
            LIMIT_CRITICAL = Number(state.thresholds?.critical || 4.0);

            document.getElementById('threshold-hint-text').innerText = `Alert state starts at ${LIMIT_ALERT.toFixed(2)}m`;
            document.getElementById('th-alert').value = LIMIT_ALERT.toFixed(1);
            document.getElementById('th-danger').value = LIMIT_DANGER.toFixed(1);
            document.getElementById('th-critical').value = LIMIT_CRITICAL.toFixed(1);
            document.getElementById('interval-input').value = state.intervalSeconds || 2;
            document.getElementById('offset-input').value = Number(state.offsetMeters || 0).toFixed(2);
            document.getElementById('automation-toggle').checked = state.automationEnabled !== false;

            const subscriberCount = Object.keys(state.subscribers || {}).length;
            document.getElementById('sms-count').innerText = subscriberCount.toLocaleString();
            document.getElementById('sms-status').innerHTML = `<i class="fas fa-check-circle mr-1"></i>${subscriberCount > 0 ? 'Live subscribers active' : 'Live sync ready'}`;
            document.getElementById('registered-households-count').innerText = subscriberCount.toLocaleString();

            const currentLevel = Number(state.waterLevel || 1.25);
            document.getElementById('admin-water-text').innerText = `${currentLevel.toFixed(2)}m`;
            evaluateWaterMonitorSystem(currentLevel);
            pushChartPoint(currentLevel);
        }

        function pushChartPoint(level) {
            if (!adminChartInstance) return;
            const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            adminChartInstance.data.labels.push(timestamp);
            adminChartInstance.data.datasets[0].data.push(level);
            if (adminChartInstance.data.labels.length > 8) {
                adminChartInstance.data.labels.shift();
                adminChartInstance.data.datasets[0].data.shift();
            }
            adminChartInstance.update();
        }

        function restartWaterSimulation() {
            if (waterSimulationTimer) clearInterval(waterSimulationTimer);
            waterSimulationTimer = setInterval(() => {
                const nextLevel = Math.max(0.3, Math.min(4.9, (systemState.waterLevel || 1.25) + (Math.random() - 0.5) * 0.3 + Number(systemState.offsetMeters || 0) * 0.02));
                persistState({ waterLevel: nextLevel });
                pushChartPoint(nextLevel);
            }, Math.max(1000, Number(systemState.intervalSeconds || 2) * 1000));
        }

        function sendManualAnnouncement() {
            const text = (document.getElementById('admin-announcement-input')||{}).value || '';
            if (!text || !text.trim()) {
                document.getElementById('admin-announcement-status').innerText = 'Please enter a message.';
                return;
            }
            persistState({ lastBroadcast: text.trim(), lastOperation: 'Manual announcement' });
            document.getElementById('admin-announcement-status').innerText = 'Announcement sent.';
            setTimeout(() => document.getElementById('admin-announcement-status').innerText = ' ', 3000);
        }

        function clearAnnouncement() {
            persistState({ lastBroadcast: '', lastOperation: 'Cleared announcement' });
            document.getElementById('admin-announcement-status').innerText = 'Cleared.';
            setTimeout(() => document.getElementById('admin-announcement-status').innerText = ' ', 2000);
        }

        // Modal trigger responder logic
        function respondAudioPermission(allowed) {
            isAudioAllowed = allowed;
            if (allowed) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            document.getElementById('audio-modal').classList.add('hidden');
        }

        function playSystemAlarmBeep(frequency, duration, volume) {
            if (!isAudioAllowed || !audioCtx) return;
            try {
                let osc = audioCtx.createOscillator();
                let gain = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.value = frequency;
                gain.gain.setValueAtTime(volume, audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + duration);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start();
                osc.stop(audioCtx.currentTime + duration);
            } catch(e) { console.log(e); }
        }

        function runDynamicSoundLoopManager(state) {
            if (currentSystemState === state) return;
            currentSystemState = state;
            clearInterval(soundInterval);

            if (state === "ALERT") {
                soundInterval = setInterval(() => { playSystemAlarmBeep(550, 0.2, 0.2); }, 1500);
            } else if (state === "DANGER") {
                soundInterval = setInterval(() => { playSystemAlarmBeep(880, 0.15, 0.5); }, 500);
            } else if (state === "EVACUATE") {
                soundInterval = setInterval(() => { playSystemAlarmBeep(1200, 0.4, 0.8); }, 300);
            }
        }

        function triggerBannerAlert(message, isCritical = false) {
            if (userDismissedBanner) return;
            const banner = document.getElementById('global-alert-banner');
            const msgEl = document.getElementById('global-alert-message');
            msgEl.innerHTML = message;
            
            banner.className = "fixed top-0 inset-x-0 z-40 text-white font-black text-center py-3.5 px-4 shadow-2xl transition-all duration-500 transform translate-y-0 flex items-center justify-center space-x-3";
            
            if (isCritical) {
                banner.classList.add('bg-red-600', 'animate-pulse-fast');
            } else {
                banner.classList.add('bg-orange-500');
            }
        }

        function dismissBanner() {
            const banner = document.getElementById('global-alert-banner');
            banner.className = "fixed top-0 inset-x-0 z-40 text-white font-black text-center py-3.5 px-4 shadow-2xl transition-all duration-500 transform -translate-y-full flex items-center justify-center space-x-3";
            userDismissedBanner = true; 
        }

        function toggleDarkMode() {
            const htmlElement = document.documentElement;
            const icon = document.getElementById('theme-icon');
            if (htmlElement.classList.contains('dark')) {
                htmlElement.classList.remove('dark');
                icon.className = "fas fa-moon";
                localStorage.setItem('admin-theme', 'light');
                updateChartTheme(false);
            } else {
                htmlElement.classList.add('dark');
                icon.className = "fas fa-sun text-yellow-400";
                localStorage.setItem('admin-theme', 'dark');
                updateChartTheme(true);
            }
        }

        function updateChartTheme(isDark) {
            if (!adminChartInstance) return;
            const gridColor = isDark ? '#273554' : '#e2e8f0';
            const textColor = isDark ? '#cbd5e1' : '#0f2d59';
            adminChartInstance.options.scales.y.grid.color = gridColor;
            adminChartInstance.options.scales.x.grid.color = gridColor;
            adminChartInstance.options.scales.y.ticks.color = textColor;
            adminChartInstance.options.scales.x.ticks.color = textColor;
            adminChartInstance.update();
        }

        function toggleSidebar() {
            document.getElementById('sidebar').classList.toggle('-translate-x-full');
            document.getElementById('sidebar-backdrop').classList.toggle('hidden');
        }

        function switchTab(tabId) {
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('#sidebar-nav button').forEach(btn => {
                btn.className = "w-full flex items-center space-x-4 px-4 py-3 rounded-xl text-sm font-bold uppercase tracking-wider transition text-slate-200 hover:bg-[#1a447c] hover:text-white dark:text-slate-300 dark:hover:bg-[#132f5c]";
            });
            document.getElementById(`view-${tabId}`).classList.add('active');
            document.getElementById(`tab-${tabId}`).className = "w-full flex items-center space-x-4 px-4 py-3 rounded-xl text-sm font-black uppercase tracking-wider transition bg-[#e0a916] text-[#0f2d59] shadow";
            
            const titles = {
                'dash': 'Dashboard Overview',
                'sensors': 'IoT Node Calibration Terminal',
                'sms': 'Emergency SMS Broadcaster Gateway',
                'residents': 'Household Registry Matrix Sync'
            };
            document.getElementById('page-title').innerText = titles[tabId] || 'System Terminals';

            if (tabId === 'sensors' && adminMapInstance) {
                setTimeout(() => { adminMapInstance.invalidateSize(); }, 200);
            }
            if (window.innerWidth < 768) toggleSidebar();
        }

        function saveThresholdLabels() {
            const al = parseFloat(document.getElementById('th-alert').value);
            const dg = parseFloat(document.getElementById('th-danger').value);
            const cr = parseFloat(document.getElementById('th-critical').value);

            if(al >= dg || dg >= cr) {
                alert("CONFIGURATION ERROR: Siguraduhing (Alert < Danger < Critical).");
                return;
            }

            LIMIT_ALERT = al;
            LIMIT_DANGER = dg;
            LIMIT_CRITICAL = cr;
            automaticSmsTriggered = false; 
            persistState({ thresholds: { alert: al, danger: dg, critical: cr }, lastOperation: `Thresholds updated` });

            document.getElementById('threshold-hint-text').innerText = `Alert state starts at ${LIMIT_ALERT.toFixed(2)}m`;

            const btn = document.getElementById('apply-btn');
            const originalHTML = btn.innerHTML;
            
            btn.disabled = true;
            btn.className = "w-full bg-emerald-600 text-white font-black py-3 rounded-xl transition-all duration-200 text-xs uppercase tracking-wider shadow-md flex items-center justify-center space-x-2";
            btn.innerHTML = `<i class="fas fa-check-circle"></i> <span>✓ Applied!</span>`;

            setTimeout(() => {
                btn.disabled = false;
                btn.className = "w-full bg-[#0f2d59] dark:bg-amber-500 text-[#e0a916] dark:text-[#0f2d59] font-black py-3 rounded-xl transition-all duration-200 text-xs uppercase tracking-wider shadow-md cursor-pointer flex items-center justify-center space-x-2";
                btn.innerHTML = originalHTML;
            }, 1500);
        }

        function evaluateWaterMonitorSystem(level) {
            const card = document.getElementById('water-monitor-card');
            const badge = document.getElementById('water-status-badge');
            const iconContainer = document.getElementById('water-icon-container');
            const logPanel = document.getElementById('automation-log-panel');
            const logText = document.getElementById('automation-log-text');
            const isAutoEnabled = document.getElementById('automation-toggle').checked;

            card.className = "p-6 rounded-2xl shadow-sm flex items-center justify-between transition-all duration-300 border-2 bg-white dark:bg-[#131f3d]";
            
            let stateNow = "SAFE";
            if (level >= LIMIT_CRITICAL) stateNow = "EVACUATE";
            else if (level >= LIMIT_DANGER) stateNow = "DANGER";
            else if (level >= LIMIT_ALERT) stateNow = "ALERT";

            if (lastLoggedState !== stateNow) {
                userDismissedBanner = false; 
                lastLoggedState = stateNow;
            }

            if (stateNow === "EVACUATE") {
                persistState({ lastBroadcast: `🚨 EVACUATE: Water level ${level.toFixed(2)}m — Move to evacuation centers immediately.` });
                badge.className = "text-[10px] font-black px-2 py-0.5 rounded-md uppercase tracking-wider bg-red-600 text-white animate-pulse";
                badge.innerText = "EVACUATE";
                iconContainer.className = "bg-red-600/20 p-3 rounded-xl text-red-600 dark:text-red-400";
                
                triggerBannerAlert(`🚨 CRITICAL LEVEL: ${level.toFixed(2)}m! AUTOMATIC EVACUATION ORDER DISPATCHED!`, true);
                runDynamicSoundLoopManager("EVACUATE");

                if(isAutoEnabled && !automaticSmsTriggered) {
                    automaticSmsTriggered = true;
                    logPanel.classList.remove('hidden');
                    logText.innerHTML = `⚠️ <b>[${new Date().toLocaleTimeString()}] AUTOMATIC EVACUATION DISPATCH:</b> Tubig ay nasa <b>${level.toFixed(2)}m</b>. SMS ipinadala sa ${Object.keys(systemState.subscribers || {}).length} registered contacts.`;
                    persistState({ lastOperation: `Evacuation alert triggered`, lastBroadcast: `Critical flood level ${level.toFixed(2)}m` });
                }
            } else if (stateNow === "DANGER") {
                card.classList.add('border-orange-500');
                badge.className = "text-[10px] font-black px-2 py-0.5 rounded-md uppercase tracking-wider bg-orange-100 text-orange-800 border border-orange-500";
                badge.innerText = "DANGER";
                iconContainer.className = "bg-orange-500/20 p-3 rounded-xl text-orange-500 dark:text-orange-400";
                
                triggerBannerAlert(`⚠️ WARNING: Ang antas ng tubig ay nasa ${level.toFixed(2)}m! Mapanganib na ang ilog.`, false);
                persistState({ lastBroadcast: `⚠️ DANGER: Water level ${level.toFixed(2)}m — Please prepare and monitor updates.` });
                runDynamicSoundLoopManager("DANGER");
            } else if (stateNow === "ALERT") {
                card.classList.add('border-yellow-500');
                badge.className = "text-[10px] font-black px-2 py-0.5 rounded-md uppercase tracking-wider bg-yellow-100 text-yellow-800 border border-yellow-500";
                badge.innerText = "ALERT";
                iconContainer.className = "bg-yellow-500/20 p-3 rounded-xl text-yellow-600 dark:text-yellow-400";
                
                const banner = document.getElementById('global-alert-banner');
                banner.className = "fixed top-0 inset-x-0 z-40 text-white font-black text-center py-3.5 px-4 shadow-2xl transition-all duration-500 transform -translate-y-full flex items-center justify-center space-x-3";
                
                persistState({ lastBroadcast: `⚠️ ALERT: Water level ${level.toFixed(2)}m — Please be ready and follow instructions.` });
                runDynamicSoundLoopManager("ALERT");
            } else {
                card.classList.add('border-slate-200', 'dark:border-slate-700/60');
                badge.className = "text-[10px] font-black px-2 py-0.5 rounded-md uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-500";
                badge.innerText = "SAFE";
                iconContainer.className = "bg-blue-500/10 p-3 rounded-xl text-blue-600 dark:text-blue-400";
                
                const banner = document.getElementById('global-alert-banner');
                banner.className = "fixed top-0 inset-x-0 z-40 text-white font-black text-center py-3.5 px-4 shadow-2xl transition-all duration-500 transform -translate-y-full flex items-center justify-center space-x-3";
                
                persistState({ lastBroadcast: `✅ NORMAL: Water level ${level.toFixed(2)}m — No immediate action required.` });
                runDynamicSoundLoopManager("SAFE");
                
                if(level < LIMIT_ALERT - 0.2) {
                    automaticSmsTriggered = false;
                    logPanel.classList.add('hidden');
                }
            }
        }

        function handleRecalibrate() {
            const interval = parseInt(document.getElementById('interval-input').value, 10) || 2;
            const offset = parseFloat(document.getElementById('offset-input').value) || 0;
            persistState({ intervalSeconds: interval, offsetMeters: offset, lastOperation: 'Hardware calibration saved' });
            restartWaterSimulation();
            alert('SUCCESS: IoT Core Properties deployed!');
        }

        function handleReboot() { 
            if (confirm('Nais mo bang i-reboot ang IoT Hardware?')) {
                persistState({ lastOperation: 'Reboot command dispatched' });
                alert('COMMAND SENT');
            }
        }

        function handleBroadcast() { 
            const text = document.getElementById('broadcast-msg').value;
            if(!text.trim()){ alert('ERROR: Walang laman ang text transmission fields.'); return; }
            persistState({ lastBroadcast: text, lastOperation: 'Broadcast queued for subscribers' });
            alert('SUCCESS: Broadcast queued for registered contacts.');
        }

        window.addEventListener('DOMContentLoaded', () => {
            const savedTheme = localStorage.getItem('admin-theme') || 'light';
            if (savedTheme === 'dark') {
                document.documentElement.classList.add('dark');
                document.getElementById('theme-icon').className = "fas fa-sun text-yellow-400";
            }

            setInterval(() => { document.getElementById('server-clock').innerText = new Date().toLocaleTimeString(); }, 1000);

            adminMapInstance = L.map('admin-leaflet-map').setView([14.2120, 121.1444], 15);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(adminMapInstance);
            L.marker([14.2155, 121.1465]).addTo(adminMapInstance);

            const ctx = document.getElementById('adminLiveChart').getContext('2d');
            adminChartInstance = new Chart(ctx, {
                type: 'line',
                data: { labels: [], datasets: [{ data: [], borderColor: '#0f2d59', borderWidth: 3, fill: true, tension: 0.1 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
            });

            initRealtimeSync();
            restartWaterSimulation();
        });
    
