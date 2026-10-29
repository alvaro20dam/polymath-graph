// Lógica proposicional: parser, tablas de verdad, clasificación y validez de argumentos.

const OPS = [
  // [regex del token, tipo canónico]
  [/^(<->|<=>|↔|⇔|\bIFF\b)/i, 'IFF'],
  [/^(->|=>|→|⇒|\bIMPLIES\b)/i, 'IMP'],
  [/^(⊕|\bXOR\b)/i, 'XOR'],
  [/^(∧|&&|&|\^|\bAND\b)/i, 'AND'],
  [/^(∨|\|\||\||\bOR\b)/i, 'OR'],
  [/^(¬|!|~|\bNOT\b)/i, 'NOT'],
  [/^\(/, 'LP'],
  [/^\)/, 'RP'],
  [/^(⊤|\bTRUE\b|\b1\b)/i, 'TRUE'],
  [/^(⊥|\bFALSE\b|\b0\b)/i, 'FALSE'],
];

export function tokenizeFormula(src) {
  const toks = [];
  let s = src.trim();
  while (s.length) {
    if (/^\s/.test(s)) { s = s.replace(/^\s+/, ''); continue; }
    let matched = false;
    for (const [re, type] of OPS) {
      const m = re.exec(s);
      if (m) { toks.push({ type }); s = s.slice(m[0].length); matched = true; break; }
    }
    if (matched) continue;
    const id = /^[A-Za-z][A-Za-z0-9_]*/.exec(s);
    if (id) { toks.push({ type: 'VAR', name: id[0] }); s = s.slice(id[0].length); continue; }
    throw new Error(`Símbolo no reconocido cerca de «${s.slice(0, 6)}»`);
  }
  return toks;
}

/** Precedencia (menor a mayor): IFF < IMP (der.) < OR/XOR < AND < NOT */
export function parse(src) {
  const toks = tokenizeFormula(src);
  if (!toks.length) throw new Error('Fórmula vacía');
  let i = 0;
  const peek = () => toks[i]?.type;
  const eat = (t) => { if (peek() !== t) throw new Error(`Se esperaba ${t}`); return toks[i++]; };

  function iff() {
    let l = imp();
    while (peek() === 'IFF') { i++; l = { op: 'IFF', l, r: imp() }; }
    return l;
  }
  function imp() {
    const l = or();
    if (peek() === 'IMP') { i++; return { op: 'IMP', l, r: imp() }; }
    return l;
  }
  function or() {
    let l = and();
    while (peek() === 'OR' || peek() === 'XOR') { const op = toks[i++].type; l = { op, l, r: and() }; }
    return l;
  }
  function and() {
    let l = not();
    while (peek() === 'AND') { i++; l = { op: 'AND', l, r: not() }; }
    return l;
  }
  function not() {
    if (peek() === 'NOT') { i++; return { op: 'NOT', e: not() }; }
    return atom();
  }
  function atom() {
    const t = toks[i];
    if (!t) throw new Error('Fórmula incompleta');
    if (t.type === 'VAR') { i++; return { op: 'VAR', name: t.name }; }
    if (t.type === 'TRUE' || t.type === 'FALSE') { i++; return { op: t.type }; }
    if (t.type === 'LP') { i++; const e = iff(); eat('RP'); return e; }
    throw new Error('Expresión inesperada');
  }
  const ast = iff();
  if (i < toks.length) throw new Error('Sobran símbolos al final de la fórmula');
  return ast;
}

export function variables(ast, acc = new Set()) {
  if (ast.op === 'VAR') acc.add(ast.name);
  else if (ast.op === 'NOT') variables(ast.e, acc);
  else if (ast.l) { variables(ast.l, acc); variables(ast.r, acc); }
  return acc;
}

export function evaluate(ast, env) {
  switch (ast.op) {
    case 'VAR': return !!env[ast.name];
    case 'TRUE': return true;
    case 'FALSE': return false;
    case 'NOT': return !evaluate(ast.e, env);
    case 'AND': return evaluate(ast.l, env) && evaluate(ast.r, env);
    case 'OR': return evaluate(ast.l, env) || evaluate(ast.r, env);
    case 'XOR': return evaluate(ast.l, env) !== evaluate(ast.r, env);
    case 'IMP': return !evaluate(ast.l, env) || evaluate(ast.r, env);
    case 'IFF': return evaluate(ast.l, env) === evaluate(ast.r, env);
    default: throw new Error('Nodo desconocido');
  }
}

// Convención: la primera fila es todo Verdadero (como en los textos de lógica).
function* rowsTrueFirst(vars) {
  const n = vars.length;
  for (let k = 0; k < 2 ** n; k++) {
    const env = {};
    vars.forEach((v, idx) => { env[v] = !((k >> (n - 1 - idx)) & 1); });
    yield env;
  }
}

export function truthTable(sources) {
  const asts = sources.map(parse);
  const set = new Set();
  asts.forEach((a) => variables(a, set));
  const vars = [...set].sort();
  if (vars.length > 8) throw new Error('Máximo 8 variables');
  const rows = [];
  for (const env of rowsTrueFirst(vars)) rows.push({ env, values: asts.map((a) => evaluate(a, env)) });
  return { vars, rows };
}

export function classify(source) {
  const { rows } = truthTable([source]);
  const vals = rows.map((r) => r.values[0]);
  if (vals.every(Boolean)) return 'tautología';
  if (vals.every((v) => !v)) return 'contradicción';
  return 'contingencia';
}

/** Validez: no existe fila con todas las premisas V y la conclusión F. */
export function checkValidity(premises, conclusion) {
  const { vars, rows } = truthTable([...premises, conclusion]);
  const counter = rows.find((r) => r.values.slice(0, -1).every(Boolean) && !r.values[r.values.length - 1]);
  return { valid: !counter, counterexample: counter?.env ?? null, vars, rows };
}

export const EXAMPLES = [
  { name: 'Modus ponens', premises: ['P -> Q', 'P'], conclusion: 'Q' },
  { name: 'Modus tollens', premises: ['P -> Q', '!Q'], conclusion: '!P' },
  { name: 'Afirmar el consecuente (falacia)', premises: ['P -> Q', 'Q'], conclusion: 'P' },
  { name: 'Negar el antecedente (falacia)', premises: ['P -> Q', '!P'], conclusion: '!Q' },
  { name: 'Silogismo hipotético', premises: ['P -> Q', 'Q -> R'], conclusion: 'P -> R' },
  { name: 'Silogismo disyuntivo', premises: ['P | Q', '!P'], conclusion: 'Q' },
  { name: 'De Morgan', premises: ['!(P & Q)'], conclusion: '!P | !Q' },
];
