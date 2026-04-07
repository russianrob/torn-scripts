// ==UserScript==
// @name         Torn Faction Offline Highlighter
// @namespace    torn.faction.offline.highlight
// @version      1.9.3
// @description  Highlights faction members red who have been offline for over 24 hours on the faction member list. Shows OC inactivity badges in chat globally. Configurable threshold. PDA compatible.
// @author       RussianRob
// @match        https://www.torn.com/*
// @run-at       document-end
// @downloadURL  https://tornwar.com/scripts/torn-faction-offline-highlight.user.js
// @updateURL    https://tornwar.com/scripts/torn-faction-offline-highlight.meta.js
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      api.torn.com
// ==/UserScript==

// =============================================================================
// CHANGELOG
// =============================================================================
// v1.9.3  - Fix: OC badge showing twice in chat (avatar + name links)
// v1.9.2  - Update URLs to tornwar.com hosting
// v1.9.1  - Fix: highlighting bleeding onto armory/controls pages
// v1.9.0  - Fix: new members (<72h) incorrectly getting [OC: Never] badges
// v1.8.0  - General improvements and fixes
// v1.7.0  - Fix: gear/sort controls showing on non-faction pages
// v1.6.1  - Restrict gear icon and sort toggle to member list tab only
// v1.6.0  - Added OC inactivity tracker on not-participating panel
//           - Fix: chat leak
// v1.5.2  - API key masked with asterisks
// v1.5.1  - Initial public release
// =============================================================================

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

    function fetchAvailableCrimes(apiKey) {
        return apiFetch(`${API_BASE}/v2/faction/crimes?cat=available&key=${apiKey}`);
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
    let notParticipatingIDs = new Set();  // IDs of members not in any active OC
    let allFactionMemberIDs = new Set();  // all faction member IDs
    let newMemberIDs = new Set();  // IDs of members who joined < 3 days ago (72h OC cooldown)

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

    async function buildNotParticipatingIDs() {
        const key = getApiKey();
        if (!key) return;
        try {
            // Fetch faction members and active OCs in parallel
            const [membersData, crimesData] = await Promise.all([
                fetchMembers(key),
                fetchAvailableCrimes(key)
            ]);

            if (membersData.error) {
                console.error('[FOH] Members API error:', membersData.error);
                return;
            }

            // Build set of all faction member IDs and identify new members
            allFactionMemberIDs = new Set();
            newMemberIDs = new Set();
            let members;
            if (Array.isArray(membersData.members)) {
                members = membersData.members;
            } else if (membersData.members && typeof membersData.members === 'object') {
                members = Object.entries(membersData.members).map(([id, m]) => ({ id: parseInt(id), ...m }));
            } else {
                return;
            }
            for (const m of members) {
                if (!m.id) continue;
                const id = String(m.id);
                allFactionMemberIDs.add(id);
                // Members with < 3 days in faction can't join OCs (72h cooldown)
                if (m.days_in_faction != null && m.days_in_faction < 3) {
                    newMemberIDs.add(id);
                }
            }

            // Build set of member IDs in active OCs
            const inActiveOC = new Set();
            if (!crimesData.error) {
                const crimes = crimesData.crimes || [];
                for (const crime of crimes) {
                    if (!crime.slots) continue;
                    for (const slot of crime.slots) {
                        const uid = slot.user && (slot.user.id || slot.user.user_id);
                        if (uid) inActiveOC.add(String(uid));
                    }
                }
            }

            // Not participating = faction members NOT in any active OC
            // Exclude new members (< 3 days) who can't join OCs yet
            notParticipatingIDs = new Set();
            for (const id of allFactionMemberIDs) {
                if (!inActiveOC.has(id) && !newMemberIDs.has(id)) {
                    notParticipatingIDs.add(id);
                }
            }

            console.log(`[FOH] ${notParticipatingIDs.size} members not in active OCs, ${inActiveOC.size} in active OCs, ${newMemberIDs.size} new members (< 72h)`);
        } catch (err) {
            console.error('[FOH] Failed to build not-participating list:', err);
        }
    }

    // Returns { panel, links } where links are ONLY the non-participating member links
    function findNotParticipatingMembers() {
        // Use a TreeWalker to find the element that directly contains
        // "aren't participating in any scenarios" text
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode(node) {
                    // Skip chat areas entirely
                    if (node.closest && (node.closest('[class*="chat" i]') || node.closest('[id*="chat" i]'))) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        let headerEl = null;
        while (walker.nextNode()) {
            const el = walker.currentNode;
            // Check if this element's own text (not deep children) contains the phrase
            for (const child of el.childNodes) {
                if (child.nodeType === 3 && child.textContent.includes("aren't participating")) {
                    headerEl = el;
                    break;
                }
            }
            if (headerEl) break;
        }

        if (!headerEl) return null;

        // Now collect XID links that come AFTER this header in the DOM.
        // Walk siblings and their descendants until we hit another section header
        // or run out of siblings.
        const npLinks = [];
        let sibling = headerEl.nextElementSibling;

        // If no next sibling, try going up one level
        if (!sibling && headerEl.parentElement) {
            sibling = headerEl.parentElement.nextElementSibling;
        }

        // Collect all members from sibling containers
        while (sibling) {
            // Stop if we hit another scenario/section header
            const sibText = sibling.textContent || '';
            if (sibText.includes('scenario') && !sibText.includes("aren't participating")) {
                // Could be another section, check if it has its own header-like content
                const hasHeader = sibling.querySelector('h4, h5, [class*="header"], [class*="title"]');
                if (hasHeader) break;
            }

            const links = sibling.querySelectorAll('a[href*="XID="]');
            links.forEach(l => npLinks.push(l));

            sibling = sibling.nextElementSibling;
        }

        // If we found no links via siblings, the members might be children of the same parent
        // In that case, scan the header's parent for XID links that appear after the header
        if (npLinks.length === 0 && headerEl.parentElement) {
            const parent = headerEl.parentElement;
            const allLinks = parent.querySelectorAll('a[href*="XID="]');
            allLinks.forEach(link => {
                if (headerEl.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING) {
                    npLinks.push(link);
                }
            });
            return npLinks.length > 0 ? { panel: parent, links: npLinks } : null;
        }

        return npLinks.length > 0 ? { panel: headerEl.parentElement || headerEl, links: npLinks } : null;
    }

    function annotateNotParticipating() {
        const result = findNotParticipatingMembers();
        if (!result) return;
        const { panel, links } = result;

        // Remove any "Last Action" badges from the offline highlighter on this panel
        panel.querySelectorAll('.foh-badge').forEach(b => b.remove());
        // Remove highlighting styles from cards in this panel
        panel.querySelectorAll('.foh-red, .foh-orange, .foh-ok').forEach(el => {
            el.classList.remove('foh-red', 'foh-orange', 'foh-ok');
            el.style.removeProperty('background');
            el.style.removeProperty('border-left');
        });

        if (Object.keys(lastOCMap).length === 0) return;

        // Annotate links on the panel with OC badges
        // notParticipatingIDs is already built from the API by buildNotParticipatingIDs()
        links.forEach(link => {
            const match = link.href.match(/XID=(\d+)/i);
            if (!match) return;
            const id = match[1];

            // Skip new members who can't join OCs yet (< 72h cooldown)
            if (newMemberIDs.has(id)) return;

            // Find the member's card/container
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
                badge.title = `${ocInfo.crimeName} - ${new Date(ocInfo.timestamp * 1000).toLocaleDateString()}`;
                if (hrsAgo > 168) {
                    badge.style.color = '#ff4444';
                } else if (hrsAgo > 72) {
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

    // ─── Chat OC badges ──────────────────────────────────
    function annotateChatMessages() {
        if (Object.keys(lastOCMap).length === 0 || notParticipatingIDs.size === 0) return;

        // Cache the OC panel reference outside the loop (only on faction page)
        let ocPanelEl = null;
        if (onFactionPage()) {
            const npRef = findNotParticipatingMembers();
            ocPanelEl = npRef ? npRef.panel : null;
        }

        // Only scan links inside chat containers for speed
        const chatAreas = document.querySelectorAll('[class*="chat" i], [id*="chat" i]');
        if (chatAreas.length === 0) return;

        const allLinks = [];
        chatAreas.forEach(area => {
            area.querySelectorAll('a[href*="XID="]').forEach(l => allLinks.push(l));
        });

        allLinks.forEach(link => {
            const match = link.href.match(/XID=(\d+)/i);
            if (!match) return;
            const id = match[1];

            // Skip new members who can't join OCs yet (< 72h cooldown)
            if (newMemberIDs.has(id)) return;

            // Only annotate members who aren't participating in any OC
            if (!notParticipatingIDs.has(id)) return;

            // Skip avatar/image links — only annotate the plain text name link
            if (link.querySelector('img')) return;

            // Skip already-processed links (guard against multiple links with same XID)
            if (link.dataset.fohChatDone) return;
            link.dataset.fohChatDone = '1';

            // Make sure this isn't in the OC panel (only relevant on faction page)
            if (ocPanelEl && ocPanelEl.contains(link)) return;

            // Find the message container for this link
            const msg = link.closest('[class*="message" i]') || link.closest('[class*="msg" i]') ||
                        link.closest('li') || link.parentElement;
            if (!msg) return;

            // Don't add duplicate badges
            if (msg.querySelector('.foh-chat-oc')) return;

            const badge = document.createElement('span');
            badge.className = 'foh-chat-oc';

            const ocInfo = lastOCMap[id];
            if (ocInfo) {
                const hrsAgo = hoursAgo(ocInfo.timestamp);
                const timeStr = formatDuration(hrsAgo);
                badge.textContent = ` [OC: ${timeStr} ago]`;
                badge.title = `${ocInfo.crimeName} - ${new Date(ocInfo.timestamp * 1000).toLocaleDateString()}`;
                if (hrsAgo > 168) {
                    badge.style.color = '#ff4444';
                } else if (hrsAgo > 72) {
                    badge.style.color = '#ffa500';
                } else {
                    badge.style.color = '#4caf50';
                }
            } else {
                badge.textContent = ' [OC: Never]';
                badge.title = 'No completed OC found in recent history';
                badge.style.color = '#ff4444';
            }

            badge.style.cssText += ';font-size:9px;font-weight:700;' +
                'letter-spacing:0.3px;';

            // Insert right after the username link (inline)
            if (link.nextSibling) {
                link.parentElement.insertBefore(badge, link.nextSibling);
            } else {
                link.parentElement.appendChild(badge);
            }
        });
    }

    // ─── Tab detection ───────────────────────────────────────
    function onMemberListTab() {
        // Check URL hash for member-related tabs
        const hash = window.location.hash || '';
        const url = window.location.href;
        const isYourFaction = url.includes('step=your');
        if (!isYourFaction) return false;
        // Exclude known non-member tabs (armory, controls, crimes, etc.)
        if (hash.includes('tab=armoury') || hash.includes('tab=armory') ||
            hash.includes('tab=controls') || hash.includes('tab=crimes') ||
            hash.includes('tab=wars') || hash.includes('tab=chain')) {
            return false;
        }
        // Member list tab: #/tab=info or no hash
        const isInfoTab = hash.includes('tab=info') || hash === '' || hash === '#' || hash === '#/';
        return isInfoTab;
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
        // Find the not-participating panel so we can exclude its links
        const npResult = findNotParticipatingMembers();
        const ocPanel = npResult ? npResult.panel : null;
        const allLinks = document.querySelectorAll('a[href*="profiles.php?XID="], a[href*="XID="]');
        const linkMap  = {};
        allLinks.forEach(a => {
            // Skip links inside the OC not-participating panel
            if (ocPanel && ocPanel.contains(a)) return;
            // Skip links inside chat containers
            if (a.closest('[class*="chat"]') || a.closest('[class*="Chat"]')) return;
            // Skip links inside armory/armoury containers
            if (a.closest('[class*="armory"]') || a.closest('[class*="armoury"]') ||
                a.closest('[class*="inventory"]') || a.closest('[class*="item"]')) return;
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
            'border-radius:50%;display:none;align-items:center;justify-content:center;' +
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
            'border-radius:17px;display:none;align-items:center;justify-content:center;' +
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

    async function fetchOCData() {
        if (ocDataFetched) return;
        const key = getApiKey();
        if (!key) return;
        // Fetch completed OC history and active OC participation in parallel
        await Promise.all([
            buildLastOCMap(),
            buildNotParticipatingIDs()
        ]);
        ocDataFetched = true;
    }

    async function checkOCPanel() {
        // Annotate the not-participating panel (only works on the OC page)
        const npResult = findNotParticipatingMembers();
        if (npResult) {
            await fetchOCData();
            annotateNotParticipating();
        }
    }

    async function checkChatMessages() {
        await fetchOCData();
        annotateChatMessages();
    }

    // ─── Check if on faction page ────────────────────────────
    function onFactionPage() {
        return window.location.href.includes('factions.php');
    }

    // ─── Observe DOM changes (Torn loads content dynamically) ─
    function init() {
        // Inject controls (both start hidden via display:none)
        injectSettingsGear();
        injectSortToggle();

        // Chat OC badges run globally on any torn.com page
        checkChatMessages();

        // Faction-specific features
        function checkTab() {
            if (!onFactionPage()) return;
            if (onMemberListTab()) {
                showControls();
                refresh();
            } else {
                hideControls();
            }
            // Check for OC panel on faction page
            checkOCPanel();
        }

        if (onFactionPage()) {
            checkTab();
            setInterval(checkTab, REFRESH_MS);

            window.addEventListener('hashchange', () => {
                setTimeout(checkTab, 300);
            });
        }

        // Re-highlight when Torn dynamically reloads content
        let ocDebounceTimer = null;
        let chatDebounceTimer = null;
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
                    m.target.classList?.contains('foh-oc-badge') ||
                    m.target.classList?.contains('foh-chat-oc')
                )
            );
            if (dominated) return;

            // Member list highlighting (faction page only)
            if (onFactionPage() && !isHighlighting && memberCache && onMemberListTab()) {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    const thresholdH = getThresholdHours();
                    highlightMembers(memberCache, thresholdH);
                }, 500);
            }

            // OC panel: debounce check when DOM changes (faction page only)
            if (onFactionPage()) {
                clearTimeout(ocDebounceTimer);
                ocDebounceTimer = setTimeout(() => checkOCPanel(), 800);
            }

            // Chat badges: fast debounce on any page (150ms so scrolling feels instant)
            clearTimeout(chatDebounceTimer);
            chatDebounceTimer = setTimeout(() => annotateChatMessages(), 150);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        window.addEventListener('DOMContentLoaded', init);
    }
})();
