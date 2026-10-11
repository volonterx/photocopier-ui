(function () {
  'use strict';
  const $ = <T extends HTMLElement = HTMLElement>(s: string, r?: ParentNode): T => (r || document).querySelector<T>(s)!;
  const { Overlay, Sheets } = (window as unknown as {
    PhotocopierUI: { Overlay: typeof import('../lib/overlay.js'); Sheets: typeof import('../lib/sheets.js') };
  }).PhotocopierUI;

  type Status = 'ok' | 'board' | 'late';
  type LineId = 'A' | 'B' | 'C' | 'D';
  interface Line { color: string; stops: [string, number][]; vessel: string; fare: string }
  interface Departure { t: string; line: LineId; pier: string; status: Status }

  /* ---------- Sample data ---------- */
  const LINES: Record<LineId, Line> = {
    A: { color: '#f2611c', stops: [['Kauppatori', 0], ['Suomenlinna main quay', 15]], vessel: 'MS Lokki', fare: '€5.90' },
    B: { color: '#0a9f9a', stops: [['Kauppatori', 0], ['Lonna', 10]], vessel: 'MS Tiira', fare: '€4.50' },
    C: { color: '#df2d86', stops: [['Kauppatori', 0], ['Lonna', 10], ['Vallisaari', 25]], vessel: 'MS Kuikka', fare: '€7.20' },
    D: { color: '#2058d4', stops: [['Kauppatori', 0], ['Katajanokka', 8], ['Lonna', 18], ['Kauppatori', 35]], vessel: 'MS Haahka', fare: '€9.00' }
  };
  const DEPS: Departure[] = [
    { t: '08:20', line: 'A', pier: '2', status: 'ok' },
    { t: '08:50', line: 'B', pier: '3', status: 'board' },
    { t: '09:15', line: 'A', pier: '2', status: 'ok' },
    { t: '09:40', line: 'C', pier: '4', status: 'late' },
    { t: '10:05', line: 'D', pier: '1', status: 'ok' },
    { t: '10:20', line: 'A', pier: '2', status: 'ok' },
    { t: '10:45', line: 'B', pier: '3', status: 'ok' },
    { t: '11:10', line: 'C', pier: '4', status: 'ok' },
    { t: '11:35', line: 'D', pier: '1', status: 'ok' }
  ];
  const STATUS: Record<Status, string> = { ok: 'On time', board: 'Boarding', late: 'Delayed 5 min' };

  const addMin = (t: string, m: number) => {
    const [h, mm] = t.split(':').map(Number);
    const x = h * 60 + mm + m;
    return String(Math.floor(x / 60) % 24).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
  };
  const dest = (L: LineId) => (L === 'D' ? 'Harbour loop' : LINES[L].stops[LINES[L].stops.length - 1][0]);
  const via = (L: LineId) => {
    const s = LINES[L].stops;
    if (L === 'D') return 'via Katajanokka and Lonna';
    return s.length > 2 ? 'via ' + s.slice(1, -1).map((x) => x[0]).join(', ') : 'Direct';
  };
  const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c as '&' | '<' | '>' | '"']));

  const d = new Date();
  $('#stamp').innerHTML = esc(d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()) + '<br>Sample timetable';

  /* ---------- Departures list ---------- */
  const list = $('#deps');
  list.innerHTML = DEPS.map((dep, i) => {
    const L = LINES[dep.line];
    return '<li><button class="dep" type="button" data-i="' + i + '" aria-haspopup="dialog">' +
      '<time>' + dep.t + '</time>' +
      '<span><span class="to">' + esc(dest(dep.line)) + '</span><span class="via">' + esc(via(dep.line)) + ' · pier ' + dep.pier + '</span></span>' +
      '<span class="end"><span class="chip ' + dep.status + '">' + STATUS[dep.status] + '</span>' +
      '<span class="badge" style="background:' + L.color + '">' + dep.line + '</span>' +
      '<span class="chev" aria-hidden="true">›</span></span>' +
      '</button></li>';
  }).join('');

  /* ---------- Library setup ---------- */
  const app = $('#app');
  const level = $<HTMLInputElement>('#level');
  const overlay = Overlay.mount($('#stage'), { target: app, level: +level.value / 100 });
  const sheets = Sheets.create({
    scanDuration: +$<HTMLInputElement>('#scanDur').value * 1000,
    feedDuration: +$<HTMLInputElement>('#openDur').value * 1000,
    closeDuration: +$<HTMLInputElement>('#closeDur').value * 1000,
    bar: 'light'
  });

  /* ---------- Details sheet ---------- */
  const sheet = $('#sheet');
  const mainPage = $('#mainPage');
  const tickets: Record<number, number> = {};
  let current = -1;
  let opener: HTMLElement | null = null;

  function fill(i: number) {
    const dep = DEPS[i], L = LINES[dep.line], last = L.stops[L.stops.length - 1];
    current = i;
    $('#dTime').textContent = dep.t;
    const b = $('#dBadge'); b.textContent = dep.line; b.style.background = L.color;
    $('#dRoute').textContent = dep.line === 'D' ? 'Harbour loop from Kauppatori' : 'Kauppatori → ' + last[0];
    const st = $('#dStatus'); st.className = 'chip ' + dep.status; st.textContent = STATUS[dep.status];
    $('#dPier').textContent = dep.pier;
    $('#dDur').textContent = last[1] + ' min';
    $('#dVessel').textContent = L.vessel;
    $('#dFare').textContent = L.fare;
    const stops = $('#dStops');
    stops.style.setProperty('--line-c', L.color);
    stops.innerHTML = L.stops.map((s) =>
      '<li><time>' + addMin(dep.t, s[1] + (dep.status === 'late' ? 5 : 0)) + '</time><span>' + esc(s[0]) + '</span></li>'
    ).join('');
    const n = tickets[i] || 0;
    $('#tripStatus').textContent = n ? n + (n === 1 ? ' ticket' : ' tickets') + ' on this departure.' : '';
    $<HTMLInputElement>('#paxName').value = '';
    $<HTMLInputElement>('#bike').checked = false;
  }

  function open(i: number, btn: HTMLElement) {
    if (sheets.isBusy(sheet) || !sheet.hidden) return;
    opener = btn;
    fill(i);
    (mainPage as HTMLElement & { inert: boolean }).inert = true;
    sheets.present(sheet).then(() => $('#backBtn').focus({ preventScroll: true }));
  }

  function close() {
    if (sheets.isBusy(sheet) || sheet.hidden) return;
    sheets.dismiss(sheet).then(() => {
      (mainPage as HTMLElement & { inert: boolean }).inert = false;
      if (opener) opener.focus({ preventScroll: true });
    });
  }

  list.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('.dep');
    if (btn) open(Number(btn.dataset.i), btn);
  });
  $('#backBtn').addEventListener('click', close);
  sheet.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  $('#tripForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (current < 0) return;
    tickets[current] = (tickets[current] || 0) + 1;
    const name = $<HTMLInputElement>('#paxName').value.trim() || 'Guest';
    const bike = $<HTMLInputElement>('#bike').checked ? ', with bicycle' : '';
    $('#tripStatus').textContent = 'Ticket ' + tickets[current] + ' added for ' + name + bike + '.';
    $<HTMLInputElement>('#paxName').value = '';
    $<HTMLInputElement>('#bike').checked = false;
  });

  /* ---------- Controls ---------- */
  const levelOut = $('#levelOut');
  const showLevel = () => { levelOut.textContent = level.value + '%'; };
  showLevel();
  level.addEventListener('input', () => { showLevel(); overlay.setLevel(+level.value / 100); });

  const fx = $<HTMLInputElement>('#fx');
  fx.addEventListener('change', () => { overlay.setEnabled(fx.checked); level.disabled = !fx.checked; });

  ([['scanDur', 'scanDuration'], ['openDur', 'feedDuration'], ['closeDur', 'closeDuration']] as const).forEach(([id, key]) => {
    const inp = $<HTMLInputElement>('#' + id), out = $('#' + id + 'Out');
    const show = () => { out.textContent = (+inp.value).toFixed(1) + ' s'; };
    show();
    inp.addEventListener('input', () => { show(); sheets.update({ [key]: +inp.value * 1000 }); });
  });

  const thick = $<HTMLInputElement>('#barThick');
  const showThick = () => { $('#barThickOut').textContent = thick.value + ' vw'; };
  showThick();
  thick.addEventListener('input', () => { showThick(); sheets.update({ barThickness: +thick.value }); });

  document.querySelectorAll<HTMLInputElement>('input[name="bar"]').forEach((r) => {
    r.addEventListener('change', () => { if (r.checked) {
      const bar = r.value as 'light' | 'line' | 'none';
      if (bar !== 'none') { thick.value = String(Sheets.BAR_DEFAULT_VW[bar]); showThick(); }
      sheets.update({ bar, barThickness: bar === 'none' ? null : +thick.value });
    }; });
  });

  /* ---------- Copy snippet ---------- */
  const copyBtn = $('#copyBtn');
  const snippet = $('#snippet');
  copyBtn.addEventListener('click', () => {
    const fallback = () => {
      const r = document.createRange(); r.selectNodeContents(snippet);
      const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
      copyBtn.textContent = 'Selected';
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(snippet.textContent ?? '').then(() => { copyBtn.textContent = 'Copied'; }, fallback);
    } else { fallback(); }
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1800);
  });
})();
