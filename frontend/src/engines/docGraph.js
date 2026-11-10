// Motor de análisis de documentos y subgrafo semántico activo (Lector Aumentado Split-Screen)
import graphData from '@data/graph.json';
import thinkersData from '@data/thinkers.json';
import { norm } from './text.js';
import { terms } from './rag.js';

export const DOMAIN_COLORS = {
  philosophy: '#7c8cff',
  science: '#34d399',
  logic: '#f59e0b',
  technology: '#38bdf8',
  history: '#f472b6',
  art: '#a78bfa',
};

function escRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Calcula el camino más corto (BFS no dirigido) entre dos nodos del grafo.
 */
export function findShortestPath(sourceId, targetId, nodes, links) {
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
 * Analiza el texto de un documento y extrae los nodos, autores, párrafos mapeados y puentes transdisciplinarios.
 */
export function analyzeDocumentGraph(text, gData = null) {
  const sourceGraph = gData || graphData;
  const nodes = sourceGraph.nodes || [];
  const links = sourceGraph.links || [];
  const domains = sourceGraph.domains || {};
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const thinkers = thinkersData.thinkers || [];
  const thinkersByName = new Map(thinkers.map((t) => [norm(t.name), t]));

  // 1. Descomponer párrafos
  const clean = (text || '').trim();
  const rawParas = clean
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 10);
  const paras = rawParas.length ? rawParas : [clean];

  // 2. Preparar matchers de nodos
  const nodeMatchers = nodes.map((n) => {
    const lblNorm = norm(n.label);
    const aliases = [lblNorm];
    if (n.id.includes('_')) {
      aliases.push(norm(n.id.replace(/_/g, ' ')));
    }
    const patterns = [...new Set(aliases)]
      .filter((a) => a.length >= 3)
      .map((a) => new RegExp(`\\b${escRegex(a)}\\b`, 'gi'));
    return { id: n.id, node: n, patterns };
  });

  // 3. Preparar matchers de autores
  const authorMatchers = [];
  const seenAuthors = new Set();
  nodes.forEach((n) => {
    (n.authors || []).forEach((a) => {
      const aNorm = norm(a);
      if (aNorm && !seenAuthors.has(aNorm) && aNorm.length >= 3) {
        seenAuthors.add(aNorm);
        const th = thinkersByName.get(aNorm);
        authorMatchers.push({
          name: a,
          norm: aNorm,
          avatar: th?.avatar || '👤',
          nodeId: n.id,
          pattern: new RegExp(`\\b${escRegex(aNorm)}\\b`, 'gi'),
        });
      }
    });
  });

  const detectedNodeCounts = new Map();
  const detectedAuthorCounts = new Map();
  const paragraphsOut = [];

  // 4. Mapear cada párrafo
  paras.forEach((pText, pIdx) => {
    const pNorm = norm(pText);
    const pNodeIds = new Set();
    const pAuthors = [];

    // Nodos
    nodeMatchers.forEach((nm) => {
      for (const pat of nm.patterns) {
        pat.lastIndex = 0;
        if (pat.test(pNorm)) {
          pNodeIds.add(nm.id);
          detectedNodeCounts.set(nm.id, (detectedNodeCounts.get(nm.id) || 0) + 1);
          break;
        }
      }
    });

    // Autores
    authorMatchers.forEach((am) => {
      am.pattern.lastIndex = 0;
      if (am.pattern.test(pNorm)) {
        pAuthors.push({
          name: am.name,
          avatar: am.avatar,
          nodeId: am.nodeId,
        });
        pNodeIds.add(am.nodeId);
        detectedNodeCounts.set(am.nodeId, (detectedNodeCounts.get(am.nodeId) || 0) + 1);

        if (!detectedAuthorCounts.has(am.name)) {
          detectedAuthorCounts.set(am.name, {
            name: am.name,
            avatar: am.avatar,
            count: 0,
            nodes: new Set(),
          });
        }
        const aInfo = detectedAuthorCounts.get(am.name);
        aInfo.count += 1;
        aInfo.nodes.add(am.nodeId);
      }
    });

    paragraphsOut.push({
      index: pIdx,
      text: pText,
      nodeIds: Array.from(pNodeIds).sort(),
      authors: pAuthors,
    });
  });

  // Si se detectaron menos de 2 nodos, enriquecer con coincidencia de términos de resumen
  if (detectedNodeCounts.size < 2) {
    const docTokens = new Set(terms(clean));
    nodes.forEach((n) => {
      const summaryTokens = new Set(terms(`${n.label} ${n.summary}`));
      let overlap = 0;
      summaryTokens.forEach((t) => {
        if (docTokens.has(t)) overlap++;
      });
      if (overlap >= 3 && !detectedNodeCounts.has(n.id)) {
        detectedNodeCounts.set(n.id, 1);
      }
    });
  }

  // 5. Nodos puente (1-hop common neighbor) si hay nodos desconectados
  const bridgingNodes = new Set();
  const detList = Array.from(detectedNodeCounts.keys());
  if (detList.length >= 2) {
    const adj = new Map();
    nodes.forEach((n) => adj.set(n.id, new Set()));
    links.forEach((l) => {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      if (adj.has(s)) adj.get(s).add(t);
      if (adj.has(t)) adj.get(t).add(s);
    });

    for (let i = 0; i < detList.length; i++) {
      for (let j = i + 1; j < detList.length; j++) {
        const u = detList[i];
        const v = detList[j];
        if (!adj.get(u)?.has(v)) {
          const uNeighbors = adj.get(u) || new Set();
          const vNeighbors = adj.get(v) || new Set();
          const common = Array.from(uNeighbors).filter((x) => vNeighbors.has(x));
          if (common.length > 0) {
            common.sort((a, b) => (adj.get(b)?.size || 0) - (adj.get(a)?.size || 0));
            bridgingNodes.add(common[0]);
          }
        }
      }
    }
  }

  // 6. Ensamblar lista final de nodos del subgrafo
  const allSubgraphNodes = [];
  detectedNodeCounts.forEach((cnt, nid) => {
    if (byId.has(nid)) {
      allSubgraphNodes.push({
        ...byId.get(nid),
        mentions: cnt,
        isBridge: false,
      });
    }
  });

  bridgingNodes.forEach((bnId) => {
    if (!detectedNodeCounts.has(bnId) && byId.has(bnId)) {
      allSubgraphNodes.push({
        ...byId.get(bnId),
        mentions: 0,
        isBridge: true,
      });
    }
  });

  // 7. Enlaces del subgrafo
  const finalNodeIds = new Set(allSubgraphNodes.map((n) => n.id));
  const finalLinks = [];
  links.forEach((l) => {
    const s = typeof l.source === 'object' ? l.source.id : l.source;
    const t = typeof l.target === 'object' ? l.target.id : l.target;
    if (finalNodeIds.has(s) && finalNodeIds.has(t)) {
      finalLinks.push({
        source: s,
        target: t,
        relation: l.relation || 'relacionado',
      });
    }
  });

  // 8. Distribución por dominios
  const domainCounts = {};
  allSubgraphNodes.forEach((n) => {
    const d = n.domain || 'other';
    domainCounts[d] = (domainCounts[d] || 0) + 1;
  });

  const totalSubNodes = Math.max(1, allSubgraphNodes.length);
  const domainDistribution = {};
  Object.entries(domainCounts).forEach(([d, count]) => {
    domainDistribution[d] = {
      label: domains[d]?.label || d.charAt(0).toUpperCase() + d.slice(1),
      color: domains[d]?.color || DOMAIN_COLORS[d] || '#7c8cff',
      count,
      percentage: Math.round((count / totalSubNodes) * 1000) / 10,
    };
  });

  // 9. Puentes transdisciplinarios (caminos entre disciplinas diferentes)
  const bridgesOut = [];
  const directNodes = allSubgraphNodes.filter((n) => !n.isBridge);
  if (directNodes.length >= 2) {
    const pairsChecked = new Set();
    for (let i = 0; i < Math.min(directNodes.length, 8); i++) {
      for (let j = i + 1; j < Math.min(directNodes.length, 8); j++) {
        const u = directNodes[i];
        const v = directNodes[j];
        if (u.domain !== v.domain) {
          const pairKey = [u.id, v.id].sort().join('::');
          if (pairsChecked.has(pairKey)) continue;
          pairsChecked.add(pairKey);

          const path = findShortestPath(u.id, v.id, nodes, links);
          if (path && path.length >= 2) {
            bridgesOut.push({
              source: u.id,
              sourceLabel: u.label,
              sourceDomain: u.domain,
              target: v.id,
              targetLabel: v.label,
              targetDomain: v.domain,
              path,
              length: path.length - 1,
            });
          }
          if (bridgesOut.length >= 3) break;
        }
      }
      if (bridgesOut.length >= 3) break;
    }
  }

  // 10. Autores formateados
  const authorsOut = Array.from(detectedAuthorCounts.values()).map((a) => ({
    name: a.name,
    avatar: a.avatar,
    count: a.count,
    nodes: Array.from(a.nodes).sort(),
  }));
  authorsOut.sort((a, b) => b.count - a.count);

  return {
    detectedNodes: allSubgraphNodes,
    links: finalLinks,
    domainDistribution,
    paragraphs: paragraphsOut,
    bridges: bridgesOut,
    authors: authorsOut,
    stats: {
      totalNodes: allSubgraphNodes.length,
      directConcepts: detectedNodeCounts.size,
      bridgingConcepts: bridgingNodes.size,
      paragraphCount: paragraphsOut.length,
      authorCount: authorsOut.length,
    },
  };
}
