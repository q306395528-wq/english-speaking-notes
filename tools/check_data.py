#!/usr/bin/env python3
"""Validate the daily lesson JSON files before publishing."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
REQUIRED = {"id", "category", "english", "chinese"}


def fail(message: str) -> None:
    print(f"ERROR: {message}")
    raise SystemExit(1)


def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"Missing file: {path.relative_to(ROOT)}")
    except json.JSONDecodeError as exc:
        fail(f"Invalid JSON in {path.relative_to(ROOT)}: {exc}")


def main() -> int:
    catalog_path = DATA / "index.json"
    catalog = load_json(catalog_path)
    days = catalog.get("days")
    if not isinstance(days, list):
        fail("data/index.json must contain a days array")

    seen_ids: set[str] = set()
    seen_dates: set[str] = set()
    lesson_count = 0

    for entry in days:
        if not isinstance(entry, dict):
            fail("Every catalog entry must be an object")
        date = entry.get("date")
        filename = entry.get("file")
        if not date or not filename:
            fail("Every catalog entry needs date and file")
        if date in seen_dates:
            fail(f"Duplicate date in catalog: {date}")
        seen_dates.add(date)

        payload = load_json(DATA / filename)
        if payload.get("date") != date:
            fail(f"Date mismatch: catalog says {date}, {filename} says {payload.get('date')}")
        lessons = payload.get("lessons")
        if not isinstance(lessons, list):
            fail(f"{filename} must contain a lessons array")

        for index, lesson in enumerate(lessons, start=1):
            if not isinstance(lesson, dict):
                fail(f"{filename} lesson #{index} must be an object")
            missing = REQUIRED - lesson.keys()
            if missing:
                fail(f"{filename} lesson #{index} missing fields: {', '.join(sorted(missing))}")
            lesson_id = lesson["id"]
            if lesson_id in seen_ids:
                fail(f"Duplicate lesson id: {lesson_id}")
            seen_ids.add(lesson_id)
            if not isinstance(lesson.get("tags", []), list):
                fail(f"{lesson_id}: tags must be an array")
            lesson_count += 1

    print(f"OK: {len(days)} day file(s), {lesson_count} lesson(s), all IDs unique.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
