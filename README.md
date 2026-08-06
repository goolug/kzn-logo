# kzn-logo

The Kaizen mark as a living system: six dots composed on a 4×4 grid, with a
center that has gravity no dot ever lands on. Flat, fast, dependency-free.
This is the **flat engine** — the WebGL treatment layers on top of it later,
consuming the same geometry.

## The construction, from first principles

Measured from the Figma master (*KZN Web*, node `170-3040` "Logogrid"):

- **The unit is the grid cell.** Dot radius is `0.3875` cells — dot diameter
  is exactly `0.775` of a cell. Dot scale vs. the grid is what dictates
  closeness, and it is a constant of the mark.
- **The kernel.** One dot always reaches the center: its **edge passes
  through the central crosshair** — from any angle — but its center never
  sits on it. It is the closest dot, and the only one placed continuously.
- **Everyone else sits on the grid.** Centers on vertical gridlines;
  vertically they either **rest** centered on a horizontal gridline or
  **hang** with their top edge kissing one. (That is precisely how the static
  mark is built: top row and kernel hang, bottom pair rests.)
- **No two dots ever touch.**
- **Gravity falloff.** Distance to center grows strictly rank by rank —
  the center always pulls, like rings of an archery target laid on a grid.

The **stable symbol** is the sanctioned exception: it carries ~1–2px of
hand-tuned optical slack over this skeleton and two rank ties. It is stored
verbatim from Figma (`MARK`), never generated. Its rational skeleton
(`MARK_IDEAL`, exact tangency) is the resting state of the dynamic logo.

At non-square sizes the grid **extends**: cells stay square (short side = 4
cells), gridlines sit at integer offsets from the center outward, so the
central crosshair — and exact tangency — survive any aspect ratio, and dots
re-lay out across the wider field. *(Open decision: see below.)*

## Use

```html
<script type="module" src="src/index.js"></script>

<!-- the stable symbol (business card, next to the wordmark) -->
<kzn-logo mode="static" style="height:32px;width:37px"></kzn-logo>

<!-- living background: click to re-form -->
<kzn-logo mode="dynamic" interactive seed="kzn"
          style="position:fixed;inset:0;width:100%;height:100%"></kzn-logo>

<!-- treated (WebGL2): same engine, effect passes on top; falls back to flat -->
<kzn-logo mode="dynamic" renderer="webgl" interactive seed="kzn"
          style="position:fixed;inset:0;width:100%;height:100%"></kzn-logo>
```

- Ink = CSS `color` (dots are `currentColor`). Size = host CSS.
- `seed` makes every formation reproducible (`seed#step`); resize re-lays out
  deterministically. No seed → unique per visit.
- JS API: `.shuffle(seed?)`, `.rest()`, `.formation`, `.exportSVG()`,
  `.options = { placement, gap, spread, count, duration, stagger, easing, motion }`.
- WebGL: `renderer="webgl"` renders the same formations as a fragment SDF
  (≤8 distance evals/pixel, DPR-capped, renders only while something moves) —
  with every effect at 0 it is pixel-parity with the SVG. `.effects =
  { blur, grain, tint, tintColor, background }` drives the post pipeline;
  no WebGL2 → silent flat fallback (`data-renderer-active` tells you which).
- Events: `kzn-shuffle`, `kzn-settle`.
- Headless: `import { generate, toSVG } from './src/core.js'` — same engine
  server-side for static SVG/print export, and for the WebGL renderer later.
- `prefers-reduced-motion` is honored (instant swap).

## Demo / workbench

```
npm run serve   # → http://localhost:4173
```

Every control maps to a URL param — configurations are shareable links.
`npm test` runs the rule invariants (tangency, no-touch, falloff, bounds,
grid legality, determinism) across thousands of seeded formations.
`npm run build:standalone` emits a single-file library and a single-file demo
into `dist/`.

## Open decisions (defaults are proposals, not commitments)

| Decision | Current default | Alternatives ready to try in the demo |
| --- | --- | --- |
| Non-square behavior | extend grid, square cells | stretch 4×4 (distorts closeness — advise against), letterbox |
| What varies per shuffle | positions only (6 dots, fixed scale) | dot count (slider), size jitter (not built — say the word) |
| "On the grid" strictness | construction (lines + resting/hanging) | slide along lines · intersections only |
| Motion | calm glide 750ms, 45ms stagger, cubic | instant snap · springy/stepped (not built — say the word) |

## Roadmap

1. **The real treatment** — the WebGL renderer + post pipeline exist
   (scene → blur → grain → duotone, all uniform-driven placeholders).
   Next: replicate the exact effect stack from the Unicorn Studio prototype —
   there is no API/connector for Unicorn Studio, so share the embed URL or the
   exported project JSON and the stack gets rebuilt natively as shader passes.
   Flat SVG stays as fallback and print path.
2. Package/minify (`dist/` single file is already embeddable anywhere).
3. Size-variation mode, if wanted, once the rules for it are decided.

---
© Kaizen. Geometry provenance: Figma *KZN Web* node `170-3040`; colors
measured: `#FFFBF8` ("White" token), ink `#1E1E1E` (provisional — confirm).
