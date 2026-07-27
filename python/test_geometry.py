from pathlib import Path

from bridge.geometry import load_geometry


files = [
    Path(r"C:\Users\suhai\Downloads\AP.json"),
    Path(r"C:\Users\suhai\Downloads\Cranial.json"),
    Path(r"C:\Users\suhai\Downloads\Caudal.json"),
    Path(r"C:\Users\suhai\Downloads\Left Oblique (1).json"),
    Path(r"C:\Users\suhai\Downloads\Lateral.json"),
    Path(r"C:\Users\suhai\Downloads\Combined (1).json"),
]


for json_path in files:
    print("=" * 70)
    print(json_path.name)

    geometry = load_geometry(json_path)

    print("Source:", geometry.source_position)
    print("Detector:", geometry.detector_center)
    print("Detector X:", geometry.detector_x)
    print("Detector Y:", geometry.detector_y)
    print("Beam:", geometry.detector_normal)
    print("SDD:", geometry.sdd)
    print("Detector size:", geometry.detector_size_mm)

print("=" * 70)
print("All geometry files passed validation.")