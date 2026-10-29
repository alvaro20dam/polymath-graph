"""Utilidades de texto (espejo de frontend/src/engines/text.js)."""
from __future__ import annotations

import re
import unicodedata

STOPWORDS = set(
    (
        "a al algo ante aqui como con contra cual cuando de del desde donde el ella ellos en entre era es esa ese eso esta este esto fue ha han hay "
        "la las le les lo los mas me mi mis muy ni no nos o os otra otro para pero poco por porque que quien se sea ser si sin sobre son su sus te tiene tu un una uno unos y ya yo "
        "the a an and are as at be but by for from has have he her his i in is it its of on or our she so than that their them then there these they this to was we were what when which who will with you your"
    ).split()
)


def norm_map(s: str) -> tuple[str, list[int]]:
    """Quita diacríticos y pasa a minúsculas, conservando el mapa de índices al texto original."""
    out: list[str] = []
    idx: list[int] = []
    for i, ch in enumerate(s):
        d = "".join(c for c in unicodedata.normalize("NFD", ch) if unicodedata.category(c) != "Mn").lower()
        for c in d:
            out.append(c)
            idx.append(i)
    return "".join(out), idx


def norm(s: str) -> str:
    return norm_map(s)[0]


def rx(pattern: str) -> re.Pattern:
    return re.compile(norm(pattern), re.IGNORECASE)


def original_slice(original: str, idx: list[int], start: int, end: int, pad: int = 0) -> str:
    a = max(0, (idx[start] if start < len(idx) else 0) - pad)
    last = idx[max(start, end - 1)] if idx else 0
    b = min(len(original), last + 1 + pad)
    return re.sub(r"\s+", " ", original[a:b]).strip()


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?;])\s+|\n+", text) if s.strip()]


def tokenize(text: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", norm(text)) if len(t) > 1 and t not in STOPWORDS]


def stem(t: str) -> str:
    if len(t) > 6 and t.endswith("ciones"):
        return t[:-2]
    if len(t) > 5 and t.endswith("es"):
        return t[:-2]
    if len(t) > 4 and t.endswith("s"):
        return t[:-1]
    return t


def terms(text: str) -> list[str]:
    return [stem(t) for t in tokenize(text)]
