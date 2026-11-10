// FrontendUIX_Agent · skill: d3_graph_renderer
import * as d3 from 'd3';
import { graph, nodeById, el, nodeChip, openNode, navigate, progress, bus, removeCustomNode, clearAllCustomNodes, flashcards } from '../state.js';
import { newCard } from '../engines/srs.js';
import { buildIndex, search } from '../engines/rag.js';
import { PROBLEMS } from '../engines/socratic.js';
import timelines from '@data/timelines.json';
import { downloadObsidianVault } from '../api.js';

const LAB_FOR = { bayes_theorem: 'bayes', probability: 'ev', expected_value: 'ev', law_large_numbers: 'ev', variance: 'ev', normal_distribution: 'ev', gradient_descent: 'gd', backpropagation: 'gd', perceptron: 'nn', neural_networks: 'nn' };
const LOGIC_FOR = { fallacies: 'fallacy', cognitive_biases: 'fallacy', critical_thinking: 'fallacy', aristotelian_logic: 'formal', propositional_logic: 'formal', predicate_logic: 'formal', stoicism: 'formal', godel_incompleteness: 'formal' };

const idOf = (x) => (typeof x === 'object' ? x.id : x);
const degree = new Map();
const adj = new Map();
let searchIndex = null;

function rebuildTopology() {
  degree.clear();
  adj.clear();
  graph.nodes.forEach((n) => adj.set(n.id, new Set()));
  graph.links.forEach((l) => {
    const s = idOf(l.source);
    const t = idOf(l.target);
    degree.set(s, (degree.get(s) || 0) + 1);
    degree.set(t, (degree.get(t) || 0) + 1);
    if (!adj.has(s)) adj.set(s, new Set());
    if (!adj.has(t)) adj.set(t, new Set());
    adj.get(s).add(t);
    adj.get(t).add(s);
  });
  searchIndex = buildIndex(
    graph.nodes.map((n) => ({
      id: n.id,
      text: `${n.label} ${n.label} ${n.label} ${(n.authors || []).join(' ')} ${graph.domains[n.domain]?.label || ''} ${n.summary}`,
    }))
  );
}
rebuildTopology();

function bfsDepth(start, maxDepth) {
  const seen = new Map([[start, 0]]);
  const q = [start];
  while (q.length) {
    const cur = q.shift();
    if (seen.get(cur) >= maxDepth) continue;
    for (const nb of adj.get(cur) || []) if (!seen.has(nb)) { seen.set(nb, seen.get(cur) + 1); q.push(nb); }
  }
  return new Set(seen.keys());
}

export function shortestPath(a, b) {
  if (a === b) return [a];
  const prev = new Map([[a, null]]);
  const q = [a];
  while (q.length) {
    const cur = q.shift();
    for (const nb of adj.get(cur) || []) {
      if (prev.has(nb)) continue;
      prev.set(nb, cur);
      if (nb === b) {
        const path = [b];
        for (let c = cur; c != null; c = prev.get(c)) path.unshift(c);
        return path;
      }
      q.push(nb);
    }
  }
  return null;
}

export function mount(root) {
  // ------------ estado ------------
  const state = { selected: null, hover: null, domains: new Set(Object.keys(graph.domains)), maxComplexity: 5, depth: 'all', overlay: null, activePath: null, pathStep: 0 };
  let nodes = graph.nodes.map((n) => ({ ...n, deg: degree.get(n.id) || 0 }));
  let links = graph.links.map((l) => ({ ...l }));

  // ------------ DOM ------------
  const left = el('aside', { class: 'side', 'aria-label': 'Filtros' });
  const right = el('aside', { class: 'side right closed', 'aria-label': 'Detalle del nodo' });
  const stage = el('div', { class: 'graph-stage' });
  const tooltip = el('div', { class: 'graph-tooltip', hidden: true });
  const layout = el('div', { class: 'graph-layout' }, left, stage, right);
  root.append(layout);

  const svg = d3.select(stage).append('svg').attr('role', 'img').attr('aria-label', 'Grafo de conocimiento interdisciplinario');
  const defs = svg.append('defs');
  defs.append('marker').attr('id', 'arrow').attr('viewBox', '0 -4 8 8').attr('refX', 14).attr('markerWidth', 5).attr('markerHeight', 5).attr('orient', 'auto')
    .append('path').attr('d', 'M0,-3.5L8,0L0,3.5Z').attr('fill', '#58628a');
  const zoomLayer = svg.append('g');
  const gOverlay = zoomLayer.append('g');
  const gLinks = zoomLayer.append('g');
  const gNodes = zoomLayer.append('g');
  stage.append(tooltip);

  const btnResetCustom = el('button', {
    class: 'btn small',
    style: 'border-color:var(--bad);color:var(--bad);display:none',
    title: 'Restablecer el grafo y eliminar todos los nodos integrados desde documentos',
    onclick: () => {
      const count = graph.nodes.filter((n) => n.custom).length;
      if (confirm(`¿Eliminar los ${count} nodo(s) integrados desde documentos y restaurar el grafo base?`)) {
        clearAllCustomNodes();
        clearSelection();
        resetView();
      }
    },
  }, '↺ Restaurar grafo base');

  const hud = el('div', { class: 'graph-hud' },
    el('button', { class: 'btn small only-mobile', onclick: () => left.classList.toggle('open') }, '☰ Filtros'),
    el('button', { class: 'btn small', onclick: () => rabbitHole() }, '🐇 Madriguera'),
    el('button', { class: 'btn small', onclick: () => resetView() }, '⤢ Reencuadrar'),
    el('button', { class: 'btn small', title: 'Cerrar panel de detalle y deseleccionar nodo', onclick: () => { clearSelection(); } }, '✕ Deseleccionar'),
    el('button', { class: 'btn small', title: 'Exportar todo el grafo como bóveda de Obsidian (.zip)', onclick: async () => {
      const ok = await downloadObsidianVault();
      if (!ok) alert('No se pudo generar la bóveda de Obsidian');
    } }, '🌌 Obsidian (.zip)'),
    btnResetCustom);
  stage.append(hud);
  stage.append(el('div', { class: 'legend', html: 'Tamaño = conexiones · <span style="color:#58628a">→</span> influencia · <span style="color:#f87171">- -</span> contraste · <span style="color:#34d399">◌</span> dominado · <span style="color:var(--accent2)">✦</span> tus documentos' }));

  // ------------ panel izquierdo ------------
  const searchInput = el('input', { type: 'search', placeholder: 'Buscar idea, autor o tema…', 'aria-label': 'Buscar' });
  const searchResults = el('ul', { class: 'results' });
  const domainBox = el('div');
  const cxLabel = el('b', {}, '5');
  const cxRange = el('input', { type: 'range', min: 1, max: 5, value: 5, 'aria-label': 'Complejidad máxima' });
  const depthSel = el('select', { 'aria-label': 'Alcance de exploración' },
    el('option', { value: 'all' }, 'Todo el grafo'), el('option', { value: '1' }, '1 salto del nodo elegido'), el('option', { value: '2' }, '2 saltos'), el('option', { value: '3' }, '3 saltos'));
  const pathSel = el('select', { 'aria-label': 'Ruta de aprendizaje' }, el('option', { value: '' }, '— ninguna —'), ...graph.paths.map((p) => el('option', { value: p.id }, p.title)));
  const pathBox = el('div');
  const stats = el('p', { class: 'muted' });

  left.append(
    el('h2', {}, 'Explora'), searchInput, searchResults,
    el('h4', { style: 'margin-top:1rem' }, 'Disciplinas'), domainBox,
    el('label', { class: 'field' }, el('span', {}, 'Complejidad máx.: ', cxLabel, ' / 5'), cxRange),
    el('label', { class: 'field' }, el('span', {}, 'Modo madriguera (vecindad)'), depthSel),
    el('h4', { style: 'margin-top:1rem' }, 'Rutas de aprendizaje'), pathSel, pathBox, stats);

  Object.entries(graph.domains).forEach(([id, d]) => {
    const count = nodes.filter((n) => n.domain === id).length;
    const btn = el('button', { class: 'domain-toggle', 'data-domain': id, style: `--c:${d.color}`, 'aria-pressed': 'true', onclick: () => {
      if (state.domains.has(id)) state.domains.delete(id); else state.domains.add(id);
      btn.classList.toggle('off', !state.domains.has(id));
      btn.setAttribute('aria-pressed', state.domains.has(id));
      render();
    } }, el('span', { class: 'dot' }), d.label, el('span', { class: 'count' }, count));
    domainBox.append(btn);
  });

  cxRange.addEventListener('input', () => { state.maxComplexity = +cxRange.value; cxLabel.textContent = cxRange.value; render(); });
  depthSel.addEventListener('change', () => { state.depth = depthSel.value; render(); });

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    searchResults.innerHTML = '';
    if (q.length < 2) return;
    const hits = search(searchIndex, q, 7);
    if (!hits.length) searchResults.append(el('li', { class: 'muted' }, 'Sin resultados'));
    hits.forEach((h) => {
      const n = nodeById.get(h.doc.id);
      searchResults.append(el('li', {}, el('button', { onclick: () => { select(n.id, true); searchResults.innerHTML = ''; searchInput.value = ''; } },
        el('span', { class: 'pill', style: `--c:${graph.domains[n.domain].color}` }, graph.domains[n.domain].label.split(' ')[0]), n.label,
        el('span', { class: 'sc' }, Math.round(h.score * 100) + '%'))));
    });
  });

  pathSel.addEventListener('change', () => {
    const p = graph.paths.find((x) => x.id === pathSel.value);
    pathBox.innerHTML = '';
    if (!p) { state.activePath = null; state.overlay = null; applyClasses(); drawOverlay(); return; }
    state.activePath = p;
    state.pathStep = 0;
    state.overlay = { ids: p.nodes, kind: 'path' };
    // asegura que los nodos de la ruta sean visibles
    p.nodes.forEach((id) => state.domains.add(nodeById.get(id).domain));
    domainBox.querySelectorAll('.domain-toggle').forEach((b) => b.classList.remove('off'));
    state.maxComplexity = 5; cxRange.value = 5; cxLabel.textContent = '5';
    pathBox.append(el('p', { class: 'muted' }, p.description),
      el('ol', { class: 'path-steps' }, ...p.nodes.map((id) => el('li', {}, nodeChip(id)))),
      el('div', { class: 'row' }, el('button', { class: 'btn small', onclick: () => stepPath(-1) }, '◀'), el('button', { class: 'btn small primary', onclick: () => stepPath(1) }, 'Siguiente paso ▶')));
    render();
    select(p.nodes[0], true);
  });

  function stepPath(dir) {
    const p = state.activePath;
    if (!p) return;
    state.pathStep = (state.pathStep + dir + p.nodes.length) % p.nodes.length;
    select(p.nodes[state.pathStep], true);
  }

  // ------------ simulación ------------
  let W = 800, H = 600;
  const domainKeys = Object.keys(graph.domains);
  const anchor = (key) => {
    const i = domainKeys.indexOf(key);
    const ang = (i / domainKeys.length) * Math.PI * 2 - Math.PI / 2;
    const R = Math.min(W, H) * 0.42;
    return { x: Math.cos(ang) * R, y: Math.sin(ang) * R };
  };
  const radius = (d) => 6 + Math.sqrt(d.deg) * 2.1;
  const sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id((d) => d.id).distance(92).strength(0.25))
    .force('charge', d3.forceManyBody().strength(-420).distanceMax(520))
    .force('collide', d3.forceCollide().radius((d) => radius(d) + 9))
    .force('x', d3.forceX((d) => anchor(d.domain).x).strength(0.1))
    .force('y', d3.forceY((d) => anchor(d.domain).y).strength(0.1))
    .alphaDecay(0.03);

  const zoom = d3.zoom().scaleExtent([0.25, 4]).on('zoom', (ev) => {
    zoomLayer.attr('transform', ev.transform);
    svg.classed('zoomed', ev.transform.k > 1.6);
  });
  svg.call(zoom).on('dblclick.zoom', null);
  svg.on('click', (ev) => { if (ev.target === svg.node()) clearSelection(); });

  function sizeUp() {
    const r = stage.getBoundingClientRect();
    W = r.width || 800; H = r.height || 600;
    svg.attr('viewBox', `${-W / 2} ${-H / 2} ${W} ${H}`);
    sim.force('x').x((d) => anchor(d.domain).x);
    sim.force('y').y((d) => anchor(d.domain).y);
  }
  sizeUp();
  new ResizeObserver(() => { sizeUp(); }).observe(stage);

  let nodeSel = gNodes.selectAll('g.gnode');
  let linkSel = gLinks.selectAll('line.glink');
  const overlayLines = gOverlay.selectAll('line');

  function computeVisible() {
    let vis = new Set(nodes.filter((n) => state.domains.has(n.domain) && n.complexity <= state.maxComplexity).map((n) => n.id));
    if (state.depth !== 'all' && state.selected) {
      const nb = bfsDepth(state.selected, +state.depth);
      vis = new Set([...vis].filter((id) => nb.has(id)));
    }
    if (state.activePath) state.activePath.nodes.forEach((id) => { if (state.depth === 'all') vis.add(id); });
    return vis;
  }

  function render(alpha = 0.55) {
    const vis = computeVisible();
    const vNodes = nodes.filter((n) => vis.has(n.id));
    const vLinks = links.filter((l) => vis.has(idOf(l.source)) && vis.has(idOf(l.target)));
    stats.textContent = `${vNodes.length} nodos · ${vLinks.length} conexiones visibles`;

    linkSel = gLinks.selectAll('line.glink').data(vLinks, (d) => idOf(d.source) + '>' + idOf(d.target)).join('line')
      .attr('class', (d) => `glink rel-${d.relation}`).attr('marker-end', 'url(#arrow)');

    nodeSel = gNodes.selectAll('g.gnode').data(vNodes, (d) => d.id).join((enter) => {
      const g = enter.append('g').attr('class', (d) => 'gnode' + (d.deg >= 6 || d.custom ? ' hub' : '') + (d.custom ? ' custom-node' : '')).attr('tabindex', 0).attr('role', 'button').attr('aria-label', (d) => d.label);
      g.append('circle').attr('class', 'ring').attr('r', (d) => radius(d) + 5);
      g.append('circle').attr('class', 'main').attr('r', radius).attr('fill', (d) => graph.domains[d.domain]?.color || '#7c8cff');
      g.append('text').attr('class', 'glabel').attr('y', (d) => radius(d) + 12).attr('text-anchor', 'middle').text((d) => (d.custom ? `✦ ${d.label}` : d.label));
      g.on('click', (ev, d) => { ev.stopPropagation(); select(d.id); })
        .on('keydown', (ev, d) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(d.id); } })
        .on('mouseenter', (ev, d) => { state.hover = d.id; showTip(ev, d); applyClasses(); })
        .on('mousemove', (ev, d) => moveTip(ev, d))
        .on('mouseleave', () => { state.hover = null; tooltip.hidden = true; applyClasses(); })
        .call(d3.drag()
          .on('start', (ev, d) => { if (!ev.active) sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; })
          .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
          .on('end', (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));
      return g;
    });

    sim.nodes(vNodes);
    sim.force('link').links(vLinks);
    if (alpha > 0) sim.alpha(alpha).restart();
    else sim.alpha(0.001).restart();

    const customCount = graph.nodes.filter((n) => n.custom).length;
    btnResetCustom.style.display = customCount > 0 ? 'inline-flex' : 'none';
    btnResetCustom.textContent = `↺ Restaurar grafo base (${customCount})`;

    applyClasses();
  }

  bus.addEventListener('graph-updated', () => {
    rebuildTopology();
    const prevById = new Map(nodes.map((n) => [n.id, n]));
    nodes = graph.nodes.map((n) => {
      const old = prevById.get(n.id);
      if (old) {
        old.deg = degree.get(n.id) || 0;
        old.label = n.label;
        old.summary = n.summary;
        old.authors = n.authors;
        old.complexity = n.complexity;
        return old;
      }
      const a = anchor(n.domain);
      return {
        ...n,
        deg: degree.get(n.id) || 0,
        x: a.x + (Math.random() - 0.5) * 40,
        y: a.y + (Math.random() - 0.5) * 40,
      };
    });
    links = graph.links.map((l) => ({
      source: idOf(l.source),
      target: idOf(l.target),
      relation: l.relation,
    }));
    domainBox.querySelectorAll('.domain-toggle').forEach((btn) => {
      const domId = btn.getAttribute('data-domain');
      const countEl = btn.querySelector('.count');
      if (domId && countEl) {
        countEl.textContent = nodes.filter((n) => n.domain === domId).length;
      }
    });
    if (state.selected && !nodeById.has(state.selected)) {
      clearSelection();
    }
    render(0.55);
  });

  sim.on('tick', () => {
    linkSel.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y).attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
    nodeSel.attr('transform', (d) => `translate(${d.x},${d.y})`);
    drawOverlay();
  });

  function drawOverlay() {
    const o = state.overlay;
    const segs = [];
    if (o) for (let i = 0; i < o.ids.length - 1; i++) {
      const a = nodeById.get(o.ids[i]) && nodes.find((n) => n.id === o.ids[i]);
      const b = nodes.find((n) => n.id === o.ids[i + 1]);
      if (a && b && a.x != null && b.x != null) segs.push({ a, b, kind: o.kind });
    }
    gOverlay.selectAll('line').data(segs).join('line')
      .attr('class', (d) => `overlay-line ${d.kind}`).attr('x1', (d) => d.a.x).attr('y1', (d) => d.a.y).attr('x2', (d) => d.b.x).attr('y2', (d) => d.b.y);
  }

  function applyClasses() {
    const focus = state.hover ?? state.selected;
    const nb = focus ? new Set([focus, ...(adj.get(focus) || [])]) : null;
    const onPath = state.overlay ? new Set(state.overlay.ids) : null;
    const mastered = progress.masteredNodes();

    const pathLinks = new Set();
    if (state.overlay?.ids) {
      const ids = state.overlay.ids;
      for (let i = 0; i < ids.length - 1; i++) {
        pathLinks.add(`${ids[i]}>${ids[i + 1]}`);
        pathLinks.add(`${ids[i + 1]}>${ids[i]}`);
      }
    }

    nodeSel
      .classed('sel', (d) => d.id === state.selected)
      .classed('hov', (d) => d.id === state.hover)
      .classed('mastered', (d) => mastered.has(d.id))
      .classed('onpath', (d) => !!onPath && onPath.has(d.id))
      .classed('dim', (d) => {
        if (onPath && onPath.has(d.id)) return false;
        if (nb && !nb.has(d.id)) return true;
        if (!nb && onPath && !onPath.has(d.id)) return true;
        return false;
      });

    linkSel
      .classed('hl', (d) => {
        const key = `${idOf(d.source)}>${idOf(d.target)}`;
        if (pathLinks.has(key)) return true;
        return !!(nb && (idOf(d.source) === focus || idOf(d.target) === focus));
      })
      .classed('dim', (d) => {
        const key = `${idOf(d.source)}>${idOf(d.target)}`;
        if (pathLinks.has(key)) return false;
        if (nb) return !(idOf(d.source) === focus || idOf(d.target) === focus);
        if (onPath) return true;
        return false;
      });
  }
  bus.addEventListener('progress', applyClasses);

  function showTip(ev, d) {
    tooltip.hidden = false;
    const dom = graph.domains[d.domain] || { label: d.domain, color: '#7c8cff' };
    const yearStr = d.year < 0 ? `${-d.year} a.C.` : `${d.year}`;
    const customTag = d.custom ? '<div style="font-size:.7rem;color:var(--accent2);margin-top:2px">✦ Nodo integrado de tus documentos</div>' : '';
    tooltip.innerHTML = `
      <div style="display:flex;align-items:center;gap:.45rem;margin-bottom:2px">
        <span style="width:8px;height:8px;border-radius:50%;background:${dom.color};flex:none;box-shadow:0 0 6px ${dom.color}"></span>
        <b style="color:var(--text)">${d.custom ? '✦ ' + d.label : d.label}</b>
      </div>
      <div class="muted" style="font-size:.74rem">${dom.label} · ${yearStr} · Complejidad ${d.complexity}/5</div>
      ${customTag}
    `;
    moveTip(ev, d);
  }
  function moveTip(ev, d) {
    const r = stage.getBoundingClientRect();
    const x = ev.clientX - r.left;
    const y = ev.clientY - r.top;
    const flipBottom = y < 75;
    tooltip.classList.toggle('flip-bottom', flipBottom);

    if (flipBottom) {
      const rad = d ? radius(d) : 16;
      tooltip.style.transform = 'translate(-50%, 0)';
      tooltip.style.top = y + rad + 24 + 'px';
    } else {
      tooltip.style.transform = 'translate(-50%, -100%)';
      tooltip.style.top = y - 16 + 'px';
    }

    const margin = 110;
    const clampedX = Math.max(margin, Math.min(r.width - margin, x));
    tooltip.style.left = clampedX + 'px';
  }

  function centerOn(id, k = 1.3) {
    const n = nodes.find((x) => x.id === id);
    if (!n || n.x == null) return;
    svg.transition().duration(600).call(zoom.transform, d3.zoomIdentity.scale(k).translate(-n.x, -n.y));
  }
  function resetView() {
    const vis = nodes.filter((n) => n.x != null && sim.nodes().includes(n));
    if (!vis.length) { svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity); return; }
    const xs = vis.map((n) => n.x), ys = vis.map((n) => n.y);
    const x0 = Math.min(...xs) - 40, x1 = Math.max(...xs) + 40, y0 = Math.min(...ys) - 40, y1 = Math.max(...ys) + 40;
    const k = Math.max(0.35, Math.min(1.6, 0.92 * Math.min(W / (x1 - x0), H / (y1 - y0))));
    svg.transition().duration(600).call(zoom.transform, d3.zoomIdentity.scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2));
  }

  // ------------ selección y panel de detalle ------------
  function select(id, center = false) {
    const n = nodeById.get(id);
    if (!n) return;
    state.selected = id;
    progress.visit(id);
    // si el nodo estaba filtrado, lo hace visible
    if (!state.domains.has(n.domain)) { state.domains.add(n.domain); domainBox.querySelectorAll('.domain-toggle').forEach((b) => b.classList.remove('off')); }
    if (n.complexity > state.maxComplexity) { state.maxComplexity = n.complexity; cxRange.value = n.complexity; cxLabel.textContent = n.complexity; }
    if (state.overlay?.kind === 'shortest') state.overlay = null;
    render(state.depth === 'all' ? 0 : 0.35);
    renderDetail(id);
    right.classList.remove('closed');
    left.classList.remove('open');
    if (center) setTimeout(() => centerOn(id), 80);
  }

  function clearSelection() {
    state.selected = null; state.overlay = state.activePath ? { ids: state.activePath.nodes, kind: 'path' } : null;
    right.classList.add('closed');
    render(); drawOverlay();
  }

  function rabbitHole() {
    const pool = state.selected ? [...(adj.get(state.selected) || [])] : nodes.map((n) => n.id);
    const cross = state.selected ? pool.filter((id) => nodeById.get(id)?.domain !== nodeById.get(state.selected)?.domain) : pool;
    const list = cross.length ? cross : pool;
    if (list.length) select(list[Math.floor(Math.random() * list.length)], true);
  }

  function renderDetail(id) {
    const n = nodeById.get(id);
    if (!n) return;
    const d = graph.domains[n.domain] || { label: n.domain, color: '#7c8cff' };
    const outs = graph.links.filter((l) => idOf(l.source) === id);
    const ins = graph.links.filter((l) => idOf(l.target) === id);
    const year = n.year < 0 ? `${-n.year} a.C.` : n.year;
    const probs = PROBLEMS.filter((p) => p.node === id || (p.related && p.related.includes(id)));
    const actions = [];
    probs.slice(0, 2).forEach((p) => actions.push(el('button', { class: 'btn primary small', onclick: () => navigate('tutor', { problem: p.id }) }, `❓ Practicar: ${p.title}`)));
    if (LAB_FOR[id]) actions.push(el('button', { class: 'btn small', onclick: () => navigate('lab', { sim: LAB_FOR[id] }) }, '🧪 Simular'));
    if (LOGIC_FOR[id]) actions.push(el('button', { class: 'btn small', onclick: () => navigate('logic', { sub: LOGIC_FOR[id] }) }, '⚖ Lógica'));
    timelines.scenarios.filter((s) => s.theme === id).forEach((s) => actions.push(el('button', { class: 'btn small', onclick: () => navigate('timeline', { scenario: s.id }) }, '⏳ ' + s.title)));
    actions.push(el('button', { class: 'btn small', onclick: () => navigate('explainer', { text: `${n.label}. ${n.summary}` }) }, '📖 Explicar'));
    const cardFront = `¿Qué es **${n.label}** y por qué importa?`;
    const cardBtn = el('button', { class: 'btn small', title: 'Añadir este concepto a tu mazo de repaso espaciado' }, flashcards.has(cardFront) ? '✓ En tu mazo' : '🗂 Tarjeta');
    cardBtn.disabled = flashcards.has(cardFront);
    cardBtn.addEventListener('click', () => {
      const conns = graph.links.filter((l) => idOf(l.source) === id).slice(0, 3)
        .map((l) => `${graph.relations[l.relation] || 'influye en'} ${nodeById.get(idOf(l.target))?.label || idOf(l.target)}`);
      const yr = n.year == null ? '' : n.year < 0 ? `${-n.year} a.C.` : `${n.year}`;
      const back = [
        n.summary,
        `*${[(n.authors || []).join(', '), yr].filter(Boolean).join(' · ')}*`,
        conns.length ? `**Conexiones:** ${conns.join('; ')}.` : '',
      ].filter((s) => s && s !== '**').join('\n\n');
      flashcards.add([newCard({ front: cardFront, back, tags: ['grafo', n.domain, id], source: 'graph' })]);
      cardBtn.disabled = true;
      cardBtn.textContent = '✓ En tu mazo';
    });
    actions.push(cardBtn);
    if (n.custom) {
      actions.push(el('button', { class: 'btn small', style: 'border-color:var(--bad);color:var(--bad)', onclick: () => { removeCustomNode(id); clearSelection(); } }, '🗑 Eliminar nodo'));
    }

    const targetSel = el('select', { 'aria-label': 'Destino del camino' }, el('option', { value: '' }, 'Elegir destino…'),
      ...nodes.filter((x) => x.id !== id).sort((a, b) => a.label.localeCompare(b.label)).map((x) => el('option', { value: x.id }, x.label)));
    const pathResult = el('div');
    targetSel.addEventListener('change', () => {
      pathResult.innerHTML = '';
      if (!targetSel.value) return;
      const p = shortestPath(id, targetSel.value);
      if (!p) { pathResult.append(el('p', { class: 'muted' }, 'Sin conexión.')); return; }
      state.overlay = { ids: p, kind: 'shortest' };
      p.forEach((pid) => { if (nodeById.has(pid)) state.domains.add(nodeById.get(pid).domain); });
      pathResult.append(el('p', { class: 'muted' }, `${p.length - 1} saltos:`), el('div', {}, ...p.map((pid) => nodeChip(pid))));
      applyClasses(); drawOverlay();
    });

    const relItem = (l, dir) => {
      const other = dir === 'out' ? idOf(l.target) : idOf(l.source);
      const verb = graph.relations[l.relation] || 'influye en';
      return el('li', {}, dir === 'out' ? el('span', { class: 'rel-verb' }, verb) : null, nodeChip(other), dir === 'in' ? el('span', { class: 'rel-verb' }, `${verb} → esto`) : null);
    };

    right.innerHTML = '';
    right.append(
      el('div', { class: 'row' },
        el('span', { class: 'pill', style: `--c:${d.color}` }, d.label),
        n.custom ? el('span', { class: 'pill', style: '--c:var(--accent2)' }, '✦ Tu Biblioteca') : null,
        el('button', { class: 'btn ghost small', style: 'margin-left:auto', 'aria-label': 'Cerrar panel', onclick: () => right.classList.add('closed') }, '✕')),
      el('h2', { class: 'node-title' }, n.custom ? `✦ ${n.label}` : n.label),
      el('p', { class: 'muted' }, `${year} · Complejidad `, el('span', { class: 'dots' }, '●'.repeat(n.complexity) + '○'.repeat(5 - n.complexity))),
      el('p', {}, n.summary),
      el('p', {}, el('b', {}, 'Autores: '), (n.authors || []).join(', ')),
      el('div', { class: 'row', style: 'margin:.5rem 0' }, ...actions),
      el('h4', { style: 'margin-top:1rem' }, `Conexiones (${outs.length + ins.length})`),
      el('ul', { class: 'rel-list' }, ...ins.map((l) => relItem(l, 'in')), ...outs.map((l) => relItem(l, 'out'))),
      el('h4', { style: 'margin-top:1rem' }, 'Camino hasta otra idea'), targetSel, pathResult,
      el('div', { style: 'margin-top:1rem' }, el('button', { class: 'btn small', onclick: () => rabbitHole() }, '🐇 Saltar a una idea vecina de otra disciplina')));
  }

  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !right.classList.contains('closed') && !root.hidden) clearSelection(); });

  render();
  // vista inicial
  setTimeout(resetView, 1600);

  return {
    show(params = {}) {
      sizeUp();
      sim.alpha(0.05).restart();
      if (params.node && nodeById.has(params.node)) setTimeout(() => select(params.node, true), 150);
    },
    hide() { tooltip.hidden = true; },
  };
}
