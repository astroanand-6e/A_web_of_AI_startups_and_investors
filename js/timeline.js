// Playback clock for the timeline. It owns no animation frame of its own: the app's
// single frame loop calls advance(), so the graph, camera and HUD all read one time.

import { clamp } from './motion.js';

export function createPlayer({ duration }) {
    if (!(duration > 0)) throw new RangeError(`Timeline duration must be positive (got ${duration})`);
    let time = 0;
    let playing = false;
    let speed = 1;

    return {
        get time() { return time; },
        get playing() { return playing; },
        get speed() { return speed; },
        get ended() { return time >= duration; },
        get duration() { return duration; },
        play() {
            if (time < duration) playing = true;
        },
        pause() {
            playing = false;
        },
        seek(t) {
            time = clamp(t, 0, duration);
        },
        setSpeed(value) {
            if (!(value > 0)) throw new RangeError(`Playback speed must be positive (got ${value})`);
            speed = value;
        },
        /** Moves the clock by `ms` of wall time scaled by speed; returns false while paused. */
        advance(ms) {
            if (!playing) return false;
            time = Math.min(duration, time + ms * speed);
            if (time >= duration) playing = false;
            return true;
        },
    };
}
