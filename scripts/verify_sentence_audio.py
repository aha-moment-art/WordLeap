#!/usr/bin/env python3
"""Verify WordLeap example-sentence audio against the live dictionaries."""

from __future__ import annotations

import concurrent.futures
import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DICTS_DIR = ROOT / "public" / "dicts"
AUDIO_DIR = ROOT / "public" / "audio" / "sentences"


def is_mp3(path: Path) -> bool:
    if not path.is_file() or path.stat().st_size < 500:
        return False
    head = path.read_bytes()[:3]
    return head == b"ID3" or head[:2] in {b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"}


def decodes(source_id: int) -> bool:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(AUDIO_DIR / f"{source_id}.mp3")],
        capture_output=True,
        text=True,
    )
    return result.returncode == 0 and bool(result.stdout.strip())


def main() -> int:
    expected: dict[int, str] = {}
    for path in sorted(DICTS_DIR.glob("*.json")):
        for entry in json.loads(path.read_text()):
            source_id = entry.get("exampleSourceId")
            example = str(entry.get("example") or "").strip()
            if source_id and example:
                numeric_id = int(source_id)
                previous = expected.setdefault(numeric_id, example)
                if previous != example:
                    raise ValueError(f"Conflicting text for sentence {numeric_id}")
    actual = {int(path.stem) for path in AUDIO_DIR.glob("*.mp3") if path.stem.isdigit()}
    missing = sorted(set(expected) - actual)
    extra = sorted(actual - set(expected))
    invalid = sorted(source_id for source_id in set(expected) & actual if not is_mp3(AUDIO_DIR / f"{source_id}.mp3"))
    valid = sorted((set(expected) & actual) - set(invalid))
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as executor:
        decode_failures = [source_id for source_id, okay in zip(valid, executor.map(decodes, valid)) if not okay]
    summary = {
        "expected": len(expected),
        "actual": len(actual),
        "missing": len(missing),
        "extra": len(extra),
        "invalid": len(invalid),
        "decoded": len(valid),
        "decodeFailures": len(decode_failures),
        "totalBytes": sum((AUDIO_DIR / f"{source_id}.mp3").stat().st_size for source_id in set(expected) & actual),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if missing: print("missing examples:", missing[:20])
    if extra: print("extra examples:", extra[:20])
    if invalid: print("invalid examples:", invalid[:20])
    if decode_failures: print("decode failures:", decode_failures[:20])
    return int(any((missing, extra, invalid, decode_failures)))


if __name__ == "__main__":
    raise SystemExit(main())
