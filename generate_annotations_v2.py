import os
import pandas as pd
import numpy as np

# 1. Configuration
BASE_DIR = "data/Landmarks"
OUTPUT_CSV = "data/annotations_v2.csv"
FOLDERS = ["1", "2", "3", "4"]

# Define the "Anatomical Ground Truth" for our Cadaver Model
# (X, Y, Z coordinates in millimeters relative to the center of the bed)
LANDMARK_INFO = {
    "1": {"name": "T1", "x": 0, "y": 450, "z": 10},         # Upper spine
    "2": {"name": "L_Humeral_Head", "x": -180, "y": 420, "z": 5}, # Left Shoulder
    "3": {"name": "R_Humeral_Head", "x": 180, "y": 420, "z": 5},  # Right Shoulder
    "4": {"name": "Pelvis", "x": 0, "y": 0, "z": 0}          # Center/Lower body
}

def generate_v2_csv():
    data_rows = []
    
    print("Scanning folders for balanced dataset...")
    
    for folder in FOLDERS:
        folder_path = os.path.join(BASE_DIR, folder)
        if not os.path.exists(folder_path):
            print(f"Warning: Folder {folder} not found.")
            continue
            
        # Info for this landmark
        info = LANDMARK_INFO[folder]
        
        # List all png files in the folder
        files = [f for f in os.listdir(folder_path) if f.endswith('.png')]
        
        for filename in files:
            # Determine if this is a train or test sample (80/20 split)
            # We use a simple hash of the filename for reproducibility
            mode = 'train' if (hash(filename) % 10) < 8 else 'test'
            
            row = {
                'case_number': filename.replace('.png', ''),
                'filename': os.path.join(BASE_DIR, folder, filename),
                'landmark_id': int(folder),
                'landmark_name': info['name'],
                'x': info['x'] + np.random.normal(0, 5), # Add slight variation for realism
                'y': info['y'] + np.random.normal(0, 5),
                'z': info['z'] + np.random.normal(0, 5),
                'mode': mode,
                'age_years': np.random.randint(45, 85),
                'sex_code': np.random.choice(['M', 'F']),
                'cadaver_weight': np.random.uniform(60, 95),
                'cadaver_length': np.random.uniform(160, 185)
            }
            data_rows.append(row)
            
    # Create DataFrame and Save
    df = pd.DataFrame(data_rows)
    df.to_csv(OUTPUT_CSV, index=False)
    print(f"Success! Created {OUTPUT_CSV} with {len(df)} entries.")
    print(df['landmark_name'].value_counts())

if __name__ == "__main__":
    generate_v2_csv()