#!/usr/bin/env python3
"""Generate resumable British-English MP3 pronunciation files for WordLeap."""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import random
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DICTS_DIR = ROOT / "public" / "dicts"
AUDIO_DIR = ROOT / "public" / "audio" / "words"
MANIFEST_PATH = ROOT / "public" / "audio" / "manifest.json"
VOICE_ID = "Xb7hH8MSUJpSbSDYk0k2"
MODEL_ID = "eleven_flash_v2_5"
OUTPUT_FORMAT = "mp3_22050_32"
API_URL = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}?output_format={OUTPUT_FORMAT}"


def load_words() -> list[str]:
    words: dict[str, str] = {}
    for path in sorted(DICTS_DIR.glob("*.json")):
        for entry in json.loads(path.read_text()):
            word = str(entry["word"]).strip()
            words.setdefault(word.casefold(), word)
    result = sorted(words.values(), key=str.casefold)
    invalid = [word for word in result if "/" in word or "\x00" in word]
    if invalid:
        raise ValueError(f"Unsafe audio filenames: {invalid[:10]}")
    return result


def is_valid_mp3(path: Path) -> bool:
    if not path.is_file() or path.stat().st_size < 500:
        return False
    head = path.read_bytes()[:3]
    return head == b"ID3" or head[:2] in {b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"}


def generate_one(word: str, api_key: str, retries: int, stop: threading.Event) -> tuple[str, str, int]:
    destination = AUDIO_DIR / f"{word}.mp3"
    if is_valid_mp3(destination):
        return word, "skipped", destination.stat().st_size

    payload = json.dumps(
        {
            "text": word,
            "model_id": MODEL_ID,
            "language_code": "en",
            "voice_settings": {
                "stability": 0.75,
                "similarity_boost": 0.75,
                "style": 0,
                "use_speaker_boost": True,
                "speed": 0.9,
            },
        }
    ).encode()

    for attempt in range(retries + 1):
        if stop.is_set():
            return word, "stopped", 0
        request = urllib.request.Request(
            API_URL,
            data=payload,
            headers={"xi-api-key": api_key, "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                audio = response.read()
            temp = destination.with_suffix(".mp3.part")
            temp.write_bytes(audio)
            if not is_valid_mp3(temp):
                temp.unlink(missing_ok=True)
                raise RuntimeError("invalid MP3 response")
            temp.replace(destination)
            return word, "generated", len(audio)
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", "replace")[:1000]
            fatal = error.code in {401, 402, 403} or "insufficient" in body.lower()
            if fatal:
                stop.set()
                return word, f"fatal HTTP {error.code}: {body}", 0
            if error.code not in {408, 409, 429, 500, 502, 503, 504} or attempt >= retries:
                return word, f"HTTP {error.code}: {body}", 0
        except (OSError, RuntimeError) as error:
            if attempt >= retries:
                return word, f"error: {error}", 0
        time.sleep(min(32, 2**attempt) + random.random())
    return word, "failed", 0


def write_manifest(words: list[str]) -> None:
    entries = []
    for word in words:
        path = AUDIO_DIR / f"{word}.mp3"
        if not is_valid_mp3(path):
            continue
        data = path.read_bytes()
        entries.append(
            {
                "word": word,
                "file": f"words/{word}.mp3",
                "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
            }
        )
    manifest = {
        "schemaVersion": 1,
        "voiceId": VOICE_ID,
        "voiceName": "Alice",
        "accent": "British English",
        "modelId": MODEL_ID,
        "outputFormat": OUTPUT_FORMAT,
        "expected": len(words),
        "generated": len(entries),
        "entries": entries,
    }
    temp = MANIFEST_PATH.with_suffix(".json.part")
    temp.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")))
    temp.replace(MANIFEST_PATH)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--retries", type=int, default=6)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()

    api_key = os.environ.get("ELEVENLABS_API_KEY", "")
    if not api_key:
        raise SystemExit("ELEVENLABS_API_KEY is not set")
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    words = load_words()
    existing = sum(is_valid_mp3(AUDIO_DIR / f"{word}.mp3") for word in words)
    pending = [word for word in words if not is_valid_mp3(AUDIO_DIR / f"{word}.mp3")]
    if args.limit is not None:
        pending = pending[: args.limit]
    print(f"expected={len(words)} existing={existing} pending={len(pending)}", flush=True)

    stop = threading.Event()
    generated = skipped = failed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = [executor.submit(generate_one, word, api_key, args.retries, stop) for word in pending]
        for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
            word, status, size = future.result()
            if status == "generated":
                generated += 1
            elif status == "skipped":
                skipped += 1
            else:
                failed += 1
                print(f"FAILED word={word!r} status={status}", flush=True)
            if index % 100 == 0 or index == len(futures):
                print(
                    f"progress={index}/{len(futures)} generated={generated} skipped={skipped} failed={failed}",
                    flush=True,
                )

    write_manifest(words)
    print(f"complete generated={generated} skipped={skipped} failed={failed} stopped={stop.is_set()}", flush=True)
    return 1 if failed or stop.is_set() else 0


if __name__ == "__main__":
    raise SystemExit(main())
