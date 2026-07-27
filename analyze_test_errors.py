"""
Comprehensive test-set error analysis for the C-arm APAH project.

Place this file in the repository root, beside evaluate_final.py, then run:

    python analyze_test_errors.py

Outputs are written to:
    logs/test_error_analysis.csv
    logs/landmark_statistics.csv
    logs/error_histogram.png
    logs/coordinate_error_boxplot.png
    logs/best_4_predictions.png
    logs/worst_4_predictions.png
"""

from __future__ import annotations

import csv
import inspect
import math
import os
import random
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
import torch
from PIL import Image
from torch.utils.data import DataLoader


# ---------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent
LOG_DIR = ROOT / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

CHECKPOINT_CANDIDATES = [
    LOG_DIR / "v1_best_29.03mm.pth",
    LOG_DIR / "best_multitask_model.pth",
    LOG_DIR / "final_multitask_model.pth",
]

ANNOTATION_CANDIDATES = [
    ROOT / "annotations_v2.csv",
    ROOT / "data" / "annotations_v2.csv",
    ROOT / "dataset" / "annotations_v2.csv",
]

BATCH_SIZE = 1
NUM_WORKERS = 0  # safest on Windows
SEED = 42
NUM_VISUALIZED = 4

# Set these only if automatic discovery fails.
FORCE_CHECKPOINT: str | None = None
FORCE_ANNOTATIONS: str | None = None


# ---------------------------------------------------------------------
# Reproducibility
# ---------------------------------------------------------------------

random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)
if torch.cuda.is_available():
    torch.cuda.manual_seed_all(SEED)


# ---------------------------------------------------------------------
# Flexible project imports
# ---------------------------------------------------------------------

sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "src"))

try:
    import dataset as dataset_module
except ImportError:
    from src import dataset as dataset_module  # type: ignore

try:
    import models as models_module
except ImportError:
    from src import models as models_module  # type: ignore


def find_existing_path(forced: str | None, candidates: list[Path], label: str) -> Path:
    if forced:
        path = Path(forced)
        if not path.is_absolute():
            path = ROOT / path
        if path.exists():
            return path
        raise FileNotFoundError(f"{label} not found: {path}")

    for path in candidates:
        if path.exists():
            return path

    searched = "\n".join(f"  - {p}" for p in candidates)
    raise FileNotFoundError(f"Could not find {label}. Searched:\n{searched}")


def locate_dataset_class() -> type:
    preferred_names = [
        "CArmDataset",
        "CarmDataset",
        "LandmarkDataset",
        "APAH_Dataset",
        "APAHDataSet",
        "CustomDataset",
    ]

    for name in preferred_names:
        obj = getattr(dataset_module, name, None)
        if inspect.isclass(obj) and issubclass(obj, torch.utils.data.Dataset):
            return obj

    candidates = []
    for name, obj in vars(dataset_module).items():
        if (
            inspect.isclass(obj)
            and issubclass(obj, torch.utils.data.Dataset)
            and obj is not torch.utils.data.Dataset
        ):
            candidates.append((name, obj))

    if len(candidates) == 1:
        return candidates[0][1]

    names = ", ".join(name for name, _ in candidates) or "none"
    raise RuntimeError(
        "Could not uniquely identify the dataset class in src/dataset.py. "
        f"Dataset subclasses found: {names}"
    )


def locate_model_class() -> type:
    preferred_names = [
        "MultiTaskResNet",
        "MultitaskResNet",
        "MultiTaskModel",
        "CArmModel",
        "LandmarkRegressionModel",
        "ResNet34MultiTask",
    ]

    for name in preferred_names:
        obj = getattr(models_module, name, None)
        if inspect.isclass(obj) and issubclass(obj, torch.nn.Module):
            return obj

    candidates = []
    for name, obj in vars(models_module).items():
        if inspect.isclass(obj) and issubclass(obj, torch.nn.Module) and obj is not torch.nn.Module:
            candidates.append((name, obj))

    if len(candidates) == 1:
        return candidates[0][1]

    names = ", ".join(name for name, _ in candidates) or "none"
    raise RuntimeError(
        "Could not uniquely identify the model class in src/models.py. "
        f"nn.Module subclasses found: {names}"
    )


def read_csv_rows(csv_path: Path) -> list[dict[str, str]]:
    with csv_path.open("r", newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def infer_csv_columns(rows: list[dict[str, str]]) -> dict[str, Any]:
    if not rows:
        raise ValueError(f"No rows found in {ANNOTATIONS_PATH}")

    columns = list(rows[0].keys())
    lower_map = {c.lower().strip(): c for c in columns}

    def first_match(options: list[str]) -> str | None:
        for option in options:
            if option in lower_map:
                return lower_map[option]
        for c in columns:
            lc = c.lower()
            if any(option in lc for option in options):
                return c
        return None

    image_col = first_match(["image", "image_path", "filename", "file", "img", "path"])
    split_col = first_match(["split", "set", "subset", "partition"])
    label_col = first_match(["label", "class", "landmark", "target_class", "anatomy"])

    coordinate_candidates: dict[str, str | None] = {
        "x": first_match(["x", "coord_x", "target_x", "position_x"]),
        "y": first_match(["y", "coord_y", "target_y", "position_y"]),
        "z": first_match(["z", "coord_z", "target_z", "position_z"]),
    }

    numeric_cols = []
    for c in columns:
        values = []
        for row in rows[: min(20, len(rows))]:
            try:
                values.append(float(row[c]))
            except (TypeError, ValueError):
                pass
        if len(values) >= max(1, min(5, len(rows))):
            numeric_cols.append(c)

    used = {v for v in coordinate_candidates.values() if v}
    remaining_numeric = [c for c in numeric_cols if c not in used]

    for axis in ("x", "y", "z"):
        if coordinate_candidates[axis] is None and remaining_numeric:
            coordinate_candidates[axis] = remaining_numeric.pop(0)

    return {
        "columns": columns,
        "image": image_col,
        "split": split_col,
        "label": label_col,
        "coords": coordinate_candidates,
    }


def load_checkpoint(path: Path, device: torch.device) -> dict[str, Any]:
    checkpoint = torch.load(path, map_location=device, weights_only=False)
    if isinstance(checkpoint, dict):
        return checkpoint
    return {"state_dict": checkpoint}


def extract_state_dict(checkpoint: dict[str, Any]) -> dict[str, torch.Tensor]:
    for key in ("model_state_dict", "state_dict", "model", "network"):
        value = checkpoint.get(key)
        if isinstance(value, dict) and value:
            return value

    if checkpoint and all(torch.is_tensor(v) for v in checkpoint.values()):
        return checkpoint  # raw state dict

    raise KeyError(
        "Checkpoint does not contain a recognizable model state dictionary. "
        "Expected model_state_dict, state_dict, model, or network."
    )


def normalize_state_dict_keys(state_dict: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
    cleaned = {}
    for key, value in state_dict.items():
        new_key = key
        if new_key.startswith("module."):
            new_key = new_key[len("module.") :]

        # Support repository head naming variants.
        new_key = new_key.replace("classification_head.", "classifier.")
        new_key = new_key.replace("regression_head.", "regressor.")
        cleaned[new_key] = value
    return cleaned


def infer_num_classes(state_dict: dict[str, torch.Tensor], rows: list[dict[str, str]]) -> int:
    possible_keys = [
        "classifier.weight",
        "classification_head.weight",
        "fc_class.weight",
        "class_head.weight",
    ]
    for key in possible_keys:
        if key in state_dict and state_dict[key].ndim >= 2:
            return int(state_dict[key].shape[0])

    label_col = CSV_INFO["label"]
    if label_col:
        labels = sorted({row[label_col] for row in rows if row.get(label_col, "") != ""})
        if labels:
            return len(labels)

    return 4


def construct_model(model_class: type, num_classes: int) -> torch.nn.Module:
    signature = inspect.signature(model_class)
    kwargs: dict[str, Any] = {}

    parameter_names = set(signature.parameters)
    for name in ("num_classes", "n_classes", "classes", "num_landmarks"):
        if name in parameter_names:
            kwargs[name] = num_classes
            break

    for name in ("pretrained", "weights"):
        if name in parameter_names:
            kwargs[name] = False if name == "pretrained" else None

    try:
        return model_class(**kwargs)
    except TypeError:
        # Common fallback constructors.
        attempts = [
            lambda: model_class(num_classes),
            lambda: model_class(),
        ]
        errors = []
        for attempt in attempts:
            try:
                return attempt()
            except Exception as exc:
                errors.append(repr(exc))
        raise RuntimeError(
            f"Could not construct model class {model_class.__name__}. "
            f"Attempts failed: {' | '.join(errors)}"
        )


def try_construct_dataset(
    dataset_class: type,
    csv_path: Path,
    split: str,
    train_stats: Any | None = None,
) -> Any:
    signature = inspect.signature(dataset_class)
    parameters = signature.parameters
    kwargs: dict[str, Any] = {}

    path_keys = (
        "csv_file",
        "csv_path",
        "annotations_file",
        "annotations_path",
        "annotation_file",
    )
    for key in path_keys:
        if key in parameters:
            kwargs[key] = str(csv_path)
            break

    root_keys = ("root_dir", "data_dir", "image_dir", "images_dir")
    for key in root_keys:
        if key in parameters:
            kwargs[key] = str(ROOT)
            break

    split_keys = ("split", "mode", "subset", "phase")
    for key in split_keys:
        if key in parameters:
            kwargs[key] = split
            break

    if "train" in parameters:
        kwargs["train"] = split.lower() == "train"

    # Reuse training normalization statistics when the class supports it.
    if train_stats is not None:
        for key in (
            "normalization_stats",
            "norm_stats",
            "train_stats",
            "coordinate_stats",
            "stats",
        ):
            if key in parameters:
                kwargs[key] = train_stats
                break

    # No augmentation for evaluation.
    if "augment" in parameters:
        kwargs["augment"] = False
    if "augmentation" in parameters:
        kwargs["augmentation"] = False

    errors = []

    try:
        return dataset_class(**kwargs)
    except Exception as exc:
        errors.append(f"keyword construction: {exc!r}")

    # Positional fallbacks for typical implementations.
    attempts = [
        lambda: dataset_class(str(csv_path), split=split),
        lambda: dataset_class(str(csv_path), split),
        lambda: dataset_class(str(csv_path), train=(split.lower() == "train")),
        lambda: dataset_class(str(csv_path)),
    ]
    for attempt in attempts:
        try:
            return attempt()
        except Exception as exc:
            errors.append(repr(exc))

    raise RuntimeError(
        f"Could not construct {dataset_class.__name__} for split={split!r}.\n"
        + "\n".join(f"  - {error}" for error in errors)
    )


def extract_dataset_stats(dataset: Any) -> Any | None:
    for name in (
        "normalization_stats",
        "norm_stats",
        "train_stats",
        "coordinate_stats",
        "stats",
    ):
        if hasattr(dataset, name):
            return getattr(dataset, name)

    mean_names = ("coord_mean", "coordinate_mean", "mean")
    std_names = ("coord_std", "coordinate_std", "std")

    mean = next((getattr(dataset, n) for n in mean_names if hasattr(dataset, n)), None)
    std = next((getattr(dataset, n) for n in std_names if hasattr(dataset, n)), None)
    if mean is not None and std is not None:
        return {"mean": mean, "std": std}

    return None


def unpack_batch(batch: Any) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, dict[str, Any]]:
    metadata: dict[str, Any] = {}

    if isinstance(batch, dict):
        image = next(
            (batch[k] for k in ("image", "images", "x", "input") if k in batch),
            None,
        )
        label = next(
            (batch[k] for k in ("label", "labels", "class", "target_class") if k in batch),
            None,
        )
        coords = next(
            (
                batch[k]
                for k in ("coordinates", "coords", "position", "target", "landmark")
                if k in batch
            ),
            None,
        )
        metadata = {
            k: v
            for k, v in batch.items()
            if k
            not in {
                "image",
                "images",
                "x",
                "input",
                "label",
                "labels",
                "class",
                "target_class",
                "coordinates",
                "coords",
                "position",
                "target",
                "landmark",
            }
        }
    elif isinstance(batch, (list, tuple)):
        if len(batch) < 3:
            raise ValueError(
                "Dataset batch must contain at least image, label, and coordinates."
            )
        image, label, coords = batch[:3]
        if len(batch) >= 4:
            metadata["extra"] = batch[3:]
    else:
        raise TypeError(f"Unsupported batch type: {type(batch).__name__}")

    if image is None or label is None or coords is None:
        raise ValueError(
            "Could not extract image, class label, and coordinates from the dataset batch."
        )

    return image, label, coords, metadata


def unpack_model_output(output: Any) -> tuple[torch.Tensor, torch.Tensor]:
    if isinstance(output, dict):
        logits = next(
            (
                output[k]
                for k in (
                    "classification",
                    "class_logits",
                    "logits",
                    "classifier",
                    "class_output",
                )
                if k in output
            ),
            None,
        )
        coords = next(
            (
                output[k]
                for k in (
                    "regression",
                    "coordinates",
                    "coords",
                    "position",
                    "regressor",
                )
                if k in output
            ),
            None,
        )
    elif isinstance(output, (list, tuple)) and len(output) >= 2:
        logits, coords = output[:2]
    else:
        raise TypeError(
            "Model output must be a dict or tuple containing classification and regression outputs."
        )

    if logits is None or coords is None:
        raise ValueError("Could not unpack classification and regression model outputs.")

    return logits, coords


def dataset_denormalize(dataset: Any, coords: torch.Tensor | np.ndarray) -> np.ndarray:
    arr = (
        coords.detach().cpu().numpy()
        if isinstance(coords, torch.Tensor)
        else np.asarray(coords)
    ).astype(np.float64)

    for name in (
        "denormalize_coordinates",
        "denormalize_coords",
        "inverse_transform_coordinates",
        "inverse_transform",
    ):
        method = getattr(dataset, name, None)
        if callable(method):
            try:
                result = method(arr)
                return np.asarray(result, dtype=np.float64)
            except Exception:
                try:
                    tensor_result = method(torch.as_tensor(arr, dtype=torch.float32))
                    if isinstance(tensor_result, torch.Tensor):
                        return tensor_result.detach().cpu().numpy().astype(np.float64)
                except Exception:
                    pass

    # Attribute-based fallback.
    mean = None
    std = None
    for name in ("coord_mean", "coordinate_mean"):
        if hasattr(dataset, name):
            mean = np.asarray(getattr(dataset, name), dtype=np.float64)
            break
    for name in ("coord_std", "coordinate_std"):
        if hasattr(dataset, name):
            std = np.asarray(getattr(dataset, name), dtype=np.float64)
            break

    if mean is not None and std is not None:
        return arr * std + mean

    stats = extract_dataset_stats(dataset)
    if isinstance(stats, dict):
        mean = stats.get("mean")
        std = stats.get("std")
        if mean is not None and std is not None:
            return arr * np.asarray(std) + np.asarray(mean)

    # If no normalization metadata exists, assume coordinates are already in mm.
    return arr


def tensor_to_grayscale(image_tensor: torch.Tensor) -> np.ndarray:
    image = image_tensor.detach().cpu().float()

    if image.ndim == 4:
        image = image[0]

    if image.ndim == 2:
        array = image.numpy()
    elif image.ndim == 3:
        if image.shape[0] == 1:
            array = image[0].numpy()
        else:
            # Undo common ImageNet normalization before grayscale conversion.
            if image.shape[0] >= 3:
                mean = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1)
                std = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)
                rgb = image[:3] * std + mean
                rgb = rgb.clamp(0, 1)
                array = (
                    0.2989 * rgb[0] + 0.5870 * rgb[1] + 0.1140 * rgb[2]
                ).numpy()
            else:
                array = image.mean(dim=0).numpy()
    else:
        raise ValueError(f"Unsupported image tensor shape: {tuple(image.shape)}")

    array = np.nan_to_num(array)
    min_value = float(array.min())
    max_value = float(array.max())
    if max_value > min_value:
        array = (array - min_value) / (max_value - min_value)
    return array


def identify_filename(index: int, metadata: dict[str, Any]) -> str:
    for key in ("filename", "file", "image_path", "path", "name"):
        value = metadata.get(key)
        if value is not None:
            if isinstance(value, (list, tuple)) and value:
                value = value[0]
            return Path(str(value)).name

    extra = metadata.get("extra")
    if extra:
        for value in extra:
            if isinstance(value, (list, tuple)) and value:
                value = value[0]
            if isinstance(value, (str, os.PathLike)):
                return Path(str(value)).name

    # CSV-based fallback.
    image_col = CSV_INFO["image"]
    test_rows = get_test_rows(CSV_ROWS)
    if image_col and index < len(test_rows):
        return Path(test_rows[index][image_col]).name

    return f"sample_{index:03d}"


def get_test_rows(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    split_col = CSV_INFO["split"]
    if split_col:
        test_values = {"test", "testing", "val", "validation"}
        selected = [
            row
            for row in rows
            if str(row.get(split_col, "")).strip().lower() in test_values
        ]
        if selected:
            return selected

    # Dataset was described as 43 train / 17 test.
    if len(rows) >= 17:
        return rows[-17:]
    return rows


def label_name(label_index: int) -> str:
    # Prefer dataset mappings.
    for attribute in (
        "idx_to_class",
        "index_to_class",
        "label_names",
        "classes",
        "class_names",
    ):
        mapping = getattr(TEST_DATASET, attribute, None)
        if isinstance(mapping, dict):
            return str(mapping.get(label_index, label_index))
        if isinstance(mapping, (list, tuple)) and 0 <= label_index < len(mapping):
            return str(mapping[label_index])

    label_col = CSV_INFO["label"]
    if label_col:
        values = sorted(
            {row[label_col] for row in CSV_ROWS if row.get(label_col, "") != ""}
        )
        if 0 <= label_index < len(values):
            return str(values[label_index])

    return str(label_index)


def coordinates_to_pixel(
    coords: np.ndarray,
    image_shape: tuple[int, int],
) -> tuple[float, float] | None:
    """
    Best-effort plotting fallback.

    The repository predicts physical 3D coordinates, so an exact 2D projection
    is generally unavailable without camera geometry. If x/y already look like
    image coordinates, plot them. Otherwise do not draw misleading markers.
    """
    if coords.size < 2:
        return None

    x, y = float(coords[0]), float(coords[1])
    height, width = image_shape

    if 0 <= x < width and 0 <= y < height:
        return x, y

    if 0 <= x <= 1 and 0 <= y <= 1:
        return x * width, y * height

    return None


def save_prediction_grid(
    records: list[dict[str, Any]],
    output_path: Path,
    title: str,
) -> None:
    if not records:
        return

    fig, axes = plt.subplots(1, len(records), figsize=(5 * len(records), 5))
    if len(records) == 1:
        axes = [axes]

    for axis, record in zip(axes, records):
        image = record["image"]
        axis.imshow(image, cmap="gray")

        target_px = coordinates_to_pixel(record["target_coords"], image.shape)
        pred_px = coordinates_to_pixel(record["pred_coords"], image.shape)

        if target_px is not None:
            axis.scatter(
                [target_px[0]],
                [target_px[1]],
                marker="x",
                s=100,
                linewidths=2,
                label="Target",
            )

        if pred_px is not None:
            axis.scatter(
                [pred_px[0]],
                [pred_px[1]],
                marker="o",
                s=70,
                facecolors="none",
                linewidths=2,
                label="Prediction",
            )

        if target_px is not None or pred_px is not None:
            axis.legend(loc="lower right", fontsize=8)

        class_status = "correct" if record["class_correct"] else "incorrect"
        axis.set_title(
            f'{record["filename"]}\n'
            f'Landmark: {record["true_label_name"]}\n'
            f'Error: {record["spatial_error_mm"]:.2f} mm | Class: {class_status}',
            fontsize=10,
        )
        axis.axis("off")

    fig.suptitle(title, fontsize=15)
    fig.tight_layout()
    fig.savefig(output_path, dpi=300, bbox_inches="tight")
    plt.close(fig)


# ---------------------------------------------------------------------
# Resolve files and instantiate project components
# ---------------------------------------------------------------------

CHECKPOINT_PATH = find_existing_path(
    FORCE_CHECKPOINT,
    CHECKPOINT_CANDIDATES,
    "checkpoint",
)
ANNOTATIONS_PATH = find_existing_path(
    FORCE_ANNOTATIONS,
    ANNOTATION_CANDIDATES,
    "annotations CSV",
)

CSV_ROWS = read_csv_rows(ANNOTATIONS_PATH)
CSV_INFO = infer_csv_columns(CSV_ROWS)

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

DATASET_CLASS = locate_dataset_class()
MODEL_CLASS = locate_model_class()

TRAIN_DATASET = try_construct_dataset(
    DATASET_CLASS,
    ANNOTATIONS_PATH,
    split="train",
)
TRAIN_STATS = extract_dataset_stats(TRAIN_DATASET)

TEST_DATASET = try_construct_dataset(
    DATASET_CLASS,
    ANNOTATIONS_PATH,
    split="test",
    train_stats=TRAIN_STATS,
)

TEST_LOADER = DataLoader(
    TEST_DATASET,
    batch_size=BATCH_SIZE,
    shuffle=False,
    num_workers=NUM_WORKERS,
    pin_memory=torch.cuda.is_available(),
)

CHECKPOINT = load_checkpoint(CHECKPOINT_PATH, DEVICE)
RAW_STATE_DICT = extract_state_dict(CHECKPOINT)
STATE_DICT = normalize_state_dict_keys(RAW_STATE_DICT)
NUM_CLASSES = infer_num_classes(STATE_DICT, CSV_ROWS)

MODEL = construct_model(MODEL_CLASS, NUM_CLASSES).to(DEVICE)

try:
    missing_keys, unexpected_keys = MODEL.load_state_dict(STATE_DICT, strict=False)
except RuntimeError:
    # Retry without renaming the head keys.
    fallback_state = {
        key.removeprefix("module."): value for key, value in RAW_STATE_DICT.items()
    }
    missing_keys, unexpected_keys = MODEL.load_state_dict(fallback_state, strict=False)

MODEL.eval()


# ---------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------

records: list[dict[str, Any]] = []

with torch.inference_mode():
    for index, batch in enumerate(TEST_LOADER):
        images, labels, target_coords, metadata = unpack_batch(batch)

        images = images.to(DEVICE, non_blocking=True)
        labels = labels.to(DEVICE, non_blocking=True).long().view(-1)
        target_coords = target_coords.to(DEVICE, non_blocking=True).float()

        output = MODEL(images)
        logits, predicted_coords = unpack_model_output(output)

        predicted_labels = torch.argmax(logits, dim=1)

        predicted_mm = dataset_denormalize(TEST_DATASET, predicted_coords)
        target_mm = dataset_denormalize(TEST_DATASET, target_coords)

        predicted_mm = np.asarray(predicted_mm).reshape(len(images), -1)
        target_mm = np.asarray(target_mm).reshape(len(images), -1)

        for batch_index in range(len(images)):
            pred = predicted_mm[batch_index]
            target = target_mm[batch_index]

            dimensions = min(len(pred), len(target), 3)
            pred = pred[:dimensions]
            target = target[:dimensions]

            signed_error = pred - target
            absolute_error = np.abs(signed_error)
            spatial_error = float(np.linalg.norm(signed_error))

            true_label = int(labels[batch_index].item())
            predicted_label = int(predicted_labels[batch_index].item())

            filename = identify_filename(index * BATCH_SIZE + batch_index, metadata)

            image_for_plot = tensor_to_grayscale(images[batch_index])

            record = {
                "sample_index": index * BATCH_SIZE + batch_index,
                "filename": filename,
                "true_label": true_label,
                "true_label_name": label_name(true_label),
                "predicted_label": predicted_label,
                "predicted_label_name": label_name(predicted_label),
                "class_correct": true_label == predicted_label,
                "target_coords": target,
                "pred_coords": pred,
                "signed_error": signed_error,
                "absolute_error": absolute_error,
                "spatial_error_mm": spatial_error,
                "image": image_for_plot,
            }
            records.append(record)


if not records:
    raise RuntimeError("The test dataset produced no samples.")


# ---------------------------------------------------------------------
# Aggregate metrics
# ---------------------------------------------------------------------

errors = np.asarray([record["spatial_error_mm"] for record in records], dtype=float)
class_accuracy = 100.0 * np.mean([record["class_correct"] for record in records])

overall = {
    "count": len(records),
    "mean": float(np.mean(errors)),
    "median": float(np.median(errors)),
    "std": float(np.std(errors)),
    "min": float(np.min(errors)),
    "max": float(np.max(errors)),
    "p95": float(np.percentile(errors, 95)),
    "classification_accuracy": float(class_accuracy),
}

records_sorted_worst = sorted(
    records,
    key=lambda record: record["spatial_error_mm"],
    reverse=True,
)

for rank, record in enumerate(records_sorted_worst, start=1):
    record["rank_worst_to_best"] = rank


# ---------------------------------------------------------------------
# Save per-image CSV
# ---------------------------------------------------------------------

analysis_csv = LOG_DIR / "test_error_analysis.csv"

max_dimensions = max(len(record["target_coords"]) for record in records)
axis_names = ["x", "y", "z"][:max_dimensions]

fieldnames = [
    "rank_worst_to_best",
    "sample_index",
    "filename",
    "true_label",
    "true_label_name",
    "predicted_label",
    "predicted_label_name",
    "class_correct",
]

for axis in axis_names:
    fieldnames.extend(
        [
            f"target_{axis}_mm",
            f"predicted_{axis}_mm",
            f"signed_error_{axis}_mm",
            f"absolute_error_{axis}_mm",
        ]
    )

fieldnames.append("spatial_error_mm")

with analysis_csv.open("w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()

    for record in records_sorted_worst:
        row = {
            "rank_worst_to_best": record["rank_worst_to_best"],
            "sample_index": record["sample_index"],
            "filename": record["filename"],
            "true_label": record["true_label"],
            "true_label_name": record["true_label_name"],
            "predicted_label": record["predicted_label"],
            "predicted_label_name": record["predicted_label_name"],
            "class_correct": record["class_correct"],
            "spatial_error_mm": f'{record["spatial_error_mm"]:.6f}',
        }

        for axis_index, axis in enumerate(axis_names):
            row[f"target_{axis}_mm"] = f'{record["target_coords"][axis_index]:.6f}'
            row[f"predicted_{axis}_mm"] = f'{record["pred_coords"][axis_index]:.6f}'
            row[f"signed_error_{axis}_mm"] = f'{record["signed_error"][axis_index]:.6f}'
            row[f"absolute_error_{axis}_mm"] = f'{record["absolute_error"][axis_index]:.6f}'

        writer.writerow(row)


# ---------------------------------------------------------------------
# Save per-landmark statistics
# ---------------------------------------------------------------------

grouped_errors: dict[str, list[float]] = defaultdict(list)
for record in records:
    grouped_errors[record["true_label_name"]].append(record["spatial_error_mm"])

landmark_csv = LOG_DIR / "landmark_statistics.csv"

with landmark_csv.open("w", newline="", encoding="utf-8") as f:
    fieldnames = [
        "landmark",
        "count",
        "mean_error_mm",
        "median_error_mm",
        "std_error_mm",
        "best_error_mm",
        "worst_error_mm",
        "p95_error_mm",
    ]
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()

    for landmark, values in sorted(grouped_errors.items()):
        arr = np.asarray(values, dtype=float)
        writer.writerow(
            {
                "landmark": landmark,
                "count": len(arr),
                "mean_error_mm": f"{np.mean(arr):.6f}",
                "median_error_mm": f"{np.median(arr):.6f}",
                "std_error_mm": f"{np.std(arr):.6f}",
                "best_error_mm": f"{np.min(arr):.6f}",
                "worst_error_mm": f"{np.max(arr):.6f}",
                "p95_error_mm": f"{np.percentile(arr, 95):.6f}",
            }
        )


# ---------------------------------------------------------------------
# Save figures
# ---------------------------------------------------------------------

fig = plt.figure(figsize=(8, 5))
plt.hist(errors, bins=min(10, max(5, len(errors))))
plt.axvline(overall["mean"], linestyle="--", label=f'Mean: {overall["mean"]:.2f} mm')
plt.axvline(
    overall["median"],
    linestyle=":",
    label=f'Median: {overall["median"]:.2f} mm',
)
plt.xlabel("3D spatial error (mm)")
plt.ylabel("Number of test samples")
plt.title("Test-set spatial error distribution")
plt.legend()
plt.tight_layout()
plt.savefig(LOG_DIR / "error_histogram.png", dpi=300, bbox_inches="tight")
plt.close(fig)

coordinate_errors = []
coordinate_labels = []
for axis_index, axis in enumerate(axis_names):
    coordinate_errors.append(
        [record["absolute_error"][axis_index] for record in records]
    )
    coordinate_labels.append(axis.upper())

if coordinate_errors:
    fig = plt.figure(figsize=(7, 5))
    plt.boxplot(coordinate_errors, tick_labels=coordinate_labels)
    plt.xlabel("Coordinate axis")
    plt.ylabel("Absolute error (mm)")
    plt.title("Coordinate-wise absolute error")
    plt.tight_layout()
    plt.savefig(
        LOG_DIR / "coordinate_error_boxplot.png",
        dpi=300,
        bbox_inches="tight",
    )
    plt.close(fig)

best_records = sorted(
    records,
    key=lambda record: record["spatial_error_mm"],
)[:NUM_VISUALIZED]

worst_records = records_sorted_worst[:NUM_VISUALIZED]

save_prediction_grid(
    best_records,
    LOG_DIR / "best_4_predictions.png",
    "Best four test predictions",
)

save_prediction_grid(
    worst_records,
    LOG_DIR / "worst_4_predictions.png",
    "Worst four test predictions",
)


# ---------------------------------------------------------------------
# Console report
# ---------------------------------------------------------------------

print()
print("=" * 70)
print("C-ARM TEST-SET ERROR ANALYSIS")
print("=" * 70)
print(f"Device                    : {DEVICE}")
print(f"Checkpoint                : {CHECKPOINT_PATH}")
print(f"Annotations               : {ANNOTATIONS_PATH}")
print(f"Dataset class             : {DATASET_CLASS.__name__}")
print(f"Model class               : {MODEL_CLASS.__name__}")
print(f"Test samples              : {overall['count']}")
print(f"Classification accuracy   : {overall['classification_accuracy']:.2f}%")
print(f"Mean spatial error        : {overall['mean']:.2f} mm")
print(f"Median spatial error      : {overall['median']:.2f} mm")
print(f"Standard deviation        : {overall['std']:.2f} mm")
print(f"Best spatial error        : {overall['min']:.2f} mm")
print(f"Worst spatial error       : {overall['max']:.2f} mm")
print(f"95th percentile           : {overall['p95']:.2f} mm")

if missing_keys:
    print(f"Missing checkpoint keys   : {len(missing_keys)}")
if unexpected_keys:
    print(f"Unexpected checkpoint keys: {len(unexpected_keys)}")

print()
print("PER-LANDMARK RESULTS")
print("-" * 70)
print(f'{"Landmark":<24} {"N":>3} {"Mean":>10} {"Median":>10} {"Worst":>10}')
for landmark, values in sorted(grouped_errors.items()):
    arr = np.asarray(values, dtype=float)
    print(
        f"{landmark:<24} "
        f"{len(arr):>3d} "
        f"{np.mean(arr):>9.2f} "
        f"{np.median(arr):>9.2f} "
        f"{np.max(arr):>9.2f}"
    )

print()
print("WORST FOUR SAMPLES")
print("-" * 70)
print(f'{"Rank":>4}  {"Filename":<30} {"Landmark":<18} {"Error":>10}')
for record in worst_records:
    print(
        f'{record["rank_worst_to_best"]:>4d}  '
        f'{record["filename"][:30]:<30} '
        f'{record["true_label_name"][:18]:<18} '
        f'{record["spatial_error_mm"]:>8.2f} mm'
    )

print()
print("FILES SAVED")
print("-" * 70)
for path in (
    analysis_csv,
    landmark_csv,
    LOG_DIR / "error_histogram.png",
    LOG_DIR / "coordinate_error_boxplot.png",
    LOG_DIR / "best_4_predictions.png",
    LOG_DIR / "worst_4_predictions.png",
):
    print(path)

print("=" * 70)
