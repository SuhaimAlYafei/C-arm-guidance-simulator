"""Audit the projection-specific reference X-ray library before model training.

Why this exists:
- one image per class is enough for deterministic lookup,
- but it is not enough for a credible learned classifier/verifier,
- augmentation does not create independent patient/anatomy examples.

Run from repository root:
    py evaluation/reference_xray_audit.py
"""
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REFERENCE_DIR = ROOT / "python" / "bridge" / "reference_xrays"
OUT = ROOT / "results" / "reference_xray_audit.json"

VIEW_SUFFIXES = ("_ap", "_pa", "_lateral", "_oblique", "_axillary")


def parse_label(stem: str) -> tuple[str, str]:
    for suffix in VIEW_SUFFIXES:
        if stem.endswith(suffix):
            return stem[: -len(suffix)], suffix[1:]
    return stem, "unknown"


def main() -> None:
    files = sorted(
        p for p in REFERENCE_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
    )

    class_counts = Counter()
    anatomy_counts = Counter()
    view_counts = Counter()
    entries = []

    for path in files:
        anatomy, view = parse_label(path.stem.lower())
        label = f"{anatomy}:{view}"
        class_counts[label] += 1
        anatomy_counts[anatomy] += 1
        view_counts[view] += 1
        entries.append({
            "file": path.name,
            "anatomy": anatomy,
            "view": view,
            "class": label,
            "bytes": path.stat().st_size,
        })

    singleton_classes = sorted(k for k, v in class_counts.items() if v == 1)
    low_sample_classes = sorted(k for k, v in class_counts.items() if v < 5)

    # Conservative research thresholds. These are not universal ML rules, but
    # they stop us from reporting a memorization-heavy model as meaningful.
    recommended_min_independent_images_per_class = 20
    preferred_independent_images_per_class = 50

    report = {
        "reference_directory": str(REFERENCE_DIR),
        "total_images": len(files),
        "num_classes": len(class_counts),
        "class_counts": dict(sorted(class_counts.items())),
        "anatomy_counts": dict(sorted(anatomy_counts.items())),
        "view_counts": dict(sorted(view_counts.items())),
        "singleton_classes": singleton_classes,
        "low_sample_classes_lt5": low_sample_classes,
        "recommended_min_independent_images_per_class": recommended_min_independent_images_per_class,
        "preferred_independent_images_per_class": preferred_independent_images_per_class,
        "training_readiness": (
            "not_ready_for_credible_multiclass_training"
            if singleton_classes or low_sample_classes
            else "minimum_sample_count_met"
        ),
        "reason": (
            "Reference images are suitable for deterministic lookup, but classes with only one or a few independent images would make a learned classifier prone to memorization and data leakage. Augmented copies must remain in the same train/validation split as their source image and do not count as independent samples."
        ),
        "entries": entries,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(json.dumps({k: v for k, v in report.items() if k != "entries"}, indent=2))
    print(f"\nWrote {OUT}")


if __name__ == "__main__":
    main()
