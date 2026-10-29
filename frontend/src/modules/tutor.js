// SocraticTutor_Agent + pizarra interactiva
import { el, nodeChip, navigate, progress, bus, graph } from '../state.js';
import { PROBLEMS, getProblem, newSession, evaluate, hint, openingMessage, masteryGaps, studyPlan } from '../engines/socratic.js';
import { evaluateSocratic, askSocraticHint, getLlmStatus } from '../api.js';
import { renderMarkdown } from '../engines/text.js';

const COLORS = ['#e6e9f5', '#7c8cff', '#34d399', '#fbbf24', '#f87171'];

export function mount(root) {
  const boards = new Map(); // problemId -> { session, messages, steps, strokes }
  let cur = null;
  let tool = { color: COLORS[0], eraser: false, size: 3 };

  // ---------- columnas ----------
  const listBox = el('div');
  const levelSel = el('select', { 'aria-label': 'Nivel del estudiante' },
    el('option', { value: 'beginner' }, 'Principiante (más guía)'), el('option', { value: 'intermediate', selected: true }, 'Intermedio'), el('option', { value: 'expert' }, 'Experto (pistas más sutiles)'));
  const progressBox = el('div');
  const left = el('div', { class: 'panel scroll' },
    el('h2', {}, 'Problemas socráticos'),
    el('p', { class: 'muted' }, 'El tutor no te da la respuesta: te hace preguntas y pistas progresivas.'),
    listBox,
    el('label', { class: 'field', style: 'margin-top:.8rem' }, el('span', {}, 'Nivel pedagógico'), levelSel),
    progressBox);

  const title = el('h2');
  const prompt = el('p');
  const canvas = el('canvas', { 'aria-label': 'Pizarra de dibujo libre' });
  const toolbar = el('div', { class: 'board-tools' });
  const stepsBox = el('div', { class: 'steps' });
  const stepInput = el('input', { type: 'text', placeholder: 'Escribe un paso de tu razonamiento y pulsa Enter…', 'aria-label': 'Paso de razonamiento' });
  const center = el('div', { class: 'panel' }, title, prompt, toolbar,
    el('div', { class: 'board-wrap' }, canvas),
    el('div', { class: 'row', style: 'margin-top:.5rem' }, stepInput, el('button', { class: 'btn primary', onclick: () => addStep() }, 'Añadir paso')),
    stepsBox,
    el('p', { class: 'muted', style: 'font-size:.78rem' }, 'La pizarra es tu borrador libre; el tutor evalúa los pasos que escribes y tus mensajes de chat.'));

  const chat = el('div', { class: 'chat', 'aria-live': 'polite' });
  const chatInput = el('textarea', { rows: '1', placeholder: 'Escribe tu respuesta… (Enter para enviar)', 'aria-label': 'Mensaje al tutor' });
  const sendBtn = el('button', { class: 'btn primary', onclick: () => sendChat() }, 'Enviar');
  const resetChatBtn = el('button', { class: 'btn small', style: 'margin-right:auto;', onclick: () => resetProblem(), title: 'Reiniciar este problema y conversación desde cero' }, '↺ Reiniciar chat');
  const hintBtn = el('button', { class: 'btn small', onclick: () => askHint() }, '💡 Pista');
  const planBtn = el('button', { class: 'btn small', onclick: () => showPlan() }, '📋 Plan');

  function autoResize() {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(Math.max(chatInput.scrollHeight, 38), 110) + 'px';
  }
  chatInput.addEventListener('input', autoResize);

  const inputRow = el('div', { class: 'chat-box-row' }, chatInput, sendBtn);
  const toolsRow = el('div', { class: 'chat-tools-row' }, resetChatBtn, hintBtn, planBtn);
  const chatInputWrap = el('div', { class: 'chat-input-wrap' }, inputRow, toolsRow);

  const llmBadge = el('span', { class: 'llm-badge', title: 'Estado del motor de tutoría' }, '● Local');
  async function updateLlmBadge() {
    try {
      const status = await getLlmStatus();
      if (status.enabled) {
        llmBadge.textContent = '● IA ' + (status.model || 'Gemini');
        llmBadge.className = 'llm-badge active';
        llmBadge.title = `Conectado a ${status.model || 'Gemini Flash'}`;
      } else if (status.error) {
        llmBadge.textContent = '⚠️ Clave inválida';
        llmBadge.className = 'llm-badge error';
        llmBadge.title = status.error;
      } else {
        llmBadge.textContent = '● Modo Local';
        llmBadge.className = 'llm-badge';
        llmBadge.title = 'Motor de reglas locales activo (sin clave API configurada)';
      }
    } catch {
      llmBadge.textContent = '● Modo Local';
      llmBadge.className = 'llm-badge';
    }
  }
  updateLlmBadge();

  const right = el('div', { class: 'panel tutor-right' },
    el('div', { class: 'row', style: 'align-items:center; gap:.5rem;' },
      el('h2', { class: 'grow' }, 'Tutor'),
      llmBadge,
      el('button', { class: 'btn ghost small', onclick: () => resetProblem(), title: 'Reiniciar chat y progreso del problema' }, '↺ Reiniciar chat')),
    el('div', { class: 'concept-chips', id: 'chips' }),
    chat,
    chatInputWrap);
  const chipsBox = right.querySelector('#chips');

  root.append(el('div', { class: 'tutor-layout' }, left, center, right));

  // ---------- lista de problemas ----------
  function renderList() {
    listBox.innerHTML = '';
    PROBLEMS.forEach((p) => {
      const done = progress.problem(p.id)?.complete;
      listBox.append(el('button', { class: 'problem-btn' + (cur?.problem.id === p.id ? ' active' : ''), onclick: () => select(p.id) },
        el('b', {}, (done ? '✓ ' : '') + p.title),
        el('div', { class: 'meta' }, el('span', {}, graph.nodes.find((n) => n.id === p.node).label), el('span', {}, 'Nivel ' + p.level + '/5'))));
    });
  }

  // ---------- pizarra ----------
  const ctx = canvas.getContext('2d');
  let drawing = null;
  function fit() {
    const r = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(10, r.width * dpr);
    canvas.height = Math.max(10, r.height * dpr);
    redraw();
  }
  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!cur) return;
    for (const s of cur.strokes) paintStroke(s);
  }
  function paintStroke(s) {
    if (s.pts.length < 1) return;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = s.eraser ? 'destination-out' : 'source-over';
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.size * (window.devicePixelRatio || 1) * (s.eraser ? 5 : 1);
    ctx.beginPath();
    s.pts.forEach(([x, y], i) => { const px = x * canvas.width, py = y * canvas.height; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] * canvas.width + 0.1, s.pts[0][1] * canvas.height);
    ctx.stroke();
    ctx.restore();
  }
  const pt = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  canvas.addEventListener('pointerdown', (e) => {
    if (!cur) return;
    canvas.setPointerCapture(e.pointerId);
    drawing = { color: tool.color, size: tool.size, eraser: tool.eraser, pts: [pt(e)] };
    cur.strokes.push(drawing);
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => { if (drawing) { drawing.pts.push(pt(e)); redraw(); } });
  const end = () => { drawing = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  new ResizeObserver(fit).observe(canvas.parentElement);

  COLORS.forEach((c) => toolbar.append(el('button', { class: 'swatch' + (c === tool.color ? ' active' : ''), style: `--c:${c}`, 'aria-label': 'Color ' + c, onclick: (e) => { tool.color = c; tool.eraser = false; syncTools(); } })));
  const eraserBtn = el('button', { class: 'btn small', onclick: () => { tool.eraser = !tool.eraser; syncTools(); } }, '🧽 Borrador');
  toolbar.append(eraserBtn,
    el('button', { class: 'btn small', onclick: () => { cur?.strokes.pop(); redraw(); } }, '↶ Deshacer'),
    el('button', { class: 'btn small', onclick: () => { if (cur) { cur.strokes = []; redraw(); } } }, 'Limpiar'));
  function syncTools() {
    toolbar.querySelectorAll('.swatch').forEach((b, i) => b.classList.toggle('active', !tool.eraser && COLORS[i] === tool.color));
    eraserBtn.classList.toggle('primary', tool.eraser);
  }

  // ---------- sesión ----------
  function select(id) {
    const problem = getProblem(id);
    if (!boards.has(id)) {
      const session = newSession(id, levelSel.value);
      boards.set(id, { problem, session, messages: [{ role: 'tutor', text: openingMessage(problem, levelSel.value) }], steps: [], strokes: [] });
    }
    cur = boards.get(id);
    levelSel.value = cur.session.level;
    title.textContent = cur.problem.title;
    prompt.textContent = cur.problem.prompt;
    renderAll();
    fit();
  }

  function resetProblem() {
    if (!cur) return;
    const pid = cur.problem.id;
    boards.delete(pid);
    progress.resetProblem(pid);
    chatInput.value = '';
    chatInput.style.height = '38px';
    stepInput.value = '';
    select(pid);
    fit();
  }

  levelSel.addEventListener('change', () => { if (cur) { cur.session.level = levelSel.value; push('tutor', `Nivel ajustado a «${levelSel.selectedOptions[0].textContent}». Las próximas pistas se adaptan.`); } });

  function renderAll() {
    renderList();
    renderChips();
    renderSteps();
    renderChat();
    renderProgress();
  }

  function renderChips() {
    chipsBox.innerHTML = '';
    const gaps = masteryGaps(cur.session);
    gaps.forEach((g, i) => chipsBox.append(el('span', { class: 'cchip' + (g.status === 'dominado' ? ' ok' : g.status === 'frágil' ? ' frail' : '') }, g.status === 'brecha' ? `Paso ${i + 1}: pendiente` : `✓ ${g.name}`)));
  }
  function renderSteps() {
    stepsBox.innerHTML = '';
    cur.steps.forEach((s, i) => stepsBox.append(el('div', { class: 'step ' + (s.hit ? 'hit' : 'miss') }, el('b', {}, i + 1 + '.'), s.text)));
  }
  function scrollChat() {
    requestAnimationFrame(() => {
      chat.scrollTop = chat.scrollHeight;
    });
  }
  function renderChat() {
    chat.innerHTML = '';
    cur.messages.forEach((m) => chat.append(msgEl(m)));
    scrollChat();
  }
  function msgEl(m) {
    if (m.role === 'plan') return planEl(m.plan);
    return el('div', { class: 'msg ' + m.role, html: renderMarkdown(m.text) });
  }
  function renderProgress() {
    const total = cur.problem.concepts.length;
    const pct = Math.round((cur.session.mastered.length / total) * 100);
    progressBox.innerHTML = '';
    progressBox.append(el('h4', { style: 'margin-top:1rem' }, 'Dominio del problema'), el('div', { class: 'meter' }, el('i', { style: `width:${pct}%` })), el('p', { class: 'muted' }, `${cur.session.mastered.length}/${total} pasos construidos · ${Object.values(cur.session.hintsUsed).reduce((a, b) => a + b, 0)} pistas usadas`));
    const all = Object.values(progress.get().problems);
    if (all.length) progressBox.append(el('p', { class: 'muted' }, `Completados: ${all.filter((p) => p.complete).length}/${PROBLEMS.length}`));
  }
  function push(role, text) {
    cur.messages.push({ role, text });
    chat.append(msgEl({ role, text }));
    scrollChat();
  }

  function persist() { progress.recordProblem(cur.problem.id, cur.problem.node, cur.session, cur.problem.concepts.length); renderList(); }

  async function submit(text, isStep = false) {
    text = text.trim();
    if (!text || !cur) return;
    push('me', text);

    const thinking = el('div', { class: 'msg tutor thinking' }, 'Pensando…');
    chat.append(thinking);
    scrollChat();

    let res;
    try {
      res = await evaluateSocratic(cur.session, text, cur.messages);
    } catch {
      res = evaluate(cur.session, text);
    } finally {
      thinking.remove();
    }

    if (res?.session) {
      if (Array.isArray(res.session.mastered)) cur.session.mastered = [...res.session.mastered];
      if (typeof res.session.attempts === 'number') cur.session.attempts = res.session.attempts;
      if (typeof res.session.misconceptions === 'number') cur.session.misconceptions = res.session.misconceptions;
    }

    if (isStep) { cur.steps.push({ text, hit: (res.newly?.length ?? 0) > 0 }); renderSteps(); }
    push(res.kind === 'complete' ? 'done' : 'tutor', res.message);
    renderChips(); renderProgress(); persist();
    if (res.kind === 'complete') showPlan();
  }
  function sendChat() {
    const t = chatInput.value;
    chatInput.value = '';
    chatInput.style.height = '38px';
    submit(t);
  }
  function addStep() { const t = stepInput.value; stepInput.value = ''; submit(t, true); }
  stepInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addStep(); });
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });

  async function askHint() {
    if (!cur) return;
    const thinking = el('div', { class: 'msg hint thinking' }, 'Pensando pista…');
    chat.append(thinking);
    scrollChat();

    let h;
    try {
      h = await askSocraticHint(cur.session, cur.messages);
    } catch {
      h = hint(cur.session);
    } finally {
      thinking.remove();
    }

    if (h?.session) {
      const remoteHints = h.session.hints_used || h.session.hintsUsed;
      if (remoteHints) cur.session.hintsUsed = { ...remoteHints };
    }

    const tag = h.concept ? ` (${h.concept})` : '';
    push('hint', h.exhausted ? h.message : `💡 Pista ${h.level}/${h.total}${tag}: ${h.message}`);
    renderChips(); renderProgress(); persist();
  }

  function planEl(plan) {
    const p = plan;
    return el('div', { class: 'card' },
      el('h3', {}, '📋 Plan de estudio personalizado'),
      p.gaps.length ? el('ul', {}, ...p.gaps.map((g) => el('li', {}, `${g.name} — ${g.status}${g.hints ? ` (${g.hints} pistas)` : ''}`))) : el('p', { class: 'muted' }, 'Sin brechas: ¡buen trabajo!'),
      el('p', {}, p.advice),
      el('p', {}, el('b', {}, 'Repasa en el grafo: '), ...p.relatedNodes.map((id) => nodeChip(id))),
      p.suggestedProblem ? el('div', { class: 'row' }, el('span', { class: 'muted' }, `Siguiente (nivel ~${p.nextLevel}):`), el('button', { class: 'btn small primary', onclick: () => select(p.suggestedProblem.id) }, p.suggestedProblem.title)) : null);
  }
  function showPlan() {
    if (!cur) return;
    const plan = studyPlan(cur.session);
    cur.messages.push({ role: 'plan', plan });
    chat.append(planEl(plan));
    scrollChat();
  }

  bus.addEventListener('progress', () => { if (cur) renderList(); });
  renderList();
  select(PROBLEMS[0].id);

  return {
    show(params = {}) {
      if (params.problem && getProblem(params.problem)) select(params.problem);
      fit();
    },
  };
}
