// kzn-logo — <kzn-logo> custom element. Framework-agnostic: drop the script on
// any page (plain HTML, React, Vue, ...) and use the tag.
//
//   <kzn-logo mode="static"></kzn-logo>                     the stable symbol
//   <kzn-logo mode="dynamic" interactive seed="kzn"></kzn-logo>
//
// Sizing is the host's business (CSS width/height); ink is CSS `color`.

import { generate, gridLines, MARK, MARK_IDEAL, R } from './core.js';
import { renderMark, createDynamicRenderer, toSVG } from './svg.js';
import { createWebGLRenderer } from './webgl.js';

const BASE_CELLS = 4; // cells on the short side — the 4×4 heritage

class KznLogo extends HTMLElement {
  static observedAttributes = ['mode', 'seed', 'grid', 'interactive', 'renderer'];

  #svg = null;
  #canvas = null;
  #dyn = null;
  #ro = null;
  #dims = null; // { w, h } in cells
  #base = null; // seed base
  #step = 0; //   0 = the ideal mark; n>0 = generated formation n
  #engineOpts = {};
  #effectsOpts = null;
  #resizeTimer = 0;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent =
      ':host{display:block;color:inherit}:host([interactive]){cursor:pointer}' +
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
    this.#mount();
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.#onClick);
    this.removeEventListener('keydown', this.#onKey);
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
    if (Object.keys(patch).some((k) => k in this.#engineOpts) && this.#step > 0)
      this.#apply(true);
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

  get formation() {
    return this.mode === 'dynamic' ? this.#dyn?.formation : MARK;
  }

  get seed() {
    return this.#step === 0 ? 'mark' : `${this.#base}#${this.#step}`;
  }

  /** Standalone SVG markup of what is currently shown (for export). */
  exportSVG(opts) {
    const f = this.mode === 'dynamic' ? this.#dyn?.formation : MARK;
    return toSVG(f || MARK, opts);
  }

  // --- internals ---------------------------------------------------------

  #onClick = () => {
    if (this.hasAttribute('interactive')) this.shuffle();
  };

  #onKey = (e) => {
    if (!this.hasAttribute('interactive')) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.shuffle();
    }
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

    this.#dyn.onSettle = () =>
      this.dispatchEvent(
        new CustomEvent('kzn-settle', { bubbles: true, composed: true })
      );
    this.#ro = new ResizeObserver((entries) => {
      const r = entries[entries.length - 1].contentRect;
      if (r.width < 1 || r.height < 1) return;
      this.#dyn?.resizePx?.(r.width, r.height, window.devicePixelRatio || 1);
      const ar = r.width / r.height;
      const w = ar >= 1 ? BASE_CELLS * ar : BASE_CELLS;
      const h = ar >= 1 ? BASE_CELLS : BASE_CELLS / ar;
      const prev = this.#dims;
      this.#dims = { w, h };
      if (!prev) {
        this.#apply(false); // first layout: paint instantly
      } else if (Math.abs(prev.w - w) > 0.02 || Math.abs(prev.h - h) > 0.02) {
        clearTimeout(this.#resizeTimer);
        this.#resizeTimer = setTimeout(() => this.#apply(true), 90);
      }
    });
    this.#ro.observe(this);
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
    const { w, h } = this.#dims;
    if (this.#step === 0)
      return {
        w,
        h,
        r: R,
        seed: 'mark',
        dots: MARK_IDEAL.dots.map((d) => d.slice()),
        lines: gridLines(w, h),
      };
    return generate(w, h, `${this.#base}#${this.#step}`, this.#engineOpts);
  }

  #apply(animate) {
    if (this.mode !== 'dynamic' || !this.#dyn || !this.#dims) return;
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
