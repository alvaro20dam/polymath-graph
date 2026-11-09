// Desafío Polímata: Radar de Maestría Interdisciplinaria (Spider Chart) + Retos Adaptativos con IA
import { el, graph, nodeById, nodeChip, openNode, navigate, progress, flashcards, bus } from '../state.js';
import { newCard } from '../engines/srs.js';
import { renderMarkdown } from '../engines/text.js';
import { requestGenerateChallenge, requestEvaluateChallenge, fetchChallengesBank, getLlmStatus } from '../api.js';

export function mount(root) {
  const container = el('div', { class: 'page scroll challenge-page' });

  // Estado local
  const st = {
    domain1: 'any',
    domain2: 'any',
    level: 'intermediate',
    currentChallenge: null,
    selectedOption: null,
    userReasoning: '',
    evaluationResult: null,
    isLoading: false,
  };

  // Badges y datos del perfil
  const profileBanner = el('div', { class: 'card profile-banner' });
  const radarWrap = el('div', { class: 'radar-card card' });
  const levelingCard = el('div', { class: 'card leveling-card' });
  const challengeArea = el('div', { class: 'challenge-area' });

  const layout = el('div', { class: 'page-inner challenge-layout' },
    profileBanner,
    el('div', { class: 'two-col', style: 'margin-bottom:1rem;align-items:stretch;' }, radarWrap, levelingCard),
    challengeArea
  );
  container.append(layout);
  root.append(container);

  // ---------------- Radar Chart (SVG) ----------------
  function renderRadar() {
    const prof = progress.polymathProfile();
    const mastery = prof.mastery;
    const domEntries = Object.entries(graph.domains);
    const n = domEntries.length;

    const size = 340;
    const center = size / 2;
    const radius = center * 0.68;

    // Calcular coordenadas polares -> cartesianas
    const getPoint = (i, factor = 1) => {
      const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
      return {
        x: center + Math.cos(angle) * (radius * factor),
        y: center + Math.sin(angle) * (radius * factor),
      };
    };

    // Anillos concéntricos de referencia (25%, 50%, 75%, 100%)
    const rings = [0.25, 0.5, 0.75, 1.0].map((f) => {
      const pts = domEntries.map((_, i) => {
        const pt = getPoint(i, f);
        return `${pt.x},${pt.y}`;
      }).join(' ');
      return `<polygon points="${pts}" class="radar-grid" />`;
    }).join('');

    // Ejes radiales
    const axes = domEntries.map((_, i) => {
      const pt = getPoint(i, 1.0);
      return `<line x1="${center}" y1="${center}" x2="${pt.x}" y2="${pt.y}" class="radar-axis" />`;
    }).join('');

    // Polígono del usuario
    const userPoints = domEntries.map(([domId], i) => {
      const score = Math.max(10, (mastery[domId] || 0)) / 100;
      const pt = getPoint(i, score);
      return `${pt.x},${pt.y}`;
    }).join(' ');

    // Vértices con círculos y etiquetas interactivas
    const dotsAndLabels = domEntries.map(([domId, dom], i) => {
      const score = mastery[domId] || 0;
      const ptUser = getPoint(i, Math.max(10, score) / 100);
      const ptOuter = getPoint(i, 1.18);
      const anchor = Math.abs(ptOuter.x - center) < 15 ? 'middle' : ptOuter.x > center ? 'start' : 'end';

      return `
        <circle cx="${ptUser.x}" cy="${ptUser.y}" r="4" fill="${dom.color}" stroke="#fff" stroke-width="1.5" />
        <text x="${ptOuter.x}" y="${ptOuter.y}" text-anchor="${anchor}" class="radar-label" fill="${dom.color}">
          ${dom.label.split(' ')[0]} <tspan font-weight="700">(${score}%)</tspan>
        </text>
      `;
    }).join('');

    radarWrap.innerHTML = '';
    radarWrap.append(
      el('div', { class: 'row', style: 'justify-content:space-between;align-items:center;margin-bottom:.4rem;' },
        el('h3', { style: 'margin:0' }, '🕸️ Radar de Maestría Polímata'),
        el('span', { class: 'pill', style: '--c:var(--accent)' }, '6 Disciplinas')
      ),
      el('p', { class: 'muted', style: 'font-size:.82rem' }, 'Calculado a partir de nodos descubiertos, problemas socráticos, flashcards y desafíos superados.'),
      el('div', {
        class: 'radar-svg-wrap',
        html: `
          <svg viewBox="0 0 ${size} ${size}" class="radar-svg" role="img" aria-label="Gráfico de telaraña de competencias polímatas">
            <defs>
              <linearGradient id="polyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.65" />
                <stop offset="100%" stop-color="var(--accent2)" stop-opacity="0.35" />
              </linearGradient>
            </defs>
            ${rings}
            ${axes}
            <polygon points="${userPoints}" fill="url(#polyGrad)" stroke="var(--accent)" stroke-width="2" />
            ${dotsAndLabels}
          </svg>
        `,
      })
    );
  }

  // ---------------- Banner del Perfil & Medallas ----------------
  function renderProfile() {
    const prof = progress.polymathProfile();
    const nextText = prof.nextXp ? `Siguiente nivel a los ${prof.nextXp} XP` : '¡Nivel máximo alcanzado!';
    const pct = prof.nextXp ? Math.min(100, Math.round((prof.xp / prof.nextXp) * 100)) : 100;

    profileBanner.innerHTML = '';
    profileBanner.append(
      el('div', { class: 'profile-header row', style: 'justify-content:space-between;align-items:center;' },
        el('div', { class: 'row', style: 'gap:.8rem;align-items:center;' },
          el('div', { class: 'profile-level-icon' }, prof.icon),
          el('div', {},
            el('h2', { style: 'margin:0;font-size:1.35rem;' }, `${prof.title} (Nivel ${prof.level})`),
            el('span', { class: 'muted', style: 'font-size:.85rem;' }, `${prof.xp} XP acumulados · ${nextText}`)
          )
        ),
        el('div', { style: 'text-align:right;' },
          el('span', { class: 'pill', style: '--c:var(--good)' }, `✓ ${prof.solvedChallenges} Retos Resueltos`)
        )
      ),
      el('div', { class: 'meter', style: 'margin:.8rem 0 .9rem;' }, el('i', { style: `width:${pct}%` })),
      el('div', { class: 'badges-bar row', style: 'gap:.45rem;flex-wrap:wrap;' },
        ...prof.badges.map((b) =>
          el('div', { class: `badge-item ${b.unlocked ? 'unlocked' : 'locked'}`, title: `${b.name}: ${b.desc}` },
            el('span', { class: 'badge-icon' }, b.icon),
            el('span', { class: 'badge-name' }, b.name)
          )
        )
      )
    );
  }

  // ---------------- Rutas de Nivelación (Puntos Ciegos) ----------------
  function renderLeveling() {
    const prof = progress.polymathProfile();
    const weakestDom = graph.domains[prof.weakest] || { label: prof.weakest, color: '#f87171' };
    const strongestDom = graph.domains[prof.strongest] || { label: prof.strongest, color: '#34d399' };

    // Buscar nodos recomendados del dominio más débil
    const recNodes = graph.nodes
      .filter((n) => n.domain === prof.weakest && !(progress.get().visited || []).includes(n.id))
      .slice(0, 3);

    levelingCard.innerHTML = '';
    levelingCard.append(
      el('h3', { style: 'margin-bottom:.4rem;' }, '⚖️ Diagnóstico y Rutas de Nivelación'),
      el('p', { style: 'font-size:.9rem;line-height:1.5;' },
        'Tu disciplina más fuerte es ',
        el('span', { class: 'pill', style: `--c:${strongestDom.color}` }, strongestDom.label),
        '. Para lograr un perfil verdaderamente polímata, te recomendamos equilibrar tu punto ciego: ',
        el('span', { class: 'pill', style: `--c:${weakestDom.color}` }, `${weakestDom.label} (${prof.mastery[prof.weakest]}%)`),
        '.'
      ),
      el('h4', { style: 'margin-top:.8rem;' }, `Nodos clave recomendados en ${weakestDom.label}`),
      recNodes.length
        ? el('div', { class: 'row', style: 'gap:.4rem;margin-top:.3rem;' }, ...recNodes.map((n) => nodeChip(n.id)))
        : el('p', { class: 'muted', style: 'font-size:.85rem;' }, '¡Has explorado la mayoría de nodos de esta disciplina! Prueba resolver un problema socrático o desafío.'),
      el('div', { style: 'margin-top:1rem;' },
        el('button', {
          class: 'btn small primary',
          onclick: () => {
            st.domain1 = prof.weakest;
            loadNewChallenge();
          },
        }, `🎯 Generar desafío enfocado en ${weakestDom.label}`)
      )
    );
  }

  // ---------------- Generador y Render del Desafío Activo ----------------
  async function loadNewChallenge() {
    st.isLoading = true;
    st.selectedOption = null;
    st.userReasoning = '';
    st.evaluationResult = null;
    renderChallengeArea();

    try {
      const res = await requestGenerateChallenge({
        domain1: st.domain1,
        domain2: st.domain2,
        level: st.level,
        useLlm: true,
      });
      st.currentChallenge = res;
    } catch {
      const bank = await fetchChallengesBank();
      st.currentChallenge = bank[0];
    } finally {
      st.isLoading = false;
      renderChallengeArea();
    }
  }

  async function evaluateCurrentSolution() {
    if (st.selectedOption == null && !st.userReasoning.trim()) {
      alert('Selecciona una opción o escribe tu razonamiento.');
      return;
    }
    const ch = st.currentChallenge;
    if (!ch) return;

    st.isLoading = true;
    renderChallengeArea();

    const chosenText = typeof st.selectedOption === 'number' ? ch.options[st.selectedOption] : '';

    try {
      const evalRes = await requestEvaluateChallenge({
        challengeId: ch.id,
        question: ch.question,
        userAnswer: chosenText,
        userReasoning: st.userReasoning,
        expectedExplanation: ch.explanation || '',
        domains: ch.domains || [],
        useLlm: true,
      });

      st.evaluationResult = evalRes;
      if (evalRes.is_correct) {
        progress.recordChallenge(ch.id, {
          solved: true,
          xp: evalRes.xp || ch.xp || 50,
          domains: ch.domains || [],
          score: evalRes.score || 90,
        });
      }
      renderAll();
    } catch {
      alert('Error al evaluar la solución.');
    } finally {
      st.isLoading = false;
      renderChallengeArea();
    }
  }

  function renderChallengeArea() {
    challengeArea.innerHTML = '';

    const ch = st.currentChallenge;
    const isAi = ch?.engine && ch.engine.includes('gemini');

    // Selector de disciplinas y nivel
    const dom1Sel = el('select', { 'aria-label': 'Primera disciplina' },
      el('option', { value: 'any' }, 'Cualquiera (Aleatorio)'),
      ...Object.entries(graph.domains).map(([id, d]) => el('option', { value: id, selected: id === st.domain1 }, d.label))
    );
    dom1Sel.addEventListener('change', () => { st.domain1 = dom1Sel.value; });

    const dom2Sel = el('select', { 'aria-label': 'Segunda disciplina' },
      el('option', { value: 'any' }, 'Cualquiera (Aleatorio)'),
      ...Object.entries(graph.domains).map(([id, d]) => el('option', { value: id, selected: id === st.domain2 }, d.label))
    );
    dom2Sel.addEventListener('change', () => { st.domain2 = dom2Sel.value; });

    const filterRow = el('div', { class: 'card challenge-filters row', style: 'margin-bottom:.8rem;align-items:center;gap:.6rem;flex-wrap:wrap;' },
      el('b', {}, '🎯 Nuevo Desafío:'),
      el('span', { class: 'muted' }, 'Campo 1:'), dom1Sel,
      el('span', { class: 'muted' }, 'Campo 2:'), dom2Sel,
      el('button', { class: 'btn primary', onclick: () => loadNewChallenge() }, '🎲 Generar Reto')
    );

    challengeArea.append(filterRow);

    if (st.isLoading) {
      challengeArea.append(
        el('div', { class: 'card', style: 'text-align:center;padding:2.5rem 1rem;' },
          el('div', { style: 'font-size:2rem;margin-bottom:.5rem;' }, '🧠'),
          el('h3', {}, 'ChallengeArchitect_Agent tejiendo el reto interdisciplinario…'),
          el('p', { class: 'muted' }, 'Conectando conceptos puente y diseñando escenarios de pensamiento crítico.')
        )
      );
      return;
    }

    if (!ch) return;

    // Tarjeta del reto activo
    const domainPills = (ch.domains || []).map((dId) => {
      const d = graph.domains[dId] || { label: dId, color: '#7c8cff' };
      return el('span', { class: 'pill', style: `--c:${d.color}` }, d.label);
    });

    const optionsList = el('div', { class: 'challenge-options', style: 'display:grid;gap:.5rem;margin:1rem 0;' });
    (ch.options || []).forEach((optText, idx) => {
      const isSelected = st.selectedOption === idx;
      const isEvaluated = Boolean(st.evaluationResult);
      const isCorrectOption = ch.correct === idx;

      let extraClass = '';
      if (isEvaluated) {
        if (isCorrectOption) extraClass = ' right';
        else if (isSelected && !isCorrectOption) extraClass = ' wrong';
      }

      const optBtn = el('button', {
        class: `challenge-option card${isSelected ? ' selected' : ''}${extraClass}`,
        onclick: () => {
          if (st.evaluationResult) return;
          st.selectedOption = idx;
          renderChallengeArea();
        },
      },
        el('div', { class: 'opt-indicator' }, String.fromCharCode(65 + idx)),
        el('div', { class: 'opt-text grow' }, optText)
      );
      optionsList.append(optBtn);
    });

    const reasoningInput = el('textarea', {
      rows: 2,
      placeholder: '(Opcional) Justifica brevemente tu deducción para ganar XP extra y evaluación lógica…',
      'aria-label': 'Razonamiento libre del estudiante',
    });
    reasoningInput.value = st.userReasoning;
    reasoningInput.addEventListener('input', () => { st.userReasoning = reasoningInput.value; });

    const submitBtn = el('button', {
      class: 'btn primary',
      style: 'padding:.6rem 1.4rem;',
      onclick: () => evaluateCurrentSolution(),
    }, '✓ Comprobar respuesta');

    if (st.selectedOption == null) submitBtn.disabled = true;

    // Panel de resultado
    let resultSection = null;
    if (st.evaluationResult) {
      const r = st.evaluationResult;
      const isOk = r.is_correct;

      // Botón para crear Flashcard de Anki a partir del reto
      const cardFront = `Desafío Interdisciplinario: ${ch.title}\n\n${ch.question}`;
      const cardBack = `**Respuesta Correcta:** ${ch.options[ch.correct] || ''}\n\n**Fundamento:** ${r.explanation || ch.explanation || ''}`;
      const fcBtn = el('button', {
        class: 'btn small',
        title: 'Guardar este puente conceptual en tu mazo de repaso Anki',
        onclick: () => {
          flashcards.add([
            newCard({
              front: cardFront,
              back: cardBack,
              tags: ['desafio', ...(ch.domains || []), 'interdisciplinario'],
              source: 'explanation',
            }),
          ]);
          fcBtn.disabled = true;
          fcBtn.textContent = '✓ Guardado en «🗂 Repaso»';
        },
      }, flashcards.has(cardFront) ? '✓ Ya en tu mazo' : '🗂 Guardar en Tarjetas Anki');

      resultSection = el('div', { class: `challenge-result callout ${isOk ? 'good' : 'warn'}`, style: 'margin-top:1.2rem;' },
        el('div', { class: 'row', style: 'justify-content:space-between;align-items:center;margin-bottom:.4rem;' },
          el('h3', { style: 'margin:0;' }, isOk ? '🎉 ¡Respuesta Correcta!' : '💡 Análisis Pedagógico'),
          el('span', { class: 'pill', style: `--c:${isOk ? 'var(--good)' : 'var(--warn)'}` }, `+${r.xp || 50} XP ganados`)
        ),
        el('div', { style: 'line-height:1.55;margin-bottom:.6rem;', html: renderMarkdown(r.feedback) }),
        el('div', { class: 'card', style: 'background:var(--bg);margin-bottom:.6rem;' },
          el('b', {}, 'Puente conceptual explicado:'),
          el('p', { class: 'muted', style: 'font-size:.9rem;margin-top:.25rem;' }, r.explanation || ch.explanation)
        ),
        el('div', { class: 'row', style: 'gap:.5rem;align-items:center;' },
          fcBtn,
          el('button', { class: 'btn primary small', onclick: () => loadNewChallenge() }, 'Siguiente Desafío ▶')
        )
      );
    }

    const card = el('div', { class: 'card challenge-card', style: 'padding:1.4rem;' },
      el('div', { class: 'row', style: 'justify-content:space-between;align-items:center;margin-bottom:.6rem;' },
        el('div', { class: 'row', style: 'gap:.4rem;' }, ...domainPills),
        el('span', { class: 'pill', style: '--c:var(--accent)' }, `+${ch.xp || 50} XP`)
      ),
      el('h2', { style: 'margin-bottom:.5rem;' }, ch.title),
      el('p', { style: 'font-size:1.05rem;line-height:1.6;font-weight:500;' }, ch.question),
      optionsList,
      !st.evaluationResult ? el('div', { style: 'margin-top:.8rem;' }, reasoningInput) : null,
      !st.evaluationResult ? el('div', { class: 'row', style: 'margin-top:.8rem;' }, submitBtn) : null,
      resultSection
    );

    challengeArea.append(card);
  }

  function renderAll() {
    renderProfile();
    renderRadar();
    renderLeveling();
  }

  bus.addEventListener('progress', renderAll);
  bus.addEventListener('flashcards', renderAll);

  // Inicializar
  renderAll();
  loadNewChallenge();

  return {
    show() {
      renderAll();
    },
  };
}
