/*! photocopier-ui v0.4.0 | Overlay | script-tag build, generated from src/*.ts */
(function (global) {
  'use strict';
  /**
   * photocopier-ui / Overlay
   * A color photocopy look that sits on top of a live app.
   *
   *   const overlay = Overlay.mount(document.body, { fixed: true, level: 0.4 });
   *   overlay.setLevel(0.6);      // 0 = off, 1 = strong
   *   overlay.setEnabled(false);  // compare with the original
   *   overlay.destroy();
   *
   * Every layer has pointer-events: none and aria-hidden, so the app underneath
   * stays fully usable. The overlay never touches your page backgrounds.
   *
   * Modes
   *   'overlay'       A backdrop-filter grades the page; blended canvases add grain,
   *                   streaks, dust and a lid shadow. Works in every browser. Default.
   *   'svg-backdrop'  Same, but the grade is an SVG filter, which adds color plate
   *                   misregistration and wobble. Chromium only; elsewhere it falls
   *                   back to 'overlay' (check overlay.mode).
   *   'filter'        The SVG filter runs on `target` itself. Works everywhere and can
   *                   skew the target, but repaints on every scroll.
   *
   * Motion: while anything inside the host dispatches `pcui:motionstart` (Sheets does
   * this), the overlay switches to its cheaper CSS grade and restores it on
   * `pcui:motionend`. Turn off with { liteDuringMotion: false }.
   */
  const MOTION_START = 'pcui:motionstart';
  const MOTION_END = 'pcui:motionend';
  const TEX_KEYS = { theme: 1, speckle: 1, streaks: 1, dust: 1, edge: 1, seed: 1, cast: 1 };
  let seq = 0;
  const defaults = {
      mode: 'overlay',
      theme: 'auto', // 'dark' draws the textures as light and colored marks, which show on dark pages; 'auto' follows prefers-color-scheme
      fixed: false, // true: layers are position:fixed and cover the viewport
      target: null, // element graded in 'filter' mode (fixed mode default: <html>)
      zIndex: 2147483000,
      saturation: 1.45, // color punch, 1 = unchanged
      contrast: 0.55, // 0..1
      hue: -8, // color drift, degrees
      cast: 0.3, // -1 cool .. 1 warm paper tint
      softness: 0.4, // toner bleed, px
      speckle: 0.35, // 0..1 toner grain and specks
      streaks: 0.35, // 0..1 drum streaks and roller bands
      dust: 0.3, // 0..1 dust and hairs
      edge: 0.5, // 0..1 lid shadow and vignette
      misregistration: 2, // px, color plates drifting apart (SVG modes)
      wobble: 3, // px, paper wobble (SVG modes)
      skew: 0.3, // degrees, 'filter' mode on an element target only
      seed: 7,
      liteDuringMotion: true
  };
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rng(seed) {
      let a = seed >>> 0;
      return function () {
          a |= 0;
          a = (a + 0x6D2B79F5) | 0;
          let t = Math.imul(a ^ (a >>> 15), 1 | a);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
  }
  function prefersDark() {
      return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function isChromium() {
      const b = navigator.userAgentData?.brands;
      if (b)
          return b.some((x) => /Chromium/.test(x.brand));
      return /Chrome\//.test(navigator.userAgent) && !/Firefox\//.test(navigator.userAgent);
  }
  // S-curve with blown whites and crushed blacks, sampled into 17 table entries.
  function curveTable(c) {
      const k = 1 + 1.7 * c, n = 17, out = [];
      for (let i = 0; i < n; i++) {
          const t = i / (n - 1);
          const s = t < 0.5 ? 0.5 * Math.pow(2 * t, k) : 1 - 0.5 * Math.pow(2 * (1 - t), k);
          let v = s * (1 + 0.14 * c);
          v = (v - 0.045 * c) / (1 - 0.045 * c);
          out.push(clamp(v, 0, 1).toFixed(4));
      }
      return out.join(' ');
  }
  /** One knob for everything: 0 = off, 1 = strong. Tuned so text stays comfortable to read. */
  function fromLevel(level) {
      const L = clamp(+level || 0, 0, 1);
      return {
          saturation: 1 + 0.4 * L,
          contrast: 0.35 * L,
          hue: -6 * L,
          cast: 0.28 * L,
          softness: 0.12 * L,
          speckle: 0.3 * L,
          streaks: 0.3 * L,
          dust: 0.25 * L,
          edge: 0.45 * L,
          misregistration: 0.9 * L,
          wobble: 1.2 * L,
          skew: 0.2 * L
      };
  }
  function mount(hostEl, opts = {}) {
      const host = hostEl || document.body;
      const { level, ...rest } = opts;
      const o = Object.assign({}, defaults, level != null ? fromLevel(level) : {}, rest);
      const fixed = !!o.fixed;
      const uid = 'pcui-filter-' + (++seq);
      const target = o.target || (fixed ? document.documentElement : null);
      let enabled = true;
      let raf = 0;
      let effective = 'overlay';
      let motion = 0;
      const saved = {
          hostPos: host.style.position,
          hostIso: host.style.isolation,
          tFilter: target ? target.style.filter : '',
          tTransform: target ? target.style.transform : '',
          tOrigin: target ? target.style.transformOrigin : ''
      };
      if (!fixed) {
          if (getComputedStyle(host).position === 'static')
              host.style.position = 'relative';
          host.style.isolation = 'isolate';
      }
      const hostW = () => (fixed ? window.innerWidth : host.clientWidth);
      const hostH = () => (fixed ? window.innerHeight : host.clientHeight);
      /* ---------- SVG filter ---------- */
      // Only the SVG modes use this filter, so it is built the first time one of them is active.
      let svg = null;
      let f;
      function buildFilter() {
          svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('width', '0');
          svg.setAttribute('height', '0');
          svg.setAttribute('aria-hidden', 'true');
          svg.setAttribute('focusable', 'false');
          svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
          svg.innerHTML =
              '<filter id="' + uid + '" x="-1%" y="-1%" width="102%" height="102%" color-interpolation-filters="sRGB">' +
                  '<feTurbulence data-k="wn" type="fractalNoise" baseFrequency="0.006 0.02" numOctaves="2" seed="4" result="wn"/>' +
                  '<feDisplacementMap data-k="warp" in="SourceGraphic" in2="wn" scale="3" xChannelSelector="R" yChannelSelector="G" result="w"/>' +
                  '<feColorMatrix data-k="sat" in="w" type="saturate" values="1.45" result="s"/>' +
                  '<feColorMatrix data-k="hue" in="s" type="hueRotate" values="-8" result="h"/>' +
                  '<feColorMatrix in="h" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/>' +
                  '<feColorMatrix in="h" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g"/>' +
                  '<feColorMatrix in="h" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b"/>' +
                  '<feOffset data-k="ro" in="r" dx="2" dy="0" result="ro"/>' +
                  '<feOffset data-k="bo" in="b" dx="-2" dy="1" result="bo"/>' +
                  '<feBlend in="ro" in2="g" mode="screen" result="rg"/>' +
                  '<feBlend in="rg" in2="bo" mode="screen" result="rgb"/>' +
                  '<feGaussianBlur data-k="blur" in="rgb" stdDeviation="0.4" result="bl"/>' +
                  '<feComponentTransfer in="bl">' +
                  '<feFuncR data-k="cr" type="table" tableValues="0 1"/>' +
                  '<feFuncG data-k="cg" type="table" tableValues="0 1"/>' +
                  '<feFuncB data-k="cb" type="table" tableValues="0 1"/>' +
                  '</feComponentTransfer>' +
                  '</filter>';
          document.body.appendChild(svg);
          const q = (k) => svg.querySelector('[data-k="' + k + '"]');
          f = {
              wn: q('wn'), warp: q('warp'), sat: q('sat'), hue: q('hue'),
              ro: q('ro'), bo: q('bo'), blur: q('blur'), cr: q('cr'), cg: q('cg'), cb: q('cb')
          };
          applyFilterAttrs();
      }
      function applyFilterAttrs() {
          if (!svg)
              return;
          // Dark pages hide fringes on dim edges, so the color plates drift further apart.
          const m = (+o.misregistration || 0) * (isDark() ? 1.8 : 1);
          f.wn.setAttribute('seed', String((o.seed % 1000) | 0));
          f.warp.setAttribute('scale', String(o.wobble));
          f.sat.setAttribute('values', String(o.saturation));
          f.hue.setAttribute('values', String(o.hue));
          f.ro.setAttribute('dx', m.toFixed(2));
          f.ro.setAttribute('dy', (m * 0.3).toFixed(2));
          f.bo.setAttribute('dx', (-m * 0.8).toFixed(2));
          f.bo.setAttribute('dy', (m * 0.5).toFixed(2));
          f.blur.setAttribute('stdDeviation', (o.softness * 0.9).toFixed(2));
          const t = curveTable(o.contrast);
          f.cr.setAttribute('tableValues', t);
          f.cg.setAttribute('tableValues', t);
          f.cb.setAttribute('tableValues', t);
      }
      /* ---------- Layers ---------- */
      function layer(tag, name, z, blend) {
          const d = document.createElement(tag);
          const s = d.style;
          s.position = fixed ? 'fixed' : 'absolute';
          s.top = '0';
          s.left = '0';
          s.width = '100%';
          s.height = '100%';
          s.margin = '0';
          s.border = '0';
          s.padding = '0';
          s.pointerEvents = 'none';
          s.userSelect = 'none';
          s.zIndex = String(o.zIndex + z);
          if (blend)
              s.mixBlendMode = blend;
          d.className = 'pcui-overlay-' + name;
          d.setAttribute('aria-hidden', 'true');
          host.appendChild(d);
          return d;
      }
      const tone = layer('div', 'tone', 1);
      // Paper tint and dark textures share one multiply canvas (one full-screen blend instead of two).
      const multiplyLayer = layer('canvas', 'dark', 2, 'multiply');
      const screenLayer = layer('canvas', 'light', 3, 'screen');
      const layers = [tone, multiplyLayer, screenLayer];
      const isDark = () => (o.theme === 'auto' ? prefersDark() : o.theme === 'dark');
      function toneCss() {
          return 'saturate(' + o.saturation + ') hue-rotate(' + o.hue + 'deg) contrast(' +
              (1 + 1.1 * o.contrast).toFixed(3) + ') brightness(1.04)' +
              (o.softness > 0.08 ? ' blur(' + (o.softness * 0.9).toFixed(2) + 'px)' : '');
      }
      function setBackdrop(v) {
          tone.style.setProperty('-webkit-backdrop-filter', v);
          tone.style.setProperty('backdrop-filter', v);
      }
      function effectiveMode() {
          let m = o.mode;
          if (m === 'svg-backdrop' && !isChromium())
              m = 'overlay';
          if (m === 'filter' && !target)
              m = 'overlay';
          return m;
      }
      const isLite = () => motion > 0 && o.liteDuringMotion !== false;
      function applyTransform() {
          if (!target || target === document.documentElement)
              return;
          if (enabled && effective === 'filter' && o.skew) {
              const th = o.skew * Math.PI / 180;
              const w = target.offsetWidth || 1, h = target.offsetHeight || 1;
              const s = Math.cos(th) + Math.sin(th) * (Math.max(w, h) / Math.min(w, h));
              target.style.transformOrigin = '50% 50%';
              target.style.transform = 'rotate(' + o.skew + 'deg) scale(' + s.toFixed(4) + ')';
          }
          else {
              target.style.transform = saved.tTransform;
              target.style.transformOrigin = saved.tOrigin;
          }
      }
      function applyMode() {
          effective = effectiveMode();
          const lite = isLite();
          if (effective !== 'overlay' && !svg)
              buildFilter();
          const ref = 'url(#' + uid + ')';
          let backdrop = 'none';
          let tFilter = saved.tFilter;
          if (enabled) {
              if (effective === 'overlay')
                  backdrop = toneCss();
              if (effective === 'svg-backdrop')
                  backdrop = lite ? toneCss() : ref;
              if (effective === 'filter')
                  tFilter = lite ? toneCss() : ref;
          }
          setBackdrop(backdrop);
          if (target)
              target.style.filter = tFilter;
          // On light pages the screen layer only holds faint white specks, so skipping it while moving saves
          // a full-screen blend. On dark pages it holds every texture, so it stays.
          screenLayer.style.visibility = lite && !isDark() ? 'hidden' : '';
          applyTransform();
      }
      // Multiplying by color C at opacity a equals multiplying by (1 - a) + a * C.
      function castColor() {
          const c = clamp(+o.cast || 0, -1, 1), a = Math.abs(c) * 0.8;
          const C = c >= 0 ? [255, 208, 160] : [160, 208, 255];
          return 'rgb(' + C.map((v) => Math.round(255 * (1 - a) + v * a)).join(',') + ')';
      }
      /* ---------- Textures ---------- */
      let grainTile = null, dropTile = null;
      function buildTiles() {
          const T = 512, R = rng(o.seed * 31 + 7);
          grainTile = document.createElement('canvas');
          grainTile.width = grainTile.height = T;
          let g = grainTile.getContext('2d');
          let im = g.createImageData(T, T), p = im.data;
          for (let i = 0; i < T * T; i++) {
              const v = 255 - R() * 60;
              let r = v, gg = v, b = v;
              if (R() < 0.012) {
                  const qd = 60 + R() * 160;
                  r = 255 - qd * (0.85 + 0.15 * R());
                  gg = 255 - qd * (0.85 + 0.15 * R());
                  b = 255 - qd * (0.85 + 0.15 * R());
              }
              p[i * 4] = r;
              p[i * 4 + 1] = gg;
              p[i * 4 + 2] = b;
              p[i * 4 + 3] = 255;
          }
          g.putImageData(im, 0, 0);
          dropTile = document.createElement('canvas');
          dropTile.width = dropTile.height = T;
          g = dropTile.getContext('2d');
          im = g.createImageData(T, T);
          p = im.data;
          for (let i = 0; i < T * T; i++) {
              const w = R() < 0.004 ? 120 + R() * 135 : 0;
              p[i * 4] = w;
              p[i * 4 + 1] = w;
              p[i * 4 + 2] = w;
              p[i * 4 + 3] = 255;
          }
          g.putImageData(im, 0, 0);
      }
      function drawTextures() {
          const darkPage = isDark();
          const w = hostW(), h = hostH();
          if (w < 2 || h < 2)
              return;
          // Cap canvas size at ~1.8 megapixels; larger hosts are drawn at lower resolution and scaled.
          const s = Math.max(1, Math.sqrt(w * h / 1800000));
          const u = 1 / s;
          const cw = Math.ceil(w / s), ch = Math.ceil(h / s);
          multiplyLayer.width = screenLayer.width = cw;
          multiplyLayer.height = screenLayer.height = ch;
          const d = multiplyLayer.getContext('2d'), l = screenLayer.getContext('2d');
          d.globalCompositeOperation = 'source-over';
          d.globalAlpha = 1;
          d.fillStyle = castColor();
          d.fillRect(0, 0, cw, ch);
          l.globalCompositeOperation = 'source-over';
          l.globalAlpha = 1;
          l.fillStyle = '#000';
          l.fillRect(0, 0, cw, ch);
          d.globalCompositeOperation = 'multiply';
          // Uneven toner: soft colored blotches
          const cell = 46, mw = Math.ceil(w / cell) + 2, mh = Math.ceil(h / cell) + 2;
          const mc = document.createElement('canvas');
          mc.width = mw;
          mc.height = mh;
          const mctx = mc.getContext('2d'), imgd = mctx.createImageData(mw, mh);
          const R1 = rng(o.seed * 13 + 5), amp = 55 * o.speckle;
          for (let i = 0; i < mw * mh; i++) {
              imgd.data[i * 4] = 255 - R1() * amp;
              imgd.data[i * 4 + 1] = 255 - R1() * amp;
              imgd.data[i * 4 + 2] = 255 - R1() * amp;
              imgd.data[i * 4 + 3] = 255;
          }
          mctx.putImageData(imgd, 0, 0);
          d.imageSmoothingEnabled = true;
          d.imageSmoothingQuality = 'high';
          if (darkPage) {
              // Multiplying does nothing on a dark page, so the blotches become faint colored light.
              l.globalCompositeOperation = 'lighter';
              l.globalAlpha = 0.18;
              l.filter = 'invert(1)';
              l.imageSmoothingEnabled = true;
              l.imageSmoothingQuality = 'high';
              l.drawImage(mc, -cell / 2 * u, -cell / 2 * u, mw * cell * u, mh * cell * u);
              l.filter = 'none';
              l.globalAlpha = 1;
          }
          else {
              d.drawImage(mc, -cell / 2 * u, -cell / 2 * u, mw * cell * u, mh * cell * u);
          }
          // Fine grain and specks
          if (o.speckle > 0) {
              d.globalAlpha = clamp(o.speckle, 0, 1);
              d.fillStyle = d.createPattern(grainTile, 'repeat');
              d.fillRect(0, 0, cw, ch);
              d.globalAlpha = 1;
              l.globalCompositeOperation = 'lighter';
              l.globalAlpha = clamp(o.speckle * (darkPage ? 0.7 : 1.2), 0, 1);
              l.fillStyle = l.createPattern(dropTile, 'repeat');
              l.fillRect(0, 0, cw, ch);
              l.globalAlpha = 1;
          }
          // Drum streaks (colored, fading in and out)
          const S = rng(o.seed * 17 + 3);
          // Dark pages get bright plate colors drawn as light; light pages get the same inks multiplied.
          const pal = darkPage
              ? [[40, 200, 255], [255, 50, 175], [255, 225, 40], [200, 200, 210], [200, 200, 210]]
              : [[0, 185, 230], [232, 0, 150], [245, 205, 0], [70, 70, 70], [70, 70, 70]];
          const t = darkPage ? l : d;
          if (darkPage)
              t.globalCompositeOperation = 'lighter';
          const n = Math.round(o.streaks * (darkPage ? 22 : 32));
          for (let i = 0; i < n; i++) {
              const x = S() * cw;
              const wd = (0.6 + S() * 2.4) * u * (darkPage ? 1.8 : 1.1);
              const a = Math.min(darkPage ? 0.2 : 0.55, (0.05 + S() * 0.13) * (0.4 + o.streaks) * (darkPage ? 1 : 2));
              const y0 = S() * ch * 0.7 - ch * 0.05;
              const len = ch * (0.25 + S() * 0.75);
              const c = pal[(S() * pal.length) | 0];
              const strip = (sx, sw, rgb, alpha) => {
                  const col = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',';
                  const gr = t.createLinearGradient(0, y0, 0, y0 + len);
                  gr.addColorStop(0, col + '0)');
                  gr.addColorStop(0.12, col + alpha.toFixed(3) + ')');
                  gr.addColorStop(0.88, col + alpha.toFixed(3) + ')');
                  gr.addColorStop(1, col + '0)');
                  t.fillStyle = gr;
                  t.fillRect(sx, y0, sw, len);
              };
              strip(x, wd, c, a);
              // Chromatic fringe: red and blue plates ride just off the line, like misregistered toner.
              if (darkPage) {
                  const gap = wd * 0.5 + 0.8 * u, fw = Math.max(wd * 0.7, 0.8 * u);
                  strip(x - gap - fw, fw, [255, 40, 70], a * 0.45);
                  strip(x + wd + gap, fw, [50, 130, 255], a * 0.45);
              }
          }
          // Wide faint bands
          const nb = Math.round(o.streaks * (darkPage ? 3.5 : 4));
          for (let i = 0; i < nb; i++) {
              const x = S() * cw;
              const bw = (25 + S() * 80) * u;
              const ba = ((0.03 + 0.04 * o.streaks) * (darkPage ? 1.5 : 1)).toFixed(3);
              const bc = darkPage ? '200,205,215' : '60,60,60';
              const hg = t.createLinearGradient(x, 0, x + bw, 0);
              hg.addColorStop(0, 'rgba(' + bc + ',0)');
              hg.addColorStop(0.5, 'rgba(' + bc + ',' + ba + ')');
              hg.addColorStop(1, 'rgba(' + bc + ',0)');
              t.fillStyle = hg;
              t.fillRect(x, 0, bw, ch);
          }
          // Horizontal roller banding
          if (o.streaks > 0.15) {
              const spacing = (170 + S() * 60) * u;
              for (let y = S() * spacing; y < ch; y += spacing) {
                  const bh = (6 + S() * 16) * u;
                  const ha = (0.06 * o.streaks * (darkPage ? 1.8 : 1)).toFixed(3);
                  const hc = darkPage ? '210,190,170' : '90,70,60';
                  const vg = t.createLinearGradient(0, y, 0, y + bh);
                  vg.addColorStop(0, 'rgba(' + hc + ',0)');
                  vg.addColorStop(0.5, 'rgba(' + hc + ',' + ha + ')');
                  vg.addColorStop(1, 'rgba(' + hc + ',0)');
                  t.fillStyle = vg;
                  t.fillRect(0, y, cw, bh);
              }
          }
          // Lid shadow and vignette
          const e = clamp(o.edge, 0, 1);
          if (e > 0) {
              const rad = Math.sqrt(cw * cw + ch * ch) / 2;
              const rg = d.createRadialGradient(cw / 2, ch / 2, rad * 0.45, cw / 2, ch / 2, rad);
              rg.addColorStop(0, 'rgba(60,40,40,0)');
              rg.addColorStop(1, 'rgba(60,40,40,' + (0.5 * e).toFixed(3) + ')');
              d.fillStyle = rg;
              d.fillRect(0, 0, cw, ch);
              const edgeFill = (x0, y0, x1, y1, alpha, rx, ry, rw, rh) => {
                  const lg = d.createLinearGradient(x0, y0, x1, y1);
                  lg.addColorStop(0, 'rgba(0,0,0,' + (alpha * e).toFixed(3) + ')');
                  lg.addColorStop(1, 'rgba(0,0,0,0)');
                  d.fillStyle = lg;
                  d.fillRect(rx, ry, rw, rh);
              };
              edgeFill(0, 0, cw * 0.07, 0, 0.6, 0, 0, cw * 0.07, ch);
              edgeFill(0, 0, 0, ch * 0.03, 0.3, 0, 0, cw, ch * 0.03);
              edgeFill(cw, 0, cw * 0.97, 0, 0.2, cw * 0.97, 0, cw * 0.03, ch);
              edgeFill(0, ch, 0, ch * 0.965, 0.22, 0, ch * 0.965, cw, ch * 0.035);
          }
          // Dust and hairs
          const D = rng(o.seed * 23 + 11);
          const nd = Math.round(o.dust * 80);
          for (let i = 0; i < nd; i++) {
              const x = D() * cw, y = D() * ch;
              const rr = (0.5 + Math.pow(D(), 3) * 2.4) * u;
              t.fillStyle = (darkPage ? 'rgba(235,228,215,' : 'rgba(25,20,20,') + (0.35 + D() * 0.5).toFixed(2) + ')';
              t.beginPath();
              t.arc(x, y, rr, 0, 6.2832);
              t.fill();
          }
          const nh = Math.round(o.dust * 5);
          for (let i = 0; i < nh; i++) {
              const x = D() * cw, y = D() * ch;
              t.strokeStyle = darkPage ? 'rgba(225,218,205,0.6)' : 'rgba(30,25,25,0.55)';
              t.lineWidth = (0.5 + D() * 0.7) * u * (darkPage ? 1.3 : 1);
              t.beginPath();
              t.moveTo(x, y);
              t.quadraticCurveTo(x + (D() - 0.5) * 40 * u, y + (D() - 0.5) * 40 * u, x + (D() - 0.5) * 70 * u, y + (D() - 0.5) * 70 * u);
              t.stroke();
          }
          d.globalCompositeOperation = 'source-over';
          l.globalCompositeOperation = 'source-over';
      }
      function schedule() {
          if (raf)
              return;
          raf = requestAnimationFrame(() => {
              raf = 0;
              drawTextures();
              applyTransform();
          });
      }
      let ro = null;
      if (!fixed && typeof ResizeObserver !== 'undefined') {
          ro = new ResizeObserver(schedule);
          ro.observe(host);
      }
      else {
          window.addEventListener('resize', schedule);
      }
      const scheme = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
      const onScheme = () => { if (o.theme === 'auto')
          schedule(); };
      if (scheme)
          scheme.addEventListener('change', onScheme);
      /* ---------- Motion hint from Sheets (or anything else) ---------- */
      function onMotion(e) {
          if (!fixed && !host.contains(e.target))
              return;
          motion = Math.max(0, motion + (e.type === MOTION_START ? 1 : -1));
          applyMode();
      }
      document.addEventListener(MOTION_START, onMotion);
      document.addEventListener(MOTION_END, onMotion);
      /* ---------- Public API ---------- */
      function update(input = {}) {
          let patch;
          if (input.level != null) {
              const { level: lv, ...others } = input;
              patch = { ...fromLevel(lv), ...others };
          }
          else {
              patch = { ...input };
              delete patch.level;
          }
          let texDirty = false, seedDirty = false;
          for (const k in patch) {
              if (!Object.prototype.hasOwnProperty.call(patch, k))
                  continue;
              if (!(k in defaults) || k === 'target' || k === 'fixed' || k === 'zIndex')
                  continue;
              if (o[k] !== patch[k]) {
                  o[k] = patch[k];
                  if (TEX_KEYS[k])
                      texDirty = true;
                  if (k === 'seed')
                      seedDirty = true;
              }
          }
          if (seedDirty)
              buildTiles();
          applyFilterAttrs();
          applyMode();
          if (texDirty)
              schedule();
      }
      function setEnabled(on) {
          enabled = !!on;
          layers.forEach((n) => { n.style.display = enabled ? '' : 'none'; });
          applyMode();
      }
      function destroy() {
          if (raf)
              cancelAnimationFrame(raf);
          if (ro)
              ro.disconnect();
          else
              window.removeEventListener('resize', schedule);
          if (scheme)
              scheme.removeEventListener('change', onScheme);
          document.removeEventListener(MOTION_START, onMotion);
          document.removeEventListener(MOTION_END, onMotion);
          layers.forEach((n) => n.remove());
          if (svg)
              svg.remove();
          if (target) {
              target.style.filter = saved.tFilter;
              target.style.transform = saved.tTransform;
              target.style.transformOrigin = saved.tOrigin;
          }
          if (!fixed) {
              host.style.position = saved.hostPos;
              host.style.isolation = saved.hostIso;
          }
      }
      buildTiles();
      applyMode();
      schedule();
      return {
          update,
          setLevel: (level) => update({ level }),
          setEnabled,
          reroll: () => update({ seed: 1 + Math.floor(Math.random() * 100000) }),
          destroy,
          get enabled() { return enabled; },
          get mode() { return effective; },
          get options() { return Object.assign({}, o); }
      };
  }

  var ns = global.PhotocopierUI = global.PhotocopierUI || {};
  ns.Overlay = { defaults: defaults, isChromium: isChromium, fromLevel: fromLevel, mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
