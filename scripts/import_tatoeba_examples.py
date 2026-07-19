#!/usr/bin/env python3
"""Attach one short, proofread Tatoeba example sentence to each word entry."""

import bz2
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path


if len(sys.argv) != 3:
    raise SystemExit(
        "usage: import_tatoeba_examples.py "
        "/path/to/eng_sentences_detailed.tsv[.bz2] "
        "/path/to/eng_sentences_in_lists.tsv[.bz2]"
    )

source = Path(sys.argv[1])
lists_source = Path(sys.argv[2])
dict_dir = Path(__file__).resolve().parents[1] / "public" / "dicts"
dict_paths = sorted(dict_dir.glob("*.json"))

all_words = set()
for path in dict_paths:
    for entry in json.loads(path.read_text(encoding="utf-8")):
        all_words.add(entry["word"].lower())

single_words = {word for word in all_words if re.fullmatch(r"[a-z]+(?:'[a-z]+)?", word)}
multi_words = all_words - single_words
phrases_by_first = defaultdict(set)
for phrase in multi_words:
    first = re.findall(r"[a-z]+(?:'[a-z]+)?", phrase)
    if first:
        phrases_by_first[first[0]].add(phrase)
best = {}


def sentence_score(text: str, word: str) -> tuple[int, int, str]:
    tokens = re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", text)
    score = abs(len(tokens) - 9) * 3
    score += 8 if tokens and tokens[0].lower() == word else 0
    score += 6 * max(0, text.lower().count(word) - 1)
    score += 15 if any(char in text for char in '"“”') else 0
    score += 10 if any(char in text for char in ";:()[]{}") else 0
    score += 12 if re.search(r"\b(?:Tom|Mary|John|Sami|Layla|Trump|Biden|Musk)\b", text) else 0
    score += 8 if re.search(r"\b(?:president|election|war|government|political)\b", text, re.I) else 0
    score += 8 if re.search(r"[A-Za-z]-" + re.escape(word) + r"|" + re.escape(word) + r"-[A-Za-z]", text, re.I) else 0
    internal_caps = sum(1 for token in tokens[1:] if token[:1].isupper() and token != "I")
    score += internal_caps * 5
    return score, len(text), text


approved_ids = set()
lists_opener = bz2.open if lists_source.suffix == ".bz2" else open
with lists_opener(lists_source, "rt", encoding="utf-8", newline="") as handle:
    for row in csv.reader(handle, delimiter="\t"):
        if len(row) >= 2 and row[0] == "907":
            approved_ids.add(int(row[1]))

opener = bz2.open if source.suffix == ".bz2" else open
with opener(source, "rt", encoding="utf-8", newline="") as handle:
    for row in csv.reader(handle, delimiter="\t"):
        if len(row) < 4:
            continue
        sentence_id, language, text, username = row[:4]
        sentence_id = int(sentence_id)
        tokens = re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", text)
        if sentence_id not in approved_ids or language != "eng" or not 5 <= len(tokens) <= 16:
            continue
        if not text[:1].isupper() or text[-1:] not in ".?!":
            continue
        lowered = text.lower()
        lowered_tokens = [token.lower() for token in tokens]
        token_counts = Counter(lowered_tokens)
        present = set(lowered_tokens) & single_words
        for token in set(lowered_tokens):
            for phrase in phrases_by_first.get(token, ()):
                if re.search(r"(?<![a-z])" + re.escape(phrase) + r"(?![a-z])", lowered):
                    present.add(phrase)
        for word in present:
            occurrences = token_counts[word] if word in single_words else len(re.findall(r"(?<![a-z])" + re.escape(word) + r"(?![a-z])", lowered))
            if occurrences != 1:
                continue
            item = (sentence_score(text, word), text, sentence_id, username)
            if word not in best or item[0] < best[word][0]:
                best[word] = item
for path in dict_paths:
    bank = json.loads(path.read_text(encoding="utf-8"))
    matched = 0
    for entry in bank:
        item = best.get(entry["word"].lower())
        if item:
            entry["example"] = item[1]
            entry["exampleSourceId"] = item[2]
            entry["exampleSourceUser"] = item[3]
            matched += 1
        else:
            entry.pop("example", None)
            entry.pop("exampleSourceId", None)
            entry.pop("exampleSourceUser", None)
    path.write_text(json.dumps(bank, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{path.stem}: {matched}/{len(bank)} examples")
