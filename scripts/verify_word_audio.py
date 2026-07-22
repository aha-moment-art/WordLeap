#!/usr/bin/env python3
"""Verify WordLeap's generated pronunciation set against the live dictionaries."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DICTS_DIR = ROOT / "public" / "dicts"
AUDIO_DIR = ROOT / "public" / "audio" / "words"
MANIFEST_PATH = ROOT / "public" / "audio" / "manifest.json"


def is_mp3(path: Path) -> bool:
    if not path.is_file() or path.stat().st_size < 500:
        return False
    head = path.read_bytes()[:3]
    return head == b"ID3" or head[:2] in {b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"}


def main() -> int:
    words: dict[str, str] = {}
    for path in sorted(DICTS_DIR.glob("*.json")):
        for entry in json.loads(path.read_text()):
            word = str(entry["word"]).strip()
            words.setdefault(word.casefold(), word)
    expected = set(words.values())
    actual = {path.stem for path in AUDIO_DIR.glob("*.mp3")}
    missing = sorted(expected - actual, key=str.casefold)
    extra = sorted(actual - expected, key=str.casefold)
    invalid = sorted((word for word in expected & actual if not is_mp3(AUDIO_DIR / f"{word}.mp3")), key=str.casefold)

    manifest = json.loads(MANIFEST_PATH.read_text()) if MANIFEST_PATH.exists() else {}
    manifest_words = {entry["word"] for entry in manifest.get("entries", [])}
    manifest_missing = sorted(expected - manifest_words, key=str.casefold)
    manifest_extra = sorted(manifest_words - expected, key=str.casefold)

    sample = sorted(expected, key=str.casefold)[:: max(1, len(expected) // 100)][:100]
    decode_failures = []
    for word in sample:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(AUDIO_DIR / f"{word}.mp3"),
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode or not result.stdout.strip():
            decode_failures.append(word)

    summary = {
        "expected": len(expected),
        "actual": len(actual),
        "missing": len(missing),
        "extra": len(extra),
        "invalid": len(invalid),
        "manifestGenerated": manifest.get("generated"),
        "manifestMissing": len(manifest_missing),
        "manifestExtra": len(manifest_extra),
        "ffprobeSample": len(sample),
        "ffprobeFailures": len(decode_failures),
        "totalBytes": sum((AUDIO_DIR / f"{word}.mp3").stat().st_size for word in expected & actual),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if missing:
        print("missing examples:", missing[:20])
    if extra:
        print("extra examples:", extra[:20])
    if invalid:
        print("invalid examples:", invalid[:20])
    if decode_failures:
        print("ffprobe failures:", decode_failures[:20])
    return int(any((missing, extra, invalid, manifest_missing, manifest_extra, decode_failures)))


if __name__ == "__main__":
    raise SystemExit(main())
