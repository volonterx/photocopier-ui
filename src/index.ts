/**
 * photocopier-ui
 * Two independent parts that also work together:
 *   Overlay  the color photocopy look on top of a live app
 *   Sheets   copier-style transitions: feed a sheet in, scan it, slide it away
 *
 * When both are on a page, Sheets announces motion and the Overlay switches to a
 * cheaper grade while things move. Neither part imports the other.
 */
export * as Overlay from './overlay.js';
export * as Sheets from './sheets.js';
