// Cliente API para comunicación con el backend FastAPI y fallback a motores locales
import { evaluate, hint, studyPlan } from './engines/socratic.js';
import { answerFromDocument } from './engines/rag.js';
import { explain } from './engines/explain.js';

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
