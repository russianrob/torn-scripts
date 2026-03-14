// ==UserScript==
// @name         Torn Faction Offline Highlighter
// @namespace    torn.faction.offline.highlight
// @version      1.6.0
// @description  Highlights faction members red who have been offline for over 24 hours on the faction member list. Shows last OC participation on the not-participating panel. Configurable threshold. PDA compatible.
// @changelog    v1.6.0 - Added OC inactivity tracker on the 'not participating in any scenarios' panel
// @author       RussianRob
// @match        https://www.torn.com/factions.php*
// @run-at       document-end
// @changelog    v1.5.2 - API key input now masked with asterisks for security
// @changelog    v1.5.1 - Fixed Default sort not restoring original member order; Settings panel (API key + threshold) now accessible via gear icon instead of prompt; Added PDA auto-key detection
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      api.torn.com
// ==/UserScript==

(function () {
    'use strict';

    // ─── Configuration ───────────────────────────────────────
    const STORAGE_KEY_API   = 'faction_offline_api_key_v1';
    const STORAGE_KEY_HOURS = 'faction_offline_threshold_hours';
    const DEFAULT_HOURS     = 24;
    const REFRESH_MS        = 60_000; // re-check every 60 seconds
    const API_BASE          = 'https://api.torn.com';

    // ─── Colour tiers ────────────────────────────────────────
    // Red for offline > threshold, orange for > half-threshold
    const COLOR_RED    = 'rgba(220, 50, 50, 0.30)';
    const COLOR_ORANGE = 'rgba(255, 165, 0, 0.25)';
    const BORDER_RED   = '2px solid rgba(220, 50, 50, 0.6)';
    const BORDER_ORANGE= '2px solid rgba(255, 165, 0, 0.5)';

    // ─── PDA / API key detection ─────────────────────────────
    let inPDA = false;
    let apiKey = null;
    const PDAKey = "###PDA-APIKEY###";
    if (PDAKey.charAt(0) !== "#") {
        inPDA = true;
        apiKey = PDAKey;
    }

    function getStoredApiKey() {
        let key;
        try { key = GM_getValue(STORAGE_KEY_API, ''); } catch (_) {
            key = localStorage.getItem(STORAGE_KEY_API) || '';
        }
        return key || '';
    }

    function setStoredApiKey(key) {
        try { GM_setValue(STORAGE_KEY_API, key); } catch (_) {
            localStorage.setItem(STORAGE_KEY_API, key);
        }
    }

    function getApiKey() {
        if (inPDA && apiKey) return apiKey;
        const stored = getStoredApiKey();
        if (stored) apiKey = stored;
        return apiKey || '';
    }

    function getThresholdHours() {
        let h;
        try { h = GM_getValue(STORAGE_KEY_HOURS, DEFAULT_HOURS); } catch (_) {
            h = parseInt(localStorage.getItem(STORAGE_KEY_HOURS), 10) || DEFAULT_HOURS;
        }
        return h;
    }

    function setThresholdHours(h) {
        try { GM_setValue(STORAGE_KEY_HOURS, h); } catch (_) {
            localStorage.setItem(STORAGE_KEY_HOURS, String(h));
        }
    }

    // ─── API call ────────────────────────────────────────────
    let memberCache   = null;
    let isHighlighting = false;  // guard against observer loop
    let debounceTimer  = null;
    let sortEnabled    = true;   // sort least-active to top by default
    const STORAGE_KEY_SORT = 'faction_offline_sort_enabled';

    function getSortEnabled() {
        try { const v = GM_getValue(STORAGE_KEY_SORT, true); return v; } catch (_) {
            const v = localStorage.getItem(STORAGE_KEY_SORT);
            return v === null ? true : v === 'true';
        }
    }
    function setSortEnabled(v) {
        sortEnabled = v;
        try { GM_setValue(STORAGE_KEY_SORT, v); } catch (_) {
            localStorage.setItem(STORAGE_KEY_SORT, String(v));
        }
    }

    function apiFetch(url) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest === 'function') {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    onload(res) {
                        try { resolve(JSON.parse(res.responseText)); }
                        catch (e) { reject(e); }
                    },
                    onerror: reject,
                });
            } else {
                fetch(url).then(r => r.json()).then(resolve).catch(reject);
            }
        });
    }

    function fetchMembers(apiKey) {
        return apiFetch(`${API_BASE}/v2/faction/?selections=members&key=${apiKey}`);
    }

    function fetchCompletedCrimes(apiKey) {
        return apiFetch(`${API_BASE}/v2/faction/crimes?cat=completed&sort=DESC&key=${apiKey}`);
    }

    // ─── Time helpers ────────────────────────────────────────
    function hoursAgo(timestamp) {
        return (Date.now() / 1000 - timestamp) / 3600;
    }

    function formatDuration(hours) {
        if (hours < 1)  return `${Math.round(hours * 60)}m`;
        if (hours < 24)  return `${Math.round(hours)}h`;
        const days = Math.floor(hours / 24);
        const rem  = Math.round(hours % 24);
        return rem > 0 ? `${days}d ${rem}h` : `${days}d`;
    }

    // ─── OC participation tracking ──────────────────────────
    let lastOCMap = {};  // member ID → { timestamp, crimeName }

    async function buildLastOCMap() {
        const key = getApiKey();
        if (!key) return;
        try {
            const data = await fetchCompletedCrimes(key);
            if (data.error) {
                console.error('[FOH] Crimes API error:', data.error);
                return;
            }
            const crimes = data.crimes || [];
            const map = {};
            for (const crime of crimes) {
                if (!crime.slots) continue;
                const ts = crime.executed_at || crime.created_at || 0;
                const name = crime.name || 'Unknown';
                for (const slot of crime.slots) {
                    const uid = slot.user && (slot.user.id || slot.user.user_id);
                    if (!uid) continue;
                    const id = String(uid);
                    // Only keep the most recent
                    if (!map[id] || ts > map[id].timestamp) {
                        map[id] = { timestamp: ts, crimeName: name };
                    }
                }
            }
            lastOCMap = map;
        } catch (err) {
            console.error('[FOH] Failed to fetch OC data:', err);
        }
    }

    function findNotParticipatingPanel() {
        // Walk all text nodes looking for the specific header,
        // but exclude chat containers, sidebar, and other non-OC areas
        const candidates = document.querySelectorAll('[class*="panel"], [class*="section"], [class*="crimes"], [class*="scenario"]');
        for (const container of candidates) {
            // Skip chat elements
            if (container.closest('[class*="chat"]') || container.closest('[class*="Chat"]')) continue;
            const text = container.textContent || '';
            if (text.includes("aren't participating in any scenarios")) {
                return container;
            }
        }
        // Fallback: search headers directly
        const headers = document.querySelectorAll('h4, h5, [class*="header"], [class*="title"]');
        for (const el of headers) {
            if (el.closest('[class*="chat"]') || el.closest('[class*="Chat"]')) continue;
            if (el.textContent.includes("aren't participating")) {
                return el.closest('[class*="panel"]') || el.closest('[class*="section"]') || el.parentElement;
            }
        }
        return null;
    }

    function annotateNotParticipating() {
        const panel = findNotParticipatingPanel();
        if (!panel) return;

        // Remove any "Last Action" badges from the offline highlighter on this panel
        panel.querySelectorAll('.foh-badge').forEach(b => b.remove());
        // Remove highlighting styles from cards in this panel
        panel.querySelectorAll('.foh-red, .foh-orange, .foh-ok').forEach(el => {
            el.classList.remove('foh-red', 'foh-orange', 'foh-ok');
            el.style.removeProperty('background');
            el.style.removeProperty('border-left');
        });

        if (Object.keys(lastOCMap).length === 0) return;

        // Find member links in the panel
        const links = panel.querySelectorAll('a[href*="XID="]');
        links.forEach(link => {
            const match = link.href.match(/XID=(\d+)/i);
            if (!match) return;
            const id = match[1];

            // Find the member's card/container within the panel
            const card = link.closest('[class*="member"]') || link.closest('[class*="user"]') ||
                         link.closest('li') || link.closest('div[class]') || link.parentElement;
            if (!card) return;

            // Don't add duplicate badges
            if (card.querySelector('.foh-oc-badge')) return;

            const badge = document.createElement('div');
            badge.className = 'foh-oc-badge';

            const ocInfo = lastOCMap[id];
            if (ocInfo) {
                const hrsAgo = hoursAgo(ocInfo.timestamp);
                const timeStr = formatDuration(hrsAgo);
                badge.textContent = `Last OC: ${timeStr} ago`;
                // Note: this is last COMPLETED OC, not active/planning
                badge.title = `${ocInfo.crimeName} - ${new Date(ocInfo.timestamp * 1000).toLocaleDateString()}`;
                // Color by how long ago
                if (hrsAgo > 168) { // > 7 days
                    badge.style.color = '#ff4444';
                } else if (hrsAgo > 72) { // > 3 days
                    badge.style.color = '#ffa500';
                } else {
                    badge.style.color = '#4caf50';
                }
            } else {
                badge.textContent = 'Last OC: Never';
                badge.title = 'No completed OC found in recent history';
                badge.style.color = '#ff4444';
            }

            badge.style.cssText += ';font-size:9px;font-weight:700;text-align:center;' +
                'width:100%;display:block;padding:1px 0;letter-spacing:0.3px;';

            card.style.position = 'relative';
            card.appendChild(badge);
        });
    }

    // ─── Tab detection ───────────────────────────────────────
    function onMemberListTab() {
        // Check URL hash for member-related tabs
        const hash = window.location.hash || '';
        // Member list tab: #/tab=info or no hash on factions.php?step=your
        // Also check if member rows are visible on the page
        const url = window.location.href;
        const hasMemberRows = document.querySelectorAll('a[href*="profiles.php?XID="]').length > 5;
        const isInfoTab = hash.includes('tab=info') || hash === '' || hash === '#';
        const isYourFaction = url.includes('step=your');
        return isYourFaction && (isInfoTab || hasMemberRows);
    }

    function showControls() {
        const gear = document.getElementById('foh-settings-gear');
        const sort = document.getElementById('foh-sort-toggle');
        if (gear) gear.style.display = 'flex';
        if (sort) sort.style.display = 'flex';
    }

    function hideControls() {
        const gear = document.getElementById('foh-settings-gear');
        const sort = document.getElementById('foh-sort-toggle');
        if (gear) gear.style.display = 'none';
        if (sort) sort.style.display = 'none';
    }

    // ─── DOM highlighting ────────────────────────────────────
    function highlightMembers(members, thresholdH) {
        isHighlighting = true;
        // Find all member list items on the faction page
        const memberRows = document.querySelectorAll(
            'ul.members-list > li, ' +
            '.members-list .table-body > li, ' +
            '.faction-info-members .table-body > li, ' +
            '.member-list > li, ' +
            '.members-cont .table-body > li'
        );

        // Build a map of ID → member data
        const memberMap = {};
        if (members) {
            for (const m of members) {
                if (m.id) memberMap[String(m.id)] = m;
            }
        }

        // Also try to match by scanning <a> tags with href containing XID=
        const allLinks = document.querySelectorAll('a[href*="profiles.php?XID="], a[href*="XID="]');
        const linkMap  = {};
        allLinks.forEach(a => {
            const match = a.href.match(/XID=(\d+)/i);
            if (match) {
                const id = match[1];
                // Walk up to find the containing row
                let row = a.closest('li') || a.closest('tr') || a.closest('[class*="row"]') || a.closest('[class*="member"]');
                if (row && memberMap[id]) {
                    linkMap[id] = { el: row, link: a };
                }
            }
        });

        // Apply highlighting
        const halfThreshold = thresholdH / 2;
        for (const [id, info] of Object.entries(linkMap)) {
            const member = memberMap[id];
            if (!member || !member.last_action || !member.last_action.timestamp) continue;

            const offH = hoursAgo(member.last_action.timestamp);
            const row  = info.el;

            // Clear any previous highlight from this script
            row.classList.remove('foh-red', 'foh-orange', 'foh-ok');
            row.style.removeProperty('background');
            row.style.removeProperty('border-left');

            if (offH >= thresholdH) {
                row.style.background  = COLOR_RED;
                row.style.borderLeft  = BORDER_RED;
                row.classList.add('foh-red');
                addBadge(row, offH, 'red', member);
            } else if (offH >= halfThreshold) {
                row.style.background  = COLOR_ORANGE;
                row.style.borderLeft  = BORDER_ORANGE;
                row.classList.add('foh-orange');
                addBadge(row, offH, 'orange', member);
            } else {
                row.classList.add('foh-ok');
                removeBadge(row);
            }
        }
        // Save original order before first sort, then sort or restore
        saveOriginalOrder();
        if (sortEnabled) {
            sortMemberRows(memberMap);
        } else {
            restoreOriginalOrder();
        }

        isHighlighting = false;
    }

    // ─── DOM sorting ─────────────────────────────────────────
    const CONTAINER_SEL =
        'ul.members-list, ' +
        '.members-list .table-body, ' +
        '.faction-info-members .table-body, ' +
        '.member-list, ' +
        '.members-cont .table-body';

    // WeakMap stores the original child order per container
    const originalOrder = new WeakMap();

    function saveOriginalOrder() {
        document.querySelectorAll(CONTAINER_SEL).forEach(container => {
            if (originalOrder.has(container)) return; // already saved
            const rows = Array.from(container.children).filter(el =>
                el.tagName === 'LI' || el.tagName === 'TR' || el.tagName === 'DIV'
            );
            if (rows.length > 1) originalOrder.set(container, rows.slice());
        });
    }

    function restoreOriginalOrder() {
        document.querySelectorAll(CONTAINER_SEL).forEach(container => {
            const saved = originalOrder.get(container);
            if (!saved) return;
            saved.forEach(row => container.appendChild(row));
        });
    }

    function sortMemberRows(memberMap) {
        document.querySelectorAll(CONTAINER_SEL).forEach(container => {
            const rows = Array.from(container.children).filter(el =>
                el.tagName === 'LI' || el.tagName === 'TR' || el.tagName === 'DIV'
            );
            if (rows.length < 2) return;

            const rowData = rows.map(row => {
                const link = row.querySelector('a[href*="XID="]');
                let ts = Infinity;
                if (link) {
                    const match = link.href.match(/XID=(\d+)/i);
                    if (match && memberMap[match[1]]) {
                        const m = memberMap[match[1]];
                        if (m.last_action && m.last_action.timestamp) {
                            ts = m.last_action.timestamp;
                        }
                    }
                }
                return { row, ts };
            });

            // Sort ascending by timestamp = oldest (least active) first
            rowData.sort((a, b) => a.ts - b.ts);

            // Re-append in sorted order
            rowData.forEach(({ row }) => container.appendChild(row));
        });
    }

    function addBadge(row, offH, colour, member) {
        // Remove any existing badge on this row first
        const existing = row.querySelector('.foh-badge');
        if (existing) existing.remove();

        const badge = document.createElement('div');
        badge.className = 'foh-badge';

        const bg = colour === 'red' ? '#dc3232' : '#e69500';
        const label = `Last Action: ${formatDuration(offH)}`;
        const lastActive = member.last_action.relative || (formatDuration(offH) + ' ago');

        // Position as an overlay bar at the bottom of the row
        // The row needs position:relative so the badge can be positioned inside it
        row.style.position = 'relative';
        row.style.overflow = 'visible';

        badge.style.cssText =
            'position:absolute;bottom:0;left:0;right:0;z-index:10;' +
            'padding:1px 8px;font-size:10px;font-weight:700;' +
            'white-space:nowrap;letter-spacing:0.3px;' +
            'pointer-events:none;text-align:center;';
        badge.style.background = bg;
        badge.style.color = '#fff';
        badge.textContent = label;
        badge.title = `Last active: ${lastActive}`;

        row.appendChild(badge);
    }

    function removeBadge(row) {
        const badge = row.querySelector('.foh-badge');
        if (badge) badge.remove();
        row.style.removeProperty('position');
    }

    // ─── Settings gear + panel ─────────────────────────────────
    function injectSettingsGear() {
        if (document.getElementById('foh-settings-gear')) return;

        const gear = document.createElement('div');
        gear.id = 'foh-settings-gear';
        gear.innerHTML = '⚙';
        gear.title     = 'Offline Highlighter Settings';
        gear.style.cssText =
            'position:fixed;bottom:80px;right:14px;z-index:100000;cursor:pointer;' +
            'font-size:22px;background:#333;color:#ccc;width:34px;height:34px;' +
            'border-radius:50%;display:flex;align-items:center;justify-content:center;' +
            'box-shadow:0 2px 6px rgba(0,0,0,.4);user-select:none;';

        gear.addEventListener('click', () => openSettingsPanel());
        document.body.appendChild(gear);
    }

    function openSettingsPanel() {
        // Toggle: remove if already open
        const existing = document.getElementById('foh-settings-panel');
        if (existing) { existing.remove(); return; }

        const panel = document.createElement('div');
        panel.id = 'foh-settings-panel';
        panel.style.cssText =
            'position:fixed;bottom:120px;right:14px;z-index:100001;' +
            'background:#1a1a2e;color:#e0e0e0;padding:14px 16px;border-radius:10px;' +
            'font-size:13px;line-height:1.6;box-shadow:0 4px 16px rgba(0,0,0,.6);' +
            'width:260px;font-family:Arial,sans-serif;';

        const curHours = getThresholdHours();
        const curKey   = inPDA ? '' : getStoredApiKey();
        const masked   = inPDA ? 'Using PDA Key' : (curKey ? curKey.slice(0, 4) + '****' + curKey.slice(-4) : 'Not set');

        panel.innerHTML =
            '<div style="font-weight:700;font-size:14px;color:#ffb03b;margin-bottom:10px;">Offline Highlighter Settings</div>' +

            // API Key section
            (inPDA
                ? '<div style="margin-bottom:10px;font-size:11px;color:#4caf50;">API: Using PDA Key</div>'
                : '<div style="margin-bottom:10px;">' +
                    '<label style="font-size:11px;color:#aaa;display:block;margin-bottom:3px;">API Key</label>' +
                    '<input id="foh-api-input" type="password" placeholder="Enter Torn API key" ' +
                        'value="' + (curKey || '') + '" ' +
                        'style="width:100%;box-sizing:border-box;background:#111;border:1px solid #444;color:#fff;padding:5px 8px;' +
                        'border-radius:5px;font-size:12px;font-family:monospace;">' +
                    '<div id="foh-api-status" style="font-size:10px;color:#888;margin-top:3px;">' + masked + '</div>' +
                  '</div>'
            ) +

            // Threshold section
            '<div style="margin-bottom:10px;">' +
                '<label style="font-size:11px;color:#aaa;display:block;margin-bottom:3px;">Offline Threshold (hours)</label>' +
                '<div style="display:flex;gap:6px;align-items:center;">' +
                    '<input id="foh-hours-input" type="number" min="1" value="' + curHours + '" ' +
                        'style="width:70px;background:#111;border:1px solid #444;color:#fff;padding:5px 8px;' +
                        'border-radius:5px;font-size:12px;text-align:center;">' +
                    '<span style="font-size:10px;color:#888;">RED after this, ORANGE after half</span>' +
                '</div>' +
            '</div>' +

            // Buttons
            '<div style="display:flex;gap:8px;margin-top:12px;">' +
                '<button id="foh-save-all" style="flex:1;background:#4caf50;color:#fff;border:none;' +
                    'padding:7px;border-radius:5px;cursor:pointer;font-size:12px;font-weight:700;">Save & Refresh</button>' +
                '<button id="foh-close-panel" style="background:#555;color:#ccc;border:none;' +
                    'padding:7px 14px;border-radius:5px;cursor:pointer;font-size:12px;">Close</button>' +
            '</div>';

        document.body.appendChild(panel);

        // Save & Refresh
        document.getElementById('foh-save-all').addEventListener('click', () => {
            // Save API key if on desktop
            if (!inPDA) {
                const inp = document.getElementById('foh-api-input');
                if (inp) {
                    const val = inp.value.trim();
                    if (val) {
                        setStoredApiKey(val);
                        apiKey = val;
                    }
                }
            }
            // Save threshold
            const hInp = document.getElementById('foh-hours-input');
            const hVal = parseInt(hInp.value, 10);
            if (hVal > 0) setThresholdHours(hVal);

            panel.remove();
            refresh();
        });

        document.getElementById('foh-close-panel').addEventListener('click', () => panel.remove());
    }

    // ─── Sort toggle button ──────────────────────────────────
    function injectSortToggle() {
        if (document.getElementById('foh-sort-toggle')) return;

        const btn = document.createElement('div');
        btn.id = 'foh-sort-toggle';
        btn.title = 'Toggle activity sort';
        btn.style.cssText =
            'position:fixed;bottom:80px;right:56px;z-index:100000;cursor:pointer;' +
            'font-size:12px;background:#333;color:#ccc;height:34px;' +
            'border-radius:17px;display:flex;align-items:center;justify-content:center;' +
            'box-shadow:0 2px 6px rgba(0,0,0,.4);user-select:none;padding:0 12px;' +
            'font-family:Arial,sans-serif;font-weight:700;white-space:nowrap;';

        function updateLabel() {
            if (sortEnabled) {
                btn.innerHTML = '↑ Least Active';
                btn.style.background = '#2a4a2a';
                btn.style.color = '#4caf50';
            } else {
                btn.innerHTML = '⇵ Default';
                btn.style.background = '#333';
                btn.style.color = '#ccc';
            }
        }

        sortEnabled = getSortEnabled();
        updateLabel();

        btn.addEventListener('click', () => {
            setSortEnabled(!sortEnabled);
            updateLabel();
            refresh();
        });

        document.body.appendChild(btn);
    }

    // ─── Main refresh cycle ──────────────────────────────────
    // Load stored key on desktop (no prompt - user sets via gear)
    if (!inPDA) {
        const stored = getStoredApiKey();
        if (stored) apiKey = stored;
    }

    async function refresh() {
        try {
            const data = await fetchMembers(apiKey);

            if (data.error) {
                console.error('[FOH] API error:', data.error);
                return;
            }

            // v2 returns { members: [ { id, name, last_action: { status, timestamp, relative } }, ... ] }
            // v1 returns { members: { "id": { ... }, ... } }
            let members;
            if (Array.isArray(data.members)) {
                members = data.members;
            } else if (data.members && typeof data.members === 'object') {
                members = Object.entries(data.members).map(([id, m]) => ({ id: parseInt(id), ...m }));
            } else {
                console.warn('[FOH] Unexpected members format', data);
                return;
            }

            memberCache = members;
            const thresholdH = getThresholdHours();
            highlightMembers(members, thresholdH);
        } catch (err) {
            console.error('[FOH] Fetch error:', err);
        }
    }

    // ─── OC page detection ───────────────────────────────────
    function onCrimesTab() {
        const hash = window.location.hash || '';
        const url = window.location.href;
        return url.includes('factions.php') &&
            (hash.includes('tab=crimes') || hash.includes('tab=crime') ||
             document.querySelector('[class*="crimes-app"]') !== null ||
             document.querySelector('[class*="scenario"]') !== null);
    }

    let ocDataFetched = false;

    async function checkOCPanel() {
        // Only run if the not-participating panel exists (quick DOM check, not full innerText scan)
        const panel = findNotParticipatingPanel();
        if (!panel) return;

        if (!ocDataFetched) {
            await buildLastOCMap();
            ocDataFetched = true;
        }
        annotateNotParticipating();
    }

    // ─── Observe DOM changes (Torn loads content dynamically) ─
    function init() {
        injectSettingsGear();
        injectSortToggle();

        // Only show controls + run on member list tab
        function checkTab() {
            if (onMemberListTab()) {
                showControls();
                refresh();
            } else {
                hideControls();
            }
            // Also check for OC panel on any faction page
            checkOCPanel();
        }

        checkTab();
        setInterval(checkTab, REFRESH_MS);

        // Re-check when navigating between tabs
        window.addEventListener('hashchange', () => {
            setTimeout(checkTab, 300);
        });

        // Re-highlight when Torn dynamically reloads member list
        // Uses a debounce + flag so our own DOM edits don't trigger a loop
        let ocDebounceTimer = null;
        const observer = new MutationObserver((mutations) => {
            // Ignore mutations caused by our own elements
            const dominated = mutations.every(m =>
                m.target.closest && (
                    m.target.closest('#foh-settings-gear') ||
                    m.target.closest('#foh-settings-panel') ||
                    m.target.closest('#foh-sort-toggle') ||
                    m.target.classList?.contains('foh-badge') ||
                    m.target.classList?.contains('foh-red') ||
                    m.target.classList?.contains('foh-orange') ||
                    m.target.classList?.contains('foh-ok') ||
                    m.target.classList?.contains('foh-oc-badge')
                )
            );
            if (dominated) return;

            // Member list highlighting
            if (!isHighlighting && memberCache && onMemberListTab()) {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    const thresholdH = getThresholdHours();
                    highlightMembers(memberCache, thresholdH);
                }, 500);
            }

            // OC panel: debounce check when DOM changes
            clearTimeout(ocDebounceTimer);
            ocDebounceTimer = setTimeout(() => checkOCPanel(), 800);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        window.addEventListener('DOMContentLoaded', init);
    }
})();
