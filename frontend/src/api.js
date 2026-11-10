// Cliente API para comunicación con el backend FastAPI y fallback a motores locales
import { evaluate, hint, studyPlan } from './engines/socratic.js';
import { answerFromDocument, buildIndex, search, terms } from './engines/rag.js';
import { explain } from './engines/explain.js';
import { analyze } from './engines/fallacy.js';
import { localFlashcards } from './engines/cardgen.js';
import { analyzeDocumentGraph } from './engines/docGraph.js';
import { findIdeologicalBridge, groupNodesByEra } from './engines/timelineEngine.js';
import { graph } from './state.js';
import thinkersData from '@data/thinkers.json';
import challengesData from '@data/challenges.json';

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

export async function requestDuelTurn({ thinkerId, topic, userArgument, roundNumber = 1, history = [], useLlm = true }) {
  try {
    const res = await fetch('/api/debate/duel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        thinker_id: thinkerId,
        topic,
        user_argument: userArgument,
        round_number: roundNumber,
        history,
        use_llm: useLlm,
      }),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // fallback
  }

  // Fallback local heurístico
  const thinkers = thinkersData.thinkers;
  const t = thinkers.find((x) => x.id === thinkerId) || { name: thinkerId, avatar: '🏛️', core_stance: 'Análisis racional.', era: 'Filosofía clásica' };
  const analysis = analyze(userArgument);
  const fallacies = analysis.fallacies || [];
  const biases = analysis.biases || [];

  const wordCount = (userArgument || '').trim().split(/\s+/).length;
  let rigor = 70;
  if (wordCount >= 25) rigor += 10;
  if (wordCount >= 50) rigor += 8;
  if (fallacies.length) rigor -= Math.min(35, fallacies.length * 15);
  rigor = Math.max(25, Math.min(95, rigor));

  const isFinal = roundNumber >= 3;
  let replyText = `Escucho con atención tu tesis sobre «${topic}». Sin embargo, mi perspectiva sostiene que ${t.core_stance} ¿Cómo respondes a la objeción de consistencia en tus premisas?`;
  if (roundNumber === 2) {
    replyText = `Tu réplica añade elementos de interés. No obstante: ${t.core_stance} ¿No estás soslayando la distinción fundamental que separa el fenómeno de la cosa en sí?`;
  } else if (roundNumber >= 3) {
    replyText = `Concluimos este asalto sobre «${topic}». Has defendido tu postura con notable empeño dialéctico. Mi principio rector permanece: ${t.core_stance}`;
  }

  return {
    thinker_id: thinkerId,
    thinker_name: t.name,
    thinker_avatar: t.avatar,
    thinker_era: t.era,
    reply: replyText,
    user_rigor: rigor,
    user_fallacies: fallacies,
    user_biases: biases,
    user_strengths: wordCount >= 30 ? ['Desarrollo conceptual estructurado'] : ['Planteamiento directo'],
    xp_earned: Math.max(15, Math.round(rigor * 0.4)),
    is_final_round: isFinal,
    verdict: isFinal ? {
      won: rigor >= 65,
      title: rigor >= 65 ? 'Victoria Dialéctica' : 'Lección Socrática',
      summary: `Duelo concluido contra ${t.name} con rigor de ${rigor}/100.`,
    } : null,
    engine: 'local',
  };
}

export async function fetchChallengesBank() {
  try {
    const res = await fetch('/api/challenge/bank');
    if (res.ok) return await res.json();
  } catch {
    // fallback
  }
  return challengesData.challenges || [];
}

export async function requestGenerateChallenge({ domain1 = 'any', domain2 = 'any', level = 'intermediate', useLlm = true } = {}) {
  try {
    const res = await fetch('/api/challenge/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain1, domain2, level, use_llm: useLlm }),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // fallback
  }

  // Fallback local desde challenges.json
  const bank = challengesData.challenges || [];
  const matches = bank.filter((c) => {
    const d1_ok = domain1 === 'any' || c.domains.includes(domain1);
    const d2_ok = domain2 === 'any' || c.domains.includes(domain2);
    return d1_ok && d2_ok;
  });
  const chosen = matches[0] || bank[0];
  return { ...chosen, engine: 'local' };
}

export async function requestEvaluateChallenge({ challengeId, question, userAnswer, userReasoning = '', expectedExplanation = '', domains = [], useLlm = true }) {
  try {
    const res = await fetch('/api/challenge/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challenge_id: challengeId,
        question,
        user_answer: userAnswer,
        user_reasoning: userReasoning,
        expected_explanation: expectedExplanation,
        domains,
        use_llm: useLlm,
      }),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // fallback
  }

  const bank = challengesData.challenges || [];
  const base = bank.find((c) => c.id === challengeId);
  let isCorrect = false;
  if (base && typeof base.correct === 'number') {
    isCorrect = userAnswer.trim() === base.options[base.correct]?.trim() || userAnswer.trim() === String(base.correct);
  } else if (expectedExplanation) {
    const expToks = new Set(terms(expectedExplanation));
    const userToks = new Set(terms(`${userAnswer} ${userReasoning}`));
    const ov = [...expToks].filter((t) => userToks.has(t)).length;
    isCorrect = ov / Math.max(1, expToks.size) >= 0.2;
  }

  return {
    is_correct: isCorrect,
    score: isCorrect ? 95 : 40,
    xp: isCorrect ? (base?.xp || 50) : 15,
    feedback: isCorrect
      ? `¡Excelente conexión interdisciplinaria! Tu deducción aborda correctamente el puente entre ${(domains || ['las disciplinas']).join(' y ')}.`
      : `Buen intento de análisis. El punto clave a tener en cuenta es: ${expectedExplanation || base?.explanation || ''}`,
    explanation: expectedExplanation || base?.explanation || '',
    fallacies: [],
    domains: domains.length ? domains : (base?.domains || ['science', 'philosophy']),
    suggested_nodes: base?.nodes || ['critical_thinking'],
    engine: 'local',
  };
}

// ---------------- Persistencia SQLite Local / Perfiles ----------------
export async function fetchUserProfiles() {
  try {
    const res = await fetch('/api/user/profiles');
    if (res.ok) return await res.json();
  } catch { /* offline / dev fallback */ }
  return [{ id: 'default', name: 'Polímata Principal', avatar: '🧙‍♂️', xp: 0 }];
}

export async function createUserProfile(name, avatar = '🧙‍♂️') {
  try {
    const res = await fetch('/api/user/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, avatar }),
    });
    if (res.ok) return await res.json();
  } catch { /* offline */ }
  return { id: name.toLowerCase().replace(/[^a-z0-9_-]/g, '_'), name, avatar, xp: 0 };
}

export async function fetchUserState(userId = 'default') {
  try {
    const res = await fetch(`/api/user/state?user_id=${encodeURIComponent(userId)}`);
    if (res.ok) return await res.json();
  } catch { /* offline */ }
  return null;
}

export async function syncUserState(payload) {
  try {
    const res = await fetch('/api/user/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) return await res.json();
  } catch { /* offline */ }
  return null;
}

export async function exportUserBackup(userId = 'default') {
  try {
    const res = await fetch(`/api/user/backup/export?user_id=${encodeURIComponent(userId)}`);
    if (res.ok) return await res.json();
  } catch { /* offline */ }
  return null;
}

export async function importUserBackup(backup, userId = 'default') {
  try {
    const res = await fetch('/api/user/backup/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, backup }),
    });
    if (res.ok) return await res.json();
  } catch { /* offline */ }
  return null;
}

// ---------------- Exportador Universal (Obsidian & Anki) ----------------
export async function downloadObsidianVault(userId = 'default') {
  try {
    const res = await fetch(`/api/export/obsidian?user_id=${encodeURIComponent(userId)}`);
    if (!res.ok) throw new Error('Error al generar la bóveda de Obsidian');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Polymath_Obsidian_Vault.zip';
    a.click();
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.error('Error al descargar bóveda de Obsidian:', err);
    return false;
  }
}

export async function downloadAnkiPackage(userId = 'default') {
  try {
    const res = await fetch(`/api/export/anki?user_id=${encodeURIComponent(userId)}`);
    if (!res.ok) throw new Error('Error al generar el mazo de Anki');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Polymath_Deck.apkg';
    a.click();
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.error('Error al descargar paquete Anki:', err);
    return false;
  }
}

export async function downloadAnkiTsv(userId = 'default') {
  try {
    const res = await fetch(`/api/export/anki-tsv?user_id=${encodeURIComponent(userId)}`);
    if (!res.ok) throw new Error('Error al generar el archivo TSV');
    const text = await res.text();
    const blob = new Blob([text], { type: 'text/tab-separated-values' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'polymath_cards.tsv';
    a.click();
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.error('Error al descargar TSV:', err);
    return false;
  }
}

// ---------------- Lector Aumentado: Análisis de Subgrafo Semántico ----------------
export async function fetchDocumentGraphAnalysis(text, maxBridgingHops = 1) {
  try {
    const res = await fetch('/api/document/analyze-graph', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, max_bridging_hops: maxBridgingHops }),
    });
    if (res.ok) {
      const data = await res.json();
      // Mapear campos snake_case del backend a camelCase del frontend si es necesario
      return {
        detectedNodes: data.detected_nodes || [],
        links: data.links || [],
        domainDistribution: data.domain_distribution || {},
        paragraphs: (data.paragraphs || []).map((p) => ({
          index: p.index,
          text: p.text,
          nodeIds: p.node_ids || [],
          authors: p.authors || [],
        })),
        bridges: (data.bridges || []).map((b) => ({
          source: b.source,
          sourceLabel: b.source_label,
          sourceDomain: b.source_domain,
          target: b.target,
          targetLabel: b.target_label,
          targetDomain: b.target_domain,
          path: b.path || [],
          length: b.length || 0,
        })),
        authors: data.authors || [],
        stats: {
          totalNodes: data.stats?.total_nodes || 0,
          directConcepts: data.stats?.direct_concepts || 0,
          bridgingConcepts: data.stats?.bridging_concepts || 0,
          paragraphCount: data.stats?.paragraph_count || 0,
          authorCount: data.stats?.author_count || 0,
        },
        engine: 'api',
      };
    }
  } catch {
    // Fallback offline
  }

  const localRes = analyzeDocumentGraph(text, graph);
  return { ...localRes, engine: 'local' };
}

// ---------------- Navegador Temporal y Puentes Transdisciplinarios ----------------
export async function fetchHistoricalEras() {
  try {
    const res = await fetch('/api/timeline/eras');
    if (res.ok) {
      const data = await res.json();
      return data.map((e) => ({
        id: e.id,
        name: e.name,
        icon: e.icon,
        startYear: e.start_year,
        endYear: e.end_year,
        color: e.color,
        paradigm: e.paradigm,
        description: e.description,
        nodesCount: e.nodes_count,
        nodeIds: e.node_ids || [],
        sampleNodes: e.sample_nodes || [],
        engine: 'api',
      }));
    }
  } catch {
    // offline
  }
  return groupNodesByEra(graph.nodes);
}

export async function fetchIdeologicalBridge(sourceId, targetId) {
  try {
    const res = await fetch('/api/timeline/bridge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_id: sourceId, target_id: targetId }),
    });
    if (res.ok) {
      const data = await res.json();
      return {
        path: data.path || [],
        hops: data.hops,
        source: data.source,
        target: data.target,
        totalYearsSpan: data.total_years_span,
        steps: (data.steps || []).map((s) => ({
          fromNode: s.from_node,
          toNode: s.to_node,
          relation: s.relation,
          deltaYears: s.delta_years,
          disciplineShift: s.discipline_shift,
          annotation: s.annotation,
        })),
        synthesis: data.synthesis,
        engine: 'api',
      };
    }
  } catch {
    // offline fallback
  }

  const localBridge = findIdeologicalBridge(sourceId, targetId, graph.nodes, graph.links);
  return { ...localBridge, engine: 'local' };
}







