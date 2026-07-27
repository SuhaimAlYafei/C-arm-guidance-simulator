import os

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader
from torchvision import models
from tqdm import tqdm

from .dataset import MedicalLandmarkDataset


class MultiTaskResNet(nn.Module):
    def __init__(self, num_classes=4):
        super().__init__()

        self.backbone = models.resnet34(
            weights="IMAGENET1K_V1"
        )

        in_features = self.backbone.fc.in_features
        self.backbone.fc = nn.Identity()

        self.classifier = nn.Linear(
            in_features,
            num_classes,
        )

        self.regressor = nn.Linear(
            in_features,
            3,
        )

    def forward(self, x):
        features = self.backbone(x)

        return (
            self.classifier(features),
            self.regressor(features),
        )


def train():
    device = torch.device(
        "cuda"
        if torch.cuda.is_available()
        else "cpu"
    )

    model = MultiTaskResNet(
        num_classes=4
    ).to(device)

    train_dataset = MedicalLandmarkDataset(
        mode="train"
    )

    train_loader = DataLoader(
        train_dataset,
        batch_size=4,
        shuffle=True,
        num_workers=0,
    )

    criterion_cls = nn.CrossEntropyLoss()

    criterion_reg = nn.SmoothL1Loss(
        beta=1.0
    )

    optimizer = optim.Adam(
        model.parameters(),
        lr=1e-4,
    )

    os.makedirs(
        "logs",
        exist_ok=True,
    )

    print(
        f"Training started on {device}..."
    )

    for epoch in range(150):
        model.train()
        epoch_loss = 0.0

        for images, labels, coordinates in tqdm(
            train_loader,
            desc=f"Epoch {epoch}",
        ):
            images = images.to(device)
            labels = labels.to(device)
            coordinates = coordinates.to(device)

            optimizer.zero_grad()

            output_cls, output_reg = model(
                images
            )

            loss_cls = criterion_cls(
                output_cls,
                labels,
            )

            loss_reg = criterion_reg(
                output_reg,
                coordinates,
            )

            loss = loss_cls + loss_reg

            loss.backward()
            optimizer.step()

            epoch_loss += loss.item()

        average_loss = (
            epoch_loss
            / len(train_loader)
        )

        print(
            f"Epoch {epoch} | "
            f"Average Loss: {average_loss:.4f}"
        )

    torch.save(
        model.state_dict(),
        "logs/best_multitask_model.pth",
    )

    print(
        "Training complete. "
        "Model saved to "
        "logs/best_multitask_model.pth"
    )


if __name__ == "__main__":
    train()