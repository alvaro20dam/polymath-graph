from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
import pytest

from app import skills
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def disable_llm_for_api_tests(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("GOOGLE_API_KEY", "")



def ids(items):
    return [i["id"] for i in items]


def test_catalogo_completo():
    cat = client.get("/api/fallacies/catalog").json()
    assert len(cat["fallacies"]) == 24 and len(cat["biases"]) == 24


def test_grafo_valido():
    g = client.get("/api/graph").json()
    assert len(g["nodes"]) >= 50
    assert skills.semantic_link_evaluator() == []
    assert client.get("/api/health").json()["status"] == "ok"


def test_camino_mas_corto():
    r = client.get("/api/graph/path", params={"source": "aristotelian_logic", "target": "transformers"}).json()
    assert r["path"][0] == "aristotelian_logic" and r["path"][-1] == "transformers"
    assert client.get("/api/graph/path", params={"source": "x", "target": "transformers"}).status_code == 404


def test_busqueda_semantica():
    r = client.get("/api/search", params={"q": "redes neuronales"}).json()["results"]
    assert r and r[0]["id"] == "neural_networks"


def test_validar_nodo():
    ok = client.post("/api/graph/validate-node", json={"topic": "Teoría del caos", "domain": "science", "connected_nodes": ["complexity_systems", "probability"], "authors": ["Lorenz"]})
    assert ok.status_code == 200 and ok.json()["valid"] is True
    bad = client.post("/api/graph/validate-node", json={"topic": "Nada", "domain": "inventado", "connected_nodes": ["probability"]})
    assert bad.status_code == 422


def test_falacias_paridad_con_frontend():
    cases = {
        "Después de que instalaron la nueva cámara, aumentaron los robos, por eso la cámara provoca los robos.": ["post_hoc"],
        "No le hagas caso: eres un ignorante y todo el mundo sabe que estás equivocado.": ["ad_hominem", "ad_populum"],
        "Si el sospechoso es culpable entonces huyó. El sospechoso huyó. Por lo tanto, el sospechoso es culpable.": ["affirming_consequent"],
        "Si estudias matemáticas entonces apruebas. No estudias matemáticas. Por lo tanto, no apruebas.": ["denying_antecedent"],
        "Solo hay dos opciones: o apoyas la reforma o eres enemigo del país. Si permitimos esta reforma, acabaremos perdiendo todas las libertades.": ["false_dilemma", "slippery_slope"],
    }
    for text, expected in cases.items():
        r = client.post("/api/fallacies/check", json={"text": text}).json()
        assert set(expected) <= set(ids(r["fallacies"])), (text, ids(r["fallacies"]))


def test_modus_ponens_no_es_falacia():
    r = skills.fallacy_checker("Si el sospechoso es culpable entonces huyó. El sospechoso es culpable. Por lo tanto, el sospechoso huyó.")
    assert "affirming_consequent" not in ids(r["fallacies"])


def test_sesgos_y_estructura():
    r = skills.fallacy_checker("Estoy 100% seguro de que mi plan funcionará. Ya lo sabía desde el principio, y solo leo noticias que confirman lo que pienso.")
    assert {"overconfidence", "hindsight", "confirmation"} <= set(ids(r["biases"]))
    s = skills.argument_structure_parser("Todos los mamíferos tienen pulmones. Las ballenas son mamíferos. Por lo tanto, las ballenas tienen pulmones.")
    assert len(s["premises"]) == 2 and "ballenas tienen pulmones" in s["conclusions"][0]


def test_socratico_flujo_completo_sin_filtrar_solucion():
    s = client.post("/api/socratic/start", json={"problem_id": "bayes_test"}).json()["session"]
    r = client.post("/api/socratic/evaluate", json={"session": s, "text": "no sé"}).json()
    assert "9,2" not in r["message"] and "?" in r["message"]
    s = r["session"]
    h = client.post("/api/socratic/hint", json={"session": s}).json()
    assert h["level"] == 1 and "9,2" not in h["message"]
    for text in [
        "La prevalencia o tasa base es 1%, es decir 100 enfermos de 10.000 personas.",
        "Los sanos con falsos positivos del 9% son 891.",
        "Multiplico sensibilidad por prevalencia: 90 de los enfermos dan positivo.",
        "Divido entre el total de positivos 981: el posterior es 9,2%.",
    ]:
        r = client.post("/api/socratic/evaluate", json={"session": s, "text": text}).json()
        s = r["session"]
    assert r["kind"] == "complete"
    plan = client.post("/api/socratic/plan", json={"session": s}).json()
    assert plan["gaps"] == [] or all(g["status"] == "frágil" for g in plan["gaps"])


def test_confusion_sensibilidad_posterior():
    s = skills.new_session("bayes_test")
    r = skills.socratic_evaluate(s, "La probabilidad de estar enfermo es 90% porque la prueba detecta al 90%")
    assert r["kind"] == "misconception"


def test_socratic_hint_generator_skill():
    msg = skills.socratic_hint_generator("", "gradient_lr", "beginner")
    assert "?" in msg or len(msg) > 10


def test_explicador_por_nivel_e_idioma():
    b = client.post("/api/explain", json={"selected_text": "La entropía de Shannon", "level": "beginner", "lang": "es", "use_llm": False}).json()
    e = client.post("/api/explain", json={"selected_text": "La entropía de Shannon", "level": "expert", "lang": "en", "use_llm": False}).json()
    assert b["terms"][0]["id"] == "entropy" and b["terms"][0]["text"] != e["terms"][0]["text"]
    j = client.post("/api/explain", json={"selected_text": "Un proceso estocástico", "level": "beginner", "use_llm": False}).json()
    assert "con azar" in j["simplified"]


def test_rag_documento():
    text = "La entropía mide la incertidumbre de una fuente.\n\nEl descenso del gradiente minimiza funciones paso a paso.\n\nLos gatos duermen mucho."
    r = client.post("/api/rag/query", json={"text": text, "question": "¿qué mide la entropía?"}).json()
    assert r["found"] and "entropía" in r["passages"][0]["text"]
    assert client.post("/api/rag/query", json={"text": text, "question": "zzzz qqqq"}).json()["found"] is False


def test_socratic_whiteboard_endpoint():
    s = client.post("/api/socratic/start", json={"problem_id": "bayes_test"}).json()["session"]
    # Prueba del endpoint con imagen base64 dummy
    dummy_img = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    r = client.post("/api/socratic/whiteboard", json={"session": s, "image_base64": dummy_img, "use_llm": False})
    assert r.status_code == 200
    data = r.json()
    assert "transcription" in data
    assert "message" in data
    assert data["engine"] == "local"

    # Validación de problema inexistente (404)
    bad_session = {**s, "problem_id": "non_existent_problem", "problemId": "non_existent_problem"}
    r404 = client.post("/api/socratic/whiteboard", json={"session": bad_session, "image_base64": dummy_img})
    assert r404.status_code == 404


def test_skills_registradas():
    for name in ["graph_node_builder", "semantic_link_evaluator", "citation_network_mapper", "socratic_hint_generator", "mastery_gap_analyzer", "adaptive_complexity_scaler", "explainpaper_highlighter", "fallacy_checker", "bias_detector", "argument_structure_parser", "vector_search_indexer"]:
        assert name in skills.SKILLS


def test_fallacies_check_endpoint_llm_and_fallback():
    # Modo fallback explícito (sin LLM)
    sample_text = "Solo hay dos opciones: o apoyas la reforma o eres enemigo del país."
    r_local = client.post("/api/fallacies/check", json={"text": sample_text, "use_llm": False}).json()
    assert "false_dilemma" in ids(r_local["fallacies"])
    assert r_local["engine"] == "heuristic"

    # Modo con LLM mocked
    mock_audit = {
        "structure": {"premises": ["O estás conmigo o contra mí"], "conclusions": ["Eres enemigo"]},
        "rigor": 15,
        "fallacies": [{"name": "Falso dilema", "kind": "informal", "definition": "Solo dos opciones", "evidence": ["o estás conmigo"], "counter": "Hay posiciones intermedias"}],
        "biases": [],
        "notes": ["Dicotomía forzada"],
        "steelmanning": "Existen múltiples posturas constructivas intermedias.",
        "advice": "Permitir matices y diálogo.",
        "engine": "gemini (gemini-3.5-flash)",
    }
    with patch("app.llm.fallacy_audit_with_llm", new_callable=AsyncMock) as mock_fn, \
         patch("app.llm.get_llm_config", return_value={"enabled": True, "model": "gemini-3.5-flash"}):
        mock_fn.return_value = mock_audit
        r_ai = client.post("/api/fallacies/check", json={"text": sample_text, "use_llm": True}).json()
        assert r_ai["rigor"] == 15
        assert "steelmanning" in r_ai
        assert "gemini" in r_ai["engine"]


def test_graph_extract_from_text_endpoint():
    doc_text = (
        "La termodinámica estadística fuera del equilibrio estudia cómo los sistemas complejos disipan energía y generan orden espontáneo.\n\n"
        "Ilya Prigogine demostró que las estructuras disipativas conectan la entropía física con la autoorganización biológica y epistemológica."
    )
    r = client.post("/api/graph/extract-from-text", json={"text": doc_text, "max_nodes": 2, "use_llm": False})
    assert r.status_code == 200
    data = r.json()
    assert data["engine"] == "heuristic"
    assert len(data["nodes"]) >= 1
    assert data["nodes"][0]["custom"] is True
    assert len(data["links"]) >= 2


def test_flashcards_generate_endpoint():
    doc_text = (
        "La entropía es la medida de la incertidumbre o sorpresa en una fuente de información.\n\n"
        "El descenso del gradiente es un algoritmo de optimización que ajusta parámetros en la dirección contraria a las derivadas parciales."
    )
    # 1. Fallback heurístico
    r_local = client.post("/api/flashcards/generate", json={"text": doc_text, "max_cards": 4, "use_llm": False})
    assert r_local.status_code == 200
    d_local = r_local.json()
    assert d_local["engine"] == "heuristic"
    assert len(d_local["cards"]) >= 1
    assert "front" in d_local["cards"][0] and "back" in d_local["cards"][0]

    # 2. Con LLM mocked
    mock_cards = {
        "cards": [
            {
                "front": "¿Qué mide la entropía de Shannon?",
                "back": "**La incertidumbre media o sorpresa de una fuente.**",
                "tags": ["entropia", "informacion"],
                "kind": "qa",
            }
        ],
        "engine": "gemini (gemini-3.5-flash)",
    }
    with patch("app.llm.generate_flashcards_with_llm", new_callable=AsyncMock) as mock_fn, \
         patch("app.llm.get_llm_config", return_value={"enabled": True, "model": "gemini-3.5-flash"}):
        mock_fn.return_value = mock_cards
        r_ai = client.post("/api/flashcards/generate", json={"text": doc_text, "max_cards": 2, "use_llm": True})
        assert r_ai.status_code == 200
        d_ai = r_ai.json()
        assert d_ai["engine"] == "gemini (gemini-3.5-flash)"
        assert len(d_ai["cards"]) == 1
        assert "entropía" in d_ai["cards"][0]["front"]


def test_debate_catalog_and_turn_endpoints():
    # 1. Catálogo de pensadores y debates
    r_cat = client.get("/api/debate/catalog")
    assert r_cat.status_code == 200
    cat = r_cat.json()
    assert "thinkers" in cat and len(cat["thinkers"]) >= 10
    assert "debates" in cat and len(cat["debates"]) >= 5

    # 2. Turno heurístico local
    turn_req = {
        "thinker_id": "turing",
        "opponent_id": "godel",
        "topic": "¿Puede una máquina pensar?",
        "history": [],
        "use_llm": False,
    }
    r_turn = client.post("/api/debate/turn", json=turn_req)
    assert r_turn.status_code == 200
    d_turn = r_turn.json()
    assert d_turn["speaker"] == "turing"
    assert "Turing" in d_turn["name"]
    assert len(d_turn["text"]) >= 20
    assert d_turn["engine"] == "heuristic"

    # 3. Turno con intervención del usuario
    turn_user = {
        "thinker_id": "godel",
        "opponent_id": "turing",
        "topic": "¿Puede una máquina pensar?",
        "history": [{"speaker": "turing", "text": "Una máquina universal computa cualquier función reflexiva."}],
        "user_intervention": "¿Acaso el test de Turing no comete la falacia de petición de principio?",
        "use_llm": False,
    }
    r_user = client.post("/api/debate/turn", json=turn_user)
    assert r_user.status_code == 200
    d_user = r_user.json()
    assert d_user["speaker"] == "godel"
    assert "petición de principio" in d_user["text"] or "agudeza" in d_user["text"]




