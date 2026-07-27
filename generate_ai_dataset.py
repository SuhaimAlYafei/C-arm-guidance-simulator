import os
import replicate
import pandas as pd
import requests
from tqdm import tqdm
import time

# Verify Token
api_token = os.environ.get("REPLICATE_API_TOKEN")
if not api_token:
    print("ERROR: REPLICATE_API_TOKEN is missing!")
    exit()

df = pd.read_csv('data/annotations.csv')

def paint_xray(row):
    prompt = (
        f"A professional medical 2D fluoroscopy X-ray, 2K resolution, grayscale. "
        f"Subject: {row['sex_code']} patient, age {row['age_years']}. "
        f"Anatomical focus: {row['part']} body skeletal landmarks. "
        f"Features: High contrast, clinical grain, sharp bone definition, realistic density."
    )

    try:
        output = replicate.run(
            "google/nano-banana-pro",
            input={
                "prompt": prompt,
                "resolution": "2K",
                "aspect_ratio": "1:1",
                "output_format": "png",
                "safety_filter_level": "block_only_high"
            }
        )

        if output:
            image_url = output.url
            img_data = requests.get(image_url, timeout=20).content
            os.makedirs(os.path.dirname(row['filename']), exist_ok=True)
            with open(row['filename'], 'wb') as f:
                f.write(img_data)
            return True
    except Exception as e:
        print(f"\nError on {row['case_number']}: {e}")
        return False

# Full Loop with Resume Logic
print("Starting Full Dataset Generation (Resuming where left off)...")
success_count = 0
for i, row in tqdm(df.iterrows(), total=len(df)):
    # SKIP if file already exists and is not empty
    if os.path.exists(row['filename']) and os.path.getsize(row['filename']) > 0:
        continue
        
    if paint_xray(row):
        success_count += 1
    
    time.sleep(20) 

print(f"\nGeneration complete. Added {success_count} new images to the dataset.")