# 📘 Manual de Usuario y Guía Maestra de Pruebas · Polymath Graph (v2.0)

¡Bienvenido a **Polymath Graph**! Esta guía completa está diseñada para que cualquier persona (evaluadores, desarrolladores, docentes o estudiantes) pueda recorrer, probar y verificar paso a paso cada uno de los módulos y capacidades de la plataforma.

---

## 📑 Índice General

1. [¿Qué es Polymath Graph?](#1-qué-es-polymath-graph)
2. [Puesta en marcha y accesos](#2-puesta-en-marcha-y-accesos)
3. [Pruebas Automatizadas (CI / Test Suite)](#3-pruebas-automatizadas-ci--test-suite)
4. [Recorrido de Pruebas Módulo por Módulo](#4-recorrido-de-pruebas-módulo-por-módulo)
   - [Módulo 1: Grafo de Conocimiento Interdisciplinario (◉ Grafo)](#módulo-1-grafo-de-conocimiento-interdisciplinario--grafo)
   - [Módulo 2: Desafío Polímata y Radar de Competencias (🎯 Desafío)](#módulo-2-desafío-polímata-y-radar-de-competencias--desafío)
   - [Módulo 3: Tutor Socrático y Pizarra Multimodal (❓ Tutor socrático)](#módulo-3-tutor-socrático-y-pizarra-multimodal--tutor-socrático)
   - [Módulo 4: Lector Aumentado Split-Screen con Grafo Activo (📖 Explicador)](#módulo-4-lector-aumentado-split-screen-con-grafo-activo--explicador)
   - [Módulo 5: Laboratorio de Simulaciones Visuales (🧪 Laboratorio)](#módulo-5-laboratorio-de-simulaciones-visuales--laboratorio)
   - [Módulo 6: Lógica, Falacias y Duelo Dialéctico 1 vs 1 (⚖ Lógica y falacias)](#módulo-6-lógica-falacias-y-duelo-dialéctico-1-vs-1--lógica-y-falacias)
   - [Módulo 7: Navegador por Eras y Buscador de Puentes Ocultos (⏳ Líneas de tiempo)](#módulo-7-navegador-por-eras-y-buscador-de-puentes-ocultos--líneas-de-tiempo)
   - [Módulo 8: Repaso Espaciado y Exportador Universal (🗂 Repaso)](#módulo-8-repaso-espaciado-y-exportador-universal--repaso)
5. [Persistencia SQLite Local (`data/polymath.db`)](#5-persistencia-sqlite-local-datapolymathdb)
6. [Pruebas de la API (Swagger UI)](#6-pruebas-de-la-api-swagger-ui)
7. [Preguntas Frecuentes y Resolución de Problemas](#7-preguntas-frecuentes-y-resolución-de-problemas)

---

## 1. ¿Qué es Polymath Graph?

Polymath Graph es una plataforma de aprendizaje interdisciplinario que conecta **Filosofía, Ciencia, Tecnología, Historia, Lógica y Arte**.

* **Arquitectura Híbrida Offline-First:** Toda la plataforma corre 100% de forma autónoma en el navegador con motores deterministas locales. Si se configura una API key de Gemini, se activa automáticamente la aceleración por IA en la nube.
* **Persistencia Local SQLite (`data/polymath.db`):** Tu progreso (XP, problemas resueltos, duelos, flashcards, retos) se guarda automáticamente en una base de datos local SQLite y se replica en el `localStorage` del navegador.
* **Exportador Universal:** Exporta tus apuntes y conexiones directamente a mazos de **Anki** (`.apkg` y `.tsv`) y bóvedas completas de **Obsidian** (`.zip` con enlaces bidireccionales `[[wikilinks]]`).

---

## 2. Puesta en marcha y accesos

### Opción A: Modo Servidor Completo (Recomendado)
Abre PowerShell o tu terminal y ejecuta:

```powershell
cd C:\DESARROLLO\polymath-graph
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
```

Una vez que veas `Application startup complete`:
* 🌐 **Plataforma Web:** [http://127.0.0.1:8000](http://127.0.0.1:8000)
* 📖 **Documentación Swagger API:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

### Opción B: Modo Desarrollo Frontend (Vite)
```powershell
cd C:\DESARROLLO\polymath-graph\frontend
npm run dev
# Acceso en: http://localhost:5173
```

---

## 3. Pruebas Automatizadas (CI / Test Suite)

La plataforma cuenta con una batería completa de pruebas unitarias y de integración que validan tanto el backend en Python como los motores del frontend en JavaScript:

```powershell
# 1. Pruebas del Backend (51 tests de API, DB, exportador, skills y LLM)
python -m pytest backend/tests -v -p no:cacheprovider

# 2. Pruebas del Frontend (33 tests de motores lógicos, SRS, puentes y RAG)
npm run --prefix frontend test

# 3. Compilación de producción (Vite bundle)
npm run --prefix frontend build
```

**Resultado esperado:** 51 passed en backend, 33 passed en frontend y build generado en `< 2s`.

---

## 4. Recorrido de Pruebas Módulo por Módulo

---

### Módulo 1: Grafo de Conocimiento Interdisciplinario (◉ Grafo)
*URL directa:* `http://127.0.0.1:8000/#/graph`

El grafo cuenta con **71 nodos conceptuales** y **131 aristas semánticas** impulsadas por física dinámica de fuerzas (D3.js).

#### 🧪 Pasos para probar:
1. **Física e interacción:**
   - Arrastra cualquier nodo con el ratón y observa la elasticidad de los resortes.
   - Usa la rueda del ratón para hacer zoom in/out y arrastra el fondo para desplazarte.
2. **Filtrado por disciplinas:**
   - En la barra lateral izquierda, desmarca y marca disciplinas (ej. deja solo *Ciencia* y *Filosofía*). Observa cómo se aíslan los conceptos relevantes.
3. **Buscador TF-IDF:**
   - Escribe en la caja de búsqueda: `entropia` o `turing`.
   - Haz clic en el resultado sugerido: la cámara centrará el nodo, abrirá su panel de metadatos y trazará sus enlaces.
4. **Camino más corto entre ideas ("Pathfinding"):**
   - En el panel de caminos (inferior/lateral):
     - Origen: `Lógica aristotélica`
     - Destino: `Transformers y LLMs`
   - Pulsa **Calcular camino**.
   - **Resultado:** Traza la ruta óptima en verde esmeralda: `Lógica aristotélica` ➔ `IA simbólica` ➔ `Redes neuronales` ➔ `Transformers y LLMs`.
5. **Modo Madriguera ("Rabbit Hole"):**
   - Toca cualquier nodo y pulsa **Aislar vecindad (1 salto)** para concentrarte únicamente en su clúster de ideas directas.

---

### Módulo 2: Desafío Polímata y Radar de Competencias (🎯 Desafío)
*URL directa:* `http://127.0.0.1:8000/#/challenge`

Módulo de gamificación y nivelación adaptativa que evalúa tu capacidad para conectar ideas entre diferentes áreas del conocimiento.

#### 🧪 Pasos para probar:
1. **Perfil y Radar Hexagonal:**
   - Observa tu tarjeta de nivel polímata: XP acumulado, nivel actual (*Iniciado*, *Polímata Aprendiz*, etc.) y medallas desbloqueadas.
   - Observa el **Radar de Competencias SVG**: un hexágono dinámico que mide tu maestría en las 6 disciplinas (Filosofía, Ciencia, Lógica, Tecnología, Historia y Arte).
2. **Selector de Cruce Interdisciplinario:**
   - Elige un cruce, por ejemplo:
     - Disciplina 1: `Ciencia`
     - Disciplina 2: `Tecnología`
     - Nivel: `Intermedio`
   - Pulsa **Generar Reto**.
3. **Responder el Reto y Justificar:**
   - Lee la pregunta interdisciplinaria (ej. relación entre el principio de Landauer, la memoria de cómputo y la entropía).
   - Selecciona la opción que consideres correcta.
   - En la caja *Justifica tu deducción*, escribe tu razonamiento y pulsa **Enviar Respuesta**.
4. **Resultado esperado:**
   - Recibes retroalimentación inmediata, puntuación de rigor y puntos de experiencia (**XP**).
   - Tu radar hexagonal se actualiza en tiempo real reflejando el incremento en las disciplinas evaluadas.
   - Se desbloquea la medalla correspondiente (*Primer Puente*, *Maestro Interdisciplinario*).

---

### Módulo 3: Tutor Socrático y Pizarra Multimodal (❓ Tutor socrático)
*URL directa:* `http://127.0.0.1:8000/#/tutor`

Inspirado en la mayéutica: **el tutor nunca te da la solución directa**, sino que te plantea preguntas guía para que construyas la respuesta tú mismo.

#### 🧪 Pasos para probar (Problema: *El positivo que engaña*):
1. **Pizarra de Razonamiento:**
   - Selecciona en la columna izquierda: `El positivo que engaña` (Teorema de Bayes).
   - En la pizarra de dibujo, realiza un esquema libre con el lápiz.
   - En la caja *Escribe un paso de tu razonamiento...*, escribe:
     ```text
     Imaginemos 10.000 personas: 100 están enfermas según la prevalencia.
     ```
   - Pulsa **Añadir paso**.
   - **Resultado:** Se añade el paso y se ilumina el chip verde `✓ Tasa base (prior)`.
2. **Detección de Malentendidos Comunes:**
   - En el chat de la derecha, escribe el error típico:
     ```text
     La probabilidad de estar enfermo es del 90% porque el test tiene 90% de sensibilidad.
     ```
   - Pulsa **Enviar**.
   - **Resultado:** El tutor detecta la confusión entre sensibilidad y probabilidad posterior y responde: *"Parece que estás dando la sensibilidad... pero ¿qué ocurre con los falsos positivos en los sanos?"*.
3. **Pistas Progresivas:**
   - Pulsa el botón **`💡 Pista`**. Recibirás la Pista 1/3, luego 2/3 y 3/3 de forma dosificada.
4. **Resolución:**
   - Envía el cálculo final:
     ```text
     Los sanos con falsos positivos son 891 y los enfermos detectados son 90; el posterior es 90 / 981 = 9,2%.
     ```
   - **Resultado:** ¡Celebración socrática! Se genera el **Plan de estudio adaptativo** con recomendaciones del grafo y se guarda en tu progreso.

---

### Módulo 4: Lector Aumentado Split-Screen con Grafo Activo (📖 Explicador)
*URL directa:* `http://127.0.0.1:8000/#/explainer`

Entorno de lectura asistida con análisis de documentos y subred conceptual en vivo.

#### 🧪 Pasos para probar:
1. **Selector de Modo (Superior Derecho):**
   - Asegúrate de estar en el modo **`🌐 Grafo Activo (Split-Screen)`**.
2. **Carga de Documento:**
   - Selecciona el texto de muestra: **`Ensayo: razonar con incertidumbre`** o pulsa **`📄 Subir PDF o texto`** para subir cualquier PDF técnico.
   - Observa el **Banner de Resumen Polímata**:
     - Contador de conceptos, autores y puentes transdisciplinarios detectados.
     - **Barra de distribución por disciplinas**: muestra el % de Ciencia, Filosofía y Lógica presente en el documento.
3. **Reactividad Texto ➔ Grafo:**
   - Pasa el cursor sobre los párrafos del texto a la izquierda.
   - **Resultado:** En el grafo D3 de la derecha, los nodos correspondientes a las ideas de ese párrafo **se iluminan con un halo brillante**, se agrandan y destacan sus conexiones mientras los demás se atenúan.
4. **Navegación Bidireccional Grafo ➔ Texto:**
   - Haz clic en cualquier nodo del grafo (ej. `Teorema de Bayes` o `Falsacionismo`).
   - **Resultado:** El lector de la izquierda se desplaza automáticamente (*smooth scroll*) al párrafo donde se menciona el concepto y emite una animación de resplandor.
   - Debajo del grafo se abre el **Inspector de Concepto** con definición, autores, y botones para *Guardar en Anki* o *Explicar*.
5. **Modo Puentes (`🌉 Ver Puentes`):**
   - Pulsa el botón **`🌉 Ver Puentes`** sobre el grafo para visualizar las conexiones transdisciplinarias que unen ideas de diferentes ramas dentro de tu lectura.

---

### Módulo 5: Laboratorio de Simulaciones Visuales (🧪 Laboratorio)
*URL directa:* `http://127.0.0.1:8000/#/lab`

Simulaciones interactivas en tiempo real renderizadas en Canvas HTML5.

#### 🧪 Pasos para probar:
1. **Ley de los Grandes Números y Varianza:**
   - Pulsa **Lanzar dados** (100 o 1000 tiradas rápidas).
   - Observa la curva gráfica converger de forma continua hacia la esperanza teórica de `3.5`.
2. **Inferencia Bayesiana Visual:**
   - Modifica los deslizadores de *Prevalencia*, *Sensibilidad* y *Falsos Positivos*.
   - Observa el diagrama de frecuencias naturales para entender por qué la tasa base domina el resultado.
3. **Descenso del Gradiente:**
   - Ajusta la tasa de aprendizaje ($\alpha$) y pulsa **Iniciar**.
   - Mira a la partícula descender por la superficie tridimensional buscando el mínimo global.
4. **Red Neuronal Interactiva (Problema XOR):**
   - Pulsa **Entrenar red**.
   - Mira en tiempo real cómo la superficie de decisión deforma el espacio bidimensional para separar los puntos no lineales.

---

### Módulo 6: Lógica, Falacias y Duelo Dialéctico 1 vs 1 (⚖ Lógica y falacias)
*URL directa:* `http://127.0.0.1:8000/#/logic`

Herramienta de pensamiento crítico con 24 falacias, 24 sesgos, evaluador formal y la nueva **Arena Dialéctica 1 vs 1**.

#### 🧪 Pasos para probar la Arena de Duelo:
1. Ve a la subpestaña **`Arena Dialéctica`** (botón morado superior).
2. Selecciona la modalidad **`⚔️ Duelo 1 vs 1 (Tú vs Pensador)`**.
3. Elige a tu contrincante entre las 12 figuras históricas (ej. **Sócrates**, **Friedrich Nietzsche** o **Karl Popper**).
4. Pulsa una tesis provocativa (ej. *«La virtud no se puede enseñar»* o *«La moralina debilita la voluntad humana»*) y pulsa **Comenzar Duelo**.
5. **Asaltos 1 a 3:**
   - Escribe tu argumento defendiendo tu postura.
   - Pulsa **Enviar Argumento**.
   - **Resultado en vivo:**
     - El **Medidor de Rigor Lógico (0-100)** analiza tu solidez argumental, conectores causales y premisas.
     - Detecta falacias o sesgos si incurres en ellos.
     - El pensador histórico te responde en primera persona refutando tus premisas con su estilo filosófico.
6. **Veredicto Final (Asalto 3):**
   - Tras el tercer asalto se emite el veredicto: *Victoria Dialéctica* o *Lección Socrática*, se asigna XP a tu perfil y puedes guardar la síntesis directamente en Anki.
   - Desbloquea medallas como *Contendiente Dialéctico* o *Martillo Lógico*.

---

### Módulo 7: Navegador por Eras y Buscador de Puentes Ocultos (⏳ Líneas de tiempo)
*URL directa:* `http://127.0.0.1:8000/#/timeline`

Explorador histórico y genealógico del conocimiento desde el 530 a.C. hasta el 2026.

#### 🧪 Pasos para probar:
1. **Navegador por Eras (Subpestaña 1):**
   - En la cinta superior de las 6 Eras, pulsa **`🏛️ Antigüedad Clásica`** o **`📜 Renacimiento & Rev. Científica`**.
   - Observa cómo se despliega el **Banner del Paradigma Histórico** y la cronología D3 se ajusta al periodo histórico seleccionado.
   - Haz clic en cualquier nodo (ej. *Cálculo infinitesimal*) para ver los arcos de influencia previa y posterior.
2. **Buscador de Puentes Transdisciplinarios (Subpestaña 2):**
   - Pulsa en **`🌉 Buscador de Puentes Ocultos`**.
   - Haz clic en el preset: **`🧠 De la Lógica Aristotélica a los Transformers`**.
   - **Resultado:**
     - Banner de síntesis: lapso temporal (+2,367 años) y eslabones de conexión.
     - **Stepper visual paso a paso**:
       - Paso 1: *Lógica aristotélica* (350 a.C., Lógica).
       - Paso 2: *IA simbólica* (1956 d.C., Tecnología).
       - Paso 3: *Redes neuronales* (1958 d.C., Tecnología).
       - Paso 4: *Transformers y LLMs* (2017 d.C., Tecnología).
     - Cada conector indica los $\Delta \text{años}$ y la relación epistemológica (*«formaliza»*, *«fundamenta»*).
   - Pulsa **`🌐 Ver Camino en el Grafo`** para abrir la ruta en D3 o **`🗂 Guardar en Anki`**.
3. **Escenarios Contrafactuales (Subpestaña 3):**
   - Prueba los escenarios: *¿Y si Enigma no se hubiera descifrado?*, *¿Y si la Biblioteca de Alejandría no se hubiera quemado?* o *¿Y si la imprenta se hubiera frenado?*.

---

### Módulo 8: Repaso Espaciado y Exportador Universal (🗂 Repaso)
*URL directa:* `http://127.0.0.1:8000/#/review`

Sistema de estudio basado en el algoritmo **SuperMemo SM-2 / Anki** integrado directamente en el navegador.

#### 🧪 Pasos para probar:
1. **Sesión de Repaso Activo:**
   - Si tienes tarjetas pendientes, pulsa **Iniciar sesión de repaso**.
   - Lee la pregunta frontal, pulsa **Mostrar respuesta** y califica tu recuerdo:
     - 🔴 *Otra vez* (1) · 🟡 *Difícil* (2) · 🟢 *Bien* (3) · 🔵 *Fácil* (4).
   - Observa cómo el intervalo de días se recalcula matemáticamente.
2. **Exportador Universal de Anki (.apkg y .tsv):**
   - Pulsa el botón **`📦 Descargar paquete Anki (.apkg)`**.
   - Se descargará el archivo `Polymath_Deck.apkg` generado nativamente con `genanki`. Haz doble clic para importarlo en Anki Desktop o AnkiDroid/AnkiMobile.
3. **Exportador a Bóveda de Obsidian (.zip):**
   - Pulsa **`📁 Descargar Bóveda Obsidian (.zip)`**.
   - Descomprime el archivo `.zip`: obtendrás una carpeta estructurada con carpetas por disciplina, notas markdown con metadatos YAML frontmatter y enlaces `[[wikilinks]]` interconectados listos para visualizar con el *Graph View* nativo de Obsidian.

---

## 5. Persistencia SQLite Local (`data/polymath.db`)

Polymath Graph cuenta con un motor de persistencia relacional local en SQLite:

* **Ubicación del archivo:** `data/polymath.db`.
* **Tablas:** `profiles`, `visited_nodes`, `problem_progress`, `challenges`, `duels`, `flashcards`, `custom_nodes`, `custom_links`.
* **Indicador en vivo:** En la barra superior de la interfaz, el botón verde `💾 SQLite Local (Activo)` confirma que cada acción se guarda automáticamente en disco con prevención de pérdida de datos.
* **Perfiles múltiples:** Puedes crear perfiles distintos (ej. *Polímata*, *Investigador*) y cambiar entre ellos sin alterar los datos del otro.
* **Copias de seguridad:** Dispones de endpoints en `/api/user/backup/export` e `/import` para respaldar tu base de datos completa en JSON portable.

---

## 6. Pruebas de la API (Swagger UI)

Para desarrolladores o evaluadores de backend:
👉 **[http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)**

| Endpoint | Método | Descripción | Parámetros de prueba |
|---|---|---|---|
| `/api/health` | `GET` | Diagnóstico de salud | Verifica estado de BD SQLite, nodos y LLM. |
| `/api/debate/duel` | `POST` | Duelo Dialéctico 1 vs 1 | `{"thinker_id": "socrates", "topic": "Virtud", "round_number": 1, "user_argument": "..."}` |
| `/api/document/analyze-graph` | `POST` | Análisis de subgrafo de texto | `{"text": "Alan Turing formalizó la máquina de Turing...", "max_bridging_hops": 1}` |
| `/api/timeline/eras` | `GET` | Catálogo de las 6 Eras | Lista eras históricas y distribución de nodos. |
| `/api/timeline/bridge` | `POST` | Puente ideológico evolutivo | `{"source_id": "aristotelian_logic", "target_id": "transformers"}` |
| `/api/export/anki` | `GET` | Generador de paquete `.apkg` | `user_id=default` (descarga binaria). |
| `/api/export/obsidian` | `GET` | Generador de bóveda `.zip` | `user_id=default` (descarga binaria). |

---

## 7. Preguntas Frecuentes y Resolución de Problemas

#### ¿Qué ocurre si no configuro una clave de API de Gemini?
Absolutamente nada se rompe. La plataforma opera en **Modo Local 100% Autónomo**: todos los motores (árbol socrático, falacias, RAG TF-IDF, duelos heurísticos, generación de subgrafos y puentes genealógicos) utilizan algoritmos matemáticos y heurísticos locales en Python y JavaScript.

#### ¿Dónde se guardan mis tarjetas de Anki y progresos de duelo?
Se guardan simultáneamente en dos capas:
1. En el archivo SQLite local `data/polymath.db` en el backend.
2. En el `localStorage` de tu navegador para soporte offline.

#### ¿Cómo ejecuto todas las pruebas del sistema de una sola vez?
Ejecuta el script unificado de pipeline:
```powershell
python scripts/pipeline.py
```
Este script valida: integridad del grafo JSON ➔ 51 tests de Pytest ➔ 33 tests de Vitest ➔ Build de producción en Vite.

---
*Manual generado para Polymath Graph v2.0 · Creado para la exploración del conocimiento interconectado.*
