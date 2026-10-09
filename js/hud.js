// The timeline's heads-up display: a rolling odometer date, live counters, a
// lower-third caption for each month, and a scrubber. The pure helpers are
// exported for tests; createHud() wires them to the markup in index.html.

import { clamp } from './motion.js';
import { MONTH_NAMES, escapeHtml, monthLabel, yearOf } from './data.js';
import { beatIndexAt, dateAt } from './schedule.js';

const ROW_EM = 1.1;       // odometer row height, matches .odo in styles.css
const MONTH_ROW_EM = 1.3; // month roller row height, matches .roller
const COUNT_SMOOTHING_MS = 120;
const YEAR_LABEL_GAP_PX = 38;
const CARD_EXIT_MS = 420;
const MAX_CAPTION_ROWS = 3;
const ROW_STAGGER_MS = 45;
const DIGITS = '01234567890'; // the trailing 0 lets a 9 roll forward into 0
const PLAY_STATES = Object.freeze({
    playing: Object.freeze({ icon: 'fa-pause', label: 'Pause timeline' }),
    paused: Object.freeze({ icon: 'fa-play', label: 'Play timeline' }),
    ended: Object.freeze({ icon: 'fa-rotate-right', label: 'Replay timeline' }),
});
const KEY_ACTIONS = Object.freeze({
    ArrowRight: 'next', ArrowUp: 'next', PageUp: 'next',
    ArrowLeft: 'prev', ArrowDown: 'prev', PageDown: 'prev',
    Home: 'start', End: 'end',
});

/**
 * Roll position (0 to <10) of each digit, most significant first. A place moves
 * only while every place below it rolls from 9 to 0, like a mechanical counter.
 */
export function odometerDigits(value, digits) {
    const whole = Math.floor(value);
    const positions = new Array(digits);
    let carry = value - whole;
    let place = 1;
    for (let i = digits - 1; i >= 0; i -= 1) {
        const digit = Math.floor(whole / place) % 10;
        positions[i] = digit + carry;
        if (digit !== 9) carry = 0;
        place *= 10;
    }
    return positions;
}

/** Year shown for a (fractional) month index: it rolls only during the December → January step. */
export function rollingYear(month) {
    const year = Math.floor(month / 12);
    return year + Math.max(0, month - year * 12 - 11);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const unique = (items) => [...new Set(items)];

function dealRows(beat) {
    const offset = beat.foundings.length;
    return beat.deals.map((deal, i) => ({ investor: deal.investor, startup: deal.startup, at: beat.events[offset + i].t }));
}

export function captionFor(beat) {
    if (beat.foundings.length) {
        const names = beat.foundings.map((startup) => startup.name);
        return {
            tone: 'found',
            kicker: names.length === 1 ? 'Founded' : `${names.length} startups founded`,
            title: names.join(' & '),
            body: names.length === 1 ? beat.foundings[0].comment : '',
            rows: dealRows(beat),
        };
    }
    const companies = unique(beat.deals.map((deal) => deal.startup));
    const single = beat.deals.length === 1;
    return {
        tone: 'deal',
        kicker: plural(beat.deals.length, 'deal'),
        title: companies.length === 1 ? companies[0] : `${companies.length} startups funded`,
        body: single ? beat.deals[0].comment : '',
        rows: single ? [] : dealRows(beat),
    };
}

export function introCaption() {
    return {
        tone: 'intro',
        kicker: 'Timeline',
        title: 'How the AI funding web formed',
        body: 'Every founding and funding round, month by month.',
        rows: [],
    };
}

export function summaryCaption(schedule, totals) {
    return {
        tone: 'summary',
        kicker: `${yearOf(schedule.firstMonth)} – ${yearOf(schedule.lastMonth)}`,
        title: `The network as of ${monthLabel(schedule.lastMonth)}`,
        body: `${plural(totals.startups, 'startup')} · ${plural(totals.investors, 'investor')} · ${plural(totals.deals, 'deal')}`,
        rows: [],
    };
}

/** Deal rows start collapsed; the HUD expands each one when the playhead reaches its `data-at` time. */
export function captionHtml(caption) {
    const rows = caption.rows || [];
    const items = rows.slice(0, MAX_CAPTION_ROWS).map((row) => (
        `<li class="caption__deal" data-at="${Number(row.at)}">`
        + `<b>${escapeHtml(row.investor)}</b><i class="fas fa-arrow-right" aria-hidden="true"></i>`
        + `<span>${escapeHtml(row.startup)}</span></li>`
    ));
    const hidden = rows.length - MAX_CAPTION_ROWS;
    if (hidden > 0) {
        items.push(`<li class="caption__deal caption__more" data-at="${Number(rows[MAX_CAPTION_ROWS].at)}">+ ${hidden} more</li>`);
    }
    return [
        `<p class="caption__kicker">${escapeHtml(caption.kicker)}</p>`,
        `<h4 class="caption__title">${escapeHtml(caption.title)}</h4>`,
        caption.body ? `<p class="caption__body">${escapeHtml(caption.body)}</p>` : '',
        items.length ? `<ul class="caption__deals">${items.join('')}</ul>` : '',
    ].join('');
}

// ---- DOM helpers ----------------------------------------------------------------

function cellColumn(className, labels) {
    const column = document.createElement('span');
    column.className = className;
    labels.forEach((label) => {
        const cell = document.createElement('span');
        cell.textContent = label;
        column.appendChild(cell);
    });
    return column;
}

function buildOdometer(el, digits) {
    el.textContent = '';
    return Array.from({ length: digits }, () => {
        const digit = document.createElement('span');
        digit.className = 'odo__digit';
        const column = cellColumn('odo__column', [...DIGITS]);
        digit.appendChild(column);
        el.appendChild(digit);
        return { digit, column, pos: null, opacity: null };
    });
}

function buildRoller(el) {
    const column = cellColumn('roller__column', [...MONTH_NAMES, MONTH_NAMES[0]].map((name) => name.toUpperCase()));
    el.replaceChildren(column);
    return { column, pos: null };
}

// `pos` and `opacity` are render caches that skip DOM writes when nothing changed.
function roll(slot, pos, rowEm) {
    if (slot.pos !== null && Math.abs(slot.pos - pos) < 1e-4) return;
    slot.pos = pos;
    slot.column.style.transform = `translate3d(0, ${(-pos * rowEm).toFixed(4)}em, 0)`;
}

function setOdometer(columns, value) {
    const positions = odometerDigits(value, columns.length);
    columns.forEach((slot, i) => {
        roll(slot, positions[i], ROW_EM);
        // Leading zeros stay invisible and fade in as the value reaches their place.
        const threshold = 10 ** (columns.length - 1 - i) - 1;
        const opacity = i === columns.length - 1 ? 1 : clamp(value - threshold, 0, 1);
        if (opacity !== slot.opacity) {
            slot.opacity = opacity;
            slot.digit.style.opacity = String(opacity);
        }
    });
}

export function createHud(root, schedule, totals, handlers) {
    const { isReduced, onToggle, onSeek, onScrubStart, onScrubEnd, onStep, onSpeed, onReplay, onExit, onCaptionResize } = handlers;
    const part = (name) => {
        const el = root.querySelector(`[data-hud="${name}"]`);
        if (!el) throw new Error(`HUD markup is missing [data-hud="${name}"]`);
        return el;
    };
    const els = Object.fromEntries(
        ['year', 'month', 'caption', 'play', 'track', 'fill', 'ticks', 'head', 'years', 'preview', 'speed', 'replay', 'exit']
            .map((name) => [name, part(name)]),
    );
    const scrubber = els.track.closest('.scrubber');
    const yearColumns = buildOdometer(els.year, 4);
    const monthSlot = buildRoller(els.month);
    const counters = ['startups', 'investors', 'deals'].map((name) => ({
        name,
        columns: buildOdometer(part(name), Math.max(1, String(totals[name]).length)),
        value: 0,
        target: 0,
    }));

    let captionKey = null;
    let currentCard = null;
    let captionRows = []; // { el, at, shown } for the deal rows of the current card
    let captionBottom = 0; // the caption's CSS bottom offset, px
    let captionArea = { right: 0, top: 0, reservedTop: 0 };
    let yearLabels = [];
    let trackWidth = 0;
    let progress = 0;
    let scrubPointer = null; // id of the pointer dragging the playhead
    let playState = null;
    let ariaNow = null;
    let ariaText = null;

    // ---- date, captions, counters ----------------------------------------------

    function captionAt(t) {
        if (t >= schedule.summaryT) return ['summary', () => summaryCaption(schedule, totals)];
        const index = beatIndexAt(schedule, t);
        if (index < 0) return ['intro', introCaption];
        return [`beat-${index}`, () => captionFor(schedule.beats[index])];
    }

    function showCaption(caption) {
        // Scrubbing can change months faster than cards fade out; keep only the newest exit.
        els.caption.querySelectorAll('.caption__card.is-out').forEach((card) => card.remove());
        const card = document.createElement('div');
        card.className = `caption__card caption__card--${caption.tone}`;
        card.innerHTML = captionHtml(caption);
        els.caption.appendChild(card);
        void getComputedStyle(card).opacity; // commit the start state so the entrance transitions
        card.classList.add('is-in');
        if (currentCard) {
            const previous = currentCard;
            previous.classList.remove('is-in');
            previous.classList.add('is-out');
            window.setTimeout(() => previous.remove(), CARD_EXIT_MS);
        }
        currentCard = card;
        captionRows = [...card.querySelectorAll('[data-at]')].map((el) => ({ el, at: Number(el.dataset.at), shown: false }));
    }

    /**
     * Expands exactly the rows whose deals have fired by time t, so the card grows as
     * the month plays and shrinks again when scrubbing back. Rows revealed together cascade.
     */
    function revealRows(t) {
        let revealed = 0;
        captionRows.forEach((row) => {
            const due = t >= row.at;
            if (due === row.shown) return;
            row.shown = due;
            row.el.style.transitionDelay = due && !isReduced() ? `${revealed * ROW_STAGGER_MS}ms` : '0ms';
            row.el.classList.toggle('is-in', due);
            if (due) revealed += 1;
        });
    }

    function setTime(t) {
        const raw = dateAt(schedule, t);
        const month = isReduced() ? Math.round(raw) : raw;
        setOdometer(yearColumns, rollingYear(month));
        roll(monthSlot, month - Math.floor(month / 12) * 12, MONTH_ROW_EM);
        setProgress(t / schedule.duration, month);
        const [key, build] = captionAt(t);
        if (key !== captionKey) {
            captionKey = key;
            showCaption(build());
        }
        revealRows(t);
    }

    function setCounts(counts) {
        counters.forEach((counter) => {
            counter.target = counts[counter.name];
        });
    }

    /** Eases the counters toward their targets; returns true while any of them still rolls. */
    function tick(dt) {
        const blend = isReduced() ? 1 : 1 - Math.exp(-dt / COUNT_SMOOTHING_MS);
        return counters.map((counter) => {
            if (counter.value === counter.target) return false;
            const next = counter.value + (counter.target - counter.value) * blend;
            counter.value = Math.abs(counter.target - next) < 0.002 ? counter.target : next;
            setOdometer(counter.columns, counter.value);
            return counter.value !== counter.target;
        }).some(Boolean);
    }

    function reset() {
        counters.forEach((counter) => {
            counter.value = 0;
            counter.target = 0;
            setOdometer(counter.columns, 0);
        });
        captionKey = null;
        currentCard = null;
        captionRows = [];
        els.caption.replaceChildren();
    }

    // ---- scrubber ----------------------------------------------------------------

    function buildScrubber() {
        const ticks = [];
        const labels = [];
        schedule.beats.forEach((beat, i) => {
            const fraction = beat.t / schedule.duration;
            const tick = document.createElement('span');
            tick.className = beat.foundings.length ? 'scrubber__tick scrubber__tick--found' : 'scrubber__tick';
            tick.style.left = `${fraction * 100}%`;
            ticks.push(tick);
            const year = yearOf(beat.month);
            if (i > 0 && yearOf(schedule.beats[i - 1].month) === year) return;
            const label = document.createElement('span');
            label.className = 'scrubber__year';
            label.textContent = String(year);
            label.style.left = `${fraction * 100}%`;
            labels.push({ el: label, fraction });
        });
        els.ticks.replaceChildren(...ticks);
        els.years.replaceChildren(...labels.map((label) => label.el));
        yearLabels = labels;
    }

    function renderProgress() {
        els.fill.style.transform = `scaleX(${progress})`;
        els.head.style.transform = `translate3d(${progress * trackWidth}px, 0, 0)`;
    }

    function setProgress(fraction, month) {
        progress = clamp(fraction, 0, 1);
        renderProgress();
        const now = String(Math.round(progress * 100));
        if (now !== ariaNow) {
            ariaNow = now;
            els.track.setAttribute('aria-valuenow', now);
        }
        const text = monthLabel(Math.round(month));
        if (text !== ariaText) {
            ariaText = text;
            els.track.setAttribute('aria-valuetext', text);
        }
    }

    /**
     * The caption's footprint in px: its right edge (from the left), plus the top of the
     * cards it holds and the top of its `--caption-reserve` band (both from the bottom).
     */
    function measureCaptionArea() {
        const style = getComputedStyle(els.caption);
        captionBottom = parseFloat(style.bottom) || 0;
        const reserve = parseFloat(style.getPropertyValue('--caption-reserve')) || 0;
        return {
            right: els.caption.offsetLeft + els.caption.offsetWidth,
            top: captionBottom + els.caption.offsetHeight,
            reservedTop: captionBottom + reserve,
        };
    }

    // Cards differ in height and grow as their deal rows land; tracking the live height
    // lets the camera keep the graph clear of whichever card is showing.
    const captionObserver = new ResizeObserver(([entry]) => {
        captionArea = { ...captionArea, top: captionBottom + entry.contentRect.height };
        onCaptionResize();
    });
    captionObserver.observe(els.caption);

    /** Re-measures the track and caption, and hides year labels that would collide. */
    function layout() {
        captionArea = measureCaptionArea();
        trackWidth = els.track.clientWidth;
        let lastShown = -Infinity;
        yearLabels.forEach(({ el, fraction }) => {
            const x = fraction * trackWidth;
            const fits = x - lastShown >= YEAR_LABEL_GAP_PX;
            el.classList.toggle('is-hidden', !fits);
            if (fits) lastShown = x;
        });
        renderProgress();
    }

    function pointerOffset(event) {
        const rect = els.track.getBoundingClientRect();
        const x = clamp(event.clientX - rect.left, 0, rect.width);
        return { x, t: rect.width ? (x / rect.width) * schedule.duration : 0 };
    }

    function showPreview(x, t) {
        els.preview.textContent = monthLabel(Math.round(dateAt(schedule, t)));
        els.preview.style.transform = `translateX(calc(${x}px - 50%))`;
        els.preview.classList.add('is-visible');
    }

    function endScrub(event) {
        if (event.pointerId !== scrubPointer) return;
        scrubPointer = null;
        scrubber.classList.remove('is-scrubbing');
        els.preview.classList.remove('is-visible');
        onScrubEnd();
    }

    els.track.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || scrubPointer !== null) return; // one pointer scrubs at a time
        els.track.setPointerCapture(event.pointerId);
        scrubPointer = event.pointerId;
        scrubber.classList.add('is-scrubbing');
        onScrubStart();
        onSeek(pointerOffset(event).t);
    });
    els.track.addEventListener('pointermove', (event) => {
        if (!event.isPrimary) return;
        const { x, t } = pointerOffset(event);
        showPreview(x, t);
        if (event.pointerId === scrubPointer) onSeek(t);
    });
    els.track.addEventListener('pointerup', endScrub);
    els.track.addEventListener('pointercancel', endScrub);
    els.track.addEventListener('lostpointercapture', endScrub);
    els.track.addEventListener('pointerleave', () => {
        if (scrubPointer === null) els.preview.classList.remove('is-visible');
    });
    els.track.addEventListener('keydown', (event) => {
        const action = KEY_ACTIONS[event.key];
        if (!action || event.metaKey || event.ctrlKey || event.altKey) return; // leave browser shortcuts alone
        event.preventDefault();
        event.stopPropagation(); // the page-level shortcuts would otherwise step a second time
        onStep(action);
    });
    els.play.addEventListener('click', onToggle);
    els.speed.addEventListener('click', onSpeed);
    els.replay.addEventListener('click', onReplay);
    els.exit.addEventListener('click', onExit);

    // ---- transport state ---------------------------------------------------------

    function setPlayState(state) {
        if (state === playState) return;
        playState = state;
        const { icon, label } = PLAY_STATES[state];
        els.play.innerHTML = `<i class="fas ${icon}" aria-hidden="true"></i>`;
        els.play.setAttribute('aria-label', label);
        root.classList.toggle('is-paused', state !== 'playing');
    }

    function setSpeed(speed) {
        els.speed.textContent = `${speed}×`;
        els.speed.setAttribute('aria-label', `Playback speed ${speed}×`);
    }

    buildScrubber();
    return {
        setTime,
        setCounts,
        tick,
        reset,
        layout,
        setPlayState,
        setSpeed,
        captionArea: () => captionArea,
        hasFocus: () => scrubber.contains(document.activeElement),
    };
}
