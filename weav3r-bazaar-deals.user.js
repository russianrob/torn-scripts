// ==UserScript==
// @name         Weav3r Bazaar Deals
// @namespace    russianrob
// @version      1.0.0
// @description  Find cheapest Torn bazaar deals using weav3r.dev — dollar deals panel + item price lookup
// @author       RussianRob
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      weav3r.dev
// @connect      www.torn.com
// ==/UserScript==

(function () {
    'use strict';

    // ── Config ─────────────────────────────────────────────────────────────
    const CFG = {
        refreshMs:   5 * 60 * 1000, // auto-refresh dollar deals every 5 min
        pageSize:    50,
        maxPages:    4,              // fetch up to 200 items (4 × 50)
        comboMin:    3,
    };

    // ── Persistent storage helpers ─────────────────────────────────────────
    const store = {
        get: (k, d) => { try { const v = GM_getValue(k); return v === undefined ? d : v; } catch { return d; } },
        set: (k, v) => { try { GM_setValue(k, v); } catch {} },
    };

    // ── State ──────────────────────────────────────────────────────────────
    const S = {
        tab:            'deals',   // 'deals' | 'lookup'
        deals:          [],        // cached dollar-deal items
        dealsTs:        null,
        dealsLoading:   false,
        dealsError:     null,
        filterCat:      store.get('w3_cat', 'All'),
        collapsed:      store.get('w3_collapsed', false),
        lookupId:       null,
        lookupName:     '',
        lookupListings: [],
        lookupLoading:  false,
        lookupError:    null,
    };

    // ── Category list ──────────────────────────────────────────────────────
    const CATS = [
        'All','Alcohol','Armor','Artifact','Booster','Candy','Car',
        'Clothing','Collectible','Drug','Energy Drink','Enhancer',
        'Flower','Jewelry','Medical','Melee','Primary','Secondary',
        'Special','Supply Pack','Temporary','Tool','Virus','Other',
    ];

    // ── Styles ─────────────────────────────────────────────────────────────
    GM_addStyle(`
        #w3b-panel {
            position: fixed;
            bottom: 70px;
            right: 16px;
            width: 370px;
            max-height: 540px;
            background: #12121e;
            border: 1px solid #1e3a5f;
            border-radius: 10px;
            font-family: 'Segoe UI', Arial, sans-serif;
            font-size: 13px;
            color: #dde;
            z-index: 99999;
            display: flex;
            flex-direction: column;
            box-shadow: 0 6px 30px rgba(0,0,0,0.7);
            overflow: hidden;
            transition: max-height 0.2s ease;
        }
        #w3b-panel.collapsed { max-height: 42px; overflow: hidden; }

        /* Header */
        #w3b-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            background: #0d2845;
            flex-shrink: 0;
            user-select: none;
        }
        #w3b-head-title { font-weight: 700; font-size: 13px; color: #e05070; letter-spacing: .4px; }
        #w3b-head-ctrl  { display: flex; gap: 5px; }

        /* Tabs */
        #w3b-tabs { display: flex; background: #0f1a2e; flex-shrink: 0; }
        .w3b-tab {
            flex: 1; padding: 6px 0; text-align: center;
            cursor: pointer; font-size: 11px; font-weight: 600;
            color: #556; border-bottom: 2px solid transparent;
            transition: color .15s, border-color .15s;
        }
        .w3b-tab.active { color: #e05070; border-bottom-color: #e05070; }
        .w3b-tab:hover:not(.active) { color: #99a; }

        /* Body */
        #w3b-body {
            flex: 1; overflow-y: auto; padding: 8px;
            scrollbar-width: thin; scrollbar-color: #1e3a5f #12121e;
        }
        #w3b-body::-webkit-scrollbar { width: 5px; }
        #w3b-body::-webkit-scrollbar-thumb { background: #1e3a5f; border-radius: 3px; }

        /* Status bar */
        #w3b-status {
            font-size: 10px; color: #444; text-align: right;
            padding: 3px 8px; flex-shrink: 0; border-top: 1px solid #1a1a2e;
        }

        /* Buttons */
        .w3b-btn {
            background: #e05070; border: none; color: #fff;
            border-radius: 5px; padding: 4px 9px;
            cursor: pointer; font-size: 11px; font-weight: 700;
            transition: background .15s;
        }
        .w3b-btn:hover { background: #b8304a; }
        .w3b-btn.dim { background: #1e3a5f; }
        .w3b-btn.dim:hover { background: #2a4f7f; }

        /* Filter bar */
        .w3b-filter {
            display: flex; gap: 6px; margin-bottom: 8px; align-items: center;
        }
        .w3b-filter select, .w3b-filter input[type=number], .w3b-filter input[type=text] {
            background: #0f1a2e; border: 1px solid #1e3a5f;
            color: #dde; border-radius: 5px; padding: 4px 7px;
            font-size: 11px; flex: 1; min-width: 0;
        }

        /* Item rows */
        .w3b-row {
            background: #0f1a2e;
            border-left: 3px solid #e05070;
            border-radius: 6px;
            padding: 7px 9px;
            margin-bottom: 5px;
            display: flex;
            flex-direction: column;
            gap: 3px;
        }
        .w3b-row-name  { font-weight: 700; color: #fff; font-size: 12px; }
        .w3b-row-meta  { display: flex; justify-content: space-between; font-size: 11px; color: #8899aa; }
        .w3b-val       { color: #4ade80; font-weight: 700; }
        .w3b-price     { color: #facc15; font-weight: 700; }
        .w3b-seller    { color: #60a5fa; }
        .w3b-badge {
            background: rgba(74,222,128,.12); color: #4ade80;
            border-radius: 3px; padding: 1px 5px;
            font-size: 10px; font-weight: 700;
        }
        .w3b-links { display: flex; gap: 5px; margin-top: 2px; flex-wrap: wrap; }
        .w3b-links a {
            font-size: 10px; color: #e05070; text-decoration: none;
            background: rgba(224,80,112,.1);
            padding: 2px 7px; border-radius: 3px;
            transition: background .15s;
        }
        .w3b-links a:hover { background: rgba(224,80,112,.25); }

        /* States */
        .w3b-loading { text-align: center; color: #e05070; padding: 20px; font-size: 12px; }
        .w3b-empty   { text-align: center; color: #445; padding: 20px; font-size: 12px; }
        .w3b-error   { text-align: center; color: #f87171; padding: 12px; font-size: 11px; background: rgba(248,113,113,.07); border-radius: 5px; }
        .w3b-hint    { font-size: 10px; color: #445; margin-bottom: 6px; }
        .w3b-section-label { font-size: 10px; color: #556; margin: 8px 0 4px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; }
    `);

    // ── Format helpers ─────────────────────────────────────────────────────
    function fmtMoney(n) {
        if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
        if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
        if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
        return '$' + n.toLocaleString();
    }

    function timeAgo(iso) {
        const d = (Date.now() - new Date(iso).getTime()) / 1000;
        if (d < 60)    return Math.round(d) + 's ago';
        if (d < 3600)  return Math.round(d / 60) + 'm ago';
        if (d < 86400) return Math.round(d / 3600) + 'h ago';
        return Math.round(d / 86400) + 'd ago';
    }

    function esc(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // ── GM fetch wrappers ──────────────────────────────────────────────────
    function gmJSON(url) {
        return new Promise((res, rej) => {
            GM_xmlhttpRequest({
                method: 'GET', url,
                headers: { Accept: 'application/json' },
                onload:  r => { try { res(JSON.parse(r.responseText)); } catch { rej(new Error('Parse error')); } },
                onerror: () => rej(new Error('Network error')),
                ontimeout: () => rej(new Error('Timeout')),
            });
        });
    }

    function gmHTML(url) {
        return new Promise((res, rej) => {
            GM_xmlhttpRequest({
                method: 'GET', url,
                onload:  r => res(r.responseText),
                onerror: () => rej(new Error('Network error')),
                ontimeout: () => rej(new Error('Timeout')),
            });
        });
    }

    // ── Dollar Deals API ───────────────────────────────────────────────────
    async function loadDeals() {
        S.dealsLoading = true;
        S.dealsError = null;
        render();

        const all = [];
        try {
            for (let p = 1; p <= CFG.maxPages; p++) {
                const data = await gmJSON(
                    `https://weav3r.dev/api/dollar-bazaars/items?page=${p}&limit=${CFG.pageSize}`
                );
                if (!data.items?.length) break;
                all.push(...data.items);
                if (data.items.length < CFG.pageSize) break;
            }
            // Sort best deals first (highest market value at $1 listing price)
            S.deals = all.sort((a, b) => b.marketPrice - a.marketPrice);
            S.dealsTs = Date.now();
            store.set('w3_deals_ts', S.dealsTs);
        } catch (e) {
            S.dealsError = e.message;
        }

        S.dealsLoading = false;
        render();
    }

    // ── Item Lookup — parse weav3r item page HTML ──────────────────────────
    async function lookupItem(id) {
        S.lookupId       = id;
        S.lookupListings = [];
        S.lookupLoading  = true;
        S.lookupError    = null;
        render();

        try {
            const html = await gmHTML(`https://weav3r.dev/item/${id}`);
            const doc  = new DOMParser().parseFromString(html, 'text/html');

            // ── Strategy 1: look for embedded JSON in script tags ──────────
            const listings = [];
            for (const s of doc.querySelectorAll('script')) {
                const txt = s.textContent;

                // Next.js RSC / page props may embed data in various formats
                // Try to find seller/price patterns in JSON blobs
                const patterns = [
                    /"sellerName"\s*:\s*"([^"]+)"/g,
                ];
                if (patterns[0].test(txt)) {
                    // Extract all JSON objects that look like bazaar listings
                    try {
                        // Find array containing sellerName fields
                        const match = txt.match(/\[\s*\{[^[\]]*"sellerName"[^[\]]*\}\s*(?:,\s*\{[^[\]]*"sellerName"[^[\]]*\}\s*)*\]/);
                        if (match) {
                            const parsed = JSON.parse(match[0]);
                            listings.push(...parsed);
                        }
                    } catch {}
                }

                // Also try searching for the item name in the page title
                const titleEl = doc.querySelector('title');
                if (titleEl && !S.lookupName) {
                    // Titles like "AK-47 | TornW3B" or "AK-47 - Bazaar Prices"
                    const t = titleEl.textContent.split(/[|–\-]/)[0].trim();
                    if (t && t.length < 60) S.lookupName = t;
                }
            }

            // ── Strategy 2: parse HTML tables ─────────────────────────────
            if (listings.length === 0) {
                const tables = doc.querySelectorAll('table');
                for (const table of tables) {
                    const headers = [...table.querySelectorAll('th')].map(th => th.textContent.trim().toLowerCase());
                    // Look for a table with seller/price columns
                    const sellerIdx = headers.findIndex(h => h.includes('seller') || h.includes('player'));
                    const qtyIdx    = headers.findIndex(h => h.includes('qty') || h.includes('quantity'));
                    const priceIdx  = headers.findIndex(h => h.includes('price'));
                    const ageIdx    = headers.findIndex(h => h.includes('age') || h.includes('updated') || h.includes('checked'));

                    if (sellerIdx === -1 || priceIdx === -1) continue;

                    for (const tr of table.querySelectorAll('tbody tr')) {
                        const tds = [...tr.querySelectorAll('td')];
                        if (tds.length < 2) continue;

                        const priceRaw = tds[priceIdx]?.textContent.trim().replace(/[^0-9.]/g, '');
                        const price = parseFloat(priceRaw) || 0;

                        listings.push({
                            sellerName:  tds[sellerIdx]?.textContent.trim() || '—',
                            quantity:    qtyIdx >= 0 ? (tds[qtyIdx]?.textContent.trim() || '?') : '?',
                            price:       price,
                            lastChecked: ageIdx >= 0 ? tds[ageIdx]?.textContent.trim() : null,
                            playerId:    (() => {
                                // Try to extract player ID from any link in the seller cell
                                const a = tds[sellerIdx]?.querySelector('a');
                                const m = a?.href?.match(/(?:userId|XID|userID)=(\d+)/);
                                return m ? m[1] : null;
                            })(),
                        });
                    }
                }
            }

            // ── Strategy 3: extract structured data from definition lists / divs ──
            if (listings.length === 0) {
                // Some Next.js pages render data in div grids rather than tables
                // Look for price + seller text patterns
                const priceEls = [...doc.querySelectorAll('[class*="price"],[class*="Price"]')];
                const sellerEls = [...doc.querySelectorAll('[class*="seller"],[class*="Seller"],[class*="player"],[class*="Player"]')];

                if (priceEls.length > 0 && sellerEls.length > 0) {
                    const len = Math.min(priceEls.length, sellerEls.length);
                    for (let i = 0; i < len; i++) {
                        const priceRaw = priceEls[i].textContent.replace(/[^0-9]/g, '');
                        listings.push({
                            sellerName:  sellerEls[i].textContent.trim(),
                            quantity:    '?',
                            price:       parseInt(priceRaw) || 0,
                            lastChecked: null,
                            playerId:    null,
                        });
                    }
                }
            }

            // Sort cheapest first
            listings.sort((a, b) => a.price - b.price);
            S.lookupListings = listings;

        } catch (e) {
            S.lookupError = e.message;
        }

        S.lookupLoading = false;
        render();
    }

    // ── Detect item ID from Torn URL ───────────────────────────────────────
    function detectItemId() {
        // Item Market: #/market/view=search&itemID=26
        const hashMatch = location.hash.match(/itemID=(\d+)/i);
        if (hashMatch) return hashMatch[1];
        // Bazaar page with item param
        const urlMatch = location.search.match(/[?&]itemID=(\d+)/i);
        if (urlMatch) return urlMatch[1];
        return null;
    }

    // ── DOM refs ──────────────────────────────────────────────────────────
    let panel, body, statusBar;

    // ── Render ─────────────────────────────────────────────────────────────
    function render() {
        if (!panel) return;
        panel.classList.toggle('collapsed', S.collapsed);
        body.innerHTML = S.tab === 'deals' ? renderDeals() : renderLookup();
        attachListeners();
        renderStatus();
    }

    function renderDeals() {
        const filtered = S.filterCat === 'All'
            ? S.deals
            : S.deals.filter(i => i.itemType === S.filterCat);

        let out = `
            <div class="w3b-filter">
                <select id="w3b-cat">
                    ${CATS.map(c => `<option${S.filterCat === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}
                </select>
                <button class="w3b-btn dim" id="w3b-refresh" title="Refresh">↻</button>
            </div>`;

        if (S.dealsLoading) {
            out += `<div class="w3b-loading">⏳ Loading deals from weav3r.dev…</div>`;
        } else if (S.dealsError) {
            out += `<div class="w3b-error">⚠ ${esc(S.dealsError)}</div>`;
        } else if (filtered.length === 0) {
            out += `<div class="w3b-empty">No items in this category.<br>Try "All" or hit ↻ to refresh.</div>`;
        } else {
            out += filtered.map(it => `
                <div class="w3b-row">
                    <div class="w3b-row-name">${esc(it.itemName)} <span class="w3b-badge">${esc(it.itemType)}</span></div>
                    <div class="w3b-row-meta">
                        <span>Listed <strong style="color:#fff">$1</strong> · Mkt: <span class="w3b-val">${fmtMoney(it.marketPrice)}</span></span>
                        <span>Qty: ${it.quantity}</span>
                    </div>
                    <div class="w3b-row-meta">
                        <span class="w3b-seller">🧍 ${esc(it.sellerName)} [${it.playerId}]</span>
                        <span>${timeAgo(it.lastUpdated)}</span>
                    </div>
                    <div class="w3b-links">
                        <a href="https://www.torn.com/bazaar.php?userId=${it.playerId}#/p=bazaar/cat=All" target="_blank">Open Bazaar</a>
                        <a href="https://www.torn.com/trade.php#step=start&userID=${it.playerId}" target="_blank">Trade</a>
                        <a href="https://weav3r.dev/item/${it.itemId}" target="_blank">Weav3r</a>
                        <a href="https://www.torn.com/profiles.php?XID=${it.playerId}" target="_blank">Profile</a>
                    </div>
                </div>`).join('');
        }
        return out;
    }

    function renderLookup() {
        const detected = detectItemId();
        let out = `
            <div class="w3b-filter">
                <input type="number" id="w3b-iid" placeholder="Item ID  (e.g. 26 = AK-47)"
                    value="${esc(S.lookupId || detected || '')}">
                <button class="w3b-btn" id="w3b-search">Search</button>
            </div>`;

        if (detected && !S.lookupId) {
            out += `<div class="w3b-hint">📍 Detected Item ID <strong>${detected}</strong> from page URL — hit Search to look up.</div>`;
        }

        if (S.lookupLoading) {
            out += `<div class="w3b-loading">⏳ Fetching from weav3r.dev…</div>`;
        } else if (S.lookupError) {
            out += `<div class="w3b-error">⚠ ${esc(S.lookupError)}</div>`;
            if (S.lookupId) {
                out += `<div class="w3b-hint" style="text-align:center;margin-top:8px;">
                    <a href="https://weav3r.dev/item/${S.lookupId}" target="_blank" style="color:#e05070;">
                        View on weav3r.dev →
                    </a></div>`;
            }
        } else if (S.lookupListings.length > 0) {
            const name = S.lookupName || `Item #${S.lookupId}`;
            out += `<div class="w3b-section-label">Cheapest bazaar listings — ${esc(name)}</div>`;
            out += S.lookupListings.slice(0, 20).map(l => `
                <div class="w3b-row" style="border-left-color:#60a5fa">
                    <div class="w3b-row-meta">
                        <span class="w3b-seller">🧍 ${esc(l.sellerName)}</span>
                        <span class="w3b-price">${l.price ? fmtMoney(l.price) : '—'}</span>
                    </div>
                    <div class="w3b-row-meta">
                        <span>Qty: ${esc(String(l.quantity))}</span>
                        <span>${l.lastChecked ? esc(l.lastChecked) : ''}</span>
                    </div>
                    ${l.playerId ? `<div class="w3b-links">
                        <a href="https://www.torn.com/bazaar.php?userId=${l.playerId}#/p=bazaar/cat=All" target="_blank">Open Bazaar</a>
                        <a href="https://www.torn.com/trade.php#step=start&userID=${l.playerId}" target="_blank">Trade</a>
                    </div>` : ''}
                </div>`).join('');
            out += `<div class="w3b-hint" style="text-align:center;margin-top:6px;">
                <a href="https://weav3r.dev/item/${S.lookupId}" target="_blank" style="color:#e05070;">
                    View full data on weav3r.dev →
                </a></div>`;
        } else if (S.lookupId && !S.lookupLoading) {
            out += `<div class="w3b-empty">
                No bazaar data found in page HTML.<br>
                <a href="https://weav3r.dev/item/${S.lookupId}" target="_blank" style="color:#e05070;">
                    View on weav3r.dev →
                </a>
            </div>`;
        }

        return out;
    }

    function renderStatus() {
        if (!statusBar) return;
        if (S.tab === 'deals') {
            const filtered = S.filterCat === 'All' ? S.deals : S.deals.filter(i => i.itemType === S.filterCat);
            const ts = S.dealsTs ? timeAgo(new Date(S.dealsTs).toISOString()) : '—';
            statusBar.textContent = `${filtered.length} deals · ${ts} · weav3r.dev`;
        } else {
            statusBar.textContent = S.lookupId
                ? `weav3r.dev/item/${S.lookupId}`
                : 'Enter an Item ID to check bazaar prices';
        }
    }

    // ── Event listeners ────────────────────────────────────────────────────
    function attachListeners() {
        // Deals tab
        const catSel = body.querySelector('#w3b-cat');
        if (catSel) catSel.addEventListener('change', () => {
            S.filterCat = catSel.value;
            store.set('w3_cat', S.filterCat);
            render();
        });

        const refreshBtn = body.querySelector('#w3b-refresh');
        if (refreshBtn) refreshBtn.addEventListener('click', loadDeals);

        // Lookup tab
        const iidInput = body.querySelector('#w3b-iid');
        const searchBtn = body.querySelector('#w3b-search');
        if (searchBtn && iidInput) {
            const doSearch = () => {
                const id = iidInput.value.trim();
                if (id) lookupItem(id);
            };
            searchBtn.addEventListener('click', doSearch);
            iidInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
        }
    }

    // ── Build panel DOM ────────────────────────────────────────────────────
    function buildPanel() {
        panel = document.createElement('div');
        panel.id = 'w3b-panel';
        panel.classList.toggle('collapsed', S.collapsed);

        // ── Header ─────────────────────────────────────────────────────────
        const head = document.createElement('div');
        head.id = 'w3b-head';
        head.innerHTML = `
            <span id="w3b-head-title">🔍 Weav3r Deals</span>
            <div id="w3b-head-ctrl">
                <button class="w3b-btn dim" id="w3b-collapse" style="padding:2px 7px" title="${S.collapsed ? 'Expand' : 'Collapse'}">
                    ${S.collapsed ? '▲' : '▼'}
                </button>
            </div>`;
        head.querySelector('#w3b-collapse').addEventListener('click', () => {
            S.collapsed = !S.collapsed;
            store.set('w3_collapsed', S.collapsed);
            panel.classList.toggle('collapsed', S.collapsed);
            head.querySelector('#w3b-collapse').textContent = S.collapsed ? '▲' : '▼';
        });
        panel.appendChild(head);

        // ── Tabs ──────────────────────────────────────────────────────────
        const tabs = document.createElement('div');
        tabs.id = 'w3b-tabs';
        tabs.innerHTML = `
            <div class="w3b-tab${S.tab === 'deals'  ? ' active' : ''}" data-tab="deals">💰 Dollar Deals</div>
            <div class="w3b-tab${S.tab === 'lookup' ? ' active' : ''}" data-tab="lookup">🔎 Item Lookup</div>`;
        tabs.addEventListener('click', e => {
            const t = e.target.closest('.w3b-tab');
            if (!t) return;
            S.tab = t.dataset.tab;
            tabs.querySelectorAll('.w3b-tab').forEach(el =>
                el.classList.toggle('active', el.dataset.tab === S.tab));
            render();
        });
        panel.appendChild(tabs);

        // ── Body ──────────────────────────────────────────────────────────
        body = document.createElement('div');
        body.id = 'w3b-body';
        panel.appendChild(body);

        // ── Status bar ────────────────────────────────────────────────────
        statusBar = document.createElement('div');
        statusBar.id = 'w3b-status';
        panel.appendChild(statusBar);

        document.body.appendChild(panel);
    }

    // ── Hash / URL change watcher (Item Market auto-detect) ────────────────
    let lastHash = '';
    function watchHash() {
        if (location.hash !== lastHash) {
            lastHash = location.hash;
            const id = detectItemId();
            if (id && S.tab === 'lookup' && id !== S.lookupId) {
                lookupItem(id);
            }
        }
    }

    // ── Init ──────────────────────────────────────────────────────────────
    function init() {
        buildPanel();
        render();
        loadDeals();

        // Auto-refresh deals
        setInterval(() => { if (!S.dealsLoading) loadDeals(); }, CFG.refreshMs);

        // Watch for hash changes (item market navigation)
        setInterval(watchHash, 600);
        lastHash = location.hash;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
