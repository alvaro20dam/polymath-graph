// SocraticTutor_Agent · skills: socratic_hint_generator, mastery_gap_analyzer, adaptive_complexity_scaler
// El tutor NUNCA entrega la solución: formula preguntas guiadas y pistas progresivas.
// La síntesis solo se muestra cuando el estudiante ya ha construido todos los conceptos.
import data from '@data/socratic.json';
import { rx, norm } from './text.js';

export const PROBLEMS = data.problems;
const HINT_OFFSET = { beginner: 0, intermediate: 0, expert: 1 };

const cache = new Map();
function compiled(problem) {
  if (!cache.has(problem.id)) {
    cache.set(problem.id, {
      concepts: problem.concepts.map((c) => ({ ...c, regs: c.keywords.map((k) => rx(k)) })),
      mis: (problem.misconceptions || []).map((m) => ({ re: rx(m.pattern), response: m.response })),
    });
  }
  return cache.get(problem.id);
}

export const getProblem = (id) => PROBLEMS.find((p) => p.id === id);

export function newSession(problemId, level = 'intermediate') {
  return { problemId, level, mastered: [], hintsUsed: {}, attempts: 0, misconceptions: 0 };
}

const missingOf = (session, problem) => problem.concepts.filter((c) => !session.mastered.includes(c.id));

export function openingMessage(problem, level) {
  const first = problem.concepts[0];
  const steps = level === 'beginner' ? ' Para empezar, descompón el problema en pasos:\n• ' + problem.steps.join('\n• ') : '';
  return `Antes de resolver, cuéntame cómo lo abordarías.${steps}\n\n${first.question}`;
}

/** Evalúa el razonamiento del estudiante y devuelve la siguiente intervención socrática. */
export function evaluate(session, text) {
  const problem = getProblem(session.problemId);
  const { concepts, mis } = compiled(problem);
  const clean = norm(text);
  session.attempts += 1;

  const newly = [];
  for (const c of concepts) {
    if (session.mastered.includes(c.id)) continue;
    if (c.regs.some((r) => r.test(clean))) {
      session.mastered.push(c.id);
      newly.push(c);
    }
  }
  const missing = missingOf(session, problem);
  const mastery = session.mastered.length / problem.concepts.length;

  if (clean.trim().length < 12 && !newly.length) {
    return { kind: 'empty', message: `Escribe un poco más: ¿cuál sería tu primer paso?\n\n${missing[0].question}`, newly, missing, mastery };
  }

  const misc = mis.find((m) => m.re.test(clean));
  if (misc) {
    session.misconceptions += 1;
    return { kind: 'misconception', message: misc.response, newly, missing, mastery };
  }

  if (!missing.length) {
    return {
      kind: 'complete',
      message: `¡Lo construiste tú mismo! Identificaste: ${problem.concepts.map((c) => c.name).join(' · ')}.\n\nSíntesis para consolidar: ${problem.synthesis}`,
      newly, missing, mastery,
    };
  }

  const praise = newly.length ? `Bien: ya apareció ${newly.map((c) => '«' + c.name + '»').join(' y ')}. ` : 'Todavía no veo ese paso en tu razonamiento. ';
  return { kind: 'progress', message: `${praise}Sigamos con una pregunta:\n\n${missing[0].question}`, newly, missing, mastery };
}

/** Pista progresiva ajustada al nivel; nunca revela el resultado final. */
export function hint(session) {
  const problem = getProblem(session.problemId);
  const missing = missingOf(session, problem);
  if (!missing.length) return { exhausted: true, message: 'Ya dominaste todos los conceptos. Revisa la síntesis o prueba otro problema.', level: 0, total: 0 };
  const c = missing[0];
  const used = session.hintsUsed[c.id] ?? 0;
  const idx = used + (HINT_OFFSET[session.level] ?? 0);
  if (idx >= c.hints.length) {
    return {
      exhausted: true, level: c.hints.length, total: c.hints.length,
      message: `Ya agotaste las pistas del paso «${c.name}». En lugar de más ayuda, prueba esto: dibuja el caso en la pizarra, explora el nodo relacionado en el grafo o usa un simulador del Laboratorio, y luego cuéntame qué observas con tus palabras.`,
    };
  }
  session.hintsUsed[c.id] = used + 1;
  return { exhausted: false, level: idx + 1, total: c.hints.length, concept: c.name, message: c.hints[idx] };
}

/** mastery_gap_analyzer: brechas por concepto con severidad. */
export function masteryGaps(session) {
  const problem = getProblem(session.problemId);
  return problem.concepts.map((c) => {
    const mastered = session.mastered.includes(c.id);
    const hints = session.hintsUsed[c.id] ?? 0;
    let status = 'dominado';
    if (!mastered) status = 'brecha';
    else if (hints >= 2) status = 'frágil';
    return { id: c.id, name: c.name, status, hints };
  });
}

/** adaptive_complexity_scaler + plan de estudio personalizado. */
export function studyPlan(session) {
  const problem = getProblem(session.problemId);
  const gaps = masteryGaps(session).filter((g) => g.status !== 'dominado');
  const totalHints = Object.values(session.hintsUsed).reduce((a, b) => a + b, 0);
  const done = session.mastered.length === problem.concepts.length;
  let next = problem.level;
  if (done && totalHints <= 1 && session.misconceptions === 0) next = Math.min(5, problem.level + 1);
  else if (!done || totalHints >= 4 || session.misconceptions >= 2) next = Math.max(1, problem.level - 1);
  const candidates = PROBLEMS.filter((p) => p.id !== problem.id).sort((a, b) => Math.abs(a.level - next) - Math.abs(b.level - next));
  return {
    gaps,
    relatedNodes: problem.related,
    nextLevel: next,
    suggestedProblem: candidates[0] ?? null,
    advice: gaps.length
      ? `Refuerza: ${gaps.map((g) => g.name).join(', ')}. Revisa los nodos relacionados en el grafo antes de reintentar.`
      : done ? 'Sin brechas detectadas. Sube de nivel con un problema más desafiante.' : 'Sigue explorando.',
  };
}
