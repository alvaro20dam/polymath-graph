import './styles.css';
import { el, onNavigate } from './state.js';

const TABS = [
  { id: 'graph', label: 'Grafo', icon: '◉', load: () => import('./modules/graphView.js') },
  { id: 'tutor', label: 'Tutor socrático', icon: '❓', load: () => import('./modules/tutor.js') },
  { id: 'explainer', label: 'Explicador', icon: '📖', load: () => import('./modules/explainer.js') },
  { id: 'lab', label: 'Laboratorio', icon: '🧪', load: () => import('./modules/lab.js') },
  { id: 'logic', label: 'Lógica y falacias', icon: '⚖', load: () => import('./modules/logicView.js') },
  { id: 'timeline', label: 'Líneas de tiempo', icon: '⏳', load: () => import('./modules/timeline.js') },
];

const app = document.getElementById('app');
const tabsEl = document.getElementById('tabs');
const instances = new Map();
let current = null;

TABS.forEach((t) => {
  const btn = el('a', { class: 'tab', href: `#/${t.id}`, 'data-tab': t.id }, el('span', { class: 'tab-icon', 'aria-hidden': 'true' }, t.icon), el('span', { class: 'tab-label' }, t.label));
  tabsEl.append(btn);
});

async function show(tabId, params = {}) {
  const tab = TABS.find((t) => t.id === tabId) ?? TABS[0];
  if (current === tab.id && !Object.keys(params).length) return;
  // Oculta la pestaña actual
  if (current && instances.has(current)) {
    const prev = instances.get(current);
    prev.root.hidden = true;
    prev.api.hide?.();
  }
  current = tab.id;
  tabsEl.querySelectorAll('.tab').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab.id));
  let inst = instances.get(tab.id);
  if (!inst) {
    const root = el('section', { class: `view view-${tab.id}`, 'aria-label': tab.label }, el('div', { class: 'loading' }, 'Cargando…'));
    app.append(root);
    inst = { root, api: null, ready: null };
    instances.set(tab.id, inst);
    inst.ready = tab.load().then((mod) => {
      root.innerHTML = '';
      inst.api = mod.mount(root) ?? {};
    });
  }
  await inst.ready;
  if (current !== tab.id) return; // el usuario cambió de pestaña durante la carga
  inst.root.hidden = false;
  inst.api.show?.(params);
}

function parseHash() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  return { tab: path || 'graph', params: Object.fromEntries(new URLSearchParams(query)) };
}

window.addEventListener('hashchange', () => {
  const { tab, params } = parseHash();
  show(tab, params);
});

// Navegación programática: actualiza el hash sin recargar y muestra la pestaña
onNavigate((tab, params) => {
  const q = new URLSearchParams(params).toString();
  const target = `#/${tab}${q ? '?' + q : ''}`;
  if (location.hash === target) show(tab, params);
  else {
    history.replaceState(null, '', target);
    show(tab, params);
  }
});

const first = parseHash();
show(first.tab, first.params);
