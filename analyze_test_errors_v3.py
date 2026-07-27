"""
Exact test-set error analysis for this C-arm APAH repository.

Place this file in the repository root beside evaluate_final.py, then run:

    python analyze_test_errors_v3.py

It uses the same:
- MedicalLandmarkDataset
- MultiTaskResNet
- checkpoint compatibility logic
- training-coordinate normalization statistics

as evaluate_final.py.
"""

from __future__ import annotations

import csv
import os
import sys
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import torch
from torch.utils.data import DataLoader


# =========================================================
# Project paths
# =========================================================

PROJECT_ROOT = Path(__file__).resolve().parent
LOG_DIR = PROJECT_ROOT / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


from src.dataset import MedicalLandmarkDataset
from src.train_landmark_regression import MultiTaskResNet


# =========================================================
# Settings
# =========================================================

NUM_VISUALIZED = 4

CHECKPOINT_CANDIDATES = [
    LOG_DIR / "best_multitask_model.pth",
    LOG_DIR / "v1_best_29.03mm.pth",
    LOG_DIR / "final_multitask_model.pth",
]


# =========================================================
# Checkpoint loading
# =========================================================

def find_checkpoint() -> Path:
    for checkpoint_path in CHECKPOINT_CANDIDATES:
        if checkpoint_path.exists():
            return checkpoint_path

    searched = "\n".join(
        f"  - {path}" for path in CHECKPOINT_CANDIDATES
    )

    raise FileNotFoundError(
        "No compatible checkpoint was found.\n"
        f"Searched:\n{searched}"
    )


def load_compatible_checkpoint(
    model: torch.nn.Module,
    model_path: Path,
    device: torch.device,
) -> None:
    checkpoint = torch.load(
        model_path,
        map_location=device,
        weights_only=True,
    )

    if (
        isinstance(checkpoint, dict)
        and "model_state_dict" in checkpoint
    ):
        checkpoint = checkpoint["model_state_dict"]

    if not isinstance(checkpoint, dict):
        raise TypeError(
            "The checkpoint does not contain a valid state dictionary."
        )

    state_dict = {}

    for key, value in checkpoint.items():
        clean_key = key

        if clean_key.startswith("module."):
            clean_key = clean_key[len("module."):]

        state_dict[clean_key] = value

    model_keys = set(model.state_dict().keys())
    checkpoint_keys = set(state_dict.keys())

    model_uses_classifier_names = (
        "classifier.weight" in model_keys
        and "regressor.weight" in model_keys
    )

    model_uses_head_names = (
        "classification_head.weight" in model_keys
        and "regression_head.weight" in model_keys
    )

    checkpoint_uses_classifier_names = (
        "classifier.weight" in checkpoint_keys
        and "regressor.weight" in checkpoint_keys
    )

    checkpoint_uses_head_names = (
        "classification_head.weight" in checkpoint_keys
        and "regression_head.weight" in checkpoint_keys
    )

    if (
        model_uses_classifier_names
        and checkpoint_uses_head_names
    ):
        rename_map = {
            "classification_head.weight": "classifier.weight",
            "classification_head.bias": "classifier.bias",
            "regression_head.weight": "regressor.weight",
            "regression_head.bias": "regressor.bias",
        }

        for old_key, new_key in rename_map.items():
            if old_key in state_dict:
                state_dict[new_key] = state_dict.pop(old_key)

        print(
            "Checkpoint compatibility: converted "
            "classification_head/regression_head "
            "to classifier/regressor."
        )

    elif (
        model_uses_head_names
        and checkpoint_uses_classifier_names
    ):
        rename_map = {
            "classifier.weight": "classification_head.weight",
            "classifier.bias": "classification_head.bias",
            "regressor.weight": "regression_head.weight",
            "regressor.bias": "regression_head.bias",
        }

        for old_key, new_key in rename_map.items():
            if old_key in state_dict:
                state_dict[new_key] = state_dict.pop(old_key)

        print(
            "Checkpoint compatibility: converted "
            "classifier/regressor "
            "to classification_head/regression_head."
        )

    model.load_state_dict(
        state_dict,
        strict=True,
    )


# =========================================================
# Helpers
# =========================================================

def denormalize_coordinates(
    normalized_coordinates: np.ndarray,
    stats: dict,
) -> np.ndarray:
    return np.array(
        [
            normalized_coordinates[0] * stats["x_std"]
            + stats["x_mean"],

            normalized_coordinates[1] * stats["y_std"]
            + stats["y_mean"],

            normalized_coordinates[2] * stats["z_std"]
            + stats["z_mean"],
        ],
        dtype=np.float64,
    )


def normalized_difference_to_mm(
    predicted_normalized: np.ndarray,
    target_normalized: np.ndarray,
    stats: dict,
) -> np.ndarray:
    return np.array(
        [
            (
                predicted_normalized[0]
                - target_normalized[0]
            )
            * stats["x_std"],

            (
                predicted_normalized[1]
                - target_normalized[1]
            )
            * stats["y_std"],

            (
                predicted_normalized[2]
                - target_normalized[2]
            )
            * stats["z_std"],
        ],
        dtype=np.float64,
    )


def tensor_to_grayscale(
    image_tensor: torch.Tensor,
) -> np.ndarray:
    image = image_tensor.detach().cpu().float()

    mean = torch.tensor(
        [0.485, 0.456, 0.406],
        dtype=image.dtype,
    ).view(3, 1, 1)

    std = torch.tensor(
        [0.229, 0.224, 0.225],
        dtype=image.dtype,
    ).view(3, 1, 1)

    image = image * std + mean
    image = image.clamp(0.0, 1.0)

    grayscale = (
        0.2989 * image[0]
        + 0.5870 * image[1]
        + 0.1140 * image[2]
    )

    return grayscale.numpy()


def safe_filename(
    test_set: MedicalLandmarkDataset,
    sample_index: int,
) -> str:
    try:
        return Path(
            str(
                test_set.df.iloc[sample_index]["filename"]
            )
        ).name
    except Exception:
        return f"sample_{sample_index:03d}"


def landmark_name(
    class_index: int,
) -> str:
    return f"Landmark {class_index + 1}"


def save_prediction_grid(
    records: list[dict],
    output_path: Path,
    title: str,
) -> None:
    if not records:
        return

    figure, axes = plt.subplots(
        1,
        len(records),
        figsize=(5 * len(records), 5.5),
    )

    if len(records) == 1:
        axes = [axes]

    for axis, record in zip(axes, records):
        axis.imshow(
            record["image"],
            cmap="gray",
        )

        class_result = (
            "Correct"
            if record["class_correct"]
            else "Incorrect"
        )

        target_text = (
            f'Target: '
            f'({record["target_mm"][0]:.1f}, '
            f'{record["target_mm"][1]:.1f}, '
            f'{record["target_mm"][2]:.1f}) mm'
        )

        prediction_text = (
            f'Predicted: '
            f'({record["predicted_mm"][0]:.1f}, '
            f'{record["predicted_mm"][1]:.1f}, '
            f'{record["predicted_mm"][2]:.1f}) mm'
        )

        axis.set_title(
            f'{record["filename"]}\n'
            f'{record["true_landmark_name"]}\n'
            f'Error: {record["spatial_error_mm"]:.2f} mm\n'
            f'Classification: {class_result}',
            fontsize=10,
        )

        axis.text(
            0.02,
            0.02,
            target_text + "\n" + prediction_text,
            transform=axis.transAxes,
            fontsize=8,
            verticalalignment="bottom",
            bbox={
                "boxstyle": "round",
                "alpha": 0.75,
            },
        )

        axis.axis("off")

    figure.suptitle(
        title,
        fontsize=15,
    )

    figure.tight_layout()

    figure.savefig(
        output_path,
        dpi=300,
        bbox_inches="tight",
    )

    plt.close(figure)


# =========================================================
# Main analysis
# =========================================================

def run_analysis() -> None:
    device = torch.device(
        "cuda"
        if torch.cuda.is_available()
        else "cpu"
    )

    print(f"Evaluation device: {device}")

    if device.type == "cuda":
        print(
            f"GPU: {torch.cuda.get_device_name(0)}"
        )

    train_set = MedicalLandmarkDataset(
        mode="train"
    )

    test_set = MedicalLandmarkDataset(
        mode="test",
        stats=train_set.stats,
    )

    loader = DataLoader(
        test_set,
        batch_size=1,
        shuffle=False,
        num_workers=0,
    )

    stats = train_set.stats

    model = MultiTaskResNet(
        num_classes=4
    ).to(device)

    model_path = find_checkpoint()

    print(f"Checkpoint: {model_path}")

    load_compatible_checkpoint(
        model=model,
        model_path=model_path,
        device=device,
    )

    model.eval()

    records = []
    correct_classifications = 0

    print(
        f"\nTesting on {len(test_set)} unseen images..."
    )

    with torch.no_grad():
        for sample_index, (
            images,
            labels,
            coordinates,
        ) in enumerate(loader):
            images = images.to(device)
            labels = labels.to(device)
            coordinates = coordinates.to(device)

            classification_output, regression_output = model(
                images
            )

            predicted_labels = (
                classification_output.argmax(dim=1)
            )

            true_label = int(labels.item())
            predicted_label = int(
                predicted_labels.item()
            )

            class_correct = (
                true_label == predicted_label
            )

            if class_correct:
                correct_classifications += 1

            predicted_normalized = (
                regression_output
                .detach()
                .cpu()
                .numpy()[0]
            )

            target_normalized = (
                coordinates
                .detach()
                .cpu()
                .numpy()[0]
            )

            predicted_mm = denormalize_coordinates(
                predicted_normalized,
                stats,
            )

            target_mm = denormalize_coordinates(
                target_normalized,
                stats,
            )

            signed_difference_mm = (
                normalized_difference_to_mm(
                    predicted_normalized,
                    target_normalized,
                    stats,
                )
            )

            absolute_difference_mm = np.abs(
                signed_difference_mm
            )

            spatial_error_mm = float(
                np.linalg.norm(
                    signed_difference_mm
                )
            )

            records.append(
                {
                    "sample_index": sample_index,
                    "filename": safe_filename(
                        test_set,
                        sample_index,
                    ),
                    "true_label": true_label,
                    "true_landmark_name": landmark_name(
                        true_label
                    ),
                    "predicted_label": predicted_label,
                    "predicted_landmark_name": landmark_name(
                        predicted_label
                    ),
                    "class_correct": class_correct,
                    "target_normalized": (
                        target_normalized
                    ),
                    "predicted_normalized": (
                        predicted_normalized
                    ),
                    "target_mm": target_mm,
                    "predicted_mm": predicted_mm,
                    "signed_difference_mm": (
                        signed_difference_mm
                    ),
                    "absolute_difference_mm": (
                        absolute_difference_mm
                    ),
                    "spatial_error_mm": (
                        spatial_error_mm
                    ),
                    "image": tensor_to_grayscale(
                        images[0]
                    ),
                }
            )

    if not records:
        raise RuntimeError(
            "No test samples were evaluated."
        )

    errors = np.array(
        [
            record["spatial_error_mm"]
            for record in records
        ],
        dtype=np.float64,
    )

    accuracy = (
        100.0
        * correct_classifications
        / len(records)
    )

    mean_error = float(np.mean(errors))
    median_error = float(np.median(errors))
    standard_deviation = float(np.std(errors))
    best_error = float(np.min(errors))
    worst_error = float(np.max(errors))
    percentile_95 = float(
        np.percentile(errors, 95)
    )

    records_worst_to_best = sorted(
        records,
        key=lambda record: (
            record["spatial_error_mm"]
        ),
        reverse=True,
    )

    for rank, record in enumerate(
        records_worst_to_best,
        start=1,
    ):
        record["rank_worst_to_best"] = rank

    best_four = sorted(
        records,
        key=lambda record: (
            record["spatial_error_mm"]
        ),
    )[:NUM_VISUALIZED]

    worst_four = records_worst_to_best[
        :NUM_VISUALIZED
    ]

    # =====================================================
    # Save per-image CSV
    # =====================================================

    analysis_csv = (
        LOG_DIR / "test_error_analysis.csv"
    )

    fieldnames = [
        "rank_worst_to_best",
        "sample_index",
        "filename",
        "true_label",
        "true_landmark",
        "predicted_label",
        "predicted_landmark",
        "class_correct",
        "target_x_mm",
        "target_y_mm",
        "target_z_mm",
        "predicted_x_mm",
        "predicted_y_mm",
        "predicted_z_mm",
        "signed_error_x_mm",
        "signed_error_y_mm",
        "signed_error_z_mm",
        "absolute_error_x_mm",
        "absolute_error_y_mm",
        "absolute_error_z_mm",
        "spatial_error_mm",
    ]

    with analysis_csv.open(
        "w",
        newline="",
        encoding="utf-8",
    ) as file:
        writer = csv.DictWriter(
            file,
            fieldnames=fieldnames,
        )

        writer.writeheader()

        for record in records_worst_to_best:
            writer.writerow(
                {
                    "rank_worst_to_best": (
                        record[
                            "rank_worst_to_best"
                        ]
                    ),
                    "sample_index": (
                        record["sample_index"]
                    ),
                    "filename": (
                        record["filename"]
                    ),
                    "true_label": (
                        record["true_label"]
                    ),
                    "true_landmark": (
                        record[
                            "true_landmark_name"
                        ]
                    ),
                    "predicted_label": (
                        record["predicted_label"]
                    ),
                    "predicted_landmark": (
                        record[
                            "predicted_landmark_name"
                        ]
                    ),
                    "class_correct": (
                        record["class_correct"]
                    ),
                    "target_x_mm": (
                        f'{record["target_mm"][0]:.6f}'
                    ),
                    "target_y_mm": (
                        f'{record["target_mm"][1]:.6f}'
                    ),
                    "target_z_mm": (
                        f'{record["target_mm"][2]:.6f}'
                    ),
                    "predicted_x_mm": (
                        f'{record["predicted_mm"][0]:.6f}'
                    ),
                    "predicted_y_mm": (
                        f'{record["predicted_mm"][1]:.6f}'
                    ),
                    "predicted_z_mm": (
                        f'{record["predicted_mm"][2]:.6f}'
                    ),
                    "signed_error_x_mm": (
                        f'{record["signed_difference_mm"][0]:.6f}'
                    ),
                    "signed_error_y_mm": (
                        f'{record["signed_difference_mm"][1]:.6f}'
                    ),
                    "signed_error_z_mm": (
                        f'{record["signed_difference_mm"][2]:.6f}'
                    ),
                    "absolute_error_x_mm": (
                        f'{record["absolute_difference_mm"][0]:.6f}'
                    ),
                    "absolute_error_y_mm": (
                        f'{record["absolute_difference_mm"][1]:.6f}'
                    ),
                    "absolute_error_z_mm": (
                        f'{record["absolute_difference_mm"][2]:.6f}'
                    ),
                    "spatial_error_mm": (
                        f'{record["spatial_error_mm"]:.6f}'
                    ),
                }
            )

    # =====================================================
    # Save per-landmark statistics
    # =====================================================

    landmark_csv = (
        LOG_DIR / "landmark_statistics.csv"
    )

    with landmark_csv.open(
        "w",
        newline="",
        encoding="utf-8",
    ) as file:
        fieldnames = [
            "landmark",
            "count",
            "classification_accuracy_percent",
            "mean_error_mm",
            "median_error_mm",
            "std_error_mm",
            "best_error_mm",
            "worst_error_mm",
            "p95_error_mm",
        ]

        writer = csv.DictWriter(
            file,
            fieldnames=fieldnames,
        )

        writer.writeheader()

        for landmark_index in range(4):
            landmark_records = [
                record
                for record in records
                if record["true_label"]
                == landmark_index
            ]

            if not landmark_records:
                continue

            landmark_errors = np.array(
                [
                    record["spatial_error_mm"]
                    for record
                    in landmark_records
                ],
                dtype=np.float64,
            )

            landmark_correct = sum(
                record["class_correct"]
                for record
                in landmark_records
            )

            landmark_accuracy = (
                100.0
                * landmark_correct
                / len(landmark_records)
            )

            writer.writerow(
                {
                    "landmark": landmark_name(
                        landmark_index
                    ),
                    "count": len(
                        landmark_records
                    ),
                    "classification_accuracy_percent": (
                        f"{landmark_accuracy:.6f}"
                    ),
                    "mean_error_mm": (
                        f"{np.mean(landmark_errors):.6f}"
                    ),
                    "median_error_mm": (
                        f"{np.median(landmark_errors):.6f}"
                    ),
                    "std_error_mm": (
                        f"{np.std(landmark_errors):.6f}"
                    ),
                    "best_error_mm": (
                        f"{np.min(landmark_errors):.6f}"
                    ),
                    "worst_error_mm": (
                        f"{np.max(landmark_errors):.6f}"
                    ),
                    "p95_error_mm": (
                        f"{np.percentile(landmark_errors, 95):.6f}"
                    ),
                }
            )

    # =====================================================
    # Save plots
    # =====================================================

    figure = plt.figure(
        figsize=(8, 5)
    )

    plt.hist(
        errors,
        bins=min(
            10,
            max(5, len(errors)),
        ),
    )

    plt.axvline(
        mean_error,
        linestyle="--",
        label=(
            f"Mean: {mean_error:.2f} mm"
        ),
    )

    plt.axvline(
        median_error,
        linestyle=":",
        label=(
            f"Median: {median_error:.2f} mm"
        ),
    )

    plt.xlabel(
        "3D spatial error (mm)"
    )

    plt.ylabel(
        "Number of test samples"
    )

    plt.title(
        "Test-set spatial error distribution"
    )

    plt.legend()
    plt.tight_layout()

    plt.savefig(
        LOG_DIR / "error_histogram.png",
        dpi=300,
        bbox_inches="tight",
    )

    plt.close(figure)

    coordinate_errors = [
        [
            record[
                "absolute_difference_mm"
            ][axis_index]
            for record in records
        ]
        for axis_index in range(3)
    ]

    figure = plt.figure(
        figsize=(7, 5)
    )

    plt.boxplot(
        coordinate_errors,
        tick_labels=["X", "Y", "Z"],
    )

    plt.xlabel(
        "Coordinate axis"
    )

    plt.ylabel(
        "Absolute error (mm)"
    )

    plt.title(
        "Coordinate-wise absolute error"
    )

    plt.tight_layout()

    plt.savefig(
        LOG_DIR
        / "coordinate_error_boxplot.png",
        dpi=300,
        bbox_inches="tight",
    )

    plt.close(figure)

    save_prediction_grid(
        best_four,
        LOG_DIR / "best_4_predictions.png",
        "Best four test predictions",
    )

    save_prediction_grid(
        worst_four,
        LOG_DIR / "worst_4_predictions.png",
        "Worst four test predictions",
    )

    # =====================================================
    # Console report
    # =====================================================

    print()
    print("=" * 72)
    print("C-ARM TEST-SET ERROR ANALYSIS")
    print("=" * 72)

    print(
        f"Test samples              : "
        f"{len(records)}"
    )

    print(
        f"Classification accuracy   : "
        f"{accuracy:.2f}%"
    )

    print(
        f"Mean spatial error        : "
        f"{mean_error:.2f} mm"
    )

    print(
        f"Median spatial error      : "
        f"{median_error:.2f} mm"
    )

    print(
        f"Standard deviation        : "
        f"{standard_deviation:.2f} mm"
    )

    print(
        f"Best spatial error        : "
        f"{best_error:.2f} mm"
    )

    print(
        f"Worst spatial error       : "
        f"{worst_error:.2f} mm"
    )

    print(
        f"95th percentile           : "
        f"{percentile_95:.2f} mm"
    )

    print()
    print("BEST FOUR SAMPLES")
    print("-" * 72)

    for rank, record in enumerate(
        best_four,
        start=1,
    ):
        print(
            f'{rank}. '
            f'{record["filename"]} | '
            f'{record["true_landmark_name"]} | '
            f'{record["spatial_error_mm"]:.2f} mm'
        )

    print()
    print("WORST FOUR SAMPLES")
    print("-" * 72)

    for rank, record in enumerate(
        worst_four,
        start=1,
    ):
        print(
            f'{rank}. '
            f'{record["filename"]} | '
            f'{record["true_landmark_name"]} | '
            f'{record["spatial_error_mm"]:.2f} mm'
        )

    print()
    print("FILES SAVED")
    print("-" * 72)

    saved_paths = [
        analysis_csv,
        landmark_csv,
        LOG_DIR / "error_histogram.png",
        LOG_DIR
        / "coordinate_error_boxplot.png",
        LOG_DIR / "best_4_predictions.png",
        LOG_DIR / "worst_4_predictions.png",
    ]

    for saved_path in saved_paths:
        print(saved_path)

    print("=" * 72)


if __name__ == "__main__":
    run_analysis()
