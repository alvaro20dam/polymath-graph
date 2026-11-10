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
def extract_graph_nodes_from_text(text: str, max_nodes: int = 3) -> dict:
    """Extrae heurísticamente de 1 a max_nodes conceptos clave de un documento y los enlaza al grafo."""
    by_id = data.node_by_id()
    paragraphs = [p.strip() for p in re.split(r"\n{2,}", text.strip()) if len(p.strip()) >= 25]
    if not paragraphs:
        paragraphs = [s.strip() for s in split_sentences(text) if len(s.strip()) >= 15]
    if not paragraphs:
        paragraphs = [text.strip()]

    nodes_out: list[dict] = []
    links_out: list[dict] = []
    seen_ids: set[str] = set(by_id.keys())

    fallback_hubs = ["critical_thinking", "scientific_method", "information_theory", "epistemology"]

    for idx, para in enumerate(paragraphs[: max_nodes * 2]):
        if len(nodes_out) >= max_nodes:
            break
        sents = split_sentences(para)
        first_sent = sents[0] if sents else para[:140]
        toks = [w for w in terms(first_sent) if len(w) >= 4]
        if not toks:
            toks = [w for w in terms(para) if len(w) >= 4]
        if not toks:
            continue

        raw_topic = " ".join(toks[:3]).capitalize()
        cand_id = re.sub(r"[^a-z0-9]+", "_", norm(raw_topic)).strip("_")
        if not cand_id or cand_id in seen_ids:
            raw_topic = f"{raw_topic} (Concepto {idx + 1})"
            cand_id = re.sub(r"[^a-z0-9]+", "_", norm(raw_topic)).strip("_")
        if cand_id in seen_ids:
            continue

        hits = vector_search_indexer(para, k=5)
        conn_ids = [h["id"] for h in hits if h["id"] in by_id]
        for hub in fallback_hubs:
            if len(conn_ids) < 3 and hub not in conn_ids and hub in by_id:
                conn_ids.append(hub)

        primary_domain = by_id[conn_ids[0]]["domain"] if conn_ids else "science"
        if not any(by_id[c]["domain"] != primary_domain for c in conn_ids):
            cross_hub = "critical_thinking" if primary_domain != "philosophy" else "scientific_method"
            if cross_hub not in conn_ids:
                conn_ids.append(cross_hub)

        conn_ids = conn_ids[:3]
        summary = first_sent if len(first_sent) <= 220 else first_sent[:217] + "..."
        built = graph_node_builder(
            topic=raw_topic,
            domain=primary_domain,
            connected_nodes=conn_ids,
            complexity=3,
            authors=["Documento del usuario"],
            summary=summary,
            year=2026,
        )
        node_obj = {**built["node"], "custom": True}
        seen_ids.add(node_obj["id"])
        nodes_out.append(node_obj)
        links_out.extend(built["links"])

    return {"nodes": nodes_out, "links": links_out, "engine": "heuristic"}



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


@skill
def generate_flashcards(text: str, max_cards: int = 8, level: str = "intermediate", lang: str = "es") -> dict:
    """Genera tarjetas de estudio (pregunta/respuesta) deterministas a partir de términos del glosario y definiciones."""
    snippet = text.strip()
    if not snippet:
        return {"cards": [], "engine": "heuristic"}

    cards = []
    seen = set()
    n = norm(snippet)

    # 1. Términos del glosario presentes
    for t, regs in _TERMS:
        for r in regs:
            if r.search(n):
                lbl = t["aliases"][0]
                front = f"¿Qué es **{lbl}**?" if lang == "es" else f"What is **{lbl}**?"
                back = t.get(lang, {}).get(level) or t.get("es", {}).get(level, "")
                if back and front not in seen:
                    seen.add(front)
                    cards.append({"front": front, "back": back, "tags": ["glosario", t["node"]], "kind": "qa"})
                break

    # 2. Oraciones definitorias («X es/son...»)
    def_re = re.compile(r"^(.{3,60}?)\s+(es|son|era|fue|se define como|se denomina|consiste en|significa|mide|describe)\s+(.{15,})$", re.I)
    bad_subj = re.compile(r"^(esto|eso|esta|este|ello|aquello|lo que|el resultado|la respuesta)$", re.I)
    for sent in split_sentences(snippet):
        m = def_re.match(sent.strip())
        if m:
            subj = re.sub(r"^(el|la|los|las|un|una)\s+", "", m.group(1).strip(), flags=re.I)
            if len(subj.split()) <= 6 and not bad_subj.match(subj) and len(subj) >= 3:
                verb = m.group(2).lower()
                q = f"¿Qué {verb} **{subj}**?" if " " not in verb else f"¿Cómo se define **{subj}**?"
                if q not in seen:
                    seen.add(q)
                    cards.append({"front": q, "back": sent.strip(), "tags": ["definicion"], "kind": "qa"})

    # 3. Cloze (hueco en oraciones informativas)
    if len(cards) < max_cards:
        for sent in split_sentences(snippet):
            if 50 <= len(sent) <= 220:
                words = re.findall(r"\b[A-Za-zÁÉÍÓÚáéíóúñÑ0-9]{5,}\b", sent)
                if words:
                    best = max(words, key=len)
                    cloze_front = re.sub(rf"\b{re.escape(best)}\b", "_____", sent, count=1)
                    if cloze_front != sent and cloze_front not in seen:
                        seen.add(cloze_front)
                        cards.append({"front": f"Completa: {cloze_front}", "back": f"**{best}**\n\n{sent}", "tags": ["cloze"], "kind": "cloze"})
                        if len(cards) >= max_cards:
                            break

    return {"cards": cards[:max_cards], "engine": "heuristic"}


@skill
def debate_turn_heuristic(
    thinker_id: str,
    opponent_id: str,
    topic: str,
    history: list[dict] | None = None,
    user_intervention: str | None = None,
) -> dict:
    """Genera una réplica dialéctica determinista cuando no hay conexión a IA."""
    history = history or []
    catalog = data.load("thinkers")
    thinkers_by_id = {t["id"]: t for t in catalog["thinkers"]}
    thinker = thinkers_by_id.get(thinker_id, {"name": thinker_id.capitalize(), "avatar": "🏛️", "core_stance": "Análisis racional."})
    opponent = thinkers_by_id.get(opponent_id, {"name": opponent_id.capitalize(), "avatar": "📜", "core_stance": "Crítica dialéctica."})

    t_name = thinker["name"]
    op_name = opponent["name"]
    stance = thinker.get("core_stance", "")

    # Determinar si es apertura, réplica u objeción a intervención del usuario
    if user_intervention:
        text = (
            f"Agradezco la agudeza de tu intervención. Precisamente mi postura sostiene que {stance} "
            f"Al plantear «{user_intervention.strip()}», debemos recordar que el error estriba en no examinar "
            f"los supuestos que damos por sentados. Mi estimado colega {op_name} soslaya esta distinción fundamental."
        )
    elif not history:
        text = (
            f"Para abordar «{topic}», debemos situar la cuestión en sus cimientos más sólidos. "
            f"Mi tesis central es clara: {stance} "
            f"Cualquier intento de evadir esta premisa nos conducirá a contradicciones irresolubles. "
            f"Escuchemos qué objeción tiene mi distinguido interlocutor, {op_name}."
        )
    else:
        last_turn = history[-1].get("text", "")
        text = (
            f"Comprendo la seducción del argumento de {op_name}, pero incurre en una petición de principio. "
            f"Afirma que la cuestión se resuelve desde su perspectiva, cuando en verdad: {stance} "
            f"Por consiguiente, respecto a «{topic}», sostengo que no podemos reducir el problema a lo que plantea {op_name} "
            f"sin antes resolver el problema epistémico de fondo."
        )

    # Auditar con el motor de falacias para evaluar rigor
    audit = fallacy_checker(text)
    return {
        "speaker": thinker_id,
        "name": t_name,
        "avatar": thinker.get("avatar", "🏛️"),
        "text": text,
        "rigor": 85,
        "fallacies": audit.get("fallacies", []),
        "key_concept": thinker.get("nodes", ["critical_thinking"])[0],
        "engine": "heuristic",
    }


@skill
def get_challenges_bank() -> list[dict]:
    """Carga el banco curado de desafíos interdisciplinarios."""
    try:
        return data.load("challenges").get("challenges", [])
    except Exception:
        return []


@skill
def generate_challenge_heuristic(domain1: str = "any", domain2: str = "any", level: str = "intermediate") -> dict:
    """Devuelve un desafío del banco filtrado por disciplinas o nivel con motor heurístico."""
    bank = get_challenges_bank()
    if not bank:
        return {
            "id": "entropy_and_shannon",
            "title": "El demonio de Maxwell y la información física",
            "domains": ["science", "technology"],
            "nodes": ["entropy", "information_theory"],
            "level": "intermediate",
            "question": "¿Por qué el experimento del Demonio de Maxwell necesitó la teoría de la información para preservar la segunda ley de la termodinámica?",
            "options": [
                "Porque borrar un bit de memoria disipa calor inevitablemente (kT ln 2), compensando la entropía reducida.",
                "Porque el demonio viola la conservación del momento lineal.",
                "Porque los sistemas cerrados no admiten observadores biológicos.",
                "Porque la entropía no aplica a partículas microscópicas."
            ],
            "correct": 0,
            "explanation": "El principio de Landauer demostró que la información es física y que el borrado de memoria disipa calor.",
            "xp": 50,
            "engine": "heuristic",
        }

    # Filtrar según coincidencia de dominio
    matches = []
    for c in bank:
        c_doms = c.get("domains", [])
        d1_ok = domain1 == "any" or domain1 in c_doms
        d2_ok = domain2 == "any" or domain2 in c_doms
        if d1_ok and d2_ok:
            matches.append(c)

    chosen = matches[0] if matches else bank[0]
    return {**chosen, "engine": "heuristic"}


@skill
def evaluate_challenge_heuristic(
    challenge_id: str,
    question: str,
    user_answer: str,
    user_reasoning: str = "",
    expected_explanation: str = "",
    domains: list[str] | None = None,
) -> dict:
    """Evalúa la respuesta y el razonamiento del estudiante en un desafío interdisciplinario."""
    domains = domains or ["philosophy", "science"]
    bank = {c["id"]: c for c in get_challenges_bank()}
    base_ch = bank.get(challenge_id)

    is_correct = False
    correct_idx = base_ch.get("correct") if base_ch else 0
    if base_ch and "options" in base_ch and 0 <= correct_idx < len(base_ch["options"]):
        expected_text = base_ch["options"][correct_idx]
        is_correct = user_answer.strip().lower() == expected_text.strip().lower() or user_answer.strip() == str(correct_idx)

    # Si fue pregunta abierta o razonamiento libre
    if not base_ch and expected_explanation:
        toks_exp = set(terms(expected_explanation))
        toks_user = set(terms(f"{user_answer} {user_reasoning}"))
        overlap = len(toks_exp & toks_user) / max(1, len(toks_exp))
        is_correct = overlap >= 0.25

    xp_awarded = (base_ch.get("xp", 50) if is_correct else 15) if base_ch else (50 if is_correct else 15)
    audit = fallacy_checker(f"{user_answer}. {user_reasoning}")

    feedback = (
        f"¡Brillante razonamiento interdisciplinario! Has conectado con precisión los principios de {' y '.join(domains)}."
        if is_correct
        else f"Buen intento de conexión conceptual. Sin embargo, el punto clave radica en que {expected_explanation or base_ch.get('explanation', '')}"
    )

    return {
        "is_correct": is_correct,
        "score": 95 if is_correct else 45,
        "xp": xp_awarded,
        "feedback": feedback,
        "explanation": expected_explanation or (base_ch.get("explanation", "") if base_ch else ""),
        "fallacies": audit.get("fallacies", []),
        "domains": domains,
        "suggested_nodes": base_ch.get("nodes", ["critical_thinking"]) if base_ch else ["critical_thinking"],
        "engine": "heuristic",
    }


@skill
def evaluate_duel_turn_heuristic(
    thinker_id: str,
    topic: str,
    user_argument: str,
    round_number: int = 1,
    history: list[dict] | None = None,
) -> dict:
    """Evalúa heurísticamente el argumento del usuario en un Duelo 1 vs 1 y genera la réplica del pensador."""
    catalog = data.load("thinkers")
    thinkers_by_id = {t["id"]: t for t in catalog.get("thinkers", [])}
    thinker = thinkers_by_id.get(
        thinker_id,
        {"name": thinker_id.capitalize(), "avatar": "🏛️", "core_stance": "Análisis riguroso de las ideas.", "era": "Filosofía clásica"},
    )
    t_name = thinker["name"]
    stance = thinker.get("core_stance", "")

    # 1. Auditar falacias y sesgos en el argumento del usuario
    audit_fallacies = fallacy_checker(user_argument)
    audit_biases = bias_detector(user_argument)
    detected_fallacies = audit_fallacies.get("fallacies", []) if isinstance(audit_fallacies, dict) else (audit_fallacies or [])
    detected_biases = audit_biases if isinstance(audit_biases, list) else (audit_biases.get("biases", []) if isinstance(audit_biases, dict) else [])

    # 2. Calcular rigor lógico
    words = user_argument.split()
    word_count = len(words)

    # Base de rigor
    rigor = 70

    # Bonificación por extensión sustantiva
    if word_count >= 25:
        rigor += 10
    if word_count >= 50:
        rigor += 8

    # Bonificación por conectores lógicos
    connectors = ["porque", "dado que", "por tanto", "por consiguiente", "sin embargo", "en consecuencia", "si bien", "evidencia", "premisa", "demuestra"]
    matches = sum(1 for c in connectors if re.search(rf"\b{c}\b", user_argument, re.IGNORECASE))
    rigor += min(12, matches * 4)

    # Penalización por falacias detectadas
    if detected_fallacies:
        rigor -= min(35, len(detected_fallacies) * 15)
    if detected_biases:
        rigor -= min(15, len(detected_biases) * 8)

    user_rigor = max(20, min(98, rigor))

    # Puntos fuertes detectados
    strengths = []
    if matches >= 2:
        strengths.append("Articulación argumentativa con conectores causales.")
    if word_count >= 30:
        strengths.append("Desarrollo conceptual con premisas explícitas.")
    if not detected_fallacies:
        strengths.append("Ausencia de falacias formales o informales evidentes.")
    if not strengths:
        strengths.append("Planteamiento directo de la postura.")

    # 3. Construir la réplica en primera persona del pensador
    fallacy_callout = ""
    if detected_fallacies:
        f_name = detected_fallacies[0].get("name", "inconsistencia lógica")
        fallacy_callout = f" Percibo en tu razonamiento un indicio de {f_name.lower()}: confundir la plausibilidad inicial con una deducción necesaria."

    if round_number == 1:
        reply_text = (
            f"Escucho con atención tu tesis sobre «{topic}», estimado interlocutor. Sin embargo, mi perspectiva sostiene que {stance}."
            f"{fallacy_callout} Al afirmar que «{user_argument.strip()[:100]}...», estás asumiendo premisas que requieren fundamentación previa. "
            f"¿Cómo justificas ese supuesto ante las consecuencias de su aplicación rigurosa?"
        )
    elif round_number == 2:
        reply_text = (
            f"Tu contrarréplica muestra audacia dialéctica. No obstante, el nudo gordiano persiste: {stance}."
            f"{fallacy_callout} Si concedemos tu punto, nos vemos forzados a aceptar una contradicción insostenible en el límite del concepto. "
            f"Dime: ¿no estás reduciendo la complejidad del dilema para salvar tu hipótesis inicial?"
        )
    else:
        # Ronda final / Conclusión del asalto
        reply_text = (
            f"Llegamos al clímax de nuestra disputa sobre «{topic}». Has defendido tu postura con notable empeño intelectual. "
            f"Mi dictamen final se mantiene fiel a mi principio rector: {stance}. "
            f"Aun así, has obligado a tensar los argumentos hasta su límite. La verdadera mayéutica no busca vencer, sino purificar el pensamiento."
        )

    # XP ganado en el asalto
    xp_earned = max(15, int(user_rigor * 0.4))
    if not detected_fallacies:
        xp_earned += 10

    # Veredicto si es la ronda final (ronda 3 o superior)
    is_final = round_number >= 3
    verdict = None
    if is_final:
        verdict = {
            "won": user_rigor >= 65,
            "title": "Victoria Dialéctica" if user_rigor >= 65 else "Lección Socrática",
            "summary": (
                f"Has concluido el duelo dialéctico contra {t_name} con un rigor final de {user_rigor}/100. "
                + ("¡El pensador reconoce la solidez de tu razonamiento!" if user_rigor >= 65 else "El pensador ha desarticulado tus premisas centrales, pero el ejercicio ha fortalecido tu pensamiento crítico.")
            ),
        }

    return {
        "thinker_id": thinker_id,
        "thinker_name": t_name,
        "thinker_avatar": thinker.get("avatar", "🏛️"),
        "thinker_era": thinker.get("era", ""),
        "reply": reply_text,
        "user_rigor": user_rigor,
        "user_fallacies": detected_fallacies,
        "user_biases": detected_biases,
        "user_strengths": strengths,
        "xp_earned": xp_earned,
        "is_final_round": is_final,
        "verdict": verdict,
        "engine": "heuristic",
    }



