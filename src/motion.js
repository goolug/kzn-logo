// kzn-logo — shared motion math. Pure functions, no DOM: both the SVG and
// WebGL renderers move dots through exactly these paths.
//
// Two rules carry over from the mark's concept into motion itself:
//   · the kernel never leaves the crosshair — it orbits it, edge always in
//     contact, along the shorter arc
//   · no dot ever covers the center, even mid-flight — a straight path that
//     would sweep the crosshair bows around it instead

import { R } from './core.js';

export const EASINGS = {
  cubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  quint: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
  linear: (t) => t,
};

/** Orbit path for the kernel: angle lerps along the shorter arc, radius R→R. */
export function kernelPath(a, b) {
  const a0 = Math.atan2(a[1], a[0]);
  let da = Math.atan2(b[1], b[0]) - a0;
  if (da > Math.PI) da -= 2 * Math.PI;
  if (da < -Math.PI) da += 2 * Math.PI;
  const r0 = Math.hypot(a[0], a[1]) || R;
  const r1 = Math.hypot(b[0], b[1]) || R;
  return (t) => {
    const ang = a0 + da * t;
    const rr = r0 + (r1 - r0) * t;
    return [rr * Math.cos(ang), rr * Math.sin(ang)];
  };
}

/** Straight path — bowed around the crosshair when it would sweep it. */
export function dotPath(a, b) {
  const clearance = R + 0.1;
  const near = segNearestToOrigin(a, b);
  const nl = Math.hypot(near[0], near[1]);
  if (nl >= clearance) {
    return (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  // push the control point along the origin→segment shortest vector — that is
  // perpendicular to the travel, so the curve actually swerves sideways
  let dx = near[0];
  let dy = near[1];
  let dl = nl;
  if (dl < 1e-4) {
    dx = -(b[1] - a[1]);
    dy = b[0] - a[0];
    dl = Math.hypot(dx, dy) || 1;
  }
  const push = 2 * clearance + R; // control point far enough to clear center
  const cx = (dx / dl) * push;
  const cy = (dy / dl) * push;
  return (t) => {
    const u = 1 - t;
    return [
      u * u * a[0] + 2 * u * t * cx + t * t * b[0],
      u * u * a[1] + 2 * u * t * cy + t * t * b[1],
    ];
  };
}

function segNearestToOrigin(a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const l2 = abx * abx + aby * aby;
  if (l2 < 1e-12) return [a[0], a[1]];
  let t = -(a[0] * abx + a[1] * aby) / l2;
  t = Math.max(0, Math.min(1, t));
  return [a[0] + t * abx, a[1] + t * aby];
}

/**
 * Build per-dot tweens from current positions to targets (index 0 = kernel).
 * `now` is the caller's clock so renderers stay testable.
 */
export function buildTweens(current, targets, { duration, stagger }, now) {
  return targets.map((to, i) => {
    const from = current[i] ?? to;
    const path = i === 0 ? kernelPath(from, to) : dotPath(from, to);
    return {
      path,
      t0: now + (i === 0 ? 0 : i * stagger),
      dur: duration,
      done: false,
    };
  });
}

/**
 * Sample all tweens at `now`. Returns { pts, live }: positions per dot and
 * whether anything is still in flight. Marks finished tweens done.
 */
export function sampleTweens(anims, now, easing) {
  const ease = EASINGS[easing] || EASINGS.cubic;
  const pts = new Array(anims.length);
  let live = false;
  for (let i = 0; i < anims.length; i++) {
    const a = anims[i];
    let t = (now - a.t0) / a.dur;
    if (t < 1) live = true;
    else {
      t = 1;
      a.done = true;
    }
    pts[i] = a.path(t <= 0 ? 0 : ease(t));
  }
  return { pts, live };
}
