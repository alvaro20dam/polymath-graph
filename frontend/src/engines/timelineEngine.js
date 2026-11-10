// Motor del Navegador Temporal por Eras y Buscador de Puentes Transdisciplinarios
import graphData from '@data/graph.json';

export const HISTORICAL_ERAS = [
  {
    id: 'antiquity',
    name: 'Antigüedad Clásica & Helenismo',
    icon: '🏛️',
    startYear: -600,
    endYear: 500,
    color: '#7c8cff',
    paradigm: 'El nacimiento del logos, la mayéutica, la deducción y la democracia.',
    description: 'De los presocráticos y Pitágoras a Platón, Aristóteles, el Estoicismo y la Biblioteca de Alejandría.',
  },
  {
    id: 'medieval',
    name: 'Edad Media & Era Dorada Islámica',
    icon: '🕌',
    startYear: 501,
    endYear: 1400,
    color: '#38bdf8',
    paradigm: 'Preservación del canon, síntesis teológica y el nacimiento del álgebra y los algoritmos.',
    description: 'La Casa de la Sabiduría en Bagdad, Al-Juarismi, Avicena y la transmisión del saber grecolatino hacia Europa.',
  },
  {
    id: 'renaissance',
    name: 'Renacimiento & Revolución Científica',
    icon: '📜',
    startYear: 1401,
    endYear: 1700,
    color: '#f59e0b',
    paradigm: 'La matematización del cosmos, la imprenta móvil y el método experimental.',
    description: 'Gutenberg, la perspectiva lineal, Bacon, Galileo, Descartes, Newton y el cálculo infinitesimal.',
  },
  {
    id: 'enlightenment',
    name: 'Ilustración & Revolución Industrial',
    icon: '💡',
    startYear: 1701,
    endYear: 1900,
    color: '#34d399',
    paradigm: 'Razón crítica, cálculo de probabilidades, termodinámica y evolución natural.',
    description: 'Bayes, Hume, Kant, termodinámica y entropía, Darwin y la selección natural, y los primeros pasos del cómputo.',
  },
  {
    id: 'twentieth_century',
    name: 'Siglo XX: La Gran Convergencia',
    icon: '⚛️',
    startYear: 1901,
    endYear: 1980,
    color: '#f472b6',
    paradigm: 'Relatividad, indeterminación cuántica, teoría de la información y la mente computacional.',
    description: 'Einstein, Bohr, Gödel, Turing, Shannon, Popper, el nacimiento de la IA simbólica y el perceptrón.',
  },
  {
    id: 'digital_age',
    name: 'Era Digital & Redes Complejas',
    icon: '🌐',
    startYear: 1981,
    endYear: 2026,
    color: '#a78bfa',
    paradigm: 'Sistemas adaptativos, aprendizaje profundo, atención masiva e interconexión global.',
    description: 'Retropropagación, redes neuronales profundas, hipertexto, transformers y la emergencia de la IA generativa.',
  },
];

export const PRESET_BRIDGES = [
  {
    id: 'logic_to_ai',
    title: 'De la Lógica Aristotélica a los Transformers',
    icon: '🧠',
    source: 'aristotelian_logic',
    target: 'transformers',
    description: 'Cómo los silogismos deductivos del 350 a.C. derivaron, tras 2,360 años, en la autoatención y los modelos de lenguaje modernos.',
  },
  {
    id: 'socrates_to_turing',
    title: 'De la Mayéutica de Sócrates a la Máquina de Turing',
    icon: '🏛️',
    source: 'socratic_method',
    target: 'turing_machine',
    description: 'El examen dialéctico de reglas formales que anticipó en Atenas la noción de un procedimiento algorítmico universal.',
  },
  {
    id: 'stoicism_to_biases',
    title: 'Del Estoicismo a los Sesgos Cognitivos',
    icon: '⚖️',
    source: 'stoicism',
    target: 'cognitive_biases',
    description: 'El control de las representaciones y juicios en Epicteto y Marco Aurelio que inspiró la ciencia cognitiva de Kahneman y Tversky.',
  },
  {
    id: 'probability_to_nn',
    title: 'De la Probabilidad Clásica a las Redes Neuronales',
    icon: '🎲',
    source: 'probability',
    target: 'neural_networks',
    description: 'La formalización del azar por Fermat y Pascal en 1654 convertida en el aprendizaje probabilístico de arquitecturas conexionistas.',
  },
  {
    id: 'art_perspective_to_cubism',
    title: 'De la Perspectiva Renacentista al Cubismo',
    icon: '🎨',
    source: 'perspective_renaissance',
    target: 'cubism',
    description: 'La geometría del punto de fuga de Brunelleschi (1415) deconstruida cinco siglos después por Picasso y Braque en múltiples planos.',
  },
  {
    id: 'entropy_to_shannon',
    title: 'De la Entropía Termodinámica a la Teoría de la Información',
    icon: '⚡',
    source: 'thermodynamics_entropy',
    target: 'information_theory',
    description: 'La dispersión de energía y microestados de Boltzmann en 1850 resignificada por Claude Shannon en 1948 como el límite del código.',
  },
];

export function fmtYear(year) {
  if (typeof year !== 'number' || isNaN(year)) return '—';
  return year < 0 ? `${Math.abs(year)} a.C.` : `${year} d.C.`;
}

export function getEraForYear(year) {
  return HISTORICAL_ERAS.find((era) => year >= era.startYear && year <= era.endYear) || HISTORICAL_ERAS[0];
}

export function groupNodesByEra(nodesList = null) {
  const nodes = nodesList || graphData.nodes || [];
  return HISTORICAL_ERAS.map((era) => {
    const eraNodes = nodes.filter((n) => n.year >= era.startYear && n.year <= era.endYear);
    return {
      ...era,
      nodesCount: eraNodes.length,
      nodes: eraNodes,
    };
  });
}

/**
 * Encuentra el camino más corto (BFS no dirigido) entre dos nodos.
 */
function bfsShortestPath(sourceId, targetId, nodes, links) {
  if (sourceId === targetId) return [sourceId];
  const adj = new Map();
  nodes.forEach((n) => adj.set(n.id, new Set()));
  links.forEach((l) => {
    const s = typeof l.source === 'object' ? l.source.id : l.source;
    const t = typeof l.target === 'object' ? l.target.id : l.target;
    if (!adj.has(s)) adj.set(s, new Set());
    if (!adj.has(t)) adj.set(t, new Set());
    adj.get(s).add(t);
    adj.get(t).add(s);
  });

  if (!adj.has(sourceId) || !adj.has(targetId)) return null;

  const prev = new Map([[sourceId, null]]);
  const queue = [sourceId];

  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === targetId) break;
    const neighbors = adj.get(cur) || [];
    for (const nb of neighbors) {
      if (!prev.has(nb)) {
        prev.set(nb, cur);
        queue.push(nb);
      }
    }
  }

  if (!prev.has(targetId)) return null;

  const path = [];
  let curr = targetId;
  while (curr !== null) {
    path.unshift(curr);
    curr = prev.get(curr);
  }
  return path;
}

/**
 * Traza la genealogía ideológica y puente evolutivo entre dos conceptos.
 */
export function findIdeologicalBridge(sourceId, targetId, nodesList = null, linksList = null) {
  const nodes = nodesList || graphData.nodes || [];
  const links = linksList || graphData.links || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  if (!byId.has(sourceId) || !byId.has(targetId)) {
    throw new Error('Uno o ambos nodos no existen en el grafo de conocimiento.');
  }

  const sourceNode = byId.get(sourceId);
  const targetNode = byId.get(targetId);

  if (sourceId === targetId) {
    return {
      path: [sourceId],
      hops: 0,
      source: sourceNode,
      target: targetNode,
      totalYearsSpan: 0,
      steps: [],
      synthesis: `La idea «${sourceNode.label}» es el punto de inicio y desenlace.`,
    };
  }

  const path = bfsShortestPath(sourceId, targetId, nodes, links);
  if (!path || !path.length) {
    return {
      path: [],
      hops: null,
      source: sourceNode,
      target: targetNode,
      totalYearsSpan: targetNode.year - sourceNode.year,
      steps: [],
      synthesis: 'No existe un camino de conexión en la topología actual del grafo.',
    };
  }

  // Mapa de enlaces para extraer relaciones
  const linkMap = new Map();
  links.forEach((l) => {
    const s = typeof l.source === 'object' ? l.source.id : l.source;
    const t = typeof l.target === 'object' ? l.target.id : l.target;
    const rel = l.relation || 'conecta con';
    linkMap.set(`${s}::${t}`, rel);
    linkMap.set(`${t}::${s}`, rel);
  });

  const steps = [];
  for (let i = 0; i < path.length - 1; i++) {
    const uId = path[i];
    const vId = path[i + 1];
    const u = byId.get(uId);
    const v = byId.get(vId);
    const rel = linkMap.get(`${uId}::${vId}`) || 'interrelacionado';
    const deltaYears = v.year - u.year;
    const disciplineShift = u.domain !== v.domain;

    const annotation = disciplineShift
      ? `Salto interdisciplinario de ${u.domain} a ${v.domain} («${rel}»): transcurren ${Math.abs(deltaYears)} años.`
      : `Evolución dentro de ${u.domain} («${rel}»): ${Math.abs(deltaYears)} años de desarrollo.`;

    steps.push({
      fromNode: u,
      toNode: v,
      relation: rel,
      deltaYears,
      disciplineShift,
      annotation,
    });
  }

  const totalYearsSpan = targetNode.year - sourceNode.year;
  const involvedDomains = Array.from(new Set(path.map((nid) => byId.get(nid)?.domain).filter(Boolean)));
  const synthesis = `Puente de ${path.length - 1} salto(s) conceptuales entre «${sourceNode.label}» (${fmtYear(sourceNode.year)}) y «${targetNode.label}» (${fmtYear(targetNode.year)}), abarcando un viaje de ${Math.abs(totalYearsSpan)} años a través de ${involvedDomains.join(', ')}.`;

  return {
    path,
    hops: path.length - 1,
    source: sourceNode,
    target: targetNode,
    totalYearsSpan,
    steps,
    synthesis,
  };
}
