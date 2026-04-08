#!/usr/bin/env python3
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKIP = {
    "node_modules",
    "dist",
    ".git",
    ".terraform",
}
ALLOWLIST = {
    "relay-requirements.md",
    "scripts/audit-relay-migration.py",
}
PATTERNS = [
    re.compile(r"anthropic", re.IGNORECASE),
    re.compile(r"claude\.ai", re.IGNORECASE),
    re.compile(r"\bClaude\b"),
    re.compile(r"\bCCR\b"),
]


def should_skip(path: pathlib.Path) -> bool:
    return any(part in SKIP for part in path.parts)


def main() -> int:
    failures: list[str] = []
    for path in ROOT.rglob("*"):
      if path.is_dir() or should_skip(path):
        continue
      if str(path.relative_to(ROOT)) in ALLOWLIST:
        continue
      try:
        text = path.read_text(encoding="utf-8")
      except Exception:
        continue
      for pattern in PATTERNS:
        if pattern.search(text):
          failures.append(str(path.relative_to(ROOT)))
          break
    if failures:
      print("Forbidden branding/runtime references found:")
      for failure in sorted(failures):
        print(f" - {failure}")
      return 1
    print("relay migration audit passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
