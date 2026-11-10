// Arena Dialéctica: Duelo 1 vs 1 (Tú vs el Pensador) + Simulación Clásica entre pensadores
import { el, nodeChip, openNode, flashcards, navigate, progress, bus } from '../state.js';
import { newCard } from '../engines/srs.js';
import { renderMarkdown } from '../engines/text.js';
import { fetchDebateCatalog, requestDebateTurn, requestDuelTurn, getLlmStatus } from '../api.js';
import thinkersData from '@data/thinkers.json';

const PROVOCATIVE_DUELS = [
  {
    thinkerId: 'socrates',
    topic: '¿El conocimiento del Bien garantiza la virtud moral o existe la debilidad de la voluntad (akrasía)?',
    initialHint: 'Sócrates sostiene que nadie yerra voluntariamente; el vicio es ignorancia del verdadero Bien.',
  },
  {
    thinkerId: 'popper',
    topic: '¿Puede la inteligencia artificial o el aprendizaje inductivo reemplazar el criterio de falsabilidad científica?',
    initialHint: 'Popper defiende que ninguna acumulación de cisnes blancos verifica una ley; solo la refutación audaz es lógica.',
  },
  {
    thinkerId: 'turing',
    topic: '¿Es la prueba conductual (Test de Turing) suficiente para atribuir intencionalidad y conciencia a una máquina?',
    initialHint: 'Turing argumenta que si la conducta externa es indistinguible, negar la mente es solipsismo arbitrario.',
  },
  {
    thinkerId: 'hume',
    topic: '¿La causalidad física es una ley intrínseca del universo o solo una expectativa psicológica nacida del hábito?',
    initialHint: 'Hume postula que jamás percibimos el nexo causal en sí, solo la conjunción constante de eventos.',
  },
  {
    thinkerId: 'descartes',
    topic: '¿Podemos dudar metódicamente de toda experiencia sensorial sin caer en un solipsismo estéril?',
    initialHint: 'Descartes afirma que solo las ideas claras y distintas deducidas desde el Cogito resisten la duda radical.',
  },
  {
    thinkerId: 'einstein',
    topic: '¿El universo es causal y determinista en su fondo, o el azar probabilístico es la realidad última?',
    initialHint: 'Einstein insiste en el realismo causal estricto: la mecánica cuántica solo refleja una descripción incompleta.',
  },
  {
    thinkerId: 'nietzsche',
    topic: '¿Existen verdades morales objetivas o todo valor es una voluntad de poder y una perspectiva histórica?',
    initialHint: 'Nietzsche afirma que no hay hechos morales, sino interpretaciones morales de los fenómenos.',
  },
];

export function createArena() {
  const container = el('div', { class: 'debate-container' });

  let catalog = thinkersData;
  let thinkersMap = new Map(catalog.thinkers.map((t) => [t.id, t]));

  // Modo de la arena: 'duel' (Tú vs Pensador) o 'classic' (Pensador vs Pensador)
  let activeMode = 'duel';

  // ---------------- Estado del Duelo 1 vs 1 ----------------
  const duelState = {
    thinkerId: 'socrates',
    topic: PROVOCATIVE_DUELS[0].topic,
    roundNumber: 1,
    maxRounds: 3,
    history: [], // [{ speaker: 'user'|id, text, rigor, fallacies, strengths, reply, xp_earned }]
    scores: [],
    totalXp: 0,
    isFinished: false,
    isLoading: false,
    verdict: null,
  };

  // ---------------- Estado de la Arena Clásica ----------------
  const classicState = {
    selectedDebateId: 'turing_vs_godel',
    thinker1Id: 'turing',
    thinker2Id: 'godel',
    topic: '',
    history: [],
    currentSpeaker: 'turing',
    isLoading: false,
  };

  // Cargar catálogo actualizado desde el backend
  fetchDebateCatalog().then((data) => {
    if (data && data.thinkers) {
      catalog = data;
      thinkersMap = new Map(catalog.thinkers.map((t) => [t.id, t]));
      renderThinkerSelects();
    }
  });

  // Selector de Modo
  const modeSwitcher = el('div', { class: 'row', style: 'margin-bottom:.8rem;gap:.5rem;' },
    el('button', {
      class: 'btn primary mode-btn active',
      onclick: () => switchMode('duel'),
    }, '⚔️ Duelo 1 vs 1 (Tú vs el Pensador)'),
    el('button', {
      class: 'btn mode-btn',
      onclick: () => switchMode('classic'),
    }, '🏛️ Arena Clásica (Pensador vs Pensador)')
  );

  // Contenedores de vistas
  const duelView = el('div', { class: 'duel-view' });
  const classicView = el('div', { class: 'classic-view', hidden: true });

  container.append(modeSwitcher, duelView, classicView);

  function switchMode(mode) {
    activeMode = mode;
    modeSwitcher.querySelectorAll('button').forEach((b, idx) => {
      const isDuel = idx === 0;
      b.classList.toggle('primary', (mode === 'duel' && isDuel) || (mode === 'classic' && !isDuel));
      b.classList.toggle('active', (mode === 'duel' && isDuel) || (mode === 'classic' && !isDuel));
    });
    duelView.hidden = mode !== 'duel';
    classicView.hidden = mode !== 'classic';
  }

  /* ======================================================================
     SECCIÓN 1: DUELO 1 vs 1 (TÚ VS EL PENSADOR)
     ====================================================================== */
  const duelThinkerSel = el('select', { 'aria-label': 'Selecciona tu oponente' });
  const duelTopicPresetSel = el('select', { 'aria-label': 'Tesis o dilema sugerido' });
  const duelTopicInput = el('textarea', { rows: 2, 'aria-label': 'Tema de disputa' });
  const duelThinkerCard = el('div', { class: 'thinker-mini-card t1' });
  const duelLog = el('div', { class: 'debate-log duel-log', 'aria-live': 'polite' });

  const duelRoundsBadge = el('span', { class: 'pill', style: '--c:var(--accent)' }, 'Asalto 1 de 3');
  const duelRigorMeter = el('span', { class: 'rigor-pill', title: 'Rigor lógico medio demostrado' }, '⚖️ Rigor: —');
  const duelXpMeter = el('span', { class: 'pill', style: '--c:var(--good)' }, '+0 XP acumulados');

  const duelUserInput = el('textarea', {
    rows: 4,
    placeholder: 'Escribe tu tesis o contrarréplica con argumentos fundamentados (usa conectores como "porque", "dado que", "en consecuencia")…',
    'aria-label': 'Argumento del usuario',
  });
  const duelSubmitBtn = el('button', { class: 'btn primary', onclick: () => submitDuelTurn() }, '⚔️ Lanzar Argumento (Asalto 1)');
  const duelResetBtn = el('button', { class: 'btn ghost small', onclick: () => resetDuel() }, '↺ Nuevo Duelo');

  function renderThinkerSelects() {
    duelThinkerSel.innerHTML = '';
    (catalog.thinkers || []).forEach((t) => {
      duelThinkerSel.append(el('option', { value: t.id, selected: t.id === duelState.thinkerId }, `${t.avatar} ${t.name} (${t.era || ''})`));
    });
    updateDuelThinkerCard();
  }

  function renderDuelPresets() {
    duelTopicPresetSel.innerHTML = '';
    PROVOCATIVE_DUELS.forEach((d, i) => {
      duelTopicPresetSel.append(el('option', { value: String(i), selected: d.topic === duelState.topic }, d.topic));
    });
    duelTopicPresetSel.append(el('option', { value: 'custom' }, '— Escribir mi propio dilema / tesis —'));
    duelTopicInput.value = duelState.topic;
  }

  function updateDuelThinkerCard() {
    const t = thinkersMap.get(duelState.thinkerId) || { name: duelState.thinkerId, avatar: '🏛️', core_stance: '', era: '' };
    duelThinkerCard.innerHTML = `
      <div class="thinker-avatar">${t.avatar}</div>
      <div class="thinker-info">
        <b>${t.name}</b>
        <span class="muted">${t.era || ''}</span>
        <div class="thinker-stance">${t.core_stance || ''}</div>
        ${t.quote ? `<div class="thinker-quote" style="margin-top:.3rem;font-style:italic;font-size:.8rem;color:var(--accent);">«${t.quote}»</div>` : ''}
      </div>
    `;
  }

  duelThinkerSel.addEventListener('change', () => {
    duelState.thinkerId = duelThinkerSel.value;
    updateDuelThinkerCard();
    // Auto-sugerir dilema acorde al pensador
    const match = PROVOCATIVE_DUELS.find((d) => d.thinkerId === duelState.thinkerId);
    if (match) {
      duelState.topic = match.topic;
      duelTopicInput.value = match.topic;
      duelTopicPresetSel.value = String(PROVOCATIVE_DUELS.indexOf(match));
    }
    resetDuel();
  });

  duelTopicPresetSel.addEventListener('change', () => {
    const val = duelTopicPresetSel.value;
    if (val === 'custom') {
      duelTopicInput.value = '';
      duelTopicInput.placeholder = 'Escribe aquí tu propia tesis o pregunta para desafiar al filósofo…';
      duelTopicInput.focus();
    } else {
      const item = PROVOCATIVE_DUELS[Number(val)];
      if (item) {
        duelState.topic = item.topic;
        duelTopicInput.value = item.topic;
        if (item.thinkerId) {
          duelState.thinkerId = item.thinkerId;
          duelThinkerSel.value = item.thinkerId;
          updateDuelThinkerCard();
        }
      }
    }
    resetDuel();
  });

  duelTopicInput.addEventListener('input', () => {
    duelState.topic = duelTopicInput.value.trim();
  });

  function resetDuel() {
    duelState.roundNumber = 1;
    duelState.history = [];
    duelState.scores = [];
    duelState.totalXp = 0;
    duelState.isFinished = false;
    duelState.isLoading = false;
    duelState.verdict = null;

    duelLog.innerHTML = '';
    duelUserInput.value = '';
    duelUserInput.disabled = false;
    duelSubmitBtn.disabled = false;
    duelSubmitBtn.textContent = '⚔️ Lanzar Argumento (Asalto 1)';
    duelRoundsBadge.textContent = 'Asalto 1 de 3';
    duelRigorMeter.textContent = '⚖️ Rigor: —';
    duelXpMeter.textContent = '+0 XP acumulados';

    const t = thinkersMap.get(duelState.thinkerId) || { name: 'el filósofo' };
    duelLog.append(
      el('div', { class: 'debate-empty' },
        el('div', { style: 'font-size:2rem;margin-bottom:.4rem' }, '⚔️'),
        el('h3', {}, `Duelo Dialéctico contra ${t.name}`),
        el('p', { class: 'muted', style: 'max-width:550px;margin:0 auto;' },
          `Defiende tu postura sobre «${duelState.topic}». En cada asalto, tu rigor lógico y ausencia de falacias serán evaluados rigurosamente por el pensador.`)
      )
    );
  }

  async function submitDuelTurn() {
    if (duelState.isLoading || duelState.isFinished) return;
    const arg = duelUserInput.value.trim();
    if (arg.length < 5) {
      alert('Por favor redacta un argumento con al menos una o dos oraciones para sostener tu punto.');
      return;
    }

    duelState.isLoading = true;
    duelSubmitBtn.disabled = true;
    duelUserInput.disabled = true;

    const round = duelState.roundNumber;
    const thinker = thinkersMap.get(duelState.thinkerId) || { name: duelState.thinkerId, avatar: '🏛️' };

    // Limpiar mensaje inicial si es el asalto 1
    if (round === 1) duelLog.innerHTML = '';

    // Renderizar turno del usuario
    const userTurnEl = el('div', { class: 'debate-turn user' },
      el('div', { class: 'turn-avatar' }, '🎓'),
      el('div', { class: 'turn-content grow' },
        el('div', { class: 'turn-header' },
          el('b', {}, 'Tú (Estudiante)'),
          el('span', { class: 'pill', style: '--c:var(--accent)' }, `Asalto ${round} de ${duelState.maxRounds}`)
        ),
        el('div', { class: 'turn-body', html: renderMarkdown(arg) })
      )
    );
    duelLog.append(userTurnEl);
    scrollDuelLog();

    // Indicador de evaluación del pensador
    const thinkingEl = el('div', { class: 'debate-turn thinking t1' },
      el('span', { class: 'thinker-avatar' }, thinker.avatar),
      el('div', { class: 'turn-content' },
        el('b', {}, thinker.name),
        el('p', { class: 'muted' }, 'Analizando tus premisas y preparando réplica dialéctica…')
      )
    );
    duelLog.append(thinkingEl);
    scrollDuelLog();

    try {
      const res = await requestDuelTurn({
        thinkerId: duelState.thinkerId,
        topic: duelState.topic,
        userArgument: arg,
        roundNumber: round,
        history: duelState.history,
        useLlm: true,
      });

      thinkingEl.remove();

      // Guardar puntuaciones
      duelState.scores.push(res.user_rigor);
      const avgRigor = Math.round(duelState.scores.reduce((a, b) => a + b, 0) / duelState.scores.length);
      duelState.totalXp += res.xp_earned;

      duelRigorMeter.textContent = `⚖️ Rigor: ${avgRigor}/100`;
      duelXpMeter.textContent = `+${duelState.totalXp} XP ganados`;

      // Añadir badges al mensaje del usuario
      const evalBanner = el('div', { class: 'row', style: 'margin-top:.45rem;gap:.4rem;flex-wrap:wrap;font-size:.78rem;' },
        el('span', { class: 'rigor-pill' }, `⚖️ Rigor: ${res.user_rigor}/100`),
        el('span', { class: 'pill', style: '--c:var(--good)' }, `+${res.xp_earned} XP`)
      );
      if (res.user_strengths?.length) {
        evalBanner.append(el('span', { class: 'pill', style: '--c:#38bdf8' }, `✓ ${res.user_strengths[0]}`));
      }
      userTurnEl.querySelector('.turn-content')?.append(evalBanner);

      if (res.user_fallacies?.length) {
        const fallWarning = el('div', { class: 'callout warn', style: 'margin-top:.4rem;padding:.3rem .6rem;font-size:.78rem;' },
          el('b', {}, '⚠️ Observación lógica: '),
          `Se detectó posible falacia de ${typeof res.user_fallacies[0] === 'string' ? res.user_fallacies[0] : (res.user_fallacies[0].name || 'inconsistencia')}.`
        );
        userTurnEl.querySelector('.turn-content')?.append(fallWarning);
      }

      // Renderizar respuesta del pensador
      const replyTurn = {
        speaker: duelState.thinkerId,
        name: res.thinker_name,
        avatar: res.thinker_avatar,
        text: res.reply,
        era: res.thinker_era,
      };
      duelState.history.push({ speaker: 'user', text: arg, user_rigor: res.user_rigor });
      duelState.history.push(replyTurn);

      const thinkerTurnEl = el('div', { class: 'debate-turn t1' },
        el('div', { class: 'turn-avatar' }, res.thinker_avatar),
        el('div', { class: 'turn-content grow' },
          el('div', { class: 'turn-header' },
            el('b', {}, res.thinker_name),
            el('span', { class: 'pill', style: '--c:var(--accent)' }, res.thinker_era || 'Filosofía')
          ),
          el('div', { class: 'turn-body', html: renderMarkdown(res.reply) }),
          el('div', { class: 'turn-footer row', style: 'margin-top:.5rem;gap:.4rem;' },
            el('button', {
              class: 'btn ghost small',
              title: 'Guardar esta tesis en tus flashcards de Anki',
              onclick: () => {
                flashcards.add([
                  newCard({
                    front: `En el duelo contra **${res.thinker_name}** sobre «${duelState.topic.slice(0, 80)}…», ¿cuál es su objeción central?`,
                    back: res.reply,
                    tags: ['duelo', duelState.thinkerId, 'filosofia'],
                    source: 'socratic',
                  }),
                ]);
                alert('✓ Guardado en tu mazo de Flashcards.');
              },
            }, '🗂 Guardar Réplica en Anki')
          )
        )
      );
      duelLog.append(thinkerTurnEl);
      scrollDuelLog();

      // Verificar si concluyó el duelo (Ronda 3)
      if (res.is_final_round || round >= duelState.maxRounds) {
        duelState.isFinished = true;
        duelState.verdict = res.verdict || {
          won: avgRigor >= 65,
          title: avgRigor >= 65 ? 'Victoria Dialéctica' : 'Lección Socrática',
          summary: `Has completado el duelo contra ${res.thinker_name} con un rigor medio de ${avgRigor}/100.`,
        };

        // Registrar en estado y base de datos SQLite
        progress.recordDuel(`duel_${Date.now()}`, {
          thinkerId: duelState.thinkerId,
          topic: duelState.topic,
          won: duelState.verdict.won,
          averageRigor: avgRigor,
          xp: duelState.totalXp,
          rounds: duelState.history,
        });

        renderDuelVerdict();
      } else {
        duelState.roundNumber += 1;
        duelRoundsBadge.textContent = `Asalto ${duelState.roundNumber} de ${duelState.maxRounds}`;
        duelSubmitBtn.textContent = `⚔️ Lanzar Argumento (Asalto ${duelState.roundNumber})`;
        duelUserInput.value = '';
        duelUserInput.placeholder = `Responde a la objeción de ${res.thinker_name} para el Asalto ${duelState.roundNumber}…`;
      }
    } catch (err) {
      thinkingEl.remove();
      duelLog.append(el('div', { class: 'callout warn' }, 'Error al procesar el turno del duelo. Por favor intenta de nuevo.'));
    } finally {
      duelState.isLoading = false;
      if (!duelState.isFinished) {
        duelSubmitBtn.disabled = false;
        duelUserInput.disabled = false;
        duelUserInput.focus();
      }
    }
  }

  function renderDuelVerdict() {
    const v = duelState.verdict;
    const avgRigor = Math.round(duelState.scores.reduce((a, b) => a + b, 0) / Math.max(1, duelState.scores.length));
    const thinker = thinkersMap.get(duelState.thinkerId) || { name: 'el pensador' };

    const verdictEl = el('div', { class: 'card duel-verdict', style: 'margin-top:1rem;border:2px solid var(--accent);background:rgba(124,140,255,0.06);' },
      el('div', { class: 'row', style: 'justify-content:space-between;align-items:center;' },
        el('h3', { style: 'margin:0;display:flex;align-items:center;gap:.5rem;' },
          v.won ? '🏆' : '🦉',
          v.title || 'Veredicto del Duelo'
        ),
        el('span', { class: 'pill', style: `--c:${v.won ? 'var(--good)' : 'var(--accent)'};font-size:.9rem;` },
          `Rigor Final: ${avgRigor}/100`
        )
      ),
      el('p', { style: 'margin:.7rem 0;line-height:1.5;' }, v.summary),
      el('div', { class: 'row', style: 'gap:.5rem;margin-top:.8rem;' },
        el('button', {
          class: 'btn primary',
          onclick: () => {
            const nextIdx = (PROVOCATIVE_DUELS.findIndex((d) => d.thinkerId === duelState.thinkerId) + 1) % PROVOCATIVE_DUELS.length;
            const nextDuel = PROVOCATIVE_DUELS[nextIdx];
            duelState.thinkerId = nextDuel.thinkerId;
            duelState.topic = nextDuel.topic;
            duelThinkerSel.value = nextDuel.thinkerId;
            updateDuelThinkerCard();
            renderDuelPresets();
            resetDuel();
          },
        }, '⚔️ Desafiar a otro Pensador'),
        el('button', {
          class: 'btn small',
          onclick: () => resetDuel(),
        }, '↺ Repetir este Duelo')
      )
    );

    duelLog.append(verdictEl);
    scrollDuelLog();
  }

  function scrollDuelLog() {
    requestAnimationFrame(() => {
      duelLog.scrollTop = duelLog.scrollHeight;
    });
  }

  // Configuración del Duelo DOM
  renderThinkerSelects();
  renderDuelPresets();

  const duelSetupCard = el('div', { class: 'card duel-setup', style: 'margin-bottom:.8rem;' },
    el('div', { class: 'row', style: 'justify-content:space-between;align-items:center;margin-bottom:.6rem;' },
      el('h3', { style: 'margin:0;' }, '⚔️ Configuración del Duelo Dialéctico'),
      duelResetBtn
    ),
    el('div', { class: 'two-col', style: 'margin-bottom:.5rem;' },
      el('label', { class: 'field' }, el('span', {}, 'Elige tu Filósofo / Rival:'), duelThinkerSel),
      el('label', { class: 'field' }, el('span', {}, 'Dilema o tesis polémica:'), duelTopicPresetSel)
    ),
    duelThinkerCard,
    el('label', { class: 'field', style: 'margin-top:.5rem;' }, el('span', {}, 'Tesis del debate:'), duelTopicInput),
    el('div', { class: 'row', style: 'margin-top:.4rem;gap:.5rem;' },
      el('button', { class: 'btn primary', onclick: () => resetDuel() }, '▶ Iniciar / Reiniciar Asalto 1')
    )
  );

  const duelStatusHeader = el('div', { class: 'row', style: 'margin-bottom:.5rem;justify-content:space-between;align-items:center;' },
    el('div', { class: 'row', style: 'gap:.4rem;' }, duelRoundsBadge, duelRigorMeter),
    duelXpMeter
  );

  const duelInputBox = el('div', { class: 'card duel-input-card', style: 'margin-top:.6rem;' },
    duelUserInput,
    el('div', { class: 'row', style: 'margin-top:.5rem;justify-content:space-between;align-items:center;' },
      el('span', { class: 'muted', style: 'font-size:.8rem;' }, '💡 Usa conectores lógicos y premisas explícitas para elevar tu rigor.'),
      duelSubmitBtn
    )
  );

  duelUserInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submitDuelTurn();
    }
  });

  duelView.append(duelSetupCard, duelStatusHeader, duelLog, duelInputBox);
  resetDuel();

  /* ======================================================================
     SECCIÓN 2: ARENA CLÁSICA (PENSADOR VS PENSADOR)
     ====================================================================== */
  const presetSel = el('select', { 'aria-label': 'Debates clásicos predefinidos' });
  const t1Sel = el('select', { 'aria-label': 'Pensador 1 (Tesis)' });
  const t2Sel = el('select', { 'aria-label': 'Pensador 2 (Antítesis)' });
  const topicInput = el('textarea', { rows: 2, 'aria-label': 'Tema del debate' });
  const t1Badge = el('div', { class: 'thinker-mini-card t1' });
  const t2Badge = el('div', { class: 'thinker-mini-card t2' });
  const arenaLog = el('div', { class: 'debate-log', 'aria-live': 'polite' });
  const userInterventionIn = el('input', { type: 'text', placeholder: 'Haz una pregunta, modera o contra-argumenta…' });
  const nextBtn = el('button', { class: 'btn primary', onclick: () => triggerNextClassicTurn() }, 'Siguiente réplica ▶');
  const userBtn = el('button', { class: 'btn', onclick: () => submitClassicIntervention() }, '🎙️ Intervenir');

  function renderClassicPresets() {
    presetSel.innerHTML = '';
    (catalog.debates || []).forEach((d) => {
      presetSel.append(el('option', { value: d.id, selected: d.id === classicState.selectedDebateId }, d.title));
    });
    presetSel.append(el('option', { value: 'custom' }, '— Dilema personalizado / libre —'));
  }

  function renderClassicPickers() {
    t1Sel.innerHTML = '';
    t2Sel.innerHTML = '';
    (catalog.thinkers || []).forEach((t) => {
      t1Sel.append(el('option', { value: t.id, selected: t.id === classicState.thinker1Id }, `${t.avatar} ${t.name}`));
      t2Sel.append(el('option', { value: t.id, selected: t.id === classicState.thinker2Id }, `${t.avatar} ${t.name}`));
    });
    updateClassicBadges();
  }

  function updateClassicBadges() {
    const t1 = thinkersMap.get(classicState.thinker1Id) || { name: classicState.thinker1Id, avatar: '🏛️' };
    const t2 = thinkersMap.get(classicState.thinker2Id) || { name: classicState.thinker2Id, avatar: '📜' };
    t1Badge.innerHTML = `<div class="thinker-avatar">${t1.avatar}</div><div class="thinker-info"><b>${t1.name}</b><span class="muted">${t1.era || ''}</span><div class="thinker-stance">${t1.core_stance || ''}</div></div>`;
    t2Badge.innerHTML = `<div class="thinker-avatar">${t2.avatar}</div><div class="thinker-info"><b>${t2.name}</b><span class="muted">${t2.era || ''}</span><div class="thinker-stance">${t2.core_stance || ''}</div></div>`;
  }

  presetSel.addEventListener('change', () => {
    const val = presetSel.value;
    classicState.selectedDebateId = val;
    if (val === 'custom') {
      topicInput.value = '';
      topicInput.placeholder = 'Escribe aquí tu propia pregunta o dilema…';
      topicInput.focus();
    } else {
      const d = (catalog.debates || []).find((x) => x.id === val);
      if (d) {
        classicState.thinker1Id = d.debaters[0];
        classicState.thinker2Id = d.debaters[1];
        t1Sel.value = classicState.thinker1Id;
        t2Sel.value = classicState.thinker2Id;
        topicInput.value = d.dilemma || d.title;
        updateClassicBadges();
      }
    }
    startClassicDebate(false);
  });

  t1Sel.addEventListener('change', () => { classicState.thinker1Id = t1Sel.value; updateClassicBadges(); startClassicDebate(false); });
  t2Sel.addEventListener('change', () => { classicState.thinker2Id = t2Sel.value; updateClassicBadges(); startClassicDebate(false); });

  function startClassicDebate(clearOnly = false) {
    classicState.history = [];
    classicState.currentSpeaker = classicState.thinker1Id;
    classicState.topic = topicInput.value.trim();
    arenaLog.innerHTML = '';
    if (!clearOnly && classicState.topic) triggerNextClassicTurn();
  }

  async function triggerNextClassicTurn(userIntervention = null) {
    if (classicState.isLoading) return;
    const topic = topicInput.value.trim();
    if (!topic) return;

    classicState.isLoading = true;
    nextBtn.disabled = true;
    userBtn.disabled = true;

    const speakerId = classicState.currentSpeaker;
    const opponentId = speakerId === classicState.thinker1Id ? classicState.thinker2Id : classicState.thinker1Id;
    const speakerObj = thinkersMap.get(speakerId) || { name: speakerId, avatar: '💬' };

    if (userIntervention) {
      const userMsg = { speaker: 'user', name: 'Estudiante / Moderador', avatar: '🎓', text: userIntervention };
      classicState.history.push(userMsg);
      arenaLog.append(renderClassicTurnEl(userMsg));
    }

    const thinkingEl = el('div', { class: `debate-turn thinking ${speakerId === classicState.thinker1Id ? 't1' : 't2'}` },
      el('span', { class: 'thinker-avatar' }, speakerObj.avatar),
      el('div', { class: 'turn-content' }, el('b', {}, speakerObj.name), el('p', { class: 'muted' }, 'Construyendo réplica dialéctica…'))
    );
    arenaLog.append(thinkingEl);

    try {
      const turn = await requestDebateTurn({
        thinkerId: speakerId,
        opponentId,
        topic,
        history: classicState.history.slice(-8),
        userIntervention,
        useLlm: true,
      });
      thinkingEl.remove();
      classicState.history.push(turn);
      arenaLog.append(renderClassicTurnEl(turn));
      classicState.currentSpeaker = opponentId;
      const nextSpeakerObj = thinkersMap.get(opponentId) || { name: opponentId };
      nextBtn.textContent = `Réplica de ${nextSpeakerObj.name} ▶`;
    } catch {
      thinkingEl.remove();
    } finally {
      classicState.isLoading = false;
      nextBtn.disabled = false;
      userBtn.disabled = false;
    }
  }

  function submitClassicIntervention() {
    const text = userInterventionIn.value.trim();
    if (!text || classicState.isLoading) return;
    userInterventionIn.value = '';
    triggerNextClassicTurn(text);
  }

  function renderClassicTurnEl(turn) {
    const isUser = turn.speaker === 'user';
    const isT1 = turn.speaker === classicState.thinker1Id;
    const thinker = thinkersMap.get(turn.speaker);
    const wrap = el('div', { class: `debate-turn ${isUser ? 'user' : isT1 ? 't1' : 't2'}` });
    const avatarEl = el('div', { class: 'turn-avatar' }, turn.avatar || '💬');
    const header = el('div', { class: 'turn-header' },
      el('b', {}, turn.name),
      isUser ? el('span', { class: 'pill', style: '--c:var(--accent)' }, 'Moderador') : el('span', { class: 'pill', style: `--c:${isT1 ? 'var(--accent)' : 'var(--accent2)'}` }, thinker?.era || 'Filosofía'),
      turn.rigor != null && !isUser ? el('span', { class: 'rigor-pill' }, `⚖️ ${turn.rigor}/100`) : null
    );
    const body = el('div', { class: 'turn-body', html: renderMarkdown(turn.text) });
    const content = el('div', { class: 'turn-content grow' }, header, body);
    wrap.append(avatarEl, content);
    return wrap;
  }

  renderClassicPresets();
  renderClassicPickers();
  const initDebate = catalog.debates[0];
  if (initDebate) {
    classicState.selectedDebateId = initDebate.id;
    classicState.thinker1Id = initDebate.debaters[0];
    classicState.thinker2Id = initDebate.debaters[1];
    t1Sel.value = classicState.thinker1Id;
    t2Sel.value = classicState.thinker2Id;
    topicInput.value = initDebate.dilemma;
    updateClassicBadges();
  }

  const classicSetupCard = el('div', { class: 'card debate-setup', style: 'margin-bottom:.8rem;' },
    el('div', { class: 'row', style: 'justify-content:space-between;align-items:center;margin-bottom:.5rem;' },
      el('h3', { style: 'margin:0;' }, '🏛️ Encuentro entre Filósofos'),
      el('button', { class: 'btn ghost small', onclick: () => startClassicDebate(true) }, '↺ Reiniciar')
    ),
    el('label', { class: 'field' }, el('span', {}, 'Dilema clásico:'), presetSel),
    el('div', { class: 'two-col', style: 'margin-bottom:.5rem;' },
      el('label', { class: 'field' }, el('span', {}, 'Tesis (Pensador 1):'), t1Sel),
      el('label', { class: 'field' }, el('span', {}, 'Antítesis (Pensador 2):'), t2Sel)
    ),
    el('div', { class: 'two-col', style: 'margin-bottom:.5rem;' }, t1Badge, t2Badge),
    el('label', { class: 'field' }, el('span', {}, 'Pregunta central:'), topicInput),
    el('div', { class: 'row' }, el('button', { class: 'btn primary', onclick: () => startClassicDebate(false) }, '▶ Abrir Debate'))
  );

  const classicControls = el('div', { class: 'debate-controls row', style: 'margin-top:.6rem;gap:.5rem;' },
    userInterventionIn,
    userBtn,
    nextBtn
  );

  classicView.append(classicSetupCard, arenaLog, classicControls);

  return container;
}
