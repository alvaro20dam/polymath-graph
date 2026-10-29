"""Carga de los datos compartidos (data/*.json), fuente única de verdad para frontend y backend."""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path


def data_dir() -> Path:
    env = os.environ.get("POLYMATH_DATA_DIR")
    if env:
        return Path(env)
    here = Path(__file__).resolve()
    for cand in (here.parents[2] / "data", here.parents[1] / "data"):
        if cand.exists():
            return cand
    raise FileNotFoundError("No se encuentra el directorio data/. Define POLYMATH_DATA_DIR.")


@lru_cache(maxsize=None)
def load(name: str) -> dict:
    return json.loads((data_dir() / f"{name}.json").read_text(encoding="utf-8"))


def graph() -> dict:
    return load("graph")


def node_by_id() -> dict:
    return {n["id"]: n for n in graph()["nodes"]}
