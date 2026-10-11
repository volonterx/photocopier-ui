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

export type BarKind = 'light' | 'line' | 'none';

export interface SheetsOptions {
  scanDuration: number;
  feedDuration: number;
  holdDuration: number;
  closeDuration: number;
  bar: BarKind;
  copyBackground: boolean;
  openEasing: string;
  closeEasing: string;
  respectReducedMotion: boolean;
}

/** Per-call overrides for present(), reveal() and dismiss(). */
export type CallOptions = Partial<Pick<SheetsOptions, 'scanDuration' | 'feedDuration' | 'holdDuration' | 'closeDuration' | 'bar'>>;

export type MotionAction = 'present' | 'reveal' | 'dismiss';

export interface ScanParts {
  fx: HTMLDivElement;
  mask: HTMLDivElement;
  cover: HTMLDivElement;
  bar: HTMLDivElement | null;
  barH: number;
}

export interface Sheets {
  present(el: HTMLElement, call?: CallOptions): Promise<void>;
  dismiss(el: HTMLElement, call?: CallOptions): Promise<void>;
  reveal(el: HTMLElement, call?: CallOptions): Promise<void>;
  update(patch?: Partial<SheetsOptions>): void;
  isBusy(el: HTMLElement): boolean;
  readonly options: SheetsOptions;
  destroy(): void;
}

export const defaults: SheetsOptions = {
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

function num(v: unknown, fallback: number): number { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : fallback; }

function reducedMotion(): boolean {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function isTransparent(color: string): boolean {
  return !color || color === 'transparent' || /rgba?\([^)]*,\s*0\)$/.test(color.replace(/\s+/g, ' '));
}

function emit(el: HTMLElement, type: string, action: MotionAction): void {
  el.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail: { action } }));
}

export function create(opts: Partial<SheetsOptions> = {}): Sheets {
  injectStyle();
  const o: SheetsOptions = Object.assign({}, defaults, opts);
  const busy = new WeakMap<HTMLElement, Promise<void>>();
  const running = new Set<Animation>();

  function timing(call: CallOptions = {}) {
    return {
      feed: num(call.feedDuration, num(o.feedDuration, 700)),
      hold: num(call.holdDuration, num(o.holdDuration, 250)),
      scan: num(call.scanDuration, num(o.scanDuration, 2600)),
      close: num(call.closeDuration, num(o.closeDuration, 500)),
      bar: call.bar || o.bar
    };
  }

  function skipMotion(): boolean { return o.respectReducedMotion && reducedMotion(); }

  function anim(el: HTMLElement, frames: Keyframe[], t: KeyframeAnimationOptions): Animation {
    const a = el.animate(frames, t);
    running.add(a);
    return a;
  }

  function settle(list: Animation[]): Promise<void> {
    return Promise.all(list.map((a) => a.finished.catch(() => {}).then(() => { running.delete(a); }))).then(() => {});
  }

  function ensurePositioned(el: HTMLElement): () => void {
    if (getComputedStyle(el).position !== 'static') return () => {};
    const prev = el.style.position;
    el.style.position = 'relative';
    return () => { el.style.position = prev; };
  }

  // Builds the scan layer: a clip box at the element's visible top holding the cover and bar.
  function buildScan(el: HTMLElement, h: number, barKind: BarKind): ScanParts {
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
        const local = /local/.test(cs.backgroundAttachment) && top !== 0;
        const ys = cs.backgroundPositionY.split(',').map((y) => (local ? 'calc(' + y.trim() + ' - ' + top + 'px)' : y.trim()));
        cover.style.setProperty('--pcui-cover-y', ys.join(', '));
      }
    }
    mask.appendChild(cover);
    fx.appendChild(mask);

    let bar: HTMLDivElement | null = null;
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
  function sweep(parts: ScanParts, h: number, duration: number, delay: number): Animation[] {
    const t: KeyframeAnimationOptions = { duration, delay, easing: 'linear', fill: 'both' };
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

  function track(el: HTMLElement, promise: Promise<void>): Promise<void> {
    busy.set(el, promise);
    return promise.finally(() => busy.delete(el));
  }

  /** Slides `el` up as a blank sheet, then scans its content in. Removes `hidden` first. */
  function present(el: HTMLElement, call?: CallOptions): Promise<void> {
    if (busy.has(el)) return busy.get(el)!;
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
  function reveal(el: HTMLElement, call?: CallOptions): Promise<void> {
    if (busy.has(el)) return busy.get(el)!;
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
  function dismiss(el: HTMLElement, call?: CallOptions): Promise<void> {
    if (busy.has(el)) return busy.get(el)!;
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
    update(patch?: Partial<SheetsOptions>) { Object.assign(o, patch || {}); },
    isBusy(el: HTMLElement) { return busy.has(el); },
    get options() { return Object.assign({}, o); },
    /** Jumps any running animation to its end. */
    destroy() { running.forEach((a) => a.finish()); running.clear(); }
  };
}
