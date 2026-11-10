"""Módulo de exportación universal para Polymath Graph.

Genera:
1. Bóvedas de Obsidian completas (.zip) con notas interconectadas mediante [[wikilinks]],
   metadatos YAML (frontmatter), índices por disciplina y diagramas Mermaid.
2. Paquetes nativos de Anki (.apkg) con plantillas visuales oscuras, etiquetas por disciplina
   y soporte para todas las versiones de Anki (Desktop, AnkiDroid, iOS, AnkiWeb).
3. Exportación en formato TSV plano para importación rápida en Anki.
"""
from __future__ import annotations

import io
import json
import re
import zipfile
from typing import Any

import genanki

from . import data, db


def sanitize_filename(name: str) -> str:
    """Limpia un nombre para ser usado como archivo seguro en Windows y Unix."""
    cleaned = re.sub(r'[\\/*?:"<>|]', "", name).strip()
    return cleaned or "nota"


DOMAIN_NAMES_ES = {
    "philosophy": "Filosofía",
    "science": "Ciencia",
    "technology": "Tecnología",
    "history": "Historia",
    "logic": "Lógica",
    "art": "Arte",
}

# Modelo de tarjeta Anki de Polymath
POLYMATH_ANKI_MODEL = genanki.Model(
    1607392319,
    "Polymath Card Model",
    fields=[
        {"name": "Front"},
        {"name": "Back"},
        {"name": "Domain"},
        {"name": "NodeId"},
    ],
    templates=[
        {
            "name": "Polymath Card",
            "qfmt": """
<div class="polymath-card">
  <div class="card-header">
    <span class="badge {{Domain}}">{{Domain}}</span>
    {{#NodeId}}<span class="node-chip">✦ {{NodeId}}</span>{{/NodeId}}
  </div>
  <div class="question-body">
    {{Front}}
  </div>
</div>
""",
            "afmt": """
<div class="polymath-card">
  <div class="card-header">
    <span class="badge {{Domain}}">{{Domain}}</span>
    {{#NodeId}}<span class="node-chip">✦ {{NodeId}}</span>{{/NodeId}}
  </div>
  <div class="question-body">
    {{Front}}
  </div>
  <hr class="card-divider" />
  <div class="answer-body">
    {{Back}}
  </div>
</div>
""",
        },
    ],
    css="""
.card {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background-color: #0f172a;
  color: #f1f5f9;
  text-align: left;
  padding: 1.2rem;
}
.polymath-card {
  max-width: 600px;
  margin: 0 auto;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 12px;
  padding: 1.4rem;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}
.card-header {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  align-items: center;
}
.badge {
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: #3b82f6;
  color: white;
}
.badge.philosophy { background: #9333ea; }
.badge.science { background: #059669; }
.badge.technology { background: #0284c7; }
.badge.history { background: #d97706; }
.badge.logic { background: #dc2626; }
.badge.art { background: #db2777; }
.node-chip {
  font-size: 0.75rem;
  color: #94a3b8;
  border: 1px solid #475569;
  border-radius: 4px;
  padding: 0.15rem 0.4rem;
}
.question-body {
  font-size: 1.15rem;
  font-weight: 500;
  line-height: 1.5;
  color: #f8fafc;
}
.card-divider {
  border: 0;
  height: 1px;
  background: #334155;
  margin: 1.2rem 0;
}
.answer-body {
  font-size: 1.05rem;
  line-height: 1.6;
  color: #cbd5e1;
}
""",
)


def export_obsidian_vault(user_id: str = "default") -> bytes:
    """Genera un archivo ZIP con una bóveda de Obsidian completa y navegable."""
    g = data.graph()
    nodes = g["nodes"]
    links = g["links"]
    domains = g.get("domains", {})

    user_state = db.get_user_state(user_id)
    visited_set = set(user_state.get("visited", []))
    user_flashcards = user_state.get("flashcards", [])

    # Agrupar flashcards por nodo
    fc_by_node: dict[str, list[dict]] = {}
    for fc in user_flashcards:
        nid = fc.get("nodeId") or "general"
        fc_by_node.setdefault(nid, []).append(fc)

    # Añadir nodos personalizados del usuario
    custom_nodes = user_state.get("customGraph", {}).get("nodes", [])
    custom_links = user_state.get("customGraph", {}).get("links", [])
    all_nodes = list(nodes) + [cn for cn in custom_nodes if not any(n["id"] == cn["id"] for n in nodes)]
    all_links = list(links) + custom_links

    # Mapeo id -> label y nodo
    node_map = {n["id"]: n for n in all_nodes}

    # Links salientes y entrantes por nodo
    outgoing: dict[str, list[dict]] = {}
    incoming: dict[str, list[dict]] = {}
    for l in all_links:
        s = l["source"]["id"] if isinstance(l.get("source"), dict) else l.get("source")
        t = l["target"]["id"] if isinstance(l.get("target"), dict) else l.get("target")
        rel = l.get("relation", "influences")
        if s and t:
            outgoing.setdefault(s, []).append({"target": t, "relation": rel})
            incoming.setdefault(t, []).append({"source": s, "relation": rel})

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        # 1. 00 - Índice General del Grafo
        index_lines = [
            "---",
            "title: Índice General del Grafo Polímata",
            "tags:",
            "  - polymath/indice",
            "  - pkm/grafo",
            f"exported_user: {user_id}",
            "---",
            "",
            "# 🌌 Grafo de Conocimiento Polímata",
            "",
            "Bienvenido a tu bóveda de **Obsidian**. Todas las notas de este repositorio están interconectadas mediante `[[wikilinks]]` bidireccionales. Abre la vista de grafo de Obsidian (`Ctrl + G`) para explorar la red interactiva.",
            "",
            "## 📊 Estado de tu Aprendizaje",
            f"- **Nodos Totales:** {len(all_nodes)} conceptos interconectados.",
            f"- **Conexiones:** {len(all_links)} puentes transdisciplinarios.",
            f"- **Nodos Explorados por ti:** {len(visited_set)} ({round(len(visited_set) / max(1, len(all_nodes)) * 100)}%).",
            f"- **Flashcards Activas:** {len(user_flashcards)} tarjetas en repaso espaciado.",
            "",
            "## 🧭 Navegación por Disciplinas",
            "",
        ]

        # Desglose por disciplina en el índice
        for dom_key, dom_info in domains.items():
            dom_name = DOMAIN_NAMES_ES.get(dom_key, dom_key.capitalize())
            dom_nodes = [n for n in all_nodes if n.get("domain") == dom_key]
            index_lines.append(f"### {dom_info.get('icon', '📚')} {dom_name} ({len(dom_nodes)} conceptos)")
            for n in sorted(dom_nodes, key=lambda x: x.get("label", x["id"])):
                safe_name = sanitize_filename(n.get("label", n["id"]))
                status_icon = "✅" if n["id"] in visited_set else "○"
                index_lines.append(f"- {status_icon} [[{safe_name}]] — *{n.get('summary', '')[:80]}…*")
            index_lines.append("")

        # Diagrama Mermaid de visión global
        index_lines.extend([
            "## 🗺️ Mapa Transdisciplinario Principal",
            "```mermaid",
            "graph TD",
            "  Filosofia[🟣 Filosofía] <--> Ciencia[🟢 Ciencia]",
            "  Ciencia <--> Tecnologia[🔵 Tecnología]",
            "  Filosofia <--> Logica[🔴 Lógica]",
            "  Logica <--> Tecnologia",
            "  Historia[🟡 Historia] <--> Filosofia",
            "  Arte[🌸 Arte] <--> Filosofia",
            "  Arte <--> Tecnologia",
            "```",
            "",
        ])

        z.writestr("00 - Índice General del Grafo.md", "\n".join(index_lines))

        # 2. Notas individuales por cada nodo
        for node in all_nodes:
            nid = node["id"]
            label = node.get("label", nid)
            safe_title = sanitize_filename(label)
            domain_key = node.get("domain", "science")
            domain_folder = DOMAIN_NAMES_ES.get(domain_key, domain_key.capitalize())
            complexity = node.get("complexity", 3)
            year = node.get("year", 2026)
            authors = node.get("authors", [])
            summary = node.get("summary", "")
            is_visited = nid in visited_set
            custom = node.get("custom", False)

            # YAML Frontmatter
            authors_yaml = "\n".join([f"  - \"{a}\"" for a in authors]) if authors else "  - Anónimo"
            note_content = [
                "---",
                f"id: \"{nid}\"",
                f"title: \"{label}\"",
                f"domain: \"{domain_key}\"",
                f"complexity: {complexity}",
                f"year: {year}",
                f"visited: {str(is_visited).lower()}",
                f"custom: {str(custom).lower()}",
                "authors:",
                authors_yaml,
                "tags:",
                f"  - polymath/{domain_key}",
                f"  - complejidad/{complexity}",
                "---",
                "",
                f"# {label}",
                "",
                f"> **Disciplina:** `{domain_folder}` | **Complejidad:** {'★' * complexity}{'☆' * (5 - complexity)} | **Año/Época:** {year}",
                "",
                "## 💡 Resumen Conceptual",
                summary or "Concepto clave del grafo polímata.",
                "",
                "## 🔗 Enlaces y Conexiones en el Grafo",
                "",
            ]

            # Conexiones salientes (Influencia hacia)
            out_list = outgoing.get(nid, [])
            if out_list:
                note_content.append("### ➡️ Conduce a / Influye en:")
                for item in out_list:
                    target_node = node_map.get(item["target"])
                    if target_node:
                        t_label = sanitize_filename(target_node.get("label", item["target"]))
                        note_content.append(f"- [[{t_label}]] *(relación: `{item['relation']}`)*")
                note_content.append("")

            # Conexiones entrantes (Se fundamenta en / Proviene de)
            in_list = incoming.get(nid, [])
            if in_list:
                note_content.append("### ⬅️ Fundamentado en / Proviene de:")
                for item in in_list:
                    source_node = node_map.get(item["source"])
                    if source_node:
                        s_label = sanitize_filename(source_node.get("label", item["source"]))
                        note_content.append(f"- [[{s_label}]] *(relación: `{item['relation']}`)*")
                note_content.append("")

            if not out_list and not in_list:
                note_content.append("*Nodo frontera sin conexiones registradas.*")
                note_content.append("")

            # Flashcards del nodo si el usuario tiene creadas
            cards_of_node = fc_by_node.get(nid, [])
            if cards_of_node:
                note_content.append("## 🗂️ Tarjetas de Repaso (Flashcards)")
                for idx, c in enumerate(cards_of_node, 1):
                    note_content.append(f"**Tarjeta {idx}:** {c.get('front', '')}")
                    note_content.append(f"> *Respuesta:* {c.get('back', '')}")
                    note_content.append("")

            note_content.append("---")
            note_content.append(f"*Parte del [Índice General](<00 - Índice General del Grafo.md>) · Polymath Graph*")

            # Guardar en su carpeta por disciplina
            file_path = f"{domain_folder}/{safe_title}.md"
            z.writestr(file_path, "\n".join(note_content))

    return buf.getvalue()


def export_anki_package(user_id: str = "default") -> bytes:
    """Genera un archivo .apkg binario nativo de Anki con las tarjetas del usuario."""
    user_state = db.get_user_state(user_id)
    flashcards = user_state.get("flashcards", [])

    # Si el usuario no tiene flashcards todavía, generamos tarjetas modelo de los conceptos
    if not flashcards:
        g = data.graph()
        sample_cards = []
        for n in g["nodes"][:15]:
            sample_cards.append({
                "id": f"seed_{n['id']}",
                "front": f"¿Qué es y qué principio postula «{n.get('label', n['id'])}»?",
                "back": n.get("summary", ""),
                "nodeId": n["id"],
                "tags": [n.get("domain", "general")],
            })
        flashcards = sample_cards

    # Crear mazo Anki con ID determinista
    deck_id = 2026110901
    deck = genanki.Deck(deck_id, "Polymath Graph::Conocimiento Interdisciplinar")

    for fc in flashcards:
        front = fc.get("front", "").strip()
        back = fc.get("back", "").strip()
        node_id = fc.get("nodeId", "").strip()
        tags = fc.get("tags", [])
        domain = tags[0] if tags else "general"

        if not front or not back:
            continue

        note = genanki.Note(
            model=POLYMATH_ANKI_MODEL,
            fields=[front, back, domain, node_id],
            tags=list(tags) + ["polymath_graph"],
        )
        deck.add_note(note)

    package = genanki.Package(deck)
    buf = io.BytesIO()
    package.write_to_file(buf)
    return buf.getvalue()


def export_anki_tsv(user_id: str = "default") -> str:
    """Genera un archivo TSV compatible con la importación estándar de texto en Anki."""
    user_state = db.get_user_state(user_id)
    flashcards = user_state.get("flashcards", [])

    lines = ["# Front\tBack\tTags\tNodeId"]
    for fc in flashcards:
        front = fc.get("front", "").replace("\t", " ").replace("\n", "<br>")
        back = fc.get("back", "").replace("\t", " ").replace("\n", "<br>")
        tags = " ".join(fc.get("tags", []))
        node_id = fc.get("nodeId", "")
        lines.append(f"{front}\t{back}\t{tags}\t{node_id}")

    return "\n".join(lines)
