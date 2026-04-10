// ==UserScript==
// @name         OC Spawn Assistance
// @namespace    torn-oc-spawn-assistance
// @version      1.7.28
// @description  Analyzes faction OC slots vs member availability with scope budget and priority ordering
// @author       RussianRob
// @match        https://www.torn.com/factions.php*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      tornwar.com
// ==/UserScript==

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════
    //  SCOPE SYSTEM CONSTANTS
    //  Range → difficulty band, spawn cost, scope payout on success
    // ═══════════════════════════════════════════════════════════════════════
    const SCOPE_RANGES = [
        { range: 1, minDiff: 1,  maxDiff: 2,  cost: 1, payout: 2 },
        { range: 2, minDiff: 3,  maxDiff: 4,  cost: 2, payout: 3 },
        { range: 3, minDiff: 5,  maxDiff: 6,  cost: 3, payout: 4 },
        { range: 4, minDiff: 7,  maxDiff: 8,  cost: 4, payout: 5 },
        { range: 5, minDiff: 9,  maxDiff: 10, cost: 5, payout: 6 },
    ];
    const SCOPE_REGEN_PER_DAY = 1;
    const SCOPE_MAX           = 100;
    const DEFAULT_SLOTS_PER_OC = { 1: 2, 2: 4, 3: 3, 4: 6, 5: 8 };

    function diffToScopeRange(diff) {
        return SCOPE_RANGES.find(r => diff >= r.minDiff && diff <= r.maxDiff) || SCOPE_RANGES[0];
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  CONFIG  — defaults, overridden by faction-wide server settings
    // ═══════════════════════════════════════════════════════════════════════
    function loadConfig() {
        return {
            API_KEY:           'YOUR_API_KEY_HERE',
            FACTION_ID:        0, // Set by server
            ACTIVE_DAYS:             Number(GM_getValue('cfg_active_days',         7)),
            FORECAST_HOURS:          Number(GM_getValue('cfg_forecast_hours',     24)),
            MINCPR:                  Number(GM_getValue('cfg_mincpr',              60)),
            CPR_BOOST:               Number(GM_getValue('cfg_cpr_boost',          15)),
            CPR_LOOKBACK_DAYS:       Number(GM_getValue('cfg_lookback_days',      90)),
            HIGH_WEIGHT_THRESHOLD:   Number(GM_getValue('cfg_high_weight_pct',    25)),
            HIGH_WEIGHT_MIN_CPR:     Number(GM_getValue('cfg_high_weight_mincpr', 75)),
            ADMIN_ROLES:             GM_getValue('cfg_admin_roles', 'Leader,Co-leader'),
            SCOPE:             GM_getValue('cfg_scope', null),  // null = not configured
            VERSION:           '1.5.4',
        };
    }
    let CONFIG = loadConfig();

    let cprBreakdownMap = {};
    let recMap = {}; // uid → { crime, position, cpr, count }
    let lastScopeProjection = null;
    let scopePushTimer  = null;
    const SERVER = 'https://tornwar.com';

    // ═══════════════════════════════════════════════════════════════════════
    //  SCOPE SYNC  — push detected scope to server ASAP
    // ═══════════════════════════════════════════════════════════════════════
    function handleDetectedScope(scope, source) {
        if (scope === null || scope === CONFIG.SCOPE) return;

        console.log(`[OC Spawn] Detected scope ${scope} from ${source}`);
        CONFIG.SCOPE = scope;
        CONFIG._scopeAutoDetected = true;

        // Update settings panel input
        const scopeEl = document.getElementById('cfg-scope');
        if (scopeEl) scopeEl.value = scope;
        // Scope is sent to the server only when the user manually
        // clicks Refresh or Save Settings — no automatic server calls
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  AJAX INTERCEPTOR  — Catches internal Torn data (ASAP detection)
    // ═══════════════════════════════════════════════════════════════════════
    function setupAjaxInterceptor() {
        // Intercept XMLHttpRequest
        const oldOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function() {
            this.addEventListener('load', function() {
                if (this.responseURL.includes('step=getCrimesData')) {
                    try {
                        const data = JSON.parse(this.responseText);
                        const s = data?.scope_balance ?? data?.scope;
                        if (typeof s === 'number') handleDetectedScope(s, 'AJAX (XHR)');
                    } catch (e) {}
                }
            });
            return oldOpen.apply(this, arguments);
        };

        // Intercept Fetch
        const oldFetch = window.fetch;
        window.fetch = async function() {
            const res = await oldFetch.apply(this, arguments);
            const url = arguments[0] instanceof Request ? arguments[0].url : arguments[0];
            if (url && url.includes('step=getCrimesData')) {
                try {
                    const cloned = res.clone();
                    const data = await cloned.json();
                    const s = data?.scope_balance ?? data?.scope;
                    if (typeof s === 'number') handleDetectedScope(s, 'AJAX (Fetch)');
                } catch (e) {}
            }
            return res;
        };
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  DOM SCOPE READER  — fallback / secondary detection
    // ═══════════════════════════════════════════════════════════════════════
    function readScopeFromDom() {
        // Strategy 0: Check internal page state
        const win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        if (win.torn && win.torn.faction) {
             const s = win.torn.faction.scope_balance ?? win.torn.faction.scope;
             if (typeof s === 'number' && s >= 0 && s <= SCOPE_MAX) return s;
        }

        // Strategy 1: any element whose class contains 'scope' (exclude our panel)
        const byClass = document.querySelector('[class*="scope" i]:not(#oc-spawn-panel *)');
        if (byClass) {
            const num = parseInt(byClass.textContent.trim());
            if (!isNaN(num) && num >= 0 && num <= SCOPE_MAX) return num;
            const numChild = byClass.querySelector('span, b, strong');
            if (numChild) {
                const n2 = parseInt(numChild.textContent.trim());
                if (!isNaN(n2) && n2 >= 0 && n2 <= SCOPE_MAX) return n2;
            }
        }

        // Strategy 2: elements matching "Scope balance: NN" (exclude our panel)
        const candidates = document.querySelectorAll('span, div, p, li');
        for (const el of candidates) {
            if (el.closest('#oc-spawn-panel')) continue;
            if (el.children.length > 2) continue;
            const text = el.textContent.trim();
            const m = text.match(/scope[\s\w:]*?(\d+)/i);
            if (m) {
                const val = parseInt(m[1]);
                if (val >= 0 && val <= SCOPE_MAX) return val;
            }
        }
        return null;
    }

    function setupScopeDomReader() {
        function check() {
            const s = readScopeFromDom();
            if (s !== null) handleDetectedScope(s, 'DOM/State');
        }
        check();
        const observer = new MutationObserver(check);
        observer.observe(document.body, { childList: true, subtree: true });
    }

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
    //  GENERIC REQUEST  — GM_xmlhttpRequest (TornPDA) or fetch
    // ═══════════════════════════════════════════════════════════════════════
    function gmRequest(url) {
        if (typeof GM_xmlhttpRequest === 'function') {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET', url,
                    onload(r) {
                        try {
                            const data = JSON.parse(r.responseText);
                            resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, data });
                        } catch (e) {
                            const msg = r.status === 502 || r.status === 503
                                ? 'Server temporarily unavailable — wait a moment and try again'
                                : `Unexpected server response (${r.status})`;
                            resolve({ ok: false, status: r.status, data: { error: msg } });
                        }
                    },
                    onerror() { reject(new Error('Network error — could not reach tornwar.com')); },
                });
            });
        }
        return fetch(url).then(async r => {
            const text = await r.text();
            try { return { ok: r.ok, status: r.status, data: JSON.parse(text) }; }
            catch (e) {
                const msg = r.status === 502 || r.status === 503
                    ? 'Server temporarily unavailable — wait a moment and try again'
                    : `Unexpected server response (${r.status})`;
                return { ok: false, status: r.status, data: { error: msg } };
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  FACTION SETTINGS  — fetch & push via server (faction-wide)
    // ═══════════════════════════════════════════════════════════════════════
    async function fetchFactionSettings(apiKey) {
        try {
            const r = await gmRequest(`${SERVER}/api/oc/settings?key=${encodeURIComponent(apiKey)}`);
            if (!r.ok) return null;
            return r.data;
        } catch (e) {
            console.warn('[OC Spawn] Could not fetch faction settings:', e.message);
            return null;
        }
    }

    async function pushFactionSettings(apiKey, cfg) {
        try {
            const p = new URLSearchParams({
                key:                  apiKey,
                active_days:          cfg.ACTIVE_DAYS,
                forecast_hours:       cfg.FORECAST_HOURS,
                mincpr:               cfg.MINCPR,
                cpr_boost:            cfg.CPR_BOOST,
                lookback_days:        cfg.CPR_LOOKBACK_DAYS,
                high_weight_pct:      cfg.HIGH_WEIGHT_THRESHOLD,
                high_weight_mincpr:   cfg.HIGH_WEIGHT_MIN_CPR,
                admin_roles:          cfg.ADMIN_ROLES,
                scope:                cfg.SCOPE !== null ? cfg.SCOPE : '',
            });
            await gmRequest(`${SERVER}/api/oc/settings/update?${p}`);
        } catch (e) {
            console.warn('[OC Spawn] Could not push faction settings:', e.message);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  SERVER DATA  — GET /api/oc/spawn-key
    // ═══════════════════════════════════════════════════════════════════════
    async function fetchServerOcData(apiKey) {
        const r = await gmRequest(`${SERVER}/api/oc/spawn-key?key=${encodeURIComponent(apiKey)}`);
        if (r.status === 403) {
            const err = new Error(r.data?.error || 'Access restricted to faction members only.');
            err.status = 403; throw err;
        }
        if (!r.ok) throw new Error(r.data?.error || `Server error (${r.status})`);
        return r.data;
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
            border-radius: 10px; font-size: 12px; display: none;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            box-shadow: 0 4px 24px rgba(0,0,0,.7); padding: 14px 16px;
        }
        #oc-spawn-panel h2 {
            margin: 0 0 10px; font-size: 15px; font-weight: 700; color: #74c69d;
            display: flex; justify-content: space-between; align-items: center;
            cursor: move; user-select: none;
        }
        #oc-spawn-panel h3 {
            margin: 14px 0 6px; font-size: 10px; font-weight: 600; color: #6b7280;
            text-transform: uppercase; letter-spacing: 0.7px;
            border-bottom: 1px solid #1a2e20; padding-bottom: 4px;
        }
        /* Settings */
        #oc-settings-panel { display: none; background: #0f1f16; border: 1px solid #2a3f30; border-radius: 8px; padding: 12px 12px 8px; margin-bottom: 10px; }
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
        /* Stats & banners */
        .oc-stats-strip { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 8px; }
        .oc-stat-chip { background: #131f18; border: 1px solid #253525; border-radius: 20px; padding: 3px 10px; font-size: 11px; color: #9ca3af; }
        .oc-stat-chip b { color: #74c69d; font-weight: 600; }
        .oc-scope-strip { display: flex; align-items: center; gap: 8px; background: #12201a; border: 1px solid #2a3f30; border-radius: 6px; padding: 6px 10px; margin-bottom: 10px; font-size: 11px; }
        .oc-scope-bar-wrap { flex: 1; background: #0d1b14; border-radius: 3px; height: 6px; overflow: hidden; }
        .oc-scope-bar { height: 100%; border-radius: 3px; background: #2d6a4f; transition: width .3s; }
        .oc-scope-bar.warn { background: #b45309; }
        .oc-scope-bar.ok   { background: #2d6a4f; }
        .oc-spawn-banner { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; background: #1c1a0f; border: 1px solid #3d3010; border-left: 3px solid #f4a261; border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; font-size: 11px; color: #9ca3af; }
        .oc-spawn-banner.oc-banner-ok { background: #0f1c14; border-color: #1b4332; border-left-color: #74c69d; color: #74c69d; }
        .oc-lvl-chip { background: rgba(244,162,97,.15); color: #f4a261; border: 1px solid rgba(244,162,97,.3); border-radius: 4px; padding: 2px 8px; font-size: 11px; font-weight: 600; }
        /* Tables */
        .oc-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 11px; }
        .oc-table th { background: #0f1a14; color: #6b7280; padding: 5px 8px; text-align: left; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #1a2e20; }
        .oc-table td { padding: 4px 8px; border-bottom: 1px solid #131f18; vertical-align: middle; white-space: nowrap; color: #f3f4f6; }
        .oc-table tr:hover td { background: #131f18; }
        .oc-row-spawn         > td:first-child { border-left: 2px solid #f4a261; padding-left: 6px; }
        .oc-row-spawn-partial > td:first-child { border-left: 2px solid #d97706; padding-left: 6px; }
        .oc-row-ok            > td:first-child { border-left: 2px solid #74c69d; padding-left: 6px; }
        .oc-row-surplus       > td:first-child { border-left: 2px solid #60a5fa; padding-left: 6px; }
        .oc-row-deferred      > td:first-child { border-left: 2px solid #374151; padding-left: 6px; }
        .oc-row-none          > td:first-child { border-left: 2px solid #374151; padding-left: 6px; }
        .oc-row-none td { color: #6b7280; }
        .oc-row-deferred td { color: #6b7280 !important; }
        /* Badges & tags */
        .oc-tag-spawn { display: inline-block; background: rgba(244,162,97,.15); color: #f4a261; border: 1px solid rgba(244,162,97,.3); border-radius: 4px; padding: 2px 7px; font-size: 10px; font-weight: 700; }
        .oc-tag-spawn-partial { display: inline-block; background: rgba(217,119,6,.15); color: #d97706; border: 1px solid rgba(217,119,6,.3); border-radius: 4px; padding: 2px 7px; font-size: 10px; font-weight: 700; }
        .oc-tag-deferred { display: inline-block; background: rgba(55,65,81,.2); color: #6b7280; border: 1px solid rgba(55,65,81,.3); border-radius: 4px; padding: 2px 7px; font-size: 10px; }
        .oc-tag-ok { display: inline-block; background: rgba(116,198,157,.12); color: #74c69d; border: 1px solid rgba(116,198,157,.25); border-radius: 4px; padding: 2px 7px; font-size: 10px; }
        .oc-tag-surplus { display: inline-block; background: rgba(96,165,250,.1); color: #90e0ef; border: 1px solid rgba(96,165,250,.2); border-radius: 4px; padding: 2px 7px; font-size: 10px; }
        .oc-tag-none { color: #6b7280; }
        .oc-badge { display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 10px; }
        .oc-badge-in   { background: rgba(59,130,246,.1);   color: #60a5fa; border: 1px solid rgba(59,130,246,.2); }
        .oc-badge-soon { background: rgba(244,162,97,.12);  color: #f4a261; border: 1px solid rgba(244,162,97,.25); }
        .oc-badge-free { background: rgba(116,198,157,.12); color: #74c69d; border: 1px solid rgba(116,198,157,.25); }
        .oc-range-chip { display: inline-block; background: #1a2a1f; color: #6b7280; border-radius: 3px; padding: 1px 5px; font-size: 9px; margin-left: 3px; }
        .oc-cpr-high { color: #74c69d; } .oc-cpr-mid { color: #f4a261; } .oc-cpr-low { color: #9ca3af; }
        .oc-member-name { color: #f3f4f6; font-weight: 500; }
        .oc-member-id   { color: #6b7280; font-size: 10px; }
        .oc-cpr-click, .oc-proj-click { cursor: pointer; border-bottom: 1px dotted currentColor; }
        .oc-cpr-click:hover, .oc-proj-click:hover { opacity: 0.75; }
        /* Tooltips */
        #oc-cpr-tooltip, #oc-scope-tooltip { position: fixed; z-index: 10001; background: #131f18; border: 1px solid #2d4a3e; border-radius: 8px; padding: 10px 12px; font-size: 11px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #d1d5db; box-shadow: 0 4px 20px rgba(0,0,0,.7); min-width: 220px; max-width: 300px; display: none; pointer-events: none; }
        #oc-cpr-tooltip .oc-tt-title, #oc-scope-tooltip .oc-tt-title { font-weight: 600; color: #f3f4f6; margin-bottom: 5px; font-size: 12px; }
        #oc-cpr-tooltip .oc-tt-avg, #oc-scope-tooltip .oc-tt-avg   { color: #9ca3af; font-size: 10px; margin-bottom: 7px; }
        #oc-cpr-tooltip table, #oc-scope-tooltip table { width: 100%; border-collapse: collapse; }
        #oc-cpr-tooltip th, #oc-scope-tooltip th { color: #6b7280; font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; padding: 2px 4px; border-bottom: 1px solid #1a2e20; text-align: left; }
        #oc-cpr-tooltip td, #oc-scope-tooltip td { padding: 3px 4px; font-size: 11px; color: #f3f4f6; }
        #oc-cpr-tooltip .oc-tt-note, #oc-scope-tooltip .oc-tt-note { color: #6b7280; font-size: 10px; margin-top: 7px; border-top: 1px solid #1a2e20; padding-top: 5px; }
        /* Misc */
        #oc-spawn-status { color: #6b7280; font-style: italic; margin: -6px 0 10px; font-size: 10px; }
        #oc-spawn-refresh { background: #152018; color: #74c69d; border: 1px solid #2d4a3e; border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 11px; font-family: inherit; font-weight: 600; }
        #oc-spawn-refresh:hover { background: #2d6a4f; color: #fff; }
        #oc-spawn-refresh:disabled { opacity: .4; cursor: default; }
        .oc-error { color: #f87171; font-weight: 600; }
        .oc-hdr-btn { background: #1a2a1f; color: #9ca3af; border: 1px solid #2d4a3e; border-radius: 6px; padding: 4px 9px; font-size: 12px; cursor: pointer; line-height: 1; font-family: inherit; }
        .oc-hdr-btn:hover { background: #253525; color: #d1d5db; }
        /* Tab bar */
        .oc-tab-bar { display: flex; border-bottom: 1px solid #2d4a3e; margin-bottom: 10px; gap: 0; }
        .oc-tab { background: none; border: none; border-bottom: 2px solid transparent; color: #6b7280; padding: 6px 16px; cursor: pointer; font-family: inherit; font-size: 12px; font-weight: 500; margin-bottom: -1px; transition: color .15s; }
        .oc-tab:hover:not(.oc-tab-active) { color: #d1d5db; }
        .oc-tab-active { color: #74c69d; border-bottom-color: #74c69d; }
        /* Viewer personal card */
        .oc-viewer-card {
            background: #111f18; border: 1px solid #2d4a3e;
            border-left: 3px solid #74c69d;
            border-radius: 6px; padding: 8px 12px; margin-bottom: 10px; font-size: 11px;
        }
        .oc-viewer-name { font-weight: 600; color: #f3f4f6; margin-bottom: 4px; }
        .oc-viewer-meta { color: #9ca3af; margin-bottom: 5px; font-size: 10px; }
        .oc-viewer-crimes { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 5px; }
        .oc-viewer-crime {
            background: rgba(116,198,157,.12); color: #74c69d;
            border: 1px solid rgba(116,198,157,.25); border-radius: 4px;
            padding: 2px 8px; font-size: 10px;
        }
        .oc-viewer-none { color: #6b7280; font-size: 10px; font-style: italic; }
        /* Per-member OC recommendation */
        .oc-rec-btn {
            cursor: pointer; display: inline-block;
            background: rgba(116,198,157,.12); color: #74c69d;
            border: 1px solid rgba(116,198,157,.25); border-radius: 4px;
            padding: 2px 7px; font-size: 10px; font-weight: 600;
        }
        .oc-rec-btn:hover { background: rgba(116,198,157,.22); }
        #oc-rec-tooltip {
            position: fixed; z-index: 10001; background: #131f18;
            border: 1px solid #2d4a3e; border-radius: 8px;
            padding: 10px 12px; font-size: 11px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: #d1d5db; box-shadow: 0 4px 20px rgba(0,0,0,.7);
            min-width: 180px; max-width: 260px; display: none; pointer-events: none;
        }
        #oc-rec-tooltip .oc-tt-title { font-weight: 600; color: #f3f4f6; margin-bottom: 5px; font-size: 12px; }
        #oc-rec-tooltip .oc-tt-note  { color: #6b7280; font-size: 10px; margin-top: 5px; }
    `);

    // ═══════════════════════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════════════════════
    //  DRAGGABLE HELPER  — works for both mouse and touch (TornPDA)
    // ═══════════════════════════════════════════════════════════════════════
    function makeDraggable(el, { handle = el, onClickFn = null, storageKey = null } = {}) {
        // Restore saved position
        if (storageKey) {
            const saved = GM_getValue(storageKey, null);
            if (saved) {
                el.style.bottom = 'auto'; el.style.right = 'auto';
                el.style.top  = saved.top  + 'px';
                el.style.left = saved.left + 'px';
            }
        }

        let sx, sy, sl, st, moved, suppressClick = false;

        function evtPos(e) {
            return e.touches ? [e.touches[0].clientX, e.touches[0].clientY]
                             : [e.clientX, e.clientY];
        }

        // Click is handled via a dedicated listener so it works reliably after drags
        if (onClickFn) {
            handle.addEventListener('click', e => {
                if (suppressClick) { suppressClick = false; return; }
                // Only fire if no drag happened (mousedown case — touch fires click natively)
                onClickFn();
            });
        }

        function onStart(e) {
            // Skip interactive children (but not the handle element itself)
            const interactive = e.target.closest('button, input, select, a');
            if (interactive && interactive !== handle) return;
            const [x, y] = evtPos(e);
            sx = x; sy = y;
            const r = el.getBoundingClientRect();
            sl = r.left; st = r.top;
            moved = false;
            el.style.bottom = 'auto'; el.style.right = 'auto';
            el.style.top  = st + 'px';
            el.style.left = sl + 'px';
            document.addEventListener('mousemove', onMove);
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('mouseup',   onEnd);
            document.addEventListener('touchend',  onEnd);
        }

        function onMove(e) {
            const [x, y] = evtPos(e);
            const dx = x - sx, dy = y - sy;
            if (!moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) moved = true;
            if (!moved) return;
            const w = el.offsetWidth, h = el.offsetHeight;
            el.style.left = Math.max(0, Math.min(window.innerWidth  - w, sl + dx)) + 'px';
            el.style.top  = Math.max(0, Math.min(window.innerHeight - h, st + dy)) + 'px';
            if (e.cancelable) e.preventDefault();
        }

        function onEnd() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('mouseup',   onEnd);
            document.removeEventListener('touchend',  onEnd);
            if (moved) {
                suppressClick = true;
                setTimeout(() => { suppressClick = false; }, 300); // reset if no synthetic click arrives
                if (storageKey) GM_setValue(storageKey, {
                    top:  parseInt(el.style.top),
                    left: parseInt(el.style.left),
                });
            }
        }

        handle.style.cursor = 'grab';
        handle.addEventListener('mousedown',  onStart);
        handle.addEventListener('touchstart', onStart, { passive: true });
    }

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
                    <div class="oc-setting-desc">Your personal Torn API key. Must belong to a faction member.</div>
                    <div class="oc-setting-key-wrap">
                        <input id="oc-spawn-key-input" type="password" placeholder="Paste API key…" class="oc-setting-key-input"/>
                        <button id="oc-spawn-key-save" class="oc-setting-save-btn">Save</button>
                    </div>
                </div>
            </div>
            <hr class="oc-setting-divider"/>
            <div class="oc-setting-row">
                <div class="oc-setting-info">
                    <span class="oc-setting-label">Current Scope</span>
                    <div class="oc-setting-desc">Your faction's current scope balance (0–100). Check the spawn page and update here — the script projects forward from this value.</div>
                </div>
                <input class="oc-setting-num" id="cfg-scope" type="number" min="0" max="100" placeholder="—"/>
            </div>
            <div class="oc-setting-row">
                <div class="oc-setting-info">
                    <span class="oc-setting-label">Active Days</span>
                    <div class="oc-setting-desc">Members inactive longer than this are skipped entirely.</div>
                </div>
                <input class="oc-setting-num" id="cfg-active-days" type="number" min="1" max="30"/>
            </div>
            <div class="oc-setting-row">
                <div class="oc-setting-info">
                    <span class="oc-setting-label">Forecast Hours</span>
                    <div class="oc-setting-desc">Members whose OC ends within this window count as "soon free".</div>
                </div>
                <input class="oc-setting-num" id="cfg-forecast-hours" type="number" min="1" max="72"/>
            </div>
            <div class="oc-setting-row">
                <div class="oc-setting-info">
                    <span class="oc-setting-label">Min CPR %</span>
                    <div class="oc-setting-desc">Below this, member defaults to Lvl 1 eligibility.</div>
                </div>
                <input class="oc-setting-num" id="cfg-mincpr" type="number" min="0" max="100"/>
            </div>
            <div class="oc-setting-row">
                <div class="oc-setting-info">
                    <span class="oc-setting-label">CPR Boost</span>
                    <div class="oc-setting-desc">CPR ≥ Min+Boost lets a member join one level above their best.</div>
                </div>
                <input class="oc-setting-num" id="cfg-cpr-boost" type="number" min="0" max="40"/>
            </div>
            <div class="oc-setting-row">
                <div class="oc-setting-info">
                    <span class="oc-setting-label">CPR Lookback Days</span>
                    <div class="oc-setting-desc">Days of completed crimes for CPR. Server-cached 6h.</div>
                </div>
                <input class="oc-setting-num" id="cfg-lookback-days" type="number" min="7" max="365"/>
            </div>
            <div class="oc-setting-row">
                <div class="oc-setting-info">
                    <span class="oc-setting-label">High-Weight % Cutoff</span>
                    <div class="oc-setting-desc">Slots at or above this weight % require the higher CPR below.</div>
                </div>
                <input class="oc-setting-num" id="cfg-high-weight-pct" type="number" min="1" max="100"/>
            </div>
            <div class="oc-setting-row">
                <div class="oc-setting-info">
                    <span class="oc-setting-label">High-Weight Min CPR</span>
                    <div class="oc-setting-desc">Min CPR required for slots at or above the cutoff above.</div>
                </div>
                <input class="oc-setting-num" id="cfg-high-weight-mincpr" type="number" min="0" max="100"/>
            </div>
            <div class="oc-setting-row">
                <div class="oc-setting-info">
                    <span class="oc-setting-label">Admin Roles</span>
                    <div class="oc-setting-desc">Comma-separated faction role names that can access the Admin tab (e.g. Leader,Co-leader,Officer).</div>
                </div>
                <input class="oc-setting-key-input" id="cfg-admin-roles" type="text" placeholder="Leader,Co-leader" style="width:140px;font-size:11px;"/>
            </div>
            <div style="text-align:right;margin-top:4px;">
                <button id="oc-spawn-cfg-save" class="oc-setting-save-btn">Save for All Members</button>
            </div>
        </div>

        <div id="oc-tab-bar" class="oc-tab-bar" style="display:none;">
            <button class="oc-tab oc-tab-active" data-tab="profile">My OC</button>
            <button class="oc-tab" data-tab="admin" id="oc-admin-tab" style="display:none;">Admin</button>
        </div>
        <div id="oc-tab-profile"></div>
        <div id="oc-tab-admin" style="display:none;"></div>
    `;
    document.body.appendChild(panel);

    const cprTooltipEl = document.createElement('div');
    cprTooltipEl.id = 'oc-cpr-tooltip';
    document.body.appendChild(cprTooltipEl);

    const recTooltipEl = document.createElement('div');
    recTooltipEl.id = 'oc-rec-tooltip';
    document.body.appendChild(recTooltipEl);

    const scopeTooltipEl = document.createElement('div');
    scopeTooltipEl.id = 'oc-scope-tooltip';
    document.body.appendChild(scopeTooltipEl);

    let panelVisible = false, cprTipOpen = false, scopeTipOpen = false;

    // Draggable toggle button — tap to open/close, drag to reposition
    makeDraggable(toggleBtn, {
        onClickFn:  () => {
            panelVisible = !panelVisible;
            panel.style.display = panelVisible ? 'block' : 'none';
            if (panelVisible) GM_setValue('oc_panel_closed', false); // clear the closed flag
        },
        storageKey: 'oc_btn_pos',
    });

    // Draggable panel — drag the header to reposition (position not saved)
    makeDraggable(panel, {
        handle: panel.querySelector('h2'),
    });
    let _lastRefresh = 0;
    document.getElementById('oc-spawn-refresh').addEventListener('click', () => {
        if (Date.now() - _lastRefresh < 3000) return; // 3s cooldown between refreshes
        _lastRefresh = Date.now();
        runAnalysis();
    });
    document.getElementById('oc-spawn-close').addEventListener('click', () => {
        panelVisible = false; panel.style.display = 'none';
        GM_setValue('oc_panel_closed', true); // stay closed until user taps button
    });
    document.getElementById('oc-spawn-settings').addEventListener('click', () => {
        // Switch to Admin tab first, then toggle settings
        switchTab('admin');
        const sp = document.getElementById('oc-settings-panel');
        const opening = sp.style.display === 'none' || sp.style.display === '';
        sp.style.display = opening ? 'block' : 'none';
        if (opening) populateSettings();
    });

    function switchTab(name) {
        document.querySelectorAll('.oc-tab').forEach(t => {
            t.classList.toggle('oc-tab-active', t.dataset.tab === name);
        });
        document.getElementById('oc-tab-profile').style.display = name === 'profile' ? '' : 'none';
        document.getElementById('oc-tab-admin').style.display   = name === 'admin'   ? '' : 'none';
        // Close settings panel when switching to profile
        if (name === 'profile') document.getElementById('oc-settings-panel').style.display = 'none';
    }

    document.querySelectorAll('.oc-tab').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    function populateSettings() {
        const key = getApiKey();
        const inp = document.getElementById('oc-spawn-key-input');
        inp.value = '';
        inp.placeholder = (key && key !== 'YOUR_API_KEY_HERE') ? '••••••••' + key.slice(-4) : 'Paste API key…';
        const scopeEl = document.getElementById('cfg-scope');
        scopeEl.value = CONFIG.SCOPE !== null ? CONFIG.SCOPE : '';
        scopeEl.placeholder = CONFIG.SCOPE !== null ? '' : '—';
        document.getElementById('cfg-active-days').value    = CONFIG.ACTIVE_DAYS;
        document.getElementById('cfg-forecast-hours').value = CONFIG.FORECAST_HOURS;
        document.getElementById('cfg-mincpr').value              = CONFIG.MINCPR;
        document.getElementById('cfg-cpr-boost').value            = CONFIG.CPR_BOOST;
        document.getElementById('cfg-lookback-days').value        = CONFIG.CPR_LOOKBACK_DAYS;
        document.getElementById('cfg-high-weight-pct').value      = CONFIG.HIGH_WEIGHT_THRESHOLD;
        document.getElementById('cfg-high-weight-mincpr').value   = CONFIG.HIGH_WEIGHT_MIN_CPR;
        document.getElementById('cfg-admin-roles').value          = CONFIG.ADMIN_ROLES;
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
        GM_setValue('oc_srv_token', null);
        document.getElementById('oc-spawn-key-input').value = '';
        document.getElementById('oc-spawn-key-input').placeholder = '••••••••' + val.slice(-4);
        setStatus('API key saved. Click Refresh.');
    });

    document.getElementById('oc-spawn-cfg-save').addEventListener('click', async () => {
        const get    = id => Math.max(0, parseInt(document.getElementById(id).value) || 0);
        const rawScope = parseInt(document.getElementById('cfg-scope').value, 10);
        CONFIG.SCOPE          = isNaN(rawScope) ? null : Math.max(0, Math.min(100, rawScope));
        CONFIG.ACTIVE_DAYS    = get('cfg-active-days');
        CONFIG.FORECAST_HOURS = get('cfg-forecast-hours');
        CONFIG.MINCPR                = get('cfg-mincpr');
        CONFIG.CPR_BOOST             = get('cfg-cpr-boost');
        CONFIG.CPR_LOOKBACK_DAYS     = get('cfg-lookback-days');
        CONFIG.HIGH_WEIGHT_THRESHOLD = get('cfg-high-weight-pct');
        CONFIG.HIGH_WEIGHT_MIN_CPR   = get('cfg-high-weight-mincpr');
        CONFIG.ADMIN_ROLES           = document.getElementById('cfg-admin-roles').value.trim() || 'Leader,Co-leader';

        // Local persistence
        GM_setValue('cfg_active_days',    CONFIG.ACTIVE_DAYS);
        GM_setValue('cfg_forecast_hours', CONFIG.FORECAST_HOURS);
        GM_setValue('cfg_mincpr',              CONFIG.MINCPR);
        GM_setValue('cfg_cpr_boost',           CONFIG.CPR_BOOST);
        GM_setValue('cfg_lookback_days',       CONFIG.CPR_LOOKBACK_DAYS);
        GM_setValue('cfg_high_weight_pct',     CONFIG.HIGH_WEIGHT_THRESHOLD);
        GM_setValue('cfg_high_weight_mincpr',  CONFIG.HIGH_WEIGHT_MIN_CPR);
        GM_setValue('cfg_admin_roles',         CONFIG.ADMIN_ROLES);
        GM_setValue('cfg_scope',               CONFIG.SCOPE);

        document.getElementById('oc-settings-panel').style.display = 'none';
        setStatus('Saving settings for all faction members…');
        const apiKey = getApiKey();
        if (apiKey && apiKey !== 'YOUR_API_KEY_HERE') await pushFactionSettings(apiKey, CONFIG);
        setStatus('Settings saved for all faction members. Click Refresh.');
    });

    // ═══════════════════════════════════════════════════════════════════════
    //  CPR TOOLTIP
    // ═══════════════════════════════════════════════════════════════════════
    function showCprTooltip(el) {
        const uid = parseInt(el.dataset.uid), data = cprBreakdownMap[uid];
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
            <div class="oc-tt-note">Only counts crimes within 1 level of player's best</div>`;
        cprTooltipEl.style.display = 'block';
        const rect = el.getBoundingClientRect();
        cprTooltipEl.style.top = (rect.bottom + 6) + 'px';
        cprTooltipEl.style.left = rect.left + 'px';
        requestAnimationFrame(() => {
            const tr = cprTooltipEl.getBoundingClientRect();
            if (tr.right  > window.innerWidth  - 8) cprTooltipEl.style.left = (window.innerWidth  - tr.width  - 8) + 'px';
            if (tr.bottom > window.innerHeight - 8) cprTooltipEl.style.top  = (rect.top - tr.height - 6) + 'px';
        });
        cprTipOpen = true;
    }
    function hideCprTooltip() { cprTooltipEl.style.display = 'none'; cprTipOpen = false; }

    // ═══════════════════════════════════════════════════════════════════════
    //  REC TOOLTIP
    // ═══════════════════════════════════════════════════════════════════════
    function showRecTooltip(el) {
        const uid = parseInt(el.dataset.uid);
        const rec = recMap[uid];
        if (!rec) return;
        let html;
        if (rec.type === 'inoc') {
            html = `<div class="oc-tt-title">Currently in OC</div><div class="oc-tt-avg">${rec.text}</div>`;
        } else if (rec.type === 'none') {
            html = `<div class="oc-tt-title">No OCs Available</div><div class="oc-tt-avg">${rec.text}</div>`;
        } else {
            const cprStr = rec.cpr > 0 ? ` <span style="color:#74c69d">${rec.cpr}%</span>` : '';
            const posStr = rec.position ? `<br><span style="color:#9ca3af">Role: ${rec.position}${cprStr}</span>` : '';
            const moreStr = rec.count > 1 ? `<div class="oc-tt-note">${rec.count - 1} other Lvl ${rec.level} OC${rec.count > 2 ? 's' : ''} also open</div>` : '';
            html = `<div class="oc-tt-title">${rec.crime}</div><div class="oc-tt-avg">Lvl ${rec.level} OC${posStr}</div>${moreStr}`;
        }
        recTooltipEl.innerHTML = html;
        recTooltipEl.style.display = 'block';
        const r = el.getBoundingClientRect();
        recTooltipEl.style.top  = (r.bottom + 6) + 'px';
        recTooltipEl.style.left = r.left + 'px';
        requestAnimationFrame(() => {
            const tr = recTooltipEl.getBoundingClientRect();
            if (tr.right  > window.innerWidth  - 8) recTooltipEl.style.left = (window.innerWidth  - tr.width  - 8) + 'px';
            if (tr.bottom > window.innerHeight - 8) recTooltipEl.style.top  = (r.top - tr.height - 6) + 'px';
        });
    }
    function hideRecTooltip() { recTooltipEl.style.display = 'none'; }

    // ═══════════════════════════════════════════════════════════════════════
    //  SCOPE TOOLTIP
    // ═══════════════════════════════════════════════════════════════════════
    function showScopeTooltip(el) {
        if (!lastScopeProjection || !lastScopeProjection.details.length) {
            if (lastScopeProjection) {
                scopeTooltipEl.innerHTML = `<div class="oc-tt-title">Scope Projection</div><div class="oc-tt-avg">No in-flight crimes found in ${CONFIG.FORECAST_HOURS}h window. Only daily regen (+${lastScopeProjection.regen}) applied.</div>`;
                scopeTooltipEl.style.display = 'block';
                const r = el.getBoundingClientRect();
                scopeTooltipEl.style.top = (r.bottom + 6) + 'px'; scopeTooltipEl.style.left = r.left + 'px';
                scopeTipOpen = true;
            }
            return;
        }
        const p = lastScopeProjection;
        const rows = p.details.map(d => {
            return `<tr><td>${d.name}</td><td>${d.avgCpr}%</td><td>+${d.expectedGain}</td></tr>`;
        }).join('');

        scopeTooltipEl.innerHTML = `
            <div class="oc-tt-title">Scope Calculation</div>
            <div class="oc-tt-avg">Base: <b>${p.current}</b> + ${p.regen} daily</div>
            <table><thead><tr><th>Crime</th><th>Prob.</th><th>Gain</th></tr></thead><tbody>${rows}</tbody></table>
            <div class="oc-tt-note">Gain = Success payout × Average member CPR</div>`;
        scopeTooltipEl.style.display = 'block';
        const rect = el.getBoundingClientRect();
        scopeTooltipEl.style.top = (rect.bottom + 6) + 'px';
        scopeTooltipEl.style.left = rect.left + 'px';
        requestAnimationFrame(() => {
            const tr = scopeTooltipEl.getBoundingClientRect();
            if (tr.right  > window.innerWidth  - 8) scopeTooltipEl.style.left = (window.innerWidth  - tr.width  - 8) + 'px';
            if (tr.bottom > window.innerHeight - 8) scopeTooltipEl.style.top  = (rect.top - tr.height - 6) + 'px';
        });
        scopeTipOpen = true;
    }
    function hideScopeTooltip() { scopeTooltipEl.style.display = 'none'; scopeTipOpen = false; }

    panel.addEventListener('click', e => {
        const t = e.target.closest('.oc-cpr-click');
        if (t) { e.stopPropagation(); hideScopeTooltip(); hideRecTooltip(); showCprTooltip(t); return; }
        const ps = e.target.closest('.oc-proj-click');
        if (ps) { e.stopPropagation(); hideCprTooltip(); hideRecTooltip(); showScopeTooltip(ps); return; }
        const rb = e.target.closest('.oc-rec-btn');
        if (rb) { e.stopPropagation(); hideCprTooltip(); hideScopeTooltip(); showRecTooltip(rb); return; }
        hideCprTooltip(); hideScopeTooltip(); hideRecTooltip();
    });
    document.addEventListener('click', () => { if (cprTipOpen) hideCprTooltip(); if (scopeTipOpen) hideScopeTooltip(); hideRecTooltip(); });

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
        const activeCutoff = now() - CONFIG.ACTIVE_DAYS * 86400;
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
            const uid = m.id ?? m.player_id;
            const lastAction = m.last_action?.timestamp ?? 0;
            if (lastAction < activeCutoff) { skipped.push({ ...m, id: uid, skipReason: `Inactive >${CONFIG.ACTIVE_DAYS}d` }); continue; }
            const ocInfo = memberOcMap[uid];
            const inOC   = !!ocInfo;
            if (inOC && ocInfo.readyAt > forecastCutoff) { skipped.push({ ...m, id: uid, skipReason: `In OC (ready ${fmtTs(ocInfo.readyAt)})` }); continue; }
            const cpr = cprCache[uid] ?? null;
            const cprValue = cpr?.cpr ?? null;
            const highestLvl = cpr?.highestLevel ?? 0;
            const joinable = (cprValue === null || cprValue < CONFIG.MINCPR) ? 1 : (cpr?.joinable ?? 1);
            eligible.push({
                id: uid, name: m.name, lastAction, status: m.status?.state ?? 'Unknown',
                inOC, ocReadyAt: inOC ? ocInfo.readyAt : null,
                ocCrimeName: inOC ? ocInfo.crimeName : null, ocStatus: inOC ? ocInfo.crimeStatus : null,
                currentCrimeDiff: inOC ? ocInfo.crimeDifficulty : null,
                cpr: cprValue, highestLevel: highestLvl, joinable,
                noCrimeHistory: cprValue === null,
                cprEstimated:  cpr?.estimated || false,
                cprEntries:    cpr?.entries ?? [],
                byPosition:    cpr?.byPosition ?? {},
            });
        }
        return { eligible, skipped };
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  SCOPE PROJECTION
    // ═══════════════════════════════════════════════════════════════════════
    function projectScope(currentScope, eligible) {
        if (currentScope === null) return null;
        const regenDays = CONFIG.FORECAST_HOURS / 24;
        const regen = regenDays * SCOPE_REGEN_PER_DAY;

        // Expected scope from in-flight crimes completing within the forecast window
        const forecastCutoff = now() + CONFIG.FORECAST_HOURS * 3600;
        const completingSoon = eligible.filter(m => m.inOC && m.ocReadyAt && m.ocReadyAt <= forecastCutoff);

        // Group by crime (shared readyAt + difficulty)
        const crimeGroups = {};
        for (const m of completingSoon) {
            const key = `${m.ocReadyAt}_${m.currentCrimeDiff}`;
            if (!crimeGroups[key]) crimeGroups[key] = { diff: m.currentCrimeDiff, name: m.ocCrimeName, members: [] };
            crimeGroups[key].members.push(m);
        }

        let totalExpectedGain = 0;
        const details = [];
        for (const group of Object.values(crimeGroups)) {
            if (!group.diff) continue;
            const range   = diffToScopeRange(group.diff);
            const avgCPR  = group.members.reduce((s, m) => s + (m.cpr ?? 0), 0) / group.members.length;
            const gain    = Math.round((range.payout * (avgCPR / 100)) * 10) / 10;
            totalExpectedGain += gain;
            details.push({ name: group.name || `Lvl ${group.diff} OC`, avgCpr: Math.round(avgCPR), payout: range.payout, expectedGain: gain });
        }

        const projected = Math.min(SCOPE_MAX, currentScope + regen + totalExpectedGain);
        return { current: currentScope, regen: Math.round(regen * 10) / 10, expectedGain: Math.round(totalExpectedGain * 10) / 10, projected: Math.round(projected * 10) / 10, details };
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  SLOT COUNT
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

    // ═══════════════════════════════════════════════════════════════════════
    //  RECOMMENDATIONS  — priority high→low, scope-budgeted
    // ═══════════════════════════════════════════════════════════════════════
    function buildRecommendations(eligible, slotMap, scopeProjection) {
        // Process HIGH levels first (priority), then walk down
        let scopeBudget = scopeProjection ? scopeProjection.projected : null;
        const recs = [];

        for (let lvl = 10; lvl >= 1; lvl--) {
            const membersForLevel = eligible.filter(m => m.joinable === lvl);
            const freeNow   = membersForLevel.filter(m => !m.inOC);
            const soonFree  = membersForLevel.filter(m => m.inOC);
            const totalNeeded = freeNow.length + soonFree.length;
            const info    = slotMap[lvl] || { totalSlots: 0, openSlots: 0, crimes: [] };
            const deficit = totalNeeded - info.openSlots;
            const sr      = diffToScopeRange(lvl);

            const slotsPerOc = info.crimes.length > 0 ? (info.totalSlots / info.crimes.length) : DEFAULT_SLOTS_PER_OC[sr.range];
            // Only recommend spawning if we have enough people to FILL an OC
            const numOcsNeeded = Math.floor(deficit / slotsPerOc);

            let action, numOcsToSpawn = 0;

            if (totalNeeded === 0 || (info.openSlots === 0 && numOcsNeeded === 0)) {
                action = 'none';
            } else if (deficit <= 0) {
                action = deficit === 0 ? 'ok' : 'surplus';
                numOcsToSpawn = 0;
            } else if (numOcsNeeded === 0) {
                // Deficit > 0 but not enough for a full OC. Open slots exist and are being filled.
                action = 'waiting';
                numOcsToSpawn = 0;
            } else if (scopeBudget === null) {
                // No scope configured — fall back to simple deficit
                action = 'spawn';
                numOcsToSpawn = numOcsNeeded;
            } else {
                const canAfford = Math.floor(scopeBudget / sr.cost);
                if (canAfford <= 0) {
                    action = 'deferred';
                    numOcsToSpawn = 0;
                } else if (canAfford < numOcsNeeded) {
                    action = 'spawn_partial';
                    numOcsToSpawn = canAfford;
                    scopeBudget -= canAfford * sr.cost;
                } else {
                    action = 'spawn';
                    numOcsToSpawn = numOcsNeeded;
                    scopeBudget -= numOcsNeeded * sr.cost;
                }
            }

            recs.push({
                level: lvl, freeMembers: freeNow.length, soonMembers: soonFree.length,
                openSlots: info.openSlots, totalSlots: info.totalSlots,
                recruitingOCs: info.crimes.length, deficit, numOcsToSpawn, action,
                scopeCost: sr.cost, scopeRange: sr.range,
                names: membersForLevel.map(m => m.name),
            });
        }

        // Display order: high levels first (already in correct order)
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

    function renderScopeStrip(scopeProjection) {
        if (!scopeProjection) {
            return `<div class="oc-scope-strip" style="color:#6b7280;font-size:10px;">
                Scope not configured — set it in ⚙ Settings to enable budget planning
            </div>`;
        }
        const { current, regen, expectedGain, projected } = scopeProjection;
        const barClass = projected < 10 ? 'warn' : 'ok';
        const autoTag = CONFIG._scopeAutoDetected
            ? `<span style="font-size:9px;color:#2d6a4f;margin-left:4px;">● live</span>`
            : `<span style="font-size:9px;color:#374151;margin-left:4px;">manual</span>`;
        return `<div class="oc-scope-strip">
            <div style="white-space:nowrap;color:#9ca3af;font-size:10px;">Scope${autoTag}</div>
            <div style="font-weight:600;color:#f3f4f6;white-space:nowrap;">${current}</div>
            <div class="oc-scope-bar-wrap"><div class="oc-scope-bar ${barClass}" style="width:${Math.round(current/SCOPE_MAX*100)}%"></div></div>
            <div style="color:#6b7280;font-size:10px;white-space:nowrap;">→ <span class="oc-proj-click"><b style="color:#74c69d">${projected}</b> projected</span>
                <span style="color:#374151">(+${regen} daily, +${expectedGain} from crimes)</span>
            </div>
        </div>`;
    }

    function renderRecommendations(recs, scopeProjection) {
        // Show any level that has eligible members OR has OC slots — don't silently drop rows
        const visible = recs.filter(r => r.action !== 'none' || r.freeMembers + r.soonMembers > 0 || r.totalSlots > 0);
        if (!visible.length) return '<p class="oc-tag-none">No eligible members found for any level.</p>';

        const rows = visible.map(r => {
            let actionHtml;
            if (r.action === 'spawn') {
                actionHtml = `<span class="oc-tag-spawn">Spawn ${r.numOcsToSpawn} OC${r.numOcsToSpawn > 1 ? 's' : ''}</span>`;
            } else if (r.action === 'spawn_partial') {
                actionHtml = `<span class="oc-tag-spawn-partial">Spawn ${r.numOcsToSpawn} OC${r.numOcsToSpawn > 1 ? 's' : ''} <span style="font-size:9px;opacity:.8">(need +${r.deficit} roles)</span></span>`;
            } else if (r.action === 'deferred') {
                actionHtml = `<span class="oc-tag-deferred">Deferred — no scope</span>`;
            } else if (r.action === 'ok') {
                actionHtml = `<span class="oc-tag-ok">✓ Covered</span>`;
            } else if (r.action === 'waiting') {
                actionHtml = `<span class="oc-tag-deferred">${r.deficit} waiting</span>`;
            } else {
                actionHtml = `<span class="oc-tag-surplus">None needed</span>`;
            }
            const soonBadge = r.soonMembers > 0 ? ` <span class="oc-badge oc-badge-soon">+${r.soonMembers}</span>` : '';
            const costBadge = scopeProjection ? `<span class="oc-range-chip">R${r.scopeRange} · ${r.scopeCost}sp</span>` : '';
            return `<tr class="oc-row-${r.action.replace('_','-')}">
                <td><b>Lvl ${r.level}</b>${costBadge}</td>
                <td>${r.freeMembers}${soonBadge}</td>
                <td>${r.openSlots} / ${r.totalSlots} <span style="color:#374151">(${r.recruitingOCs})</span></td>
                <td>${actionHtml}</td>
            </tr>`;
        }).join('');

        return `<table class="oc-table">
            <thead><tr><th>Level</th><th>Free + Soon</th><th>Slots</th><th>Action</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    }

    const HIGH_WEIGHT_THRESHOLD = CONFIG.HIGH_WEIGHT_THRESHOLD;  // configurable via settings
    const HIGH_WEIGHT_MIN_CPR    = CONFIG.HIGH_WEIGHT_MIN_CPR;   // configurable via settings

    function _wKey(str) { return (str || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
    function getSlotWeight(weights, ocName, roleName) {
        if (!weights) return null;
        const oc   = weights[_wKey(ocName)] || {};
        const role = oc[_wKey(roleName)];
        return typeof role === 'number' ? role : null;
    }

    // Look up byPosition CPR by role NAME (not position_id which is a generic slot number)
    function lookupPosCPR(byPos, crimeName, roleName) {
        if (!roleName) return null;
        const exactKey = `${crimeName}::${roleName}`;
        if (byPos[exactKey]) return byPos[exactKey];
        // Fallback: same role name from any other crime type
        const roleKey = roleName.toLowerCase();
        for (const [k, v] of Object.entries(byPos)) {
            const parts = k.split('::');
            if (parts.length === 2 && parts[1].toLowerCase() === roleKey) return v;
        }
        return null;
    }

    function buildMemberRec(m, availableCrimes, weights) {
        if (m.inOC) {
            const readyLabel = (m.ocReadyAt && m.ocReadyAt > now()) ? fmtTs(m.ocReadyAt) : 'active (paused)';
            return { type: 'inoc', text: `In OC — free ${readyLabel}` };
        }
        const byPos    = m.byPosition || {};
        const memberCPR = m.cpr ?? 0;
        const openOCs  = normArr(availableCrimes).filter(c =>
            c.status === 'Recruiting' &&
            c.difficulty === m.joinable &&
            (c.slots || []).some(s => !s.user_id && !s.user?.id)
        );
        if (!openOCs.length) return { type: 'none', text: `No Lvl ${m.joinable} OCs open` };

        let bestCrime = null, bestPos = null, bestPosCPR = -1, bestWeight = -1;

        for (const c of openOCs) {
            for (const slot of (c.slots || []).filter(s => !s.user_id && !s.user?.id)) {
                const roleName   = slot.position || '';
                const slotWeight = getSlotWeight(weights, c.name, roleName);
                // High-weight slots need higher CPR
                const minCPR = (slotWeight !== null && slotWeight >= HIGH_WEIGHT_THRESHOLD)
                    ? HIGH_WEIGHT_MIN_CPR : CONFIG.MINCPR;
                if (memberCPR < minCPR) continue; // CPR too low for this slot

                const pd  = lookupPosCPR(byPos, c.name, slot.position);
                const posCPR = pd?.cpr || 0;
                if (posCPR > bestPosCPR) {
                    bestPosCPR = posCPR; bestPos = pd?.position || roleName;
                    bestCrime = c; bestWeight = slotWeight;
                }
            }
        }

        // Fallback: if no qualifying slot (CPR too low), show best available anyway with a warning
        if (!bestCrime) {
            const c = openOCs[0];
            const openSlot = (c.slots || []).find(s => !s.user_id && !s.user?.id);
            const pd  = lookupPosCPR(byPos, c.name, openSlot?.position);
            return { type: 'rec', crime: c.name, position: pd?.position || openSlot?.position || null,
                cpr: pd?.cpr || null, level: m.joinable, count: openOCs.length, lowCpr: true };
        }

        return { type: 'rec', crime: bestCrime.name, position: bestPos,
            cpr: bestPosCPR > 0 ? bestPosCPR : null, level: m.joinable, count: openOCs.length,
            weight: bestWeight };
    }

    function renderEligibleMembers(eligible, availableCrimes, weights) {
        cprBreakdownMap = {};
        recMap = {};
        // Sort by joinable level desc, then name
        const sorted = [...eligible].sort((a, b) => (b.joinable - a.joinable) || a.name.localeCompare(b.name));
        const rows = sorted.map(m => {
            const readyLabel = (m.ocReadyAt && m.ocReadyAt > now())
                ? `free ${fmtTs(m.ocReadyAt)}` : 'active (paused)';
            const sb = m.inOC
                ? `<span class="oc-badge oc-badge-in">In OC → ${readyLabel}</span>`
                : `<span class="oc-badge oc-badge-free">Free</span>`;
            let cc = 'oc-cpr-low';
            if (m.cpr !== null && m.cpr >= 80)                cc = 'oc-cpr-high';
            else if (m.cpr !== null && m.cpr >= CONFIG.MINCPR) cc = 'oc-cpr-mid';
            let cs;
            if (m.cpr !== null && !m.cprEstimated) {
                cprBreakdownMap[m.id] = { name: m.name, cpr: m.cpr, entries: m.cprEntries };
                cs = `<span class="oc-cpr-click ${cc}" data-uid="${m.id}">${m.cpr}%</span>`;
            } else if (m.cprEstimated) {
                cs = `<span class="oc-cpr-est" title="Estimated from level — no faction crime history yet">~${m.cpr}%</span>`;
            } else { cs = '<span class="oc-cpr-low">—</span>'; }
            // Build rec for this member
            const rec = buildMemberRec(m, availableCrimes, weights);
            recMap[m.id] = rec;
            const recBtn = rec.type === 'rec'
                ? `<span class="oc-rec-btn" data-uid="${m.id}">→ ${rec.crime.length > 14 ? rec.crime.slice(0,13) + '…' : rec.crime}</span>`
                : `<span class="oc-rec-btn" data-uid="${m.id}" style="background:rgba(55,65,81,.2);color:#6b7280;border-color:rgba(55,65,81,.3);">${rec.type === 'inoc' ? 'In OC' : 'None open'}</span>`;

            return `<tr>
                <td><span class="oc-member-name">${m.name}</span> <span class="oc-member-id">[${m.id}]</span></td>
                <td>${sb}</td><td>${cs}</td>
                <td style="color:#6b7280">${m.highestLevel > 0 ? m.highestLevel : '—'}</td>
                <td>${recBtn}</td>
            </tr>`;
        }).join('');
        return `<table class="oc-table">
            <thead><tr><th>Member</th><th>Status</th><th>CPR</th><th>Highest</th><th>Join</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    }

    function renderViewerCard(viewer, eligible, skipped, availableCrimes) {
        // Always show card if we have at least a name
        if (!viewer || (!viewer.playerId && !viewer.playerName)) return '';
        const vid   = viewer.playerId ? String(viewer.playerId) : null;
        const vname = viewer.playerName || '';

        // Find viewer — ID match (string or number) with name fallback
        const idMatch   = m => vid && (String(m.id) === vid || Number(m.id) === Number(vid));
        const nameMatch = m => vname && m.name === vname;
        const me = eligible.find(m => idMatch(m) || nameMatch(m))
                || skipped.find(m => idMatch(m) || nameMatch(m));

        const cprText  = me?.cpr != null
            ? (me.cprEstimated ? `~${me.cpr}% est.` : `${me.cpr}% CPR`)
            : 'No CPR data';
        const cprColor = me?.cprEstimated ? '#6b7280'
            : me?.cpr >= 80 ? '#74c69d' : me?.cpr >= 60 ? '#f4a261' : '#9ca3af';
        const joinable = me?.joinable || 1;

        let statusHtml;
        if (!me) {
            statusHtml = `<span style="color:#6b7280">Not found in eligible members</span>`;
        } else if (me.inOC) {
            const readyLabel = (me.ocReadyAt && me.ocReadyAt > now())
                ? `free ${fmtTs(me.ocReadyAt)}`
                : 'active (timer paused)';
            statusHtml = `<span class="oc-badge oc-badge-in">In OC → ${readyLabel}</span>`;
        } else {
            statusHtml = `<span class="oc-badge oc-badge-free">Free now</span>`;
        }

        // Find recruiting OCs with best-fit position recommendation
        const byPos = me?.byPosition || {};
        const myOcs = normArr(availableCrimes).filter(c => {
            if (c.status !== 'Recruiting') return false;
            if (c.difficulty !== joinable) return false;
            return (c.slots || []).some(s => !s.user_id && !s.user?.id);
        });

        let recsHtml;
        if (me?.inOC) {
            recsHtml = `<div class="oc-viewer-none">You\'re already in an OC.</div>`;
        } else if (myOcs.length === 0) {
            recsHtml = `<div class="oc-viewer-none">No open Lvl ${joinable} OCs recruiting right now.</div>`;
        } else {
            const chips = myOcs.map(c => {
                const openSlots = (c.slots || []).filter(s => !s.user_id && !s.user?.id);
                let bestPos = null, bestCPR = -1;
                for (const slot of openSlots) {
                    const pd  = lookupPosCPR(byPos, c.name, slot.position);
                    if (pd && pd.cpr > bestCPR) { bestCPR = pd.cpr; bestPos = pd.position; }
                }
                const posTag = bestPos
                    ? ` <span style="color:#9ca3af;font-size:9px;">as ${bestPos}${bestCPR > 0 ? ' ' + bestCPR + '%' : ''}</span>`
                    : ` <span style="color:#6b7280;font-size:9px;">${openSlots.length} slot${openSlots.length > 1 ? 's' : ''}</span>`;
                return `<span class="oc-viewer-crime">${c.name}${posTag}</span>`;
            }).join('');
            recsHtml = `<div class="oc-viewer-crimes">${chips}</div>`;
        }

        return `<div class="oc-viewer-card">
            <div class="oc-viewer-name">${viewer.playerName} • Lvl ${joinable} • <span style="color:${cprColor}">${cprText}</span></div>
            <div class="oc-viewer-meta">${statusHtml}</div>
            ${recsHtml}
        </div>`;
    }

    function renderBody(recs, eligible, skipped, scopeProjection, viewer, availableCrimes, weights) {
        const total = eligible.length + skipped.length;
        const eli   = eligible.length;
        const free  = eligible.filter(m => !m.inOC).length;
        const soon  = eligible.filter(m => m.inOC).length;

        // Banner: only show levels where action = spawn or spawn_partial
        const spawnLvls = recs.filter(r => r.action === 'spawn' || r.action === 'spawn_partial').map(r => `Lvl ${r.level}`);
        const banner = spawnLvls.length
            ? `<div class="oc-spawn-banner">Spawn needed: ${spawnLvls.map(l => `<span class="oc-lvl-chip">${l}</span>`).join('')}</div>`
            : `<div class="oc-spawn-banner oc-banner-ok">✓ No additional spawns needed.</div>`;

        const skippedHtml = skipped.length > 0
            ? `<details style="margin-top:6px;"><summary style="cursor:pointer;color:#6b7280;font-size:11px;font-family:inherit;">${skipped.length} members skipped</summary>
                <table class="oc-table" style="margin-top:4px;">
                    <thead><tr><th>Member</th><th>Reason</th></tr></thead>
                    <tbody>${skipped.map(m => `<tr><td><span class="oc-member-name">${m.name}</span> <span class="oc-member-id">[${m.id}]</span></td><td style="color:#6b7280">${m.skipReason}</td></tr>`).join('')}</tbody>
                </table></details>` : '';

        // Profile tab — viewer card only
        document.getElementById('oc-tab-profile').innerHTML =
            renderViewerCard(viewer, eligible, skipped, availableCrimes) ||
            '<p style="color:#6b7280;font-size:11px;">No personal OC data yet — refresh to load.</p>';

        // Admin tab — everything else
        document.getElementById('oc-tab-admin').innerHTML = `
            <div class="oc-stats-strip">
                <span class="oc-stat-chip"><b>${total}</b> members</span>
                <span class="oc-stat-chip"><b>${eli}</b> eligible</span>
                <span class="oc-stat-chip"><b>${free}</b> free now</span>
                <span class="oc-stat-chip"><b>${soon}</b> soon</span>
            </div>
            ${renderScopeStrip(scopeProjection)}
            ${banner}
            <h3>Spawn Recommendations — High Priority First</h3>
            ${renderRecommendations(recs, scopeProjection)}
            <h3>Eligible Members</h3>
            ${renderEligibleMembers(eligible, availableCrimes, weights)}
            ${skippedHtml}
            <p style="color:#374151;font-size:10px;margin-top:10px;">
                Active=${CONFIG.ACTIVE_DAYS}d · Forecast=${CONFIG.FORECAST_HOURS}h · MinCPR=${CONFIG.MINCPR}% · Boost=${CONFIG.CPR_BOOST}%
                &nbsp;·&nbsp; Updated: ${new Date().toLocaleTimeString()}
                &nbsp;·&nbsp; <span style="color:#253525">CPR cached 6h server-side</span>
            </p>`;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  MAIN
    // ═══════════════════════════════════════════════════════════════════════
    // Dev always gets full access regardless of role
    function isDev(viewer) {
        return viewer && String(viewer.playerId) === '137558';
    }
    // Admin tab: dev OR any role in CONFIG.ADMIN_ROLES
    function canViewAdmin(viewer) {
        if (!viewer) return false;
        if (isDev(viewer)) return true;
        const pos = (viewer.position || '').toLowerCase().replace(/[^a-z]/g, '');
        const allowed = (CONFIG.ADMIN_ROLES || 'Leader,Co-leader')
            .split(',')
            .map(r => r.trim().toLowerCase().replace(/[^a-z]/g, ''))
            .filter(Boolean);
        return allowed.includes(pos);
    }

    async function runAnalysis() {
        const apiKey = getApiKey();
        if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
            document.getElementById('oc-settings-panel').style.display = 'block';
            populateSettings();
            document.getElementById('oc-tab-profile').innerHTML = `<p class="oc-error">⚠ Enter your Torn API key in Settings above.</p>`;
            setStatus('API key not configured.');
            return;
        }

        const refreshBtn = document.getElementById('oc-spawn-refresh');
        refreshBtn.disabled = true;
        document.getElementById('oc-tab-profile').innerHTML = '';
        document.getElementById('oc-tab-admin').innerHTML   = '';

        try {
            // Fetch faction-wide settings
            setStatus('Loading settings…');
            const srvSettings = await fetchFactionSettings(apiKey);
            if (srvSettings) {
                CONFIG.ACTIVE_DAYS             = srvSettings.active_days;
                CONFIG.FORECAST_HOURS          = srvSettings.forecast_hours;
                CONFIG.MINCPR                  = srvSettings.mincpr;
                CONFIG.CPR_BOOST               = srvSettings.cpr_boost;
                CONFIG.CPR_LOOKBACK_DAYS       = srvSettings.lookback_days;
                CONFIG.HIGH_WEIGHT_THRESHOLD   = srvSettings.high_weight_pct      ?? CONFIG.HIGH_WEIGHT_THRESHOLD;
                CONFIG.HIGH_WEIGHT_MIN_CPR     = srvSettings.high_weight_mincpr   ?? CONFIG.HIGH_WEIGHT_MIN_CPR;
                CONFIG.ADMIN_ROLES             = srvSettings.admin_roles          ?? CONFIG.ADMIN_ROLES;
                CONFIG.SCOPE                   = srvSettings.scope;

                // Sync local storage with server values
                GM_setValue('cfg_active_days',         CONFIG.ACTIVE_DAYS);
                GM_setValue('cfg_forecast_hours',      CONFIG.FORECAST_HOURS);
                GM_setValue('cfg_mincpr',              CONFIG.MINCPR);
                GM_setValue('cfg_cpr_boost',           CONFIG.CPR_BOOST);
                GM_setValue('cfg_lookback_days',       CONFIG.CPR_LOOKBACK_DAYS);
                GM_setValue('cfg_high_weight_pct',     CONFIG.HIGH_WEIGHT_THRESHOLD);
                GM_setValue('cfg_high_weight_mincpr',  CONFIG.HIGH_WEIGHT_MIN_CPR);
                GM_setValue('cfg_admin_roles',         CONFIG.ADMIN_ROLES);
                GM_setValue('cfg_scope',               CONFIG.SCOPE);

                populateSettings();
            }

            // Fetch OC data from server
            setStatus('Fetching OC data…');
            let members, availableCrimes, rawCprCache, viewer, weights;
            try {
                ({ members, availableCrimes, cprCache: rawCprCache, viewer, weights } = await fetchServerOcData(apiKey));
            } catch (err) {
                if (err.status === 403) {
                    document.getElementById('oc-tab-profile').innerHTML =
                        `<p class="oc-error">⛔ ${err.message}</p>`;
                    setStatus('Access denied.');
                    return;
                }
                throw err;
            }

            // Re-apply user's MINCPR/CPR_BOOST to joinable
            const cprCache = {};
            for (const [uid, d] of Object.entries(rawCprCache || {})) {
                cprCache[uid] = {
                    ...d,
                    joinable: d.cpr >= CONFIG.MINCPR + CONFIG.CPR_BOOST
                        ? Math.min(d.highestLevel + 1, 10) : d.highestLevel,
                };
            }

            setStatus('Analysing…');
            const slotMap               = countOpenSlots(availableCrimes);
            const { eligible, skipped } = processMembers(members, availableCrimes, cprCache);
            const scopeProjection        = projectScope(CONFIG.SCOPE, eligible);
            lastScopeProjection         = scopeProjection; // cache for tooltip
            const recs                  = buildRecommendations(eligible, slotMap, scopeProjection);

            renderBody(recs, eligible, skipped, scopeProjection, viewer, availableCrimes, weights);

            // Always show tab bar with both tabs
            const tabBar   = document.getElementById('oc-tab-bar');
            const adminTab = document.getElementById('oc-admin-tab');
            tabBar.style.display   = 'flex';
            adminTab.style.display = '';

            // Lock admin tab content if viewer can't admin
            const settingsGear = document.getElementById('oc-spawn-settings');
            // Gear always visible to dev; visible to others only if they can view admin
            if (settingsGear) settingsGear.style.display = (isDev(viewer) || canViewAdmin(viewer)) ? '' : 'none';
            if (canViewAdmin(viewer)) {
                switchTab('admin');
            } else {
                // Replace admin content with locked message
                document.getElementById('oc-tab-admin').innerHTML =
                    `<p class="oc-error" style="margin-top:8px;">🔒 Admin access requires Leader or Co-leader rank.</p>
                     <p style="color:#6b7280;font-size:11px;">Rank: <b style="color:#9ca3af;">${viewer?.position || 'Unknown'}</b> &nbsp;·&nbsp; ID: <b style="color:#9ca3af;">${viewer?.playerId || '?'}</b></p>`;
                switchTab('profile');
            }

            setStatus(`Last updated: ${new Date().toLocaleTimeString()} · ${normArr(members).length} members`);

        } catch (err) {
            const hint = /504|503|502|timeout/i.test(err.message)
                ? 'Torn API timed out — try refreshing in a moment.'
                : /forbidden|faction api/i.test(err.message)
                ? ''
                : 'Something went wrong — try refreshing.';
            document.getElementById('oc-tab-profile').innerHTML =
                `<p class="oc-error">Error: ${err.message}</p>
                 <p style="color:#6b7280;font-size:11px;">${hint}</p>`;
            setStatus(`Error: ${err.message}`);
            console.error('[OC Spawn]', err);
        } finally {
            refreshBtn.disabled = false;
        }
    }

    // Start ASAP interception
    setupAjaxInterceptor();

    if (window.location.href.includes('tab=crimes') || window.location.hash.includes('crimes')) {
        panelVisible = true; panel.style.display = 'block';
        if (getApiKey()) setTimeout(runAnalysis, 500);
    }

    // Start DOM scope reader (runs whenever recruiting tab is visible)
    setupScopeDomReader();

})();

