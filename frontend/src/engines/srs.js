// Motor de repetición espaciada estilo Anki (SM-2 simplificado, determinista y sin dependencias).
// Estados: new → learning → review ⇄ relearning. Calificaciones: 1 Otra vez · 2 Difícil · 3 Bien · 4 Fácil.

export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export const SRS_CONFIG = {
  learningSteps: [1 * MIN, 10 * MIN],
  relearningStep: 10 * MIN,
  graduatingInterval: 1, // días
  easyInterval: 4, // días
  startingEase: 2.5,
  minEase: 1.3,
  newPerDay: 20,
  learnAhead: 20 * MIN,
  matureInterval: 21, // días
};

export const GRADES = [
  { grade: 1, key: 'again', label: 'Otra vez', shortcut: '1' },
  { grade: 2, key: 'hard', label: 'Difícil', shortcut: '2' },
  { grade: 3, key: 'good', label: 'Bien', shortcut: '3' },
  { grade: 4, key: 'easy', label: 'Fácil', shortcut: '4' },
];

const normFront = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const cardKey = (c) => normFront(c.front);

let _seq = 0;
export function newCard({ front, back, tags = [], source = 'manual', kind = 'qa' }, now = Date.now()) {
  _seq = (_seq + 1) % 1e6;
  return {
    id: `fc_${now.toString(36)}_${_seq.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    front: String(front || '').trim(),
    back: String(back || '').trim(),
    tags: [...new Set((tags || []).map((t) => String(t).trim()).filter(Boolean))],
    source,
    kind,
    createdAt: now,
    state: 'new',
    step: 0,
    due: now,
    interval: 0,
    ease: SRS_CONFIG.startingEase,
    reps: 0,
    lapses: 0,
    lastReview: null,
  };
}

/** Devuelve una copia de la tarjeta tras calificarla (no muta la original). */
export function review(card, grade, now = Date.now(), cfg = SRS_CONFIG) {
  const c = { ...card, reps: (card.reps || 0) + 1, lastReview: now };
  const steps = cfg.learningSteps;
  const toReview = (days) => {
    c.state = 'review';
    c.step = 0;
    c.interval = Math.max(1, Math.round(days));
    c.due = now + c.interval * DAY;
  };

  if (c.state === 'new' || c.state === 'learning') {
    const step = c.state === 'new' ? 0 : c.step || 0;
    c.state = 'learning';
    if (grade === 1) { c.step = 0; c.due = now + steps[0]; }
    else if (grade === 2) { c.step = step; c.due = now + (step === 0 && steps.length > 1 ? (steps[0] + steps[1]) / 2 : steps[Math.min(step, steps.length - 1)]); }
    else if (grade === 3) {
      if (step + 1 >= steps.length) toReview(cfg.graduatingInterval);
      else { c.step = step + 1; c.due = now + steps[step + 1]; }
    } else toReview(cfg.easyInterval);
    return c;
  }

  if (c.state === 'relearning') {
    if (grade <= 2) { c.due = now + cfg.relearningStep; return c; }
    toReview(grade === 4 ? (c.interval || 1) + 1 : c.interval || 1);
    return c;
  }

  // review
  const ivl = Math.max(1, c.interval || 1);
  if (grade === 1) {
    c.lapses = (c.lapses || 0) + 1;
    c.ease = Math.max(cfg.minEase, c.ease - 0.2);
    c.state = 'relearning';
    c.step = 0;
    c.interval = Math.max(1, Math.round(ivl * 0.5));
    c.due = now + cfg.relearningStep;
  } else if (grade === 2) {
    c.ease = Math.max(cfg.minEase, c.ease - 0.15);
    toReview(Math.max(ivl + 1, ivl * 1.2));
  } else if (grade === 3) {
    toReview(Math.max(ivl + 1, ivl * c.ease));
  } else {
    c.ease = c.ease + 0.15;
    toReview(Math.max(ivl + 1, ivl * c.ease * 1.3));
  }
  return c;
}

export function formatInterval(ms) {
  if (ms < MIN) return '<1 min';
  if (ms < HOUR) return `${Math.round(ms / MIN)} min`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} h`;
  const d = ms / DAY;
  if (d < 30) return `${Math.round(d)} d`;
  if (d < 365) return `${(d / 30).toFixed(d < 300 ? 1 : 0).replace(/\.0$/, '')} mes`;
  return `${(d / 365).toFixed(1).replace(/\.0$/, '')} años`;
}

/** Intervalo resultante para cada botón (como los rótulos de Anki). */
export function previewIntervals(card, now = Date.now()) {
  return Object.fromEntries(GRADES.map((g) => [g.grade, formatInterval(review(card, g.grade, now).due - now)]));
}

const todayStr = (now) => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export { todayStr };

/** Cola de estudio: aprendizaje/repaso vencidos + nuevas hasta el límite diario. */
export function buildQueue(cards, now = Date.now(), { newAllowance = SRS_CONFIG.newPerDay, learnAhead = SRS_CONFIG.learnAhead } = {}) {
  const learning = cards.filter((c) => (c.state === 'learning' || c.state === 'relearning') && c.due <= now + learnAhead);
  const reviews = cards.filter((c) => c.state === 'review' && c.due <= now);
  const fresh = cards.filter((c) => c.state === 'new').sort((a, b) => a.createdAt - b.createdAt).slice(0, Math.max(0, newAllowance));
  const dueNow = [...learning.filter((c) => c.due <= now), ...reviews].sort((a, b) => a.due - b.due);
  const ahead = learning.filter((c) => c.due > now).sort((a, b) => a.due - b.due);
  return [...dueNow, ...fresh, ...ahead];
}

export function deckStats(cards, now = Date.now(), newAllowance = SRS_CONFIG.newPerDay) {
  const s = { total: cards.length, new: 0, learning: 0, review: 0, mature: 0, dueReview: 0, dueLearning: 0, newToday: 0, nextDue: null };
  cards.forEach((c) => {
    if (c.state === 'new') s.new++;
    else if (c.state === 'review') {
      s.review++;
      if (c.interval >= SRS_CONFIG.matureInterval) s.mature++;
      if (c.due <= now) s.dueReview++;
    } else {
      s.learning++;
      if (c.due <= now + SRS_CONFIG.learnAhead) s.dueLearning++;
    }
    if (c.state !== 'new' && c.due > now && (s.nextDue == null || c.due < s.nextDue)) s.nextDue = c.due;
  });
  s.newToday = Math.min(s.new, Math.max(0, newAllowance));
  s.dueTotal = s.dueReview + s.dueLearning + s.newToday;
  return s;
}

// ---------------- Exportación compatible con Anki ----------------
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function toAnkiHtml(text) {
  return escHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\r?\n/g, '<br>');
}
const csvCell = (s) => `"${String(s).replace(/"/g, '""')}"`;
export const ankiTag = (t) => String(t).trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_').replace(/[^\w:-]/g, '');

/** CSV con cabeceras de Anki ≥ 2.1.55 (Archivo → Importar lo detecta automáticamente). */
export function toAnkiCsv(cards, deckName = 'Polymath Graph') {
  const lines = [
    '#separator:Comma',
    '#html:true',
    '#notetype:Basic',
    `#deck:${deckName}`,
    '#columns:Front,Back,Tags',
    '#tags column:3',
  ];
  cards.forEach((c) => {
    const tags = ['polymath', `polymath::${c.source || 'manual'}`, ...(c.tags || [])].map(ankiTag).filter(Boolean);
    lines.push([csvCell(toAnkiHtml(c.front)), csvCell(toAnkiHtml(c.back)), csvCell([...new Set(tags)].join(' '))].join(','));
  });
  return lines.join('\n') + '\n';
}
