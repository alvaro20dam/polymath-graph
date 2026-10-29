// LogicVerifier_Agent: verificador de argumentos, tarjetas de falacias/sesgos y laboratorio de lógica formal
import { el, nodeChip, navigate, progress, bus } from '../state.js';
import { analyze, FALLACIES, BIASES } from '../engines/fallacy.js';
import { truthTable, classify, checkValidity, EXAMPLES } from '../engines/logic.js';
import { escapeHtml } from '../engines/text.js';

const ARGUMENT_EXAMPLES = [
  ['Causa falsa', 'Después de que instalaron la nueva cámara, aumentaron los robos, por eso la cámara provoca los robos.'],
  ['Ad hominem + mayoría', 'No le hagas caso: eres un ignorante y todo el mundo sabe que estás equivocado.'],
  ['Afirmar el consecuente', 'Si el sospechoso es culpable entonces huyó. El sospechoso huyó. Por lo tanto, el sospechoso es culpable.'],
  ['Falso dilema + pendiente', 'Solo hay dos opciones: o apoyas la reforma o eres enemigo del país. Si permitimos esta reforma, acabaremos perdiendo todas las libertades.'],
  ['Sesgos varios', 'Estoy 100% seguro de que mi plan funcionará. Ya lo sabía desde el principio, y solo leo noticias que confirman lo que pienso.'],
  ['Argumento razonable', 'Todos los mamíferos tienen pulmones. Las ballenas son mamíferos. Por lo tanto, las ballenas tienen pulmones.'],
];

export function mount(root) {
  const subs = [['verify', '🔎 Verificador de argumentos'], ['cards', '🃏 Tarjetas y quiz'], ['formal', '⊢ Lógica formal']];
  let sub = 'verify';
  const tabsEl = el('div', { class: 'tabs-sub' });
  const body = el('div');
  root.append(el('div', { class: 'page' }, el('div', { class: 'page-inner' },
    el('h1', { style: 'font-size:1.4rem' }, 'Motor de pensamiento crítico'),
    el('p', { class: 'muted' }, '24 falacias lógicas y 24 sesgos cognitivos, con detección heurística y verificación formal de razonamientos.'), tabsEl, body)));

  const panes = {};
  subs.forEach(([id, label]) => {
    const b = el('button', { onclick: () => open(id), 'data-id': id }, label);
    tabsEl.append(b);
  });
  function open(id, params = {}) {
    sub = id;
    tabsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.id === id));
    Object.entries(panes).forEach(([k, p]) => (p.hidden = k !== id));
    if (id === 'formal' && params.premises) panes.formal.load(params);
  }

  panes.verify = verifier(); panes.cards = cards(); panes.formal = formal();
  Object.values(panes).forEach((p) => body.append(p));
  open('verify');

  // ---------------- Verificador ----------------
  function verifier() {
    const out = el('div', { style: 'margin-top:1rem' });
    const ta = el('textarea', { placeholder: 'Pega un argumento, un tuit o un párrafo de opinión…', 'aria-label': 'Argumento a analizar', style: 'min-height:120px' });
    const wrap = el('div', {},
      el('div', { class: 'row', style: 'margin-bottom:.5rem' }, el('span', { class: 'muted' }, 'Ejemplos:'),
        ...ARGUMENT_EXAMPLES.map(([n, t]) => el('button', { class: 'btn small', onclick: () => { ta.value = t; run(); } }, n))),
      ta, el('div', { class: 'row', style: 'margin-top:.5rem' }, el('button', { class: 'btn primary', onclick: run }, 'Analizar razonamiento'), el('span', { class: 'muted', style: 'font-size:.8rem' }, 'Detección heurística por patrones: úsala como guía, no como veredicto.')), out);

    function run() {
      const text = ta.value.trim();
      out.innerHTML = '';
      if (!text) { out.append(el('p', { class: 'muted' }, 'Escribe o elige un ejemplo.')); return; }
      const r = analyze(text);
      const col = r.rigor > 79 ? 'var(--good)' : r.rigor > 50 ? 'var(--warn)' : 'var(--bad)';
      out.append(el('div', { class: 'two-col' },
        el('div', { class: 'card' }, el('h3', {}, 'Estructura del argumento'),
          r.structure.premises.length ? el('ol', {}, ...r.structure.premises.map((p) => el('li', {}, p))) : el('p', { class: 'muted' }, 'Sin premisas identificadas.'),
          el('p', {}, el('b', {}, '∴ Conclusión: '), r.structure.conclusions.join(' / ') || '—', r.structure.inferred ? el('small', { class: 'muted' }, ' (inferida: última frase)') : null)),
        el('div', { class: 'card' }, el('h3', {}, 'Rigor estimado'), el('div', { class: 'big-number', style: `color:${col}` }, r.rigor + '/100'),
          el('div', { class: 'meter' }, el('i', { style: `width:${r.rigor}%` })), ...r.notes.map((n) => el('p', { class: 'muted' }, n)))));
      const card = (f, kind) => {
        const ev = f.evidence.map((e) => `<span class="ev">${escapeHtml(e)}</span>`).join(' … ');
        const c = el('div', { class: 'card fallacy-card' + (kind === 'bias' ? ' bias' : '') },
          el('h3', {}, f.name, el('span', { class: 'muted', style: 'font-weight:400;font-size:.8rem' }, kind === 'bias' ? ' · sesgo cognitivo' : ` · falacia ${f.kind === 'formal' ? 'formal' : 'informal'}`)),
          el('p', {}, f.definition), el('p', { class: 'muted', html: 'Detectado en: ' + ev }),
          el('div', { class: 'callout' }, el('b', {}, kind === 'bias' ? 'Antídoto: ' : 'Cómo refutarla: '), kind === 'bias' ? f.antidote : f.counter),
          el('p', { class: 'muted', style: 'font-size:.85rem' }, 'Ejemplo: ' + f.example));
        if (f.id === 'affirming_consequent') c.append(el('button', { class: 'btn small', onclick: () => open('formal', { premises: ['P -> Q', 'Q'], conclusion: 'P' }) }, '⊢ Probar contraejemplo en tabla de verdad'));
        if (f.id === 'denying_antecedent') c.append(el('button', { class: 'btn small', onclick: () => open('formal', { premises: ['P -> Q', '!P'], conclusion: '!Q' }) }, '⊢ Probar contraejemplo en tabla de verdad'));
        return c;
      };
      if (r.fallacies.length) out.append(el('h2', { style: 'margin-top:1rem' }, `Falacias detectadas (${r.fallacies.length})`), ...r.fallacies.map((f) => card(f, 'fallacy')));
      if (r.biases.length) out.append(el('h2', { style: 'margin-top:1rem' }, `Sesgos cognitivos (${r.biases.length})`), ...r.biases.map((b) => card(b, 'bias')));
      out.append(el('div', { style: 'margin-top:.8rem' }, el('h4', {}, 'Conceptos relacionados'), nodeChip('fallacies'), nodeChip('cognitive_biases'), nodeChip('critical_thinking')));
    }
    return wrap;
  }

  // ---------------- Tarjetas y quiz ----------------
  function cards() {
    let set = 'fallacies', q = '', mode = 'cards';
    const grid = el('div', { class: 'cards-grid' });
    const quizBox = el('div', { hidden: true });
    const search = el('input', { type: 'search', placeholder: 'Filtrar por nombre o contenido…', 'aria-label': 'Filtrar tarjetas' });
    const score = el('span', { class: 'muted' });
    const setBtns = el('div', { class: 'seg-control' },
      el('button', { class: 'active', 'data-v': 'fallacies', onclick: () => chooseSet('fallacies') }, `Falacias (${FALLACIES.length})`),
      el('button', { 'data-v': 'biases', onclick: () => chooseSet('biases') }, `Sesgos (${BIASES.length})`));
    const modeBtns = el('div', { class: 'seg-control' },
      el('button', { class: 'active', 'data-v': 'cards', onclick: () => chooseMode('cards') }, 'Tarjetas'), el('button', { 'data-v': 'quiz', onclick: () => chooseMode('quiz') }, 'Quiz'));
    const wrap = el('div', {}, el('div', { class: 'row', style: 'margin-bottom:.8rem' }, setBtns, modeBtns, el('div', { class: 'grow' }, search), score), grid, quizBox);

    const items = () => (set === 'fallacies' ? FALLACIES : BIASES);
    function chooseSet(v) { set = v; setBtns.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === v)); render(); }
    function chooseMode(v) { mode = v; modeBtns.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === v)); render(); }
    search.addEventListener('input', () => { q = search.value.toLowerCase(); render(); });
    function updScore() { const { right, total } = progress.get().quiz; score.textContent = total ? `Quiz: ${right}/${total} aciertos` : ''; }
    bus.addEventListener('progress', updScore);

    function render() {
      grid.hidden = mode !== 'cards'; quizBox.hidden = mode !== 'quiz'; search.hidden = mode === 'quiz';
      updScore();
      if (mode === 'quiz') return nextQuiz();
      grid.innerHTML = '';
      items().filter((i) => !q || (i.name + i.name_en + i.definition).toLowerCase().includes(q)).forEach((i) => {
        const c = el('div', { class: 'flip', tabindex: 0, role: 'button', 'aria-label': 'Tarjeta ' + i.name, onclick: () => c.classList.toggle('flipped'), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.classList.toggle('flipped'); } } },
          el('div', { class: 'flip-in' },
            el('div', { class: 'flip-face front' }, el('b', {}, i.name), el('small', { class: 'muted' }, i.name_en + (i.kind ? ' · ' + i.kind : '')), el('small', { class: 'muted', style: 'margin-top:.6rem' }, 'Toca para ver el detalle')),
            el('div', { class: 'flip-face back' }, el('p', {}, i.definition), el('p', { class: 'muted' }, '«' + i.example + '»'), el('p', {}, el('b', {}, set === 'biases' ? 'Antídoto: ' : 'Refutación: '), i.antidote ?? i.counter))));
        grid.append(c);
      });
      if (!grid.children.length) grid.append(el('p', { class: 'muted' }, 'Sin resultados.'));
    }

    function nextQuiz() {
      const list = items();
      const correct = list[Math.floor(Math.random() * list.length)];
      const opts = [correct, ...list.filter((x) => x.id !== correct.id).sort(() => Math.random() - 0.5).slice(0, 3)].sort(() => Math.random() - 0.5);
      quizBox.innerHTML = '';
      const fb = el('div');
      quizBox.append(el('div', { class: 'card' }, el('h3', {}, '¿Qué ' + (set === 'biases' ? 'sesgo' : 'falacia') + ' ilustra este ejemplo?'), el('p', { style: 'font-size:1.05rem;font-style:italic' }, '«' + correct.example + '»'),
        ...opts.map((o) => { const b = el('button', { class: 'btn quiz-opt', onclick: () => {
          const ok = o.id === correct.id;
          quizBox.querySelectorAll('.quiz-opt').forEach((x) => { x.disabled = true; });
          b.classList.add(ok ? 'right' : 'wrong');
          quizBox.querySelectorAll('.quiz-opt').forEach((x, i) => { if (opts[i].id === correct.id) x.classList.add('right'); });
          progress.quiz(ok);
          fb.append(el('div', { class: 'callout ' + (ok ? 'good' : 'warn') }, (ok ? '¡Correcto! ' : `Era «${correct.name}». `) + correct.definition), el('button', { class: 'btn primary', style: 'margin-top:.6rem', onclick: nextQuiz }, 'Siguiente →'));
        } }, o.name); return b; }), fb));
    }
    render();
    return wrap;
  }

  // ---------------- Lógica formal ----------------
  function formal() {
    const ttIn = el('input', { type: 'text', value: 'P -> Q', 'aria-label': 'Fórmula', placeholder: 'Ej.: (P & Q) -> R' });
    const ttOut = el('div');
    const premIn = el('textarea', { 'aria-label': 'Premisas', style: 'min-height:80px', placeholder: 'Una premisa por línea' });
    premIn.value = 'P -> Q\nQ';
    const concIn = el('input', { type: 'text', value: 'P', 'aria-label': 'Conclusión' });
    const valOut = el('div');

    function tableEl(t, labels, counter) {
      const tbl = el('table', { class: 'tt' }, el('thead', {}, el('tr', {}, ...t.vars.map((v) => el('th', {}, v)), ...labels.map((l) => el('th', {}, l)))));
      const tb = el('tbody');
      t.rows.forEach((r) => {
        const isC = counter && t.vars.every((v) => r.env[v] === counter[v]);
        tb.append(el('tr', { class: isC ? 'counter' : '' }, ...t.vars.map((v) => el('td', { class: r.env[v] ? 't' : 'f' }, r.env[v] ? 'V' : 'F')), ...r.values.map((x) => el('td', { class: x ? 't' : 'f' }, x ? 'V' : 'F'))));
      });
      tbl.append(tb);
      return tbl;
    }
    const fail = (box, e) => { box.innerHTML = ''; box.append(el('div', { class: 'callout warn' }, 'Error de sintaxis: ' + e.message)); };

    function runTT() {
      ttOut.innerHTML = '';
      try {
        const forms = ttIn.value.split(',').map((s) => s.trim()).filter(Boolean);
        const t = truthTable(forms);
        ttOut.append(tableEl(t, forms));
        if (forms.length === 1) ttOut.append(el('p', {}, 'Clasificación: ', el('b', {}, classify(forms[0]))));
      } catch (e) { fail(ttOut, e); }
    }
    function runVal() {
      valOut.innerHTML = '';
      try {
        const prem = premIn.value.split('\n').map((s) => s.trim()).filter(Boolean);
        const r = checkValidity(prem, concIn.value.trim());
        const t = { vars: r.vars, rows: r.rows };
        valOut.append(el('div', { class: 'callout ' + (r.valid ? 'good' : 'warn') }, r.valid
          ? '✔ Argumento VÁLIDO: no existe ninguna fila con premisas verdaderas y conclusión falsa.'
          : '✘ Argumento INVÁLIDO. Contraejemplo (fila resaltada): ' + r.vars.map((v) => `${v}=${r.counterexample[v] ? 'V' : 'F'}`).join(', ')),
          tableEl(t, [...prem, '∴ ' + concIn.value.trim()], r.counterexample));
      } catch (e) { fail(valOut, e); }
    }
    const symBtns = (input) => el('div', { class: 'row', style: 'margin:.3rem 0' }, ...[['¬', '¬'], ['∧', ' ∧ '], ['∨', ' ∨ '], ['→', ' → '], ['↔', ' ↔ '], ['⊕', ' ⊕ '], ['(', '('], [')', ')']].map(([l, ins]) => el('button', { class: 'btn small', onclick: () => { input.value += ins; input.focus(); } }, l)));
    ttIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') runTT(); });
    concIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') runVal(); });

    const w = el('div', { class: 'two-col' },
      el('div', { class: 'card' }, el('h3', {}, 'Tabla de verdad'),
        el('p', { class: 'muted' }, 'Conectivos: ¬ ! ~ (no), ∧ & (y), ∨ | (o), → -> (implica), ↔ <-> (sii), ⊕ (xor). Separa varias fórmulas con comas.'),
        ttIn, symBtns(ttIn), el('div', { class: 'row' }, el('button', { class: 'btn primary', onclick: runTT }, 'Calcular'),
          el('button', { class: 'btn small', onclick: () => { ttIn.value = 'P | !P'; runTT(); } }, 'Tautología'), el('button', { class: 'btn small', onclick: () => { ttIn.value = 'P & !P'; runTT(); } }, 'Contradicción'),
          el('button', { class: 'btn small', onclick: () => { ttIn.value = '!(P & Q), !P | !Q'; runTT(); } }, 'De Morgan')), ttOut),
      el('div', { class: 'card' }, el('h3', {}, 'Validez de un argumento'),
        el('p', { class: 'muted' }, 'Un argumento es válido si en toda fila donde las premisas son verdaderas la conclusión también lo es.'),
        el('div', { class: 'row', style: 'margin-bottom:.4rem' }, ...EXAMPLES.map((e) => el('button', { class: 'btn small', onclick: () => load({ premises: e.premises, conclusion: e.conclusion }) }, e.name))),
        el('label', { class: 'field' }, el('span', {}, 'Premisas'), premIn), el('label', { class: 'field' }, el('span', {}, 'Conclusión'), concIn),
        el('button', { class: 'btn primary', onclick: runVal }, 'Verificar validez'), valOut),
      el('div', { class: 'card', style: 'grid-column:1/-1' }, el('h3', {}, 'Itinerario de lógica formal'),
        el('ol', { class: 'path-steps' },
          el('li', {}, nodeChip('aristotelian_logic'), el('span', { class: 'muted' }, 'silogismos y validez')),
          el('li', {}, nodeChip('stoicism'), el('span', { class: 'muted' }, 'lógica proposicional estoica (Crisipo)')),
          el('li', {}, nodeChip('propositional_logic'), el('span', { class: 'muted' }, 'conectivos y tablas de verdad (arriba)')),
          el('li', {}, nodeChip('predicate_logic'), el('span', { class: 'muted' }, 'cuantificadores ∀ ∃')),
          el('li', {}, nodeChip('godel_incompleteness'), el('span', { class: 'muted' }, 'límites de los sistemas formales')),
          el('li', {}, nodeChip('turing_machine'), el('span', { class: 'muted' }, 'computabilidad')))));
    function load({ premises, conclusion }) { premIn.value = premises.join('\n'); concIn.value = conclusion; runVal(); }
    w.load = load;
    runTT();
    return w;
  }

  return { show(params = {}) { if (params.sub === 'formal') open('formal'); else if (params.sub === 'fallacy') open('verify'); } };
}
