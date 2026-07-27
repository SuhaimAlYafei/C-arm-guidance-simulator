import torch
import torch.nn as nn
import torch.optim as optim
from torchvision import models
from torch.utils.data import DataLoader
from tqdm import tqdm
import os

# Import the dataset class from your local file
from dataset import MedicalLandmarkDataset 

class MultiTaskResNet(nn.Module):
    def __init__(self, num_classes=4):
        super(MultiTaskResNet, self).__init__()
        self.backbone = models.resnet34(weights='IMAGENET1K_V1')
        in_feats = self.backbone.fc.in_features
        self.backbone.fc = nn.Identity() 
        
        self.classifier = nn.Linear(in_feats, num_classes)
        self.regressor = nn.Linear(in_feats, 3)

    def forward(self, x):
        features = self.backbone(x)
        return self.classifier(features), self.regressor(features)

def train():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = MultiTaskResNet(num_classes=4).to(device)
    
    # Using the updated dataset logic
    train_loader = DataLoader(MedicalLandmarkDataset(mode='train'), batch_size=4, shuffle=True)
    
    criterion_cls = nn.CrossEntropyLoss()
    criterion_reg = nn.MSELoss()
    optimizer = optim.Adam(model.parameters(), lr=1e-4)

    os.makedirs("logs", exist_ok=True)
    print(f"Training started on {device}...")

    for epoch in range(150):
        model.train()
        epoch_loss = 0
        
        for imgs, labels, coords in tqdm(train_loader, desc=f"Epoch {epoch}"):
            imgs, labels, coords = imgs.to(device), labels.to(device), coords.to(device)
            
            optimizer.zero_grad()
            out_cls, out_reg = model(imgs)
            
            loss_cls = criterion_cls(out_cls, labels)
            loss_reg = criterion_reg(out_reg, coords)
            
            # Joint optimization
            loss = loss_cls + loss_reg
            loss.backward()
            optimizer.step()
            epoch_loss += loss.item()
            
        print(f"Epoch {epoch} | Average Loss: {epoch_loss/len(train_loader):.4f}")
        
    torch.save(model.state_dict(), "logs/best_multitask_model.pth")
    print("Training complete. Model saved to logs/best_multitask_model.pth")

if __name__ == "__main__":
    train()