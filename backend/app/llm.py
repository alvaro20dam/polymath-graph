"""Servicio de integración con LLM (Gemini Flash / OpenAI compatible) para Polymath Graph.

Provee:
- Evaluación socrática profunda (sin entregar la solución).
- Detección semántica de falacias lógicas y sesgos contextuales.
- Explicaciones pedagógicas adaptativas por nivel.
- Fallback automático determinista si no hay API key o si se pierde conexión.
"""
from __future__ import annotations

import base64
import json
import logging
import os
from pathlib import Path
import re
from typing import Any

from dotenv import load_dotenv
import httpx

# Carga de variables de entorno desde backend/.env o la raíz
_backend_dir = Path(__file__).resolve().parents[1]
load_dotenv(_backend_dir / ".env")
load_dotenv(_backend_dir.parent / ".env")

logger = logging.getLogger("polymath.llm")
_last_error: str | None = None


def get_llm_config() -> dict[str, Any]:
    """Retorna la configuración actual del servicio LLM."""
    global _last_error
    api_key = (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY", "")).strip()
    model = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash").strip()
    return {
        "enabled": bool(api_key),
        "provider": "google-gemini",
        "model": model,
        "has_key": bool(api_key),
        "error": _last_error,
    }


def _safe_json_loads(raw: str) -> dict | list | None:
    """Extrae y parsea JSON de forma segura y tolerante a markdown fences o texto marginal."""
    if not raw or not isinstance(raw, str):
        return None
    s = raw.strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass
    clean = s.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        pass
    start = clean.find("{")
    end = clean.rfind("}")
    if start != -1 and end != -1 and end > start:
        cand = clean[start : end + 1]
        try:
            return json.loads(cand)
        except json.JSONDecodeError:
            try:
                fixed = re.sub(r"(?<!\\)\n", r"\\n", cand)
                return json.loads(fixed)
            except Exception:
                pass
    return None


async def generate_gemini(
    system_prompt: str,
    user_prompt: str,
    *,
    json_mode: bool = True,
    temperature: float = 0.3,
    max_tokens: int = 1000,
) -> str | dict | None:
    """Invoca la API de Gemini usando HTTPX asíncrono.
    
    Retorna dict parseado si json_mode=True, str de texto plano si json_mode=False,
    o None si hubo algún error o falta la clave.
    """
    global _last_error
    cfg = get_llm_config()
    if not cfg["enabled"]:
        return None

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY", "")
    primary_model = cfg["model"]
    # Modelos candidatos para máxima resiliencia
    models_to_try = [primary_model]
    for alt in ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.1-flash-lite"]:
        if alt not in models_to_try:
            models_to_try.append(alt)

    body: dict[str, Any] = {
        "systemInstruction": {
            "parts": [{"text": system_prompt}]
        },
        "contents": [
            {
                "role": "user",
                "parts": [{"text": user_prompt}]
            }
        ],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
        }
    }
    if json_mode:
        body["generationConfig"]["responseMimeType"] = "application/json"

    headers = {
        "x-goog-api-key": api_key,
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=25.0) as client:
        for model_name in models_to_try:
            try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
                resp = await client.post(url, json=body, headers=headers)
                if resp.status_code == 200:
                    _last_error = None
                    data = resp.json()
                    candidates = data.get("candidates", [])
                    if not candidates:
                        continue
                    text = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                    if not text:
                        continue
                    if json_mode:
                        parsed = _safe_json_loads(text)
                        if parsed is not None:
                            return parsed
                        continue
                    return text
                else:
                    logger.warning("Gemini API %s HTTP %d: %s", model_name, resp.status_code, resp.text[:150])
                    if resp.status_code in (400, 401, 403):
                        _last_error = f"Error de autenticación Google API ({resp.status_code})"
                        return None
                    # Si fue 404 o 503, continuará intentando con el siguiente modelo de la lista
            except Exception as e:
                logger.warning("Fallo al invocar %s: %s", model_name, e)
                continue
        return None


async def socratic_evaluate_with_llm(
    session: dict,
    text: str,
    history: list[dict] | None = None,
) -> dict | None:
    """Evalúa la intervención del estudiante usando Gemini con directrices socráticas estrictas.
    
    Retorna un diccionario con estructura equivalente a socratic_evaluate() o None si falla.
    """
    from . import skills

    problem_id = session.get("problem_id") or session.get("problemId")
    if not problem_id or problem_id not in skills._PROBLEMS:
        return None

    problem = skills._PROBLEMS[problem_id]
    concepts = problem["concepts"]
    mastered_set = set(session.get("mastered", []))
    missing_concepts = [c for c in concepts if c["id"] not in mastered_set]

    system_prompt = f"""Eres un Tutor Socrático de élite en ciencia, matemáticas y lógica para la plataforma Polymath Graph.
Tu misión es guiar al alumno mediante el método socrático para que ÉL MISMO construya el razonamiento.

REGLAS PEDAGÓGICAS ABSOLUTAS:
1. NUNCA des el resultado final, fórmulas completas ni la solución directa.
2. Si el alumno aporta una idea correcta o un cálculo preliminar acertado, felicítalo brevemente por ese paso específico.
3. Si el alumno comete un error o cae en una concepción errónea (misconception), no le digas "está mal"; formúlale una pregunta que le permita ver la contradicción (un contraejemplo o una reducción al absurdo).
4. Nivel del alumno: {session.get('level', 'intermediate')}. Adapta tu vocabulario pero mantén la precisión lógica.
5. Tu respuesta debe ser breve (2 a 4 oraciones como máximo), estimulante y terminar SIEMPRE con una pregunta orientadora clara sobre el siguiente paso.

DEBES responder con un objeto JSON válido con esta estructura:
{{
  "newly_mastered_ids": ["lista de ids de conceptos dominados por el alumno en este mensaje"],
  "is_misconception": false,
  "is_complete": false,
  "message": "Tu respuesta socrática breve y estimulante que termina en una pregunta"
}}
"""

    concepts_desc = "\n".join(
        f"- ID: {c['id']} | Nombre: {c['name']} | Enfoque: {c['question']}"
        for c in concepts
    )
    misconceptions_desc = "\n".join(
        f"- Patrón erróneo común: {m.get('pattern', '')} -> Respuesta sugerida: {m.get('response', '')}"
        for m in problem.get("misconceptions", [])
    )

    history_str = ""
    if history:
        recent = history[-4:]
        history_str = "\n".join(f"{h.get('role', 'msg')}: {h.get('text', '')}" for h in recent)

    user_prompt = f"""PROBLEMA SOCRÁTICO:
Título: {problem['title']}
Enunciado: {problem['prompt']}
Pasos pedagógicos sugeridos: {', '.join(problem['steps'])}
Síntesis (revelar solo cuando esté 100% completo): {problem['synthesis']}

TODOS LOS CONCEPTOS DEL PROBLEMA:
{concepts_desc}

CONCEPTOS YA DOMINADOS POR EL ALUMNO:
{list(mastered_set) or 'Ninguno todavía'}

CONCEPTOS PENDIENTES DE CONSTRUIR:
{[c['id'] for c in missing_concepts]}

ERRORES TÍPICOS CONOCIDOS:
{misconceptions_desc or 'Ninguno específico registrado'}

HISTORIAL RECIENTE DE LA CONVERSACIÓN:
{history_str or 'Inicio de la conversación'}

NUEVO MENSAJE DEL ESTUDIANTE:
"{text}"

Evalúa si el estudiante ha comprendido alguno de los conceptos pendientes. Genera tu respuesta en JSON según las instrucciones:
"""

    result = await generate_gemini(system_prompt, user_prompt, json_mode=True, temperature=0.3)
    if not isinstance(result, dict) or "message" not in result:
        return None

    # Procesar conceptos reconocidos
    newly_ids = [cid for cid in result.get("newly_mastered_ids", []) if any(c["id"] == cid for c in missing_concepts)]
    for cid in newly_ids:
        session["mastered"].append(cid)
        mastered_set.add(cid)

    session["attempts"] = session.get("attempts", 0) + 1
    if result.get("is_misconception"):
        session["misconceptions"] = session.get("misconceptions", 0) + 1

    remaining_missing = [c for c in concepts if c["id"] not in mastered_set]
    mastery = len(session["mastered"]) / len(concepts)
    is_complete = len(remaining_missing) == 0 or result.get("is_complete", False)

    cfg = get_llm_config()
    msg = result["message"].strip()
    
    if is_complete and not any(k in msg.lower() for k in ["síntesis", "completaste", "construiste"]):
        msg += f"\n\n¡Completaste todos los pasos! Síntesis: {problem['synthesis']}"

    kind = "complete" if is_complete else ("misconception" if result.get("is_misconception") else "progress")
    newly_names = [c["name"] for c in concepts if c["id"] in newly_ids]

    return {
        "newly": newly_names,
        "missing": len(remaining_missing),
        "mastery": mastery,
        "kind": kind,
        "message": msg,
        "session": session,
        "engine": f"gemini ({cfg['model']})",
    }


async def socratic_hint_with_llm(
    session: dict,
    history: list[dict] | None = None,
) -> dict | None:
    """Genera una pista socrática contextual y adaptada usando Gemini Flash."""
    from . import skills

    problem_id = session.get("problem_id") or session.get("problemId")
    if not problem_id or problem_id not in skills._PROBLEMS:
        return None

    problem = skills._PROBLEMS[problem_id]
    concepts = problem["concepts"]
    mastered_set = set(session.get("mastered", []))
    missing_concepts = [c for c in concepts if c["id"] not in mastered_set]

    if not missing_concepts:
        return {
            "exhausted": True,
            "message": "Ya dominaste todos los conceptos de este problema. Revisa la síntesis o prueba el siguiente desafío.",
            "level": 0,
            "total": 0,
            "concept": "Completo",
            "session": session,
            "engine": "gemini",
        }

    c = missing_concepts[0]
    session_hints = session.get("hints_used") if "hints_used" in session else session.get("hintsUsed")
    if session_hints is None:
        session_hints = {}
        session["hints_used"] = session_hints
        session["hintsUsed"] = session_hints

    used = session_hints.get(c["id"], 0)
    total_hints = len(c.get("hints", [])) or 3

    if used >= total_hints:
        return {
            "exhausted": True,
            "level": total_hints,
            "total": total_hints,
            "concept": c["name"],
            "message": f"Ya agotaste las pistas del paso «{c['name']}». Dibuja el caso en la pizarra, explora el nodo relacionado en el grafo o usa un simulador, y luego cuéntame qué observas.",
            "session": session,
            "engine": "gemini",
        }

    target_level = used + 1

    system_prompt = f"""Eres un Tutor Socrático de élite. El alumno ha solicitado una PISTA PROGRESIVA para el paso «{c['name']}».

REGLAS PEDAGÓGICAS:
1. NUNCA des el resultado final, ni la fórmula directa resuelta.
2. Nivel de la pista solicitada: {target_level} de {total_hints}.
   - Nivel 1: Haz una pregunta de enfoque o da una analogía de la vida cotidiana para visualizar el paso.
   - Nivel 2: Descompón el razonamiento en dos preguntas más pequeñas y simples.
   - Nivel 3: Da una pista numérica o estructural más explícita (un ejemplo con números fáciles) sin resolver el problema principal.
3. Conecta con lo que el estudiante y tú han venido hablando.
4. Tu respuesta debe ser breve (1 o 2 oraciones máximo), clara, cálida y estimulante.

Responde ÚNICAMENTE en formato JSON:
{{
  "hint": "Tu pista progresiva aquí"
}}
"""

    history_str = ""
    if history:
        recent = history[-4:]
        history_str = "\n".join(f"{h.get('role', 'msg')}: {h.get('text', '')}" for h in recent)

    hints_reference = "\n".join(f"- Nivel {i+1}: {h}" for i, h in enumerate(c.get("hints", [])))

    user_prompt = f"""PROBLEMA SOCRÁTICO:
Título: {problem['title']}
Enunciado: {problem['prompt']}

PASO ACTUAL EN EL QUE ESTÁ EL ALUMNO:
Concepto: {c['name']} (ID: {c['id']})
Pregunta guía del paso: {c['question']}
Pistas de referencia para este concepto:
{hints_reference}

HISTORIAL RECIENTE:
{history_str or 'El alumno recién empieza a trabajar en este paso.'}

Genera la Pista {target_level}/{total_hints} para este concepto adaptada a la conversación.
"""

    result = await generate_gemini(system_prompt, user_prompt, json_mode=True, temperature=0.3)
    if not isinstance(result, dict) or "hint" not in result:
        return None

    # Registrar uso de la pista
    session_hints[c["id"]] = target_level
    if "hints_used" in session:
        session["hints_used"][c["id"]] = target_level
    if "hintsUsed" in session:
        session["hintsUsed"][c["id"]] = target_level

    cfg = get_llm_config()
    return {
        "exhausted": False,
        "level": target_level,
        "total": total_hints,
        "concept": c["name"],
        "message": result["hint"].strip(),
        "session": session,
        "engine": f"gemini ({cfg['model']})",
    }


async def rag_query_with_llm(
    text: str,
    question: str,
    k: int = 4,
) -> dict | None:
    """Realiza RAG sobre el documento usando búsqueda semántica + síntesis de Gemini."""
    from . import skills

    doc_res = skills.document_qa(text, question, k)
    passages = doc_res.get("passages", [])
    if not passages:
        return None

    passages_ctx = "\n\n".join(
        f"[Pasaje {i+1}]: {p['text']}" for i, p in enumerate(passages)
    )

    system_prompt = """Eres el Asistente Académico y Analista Documental de Polymath Graph.
Tu función es responder a la pregunta del estudiante basándote en los pasajes extraídos de su documento o apuntes.

REGLAS PEDAGÓGICAS Y DE RIGOR:
1. Responde de forma clara, directa y pedagógica.
2. CITA explícitamente en qué parte o pasaje te basas (ejemplo: "Como se indica en el pasaje [1]...").
3. Si los pasajes no contienen la respuesta suficiente, dilo honestamente y ofrece una breve orientación basada en fundamentos científicos.
4. Responde en el mismo idioma de la pregunta.
"""

    user_prompt = f"""PASAJES RELEVANTES EXTRAÍDOS DEL DOCUMENTO:
{passages_ctx}

PREGUNTA DEL ESTUDIANTE:
"{question}"

Genera una respuesta sintética y clara citando los pasajes de apoyo:
"""

    result = await generate_gemini(system_prompt, user_prompt, json_mode=False, temperature=0.2)
    if not result or not isinstance(result, str):
        return None

    cfg = get_llm_config()
    return {
        "found": True,
        "answer": result.strip(),
        "passages": passages,
        "engine": f"gemini ({cfg['model']})",
    }


async def explain_with_llm(
    selected_text: str,
    context: str = "",
    target_level: str = "beginner",
    lang: str = "es",
) -> dict | None:
    """Genera una explicación pedagógica in-context adaptada con Gemini."""
    from . import skills

    base = skills.explainpaper_highlighter(selected_text, context, target_level, lang)

    snippet = selected_text.strip() or context[:500]
    if not snippet:
        return None

    system_prompt = f"""Eres el Explicador Pedagógico de Polymath Graph.
Tu tarea es explicar el fragmento seleccionado adaptándote al nivel: {target_level} y en idioma: {lang}.

NIVELES:
- beginner: Usa analogías cotidianas, explicaciones intuitivas y cero jerga compleja.
- intermediate: Explica los conceptos clave, relaciones de causa-efecto y aplicaciones prácticas.
- expert: Rigor formal, supuestos matemáticos/lógicos y relevancia epistemológica.

Responde ÚNICAMENTE en JSON con este formato:
{{
  "explanation": "Tu explicación adaptada (2 a 3 párrafos cortos)",
  "simplified": "Resumen en una sola frase clave",
  "key_points": ["Punto clave 1", "Punto clave 2"]
}}
"""

    user_prompt = f"""CONTEXTO DEL DOCUMENTO (extracto):
{context[:1200] if context else 'No provisto'}

FRAGMENTO SELECCIONADO A EXPLICAR:
"{snippet}"
"""

    result = await generate_gemini(system_prompt, user_prompt, json_mode=True, temperature=0.3)
    if not isinstance(result, dict) or "explanation" not in result:
        return None

    cfg = get_llm_config()
    base["ai_explanation"] = result.get("explanation", "").strip()
    if result.get("simplified"):
        base["simplified"] = result["simplified"].strip()
    base["key_points"] = result.get("key_points", [])
    base["engine"] = f"gemini ({cfg['model']})"
    return base


async def extract_pdf_with_gemini(pdf_bytes: bytes) -> str | None:
    """Extrae texto de un PDF gráfico, escaneado o impreso usando la visión multimodal de Gemini."""
    cfg = get_llm_config()
    if not cfg["enabled"]:
        return None

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY", "")
    pdf_b64 = base64.b64encode(pdf_bytes).decode("utf-8")

    models_to_try = ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.1-flash-lite"]
    body = {
        "systemInstruction": {
            "parts": [{"text": "Eres un sistema de OCR de alta precisión para Polymath Graph. Transcribe fielmente todo el texto, fórmulas, títulos y párrafos presentes en este documento."}]
        },
        "contents": [{
            "parts": [
                {"inlineData": {"mimeType": "application/pdf", "data": pdf_b64}},
                {"text": "Transcribe con fidelidad todo el texto legible contenido en este documento respetando párrafos y saltos de línea. No agregues saludos ni explicaciones, solo el texto transcrito:"}
            ]
        }],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 4000,
        }
    }

    headers = {
        "x-goog-api-key": api_key,
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        for m in models_to_try:
            try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent"
                r = await client.post(url, json=body, headers=headers)
                if r.status_code == 200:
                    text = r.json().get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                    if text.strip():
                        return text.strip()
            except Exception as e:
                logger.warning("Fallo OCR Gemini con %s: %s", m, e)
                continue
    return None


async def generate_gemini_multimodal(
    system_prompt: str,
    user_prompt: str,
    image_b64: str,
    mime_type: str = "image/png",
    json_mode: bool = False,
    max_tokens: int = 1000,
    temperature: float = 0.2,
) -> dict | str | None:
    """Invoca la API de Gemini con entrada multimodal (imagen + texto)."""
    cfg = get_llm_config()
    if not cfg["enabled"]:
        return None

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY", "")
    if not api_key:
        return None

    if "," in image_b64:
        header, raw_b64 = image_b64.split(",", 1)
        if "image/jpeg" in header or "image/jpg" in header:
            mime_type = "image/jpeg"
        elif "image/png" in header:
            mime_type = "image/png"
        elif "image/webp" in header:
            mime_type = "image/webp"
        image_b64 = raw_b64

    primary_model = cfg["model"]
    models_to_try = [primary_model]
    for alt in ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.1-flash-lite"]:
        if alt not in models_to_try:
            models_to_try.append(alt)

    body = {
        "systemInstruction": {
            "parts": [{"text": system_prompt}]
        },
        "contents": [{
            "parts": [
                {"inlineData": {"mimeType": mime_type, "data": image_b64.strip()}},
                {"text": user_prompt}
            ]
        }],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
        }
    }
    if json_mode:
        body["generationConfig"]["responseMimeType"] = "application/json"

    headers = {
        "x-goog-api-key": api_key,
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        for model_name in models_to_try:
            try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
                resp = await client.post(url, json=body, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    candidates = data.get("candidates", [])
                    if not candidates:
                        continue
                    text = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                    if not text:
                        continue
                    if json_mode:
                        parsed = _safe_json_loads(text)
                        if parsed is not None:
                            return parsed
                        continue
                    return text
                else:
                    logger.warning("Gemini Multimodal API %s HTTP %d: %s", model_name, resp.status_code, resp.text[:150])
            except Exception as e:
                logger.warning("Fallo multimodal al invocar %s: %s", model_name, e)
                continue
    return None


async def socratic_whiteboard_with_llm(
    session: dict,
    image_b64: str,
    history: list[dict] | None = None,
) -> dict | None:
    """Evalúa los diagramas, fórmulas y razonamientos dibujados en la pizarra con visión multimodal de Gemini."""
    from . import skills

    problem_id = session.get("problem_id") or session.get("problemId")
    if not problem_id or problem_id not in skills._PROBLEMS:
        return None

    problem = skills._PROBLEMS[problem_id]
    concepts = problem["concepts"]
    mastered_set = set(session.get("mastered", []))
    missing_concepts = [c for c in concepts if c["id"] not in mastered_set]

    system_prompt = f"""Eres un Tutor Socrático de élite con visión multimodal para la plataforma científica Polymath Graph.
Tu misión es EXAMINAR LA PIZARRA del estudiante (dibujos a mano alzada, árboles de probabilidad, diagramas de Venn, fórmulas matemáticas, fracciones, grafos y esquemas de razonamiento) y guiarlo mediante el método socrático.

REGLAS PEDAGÓGICAS ABSOLUTAS:
1. Describe brevemente lo que ves dibujado o escrito en la pizarra en el campo "transcription".
2. Si el alumno ha trazado pasos correctos o cálculos acertados en su pizarra, reconócelo explícitamente y márcalos en "newly_mastered_ids".
3. Si el alumno comete un error visual o numérico (por ejemplo: olvidó una rama, error de signos, confusión en numerador/denominador, cálculo incorrecto), señálale con tacto dónde mirar o hazle una pregunta reflexiva para que él mismo descubra el fallo.
4. NUNCA des el resultado final ni la síntesis completa de forma directa.
5. Tu respuesta socrática debe ser breve (2 a 4 oraciones), cálida, clara y terminar siempre con una pregunta orientadora sobre el siguiente paso.

DEBES responder con un objeto JSON válido con esta estructura:
{{
  "transcription": "Resumen conciso de lo que ves dibujado o escrito en la pizarra (ej: Árbol de probabilidad con 100 enfermos y 9900 sanos)",
  "newly_mastered_ids": ["lista de ids de conceptos dominados por el alumno en este dibujo"],
  "is_misconception": false,
  "is_complete": false,
  "message": "Tu respuesta socrática comentando lo que observas en la pizarra y terminando en una pregunta orientadora"
}}
"""

    concepts_desc = "\n".join(
        f"- ID: {c['id']} | Nombre: {c['name']} | Enfoque: {c['question']}"
        for c in concepts
    )
    misconceptions_desc = "\n".join(
        f"- Patrón erróneo común: {m.get('pattern', '')} -> Respuesta sugerida: {m.get('response', '')}"
        for m in problem.get("misconceptions", [])
    )

    history_str = ""
    if history:
        recent = history[-4:]
        history_str = "\n".join(f"{h.get('role', 'msg')}: {h.get('text', '')}" for h in recent)

    user_prompt = f"""PROBLEMA SOCRÁTICO ACTUAL:
Título: {problem['title']}
Enunciado: {problem['prompt']}
Pasos pedagógicos sugeridos: {', '.join(problem['steps'])}
Síntesis (revelar solo cuando esté 100% completo): {problem['synthesis']}

TODOS LOS CONCEPTOS DEL PROBLEMA:
{concepts_desc}

CONCEPTOS YA DOMINADOS POR EL ALUMNO:
{list(mastered_set) or 'Ninguno todavía'}

CONCEPTOS PENDIENTES:
{[c['id'] for c in missing_concepts]}

PATRONES ERRÓNEOS COMUNES:
{misconceptions_desc}

HISTORIAL RECIENTE DE LA CONVERSACIÓN:
{history_str or 'El alumno está comenzando o trabajando en la pizarra.'}

Analiza la imagen de la pizarra adjunta del estudiante y genera la evaluación socrática en formato JSON.
"""

    result = await generate_gemini_multimodal(
        system_prompt,
        user_prompt,
        image_b64,
        mime_type="image/png",
        json_mode=True,
        temperature=0.2,
    )

    if not isinstance(result, dict) or "message" not in result:
        return None

    session["attempts"] += 1
    if result.get("is_misconception"):
        session["misconceptions"] += 1

    valid_concept_ids = {c["id"] for c in concepts}
    newly_ids = [
        cid for cid in result.get("newly_mastered_ids", [])
        if cid in valid_concept_ids and cid not in mastered_set
    ]

    for cid in newly_ids:
        session["mastered"].append(cid)
        mastered_set.add(cid)

    remaining_missing = [c for c in concepts if c["id"] not in mastered_set]
    mastery = len(mastered_set) / len(concepts)
    is_complete = len(remaining_missing) == 0

    cfg = get_llm_config()
    msg = result.get("message", "").strip()
    if is_complete and not msg:
        msg = f"¡Excelente trabajo en la pizarra! Has construido todo el razonamiento tú mismo. Síntesis: {problem['synthesis']}"

    kind = "complete" if is_complete else ("misconception" if result.get("is_misconception") else "progress")
    newly_names = [c["name"] for c in concepts if c["id"] in newly_ids]

    return {
        "newly": newly_names,
        "missing": len(remaining_missing),
        "mastery": mastery,
        "kind": kind,
        "transcription": result.get("transcription", "").strip(),
        "message": msg,
        "session": session,
        "engine": f"gemini ({cfg['model']})",
    }


async def fallacy_audit_with_llm(text: str) -> dict | None:
    """Audita semánticamente un argumento o discurso identificando falacias, sesgos y reformulación válida."""
    snippet = text.strip()
    if not snippet:
        return None

    system_prompt = """Eres el Auditor Lógico y de Pensamiento Crítico de Polymath Graph.
Tu tarea es auditar rigurosamente el texto o argumento proporcionado por el usuario, analizando su estructura lógica, detectando falacias formales e informales, identificando sesgos cognitivos y proponiendo una reformulación constructiva (steel-manning).

DIRECTRICES DE AUDITORÍA:
1. No te dejes engañar por la elocuencia ni palabras clave: evalúa la deducción e inferencia causal y deductiva real entre premisas y conclusiones.
2. Identifica si hay falacias informales (ad hominem, hombre de paja, falsa causa, falso dilema, pendiente resbaladiza, apelación a la ignorancia/autoridad/emoción, petición de principio, arenque rojo, etc.) o sesgos (confirmación, anclaje, costo hundido, exceso de confianza, retrospectiva, etc.).
3. Evalúa el rigor en una escala de 0 a 100:
   - 80-100: Argumento sólido, premisas plausibles, conclusión bien derivada.
   - 50-79: Premisas aceptables pero con saltos lógicos o matices no fundamentados.
   - 0-49: Razonamiento falaz, ataque personal o desconexión entre premisas y conclusión.
4. "steelmanning": Proporciona una versión honesta, sólida y lógicamente válida de lo que el autor intenta argumentar, eliminando las falacias y aclarando las premisas.
5. "advice": Consejo pedagógico conciso (1 o 2 oraciones) para fortalecer este razonamiento.

DEBES responder ÚNICAMENTE con un objeto JSON válido con esta estructura:
{
  "structure": {
    "premises": ["Premisa 1", "Premisa 2"],
    "conclusions": ["Conclusión defendida"]
  },
  "rigor": 65,
  "fallacies": [
    {
      "name": "Nombre de la falacia",
      "kind": "informal",
      "definition": "Breve definición teórica de la falacia",
      "evidence": ["Frase exacta del texto donde ocurre"],
      "counter": "Cómo refutarla o señalar la debilidad",
      "explanation": "Por qué este fragmento específico es falaz en este contexto"
    }
  ],
  "biases": [
    {
      "name": "Nombre del sesgo cognitivo",
      "definition": "Breve definición del sesgo",
      "evidence": ["Frase del texto donde se manifiesta"],
      "antidote": "Antídoto cognitivo para neutralizarlo"
    }
  ],
  "notes": ["Observación crítica 1", "Observación crítica 2"],
  "steelmanning": "Reformulación constructiva del argumento sin falacias",
  "advice": "Consejo pedagógico final para el autor"
}
"""

    user_prompt = f"""Argumento o texto a auditar:
\"\"\"{snippet[:15000]}\"\"\"
"""

    result = await generate_gemini(system_prompt, user_prompt, json_mode=True, temperature=0.2)
    if not isinstance(result, dict) or "rigor" not in result:
        return None

    cfg = get_llm_config()
    result["engine"] = f"gemini ({cfg['model']})"
    if "structure" not in result or not isinstance(result["structure"], dict):
        from . import skills
        result["structure"] = skills.argument_structure_parser(snippet)
    if "fallacies" not in result:
        result["fallacies"] = []
    if "biases" not in result:
        result["biases"] = []
    if "notes" not in result:
        result["notes"] = []

    return result


async def extract_graph_nodes_with_llm(text: str, max_nodes: int = 3) -> dict | None:
    """Extrae con Gemini Flash de 1 a max_nodes conceptos clave de un documento y los conecta al grafo."""
    import re
    from . import data, skills
    from .textutil import norm

    snippet = text.strip()
    if not snippet:
        return None

    g = data.graph()
    by_id = data.node_by_id()
    valid_domains = list(g["domains"].keys())
    valid_relations = list(g["relations"].keys())

    # Seleccionar nodos relevantes del grafo existente + representantes por dominio
    sem_hits = skills.vector_search_indexer(snippet[:4000], k=18)
    cand_ids: list[str] = [h["id"] for h in sem_hits if h["id"] in by_id]
    for dom in valid_domains:
        dom_nodes = [n["id"] for n in g["nodes"] if n["domain"] == dom]
        for nid in dom_nodes[:3]:
            if nid not in cand_ids:
                cand_ids.append(nid)

    catalog_lines = [
        f"- {nid}: {by_id[nid]['label']} (domain: {by_id[nid]['domain']})"
        for nid in cand_ids[:36]
    ]
    catalog_str = "\n".join(catalog_lines)

    system_prompt = f"""Eres GraphArchitect_Agent de Polymath Graph.
Tu tarea es leer el documento o texto del usuario, extraer entre 1 y {max_nodes} conceptos clave NUEVOS que merezcan integrarse como nodos en el Grafo de Conocimiento Interdisciplinario, y conectarlos con los nodos ya existentes.

REGLAS DE DISEÑO DEL GRAFO:
1. "topic": Nombre corto y preciso del concepto en español (2 a 5 palabras). No repitas literalmente un nodo ya existente en el catálogo.
2. "domain": Debe ser exactamente uno de: {valid_domains}.
3. "complexity": Nivel de complejidad de 1 (básico) a 5 (avanzado).
4. "year": Año aproximado de origen o relevancia del concepto (número entero, ej. 1950, 2024).
5. "authors": Lista de 1 a 3 autores, investigadores o pensadores asociados al concepto en el texto (si no se mencionan explícitamente, infiere los referentes históricos del tema o usa ["Autor del documento"]).
6. "summary": Explicación sintética, clara y pedagógica en español (1 o 2 oraciones) que resuma la idea central.
7. "connections": Lista de 2 a 4 conexiones hacia IDs existentes del catálogo inferior. Al menos UNA conexión debe ser hacia un nodo de otro "domain" distinto (enlace interdisciplinario).
   Cada conexión tiene:
   - "target": ID exacto del nodo existente en el catálogo.
   - "relation": Uno de {valid_relations}.

NODOS EXISTENTES EN EL GRAFO PARA CONECTAR:
{catalog_str}

DEBES responder ÚNICAMENTE con un objeto JSON válido con esta estructura:
{{
  "concepts": [
    {{
      "topic": "Nombre del concepto",
      "domain": "science",
      "complexity": 3,
      "year": 2023,
      "authors": ["Autor 1"],
      "summary": "Síntesis clara del concepto y su relevancia interdisciplinaria.",
      "connections": [
        {{"target": "information_theory", "relation": "extends"}},
        {{"target": "critical_thinking", "relation": "applies"}}
      ]
    }}
  ]
}}
"""

    user_prompt = f"""Documento del estudiante / investigador:
\"\"\"{snippet[:15000]}\"\"\"

Extrae hasta {max_nodes} conceptos centrales y sus conexiones interdisciplinarias en JSON:
"""

    result = await generate_gemini(system_prompt, user_prompt, json_mode=True, temperature=0.25)
    if not isinstance(result, dict) or not isinstance(result.get("concepts"), list):
        return None

    nodes_out: list[dict] = []
    links_out: list[dict] = []
    used_ids: set[str] = set(by_id.keys())

    for item in result["concepts"][:max_nodes]:
        if not isinstance(item, dict) or not item.get("topic"):
            continue
        topic = str(item["topic"]).strip()
        domain = str(item.get("domain", "science")).strip()
        if domain not in valid_domains:
            domain = "science"

        raw_id = re.sub(r"[^a-z0-9]+", "_", norm(topic)).strip("_")
        if not raw_id:
            continue
        node_id = raw_id if raw_id not in used_ids else f"{raw_id}_custom"
        if node_id in used_ids:
            continue

        try:
            complexity = max(1, min(5, int(item.get("complexity", 3))))
        except (ValueError, TypeError):
            complexity = 3

        try:
            year = int(item.get("year", 2025))
        except (ValueError, TypeError):
            year = 2025

        authors_raw = item.get("authors")
        if isinstance(authors_raw, list) and authors_raw:
            authors = [str(a).strip() for a in authors_raw if str(a).strip()][:3]
        else:
            authors = ["Autor del documento"]
        if not authors:
            authors = ["Autor del documento"]

        summary = str(item.get("summary", "")).strip() or f"Concepto extraído sobre {topic}."

        valid_conns: list[dict] = []
        seen_targets: set[str] = set()
        for c in item.get("connections", []):
            if isinstance(c, dict):
                tgt = str(c.get("target", "")).strip()
                rel = str(c.get("relation", "influences")).strip()
                if tgt in by_id and tgt not in seen_targets:
                    if rel not in valid_relations:
                        rel = "influences"
                    valid_conns.append({"source": node_id, "target": tgt, "relation": rel})
                    seen_targets.add(tgt)

        # Garantizar al menos 2 enlaces y 1 enlace interdisciplinario
        if len(valid_conns) < 2:
            extra_hits = skills.vector_search_indexer(f"{topic} {summary}", k=4)
            for h in extra_hits:
                hid = h["id"]
                if hid in by_id and hid not in seen_targets:
                    valid_conns.append({"source": node_id, "target": hid, "relation": "influences"})
                    seen_targets.add(hid)
                    if len(valid_conns) >= 3:
                        break

        if not any(by_id[c["target"]]["domain"] != domain for c in valid_conns):
            cross_fallback = "critical_thinking" if domain != "philosophy" else "scientific_method"
            if cross_fallback not in seen_targets and cross_fallback in by_id:
                valid_conns.append({"source": node_id, "target": cross_fallback, "relation": "applies"})
                seen_targets.add(cross_fallback)

        node_obj = {
            "id": node_id,
            "label": topic,
            "domain": domain,
            "complexity": complexity,
            "year": year,
            "authors": authors,
            "summary": summary,
            "custom": True,
        }
        used_ids.add(node_id)
        nodes_out.append(node_obj)
        links_out.extend(valid_conns[:4])

    if not nodes_out:
        return None

    cfg = get_llm_config()
    return {
        "nodes": nodes_out,
        "links": links_out,
        "engine": f"gemini ({cfg['model']})",
    }


async def generate_flashcards_with_llm(
    text: str,
    source: str = "document",
    max_cards: int = 8,
    level: str = "intermediate",
    lang: str = "es",
) -> dict | None:
    """Genera tarjetas de estudio estilo Anki (recuerdo activo, atómicas y de alto impacto pedagógico) con Gemini."""
    snippet = text.strip()
    if not snippet:
        return None

    target_lang = "español" if lang == "es" else "inglés"
    system_prompt = f"""Eres MemoryArchitect_Agent de Polymath Graph, especialista en ciencia del aprendizaje, repetición espaciada y diseño de tarjetas estilo Anki (principios de Piotr Woźniak / SuperMemo).

Tu tarea es analizar el texto (documento, explicación o sesión socrática) y extraer hasta {max_cards} tarjetas de estudio excepcionales en {target_lang}.

PRINCIPIOS DE DISEÑO DE FLASHCARDS:
1. "PRINCIPIO DE ATOMICIDAD": Una sola idea, hecho o relación por tarjeta. Nunca hagas preguntas dobles ni respuestas de párrafos interminables.
2. "RECUERDO ACTIVO": El anverso ("front") debe ser un detonante cognitivo claro (pregunta directa, escenario breve o «¿Por qué...?»).
3. "RESPUESTA CLARA Y MEMORABLE": El reverso ("back") debe comenzar con la respuesta directa en negrita, seguida opcionalmente de una explicación concisa o fórmula (1 a 3 líneas).
4. "TIPOS DE TARJETAS RECOMENDADAS":
   - Conceptos centrales y definiciones operativas.
   - Contrastes y distinciones sutiles (ej: sensibilidad vs. probabilidad a posteriori).
   - Errores conceptuales comunes (misconceptions) y cómo corregirlos.
   - Conexiones causa-efecto o teoremas fundamentales.
5. "tags": 1 a 3 etiquetas cortas en minúsculas (ej: ["bayes", "probabilidad", "tasa_base"]).
6. "kind": "qa" (pregunta/respuesta) o "cloze" (completar espacio).

Nivel objetivo: {level}.

DEBES responder ÚNICAMENTE con un objeto JSON válido con esta estructura:
{{
  "cards": [
    {{
      "front": "¿Qué es la tasa base (prior) y cómo afecta al resultado de una prueba médica?",
      "back": "**Es la probabilidad previa de estar enfermo antes del test.**\\n\\nSi la enfermedad es muy rara (ej. 1%), incluso con un test del 90% de precisión la gran mayoría de positivos serán falsos positivos.",
      "tags": ["bayes", "probabilidad", "tasa_base"],
      "kind": "qa"
    }}
  ]
}}
"""

    user_prompt = f"""Contenido fuente ({source}):
\"\"\"{snippet[:15000]}\"\"\"

Extrae hasta {max_cards} tarjetas de estudio atómicas en JSON:
"""

    result = await generate_gemini(system_prompt, user_prompt, json_mode=True, temperature=0.25)
    if not isinstance(result, dict) or not isinstance(result.get("cards"), list):
        return None

    valid_cards = []
    for c in result["cards"][:max_cards]:
        if not isinstance(c, dict):
            continue
        front = str(c.get("front", "")).strip()
        back = str(c.get("back", "")).strip()
        if not front or not back:
            continue
        tags_raw = c.get("tags") or []
        tags = [re.sub(r"[^\w-]", "", str(t).lower()) for t in tags_raw if str(t).strip()][:4]
        kind = "cloze" if c.get("kind") == "cloze" else "qa"
        valid_cards.append({
            "front": front,
            "back": back,
            "tags": tags,
            "kind": kind,
        })

    if not valid_cards:
        return None

    cfg = get_llm_config()
    return {
        "cards": valid_cards,
        "engine": f"gemini ({cfg['model']})",
    }


async def debate_turn_with_llm(
    thinker_id: str,
    opponent_id: str,
    topic: str,
    history: list[dict] | None = None,
    user_intervention: str | None = None,
) -> dict | None:
    """Emula a un pensador histórico en la Arena Dialéctica de Polymath Graph con Gemini Flash."""
    from . import data

    catalog = data.load("thinkers")
    by_id = {t["id"]: t for t in catalog.get("thinkers", [])}
    thinker = by_id.get(thinker_id, {"name": thinker_id.capitalize(), "era": "", "core_stance": "", "avatar": "🏛️"})
    opponent = by_id.get(opponent_id, {"name": opponent_id.capitalize(), "era": "", "core_stance": "", "avatar": "📜"})

    t_name = thinker["name"]
    op_name = opponent["name"]

    history_str = ""
    if history:
        turns = []
        for h in history[-8:]:
            spk = h.get("name") or h.get("speaker") or "Voz"
            txt = h.get("text", "")
            turns.append(f"{spk}: {txt}")
        history_str = "\n\n".join(turns)

    user_ctx = f"\nINTERVENCIÓN DEL ESTUDIANTE / MODERADOR:\n«{user_intervention.strip()}»\nDebes responder con agudeza y respeto pedagógico a este punto específico antes o durante tu réplica." if user_intervention else ""

    system_prompt = f"""Eres {t_name} ({thinker.get('era', '')}), participando en la Arena Dialéctica de Polymath Graph.
Estás en un debate socrático riguroso y apasionado contra {op_name} sobre el tema: «{topic}».

TU PERFIL FILOSÓFICO Y CIENTÍFICO:
- Postura central: {thinker.get('core_stance', '')}
- Cita o principio rector: «{thinker.get('quote', '')}»
- Tu estilo: Elocuente, riguroso, intelectualmente honesto y fiel a tu momento histórico y tus obras.

REGLAS DE LA ARENA DIALÉCTICA:
1. No utilices hombres de paja ni insultos: reconoce con justicia la fuerza del argumento de {op_name} antes de señalar su inconsistencia lógica, empírica o metafísica.
2. Argumenta desde tu propio marco teórico (utiliza tus conceptos clave, paradojas o experimentos mentales célebres).
3. Si el estudiante intervino, integra su aporte para enriquecer la mayéutica.
4. Extensión: Entre 120 y 220 palabras (2 o 3 párrafos vibrantes). Concluye con una pregunta afilada o un desafío conceptual.
5. Lenguaje: Español impecable, culto pero accesible y persuasivo.

DEBES responder ÚNICAMENTE con un objeto JSON válido con esta estructura:
{{
  "text": "Tu intervención en primera persona encarnando a {t_name}.",
  "rigor": 92,
  "key_concept": "Concepto central defendido (ej. incompletitud, falsacionismo, cogito)",
  "fallacy_warning": null
}}
"""

    user_prompt = f"""TEMA DEL DEBATE:
«{topic}»

POSTURA DE TU OPONENTE ({op_name}):
{opponent.get('core_stance', '')}

HISTORIAL RECIENTE DEL DEBATE:
{history_str if history_str else '(Inicio del debate: presenta tu tesis inaugural y reta a ' + op_name + ')'}
{user_ctx}

Genera tu réplica en primera persona en JSON:
"""

    result = await generate_gemini(system_prompt, user_prompt, json_mode=True, temperature=0.35, max_tokens=1000)
    if not isinstance(result, dict) or not result.get("text"):
        return None

    text = str(result["text"]).strip()
    try:
        rigor = max(0, min(100, int(result.get("rigor", 85))))
    except (ValueError, TypeError):
        rigor = 85

    from . import skills
    audit = skills.fallacy_checker(text)

    cfg = get_llm_config()
    return {
        "speaker": thinker_id,
        "name": t_name,
        "avatar": thinker.get("avatar", "🏛️"),
        "text": text,
        "rigor": rigor,
        "fallacies": audit.get("fallacies", []),
        "key_concept": str(result.get("key_concept", thinker.get("nodes", ["critical_thinking"])[0])),
        "engine": f"gemini ({cfg['model']})",
    }



