// ==UserScript==
// @name         Torn – CE per Nerve Tracker
// @namespace    https://torn.com
// @version      2.0.0
// @description  Tracks Crime Experience (CE) efficiency per nerve for each crime type. CE is a global hidden stat — unrelated to per-crime skill levels (0-100). Ranks crimes by expected CE yield per nerve spent.
// @author       Custom
// @match        https://www.torn.com/loader.php?sid=crimes*
// @match        https://torn.com/loader.php?sid=crimes*
// @match        https://www.torn.com/page.php?sid=crimes*
// @match        https://torn.com/page.php?sid=crimes*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * HOW CE WORKS IN TORN (Crimes 2.0)
 * ─────────────────────────────────────────────────────────────────────────
 * CE (Criminal Experience) is a hidden global stat that determines your
 * Natural Nerve Bar (NNB). It has NOTHING to do with per-crime skill (0–100).
 * - Every successful crime increases your CE by an amount ≈ proportional
 *   to its nerve cost. Higher-nerve crimes give slightly more CE per nerve.
 * - Failures give 0 CE but still cost nerve.
 * - Critical failures REDUCE your CE and reset your crime chain.
 * - NNB increases in +5 increments each time CE crosses a hidden threshold.
 *
 * WHAT THIS SCRIPT TRACKS
 * ─────────────────────────────────────────────────────────────────────────
 * Since the raw CE value isn't exposed by the crimes page API, we approximate
 * CE efficiency using the formula:
 *
 *   CE Score = success_rate × avg_nerve_cost
 *
 * This works because:
 *   CE gained per attempt ≈ success_rate × (k × nerve_cost)
 *   CE gained per nerve   ≈ success_rate × k
 *
 * So success_rate is the dominant driver of CE per nerve.
 * The "CE Score" column shows the absolute CE yield per attempt
 * (success_rate × nerve), which tells you how much CE you get per crime commit
 * factoring in failures. Higher = better for NNB growth.
 *
 * PANEL COLUMNS
 * ─────────────────────────────────────────────────────────────────────────
 *   Rank        1 = best for NNB growth
 *   Crime       Crime type name
 *   CE Score    success_rate × avg_nerve (higher = more CE per commit)
 *   Succ%       Success rate
 *   Nerve       Average nerve cost per attempt
 *   n           Total attempts recorded
 *
 * DATA STORAGE
 * ─────────────────────────────────────────────────────────────────────────
 * All data stored in localStorage. Nothing sent anywhere. Reset button clears all.
 */

(function () {
    'use strict';

    const STORAGE_KEY = 'ce_nrv_v2';
    const DEBUG = true; // Set false after confirming nerve detection works

    const win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    // Crime type names (Crimes 2.0 typeIDs)
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
        '11': 'Forgery',
        '12': 'Scamming',
        '13': 'Arson',
        '14': 'Murder',
        '15': 'Vandalism',
    };

    // ── Storage ────────────────────────────────────────────────────────────
    const loadStats = () => {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
        catch { return {}; }
    };
    const saveStats = (d) => localStorage.setItem(STORAGE_KEY, JSON.stringify(d));

    // Nerve cost cache: { crimeID|typeID -> nerve }
    let nerveCostMap = JSON.parse(localStorage.getItem(STORAGE_KEY + '_ncm') || '{}');
    const saveNerveMap = () => localStorage.setItem(STORAGE_KEY + '_ncm', JSON.stringify(nerveCostMap));

    // ── Extract nerve costs from crimesByType ──────────────────────────────
    function extractNerveCosts(ctd) {
        if (!ctd) return;
        const tryItem = (item) => {
            if (!item || typeof item !== 'object') return;
            const id = String(item.id ?? item.crimeID ?? item.crime_id ?? item.subID ?? '');
            const nerve = item.nerve ?? item.nerveCost ?? item.nerve_cost ??
                          item.nerveRequired ?? item.nerve_required ?? null;
            if (id && nerve != null) nerveCostMap[id] = Number(nerve);
        };

        const walk = (obj) => {
            tryItem(obj);
            for (const key of ['crimes', 'targets', 'crimeList', 'list']) {
                if (Array.isArray(obj[key])) obj[key].forEach(tryItem);
            }
        };

        if (Array.isArray(ctd)) ctd.forEach(walk);
        else if (typeof ctd === 'object') walk(ctd);

        if (DEBUG) console.log('[CE Tracker] nerveCostMap:', JSON.stringify(nerveCostMap));
        saveNerveMap();
    }

    // ── DOM fallback for nerve cost ────────────────────────────────────────
    function readNerveCostFromDOM() {
        // Look in stat elements for "Nerve" label
        for (const li of document.querySelectorAll('li[class^="statistic"], li[class*=" statistic"]')) {
            for (const sp of li.querySelectorAll('span')) {
                if (sp.textContent.trim().toLowerCase() === 'nerve') {
                    const val = li.querySelector('span[class^="value"], span[class*=" value"]');
                    if (val) {
                        const n = parseInt(val.textContent.trim());
                        if (n >= 1 && n <= 50) return n;
                    }
                }
            }
        }
        // Elements with "nerve" in class name
        for (const el of document.querySelectorAll('[class*="nerve"]')) {
            const n = parseInt(el.textContent.trim());
            if (!isNaN(n) && n >= 1 && n <= 30) return n;
        }
        return null;
    }

    // ── Record an attempt ──────────────────────────────────────────────────
    function record(typeID, nerveCost, outcome) {
        const stats = loadStats();
        if (!stats[typeID]) {
            stats[typeID] = {
                typeID,
                name:            TYPE_NAMES[typeID] || `Type ${typeID}`,
                attempts:        0,
                successes:       0,
                failures:        0,
                criticals:       0,
                totalNerveSpent: 0,
            };
        }
        const s = stats[typeID];
        s.attempts++;
        s.totalNerveSpent += nerveCost;

        switch (outcome) {
            case 'success':          s.successes++; break;
            case 'failure':          s.failures++;  break;
            case 'critical failure': s.criticals++; break;
        }

        saveStats(stats);

        if (DEBUG) {
            const sr = (s.successes / s.attempts * 100).toFixed(1);
            console.log(`[CE Tracker] ${s.name} | outcome=${outcome} nerve=${nerveCost} | ${s.attempts} attempts ${sr}% success`);
        }
    }

    // ── Fetch intercept ────────────────────────────────────────────────────
    const origFetch = win.fetch;

    win.fetch = async function (...args) {
        const response = await origFetch.apply(this, args);
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');

        if (!url.includes('sid=crimesData')) return response;

        // Build nerve cost map from crimesList
        if (url.includes('step=crimesList')) {
            response.clone().text().then(body => {
                try {
                    const data = JSON.parse(body);
                    if (data?.DB?.crimesByType) extractNerveCosts(data.DB.crimesByType);
                } catch {}
            });
        }

        // Record crime attempt
        if (url.includes('step=attempt')) {
            const typeID  = (url.match(/typeID=([^&\s]+)/)  || [])[1];
            const crimeID = (url.match(/crimeID=([^&\s]+)/) || [])[1];

            response.clone().text().then(body => {
                try {
                    const data = JSON.parse(body);
                    if (!data?.DB?.outcome) return;
                    if (data.DB.outcome.result === 'error') return;

                    const outcome = data.DB.outcome.result; // 'success' | 'failure' | 'critical failure'

                    // Also try to extract nerve costs from the attempt response
                    if (data.DB.crimesByType) extractNerveCosts(data.DB.crimesByType);

                    if (DEBUG) {
                        console.log('[CE Tracker] DB keys:', Object.keys(data.DB));
                        console.log('[CE Tracker] outcome:', JSON.stringify(data.DB.outcome).substring(0, 400));
                    }

                    // Nerve cost: cache → outcome fields → DB root → DOM
                    let nerveCost =
                        nerveCostMap[crimeID] ??
                        nerveCostMap[typeID]  ??
                        data.DB.outcome?.nerve      ??
                        data.DB.outcome?.nerveCost  ??
                        data.DB.outcome?.nerveUsed  ??
                        data.DB.nerveCost           ??
                        data.DB.nerveUsed           ??
                        data.DB.nerve               ??
                        readNerveCostFromDOM()       ??
                        null;

                    if (DEBUG) console.log(`[CE Tracker] typeID=${typeID} crimeID=${crimeID} outcome=${outcome} nerve=${nerveCost}`);

                    if (typeID && nerveCost) {
                        record(typeID, Number(nerveCost), outcome);
                        setTimeout(renderPanel, 150);
                    } else {
                        console.warn('[CE Tracker] Missing typeID or nerveCost — not recorded.',
                            { typeID, nerveCost });
                    }

                } catch (e) {
                    if (DEBUG) console.error('[CE Tracker]', e);
                }
            });
        }

        return response;
    };

    // ── Panel CSS ──────────────────────────────────────────────────────────
    function injectCSS() {
        if (document.getElementById('ce-nrv-css')) return;
        const s = document.createElement('style');
        s.id = 'ce-nrv-css';
        s.textContent = `
#ce-nrv{position:fixed;top:75px;right:8px;width:310px;background:#111827;border:1px solid #374151;
border-radius:8px;color:#d1d5db;font:12px/1.45 Arial,sans-serif;z-index:99999;
box-shadow:0 6px 24px rgba(0,0,0,.7);user-select:none;}
#ce-nrv-hd{padding:7px 10px;background:#1f2937;border-radius:8px 8px 0 0;
display:flex;justify-content:space-between;align-items:center;cursor:move;
border-bottom:1px solid #374151;}
#ce-nrv-hd b{font-size:12px;color:#93c5fd;}
.ce-btn{background:#374151;border:none;color:#d1d5db;padding:2px 7px;
border-radius:4px;cursor:pointer;font-size:10px;margin-left:4px;}
.ce-btn:hover{background:#4b5563;}
#ce-nrv-body{padding:6px 8px;max-height:380px;overflow-y:auto;}
#ce-nrv-foot{padding:4px 8px;border-top:1px solid #374151;color:#6b7280;
font-size:10px;border-radius:0 0 8px 8px;}
.ce-th{display:grid;grid-template-columns:16px 1fr 52px 42px 38px 30px;
gap:3px;padding:2px 4px 5px;border-bottom:1px solid #374151;
color:#6b7280;font-size:10px;margin-bottom:3px;}
.ce-row{display:grid;grid-template-columns:16px 1fr 52px 42px 38px 30px;
gap:3px;padding:3px 4px;border-radius:4px;align-items:center;}
.ce-row:hover{background:rgba(255,255,255,.04);}
.ce-rk{color:#6b7280;font-size:10px;text-align:center;}
.ce-nm{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ce-vl{font-weight:700;text-align:right;font-size:12px;}
.ce-sr{text-align:right;color:#9ca3af;font-size:10px;}
.ce-nv{text-align:right;color:#9ca3af;font-size:10px;}
.ce-nn{text-align:right;color:#6b7280;font-size:10px;}
.ce-none{padding:14px 8px;color:#6b7280;text-align:center;font-size:11px;line-height:1.8;}
.g1{color:#34d399;}.g2{color:#86efac;}.g3{color:#fbbf24;}.g4{color:#f97316;}.g5{color:#f87171;}
#ce-nrv.col #ce-nrv-body,#ce-nrv.col #ce-nrv-foot{display:none;}
        `;
        document.head.appendChild(s);
    }

    // ── Panel build ────────────────────────────────────────────────────────
    function buildPanel() {
        if (document.getElementById('ce-nrv')) return;
        injectCSS();
        const p = document.createElement('div');
        p.id = 'ce-nrv';
        p.innerHTML = `
<div id="ce-nrv-hd"><b>⚡ CE / Nerve Tracker</b>
  <div><button class="ce-btn" id="ce-tog">▼</button>
       <button class="ce-btn" id="ce-rst">Reset</button></div></div>
<div id="ce-nrv-body">
  <div class="ce-none">Commit crimes to start tracking CE.<br>Rankings persist across sessions.</div>
</div>
<div id="ce-nrv-foot">CE Score = succ% × nerve/crime &nbsp;·&nbsp; green = best NNB growth</div>`;
        document.body.appendChild(p);

        const pos = JSON.parse(localStorage.getItem(STORAGE_KEY + '_pos') || 'null');
        if (pos) { p.style.top = pos.top; p.style.left = pos.left; p.style.right = 'auto'; }

        document.getElementById('ce-tog').onclick = () => {
            p.classList.toggle('col');
            document.getElementById('ce-tog').textContent = p.classList.contains('col') ? '▶' : '▼';
        };
        document.getElementById('ce-rst').onclick = () => {
            if (!confirm('Clear all CE tracking data?')) return;
            [STORAGE_KEY, STORAGE_KEY + '_ncm', STORAGE_KEY + '_pos'].forEach(k => localStorage.removeItem(k));
            nerveCostMap = {};
            renderPanel();
        };

        makeDraggable(p, document.getElementById('ce-nrv-hd'));
        renderPanel();
    }

    function makeDraggable(el, handle) {
        let ox, oy, on = false;
        const start = (cx, cy) => { on = true; const r = el.getBoundingClientRect(); ox = cx - r.left; oy = cy - r.top; };
        const move  = (cx, cy) => { if (!on) return; el.style.left = (cx-ox)+'px'; el.style.top = (cy-oy)+'px'; el.style.right = 'auto'; };
        const end   = () => { if (on) { localStorage.setItem(STORAGE_KEY+'_pos', JSON.stringify({left:el.style.left,top:el.style.top})); on=false; } };
        handle.addEventListener('mousedown',  e => { start(e.clientX,e.clientY); e.preventDefault(); });
        document.addEventListener('mousemove', e => move(e.clientX,e.clientY));
        document.addEventListener('mouseup',   end);
        handle.addEventListener('touchstart',  e => { start(e.touches[0].clientX,e.touches[0].clientY); }, {passive:false});
        document.addEventListener('touchmove', e => move(e.touches[0].clientX,e.touches[0].clientY), {passive:true});
        document.addEventListener('touchend',  end);
    }

    // ── Panel render ───────────────────────────────────────────────────────
    function renderPanel() {
        const body = document.getElementById('ce-nrv-body');
        if (!body) return;
        const stats = loadStats();

        const rows = Object.values(stats)
            .filter(s => s.attempts > 0)
            .map(s => {
                const sr       = s.successes / s.attempts;   // success rate 0-1
                const avgNerve = s.totalNerveSpent / s.attempts;
                return {
                    ...s,
                    sr,
                    avgNerve,
                    // CE Score: expected CE per attempt = succ_rate × nerve_cost
                    // (CE scales with nerve, so this estimates absolute CE yield)
                    ceScore: sr * avgNerve,
                };
            })
            .sort((a, b) => b.ceScore - a.ceScore);

        if (!rows.length) {
            body.innerHTML = '<div class="ce-none">Commit crimes to start tracking CE.<br>Rankings persist across sessions.</div>';
            return;
        }

        const maxScore = rows[0].ceScore || 1;
        const gc = (v) => {
            const r = v / maxScore;
            return r >= .85 ? 'g1' : r >= .65 ? 'g2' : r >= .45 ? 'g3' : r >= .25 ? 'g4' : 'g5';
        };

        let html = `<div class="ce-th">
            <span>#</span><span>Crime</span>
            <span style="text-align:right">CE Score</span>
            <span style="text-align:right">Succ%</span>
            <span style="text-align:right">Nerve</span>
            <span style="text-align:right">n</span></div>`;

        for (let i = 0; i < rows.length; i++) {
            const r    = rows[i];
            const lowN = r.attempts < 20;
            const tip  = `title="${r.name}: ${r.successes}/${r.attempts} success, ${r.criticals} crits, avg ${r.avgNerve.toFixed(1)} nerve${lowN ? ' ⚠ low sample' : ''}"`;
            html += `<div class="ce-row" ${tip}>
                <span class="ce-rk">${i+1}</span>
                <span class="ce-nm">${r.name}${lowN ? ' ⚠' : ''}</span>
                <span class="ce-vl ${gc(r.ceScore)}">${r.ceScore.toFixed(2)}</span>
                <span class="ce-sr">${(r.sr*100).toFixed(0)}%</span>
                <span class="ce-nv">${r.avgNerve.toFixed(1)}</span>
                <span class="ce-nn">${r.attempts}</span>
            </div>`;
        }

        body.innerHTML = html;
    }

    // ── Init ───────────────────────────────────────────────────────────────
    function init() {
        const obs = new MutationObserver(() => {
            if (document.querySelector('[class*="crimes-app"], [class*="crimesApp"], .crimes-app')) {
                obs.disconnect(); buildPanel();
            }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        if (document.querySelector('[class*="crimes-app"], [class*="crimesApp"], .crimes-app')) buildPanel();
        setTimeout(() => { if (!document.getElementById('ce-nrv')) buildPanel(); }, 3000);
    }

    document.readyState === 'loading'
        ? document.addEventListener('DOMContentLoaded', init)
        : init();
})();
