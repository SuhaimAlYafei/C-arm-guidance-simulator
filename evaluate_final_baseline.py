import sys
import os

# Add the 'src' directory to the python path so it can find dataset.py
sys.path.append(os.path.join(os.path.dirname(__file__), 'src'))

import torch
import numpy as np
from torch.utils.data import DataLoader
from src.dataset import MedicalLandmarkDataset
from src.train_landmark_regression import MultiTaskResNet


def run_test():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    # =====================================================
    # Load training statistics and use them for the test set
    # =====================================================
    train_set = MedicalLandmarkDataset(mode='train')
    test_set = MedicalLandmarkDataset(
        mode='test',
        stats=train_set.stats
    )

    loader = DataLoader(test_set, batch_size=1)
    stats = train_set.stats

    # =====================================================
    # Load trained model
    # =====================================================
    model = MultiTaskResNet(num_classes=4).to(device)

    model_path = os.path.join("logs", "best_multitask_model.pth")

    if not os.path.exists(model_path):
        print(f"Error: Could not find model at {model_path}")
        return

    model.load_state_dict(torch.load(model_path, map_location=device))
    model.eval()

    results = []
    correct_part = 0

    print(f"Testing on {len(test_set)} unseen images...")

    with torch.no_grad():
        for imgs, labels, coords in loader:

            imgs = imgs.to(device)
            labels = labels.to(device)
            coords = coords.to(device)

            out_cls, out_reg = model(imgs)

            # Classification accuracy
            _, pred_id = torch.max(out_cls, 1)

            if pred_id.item() == labels.item():
                correct_part += 1

            # Predicted normalized coordinates
            pred = out_reg.cpu().numpy()[0]

            # Ground truth normalized coordinates
            gt = coords.cpu().numpy()[0]

            # Convert back to millimeters using TRAIN statistics
            err_x = abs(pred[0] - gt[0]) * stats["x_std"]
            err_y = abs(pred[1] - gt[1]) * stats["y_std"]
            err_z = abs(pred[2] - gt[2]) * stats["z_std"]

            distance_mm = np.sqrt(
                err_x ** 2 +
                err_y ** 2 +
                err_z ** 2
            )

            results.append(distance_mm)

    accuracy = 100 * correct_part / len(test_set)
    mean_error = np.mean(results)
    best_error = np.min(results)

    print("\n--- CONFERENCE RESULTS ---")
    print(f"Anatomical ID Accuracy: {accuracy:.1f}%")
    print(f"Mean Spatial Error: {mean_error:.2f} mm")
    print(f"Best Case Precision: {best_error:.2f} mm")
    print("--------------------------")


if __name__ == "__main__":
    run_test()