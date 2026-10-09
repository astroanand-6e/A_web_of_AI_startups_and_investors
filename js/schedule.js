// Turns the dataset into a choreographed timeline: when each founding and deal
// fires, how long every month holds, and how the date rolls between months.
// Pure, so the pacing is unit-tested without a browser.

import { clamp, easeCubicInOut } from './motion.js';

/** Milliseconds at 1x speed. */
export const TIMING = Object.freeze({
    intro: 1100,           // pre-roll: the current graph collapses while the date rolls in
    introRoll: 11,         // months the date rolls through during the intro
    msPerMonth: 45,        // quiet stretches of the calendar compress to this pace...
    gapMin: 360,           // ...but every jump between months gets at least this long
    gapMax: 1100,
    foundStagger: 420,
    investAfterFound: 760, // a month's deals wait for its foundings to land
    investStagger: 210,
    settle: 560,           // lets the last link of a month finish drawing
    hold: 480,
    endHold: 1600,
});

function groupByMonth(data) {
    const months = new Map();
    const monthFor = (index) => {
        if (!months.has(index)) months.set(index, { foundings: [], deals: [] });
        return months.get(index);
    };
    data.startups.forEach((startup) => monthFor(startup.foundedIndex).foundings.push(startup));
    data.investments.forEach((deal) => monthFor(deal.effectiveIndex).deals.push(deal));
    return months;
}

function beatEvents(beatIndex, start, foundings, deals, timing) {
    const dealStart = foundings.length
        ? start + (foundings.length - 1) * timing.foundStagger + timing.investAfterFound
        : start;
    return [
        ...foundings.map((startup, i) => Object.freeze({
            kind: 'found', t: start + i * timing.foundStagger, beatIndex, startupId: startup.id, startup,
        })),
        ...deals.map((deal, i) => Object.freeze({
            kind: 'invest',
            t: dealStart + i * timing.investStagger,
            beatIndex,
            startupId: deal.startupId,
            investorId: deal.investorId,
            key: deal.key,
            deal,
        })),
    ];
}

/**
 * Each month with activity becomes a "beat": its foundings land first, then its
 * deals (grouped by company), then the beat settles and holds before the date
 * rolls on to the next month.
 */
export function buildSchedule(data, timing = TIMING) {
    const months = groupByMonth(data);
    const startupOrder = new Map(data.startups.map((startup, i) => [startup.name, i]));
    const indices = [...months.keys()].sort((a, b) => a - b);
    const segments = [Object.freeze({ t0: 0, t1: timing.intro, m0: indices[0] - timing.introRoll, m1: indices[0] })];
    const beats = [];
    let t = timing.intro;

    indices.forEach((month, index) => {
        if (index > 0) {
            const previous = indices[index - 1];
            const gap = clamp((month - previous) * timing.msPerMonth, timing.gapMin, timing.gapMax);
            segments.push(Object.freeze({ t0: t, t1: t + gap, m0: previous, m1: month }));
            t += gap;
        }
        const { foundings, deals } = months.get(month);
        // Grouping a month's deals by company keeps the eye on one node at a time.
        const ordered = [...deals].sort((a, b) => startupOrder.get(a.startup) - startupOrder.get(b.startup));
        const events = beatEvents(index, t, foundings, ordered, timing);
        const settled = events[events.length - 1].t + timing.settle;
        beats.push(Object.freeze({ index, month, t, settled, end: settled + timing.hold, foundings, deals: ordered, events }));
        t = settled + timing.hold;
    });

    return Object.freeze({
        timing,
        beats,
        events: beats.flatMap((beat) => beat.events),
        segments,
        summaryT: t,
        duration: t + timing.endHold,
        firstMonth: indices[0],
        lastMonth: indices[indices.length - 1],
    });
}

/** How many events have fired at time t (an event exactly at t counts). */
export function eventCountAt(schedule, t) {
    const { events } = schedule;
    let lo = 0;
    let hi = events.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (events[mid].t <= t) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/** The network after the first `count` events: who exists, and how many rounds each pair has closed. */
export function stateAt(schedule, count) {
    const startups = new Set();
    const investors = new Set();
    const rounds = new Map();
    let deals = 0;
    for (const event of schedule.events.slice(0, count)) {
        if (event.kind === 'found') {
            startups.add(event.startupId);
            continue;
        }
        investors.add(event.investorId);
        rounds.set(event.key, (rounds.get(event.key) || 0) + 1);
        deals += 1;
    }
    return { startups, investors, rounds, deals };
}

/** Index of the month (beat) on screen at time t, or -1 during the intro. */
export function beatIndexAt(schedule, t) {
    let index = -1;
    for (const beat of schedule.beats) {
        if (beat.t > t) break;
        index = beat.index;
    }
    return index;
}

/** Calendar position at time t as a month index; fractional while the date rolls between months. */
export function dateAt(schedule, t) {
    let segment = schedule.segments[0];
    for (const candidate of schedule.segments) {
        if (candidate.t0 > t) break;
        segment = candidate;
    }
    if (t <= segment.t0) return segment.m0;
    if (t >= segment.t1) return segment.m1;
    return segment.m0 + (segment.m1 - segment.m0) * easeCubicInOut((t - segment.t0) / (segment.t1 - segment.t0));
}

// Stepping while playing lands 1 ms before a beat, so its events still play with
// full effects. Stepping while paused lands once the beat has settled, so the
// still frame shows the whole month.
const playingStop = (beat) => Math.max(0, beat.t - 1);
const pausedStop = (beat) => beat.settled;

export function nextBeatTime(schedule, t, { playing = true } = {}) {
    const stop = playing ? playingStop : pausedStop;
    const beat = schedule.beats.find((candidate) => stop(candidate) > t + 1);
    return beat ? stop(beat) : schedule.duration;
}

/** Steps back: restarts the current month, or goes to the one before if it began less than `grace` ms ago. */
export function prevBeatTime(schedule, t, { playing = true, grace = 400 } = {}) {
    let target = 0;
    for (const beat of schedule.beats) {
        const reached = playing ? beat.t < t - grace : beat.settled < t - 1;
        if (!reached) break;
        target = playing ? playingStop(beat) : pausedStop(beat);
    }
    return target;
}
