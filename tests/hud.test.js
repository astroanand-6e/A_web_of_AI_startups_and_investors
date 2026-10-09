import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { monthIndex, monthLabel, normalizeData } from '../js/data.js';
import { buildSchedule } from '../js/schedule.js';
import { captionFor, captionHtml, introCaption, odometerDigits, rollingYear, summaryCaption } from '../js/hud.js';

const data = normalizeData(JSON.parse(readFileSync(new URL('../data/ai_startups_timeline.json', import.meta.url), 'utf8')));
const schedule = buildSchedule(data);
const beatFor = (label) => {
    const beat = schedule.beats.find((candidate) => monthLabel(candidate.month) === label);
    assert.ok(beat, `no beat for ${label}`);
    return beat;
};
const countOf = (html, needle) => html.split(needle).length - 1;

test('odometerDigits gives the roll position of each place', () => {
    assert.deepEqual(odometerDigits(2024, 4), [2, 0, 2, 4]);
    assert.deepEqual(odometerDigits(7, 2), [0, 7]);
});

test('a place rolls only while every place below it turns from 9 to 0', () => {
    assert.deepEqual(odometerDigits(2019.5, 4), [2, 0, 1.5, 9.5]);
    assert.deepEqual(odometerDigits(2018.5, 4), [2, 0, 1, 8.5]);
    assert.deepEqual(odometerDigits(99.25, 3), [0.25, 9.25, 9.25]);
});

test('roll positions always stay within [0, 10)', () => {
    for (let value = 0; value < 10_000; value += 13.37) {
        odometerDigits(value, 4).forEach((position) => {
            assert.ok(position >= 0 && position < 10, `${position} for ${value}`);
        });
    }
});

test('the year rolls only during the December to January step', () => {
    const june = monthIndex('2020-06');
    const december = monthIndex('2020-12');
    assert.equal(rollingYear(june), 2020);
    assert.equal(rollingYear(june + 0.5), 2020);
    assert.equal(rollingYear(december), 2020);
    assert.equal(rollingYear(december + 0.5), 2020.5);
    assert.equal(rollingYear(monthIndex('2021-01')), 2021);
});

test('a month with one founding is captioned with its story and deal rows', () => {
    const beat = beatFor('Dec 2015');
    const caption = captionFor(beat);
    assert.equal(caption.tone, 'found');
    assert.equal(caption.kicker, 'Founded');
    assert.equal(caption.title, 'OpenAI');
    assert.equal(caption.body, data.startups[0].comment);
    assert.equal(caption.rows.length, beat.deals.length);
    assert.equal(caption.rows[0].at, beat.events[beat.foundings.length].t);
});

test('a month with two foundings names both', () => {
    const caption = captionFor(beatFor('Jan 2022'));
    assert.equal(caption.kicker, '2 startups founded');
    assert.equal(caption.title, 'Perplexity AI & ElevenLabs');
    assert.equal(caption.body, '');
});

test('deal-only months are summarized by count', () => {
    const busy = beatFor('Jun 2024');
    const caption = captionFor(busy);
    assert.equal(caption.tone, 'deal');
    assert.equal(caption.kicker, '10 deals');
    assert.equal(caption.rows.length, 10);
    assert.equal(caption.body, '');

    const quiet = beatFor('Sep 2023');
    const single = captionFor(quiet);
    assert.equal(single.kicker, '1 deal');
    assert.equal(single.title, quiet.deals[0].startup);
    assert.equal(single.body, quiet.deals[0].comment);
    assert.deepEqual(single.rows, []);
});

test('caption deal rows are capped, and each carries the time its deal fires', () => {
    const caption = captionFor(beatFor('Jun 2024'));
    const html = captionHtml(caption);
    assert.equal(countOf(html, 'class="caption__deal"'), 3);
    assert.ok(html.includes('class="caption__deal caption__more"'));
    assert.ok(html.includes('+ 7 more'));
    assert.equal(countOf(html, 'data-at='), 4);
    caption.rows.slice(0, 4).forEach((row) => assert.ok(html.includes(`data-at="${row.at}"`)));
});

test('caption markup escapes data values', () => {
    const html = captionHtml({
        kicker: '<b>kicker</b>',
        title: 'A & B',
        body: '"quoted"',
        rows: [{ investor: '<script>alert(1)</script>', startup: "O'Neil", at: 0 }],
    });
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('O&#39;Neil'));
    assert.ok(html.includes('A &amp; B'));
    assert.ok(html.includes('&quot;quoted&quot;'));
});

test('intro and summary captions frame the timeline', () => {
    assert.deepEqual(introCaption().rows, []);
    const summary = summaryCaption(schedule, { startups: 8, investors: 56, deals: 75 });
    assert.equal(summary.kicker, '2015 – 2024');
    assert.equal(summary.title, 'The network as of Dec 2024');
    assert.equal(summary.body, '8 startups · 56 investors · 75 deals');
});
