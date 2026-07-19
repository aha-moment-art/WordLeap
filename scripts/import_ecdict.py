#!/usr/bin/env python3
import csv, json, re, sys
from pathlib import Path

if len(sys.argv) not in (2, 3):
    raise SystemExit("usage: import_ecdict.py /path/to/ecdict.csv [/path/to/qwerty-pte-jsons]")

source = Path(sys.argv[1])
target = Path(__file__).resolve().parents[1] / "public" / "dicts"
target.mkdir(parents=True, exist_ok=True)
groups = {"cet4": {}, "cet6": {}, "ielts": {}, "toefl": {}}
derived = {"TEM-4": {}, "TEM-8": {}}

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
        if tags & {"cet6","ielts","ky"}: derived["TEM-4"][word]=dict(entry)
        if tags & {"toefl","gre"}: derived["TEM-8"][word]=dict(entry)

names={"cet4":"CET-4","cet6":"CET-6","ielts":"IELTS","toefl":"TOEFL"}
for tag, entries in groups.items():
    ordered=sorted(entries.values(), key=lambda item:(item["rank"],item["word"]))
    for item in ordered: item.pop("rank",None)
    path=target/f"{names[tag]}.json"
    path.write_text(json.dumps(ordered,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    print(f"{names[tag]}: {len(ordered)} -> {path}")

for name, entries in derived.items():
    ordered=sorted(entries.values(), key=lambda item:(item["rank"],item["word"]))
    if name=="TEM-4": ordered=ordered[:6000]
    for item in ordered: item.pop("rank",None)
    path=target/f"{name}.json"
    path.write_text(json.dumps(ordered,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    print(f"{name}: {len(ordered)} -> {path}")

if len(sys.argv)==3:
    pte={}
    for filename in ("PTE_junior.json","PTE_senior.json"):
        with (Path(sys.argv[2])/filename).open(encoding="utf-8") as handle:
            for row in json.load(handle):
                word=(row.get("name") or "").strip().lower()
                trans=row.get("trans") or []
                if not word or not trans: continue
                gloss=re.sub(r"^(?:n|v|vt|vi|a|adj|ad|adv|prep|conj|pron|num|art)\.\s*", "", trans[0], flags=re.I).strip()
                pte[word]={"word":word,"phonetic":f"/{(row.get('ukphone') or row.get('usphone') or '').strip('/')}/" if row.get("ukphone") or row.get("usphone") else "","meaning":gloss,"pos":""}
    ordered=sorted(pte.values(),key=lambda item:item["word"])
    path=target/"PTE.json"
    path.write_text(json.dumps(ordered,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    print(f"PTE: {len(ordered)} -> {path}")
