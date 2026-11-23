#!/usr/bin/env python3
"""Measure documentation coverage for exported TypeScript and JavaScript symbols."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOTS = (
    ROOT / "backend" / "src",
    ROOT / "frontend" / "src",
    ROOT / "indexer" / "src",
)
DECLARATION = re.compile(
    r"^\s*export\s+(?:default\s+)?"
    r"(?:declare\s+)?(?:abstract\s+)?"
    r"(?:async\s+)?(?:class|interface|type|enum|function)\b"
)
CONST_EXPORT = re.compile(
    r"^\s*export\s+(?:const|let|var)\s+[A-Za-z_$][\w$]*"
)


def is_documented(lines: list[str], index: int) -> bool:
    index -= 1
    while index >= 0 and not lines[index].strip():
        index -= 1
    if index < 0:
        return False

    line = lines[index].strip()
    if line.startswith("/**"):
        return True
    if line.startswith("*") or line.startswith("*/"):
        return any(
            candidate.strip().startswith("/**")
            for candidate in lines[max(0, index - 20):index + 1]
        )
    return False


def has_source_comment(lines: list[str], index: int) -> bool:
    block = []
    previous = index - 1
    while previous >= 0 and not lines[previous].strip():
        previous -= 1
    if previous < 0:
        return False
    if lines[previous].strip() != "*/":
        return False
    block_start = previous
    while block_start >= 0:
        if "/**" in lines[block_start]:
            return True
        if "/*" in lines[block_start]:
            return False
        block_start -= 1
    return False


def is_test_file(path: Path) -> bool:
    parts = set(path.parts)
    name = path.name
    return (
        "__tests__" in parts
        or "test" in parts
        or "tests" in parts
        or ".test." in name
        or ".spec." in name
    )


def find_coverage() -> tuple[int, int, list[dict[str, object]]]:
    total = 0
    documented = 0
    missing: list[dict[str, object]] = []

    for source_root in SOURCE_ROOTS:
        if not source_root.exists():
            continue
        for path in sorted(source_root.rglob("*")):
            if path.suffix not in (".ts", ".tsx", ".js", ".jsx"):
                continue
            if is_test_file(path):
                continue

            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
            for index, line in enumerate(lines):
                if not (DECLARATION.match(line) or CONST_EXPORT.match(line)):
                    continue
                total += 1
                documented_now = is_documented(lines, index) or has_source_comment(lines, index)
                if documented_now:
                    documented += 1
                else:
                    missing.append({
                        "path": str(path.relative_to(ROOT)),
                        "line": index + 1,
                        "declaration": line.strip(),
                    })

    return documented, total, missing


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--threshold",
        type=float,
        default=25.0,
        help="Minimum documentation coverage percentage (default: 25)",
    )
    parser.add_argument("--json", action="store_true", help="Emit JSON output")
    parser.add_argument(
        "--max-missing",
        type=int,
        default=20,
        help="Maximum missing declarations shown in text output (default: 20)",
    )
    args = parser.parse_args()

    if not 0 <= args.threshold <= 100:
        parser.error("--threshold must be between 0 and 100")

    documented, total, missing = find_coverage()
    coverage = 100.0 if total == 0 else documented * 100.0 / total
    result = {
        "documented": documented,
        "total": total,
        "coverage": round(coverage, 2),
        "threshold": args.threshold,
        "missing": missing,
    }

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(
            f"TypeScript/JavaScript documentation coverage: "
            f"{documented}/{total} ({coverage:.2f}%)"
        )
        if missing:
            print("Missing TSDoc/JSDoc:")
            for item in missing[:max(0, args.max_missing)]:
                print(
                    f"  {item['path']}:{item['line']}: {item['declaration']}"
                )
            remaining = len(missing) - min(len(missing), max(0, args.max_missing))
            if remaining:
                print(f"  ... and {remaining} more")

    if coverage + 1e-9 < args.threshold:
        if not args.json:
            print(
                f"ERROR: coverage is below required threshold "
                f"of {args.threshold:.2f}%."
            )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
