// kzn-logo — flat SVG renderer + animator. No dependencies.
//
// Renders formations from core.js as plain <circle> elements (the dot IS a
// mathematical circle — generating it keeps geometry as data, stays crisp at
// any scale and DPR, and the same data will later feed the WebGL treatment).
// Fill is `currentColor`, so the consumer sets the ink with CSS `color`.

import { R, MARK, assignTargets } from './core.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const EASINGS = {
  cubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  quint: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
  linear: (t) => t,
};

/** Render the canonical static mark into an <svg> element. */
export function renderMark(svg) {
  const [x, y, w, h] = MARK.viewBox;
  svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.textContent = '';
  for (const [cx, cy] of MARK.dots) {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', cx);
    c.setAttribute('cy', cy);
    c.setAttribute('r', MARK.r);
    c.setAttribute('fill', 'currentColor');
    svg.appendChild(c);
  }
}

/** Standalone SVG markup for export/download (static mark or a formation). */
export function toSVG(formationOrMark, { ink = '#1E1E1E', size = 640 } = {}) {
  let vb, r, dots;
  if (formationOrMark.viewBox) {
    const m = formationOrMark;
    vb = m.viewBox;
    r = m.r;
    dots = m.dots;
  } else {
    const f = formationOrMark;
    vb = [-f.w / 2, -f.h / 2, f.w, f.h];
    r = f.r;
    dots = f.dots;
  }
  const [x, y, w, h] = vb;
  const height = Math.round((size * h) / w);
  const circles = dots
    .map(([cx, cy]) => `  <circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="${ink}"/>`)
    .join('\n');
  return `<svg xmlns="${SVG_NS}" viewBox="${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)}" width="${size}" height="${height}">\n${circles}\n</svg>\n`;
}

const fmt = (n) => (Math.round(n * 10000) / 10000).toString();

/**
 * Dynamic renderer. Owns six circles + the construction-grid overlay inside
 * one <svg>, and animates between formations at display refresh rate.
 * All motion is a single rAF loop mutating cx/cy — six circles, no layout work.
 */
export function createDynamicRenderer(svg, opts = {}) {
  const state = {
    duration: opts.duration ?? 750,
    stagger: opts.stagger ?? 45,
    easing: opts.easing ?? 'cubic',
    motion: opts.motion ?? 'glide', // 'glide' | 'instant'
    reduced:
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches,
    formation: null,
    circles: [],
    current: [], // live [x, y] per circle
    anims: null, // per-circle {path, t0, dur} while transitioning
    raf: 0,
    gridOn: false,
    onSettle: null,
  };

  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const gridG = document.createElementNS(SVG_NS, 'g');
  gridG.setAttribute('stroke', 'currentColor');
  gridG.setAttribute('stroke-opacity', '0.18');
  gridG.setAttribute('display', 'none');
  const dotsG = document.createElementNS(SVG_NS, 'g');
  svg.append(gridG, dotsG);

  function ensureCircles(n) {
    while (state.circles.length < n) {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('fill', 'currentColor');
      dotsG.appendChild(c);
      state.circles.push(c);
    }
    while (state.circles.length > n) state.circles.pop().remove();
  }

  function drawGrid(f) {
    gridG.textContent = '';
    const strokeW = Math.max(f.w, f.h) / 420; // hairline at any scale
    gridG.setAttribute('stroke-width', strokeW);
    const line = (x1, y1, x2, y2) => {
      const l = document.createElementNS(SVG_NS, 'line');
      l.setAttribute('x1', x1);
      l.setAttribute('y1', y1);
      l.setAttribute('x2', x2);
      l.setAttribute('y2', y2);
      gridG.appendChild(l);
    };
    for (const i of f.lines.v) line(i, -f.h / 2, i, f.h / 2);
    for (const j of f.lines.h) line(-f.w / 2, j, f.w / 2, j);
    // the crosshair itself, slightly more present
    const cross = document.createElementNS(SVG_NS, 'circle');
    cross.setAttribute('r', strokeW * 2.4);
    cross.setAttribute('cx', 0);
    cross.setAttribute('cy', 0);
    cross.setAttribute('fill', 'currentColor');
    cross.setAttribute('fill-opacity', '0.5');
    cross.setAttribute('stroke', 'none');
    gridG.appendChild(cross);
  }

  function put(i, x, y) {
    state.current[i] = [x, y];
    const c = state.circles[i];
    c.setAttribute('cx', x);
    c.setAttribute('cy', y);
  }

  // --- transition paths --------------------------------------------------

  // The kernel never leaves the crosshair: it orbits it, edge always in
  // contact, along the shorter arc.
  function kernelPath(a, b) {
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

  // Other dots travel straight — unless the line would sweep over the
  // crosshair, in which case the path bows around it. Nothing ever covers
  // the center, even mid-flight.
  function dotPath(a, b) {
    const clearance = R + 0.1;
    if (segDistToOrigin(a, b) >= clearance) {
      return (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    let dx = mx;
    let dy = my;
    let dl = Math.hypot(dx, dy);
    if (dl < 1e-6) {
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

  function segDistToOrigin(a, b) {
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const l2 = abx * abx + aby * aby;
    if (l2 < 1e-12) return Math.hypot(a[0], a[1]);
    let t = -(a[0] * abx + a[1] * aby) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(a[0] + t * abx, a[1] + t * aby);
  }

  // --- main loop ---------------------------------------------------------

  function tick(now) {
    state.raf = 0;
    if (!state.anims) return;
    const ease = EASINGS[state.easing] || EASINGS.cubic;
    let live = false;
    for (let i = 0; i < state.anims.length; i++) {
      const a = state.anims[i];
      if (!a || a.done) continue;
      const t = Math.min(1, (now - a.t0) / a.dur);
      if (t < 1) live = true;
      else a.done = true;
      const [x, y] = a.path(t < 0 ? 0 : ease(t));
      put(i, x, y);
    }
    if (live) state.raf = requestAnimationFrame(tick);
    else {
      state.anims = null;
      state.onSettle?.();
    }
  }

  return {
    /** Move to a formation. Animates from wherever the dots are right now. */
    setFormation(f, { animate = true } = {}) {
      const first = !state.formation;
      state.formation = f;
      svg.setAttribute('viewBox', `${-f.w / 2} ${-f.h / 2} ${f.w} ${f.h}`);
      drawGrid(f);
      ensureCircles(f.dots.length);
      for (const c of state.circles) c.setAttribute('r', f.r);

      const instant =
        first ||
        !animate ||
        state.reduced ||
        state.motion === 'instant' ||
        state.duration <= 0;

      const targets = first
        ? f.dots
        : assignTargets(state.current, f.dots);

      if (instant) {
        if (state.raf) cancelAnimationFrame(state.raf);
        state.anims = null;
        targets.forEach(([x, y], i) => put(i, x, y));
        state.onSettle?.();
        return;
      }

      const now = performance.now();
      state.anims = targets.map((to, i) => {
        const from = state.current[i] ?? to;
        const path = i === 0 ? kernelPath(from, to) : dotPath(from, to);
        return { path, t0: now + (i === 0 ? 0 : i * state.stagger), dur: state.duration, done: false };
      });
      if (!state.raf) state.raf = requestAnimationFrame(tick);
    },
    showGrid(on) {
      state.gridOn = !!on;
      gridG.setAttribute('display', on ? 'inline' : 'none');
    },
    configure(patch) {
      Object.assign(state, patch);
    },
    get formation() {
      return state.formation;
    },
    get settled() {
      return !state.anims;
    },
    set onSettle(fn) {
      state.onSettle = fn;
    },
    destroy() {
      if (state.raf) cancelAnimationFrame(state.raf);
      svg.textContent = '';
    },
  };
}
