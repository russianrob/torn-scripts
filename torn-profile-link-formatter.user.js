// ==UserScript==
// @name         Torn Profile Link Formatter
// @namespace    GNSC4 [268863]
// @version      3.6.1
// @description  Copy formatted Torn profile/faction links. Uses BSP prediction TBS when available, falls back to FF Scouter V2 estimated stats. Strips BSP TBS prefixes from copied names, dedupes lines by ID, and uses war JSON faction IDs so your faction (Dead Fragment 42055) is always separated from the enemy in ranked wars. Faction copy includes member level and Xanax taken (via API or Xanax Viewer cache).
// @author       GNSC4
// @match        https://www.torn.com/profiles.php?XID=*
// @match        https://www.torn.com/factions.php*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      api.torn.com
// @downloadURL  https://tornwar.com/scripts/torn-profile-link-formatter.user.js
// @updateURL    https://tornwar.com/scripts/torn-profile-link-formatter.meta.js
// ==/UserScript==

// =============================================================================
// CHANGELOG
// =============================================================================
// v3.6.1  - Update URLs to tornwar.com hosting
// v3.6.0  - BSP prediction TBS with FF Scouter V2 fallback
//           - Strip BSP TBS prefixes from copied names
//           - Dedupe lines by ID
//           - War JSON faction IDs (Dead Fragment 42055 separated from enemy)
//           - Faction copy includes member level and Xanax taken
// =============================================================================

(function() {
    'use strict';

    // Your faction (Dead Fragment)
    const MY_FACTION_ID = '42055';

    function getApiKey() {
        return GNSC_getValue('tornProfileFormatterApiKey', null);
    }

    let hospTime = {};
    let warMemberFaction = {}; // userID -> factionID from war JSON
    let warMemberLevel = {};  // userID -> level from war JSON
    const debug = true;

    const GNSC_setValue = typeof GM_setValue !== 'undefined'
        ? GM_setValue
        : (key, value) => localStorage.setItem(key, JSON.stringify(value));
    const GNSC_getValue = typeof GM_getValue !== 'undefined'
        ? GM_getValue
        : (key, def) => {
            const raw = localStorage.getItem(key);
            if (!raw) return def;
            try { return JSON.parse(raw); } catch { return def; }
        };

    if (typeof GM_addStyle !== 'undefined') {
        GM_addStyle(`
            .gnsc-copy-container { display: inline-flex; align-items: center; vertical-align: middle; gap: 5px; margin-left: 10px; }
            .gnsc-btn { background-color: #333; color: #DDD; border: 1px solid #555; border-radius: 5px; padding: 3px 8px; text-decoration: none; font-size: 12px; line-height: 1.5; font-weight: bold; cursor: pointer; white-space: nowrap; }
            .gnsc-btn:hover { background-color: #444; }
            .gnsc-list-btn { margin-left: 5px; cursor: pointer; font-size: 14px; display: inline-block; vertical-align: middle; width: 18px; text-align: center; }
            .gnsc-faction-copy-btn { margin-left: 8px; cursor: pointer; font-size: 14px; vertical-align: middle; }
            .gnsc-settings-panel { display: none; position: absolute; background-color: #2c2c2c; border: 1px solid #555; border-radius: 5px; padding: 10px; z-index: 1000; top: 100%; left: 0; min-width: 220px; }
            .gnsc-settings-panel div { margin-bottom: 5px; display: flex; align-items: center; }
            .gnsc-settings-panel label { color: #DDD; flex-grow: 1; }
            .gnsc-settings-panel input[type="checkbox"] { margin-left: 5px; }
            .gnsc-settings-panel label.disabled { color: #888; }
            .gnsc-settings-container { position: relative; }
            .buttons-list .gnsc-list-btn { padding: 4px; font-size: 16px; height: 34px; line-height: 26px; }
            #gnsc-battlestats-format-wrapper { flex-direction: column; align-items: flex-start; margin-top: 8px; }
            #gnsc-battlestats-format-wrapper label { margin-bottom: 4px; }
            #gnsc-select-battlestats-format { background-color: #1e1e1e; border: 1px solid #555; color: #ddd; border-radius: 3px; padding: 2px 4px; width: 100%; }
            #gnsc-apikey-wrapper { flex-direction: column; align-items: flex-start; margin-top: 8px; border-top: 1px solid #444; padding-top: 8px; }
            #gnsc-apikey-wrapper label { margin-bottom: 4px; font-size: 11px; }
            #gnsc-input-apikey { background-color: #1e1e1e; border: 1px solid #555; color: #ddd; border-radius: 3px; padding: 4px 6px; width: 100%; font-size: 11px; box-sizing: border-box; }
        `);
    }

    function initProfilePage() {
        const nameElement = document.querySelector('#skip-to-content');
        const infoTable = document.querySelector('.basic-information .info-table');
        const alreadyInjected = document.querySelector('.gnsc-copy-container');
        if (nameElement && infoTable && infoTable.children.length > 5 && !alreadyInjected) {
            mainProfile(nameElement, infoTable);
            return true;
        }
        return false;
    }

    function initFactionPage() {
        const memberLists = document.querySelectorAll('.members-list, .enemy-list, .your-faction');
        if (memberLists.length > 0) {
            memberLists.forEach(list => injectButtonsIntoList(list));
            return true;
        }
        return false;
    }

    function initRankedWarPage() {
        const factionNames = document.querySelectorAll('.faction-names .name___PlMCO');
        factionNames.forEach(nameDiv => {
            if (!nameDiv.querySelector('.gnsc-faction-copy-btn')) {
                const button = document.createElement('span');
                button.className = 'gnsc-faction-copy-btn';
                button.textContent = '📋';
                button.title = 'Copy Faction Member List (BSP/FF cache)';
                button.addEventListener('click', (e) =>
                    handleFactionCopyClick(e, button, nameDiv.classList.contains('left'))
                );
                const textNode = nameDiv.querySelector('.text___chra_') || nameDiv;
                textNode.appendChild(button);
            }
        });
    }

    function initMiniProfile() {
        const miniProfile = document.querySelector('.profile-mini-_wrapper___Arw8R:not(.gnsc-injected), .mini-profile-wrapper:not(.gnsc-injected)');
        if (miniProfile) {
            miniProfile.classList.add('gnsc-injected');
            let attempts = 0;
            const maxAttempts = 25;
            const interval = setInterval(() => {
                const buttonContainer = miniProfile.querySelector('.buttons-list');
                const nameLink = miniProfile.querySelector('a[href*="profiles.php?XID="]');
                if (buttonContainer && nameLink && !buttonContainer.querySelector('.gnsc-list-btn')) {
                    clearInterval(interval);
                    const button = document.createElement('span');
                    button.className = 'gnsc-list-btn';
                    button.textContent = '📄';
                    button.title = 'Copy Formatted Link';
                    button.addEventListener('click', (e) => handleListCopyClick(e, button, miniProfile));
                    buttonContainer.insertAdjacentElement('beforeend', button);
                } else if (attempts >= maxAttempts) {
                    clearInterval(interval);
                }
                attempts++;
            }, 200);
        }
    }

    function injectButtonsIntoList(listElement) {
        const members = listElement.querySelectorAll('li.member, li.table-row, li.enemy, li.your');
        members.forEach(member => {
            const nameLink = member.querySelector('a[href*="profiles.php"]');
            if (nameLink && !member.querySelector('.gnsc-list-btn')) {
                const button = document.createElement('span');
                button.className = 'gnsc-list-btn';
                button.textContent = '📄';
                button.title = 'Copy Formatted Link';
                button.addEventListener('click', (e) => handleListCopyClick(e, button, member));
                nameLink.insertAdjacentElement('afterend', button);
            }
        });
    }

    function mainProfile(nameElement, infoTable) {
        const urlParams = new URLSearchParams(window.location.search);
        const userId = urlParams.get('XID');
        if (!userId) return;

        const cleanedName = nameElement.textContent.replace("'s Profile", "").split(' [')[0].trim();
        let factionLinkEl = null;
        let companyLinkEl = null;
        let activityStatus = 'Offline';

        const infoListItems = infoTable.querySelectorAll('li');
        infoListItems.forEach(item => {
            const titleEl = item.querySelector('.user-information-section .bold');
            if (!titleEl) return;
            const title = titleEl.textContent.trim();
            if (title === 'Faction') factionLinkEl = item.querySelector('.user-info-value a');
            if (title === 'Job') companyLinkEl = item.querySelector('.user-info-value a');
        });

        const statusIconEl = document.querySelector('li[id^="icon1-profile-"], li[id^="icon2-profile-"], li[id^="icon62-profile-"]');
        if (statusIconEl) {
            if (statusIconEl.className.includes('-Online')) activityStatus = 'Online';
            else if (statusIconEl.className.includes('-Away')) activityStatus = 'Idle';
        }

        const statusDescEl = document.querySelector('.profile-status.hospital .main-desc');
        const isInHospital = !!statusDescEl;
        const hospitalTimeStr = isInHospital ? statusDescEl.textContent.trim().replace(/\s+/g, ' ') : null;

        const userInfo = {
            id: userId,
            name: cleanedName,
            profileUrl: `https://www.torn.com/profiles.php?XID=${userId}`,
            attackUrl: `https://www.torn.com/loader2.php?sid=getInAttack&user2ID=${userId}`,
            factionUrl: factionLinkEl ? factionLinkEl.href : null,
            companyUrl: companyLinkEl ? companyLinkEl.href : null,
            activityStatus: activityStatus,
            isInHospital: isInHospital,
            hospitalTimeStr: hospitalTimeStr
        };

        createUI(nameElement, userInfo);
    }

    function createUI(targetElement, userInfo) {
        const container = document.createElement('div');
        container.className = 'gnsc-copy-container';

        const copyButton = document.createElement('a');
        copyButton.href = "#";
        copyButton.className = 'gnsc-btn';
        copyButton.innerHTML = '<span>Copy</span>';
        copyButton.addEventListener('click', (e) => handleCopyClick(e, copyButton, userInfo));

        const settingsContainer = document.createElement('div');
        settingsContainer.className = 'gnsc-settings-container';

        const settingsButton = document.createElement('a');
        settingsButton.href = "#";
        settingsButton.className = 'gnsc-btn';
        settingsButton.innerHTML = '⚙️';

        const settingsPanel = createSettingsPanel(userInfo);
        settingsButton.addEventListener('click', (e) => {
            e.preventDefault();
            settingsPanel.style.display = settingsPanel.style.display === 'block' ? 'none' : 'block';
        });

        document.addEventListener('click', (e) => {
            if (!settingsContainer.contains(e.target)) {
                settingsPanel.style.display = 'none';
            }
        });

        settingsContainer.appendChild(settingsButton);
        settingsContainer.appendChild(settingsPanel);
        container.appendChild(copyButton);
        container.appendChild(settingsContainer);
        targetElement.insertAdjacentElement('afterend', container);
    }

    function createSettingsPanel(userInfo) {
        const panel = document.createElement('div');
        panel.className = 'gnsc-settings-panel';
        const settings = loadSettings();

        const options = [
            { key: 'attack',       label: 'Attack',                      available: true },
            { key: 'activity',     label: 'Activity Status',             available: true },
            { key: 'faction',      label: 'Faction',                     available: !!userInfo.factionUrl },
            { key: 'company',      label: 'Company',                     available: !!userInfo.companyUrl },
            { key: 'timeRemaining',label: 'Time Remaining',              available: userInfo.isInHospital },
            { key: 'releaseTime',  label: 'Release Time (TCT)',          available: userInfo.isInHospital },
            { key: 'battlestats',  label: 'Battle Stats / Stats (BSP/FF)',  available: true }
        ];

        options.forEach(option => {
            const wrapper = document.createElement('div');
            const checkbox = document.createElement('input');
            const label = document.createElement('label');

            checkbox.type = 'checkbox';
            checkbox.id = `gnsc-check-${option.key}`;
            checkbox.checked = option.available && settings[option.key];
            checkbox.disabled = !option.available;
            checkbox.addEventListener('change', () => {
                if (option.key === 'battlestats') {
                    updateBattleStatsAvailability();
                }
                saveSettings();
            });

            label.htmlFor = `gnsc-check-${option.key}`;
            label.textContent = option.label;
            if (!option.available) label.classList.add('disabled');

            wrapper.appendChild(label);
            wrapper.appendChild(checkbox);
            panel.appendChild(wrapper);
        });

        const formatWrapper = document.createElement('div');
        formatWrapper.id = 'gnsc-battlestats-format-wrapper';
        formatWrapper.style.display = 'none';

        const formatLabel = document.createElement('label');
        formatLabel.htmlFor = 'gnsc-select-battlestats-format';
        formatLabel.textContent = 'Stat Display Format (when spy/FF is available)';

        const formatSelect = document.createElement('select');
        formatSelect.id = 'gnsc-select-battlestats-format';
        formatSelect.innerHTML = `
            <option value="all">All Stats</option>
            <option value="highest">Highest Stat & Total</option>
            <option value="total">Total Only</option>
        `;
        formatSelect.value = settings.battleStatsFormat;
        formatSelect.addEventListener('change', saveSettings);

        formatWrapper.appendChild(formatLabel);
        formatWrapper.appendChild(formatSelect);
        panel.appendChild(formatWrapper);

        // API Key input
        const apiKeyWrapper = document.createElement('div');
        apiKeyWrapper.id = 'gnsc-apikey-wrapper';

        const apiKeyLabel = document.createElement('label');
        apiKeyLabel.htmlFor = 'gnsc-input-apikey';
        apiKeyLabel.textContent = 'API Key';

        const apiKeyInput = document.createElement('input');
        apiKeyInput.type = 'text';
        apiKeyInput.id = 'gnsc-input-apikey';
        apiKeyInput.placeholder = 'Enter API key...';
        apiKeyInput.value = getApiKey() || '';
        apiKeyInput.addEventListener('change', () => {
            const val = apiKeyInput.value.trim();
            GNSC_setValue('tornProfileFormatterApiKey', val || null);
        });

        apiKeyWrapper.appendChild(apiKeyLabel);
        apiKeyWrapper.appendChild(apiKeyInput);
        panel.appendChild(apiKeyWrapper);

        updateBattleStatsAvailability();
        return panel;
    }

    // --- Helpers ---

    function getXanaxViewerCache(userId) {
        try {
            const raw = localStorage.getItem('xanaxviewer_cache');
            if (!raw) return null;
            const cache = JSON.parse(raw);
            const entry = cache[userId] || cache[String(userId)];
            if (entry && typeof entry.xantaken !== 'undefined') {
                return entry.xantaken;
            }
            return null;
        } catch (e) {
            if (debug) console.error('GNSC getXanaxViewerCache error:', e);
            return null;
        }
    }

    // In-memory cache for API-fetched personal stats to avoid re-fetching
    const apiStatsCache = {};

    function fetchPersonalStatsFromApi(userId) {
        const apiKey = getApiKey();
        if (!apiKey) return Promise.resolve(null);

        // Return cached result if we already fetched this user
        if (apiStatsCache[userId] !== undefined) return Promise.resolve(apiStatsCache[userId]);

        return new Promise((resolve) => {
            const url = `https://api.torn.com/user/${userId}?selections=personalstats&key=${apiKey}&stat=xantaken,boostersused&comment=GNSC_LinkFormatter`;
            try {
                const handleResponse = (data) => {
                    if (data.error) {
                        if (debug) console.error('GNSC API error for', userId, data.error);
                        apiStatsCache[userId] = null;
                        resolve(null);
                        return;
                    }
                    const ps = data?.personalstats;
                    if (ps) {
                        apiStatsCache[userId] = {
                            xantaken: ps.xantaken ?? null,
                            boostersused: ps.boostersused ?? null
                        };
                    } else {
                        apiStatsCache[userId] = null;
                    }
                    resolve(apiStatsCache[userId]);
                };

                if (typeof GM_xmlhttpRequest !== 'undefined') {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: url,
                        onload: (response) => {
                            try {
                                handleResponse(JSON.parse(response.responseText));
                            } catch (e) {
                                if (debug) console.error('GNSC API parse error for', userId, e);
                                apiStatsCache[userId] = null;
                                resolve(null);
                            }
                        },
                        onerror: () => {
                            if (debug) console.error('GNSC API request failed for', userId);
                            apiStatsCache[userId] = null;
                            resolve(null);
                        }
                    });
                } else {
                    // Fallback: use fetch (works in PDA)
                    fetch(url)
                        .then(r => r.json())
                        .then(handleResponse)
                        .catch(() => {
                            apiStatsCache[userId] = null;
                            resolve(null);
                        });
                }
            } catch (e) {
                if (debug) console.error('GNSC fetchPersonalStatsFromApi error:', e);
                resolve(null);
            }
        });
    }

    async function getPersonalStats(userId) {
        // Try Xanax Viewer cache first for xanax (no API call needed)
        const xanCached = getXanaxViewerCache(userId);

        // If we have xanax from cache, still need API for boosters
        const apiStats = await fetchPersonalStatsFromApi(userId);

        return {
            xantaken: xanCached ?? apiStats?.xantaken ?? null,
            boostersused: apiStats?.boostersused ?? null
        };
    }

    function getMemberLevel(userId, row) {
        // Try war JSON cache first
        if (warMemberLevel[userId]) return warMemberLevel[userId];

        // Try DOM: look for level in the member row
        if (row) {
            const lvlEl = row.querySelector('[class*="level"], .lvl, .member-level, td.level');
            if (lvlEl) {
                const lvlMatch = lvlEl.textContent.match(/(\d+)/);
                if (lvlMatch) return parseInt(lvlMatch[1], 10);
            }
            // Also try finding level text pattern anywhere in the row
            const allText = row.textContent;
            const lvlPattern = allText.match(/(?:Lv|Lvl|Level)\s*(\d+)/i);
            if (lvlPattern) return parseInt(lvlPattern[1], 10);
        }
        return null;
    }

    function stripBspPrefix(name) {
        try {
            if (!name) return '';
            return name.replace(/^\s*\d+(\.\d+)?[KMBTQkmbtq]\s*/, '').trim();
        } catch (e) {
            if (debug) console.error('GNSC stripBspPrefix error for name:', name, e);
            return name || '';
        }
    }

    // --- BSP cache readers ---

    function fetchBspSpyFromLocalCache(userId) {
        try {
            const tornStatsKey = 'tdup.battleStatsPredictor.cache.spy_v2.tornstats_' + userId;
            const yataKey      = 'tdup.battleStatsPredictor.cache.spy_v2.yata_' + userId;

            const tornStatsRaw = localStorage.getItem(tornStatsKey);
            const yataRaw      = localStorage.getItem(yataKey);

            if (!tornStatsRaw && !yataRaw) return null;

            const tornSpy = tornStatsRaw ? JSON.parse(tornStatsRaw) : null;
            const yataSpy = yataRaw ? JSON.parse(yataRaw) : null;

            let best = null;
            if (tornSpy && yataSpy) {
                best = (yataSpy.timestamp >= tornSpy.timestamp) ? yataSpy : tornSpy;
            } else {
                best = tornSpy || yataSpy;
            }

            if (!best || typeof best.total === 'undefined') return null;

            return {
                spy: {
                    status: true,
                    strength: best.str,
                    defense: best.def,
                    speed: best.spd,
                    dexterity: best.dex,
                    total: best.total,
                    timestamp: best.timestamp
                }
            };
        } catch (e) {
            if (debug) console.error('Torn Profile Link Formatter: error reading BSP spy cache', e);
            return null;
        }
    }

    function fetchBspPredictionFromLocalCache(userId) {
        try {
            const key = 'tdup.battleStatsPredictor.cache.prediction.' + userId;
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const prediction = JSON.parse(raw);
            if (debug) console.log('GNSC BSP prediction cache for', userId, prediction);
            return prediction || null;
        } catch (e) {
            if (debug) console.error('Torn Profile Link Formatter: error reading BSP prediction cache', e);
            return null;
        }
    }

    // --- FF Scouter (V2) fallback via IndexedDB ---

    function getFfScouterEstimate(userId) {
        return new Promise((resolve) => {
            try {
                const request = window.indexedDB.open("ffscouter-cache", 1);

                request.onerror = () => {
                    if (debug) console.error("FF Scouter: failed to open IndexedDB");
                    resolve(null);
                };

                request.onsuccess = () => {
                    const db = request.result;
                    const tx = db.transaction("cache", "readonly");
                    const store = tx.objectStore("cache");
                    const getReq = store.get(parseInt(userId, 10));

                    getReq.onerror = () => {
                        if (debug) console.error("FF Scouter: error reading cache for", userId);
                        resolve(null);
                    };

                    getReq.onsuccess = () => {
                        const res = getReq.result;
                        if (!res || res.no_data || typeof res.bs_estimate === "undefined") {
                            resolve(null);
                        } else {
                            resolve({
                                total: res.bs_estimate,
                                human: res.bs_estimate_human || null,
                                timestamp: res.last_updated || null
                            });
                        }
                    };
                };
            } catch (e) {
                if (debug) console.error("FF Scouter: exception accessing cache", e);
                resolve(null);
            }
        });
    }

    function getBspPredictionOrFf(userId) {
        // Returns BSP prediction or FF scouter data, skipping spy data entirely
        const pred = fetchBspPredictionFromLocalCache(userId);
        if (pred && pred.TBS != null) {
            return { type: 'prediction', prediction: pred };
        }
        // FF scouter is async, handled separately
        return null;
    }



    // --- Handlers ---

    async function handleCopyClick(e, button, userInfo) {
        e.preventDefault();
        const settings = loadSettings();
        let statsStr = null;
        let hospitalStr = null;
        let statusEmoji = '';

        if (settings.activity) {
            statusEmoji = userInfo.activityStatus === 'Online'
                ? '🟢 '
                : (userInfo.activityStatus === 'Idle' ? '🟡 ' : '⚫ ');
        }

        const releaseTimestamp = hospTime[userInfo.id] || null;
        if (releaseTimestamp) {
            const timeParts = [];
            if (settings.timeRemaining) {
                const remainingSeconds = releaseTimestamp - (Date.now() / 1000);
                if (remainingSeconds > 0) {
                    timeParts.push(`In hospital for ${formatRemainingTime(remainingSeconds)}`);
                }
            }
            if (settings.releaseTime) {
                const releaseDate = new Date(releaseTimestamp * 1000);
                const tctTimeString = releaseDate.toLocaleTimeString([], {
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                    hour12: false, timeZone: 'UTC'
                });
                timeParts.push(`Out at ${tctTimeString} TCT`);
            }
            if (timeParts.length > 0) hospitalStr = `(${timeParts.join(' | ')})`;
        } else if (userInfo.hospitalTimeStr && settings.timeRemaining) {
            hospitalStr = `(${userInfo.hospitalTimeStr})`;
        }

        if (settings.battlestats) {
            try {
                // Skip spy data, use BSP prediction first, then FF Scouter
                const predOnly = getBspPredictionOrFf(userInfo.id);
                if (predOnly?.type === 'prediction' && predOnly.prediction) {
                    statsStr = formatPredictionString(predOnly.prediction);
                } else {
                    const ff = await getFfScouterEstimate(userInfo.id);
                    if (ff && ff.total != null) {
                        statsStr = formatFfScouterString(ff, settings.battleStatsFormat);
                    } else {
                        statsStr = "(Stats: N/A)";
                    }
                }
            } catch (err) {
                if (debug) console.error('Torn Profile Link Formatter: BSP/FF format error (profile)', userInfo.id, err);
                statsStr = "(Stats: Error)";
            }
        }

        const linkedName = `<a href="${userInfo.profileUrl}">${userInfo.name} [${userInfo.id}]</a>`;
        const details = [];
        if (settings.attack) details.push(`<a href="${userInfo.attackUrl}">Attack</a>`);
        if (settings.faction && userInfo.factionUrl) details.push(`<a href="${userInfo.factionUrl}">Faction</a>`);
        if (settings.company && userInfo.companyUrl) details.push(`<a href="${userInfo.companyUrl}">Company</a>`);
        if (hospitalStr) details.push(hospitalStr);
        if (statsStr) details.push(statsStr);

        copyToClipboard(
            details.length > 0
                ? `${statusEmoji}${linkedName} - ${details.join(' - ')}`
                : `${statusEmoji}${linkedName}`
        );

        button.innerHTML = '<span>Copied!</span>';
        button.style.backgroundColor = '#2a633a';
        setTimeout(() => {
            button.innerHTML = '<span>Copy</span>';
            button.style.backgroundColor = '';
        }, 2000);
    }

    async function handleListCopyClick(e, button, memberElement) {
        e.preventDefault();
        e.stopPropagation();

        const nameLink = memberElement.querySelector('a[href*="profiles.php"]');
        if (!nameLink) return;

        let name = (nameLink.textContent || '').trim();
        name = stripBspPrefix(name);

        const idMatch = nameLink.href.match(/XID=(\d+)/);
        if (!idMatch) return;
        const id = idMatch[1];

        const settings = loadSettings();
        let statusEmoji = '';
        let healthStr = null;
        let statsStr = null;

        if (settings.activity) {
            const statusEl = memberElement.querySelector('.userStatusWrap___ljSJG svg, li[class*="user-status-16-"]');
            statusEmoji = '⚫ ';
            if (statusEl) {
                const cls = statusEl.className.toString();
                const fill = statusEl.getAttribute && statusEl.getAttribute('fill') || '';
                if (cls.includes('-Online') || fill.includes('online')) statusEmoji = '🟢 ';
                else if (cls.includes('-Away') || cls.includes('-Idle') || fill.includes('idle')) statusEmoji = '🟡 ';
            }
        }

        const releaseTimestamp = hospTime[id] || null;
        if (releaseTimestamp && (settings.timeRemaining || settings.releaseTime)) {
            const timeParts = [];
            if (settings.timeRemaining) {
                const remainingSeconds = releaseTimestamp - (Date.now() / 1000);
                if (remainingSeconds > 0) {
                    timeParts.push(`In hospital for ${formatRemainingTime(remainingSeconds)}`);
                }
            }
            if (settings.releaseTime) {
                const releaseDate = new Date(releaseTimestamp * 1000);
                const tctTimeString = releaseDate.toLocaleTimeString([], {
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                    hour12: false, timeZone: 'UTC'
                });
                timeParts.push(`Out at ${tctTimeString} TCT`);
            }
            if (timeParts.length > 0) healthStr = `(${timeParts.join(' | ')})`;
        }

        if (settings.battlestats) {
            button.textContent = '...';
            try {
                // Skip spy data, use BSP prediction first, then FF Scouter
                const predOnly = getBspPredictionOrFf(id);
                if (predOnly?.type === 'prediction' && predOnly.prediction) {
                    statsStr = formatPredictionString(predOnly.prediction);
                } else {
                    const ff = await getFfScouterEstimate(id);
                    if (ff && ff.total != null) {
                        statsStr = formatFfScouterString(ff, settings.battleStatsFormat);
                    } else {
                        statsStr = "(Stats: N/A)";
                    }
                }
            } catch (error) {
                if (debug) console.error("Torn Profile Link Formatter: BSP/FF format error (list)", id, error);
                statsStr = "(Stats: Error)";
            }
        }

        const linkedName = `<a href="https://www.torn.com/profiles.php?XID=${id}">${name} [${id}]</a>`;
        const attackLink = `<a href="https://www.torn.com/loader2.php?sid=getInAttack&user2ID=${id}">Attack</a>`;
        const details = [attackLink];
        if (healthStr) details.push(healthStr);
        if (statsStr) details.push(statsStr);

        copyToClipboard(`${statusEmoji}${linkedName} - ${details.join(' - ')}`);

        button.textContent = '✅';
        setTimeout(() => { button.textContent = '📄'; }, 1500);
    }

    async function handleFactionCopyClick(e, button, isLeftFactionButton) {
        e.preventDefault();
        e.stopPropagation();

        button.textContent = '...';

        try {
            const warRoot =
                document.querySelector('.faction-war-info, .ranked-war, .war-report, #react-root, #root') ||
                document.body;

            const headerFactionLinks = warRoot.querySelectorAll(
                '.faction-war-info a[href*="factions.php?step=profile&ID="],' +
                '.faction-war-info a[href*="factions.php?step=profile&factionID="]'
            );

            let leftFactionId = null;
            let rightFactionId = null;

            if (headerFactionLinks.length >= 2) {
                const leftHref = headerFactionLinks[0].href;
                const rightHref = headerFactionLinks[1].href;
                const leftMatch = leftHref.match(/(?:ID|factionID)=(\d+)/);
                const rightMatch = rightHref.match(/(?:ID|factionID)=(\d+)/);
                leftFactionId = leftMatch ? leftMatch[1] : null;
                rightFactionId = rightMatch ? rightMatch[1] : null;
            }

            if (debug) console.log('[Faction Copy BSP/FF] header faction IDs:', { leftFactionId, rightFactionId });

            let mySide = null;
            let enemySide = null;
            let enemyFactionId = null;

            if (leftFactionId === MY_FACTION_ID) {
                mySide = 'left';
                enemySide = 'right';
                enemyFactionId = rightFactionId;
            } else if (rightFactionId === MY_FACTION_ID) {
                mySide = 'right';
                enemySide = 'left';
                enemyFactionId = leftFactionId;
            }

            let targetFactionId = null;

            if (mySide && enemySide) {
                const buttonIsMySide = isLeftFactionButton
                    ? (mySide === 'left')
                    : (mySide === 'right');
                targetFactionId = buttonIsMySide ? MY_FACTION_ID : enemyFactionId;
            }

            if (!targetFactionId) {
                targetFactionId = isLeftFactionButton ? leftFactionId : rightFactionId;
            }

            if (debug) console.log('[Faction Copy BSP/FF] targetFactionId:', targetFactionId);

            const sideSelector = (isLeftFactionButton
                ? '.left-side, .leftFaction, [class*="leftSide"], [data-side="left"]'
                : '.right-side, .rightFaction, [class*="rightSide"], [data-side="right"]');

            const sideRoot = warRoot.querySelector(sideSelector) || warRoot;

            const memberRows = sideRoot.querySelectorAll(
                'li.member, li.enemy, li.your, li.table-row, li[class*="memberRow"], li[class*="member-row"]'
            );

            const settings = loadSettings();
            const lines = [];
            const seenIds = new Set();

            // First pass: collect valid members to get total count
            const validRows = [];
            for (const row of memberRows) {
                const link = row.querySelector('a[href*="profiles.php"][href*="XID="]');
                if (!link) continue;
                const href = link.getAttribute('href') || '';
                const idMatch = href.match(/XID=(\d+)/);
                if (!idMatch) continue;
                const id = idMatch[1];
                const memberFactionId = warMemberFaction[id];
                if (targetFactionId && memberFactionId && memberFactionId.toString() !== targetFactionId.toString()) continue;
                if (seenIds.has(id)) continue;
                seenIds.add(id);
                validRows.push({ row, link, id });
            }

            const totalMembers = validRows.length;
            let processed = 0;
            button.textContent = `0/${totalMembers}`;

            for (const { row, link, id } of validRows) {
                try {
                    let name = (link.textContent || '').trim();
                    name = stripBspPrefix(name);
                    if (!name) { processed++; continue; }

                    const profileLabel = name;
                    let statsString = "(Stats: N/A)";

                    if (settings.battlestats) {
                        // Faction copy: skip spy data, only use BSP prediction or FF Scouter
                        const predOnly = getBspPredictionOrFf(id);
                        if (predOnly?.type === 'prediction' && predOnly.prediction) {
                            statsString = formatPredictionString(predOnly.prediction);
                        } else {
                            const ff = await getFfScouterEstimate(id);
                            if (ff && ff.total != null) {
                                statsString = formatFfScouterString(ff, settings.battleStatsFormat);
                            } else {
                                statsString = "(Stats: N/A)";
                            }
                        }
                    }

                    const extras = [];

                    const level = getMemberLevel(id, row);
                    if (level != null) extras.push(`Lvl ${level}`);

                    const pStats = await getPersonalStats(id);
                    if (pStats.xantaken != null) extras.push(`Xan: ${pStats.xantaken.toLocaleString()}`);
                    if (pStats.boostersused != null) extras.push(`Boosters: ${pStats.boostersused.toLocaleString()}`);

                    const extraStr = extras.length > 0 ? ` - ${extras.join(' - ')}` : '';

                    lines.push(`${profileLabel} - ${statsString}${extraStr}`);
                } catch (rowErr) {
                    if (debug) console.error('GNSC faction copy: error on member row', row, rowErr);
                }
                processed++;
                button.textContent = `${processed}/${totalMembers}`;
                // Yield to UI so the counter visually updates
                await new Promise(r => setTimeout(r, 0));
            }

            if (!lines.length) {
                if (debug) console.error('GNSC faction copy: no member rows parsed for side selector', sideSelector, 'targetFactionId', targetFactionId);
                button.textContent = '❓';
                button.title = 'No members parsed.';
                setTimeout(() => {
                    button.textContent = '📋';
                    button.title = 'Copy Faction Member List (BSP/FF cache)';
                }, 2500);
                return;
            }

            copyToClipboard(lines.join('\n'));

            button.textContent = `✅ ${totalMembers}`;
            button.title = 'Copied faction list with BSP/FF stats.';
            setTimeout(() => {
                button.textContent = '📋';
                button.title = 'Copy Faction Member List (BSP/FF cache)';
            }, 5000);
        } catch (err) {
            if (debug) console.error('[Faction Copy BSP/FF] Error:', err);
            button.textContent = '❌';
            button.title = 'Error building faction list.';
            setTimeout(() => {
                button.textContent = '📋';
                button.title = 'Copy Faction Member List (BSP/FF cache)';
            }, 2500);
        }
    }

    // --- Formatting helpers ---

    function formatBattleStatsString(spyResult, format) {
        if (!spyResult || typeof spyResult.total === 'undefined') return "(Stats: N/A)";

        const spyStr = `Spy: ${formatTimeDifference(spyResult.timestamp)}`;
        const totalStr = `Total: ${formatNumber(spyResult.total)}`;

        switch (format) {
            case 'highest': {
                const stats = {
                    'Str': spyResult.strength,
                    'Def': spyResult.defense,
                    'Spd': spyResult.speed,
                    'Dex': spyResult.dexterity
                };
                const highestStatName = Object.keys(stats).reduce((a, b) => stats[a] > stats[b] ? a : b);
                const highestStatValue = formatNumber(stats[highestStatName]);
                return `(Highest: ${highestStatName} ${highestStatValue} | ${totalStr} | ${spyStr})`;
            }
            case 'total':
                return `(${totalStr} | ${spyStr})`;
            case 'all':
            default: {
                const str = `Str: ${formatNumber(spyResult.strength)}`;
                const def = `Def: ${formatNumber(spyResult.defense)}`;
                const spd = `Spd: ${formatNumber(spyResult.speed)}`;
                const dex = `Dex: ${formatNumber(spyResult.dexterity)}`;
                return `(${str} | ${def} | ${spd} | ${dex} | ${totalStr} | ${spyStr})`;
            }
        }
    }

    function formatPredictionString(pred) {
        try {
            if (!pred || pred.TBS == null) return "(Stats: N/A)";
            let tbs = pred.TBS;
            if (typeof tbs === 'string') {
                tbs = parseFloat(tbs.replace(/,/g, ''));
            }
            const tbsStr = isFinite(tbs) ? formatNumber(tbs) : 'N/A';
            return `(Stats: ${tbsStr})`;
        } catch (e) {
            if (debug) console.error('Torn Profile Link Formatter: formatPredictionString error', pred, e);
            return "(Stats: Error)";
        }
    }

    function formatFfScouterString(ff, format) {
        try {
            if (!ff || ff.total == null) return "(Stats: N/A)";

            let baseHuman = ff.human && typeof ff.human === "string" ? ff.human : null;

            let totalNumeric = ff.total;
            if (typeof totalNumeric === "string") {
                totalNumeric = parseFloat(totalNumeric.replace(/,/g, ''));
            }
            const totalStr = baseHuman || (isFinite(totalNumeric) ? formatNumber(totalNumeric) : "N/A");

            switch (format) {
                case "highest":
                    return `(FF: Est Highest ${totalStr} | Total ${totalStr})`;
                case "total":
                    return `(FF: Total ${totalStr})`;
                case "all":
                default:
                    return `(FF: Est ${totalStr})`;
            }
        } catch (e) {
            if (debug) console.error('Torn Profile Link Formatter: formatFfScouterString error', ff, e);
            return "(Stats: Error)";
        }
    }

    function formatNumber(num) {
        if (typeof num !== 'number' || isNaN(num)) return 'N/A';
        if (num < 1e3) return Math.floor(num);
        if (num < 1e6) return +(num / 1e3).toFixed(2) + "K";
        if (num < 1e9) return +(num / 1e6).toFixed(2) + "M";
        if (num < 1e12) return +(num / 1e9).toFixed(2) + "B";
        if (num < 1e15) return +(num / 1e12).toFixed(2) + "T";
        return +(num / 1e15).toFixed(2) + "Q";
    }

    function formatRemainingTime(totalSeconds) {
        if (totalSeconds <= 0) return "0s";
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = Math.floor(totalSeconds % 60);
        return [hours > 0 ? `${hours}h` : '', minutes > 0 ? `${minutes}m` : '', seconds > 0 ? `${seconds}s` : '']
            .filter(Boolean)
            .join(' ');
    }

    function formatTimeDifference(timestamp) {
        const seconds = Math.floor(Date.now() / 1000) - timestamp;
        if (seconds < 60) return `${Math.floor(seconds)}s ago`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;
        if (seconds < 31536000) return `${Math.floor(seconds / 2592000)}mo ago`;
        return `${Math.floor(seconds / 31536000)}y ago`;
    }

    function loadSettings() {
        return GNSC_getValue('tornProfileFormatterSettings', {
            attack: true,
            faction: false,
            company: false,
            timeRemaining: true,
            releaseTime: true,
            battlestats: false,
            activity: true,
            battleStatsFormat: 'all'
        });
    }

    function updateBattleStatsAvailability() {
        const battleStatsCheckbox = document.getElementById('gnsc-check-battlestats');
        const formatWrapper = document.getElementById('gnsc-battlestats-format-wrapper');
        if (!battleStatsCheckbox || !formatWrapper) return;
        formatWrapper.style.display = battleStatsCheckbox.checked ? 'flex' : 'none';
    }

    function saveSettings() {
        const settings = {
            attack: document.getElementById('gnsc-check-attack').checked,
            faction: document.getElementById('gnsc-check-faction')?.checked || false,
            company: document.getElementById('gnsc-check-company')?.checked || false,
            timeRemaining: document.getElementById('gnsc-check-timeRemaining')?.checked || false,
            releaseTime: document.getElementById('gnsc-check-releaseTime')?.checked || false,
            activity: document.getElementById('gnsc-check-activity').checked,
            battlestats: document.getElementById('gnsc-check-battlestats')?.checked || false,
            battleStatsFormat: document.getElementById('gnsc-select-battlestats-format')?.value || 'all'
        };
        GNSC_setValue('tornProfileFormatterSettings', settings);
    }

    function copyToClipboard(text) {
        const tempTextarea = document.createElement('textarea');
        tempTextarea.style.position = 'fixed';
        tempTextarea.style.left = '-9999px';
        tempTextarea.value = text;
        document.body.appendChild(tempTextarea);
        tempTextarea.select();
        try {
            document.execCommand('copy');
        } catch (err) {
            if (debug) console.error('Torn Profile Link Formatter: Clipboard copy failed.', err);
        }
        document.body.removeChild(tempTextarea);
    }

    // --- Live Data Interception (war JSON -> hospTime + warMemberFaction) ---

    const originalFetch = unsafeWindow.fetch;
    unsafeWindow.fetch = async (...args) => {
        const url = args[0] instanceof Request ? args[0].url : args[0];
        const isKnownDataSource =
            url.includes("step=getwarusers") ||
            url.includes("step=getProcessBarRefreshData") ||
            url.includes("sidebarAjaxAction.php?q=sync");

        if (!isKnownDataSource) return originalFetch(...args);

        const response = await originalFetch(...args);
        const clone = response.clone();

        clone.json().then(json => {
            let members = null;

            if (json.warDesc?.members) {
                members = json.warDesc.members;
            } else if (json.userStatuses) {
                members = json.userStatuses;
            } else if (json.status?.bar?.hospital?.end) {
                const userId = json.user?.userID;
                if (userId) hospTime[userId] = json.status.bar.hospital.end;
                return;
            } else if (json.user?.userID) {
                const userId = json.user.userID;
                if (hospTime[userId]) delete hospTime[userId];
                return;
            } else {
                return;
            }

            if (members) {
                Object.keys(members).forEach((id) => {
                    const m = members[id];
                    const status = m.status || m;
                    const userId = m.userID || id;

                    const fid = m.factionID || m.faction_id || m.factionId;
                    if (fid) {
                        warMemberFaction[userId] = fid;
                    }

                    const lvl = m.level || m.Level;
                    if (lvl) {
                        warMemberLevel[userId] = lvl;
                    }

                    if (status.text === "Hospital") {
                        hospTime[userId] = status.updateAt;
                    } else if (hospTime[userId]) {
                        delete hospTime[userId];
                    }
                });
            }
        }).catch(err => {
            if (debug) console.error("Torn Profile Link Formatter: Error parsing fetch JSON.", err);
        });

        return response;
    };

    // --- Script Entry Point ---

    const observer = new MutationObserver(() => {
        if (window.location.href.includes('profiles.php')) {
            initProfilePage();
        } else if (window.location.href.includes('factions.php')) {
            initFactionPage();
            initRankedWarPage();
        }
        initMiniProfile();
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();
