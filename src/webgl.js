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

// value-noise fbm — original implementation; drives the fog field
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
  float fbm(vec2 p, float t) {
    mat2 rot = mat2(0.6, -0.8, 0.8, 0.6);
    float n = 0.0, amp = 0.55;
    for (int i = 0; i < 5; i++) {
      n += vnoise(p + vec2(t * 0.35, -t * 0.22) + float(i) * 7.31) * amp;
      p = rot * p * 1.9;
      amp *= 0.55;
    }
    return n;
  }
  // fog field: centered like the source scene, sigmoid-compressed
  float fogField(vec2 uv, float ar, float t) {
    vec2 aspect = vec2(ar, 1.0);
    float mult = 10.0 * (0.648 / ((ar + 1.0) * 0.5));
    vec2 st = (uv * aspect - vec2(0.504, 0.564) * aspect) * mult;
    float c = cos(1.0128), s = sin(1.0128);
    st = mat2(c, -s, s, c) * st;
    float n = fbm(st - vec2(t * 0.048), t);
    n = n / (1.0 + abs(n));
    return clamp(n * 2.0, 0.0, 1.0);
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
out vec4 outColor;
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

  float cov = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uCount) break;
    float d = length(p - uDots[i].xy) - uDots[i].z;
    cov = max(cov, 1.0 - smoothstep(-aa - uSoft, aa + uSoft, d));
  }

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

// fog blur: exponential-falloff directional blur whose radius is modulated
// by the fog field (radius 1%–3% of the frame, as in the source scene)
const FOGBLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec2 uDir;
uniform float uTime;
uniform float uAmt;
out vec4 outColor;
${LIB}
${FBM}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float ar = uRes.x / uRes.y;
  float f = fogField(uv, ar, uTime);
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
${FBM}
vec3 bgAt(float t) {
  if (uBgMode < 0.5) return uBg.rgb;
  return t < uBgMid
    ? mix(uBgStops[0], uBgStops[1], t / max(uBgMid, 1e-4))
    : mix(uBgStops[1], uBgStops[2], (t - uBgMid) / max(1.0 - uBgMid, 1e-4));
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float ar = uRes.x / uRes.y;
  vec4 base = texture(uTex, uv);
  float halo = texture(uBlur, uv).r;
  float mask = fogField(uv, ar, uTime) * uFog;
  float presence = smoothstep(0.0, 0.12, halo);
  float grain = hash21(uv * uRes.xy / 100.0 + fract(uTime));
  float light = aces(vec3(halo * 0.8)).r + grain * 0.05 * uGrain;
  vec3 ground = bgAt(1.0 - uv.y);
  outColor = vec4(base.rgb + (uInk.rgb - ground) * light * mask * presence, 1.0);
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
out vec4 outColor;
${LIB}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 light = vec2(0.5, 0.5574); // just below center, as in the source scene
  const float N = 48.0;
  vec2 stepv = (light - uv) / N * 0.2775;
  float noise = ign(gl_FragCoord.xy);
  vec2 s = uv + stepv * noise;
  vec2 perp = vec2(-stepv.y, stepv.x);
  float weight = 1.0;
  vec3 acc = vec3(0.0);
  for (float i = 0.0; i < N; i++) {
    float th = i / N;
    s += stepv + perp * th * sin(noise * 0.25 * (1.0 + th) * 50.0) * 0.15;
    vec3 samp = texture(uTex, s).rgb;
    float lum = dot(samp, vec3(0.299, 0.587, 0.114));
    acc += samp * smoothstep(-0.1, 0.0, lum) * weight;
    weight *= 0.899;
    if (weight < 0.05) break;
  }
  outColor = vec4(acc / N * 2.8 * uAmt, 1.0);
}`;

const ADD_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;  // base
uniform sampler2D uAddT; // additive layer
uniform vec2 uRes;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  outColor = vec4(texture(uTex, uv).rgb + texture(uAddT, uv).rgb, 1.0);
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
  c.rgb = mix(c.rgb, mix(uTintInk, uTintBg, lum), uTintAmt);
  outColor = vec4(c.rgb, 1.0);
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
    appearance: { ink: null, opacity: 1, blend: 'normal', soft: 0 },
    effects: { ...ZERO_STACK, difAngle: 45, difTight: 0.75 },
    pxW: 0,
    pxH: 0,
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
      bgUniforms(u);
    });
  }

  // when the stack is off the canvas is transparent — blending against the
  // page happens in CSS; when the stack is on it happens in-shader
  function syncCssBlend() {
    const ap = state.appearance;
    canvas.style.mixBlendMode =
      !stackActive() && ap.blend && ap.blend !== 'normal' ? ap.blend : '';
  }

  function draw() {
    if (!state.formation || !state.pxW) return;
    if (!stackActive()) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, state.pxW, state.pxH);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      drawScene(null, 0);
      return;
    }

    const e = fx();
    const time = state.reduced ? 0 : ((performance.now() - state.t0) / 1000) * 0.2 * 0.05;
    // "fog time" advances at layer speed 0.2 with the scene's 0.05 multiplier

    drawScene('fullA', 1);
    let cur = 'fullA'; // name of the current full-res composite
    let spare = 'fullB';

    // 1 · fog — the dots' own light (coverage on black, quarter res) gets a
    //     noise-modulated exponential blur; the composite pushes pixels
    //     toward the ink under the fbm mask. Clipped to the dots by design.
    if (e.fog > 0 || e.grain > 0) {
      drawScene('quarterA', 2);
      pass(prg.fogBlur, 'quarterB', (u) => {
        bindTex(0, targets.quarterA.tex);
        gl.uniform1i(u.uTex, 0);
        gl.uniform2f(u.uDir, 1, 0);
        gl.uniform1f(u.uTime, time);
        gl.uniform1f(u.uAmt, Math.max(e.fog, 0.001));
      });
      pass(prg.fogBlur, 'quarterA', (u) => {
        bindTex(0, targets.quarterB.tex);
        gl.uniform1i(u.uTex, 0);
        gl.uniform2f(u.uDir, 0, 1);
        gl.uniform1f(u.uTime, time);
        gl.uniform1f(u.uAmt, Math.max(e.fog, 0.001));
      });
      pass(prg.fogComp, spare, (u) => {
        bindTex(0, targets[cur].tex);
        bindTex(1, targets.quarterA.tex);
        gl.uniform1i(u.uTex, 0);
        gl.uniform1i(u.uBlur, 1);
        gl.uniform1f(u.uTime, time);
        gl.uniform1f(u.uFog, e.fog);
        gl.uniform1f(u.uGrain, e.grain);
        gl.uniform4fv(u.uInk, state.ink);
        gl.uniform4fv(u.uBg, state.bg);
        bgUniforms(u);
      });
      [cur, spare] = [spare, cur];
    }

    // 2 · bokeh — golden-angle disc blur at half res; the blurred field
    //     replaces the frame (as in the source scene), upsampled linearly
    if (e.bokeh > 0) {
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
      [cur, spare] = [spare, cur];
    }

    // 3 · god rays — half-res march toward the light, added over the frame
    if (e.rays > 0) {
      pass(prg.rays, 'halfB', (u) => {
        bindTex(0, targets[cur].tex);
        gl.uniform1i(u.uTex, 0);
        gl.uniform1f(u.uAmt, e.rays);
      });
      pass(prg.add, spare, (u) => {
        bindTex(0, targets[cur].tex);
        bindTex(1, targets.halfB.tex);
        gl.uniform1i(u.uTex, 0);
        gl.uniform1i(u.uAddT, 1);
      });
      [cur, spare] = [spare, cur];
    }

    // 4 · zoom blur — radial streaks, gated off near the center
    if (e.zoom > 0) {
      pass(prg.zoom, spare, (u) => {
        bindTex(0, targets[cur].tex);
        gl.uniform1i(u.uTex, 0);
        gl.uniform1f(u.uAmt, e.zoom);
      });
      [cur, spare] = [spare, cur];
    }

    // 5 · diffuse — static scatter, sharp center / dissolved edges
    if (e.diffuse > 0) {
      pass(prg.diffuse, spare, (u) => {
        bindTex(0, targets[cur].tex);
        gl.uniform1i(u.uTex, 0);
        gl.uniform1f(u.uAmt, e.diffuse);
        gl.uniform1f(u.uDifAngle, ((e.difAngle ?? 45) * Math.PI) / 180);
        gl.uniform1f(u.uDifTight, e.difTight ?? 0.75);
      });
      [cur, spare] = [spare, cur];
    }

    // 6 · grade to screen (duotone tint for non-B&W colorways, or plain blit)
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
    !!state.anims ||
    (!state.reduced && (fx().fog > 0 || fx().grain > 0));

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
    draw();
    if (needsLoop()) state.raf = requestAnimationFrame(tick);
  }

  function ensureLoop() {
    if (!state.raf && needsLoop()) state.raf = requestAnimationFrame(tick);
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
      Object.assign(state.effects, patch);
      readColors();
      syncCssBlend();
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
      const scale = Math.min(dpr || 1, 2);
      const w = Math.max(1, Math.round(cssW * scale));
      const h = Math.max(1, Math.round(cssH * scale));
      if (w === state.pxW && h === state.pxH) return;
      state.pxW = w;
      state.pxH = h;
      canvas.width = w;
      canvas.height = h;
      allocTargets();
      draw();
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
