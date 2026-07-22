#!/usr/bin/env python3
"""Fill only missing WordLeap examples from a full Tatoeba English export."""

from __future__ import annotations

import argparse
import bz2
import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DICTS_DIR = ROOT / "public" / "dicts"
TOKEN_RE = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")


def score_sentence(text: str, word: str) -> tuple[int, int, str]:
    tokens = TOKEN_RE.findall(text)
    score = abs(len(tokens) - 9) * 3
    score += 15 if any(char in text for char in '"“”') else 0
    score += 10 if any(char in text for char in ";:()[]{}") else 0
    score += 12 if re.search(r"\b(?:Tom|Mary|John|Sami|Layla|Trump|Biden|Musk)\b", text) else 0
    score += 8 if re.search(r"\b(?:president|election|war|government|political)\b", text, re.I) else 0
    score += 8 if tokens and tokens[0].lower() == word else 0
    internal_caps = sum(1 for token in tokens[1:] if token[:1].isupper() and token != "I")
    score += internal_caps * 5
    return score, len(text), text


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="eng_sentences_detailed.tsv or .bz2")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    dict_paths = sorted(path for path in DICTS_DIR.glob("*.json") if path.name != "custom-examples.json")
    banks = {path: json.loads(path.read_text()) for path in dict_paths}
    missing_words = {str(entry["word"]).strip().lower() for bank in banks.values() for entry in bank if not entry.get("example")}
    single_words = {word for word in missing_words if re.fullmatch(r"[a-z]+(?:'[a-z]+)?", word)}
    phrases_by_first: dict[str, set[str]] = defaultdict(set)
    for phrase in missing_words - single_words:
        first = TOKEN_RE.findall(phrase)
        if first:
            phrases_by_first[first[0]].add(phrase)
    best: dict[str, tuple[tuple[int, int, str], str, int, str]] = {}
    opener = bz2.open if args.source.suffix == ".bz2" else open
    with opener(args.source, "rt", encoding="utf-8", newline="") as handle:
        for row in csv.reader(handle, delimiter="\t"):
            if len(row) < 4 or row[1] != "eng":
                continue
            sentence_id, _, text, username = row[:4]
            tokens = TOKEN_RE.findall(text)
            if not username or not 5 <= len(tokens) <= 16 or not text[:1].isupper() or text[-1:] not in ".?!":
                continue
            lowered = text.lower()
            lowered_tokens = [token.lower() for token in tokens]
            counts = Counter(lowered_tokens)
            present = set(lowered_tokens) & single_words
            for token in set(lowered_tokens):
                for phrase in phrases_by_first.get(token, ()):
                    if re.search(r"(?<![a-z])" + re.escape(phrase) + r"(?![a-z])", lowered):
                        present.add(phrase)
            for word in present:
                occurrences = counts[word] if word in single_words else len(re.findall(r"(?<![a-z])" + re.escape(word) + r"(?![a-z])", lowered))
                if occurrences != 1:
                    continue
                item = (score_sentence(text, word), text, int(sentence_id), username)
                if word not in best or item[0] < best[word][0]:
                    best[word] = item
    filled_rows = 0
    filled_words: set[str] = set()
    for path, bank in banks.items():
        changed = False
        for entry in bank:
            if entry.get("example"):
                continue
            word = str(entry["word"]).strip().lower()
            item = best.get(word)
            if not item:
                continue
            _, text, sentence_id, username = item
            entry["example"] = text
            entry["exampleSourceId"] = sentence_id
            entry["exampleSourceUser"] = username
            filled_rows += 1
            filled_words.add(word)
            changed = True
        if changed and not args.dry_run:
            path.write_text(json.dumps(bank, ensure_ascii=False, separators=(",", ":")))
    print(json.dumps({"missingWords": len(missing_words), "matchedWords": len(filled_words), "filledRows": filled_rows, "remainingWords": len(missing_words - filled_words)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
