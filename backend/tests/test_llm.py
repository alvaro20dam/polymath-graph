"""Pruebas unitarias para el servicio de integración LLM y fallback socrático."""
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
import pytest

from app import llm, skills
from app.main import app

client = TestClient(app)


def test_llm_status_default():
    r = client.get("/api/llm/status")
    assert r.status_code == 200
    data = r.json()
    assert "enabled" in data
    assert "model" in data
    assert data["provider"] == "google-gemini"


def test_health_includes_llm_info():
    r = client.get("/api/health")
    assert r.status_code == 200
    data = r.json()
    assert "llm" in data
    assert "model" in data["llm"]


def test_socratic_evaluate_fallback_when_disabled():
    s = client.post("/api/socratic/start", json={"problem_id": "bayes_test"}).json()["session"]
    with patch.dict("os.environ", {}, clear=True):
        r = client.post("/api/socratic/evaluate", json={"session": s, "text": "La prevalencia es 1%", "use_llm": True})
        assert r.status_code == 200
        data = r.json()
        assert data["engine"] == "heuristic"
        assert "base_rate" in data["session"]["mastered"]


@pytest.mark.anyio
async def test_socratic_evaluate_with_mocked_gemini():
    session = skills.new_session("bayes_test", "intermediate")
    mock_payload = {
        "newly_mastered_ids": ["base_rate"],
        "is_misconception": False,
        "is_complete": False,
        "message": "¡Exacto! La prevalencia del 1% es crucial. Ahora, ¿qué ocurre con el 9% de falsos positivos en los sanos?",
    }

    with patch.dict("os.environ", {"GEMINI_API_KEY": "dummy_test_key"}), \
         patch("app.llm.generate_gemini", new_callable=AsyncMock) as mock_gemini:
        mock_gemini.return_value = mock_payload

        res = await llm.socratic_evaluate_with_llm(session, "Considero que la tasa base de enfermos es 1%", [])
        assert res is not None
        assert "Tasa base (prior)" in res["newly"]
        assert "base_rate" in res["session"]["mastered"]
        assert res["kind"] == "progress"
        assert "gemini" in res["engine"]
        assert "crucial" in res["message"]


@pytest.mark.anyio
async def test_socratic_evaluate_gemini_error_returns_none():
    session = skills.new_session("bayes_test", "intermediate")

    with patch.dict("os.environ", {"GEMINI_API_KEY": "dummy_test_key"}), \
         patch("app.llm.generate_gemini", new_callable=AsyncMock) as mock_gemini:
        mock_gemini.return_value = None  # Simula error en la API

        res = await llm.socratic_evaluate_with_llm(session, "texto cualquiera", [])
        assert res is None  # Activa el fallback al motor determinista


@pytest.mark.anyio
async def test_socratic_hint_with_mocked_gemini():
    session = skills.new_session("bayes_test", "intermediate")
    mock_payload = {
        "hint": "Imagina 10.000 personas en una sala: ¿cuántas estarían enfermas antes del test?"
    }

    with patch.dict("os.environ", {"GEMINI_API_KEY": "dummy_test_key"}), \
         patch("app.llm.generate_gemini", new_callable=AsyncMock) as mock_gemini:
        mock_gemini.return_value = mock_payload

        res = await llm.socratic_hint_with_llm(session, [])
        assert res is not None
        assert res["level"] == 1
        assert "sala" in res["message"]
        assert "gemini" in res["engine"]


def test_pdf_extract_empty_fails():
    import io
    import pypdf

    # Genera un PDF sin texto y sin LLM activo
    writer = pypdf.PdfWriter()
    writer.add_blank_page(width=72, height=72)
    buf = io.BytesIO()
    writer.write(buf)
    buf.seek(0)

    with patch.dict("os.environ", {}, clear=True):
        r = client.post("/api/pdf/extract", files={"file": ("blank.pdf", buf, "application/pdf")})
        assert r.status_code == 422


def test_pdf_extract_non_pdf_fails():
    r = client.post("/api/pdf/extract", files={"file": ("notes.txt", b"Texto plano", "text/plain")})
    assert r.status_code == 400


@pytest.mark.anyio
async def test_rag_query_with_mocked_gemini():
    text = "El Teorema Central del Límite establece que la suma de variables tiende a una normal."
    mock_answer = "El teorema dice que la suma de variables independientes tiende a distribuirse normalmente."

    with patch.dict("os.environ", {"GEMINI_API_KEY": "dummy_test_key"}), \
         patch("app.llm.generate_gemini", new_callable=AsyncMock) as mock_gemini:
        mock_gemini.return_value = mock_answer

        res = await llm.rag_query_with_llm(text, "¿Qué establece el teorema?", k=2)
        assert res is not None
        assert res["found"] is True
        assert "normalmente" in res["answer"]
        assert len(res["passages"]) > 0
