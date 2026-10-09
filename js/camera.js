// A camera that is operated rather than tweened: it chases its target with a
// critically damped spring on centre and log-zoom, so retargeting mid-move never
// jerks. Pure (the DOM is reached only through the injected `apply`), so it is unit-tested.

import { clamp, smoothDamp } from './motion.js';

const SETTLE_PX = 0.35; // screen pixels
const SETTLE_LOG_ZOOM = 1e-3;
const ZOOM_SMOOTH_TIME = 0.32;
const ZERO_VELOCITY = Object.freeze({ cx: 0, cy: 0, logK: 0 });

/** Centre of the area the HUD leaves free (view insets), in screen pixels. */
function safeCentre(view) {
    return {
        x: view.left + (view.width - view.left - view.right) / 2,
        y: view.top + (view.height - view.top - view.bottom) / 2,
    };
}

/** World-space centre and zoom that frame `bounds` ({x0, y0, x1, y1}) inside the view's safe area. */
export function fitView(bounds, view, { kMin = 0.2, kMax = 1.25, pad = 40 } = {}) {
    const safeWidth = Math.max(1, view.width - view.left - view.right - pad * 2);
    const safeHeight = Math.max(1, view.height - view.top - view.bottom - pad * 2);
    const width = Math.max(1, bounds.x1 - bounds.x0);
    const height = Math.max(1, bounds.y1 - bounds.y0);
    return {
        cx: (bounds.x0 + bounds.x1) / 2,
        cy: (bounds.y0 + bounds.y1) / 2,
        k: clamp(Math.min(safeWidth / width, safeHeight / height), kMin, kMax),
    };
}

/** Camera ({cx, cy, k}) → zoom transform ({x, y, k}) that puts (cx, cy) at the safe-area centre. */
export function toTransform(cam, view) {
    const centre = safeCentre(view);
    return { x: centre.x - cam.cx * cam.k, y: centre.y - cam.cy * cam.k, k: cam.k };
}

export function fromTransform(transform, view) {
    const centre = safeCentre(view);
    return { cx: (centre.x - transform.x) / transform.k, cy: (centre.y - transform.y) / transform.k, k: transform.k };
}

/**
 * Modes: 'follow' keeps the live bounds framed, 'target' eases to a fixed shot,
 * 'free' leaves the view to the user (wheel / drag) until follow() is called again.
 * With reduced motion the camera cuts to its shot instead of gliding.
 */
export function createCamera({
    getView, getBounds, apply, fit = {}, smoothTime = 0.55, zoomExtent = [0.15, 4], isReduced = () => false,
}) {
    let mode = 'follow';
    let cam = { cx: 0, cy: 0, k: 1 };
    let velocity = ZERO_VELOCITY;
    let goal = null;
    let activeSmoothTime = smoothTime;
    let applied = null;       // the last transform handed to apply()
    let appliedCentre = null; // the safe-area centre that transform was computed for

    const clampZoom = (k) => clamp(k, zoomExtent[0], zoomExtent[1]);

    // The safe area moves when the insets change (mode switch, resize). Re-deriving the
    // camera from what is on screen keeps the picture still; the spring then glides to the new framing.
    function syncToView() {
        if (!applied) return;
        const view = getView();
        const centre = safeCentre(view);
        if (centre.x === appliedCentre.x && centre.y === appliedCentre.y) return;
        cam = fromTransform(applied, view);
        appliedCentre = centre;
    }

    function currentGoal() {
        if (mode === 'target') return goal;
        if (mode !== 'follow') return null;
        const bounds = getBounds();
        if (!bounds) return null;
        const framed = fitView(bounds, getView(), fit);
        return { ...framed, k: clampZoom(framed.k) };
    }

    function commit() {
        const view = getView();
        const transform = toTransform(cam, view);
        appliedCentre = safeCentre(view);
        if (applied && applied.x === transform.x && applied.y === transform.y && applied.k === transform.k) return;
        applied = transform;
        apply(transform);
    }

    const api = {
        get mode() { return mode; },
        get current() { return { ...cam }; },
        follow({ smoothTime: time = smoothTime } = {}) {
            mode = 'follow';
            activeSmoothTime = time;
        },
        easeTo(next, { smoothTime: time = smoothTime } = {}) {
            mode = 'target';
            goal = { cx: next.cx, cy: next.cy, k: clampZoom(next.k) };
            activeSmoothTime = time;
        },
        zoomBy(factor) {
            syncToView();
            const base = mode === 'target' && goal ? goal : cam;
            api.easeTo({ ...base, k: base.k * factor }, { smoothTime: ZOOM_SMOOTH_TIME });
        },
        /** The user moved the view: adopt their transform and stop steering. */
        release(transform) {
            const view = getView();
            mode = 'free';
            cam = fromTransform(transform, view);
            applied = { x: transform.x, y: transform.y, k: transform.k };
            appliedCentre = safeCentre(view);
            velocity = ZERO_VELOCITY;
        },
        jumpTo(next) {
            cam = { cx: next.cx, cy: next.cy, k: clampZoom(next.k) };
            velocity = ZERO_VELOCITY;
            commit();
        },
        /** Advances the spring by dt seconds; returns true while the camera is still moving. */
        step(dt) {
            syncToView();
            const target = currentGoal();
            if (!target) return false;
            if (isReduced()) {
                cam = { ...target };
                velocity = ZERO_VELOCITY;
                commit();
                return false;
            }
            const [cx, vx] = smoothDamp(cam.cx, target.cx, velocity.cx, activeSmoothTime, dt);
            const [cy, vy] = smoothDamp(cam.cy, target.cy, velocity.cy, activeSmoothTime, dt);
            const [logK, vk] = smoothDamp(Math.log(cam.k), Math.log(target.k), velocity.logK, activeSmoothTime, dt);
            const k = Math.exp(logK);
            const settled = Math.abs(target.cx - cx) * k < SETTLE_PX
                && Math.abs(target.cy - cy) * k < SETTLE_PX
                && Math.abs(Math.log(target.k) - logK) < SETTLE_LOG_ZOOM;
            cam = settled ? { ...target } : { cx, cy, k };
            velocity = settled ? ZERO_VELOCITY : { cx: vx, cy: vy, logK: vk };
            commit();
            return !settled;
        },
    };
    return api;
}
