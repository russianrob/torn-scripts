// ==UserScript==
// @name         OC Spawn Assistance
// @namespace    torn-oc-spawn-assistance
// @version      2.2.1
// @description  Analyzes faction OC slots vs member availability with scope budget and priority ordering
// @author       RussianRob
// @match        https://www.torn.com/factions.php*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      tornwar.com
// @connect      api.torn.com
// @downloadURL  https://tornwar.com/scripts/oc-spawn-assistance.user.js
// @updateURL    https://tornwar.com/scripts/oc-spawn-assistance.meta.js
// ==/UserScript==

// ═══════════════════════════════════════════════════════════════════════════════
//  CHANGELOG
// ═══════════════════════════════════════════════════════════════════════════════
// v2.2.1 — Slot Optimizer engine: auto-calculate best member-to-slot assignments
// v2.2.0 — Engine toggle system: 11 engines across Optimization, Risk, Economy, Recruitment categories
// v2.1.27 — Recommendations search downward through lower levels if none at joinable level
// v2.1.26 — Settings gear always visible so all members can change their API key
// v2.1.25 — API key guidance (Limited Access required), subscription timer in header
// v2.1.24 — Buttons render as action text if already on armoury tab at load time
// v2.1.23 — All loan/retrieve buttons update to action text when navigating to armoury
// v2.1.22 — Fix admin locked message to reference API access instead of role names
// v2.1.21 — Loan/Retrieve buttons start as "Go to Armoury", change to action after navigating
// v2.1.20 — Version bump
// v2.1.19 — Switch armory reads to Torn API; page AJAX only for loan/retrieve actions
// v2.1.18 — Remove dead ADMIN_ROLES config; graceful fallback when no faction-access key cached
// v2.1.17 — Admin access based on API key faction access, not role names
// v2.1.16 — Version bump
// v2.1.15 — Revert same-range joining: back to exact level match only
// v2.1.14 — Same scope range both directions (Lvl 5 can join Lvl 6 if that's what spawned)
// v2.1.13 — Expiry fallback within same scope range only (Lvl 5↔Lvl 6, not Lvl 5→Lvl 4)
// v2.1.12 — Recommend spawning 1 OC when members exist but zero OCs at that level
// v2.1.11 — Revert level fallback: members stay at their level (don't downgrade Lvl 7 to Lvl 4)
// v2.1.10 — Prioritize expiring OCs first (soonest deadline gets filled first)
// v2.1.9  — Members fall to next available level if their level has no OCs
// v2.1.8  — Show "waiting" when members exist but no OCs at that level
// v2.1.7  — Unblacklist Blood Bag (Irradiated) from Missing tab
// v2.1.6  — Save button disabled until server settings loaded (prevents default overwrite)
// v2.1.5  — Scope guard: don't push lower value than server has
// v2.1.4  — Unused tab: only show OC-relevant items
// v2.1.3  — Two-step loan/retrieve: navigate to armory tab first
// v2.1.2  — API key field plain text instead of asterisks
// v2.1.1  — Added Councilor to default admin roles
// v2.1.0  — Metrics tab: KPIs, per-OC breakdown, date range, item valuation
// v2.0.0  — Manager tab (Missing/Unused/Payouts), version gate, Message Player,
//           hidden config for non-admins, SCRIPT_VERSION constant, @updateURL
// v1.7.37 — Scope auto-push uses /api/oc/scope (no settings overwrite)
// v1.7.36 — Scope auto-push to server (debounced, after settings loaded)
// v1.7.35 — Trust server per-level joinable, don't override with overall CPR
// v1.7.34 — Per-level CPR gating + server applies faction MINCPR/CPR_BOOST
// v1.7.33 — Skipped members get full CPR/OC data (fixes viewer card for long OCs)
// v1.7.31 — Fix: pass weights to renderViewerCard
// v1.7.30 — Numbered role labels (#1, #2), weight lookups fixed
// v1.7.29 — Weight-based role selection, full slot names
// v1.7.28 — Use position name not position_id for byPosition keys
// v1.7.27 — Role CPR fallback: exact crime match, then any crime with same role
// v1.7.26 — Scope byPosition CPR to crime type (crimeName::role)
// v1.7.25 — Border + dim styling for "None needed" rows
// v1.7.24 — Always show levels with members or slots
// v1.7.23 — Gear always visible to dev regardless of admin roles
// v1.7.22 — Friendlier error for Incorrect ID-entity relation
// v1.7.21 — Cross-faction fetchKey fix, smarter error hints
// v1.7.20 — Configurable Admin Roles setting
// v1.7.19 — Show actual server 403 message to unsubscribed users
// v1.7.18 — Smarter error hints for Torn API timeouts
// v1.7.16 — Admin tab gated by faction position or dev ID
// v1.7.15 — Two-tab system: My OC (everyone) + Admin (admin-only)
// v1.7.14 — Settings restricted to owner faction only
// v1.7.13 — OWNER_API_KEY for faction fetches (Minimal keys work)
// v1.7.12 — Configurable weight threshold/CPR settings
// v1.7.11 — OC role weights from tornprobability.com
// ═══════════════════════════════════════════════════════════════════════════════

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
            SCOPE:             GM_getValue('cfg_scope', null),  // null = not configured
            // Engine toggles
            ENGINE_SLOT_OPTIMIZER:   GM_getValue('eng_slot_optimizer', false),
            ENGINE_CPR_FORECASTER:   GM_getValue('eng_cpr_forecaster', false),
            ENGINE_FAILURE_RISK:     GM_getValue('eng_failure_risk', false),
            ENGINE_EXPIRY_RISK:      GM_getValue('eng_expiry_risk', false),
            ENGINE_MEMBER_RELIABILITY: GM_getValue('eng_member_reliability', false),
            ENGINE_PAYOUT_OPTIMIZER: GM_getValue('eng_payout_optimizer', false),
            ENGINE_ITEM_ROI:         GM_getValue('eng_item_roi', false),
            ENGINE_NERVE_EFFICIENCY: GM_getValue('eng_nerve_efficiency', false),
            ENGINE_GAP_ANALYZER:     GM_getValue('eng_gap_analyzer', false),
            ENGINE_MEMBER_PROJECTOR: GM_getValue('eng_member_projector', false),
            VERSION:           '1.5.4',
        };
    }
    let CONFIG = loadConfig();

    let cprBreakdownMap = {};
    let recMap = {}; // uid → { crime, position, cpr, count }
    let lastScopeProjection = null;
    let scopePushTimer  = null;
    let settingsReady    = false;  // true after server settings loaded
    const SCRIPT_VERSION = '2.2.1';
    const SERVER = 'https://tornwar.com';

    // ═══════════════════════════════════════════════════════════════════════
    //  OC METRICS  — constants, state, and core logic (ported from Canixe's script)
    // ═══════════════════════════════════════════════════════════════════════
    const MET_CRIMES_API  = "https://api.torn.com/v2/faction/crimes";
    const MET_NEWS_API    = "https://api.torn.com/v2/faction/news";
    const MET_ITEMS_API   = "https://api.torn.com/v2/torn/items";
    const MET_API_COMMENT = "OC-Spawn-Metrics";
    const MET_API_PAGE_CAP = 100;
    const MET_FIG = "\u2007";
    const MET_ITEM_CACHE_KEY = "oc-spawn-metrics:items_cache_v1.1";
    const MET_ITEM_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
    let   met_ITEM_INFO = null;
    const MET_VALUE_MODE_KEY = "oc-spawn-metrics:value_mode_v1";
    const MET_VALUE_MODES = { MV: "mv", PAID: "paid" };
    let   met_lastRender = null;
    let   met_abortCtrl = null;
    let   met_loaded = false; // true after first load

    // --- Metrics utility functions ---
    const met_delay = (ms) => new Promise(r => setTimeout(r, ms));
    const met_escapeHtml = (s) => String(s)
        .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
        .replace(/\"/g,"&quot;").replace(/'/g,"&#39;");
    const met_fmtMoneySpace = (n) => String(Math.round(n||0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const met_pad2   = (n) => String(n).padStart(2, MET_FIG);
    const met_padPct = (r) => r.toFixed(1).padStart(5, MET_FIG) + "%";

    function met_getValueMode() {
        try {
            const m = GM_getValue(MET_VALUE_MODE_KEY, MET_VALUE_MODES.MV) || MET_VALUE_MODES.MV;
            return (String(m) === MET_VALUE_MODES.PAID) ? MET_VALUE_MODES.PAID : MET_VALUE_MODES.MV;
        } catch { return MET_VALUE_MODES.MV; }
    }
    function met_setValueMode(val) {
        try { GM_setValue(MET_VALUE_MODE_KEY, val); } catch {}
    }

    function met_setError(msg) {
        const s = document.getElementById('met-status');
        if (!s) return;
        if (msg) { s.textContent = msg; s.style.display = 'inline'; }
        else { s.textContent = ''; s.style.display = 'none'; }
    }

    function met_grossUpFromPaid(paidToMembers, payoutPct) {
        const paid = Math.round(Number(paidToMembers || 0));
        const pct  = Number(payoutPct || 0);
        if (!paid || !(pct > 0)) return 0;
        const bp = Math.round(pct * 100);
        if (!(bp > 0)) return 0;
        return Math.round((paid * 10000) / bp);
    }

    // --- Metrics API fetching (uses direct fetch + getApiKey) ---
    async function met_fetchJSON(url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (data && (data.error || data.code)) {
            const code = Number(data.error?.code ?? data.code ?? NaN);
            const raw  = data.error?.error ?? data.error?.message ?? "API error";
            const map = {
                1: "Missing API key", 2: "Invalid API key",
                5: "Rate limited: retry in ~30s", 7: "Requires Faction API Access",
                14: "Daily usage limit reached", 16: "Insufficient access — requires Limited Access",
            };
            const nice = Number.isFinite(code) ? (map[code] || raw) : raw;
            throw new Error('Torn API error' + (Number.isFinite(code) ? ' ' + code : '') + ': ' + nice);
        }
        return data;
    }

    const met_asCrimes = (p) =>
        Array.isArray(p?.crimes) ? p.crimes
        : (p?.crimes && typeof p.crimes === "object" ? Object.values(p.crimes)
        : (Array.isArray(p?.result?.crimes) ? p.result.crimes : []));

    const met_asNews = (p) =>
        Array.isArray(p?.news) ? p.news
        : (p?.news && typeof p.news === "object" ? Object.values(p.news)
        : (Array.isArray(p?.result?.news) ? p.result.news : []));

    async function met_fetchCrimesBatch({ key, startSec, endSec, signal }) {
        const u = new URL(MET_CRIMES_API);
        u.searchParams.set("comment", MET_API_COMMENT);
        u.searchParams.set("key", key.trim());
        u.searchParams.set("cat", "completed");
        u.searchParams.set("filter", "executed_at");
        u.searchParams.set("from", String(startSec));
        u.searchParams.set("to",   String(endSec));
        u.searchParams.set("sort", "DESC");

        const data   = await met_fetchJSON(u.toString());
        if (signal?.aborted) throw new Error("Aborted");
        const crimes = (met_asCrimes(data) || []).filter(c => Number.isFinite(c?.executed_at));
        return { crimes };
    }

    async function met_fetchNewsExpenses({ key, startSec, endSec, includeCrimeIds, signal }) {
        const paidToMembersByCrime = new Map();
        const grossTotalByCrime = new Map();
        const seenNewsIds = new Set();
        let cursorTo = endSec;

        while (cursorTo >= startSec) {
            if (signal?.aborted) throw new Error("Aborted");

            const u = new URL(MET_NEWS_API);
            u.searchParams.set("comment", MET_API_COMMENT);
            u.searchParams.set("key", key.trim());
            u.searchParams.set("cat", "crime");
            u.searchParams.set("sort", "DESC");
            u.searchParams.set("from", String(startSec));
            u.searchParams.set("to",   String(cursorTo));

            const news = (met_asNews(await met_fetchJSON(u.toString())) || []).filter(n => Number.isFinite(n?.timestamp));
            const count = news.length;
            if (!count) break;

            for (const n of news) {
                const nid = String(n?.id || "");
                if (nid) {
                    if (seenNewsIds.has(nid)) continue;
                    seenNewsIds.add(nid);
                }

                const txt = String(n?.text || "");
                const idm = txt.match(/crimeId=(\d+)/i); if (!idm) continue;
                const crimeId = Number(idm[1]);
                if (includeCrimeIds && !includeCrimeIds.has(crimeId)) continue;

                const pm = txt.match(
                    /money balance payout splitting\s+(\d+(?:\.\d+)?)%\s+of\s+the\s+\$([\d, ]+)\s+between\s+(\d+)\s+participants/i
                );
                if (!pm) continue;

                const pct = parseFloat(pm[1]);
                const total = parseInt(pm[2].replace(/[^\d]/g,""), 10);
                const participants = parseInt(pm[3], 10);

                const pool = Math.floor((total * pct + 1e-9) / 100);
                const each = Math.floor(pool / participants);
                const paidOutTotal = each * participants;

                paidToMembersByCrime.set(crimeId, (paidToMembersByCrime.get(crimeId) || 0) + paidOutTotal);
                grossTotalByCrime.set(crimeId, (grossTotalByCrime.get(crimeId) || 0) + total);
            }

            if (count < MET_API_PAGE_CAP) break;

            const asc = [...new Set(news.map(n => n.timestamp))].sort((a,b)=>a-b);
            const min = asc[0];
            const secondMin = asc.length >= 2 ? asc[1] : NaN;

            let nextTo = Number.isFinite(secondMin) ? secondMin : (min - 1);
            if (!(nextTo < cursorTo)) nextTo = cursorTo - 1;
            if (nextTo < startSec) break;
            cursorTo = nextTo;

            await met_delay(150);
        }

        return { paidToMembersByCrime, grossTotalByCrime };
    }

    // Items catalog with 24h localStorage cache
    async function met_ensureItemInfo(key) {
        if (met_ITEM_INFO) return;
        try {
            const raw = localStorage.getItem(MET_ITEM_CACHE_KEY);
            if (raw) {
                const obj = JSON.parse(raw);
                if (obj?.ts && obj?.data && (Date.now() - obj.ts) < MET_ITEM_CACHE_TTL) {
                    met_ITEM_INFO = new Map(obj.data);
                    return;
                }
            }
        } catch {}
        try {
            const u = new URL(MET_ITEMS_API);
            u.searchParams.set("comment", MET_API_COMMENT);
            u.searchParams.set("key", key.trim());
            const data = await met_fetchJSON(u.toString());
            const arr = Array.isArray(data?.items) ? data.items
                : (Array.isArray(data?.result?.items) ? data.result.items : []);
            const map = new Map();
            for (const it of arr) {
                const id = Number(it?.id);
                if (!Number.isFinite(id)) continue;
                const name = it?.name || 'Item #' + id;
                const mv   = Number(it?.value?.market_price ?? 0) || 0;
                map.set(id, { name, mv });
            }
            met_ITEM_INFO = map;
            try {
                localStorage.setItem(MET_ITEM_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: Array.from(map.entries()) }));
            } catch {}
        } catch(e) {
            console.warn("[OC Metrics] Items catalog fetch failed:", e);
            met_ITEM_INFO = new Map();
        }
    }
    const met_itemName = (id) => met_ITEM_INFO?.get(id)?.name ?? ('Item #' + id);
    const met_itemMV   = (id) => met_ITEM_INFO?.get(id)?.mv   ?? 0;

    // --- Metrics aggregation ---
    function met_aggregate(crimes) {
        const totals = {
            count: 0, success: 0, fail: 0,
            money: 0, respect: 0,
            payoutToMembers: 0, payoutToFaction: 0,
            ocBreakdown: new Map(),
        };
        for (const c of crimes) {
            const success = String(c?.status||"").toLowerCase() === "successful";
            totals.count += 1;
            success ? (totals.success += 1) : (totals.fail += 1);
            const name = c?.name || "Unknown OC";
            const diff = Number.isFinite(c?.difficulty) ? c.difficulty : null;
            const key  = name + "|" + (diff ?? "");
            let b = totals.ocBreakdown.get(key);
            if (!b) {
                b = { name, difficulty: diff, total: 0, success: 0, fail: 0, respect: 0, memMoney: 0, income: 0, itemsQty: 0, items: new Map() };
                totals.ocBreakdown.set(key, b);
            }
            b.total += 1;
            success ? (b.success += 1) : (b.fail += 1);
            const money   = Number(c?.rewards?.money   || 0);
            const respect = Number(c?.rewards?.respect || 0);
            totals.money   += money;
            totals.respect += respect;
            b.income       += money;
            b.respect      += respect;
            const itemsArr = Array.isArray(c?.rewards?.items) ? c.rewards.items : [];
            for (const it of itemsArr) {
                const iid = Number(it?.id);
                const qty = Number(it?.quantity || 0);
                if (!Number.isFinite(iid) || !qty) continue;
                b.itemsQty += qty;
                b.items.set(iid, (b.items.get(iid) || 0) + qty);
            }
            const pct       = Math.max(0, Math.min(100, Number(c?.rewards?.payout?.percentage ?? 0)));
            const toMembers = Math.round((money * pct) / 100);
            const toFaction = money - toMembers;
            totals.payoutToMembers += toMembers;
            totals.payoutToFaction += toFaction;
            b.memMoney += toMembers;
        }
        return { totals };
    }

    function met_buildOcExpenseMap(crimes, expenseByCrime) {
        const map = new Map();
        for (const c of crimes) {
            const e = expenseByCrime.get(c.id) || 0;
            if (!e) continue;
            const name = c.name || "Unknown OC";
            const diff = Number.isFinite(c.difficulty) ? c.difficulty : null;
            const key  = name + "|" + (diff ?? "");
            map.set(key, (map.get(key) || 0) + e);
        }
        return map;
    }

    function met_getMaxPaidAt(crimes) {
        let max = NaN;
        for (const c of crimes) {
            const ts = Number(c?.rewards?.payout?.paid_at);
            if (Number.isFinite(ts) && (!Number.isFinite(max) || ts > max)) max = ts;
        }
        return max;
    }

    function met_buildItemEstByKey(ocMap) {
        const byKey = new Map(); let total = 0;
        for (const [key, b] of ocMap) {
            let est = 0;
            if (b.items?.size) {
                for (const [iid, qty] of b.items) est += qty * (met_itemMV(iid) || 0);
            }
            est = Math.round(est);
            byKey.set(key, est);
            total += est;
        }
        return { byKey, total: Math.round(total) };
    }

    function met_buildOcTimeItemEstByKey(crimes, grossTotalByCrime) {
        const grossedByKey = new Map();
        const incomeByKey  = new Map();
        for (const c of crimes) {
            const name = c.name || "Unknown OC";
            const diff = Number.isFinite(c.difficulty) ? c.difficulty : null;
            const key  = name + "|" + (diff ?? "");
            const income = Math.round(Number(c?.rewards?.money || 0));
            incomeByKey.set(key, (incomeByKey.get(key) || 0) + income);
            const gross = grossTotalByCrime.get(c.id) || 0;
            if (!gross) continue;
            grossedByKey.set(key, (grossedByKey.get(key) || 0) + gross);
        }
        const byKey = new Map(); let total = 0;
        for (const [key, grossed] of grossedByKey) {
            const income = incomeByKey.get(key) || 0;
            const estItems = Math.max(0, Math.round(grossed - income));
            byKey.set(key, estItems);
            total += estItems;
        }
        return { byKey, total: Math.round(total) };
    }

    // --- Metrics rendering ---
    function met_renderTotals({ totals, countDays, paidToMembersOverride, netOverride }) {
        const host = document.getElementById('met-totals');
        if (!host) return;
        const days = Math.max(1, countDays|0);
        const rate = totals.count ? (totals.success / totals.count * 100) : 0;
        const paidMembers = Number.isFinite(paidToMembersOverride) ? paidToMembersOverride : (totals.payoutToMembers || 0);
        const netFaction  = Number.isFinite(netOverride)           ? netOverride           : (totals.payoutToFaction || 0);
        const grandTotal  = paidMembers + netFaction;
        const perRespect = totals.respect / days;
        const perMem     = paidMembers   / days;
        const perNet     = netFaction    / days;
        const perGrand   = grandTotal    / days;

        host.innerHTML = '<div class="met-kpis">'
          + '<div class="met-kpi"><div class="met-kpi-label">Crimes</div>'
          + '<div class="met-kpi-value">' + totals.count.toLocaleString() + '</div>'
          + '<div class="met-kpi-sub"><span style="color:#74c69d">' + totals.success.toLocaleString() + '</span> / <span style="color:#f87171">' + totals.fail.toLocaleString() + '</span> \u2013 ' + rate.toFixed(1) + '%</div></div>'
          + '<div class="met-kpi"><div class="met-kpi-label">Respect</div>'
          + '<div class="met-kpi-value">' + totals.respect.toLocaleString() + '</div>'
          + '<div class="met-kpi-sub">\u2248 ' + perRespect.toFixed(1) + ' / day</div></div>'
          + '<div class="met-kpi"><div class="met-kpi-label">Money to Members</div>'
          + '<div class="met-kpi-value">$' + paidMembers.toLocaleString() + '</div>'
          + '<div class="met-kpi-sub">\u2248 $' + met_fmtMoneySpace(perMem) + ' / day</div></div>'
          + '<div class="met-kpi"><div class="met-kpi-label">Money to Faction</div>'
          + '<div class="met-kpi-value">$' + netFaction.toLocaleString() + '</div>'
          + '<div class="met-kpi-sub">\u2248 $' + met_fmtMoneySpace(perNet) + ' / day</div></div>'
          + '<div class="met-kpi"><div class="met-kpi-label">Grand Total</div>'
          + '<div class="met-kpi-value">$' + grandTotal.toLocaleString() + '</div>'
          + '<div class="met-kpi-sub">\u2248 $' + met_fmtMoneySpace(perGrand) + ' / day</div></div>'
          + '</div>';
    }

    function met_renderOcBreakdown(ocMap, ocExpenseMap, itemEstByKey, opts) {
        const mode = (opts && opts.valueMode) || MET_VALUE_MODES.MV;
        const estLbl = (mode === MET_VALUE_MODES.PAID) ? "\u2248 $%s (OC-time)" : "\u2248 $%s (MV)";
        const host = document.getElementById('met-ocbreak');
        if (!host) return;

        const entries = Array.from(ocMap.entries()).map(([key, b]) => ({ key, ...b }));
        if (!entries.length) { host.innerHTML = '<span style="color:#6b7280;font-size:11px;">No crimes in range.</span>'; return; }

        entries.sort((a,b)=> ((a.difficulty??9999) - (b.difficulty??9999)) || a.name.localeCompare(b.name));

        const rows = entries.map(x => {
            const rate   = x.total ? (x.success / x.total * 100) : 0;
            const income = Math.round(x.income || 0);
            const paid   = Math.round(ocExpenseMap.get(x.key) || 0);
            const est    = Math.round(itemEstByKey.get(x.key) || 0);
            const net    = income + est - paid;
            const netCls = net >= 0 ? "color:#74c69d" : "color:#f87171";
            const label  = x.difficulty + ' - ' + met_escapeHtml(x.name);

            const parts = [];
            if (income > 0) parts.push('<div style="color:#74c69d">$' + income.toLocaleString() + '</div>');
            if (x.items?.size) {
                const li = [];
                for (const [iid, qty] of x.items) li.push('<li>' + qty.toLocaleString() + '\u00d7 ' + met_escapeHtml(met_itemName(iid)) + '</li>');
                li.sort((a,b)=> a.localeCompare(b));
                parts.push('<div class="met-items-col"><ul class="met-items-list">' + li.join("") + '</ul></div>');
                if (est > 0) parts.push('<div style="color:#f4a261">' + estLbl.replace("%s", est.toLocaleString()) + '</div>');
            }
            const merged = parts.length ? parts.join("") : "\u2014";

            const runsCell = '<span style="font-family:monospace">' + met_pad2(x.total) + ' (<span style="color:#74c69d">' + met_pad2(x.success) + '</span>/<span style="color:#f87171">' + met_pad2(x.fail) + '</span>) ' + met_padPct(rate) + '</span>';

            // items detail for mobile expandable row
            let itemsHTML = '';
            if (x.items && x.items.size) {
                const li2 = [];
                x.items.forEach((qty, iid) => {
                    li2.push('<li>' + qty.toLocaleString() + '\u00d7 ' + met_escapeHtml(met_itemName(iid)) + '</li>');
                });
                li2.sort((a,b) => a.localeCompare(b));
                itemsHTML = '<ul class="met-items-list">' + li2.join('') + '</ul>';
            }

            const detailsHtml = '<div class="met-details-wrap">'
                + '<div><strong>Runs</strong>: ' + runsCell + '</div>'
                + '<div><strong>Resp.</strong>: ' + x.respect.toLocaleString() + '</div>'
                + (income ? '<div style="color:#74c69d"><strong>Income</strong>: $' + income.toLocaleString() + '</div>' : '')
                + (paid   ? '<div style="color:#f87171"><strong>Paid to Members</strong>: $' + paid.toLocaleString() + '</div>' : '')
                + (x.items && x.items.size
                    ? '<div><strong>Items</strong>:' + itemsHTML + '</div>'
                      + (est ? '<div style="color:#f4a261"><strong>Item est.</strong>: $' + est.toLocaleString() + '</div>' : '')
                    : '')
                + '</div>';

            return '<tr class="met-main-row" aria-expanded="false">'
                + '<td class="met-oc-name">' + label + '</td>'
                + '<td class="met-w-min met-center met-col-runs">' + runsCell + '</td>'
                + '<td class="met-w-min met-center met-col-resp">' + x.respect.toLocaleString() + '</td>'
                + '<td class="met-col-items">' + merged + '</td>'
                + '<td class="met-w-min met-center met-col-paid" style="color:#f87171">$' + paid.toLocaleString() + '</td>'
                + '<td class="met-w-min met-center" style="' + netCls + '">$' + net.toLocaleString() + '</td>'
                + '</tr>'
                + '<tr class="met-row-details"><td colspan="6">' + detailsHtml + '</td></tr>';
        });

        host.innerHTML = '<table class="oc-table met-table">'
            + '<thead><tr>'
            + '<th>OC</th>'
            + '<th class="met-col-runs met-w-min">Runs</th>'
            + '<th class="met-col-resp met-w-min">Resp.</th>'
            + '<th class="met-col-items">' + ((mode === MET_VALUE_MODES.PAID) ? "Income & Items (OC-time est.)" : "Income & Items (Est. MV)") + '</th>'
            + '<th class="met-col-paid met-w-min">Paid to Members</th>'
            + '<th class="met-w-min">Net</th>'
            + '</tr></thead>'
            + '<tbody>' + rows.join('') + '</tbody>'
            + '</table>';
    }

    function met_renderFromCache(mode) {
        if (!met_lastRender) return;
        const isPaid = (mode === MET_VALUE_MODES.PAID);
        met_renderTotals({
            totals: met_lastRender.totals,
            countDays: met_lastRender.diffDays,
            paidToMembersOverride: met_lastRender.totalPaid,
            netOverride: isPaid ? met_lastRender.netTotalPaid : met_lastRender.netTotalMV
        });
        met_renderOcBreakdown(
            met_lastRender.totals.ocBreakdown,
            met_lastRender.ocExpenseMap,
            isPaid ? met_lastRender.itemEstByKeyPaid : met_lastRender.itemEstByKeyMV,
            { valueMode: mode }
        );
        const copyBtn = document.getElementById('met-copy');
        if (copyBtn) copyBtn.style.display = 'inline-flex';
    }

    function met_buildSummaryTSV() {
        if (!met_lastRender) return "";
        const fromStr = document.getElementById('met-from')?.value || "";
        const toStr   = document.getElementById('met-to')?.value || "";
        const mode = met_getValueMode();
        const modeLabel = (mode === MET_VALUE_MODES.PAID) ? "OC-Time" : "Current MV";
        const totals = met_lastRender.totals;
        const days   = Math.max(1, met_lastRender.diffDays|0);
        const rate   = totals.count ? (totals.success / totals.count * 100) : 0;
        const paidMembers = met_lastRender.totalPaid || 0;
        const netFaction = (mode === MET_VALUE_MODES.PAID) ? (met_lastRender.netTotalPaid || 0) : (met_lastRender.netTotalMV || 0);
        const grandTotal = paidMembers + netFaction;
        const headers = [
            "From(UTC)","To(UTC)","ValueMode",
            "Crimes","Success","Fail","SuccessRate(%)",
            "Respect","RespectPerDay",
            "MoneyToMembers","MoneyToMembersPerDay",
            "MoneyToFaction(Net)","MoneyToFactionPerDay",
            "GrandTotal","GrandTotalPerDay"
        ].join("\t");
        const row = [
            fromStr, toStr, modeLabel,
            totals.count, totals.success, totals.fail, rate.toFixed(1),
            totals.respect, (totals.respect / days).toFixed(1),
            paidMembers, Math.round(paidMembers / days),
            netFaction, Math.round(netFaction / days),
            grandTotal, Math.round(grandTotal / days)
        ].join("\t");
        return headers + "\n" + row;
    }

    // --- Metrics main run ---
    async function met_runQuery() {
        const copyBtn = document.getElementById('met-copy');
        if (copyBtn) copyBtn.style.display = 'none';

        const key = getApiKey();
        if (!key || key === 'YOUR_API_KEY_HERE') { met_setError("API key required — set it in Settings."); return; }

        const fromStr = document.getElementById('met-from')?.value?.trim();
        const toStr   = document.getElementById('met-to')?.value?.trim();
        if (!fromStr || !toStr) { alert("Pick both dates."); return; }

        const toUTC = (y,m,d,h,mi,s)=>Math.floor(Date.UTC(y,m-1,d,h||0,mi||0,s||0)/1000);
        const startSec = toUTC(+fromStr.slice(0,4), +fromStr.slice(5,7), +fromStr.slice(8,10), 0,0,0);
        const endSec   = toUTC(+toStr.slice(0,4),   +toStr.slice(5,7),   +toStr.slice(8,10),   23,59,59);
        if (endSec < startSec) { alert('"To" must be \u2265 "From".'); return; }

        const btnRun  = document.getElementById('met-run');
        const btnStop = document.getElementById('met-stop');
        met_abortCtrl = new AbortController();
        if (btnRun) btnRun.disabled = true;
        if (btnStop) btnStop.disabled = false;
        met_setError("");

        try {
            const seenIds = new Set(); const collected = [];
            let cursorTo = endSec;

            while (cursorTo >= startSec) {
                if (met_abortCtrl.signal.aborted) throw new Error("Aborted");
                const { crimes } = await met_fetchCrimesBatch({ key, startSec, endSec: cursorTo, signal: met_abortCtrl.signal });
                const count = crimes.length;
                if (!count) break;
                for (const c of crimes) {
                    const id = c?.id;
                    if (id != null && !seenIds.has(id)) { seenIds.add(id); collected.push(c); }
                }
                if (count < MET_API_PAGE_CAP) break;
                const asc = [...new Set(crimes.map(c => c.executed_at))].sort((a,b)=>a-b);
                const min = asc[0], secondMin = asc.length >= 2 ? asc[1] : NaN;
                let nextTo = Number.isFinite(secondMin) ? secondMin : (min - 1);
                if (!(nextTo < cursorTo)) nextTo = cursorTo - 1;
                if (nextTo < startSec) break;
                cursorTo = nextTo;
                await met_delay(150);
            }

            const ranged = collected.filter(c => c.executed_at >= startSec && c.executed_at <= endSec);

            await met_ensureItemInfo(key);
            const idSet   = new Set(ranged.map(c => c.id));
            const maxPaid = met_getMaxPaidAt(ranged);
            const newsEnd = Number.isFinite(maxPaid) ? Math.max(endSec, maxPaid) : endSec;

            let ocExpenseMap = new Map();
            let paidToMembersByCrime = new Map();
            let grossTotalByCrime = new Map();
            try {
                const news = await met_fetchNewsExpenses({
                    key, startSec, endSec: newsEnd, includeCrimeIds: idSet, signal: met_abortCtrl.signal
                });
                paidToMembersByCrime = news.paidToMembersByCrime || new Map();
                grossTotalByCrime    = news.grossTotalByCrime    || new Map();
                ocExpenseMap = met_buildOcExpenseMap(ranged, paidToMembersByCrime);
            } catch {}

            const diffDays = Math.ceil(((endSec - startSec + 1) * 1000) / (24*3600*1000));
            const { totals } = met_aggregate(ranged);

            const { byKey: itemEstByKeyMV, total: itemEstTotalMV } = met_buildItemEstByKey(totals.ocBreakdown);
            const { byKey: itemEstByKeyPaid, total: itemEstTotalPaid } = met_buildOcTimeItemEstByKey(ranged, grossTotalByCrime);

            let totalIncome = 0; for (const b of totals.ocBreakdown.values()) totalIncome += Math.round(b.income || 0);
            let totalPaid   = 0; for (const v of ocExpenseMap.values()) totalPaid += Math.round(v || 0);

            const netTotalMV   = totalIncome + itemEstTotalMV   - totalPaid;
            const netTotalPaid = totalIncome + itemEstTotalPaid - totalPaid;

            met_lastRender = {
                totals, diffDays, totalPaid,
                ocExpenseMap,
                itemEstByKeyMV, netTotalMV,
                itemEstByKeyPaid, netTotalPaid,
            };

            const mode = met_getValueMode();
            met_renderFromCache(mode);
        } catch (e) {
            if (e?.message !== "Aborted") met_setError(e?.message || "Unexpected error.");
        } finally {
            if (btnRun)  btnRun.disabled = false;
            if (btnStop) btnStop.disabled = true;
        }
    }

    // --- Metrics tab initialization ---
    function met_initTab() {
        if (met_loaded) return;
        met_loaded = true;

        const container = document.getElementById('oc-tab-metrics');
        if (!container) return;

        // Set default date range (last 7 days)
        const now = new Date();
        const toY = now.getUTCFullYear(), toM = now.getUTCMonth()+1, toD = now.getUTCDate();
        const fromDate = new Date(Date.UTC(toY, toM-1, toD-6));
        const iso = (d) => d.getUTCFullYear() + '-' + String(d.getUTCMonth()+1).padStart(2,"0") + '-' + String(d.getUTCDate()).padStart(2,"0");

        container.innerHTML = ''
            + '<div class="met-controls">'
            + '  <div class="met-ctrl-row">'
            + '    <label class="met-label">From</label>'
            + '    <input type="date" id="met-from" class="met-date-input" value="' + iso(fromDate) + '"/>'
            + '    <label class="met-label">To</label>'
            + '    <input type="date" id="met-to" class="met-date-input" value="' + iso(now) + '"/>'
            + '    <span class="met-pill-seg" id="met-valuemode">'
            + '      <button type="button" data-mode="mv" class="met-seg-btn">Current MV</button>'
            + '      <button type="button" data-mode="paid" class="met-seg-btn">OC-Time</button>'
            + '    </span>'
            + '    <span id="met-status" style="color:#f87171;font-size:11px;display:none;margin-left:6px;"></span>'
            + '    <span class="met-ctrl-right">'
            + '      <button id="met-copy" class="met-btn" style="display:none;" title="Copy summary">Copy</button>'
            + '      <button id="met-stop" class="met-btn" title="Stop" disabled>\u25A0 Stop</button>'
            + '      <button id="met-run" class="met-btn met-btn-primary" title="Run">\u25B6 Run</button>'
            + '    </span>'
            + '  </div>'
            + '</div>'
            + '<div id="met-totals"></div>'
            + '<div id="met-ocbreak" style="margin-top:8px;">\u2014 Click Run to fetch metrics.</div>';

        // Wire up buttons
        document.getElementById('met-run')?.addEventListener('click', met_runQuery);
        document.getElementById('met-stop')?.addEventListener('click', () => met_abortCtrl?.abort());

        // Copy button
        document.getElementById('met-copy')?.addEventListener('click', (ev) => {
            const btn = ev.currentTarget;
            const txt = met_buildSummaryTSV();
            if (!txt) { met_setError("Nothing to copy yet."); return; }
            // TornPDA-compatible copy
            try {
                const ta = document.createElement('textarea');
                ta.value = txt; ta.style.cssText = 'position:fixed;left:-9999px;';
                document.body.appendChild(ta); ta.select();
                document.execCommand('copy'); document.body.removeChild(ta);
            } catch {}
            const prev = btn.textContent;
            btn.textContent = "Copied \u2713";
            btn.disabled = true;
            setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 2000);
        });

        // KPI click-to-copy
        document.getElementById('met-totals')?.addEventListener('click', (ev) => {
            const sel = window.getSelection ? String(window.getSelection()) : "";
            if (sel && sel.trim().length) return;
            const kpi = ev.target?.closest?.('.met-kpi');
            if (!kpi) return;
            const label = kpi.querySelector('.met-kpi-label')?.textContent?.trim() || "KPI";
            const value = kpi.querySelector('.met-kpi-value')?.textContent?.trim() || "";
            const sub   = kpi.querySelector('.met-kpi-sub')?.textContent?.trim() || "";
            const txt = sub ? label + "\t" + value + "\t" + sub : label + "\t" + value;
            try {
                const ta = document.createElement('textarea');
                ta.value = txt; ta.style.cssText = 'position:fixed;left:-9999px;';
                document.body.appendChild(ta); ta.select();
                document.execCommand('copy'); document.body.removeChild(ta);
            } catch {}
            kpi.style.outline = '2px solid #2d4a3e';
            kpi.style.filter = 'brightness(1.06)';
            setTimeout(() => { kpi.style.outline = ''; kpi.style.filter = ''; }, 1500);
        });

        // Value mode toggle
        const wrap = document.getElementById('met-valuemode');
        if (wrap) {
            const mode = met_getValueMode();
            wrap.querySelectorAll('.met-seg-btn').forEach(b => {
                b.classList.toggle('met-seg-active', b.getAttribute('data-mode') === mode);
            });
            wrap.addEventListener('click', (ev) => {
                const btn = ev.target?.closest?.('button[data-mode]');
                if (!btn) return;
                const next = btn.getAttribute('data-mode');
                if (next !== MET_VALUE_MODES.MV && next !== MET_VALUE_MODES.PAID) return;
                met_setValueMode(next);
                wrap.querySelectorAll('.met-seg-btn').forEach(b => {
                    b.classList.toggle('met-seg-active', b.getAttribute('data-mode') === next);
                });
                if (met_lastRender) met_renderFromCache(next);
            });
        }

        // Mobile expandable rows
        container.addEventListener('click', (ev) => {
            const row = ev.target?.closest?.('tr.met-main-row');
            if (!row) return;
            if (ev.target.closest('a')) return;
            const details = row.nextElementSibling;
            if (!details || !details.classList.contains('met-row-details')) return;
            const open = details.classList.contains('met-open');
            if (open) {
                details.classList.remove('met-open');
                row.setAttribute('aria-expanded', 'false');
            } else {
                details.classList.add('met-open');
                row.setAttribute('aria-expanded', 'true');
            }
        });
    }

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

        // Scope auto-push removed — scope is saved manually via Settings
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
    //  OC MANAGER  — constants, state, and core logic
    // ═══════════════════════════════════════════════════════════════════════
    const BLACKLISTED_ITEM_IDS = new Set([226]);
    const mgr_memberNameMap = new Map();
    let   mgr_membersLoaded = false;
    const mgr_armoryCache   = new Map();
    let   mgr_lastRefreshTime = 0;
    const MGR_REFRESH_COOLDOWN_MS = 10000;
    const mgr_recentlyLoaned = new Map(); // Map<string (UID), Set<number (IID)>>
    let   mgr_preparedArmoryID = null;
    let   mgr_pendingArmoryItemID = null;

    const ITEM_TYPE_TO_ARMORY_TAB = {
        'Tool': 'utilities', 'Drug': 'drugs', 'Medical': 'medical',
        'Booster': 'boosters', 'Temporary': 'temporary', 'Clothing': 'clothing', 'Armor': 'armor'
    };
    const ARMORY_TAB_TO_POST_TYPE = {
        'utilities': 'Tool', 'drugs': 'Drug', 'medical': 'Medical',
        'boosters': 'Booster', 'temporary': 'Temporary', 'clothing': 'Clothing', 'armor': 'Armor', 'weapons': 'Primary'
    };
    const ARMORY_API_SELECTIONS = ['utilities', 'drugs', 'medical', 'boosters', 'temporary', 'armor', 'weapons', 'caches'];
    const ARMORY_CATEGORIES = ['utilities', 'drugs', 'medical', 'boosters', 'temporary', 'clothing', 'armor', 'armour']; // page AJAX categories (loan/retrieve only)

    // --- Utilities ---
    const mgr_getRfcvToken = () => {
        const match = document.cookie.match(/rfc_v=([^;]+)/);
        return match ? match[1] : null;
    };
    const mgr_formatNumber = (num) => num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

    // --- Item name cache (localStorage) ---
    const ITEM_NAME_CACHE_KEY = 'OCLM_ITEM_ID_NAME_MAP';
    const mgr_getItemNameMap = () => { try { return JSON.parse(localStorage.getItem(ITEM_NAME_CACHE_KEY) || '{}'); } catch { return {}; } };
    const mgr_setItemName = (itemID, name) => {
        const map = mgr_getItemNameMap();
        if (!map[itemID]) { map[itemID] = name; try { localStorage.setItem(ITEM_NAME_CACHE_KEY, JSON.stringify(map)); } catch {} }
    };
    const mgr_getItemName = (itemID) => mgr_getItemNameMap()[itemID] || null;

    // --- API helpers (use fetch directly with Torn API key) ---
    const mgr_loadMembers = async () => {
        if (mgr_membersLoaded) return;
        const key = getApiKey();
        if (!key || key === 'YOUR_API_KEY_HERE') throw new Error('API key required');
        const res = await fetch(`https://api.torn.com/v2/faction/members?key=${key}`);
        if (!res.ok) throw new Error('Failed to load members');
        const data = await res.json();
        const members = Array.isArray(data?.members) ? data.members : Object.values(data?.members || {});
        members.forEach(m => mgr_memberNameMap.set(String(m.id), m.name));
        mgr_membersLoaded = true;
    };

    const mgr_getMissingOCItems = async () => {
        const key = getApiKey();
        if (!key || key === 'YOUR_API_KEY_HERE') throw new Error('API key required');
        const res = await fetch(`https://api.torn.com/v2/faction/crimes?cat=available&key=${key}`);
        if (!res.ok) throw new Error('Failed to load OC data');
        const data = await res.json();
        const missing = [];
        const crimes = Array.isArray(data?.crimes) ? data.crimes : Object.values(data?.crimes || {});
        crimes.forEach(crime => {
            crime.slots?.forEach(slot => {
                if (slot.item_requirement && !slot.item_requirement.is_available && slot.user?.id && !BLACKLISTED_ITEM_IDS.has(Number(slot.item_requirement.id))) {
                    missing.push({
                        crimeName: crime.name, position: slot.position,
                        itemID: Number(slot.item_requirement.id),
                        userID: slot.user.id,
                        userName: mgr_memberNameMap.get(String(slot.user.id)) || `Unknown [${slot.user.id}]`
                    });
                }
            });
        });
        return missing;
    };

    const mgr_getAllOCItemRequirements = async () => {
        const key = getApiKey();
        if (!key || key === 'YOUR_API_KEY_HERE') throw new Error('API key required');
        const res = await fetch(`https://api.torn.com/v2/faction/crimes?cat=available&key=${key}`);
        if (!res.ok) throw new Error('Failed to load OC data');
        const data = await res.json();
        const neededByUser = new Map();
        const crimes = Array.isArray(data?.crimes) ? data.crimes : Object.values(data?.crimes || {});
        crimes.forEach(crime => {
            crime.slots?.forEach(slot => {
                if (slot.item_requirement && slot.user?.id) {
                    const uid = String(slot.user.id);
                    const iid = Number(slot.item_requirement.id);
                    if (!neededByUser.has(uid)) neededByUser.set(uid, new Set());
                    neededByUser.get(uid).add(iid);
                }
            });
        });
        return neededByUser;
    };

    const mgr_getUnpaidCompletedCrimes = async () => {
        const key = getApiKey();
        if (!key || key === 'YOUR_API_KEY_HERE') throw new Error('API key required');
        const now = Math.floor(Date.now() / 1000);
        const thirtyDaysAgo = now - (30 * 24 * 60 * 60);
        const res = await fetch(`https://api.torn.com/v2/faction/crimes?cat=successful&filter=executed_at&from=${thirtyDaysAgo}&to=${now}&sort=DESC&limit=100&key=${key}`);
        if (!res.ok) throw new Error('Failed to load completed crimes');
        const data = await res.json();
        if (data?.error) throw new Error(`API error: ${data.error.error || JSON.stringify(data.error)}`);
        const crimes = Array.isArray(data?.crimes) ? data.crimes : (data?.crimes && typeof data.crimes === 'object' ? Object.values(data.crimes) : []);
        const unpaid = [];
        for (const c of crimes) {
            const paidAt = c?.rewards?.payout?.paid_at;
            if (paidAt) continue;
            const money = Number(c?.rewards?.money || 0);
            const respect = Number(c?.rewards?.respect || 0);
            const hasItems = Array.isArray(c?.rewards?.items) ? c.rewards.items.length > 0 : false;
            if (money <= 0 && respect <= 0 && !hasItems) continue;
            unpaid.push({ id: c.id, name: c.name || 'Unknown OC', difficulty: c.difficulty || null, executedAt: c.executed_at, money, respect, hasItems, payoutPct: c?.rewards?.payout?.percentage ?? null });
        }
        return unpaid;
    };

    const mgr_resolveItemNames = async (itemIDs) => {
        const unknown = itemIDs.filter(id => !mgr_getItemName(id));
        if (unknown.length === 0) return;
        const unique = [...new Set(unknown)];
        try {
            const key = getApiKey();
            if (!key || key === 'YOUR_API_KEY_HERE') return;
            const res = await fetch(`https://api.torn.com/v2/torn/items?ids=${unique.join(',')}&key=${key}`);
            const data = await res.json();
            const items = Array.isArray(data?.items) ? data.items : Object.values(data?.items || {});
            items.forEach(item => { if (item.id && item.name) mgr_setItemName(item.id, item.name); });
        } catch { /* ignore */ }
    };

    // --- Armory Cache (reads via Torn API, actions via page AJAX) ---
    const mgr_fetchAllArmoryItemsAPI = async () => {
        const key = getApiKey();
        if (!key || key === 'YOUR_API_KEY_HERE') throw new Error('API key required');
        const selections = ARMORY_API_SELECTIONS.join(',');
        const r = await gmRequest(`https://api.torn.com/v2/faction/?selections=${selections}&key=${encodeURIComponent(key)}`);
        if (!r.ok) throw new Error('Failed to load armory data');
        const data = r.data;
        const allItems = [];
        for (const sel of ARMORY_API_SELECTIONS) {
            const items = Array.isArray(data?.[sel]) ? data[sel] : [];
            const category = sel === 'weapons' ? 'weapons' : sel;
            for (const item of items) {
                if (item.ID && item.name) mgr_setItemName(item.ID, item.name);
                allItems.push({
                    itemID: Number(item.ID), name: item.name, type: item.type,
                    quantity: item.quantity || 0, available: item.available ?? item.quantity ?? 0,
                    loaned: item.loaned || 0, loaned_to: item.loaned_to || null,
                    armoryCategory: category
                });
            }
        }
        return allItems;
    };

    // Page AJAX: fetch armoryIDs for a specific category (only used for loan/retrieve actions)
    const mgr_fetchArmoryIDsForCategory = async (category) => {
        const rfcv = mgr_getRfcvToken();
        if (!rfcv) throw new Error('Missing RFCV token');
        const ids = [];
        let start = 0;
        while (start < 1000) {
            const body = new URLSearchParams({ step: 'armouryTabContent', type: category, start: String(start), ajax: 'true' });
            const res = await fetch(`https://www.torn.com/factions.php?rfcv=${rfcv}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
                body, credentials: 'same-origin'
            });
            if (!res.ok) break;
            try {
                const data = await res.json();
                if (!data?.items) break;
                const itemsArr = Array.isArray(data.items) ? data.items : Object.values(data.items);
                if (itemsArr.length === 0) break;
                let added = 0;
                for (const entry of itemsArr) {
                    const isUnused = entry.user === false || entry.user === '' || entry.user === 0 || (entry.user && !entry.user.userID);
                    if (isUnused && entry.armoryID) {
                        ids.push({ armoryID: entry.armoryID, itemID: Number(entry.itemID) });
                        added++;
                    }
                }
                if (added === 0 && itemsArr.length < 50) break;
                if (itemsArr.length < 50) break;
                start += 50;
            } catch (e) { break; }
        }
        return ids;
    };

    const mgr_refreshArmoryCache = async (force = false) => {
        const now = Date.now();
        if (!force && mgr_armoryCache.size > 0 && (now - mgr_lastRefreshTime < MGR_REFRESH_COOLDOWN_MS)) return;
        mgr_armoryCache.clear();
        const items = await mgr_fetchAllArmoryItemsAPI();
        for (const entry of items) {
            const avail = entry.available || 0;
            if (avail > 0) {
                if (!mgr_armoryCache.has(entry.itemID)) {
                    mgr_armoryCache.set(entry.itemID, { armoryIDs: [], qty: avail, armoryCategory: entry.armoryCategory });
                } else {
                    const cached = mgr_armoryCache.get(entry.itemID);
                    cached.qty += avail;
                }
            }
        }
        mgr_lastRefreshTime = Date.now();
    };

    const mgr_getPostTypeForItem = (itemID) => {
        const cached = mgr_armoryCache.get(itemID);
        return (cached?.armoryCategory ? ARMORY_TAB_TO_POST_TYPE[cached.armoryCategory] : null) || 'Tool';
    };

    const mgr_prepareArmouryForItem = async (itemID) => {
        if (!mgr_armoryCache.has(itemID)) await mgr_refreshArmoryCache(true);
        else await mgr_refreshArmoryCache(false);
        const entry = mgr_armoryCache.get(itemID);
        if (!entry || entry.qty <= 0) return null;
        // Fetch armoryID from page AJAX (user-initiated action)
        const category = entry.armoryCategory || 'utilities';
        // Try both singular and alternate names for the page AJAX category
        const categoriesToTry = [category];
        if (category === 'armor') categoriesToTry.push('armour');
        let armoryID = null;
        for (const cat of categoriesToTry) {
            const ids = await mgr_fetchArmoryIDsForCategory(cat);
            const match = ids.find(i => i.itemID === itemID);
            if (match) { armoryID = match.armoryID; break; }
        }
        if (!armoryID) return null;
        mgr_preparedArmoryID = armoryID;
        mgr_pendingArmoryItemID = itemID;
        return mgr_preparedArmoryID;
    };

    const mgr_loanItem = async ({ armoryID, itemID, userID, userName }) => {
        const rfcv = mgr_getRfcvToken();
        if (!rfcv) throw new Error('Missing RFCV token');
        const itemPostType = mgr_getPostTypeForItem(itemID);
        const body = new URLSearchParams({ ajax: 'true', step: 'armouryActionItem', role: 'loan', item: armoryID, itemID: itemID, type: itemPostType, user: `${userName} [${userID}]`, quantity: '1' });
        const res = await fetch(`https://www.torn.com/factions.php?rfcv=${rfcv}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
            body, credentials: 'same-origin'
        });
        if (!res.ok) throw new Error('Loan request failed');
        const text = await res.text();
        if (!text.includes('success')) throw new Error('Loan failed');
    };

    const mgr_loanPreparedItem = async ({ userID, userName }) => {
        if (!mgr_preparedArmoryID || mgr_pendingArmoryItemID === null) throw new Error('Armoury not prepared');
        const itemID = mgr_pendingArmoryItemID;
        await mgr_loanItem({ armoryID: mgr_preparedArmoryID, itemID: mgr_pendingArmoryItemID, userID, userName });
        const entry = mgr_armoryCache.get(mgr_pendingArmoryItemID);
        if (entry) {
            entry.qty -= 1;
            entry.armoryIDs.shift();
            if (entry.qty <= 0 || entry.armoryIDs.length === 0) mgr_armoryCache.delete(mgr_pendingArmoryItemID);
        }
        const uid = String(userID);
        if (!mgr_recentlyLoaned.has(uid)) mgr_recentlyLoaned.set(uid, new Set());
        mgr_recentlyLoaned.get(uid).add(itemID);
        mgr_preparedArmoryID = null; mgr_pendingArmoryItemID = null;
    };

    const mgr_retrieveItem = async ({ armoryID, itemID, userID, userName, postType }) => {
        const rfcv = mgr_getRfcvToken();
        if (!rfcv) throw new Error('Missing RFCV token');
        const itemPostType = postType || mgr_getPostTypeForItem(itemID);
        const body = new URLSearchParams({ ajax: 'true', step: 'armouryActionItem', role: 'retrieve', item: armoryID, itemID: itemID, type: itemPostType, user: `${userName} [${userID}]`, quantity: '1' });
        const res = await fetch(`https://www.torn.com/factions.php?rfcv=${rfcv}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
            body, credentials: 'same-origin'
        });
        if (!res.ok) throw new Error('Retrieve request failed');
        const text = await res.text();
        if (!text.includes('success')) throw new Error('Retrieve failed');
        const uid = String(userID);
        if (mgr_recentlyLoaned.has(uid)) { mgr_recentlyLoaned.get(uid).delete(itemID); if (mgr_recentlyLoaned.get(uid).size === 0) mgr_recentlyLoaned.delete(uid); }
    };

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
                scope:                cfg.SCOPE !== null ? cfg.SCOPE : '',
                engine_slot_optimizer:   cfg.ENGINE_SLOT_OPTIMIZER,
                engine_cpr_forecaster:   cfg.ENGINE_CPR_FORECASTER,
                engine_failure_risk:     cfg.ENGINE_FAILURE_RISK,
                engine_expiry_risk:      cfg.ENGINE_EXPIRY_RISK,
                engine_member_reliability: cfg.ENGINE_MEMBER_RELIABILITY,
                engine_payout_optimizer: cfg.ENGINE_PAYOUT_OPTIMIZER,
                engine_item_roi:         cfg.ENGINE_ITEM_ROI,
                engine_nerve_efficiency: cfg.ENGINE_NERVE_EFFICIENCY,
                engine_gap_analyzer:     cfg.ENGINE_GAP_ANALYZER,
                engine_member_projector: cfg.ENGINE_MEMBER_PROJECTOR,
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
        const scriptVer = SCRIPT_VERSION;
        const r = await gmRequest(`${SERVER}/api/oc/spawn-key?key=${encodeURIComponent(apiKey)}&v=${scriptVer}`);
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
        .oc-engine-toggle { display:flex; align-items:center; gap:6px; padding:4px 0; font-size:11px; color:#d1d5db; cursor:pointer; flex-wrap:wrap; }
        .oc-engine-toggle input[type=checkbox] { accent-color:#2d6a4f; width:14px; height:14px; cursor:pointer; }
        .oc-engine-toggle span:first-of-type { font-weight:600; min-width:120px; }
        .oc-engine-desc { color:#6b7280; font-size:10px; font-weight:400; }
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
            min-width: 180px; max-width: 260px; display: none; pointer-events: auto;
        }
        #oc-rec-tooltip .oc-tt-title { font-weight: 600; color: #f3f4f6; margin-bottom: 5px; font-size: 12px; }
        #oc-rec-tooltip .oc-tt-note  { color: #6b7280; font-size: 10px; margin-top: 5px; }
        /* Manager sub-tab bar */
        .mgr-sub-tab-bar { display: flex; gap: 0; border-bottom: 1px solid #2d4a3e; margin-bottom: 10px; }
        .mgr-sub-tab { background: none; border: none; border-bottom: 2px solid transparent; color: #6b7280; padding: 5px 14px; cursor: pointer; font-family: inherit; font-size: 11px; font-weight: 500; margin-bottom: -1px; transition: color .15s; }
        .mgr-sub-tab:hover:not(.mgr-sub-tab-active) { color: #d1d5db; }
        .mgr-sub-tab-active { color: #74c69d; border-bottom-color: #74c69d; }
        /* Manager cards */
        .mgr-card { background: #111f18; border: 1px solid #253525; border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; transition: border-color .2s; }
        .mgr-card:hover { border-color: #2d6a4f; }
        .mgr-card-header { display: flex; justify-content: space-between; margin-bottom: 6px; align-items: flex-start; }
        .mgr-crime-name { font-weight: 700; font-size: 12px; color: #f3f4f6; flex: 1; padding-right: 8px; }
        .mgr-pos-tag { font-size: 9px; padding: 2px 6px; background: rgba(116,198,157,.1); border-radius: 4px; color: #74c69d; text-transform: uppercase; }
        .mgr-card-body { font-size: 11px; color: #9ca3af; line-height: 1.5; }
        .mgr-item-row, .mgr-player-row { display: flex; align-items: center; gap: 8px; margin-top: 3px; }
        .mgr-label { color: #6b7280; width: 42px; flex-shrink: 0; font-size: 10px; }
        .mgr-value { color: #f3f4f6; font-size: 11px; }
        .mgr-player-link { color: #74c69d; text-decoration: none; font-weight: 500; font-size: 11px; }
        .mgr-player-link:hover { text-decoration: underline; }
        .mgr-action-btn { width: 100%; margin-top: 8px; padding: 8px; border-radius: 6px; border: none; font-weight: 700; font-size: 11px; cursor: pointer; transition: all .2s; display: flex; align-items: center; justify-content: center; gap: 5px; }
        .mgr-btn-loan { background: #2d6a4f; color: #fff; }
        .mgr-btn-loan:hover:not(:disabled) { background: #1b4332; }
        .mgr-btn-retrieve { background: rgba(200,60,60,.1); color: #c33; border: 1px solid rgba(200,60,60,.2); }
        .mgr-btn-retrieve:hover:not(:disabled) { background: rgba(200,60,60,.2); }
        .mgr-btn-success { background: #1b4332 !important; color: #74c69d !important; }
        .mgr-btn-warning { background: #3d3010 !important; color: #f4a261 !important; }
        .mgr-summary-box { background: rgba(116,198,157,.08); border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid rgba(116,198,157,.2); }
        .mgr-summary-label { font-size: 10px; color: #74c69d; text-transform: uppercase; font-weight: 700; margin-bottom: 3px; letter-spacing: 0.4px; }
        .mgr-summary-amount { font-size: 16px; font-weight: 800; color: #f3f4f6; }
        .mgr-summary-detail { font-size: 11px; color: #6b7280; }
        .mgr-payout-link { display: block; margin-top: 10px; padding: 8px; background: #2d6a4f; color: #fff; text-align: center; border-radius: 6px; text-decoration: none; font-weight: 700; font-size: 12px; }
        .mgr-payout-link:hover { background: #1b4332; }
        .mgr-payout-card { text-decoration: none; color: inherit; display: block; }
        .mgr-loading { text-align: center; color: #6b7280; padding: 30px; font-size: 12px; }
        .mgr-ok { text-align: center; color: #74c69d; padding: 30px; font-size: 13px; font-weight: 600; }
        .mgr-error { text-align: center; color: #f87171; padding: 16px; font-size: 12px; }
        .mgr-sub-content { min-height: 60px; }

        /* ═══════════════════════════════════════════════════════════════════
           METRICS TAB STYLES
           ═══════════════════════════════════════════════════════════════════ */
        .met-controls { margin-bottom: 10px; }
        .met-ctrl-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
        .met-label { font-size: 11px; color: #6b7280; }
        .met-date-input { padding: 4px 6px; background: #0d1b2a; color: #f3f4f6; border: 1px solid #2d4a3e; border-radius: 4px; font-size: 11px; font-family: monospace; }
        .met-btn { padding: 4px 10px; background: #152018; color: #74c69d; border: 1px solid #2d4a3e; border-radius: 6px; cursor: pointer; font-size: 11px; font-family: inherit; font-weight: 600; }
        .met-btn:hover { background: #253525; color: #fff; }
        .met-btn:disabled { opacity: .4; cursor: default; }
        .met-btn-primary { background: #2d6a4f; color: #fff; }
        .met-btn-primary:hover:not(:disabled) { background: #1b4332; }
        .met-ctrl-right { margin-left: auto; display: flex; gap: 6px; }
        .met-pill-seg { display: inline-flex; border: 1px solid #2d4a3e; border-radius: 20px; overflow: hidden; }
        .met-seg-btn { background: transparent; border: 0; padding: 3px 10px; cursor: pointer; font-size: 11px; color: #9ca3af; font-family: inherit; }
        .met-seg-btn + .met-seg-btn { border-left: 1px solid #2d4a3e; }
        .met-seg-btn.met-seg-active { background: #253525; color: #74c69d; font-weight: 700; }
        /* KPI cards */
        .met-kpis { display: grid; gap: 6px; grid-template-columns: repeat(3, minmax(0,1fr)); margin-bottom: 8px; }
        @media (min-width:560px) { .met-kpis { grid-template-columns: repeat(5, minmax(0,1fr)); } }
        .met-kpi { background: #111f18; border: 1px solid #253525; border-radius: 8px; padding: 6px 8px; min-width: 0; box-sizing: border-box; cursor: pointer; transition: border-color .2s; }
        .met-kpi:hover { border-color: #2d6a4f; }
        .met-kpi-label { font-size: 11px; color: #6b7280; }
        .met-kpi-value { font-weight: 700; font-size: 14px; color: #f3f4f6; }
        .met-kpi-sub { font-size: 11px; color: #9ca3af; text-align: right; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        /* OC breakdown table */
        .met-table th { text-align: center !important; }
        .met-table td:first-child { text-align: left; }
        .met-w-min { width: 1%; white-space: nowrap; }
        .met-center { text-align: center; }
        .met-oc-name { white-space: nowrap; }
        .met-items-col { white-space: normal; }
        .met-items-list { margin: 0; padding-left: 18px; list-style: disc; }
        .met-items-list li { margin: 0; padding: 0; font-size: 11px; color: #f3f4f6; }
        .met-details-wrap { padding: 8px 10px; font-size: 12px; color: #d1d5db; }
        /* Mobile responsive */
        @media (max-width: 560px) {
            .met-col-runs, .met-col-items, .met-col-paid { display: none; }
            tr.met-main-row { cursor: pointer; }
            tr.met-main-row:hover td { background: #131f18; }
            td.met-oc-name { position: relative; padding-left: 22px; }
            td.met-oc-name::before { content: "▸"; position: absolute; left: 6px; top: 50%; transform: translateY(-50%); opacity: .85; }
            tr.met-main-row[aria-expanded="true"] td.met-oc-name::before { content: "▾"; }
            .met-row-details { display: none; background: #111f18; }
            .met-row-details.met-open { display: table-row; }
            .met-w-min { width: auto; }
            .met-oc-name { white-space: normal; }
        }
        @media (min-width: 561px) { .met-row-details { display: none !important; } }
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
            OC Spawn Assistance <span style="font-size:10px;font-weight:400;color:#6b7280;">v${SCRIPT_VERSION}</span>
            <span style="display:flex;gap:6px;align-items:center;">
                <button id="oc-spawn-refresh">↻ Refresh</button>
                <button id="oc-spawn-settings" class="oc-hdr-btn" title="Settings">⚙</button>
                <button id="oc-spawn-close" class="oc-hdr-btn">✕</button>
            </span>
        </h2>
        <div id="oc-spawn-status">Click Refresh to load data.</div>
        <div id="oc-sub-timer" style="display:none;color:#6b7280;font-size:10px;margin:-4px 0 8px;"></div>

        <div id="oc-settings-panel">
            <div class="oc-setting-row">
                <div class="oc-setting-info">
                    <span class="oc-setting-label">API Key</span>
                    <div class="oc-setting-desc">Your personal Torn API key (<b style="color:#e5b567;">Limited Access</b> or higher required for Admin/Manager/Metrics tabs).</div>
                    <div class="oc-setting-key-wrap">
                        <input id="oc-spawn-key-input" type="text" placeholder="Paste API key…" class="oc-setting-key-input"/>
                        <button id="oc-spawn-key-save" class="oc-setting-save-btn">Save</button>
                    </div>
                </div>
            </div>
            <div id="oc-cfg-section" style="display:none;">
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

            <div style="text-align:right;margin-top:4px;">
                <button id="oc-spawn-cfg-save" class="oc-setting-save-btn" disabled>Save for All Members</button>
            </div>

            <div style="margin-top:12px;border-top:1px solid #374151;padding-top:10px;">
                <div style="font-size:11px;font-weight:600;color:#f3f4f6;margin-bottom:8px;">Engines</div>

                <div style="font-size:10px;color:#9ca3af;margin-bottom:6px;font-weight:600;">Optimization</div>
                <label class="oc-engine-toggle"><input type="checkbox" id="eng-slot-optimizer"/> <span>Slot Optimizer</span><span class="oc-engine-desc">Auto-calculate best member-to-slot assignments</span></label>
                <label class="oc-engine-toggle"><input type="checkbox" id="eng-cpr-forecaster"/> <span>CPR Forecaster</span><span class="oc-engine-desc">Project member CPR trends over time</span></label>

                <div style="font-size:10px;color:#9ca3af;margin:8px 0 6px;font-weight:600;">Risk</div>
                <label class="oc-engine-toggle"><input type="checkbox" id="eng-failure-risk"/> <span>Failure Risk</span><span class="oc-engine-desc">Score OC failure probability before launch</span></label>
                <label class="oc-engine-toggle"><input type="checkbox" id="eng-expiry-risk"/> <span>Expiry Risk</span><span class="oc-engine-desc">Flag OCs at risk of expiring unfilled</span></label>
                <label class="oc-engine-toggle"><input type="checkbox" id="eng-member-reliability"/> <span>Member Reliability</span><span class="oc-engine-desc">Track member availability and completion rates</span></label>

                <div style="font-size:10px;color:#9ca3af;margin:8px 0 6px;font-weight:600;">Economy</div>
                <label class="oc-engine-toggle"><input type="checkbox" id="eng-payout-optimizer"/> <span>Payout Optimizer</span><span class="oc-engine-desc">Identify highest-return crime types per nerve</span></label>
                <label class="oc-engine-toggle"><input type="checkbox" id="eng-item-roi"/> <span>Item ROI</span><span class="oc-engine-desc">Track item costs vs OC payout returns</span></label>
                <label class="oc-engine-toggle"><input type="checkbox" id="eng-nerve-efficiency"/> <span>Nerve Efficiency</span><span class="oc-engine-desc">Calculate cash per nerve across crime types</span></label>

                <div style="font-size:10px;color:#9ca3af;margin:8px 0 6px;font-weight:600;">Recruitment</div>
                <label class="oc-engine-toggle"><input type="checkbox" id="eng-gap-analyzer"/> <span>Gap Analyzer</span><span class="oc-engine-desc">Identify which roles/levels your faction needs</span></label>
                <label class="oc-engine-toggle"><input type="checkbox" id="eng-member-projector"/> <span>Member Projector</span><span class="oc-engine-desc">Estimate new member OC potential</span></label>
            </div>

            </div><!-- /oc-cfg-section -->
        </div>

        <div id="oc-tab-bar" class="oc-tab-bar" style="display:none;">
            <button class="oc-tab oc-tab-active" data-tab="profile">My OC</button>
            <button class="oc-tab" data-tab="admin" id="oc-admin-tab" style="display:none;">Admin</button>
            <button class="oc-tab" data-tab="manager" id="oc-manager-tab" style="display:none;">Manager</button>
            <button class="oc-tab" data-tab="metrics" id="oc-metrics-tab" style="display:none;">Metrics</button>
        </div>
        <div id="oc-tab-profile"></div>
        <div id="oc-tab-admin" style="display:none;"></div>
        <div id="oc-tab-manager" style="display:none;"></div>
        <div id="oc-tab-metrics" style="display:none;"></div>
    `;
    document.body.appendChild(panel);

    const cprTooltipEl = document.createElement('div');
    cprTooltipEl.id = 'oc-cpr-tooltip';
    document.body.appendChild(cprTooltipEl);

    const recTooltipEl = document.createElement('div');
    recTooltipEl.id = 'oc-rec-tooltip';
    document.body.appendChild(recTooltipEl);

    // Message Player button handler (lives inside tooltip, outside panel)
    recTooltipEl.addEventListener('click', (e) => {
        const mb = e.target.closest('.oc-msg-btn');
        if (!mb) return;
        e.stopPropagation();
        const xid = mb.dataset.xid;
        const msg = mb.dataset.msg;
        // Copy to clipboard (TornPDA-compatible)
        try {
            const ta = document.createElement('textarea');
            ta.value = msg; ta.style.cssText = 'position:fixed;left:-9999px;';
            document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); document.body.removeChild(ta);
        } catch (_) {}
        mb.textContent = 'Copied! Opening…';
        // Navigate (TornPDA-compatible)
        const a = document.createElement('a');
        a.href = `https://www.torn.com/messages.php#/p=compose&XID=${xid}`;
        a.target = '_blank'; a.rel = 'noopener';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
    });

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
        document.getElementById('oc-tab-manager').style.display = name === 'manager' ? '' : 'none';
        document.getElementById('oc-tab-metrics').style.display = name === 'metrics' ? '' : 'none';
        // Close settings panel when switching away from admin
        if (name !== 'admin') document.getElementById('oc-settings-panel').style.display = 'none';
        // Load manager content when switching to it
        if (name === 'manager') loadManagerTab();
        // Init metrics tab when switching to it
        if (name === 'metrics') met_initTab();
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
        // Engine toggles
        document.getElementById('eng-slot-optimizer').checked       = CONFIG.ENGINE_SLOT_OPTIMIZER;
        document.getElementById('eng-cpr-forecaster').checked       = CONFIG.ENGINE_CPR_FORECASTER;
        document.getElementById('eng-failure-risk').checked         = CONFIG.ENGINE_FAILURE_RISK;
        document.getElementById('eng-expiry-risk').checked          = CONFIG.ENGINE_EXPIRY_RISK;
        document.getElementById('eng-member-reliability').checked   = CONFIG.ENGINE_MEMBER_RELIABILITY;
        document.getElementById('eng-payout-optimizer').checked     = CONFIG.ENGINE_PAYOUT_OPTIMIZER;
        document.getElementById('eng-item-roi').checked             = CONFIG.ENGINE_ITEM_ROI;
        document.getElementById('eng-nerve-efficiency').checked     = CONFIG.ENGINE_NERVE_EFFICIENCY;
        document.getElementById('eng-gap-analyzer').checked         = CONFIG.ENGINE_GAP_ANALYZER;
        document.getElementById('eng-member-projector').checked     = CONFIG.ENGINE_MEMBER_PROJECTOR;
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
        if (!settingsReady) { alert('Settings not loaded yet — please Refresh first.'); return; }
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

        // Engine toggles
        CONFIG.ENGINE_SLOT_OPTIMIZER   = document.getElementById('eng-slot-optimizer').checked;
        CONFIG.ENGINE_CPR_FORECASTER   = document.getElementById('eng-cpr-forecaster').checked;
        CONFIG.ENGINE_FAILURE_RISK     = document.getElementById('eng-failure-risk').checked;
        CONFIG.ENGINE_EXPIRY_RISK      = document.getElementById('eng-expiry-risk').checked;
        CONFIG.ENGINE_MEMBER_RELIABILITY = document.getElementById('eng-member-reliability').checked;
        CONFIG.ENGINE_PAYOUT_OPTIMIZER = document.getElementById('eng-payout-optimizer').checked;
        CONFIG.ENGINE_ITEM_ROI         = document.getElementById('eng-item-roi').checked;
        CONFIG.ENGINE_NERVE_EFFICIENCY = document.getElementById('eng-nerve-efficiency').checked;
        CONFIG.ENGINE_GAP_ANALYZER     = document.getElementById('eng-gap-analyzer').checked;
        CONFIG.ENGINE_MEMBER_PROJECTOR = document.getElementById('eng-member-projector').checked;

        // Local persistence
        GM_setValue('cfg_active_days',    CONFIG.ACTIVE_DAYS);
        GM_setValue('cfg_forecast_hours', CONFIG.FORECAST_HOURS);
        GM_setValue('cfg_mincpr',              CONFIG.MINCPR);
        GM_setValue('cfg_cpr_boost',           CONFIG.CPR_BOOST);
        GM_setValue('cfg_lookback_days',       CONFIG.CPR_LOOKBACK_DAYS);
        GM_setValue('cfg_high_weight_pct',     CONFIG.HIGH_WEIGHT_THRESHOLD);
        GM_setValue('cfg_high_weight_mincpr',  CONFIG.HIGH_WEIGHT_MIN_CPR);
        GM_setValue('cfg_scope',               CONFIG.SCOPE);
        GM_setValue('eng_slot_optimizer',       CONFIG.ENGINE_SLOT_OPTIMIZER);
        GM_setValue('eng_cpr_forecaster',       CONFIG.ENGINE_CPR_FORECASTER);
        GM_setValue('eng_failure_risk',         CONFIG.ENGINE_FAILURE_RISK);
        GM_setValue('eng_expiry_risk',          CONFIG.ENGINE_EXPIRY_RISK);
        GM_setValue('eng_member_reliability',   CONFIG.ENGINE_MEMBER_RELIABILITY);
        GM_setValue('eng_payout_optimizer',     CONFIG.ENGINE_PAYOUT_OPTIMIZER);
        GM_setValue('eng_item_roi',             CONFIG.ENGINE_ITEM_ROI);
        GM_setValue('eng_nerve_efficiency',     CONFIG.ENGINE_NERVE_EFFICIENCY);
        GM_setValue('eng_gap_analyzer',         CONFIG.ENGINE_GAP_ANALYZER);
        GM_setValue('eng_member_projector',     CONFIG.ENGINE_MEMBER_PROJECTOR);

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
            const msgText = `Please join ${rec.crime}${rec.position ? ' as ' + rec.position : ''}`;
            const msgBtn = `<button class="oc-msg-btn" data-xid="${uid}" data-msg="${msgText.replace(/"/g, '&quot;')}" style="margin-top:6px;width:100%;padding:4px 8px;background:#2d4a3e;color:#74c69d;border:1px solid #3d6a4e;border-radius:4px;cursor:pointer;font-size:10px;font-weight:600;">Message Player</button>`;
            html = `<div class="oc-tt-title">${rec.crime}</div><div class="oc-tt-avg">Lvl ${rec.level} OC${posStr}</div>${moreStr}${msgBtn}`;
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
    document.addEventListener('click', (e) => {
        // Don't close rec tooltip if clicking inside it (for Message Player button)
        if (recTooltipEl.contains(e.target)) return;
        if (cprTipOpen) hideCprTooltip(); if (scopeTipOpen) hideScopeTooltip(); hideRecTooltip();
    });

    // ═══════════════════════════════════════════════════════════════════════
    //  UTILITY
    // ═══════════════════════════════════════════════════════════════════════
    const now = () => Math.floor(Date.now() / 1000);
    function setStatus(msg) { document.getElementById('oc-spawn-status').textContent = msg; }
    function updateSubTimer(viewer) {
        const el = document.getElementById('oc-sub-timer');
        if (!el || !viewer) return;
        const exp = viewer.subscriptionExpiresAt;
        if (!exp) { el.style.display = 'none'; return; }
        if (exp === 'permanent') {
            el.innerHTML = '\u2705 Subscription: <b style="color:#4ade80;">Permanent</b>';
            el.style.display = 'block'; return;
        }
        const expiresMs = new Date(exp).getTime();
        const nowMs = Date.now();
        const diffMs = expiresMs - nowMs;
        if (diffMs <= 0) {
            el.innerHTML = '\u26a0\ufe0f Subscription: <b style="color:#ef4444;">Expired</b>';
            el.style.display = 'block'; return;
        }
        const days = Math.floor(diffMs / 86400000);
        const hours = Math.floor((diffMs % 86400000) / 3600000);
        const color = days < 3 ? '#ef4444' : days < 7 ? '#e5b567' : '#4ade80';
        el.innerHTML = `\u23f3 Subscription: <b style="color:${color};">${days}d ${hours}h remaining</b>`;
        el.style.display = 'block';
    }
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
            const ocInfo = memberOcMap[uid];
            const inOC   = !!ocInfo;
            // Enrich ALL members with CPR data (needed even for skipped — viewer card uses it)
            const cpr = cprCache[uid] ?? null;
            const cprValue = cpr?.cpr ?? null;
            const highestLvl = cpr?.highestLevel ?? 0;
            // Trust server's per-level joinable (already accounts for per-level CPR vs MINCPR)
            const joinable = cpr?.joinable ?? (cprValue !== null && cprValue >= CONFIG.MINCPR ? highestLvl : 1);
            const enriched = {
                ...m, id: uid, name: m.name, lastAction, status: m.status?.state ?? 'Unknown',
                inOC, ocReadyAt: inOC ? ocInfo?.readyAt : null,
                ocCrimeName: inOC ? ocInfo?.crimeName : null, ocStatus: inOC ? ocInfo?.crimeStatus : null,
                currentCrimeDiff: inOC ? ocInfo?.crimeDifficulty : null,
                cpr: cprValue, highestLevel: highestLvl, joinable,
                noCrimeHistory: cprValue === null,
                cprEstimated: cpr?.estimated || false,
                cprEntries: cpr?.entries ?? [],
                byPosition: cpr?.byPosition ?? {},
            };
            if (lastAction < activeCutoff) { skipped.push({ ...enriched, skipReason: `Inactive >${CONFIG.ACTIVE_DAYS}d` }); continue; }
            if (inOC && ocInfo.readyAt > forecastCutoff) { skipped.push({ ...enriched, skipReason: `In OC (ready ${fmtTs(ocInfo.readyAt)})` }); continue; }
            eligible.push(enriched);
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

            if (totalNeeded === 0) {
                action = 'none';
            } else if (info.totalSlots === 0 && totalNeeded > 0) {
                // No OCs exist at all but members are waiting — recommend spawning 1
                action = 'spawn';
                numOcsToSpawn = 1;
                if (scopeBudget !== null) scopeBudget -= sr.cost;
            } else if (info.openSlots === 0 && numOcsNeeded === 0 && totalNeeded > 0) {
                // OCs exist but full, not enough members for another — show waiting
                action = 'waiting';
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

    // ═══════════════════════════════════════════════════════════════════════
    //  ENGINE RENDERERS
    // ═══════════════════════════════════════════════════════════════════════
    function renderSlotOptimizer(engineData) {
        if (!engineData || !engineData.assignments) return '';
        const { assignments, stats } = engineData;
        let html = `<div style="margin:12px 0;border:1px solid #2d6a4f;border-radius:8px;padding:10px;background:#0a1f14;">`;
        html += `<div style="font-size:12px;font-weight:700;color:#4ade80;margin-bottom:6px;">\u2699\ufe0f Slot Optimizer</div>`;
        html += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;font-size:10px;color:#9ca3af;">`;
        html += `<span>\u{1f4ca} <b style="color:#f3f4f6;">${stats.openSlots}</b> open slots</span>`;
        html += `<span>\u{1f465} <b style="color:#f3f4f6;">${stats.freeMembers}</b> free members</span>`;
        html += `<span>\u2705 <b style="color:#4ade80;">${stats.assigned}</b> assigned</span>`;
        if (stats.unfilledSlots > 0) html += `<span>\u26a0\ufe0f <b style="color:#e5b567;">${stats.unfilledSlots}</b> unfilled</span>`;
        html += `</div>`;

        if (assignments.length === 0) {
            html += `<div style="color:#6b7280;font-size:11px;">No assignments possible — all slots filled or no eligible free members.</div>`;
        } else {
            html += `<div style="display:flex;flex-direction:column;gap:4px;">`;
            for (const a of assignments) {
                const urgency = a.hoursToExpiry < 6 ? '#ef4444' : a.hoursToExpiry < 12 ? '#e5b567' : '#4ade80';
                const cprColor = (a.positionCpr || a.memberCpr) >= 80 ? '#4ade80' : (a.positionCpr || a.memberCpr) >= 60 ? '#e5b567' : '#ef4444';
                html += `<div style="display:flex;align-items:center;gap:6px;padding:4px 8px;background:#111b14;border-radius:4px;font-size:10px;flex-wrap:wrap;">`;
                html += `<span style="color:#f3f4f6;font-weight:600;min-width:90px;">${a.memberName}</span>`;
                html += `<span style="color:#6b7280;">\u2192</span>`;
                html += `<span style="color:#74c69d;font-weight:600;">${a.crimeName}</span>`;
                html += `<span style="color:#9ca3af;">${a.position}</span>`;
                html += `<span style="color:${cprColor};font-weight:600;">${a.positionCpr ? a.positionCpr.toFixed(0) + '%' : a.memberCpr.toFixed(0) + '%'}</span>`;
                html += `<span style="color:#6b7280;">Lvl ${a.difficulty}</span>`;
                html += `<span style="color:${urgency};font-size:9px;">${a.hoursToExpiry < 999 ? a.hoursToExpiry + 'h' : ''}</span>`;
                html += `<span style="color:#374151;font-size:9px;">score:${a.score}</span>`;
                html += `</div>`;
            }
            html += `</div>`;
        }
        html += `</div>`;
        return html;
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

    // Add "#1", "#2" to duplicate positions within a crime (matching Torn UI labels)
    function labelSlotPositions(slots) {
        const total = {};
        for (const s of slots) { const p = s.position || ''; total[p] = (total[p] || 0) + 1; }
        const counts = {};
        return slots.map(s => {
            const p = s.position || '';
            if (total[p] > 1) {
                counts[p] = (counts[p] || 0) + 1;
                return { ...s, label: `${p} #${counts[p]}` };
            }
            return { ...s, label: p };
        });
    }
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
        // Try exact level first, then search downward if none available
        let openOCs = [];
        let matchedLevel = m.joinable;
        for (let lvl = m.joinable; lvl >= 1; lvl--) {
            openOCs = normArr(availableCrimes).filter(c =>
                c.status === 'Recruiting' &&
                (c.difficulty || 0) === lvl &&
                (c.slots || []).some(s => !s.user_id && !s.user?.id)
            );
            if (openOCs.length) { matchedLevel = lvl; break; }
        }
        // Sort by urgency first (expiring soonest), then highest weight
        openOCs.sort((a, b) => {
            const aExp = a.expired_at || Infinity;
            const bExp = b.expired_at || Infinity;
            if (aExp !== bExp) return aExp - bExp; // soonest expiry first
            return (b.difficulty || 0) - (a.difficulty || 0);
        });
        if (!openOCs.length) return { type: 'none', text: `No OCs open (Lvl 1-${m.joinable})` };

        let bestCrime = null, bestPos = null, bestPosCPR = -1, bestWeight = -1;

        for (const c of openOCs) {
            const labeled = labelSlotPositions(c.slots || []);
            for (const slot of labeled.filter(s => !s.user_id && !s.user?.id)) {
                const slotWeight = getSlotWeight(weights, c.name, slot.label);
                // High-weight slots need higher CPR
                const minCPR = (slotWeight !== null && slotWeight >= HIGH_WEIGHT_THRESHOLD)
                    ? HIGH_WEIGHT_MIN_CPR : CONFIG.MINCPR;
                if (memberCPR < minCPR) continue; // CPR too low for this slot

                const pd  = lookupPosCPR(byPos, c.name, slot.position);
                const posCPR = pd?.cpr || 0;
                const w = slotWeight ?? 0;
                // Prefer: highest weight first, then highest role CPR as tiebreaker
                if (w > bestWeight || (w === bestWeight && posCPR > bestPosCPR)) {
                    bestPosCPR = posCPR; bestPos = slot.label; // "Thief #1" not just "Thief"
                    bestCrime = c; bestWeight = w;
                }
            }
        }

        // Fallback: if no qualifying slot (CPR too low), show best available anyway with a warning
        if (!bestCrime) {
            const c = openOCs[0];
            const labeled = labelSlotPositions(c.slots || []);
            const openSlot = labeled.find(s => !s.user_id && !s.user?.id);
            const pd  = lookupPosCPR(byPos, c.name, openSlot?.position);
            return { type: 'rec', crime: c.name, position: openSlot?.label || openSlot?.position || null,
                cpr: pd?.cpr || null, level: matchedLevel, count: openOCs.length, lowCpr: true };
        }

        return { type: 'rec', crime: bestCrime.name, position: bestPos,
            cpr: bestPosCPR > 0 ? bestPosCPR : null, level: matchedLevel, count: openOCs.length,
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

    function renderViewerCard(viewer, eligible, skipped, availableCrimes, weights) {
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
                const labeled = labelSlotPositions(c.slots || []);
                const openSlots = labeled.filter(s => !s.user_id && !s.user?.id);
                let bestPos = null, bestCPR = -1, bestW = -1;
                for (const slot of openSlots) {
                    const w  = getSlotWeight(weights, c.name, slot.label) ?? 0;
                    const pd = lookupPosCPR(byPos, c.name, slot.position);
                    const cpr = pd?.cpr || 0;
                    if (w > bestW || (w === bestW && cpr > bestCPR)) { bestCPR = cpr; bestPos = slot.label; bestW = w; }
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

    function renderBody(recs, eligible, skipped, scopeProjection, viewer, availableCrimes, weights, engines) {
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
            renderViewerCard(viewer, eligible, skipped, availableCrimes, weights) ||
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
            ${engines?.slotOptimizer ? renderSlotOptimizer(engines.slotOptimizer) : ''}
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
    // Admin tab: dev OR has faction API access
    function canViewAdmin(viewer) {
        if (!viewer) return false;
        if (isDev(viewer)) return true;
        return viewer.hasFactionAccess === true;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  OC MANAGER TAB  — Missing / Unused / Payouts sub-tabs
    // ═══════════════════════════════════════════════════════════════════════
    let mgr_currentSubTab = 'missing';

    function loadManagerTab() {
        const container = document.getElementById('oc-tab-manager');
        // Only render sub-tab bar once; preserve if already there
        if (!container.querySelector('.mgr-sub-tab-bar')) {
            container.innerHTML = `
                <div class="mgr-sub-tab-bar">
                    <button class="mgr-sub-tab mgr-sub-tab-active" data-mgr-tab="missing">Missing</button>
                    <button class="mgr-sub-tab" data-mgr-tab="unused">Unused</button>
                    <button class="mgr-sub-tab" data-mgr-tab="payouts">Payouts</button>
                </div>
                <div id="mgr-sub-content" class="mgr-sub-content"></div>
            `;
            container.querySelectorAll('.mgr-sub-tab').forEach(btn => {
                btn.addEventListener('click', () => {
                    mgr_currentSubTab = btn.dataset.mgrTab;
                    container.querySelectorAll('.mgr-sub-tab').forEach(t => t.classList.toggle('mgr-sub-tab-active', t.dataset.mgrTab === mgr_currentSubTab));
                    loadManagerSubTab(mgr_currentSubTab);
                });
            });
        }
        loadManagerSubTab(mgr_currentSubTab);
    }

    function loadManagerSubTab(tab) {
        if (tab === 'missing') mgr_loadMissingTab();
        else if (tab === 'unused') mgr_loadUnusedTab();
        else if (tab === 'payouts') mgr_loadPayoutsTab();
    }

    async function mgr_loadMissingTab() {
        const content = document.getElementById('mgr-sub-content');
        content.innerHTML = '<div class="mgr-loading">Loading OC data…</div>';
        try {
            await mgr_loadMembers();
            const missing = (await mgr_getMissingOCItems()).filter(m => !mgr_recentlyLoaned.get(String(m.userID))?.has(m.itemID));
            if (!missing.length) { content.innerHTML = '<div class="mgr-ok">✓ All OC items allocated</div>'; return; }
            await mgr_resolveItemNames(missing.map(m => m.itemID));
            let html = '';
            for (const m of missing) {
                const itemName = mgr_getItemName(m.itemID) || `Item #${m.itemID}`;
                html += `
                    <div class="mgr-card">
                        <div class="mgr-card-header"><span class="mgr-crime-name">${m.crimeName}</span><span class="mgr-pos-tag">${m.position}</span></div>
                        <div class="mgr-card-body">
                            <div class="mgr-item-row"><span class="mgr-label">Item</span><span class="mgr-value" style="font-weight:600;">${itemName}</span></div>
                            <div class="mgr-player-row"><span class="mgr-label">Player</span><a href="/profiles.php?XID=${m.userID}" class="mgr-player-link">${m.userName}</a></div>
                        </div>
                        <button class="mgr-action-btn mgr-btn-loan mgr-loan-btn" data-itemid="${m.itemID}" data-userid="${m.userID}" data-username="${m.userName}">${(location.hash.includes('tab=armoury') || location.hash.includes('tab=armory')) ? 'Loan Item' : 'Go to Armoury'}</button>
                    </div>
                `;
            }
            content.innerHTML = html;
            content.querySelectorAll('.mgr-loan-btn').forEach(btn => {
                btn.onclick = async () => {
                    if (btn.dataset.loaning === 'true' || btn.disabled) return;
                    const onArmory = location.hash.includes('tab=armoury') || location.hash.includes('tab=armory');
                    if (!onArmory) {
                        // Step 1: navigate to armory tab first
                        location.hash = '#/tab=armoury';
                        content.querySelectorAll('.mgr-loan-btn').forEach(b => { b.textContent = 'Loan Item'; });
                        return;
                    }
                    // Step 2: on armory tab, perform loan
                    btn.dataset.loaning = 'true'; btn.disabled = true; btn.textContent = 'Refreshing…';
                    const itemID = parseInt(btn.dataset.itemid, 10);
                    const userID = parseInt(btn.dataset.userid, 10);
                    const userName = btn.dataset.username;
                    try {
                        const armoryID = await mgr_prepareArmouryForItem(itemID);
                        if (!armoryID) {
                            btn.textContent = 'No stock'; btn.classList.add('mgr-btn-warning');
                            setTimeout(() => { btn.dataset.loaning = 'false'; btn.disabled = false; btn.textContent = 'Go to Armoury'; btn.classList.remove('mgr-btn-warning'); }, 3000);
                            return;
                        }
                        btn.textContent = 'Loaning…'; await mgr_loanPreparedItem({ userID, userName });
                        btn.textContent = '✓ Loaned'; btn.classList.add('mgr-btn-success');
                    } catch (e) { btn.textContent = '? Check'; btn.classList.add('mgr-btn-warning'); console.error('[OC Mgr] Loan error:', e); }
                };
            });
        } catch (e) { content.innerHTML = `<div class="mgr-error">${e.message}</div>`; }
    }

    async function mgr_loadUnusedTab() {
        const content = document.getElementById('mgr-sub-content');
        content.innerHTML = '<div class="mgr-loading">Scanning armory…</div>';
        try {
            await mgr_loadMembers();
            const [armoryItems, neededByUser] = await Promise.all([mgr_fetchAllArmoryItemsAPI(), mgr_getAllOCItemRequirements()]);
            // Merge recently loaned items to avoid showing them as unused due to API lag
            mgr_recentlyLoaned.forEach((items, uid) => {
                if (!neededByUser.has(uid)) neededByUser.set(uid, new Set());
                items.forEach(iid => neededByUser.get(uid).add(iid));
            });
            // Build set of ALL item IDs used in any OC (so we only show OC-relevant items)
            const allOcItemIDs = new Set();
            neededByUser.forEach(items => items.forEach(iid => allOcItemIDs.add(iid)));

            const unused = [];
            for (const entry of armoryItems) {
                if (entry.armoryCategory === 'temporary') continue;
                // Only show items that are actually used in OCs
                if (!allOcItemIDs.has(entry.itemID)) continue;
                // API returns loaned_to as comma-separated user IDs
                if (!entry.loaned_to) continue;
                const loanedUsers = String(entry.loaned_to).split(',').map(s => s.trim()).filter(Boolean);
                for (const uid of loanedUsers) {
                    const needed = neededByUser.get(uid);
                    if (!needed || !needed.has(entry.itemID)) {
                        unused.push({
                            itemID: entry.itemID, itemName: entry.name || mgr_getItemName(entry.itemID) || `Item #${entry.itemID}`,
                            armoryCategory: entry.armoryCategory || 'utilities',
                            userID: uid, userName: mgr_memberNameMap.get(uid) || `Unknown [${uid}]`
                        });
                    }
                }
            }
            if (!unused.length) { content.innerHTML = '<div class="mgr-ok">✓ No unused loaned items</div>'; return; }
            let html = '<div style="margin-bottom:10px;font-size:11px;color:#6b7280;text-align:center;">Loaned but not needed for any OC:</div>';
            for (const u of unused) {
                html += `
                    <div class="mgr-card">
                        <div class="mgr-card-body">
                            <div class="mgr-item-row"><span class="mgr-label">Item</span><span class="mgr-value" style="font-weight:600;">${u.itemName}</span></div>
                            <div class="mgr-player-row"><span class="mgr-label">Player</span><a href="/profiles.php?XID=${u.userID}" class="mgr-player-link">${u.userName}</a></div>
                        </div>
                        <button class="mgr-action-btn mgr-btn-retrieve mgr-retrieve-btn" data-itemid="${u.itemID}" data-userid="${u.userID}" data-username="${u.userName}" data-category="${u.armoryCategory}">${(location.hash.includes('tab=armoury') || location.hash.includes('tab=armory')) ? 'Retrieve Item' : 'Go to Armoury'}</button>
                    </div>
                `;
            }
            content.innerHTML = html;
            content.querySelectorAll('.mgr-retrieve-btn').forEach(btn => {
                btn.onclick = async () => {
                    if (btn.dataset.retrieving === 'true' || btn.disabled) return;
                    const onArmory = location.hash.includes('tab=armoury') || location.hash.includes('tab=armory');
                    if (!onArmory) {
                        // Step 1: navigate to armory tab first
                        location.hash = '#/tab=armoury';
                        content.querySelectorAll('.mgr-retrieve-btn').forEach(b => { b.textContent = 'Retrieve Item'; });
                        return;
                    }
                    // Step 2: on armory tab, perform retrieve
                    btn.dataset.retrieving = 'true'; btn.disabled = true; btn.textContent = 'Finding item…';
                    try {
                        const cat = btn.dataset.category || 'utilities';
                        const itemID = parseInt(btn.dataset.itemid, 10);
                        const userID = parseInt(btn.dataset.userid, 10);
                        // Fetch armoryIDs from page AJAX to find the specific loaned item
                        const categoriesToTry = [cat];
                        if (cat === 'armor') categoriesToTry.push('armour');
                        let armoryID = null;
                        for (const c of categoriesToTry) {
                            const rfcv = mgr_getRfcvToken();
                            if (!rfcv) throw new Error('Missing RFCV token');
                            let start = 0;
                            while (start < 1000 && !armoryID) {
                                const body = new URLSearchParams({ step: 'armouryTabContent', type: c, start: String(start), ajax: 'true' });
                                const res = await fetch(`https://www.torn.com/factions.php?rfcv=${rfcv}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }, body, credentials: 'same-origin' });
                                if (!res.ok) break;
                                const data = await res.json();
                                if (!data?.items) break;
                                const itemsArr = Array.isArray(data.items) ? data.items : Object.values(data.items);
                                if (itemsArr.length === 0) break;
                                for (const entry of itemsArr) {
                                    if (Number(entry.itemID) === itemID && entry.user && String(entry.user.userID) === String(userID) && entry.armoryID) {
                                        armoryID = entry.armoryID; break;
                                    }
                                }
                                if (itemsArr.length < 50) break;
                                start += 50;
                            }
                            if (armoryID) break;
                        }
                        if (!armoryID) throw new Error('Could not find armory item');
                        btn.textContent = 'Retrieving…';
                        const postType = ARMORY_TAB_TO_POST_TYPE[cat] || 'Tool';
                        await mgr_retrieveItem({ armoryID, itemID, userID, userName: btn.dataset.username, postType });
                        btn.textContent = '✓ Retrieved'; btn.classList.add('mgr-btn-success');
                    } catch (e) { btn.textContent = 'Error'; btn.classList.add('mgr-btn-warning'); btn.disabled = false; btn.dataset.retrieving = 'false'; }
                };
            });
        } catch (e) { content.innerHTML = `<div class="mgr-error">Error: ${e.message}</div>`; }
    }

    async function mgr_loadPayoutsTab() {
        const content = document.getElementById('mgr-sub-content');
        content.innerHTML = '<div class="mgr-loading">Checking completions…</div>';
        try {
            const unpaid = await mgr_getUnpaidCompletedCrimes();
            if (!unpaid.length) { content.innerHTML = '<div class="mgr-ok">✓ All OCs paid out</div>'; return; }
            let totalMoney = 0, items = 0;
            unpaid.forEach(c => { totalMoney += c.money; if (c.hasItems) items++; });
            let html = `
                <div class="mgr-summary-box">
                    <div class="mgr-summary-label">Summary</div>
                    ${totalMoney > 0 ? `<div class="mgr-summary-amount">$${mgr_formatNumber(totalMoney)}</div>` : ''}
                    <div class="mgr-summary-detail">${unpaid.length} Unpaid OCs${items > 0 ? ` • ${items} with Items` : ''}</div>
                    <a href="https://www.torn.com/factions.php?step=your#/tab=crimes&subTab=completed" target="_blank" class="mgr-payout-link">Open Payouts Page</a>
                </div>
            `;
            for (const c of unpaid) {
                const ageSec = Math.floor(Date.now() / 1000) - c.executedAt;
                const ageDays = Math.floor(ageSec / 86400);
                const ageColor = ageDays >= 7 ? '#f87171' : (ageDays >= 3 ? '#f4a261' : '#6b7280');
                html += `
                    <a href="https://www.torn.com/factions.php?step=your#/tab=crimes&subTab=completed" target="_blank" class="mgr-payout-card">
                        <div class="mgr-card" style="padding:8px 10px;">
                            <div class="mgr-card-header"><span class="mgr-crime-name" style="font-size:11px;">${c.name}</span><span style="font-size:10px;font-weight:700;color:${ageColor};">${ageDays > 0 ? ageDays + 'd' : Math.floor(ageSec / 3600) + 'h'}</span></div>
                            <div style="display:flex;justify-content:space-between;align-items:center;"><span style="font-size:12px;color:#74c69d;font-weight:700;">${c.money > 0 ? '$' + mgr_formatNumber(c.money) : ''}</span><span style="font-size:10px;color:#6b7280;">${c.hasItems ? '<span style="color:#74c69d;">Items</span>' : ''}${c.payoutPct ? ` ${c.payoutPct}%` : ''}</span></div>
                        </div>
                    </a>
                `;
            }
            content.innerHTML = html;
        } catch (e) { content.innerHTML = `<div class="mgr-error">Error: ${e.message}</div>`; }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  MAIN
    // ═══════════════════════════════════════════════════════════════════════
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
                CONFIG.SCOPE                   = srvSettings.scope;

                // Engine toggles
                CONFIG.ENGINE_SLOT_OPTIMIZER   = srvSettings.engine_slot_optimizer   ?? CONFIG.ENGINE_SLOT_OPTIMIZER;
                CONFIG.ENGINE_CPR_FORECASTER   = srvSettings.engine_cpr_forecaster   ?? CONFIG.ENGINE_CPR_FORECASTER;
                CONFIG.ENGINE_FAILURE_RISK     = srvSettings.engine_failure_risk     ?? CONFIG.ENGINE_FAILURE_RISK;
                CONFIG.ENGINE_EXPIRY_RISK      = srvSettings.engine_expiry_risk      ?? CONFIG.ENGINE_EXPIRY_RISK;
                CONFIG.ENGINE_MEMBER_RELIABILITY = srvSettings.engine_member_reliability ?? CONFIG.ENGINE_MEMBER_RELIABILITY;
                CONFIG.ENGINE_PAYOUT_OPTIMIZER = srvSettings.engine_payout_optimizer ?? CONFIG.ENGINE_PAYOUT_OPTIMIZER;
                CONFIG.ENGINE_ITEM_ROI         = srvSettings.engine_item_roi         ?? CONFIG.ENGINE_ITEM_ROI;
                CONFIG.ENGINE_NERVE_EFFICIENCY = srvSettings.engine_nerve_efficiency ?? CONFIG.ENGINE_NERVE_EFFICIENCY;
                CONFIG.ENGINE_GAP_ANALYZER     = srvSettings.engine_gap_analyzer     ?? CONFIG.ENGINE_GAP_ANALYZER;
                CONFIG.ENGINE_MEMBER_PROJECTOR = srvSettings.engine_member_projector ?? CONFIG.ENGINE_MEMBER_PROJECTOR;

                // Sync local storage with server values
                GM_setValue('cfg_active_days',         CONFIG.ACTIVE_DAYS);
                GM_setValue('cfg_forecast_hours',      CONFIG.FORECAST_HOURS);
                GM_setValue('cfg_mincpr',              CONFIG.MINCPR);
                GM_setValue('cfg_cpr_boost',           CONFIG.CPR_BOOST);
                GM_setValue('cfg_lookback_days',       CONFIG.CPR_LOOKBACK_DAYS);
                GM_setValue('cfg_high_weight_pct',     CONFIG.HIGH_WEIGHT_THRESHOLD);
                GM_setValue('cfg_high_weight_mincpr',  CONFIG.HIGH_WEIGHT_MIN_CPR);
                GM_setValue('cfg_scope',               CONFIG.SCOPE);
                GM_setValue('eng_slot_optimizer',       CONFIG.ENGINE_SLOT_OPTIMIZER);
                        GM_setValue('eng_cpr_forecaster',       CONFIG.ENGINE_CPR_FORECASTER);
                GM_setValue('eng_failure_risk',         CONFIG.ENGINE_FAILURE_RISK);
                GM_setValue('eng_expiry_risk',          CONFIG.ENGINE_EXPIRY_RISK);
                GM_setValue('eng_member_reliability',   CONFIG.ENGINE_MEMBER_RELIABILITY);
                GM_setValue('eng_payout_optimizer',     CONFIG.ENGINE_PAYOUT_OPTIMIZER);
                GM_setValue('eng_item_roi',             CONFIG.ENGINE_ITEM_ROI);
                GM_setValue('eng_nerve_efficiency',     CONFIG.ENGINE_NERVE_EFFICIENCY);
                GM_setValue('eng_gap_analyzer',         CONFIG.ENGINE_GAP_ANALYZER);
                GM_setValue('eng_member_projector',     CONFIG.ENGINE_MEMBER_PROJECTOR);

                populateSettings();
                settingsReady = true;
                const saveBtn = document.getElementById('oc-spawn-cfg-save');
                if (saveBtn) saveBtn.disabled = false;
            }

            // Fetch OC data from server
            setStatus('Fetching OC data…');
            let members, availableCrimes, rawCprCache, viewer, weights, serverResp, engines;
            try {
                serverResp = await fetchServerOcData(apiKey);
                ({ members, availableCrimes, cprCache: rawCprCache, viewer, weights, engines } = serverResp);
                engines = engines || {};
            } catch (err) {
                if (err.status === 403) {
                    document.getElementById('oc-tab-profile').innerHTML =
                        `<p class="oc-error">⛔ ${err.message}</p>`;
                    setStatus('Access denied.');
                    return;
                }
                throw err;
            }

            // No faction key cached yet — show waiting message
            if (serverResp.pendingFactionData) {
                document.getElementById('oc-tab-profile').innerHTML =
                    `<div style="text-align:center;padding:24px 16px;color:#9ca3af;">`
                    + `<div style="font-size:18px;margin-bottom:8px;">⏳</div>`
                    + `<div style="font-size:12px;font-weight:600;color:#f3f4f6;margin-bottom:4px;">Waiting for faction data</div>`
                    + `<div style="font-size:11px;line-height:1.5;">Your API key doesn't have faction access.<br>OC data will appear once a member with faction API access loads the panel.</div>`
                    + `</div>`;
                setStatus('Waiting for faction data.');
                return;
            }

            // Re-apply user's MINCPR/CPR_BOOST to joinable
            const cprCache = {};
            for (const [uid, d] of Object.entries(rawCprCache || {})) {
                // Per-level CPR: find highest level where member actually performs well
                const levelCprs = {};
                for (const e of (d.entries || [])) {
                    if (!levelCprs[e.diff]) levelCprs[e.diff] = { sum: 0, count: 0 };
                    levelCprs[e.diff].sum += e.rate;
                    levelCprs[e.diff].count += 1;
                }
                let effectiveTop = d.highestLevel || 0;
                for (let lvl = effectiveTop; lvl >= 1; lvl--) {
                    const lc = levelCprs[lvl];
                    if (!lc) continue;
                    if ((lc.sum / lc.count) >= CONFIG.MINCPR) { effectiveTop = lvl; break; }
                }
                cprCache[uid] = {
                    ...d,
                    effectiveTop,
                    joinable: d.cpr >= CONFIG.MINCPR + CONFIG.CPR_BOOST
                        ? Math.min(effectiveTop + 1, 10) : effectiveTop,
                };
            }

            setStatus('Analysing…');
            const slotMap               = countOpenSlots(availableCrimes);
            const { eligible, skipped } = processMembers(members, availableCrimes, cprCache);
            const scopeProjection        = projectScope(CONFIG.SCOPE, eligible);
            lastScopeProjection         = scopeProjection; // cache for tooltip
            const recs                  = buildRecommendations(eligible, slotMap, scopeProjection);

            renderBody(recs, eligible, skipped, scopeProjection, viewer, availableCrimes, weights, engines);

            // Always show tab bar with both tabs
            const tabBar   = document.getElementById('oc-tab-bar');
            const adminTab = document.getElementById('oc-admin-tab');
            const managerTab = document.getElementById('oc-manager-tab');
            tabBar.style.display   = 'flex';
            adminTab.style.display = '';

            // Show Manager tab for admins (same check as Admin tab)
            const metricsTab = document.getElementById('oc-metrics-tab');
            if (canViewAdmin(viewer)) {
                managerTab.style.display = '';
                if (metricsTab) metricsTab.style.display = '';
            } else {
                managerTab.style.display = 'none';
                if (metricsTab) metricsTab.style.display = 'none';
            }

            // Lock admin tab content if viewer can't admin
            const settingsGear = document.getElementById('oc-spawn-settings');
            // Gear always visible to dev; visible to others only if they can view admin
            if (settingsGear) settingsGear.style.display = ''; // always show — API key field is accessible to everyone
            // Show config section only for admins (prevents non-admins from pushing default settings)
            const cfgSection = document.getElementById('oc-cfg-section');
            if (cfgSection) cfgSection.style.display = (isDev(viewer) || canViewAdmin(viewer)) ? '' : 'none';
            if (canViewAdmin(viewer)) {
                switchTab('admin');
            } else {
                // Replace admin content with locked message
                document.getElementById('oc-tab-admin').innerHTML =
                    `<p class="oc-error" style="margin-top:8px;">🔒 Admin access requires faction API access.</p>
                     <p style="color:#6b7280;font-size:11px;">Your API key does not have faction access. &nbsp;·&nbsp; ID: <b style="color:#9ca3af;">${viewer?.playerId || '?'}</b></p>`;
                switchTab('profile');
            }

            setStatus(`Last updated: ${new Date().toLocaleTimeString()} · ${normArr(members).length} members`);
            updateSubTimer(viewer);

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

