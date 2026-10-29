# 📘 Manual de Usuario y Guía de Pruebas · Polymath Graph (v1.0)

¡Bienvenido a **Polymath Graph**! Esta guía está diseñada para que cualquier persona, sin importar su nivel técnico, pueda recorrer, probar y aprender con cada uno de los módulos de la plataforma.

---

## 📑 Índice
1. [¿Qué es Polymath Graph?](#1-qué-es-polymath-graph)
2. [Cómo iniciar y acceder a la aplicación](#2-cómo-iniciar-y-acceder-a-la-aplicación)
3. [Pruebas Módulo por Módulo](#3-pruebas-módulo-por-módulo)
   - [Módulo 1: Grafo de Conocimiento Interdisciplinario](#módulo-1-grafo-de-conocimiento-interdisciplinario-)
   - [Módulo 2: Tutor Socrático y Pizarra](#módulo-2-tutor-socrático-y-pizarra-)
   - [Módulo 3: Explicador In-Context & Chat RAG](#módulo-3-explicador-in-context--chat-rag-)
   - [Módulo 4: Laboratorio de Simulaciones Visuales](#módulo-4-laboratorio-de-simulaciones-visuales-)
   - [Módulo 5: Motor de Lógica y Falacias](#módulo-5-motor-de-lógica-y-falacias-)
   - [Módulo 6: Líneas de Tiempo e Historia Alternativa](#módulo-6-líneas-de-tiempo-e-historia-alternativa-)
4. [Pruebas de la API (Swagger para desarrolladores)](#4-pruebas-de-la-api-swagger)
5. [Preguntas Frecuentes y Solución de Problemas](#5-preguntas-frecuentes-y-resolución-de-problemas)

---

## 1. ¿Qué es Polymath Graph?

Es una plataforma de aprendizaje interdisciplinario que conecta **Filosofía, Ciencia, Tecnología, Historia, Lógica y Arte**. 

* **Sin registro ni contraseñas:** Tu progreso (ejercicios resueltos, quiz, notas) se guarda automáticamente en tu propio navegador (`localStorage`).
* **100% Local y Privado:** No envía tus datos a servidores externos.

---

## 2. Cómo iniciar y acceder a la aplicación

Abre tu terminal (PowerShell) y ejecuta:

```powershell
cd C:\DESARROLLO\polymath-graph\backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload
```

Una vez que veas el mensaje `Uvicorn running on http://127.0.0.1:8000`:
* 🌐 **Abre la Web:** [http://localhost:8000](http://localhost:8000)
* 📖 **Abre Swagger (API):** [http://localhost:8000/docs](http://localhost:8000/docs)

---

## 3. Pruebas Módulo por Módulo

---

### Módulo 1: Grafo de Conocimiento Interdisciplinario (◉ Grafo)
*URL directa:* `http://localhost:8000/#/graph`

El grafo contiene **71 nodos** conceptuales y **131 conexiones** históricas y semánticas impulsadas por física dinámica de fuerzas (D3.js).

#### 🧪 Pruebas sugeridas:
1. **Interacción libre:**
   - Haz clic y arrastra cualquier nodo. Observa cómo los demás reaccionan con elasticidad.
   - Usa la rueda del ratón para hacer zoom y arrastra el fondo para desplazarte.
2. **Filtrar por disciplina:**
   - En la barra lateral izquierda, desmarca y marca disciplinas (ej. deja solo *Filosofía* y *Tecnología*). Observa cómo se aíslan sus conexiones.
3. **Buscador:**
   - Escribe en la caja de búsqueda: `redes` o `entropia`. 
   - Haz clic en el resultado: la cámara centrará el nodo y abrirá su panel de detalles.
4. **Camino más corto entre dos ideas ("Pathfinding"):**
   - En el panel inferior o lateral busca la herramienta de caminos.
   - Origen: `Lógica aristotélica` ➔ Destino: `Redes neuronales`.
   - **Resultado esperado:** El algoritmo de camino más corto (BFS) optimiza la ruta mínima y encuentra la conexión en **2 saltos**: `Lógica aristotélica` ➔ `IA simbólica` ➔ `Redes neuronales`, iluminando la ruta en verde esmeralda a través del mapa.
5. **Modo Madriguera ("Rabbit Hole"):**
   - Selecciona cualquier nodo y pulsa **"Aislar vecindad" (1 o 2 saltos)** para estudiar solo su ecosistema inmediato sin distracciones.

---

### Módulo 2: Tutor Socrático y Pizarra (❓ Tutor socrático)
*URL directa:* `http://localhost:5173/#/tutor` (o `http://localhost:8000/#/tutor`)

Inspirado en el método socrático: **el tutor nunca te da la solución directa**, sino que te hace preguntas que te guían paso a paso para que descubras el concepto tú mismo.

#### 🧪 Pruebas paso a paso (¡Copia y pega para probar rápido!):

Selecciona en la columna izquierda el problema: **`El positivo que engaña`** (Teorema de Bayes).

1. **Usar la pizarra y añadir un paso:**
   - Dibuja un trazo en el lienzo negro con el ratón. Prueba cambiar de color y usar `🧽 Borrador` o `Limpiar`.
   - En la caja inferior de la pizarra (*Escribe un paso de tu razonamiento...*), pega:
     ```text
     Imaginemos 10.000 personas: 100 están enfermas.
     ```
   - Pulsa el botón **Añadir paso** (o `Enter`).
   - **Resultado esperado:** Aparece listado abajo con borde verde (`hit`) y se ilumina el primer chip `✓ Tasa base (prior)`.

2. **Probar la detección de errores comunes (Misconception):**
   - En la caja de chat de la derecha (*Escribe tu respuesta...*), pega:
     ```text
     La probabilidad de estar enfermo es del 90% porque la prueba detecta al 90%
     ```
   - Pulsa **Enviar**.
   - **Resultado esperado:** El tutor detecta el malentendido típico y te responde con una contra-pregunta pedagógica: *"Parece que estás dando la sensibilidad... pero la pregunta es la inversa: ¿son la misma cosa?"*.

3. **Probar el sistema de pistas progresivas:**
   - Pulsa el botón **`💡 Pista`** en la barra inferior del chat.
   - **Resultado esperado:** Aparece un mensaje amarillo con la *Pista 1/3*. Si vuelves a pulsar, te dará la *Pista 2/3* y luego la *Pista 3/3*, sin revelar la solución final directa.

4. **Resolver y completar el problema (Copia y pega estos 3 mensajes):**
   - **Mensaje A (Falsos positivos):**
     ```text
     Los sanos con falsos positivos del 9% son 891 personas.
     ```
     *(Se ilumina el chip verde de Falsos positivos)*
   - **Mensaje B (Probabilidad conjunta):**
     ```text
     Multiplico sensibilidad por prevalencia: 90 de los enfermos dan positivo.
     ```
     *(Se ilumina el chip de Probabilidad conjunta)*
   - **Mensaje C (Normalización y resultado final):**
     ```text
     Divido entre el total de positivos 981: el posterior es 9,2%.
     ```
   - **Resultado esperado:**
     - ¡El tutor celebra la resolución! Muestra: *"¡Lo construiste tú mismo! Identificaste: Tasa base · Falsos positivos · Probabilidad conjunta..."*.
     - Se despliega automáticamente la tarjeta del **📋 Plan de estudio personalizado** con recomendaciones de nodos a explorar en el grafo.
     - En la lista izquierda, el problema se marca con un tick verde **`✓ El positivo que engaña`** y el medidor sube a `Completados: 1/7`.

5. **Probar el reinicio completo:**
   - Pulsa el botón **`↺ Reiniciar chat`** (en la barra inferior o en la cabecera derecha).
   - **Resultado esperado:** El chat se limpia al mensaje inicial, se restablecen los chips y el progreso guardado, permitiéndote reiniciar la práctica cuando quieras.

> [!TIP]
> **Cheat Sheet para probar un segundo problema (`¿Válido o verdadero?`):**
> 1. Selecciona en la lista: **`¿Válido o verdadero?`**.
> 2. En la pizarra, añade el paso:
>    ```text
>    La forma logica del silogismo es: Todo A es B, c es B, luego c es A
>    ```
> 3. En el chat, prueba el error común:
>    ```text
>    Es un argumento valido porque es verdad que Socrates fue un filosofo
>    ```
> 4. Resuelve el problema enviando este mensaje que cubre todos los conceptos:
>    ```text
>    Es invalido y una falacia: un contraejemplo es que todos los gatos son mortales, Fido el perro es mortal, luego Fido es gato. Validez no es lo mismo que verdad.
>    ```
>    *(Completará todos los conceptos de lógica y generará el plan de estudio)*

---

### Módulo 3: Explicador In-Context & Chat RAG (📖 Explicador)
*URL directa:* `http://localhost:5173/#/explainer` (o `http://localhost:8000/#/explainer`)

Herramienta diseñada para descomponer lecturas difíciles, traducir jerga técnica y conversar directamente con documentos mediante RAG extractivo con citas verificables.

#### 🧪 Pruebas paso a paso (¡Copia y pega para probar rápido!):

1. **Cargar un texto de ejemplo:**
   - En la parte superior derecha de la columna izquierda (junto a *Lectura aumentada*), abre el menú desplegable de textos de ejemplo.
   - Selecciona **`Teorema Central del Límite`** (o **`Máquina de Turing`**).
   - **Resultado esperado:** El documento se carga de inmediato en el lector, mostrando términos técnicos destacados con subrayado azul (*glosario*) o amarillo (*jerga*).

2. **Explicación por niveles y selección de texto:**
   - **Clic directo:** Haz clic sobre un término subrayado como *distribución normal* o *varianza*.
   - **Selección libre:** Con el ratón, selecciona cualquier fragmento del texto (por ejemplo: *"la varianza del promedio disminuye y las fluctuaciones individuales se compensan"*).
   - En el panel superior derecho (*Explicación*), aparecerá la tarjeta conceptual del término, su complejidad y los chips de nodos relacionados para explorarlos en el grafo.
   - Prueba alternar entre los botones de **Nivel:**
     - 🟢 **Principiante:** Explicación intuitiva con consejos prácticos y analogías cotidianas.
     - 🟡 **Intermedio:** Definición conceptual estándar y clara.
     - 🔴 **Experto:** Definición rigurosa con formulación matemática y preguntas críticas sobre supuestos implícitos.

3. **Chat con el documento (RAG extractivo con citas):**
   - En el chat inferior derecho (*Chat con el documento*), escribe una pregunta sobre el texto cargado:
   - **Si tienes cargado `Teorema Central del Límite`, pega:**
     ```text
     ¿Qué ocurre cuando el tamaño de la muestra aumenta?
     ```
   - Pulsa **Preguntar** (o `Enter`).
   - **Resultado esperado:** El motor RAG localiza el pasaje exacto del texto, te indica la relevancia porcentual y **resalta las palabras clave** con fondo amarillo en la cita extractiva.

4. **Probar otro ejemplo (`Máquina de Turing`):**
   - Cambia en el desplegable superior a **`Máquina de Turing`**.
   - En el chat, pega:
     ```text
     ¿Qué es el problema de la parada?
     ```
   - Pulsa **Preguntar**.
   - **Resultado esperado:** Extrae y cita el párrafo de Alan Turing sobre la indecidibilidad algorítmica con las palabras clave resaltadas.

5. **Probar pegar un texto propio:**
   - Pulsa el botón **`✏ Pegar / editar texto`**.
   - Pega cualquier artículo o fragmento técnico propio y pulsa **`✔ Aplicar texto`**. El lector y el motor de preguntas se actualizarán al nuevo contenido al instante.

---

### Módulo 4: Laboratorio de Simulaciones Visuales (🧪 Laboratorio)
*URL directa:* `http://localhost:8000/#/lab`

Simulaciones interactivas en tiempo real renderizadas en Canvas para experimentar con matemáticas, estadística e inteligencia artificial.

#### 🧪 Pruebas sugeridas:
1. **Esperanza y Varianza (Ley de los Grandes Números):**
   - Pulsa **Lanzar dados** en modo rápido (100 o 1000 tiradas).
   - Observa la gráfica en tiempo real: cómo las fluctuaciones caóticas iniciales se aplanan gradualmente hasta converger de manera exacta en la esperanza teórica de `3.5`.
2. **Inferencia Bayesiana (Test Médico):**
   - Modifica los controles deslizantes (*prevalencia de la enfermedad*, *sensibilidad del test* y *falsos positivos*).
   - Observa el gráfico de frecuencias naturales: entenderás intuitivamente por qué un test con 95% de precisión puede dar más falsos positivos que positivos reales si la enfermedad es muy rara.
3. **Descenso del Gradiente:**
   - Ajusta la tasa de aprendizaje ($\alpha$) y pulsa **Iniciar**.
   - Mira la bolita descender por la curva tridimensional buscando el mínimo. Si subes demasiado el valor de $\alpha$, verás a la bolita rebotar caóticamente sin converger.
4. **Red Neuronal Interactiva (Problema XOR):**
   - Pulsa **Entrenar red**.
   - Observa época por época cómo la línea de decisión se deforma y curva en vivo en el plano 2D para clasificar los cuatro puntos del problema clásico de Minsky-Papert.

---

### Módulo 5: Motor de Lógica y Falacias (⚖ Lógica y falacias)
*URL directa:* `http://localhost:8000/#/logic`

Herramienta de pensamiento crítico con catálogo de 24 falacias lógicas y 24 sesgos cognitivos.

#### 🧪 Pruebas sugeridas:
1. **Verificador de argumentos:**
   - Pulsa el botón de ejemplo **`[Ad hominem + mayoría]`**.
   - Pulsa **Analizar razonamiento**.
   - **Resultado:** Desglose del argumento, puntaje de rigor (`60/100`) y tarjetas didácticas explicando el *Ad hominem* y el *Ad populum* con sus respectivos antídotos.
2. **Catálogo de tarjetas y búsqueda:**
   - Cambia a la subpestaña **"🃏 Tarjetas y quiz"**.
   - Escribe en el buscador: `confirmación` o `autoridad`. Verás la definición, ejemplos y cómo defenderte de ese sesgo.
3. **Quiz interactivo:**
   - Pulsa el botón **"Quiz"**.
   - Lee el caso y elige cuál es la falacia o sesgo presente. Tu puntuación se irá acumulando en el marcador superior.
4. **Laboratorio de Lógica Formal:**
   - Ve a la subpestaña **"⊢ Lógica formal"**.
   - Escribe las premisas: `P -> Q` y `Q`. Conclusión: `P`.
   - Pulsa **Evaluar validez**.
   - **Resultado:** Te generará la **Tabla de verdad completa** y te marcará en rojo la fila del **contraejemplo**, demostrando que es la falacia de *Afirmación del consecuente*.

---

### Módulo 6: Líneas de Tiempo e Historia Alternativa (⏳ Líneas de tiempo)
*URL directa:* `http://localhost:8000/#/timeline`

Exploración cronológica del progreso humano y simulación de escenarios contrafactuales.

#### 🧪 Pruebas sugeridas:
1. **Línea de tiempo cronológica:**
   - Desplázate horizontalmente desde el 400 a.C. hasta el siglo XXI.
   - Pulsa el botón **"▶ Reproducir historia"** para ver una animación secuencial de cómo cada descubrimiento inspiró al siguiente.
2. **Escenarios de Historia Alternativa (What if...?):**
   - Selecciona el escenario: *"¿Qué habría pasado si la Biblioteca de Alejandría no se hubiera quemado?"* o *"La Máquina Analítica de Ada Lovelace financiada en 1845"*.
   - Toma decisiones interactivas en los puntos de ramificación y lee cómo se habría reescrito el avance científico del mundo.

---

## 4. Pruebas de la API (Swagger)

Para desarrolladores que quieran inspeccionar el backend en Python:
👉 **[http://localhost:8000/docs](http://localhost:8000/docs)**

| Endpoint | Qué probar | Datos de entrada recomendados |
|---|---|---|
| `GET /api/health` | Estado del sistema | Solo pulsa *Execute*. Devuelve estado OK y conteo de nodos. |
| `GET /api/graph/path` | Camino entre ideas | `source`: `aristotelian_logic`, `target`: `transformers` |
| `POST /api/fallacies/check` | Analizador de texto | `{"text": "No le hagas caso: eres un ignorante y todo el mundo sabe que estás equivocado."}` |
| `POST /api/explain` | Explicador multi-nivel | `{"selected_text": "Entropía de Shannon", "level": "beginner", "lang": "es"}` |

---

## 5. Preguntas Frecuentes y Resolución de Problemas

#### ¿Qué pasa si cierro la terminal de PowerShell?
El servidor local se apagará y la página dejará de cargar. Solo debes volver a abrir PowerShell y escribir:
```powershell
cd C:\DESARROLLO\polymath-graph\backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload
```

#### ¿Se pierden mis notas o resultados del quiz si apago la máquina?
No. La aplicación guarda tus datos en el almacenamiento local de tu navegador (`localStorage`). Mientras uses el mismo navegador, tus datos seguirán ahí.

#### ¿Cómo reinicio todos los datos desde cero?
Abre la consola de desarrollador en tu navegador pulsando `F12`, escribe `localStorage.clear()` y pulsa Enter. Luego recarga la página (`F5`).

---
*Manual generado para Polymath Graph v1.0 · Creado para aprendizaje, experimentación e investigación interdisciplinaria.*
