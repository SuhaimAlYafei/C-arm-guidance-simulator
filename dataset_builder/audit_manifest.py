"""Audit a radiograph manifest before any model training.

This script deliberately performs no downloading and accepts no dataset terms.
It checks provenance, duplicate hashes, split leakage, label coverage and basic
training readiness.
"""
from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path

REQUIRED = {
    "image_id", "relative_path", "source_name", "source_record_id",
    "source_url", "license_or_access_terms", "patient_id", "study_id",
    "anatomy", "projection", "laterality", "label_verified", "sha256",
    "split", "notes",
}
VALID_SPLITS = {"train", "val", "test"}
UNKNOWN = {"", "unknown", "na", "n/a", "none"}


def norm(value: str) -> str:
    return (value or "").strip().lower()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("manifest", type=Path)
    p.add_argument("--min-anatomy", type=int, default=20)
    p.add_argument("--min-projection", type=int, default=20)
    args = p.parse_args()

    with args.manifest.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fields = set(reader.fieldnames or [])
        missing_columns = sorted(REQUIRED - fields)
        if missing_columns:
            raise SystemExit(f"Missing required columns: {missing_columns}")
        rows = list(reader)

    anatomy = Counter()
    projection = Counter()
    splits = Counter()
    sources = Counter()
    missing_provenance = []
    invalid_splits = []
    unverified = []

    hashes = defaultdict(list)
    patients = defaultdict(set)
    studies = defaultdict(set)

    for i, row in enumerate(rows, start=2):
        split = norm(row["split"])
        a = norm(row["anatomy"])
        proj = norm(row["projection"])
        patient = norm(row["patient_id"])
        study = norm(row["study_id"])
        digest = norm(row["sha256"])

        splits[split] += 1
        sources[row["source_name"].strip() or "<missing>"] += 1
        if a not in UNKNOWN:
            anatomy[a] += 1
        if proj not in UNKNOWN:
            projection[proj] += 1
        if split not in VALID_SPLITS:
            invalid_splits.append(i)
        if norm(row["label_verified"]) not in {"true", "1", "yes"}:
            unverified.append(i)
        if not row["source_name"].strip() or not row["license_or_access_terms"].strip() or not row["source_url"].strip():
            missing_provenance.append(i)
        if digest:
            hashes[digest].append((i, split))
        if patient not in UNKNOWN:
            patients[patient].add(split)
        if study not in UNKNOWN:
            studies[study].add(split)

    duplicate_hashes = {
        h: entries for h, entries in hashes.items() if len(entries) > 1
    }
    cross_split_hashes = {
        h: entries for h, entries in duplicate_hashes.items()
        if len({split for _, split in entries}) > 1
    }
    patient_leakage = {k: sorted(v) for k, v in patients.items() if len(v) > 1}
    study_leakage = {k: sorted(v) for k, v in studies.items() if len(v) > 1}

    low_anatomy = {k: v for k, v in anatomy.items() if v < args.min_anatomy}
    low_projection = {k: v for k, v in projection.items() if v < args.min_projection}

    blockers = []
    if not rows:
        blockers.append("manifest_empty")
    if invalid_splits:
        blockers.append("invalid_or_missing_split")
    if missing_provenance:
        blockers.append("missing_provenance")
    if cross_split_hashes:
        blockers.append("duplicate_image_crosses_splits")
    if patient_leakage:
        blockers.append("patient_leakage")
    if study_leakage:
        blockers.append("study_leakage")
    if low_anatomy:
        blockers.append("low_sample_anatomy_classes")

    report = {
        "images": len(rows),
        "sources": dict(sources),
        "splits": dict(splits),
        "anatomy_counts": dict(sorted(anatomy.items())),
        "projection_counts_verified_or_supplied": dict(sorted(projection.items())),
        "unverified_label_rows": unverified[:100],
        "missing_provenance_rows": missing_provenance[:100],
        "duplicate_hash_count": len(duplicate_hashes),
        "cross_split_duplicate_hash_count": len(cross_split_hashes),
        "patient_leakage_count": len(patient_leakage),
        "study_leakage_count": len(study_leakage),
        "low_sample_anatomy": low_anatomy,
        "low_sample_projection": low_projection,
        "training_blockers": blockers,
        "anatomy_training_ready": not blockers,
        "projection_note": "Projection readiness must be judged only from independently sourced images with trustworthy projection metadata; unknown projection labels are intentionally allowed for anatomy-only training.",
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
