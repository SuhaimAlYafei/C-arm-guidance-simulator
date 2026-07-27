
"""
Bias and dataset-balance analysis for the C-arm APAH project.

Place this file in the repository root, then run:

    python analyze_bias.py

Required files:
    data/annotations_v2.csv
    logs/test_error_analysis.csv

Outputs:
    logs/train_landmark_counts.csv
    logs/coordinate_bias_summary.csv
    logs/predicted_vs_true_x.png
    logs/predicted_vs_true_y.png
    logs/predicted_vs_true_z.png
"""

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parent
ANNOTATIONS_PATH = ROOT / "data" / "annotations_v2.csv"
ERRORS_PATH = ROOT / "logs" / "test_error_analysis.csv"
LOG_DIR = ROOT / "logs"


def save_predicted_vs_true_plot(
    dataframe: pd.DataFrame,
    axis_name: str,
) -> None:
    true_column = f"target_{axis_name}_mm"
    predicted_column = f"predicted_{axis_name}_mm"

    figure = plt.figure(figsize=(7, 6))

    for landmark in sorted(dataframe["true_landmark"].unique()):
        subset = dataframe[
            dataframe["true_landmark"] == landmark
        ]

        plt.scatter(
            subset[true_column],
            subset[predicted_column],
            label=landmark,
            s=70,
        )

        for _, row in subset.iterrows():
            plt.annotate(
                row["filename"],
                (
                    row[true_column],
                    row[predicted_column],
                ),
                fontsize=7,
                xytext=(4, 4),
                textcoords="offset points",
            )

    minimum_value = min(
        dataframe[true_column].min(),
        dataframe[predicted_column].min(),
    )

    maximum_value = max(
        dataframe[true_column].max(),
        dataframe[predicted_column].max(),
    )

    plt.plot(
        [minimum_value, maximum_value],
        [minimum_value, maximum_value],
        linestyle="--",
        label="Perfect prediction",
    )

    plt.xlabel(f"True {axis_name.upper()} (mm)")
    plt.ylabel(f"Predicted {axis_name.upper()} (mm)")
    plt.title(
        f"Predicted vs true {axis_name.upper()} coordinate"
    )
    plt.legend()
    plt.tight_layout()

    output_path = (
        LOG_DIR
        / f"predicted_vs_true_{axis_name}.png"
    )

    plt.savefig(
        output_path,
        dpi=300,
        bbox_inches="tight",
    )

    plt.close(figure)

    print(f"Saved: {output_path}")


def main() -> None:
    if not ANNOTATIONS_PATH.exists():
        raise FileNotFoundError(
            f"Could not find:\n{ANNOTATIONS_PATH}"
        )

    if not ERRORS_PATH.exists():
        raise FileNotFoundError(
            f"Could not find:\n{ERRORS_PATH}\n\n"
            "Run analyze_test_errors_v3.py first."
        )

    LOG_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    annotations = pd.read_csv(
        ANNOTATIONS_PATH
    )

    errors = pd.read_csv(
        ERRORS_PATH
    )

    # -----------------------------------------------------
    # 1. Training sample count per landmark
    # -----------------------------------------------------

    train_rows = annotations[
        annotations["mode"].str.lower()
        == "train"
    ].copy()

    train_counts = (
        train_rows["landmark_id"]
        .value_counts()
        .sort_index()
        .rename_axis("landmark_id")
        .reset_index(name="training_count")
    )

    train_counts["landmark"] = (
        "Landmark "
        + train_counts["landmark_id"].astype(str)
    )

    train_counts = train_counts[
        [
            "landmark_id",
            "landmark",
            "training_count",
        ]
    ]

    train_counts_path = (
        LOG_DIR
        / "train_landmark_counts.csv"
    )

    train_counts.to_csv(
        train_counts_path,
        index=False,
    )

    print()
    print("=" * 70)
    print("TRAINING SAMPLE COUNTS")
    print("=" * 70)
    print(train_counts.to_string(index=False))

    # -----------------------------------------------------
    # 2. Inspect case-1017 annotation
    # -----------------------------------------------------

    case_1017 = annotations[
        annotations["filename"]
        .astype(str)
        .str.replace("\\", "/", regex=False)
        .str.endswith("case-1017.png")
    ]

    print()
    print("=" * 70)
    print("CASE-1017 ANNOTATION")
    print("=" * 70)

    if len(case_1017) == 0:
        print("case-1017.png was not found.")
    else:
        columns_to_show = [
            column
            for column in [
                "filename",
                "mode",
                "landmark_id",
                "x",
                "y",
                "z",
            ]
            if column in case_1017.columns
        ]

        print(
            case_1017[
                columns_to_show
            ].to_string(index=False)
        )

    # -----------------------------------------------------
    # 3. Coordinate bias summary by landmark
    # -----------------------------------------------------

    bias_rows = []

    for landmark in sorted(
        errors["true_landmark"].unique()
    ):
        subset = errors[
            errors["true_landmark"] == landmark
        ]

        bias_rows.append(
            {
                "landmark": landmark,
                "count": len(subset),
                "mean_signed_x_error_mm": (
                    subset[
                        "signed_error_x_mm"
                    ].mean()
                ),
                "mean_signed_y_error_mm": (
                    subset[
                        "signed_error_y_mm"
                    ].mean()
                ),
                "mean_signed_z_error_mm": (
                    subset[
                        "signed_error_z_mm"
                    ].mean()
                ),
                "mean_absolute_x_error_mm": (
                    subset[
                        "absolute_error_x_mm"
                    ].mean()
                ),
                "mean_absolute_y_error_mm": (
                    subset[
                        "absolute_error_y_mm"
                    ].mean()
                ),
                "mean_absolute_z_error_mm": (
                    subset[
                        "absolute_error_z_mm"
                    ].mean()
                ),
            }
        )

    bias_summary = pd.DataFrame(
        bias_rows
    )

    bias_summary_path = (
        LOG_DIR
        / "coordinate_bias_summary.csv"
    )

    bias_summary.to_csv(
        bias_summary_path,
        index=False,
    )

    print()
    print("=" * 70)
    print("COORDINATE BIAS BY LANDMARK")
    print("=" * 70)
    print(
        bias_summary.round(2).to_string(
            index=False
        )
    )

    # -----------------------------------------------------
    # 4. Predicted-vs-true plots
    # -----------------------------------------------------

    for axis_name in ["x", "y", "z"]:
        save_predicted_vs_true_plot(
            errors,
            axis_name,
        )

    print()
    print("=" * 70)
    print("FILES SAVED")
    print("=" * 70)
    print(train_counts_path)
    print(bias_summary_path)
    print(
        LOG_DIR
        / "predicted_vs_true_x.png"
    )
    print(
        LOG_DIR
        / "predicted_vs_true_y.png"
    )
    print(
        LOG_DIR
        / "predicted_vs_true_z.png"
    )


if __name__ == "__main__":
    main()
