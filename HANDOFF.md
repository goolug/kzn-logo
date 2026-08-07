# HANDOFF — continuing the Kaizen logo engine in a fresh session

Everything lives in git; nothing depends on any session's container.

## Where the code is

**Home: `goolug/kzn-logo`, branch `main`.** Start new Claude sessions from
this repo directly — that gives the session native git access to it.

Provenance note: `main` was imported via the GitHub API (the creating
session's git proxy could read but not push the just-created repo), so it
begins as an import commit. The **full 13-commit development history** is
preserved on branch `claude/kaizen-interactive-logo-jnys6o` of `goolug/kzn`
— identical tree, real archaeology. `kzn`'s own `main` is unrelated and
untouched.

## Run it

No dependencies, no build step. From the project root:

```bash
python3 -m http.server 4173     # or any static file server
```

- `http://localhost:4173/` — **workbench**: shuffle, drag, grid overlay,
  aspect presets, every rule and treatment knob, SVG export
- `http://localhost:4173/env.html` — **site test environment**: the 1440×880
  hero (production gradient + noise plate), authored intro formation,
  click-to-disperse, floating panel with the full parameter surface
- `http://localhost:4173/client.html` — **client presentation page**: the
  piece fills the real viewport (no frame, no bench chrome), hidable panel
  where every slider is paired with a typed number, one undo stack
  (⌘Z works) + reset-to-recipe, opens on the client-review recipe
  (brand blue #007CE6 · 9% · multiply over the 02-Home gradient)
- `http://localhost:4173/white.html` — **white hero page** (Figma 216-3322):
  full page build — Replica type (nav / lockup / manifesto, licensed fonts
  via local()+./fonts/ hooks with metric fallbacks), tone-on-tone dots
  (#FAF8F5 multiply, soft 0.35 ≈ the comp's 100px layer blur) in the comp's
  own box (insets 66.49/97/67.41/97). Instances share client.js; each html
  declares its recipe via `window.KZN_DEFAULTS` + `window.KZN_INTRO`
- `npm test` — 30 rule-invariant tests (node only, no installs)
- `npm run build:standalone` — emits `dist/` single-file bundles

Both pages mirror every control into the URL — **a URL is a preset**.

## Live artifacts (persist across sessions)

- Workbench 🎯 `https://claude.ai/code/artifact/dea05341-b622-4247-bf19-99868c48f1a9`
- Test env 🧪 `https://claude.ai/code/artifact/6e086a71-1e4c-4f17-ad9a-1576b34ffb66`
- Client page 🟠 `https://claude.ai/code/artifact/0df23f27-820f-4450-a46e-ea5b2a71114a`
- White study ⚪ `https://claude.ai/code/artifact/39f6e272-af51-46c4-a850-13c6e08c1246`

A Claude session republishes to the SAME urls by passing the artifact's
`url` to the Artifact tool. The publish source is `dist/*-standalone.html`
with the document shell (doctype/html/head/body/meta) stripped.

## File map

```
src/core.js      geometry engine: measured constants (MARK, MARK_IDEAL,
                 R = 0.3875), seeded generator + rules, drag constraints,
                 travel-minimizing assignment (pin or roaming kernel)
src/motion.js    shared motion math: easings, kernel orbit, center-avoiding
                 paths, tween build/sample
src/svg.js       flat renderer (crisp, currentColor, SVG export)
src/webgl.js     WebGL2 renderer: SDF scene (metaball smin), treatment
                 chain (fog / bokeh / god rays / zoom blur / diffuse, all
                 clean-room GLSL with values extracted from the Unicorn
                 Studio scene NO1CV0Uhn80QBvypdiHu), transparent-overlay or
                 canvas-owned-ground pipelines, reorderable pass list
src/element.js   <kzn-logo> custom element: responsive grid, scale zoom,
                 intro formations, drag, appearance/effects plumbing
demo.js+index.html   workbench      env.js+env.html   test environment
client.js+client.html               client presentation page (fullscreen,
                                    numeric inputs + undo/reset, no bench
                                    chrome); white.html = second instance,
                                    recipe via window.KZN_DEFAULTS
tools/build-standalone.mjs          naive single-file bundler
test/            core + motion invariants
```

## The construction (provenance: Figma "KZN Web")

Node `170-3040` (master mark): dot radius = **0.3875 cells** (Ø 0.775 —
exact), kernel edge through the crosshair (center never), others on
vertical gridlines resting on / hanging under horizontal ones, no touching,
strict distance falloff. Static mark ships verbatim (`MARK`); its rational
skeleton (`MARK_IDEAL`) is the dynamic resting state. Node `179-3924`
(hero): intro = the mark fitted so its bbox fills the box inset
138px sides / 53px top / 130px bottom; Signal `#FEA021` · 10% · difference
is the brand recipe (one button in the env panel).

## Key API surface

`<kzn-logo mode="static|dynamic" renderer="webgl" interactive drag seed grid>`
- `.options = { placement, gap, spread, count, scale, duration, stagger,
  easing, motion, kernel: 'fixed'|'roam' }`
- `.appearance = { ink, opacity, blend, soft, fuse }`
- `.effects = { fog, fogSpeed, fogScale, fogDensity, grain, bokeh, rays,
  rayMode, rayColor, rayInk, rayX, rayY, rayDecay, rayWobble, rayFollow,
  zoom, diffuse, difAngle, difTight, tint, tintColor, renderScale,
  order: [...], background }` — background null = transparent overlay over
  the page's CSS ground (default); a color or {gradient} makes the canvas
  own the ground
- `.intro = { insets, fit: 'mark' }` · `.shuffle()` · `.rest()` ·
  `.exportSVG()` · `.draws` (fps source)

## Open threads

- **Fluff trim** — the user flagged workbench clutter once; candidates
  (fps meter, count slider, copy-link, static strip, dist/ in git) await
  their picks.
- **Fidelity pass vs the live Unicorn embed** — bokeh gating and
  radial-blur internals are principled approximations; compare side by side
  on the user's machine when they care.
- **Perf lever in reserve** — zoom blur + diffuse still run full-res;
  half-res streak + gated composite roughly halves remaining chain cost.
- **SVG renderer parity** — metaball fuse and in-layer ray/blend features
  are WebGL-only; SVG gets CSS blend + gaussian soft only. Fine for logo
  duty; document or extend if ever needed.
- **Presets** — any workbench/env URL is a preset; bake favorites as named
  defaults when the user lands on a look.
- **Repo migration** — see "Where the code is".

## Kickoff prompt for a fresh Claude session

> Start from goolug/kzn. Check out branch
> `claude/kaizen-interactive-logo-jnys6o` and read `HANDOFF.md` at its
> root — it explains everything. [If `goolug/kzn-logo` now exists:
> migrate the project there first, per the handoff.] Then: ‹task›.
