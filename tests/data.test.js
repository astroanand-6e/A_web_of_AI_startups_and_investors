import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { escapeHtml, linkKey, monthIndex, monthLabel, normalizeData, yearOf } from '../js/data.js';

const loadBundled = () => JSON.parse(readFileSync(new URL('../data/ai_startups_timeline.json', import.meta.url), 'utf8'));

const fixture = () => ({
    startups: [
        { name: 'Alpha', founded: '2020-03', comment: '  First  ', logo: 'logos/a.png' },
        { name: 'Beta', founded: '2021-01' },
    ],
    investments: [
        { investor: 'Fund B', startup: 'Beta', date: '2021-06' },
        { investor: 'Fund A', startup: 'Alpha', date: '2019-11', comment: 'early' },
        { investor: 'Fund B', startup: 'Alpha', date: '2020-05' },
        { investor: 'Fund B', startup: 'Alpha', date: '2020-09' },
        { investor: 'Ghost Capital', startup: 'Nowhere', date: '2020-01' },
    ],
});

test('monthIndex makes consecutive months differ by exactly one', () => {
    assert.equal(monthIndex('2024-06'), 2024 * 12 + 5);
    assert.equal(monthIndex('2024-01') - monthIndex('2023-12'), 1);
});

test('monthIndex rejects malformed months', () => {
    for (const bad of ['2024-13', '2024-00', '2024-1', 'June 2024', '', undefined, null]) {
        assert.throws(() => monthIndex(bad), /Invalid month/, `accepted ${bad}`);
    }
});

test('monthLabel and yearOf read a month index back', () => {
    assert.equal(monthLabel(monthIndex('2024-06')), 'Jun 2024');
    assert.equal(monthLabel(monthIndex('2016-01')), 'Jan 2016');
    assert.equal(monthLabel(monthIndex('2015-12')), 'Dec 2015');
    assert.equal(yearOf(monthIndex('2015-12')), 2015);
});

test('investors are listed in order of their first deal, with prefixed ids', () => {
    const data = normalizeData(fixture());
    assert.deepEqual(data.investors.map((investor) => investor.name), ['Fund B', 'Fund A']);
    assert.deepEqual(data.investors.map((investor) => investor.id), ['i:Fund B', 'i:Fund A']);
    assert.deepEqual(data.startups.map((startup) => startup.id), ['s:Alpha', 's:Beta']);
    assert.equal(data.investments[0].key, linkKey('Fund B', 'Beta'));
    assert.equal(data.investments[0].key, 'i:Fund B>s:Beta');

    const fundB = data.investors[0];
    assert.deepEqual(fundB.startups, ['Beta', 'Alpha']);
    assert.equal(fundB.rounds, 3);
    assert.deepEqual(data.startups[0].investors, ['Fund A', 'Fund B']);
});

test('a round dated before its startup was founded plays at the founding', () => {
    const data = normalizeData(fixture());
    const early = data.investments.find((deal) => deal.investor === 'Fund A');
    assert.equal(early.dateIndex, monthIndex('2019-11'));
    assert.equal(early.effectiveIndex, monthIndex('2020-03'));
    const onTime = data.investments.find((deal) => deal.date === '2021-06');
    assert.equal(onTime.effectiveIndex, onTime.dateIndex);
});

test('deals naming an unknown startup are skipped and reported', () => {
    const data = normalizeData(fixture());
    assert.equal(data.investments.length, 4);
    assert.deepEqual(data.investments.map((deal) => deal.id), ['deal-0', 'deal-1', 'deal-2', 'deal-3']);
    assert.deepEqual(data.skipped, [{ investor: 'Ghost Capital', startup: 'Nowhere', reason: 'unknown startup' }]);
    assert.ok(!data.investors.some((investor) => investor.name === 'Ghost Capital'));
});

test('optional text is trimmed and a missing logo becomes null', () => {
    const data = normalizeData(fixture());
    const [alpha, beta] = data.startups;
    assert.equal(alpha.comment, 'First');
    assert.equal(alpha.logo, 'logos/a.png');
    assert.equal(beta.comment, '');
    assert.equal(beta.logo, null);
});

test('invalid structures are rejected with a clear message', () => {
    const withStartups = (startups) => ({ startups, investments: [] });
    const cases = [
        [null, /must contain/],
        [{}, /must contain/],
        [{ startups: {}, investments: [] }, /must contain/],
        [withStartups([]), /no startups/],
        [withStartups([{ name: 'A', founded: '2020-01' }, { name: 'A', founded: '2021-01' }]), /Duplicate startup "A"/],
        [withStartups([{ name: 'A', founded: '2020-1' }]), /founding month for A/],
        [withStartups([{ founded: '2020-01' }]), /missing a name/],
        [{ startups: [{ name: 'A', founded: '2020-01' }], investments: [{ startup: 'A', date: '2020-01' }] }, /missing a name/],
        [{ startups: [{ name: 'A', founded: '2020-01' }], investments: [{ investor: 'F', startup: 'A', date: 'soon' }] }, /date for F/],
    ];
    for (const [raw, message] of cases) {
        assert.throws(() => normalizeData(raw), message);
    }
});

test('normalized records are frozen', () => {
    const data = normalizeData(fixture());
    assert.ok(Object.isFrozen(data));
    assert.ok(Object.isFrozen(data.startups[0]));
    assert.ok(Object.isFrozen(data.investors[0]));
    assert.ok(Object.isFrozen(data.investments[0]));
    assert.ok(Object.isFrozen(data.skipped[0]));
});

test('escapeHtml escapes every markup character', () => {
    assert.equal(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;');
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
    assert.equal(escapeHtml(42), '42');
});

test('the bundled dataset normalizes cleanly', () => {
    const data = normalizeData(loadBundled());
    assert.equal(data.startups.length, 8);
    assert.equal(data.investors.length, 56);
    assert.equal(data.investments.length, 75);
    assert.equal(data.skipped.length, 0);
    assert.equal(new Set(data.investments.map((deal) => deal.key)).size, 72);
});
