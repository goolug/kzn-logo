// Motion-path invariants: the concept's rules hold even mid-flight.
import test from 'node:test';
import assert from 'node:assert/strict';
import { R } from '../src/core.js';
import {
  EASINGS,
  kernelPath,
  dotPath,
  buildTweens,
  sampleTweens,
} from '../src/motion.js';

const len = (p) => Math.hypot(p[0], p[1]);
const onR = (a) => [R * Math.cos(a), R * Math.sin(a)];

test('easings are anchored at 0 and 1', () => {
  for (const fn of Object.values(EASINGS)) {
    assert.ok(Math.abs(fn(0)) < 1e-12);
    assert.ok(Math.abs(fn(1) - 1) < 1e-12);
  }
});

test('kernel orbits: edge stays in contact with the crosshair throughout', () => {
  for (const [a0, a1] of [
    [0.2, 2.9],
    [-3.0, 3.0],
    [1.5, 1.6],
    [0, Math.PI],
  ]) {
    const path = kernelPath(onR(a0), onR(a1));
    for (let t = 0; t <= 1.0001; t += 0.05)
      assert.ok(Math.abs(len(path(Math.min(t, 1))) - R) < 1e-9);
  }
});

test('kernel takes the shorter arc', () => {
  const path = kernelPath(onR(0.1), onR(2 * Math.PI - 0.1));
  // shorter way from +0.1 to -0.1 passes through angle 0, not π
  const mid = path(0.5);
  assert.ok(mid[0] > 0, 'went the long way around');
});

test('no dot covers the center mid-flight: crossing paths bow around it', () => {
  const cases = [
    [[-1.2, 0.001], [1.3, -0.002]],
    [[0.001, -1.5], [-0.002, 1.1]],
    [[-1, -1], [1, 1]],
  ];
  for (const [a, b] of cases) {
    const path = dotPath(a, b);
    let min = Infinity;
    for (let t = 0; t <= 1.0001; t += 0.01)
      min = Math.min(min, len(path(Math.min(t, 1))));
    assert.ok(min > R + 0.02, `path dips to ${min} — covers the crosshair`);
  }
});

test('clear paths stay straight', () => {
  const a = [-1, -1];
  const b = [1, -1]; // passes 1 cell above center — no bowing needed
  const path = dotPath(a, b);
  const mid = path(0.5);
  assert.ok(Math.abs(mid[0]) < 1e-9 && Math.abs(mid[1] + 1) < 1e-9);
});

test('tweens: hold at start before stagger, land exactly, report done', () => {
  const current = [onR(0), [1, 1], [-1, 1]];
  const targets = [onR(1), [1, -1], [-1, 0.3875]];
  const anims = buildTweens(current, targets, { duration: 100, stagger: 20 }, 1000);
  // before its own start, a staggered dot sits at its origin
  let s = sampleTweens(anims, 1010, 'cubic');
  assert.ok(s.live);
  assert.deepEqual(s.pts[2], current[2]);
  // long after the end, everything is exactly on target and not live
  s = sampleTweens(anims, 5000, 'cubic');
  assert.ok(!s.live);
  for (let i = 0; i < targets.length; i++) {
    assert.ok(Math.hypot(s.pts[i][0] - targets[i][0], s.pts[i][1] - targets[i][1]) < 1e-9);
    assert.ok(anims[i].done);
  }
});
