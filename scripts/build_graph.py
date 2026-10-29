"""GraphArchitect_Agent: construye y valida data/graph.json.

Uso:  python scripts/build_graph.py
Es la implementación offline de las skills `graph_node_builder`,
`semantic_link_evaluator` y `citation_network_mapper`.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "graph.json"

DOMAINS = {
    "philosophy": {"label": "Filosofía", "color": "#c084fc"},
    "science": {"label": "Ciencia", "color": "#34d399"},
    "technology": {"label": "Tecnología", "color": "#38bdf8"},
    "history": {"label": "Historia", "color": "#fbbf24"},
    "logic": {"label": "Lógica y Matemática", "color": "#f87171"},
    "art": {"label": "Arte", "color": "#f472b6"},
}

RELATIONS = {
    "foundation": "es fundamento de",
    "influences": "influye en",
    "extends": "extiende a",
    "applies": "se aplica en",
    "contrasts": "contrasta con",
    "enables": "hace posible",
}

# (id, etiqueta, dominio, complejidad 1-5, año, autores, resumen)
N = [
    # --- Filosofía ---
    ("socratic_method", "Método socrático", "philosophy", 1, -399, ["Sócrates", "Platón"], "Indagación mediante preguntas que expone contradicciones y hace que el interlocutor construya su propio conocimiento."),
    ("platonic_forms", "Teoría de las Formas", "philosophy", 2, -380, ["Platón"], "Las ideas perfectas e inmutables existen más allá del mundo sensible; lo que vemos son copias imperfectas."),
    ("stoicism", "Estoicismo", "philosophy", 1, -300, ["Zenón de Citio", "Epicteto", "Marco Aurelio"], "Escuela que distingue lo que depende de nosotros de lo que no; base ética y lógica (Crisipo) con huella en la terapia cognitiva."),
    ("empiricism", "Empirismo", "philosophy", 2, 1690, ["John Locke", "David Hume"], "Todo conocimiento procede de la experiencia sensible; Hume cuestiona la inducción y la causalidad."),
    ("rationalism", "Racionalismo", "philosophy", 2, 1641, ["Descartes", "Spinoza", "Leibniz"], "La razón es fuente primaria del conocimiento; Leibniz sueña con un cálculo universal del razonamiento."),
    ("kant_critique", "Crítica de la razón pura", "philosophy", 4, 1781, ["Immanuel Kant"], "Sintetiza empirismo y racionalismo: conocemos fenómenos estructurados por categorías de la mente, no cosas en sí."),
    ("utilitarianism", "Utilitarismo", "philosophy", 2, 1789, ["Jeremy Bentham", "John Stuart Mill"], "Una acción es correcta si maximiza el bienestar agregado; ética de consecuencias medibles."),
    ("existentialism", "Existencialismo", "philosophy", 3, 1943, ["Kierkegaard", "Sartre", "Camus"], "La existencia precede a la esencia: el individuo crea sentido en un mundo sin sentido dado."),
    ("epistemology", "Epistemología", "philosophy", 2, 1963, ["Edmund Gettier", "Karl Popper"], "Estudia qué es el conocimiento, cómo se justifica y dónde están sus límites."),
    ("philosophy_of_mind", "Filosofía de la mente", "philosophy", 3, 1995, ["David Chalmers", "Daniel Dennett", "John Searle"], "¿Qué es la conciencia? Problema difícil de la experiencia subjetiva frente a la explicación funcional."),
    ("critical_thinking", "Pensamiento crítico", "philosophy", 2, 1910, ["John Dewey"], "Evaluar afirmaciones con evidencia, lógica y conciencia de los propios sesgos antes de aceptarlas."),
    ("falsificationism", "Falsacionismo", "philosophy", 3, 1934, ["Karl Popper"], "Una teoría es científica si puede, en principio, ser refutada por la observación."),
    ("paradigm_shifts", "Revoluciones científicas", "philosophy", 3, 1962, ["Thomas Kuhn"], "La ciencia avanza por rupturas de paradigma, no solo por acumulación gradual de hechos."),
    ("ethics_of_ai", "Ética de la IA", "philosophy", 3, 2014, ["Nick Bostrom", "Stuart Russell", "Timnit Gebru"], "Alineación, sesgo algorítmico, responsabilidad y transparencia de sistemas automáticos."),
    # --- Lógica y Matemática ---
    ("aristotelian_logic", "Lógica aristotélica", "logic", 1, -350, ["Aristóteles"], "Primer sistema formal: silogismos que garantizan que la conclusión se sigue de las premisas."),
    ("propositional_logic", "Lógica proposicional", "logic", 2, 1854, ["George Boole", "Crisipo"], "Álgebra de proposiciones con conectivos (y, o, no, implica) y tablas de verdad."),
    ("predicate_logic", "Lógica de predicados", "logic", 3, 1879, ["Gottlob Frege"], "Añade cuantificadores (∀, ∃) para razonar sobre objetos y propiedades."),
    ("set_theory", "Teoría de conjuntos", "logic", 3, 1874, ["Georg Cantor"], "Fundamento de la matemática moderna; revela infinitos de distinto tamaño."),
    ("godel_incompleteness", "Teoremas de incompletitud", "logic", 5, 1931, ["Kurt Gödel"], "Todo sistema formal consistente y suficientemente rico contiene verdades que no puede demostrar."),
    ("probability", "Probabilidad", "logic", 2, 1654, ["Pascal", "Fermat", "Kolmogorov"], "Cuantifica la incertidumbre; nace de la correspondencia sobre juegos de azar."),
    ("bayes_theorem", "Teorema de Bayes", "logic", 3, 1763, ["Thomas Bayes", "Laplace"], "Regla para actualizar creencias: posterior ∝ verosimilitud × prior."),
    ("expected_value", "Esperanza matemática", "logic", 2, 1657, ["Christiaan Huygens", "Pascal"], "El valor promedio a largo plazo de una variable aleatoria: E[X] = Σ x·p(x)."),
    ("variance", "Varianza y desviación", "logic", 2, 1918, ["Ronald Fisher"], "Mide la dispersión alrededor de la esperanza: Var(X) = E[(X−μ)²]."),
    ("law_large_numbers", "Ley de los grandes números", "logic", 3, 1713, ["Jacob Bernoulli"], "El promedio de muchas repeticiones converge a la esperanza."),
    ("normal_distribution", "Distribución normal", "logic", 3, 1809, ["de Moivre", "Gauss"], "La curva de campana, emergente por el teorema central del límite."),
    ("game_theory", "Teoría de juegos", "logic", 4, 1944, ["von Neumann", "John Nash"], "Decisión estratégica entre agentes interdependientes; equilibrio de Nash."),
    ("information_theory", "Teoría de la información", "logic", 4, 1948, ["Claude Shannon"], "La información se mide en bits; entropía como incertidumbre media de una fuente."),
    ("fallacies", "Falacias lógicas", "logic", 2, -350, ["Aristóteles", "Hamblin"], "Errores de razonamiento que parecen válidos pero no sostienen la conclusión."),
    ("cognitive_biases", "Sesgos cognitivos", "logic", 2, 1974, ["Daniel Kahneman", "Amos Tversky"], "Desviaciones sistemáticas del juicio racional causadas por atajos mentales."),
    ("calculus", "Cálculo infinitesimal", "logic", 3, 1687, ["Newton", "Leibniz"], "Lenguaje del cambio continuo: derivadas e integrales."),
    ("linear_algebra", "Álgebra lineal", "logic", 3, 1844, ["Grassmann", "Cayley"], "Vectores, matrices y transformaciones lineales; lenguaje de los datos."),
    ("graph_theory", "Teoría de grafos", "logic", 3, 1736, ["Leonhard Euler"], "Estudio matemático de nodos y aristas; nació con los puentes de Königsberg."),
    # --- Ciencia ---
    ("scientific_method", "Método científico", "science", 2, 1620, ["Francis Bacon", "Galileo", "Ibn al-Haytham"], "Ciclo de observación, hipótesis, experimento y revisión por pares."),
    ("newtonian_mechanics", "Mecánica newtoniana", "science", 3, 1687, ["Isaac Newton"], "Leyes del movimiento y gravitación universal: un universo predecible."),
    ("evolution", "Selección natural", "science", 2, 1859, ["Charles Darwin", "Alfred Wallace"], "Variación heredable + presión selectiva = adaptación y diversidad de la vida."),
    ("genetics_dna", "Genética y ADN", "science", 3, 1953, ["Watson", "Crick", "Rosalind Franklin"], "La herencia se codifica en una molécula; la vida como procesamiento de información."),
    ("relativity", "Relatividad", "science", 4, 1905, ["Albert Einstein"], "Espacio y tiempo se entrelazan; la gravedad es curvatura del espacio-tiempo."),
    ("quantum_mechanics", "Mecánica cuántica", "science", 5, 1925, ["Planck", "Heisenberg", "Schrödinger"], "A escala atómica la naturaleza es probabilística; superposición y medición."),
    ("thermodynamics_entropy", "Termodinámica y entropía", "science", 4, 1850, ["Clausius", "Boltzmann"], "La entropía de un sistema aislado tiende a crecer; flecha del tiempo."),
    ("neuroscience", "Neurociencia", "science", 3, 1888, ["Santiago Ramón y Cajal", "Hubel", "Wiesel"], "La mente emerge de redes de neuronas que se comunican por sinapsis."),
    ("complexity_systems", "Sistemas complejos", "science", 4, 1984, ["Prigogine", "Instituto Santa Fe"], "Comportamiento emergente de muchos agentes simples que interactúan."),
    # --- Tecnología ---
    ("turing_machine", "Máquina de Turing", "technology", 4, 1936, ["Alan Turing"], "Modelo abstracto de computación; define qué es computable."),
    ("algorithms", "Algoritmos", "technology", 2, 820, ["al-Khwarizmi", "Donald Knuth"], "Procedimientos finitos y precisos para resolver una clase de problemas."),
    ("symbolic_ai", "IA simbólica", "technology", 3, 1956, ["John McCarthy", "Marvin Minsky"], "Inteligencia como manipulación de símbolos y reglas lógicas explícitas."),
    ("perceptron", "Perceptrón", "technology", 3, 1958, ["Frank Rosenblatt"], "Primera neurona artificial que aprende: suma ponderada + umbral."),
    ("backpropagation", "Retropropagación", "technology", 4, 1986, ["Rumelhart", "Hinton", "Williams"], "Calcula gradientes capa por capa con la regla de la cadena para entrenar redes."),
    ("gradient_descent", "Descenso del gradiente", "technology", 3, 1847, ["Augustin-Louis Cauchy"], "Minimiza una función avanzando en dirección opuesta a su gradiente."),
    ("neural_networks", "Redes neuronales", "technology", 4, 1986, ["Geoffrey Hinton", "Yann LeCun", "Yoshua Bengio"], "Aproximadores universales de funciones formados por capas de neuronas artificiales."),
    ("transformers", "Transformers y LLMs", "technology", 5, 2017, ["Vaswani et al."], "Arquitectura basada en atención que da lugar a los modelos de lenguaje actuales."),
    ("chinese_room", "Habitación china", "technology", 3, 1980, ["John Searle"], "Experimento mental: manipular símbolos no equivale a comprender."),
    ("internet_hypertext", "Hipertexto y la Web", "technology", 2, 1989, ["Vannevar Bush", "Ted Nelson", "Tim Berners-Lee"], "Documentos enlazados que permiten lectura no lineal: precursor del 'rabbit hole'."),
    ("cryptography", "Criptografía", "technology", 4, 1977, ["Rivest", "Shamir", "Adleman"], "Matemática para ocultar información y verificar identidad."),
    ("knowledge_graphs", "Grafos de conocimiento", "technology", 3, 2012, ["Google", "Tim Berners-Lee"], "Entidades y relaciones semánticas representadas como red consultable."),
    ("rag", "RAG y embeddings", "technology", 4, 2020, ["Patrick Lewis et al."], "Recuperar fragmentos relevantes por similitud vectorial para fundamentar la respuesta de un modelo."),
    # --- Historia ---
    ("athenian_democracy", "Democracia ateniense", "history", 1, -508, ["Clístenes", "Pericles"], "Debate público y retórica como práctica política; contexto de sofistas y Sócrates."),
    ("library_alexandria", "Biblioteca de Alejandría", "history", 1, -285, ["Ptolomeo I", "Eratóstenes"], "Ambición de reunir todo el saber del mundo conocido."),
    ("islamic_golden_age", "Edad de Oro islámica", "history", 2, 800, ["al-Khwarizmi", "Ibn al-Haytham", "Avicena"], "Casa de la Sabiduría: traducción, álgebra, óptica experimental y medicina."),
    ("renaissance", "Renacimiento", "history", 2, 1400, ["Leonardo", "Alberti", "Erasmo"], "Resurgir del humanismo clásico y fusión de arte, ciencia e ingeniería."),
    ("printing_press", "Imprenta de Gutenberg", "history", 2, 1440, ["Johannes Gutenberg"], "Reproducción barata del texto: acelera la circulación de ideas en Europa."),
    ("scientific_revolution", "Revolución científica", "history", 3, 1543, ["Copérnico", "Galileo", "Kepler"], "Nace la ciencia moderna: matemática + experimento + instituciones."),
    ("enlightenment", "Ilustración", "history", 2, 1715, ["Voltaire", "Kant", "Diderot"], "Siglo de la razón, la enciclopedia y los derechos individuales."),
    ("industrial_revolution", "Revolución industrial", "history", 2, 1760, ["James Watt"], "Mecanización, vapor y urbanización transforman producción y sociedad."),
    ("ww2_computing", "Computación en la 2ª Guerra Mundial", "history", 3, 1943, ["Alan Turing", "Tommy Flowers", "Grace Hopper"], "Bletchley Park y los primeros computadores electrónicos nacen de la criptoanálisis."),
    # --- Arte ---
    ("perspective_renaissance", "Perspectiva lineal", "art", 2, 1415, ["Brunelleschi", "Alberti"], "Geometría proyectiva para representar profundidad en un plano."),
    ("golden_ratio", "Proporción áurea", "art", 2, 1509, ["Luca Pacioli", "Euclides"], "φ ≈ 1,618: la razón recurrente en geometría, naturaleza y composición."),
    ("music_theory_math", "Música y matemática", "art", 2, -530, ["Pitágoras", "J. S. Bach"], "Intervalos como razones numéricas; contrapunto como estructura formal."),
    ("cubism", "Cubismo", "art", 3, 1907, ["Picasso", "Braque"], "Múltiples puntos de vista simultáneos que rompen con la perspectiva única."),
    ("surrealism", "Surrealismo", "art", 3, 1924, ["André Breton", "Salvador Dalí"], "Explora el inconsciente y lo irracional como fuente creativa."),
    ("escher_infinity", "Escher y el infinito", "art", 3, 1948, ["M. C. Escher"], "Teselaciones, bucles imposibles y paradojas visuales con rigor matemático."),
    ("generative_art", "Arte generativo", "art", 3, 1965, ["Vera Molnár", "Frieder Nake"], "Obra definida por reglas y algoritmos; hoy extendida por redes neuronales."),
    ("data_visualization", "Visualización de datos", "art", 2, 1869, ["Charles Minard", "Florence Nightingale", "Edward Tufte"], "Arte y ciencia de contar historias con datos de forma honesta."),
]

# (origen, destino, relación)
E = [
    ("athenian_democracy", "socratic_method", "influences"),
    ("athenian_democracy", "fallacies", "influences"),
    ("socratic_method", "critical_thinking", "foundation"),
    ("socratic_method", "platonic_forms", "influences"),
    ("platonic_forms", "aristotelian_logic", "influences"),
    ("platonic_forms", "golden_ratio", "influences"),
    ("platonic_forms", "music_theory_math", "influences"),
    ("aristotelian_logic", "propositional_logic", "foundation"),
    ("aristotelian_logic", "fallacies", "foundation"),
    ("aristotelian_logic", "scientific_method", "influences"),
    ("aristotelian_logic", "symbolic_ai", "influences"),
    ("aristotelian_logic", "stoicism", "influences"),
    ("stoicism", "propositional_logic", "foundation"),
    ("stoicism", "critical_thinking", "influences"),
    ("propositional_logic", "predicate_logic", "extends"),
    ("propositional_logic", "symbolic_ai", "foundation"),
    ("predicate_logic", "godel_incompleteness", "foundation"),
    ("set_theory", "predicate_logic", "foundation"),
    ("set_theory", "probability", "foundation"),
    ("set_theory", "escher_infinity", "influences"),
    ("godel_incompleteness", "turing_machine", "influences"),
    ("godel_incompleteness", "philosophy_of_mind", "influences"),
    ("godel_incompleteness", "escher_infinity", "influences"),
    ("turing_machine", "algorithms", "foundation"),
    ("turing_machine", "symbolic_ai", "foundation"),
    ("turing_machine", "ww2_computing", "applies"),
    ("ww2_computing", "cryptography", "applies"),
    ("ww2_computing", "game_theory", "influences"),
    ("chinese_room", "symbolic_ai", "contrasts"),
    ("chinese_room", "philosophy_of_mind", "extends"),
    ("islamic_golden_age", "algorithms", "foundation"),
    ("islamic_golden_age", "scientific_method", "influences"),
    ("islamic_golden_age", "scientific_revolution", "influences"),
    ("library_alexandria", "islamic_golden_age", "influences"),
    ("library_alexandria", "internet_hypertext", "influences"),
    ("scientific_method", "falsificationism", "extends"),
    ("falsificationism", "paradigm_shifts", "contrasts"),
    ("falsificationism", "epistemology", "extends"),
    ("scientific_revolution", "scientific_method", "foundation"),
    ("scientific_revolution", "newtonian_mechanics", "foundation"),
    ("scientific_revolution", "enlightenment", "influences"),
    ("renaissance", "scientific_revolution", "influences"),
    ("renaissance", "perspective_renaissance", "foundation"),
    ("printing_press", "renaissance", "enables"),
    ("printing_press", "scientific_revolution", "enables"),
    ("printing_press", "enlightenment", "enables"),
    ("internet_hypertext", "knowledge_graphs", "foundation"),
    ("graph_theory", "knowledge_graphs", "foundation"),
    ("graph_theory", "complexity_systems", "applies"),
    ("knowledge_graphs", "rag", "enables"),
    ("symbolic_ai", "knowledge_graphs", "foundation"),
    ("symbolic_ai", "neural_networks", "contrasts"),
    ("perceptron", "symbolic_ai", "contrasts"),
    ("perceptron", "neural_networks", "foundation"),
    ("neuroscience", "perceptron", "influences"),
    ("neuroscience", "philosophy_of_mind", "influences"),
    ("calculus", "gradient_descent", "foundation"),
    ("calculus", "newtonian_mechanics", "foundation"),
    ("gradient_descent", "backpropagation", "foundation"),
    ("backpropagation", "neural_networks", "foundation"),
    ("linear_algebra", "neural_networks", "foundation"),
    ("linear_algebra", "quantum_mechanics", "foundation"),
    ("neural_networks", "transformers", "foundation"),
    ("neural_networks", "ethics_of_ai", "influences"),
    ("neural_networks", "generative_art", "applies"),
    ("transformers", "rag", "foundation"),
    ("transformers", "ethics_of_ai", "influences"),
    ("information_theory", "transformers", "applies"),
    ("information_theory", "cryptography", "foundation"),
    ("information_theory", "complexity_systems", "applies"),
    ("philosophy_of_mind", "ethics_of_ai", "influences"),
    ("utilitarianism", "ethics_of_ai", "influences"),
    ("ethics_of_ai", "critical_thinking", "influences"),
    ("probability", "bayes_theorem", "foundation"),
    ("probability", "expected_value", "foundation"),
    ("probability", "law_large_numbers", "foundation"),
    ("expected_value", "variance", "extends"),
    ("expected_value", "game_theory", "foundation"),
    ("law_large_numbers", "normal_distribution", "extends"),
    ("variance", "normal_distribution", "applies"),
    ("normal_distribution", "data_visualization", "applies"),
    ("bayes_theorem", "cognitive_biases", "applies"),
    ("bayes_theorem", "epistemology", "applies"),
    ("bayes_theorem", "scientific_method", "applies"),
    ("fallacies", "critical_thinking", "foundation"),
    ("cognitive_biases", "critical_thinking", "foundation"),
    ("epistemology", "critical_thinking", "foundation"),
    ("empiricism", "epistemology", "foundation"),
    ("empiricism", "scientific_method", "foundation"),
    ("empiricism", "enlightenment", "influences"),
    ("empiricism", "rationalism", "contrasts"),
    ("empiricism", "kant_critique", "influences"),
    ("rationalism", "epistemology", "foundation"),
    ("rationalism", "kant_critique", "influences"),
    ("rationalism", "calculus", "influences"),
    ("rationalism", "propositional_logic", "influences"),
    ("kant_critique", "utilitarianism", "contrasts"),
    ("kant_critique", "existentialism", "influences"),
    ("utilitarianism", "enlightenment", "extends"),
    ("enlightenment", "industrial_revolution", "influences"),
    ("industrial_revolution", "thermodynamics_entropy", "influences"),
    ("industrial_revolution", "data_visualization", "influences"),
    ("thermodynamics_entropy", "information_theory", "influences"),
    ("thermodynamics_entropy", "complexity_systems", "foundation"),
    ("existentialism", "surrealism", "influences"),
    ("golden_ratio", "perspective_renaissance", "influences"),
    ("music_theory_math", "generative_art", "influences"),
    ("algorithms", "generative_art", "applies"),
    ("surrealism", "generative_art", "influences"),
    ("perspective_renaissance", "cubism", "contrasts"),
    ("escher_infinity", "perspective_renaissance", "extends"),
    ("relativity", "cubism", "influences"),
    ("relativity", "quantum_mechanics", "contrasts"),
    ("relativity", "paradigm_shifts", "applies"),
    ("newtonian_mechanics", "relativity", "extends"),
    ("quantum_mechanics", "probability", "applies"),
    ("evolution", "genetics_dna", "foundation"),
    ("evolution", "cognitive_biases", "influences"),
    ("evolution", "paradigm_shifts", "applies"),
    ("genetics_dna", "information_theory", "influences"),
    ("game_theory", "evolution", "applies"),
    ("complexity_systems", "evolution", "applies"),
    ("data_visualization", "critical_thinking", "applies"),
    ("enlightenment", "kant_critique", "influences"),
    ("predicate_logic", "symbolic_ai", "foundation"),
    ("expected_value", "utilitarianism", "influences"),
    ("variance", "evolution", "applies"),
    ("law_large_numbers", "scientific_method", "applies"),
    ("backpropagation", "neuroscience", "contrasts"),
    ("rag", "critical_thinking", "applies"),
    ("printing_press", "internet_hypertext", "influences"),
]

PATHS = [
    {"id": "aristotle-to-llm", "title": "De Aristóteles a los Transformers", "description": "Cómo la lógica formal desembocó en la IA moderna y por qué importa el pensamiento crítico.",
     "nodes": ["aristotelian_logic", "propositional_logic", "turing_machine", "symbolic_ai", "perceptron", "neural_networks", "transformers", "ethics_of_ai", "critical_thinking"]},
    {"id": "critical-thinking", "title": "Pensamiento crítico completo", "description": "Del diálogo socrático a la detección de falacias y sesgos.",
     "nodes": ["socratic_method", "aristotelian_logic", "fallacies", "cognitive_biases", "bayes_theorem", "critical_thinking"]},
    {"id": "probability-decisions", "title": "Probabilidad para decidir", "description": "De los juegos de azar a la actualización bayesiana de creencias.",
     "nodes": ["probability", "expected_value", "variance", "law_large_numbers", "normal_distribution", "bayes_theorem"]},
    {"id": "art-and-math", "title": "Arte y matemática", "description": "Proporciones, perspectiva y algoritmos como herramientas de creación.",
     "nodes": ["platonic_forms", "golden_ratio", "perspective_renaissance", "cubism", "generative_art"]},
    {"id": "how-science-changes", "title": "Cómo cambia la ciencia", "description": "Método, refutación y rupturas de paradigma.",
     "nodes": ["scientific_method", "falsificationism", "paradigm_shifts", "relativity", "quantum_mechanics"]},
]


def build() -> dict:
    ids = [n[0] for n in N]
    assert len(ids) == len(set(ids)), "ids duplicados"
    nodes = []
    for id_, label, domain, cx, year, authors, summary in N:
        nodes.append({"id": id_, "label": label, "domain": domain, "complexity": cx,
                      "year": year, "authors": authors, "summary": summary})
    links = [{"source": s, "target": t, "relation": r} for s, t, r in E]
    return {"domains": DOMAINS, "relations": RELATIONS, "nodes": nodes, "links": links, "paths": PATHS}


def validate(g: dict) -> list[str]:
    """semantic_link_evaluator: reglas de calidad del grafo."""
    errs: list[str] = []
    by_id = {n["id"]: n for n in g["nodes"]}
    seen = set()
    deg = defaultdict(int)
    cross = defaultdict(int)
    for l in g["links"]:
        s, t = l["source"], l["target"]
        if s not in by_id or t not in by_id:
            errs.append(f"arista con nodo inexistente: {s}->{t}")
            continue
        if s == t:
            errs.append(f"auto-bucle: {s}")
        if (s, t) in seen:
            errs.append(f"arista duplicada: {s}->{t}")
        seen.add((s, t))
        if l["relation"] not in g["relations"]:
            errs.append(f"relación desconocida: {l['relation']}")
        deg[s] += 1
        deg[t] += 1
        if by_id[s]["domain"] != by_id[t]["domain"]:
            cross[s] += 1
            cross[t] += 1
    for n in g["nodes"]:
        if not (1 <= n["complexity"] <= 5):
            errs.append(f"complejidad inválida: {n['id']}")
        if not n["authors"]:
            errs.append(f"sin autores: {n['id']}")
        if n["domain"] not in g["domains"]:
            errs.append(f"dominio inválido: {n['id']}")
        if deg[n["id"]] < 2:
            errs.append(f"grado < 2: {n['id']}")
        if cross[n["id"]] < 1:
            errs.append(f"sin enlace cruzado entre disciplinas: {n['id']}")
    for p in g["paths"]:
        for nid in p["nodes"]:
            if nid not in by_id:
                errs.append(f"ruta {p['id']} referencia nodo inexistente: {nid}")
    return errs


if __name__ == "__main__":
    graph = build()
    problems = validate(graph)
    if problems:
        print("\n".join(problems))
        sys.exit(1)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(graph, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"OK: {len(graph['nodes'])} nodos, {len(graph['links'])} aristas -> {OUT}")
