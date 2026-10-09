// Entry point: loads the data, builds the graph, camera, HUD and details panel,
// and drives them all from one frame loop so every moving part stays in lockstep.

import { normalizeData } from './data.js';
import { buildSchedule, eventCountAt, nextBeatTime, prevBeatTime, stateAt } from './schedule.js';
import { createPlayer } from './timeline.js';
import { createCamera, fitView } from './camera.js';
import { createGraph } from './graph.js';
import { createHud } from './hud.js';
import { createDetails } from './details.js';

const { d3 } = window;

const DATA_URL = './data/ai_startups_timeline.json';
const SPEEDS = Object.freeze([1, 2, 4, 0.5]);
const MAX_FRAME_MS = 64;  // a dropped frame or a background tab never turns into a jump
const LOOKAHEAD_MS = 750; // the camera starts framing nodes this long before they appear
const ZOOM_EXTENT = Object.freeze([0.15, 10]); // spans FIT's range, so a wheel tick never snaps a framed view
const ZOOM_STEP = 1.35;
const OPENING_ZOOM = 1.35; // the opening shot starts this much closer, then pulls back
const OPENING_SMOOTH_TIME = 0.9;
const FIT = Object.freeze({ kMin: 0.2, kMax: 1.25, pad: 36 });
// Screen space covered by overlays, so the camera frames the graph around them.
const INSETS = Object.freeze({
    explore: Object.freeze({ top: 20, right: 64, bottom: 20, left: 20 }),
    timeline: Object.freeze({ top: 86, right: 64, bottom: 84, left: 24 }),
});
const CAPTION_GAP = 12;         // px kept clear between the caption card and the framed graph
const SIDE_SWITCH_RATIO = 1.12; // the framing changes sides only for a clearly closer shot, so it never flip-flops
// A focused element that uses one of these keys itself keeps it from the timeline shortcuts.
const KEEPS_SPACE = 'input, textarea, select, [contenteditable="true"], .scrubber button';
const KEEPS_ARROWS = 'input:not([type="checkbox"]), textarea, select, [contenteditable="true"]';

const readFilters = (inputs) => ({ startup: inputs.startup.checked, investor: inputs.investor.checked });

function startApp(container, data) {
    const schedule = buildSchedule(data);
    const player = createPlayer({ duration: schedule.duration });
    const totals = { startups: data.startups.length, investors: data.investors.length, deals: data.investments.length };
    const details = createDetails(data, document.getElementById('node-details'));
    const filterInputs = {
        startup: document.getElementById('filter-startups'),
        investor: document.getElementById('filter-investors'),
    };
    const magicWand = document.getElementById('magic-wand');
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    // Frame-loop state comes first: callbacks below may wake the loop during setup.
    let timer = null;
    let last = 0;
    let reduced = motionQuery.matches;
    let mode = 'explore';
    let speed = SPEEDS[0];
    let eventCount = schedule.events.length;
    let filters = readFilters(filterInputs);
    let pinned = null;
    let resumeAfterScrub = false;
    let captionSide = 'beside';
    let applyingCamera = false;
    let size = { width: container.clientWidth, height: container.clientHeight };

    const isReduced = () => reduced;
    // Effects shorten at higher speeds, but less than proportionally, so they still read.
    const timeScale = () => (mode === 'timeline' ? 1 / Math.sqrt(speed) : 1);

    // During the timeline the caption card covers the bottom-left corner, so the free
    // area is L-shaped: the graph is framed either beside the card or above it. Framing
    // clears the live card; `live: false` plans with the caption's fixed reserve instead,
    // so the choice of side doesn't flip each time a month's card changes height.
    function insetsFor(side, { live = true } = {}) {
        if (mode !== 'timeline') return INSETS.explore;
        const base = INSETS.timeline;
        const caption = hud.captionArea();
        if (side === 'beside') return { ...base, left: Math.max(base.left, caption.right + CAPTION_GAP) };
        const top = live ? Math.max(caption.top, caption.reservedTop) : caption.reservedTop;
        return { ...base, bottom: Math.max(base.bottom, top + CAPTION_GAP) };
    }

    const view = () => ({ width: size.width, height: size.height, ...insetsFor(captionSide) });

    const graph = createGraph(container, data, {
        isReduced,
        timeScale,
        onHover: (node, event) => {
            if (node) {
                details.show(node.id);
                details.showTooltip(node.id, event);
                return;
            }
            details.hideTooltip();
            if (pinned) details.show(pinned.id);
        },
        onPointerMove: (event) => details.moveTooltip(event),
        onSelect: (node) => {
            pinned = node;
            if (node) details.show(node.id);
        },
        onWake: () => wake(),
    });

    const zoom = d3.zoom()
        .scaleExtent(ZOOM_EXTENT)
        .extent(() => [[0, 0], [size.width, size.height]])
        .on('zoom', (event) => {
            graph.setTransform(event.transform);
            // A wheel or drag from the user takes the camera out of auto-framing. The camera's own
            // moves can carry a user event too: d3-zoom files them under any gesture in progress,
            // such as a plain click on the background.
            if (event.sourceEvent && !applyingCamera) {
                camera.release(event.transform);
                wake();
            }
        });
    graph.svg.call(zoom).on('dblclick.zoom', null);

    const camera = createCamera({
        getView: view,
        getBounds: () => graph.bounds(upcomingNodeIds()),
        apply: ({ x, y, k }) => {
            applyingCamera = true;
            try {
                graph.svg.call(zoom.transform, d3.zoomIdentity.translate(x, y).scale(k));
            } finally {
                applyingCamera = false;
            }
        },
        fit: FIT,
        zoomExtent: ZOOM_EXTENT,
        isReduced,
    });

    const hud = createHud(container, schedule, totals, {
        isReduced,
        onToggle: togglePlay,
        onSeek: seek,
        onScrubStart: () => {
            resumeAfterScrub = player.playing;
            player.pause();
            syncPlayState();
        },
        onScrubEnd: () => {
            if (resumeAfterScrub) player.play();
            syncPlayState();
            wake();
        },
        onStep: step,
        onSpeed: cycleSpeed,
        onReplay: startTimeline,
        onExit: exitTimeline,
        onCaptionResize: () => {
            if (mode === 'timeline') wake(); // reframe around the card even when nothing else moves
        },
    });

    // ---- state -------------------------------------------------------------------

    /** Nodes about to appear, so the camera starts moving before they arrive. */
    function upcomingNodeIds() {
        if (mode !== 'timeline' || (!reduced && !player.playing)) return [];
        // With reduced motion the camera holds one shot of the whole network instead of following the action.
        const horizon = reduced ? Infinity : player.time + LOOKAHEAD_MS * speed;
        const ids = [];
        for (let i = eventCount; i < schedule.events.length && schedule.events[i].t <= horizon; i += 1) {
            const event = schedule.events[i];
            if (event.kind === 'found' && filters.startup) ids.push(event.startupId);
            if (event.kind === 'invest' && filters.investor) ids.push(event.investorId);
        }
        return ids;
    }

    /** Frames the graph on whichever side of the caption gives the closer shot. */
    function pickCaptionSide() {
        if (mode !== 'timeline') return;
        const bounds = graph.bounds(upcomingNodeIds());
        if (!bounds) return;
        const zoomFor = (side) => fitView(bounds, { width: size.width, height: size.height, ...insetsFor(side, { live: false }) }, FIT).k;
        const other = captionSide === 'beside' ? 'above' : 'beside';
        if (zoomFor(other) > zoomFor(captionSide) * SIDE_SWITCH_RATIO) captionSide = other;
    }

    function currentState() {
        const state = stateAt(schedule, eventCount);
        const nodeIds = new Set([
            ...(filters.startup ? state.startups : []),
            ...(filters.investor ? state.investors : []),
        ]);
        const counts = { startups: state.startups.size, investors: state.investors.size, deals: state.deals };
        return { nodeIds, rounds: state.rounds, counts };
    }

    function applyState(style, fired = []) {
        const state = currentState();
        graph.sync(state, { style, fired });
        hud.setCounts(state.counts);
        wake();
    }

    /** Brings the graph and HUD to the player's time; `natural` marks forward playback. */
    function syncPlayhead(natural) {
        const count = eventCountAt(schedule, player.time);
        if (count !== eventCount) {
            const forward = natural && count > eventCount;
            const fired = forward ? schedule.events.slice(eventCount, count) : [];
            eventCount = count;
            if (!forward) graph.clearEffects();
            applyState(forward ? 'natural' : 'quick', fired);
        }
        hud.setTime(player.time);
    }

    // ---- transport -----------------------------------------------------------------

    function playState() {
        if (player.playing) return 'playing';
        return player.ended ? 'ended' : 'paused';
    }

    function syncPlayState() {
        hud.setPlayState(playState());
    }

    function seek(t) {
        if (mode !== 'timeline') return; // a scrub that outlives the timeline (Esc mid-drag) changes nothing
        player.seek(t);
        syncPlayhead(false);
        syncPlayState();
        wake();
    }

    function step(action) {
        const options = { playing: player.playing };
        const targets = {
            next: () => nextBeatTime(schedule, player.time, options),
            prev: () => prevBeatTime(schedule, player.time, options),
            start: () => 0,
            end: () => schedule.duration,
        };
        if (targets[action]) seek(targets[action]());
    }

    function togglePlay() {
        if (player.ended) {
            startTimeline();
            return;
        }
        if (player.playing) player.pause();
        else player.play();
        syncPlayState();
        wake();
    }

    function cycleSpeed() {
        speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
        player.setSpeed(speed);
        hud.setSpeed(speed);
    }

    function startTimeline() {
        mode = 'timeline';
        container.classList.add('is-timeline');
        graph.setPinned(null);
        details.hideTooltip();
        graph.clearEffects();
        eventCount = 0;
        applyState('collapse');
        player.seek(0);
        player.setSpeed(speed);
        hud.reset();
        hud.layout();
        hud.setTime(0);
        player.play();
        syncPlayState();
        captionSide = 'beside';
        camera.follow();
        wake();
    }

    function exitTimeline() {
        const refocus = hud.hasFocus(); // the transport is about to hide; don't strand keyboard focus in it
        player.pause();
        mode = 'explore';
        container.classList.remove('is-timeline', 'is-paused');
        graph.clearEffects();
        eventCount = schedule.events.length;
        applyState('reveal');
        camera.follow();
        wake();
        if (refocus) magicWand.focus({ preventScroll: true });
    }

    // ---- frame loop: runs only while something moves ----------------------------------

    function frame(elapsed) {
        const dt = Math.min(MAX_FRAME_MS, elapsed - last);
        last = elapsed;
        let active = false;
        if (mode === 'timeline') {
            if (player.advance(dt)) {
                syncPlayhead(true);
                if (!player.playing) syncPlayState(); // just reached the end
                active = true;
            }
            active = hud.tick(dt) || active;
        }
        active = graph.tick() || active;
        pickCaptionSide();
        // The camera waits out a node drag: framing a node that follows the pointer would chase it.
        if (!graph.isDragging()) active = camera.step(dt / 1000) || active;
        graph.render();
        if (!active) {
            timer.stop();
            timer = null;
        }
    }

    function wake() {
        if (timer) return;
        last = 0;
        timer = d3.timer(frame);
    }

    // ---- wiring --------------------------------------------------------------------

    // Timeline shortcuts take plain keys only, and only while the timeline is showing.
    const isTimelineKey = (event) => mode === 'timeline' && !event.defaultPrevented
        && !event.metaKey && !event.ctrlKey && !event.altKey;
    const targetKeeps = (event, selector) => event.target instanceof Element && event.target.closest(selector) !== null;
    // Space plays / pauses even on a button left focused by a click (Animate Timeline would
    // otherwise restart); the transport's own buttons and the filter checkboxes keep it.
    const claimsSpace = (event) => event.key === ' ' && isTimelineKey(event) && !targetKeeps(event, KEEPS_SPACE);

    function onKeyDown(event) {
        if (!isTimelineKey(event)) return;
        if (event.key === 'Escape') {
            exitTimeline();
        } else if (claimsSpace(event)) {
            event.preventDefault();
            if (!event.repeat) togglePlay();
        } else if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && !targetKeeps(event, KEEPS_ARROWS)) {
            event.preventDefault();
            step(event.key === 'ArrowRight' ? 'next' : 'prev');
        }
    }

    // Firefox clicks a focused button on Space's keyup even when the keydown was cancelled.
    function onKeyUp(event) {
        if (claimsSpace(event)) event.preventDefault();
    }

    magicWand.addEventListener('click', startTimeline);
    document.getElementById('reset-view').addEventListener('click', () => {
        graph.setPinned(null);
        camera.follow();
        wake();
    });
    container.querySelectorAll('[data-zoom]').forEach((button) => {
        button.addEventListener('click', () => {
            const action = button.dataset.zoom;
            if (action === 'fit') camera.follow();
            else camera.zoomBy(action === 'in' ? ZOOM_STEP : 1 / ZOOM_STEP);
            wake();
        });
    });
    Object.values(filterInputs).forEach((input) => {
        input.addEventListener('change', () => {
            filters = readFilters(filterInputs);
            applyState('filter');
        });
    });
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    motionQuery.addEventListener('change', (event) => {
        reduced = event.matches;
    });
    const resizeObserver = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect;
        if (!width || !height) return;
        size = { width, height };
        hud.layout();
        wake();
    });
    resizeObserver.observe(container);

    // Opening shot: the network ripples in from the centre while the camera pulls back.
    hud.setSpeed(speed);
    hud.layout();
    applyState('reveal');
    const opening = graph.bounds();
    if (opening) {
        const fit = fitView(opening, view(), FIT);
        camera.jumpTo({ ...fit, k: fit.k * (reduced ? 1 : OPENING_ZOOM) });
    }
    camera.follow({ smoothTime: OPENING_SMOOTH_TIME });
    wake();
}

async function boot() {
    const container = document.getElementById('cy');
    const overlay = container.querySelector('.loading-overlay');
    // Browsers block fetch() and modules on file://; an inline script in index.html explains that.
    if (window.location.protocol === 'file:') return;
    try {
        if (!d3) throw new Error('The D3 library failed to load. Check your connection and reload the page.');
        const response = await fetch(DATA_URL);
        if (!response.ok) throw new Error(`Could not load the timeline data (HTTP ${response.status}).`);
        const data = normalizeData(await response.json());
        if (data.skipped.length) console.warn('Skipped investments that name an unknown startup:', data.skipped);
        startApp(container, data);
        overlay.classList.add('is-hidden');
    } catch (error) {
        console.error(error);
        overlay.classList.add('is-error');
        overlay.querySelector('p').textContent = error.message;
    }
}

boot();
