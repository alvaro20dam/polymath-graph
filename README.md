# 🌐 Polymath Graph (v2.0)

Plataforma interactiva de exploración del conocimiento interconectado entre **Filosofía, Ciencia, Tecnología, Historia, Lógica/Matemática y Arte**. 

Diseñada bajo una filosofía **Offline-First**, de alta privacidad y con arquitectura híbrida: funciona al 100% en local sin necesidad de claves externas, y se enriquece de forma transparente con **IA generativa (Gemini 3.5 Flash)** cuando está disponible.

---

## 🚀 Módulos de la Plataforma

| Módulo | Icono | Capacidades Principales |
|---|:---:|---|
| **Grafo** | `◉` | 71 nodos conceptuales y 131 conexiones semánticas (física D3.js). Filtros por disciplina y complejidad, búsqueda TF-IDF, panel de detalles, "modo madriguera" (vecindad de N saltos), camino más corto entre ideas (BFS) y rutas de aprendizaje. |
| **Desafío Polímata** | `🎯` | Nivelación adaptativa y **Radar Hexagonal de Competencias**. Banco de retos interdisciplinarios (ej. *Landauer y la Entropía*), evaluación de justificaciones, medallas de maestría y ganancia de XP. |
| **Tutor Socrático** | `❓` | 7 problemas fundamentales con **pizarra interactiva de dibujo**, pasos de razonamiento, preguntas guiadas, pistas progresivas, detección de malentendidos típicos y plan de estudio adaptativo. Soporte multimodal con visión para fórmulas matemáticas. |
| **Lector Split-Screen** | `📖` | Lector aumentado para PDFs y artículos técnicos. **Panel dual**: lectura de párrafos a la izquierda + **subgrafo semántico reactivo D3 en vivo** a la derecha, barra de distribución disciplinar, navegación bidireccional texto-grafo y chat RAG con citas exactas. |
| **Laboratorio** | `🧪` | Simulaciones visuales en Canvas HTML5: esperanza y varianza (Ley de los Grandes Números), inferencia bayesiana con frecuencias naturales, descenso del gradiente 3D con momento y red neuronal interactiva entrenable (problema XOR). |
| **Lógica & Falacias** | `⚖` | Catálogo interactivo de 24 falacias lógicas y 24 sesgos cognitivos. Evaluador de lógica formal (tablas de verdad y contraejemplos) y **Arena de Duelo Dialéctico 1 vs 1** contra 12 filósofos históricos (Sócrates, Nietzsche, Popper...) con medidor de rigor (0-100) en vivo y veredicto. |
| **Líneas de Tiempo** | `⏳` | **Navegador por las 6 Eras Históricas (530 a.C. — 2026)** con paradigmas de época y reproductor cronológico. **Buscador de Puentes Ocultos**: genealogía evolutiva paso a paso entre ideas separadas por milenios (ej. *Lógica Aristotélica ➔ Transformers*). Escenarios contrafactuales (*What if...?*). |
| **Repaso Espaciado** | `🗂` | Motor de estudio basado en el algoritmo **SuperMemo SM-2 / Anki** integrado. Muestra tarjetas pendientes hoy, intervalos y factor de facilidad. **Exportador Universal** en 1 clic a paquetes nativos de Anki (`.apkg` y `.tsv`) y bóvedas completas de Obsidian (`.zip`). |

---

## 💾 Persistencia Relacional Local (`data/polymath.db`)

A diferencia de las herramientas convencionales que pierden tus datos si borras las cookies del navegador:

* **Base de datos SQLite local:** Todo tu progreso (XP, retos resueltos, duelos dialécticos, tarjetas de estudio y nodos creados) se sincroniza en el archivo `data/polymath.db`.
* **Multi-perfil:** Soporte para múltiples perfiles locales (ej. *Polímata Principal*, *Investigador*).
* **Copias de seguridad portables:** Exportación e importación de backups completos en JSON desde `/api/user/backup/export`.
* **Doble capa de seguridad:** Sincronización continua entre `localStorage` y SQLite, con indicador visual en vivo `💾 SQLite Local (Activo)`.

---

## 📦 Exportador Universal (Anki & Obsidian)

Polymath Graph permite transformar tu investigación y estudio en artefactos listos para tu flujo de trabajo diario:

1. **Paquetes de Anki (`.apkg`):**
   - Generación nativa con `genanki` con estilos oscuros, etiquetas por disciplina y mazo personalizado.
   - Compatible directamente con **Anki Desktop**, **AnkiMobile (iOS)** y **AnkiDroid (Android)**.
2. **Bóvedas de Obsidian (`.zip`):**
   - Estructura jerárquica de carpetas por disciplina.
   - Notas en Markdown con metadatos YAML frontmatter, enlaces bidireccionales `[[wikilinks]]` entre ideas relacionadas y tags.
   - Lista para abrirse como bóveda y explorarse con el **Graph View** nativo de Obsidian.

---

## ⚡ Arranque Rápido

### 1. Servidor Completo (Recomendado)
```bash
# Iniciar API FastAPI y servicio estático del frontend en localhost:8000
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
```
Abre en tu navegador:
* 🌐 **Aplicación:** [http://127.0.0.1:8000](http://127.0.0.1:8000)
* 📖 **Documentación interactiva Swagger:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

### 2. Frontend en Modo Desarrollo (Vite)
```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

### 3. Contenedor Docker Unificado
```bash
docker build -t polymath-graph .
docker run -p 8000:8000 polymath-graph
```

---

## 🧪 Pruebas Automatizadas y Calidad

Ejecuta el pipeline completo de verificación continua:

```bash
# Ejecutar todas las pruebas del backend (51 tests)
python -m pytest backend/tests -v -p no:cacheprovider

# Ejecutar todas las pruebas del frontend (33 tests)
npm run --prefix frontend test

# Compilación de producción optimizada
npm run --prefix frontend build

# Pipeline unificado (Grafo -> Pytest -> Vitest -> Vite Build)
python scripts/pipeline.py
```

---

## 📂 Estructura del Proyecto

```
polymath-graph/
├── data/               # Fuente de verdad: graph.json, fallacies.json, thinkers.json, timelines.json, polymath.db
├── scripts/            # build_graph.py, pipeline.py
├── frontend/           # Interfaz SPA con Vite + D3.js (Vanilla JS modular)
│   ├── src/
│   │   ├── engines/    # Motores: docGraph.js, timelineEngine.js, srs.js, fallacy.js, logic.js, rag.js, socratic.js
│   │   ├── modules/    # Pestañas: explainer.js, timeline.js, debate.js, challengeView.js, flashcards.js, graphView.js, lab.js
│   │   ├── api.js      # Cliente de comunicación con backend y fallbacks offline
│   │   └── state.js    # Store central reactivo y sincronizador SQLite
│   └── tests/          # Suite de pruebas unitarias (Vitest)
├── backend/            # API FastAPI y Skills Library en Python
│   ├── app/
│   │   ├── main.py     # Endpoints REST (FastAPI)
│   │   ├── skills.py   # Implementación algorítmica de todas las habilidades
│   │   ├── db.py       # Capa de persistencia relacional SQLite
│   │   ├── export.py   # Exportador universal de Anki (.apkg) y Obsidian (.zip)
│   │   ├── llm.py      # Integración con Gemini 3.5 Flash (estructurado y visión)
│   │   └── schemas.py  # Modelos de datos Pydantic
│   └── tests/          # Pruebas automatizadas (Pytest)
├── MANUAL_DE_PRUEBAS.md # Guía paso a paso con scripts de prueba
└── README.md           # Este documento
```

---

## 🗺️ Hoja de Ruta y Escalabilidad

Para consultar el diagnóstico de arquitectura, estrategias de despliegue global (Turso/libSQL edge, microservicios serverless, RAG vectorial) y el modelo de negocio B2C/B2B institucional, consulta el [Plan de Escalabilidad y Monetización](file:///C:/DESARROLLO/polymath-graph/PLAN_ESCALABILIDAD_Y_MONETIZACION.md).

---
*Polymath Graph · Creado para la exploración del conocimiento interconectado.*
