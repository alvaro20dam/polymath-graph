"""API FastAPI de Polymath Graph.

Ejecutar:  uvicorn app.main:app --reload   (desde backend/)
Si existe frontend/dist (o POLYMATH_STATIC_DIR) se sirve también el frontend en «/».
"""
from __future__ import annotations

import io
import os
from pathlib import Path
import re

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import pypdf

from . import data, llm, skills
from .schemas import (ExplainRequest, FallacyRequest, NodeDraft, RagRequest, SessionModel, SocraticEvaluate, SocraticSession, SocraticStart)

app = FastAPI(title="Polymath Graph API", version="1.0.0", description="Grafo de conocimiento, tutor socrático, verificador lógico, explicador y RAG ligero.")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("POLYMATH_CORS", "*").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

api = "/api"


@app.get(f"{api}/health")
def health() -> dict:
    g = data.graph()
    llm_cfg = llm.get_llm_config()
    return {
        "status": "ok",
        "nodes": len(g["nodes"]),
        "links": len(g["links"]),
        "skills": sorted(skills.SKILLS),
        "llm": {"enabled": llm_cfg["enabled"], "model": llm_cfg["model"]},
    }


@app.get(f"{api}/llm/status")
def llm_status() -> dict:
    """Informa si el LLM (Gemini Flash) está activo o en modo fallback."""
    return llm.get_llm_config()


# ---------------- Grafo ----------------
@app.get(f"{api}/graph")
def get_graph() -> dict:
    return data.graph()


@app.get(f"{api}/graph/nodes/{{node_id}}")
def get_node(node_id: str) -> dict:
    by_id = data.node_by_id()
    if node_id not in by_id:
        raise HTTPException(404, "Nodo no encontrado")
    links = data.graph()["links"]
    return {"node": by_id[node_id], "outgoing": [l for l in links if l["source"] == node_id], "incoming": [l for l in links if l["target"] == node_id]}


@app.get(f"{api}/graph/path")
def get_path(source: str, target: str) -> dict:
    try:
        path = skills.citation_network_mapper(source, target)
    except KeyError:
        raise HTTPException(404, "Nodo no encontrado")
    return {"path": path, "hops": None if path is None else len(path) - 1}


@app.post(f"{api}/graph/validate-node")
def validate_node(draft: NodeDraft) -> dict:
    """Valida (sin persistir) un nodo propuesto: metadatos y enlaces entre disciplinas."""
    try:
        return skills.graph_node_builder(draft.topic, draft.domain, draft.connected_nodes, complexity=draft.complexity, authors=draft.authors, summary=draft.summary, year=draft.year)
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.get(f"{api}/search")
def search(q: str = Query(min_length=2), k: int = Query(5, ge=1, le=20)) -> dict:
    by_id = data.node_by_id()
    return {"results": [{**r, "label": by_id[r["id"]]["label"], "domain": by_id[r["id"]]["domain"]} for r in skills.vector_search_indexer(q, k)]}


# ---------------- Lógica ----------------
@app.post(f"{api}/fallacies/check")
def check(req: FallacyRequest) -> dict:
    return skills.fallacy_checker(req.text)


@app.get(f"{api}/fallacies/catalog")
def catalog() -> dict:
    c = data.load("fallacies")
    strip = lambda items: [{k: v for k, v in i.items() if k != "patterns"} for i in items]
    return {"fallacies": strip(c["fallacies"]), "biases": strip(c["biases"])}


# ---------------- Tutor socrático ----------------
def _enrich_session(session: dict) -> dict:
    if "problem_id" in session and "problemId" not in session:
        session["problemId"] = session["problem_id"]
    if "hints_used" in session and "hintsUsed" not in session:
        session["hintsUsed"] = session["hints_used"]
    return session


@app.get(f"{api}/socratic/problems")
def problems() -> list[dict]:
    return skills.list_problems()


@app.post(f"{api}/socratic/start")
def socratic_start(req: SocraticStart) -> dict:
    try:
        session = skills.new_session(req.problem_id, req.level)
        return {"session": _enrich_session(session)}
    except KeyError:
        raise HTTPException(404, "Problema no encontrado")


@app.post(f"{api}/socratic/evaluate")
async def socratic_eval(req: SocraticEvaluate) -> dict:
    s = req.session.model_dump()
    _guard(s)
    if req.use_llm and llm.get_llm_config()["enabled"]:
        res = await llm.socratic_evaluate_with_llm(s, req.text, req.history)
        if res is not None:
            _enrich_session(res["session"])
            return res

    res = skills.socratic_evaluate(s, req.text)
    res["engine"] = "heuristic"
    _enrich_session(res["session"])
    return res


@app.post(f"{api}/socratic/hint")
async def socratic_hint(req: SocraticSession) -> dict:
    s = req.session.model_dump()
    _guard(s)
    if req.use_llm and llm.get_llm_config()["enabled"]:
        res = await llm.socratic_hint_with_llm(s, req.history)
        if res is not None:
            _enrich_session(res["session"])
            return res

    res = skills.socratic_hint(s)
    res["engine"] = "heuristic"
    _enrich_session(res["session"])
    return res


@app.post(f"{api}/socratic/plan")
def socratic_plan(req: SocraticSession) -> dict:
    s = req.session.model_dump()
    _guard(s)
    return skills.adaptive_complexity_scaler(s)


def _guard(session: dict) -> None:
    pid = session.get("problem_id") or session.get("problemId")
    if pid not in {p["id"] for p in skills.list_problems()}:
        raise HTTPException(404, "Problema no encontrado")


# ---------------- Explicador, RAG y PDFs ----------------
def format_pdf_text(text: str) -> str:
    """Reconstruye párrafos naturales a partir de textos de PDF con saltos de línea excesivos o palabra por palabra."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    raw_blocks = re.split(r"\n{2,}", text)
    cleaned_blocks = []

    for block in raw_blocks:
        lines = [ln.strip() for ln in block.split("\n") if ln.strip()]
        if not lines:
            continue

        current_p = []
        for line in lines:
            is_bullet = bool(re.match(r"^(?:[•\-\*]|\d+[\.\)])\s+", line))
            if is_bullet and current_p:
                cleaned_blocks.append(" ".join(current_p))
                current_p = [line]
            else:
                if current_p and current_p[-1].endswith("-") and len(current_p[-1]) > 1:
                    current_p[-1] = current_p[-1][:-1] + line
                else:
                    current_p.append(line)
        if current_p:
            cleaned_blocks.append(" ".join(current_p))

    return "\n\n".join(cleaned_blocks)


@app.post(f"{api}/pdf/extract")
async def extract_pdf(file: UploadFile = File(...)) -> dict:
    """Extrae texto de un archivo PDF subido por el estudiante."""
    fname = (file.filename or "").lower()
    if not fname.endswith(".pdf"):
        raise HTTPException(400, "El archivo debe ser un documento PDF (.pdf)")

    try:
        content = await file.read()
        reader = pypdf.PdfReader(io.BytesIO(content))
        pages_text = []
        for p in reader.pages:
            t = p.extract_text() or ""
            if t.strip():
                pages_text.append(t.strip())

        full_text = "\n\n".join(pages_text).strip()
        is_ocr = False

        # Si pypdf no extrae texto (impresoras virtuales, texto rasterizado o escaneos)
        if len(full_text) < 40 and llm.get_llm_config()["enabled"]:
            ocr_text = await llm.extract_pdf_with_gemini(content)
            if ocr_text:
                full_text = ocr_text
                is_ocr = True

        if not full_text:
            raise HTTPException(422, "No se encontró texto en el documento. Si es un escaneo o impresión gráfica, asegúrate de que sea legible.")

        full_text = format_pdf_text(full_text)

        return {
            "filename": file.filename,
            "pages": len(reader.pages),
            "text": full_text,
            "chars": len(full_text),
            "ocr": is_ocr,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(422, f"Error al procesar el PDF: {str(e)}")


@app.post(f"{api}/explain")
async def explain(req: ExplainRequest) -> dict:
    if req.use_llm and llm.get_llm_config()["enabled"]:
        res = await llm.explain_with_llm(req.selected_text, req.context, req.level, req.lang)
        if res is not None:
            return res
    res = skills.explainpaper_highlighter(req.selected_text, req.context, req.level, req.lang)
    res["engine"] = "heuristic"
    return res


@app.post(f"{api}/rag/query")
async def rag(req: RagRequest) -> dict:
    if req.use_llm and llm.get_llm_config()["enabled"]:
        res = await llm.rag_query_with_llm(req.text, req.question, req.k)
        if res is not None:
            return res
    res = skills.document_qa(req.text, req.question, req.k)
    res["engine"] = "heuristic"
    return res


# ---------------- Frontend estático (opcional) ----------------
_static = os.environ.get("POLYMATH_STATIC_DIR")
_candidates = [Path(_static)] if _static else [Path(__file__).resolve().parents[2] / "frontend" / "dist", Path("/app/static")]
for _c in _candidates:
    if _c.exists():
        app.mount("/", StaticFiles(directory=_c, html=True), name="frontend")
        break
