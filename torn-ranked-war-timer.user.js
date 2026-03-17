// ==UserScript==
// @name         Torn Ranked War Timer
// @version      1.6.1
// @author       RussianRob
// @description  Timer for Ranked Wars
// @license      MIT
// @match        https://www.torn.com/factions.php*

// @downloadURL  https://tornwar.com/scripts/torn-ranked-war-timer.user.js
// @updateURL    https://tornwar.com/scripts/torn-ranked-war-timer.meta.js
// ==/UserScript==

// =============================================================================
// CHANGELOG
// =============================================================================
// v1.6.1  - Update URLs to tornwar.com hosting
// v1.6.0  - Removed font size overrides for consistent PDA/desktop layout
// v1.5.0  - Version bump
// v1.4.0  - Timer repositioned as overlay badge in top-right corner
//           (no longer affects page layout)
// v1.3.0  - Initial public release
// =============================================================================

(function () {
    'use strict';

    const WIKI_URL = 'https://wiki.torn.com/wiki/Ranked_War';

    function isDesktopLike() {
        // Treat wider viewports as desktop; PDA/mobile usually < 1000px.
        return window.matchMedia('(min-width: 1000px)').matches;
    }

    function formatHHMM(hoursFloat) {
        const totalMinutes = Math.floor(hoursFloat * 60);
        const remHours = Math.floor(totalMinutes / 60);
        const remMinutes = totalMinutes % 60;
        const hh = remHours.toString().padStart(2, '0');
        const mm = remMinutes.toString().padStart(2, '0');
        return { hh, mm, remHours };
    }

    function colorByUrgency(hoursRemainingFloat) {
        if (hoursRemainingFloat <= 2) {
            return 'red';
        } else if (hoursRemainingFloat <= 6) {
            return 'orange';
        } else {
            return 'lime';
        }
    }

    function updateWarTimer(display, warBox) {
        const timerSpans = document.querySelectorAll('.timer___fSGg8 span');
        const targetBox = document.querySelector('.target___NBVXq');

        if (!timerSpans || timerSpans.length < 8 || !targetBox) {
            display.textContent = '🕓 War Timer: N/A';
            return false;
        }

        const timeParts = Array.from(timerSpans)
            .map(span => span.textContent)
            .join('')
            .split(':');

        if (timeParts.length < 3) {
            display.textContent = '🕓 War Timer: N/A';
            return false;
        }

        const days = parseInt(timeParts[0]);
        const hours = parseInt(timeParts[1]);
        const minutes = parseInt(timeParts[2]);
        const totalElapsedHours = (days * 24) + hours + (minutes / 60);

        if (totalElapsedHours <= 24) {
            display.style.color = 'red';
            display.textContent = '🕓 Waiting for 24h mark...';
            display.title = 'War Timer\nCalculations start after 24h elapsed.';
            return true;
        }

        const dropHours = Math.floor(totalElapsedHours - 24);

        let match;
        try {
            match = targetBox.innerText.match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/);
        } catch (e) {
            match = null;
        }

        if (!match) {
            display.style.color = 'red';
            display.textContent = '🕓 War Timer: N/A';
            display.title = 'War Timer\nUnable to parse target values.';
            return false;
        }

        const [leadStr, targetStr] = match.slice(1, 3);
        const lead = parseInt(leadStr.replace(/,/g, ''));
        const currentTarget = parseInt(targetStr.replace(/,/g, ''));

        const originalTarget = currentTarget / (1 - (dropHours * 0.01));
        const DROP_PER_HOUR = originalTarget * 0.01;
        const gap = currentTarget - lead;

        const hoursRemainingFloat = gap / DROP_PER_HOUR;

        if (hoursRemainingFloat <= 0) {
            display.remove();
            return false;
        }

        const { hh, mm, remHours } = formatHHMM(hoursRemainingFloat);
        const color = colorByUrgency(hoursRemainingFloat);

        display.style.color = color;
        display.textContent = `🕓 War Timer: ${hh}:${mm}`;
        display.title =
            `War Timer` +
            `\nTime left (approx): ${hh}:${mm}` +
            `\nEstimated original target: ${Math.round(originalTarget).toLocaleString()}` +
            `\nDrop per hour: ${Math.round(DROP_PER_HOUR).toLocaleString()}` +
            `\nLead gap: ${gap.toLocaleString()} ` +
            `\nHours remaining (approx): ${remHours}`;

        return true;
    }

    const initInterval = setInterval(() => {
        const warBox = document.querySelector('.rankBox___OzP3D');
        const timerSpans = document.querySelectorAll('.timer___fSGg8 span');
        const targetBox = document.querySelector('.target___NBVXq');
        const timerBox = document.querySelector('.timer___fSGg8');

        if (warBox && timerSpans.length >= 8 && targetBox && timerBox) {
            clearInterval(initInterval);

            const display = document.createElement('div');
            display.style.marginLeft = '10px';
            display.style.fontWeight = 'bold';
            display.style.cursor = 'pointer';
            display.style.display = 'inline-block';
            display.onclick = () => window.open(WIKI_URL, '_blank');

            let headerContainer =
                warBox.querySelector('[class*="header"], [class*="title"]') ||
                (warBox.children && warBox.children[0]) ||
                timerBox.parentElement;

            if (!headerContainer) return;

            headerContainer.appendChild(display);

            const ok = updateWarTimer(display, warBox);
            if (!ok && !document.body.contains(display)) {
                return;
            }

            const refreshInterval = setInterval(() => {
                if (!document.body.contains(display)) {
                    clearInterval(refreshInterval);
                    return;
                }

                updateWarTimer(display, warBox);
            }, 30000);
        }
    }, 1000);
})();
