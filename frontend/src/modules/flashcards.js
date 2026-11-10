// Repaso espaciado (estilo Anki): estudio con SM-2, gestión del mazo y exportación .apkg/.csv para Anki.
import { el, bus, flashcards, nodeById, openNode, getActiveUserId } from '../state.js';
import { newCard, review, buildQueue, deckStats, previewIntervals, formatInterval, toAnkiCsv, GRADES, SRS_CONFIG } from '../engines/srs.js';
import { renderMarkdown } from '../engines/text.js';
import { downloadAnkiPackage, downloadAnkiTsv } from '../api.js';

const STATE_LABEL = { new: 'Nueva', learning: 'Aprendiendo', relearning: 'Reaprendiendo', review: 'Repaso' };
const SOURCE_LABEL = { document: '📖 Documento', socratic: '❓ Tutor', explanation: '✨ Explicación', graph: '◉ Grafo', manual: '✏ Manual' };

export function mount(root) {
  const st = { tag: '', revealed: false, current: null, editing: null, query: '', sessionDone: 0 };

  // ---------- panel izquierdo ----------
  const statsBox = el('div', { class: 'fc-stats' });
  const studyBtn = el('button', { class: 'btn primary', style: 'width:100%;margin:.6rem 0', onclick: () => startStudy() }, '▶ Estudiar ahora');
  const tagSel = el('select', { 'aria-label': 'Filtrar por etiqueta' });
  tagSel.addEventListener('change', () => { st.tag = tagSel.value; st.current = null; renderAll(); });

  const fFront = el('textarea', { rows: 3, placeholder: 'Anverso: pregunta o concepto (admite **negrita** y *cursiva*)', 'aria-label': 'Anverso' });
  const fBack = el('textarea', { rows: 4, placeholder: 'Reverso: respuesta o explicación', 'aria-label': 'Reverso' });
  const fTags = el('input', { type: 'text', placeholder: 'Etiquetas separadas por espacios (opcional)', 'aria-label': 'Etiquetas' });
  const fSave = el('button', { class: 'btn small primary', onclick: () => saveForm() }, '💾 Guardar tarjeta');
  const fCancel = el('button', { class: 'btn small', onclick: () => closeForm() }, 'Cancelar');
  const formTitle = el('h4', { style: 'margin:.2rem 0 .4rem' }, 'Nueva tarjeta');
  const form = el('div', { class: 'card', hidden: true }, formTitle, fFront, el('div', { style: 'height:.4rem' }), fBack, el('div', { style: 'height:.4rem' }), fTags, el('div', { class: 'row', style: 'margin-top:.5rem' }, fSave, fCancel));

  const left = el('div', { class: 'panel scroll fc-side' },
    el('h2', {}, '🗂 Mazo de repaso'),
    el('p', { class: 'muted', style: 'font-size:.82rem' }, 'Repetición espaciada estilo Anki: cada tarjeta vuelve justo antes de que la olvides.'),
    statsBox,
    studyBtn,
    el('label', { class: 'field' }, el('span', {}, 'Etiqueta'), tagSel),
    el('div', { class: 'row', style: 'gap:.4rem;flex-wrap:wrap;' },
      el('button', { class: 'btn small', onclick: () => openForm() }, '＋ Nueva tarjeta'),
      el('button', { class: 'btn small primary', title: 'Descarga el paquete nativo oficial de Anki con estilos oscuros incluidos', onclick: async () => {
        const ok = await downloadAnkiPackage(getActiveUserId());
        if (!ok) alert('No se pudo generar el paquete .apkg');
      } }, '📦 Exportar Anki (.apkg)'),
      el('button', { class: 'btn small', title: 'Descarga en texto plano CSV/TSV', onclick: () => exportCsv() }, '📄 Exportar .csv')),
    form,
    el('details', { class: 'fc-help' },
      el('summary', {}, '¿Cómo importar en Anki?'),
      el('ol', {},
        el('li', {}, el('b', {}, 'Opción 1 (.apkg nativo): '), 'Pulsa «📦 Exportar Anki (.apkg)» y haz doble clic sobre el archivo descargado para abrirlo en Anki (Escritorio o AnkiDroid). ¡Listo!'),
        el('li', {}, el('b', {}, 'Opción 2 (.csv manual): '), 'Pulsa «📄 Exportar .csv» y en Anki selecciona Archivo → Importar.'))),

    el('details', { class: 'fc-help' },
      el('summary', {}, '¿De dónde salen las tarjetas?'),
      el('ul', {},
        el('li', {}, el('b', {}, 'Explicador: '), '«🗂 Crear flashcards» del documento o PDF, o «Guardar como tarjeta» en una explicación.'),
        el('li', {}, el('b', {}, 'Tutor socrático: '), '«🗂 Flashcards» convierte los pasos que te costaron en tarjetas.'),
        el('li', {}, el('b', {}, 'Grafo: '), '«🗂 Tarjeta» en la ficha de cualquier nodo.'))),
    el('button', { class: 'btn small', style: 'margin-top:.8rem;border-color:var(--bad);color:var(--bad)', onclick: () => clearDeck() }, '🗑 Vaciar mazo'));

  // ---------- zona principal ----------
  const studyBox = el('div', { class: 'fc-study' });
  const listSearch = el('input', { type: 'search', placeholder: 'Buscar en el mazo…', 'aria-label': 'Buscar tarjetas' });
  listSearch.addEventListener('input', () => { st.query = listSearch.value.trim().toLowerCase(); renderList(); });
  const listBox = el('div', { class: 'fc-list' });
  const listTitle = el('h3', { class: 'grow', style: 'margin:0' }, 'Tarjetas');
  const main = el('div', { class: 'panel scroll fc-main' },
    studyBox,
    el('div', { class: 'row', style: 'margin:1.2rem 0 .5rem;gap:.6rem' }, listTitle, el('div', { style: 'width:min(320px,100%)' }, listSearch)),
    listBox);

  root.append(el('div', { class: 'fc-layout' }, left, main));

  // ---------- datos ----------
  const filtered = () => flashcards.all().filter((c) => !st.tag || (c.tags || []).includes(st.tag) || c.source === st.tag);
  const newAllowance = () => Math.max(0, SRS_CONFIG.newPerDay - flashcards.daily().newSeen);

  function renderStats() {
    const s = deckStats(filtered(), Date.now(), newAllowance());
    statsBox.innerHTML = '';
    statsBox.append(
      el('div', { class: 'fc-stat new' }, el('b', {}, s.newToday), el('span', {}, 'Nuevas hoy')),
      el('div', { class: 'fc-stat learn' }, el('b', {}, s.dueLearning), el('span', {}, 'Aprendiendo')),
      el('div', { class: 'fc-stat due' }, el('b', {}, s.dueReview), el('span', {}, 'Para repasar')),
      el('p', { class: 'muted', style: 'grid-column:1/-1;font-size:.78rem;margin:.2rem 0 0' },
        `${s.total} tarjetas · ${s.mature} maduras (≥${SRS_CONFIG.matureInterval} d) · ${flashcards.daily().reviews} repasos hoy`));
    studyBtn.textContent = s.dueTotal ? `▶ Estudiar ahora (${s.dueTotal})` : '✓ Al día';
    studyBtn.disabled = !s.total;

    const tags = new Map();
    flashcards.all().forEach((c) => {
      tags.set(c.source, (tags.get(c.source) || 0) + 1);
      (c.tags || []).forEach((t) => tags.set(t, (tags.get(t) || 0) + 1));
    });
    tagSel.innerHTML = '';
    tagSel.append(el('option', { value: '' }, `Todas (${flashcards.all().length})`));
    [...tags.entries()].sort((a, b) => b[1] - a[1]).forEach(([t, n]) => {
      const label = SOURCE_LABEL[t] || (nodeById.get(t)?.label ? `◉ ${nodeById.get(t).label}` : `#${t}`);
      tagSel.append(el('option', { value: t, selected: t === st.tag }, `${label} (${n})`));
    });
    if (st.tag && !tags.has(st.tag)) { st.tag = ''; tagSel.value = ''; }
  }

  // ---------- estudio ----------
  function nextCard() {
    const q = buildQueue(filtered(), Date.now(), { newAllowance: newAllowance() });
    return q[0] || null;
  }

  function startStudy() {
    st.current = nextCard();
    st.revealed = false;
    renderStudy();
    studyBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderStudy() {
    studyBox.innerHTML = '';
    const cards = filtered();
    if (!flashcards.all().length) {
      studyBox.append(el('div', { class: 'fc-empty' },
        el('div', { style: 'font-size:2.4rem' }, '🗂'),
        el('h2', {}, 'Tu mazo está vacío'),
        el('p', { class: 'muted' }, 'Crea tarjetas desde el Explicador, el Tutor socrático o la ficha de un nodo del Grafo, o escribe la tuya con «＋ Nueva tarjeta».')));
      return;
    }
    if (!st.current) st.current = nextCard();
    const c = st.current && flashcards.get(st.current.id);
    if (!c) {
      const s = deckStats(cards, Date.now(), newAllowance());
      studyBox.append(el('div', { class: 'fc-empty' },
        el('div', { style: 'font-size:2.4rem' }, '🎉'),
        el('h2', {}, st.sessionDone ? '¡Has terminado por hoy!' : 'Nada pendiente por ahora'),
        el('p', { class: 'muted' }, st.sessionDone ? `Repasaste ${st.sessionDone} tarjeta(s) en esta sesión.` : 'Todas las tarjetas de este filtro están al día.'),
        s.nextDue ? el('p', {}, 'Próximo repaso en ', el('b', {}, formatInterval(s.nextDue - Date.now())), '.') : null,
        s.new > s.newToday ? el('p', { class: 'muted', style: 'font-size:.82rem' }, `Quedan ${s.new - s.newToday} tarjetas nuevas para mañana (límite diario: ${SRS_CONFIG.newPerDay}).`) : null));
      return;
    }

    const q = buildQueue(cards, Date.now(), { newAllowance: newAllowance() });
    const counts = { new: 0, learn: 0, due: 0 };
    q.forEach((x) => { if (x.state === 'new') counts.new++; else if (x.state === 'review') counts.due++; else counts.learn++; });
    const kindOf = (x) => (x.state === 'new' ? 'new' : x.state === 'review' ? 'due' : 'learn');

    const front = el('div', { class: 'fc-face', html: renderMarkdown(c.front) });
    const back = el('div', { class: 'fc-face back', html: renderMarkdown(c.back), hidden: !st.revealed });
    const meta = el('div', { class: 'row fc-meta' },
      el('span', { class: 'pill', style: '--c:var(--accent2)' }, SOURCE_LABEL[c.source] || c.source),
      el('span', { class: 'pill', style: `--c:${c.state === 'new' ? '#7c8cff' : c.state === 'review' ? '#34d399' : '#f87171'}` }, STATE_LABEL[c.state]),
      ...(c.tags || []).filter((t) => nodeById.has(t)).slice(0, 2).map((t) => el('button', { class: 'node-chip', style: '--c:#7c8cff', onclick: () => openNode(t) }, nodeById.get(t).label)),
      el('span', { class: 'grow' }),
      el('button', { class: 'btn ghost small', title: 'Editar tarjeta', onclick: () => openForm(c) }, '✏'),
      el('button', { class: 'btn ghost small', title: 'Eliminar tarjeta', onclick: () => { if (confirm('¿Eliminar esta tarjeta?')) { flashcards.remove(c.id); st.current = null; st.revealed = false; renderAll(); } } }, '🗑'));

    const actions = el('div', { class: 'fc-actions' });
    if (!st.revealed) {
      actions.append(el('button', { class: 'btn primary fc-reveal', onclick: () => reveal() }, 'Mostrar respuesta ', el('span', { class: 'kbd' }, 'Espacio')));
    } else {
      const pv = previewIntervals(c);
      GRADES.forEach((g) => actions.append(el('button', { class: `btn fc-grade g-${g.key}`, onclick: () => grade(g.grade) },
        el('small', {}, pv[g.grade]), el('b', {}, g.label), el('span', { class: 'kbd' }, g.shortcut))));
    }

    studyBox.append(
      el('div', { class: 'fc-counts', title: 'Nuevas · Aprendiendo · Para repasar' },
        el('span', { class: 'c-new' + (kindOf(c) === 'new' ? ' cur' : '') }, counts.new),
        el('span', { class: 'c-learn' + (kindOf(c) === 'learn' ? ' cur' : '') }, counts.learn),
        el('span', { class: 'c-due' + (kindOf(c) === 'due' ? ' cur' : '') }, counts.due)),
      el('div', { class: 'fc-card' + (st.revealed ? ' revealed' : '') }, meta, front, st.revealed ? el('hr') : null, back),
      actions);
  }

  function reveal() {
    if (!st.current || st.revealed) return;
    st.revealed = true;
    renderStudy();
  }

  function grade(g) {
    const c = st.current && flashcards.get(st.current.id);
    if (!c || !st.revealed) return;
    const wasNew = c.state === 'new';
    flashcards.recordReview(wasNew);
    flashcards.update(review(c, g));
    st.sessionDone += 1;
    st.current = nextCard();
    st.revealed = false;
    renderStats();
    renderStudy();
    renderList();
  }

  // ---------- lista ----------
  function renderList() {
    const now = Date.now();
    let cards = filtered();
    if (st.query) cards = cards.filter((c) => `${c.front} ${c.back} ${(c.tags || []).join(' ')}`.toLowerCase().includes(st.query));
    cards = [...cards].sort((a, b) => b.createdAt - a.createdAt);
    listTitle.textContent = `Tarjetas (${cards.length})`;
    listBox.innerHTML = '';
    if (!cards.length) { listBox.append(el('p', { class: 'muted' }, st.query ? 'Sin coincidencias.' : 'Aún no hay tarjetas en este filtro.')); return; }
    cards.slice(0, 300).forEach((c) => {
      const due = c.state === 'new' ? 'nueva' : c.due <= now ? 'vence ya' : 'en ' + formatInterval(c.due - now);
      const row = el('div', { class: 'fc-row' },
        el('div', { class: 'grow', style: 'min-width:0' },
          el('div', { class: 'fc-row-front', html: renderMarkdown(c.front.length > 180 ? c.front.slice(0, 180) + '…' : c.front) }),
          el('div', { class: 'muted', style: 'font-size:.74rem' }, `${SOURCE_LABEL[c.source] || c.source} · ${STATE_LABEL[c.state]} · ${due}${c.interval ? ` · intervalo ${c.interval} d` : ''}${c.lapses ? ` · ${c.lapses} fallos` : ''}`)),
        el('button', { class: 'btn ghost small', title: 'Estudiar esta tarjeta ahora', onclick: () => { st.current = c; st.revealed = false; renderStudy(); studyBox.scrollIntoView({ behavior: 'smooth' }); } }, '▶'),
        el('button', { class: 'btn ghost small', title: 'Editar', onclick: () => openForm(c) }, '✏'),
        el('button', { class: 'btn ghost small', title: 'Eliminar', onclick: () => { flashcards.remove(c.id); if (st.current?.id === c.id) { st.current = null; st.revealed = false; } renderAll(); } }, '🗑'));
      listBox.append(row);
    });
  }

  // ---------- formulario ----------
  function openForm(card = null) {
    st.editing = card ? card.id : null;
    formTitle.textContent = card ? 'Editar tarjeta' : 'Nueva tarjeta';
    fFront.value = card?.front || '';
    fBack.value = card?.back || '';
    fTags.value = (card?.tags || []).join(' ');
    form.hidden = false;
    fFront.focus();
  }
  function closeForm() { form.hidden = true; st.editing = null; }
  function saveForm() {
    const front = fFront.value.trim();
    const back = fBack.value.trim();
    if (!front || !back) { alert('Completa el anverso y el reverso.'); return; }
    const tags = fTags.value.split(/[\s,]+/).filter(Boolean);
    if (st.editing) {
      const c = flashcards.get(st.editing);
      if (c) flashcards.update({ ...c, front, back, tags });
    } else {
      const added = flashcards.add([newCard({ front, back, tags, source: 'manual' })]);
      if (!added.length) { alert('Ya existe una tarjeta con ese anverso.'); return; }
    }
    closeForm();
    renderAll();
  }

  function exportCsv() {
    const cards = filtered();
    if (!cards.length) { alert('No hay tarjetas para exportar.'); return; }
    const blob = new Blob(['\ufeff' + toAnkiCsv(cards)], { type: 'text/csv;charset=utf-8' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `polymath-graph-anki-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function clearDeck() {
    const n = flashcards.all().length;
    if (!n) return;
    if (confirm(`¿Eliminar las ${n} tarjetas del mazo y su historial de repaso? Exporta antes a Anki si quieres conservarlas.`)) {
      flashcards.clear();
      st.current = null;
      st.revealed = false;
      st.sessionDone = 0;
      renderAll();
    }
  }

  function renderAll() { renderStats(); renderStudy(); renderList(); }

  // ---------- teclado ----------
  window.addEventListener('keydown', (e) => {
    if (root.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
    if (!st.current) return;
    if (!st.revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); reveal(); }
    else if (st.revealed && ['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); grade(+e.key); }
    else if (st.revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); grade(3); }
  });

  bus.addEventListener('flashcards', () => { if (root.hidden) return; renderStats(); renderList(); if (!st.current) renderStudy(); });

  renderAll();

  return {
    show(params = {}) {
      if (params.tag) st.tag = params.tag;
      st.current = null;
      st.revealed = false;
      renderAll();
    },
  };
}
