import os
import sys

import numpy as np
import torch
from torch.utils.data import DataLoader


# =========================================================
# Project paths
# =========================================================
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))

if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)


from src.dataset import MedicalLandmarkDataset
from src.train_landmark_regression import MultiTaskResNet


# =========================================================
# Checkpoint compatibility loader
# =========================================================
def load_compatible_checkpoint(
    model: torch.nn.Module,
    model_path: str,
    device: torch.device,
) -> None:
    """
    Load checkpoints saved with either naming convention:

    Convention 1:
        classifier.weight
        classifier.bias
        regressor.weight
        regressor.bias

    Convention 2:
        classification_head.weight
        classification_head.bias
        regression_head.weight
        regression_head.bias
    """

    checkpoint = torch.load(
        model_path,
        map_location=device,
        weights_only=True,
    )

    # Support checkpoints saved inside a dictionary.
    if (
        isinstance(checkpoint, dict)
        and "model_state_dict" in checkpoint
    ):
        checkpoint = checkpoint["model_state_dict"]

    if not isinstance(checkpoint, dict):
        raise TypeError(
            "The checkpoint does not contain a valid state dictionary."
        )

    # Remove DataParallel prefix if one exists.
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

    # Convert checkpoint head names to model classifier names.
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

    # Convert checkpoint classifier names to model head names.
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

    try:
        model.load_state_dict(
            state_dict,
            strict=True,
        )

    except RuntimeError as error:
        print("\nCheckpoint loading failed.")
        print(f"Checkpoint path: {model_path}")

        print("\nModel head keys:")

        for key in model.state_dict().keys():
            if any(
                term in key
                for term in [
                    "classifier",
                    "regressor",
                    "classification_head",
                    "regression_head",
                ]
            ):
                print(f"  {key}")

        print("\nCheckpoint head keys:")

        for key in state_dict.keys():
            if any(
                term in key
                for term in [
                    "classifier",
                    "regressor",
                    "classification_head",
                    "regression_head",
                ]
            ):
                print(f"  {key}")

        raise error


# =========================================================
# Evaluation
# =========================================================
def run_test() -> None:
    device = torch.device(
        "cuda" if torch.cuda.is_available() else "cpu"
    )

    print(f"Evaluation device: {device}")

    if device.type == "cuda":
        print(
            f"GPU: {torch.cuda.get_device_name(0)}"
        )

    # =====================================================
    # Load training statistics
    # =====================================================
    train_set = MedicalLandmarkDataset(
        mode="train"
    )

    # Use training statistics for the test dataset.
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
            f"Error: Could not find model at:\n{model_path}"
        )
        return

    load_compatible_checkpoint(
        model=model,
        model_path=model_path,
        device=device,
    )

    model.eval()

    spatial_errors = []
    correct_classifications = 0

    print(
        f"\nTesting on {len(test_set)} unseen images..."
    )

    # =====================================================
    # Inference loop
    # =====================================================
    with torch.no_grad():
        for images, labels, coordinates in loader:
            images = images.to(device)
            labels = labels.to(device)
            coordinates = coordinates.to(device)

            classification_output, regression_output = model(
                images
            )

            predicted_labels = classification_output.argmax(
                dim=1
            )

            correct_classifications += (
                predicted_labels == labels
            ).sum().item()

            predicted_normalized = (
                regression_output
                .detach()
                .cpu()
                .numpy()[0]
            )

            ground_truth_normalized = (
                coordinates
                .detach()
                .cpu()
                .numpy()[0]
            )

            # Convert normalized coordinate differences to mm.
            difference_mm = np.array(
                [
                    (
                        predicted_normalized[0]
                        - ground_truth_normalized[0]
                    )
                    * stats["x_std"],

                    (
                        predicted_normalized[1]
                        - ground_truth_normalized[1]
                    )
                    * stats["y_std"],

                    (
                        predicted_normalized[2]
                        - ground_truth_normalized[2]
                    )
                    * stats["z_std"],
                ],
                dtype=np.float64,
            )

            distance_mm = float(
                np.linalg.norm(difference_mm)
            )

            spatial_errors.append(distance_mm)

    # =====================================================
    # Metrics
    # =====================================================
    if len(spatial_errors) == 0:
        print("Error: No test samples were evaluated.")
        return

    accuracy = (
        100.0
        * correct_classifications
        / len(test_set)
    )

    mean_error = float(
        np.mean(spatial_errors)
    )

    median_error = float(
        np.median(spatial_errors)
    )

    standard_deviation = float(
        np.std(spatial_errors)
    )

    best_error = float(
        np.min(spatial_errors)
    )

    worst_error = float(
        np.max(spatial_errors)
    )

    percentile_95 = float(
        np.percentile(spatial_errors, 95)
    )

    # =====================================================
    # Results
    # =====================================================
    print("\n--- CONFERENCE RESULTS ---")

    print(
        f"Anatomical ID Accuracy: "
        f"{accuracy:.1f}%"
    )

    print(
        f"Mean Spatial Error: "
        f"{mean_error:.2f} mm"
    )

    print(
        f"Median Spatial Error: "
        f"{median_error:.2f} mm"
    )

    print(
        f"Spatial Error Standard Deviation: "
        f"{standard_deviation:.2f} mm"
    )

    print(
        f"Best Case Precision: "
        f"{best_error:.2f} mm"
    )

    print(
        f"Worst Case Error: "
        f"{worst_error:.2f} mm"
    )

    print(
        f"95th Percentile Error: "
        f"{percentile_95:.2f} mm"
    )

    print("--------------------------")


if __name__ == "__main__":
    run_test()