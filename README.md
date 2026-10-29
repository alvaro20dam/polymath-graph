# Polymath Graph

Plataforma web para explorar el conocimiento interconectado entre **Filosofía, Ciencia, Tecnología, Historia, Lógica/Matemática y Arte**. Sin registro, sin cuentas: el progreso vive solo en el `localStorage` del navegador.

| Módulo | Qué hace |
|---|---|
| **Grafo** | 71 nodos y 131 aristas semánticas (D3 force). Filtros por disciplina y complejidad, búsqueda TF-IDF, panel lateral, "modo madriguera" (vecindad a N saltos), camino más corto entre ideas y 5 rutas de aprendizaje. |
| **Tutor socrático** | 7 problemas con pizarra de dibujo, pasos escritos, preguntas guiadas, pistas progresivas (nunca entrega la solución), detección de malentendidos, mapa de brechas y plan de estudio adaptativo. |
| **Explicador** | Selecciona texto y obtén explicaciones en 3 niveles (principiante/intermedio/experto), ES/EN, traducción de jerga y **chat con el documento** (RAG extractivo con citas). |
| **Laboratorio** | Simulaciones en Canvas: esperanza/varianza/ley de grandes números, Bayes con frecuencias naturales, descenso del gradiente (con momento) y una red neuronal entrenable (XOR). |
| **Lógica y falacias** | 24 falacias + 24 sesgos con detección heurística, parser de estructura argumental, tarjetas, quiz, y laboratorio de lógica formal (tablas de verdad, validez con contraejemplo). |
| **Líneas de tiempo** | Cronología por disciplina generada desde los datos del grafo (con modo "reproducir historia") y 3 escenarios ramificados de historia alternativa. |

## Arranque rápido

```bash
# Frontend (autónomo, todos los motores corren en el navegador)
cd frontend && npm install && npm run dev        # http://localhost:5173

# API opcional (misma lógica en Python)
cd backend && python -m venv .venv && .venv/Scripts/activate   # (Linux/Mac: source .venv/bin/activate)
pip install -r requirements-dev.txt
uvicorn app.main:app --reload                   # http://localhost:8000/docs

# Todo en un contenedor (API + frontend estático)
docker build -t polymath-graph . && docker run -p 8000:8000 polymath-graph
```

Validación completa: `python scripts/pipeline.py` (grafo → pytest → vitest → build).

## Estructura

```
data/            Fuente única de verdad: graph, fallacies, socratic, glossary, samples, timelines (JSON)
scripts/         build_graph.py (GraphArchitect), pipeline.py (deployment_pipeline)
agents/          agents.json: definición del equipo AGY (prompts, skills, entregables)
frontend/        Vite + D3 (vanilla JS). src/engines = motores; src/modules = pestañas
backend/         FastAPI. app/skills.py = AGY Skills Library en Python; tests/ con pytest
.github/         CI + despliegue a GitHub Pages
```

### Equipo de agentes → implementación

| Agente | Skills | Dónde vive |
|---|---|---|
| GraphArchitect | `graph_node_builder`, `semantic_link_evaluator`, `citation_network_mapper` | `scripts/build_graph.py`, `backend/app/skills.py` |
| FrontendUIX | `d3_graph_renderer`, `interactive_canvas_builder`, `responsive_layout_manager` | `frontend/src/modules/graphView.js`, `lab.js`, `styles.css` |
| SocraticTutor | `socratic_hint_generator`, `mastery_gap_analyzer`, `adaptive_complexity_scaler`, `explainpaper_highlighter` | `engines/socratic.js`, `engines/explain.js` + Python |
| LogicVerifier | `fallacy_checker`, `bias_detector`, `argument_structure_parser` | `engines/fallacy.js`, `engines/logic.js` + Python |
| DevOps_Orchestrator | `fastapi_route_builder`, `vector_search_indexer`, `deployment_pipeline` | `backend/app/main.py`, `engines/rag.js`, `scripts/pipeline.py`, `Dockerfile`, CI |

### API (resumen)

`GET /api/graph`, `/api/graph/nodes/{id}`, `/api/graph/path?source=&target=`, `/api/search?q=` · `POST /api/fallacies/check`, `/api/explain`, `/api/rag/query`, `/api/socratic/{start,evaluate,hint,plan}` (sesiones sin estado: el cliente devuelve la sesión) · documentación interactiva en `/docs`.

## Despliegue

- **Estático** (recomendado): `npm run build` → `frontend/dist` en GitHub Pages/Netlify/Vercel (`base: './'`). El workflow `.github/workflows/ci.yml` lo publica en Pages al hacer push a `main` (activar *Settings → Pages → GitHub Actions*).
- **Contenedor**: `Dockerfile` unificado para Render, Fly.io, Cloud Run, etc.

## Alcance y limitaciones (honestidad técnica)

- **No hay LLM**. El tutor, el explicador y el detector de falacias son motores deterministas basados en reglas, patrones y glosarios curados. Funcionan sin red y son verificables, pero son más rígidos que un modelo generativo. El punto natural de extensión es sustituir `evaluate()` / `explain()` por una llamada a un LLM manteniendo las mismas firmas.
- La detección de falacias/sesgos es **heurística léxica** (español/inglés): produce falsos positivos y negativos. La UI lo advierte; la verificación formal (tablas de verdad) sí es exacta.
- El RAG usa **TF-IDF + coseno**, no embeddings neuronales; no se integró Supabase/pgvector (el progreso es local). Ambos son reemplazables sin tocar la UI.
- El tutor evalúa el **texto** de los pasos y el chat; los dibujos de la pizarra son borrador libre.
- El contenido del grafo, problemas y escenarios fue redactado para este proyecto; conviene una revisión editorial/académica antes de uso educativo formal. Los escenarios de historia alternativa son especulativos y así se indica.
