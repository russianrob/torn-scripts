// ==UserScript==
// @name         OC Spawn Assistance
// @namespace    torn-oc-spawn-assistance
// @version      1.3.1
// @description  Analyzes faction member availability and OC slot supply; recommends which crime levels to spawn
// @author       You
// @match        https://www.torn.com/factions.php*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════
    //  CONFIG  — defaults, overridden by saved GM values
    // ═══════════════════════════════════════════════════════════════════════
    function loadConfig() {
        return {
            API_KEY:           'YOUR_API_KEY_HERE',
            FACTION_ID:        42055,
            ACTIVE_DAYS:       Number(GM_getValue('cfg_active_days',    7)),
            FORECAST_HOURS:    Number(GM_getValue('cfg_forecast_hours', 24)),
            MINCPR:            Number(GM_getValue('cfg_mincpr',         60)),
            CPR_BOOST:         Number(GM_getValue('cfg_cpr_boost',      15)),
            CPR_LOOKBACK_DAYS: Number(GM_getValue('cfg_lookback_days',  90)),
        };
    }
    let CONFIG = loadConfig();

    let cprBreakdownMap = {};

    const SERVER = 'https://tornwar.com';

    // ═══════════════════════════════════════════════════════════════════════
    //  API KEY
    // ═══════════════════════════════════════════════════════════════════════
    function getApiKey() {
        const saved = GM_getValue('oc_spawn_api_key', '');
        if (saved) return saved;
        if (typeof window.localAPIkey === 'string' && window.localAPIkey.length > 0)
            return window.localAPIkey;
        return CONFIG.API_KEY;
    }
    function saveApiKey(key) { GM_setValue('oc_spawn_api_key', key.trim()); }

    // ═══════════════════════════════════════════════════════════════════════
    //  SERVER DATA  — GET /api/oc/spawn-key
    //  Single plain GET, no custom headers (no CORS preflight).
    //  Server verifies faction, caches CPR 6h, returns spawn data.
    // ═══════════════════════════════════════════════════════════════════════
    async function fetchServerOcData(apiKey) {
        const res = await fetch(`${SERVER}/api/oc/spawn-key?key=${encodeURIComponent(apiKey)}`);
        const data = await res.json().catch(() => ({}));
        if (res.status === 403) {
            const err = new Error(data.error || 'Access restricted to faction members only.');
            err.status = 403; throw err;
        }
        if (!res.ok) throw new Error(data.error || `Server error (${res.status})`);
        return data;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  STYLES
    // ═══════════════════════════════════════════════════════════════════════
    GM_addStyle(`
        #oc-spawn-toggle {
            position: fixed; bottom: 80px; right: 16px; z-index: 9999;
            background: #2d6a4f; color: #fff; border: none; border-radius: 6px;
            padding: 7px 13px; font-size: 12px; font-weight: bold; cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,.4);
        }
        #oc-spawn-toggle:hover { background: #1b4332; }
        #oc-spawn-panel {
            position: fixed; bottom: 115px; right: 16px; z-index: 9998;
            width: min(560px, calc(100vw - 48px)); max-height: 72vh; overflow-y: auto;
            background: #0f1a14; color: #d1d5db; border: 1px solid #2a3f30;
            border-radius: 10px; padding: 14px 16px; font-size: 12px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            box-shadow: 0 4px 24px rgba(0,0,0,.7); display: none;
        }
        #oc-spawn-panel h2 {
            margin: 0 0 10px; font-size: 15px; font-weight: 700; color: #74c69d;
            display: flex; justify-content: space-between; align-items: center;
        }
        #oc-spawn-panel h3 {
            margin: 14px 0 6px; font-size: 10px; font-weight: 600; color: #6b7280;
            text-transform: uppercase; letter-spacing: 0.7px;
            border-bottom: 1px solid #1a2e20; padding-bottom: 4px;
        }
        #oc-settings-panel {
            display: none; background: #0f1f16; border: 1px solid #2a3f30;
            border-radius: 8px; padding: 12px 12px 8px; margin-bottom: 10px;
        }
        .oc-setting-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; gap: 10px; }
        .oc-setting-info { flex: 1; min-width: 0; }
        .oc-setting-label { font-size: 11px; font-weight: 600; color: #f3f4f6; display: block; margin-bottom: 2px; }
        .oc-setting-desc { font-size: 10px; color: #6b7280; line-height: 1.4; }
        .oc-setting-num { width: 52px; padding: 4px 6px; background: #0d1b2a; color: #f3f4f6; border: 1px solid #2d4a3e; border-radius: 4px; font-size: 11px; text-align: right; font-family: monospace; flex-shrink: 0; }
        .oc-setting-divider { border: none; border-top: 1px solid #1a2e20; margin: 8px 0; }
        .oc-setting-key-wrap { display: flex; gap: 6px; margin-top: 4px; }
        .oc-setting-key-input { flex: 1; padding: 4px 8px; background: #0d1b2a; color: #f3f4f6; border: 1px solid #2d4a3e; border-radius: 4px; font-size: 11px; font-family: monospace; }
        .oc-setting-save-btn { padding: 5px 12px; background: #2d6a4f; color: #fff; border: none; border-radius: 5px; font-size: 11px; cursor: pointer; font-family: inherit; font-weight: 600; }
        .oc-setting-save-btn:hover { background: #1b4332; }
        .oc-stats-strip { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px; }
        .oc-stat-chip { background: #131f18; border: 1px solid #253525; border-radius: 20px; padding: 3px 10px; font-size: 11px; color: #9ca3af; }
        .oc-stat-chip b { color: #74c69d; font-weight: 600; }
        .oc-spawn-banner { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; background: #1c1a0f; border: 1px solid #3d3010; border-left: 3px solid #f4a261; border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; font-size: 11px; color: #9ca3af; }
        .oc-spawn-banner.oc-banner-ok { background: #0f1c14; border-color: #1b4332; border-left-color: #74c69d; color: #74c69d; }
        .oc-lvl-chip { background: rgba(244,162,97,.15); color: #f4a261; border: 1px solid rgba(244,162,97,.3); border-radius: 4px; padding: 2px 8px; font-size: 11px; font-weight: 600; }
        .oc-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 11px; }
        .oc-table th { background: #0f1a14; color: #6b7280; padding: 5px 8px; text-align: left; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #1a2e20; }
        .oc-table td { padding: 4px 8px; border-bottom: 1px solid #131f18; vertical-align: middle; white-space: nowrap; color: #f3f4f6; }
        .oc-table tr:hover td { background: #131f18; }
        .oc-row-spawn   > td:first-child { border-left: 2px solid #f4a261; padding-left: 6px; }
        .oc-row-ok      > td:first-child { border-left: 2px solid #74c69d; padding-left: 6px; }
        .oc-row-surplus > td:first-child { border-left: 2px solid #60a5fa; padding-left: 6px; }
        .oc-tag-spawn { display: inline-block; background: rgba(244,162,97,.15); color: #f4a261; border: 1px solid rgba(244,162,97,.3); border-radius: 4px; padding: 2px 7px; font-size: 10px; font-weight: 700; }
        .oc-tag-ok { display: inline-block; background: rgba(116,198,157,.12); color: #74c69d; border: 1px solid rgba(116,198,157,.25); border-radius: 4px; padding: 2px 7px; font-size: 10px; }
        .oc-tag-surplus { display: inline-block; background: rgba(96,165,250,.1); color: #90e0ef; border: 1px solid rgba(96,165,250,.2); border-radius: 4px; padding: 2px 7px; font-size: 10px; }
        .oc-tag-none { color: #6b7280; }
        .oc-badge { display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 10px; }
        .oc-badge-in   { background: rgba(59,130,246,.1);   color: #60a5fa; border: 1px solid rgba(59,130,246,.2); }
        .oc-badge-soon { background: rgba(244,162,97,.12);  color: #f4a261; border: 1px solid rgba(244,162,97,.25); }
        .oc-badge-free { background: rgba(116,198,157,.12); color: #74c69d; border: 1px solid rgba(116,198,157,.25); }
        .oc-cpr-high { color: #74c69d; }
        .oc-cpr-mid  { color: #f4a261; }
        .oc-cpr-low  { color: #9ca3af; }
        .oc-member-name { color: #f3f4f6; font-weight: 500; }
        .oc-member-id   { color: #6b7280; font-size: 10px; }
        .oc-cpr-click { cursor: pointer; border-bottom: 1px dotted currentColor; }
        .oc-cpr-click:hover { opacity: 0.75; }
        #oc-cpr-tooltip { position: fixed; z-index: 10001; background: #131f18; border: 1px solid #2d4a3e; border-radius: 8px; padding: 10px 12px; font-size: 11px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #d1d5db; box-shadow: 0 4px 20px rgba(0,0,0,.7); min-width: 200px; max-width: 240px; display: none; pointer-events: none; }
        #oc-cpr-tooltip .oc-tt-title { font-weight: 600; color: #f3f4f6; margin-bottom: 5px; font-size: 12px; }
        #oc-cpr-tooltip .oc-tt-avg   { color: #9ca3af; font-size: 10px; margin-bottom: 7px; }
        #oc-cpr-tooltip table { width: 100%; border-collapse: collapse; }
        #oc-cpr-tooltip th { color: #6b7280; font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; padding: 2px 4px; border-bottom: 1px solid #1a2e20; text-align: left; }
        #oc-cpr-tooltip td { padding: 3px 4px; font-size: 11px; color: #f3f4f6; }
        #oc-cpr-tooltip .oc-tt-note { color: #6b7280; font-size: 10px; margin-top: 7px; border-top: 1px solid #1a2e20; padding-top: 5px; }
        #oc-spawn-status { color: #6b7280; font-style: italic; margin: 4px 0 10px; font-size: 10px; }
        #oc-spawn-refresh { background: #152018; color: #74c69d; border: 1px solid #2d4a3e; border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 11px; font-family: inherit; font-weight: 600; }
        #oc-spawn-refresh:hover { background: #2d6a4f; color: #fff; }
        #oc-spawn-refresh:disabled { opacity: .4; cursor: default; }
        .oc-error { color: #f87171; font-weight: 600; }
        .oc-hdr-btn { background: #1a2a1f; color: #9ca3af; border: 1px solid #2d4a3e; border-radius: 6px; padding: 4px 9px; font-size: 12px; cursor: pointer; line-height: 1; font-family: inherit; }
        .oc-hdr-btn:hover { background: #253525; color: #d1d5db; }
    `);

    // ═══════════════════════════════════════════════════════════════════════
    //  DOM SETUP
    // ═══════════════════════════════════════════════════════════════════════
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'oc-spawn-toggle';
    toggleBtn.textContent = '⚔ OC Spawn';
    document.body.appendChild(toggleBtn);

    const panel = document.createElement('div');
    panel.id = 'oc-spawn-panel';
    panel.innerHTML = `
        <h2>
            OC Spawn Assistance
            <span style="display:flex;gap:6px;align-items:center;">
                <button id="oc-spawn-refresh">↻ Refresh</button>
                <button id="oc-spawn-settings" class="oc-hdr-btn" title="Settings">⚙</button>
                <button id="oc-spawn-close" class="oc-hdr-btn">✕</button>
            </span>
        </h2>
        <div id="oc-spawn-status">Click Refresh to load data.</div>

        <div id="oc-settings-panel">
            <div class="oc-setting-row">
                <div class="oc-setting-info">
                    <span class="oc-setting-label">API Key</span>
                    <div class="oc-setting-desc">Your personal Torn API key. Must belong to a member of the faction.</div>
                    <div class="oc-setting-key-wrap">
                        <input id="oc-spawn-key-input" type="password" placeholder="Paste API key…" class="oc-setting-key-input"/>
                        <button id="oc-spawn-key-save" class="oc-setting-save-btn">Save</button>
                    </div>
                </div>
            </div>
            <hr class="oc-setting-divider"/>
            <div class="oc-setting-row">
                <div class="oc-setting-info">
                    <span class="oc-setting-label">Active Days</span>
                    <div class="oc-setting-desc">Members last seen more than this many days ago are skipped entirely.</div>
                </div>
                <input class="oc-setting-num" id="cfg-active-days" type="number" min="1" max="30"/>
            </div>
            <div class="oc-setting-row">
                <div class="oc-setting-info">
                    <span class="oc-setting-label">Forecast Hours</span>
                    <div class="oc-setting-desc">Members whose current OC finishes within this window are counted as "soon free" and included in spawn planning.</div>
                </div>
                <input class="oc-setting-num" id="cfg-forecast-hours" type="number" min="1" max="72"/>
            </div>
            <div class="oc-setting-row">
                <div class="oc-setting-info">
                    <span class="oc-setting-label">Min CPR %</span>
                    <div class="oc-setting-desc">Minimum checkpoint pass rate to be matched to an OC slot. Members below this default to Lvl 1.</div>
                </div>
                <input class="oc-setting-num" id="cfg-mincpr" type="number" min="0" max="100"/>
            </div>
            <div class="oc-setting-row">
                <div class="oc-setting-info">
                    <span class="oc-setting-label">CPR Boost</span>
                    <div class="oc-setting-desc">If a member's CPR is at least Min CPR + this value, they can join one difficulty level above their highest completed.</div>
                </div>
                <input class="oc-setting-num" id="cfg-cpr-boost" type="number" min="0" max="40"/>
            </div>
            <div class="oc-setting-row">
                <div class="oc-setting-info">
                    <span class="oc-setting-label">CPR Lookback Days</span>
                    <div class="oc-setting-desc">How many days of completed crimes to use for CPR. Cached server-side for 6 hours — changes take effect on next cache refresh.</div>
                </div>
                <input class="oc-setting-num" id="cfg-lookback-days" type="number" min="7" max="365"/>
            </div>
            <div style="text-align:right;margin-top:4px;">
                <button id="oc-spawn-cfg-save" class="oc-setting-save-btn">Save Settings</button>
            </div>
        </div>

        <div id="oc-spawn-body"></div>
    `;
    document.body.appendChild(panel);

    const cprTooltipEl = document.createElement('div');
    cprTooltipEl.id = 'oc-cpr-tooltip';
    document.body.appendChild(cprTooltipEl);

    let panelVisible = false;
    let cprTipOpen   = false;

    toggleBtn.addEventListener('click', () => {
        panelVisible = !panelVisible;
        panel.style.display = panelVisible ? 'block' : 'none';
    });
    document.getElementById('oc-spawn-refresh').addEventListener('click', runAnalysis);
    document.getElementById('oc-spawn-close').addEventListener('click', () => {
        panelVisible = false; panel.style.display = 'none';
    });
    document.getElementById('oc-spawn-settings').addEventListener('click', () => {
        const sp = document.getElementById('oc-settings-panel');
        const opening = sp.style.display === 'none' || sp.style.display === '';
        sp.style.display = opening ? 'block' : 'none';
        if (opening) populateSettings();
    });

    function populateSettings() {
        const key = getApiKey();
        const inp = document.getElementById('oc-spawn-key-input');
        inp.value = '';
        inp.placeholder = (key && key !== 'YOUR_API_KEY_HERE') ? '••••••••' + key.slice(-4) : 'Paste API key…';
        document.getElementById('cfg-active-days').value    = CONFIG.ACTIVE_DAYS;
        document.getElementById('cfg-forecast-hours').value = CONFIG.FORECAST_HOURS;
        document.getElementById('cfg-mincpr').value         = CONFIG.MINCPR;
        document.getElementById('cfg-cpr-boost').value      = CONFIG.CPR_BOOST;
        document.getElementById('cfg-lookback-days').value  = CONFIG.CPR_LOOKBACK_DAYS;
    }

    function checkKeyRow() {
        const key = getApiKey();
        if (!key || key === 'YOUR_API_KEY_HERE') {
            document.getElementById('oc-settings-panel').style.display = 'block';
            populateSettings();
        }
    }
    checkKeyRow();

    document.getElementById('oc-spawn-key-save').addEventListener('click', () => {
        const val = document.getElementById('oc-spawn-key-input').value.trim();
        if (val.length < 10) return;
        saveApiKey(val);
        GM_setValue('oc_srv_token', null); // force re-auth with new key
        document.getElementById('oc-spawn-key-input').value = '';
        document.getElementById('oc-spawn-key-input').placeholder = '••••••••' + val.slice(-4);
        setStatus('API key saved. Click Refresh.');
    });

    document.getElementById('oc-spawn-cfg-save').addEventListener('click', () => {
        const get = id => Math.max(0, parseInt(document.getElementById(id).value) || 0);
        GM_setValue('cfg_active_days',    get('cfg-active-days'));
        GM_setValue('cfg_forecast_hours', get('cfg-forecast-hours'));
        GM_setValue('cfg_mincpr',         get('cfg-mincpr'));
        GM_setValue('cfg_cpr_boost',      get('cfg-cpr-boost'));
        GM_setValue('cfg_lookback_days',  get('cfg-lookback-days'));
        CONFIG = loadConfig();
        document.getElementById('oc-settings-panel').style.display = 'none';
        setStatus('Settings saved. Click Refresh.');
    });

    // ═══════════════════════════════════════════════════════════════════════
    //  CPR TOOLTIP
    // ═══════════════════════════════════════════════════════════════════════
    function showCprTooltip(el) {
        const uid  = parseInt(el.dataset.uid);
        const data = cprBreakdownMap[uid];
        if (!data || !data.entries.length) return;
        const byLevel = {};
        for (const e of data.entries) {
            if (!byLevel[e.diff]) byLevel[e.diff] = { sum: 0, count: 0 };
            byLevel[e.diff].sum += e.rate; byLevel[e.diff].count++;
        }
        const levels = Object.keys(byLevel).map(Number).sort((a, b) => b - a);
        const rows = levels.map(lvl => {
            const avg = Math.round(byLevel[lvl].sum / byLevel[lvl].count * 10) / 10;
            const c = avg >= 80 ? '#74c69d' : avg >= 60 ? '#f4a261' : '#9ca3af';
            return `<tr><td>Lvl ${lvl}</td><td>${byLevel[lvl].count} crime${byLevel[lvl].count > 1 ? 's' : ''}</td><td style="color:${c}">${avg}%</td></tr>`;
        }).join('');
        const oc = data.cpr >= 80 ? '#74c69d' : data.cpr >= 60 ? '#f4a261' : '#9ca3af';
        cprTooltipEl.innerHTML = `
            <div class="oc-tt-title">${data.name}</div>
            <div class="oc-tt-avg">Avg: <b style="color:${oc}">${data.cpr}%</b> from ${data.entries.length} crime${data.entries.length > 1 ? 's' : ''}</div>
            <table><thead><tr><th>Level</th><th>Crimes</th><th>Avg CPR</th></tr></thead><tbody>${rows}</tbody></table>
            <div class="oc-tt-note">Only counts crimes within 1 level of player's best</div>
        `;
        cprTooltipEl.style.display = 'block';
        const rect = el.getBoundingClientRect();
        cprTooltipEl.style.top  = (rect.bottom + 6) + 'px';
        cprTooltipEl.style.left = rect.left + 'px';
        requestAnimationFrame(() => {
            const tr = cprTooltipEl.getBoundingClientRect();
            if (tr.right  > window.innerWidth  - 8) cprTooltipEl.style.left = (window.innerWidth  - tr.width  - 8) + 'px';
            if (tr.bottom > window.innerHeight - 8) cprTooltipEl.style.top  = (rect.top - tr.height - 6) + 'px';
        });
        cprTipOpen = true;
    }
    function hideCprTooltip() { cprTooltipEl.style.display = 'none'; cprTipOpen = false; }
    panel.addEventListener('click', e => {
        const t = e.target.closest('.oc-cpr-click');
        if (t) { e.stopPropagation(); showCprTooltip(t); } else hideCprTooltip();
    });
    document.addEventListener('click', () => { if (cprTipOpen) hideCprTooltip(); });

    // ═══════════════════════════════════════════════════════════════════════
    //  UTILITY
    // ═══════════════════════════════════════════════════════════════════════
    const now = () => Math.floor(Date.now() / 1000);
    function setStatus(msg) { document.getElementById('oc-spawn-status').textContent = msg; }
    function normArr(raw) { return Array.isArray(raw) ? raw : Object.values(raw || {}); }

    // ═══════════════════════════════════════════════════════════════════════
    //  PROCESS MEMBERS
    // ═══════════════════════════════════════════════════════════════════════
    function processMembers(members, availableCrimes, cprCache) {
        const activeCutoff   = now() - CONFIG.ACTIVE_DAYS * 86400;
        const forecastCutoff = now() + CONFIG.FORECAST_HOURS * 3600;
        const memberOcMap = {};
        for (const crime of normArr(availableCrimes)) {
            if (crime.status === 'Expired') continue;
            if (!Array.isArray(crime.slots)) continue;
            for (const slot of crime.slots) {
                const uid = slot.user_id ?? slot.user?.id;
                if (!uid) continue;
                memberOcMap[uid] = { crimeDifficulty: crime.difficulty, crimeStatus: crime.status, readyAt: crime.ready_at ?? 0, crimeId: crime.id, crimeName: crime.name };
            }
        }
        const eligible = [], skipped = [];
        for (const m of normArr(members)) {
            const uid        = m.id ?? m.player_id;
            const lastAction = m.last_action?.timestamp ?? 0;
            if (lastAction < activeCutoff) { skipped.push({ ...m, id: uid, skipReason: `Inactive >${CONFIG.ACTIVE_DAYS}d` }); continue; }
            const ocInfo = memberOcMap[uid];
            const inOC   = !!ocInfo;
            if (inOC && ocInfo.readyAt > forecastCutoff) { skipped.push({ ...m, id: uid, skipReason: `In OC (ready ${fmtTs(ocInfo.readyAt)})` }); continue; }
            const cpr      = cprCache[uid] ?? null;
            const cprValue = cpr?.cpr ?? null;
            const highestLvl = cpr?.highestLevel ?? 0;
            const joinable = (cprValue === null || cprValue < CONFIG.MINCPR) ? 1 : (cpr?.joinable ?? 1);
            eligible.push({
                id: uid, name: m.name, lastAction, status: m.status?.state ?? 'Unknown',
                inOC, ocReadyAt: inOC ? ocInfo.readyAt : null,
                ocCrimeName: inOC ? ocInfo.crimeName : null, ocStatus: inOC ? ocInfo.crimeStatus : null,
                cpr: cprValue, highestLevel: highestLvl, joinable,
                noCrimeHistory: cprValue === null, cprEntries: cpr?.entries ?? [],
            });
        }
        return { eligible, skipped };
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  SLOT COUNT & RECOMMENDATIONS
    // ═══════════════════════════════════════════════════════════════════════
    function countOpenSlots(availableCrimes) {
        const slotMap = {};
        for (const crime of normArr(availableCrimes)) {
            if (crime.status !== 'Recruiting') continue;
            const d = crime.difficulty;
            if (!slotMap[d]) slotMap[d] = { totalSlots: 0, openSlots: 0, crimes: [] };
            let open = 0, total = 0;
            for (const slot of (crime.slots || [])) { total++; if (!slot.user_id && !slot.user?.id) open++; }
            slotMap[d].totalSlots += total; slotMap[d].openSlots += open;
            slotMap[d].crimes.push({ id: crime.id, name: crime.name, open, total });
        }
        return slotMap;
    }

    function buildRecommendations(eligible, slotMap) {
        const recs = [];
        for (let lvl = 1; lvl <= 10; lvl++) {
            const membersForLevel = eligible.filter(m => m.joinable === lvl);
            const freeNow   = membersForLevel.filter(m => !m.inOC);
            const soonFree  = membersForLevel.filter(m => m.inOC);
            const totalNeeded = freeNow.length + soonFree.length;
            const info    = slotMap[lvl] || { totalSlots: 0, openSlots: 0, crimes: [] };
            const deficit = totalNeeded - info.openSlots;
            const action  = totalNeeded === 0 ? 'none' : deficit > 0 ? 'spawn' : deficit === 0 ? 'ok' : 'surplus';
            recs.push({ level: lvl, freeMembers: freeNow.length, soonMembers: soonFree.length, openSlots: info.openSlots, totalSlots: info.totalSlots, recruitingOCs: info.crimes.length, deficit, action, names: membersForLevel.map(m => m.name) });
        }
        return recs;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  RENDERING
    // ═══════════════════════════════════════════════════════════════════════
    function fmtTs(ts) {
        if (!ts) return '—';
        const d = new Date(ts * 1000), h = d.getHours().toString().padStart(2,'0'), m = d.getMinutes().toString().padStart(2,'0');
        if (d.toDateString() === new Date().toDateString()) return `today ${h}:${m}`;
        return `${d.getMonth()+1}/${d.getDate()} ${h}:${m}`;
    }

    function renderRecommendations(recs) {
        const rows = recs.map(r => {
            if (r.action === 'none') return '';
            let a = r.action === 'spawn' ? `<span class="oc-tag-spawn">SPAWN +${r.deficit}</span>` : r.action === 'ok' ? `<span class="oc-tag-ok">✓ Covered</span>` : `<span class="oc-tag-surplus">+${Math.abs(r.deficit)} extra</span>`;
            const sb = r.soonMembers > 0 ? ` <span class="oc-badge oc-badge-soon">+${r.soonMembers}</span>` : '';
            return `<tr class="oc-row-${r.action}"><td><b>Lvl ${r.level}</b></td><td>${r.freeMembers}${sb}</td><td>${r.openSlots} / ${r.totalSlots} <span style="color:#374151">(${r.recruitingOCs})</span></td><td>${a}</td></tr>`;
        }).filter(Boolean).join('');
        if (!rows) return '<p class="oc-tag-none">No eligible members found for any level.</p>';
        return `<table class="oc-table"><thead><tr><th>Level</th><th>Free + Soon</th><th>Slots</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    function renderEligibleMembers(eligible) {
        cprBreakdownMap = {};
        const sorted = [...eligible].sort((a, b) => (b.joinable - a.joinable) || a.name.localeCompare(b.name));
        const rows = sorted.map(m => {
            const sb = m.inOC ? `<span class="oc-badge oc-badge-in">In OC → free ${fmtTs(m.ocReadyAt)}</span>` : `<span class="oc-badge oc-badge-free">Free</span>`;
            let cc = 'oc-cpr-low';
            if (m.cpr !== null && m.cpr >= 80) cc = 'oc-cpr-high';
            else if (m.cpr !== null && m.cpr >= CONFIG.MINCPR) cc = 'oc-cpr-mid';
            let cs;
            if (m.cpr !== null) {
                cprBreakdownMap[m.id] = { name: m.name, cpr: m.cpr, entries: m.cprEntries };
                cs = `<span class="oc-cpr-click ${cc}" data-uid="${m.id}">${m.cpr}%</span>`;
            } else { cs = '<span class="oc-cpr-low">—</span>'; }
            return `<tr><td><span class="oc-member-name">${m.name}</span> <span class="oc-member-id">[${m.id}]</span></td><td>${sb}</td><td>${cs}</td><td style="color:#6b7280">${m.highestLevel > 0 ? m.highestLevel : '—'}</td><td><b style="color:#74c69d">Lvl ${m.joinable}</b></td></tr>`;
        }).join('');
        return `<table class="oc-table"><thead><tr><th>Member</th><th>Status</th><th>CPR</th><th>Highest</th><th>Joinable</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    function renderBody(recs, eligible, skipped) {
        const total = eligible.length + skipped.length, eli = eligible.length;
        const free = eligible.filter(m => !m.inOC).length, soon = eligible.filter(m => m.inOC).length;
        const spawnLvls = recs.filter(r => r.action === 'spawn').map(r => `Lvl ${r.level}`);
        const banner = spawnLvls.length
            ? `<div class="oc-spawn-banner">Spawn needed: ${spawnLvls.map(l => `<span class="oc-lvl-chip">${l}</span>`).join('')}</div>`
            : `<div class="oc-spawn-banner oc-banner-ok">✓ No additional spawns needed.</div>`;
        const skippedHtml = skipped.length > 0
            ? `<details style="margin-top:6px;"><summary style="cursor:pointer;color:#6b7280;font-size:11px;font-family:inherit;">${skipped.length} members skipped</summary><table class="oc-table" style="margin-top:4px;"><thead><tr><th>Member</th><th>Reason</th></tr></thead><tbody>${skipped.map(m=>`<tr><td><span class="oc-member-name">${m.name}</span> <span class="oc-member-id">[${m.id}]</span></td><td style="color:#6b7280">${m.skipReason}</td></tr>`).join('')}</tbody></table></details>` : '';
        document.getElementById('oc-spawn-body').innerHTML = `
            <div class="oc-stats-strip">
                <span class="oc-stat-chip"><b>${total}</b> members</span>
                <span class="oc-stat-chip"><b>${eli}</b> eligible</span>
                <span class="oc-stat-chip"><b>${free}</b> free now</span>
                <span class="oc-stat-chip"><b>${soon}</b> soon</span>
            </div>
            ${banner}
            <h3>Spawn Recommendations</h3>
            ${renderRecommendations(recs)}
            <h3>Eligible Members</h3>
            ${renderEligibleMembers(eligible)}
            ${skippedHtml}
            <p style="color:#374151;font-size:10px;margin-top:10px;">
                Active=${CONFIG.ACTIVE_DAYS}d · Forecast=${CONFIG.FORECAST_HOURS}h · MinCPR=${CONFIG.MINCPR}% · Boost=${CONFIG.CPR_BOOST}%
                &nbsp;·&nbsp; Updated: ${new Date().toLocaleTimeString()}
                &nbsp;·&nbsp; <span style="color:#253525">CPR cached 6h server-side</span>
            </p>
        `;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  MAIN
    // ═══════════════════════════════════════════════════════════════════════
    async function runAnalysis() {
        const apiKey = getApiKey();
        if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
            document.getElementById('oc-settings-panel').style.display = 'block';
            populateSettings();
            document.getElementById('oc-spawn-body').innerHTML = `<p class="oc-error">⚠ Enter your Torn API key in Settings above.</p>`;
            setStatus('API key not configured.');
            return;
        }

        const refreshBtn = document.getElementById('oc-spawn-refresh');
        refreshBtn.disabled = true;
        document.getElementById('oc-spawn-body').innerHTML = '';

        try {
            // Single call: verifies faction + returns data (CPR cached 6h server-side)
            setStatus('Fetching OC data…');
            let members, availableCrimes, rawCprCache;
            try {
                ({ members, availableCrimes, cprCache: rawCprCache } = await fetchServerOcData(apiKey));
            } catch (err) {
                if (err.status === 403) {
                    document.getElementById('oc-spawn-body').innerHTML =
                        `<p class="oc-error">⛔ Access restricted — your key is not in faction #${CONFIG.FACTION_ID}.</p>`;
                    setStatus('Access denied.');
                    return;
                }
                throw err;
            }

            // Re-apply user's MINCPR/CPR_BOOST to joinable (server uses its own defaults)
            const cprCache = {};
            for (const [uid, d] of Object.entries(rawCprCache || {})) {
                cprCache[uid] = {
                    ...d,
                    joinable: d.cpr >= CONFIG.MINCPR + CONFIG.CPR_BOOST
                        ? Math.min(d.highestLevel + 1, 10)
                        : d.highestLevel,
                };
            }

            // Step 3: local analysis
            setStatus('Analysing…');
            const slotMap               = countOpenSlots(availableCrimes);
            const { eligible, skipped } = processMembers(members, availableCrimes, cprCache);
            const recs                  = buildRecommendations(eligible, slotMap);

            renderBody(recs, eligible, skipped);
            setStatus(`Last updated: ${new Date().toLocaleTimeString()} · ${normArr(members).length} members`);

        } catch (err) {
            document.getElementById('oc-spawn-body').innerHTML =
                `<p class="oc-error">Error: ${err.message}</p>
                 <p style="color:#6b7280;font-size:11px;">Check your API key has Limited (or higher) faction access.</p>`;
            setStatus(`Error: ${err.message}`);
            console.error('[OC Spawn]', err);
        } finally {
            refreshBtn.disabled = false;
        }
    }

    if (window.location.href.includes('tab=crimes') || window.location.hash.includes('crimes')) {
        panelVisible = true; panel.style.display = 'block';
    }

})();
