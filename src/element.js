// kzn-logo — <kzn-logo> custom element. Framework-agnostic: drop the script on
// any page (plain HTML, React, Vue, ...) and use the tag.
//
//   <kzn-logo mode="static"></kzn-logo>                     the stable symbol
//   <kzn-logo mode="dynamic" interactive seed="kzn"></kzn-logo>
//
// Sizing is the host's business (CSS width/height); ink is CSS `color`.

import { generate, gridLines, constrainDrag, freeDrag, MARK, MARK_IDEAL, R } from './core.js';
import { renderMark, createDynamicRenderer, toSVG } from './svg.js';
import { createWebGLRenderer } from './webgl.js';

const BASE_CELLS = 4; // cells on the short side — the 4×4 heritage

class KznLogo extends HTMLElement {
  static observedAttributes = ['mode', 'seed', 'grid', 'interactive', 'renderer', 'drag'];

  #svg = null;
  #canvas = null;
  #dyn = null;
  #ro = null;
  #dims = null; // { w, h, vw, vh } — generation and view dims, in cells
  #base = null; // seed base
  #step = 0; //   0 = the ideal mark; n>0 = generated formation n
  #engineOpts = {};
  #effectsOpts = null;
  #appearanceOpts = null;
  #intro = null; // authored opening formation — see the `intro` setter
  #px = null; //   last measured host size in CSS px
  #scale = 1; // grid zoom: 1 = four cells on the short side (the default web size)
  #resizeTimer = 0;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent =
      ':host{display:block;color:inherit}:host([interactive]){cursor:pointer}' +
      ':host([drag]){touch-action:none}' +
      'svg,canvas{display:block;width:100%;height:100%}' +
      '[hidden]{display:none !important}';
    this.#svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.#svg.setAttribute('aria-hidden', 'true');
    root.append(style, this.#svg);
  }

  connectedCallback() {
    if (!this.hasAttribute('role')) this.setAttribute('role', 'img');
    if (!this.hasAttribute('aria-label'))
      this.setAttribute('aria-label', 'Kaizen logo');
    this.#base = this.getAttribute('seed') || Math.random().toString(36).slice(2, 8);
    if (this.hasAttribute('interactive')) this.setAttribute('tabindex', '0');
    this.addEventListener('click', this.#onClick);
    this.addEventListener('keydown', this.#onKey);
    this.addEventListener('pointerdown', this.#onPointerDown);
    this.addEventListener('pointermove', this.#onPointerMove);
    this.addEventListener('pointerup', this.#onPointerEnd);
    this.addEventListener('pointercancel', this.#onPointerEnd);
    this.#mount();
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.#onClick);
    this.removeEventListener('keydown', this.#onKey);
    this.removeEventListener('pointerdown', this.#onPointerDown);
    this.removeEventListener('pointermove', this.#onPointerMove);
    this.removeEventListener('pointerup', this.#onPointerEnd);
    this.removeEventListener('pointercancel', this.#onPointerEnd);
    this.#unmount();
  }

  attributeChangedCallback(name, oldV, newV) {
    if (oldV === newV || !this.isConnected) return;
    if (name === 'mode') this.#mount();
    else if (name === 'seed') {
      this.#base = newV || this.#base;
      this.#step = 0;
      this.#apply(true);
    } else if (name === 'grid') this.#dyn?.showGrid(newV !== null);
    else if (name === 'renderer') this.#mount();
    else if (name === 'interactive') {
      if (newV !== null) this.setAttribute('tabindex', '0');
      else this.removeAttribute('tabindex');
    }
  }

  get mode() {
    return this.getAttribute('mode') === 'dynamic' ? 'dynamic' : 'static';
  }

  /** Engine + motion options; merged, live. See core.defaults and svg renderer. */
  set options(patch) {
    const motion = {};
    for (const k of ['duration', 'stagger', 'easing', 'motion'])
      if (k in patch) motion[k] = patch[k];
    for (const k of ['placement', 'gap', 'spread', 'edge', 'rankStep', 'count', 'rollouts'])
      if (k in patch) this.#engineOpts[k] = patch[k];
    this.#dyn?.configure(motion);
    let dirty = Object.keys(patch).some((k) => k in this.#engineOpts) && this.#step > 0;
    if ('scale' in patch && patch.scale !== this.#scale) {
      this.#scale = Math.max(0.25, Math.min(8, +patch.scale || 1));
      if (this.#dims) {
        this.#dims = this.#computeDims(this.#dims.vw / this.#dims.vh);
        dirty = true;
      }
    }
    if (dirty) this.#apply(true);
  }

  /** Advance to the next formation (or restart from a given seed). */
  shuffle(seed) {
    if (this.mode !== 'dynamic') return;
    if (seed !== undefined) {
      this.#base = String(seed);
      this.#step = 1;
    } else this.#step++;
    this.#apply(true);
  }

  /** Back to the resting state: the ideal mark on the current canvas. */
  rest() {
    this.#step = 0;
    this.#apply(true);
  }

  /**
   * Post-effect parameters (WebGL renderer only; ignored by SVG):
   * { blur: px, grain: 0..1, tint: 0..1, tintColor: '#…', background: '#…' }.
   * All zero by default — flat parity. Placeholder stack until the Unicorn
   * Studio effect chain is replicated.
   */
  set effects(patch) {
    this.#effectsOpts = { ...(this.#effectsOpts || {}), ...patch };
    this.#dyn?.setEffects?.(this.#effectsOpts);
  }

  get effects() {
    return this.#effectsOpts;
  }

  /** Re-read CSS ink/ground colors (call after a theme change). */
  refreshInk() {
    this.#dyn?.refreshInk?.();
  }

  /**
   * Dot layer look, both renderers: { ink: '#…', opacity: 0..1,
   * blend: 'normal'|'difference'|'multiply'|'screen', soft: cells }.
   * (The hero comp: Signal #FEA021, opacity 0.1, difference, heavy soft.)
   */
  set appearance(patch) {
    this.#appearanceOpts = { ...(this.#appearanceOpts || {}), ...patch };
    this.#dyn?.setAppearance?.(this.#appearanceOpts);
  }

  get appearance() {
    return this.#appearanceOpts;
  }

  /**
   * Authored opening formation (kernel first), shown at step 0 instead of
   * the ideal mark. Two anchorings:
   *  · { r, dots } — viewport fractions (r of viewport height)
   *  · { insets: [top, right, bottom, left] px, r, dots } — dots are
   *    fractions of the inset box, r a fraction of the box height; the px
   *    insets stay FIXED under resize, like real page padding
   * Every shuffle leaves it for engine-generated constellations solved for
   * the live window — independent of the authored opening.
   */
  set intro(v) {
    this.#intro = v;
    if (this.#step === 0) this.#apply(false);
  }

  get intro() {
    return this.#intro;
  }

  get formation() {
    return this.mode === 'dynamic' ? this.#dyn?.formation : MARK;
  }

  get seed() {
    if (this.#customDrag) return 'custom';
    return this.#step === 0 ? 'mark' : `${this.#base}#${this.#step}`;
  }

  /** Standalone SVG markup of what is currently shown (for export). */
  exportSVG(opts) {
    const f = this.mode === 'dynamic' ? this.#dyn?.formation : MARK;
    return toSVG(f || MARK, opts);
  }

  // --- internals ---------------------------------------------------------

  #dragState = null; // { index, moved, x0, y0 } while a pointer holds a dot
  #suppressClick = false;
  #customDrag = false;

  #onClick = () => {
    if (this.#suppressClick) {
      this.#suppressClick = false;
      return;
    }
    if (this.hasAttribute('interactive')) this.shuffle();
  };

  #onKey = (e) => {
    if (!this.hasAttribute('interactive')) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.shuffle();
    }
  };

  // --- dragging: dots move under the rules -------------------------------

  #cellFromEvent(e) {
    const rect = this.getBoundingClientRect();
    const { vw, vh } = this.#dims;
    return [
      ((e.clientX - rect.left) / rect.width - 0.5) * vw,
      ((e.clientY - rect.top) / rect.height - 0.5) * vh,
    ];
  }

  #hitDot(p) {
    const f = this.#dyn?.formation;
    if (!f) return -1;
    const cur = this.#dyn.current;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < cur.length; i++) {
      const d = Math.hypot(p[0] - cur[i][0], p[1] - cur[i][1]);
      if (d <= f.r * 1.2 && d < bestD) {
        best = i;
        bestD = d;
      }
    }
    return best;
  }

  #dragReady() {
    return (
      this.hasAttribute('drag') && this.mode === 'dynamic' && this.#dyn && this.#dims
    );
  }

  #onPointerDown = (e) => {
    this.#suppressClick = false; // a fresh interaction always starts clean
    if (!this.#dragReady() || !e.isPrimary) return;
    const cell = this.#cellFromEvent(e);
    const i = this.#hitDot(cell);
    if (i < 0) return;
    this.setPointerCapture(e.pointerId);
    const dot = this.#dyn.current[i];
    this.#dragState = {
      index: i,
      moved: false,
      x0: e.clientX,
      y0: e.clientY,
      // keep the grab point — the dot must not jump to the pointer center
      off: [dot[0] - cell[0], dot[1] - cell[1]],
    };
  };

  #onPointerMove = (e) => {
    if (!this.#dragReady()) return;
    if (!this.#dragState) {
      if (this.hasAttribute('drag'))
        this.style.cursor =
          this.#hitDot(this.#cellFromEvent(e)) >= 0
            ? 'grab'
            : this.hasAttribute('interactive')
              ? 'pointer'
              : '';
      return;
    }
    const s = this.#dragState;
    if (!s.moved && Math.hypot(e.clientX - s.x0, e.clientY - s.y0) < 3) return;
    s.moved = true;
    this.style.cursor = 'grabbing';
    const f = this.#dyn.formation;
    const cur = this.#dyn.current;
    const cell = this.#cellFromEvent(e);
    // free drag by default; drag="grid" restores lattice-constrained moves.
    // The kernel always takes the raw pointer — its orbit follows direction.
    const grid = this.getAttribute('drag') === 'grid';
    const target =
      s.index === 0 ? cell : [cell[0] + s.off[0], cell[1] + s.off[1]];
    cur[s.index] = (grid ? constrainDrag : freeDrag)(
      { w: f.w, h: f.h, dots: cur },
      s.index,
      target,
      this.#engineOpts
    );
    this.#dyn.poke(cur);
  };

  #onPointerEnd = (e) => {
    const s = this.#dragState;
    if (!s) return;
    this.#dragState = null;
    if (this.hasPointerCapture?.(e.pointerId)) this.releasePointerCapture(e.pointerId);
    this.style.cursor = '';
    if (!s.moved) return; // a plain tap — let click-to-shuffle handle it
    this.#suppressClick = true;
    const f = this.#dyn.formation;
    f.dots = this.#dyn.current;
    this.#customDrag = true;
    this.dispatchEvent(
      new CustomEvent('kzn-drag', {
        bubbles: true,
        composed: true,
        detail: { formation: f, index: s.index },
      })
    );
  };

  #mount() {
    this.#unmount();
    if (this.mode === 'static') {
      this.#svg.toggleAttribute('hidden', false);
      renderMark(this.#svg);
      return;
    }
    // dynamic: WebGL when asked for and available, flat SVG otherwise.
    // A fresh canvas per mount — a lost/destroyed context can't be revived.
    if (this.getAttribute('renderer') === 'webgl') {
      this.#canvas = document.createElement('canvas');
      this.#canvas.setAttribute('aria-hidden', 'true');
      this.shadowRoot.append(this.#canvas);
      try {
        this.#dyn = createWebGLRenderer(this.#canvas, this);
      } catch {
        this.#dyn = null;
      }
      if (!this.#dyn) {
        this.#canvas.remove();
        this.#canvas = null;
      }
    }
    const usingGL = !!this.#dyn;
    if (!usingGL) this.#dyn = createDynamicRenderer(this.#svg);
    this.#svg.toggleAttribute('hidden', usingGL);
    this.dataset.rendererActive = usingGL ? 'webgl' : 'svg';
    if (usingGL && this.#effectsOpts) this.#dyn.setEffects(this.#effectsOpts);
    if (this.#appearanceOpts) this.#dyn.setAppearance?.(this.#appearanceOpts);

    this.#dyn.onSettle = () =>
      this.dispatchEvent(
        new CustomEvent('kzn-settle', { bubbles: true, composed: true })
      );
    this.#ro = new ResizeObserver((entries) => {
      const r = entries[entries.length - 1].contentRect;
      if (r.width < 1 || r.height < 1) return;
      this.#dyn?.resizePx?.(r.width, r.height, window.devicePixelRatio || 1);
      this.#px = { w: r.width, h: r.height };
      const prev = this.#dims;
      this.#dims = this.#computeDims(r.width / r.height);
      const d = this.#dims;
      if (!prev) {
        this.#apply(false); // first layout: paint instantly
      } else if (
        Math.abs(prev.w - d.w) > 0.02 ||
        Math.abs(prev.h - d.h) > 0.02 ||
        Math.abs(prev.vw - d.vw) > 0.02 ||
        Math.abs(prev.vh - d.vh) > 0.02
      ) {
        clearTimeout(this.#resizeTimer);
        this.#resizeTimer = setTimeout(() => this.#apply(true), 90);
      }
    });
    this.#ro.observe(this);
  }

  /**
   * Grid zoom. The view always shows 4/scale cells on its short side; the
   * formation is generated on at least the standard 4-cell canvas, so
   * zooming IN (scale > 1) is a pure window — dots grow and bleed off the
   * edges — while zooming OUT (scale < 1) extends the grid and lets the
   * dots re-spread across it. Rules and the 0.775 dot-to-cell ratio hold
   * at every zoom.
   */
  #computeDims(ar) {
    const visShort = BASE_CELLS / this.#scale;
    const genShort = Math.max(BASE_CELLS, visShort);
    const wide = ar >= 1;
    return {
      w: wide ? genShort * ar : genShort,
      h: wide ? genShort : genShort / ar,
      vw: wide ? visShort * ar : visShort,
      vh: wide ? visShort : visShort / ar,
    };
  }

  #unmount() {
    this.#ro?.disconnect();
    this.#ro = null;
    clearTimeout(this.#resizeTimer);
    this.#dyn?.destroy();
    this.#dyn = null;
    this.#dims = null;
    this.#svg.textContent = '';
    this.#canvas?.remove();
    this.#canvas = null;
    delete this.dataset.rendererActive;
  }

  #formationForStep() {
    const { w, h, vw, vh } = this.#dims;
    let f;
    if (this.#step === 0 && this.#intro) {
      const it = this.#intro;
      if (it.insets && this.#px) {
        // fixed px insets; the formation lives inside the box (the comp's
        // anchoring: 138px sides, 53px top, 130px bottom at base)
        const [t, ri, b, l] = it.insets;
        const { w: pxW, h: pxH } = this.#px;
        const bw = Math.max(1, pxW - l - ri);
        const bh = Math.max(1, pxH - t - b);
        let rPx;
        let dotsPx;
        if (it.fit === 'mark') {
          // the ideal mark fitted so its tight bbox IS the box: vertical
          // rhythm canonical (box height = (2 + R) vertical cells, dot
          // radius 0.3875 of a cell), columns spread to fill the width
          const cellY = bh / (2 + R);
          rPx = R * cellY;
          dotsPx = [
            [bw / 2, rPx + cellY], // kernel — tangent under the box's crosshair
            [bw / 2, rPx],
            [rPx, rPx],
            [bw - rPx, rPx],
            [rPx, bh - rPx],
            [bw - rPx, bh - rPx],
          ];
        } else {
          rPx = it.r * bh;
          dotsPx = it.dots.map(([bx, by]) => [bx * bw, by * bh]);
        }
        f = {
          w,
          h,
          r: rPx / (pxH / vh),
          seed: 'intro',
          dots: dotsPx.map(([dx, dy]) => [
            ((l + dx) / pxW - 0.5) * vw,
            ((t + dy) / pxH - 0.5) * vh,
          ]),
          lines: null,
        };
      } else {
        // viewport-proportional anchoring
        f = {
          w,
          h,
          r: it.r * vh,
          seed: 'intro',
          dots: it.dots.map(([fx, fy]) => [(fx - 0.5) * vw, (fy - 0.5) * vh]),
          lines: null,
        };
      }
    } else if (this.#step === 0) {
      f = {
        w,
        h,
        r: R,
        seed: 'mark',
        dots: MARK_IDEAL.dots.map((d) => d.slice()),
        lines: null,
      };
    } else {
      f = generate(w, h, `${this.#base}#${this.#step}`, this.#engineOpts);
    }
    // the view may be a window into (zoom in) or an extension of (zoom out)
    // the generation canvas; gridlines cover whichever is larger
    f.view = [vw, vh];
    f.lines = gridLines(Math.max(w, vw), Math.max(h, vh));
    return f;
  }

  #apply(animate) {
    if (this.mode !== 'dynamic' || !this.#dyn || !this.#dims) return;
    this.#customDrag = false;
    const f = this.#formationForStep();
    this.#dyn.setFormation(f, { animate });
    this.#dyn.showGrid(this.hasAttribute('grid'));
    this.dispatchEvent(
      new CustomEvent('kzn-shuffle', {
        bubbles: true,
        composed: true,
        detail: { formation: f, step: this.#step, seed: this.seed },
      })
    );
  }
}

if (!customElements.get('kzn-logo')) customElements.define('kzn-logo', KznLogo);
