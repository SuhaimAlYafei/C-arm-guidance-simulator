from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import torch

from diffdrr.data import read
from diffdrr.drr import DRR
from diffdrr.pose import RigidTransform


SCRIPT_DIR = Path(__file__).resolve().parent

JSON_PATH = SCRIPT_DIR / "sample_2026-07-26T19-41-38-929Z.json"
CT_PATH = Path(r"C:\Users\suhai\Downloads\LIDC_CT.nii.gz")
OUTPUT_DIR = SCRIPT_DIR / "rendered_drr"


# Render at half resolution first because you are using the CPU.
# This preserves the same physical detector field of view:
# 512 × 0.4 mm = 256 × 0.8 mm = 204.8 mm.
RENDER_SCALE = 0.5


def normalize_for_display(image: np.ndarray) -> np.ndarray:
    """Robustly normalize the DRR into the range 0–1."""
    finite = image[np.isfinite(image)]

    if finite.size == 0:
        raise RuntimeError("The renderer returned no finite pixel values.")

    low = float(np.percentile(finite, 0.5))
    high = float(np.percentile(finite, 99.5))

    if high <= low:
        low = float(finite.min())
        high = float(finite.max())

    if high <= low:
        raise RuntimeError("The rendered image has no intensity variation.")

    normalized = np.clip((image - low) / (high - low), 0.0, 1.0)

    # DiffDRR produces line-integral attenuation values.
    # Invert for conventional radiograph-style display.
    return 1.0 - normalized


def load_exposure() -> dict:
    if not JSON_PATH.exists():
        raise FileNotFoundError(f"JSON file not found:\n{JSON_PATH}")

    if not CT_PATH.exists():
        raise FileNotFoundError(f"CT file not found:\n{CT_PATH}")

    with JSON_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)


def validate_transform(matrix: np.ndarray) -> None:
    if matrix.shape != (4, 4):
        raise ValueError(
            f"camera_to_ct_mm must be 4×4, but its shape is {matrix.shape}."
        )

    rotation = matrix[:3, :3]
    determinant = float(np.linalg.det(rotation))
    orthogonality_error = float(
        np.max(np.abs(rotation.T @ rotation - np.eye(3)))
    )

    if not np.allclose(matrix[3], [0.0, 0.0, 0.0, 1.0], atol=1e-6):
        raise ValueError("The final transform row is invalid.")

    if not np.isclose(determinant, 1.0, atol=1e-5):
        raise ValueError(
            f"Rotation is not right-handed. Determinant: {determinant}"
        )

    if orthogonality_error > 1e-5:
        raise ValueError(
            f"Rotation is not orthonormal. Error: {orthogonality_error}"
        )


def main() -> None:
    exposure = load_exposure()
    geometry = exposure["image_geometry"]

    full_width = int(geometry["width_px"])
    full_height = int(geometry["height_px"])

    pixel_spacing = geometry["pixel_spacing_mm"]
    full_delx = float(pixel_spacing[0])
    full_dely = float(pixel_spacing[1])

    sdd = float(geometry["source_to_detector_distance_mm"])

    principal_point = geometry.get(
        "principal_point_px",
        [full_width / 2.0, full_height / 2.0],
    )

    principal_x_px = float(principal_point[0])
    principal_y_px = float(principal_point[1])

    # DiffDRR expects principal-point offsets from the detector center,
    # expressed in millimetres.
    x0_mm = (principal_x_px - full_width / 2.0) * full_delx
    y0_mm = (principal_y_px - full_height / 2.0) * full_dely

    render_width = max(1, round(full_width * RENDER_SCALE))
    render_height = max(1, round(full_height * RENDER_SCALE))

    # Increase pixel size while reducing resolution so the physical
    # detector dimensions remain unchanged.
    render_delx = full_delx / RENDER_SCALE
    render_dely = full_dely / RENDER_SCALE

    camera_to_ct = np.asarray(
        exposure["transforms"]["camera_to_ct_mm"],
        dtype=np.float32,
    )

    validate_transform(camera_to_ct)

    device = torch.device(
        "cuda" if torch.cuda.is_available() else "cpu"
    )

    print("Loading CT...")
    print("Device:", device)
    print("Sample:", exposure["sample_id"])
    print("Declared anatomy:", exposure.get("anatomy", "unknown"))
    print("SDD:", sdd, "mm")
    print(
        "Original detector:",
        full_width,
        "x",
        full_height,
        "at",
        full_delx,
        "x",
        full_dely,
        "mm",
    )
    print(
        "Render detector:",
        render_width,
        "x",
        render_height,
        "at",
        render_delx,
        "x",
        render_dely,
        "mm",
    )

    # DiffDRR canonicalizes the NIfTI volume into RAS+ coordinates and,
    # by default, moves the CT volume isocenter to the world origin.
    subject = read(
        CT_PATH,
        orientation="AP",
        center_volume=False,
    )

    print("Creating renderer...")

    renderer = DRR(
        subject,
        sdd=sdd,
        height=render_height,
        width=render_width,
        delx=render_delx,
        dely=render_dely,
        x0=x0_mm,
        y0=y0_mm,
        reverse_x_axis=True,
    ).to(device)

    # camera_to_ct_mm already maps the camera frame into the centered CT
    # frame. Its translation column is the source location in CT space.
    pose_matrix = torch.tensor(
        camera_to_ct,
        dtype=torch.float32,
        device=device,
    ).unsqueeze(0)

    pose = RigidTransform(pose_matrix)

    print("Source position in CT coordinates:")
    print(camera_to_ct[:3, 3])

    print("Rendering exported simulator pose...")

    with torch.inference_mode():
        image_tensor = renderer(pose)

    print("DRR tensor shape:", tuple(image_tensor.shape))

    image = (
        image_tensor
        .squeeze()
        .detach()
        .cpu()
        .numpy()
    )

    raw_min = float(np.nanmin(image))
    raw_max = float(np.nanmax(image))

    print("Raw intensity range:", raw_min, "to", raw_max)

    if not np.isfinite(image).all():
        raise RuntimeError("The DRR contains NaN or infinite values.")

    if raw_max <= raw_min:
        raise RuntimeError(
            "The result is blank. The transform may need a fixed "
            "coordinate-system calibration."
        )

    display_image = normalize_for_display(image)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    sample_id = str(exposure["sample_id"])
    output_path = OUTPUT_DIR / f"{sample_id}_drr.png"

    plt.figure(figsize=(8, 8))
    plt.imshow(
        display_image,
        cmap="gray",
        vmin=0.0,
        vmax=1.0,
    )
    plt.axis("off")
    plt.tight_layout(pad=0)

    plt.savefig(
        output_path,
        dpi=200,
        bbox_inches="tight",
        pad_inches=0,
    )
    plt.close()

    print()
    print("PASS: JSON pose rendered successfully.")
    print("Saved to:")
    print(output_path)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("\nRendering failed:\n")
        traceback.print_exc()
        sys.exit(1)