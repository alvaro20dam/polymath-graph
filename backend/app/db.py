"""Gestor de persistencia relacional local en SQLite para Polymath Graph.

Almacena perfiles de usuario, avance en el grafo, historial socrático,
desafíos interdisciplinarios, flashcards con repetición espaciada (SM-2)
y nodos/enlaces personalizados en data/polymath.db.
"""
from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any

from . import data


def get_db_path() -> Path:
    """Obtiene la ruta del archivo de base de datos SQLite."""
    return data.data_dir() / "polymath.db"


def get_connection(db_path: Path | str | None = None) -> sqlite3.Connection:
    path = Path(db_path) if db_path else get_db_path()
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db(db_path: Path | str | None = None) -> None:
    """Crea las tablas necesarias si no existen y asegura el perfil por defecto."""
    with get_connection(db_path) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS profiles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                avatar TEXT DEFAULT '🧙‍♂️',
                xp INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS progress (
                user_id TEXT NOT NULL,
                node_id TEXT NOT NULL,
                visited_at TEXT NOT NULL,
                PRIMARY KEY (user_id, node_id),
                FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS problems (
                user_id TEXT NOT NULL,
                problem_id TEXT NOT NULL,
                node_id TEXT NOT NULL,
                mastered_json TEXT DEFAULT '[]',
                hints_json TEXT DEFAULT '{}',
                complete INTEGER DEFAULT 0,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, problem_id),
                FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS challenges (
                user_id TEXT NOT NULL,
                challenge_id TEXT NOT NULL,
                solved INTEGER DEFAULT 0,
                xp INTEGER DEFAULT 0,
                domains_json TEXT DEFAULT '[]',
                score REAL DEFAULT 0.0,
                reasoning TEXT DEFAULT '',
                feedback TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, challenge_id),
                FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS flashcards (
                id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                front TEXT NOT NULL,
                back TEXT NOT NULL,
                node_id TEXT DEFAULT '',
                tags_json TEXT DEFAULT '[]',
                reps INTEGER DEFAULT 0,
                interval INTEGER DEFAULT 1,
                ease REAL DEFAULT 2.5,
                due_date TEXT DEFAULT '',
                history_json TEXT DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, id),
                FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS custom_nodes (
                id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                label TEXT NOT NULL,
                domain TEXT NOT NULL,
                complexity INTEGER DEFAULT 3,
                year INTEGER DEFAULT 2026,
                authors_json TEXT DEFAULT '[]',
                summary TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, id),
                FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS custom_links (
                user_id TEXT NOT NULL,
                source TEXT NOT NULL,
                target TEXT NOT NULL,
                relation TEXT DEFAULT 'influences',
                PRIMARY KEY (user_id, source, target),
                FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS duels (
                id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                thinker_id TEXT NOT NULL,
                topic TEXT NOT NULL,
                won INTEGER DEFAULT 0,
                average_rigor REAL DEFAULT 70.0,
                xp INTEGER DEFAULT 0,
                rounds_json TEXT DEFAULT '[]',
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, id),
                FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
            );
            """
        )

        # Crear perfil por defecto si no hay ninguno
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) AS c FROM profiles")
        if cur.fetchone()["c"] == 0:
            now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            cur.execute(
                "INSERT INTO profiles (id, name, avatar, xp, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                ("default", "Polímata Principal", "🧙‍♂️", 0, now, now),
            )
        conn.commit()


def list_profiles(db_path: Path | str | None = None) -> list[dict[str, Any]]:
    with get_connection(db_path) as conn:
        rows = conn.execute("SELECT id, name, avatar, xp, created_at, updated_at FROM profiles ORDER BY created_at ASC").fetchall()
        return [dict(r) for r in rows]


def get_profile(user_id: str, db_path: Path | str | None = None) -> dict[str, Any] | None:
    with get_connection(db_path) as conn:
        row = conn.execute("SELECT id, name, avatar, xp, created_at, updated_at FROM profiles WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None


def create_profile(user_id: str, name: str, avatar: str = "🧙‍♂️", db_path: Path | str | None = None) -> dict[str, Any]:
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with get_connection(db_path) as conn:
        conn.execute(
            """
            INSERT INTO profiles (id, name, avatar, xp, created_at, updated_at)
            VALUES (?, ?, ?, 0, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                avatar = excluded.avatar,
                updated_at = excluded.updated_at
            """,
            (user_id, name.strip() or "Nuevo Polímata", avatar or "🧙‍♂️", now, now),
        )
        conn.commit()
    return get_profile(user_id, db_path) or {}


def get_user_state(user_id: str = "default", db_path: Path | str | None = None) -> dict[str, Any]:
    """Recupera el estado completo de un usuario para hidratar el frontend."""
    profile = get_profile(user_id, db_path)
    if not profile:
        profile = create_profile(user_id, "Polímata", "🧙‍♂️", db_path)

    with get_connection(db_path) as conn:
        # 1. Nodos visitados
        visited_rows = conn.execute(
            "SELECT node_id FROM progress WHERE user_id = ? ORDER BY visited_at ASC", (user_id,)
        ).fetchall()
        visited = [r["node_id"] for r in visited_rows]

        # 2. Problemas socráticos
        prob_rows = conn.execute(
            "SELECT problem_id, node_id, mastered_json, hints_json, complete FROM problems WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        problems = {}
        for r in prob_rows:
            problems[r["problem_id"]] = {
                "node": r["node_id"],
                "mastered": json.loads(r["mastered_json"] or "[]"),
                "hints": json.loads(r["hints_json"] or "{}"),
                "complete": bool(r["complete"]),
            }

        # 3. Retos completados
        ch_rows = conn.execute(
            "SELECT challenge_id, solved, xp, domains_json, score, reasoning, feedback, created_at FROM challenges WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        challenges = {}
        for r in ch_rows:
            challenges[r["challenge_id"]] = {
                "solved": bool(r["solved"]),
                "xp": r["xp"],
                "domains": json.loads(r["domains_json"] or "[]"),
                "score": r["score"],
                "reasoning": r["reasoning"],
                "feedback": r["feedback"],
                "date": r["created_at"],
            }

        # 4. Flashcards
        fc_rows = conn.execute(
            "SELECT id, front, back, node_id, tags_json, reps, interval, ease, due_date, history_json FROM flashcards WHERE user_id = ? ORDER BY created_at ASC",
            (user_id,),
        ).fetchall()
        flashcards = []
        for r in fc_rows:
            flashcards.append({
                "id": r["id"],
                "front": r["front"],
                "back": r["back"],
                "nodeId": r["node_id"],
                "tags": json.loads(r["tags_json"] or "[]"),
                "reps": r["reps"],
                "interval": r["interval"],
                "ease": r["ease"],
                "dueDate": r["due_date"],
                "history": json.loads(r["history_json"] or "[]"),
            })

        # 5. Nodos y Enlaces personalizados
        cn_rows = conn.execute(
            "SELECT id, label, domain, complexity, year, authors_json, summary FROM custom_nodes WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        custom_nodes = []
        for r in cn_rows:
            custom_nodes.append({
                "id": r["id"],
                "label": r["label"],
                "domain": r["domain"],
                "complexity": r["complexity"],
                "year": r["year"],
                "authors": json.loads(r["authors_json"] or "[]"),
                "summary": r["summary"],
                "custom": True,
            })

        cl_rows = conn.execute(
            "SELECT source, target, relation FROM custom_links WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        custom_links = [dict(r) for r in cl_rows]

        # 6. Duelos dialécticos
        duel_rows = conn.execute(
            "SELECT id, thinker_id, topic, won, average_rigor, xp, rounds_json, created_at FROM duels WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        duels = {}
        for r in duel_rows:
            duels[r["id"]] = {
                "thinkerId": r["thinker_id"],
                "topic": r["topic"],
                "won": bool(r["won"]),
                "averageRigor": r["average_rigor"],
                "xp": r["xp"],
                "rounds": json.loads(r["rounds_json"] or "[]"),
                "date": r["created_at"],
            }

    return {
        "profile": profile,
        "visited": visited,
        "problems": problems,
        "challenges": challenges,
        "duels": duels,
        "xp": profile.get("xp", 0),
        "flashcards": flashcards,
        "customGraph": {
            "nodes": custom_nodes,
            "links": custom_links,
        },
    }


def sync_user_state(user_id: str, payload: dict[str, Any], db_path: Path | str | None = None) -> dict[str, Any]:
    """Sincroniza y persiste el estado completo enviado por el frontend."""
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with get_connection(db_path) as conn:
        # Asegurar perfil
        profile = get_profile(user_id, db_path)
        if not profile:
            create_profile(user_id, "Polímata", "🧙‍♂️", db_path)

        # Actualizar XP y fecha de perfil si viene especificado
        new_xp = payload.get("xp")
        if new_xp is not None:
            conn.execute("UPDATE profiles SET xp = ?, updated_at = ? WHERE id = ?", (int(new_xp), now, user_id))

        # 1. Nodos visitados
        visited = payload.get("visited")
        if isinstance(visited, list):
            for node_id in visited:
                if isinstance(node_id, str) and node_id.strip():
                    conn.execute(
                        "INSERT OR IGNORE INTO progress (user_id, node_id, visited_at) VALUES (?, ?, ?)",
                        (user_id, node_id.strip(), now),
                    )

        # 2. Problemas socráticos
        problems = payload.get("problems")
        if isinstance(problems, dict):
            for prob_id, pdata in problems.items():
                if isinstance(pdata, dict):
                    node_id = str(pdata.get("node", ""))
                    mastered = json.dumps(pdata.get("mastered", []))
                    hints = json.dumps(pdata.get("hints", {}))
                    complete = 1 if pdata.get("complete") else 0
                    conn.execute(
                        """
                        INSERT INTO problems (user_id, problem_id, node_id, mastered_json, hints_json, complete, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(user_id, problem_id) DO UPDATE SET
                            mastered_json = excluded.mastered_json,
                            hints_json = excluded.hints_json,
                            complete = excluded.complete,
                            updated_at = excluded.updated_at
                        """,
                        (user_id, str(prob_id), node_id, mastered, hints, complete, now),
                    )

        # 3. Retos completados
        challenges = payload.get("challenges")
        if isinstance(challenges, dict):
            for ch_id, ch_data in challenges.items():
                if isinstance(ch_data, dict):
                    solved = 1 if ch_data.get("solved") else 0
                    xp = int(ch_data.get("xp", 0))
                    domains = json.dumps(ch_data.get("domains", []))
                    score = float(ch_data.get("score", 0.0))
                    reasoning = str(ch_data.get("reasoning", ""))
                    feedback = str(ch_data.get("feedback", ""))
                    conn.execute(
                        """
                        INSERT INTO challenges (user_id, challenge_id, solved, xp, domains_json, score, reasoning, feedback, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(user_id, challenge_id) DO UPDATE SET
                            solved = excluded.solved,
                            xp = excluded.xp,
                            domains_json = excluded.domains_json,
                            score = excluded.score,
                            reasoning = excluded.reasoning,
                            feedback = excluded.feedback
                        """,
                        (user_id, str(ch_id), solved, xp, domains, score, reasoning, feedback, now),
                    )

        # 4. Flashcards
        flashcards = payload.get("flashcards")
        if isinstance(flashcards, list):
            existing_fc_ids = set()
            for fc in flashcards:
                if isinstance(fc, dict) and fc.get("id"):
                    fc_id = str(fc["id"])
                    existing_fc_ids.add(fc_id)
                    front = str(fc.get("front", ""))
                    back = str(fc.get("back", ""))
                    node_id = str(fc.get("nodeId", ""))
                    tags = json.dumps(fc.get("tags", []))
                    reps = int(fc.get("reps", 0))
                    interval = int(fc.get("interval", 1))
                    ease = float(fc.get("ease", 2.5))
                    due_date = str(fc.get("dueDate", ""))
                    history = json.dumps(fc.get("history", []))

                    conn.execute(
                        """
                        INSERT INTO flashcards (id, user_id, front, back, node_id, tags_json, reps, interval, ease, due_date, history_json, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(user_id, id) DO UPDATE SET
                            front = excluded.front,
                            back = excluded.back,
                            node_id = excluded.node_id,
                            tags_json = excluded.tags_json,
                            reps = excluded.reps,
                            interval = excluded.interval,
                            ease = excluded.ease,
                            due_date = excluded.due_date,
                            history_json = excluded.history_json,
                            updated_at = excluded.updated_at
                        """,
                        (fc_id, user_id, front, back, node_id, tags, reps, interval, ease, due_date, history, now, now),
                    )

        # 5. Nodos y Enlaces personalizados
        custom_graph = payload.get("customGraph") or {}
        custom_nodes = custom_graph.get("nodes") or payload.get("customNodes") or []
        custom_links = custom_graph.get("links") or payload.get("customLinks") or []

        if isinstance(custom_nodes, list):
            for cn in custom_nodes:
                if isinstance(cn, dict) and cn.get("id"):
                    nid = str(cn["id"])
                    label = str(cn.get("label", nid))
                    domain = str(cn.get("domain", "science"))
                    complexity = int(cn.get("complexity", 3))
                    year = int(cn.get("year", 2026))
                    authors = json.dumps(cn.get("authors", []))
                    summary = str(cn.get("summary", ""))

                    conn.execute(
                        """
                        INSERT INTO custom_nodes (id, user_id, label, domain, complexity, year, authors_json, summary, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(user_id, id) DO UPDATE SET
                            label = excluded.label,
                            domain = excluded.domain,
                            complexity = excluded.complexity,
                            year = excluded.year,
                            authors_json = excluded.authors_json,
                            summary = excluded.summary
                        """,
                        (nid, user_id, label, domain, complexity, year, authors, summary, now),
                    )

        if isinstance(custom_links, list):
            for cl in custom_links:
                if isinstance(cl, dict) and cl.get("source") and cl.get("target"):
                    s = str(cl["source"])
                    t = str(cl["target"])
                    rel = str(cl.get("relation", "influences"))
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO custom_links (user_id, source, target, relation)
                        VALUES (?, ?, ?, ?)
                        """,
                        (user_id, s, t, rel),
                    )

        # 6. Duelos dialécticos
        duels = payload.get("duels")
        if isinstance(duels, dict):
            for duel_id, d_data in duels.items():
                if isinstance(d_data, dict):
                    thinker_id = str(d_data.get("thinkerId", "socrates"))
                    topic = str(d_data.get("topic", ""))
                    won = 1 if d_data.get("won") else 0
                    average_rigor = float(d_data.get("averageRigor", 70.0))
                    xp = int(d_data.get("xp", 0))
                    rounds = json.dumps(d_data.get("rounds", []))
                    conn.execute(
                        """
                        INSERT INTO duels (id, user_id, thinker_id, topic, won, average_rigor, xp, rounds_json, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(user_id, id) DO UPDATE SET
                            thinker_id = excluded.thinker_id,
                            topic = excluded.topic,
                            won = excluded.won,
                            average_rigor = excluded.average_rigor,
                            xp = excluded.xp,
                            rounds_json = excluded.rounds_json
                        """,
                        (str(duel_id), user_id, thinker_id, topic, won, average_rigor, xp, rounds, now),
                    )

        conn.commit()

    return get_user_state(user_id, db_path)


def export_backup(user_id: str = "default", db_path: Path | str | None = None) -> dict[str, Any]:
    """Exporta el respaldo completo del usuario a un diccionario JSON."""
    state = get_user_state(user_id, db_path)
    state["polymath_version"] = "1.0.0"
    state["exported_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    return state


def import_backup(user_id: str, backup_dict: dict[str, Any], db_path: Path | str | None = None) -> dict[str, Any]:
    """Restaura un respaldo JSON sobreescribiendo o fusionando los datos del usuario."""
    return sync_user_state(user_id, backup_dict, db_path)
