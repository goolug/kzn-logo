// kzn-logo — WebGL2 renderer. Same contract as the SVG dynamic renderer,
// same formations, same motion math — plus the treated look for page
// backgrounds and hero moments.
//
// With every effect at 0 the output is pixel-parity with the flat SVG:
// antialiased currentColor dots on transparency, straight to screen.
//
// The treatment chain replicates, behaviorally, the Unicorn Studio
// prototype (project "Copy of kzn B&W"): fog → bokeh → god rays → zoom
// blur → diffuse. Parameter values (radii, speeds, centers, decay, grain)
// were extracted from that scene's data; the GLSL below is an original
// clean-room implementation of these standard techniques — no Unicorn
// Studio shader code is copied. The signature of the stack: the center
// stays sharp while the field dissolves toward the edges — gravity,
// rendered as optics.
//
// Perf posture: fragment SDF scene over ≤8 dots, quarter/half-resolution
// blur buffers, DPR capped at 2, renders continuously only while the fog
// drifts or a tween runs (reduced-motion freezes the drift).

import { assignTargets } from './core.js';
import { buildTweens, sampleTweens } from './motion.js';

const VS = `#version 300 es
void main() {
  vec2 v = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(v * 2.0 - 1.0, 0.0, 1.0);
}`;

const LIB = `
  const float PI = 3.14159265359;
  float ign(vec2 px) { // interleaved gradient noise (standard formula)
    return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));
  }
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  vec3 aces(vec3 x) { // ACES filmic curve (Narkowicz), public domain math
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }
`;

// value-noise fbm — original implementation; drives the fog field.
// Time is the noise's DEPTH, not a translation: two seeded slices crossfade,
// so clouds form and dissolve in place — no sideways drift.
const FBM = `
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1, 0));
    float c = hash21(i + vec2(0, 1));
    float d = hash21(i + vec2(1, 1));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y) * 2.0 - 1.0;
  }
  float vslice(vec2 p, float z) {
    float fz = floor(z);
    float u = z - fz;
    u = u * u * (3.0 - 2.0 * u);
    return mix(vnoise(p + fz * 17.17), vnoise(p + (fz + 1.0) * 17.17), u);
  }
  float fbm(vec2 p, float t) {
    mat2 rot = mat2(0.6, -0.8, 0.8, 0.6);
    float n = 0.0, amp = 0.55;
    for (int i = 0; i < 5; i++) {
      n += vslice(p + float(i) * 7.31, t + float(i) * 0.37) * amp;
      p = rot * p * 1.9;
      amp *= 0.55;
    }
    return n;
  }
  // fog field: centered like the source scene, sigmoid-compressed.
  // fscale zooms the clouds, density is the mask gain (patchy ↔ even).
  float fogField(vec2 uv, float ar, float t, float fscale, float density) {
    vec2 aspect = vec2(ar, 1.0);
    float mult = 10.0 * (0.648 / ((ar + 1.0) * 0.5)) * fscale;
    vec2 st = (uv * aspect - vec2(0.504, 0.564) * aspect) * mult;
    float c = cos(1.0128), s = sin(1.0128);
    st = mat2(c, -s, s, c) * st;
    float n = fbm(st, t * 3.0);
    n = n / (1.0 + abs(n));
    return clamp(n * 2.0 * density, 0.0, 1.0);
  }
`;

// dots + construction grid, drawn as one signed-distance field
const SCENE_FS = `#version 300 es
precision highp float;
uniform vec2 uRes;      // px
uniform vec2 uHalf;     // view half-size, in cells
uniform vec3 uDots[8];  // x, y (cells, center origin, y down), radius
uniform int uCount;
uniform vec4 uInk;
uniform vec4 uBg;
uniform float uMode;    // 0 transparent · 1 composite on ground · 2 coverage-on-black
uniform float uGrid;
uniform float uBgMode;      // 0 flat uBg · 1 vertical 3-stop gradient
uniform vec3 uBgStops[3];
uniform float uBgMid;       // position of the middle stop, 0..1 from the top
uniform float uInkAlpha;    // dot layer opacity (Figma comp: 0.1)
uniform int uBlend;         // 0 normal · 1 difference · 2 multiply · 3 screen
uniform float uSoft;        // edge feather in cells (≈ the comp's layer blur)
uniform float uFuse;        // metaball smoothing radius in cells — 0 = hard union
out vec4 outColor;
float smin(float a, float b, float k) { // polynomial smooth minimum
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
vec3 bgAt(float t) { // t: 0 at the top of the canvas
  if (uBgMode < 0.5) return uBg.rgb;
  return t < uBgMid
    ? mix(uBgStops[0], uBgStops[1], t / max(uBgMid, 1e-4))
    : mix(uBgStops[1], uBgStops[2], (t - uBgMid) / max(1.0 - uBgMid, 1e-4));
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  vec2 p = vec2(uv.x * uHalf.x, -uv.y * uHalf.y);
  float pxPerCell = uRes.x / (2.0 * uHalf.x);
  float aa = 1.0 / pxPerCell;

  float d = 1e5;
  for (int i = 0; i < 8; i++) {
    if (i >= uCount) break;
    float di = length(p - uDots[i].xy) - uDots[i].z;
    d = uFuse > 1e-4 ? smin(d, di, uFuse) : min(d, di);
  }
  float cov = 1.0 - smoothstep(-aa - uSoft, aa + uSoft, d);

  float gridA = 0.0;
  if (uGrid > 0.5) {
    float lw = max(uHalf.x, uHalf.y) * 2.0 / 420.0; // hairline, as in SVG
    vec2 nearest = vec2(floor(p.x + 0.5), floor(p.y + 0.5));
    vec2 dist = abs(p - nearest);
    float lx = (abs(nearest.x) <= uHalf.x - 0.001)
      ? 1.0 - smoothstep(lw * 0.5, lw * 0.5 + aa, dist.x) : 0.0;
    float ly = (abs(nearest.y) <= uHalf.y - 0.001)
      ? 1.0 - smoothstep(lw * 0.5, lw * 0.5 + aa, dist.y) : 0.0;
    float cross = (1.0 - smoothstep(lw * 2.4, lw * 2.4 + aa, length(p))) * 0.5;
    gridA = max(max(lx, ly) * 0.18, cross);
  }

  if (uMode > 1.5) {
    outColor = vec4(vec3(cov), 1.0); // pure dot light — feeds the fog
  } else if (uMode > 0.5) {
    vec3 ground = bgAt(1.0 - gl_FragCoord.y / uRes.y);
    vec3 blended = uBlend == 1 ? abs(ground - uInk.rgb)
      : uBlend == 2 ? ground * uInk.rgb
      : uBlend == 3 ? 1.0 - (1.0 - ground) * (1.0 - uInk.rgb)
      : uInk.rgb;
    vec3 col = mix(ground, blended, cov * uInkAlpha);
    outColor = vec4(mix(col, uInk.rgb, gridA), 1.0);
  } else {
    float a = cov * uInkAlpha;
    outColor = vec4(uInk.rgb * a + uInk.rgb * gridA * (1.0 - a),
                    min(1.0, a + gridA * (1.0 - a))); // premultiplied
  }
}`;

// the drifting fbm field, computed ONCE per frame at quarter res — the blur
// and composite passes sample this texture instead of re-evaluating noise
const FIELD_FS = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uFogScale;
uniform float uFogDensity;
out vec4 outColor;
${LIB}
${FBM}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float f = fogField(uv, uRes.x / uRes.y, uTime, uFogScale, uFogDensity);
  outColor = vec4(f, f, f, 1.0);
}`;

// fog blur: exponential-falloff directional blur whose radius is modulated
// by the fog field (radius 1%–3% of the frame, as in the source scene)
const FOGBLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform sampler2D uField;
uniform vec2 uRes;
uniform vec2 uDir;
uniform float uAmt;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float ar = uRes.x / uRes.y;
  float f = texture(uField, uv).r;
  float radius = mix(0.01, 0.03, clamp(8.0 * f * 0.35, 0.0, 1.0)) * uAmt;
  vec2 dir = normalize(uDir) / vec2(ar, 1.0);
  vec4 acc = texture(uTex, uv);
  float total = 1.0;
  for (int i = 1; i <= 8; i++) {
    float w = exp(-float(i) / 3.0);
    float off = radius * float(i) / 8.0;
    acc += (texture(uTex, uv + off * dir) + texture(uTex, uv - off * dir)) * w;
    total += 2.0 * w;
  }
  outColor = acc / total;
}`;

// fog composite: the halo field (blurred dot coverage) is ACES-toned,
// grained, masked by the drifting fbm — then pushes pixels toward the ink.
// Clipped to the dots' own light: the background itself never fogs.
// (On the prototype's black ground this reduces to the same additive math.)
const FOGCOMP_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;   // sharp composite
uniform sampler2D uBlur;  // blurred dot coverage — the halo field
uniform sampler2D uField; // the precomputed fbm field
uniform vec2 uRes;
uniform float uTime;
uniform float uFog;
uniform float uGrain;
uniform vec4 uInk;
uniform vec4 uBg;
uniform float uBgMode;
uniform vec3 uBgStops[3];
uniform float uBgMid;
out vec4 outColor;
${LIB}
vec3 bgAt(float t) {
  if (uBgMode < 0.5) return uBg.rgb;
  return t < uBgMid
    ? mix(uBgStops[0], uBgStops[1], t / max(uBgMid, 1e-4))
    : mix(uBgStops[1], uBgStops[2], (t - uBgMid) / max(1.0 - uBgMid, 1e-4));
}
uniform float uOverlay; // 1 = transparent dot-layer pipeline (CSS owns the ground)
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 base = texture(uTex, uv);
  float halo = texture(uBlur, uv).r;
  float mask = texture(uField, uv).r * uFog;
  float presence = smoothstep(0.0, 0.12, halo);
  float grain = hash21(uv * uRes.xy / 100.0 + fract(uTime));
  float light = aces(vec3(halo * 0.8)).r + grain * 0.05 * uGrain;
  float L = light * mask * presence;
  if (uOverlay > 0.5) {
    // premultiplied: the fog adds the ink's own light to the dot layer;
    // compositing against the page ground happens in CSS
    outColor = vec4(base.rgb + uInk.rgb * L, min(1.0, base.a + L));
  } else {
    vec3 ground = bgAt(1.0 - uv.y);
    outColor = vec4(base.rgb + (uInk.rgb - ground) * L, 1.0);
  }
}`;

// bokeh: golden-angle disc blur, dithered by gradient noise
const BOKEH_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uAmt; // radius scale; source scene: 0.1
out vec4 outColor;
${LIB}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float ar = uRes.x / uRes.y;
  float radius = 0.1 * uAmt * 0.25;
  float rot = ign(gl_FragCoord.xy) * 2.0 * PI;
  vec4 acc = vec4(0.0);
  const int N = 16;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5) / float(N);
    float a = float(i) * 2.39996323 + rot; // golden angle
    vec2 off = vec2(cos(a) / ar, sin(a)) * sqrt(t) * radius;
    acc += texture(uTex, uv + off);
  }
  outColor = acc / float(N);
}`;

// god rays: luminance-weighted samples marching toward the light, additive
const RAYS_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uAmt;
uniform vec2 uLight;   // light position, uv space (source scene: 0.5, 0.5574)
uniform float uDecay;  // per-step falloff — the rays' length (source: 0.899)
uniform float uWobble; // sinuous perturbation of the march (source: 0.15)
out vec4 outColor;
${LIB}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  const float N = 48.0;
  vec2 stepv = (uLight - uv) / N * 0.2775;
  float noise = ign(gl_FragCoord.xy);
  vec2 s = uv + stepv * noise;
  vec2 perp = vec2(-stepv.y, stepv.x);
  float weight = 1.0;
  vec3 acc = vec3(0.0);
  for (float i = 0.0; i < N; i++) {
    float th = i / N;
    s += stepv + perp * th * sin(noise * 0.25 * (1.0 + th) * 50.0) * uWobble;
    vec3 samp = texture(uTex, s).rgb;
    float lum = dot(samp, vec3(0.299, 0.587, 0.114));
    acc += samp * smoothstep(-0.1, 0.0, lum) * weight;
    weight *= uDecay;
    if (weight < 0.05) break;
  }
  outColor = vec4(acc / N * 2.8 * uAmt, 1.0);
}`;

// composite the ray shafts over the frame — the mode decides whether light
// is added (dark grounds) or taken away (light grounds)
const ADD_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;  // base
uniform sampler2D uAddT; // ray shafts
uniform vec2 uRes;
uniform int uMode;       // 0 add · 1 screen · 2 dodge · 3 softlight
                         // 4 multiply · 5 burn · 6 subtract
uniform float uRayInk;   // 0 = shafts keep scene light, 1 = shafts are ink
uniform vec4 uInkC;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 b = texture(uTex, uv);
  vec3 L0 = texture(uAddT, uv).rgb;
  float S = clamp(dot(L0, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
  vec3 L = clamp(mix(L0, uInkC.rgb * S, uRayInk), 0.0, 1.0);
  vec3 c;
  if (uMode == 1)      c = 1.0 - (1.0 - b.rgb) * (1.0 - L);
  else if (uMode == 2) c = b.rgb / max(1.0 - L, vec3(0.001));
  else if (uMode == 3) c = b.rgb + L * (sqrt(max(b.rgb, 0.0)) - b.rgb);
  else if (uMode == 4) c = b.rgb * (1.0 - L);
  else if (uMode == 5) c = 1.0 - (1.0 - b.rgb) / max(1.0 - vec3(S), vec3(0.001));
  else if (uMode == 6) c = b.rgb - L;
  else                 c = b.rgb + L;
  outColor = vec4(clamp(c, 0.0, 1.0), min(1.0, b.a + S));
}`;

// zoom blur: radial streaks toward the center — gated OFF near the center
// (spread 0.23), so the crosshair region stays untouched
const ZOOM_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uAmt;
out vec4 outColor;
${LIB}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float ar = uRes.x / uRes.y;
  vec2 center = vec2(0.5012, 0.5648);
  float d = distance(uv * vec2(ar, 1.0), center * vec2(ar, 1.0));
  float near = max(0.0, 1.0 - d * 4.0 * (1.0 - 0.23));
  float gate = max(0.0, 0.5 - near * near); // zero at center, on toward edges
  vec2 toC = (center - uv) * 0.22 * uAmt * gate;
  float noise = ign(gl_FragCoord.xy);
  vec4 acc = vec4(0.0);
  const int N = 20;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + noise) / float(N);
    acc += texture(uTex, uv + toC * t);
  }
  outColor = acc / float(N);
}`;

// diffuse: static random scatter, also zero at the center (tightness 0.75) —
// dots melt into the field the farther they sit from the gravity well
const DIFFUSE_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uAmt;
uniform float uDifAngle; // scatter drift direction, radians (prototype: 45°)
uniform float uDifTight; // how close to center stays sharp (prototype: 0.75)
out vec4 outColor;
${LIB}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float ar = uRes.x / uRes.y;
  float dctr = distance(uv * vec2(ar, 1.0), vec2(0.5 * ar, 0.5));
  float near = max(0.0, 1.0 - dctr * 4.0 * (1.0 - uDifTight));
  float gate = max(0.0, 0.5 - near * near);
  float amount = 1.068 * uAmt * gate;
  vec2 dir = vec2(cos(uDifAngle) / ar, sin(uDifAngle)) * 0.7071 * amount * 0.4;
  vec4 acc = vec4(0.0);
  const int N = 12;
  float used = 0.0;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5) / float(N);
    if (t > 0.84) break;
    float r1 = hash21(uv + t);
    float r2 = hash21(uv + t * 2.0);
    float r3 = hash21(uv + t * 3.0);
    vec2 pt = (vec2(r1, r2) * 2.0 - 1.0) * mix(1.0, r3, 0.8);
    acc += texture(uTex, uv + pt * dir);
    used += 1.0;
  }
  outColor = used > 0.0 ? acc / used : texture(uTex, uv);
}`;

// final grade: optional duotone toward a tint (for non-B&W colorways)
const GRADE_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uTintAmt;
uniform vec3 uTintInk;
uniform vec3 uTintBg;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 c = texture(uTex, uv);
  float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  c.rgb = mix(c.rgb, mix(uTintInk, uTintBg, lum) * max(c.a, 0.0001), uTintAmt);
  outColor = c; // alpha passes through — transparent overlays stay transparent
}`;

/** '#rrggbb' | 'rgb(a)' string → [r,g,b,a] in 0..1 */
export function parseColor(str) {
  if (!str) return [0, 0, 0, 1];
  str = str.trim();
  if (str[0] === '#') {
    const h = str.slice(1);
    const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join('') : h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  }
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (!m) return [0, 0, 0, 1];
  const v = m[1].split(',').map(parseFloat);
  return [v[0] / 255, v[1] / 255, v[2] / 255, v.length > 3 ? v[3] : 1];
}

/** The extracted treatment defaults — the prototype's design values. */
export const KAIZEN_STACK = {
  fog: 1,
  bokeh: 1,
  rays: 1,
  zoom: 1,
  diffuse: 1,
  grain: 1,
  tint: 0,
  tintColor: '#AFA8D8',
  background: null,
};

const ZERO_STACK = Object.fromEntries(
  Object.keys(KAIZEN_STACK).map((k) => [k, typeof KAIZEN_STACK[k] === 'number' ? 0 : KAIZEN_STACK[k]])
);

const BLEND_IDS = { normal: 0, difference: 1, multiply: 2, screen: 3 };
const RAY_MODES = {
  add: 0, screen: 1, dodge: 2, softlight: 3, multiply: 4, burn: 5, subtract: 6,
};

export function createWebGLRenderer(canvas, host, opts = {}) {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!gl) return null;

  function compile(fsSrc) {
    const p = gl.createProgram();
    for (const [type, src] of [
      [gl.VERTEX_SHADER, VS],
      [gl.FRAGMENT_SHADER, fsSrc],
    ]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error('kzn-logo shader: ' + gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error('kzn-logo link: ' + gl.getProgramInfoLog(p));
    const uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      uniforms[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
    }
    return { p, u: uniforms };
  }

  const prg = {
    scene: compile(SCENE_FS),
    field: compile(FIELD_FS),
    fogBlur: compile(FOGBLUR_FS),
    fogComp: compile(FOGCOMP_FS),
    bokeh: compile(BOKEH_FS),
    rays: compile(RAYS_FS),
    add: compile(ADD_FS),
    zoom: compile(ZOOM_FS),
    diffuse: compile(DIFFUSE_FS),
    grade: compile(GRADE_FS),
  };

  const state = {
    duration: opts.duration ?? 750,
    stagger: opts.stagger ?? 45,
    easing: opts.easing ?? 'cubic',
    motion: opts.motion ?? 'glide',
    reduced:
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches,
    formation: null,
    current: [],
    anims: null,
    raf: 0,
    gridOn: false,
    onSettle: null,
    ink: [0.12, 0.12, 0.12, 1],
    bg: [1, 0.984, 0.973, 1],
    bgGrad: null, // { mid, stops: [rgb, rgb, rgb] } when the ground is a gradient
    appearance: { ink: null, opacity: 1, blend: 'normal', soft: 0, fuse: 0 },
    effects: {
      ...ZERO_STACK,
      difAngle: 45,
      difTight: 0.75,
      fogSpeed: 0.2, //   the source layer's speed
      fogScale: 1, //     cloud size (field zoom)
      fogDensity: 1, //   mask gain — patchy ↔ even
      rayX: 0.5, //       light position, fraction of width
      rayY: 0.4426, //    …fraction of height from the top (source scene value)
      rayDecay: 0.899,
      rayWobble: 0.15,
      rayFollow: 0, //    0..1 — how much the light chases the pointer
      rayMode: 'add', //  add·screen·dodge·softlight (dark grounds) — multiply·burn·subtract (light)
      rayInk: 0, //       0..1 — shafts drift from scene light to pure ink
      renderScale: 1, //  resolution factor for the whole chain
      order: null, //     pass order, e.g. ['rays','fog','bokeh','zoom','diffuse']
    },
    pxW: 0,
    pxH: 0,
    cssW: 0,
    cssH: 0,
    dpr: 1,
    draws: 0, //       frames actually rendered — an honest fps source
    offscreen: false,
    pointer: [0.5, 0.5], //  raw, 0..1 from the top-left
    mouseS: [0.5, 0.5], //   smoothed — the momentum feel
    t0: performance.now(),
  };

  // --- framebuffers: 2 full-res + 2 half-res + 2 quarter-res --------------
  const targets = {}; // name → {tex, fbo, w, h}

  function makeTarget(name, w, h) {
    if (targets[name]) {
      gl.deleteTexture(targets[name].tex);
      gl.deleteFramebuffer(targets[name].fbo);
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    targets[name] = { tex, fbo, w, h };
  }

  function allocTargets() {
    const W = state.pxW, H = state.pxH;
    const hw = Math.max(1, W >> 1), hh = Math.max(1, H >> 1);
    const qw = Math.max(1, W >> 2), qh = Math.max(1, H >> 2);
    makeTarget('fullA', W, H);
    makeTarget('fullB', W, H);
    makeTarget('halfA', hw, hh);
    makeTarget('halfB', hw, hh);
    makeTarget('quarterA', qw, qh);
    makeTarget('quarterB', qw, qh);
    makeTarget('quarterC', qw, qh); // the fog field lives here per frame
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // --- pass plumbing ------------------------------------------------------
  function bindTex(unit, tex) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  function pass(program, target, setup) {
    const t = target ? targets[target] : null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    const w = t ? t.w : state.pxW;
    const h = t ? t.h : state.pxH;
    gl.viewport(0, 0, w, h);
    gl.useProgram(program.p);
    if (program.u.uRes) gl.uniform2f(program.u.uRes, w, h);
    setup(program.u, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  const fx = () => state.effects;
  const stackActive = () =>
    ['fog', 'bokeh', 'rays', 'zoom', 'diffuse', 'grain', 'tint'].some((k) => fx()[k] > 0);

  function drawScene(target, mode) {
    const f = state.formation;
    const [vw, vh] = f.view || [f.w, f.h];
    pass(prg.scene, target, (u) => {
      gl.uniform2f(u.uHalf, vw / 2, vh / 2);
      const flat = new Float32Array(24);
      const n = Math.min(state.current.length, 8);
      for (let i = 0; i < n; i++) {
        flat[i * 3] = state.current[i][0];
        flat[i * 3 + 1] = state.current[i][1];
        flat[i * 3 + 2] = f.r;
      }
      gl.uniform3fv(u.uDots, flat);
      gl.uniform1i(u.uCount, n);
      gl.uniform4fv(u.uInk, state.ink);
      gl.uniform4fv(u.uBg, state.bg);
      gl.uniform1f(u.uMode, mode);
      gl.uniform1f(u.uGrid, state.gridOn ? 1 : 0);
      const ap = state.appearance;
      gl.uniform1f(u.uInkAlpha, ap.opacity ?? 1);
      gl.uniform1i(u.uBlend, BLEND_IDS[ap.blend] ?? 0);
      gl.uniform1f(u.uSoft, ap.soft ?? 0);
      gl.uniform1f(u.uFuse, ap.fuse ?? 0);
      bgUniforms(u);
    });
  }

  // the canvas is a transparent dot layer unless an explicit background was
  // handed to it — blending against the page happens in CSS whenever the
  // canvas doesn't own the ground
  function syncCssBlend() {
    const ap = state.appearance;
    const ownsGround = stackActive() && !!state.effects.background;
    canvas.style.mixBlendMode =
      !ownsGround && ap.blend && ap.blend !== 'normal' ? ap.blend : '';
  }

  function draw() {
    if (!state.formation || !state.pxW) return;
    state.draws++;
    if (!stackActive()) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, state.pxW, state.pxH);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      drawScene(null, 0);
      return;
    }

    const e = fx();
    const time = state.reduced
      ? 0
      : ((performance.now() - state.t0) / 1000) * 0.05 * (e.fogSpeed ?? 0.2);

    // with an explicit background the canvas owns the ground (opaque);
    // otherwise the whole chain runs transparent and CSS composites it
    const ownsGround = !!e.background;
    drawScene('fullA', ownsGround ? 1 : 0);
    let cur = 'fullA'; // name of the current full-res composite
    let spare = 'fullB';
    const swap = () => {
      [cur, spare] = [spare, cur];
    };

    // each pass is a named stage; e.order rearranges the chain freely
    const stages = {
      // fog — the dots' own light (coverage on black, quarter res) gets a
      // field-modulated exponential blur; the composite pushes pixels toward
      // the ink under the fbm mask. The field itself renders once per frame.
      fog: () => {
        if (!(e.fog > 0 || e.grain > 0)) return;
        pass(prg.field, 'quarterC', (u) => {
          gl.uniform1f(u.uTime, time);
          gl.uniform1f(u.uFogScale, e.fogScale ?? 1);
          gl.uniform1f(u.uFogDensity, e.fogDensity ?? 1);
        });
        drawScene('quarterA', 2);
        for (const [src, dst, dx, dy] of [
          ['quarterA', 'quarterB', 1, 0],
          ['quarterB', 'quarterA', 0, 1],
        ])
          pass(prg.fogBlur, dst, (u) => {
            bindTex(0, targets[src].tex);
            bindTex(1, targets.quarterC.tex);
            gl.uniform1i(u.uTex, 0);
            gl.uniform1i(u.uField, 1);
            gl.uniform2f(u.uDir, dx, dy);
            gl.uniform1f(u.uAmt, Math.max(e.fog, 0.001));
          });
        pass(prg.fogComp, spare, (u) => {
          bindTex(0, targets[cur].tex);
          bindTex(1, targets.quarterA.tex);
          bindTex(2, targets.quarterC.tex);
          gl.uniform1i(u.uTex, 0);
          gl.uniform1i(u.uBlur, 1);
          gl.uniform1i(u.uField, 2);
          gl.uniform1f(u.uTime, time);
          gl.uniform1f(u.uFog, e.fog);
          gl.uniform1f(u.uGrain, e.grain);
          gl.uniform1f(u.uOverlay, ownsGround ? 0 : 1);
          gl.uniform4fv(u.uInk, state.ink);
          gl.uniform4fv(u.uBg, state.bg);
          bgUniforms(u);
        });
        swap();
      },
      // bokeh — golden-angle disc blur at half res; replaces the frame
      bokeh: () => {
        if (!(e.bokeh > 0)) return;
        pass(prg.bokeh, 'halfA', (u) => {
          bindTex(0, targets[cur].tex);
          gl.uniform1i(u.uTex, 0);
          gl.uniform1f(u.uAmt, e.bokeh);
        });
        pass(prg.grade, spare, (u) => {
          bindTex(0, targets.halfA.tex);
          gl.uniform1i(u.uTex, 0);
          gl.uniform1f(u.uTintAmt, 0);
          gl.uniform3f(u.uTintInk, 0, 0, 0);
          gl.uniform3f(u.uTintBg, 0, 0, 0);
        });
        swap();
      },
      // god rays — half-res march toward the light, added over the frame
      rays: () => {
        if (!(e.rays > 0)) return;
        pass(prg.rays, 'halfB', (u) => {
          bindTex(0, targets[cur].tex);
          gl.uniform1i(u.uTex, 0);
          gl.uniform1f(u.uAmt, e.rays);
          // fixed light, pulled toward the (smoothed) pointer by rayFollow
          const fol = e.rayFollow ?? 0;
          const bx = e.rayX ?? 0.5;
          const by = 1 - (e.rayY ?? 0.4426); // sliders are top-down, uv is not
          const mx = state.mouseS[0];
          const my = 1 - state.mouseS[1];
          gl.uniform2f(u.uLight, bx + (mx - bx) * fol, by + (my - by) * fol);
          gl.uniform1f(u.uDecay, e.rayDecay ?? 0.899);
          gl.uniform1f(u.uWobble, e.rayWobble ?? 0.15);
        });
        pass(prg.add, spare, (u) => {
          bindTex(0, targets[cur].tex);
          bindTex(1, targets.halfB.tex);
          gl.uniform1i(u.uTex, 0);
          gl.uniform1i(u.uAddT, 1);
          gl.uniform1i(u.uMode, RAY_MODES[e.rayMode] ?? 0);
          gl.uniform1f(u.uRayInk, e.rayInk ?? 0);
          gl.uniform4fv(u.uInkC, state.ink);
        });
        swap();
      },
      // zoom blur — radial streaks, gated off near the center
      zoom: () => {
        if (!(e.zoom > 0)) return;
        pass(prg.zoom, spare, (u) => {
          bindTex(0, targets[cur].tex);
          gl.uniform1i(u.uTex, 0);
          gl.uniform1f(u.uAmt, e.zoom);
        });
        swap();
      },
      // diffuse — static scatter, sharp center / dissolved edges
      diffuse: () => {
        if (!(e.diffuse > 0)) return;
        pass(prg.diffuse, spare, (u) => {
          bindTex(0, targets[cur].tex);
          gl.uniform1i(u.uTex, 0);
          gl.uniform1f(u.uAmt, e.diffuse);
          gl.uniform1f(u.uDifAngle, ((e.difAngle ?? 45) * Math.PI) / 180);
          gl.uniform1f(u.uDifTight, e.difTight ?? 0.75);
        });
        swap();
      },
    };
    const order =
      Array.isArray(e.order) && e.order.length
        ? e.order
        : ['fog', 'bokeh', 'rays', 'zoom', 'diffuse'];
    for (const name of order) stages[name]?.();

    // grade to screen (duotone tint for non-B&W colorways, or plain blit)
    pass(prg.grade, null, (u) => {
      bindTex(0, targets[cur].tex);
      gl.uniform1i(u.uTex, 0);
      gl.uniform1f(u.uTintAmt, e.tint);
      const tc = parseColor(e.tintColor);
      gl.uniform3f(u.uTintInk, tc[0], tc[1], tc[2]);
      gl.uniform3f(u.uTintBg, state.bg[0], state.bg[1], state.bg[2]);
    });
  }

  // --- loop ---------------------------------------------------------------
  const needsLoop = () =>
    !state.offscreen &&
    (!!state.anims || (!state.reduced && (fx().fog > 0 || fx().grain > 0)));

  function tick(now) {
    state.raf = 0;
    if (state.anims) {
      const { pts, live } = sampleTweens(state.anims, now, state.easing);
      state.current = pts;
      if (!live) {
        state.anims = null;
        state.onSettle?.();
      }
    }
    // the ray light drifts toward the pointer with momentum
    state.mouseS[0] += (state.pointer[0] - state.mouseS[0]) * 0.08;
    state.mouseS[1] += (state.pointer[1] - state.mouseS[1]) * 0.08;
    draw();
    if (needsLoop()) state.raf = requestAnimationFrame(tick);
  }

  function ensureLoop() {
    if (!state.raf && needsLoop()) state.raf = requestAnimationFrame(tick);
  }

  // canvas backing size = css × dpr (capped 2) × renderScale — the whole
  // chain scales with it, so renderScale is the master performance lever
  function applySize() {
    if (!state.cssW) return;
    const scale =
      Math.min(state.dpr, 2) * Math.max(0.25, Math.min(1, state.effects.renderScale || 1));
    const w = Math.max(1, Math.round(state.cssW * scale));
    const h = Math.max(1, Math.round(state.cssH * scale));
    if (w === state.pxW && h === state.pxH) return;
    state.pxW = w;
    state.pxH = h;
    canvas.width = w;
    canvas.height = h;
    allocTargets();
    draw();
  }

  function readColors() {
    if (typeof getComputedStyle !== 'function') return;
    const cs = getComputedStyle(host);
    state.ink = state.appearance.ink
      ? parseColor(state.appearance.ink)
      : parseColor(cs.color);
    const b = state.effects.background;
    // ground may be a vertical 3-stop gradient: { gradient: [[pos, color] ×3] }
    if (b && typeof b === 'object' && Array.isArray(b.gradient) && b.gradient.length >= 3) {
      state.bgGrad = {
        mid: b.gradient[1][0],
        stops: b.gradient.slice(0, 3).map((s) => parseColor(s[1])),
      };
      state.bg = state.bgGrad.stops[1];
      return;
    }
    state.bgGrad = null;
    const bgStr =
      (typeof b === 'string' && b) ||
      (() => {
        let el = host;
        while (el) {
          const c = getComputedStyle(el).backgroundColor;
          if (c && !c.startsWith('rgba(0, 0, 0, 0)')) return c;
          el = el.parentElement;
        }
        return document.body ? getComputedStyle(document.body).backgroundColor : '#fff';
      })();
    state.bg = parseColor(bgStr);
  }

  function bgUniforms(u) {
    if (u.uBgMode === undefined) return;
    gl.uniform1f(u.uBgMode, state.bgGrad ? 1 : 0);
    const flat = new Float32Array(9);
    if (state.bgGrad)
      for (let i = 0; i < 3; i++) {
        flat[i * 3] = state.bgGrad.stops[i][0];
        flat[i * 3 + 1] = state.bgGrad.stops[i][1];
        flat[i * 3 + 2] = state.bgGrad.stops[i][2];
      }
    gl.uniform3fv(u.uBgStops, flat);
    gl.uniform1f(u.uBgMid, state.bgGrad ? state.bgGrad.mid : 0.5);
  }

  readColors();

  return {
    setFormation(f, { animate = true } = {}) {
      const first = !state.formation;
      state.formation = f;
      readColors();
      const instant =
        first ||
        !animate ||
        state.reduced ||
        state.motion === 'instant' ||
        state.duration <= 0;
      const targetDots = first ? f.dots : assignTargets(state.current, f.dots);
      if (instant) {
        state.anims = null;
        state.current = targetDots.map((d) => d.slice());
        draw();
        state.onSettle?.();
      } else {
        state.anims = buildTweens(state.current, targetDots, state, performance.now());
      }
      ensureLoop();
    },
    showGrid(on) {
      state.gridOn = !!on;
      draw();
    },
    configure(patch) {
      Object.assign(state, patch);
      readColors();
      draw();
    },
    setEffects(patch) {
      const prevScale = state.effects.renderScale;
      Object.assign(state.effects, patch);
      readColors();
      syncCssBlend();
      if (state.effects.renderScale !== prevScale) applySize();
      draw();
      ensureLoop();
    },
    /** Dot layer look: { ink, opacity, blend, soft }. */
    setAppearance(patch) {
      Object.assign(state.appearance, patch);
      readColors();
      syncCssBlend();
      draw();
    },
    refreshInk() {
      readColors();
      draw();
    },
    /** Set positions immediately (dragging) — cancels any running tween. */
    poke(dots) {
      state.anims = null;
      state.current = dots.map((d) => d.slice());
      draw();
    },
    get current() {
      return state.current.map((d) => d.slice());
    },
    resizePx(cssW, cssH, dpr) {
      state.cssW = cssW;
      state.cssH = cssH;
      state.dpr = dpr || 1;
      applySize();
    },
    /** Pointer position in 0..1 (top-left origin) — feeds ray follow. */
    setPointer(nx, ny) {
      state.pointer = [nx, ny];
      if ((fx().rayFollow ?? 0) > 0 && fx().rays > 0 && !state.raf) {
        // no loop running (fog off): smooth per-event and redraw directly
        state.mouseS[0] += (nx - state.mouseS[0]) * 0.15;
        state.mouseS[1] += (ny - state.mouseS[1]) * 0.15;
        draw();
      }
    },
    /** Pause rendering entirely while scrolled out of view. */
    setVisible(v) {
      state.offscreen = !v;
      if (v) {
        draw();
        ensureLoop();
      } else if (state.raf) {
        cancelAnimationFrame(state.raf);
        state.raf = 0;
      }
    },
    get draws() {
      return state.draws;
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
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
