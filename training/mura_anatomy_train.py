"""Train a 7-class musculoskeletal anatomy classifier on Stanford MURA.

This script uses Stanford's original train/valid split encoded in the exported
MURA file paths. It is intended for anatomy recognition for the research
simulator, NOT diagnosis and NOT clinical validation.

Example (Windows PowerShell):
    py training/mura_anatomy_train.py `
      --data-root C:/Users/suhai/Downloads/MURA `
      --epochs 8 --batch-size 32

Run a dataset preflight first:
    py training/mura_anatomy_train.py `
      --data-root C:/Users/suhai/Downloads/MURA --check-only
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import random
import time
from collections import Counter
from pathlib import Path
from typing import Any

import torch
import torch.nn as nn
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms

CLASSES = ["ELBOW", "FINGER", "FOREARM", "HAND", "HUMERUS", "SHOULDER", "WRIST"]
CLASS_TO_INDEX = {name: i for i, name in enumerate(CLASSES)}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg"}


def seed_everything(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def parse_mura_path(file_name: str) -> dict[str, str] | None:
    normalized = file_name.replace("\\", "/").strip()
    parts = normalized.split("/")
    if len(parts) < 5 or parts[0] not in {"train", "valid"}:
        return None
    anatomy_token = parts[1]
    if not anatomy_token.startswith("XR_"):
        return None
    anatomy = anatomy_token[3:].upper()
    if anatomy not in CLASS_TO_INDEX:
        return None
    patient = parts[2]
    study = parts[3]
    return {
        "relative_path": normalized,
        "split": parts[0],
        "anatomy": anatomy,
        "patient": patient,
        "study": study,
    }


def load_metadata(csv_path: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if "file_name" not in (reader.fieldnames or []):
            raise ValueError("Metadata CSV must contain a file_name column.")
        for raw in reader:
            parsed = parse_mura_path(raw.get("file_name", ""))
            if parsed is not None:
                parsed["md5_hash"] = raw.get("md5_hash", "")
                rows.append(parsed)
    return rows


def locate_image_root(data_root: Path, rows: list[dict[str, str]]) -> Path:
    candidates = [data_root / "images", data_root]
    probe = rows[0]["relative_path"] if rows else ""
    for base in candidates:
        if probe and (base / Path(probe)).is_file():
            return base

    images_dir = data_root / "images"
    if images_dir.exists():
        for child in images_dir.iterdir():
            if child.is_dir() and probe and (child / Path(probe)).is_file():
                return child

    raise FileNotFoundError(
        "Could not locate MURA images using their original relative paths. "
        "Expected something like <data-root>/images/train/XR_... ."
    )


def dataset_audit(rows: list[dict[str, str]], image_root: Path) -> dict[str, Any]:
    missing: list[str] = []
    counts: dict[str, Counter[str]] = {"train": Counter(), "valid": Counter()}
    patients: dict[str, set[str]] = {"train": set(), "valid": set()}
    studies: dict[str, set[str]] = {"train": set(), "valid": set()}

    for row in rows:
        split = row["split"]
        counts[split][row["anatomy"]] += 1
        patients[split].add(row["patient"])
        studies[split].add(f'{row["patient"]}/{row["study"]}')
        if not (image_root / Path(row["relative_path"])).is_file():
            missing.append(row["relative_path"])

    overlap = patients["train"].intersection(patients["valid"])
    return {
        "image_root": str(image_root),
        "total_image_rows": len(rows),
        "train_images": sum(counts["train"].values()),
        "valid_images": sum(counts["valid"].values()),
        "class_counts": {s: dict(counts[s]) for s in ("train", "valid")},
        "train_patients": len(patients["train"]),
        "valid_patients": len(patients["valid"]),
        "train_studies": len(studies["train"]),
        "valid_studies": len(studies["valid"]),
        "patient_overlap_count": len(overlap),
        "missing_files_count": len(missing),
        "missing_examples": missing[:10],
        "ready": len(missing) == 0 and len(overlap) == 0,
    }


class MuraAnatomyDataset(Dataset):
    def __init__(self, rows: list[dict[str, str]], image_root: Path, transform: Any):
        self.rows = rows
        self.image_root = image_root
        self.transform = transform

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int):
        row = self.rows[index]
        path = self.image_root / Path(row["relative_path"])
        with Image.open(path) as img:
            image = img.convert("RGB")
        image = self.transform(image)
        label = CLASS_TO_INDEX[row["anatomy"]]
        return image, label


def build_transforms(image_size: int):
    train_tf = transforms.Compose([
        transforms.Resize((image_size, image_size)),
        transforms.RandomRotation(degrees=5),
        transforms.RandomAffine(degrees=0, translate=(0.03, 0.03), scale=(0.95, 1.05)),
        transforms.ColorJitter(brightness=0.08, contrast=0.08),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])
    valid_tf = transforms.Compose([
        transforms.Resize((image_size, image_size)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])
    return train_tf, valid_tf


def build_model(num_classes: int) -> nn.Module:
    try:
        weights = models.ResNet18_Weights.DEFAULT
        model = models.resnet18(weights=weights)
    except Exception as exc:
        print(f"WARNING: pretrained weights unavailable ({exc}); using random initialization.")
        model = models.resnet18(weights=None)
    model.fc = nn.Linear(model.fc.in_features, num_classes)
    return model


def confusion_matrix(preds: list[int], labels: list[int], n: int) -> list[list[int]]:
    matrix = [[0 for _ in range(n)] for _ in range(n)]
    for y, p in zip(labels, preds):
        matrix[y][p] += 1
    return matrix


def metrics_from_confusion(matrix: list[list[int]]) -> dict[str, Any]:
    total = sum(sum(row) for row in matrix)
    correct = sum(matrix[i][i] for i in range(len(matrix)))
    per_class = {}
    recalls = []
    for i, name in enumerate(CLASSES):
        tp = matrix[i][i]
        support = sum(matrix[i])
        predicted = sum(matrix[r][i] for r in range(len(matrix)))
        recall = tp / support if support else 0.0
        precision = tp / predicted if predicted else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        recalls.append(recall)
        per_class[name] = {
            "support": support,
            "precision": round(precision, 5),
            "recall": round(recall, 5),
            "f1": round(f1, 5),
        }
    return {
        "accuracy": round(correct / total if total else 0.0, 6),
        "balanced_accuracy": round(sum(recalls) / len(recalls), 6),
        "per_class": per_class,
    }


def run_epoch(model, loader, criterion, device, optimizer=None):
    training = optimizer is not None
    model.train(training)
    total_loss = 0.0
    labels_all: list[int] = []
    preds_all: list[int] = []
    for images, labels in loader:
        images = images.to(device, non_blocking=True)
        labels = labels.to(device, non_blocking=True)
        if training:
            optimizer.zero_grad(set_to_none=True)
        logits = model(images)
        loss = criterion(logits, labels)
        if training:
            loss.backward()
            optimizer.step()
        total_loss += loss.item() * labels.size(0)
        preds = logits.argmax(dim=1)
        labels_all.extend(labels.detach().cpu().tolist())
        preds_all.extend(preds.detach().cpu().tolist())
    matrix = confusion_matrix(preds_all, labels_all, len(CLASSES))
    metrics = metrics_from_confusion(matrix)
    metrics["loss"] = round(total_loss / max(1, len(loader.dataset)), 6)
    metrics["confusion_matrix"] = matrix
    return metrics


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, default=None)
    parser.add_argument("--output", type=Path, default=Path("results/mura_anatomy"))
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--image-size", type=int, default=224)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--seed", type=int, default=23112)
    parser.add_argument("--check-only", action="store_true")
    parser.add_argument("--resume", type=Path, default=None)
    args = parser.parse_args()

    seed_everything(args.seed)
    data_root = args.data_root.resolve()
    metadata = args.metadata or (data_root / "mura_v1_1.csv")
    rows = load_metadata(metadata)
    if not rows:
        raise SystemExit("No valid MURA image rows were found in metadata.")
    image_root = locate_image_root(data_root, rows)
    audit = dataset_audit(rows, image_root)
    print(json.dumps(audit, indent=2))
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "dataset_audit.json").write_text(json.dumps(audit, indent=2), encoding="utf-8")
    if not audit["ready"]:
        raise SystemExit("Dataset audit failed. Fix missing files or patient leakage before training.")
    if args.check_only:
        print("\nDataset preflight passed. Training was not started (--check-only).")
        return

    train_rows = [r for r in rows if r["split"] == "train"]
    valid_rows = [r for r in rows if r["split"] == "valid"]
    train_tf, valid_tf = build_transforms(args.image_size)
    train_ds = MuraAnatomyDataset(train_rows, image_root, train_tf)
    valid_ds = MuraAnatomyDataset(valid_rows, image_root, valid_tf)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"\nDevice: {device}")
    if device.type == "cuda":
        print(f"GPU: {torch.cuda.get_device_name(0)}")

    pin = device.type == "cuda"
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True,
                              num_workers=args.workers, pin_memory=pin, persistent_workers=args.workers > 0)
    valid_loader = DataLoader(valid_ds, batch_size=args.batch_size, shuffle=False,
                              num_workers=args.workers, pin_memory=pin, persistent_workers=args.workers > 0)

    model = build_model(len(CLASSES)).to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=max(1, args.epochs))

    start_epoch = 1
    best_balanced = -1.0
    if args.resume:
        checkpoint = torch.load(args.resume, map_location=device)
        model.load_state_dict(checkpoint["model"])
        optimizer.load_state_dict(checkpoint["optimizer"])
        start_epoch = checkpoint["epoch"] + 1
        best_balanced = checkpoint.get("best_balanced_accuracy", -1.0)
        print(f"Resumed from epoch {checkpoint['epoch']}")

    history = []
    for epoch in range(start_epoch, args.epochs + 1):
        epoch_start = time.time()
        train_metrics = run_epoch(model, train_loader, criterion, device, optimizer)
        with torch.no_grad():
            valid_metrics = run_epoch(model, valid_loader, criterion, device)
        scheduler.step()

        record = {
            "epoch": epoch,
            "seconds": round(time.time() - epoch_start, 2),
            "lr": optimizer.param_groups[0]["lr"],
            "train": train_metrics,
            "valid": valid_metrics,
        }
        history.append(record)
        (args.output / "history.json").write_text(json.dumps(history, indent=2), encoding="utf-8")

        checkpoint = {
            "epoch": epoch,
            "classes": CLASSES,
            "model": model.state_dict(),
            "optimizer": optimizer.state_dict(),
            "best_balanced_accuracy": best_balanced,
            "args": vars(args),
        }
        torch.save(checkpoint, args.output / "last_checkpoint.pt")

        if valid_metrics["balanced_accuracy"] > best_balanced:
            best_balanced = valid_metrics["balanced_accuracy"]
            checkpoint["best_balanced_accuracy"] = best_balanced
            torch.save(checkpoint, args.output / "best_checkpoint.pt")
            (args.output / "best_metrics.json").write_text(json.dumps(record, indent=2), encoding="utf-8")

        print(
            f"Epoch {epoch}/{args.epochs} | "
            f"train loss {train_metrics['loss']:.4f} acc {train_metrics['accuracy']:.4f} | "
            f"valid loss {valid_metrics['loss']:.4f} acc {valid_metrics['accuracy']:.4f} "
            f"balanced {valid_metrics['balanced_accuracy']:.4f} | "
            f"{record['seconds']:.1f}s"
        )

    print(f"\nTraining complete. Best validation balanced accuracy: {best_balanced:.4f}")
    print(f"Outputs: {args.output.resolve()}")
    print("Research use only: this anatomy classifier is not a diagnostic model and is not clinically validated.")


if __name__ == "__main__":
    main()
