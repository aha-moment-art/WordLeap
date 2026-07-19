#!/usr/bin/env python3
import csv, json, re, sys
from pathlib import Path

if len(sys.argv) != 2:
    raise SystemExit("usage: import_ecdict.py /path/to/ecdict.csv")

source = Path(sys.argv[1])
target = Path(__file__).resolve().parents[1] / "public" / "dicts"
target.mkdir(parents=True, exist_ok=True)
groups = {"cet4": {}, "cet6": {}, "ielts": {}, "toefl": {}}

def rank(row):
    values=[]
    for key in ("frq", "bnc"):
        try:
            value=int(row.get(key) or 0)
            if value>0: values.append(value)
        except ValueError: pass
    return min(values) if values else 9999999

def meaning(text):
    lines=(text or "").splitlines()
    if not lines: return ""
    first=lines[0]
    first=re.sub(r"\[[^\]]+\]\s*", "", first)
    first=re.sub(r"^(?:n|v|vt|vi|a|adj|ad|adv|prep|conj|pron|num|art)\.\s*", "", first, flags=re.I)
    return first.strip(" ,;；，")[:120]

with source.open(encoding="utf-8", newline="") as handle:
    for row in csv.DictReader(handle):
        word=(row.get("word") or "").strip().lower()
        gloss=meaning(row.get("translation") or "")
        if not gloss or not re.fullmatch(r"[a-z][a-z' -]{0,48}", word): continue
        entry={"word":word,"phonetic":f"/{(row.get('phonetic') or '').strip('/')}/" if row.get("phonetic") else "","meaning":gloss,"pos":row.get("pos") or "","rank":rank(row)}
        tags=set((row.get("tag") or "").split())
        for tag in groups:
            if tag in tags and (word not in groups[tag] or entry["rank"]<groups[tag][word]["rank"]): groups[tag][word]=dict(entry)

names={"cet4":"CET-4","cet6":"CET-6","ielts":"IELTS","toefl":"TOEFL"}
for tag, entries in groups.items():
    ordered=sorted(entries.values(), key=lambda item:(item["rank"],item["word"]))
    for item in ordered: item.pop("rank",None)
    path=target/f"{names[tag]}.json"
    path.write_text(json.dumps(ordered,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    print(f"{names[tag]}: {len(ordered)} -> {path}")
