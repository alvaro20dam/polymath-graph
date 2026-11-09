// Cliente API para comunicación con el backend FastAPI y fallback a motores locales
import { evaluate, hint, studyPlan } from './engines/socratic.js';
import { answerFromDocument, buildIndex, search, terms } from './engines/rag.js';
import { explain } from './engines/explain.js';
import { analyze } from './engines/fallacy.js';
import { localFlashcards } from './engines/cardgen.js';
import { graph } from './state.js';
import thinkersData from '@data/thinkers.json';

let _llmStatus = null;
let _statusPromise = null;

export async function getLlmStatus(force = false) {
  if (_llmStatus && !force) return _llmStatus;
  if (_statusPromise && !force) return _statusPromise;

  _statusPromise = fetch('/api/llm/status')
    .then((r) => (r.ok ? r.json() : { enabled: false }))
    .then((data) => {
      _llmStatus = data;
      return data;
    })
    .catch(() => {
      _llmStatus = { enabled: false, offline: true };
      return _llmStatus;
    });

  return _statusPromise;
}

export async function evaluateSocratic(session, text, history = []) {
  try {
    const res = await fetch('/api/socratic/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: {
          problemId: session.problemId,
          level: session.level,
          mastered: session.mastered,
          hintsUsed: session.hintsUsed,
          attempts: session.attempts,
          misconceptions: session.misconceptions,
        },
        text,
        history: history.slice(-6).map((m) => ({ role: m.role || 'user', text: m.text || '' })),
        use_llm: true,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      return data;
    }
  } catch (err) {
    // Backend no alcanzable; cae al fallback sin interrumpir la experiencia
  }

  const localRes = evaluate(session, text);
  return { ...localRes, engine: 'local' };
}

export async function askSocraticHint(session, history = []) {
  try {
    const res = await fetch('/api/socratic/hint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: {
          problemId: session.problemId,
          level: session.level,
          mastered: session.mastered,
          hintsUsed: session.hintsUsed,
          attempts: session.attempts,
          misconceptions: session.misconceptions,
        },
        history: history.slice(-6).map((m) => ({ role: m.role || 'user', text: m.text || '' })),
        use_llm: true,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      return data;
    }
  } catch (err) {
    // Backend no alcanzable; cae al fallback
  }

  const localRes = hint(session);
  return { ...localRes, engine: 'local' };
}

export async function evaluateWhiteboard(session, imageBase64, history = []) {
  try {
    const res = await fetch('/api/socratic/whiteboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: {
          problemId: session.problemId,
          level: session.level,
          mastered: session.mastered,
          hintsUsed: session.hintsUsed,
          attempts: session.attempts,
          misconceptions: session.misconceptions,
        },
        image_base64: imageBase64,
        history: history.slice(-6).map((m) => ({ role: m.role || 'user', text: m.text || '' })),
        use_llm: true,
      }),
    });

    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    // Backend no alcanzable; cae al fallback
  }

  return {
    kind: 'feedback',
    message: '⚠️ No se pudo conectar con el servidor para evaluar la pizarra. Asegúrate de que el backend esté activo e inténtalo de nuevo.',
    engine: 'local',
  };
}

export async function extractDocumentText(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.pdf')) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/pdf/extract', {
      method: 'POST',
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Error al procesar PDF' }));
      throw new Error(err.detail || 'No se pudo leer el archivo PDF');
    }
    return await res.json();
  }
  const txt = await file.text();
  return {
    filename: file.name,
    pages: 1,
    text: txt,
    chars: txt.length,
  };
}

export async function queryDocumentRag(text, question, k = 3, localIndex = null) {
  try {
    const res = await fetch('/api/rag/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        question,
        k,
        use_llm: true,
      }),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // fallback
  }

  if (localIndex) {
    const local = answerFromDocument(localIndex, question, k);
    return {
      found: local.found,
      answer: local.answer,
      passages: (local.hits || []).map((h) => ({ text: h.doc.text, score: h.score, terms: h.shared })),
      engine: 'local',
    };
  }
  return { found: false, answer: 'No se pudo procesar la pregunta.', passages: [], engine: 'local' };
}

export async function explainDocumentText(selectedText, context, level = 'beginner', lang = 'es') {
  try {
    const res = await fetch('/api/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selected_text: selectedText,
        context,
        level,
        lang,
        use_llm: true,
      }),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // fallback
  }

  const local = explain({ selected: selectedText, context, level, lang });
  return {
    ...local,
    engine: 'local',
  };
}

export async function auditFallacies(text, useLlm = true) {
  try {
    const res = await fetch('/api/fallacies/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        use_llm: useLlm,
      }),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // fallback
  }

  const local = analyze(text);
  return {
    ...local,
    engine: 'heuristic',
  };
}

export async function extractGraphNodesFromText(text, maxNodes = 3, useLlm = true) {
  try {
    const res = await fetch('/api/graph/extract-from-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        max_nodes: maxNodes,
        use_llm: useLlm,
      }),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // fallback local
  }

  // Fallback cliente si el backend no está disponible
  const idx = buildIndex(graph.nodes.map((n) => ({ id: n.id, text: `${n.label} ${n.summary}` })));
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length >= 20);
  const chunks = paras.length ? paras.slice(0, maxNodes) : [text.trim()];
  const nodes = [];
  const links = [];

  chunks.forEach((chunk, i) => {
    const toks = terms(chunk).filter((w) => w.length >= 4);
    if (!toks.length) return;
    const label = toks.slice(0, 3).join(' ').replace(/^./, (c) => c.toUpperCase());
    const id = 'custom_' + toks.slice(0, 3).join('_') + '_' + (i + 1);
    const hits = search(idx, chunk, 3).map((h) => h.doc.id);
    const conn = hits.length ? hits : ['critical_thinking', 'scientific_method'];
    if (!conn.includes('critical_thinking')) conn.push('critical_thinking');
    nodes.push({
      id,
      label,
      domain: 'science',
      complexity: 3,
      year: 2026,
      authors: ['Documento del usuario'],
      summary: chunk.slice(0, 180) + (chunk.length > 180 ? '…' : ''),
      custom: true,
    });
    conn.slice(0, 3).forEach((target) => {
      links.push({ source: id, target, relation: 'influences' });
    });
  });

  return { nodes, links, engine: 'local' };
}

/**
 * Genera flashcards (pregunta/respuesta) a partir de un texto o transcripción de sesión.
 * source: 'document' | 'socratic' | 'explanation'. Devuelve { cards: [{front, back, tags, kind}], engine }.
 */
export async function generateFlashcards(text, { source = 'document', maxCards = 8, level = 'intermediate', lang = 'es', useLlm = true } = {}) {
  try {
    const res = await fetch('/api/flashcards/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 50000), source, max_cards: maxCards, level, lang, use_llm: useLlm }),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.cards) && data.cards.length) return data;
    }
  } catch {
    // fallback local
  }
  return { cards: localFlashcards(text, { maxCards, level, lang }), engine: 'local' };
}

export async function fetchDebateCatalog() {
  try {
    const res = await fetch('/api/debate/catalog');
    if (res.ok) return await res.json();
  } catch {
    // fallback
  }
  return thinkersData;
}

export async function requestDebateTurn({ thinkerId, opponentId, topic, history = [], userIntervention = null, useLlm = true }) {
  try {
    const res = await fetch('/api/debate/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        thinker_id: thinkerId,
        opponent_id: opponentId,
        topic,
        history,
        user_intervention: userIntervention,
        use_llm: useLlm,
      }),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // fallback
  }

  // Fallback local heurístico en cliente
  const thinkers = thinkersData.thinkers;
  const t = thinkers.find((x) => x.id === thinkerId) || { name: thinkerId, avatar: '🏛️', core_stance: 'Análisis racional.' };
  const op = thinkers.find((x) => x.id === opponentId) || { name: opponentId, avatar: '📜' };

  let text;
  if (userIntervention) {
    text = `Agradezco la agudeza de tu intervención. Mi postura sostiene que ${t.core_stance} Al plantear «${userIntervention.trim()}», debemos tener presente que mi estimado colega ${op.name} pasa por alto este fundamento epistémico.`;
  } else if (!history.length) {
    text = `Para abordar «${topic}», mi tesis central es ineludible: ${t.core_stance} Escuchemos qué objeción preliminar tiene mi distinguido interlocutor, ${op.name}.`;
  } else {
    text = `Comprendo el punto de ${op.name}, pero soslaya el núcleo de la cuestión. Con respecto a «${topic}», reitero que: ${t.core_stance}`;
  }

  const analysis = analyze(text);
  return {
    speaker: thinkerId,
    name: t.name,
    avatar: t.avatar,
    text,
    rigor: 85,
    fallacies: analysis.fallacies || [],
    key_concept: t.nodes?.[0] || 'critical_thinking',
    engine: 'local',
  };
}


