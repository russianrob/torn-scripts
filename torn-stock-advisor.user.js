// ==UserScript==
// @name         Torn Stock Advisor
// @namespace    torn.stock.advisor
// @version      3.0.1
// @description  Real buy/sell signals + portfolio tracker for Torn stocks (Tornsy + Torn API)
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      tornsy.com
// @connect      api.torn.com
// ==/UserScript==

(function () {
    'use strict';

    // ─── Config ───────────────────────────────────────────────────────────────
    const API_BASE      = 'https://api.torn.com';
    const TORNSY_URL    = 'https://tornsy.com/api/stocks?interval=d1,d3,d7,d14,n1';
    const STORE_KEY     = 'tsa_api_key';
    const POS_KEY       = 'tsa_panel_pos';
    const PORTFOLIO_KEY = 'tsa_portfolio';
    const PDA_HOLDER    = '###PDA-APIKEY###';
    const accent        = '#8abeef';
    const DEFAULT_KEY   = 'fprEvXyKhBRF5Vd3';

    // ─── API Key ──────────────────────────────────────────────────────────────
    function getApiKey() {
        if (PDA_HOLDER !== '###PDA-APIKEY###') return PDA_HOLDER;
        if (window.PDAKey && typeof window.PDAKey === 'string' && window.PDAKey.length > 5)
            return window.PDAKey;
        return GM_getValue(STORE_KEY, DEFAULT_KEY);
    }

    // ─── Page Detection ───────────────────────────────────────────────────────
    function onStocksPage() {
        return window.location.hash.toLowerCase().includes('stocks') ||
               window.location.href.toLowerCase().includes('stocks');
    }

    // ─── Portfolio Storage ────────────────────────────────────────────────────
    function loadPortfolio() {
        try { return JSON.parse(GM_getValue(PORTFOLIO_KEY, '{}')); }
        catch (e) { return {}; }
    }
    function savePortfolio(p) {
        GM_setValue(PORTFOLIO_KEY, JSON.stringify(p));
    }

    // ─── Signal Engine ────────────────────────────────────────────────────────
    function calcSignal(current, d1, d3, d7) {
        const pct7 = d7 ? ((current - d7) / d7) * 100 : null;
        const pct1 = d1 ? ((current - d1) / d1) * 100 : null;
        const pct3 = d3 ? ((current - d3) / d3) * 100 : null;

        let label, color;
        if (pct7 === null)  { label = '—';             color = '#888'; }
        else if (pct7 <= -8)  { label = '🔥 Strong Buy'; color = '#00e676'; }
        else if (pct7 <= -4)  { label = '✅ Buy';         color = '#7dde7d'; }
        else if (pct7 <= -1.5){ label = '🟡 Slight Buy';  color = '#ffe066'; }
        else if (pct7 >=  8)  { label = '🔴 Overbought';  color = '#ff5252'; }
        else if (pct7 >=  4)  { label = '⚠️ High';        color = '#ff9800'; }
        else                  { label = '⏸ Neutral';      color = '#999';    }

        let trend = '—';
        if (pct1 !== null) {
            if      (pct1 >=  1)   trend = '↑ recovering';
            else if (pct1 >=  0.3) trend = '↗ rising';
            else if (pct1 <= -1)   trend = '↓ falling';
            else if (pct1 <= -0.3) trend = '↘ slipping';
            else                   trend = '→ flat';
        }

        return { label, color, pct7: pct7 ?? 0, pct1: pct1 ?? 0, pct3: pct3 ?? 0, trend };
    }

    // ─── Sell Recommendation ──────────────────────────────────────────────────
    function getSellRec(current, entry) {
        const { buyPrice, targetPct, stopLoss, sig } = entry;
        const pnl = ((current - buyPrice) / buyPrice) * 100;

        if (pnl <= -stopLoss)
            return { label: '🛑 Stop Loss!',      color: '#ff5252', urgent: true  };
        if (pnl >= targetPct)
            return { label: '💰 Sell — Target!',   color: '#00e676', urgent: true  };
        if ((sig.pct7 >= 7 || sig.label.includes('Overbought')) && pnl > 0)
            return { label: '⚠️ Consider Sell',    color: '#ff9800', urgent: false };
        if (pnl > 2)
            return { label: '📈 Hold — In Profit', color: '#7dde7d', urgent: false };
        if (pnl >= 0)
            return { label: '⏳ Hold — Even',       color: '#aaa',    urgent: false };
        return     { label: '🔻 Hold — Wait',       color: '#ff8a80', urgent: false };
    }

    // ─── API Calls ────────────────────────────────────────────────────────────
    function fetchTornsy() {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET', url: TORNSY_URL,
                onload: res => {
                    try { resolve(JSON.parse(res.responseText).data || []); }
                    catch (e) { reject('Tornsy parse error'); }
                },
                onerror: () => reject('Tornsy network error')
            });
        });
    }

    function fetchBenefits(key) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `${API_BASE}/torn/?selections=stocks&key=${key}`,
                onload: res => {
                    try {
                        const d = JSON.parse(res.responseText);
                        if (d.error) reject(d.error.error || 'API error');
                        else resolve(d.stocks || {});
                    } catch (e) { reject('Torn parse error'); }
                },
                onerror: () => reject('Torn network error')
            });
        });
    }

    // ─── Styles ───────────────────────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById('tsa-styles')) return;
        const s = document.createElement('style');
        s.id = 'tsa-styles';
        s.textContent = `
        #tsa-panel {
            position: fixed; top: 80px; right: 20px;
            width: 660px; max-height: 74vh;
            background: #1a1a2e; border: 1px solid ${accent};
            border-radius: 6px; font-family: Arial, sans-serif;
            font-size: 12px; color: #ccc; z-index: 99999;
            display: flex; flex-direction: column;
            box-shadow: 0 6px 24px rgba(0,0,0,0.7); overflow: hidden;
        }
        #tsa-header {
            background: #16213e; border-bottom: 1px solid ${accent};
            padding: 7px 10px; cursor: move;
            display: flex; justify-content: space-between; align-items: center;
            user-select: none; flex-shrink: 0;
        }
        .tsa-title { color: ${accent}; font-weight: bold; font-size: 13px; }
        .tsa-btn {
            background: none; border: 1px solid #444; color: #aaa;
            border-radius: 3px; padding: 2px 7px; cursor: pointer;
            font-size: 11px; margin-left: 4px; line-height: 1.4;
        }
        .tsa-btn:hover { border-color: ${accent}; color: ${accent}; }
        #tsa-filter-bar {
            padding: 5px 8px; background: #12192b;
            border-bottom: 1px solid #2a2a3a;
            display: flex; gap: 5px; flex-wrap: wrap; flex-shrink: 0;
        }
        .tsa-filter-btn {
            background: #1e2a3a; border: 1px solid #333; color: #aaa;
            border-radius: 3px; padding: 2px 8px; cursor: pointer; font-size: 11px;
        }
        .tsa-filter-btn.active { border-color: ${accent}; color: ${accent}; background: #1a2740; }
        .tsa-filter-btn.portfolio-active { border-color: #ffd700; color: #ffd700; background: #2a2210; }
        #tsa-body { overflow-y: auto; flex: 1; padding: 6px; }
        #tsa-table { width: 100%; border-collapse: collapse; }
        #tsa-table th {
            color: ${accent}; border-bottom: 1px solid #2a2a3a;
            padding: 5px 5px; text-align: left; font-size: 11px;
            cursor: pointer; white-space: nowrap;
            position: sticky; top: 0; background: #1a1a2e;
        }
        #tsa-table th:hover { color: #fff; }
        #tsa-table td { padding: 4px 5px; border-bottom: 1px solid #1e1e2e; white-space: nowrap; }
        #tsa-table tr:hover td { background: #1f2a3a; }
        .tsa-ticker { color: ${accent}; font-weight: bold; }
        .tsa-track-btn {
            background: none; border: 1px solid #333; color: #666;
            border-radius: 3px; padding: 1px 5px; cursor: pointer; font-size: 10px;
        }
        .tsa-track-btn:hover { border-color: #ffd700; color: #ffd700; }
        .tsa-tracked { color: #ffd700 !important; }
        .tsa-remove-btn {
            background: none; border: 1px solid #444; color: #888;
            border-radius: 3px; padding: 1px 5px; cursor: pointer; font-size: 10px;
        }
        .tsa-remove-btn:hover { border-color: #ff5252; color: #ff5252; }
        .tsa-urgent td { background: #1f1010 !important; }
        .tsa-loading { text-align: center; padding: 20px; color: #888; }
        /* Modal */
        #tsa-modal-overlay {
            display: none; position: fixed; inset: 0;
            background: rgba(0,0,0,0.65); z-index: 100000;
            justify-content: center; align-items: center;
        }
        #tsa-modal-overlay.open { display: flex; }
        #tsa-modal {
            background: #16213e; border: 1px solid ${accent};
            border-radius: 8px; padding: 18px 20px; width: 300px;
            font-family: Arial, sans-serif; font-size: 13px; color: #ccc;
        }
        #tsa-modal h3 { margin: 0 0 14px; color: ${accent}; font-size: 14px; }
        .tsa-field { margin-bottom: 10px; }
        .tsa-field label { display: block; font-size: 11px; color: #888; margin-bottom: 3px; }
        .tsa-field input {
            width: 100%; background: #0f1e33; border: 1px solid #444;
            color: #fff; padding: 5px 8px; border-radius: 3px;
            box-sizing: border-box; font-size: 12px;
        }
        .tsa-field input:focus { border-color: ${accent}; outline: none; }
        .tsa-modal-actions { display: flex; gap: 8px; margin-top: 14px; }
        .tsa-modal-save {
            flex: 1; background: ${accent}; color: #000;
            border: none; padding: 7px; border-radius: 3px;
            cursor: pointer; font-weight: bold; font-size: 12px;
        }
        .tsa-modal-cancel {
            background: none; border: 1px solid #444; color: #aaa;
            padding: 7px 12px; border-radius: 3px; cursor: pointer; font-size: 12px;
        }
        /* Settings panel */
        #tsa-settings-panel {
            display: none; padding: 10px 12px; background: #12192b;
            border-top: 1px solid #2a2a3a; flex-shrink: 0;
        }
        #tsa-settings-panel label { display: block; color: ${accent}; font-size: 11px; margin-bottom: 4px; }
        #tsa-key-input {
            width: 100%; background: #0f1e33; border: 1px solid ${accent};
            color: #fff; padding: 5px 8px; border-radius: 3px;
            box-sizing: border-box; margin-bottom: 6px; font-size: 12px;
        }
        #tsa-save-key {
            background: ${accent}; color: #000; border: none;
            padding: 5px 14px; border-radius: 3px; cursor: pointer;
            font-weight: bold; font-size: 12px;
        }
        #tsa-footer {
            font-size: 10px; color: #555; padding: 4px 8px;
            border-top: 1px solid #1e1e2e; background: #12192b;
            flex-shrink: 0; display: flex; justify-content: space-between;
        }
        @media (max-width: 680px) {
            #tsa-panel { width: 99vw; right: 0.5vw; top: 60px; max-height: 80vh; }
        }
        `;
        document.head.appendChild(s);
    }

    // ─── State ────────────────────────────────────────────────────────────────
    let mergedData = null;
    let sortCol    = 'pct7';
    let sortAsc    = true;
    let filterMode = 'all'; // all | buy | sell | neutral | portfolio

    // ─── Panel HTML ───────────────────────────────────────────────────────────
    function createPanel() {
        if (document.getElementById('tsa-panel')) return;

        // Modal overlay (appended to body, outside panel)
        if (!document.getElementById('tsa-modal-overlay')) {
            const overlay = document.createElement('div');
            overlay.id = 'tsa-modal-overlay';
            overlay.innerHTML = `
                <div id="tsa-modal">
                    <h3 id="tsa-modal-title">Track Buy</h3>
                    <div class="tsa-field">
                        <label>Buy Price ($)</label>
                        <input type="number" id="tsa-modal-price" step="0.01" min="0" placeholder="e.g. 340.50" />
                    </div>
                    <div class="tsa-field">
                        <label>Profit Target (%)</label>
                        <input type="number" id="tsa-modal-target" step="1" min="1" value="10" />
                    </div>
                    <div class="tsa-field">
                        <label>Stop Loss (%)</label>
                        <input type="number" id="tsa-modal-stop" step="1" min="1" value="5" />
                    </div>
                    <div class="tsa-modal-actions">
                        <button class="tsa-modal-save" id="tsa-modal-save">Save</button>
                        <button class="tsa-modal-cancel" id="tsa-modal-cancel">Cancel</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            document.getElementById('tsa-modal-cancel').onclick = closeModal;
            overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
        }

        const panel = document.createElement('div');
        panel.id = 'tsa-panel';

        try {
            const pos = JSON.parse(GM_getValue(POS_KEY, 'null'));
            if (pos) { panel.style.top = pos.top; panel.style.left = pos.left; panel.style.right = 'auto'; }
        } catch (e) {}

        panel.innerHTML = `
            <div id="tsa-header">
                <span class="tsa-title">📈 Torn Stock Advisor</span>
                <div>
                    <button class="tsa-btn" id="tsa-refresh">↻</button>
                    <button class="tsa-btn" id="tsa-settings-toggle">⚙</button>
                    <button class="tsa-btn" id="tsa-close">✕</button>
                </div>
            </div>
            <div id="tsa-filter-bar">
                <button class="tsa-filter-btn active" data-filter="all">All</button>
                <button class="tsa-filter-btn" data-filter="buy">Buys Only</button>
                <button class="tsa-filter-btn" data-filter="sell">High/Sell</button>
                <button class="tsa-filter-btn" data-filter="neutral">Neutral</button>
                <button class="tsa-filter-btn" data-filter="portfolio">💼 Portfolio</button>
            </div>
            <div id="tsa-body">
                <div class="tsa-loading">Loading stock data...</div>
            </div>
            <div id="tsa-settings-panel">
                <label>Torn API Key (for benefit thresholds)</label>
                <input type="password" id="tsa-key-input" placeholder="Paste your Torn API key..." />
                <button id="tsa-save-key">Save Key</button>
            </div>
            <div id="tsa-footer">
                <span id="tsa-last-update">—</span>
                <span id="tsa-stock-count">—</span>
            </div>
        `;

        document.body.appendChild(panel);
        makeDraggable(panel, document.getElementById('tsa-header'));

        document.getElementById('tsa-close').onclick           = () => panel.remove();
        document.getElementById('tsa-refresh').onclick         = loadAndRender;
        document.getElementById('tsa-settings-toggle').onclick = () => {
            const sp = document.getElementById('tsa-settings-panel');
            sp.style.display = sp.style.display === 'block' ? 'none' : 'block';
        };
        document.getElementById('tsa-save-key').onclick = () => {
            const k = document.getElementById('tsa-key-input').value.trim();
            if (k) { GM_setValue(STORE_KEY, k); document.getElementById('tsa-settings-panel').style.display = 'none'; loadAndRender(); }
        };
        document.querySelectorAll('.tsa-filter-btn').forEach(btn => {
            btn.onclick = () => {
                filterMode = btn.dataset.filter;
                document.querySelectorAll('.tsa-filter-btn').forEach(b => {
                    b.classList.remove('active', 'portfolio-active');
                });
                btn.classList.add(filterMode === 'portfolio' ? 'portfolio-active' : 'active');
                if (mergedData) renderTable(mergedData);
            };
        });

        loadAndRender();
    }

    // ─── Modal ────────────────────────────────────────────────────────────────
    let modalTicker = null;

    function openModal(ticker, currentPrice) {
        modalTicker = ticker;
        const portfolio = loadPortfolio();
        const existing  = portfolio[ticker];
        document.getElementById('tsa-modal-title').textContent = `Track: ${ticker}`;
        document.getElementById('tsa-modal-price').value  = existing ? existing.buyPrice  : currentPrice.toFixed(2);
        document.getElementById('tsa-modal-target').value = existing ? existing.targetPct : 10;
        document.getElementById('tsa-modal-stop').value   = existing ? existing.stopLoss  : 5;
        document.getElementById('tsa-modal-overlay').classList.add('open');
        document.getElementById('tsa-modal-price').focus();
        document.getElementById('tsa-modal-save').onclick = saveModalEntry;
    }

    function closeModal() {
        document.getElementById('tsa-modal-overlay').classList.remove('open');
        modalTicker = null;
    }

    function saveModalEntry() {
        if (!modalTicker) return;
        const buyPrice  = parseFloat(document.getElementById('tsa-modal-price').value);
        const targetPct = parseFloat(document.getElementById('tsa-modal-target').value);
        const stopLoss  = parseFloat(document.getElementById('tsa-modal-stop').value);
        if (!buyPrice || buyPrice <= 0) return;

        const portfolio = loadPortfolio();

        // Find current sig from mergedData
        const stock = mergedData ? mergedData.find(r => r.ticker === modalTicker) : null;

        portfolio[modalTicker] = {
            buyPrice,
            targetPct: targetPct || 10,
            stopLoss:  stopLoss  || 5,
            buyDate:   new Date().toISOString().split('T')[0],
            sig:       stock ? stock.sig : null,
        };
        savePortfolio(portfolio);
        closeModal();
        if (mergedData) renderTable(mergedData);
    }

    function removeFromPortfolio(ticker) {
        const portfolio = loadPortfolio();
        delete portfolio[ticker];
        savePortfolio(portfolio);
        if (mergedData) renderTable(mergedData);
    }

    // ─── Drag ─────────────────────────────────────────────────────────────────
    function makeDraggable(el, handle) {
        let startX, startY, startLeft, startTop;
        const ds = (cx, cy) => { startX = cx; startY = cy; startLeft = el.offsetLeft; startTop = el.offsetTop; };
        const dm = (cx, cy) => { el.style.left = Math.max(0, startLeft + cx - startX) + 'px'; el.style.top = Math.max(0, startTop + cy - startY) + 'px'; el.style.right = 'auto'; };
        const de = () => GM_setValue(POS_KEY, JSON.stringify({ top: el.style.top, left: el.style.left }));
        handle.addEventListener('mousedown', e => {
            e.preventDefault(); ds(e.clientX, e.clientY);
            const mm = e2 => dm(e2.clientX, e2.clientY);
            const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); de(); };
            document.addEventListener('mousemove', mm);
            document.addEventListener('mouseup', mu);
        });
        handle.addEventListener('touchstart', e => { const t = e.touches[0]; ds(t.clientX, t.clientY); }, { passive: true });
        handle.addEventListener('touchmove',  e => { const t = e.touches[0]; dm(t.clientX, t.clientY); }, { passive: true });
        handle.addEventListener('touchend', de, { passive: true });
    }

    // ─── Load & Merge ─────────────────────────────────────────────────────────
    async function loadAndRender() {
        const body = document.getElementById('tsa-body');
        if (!body) return;
        body.innerHTML = '<div class="tsa-loading">Fetching from Tornsy...</div>';

        try {
            const tornsyData = await fetchTornsy();

            let benefitsMap = {};
            try {
                const key = getApiKey();
                if (key) {
                    const raw = await fetchBenefits(key);
                    Object.values(raw).forEach(s => {
                        if (s.acronym && s.benefit) benefitsMap[s.acronym] = s.benefit;
                    });
                }
            } catch (e) { /* benefits optional */ }

            const merged = tornsyData.map(s => {
                const current = parseFloat(s.price);
                const d1  = s.interval?.d1  ? parseFloat(s.interval.d1.price)  : null;
                const d3  = s.interval?.d3  ? parseFloat(s.interval.d3.price)  : null;
                const d7  = s.interval?.d7  ? parseFloat(s.interval.d7.price)  : null;
                const d14 = s.interval?.d14 ? parseFloat(s.interval.d14.price) : null;
                const d30 = s.interval?.n1  ? parseFloat(s.interval.n1.price)  : null;

                const sig   = calcSignal(current, d1, d3, d7);
                const pct14 = d14 ? ((current - d14) / d14) * 100 : null;
                const pct30 = d30 ? ((current - d30) / d30) * 100 : null;

                const benefit    = benefitsMap[s.stock];
                const benefitStr = benefit
                    ? (benefit.requirement >= 1e6
                        ? (benefit.requirement / 1e6).toFixed(1) + 'M'
                        : (benefit.requirement / 1e3).toFixed(0) + 'K')
                    : '—';

                return { ticker: s.stock, name: s.name, price: current, d1, d3, d7, d14, d30, sig, pct14, pct30, benefitStr };
            });

            // Sync sig into portfolio entries so getSellRec has fresh data
            const portfolio = loadPortfolio();
            merged.forEach(r => {
                if (portfolio[r.ticker]) portfolio[r.ticker].sig = r.sig;
            });
            savePortfolio(portfolio);

            mergedData = merged;
            renderTable(merged);

            const upd = document.getElementById('tsa-last-update');
            if (upd) upd.textContent = 'Tornsy · ' + new Date().toLocaleTimeString();

        } catch (err) {
            body.innerHTML = `<div class="tsa-loading" style="color:#ff5252">Error: ${err}</div>`;
        }
    }

    // ─── Render ───────────────────────────────────────────────────────────────
    function renderTable(data) {
        if (filterMode === 'portfolio') { renderPortfolio(data); return; }

        const body = document.getElementById('tsa-body');
        if (!body) return;

        const portfolio = loadPortfolio();
        const fmt  = v => (v > 0 ? '+' : '') + v.toFixed(2) + '%';
        const clr  = v => v < -1.5 ? '#7dde7d' : v > 4 ? '#ff5252' : '#aaa';

        const filtered = data.filter(r => {
            if (filterMode === 'buy')     return r.sig.pct7 <= -1.5;
            if (filterMode === 'sell')    return r.sig.pct7 >=  4;
            if (filterMode === 'neutral') return r.sig.pct7 > -1.5 && r.sig.pct7 < 4;
            return true;
        });

        const arrow = col => sortCol === col ? (sortAsc ? ' ▲' : ' ▼') : '';

        filtered.sort((a, b) => {
            let va, vb;
            switch (sortCol) {
                case 'ticker': return sortAsc ? a.ticker.localeCompare(b.ticker) : b.ticker.localeCompare(a.ticker);
                case 'price':  va = a.price;       vb = b.price;       break;
                case 'pct1':   va = a.sig.pct1;    vb = b.sig.pct1;    break;
                case 'pct7':   va = a.sig.pct7;    vb = b.sig.pct7;    break;
                case 'pct14':  va = a.pct14 ?? 0;  vb = b.pct14 ?? 0;  break;
                case 'pct30':  va = a.pct30 ?? 0;  vb = b.pct30 ?? 0;  break;
                default:       va = a.sig.pct7;    vb = b.sig.pct7;
            }
            return sortAsc ? va - vb : vb - va;
        });

        let html = `
            <table id="tsa-table"><thead><tr>
                <th data-col="ticker">Ticker${arrow('ticker')}</th>
                <th data-col="price">Price${arrow('price')}</th>
                <th data-col="pct1">1d${arrow('pct1')}</th>
                <th data-col="pct7">7d${arrow('pct7')}</th>
                <th data-col="pct14">14d${arrow('pct14')}</th>
                <th data-col="pct30">30d${arrow('pct30')}</th>
                <th>Signal</th>
                <th>Trend</th>
                <th>Benefit</th>
                <th>Track</th>
            </tr></thead><tbody>`;

        filtered.forEach(r => {
            const pct1Clr  = r.sig.pct1 > 0.3 ? '#7dde7d' : r.sig.pct1 < -0.3 ? '#ff5252' : '#aaa';
            const trendClr = r.sig.trend.startsWith('↑') || r.sig.trend.startsWith('↗') ? '#7dde7d'
                           : r.sig.trend.startsWith('↓') || r.sig.trend.startsWith('↘') ? '#ff8a80' : '#888';
            const isTracked = !!portfolio[r.ticker];
            const trackLabel = isTracked ? '📌' : '+';
            const trackClass = isTracked ? 'tsa-track-btn tsa-tracked' : 'tsa-track-btn';

            html += `<tr>
                <td class="tsa-ticker" title="${r.name}">${r.ticker}</td>
                <td>$${r.price.toFixed(2)}</td>
                <td style="color:${pct1Clr}">${r.d1  ? fmt(r.sig.pct1)  : '—'}</td>
                <td style="color:${clr(r.sig.pct7)};font-weight:bold">${r.d7  ? fmt(r.sig.pct7)  : '—'}</td>
                <td style="color:${clr(r.pct14 ?? 0)}">${r.d14 ? fmt(r.pct14) : '—'}</td>
                <td style="color:${clr(r.pct30 ?? 0)}">${r.d30 ? fmt(r.pct30) : '—'}</td>
                <td style="color:${r.sig.color};font-size:11px">${r.sig.label}</td>
                <td style="color:${trendClr};font-size:11px">${r.sig.trend}</td>
                <td style="color:#666">${r.benefitStr}</td>
                <td><button class="${trackClass}" data-ticker="${r.ticker}" data-price="${r.price}">${trackLabel}</button></td>
            </tr>`;
        });

        html += '</tbody></table>';
        body.innerHTML = html;

        const cnt = document.getElementById('tsa-stock-count');
        if (cnt) cnt.textContent = `${filtered.length} stocks`;

        // Track buttons
        body.querySelectorAll('.tsa-track-btn').forEach(btn => {
            btn.addEventListener('click', () => openModal(btn.dataset.ticker, parseFloat(btn.dataset.price)));
        });

        // Sort headers
        body.querySelectorAll('#tsa-table th[data-col]').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.col;
                if (sortCol === col) sortAsc = !sortAsc;
                else { sortCol = col; sortAsc = true; }
                renderTable(mergedData);
            });
        });
    }

    // ─── Portfolio View ───────────────────────────────────────────────────────
    function renderPortfolio(data) {
        const body = document.getElementById('tsa-body');
        if (!body) return;

        const portfolio = loadPortfolio();
        const tickers   = Object.keys(portfolio);

        if (tickers.length === 0) {
            body.innerHTML = `<div class="tsa-loading" style="color:#888">
                No tracked positions yet.<br>
                <span style="font-size:11px;color:#555">Go to All view and click + next to any stock to track it.</span>
            </div>`;
            const cnt = document.getElementById('tsa-stock-count');
            if (cnt) cnt.textContent = '0 tracked';
            return;
        }

        const fmt = v => (v > 0 ? '+' : '') + v.toFixed(2) + '%';

        // Build rows
        const rows = tickers.map(ticker => {
            const entry   = portfolio[ticker];
            const stock   = data ? data.find(r => r.ticker === ticker) : null;
            const current = stock ? stock.price : null;
            const pnl     = current ? ((current - entry.buyPrice) / entry.buyPrice) * 100 : null;
            const rec     = (current && entry.sig) ? getSellRec(current, entry) : null;
            return { ticker, entry, stock, current, pnl, rec };
        });

        // Sort: urgent first, then by pnl descending
        rows.sort((a, b) => {
            const ua = a.rec?.urgent ? 1 : 0;
            const ub = b.rec?.urgent ? 1 : 0;
            if (ua !== ub) return ub - ua;
            return (b.pnl ?? 0) - (a.pnl ?? 0);
        });

        let html = `
            <table id="tsa-table"><thead><tr>
                <th>Ticker</th>
                <th>Bought @</th>
                <th>Current</th>
                <th>P/L %</th>
                <th>Target</th>
                <th>Stop</th>
                <th>Recommendation</th>
                <th>Date</th>
                <th></th>
            </tr></thead><tbody>`;

        rows.forEach(({ ticker, entry, current, pnl, rec }) => {
            const pnlStr   = pnl !== null ? fmt(pnl) : '—';
            const pnlClr   = pnl === null ? '#888' : pnl >= 0 ? '#7dde7d' : '#ff5252';
            const recLabel = rec ? rec.label : '—';
            const recClr   = rec ? rec.color : '#888';
            const urgentCls = rec?.urgent ? 'tsa-urgent' : '';
            const curStr   = current ? '$' + current.toFixed(2) : '—';
            const curColor = !current ? '#aaa' : current > entry.buyPrice ? '#7dde7d' : current < entry.buyPrice ? '#ff5252' : '#fff';

            html += `<tr class="${urgentCls}">
                <td class="tsa-ticker">${ticker}</td>
                <td style="color:#fff">$${entry.buyPrice.toFixed(2)}</td>
                <td style="color:${curColor};font-weight:bold">${curStr}</td>
                <td style="color:${pnlClr};font-weight:bold">${pnlStr}</td>
                <td style="color:#7dde7d">+${entry.targetPct}%</td>
                <td style="color:#ff8a80">-${entry.stopLoss}%</td>
                <td style="color:${recClr};font-size:11px">${recLabel}</td>
                <td style="color:#555;font-size:10px">${entry.buyDate || '—'}</td>
                <td>
                    <button class="tsa-track-btn tsa-tracked" data-ticker="${ticker}" data-price="${current || entry.buyPrice}" title="Edit">✏️</button>
                    <button class="tsa-remove-btn" data-ticker="${ticker}" title="Remove">✕</button>
                </td>
            </tr>`;
        });

        html += '</tbody></table>';
        body.innerHTML = html;

        const cnt = document.getElementById('tsa-stock-count');
        if (cnt) cnt.textContent = `${rows.length} tracked`;

        // Wire buttons
        body.querySelectorAll('.tsa-track-btn').forEach(btn => {
            btn.addEventListener('click', () => openModal(btn.dataset.ticker, parseFloat(btn.dataset.price)));
        });
        body.querySelectorAll('.tsa-remove-btn').forEach(btn => {
            btn.addEventListener('click', () => removeFromPortfolio(btn.dataset.ticker));
        });
    }

    // ─── Init & SPA Nav ───────────────────────────────────────────────────────
    let lastHash = '';

    function checkNav() {
        if (window.location.hash === lastHash) return;
        lastHash = window.location.hash;
        if (onStocksPage() && !document.getElementById('tsa-panel'))
            setTimeout(() => { injectStyles(); createPanel(); }, 600);
    }

    function init() {
        if (!onStocksPage()) return;
        injectStyles();
        createPanel();
    }

    setInterval(checkNav, 500);

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        window.addEventListener('DOMContentLoaded', init);
    }

})();
