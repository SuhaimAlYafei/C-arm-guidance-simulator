import os
import replicate
import requests
import time

# 1. Configuration

API_TOKEN = os.environ.get("REPLICATE_API_TOKEN", "r8_ZJSnzXhKv3yjRhDpSVDGthRy4evVNtA4Y8Z5b")
if not API_TOKEN:
    print("Error: Set REPLICATE_API_TOKEN environment variable.")
    exit()

# Start naming after your last existing file (case-1043)
START_CASE_ID = 1044
BASE_DIR = "data/Landmarks"

# Define what needs to be generated
# format: (folder_name, anatomical_prompt, count_needed)
targets = [
    ("2", "Left Humeral Head (Shoulder Joint), patient's left side", 8),
    ("3", "Right Humeral Head (Shoulder Joint), patient's right side", 9)
]

def generate_and_save(prompt, save_path):
    full_prompt = (
        f"A professional medical 2D fluoroscopy X-ray, 2K resolution, grayscale. "
        f"Anatomical focus: {prompt}. "
        f"Features: High contrast bone definition, clinical grain, clear view of the joint."
    )
    
    print(f"Generating: {prompt}...")
    try:
        output = replicate.run(
            "google/nano-banana-pro",
            input={
                "prompt": full_prompt,
                "resolution": "2K",
                "output_format": "png",
                "safety_filter_level": "block_only_high"
            }
        )
        
        if output and output.url:
            img_data = requests.get(output.url, timeout=30).content
            with open(save_path, 'wb') as f:
                f.write(img_data)
            print(f" -> Saved to {save_path}")
            return True
            
    except Exception as e:
        print(f" -> Error: {e}")
        return False

# 2. Main Loop
current_id = START_CASE_ID

print(f"Starting targeted generation for {sum(t[2] for t in targets)} images...")
print("Note: A 15-second delay is added between images for API rate limits.\n")

for folder, anatomy, count in targets:
    folder_path = os.path.join(BASE_DIR, folder)
    os.makedirs(folder_path, exist_ok=True)
    
    print(f"--- Filling Folder {folder}: Need {count} images ---")
    
    generated_in_folder = 0
    while generated_in_folder < count:
        filename = f"case-{current_id}.png"
        full_path = os.path.join(folder_path, filename)
        
        if generate_and_save(anatomy, full_path):
            generated_in_folder += 1
            current_id += 1
            # Sleep to respect free tier limits
            time.sleep(15)
        else:
            print("Retrying due to error...")
            time.sleep(5)

print(f"\nCompleted. Dataset balanced. Last Case ID used: {current_id - 1}")