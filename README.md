# photocopier-ui

A color photocopy look and copier-style transitions for web apps. It comes in two parts that work on their own or together:

- **Overlay** puts a color photocopy look over a live app: toner grain, drum streaks, dust, a lid shadow and a slight color drift. Every layer ignores clicks and touches, so the app keeps working.
- **Sheets** animates modals and pages like a copier: a blank sheet slides up, a scan bar passes over it and reveals the content, and the sheet slides away again.

No dependencies, no build step needed to use it. Backgrounds stay in your own CSS, so the main page and the modal can each have their own paper.

**Demo:** https://volonterx.github.io/photocopier-ui/

## Install

Script tag (everything, or one part only):

```html
<script src="dist/photocopier-ui.js"></script>   <!-- PhotocopierUI.Overlay + PhotocopierUI.Sheets -->
<script src="dist/overlay.js"></script>          <!-- PhotocopierUI.Overlay only -->
<script src="dist/sheets.js"></script>           <!-- PhotocopierUI.Sheets only -->
```

ES modules:

```js
import { Overlay, Sheets } from 'photocopier-ui';
import * as Sheets from 'photocopier-ui/sheets';   // one part only
```

## Overlay

```js
const overlay = PhotocopierUI.Overlay.mount(document.body, { fixed: true, level: 0.4 });

overlay.setLevel(0.6);       // 0 = off, 1 = strong
overlay.setEnabled(false);   // show the original
overlay.update({ hue: 10 }); // fine-tune single settings
overlay.destroy();
```

To cover a single container instead of the viewport, mount it on that element and leave out `fixed`.

| Option | Default | What it does |
|---|---|---|
| `level` | none | One knob, 0 to 1, that sets all the look settings below together. |
| `fixed` | `false` | Cover the viewport instead of the host element. |
| `mode` | `'overlay'` | `'overlay'` works in every browser. `'svg-backdrop'` adds color plate misregistration and wobble, Chromium only. `'filter'` runs the filter on `target` and can skew it, but costs more. |
| `target` | none | Element graded in `'filter'` mode. |
| `saturation`, `contrast`, `hue`, `cast`, `softness` | | Color: punch, contrast, color drift in degrees, warm or cool paper tint, toner bleed. |
| `speckle`, `streaks`, `dust`, `edge` | | Texture amounts, 0 to 1. |
| `misregistration`, `wobble`, `skew` | | SVG modes only, in pixels or degrees. |
| `liteDuringMotion` | `true` | Use the cheaper CSS grade while something animates (see below). |

## Sheets

```js
const sheets = PhotocopierUI.Sheets.create({ scanDuration: 2600 });

await sheets.present(details);  // removes `hidden`, slides up blank, scans the content in
await sheets.dismiss(details);  // slides down, then sets `hidden`
await sheets.reveal(page);      // scan only, for content already on screen
```

The element you animate should cover the area it slides over (for a modal: position it `absolute` or `fixed` over the app). For `present()` it starts with the `hidden` attribute.

| Option | Default | What it does |
|---|---|---|
| `scanDuration` | `2600` | Milliseconds for the bar to cross the element. `0` skips the scan. |
| `feedDuration` | `700` | Milliseconds for `present()` to slide the sheet up. |
| `holdDuration` | `250` | Pause between the slide and the scan. |
| `closeDuration` | `500` | Milliseconds for `dismiss()` to slide the sheet down. |
| `bar` | `'light'` | `'light'`, `'line'` or `'none'`. |
| `copyBackground` | `true` | The cover copies the element's background. |
| `openEasing`, `closeEasing` | | CSS easing for the slides. |
| `respectReducedMotion` | `true` | Skip animations when the user prefers reduced motion. |

Change options later with `sheets.update({ ... })`, or per call: `sheets.present(el, { scanDuration: 1200 })`.

Sheets doesn't manage focus. A typical modal makes the page behind it `inert` while it's open and moves focus in and back:

```js
function open() {
  page.inert = true;
  sheets.present(details).then(() => backButton.focus());
}
function close() {
  sheets.dismiss(details).then(() => { page.inert = false; opener.focus(); });
}
```

### Styling the cover and the bar

During the scan, a blank cover hides the content until the bar passes. By default it copies the background of the element you animate. That works for colors, images and gradients set on the element itself. Style the cover yourself when the background sits on an inner wrapper or comes from `::before`/`::after`:

```css
.details .pcui-cover { background: #fbf7e9 url(notepad.jpg); }
.pcui-bar-light { background: linear-gradient(transparent, rgba(255, 240, 200, .9), transparent); }
```

The library's own styles use `:where()`, so any class selector of yours wins.

## Using both parts together

When both parts are on a page, Sheets dispatches `pcui:motionstart` and `pcui:motionend` events. The Overlay listens for them and switches to its cheaper CSS grade while things move, then switches back. Neither part imports the other. Your own animations can dispatch the same events on an element inside the overlay's host.

## Performance

- All movement is `transform` only, run by the browser's compositor through the Web Animations API. No per-frame JavaScript, layout or repaint.
- The SVG modes are the expensive part. Prefer `'overlay'` mode, or keep `liteDuringMotion` on.
- The overlay's texture canvases are capped at about 1.8 megapixels and drawn once, then redrawn only when settings or size change.

## Develop

```sh
npm run build   # regenerates dist/ from src/
npm start       # serves the repo at http://localhost:8080/demo/
```

`src/` holds the ES modules. `dist/` holds script-tag builds and is committed so the files can be used straight from the repo.

## Demo on GitHub Pages

`.github/workflows/pages.yml` publishes `demo/` and `dist/` on every push to `main`. Turn it on once under **Settings > Pages > Build and deployment > Source: GitHub Actions**.
