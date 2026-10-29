// Utilidades de texto compartidas por todos los motores (espejo de backend/app/textutil.py)

/** Normaliza: quita diacríticos y pasa a minúsculas, conservando el mapa de índices al original. */
export function normMap(s) {
  let out = '';
  const map = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    for (let k = 0; k < ch.length; k++) {
      out += ch[k];
      map.push(i);
    }
  }
  return { n: out, map };
}

export const norm = (s) => normMap(s).n;

/** Compila un patrón del catálogo (se normaliza igual que el texto). */
export function rx(pattern, flags = 'i') {
  return new RegExp(norm(pattern), flags);
}

/** Devuelve el fragmento original correspondiente a un match sobre el texto normalizado. */
export function originalSlice(original, map, start, end, pad = 0) {
  const a = Math.max(0, (map[start] ?? 0) - pad);
  const b = Math.min(original.length, (map[Math.max(start, end - 1)] ?? original.length - 1) + 1 + pad);
  return original.slice(a, b).replace(/\s+/g, ' ').trim();
}

export function splitSentences(text) {
  return text
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const STOPWORDS = new Set(
  ('a al algo ante aqui como con contra cual cuando de del desde donde el ella ellos en entre era es esa ese eso esta este esto fue ha han hay la las le les lo los mas me mi mis muy ni no nos o os otra otro para pero poco por porque que quien se sea ser si sin sobre son su sus te tiene tu un una uno unos y ya yo ' +
    'the a an and are as at be but by for from has have he her his i in is it its of on or our she so than that their them then there these they this to was we were what when which who will with you your').split(' ')
);

export function tokenize(text) {
  return norm(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Reconstruye párrafos naturales a partir de textos con saltos de línea excesivos o palabra por palabra. */
export function cleanDocumentText(text) {
  if (!text) return '';
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n{2,}/);
  const cleaned = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    const current = [];
    for (const line of lines) {
      const isBullet = /^(?:[•\-\*]|\d+[\.\)])\s+/.test(line);
      if (isBullet && current.length) {
        cleaned.push(current.join(' '));
        current.length = 0;
        current.push(line);
      } else {
        if (current.length && current[current.length - 1].endsWith('-') && current[current.length - 1].length > 1) {
          current[current.length - 1] = current[current.length - 1].slice(0, -1) + line;
        } else {
          current.push(line);
        }
      }
    }
    if (current.length) {
      cleaned.push(current.join(' '));
    }
  }

  return cleaned.join('\n\n');
}

/** Renderiza Markdown ligero (negrita, cursiva, código, listas, saltos) a HTML seguro. */
export function renderMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);

  // Código en línea
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Negrita con ** o __
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

  // Cursiva con * o _
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  html = html.replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>');

  // Viñetas y listas
  const lines = html.split('\n');
  const out = [];
  let inList = false;

  for (const line of lines) {
    const bulletMatch = line.match(/^\s*(?:[•\-\*]|\d+[\.\)])\s+(.+)$/);
    if (bulletMatch) {
      if (!inList) {
        out.push('<ul style="margin:.3rem 0;padding-left:1.2rem;">');
        inList = true;
      }
      out.push(`<li>${bulletMatch[1]}</li>`);
    } else {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      out.push(line);
    }
  }
  if (inList) out.push('</ul>');

  html = out.join('\n');
  html = html.replace(/\n/g, '<br>');
  html = html.replace(/<br><ul/g, '<ul').replace(/<\/ul><br>/g, '</ul>');

  return html;
}
