from __future__ import annotations

import traceback
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import torch

from diffdrr.data import read
from diffdrr.drr import DRR
from diffdrr.pose import convert


# ---------------------------------------------------------------------
# PATHS
# ---------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent

CT_PATH = Path(
    r"C:\Users\suhai\Downloads\LIDC_CT.nii.gz"
)

OUTPUT_PATH = SCRIPT_DIR / "canonical_chest_drr.png"


# ---------------------------------------------------------------------
# RENDER SETTINGS
# ---------------------------------------------------------------------

DEVICE = torch.device(
    "cuda" if torch.cuda.is_available() else "cpu"
)

SDD_MM = 1040.0

RENDER_HEIGHT = 256
RENDER_WIDTH = 256

# Preserve the simulator's physical detector dimensions:
#
# 512 px × 0.4 mm = 204.8 mm
#
# At 256 pixels:
#
# 204.8 / 256 = 0.8 mm per pixel
PIXEL_SPACING_X_MM = 0.8
PIXEL_SPACING_Y_MM = 0.8

# Source-to-isocenter distance.
#
# DiffDRR's standard examples commonly use approximately 850 mm.
# This is much more realistic than the simulator's current 190 mm.
SOURCE_TO_ISOCENTER_MM = 850.0


def normalize_for_display(
    image: np.ndarray,
) -> np.ndarray:
    image = np.nan_to_num(
        image,
        nan=0.0,
        posinf=0.0,
        neginf=0.0,
    )

    finite = image[np.isfinite(image)]

    if finite.size == 0:
        return np.zeros_like(
            image,
            dtype=np.float32,
        )

    nonzero = finite[
        np.abs(finite) > 1e-8
    ]

    if nonzero.size == 0:
        return np.zeros_like(
            image,
            dtype=np.float32,
        )

    low = float(
        np.percentile(
            nonzero,
            1.0,
        )
    )

    high = float(
        np.percentile(
            nonzero,
            99.5,
        )
    )

    if high <= low:
        high = float(np.max(nonzero))

    if high <= low:
        return np.zeros_like(
            image,
            dtype=np.float32,
        )

    normalized = np.clip(
        (image - low) / (high - low),
        0.0,
        1.0,
    )

    # High attenuation appears brighter.
    return normalized.astype(
        np.float32
    )


def print_image_metrics(
    image: np.ndarray,
) -> None:
    cleaned = np.nan_to_num(
        image,
        nan=0.0,
        posinf=0.0,
        neginf=0.0,
    )

    print()
    print("DRR statistics")
    print("----------------------------")
    print("Shape:", cleaned.shape)
    print("Minimum:", float(cleaned.min()))
    print("Maximum:", float(cleaned.max()))
    print("Mean:", float(cleaned.mean()))
    print(
        "Standard deviation:",
        float(cleaned.std()),
    )
    print(
        "Nonzero fraction:",
        float(
            np.mean(
                np.abs(cleaned) > 1e-8
            )
        ),
    )


def save_image(
    image: np.ndarray,
) -> None:
    display = normalize_for_display(
        image
    )

    figure = plt.figure(
        figsize=(7, 7)
    )

    plt.imshow(
        display,
        cmap="gray",
        vmin=0.0,
        vmax=1.0,
    )

    plt.title(
        "Canonical DiffDRR Chest Projection\n"
        f"SID = {SOURCE_TO_ISOCENTER_MM:.0f} mm, "
        f"SDD = {SDD_MM:.0f} mm"
    )

    plt.axis("off")
    plt.tight_layout()

    figure.savefig(
        OUTPUT_PATH,
        dpi=180,
        bbox_inches="tight",
        pad_inches=0.05,
    )

    plt.close(figure)


def main() -> None:
    if not CT_PATH.exists():
        raise FileNotFoundError(
            f"CT volume not found:\n{CT_PATH}"
        )

    print("Loading CT...")
    print("CT:", CT_PATH)
    print("Device:", DEVICE)
    print("SDD:", SDD_MM, "mm")
    print(
        "Source-to-isocenter distance:",
        SOURCE_TO_ISOCENTER_MM,
        "mm",
    )
    print(
        "Detector:",
        RENDER_WIDTH,
        "x",
        RENDER_HEIGHT,
    )
    print(
        "Pixel spacing:",
        PIXEL_SPACING_X_MM,
        "x",
        PIXEL_SPACING_Y_MM,
        "mm",
    )

    subject = read(
        CT_PATH,
        orientation="AP",
        center_volume=True,
    )

    renderer = DRR(
        subject,
        sdd=SDD_MM,
        height=RENDER_HEIGHT,
        width=RENDER_WIDTH,
        delx=PIXEL_SPACING_X_MM,
        dely=PIXEL_SPACING_Y_MM,
        reverse_x_axis=True,
        renderer="siddon",
    ).to(DEVICE)

    # Canonical DiffDRR AP pose.
    #
    # DiffDRR's official examples use:
    #
    # rotation    = [0, 0, 0]
    # translation = [0, 850, 0]
    #
    # with Euler convention ZXY.
    rotations = torch.tensor(
        [[0.0, 0.0, 0.0]],
        dtype=torch.float32,
        device=DEVICE,
    )

    translations = torch.tensor(
        [[
            0.0,
            SOURCE_TO_ISOCENTER_MM,
            0.0,
        ]],
        dtype=torch.float32,
        device=DEVICE,
    )

    pose = convert(
        rotations,
        translations,
        parameterization="euler_angles",
        convention="ZXY",
        degrees=True,
    )

    print()
    print("Canonical pose matrix:")
    print(
        pose.matrix
        .detach()
        .cpu()
        .numpy()
    )

    with torch.inference_mode():
        rendered = renderer(
            pose
        )

    image = (
        rendered
        .squeeze()
        .detach()
        .cpu()
        .numpy()
    )

    print_image_metrics(
        image
    )

    if float(
        np.max(
            np.abs(image)
        )
    ) <= 1e-8:
        raise RuntimeError(
            "Canonical pose produced a blank image. "
            "This would indicate a CT-loading or rendering issue."
        )

    save_image(
        image
    )

    print()
    print("Rendering complete.")
    print("Saved image:")
    print(OUTPUT_PATH)


if __name__ == "__main__":
    try:
        main()

    except Exception:
        print()
        print("Canonical rendering failed:")
        print()

        traceback.print_exc()

        raise