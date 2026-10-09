import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCamera, fitView, fromTransform, toTransform } from '../js/camera.js';

const VIEW = Object.freeze({ width: 1000, height: 600, top: 80, right: 20, bottom: 80, left: 20 });
const BOUNDS = Object.freeze({ x0: -100, y0: -50, x1: 140, y1: 70 });
const FIT = Object.freeze({ kMax: 10, pad: 40 });

function rig({ bounds = BOUNDS } = {}) {
    const applied = [];
    const camera = createCamera({
        getView: () => VIEW,
        getBounds: () => bounds,
        apply: (transform) => applied.push(transform),
        fit: FIT,
    });
    return { camera, applied };
}

/** Steps at 60 fps until the camera settles; returns the number of frames it took. */
function settle(camera, maxFrames = 1200) {
    for (let frame = 1; frame <= maxFrames; frame += 1) {
        if (!camera.step(1 / 60)) return frame;
    }
    assert.fail(`camera still moving after ${maxFrames} frames`);
}

test('fitView centres the bounds and fits them inside the safe area', () => {
    // Safe area: 1000 - 20 - 20 - 2 * 40 = 880 wide, 600 - 80 - 80 - 2 * 40 = 360 tall.
    const fit = fitView({ x0: -100, y0: -50, x1: 100, y1: 50 }, VIEW, { kMax: 10, pad: 40 });
    assert.deepEqual(fit, { cx: 0, cy: 0, k: 3.6 });
});

test('fitView clamps the zoom', () => {
    assert.equal(fitView({ x0: 0, y0: 0, x1: 100_000, y1: 100_000 }, VIEW).k, 0.2);
    assert.equal(fitView({ x0: 0, y0: 0, x1: 1, y1: 1 }, VIEW).k, 1.25);
});

test('toTransform puts the camera centre in the middle of the safe area; fromTransform inverts it', () => {
    const cam = { cx: 10, cy: -20, k: 2 };
    const transform = toTransform(cam, VIEW);
    // Safe-area centre: x = 20 + 960 / 2 = 500, y = 80 + 440 / 2 = 300.
    assert.equal(transform.x + cam.cx * cam.k, 500);
    assert.equal(transform.y + cam.cy * cam.k, 300);
    assert.deepEqual(fromTransform(transform, VIEW), cam);
});

test('the camera glides onto the framing and stops exactly on it', () => {
    const { camera, applied } = rig();
    assert.ok(settle(camera) > 10, 'should glide, not jump');
    const goal = fitView(BOUNDS, VIEW, FIT);
    assert.deepEqual(camera.current, goal);
    assert.deepEqual(applied[applied.length - 1], toTransform(goal, VIEW));

    const writes = applied.length;
    assert.equal(camera.step(1 / 60), false);
    assert.equal(applied.length, writes, 'a settled camera stops writing the transform');
});

test('a change of safe area never moves the picture; the camera glides to the new framing', () => {
    let view = VIEW;
    const applied = [];
    const camera = createCamera({ getView: () => view, getBounds: () => BOUNDS, apply: (t) => applied.push(t), fit: FIT });
    settle(camera);
    const before = applied[applied.length - 1];

    view = { ...VIEW, left: 300 }; // the safe-area centre moves 140 px to the right
    assert.equal(camera.step(1 / 60), true);
    const after = applied[applied.length - 1];
    assert.ok(Math.abs(after.x - before.x) < 5, `the picture jumped ${after.x - before.x} px`);

    settle(camera);
    assert.deepEqual(camera.current, fitView(BOUNDS, view, FIT));
});

test('with reduced motion the camera cuts straight to its shot instead of gliding', () => {
    const applied = [];
    const camera = createCamera({
        getView: () => VIEW, getBounds: () => BOUNDS, apply: (t) => applied.push(t), fit: FIT, isReduced: () => true,
    });
    assert.equal(camera.step(1 / 60), false);
    assert.deepEqual(camera.current, fitView(BOUNDS, VIEW, FIT));
    assert.equal(applied.length, 1);

    const k = camera.current.k;
    camera.zoomBy(1.2);
    assert.equal(camera.step(1 / 60), false);
    assert.equal(camera.current.k, k * 1.2);
});

test('a user gesture releases the camera until follow() is called', () => {
    const { camera } = rig();
    const transform = { x: 10, y: 20, k: 1.5 };
    camera.release(transform);
    assert.equal(camera.mode, 'free');
    assert.deepEqual(camera.current, fromTransform(transform, VIEW));
    assert.equal(camera.step(1 / 60), false);
    assert.deepEqual(camera.current, fromTransform(transform, VIEW));

    camera.follow();
    assert.equal(camera.mode, 'follow');
    assert.equal(camera.step(1 / 60), true);
    settle(camera);
    assert.deepEqual(camera.current, fitView(BOUNDS, VIEW, FIT));
});

test('zoomBy eases toward a zoom inside the zoom extent', () => {
    const { camera } = rig();
    camera.jumpTo({ cx: 0, cy: 0, k: 1 });
    camera.zoomBy(2);
    assert.equal(camera.mode, 'target');
    settle(camera);
    assert.equal(camera.current.k, 2);

    camera.zoomBy(100);
    settle(camera);
    assert.equal(camera.current.k, 4);

    camera.zoomBy(1e-6);
    settle(camera);
    assert.equal(camera.current.k, 0.15);
});

test('jumpTo applies the shot immediately, clamped to the zoom extent', () => {
    const { camera, applied } = rig();
    camera.jumpTo({ cx: 5, cy: 5, k: 10 });
    assert.deepEqual(camera.current, { cx: 5, cy: 5, k: 4 });
    assert.deepEqual(applied[applied.length - 1], toTransform({ cx: 5, cy: 5, k: 4 }, VIEW));
});

test('with nothing to frame, the camera holds still', () => {
    const { camera, applied } = rig({ bounds: null });
    assert.equal(camera.step(1 / 60), false);
    assert.equal(applied.length, 0);
});
