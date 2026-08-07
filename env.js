// kzn-logo — site test environment. Recreates the Figma hero (node 179-3924):
// production gradient + noise plate beneath, our WebGL dots on top, with the
// authored composition as the opening state — anchored to fixed insets
// (138px sides · 53px top · 130px bottom at the 1440×880 base). Click
// disperses into engine constellations solved for the live window,
// independent of the opening. Every control mirrors into the URL.

import './src/element.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const logo = $('logo');
const frame = $('frame');
const num = (k, d) => +(params.get(k) ?? d);

// the page gradient, pre-composited (the 50%-opacity stops over #FFFBF8):
//   #FFFBF8 → #F2E7E8 @ 48.44% → #D3D0DE
const GROUND = {
  gradient: [
    [0, '#FFFBF8'],
    [0.4844, '#F2E7E8'],
    [1, '#D3D0DE'],
  ],
};

// the authored hero composition (measured from Figma node 179-3926):
// dots as fractions of the inset box, kernel first — the middle dot,
// tangent (with the comp's ~2px optical slack) to the comp's own crosshair
const INTRO = {
  insets: [53, 138, 130, 138], // top right bottom left, px — fixed, vital
  r: 0.1607, //                   112.0085px on the 697px-tall box
  dots: [
    [0.5, 0.90463], //      the reacher
    [0.5, 0.48211],
    [0.09623, 0.48211],
    [0.90377, 0.48211],
    [0.09623, 1.16005], //  bottom pair — authored to run off the canvas
    [0.90377, 1.16005],
  ],
};

const state = {
  seed: params.get('seed') || 'kzn',
  scale: num('scale', 1.31), // engine dots land at the intro's 112px
  ink: params.get('ink') || '1E1E1E', // hex, no '#' — black for now
  alpha: num('alpha', 1),
  blend: params.get('blend') || 'normal',
  soft: num('soft', 0),
  fog: num('fog', 0),
  bokeh: num('bokeh', 0),
  rays: num('rays', 0),
  zoom: num('zoom', 0),
  diffuse: num('diffuse', 0),
  grain: num('grain', 0),
  duration: num('duration', 750),
  stagger: num('stagger', 45),
  panel: params.get('panel') !== '0',
};
const FX = ['fog', 'bokeh', 'rays', 'zoom', 'diffuse', 'grain'];
const DEFAULTS = {
  seed: 'kzn', scale: 1.31, ink: '1E1E1E', alpha: 1, blend: 'normal',
  soft: 0, duration: 750, stagger: 45, panel: true,
};

function syncURL() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) {
    if (k in DEFAULTS && v === DEFAULTS[k]) continue;
    if (v !== '' && v !== false && v !== 0) p.set(k, v === true ? '1' : v);
  }
  const q = p.toString();
  history.replaceState(null, '', q ? '?' + q : location.pathname);
}

function applyFormation() {
  logo.options = {
    scale: state.scale,
    duration: state.duration,
    stagger: state.stagger,
  };
  $('seedIn').value = state.seed;
  $('scaleR').value = state.scale;
  $('scaleOut').textContent = state.scale.toFixed(2) + '×';
  $('durOut').textContent = state.duration + 'ms';
  $('duration').value = state.duration;
  $('stagOut').textContent = state.stagger + 'ms';
  $('stagger').value = state.stagger;
}

function applyDots() {
  logo.appearance = {
    ink: '#' + state.ink,
    opacity: state.alpha,
    blend: state.blend,
    soft: state.soft,
  };
  $('inkc').value = '#' + state.ink;
  $('alpha').value = state.alpha;
  $('alphaOut').textContent = state.alpha.toFixed(2);
  $('blend').value = state.blend;
  $('soft').value = state.soft;
  $('softOut').textContent = state.soft.toFixed(2);
}

function applyFx() {
  logo.effects = {
    fog: state.fog,
    bokeh: state.bokeh,
    rays: state.rays,
    zoom: state.zoom,
    diffuse: state.diffuse,
    grain: state.grain,
    background: GROUND,
  };
  for (const k of FX) {
    $(k).value = state[k];
    $(k + 'Out').textContent = state[k].toFixed(2);
  }
}

function applyPanel() {
  document.body.classList.toggle('nopanel', !state.panel);
}

// --- wiring ---------------------------------------------------------------
$('shuffleBtn').onclick = () => logo.shuffle();
$('introBtn').onclick = () => logo.rest();
$('seedIn').addEventListener('change', () => {
  state.seed = $('seedIn').value || 'kzn';
  logo.setAttribute('seed', state.seed);
  syncURL();
});

const slider = (id, key, apply) => {
  $(id).addEventListener('input', () => {
    state[key] = +$(id).value;
    apply();
    syncURL();
  });
};
slider('scaleR', 'scale', applyFormation);
slider('alpha', 'alpha', applyDots);
slider('soft', 'soft', applyDots);
slider('duration', 'duration', applyFormation);
slider('stagger', 'stagger', applyFormation);
for (const k of FX) slider(k, k, applyFx);

$('blend').addEventListener('change', () => {
  state.blend = $('blend').value;
  applyDots();
  syncURL();
});
$('inkc').addEventListener('input', () => {
  state.ink = $('inkc').value.slice(1);
  applyDots();
  syncURL();
});
$('signalBtn').onclick = () => {
  Object.assign(state, { ink: 'FEA021', alpha: 0.1, blend: 'difference' });
  applyDots();
  syncURL();
};
$('scaleReset').onclick = () => {
  state.scale = 1.31;
  applyFormation();
  syncURL();
};
$('stackOn').onclick = () => {
  for (const k of FX) state[k] = 1;
  applyFx();
  syncURL();
};
$('stackOff').onclick = () => {
  for (const k of FX) state[k] = 0;
  applyFx();
  syncURL();
};
$('panelToggle').onclick = () => {
  state.panel = !state.panel;
  applyPanel();
  syncURL();
};
$('reset').onclick = () => {
  frame.style.width = '1440px';
  frame.style.height = '880px';
};

if (params.get('w')) frame.style.width = params.get('w') + 'px';
if (params.get('h')) frame.style.height = params.get('h') + 'px';
if (params.get('grid') === '1') logo.setAttribute('grid', '');

new ResizeObserver(([e]) => {
  $('size').textContent =
    `${Math.round(e.contentRect.width)} × ${Math.round(e.contentRect.height)}`;
}).observe(frame);

// --- boot -----------------------------------------------------------------
logo.setAttribute('seed', state.seed);
applyFormation();
applyDots();
applyFx();
applyPanel();
logo.intro = INTRO;
for (let i = 0, n = num('step', 0); i < n; i++) logo.shuffle();
