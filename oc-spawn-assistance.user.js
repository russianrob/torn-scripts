// ==UserScript==
// @name         OC Spawn Assistance
// @namespace    torn-oc-spawn-assistance
// @version      1.0.2
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
    //  CONFIG  —  edit these values to tune behavior
    // ═══════════════════════════════════════════════════════════════════════
    const CONFIG = {
        API_KEY:           'YOUR_API_KEY_HERE',   // Fallback: hardcode key here; UI input takes priority
        ACTIVE_DAYS:       7,    // Only plan for members last active within this many days
        FORECAST_HOURS:    24,   // Include members whose current OC finishes within this window
        MINCPR:            60,   // Minimum CPR% for a member to be eligible for slot matching
        CPR_BOOST:         15,   // If CPR >= MINCPR + CPR_BOOST → JOINABLE = highest_level + 1
        CPR_LOOKBACK_DAYS: 90,   // How many days of completed crimes to pull for CPR calculation
    };

    // ═══════════════════════════════════════════════════════════════════════
    //  API KEY RESOLUTION
    //  Priority: GM_getValue (saved in panel) → TornPDA injection → CONFIG
    // ═══════════════════════════════════════════════════════════════════════
    function getApiKey() {
        const saved = GM_getValue('oc_spawn_api_key', '');
        if (saved) return saved;
        // TornPDA injects the app's API key as window.localAPIkey
        if (typeof window.localAPIkey === 'string' && window.localAPIkey.length > 0)
            return window.localAPIkey;
        return CONFIG.API_KEY;
    }

    function saveApiKey(key) {
        GM_setValue('oc_spawn_api_key', key.trim());
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
            width: min(560px, calc(100vw - 32px));
            max-height: 72vh;
            overflow-y: auto;
            background: #1a1a2e;
            color: #e0e0e0;
            border: 1px solid #2d6a4f;
            border-radius: 8px;
            padding: 14px 16px;
            font-size: 12px;
            font-family: monospace;
            box-shadow: 0 4px 20px rgba(0,0,0,.6);
            display: none;
        }
        #oc-spawn-panel h2 {
            margin: 0 0 10px;
            font-size: 14px;
            color: #74c69d;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        #oc-spawn-panel h3 {
            margin: 10px 0 5px;
            font-size: 12px;
            color: #95d5b2;
            border-bottom: 1px solid #2d4a3e;
            padding-bottom: 3px;
        }
        .oc-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 10px;
            font-size: 11px;
        }
        .oc-table th {
            background: #1b4332;
            color: #b7e4c7;
            padding: 4px 6px;
            text-align: left;
        }
        .oc-table td {
            padding: 3px 6px;
            border-bottom: 1px solid #2d4a3e;
            vertical-align: top;
        }
        .oc-table tr:hover td { background: #162032; }
        .oc-tag-spawn   { color: #f4a261; font-weight: bold; }
        .oc-tag-ok      { color: #74c69d; }
        .oc-tag-surplus { color: #90e0ef; }
        .oc-tag-none    { color: #888; }
        .oc-badge {
            display: inline-block;
            padding: 1px 5px;
            border-radius: 3px;
            font-size: 10px;
            margin-left: 3px;
        }
        .oc-badge-in  { background: #264653; color: #90e0ef; }
        .oc-badge-soon{ background: #3d3030; color: #f4a261; }
        .oc-badge-free { background: #1b4332; color: #74c69d; }
        #oc-spawn-status {
            color: #aaa;
            font-style: italic;
            margin: 4px 0 8px;
            font-size: 11px;
        }
        #oc-spawn-refresh {
            background: #2d6a4f;
            color: #fff;
            border: none;
            border-radius: 4px;
            padding: 4px 10px;
            cursor: pointer;
            font-size: 11px;
        }
        #oc-spawn-refresh:hover { background: #1b4332; }
        #oc-spawn-refresh:disabled { opacity: .5; cursor: default; }
        .oc-error { color: #e76f51; font-weight: bold; }
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
            <button id="oc-spawn-refresh">↻ Refresh</button>
        </h2>
        <div id="oc-spawn-status">Click Refresh to load data.</div>
        <div id="oc-spawn-key-row" style="display:none;margin-bottom:8px;">
            <input id="oc-spawn-key-input" type="password" placeholder="Paste Torn API key…"
                style="width:calc(100% - 74px);padding:4px 6px;background:#0d1b2a;color:#e0e0e0;
                       border:1px solid #2d6a4f;border-radius:4px;font-size:11px;font-family:monospace;"/>
            <button id="oc-spawn-key-save"
                style="margin-left:4px;padding:4px 8px;background:#2d6a4f;color:#fff;
                       border:none;border-radius:4px;font-size:11px;cursor:pointer;">Save</button>
        </div>
        <div id="oc-spawn-body"></div>
    `;
    document.body.appendChild(panel);

    let panelVisible = false;
    toggleBtn.addEventListener('click', () => {
        panelVisible = !panelVisible;
        panel.style.display = panelVisible ? 'block' : 'none';
    });
    document.getElementById('oc-spawn-refresh').addEventListener('click', runAnalysis);

    // Show key input row if no key is configured yet
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

    // Normalise members — v2 may return object keyed by id or an array
    function normMembers(raw) {
        if (Array.isArray(raw)) return raw;
        return Object.values(raw);
    }

    // Normalise crimes — same issue
    function normCrimes(raw) {
        if (Array.isArray(raw)) return raw;
        return Object.values(raw);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  API CALLS
    // ═══════════════════════════════════════════════════════════════════════
    async function fetchMembers(key) {
        const data = await apiFetch(
            `https://api.torn.com/v2/faction/members?key=${key}`
        );
        return normMembers(data.members);
    }

    async function fetchAvailableCrimes(key) {
        const data = await apiFetch(
            `https://api.torn.com/v2/faction/crimes?cat=available&key=${key}`
        );
        return normCrimes(data.crimes || []);
    }

    async function fetchCompletedCrimes(key) {
        const fromTs = now() - CONFIG.CPR_LOOKBACK_DAYS * 86400;
        const data = await apiFetch(
            `https://api.torn.com/v2/faction/crimes?cat=completed&sort=DESC&from=${fromTs}&key=${key}`
        );
        return normCrimes(data.crimes || []);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  STEP 2 — BUILD CPR CACHE FROM COMPLETED CRIMES
    //
    //  Per player:  { cpr: <0-100 float>, highestLevel: <1-10 int> }
    //  CPR = average of slot.checkpoint_pass_rate * 100  (or success_chance
    //        if checkpoint_pass_rate absent — see note below)
    // ═══════════════════════════════════════════════════════════════════════
    function buildCprCache(completedCrimes) {
        // Map: playerId → { rateSum, count, highestLevel }
        const cache = {};

        for (const crime of completedCrimes) {
            const diff = crime.difficulty || 0;
            if (!Array.isArray(crime.slots)) continue;

            for (const slot of crime.slots) {
                const uid = slot.user_id ?? slot.user?.id;
                if (!uid) continue;

                // checkpoint_pass_rate is the primary CPR source;
                // fall back to success_chance if not present (older/different responses)
                const rawRate = slot.checkpoint_pass_rate ?? slot.success_chance ?? null;
                if (rawRate === null) continue;

                if (!cache[uid]) cache[uid] = { rateSum: 0, count: 0, highestLevel: 0 };
                cache[uid].rateSum    += rawRate * 100;   // convert 0-1 → 0-100
                cache[uid].count      += 1;
                if (diff > cache[uid].highestLevel) cache[uid].highestLevel = diff;
            }
        }

        // Collapse to { cpr, highestLevel, joinable }
        const result = {};
        for (const [uid, d] of Object.entries(cache)) {
            const cpr        = d.count > 0 ? d.rateSum / d.count : 0;
            const joinable   = cpr >= CONFIG.MINCPR + CONFIG.CPR_BOOST
                                ? Math.min(d.highestLevel + 1, 10)
                                : d.highestLevel;
            result[uid] = { cpr: Math.round(cpr * 10) / 10, highestLevel: d.highestLevel, joinable };
        }
        return result;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  STEP 1 — PROCESS MEMBERS vs AVAILABLE CRIMES
    //
    //  "In OC" = member id appears in any available crime slot (status ≠ Expired)
    //  "OC ready at" = the crime's ready_at (planning finishes), or planning_at
    //                  for Recruiting crimes that are about to fill
    // ═══════════════════════════════════════════════════════════════════════
    function processMembers(members, availableCrimes, cprCache) {
        const activeCutoff    = now() - CONFIG.ACTIVE_DAYS * 86400;
        const forecastCutoff  = now() + CONFIG.FORECAST_HOURS * 3600;

        // Build: uid → { crimeDifficulty, status, readyAt }
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

        const eligible = [];
        const skipped  = [];

        for (const m of members) {
            const uid        = m.id;
            const lastAction = m.last_action?.timestamp ?? 0;
            const inactive   = lastAction < activeCutoff;

            if (inactive) {
                skipped.push({ ...m, skipReason: `Inactive >${CONFIG.ACTIVE_DAYS}d` });
                continue;
            }

            const ocInfo = memberOcMap[uid];
            const inOC   = !!ocInfo;

            // If in OC but won't be free within FORECAST window → skip
            if (inOC && ocInfo.readyAt > forecastCutoff) {
                skipped.push({ ...m, skipReason: `In OC (ready ${fmtTs(ocInfo.readyAt)})` });
                continue;
            }

            const cpr         = cprCache[uid] ?? null;
            const cprValue    = cpr?.cpr ?? null;
            const highestLvl  = cpr?.highestLevel ?? 0;
            const joinable    = cpr?.joinable ?? 0;

            // If CPR below minimum threshold → skip
            if (cprValue !== null && cprValue < CONFIG.MINCPR) {
                skipped.push({ ...m, skipReason: `CPR ${cprValue}% < ${CONFIG.MINCPR}%` });
                continue;
            }

            eligible.push({
                id:           uid,
                name:         m.name,
                lastAction:   lastAction,
                status:       m.status?.state ?? 'Unknown',
                inOC:         inOC,
                ocReadyAt:    inOC ? ocInfo.readyAt : null,
                ocCrimeName:  inOC ? ocInfo.crimeName : null,
                ocStatus:     inOC ? ocInfo.crimeStatus : null,
                cpr:          cprValue,
                highestLevel: highestLvl,
                joinable:     joinable,
                noCrimeHistory: cprValue === null,
            });
        }

        return { eligible, skipped };
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  STEP 2 — COUNT OPEN SLOTS IN RECRUITING CRIMES
    // ═══════════════════════════════════════════════════════════════════════
    function countOpenSlots(availableCrimes) {
        // Map: difficulty → { totalSlots, openSlots, crimes: [] }
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
            slotMap[d].crimes.push({
                id:    crime.id,
                name:  crime.name,
                open:  open,
                total: total,
            });
        }
        return slotMap;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  STEP 3 — SPAWN RECOMMENDATION
    //
    //  For each level 1-10:
    //    eligible members with joinable = level vs open slots at that level
    //    DEFICIT → recommend spawning; SURPLUS → no action needed
    // ═══════════════════════════════════════════════════════════════════════
    function buildRecommendations(eligible, slotMap) {
        // Members who are CURRENTLY free (not in any OC) contribute immediately
        // Members in OC-ending-soon contribute to the forecast pool
        const recs = [];

        for (let lvl = 1; lvl <= 10; lvl++) {
            const membersForLevel = eligible.filter(m => m.joinable === lvl);
            const freeNow         = membersForLevel.filter(m => !m.inOC);
            const soonFree        = membersForLevel.filter(m => m.inOC);

            const info     = slotMap[lvl] || { totalSlots: 0, openSlots: 0, crimes: [] };
            const openNow  = info.openSlots;
            const deficit  = freeNow.length - openNow;  // positive = need more slots, negative = surplus slots

            let action;
            if (freeNow.length === 0 && soonFree.length === 0) {
                action = 'none';
            } else if (deficit > 0) {
                action = `spawn`;   // more eligible members than open slots
            } else if (deficit === 0 && freeNow.length > 0) {
                action = 'ok';      // exact match
            } else {
                action = 'surplus'; // more slots than members
            }

            recs.push({
                level:          lvl,
                freeMembers:    freeNow.length,
                soonMembers:    soonFree.length,
                openSlots:      openNow,
                totalSlots:     info.totalSlots,
                recruitingOCs:  info.crimes.length,
                deficit:        deficit,
                action:         action,
                names:          membersForLevel.map(m => m.name),
            });
        }
        return recs;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  UI RENDERING
    // ═══════════════════════════════════════════════════════════════════════
    function fmtTs(ts) {
        if (!ts) return '—';
        const d = new Date(ts * 1000);
        const h = d.getHours().toString().padStart(2, '0');
        const min = d.getMinutes().toString().padStart(2, '0');
        const today = new Date();
        if (d.toDateString() === today.toDateString()) return `today ${h}:${min}`;
        return `${d.getMonth() + 1}/${d.getDate()} ${h}:${min}`;
    }

    function renderRecommendations(recs) {
        const rows = recs.map(r => {
            if (r.action === 'none') return '';
            let actionHtml;
            if (r.action === 'spawn') {
                actionHtml = `<span class="oc-tag-spawn">SPAWN ${r.deficit} more lvl ${r.level}</span>`;
            } else if (r.action === 'ok') {
                actionHtml = `<span class="oc-tag-ok">✓ Covered</span>`;
            } else {
                actionHtml = `<span class="oc-tag-surplus">Surplus (${Math.abs(r.deficit)} extra slots)</span>`;
            }
            const soonBadge = r.soonMembers > 0
                ? `<span class="oc-badge oc-badge-soon">+${r.soonMembers} soon</span>` : '';
            return `
                <tr>
                    <td><b>Lvl ${r.level}</b></td>
                    <td>${r.freeMembers}${soonBadge}</td>
                    <td>${r.openSlots} / ${r.totalSlots} <span style="color:#666">(${r.recruitingOCs} OCs)</span></td>
                    <td>${actionHtml}</td>
                </tr>`;
        }).filter(Boolean).join('');

        if (!rows) return '<p class="oc-tag-none">No eligible members found for any level.</p>';

        return `
            <table class="oc-table">
                <thead>
                    <tr>
                        <th>Level</th>
                        <th>Eligible (free + soon)</th>
                        <th>Open / Total Slots</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>`;
    }

    function renderEligibleMembers(eligible) {
        const sorted = [...eligible].sort((a, b) => (b.joinable - a.joinable) || a.name.localeCompare(b.name));
        const rows = sorted.map(m => {
            let statusBadge;
            if (m.inOC) {
                statusBadge = `<span class="oc-badge oc-badge-soon">In OC → free ${fmtTs(m.ocReadyAt)}</span>`;
            } else {
                statusBadge = `<span class="oc-badge oc-badge-free">Free</span>`;
            }
            const cprStr = m.cpr !== null ? `${m.cpr}%` : '<span style="color:#888">No data</span>';
            const lvlStr = m.joinable > 0 ? `Lvl ${m.joinable}` : '<span style="color:#888">—</span>';
            return `
                <tr>
                    <td>${m.name} [${m.id}]</td>
                    <td>${statusBadge}</td>
                    <td>${cprStr}</td>
                    <td>${m.highestLevel > 0 ? m.highestLevel : '—'}</td>
                    <td>${lvlStr}</td>
                </tr>`;
        }).join('');

        return `
            <table class="oc-table">
                <thead>
                    <tr>
                        <th>Member</th>
                        <th>OC Status</th>
                        <th>CPR</th>
                        <th>Highest Lvl</th>
                        <th>JOINABLE</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>`;
    }

    function renderBody(recs, eligible, skipped, cprCache, slotMap) {
        const totalMembers    = eligible.length + skipped.length;
        const eligibleCount   = eligible.length;
        const freeCount       = eligible.filter(m => !m.inOC).length;
        const soonCount       = eligible.filter(m => m.inOC).length;
        const spawnLevels     = recs.filter(r => r.action === 'spawn').map(r => `Lvl ${r.level}`);
        const spawnMsg        = spawnLevels.length
            ? `<span class="oc-tag-spawn">Recommended spawns: ${spawnLevels.join(', ')}</span>`
            : `<span class="oc-tag-ok">No additional spawns needed right now.</span>`;

        const skippedHtml = skipped.length > 0
            ? `<details style="margin-top:6px;">
                <summary style="cursor:pointer;color:#888;font-size:11px;">${skipped.length} members skipped (click to expand)</summary>
                <table class="oc-table" style="margin-top:4px;">
                    <thead><tr><th>Member</th><th>Reason</th></tr></thead>
                    <tbody>${skipped.map(m =>
                        `<tr><td>${m.name} [${m.id}]</td><td style="color:#888">${m.skipReason}</td></tr>`
                    ).join('')}</tbody>
                </table>
               </details>`
            : '';

        document.getElementById('oc-spawn-body').innerHTML = `
            <div style="margin-bottom:8px;line-height:1.6;">
                Analyzed <b>${totalMembers}</b> members &nbsp;·&nbsp;
                <b>${eligibleCount}</b> eligible &nbsp;·&nbsp;
                <b>${freeCount}</b> free now &nbsp;·&nbsp;
                <b>${soonCount}</b> freeing within ${CONFIG.FORECAST_HOURS}h
            </div>
            <div style="margin-bottom:10px;padding:6px 10px;background:#1b2e1e;border-radius:4px;">
                ${spawnMsg}
            </div>

            <h3>▸ Spawn Recommendations (by Level)</h3>
            ${renderRecommendations(recs)}

            <h3>▸ Eligible Member Details</h3>
            ${renderEligibleMembers(eligible)}

            ${skippedHtml}

            <p style="color:#555;font-size:10px;margin-top:10px;">
                Config: ACTIVE_DAYS=${CONFIG.ACTIVE_DAYS} · FORECAST_HOURS=${CONFIG.FORECAST_HOURS}
                · MINCPR=${CONFIG.MINCPR}% · CPR_BOOST=${CONFIG.CPR_BOOST}%
                · Lookback=${CONFIG.CPR_LOOKBACK_DAYS}d
                &nbsp;·&nbsp; Updated: ${new Date().toLocaleTimeString()}
            </p>
        `;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  MAIN ANALYSIS RUNNER
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
        setStatus('Fetching data…');
        document.getElementById('oc-spawn-body').innerHTML = '';

        try {
            // ── Parallel: members + available crimes ─────────────────────
            setStatus('Step 1: Fetching members and available crimes…');
            const [members, availableCrimes] = await Promise.all([
                fetchMembers(apiKey),
                fetchAvailableCrimes(apiKey),
            ]);

            // ── Completed crimes for CPR ──────────────────────────────────
            setStatus('Step 2: Fetching completed crimes for CPR calculation…');
            const completedCrimes = await fetchCompletedCrimes(apiKey);

            // ── Analysis ─────────────────────────────────────────────────
            setStatus('Analysing…');
            const cprCache   = buildCprCache(completedCrimes);
            const slotMap    = countOpenSlots(availableCrimes);
            const { eligible, skipped } = processMembers(members, availableCrimes, cprCache);
            const recs       = buildRecommendations(eligible, slotMap);

            // ── Render ───────────────────────────────────────────────────
            renderBody(recs, eligible, skipped, cprCache, slotMap);
            setStatus(`Last updated: ${new Date().toLocaleTimeString()} · ${members.length} members · ${completedCrimes.length} completed crimes analysed`);

        } catch (err) {
            document.getElementById('oc-spawn-body').innerHTML =
                `<p class="oc-error">Error: ${err.message}</p>
                 <p style="color:#888;font-size:11px;">Check: API key is correct and has Limited (or higher) faction access.</p>`;
            setStatus(`Error: ${err.message}`);
            console.error('[OC Spawn]', err);
        } finally {
            refreshBtn.disabled = false;
        }
    }

    // Auto-open panel if URL is on the crimes tab
    if (window.location.href.includes('tab=crimes') ||
        window.location.hash.includes('crimes')) {
        panelVisible = true;
        panel.style.display = 'block';
    }

})();
