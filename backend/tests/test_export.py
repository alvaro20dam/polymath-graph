"""Pruebas unitarias para el exportador universal de Obsidian y Anki (.apkg y TSV)."""
from __future__ import annotations

import io
import zipfile

from fastapi.testclient import TestClient

from app import export
from app.main import app


def test_export_obsidian_vault_structure():
    zip_bytes = export.export_obsidian_vault("default")
    assert isinstance(zip_bytes, bytes)
    assert len(zip_bytes) > 1000

    with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as z:
        file_list = z.namelist()
        assert "00 - Índice General del Grafo.md" in file_list

        # Verificar que el índice contiene referencias a wikilinks y disciplinas
        index_content = z.read("00 - Índice General del Grafo.md").decode("utf-8")
        assert "# 🌌 Grafo de Conocimiento Polímata" in index_content
        assert "[[wikilinks]]" in index_content
        assert "Filosofía" in index_content
        assert "Ciencia" in index_content

        # Verificar que existen notas en subcarpetas de disciplina
        md_notes = [f for f in file_list if f.endswith(".md") and f != "00 - Índice General del Grafo.md"]
        assert len(md_notes) >= 50

        # Leer una nota representativa
        sample_note = md_notes[0]
        note_content = z.read(sample_note).decode("utf-8")
        assert note_content.startswith("---")
        assert "title:" in note_content
        assert "domain:" in note_content
        assert "## 💡 Resumen Conceptual" in note_content
        assert "## 🔗 Enlaces y Conexiones en el Grafo" in note_content


def test_export_anki_package():
    apkg_bytes = export.export_anki_package("default")
    assert isinstance(apkg_bytes, bytes)
    assert len(apkg_bytes) > 500

    # Un archivo .apkg es un contenedor ZIP con collection.anki2
    with zipfile.ZipFile(io.BytesIO(apkg_bytes), "r") as z:
        names = z.namelist()
        assert "collection.anki2" in names or "collection.anki21" in names


def test_export_anki_tsv():
    tsv_text = export.export_anki_tsv("default")
    assert isinstance(tsv_text, str)
    assert tsv_text.startswith("# Front\tBack\tTags\tNodeId")


def test_api_export_endpoints():
    client = TestClient(app)

    # 1. Endpoint Obsidian ZIP
    res_obs = client.get("/api/export/obsidian?user_id=default")
    assert res_obs.status_code == 200
    assert res_obs.headers["content-type"] == "application/zip"
    assert "Polymath_Obsidian_Vault.zip" in res_obs.headers["content-disposition"]
    assert len(res_obs.content) > 1000

    # 2. Endpoint Anki APKG
    res_anki = client.get("/api/export/anki?user_id=default")
    assert res_anki.status_code == 200
    assert res_anki.headers["content-type"] == "application/octet-stream"
    assert "Polymath_Deck.apkg" in res_anki.headers["content-disposition"]
    assert len(res_anki.content) > 500

    # 3. Endpoint Anki TSV
    res_tsv = client.get("/api/export/anki-tsv?user_id=default")
    assert res_tsv.status_code == 200
    assert "text/tab-separated-values" in res_tsv.headers["content-type"]
    assert "polymath_cards.tsv" in res_tsv.headers["content-disposition"]
