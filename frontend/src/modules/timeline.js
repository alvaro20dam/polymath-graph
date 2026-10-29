// Líneas de tiempo: cronología interactiva del grafo + escenarios ramificados (historia alternativa)
import * as d3 from 'd3';
import { el, graph, nodeById, nodeChip, openNode, bus, progress } from '../state.js';
import timelines from '@data/timelines.json';

const fmtYear = (y) => (y < 0 ? `${-y} a.C.` : String(y));
const idOf = (x) => (typeof x === 'object' ? x.id : x);

export function mount(root) {
  const tabs = el('div', { class: 'tabs-sub' });
  const body = el('div', { style: 'display:flex;flex-direction:column;flex:1;min-height:0' });
  const chron = chronology();
  const scen = scenarios();
  root.append(el('div', { class: 'page' }, el('div', { class: 'page-inner', style: 'display:flex;flex-direction:column;min-height:100%' },
    el('h1', { style: 'font-size:1.4rem' }, 'Líneas de tiempo y narrativas de datos'),
    el('p', { class: 'muted' }, 'La cronología se calcula a partir de los datos del grafo; los escenarios alternativos te permiten reescribir momentos históricos.'),
    tabs, body)));
  body.append(chron.el, scen.el);
  const defs = [['chron', '📈 Cronología del grafo'], ['scen', '🔀 Historias alternativas']];
  defs.forEach(([id, l]) => tabs.append(el('button', { 'data-id': id, onclick: () => open(id) }, l)));
  function open(id) {
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.id === id));
    chron.el.hidden = id !== 'chron'; scen.el.hidden = id !== 'scen';
    if (id === 'chron') chron.draw();
  }
  open('chron');
  return {
    show(params = {}) {
      if (params.scenario) { open('scen'); scen.start(params.scenario); }
      else if (!chron.el.hidden) chron.draw();
    },
    hide() { chron.stop(); },
  };
}

/* ====================== Cronología ====================== */
function chronology() {
  const container = el('div', { class: 'tl-wrap' });
  const caption = el('div', { class: 'tl-caption' }, el('span', { class: 'muted' }, 'Pasa el cursor sobre una idea, haz clic para ver su detalle o pulsa «Reproducir historia» para recorrerlas en orden cronológico.'));
  const nodes = [...graph.nodes].sort((a, b) => a.year - b.year);
  const adj = new Map(graph.nodes.map((n) => [n.id, new Set()]));
  graph.links.forEach((l) => { adj.get(l.source).add(l.target); adj.get(l.target).add(l.source); });
  const state = { idx: -1, playing: false, timer: null, selected: null };
  const scrub = el('input', { type: 'range', min: 0, max: nodes.length - 1, value: 0, 'aria-label': 'Recorrer cronología', style: 'flex:1;min-width:140px' });
  const playBtn = el('button', { class: 'btn primary', onclick: () => (state.playing ? stop() : play()) }, '▶ Reproducir historia');
  const dom = Object.entries(graph.domains);
  const filters = new Set(dom.map(([k]) => k));
  const filterRow = el('div', { class: 'row', style: 'margin-bottom:.5rem' }, ...dom.map(([k, d]) => {
    const b = el('button', { class: 'node-chip', style: `--c:${d.color}`, onclick: () => { filters.has(k) ? filters.delete(k) : filters.add(k); b.style.opacity = filters.has(k) ? 1 : 0.35; draw(); } }, d.label);
    return b;
  }));
  const controls = el('div', { class: 'row', style: 'margin-bottom:.6rem' }, playBtn, scrub);
  const wrap = el('div', { style: 'display:flex;flex-direction:column;flex:1' }, filterRow, controls, container, caption);
  let svg;

  function draw() {
    const W = Math.max(640, container.clientWidth || 900);
    const m = { l: 130, r: 24, t: 14 };
    const x = d3.scaleLinear().domain([-600, 0, 1000, 1400, 1800, 2040]).range([0, 0.12, 0.3, 0.5, 0.8, 1].map((f) => f * (W - m.l - m.r)));
    const lanes = dom.filter(([k]) => filters.has(k));
    const rowH = 15;
    // asigna filas para evitar solapes
    const placed = [];
    let y0 = m.t;
    const laneInfo = lanes.map(([k, d]) => {
      const ns = nodes.filter((n) => n.domain === k);
      const rowsEnd = [];
      ns.forEach((n) => {
        const px = x(n.year);
        let r = rowsEnd.findIndex((end) => px - end > 17);
        if (r < 0) { r = rowsEnd.length; rowsEnd.push(px); } else rowsEnd[r] = px;
        placed.push({ n, px: m.l + px, row: r, laneKey: k });
      });
      const h = Math.max(1, rowsEnd.length) * rowH + 18;
      const info = { k, d, y: y0, h };
      y0 += h;
      return info;
    });
    const H = y0 + 36;
    container.innerHTML = '';
    svg = d3.select(container).append('svg').attr('class', 'tl-svg').attr('viewBox', `0 0 ${W} ${H}`).attr('width', W).attr('height', H).attr('role', 'img').attr('aria-label', 'Cronología de ideas por disciplina');
    laneInfo.forEach((l) => {
      svg.append('rect').attr('x', 0).attr('y', l.y).attr('width', W).attr('height', l.h).attr('fill', l.d.color).attr('opacity', 0.05);
      svg.append('text').attr('x', 8).attr('y', l.y + l.h / 2 + 4).attr('fill', l.d.color).attr('font-size', 12).text(l.d.label);
    });
    const ticks = [-500, 0, 500, 1000, 1400, 1700, 1900, 2000];
    ticks.forEach((t) => {
      const tx = m.l + x(t);
      svg.append('line').attr('x1', tx).attr('x2', tx).attr('y1', m.t).attr('y2', H - 24).attr('stroke', '#262f4d');
      svg.append('text').attr('x', tx).attr('y', H - 8).attr('text-anchor', 'middle').attr('fill', '#98a1bd').attr('font-size', 11).text(fmtYear(t));
    });
    const arcs = svg.append('g').attr('fill', 'none');
    const pos = new Map();
    placed.forEach((p) => {
      const li = laneInfo.find((l) => l.k === p.laneKey);
      p.py = li.y + 14 + p.row * rowH;
      pos.set(p.n.id, p);
    });
    const label = svg.append('text').attr('font-size', 11).attr('fill', '#e6e9f5').attr('paint-order', 'stroke').attr('stroke', '#0b0e17').attr('stroke-width', 3).attr('pointer-events', 'none');

    const dots = svg.append('g').selectAll('circle').data(placed).join('circle')
      .attr('cx', (d) => d.px).attr('cy', (d) => d.py).attr('r', (d) => 3.5 + d.n.complexity)
      .attr('fill', (d) => graph.domains[d.n.domain].color).attr('stroke', '#0b0e17').attr('stroke-width', 1.2).style('cursor', 'pointer').attr('tabindex', 0)
      .attr('aria-label', (d) => `${d.n.label}, ${fmtYear(d.n.year)}`);

    function showArcs(id, onlyEarlier = false) {
      arcs.selectAll('*').remove();
      if (!id) return;
      const a = pos.get(id);
      adj.get(id).forEach((nid) => {
        const b = pos.get(nid);
        if (!a || !b) return;
        if (onlyEarlier && b.n.year > a.n.year) return;
        const mx = (a.px + b.px) / 2, my = Math.min(a.py, b.py) - Math.abs(a.px - b.px) * 0.18 - 10;
        arcs.append('path').attr('d', `M${a.px},${a.py} Q${mx},${my} ${b.px},${b.py}`).attr('stroke', '#aab4ff').attr('stroke-width', 1.6).attr('opacity', 0.85);
      });
    }
    function setLabel(d) {
      if (!d) { label.attr('opacity', 0); return; }
      label.attr('opacity', 1).attr('x', d.px + 8).attr('y', d.py - 7).text(`${d.n.label} · ${fmtYear(d.n.year)}`);
      if (d.px > W - 220) label.attr('x', d.px - 8).attr('text-anchor', 'end'); else label.attr('text-anchor', 'start');
    }
    setLabel(null);
    dots.on('mouseenter', (ev, d) => { if (!state.playing) { showArcs(d.n.id); setLabel(d); } })
      .on('mouseleave', () => { if (!state.playing) { showArcs(state.selected); setLabel(state.selected ? pos.get(state.selected) : null); } })
      .on('click', (ev, d) => pick(d.n.id, true))
      .on('keydown', (ev, d) => { if (ev.key === 'Enter') pick(d.n.id, true); });
    draw.pos = pos; draw.showArcs = showArcs; draw.setLabel = setLabel; draw.dots = dots;
    if (state.selected) { showArcs(state.selected, state.playing); setLabel(pos.get(state.selected)); mark(); }
  }

  function mark() {
    draw.dots?.attr('opacity', (d) => (state.selected && state.idx >= 0 ? (nodes.findIndex((n) => n.id === d.n.id) <= state.idx ? 1 : 0.18) : 1))
      .attr('stroke', (d) => (d.n.id === state.selected ? '#fff' : '#0b0e17')).attr('stroke-width', (d) => (d.n.id === state.selected ? 3 : 1.2));
  }

  function pick(id, fromUser = false) {
    state.selected = id;
    if (fromUser) { stop(); state.idx = -1; }
    const n = nodeById.get(id);
    progress.visit(id);
    const prior = [...adj.get(id)].map((x) => nodeById.get(x)).filter((x) => x.year <= n.year).slice(0, 5);
    const later = [...adj.get(id)].map((x) => nodeById.get(x)).filter((x) => x.year > n.year).slice(0, 5);
    caption.innerHTML = '';
    caption.append(...[el('div', { class: 'row' }, el('b', { style: 'font-size:1.05rem' }, n.label), el('span', { class: 'pill', style: `--c:${graph.domains[n.domain].color}` }, graph.domains[n.domain].label), el('span', { class: 'muted' }, fmtYear(n.year)), el('button', { class: 'btn small', style: 'margin-left:auto', onclick: () => openNode(id) }, '◉ Ver en el grafo')),
      el('p', {}, n.summary),
      prior.length ? el('div', {}, el('span', { class: 'muted' }, 'Se apoya en / conecta con (anteriores): '), ...prior.map((p) => nodeChip(p.id))) : null,
      later.length ? el('div', {}, el('span', { class: 'muted' }, 'Inspira / conecta con (posteriores): '), ...later.map((p) => nodeChip(p.id))) : null].filter(Boolean));
    if (draw.pos) { draw.showArcs(id, state.playing); draw.setLabel(draw.pos.get(id)); mark(); }
    scrub.value = nodes.findIndex((x) => x.id === id);
  }

  function play() {
    state.playing = true; playBtn.textContent = '⏸ Pausar';
    if (state.idx < 0 || state.idx >= nodes.length - 1) state.idx = -1;
    state.timer = setInterval(() => {
      state.idx += 1;
      if (state.idx >= nodes.length) { stop(); return; }
      pick(nodes[state.idx].id);
    }, 1800);
  }
  function stop() { state.playing = false; playBtn.textContent = '▶ Reproducir historia'; clearInterval(state.timer); }
  scrub.addEventListener('input', () => { stop(); state.idx = +scrub.value; pick(nodes[state.idx].id); });
  window.addEventListener('resize', () => { if (!wrap.hidden && wrap.isConnected) draw(); });

  return { el: wrap, draw, stop };
}

/* ====================== Escenarios ====================== */
function scenarios() {
  let sc = null, path = [];
  const picker = el('div', { class: 'row', style: 'margin-bottom:.8rem' });
  const stage = el('div');
  const treeBox = el('div', { class: 'panel', style: 'margin-top:1rem' });
  const wrap = el('div', {}, el('div', { class: 'callout warn', style: 'margin-bottom:.8rem' }, timelines.disclaimer), picker, stage, treeBox);

  timelines.scenarios.forEach((s) => picker.append(el('button', { class: 'btn', 'data-id': s.id, onclick: () => start(s.id) }, s.title)));

  function start(id) {
    sc = timelines.scenarios.find((s) => s.id === id);
    path = [sc.start];
    picker.querySelectorAll('button').forEach((b) => b.classList.toggle('primary', b.dataset.id === id));
    render();
  }

  function render() {
    stage.innerHTML = ''; treeBox.innerHTML = '';
    if (!sc) { stage.append(el('p', { class: 'muted' }, 'Elige un escenario para empezar.')); return; }
    const cur = sc.nodes[path[path.length - 1]];
    stage.append(el('div', { class: 'breadcrumbs' }, ...path.map((id) => el('span', {}, sc.nodes[id].title))));
    const card = el('div', { class: 'scenario-node' },
      el('div', { class: 'year' }, fmtYear(cur.year)), el('h2', {}, cur.title), el('p', {}, cur.text));
    cur.choices.forEach((c) => card.append(el('button', { class: 'btn choice-btn', onclick: () => { path.push(c.next); render(); } }, '→ ' + c.label)));
    if (cur.ending) {
      card.append(el('div', { class: 'callout good', style: 'margin-top:.8rem' }, el('b', {}, 'Desenlace: ' + cur.ending.title), el('p', {}, cur.ending.reflection)),
        el('div', {}, el('span', { class: 'muted' }, 'Conceptos relacionados: '), ...cur.ending.related.map((id) => nodeChip(id))));
    }
    const row = el('div', { class: 'row', style: 'margin-top:.8rem' });
    if (path.length > 1) row.append(el('button', { class: 'btn', onclick: () => { path.pop(); render(); } }, '↶ Retroceder'));
    row.append(el('button', { class: 'btn ghost', onclick: () => start(sc.id) }, '↺ Reiniciar'));
    card.append(row);
    stage.append(card);
    drawTree();
  }

  function drawTree() {
    const ids = Object.keys(sc.nodes);
    const depth = new Map([[sc.start, 0]]);
    const q = [sc.start];
    while (q.length) { const c = q.shift(); sc.nodes[c].choices.forEach((ch) => { if (!depth.has(ch.next)) { depth.set(ch.next, depth.get(c) + 1); q.push(ch.next); } }); }
    const layers = [];
    ids.forEach((id) => { const d = depth.get(id) ?? 0; (layers[d] ??= []).push(id); });
    const W = Math.max(520, treeBox.clientWidth - 24 || 700), colW = W / layers.length, rowH = 46;
    const maxRows = Math.max(...layers.map((l) => l.length));
    const H = maxRows * rowH + 20;
    const pos = new Map();
    layers.forEach((l, i) => l.forEach((id, j) => pos.set(id, { x: colW * i + 70, y: (H / (l.length + 1)) * (j + 1) })));
    treeBox.append(el('h4', {}, 'Mapa de ramas (haz clic en un nodo visitado para volver a ese momento)'));
    const svg = d3.select(treeBox).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('width', '100%').attr('height', H);
    const visited = new Set(path), curId = path[path.length - 1];
    const taken = new Set(path.slice(1).map((id, i) => path[i] + '>' + id));
    ids.forEach((id) => sc.nodes[id].choices.forEach((ch) => {
      const a = pos.get(id), b = pos.get(ch.next), on = taken.has(id + '>' + ch.next);
      svg.append('path').attr('d', `M${a.x},${a.y} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x},${b.y}`).attr('fill', 'none').attr('stroke', on ? '#fbbf24' : '#3b4670').attr('stroke-width', on ? 3 : 1.4);
    }));
    ids.forEach((id) => {
      const p = pos.get(id), n = sc.nodes[id], isEnd = !!n.ending;
      const g = svg.append('g').attr('transform', `translate(${p.x},${p.y})`).style('cursor', visited.has(id) ? 'pointer' : 'default');
      g.append(isEnd ? 'rect' : 'circle').attr(isEnd ? 'x' : 'r', isEnd ? -9 : 10).attr(isEnd ? 'y' : 'cx', isEnd ? -9 : 0).attr(isEnd ? 'width' : 'cy', isEnd ? 18 : 0).attr(isEnd ? 'height' : 'cx', isEnd ? 18 : 0)
        .attr('fill', id === curId ? '#7c8cff' : visited.has(id) ? '#fbbf24' : '#1b2340').attr('stroke', '#58628a').attr('rx', isEnd ? 4 : 0);
      g.append('text').attr('y', 24).attr('text-anchor', 'middle').attr('font-size', 10.5).attr('fill', visited.has(id) ? '#e6e9f5' : '#98a1bd').text(n.title.length > 22 ? n.title.slice(0, 21) + '…' : n.title);
      if (visited.has(id)) g.on('click', () => { path = path.slice(0, path.indexOf(id) + 1); render(); });
    });
  }

  render();
  return { el: wrap, start };
}
