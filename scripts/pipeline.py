"""deployment_pipeline: valida todo el proyecto de punta a punta.

    python scripts/pipeline.py            # grafo + tests backend + tests frontend + build
    python scripts/pipeline.py --skip-install
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NPM = shutil.which("npm") or shutil.which("npm.cmd")


def run(title: str, cmd: list[str], cwd: Path) -> None:
    print(f"\n=== {title} ===", flush=True)
    r = subprocess.run(cmd, cwd=cwd)
    if r.returncode:
        print(f"FALLO: {title}")
        sys.exit(r.returncode)
    print(f"OK {title}")


def main() -> None:
    skip_install = "--skip-install" in sys.argv
    run("Fase 1 · Construir y validar grafo", [sys.executable, "scripts/build_graph.py"], ROOT)
    run("Fase 4 · Tests backend (pytest)", [sys.executable, "-m", "pytest", "-q"], ROOT / "backend")
    if not NPM:
        sys.exit("npm no está instalado")
    if not skip_install:
        run("Instalar dependencias frontend", [NPM, "ci"] if (ROOT / "frontend" / "package-lock.json").exists() else [NPM, "install"], ROOT / "frontend")
    run("Fase 3 · Tests frontend (vitest)", [NPM, "test"], ROOT / "frontend")
    run("Fase 5 · Build de producción", [NPM, "run", "build"], ROOT / "frontend")
    print("\nOK - Pipeline completo. Artefacto estático: frontend/dist/")


if __name__ == "__main__":
    main()
