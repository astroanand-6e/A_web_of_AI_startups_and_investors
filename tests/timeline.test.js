import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer } from '../js/timeline.js';

test('the playhead advances only while playing', () => {
    const player = createPlayer({ duration: 1000 });
    assert.equal(player.advance(100), false);
    assert.equal(player.time, 0);

    player.play();
    assert.equal(player.advance(100), true);
    assert.equal(player.time, 100);

    player.pause();
    assert.equal(player.advance(100), false);
    assert.equal(player.time, 100);
});

test('playback speed scales elapsed time', () => {
    const player = createPlayer({ duration: 1000 });
    player.setSpeed(2);
    player.play();
    player.advance(100);
    assert.equal(player.time, 200);
    player.setSpeed(0.5);
    player.advance(100);
    assert.equal(player.time, 250);
});

test('the playhead stops at the end and stays stopped', () => {
    const player = createPlayer({ duration: 1000 });
    player.play();
    assert.equal(player.advance(1500), true);
    assert.equal(player.time, 1000);
    assert.equal(player.playing, false);
    assert.equal(player.ended, true);

    player.play();
    assert.equal(player.playing, false, 'play() at the end does nothing');
});

test('seek clamps into the timeline', () => {
    const player = createPlayer({ duration: 1000 });
    player.seek(-5);
    assert.equal(player.time, 0);
    player.seek(5000);
    assert.equal(player.time, 1000);
    assert.equal(player.ended, true);
    player.seek(400);
    assert.equal(player.time, 400);
    assert.equal(player.ended, false);
});

test('invalid durations and speeds are rejected', () => {
    assert.throws(() => createPlayer({ duration: 0 }), RangeError);
    assert.throws(() => createPlayer({}), RangeError);
    const player = createPlayer({ duration: 1000 });
    for (const bad of [0, -1, Number.NaN]) {
        assert.throws(() => player.setSpeed(bad), RangeError);
    }
    assert.equal(player.speed, 1);
});
