// Generador local de flashcards (fallback sin IA): glosario + oraciones definitorias + huecos (cloze).
import glossary from '@data/glossary.json';
import { splitSentences, norm } from './text.js';
import { terms } from './rag.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DEF_RE = /^(.{3,60}?)\s+(es|son|era|fue|se define como|se denomina|consiste en|significa|mide|describe|establece|afirma|postula|is|are|refers to|means|measures|states)\s+(.{15,})$/i;
const BAD_SUBJECT = /^(esto|eso|esta|este|ello|aquello|lo que|it|this|that|there|el resultado|la respuesta)$/i;

function clip(s, n = 320) {
  s = s.trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

/** Tarjetas a partir de términos del glosario que aparecen en el texto. */
function glossaryCards(text, level, lang) {
  const n = norm(text);
  const out = [];
  glossary.terms.forEach((t) => {
    const hit = t.aliases.find((a) => {
      const na = norm(a);
      const b1 = /^[a-z0-9]/.test(na) ? '\\b' : '';
      const b2 = /[a-z0-9]$/.test(na) ? '\\b' : '';
      return new RegExp(b1 + esc(na) + b2, 'i').test(n);
    });
    if (!hit) return;
    const label = t.aliases[0];
    const def = t[lang]?.[level] || t.es?.[level] || t.es?.intermediate;
    if (!def) return;
    out.push({
      front: lang === 'en' ? `What is **${label}**?` : `¿Qué es **${label}**?`,
      back: def,
      tags: ['glosario', t.node],
      kind: 'qa',
    });
  });
  return out;
}

/** Tarjetas a partir de oraciones del tipo «X es …», «X mide …». */
function definitionCards(text) {
  const out = [];
  splitSentences(text).forEach((s) => {
    const m = s.replace(/\s+/g, ' ').match(DEF_RE);
    if (!m) return;
    const subject = m[1].replace(/^(el|la|los|las|un|una|the|a|an)\s+/i, '').replace(/[,:;]$/, '').trim();
    if (subject.split(' ').length > 7 || BAD_SUBJECT.test(subject) || subject.length < 3) return;
    const verb = m[2].toLowerCase();
    const question = /^(es|son|era|fue|se define como|se denomina|significa|is|are|means|refers to)$/.test(verb)
      ? (/^(is|are|means|refers to)$/.test(verb) ? `What ${verb === 'are' ? 'are' : 'is'} **${subject}**?` : `¿Qué ${verb === 'son' ? 'son' : 'es'} **${subject}**?`)
      : (/^(measures|states|describe)$/.test(verb) ? `What does **${subject}** ${verb.replace(/s$/, '')}?` : `¿Qué ${verb} **${subject}**?`);
    out.push({ front: question, back: clip(s), tags: ['definicion'], kind: 'qa' });
  });
  return out;
}

/** Tarjetas de completar el hueco con el término más informativo de la oración. */
function clozeCards(text, docFreq) {
  const out = [];
  splitSentences(text)
    .filter((s) => s.length >= 50 && s.length <= 260)
    .forEach((s) => {
      const words = s.match(/[\p{L}\p{N}][\p{L}\p{N}-]{4,}/gu) || [];
      let best = null;
      let bestScore = 0;
      words.forEach((w) => {
        const t = terms(w)[0];
        if (!t) return;
        const df = docFreq.get(t) || 1;
        const score = w.length / Math.sqrt(df) + (/^\p{Lu}/u.test(w) ? 1.5 : 0) + (/\d/.test(w) ? 1 : 0);
        if (score > bestScore) { bestScore = score; best = w; }
      });
      if (!best) return;
      const front = s.replace(new RegExp(`(^|[^\\p{L}])${esc(best)}(?![\\p{L}])`, 'u'), '$1_____');
      if (front === s) return;
      out.push({ front: `Completa: ${front}`, back: `**${best}**\n\n${s}`, tags: ['cloze'], kind: 'cloze', score: bestScore });
    });
  return out.sort((a, b) => b.score - a.score).map(({ score, ...c }) => c);
}

export function localFlashcards(text, { maxCards = 8, level = 'intermediate', lang = 'es' } = {}) {
  const clean = String(text || '').trim();
  if (!clean) return [];
  const df = new Map();
  splitSentences(clean).forEach((s) => new Set(terms(s)).forEach((t) => df.set(t, (df.get(t) || 0) + 1)));

  const pool = [...glossaryCards(clean, level, lang), ...definitionCards(clean), ...clozeCards(clean, df)];
  const seen = new Set();
  const out = [];
  for (const c of pool) {
    const k = norm(c.front).replace(/[^a-z0-9]+/g, ' ').trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(c);
    if (out.length >= maxCards) break;
  }
  return out;
}

/** Tarjetas deterministas de una sesión socrática: prioriza los pasos donde se usaron pistas. */
export function socraticCards(problem, session = {}) {
  if (!problem) return [];
  const hints = session.hintsUsed || {};
  const mastered = new Set(session.mastered || []);
  const concepts = [...problem.concepts].sort((a, b) => (hints[b.id] || 0) - (hints[a.id] || 0));
  const cards = concepts.map((c) => {
    const used = hints[c.id] || 0;
    const lastHint = c.hints?.[Math.min(c.hints.length - 1, Math.max(0, used - 1))] || c.hints?.[0] || '';
    const tags = ['socratico', problem.node, used ? 'dificil' : null, mastered.has(c.id) ? null : 'pendiente'].filter(Boolean);
    return {
      front: `«${problem.title}» — ${c.question}`,
      back: `**${c.name}**\n\n${lastHint}`,
      tags,
      kind: 'qa',
    };
  });
  if (problem.synthesis) {
    cards.push({ front: `${problem.prompt}`, back: problem.synthesis, tags: ['socratico', problem.node, 'sintesis'], kind: 'qa' });
  }
  (problem.misconceptions || []).slice(0, 2).forEach((m) => {
    cards.push({ front: `Error típico en «${problem.title}»: ¿por qué es engañoso razonar así?`, back: m.response, tags: ['socratico', problem.node, 'error_comun'], kind: 'qa' });
  });
  return cards;
}
