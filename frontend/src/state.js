// Estado compartido: progreso del estudiante (solo localStorage, sin cuentas) y utilidades de navegación.
import graph from '@data/graph.json';

export { graph };
export const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
export const domainOf = (id) => graph.domains[nodeById.get(id)?.domain];

const KEY = 'polymath-graph.progress.v1';

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
  const d = graph.domains[n.domain];
  return el('button', { class: 'node-chip', style: `--c:${d.color}`, title: n.summary, onclick: () => openNode(id) }, n.label);
}
