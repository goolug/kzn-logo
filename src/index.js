// kzn-logo — public entry point.
//   import 'kzn-logo';            → registers <kzn-logo>
//   import { generate } from …   → headless engine (SSR, exports, WebGL later)
export * from './core.js';
export { renderMark, toSVG, createDynamicRenderer } from './svg.js';
import './element.js';
