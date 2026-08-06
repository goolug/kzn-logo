// kzn-logo — WebGL2 renderer. Same contract as the SVG dynamic renderer,
// same formations, same motion math — plus a post-processing pipeline for
// the treated look (page backgrounds, hero moments).
//
// With every effect at 0 the output is pixel-parity with the flat SVG:
// antialiased currentColor dots on transparency, straight to screen.
// The effect passes below (blur → grain → duotone) are SCAFFOLD placeholders
// wired end-to-end so the real stack — replicated from the Unicorn Studio
// prototype — can land as shader work without touching the engine.
//
// Perf posture: fragment SDF over ≤8 dots (no geometry), half-resolution
// blur chain, renders only while something changes (tween or animated
// grain), DPR capped at 2.

import { assignTargets } from './core.js';
import { buildTweens, sampleTweens } from './motion.js';

const VS = `#version 300 es
void main() {
  vec2 v = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(v * 2.0 - 1.0, 0.0, 1.0);
}`;

// dots + construction grid, drawn as one signed-distance field
const SCENE_FS = `#version 300 es
precision highp float;
uniform vec2 uRes;      // px
uniform vec2 uHalf;     // canvas half-size, in cells
uniform vec3 uDots[8];  // x, y (cells, center origin, y down), radius
uniform int uCount;
uniform vec4 uInk;
uniform vec4 uBg;
uniform float uOpaque;  // 1 = composite on uBg (effects), 0 = transparent
uniform float uGrid;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  vec2 p = vec2(uv.x * uHalf.x, -uv.y * uHalf.y);
  float pxPerCell = uRes.x / (2.0 * uHalf.x);
  float aa = 1.0 / pxPerCell;

  float cov = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uCount) break;
    float d = length(p - uDots[i].xy) - uDots[i].z;
    cov = max(cov, 1.0 - smoothstep(-aa, aa, d));
  }

  float a = cov;
  if (uGrid > 0.5) {
    float lw = max(uHalf.x, uHalf.y) * 2.0 / 420.0; // hairline, as in SVG
    vec2 nearest = vec2(floor(p.x + 0.5), floor(p.y + 0.5));
    vec2 dist = abs(p - nearest);
    float lx = (abs(nearest.x) <= uHalf.x - 0.001)
      ? 1.0 - smoothstep(lw * 0.5, lw * 0.5 + aa, dist.x) : 0.0;
    float ly = (abs(nearest.y) <= uHalf.y - 0.001)
      ? 1.0 - smoothstep(lw * 0.5, lw * 0.5 + aa, dist.y) : 0.0;
    float cross = (1.0 - smoothstep(lw * 2.4, lw * 2.4 + aa, length(p))) * 0.5;
    a = max(a, max(max(lx, ly) * 0.18, cross));
  }

  if (uOpaque > 0.5) {
    outColor = vec4(mix(uBg.rgb, uInk.rgb, a), 1.0);
  } else {
    outColor = vec4(uInk.rgb * a, a); // premultiplied
  }
}`;

const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;    // px of the target
uniform vec2 uDir;
uniform float uRadius;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 s = uDir * (uRadius / 4.0) / uRes;
  vec4 c = texture(uTex, uv) * 0.2026;
  c += (texture(uTex, uv + s * 1.0) + texture(uTex, uv - s * 1.0)) * 0.1790;
  c += (texture(uTex, uv + s * 2.0) + texture(uTex, uv - s * 2.0)) * 0.1240;
  c += (texture(uTex, uv + s * 3.0) + texture(uTex, uv - s * 3.0)) * 0.0672;
  c += (texture(uTex, uv + s * 4.0) + texture(uTex, uv - s * 4.0)) * 0.0285;
  outColor = c;
}`;

const POST_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uGrain;
uniform float uTime;
uniform float uTintAmt;
uniform vec3 uTintInk;  // tone the dots drift toward
uniform vec3 uTintBg;   // tone the ground drifts toward
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 c = texture(uTex, uv);
  float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  c.rgb = mix(c.rgb, mix(uTintInk, uTintBg, lum), uTintAmt);
  vec2 cell = floor(gl_FragCoord.xy) + vec2(uTime * 60.0, uTime * 47.0);
  float n = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
  c.rgb += (n - 0.5) * uGrain;
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

  const scene = compile(SCENE_FS);
  const blur = compile(BLUR_FS);
  const post = compile(POST_FS);

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
    effects: { blur: 0, grain: 0, tint: 0, tintColor: '#AFA8D8', background: null },
    pxW: 0,
    pxH: 0,
    t0: performance.now(),
  };

  // --- framebuffers -------------------------------------------------------
  let texScene = null, fboScene = null;
  let texA = null, fboA = null, texB = null, fboB = null;

  function makeTarget(w, h) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return [t, f];
  }

  function allocTargets() {
    for (const t of [texScene, texA, texB]) if (t) gl.deleteTexture(t);
    for (const f of [fboScene, fboA, fboB]) if (f) gl.deleteFramebuffer(f);
    [texScene, fboScene] = makeTarget(state.pxW, state.pxH);
    const hw = Math.max(1, state.pxW >> 1);
    const hh = Math.max(1, state.pxH >> 1);
    [texA, fboA] = makeTarget(hw, hh);
    [texB, fboB] = makeTarget(hw, hh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // --- drawing ------------------------------------------------------------
  const effectsActive = () =>
    state.effects.blur > 0 || state.effects.grain > 0 || state.effects.tint > 0;

  function drawScene(opaque) {
    const f = state.formation;
    gl.useProgram(scene.p);
    gl.uniform2f(scene.u.uRes, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform2f(scene.u.uHalf, f.w / 2, f.h / 2);
    const flat = new Float32Array(24);
    const n = Math.min(state.current.length, 8);
    for (let i = 0; i < n; i++) {
      flat[i * 3] = state.current[i][0];
      flat[i * 3 + 1] = state.current[i][1];
      flat[i * 3 + 2] = f.r;
    }
    gl.uniform3fv(scene.u.uDots, flat);
    gl.uniform1i(scene.u.uCount, n);
    gl.uniform4fv(scene.u.uInk, state.ink);
    gl.uniform4fv(scene.u.uBg, state.bg);
    gl.uniform1f(scene.u.uOpaque, opaque ? 1 : 0);
    gl.uniform1f(scene.u.uGrid, state.gridOn ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function blurPass(fbo, w, h, tex, dirX, dirY, radius) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(blur.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(blur.u.uTex, 0);
    gl.uniform2f(blur.u.uRes, w, h);
    gl.uniform2f(blur.u.uDir, dirX, dirY);
    gl.uniform1f(blur.u.uRadius, radius);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function draw() {
    if (!state.formation || !state.pxW) return;
    if (!effectsActive()) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, state.pxW, state.pxH);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      drawScene(false);
      return;
    }
    // scene → full-res texture, composited on the ground color
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboScene);
    gl.viewport(0, 0, state.pxW, state.pxH);
    drawScene(true);

    // blur chain at half res
    const hw = Math.max(1, state.pxW >> 1);
    const hh = Math.max(1, state.pxH >> 1);
    let tex = texScene;
    const r = state.effects.blur / 2; // half-res space
    if (state.effects.blur > 0) {
      const rounds = state.effects.blur > 40 ? 2 : 1;
      for (let i = 0; i < rounds; i++) {
        blurPass(fboA, hw, hh, tex, 1, 0, r / rounds);
        blurPass(fboB, hw, hh, texA, 0, 1, r / rounds);
        tex = texB;
      }
    }

    // post: grain + duotone, to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, state.pxW, state.pxH);
    gl.useProgram(post.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(post.u.uTex, 0);
    gl.uniform2f(post.u.uRes, state.pxW, state.pxH);
    gl.uniform1f(post.u.uGrain, state.effects.grain);
    gl.uniform1f(
      post.u.uTime,
      state.reduced ? 0 : (performance.now() - state.t0) / 1000
    );
    gl.uniform1f(post.u.uTintAmt, state.effects.tint);
    const tc = parseColor(state.effects.tintColor);
    gl.uniform3f(post.u.uTintInk, tc[0], tc[1], tc[2]);
    gl.uniform3f(post.u.uTintBg, state.bg[0], state.bg[1], state.bg[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // --- loop ---------------------------------------------------------------
  const needsLoop = () =>
    !!state.anims || (state.effects.grain > 0 && !state.reduced);

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
    state.ink = parseColor(cs.color);
    const bgStr =
      state.effects.background ||
      (() => {
        let el = host;
        while (el) {
          const b = getComputedStyle(el).backgroundColor;
          if (b && !b.startsWith('rgba(0, 0, 0, 0)')) return b;
          el = el.parentElement;
        }
        return document.body ? getComputedStyle(document.body).backgroundColor : '#fff';
      })();
    state.bg = parseColor(bgStr);
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
      const targets = first ? f.dots : assignTargets(state.current, f.dots);
      if (instant) {
        state.anims = null;
        state.current = targets.map((d) => d.slice());
        draw();
        state.onSettle?.();
      } else {
        state.anims = buildTweens(state.current, targets, state, performance.now());
        ensureLoop();
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
      draw();
      ensureLoop();
    },
    refreshInk() {
      readColors();
      draw();
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
