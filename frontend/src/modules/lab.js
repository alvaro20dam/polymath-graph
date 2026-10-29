// FrontendUIX_Agent · skill: interactive_canvas_builder — Laboratorio de simulaciones en el navegador
import { el, nodeChip } from '../state.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function fitCanvas(canvas, aspect = 0.62) {
  const w = canvas.clientWidth || 600;
  const dpr = window.devicePixelRatio || 1;
  const h = Math.round(w * aspect);
  canvas.style.height = h + 'px';
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function slider(label, { min, max, step = 1, value, fmt = (v) => v, onInput }) {
  const out = el('b', {}, fmt(value));
  const input = el('input', { type: 'range', min, max, step, value, 'aria-label': label });
  input.addEventListener('input', () => { out.textContent = fmt(+input.value); onInput(+input.value); });
  const wrap = el('label', { class: 'field' }, el('span', {}, label + ': ', out), input);
  wrap.set = (v) => { input.value = v; out.textContent = fmt(v); };
  return wrap;
}
const stat = (label, valueEl) => el('div', { class: 'stat' }, valueEl, el('span', {}, label));

function useRaf(fn) {
  let id = 0, running = false;
  const loop = (t) => { if (!running) return; fn(t); id = requestAnimationFrame(loop); };
  return {
    start() { if (!running) { running = true; id = requestAnimationFrame(loop); } },
    stop() { running = false; cancelAnimationFrame(id); },
    get running() { return running; },
  };
}

/* ======================================================================
   1. Esperanza, varianza y ley de los grandes números
   ====================================================================== */
const EV_PRESETS = {
  coin: { name: 'Moneda sesgada (cara = 1)', make: (p) => [{ v: 1, p, label: 'Cara (1)' }, { v: 0, p: 1 - p, label: 'Cruz (0)' }], hasP: true },
  die: { name: 'Dado justo (1–6)', make: () => [1, 2, 3, 4, 5, 6].map((v) => ({ v, p: 1 / 6, label: String(v) })) },
  bet: { name: 'Apuesta: 6 gana $10, si no pierdes $2', make: () => [{ v: 10, p: 1 / 6, label: '+$10' }, { v: -2, p: 5 / 6, label: '−$2' }] },
  lottery: { name: 'Lotería: premio $1000, ticket $1', make: () => [{ v: 999, p: 0.0009, label: '+$999' }, { v: -1, p: 0.9991, label: '−$1' }] },
};

function simEV(box) {
  const s = { preset: 'bet', p: 0.5, outcomes: [], n: 0, sum: 0, sumsq: 0, counts: [], hist: [] };
  const canvas = el('canvas');
  const E = el('b'), V = el('b'), N = el('b'), M = el('b'), SV = el('b'), ERR = el('b');
  const presetSel = el('select', { 'aria-label': 'Experimento' }, ...Object.entries(EV_PRESETS).map(([k, v]) => el('option', { value: k, selected: k === s.preset }, v.name)));
  const pSlider = slider('P(cara)', { min: 0.01, max: 0.99, step: 0.01, value: s.p, fmt: (v) => v.toFixed(2), onInput: (v) => { s.p = v; reset(); } });
  const raf = useRaf(() => { for (let i = 0; i < 4; i++) sample(); draw(); });
  const autoBtn = el('button', { class: 'btn', onclick: () => { raf.running ? raf.stop() : raf.start(); autoBtn.textContent = raf.running ? '⏸ Pausar' : '▶ Auto'; } }, '▶ Auto');

  function reset() {
    raf.stop(); autoBtn.textContent = '▶ Auto';
    s.outcomes = EV_PRESETS[s.preset].make(s.p);
    s.n = 0; s.sum = 0; s.sumsq = 0; s.counts = s.outcomes.map(() => 0); s.hist = [];
    pSlider.hidden = !EV_PRESETS[s.preset].hasP;
    draw();
  }
  function sample() {
    if (s.n >= 200000) return;
    let u = Math.random(), idx = 0;
    for (; idx < s.outcomes.length - 1; idx++) { if (u < s.outcomes[idx].p) break; u -= s.outcomes[idx].p; }
    const v = s.outcomes[idx].v;
    s.n++; s.sum += v; s.sumsq += v * v; s.counts[idx]++;
    if (s.n <= 3000 || s.n % 10 === 0) s.hist.push([s.n, s.sum / s.n]);
  }
  const add = (k) => () => { for (let i = 0; i < k; i++) sample(); draw(); };
  const theory = () => {
    const mu = s.outcomes.reduce((a, o) => a + o.v * o.p, 0);
    const va = s.outcomes.reduce((a, o) => a + (o.v - mu) ** 2 * o.p, 0);
    return { mu, va };
  };

  function draw() {
    const { ctx, w, h } = fitCanvas(canvas, 0.72);
    const { mu, va } = theory();
    const sd = Math.sqrt(va);
    ctx.clearRect(0, 0, w, h);
    const topH = h * 0.58, pad = 36;
    // --- gráfico superior: media móvil (eje x logarítmico)
    const xMax = Math.max(100, s.n);
    const X = (n) => pad + (Math.log10(Math.max(1, n)) / Math.log10(xMax)) * (w - pad - 12);
    const vals = s.hist.map((p) => p[1]);
    const band = (n) => (2 * sd) / Math.sqrt(n);
    let lo = mu - band(1) * 0.9, hi = mu + band(1) * 0.9;
    if (sd === 0) { lo = mu - 1; hi = mu + 1; }
    vals.forEach((v) => { lo = Math.min(lo, v); hi = Math.max(hi, v); });
    const Y = (v) => 12 + (1 - (v - lo) / (hi - lo || 1)) * (topH - 26);
    ctx.strokeStyle = '#262f4d'; ctx.fillStyle = '#98a1bd'; ctx.font = '11px sans-serif'; ctx.lineWidth = 1;
    for (let d = 0; Math.pow(10, d) <= xMax; d++) { const x = X(10 ** d); ctx.beginPath(); ctx.moveTo(x, 8); ctx.lineTo(x, topH - 12); ctx.stroke(); ctx.fillText(String(10 ** d), x - 4, topH + 2); }
    // banda ±2σ/√n
    ctx.fillStyle = 'rgba(124,140,255,.16)'; ctx.beginPath();
    for (let n = 1; n <= xMax; n *= 1.15) ctx.lineTo(X(n), Y(mu + band(n)));
    for (let n = xMax; n >= 1; n /= 1.15) ctx.lineTo(X(n), Y(mu - band(n)));
    ctx.closePath(); ctx.fill();
    ctx.setLineDash([6, 4]); ctx.strokeStyle = '#34d399'; ctx.beginPath(); ctx.moveTo(pad, Y(mu)); ctx.lineTo(w - 12, Y(mu)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#34d399'; ctx.fillText('E[X] = ' + mu.toFixed(3), pad + 4, Y(mu) - 5);
    ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1.6; ctx.beginPath();
    s.hist.forEach(([n, v], i) => (i ? ctx.lineTo(X(n), Y(v)) : ctx.moveTo(X(n), Y(v)))); ctx.stroke();
    ctx.fillStyle = '#98a1bd'; ctx.fillText('media muestral (amarillo) · banda ±2σ/√n (violeta) · n en escala log', pad, 11);
    // --- histograma inferior
    const base = h - 28, bh = h - topH - 56, k = s.outcomes.length, bw = Math.min(60, (w - 2 * pad) / k - 8);
    const maxP = Math.max(...s.outcomes.map((o, i) => Math.max(o.p, s.n ? s.counts[i] / s.n : 0)), 0.01);
    s.outcomes.forEach((o, i) => {
      const x = pad + (i + 0.5) * ((w - 2 * pad) / k) - bw / 2;
      const th = (o.p / maxP) * bh, em = s.n ? (s.counts[i] / s.n / maxP) * bh : 0;
      ctx.fillStyle = 'rgba(52,211,153,.35)'; ctx.fillRect(x, base - th, bw, th);
      ctx.fillStyle = '#7c8cff'; ctx.fillRect(x + bw * 0.2, base - em, bw * 0.6, em);
      ctx.fillStyle = '#98a1bd'; ctx.textAlign = 'center'; ctx.fillText(o.label, x + bw / 2, base + 14); ctx.textAlign = 'left';
    });
    ctx.fillStyle = '#98a1bd'; ctx.fillText('frecuencia observada (azul) vs probabilidad teórica (verde)', pad, topH + 22);
    // estadísticas
    const mean = s.n ? s.sum / s.n : 0;
    const svar = s.n > 1 ? (s.sumsq - s.n * mean * mean) / (s.n - 1) : 0;
    E.textContent = mu.toFixed(3); V.textContent = va.toFixed(3); N.textContent = s.n.toLocaleString();
    M.textContent = s.n ? mean.toFixed(3) : '—'; SV.textContent = s.n > 1 ? svar.toFixed(3) : '—'; ERR.textContent = s.n ? Math.abs(mean - mu).toFixed(3) : '—';
  }

  presetSel.addEventListener('change', () => { s.preset = presetSel.value; reset(); });
  const controls = el('div', { class: 'panel' },
    el('h3', {}, 'Esperanza y grandes números'),
    el('p', { class: 'muted' }, 'Lanza muestras y observa cómo la media converge a E[X], con una incertidumbre que decrece como σ/√n.'),
    el('label', { class: 'field' }, el('span', {}, 'Experimento'), presetSel), pSlider,
    el('div', { class: 'row' }, el('button', { class: 'btn', onclick: add(1) }, '+1'), el('button', { class: 'btn', onclick: add(10) }, '+10'), el('button', { class: 'btn', onclick: add(100) }, '+100'), el('button', { class: 'btn', onclick: add(1000) }, '+1000'), autoBtn, el('button', { class: 'btn ghost', onclick: reset }, '↺')),
    el('div', { class: 'stats' }, stat('E[X] teórica', E), stat('Var(X) teórica', V), stat('n muestras', N), stat('media muestral', M), stat('varianza muestral', SV), stat('|media − E[X]|', ERR)),
    el('div', { class: 'callout', style: 'margin-top:.8rem' }, 'Prueba la «Lotería»: esperanza ≈ −0.1 pero varianza enorme; con pocas muestras casi siempre pierdes, y de vez en cuando… ¡ganas muchísimo!'));
  box.append(el('div', { class: 'sim' }, controls, canvas));
  const onResize = () => draw();
  window.addEventListener('resize', onResize);
  reset();
  return () => { raf.stop(); window.removeEventListener('resize', onResize); };
}

/* ======================================================================
   2. Descenso del gradiente
   ====================================================================== */
const GD_FUNCS = {
  bowl: {
    name: 'Cuenco elíptico  f = x² + k·y²', dom: 5, start: [4, 3],
    f: (x, y, k) => x * x + k * y * y,
    g: (x, y, k) => [2 * x, 2 * k * y],
    minima: [[0, 0]], hasK: true,
  },
  himmel: {
    name: 'Himmelblau (4 mínimos)', dom: 6, start: [-0.5, 0.5],
    f: (x, y) => (x * x + y - 11) ** 2 + (x + y * y - 7) ** 2,
    g: (x, y) => [4 * x * (x * x + y - 11) + 2 * (x + y * y - 7), 2 * (x * x + y - 11) + 4 * y * (x + y * y - 7)],
    minima: [[3, 2], [-2.805, 3.131], [-3.779, -3.283], [3.584, -1.848]],
  },
};

function simGD(box) {
  const s = { fn: 'bowl', k: 5, lrExp: 52, mu: 0, path: [], v: [0, 0], diverged: false, bg: null };
  const canvas = el('canvas');
  const lrOf = (e) => 10 ** (-3 + 3.3 * (e / 100));
  const lr = () => lrOf(s.lrExp);
  const IT = el('b'), POS = el('b'), FV = el('b'), GN = el('b');
  const fnSel = el('select', { 'aria-label': 'Función' }, ...Object.entries(GD_FUNCS).map(([k, v]) => el('option', { value: k }, v.name)));
  const kSlider = slider('k (curvatura en y)', { min: 1, max: 20, step: 0.5, value: s.k, onInput: (v) => { s.k = v; s.bg = null; restart(); } });
  const lrSlider = slider('Tasa de aprendizaje η', { min: 0, max: 100, step: 1, value: s.lrExp, fmt: (v) => { const l = lrOf(v); return l.toFixed(l < 0.1 ? 4 : 3); }, onInput: (v) => { s.lrExp = v; } });
  const muSlider = slider('Momento μ', { min: 0, max: 0.95, step: 0.05, value: 0, fmt: (v) => v.toFixed(2), onInput: (v) => { s.mu = v; } });
  const warn = el('div', { class: 'callout warn', hidden: true }, '⚠ El método divergió: la tasa de aprendizaje es demasiado grande para esta curvatura.');
  let last = 0;
  const raf = useRaf((t) => { if (t - last > 70) { last = t; stepOnce(); draw(); } });
  const runBtn = el('button', { class: 'btn primary', onclick: () => { raf.running ? raf.stop() : raf.start(); runBtn.textContent = raf.running ? '⏸ Pausar' : '▶ Ejecutar'; } }, '▶ Ejecutar');
  const F = () => GD_FUNCS[s.fn];

  function restart(start) {
    raf.stop(); runBtn.textContent = '▶ Ejecutar';
    const p = start ?? F().start;
    s.path = [[p[0], p[1]]]; s.v = [0, 0]; s.diverged = false; warn.hidden = true; kSlider.hidden = !F().hasK;
    draw();
  }
  function stepOnce() {
    if (s.diverged) return;
    const [x, y] = s.path[s.path.length - 1];
    const [gx, gy] = F().g(x, y, s.k);
    s.v = [s.mu * s.v[0] - lr() * gx, s.mu * s.v[1] - lr() * gy];
    const nx = x + s.v[0], ny = y + s.v[1];
    s.path.push([nx, ny]);
    if (!isFinite(nx) || !isFinite(ny) || Math.abs(nx) > 1e4 || Math.abs(ny) > 1e4) { s.diverged = true; warn.hidden = false; raf.stop(); runBtn.textContent = '▶ Ejecutar'; }
    if (s.path.length > 3000) raf.stop();
  }
  function background(w, h) {
    const key = `${s.fn}|${s.k}|${w}|${h}`;
    if (s.bg?.key === key) return s.bg.canvas;
    const R = 140, off = document.createElement('canvas'); off.width = R; off.height = R;
    const octx = off.getContext('2d'), img = octx.createImageData(R, R), D = F().dom;
    let maxL = 0; const vals = new Float32Array(R * R);
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const x = -D + (2 * D * i) / (R - 1), y = D - (2 * D * j) / (R - 1);
      const v = Math.log1p(F().f(x, y, s.k)); vals[j * R + i] = v; maxL = Math.max(maxL, v);
    }
    for (let q = 0; q < R * R; q++) {
      const t = vals[q] / maxL, band = Math.floor(vals[q] * 2.2) % 2 ? 0.88 : 1;
      img.data[q * 4] = (20 + 200 * t ** 1.4) * band; img.data[q * 4 + 1] = (24 + 70 * t) * band; img.data[q * 4 + 2] = (70 + 120 * (1 - t)) * band; img.data[q * 4 + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    s.bg = { key, canvas: off };
    return off;
  }
  function draw() {
    const { ctx, w, h } = fitCanvas(canvas, 0.8);
    const D = F().dom;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(background(w, h), 0, 0, w, h);
    const X = (x) => ((x + D) / (2 * D)) * w, Y = (y) => ((D - y) / (2 * D)) * h;
    ctx.fillStyle = '#34d399';
    F().minima.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(X(x), Y(y), 5, 0, 7); ctx.fill(); });
    ctx.lineWidth = 2; ctx.strokeStyle = '#fbbf24'; ctx.beginPath();
    s.path.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.stroke();
    ctx.fillStyle = '#fff';
    s.path.slice(-60).forEach(([x, y]) => { ctx.beginPath(); ctx.arc(X(x), Y(y), 2.4, 0, 7); ctx.fill(); });
    const [sx, sy] = s.path[0]; ctx.strokeStyle = '#fff'; ctx.strokeRect(X(sx) - 5, Y(sy) - 5, 10, 10);
    ctx.fillStyle = '#e6e9f5'; ctx.font = '12px sans-serif'; ctx.fillText('Haz clic para elegir el punto de partida', 10, h - 10);
    const [cx, cy] = s.path[s.path.length - 1];
    IT.textContent = s.path.length - 1; POS.textContent = isFinite(cx) ? `(${cx.toFixed(2)}, ${cy.toFixed(2)})` : '∞';
    const fv = F().f(cx, cy, s.k), g = F().g(cx, cy, s.k);
    FV.textContent = isFinite(fv) ? fv.toPrecision(4) : '∞'; GN.textContent = isFinite(g[0]) ? Math.hypot(g[0], g[1]).toPrecision(3) : '∞';
  }
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect(), D = F().dom;
    restart([-D + (2 * D * (e.clientX - r.left)) / r.width, D - (2 * D * (e.clientY - r.top)) / r.height]);
  });
  fnSel.addEventListener('change', () => { s.fn = fnSel.value; s.bg = null; s.lrExp = s.fn === 'himmel' ? 36 : 52; lrSlider.set(s.lrExp); restart(); });

  const controls = el('div', { class: 'panel' },
    el('h3', {}, 'Descenso del gradiente'),
    el('p', { class: 'muted' }, 'θ ← θ − η·∇f(θ). Prueba η grande en el cuenco (k = 5, η ≈ 0.2 oscila; mayor diverge) y agrega momento.'),
    el('label', { class: 'field' }, el('span', {}, 'Función'), fnSel), kSlider, lrSlider, muSlider,
    el('div', { class: 'row' }, runBtn, el('button', { class: 'btn', onclick: () => { stepOnce(); draw(); } }, 'Paso'), el('button', { class: 'btn ghost', onclick: () => restart() }, '↺ Reiniciar')),
    warn,
    el('div', { class: 'stats' }, stat('iteraciones', IT), stat('posición', POS), stat('f(x, y)', FV), stat('‖∇f‖', GN)));
  box.append(el('div', { class: 'sim' }, controls, canvas));
  const onResize = () => draw();
  window.addEventListener('resize', onResize);
  restart();
  return () => { raf.stop(); window.removeEventListener('resize', onResize); };
}

/* ======================================================================
   3. Perceptrón / red neuronal pequeña
   ====================================================================== */
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const gauss = (rnd) => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

function makeData(kind) {
  const rnd = mulberry32(7), pts = [];
  const blob = (cx, cy, sd, label, n) => { for (let i = 0; i < n; i++) pts.push({ x: cx + gauss(rnd) * sd, y: cy + gauss(rnd) * sd, y01: label }); };
  if (kind === 'linear') { blob(-0.5, -0.4, 0.22, 0, 50); blob(0.5, 0.4, 0.22, 1, 50); }
  else if (kind === 'xor') { blob(-0.55, -0.55, 0.16, 0, 30); blob(0.55, 0.55, 0.16, 0, 30); blob(-0.55, 0.55, 0.16, 1, 30); blob(0.55, -0.55, 0.16, 1, 30); }
  else { for (let i = 0; i < 100; i++) { const a = rnd() * 6.283, inner = i < 50, r = inner ? rnd() * 0.4 : 0.65 + rnd() * 0.28; pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, y01: inner ? 1 : 0 }); } }
  return pts;
}

class TinyNet {
  constructor(h) {
    this.h = h;
    const r = () => gauss(Math.random) * 0.8;
    this.W1 = Array.from({ length: h }, () => [r(), r()]); this.b1 = Array(h).fill(0); this.w2 = Array.from({ length: Math.max(h, 2) }, r); this.b2 = 0;
    if (h === 0) this.w2 = [r(), r()];
  }
  forward(x, y) {
    if (this.h === 0) { const z = this.w2[0] * x + this.w2[1] * y + this.b2; return { p: 1 / (1 + Math.exp(-z)) }; }
    const a = this.W1.map((w, i) => Math.tanh(w[0] * x + w[1] * y + this.b1[i]));
    const z = a.reduce((s, ai, i) => s + ai * this.w2[i], this.b2);
    return { p: 1 / (1 + Math.exp(-z)), a };
  }
  train(data, lr) {
    const N = data.length, h = this.h;
    const gW1 = Array.from({ length: h }, () => [0, 0]), gb1 = Array(h).fill(0), gw2 = this.w2.map(() => 0); let gb2 = 0, loss = 0, ok = 0;
    for (const d of data) {
      const { p, a } = this.forward(d.x, d.y), dz2 = p - d.y01;
      loss += -(d.y01 * Math.log(p + 1e-9) + (1 - d.y01) * Math.log(1 - p + 1e-9)); ok += (p > 0.5) === (d.y01 === 1);
      if (h === 0) { gw2[0] += dz2 * d.x; gw2[1] += dz2 * d.y; gb2 += dz2; continue; }
      for (let i = 0; i < h; i++) {
        gw2[i] += dz2 * a[i];
        const dz1 = dz2 * this.w2[i] * (1 - a[i] * a[i]);
        gW1[i][0] += dz1 * d.x; gW1[i][1] += dz1 * d.y; gb1[i] += dz1;
      }
      gb2 += dz2;
    }
    for (let i = 0; i < h; i++) { this.W1[i][0] -= (lr * gW1[i][0]) / N; this.W1[i][1] -= (lr * gW1[i][1]) / N; this.b1[i] -= (lr * gb1[i]) / N; }
    this.w2 = this.w2.map((w, i) => w - (lr * gw2[i]) / N); this.b2 -= (lr * gb2) / N;
    return { loss: loss / N, acc: ok / N };
  }
}

function simNN(box) {
  const s = { data: makeData('xor'), kind: 'xor', h: 4, lr: 0.8, epoch: 0, net: null, loss: 0, acc: 0 };
  const canvas = el('canvas');
  const EP = el('b'), LS = el('b'), AC = el('b');
  const kindSel = el('select', { 'aria-label': 'Conjunto de datos' }, el('option', { value: 'linear' }, 'Linealmente separable'), el('option', { value: 'xor', selected: true }, 'XOR'), el('option', { value: 'circle' }, 'Círculo concéntrico'));
  const hSlider = slider('Neuronas ocultas (0 = perceptrón único)', { min: 0, max: 8, step: 1, value: s.h, onInput: (v) => { s.h = v; reinit(); } });
  const lrSlider = slider('Tasa de aprendizaje', { min: 0.05, max: 3, step: 0.05, value: s.lr, fmt: (v) => v.toFixed(2), onInput: (v) => { s.lr = v; } });
  const raf = useRaf(() => { for (let i = 0; i < 12; i++) step(); draw(); });
  const runBtn = el('button', { class: 'btn primary', onclick: () => { raf.running ? raf.stop() : raf.start(); runBtn.textContent = raf.running ? '⏸ Pausar' : '▶ Entrenar'; } }, '▶ Entrenar');

  function reinit() { raf.stop(); runBtn.textContent = '▶ Entrenar'; s.net = new TinyNet(s.h); s.epoch = 0; const r = s.net.train(s.data, 0); s.loss = r.loss; s.acc = r.acc; draw(); }
  function step() { const r = s.net.train(s.data, s.lr); s.epoch++; s.loss = r.loss; s.acc = r.acc; }
  function draw() {
    const { ctx, w, h } = fitCanvas(canvas, 0.85);
    const G = 46, cw = w / G, ch = h / G;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const x = -1 + (2 * (i + 0.5)) / G, y = 1 - (2 * (j + 0.5)) / G, p = s.net.forward(x, y).p;
      ctx.fillStyle = `rgba(${Math.round(56 + 190 * p)},${Math.round(150 - 20 * p)},${Math.round(248 - 190 * p)},.45)`;
      ctx.fillRect(i * cw, j * ch, cw + 1, ch + 1);
    }
    s.data.forEach((d) => { ctx.beginPath(); ctx.arc(((d.x + 1) / 2) * w, ((1 - d.y) / 2) * h, 4.5, 0, 7); ctx.fillStyle = d.y01 ? '#fb923c' : '#38bdf8'; ctx.fill(); ctx.strokeStyle = '#0b0e17'; ctx.lineWidth = 1.2; ctx.stroke(); });
    EP.textContent = s.epoch; LS.textContent = s.loss.toFixed(3); AC.textContent = (s.acc * 100).toFixed(0) + '%';
  }
  kindSel.addEventListener('change', () => { s.kind = kindSel.value; s.data = makeData(s.kind); reinit(); });
  const controls = el('div', { class: 'panel' },
    el('h3', {}, 'Perceptrón y red neuronal'),
    el('p', { class: 'muted' }, 'Entrena en tu navegador con retropropagación. Con 0 neuronas ocultas una sola neurona solo traza una recta: ¿puede resolver XOR?'),
    el('label', { class: 'field' }, el('span', {}, 'Datos'), kindSel), hSlider, lrSlider,
    el('div', { class: 'row' }, runBtn, el('button', { class: 'btn', onclick: () => { for (let i = 0; i < 100; i++) step(); draw(); } }, '+100 épocas'), el('button', { class: 'btn ghost', onclick: reinit }, '↺ Reinicializar')),
    el('div', { class: 'stats' }, stat('época', EP), stat('pérdida (BCE)', LS), stat('precisión', AC)),
    el('div', { class: 'callout', style: 'margin-top:.8rem' }, 'Naranja y azul son las dos clases; el fondo muestra la probabilidad que predice la red.'));
  box.append(el('div', { class: 'sim' }, controls, canvas));
  const onResize = () => draw();
  window.addEventListener('resize', onResize);
  reinit();
  return () => { raf.stop(); window.removeEventListener('resize', onResize); };
}

/* ======================================================================
   4. Teorema de Bayes con frecuencias naturales
   ====================================================================== */
function largestRemainder(values, total) {
  const sum = values.reduce((a, b) => a + b, 0) || 1;
  const raw = values.map((v) => (v / sum) * total), flo = raw.map(Math.floor);
  let rest = total - flo.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - flo[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rest-- > 0) flo[i]++; });
  return flo;
}

function simBayes(box) {
  const s = { prev: 1, sens: 90, fpr: 9 };
  const canvas = el('canvas');
  const post = el('div', { class: 'big-number' }), detail = el('p', { class: 'muted' });
  const sliders = {
    prev: slider('Prevalencia (prior)', { min: 0.1, max: 50, step: 0.1, value: s.prev, fmt: (v) => v.toFixed(1) + '%', onInput: (v) => { s.prev = v; draw(); } }),
    sens: slider('Sensibilidad P(+|enfermo)', { min: 50, max: 100, step: 1, value: s.sens, fmt: (v) => v + '%', onInput: (v) => { s.sens = v; draw(); } }),
    fpr: slider('Falsos positivos P(+|sano)', { min: 0, max: 40, step: 0.5, value: s.fpr, fmt: (v) => v + '%', onInput: (v) => { s.fpr = v; draw(); } }),
  };
  const preset = (p, sn, f) => () => { Object.assign(s, { prev: p, sens: sn, fpr: f }); sliders.prev.set(p); sliders.sens.set(sn); sliders.fpr.set(f); draw(); };
  const COL = { tp: '#f87171', fn: '#7c3a3a', fp: '#fbbf24', tn: '#2a3358' };

  function draw() {
    const { ctx, w, h } = fitCanvas(canvas, 0.62);
    const pr = s.prev / 100, se = s.sens / 100, fp = s.fpr / 100;
    const tp = pr * se, fn = pr * (1 - se), fpp = (1 - pr) * fp, tn = (1 - pr) * (1 - fp);
    const post_ = tp + fpp > 0 ? tp / (tp + fpp) : 0;
    const dots = largestRemainder([tp, fn, fpp, tn], 1000);
    const keys = ['tp', 'fn', 'fp', 'tn'], cols = 50, rows = 20, cell = Math.min((w - 10) / cols, (h - 70) / rows), r = cell * 0.36;
    const x0 = (w - cols * cell) / 2;
    ctx.clearRect(0, 0, w, h);
    let idx = 0;
    keys.forEach((k, ki) => { for (let n = 0; n < dots[ki]; n++, idx++) { const c = idx % cols, rw = Math.floor(idx / cols); ctx.fillStyle = COL[k]; ctx.beginPath(); ctx.arc(x0 + (c + 0.5) * cell, 8 + (rw + 0.5) * cell, r, 0, 7); ctx.fill(); } });
    const ly = 8 + rows * cell + 16; ctx.font = '12px sans-serif';
    [['tp', 'Enfermos con +'], ['fn', 'Enfermos con −'], ['fp', 'Sanos con +'], ['tn', 'Sanos con −']].forEach(([k, t], i) => { ctx.fillStyle = COL[k]; ctx.fillRect(10 + i * (w / 4), ly, 11, 11); ctx.fillStyle = '#98a1bd'; ctx.fillText(t, 26 + i * (w / 4), ly + 10); });
    ctx.fillStyle = '#98a1bd'; ctx.fillText('Cada punto = 1/1000 de la población', 10, ly + 30);
    const N = 10000;
    post.textContent = (post_ * 100).toFixed(1) + '%';
    detail.innerHTML = `De cada <b>${N.toLocaleString()}</b> personas: <b style="color:${COL.tp}">${Math.round(tp * N)}</b> enfermos dan positivo y <b style="color:${COL.fp}">${Math.round(fpp * N)}</b> sanos también. Entre los <b>${Math.round((tp + fpp) * N)}</b> positivos, solo ${Math.round(tp * N)} están enfermos.`;
  }
  const controls = el('div', { class: 'panel' },
    el('h3', {}, 'Teorema de Bayes'),
    el('p', { class: 'muted' }, 'P(enfermo | positivo) = P(+|enfermo)·P(enfermo) / P(+). Mueve los controles y observa cómo la prevalencia domina.'),
    sliders.prev, sliders.sens, sliders.fpr,
    el('div', { class: 'row' }, el('button', { class: 'btn small', onclick: preset(1, 90, 9) }, 'Ejemplo del tutor'), el('button', { class: 'btn small', onclick: preset(30, 90, 9) }, 'Enfermedad común'), el('button', { class: 'btn small', onclick: preset(1, 99, 1) }, 'Prueba muy precisa')),
    el('h4', { style: 'margin-top:1rem' }, 'P(enfermo | positivo)'), post, detail);
  box.append(el('div', { class: 'sim' }, controls, canvas));
  const onResize = () => draw();
  window.addEventListener('resize', onResize);
  draw();
  return () => window.removeEventListener('resize', onResize);
}

/* ====================================================================== */
const SIMS = [
  { id: 'ev', title: 'Esperanza y grandes números', desc: 'E[X], varianza y convergencia', nodes: ['expected_value', 'variance', 'law_large_numbers'], mount: simEV },
  { id: 'bayes', title: 'Teorema de Bayes', desc: 'Frecuencias naturales y tasa base', nodes: ['bayes_theorem', 'cognitive_biases'], mount: simBayes },
  { id: 'gd', title: 'Descenso del gradiente', desc: 'Tasa de aprendizaje y momento', nodes: ['gradient_descent', 'calculus'], mount: simGD },
  { id: 'nn', title: 'Perceptrón y red neuronal', desc: 'Entrena con retropropagación', nodes: ['perceptron', 'neural_networks', 'backpropagation'], mount: simNN },
];

export function mount(root) {
  const nav = el('nav', { class: 'lab-nav', 'aria-label': 'Simulaciones' }, el('h2', {}, 'Laboratorio'), el('p', { class: 'muted' }, 'Manipula parámetros en tiempo real y observa el comportamiento.'));
  const main = el('div', { class: 'lab-main' });
  root.append(el('div', { class: 'lab' }, nav, main));
  let destroy = null, current = null;
  const btns = {};
  SIMS.forEach((sim) => {
    const b = el('button', { class: 'problem-btn', onclick: () => open(sim.id) }, el('b', {}, sim.title), el('div', { class: 'meta' }, el('span', {}, sim.desc)));
    btns[sim.id] = b; nav.append(b);
  });
  function open(id) {
    if (current === id) return;
    destroy?.();
    current = id;
    const sim = SIMS.find((x) => x.id === id);
    Object.entries(btns).forEach(([k, b]) => b.classList.toggle('active', k === id));
    main.innerHTML = '';
    main.append(el('div', { class: 'row', style: 'margin-bottom:.8rem' }, el('h2', { style: 'margin:0' }, sim.title), el('span', { class: 'muted' }, 'Conceptos:'), ...sim.nodes.map((n) => nodeChip(n))));
    const holder = el('div'); main.append(holder);
    destroy = sim.mount(holder);
  }
  open('ev');
  let lastId = 'ev';
  return {
    show(params = {}) {
      const id = params.sim && SIMS.some((s) => s.id === params.sim) ? params.sim : lastId;
      if (current !== id) open(id);
    },
    hide() { // detiene animaciones al salir de la pestaña
      destroy?.(); destroy = null; lastId = current ?? lastId; current = null;
    },
  };
}
