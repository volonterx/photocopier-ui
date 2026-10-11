/*! photocopier-ui v0.1.0 | Overlay + Sheets | script-tag build, generated from src/ */
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
  const TEX_KEYS = { speckle: 1, streaks: 1, dust: 1, edge: 1, seed: 1, cast: 1 };
  let seq = 0;

  const defaults = {
    mode: 'overlay',
    fixed: false,         // true: layers are position:fixed and cover the viewport
    target: null,         // element graded in 'filter' mode (fixed mode default: <html>)
    zIndex: 2147483000,
    saturation: 1.45,     // color punch, 1 = unchanged
    contrast: 0.55,       // 0..1
    hue: -8,              // color drift, degrees
    cast: 0.3,            // -1 cool .. 1 warm paper tint
    softness: 0.4,        // toner bleed, px
    speckle: 0.35,        // 0..1 toner grain and specks
    streaks: 0.35,        // 0..1 drum streaks and roller bands
    dust: 0.3,            // 0..1 dust and hairs
    edge: 0.5,            // 0..1 lid shadow and vignette
    misregistration: 2,   // px, color plates drifting apart (SVG modes)
    wobble: 3,            // px, paper wobble (SVG modes)
    skew: 0.3,            // degrees, 'filter' mode on an element target only
    seed: 7,
    liteDuringMotion: true
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function isChromium() {
    const b = navigator.userAgentData && navigator.userAgentData.brands;
    if (b) return b.some((x) => /Chromium/.test(x.brand));
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

  function mount(host, opts = {}) {
    host = host || document.body;
    const o = Object.assign({}, defaults, opts.level != null ? fromLevel(opts.level) : {}, opts);
    delete o.level;
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
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      host.style.isolation = 'isolate';
    }

    const hostW = () => (fixed ? window.innerWidth : host.clientWidth);
    const hostH = () => (fixed ? window.innerHeight : host.clientHeight);

    /* ---------- SVG filter ---------- */
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
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
    const f = {
      wn: q('wn'), warp: q('warp'), sat: q('sat'), hue: q('hue'),
      ro: q('ro'), bo: q('bo'), blur: q('blur'), cr: q('cr'), cg: q('cg'), cb: q('cb')
    };

    function applyFilterAttrs() {
      const m = +o.misregistration || 0;
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
      s.top = '0'; s.left = '0';
      s.width = '100%'; s.height = '100%';
      s.margin = '0'; s.border = '0'; s.padding = '0';
      s.pointerEvents = 'none';
      s.userSelect = 'none';
      s.zIndex = String(o.zIndex + z);
      if (blend) s.mixBlendMode = blend;
      d.className = 'pcui-overlay-' + name;
      d.setAttribute('aria-hidden', 'true');
      host.appendChild(d);
      return d;
    }
    const tone = layer('div', 'tone', 1);
    // Paper tint and dark textures share one multiply canvas (one full-screen blend instead of two).
    const dark = layer('canvas', 'dark', 2, 'multiply');
    const light = layer('canvas', 'light', 3, 'screen');
    const layers = [tone, dark, light];

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
      if (m === 'svg-backdrop' && !isChromium()) m = 'overlay';
      if (m === 'filter' && !target) m = 'overlay';
      return m;
    }

    const isLite = () => motion > 0 && o.liteDuringMotion !== false;

    function applyTransform() {
      if (!target || target === document.documentElement) return;
      if (enabled && effective === 'filter' && o.skew) {
        const th = o.skew * Math.PI / 180;
        const w = target.offsetWidth || 1, h = target.offsetHeight || 1;
        const s = Math.cos(th) + Math.sin(th) * (Math.max(w, h) / Math.min(w, h));
        target.style.transformOrigin = '50% 50%';
        target.style.transform = 'rotate(' + o.skew + 'deg) scale(' + s.toFixed(4) + ')';
      } else {
        target.style.transform = saved.tTransform;
        target.style.transformOrigin = saved.tOrigin;
      }
    }

    function applyMode() {
      effective = effectiveMode();
      const lite = isLite();
      const ref = 'url(#' + uid + ')';
      let backdrop = 'none';
      let tFilter = saved.tFilter;
      if (enabled) {
        if (effective === 'overlay') backdrop = toneCss();
        if (effective === 'svg-backdrop') backdrop = lite ? toneCss() : ref;
        if (effective === 'filter') tFilter = lite ? toneCss() : ref;
      }
      setBackdrop(backdrop);
      if (target) target.style.filter = tFilter;
      // The white speck layer is barely visible; skipping it while moving saves a full-screen blend.
      light.style.visibility = lite ? 'hidden' : '';
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
        p[i * 4] = r; p[i * 4 + 1] = gg; p[i * 4 + 2] = b; p[i * 4 + 3] = 255;
      }
      g.putImageData(im, 0, 0);

      dropTile = document.createElement('canvas');
      dropTile.width = dropTile.height = T;
      g = dropTile.getContext('2d');
      im = g.createImageData(T, T); p = im.data;
      for (let i = 0; i < T * T; i++) {
        const w = R() < 0.004 ? 120 + R() * 135 : 0;
        p[i * 4] = w; p[i * 4 + 1] = w; p[i * 4 + 2] = w; p[i * 4 + 3] = 255;
      }
      g.putImageData(im, 0, 0);
    }

    function drawTextures() {
      const w = hostW(), h = hostH();
      if (w < 2 || h < 2) return;
      // Cap canvas size at ~1.8 megapixels; larger hosts are drawn at lower resolution and scaled.
      const s = Math.max(1, Math.sqrt(w * h / 1800000));
      const u = 1 / s;
      const cw = Math.ceil(w / s), ch = Math.ceil(h / s);
      dark.width = light.width = cw;
      dark.height = light.height = ch;
      const d = dark.getContext('2d'), l = light.getContext('2d');

      d.globalCompositeOperation = 'source-over'; d.globalAlpha = 1;
      d.fillStyle = castColor(); d.fillRect(0, 0, cw, ch);
      l.globalCompositeOperation = 'source-over'; l.globalAlpha = 1;
      l.fillStyle = '#000'; l.fillRect(0, 0, cw, ch);
      d.globalCompositeOperation = 'multiply';

      // Uneven toner: soft colored blotches
      const cell = 46, mw = Math.ceil(w / cell) + 2, mh = Math.ceil(h / cell) + 2;
      const mc = document.createElement('canvas'); mc.width = mw; mc.height = mh;
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
      d.drawImage(mc, -cell / 2 * u, -cell / 2 * u, mw * cell * u, mh * cell * u);

      // Fine grain and specks
      if (grainTile && o.speckle > 0) {
        d.globalAlpha = clamp(o.speckle, 0, 1);
        d.fillStyle = d.createPattern(grainTile, 'repeat');
        d.fillRect(0, 0, cw, ch);
        d.globalAlpha = 1;
        l.globalCompositeOperation = 'lighter';
        l.globalAlpha = clamp(o.speckle * 1.2, 0, 1);
        l.fillStyle = l.createPattern(dropTile, 'repeat');
        l.fillRect(0, 0, cw, ch);
        l.globalAlpha = 1;
      }

      // Drum streaks (colored, fading in and out)
      const S = rng(o.seed * 17 + 3);
      const pal = [[0, 185, 230], [232, 0, 150], [245, 205, 0], [70, 70, 70], [70, 70, 70]];
      const n = Math.round(o.streaks * 28);
      for (let i = 0; i < n; i++) {
        const x = S() * cw;
        const wd = (0.6 + S() * 2.4) * u;
        const a = Math.min(0.4, (0.05 + S() * 0.13) * (0.4 + o.streaks));
        const y0 = S() * ch * 0.7 - ch * 0.05;
        const len = ch * (0.25 + S() * 0.75);
        const c = pal[(S() * pal.length) | 0];
        const col = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',';
        const gr = d.createLinearGradient(0, y0, 0, y0 + len);
        gr.addColorStop(0, col + '0)');
        gr.addColorStop(0.12, col + a.toFixed(3) + ')');
        gr.addColorStop(0.88, col + a.toFixed(3) + ')');
        gr.addColorStop(1, col + '0)');
        d.fillStyle = gr;
        d.fillRect(x, y0, wd, len);
      }
      // Wide faint bands
      const nb = Math.round(o.streaks * 4);
      for (let i = 0; i < nb; i++) {
        const x = S() * cw;
        const bw = (25 + S() * 80) * u;
        const ba = (0.03 + 0.04 * o.streaks).toFixed(3);
        const hg = d.createLinearGradient(x, 0, x + bw, 0);
        hg.addColorStop(0, 'rgba(60,60,60,0)');
        hg.addColorStop(0.5, 'rgba(60,60,60,' + ba + ')');
        hg.addColorStop(1, 'rgba(60,60,60,0)');
        d.fillStyle = hg;
        d.fillRect(x, 0, bw, ch);
      }
      // Horizontal roller banding
      if (o.streaks > 0.15) {
        const spacing = (170 + S() * 60) * u;
        for (let y = S() * spacing; y < ch; y += spacing) {
          const bh = (6 + S() * 16) * u;
          const ha = (0.06 * o.streaks).toFixed(3);
          const vg = d.createLinearGradient(0, y, 0, y + bh);
          vg.addColorStop(0, 'rgba(90,70,60,0)');
          vg.addColorStop(0.5, 'rgba(90,70,60,' + ha + ')');
          vg.addColorStop(1, 'rgba(90,70,60,0)');
          d.fillStyle = vg;
          d.fillRect(0, y, cw, bh);
        }
      }

      // Lid shadow and vignette
      const e = clamp(o.edge, 0, 1);
      if (e > 0) {
        const rad = Math.sqrt(cw * cw + ch * ch) / 2;
        const rg = d.createRadialGradient(cw / 2, ch / 2, rad * 0.45, cw / 2, ch / 2, rad);
        rg.addColorStop(0, 'rgba(60,40,40,0)');
        rg.addColorStop(1, 'rgba(60,40,40,' + (0.5 * e).toFixed(3) + ')');
        d.fillStyle = rg; d.fillRect(0, 0, cw, ch);

        const edgeFill = (x0, y0, x1, y1, alpha, rx, ry, rw, rh) => {
          const lg = d.createLinearGradient(x0, y0, x1, y1);
          lg.addColorStop(0, 'rgba(0,0,0,' + (alpha * e).toFixed(3) + ')');
          lg.addColorStop(1, 'rgba(0,0,0,0)');
          d.fillStyle = lg; d.fillRect(rx, ry, rw, rh);
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
        d.fillStyle = 'rgba(25,20,20,' + (0.35 + D() * 0.5).toFixed(2) + ')';
        d.beginPath(); d.arc(x, y, rr, 0, 6.2832); d.fill();
      }
      const nh = Math.round(o.dust * 5);
      for (let i = 0; i < nh; i++) {
        const x = D() * cw, y = D() * ch;
        d.strokeStyle = 'rgba(30,25,25,0.55)';
        d.lineWidth = (0.5 + D() * 0.7) * u;
        d.beginPath(); d.moveTo(x, y);
        d.quadraticCurveTo(x + (D() - 0.5) * 40 * u, y + (D() - 0.5) * 40 * u,
          x + (D() - 0.5) * 70 * u, y + (D() - 0.5) * 70 * u);
        d.stroke();
      }
      d.globalCompositeOperation = 'source-over';
    }

    function schedule() {
      if (raf) return;
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
    } else {
      window.addEventListener('resize', schedule);
    }

    /* ---------- Motion hint from Sheets (or anything else) ---------- */
    function onMotion(e) {
      if (!fixed && !host.contains(e.target)) return;
      motion = Math.max(0, motion + (e.type === MOTION_START ? 1 : -1));
      applyMode();
    }
    document.addEventListener(MOTION_START, onMotion);
    document.addEventListener(MOTION_END, onMotion);

    /* ---------- Public API ---------- */
    function update(patch = {}) {
      if (patch.level != null) {
        const lv = fromLevel(patch.level);
        for (const k in patch) if (k !== 'level') lv[k] = patch[k];
        patch = lv;
      }
      let texDirty = false, seedDirty = false;
      for (const k in patch) {
        if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
        if (!(k in defaults) || k === 'target' || k === 'fixed' || k === 'zIndex') continue;
        if (o[k] !== patch[k]) {
          o[k] = patch[k];
          if (TEX_KEYS[k]) texDirty = true;
          if (k === 'seed') seedDirty = true;
        }
      }
      if (seedDirty) buildTiles();
      applyFilterAttrs();
      applyMode();
      if (texDirty) schedule();
    }

    function setEnabled(on) {
      enabled = !!on;
      layers.forEach((n) => { n.style.display = enabled ? '' : 'none'; });
      applyMode();
    }

    function destroy() {
      if (raf) cancelAnimationFrame(raf);
      if (ro) ro.disconnect(); else window.removeEventListener('resize', schedule);
      document.removeEventListener(MOTION_START, onMotion);
      document.removeEventListener(MOTION_END, onMotion);
      layers.forEach((n) => n.remove());
      svg.remove();
      if (target) {
        target.style.filter = saved.tFilter;
        target.style.transform = saved.tTransform;
        target.style.transformOrigin = saved.tOrigin;
      }
      if (!fixed) { host.style.position = saved.hostPos; host.style.isolation = saved.hostIso; }
    }

    buildTiles();
    applyFilterAttrs();
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

(function (global) {
  'use strict';
  /**
   * photocopier-ui / Sheets
   * Copier-style transitions for modals and pages. Works with or without the Overlay.
   *
   *   const sheets = Sheets.create({ scanDuration: 2600 });
   *   await sheets.present(modal);   // blank sheet slides up, scan bar reveals the content
   *   await sheets.dismiss(modal);   // sheet slides down over the page behind it
   *   await sheets.reveal(page);     // scan only, for something already on screen
   *
   * The element you animate should cover the area you want (for a modal: position it
   * absolute or fixed over the app) and, for present(), start with the `hidden` attribute.
   * Its background is yours: Sheets never sets it.
   *
   * During the scan, a blank cover hides the content until the bar passes. By default the
   * cover copies the element's own background. To style it yourself, target `.pcui-cover`:
   *
   *   .details .pcui-cover { background: #fffbe8 url(my-paper.jpg); }
   *
   * The scan bar is `.pcui-bar` (plus `.pcui-bar-light` or `.pcui-bar-line`) and can be
   * restyled the same way. Library styles use :where(), so any class selector wins.
   *
   * Sheets dispatches `pcui:motionstart` and `pcui:motionend` (bubbling) on the element.
   * The Overlay listens for these and uses a cheaper grade while things move.
   */

  const MOTION_START = 'pcui:motionstart';
  const MOTION_END = 'pcui:motionend';

  const defaults = {
    scanDuration: 2600,   // ms for the bar to cross the element (0 = no scan)
    feedDuration: 700,    // ms for present() to slide the sheet up
    holdDuration: 250,    // ms pause between the slide and the scan
    closeDuration: 500,   // ms for dismiss() to slide the sheet down
    bar: 'light',         // 'light' | 'line' | 'none'
    copyBackground: true, // cover copies the element's background (else style .pcui-cover)
    openEasing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    closeEasing: 'cubic-bezier(0.55, 0, 1, 0.45)',
    respectReducedMotion: true // skip animations when the user prefers reduced motion
  };

  const CSS = [
    ':where(.pcui-fx){position:absolute;left:0;width:100%;overflow:hidden;pointer-events:none;z-index:2147482000;margin:0;padding:0;border:0}',
    ':where(.pcui-cover-mask){position:absolute;left:0;top:0;width:100%;overflow:hidden;pointer-events:auto;will-change:transform}',
    ':where(.pcui-cover){position:absolute;left:0;top:0;width:100%;will-change:transform;' +
      'background-color:var(--pcui-cover-color,#fff);background-image:var(--pcui-cover-image,none);' +
      'background-size:var(--pcui-cover-size,auto);background-repeat:var(--pcui-cover-repeat,repeat);' +
      'background-position:var(--pcui-cover-x,0) var(--pcui-cover-y,0)}',
    ':where(.pcui-bar){position:absolute;left:0;top:0;width:100%;will-change:transform;pointer-events:none}',
    ':where(.pcui-bar-light){background:linear-gradient(to bottom,rgba(255,255,255,0) 0%,rgba(190,225,255,.45) 40%,' +
      'rgba(255,255,255,.95) 50%,rgba(190,225,255,.45) 60%,rgba(255,255,255,0) 100%)}',
    ':where(.pcui-bar-line){background:linear-gradient(to bottom,rgba(30,40,60,0) 0%,rgba(30,40,60,.14) 40%,' +
      'rgba(30,40,60,.38) 50%,rgba(30,40,60,.14) 60%,rgba(30,40,60,0) 100%)}'
  ].join('\n');

  let styleInjected = false;
  let warnedTransparent = false;

  function injectStyle() {
    if (styleInjected || typeof document === 'undefined') return;
    styleInjected = true;
    const s = document.createElement('style');
    s.setAttribute('data-pcui', 'sheets');
    s.textContent = CSS;
    (document.head || document.documentElement).prepend(s);
  }

  function num(v, fallback) { v = +v; return Number.isFinite(v) && v >= 0 ? v : fallback; }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function isTransparent(color) {
    return !color || color === 'transparent' || /rgba?\([^)]*,\s*0\)$/.test(color.replace(/\s+/g, ' '));
  }

  function emit(el, type, action) {
    el.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail: { action } }));
  }

  function create(opts = {}) {
    injectStyle();
    const o = Object.assign({}, defaults, opts);
    const busy = new WeakMap();
    const running = new Set();

    function timing(call) {
      call = call || {};
      return {
        feed: num(call.feedDuration, num(o.feedDuration, 700)),
        hold: num(call.holdDuration, num(o.holdDuration, 250)),
        scan: num(call.scanDuration, num(o.scanDuration, 2600)),
        close: num(call.closeDuration, num(o.closeDuration, 500)),
        bar: call.bar || o.bar
      };
    }

    function skipMotion() { return o.respectReducedMotion && reducedMotion(); }

    function anim(el, frames, t) {
      const a = el.animate(frames, t);
      running.add(a);
      return a;
    }

    function settle(list) {
      return Promise.all(list.map((a) => a.finished.catch(() => {}).then(() => running.delete(a))));
    }

    function ensurePositioned(el) {
      if (getComputedStyle(el).position !== 'static') return () => {};
      const prev = el.style.position;
      el.style.position = 'relative';
      return () => { el.style.position = prev; };
    }

    // Builds the scan layer: a clip box at the element's visible top holding the cover and bar.
    function buildScan(el, h, barKind) {
      const top = el.scrollTop;
      const barH = barKind === 'line' ? 28 : Math.max(60, Math.round(h * 0.14));
      const fx = document.createElement('div');
      fx.className = 'pcui-fx';
      fx.setAttribute('aria-hidden', 'true');
      fx.style.top = top + 'px';
      fx.style.height = h + 'px';

      const mask = document.createElement('div');
      mask.className = 'pcui-cover-mask';
      mask.style.height = (h + barH) + 'px';
      const cover = document.createElement('div');
      cover.className = 'pcui-cover';
      cover.style.height = h + 'px';

      if (o.copyBackground) {
        const cs = getComputedStyle(el);
        const hasImage = cs.backgroundImage && cs.backgroundImage !== 'none';
        if (isTransparent(cs.backgroundColor) && !hasImage) {
          if (!warnedTransparent && typeof console !== 'undefined') {
            warnedTransparent = true;
            console.warn('[photocopier-ui] The animated element has no background, so the scan cover is plain white. Give the element a background or style .pcui-cover.');
          }
        } else {
          cover.style.setProperty('--pcui-cover-color', cs.backgroundColor);
          cover.style.setProperty('--pcui-cover-image', cs.backgroundImage);
          cover.style.setProperty('--pcui-cover-size', cs.backgroundSize);
          cover.style.setProperty('--pcui-cover-repeat', cs.backgroundRepeat);
          cover.style.setProperty('--pcui-cover-x', cs.backgroundPositionX);
          // A background that scrolls with the content is offset by how far the element is scrolled.
          const local = /local/.test(cs.backgroundAttachment) && top;
          const ys = cs.backgroundPositionY.split(',').map((y) => (local ? 'calc(' + y.trim() + ' - ' + top + 'px)' : y.trim()));
          cover.style.setProperty('--pcui-cover-y', ys.join(', '));
        }
      }
      mask.appendChild(cover);
      fx.appendChild(mask);

      let bar = null;
      if (barKind && barKind !== 'none') {
        bar = document.createElement('div');
        bar.className = 'pcui-bar pcui-bar-' + barKind;
        bar.style.height = barH + 'px';
        fx.appendChild(bar);
      }
      el.appendChild(fx);
      return { fx, mask, cover, bar, barH };
    }

    // The bar's center travels from the top edge to past the bottom. The cover's top edge
    // follows it, while the cover's paper moves the other way so it appears to stay put.
    function sweep(parts, h, duration, delay) {
      const t = { duration, delay, easing: 'linear', fill: 'both' };
      const b = parts.barH;
      const list = [
        anim(parts.mask, [{ transform: 'translateY(' + (-b / 2) + 'px)' }, { transform: 'translateY(' + (h + b / 2) + 'px)' }], t),
        anim(parts.cover, [{ transform: 'translateY(' + (b / 2) + 'px)' }, { transform: 'translateY(' + (-h - b / 2) + 'px)' }], t)
      ];
      if (parts.bar) {
        list.push(anim(parts.bar, [{ transform: 'translateY(' + (-b) + 'px)' }, { transform: 'translateY(' + h + 'px)' }], t));
      }
      return list;
    }

    function track(el, promise) {
      busy.set(el, promise);
      return promise.finally(() => busy.delete(el));
    }

    /** Slides `el` up as a blank sheet, then scans its content in. Removes `hidden` first. */
    function present(el, call) {
      if (busy.has(el)) return busy.get(el);
      const t = timing(call);
      el.hidden = false;
      el.scrollTop = 0;
      if (skipMotion() || !el.animate) return Promise.resolve();

      const restore = ensurePositioned(el);
      const h = el.clientHeight;
      const parts = t.scan > 0 ? buildScan(el, h, t.bar) : null;
      emit(el, MOTION_START, 'present');
      const list = [anim(el, [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }],
        { duration: t.feed, easing: o.openEasing, fill: 'backwards' })];
      if (parts) list.push(...sweep(parts, h, t.scan, t.feed + t.hold));

      return track(el, settle(list).then(() => {
        list.forEach((a) => a.cancel());
        if (parts) parts.fx.remove();
        restore();
        emit(el, MOTION_END, 'present');
      }));
    }

    /** Scans content into `el` in place, without sliding. Useful for page loads and content swaps. */
    function reveal(el, call) {
      if (busy.has(el)) return busy.get(el);
      const t = timing(call);
      el.hidden = false;
      if (skipMotion() || !el.animate || t.scan <= 0) return Promise.resolve();

      const restore = ensurePositioned(el);
      const h = el.clientHeight;
      const parts = buildScan(el, h, t.bar);
      emit(el, MOTION_START, 'reveal');
      const list = sweep(parts, h, t.scan, 0);

      return track(el, settle(list).then(() => {
        list.forEach((a) => a.cancel());
        parts.fx.remove();
        restore();
        emit(el, MOTION_END, 'reveal');
      }));
    }

    /** Slides `el` down out of view, then sets `hidden`. */
    function dismiss(el, call) {
      if (busy.has(el)) return busy.get(el);
      const t = timing(call);
      if (skipMotion() || !el.animate) { el.hidden = true; return Promise.resolve(); }

      emit(el, MOTION_START, 'dismiss');
      const a = anim(el, [{ transform: 'translateY(0)' }, { transform: 'translateY(100%)' }],
        { duration: t.close, easing: o.closeEasing, fill: 'forwards' });

      return track(el, settle([a]).then(() => {
        el.hidden = true;
        a.cancel();
        emit(el, MOTION_END, 'dismiss');
      }));
    }

    return {
      present,
      dismiss,
      reveal,
      update(patch) { Object.assign(o, patch || {}); },
      isBusy(el) { return busy.has(el); },
      get options() { return Object.assign({}, o); },
      /** Jumps any running animation to its end. */
      destroy() { running.forEach((a) => a.finish()); running.clear(); }
    };
  }

  var ns = global.PhotocopierUI = global.PhotocopierUI || {};
  ns.Sheets = { defaults: defaults, create: create };
})(typeof window !== 'undefined' ? window : globalThis);
