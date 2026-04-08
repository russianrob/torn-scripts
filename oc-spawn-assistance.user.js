// ==UserScript==
// @name         OC Spawn Assistance
// @namespace    torn-oc-spawn-assistance
// @version      1.1.6
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
    //  CONFIG
    // ═══════════════════════════════════════════════════════════════════════
    const CONFIG = {
        API_KEY:           'YOUR_API_KEY_HERE',
        FACTION_ID:        42055,   // Only members of this faction can use the script
        ACTIVE_DAYS:       7,
        FORECAST_HOURS:    24,
        MINCPR:            60,
        CPR_BOOST:         15,
        CPR_LOOKBACK_DAYS: 90,
    };

    // CPR breakdown store — populated each render, read by tooltip
    let cprBreakdownMap = {};

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
    //  FACTION GATE
    //  Verifies the API key belongs to a member of CONFIG.FACTION_ID.
    //  Result cached for 1 hour to avoid redundant calls.
    // ═══════════════════════════════════════════════════════════════════════
    async function verifyFaction(apiKey) {
        // Cache key v2 — bumped to invalidate any stale v1 cached results
        const cacheKey = 'oc_faction_v2_' + apiKey.slice(-6);
        const cached   = GM_getValue(cacheKey, null);
        if (cached && (Date.now() - cached.ts) < 3600_000) return cached.ok;

        try {
            // No selections= so we get the full default user object
            const res  = await fetch(`https://api.torn.com/v2/user?key=${apiKey}`);
            const data = await res.json();
            if (data.error) throw new Error(data.error.error);
            // v2 may use .id or .faction_id depending on nesting
            const factionId = data.faction?.faction_id ?? data.faction?.id ?? null;
            const ok = Number(factionId) === CONFIG.FACTION_ID;
            console.log('[OC Spawn] Faction check: id=' + factionId + ' expected=' + CONFIG.FACTION_ID + ' ok=' + ok);
            GM_setValue(cacheKey, { ok, ts: Date.now() });
            return ok;
        } catch (e) {
            console.warn('[OC Spawn] Faction check failed:', e);
            return false;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  STYLES
    // ═══════════════════════════════════════════════════════════════════════
    GM_addStyle(`
        #oc-spawn-toggle {
            position: fixed;
            bottom: 80px;
            right: 16px;
            z-index: 9999;
            background: #2d6a4f;
            color: #fff;
            border: none;
            border-radius: 6px;
            padding: 7px 13px;
            font-size: 12px;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,.4);
        }
        #oc-spawn-toggle:hover { background: #1b4332; }

        #oc-spawn-panel {
            position: fixed;
            bottom: 115px;
            right: 16px;
            z-index: 9998;
            width: min(560px, calc(100vw - 48px));
            max-height: 72vh;
            overflow-y: auto;
            background: #0f1a14;
            color: #d1d5db;
            border: 1px solid #2a3f30;
            border-radius: 10px;
            padding: 14px 16px;
            font-size: 12px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            box-shadow: 0 4px 24px rgba(0,0,0,.7);
            display: none;
        }
        #oc-spawn-panel h2 {
            margin: 0 0 10px;
            font-size: 15px;
            font-weight: 700;
            color: #74c69d;
            display: flex;
            justify-content: space-between;
            align-items: center;
            letter-spacing: -0.2px;
        }
        #oc-spawn-panel h3 {
            margin: 14px 0 6px;
            font-size: 10px;
            font-weight: 600;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.7px;
            border-bottom: 1px solid #1a2e20;
            padding-bottom: 4px;
        }
        .oc-stats-strip {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            margin-bottom: 10px;
        }
        .oc-stat-chip {
            background: #131f18;
            border: 1px solid #253525;
            border-radius: 20px;
            padding: 3px 10px;
            font-size: 11px;
            color: #9ca3af;
        }
        .oc-stat-chip b { color: #74c69d; font-weight: 600; }
        .oc-spawn-banner {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 5px;
            background: #1c1a0f;
            border: 1px solid #3d3010;
            border-left: 3px solid #f4a261;
            border-radius: 6px;
            padding: 8px 12px;
            margin-bottom: 12px;
            font-size: 11px;
            color: #9ca3af;
        }
        .oc-spawn-banner.oc-banner-ok {
            background: #0f1c14;
            border-color: #1b4332;
            border-left-color: #74c69d;
            color: #74c69d;
        }
        .oc-lvl-chip {
            background: rgba(244,162,97,.15);
            color: #f4a261;
            border: 1px solid rgba(244,162,97,.3);
            border-radius: 4px;
            padding: 2px 8px;
            font-size: 11px;
            font-weight: 600;
        }
        .oc-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 10px;
            font-size: 11px;
        }
        .oc-table th {
            background: #0f1a14;
            color: #6b7280;
            padding: 5px 8px;
            text-align: left;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-bottom: 1px solid #1a2e20;
        }
        .oc-table td {
            padding: 4px 8px;
            border-bottom: 1px solid #131f18;
            vertical-align: middle;
            white-space: nowrap;
            color: #f3f4f6;
        }
        .oc-table tr:hover td { background: #131f18; }
        .oc-row-spawn   > td:first-child { border-left: 2px solid #f4a261; padding-left: 6px; }
        .oc-row-ok      > td:first-child { border-left: 2px solid #74c69d; padding-left: 6px; }
        .oc-row-surplus > td:first-child { border-left: 2px solid #60a5fa; padding-left: 6px; }
        .oc-tag-spawn {
            display: inline-block;
            background: rgba(244,162,97,.15);
            color: #f4a261;
            border: 1px solid rgba(244,162,97,.3);
            border-radius: 4px;
            padding: 2px 7px;
            font-size: 10px;
            font-weight: 700;
        }
        .oc-tag-ok {
            display: inline-block;
            background: rgba(116,198,157,.12);
            color: #74c69d;
            border: 1px solid rgba(116,198,157,.25);
            border-radius: 4px;
            padding: 2px 7px;
            font-size: 10px;
        }
        .oc-tag-surplus {
            display: inline-block;
            background: rgba(96,165,250,.1);
            color: #90e0ef;
            border: 1px solid rgba(96,165,250,.2);
            border-radius: 4px;
            padding: 2px 7px;
            font-size: 10px;
        }
        .oc-tag-none { color: #6b7280; }
        .oc-badge {
            display: inline-block;
            padding: 2px 7px;
            border-radius: 4px;
            font-size: 10px;
        }
        .oc-badge-in   { background: rgba(59,130,246,.1);   color: #60a5fa; border: 1px solid rgba(59,130,246,.2); }
        .oc-badge-soon { background: rgba(244,162,97,.12);  color: #f4a261; border: 1px solid rgba(244,162,97,.25); }
        .oc-badge-free { background: rgba(116,198,157,.12); color: #74c69d; border: 1px solid rgba(116,198,157,.25); }
        .oc-cpr-high { color: #74c69d; }
        .oc-cpr-mid  { color: #f4a261; }
        .oc-cpr-low  { color: #9ca3af; }
        .oc-member-name { color: #f3f4f6; font-weight: 500; }
        .oc-member-id   { color: #6b7280; font-size: 10px; }
        .oc-cpr-click {
            cursor: pointer;
            border-bottom: 1px dotted currentColor;
        }
        .oc-cpr-click:hover { opacity: 0.75; }
        #oc-cpr-tooltip {
            position: fixed;
            z-index: 10001;
            background: #131f18;
            border: 1px solid #2d4a3e;
            border-radius: 8px;
            padding: 10px 12px;
            font-size: 11px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            color: #d1d5db;
            box-shadow: 0 4px 20px rgba(0,0,0,.7);
            min-width: 200px;
            max-width: 240px;
            display: none;
            pointer-events: none;
        }
        #oc-cpr-tooltip .oc-tt-title { font-weight: 600; color: #f3f4f6; margin-bottom: 5px; font-size: 12px; }
        #oc-cpr-tooltip .oc-tt-avg   { color: #9ca3af; font-size: 10px; margin-bottom: 7px; }
        #oc-cpr-tooltip table { width: 100%; border-collapse: collapse; }
        #oc-cpr-tooltip th {
            color: #6b7280; font-size: 10px; text-transform: uppercase;
            letter-spacing: 0.4px; padding: 2px 4px;
            border-bottom: 1px solid #1a2e20; text-align: left;
        }
        #oc-cpr-tooltip td { padding: 3px 4px; font-size: 11px; color: #f3f4f6; }
        #oc-cpr-tooltip .oc-tt-note {
            color: #6b7280; font-size: 10px; margin-top: 7px;
            border-top: 1px solid #1a2e20; padding-top: 5px;
        }
        #oc-spawn-status {
            color: #6b7280;
            font-style: italic;
            margin: 4px 0 10px;
            font-size: 10px;
        }
        #oc-spawn-refresh {
            background: #152018;
            color: #74c69d;
            border: 1px solid #2d4a3e;
            border-radius: 6px;
            padding: 4px 10px;
            cursor: pointer;
            font-size: 11px;
            font-family: inherit;
            font-weight: 600;
        }
        #oc-spawn-refresh:hover { background: #2d6a4f; color: #fff; }
        #oc-spawn-refresh:disabled { opacity: .4; cursor: default; }
        .oc-error { color: #f87171; font-weight: 600; }
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
                <button id="oc-spawn-close" style="background:#1a2a1f;color:#9ca3af;border:1px solid #2d4a3e;border-radius:6px;padding:4px 9px;font-size:12px;cursor:pointer;line-height:1;font-family:inherit;">✕</button>
            </span>
        </h2>
        <div id="oc-spawn-status">Click Refresh to load data.</div>
        <div id="oc-spawn-key-row" style="display:none;margin-bottom:8px;">
            <input id="oc-spawn-key-input" type="password" placeholder="Paste Torn API key…"
                style="width:calc(100% - 74px);padding:4px 6px;background:#0d1b2a;color:#e0e0e0;
                       border:1px solid #2d6a4f;border-radius:4px;font-size:11px;font-family:monospace;"/>
            <button id="oc-spawn-key-save"
                style="margin-left:4px;padding:4px 8px;background:#2d6a4f;color:#fff;
                       border:none;border-radius:4px;font-size:11px;cursor:pointer;font-family:inherit;">Save</button>
        </div>
        <div id="oc-spawn-body"></div>
    `;
    document.body.appendChild(panel);

    // CPR tooltip element
    const cprTooltipEl = document.createElement('div');
    cprTooltipEl.id = 'oc-cpr-tooltip';
    document.body.appendChild(cprTooltipEl);

    let panelVisible  = false;
    let cprTipOpen    = false;

    toggleBtn.addEventListener('click', () => {
        panelVisible = !panelVisible;
        panel.style.display = panelVisible ? 'block' : 'none';
    });
    document.getElementById('oc-spawn-refresh').addEventListener('click', runAnalysis);
    document.getElementById('oc-spawn-close').addEventListener('click', () => {
        panelVisible = false;
        panel.style.display = 'none';
    });

    function checkKeyRow() {
        const key = getApiKey();
        const noKey = !key || key === 'YOUR_API_KEY_HERE';
        document.getElementById('oc-spawn-key-row').style.display = noKey ? 'flex' : 'none';
    }
    checkKeyRow();

    document.getElementById('oc-spawn-key-save').addEventListener('click', () => {
        const val = document.getElementById('oc-spawn-key-input').value.trim();
        if (val.length < 10) return;
        saveApiKey(val);
        document.getElementById('oc-spawn-key-row').style.display = 'none';
        setStatus('API key saved. Click Refresh.');
    });

    // ═══════════════════════════════════════════════════════════════════════
    //  CPR TOOLTIP
    // ═══════════════════════════════════════════════════════════════════════
    function showCprTooltip(el) {
        const uid  = parseInt(el.dataset.uid);
        const data = cprBreakdownMap[uid];
        if (!data || !data.entries.length) return;

        // Aggregate entries by difficulty level
        const byLevel = {};
        for (const e of data.entries) {
            if (!byLevel[e.diff]) byLevel[e.diff] = { sum: 0, count: 0 };
            byLevel[e.diff].sum += e.rate;
            byLevel[e.diff].count++;
        }
        const levels = Object.keys(byLevel).map(Number).sort((a, b) => b - a);
        const rows = levels.map(lvl => {
            const avg = Math.round(byLevel[lvl].sum / byLevel[lvl].count * 10) / 10;
            const c   = avg >= 80 ? '#74c69d' : avg >= 60 ? '#f4a261' : '#9ca3af';
            return `<tr>
                <td>Lvl ${lvl}</td>
                <td>${byLevel[lvl].count} crime${byLevel[lvl].count > 1 ? 's' : ''}</td>
                <td style="color:${c}">${avg}%</td>
            </tr>`;
        }).join('');
        const overallColor = data.cpr >= 80 ? '#74c69d' : data.cpr >= 60 ? '#f4a261' : '#9ca3af';

        cprTooltipEl.innerHTML = `
            <div class="oc-tt-title">${data.name}</div>
            <div class="oc-tt-avg">Avg: <b style="color:${overallColor}">${data.cpr}%</b> from ${data.entries.length} crime${data.entries.length > 1 ? 's' : ''}</div>
            <table>
                <thead><tr><th>Level</th><th>Crimes</th><th>Avg CPR</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
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

    function hideCprTooltip() {
        cprTooltipEl.style.display = 'none';
        cprTipOpen = false;
    }

    // Delegate: CPR click inside panel, anything else closes tooltip
    panel.addEventListener('click', e => {
        const target = e.target.closest('.oc-cpr-click');
        if (target) { e.stopPropagation(); showCprTooltip(target); }
        else hideCprTooltip();
    });
    document.addEventListener('click', () => { if (cprTipOpen) hideCprTooltip(); });

    // ═══════════════════════════════════════════════════════════════════════
    //  UTILITY HELPERS
    // ═══════════════════════════════════════════════════════════════════════
    const now = () => Math.floor(Date.now() / 1000);

    function setStatus(msg) {
        document.getElementById('oc-spawn-status').textContent = msg;
    }

    async function apiFetch(url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(`API error ${data.error.code}: ${data.error.error}`);
        return data;
    }

    function normMembers(raw) { return Array.isArray(raw) ? raw : Object.values(raw); }
    function normCrimes(raw)  { return Array.isArray(raw) ? raw : Object.values(raw); }

    // ═══════════════════════════════════════════════════════════════════════
    //  API CALLS
    // ═══════════════════════════════════════════════════════════════════════
    async function fetchMembers(key) {
        const data = await apiFetch(`https://api.torn.com/v2/faction/members?key=${key}`);
        return normMembers(data.members);
    }
    async function fetchAvailableCrimes(key) {
        const data = await apiFetch(`https://api.torn.com/v2/faction/crimes?cat=available&key=${key}`);
        return normCrimes(data.crimes || []);
    }
    async function fetchCompletedCrimes(key) {
        const fromTs = now() - CONFIG.CPR_LOOKBACK_DAYS * 86400;
        const data = await apiFetch(`https://api.torn.com/v2/faction/crimes?cat=completed&sort=DESC&from=${fromTs}&key=${key}`);
        return normCrimes(data.crimes || []);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  CPR CACHE
    //  Two-pass: Pass 1 finds each player's highest level;
    //            Pass 2 averages CPR only from crimes at (highestLevel - 1)+
    // ═══════════════════════════════════════════════════════════════════════
    function buildCprCache(completedCrimes) {
        const highestLevel = {};
        for (const crime of completedCrimes) {
            const diff = crime.difficulty || 0;
            if (!Array.isArray(crime.slots)) continue;
            for (const slot of crime.slots) {
                const uid = slot.user_id ?? slot.user?.id;
                if (!uid) continue;
                if ((highestLevel[uid] || 0) < diff) highestLevel[uid] = diff;
            }
        }

        const cache = {};
        for (const crime of completedCrimes) {
            const diff = crime.difficulty || 0;
            if (!Array.isArray(crime.slots)) continue;
            for (const slot of crime.slots) {
                const uid = slot.user_id ?? slot.user?.id;
                if (!uid) continue;
                const topLevel = highestLevel[uid] || 0;
                if (diff < topLevel - 1) continue;
                const rawRate = slot.checkpoint_pass_rate ?? slot.success_chance ?? null;
                if (rawRate === null) continue;
                if (!cache[uid]) cache[uid] = { rateSum: 0, count: 0, entries: [] };
                cache[uid].rateSum += rawRate;
                cache[uid].count   += 1;
                cache[uid].entries.push({ diff, rate: rawRate });
            }
        }

        const result = {};
        for (const [uid, d] of Object.entries(cache)) {
            const cpr      = d.count > 0 ? d.rateSum / d.count : 0;
            const topLevel = highestLevel[uid] || 0;
            const joinable = cpr >= CONFIG.MINCPR + CONFIG.CPR_BOOST
                                ? Math.min(topLevel + 1, 10)
                                : topLevel;
            result[uid] = { cpr: Math.round(cpr * 10) / 10, highestLevel: topLevel, joinable, entries: d.entries };
        }
        return result;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  PROCESS MEMBERS
    // ═══════════════════════════════════════════════════════════════════════
    function processMembers(members, availableCrimes, cprCache) {
        const activeCutoff   = now() - CONFIG.ACTIVE_DAYS * 86400;
        const forecastCutoff = now() + CONFIG.FORECAST_HOURS * 3600;

        const memberOcMap = {};
        for (const crime of availableCrimes) {
            if (crime.status === 'Expired') continue;
            if (!Array.isArray(crime.slots)) continue;
            for (const slot of crime.slots) {
                const uid = slot.user_id ?? slot.user?.id;
                if (!uid) continue;
                memberOcMap[uid] = {
                    crimeDifficulty: crime.difficulty,
                    crimeStatus:     crime.status,
                    readyAt:         crime.ready_at ?? 0,
                    crimeId:         crime.id,
                    crimeName:       crime.name,
                };
            }
        }

        const eligible = [], skipped = [];

        for (const m of members) {
            const uid        = m.id;
            const lastAction = m.last_action?.timestamp ?? 0;
            if (lastAction < activeCutoff) {
                skipped.push({ ...m, skipReason: `Inactive >${CONFIG.ACTIVE_DAYS}d` });
                continue;
            }

            const ocInfo = memberOcMap[uid];
            const inOC   = !!ocInfo;
            if (inOC && ocInfo.readyAt > forecastCutoff) {
                skipped.push({ ...m, skipReason: `In OC (ready ${fmtTs(ocInfo.readyAt)})` });
                continue;
            }

            const cpr        = cprCache[uid] ?? null;
            const cprValue   = cpr?.cpr ?? null;
            const highestLvl = cpr?.highestLevel ?? 0;
            const joinable   = (cprValue === null || cprValue < CONFIG.MINCPR) ? 1 : (cpr?.joinable ?? 1);

            eligible.push({
                id:           uid,
                name:         m.name,
                lastAction,
                status:       m.status?.state ?? 'Unknown',
                inOC,
                ocReadyAt:    inOC ? ocInfo.readyAt : null,
                ocCrimeName:  inOC ? ocInfo.crimeName : null,
                ocStatus:     inOC ? ocInfo.crimeStatus : null,
                cpr:          cprValue,
                highestLevel: highestLvl,
                joinable,
                noCrimeHistory: cprValue === null,
                cprEntries:   cpr?.entries ?? [],
            });
        }
        return { eligible, skipped };
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  SLOT COUNT
    // ═══════════════════════════════════════════════════════════════════════
    function countOpenSlots(availableCrimes) {
        const slotMap = {};
        for (const crime of availableCrimes) {
            if (crime.status !== 'Recruiting') continue;
            const d = crime.difficulty;
            if (!slotMap[d]) slotMap[d] = { totalSlots: 0, openSlots: 0, crimes: [] };
            let open = 0, total = 0;
            for (const slot of (crime.slots || [])) {
                total++;
                if (!slot.user_id && !slot.user?.id) open++;
            }
            slotMap[d].totalSlots += total;
            slotMap[d].openSlots  += open;
            slotMap[d].crimes.push({ id: crime.id, name: crime.name, open, total });
        }
        return slotMap;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  RECOMMENDATIONS
    // ═══════════════════════════════════════════════════════════════════════
    function buildRecommendations(eligible, slotMap) {
        const recs = [];
        for (let lvl = 1; lvl <= 10; lvl++) {
            const membersForLevel = eligible.filter(m => m.joinable === lvl);
            const freeNow         = membersForLevel.filter(m => !m.inOC);
            const soonFree        = membersForLevel.filter(m => m.inOC);
            const totalNeeded     = freeNow.length + soonFree.length;
            const info            = slotMap[lvl] || { totalSlots: 0, openSlots: 0, crimes: [] };
            const deficit         = totalNeeded - info.openSlots;
            const action = totalNeeded === 0 ? 'none' : deficit > 0 ? 'spawn' : deficit === 0 ? 'ok' : 'surplus';
            recs.push({
                level: lvl, freeMembers: freeNow.length, soonMembers: soonFree.length,
                openSlots: info.openSlots, totalSlots: info.totalSlots,
                recruitingOCs: info.crimes.length, deficit, action,
                names: membersForLevel.map(m => m.name),
            });
        }
        return recs;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  RENDERING
    // ═══════════════════════════════════════════════════════════════════════
    function fmtTs(ts) {
        if (!ts) return '—';
        const d   = new Date(ts * 1000);
        const h   = d.getHours().toString().padStart(2, '0');
        const min = d.getMinutes().toString().padStart(2, '0');
        if (d.toDateString() === new Date().toDateString()) return `today ${h}:${min}`;
        return `${d.getMonth() + 1}/${d.getDate()} ${h}:${min}`;
    }

    function renderRecommendations(recs) {
        const rows = recs.map(r => {
            if (r.action === 'none') return '';
            let actionHtml;
            if (r.action === 'spawn') {
                actionHtml = `<span class="oc-tag-spawn">SPAWN +${r.deficit}</span>`;
            } else if (r.action === 'ok') {
                actionHtml = `<span class="oc-tag-ok">✓ Covered</span>`;
            } else {
                actionHtml = `<span class="oc-tag-surplus">+${Math.abs(r.deficit)} extra</span>`;
            }
            const soonBadge = r.soonMembers > 0
                ? ` <span class="oc-badge oc-badge-soon">+${r.soonMembers}</span>` : '';
            return `<tr class="oc-row-${r.action}">
                <td><b>Lvl ${r.level}</b></td>
                <td>${r.freeMembers}${soonBadge}</td>
                <td>${r.openSlots} / ${r.totalSlots} <span style="color:#374151">(${r.recruitingOCs})</span></td>
                <td>${actionHtml}</td>
            </tr>`;
        }).filter(Boolean).join('');

        if (!rows) return '<p class="oc-tag-none">No eligible members found for any level.</p>';
        return `<table class="oc-table">
            <thead><tr><th>Level</th><th>Free + Soon</th><th>Slots</th><th>Action</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    }

    function renderEligibleMembers(eligible) {
        cprBreakdownMap = {}; // reset on each render
        const sorted = [...eligible].sort((a, b) => (b.joinable - a.joinable) || a.name.localeCompare(b.name));
        const rows = sorted.map(m => {
            const statusBadge = m.inOC
                ? `<span class="oc-badge oc-badge-in">In OC → free ${fmtTs(m.ocReadyAt)}</span>`
                : `<span class="oc-badge oc-badge-free">Free</span>`;

            let cprClass = 'oc-cpr-low';
            if (m.cpr !== null && m.cpr >= 80)           cprClass = 'oc-cpr-high';
            else if (m.cpr !== null && m.cpr >= CONFIG.MINCPR) cprClass = 'oc-cpr-mid';

            let cprStr;
            if (m.cpr !== null) {
                // Store breakdown for tooltip
                cprBreakdownMap[m.id] = { name: m.name, cpr: m.cpr, entries: m.cprEntries };
                cprStr = `<span class="oc-cpr-click ${cprClass}" data-uid="${m.id}">${m.cpr}%</span>`;
            } else {
                cprStr = '<span class="oc-cpr-low">—</span>';
            }

            return `<tr>
                <td><span class="oc-member-name">${m.name}</span> <span class="oc-member-id">[${m.id}]</span></td>
                <td>${statusBadge}</td>
                <td>${cprStr}</td>
                <td style="color:#6b7280">${m.highestLevel > 0 ? m.highestLevel : '—'}</td>
                <td><b style="color:#74c69d">Lvl ${m.joinable}</b></td>
            </tr>`;
        }).join('');

        return `<table class="oc-table">
            <thead><tr><th>Member</th><th>Status</th><th>CPR</th><th>Highest</th><th>Joinable</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    }

    function renderBody(recs, eligible, skipped) {
        const totalMembers  = eligible.length + skipped.length;
        const eligibleCount = eligible.length;
        const freeCount     = eligible.filter(m => !m.inOC).length;
        const soonCount     = eligible.filter(m => m.inOC).length;
        const spawnLevels   = recs.filter(r => r.action === 'spawn').map(r => `Lvl ${r.level}`);

        const bannerHtml = spawnLevels.length
            ? `<div class="oc-spawn-banner">Spawn needed: ${spawnLevels.map(l => `<span class="oc-lvl-chip">${l}</span>`).join('')}</div>`
            : `<div class="oc-spawn-banner oc-banner-ok">✓ No additional spawns needed.</div>`;

        const skippedHtml = skipped.length > 0
            ? `<details style="margin-top:6px;">
                <summary style="cursor:pointer;color:#6b7280;font-size:11px;font-family:inherit;">${skipped.length} members skipped</summary>
                <table class="oc-table" style="margin-top:4px;">
                    <thead><tr><th>Member</th><th>Reason</th></tr></thead>
                    <tbody>${skipped.map(m =>
                        `<tr><td><span class="oc-member-name">${m.name}</span> <span class="oc-member-id">[${m.id}]</span></td><td style="color:#6b7280">${m.skipReason}</td></tr>`
                    ).join('')}</tbody>
                </table>
               </details>`
            : '';

        document.getElementById('oc-spawn-body').innerHTML = `
            <div class="oc-stats-strip">
                <span class="oc-stat-chip"><b>${totalMembers}</b> members</span>
                <span class="oc-stat-chip"><b>${eligibleCount}</b> eligible</span>
                <span class="oc-stat-chip"><b>${freeCount}</b> free now</span>
                <span class="oc-stat-chip"><b>${soonCount}</b> soon</span>
            </div>
            ${bannerHtml}
            <h3>Spawn Recommendations</h3>
            ${renderRecommendations(recs)}
            <h3>Eligible Members</h3>
            ${renderEligibleMembers(eligible)}
            ${skippedHtml}
            <p style="color:#374151;font-size:10px;margin-top:10px;">
                Config: ACTIVE_DAYS=${CONFIG.ACTIVE_DAYS} · FORECAST_HOURS=${CONFIG.FORECAST_HOURS}
                · MINCPR=${CONFIG.MINCPR}% · CPR_BOOST=${CONFIG.CPR_BOOST}%
                · Lookback=${CONFIG.CPR_LOOKBACK_DAYS}d
                &nbsp;·&nbsp; Updated: ${new Date().toLocaleTimeString()}
            </p>
        `;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  MAIN
    // ═══════════════════════════════════════════════════════════════════════
    async function runAnalysis() {
        const apiKey = getApiKey();
        if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
            document.getElementById('oc-spawn-key-row').style.display = 'flex';
            document.getElementById('oc-spawn-body').innerHTML =
                `<p class="oc-error">⚠ Enter your Torn API key above and click Save.</p>`;
            setStatus('API key not configured.');
            return;
        }

        const refreshBtn = document.getElementById('oc-spawn-refresh');
        refreshBtn.disabled = true;
        setStatus('Verifying faction membership…');
        document.getElementById('oc-spawn-body').innerHTML = '';

        try {
            const allowed = await verifyFaction(apiKey);
            if (!allowed) {
                document.getElementById('oc-spawn-body').innerHTML =
                    `<p class="oc-error">⛔ Access restricted to faction members only.</p>
                     <p style="color:#6b7280;font-size:11px;">Your API key is not associated with faction #${CONFIG.FACTION_ID}.</p>`;
                setStatus('Access denied.');
                return;
            }

            setStatus('Step 1: Fetching members and available crimes…');
            const [members, availableCrimes] = await Promise.all([
                fetchMembers(apiKey),
                fetchAvailableCrimes(apiKey),
            ]);
            setStatus('Step 2: Fetching completed crimes for CPR calculation…');
            const completedCrimes = await fetchCompletedCrimes(apiKey);

            setStatus('Analysing…');
            const cprCache           = buildCprCache(completedCrimes);
            const slotMap            = countOpenSlots(availableCrimes);
            const { eligible, skipped } = processMembers(members, availableCrimes, cprCache);
            const recs               = buildRecommendations(eligible, slotMap);

            renderBody(recs, eligible, skipped);
            setStatus(`Last updated: ${new Date().toLocaleTimeString()} · ${members.length} members · ${completedCrimes.length} completed crimes analysed`);

        } catch (err) {
            document.getElementById('oc-spawn-body').innerHTML =
                `<p class="oc-error">Error: ${err.message}</p>
                 <p style="color:#6b7280;font-size:11px;">Check: API key is correct and has Limited (or higher) faction access.</p>`;
            setStatus(`Error: ${err.message}`);
            console.error('[OC Spawn]', err);
        } finally {
            refreshBtn.disabled = false;
        }
    }

    if (window.location.href.includes('tab=crimes') ||
        window.location.hash.includes('crimes')) {
        panelVisible = true;
        panel.style.display = 'block';
    }

})();
