/*! photocopier-ui v0.3.0 | Sheets | script-tag build, generated from src/*.ts */
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
   * The scan bar is `.pcui-bar` (plus `.pcui-bar-light` or `.pcui-bar-line`). Its thickness is
   * `barThickness`, in vw, and its gradient is generated for that thickness and set as the
   * custom property `--pcui-bar-image`. Restyle it with a `background` on the bar class.
   * Library styles use :where(), so any class selector wins.
   *
   * Sheets dispatches `pcui:motionstart` and `pcui:motionend` (bubbling) on the element.
   * The Overlay listens for these and uses a cheaper grade while things move.
   */
  const MOTION_START = 'pcui:motionstart';
  const MOTION_END = 'pcui:motionend';
  const defaults = {
      scanDuration: 2600, // ms for the bar to cross the element (0 = no scan)
      feedDuration: 700, // ms for present() to slide the sheet up
      holdDuration: 250, // ms pause between the slide and the scan
      closeDuration: 500, // ms for dismiss() to slide the sheet down
      bar: 'light', // 'light' | 'line' | 'none'
      barThickness: null, // bar thickness in vw (null = 4 for 'light', 2 for 'line'; 0 = no bar)
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
      ':where(.pcui-bar-light),:where(.pcui-bar-line){background:var(--pcui-bar-image,none)}',
      ':where(.pcui-bar-light){background-blend-mode:multiply}'
  ].join('\n');
  let styleInjected = false;
  let warnedTransparent = false;
  function injectStyle() {
      if (styleInjected || typeof document === 'undefined')
          return;
      styleInjected = true;
      const s = document.createElement('style');
      s.setAttribute('data-pcui', 'sheets');
      s.textContent = CSS;
      (document.head || document.documentElement).prepend(s);
  }
  function num(v, fallback) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : fallback; }
  function reducedMotion() {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function isTransparent(color) {
      return !color || color === 'transparent' || /rgba?\([^)]*,\s*0\)$/.test(color.replace(/\s+/g, ' '));
  }
  const band = (center, half, color) => 'linear-gradient(to bottom,transparent ' + (center - half).toFixed(2) + 'px,' + color + ' ' + center.toFixed(2) +
      'px,transparent ' + (center + half).toFixed(2) + 'px)';
  // White base: eases (smoothstep) from transparent at the edges to solid white at 45% and 55%.
  function whiteBase() {
      const stops = [];
      for (let i = 0; i <= 9; i++) {
          const t = i / 9, a = t * t * (3 - 2 * t);
          stops.push('rgba(255,255,255,' + a.toFixed(3) + ') ' + (45 * t).toFixed(1) + '%');
      }
      for (let i = 0; i <= 9; i++) {
          const t = 1 - i / 9, a = t * t * (3 - 2 * t);
          stops.push('rgba(255,255,255,' + a.toFixed(3) + ') ' + (100 - 45 * t).toFixed(1) + '%');
      }
      return 'linear-gradient(to bottom,' + stops.join(',') + ')';
  }
  // Default bar thickness in vw.
  const BAR_DEFAULT_VW = { light: 4, line: 2 };
  // Generates the bar's gradient for a thickness T (px).
  function barImage(kind, T) {
      const c = T / 2;
      const w = Math.min(3, Math.max(1, T * 0.025));
      if (kind === 'line') {
          const d = w * 1.4;
          return [
              band(c, w * 1.2, 'rgba(30,40,60,.5)'),
              band(c - d, w, 'rgba(0,170,255,.14)'),
              band(c + d, w, 'rgba(255,50,90,.12)'),
              'linear-gradient(to bottom,rgba(30,40,60,0) 0%,rgba(30,40,60,.14) 40%,rgba(30,40,60,.38) 50%,rgba(30,40,60,.14) 60%,rgba(30,40,60,0) 100%)'
          ].join(',');
      }
      // Light bar: three layers, multiplied together (see .pcui-bar-light in CSS), as shares of the thickness.
      //   cyan   fades in from the top and peaks just above the center
      //   pink   peaks just below the center and fades out toward the bottom
      //   base   bright white, easing to transparent toward the top and bottom
      // Where cyan and pink overlap they multiply into a washed-out gray-blue center line.
      return [
          'linear-gradient(to bottom,rgba(110,185,215,0) 22%,rgba(110,185,215,.55) 51%,rgba(110,185,215,0) 56%)',
          'linear-gradient(to bottom,rgba(215,125,165,0) 44%,rgba(215,125,165,.5) 49%,rgba(215,125,165,0) 78%)',
          whiteBase()
      ].join(',');
  }
  function emit(el, type, action) {
      el.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail: { action } }));
  }
  function create(opts = {}) {
      injectStyle();
      const o = Object.assign({}, defaults, opts);
      const busy = new WeakMap();
      const running = new Set();
      function timing(call = {}) {
          return {
              feed: num(call.feedDuration, num(o.feedDuration, 700)),
              hold: num(call.holdDuration, num(o.holdDuration, 250)),
              scan: num(call.scanDuration, num(o.scanDuration, 2600)),
              close: num(call.closeDuration, num(o.closeDuration, 500)),
              bar: call.bar || o.bar,
              thickness: call.barThickness != null ? num(call.barThickness, 0) : o.barThickness != null ? num(o.barThickness, 0) : null
          };
      }
      function skipMotion() { return o.respectReducedMotion && reducedMotion(); }
      function anim(el, frames, t) {
          const a = el.animate(frames, t);
          running.add(a);
          return a;
      }
      function settle(list) {
          return Promise.all(list.map((a) => a.finished.catch(() => { }).then(() => { running.delete(a); }))).then(() => { });
      }
      function ensurePositioned(el) {
          if (getComputedStyle(el).position !== 'static')
              return () => { };
          const prev = el.style.position;
          el.style.position = 'relative';
          return () => { el.style.position = prev; };
      }
      // Builds the scan layer: a clip box at the element's visible top holding the cover and bar.
      function buildScan(el, h, barKind, thickness) {
          const top = el.scrollTop;
          const vw = thickness == null && barKind !== 'none' ? BAR_DEFAULT_VW[barKind] : thickness || 0;
          const hasBar = barKind !== 'none' && vw > 0;
          const barH = hasBar ? Math.max(2, Math.round(vw * document.documentElement.clientWidth / 100)) : 0;
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
              }
              else {
                  cover.style.setProperty('--pcui-cover-color', cs.backgroundColor);
                  cover.style.setProperty('--pcui-cover-image', cs.backgroundImage);
                  cover.style.setProperty('--pcui-cover-size', cs.backgroundSize);
                  cover.style.setProperty('--pcui-cover-repeat', cs.backgroundRepeat);
                  cover.style.setProperty('--pcui-cover-x', cs.backgroundPositionX);
                  // A background that scrolls with the content is offset by how far the element is scrolled.
                  const local = /local/.test(cs.backgroundAttachment) && top !== 0;
                  const ys = cs.backgroundPositionY.split(',').map((y) => (local ? 'calc(' + y.trim() + ' - ' + top + 'px)' : y.trim()));
                  cover.style.setProperty('--pcui-cover-y', ys.join(', '));
              }
          }
          mask.appendChild(cover);
          fx.appendChild(mask);
          let bar = null;
          if (hasBar) {
              bar = document.createElement('div');
              bar.className = 'pcui-bar pcui-bar-' + barKind;
              bar.style.height = barH + 'px';
              bar.style.setProperty('--pcui-bar-image', barImage(barKind, barH));
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
          if (busy.has(el))
              return busy.get(el);
          const t = timing(call);
          el.hidden = false;
          el.scrollTop = 0;
          if (skipMotion() || !el.animate)
              return Promise.resolve();
          const restore = ensurePositioned(el);
          const h = el.clientHeight;
          const parts = t.scan > 0 ? buildScan(el, h, t.bar, t.thickness) : null;
          emit(el, MOTION_START, 'present');
          const list = [anim(el, [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { duration: t.feed, easing: o.openEasing, fill: 'backwards' })];
          if (parts)
              list.push(...sweep(parts, h, t.scan, t.feed + t.hold));
          return track(el, settle(list).then(() => {
              list.forEach((a) => a.cancel());
              if (parts)
                  parts.fx.remove();
              restore();
              emit(el, MOTION_END, 'present');
          }));
      }
      /** Scans content into `el` in place, without sliding. Useful for page loads and content swaps. */
      function reveal(el, call) {
          if (busy.has(el))
              return busy.get(el);
          const t = timing(call);
          el.hidden = false;
          if (skipMotion() || !el.animate || t.scan <= 0)
              return Promise.resolve();
          const restore = ensurePositioned(el);
          const h = el.clientHeight;
          const parts = buildScan(el, h, t.bar, t.thickness);
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
          if (busy.has(el))
              return busy.get(el);
          const t = timing(call);
          if (skipMotion() || !el.animate) {
              el.hidden = true;
              return Promise.resolve();
          }
          emit(el, MOTION_START, 'dismiss');
          const a = anim(el, [{ transform: 'translateY(0)' }, { transform: 'translateY(100%)' }], { duration: t.close, easing: o.closeEasing, fill: 'forwards' });
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
  ns.Sheets = { defaults: defaults, BAR_DEFAULT_VW: BAR_DEFAULT_VW, create: create };
})(typeof window !== 'undefined' ? window : globalThis);
