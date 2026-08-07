// kzn-logo — site test environment. Recreates the Figma hero (node 179-3924):
// the production gradient + noise plate, with the authored dot composition as
// the opening state — Signal #FEA021 at 10%, blend difference, heavy soft
// edge (the comp's 100px layer blur). Click disperses the dots into
// engine-generated constellations solved for the live window, independent of
// the authored opening. Base frame 1440×880; drag the corner handle, `reset`
// restores base. URL params override anything, e.g.
//   ?fog=1&bokeh=1  (treatment stack)   ?alpha=.2&blend=normal   ?w=390&h=844

import './src/element.js';

const params = new URLSearchParams(location.search);
const logo = document.getElementById('logo');
const frame = document.getElementById('frame');
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

// the authored hero composition (measured from Figma), viewport fractions,
// kernel (nearest center) first; r as a fraction of viewport height
const INTRO = {
  r: 0.12728, // 112.0085px on the 880-tall comp
  dots: [
    [0.5, 0.44207], //     top middle — this comp's reacher
    [0.5, 0.77674],
    [0.17362, 0.44207],
    [0.82638, 0.44207],
    [0.17362, 0.97903], // bottom pair sits half off the canvas
    [0.82638, 0.97903],
  ],
};

if (params.get('renderer') === 'svg') logo.removeAttribute('renderer');
if (params.get('seed')) logo.setAttribute('seed', params.get('seed'));
if (params.get('grid') === '1') logo.setAttribute('grid', '');

// generated constellations: scale 1.31 makes engine dots (0.3875 cell) land
// at the intro's 112px — dispersal keeps the authored dot size
logo.options = { scale: num('scale', 1.31) };
logo.appearance = {
  ink: '#' + (params.get('ink') || 'FEA021'), // Signal
  opacity: num('alpha', 0.1),
  blend: params.get('blend') || 'difference',
  soft: num('soft', 0.35), // ≈ the comp's 100px layer blur
};
logo.effects = {
  // the Figma comp carries no treatment stack — flat by default, params enable
  fog: num('fog', 0),
  bokeh: num('bokeh', 0),
  rays: num('rays', 0),
  zoom: num('zoom', 0),
  diffuse: num('diffuse', 0),
  grain: num('grain', 0),
  tint: num('tint', 0),
  tintColor: '#' + (params.get('tintc') || 'AFA8D8'),
  background: GROUND,
};
logo.intro = INTRO;
for (let i = 0, n = num('step', 0); i < n; i++) logo.shuffle();

if (params.get('w')) frame.style.width = params.get('w') + 'px';
if (params.get('h')) frame.style.height = params.get('h') + 'px';

document.getElementById('reset').onclick = () => {
  frame.style.width = '1440px';
  frame.style.height = '880px';
};
document.getElementById('intro').onclick = () => logo.rest();

new ResizeObserver(([e]) => {
  document.getElementById('size').textContent =
    `${Math.round(e.contentRect.width)} × ${Math.round(e.contentRect.height)}`;
}).observe(frame);
