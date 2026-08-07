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

// the ground stays in CSS (frame gradient + noise plate) — the canvas is a
// transparent dot layer, effects included, composited by the browser.
// (Handing logo.effects a `background` would flip it to canvas-owned.)

// the hero opening: the default mark formation fitted so its bounding box
// exactly fills the inset box — 138px sides, 53px top, 130px bottom (vital,
// fixed px). fit:'mark' derives everything from the construction: vertical
// rhythm canonical, columns spread to the box width (≈470px pitch, r≈113 at
// base — within 1px of the authored comp)
const INTRO = {
  insets: [53, 138, 130, 138], // top right bottom left
  fit: 'mark',
};

const state = {
  seed: params.get('seed') || 'kzn',
  scale: num('scale', 1.31), // engine dots land at the intro's 112px
  ink: params.get('ink') || '1E1E1E', // hex, no '#' — black for now
  alpha: num('alpha', 1),
  blend: params.get('blend') || 'normal',
  soft: num('soft', 0),
  fuse: num('fuse', 0.3), // metaball fusion radius, cells
  fog: num('fog', 0),
  bokeh: num('bokeh', 0),
  rays: num('rays', 0),
  zoom: num('zoom', 0),
  diffuse: num('diffuse', 0),
  difdir: num('difdir', 45),
  diftight: num('diftight', 0.75),
  fogspeed: num('fogspeed', 0.2),
  fogscale: num('fogscale', 1),
  fogdensity: num('fogdensity', 1),
  raymode: params.get('raymode') || 'add',
  raycolor: params.get('raycolor') || '', // '' = follow the dots' ink
  rayink: num('rayink', 0),
  kernel: params.get('kernel') || 'fixed',
  rayx: num('rayx', 0.5),
  rayy: num('rayy', 0.44),
  raydecay: num('raydecay', 0.899),
  raywobble: num('raywobble', 0.15),
  rayfollow: num('rayfollow', 0),
  rscale: num('rscale', 1),
  order: (params.get('order') || 'fog,bokeh,rays,zoom,diffuse').split(','),
  // ground from Figma node 206-6604 ("02. Home"): vertical #E4D2E1 → #AFAEC4
  // under a 50% white veil, pre-composited; grain black @ 0.1
  bg0: params.get('bg0') || 'F2E9F0',
  bg2: params.get('bg2') || 'D7D7E2',
  noise: num('noise', 1),
  duration: num('duration', 750),
  stagger: num('stagger', 45),
  panel: params.get('panel') !== '0',
};
const FX = ['fog', 'bokeh', 'rays', 'zoom', 'diffuse'];
const ORDERABLE = ['fog', 'bokeh', 'rays', 'zoom', 'diffuse'];
state.order = state.order.filter((n) => ORDERABLE.includes(n));
for (const n of ORDERABLE) if (!state.order.includes(n)) state.order.push(n);
const DEFAULTS = {
  seed: 'kzn', scale: 1.31, ink: '1E1E1E', alpha: 1, blend: 'normal',
  soft: 0, fuse: 0.3, difdir: 45, diftight: 0.75, fogspeed: 0.2, fogscale: 1,
  fogdensity: 1, raymode: 'add', raycolor: '', rayink: 0, rayx: 0.5,
  rayy: 0.44, raydecay: 0.899, raywobble: 0.15, rayfollow: 0, rscale: 1,
  kernel: 'fixed',
  bg0: 'F2E9F0', bg2: 'D7D7E2', noise: 1,
  duration: 750, stagger: 45, panel: true,
};

function syncURL() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) {
    if (k === 'order') {
      if (v.join(',') !== 'fog,bokeh,rays,zoom,diffuse') p.set(k, v.join(','));
      continue;
    }
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
    kernel: state.kernel,
  };
  $('kernelSel').value = state.kernel;
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
    fuse: state.fuse,
  };
  $('inkc').value = '#' + state.ink;
  $('alpha').value = state.alpha;
  $('alphaOut').textContent = state.alpha.toFixed(2);
  $('blend').value = state.blend;
  $('soft').value = state.soft;
  $('softOut').textContent = state.soft.toFixed(2);
  $('fuse').value = state.fuse;
  $('fuseOut').textContent = state.fuse.toFixed(2);
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
  for (const k of FX) {
    $(k).value = state[k];
    $(k + 'Out').textContent = state[k].toFixed(2);
  }
  $('difdir').value = state.difdir;
  $('difdirOut').textContent = state.difdir + '°';
  $('diftight').value = state.diftight;
  $('diftightOut').textContent = state.diftight.toFixed(2);
  $('fogspeed').value = state.fogspeed;
  $('fogspeedOut').textContent = state.fogspeed.toFixed(2);
  $('fogscale').value = state.fogscale;
  $('fogscaleOut').textContent = state.fogscale.toFixed(2);
  $('fogdensity').value = state.fogdensity;
  $('fogdensityOut').textContent = state.fogdensity.toFixed(2);
  $('raymode').value = state.raymode;
  $('raycolor').value = state.raycolor ? '#' + state.raycolor : '#' + state.ink;
  $('rayink').value = state.rayink;
  $('rayinkOut').textContent = state.rayink.toFixed(2);
  $('rayx').value = state.rayx;
  $('rayxOut').textContent = state.rayx.toFixed(2);
  $('rayy').value = state.rayy;
  $('rayyOut').textContent = state.rayy.toFixed(2);
  $('raydecay').value = state.raydecay;
  $('raydecayOut').textContent = state.raydecay.toFixed(3);
  $('raywobble').value = state.raywobble;
  $('raywobbleOut').textContent = state.raywobble.toFixed(2);
  $('rayfollow').value = state.rayfollow;
  $('rayfollowOut').textContent = state.rayfollow.toFixed(2);
  $('rscale').value = state.rscale;
  $('rscaleOut').textContent = state.rscale.toFixed(2) + '×';
}

function applyOrder() {
  const box = $('fxOrder');
  for (const name of state.order) box.appendChild($('fx-' + name));
}

function applyGround() {
  frame.style.background = `linear-gradient(180deg, #${state.bg0} 0%, #${state.bg2} 100%)`;
  document.querySelector('svg.noise').style.opacity = state.noise;
  $('bg0').value = '#' + state.bg0;
  $('bg2').value = '#' + state.bg2;
  $('noiseAmt').value = state.noise;
  $('noiseOut').textContent = state.noise.toFixed(2);
  logo.refreshInk();
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
slider('fuse', 'fuse', applyDots);
slider('duration', 'duration', applyFormation);
slider('stagger', 'stagger', applyFormation);
for (const k of FX) slider(k, k, applyFx);
slider('difdir', 'difdir', applyFx);
slider('diftight', 'diftight', applyFx);
slider('fogspeed', 'fogspeed', applyFx);
slider('fogscale', 'fogscale', applyFx);
slider('fogdensity', 'fogdensity', applyFx);
slider('rayink', 'rayink', applyFx);
slider('rayx', 'rayx', applyFx);
slider('rayy', 'rayy', applyFx);
slider('raydecay', 'raydecay', applyFx);
slider('raywobble', 'raywobble', applyFx);
slider('rayfollow', 'rayfollow', applyFx);
slider('rscale', 'rscale', applyFx);
$('raymode').addEventListener('change', () => {
  state.raymode = $('raymode').value;
  applyFx();
  syncURL();
});
$('raycolor').addEventListener('input', () => {
  state.raycolor = $('raycolor').value.slice(1);
  applyFx();
  syncURL();
});
$('rayUseInk').onclick = () => {
  state.raycolor = '';
  applyFx();
  syncURL();
};
$('kernelSel').addEventListener('change', () => {
  state.kernel = $('kernelSel').value;
  applyFormation();
  syncURL();
});
slider('noiseAmt', 'noise', applyGround);

for (const btn of document.querySelectorAll('button.up'))
  btn.addEventListener('click', () => {
    const name = btn.dataset.fx;
    const i = state.order.indexOf(name);
    if (i > 0) {
      state.order.splice(i, 1);
      state.order.splice(i - 1, 0, name);
      applyOrder();
      applyFx();
      syncURL();
    }
  });

for (const id of ['bg0', 'bg2'])
  $(id).addEventListener('input', () => {
    state[id] = $(id).value.slice(1);
    applyGround();
    syncURL();
  });
$('groundReset').onclick = () => {
  Object.assign(state, { bg0: 'F2E9F0', bg2: 'D7D7E2', noise: 1 });
  applyGround();
  syncURL();
};

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

// --- fps: renders per second, straight from the renderer (0 when idle) ----
let lastDraws = 0;
setInterval(() => {
  const d = logo.draws;
  const fps = d - lastDraws;
  lastDraws = d;
  $('fps').textContent = fps > 0 ? fps + ' fps' : '';
}, 1000);

// --- boot -----------------------------------------------------------------
logo.setAttribute('seed', state.seed);
applyFormation();
applyDots();
applyFx();
applyOrder();
applyGround();
applyPanel();
logo.intro = INTRO;
for (let i = 0, n = num('step', 0); i < n; i++) logo.shuffle();
