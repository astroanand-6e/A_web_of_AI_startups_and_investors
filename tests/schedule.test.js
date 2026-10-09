import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { monthIndex, normalizeData } from '../js/data.js';
import {
    TIMING, beatIndexAt, buildSchedule, dateAt, eventCountAt, nextBeatTime, prevBeatTime, stateAt,
} from '../js/schedule.js';

const bundled = normalizeData(JSON.parse(readFileSync(new URL('../data/ai_startups_timeline.json', import.meta.url), 'utf8')));
const schedule = buildSchedule(bundled);
const { beats, events } = schedule;

// Months 2020-01, 2020-02, 2020-12, 2023-02: gaps of 1, 10 and 26 months.
const synthetic = buildSchedule(normalizeData({
    startups: [
        { name: 'Alpha', founded: '2020-01' },
        { name: 'Beta', founded: '2020-01' },
    ],
    investments: [
        { investor: 'Fund B', startup: 'Beta', date: '2020-01' },
        { investor: 'Fund A', startup: 'Alpha', date: '2020-01' },
        { investor: 'Fund A', startup: 'Beta', date: '2020-02' },
        { investor: 'Fund D', startup: 'Beta', date: '2020-12' },
        { investor: 'Fund C', startup: 'Alpha', date: '2023-02' },
    ],
}));

test('events are chronological and every deal follows its startup\'s founding', () => {
    const foundedAt = new Map();
    events.forEach((event, i) => {
        if (i > 0) assert.ok(event.t >= events[i - 1].t, `event ${i} fires before event ${i - 1}`);
        if (event.kind === 'found') {
            foundedAt.set(event.startupId, event.t);
            return;
        }
        assert.ok(foundedAt.has(event.startupId), `${event.key} fires before its startup is founded`);
        assert.ok(event.t > foundedAt.get(event.startupId));
    });
});

test('the bundled dataset becomes 21 monthly beats lasting under a minute', () => {
    assert.equal(beats.length, 21);
    assert.equal(events.length, 83);
    assert.equal(schedule.firstMonth, monthIndex('2015-12'));
    assert.equal(schedule.lastMonth, monthIndex('2024-12'));
    assert.ok(schedule.duration > 30_000 && schedule.duration < 60_000, `duration ${schedule.duration} ms`);
    assert.equal(schedule.summaryT, schedule.duration - TIMING.endHold);
});

test('each beat holds its events, then settles and pauses before the next month', () => {
    beats.forEach((beat, i) => {
        beat.events.forEach((event) => {
            assert.ok(event.t >= beat.t && event.t < beat.settled);
            assert.equal(event.beatIndex, i);
        });
        assert.equal(beat.settled, beat.events[beat.events.length - 1].t + TIMING.settle);
        assert.equal(beat.end, beat.settled + TIMING.hold);
        const next = beats[i + 1];
        if (next) {
            const gap = next.t - beat.end;
            assert.ok(gap >= TIMING.gapMin && gap <= TIMING.gapMax, `gap after beat ${i} is ${gap} ms`);
        }
    });
});

test('eventCountAt counts the events fired at or before t', () => {
    assert.equal(eventCountAt(schedule, -1), 0);
    assert.equal(eventCountAt(schedule, events[0].t - 0.5), 0);
    assert.equal(eventCountAt(schedule, events[0].t), 1);
    events.forEach((event, i) => assert.ok(eventCountAt(schedule, event.t) >= i + 1));
    assert.equal(eventCountAt(schedule, schedule.duration), events.length);
});

test('stateAt replays the network up to a point', () => {
    const empty = stateAt(schedule, 0);
    assert.equal(empty.startups.size + empty.investors.size + empty.rounds.size + empty.deals, 0);

    const full = stateAt(schedule, events.length);
    assert.equal(full.startups.size, 8);
    assert.equal(full.investors.size, 56);
    assert.equal(full.deals, 75);
    assert.equal(full.rounds.size, 72);
    assert.equal(full.rounds.get('i:Microsoft>s:OpenAI'), 3);
});

test('beatIndexAt is -1 during the intro, then follows the beats', () => {
    assert.equal(beatIndexAt(schedule, 0), -1);
    assert.equal(beatIndexAt(schedule, beats[0].t - 1), -1);
    assert.equal(beatIndexAt(schedule, beats[0].t), 0);
    assert.equal(beatIndexAt(schedule, beats[5].t + 1), 5);
    assert.equal(beatIndexAt(schedule, schedule.duration), beats.length - 1);
});

test('the date rolls in before the first month, holds on each beat and never runs backwards', () => {
    assert.equal(dateAt(schedule, 0), schedule.firstMonth - TIMING.introRoll);
    beats.forEach((beat) => {
        assert.equal(dateAt(schedule, beat.t), beat.month);
        assert.equal(dateAt(schedule, beat.settled), beat.month);
        assert.equal(dateAt(schedule, beat.end), beat.month);
    });
    assert.equal(dateAt(schedule, schedule.duration), schedule.lastMonth);
    let previous = -Infinity;
    for (let t = 0; t <= schedule.duration; t += 25) {
        const month = dateAt(schedule, t);
        assert.ok(month >= previous, `date runs backwards at ${t} ms`);
        previous = month;
    }
});

test('stepping forward while playing lands just before each beat', () => {
    assert.equal(nextBeatTime(schedule, 0), beats[0].t - 1);
    assert.equal(nextBeatTime(schedule, beats[0].t - 1), beats[1].t - 1);
    assert.equal(nextBeatTime(schedule, beats[3].t + 50), beats[4].t - 1);
    assert.equal(nextBeatTime(schedule, beats[beats.length - 1].t), schedule.duration);
});

test('stepping back while playing restarts the month, or goes back one inside the grace period', () => {
    assert.equal(prevBeatTime(schedule, beats[3].t + 1000), beats[3].t - 1);
    assert.equal(prevBeatTime(schedule, beats[3].t + 100), beats[2].t - 1);
    assert.equal(prevBeatTime(schedule, beats[0].t + 100), 0);
    assert.equal(prevBeatTime(schedule, 0), 0);
});

test('stepping while paused moves between settled months', () => {
    const paused = { playing: false };
    assert.equal(nextBeatTime(schedule, 0, paused), beats[0].settled);
    assert.equal(nextBeatTime(schedule, beats[0].settled, paused), beats[1].settled);
    assert.equal(prevBeatTime(schedule, beats[2].settled, paused), beats[1].settled);
    assert.equal(prevBeatTime(schedule, beats[0].settled, paused), 0);
    const there = nextBeatTime(schedule, beats[5].settled, paused);
    assert.equal(prevBeatTime(schedule, there, paused), beats[5].settled);
    assert.equal(nextBeatTime(schedule, beats[beats.length - 1].settled, paused), schedule.duration);
});

test('foundings are staggered and a month\'s deals wait for them, grouped by company', () => {
    const [first] = synthetic.beats;
    assert.equal(first.t, TIMING.intro);
    const dealStart = TIMING.foundStagger + TIMING.investAfterFound;
    assert.deepEqual(
        first.events.map((event) => [event.kind, event.t - first.t]),
        [['found', 0], ['found', TIMING.foundStagger], ['invest', dealStart], ['invest', dealStart + TIMING.investStagger]],
    );
    assert.deepEqual(first.deals.map((deal) => deal.startup), ['Alpha', 'Beta']);
    assert.equal(synthetic.beats[1].events[0].t, synthetic.beats[1].t, 'a month without foundings starts its deals at once');
});

test('gaps between months scale with the calendar, within limits', () => {
    const gaps = synthetic.beats.slice(1).map((beat, i) => beat.t - synthetic.beats[i].end);
    assert.deepEqual(gaps, [TIMING.gapMin, 10 * TIMING.msPerMonth, TIMING.gapMax]);
    assert.equal(synthetic.duration, synthetic.beats[synthetic.beats.length - 1].end + TIMING.endHold);
    assert.equal(stateAt(synthetic, synthetic.events.length).rounds.get('i:Fund A>s:Beta'), 1);
});
