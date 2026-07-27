import torch
import pandas as pd
from PIL import Image
from torch.utils.data import Dataset
from torchvision import transforms


class MedicalLandmarkDataset(Dataset):
    def __init__(self, mode="train", size=(224, 224), stats=None):
        full_df = pd.read_csv("data/annotations_v2.csv")

        self.df = full_df[full_df["mode"] == mode].reset_index(drop=True)
        self.size = size

        # Always calculate normalization constants from training data
        if stats is None:
            train_df = full_df[full_df["mode"] == "train"]

            self.stats = {
                "x_mean": train_df["x"].mean(),
                "x_std": train_df["x"].std(),
                "y_mean": train_df["y"].mean(),
                "y_std": train_df["y"].std(),
                "z_mean": train_df["z"].mean(),
                "z_std": train_df["z"].std(),
            }
        else:
            self.stats = stats

        self.transform = transforms.Compose(
            [
                transforms.Resize(self.size),
                transforms.ToTensor(),
                transforms.Normalize(
                    mean=[0.485, 0.456, 0.406],
                    std=[0.229, 0.224, 0.225],
                ),
            ]
        )

    def __len__(self):
        return len(self.df)

    def __getitem__(self, idx):
        row = self.df.iloc[idx]

        # Load image
        img_path = str(row["filename"]).replace("\\", "/")
        image = Image.open(img_path).convert("RGB")
        image = self.transform(image)

        # Convert landmark IDs 1–4 into class labels 0–3
        label = torch.tensor(
            int(row["landmark_id"]) - 1,
            dtype=torch.long,
        )

        # Normalize coordinates using training statistics
        x = (row["x"] - self.stats["x_mean"]) / self.stats["x_std"]
        y = (row["y"] - self.stats["y_mean"]) / self.stats["y_std"]
        z = (row["z"] - self.stats["z_mean"]) / self.stats["z_std"]

        coords = torch.tensor(
            [x, y, z],
            dtype=torch.float32,
        )

        return image, label, coords