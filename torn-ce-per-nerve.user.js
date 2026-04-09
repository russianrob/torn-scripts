// ==UserScript==
// @name         Torn – CE per Nerve Tracker
// @namespace    https://torn.com
// @version      3.3.3
// @description  Tracks CE per nerve for every crime type. Live crime chain, progression bonus, NNB tracking via API key with faction offset so the panel shows your real base NNB.
// @author       Custom
// @match        https://www.torn.com/loader.php?sid=crimes*
// @match        https://torn.com/loader.php?sid=crimes*
// @match        https://www.torn.com/page.php?sid=crimes*
// @match        https://torn.com/page.php?sid=crimes*
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

/*
 * HOW CE WORKS
 * ─────────────────────────────────────────────────────────────────────────
 * CE (Criminal Experience) is a hidden global stat — NOT the per-crime skill
 * level (0–100). CE determines your Natural Nerve Bar (NNB), increasing it
 * in +5 increments each time CE crosses a hidden threshold.
 *
 * In Crimes 2.0, CE is called "Crime Score" (CS):
 *   - Every successful crime gives CS ≈ proportional to nerve cost
 *   - Failures give 0 CS but still cost nerve
 *   - Critical failures REDUCE your CS and reset your chain
 *   - A consecutive-success CHAIN gives a Progression Bonus (up to +20% CS)
 *
 * CE SCORE (this script's ranking metric)
 * ─────────────────────────────────────────────────────────────────────────
 *   CE Score = success_rate × avg_nerve_cost
 *
 * Since CS ≈ nerve_cost × (1 + chain_bonus), and chain_bonus is the same
 * for all crimes (it's global), success_rate is the dominant factor for
 * CE per nerve. Higher-nerve crimes give slightly more CE per nerve, which
 * is why we multiply by nerve cost.
 *
 * CHAIN + PROGRESSION BONUS
 * ─────────────────────────────────────────────────────────────────────────
 * Chain = consecutive successes (halved on fail, reset to 0 on crit fail)
 * Progression bonus = up to +20% extra CS per crime at high chain
 * This multiplier applies to ALL crimes equally — it doesn't affect rankings,
 * but it means maintaining your chain is critical for NNB growth.
 *
 * COLUMNS
 * ─────────────────────────────────────────────────────────────────────────
 *   CE Score   success_rate × avg_nerve (higher = more CE per commit)
 *   Succ%      Your success rate for this crime type
 *   Nerve      Average nerve cost per attempt
 *   n          Total attempts recorded (⚠ < 20)
 *
 * NNB TRACKING (requires Limited API key)
 * ─────────────────────────────────────────────────────────────────────────
 * With an API key the panel shows your current max nerve and alerts when
 * NNB increases. Chain is also recalculated from your actual crime log.
 */

(function () {
    'use strict';

    const KEY   = 'ce_nrv_v3';
    const DEBUG = true;

    const win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    const TYPE_NAMES = {
        '1':'Search for Cash', '2':'Bootlegging',   '3':'Shoplifting',
        '4':'Card Skimming',   '5':'Burglary',       '6':'Pickpocketing',
        '7':'Hustling',        '8':'Cracking',         '9':'Disposal',
        '10':'Graffiti',       '11':'Forgery',        '12':'Scamming',
        '13':'Arson',          '14':'Murder',         '15':'Vandalism',
    };

    // ── Persistence helpers ────────────────────────────────────────────────
    const loadStats  = () => { try { return JSON.parse(localStorage.getItem(KEY + '_stats')) || {}; } catch { return {}; } };
    const saveStats  = d => localStorage.setItem(KEY + '_stats', JSON.stringify(d));
    const loadMeta   = () => { try { return JSON.parse(localStorage.getItem(KEY + '_meta')) || {}; } catch { return {}; } };
    const saveMeta   = d => localStorage.setItem(KEY + '_meta', JSON.stringify(d));

    // ── Chain state ────────────────────────────────────────────────────────
    // chain is a float (halved on failure): 0 = reset, high = long streak
    let meta = loadMeta();
    let crimeChain      = meta.chain        ?? 0;
    let nnbCurrent      = meta.nnb          ?? null;  // last known raw nerve max
    let nnbPrev         = meta.nnbPrev      ?? null;  // previous raw nerve max
    let factionOffset   = meta.factionOffset ?? 0;    // faction nerve bonus to subtract
    let lastFetchHit = 0; // dedup flag for fetch vs DOM double-fire

    const saveChain = () => { meta.chain = crimeChain; meta.factionOffset = factionOffset; saveMeta(meta); };

    function updateChain(outcome) {
        if      (outcome === 'success')                                    crimeChain++;
        else if (outcome === 'failure')                                    crimeChain = crimeChain / 2;
        else if (outcome === 'critical failure' || outcome === 'criticalFailure') crimeChain = 0;
        saveChain();
    }

    // Estimated progression bonus: Torn says "up to 20%" — saturates around chain ~100
    const chainBonus = () => Math.min(0.20, crimeChain * 0.002);

    // Convert raw nerve max to base NNB by subtracting faction bonus
    const toNNB = (rawMax) => (rawMax != null ? rawMax - factionOffset : null);

    // ── Nerve cost cache ───────────────────────────────────────────────────
    let nerveCostMap = JSON.parse(localStorage.getItem(KEY + '_ncm') || '{}');
    const saveNerveMap = () => localStorage.setItem(KEY + '_ncm', JSON.stringify(nerveCostMap));

    function extractNerveCosts(ctd) {
        if (!ctd) return;
        const tryItem = item => {
            if (!item || typeof item !== 'object') return;
            const id    = String(item.id ?? item.crimeID ?? item.crime_id ?? item.subID ?? '');
            const nerve = item.nerve ?? item.nerveCost ?? item.nerve_cost ??
                          item.nerveRequired ?? item.nerve_required ?? null;
            if (id && nerve != null) nerveCostMap[id] = Number(nerve);
        };
        const walk = obj => {
            tryItem(obj);
            ['crimes','targets','crimeList','list'].forEach(k => Array.isArray(obj[k]) && obj[k].forEach(tryItem));
        };
        Array.isArray(ctd) ? ctd.forEach(walk) : (typeof ctd === 'object' && walk(ctd));
        saveNerveMap();
        if (DEBUG) console.log('[CE] nerveCostMap:', nerveCostMap);
    }

    function readNerveCostFromDOM() {
        for (const li of document.querySelectorAll('li[class^="statistic"], li[class*=" statistic"]')) {
            for (const sp of li.querySelectorAll('span')) {
                if (sp.textContent.trim().toLowerCase() === 'nerve') {
                    const v = li.querySelector('span[class^="value"], span[class*=" value"]');
                    if (v) { const n = parseInt(v.textContent); if (n >= 1 && n <= 50) return n; }
                }
            }
        }
        for (const el of document.querySelectorAll('[class*="nerve"]')) {
            const n = parseInt(el.textContent.trim());
            if (!isNaN(n) && n >= 1 && n <= 30) return n;
        }
        return null;
    }

    // ── Record a crime attempt ─────────────────────────────────────────────
    function record(typeID, nerveCost, outcome, hashSlug) {
        const stats = loadStats();
        const resolvedName = hashSlug
            ? hashSlug.charAt(0).toUpperCase() + hashSlug.slice(1)
            : (TYPE_NAMES[typeID] || `Type ${typeID}`);
        if (!stats[typeID]) stats[typeID] = {
            typeID, name: resolvedName,
            attempts:0, successes:0, failures:0, criticals:0, totalNerveSpent:0,
        };
        // Always update from hash slug when available — overrides any stale stored name
        if (hashSlug) stats[typeID].name = resolvedName;
        const s = stats[typeID];
        s.attempts++;
        s.totalNerveSpent += nerveCost;
        if      (outcome === 'success')                  s.successes++;
        else if (outcome === 'failure')                  s.failures++;
        else if (outcome === 'critical failure')         s.criticals++;
        saveStats(stats);
        if (DEBUG) console.log(`[CE] ${s.name} | ${outcome} | nerve=${nerveCost} | ${s.successes}/${s.attempts}`);
    }

    // ── Fetch intercept (primary: nerve + typeID + outcome) ────────────────
    const origFetch = win.fetch;
    win.fetch = async function (...args) {
        const response = await origFetch.apply(this, args);
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');
        if (!url.includes('sid=crimesData')) return response;

        if (url.includes('step=crimesList')) {
            response.clone().text().then(body => {
                try { const d = JSON.parse(body); if (d?.DB?.crimesByType) extractNerveCosts(d.DB.crimesByType); } catch {}
            });
        }

        if (url.includes('step=attempt')) {
            const typeID  = (url.match(/typeID=([^&\s]+)/)  || [])[1];
            const crimeID = (url.match(/crimeID=([^&\s]+)/) || [])[1];
            // Hash like #/graffiti → 'Graffiti' — much more reliable than typeID guessing
            const hashSlug = win.location?.hash?.replace(/^#\//, '').split('?')[0].split('/')[0] || '';

            response.clone().text().then(body => {
                try {
                    const data = JSON.parse(body);
                    if (!data?.DB?.outcome || data.DB.outcome.result === 'error') return;
                    const outcome = data.DB.outcome.result;

                    if (data.DB.crimesByType) extractNerveCosts(data.DB.crimesByType);
                    if (DEBUG) { console.log('[CE] DB keys:', Object.keys(data.DB)); console.log('[CE] outcome:', data.DB.outcome); }

                    const nerveCost =
                        nerveCostMap[crimeID] ?? nerveCostMap[typeID] ??
                        data.DB.outcome?.nerve ?? data.DB.outcome?.nerveCost ??
                        data.DB.nerveCost ?? data.DB.nerve ??
                        readNerveCostFromDOM() ?? null;

                    if (DEBUG) console.log(`[CE] typeID=${typeID} nerve=${nerveCost} outcome=${outcome}`);

                    lastFetchHit = Date.now();
                    updateChain(outcome);
                    if (typeID && nerveCost) record(typeID, Number(nerveCost), outcome, hashSlug);
                    setTimeout(renderPanel, 150);

                } catch (e) { if (DEBUG) console.error('[CE]', e); }
            });
        }

        return response;
    };

    // ── DOM MutationObserver (backup: chain only if fetch didn't fire) ──────
    function initDOMObserver() {
        const observer = new MutationObserver(mutations => {
            // Skip if fetch already handled this crime (within 3 seconds)
            if (Date.now() - lastFetchHit < 3000) return;

            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (!node.className) continue;
                    const cls = typeof node.className === 'string' ? node.className : node.className.baseVal || '';
                    const match = cls.match(/crimes-outcome-(\w+)/i);
                    if (!match) continue;
                    const raw = match[1]; // success | failure | criticalFailure
                    const outcome = raw === 'criticalFailure' ? 'critical failure'
                                  : raw === 'failure'         ? 'failure'
                                  : raw === 'success'         ? 'success' : null;
                    if (!outcome) continue;
                    if (DEBUG) console.log('[CE] DOM observer caught outcome:', outcome);
                    updateChain(outcome);
                    renderPanel();
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // ── Server API (tornwar.com/api/nerve-tracker) ────────────────────────
    // API key stays on the server — script just reads from the endpoint.
    const SERVER_ENDPOINT = 'https://tornwar.com/api/nerve-tracker';

    function getApiKey() { return meta.apiKey || null; }  // kept for config POST only

    // GM_xmlhttpRequest (TornPDA) or fetch (desktop) — mirrors OC Spawn Assistance approach
    function serverFetch(url) {
        if (typeof GM_xmlhttpRequest === 'function') {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET', url,
                    onload(r) {
                        try { resolve(JSON.parse(r.responseText)); }
                        catch (e) { reject(new Error(`Bad JSON (${r.status})`)); }
                    },
                    onerror(e) { reject(new Error('Network error: ' + (e.statusText || 'unknown'))); },
                });
            });
        }
        // Desktop fallback with 10s timeout
        const ctrl  = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10_000);
        return fetch(url, { cache: 'no-store', signal: ctrl.signal })
            .then(r => { clearTimeout(timer); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
            .catch(e => { clearTimeout(timer); throw e; });
    }

    async function refreshFromAPI(silent = false) {
        const btn = document.getElementById('ce-api-refresh');
        if (btn) btn.textContent = '⟳';

        try {
            const data = await serverFetch(SERVER_ENDPOINT);

            if (data.baseNNB != null) {
                const prevNNB = toNNB(nnbCurrent);
                const newNNB  = data.baseNNB;

                if (prevNNB !== null && newNNB - prevNNB === 5) flashNNBIncrease(prevNNB, newNNB);

                nnbCurrent    = data.nerveMax;
                factionOffset = data.factionOffset ?? factionOffset;
                if (data.nerveMax > (meta.nnb ?? 0)) nnbPrev = meta.nnb;

                const factionInput = document.getElementById('ce-faction-in');
                if (factionInput && !factionInput.matches(':focus')) factionInput.value = factionOffset;
            }

            // Sync chain from server — authoritative calculation from crime logs
            if (data.crimeChain != null) {
                crimeChain = data.crimeChain;
            }

            // Inject server-calculated bust stats as a virtual entry
            if (data.bustStats) {
                const serverBusts = loadStats();
                serverBusts['busting'] = { ...data.bustStats, _fromServer: true };
                saveStats(serverBusts);
            }

            meta = { ...meta, nnb: nnbCurrent, nnbPrev, chain: crimeChain, factionOffset };
            saveMeta(meta);

        } catch (e) {
            console.warn('[CE] Server fetch failed:', e.message);
            // Show error state in NNB field so it doesn't stay stuck on "Syncing…"
            const el = document.getElementById('ce-nnb-val');
            if (el) { el.textContent = 'Sync failed ↻'; el.title = e.message; }
        }

        renderPanel();
        if (btn) btn.textContent = '↻';
    }

        function flashNNBIncrease(from, to) {
        // Show a prominent in-panel alert
        const el = document.getElementById('ce-nnb-val');
        if (el) {
            el.style.transition = 'background 0.3s';
            el.style.background = '#065f46';
            el.style.borderRadius = '4px';
            el.style.padding = '1px 4px';
            setTimeout(() => { if (el) el.style.background = ''; }, 4000);
        }
        // Also show a browser notification if permitted
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification('NNB Increased!', { body: `Your NNB went from ${from} → ${to}`, icon: '' });
        }
        console.log(`[CE] 🎉 NNB INCREASED: ${from} → ${to}`);
    }

    // ── Panel CSS ──────────────────────────────────────────────────────────
    function injectCSS() {
        if (document.getElementById('ce-css')) return;
        const s = document.createElement('style');
        s.id = 'ce-css';
        s.textContent = `
#ce-p{position:fixed;top:75px;right:8px;width:315px;background:#0f172a;border:1px solid #1e3a5f;
border-radius:10px;color:#cbd5e1;font:12px/1.45 Arial,sans-serif;z-index:99999;
box-shadow:0 8px 28px rgba(0,0,0,.75);user-select:none;}
#ce-hd{padding:7px 10px;background:#1e293b;border-radius:10px 10px 0 0;
display:flex;justify-content:space-between;align-items:center;cursor:move;
border-bottom:1px solid #334155;}
#ce-hd b{font-size:12px;color:#7dd3fc;}
.cbt{background:#334155;border:none;color:#cbd5e1;padding:2px 7px;
border-radius:4px;cursor:pointer;font-size:10px;margin-left:4px;}
.cbt:hover{background:#475569;}
#ce-status{padding:5px 10px 4px;background:#16213e;border-bottom:1px solid #1e3a5f;
display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:11px;}
.ce-stat-lbl{color:#64748b;font-size:10px;}
.ce-stat-val{color:#e2e8f0;font-weight:600;}
.ce-stat-val.up{color:#34d399;}
#ce-body{padding:6px 8px;max-height:330px;overflow-y:auto;}
#ce-foot{padding:4px 8px;border-top:1px solid #1e3a5f;color:#475569;font-size:10px;border-radius:0 0 10px 10px;}
#ce-api-bar{padding:5px 8px;border-top:1px solid #1e3a5f;display:flex;gap:5px;align-items:center;}
#ce-api-bar input{flex:1;background:#1e293b;border:1px solid #334155;color:#cbd5e1;
padding:3px 6px;border-radius:4px;font-size:11px;}
#ce-api-bar input::placeholder{color:#475569;}
.ce-th{display:grid;grid-template-columns:16px 1fr 52px 42px 36px 28px;
gap:3px;padding:2px 4px 5px;border-bottom:1px solid #1e3a5f;color:#475569;font-size:10px;margin-bottom:3px;}
.ce-row{display:grid;grid-template-columns:16px 1fr 52px 42px 36px 28px;
gap:3px;padding:3px 4px;border-radius:4px;align-items:center;}
.ce-row:hover{background:rgba(255,255,255,.04);}
.ce-rk{color:#475569;font-size:10px;text-align:center;}
.ce-nm{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ce-vl{font-weight:700;text-align:right;font-size:12px;}
.ce-sr{text-align:right;color:#94a3b8;font-size:10px;}
.ce-nv{text-align:right;color:#94a3b8;font-size:10px;}
.ce-nn{text-align:right;color:#475569;font-size:10px;}
.ce-none{padding:14px 8px;color:#475569;text-align:center;font-size:11px;line-height:1.8;}
.g1{color:#34d399;}.g2{color:#86efac;}.g3{color:#fbbf24;}.g4{color:#f97316;}.g5{color:#f87171;}
.fire{color:#f97316;}
#ce-p.col #ce-body,#ce-p.col #ce-foot,#ce-p.col #ce-api-bar{display:none;}
        `;
        document.head.appendChild(s);
    }

    // ── Panel build ────────────────────────────────────────────────────────
    function buildPanel() {
        if (document.getElementById('ce-p')) return;
        injectCSS();

        const p = document.createElement('div');
        p.id = 'ce-p';
        p.innerHTML = `
<div id="ce-hd">
  <b>⚡ CE / Nerve Tracker</b>
  <div>
    <button class="cbt" id="ce-api-refresh" title="Refresh NNB + chain from API">↻</button>
    <button class="cbt" id="ce-tog">▼</button>
    <button class="cbt" id="ce-rst">Reset</button>
  </div>
</div>
<div id="ce-status">
  <div>
    <div class="ce-stat-lbl">Crime Chain</div>
    <div class="ce-stat-val" id="ce-chain-val">—</div>
  </div>
  <div>
    <div class="ce-stat-lbl">NNB (max nerve)</div>
    <div class="ce-stat-val" id="ce-nnb-val">—</div>
  </div>
  <div>
    <div class="ce-stat-lbl">Prog. Bonus (est.)</div>
    <div class="ce-stat-val" id="ce-bonus-val">—</div>
  </div>
  <div>
    <div class="ce-stat-lbl">Session crimes</div>
    <div class="ce-stat-val" id="ce-session-val">0</div>
  </div>
</div>
<div id="ce-body">
  <div class="ce-none">Commit crimes to start tracking CE.<br>Rankings persist across sessions.</div>
</div>
<div id="ce-foot">CE Score = succ% × nerve &nbsp;·&nbsp; chain bonus adds up to +20% on top</div>
<div id="ce-api-bar" style="align-items:center">
  <span style="color:#64748b;font-size:10px;flex:1">Faction nerve offset:</span>
  <input id="ce-api-in" type="hidden" />
  <input id="ce-faction-in" type="number" min="0" max="50" placeholder="e.g. 7" title="How much nerve your faction adds — subtracted to show base NNB" style="width:60px;margin-right:4px" />
  <button class="cbt" id="ce-api-save">Save</button>
</div>`;
        document.body.appendChild(p);

        // Restore position
        const pos = JSON.parse(localStorage.getItem(KEY + '_pos') || 'null');
        if (pos) { p.style.top = pos.top; p.style.left = pos.left; p.style.right = 'auto'; }

        // Pre-fill API key if stored
        const stored = getApiKey();
        if (stored) document.getElementById('ce-api-in').value = stored;

        // Toggle collapse
        document.getElementById('ce-tog').onclick = () => {
            p.classList.toggle('col');
            document.getElementById('ce-tog').textContent = p.classList.contains('col') ? '▶' : '▼';
        };

        // Reset
        document.getElementById('ce-rst').onclick = () => {
            if (!confirm('Clear all CE tracking data? Chain and NNB history will also reset.')) return;
            [KEY+'_stats', KEY+'_ncm', KEY+'_pos', KEY+'_meta'].forEach(k => localStorage.removeItem(k));
            crimeChain = 0; nnbCurrent = null; nnbPrev = null; factionOffset = 0; meta = {};
            nerveCostMap = {};
            sessionCount = 0;
            renderPanel();
            refreshFromAPI(); // re-sync NNB + faction offset from server immediately
        };

        // Pre-fill faction offset
        document.getElementById('ce-faction-in').value = factionOffset || '';

        // Faction offset save — POSTs to server so it recalculates NNB correctly
        document.getElementById('ce-api-save').onclick = async () => {
            const faction = parseInt(document.getElementById('ce-faction-in').value) || 0;
            factionOffset      = faction;
            meta.factionOffset = faction;
            saveMeta(meta);
            // Also tell the server (requires JWT — skipped if not authed, server uses its own key)
            try {
                await fetch(SERVER_ENDPOINT + '/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ factionOffset: faction }),
                });
            } catch {}
            refreshFromAPI();
        };

        // Manual refresh
        document.getElementById('ce-api-refresh').onclick = () => refreshFromAPI();

        makeDraggable(p, document.getElementById('ce-hd'));

        // Auto-refresh NNB from server every 30 min (no API key needed in browser)
        refreshFromAPI(true);
        setInterval(() => refreshFromAPI(true), 30 * 60 * 1000);

        renderPanel();
    }

    // ── Draggable (mouse + touch) ──────────────────────────────────────────
    function makeDraggable(el, handle) {
        let ox, oy, on = false;
        const start = (cx, cy) => { on=true; const r=el.getBoundingClientRect(); ox=cx-r.left; oy=cy-r.top; };
        const move  = (cx, cy) => { if(!on) return; el.style.left=(cx-ox)+'px'; el.style.top=(cy-oy)+'px'; el.style.right='auto'; };
        const end   = () => { if(on){ localStorage.setItem(KEY+'_pos', JSON.stringify({left:el.style.left,top:el.style.top})); on=false; } };
        handle.addEventListener('mousedown',  e=>{start(e.clientX,e.clientY);e.preventDefault();});
        document.addEventListener('mousemove', e=>move(e.clientX,e.clientY));
        document.addEventListener('mouseup',   end);
        handle.addEventListener('touchstart',  e=>{start(e.touches[0].clientX,e.touches[0].clientY);},{passive:false});
        document.addEventListener('touchmove', e=>move(e.touches[0].clientX,e.touches[0].clientY),{passive:true});
        document.addEventListener('touchend',  end);
    }

    // ── Session counter ────────────────────────────────────────────────────
    let sessionCount = 0;

    // ── Panel render ───────────────────────────────────────────────────────
    function renderPanel() {
        // Status bar
        const chainEl   = document.getElementById('ce-chain-val');
        const bonusEl   = document.getElementById('ce-bonus-val');
        const nnbEl     = document.getElementById('ce-nnb-val');
        const sessionEl = document.getElementById('ce-session-val');

        if (chainEl) {
            const c = crimeChain;
            const fireEmoji = c >= 50 ? '🔥' : c >= 20 ? '⚡' : '';
            chainEl.textContent = Math.floor(c * 100) / 100 + ' ' + fireEmoji;
        }
        if (bonusEl) {
            const pct = (chainBonus() * 100).toFixed(1);
            bonusEl.textContent = `+${pct}% CS`;
            bonusEl.style.color = parseFloat(pct) > 10 ? '#34d399' : '#94a3b8';
        }
        if (nnbEl) {
            const baseNNB     = toNNB(nnbCurrent);
            const basePrevNNB = toNNB(nnbPrev);
            if (baseNNB !== null) {
                const delta = (basePrevNNB !== null && baseNNB > basePrevNNB)
                    ? ` ↑${baseNNB - basePrevNNB}` : '';
                nnbEl.textContent = baseNNB + (delta ? delta : '');
                nnbEl.className   = 'ce-stat-val' + (delta ? ' up' : '');
                const next = Math.floor(baseNNB / 5) * 5 + 5;
                nnbEl.title = delta
                    ? `NNB increased! (raw max: ${nnbCurrent}, faction offset: ${factionOffset})`
                    : `Next NNB: ${next} · raw max: ${nnbCurrent} · faction: ${factionOffset}`;
            } else {
                nnbEl.textContent = 'Syncing…';
                nnbEl.className   = 'ce-stat-val';
            }
        }
        if (sessionEl) sessionEl.textContent = String(sessionCount);

        // Rankings
        const body = document.getElementById('ce-body');
        if (!body) return;
        const stats = loadStats();
        const rows  = Object.values(stats)
            .filter(s => s.attempts > 0)
            .map(s => {
                // Server bust entry has sr/avgNerve/ceScore pre-computed
                const sr       = s.sr       ?? (s.successes / s.attempts);
                const avgNerve = s.avgNerve ?? (s.totalNerveSpent / s.attempts);
                const ceScore  = s.ceScore  ?? (sr * avgNerve);
                return { ...s, sr, avgNerve, ceScore };
            })
            .sort((a, b) => b.ceScore - a.ceScore);

        if (!rows.length) {
            body.innerHTML = '<div class="ce-none">Commit crimes to start tracking CE.<br>Rankings persist across sessions.</div>';
            return;
        }

        const maxScore = rows[0].ceScore || 1;
        const gc = v => { const r=v/maxScore; return r>=.85?'g1':r>=.65?'g2':r>=.45?'g3':r>=.25?'g4':'g5'; };

        let html = `<div class="ce-th">
            <span>#</span><span>Crime</span>
            <span style="text-align:right">CE Score</span>
            <span style="text-align:right">Succ%</span>
            <span style="text-align:right">Nerve</span>
            <span style="text-align:right">n</span></div>`;

        for (let i = 0; i < rows.length; i++) {
            const r    = rows[i];
            const lowN = r.attempts < 20;
            const bonus = (chainBonus() * r.avgNerve * r.sr);
            const adjScore = (r.ceScore + bonus).toFixed(2);
            const tip = `${r.name}: ${r.successes}/${r.attempts} success, ${r.criticals} crits, avg ${r.avgNerve.toFixed(1)} nerve. With current chain bonus: ${adjScore} adj CE score.${lowN?' ⚠ Low sample.':''}`;
            html += `<div class="ce-row" title="${tip}">
                <span class="ce-rk">${i+1}</span>
                <span class="ce-nm">${r.name}${lowN?' ⚠':''}</span>
                <span class="ce-vl ${gc(r.ceScore)}">${r.ceScore.toFixed(2)}</span>
                <span class="ce-sr">${(r.sr*100).toFixed(0)}%</span>
                <span class="ce-nv">${r.avgNerve.toFixed(1)}</span>
                <span class="ce-nn">${r.attempts}</span>
            </div>`;
        }

        body.innerHTML = html;
    }

    // ── Patch record to count session ──────────────────────────────────────
    const _origRecord = record;
    const recordWithSession = (typeID, nerve, outcome) => {
        if (outcome === 'success' || outcome === 'failure' || outcome === 'critical failure') sessionCount++;
        _origRecord(typeID, nerve, outcome);
    };

    // Override record in fetch intercept
    // (JS closures: the fetch intercept already references `record` directly,
    //  so patch the outer variable)

    // ── Init ───────────────────────────────────────────────────────────────
    function init() {
        initDOMObserver();
        const obs = new MutationObserver(() => {
            if (document.querySelector('[class*="crimes-app"],[class*="crimesApp"],.crimes-app')) {
                obs.disconnect(); buildPanel();
            }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        if (document.querySelector('[class*="crimes-app"],[class*="crimesApp"],.crimes-app')) buildPanel();
        setTimeout(() => { if (!document.getElementById('ce-p')) buildPanel(); }, 3000);
    }

    document.readyState === 'loading'
        ? document.addEventListener('DOMContentLoaded', init)
        : init();

})();
