// ==UserScript==
// @name         Torn OC Loan Manager (PDA)
// @namespace    https://torn.com
// @version      1.7.1-pda
// @description  Highlights over-loaned items and helps loan missing OC tools + split calculator (PDA compatible, no armory tab needed)
// @match        https://www.torn.com/factions.php?step=your*
// @run-at       document-end
// @downloadURL  https://tornwar.com/scripts/torn-oc-loan-manager-pda.user.js
// @updateURL    https://tornwar.com/scripts/torn-oc-loan-manager-pda.meta.js
// ==/UserScript==

// =============================================================================
// CHANGELOG
// =============================================================================
// v1.7.1-pda - Fix: draggable button click detection
// v1.7.0-pda - Draggable OC button with position memory
// v1.6.0-pda - Add API Settings panel, shrink floating button
// v1.5.2-pda - Update URLs to tornwar.com hosting
// v1.5.1-pda - Fix: retrieve role parameter (use "retrieve" not "return")
// v1.5.0-pda - Unused tab card UI with Retrieve Item button
// v1.4.1-pda - Initial PDA-compatible release: highlights over-loaned items,
//              helps loan missing OC tools, split calculator
// =============================================================================

(function () {
    'use strict';

    // ------------------- PDA / API detection -------------------
    let inPDA = false;
    let apiKey = '';

    try {
        const PDAKey = "###PDA-APIKEY###";
        if (PDAKey && PDAKey.charAt(0) !== "#") {
            inPDA = true;
            apiKey = PDAKey; // Use PDA API key
        }
    } catch (e) {
        // Not in PDA, ignore
    }

    // ------------------- Storage shim (no GM_* APIs) -------------------
    const storage = {
        get(key, def = '') {
            try {
                const v = localStorage.getItem(key);
                return v === null ? def : v;
            } catch {
                return def;
            }
        },
        set(key, value) {
            try {
                localStorage.setItem(key, value);
            } catch {
                // ignore
            }
        }
    };

    const getApiKey = () => {
        if (inPDA) return apiKey;
        return storage.get('OCLM_API_KEY', '');
    };

    const requireApiKeyOrThrow = () => {
        const key = getApiKey();
        if (!key) {
            const err = new Error('MISSING_API_KEY');
            err.isApiKeyError = true;
            throw err;
        }
        return key;
    };

    const BLACKLISTED_ITEM_IDS = new Set([1012, 226]);

    const overAllocated = new Map();
    const memberNameMap = new Map();
    let membersLoaded = false;

    // itemID -> { armoryID, qty }
    const armoryCache = new Map();
    let preparedArmoryID = null;
    let pendingArmoryItemID = null;

    // Split calculator
    const SCENARIOS = {
        "Ace in the Hole": {
            "Stacking the Deck": 6.8,
            "Ace in the Hole": 12.56
        },
        "Crane Reaction": {
            "Manifest Cruelty": 3.125,
            "Gone Fission": 5.7,
            "Crane Reaction": 8.167
        }
    };

    // ------------------- Utilities -------------------
    const getRfcvToken = () => {
        const match = document.cookie.match(/rfc_v=([^;]+)/);
        return match ? match[1] : null;
    };

    const isOnArmoryUtilities = () => {
        return location.hash.includes('#/tab=armoury') && location.hash.includes('sub=utilities');
    };

    const formatNumber = (num) => {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    };

    // ------------------- API Helpers -------------------
    const loadMembers = async () => {
        if (membersLoaded) return;
        const key = requireApiKeyOrThrow();
        const res = await fetch(`https://api.torn.com/v2/faction/members?key=${key}`);
        if (!res.ok) throw new Error('Failed to load members');
        const data = await res.json();
        Object.values(data.members || {}).forEach(m => memberNameMap.set(m.id, m.name));
        membersLoaded = true;
    };

    const getMissingOCItems = async () => {
        const key = requireApiKeyOrThrow();
        const res = await fetch(`https://api.torn.com/v2/faction/crimes?cat=available&key=${key}`);
        if (!res.ok) throw new Error('Failed to load OC data');
        const data = await res.json();

        const missing = [];
        data.crimes.forEach(crime => {
            crime.slots?.forEach(slot => {
                if (slot.item_requirement &&
                    !slot.item_requirement.is_available &&
                    slot.user?.id &&
                    !BLACKLISTED_ITEM_IDS.has(slot.item_requirement.id)
                ) {
                    missing.push({
                        crimeName: crime.name,
                        position: slot.position,
                        itemID: slot.item_requirement.id,
                        userID: slot.user.id,
                        userName: memberNameMap.get(slot.user.id) || `Unknown [${slot.user.id}]`
                    });
                }
            });
        });
        return missing;
    };

    const ITEM_NAME_CACHE_KEY = 'UTILITY_ITEM_ID_NAME_MAP';

    const getItemNameMap = () => {
        try {
            const raw = storage.get(ITEM_NAME_CACHE_KEY, '{}');
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    };

    const setItemName = (itemID, name) => {
        const map = getItemNameMap();
        if (!map[itemID]) {
            map[itemID] = name;
            storage.set(ITEM_NAME_CACHE_KEY, JSON.stringify(map));
        }
    };

    const getItemName = (itemID) => {
        const map = getItemNameMap();
        return map[itemID] || null;
    };

    // ------------------- Armory Cache (JSON, no tab needed) -------------------
    const fetchArmoryUtilitiesJSON = async () => {
        const rfcv = getRfcvToken();
        if (!rfcv) throw new Error('Missing RFCV token');

        const body = new URLSearchParams({
            step: 'armouryTabContent',
            type: 'utilities',
            start: '0',
            ajax: 'true'
        });

        const res = await fetch(`https://www.torn.com/factions.php?rfcv=${rfcv}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body,
            credentials: 'same-origin'
        });

        if (!res.ok) throw new Error('Failed to fetch armoury');
        const data = await res.json();
        if (!data?.items) throw new Error('Malformed response');

        for (const entry of data.items) {
            if (entry.itemID && entry.name) {
                setItemName(entry.itemID, entry.name);
            }
        }

        return data.items;
    };

    const refreshArmoryCache = async () => {
        armoryCache.clear();
        const items = await fetchArmoryUtilitiesJSON();
        for (const entry of items) {
            if (entry.user === false && entry.qty > 0) {
                armoryCache.set(entry.itemID, {
                    armoryID: entry.armoryID,
                    qty: entry.qty
                });
            }
        }
    };

    const prepareArmouryForItem = async (itemID) => {
        if (!armoryCache.has(itemID)) await refreshArmoryCache();
        const entry = armoryCache.get(itemID);
        if (!entry || entry.qty <= 0) return null;
        preparedArmoryID = entry.armoryID;
        pendingArmoryItemID = itemID;
        return entry.armoryID;
    };

    // ------------------- Retrieve (return loaned item) -------------------
    const retrieveItem = async ({ armoryID, itemID, userID, userName }) => {
        const rfcv = getRfcvToken();
        if (!rfcv) throw new Error('Missing RFCV token');

        const body = new URLSearchParams({
            ajax: 'true',
            step: 'armouryActionItem',
            role: 'retrieve',
            item: armoryID,
            itemID: itemID,
            type: 'Tool',
            user: `${userName} [${userID}]`,
            quantity: '1'
        });

        const res = await fetch(`https://www.torn.com/factions.php?rfcv=${rfcv}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body,
            credentials: 'same-origin'
        });

        if (!res.ok) throw new Error('Retrieve request failed');
        const text = await res.text();
        if (!text.includes('success')) throw new Error('Retrieve failed');
    };

    // ------------------- Loaning (correct armoryID + itemID) -------------------
    const loanItem = async ({ armoryID, itemID, userID, userName }) => {
        const rfcv = getRfcvToken();
        if (!rfcv) throw new Error('Missing RFCV token');

        const body = new URLSearchParams({
            ajax: 'true',
            step: 'armouryActionItem',
            role: 'loan',
            item: armoryID,
            itemID: itemID,
            type: 'Tool',
            user: `${userName} [${userID}]`,
            quantity: '1'
        });

        const res = await fetch(`https://www.torn.com/factions.php?rfcv=${rfcv}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body,
            credentials: 'same-origin'
        });

        if (!res.ok) throw new Error('Loan request failed');
        const text = await res.text();
        if (!text.includes('success')) throw new Error('Loan failed');
    };

    const loanPreparedItem = async ({ userID, userName }) => {
        if (!preparedArmoryID || pendingArmoryItemID === null) throw new Error('Armoury not prepared');
        await loanItem({
            armoryID: preparedArmoryID,
            itemID: pendingArmoryItemID,
            userID,
            userName
        });
        const entry = armoryCache.get(pendingArmoryItemID);
        if (entry) {
            entry.qty -= 1;
            if (entry.qty <= 0) armoryCache.delete(pendingArmoryItemID);
        }
        preparedArmoryID = null;
        pendingArmoryItemID = null;
    };

    // ------------------- Highlighting -------------------
    let highlightedRows = new Set();

    const clearHighlights = () => {
        highlightedRows.forEach(el => {
            if (el?.style) {
                el.style.outline = '';
                el.style.boxShadow = '';
                el.style.background = '';
            }
        });
        highlightedRows.clear();
    };

    const highlightOverAllocated = () => {
        clearHighlights();
        const container = document.querySelector('#tab\\=armoury\\&sub\\=utilities');
        if (!container) return;

        container.querySelectorAll('li').forEach(li => {
            const loanedDiv = li.querySelector('.loaned');
            if (!loanedDiv) return;
            const link = loanedDiv.querySelector('a[href^="/profiles.php?XID="]');
            if (!link) return;
            const playerId = parseInt(link.href.match(/XID=(\d+)/)?.[1], 10);
            if (!playerId) return;
            const itemImg = li.querySelector('.img-wrap');
            const itemId = parseInt(itemImg?.getAttribute('data-itemid'), 10);
            if (!itemId) return;

            if (overAllocated.get(playerId)?.has(itemId)) {
                li.style.outline = '2px solid var(--default-yellow-color)';
                li.style.outlineOffset = '-2px';
                li.style.background =
                    'linear-gradient(90deg, rgba(240,200,90,0.22), transparent)';
                li.style.transition = 'background 0.25s ease, outline 0.25s ease';
                highlightedRows.add(li);
            }
        });
    };

    // ------------------- UI -------------------
    const createUI = async () => {
        document.querySelectorAll('#oc-loan-btn, #oc-loan-panel').forEach(el => el.remove());

        const button = document.createElement('button');
        button.id = 'oc-loan-btn';
        button.textContent = 'OC';
        // Restore saved position or use default
        const savedPos = (() => {
            try {
                const raw = storage.get('OCLM_BTN_POS', '');
                if (!raw) return null;
                const p = JSON.parse(raw);
                if (typeof p.x === 'number' && typeof p.y === 'number') return p;
            } catch { /* ignore */ }
            return null;
        })();

        button.style.cssText = `
            position: fixed;
            z-index: 99999;
            padding: 5px 10px;
            min-height: 26px;
            background: #2a3cff;
            color: #fff;
            border: none;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.3px;
            cursor: grab;
            box-shadow:
                0 3px 10px rgba(42, 60, 255, 0.3),
                inset 0 0 0 1px rgba(255,255,255,0.15);
            touch-action: none;
            user-select: none;
            -webkit-user-select: none;
        `;

        if (savedPos) {
            button.style.left = Math.min(savedPos.x, window.innerWidth - 40) + 'px';
            button.style.top = Math.min(savedPos.y, window.innerHeight - 26) + 'px';
        } else {
            button.style.top = '10px';
            button.style.right = '10px';
        }

        // ---- Drag logic (mouse + touch, with click detection) ----
        let isDragging = false;
        let wasDragged = false;
        let dragStartX = 0, dragStartY = 0;
        let btnStartX = 0, btnStartY = 0;
        const DRAG_THRESHOLD = 5; // px movement before it counts as a drag

        const getClientPos = (e) => {
            if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
            return { x: e.clientX, y: e.clientY };
        };

        const onDragStart = (e) => {
            // Only left mouse button or touch
            if (e.type === 'mousedown' && e.button !== 0) return;
            // Only preventDefault for touch (prevents scroll); mouse needs click to fire
            if (e.type === 'touchstart') e.preventDefault();

            const pos = getClientPos(e);
            dragStartX = pos.x;
            dragStartY = pos.y;

            const rect = button.getBoundingClientRect();
            btnStartX = rect.left;
            btnStartY = rect.top;

            isDragging = true;
            wasDragged = false;
            button.style.cursor = 'grabbing';

            document.addEventListener('mousemove', onDragMove, { passive: false });
            document.addEventListener('mouseup', onDragEnd);
            document.addEventListener('touchmove', onDragMove, { passive: false });
            document.addEventListener('touchend', onDragEnd);
        };

        const onDragMove = (e) => {
            if (!isDragging) return;
            const pos = getClientPos(e);
            const dx = pos.x - dragStartX;
            const dy = pos.y - dragStartY;

            if (!wasDragged && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
            wasDragged = true;
            e.preventDefault();

            // Clamp to viewport
            const bw = button.offsetWidth;
            const bh = button.offsetHeight;
            const newX = Math.max(0, Math.min(window.innerWidth - bw, btnStartX + dx));
            const newY = Math.max(0, Math.min(window.innerHeight - bh, btnStartY + dy));

            button.style.left = newX + 'px';
            button.style.top = newY + 'px';
            button.style.right = 'auto';
        };

        const onDragEnd = (e) => {
            if (!isDragging) return;
            isDragging = false;
            button.style.cursor = 'grab';

            document.removeEventListener('mousemove', onDragMove);
            document.removeEventListener('mouseup', onDragEnd);
            document.removeEventListener('touchmove', onDragMove);
            document.removeEventListener('touchend', onDragEnd);

            if (wasDragged) {
                // Persist position
                const rect = button.getBoundingClientRect();
                storage.set('OCLM_BTN_POS', JSON.stringify({ x: Math.round(rect.left), y: Math.round(rect.top) }));
            } else if (e.type === 'touchend') {
                // Touch didn't drag — treat as a tap (click won't fire after touchstart preventDefault)
                isOpen ? closePanel() : openPanel();
            }
        };

        button.addEventListener('mousedown', onDragStart);
        button.addEventListener('touchstart', onDragStart, { passive: false });

        button.onmouseover = () => { if (!isDragging) button.style.opacity = '0.85'; };
        button.onmouseout = () => { button.style.opacity = '1'; };

        const panel = document.createElement('div');
        panel.id = 'oc-loan-panel';
        panel.style.cssText = `
            position:fixed;
            width:320px;
            max-width:90vw;
            max-height:80vh;
            background: var(--default-bg-panel-color);
            border: 1px solid var(--default-panel-divider-outer-side-color);
            border-radius: 8px;
            box-shadow: 0 8px 20px rgba(0,0,0,0.4);
            z-index:99998;
            opacity:0; visibility:hidden; transform:translateY(-8px);
            transition: opacity 0.25s ease, transform 0.25s ease;
            display:flex;
            flex-direction:column;
            overflow:hidden;
        `;

        const style = document.createElement('style');
        style.textContent = `
            #oc-loan-panel {
                color: #e6e6e6;
                font-size: 13.5px;
            }
            #oc-loan-panel * {
                box-sizing: border-box;
            }
            #oc-loan-panel .oc-header {
                padding: 8px 10px 4px 10px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                background: #121212;
                border-bottom: 1px solid #222;
                gap: 4px;
                flex-wrap: wrap;
            }
            #oc-loan-panel .oc-title {
                font-size: 15px;
                font-weight: 700;
                letter-spacing: 0.3px;
            }
            #oc-loan-panel .oc-status {
                font-size: 11px;
                color: #888;
            }
            #oc-loan-panel .oc-tabs {
                display: flex;
                gap: 6px;
            }
            #oc-loan-panel .oc-tab {
                padding: 6px 12px;
                background: #1b1b1b;
                border-radius: 999px;
                border: none;
                color: #aaa;
                cursor: pointer;
                font-weight: 600;
            }
            #oc-loan-panel .oc-tab.active {
                background: #2a3cff;
                color: #fff;
            }
            #oc-loan-panel .oc-tab:hover:not(.active) {
                background: #222;
                color: #ddd;
            }
            #oc-content {
                padding: 12px 14px 14px 14px;
                overflow-y: auto;
                overflow-x: hidden;
                max-height: calc(80vh - 52px);
            }
            #action-btn {
                width: 100%;
                padding: 14px;
                margin-top: 14px;
                border-radius: 10px;
                border: none;
                font-weight: 700;
                font-size: 14px;
                background: #2a2a2a;
                color: #aaa;
                cursor: pointer;
            }
            #action-btn.ready {
                background: #2a3cff;
                color: #fff;
            }
            #action-btn.ready:hover {
                filter: brightness(1.1);
            }
            #oc-loan-panel table {
                width: 100%;
                border-collapse: collapse;
            }
            #oc-loan-panel th {
                text-align: left;
                color: #888;
                font-weight: 600;
                padding-bottom: 6px;
            }
            #oc-loan-panel td {
                padding: 6px 0;
            }
            #oc-close {
                cursor: pointer;
                font-size: 22px;
                opacity: 0.6;
            }
            #oc-close:hover { opacity: 1; }
        `;
        document.head.appendChild(style);

        const apiStatus = inPDA
            ? 'API: PDA key'
            : (getApiKey() ? 'API: Local key' : '<span style="color:#f66;">API: missing — set key in ⚙</span>');

        panel.innerHTML = `
            <div class="oc-header">
                <div style="display:flex;flex-direction:column;gap:2px;min-width:0;">
                    <div class="oc-title">OC Loan Manager</div>
                    <div class="oc-status">${apiStatus}</div>
                </div>
                <div class="oc-tabs">
                    <button id="tab-unused" class="oc-tab active">Unused</button>
                    <button id="tab-missing" class="oc-tab">Missing</button>
                    <button id="tab-split" class="oc-tab">Split</button>
                    <button id="tab-settings" class="oc-tab">⚙</button>
                </div>
                <div id="oc-close">×</div>
            </div>
            <div id="oc-content"></div>
        `;
        document.body.appendChild(button);
        document.body.appendChild(panel);

        const content = panel.querySelector('#oc-content');
        const tabUnused = panel.querySelector('#tab-unused');
        const tabMissing = panel.querySelector('#tab-missing');
        const tabSplit = panel.querySelector('#tab-split');
        const tabSettings = panel.querySelector('#tab-settings');
        let isOpen = false;
        const allTabs = [tabUnused, tabMissing, tabSplit, tabSettings];

        const positionPanel = () => {
            const btnRect = button.getBoundingClientRect();
            const pw = 320;
            const margin = 6;

            // Prefer placing below the button, aligned to its left edge
            let left = btnRect.left;
            let top = btnRect.bottom + margin;

            // If panel would overflow right, shift left
            if (left + pw > window.innerWidth - 8) {
                left = window.innerWidth - pw - 8;
            }
            // Keep at least 8px from left
            if (left < 8) left = 8;

            // If panel would overflow bottom, place above the button
            if (top + 200 > window.innerHeight) {
                top = Math.max(8, btnRect.top - margin - 200);
            }

            panel.style.left = left + 'px';
            panel.style.top = top + 'px';
        };

        const openPanel = () => {
            isOpen = true;
            positionPanel();
            panel.style.opacity = '1';
            panel.style.visibility = 'visible';
            panel.style.transform = 'translateY(0)';
        };

        const closePanel = () => {
            isOpen = false;
            panel.style.opacity = '0';
            panel.style.visibility = 'hidden';
            panel.style.transform = 'translateY(-10px)';
            clearHighlights();
        };

        button.addEventListener('click', () => {
            // Mouse click fires naturally (not suppressed by preventDefault)
            // Only toggle if it wasn't a drag
            if (wasDragged) { wasDragged = false; return; }
            isOpen ? closePanel() : openPanel();
        });
        panel.querySelector('#oc-close').onclick = closePanel;

        // Settings tab
        tabSettings.onclick = () => {
            allTabs.forEach(t => t.classList.remove('active'));
            tabSettings.classList.add('active');

            const currentKey = storage.get('OCLM_API_KEY', '');
            const masked = currentKey ? currentKey.slice(0, 4) + '••••' + currentKey.slice(-4) : '';

            content.innerHTML = `
                <div style="line-height:1.7; margin-bottom:12px;">
                    <strong style="font-size:15px;">API Settings</strong><br>
                    <span style="font-size:11px; color:#aaa;">
                        ${inPDA ? 'Running in PDA — API key is provided automatically. You can still override it below.' : 'Enter your Torn API key to use this script outside of PDA.'}
                    </span>
                </div>
                <div style="margin-bottom:10px;">
                    <label style="font-size:12px; color:#888; display:block; margin-bottom:4px;">Current Key</label>
                    <div id="settings-current-key" style="font-family:monospace; font-size:13px; color:#ccc; padding:8px 10px; background:#1a1a1a; border-radius:6px; border:1px solid #333; min-height:20px;">
                        ${masked || '<span style="color:#666;">No key saved</span>'}
                    </div>
                </div>
                <div style="margin-bottom:14px;">
                    <label style="font-size:12px; color:#888; display:block; margin-bottom:4px;">New API Key</label>
                    <input id="settings-api-input" type="text" placeholder="Paste your Torn API key" autocomplete="off" spellcheck="false"
                        style="width:-webkit-fill-available; padding:10px; border:1px solid #333; border-radius:6px; background:#1a1a1a; color:#e6e6e6; font-family:monospace; font-size:13px;" />
                </div>
                <div style="display:flex; gap:8px;">
                    <button id="settings-save-btn" style="flex:1; padding:10px; border:none; border-radius:8px; font-weight:700; font-size:13px; background:#2a3cff; color:#fff; cursor:pointer;">Save Key</button>
                    <button id="settings-clear-btn" style="flex:1; padding:10px; border:none; border-radius:8px; font-weight:700; font-size:13px; background:#2a2a2a; color:#aaa; cursor:pointer;">Clear Key</button>
                </div>
                <div id="settings-msg" style="text-align:center; margin-top:10px; font-size:12px; min-height:18px;"></div>
                <div style="margin-top:18px; padding-top:12px; border-top:1px solid #333;">
                    <div style="font-size:11px; color:#666; line-height:1.5;">
                        Your key is stored in localStorage and never leaves your browser.
                        Use a <strong>Limited Access</strong> key with only the permissions this script needs.
                    </div>
                </div>
            `;

            const input = content.querySelector('#settings-api-input');
            const msg = content.querySelector('#settings-msg');
            const currentKeyEl = content.querySelector('#settings-current-key');

            const showMsg = (text, color = '#4caf50') => {
                msg.style.color = color;
                msg.textContent = text;
                setTimeout(() => { msg.textContent = ''; }, 3000);
            };

            const updateCurrentDisplay = () => {
                const k = storage.get('OCLM_API_KEY', '');
                currentKeyEl.innerHTML = k
                    ? `${k.slice(0, 4)}••••${k.slice(-4)}`
                    : '<span style="color:#666;">No key saved</span>';
            };

            content.querySelector('#settings-save-btn').onclick = () => {
                const val = input.value.trim();
                if (!val) {
                    showMsg('Please enter an API key', '#f66');
                    return;
                }
                if (!/^[a-zA-Z0-9]{16}$/.test(val)) {
                    showMsg('Invalid key format (expected 16 alphanumeric chars)', '#f66');
                    return;
                }
                storage.set('OCLM_API_KEY', val);
                input.value = '';
                membersLoaded = false;
                memberNameMap.clear();
                updateCurrentDisplay();
                showMsg('API key saved');
            };

            content.querySelector('#settings-clear-btn').onclick = () => {
                storage.set('OCLM_API_KEY', '');
                membersLoaded = false;
                memberNameMap.clear();
                updateCurrentDisplay();
                showMsg('API key cleared', '#f66');
            };
        };

        // Unused tab
        tabUnused.onclick = async () => {
            allTabs.forEach(t => t.classList.remove('active'));
            tabUnused.classList.add('active');
            content.innerHTML = '<div style="text-align:center;padding:40px;">Loading unused loans...</div>';

            try {
                const key = requireApiKeyOrThrow();

                await loadMembers();
                overAllocated.clear();

                const [crimesRes, utilsRes, armoryItems] = await Promise.all([
                    fetch(`https://api.torn.com/v2/faction/crimes?cat=available&key=${key}`),
                    fetch(`https://api.torn.com/faction/?selections=utilities&key=${key}`),
                    fetchArmoryUtilitiesJSON()
                ]);

                const crimesData = await crimesRes.json();
                const utilsData = await utilsRes.json();

                // Build a lookup: itemID -> [{ armoryID, userID }] for loaned items from internal endpoint
                const loanedArmoryLookup = new Map();
                for (const entry of armoryItems) {
                    if (entry.user && entry.user !== false && entry.itemID) {
                        const uid = typeof entry.user === 'object' ? entry.user.userID : entry.user;
                        if (!loanedArmoryLookup.has(entry.itemID)) loanedArmoryLookup.set(entry.itemID, []);
                        loanedArmoryLookup.get(entry.itemID).push({
                            armoryID: entry.armoryID,
                            userID: uid
                        });
                    }
                }

                const usedItems = new Map();
                crimesData.crimes.forEach(c => c.slots?.forEach(s => {
                    if (!s.user?.id || !s.item_requirement?.id) return;
                    const pid = s.user.id;
                    if (!usedItems.has(pid)) usedItems.set(pid, new Set());
                    usedItems.get(pid).add(s.item_requirement.id);
                }));

                const overList = [];
                (utilsData.utilities || []).forEach(u => {
                    if (!u.loaned || BLACKLISTED_ITEM_IDS.has(u.ID)) return;

                    const loanedTo = typeof u.loaned_to === 'number' ? [u.loaned_to] :
                        typeof u.loaned_to === 'string' ? u.loaned_to.split(',').map(x => parseInt(x.trim(), 10)).filter(Boolean) :
                            [];

                    loanedTo.forEach(pid => {
                        if (!usedItems.get(pid)?.has(Number(u.ID))) {
                            if (!overAllocated.has(pid)) overAllocated.set(pid, new Set());
                            overAllocated.get(pid).add(Number(u.ID));

                            // Find the matching armoryID from the internal endpoint
                            const candidates = loanedArmoryLookup.get(Number(u.ID)) || [];
                            const match = candidates.find(c => c.userID === pid);

                            overList.push({
                                name: memberNameMap.get(pid) || `Unknown [${pid}]`,
                                pid,
                                item: u.name,
                                iid: u.ID,
                                armoryID: match ? match.armoryID : null
                            });
                        }
                    });
                });

                overList.sort((a, b) => a.name.localeCompare(b.name));

                if (overList.length === 0) {
                    content.innerHTML = '<div style="text-align:center;padding:50px;font-size:18px;">All loaned items in use!</div>';
                } else {
                    let unusedIndex = 0;
                    const renderUnusedCurrent = () => {
                        const e = overList[unusedIndex];
                        const itemName = e.item || getItemName(e.iid);
                        const canRetrieve = !!e.armoryID;

                        content.innerHTML = `
                            <div style="line-height:1.7; margin-bottom:16px;">
                                <strong style="font-size:17px;">Unused Loan</strong><br>
                                Item: ${itemName ? `${itemName} (${e.iid})` : `(${e.iid})`}<br>
                                User: <span style="color:var(--default-color);">${e.name}</span><br>
                                <span style="font-size:11px;color:#aaa;">Loaned but not needed for any OC</span>
                            </div>
                            <button id="action-btn" class="${canRetrieve ? 'ready' : ''}">
                                ${canRetrieve ? `Retrieve Item (${unusedIndex + 1}/${overList.length})` : `Skip (${unusedIndex + 1}/${overList.length})`}
                            </button>
                        `;

                        const actionBtn = content.querySelector('#action-btn');
                        actionBtn.onclick = async () => {
                            if (!canRetrieve) {
                                unusedIndex++;
                                if (unusedIndex >= overList.length) {
                                    content.innerHTML =
                                        '<div style="text-align:center;padding:50px;font-size:18px;">All items processed!</div>';
                                } else {
                                    renderUnusedCurrent();
                                }
                                return;
                            }

                            actionBtn.disabled = true;
                            actionBtn.textContent = 'Retrieving...';

                            try {
                                await retrieveItem({
                                    armoryID: e.armoryID,
                                    itemID: e.iid,
                                    userID: e.pid,
                                    userName: e.name
                                });

                                unusedIndex++;
                                if (unusedIndex >= overList.length) {
                                    content.innerHTML =
                                        '<div style="text-align:center;padding:50px;font-size:18px;">All items retrieved!</div>';
                                } else {
                                    renderUnusedCurrent();
                                }
                            } catch (err) {
                                actionBtn.textContent = `Retrieve Item (${unusedIndex + 1}/${overList.length})`;
                                actionBtn.disabled = false;
                            }
                        };
                    };
                    renderUnusedCurrent();
                }

                if (isOnArmoryUtilities()) highlightOverAllocated();
            } catch (err) {
                if (err.isApiKeyError || err.message === 'INVALID_API_RESPONSE') {
                    content.innerHTML = `
                        <div style="text-align:center;padding:50px;">
                            <div style="font-size:18px;margin-bottom:12px;">API Key Required</div>
                            <div style="color:#aaa;">
                                No API key detected. If you are using Torn PDA, make sure a PDA API key is set in app settings.
                            </div>
                        </div>
                    `;
                } else {
                    content.innerHTML = `<div style="color:#f66;padding:20px;">Error: ${err.message}</div>`;
                }
            }
        };

        tabMissing.onclick = async () => {
            allTabs.forEach(t => t.classList.remove('active'));
            tabMissing.classList.add('active');
            renderMissingTab();
        };

        const renderMissingTab = async () => {
            try {
                requireApiKeyOrThrow();
            } catch {
                content.innerHTML = `
                    <div style="text-align:center;padding:50px;">
                        <div style="font-size:18px;margin-bottom:12px;">API Key Required</div>
                        <div style="color:#aaa;">
                            No API key detected. If you are using Torn PDA, make sure a PDA API key is set in app settings.
                        </div>
                    </div>
                `;
                return;
            }

            let missingQueue = [];
            try {
                await loadMembers();
                await refreshArmoryCache();
                missingQueue = await getMissingOCItems();
            } catch (err) {
                content.innerHTML = `<div style="color:#f66;padding:20px;">Error loading: ${err.message}</div>`;
                return;
            }

            if (missingQueue.length === 0) {
                content.innerHTML = '<div style="text-align:center;padding:50px;font-size:18px;">No missing OC items!</div>';
                return;
            }

            let index = 0;
            const renderCurrent = () => {
                const item = missingQueue[index];
                const cached = armoryCache.get(item.itemID);
                const isAvailable = cached && cached.qty > 0;
                const itemName = getItemName(item.itemID);

                content.innerHTML = `
                    <div style="line-height:1.7; margin-bottom:16px;">
                        <strong style="font-size:17px;">${item.crimeName}</strong><br>
                        Position: ${item.position}<br>
                        Item: ${itemName ? `${itemName} (${item.itemID})` : `(${item.itemID})`}<br>
                        User: <span style="color:var(--default-color);">${item.userName}</span><br>
                        <span style="font-size:11px;color:#aaa;">Available in armory: ${isAvailable ? cached.qty : 0}</span>
                    </div>
                    <button id="action-btn" class="${isAvailable ? 'ready' : ''}">
                        ${isAvailable ? `Loan Item (${index + 1}/${missingQueue.length})` : 'Reload Armory Availability'}
                    </button>
                `;

                const actionBtn = content.querySelector('#action-btn');

                actionBtn.onclick = async () => {
                    actionBtn.disabled = true;
                    actionBtn.textContent = 'Processing...';

                    try {
                        if (!isAvailable) {
                            await refreshArmoryCache();
                            renderCurrent();
                        } else {
                            if (
                                preparedArmoryID === null ||
                                pendingArmoryItemID !== item.itemID
                            ) {
                                const armoryID = await prepareArmouryForItem(item.itemID);
                                if (!armoryID) {
                                    throw new Error('Item not available in armoury');
                                }
                            }

                            await loanPreparedItem({
                                userID: item.userID,
                                userName: item.userName
                            });

                            index++;
                            if (index >= missingQueue.length) {
                                content.innerHTML =
                                    '<div style="text-align:center;padding:50px;font-size:18px;">All items loaned!</div>';
                            } else {
                                renderCurrent();
                            }
                        }
                    } catch (err) {
                        actionBtn.textContent = isAvailable ? `Loan Item (${index + 1}/${missingQueue.length})` : 'Reload Armory Availability';
                        actionBtn.disabled = false;
                    }
                };
            };

            renderCurrent();
        };

        tabSplit.onclick = () => {
            allTabs.forEach(t => t.classList.remove('active'));
            tabSplit.classList.add('active');

            content.innerHTML = `
                <select id="split-scenario" style="width:100%; padding:10px; margin-bottom:12px; background: var(--default-bg-panel-active-color); color: var(--default-color); border: 1px solid var(--default-panel-divider-outer-side-color); border-radius:6px;">
                    ${Object.keys(SCENARIOS).map(s => `<option>${s}</option>`).join('')}
                </select>
                <input id="split-total" type="text" placeholder="e.g. 1,000,000,000" style="width:-webkit-fill-available; border:none; padding:12px; border-radius:10px;">
                <div id="split-results" style="line-height:1.6;"></div>
            `;

            const select = content.querySelector('#split-scenario');
            const input = content.querySelector('#split-total');
            const results = content.querySelector('#split-results');

            const calculate = () => {
                const scenario = SCENARIOS[select.value];
                const raw = input.value.replace(/,/g, '');
                const total = parseFloat(raw);

                if (isNaN(total) || total <= 0) {
                    results.innerHTML = '<div style="color:#888; text-align:center; padding:20px;">Enter valid total</div>';
                    return;
                }

                results.innerHTML = `
                    <table style="width:100%; border-collapse:collapse; line-height:1.6;">
                    <thead>
                        <tr style="border-bottom:1px solid var(--default-color);">
                            <th style="text-align:left; padding:6px;">Scenario</th>
                            <th style="text-align:right; padding:6px;">%</th>
                            <th style="text-align:right; padding:6px;">Amount</th>
                            <th style="width:32px;"></th>
                        </tr>
                    </thead>
                    <tbody>
                    ${Object.entries(scenario).map(([role, percent]) => {
                    const amount = Math.floor(total * (percent / 100));
                    const formatted = formatNumber(amount);

                    return `
                        <tr style="border-bottom:1px solid #444;">
                            <td style="padding:6px; color:var(--default-color);">${role}</td>
                            <td style="padding:6px;  color:var(--default-color); text-align:right;">${percent}%</td>
                            <td style="padding:6px;  color:var(--default-color); text-align:right; font-weight:bold;">
                                $${formatted}
                            </td>
                            <td style="text-align:center;">
                                <span class="copy-btn" data-val="${amount}" style="cursor:pointer;">📋</span>
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;

                results.querySelectorAll('.copy-btn').forEach(btn => {
                    btn.onclick = async () => {
                        try {
                            await navigator.clipboard.writeText(btn.dataset.val);
                            btn.textContent = '✅';
                            setTimeout(() => btn.textContent = '📋', 1500);
                        } catch {
                            btn.textContent = '✖';
                            setTimeout(() => btn.textContent = '📋', 1500);
                        }
                    };
                });
            };

            select.onchange = calculate;
            input.oninput = () => {
                let v = input.value.replace(/,/g, '');
                if (/^\d*$/.test(v)) input.value = formatNumber(v);
                calculate();
            };
            calculate();
        };
    };

    createUI();
})();
