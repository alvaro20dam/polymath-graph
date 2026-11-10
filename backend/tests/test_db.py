"""Pruebas unitarias para la capa de persistencia local en SQLite (app/db.py) y endpoints /api/user/*."""
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app


@pytest.fixture
def temp_db(tmp_path: Path):
    db_file = tmp_path / "test_polymath.db"
    db.init_db(db_file)
    return db_file


def test_init_db_and_default_profile(temp_db: Path):
    profiles = db.list_profiles(temp_db)
    assert len(profiles) >= 1
    default = profiles[0]
    assert default["id"] == "default"
    assert "Polímata" in default["name"]


def test_create_and_list_profiles(temp_db: Path):
    new_prof = db.create_profile("alvaro", "Álvaro", "🧠", temp_db)
    assert new_prof["id"] == "alvaro"
    assert new_prof["name"] == "Álvaro"
    assert new_prof["avatar"] == "🧠"

    profiles = db.list_profiles(temp_db)
    ids = [p["id"] for p in profiles]
    assert "default" in ids
    assert "alvaro" in ids


def test_sync_user_state_and_retrieve(temp_db: Path):
    user_id = "test_user"
    db.create_profile(user_id, "Test User", "🔬", temp_db)

    payload = {
        "xp": 150,
        "visited": ["entropy", "information_theory", "bayes_theorem"],
        "problems": {
            "p_entropy": {
                "node": "entropy",
                "mastered": ["c1", "c2"],
                "hints": {"c1": 1},
                "complete": True,
            }
        },
        "challenges": {
            "entropy_and_shannon": {
                "solved": True,
                "xp": 50,
                "domains": ["science", "technology"],
                "score": 0.95,
                "reasoning": "La memoria disipa calor según Landauer",
                "feedback": "Excelente argumentación",
            }
        },
        "flashcards": [
            {
                "id": "fc_1",
                "front": "¿Qué es entropía?",
                "back": "Medida del desorden microscópico",
                "nodeId": "entropy",
                "tags": ["science"],
                "reps": 2,
                "interval": 6,
                "ease": 2.6,
                "dueDate": "2026-11-15",
                "history": [{"q": 4, "date": "2026-11-09"}],
            }
        ],
        "customGraph": {
            "nodes": [
                {
                    "id": "my_concept",
                    "label": "Mi Concepto Personal",
                    "domain": "philosophy",
                    "complexity": 4,
                    "year": 2026,
                    "authors": ["Yo"],
                    "summary": "Concepto puente",
                }
            ],
            "links": [
                {"source": "my_concept", "target": "entropy", "relation": "analogy"}
            ],
        },
    }

    synced = db.sync_user_state(user_id, payload, temp_db)
    assert synced["profile"]["xp"] == 150
    assert set(synced["visited"]) == {"entropy", "information_theory", "bayes_theorem"}
    assert "p_entropy" in synced["problems"]
    assert synced["problems"]["p_entropy"]["complete"] is True
    assert "entropy_and_shannon" in synced["challenges"]
    assert synced["challenges"]["entropy_and_shannon"]["solved"] is True
    assert len(synced["flashcards"]) == 1
    assert synced["flashcards"][0]["id"] == "fc_1"
    assert synced["flashcards"][0]["interval"] == 6
    assert len(synced["customGraph"]["nodes"]) == 1
    assert synced["customGraph"]["nodes"][0]["id"] == "my_concept"
    assert len(synced["customGraph"]["links"]) == 1


def test_export_and_import_backup(temp_db: Path):
    user_id = "backup_user"
    db.create_profile(user_id, "Backup User", "📦", temp_db)

    state = {
        "xp": 300,
        "visited": ["turing_machine"],
        "flashcards": [
            {
                "id": "fc_backup",
                "front": "Máquina de Turing",
                "back": "Modelo formal de computación",
                "tags": ["technology"],
            }
        ],
    }
    db.sync_user_state(user_id, state, temp_db)

    backup = db.export_backup(user_id, temp_db)
    assert backup["polymath_version"] == "1.0.0"
    assert "exported_at" in backup
    assert "turing_machine" in backup["visited"]

    # Restaurar en otro usuario
    restored = db.import_backup("restored_user", backup, temp_db)
    assert restored["profile"]["id"] == "restored_user"
    assert "turing_machine" in restored["visited"]
    assert any(fc["id"] == "fc_backup" for fc in restored["flashcards"])


def test_api_endpoints_for_user_persistence():
    client = TestClient(app)

    # 1. Health check includes database info
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json().get("database") == "sqlite_local"

    # 2. List profiles
    res_prof = client.get("/api/user/profiles")
    assert res_prof.status_code == 200
    assert isinstance(res_prof.json(), list)

    # 3. Create profile
    res_new = client.post("/api/user/profiles", json={"name": "Alquimista", "avatar": "⚗️"})
    assert res_new.status_code == 200
    prof = res_new.json()
    assert prof["name"] == "Alquimista"

    uid = prof["id"]

    # 4. Sync state
    sync_payload = {
        "user_id": uid,
        "xp": 80,
        "visited": ["scientific_method"],
        "flashcards": [
            {
                "id": "fc_api_1",
                "front": "Método Científico",
                "back": "Observación, hipótesis, experimentación",
            }
        ],
    }
    res_sync = client.post("/api/user/sync", json=sync_payload)
    assert res_sync.status_code == 200
    state = res_sync.json()
    assert state["profile"]["xp"] == 80
    assert "scientific_method" in state["visited"]

    # 5. Get state
    res_get = client.get(f"/api/user/state?user_id={uid}")
    assert res_get.status_code == 200
    assert res_get.json()["profile"]["id"] == uid

    # 6. Export backup
    res_export = client.get(f"/api/user/backup/export?user_id={uid}")
    assert res_export.status_code == 200
    b_data = res_export.json()
    assert b_data["polymath_version"] == "1.0.0"

    # 7. Import backup
    res_import = client.post("/api/user/backup/import", json={"user_id": uid, "backup": b_data})
    assert res_import.status_code == 200
    assert res_import.json()["profile"]["id"] == uid
