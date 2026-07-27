import os
import pandas as pd
import numpy as np

# 1. Create Folders
base_path = "data/Landmarks"
for i in range(1, 21):
    os.makedirs(os.path.join(base_path, str(i)), exist_ok=True)

# 2. Generate Placeholder CSV Data
data = []
for i in range(1, 101):  # Generate 100 placeholder rows
    landmark_id = np.random.randint(1, 21)
    case_id = f"case-{1000 + i}"
    filename = f"data/Landmarks/{landmark_id}/{case_id}.png"
    
    # Create an empty dummy image file so the loader finds it
    open(filename, 'a').close() 

    data.append({
        "case_number": case_id,
        "filename": filename,
        "x": np.random.uniform(-300, 300),
        "y": np.random.uniform(-100, 100),
        "z": np.random.uniform(100, 500),
        "part": "upper" if i < 50 else "lower",
        "age_years": np.random.randint(20, 90),
        "sex_code": np.random.choice(["Male", "Female"]),
        "cadaver_weight": np.random.uniform(50, 120),
        "cadaver_length": np.random.uniform(150, 200),
        "mode": "train" if i < 80 else "test"
    })

df = pd.DataFrame(data)
df.to_csv("data/annotations.csv", index=False)
print("Data structure and annotations.csv created successfully!")