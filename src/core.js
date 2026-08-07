// kzn-logo — core geometry engine. No DOM, no dependencies.
//
// Everything below is measured from the master mark in Figma
// (file "KZN Web", node 170-3040 "Logogrid"): six equal circles composed on a
// 4×4 grid of square cells.
//
// Coordinate system for generated formations:
//   · the grid CELL is the unit of length
//   · the ORIGIN is the grid center — the crosshair the mark orbits
//   · x grows right, y grows down (SVG sense)
//   · gridlines sit at integer offsets from the origin, so a true central
//     crosshair exists at any canvas size or aspect ratio
//
// The construction system, as measured from the static mark:
//   · dot radius R = 0.3875 cells — dot diameter is 0.775 of a cell, exactly.
//     Scale of dot vs. cell is what dictates closeness; it is a constant.
//   · the KERNEL dot's edge passes through the crosshair ("touches the center
//     with its side, from any angle") — its center never sits on it
//   · every other dot sits ON the grid: center on a vertical gridline, and
//     vertically either resting centered on a horizontal gridline, or hanging
//     with its top edge kissing one (the static mark uses both)
//   · no two dots ever touch
//   · distance-to-center grows strictly rank by rank — the gravity falloff
//
// The static mark itself is the sanctioned exception: it carries ~1–2px of
// hand-tuned optical slack over this skeleton (and two rank ties). It is
// therefore stored verbatim, not generated.

/** Dot radius in cell units (31/80 — measured 42.9058px on a 110.7246px cell). */
export const R = 0.3875;

/**
 * The canonical static mark ("stable symbol"), exact Figma coordinates in px,
 * cropped to the tight bounding box of the six dots (this crop is the "Logo"
 * component used across the site — aspect ≈ 1.156:1).
 * Dots are in rank order: kernel (closest to center) first.
 */
export const MARK = {
  viewBox: [0, 0, 307.2609, 265.7392],
  r: 42.9058,
  cell: 110.7246,
  /** grid-center of the original Logogrid frame, in this crop's coordinates */
  center: [152.2464, 111.2826],
  dots: [
    [153.6304, 156.3986], // kernel — reaching up to the crosshair
    [153.6304, 42.9058],
    [42.9058, 42.9058],
    [264.3551, 42.9058],
    [42.9058, 222.8334],
    [264.3551, 222.8334],
  ],
};

/**
 * The same mark reduced to its rational skeleton, in grid units (center
 * origin): optical slack removed, tangency exact. Used as the resting/initial
 * state of the dynamic logo so the first shuffle departs from the mark itself.
 */
export const MARK_IDEAL = {
  w: 4,
  h: 4,
  r: R,
  dots: [
    [0, R], //          kernel: hangs from the crosshair, edge through center
    [0, -1 + R], //     hangs under the upper gridline, center column
    [-1, -1 + R], //    hangs under the upper gridline, left column
    [1, -1 + R], //     hangs under the upper gridline, right column
    [-1, 1], //         rests on the lower gridline, left column
    [1, 1], //          rests on the lower gridline, right column
  ],
};

/** String/number seed → uint32 (xmur3 finalizer). */
export function hashSeed(seed) {
  const s = String(seed);
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** Deterministic PRNG (mulberry32). Same seed → same formation, everywhere. */
export function rng(seed) {
  let a = hashSeed(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Tunable rules. These four knobs are deliberately exposed — they encode the
 * open design decisions; nothing is baked in. Defaults follow the measured mark.
 */
export const defaults = {
  /**
   * How strictly dots sit on the grid:
   *  'construction' — the measured system: centers on vertical gridlines,
   *                   resting on or hanging under horizontal ones (discrete)
   *  'lines'        — centers may slide anywhere along any gridline
   *  'points'       — centers on the grid intersections only (most staccato)
   * The kernel is always the one continuous element: tangent to the
   * crosshair at a free angle.
   */
  placement: 'construction',
  /** Minimum edge-to-edge clearance between dots, in cells ("never touch"). */
  gap: 0.15,
  /** How far toward the canvas reach the outermost rank may sit (0..1). */
  spread: 0.85,
  /** Minimum clearance between a dot's edge and the canvas edge, in cells. */
  edge: 0.05,
  /** Minimum growth of center-distance from one rank to the next, in cells. */
  rankStep: 0.07,
  /** Dot count, kernel included. 6 is the mark; others are decorative modes. */
  count: 6,
  /** Candidate formations scored per generate() call (quality vs. cost). */
  rollouts: 48,
  /**
   * Positions to steer away from — normally the previous formation's dots,
   * so consecutive shuffles genuinely relocate instead of a far dot keeping
   * its corner seat forever. Soft penalty, not a ban.
   */
  avoid: null,
};

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const len = (p) => Math.hypot(p[0], p[1]);

/** Legal center positions for non-kernel dots under the placement rule. */
function candidatePositions(limX, limY, placement, rnd) {
  const out = [];
  const vLines = [];
  const hLines = [];
  for (let i = Math.ceil(-limX); i <= Math.floor(limX); i++) vLines.push(i);
  for (let j = Math.ceil(-limY); j <= Math.floor(limY); j++) hLines.push(j);

  if (placement === 'lines') {
    // continuous slide along gridlines — resampled every call
    const PER_LINE = 7;
    for (const i of vLines)
      for (let k = 0; k < PER_LINE; k++) out.push([i, -limY + rnd() * 2 * limY]);
    for (const j of hLines)
      for (let k = 0; k < PER_LINE; k++) out.push([-limX + rnd() * 2 * limX, j]);
    return out;
  }

  for (const i of vLines) {
    for (let j = Math.ceil(-limY - R); j <= Math.floor(limY); j++) {
      if (j >= -limY) out.push([i, j]); // resting: center on the line
      if (placement === 'construction' && j + R >= -limY && j + R <= limY)
        out.push([i, j + R]); // hanging: top edge kisses the line above
    }
  }
  return out;
}

/**
 * Generate a formation for a canvas of w×h cells (short side is normally 4).
 * Deterministic for a given (w, h, seed, options).
 * Returns { w, h, r, seed, dots, lines } with dots in rank order, kernel first.
 */
export function generate(w, h, seed, options = {}) {
  const o = { ...defaults, ...options };
  const rnd = rng(seed);
  const limX = w / 2 - R - o.edge;
  const limY = h / 2 - R - o.edge;

  // The kernel: edge passes through the crosshair, at any angle.
  // Its center is at distance exactly R — never on the center itself.
  const theta = rnd() * Math.PI * 2;
  const kernel = [R * Math.cos(theta), R * Math.sin(theta)];

  const minCenterDist = 2 * R + o.gap;
  const n = Math.max(1, Math.round(o.count)) - 1; // non-kernel dots

  let best = null;
  let bestScore = -Infinity;

  const avoid = Array.isArray(o.avoid) ? o.avoid : [];

  for (let roll = 0; roll < o.rollouts; roll++) {
    const cands = candidatePositions(limX, limY, o.placement, rnd);
    const stale = cands.map((c) => {
      for (const a of avoid) if (dist(c, a) < 0.3) return 0.6;
      return 0;
    });
    let maxD = 0;
    for (const c of cands) maxD = Math.max(maxD, len(c));
    const reach = Math.max(o.spread * maxD, R + n * o.rankStep + 0.01);

    const placed = [kernel];
    const used = new Set();
    let lastD = R;
    let missing = 0;
    let relaxed = 0;

    for (let m = 1; m <= n; m++) {
      const target = R + (m / n) * (reach - R); // evenly spaced gravity rings
      const pick = (step) => {
        let bi = -1;
        let bCost = Infinity;
        for (let c = 0; c < cands.length; c++) {
          if (used.has(c)) continue;
          const p = cands[c];
          const d = len(p);
          if (d < lastD + step) continue; // falloff must keep growing
          if (d < R + 1e-6) continue; //     nothing ever sits on the center
          let ok = true;
          for (const q of placed)
            if (dist(p, q) < minCenterDist) { ok = false; break; }
          if (!ok) continue;
          const cost = Math.abs(d - target) + 0.18 * rnd() + stale[c];
          if (cost < bCost) { bCost = cost; bi = c; }
        }
        return bi;
      };
      // strict growth first; where the lattice runs out of rings (e.g.
      // 'points' on a square canvas) allow same-distance ties before giving up
      let bi = pick(o.rankStep);
      if (bi === -1) {
        bi = pick(0);
        if (bi !== -1) relaxed++;
      }
      if (bi === -1) { missing++; continue; }
      used.add(bi);
      placed.push(cands[bi]);
      lastD = len(cands[bi]);
    }

    // Score: dots should surround the center (small resultant of unit
    // vectors), keep air between each other, and use the allowed reach.
    let res = [0, 0];
    let minGap = Infinity;
    for (let i = 0; i < placed.length; i++) {
      const d = len(placed[i]);
      res[0] += placed[i][0] / d;
      res[1] += placed[i][1] / d;
      for (let j = i + 1; j < placed.length; j++)
        minGap = Math.min(minGap, dist(placed[i], placed[j]) - 2 * R);
    }
    const balance = 1 - len(res) / placed.length;
    const score =
      balance +
      0.8 * Math.min(minGap, 0.5) +
      0.4 * Math.min(lastD / reach, 1) -
      0.6 * relaxed - // prefer a strictly graded falloff whenever one exists
      10 * missing;

    if (score > bestScore) {
      bestScore = score;
      best = placed;
    }
  }

  return { w, h, r: R, seed: String(seed), dots: best, lines: gridLines(w, h) };
}

/** Interior gridlines (integer offsets from center) for the overlay. */
export function gridLines(w, h) {
  const v = [];
  const hh = [];
  for (let i = Math.ceil(-w / 2); i <= Math.floor(w / 2); i++)
    if (Math.abs(i) < w / 2 - 1e-9) v.push(i);
  for (let j = Math.ceil(-h / 2); j <= Math.floor(h / 2); j++)
    if (Math.abs(j) < h / 2 - 1e-9) hh.push(j);
  return { v, h: hh };
}

/**
 * Constrain a dragged dot to the mark's rules. Returns the legal position
 * nearest the pointer — or the dot's previous position when the pointer
 * asks for something illegal (dots stop at contact, nothing ever covers
 * the crosshair).
 *  · index 0 (the kernel) ORBITS: its edge stays pinned through the center,
 *    only its angle follows the pointer
 *  · other dots project onto the active placement rule ('construction'
 *    snaps between lattice seats, 'lines' slides along gridlines,
 *    'points' snaps to intersections), inside the canvas bounds
 * The rank falloff is deliberately not enforced here — dragging is the
 * user overriding the composition.
 */
export function constrainDrag(formation, index, target, options = {}) {
  const o = { ...defaults, ...options };
  const { w, h, dots } = formation;
  const limX = w / 2 - R - o.edge;
  const limY = h / 2 - R - o.edge;
  const prev = dots[index].slice();
  const minD = 2 * R + o.gap;
  const clear = (p) => {
    for (let j = 0; j < dots.length; j++) {
      if (j === index) continue;
      if (dist(p, dots[j]) < minD) return false;
    }
    return true;
  };

  if (index === 0) return orbitKernel(target, prev, clear);

  const clampX = (x) => Math.max(-limX, Math.min(limX, x));
  const clampY = (y) => Math.max(-limY, Math.min(limY, y));
  const lineX = (x) =>
    Math.max(Math.ceil(-limX), Math.min(Math.floor(limX), Math.round(x)));
  const lineY = (y) =>
    Math.max(Math.ceil(-limY), Math.min(Math.floor(limY), Math.round(y)));

  let candidates;
  if (o.placement === 'points') {
    candidates = [[lineX(target[0]), lineY(target[1])]];
  } else if (o.placement === 'lines') {
    candidates = [
      [lineX(target[0]), clampY(target[1])], // stick to a vertical line
      [clampX(target[0]), lineY(target[1])], // or to a horizontal one
    ];
  } else {
    const x = lineX(target[0]);
    const rest = Math.round(target[1]);
    const hang = Math.round(target[1] - R) + R;
    candidates = [rest, hang]
      .filter((y) => y >= -limY && y <= limY)
      .map((y) => [x, y]);
  }
  candidates.sort((a, b) => dist(a, target) - dist(b, target));
  for (const p of candidates) {
    if (Math.hypot(p[0], p[1]) < R + 0.02) continue; // center is kernel's alone
    if (clear(p)) return p;
  }
  return prev;
}

/** The kernel's drag: angle follows the pointer, edge never leaves center. */
function orbitKernel(target, prev, clear) {
  const a = Math.atan2(target[1], target[0]);
  if (!Number.isFinite(a) || (target[0] === 0 && target[1] === 0)) return prev;
  for (let k = 0; k <= 180; k++) {
    for (const s of k === 0 ? [1] : [1, -1]) {
      const ang = a + (s * k * Math.PI) / 180;
      const p = [R * Math.cos(ang), R * Math.sin(ang)];
      if (clear(p)) return p;
    }
  }
  return prev;
}

/**
 * Free drag: every dot — the kernel included — follows the pointer
 * continuously. No grid, no collision, no center ban: overlapping dots are
 * welcome (the renderer fuses them, metaball-style). The only constraint is
 * the canvas itself — dots stay on it.
 */
export function freeDrag(formation, index, target, options = {}) {
  const o = { ...defaults, ...options };
  const { w, h } = formation;
  const limX = w / 2 - R - o.edge;
  const limY = h / 2 - R - o.edge;
  return [
    Math.max(-limX, Math.min(limX, target[0])),
    Math.max(-limY, Math.min(limY, target[1])),
  ];
}

/**
 * Reorder a new formation's dots so each existing circle travels the least
 * (sum of squared moves, brute force over the permutations).
 * With pinKernel (default) circle 0 keeps the kernel role — the mark's
 * reacher identity. Without it the center is an office, not an identity:
 * every circle competes for every seat, and whichever lands on target[0]
 * holds the center this formation.
 * Returns a new dots array aligned to the current circles' indices.
 */
export function assignTargets(current, target, pinKernel = true) {
  const start = pinKernel ? 1 : 0;
  const idx = Array.from({ length: target.length - start }, (_, i) => i + start);
  let bestPerm = idx.slice();
  let bestCost = Infinity;
  const d2 = (a, b) => {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    return dx * dx + dy * dy;
  };
  const permute = (arr, k) => {
    if (k === arr.length) {
      let cost = 0;
      for (let i = 0; i < arr.length; i++)
        cost += d2(current[i + start], target[arr[i]]);
      if (cost < bestCost) { bestCost = cost; bestPerm = arr.slice(); }
      return;
    }
    for (let i = k; i < arr.length; i++) {
      [arr[k], arr[i]] = [arr[i], arr[k]];
      permute(arr, k + 1);
      [arr[k], arr[i]] = [arr[i], arr[k]];
    }
  };
  if (current && current.length === target.length && idx.length > 0)
    permute(idx.slice(), 0);
  const out = pinKernel ? [target[0]] : [];
  for (const p of bestPerm) out.push(target[p]);
  return out;
}
