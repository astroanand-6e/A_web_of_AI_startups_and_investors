import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clamp, easeCubicInOut, smoothDamp } from '../js/motion.js';

const FRAME = 1 / 60;

/** Runs smoothDamp at 60 fps; `targetAt` maps elapsed seconds to the target. */
function simulate(start, targetAt, smoothTime, seconds) {
    let value = start;
    let velocity = 0;
    const values = [];
    for (let elapsed = FRAME; elapsed <= seconds + 1e-9; elapsed += FRAME) {
        [value, velocity] = smoothDamp(value, targetAt(elapsed), velocity, smoothTime, FRAME);
        values.push(value);
    }
    return { value, velocity, values };
}

test('clamp limits a value to a range', () => {
    assert.equal(clamp(5, 0, 1), 1);
    assert.equal(clamp(-1, 0, 1), 0);
    assert.equal(clamp(0.5, 0, 1), 0.5);
});

test('easeCubicInOut is pinned at the ends and symmetric', () => {
    assert.equal(easeCubicInOut(0), 0);
    assert.equal(easeCubicInOut(0.5), 0.5);
    assert.equal(easeCubicInOut(1), 1);
    assert.ok(Math.abs(easeCubicInOut(0.25) + easeCubicInOut(0.75) - 1) < 1e-12);
    assert.ok(easeCubicInOut(0.1) < 0.1, 'starts slow');
});

test('smoothDamp glides onto a resting target without overshooting', () => {
    const { value, values } = simulate(0, () => 100, 0.3, 3);
    assert.ok(Math.abs(value - 100) < 1e-3, `ended at ${value}`);
    values.forEach((v, i) => {
        assert.ok(v <= 100, `overshot to ${v}`);
        if (i > 0) assert.ok(v >= values[i - 1], 'moved backwards');
    });
});

test('smoothDamp approaches from above just as cleanly', () => {
    const { value, values } = simulate(100, () => 0, 0.5, 4);
    assert.ok(Math.abs(value) < 1e-3);
    assert.ok(values.every((v) => v >= 0));
});

test('smoothDamp keeps pace with a moving target', () => {
    const speed = 50; // units per second
    const smoothTime = 0.3;
    const { value, velocity } = simulate(0, (elapsed) => elapsed * speed, smoothTime, 3);
    const lag = 3 * speed - value;
    // A critically damped spring trails a constant-speed target by speed × smoothTime.
    assert.ok(Math.abs(lag - speed * smoothTime) < 1.5, `lag ${lag}`);
    assert.ok(Math.abs(velocity - speed) < 1, `velocity ${velocity}`);
});

test('smoothDamp with dt = 0 changes nothing', () => {
    assert.deepEqual(smoothDamp(3, 10, 2, 0.5, 0), [3, 2]);
});
