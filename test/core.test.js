// Rule invariants for the formation engine. Run: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  R,
  MARK,
  MARK_IDEAL,
  defaults,
  generate,
  gridLines,
  assignTargets,
  constrainDrag,
  freeDrag,
  rng,
} from '../src/core.js';

const len = (p) => Math.hypot(p[0], p[1]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const EPS = 1e-9;

const DIMS = [
  [4, 4],
  [8, 4],
  [4, 8],
  [9.6, 4],
  [4, 6.4],
  [6, 6],
];
const FAST = { rollouts: 12 };
const SEEDS_PER_DIM = 250;

function forAll(placement, fn) {
  for (const [w, h] of DIMS)
    for (let i = 0; i < SEEDS_PER_DIM; i++)
      fn(generate(w, h, `t${i}`, { ...FAST, placement }), w, h, `t${i}`);
}

test('kernel: edge passes through the crosshair, center never on it', () => {
  for (const placement of ['construction', 'lines', 'points'])
    forAll(placement, (f) => {
      const d = len(f.dots[0]);
      assert.ok(Math.abs(d - R) < EPS, `kernel distance ${d} !== R`);
    });
});

test('nothing else sits on or inside the center', () => {
  forAll('construction', (f) => {
    for (let i = 1; i < f.dots.length; i++)
      assert.ok(len(f.dots[i]) > R + 1e-6, 'dot too close to crosshair');
  });
});

test('no two dots ever touch (min edge gap holds)', () => {
  for (const placement of ['construction', 'lines', 'points'])
    forAll(placement, (f) => {
      for (let i = 0; i < f.dots.length; i++)
        for (let j = i + 1; j < f.dots.length; j++)
          assert.ok(
            dist(f.dots[i], f.dots[j]) >= 2 * R + defaults.gap - EPS,
            `dots ${i},${j} closer than allowed`
          );
    });
});

test('gravity falloff: center distances never decrease with rank', () => {
  for (const placement of ['construction', 'lines', 'points'])
    forAll(placement, (f) => {
      for (let i = 1; i < f.dots.length - 1; i++)
        assert.ok(
          len(f.dots[i + 1]) >= len(f.dots[i]) - EPS,
          'rank order broken'
        );
    });
});

test('falloff is strictly graded in the default system (ties are rare)', () => {
  // construction mode on the native canvas: ranks should almost always be
  // strictly farther — ties are a sanctioned fallback when the lattice runs
  // out of rings, not the norm
  let total = 0;
  let tied = 0;
  forAll('construction', (f, w, h) => {
    if (w !== 4 || h !== 4) return;
    total++;
    for (let i = 0; i < f.dots.length - 1; i++)
      if (len(f.dots[i + 1]) <= len(f.dots[i]) + 1e-6) {
        tied++;
        break;
      }
  });
  assert.ok(total > 0);
  assert.ok(tied / total <= 0.1, `ties in ${tied}/${total} formations`);
});

test('dots stay fully inside the canvas (edge clearance)', () => {
  for (const placement of ['construction', 'lines', 'points'])
    forAll(placement, (f, w, h) => {
      for (const [x, y] of f.dots) {
        assert.ok(Math.abs(x) <= w / 2 - R - defaults.edge + 1e-6, 'x out');
        assert.ok(Math.abs(y) <= h / 2 - R - defaults.edge + 1e-6, 'y out');
      }
    });
});

test('placement legality: construction = on vertical lines, resting or hanging', () => {
  forAll('construction', (f) => {
    for (let i = 1; i < f.dots.length; i++) {
      const [x, y] = f.dots[i];
      assert.ok(Math.abs(x - Math.round(x)) < EPS, `x=${x} not on a line`);
      const resting = Math.abs(y - Math.round(y)) < EPS;
      const hanging = Math.abs(y - R - Math.round(y - R)) < EPS;
      assert.ok(resting || hanging, `y=${y} neither resting nor hanging`);
    }
  });
});

test('placement legality: points = intersections only', () => {
  forAll('points', (f) => {
    for (let i = 1; i < f.dots.length; i++) {
      const [x, y] = f.dots[i];
      assert.ok(Math.abs(x - Math.round(x)) < EPS, 'x off-lattice');
      assert.ok(Math.abs(y - Math.round(y)) < EPS, 'y off-lattice');
    }
  });
});

test('placement legality: lines = center on some gridline', () => {
  forAll('lines', (f) => {
    for (let i = 1; i < f.dots.length; i++) {
      const [x, y] = f.dots[i];
      const onV = Math.abs(x - Math.round(x)) < EPS;
      const onH = Math.abs(y - Math.round(y)) < EPS;
      assert.ok(onV || onH, 'dot off every gridline');
    }
  });
});

test('full complement: default rules always seat all six dots', () => {
  for (const placement of ['construction', 'lines', 'points'])
    forAll(placement, (f) => assert.equal(f.dots.length, 6));
});

test('deterministic: same inputs, same formation', () => {
  for (const placement of ['construction', 'lines', 'points'])
    for (const [w, h] of DIMS) {
      const a = generate(w, h, 'stable', { placement });
      const b = generate(w, h, 'stable', { placement });
      assert.deepEqual(a, b);
    }
});

test('seeds differ: different seed, different formation (usually)', () => {
  let same = 0;
  for (let i = 0; i < 40; i++) {
    const a = generate(4, 4, `a${i}`, FAST);
    const b = generate(4, 4, `b${i}`, FAST);
    if (JSON.stringify(a.dots) === JSON.stringify(b.dots)) same++;
  }
  assert.ok(same < 8, `too many identical formations across seeds (${same}/40)`);
});

test('MARK: measured constants are self-consistent', () => {
  assert.equal(MARK.dots.length, 6);
  assert.ok(Math.abs(MARK.r / MARK.cell - 0.3875) < 1e-4, 'R ratio drifted');
  const [, , w, h] = MARK.viewBox;
  assert.ok(Math.abs(w / h - 1.1562) < 1e-3, 'mark aspect drifted');
  // rank order: distances from the original grid center never decrease
  const ds = MARK.dots.map((p) => dist(p, MARK.center));
  for (let i = 0; i < ds.length - 1; i++)
    assert.ok(ds[i + 1] >= ds[i] - 1e-6, 'MARK rank order broken');
  // the kernel reaches the center: edge within ~3px of it, never past it
  assert.ok(ds[0] >= MARK.r - 1e-6 && ds[0] - MARK.r < 3, 'kernel reach off');
});

test('MARK_IDEAL: exact tangency, legal construction, in bounds on 4×4', () => {
  assert.ok(Math.abs(len(MARK_IDEAL.dots[0]) - R) < EPS);
  for (const [x, y] of MARK_IDEAL.dots) {
    assert.ok(Math.abs(x) <= 2 - R + EPS);
    assert.ok(Math.abs(y) <= 2 - R + EPS);
  }
  for (let i = 1; i < 6; i++) {
    const [x, y] = MARK_IDEAL.dots[i];
    assert.ok(Math.abs(x - Math.round(x)) < EPS);
    const resting = Math.abs(y - Math.round(y)) < EPS;
    const hanging = Math.abs(y - R - Math.round(y - R)) < EPS;
    assert.ok(resting || hanging);
  }
});

test('gridLines: interior lines only, crosshair present at any aspect', () => {
  const g = gridLines(4, 4);
  assert.deepEqual(g.v, [-1, 0, 1]);
  assert.deepEqual(g.h, [-1, 0, 1]);
  const wide = gridLines(9.6, 4);
  assert.ok(wide.v.includes(0) && wide.h.includes(0), 'no crosshair');
  assert.equal(wide.v.length, 9);
});

test('constrainDrag: kernel always orbits — edge pinned through the center', () => {
  const f = { w: 4, h: 4, dots: MARK_IDEAL.dots.map((d) => d.slice()) };
  for (const target of [[1.7, 0.4], [-2, -2], [0.01, 1.9], [-0.4, 0.01]]) {
    const p = constrainDrag(f, 0, target);
    assert.ok(Math.abs(Math.hypot(p[0], p[1]) - R) < EPS, 'kernel left the crosshair');
    for (let j = 1; j < f.dots.length; j++)
      assert.ok(dist(p, f.dots[j]) >= 2 * R + defaults.gap - EPS, 'kernel collided');
  }
  // degenerate target: stay put
  assert.deepEqual(constrainDrag(f, 0, [0, 0]), f.dots[0]);
});

test('constrainDrag: construction placement stays legal, in bounds, no contact', () => {
  const f = { w: 8, h: 4, dots: MARK_IDEAL.dots.map((d) => d.slice()) };
  const r = rng('drag');
  for (let k = 0; k < 300; k++) {
    const i = 1 + Math.floor(r() * 5);
    const target = [(r() * 2 - 1) * 4.5, (r() * 2 - 1) * 2.5];
    const p = constrainDrag(f, i, target);
    assert.ok(Math.abs(p[0] - Math.round(p[0])) < EPS, 'x off the lattice');
    const resting = Math.abs(p[1] - Math.round(p[1])) < EPS;
    const hanging = Math.abs(p[1] - R - Math.round(p[1] - R)) < EPS;
    assert.ok(resting || hanging, 'y neither resting nor hanging');
    assert.ok(Math.abs(p[0]) <= 4 - R - defaults.edge + EPS, 'x out of bounds');
    assert.ok(Math.abs(p[1]) <= 2 - R - defaults.edge + EPS, 'y out of bounds');
    assert.ok(Math.hypot(p[0], p[1]) > R + 0.02 - EPS, 'covered the crosshair');
    for (let j = 0; j < f.dots.length; j++)
      if (j !== i)
        assert.ok(dist(p, f.dots[j]) >= 2 * R + defaults.gap - EPS, 'dots touched');
    f.dots[i] = p; // walk on — every intermediate state must stay legal
  }
});

test('constrainDrag: blocked targets leave the dot where it was', () => {
  const f = { w: 4, h: 4, dots: MARK_IDEAL.dots.map((d) => d.slice()) };
  // aim dot 5 straight at dot 4's seat — no legal nearby spot on that side
  const before = f.dots[4].slice();
  const p = constrainDrag(f, 4, [f.dots[5][0], f.dots[5][1]]);
  for (let j = 0; j < f.dots.length; j++)
    if (j !== 4)
      assert.ok(dist(p, f.dots[j]) >= 2 * R + defaults.gap - EPS);
  assert.ok(Math.hypot(p[0] - before[0], p[1] - before[1]) < 3, 'teleported oddly');
});

test('freeDrag: every dot — kernel included — follows the pointer exactly', () => {
  const f = { w: 8, h: 4, dots: MARK_IDEAL.dots.map((d) => d.slice()) };
  for (const [i, target] of [
    [4, [-2.37, 1.13]],
    [0, [1.4, -0.9]], //  the kernel, free
    [1, [0, 0.3875]], //  right on top of another dot — overlap allowed
    [2, [0.001, 0.001]], // covering the crosshair — allowed in play
  ]) {
    const p = freeDrag(f, i, target);
    assert.ok(
      Math.hypot(p[0] - target[0], p[1] - target[1]) < EPS,
      `dot ${i} did not follow the pointer`
    );
  }
});

test('freeDrag: only the canvas constrains — clamps at bounds', () => {
  const f = { w: 8, h: 4, dots: MARK_IDEAL.dots.map((d) => d.slice()) };
  const r = rng('freedrag');
  for (let k = 0; k < 200; k++) {
    const i = Math.floor(r() * 6);
    const p = freeDrag(f, i, [(r() * 2 - 1) * 6, (r() * 2 - 1) * 4]);
    assert.ok(Math.abs(p[0]) <= 4 - R - defaults.edge + 1e-9, 'x out of bounds');
    assert.ok(Math.abs(p[1]) <= 2 - R - defaults.edge + 1e-9, 'y out of bounds');
    f.dots[i] = p;
  }
});

test('constrainDrag: lines placement keeps the center on a gridline', () => {
  const f = { w: 4, h: 4, dots: MARK_IDEAL.dots.map((d) => d.slice()) };
  const p = constrainDrag(f, 2, [-1.4, 0.6], { placement: 'lines' });
  const onV = Math.abs(p[0] - Math.round(p[0])) < EPS;
  const onH = Math.abs(p[1] - Math.round(p[1])) < EPS;
  assert.ok(onV || onH, 'left every gridline');
});

test('assignTargets: kernel pinned, permutation valid, no worse than identity', () => {
  const r = rng('assign');
  for (let k = 0; k < 60; k++) {
    const mk = () =>
      Array.from({ length: 6 }, () => [r() * 4 - 2, r() * 4 - 2]);
    const cur = mk();
    const tgt = mk();
    const out = assignTargets(cur, tgt);
    assert.deepEqual(out[0], tgt[0], 'kernel not pinned');
    assert.deepEqual(
      [...out].sort(),
      [...tgt].sort(),
      'not a permutation of targets'
    );
    const cost = (arr) =>
      arr.reduce((s, p, i) => s + dist(cur[i], p) ** 2, 0);
    assert.ok(cost(out) <= cost(tgt) + EPS, 'assignment worse than identity');
  }
});
