// DevOps_Orchestrator_Agent · skill: vector_search_indexer
// Índice TF-IDF (vectores dispersos + similitud coseno). No son embeddings neuronales:
// es una implementación ligera, sin dependencias y sin latencia de red.
import { tokenize, splitSentences, norm } from './text.js';

export function stem(t) {
  if (t.length > 6 && t.endsWith('ciones')) return t.slice(0, -2);
  if (t.length > 5 && t.endsWith('es')) return t.slice(0, -2);
  if (t.length > 4 && t.endsWith('s')) return t.slice(0, -1);
  return t;
}

export const terms = (text) => tokenize(text).map(stem);

export function chunkText(text, maxChars = 420) {
  const paras = text.split(/\n{1,}/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  for (const p of paras) {
    if (p.length <= maxChars) { out.push(p); continue; }
    let cur = '';
    for (const s of splitSentences(p)) {
      if ((cur + ' ' + s).length > maxChars && cur) { out.push(cur.trim()); cur = s; }
      else cur += ' ' + s;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

export function buildIndex(docs) {
  const df = new Map();
  const tokenized = docs.map((d) => {
    const toks = terms(d.text);
    new Set(toks).forEach((t) => df.set(t, (df.get(t) || 0) + 1));
    return toks;
  });
  const N = docs.length;
  const idf = (t) => Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1;
  const vectors = tokenized.map((toks) => {
    const tf = new Map();
    toks.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
    const v = new Map();
    let norm2 = 0;
    tf.forEach((c, t) => { const w = (1 + Math.log(c)) * idf(t); v.set(t, w); norm2 += w * w; });
    const n = Math.sqrt(norm2) || 1;
    v.forEach((w, t) => v.set(t, w / n));
    return v;
  });
  return { docs, vectors, idf, df };
}

export function search(index, query, k = 5) {
  const qt = terms(query);
  if (!qt.length) return [];
  const tf = new Map();
  qt.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
  const q = new Map();
  let n2 = 0;
  tf.forEach((c, t) => { const w = (1 + Math.log(c)) * index.idf(t); q.set(t, w); n2 += w * w; });
  const qn = Math.sqrt(n2) || 1;
  const results = [];
  index.vectors.forEach((v, i) => {
    let dot = 0;
    const shared = [];
    q.forEach((w, t) => { const x = v.get(t); if (x) { dot += (w / qn) * x; shared.push(t); } });
    if (dot > 0) results.push({ doc: index.docs[i], score: dot, shared });
  });
  return results.sort((a, b) => b.score - a.score).slice(0, k);
}

/** Respuesta extractiva con citas: devuelve los pasajes más relevantes para la pregunta. */
export function answerFromDocument(index, question, k = 3) {
  const hits = search(index, question, k).filter((h) => h.score > 0.05);
  if (!hits.length) return { found: false, hits: [], answer: 'No encontré pasajes relevantes en el documento. Prueba con otras palabras clave.' };
  return { found: true, hits, answer: hits[0].doc.text };
}

export { norm };
