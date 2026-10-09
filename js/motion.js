// Motion primitives shared by every animated part of the visualization.
// Pure module (no DOM access at import time), so Node's test runner can load it.

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function easeCubicInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Base durations in ms at 1x speed. Timeline effects scale them with playback speed. */
export const DUR = Object.freeze({
    startupPop: 720,
    investorPop: 520,
    exit: 320,
    quick: 260,
    fade: 220,
    linkDelay: 140,      // the investor pops first, then its link draws out of it
    linkGrow: 680,
    comet: 620,
    bump: 480,
    shockwave: 1150,
    ripple: 720,
    revealSpread: 950,   // the intro reveal ripples from the centre outward over this long
    collapseSpread: 380, // the pre-timeline collapse implodes from the rim inward
});

/**
 * Critically damped spring toward `target` (the SmoothDamp used by game cameras).
 * Times are in seconds. It never overshoots a resting target and stays smooth while
 * the target keeps moving, which is what makes the camera feel operated, not tweened.
 * @returns {[number, number]} the next value and the next velocity
 */
export function smoothDamp(current, target, velocity, smoothTime, dt) {
    const omega = 2 / Math.max(1e-4, smoothTime);
    const x = omega * dt;
    const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = current - target;
    const temp = (velocity + omega * change) * dt;
    const next = target + (change + temp) * decay;
    const overshot = dt > 0 && (target - current > 0) === (next > target);
    return overshot ? [target, 0] : [next, (velocity - omega * temp) * decay];
}
