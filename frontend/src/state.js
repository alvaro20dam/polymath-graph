// Estado compartido: progreso del estudiante (solo localStorage, sin cuentas), grafo vivo y utilidades de navegación.
import graph from '@data/graph.json';

export { graph };
export const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
export const domainOf = (id) => graph.domains[nodeById.get(id)?.domain];

const KEY = 'polymath-graph.progress.v1';
const CUSTOM_GRAPH_KEY = 'polymath-graph.custom-graph.v1';

function loadCustomGraph() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_GRAPH_KEY)) ?? { nodes: [], links: [] };
  } catch {
    return { nodes: [], links: [] };
  }
}

function saveCustomGraph() {
  try {
    const customNodes = graph.nodes.filter((n) => n.custom);
    const customNodeIds = new Set(customNodes.map((n) => n.id));
    const customLinks = graph.links.filter((l) => {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      return customNodeIds.has(s) || customNodeIds.has(t);
    }).map((l) => ({
      source: typeof l.source === 'object' ? l.source.id : l.source,
      target: typeof l.target === 'object' ? l.target.id : l.target,
      relation: l.relation || 'influences',
    }));
    localStorage.setItem(CUSTOM_GRAPH_KEY, JSON.stringify({ nodes: customNodes, links: customLinks }));
  } catch { /* modo privado */ }
}

// Hidratar nodos personalizados guardados al iniciar
const _initialCustom = loadCustomGraph();
if (_initialCustom.nodes?.length) {
  _initialCustom.nodes.forEach((n) => {
    if (n && n.id && !nodeById.has(n.id) && graph.domains[n.domain]) {
      const cleanNode = { ...n, custom: true };
      graph.nodes.push(cleanNode);
      nodeById.set(cleanNode.id, cleanNode);
    }
  });
  (_initialCustom.links || []).forEach((l) => {
    if (l && nodeById.has(l.source) && nodeById.has(l.target)) {
      const exists = graph.links.some((x) => x.source === l.source && x.target === l.target);
      if (!exists) graph.links.push({ source: l.source, target: l.target, relation: l.relation || 'influences' });
    }
  });
}

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? { problems: {}, quiz: { right: 0, total: 0 }, visited: [] };
  } catch {
    return { problems: {}, quiz: { right: 0, total: 0 }, visited: [] };
  }
}
let data = load();
const save = () => {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* modo privado */ }
};

export const bus = new EventTarget();
const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

export function integrateGraphNodes(newNodes = [], newLinks = []) {
  const addedNodes = [];
  const addedLinks = [];

  newNodes.forEach((n) => {
    if (!n || !n.id) return;
    const domain = graph.domains[n.domain] ? n.domain : 'science';
    const nodeObj = {
      id: n.id,
      label: n.label || n.id,
      domain,
      complexity: Math.max(1, Math.min(5, Number(n.complexity) || 3)),
      year: n.year ?? 2026,
      authors: Array.isArray(n.authors) && n.authors.length ? n.authors : ['Documento del usuario'],
      summary: n.summary || '',
      custom: true,
    };
    if (!nodeById.has(nodeObj.id)) {
      graph.nodes.push(nodeObj);
      nodeById.set(nodeObj.id, nodeObj);
      addedNodes.push(nodeObj);
    } else if (nodeById.get(nodeObj.id).custom) {
      const existing = nodeById.get(nodeObj.id);
      Object.assign(existing, nodeObj);
      addedNodes.push(existing);
    }
  });

  newLinks.forEach((l) => {
    if (!l || !l.source || !l.target) return;
    const s = typeof l.source === 'object' ? l.source.id : l.source;
    const t = typeof l.target === 'object' ? l.target.id : l.target;
    if (!nodeById.has(s) || !nodeById.has(t) || s === t) return;
    const exists = graph.links.some((x) => {
      const xs = typeof x.source === 'object' ? x.source.id : x.source;
      const xt = typeof x.target === 'object' ? x.target.id : x.target;
      return xs === s && xt === t;
    });
    if (!exists) {
      const linkObj = { source: s, target: t, relation: graph.relations[l.relation] ? l.relation : 'influences' };
      graph.links.push(linkObj);
      addedLinks.push(linkObj);
    }
  });

  saveCustomGraph();
  emit('graph-updated', { nodes: addedNodes, links: addedLinks });
  return { nodes: addedNodes, links: addedLinks };
}

export function removeCustomNode(id) {
  const n = nodeById.get(id);
  if (!n || !n.custom) return false;
  nodeById.delete(id);
  const idx = graph.nodes.findIndex((x) => x.id === id);
  if (idx !== -1) graph.nodes.splice(idx, 1);
  for (let i = graph.links.length - 1; i >= 0; i--) {
    const l = graph.links[i];
    const s = typeof l.source === 'object' ? l.source.id : l.source;
    const t = typeof l.target === 'object' ? l.target.id : l.target;
    if (s === id || t === id) graph.links.splice(i, 1);
  }
  saveCustomGraph();
  emit('graph-updated', { removed: id });
  return true;
}

export function clearAllCustomNodes() {
  const customNodes = graph.nodes.filter((n) => n.custom);
  if (!customNodes.length) return 0;
  const customIds = new Set(customNodes.map((n) => n.id));

  for (let i = graph.nodes.length - 1; i >= 0; i--) {
    if (graph.nodes[i].custom) {
      nodeById.delete(graph.nodes[i].id);
      graph.nodes.splice(i, 1);
    }
  }

  for (let i = graph.links.length - 1; i >= 0; i--) {
    const l = graph.links[i];
    const s = typeof l.source === 'object' ? l.source.id : l.source;
    const t = typeof l.target === 'object' ? l.target.id : l.target;
    if (customIds.has(s) || customIds.has(t)) {
      graph.links.splice(i, 1);
    }
  }

  try {
    localStorage.removeItem(CUSTOM_GRAPH_KEY);
  } catch { /* modo privado */ }

  emit('graph-updated', { clearedAll: true, count: customIds.size });
  return customIds.size;
}

export const progress = {
  get: () => data,
  recordProblem(problemId, node, session, total) {
    data.problems[problemId] = { node, mastered: [...session.mastered], hints: { ...session.hintsUsed }, complete: session.mastered.length === total };
    save();
    emit('progress');
  },
  resetProblem(problemId) {
    delete data.problems[problemId];
    save();
    emit('progress');
  },
  problem: (id) => data.problems[id],
  masteredNodes: () => new Set(Object.values(data.problems).filter((p) => p.complete).map((p) => p.node)),
  quiz(right) {
    data.quiz.total += 1;
    if (right) data.quiz.right += 1;
    save();
    emit('progress');
  },
  visit(id) {
    if (!data.visited.includes(id)) { data.visited.push(id); save(); emit('progress'); }
  },
  reset() { data = { problems: {}, quiz: { right: 0, total: 0 }, visited: [] }; save(); emit('progress'); },
};

// Mazo de flashcards con repetición espaciada (solo localStorage)
const FC_KEY = 'polymath-graph.flashcards.v1';
function loadDeck() {
  try {
    const d = JSON.parse(localStorage.getItem(FC_KEY));
    if (d && Array.isArray(d.cards)) return { cards: d.cards, daily: d.daily || { date: '', newSeen: 0, reviews: 0 } };
  } catch { /* noop */ }
  return { cards: [], daily: { date: '', newSeen: 0, reviews: 0 } };
}
let deck = loadDeck();
const saveDeck = () => {
  try { localStorage.setItem(FC_KEY, JSON.stringify(deck)); } catch { /* modo privado */ }
};
const fcKey = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const dayStr = (now = Date.now()) => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const flashcards = {
  all: () => deck.cards,
  get: (id) => deck.cards.find((c) => c.id === id),
  has: (front) => deck.cards.some((c) => fcKey(c.front) === fcKey(front)),
  /** Añade tarjetas ya construidas (newCard) evitando duplicados por anverso. Devuelve las añadidas. */
  add(cards) {
    const keys = new Set(deck.cards.map((c) => fcKey(c.front)));
    const added = [];
    cards.forEach((c) => {
      const k = fcKey(c.front);
      if (!k || !c.back || keys.has(k)) return;
      keys.add(k);
      deck.cards.push(c);
      added.push(c);
    });
    if (added.length) { saveDeck(); emit('flashcards', { added: added.length }); }
    return added;
  },
  update(card) {
    const i = deck.cards.findIndex((c) => c.id === card.id);
    if (i === -1) return;
    deck.cards[i] = card;
    saveDeck();
    emit('flashcards', { updated: card.id });
  },
  remove(id) {
    const before = deck.cards.length;
    deck.cards = deck.cards.filter((c) => c.id !== id);
    if (deck.cards.length !== before) { saveDeck(); emit('flashcards', { removed: id }); }
  },
  clear() {
    deck = { cards: [], daily: { date: '', newSeen: 0, reviews: 0 } };
    saveDeck();
    emit('flashcards', { cleared: true });
  },
  /** Contadores del día: nuevas vistas y repasos (se reinician al cambiar de fecha). */
  daily(now = Date.now()) {
    const today = dayStr(now);
    if (deck.daily.date !== today) deck.daily = { date: today, newSeen: 0, reviews: 0 };
    return deck.daily;
  },
  recordReview(wasNew, now = Date.now()) {
    const d = flashcards.daily(now);
    d.reviews += 1;
    if (wasNew) d.newSeen += 1;
    saveDeck();
  },
};

// Navegación entre módulos
const navHandlers = [];
export const onNavigate = (fn) => navHandlers.push(fn);
export function navigate(tab, params = {}) {
  navHandlers.forEach((fn) => fn(tab, params));
}
export const openNode = (id) => navigate('graph', { node: id });

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}

export function nodeChip(id) {
  const n = nodeById.get(id);
  if (!n) return el('span', { class: 'node-chip', style: '--c:#7c8cff' }, id);
  const d = graph.domains[n.domain] || { color: '#7c8cff' };
  const label = n.custom ? `✦ ${n.label}` : n.label;
  return el('button', { class: 'node-chip', style: `--c:${d.color}`, title: n.summary, onclick: () => openNode(id) }, label);
}
