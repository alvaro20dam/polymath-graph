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
    for alt in ["gemini-3.1-flash-lite", "gemini-3.5-flash"]:
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

    async with httpx.AsyncClient(timeout=10.0) as client:
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
                        try:
                            return json.loads(text)
                        except json.JSONDecodeError:
                            clean = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
                            return json.loads(clean)
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

    models_to_try = ["gemini-3.1-flash-lite", "gemini-3.5-flash"]
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
