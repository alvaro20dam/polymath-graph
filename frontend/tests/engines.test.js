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
