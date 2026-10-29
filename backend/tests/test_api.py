from fastapi.testclient import TestClient

from app import skills
from app.main import app

client = TestClient(app)


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


def test_skills_registradas():
    for name in ["graph_node_builder", "semantic_link_evaluator", "citation_network_mapper", "socratic_hint_generator", "mastery_gap_analyzer", "adaptive_complexity_scaler", "explainpaper_highlighter", "fallacy_checker", "bias_detector", "argument_structure_parser", "vector_search_indexer"]:
        assert name in skills.SKILLS
