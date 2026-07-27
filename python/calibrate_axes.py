from __future__ import annotations

import itertools
import json
import traceback
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import torch

from diffdrr.data import read
from diffdrr.drr import DRR
from diffdrr.pose import RigidTransform


# ---------------------------------------------------------------------
# PATHS
# ---------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent

JSON_PATH = (
    SCRIPT_DIR
    / "sample_2026-07-26T19-41-38-929Z.json"
)

CT_PATH = Path(
    r"C:\Users\suhai\Downloads\LIDC_CT.nii.gz"
)

OUTPUT_DIR = SCRIPT_DIR / "axis_calibration"


# ---------------------------------------------------------------------
# RENDER SETTINGS
# ---------------------------------------------------------------------

# Low resolution makes testing all 24 orientations faster.
RENDER_WIDTH = 128
RENDER_HEIGHT = 128

# This is a diagnostic only.
# It shifts the camera perpendicular to the beam so that the central ray
# passes through the centered DiffDRR volume.
CENTER_BEAM_ON_CT = True


# ---------------------------------------------------------------------
# FILE LOADING
# ---------------------------------------------------------------------

def load_exposure() -> dict:
    if not JSON_PATH.exists():
        raise FileNotFoundError(
            f"Exposure JSON not found:\n{JSON_PATH}"
        )

    if not CT_PATH.exists():
        raise FileNotFoundError(
            f"CT volume not found:\n{CT_PATH}"
        )

    with JSON_PATH.open("r", encoding="utf-8") as file:
        exposure = json.load(file)

    if "transforms" not in exposure:
        raise KeyError(
            "The exposure JSON has no 'transforms' section."
        )

    if "camera_to_ct_mm" not in exposure["transforms"]:
        raise KeyError(
            "The exposure JSON has no "
            "'transforms.camera_to_ct_mm' matrix."
        )

    if "image_geometry" not in exposure:
        raise KeyError(
            "The exposure JSON has no 'image_geometry' section."
        )

    return exposure


# ---------------------------------------------------------------------
# AXIS MAPPINGS
# ---------------------------------------------------------------------

def make_proper_axis_rotations(
) -> list[tuple[str, np.ndarray]]:
    """
    Generate all 24 proper signed-axis permutation matrices.

    These are all possible right-handed mappings between:
        simulator CT axes
    and:
        DiffDRR CT axes

    Reflections are excluded because every returned matrix has
    determinant +1.
    """

    rotations: list[tuple[str, np.ndarray]] = []
    axis_names = ["X", "Y", "Z"]

    for permutation in itertools.permutations(range(3)):
        for signs in itertools.product(
            [-1.0, 1.0],
            repeat=3,
        ):
            rotation = np.zeros(
                (3, 3),
                dtype=np.float32,
            )

            for output_axis, input_axis in enumerate(
                permutation
            ):
                rotation[
                    output_axis,
                    input_axis,
                ] = signs[output_axis]

            determinant = float(
                np.linalg.det(rotation)
            )

            if not np.isclose(
                determinant,
                1.0,
                atol=1e-6,
            ):
                continue

            labels: list[str] = []

            for output_axis, input_axis in enumerate(
                permutation
            ):
                sign_text = (
                    "+"
                    if signs[output_axis] > 0
                    else "-"
                )

                labels.append(
                    f"{axis_names[output_axis]}"
                    f"={sign_text}"
                    f"{axis_names[input_axis]}"
                )

            rotations.append(
                (
                    ", ".join(labels),
                    rotation,
                )
            )

    if len(rotations) != 24:
        raise RuntimeError(
            "Expected exactly 24 proper axis mappings, "
            f"but generated {len(rotations)}."
        )

    return rotations


def rotation_to_transform(
    rotation: np.ndarray,
) -> np.ndarray:
    transform = np.eye(
        4,
        dtype=np.float32,
    )

    transform[:3, :3] = rotation

    return transform


# ---------------------------------------------------------------------
# CAMERA GEOMETRY
# ---------------------------------------------------------------------

def validate_rigid_transform(
    matrix: np.ndarray,
    name: str,
) -> None:
    if matrix.shape != (4, 4):
        raise ValueError(
            f"{name} must be a 4×4 matrix. "
            f"Received shape {matrix.shape}."
        )

    if not np.all(np.isfinite(matrix)):
        raise ValueError(
            f"{name} contains NaN or infinite values."
        )

    expected_bottom_row = np.array(
        [0.0, 0.0, 0.0, 1.0],
        dtype=np.float32,
    )

    if not np.allclose(
        matrix[3, :],
        expected_bottom_row,
        atol=1e-5,
    ):
        raise ValueError(
            f"{name} has an invalid homogeneous bottom row:\n"
            f"{matrix[3, :]}"
        )

    rotation = matrix[:3, :3]

    orthogonality_error = float(
        np.max(
            np.abs(
                rotation.T @ rotation
                - np.eye(3)
            )
        )
    )

    determinant = float(
        np.linalg.det(rotation)
    )

    if orthogonality_error > 1e-3:
        raise ValueError(
            f"{name} rotation is not orthogonal. "
            f"Maximum error: {orthogonality_error}"
        )

    if not np.isclose(
        determinant,
        1.0,
        atol=1e-3,
    ):
        raise ValueError(
            f"{name} rotation determinant is "
            f"{determinant}, not +1."
        )


def center_camera_ray_on_origin(
    camera_to_ct: np.ndarray,
) -> tuple[np.ndarray, dict[str, np.ndarray | float]]:
    """
    Shift the source perpendicular to the beam so the central ray
    intersects the CT origin.

    The camera orientation is unchanged.

    The source position along the beam direction is also unchanged.
    Therefore, this does not move the source closer to or farther from
    the central isocenter plane; it removes only lateral displacement.

    Camera convention used by the exported simulator matrix:
        column 0 = camera X axis
        column 1 = camera Y axis
        column 2 = beam direction / camera Z axis
        column 3 = source position
    """

    result = camera_to_ct.copy()

    source_before = result[:3, 3].copy()
    beam_direction = result[:3, 2].copy()

    beam_norm = float(
        np.linalg.norm(beam_direction)
    )

    if beam_norm < 1e-8:
        raise ValueError(
            "Camera beam direction has zero magnitude."
        )

    beam_direction /= beam_norm

    # Point on the infinite central ray closest to the origin:
    #
    # ray(t) = source + t * beam
    #
    # t_closest = -dot(source, beam)
    #
    # closest = source - beam * dot(source, beam)
    perpendicular_offset = (
        source_before
        - beam_direction
        * float(
            np.dot(
                source_before,
                beam_direction,
            )
        )
    )

    result[:3, 3] -= perpendicular_offset

    source_after = result[:3, 3].copy()

    remaining_offset = (
        source_after
        - beam_direction
        * float(
            np.dot(
                source_after,
                beam_direction,
            )
        )
    )

    diagnostics: dict[str, np.ndarray | float] = {
        "source_before": source_before,
        "source_after": source_after,
        "beam_direction": beam_direction,
        "removed_perpendicular_offset": (
            perpendicular_offset
        ),
        "removed_offset_magnitude_mm": float(
            np.linalg.norm(
                perpendicular_offset
            )
        ),
        "remaining_perpendicular_offset_mm": float(
            np.linalg.norm(
                remaining_offset
            )
        ),
    }

    return result, diagnostics


# ---------------------------------------------------------------------
# IMAGE PROCESSING
# ---------------------------------------------------------------------

def normalize_image(
    image: np.ndarray,
) -> np.ndarray:
    finite = image[np.isfinite(image)]

    if finite.size == 0:
        return np.zeros_like(
            image,
            dtype=np.float32,
        )

    low = float(
        np.percentile(
            finite,
            0.5,
        )
    )

    high = float(
        np.percentile(
            finite,
            99.5,
        )
    )

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

    # Convert line-integral appearance into conventional
    # white-anatomy-on-dark-background radiograph appearance.
    return 1.0 - normalized


def calculate_image_metrics(
    image: np.ndarray,
) -> dict[str, float]:
    finite = np.nan_to_num(
        image,
        nan=0.0,
        posinf=0.0,
        neginf=0.0,
    )

    absolute = np.abs(finite)

    nonzero_fraction = float(
        np.mean(
            absolute > 1e-8
        )
    )

    maximum = float(
        np.max(finite)
    )

    minimum = float(
        np.min(finite)
    )

    mean = float(
        np.mean(finite)
    )

    standard_deviation = float(
        np.std(finite)
    )

    total = float(
        np.sum(finite)
    )

    # Prioritize nonblank detector coverage.
    score = (
        nonzero_fraction * 1000.0
        + standard_deviation * 10.0
        + mean
    )

    return {
        "score": score,
        "nonzero_fraction": nonzero_fraction,
        "minimum": minimum,
        "maximum": maximum,
        "mean": mean,
        "standard_deviation": standard_deviation,
        "total": total,
    }


# ---------------------------------------------------------------------
# OUTPUT
# ---------------------------------------------------------------------

def safe_filename_label(
    label: str,
) -> str:
    return (
        label
        .replace("=", "")
        .replace("+", "p")
        .replace("-", "m")
        .replace(",", "")
        .replace(" ", "_")
    )


def save_candidate_image(
    image: np.ndarray,
    index: int,
    label: str,
    metrics: dict[str, float],
) -> Path:
    output_path = OUTPUT_DIR / (
        f"candidate_{index:02d}_"
        f"score_{metrics['score']:.3f}_"
        f"{safe_filename_label(label)}.png"
    )

    display_image = normalize_image(image)

    figure = plt.figure(
        figsize=(5, 5)
    )

    plt.imshow(
        display_image,
        cmap="gray",
        vmin=0.0,
        vmax=1.0,
    )

    plt.title(
        f"Candidate {index:02d}\n"
        f"{label}\n"
        f"nonzero="
        f"{metrics['nonzero_fraction']:.6f}",
        fontsize=9,
    )

    plt.axis("off")
    plt.tight_layout()

    figure.savefig(
        output_path,
        dpi=140,
        bbox_inches="tight",
        pad_inches=0.05,
    )

    plt.close(figure)

    return output_path


def save_contact_sheet(
    results: list[dict],
) -> Path:
    ranked = sorted(
        results,
        key=lambda item: item["metrics"]["score"],
        reverse=True,
    )

    top_results = ranked[:12]

    figure, axes = plt.subplots(
        3,
        4,
        figsize=(13, 10),
    )

    flat_axes = axes.flatten()

    for axis, result in zip(
        flat_axes,
        top_results,
    ):
        axis.imshow(
            normalize_image(
                result["image"]
            ),
            cmap="gray",
            vmin=0.0,
            vmax=1.0,
        )

        axis.set_title(
            f"#{result['index']:02d}\n"
            f"{result['label']}\n"
            f"score="
            f"{result['metrics']['score']:.2f}\n"
            f"nz="
            f"{result['metrics']['nonzero_fraction']:.4f}",
            fontsize=7,
        )

        axis.axis("off")

    for axis in flat_axes[len(top_results):]:
        axis.axis("off")

    figure.tight_layout()

    output_path = (
        OUTPUT_DIR
        / "top_candidates_contact_sheet.png"
    )

    figure.savefig(
        output_path,
        dpi=170,
        bbox_inches="tight",
    )

    plt.close(figure)

    return output_path


def save_report(
    results: list[dict],
) -> Path:
    ranked = sorted(
        results,
        key=lambda item: item["metrics"]["score"],
        reverse=True,
    )

    output_path = (
        OUTPUT_DIR
        / "calibration_results.txt"
    )

    with output_path.open(
        "w",
        encoding="utf-8",
    ) as report:
        report.write(
            "DIFFDRR AXIS AND BEAM-CENTERING "
            "CALIBRATION RESULTS\n"
        )

        report.write(
            "============================================"
            "====\n\n"
        )

        report.write(
            f"Beam-centering diagnostic enabled: "
            f"{CENTER_BEAM_ON_CT}\n\n"
        )

        for rank, result in enumerate(
            ranked,
            start=1,
        ):
            metrics = result["metrics"]
            diagnostics = result["diagnostics"]

            report.write(
                f"Rank: {rank:02d}\n"
            )

            report.write(
                f"Candidate: "
                f"{result['index']:02d}\n"
            )

            report.write(
                f"Mapping: "
                f"{result['label']}\n"
            )

            report.write(
                f"Score: "
                f"{metrics['score']}\n"
            )

            report.write(
                f"Nonzero fraction: "
                f"{metrics['nonzero_fraction']}\n"
            )

            report.write(
                f"Minimum: "
                f"{metrics['minimum']}\n"
            )

            report.write(
                f"Maximum: "
                f"{metrics['maximum']}\n"
            )

            report.write(
                f"Mean: "
                f"{metrics['mean']}\n"
            )

            report.write(
                f"Standard deviation: "
                f"{metrics['standard_deviation']}\n"
            )

            report.write(
                f"Total intensity: "
                f"{metrics['total']}\n"
            )

            report.write(
                "Calibration rotation:\n"
                f"{result['axis_rotation']}\n"
            )

            report.write(
                "Source before centering:\n"
                f"{diagnostics['source_before']}\n"
            )

            report.write(
                "Source after centering:\n"
                f"{diagnostics['source_after']}\n"
            )

            report.write(
                "Beam direction:\n"
                f"{diagnostics['beam_direction']}\n"
            )

            report.write(
                "Removed perpendicular offset:\n"
                f"{diagnostics['removed_perpendicular_offset']}"
                "\n"
            )

            report.write(
                "Removed offset magnitude (mm): "
                f"{diagnostics['removed_offset_magnitude_mm']}"
                "\n"
            )

            report.write(
                "Remaining perpendicular offset (mm): "
                f"{diagnostics['remaining_perpendicular_offset_mm']}"
                "\n"
            )

            report.write(
                "Camera-to-DiffDRR transform:\n"
                f"{result['candidate_matrix']}\n"
            )

            report.write(
                f"Image: "
                f"{result['output_path']}\n\n"
            )

    return output_path


# ---------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------

def main() -> None:
    exposure = load_exposure()

    sample_id = exposure.get(
        "sample_id",
        JSON_PATH.stem,
    )

    anatomy = exposure.get(
        "anatomy",
        "unknown",
    )

    geometry = exposure["image_geometry"]

    sdd_mm = float(
        geometry[
            "source_to_detector_distance_mm"
        ]
    )

    original_width = int(
        geometry["width_px"]
    )

    original_height = int(
        geometry["height_px"]
    )

    pixel_spacing = geometry[
        "pixel_spacing_mm"
    ]

    original_delx_mm = float(
        pixel_spacing[0]
    )

    original_dely_mm = float(
        pixel_spacing[1]
    )

    # Preserve the original physical detector size while reducing
    # resolution for calibration.
    render_delx_mm = (
        original_delx_mm
        * original_width
        / RENDER_WIDTH
    )

    render_dely_mm = (
        original_dely_mm
        * original_height
        / RENDER_HEIGHT
    )

    simulator_camera_to_ct = np.asarray(
        exposure["transforms"][
            "camera_to_ct_mm"
        ],
        dtype=np.float32,
    )

    validate_rigid_transform(
        simulator_camera_to_ct,
        "simulator camera_to_ct_mm",
    )

    device = torch.device(
        "cuda"
        if torch.cuda.is_available()
        else "cpu"
    )

    OUTPUT_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    print("Loading CT...")
    print("Device:", device)
    print("Sample:", sample_id)
    print("Declared anatomy:", anatomy)

    print(
        "Original detector:",
        original_width,
        "x",
        original_height,
        "at",
        original_delx_mm,
        "x",
        original_dely_mm,
        "mm",
    )

    print(
        "Calibration detector:",
        RENDER_WIDTH,
        "x",
        RENDER_HEIGHT,
        "at",
        render_delx_mm,
        "x",
        render_dely_mm,
        "mm",
    )

    print("SDD:", sdd_mm, "mm")

    print(
        "Beam-centering diagnostic:",
        CENTER_BEAM_ON_CT,
    )

    print()

    subject = read(
        CT_PATH,
        orientation="AP",
        center_volume=True,
    )

    renderer = DRR(
        subject,
        sdd=sdd_mm,
        height=RENDER_HEIGHT,
        width=RENDER_WIDTH,
        delx=render_delx_mm,
        dely=render_dely_mm,
        reverse_x_axis=True,
    ).to(device)

    axis_rotations = (
        make_proper_axis_rotations()
    )

    results: list[dict] = []

    print(
        "Testing 24 right-handed axis mappings..."
    )

    print(
        "---------------------------------------------"
    )

    for index, (
        label,
        axis_rotation,
    ) in enumerate(
        axis_rotations,
        start=1,
    ):
        calibration = rotation_to_transform(
            axis_rotation
        )

        # Convert from simulator CT coordinates into the candidate
        # DiffDRR coordinate orientation.
        candidate_matrix = (
            calibration
            @ simulator_camera_to_ct
        )

        if CENTER_BEAM_ON_CT:
            (
                candidate_matrix,
                centering_diagnostics,
            ) = center_camera_ray_on_origin(
                candidate_matrix
            )
        else:
            source = (
                candidate_matrix[:3, 3]
                .copy()
            )

            beam = (
                candidate_matrix[:3, 2]
                .copy()
            )

            beam /= np.linalg.norm(beam)

            centering_diagnostics = {
                "source_before": source,
                "source_after": source.copy(),
                "beam_direction": beam,
                "removed_perpendicular_offset": (
                    np.zeros(
                        3,
                        dtype=np.float32,
                    )
                ),
                "removed_offset_magnitude_mm": 0.0,
                "remaining_perpendicular_offset_mm": (
                    float(
                        np.linalg.norm(
                            source
                            - beam
                            * np.dot(
                                source,
                                beam,
                            )
                        )
                    )
                ),
            }

        validate_rigid_transform(
            candidate_matrix,
            f"candidate {index}",
        )

        pose_tensor = torch.tensor(
            candidate_matrix,
            dtype=torch.float32,
            device=device,
        ).unsqueeze(0)

        pose = RigidTransform(
            pose_tensor
        )

        with torch.inference_mode():
            rendered = renderer(pose)

        image = (
            rendered
            .squeeze()
            .detach()
            .cpu()
            .numpy()
        )

        metrics = calculate_image_metrics(
            image
        )

        output_path = save_candidate_image(
            image=image,
            index=index,
            label=label,
            metrics=metrics,
        )

        result = {
            "index": index,
            "label": label,
            "axis_rotation": axis_rotation,
            "candidate_matrix": (
                candidate_matrix
            ),
            "diagnostics": (
                centering_diagnostics
            ),
            "metrics": metrics,
            "image": image,
            "output_path": output_path,
        }

        results.append(result)

        print(
            f"{index:02d}/24 | "
            f"score={metrics['score']:.4f} | "
            f"nonzero="
            f"{metrics['nonzero_fraction']:.6f} | "
            f"range="
            f"{metrics['minimum']:.6f}"
            f".."
            f"{metrics['maximum']:.6f} | "
            f"{label}"
        )

    ranked = sorted(
        results,
        key=lambda item: (
            item["metrics"]["score"]
        ),
        reverse=True,
    )

    contact_sheet_path = save_contact_sheet(
        results
    )

    report_path = save_report(
        results
    )

    best = ranked[0]

    print()
    print("Calibration search complete.")

    print(
        "---------------------------------------------"
    )

    print(
        "Highest-scoring candidate:",
        best["index"],
    )

    print(
        "Mapping:",
        best["label"],
    )

    print(
        "Score:",
        best["metrics"]["score"],
    )

    print(
        "Nonzero fraction:",
        best["metrics"][
            "nonzero_fraction"
        ],
    )

    print()
    print("Best calibration rotation:")
    print(best["axis_rotation"])

    print()
    print("Original source position:")
    print(
        best["diagnostics"][
            "source_before"
        ]
    )

    print()
    print("Centered source position:")
    print(
        best["diagnostics"][
            "source_after"
        ]
    )

    print()
    print("Beam direction:")
    print(
        best["diagnostics"][
            "beam_direction"
        ]
    )

    print()
    print(
        "Removed perpendicular offset:",
        best["diagnostics"][
            "removed_offset_magnitude_mm"
        ],
        "mm",
    )

    print()
    print(
        "Candidate camera-to-DiffDRR transform:"
    )

    print(
        best["candidate_matrix"]
    )

    print()
    print("Contact sheet:")
    print(contact_sheet_path)

    print()
    print("Full report:")
    print(report_path)


if __name__ == "__main__":
    try:
        main()

    except Exception:
        print()
        print("Calibration failed:")
        print()

        traceback.print_exc()

        raise