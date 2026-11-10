"""API FastAPI de Polymath Graph.

Ejecutar:  uvicorn app.main:app --reload   (desde backend/)
Si existe frontend/dist (o POLYMATH_STATIC_DIR) se sirve también el frontend en «/».
"""
from __future__ import annotations

import io
import os
from pathlib import Path
import re

from fastapi import FastAPI, File, HTTPException, Query, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import pypdf

from . import data, db, export, llm, skills
from .schemas import (ChallengeEvaluateRequest, ChallengeGenerateRequest, DebateTurnRequest, DocumentGraphAnalysisRequest, DuelTurnRequest, ExplainRequest, FallacyRequest, FlashcardRequest, GraphExtractRequest, NodeDraft, ProfileCreateRequest, RagRequest, SessionModel, SocraticEvaluate, SocraticSession, SocraticStart, SocraticWhiteboard, TimelineBridgeRequest, UserBackupImportRequest, UserSyncRequest)

# Inicializar base de datos local SQLite
db.init_db()

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
        "database": "sqlite_local",
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


# ---------------- Navegador Temporal y Puentes Transdisciplinarios ----------------
@app.get(f"{api}/timeline/eras")
def get_timeline_eras() -> list[dict]:
    """Retorna las 6 grandes eras históricas del conocimiento con sus nodos y paradigmas."""
    return skills.get_historical_eras()


@app.post(f"{api}/timeline/bridge")
def find_timeline_bridge(req: TimelineBridgeRequest) -> dict:
    """Calcula la genealogía conceptual y puente evolutivo entre dos ideas distantes."""
    try:
        return skills.find_ideological_bridge(req.source_id, req.target_id)
    except KeyError as e:
        raise HTTPException(404, str(e))



@app.post(f"{api}/graph/validate-node")
def validate_node(draft: NodeDraft) -> dict:
    """Valida (sin persistir) un nodo propuesto: metadatos y enlaces entre disciplinas."""
    try:
        return skills.graph_node_builder(draft.topic, draft.domain, draft.connected_nodes, complexity=draft.complexity, authors=draft.authors, summary=draft.summary, year=draft.year)
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.post(f"{api}/graph/extract-from-text")
async def extract_graph_nodes(req: GraphExtractRequest) -> dict:
    """Extrae conceptos clave de un documento o texto (con Gemini o fallback heurístico) para expandir el grafo en vivo."""
    if req.use_llm and llm.get_llm_config()["enabled"]:
        res = await llm.extract_graph_nodes_with_llm(req.text, req.max_nodes)
        if res is not None:
            return res
    return skills.extract_graph_nodes_from_text(req.text, req.max_nodes)



@app.get(f"{api}/search")
def search(q: str = Query(min_length=2), k: int = Query(5, ge=1, le=20)) -> dict:
    by_id = data.node_by_id()
    return {"results": [{**r, "label": by_id[r["id"]]["label"], "domain": by_id[r["id"]]["domain"]} for r in skills.vector_search_indexer(q, k)]}


# ---------------- Lógica ----------------
@app.post(f"{api}/fallacies/check")
async def check(req: FallacyRequest) -> dict:
    if req.use_llm and llm.get_llm_config()["enabled"]:
        res = await llm.fallacy_audit_with_llm(req.text)
        if res is not None:
            return res
    res = skills.fallacy_checker(req.text)
    res["engine"] = "heuristic"
    return res


@app.get(f"{api}/fallacies/catalog")
def catalog() -> dict:
    c = data.load("fallacies")
    strip = lambda items: [{k: v for k, v in i.items() if k != "patterns"} for i in items]
    return {"fallacies": strip(c["fallacies"]), "biases": strip(c["biases"])}


# ---------------- Arena Dialéctica (Debate Socrático Cruzado) ----------------
@app.get(f"{api}/debate/catalog")
def debate_catalog() -> dict:
    """Devuelve el catálogo de pensadores históricos y debates clásicos predefinidos."""
    return data.load("thinkers")


@app.post(f"{api}/debate/turn")
async def debate_turn(req: DebateTurnRequest) -> dict:
    """Genera la réplica dialéctica de un pensador histórico contra otro sobre un dilema."""
    if req.use_llm and llm.get_llm_config()["enabled"]:
        res = await llm.debate_turn_with_llm(req.thinker_id, req.opponent_id, req.topic, req.history, req.user_intervention)
        if res is not None:
            return res
    return skills.debate_turn_heuristic(req.thinker_id, req.opponent_id, req.topic, req.history, req.user_intervention)


@app.post(f"{api}/debate/duel")
async def debate_duel(req: DuelTurnRequest) -> dict:
    """Evalúa el asalto dialéctico individual (1 vs 1) del usuario contra un pensador histórico."""
    if req.use_llm and llm.get_llm_config()["enabled"]:
        res = await llm.evaluate_duel_turn_with_llm(
            req.thinker_id, req.topic, req.user_argument, req.round_number, req.history
        )
        if res is not None:
            return res
    return skills.evaluate_duel_turn_heuristic(
        req.thinker_id, req.topic, req.user_argument, req.round_number, req.history
    )



# ---------------- Desafío Polímata & Gamificación Interdisciplinaria ----------------
@app.get(f"{api}/challenge/bank")
def challenge_bank() -> list[dict]:
    """Devuelve el banco curado de desafíos interdisciplinarios."""
    return skills.get_challenges_bank()


@app.post(f"{api}/challenge/generate")
async def challenge_generate(req: ChallengeGenerateRequest) -> dict:
    """Genera un desafío interdisciplinario (con Gemini o banco heurístico)."""
    if req.use_llm and llm.get_llm_config()["enabled"]:
        res = await llm.generate_interdisciplinary_challenge_with_llm(req.domain1, req.domain2, req.level)
        if res is not None:
            return res
    return skills.generate_challenge_heuristic(req.domain1, req.domain2, req.level)


@app.post(f"{api}/challenge/evaluate")
async def challenge_evaluate(req: ChallengeEvaluateRequest) -> dict:
    """Evalúa la respuesta y razonamiento del estudiante en un desafío interdisciplinario."""
    if req.use_llm and llm.get_llm_config()["enabled"]:
        res = await llm.evaluate_challenge_solution_with_llm(
            req.challenge_id, req.question, req.user_answer, req.user_reasoning, req.expected_explanation, req.domains
        )
        if res is not None:
            return res
    return skills.evaluate_challenge_heuristic(
        req.challenge_id, req.question, req.user_answer, req.user_reasoning, req.expected_explanation, req.domains
    )




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


@app.post(f"{api}/socratic/whiteboard")
async def socratic_whiteboard(req: SocraticWhiteboard) -> dict:
    s = req.session.model_dump()
    _guard(s)
    if req.use_llm and llm.get_llm_config()["enabled"]:
        res = await llm.socratic_whiteboard_with_llm(s, req.image_base64, req.history)
        if res is not None:
            _enrich_session(res["session"])
            return res

        _enrich_session(s)
        problem = skills._PROBLEMS[s["problem_id"]]
        missing = [c for c in problem["concepts"] if c["id"] not in s.get("mastered", [])]
        return {
            "newly": [],
            "missing": len(missing),
            "mastery": len(s.get("mastered", [])) / len(problem["concepts"]),
            "kind": "feedback",
            "transcription": "",
            "message": "⚠️ Google Gemini experimentó una pausa temporal de demanda (error 503). Por favor, pulsa «👁️ Evaluar pizarra con IA» nuevamente.",
            "session": s,
            "engine": "retry",
        }

    _enrich_session(s)
    problem = skills._PROBLEMS[s["problem_id"]]
    missing = [c for c in problem["concepts"] if c["id"] not in s.get("mastered", [])]
    return {
        "newly": [],
        "missing": len(missing),
        "mastery": len(s.get("mastered", [])) / len(problem["concepts"]),
        "kind": "feedback",
        "transcription": "Pizarra del estudiante (modo local sin visión)",
        "message": "El reconocimiento visual de la pizarra requiere conexión con IA (Gemini Flash). Puedes escribir tus cálculos o pasos en el cuadro de texto inferior para que el tutor los evalúe.",
        "session": s,
        "engine": "local",
    }


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


@app.post(f"{api}/document/analyze-graph")
def analyze_document_graph_endpoint(req: DocumentGraphAnalysisRequest) -> dict:
    """Extrae el subgrafo semántico activo (nodos, autores, párrafos y puentes transdisciplinarios) de un documento."""
    return skills.analyze_document_graph(req.text, req.max_bridging_hops)


@app.post(f"{api}/flashcards/generate")
async def flashcards_generate(req: FlashcardRequest) -> dict:
    """Genera tarjetas de estudio estilo Anki con IA (Gemini Flash) o fallback heurístico."""
    if req.use_llm and llm.get_llm_config()["enabled"]:
        res = await llm.generate_flashcards_with_llm(req.text, req.source, req.max_cards, req.level, req.lang)
        if res is not None:
            return res
    return skills.generate_flashcards(req.text, req.max_cards, req.level, req.lang)


# ---------------- Persistencia Local SQLite / Perfiles ----------------
@app.get(f"{api}/user/profiles")
def get_user_profiles() -> list[dict]:
    """Lista todos los perfiles guardados localmente en SQLite."""
    return db.list_profiles()


@app.post(f"{api}/user/profiles")
def create_user_profile(req: ProfileCreateRequest) -> dict:
    """Crea un nuevo perfil local."""
    uid = req.user_id or re.sub(r"[^a-zA-Z0-9_-]", "_", req.name.lower().strip())
    return db.create_profile(user_id=uid, name=req.name, avatar=req.avatar)


@app.get(f"{api}/user/state")
def get_user_state(user_id: str = Query(default="default")) -> dict:
    """Recupera el estado completo de un usuario (progreso, flashcards, retos, nodos)."""
    return db.get_user_state(user_id=user_id)


@app.post(f"{api}/user/sync")
def sync_user_state(req: UserSyncRequest) -> dict:
    """Sincroniza el estado del frontend con la base de datos local SQLite."""
    payload = req.model_dump()
    return db.sync_user_state(user_id=req.user_id, payload=payload)


@app.get(f"{api}/user/backup/export")
def export_user_backup(user_id: str = Query(default="default")) -> dict:
    """Descarga un volcado JSON con todo el progreso, notas y flashcards del usuario."""
    return db.export_backup(user_id=user_id)


@app.post(f"{api}/user/backup/import")
def import_user_backup(req: UserBackupImportRequest) -> dict:
    """Restaura o fusiona un archivo JSON de respaldo en la base de datos local."""
    return db.import_backup(user_id=req.user_id, backup_dict=req.backup)


# ---------------- Exportador Universal (Obsidian & Anki) ----------------
@app.get(f"{api}/export/obsidian")
def export_obsidian(user_id: str = Query(default="default")) -> Response:
    """Genera y descarga una bóveda completa de Obsidian (.zip) con notas interconectadas."""
    zip_bytes = export.export_obsidian_vault(user_id=user_id)
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=Polymath_Obsidian_Vault.zip"},
    )


@app.get(f"{api}/export/anki")
def export_anki(user_id: str = Query(default="default")) -> Response:
    """Genera y descarga un paquete nativo de Anki (.apkg) con estilos visuales y etiquetas."""
    apkg_bytes = export.export_anki_package(user_id=user_id)
    return Response(
        content=apkg_bytes,
        media_type="application/octet-stream",
        headers={"Content-Disposition": "attachment; filename=Polymath_Deck.apkg"},
    )


@app.get(f"{api}/export/anki-tsv")
def export_anki_tsv(user_id: str = Query(default="default")) -> Response:
    """Exporta las tarjetas en formato TSV para importación de texto en Anki."""
    tsv_content = export.export_anki_tsv(user_id=user_id)
    return Response(
        content=tsv_content,
        media_type="text/tab-separated-values",
        headers={"Content-Disposition": "attachment; filename=polymath_cards.tsv"},
    )





# ---------------- Frontend estático (opcional) ----------------
_static = os.environ.get("POLYMATH_STATIC_DIR")
_candidates = [Path(_static)] if _static else [Path(__file__).resolve().parents[2] / "frontend" / "dist", Path("/app/static")]
for _c in _candidates:
    if _c.exists():
        app.mount("/", StaticFiles(directory=_c, html=True), name="frontend")
        break
