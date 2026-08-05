// kzn-logo — demo app. Wires the controls to <kzn-logo> and mirrors the
// state into the URL, so any configuration is a shareable / screenshotable
// link (e.g. ?aspect=wide&grid=1&theme=dark&seed=kzn).

import './src/element.js';
import { defaults } from './src/core.js';
import { toSVG } from './src/svg.js';
import { MARK } from './src/core.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const logo = $('logo');

const params = new URLSearchParams(location.search);
const demoState = {
  aspect: params.get('aspect') || 'mark',
  theme: params.get('theme') || 'light',
  grid: params.get('grid') === '1',
  seed: params.get('seed') || 'kzn',
  placement: params.get('placement') || defaults.placement,
  motion: params.get('motion') || 'glide',
  duration: +(params.get('duration') || 750),
  stagger: +(params.get('stagger') || 45),
  easing: params.get('easing') || 'cubic',
  gap: +(params.get('gap') || defaults.gap),
  spread: +(params.get('spread') || defaults.spread),
  count: +(params.get('count') || defaults.count),
  step: +(params.get('step') || 0),
};

const ASPECTS = {
  mark: 307.2609 / 265.7392,
  square: 1,
  wide: 16 / 9,
  tall: 9 / 16,
  ultra: 21 / 9,
};

function syncURL() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(demoState))
    if (v !== '' && v !== false) p.set(k, v === true ? '1' : v);
  history.replaceState(null, '', '?' + p.toString());
}

function applyTheme() {
  document.documentElement.dataset.theme = demoState.theme;
  $('theme').textContent = demoState.theme === 'light' ? 'dark ◐' : 'light ◑';
}

function applyAspect() {
  const free = demoState.aspect === 'free';
  stage.classList.toggle('free', free);
  if (!free) {
    const ar = ASPECTS[demoState.aspect] || ASPECTS.mark;
    // width + aspect-ratio only — height always derives, nothing conflicts
    stage.style.aspectRatio = String(ar);
    stage.style.width =
      ar >= 1 ? '100%' : `min(100%, calc(min(66vh, 600px) * ${ar}))`;
  } else {
    stage.style.aspectRatio = '';
    stage.style.width = '';
  }
  for (const b of document.querySelectorAll('[data-aspect]'))
    b.classList.toggle('on', b.dataset.aspect === demoState.aspect);
}

function applyOptions() {
  logo.options = {
    placement: demoState.placement,
    gap: demoState.gap,
    spread: demoState.spread,
    count: demoState.count,
    motion: demoState.motion,
    duration: demoState.duration,
    stagger: demoState.stagger,
    easing: demoState.easing,
  };
  logo.toggleAttribute('grid', demoState.grid);
  $('grid').classList.toggle('on', demoState.grid);
  $('gapOut').textContent = demoState.gap.toFixed(2);
  $('spreadOut').textContent = demoState.spread.toFixed(2);
  $('durOut').textContent = demoState.duration + 'ms';
  $('stagOut').textContent = demoState.stagger + 'ms';
}

// --- fps meter (measures real frame rate across a transition) -------------
let fpsRaf = 0;
function measureFPS() {
  cancelAnimationFrame(fpsRaf);
  const t0 = performance.now();
  let frames = 0;
  const loop = () => {
    frames++;
    fpsRaf = requestAnimationFrame(loop);
  };
  fpsRaf = requestAnimationFrame(loop);
  logo.addEventListener(
    'kzn-settle',
    () => {
      cancelAnimationFrame(fpsRaf);
      const dt = (performance.now() - t0) / 1000;
      if (dt > 0.15)
        $('stats').textContent =
          `seed ${logo.seed} · ${Math.round(frames / dt)} fps`;
    },
    { once: true }
  );
}

// --- wiring ---------------------------------------------------------------
$('shuffle').addEventListener('click', () => {
  measureFPS();
  logo.shuffle();
});
$('rest').addEventListener('click', () => {
  measureFPS();
  logo.rest();
});
logo.addEventListener('kzn-shuffle', (e) => {
  demoState.step = e.detail.step;
  $('stats').textContent = `seed ${e.detail.seed}`;
  syncURL();
});

$('seed').value = demoState.seed;
$('seed').addEventListener('change', () => {
  demoState.seed = $('seed').value || 'kzn';
  logo.setAttribute('seed', demoState.seed);
  syncURL();
});

for (const b of document.querySelectorAll('[data-aspect]'))
  b.addEventListener('click', () => {
    demoState.aspect = b.dataset.aspect;
    applyAspect();
    syncURL();
  });

$('theme').addEventListener('click', () => {
  demoState.theme = demoState.theme === 'light' ? 'dark' : 'light';
  applyTheme();
  syncURL();
});

$('grid').addEventListener('click', () => {
  demoState.grid = !demoState.grid;
  applyOptions();
  syncURL();
});

$('placement').value = demoState.placement;
$('placement').addEventListener('change', () => {
  demoState.placement = $('placement').value;
  applyOptions();
  syncURL();
});

$('motion').value = demoState.motion;
$('motion').addEventListener('change', () => {
  demoState.motion = $('motion').value;
  applyOptions();
  syncURL();
});
$('easing').value = demoState.easing;
$('easing').addEventListener('change', () => {
  demoState.easing = $('easing').value;
  applyOptions();
  syncURL();
});

const slider = (id, key, parse = parseFloat) => {
  $(id).value = demoState[key];
  $(id).addEventListener('input', () => {
    demoState[key] = parse($(id).value);
    applyOptions();
    syncURL();
  });
};
slider('gap', 'gap');
slider('spread', 'spread');
slider('duration', 'duration', (v) => +v);
slider('stagger', 'stagger', (v) => +v);
slider('count', 'count', (v) => +v);

const download = (name, text) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};
$('dlMark').addEventListener('click', () =>
  download('kaizen-mark.svg', toSVG(MARK, { ink: getInk() }))
);
$('dlCurrent').addEventListener('click', () =>
  download(`kaizen-${logo.seed.replace('#', '-')}.svg`, logo.exportSVG({ ink: getInk() }))
);
$('copyLink').addEventListener('click', async () => {
  await navigator.clipboard.writeText(location.href);
  $('copyLink').textContent = 'copied ✓';
  setTimeout(() => ($('copyLink').textContent = 'copy link'), 1200);
});

const getInk = () =>
  getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();

// --- boot -----------------------------------------------------------------
applyTheme();
applyAspect();
logo.setAttribute('seed', demoState.seed);
applyOptions();
if (demoState.step > 0) {
  // reproduce a linked formation without animating through the sequence
  logo.shuffle(demoState.seed);
  for (let i = 1; i < demoState.step; i++) logo.shuffle();
}

// geometry probe for QA: ?debug=1 appends measured px + cell data to the page
if (params.get('debug')) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const svg = logo.shadowRoot.querySelector('svg');
      const sr = stage.getBoundingClientRect();
      const vr = svg.getBoundingClientRect();
      const f = logo.formation;
      const pre = document.createElement('pre');
      pre.id = 'debug';
      pre.textContent = JSON.stringify({
        stage: [sr.x, sr.y, sr.width, sr.height].map((n) => +n.toFixed(1)),
        svg: [vr.x, vr.y, vr.width, vr.height].map((n) => +n.toFixed(1)),
        viewBox: svg.getAttribute('viewBox'),
        seed: logo.seed,
        dots: f?.dots?.map((d) => d.map((n) => +n.toFixed(3))),
      });
      document.body.appendChild(pre);
    })
  );
}
