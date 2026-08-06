// kzn-logo — flat SVG renderer + animator. No dependencies.
//
// Renders formations from core.js as plain <circle> elements (the dot IS a
// mathematical circle — generating it keeps geometry as data, stays crisp at
// any scale and DPR, and the same data feeds the WebGL treatment).
// Fill is `currentColor`, so the consumer sets the ink with CSS `color`.

import { MARK, assignTargets } from './core.js';
import { buildTweens, sampleTweens } from './motion.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

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
 * Dynamic renderer. Owns the circles + the construction-grid overlay inside
 * one <svg>, and animates between formations at display refresh rate.
 * All motion is a single rAF loop mutating cx/cy — a handful of circles,
 * no layout work, no framework.
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
    anims: null,
    raf: 0,
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

  function drawGrid(f, vw, vh) {
    gridG.textContent = '';
    const strokeW = Math.max(vw, vh) / 420; // hairline at any scale
    gridG.setAttribute('stroke-width', strokeW);
    const line = (x1, y1, x2, y2) => {
      const l = document.createElementNS(SVG_NS, 'line');
      l.setAttribute('x1', x1);
      l.setAttribute('y1', y1);
      l.setAttribute('x2', x2);
      l.setAttribute('y2', y2);
      gridG.appendChild(l);
    };
    for (const i of f.lines.v) line(i, -vh / 2, i, vh / 2);
    for (const j of f.lines.h) line(-vw / 2, j, vw / 2, j);
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

  function tick(now) {
    state.raf = 0;
    if (!state.anims) return;
    const { pts, live } = sampleTweens(state.anims, now, state.easing);
    pts.forEach(([x, y], i) => put(i, x, y));
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
      const [vw, vh] = f.view || [f.w, f.h];
      svg.setAttribute('viewBox', `${-vw / 2} ${-vh / 2} ${vw} ${vh}`);
      drawGrid(f, vw, vh);
      ensureCircles(f.dots.length);
      for (const c of state.circles) c.setAttribute('r', f.r);

      const instant =
        first ||
        !animate ||
        state.reduced ||
        state.motion === 'instant' ||
        state.duration <= 0;

      const targets = first ? f.dots : assignTargets(state.current, f.dots);

      if (instant) {
        if (state.raf) cancelAnimationFrame(state.raf);
        state.anims = null;
        targets.forEach(([x, y], i) => put(i, x, y));
        state.onSettle?.();
        return;
      }

      state.anims = buildTweens(state.current, targets, state, performance.now());
      if (!state.raf) state.raf = requestAnimationFrame(tick);
    },
    showGrid(on) {
      gridG.setAttribute('display', on ? 'inline' : 'none');
    },
    configure(patch) {
      Object.assign(state, patch);
    },
    resizePx() {}, // SVG scales by itself
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
