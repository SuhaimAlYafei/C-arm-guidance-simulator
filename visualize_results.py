import os
import sys

import matplotlib.pyplot as plt
import numpy as np
import torch


# =========================================================
# Project setup
# =========================================================
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))

if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)


from src.dataset import MedicalLandmarkDataset
from src.train_landmark_regression import MultiTaskResNet


LANDMARK_NAMES = {
    0: "T1",
    1: "Left Shoulder",
    2: "Right Shoulder",
    3: "Pelvis",
}


# =========================================================
# Compatible checkpoint loader
# =========================================================
def load_compatible_checkpoint(
    model: torch.nn.Module,
    model_path: str,
    device: torch.device,
) -> None:
    """
    Supports checkpoints using either:

    classifier / regressor

    or:

    classification_head / regression_head
    """

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
            "Checkpoint does not contain a valid state dictionary."
        )

    state_dict = {}

    for key, value in checkpoint.items():
        clean_key = key

        if clean_key.startswith("module."):
            clean_key = clean_key[len("module."):]

        state_dict[clean_key] = value

    model_keys = set(model.state_dict().keys())

    model_uses_old_names = (
        "classifier.weight" in model_keys
        and "regressor.weight" in model_keys
    )

    model_uses_new_names = (
        "classification_head.weight" in model_keys
        and "regression_head.weight" in model_keys
    )

    checkpoint_uses_old_names = (
        "classifier.weight" in state_dict
        and "regressor.weight" in state_dict
    )

    checkpoint_uses_new_names = (
        "classification_head.weight" in state_dict
        and "regression_head.weight" in state_dict
    )

    if model_uses_old_names and checkpoint_uses_new_names:
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
            "Checkpoint keys converted to "
            "classifier/regressor format."
        )

    elif model_uses_new_names and checkpoint_uses_old_names:
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
            "Checkpoint keys converted to "
            "classification_head/regression_head format."
        )

    model.load_state_dict(
        state_dict,
        strict=True,
    )


# =========================================================
# Retrieve filename when possible
# =========================================================
def get_sample_filename(
    dataset,
    index: int,
) -> str:
    possible_attributes = [
        "df",
        "data",
        "annotations",
        "samples",
        "records",
    ]

    possible_columns = [
        "filename",
        "file_name",
        "image",
        "image_name",
        "image_path",
        "filepath",
        "path",
    ]

    for attribute_name in possible_attributes:
        if not hasattr(dataset, attribute_name):
            continue

        dataset_data = getattr(
            dataset,
            attribute_name,
        )

        if hasattr(dataset_data, "iloc"):
            try:
                row = dataset_data.iloc[index]

                for column_name in possible_columns:
                    if column_name in row.index:
                        return os.path.basename(
                            str(row[column_name])
                        )

            except Exception:
                pass

        if isinstance(dataset_data, list):
            try:
                row = dataset_data[index]

                if isinstance(row, dict):
                    for column_name in possible_columns:
                        if column_name in row:
                            return os.path.basename(
                                str(row[column_name])
                            )

            except Exception:
                pass

    return f"Test Sample {index + 1:02d}"


# =========================================================
# Convert normalized image to grayscale
# =========================================================
def tensor_to_grayscale(
    image_tensor: torch.Tensor,
) -> np.ndarray:
    image = (
        image_tensor
        .detach()
        .cpu()
        .permute(1, 2, 0)
        .numpy()
    )

    image = (
        image
        * np.array([0.229, 0.224, 0.225])
        + np.array([0.485, 0.456, 0.406])
    )

    image = np.clip(
        image,
        0,
        1,
    )

    grayscale = (
        0.299 * image[:, :, 0]
        + 0.587 * image[:, :, 1]
        + 0.114 * image[:, :, 2]
    )

    return grayscale


# =========================================================
# Visualization
# =========================================================
def visualize_inference(
    num_samples: int = 8,
    random_samples: bool = False,
    sort_by_error: bool = True,
) -> None:
    device = torch.device(
        "cuda" if torch.cuda.is_available() else "cpu"
    )

    print(f"Visualization device: {device}")

    if device.type == "cuda":
        print(
            f"GPU: {torch.cuda.get_device_name(0)}"
        )

    # =====================================================
    # Load data using training statistics
    # =====================================================
    train_set = MedicalLandmarkDataset(
        mode="train"
    )

    test_set = MedicalLandmarkDataset(
        mode="test",
        stats=train_set.stats,
    )

    stats = train_set.stats

    # =====================================================
    # Load model
    # =====================================================
    model = MultiTaskResNet(
        num_classes=4
    ).to(device)

    model_path = os.path.join(
        PROJECT_ROOT,
        "logs",
        "best_multitask_model.pth",
    )

    if not os.path.exists(model_path):
        print(
            f"Error: model not found at:\n{model_path}"
        )
        return

    load_compatible_checkpoint(
        model=model,
        model_path=model_path,
        device=device,
    )

    model.eval()

    # =====================================================
    # Run inference on every test image first
    # =====================================================
    inference_results = []

    print(
        f"\nRunning inference on "
        f"{len(test_set)} test images..."
    )

    with torch.no_grad():
        for sample_index in range(len(test_set)):
            image_tensor, true_label, true_coordinates = (
                test_set[sample_index]
            )

            input_batch = (
                image_tensor
                .unsqueeze(0)
                .to(device)
            )

            class_output, regression_output = model(
                input_batch
            )

            predicted_class = int(
                class_output.argmax(dim=1).item()
            )

            true_class = int(
                true_label.item()
            )

            predicted_normalized = (
                regression_output
                .detach()
                .cpu()
                .numpy()[0]
            )

            true_normalized = (
                true_coordinates
                .detach()
                .cpu()
                .numpy()
            )

            predicted_mm = np.array(
                [
                    predicted_normalized[0]
                    * stats["x_std"]
                    + stats["x_mean"],

                    predicted_normalized[1]
                    * stats["y_std"]
                    + stats["y_mean"],

                    predicted_normalized[2]
                    * stats["z_std"]
                    + stats["z_mean"],
                ],
                dtype=np.float64,
            )

            true_mm = np.array(
                [
                    true_normalized[0]
                    * stats["x_std"]
                    + stats["x_mean"],

                    true_normalized[1]
                    * stats["y_std"]
                    + stats["y_mean"],

                    true_normalized[2]
                    * stats["z_std"]
                    + stats["z_mean"],
                ],
                dtype=np.float64,
            )

            spatial_error_mm = float(
                np.linalg.norm(
                    predicted_mm - true_mm
                )
            )

            inference_results.append(
                {
                    "sample_index": sample_index,
                    "filename": get_sample_filename(
                        test_set,
                        sample_index,
                    ),
                    "image_tensor": image_tensor,
                    "true_class": true_class,
                    "predicted_class": predicted_class,
                    "predicted_mm": predicted_mm,
                    "true_mm": true_mm,
                    "error_mm": spatial_error_mm,
                }
            )

    # =====================================================
    # Select which images to display
    # =====================================================
    num_samples = min(
        num_samples,
        len(inference_results),
    )

    if sort_by_error:
        selected_results = sorted(
            inference_results,
            key=lambda item: item["error_mm"],
        )[:num_samples]

        selection_description = (
            f"{num_samples} highest-error test samples"
        )

    elif random_samples:
        selected_indices = np.random.choice(
            len(inference_results),
            size=num_samples,
            replace=False,
        )

        selected_results = [
            inference_results[int(index)]
            for index in selected_indices
        ]

        selection_description = (
            f"{num_samples} random test samples"
        )

    else:
        selected_results = inference_results[:num_samples]

        selection_description = (
            f"first {num_samples} test samples"
        )

    # =====================================================
    # Create figure
    # =====================================================
    columns = min(
        4,
        num_samples,
    )

    rows = int(
        np.ceil(num_samples / columns)
    )

    figure, axes = plt.subplots(
        rows,
        columns,
        figsize=(
            5 * columns,
            5.8 * rows,
        ),
    )

    axes = np.array(
        axes,
        dtype=object,
    ).reshape(-1)

    displayed_errors = []

    for panel_index, result in enumerate(
        selected_results
    ):
        axis = axes[panel_index]

        grayscale_image = tensor_to_grayscale(
            result["image_tensor"]
        )

        axis.imshow(
            grayscale_image,
            cmap="gray",
        )

        true_name = LANDMARK_NAMES.get(
            result["true_class"],
            f"Class {result['true_class']}",
        )

        predicted_name = LANDMARK_NAMES.get(
            result["predicted_class"],
            f"Class {result['predicted_class']}",
        )

        classification_correct = (
            result["true_class"]
            == result["predicted_class"]
        )

        title_color = (
            "green"
            if classification_correct
            else "red"
        )

        status_text = (
            "Correct classification"
            if classification_correct
            else "Incorrect classification"
        )

        axis.set_title(
            f"Predicted: {predicted_name}",
            color=title_color,
            fontsize=13,
            fontweight="bold",
        )

        axis.text(
            0.03,
            0.97,
            f"Target: {true_name}",
            transform=axis.transAxes,
            color="white",
            fontsize=10,
            verticalalignment="top",
            backgroundcolor="black",
        )

        axis.text(
            0.97,
            0.97,
            f"Test #{result['sample_index'] + 1}",
            transform=axis.transAxes,
            color="white",
            fontsize=9,
            horizontalalignment="right",
            verticalalignment="top",
            backgroundcolor="black",
        )

        axis.text(
            0.03,
            0.03,
            f"Spatial error: "
            f"{result['error_mm']:.2f} mm",
            transform=axis.transAxes,
            color="yellow",
            fontsize=11,
            fontweight="bold",
            verticalalignment="bottom",
            backgroundcolor="black",
        )

        axis.text(
            0.97,
            0.03,
            status_text,
            transform=axis.transAxes,
            color="white",
            fontsize=8,
            horizontalalignment="right",
            verticalalignment="bottom",
            backgroundcolor="black",
        )

        axis.set_xlabel(
            result["filename"],
            fontsize=8,
        )

        axis.set_xticks([])
        axis.set_yticks([])

        displayed_errors.append(
            result["error_mm"]
        )

    # Hide unused panels.
    for panel_index in range(
        num_samples,
        len(axes),
    ):
        axes[panel_index].axis("off")

    figure.suptitle(
        "Automated C-Arm Landmark Localization\n"
        f"{selection_description}",
        fontsize=17,
        fontweight="bold",
    )

    figure.text(
        0.5,
        0.01,
        (
            f"Displayed mean error: "
            f"{np.mean(displayed_errors):.2f} mm | "
            f"Model test-set mean error: 29.03 mm"
        ),
        horizontalalignment="center",
        fontsize=10,
    )

    figure.tight_layout(
        rect=[0, 0.03, 1, 0.94]
    )

    output_path = os.path.join(
        PROJECT_ROOT,
        "conference_results_visual.png",
    )

    figure.savefig(
        output_path,
        dpi=300,
        bbox_inches="tight",
    )

    print(
        f"\nVisualization saved to:\n{output_path}"
    )

    print(
        f"Displayed mean spatial error: "
        f"{np.mean(displayed_errors):.2f} mm"
    )

    print(
        f"Displayed worst spatial error: "
        f"{np.max(displayed_errors):.2f} mm"
    )

    plt.show()


if __name__ == "__main__":
    visualize_inference(
        num_samples=4,
        random_samples=False,
        sort_by_error=True,
    )