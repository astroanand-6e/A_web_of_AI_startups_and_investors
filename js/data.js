// Normalizes the raw timeline JSON into the read-only model the rest of the app
// uses. Pure (no DOM, no d3), so it runs under Node's test runner.

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const MONTH_NAMES = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);

/** 'YYYY-MM' → months since year 0, so consecutive months differ by exactly 1. */
export function monthIndex(value, field = 'month') {
    const match = MONTH_PATTERN.exec(String(value));
    if (!match) throw new Error(`Invalid ${field} "${value}" (expected YYYY-MM)`);
    return Number(match[1]) * 12 + Number(match[2]) - 1;
}

export const yearOf = (index) => Math.floor(index / 12);
export const monthLabel = (index) => `${MONTH_NAMES[index - yearOf(index) * 12]} ${yearOf(index)}`;

// Prefixed ids keep a company and an investor with the same name apart.
export const startupId = (name) => `s:${name}`;
export const investorId = (name) => `i:${name}`;
export const linkKey = (investor, startup) => `${investorId(investor)}>${startupId(startup)}`;

const HTML_ESCAPES = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' });
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);

const optionalText = (value) => (typeof value === 'string' ? value.trim() : '');
const unique = (items) => [...new Set(items)];

function requiredName(value, context) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${context} is missing a name`);
    return value.trim();
}

function groupBy(items, keyOf) {
    const groups = new Map();
    for (const item of items) {
        const key = keyOf(item);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
    }
    return groups;
}

/**
 * Validates the raw JSON and returns frozen records:
 *  - startups:    { id, type, name, founded, foundedIndex, comment, logo, investors[] }
 *  - investors:   { id, type, name, startups[], rounds }, in order of first deal
 *  - investments: { id, investor, startup, investorId, startupId, key, date,
 *                   dateIndex, effectiveIndex, comment }
 * Deals that name an unknown startup are skipped and reported in `skipped`.
 */
export function normalizeData(raw) {
    if (!raw || !Array.isArray(raw.startups) || !Array.isArray(raw.investments)) {
        throw new Error('Timeline data must contain "startups" and "investments" arrays');
    }
    if (raw.startups.length === 0) throw new Error('Timeline data has no startups');

    const startupByName = new Map();
    raw.startups.forEach((entry, i) => {
        const name = requiredName(entry?.name, `Startup #${i + 1}`);
        if (startupByName.has(name)) throw new Error(`Duplicate startup "${name}"`);
        startupByName.set(name, {
            id: startupId(name),
            type: 'startup',
            name,
            founded: entry.founded,
            foundedIndex: monthIndex(entry.founded, `founding month for ${name}`),
            comment: optionalText(entry.comment),
            logo: optionalText(entry.logo) || null,
        });
    });

    const investments = [];
    const skipped = [];
    raw.investments.forEach((entry, i) => {
        const investor = requiredName(entry?.investor, `Investment #${i + 1}`);
        const startupName = requiredName(entry?.startup, `Investment #${i + 1} (${investor})`);
        const startup = startupByName.get(startupName);
        if (!startup) {
            skipped.push(Object.freeze({ investor, startup: startupName, reason: 'unknown startup' }));
            return;
        }
        const dateIndex = monthIndex(entry.date, `date for ${investor} → ${startupName}`);
        investments.push(Object.freeze({
            id: `deal-${investments.length}`,
            investor,
            startup: startupName,
            investorId: investorId(investor),
            startupId: startup.id,
            key: linkKey(investor, startupName),
            date: entry.date,
            dateIndex,
            // A round can't land before the company exists, so it plays at founding.
            effectiveIndex: Math.max(dateIndex, startup.foundedIndex),
            comment: optionalText(entry.comment),
        }));
    });

    const dealsByStartup = groupBy(investments, (deal) => deal.startup);
    const dealsByInvestor = groupBy(investments, (deal) => deal.investor);
    const startups = [...startupByName.values()].map((startup) => Object.freeze({
        ...startup,
        investors: unique((dealsByStartup.get(startup.name) || []).map((deal) => deal.investor)),
    }));
    const investors = [...dealsByInvestor].map(([name, deals]) => Object.freeze({
        id: investorId(name),
        type: 'investor',
        name,
        startups: unique(deals.map((deal) => deal.startup)),
        rounds: deals.length,
    }));

    return Object.freeze({ startups, investors, investments, skipped, dealsByStartup, dealsByInvestor });
}
