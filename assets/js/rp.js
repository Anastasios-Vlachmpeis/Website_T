// Recurrence plot of AAPL daily data, computed in the browser.
// Core math first (also loaded by tools/build-static.mjs in Node), then the hero UI.
(function () {
  const START = '20190102';
  const N = 520;

  const MODES = {
    returns: { label: 'Log returns', m: 7, tau: 1, note: 'log returns, embedded over 7 trading days' },
    vol: { label: 'Volatility', m: 1, tau: 1, note: '20-day realized volatility' },
    price: { label: 'Log price', m: 5, tau: 5, note: 'log price, 5 lags of 5 days' },
  };

  function load(raw) {
    const n = raw.c.length;
    const dates = Array.from({ length: n }, (_, k) => raw.d.slice(k * 8, k * 8 + 8));
    const close = raw.c;
    const ret = close.map((c, k) => (k ? Math.log(c / close[k - 1]) : 0));
    const vol = ret.map((_, k) => {
      if (k < 20) return 0;
      let s = 0;
      for (let q = k - 19; q <= k; q++) s += ret[q] * ret[q];
      return Math.sqrt((s / 20) * 252);
    });
    const s = dates.indexOf(START);
    return { dates, close, ret, vol, logp: close.map(Math.log), s };
  }

  function zscore(a) {
    const mu = a.reduce((x, y) => x + y, 0) / a.length;
    const sd = Math.sqrt(a.reduce((x, y) => x + (y - mu) ** 2, 0) / a.length) || 1;
    return a.map((x) => (x - mu) / sd);
  }

  // Trailing delay embedding: point i ends on trading day s + i, so its date is the newest data it uses.
  function distances(D, mode) {
    const { m, tau } = MODES[mode];
    const base = mode === 'returns' ? D.ret : mode === 'vol' ? D.vol : D.logp;
    const lead = (m - 1) * tau;
    const z = zscore(base.slice(D.s - lead, D.s + N));
    const out = new Float32Array(N * N);
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        let acc = 0;
        for (let k = 0; k < m; k++) {
          const d = z[i + lead - k * tau] - z[j + lead - k * tau];
          acc += d * d;
        }
        out[i * N + j] = out[j * N + i] = Math.sqrt(acc);
      }
    }
    const upper = new Float32Array((N * (N - 1)) / 2);
    let p = 0;
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) upper[p++] = out[i * N + j];
    upper.sort();
    return { dist: out, sorted: upper };
  }

  const epsFor = (cache, rate) => cache.sorted[Math.min(cache.sorted.length - 1, Math.floor(rate * cache.sorted.length))];

  // Grayscale pixels, row 0 at the top. Time runs left to right and bottom to top.
  function pixels(cache, eps, put) {
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        put((N - 1 - i) * N + j, i === j || cache.dist[i * N + j] <= eps);
      }
    }
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDate = (d) => `${+d.slice(6)} ${MONTHS[+d.slice(4, 6) - 1]} ${d.slice(0, 4)}`;

  const core = { N, MODES, START, load, distances, epsFor, pixels, fmtDate };
  if (typeof window !== 'undefined') window.RP = core;
  if (typeof document === 'undefined' || !window.AAPL) return;

  // ── Hero UI ─────────────────────────────────────────

  const stage = document.querySelector('[data-rp]');
  if (!stage) return;
  const base = stage.querySelector('.plot__base');
  const over = stage.querySelector('.plot__over');
  const readout = document.querySelector('[data-readout]');
  const live = document.querySelector('[data-live]');
  const rateInput = document.querySelector('[data-eps]');
  const rateOut = document.querySelector('[data-eps-out]');
  const modeButtons = [...document.querySelectorAll('[data-mode]')];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  const D = load(window.AAPL);
  const caches = {};
  let mode = 'returns';
  let rate = +rateInput.value / 100;
  let eps = 0;

  const off = document.createElement('canvas');
  off.width = off.height = N;
  const offCtx = off.getContext('2d');
  const img = offCtx.createImageData(N, N);
  const bctx = base.getContext('2d');
  const octx = over.getContext('2d');
  base.width = base.height = N;

  const css = getComputedStyle(document.documentElement);
  const ACCENT = css.getPropertyValue('--accent').trim() || '#1f3bd6';

  function render() {
    const cache = (caches[mode] ||= distances(D, mode));
    eps = epsFor(cache, rate);
    const px = img.data;
    pixels(cache, eps, (p, on) => {
      const v = on ? 11 : 255;
      px[p * 4] = v; px[p * 4 + 1] = v; px[p * 4 + 2] = on ? 12 : 255; px[p * 4 + 3] = 255;
    });
    offCtx.putImageData(img, 0, 0);
    paintBase(N);
  }

  function paintBase(t) {
    bctx.fillStyle = '#fff';
    bctx.fillRect(0, 0, N, N);
    const s = Math.max(0, Math.min(N, Math.round(t)));
    if (s) bctx.drawImage(off, 0, N - s, s, s, 0, N - s, s, s);
  }

  let size = 0, dpr = 1;
  function resize() {
    const r = stage.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    size = r.width;
    over.width = over.height = Math.round(size * dpr);
    dirty = true;
  }

  // Cursor state. i is the row (vertical time), j the column.
  let cur = null;          // { i, j } chosen by the visitor
  let head = 0;            // idle read head along the diagonal, in days
  let lastInput = -1e9;
  let introStart = -1;
  let dirty = true;

  const clamp = (v) => Math.max(0, Math.min(N - 1, v));
  const day = (i) => D.s + i;

  function describeDay(i) {
    const k = day(i);
    const r = D.ret[k] * 100;
    return [
      `<span>${fmtDate(D.dates[k])}</span>`,
      `<span class="muted">close</span> <span>${D.close[k].toFixed(2)}</span>`,
      `<span class="muted">return</span> <span>${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(2)}%</span>`,
    ];
  }

  function describePair(i, j) {
    const cache = caches[mode];
    const d = i === j ? 0 : cache.dist[i * N + j];
    const rec = d <= eps;
    return {
      html: [
        `<span>${fmtDate(D.dates[day(i)])} <span class="muted">vs</span> ${fmtDate(D.dates[day(j)])}</span>`,
        `<span><span class="muted">distance</span> ${d.toFixed(2)} <span class="muted">ε</span> ${eps.toFixed(2)}</span>`,
        rec ? '<b>recurrent</b>' : '<span class="muted">not recurrent</span>',
      ],
      text: `${fmtDate(D.dates[day(i)])} and ${fmtDate(D.dates[day(j)])}: distance ${d.toFixed(2)}, epsilon ${eps.toFixed(2)}, ${rec ? 'recurrent' : 'not recurrent'}.`,
    };
  }

  function drawOverlay(i, j) {
    const w = over.width;
    octx.clearRect(0, 0, w, w);
    const cell = w / N;
    const x = (j + 0.5) * cell;
    const y = (N - 1 - i + 0.5) * cell;
    octx.strokeStyle = ACCENT;
    octx.globalAlpha = 0.55;
    octx.lineWidth = dpr;
    octx.beginPath();
    octx.moveTo(Math.round(x) + 0.5, 0); octx.lineTo(Math.round(x) + 0.5, w);
    octx.moveTo(0, Math.round(y) + 0.5); octx.lineTo(w, Math.round(y) + 0.5);
    octx.stroke();
    octx.globalAlpha = 1;
    const r = 5 * dpr;
    octx.fillStyle = ACCENT;
    octx.fillRect(x - r, y - r, r * 2, r * 2);
    octx.strokeStyle = '#fff';
    octx.lineWidth = 2 * dpr;
    octx.strokeRect(x - r, y - r, r * 2, r * 2);
  }

  let lastHtml = '';
  function setReadout(parts) {
    const html = parts.join('');
    if (html !== lastHtml) { readout.innerHTML = html; lastHtml = html; }
  }

  let lastNow = 0;
  function frame(now) {
    raf = 0;
    const dt = Math.min(0.1, lastNow ? (now - lastNow) / 1000 : 0);
    lastNow = now;
    if (introStart >= 0) {
      const t = Math.min(1, (now - introStart) / 1100);
      const e = 1 - Math.pow(1 - t, 3);
      paintBase(e * N);
      if (t >= 1) introStart = -1;
      dirty = true;
    }
    const idle = !cur && !reduce.matches && now - lastInput > 2500;
    if (idle) {
      head = (head + dt * 10) % N; // 10 trading days a second, one pass in 52 s
      dirty = true;
    }
    if (dirty) {
      if (cur) {
        drawOverlay(cur.i, cur.j);
        setReadout(describePair(cur.i, cur.j).html);
      } else {
        const h = Math.floor(head);
        drawOverlay(h, h);
        setReadout(describeDay(h));
      }
      dirty = false;
    }
    if (visible && !document.hidden && (introStart >= 0 || (!cur && !reduce.matches))) loop();
    else lastNow = 0;
  }
  let raf = 0;
  const loop = () => { if (!raf) raf = requestAnimationFrame(frame); };

  function fromEvent(e) {
    const r = stage.getBoundingClientRect();
    const j = clamp(Math.floor(((e.clientX - r.left) / r.width) * N));
    const i = clamp(N - 1 - Math.floor(((e.clientY - r.top) / r.height) * N));
    return { i, j };
  }

  stage.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    cur = fromEvent(e); lastInput = performance.now(); dirty = true; loop();
  });
  stage.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    cur = null; head = Math.floor(head); lastInput = performance.now(); dirty = true; loop();
    setTimeout(loop, 2600);
  });
  stage.addEventListener('click', (e) => {
    cur = fromEvent(e); lastInput = performance.now(); dirty = true; loop();
    live.textContent = describePair(cur.i, cur.j).text;
  });
  stage.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 20 : 1;
    const c = cur || { i: Math.floor(head), j: Math.floor(head) };
    const moves = { ArrowLeft: [0, -step], ArrowRight: [0, step], ArrowUp: [step, 0], ArrowDown: [-step, 0] };
    if (e.key === 'Escape') { cur = null; dirty = true; loop(); live.textContent = 'Read head resumed.'; return; }
    if (e.key === 'Home') { cur = { i: c.i, j: c.i }; }
    else if (moves[e.key]) cur = { i: clamp(c.i + moves[e.key][0]), j: clamp(c.j + moves[e.key][1]) };
    else return;
    e.preventDefault();
    lastInput = performance.now(); dirty = true; loop();
    live.textContent = describePair(cur.i, cur.j).text;
  });

  modeButtons.forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    modeButtons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    render(); dirty = true; loop();
    live.textContent = `${MODES[mode].label}. ${MODES[mode].note}.`;
  }));
  rateInput.addEventListener('input', () => {
    rate = +rateInput.value / 100;
    rateOut.textContent = `${rateInput.value}%`;
    render(); dirty = true; loop();
  });

  let visible = true;
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) loop(); }).observe(stage);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loop(); });
  new ResizeObserver(() => { resize(); loop(); }).observe(stage);

  // Reduced motion parks the head on the largest move in the window.
  let maxK = 0;
  for (let i = 0; i < N; i++) if (Math.abs(D.ret[day(i)]) > Math.abs(D.ret[day(maxK)])) maxK = i;
  head = reduce.matches ? maxK : 0;

  render();
  resize();
  if (!reduce.matches) { introStart = performance.now(); paintBase(0); }
  loop();
})();
