// Arena Dialéctica: Debate Socrático Cruzado entre pensadores históricos y científicos
import { el, nodeChip, openNode, flashcards, navigate } from '../state.js';
import { newCard } from '../engines/srs.js';
import { renderMarkdown } from '../engines/text.js';
import { fetchDebateCatalog, requestDebateTurn, getLlmStatus } from '../api.js';
import thinkersData from '@data/thinkers.json';

export function createArena() {
  const container = el('div', { class: 'debate-container' });

  let catalog = thinkersData;
  let thinkersMap = new Map(catalog.thinkers.map((t) => [t.id, t]));

  // Estado del debate
  const state = {
    selectedDebateId: 'turing_vs_godel',
    thinker1Id: 'turing',
    thinker2Id: 'godel',
    topic: '',
    history: [], // [{ speaker, name, avatar, text, rigor, fallacies, key_concept }]
    currentSpeaker: 'turing',
    isLoading: false,
  };

  // Cargar catálogo actualizado desde el backend si está disponible
  fetchDebateCatalog().then((data) => {
    if (data && data.thinkers) {
      catalog = data;
      thinkersMap = new Map(catalog.thinkers.map((t) => [t.id, t]));
      renderPresets();
      renderThinkerPickers();
    }
  });

  // ---------------- DOM ----------------
  const presetSel = el('select', { 'aria-label': 'Debates clásicos predefinidos' });
  const t1Sel = el('select', { 'aria-label': 'Pensador 1 (Tesis)' });
  const t2Sel = el('select', { 'aria-label': 'Pensador 2 (Antítesis)' });
  const topicInput = el('textarea', {
    rows: 2,
    placeholder: 'Escribe el dilema o pregunta filosófica/científica a debatir…',
    'aria-label': 'Tema del debate',
  });

  const t1Badge = el('div', { class: 'thinker-mini-card t1' });
  const t2Badge = el('div', { class: 'thinker-mini-card t2' });

  const arenaLog = el('div', { class: 'debate-log', 'aria-live': 'polite' });
  const userInterventionIn = el('input', {
    type: 'text',
    placeholder: 'Haz una pregunta, modera o contra-argumenta (ej: «Pero Sócrates, ¿acaso no existe la debilidad moral?»)…',
    'aria-label': 'Intervención del usuario',
  });

  const nextBtn = el('button', { class: 'btn primary', onclick: () => triggerNextTurn() }, 'Siguiente réplica ▶');
  const userBtn = el('button', { class: 'btn', onclick: () => submitUserIntervention() }, '🎙️ Intervenir');
  const resetBtn = el('button', { class: 'btn ghost small', onclick: () => startDebate(true) }, '↺ Reiniciar debate');

  function renderPresets() {
    presetSel.innerHTML = '';
    (catalog.debates || []).forEach((d) => {
      presetSel.append(el('option', { value: d.id, selected: d.id === state.selectedDebateId }, d.title));
    });
    presetSel.append(el('option', { value: 'custom' }, '— Dilema personalizado / libre —'));
  }

  function renderThinkerPickers() {
    t1Sel.innerHTML = '';
    t2Sel.innerHTML = '';
    (catalog.thinkers || []).forEach((t) => {
      t1Sel.append(el('option', { value: t.id, selected: t.id === state.thinker1Id }, `${t.avatar} ${t.name}`));
      t2Sel.append(el('option', { value: t.id, selected: t.id === state.thinker2Id }, `${t.avatar} ${t.name}`));
    });
    updateBadges();
  }

  function updateBadges() {
    const t1 = thinkersMap.get(state.thinker1Id) || { name: state.thinker1Id, avatar: '🏛️' };
    const t2 = thinkersMap.get(state.thinker2Id) || { name: state.thinker2Id, avatar: '📜' };

    t1Badge.innerHTML = `
      <div class="thinker-avatar">${t1.avatar}</div>
      <div class="thinker-info">
        <b>${t1.name}</b>
        <span class="muted">${t1.era || ''}</span>
        <div class="thinker-stance">${t1.core_stance || ''}</div>
      </div>
    `;

    t2Badge.innerHTML = `
      <div class="thinker-avatar">${t2.avatar}</div>
      <div class="thinker-info">
        <b>${t2.name}</b>
        <span class="muted">${t2.era || ''}</span>
        <div class="thinker-stance">${t2.core_stance || ''}</div>
      </div>
    `;
  }

  presetSel.addEventListener('change', () => {
    const val = presetSel.value;
    state.selectedDebateId = val;
    if (val === 'custom') {
      topicInput.value = '';
      topicInput.placeholder = 'Escribe aquí tu propia pregunta o dilema (o un tema de tu lectura)…';
      topicInput.focus();
    } else {
      const d = (catalog.debates || []).find((x) => x.id === val);
      if (d) {
        state.thinker1Id = d.debaters[0];
        state.thinker2Id = d.debaters[1];
        t1Sel.value = state.thinker1Id;
        t2Sel.value = state.thinker2Id;
        topicInput.value = d.dilemma || d.title;
        updateBadges();
      }
    }
    startDebate(false);
  });

  t1Sel.addEventListener('change', () => {
    state.thinker1Id = t1Sel.value;
    presetSel.value = 'custom';
    updateBadges();
    startDebate(false);
  });

  t2Sel.addEventListener('change', () => {
    state.thinker2Id = t2Sel.value;
    presetSel.value = 'custom';
    updateBadges();
    startDebate(false);
  });

  userInterventionIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitUserIntervention();
  });

  // ---------- Control del debate ----------
  function startDebate(clearOnly = false) {
    state.history = [];
    state.currentSpeaker = state.thinker1Id;
    state.topic = topicInput.value.trim();
    arenaLog.innerHTML = '';

    if (!clearOnly && state.topic) {
      triggerNextTurn();
    } else if (!state.topic) {
      arenaLog.append(
        el('div', { class: 'debate-empty' },
          el('div', { style: 'font-size:2rem;margin-bottom:.4rem' }, '🏛️'),
          el('h3', {}, 'Elige o escribe un dilema para abrir el debate'),
          el('p', { class: 'muted' }, 'Selecciona un debate clásico o introduce una cuestión polémica para que los pensadores comiencen la dialéctica.')
        )
      );
    }
  }

  async function triggerNextTurn(userIntervention = null) {
    if (state.isLoading) return;
    const topic = topicInput.value.trim();
    if (!topic) {
      alert('Introduce un tema o dilema para debatir.');
      return;
    }

    state.isLoading = true;
    nextBtn.disabled = true;
    userBtn.disabled = true;

    const speakerId = state.currentSpeaker;
    const opponentId = speakerId === state.thinker1Id ? state.thinker2Id : state.thinker1Id;
    const speakerObj = thinkersMap.get(speakerId) || { name: speakerId, avatar: '💬' };

    // Si hubo intervención del usuario, añadirla al log primero
    if (userIntervention) {
      const userMsg = {
        speaker: 'user',
        name: 'Estudiante / Moderador',
        avatar: '🎓',
        text: userIntervention,
      };
      state.history.push(userMsg);
      arenaLog.append(renderTurnEl(userMsg));
      scrollArena();
    }

    // Indicador de pensamiento
    const thinkingEl = el(
      'div',
      { class: `debate-turn thinking ${speakerId === state.thinker1Id ? 't1' : 't2'}` },
      el('span', { class: 'thinker-avatar' }, speakerObj.avatar),
      el('div', { class: 'turn-content' }, el('b', {}, speakerObj.name), el('p', { class: 'muted' }, 'Construyendo réplica dialéctica…'))
    );
    arenaLog.append(thinkingEl);
    scrollArena();

    try {
      const turn = await requestDebateTurn({
        thinkerId: speakerId,
        opponentId,
        topic,
        history: state.history.slice(-8),
        userIntervention,
        useLlm: true,
      });

      thinkingEl.remove();

      state.history.push(turn);
      arenaLog.append(renderTurnEl(turn));
      scrollArena();

      // Cambiar turno al oponente para la siguiente réplica
      state.currentSpeaker = opponentId;
      const nextSpeakerObj = thinkersMap.get(opponentId) || { name: opponentId };
      nextBtn.textContent = `Réplica de ${nextSpeakerObj.name} ▶`;
    } catch (err) {
      thinkingEl.remove();
      arenaLog.append(
        el('div', { class: 'callout warn' }, 'No se pudo obtener la réplica en este momento. Inténtalo de nuevo.')
      );
    } finally {
      state.isLoading = false;
      nextBtn.disabled = false;
      userBtn.disabled = false;
    }
  }

  function submitUserIntervention() {
    const text = userInterventionIn.value.trim();
    if (!text || state.isLoading) return;
    userInterventionIn.value = '';
    triggerNextTurn(text);
  }

  function scrollArena() {
    requestAnimationFrame(() => {
      arenaLog.scrollTop = arenaLog.scrollHeight;
    });
  }

  function renderTurnEl(turn) {
    const isUser = turn.speaker === 'user';
    const isT1 = turn.speaker === state.thinker1Id;
    const thinker = thinkersMap.get(turn.speaker);

    const wrap = el('div', { class: `debate-turn ${isUser ? 'user' : isT1 ? 't1' : 't2'}` });

    const avatarEl = el('div', { class: 'turn-avatar' }, turn.avatar || '💬');

    const header = el(
      'div',
      { class: 'turn-header' },
      el('b', {}, turn.name),
      isUser
        ? el('span', { class: 'pill', style: '--c:var(--accent)' }, 'Intervención del usuario')
        : el('span', { class: 'pill', style: `--c:${isT1 ? 'var(--accent)' : 'var(--accent2)'}` }, thinker?.era || 'Filosofía'),
      turn.rigor != null && !isUser
        ? el('span', { class: 'rigor-pill', title: 'Evaluación de solidez deductiva y coherencia' }, `⚖️ ${turn.rigor}/100`)
        : null
    );

    const body = el('div', { class: 'turn-body', html: renderMarkdown(turn.text) });

    const footer = el('div', { class: 'turn-footer row', style: 'margin-top:.5rem;gap:.4rem;' });

    // Chips de nodos del grafo asociados al pensador
    if (thinker?.nodes?.length) {
      thinker.nodes.slice(0, 2).forEach((nodeId) => {
        footer.append(nodeChip(nodeId));
      });
    }

    // Botón para exportar el argumento a Flashcard
    if (!isUser) {
      const cardFront = `En el debate sobre «${state.topic.slice(0, 80)}…», ¿cuál es la objeción central de **${turn.name}**?`;
      const cardBtn = el(
        'button',
        {
          class: 'btn ghost small',
          title: 'Guardar esta tesis en tu mazo de repaso espaciado Anki',
          onclick: () => {
            const added = flashcards.add([
              newCard({
                front: cardFront,
                back: turn.text,
                tags: ['debate', turn.speaker, 'filosofia'],
                source: 'explanation',
              }),
            ]);
            cardBtn.disabled = true;
            cardBtn.textContent = added.length ? '✓ Guardado en Repaso' : '✓ Ya en tu mazo';
          },
        },
        flashcards.has(cardFront) ? '✓ Ya en tu mazo' : '🗂 Guardar en Tarjetas'
      );
      footer.append(cardBtn);
    }

    // Advertencia de falacias si el auditor detectó alguna
    let fallacyWarning = null;
    if (turn.fallacies && turn.fallacies.length) {
      fallacyWarning = el(
        'div',
        { class: 'callout warn', style: 'margin-top:.4rem;padding:.3rem .6rem;font-size:.78rem' },
        el('b', {}, '⚠️ Observación lógica: '),
        `Posible ${turn.fallacies[0].name || 'falacia detectada'}.`
      );
    }

    const content = el('div', { class: 'turn-content grow' }, header, body, fallacyWarning, footer);

    wrap.append(avatarEl, content);
    return wrap;
  }

  // Montar interfaz
  renderPresets();
  renderThinkerPickers();

  // Seleccionar debate por defecto
  const initDebate = catalog.debates[0];
  if (initDebate) {
    state.selectedDebateId = initDebate.id;
    state.thinker1Id = initDebate.debaters[0];
    state.thinker2Id = initDebate.debaters[1];
    t1Sel.value = state.thinker1Id;
    t2Sel.value = state.thinker2Id;
    topicInput.value = initDebate.dilemma;
    updateBadges();
  }

  const setupSection = el(
    'div',
    { class: 'card debate-setup', style: 'margin-bottom:.8rem' },
    el(
      'div',
      { class: 'row', style: 'margin-bottom:.5rem;justify-content:space-between;align-items:center;' },
      el('h3', { style: 'margin:0' }, '🏛️ Configuración del Encuentro Dialéctico'),
      resetBtn
    ),
    el('label', { class: 'field' }, el('span', {}, 'Dilema o debate predefinido:'), presetSel),
    el(
      'div',
      { class: 'two-col', style: 'margin-bottom:.5rem' },
      el('label', { class: 'field' }, el('span', {}, 'Tesis (Pensador 1):'), t1Sel),
      el('label', { class: 'field' }, el('span', {}, 'Antítesis (Pensador 2):'), t2Sel)
    ),
    el('div', { class: 'two-col', style: 'margin-bottom:.5rem' }, t1Badge, t2Badge),
    el('label', { class: 'field' }, el('span', {}, 'Pregunta o dilema central:'), topicInput),
    el(
      'div',
      { class: 'row' },
      el('button', { class: 'btn primary', onclick: () => startDebate(false) }, '▶ Abrir / Iniciar Debate')
    )
  );

  const controls = el(
    'div',
    { class: 'debate-controls row', style: 'margin-top:.6rem;gap:.5rem;' },
    userInterventionIn,
    userBtn,
    nextBtn
  );

  container.append(setupSection, arenaLog, controls);

  // Inicializar vista con el debate por defecto abierto
  startDebate(false);

  return container;
}
