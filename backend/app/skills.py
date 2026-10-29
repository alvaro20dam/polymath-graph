"""AGY Skills Library — implementación Python de las herramientas de los agentes.

Cada función decorada con ``@skill`` queda registrada en ``SKILLS`` para que un orquestador
(AGY u otro) pueda descubrirla; la API FastAPI las expone como endpoints.
Los algoritmos son espejo exacto de los motores del frontend (frontend/src/engines).
"""
from __future__ import annotations

import math
import re
from collections import defaultdict, deque
from typing import Callable

from . import data
from .textutil import norm, norm_map, original_slice, rx, split_sentences, stem, terms

SKILLS: dict[str, Callable] = {}


def skill(fn: Callable) -> Callable:
    SKILLS[fn.__name__] = fn
    return fn


# ====================================================================
# GraphArchitect_Agent
# ====================================================================
@skill
def graph_node_builder(topic: str, domain: str, connected_nodes: list, *, complexity: int = 3, authors: list | None = None, summary: str = "", year: int | None = None) -> dict:
    """Crea un nodo enriquecido con atributos interdisciplinarios y aristas de conexión."""
    g = data.graph()
    if domain not in g["domains"]:
        raise ValueError(f"Dominio desconocido: {domain}")
    by_id = data.node_by_id()
    unknown = [c for c in connected_nodes if c not in by_id]
    if unknown:
        raise ValueError(f"Nodos conectados inexistentes: {unknown}")
    node_id = re.sub(r"[^a-z0-9]+", "_", norm(topic)).strip("_")
    node = {
        "id": node_id, "label": topic, "domain": domain, "complexity": max(1, min(5, complexity)),
        "year": year, "authors": authors or [], "summary": summary,
    }
    links = [{"source": node_id, "target": c, "relation": "influences"} for c in connected_nodes]
    cross = sorted({by_id[c]["domain"] for c in connected_nodes if by_id[c]["domain"] != domain})
    return {"node": node, "links": links, "cross_domain_links": cross, "valid": bool(authors) and bool(cross)}


@skill
def semantic_link_evaluator(graph: dict | None = None) -> list[str]:
    """Valida calidad del grafo: metadatos, grado mínimo y enlaces cruzados entre disciplinas."""
    g = graph or data.graph()
    by_id = {n["id"]: n for n in g["nodes"]}
    deg: dict[str, int] = defaultdict(int)
    cross: dict[str, int] = defaultdict(int)
    errs: list[str] = []
    seen = set()
    for l in g["links"]:
        s, t = l["source"], l["target"]
        if s not in by_id or t not in by_id:
            errs.append(f"arista con nodo inexistente: {s}->{t}")
            continue
        if (s, t) in seen:
            errs.append(f"arista duplicada: {s}->{t}")
        seen.add((s, t))
        deg[s] += 1
        deg[t] += 1
        if by_id[s]["domain"] != by_id[t]["domain"]:
            cross[s] += 1
            cross[t] += 1
    for n in g["nodes"]:
        if not n.get("authors"):
            errs.append(f"sin autores: {n['id']}")
        if not 1 <= n["complexity"] <= 5:
            errs.append(f"complejidad inválida: {n['id']}")
        if deg[n["id"]] < 2:
            errs.append(f"grado < 2: {n['id']}")
        if cross[n["id"]] < 1:
            errs.append(f"sin enlace cruzado: {n['id']}")
    return errs


@skill
def citation_network_mapper(source: str, target: str) -> list[str] | None:
    """Camino más corto (no dirigido) entre dos ideas: la 'madriguera' que las conecta."""
    by_id = data.node_by_id()
    if source not in by_id or target not in by_id:
        raise KeyError("nodo inexistente")
    adj: dict[str, set] = defaultdict(set)
    for l in data.graph()["links"]:
        adj[l["source"]].add(l["target"])
        adj[l["target"]].add(l["source"])
    prev = {source: None}
    q = deque([source])
    while q:
        cur = q.popleft()
        if cur == target:
            break
        for nb in adj[cur]:
            if nb not in prev:
                prev[nb] = cur
                q.append(nb)
    if target not in prev:
        return None
    path, c = [], target
    while c is not None:
        path.append(c)
        c = prev[c]
    return path[::-1]


# ====================================================================
# DevOps_Orchestrator_Agent — vector_search_indexer (TF-IDF)
# ====================================================================
class TfidfIndex:
    def __init__(self, docs: list[dict]):
        self.docs = docs
        df: dict[str, int] = defaultdict(int)
        toks = [terms(d["text"]) for d in docs]
        for t in toks:
            for w in set(t):
                df[w] += 1
        self.n = len(docs)
        self.df = df
        self.vectors = []
        for t in toks:
            tf: dict[str, int] = defaultdict(int)
            for w in t:
                tf[w] += 1
            v = {w: (1 + math.log(c)) * self.idf(w) for w, c in tf.items()}
            nrm = math.sqrt(sum(x * x for x in v.values())) or 1.0
            self.vectors.append({w: x / nrm for w, x in v.items()})

    def idf(self, w: str) -> float:
        return math.log((self.n + 1) / (self.df.get(w, 0) + 1)) + 1

    def search(self, query: str, k: int = 5) -> list[dict]:
        qt = terms(query)
        if not qt:
            return []
        tf: dict[str, int] = defaultdict(int)
        for w in qt:
            tf[w] += 1
        q = {w: (1 + math.log(c)) * self.idf(w) for w, c in tf.items()}
        qn = math.sqrt(sum(x * x for x in q.values())) or 1.0
        out = []
        for doc, v in zip(self.docs, self.vectors):
            shared = [w for w in q if w in v]
            dot = sum((q[w] / qn) * v[w] for w in shared)
            if dot > 0:
                out.append({"doc": doc, "score": dot, "shared": shared})
        return sorted(out, key=lambda r: -r["score"])[:k]


def chunk_text(text: str, max_chars: int = 420) -> list[str]:
    out: list[str] = []
    for p in (x.strip() for x in re.split(r"\n+", text)):
        if not p:
            continue
        if len(p) <= max_chars:
            out.append(p)
            continue
        cur = ""
        for s in split_sentences(p):
            if len(cur + " " + s) > max_chars and cur:
                out.append(cur.strip())
                cur = s
            else:
                cur += " " + s
        if cur.strip():
            out.append(cur.strip())
    return out


_graph_index: TfidfIndex | None = None


@skill
def vector_search_indexer(query: str, k: int = 5) -> list[dict]:
    """Búsqueda semántica ligera (TF-IDF + coseno) sobre los nodos del grafo."""
    global _graph_index
    if _graph_index is None:
        g = data.graph()
        _graph_index = TfidfIndex([
            {"id": n["id"], "text": f"{n['label']} {n['label']} {n['label']} {' '.join(n['authors'])} {g['domains'][n['domain']]['label']} {n['summary']}"}
            for n in g["nodes"]
        ])
    return [{"id": r["doc"]["id"], "score": round(r["score"], 4)} for r in _graph_index.search(query, k)]


@skill
def document_qa(text: str, question: str, k: int = 3) -> dict:
    """RAG extractivo: devuelve los pasajes más relevantes de un documento para una pregunta."""
    idx = TfidfIndex([{"id": i, "text": t} for i, t in enumerate(chunk_text(text))])
    hits = [h for h in idx.search(question, k) if h["score"] > 0.05]
    return {"found": bool(hits), "passages": [{"text": h["doc"]["text"], "score": round(h["score"], 4), "terms": h["shared"]} for h in hits]}


# ====================================================================
# LogicVerifier_Agent
# ====================================================================
_CATALOG = data.load("fallacies")
_CF = [(f, [rx(p) for p in f["patterns"]]) for f in _CATALOG["fallacies"]]
_CB = [(b, [rx(p) for p in b["patterns"]]) for b in _CATALOG["biases"]]
_CONCL = re.compile(r"^(por lo tanto|por ende|por consiguiente|luego|asi que|entonces|en conclusion|de ahi que|therefore|thus|hence|consequently|so|in conclusion)[\s,:]+", re.I)
_PREM_MID = re.compile(r"[,\s]+(porque|dado que|puesto que|ya que|because|since|given that)\s+", re.I)
_IF = re.compile(r"^(?:si|if)\s+(.+?)(?:\s*,\s*|\s+entonces\s+|\s+then\s+)(.+?)[.!?]*$")
_NEG = re.compile(r"(^|\s)(no|not|never|nunca|jamas|tampoco)\s|n't\b")


def _scan(text: str, compiled: list) -> list[dict]:
    n, idx = norm_map(text)
    found = []
    for item, regs in compiled:
        ev: list[str] = []
        for r in regs:
            m = r.search(n)
            if m and m.end() > m.start():
                snip = original_slice(text, idx, m.start(), m.end(), 10)
                if snip not in ev:
                    ev.append(snip)
        if ev:
            found.append({**{k: v for k, v in item.items() if k != "patterns"}, "evidence": ev})
    return found


def _stems(s: str) -> set[str]:
    return {t[:4] for t in terms(s)}


def _score(a: set, b: set) -> float:
    return len(a & b) / min(len(a), len(b)) if a and b else 0.0


def _detect_formal(text: str) -> list[dict]:
    orig = split_sentences(text)
    sents = [norm(s).strip() for s in orig]
    i = next((k for k, s in enumerate(sents) if _IF.match(s)), -1)
    if i < 0 or len(sents) - i < 3 or not _CONCL.match(sents[-1]):
        return []
    a, c = _IF.match(sents[i]).groups()
    premise, concl = sents[i + 1], _CONCL.sub("", sents[-1], count=1)
    A, C, P, Q = _stems(a), _stems(c), _stems(premise), _stems(concl)
    p_neg, q_neg = bool(_NEG.search(" " + premise + " ")), bool(_NEG.search(" " + concl + " "))
    ev = " ".join([orig[i], orig[i + 1], orig[-1]])
    by = {f["id"]: f for f in _CATALOG["fallacies"]}
    out = []
    strip = lambda f: {k: v for k, v in f.items() if k != "patterns"}
    if not p_neg and not q_neg and _score(P, C) >= .5 and _score(P, C) > _score(P, A) and _score(Q, A) >= .5:
        out.append({**strip(by["affirming_consequent"]), "evidence": [ev]})
    if p_neg and q_neg and _score(P, A) >= .5 and _score(P, A) > _score(P, C) and _score(Q, C) >= .5:
        out.append({**strip(by["denying_antecedent"]), "evidence": [ev]})
    return out


@skill
def fallacy_checker(argument_text: str) -> dict:
    """Analiza el argumento e identifica falacias lógicas o sesgos cognitivos presentes."""
    fallacies = _scan(argument_text, _CF)
    for f in _detect_formal(argument_text):
        if not any(x["id"] == f["id"] for x in fallacies):
            fallacies.append(f)
    biases = _scan(argument_text, _CB)
    structure = argument_structure_parser(argument_text)
    rigor = max(0, 100 - 20 * len(fallacies) - 10 * len(biases))
    return {"fallacies": fallacies, "biases": biases, "structure": structure, "rigor": rigor}


@skill
def bias_detector(text: str) -> list[dict]:
    """Detecta sesgos cognitivos por patrones léxicos."""
    return _scan(text, _CB)


@skill
def argument_structure_parser(text: str) -> dict:
    """Separa premisas y conclusión usando indicadores lingüísticos."""
    premises, conclusions = [], []
    for s in split_sentences(text):
        clean = norm(s)
        m = _CONCL.match(clean)
        if m:
            conclusions.append(s[m.end():].strip())
            continue
        mid = _PREM_MID.search(clean)
        if mid:
            conclusions.append(s[: mid.start()].strip())
            premises.append(s[mid.end():].strip())
            continue
        premises.append(s)
    inferred = False
    if not conclusions and len(premises) > 1:
        conclusions.append(premises.pop())
        inferred = True
    return {"premises": premises, "conclusions": conclusions, "inferred": inferred}


# ====================================================================
# SocraticTutor_Agent — sesiones sin estado (el cliente las devuelve en cada llamada)
# ====================================================================
_PROBLEMS = {p["id"]: p for p in data.load("socratic")["problems"]}
_HINT_OFFSET = {"beginner": 0, "intermediate": 0, "expert": 1}
_COMPILED: dict[str, dict] = {}


def _compiled(problem: dict) -> dict:
    if problem["id"] not in _COMPILED:
        _COMPILED[problem["id"]] = {
            "concepts": [(c, [rx(k) for k in c["keywords"]]) for c in problem["concepts"]],
            "mis": [(rx(m["pattern"]), m["response"]) for m in problem.get("misconceptions", [])],
        }
    return _COMPILED[problem["id"]]


def new_session(problem_id: str, level: str = "intermediate") -> dict:
    if problem_id not in _PROBLEMS:
        raise KeyError(problem_id)
    return {"problem_id": problem_id, "level": level, "mastered": [], "hints_used": {}, "attempts": 0, "misconceptions": 0}


def list_problems() -> list[dict]:
    return [{k: p[k] for k in ("id", "title", "prompt", "node", "level", "steps")} | {"concepts": len(p["concepts"])} for p in _PROBLEMS.values()]


@skill
def socratic_hint_generator(user_input: str, current_concept: str, student_level: str, *, session: dict | None = None) -> str:
    """Genera una pregunta socrática o pista ligera ajustada al nivel pedagógico.

    ``current_concept`` es el id del problema; nunca devuelve la solución, solo
    la siguiente pregunta guiada o una pista progresiva.
    """
    session = session or new_session(current_concept, student_level)
    session["level"] = student_level
    if user_input.strip():
        return socratic_evaluate(session, user_input)["message"]
    return socratic_hint(session)["message"]


def socratic_evaluate(session: dict, text: str) -> dict:
    problem = _PROBLEMS[session["problem_id"]]
    comp = _compiled(problem)
    clean = norm(text)
    session["attempts"] += 1
    newly = []
    for c, regs in comp["concepts"]:
        if c["id"] in session["mastered"]:
            continue
        if any(r.search(clean) for r in regs):
            session["mastered"].append(c["id"])
            newly.append(c)
    missing = [c for c in problem["concepts"] if c["id"] not in session["mastered"]]
    mastery = len(session["mastered"]) / len(problem["concepts"])
    base = {"newly": [c["name"] for c in newly], "missing": len(missing), "mastery": mastery}
    if len(clean.strip()) < 12 and not newly:
        return {**base, "kind": "empty", "message": f"Escribe un poco más: ¿cuál sería tu primer paso?\n\n{missing[0]['question']}", "session": session}
    for r, response in comp["mis"]:
        if r.search(clean):
            session["misconceptions"] += 1
            return {**base, "kind": "misconception", "message": response, "session": session}
    if not missing:
        return {**base, "kind": "complete", "message": f"¡Lo construiste tú mismo! Síntesis: {problem['synthesis']}", "session": session}
    praise = f"Bien: ya apareció {' y '.join('«' + c['name'] + '»' for c in newly)}. " if newly else "Todavía no veo ese paso en tu razonamiento. "
    return {**base, "kind": "progress", "message": f"{praise}Sigamos con una pregunta:\n\n{missing[0]['question']}", "session": session}


def socratic_hint(session: dict) -> dict:
    problem = _PROBLEMS[session["problem_id"]]
    missing = [c for c in problem["concepts"] if c["id"] not in session["mastered"]]
    if not missing:
        return {"exhausted": True, "message": "Ya dominaste todos los conceptos.", "level": 0, "total": 0, "session": session}
    c = missing[0]
    used = session["hints_used"].get(c["id"], 0)
    idx = used + _HINT_OFFSET.get(session["level"], 0)
    if idx >= len(c["hints"]):
        return {"exhausted": True, "level": len(c["hints"]), "total": len(c["hints"]), "session": session,
                "message": f"Ya agotaste las pistas del paso «{c['name']}». Dibuja el caso, explora el nodo relacionado en el grafo o usa un simulador y cuéntame qué observas."}
    session["hints_used"][c["id"]] = used + 1
    return {"exhausted": False, "level": idx + 1, "total": len(c["hints"]), "message": c["hints"][idx], "session": session}


@skill
def mastery_gap_analyzer(session: dict) -> list[dict]:
    """Brechas por concepto: dominado, frágil (muchas pistas) o brecha."""
    problem = _PROBLEMS[session["problem_id"]]
    out = []
    for c in problem["concepts"]:
        mastered = c["id"] in session["mastered"]
        hints = session["hints_used"].get(c["id"], 0)
        out.append({"id": c["id"], "name": c["name"], "hints": hints, "status": "brecha" if not mastered else ("frágil" if hints >= 2 else "dominado")})
    return out


@skill
def adaptive_complexity_scaler(session: dict) -> dict:
    """Plan de estudio + nivel recomendado del siguiente problema."""
    problem = _PROBLEMS[session["problem_id"]]
    gaps = [g for g in mastery_gap_analyzer(session) if g["status"] != "dominado"]
    total_hints = sum(session["hints_used"].values())
    done = len(session["mastered"]) == len(problem["concepts"])
    nxt = problem["level"]
    if done and total_hints <= 1 and session["misconceptions"] == 0:
        nxt = min(5, nxt + 1)
    elif not done or total_hints >= 4 or session["misconceptions"] >= 2:
        nxt = max(1, nxt - 1)
    cands = sorted((p for p in _PROBLEMS.values() if p["id"] != problem["id"]), key=lambda p: abs(p["level"] - nxt))
    return {"gaps": gaps, "related_nodes": problem["related"], "next_level": nxt, "suggested_problem": cands[0]["id"] if cands else None}


# ====================================================================
# Explicador (Explainpaper)
# ====================================================================
_GLOSS = data.load("glossary")


def _alias_re(alias: str) -> re.Pattern:
    a = norm(alias)
    start = r"\b" if re.match(r"[a-z0-9]", a) else ""
    end = r"\b" if re.search(r"[a-z0-9]$", a) else ""
    return re.compile(start + re.escape(a) + end, re.I)


_TERMS = [(t, [_alias_re(a) for a in t["aliases"]]) for t in _GLOSS["terms"]]
_JARGON = [(w, m, _alias_re(w)) for lang in ("es", "en") for w, m in _GLOSS["jargon"][lang]]


@skill
def explainpaper_highlighter(selected_text: str, context: str = "", target_level: str = "beginner", lang: str = "es") -> dict:
    """Explica un fragmento de texto o fórmula ajustando la complejidad (beginner|intermediate|expert)."""
    if target_level not in ("beginner", "intermediate", "expert") or lang not in ("es", "en"):
        raise ValueError("nivel o idioma inválido")
    source = selected_text.strip() or context
    n, _ = norm_map(source)
    cards, seen = [], set()
    spans = []
    for t, regs in _TERMS:
        for r in regs:
            for m in r.finditer(n):
                if m.end() > m.start():
                    spans.append((m.start(), t["id"]))
    for _, ref in sorted(spans):
        if ref in seen:
            continue
        seen.add(ref)
        t = next(x for x, _ in _TERMS if x["id"] == ref)
        cards.append({"id": ref, "node": t["node"], "text": t[lang][target_level]})
    jargon, jseen = [], set()
    for w, meaning, r in _JARGON:
        if r.search(n) and w not in jseen:
            jseen.add(w)
            jargon.append({"word": w, "meaning": meaning})
    n, idx = norm_map(source)
    simplified = None
    if target_level != "expert" and jargon:
        spans = sorted((m.start(), m.end(), meaning) for _, meaning, r in _JARGON for m in r.finditer(n) if m.end() > m.start())
        parts, pos, last = [], 0, -1
        for s, e, meaning in spans:
            if s < last:
                continue
            a, b = idx[s], idx[e - 1] + 1
            parts += [source[pos:a], f"{source[a:b]} ({meaning})"]
            pos, last = b, e
        parts.append(source[pos:])
        simplified = "".join(parts)
    return {"source": source, "terms": cards, "jargon": jargon, "simplified": simplified, "related": [c["node"] for c in cards]}
