// ==UserScript==
// @name         Torn – CE per Nerve Tracker
// @namespace    https://torn.com
// @version      1.0.0
// @description  Tracks skill (CE) gain per nerve spent for every crime type and ranks them so you know which crime grows your nerve bar fastest.
// @author       Custom
// @match        https://www.torn.com/loader.php?sid=crimes*
// @match        https://torn.com/loader.php?sid=crimes*
// @match        https://www.torn.com/page.php?sid=crimes*
// @match        https://torn.com/page.php?sid=crimes*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * HOW IT WORKS
 * ─────────────────────────────────────────────────────────────────────────
 * 1. Intercepts the Torn crimes page's own internal fetch calls.
 * 2. When you commit a crime (step=attempt):
 *    - Reads your current "Skill" stat from the DOM (before the crime resolves).
 *    - Reads the updated "Skill" from the API response (after).
 *    - Determines the nerve cost from cached crimesByType data or DOM fallback.
 *    - Stores: totalSkillGain / totalNerveSpent per crime type.
 * 3. Displays a draggable ranked panel: "Skill/10 nerve" = efficiency metric.
 *    Higher = that crime type grows your NNB (Natural Nerve Bar) faster per nerve.
 *
 * NERVE COST DETECTION
 * ─────────────────────────────────────────────────────────────────────────
 * Nerve cost is pulled (in order of priority):
 *   1. Cached from the crimesList or attempt response's crimesByType data.
 *   2. From `data.DB.outcome.*` or `data.DB.*` fields in the attempt response.
 *   3. DOM fallback – looks for nerve-labelled stat elements.
 * If none work on the first attempt, DEBUG=true logs will show the full
 * data.DB structure so the correct path can be identified and hardcoded.
 *
 * PANEL COLUMNS
 * ─────────────────────────────────────────────────────────────────────────
 *   #          Rank (1 = best for NNB growth)
 *   Crime      Crime type name
 *   Skill/10n  Average skill gained per 10 nerve spent (efficiency)
 *   Succ%      Success rate across all recorded attempts
 *   n          Total attempts recorded
 *
 * ⚠ Low sample warning shown when n < 10 (rankings may be unreliable).
 *
 * DATA STORAGE
 * ─────────────────────────────────────────────────────────────────────────
 * All data is stored in localStorage under keys prefixed with "ce_nrv_v1".
 * Nothing is sent anywhere. Use the Reset button to clear all data.
 */

(function () {
    'use strict';

    // ── Config ────────────────────────────────────────────────────────────
    const STORAGE_KEY = 'ce_nrv_v1';

    /**
     * Set DEBUG = true to see detailed console logs on every crime attempt.
     * This is useful for the first few runs to verify nerve cost detection is
     * working. The logs will show the full data.DB key list if nerve cost
     * cannot be found, so you can identify the correct field path.
     */
    const DEBUG = true;

    // ── Environment ────────────────────────────────────────────────────────
    // unsafeWindow is required to intercept the page's actual fetch (not sandbox)
    const win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    // ── Crime type name lookup (Crimes 2.0 typeIDs) ───────────────────────
    const TYPE_NAMES = {
        '1':  'Search for Cash',
        '2':  'Bootlegging',
        '3':  'Shoplifting',
        '4':  'Card Skimming',
        '5':  'Burglary',
        '6':  'Pickpocketing',
        '7':  'Hustling',
        '8':  'Disposal',
        '9':  'Cracking',
        '10': 'Graffiti',
        '11': 'Murder',
        '12': 'Scamming',
        '13': 'Arson',
    };

    // ── Persisted maps ─────────────────────────────────────────────────────
    // nerveCostMap: { crimeID|typeID -> nerveRequired }
    let nerveCostMap  = JSON.parse(localStorage.getItem(STORAGE_KEY + '_ncm') || '{}');
    // crimeNameMap:  { crimeID -> displayName }
    let crimeNameMap  = JSON.parse(localStorage.getItem(STORAGE_KEY + '_cnm') || '{}');

    const saveMaps = () => {
        localStorage.setItem(STORAGE_KEY + '_ncm', JSON.stringify(nerveCostMap));
        localStorage.setItem(STORAGE_KEY + '_cnm', JSON.stringify(crimeNameMap));
    };

    // ── Stats storage ──────────────────────────────────────────────────────
    const loadStats = () => {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
        catch { return {}; }
    };
    const saveStats = (d) => localStorage.setItem(STORAGE_KEY, JSON.stringify(d));

    // ── DOM helpers ─────────────────────────────────────────────────────────

    /**
     * Reads a named stat value from the crimes page stats bar.
     * The stats bar uses React-generated class names like "statistic___abc123"
     * and "value___abc123", so we match with startsWith selectors.
     */
    function readDOMStat(label) {
        const items = document.querySelectorAll(
            'li[class^="statistic"], li[class*=" statistic"]'
        );
        for (const li of items) {
            for (const sp of li.querySelectorAll('span')) {
                if (sp.textContent.trim() === label) {
                    const val = li.querySelector(
                        'span[class^="value"], span[class*=" value"]'
                    );
                    if (val) return val.textContent.trim();
                }
            }
        }
        return null;
    }

    /** Reads the current crime's skill value from the DOM (before the attempt). */
    function readSkillFromDOM() {
        const raw = readDOMStat('Skill');
        if (raw == null) return null;
        const n = parseFloat(raw.replace(/[^\d.]/g, ''));
        return isNaN(n) ? null : n;
    }

    /** Fallback DOM search for nerve cost if crimesByType cache misses. */
    function readNerveCostFromDOM() {
        // 1. Stats bar "Nerve" label
        const raw = readDOMStat('Nerve');
        if (raw != null) {
            const n = parseInt(raw);
            if (n >= 1 && n <= 50) return n;
        }

        // 2. Elements with "nerve" in class names
        for (const el of document.querySelectorAll('[class*="nerve"]')) {
            const n = parseInt(el.textContent.trim());
            if (!isNaN(n) && n >= 1 && n <= 30) return n;
        }

        // 3. Text pattern "X nerve" anywhere visible on page (last resort)
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            const m = node.textContent.trim().match(/^(\d{1,2})\s*nerve$/i);
            if (m) {
                const n = parseInt(m[1]);
                if (n >= 1 && n <= 30) return n;
            }
        }

        return null;
    }

    // ── Parse crimesByType for nerve costs & names ──────────────────────────

    /**
     * Attempts to extract nerve costs and sub-crime names from crimesByType data.
     * The exact structure is unknown until the first crimesList response is logged
     * (DEBUG=true). Multiple candidate field names are tried.
     */
    function extractFromCrimesByType(ctd, contextUrl) {
        if (!ctd) return;

        const processItem = (item) => {
            if (!item || typeof item !== 'object') return;
            const id = String(
                item.id ?? item.crimeID ?? item.crime_id ?? item.subID ?? ''
            );
            if (!id) return;

            const nerve = item.nerve ?? item.nerveCost ?? item.nerve_cost ??
                          item.nerveRequired ?? item.nerve_required ??
                          item.nerveUsed ?? null;
            if (nerve != null) nerveCostMap[id] = Number(nerve);

            const name = item.name ?? item.crimeName ?? item.crime_name ??
                         item.title ?? item.label ?? null;
            if (name) crimeNameMap[id] = String(name);
        };

        // Handle various possible structures
        if (Array.isArray(ctd)) {
            for (const type of ctd) {
                processItem(type);
                for (const key of ['crimes', 'targets', 'crimeList', 'list']) {
                    if (Array.isArray(type[key])) type[key].forEach(processItem);
                }
            }
        } else if (typeof ctd === 'object') {
            processItem(ctd);
            for (const key of ['crimes', 'targets', 'crimeList', 'list']) {
                if (Array.isArray(ctd[key])) ctd[key].forEach(processItem);
            }
        }

        if (DEBUG) {
            console.log('[CE Tracker] crimesByType keys:', Object.keys(ctd));
            console.log('[CE Tracker] crimesByType sample:', JSON.stringify(ctd).substring(0, 700));
            console.log('[CE Tracker] nerveCostMap now:', nerveCostMap);
        }

        saveMaps();
    }

    // ── Fetch intercept ────────────────────────────────────────────────────

    const origFetch = win.fetch;

    win.fetch = async function (...args) {
        const response = await origFetch.apply(this, args);
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');

        // Only care about the crimes data endpoint
        if (!url.includes('sid=crimesData')) return response;

        // ── crimesList: build nerve cost / name maps ──────────────────────
        if (url.includes('step=crimesList')) {
            response.clone().text().then(body => {
                try {
                    const data = JSON.parse(body);
                    if (data?.DB?.crimesByType) {
                        extractFromCrimesByType(data.DB.crimesByType, url);
                    }
                } catch { /* ignore parse errors */ }
            });
        }

        // ── attempt: record skill gain & nerve cost ───────────────────────
        if (url.includes('step=attempt')) {
            // Read skill BEFORE from DOM — must happen synchronously here,
            // before the DOM updates with the result.
            const skillBefore = readSkillFromDOM();

            const typeID  = (url.match(/typeID=([^&\s]+)/)  || [])[1];
            const crimeID = (url.match(/crimeID=([^&\s]+)/) || [])[1];

            response.clone().text().then(body => {
                try {
                    const data = JSON.parse(body);
                    if (!data?.DB?.outcome) return;
                    if (data.DB.outcome.result === 'error') return;

                    if (DEBUG) {
                        console.log('[CE Tracker] ── New attempt ──');
                        console.log('[CE Tracker] typeID:', typeID, '| crimeID:', crimeID);
                        console.log('[CE Tracker] DB keys:', Object.keys(data.DB));
                        console.log('[CE Tracker] outcome:', JSON.stringify(data.DB.outcome).substring(0, 300));
                        if (data.DB.currentUserStatistics) {
                            console.log('[CE Tracker] currentUserStatistics:',
                                JSON.stringify(data.DB.currentUserStatistics).substring(0, 400));
                        }
                    }

                    // Also try to extract nerve costs from the attempt response
                    if (data.DB.crimesByType) {
                        extractFromCrimesByType(data.DB.crimesByType, url);
                    }

                    const outcome = data.DB.outcome.result; // 'success' | 'failure' | 'critical failure'

                    // ── Skill after ──────────────────────────────────────
                    const statsArr = data.DB.currentUserStatistics || [];
                    // Try to find the Skill stat by name; fall back to index 0
                    const skillStat = statsArr.find(s =>
                        (s.name  || '').toLowerCase().includes('skill') ||
                        (s.type  || '').toLowerCase().includes('skill') ||
                        (s.label || '').toLowerCase().includes('skill')
                    );
                    const rawSkillAfter = skillStat?.value ?? statsArr[0]?.value;
                    const skillAfter = (rawSkillAfter != null)
                        ? parseFloat(String(rawSkillAfter).replace(/[^\d.]/g, ''))
                        : null;

                    // ── Nerve cost ───────────────────────────────────────
                    // Priority: cached map → outcome fields → DB root → DOM
                    let nerveCost =
                        nerveCostMap[crimeID] ??
                        nerveCostMap[typeID]  ??
                        null;

                    if (!nerveCost) {
                        // Look inside outcome object
                        nerveCost =
                            data.DB.outcome?.nerve        ??
                            data.DB.outcome?.nerveCost    ??
                            data.DB.outcome?.nerveUsed    ??
                            data.DB.outcome?.nerve_cost   ??
                            null;
                    }
                    if (!nerveCost) {
                        // Look at DB root level
                        nerveCost =
                            data.DB.nerveCost  ??
                            data.DB.nerveUsed  ??
                            data.DB.nerve      ??
                            null;
                    }
                    if (!nerveCost) {
                        // DOM fallback
                        nerveCost = readNerveCostFromDOM();
                    }

                    if (DEBUG) {
                        console.log('[CE Tracker] skillBefore:', skillBefore,
                            '| skillAfter:', skillAfter,
                            '| nerveCost:', nerveCost,
                            '| outcome:', outcome);
                        if (!nerveCost) {
                            console.warn('[CE Tracker] ⚠ Nerve cost NOT found. ' +
                                'Check data.DB keys above or add a nerve-detection rule. ' +
                                'Full outcome:', JSON.stringify(data.DB.outcome));
                        }
                    }

                    // Record only when we have all required data
                    if (typeID && skillBefore != null && skillAfter != null && nerveCost) {
                        recordAttempt(typeID, crimeID, skillBefore, skillAfter,
                                      Number(nerveCost), outcome);
                        setTimeout(renderPanel, 150);
                    } else {
                        if (DEBUG) console.warn('[CE Tracker] Skipped recording — missing:',
                            { typeID, skillBefore, skillAfter, nerveCost });
                    }

                } catch (err) {
                    if (DEBUG) console.error('[CE Tracker] Error processing attempt:', err);
                }
            });
        }

        return response;
    };

    // ── Record attempt ─────────────────────────────────────────────────────

    function recordAttempt(typeID, crimeID, skillBefore, skillAfter, nerveCost, outcome) {
        const stats = loadStats();
        const key   = typeID; // Track per type (covers all sub-crimes in the type)

        if (!stats[key]) {
            stats[key] = {
                typeID,
                name:             TYPE_NAMES[typeID] || `Type ${typeID}`,
                attempts:         0,
                successes:        0,
                failures:         0,
                criticals:        0,
                totalSkillGain:   0,
                totalNerveSpent:  0,
                lastUpdated:      0,
            };
        }

        const s     = stats[key];
        const delta = skillAfter - skillBefore;

        s.attempts++;
        s.totalNerveSpent += nerveCost;
        s.lastUpdated      = Date.now();

        switch (outcome) {
            case 'success':
                s.successes++;
                // Only count positive gain on success (floating-point guard)
                s.totalSkillGain += Math.max(0, delta);
                break;
            case 'failure':
                s.failures++;
                // Failures cost nerve but grant no skill; total is unaffected
                break;
            case 'critical failure':
                s.criticals++;
                // Critical failures can reduce skill (delta will be negative)
                s.totalSkillGain += delta;
                break;
        }

        saveStats(stats);

        if (DEBUG) console.log(
            `[CE Tracker] Recorded | type=${typeID} outcome=${outcome}` +
            ` delta=${delta.toFixed(4)} nerve=${nerveCost}` +
            ` running eff=${(s.totalSkillGain / s.totalNerveSpent).toFixed(4)}`
        );
    }

    // ── Panel CSS ──────────────────────────────────────────────────────────

    function injectCSS() {
        if (document.getElementById('ce-nrv-css')) return;
        const style = document.createElement('style');
        style.id = 'ce-nrv-css';
        style.textContent = `
            #ce-nrv {
                position: fixed;
                top: 75px;
                right: 8px;
                width: 300px;
                background: #111827;
                border: 1px solid #374151;
                border-radius: 8px;
                color: #d1d5db;
                font: 12px/1.45 Arial, sans-serif;
                z-index: 99999;
                box-shadow: 0 6px 24px rgba(0,0,0,.7);
                user-select: none;
            }
            #ce-nrv-hd {
                padding: 7px 10px;
                background: #1f2937;
                border-radius: 8px 8px 0 0;
                display: flex;
                justify-content: space-between;
                align-items: center;
                cursor: move;
                border-bottom: 1px solid #374151;
            }
            #ce-nrv-hd b { font-size: 12px; color: #93c5fd; }
            .ce-btn {
                background: #374151;
                border: none;
                color: #d1d5db;
                padding: 2px 7px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 10px;
                margin-left: 4px;
            }
            .ce-btn:hover { background: #4b5563; }
            #ce-nrv-body {
                padding: 6px 8px;
                max-height: 360px;
                overflow-y: auto;
            }
            #ce-nrv-foot {
                padding: 4px 8px;
                border-top: 1px solid #374151;
                color: #6b7280;
                font-size: 10px;
                border-radius: 0 0 8px 8px;
            }
            .ce-th {
                display: grid;
                grid-template-columns: 18px 1fr 62px 48px 34px;
                gap: 3px;
                padding: 2px 4px 5px;
                border-bottom: 1px solid #374151;
                color: #6b7280;
                font-size: 10px;
                margin-bottom: 3px;
            }
            .ce-row {
                display: grid;
                grid-template-columns: 18px 1fr 62px 48px 34px;
                gap: 3px;
                padding: 3px 4px;
                border-radius: 4px;
                align-items: center;
            }
            .ce-row:hover { background: rgba(255,255,255,.04); }
            .ce-rank { color: #6b7280; font-size: 10px; text-align: center; }
            .ce-name { font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .ce-val  { font-weight: 700; text-align: right; font-size: 12px; }
            .ce-sr   { text-align: right; color: #9ca3af; font-size: 10px; }
            .ce-n    { text-align: right; color: #6b7280; font-size: 10px; }
            .ce-none { padding: 14px 8px; color: #6b7280; text-align: center; font-size: 11px; line-height: 1.8; }
            /* Rank colors */
            .g1 { color: #34d399; }
            .g2 { color: #86efac; }
            .g3 { color: #fbbf24; }
            .g4 { color: #f97316; }
            .g5 { color: #f87171; }
            /* Collapsed state */
            #ce-nrv.collapsed #ce-nrv-body,
            #ce-nrv.collapsed #ce-nrv-foot { display: none; }
        `;
        document.head.appendChild(style);
    }

    // ── Panel build ────────────────────────────────────────────────────────

    function buildPanel() {
        if (document.getElementById('ce-nrv')) return;
        injectCSS();

        const panel = document.createElement('div');
        panel.id = 'ce-nrv';
        panel.innerHTML = `
            <div id="ce-nrv-hd">
                <b>⚡ CE / Nerve Tracker</b>
                <div>
                    <button class="ce-btn" id="ce-tog">▼</button>
                    <button class="ce-btn" id="ce-rst">Reset</button>
                </div>
            </div>
            <div id="ce-nrv-body">
                <div class="ce-none">
                    Commit crimes to begin tracking.<br>
                    Rankings persist across sessions.
                </div>
            </div>
            <div id="ce-nrv-foot">Skill gain per 10 nerve &nbsp;·&nbsp; green = best NNB growth</div>
        `;
        document.body.appendChild(panel);

        // Restore saved position
        const pos = JSON.parse(localStorage.getItem(STORAGE_KEY + '_pos') || 'null');
        if (pos) {
            panel.style.top   = pos.top;
            panel.style.left  = pos.left;
            panel.style.right = 'auto';
        }

        // Toggle collapse
        document.getElementById('ce-tog').addEventListener('click', () => {
            panel.classList.toggle('collapsed');
            document.getElementById('ce-tog').textContent =
                panel.classList.contains('collapsed') ? '▶' : '▼';
        });

        // Reset with confirmation
        document.getElementById('ce-rst').addEventListener('click', () => {
            if (!confirm('Clear all CE tracking data? This cannot be undone.')) return;
            [STORAGE_KEY, STORAGE_KEY + '_ncm', STORAGE_KEY + '_cnm', STORAGE_KEY + '_pos']
                .forEach(k => localStorage.removeItem(k));
            nerveCostMap = {};
            crimeNameMap = {};
            renderPanel();
        });

        makeDraggable(panel, document.getElementById('ce-nrv-hd'));
        renderPanel();
    }

    // ── Draggable (mouse + touch) ──────────────────────────────────────────

    function makeDraggable(el, handle) {
        let ox, oy, active = false;

        const onStart = (cx, cy) => {
            active = true;
            const r = el.getBoundingClientRect();
            ox = cx - r.left;
            oy = cy - r.top;
        };
        const onMove = (cx, cy) => {
            if (!active) return;
            el.style.left  = (cx - ox) + 'px';
            el.style.top   = (cy - oy) + 'px';
            el.style.right = 'auto';
        };
        const onEnd = () => {
            if (!active) return;
            active = false;
            localStorage.setItem(STORAGE_KEY + '_pos',
                JSON.stringify({ left: el.style.left, top: el.style.top }));
        };

        handle.addEventListener('mousedown',  e => { onStart(e.clientX, e.clientY); e.preventDefault(); });
        document.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
        document.addEventListener('mouseup',   onEnd);

        handle.addEventListener('touchstart',  e => { onStart(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
        document.addEventListener('touchmove', e => onMove(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
        document.addEventListener('touchend',  onEnd);
    }

    // ── Panel render ───────────────────────────────────────────────────────

    function renderPanel() {
        const body = document.getElementById('ce-nrv-body');
        if (!body) return;

        const stats = loadStats();
        const rows  = Object.values(stats)
            .filter(s => s.totalNerveSpent > 0)
            .map(s => ({
                ...s,
                eff: s.totalSkillGain / s.totalNerveSpent,
                sr:  s.attempts ? (s.successes / s.attempts * 100) : 0,
            }))
            .sort((a, b) => b.eff - a.eff);

        if (!rows.length) {
            body.innerHTML = `<div class="ce-none">
                Commit crimes to begin tracking.<br>
                Rankings persist across sessions.
            </div>`;
            return;
        }

        const maxEff = rows[0].eff || 1;
        const colorClass = (eff) => {
            const r = eff / maxEff;
            if (r >= 0.85) return 'g1';
            if (r >= 0.65) return 'g2';
            if (r >= 0.45) return 'g3';
            if (r >= 0.25) return 'g4';
            return 'g5';
        };

        let html = `
            <div class="ce-th">
                <span>#</span>
                <span>Crime</span>
                <span style="text-align:right">Skill/10n</span>
                <span style="text-align:right">Succ%</span>
                <span style="text-align:right">n</span>
            </div>`;

        for (let i = 0; i < rows.length; i++) {
            const r      = rows[i];
            const lowN   = r.attempts < 10;
            const effStr = (r.eff * 10).toFixed(3);
            const tooltip = lowN ? ' title="Low sample — fewer than 10 attempts"' : '';

            html += `
                <div class="ce-row">
                    <span class="ce-rank">${i + 1}</span>
                    <span class="ce-name"${tooltip}>${r.name}${lowN ? ' ⚠' : ''}</span>
                    <span class="ce-val ${colorClass(r.eff)}">${effStr}</span>
                    <span class="ce-sr">${r.sr.toFixed(0)}%</span>
                    <span class="ce-n">${r.attempts}</span>
                </div>`;
        }

        body.innerHTML = html;
    }

    // ── Init ───────────────────────────────────────────────────────────────

    function init() {
        // Wait for the crimes React app container to appear
        const obs = new MutationObserver(() => {
            if (document.querySelector(
                '[class*="crimes-app"], [class*="crimesApp"], .crimes-app'
            )) {
                obs.disconnect();
                buildPanel();
            }
        });
        obs.observe(document.body, { childList: true, subtree: true });

        // Also try immediately (in case app is already rendered)
        if (document.querySelector(
            '[class*="crimes-app"], [class*="crimesApp"], .crimes-app'
        )) {
            buildPanel();
        }

        // Final fallback after 3 seconds
        setTimeout(() => {
            if (!document.getElementById('ce-nrv')) buildPanel();
        }, 3000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
