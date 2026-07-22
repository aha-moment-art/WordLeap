#!/usr/bin/env python3
"""Generate resumable ElevenLabs audio for WordLeap example sentences."""

from __future__ import annotations

import argparse
import concurrent.futures
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
CUSTOM_EXAMPLES_PATH = DICTS_DIR / "custom-examples.json"
AUDIO_DIR = ROOT / "public" / "audio" / "sentences"
VOICE_ID = "Xb7hH8MSUJpSbSDYk0k2"
MODEL_ID = "eleven_flash_v2_5"
OUTPUT_FORMAT = "mp3_22050_32"
API_URL = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}?output_format={OUTPUT_FORMAT}"


class InvalidAudioResponse(RuntimeError):
    """A paid API response was received but did not contain a usable MP3."""


def load_sentences() -> list[tuple[str, str]]:
    sentences: dict[str, str] = {}
    for path in sorted(DICTS_DIR.glob("*.json")):
        if path == CUSTOM_EXAMPLES_PATH:
            continue
        for entry in json.loads(path.read_text()):
            source_id = entry.get("exampleSourceId")
            example = str(entry.get("example") or "").strip()
            if source_id and example:
                audio_id = str(int(source_id))
                previous = sentences.setdefault(audio_id, example)
                if previous != example:
                    raise ValueError(f"Conflicting text for sentence {source_id}")
    if CUSTOM_EXAMPLES_PATH.exists():
        for entry in json.loads(CUSTOM_EXAMPLES_PATH.read_text()):
            audio_id = str(entry["audioId"]).strip()
            example = str(entry["example"]).strip()
            if not audio_id or "/" in audio_id or "\x00" in audio_id:
                raise ValueError(f"Unsafe custom audio ID: {audio_id!r}")
            previous = sentences.setdefault(audio_id, example)
            if previous != example:
                raise ValueError(f"Conflicting text for sentence {audio_id}")
    return sorted(sentences.items())


def is_valid_mp3(path: Path) -> bool:
    if not path.is_file() or path.stat().st_size < 500:
        return False
    head = path.read_bytes()[:3]
    return head == b"ID3" or head[:2] in {b"\xff\xfb", b"\xff\xf3", b"\xff\xf2", b"\xff\xe3", b"\xff\xe2"}


def generate_one(item: tuple[str, str], api_key: str, retries: int, stop: threading.Event) -> tuple[str, str]:
    source_id, sentence = item
    destination = AUDIO_DIR / f"{source_id}.mp3"
    if is_valid_mp3(destination):
        return source_id, "skipped"
    payload = json.dumps({
        "text": sentence,
        "model_id": MODEL_ID,
        "language_code": "en",
        "voice_settings": {
            "stability": 0.75,
            "similarity_boost": 0.75,
            "style": 0,
            "use_speaker_boost": True,
            "speed": 0.9,
        },
    }).encode()
    for attempt in range(retries + 1):
        if stop.is_set():
            return source_id, "stopped"
        request = urllib.request.Request(API_URL, data=payload, headers={"xi-api-key": api_key, "Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                audio = response.read()
            temp = destination.with_suffix(".mp3.part")
            temp.write_bytes(audio)
            if not is_valid_mp3(temp):
                temp.unlink(missing_ok=True)
                raise InvalidAudioResponse("invalid MP3 response")
            temp.replace(destination)
            return source_id, "generated"
        except InvalidAudioResponse as error:
            return source_id, f"error: {error}"
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", "replace")[:500]
            if error.code in {401, 402, 403} or "insufficient" in body.lower():
                stop.set()
                return source_id, f"fatal HTTP {error.code}"
            if error.code not in {408, 409, 429, 500, 502, 503, 504} or attempt >= retries:
                return source_id, f"HTTP {error.code}"
        except OSError as error:
            if attempt >= retries:
                return source_id, f"error: {error}"
        time.sleep(min(32, 2**attempt) + random.random())
    return source_id, "failed"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--retries", type=int, default=6)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--source-id", type=int, action="append")
    parser.add_argument("--audio-id", action="append")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    sentences = load_sentences()
    if args.source_id or args.audio_id:
        requested = {str(source_id) for source_id in (args.source_id or [])} | set(args.audio_id or [])
        sentences = [item for item in sentences if item[0] in requested]
        missing = requested - {item[0] for item in sentences}
        if missing:
            raise SystemExit(f"Unknown source IDs: {sorted(missing)}")
    pending = [item for item in sentences if not is_valid_mp3(AUDIO_DIR / f"{item[0]}.mp3")]
    if args.limit is not None:
        pending = pending[:args.limit]
    characters = sum(len(sentence) for _, sentence in pending)
    print(f"selected={len(sentences)} pending={len(pending)} characters={characters}", flush=True)
    if args.dry_run or not pending:
        return 0
    api_key = os.environ.get("ELEVENLABS_API_KEY", "")
    if not api_key:
        raise SystemExit("ELEVENLABS_API_KEY is not set")
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    stop = threading.Event()
    generated = skipped = failed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = [executor.submit(generate_one, item, api_key, args.retries, stop) for item in pending]
        for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
            source_id, status = future.result()
            if status == "generated": generated += 1
            elif status == "skipped": skipped += 1
            else:
                failed += 1
                print(f"FAILED source_id={source_id} status={status}", flush=True)
            if index % 100 == 0 or index == len(futures):
                print(f"progress={index}/{len(futures)} generated={generated} skipped={skipped} failed={failed}", flush=True)
    print(f"complete generated={generated} skipped={skipped} failed={failed} stopped={stop.is_set()}", flush=True)
    return int(failed or stop.is_set())


if __name__ == "__main__":
    raise SystemExit(main())
