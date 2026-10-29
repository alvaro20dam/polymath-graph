// Explicador in-context (estilo Explainpaper). skill: explainpaper_highlighter
import glossary from '@data/glossary.json';
import graph from '@data/graph.json';
import { normMap, norm, splitSentences } from './text.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function aliasRegex(alias) {
  const a = norm(alias);
  const start = /^[a-z0-9]/.test(a) ? '\\b' : '';
  const end = /[a-z0-9]$/.test(a) ? '\\b' : '';
  return new RegExp(start + esc(a) + end, 'gi');
}

const TERMS = glossary.terms.map((t) => ({ ...t, regs: t.aliases.map(aliasRegex) }));
const JARGON = {
  es: glossary.jargon.es.map(([w, m]) => ({ w, m, re: aliasRegex(w) })),
  en: glossary.jargon.en.map(([w, m]) => ({ w, m, re: aliasRegex(w) })),
};
const NODE_MATCH = graph.nodes.map((n) => ({ n, re: aliasRegex(n.label) }));

export const LEVELS = { beginner: 'Principiante', intermediate: 'Intermedio', expert: 'Experto' };

export function readability(text) {
  const sentences = splitSentences(text);
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return { score: 0, label: '—' };
  const avgSentence = words.length / Math.max(1, sentences.length);
  const longWords = words.filter((w) => w.replace(/\W/g, '').length > 9).length / words.length;
  const score = Math.min(100, Math.round(avgSentence * 2 + longWords * 120));
  return { score, label: score > 65 ? 'Alta' : score > 40 ? 'Media' : 'Baja' };
}

/** Devuelve segmentos resaltados + explicaciones por término según nivel e idioma. */
export function explain({ selected, context = '', level = 'beginner', lang = 'es' }) {
  const source = selected.trim() || context;
  const { n, map } = normMap(source);
  const spans = [];

  TERMS.forEach((t) =>
    t.regs.forEach((re) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(n))) {
        if (!m[0].length) { re.lastIndex++; continue; }
        spans.push({ s: m.index, e: m.index + m[0].length, kind: 'term', ref: t.id });
      }
    })
  );
  [...JARGON.es, ...JARGON.en].forEach((j) => {
    j.re.lastIndex = 0;
    let m;
    while ((m = j.re.exec(n))) spans.push({ s: m.index, e: m.index + m[0].length, kind: 'jargon', ref: j.w, gloss: j.m });
  });

  spans.sort((a, b) => a.s - b.s || b.e - b.s - (a.e - a.s));
  const kept = [];
  let last = -1;
  for (const sp of spans) if (sp.s >= last) { kept.push(sp); last = sp.e; }

  const segments = [];
  let pos = 0;
  for (const sp of kept) {
    const a = map[sp.s], b = (map[sp.e - 1] ?? source.length - 1) + 1;
    if (a > pos) segments.push({ t: source.slice(pos, a) });
    segments.push({ t: source.slice(a, b), kind: sp.kind, ref: sp.ref, gloss: sp.gloss });
    pos = b;
  }
  if (pos < source.length) segments.push({ t: source.slice(pos) });

  const seen = new Set();
  const termCards = [];
  kept.filter((k) => k.kind === 'term').forEach((k) => {
    if (seen.has(k.ref)) return;
    seen.add(k.ref);
    const t = TERMS.find((x) => x.id === k.ref);
    termCards.push({ id: t.id, node: t.node, text: t[lang][level], label: graph.nodes.find((x) => x.id === t.node)?.label ?? t.id });
  });

  const jargon = [];
  const jseen = new Set();
  kept.filter((k) => k.kind === 'jargon').forEach((k) => { if (!jseen.has(k.ref)) { jseen.add(k.ref); jargon.push({ word: k.ref, meaning: k.gloss }); } });

  // Versión simplificada: inserta el significado junto a cada jerga (solo principiante/intermedio)
  let simplified = null;
  if (level !== 'expert' && jargon.length) {
    simplified = segments.map((s) => (s.kind === 'jargon' ? `${s.t} (${s.gloss})` : s.t)).join('');
  }

  const related = [];
  NODE_MATCH.forEach(({ n: node, re }) => { re.lastIndex = 0; if (re.test(n)) related.push(node.id); });
  termCards.forEach((c) => { if (!related.includes(c.node)) related.push(c.node); });

  return { source, segments, termCards, jargon, simplified, related, readability: readability(source) };
}
