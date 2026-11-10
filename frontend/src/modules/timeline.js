// Líneas de tiempo: Navegador Temporal por Eras (500 a.C. — 2026), Buscador de Puentes Transdisciplinarios y Escenarios Contrafactuales
import * as d3 from 'd3';
import { el, graph, nodeById, nodeChip, openNode, bus, progress, flashcards, navigate } from '../state.js';
import { newCard } from '../engines/srs.js';
import { HISTORICAL_ERAS, PRESET_BRIDGES, fmtYear, getEraForYear, groupNodesByEra, findIdeologicalBridge } from '../engines/timelineEngine.js';
import { fetchHistoricalEras, fetchIdeologicalBridge } from '../api.js';
import timelines from '@data/timelines.json';

export function mount(root) {
  const tabs = el('div', { class: 'tabs-sub' });
  const body = el('div', { style: 'display:flex;flex-direction:column;flex:1;min-height:0' });

  const eraNav = eraNavigator();
  const bridgeView = bridgeFinderView();
  const scen = scenarios();

  root.append(
    el('div', { class: 'page' },
      el('div', { class: 'page-inner', style: 'display:flex;flex-direction:column;min-height:100%' },
        el('h1', { style: 'font-size:1.4rem;display:flex;align-items:center;gap:.4rem;' }, '⏳ Navegador Temporal y Puentes Transdisciplinarios'),
        el('p', { class: 'muted' }, 'Explora la evolución del pensamiento humano a través de 6 grandes eras históricas o descubre los puentes genealógicos que conectan ideas separadas por milenios.'),
        tabs,
        body
      )
    )
  );

  body.append(eraNav.el, bridgeView.el, scen.el);

  const defs = [
    ['eras', '⏳ Navegador por Eras (500 a.C. — 2026)'],
    ['bridge', '🌉 Buscador de Puentes Ocultos'],
    ['scen', '🔀 Historias alternativas'],
  ];

  defs.forEach(([id, l]) => tabs.append(el('button', { 'data-id': id, onclick: () => open(id) }, l)));

  function open(id) {
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.id === id));
    eraNav.el.hidden = id !== 'eras';
    bridgeView.el.hidden = id !== 'bridge';
    scen.el.hidden = id !== 'scen';

    if (id === 'eras') eraNav.draw();
  }

  open('eras');

  return {
    show(params = {}) {
      if (params.scenario) {
        open('scen');
        scen.start(params.scenario);
      } else if (params.bridge) {
        open('bridge');
        if (params.source && params.target) {
          bridgeView.loadBridge(params.source, params.target);
        }
      } else if (!eraNav.el.hidden) {
        eraNav.draw();
      }
    },
    hide() {
      eraNav.stop();
    },
  };
}

/* ====================== 1. Navegador Temporal por Eras ====================== */
function eraNavigator() {
  const container = el('div', { class: 'tl-wrap' });
  const caption = el('div', { class: 'tl-caption' }, el('span', { class: 'muted' }, 'Pasa el cursor sobre una idea, haz clic para ver su detalle o pulsa «Reproducir historia» para recorrerlas en orden cronológico.'));

  const nodes = [...graph.nodes].sort((a, b) => a.year - b.year);
  const adj = new Map(graph.nodes.map((n) => [n.id, new Set()]));
  graph.links.forEach((l) => {
    adj.get(l.source)?.add(l.target);
    adj.get(l.target)?.add(l.source);
  });

  const state = {
    idx: -1,
    playing: false,
    timer: null,
    selected: null,
    activeEra: null, // null = todas
  };

  // Ribbon de las 6 Eras
  const eraRibbon = el('div', { class: 'era-ribbon' });
  const paradigmBanner = el('div', { class: 'era-paradigm-banner', hidden: true });

  HISTORICAL_ERAS.forEach((era) => {
    const eraNodes = nodes.filter((n) => n.year >= era.startYear && n.year <= era.endYear);
    const card = el('div', {
      class: 'era-card',
      style: `--era-c:${era.color}`,
      onclick: () => toggleEra(era),
    },
      el('div', { class: 'era-card-header' },
        el('span', { class: 'era-card-icon' }, era.icon),
        el('span', { class: 'pill', style: `--c:${era.color};font-size:.68rem;padding:.05rem .4rem;` }, `${eraNodes.length} ideas`)
      ),
      el('div', { class: 'era-card-name' }, era.name),
      el('div', { class: 'era-card-dates' }, `${fmtYear(era.startYear)} — ${fmtYear(era.endYear)}`)
    );
    eraRibbon.append(card);
  });

  function toggleEra(era) {
    if (state.activeEra?.id === era.id) {
      state.activeEra = null;
      paradigmBanner.hidden = true;
      eraRibbon.querySelectorAll('.era-card').forEach((c) => c.classList.remove('active'));
    } else {
      state.activeEra = era;
      paradigmBanner.hidden = false;
      paradigmBanner.style.setProperty('--era-c', era.color);
      paradigmBanner.innerHTML = '';
      paradigmBanner.append(
        el('div', {},
          el('div', { class: 'era-paradigm-title' },
            el('span', { style: 'font-size:1.3rem;' }, era.icon),
            `${era.name} (${fmtYear(era.startYear)} — ${fmtYear(era.endYear)})`
          ),
          el('div', { class: 'era-paradigm-desc' },
            el('b', { style: 'color:var(--text);' }, `Paradigma: `),
            `«${era.paradigm}» `,
            el('span', { class: 'muted' }, era.description)
          )
        ),
        el('div', { class: 'row', style: 'align-items:center;gap:.4rem;' },
          el('button', {
            class: 'btn small primary',
            onclick: () => playEra(era),
          }, '▶ Recorrer esta época'),
          el('button', {
            class: 'btn small',
            onclick: () => toggleEra(era),
          }, 'Ver todas las épocas')
        )
      );

      eraRibbon.querySelectorAll('.era-card').forEach((c, i) => {
        c.classList.toggle('active', HISTORICAL_ERAS[i].id === era.id);
      });
    }

    draw();
  }

  function playEra(era) {
    stop();
    const eraNodeIndices = nodes
      .map((n, i) => ({ n, i }))
      .filter((x) => x.n.year >= era.startYear && x.n.year <= era.endYear);

    if (!eraNodeIndices.length) return;

    let subIdx = 0;
    state.playing = true;
    playBtn.textContent = '⏸ Pausar';

    state.timer = setInterval(() => {
      if (subIdx >= eraNodeIndices.length) {
        stop();
        return;
      }
      const target = eraNodeIndices[subIdx];
      state.idx = target.i;
      pick(target.n.id);
      subIdx++;
    }, 1800);
  }

  const scrub = el('input', {
    type: 'range',
    min: 0,
    max: nodes.length - 1,
    value: 0,
    'aria-label': 'Recorrer cronología',
    style: 'flex:1;min-width:140px;',
  });
  const playBtn = el('button', {
    class: 'btn primary',
    onclick: () => (state.playing ? stop() : play()),
  }, '▶ Reproducir historia');

  const dom = Object.entries(graph.domains);
  const filters = new Set(dom.map(([k]) => k));
  const filterRow = el('div', { class: 'row', style: 'margin-bottom:.5rem;gap:.35rem;flex-wrap:wrap;' },
    ...dom.map(([k, d]) => {
      const b = el('button', {
        class: 'node-chip',
        style: `--c:${d.color}`,
        onclick: () => {
          filters.has(k) ? filters.delete(k) : filters.add(k);
          b.style.opacity = filters.has(k) ? 1 : 0.35;
          draw();
        },
      }, d.label);
      return b;
    })
  );

  const controls = el('div', { class: 'row', style: 'margin-bottom:.6rem;gap:.5rem;align-items:center;' }, playBtn, scrub);
  const wrap = el('div', { style: 'display:flex;flex-direction:column;flex:1;' },
    eraRibbon,
    paradigmBanner,
    filterRow,
    controls,
    container,
    caption
  );

  let svg;

  function draw() {
    const W = Math.max(640, container.clientWidth || 900);
    const m = { l: 130, r: 24, t: 14 };

    // Dominio temporal según era activa o completo
    const minYear = state.activeEra ? state.activeEra.startYear : -600;
    const maxYear = state.activeEra ? state.activeEra.endYear : 2030;

    let x;
    if (state.activeEra) {
      x = d3.scaleLinear().domain([minYear, maxYear]).range([0, W - m.l - m.r]);
    } else {
      x = d3.scaleLinear()
        .domain([-600, 0, 1000, 1400, 1800, 2040])
        .range([0, 0.12, 0.3, 0.5, 0.8, 1].map((f) => f * (W - m.l - m.r)));
    }

    const lanes = dom.filter(([k]) => filters.has(k));
    const rowH = 15;
    const placed = [];
    let y0 = m.t;

    const laneInfo = lanes.map(([k, d]) => {
      const ns = nodes.filter((n) => {
        const inDom = n.domain === k;
        const inEra = !state.activeEra || (n.year >= state.activeEra.startYear && n.year <= state.activeEra.endYear);
        return inDom && inEra;
      });

      const rowsEnd = [];
      ns.forEach((n) => {
        const px = x(n.year);
        let r = rowsEnd.findIndex((end) => px - end > 17);
        if (r < 0) {
          r = rowsEnd.length;
          rowsEnd.push(px);
        } else {
          rowsEnd[r] = px;
        }
        placed.push({ n, px: m.l + px, row: r, laneKey: k });
      });

      const h = Math.max(1, rowsEnd.length) * rowH + 18;
      const info = { k, d, y: y0, h };
      y0 += h;
      return info;
    });

    const H = y0 + 36;
    container.innerHTML = '';
    svg = d3.select(container).append('svg')
      .attr('class', 'tl-svg')
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('width', W)
      .attr('height', H)
      .attr('role', 'img')
      .attr('aria-label', 'Cronología interactiva de ideas por disciplina');

    laneInfo.forEach((l) => {
      svg.append('rect')
        .attr('x', 0)
        .attr('y', l.y)
        .attr('width', W)
        .attr('height', l.h)
        .attr('fill', l.d.color)
        .attr('opacity', 0.05);

      svg.append('text')
        .attr('x', 8)
        .attr('y', l.y + l.h / 2 + 4)
        .attr('fill', l.d.color)
        .attr('font-size', 12)
        .attr('font-weight', '600')
        .text(l.d.label);
    });

    // Marcadores temporales
    let ticks = [-500, 0, 500, 1000, 1400, 1700, 1900, 2000];
    if (state.activeEra) {
      ticks = d3.ticks(state.activeEra.startYear, state.activeEra.endYear, 6);
    }

    ticks.forEach((t) => {
      const tx = m.l + x(t);
      if (tx >= m.l && tx <= W - m.r) {
        svg.append('line')
          .attr('x1', tx)
          .attr('x2', tx)
          .attr('y1', m.t)
          .attr('y2', H - 24)
          .attr('stroke', '#262f4d');

        svg.append('text')
          .attr('x', tx)
          .attr('y', H - 8)
          .attr('text-anchor', 'middle')
          .attr('fill', '#98a1bd')
          .attr('font-size', 11)
          .text(fmtYear(t));
      }
    });

    const arcs = svg.append('g').attr('fill', 'none');
    const pos = new Map();
    placed.forEach((p) => {
      const li = laneInfo.find((l) => l.k === p.laneKey);
      p.py = li.y + 14 + p.row * rowH;
      pos.set(p.n.id, p);
    });

    const label = svg.append('text')
      .attr('font-size', 11)
      .attr('fill', '#e6e9f5')
      .attr('paint-order', 'stroke')
      .attr('stroke', '#0b0e17')
      .attr('stroke-width', 3)
      .attr('pointer-events', 'none');

    const dots = svg.append('g').selectAll('circle')
      .data(placed)
      .join('circle')
      .attr('cx', (d) => d.px)
      .attr('cy', (d) => d.py)
      .attr('r', (d) => 3.5 + d.n.complexity)
      .attr('fill', (d) => graph.domains[d.n.domain].color)
      .attr('stroke', '#0b0e17')
      .attr('stroke-width', 1.2)
      .style('cursor', 'pointer')
      .attr('tabindex', 0)
      .attr('aria-label', (d) => `${d.n.label}, ${fmtYear(d.n.year)}`);

    function showArcs(id, onlyEarlier = false) {
      arcs.selectAll('*').remove();
      if (!id) return;
      const a = pos.get(id);
      adj.get(id)?.forEach((nid) => {
        const b = pos.get(nid);
        if (!a || !b) return;
        if (onlyEarlier && b.n.year > a.n.year) return;
        const mx = (a.px + b.px) / 2;
        const my = Math.min(a.py, b.py) - Math.abs(a.px - b.px) * 0.18 - 10;
        arcs.append('path')
          .attr('d', `M${a.px},${a.py} Q${mx},${my} ${b.px},${b.py}`)
          .attr('stroke', '#aab4ff')
          .attr('stroke-width', 1.6)
          .attr('opacity', 0.85);
      });
    }

    function setLabel(d) {
      if (!d) {
        label.attr('opacity', 0);
        return;
      }
      label.attr('opacity', 1).attr('x', d.px + 8).attr('y', d.py - 7).text(`${d.n.label} · ${fmtYear(d.n.year)}`);
      if (d.px > W - 220) label.attr('x', d.px - 8).attr('text-anchor', 'end');
      else label.attr('text-anchor', 'start');
    }

    setLabel(null);

    dots
      .on('mouseenter', (ev, d) => {
        if (!state.playing) {
          showArcs(d.n.id);
          setLabel(d);
        }
      })
      .on('mouseleave', () => {
        if (!state.playing) {
          showArcs(state.selected);
          setLabel(state.selected ? pos.get(state.selected) : null);
        }
      })
      .on('click', (ev, d) => pick(d.n.id, true))
      .on('keydown', (ev, d) => {
        if (ev.key === 'Enter') pick(d.n.id, true);
      });

    draw.pos = pos;
    draw.showArcs = showArcs;
    draw.setLabel = setLabel;
    draw.dots = dots;

    if (state.selected) {
      showArcs(state.selected, state.playing);
      setLabel(pos.get(state.selected));
      mark();
    }
  }

  function mark() {
    draw.dots
      ?.attr('opacity', (d) => (state.selected && state.idx >= 0 ? (nodes.findIndex((n) => n.id === d.n.id) <= state.idx ? 1 : 0.18) : 1))
      .attr('stroke', (d) => (d.n.id === state.selected ? '#fff' : '#0b0e17'))
      .attr('stroke-width', (d) => (d.n.id === state.selected ? 3 : 1.2));
  }

  function pick(id, fromUser = false) {
    state.selected = id;
    if (fromUser) {
      stop();
      state.idx = -1;
    }
    const n = nodeById.get(id);
    if (!n) return;
    progress.visit(id);

    const eraInfo = getEraForYear(n.year);
    const prior = [...(adj.get(id) || [])].map((x) => nodeById.get(x)).filter((x) => x && x.year <= n.year).slice(0, 5);
    const later = [...(adj.get(id) || [])].map((x) => nodeById.get(x)).filter((x) => x && x.year > n.year).slice(0, 5);

    caption.innerHTML = '';
    caption.append(
      el('div', { class: 'row', style: 'align-items:center;gap:.5rem;margin-bottom:.3rem;' },
        el('b', { style: 'font-size:1.05rem' }, n.label),
        el('span', { class: 'pill', style: `--c:${graph.domains[n.domain].color}` }, graph.domains[n.domain].label),
        el('span', { class: 'pill', style: `--c:${eraInfo.color};background:rgba(255,255,255,.05);` }, `${eraInfo.icon} ${eraInfo.name}`),
        el('span', { class: 'muted' }, fmtYear(n.year)),
        el('div', { style: 'margin-left:auto;display:flex;gap:.35rem;' },
          el('button', {
            class: 'btn small',
            title: 'Trazar un puente ideológico desde este concepto hacia otra idea',
            onclick: () => {
              const tabBtn = document.querySelector('.tabs-sub [data-id="bridge"]');
              tabBtn?.click();
              const srcSelect = document.getElementById('bridge-source-select');
              if (srcSelect) {
                srcSelect.value = id;
                srcSelect.dispatchEvent(new Event('change'));
              }
            },
          }, '🌉 Trazar Puente'),
          el('button', {
            class: 'btn small',
            title: 'Crear tarjeta de estudio Anki para repasar este concepto histórico',
            onclick: (ev) => {
              const front = `¿Qué aportó **${n.label}** (${fmtYear(n.year)}) a la historia del conocimiento?`;
              const back = `${n.summary}\n\n**Disciplina:** ${graph.domains[n.domain].label}\n**Autores:** ${(n.authors || []).join(', ') || 'Tradición histórica'}`;
              if (!flashcards.has(front)) {
                flashcards.add([newCard({ front, back, tags: ['cronologia', n.domain, id], source: 'timeline' })]);
                ev.target.textContent = '✓ Guardado en Anki';
                ev.target.disabled = true;
              } else {
                ev.target.textContent = '✓ Ya en mazo';
              }
            },
          }, '🗂 Anki'),
          el('button', { class: 'btn small primary', onclick: () => openNode(id) }, '◉ Ver en el grafo')
        )
      ),
      el('p', { style: 'line-height:1.5;margin:0 0 .4rem 0;' }, n.summary),
      prior.length ? el('div', { style: 'margin-top:.2rem;' }, el('span', { class: 'muted', style: 'font-size:.82rem;' }, 'Se apoya en (anteriores): '), ...prior.map((p) => nodeChip(p.id))) : null,
      later.length ? el('div', { style: 'margin-top:.2rem;' }, el('span', { class: 'muted', style: 'font-size:.82rem;' }, 'Inspira (posteriores): '), ...later.map((p) => nodeChip(p.id))) : null
    );

    if (draw.pos) {
      draw.showArcs(id, state.playing);
      draw.setLabel(draw.pos.get(id));
      mark();
    }
    scrub.value = nodes.findIndex((x) => x.id === id);
  }

  function play() {
    state.playing = true;
    playBtn.textContent = '⏸ Pausar';
    if (state.idx < 0 || state.idx >= nodes.length - 1) state.idx = -1;
    state.timer = setInterval(() => {
      state.idx += 1;
      if (state.idx >= nodes.length) {
        stop();
        return;
      }
      pick(nodes[state.idx].id);
    }, 1800);
  }

  function stop() {
    state.playing = false;
    playBtn.textContent = '▶ Reproducir historia';
    clearInterval(state.timer);
  }

  scrub.addEventListener('input', () => {
    stop();
    state.idx = +scrub.value;
    pick(nodes[state.idx].id);
  });

  window.addEventListener('resize', () => {
    if (!wrap.hidden && wrap.isConnected) draw();
  });

  return { el: wrap, draw, stop };
}

/* ====================== 2. Buscador de Puentes Transdisciplinarios ====================== */
function bridgeFinderView() {
  const wrap = el('div', { class: 'bridge-finder' });

  // 1. Selector de Presets de Puentes
  const presetsRow = el('div', { class: 'bridge-presets-row' });
  const presetLabel = el('span', { class: 'muted', style: 'font-size:.82rem;font-weight:600;margin-right:.3rem;' }, 'Puentes Inspiradores:');
  presetsRow.append(presetLabel);

  // 2. Selectores de Origen y Destino
  const sortedNodes = [...graph.nodes].sort((a, b) => a.year - b.year);
  const srcSelect = el('select', { id: 'bridge-source-select', 'aria-label': 'Concepto origen' },
    ...sortedNodes.map((n) => el('option', { value: n.id }, `${fmtYear(n.year)} · ${n.label} (${graph.domains[n.domain]?.label || n.domain})`))
  );
  const tgtSelect = el('select', { id: 'bridge-target-select', 'aria-label': 'Concepto destino' },
    ...sortedNodes.map((n) => el('option', { value: n.id }, `${fmtYear(n.year)} · ${n.label} (${graph.domains[n.domain]?.label || n.domain})`))
  );

  // Valores iniciales
  srcSelect.value = 'aristotelian_logic';
  tgtSelect.value = 'transformers';

  const computeBtn = el('button', { class: 'btn primary', onclick: () => runBridge() }, '⚡ Trazar Puente Evolutivo');

  const selectorsCard = el('div', { class: 'bridge-selectors-card' },
    el('div', { class: 'row', style: 'justify-content:space-between;align-items:center;' },
      el('h3', { style: 'margin:0;font-size:1.1rem;' }, 'Genealogía Conceptual: ¿Cómo se conectan dos ideas distantes?'),
      el('span', { class: 'muted', style: 'font-size:.82rem;' }, 'Traza la cadena evolutiva salto por salto a través de los siglos.')
    ),
    presetsRow,
    el('div', { class: 'bridge-pickers-row' },
      el('div', { class: 'bridge-picker-group' },
        el('label', { class: 'muted', style: 'font-size:.78rem;font-weight:600;' }, '1. IDEA ORIGEN (PUNTO DE PARTIDA)'),
        srcSelect
      ),
      el('div', { style: 'font-size:1.4rem;color:var(--accent);line-height:1;margin-top:1rem;' }, '➔'),
      el('div', { class: 'bridge-picker-group' },
        el('label', { class: 'muted', style: 'font-size:.78rem;font-weight:600;' }, '2. IDEA DESTINO (CULMINACIÓN O METAMORFOSIS)'),
        tgtSelect
      ),
      el('div', { style: 'margin-top:1.1rem;' }, computeBtn)
    )
  );

  // 3. Tablero de visualización del puente
  const resultsContainer = el('div', { style: 'display:flex;flex-direction:column;gap:1rem;' });

  wrap.append(selectorsCard, resultsContainer);

  PRESET_BRIDGES.forEach((pb) => {
    const chip = el('button', {
      class: 'bridge-preset-chip',
      onclick: () => {
        presetsRow.querySelectorAll('.bridge-preset-chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        srcSelect.value = pb.source;
        tgtSelect.value = pb.target;
        runBridge();
      },
    }, `${pb.icon} ${pb.title}`);
    presetsRow.append(chip);
  });

  async function runBridge() {
    const sId = srcSelect.value;
    const tId = tgtSelect.value;
    if (!sId || !tId) return;

    resultsContainer.innerHTML = '';
    const loading = el('p', { class: 'muted', style: 'text-align:center;padding:2rem;' }, '⏳ Trazando la cadena evolutiva del conocimiento…');
    resultsContainer.append(loading);

    let bridge;
    try {
      bridge = await fetchIdeologicalBridge(sId, tId);
    } catch {
      bridge = findIdeologicalBridge(sId, tId, graph.nodes, graph.links);
    } finally {
      loading.remove();
    }

    resultsContainer.innerHTML = '';
    renderBridgeResults(bridge);
  }

  function renderBridgeResults(bridge) {
    if (!bridge || !bridge.path || !bridge.path.length) {
      resultsContainer.append(
        el('div', { class: 'callout warn' }, 'No se encontró un camino directo en la red entre estas dos ideas. Prueba seleccionando nodos centrales como «Método científico», «Lógica aristotélica» o «Cálculo infinitesimal».')
      );
      return;
    }

    const sNode = bridge.source;
    const tNode = bridge.target;
    const sEra = getEraForYear(sNode.year);
    const tEra = getEraForYear(tNode.year);

    // 1. Banner de Síntesis
    const summaryBanner = el('div', { class: 'bridge-summary-banner' },
      el('div', { class: 'bridge-stats-row' },
        el('span', { class: 'bridge-stat-badge', style: 'color:var(--warn);' }, `⏳ ${Math.abs(bridge.totalYearsSpan)} años de viaje intelectual`),
        el('span', { class: 'bridge-stat-badge', style: 'color:var(--accent);' }, `🔗 ${bridge.hops} eslabón(es) de conexión`),
        el('span', { class: 'bridge-stat-badge' }, `${sEra.icon} ${sEra.name} ➔ ${tEra.icon} ${tEra.name}`)
      ),
      el('p', { style: 'font-size:.95rem;line-height:1.55;color:#fff;margin:.3rem 0 0 0;' }, bridge.synthesis),
      el('div', { class: 'row', style: 'margin-top:.6rem;gap:.5rem;flex-wrap:wrap;' },
        el('button', {
          class: 'btn small primary',
          onclick: () => {
            navigate('graph', { path: bridge.path });
          },
        }, '🌐 Ver Camino en el Grafo Interactivo'),
        el('button', {
          class: 'btn small',
          onclick: (ev) => {
            const front = `¿Cómo se conecta históricamente **${sNode.label}** (${fmtYear(sNode.year)}) con **${tNode.label}** (${fmtYear(tNode.year)})?`;
            const stepsText = bridge.steps.map((st, i) => `${i + 1}. **${st.fromNode.label}** (${fmtYear(st.fromNode.year)}) ➔ *«${st.relation}»* ➔ **${st.toNode.label}** (${fmtYear(st.toNode.year)})`).join('\n');
            const back = `${bridge.synthesis}\n\n**Cadena de saltos conceptuales:**\n${stepsText}`;
            if (!flashcards.has(front)) {
              flashcards.add([newCard({ front, back, tags: ['puente_historico', sNode.domain, tNode.domain], source: 'bridge' })]);
              ev.target.textContent = '✓ Guardado en Anki';
              ev.target.disabled = true;
            } else {
              ev.target.textContent = '✓ Ya en mazo';
            }
          },
        }, '🗂 Guardar Puente en Anki')
      )
    );
    resultsContainer.append(summaryBanner);

    // 2. Stepper de la Genealogía
    const stepper = el('div', { class: 'bridge-stepper' });

    bridge.path.forEach((nodeId, idx) => {
      const node = nodeById.get(nodeId);
      if (!node) return;
      const domColor = graph.domains[node.domain]?.color || '#7c8cff';
      const era = getEraForYear(node.year);

      const stepCard = el('div', {
        class: 'bridge-step-card',
        style: `--step-c:${domColor}`,
        onclick: () => openNode(node.id),
      },
        el('div', { class: 'bridge-step-header' },
          el('div', { class: 'bridge-step-title' },
            el('span', { class: 'pill', style: `--c:${domColor};font-size:.72rem;` }, `Paso ${idx + 1}`),
            `✦ ${node.label}`
          ),
          el('div', { class: 'row', style: 'align-items:center;gap:.4rem;' },
            el('span', { class: 'pill', style: `--c:${domColor};` }, graph.domains[node.domain]?.label || node.domain),
            el('span', { class: 'pill', style: `--c:${era.color};background:rgba(255,255,255,.05);` }, `${era.icon} ${fmtYear(node.year)}`)
          )
        ),
        el('div', { class: 'bridge-step-desc' }, node.summary),
        el('div', { class: 'bridge-step-authors' }, `Autores clave: ${(node.authors || []).join(', ') || 'Tradición histórica'}`)
      );

      stepper.append(stepCard);

      // Conector hacia el siguiente nodo
      if (idx < bridge.steps.length) {
        const stepInfo = bridge.steps[idx];
        const isForward = stepInfo.deltaYears >= 0;
        const deltaLabel = isForward ? `+${stepInfo.deltaYears} años` : `${stepInfo.deltaYears} años`;

        const connector = el('div', { class: 'bridge-connector' },
          el('div', { class: 'bridge-connector-line' }),
          el('span', {
            class: 'bridge-delta-pill',
            title: stepInfo.annotation,
          }, `⏱ ${deltaLabel} · «${stepInfo.relation}» ➔`)
        );
        stepper.append(connector);
      }
    });

    resultsContainer.append(stepper);
  }

  // Ejecutar puente inicial
  runBridge();

  return {
    el: wrap,
    loadBridge(src, tgt) {
      srcSelect.value = src;
      tgtSelect.value = tgt;
      runBridge();
    },
  };
}

/* ====================== 3. Escenarios Contrafactuales ====================== */
function scenarios() {
  let sc = null, path = [];
  const picker = el('div', { class: 'row', style: 'margin-bottom:.8rem;gap:.4rem;flex-wrap:wrap;' });
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
    stage.innerHTML = '';
    treeBox.innerHTML = '';
    if (!sc) {
      stage.append(el('p', { class: 'muted' }, 'Elige un escenario para empezar.'));
      return;
    }
    const cur = sc.nodes[path[path.length - 1]];
    stage.append(el('div', { class: 'breadcrumbs' }, ...path.map((id) => el('span', {}, sc.nodes[id].title))));
    const card = el('div', { class: 'scenario-node' },
      el('div', { class: 'year' }, fmtYear(cur.year)),
      el('h2', {}, cur.title),
      el('p', {}, cur.text)
    );
    cur.choices.forEach((c) => card.append(el('button', { class: 'btn choice-btn', onclick: () => { path.push(c.next); render(); } }, '→ ' + c.label)));
    if (cur.ending) {
      card.append(
        el('div', { class: 'callout good', style: 'margin-top:.8rem' },
          el('b', {}, 'Desenlace: ' + cur.ending.title),
          el('p', {}, cur.ending.reflection)
        ),
        el('div', {}, el('span', { class: 'muted' }, 'Conceptos relacionados: '), ...cur.ending.related.map((id) => nodeChip(id)))
      );
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
    while (q.length) {
      const c = q.shift();
      sc.nodes[c].choices.forEach((ch) => {
        if (!depth.has(ch.next)) {
          depth.set(ch.next, depth.get(c) + 1);
          q.push(ch.next);
        }
      });
    }
    const layers = [];
    ids.forEach((id) => {
      const d = depth.get(id) ?? 0;
      (layers[d] ??= []).push(id);
    });
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
      svg.append('path')
        .attr('d', `M${a.x},${a.y} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x},${b.y}`)
        .attr('fill', 'none')
        .attr('stroke', on ? '#fbbf24' : '#3b4670')
        .attr('stroke-width', on ? 3 : 1.4);
    }));

    ids.forEach((id) => {
      const p = pos.get(id), n = sc.nodes[id], isEnd = !!n.ending;
      const g = svg.append('g').attr('transform', `translate(${p.x},${p.y})`).style('cursor', visited.has(id) ? 'pointer' : 'default');
      g.append(isEnd ? 'rect' : 'circle')
        .attr(isEnd ? 'x' : 'r', isEnd ? -9 : 10)
        .attr(isEnd ? 'y' : 'cx', isEnd ? -9 : 0)
        .attr(isEnd ? 'width' : 'cy', isEnd ? 18 : 0)
        .attr(isEnd ? 'height' : 'cx', isEnd ? 18 : 0)
        .attr('fill', id === curId ? '#7c8cff' : visited.has(id) ? '#fbbf24' : '#1b2340')
        .attr('stroke', '#58628a')
        .attr('rx', isEnd ? 4 : 0);

      g.append('text')
        .attr('y', 24)
        .attr('text-anchor', 'middle')
        .attr('font-size', 10.5)
        .attr('fill', visited.has(id) ? '#e6e9f5' : '#98a1bd')
        .text(n.title.length > 22 ? n.title.slice(0, 21) + '…' : n.title);

      if (visited.has(id)) {
        g.on('click', () => {
          path = path.slice(0, path.indexOf(id) + 1);
          render();
        });
      }
    });
  }

  render();
  return { el: wrap, start };
}
