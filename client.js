// kzn-logo — client presentation page. The piece fills whatever viewport it
// gets: ground gradient + grain live on the page itself, the dots composite
// over them, and the full treatment panel floats on top — hidable, every
// slider paired with a typed number, one undo stack across everything.
// Fork of env.js without the test-bench chrome (resizable frame, fps meter,
// preset buttons). State still mirrors into the URL — a link is a preset.

import './src/element.js';

const params = new URLSearchParams(location.search);
const logo = document.getElementById('logo');
const panel = document.getElementById('panel');
const toggleBtn = document.getElementById('toggle');
const num = (k, d) => +(params.get(k) ?? d);

// authored opening (Figma 179-3924): the mark's bbox fills the box inset
// 53 top / 138 sides / 130 bottom — fixed px, same rule at every viewport
const INTRO = { insets: [53, 138, 130, 138], fit: 'mark' };

// opening recipe = the client-review settings: brand blue at 9% multiply
// over the 02-Home ground, full kaizen stack with calm slow fog
const DEFAULTS = {
  seed: 'kzn', scale: 1.31, kernel: 'fixed', duration: 750, stagger: 45,
  ink: '007CE6', alpha: 0.09, blend: 'multiply', soft: 0, fuse: 0.3,
  fog: 1, fogspeed: 0.65, fogscale: 0.65, fogdensity: 0.25,
  bokeh: 1,
  rays: 1, raymode: 'add', raycolor: '', rayink: 0, rayx: 0.5, rayy: 0.44,
  raydecay: 0.899, raywobble: 0.15, rayfollow: 0,
  zoom: 1,
  diffuse: 1, difdir: 45, diftight: 0.75,
  rscale: 1,
  bg0: 'F2E9F0', bg2: 'D7D7E2', noise: 1,
};
const ORDERABLE = ['fog', 'bokeh', 'rays', 'zoom', 'diffuse'];

const state = {};
for (const [k, d] of Object.entries(DEFAULTS))
  state[k] = typeof d === 'number' ? num(k, d) : (params.get(k) ?? d);
state.order = (params.get('order') || ORDERABLE.join(',')).split(',')
  .filter((n) => ORDERABLE.includes(n));
for (const n of ORDERABLE) if (!state.order.includes(n)) state.order.push(n);
state.panel = params.get('panel') !== '0';

function syncURL() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) {
    if (k === 'order') {
      if (v.join(',') !== ORDERABLE.join(',')) p.set(k, v.join(','));
    } else if (k === 'panel') {
      if (!v) p.set(k, '0');
    } else if (v !== DEFAULTS[k]) p.set(k, v);
  }
  const q = p.toString();
  history.replaceState(null, '', q ? '?' + q : location.pathname);
}

// --- apply: state → the piece ---------------------------------------------
function applyFormation() {
  if (logo.getAttribute('seed') !== state.seed) logo.setAttribute('seed', state.seed);
  logo.options = {
    scale: state.scale,
    duration: state.duration,
    stagger: state.stagger,
    kernel: state.kernel,
  };
}

function applyDots() {
  logo.appearance = {
    ink: '#' + state.ink,
    opacity: state.alpha,
    blend: state.blend,
    soft: state.soft,
    fuse: state.fuse,
  };
}

function applyFx() {
  logo.effects = {
    fog: state.fog,
    bokeh: state.bokeh,
    rays: state.rays,
    zoom: state.zoom,
    diffuse: state.diffuse,
    difAngle: state.difdir,
    difTight: state.diftight,
    grain: 1, // fixed — the film grain rides the fog composite
    fogSpeed: state.fogspeed,
    fogScale: state.fogscale,
    fogDensity: state.fogdensity,
    rayMode: state.raymode,
    rayColor: state.raycolor ? '#' + state.raycolor : null,
    rayInk: state.rayink,
    rayX: state.rayx,
    rayY: state.rayy,
    rayDecay: state.raydecay,
    rayWobble: state.raywobble,
    rayFollow: state.rayfollow,
    renderScale: state.rscale,
    order: state.order,
  };
}

const groups = {}; // fx name → its panel group, reparented to match the chain
function applyOrder() {
  const box = groups.$box;
  for (const name of state.order) box.appendChild(groups[name]);
}

function applyGround() {
  document.body.style.backgroundImage =
    `linear-gradient(180deg, #${state.bg0} 0%, #${state.bg2} 100%)`;
  document.querySelector('svg.noise').style.opacity = state.noise;
  logo.refreshInk();
}

function applyPanel() {
  document.body.classList.toggle('nopanel', !state.panel);
  toggleBtn.textContent = state.panel ? 'hide' : 'controls';
}

function applyAll() {
  applyFormation();
  applyDots();
  applyFx();
  applyOrder();
  applyGround();
  applyPanel();
  syncFields();
}

// --- undo: one stack over every setting -----------------------------------
// a burst of movement on one control collapses into a single step
const past = [];
let lastKey = null;
let lastT = 0;
const snap = () => {
  const { panel: _skip, ...rest } = state;
  return JSON.stringify(rest);
};

function mutate(key, value, apply, distinct = false) {
  if (JSON.stringify(state[key]) === JSON.stringify(value)) return;
  const now = performance.now();
  if (distinct || key !== lastKey || now - lastT > 600) {
    past.push(snap());
    if (past.length > 100) past.shift();
  }
  lastKey = distinct ? null : key;
  lastT = now;
  state[key] = value;
  apply();
  syncFields();
  syncURL();
  undoBtn.disabled = false;
}

function undo() {
  if (!past.length) return;
  Object.assign(state, JSON.parse(past.pop()));
  lastKey = null;
  applyAll();
  syncURL();
  undoBtn.disabled = past.length === 0;
}

addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
    const t = document.activeElement;
    if (t?.tagName === 'INPUT' && (t.type === 'text' || t.type === 'number')) return;
    e.preventDefault();
    undo();
  }
});

// --- panel: built from descriptors, every row two-way bound ---------------
const fields = []; // UI refreshers; each skips its input while focused
function syncFields() {
  for (const f of fields) f();
}

const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
};

function rangeRow(o) {
  const digits = (String(o.step).split('.')[1] || '').length;
  const fmt = (v) => (+v).toFixed(digits);
  const range = el('input', { type: 'range', id: o.key, min: o.min, max: o.max, step: o.step });
  const box = el('input', { type: 'number', min: o.min, max: o.max, step: o.step });
  const setFrom = (raw) => {
    const v = +raw;
    if (!Number.isFinite(v)) return;
    mutate(o.key, Math.min(o.max, Math.max(o.min, v)), o.apply);
  };
  range.addEventListener('input', () => setFrom(range.value));
  box.addEventListener('input', () => setFrom(box.value));
  box.addEventListener('change', () => (box.value = fmt(state[o.key])));
  fields.push(() => {
    if (document.activeElement !== range) range.value = state[o.key];
    if (document.activeElement !== box) box.value = fmt(state[o.key]);
  });
  return el('div', { className: 'row' + (o.sub ? ' sub' : '') },
    ...(o.pre ? [o.pre] : []),
    el('label', { htmlFor: o.key, textContent: o.label }), range, box);
}

function selectRow(o) {
  const sel = el('select', { id: o.key });
  for (const [v, l] of o.options) sel.append(el('option', { value: v, textContent: l }));
  sel.addEventListener('change', () => mutate(o.key, sel.value, o.apply, true));
  fields.push(() => (sel.value = state[o.key]));
  return el('div', { className: 'row' + (o.sub ? ' sub' : '') },
    el('label', { htmlFor: o.key, textContent: o.label }), sel);
}

// color = picker + typed hex; o.shown() may substitute a display value
// (the ray color mirrors the ink while unset)
function colorRow(o) {
  const pick = el('input', { type: 'color', id: o.key });
  const hex = el('input', { type: 'text', className: 'hex', spellcheck: false });
  const commit = (raw, distinct) => {
    const v = raw.replace(/^#/, '').trim().toUpperCase();
    if (/^[0-9A-F]{6}$/.test(v)) mutate(o.key, v, o.apply, distinct);
  };
  pick.addEventListener('input', () => commit(pick.value));
  // commit live once six hex digits are in; change just reformats on blur
  hex.addEventListener('input', () => commit(hex.value));
  hex.addEventListener('change', () => {
    commit(hex.value, true);
    hex.value = '#' + (o.shown ? o.shown() : state[o.key]);
  });
  fields.push(() => {
    const v = o.shown ? o.shown() : state[o.key];
    pick.value = '#' + v;
    if (document.activeElement !== hex) hex.value = '#' + v;
  });
  return el('div', { className: 'row' + (o.sub ? ' sub' : '') },
    el('label', { htmlFor: o.key, textContent: o.label }), pick, hex,
    ...(o.extra ? [o.extra] : []));
}

function fxUp(name) {
  const b = el('button', { className: 'up', title: 'move earlier in the chain', textContent: '▲' });
  b.addEventListener('click', () => {
    const i = state.order.indexOf(name);
    if (i > 0) {
      const next = state.order.slice();
      next.splice(i, 1);
      next.splice(i - 1, 0, name);
      mutate('order', next, () => {
        applyOrder();
        applyFx();
      }, true);
    }
  });
  return b;
}

function section(title, open, ...kids) {
  const d = el('details', open ? { open: true } : {});
  d.append(el('summary', { textContent: title }), ...kids);
  return d;
}

const undoBtn = el('button', { id: 'undoBtn', textContent: '↩ undo', disabled: true });
undoBtn.addEventListener('click', undo);

// back to the opening recipe (settings only — the formation stays put);
// lands on the undo stack, so reset itself can be undone
const resetBtn = el('button', { textContent: 'reset' });
resetBtn.addEventListener('click', () => {
  past.push(snap());
  if (past.length > 100) past.shift();
  lastKey = null;
  for (const [k, d] of Object.entries(DEFAULTS)) state[k] = d;
  state.order = ORDERABLE.slice();
  applyAll();
  syncURL();
  undoBtn.disabled = false;
});

const shuffleBtn = el('button', { className: 'primary', textContent: 'shuffle ↻' });
shuffleBtn.addEventListener('click', () => logo.shuffle());
const introBtn = el('button', { textContent: 'intro' });
introBtn.addEventListener('click', () => logo.rest());

const seedIn = el('input', { type: 'text', id: 'seed', spellcheck: false });
seedIn.addEventListener('change', () =>
  mutate('seed', seedIn.value || 'kzn', applyFormation, true));
fields.push(() => {
  if (document.activeElement !== seedIn) seedIn.value = state.seed;
});

const useInk = el('button', { textContent: '= ink' });
useInk.addEventListener('click', () => mutate('raycolor', '', applyFx, true));

const fxApply = applyFx;
const fxBox = el('div');
groups.$box = fxBox;
groups.fog = el('div', {},
  rangeRow({ key: 'fog', label: 'fog', min: 0, max: 2, step: 0.05, apply: fxApply, pre: fxUp('fog') }),
  rangeRow({ key: 'fogspeed', label: '· speed', min: 0, max: 1, step: 0.01, apply: fxApply, sub: true }),
  rangeRow({ key: 'fogscale', label: '· scale', min: 0.3, max: 3, step: 0.05, apply: fxApply, sub: true }),
  rangeRow({ key: 'fogdensity', label: '· density', min: 0.2, max: 2.5, step: 0.05, apply: fxApply, sub: true }));
groups.bokeh = el('div', {},
  rangeRow({ key: 'bokeh', label: 'bokeh', min: 0, max: 2, step: 0.05, apply: fxApply, pre: fxUp('bokeh') }));
groups.rays = el('div', {},
  rangeRow({ key: 'rays', label: 'god rays', min: 0, max: 2, step: 0.05, apply: fxApply, pre: fxUp('rays') }),
  selectRow({ key: 'raymode', label: '· blend', apply: fxApply, sub: true, options: [
    ['add', 'add (plus lighter)'], ['screen', 'screen'], ['dodge', 'color dodge'],
    ['softlight', 'soft light'], ['multiply', 'multiply'], ['burn', 'color burn'],
    ['subtract', 'plus darker']] }),
  colorRow({ key: 'raycolor', label: '· color', apply: fxApply, sub: true, extra: useInk,
    shown: () => state.raycolor || state.ink }),
  rangeRow({ key: 'rayink', label: '· tint amt', min: 0, max: 1, step: 0.01, apply: fxApply, sub: true }),
  rangeRow({ key: 'rayx', label: '· light x', min: 0, max: 1, step: 0.01, apply: fxApply, sub: true }),
  rangeRow({ key: 'rayy', label: '· light y', min: 0, max: 1, step: 0.01, apply: fxApply, sub: true }),
  rangeRow({ key: 'raydecay', label: '· length', min: 0.85, max: 0.99, step: 0.001, apply: fxApply, sub: true }),
  rangeRow({ key: 'raywobble', label: '· wobble', min: 0, max: 0.5, step: 0.01, apply: fxApply, sub: true }),
  rangeRow({ key: 'rayfollow', label: '· follow', min: 0, max: 1, step: 0.01, apply: fxApply, sub: true }));
groups.zoom = el('div', {},
  rangeRow({ key: 'zoom', label: 'zoom blur', min: 0, max: 2, step: 0.05, apply: fxApply, pre: fxUp('zoom') }));
groups.diffuse = el('div', {},
  rangeRow({ key: 'diffuse', label: 'diffuse', min: 0, max: 2, step: 0.05, apply: fxApply, pre: fxUp('diffuse') }),
  rangeRow({ key: 'difdir', label: '· direction', min: 0, max: 360, step: 1, apply: fxApply, sub: true }),
  rangeRow({ key: 'diftight', label: '· tightness', min: 0, max: 1, step: 0.01, apply: fxApply, sub: true }));

panel.append(
  el('div', { className: 'actions' }, undoBtn, resetBtn),
  section('Formation', false,
    el('div', { className: 'row' }, shuffleBtn, introBtn),
    el('div', { className: 'row' },
      el('label', { htmlFor: 'seed', textContent: 'seed' }), seedIn),
    rangeRow({ key: 'scale', label: 'scale', min: 0.5, max: 4, step: 0.01, apply: applyFormation }),
    selectRow({ key: 'kernel', label: 'center', apply: applyFormation, options: [
      ['fixed', 'fixed dot — one reacher, orbits'],
      ['roam', 'roaming — any dot takes the seat']] })),
  section('Dots', true,
    colorRow({ key: 'ink', label: 'ink', apply: applyDots }),
    rangeRow({ key: 'alpha', label: 'opacity', min: 0.02, max: 1, step: 0.01, apply: applyDots }),
    selectRow({ key: 'blend', label: 'blend', apply: applyDots, options: [
      ['normal', 'normal'], ['difference', 'difference'],
      ['multiply', 'multiply'], ['screen', 'screen']] }),
    rangeRow({ key: 'soft', label: 'soft edge', min: 0, max: 1, step: 0.01, apply: applyDots }),
    rangeRow({ key: 'fuse', label: 'fuse', min: 0, max: 0.8, step: 0.01, apply: applyDots })),
  section('Treatment', true,
    fxBox,
    rangeRow({ key: 'rscale', label: 'resolution', min: 0.5, max: 1, step: 0.05, apply: fxApply })),
  section('Ground', true,
    colorRow({ key: 'bg0', label: 'top', apply: applyGround }),
    colorRow({ key: 'bg2', label: 'bottom', apply: applyGround }),
    rangeRow({ key: 'noise', label: 'noise', min: 0, max: 1, step: 0.01, apply: applyGround })),
  section('Motion', false,
    rangeRow({ key: 'duration', label: 'duration ms', min: 150, max: 1600, step: 10, apply: applyFormation }),
    rangeRow({ key: 'stagger', label: 'stagger ms', min: 0, max: 140, step: 5, apply: applyFormation })),
);

toggleBtn.addEventListener('click', () => {
  state.panel = !state.panel;
  applyPanel();
  syncURL();
});

// --- boot -----------------------------------------------------------------
logo.setAttribute('seed', state.seed);
applyAll();
logo.intro = INTRO;
