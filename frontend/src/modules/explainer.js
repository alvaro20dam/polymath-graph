// AI Paper & Text Explainer: explicación in-context por niveles + chat con el documento (RAG TF-IDF + Gemini)
import { el, nodeChip, graph, nodeById, integrateGraphNodes, openNode } from '../state.js';
import { explain, LEVELS } from '../engines/explain.js';
import { buildIndex, search, chunkText, answerFromDocument, terms } from '../engines/rag.js';
import { escapeHtml, cleanDocumentText, renderMarkdown } from '../engines/text.js';
import { extractDocumentText, queryDocumentRag, explainDocumentText, extractGraphNodesFromText, getLlmStatus } from '../api.js';
import samples from '@data/samples.json';

let nodeIndex = buildIndex(graph.nodes.map((n) => ({ id: n.id, text: `${n.label} ${n.label} ${n.authors.join(' ')} ${n.summary}` })));

export function mount(root) {
  const st = { text: samples.samples[0].text, level: 'beginner', lang: 'es', index: null, editing: false };

  const sampleSel = el('select', { 'aria-label': 'Texto de ejemplo' }, ...samples.samples.map((s) => el('option', { value: s.id }, s.title)), el('option', { value: 'custom' }, 'Mi propio texto…'));
  const reader = el('div', { class: 'reader', tabindex: 0, 'aria-label': 'Documento: selecciona un fragmento para explicarlo' });
  const editor = el('textarea', { hidden: true, style: 'flex:1;min-height:200px', placeholder: 'Pega aquí un artículo, fórmula o párrafo difícil…' });
  const fileInput = el('input', { type: 'file', accept: '.pdf,.txt,.md,text/plain,application/pdf', hidden: true });
  const editBtn = el('button', { class: 'btn small', onclick: () => toggleEdit() }, '✏ Pegar / editar texto');
  const graphBtn = el('button', { class: 'btn small', style: 'border-color:var(--accent);color:var(--accent);font-weight:600', onclick: () => integrateToGraph() }, '🌐 Integrar conceptos al Grafo');
  const levelCtl = segControl(Object.entries(LEVELS), st.level, (v) => { st.level = v; refresh(); });
  const langCtl = segControl([['es', 'Español'], ['en', 'English']], st.lang, (v) => { st.lang = v; refresh(); });

  const llmBadge = el('span', { class: 'llm-badge', title: 'Estado del motor de lectura y RAG' }, '● Local');
  async function updateLlmBadge() {
    try {
      const status = await getLlmStatus();
      if (status.enabled) {
        llmBadge.textContent = '● IA ' + (status.model || 'Gemini');
        llmBadge.className = 'llm-badge active';
        llmBadge.title = `RAG potenciado con ${status.model || 'Gemini'}`;
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

  const left = el('div', { class: 'panel' },
    el('div', { class: 'row', style: 'margin-bottom:.6rem; align-items:center; gap:.5rem;' },
      el('h2', { class: 'grow', style: 'margin:0' }, 'Lectura aumentada'),
      llmBadge,
      sampleSel),
    el('div', { class: 'row', style: 'margin-bottom:.6rem' },
      el('span', { class: 'muted' }, 'Nivel:'), levelCtl, el('span', { class: 'muted' }, 'Idioma:'), langCtl),
    el('div', { class: 'row', style: 'margin-bottom:.6rem; gap:.4rem;' },
      editBtn,
      el('button', { class: 'btn small primary', onclick: () => fileInput.click() }, '📄 Subir PDF o texto'),
      graphBtn,
      fileInput,
      el('span', { class: 'muted', style: 'font-size:.8rem' }, 'Selecciona texto o integra ideas al mapa.')),
    reader, editor);

  const explBox = el('div', { class: 'scroll', style: 'flex:1;min-height:120px' });
  const chatLog = el('div', { class: 'chat', style: 'max-height:260px;min-height:120px' });
  const chatInput = el('input', { type: 'text', placeholder: 'Pregunta algo sobre el documento…', 'aria-label': 'Pregunta al documento' });
  const right = el('div', { class: 'panel' },
    el('h2', {}, 'Explicación'), explBox,
    el('h2', { style: 'margin-top:.8rem' }, 'Chat con el documento'), chatLog,
    el('div', { class: 'row', style: 'margin-top:.4rem' }, chatInput, el('button', { class: 'btn primary', onclick: () => ask() }, 'Preguntar')));
  root.append(el('div', { class: 'explainer' }, left, right));

  function segControl(opts, value, onChange) {
    const wrap = el('div', { class: 'seg-control', role: 'group' });
    opts.forEach(([v, label]) => wrap.append(el('button', { class: v === value ? 'active' : '', onclick: () => { wrap.querySelectorAll('button').forEach((b) => b.classList.remove('active')); wrap.querySelector(`[data-v="${v}"]`).classList.add('active'); onChange(v); }, 'data-v': v }, label)));
    return wrap;
  }

  function setText(text, keepSample = false) {
    const cleaned = cleanDocumentText(text);
    st.text = cleaned;
    st.index = buildIndex(chunkText(cleaned).map((t, i) => ({ id: i, text: t })));
    if (!keepSample) sampleSel.value = 'custom';
    renderReader();
    explBox.innerHTML = '';
    explBox.append(el('p', { class: 'muted' }, 'Selecciona un fragmento del texto (o toca un término subrayado) para recibir una explicación ajustada a tu nivel.'));
    chatLog.innerHTML = '';
    addChat('tutor', 'Pregúntame lo que quieras sobre este documento: busco los pasajes más relevantes y te los cito.');
  }

  function renderReader() {
    const r = explain({ selected: '', context: st.text, level: st.level, lang: st.lang });
    reader.innerHTML = '';
    r.segments.forEach((s) => {
      if (!s.kind) reader.append(document.createTextNode(s.t));
      else reader.append(el('span', { class: s.kind === 'term' ? 'hl-term' : 'hl-jargon', 'data-text': s.t, title: s.kind === 'jargon' ? s.gloss : 'Término del glosario: clic para explicar' }, s.t));
    });
  }

  function refresh() {
    renderReader();
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
    explBox.append(el('div', { class: 'quote' }, '“' + (text.length > 240 ? text.slice(0, 240) + '…' : text) + '”'),
      el('p', { class: 'muted' }, `Complejidad estimada: `, el('b', {}, r.readability?.label || 'Media'), ` · Nivel: ${LEVELS[st.level]}`));

    if (r.ai_explanation) {
      explBox.append(el('div', { class: 'card' },
        el('h3', { style: 'display:flex;align-items:center;gap:.3rem;' }, '✨ Explicación (' + LEVELS[st.level] + ')'),
        el('div', { style: 'line-height:1.45;', html: renderMarkdown(r.ai_explanation) })));
    }

    const termCards = r.termCards || r.term_cards || [];
    termCards.forEach((c) => explBox.append(el('div', { class: 'card' }, el('h3', {}, c.label), el('p', {}, c.text), nodeChip(c.node))));
    if (r.jargon?.length) explBox.append(el('div', { class: 'card' }, el('h3', {}, 'Jerga traducida'), el('ul', {}, ...r.jargon.map((j) => el('li', {}, el('b', {}, j.word), ' → ', j.meaning)))));
    if (r.simplified) explBox.append(el('div', { class: 'card' }, el('h3', {}, 'Reformulación simple'), el('p', {}, r.simplified)));
    if (!termCards.length && !r.jargon?.length && !r.ai_explanation) {
      explBox.append(el('div', { class: 'callout warn' }, 'No reconozco términos técnicos en este fragmento. Abajo te muestro ideas del grafo que podrían ayudarte a contextualizarlo.'));
    }
    const sem = search(nodeIndex, text, 3).map((h) => h.doc.id);
    const related = [...new Set([...(r.related || r.related_nodes || []), ...sem])].slice(0, 6);
    if (related.length) explBox.append(el('div', {}, el('h4', {}, 'Explora en el grafo'), ...related.map((id) => nodeChip(id))));
    if (st.level === 'expert') explBox.append(el('div', { class: 'callout', style: 'margin-top:.6rem' }, 'Pregunta crítica: ¿qué supuestos implícitos necesita este fragmento y qué pasaría si fallara el más fuerte?'));
    if (st.level === 'beginner') explBox.append(el('div', { class: 'callout', style: 'margin-top:.6rem' }, 'Truco: intenta repetir la idea con tus palabras o con un ejemplo cotidiano. Si no puedes, vuelve a seleccionar una frase más corta.'));
  }

  reader.addEventListener('mouseup', () => {
    const t = window.getSelection().toString().trim();
    if (t.length >= 3) showExplanation(t);
  });
  reader.addEventListener('click', (e) => {
    const t = e.target.closest('.hl-term, .hl-jargon');
    if (t && !window.getSelection().toString()) showExplanation(t.dataset.text);
  });
  reader.addEventListener('touchend', () => setTimeout(() => { const t = window.getSelection().toString().trim(); if (t.length >= 3) showExplanation(t); }, 50));

  // ---------- edición / carga ----------
  function toggleEdit() {
    st.editing = !st.editing;
    editor.hidden = !st.editing;
    reader.hidden = st.editing;
    editBtn.textContent = st.editing ? '✔ Aplicar texto' : '✏ Pegar / editar texto';
    if (st.editing) editor.value = st.text;
    else if (editor.value.trim()) setText(editor.value);
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
      addChat('tutor', `📄 Documento cargado: **${doc.filename}** (${doc.pages} pág · ${doc.chars} caracteres${ocrTag}). Ya puedes hacerme preguntas o seleccionar párrafos para explicarlos.`);
    } catch (err) {
      alert(err.message || 'Error al abrir el archivo');
    } finally {
      editBtn.textContent = st.editing ? '✔ Aplicar texto' : '✏ Pegar / editar texto';
      fileInput.value = '';
    }
  });
  sampleSel.addEventListener('change', () => {
    if (sampleSel.value === 'custom') { if (!st.editing) toggleEdit(); return; }
    const s = samples.samples.find((x) => x.id === sampleSel.value);
    st.lang = s.lang === 'en' ? 'en' : 'es';
    langCtl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === st.lang));
    if (st.editing) toggleEdit();
    setText(s.text, true);
  });

  async function integrateToGraph() {
    const currentText = (st.editing ? editor.value : st.text).trim();
    if (currentText.length < 15) {
      alert('El documento es demasiado corto para extraer conceptos al grafo.');
      return;
    }
    if (st.editing) toggleEdit();

    graphBtn.disabled = true;
    const origLabel = graphBtn.textContent;
    graphBtn.textContent = '⏳ Extrayendo nodos…';
    explBox.innerHTML = '';
    explBox.append(
      el('div', { class: 'card', style: 'text-align:center;padding:1.4rem' },
        el('div', { style: 'font-size:1.8rem;margin-bottom:.4rem' }, '🌐'),
        el('p', { style: 'font-weight:600;margin-bottom:.25rem' }, 'GraphArchitect_Agent analizando el documento…'),
        el('p', { class: 'muted', style: 'font-size:.85rem' }, 'Identificando conceptos clave y tejiendo enlaces interdisciplinarios con el Grafo de Conocimiento.')
      )
    );

    let res;
    try {
      res = await extractGraphNodesFromText(currentText, 3, true);
    } catch {
      res = { nodes: [], links: [], engine: 'error' };
    } finally {
      graphBtn.disabled = false;
      graphBtn.textContent = origLabel;
    }

    explBox.innerHTML = '';
    if (!res.nodes || !res.nodes.length) {
      explBox.append(el('div', { class: 'callout warn' }, 'No se pudieron extraer nuevos conceptos de este texto. Intenta con un documento más extenso.'));
      return;
    }

    integrateGraphNodes(res.nodes, res.links || []);
    nodeIndex = buildIndex(graph.nodes.map((n) => ({ id: n.id, text: `${n.label} ${n.label} ${(n.authors || []).join(' ')} ${n.summary}` })));

    const isAi = res.engine && res.engine.includes('gemini');
    explBox.append(
      el('div', { class: 'callout good', style: 'margin-bottom:.7rem' },
        el('b', {}, `✨ ¡${res.nodes.length} concepto(s) integrado(s) al Grafo Vivo! `),
        el('span', { class: 'muted', style: 'font-size:.82rem' }, isAi ? `(Extraído con ${res.engine})` : '(Motor heurístico local)')
      )
    );

    res.nodes.forEach((n) => {
      const dom = graph.domains[n.domain] || { label: n.domain, color: '#7c8cff' };
      const nodeLinks = (res.links || []).filter((l) => l.source === n.id);
      explBox.append(
        el('div', { class: 'card', style: `border-left:4px solid ${dom.color}` },
          el('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:.3rem' },
            el('span', { class: 'pill', style: `--c:${dom.color}` }, dom.label),
            el('small', { class: 'muted' }, `Complejidad ${n.complexity}/5 · ${n.year || 2026}`)
          ),
          el('h3', { style: 'margin-bottom:.25rem' }, `✦ ${n.label}`),
          el('p', { style: 'font-size:.9rem' }, n.summary),
          el('p', { class: 'muted', style: 'font-size:.8rem' }, 'Autores: ' + (n.authors || []).join(', ')),
          nodeLinks.length
            ? el('div', { style: 'margin-top:.45rem' },
                el('small', { class: 'muted', style: 'display:block;margin-bottom:.2rem' }, 'Conectado con:'),
                ...nodeLinks.map((l) => nodeChip(l.target)))
            : null,
          el('div', { style: 'margin-top:.6rem' },
            el('button', { class: 'btn small primary', onclick: () => openNode(n.id) }, '🚀 Ver en el Grafo Interactivo →')
          )
        )
      );
    });

    const names = res.nodes.map((n) => `**✦ ${n.label}**`).join(', ');
    addChat('tutor', `🌐 He integrado ${res.nodes.length} nuevo(s) nodo(s) al Grafo de Conocimiento a partir de tu lectura: ${names}. Puedes pulsar **«🚀 Ver en el Grafo Interactivo»** en el panel superior para explorar sus conexiones en vivo.`);
  }

  // ---------- chat con documento ----------
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

  setText(st.text, true);

  return {
    show(params = {}) {
      if (params.text) { if (st.editing) toggleEdit(); setText(params.text); showExplanation(params.text); }
    },
  };
}
