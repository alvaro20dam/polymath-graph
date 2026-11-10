// AI Paper & Text Explainer: Lector Aumentado Split-Screen con Grafo Semántico Activo + Explicador Clásico RAG
import * as d3 from 'd3';
import { el, nodeChip, graph, nodeById, integrateGraphNodes, openNode, flashcards, navigate } from '../state.js';
import { explain, LEVELS } from '../engines/explain.js';
import { buildIndex, search, chunkText, answerFromDocument, terms } from '../engines/rag.js';
import { escapeHtml, cleanDocumentText, renderMarkdown } from '../engines/text.js';
import { extractDocumentText, queryDocumentRag, explainDocumentText, extractGraphNodesFromText, generateFlashcards, getLlmStatus, fetchDocumentGraphAnalysis } from '../api.js';
import { analyzeDocumentGraph, DOMAIN_COLORS, findShortestPath } from '../engines/docGraph.js';
import { newCard } from '../engines/srs.js';
import samples from '@data/samples.json';

let nodeIndex = buildIndex(graph.nodes.map((n) => ({ id: n.id, text: `${n.label} ${n.label} ${(n.authors || []).join(' ')} ${n.summary}` })));

export function mount(root) {
  const st = {
    text: samples.samples[0].text,
    level: 'beginner',
    lang: 'es',
    index: null,
    editing: false,
    mode: 'splitscreen', // 'splitscreen' | 'classic'
    graphViewMode: 'subgraph', // 'subgraph' | 'full'
    selectedNode: null,
    activeParaIdx: null,
    searchFilter: '',
    docAnalysis: null,
    highlightBridges: false,
  };

  // Raíz contenedora
  const container = el('div', { class: 'explainer-view-wrap' });
  root.append(container);

  // Barra de cabecera superior y selector de modo
  const llmBadge = el('span', { class: 'llm-badge', title: 'Estado del motor de lectura y RAG' }, '● Local');
  async function updateLlmBadge() {
    try {
      const status = await getLlmStatus();
      if (status.enabled) {
        llmBadge.textContent = '● IA ' + (status.model || 'Gemini');
        llmBadge.className = 'llm-badge active';
        llmBadge.title = `Lectura y RAG potenciados con ${status.model || 'Gemini'}`;
      } else {
        llmBadge.textContent = '● Modo Local';
        llmBadge.className = 'llm-badge';
      }
    } catch {
      llmBadge.textContent = '● Modo Local';
      llmBadge.className = 'llm-badge';
    }
  }
  updateLlmBadge();

  const modeControl = segControl([
    ['splitscreen', '🌐 Grafo Activo (Split-Screen)'],
    ['classic', '💬 Explicador Clásico & RAG'],
  ], st.mode, (newMode) => {
    st.mode = newMode;
    renderCurrentMode();
  });

  const headerBar = el('div', { class: 'explainer-mode-bar' },
    el('div', { class: 'row', style: 'align-items:center;gap:.6rem;' },
      el('h2', { style: 'margin:0;font-size:1.15rem;display:flex;align-items:center;gap:.35rem;' }, '📖 Lector Aumentado'),
      llmBadge
    ),
    modeControl
  );
  container.append(headerBar);

  const mainArea = el('div', { style: 'flex:1;min-height:0;display:flex;flex-direction:column;' });
  container.append(mainArea);

  // Selector de muestras y subida de archivos compartidos
  const sampleSel = el('select', { 'aria-label': 'Texto de ejemplo' },
    ...samples.samples.map((s) => el('option', { value: s.id }, s.title)),
    el('option', { value: 'custom' }, 'Mi propio texto…')
  );
  const fileInput = el('input', { type: 'file', accept: '.pdf,.txt,.md,text/plain,application/pdf', hidden: true });
  const editBtn = el('button', { class: 'btn small', onclick: () => toggleEdit() }, '✏ Pegar / editar');
  const graphBtn = el('button', { class: 'btn small', style: 'border-color:var(--accent);color:var(--accent);font-weight:600', onclick: () => integrateToGraph() }, '🌐 Integrar al Grafo');
  const cardsBtn = el('button', { class: 'btn small', style: 'border-color:var(--good);color:var(--good);font-weight:600', onclick: () => createFlashcards() }, '🗂 Crear flashcards');

  // ---------- Control Segmentado Reutilizable ----------
  function segControl(opts, value, onChange) {
    const wrap = el('div', { class: 'seg-control', role: 'group' });
    opts.forEach(([v, label]) => {
      wrap.append(el('button', {
        class: v === value ? 'active' : '',
        onclick: () => {
          wrap.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
          wrap.querySelector(`[data-v="${v}"]`).classList.add('active');
          onChange(v);
        },
        'data-v': v,
      }, label));
    });
    return wrap;
  }

  // ---------- Modo Clásico: Elementos y Estado ----------
  const classicReader = el('div', { class: 'reader', tabindex: 0, 'aria-label': 'Documento: selecciona un fragmento para explicarlo' });
  const classicEditor = el('textarea', { hidden: true, style: 'flex:1;min-height:220px', placeholder: 'Pega aquí un artículo, fórmula o párrafo difícil…' });
  const explBox = el('div', { class: 'scroll', style: 'flex:1;min-height:120px' });
  const chatLog = el('div', { class: 'chat', style: 'max-height:260px;min-height:120px' });
  const chatInput = el('input', { type: 'text', placeholder: 'Pregunta algo sobre el documento…', 'aria-label': 'Pregunta al documento' });

  const levelCtl = segControl(Object.entries(LEVELS), st.level, (v) => { st.level = v; refresh(); });
  const langCtl = segControl([['es', 'Español'], ['en', 'English']], st.lang, (v) => { st.lang = v; refresh(); });

  const classicLeft = el('div', { class: 'panel' },
    el('div', { class: 'row', style: 'margin-bottom:.6rem;align-items:center;gap:.5rem;' },
      el('h3', { class: 'grow', style: 'margin:0' }, 'Texto del Documento'),
      sampleSel
    ),
    el('div', { class: 'row', style: 'margin-bottom:.6rem' },
      el('span', { class: 'muted' }, 'Nivel:'), levelCtl,
      el('span', { class: 'muted' }, 'Idioma:'), langCtl
    ),
    el('div', { class: 'row', style: 'margin-bottom:.6rem;gap:.4rem;' },
      editBtn,
      el('button', { class: 'btn small primary', onclick: () => fileInput.click() }, '📄 Subir PDF o texto'),
      graphBtn,
      cardsBtn,
      fileInput
    ),
    classicReader, classicEditor
  );

  const classicRight = el('div', { class: 'panel' },
    el('h3', { style: 'margin:0 0 .5rem 0' }, 'Explicación Pedagógica'), explBox,
    el('h3', { style: 'margin-top:.8rem' }, 'Chat con el documento (RAG)'), chatLog,
    el('div', { class: 'row', style: 'margin-top:.4rem' },
      chatInput,
      el('button', { class: 'btn primary', onclick: () => ask() }, 'Preguntar')
    )
  );

  const classicWrap = el('div', { class: 'explainer', style: 'width:100%;height:100%;min-height:0;' }, classicLeft, classicRight);

  // ---------- Modo Split-Screen: Elementos y Estado ----------
  const splitWrap = el('div', { class: 'split-screen-container' });
  const splitReaderPane = el('div', { class: 'split-reader-pane' });
  const splitGraphPane = el('div', { class: 'split-graph-pane' });
  splitWrap.append(splitReaderPane, splitGraphPane);

  // D3 elementos
  let d3Simulation = null;
  let d3Svg = null;
  let d3GZoom = null;
  let d3GLinks = null;
  let d3GNodes = null;
  let d3Zoom = null;

  // ---------- Renderizado General ----------
  function renderCurrentMode() {
    mainArea.innerHTML = '';
    if (st.mode === 'splitscreen') {
      mainArea.append(splitWrap);
      renderSplitReader();
      initOrUpdateSplitGraph();
    } else {
      mainArea.append(classicWrap);
      renderClassicReader();
    }
  }

  // ---------- Actualización de Texto ----------
  function setText(text, keepSample = false) {
    const cleaned = cleanDocumentText(text);
    st.text = cleaned;
    st.index = buildIndex(chunkText(cleaned).map((t, i) => ({ id: i, text: t })));
    if (!keepSample) sampleSel.value = 'custom';

    // Análisis de grafo para el documento
    st.docAnalysis = analyzeDocumentGraph(st.text, graph);

    renderClassicReader();
    renderSplitReader();
    initOrUpdateSplitGraph();

    explBox.innerHTML = '';
    explBox.append(el('p', { class: 'muted' }, 'Selecciona un fragmento del texto o toca un nodo del grafo para recibir una explicación adaptativa.'));
    chatLog.innerHTML = '';
    addChat('tutor', 'Pregúntame lo que quieras sobre este documento: busco los pasajes más relevantes y te los cito.');
  }

  // ---------- Renderizado Lector Split-Screen ----------
  function renderSplitReader() {
    splitReaderPane.innerHTML = '';

    const analysis = st.docAnalysis || analyzeDocumentGraph(st.text, graph);
    st.docAnalysis = analysis;

    // 1. Barra de herramientas del lector
    const header = el('div', { class: 'split-reader-header' },
      el('div', { class: 'row', style: 'align-items:center;gap:.4rem;flex-wrap:wrap;' },
        sampleSel,
        el('button', { class: 'btn small primary', onclick: () => fileInput.click() }, '📄 Subir PDF o texto'),
        editBtn,
        graphBtn,
        cardsBtn
      ),
      // Resumen polímata
      renderPolymathSummary(analysis),
      // Buscador / filtro rápido de párrafos
      el('div', { class: 'row', style: 'align-items:center;gap:.4rem;' },
        el('input', {
          type: 'text',
          placeholder: '🔍 Filtrar párrafos por palabra o concepto…',
          style: 'flex:1;padding:.35rem .6rem;font-size:.85rem;',
          value: st.searchFilter,
          oninput: (e) => {
            st.searchFilter = e.target.value.toLowerCase().trim();
            filterParagraphs();
          },
        })
      )
    );
    splitReaderPane.append(header);

    // Editor de texto integrado
    const splitEditor = el('textarea', {
      hidden: !st.editing,
      style: 'flex:1;min-height:220px;padding:.7rem;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);font-family:inherit;',
      placeholder: 'Pega aquí tu artículo, ensayo o notas…',
    });
    if (st.editing) splitEditor.value = st.text;
    splitReaderPane.append(splitEditor);

    // Stream de párrafos interactivos
    const stream = el('div', { class: 'split-reader-stream', hidden: st.editing });

    const q = st.searchFilter;
    analysis.paragraphs.forEach((p) => {
      const pText = p.text;
      const isMatch = !q || pText.toLowerCase().includes(q) || p.nodeIds.some((id) => id.includes(q));
      if (!isMatch) return;

      const pCard = el('div', {
        class: `doc-para ${st.activeParaIdx === p.index ? 'active-para' : ''}`,
        'data-para-idx': p.index,
        'data-para-nodes': p.nodeIds.join(' '),
        onmouseenter: () => {
          st.activeParaIdx = p.index;
          highlightActiveNodes(p.nodeIds);
        },
        onmouseleave: () => {
          if (!st.selectedNode) resetGraphHighlights();
        },
        onclick: (e) => {
          if (e.target.closest('.doc-node-pill') || e.target.closest('button')) return;
          st.activeParaIdx = p.index;
          document.querySelectorAll('.doc-para').forEach((elP) => elP.classList.remove('active-para'));
          pCard.classList.add('active-para');
          highlightActiveNodes(p.nodeIds);
        },
      });

      // Texto del párrafo
      pCard.append(el('div', { class: 'doc-para-text' }, pText));

      // Pie del párrafo: chips de conceptos identificados
      const footer = el('div', { class: 'doc-para-footer' });
      const nodesWrap = el('div', { class: 'doc-para-nodes' });

      if (p.nodeIds.length) {
        p.nodeIds.forEach((nid) => {
          const nInfo = nodeById.get(nid);
          const domColor = DOMAIN_COLORS[nInfo?.domain] || '#7c8cff';
          const pill = el('span', {
            class: 'doc-node-pill',
            style: `color:${domColor};border-color:${domColor};`,
            title: `Concepto: ${nInfo?.label || nid} (${nInfo?.domain || 'general'}). Clic para inspeccionar en el grafo.`,
            onclick: (ev) => {
              ev.stopPropagation();
              focusNodeInGraph(nid);
            },
          }, `✦ ${nInfo?.label || nid}`);
          nodesWrap.append(pill);
        });
      }

      // Autores en el párrafo
      if (p.authors && p.authors.length) {
        p.authors.forEach((a) => {
          const aPill = el('span', {
            class: 'doc-node-pill',
            style: 'color:var(--text);border-color:var(--line);background:rgba(255,255,255,.07)',
            title: `Autor: ${a.name}. Clic para centrar su nodo conceptual.`,
            onclick: (ev) => {
              ev.stopPropagation();
              if (a.nodeId) focusNodeInGraph(a.nodeId);
            },
          }, `${a.avatar || '👤'} ${a.name}`);
          nodesWrap.append(aPill);
        });
      }

      footer.append(nodesWrap);

      const explainPBtn = el('button', {
        class: 'btn small',
        style: 'font-size:.72rem;padding:.15rem .45rem;',
        title: 'Explicar este párrafo con el motor pedagógico',
        onclick: (ev) => {
          ev.stopPropagation();
          showExplanation(pText);
          st.mode = 'classic';
          modeControl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === 'classic'));
          renderCurrentMode();
        },
      }, '💬 Explicar');
      footer.append(explainPBtn);

      pCard.append(footer);
      stream.append(pCard);
    });

    splitReaderPane.append(stream);
  }

  function filterParagraphs() {
    renderSplitReader();
  }

  // ---------- Resumen Polímata y Barra de Dominios ----------
  function renderPolymathSummary(analysis) {
    const wrap = el('div', { class: 'polymath-doc-summary' });

    // Fila de estadísticas
    const statsRow = el('div', { class: 'doc-stats-row' },
      el('span', { class: 'doc-stat-chip' }, `✨ ${analysis.stats.directConcepts} Conceptos`),
      el('span', { class: 'doc-stat-chip' }, `👤 ${analysis.stats.authorCount} Autores`),
      el('span', { class: 'doc-stat-chip' }, `🌉 ${analysis.bridges.length} Puentes Transdisciplinarios`),
      el('span', { class: 'doc-stat-chip', style: 'color:var(--accent);' }, `📄 ${analysis.stats.paragraphCount} Párrafos`)
    );
    wrap.append(statsRow);

    // Barra de distribución proporcional de dominios
    const distBar = el('div', { class: 'domain-dist-bar' });
    const legendRow = el('div', { class: 'domain-legend-row' });

    const entries = Object.entries(analysis.domainDistribution || {});
    entries.forEach(([domKey, domInfo]) => {
      const seg = el('div', {
        class: 'domain-dist-seg',
        style: `width:${domInfo.percentage}%;background:${domInfo.color};`,
        title: `${domInfo.label}: ${domInfo.percentage}% (${domInfo.count} conceptos)`,
      });
      distBar.append(seg);

      const leg = el('span', { title: `${domInfo.percentage}% del subgrafo conceptual` },
        el('span', { class: 'domain-legend-dot', style: `background:${domInfo.color};` }),
        `${domInfo.label} (${Math.round(domInfo.percentage)}%)`
      );
      legendRow.append(leg);
    });

    if (entries.length) {
      wrap.append(distBar, legendRow);
    }

    return wrap;
  }

  // ---------- Grafo Semántico D3 (Panel Derecho) ----------
  function initOrUpdateSplitGraph() {
    splitGraphPane.innerHTML = '';

    const analysis = st.docAnalysis || analyzeDocumentGraph(st.text, graph);
    st.docAnalysis = analysis;

    // Cabecera del panel del grafo
    const graphHeader = el('div', { class: 'split-graph-header' },
      el('div', { class: 'row', style: 'align-items:center;gap:.35rem;' },
        el('h3', { style: 'margin:0;font-size:1rem;' }, 'Red Conceptual Activa'),
        el('span', { class: 'muted', style: 'font-size:.78rem;' }, `(${analysis.detectedNodes.length} nodos)`)
      ),
      el('div', { class: 'row', style: 'gap:.3rem;' },
        el('button', {
          class: `btn small ${st.graphViewMode === 'subgraph' ? 'active' : ''}`,
          onclick: () => {
            st.graphViewMode = st.graphViewMode === 'subgraph' ? 'full' : 'subgraph';
            initOrUpdateSplitGraph();
          },
        }, st.graphViewMode === 'subgraph' ? '✦ Subgrafo Documento' : '🌐 Grafo Completo'),
        el('button', {
          class: `btn small ${st.highlightBridges ? 'active' : ''}`,
          title: 'Resaltar puentes que conectan disciplinas distintas en este texto',
          onclick: () => {
            st.highlightBridges = !st.highlightBridges;
            initOrUpdateSplitGraph();
          },
        }, '🌉 Ver Puentes'),
        el('button', {
          class: 'btn small',
          title: 'Restablecer zoom y posición del grafo',
          onclick: () => resetGraphZoom(),
        }, '🎯 Centrar')
      )
    );
    splitGraphPane.append(graphHeader);

    // Canvas SVG para D3
    const stage = el('div', { class: 'split-graph-stage' });
    splitGraphPane.append(stage);

    // Inspector de Concepto Activo
    const inspectorCard = el('div', { class: 'doc-inspector-card' });
    splitGraphPane.append(inspectorCard);
    renderInspectorCard(inspectorCard);

    // Renderizar simulación D3 en el stage
    renderD3Simulation(stage, analysis, inspectorCard);
  }

  function renderD3Simulation(stageEl, analysis, inspectorCard) {
    if (d3Simulation) d3Simulation.stop();

    const width = stageEl.clientWidth || 460;
    const height = stageEl.clientHeight || 340;

    let displayNodes = [];
    let displayLinks = [];

    if (st.graphViewMode === 'subgraph') {
      displayNodes = analysis.detectedNodes.map((n) => ({ ...n }));
      displayLinks = analysis.links.map((l) => ({ ...l }));
    } else {
      // Grafo global con marcas de presencia en el documento
      const detectedSet = new Set(analysis.detectedNodes.map((n) => n.id));
      displayNodes = graph.nodes.map((n) => ({
        ...n,
        inDoc: detectedSet.has(n.id),
        mentions: detectedSet.has(n.id) ? 1 : 0,
      }));
      displayLinks = graph.links.map((l) => ({ ...l }));
    }

    const svg = d3.select(stageEl).append('svg')
      .attr('viewBox', [0, 0, width, height])
      .attr('class', 'split-graph-svg');
    d3Svg = svg;

    // Filtros de brillo SVG
    const defs = svg.append('defs');
    const filter = defs.append('filter')
      .attr('id', 'split-node-glow')
      .attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
    filter.append('feGaussianBlur').attr('stdDeviation', 3.5).attr('result', 'blur');
    const feMerge = filter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'blur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    const gZoom = svg.append('g');
    d3GZoom = gZoom;
    const gLinks = gZoom.append('g').attr('class', 'links');
    const gNodes = gZoom.append('g').attr('class', 'nodes');
    d3GLinks = gLinks;
    d3GNodes = gNodes;

    // Zoom y Pan
    d3Zoom = d3.zoom()
      .scaleExtent([0.4, 3])
      .on('zoom', (ev) => gZoom.attr('transform', ev.transform));
    svg.call(d3Zoom);

    // Enlaces
    const linkSel = gLinks.selectAll('line')
      .data(displayLinks)
      .join('line')
      .attr('stroke', '#384260')
      .attr('stroke-width', 1.4)
      .attr('stroke-opacity', 0.6);

    // Nodos
    const nodeSel = gNodes.selectAll('g')
      .data(displayNodes)
      .join('g')
      .attr('class', 'split-graph-node')
      .attr('cursor', 'pointer')
      .call(d3.drag()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended));

    // Círculos de nodos
    nodeSel.append('circle')
      .attr('r', (d) => {
        if (d.isBridge) return 10;
        const base = d.inDoc === false ? 9 : 14;
        return Math.min(24, base + (d.mentions || 0) * 2.5);
      })
      .attr('fill', (d) => DOMAIN_COLORS[d.domain] || '#7c8cff')
      .attr('fill-opacity', (d) => (d.isBridge ? 0.35 : (d.inDoc === false ? 0.4 : 0.9)))
      .attr('stroke', '#fff')
      .attr('stroke-width', (d) => (d.id === st.selectedNode?.id ? 2.5 : 1))
      .attr('stroke-dasharray', (d) => (d.isBridge ? '3,2' : 'none'));

    // Etiquetas de nodos
    nodeSel.append('text')
      .text((d) => (d.label.length > 18 ? d.label.slice(0, 16) + '…' : d.label))
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => (d.isBridge ? 18 : 20))
      .attr('font-size', '10px')
      .attr('font-family', 'inherit')
      .attr('fill', (d) => (d.inDoc === false ? '#8a94b0' : '#e2e8f0'))
      .attr('pointer-events', 'none');

    // Interacción al hacer clic en un nodo
    nodeSel.on('click', (ev, d) => {
      ev.stopPropagation();
      st.selectedNode = d;
      renderInspectorCard(inspectorCard);
      highlightActiveNodes([d.id]);
      scrollToFirstMention(d.id);
    });

    // Simulación física
    d3Simulation = d3.forceSimulation(displayNodes)
      .force('link', d3.forceLink(displayLinks).id((d) => d.id).distance(65))
      .force('charge', d3.forceManyBody().strength(-140))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide().radius((d) => (d.isBridge ? 18 : 26)));

    d3Simulation.on('tick', () => {
      linkSel
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y);

      nodeSel.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

    function dragstarted(event) {
      if (!event.active) d3Simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }
    function dragged(event) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }
    function dragended(event) {
      if (!event.active) d3Simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }

    // Si hay puentes activos para resaltar
    if (st.highlightBridges && analysis.bridges.length) {
      highlightBridgePaths(analysis.bridges);
    }
  }

  function resetGraphZoom() {
    if (!d3Svg || !d3Zoom) return;
    d3Svg.transition().duration(500).call(d3Zoom.transform, d3.zoomIdentity);
  }

  function highlightActiveNodes(nodeIds) {
    if (!d3GNodes || !d3GLinks) return;
    const activeSet = new Set(nodeIds);

    d3GNodes.selectAll('g.split-graph-node').each(function (d) {
      const isAct = activeSet.has(d.id);
      const circle = d3.select(this).select('circle');
      const text = d3.select(this).select('text');

      if (isAct) {
        circle
          .transition().duration(200)
          .attr('transform', 'scale(1.25)')
          .attr('stroke', '#fff')
          .attr('stroke-width', 2.8)
          .attr('filter', 'url(#split-node-glow)')
          .attr('fill-opacity', 1);
        text
          .transition().duration(200)
          .attr('fill', '#ffffff')
          .attr('font-weight', '700');
        d3.select(this).style('opacity', 1);
      } else {
        circle
          .transition().duration(200)
          .attr('transform', 'scale(1)')
          .attr('stroke-width', 1)
          .attr('filter', null)
          .attr('fill-opacity', d.isBridge ? 0.25 : 0.4);
        text
          .transition().duration(200)
          .attr('fill', '#6a728a')
          .attr('font-weight', 'normal');
        d3.select(this).style('opacity', activeSet.size ? 0.3 : 1);
      }
    });

    // Resaltar enlaces entre nodos activos
    d3GLinks.selectAll('line').each(function (d) {
      const sId = typeof d.source === 'object' ? d.source.id : d.source;
      const tId = typeof d.target === 'object' ? d.target.id : d.target;
      const isBridgeLink = activeSet.has(sId) && activeSet.has(tId);

      if (isBridgeLink) {
        d3.select(this)
          .transition().duration(200)
          .attr('stroke', 'var(--accent)')
          .attr('stroke-width', 2.6)
          .attr('stroke-opacity', 1);
      } else {
        d3.select(this)
          .transition().duration(200)
          .attr('stroke', '#384260')
          .attr('stroke-width', 1.4)
          .attr('stroke-opacity', activeSet.size ? 0.15 : 0.6);
      }
    });
  }

  function resetGraphHighlights() {
    if (!d3GNodes || !d3GLinks) return;
    d3GNodes.selectAll('g.split-graph-node').each(function (d) {
      d3.select(this).style('opacity', 1);
      d3.select(this).select('circle')
        .transition().duration(200)
        .attr('transform', 'scale(1)')
        .attr('stroke-width', 1)
        .attr('filter', null)
        .attr('fill-opacity', d.isBridge ? 0.35 : (d.inDoc === false ? 0.4 : 0.9));
      d3.select(this).select('text')
        .transition().duration(200)
        .attr('fill', d.inDoc === false ? '#8a94b0' : '#e2e8f0')
        .attr('font-weight', 'normal');
    });
    d3GLinks.selectAll('line')
      .transition().duration(200)
      .attr('stroke', '#384260')
      .attr('stroke-width', 1.4)
      .attr('stroke-opacity', 0.6);
  }

  function highlightBridgePaths(bridges) {
    if (!d3GLinks || !d3GNodes) return;
    const bridgeNodes = new Set();
    const bridgeLinkPairs = new Set();

    bridges.forEach((b) => {
      for (let i = 0; i < b.path.length; i++) {
        bridgeNodes.add(b.path[i]);
        if (i < b.path.length - 1) {
          bridgeLinkPairs.add([b.path[i], b.path[i + 1]].sort().join('::'));
        }
      }
    });

    d3GLinks.selectAll('line').each(function (d) {
      const sId = typeof d.source === 'object' ? d.source.id : d.source;
      const tId = typeof d.target === 'object' ? d.target.id : d.target;
      const key = [sId, tId].sort().join('::');
      if (bridgeLinkPairs.has(key)) {
        d3.select(this)
          .attr('stroke', 'var(--warn)')
          .attr('stroke-width', 2.8)
          .attr('stroke-opacity', 1);
      }
    });
  }

  function focusNodeInGraph(nodeId) {
    const fullNode = nodeById.get(nodeId);
    if (!fullNode) return;
    st.selectedNode = fullNode;

    const inspector = splitGraphPane.querySelector('.doc-inspector-card');
    if (inspector) renderInspectorCard(inspector);

    highlightActiveNodes([nodeId]);
    scrollToFirstMention(nodeId);

    // Centrar simulación en el nodo si existe
    if (d3Simulation && d3Svg && d3Zoom) {
      const matched = d3Simulation.nodes().find((n) => n.id === nodeId);
      if (matched && typeof matched.x === 'number') {
        const width = splitGraphPane.querySelector('.split-graph-stage')?.clientWidth || 460;
        const height = splitGraphPane.querySelector('.split-graph-stage')?.clientHeight || 340;
        d3Svg.transition().duration(600).call(
          d3Zoom.transform,
          d3.zoomIdentity.translate(width / 2 - matched.x * 1.3, height / 2 - matched.y * 1.3).scale(1.3)
        );
      }
    }
  }

  function scrollToFirstMention(nodeId) {
    const stream = splitReaderPane.querySelector('.split-reader-stream');
    if (!stream) return;
    const targetPara = stream.querySelector(`[data-para-nodes~="${nodeId}"]`);
    if (targetPara) {
      targetPara.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetPara.classList.add('flash-highlight');
      document.querySelectorAll('.doc-para').forEach((p) => p.classList.remove('active-para'));
      targetPara.classList.add('active-para');
      setTimeout(() => targetPara.classList.remove('flash-highlight'), 1800);
    }
  }

  // ---------- Inspector de Concepto Activo ----------
  function renderInspectorCard(inspectorEl) {
    inspectorEl.innerHTML = '';
    const node = st.selectedNode;

    if (!node) {
      inspectorEl.className = 'doc-inspector-card empty';
      inspectorEl.innerHTML = '👉 Haz clic en un concepto del texto o nodo del grafo para inspeccionar su definición, conexiones y relevancia transdisciplinaria.';
      return;
    }

    inspectorEl.className = 'doc-inspector-card';
    const domColor = DOMAIN_COLORS[node.domain] || '#7c8cff';

    const topRow = el('div', { class: 'row', style: 'justify-content:space-between;align-items:center;margin-bottom:.25rem;' },
      el('span', { class: 'pill', style: `--c:${domColor};` }, node.domain || 'disciplina'),
      el('small', { class: 'muted' }, `Complejidad ${node.complexity || 3}/5 · ${node.year || 'Histórico'}`)
    );

    const title = el('h4', { style: 'margin:0 0 .2rem 0;color:#fff;' }, `✦ ${node.label}`);
    const summary = el('p', { style: 'font-size:.84rem;line-height:1.45;margin:0 0 .4rem 0;' }, node.summary || 'Concepto clave del conocimiento interconectado.');
    const authors = el('small', { class: 'muted', style: 'display:block;margin-bottom:.5rem;' }, `Autores: ${(node.authors || []).join(', ') || 'Tradición histórica'}`);

    const actions = el('div', { class: 'row', style: 'gap:.35rem;flex-wrap:wrap;' },
      el('button', {
        class: 'btn small',
        title: 'Desplazarse al párrafo del documento donde se menciona este concepto',
        onclick: () => scrollToFirstMention(node.id),
      }, '📜 Ir a párrafo'),
      el('button', {
        class: 'btn small primary',
        title: 'Explicar este concepto en detalle',
        onclick: () => {
          showExplanation(node.label);
          st.mode = 'classic';
          modeControl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === 'classic'));
          renderCurrentMode();
        },
      }, '💬 Explicar'),
      el('button', {
        class: 'btn small',
        title: 'Guardar concepto en tu mazo de repaso espaciado Anki',
        onclick: (ev) => {
          const front = `¿Qué es **${node.label}** y cuál es su relevancia?`;
          const back = node.summary || 'Concepto de Polymath Graph';
          if (!flashcards.has(front)) {
            flashcards.add([newCard({ front, back, tags: ['documento', node.domain || 'general', node.id], source: 'doc_graph' })]);
            ev.target.textContent = '✓ Guardado en Anki';
            ev.target.disabled = true;
          } else {
            ev.target.textContent = '✓ Ya en mazo';
          }
        },
      }, '🗂 Guardar Anki'),
      el('button', {
        class: 'btn small',
        title: 'Abrir este nodo en la vista del Grafo Principal',
        onclick: () => openNode(node.id),
      }, '🚀 Ver en Grafo Principal')
    );

    inspectorEl.append(topRow, title, summary, authors, actions);
  }

  // ---------- Modo Clásico: Renderizado ----------
  function renderClassicReader() {
    const r = explain({ selected: '', context: st.text, level: st.level, lang: st.lang });
    classicReader.innerHTML = '';
    r.segments.forEach((s) => {
      if (!s.kind) classicReader.append(document.createTextNode(s.t));
      else classicReader.append(el('span', { class: s.kind === 'term' ? 'hl-term' : 'hl-jargon', 'data-text': s.t, title: s.kind === 'jargon' ? s.gloss : 'Término del glosario: clic para explicar' }, s.t));
    });
  }

  function refresh() {
    renderClassicReader();
    if (lastSel) showExplanation(lastSel);
  }

  let lastSel = '';
  async function showExplanation(text) {
    lastSel = text;
    explBox.innerHTML = '';
    const loading = el('p', { class: 'muted' }, 'Consultando explicación pedagógica…');
    explBox.append(loading);

    let r;
    try {
      r = await explainDocumentText(text, st.text, st.level, st.lang);
    } catch {
      r = explain({ selected: text, context: st.text, level: st.level, lang: st.lang });
    } finally {
      loading.remove();
    }

    explBox.innerHTML = '';
    explBox.append(
      el('div', { class: 'quote' }, '“' + (text.length > 240 ? text.slice(0, 240) + '…' : text) + '”'),
      el('p', { class: 'muted' }, `Complejidad estimada: `, el('b', {}, r.readability?.label || 'Media'), ` · Nivel: ${LEVELS[st.level]}`)
    );

    if (r.ai_explanation) {
      explBox.append(el('div', { class: 'card' },
        el('h4', { style: 'display:flex;align-items:center;gap:.3rem;margin:0 0 .3rem 0;' }, '✨ Explicación (' + LEVELS[st.level] + ')'),
        el('div', { style: 'line-height:1.45;', html: renderMarkdown(r.ai_explanation) })
      ));
    }

    const cardBack = r.ai_explanation || (r.termCards || r.term_cards || []).map((c) => `**${c.label}:** ${c.text}`).join('\n\n') || r.simplified || '';
    if (cardBack) {
      const front = text.length > 160 ? `Explica con tus palabras: «${text.slice(0, 160)}…»` : (text.split(/\s+/).length <= 5 ? `¿Qué significa **${text}**?` : `Explica con tus palabras: «${text}»`);
      const saveBtn = el('button', { class: 'btn small', style: 'margin-bottom:.6rem', title: 'Añade esta explicación a tu mazo de repaso espaciado' }, '🗂 Guardar como tarjeta');
      if (flashcards.has(front)) { saveBtn.disabled = true; saveBtn.textContent = '✓ Ya está en tu mazo'; }
      saveBtn.addEventListener('click', () => {
        const related = (r.related || r.related_nodes || []).filter((id) => nodeById.has(id)).slice(0, 2);
        const added = flashcards.add([newCard({ front, back: cardBack, tags: ['explicador', st.level, ...related], source: 'explanation' })]);
        saveBtn.disabled = true;
        saveBtn.textContent = added.length ? '✓ Guardada en «🗂 Repaso»' : '✓ Ya está en tu mazo';
      });
      explBox.append(saveBtn);
    }

    const termCards = r.termCards || r.term_cards || [];
    termCards.forEach((c) => explBox.append(el('div', { class: 'card' }, el('h4', { style: 'margin:0 0 .2rem 0;' }, c.label), el('p', { style: 'font-size:.85rem;' }, c.text), nodeChip(c.node))));
    if (r.jargon?.length) explBox.append(el('div', { class: 'card' }, el('h4', { style: 'margin:0 0 .2rem 0;' }, 'Jerga traducida'), el('ul', {}, ...r.jargon.map((j) => el('li', {}, el('b', {}, j.word), ' → ', j.meaning)))));
    if (r.simplified) explBox.append(el('div', { class: 'card' }, el('h4', { style: 'margin:0 0 .2rem 0;' }, 'Reformulación simple'), el('p', {}, r.simplified)));

    const sem = search(nodeIndex, text, 3).map((h) => h.doc.id);
    const related = [...new Set([...(r.related || r.related_nodes || []), ...sem])].slice(0, 6);
    if (related.length) explBox.append(el('div', { style: 'margin-top:.4rem;' }, el('h5', { style: 'margin:0 0 .3rem 0;' }, 'Explora en el grafo'), ...related.map((id) => nodeChip(id))));
  }

  classicReader.addEventListener('mouseup', () => {
    const t = window.getSelection().toString().trim();
    if (t.length >= 3) showExplanation(t);
  });
  classicReader.addEventListener('click', (e) => {
    const t = e.target.closest('.hl-term, .hl-jargon');
    if (t && !window.getSelection().toString()) showExplanation(t.dataset.text);
  });

  // ---------- Edición y Carga de Archivos ----------
  function toggleEdit() {
    st.editing = !st.editing;
    classicEditor.hidden = !st.editing;
    classicReader.hidden = st.editing;
    editBtn.textContent = st.editing ? '✔ Aplicar texto' : '✏ Pegar / editar';

    const splitEditor = splitReaderPane.querySelector('textarea');
    const splitStream = splitReaderPane.querySelector('.split-reader-stream');
    if (splitEditor && splitStream) {
      splitEditor.hidden = !st.editing;
      splitStream.hidden = st.editing;
      if (st.editing) splitEditor.value = st.text;
    }

    if (st.editing) {
      classicEditor.value = st.text;
    } else {
      const val = (splitEditor?.value || classicEditor.value || '').trim();
      if (val) setText(val);
    }
  }

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    const oldText = editBtn.textContent;
    editBtn.textContent = '⏳ Procesando archivo…';
    try {
      const doc = await extractDocumentText(f);
      setText(doc.text);
      sampleSel.value = 'custom';
      const ocrTag = doc.ocr ? ' · ✨ Transcrito con OCR Gemini' : '';
      addChat('tutor', `📄 Documento cargado: **${doc.filename}** (${doc.pages} pág · ${doc.chars} caracteres${ocrTag}). El subgrafo semántico activo se ha actualizado a la derecha.`);
    } catch (err) {
      alert(err.message || 'Error al abrir el archivo');
    } finally {
      editBtn.textContent = st.editing ? '✔ Aplicar texto' : '✏ Pegar / editar';
      fileInput.value = '';
    }
  });

  sampleSel.addEventListener('change', () => {
    if (sampleSel.value === 'custom') {
      if (!st.editing) toggleEdit();
      return;
    }
    const s = samples.samples.find((x) => x.id === sampleSel.value);
    st.lang = s.lang === 'en' ? 'en' : 'es';
    langCtl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === st.lang));
    if (st.editing) toggleEdit();
    setText(s.text, true);
  });

  async function integrateToGraph() {
    const currentText = st.text.trim();
    if (currentText.length < 15) {
      alert('El documento es demasiado corto para extraer conceptos al grafo.');
      return;
    }

    graphBtn.disabled = true;
    const origLabel = graphBtn.textContent;
    graphBtn.textContent = '⏳ Extrayendo nodos…';

    let res;
    try {
      res = await extractGraphNodesFromText(currentText, 3, true);
    } catch {
      res = { nodes: [], links: [], engine: 'error' };
    } finally {
      graphBtn.disabled = false;
      graphBtn.textContent = origLabel;
    }

    if (!res.nodes || !res.nodes.length) {
      alert('No se pudieron extraer nuevos conceptos de este texto.');
      return;
    }

    integrateGraphNodes(res.nodes, res.links || []);
    nodeIndex = buildIndex(graph.nodes.map((n) => ({ id: n.id, text: `${n.label} ${n.label} ${(n.authors || []).join(' ')} ${n.summary}` })));
    st.docAnalysis = analyzeDocumentGraph(st.text, graph);

    renderSplitReader();
    initOrUpdateSplitGraph();

    const names = res.nodes.map((n) => `**✦ ${n.label}**`).join(', ');
    addChat('tutor', `🌐 Integré ${res.nodes.length} nuevo(s) concepto(s) al Grafo de Conocimiento: ${names}. Ya aparecen conectados en tu mapa interactivo.`);
  }

  async function createFlashcards() {
    const currentText = st.text.trim();
    if (currentText.length < 40) {
      alert('El documento es demasiado corto para generar tarjetas de estudio.');
      return;
    }

    cardsBtn.disabled = true;
    const origLabel = cardsBtn.textContent;
    cardsBtn.textContent = '⏳ Diseñando tarjetas…';

    let res;
    try {
      res = await generateFlashcards(currentText, { source: 'document', maxCards: 6, level: st.level, lang: st.lang });
    } catch {
      res = { cards: [], engine: 'error' };
    } finally {
      cardsBtn.disabled = false;
      cardsBtn.textContent = origLabel;
    }

    const cards = (res.cards || []).filter((c) => c && c.front && c.back);
    if (!cards.length) {
      alert('No se pudieron proponer tarjetas a partir de este texto.');
      return;
    }

    const added = flashcards.add(cards.map((c) => newCard({
      front: c.front,
      back: c.back,
      tags: ['documento', st.level],
      source: 'doc_auto',
    })));

    alert(`✓ Se añadieron ${added.length} tarjetas de estudio a tu mazo de Repaso Espaciado.`);
  }

  // ---------- Chat con Documento (RAG) ----------
  function addChat(role, content) {
    const m = el('div', { class: 'msg ' + role, html: renderMarkdown(content) });
    chatLog.append(m);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function highlight(text, shared) {
    let html = escapeHtml(text);
    const words = new Set(shared);
    html = html.replace(/[\p{L}\p{N}]+/gu, (w) => (terms(w).some((t) => words.has(t)) ? `<mark>${w}</mark>` : w));
    return html;
  }

  async function ask() {
    const q = chatInput.value.trim();
    if (!q) return;
    chatInput.value = '';
    addChat('me', q);

    const thinking = el('div', { class: 'msg tutor thinking' }, 'Consultando el documento con IA…');
    chatLog.append(thinking);
    chatLog.scrollTop = chatLog.scrollHeight;

    let res;
    try {
      res = await queryDocumentRag(st.text, q, 3, st.index);
    } catch {
      res = answerFromDocument(st.index, q, 3);
    } finally {
      thinking.remove();
    }

    if (!res.found) {
      addChat('tutor', res.answer || 'No encontré pasajes relevantes en este documento para responder a tu pregunta.');
      return;
    }

    const box = el('div', { class: 'msg tutor' });
    if (res.answer) {
      box.append(el('div', { style: 'margin-bottom:.5rem; line-height:1.45;', html: renderMarkdown(res.answer) }));
    }
    const passages = res.passages || (res.hits || []).map((h) => ({ text: h.doc.text, score: h.score, terms: h.shared }));
    if (passages && passages.length) {
      box.append(el('div', { class: 'muted', style: 'margin-top:.4rem; font-size:.8rem; font-weight:600;' }, 'Citas y pasajes de referencia:'));
      passages.forEach((p, i) => {
        box.append(el('div', { class: 'quote', html: `<b>[${i + 1}]</b> ${highlight(p.text, p.terms || [])} <span class="muted">(${Math.round((p.score || 0.8) * 100)}%)</span>` }));
      });
    }
    const engineLabel = res.engine?.includes('gemini') ? '🤖 Respuesta sintetizada por Gemini Flash con citas exactas.' : 'Respuesta extractiva: cito el texto del documento sin inventar contenido.';
    box.append(el('div', { class: 'muted', style: 'font-size:.78rem; margin-top:.3rem;' }, engineLabel));

    chatLog.append(box);
    chatLog.scrollTop = chatLog.scrollHeight;
  }
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });

  // Inicializar estado
  setText(st.text, true);
  renderCurrentMode();

  return {
    show(params = {}) {
      if (params.text) {
        if (st.editing) toggleEdit();
        setText(params.text);
        showExplanation(params.text);
      }
    },
  };
}
