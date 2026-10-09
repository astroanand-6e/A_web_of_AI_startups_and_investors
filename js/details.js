// Sidebar details and the hover tooltip. The HTML comes from pure builders that
// escape every data value, so they are unit-tested and safe to use with innerHTML.

import { escapeHtml, monthLabel, yearOf } from './data.js';

const LIST_LIMIT = 5;
const ACTIVITY_YEARS = 3;
const TOOLTIP_OFFSET_PX = 14;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function listHtml(items) {
    const shown = items.slice(0, LIST_LIMIT).map((item) => `<li>${escapeHtml(item)}</li>`);
    const more = items.length > LIST_LIMIT ? [`<li class="more">+ ${items.length - LIST_LIMIT} more...</li>`] : [];
    return `<ul class="node-list">${[...shown, ...more].join('')}</ul>`;
}

function factsHtml(facts) {
    const rows = facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`);
    return `<dl class="node-facts">${rows.join('')}</dl>`;
}

function headerHtml(type, name) {
    const label = type === 'startup' ? 'Startup' : 'Investor';
    return `<div class="node-detail-header"><span class="node-type node-type--${type}">${label}</span>`
        + `<h4>${escapeHtml(name)}</h4></div>`;
}

export function startupDetailsHtml(startup, data) {
    const deals = data.dealsByStartup.get(startup.name) || [];
    const latest = deals.length ? monthLabel(Math.max(...deals.map((deal) => deal.dateIndex))) : 'None recorded';
    return [
        headerHtml('startup', startup.name),
        startup.comment ? `<p class="node-about">${escapeHtml(startup.comment)}</p>` : '',
        factsHtml([
            ['Founded', monthLabel(startup.foundedIndex)],
            ['Investors', String(startup.investors.length)],
            ['Latest Investment', latest],
        ]),
        startup.investors.length ? `<h5>Key Investors</h5>${listHtml(startup.investors)}` : '',
    ].join('');
}

export function investorDetailsHtml(investor, data) {
    const deals = data.dealsByInvestor.get(investor.name) || [];
    const roundsByYear = new Map();
    deals.forEach((deal) => {
        const year = yearOf(deal.dateIndex);
        roundsByYear.set(year, (roundsByYear.get(year) || 0) + 1);
    });
    const activity = [...roundsByYear].sort((a, b) => b[0] - a[0]).slice(0, ACTIVITY_YEARS);
    const activityItems = activity.map(([year, rounds]) => `<li>${year}: ${plural(rounds, 'round')}</li>`).join('');
    return [
        headerHtml('investor', investor.name),
        factsHtml([
            ['Investments', plural(investor.startups.length, 'startup')],
            ['Total Rounds', String(investor.rounds)],
        ]),
        activity.length ? `<h5>Investment Activity</h5><ul class="node-list">${activityItems}</ul>` : '',
        `<h5>Portfolio Companies</h5>${listHtml(investor.startups)}`,
    ].join('');
}

export function tooltipHtml(record) {
    const detail = record.type === 'startup'
        ? `Founded ${monthLabel(record.foundedIndex)}`
        : `Investor · ${plural(record.startups.length, 'startup')}`;
    return `<strong>${escapeHtml(record.name)}</strong><span>${escapeHtml(detail)}</span>`;
}

export function createDetails(data, panel) {
    const records = new Map([...data.startups, ...data.investors].map((record) => [record.id, record]));
    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    tooltip.setAttribute('role', 'tooltip');
    document.body.appendChild(tooltip);
    let shownId = null;
    let tooltipSize = { width: 0, height: 0 };

    function show(id) {
        const record = records.get(id);
        if (!record || id === shownId) return;
        shownId = id;
        panel.innerHTML = record.type === 'startup' ? startupDetailsHtml(record, data) : investorDetailsHtml(record, data);
        panel.classList.remove('is-updated');
        void panel.offsetWidth; // restart the update animation
        panel.classList.add('is-updated');
    }

    // Flips to the other side of the pointer near the window edges.
    function moveTooltip(event) {
        if (!event) return;
        const fitsRight = event.clientX + TOOLTIP_OFFSET_PX + tooltipSize.width <= window.innerWidth;
        const fitsBelow = event.clientY + TOOLTIP_OFFSET_PX + tooltipSize.height <= window.innerHeight;
        const x = fitsRight ? event.clientX + TOOLTIP_OFFSET_PX : event.clientX - TOOLTIP_OFFSET_PX - tooltipSize.width;
        const y = fitsBelow ? event.clientY + TOOLTIP_OFFSET_PX : event.clientY - TOOLTIP_OFFSET_PX - tooltipSize.height;
        tooltip.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    }

    function showTooltip(id, event) {
        const record = records.get(id);
        if (!record) return;
        tooltip.innerHTML = tooltipHtml(record);
        tooltipSize = { width: tooltip.offsetWidth, height: tooltip.offsetHeight };
        moveTooltip(event);
        tooltip.classList.add('is-visible');
    }

    function hideTooltip() {
        tooltip.classList.remove('is-visible');
    }

    return { show, showTooltip, moveTooltip, hideTooltip };
}
