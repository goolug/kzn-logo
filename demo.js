// kzn-logo — demo app. Wires the controls to <kzn-logo> and mirrors the
// state into the URL, so any configuration is a shareable / screenshotable
// link (e.g. ?renderer=webgl&blur=40&aspect=wide&theme=dark&seed=kzn).

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
  theme:
    params.get('theme') ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
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
  renderer: params.get('renderer') || 'svg',
  scale: +(params.get('scale') || 1),
  fog: +(params.get('fog') || 0),
  bokeh: +(params.get('bokeh') || 0),
  rays: +(params.get('rays') || 0),
  zoom: +(params.get('zoom') || 0),
  diffuse: +(params.get('diffuse') || 0),
  grain: +(params.get('grain') || 0),
  tint: +(params.get('tint') || 0),
  tintc: params.get('tintc') || 'AFA8D8', // hex without '#'
};
const FX_KEYS = ['fog', 'bokeh', 'rays', 'zoom', 'diffuse', 'grain'];

const ASPECTS = {
  mark: 307.2609 / 265.7392,
  square: 1,
  wide: 16 / 9,
  tall: 9 / 16,
  ultra: 21 / 9,
};

function syncURL() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(demoState)) {
    if (k === 'scale' && v === 1) continue;
    if (v !== '' && v !== false && v !== 0) p.set(k, v === true ? '1' : v);
  }
  history.replaceState(null, '', '?' + p.toString());
}

function applyTheme() {
  document.documentElement.dataset.theme = demoState.theme;
  $('theme').textContent = demoState.theme === 'light' ? 'dark ◐' : 'light ◑';
  logo.refreshInk();
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

function applyRenderer() {
  if (demoState.renderer === 'webgl') logo.setAttribute('renderer', 'webgl');
  else logo.removeAttribute('renderer');
  $('renderer').value = demoState.renderer;
  $('fxRows').classList.toggle('dim', demoState.renderer !== 'webgl');
  // reflect what actually mounted (webgl may fall back to svg)
  requestAnimationFrame(() => {
    const active = logo.dataset.rendererActive || 'svg';
    if (demoState.renderer === 'webgl' && active === 'svg')
      $('stats').textContent = 'webgl unavailable — flat fallback';
  });
}

function applyEffects() {
  logo.effects = {
    fog: demoState.fog,
    bokeh: demoState.bokeh,
    rays: demoState.rays,
    zoom: demoState.zoom,
    diffuse: demoState.diffuse,
    grain: demoState.grain,
    tint: demoState.tint,
    tintColor: '#' + demoState.tintc,
  };
  for (const k of FX_KEYS) {
    $(k).value = demoState[k];
    $(k + 'Out').textContent = demoState[k].toFixed(2);
  }
  $('tintOut').textContent = demoState.tint.toFixed(2);
  $('tintc').value = '#' + demoState.tintc;
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
    scale: demoState.scale,
  };
  logo.toggleAttribute('grid', demoState.grid);
  $('grid').classList.toggle('on', demoState.grid);
  $('scaleOut').textContent = demoState.scale.toFixed(2) + '×';
  $('gapOut').textContent = demoState.gap.toFixed(2);
  $('spreadOut').textContent = demoState.spread.toFixed(2);
  $('countOut').textContent = demoState.count;
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

const select = (id, key, apply) => {
  $(id).value = demoState[key];
  $(id).addEventListener('change', () => {
    demoState[key] = $(id).value;
    apply();
    syncURL();
  });
};
select('placement', 'placement', applyOptions);
select('motion', 'motion', applyOptions);
select('easing', 'easing', applyOptions);
select('renderer', 'renderer', applyRenderer);

const slider = (id, key, apply, parse = parseFloat) => {
  $(id).value = demoState[key];
  $(id).addEventListener('input', () => {
    demoState[key] = parse($(id).value);
    apply();
    syncURL();
  });
};
slider('gap', 'gap', applyOptions);
slider('spread', 'spread', applyOptions);
slider('duration', 'duration', applyOptions, (v) => +v);
slider('stagger', 'stagger', applyOptions, (v) => +v);
slider('count', 'count', applyOptions, (v) => +v);
slider('scaleR', 'scale', applyOptions);
for (const k of FX_KEYS) slider(k, k, applyEffects);
slider('tint', 'tint', applyEffects);

$('scaleReset').addEventListener('click', () => {
  demoState.scale = 1;
  $('scaleR').value = 1;
  applyOptions();
  syncURL();
});

const setStack = (on) => {
  for (const k of FX_KEYS) demoState[k] = on ? 1 : 0;
  if (!on) demoState.tint = 0;
  if (on && demoState.renderer !== 'webgl') {
    demoState.renderer = 'webgl';
    applyRenderer();
  }
  applyEffects();
  syncURL();
};
$('stackOn').addEventListener('click', () => setStack(true));
$('stackOff').addEventListener('click', () => setStack(false));

$('tintc').addEventListener('input', () => {
  demoState.tintc = $('tintc').value.slice(1);
  applyEffects();
  syncURL();
});

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
  download(
    `kaizen-${logo.seed.replace('#', '-')}.svg`,
    logo.exportSVG({ ink: getInk() })
  )
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
applyRenderer();
applyOptions();
applyEffects();
if (demoState.step > 0) {
  // reproduce a linked formation without animating through the sequence
  logo.shuffle(demoState.seed);
  for (let i = 1; i < demoState.step; i++) logo.shuffle();
}

// geometry probe for QA: ?debug=1 appends measured px + cell data to the page
if (params.get('debug')) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const el = logo.shadowRoot.querySelector(
        logo.dataset.rendererActive === 'webgl' ? 'canvas' : 'svg'
      );
      const sr = stage.getBoundingClientRect();
      const vr = el.getBoundingClientRect();
      const f = logo.formation;
      const pre = document.createElement('pre');
      pre.id = 'debug';
      const overflowers = [...document.querySelectorAll('*')]
        .filter((e) => e.getBoundingClientRect().width > innerWidth + 1)
        .map(
          (e) =>
            `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${[...e.classList].join('.')}=${Math.round(e.getBoundingClientRect().width)}`
        )
        .slice(0, 10);
      pre.textContent = JSON.stringify({
        renderer: logo.dataset.rendererActive,
        innerWidth,
        overflowers,
        stage: [sr.x, sr.y, sr.width, sr.height].map((n) => +n.toFixed(1)),
        view: [vr.x, vr.y, vr.width, vr.height].map((n) => +n.toFixed(1)),
        seed: logo.seed,
        dots: f?.dots?.map((d) => d.map((n) => +n.toFixed(3))),
      });
      document.body.appendChild(pre);
    })
  );
}
