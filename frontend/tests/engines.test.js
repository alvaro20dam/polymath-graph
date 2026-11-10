import { describe, it, expect } from 'vitest';
import graph from '@data/graph.json';
import { analyze, FALLACIES, BIASES, fallacyChecker, biasDetector } from '../src/engines/fallacy.js';
import { truthTable, classify, checkValidity, parse } from '../src/engines/logic.js';
import { PROBLEMS, newSession, evaluate, hint, studyPlan } from '../src/engines/socratic.js';
import { buildIndex, search, chunkText, answerFromDocument } from '../src/engines/rag.js';
import { explain } from '../src/engines/explain.js';
import { renderMarkdown, cleanDocumentText } from '../src/engines/text.js';

const ids = (r) => r.map((x) => x.id);

describe('datos del grafo', () => {
  it('tiene al menos 50 nodos interconectados en 6 disciplinas', () => {
    expect(graph.nodes.length).toBeGreaterThanOrEqual(50);
    expect(Object.keys(graph.domains)).toHaveLength(6);
    const known = new Set(graph.nodes.map((n) => n.id));
    graph.links.forEach((l) => { expect(known.has(l.source)).toBe(true); expect(known.has(l.target)).toBe(true); });
  });
  it('catálogo: 24 falacias y 24 sesgos', () => {
    expect(FALLACIES).toHaveLength(24);
    expect(BIASES).toHaveLength(24);
  });
  it('todos los patrones compilan', () => {
    expect(() => analyze('texto de prueba')).not.toThrow();
  });
});

describe('motor de falacias', () => {
  it('causa falsa', () => {
    const r = fallacyChecker('Después de que instalaron la nueva cámara, aumentaron los robos, por eso la cámara provoca los robos.');
    expect(ids(r)).toContain('post_hoc');
  });
  it('ad hominem y ad populum', () => {
    const r = fallacyChecker('No le hagas caso: eres un ignorante y todo el mundo sabe que estás equivocado.');
    expect(ids(r)).toEqual(expect.arrayContaining(['ad_hominem', 'ad_populum']));
  });
  it('afirmación del consecuente (estructural) pero no modus ponens', () => {
    const bad = fallacyChecker('Si el sospechoso es culpable entonces huyó. El sospechoso huyó. Por lo tanto, el sospechoso es culpable.');
    expect(ids(bad)).toContain('affirming_consequent');
    const good = fallacyChecker('Si el sospechoso es culpable entonces huyó. El sospechoso es culpable. Por lo tanto, el sospechoso huyó.');
    expect(ids(good)).not.toContain('affirming_consequent');
  });
  it('negación del antecedente', () => {
    const r = fallacyChecker('Si estudias matemáticas entonces apruebas. No estudias matemáticas. Por lo tanto, no apruebas.');
    expect(ids(r)).toContain('denying_antecedent');
  });
  it('falso dilema y pendiente resbaladiza', () => {
    const r = fallacyChecker('Solo hay dos opciones: o apoyas la reforma o eres enemigo del país. Si permitimos esta reforma, acabaremos perdiendo todas las libertades.');
    expect(ids(r)).toEqual(expect.arrayContaining(['false_dilemma', 'slippery_slope']));
  });
  it('sesgos', () => {
    const r = biasDetector('Estoy 100% seguro de que mi plan funcionará. Ya lo sabía desde el principio, y solo leo noticias que confirman lo que pienso.');
    expect(ids(r)).toEqual(expect.arrayContaining(['overconfidence', 'hindsight', 'confirmation']));
  });
  it('un argumento razonable no dispara falacias', () => {
    const r = analyze('Todos los mamíferos tienen pulmones. Las ballenas son mamíferos. Por lo tanto, las ballenas tienen pulmones.');
    expect(r.fallacies).toHaveLength(0);
    expect(r.structure.conclusions[0]).toMatch(/ballenas tienen pulmones/);
    expect(r.structure.premises).toHaveLength(2);
  });
});

describe('lógica formal', () => {
  it('modus ponens es válido, afirmar el consecuente no', () => {
    expect(checkValidity(['P -> Q', 'P'], 'Q').valid).toBe(true);
    const bad = checkValidity(['P -> Q', 'Q'], 'P');
    expect(bad.valid).toBe(false);
    expect(bad.counterexample).toEqual({ P: false, Q: true });
  });
  it('clasifica tautologías y contradicciones', () => {
    expect(classify('P | !P')).toBe('tautología');
    expect(classify('P & !P')).toBe('contradicción');
    expect(classify('P -> Q')).toBe('contingencia');
  });
  it('De Morgan y precedencia', () => {
    const t = truthTable(['!(P & Q)', '!P | !Q']);
    expect(t.rows.every((r) => r.values[0] === r.values[1])).toBe(true);
    // ¬ > ∧ > ∨ > →
    expect(parse('A | B & C -> D').op).toBe('IMP');
  });
  it('símbolos unicode y errores', () => {
    expect(classify('(P ∧ Q) → P')).toBe('tautología');
    expect(() => parse('P & ')).toThrow();
    expect(() => parse('P $ Q')).toThrow();
  });
});

describe('tutor socrático', () => {
  const bayes = PROBLEMS.find((p) => p.id === 'bayes_test');
  it('no entrega la solución ante una respuesta vacía', () => {
    const s = newSession(bayes.id);
    const r = evaluate(s, 'no sé');
    expect(r.message).not.toContain('9,2');
    expect(r.message).toContain('?');
  });
  it('detecta la confusión sensibilidad vs. posterior', () => {
    const s = newSession(bayes.id);
    const r = evaluate(s, 'La probabilidad de estar enfermo es 90% porque la prueba detecta al 90%');
    expect(r.kind).toBe('misconception');
  });
  it('las pistas son progresivas, finitas y no revelan la síntesis', () => {
    const s = newSession(bayes.id);
    const seen = [];
    for (let i = 0; i < 6; i++) { const h = hint(s); seen.push(h); if (h.exhausted) break; }
    expect(seen.some((h) => h.exhausted)).toBe(true);
    seen.forEach((h) => expect(h.message).not.toContain(bayes.synthesis));
  });
  it('un razonamiento completo domina el problema y genera plan', () => {
    const s = newSession(bayes.id);
    evaluate(s, 'La prevalencia o tasa base es 1%, es decir 100 enfermos de 10.000 personas.');
    evaluate(s, 'Los sanos con falsos positivos del 9% son 891.');
    evaluate(s, 'Multiplico sensibilidad por prevalencia: 90 de los enfermos dan positivo.');
    const r = evaluate(s, 'Divido entre el total de positivos 981: el posterior es 9,2%.');
    expect(r.kind).toBe('complete');
    const plan = studyPlan(s);
    expect(plan.gaps).toHaveLength(0);
    expect(plan.nextLevel).toBeGreaterThanOrEqual(bayes.level);
  });
  it('todos los patrones de los problemas compilan', () => {
    PROBLEMS.forEach((p) => { const s = newSession(p.id); expect(() => evaluate(s, 'prueba de texto largo para evaluar')).not.toThrow(); });
  });
});

describe('RAG TF-IDF y explicador', () => {
  it('recupera el pasaje relevante', () => {
    const text = 'La entropía mide la incertidumbre de una fuente.\n\nEl descenso del gradiente minimiza funciones paso a paso.\n\nLos gatos duermen mucho durante el día.';
    const idx = buildIndex(chunkText(text).map((t, i) => ({ id: i, text: t })));
    expect(search(idx, '¿qué mide la entropía?', 1)[0].doc.id).toBe(0);
    expect(answerFromDocument(idx, 'minimizar con gradiente').hits[0].doc.id).toBe(1);
    expect(answerFromDocument(idx, 'zzzz qqqq').found).toBe(false);
  });
  it('explica términos por nivel', () => {
    const b = explain({ selected: 'La entropía de Shannon', level: 'beginner', lang: 'es' });
    const e = explain({ selected: 'La entropía de Shannon', level: 'expert', lang: 'es' });
    expect(b.termCards[0].id).toBe('entropy');
    expect(b.termCards[0].text).not.toBe(e.termCards[0].text);
    expect(explain({ selected: 'Bayes posterior', level: 'intermediate', lang: 'en' }).termCards[0].text).toMatch(/posterior/);
  });
  it('traduce jerga', () => {
    const r = explain({ selected: 'Un proceso estocástico', level: 'beginner', lang: 'es' });
    expect(r.jargon.map((j) => j.word)).toContain('estocástico');
    expect(r.simplified).toContain('con azar');
  });

  it('renderMarkdown convierte negritas, cursivas, código y listas de forma segura', () => {
    const raw = '**Paso 1:** Revisa la *tasa base* con `formula`\n\n- Opción A\n- Opción B';
    const html = renderMarkdown(raw);
    expect(html).toContain('<strong>Paso 1:</strong>');
    expect(html).toContain('<em>tasa base</em>');
    expect(html).toContain('<code>formula</code>');
    expect(html).toContain('<li>Opción A</li>');
    expect(html).toContain('<li>Opción B</li>');
    // Seguridad contra XSS
    const unsafe = renderMarkdown('**Texto** <script>alert(1)</script>');
    expect(unsafe).not.toContain('<script>');
    expect(unsafe).toContain('&lt;script&gt;');
  });
});

describe('gestión del Grafo Vivo y limpieza de nodos', () => {
  it('integra, elimina y restaura nodos personalizados', async () => {
    const { integrateGraphNodes, removeCustomNode, clearAllCustomNodes, nodeById, graph: stateGraph } = await import('../src/state.js');
    const initialCount = stateGraph.nodes.length;

    // 1. Integrar un nodo nuevo
    const testNode = {
      id: 'test_node_custom',
      label: 'Concepto de Prueba',
      domain: 'science',
      complexity: 3,
      summary: 'Nodo para prueba unitaria',
      authors: ['Autor Test'],
    };
    const testLink = { source: 'test_node_custom', target: 'bayes_theorem', relation: 'influences' };
    integrateGraphNodes([testNode], [testLink]);

    expect(nodeById.has('test_node_custom')).toBe(true);
    expect(stateGraph.nodes.find((n) => n.id === 'test_node_custom')?.custom).toBe(true);

    // 2. Eliminar nodo individual
    const removed = removeCustomNode('test_node_custom');
    expect(removed).toBe(true);
    expect(nodeById.has('test_node_custom')).toBe(false);

    // 3. Integrar múltiples y limpiar todos con clearAllCustomNodes
    integrateGraphNodes([
      { id: 'custom_1', label: 'C1', domain: 'math' },
      { id: 'custom_2', label: 'C2', domain: 'physics' },
    ], [{ source: 'custom_1', target: 'bayes_theorem', relation: 'influences' }]);

    expect(nodeById.has('custom_1')).toBe(true);
    expect(nodeById.has('custom_2')).toBe(true);

    const cleared = clearAllCustomNodes();
    expect(cleared).toBe(2);
    expect(nodeById.has('custom_1')).toBe(false);
    expect(nodeById.has('custom_2')).toBe(false);
    expect(stateGraph.nodes.length).toBe(initialCount);
  });
});

describe('motor de flashcards y repetición espaciada (Anki / SM-2)', () => {
  it('gestiona ciclo de vida SM-2: new -> learning -> review -> ease', async () => {
    const { newCard, review, formatInterval, toAnkiCsv } = await import('../src/engines/srs.js');
    const now = 1000000000000;
    const card = newCard({ front: '¿Qué es el prior?', back: 'La creencia inicial P(A)', tags: ['bayes'] }, now);

    expect(card.state).toBe('new');
    expect(card.ease).toBe(2.5);

    // 1. Primer acierto (Good / Bien = 3) en paso de aprendizaje (1 min -> 10 min)
    const step1 = review(card, 3, now);
    expect(step1.state).toBe('learning');
    expect(step1.step).toBe(1);
    expect(step1.due).toBe(now + 10 * 60 * 1000);

    // 2. Graduación a review
    const grad = review(step1, 3, step1.due);
    expect(grad.state).toBe('review');
    expect(grad.interval).toBe(1); // 1 día

    // 3. Repaso exitoso tras 1 día: multiplica por facilidad (ease 2.5)
    const day2 = now + 1 * 24 * 3600 * 1000;
    const rev2 = review(grad, 3, day2);
    expect(rev2.state).toBe('review');
    expect(rev2.interval).toBeGreaterThanOrEqual(2);

    // 4. Formateador de intervalos legibles
    expect(formatInterval(30 * 1000)).toBe('<1 min');
    expect(formatInterval(10 * 60 * 1000)).toBe('10 min');
    expect(formatInterval(3 * 24 * 3600 * 1000)).toBe('3 d');

    // 5. Exportación CSV compatible con Anki
    const csv = toAnkiCsv([rev2]);
    expect(csv).toContain('#deck:Polymath Graph');
    expect(csv).toContain('¿Qué es el prior?');
    expect(csv).toContain('polymath');
  });

  it('generador local extrae tarjetas de glosario y definiciones', async () => {
    const { localFlashcards, socraticCards } = await import('../src/engines/cardgen.js');
    const text = 'La entropía mide la incertidumbre media de una fuente de información según Shannon.\n\nEl descenso del gradiente es un método de optimización iterativo.';
    const cards = localFlashcards(text, { maxCards: 5 });
    expect(cards.length).toBeGreaterThanOrEqual(1);
    expect(cards[0]).toHaveProperty('front');
    expect(cards[0]).toHaveProperty('back');

    // Socratic cards
    const { getProblem } = await import('../src/engines/socratic.js');
    const prob = getProblem('bayes_test');
    const soc = socraticCards(prob, { hintsUsed: { base_rate: 2 }, mastered: ['base_rate'] });
    expect(soc.length).toBeGreaterThanOrEqual(3);
    expect(soc[0].tags).toContain('dificil');
  });

  it('almacenamiento y desduplicación en mazo de flashcards', async () => {
    const { flashcards } = await import('../src/state.js');
    const { newCard } = await import('../src/engines/srs.js');

    flashcards.clear();
    expect(flashcards.all()).toHaveLength(0);

    const c1 = newCard({ front: 'Pregunta única A', back: 'Respuesta A' });
    const c2 = newCard({ front: 'Pregunta única A', back: 'Respuesta duplicada' });
    const c3 = newCard({ front: 'Pregunta única B', back: 'Respuesta B' });

    const added = flashcards.add([c1, c2, c3]);
    expect(added).toHaveLength(2); // c2 es duplicado
    expect(flashcards.has('Pregunta única A')).toBe(true);

    flashcards.remove(c1.id);
    expect(flashcards.has('Pregunta única A')).toBe(false);
    expect(flashcards.all()).toHaveLength(1);
  });

  it('Arena Dialéctica: catálogo de pensadores y réplica dialéctica', async () => {
    const thinkersData = (await import('@data/thinkers.json')).default;
    expect(thinkersData.thinkers.length).toBeGreaterThanOrEqual(10);
    expect(thinkersData.debates.length).toBeGreaterThanOrEqual(5);

    const { requestDebateTurn } = await import('../src/api.js');
    const turn = await requestDebateTurn({
      thinkerId: 'turing',
      opponentId: 'godel',
      topic: '¿Pueden las máquinas pensar?',
      history: [],
      useLlm: false,
    });
    expect(turn.speaker).toBe('turing');
    expect(turn.name).toContain('Turing');
    expect(turn.text).toContain('Gödel');
    expect(turn.text.length).toBeGreaterThan(20);
    expect(turn.rigor).toBeGreaterThanOrEqual(70);
  });

  it('Desafío Polímata: Radar de Maestría, Niveles XP y Retos Interdisciplinarios', async () => {
    const { progress } = await import('../src/state.js');
    const { requestGenerateChallenge, requestEvaluateChallenge } = await import('../src/api.js');

    // 1. Visitar nodo y calcular maestría
    progress.visit('bayes_theorem');
    progress.visit('scientific_method');
    const mastery = progress.domainMastery();
    expect(Object.keys(mastery)).toHaveLength(6);
    expect(mastery.logic).toBeGreaterThan(0);
    expect(mastery.science).toBeGreaterThan(0);

    // 2. Perfil polímata inicial
    const prof = progress.polymathProfile();
    expect(prof).toHaveProperty('level');
    expect(prof).toHaveProperty('xp');
    expect(prof).toHaveProperty('title');
    expect(prof.badges.length).toBeGreaterThanOrEqual(5);

    // 3. Generación y resolución de desafío
    const ch = await requestGenerateChallenge({ domain1: 'science', domain2: 'technology', useLlm: false });
    expect(ch).toHaveProperty('question');
    expect(ch.options).toHaveLength(4);

    const initialXp = progress.xp();
    const evalRes = await requestEvaluateChallenge({
      challengeId: ch.id,
      question: ch.question,
      userAnswer: ch.options[ch.correct || 0],
      userReasoning: 'Inferencia correcta sobre la relación interdisciplinaria.',
      domains: ch.domains,
      useLlm: false,
    });
    expect(evalRes.is_correct).toBe(true);

    progress.recordChallenge(ch.id, {
      solved: true,
      xp: evalRes.xp,
      domains: ch.domains,
      score: evalRes.score,
    });

    expect(progress.xp()).toBe(initialXp + evalRes.xp);
    const updatedProf = progress.polymathProfile();
    expect(updatedProf.solvedChallenges).toBeGreaterThanOrEqual(1);
    expect(updatedProf.badges.find((b) => b.id === 'bridge_builder')?.unlocked).toBe(true);
  });

  it('Exportador Universal: funciones de exportación de Obsidian y Anki disponibles', async () => {
    const api = await import('../src/api.js');
    expect(typeof api.downloadObsidianVault).toBe('function');
    expect(typeof api.downloadAnkiPackage).toBe('function');
    expect(typeof api.downloadAnkiTsv).toBe('function');
  });
});
