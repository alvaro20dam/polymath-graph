// LogicVerifier_Agent · skills: fallacy_checker, bias_detector, argument_structure_parser
import data from '@data/fallacies.json';
import { normMap, rx, originalSlice, splitSentences, norm } from './text.js';
import { terms } from './rag.js';

export const FALLACIES = data.fallacies;
export const BIASES = data.biases;

const compiled = (list) =>
  list.map((item) => ({ item, regs: item.patterns.map((p) => rx(p)) }));
const CF = compiled(FALLACIES);
const CB = compiled(BIASES);

function scan(text, compiledList) {
  const { n, map } = normMap(text);
  const found = [];
  for (const { item, regs } of compiledList) {
    const evidence = [];
    for (const r of regs) {
      const m = r.exec(n);
      if (m && m[0].length > 0) {
        const snippet = originalSlice(text, map, m.index, m.index + m[0].length, 10);
        if (!evidence.includes(snippet)) evidence.push(snippet);
      }
    }
    if (evidence.length) found.push({ ...item, evidence });
  }
  return found;
}

const CONCL = /^(por lo tanto|por ende|por consiguiente|luego|asi que|entonces|en conclusion|de ahi que|therefore|thus|hence|consequently|so|in conclusion)[\s,:]+/i;
const PREM_MID = /[,\s]+(porque|dado que|puesto que|ya que|because|since|given that)\s+/i;

const IF_RE = /^(?:si|if)\s+(.+?)(?:\s*,\s*|\s+entonces\s+|\s+then\s+)(.+?)[.!?]*$/;
const NEG_RE = /(^|\s)(no|not|never|nunca|jamas|tampoco)\s|n't\b/;
const stems = (s) => new Set(terms(s).map((t) => t.slice(0, 4)));
function score(a, b) {
  if (!a.size || !b.size) return 0;
  let k = 0;
  a.forEach((t) => { if (b.has(t)) k++; });
  return k / Math.min(a.size, b.size);
}
const similar = (a, b) => score(a, b) >= 0.5;

/** Detecta por estructura «Si A entonces C. C. Luego A» (consecuente) y «Si A entonces C. No A. Luego no C». */
function detectFormal(text) {
  const orig = splitSentences(text);
  const sents = orig.map((s) => norm(s).trim());
  const out = [];
  const i = sents.findIndex((s) => IF_RE.test(s));
  if (i < 0 || sents.length - i < 3) return out;
  const [, a, c] = IF_RE.exec(sents[i]);
  const lastRaw = sents[sents.length - 1];
  if (!CONCL.test(lastRaw)) return out;
  const premise = sents[i + 1];
  const concl = lastRaw.replace(CONCL, '');
  const A = stems(a), C = stems(c), P = stems(premise), Q = stems(concl);
  const pNeg = NEG_RE.test(' ' + premise + ' '), qNeg = NEG_RE.test(' ' + concl + ' ');
  const evidence = [orig[i], orig[i + 1], orig[orig.length - 1]].join(' ');
  if (!pNeg && !qNeg && similar(P, C) && score(P, C) > score(P, A) && similar(Q, A)) out.push({ ...FALLACIES.find((f) => f.id === 'affirming_consequent'), evidence: [evidence] });
  if (pNeg && qNeg && similar(P, A) && score(P, A) > score(P, C) && similar(Q, C)) out.push({ ...FALLACIES.find((f) => f.id === 'denying_antecedent'), evidence: [evidence] });
  return out;
}

export const fallacyChecker = (text) => {
  const found = scan(text, CF);
  for (const f of detectFormal(text)) if (!found.some((x) => x.id === f.id)) found.push(f);
  return found;
};
export const biasDetector = (text) => scan(text, CB);


/** Descompone un texto en premisas y conclusión usando indicadores lingüísticos. */
export function argumentStructureParser(text) {
  const sentences = splitSentences(text);
  const premises = [];
  const conclusions = [];
  for (const s of sentences) {
    const clean = norm(s);
    const m = CONCL.exec(clean);
    if (m) {
      conclusions.push(s.slice(m[0].length).trim());
      continue;
    }
    const mid = PREM_MID.exec(clean);
    if (mid) {
      conclusions.push(s.slice(0, mid.index).trim());
      premises.push(s.slice(mid.index + mid[0].length).trim());
      continue;
    }
    premises.push(s);
  }
  let inferred = false;
  if (!conclusions.length && premises.length > 1) {
    conclusions.push(premises.pop());
    inferred = true;
  }
  return { premises, conclusions, inferred };
}

/** Analiza un argumento: estructura + falacias + sesgos + puntaje de rigor. */
export function analyze(text) {
  const structure = argumentStructureParser(text);
  const fallacies = fallacyChecker(text);
  const biases = biasDetector(text);
  const rigor = Math.max(0, 100 - fallacies.length * 20 - biases.length * 10);
  const notes = [];
  if (!structure.conclusions.length) notes.push('No se identifica una conclusión explícita: ¿qué quieres demostrar?');
  if (structure.premises.length === 0) notes.push('No hay premisas: una conclusión sin razones es solo una afirmación.');
  if (!fallacies.length && !biases.length)
    notes.push('No se detectaron patrones conocidos. Esto NO garantiza validez: el detector usa heurísticas léxicas; revisa la forma lógica manualmente.');
  return { structure, fallacies, biases, rigor, notes };
}
