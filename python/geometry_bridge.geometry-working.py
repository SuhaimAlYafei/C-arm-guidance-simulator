from __future__ import annotations

import argparse
import itertools
import json
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import nibabel as nib
import numpy as np
import torch

from bridge.geometry import ImagingGeometry, load_geometry
from diffdrr.data import read
from diffdrr.drr import DRR
from diffdrr.pose import RigidTransform


SCRIPT_DIR = Path(__file__).resolve().parent

DEFAULT_JSON_PATH = Path(r"C:\Users\suhai\Downloads\AP.json")
DEFAULT_CT_PATH = Path(r"C:\Users\suhai\Downloads\LIDC_CT.nii.gz")
DEFAULT_OUTPUT_PATH = SCRIPT_DIR / "bridge_output_v3.png"

DEFAULT_SID_MM = 850.0
DEFAULT_RENDER_WIDTH = 256
DEFAULT_RENDER_HEIGHT = 256

EPSILON = 1e-8


@dataclass(frozen=True)
class CTFrame:
    center_ras_mm: np.ndarray
    bounds_min_centered_mm: np.ndarray
    bounds_max_centered_mm: np.ndarray
    shape: tuple[int, int, int]
    affine: np.ndarray


@dataclass(frozen=True)
class CameraGeometry:
    detector_x_ct: np.ndarray
    detector_y_ct: np.ndarray
    beam_direction_ct: np.ndarray
    source_position_ct: np.ndarray
    detector_position_ct: np.ndarray
    isocenter_position_ct: np.ndarray
    sid_mm: float
    registration_rotation: np.ndarray
    registration_origin_mode: str
    registration_score: float
    beam_intersects_ct: bool


@dataclass(frozen=True)
class BridgeResult:
    pose_matrix: np.ndarray
    geometry: ImagingGeometry
    camera: CameraGeometry
    image: np.ndarray
    output_path: Path


def normalize_vector(vector: np.ndarray, name: str) -> np.ndarray:
    vector = np.asarray(vector, dtype=np.float64).reshape(3)
    magnitude = float(np.linalg.norm(vector))

    if not np.isfinite(magnitude):
        raise ValueError(f"{name} contains invalid values.")

    if magnitude < EPSILON:
        raise ValueError(f"{name} has zero or near-zero magnitude.")

    return vector / magnitude


def validate_rotation(rotation: np.ndarray, name: str) -> None:
    rotation = np.asarray(rotation, dtype=np.float64)

    if rotation.shape != (3, 3):
        raise ValueError(
            f"{name} must be a 3x3 matrix; received {rotation.shape}."
        )

    orthogonality_error = float(
        np.max(np.abs(rotation.T @ rotation - np.eye(3)))
    )
    determinant = float(np.linalg.det(rotation))

    if orthogonality_error > 1e-4:
        raise ValueError(
            f"{name} is not orthogonal. "
            f"Maximum error: {orthogonality_error:.6g}"
        )

    if not np.isclose(determinant, 1.0, atol=1e-4):
        raise ValueError(
            f"{name} must be right-handed. Determinant: {determinant:.6g}"
        )


def load_exposure_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise FileNotFoundError(f"Exposure JSON not found:\n{path}")

    try:
        with path.open("r", encoding="utf-8") as file:
            exposure = json.load(file)
    except json.JSONDecodeError as error:
        raise ValueError(
            f"Invalid JSON in {path}: line {error.lineno}, "
            f"column {error.colno}."
        ) from error

    if not isinstance(exposure, dict):
        raise TypeError("Exposure JSON root must be an object.")

    return exposure


def load_ct_frame(ct_path: Path) -> CTFrame:
    image = nib.load(str(ct_path))
    affine = np.asarray(image.affine, dtype=np.float64)
    shape = tuple(int(value) for value in image.shape[:3])

    corners_ijk = np.array(
        list(
            itertools.product(
                [0.0, shape[0] - 1.0],
                [0.0, shape[1] - 1.0],
                [0.0, shape[2] - 1.0],
            )
        ),
        dtype=np.float64,
    )

    corners_h = np.column_stack(
        [corners_ijk, np.ones(len(corners_ijk), dtype=np.float64)]
    )
    corners_ras = (affine @ corners_h.T).T[:, :3]

    bounds_min = corners_ras.min(axis=0)
    bounds_max = corners_ras.max(axis=0)
    center = 0.5 * (bounds_min + bounds_max)

    return CTFrame(
        center_ras_mm=center,
        bounds_min_centered_mm=bounds_min - center,
        bounds_max_centered_mm=bounds_max - center,
        shape=shape,
        affine=affine,
    )


def extract_ct_to_world(exposure: dict[str, Any]) -> np.ndarray:
    try:
        matrix = np.asarray(
            exposure["transforms"]["ct_to_world_mm"],
            dtype=np.float64,
        )
    except KeyError as error:
        raise ValueError(
            "Required field transforms.ct_to_world_mm is missing."
        ) from error

    if matrix.shape != (4, 4):
        raise ValueError(
            "transforms.ct_to_world_mm must be a 4x4 matrix."
        )

    if not np.all(np.isfinite(matrix)):
        raise ValueError(
            "transforms.ct_to_world_mm contains invalid values."
        )

    validate_rotation(matrix[:3, :3], "CT-to-world rotation")
    return matrix


def transform_point(matrix: np.ndarray, point: np.ndarray) -> np.ndarray:
    homogeneous = np.append(np.asarray(point, dtype=np.float64), 1.0)
    return (matrix @ homogeneous)[:3]


def transform_direction(
    rotation: np.ndarray,
    direction: np.ndarray,
    name: str,
) -> np.ndarray:
    return normalize_vector(rotation @ direction, name)


def world_geometry_to_simulator_ct(
    geometry: ImagingGeometry,
    exposure: dict[str, Any],
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    ct_to_world = extract_ct_to_world(exposure)

    try:
        world_to_ct = np.linalg.inv(ct_to_world)
    except np.linalg.LinAlgError as error:
        raise ValueError("CT-to-world transform is not invertible.") from error

    world_to_ct_rotation = world_to_ct[:3, :3]

    source = transform_point(world_to_ct, geometry.source_position)
    detector = transform_point(world_to_ct, geometry.detector_center)

    detector_x = transform_direction(
        world_to_ct_rotation,
        geometry.detector_x,
        "detector X in simulator CT coordinates",
    )
    detector_y = transform_direction(
        world_to_ct_rotation,
        geometry.detector_y,
        "detector Y in simulator CT coordinates",
    )

    beam = normalize_vector(
        detector - source,
        "source-to-detector direction in simulator CT coordinates",
    )

    detector_x = detector_x - beam * float(np.dot(detector_x, beam))
    detector_x = normalize_vector(detector_x, "orthogonalized detector X")

    reconstructed_y = normalize_vector(
        np.cross(beam, detector_x),
        "reconstructed detector Y",
    )

    if float(np.dot(reconstructed_y, detector_y)) < 0.0:
        detector_x = -detector_x
        reconstructed_y = -reconstructed_y

    return source, detector, detector_x, reconstructed_y, beam


def proper_axis_rotations() -> list[np.ndarray]:
    rotations: list[np.ndarray] = []

    for permutation in itertools.permutations(range(3)):
        base = np.eye(3, dtype=np.float64)[:, permutation]

        for signs in itertools.product([-1.0, 1.0], repeat=3):
            candidate = base @ np.diag(signs)

            if np.isclose(np.linalg.det(candidate), 1.0, atol=1e-9):
                rotations.append(candidate)

    return rotations


def ray_box_intersection(
    source: np.ndarray,
    direction: np.ndarray,
    bounds_min: np.ndarray,
    bounds_max: np.ndarray,
) -> tuple[bool, float, float]:
    t_enter = -np.inf
    t_exit = np.inf

    for axis in range(3):
        if abs(float(direction[axis])) < EPSILON:
            if (
                source[axis] < bounds_min[axis]
                or source[axis] > bounds_max[axis]
            ):
                return False, float("nan"), float("nan")
            continue

        t1 = (bounds_min[axis] - source[axis]) / direction[axis]
        t2 = (bounds_max[axis] - source[axis]) / direction[axis]

        near = min(t1, t2)
        far = max(t1, t2)

        t_enter = max(t_enter, near)
        t_exit = min(t_exit, far)

        if t_enter > t_exit:
            return False, float("nan"), float("nan")

    intersects = t_exit >= max(t_enter, 0.0)
    return bool(intersects), float(t_enter), float(t_exit)


def closest_point_on_forward_ray(
    source: np.ndarray,
    direction: np.ndarray,
) -> tuple[np.ndarray, float, float]:
    t = max(0.0, -float(np.dot(source, direction)))
    point = source + t * direction
    distance = float(np.linalg.norm(point))
    return point, t, distance


# The simulator's exported CT-local coordinates are not NIfTI millimetres.
# They use a stable local rig frame whose canonical beam is:
#
#   source      = [0, 600, -418]
#   isocenter   = [0, 600,    0]
#   beam        = [0,   0,   +1]
#
# The anchor is therefore required to remove the rig's fixed placement.
# Unlike the older bridge, this implementation derives the current
# isocenter first and preserves translation in all three directions.
SIM_REFERENCE_SOURCE_CT = np.array(
    [0.0, 600.0, -418.0],
    dtype=np.float64,
)
SIM_REFERENCE_BEAM_CT = np.array(
    [0.0, 0.0, 1.0],
    dtype=np.float64,
)
SIM_REFERENCE_ISOCENTER_CT = np.array(
    [0.0, 600.0, 0.0],
    dtype=np.float64,
)
SIM_REFERENCE_SID_UNITS = 418.0

# Fixed handedness conversion selected by the successful V3 diagnostic.
SIM_CT_TO_DIFFDRR = np.array(
    [
        [-1.0,  0.0, 0.0],
        [ 0.0, -1.0, 0.0],
        [ 0.0,  0.0, 1.0],
    ],
    dtype=np.float64,
)


def extract_camera_to_ct(exposure: dict[str, Any]) -> np.ndarray:
    """Return the exported camera-to-simulator-CT rigid transform."""
    try:
        matrix = np.asarray(
            exposure["transforms"]["camera_to_ct_mm"],
            dtype=np.float64,
        )
    except KeyError as error:
        raise ValueError(
            "Required field transforms.camera_to_ct_mm is missing."
        ) from error

    if matrix.shape != (4, 4):
        raise ValueError(
            "transforms.camera_to_ct_mm must be a 4x4 matrix."
        )

    if not np.all(np.isfinite(matrix)):
        raise ValueError(
            "transforms.camera_to_ct_mm contains invalid values."
        )

    validate_rotation(matrix[:3, :3], "camera-to-CT rotation")
    return matrix


def rotation_angle_degrees(rotation: np.ndarray) -> float:
    """Return the principal angle of a proper rotation matrix."""
    cosine = (float(np.trace(rotation)) - 1.0) / 2.0
    cosine = float(np.clip(cosine, -1.0, 1.0))
    return float(np.degrees(np.arccos(cosine)))


def canonicalize_detector_roll(
    detector_x: np.ndarray,
    detector_y: np.ndarray,
    beam: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, bool]:
    """
    Remove the exporter's occasional 180-degree detector-basis sign flip.

    The camera ray geometry is unchanged when both detector axes are
    multiplied by -1, but the resulting image is rotated by 180 degrees.
    The React export can choose either equivalent basis around orbital zero.
    We select the basis closest to the neutral detector-horizontal direction.
    """
    neutral_detector_x = normalize_vector(
        SIM_CT_TO_DIFFDRR
        @ np.array([0.0, -1.0, 0.0], dtype=np.float64),
        "neutral detector X",
    )

    candidate_a_x = detector_x
    candidate_a_y = detector_y
    candidate_b_x = -detector_x
    candidate_b_y = -detector_y

    score_a = float(np.dot(candidate_a_x, neutral_detector_x))
    score_b = float(np.dot(candidate_b_x, neutral_detector_x))

    if score_b > score_a:
        return candidate_b_x, candidate_b_y, True

    return candidate_a_x, candidate_a_y, False


def build_diffdrr_pose(
    geometry: ImagingGeometry,
    exposure: dict[str, Any],
    ct_path: Path,
    sid_mm: float,
) -> tuple[np.ndarray, CameraGeometry]:
    """
    Build the DiffDRR pose directly from camera_to_ct_mm.

    Rotation is taken from the exported rigid transform rather than rebuilt
    from separately exported vectors. Translation is converted from the
    simulator rig frame to the centered DiffDRR frame by deriving the current
    isocenter and preserving its full three-dimensional displacement.
    """
    if sid_mm <= 0:
        raise ValueError("SID must be positive.")

    ct_frame = load_ct_frame(ct_path)
    camera_to_ct = extract_camera_to_ct(exposure)

    camera_rotation_sim = camera_to_ct[:3, :3]
    source_sim_ct = camera_to_ct[:3, 3]

    # Export convention:
    #   camera +X = detector horizontal
    #   camera +Y = detector vertical/down
    #   camera +Z = source-to-detector beam
    detector_x_sim = normalize_vector(
        camera_rotation_sim[:, 0],
        "exported camera X",
    )
    detector_y_sim = normalize_vector(
        camera_rotation_sim[:, 1],
        "exported camera Y",
    )
    beam_sim = normalize_vector(
        camera_rotation_sim[:, 2],
        "exported camera Z/beam",
    )

    # Remove numerical drift while retaining the exported rigid rotation.
    detector_x_sim = detector_x_sim - beam_sim * float(
        np.dot(detector_x_sim, beam_sim)
    )
    detector_x_sim = normalize_vector(
        detector_x_sim,
        "orthogonalized exported camera X",
    )
    detector_y_sim = normalize_vector(
        np.cross(beam_sim, detector_x_sim),
        "orthogonalized exported camera Y",
    )

    if float(
        np.dot(detector_y_sim, camera_rotation_sim[:, 1])
    ) < 0.0:
        detector_x_sim = -detector_x_sim
        detector_y_sim = -detector_y_sim

    # Derive the current simulator isocenter from the source and beam.
    # The simulator's canonical source radius is 418 local rig units.
    isocenter_sim_ct = (
        source_sim_ct
        + beam_sim * SIM_REFERENCE_SID_UNITS
    )

    # Remove only the fixed rig placement. Preserve all current translation,
    # including translation parallel to the current beam.
    isocenter_delta_sim = (
        isocenter_sim_ct - SIM_REFERENCE_ISOCENTER_CT
    )
    isocenter = SIM_CT_TO_DIFFDRR @ isocenter_delta_sim

    detector_x = transform_direction(
        SIM_CT_TO_DIFFDRR,
        detector_x_sim,
        "direct detector X in DiffDRR coordinates",
    )
    detector_y = transform_direction(
        SIM_CT_TO_DIFFDRR,
        detector_y_sim,
        "direct detector Y in DiffDRR coordinates",
    )
    beam = transform_direction(
        SIM_CT_TO_DIFFDRR,
        beam_sim,
        "direct beam in DiffDRR coordinates",
    )

    detector_x = detector_x - beam * float(np.dot(detector_x, beam))
    detector_x = normalize_vector(
        detector_x,
        "direct orthogonalized detector X",
    )
    detector_y = normalize_vector(
        np.cross(beam, detector_x),
        "direct reconstructed detector Y",
    )

    detector_x, detector_y, roll_flip_applied = (
        canonicalize_detector_roll(
            detector_x,
            detector_y,
            beam,
        )
    )

    source = isocenter - beam * sid_mm
    detector = source + beam * geometry.sdd

    # DiffDRR 0.6.1 camera convention used by the working bridge:
    # local +X = detector horizontal
    # local -Y = source-to-detector beam
    # local +Z = detector vertical
    rotation = np.column_stack(
        (
            detector_x,
            -beam,
            detector_y,
        )
    )
    validate_rotation(rotation, "direct DiffDRR camera rotation")

    pose_matrix = np.eye(4, dtype=np.float64)
    pose_matrix[:3, :3] = rotation
    pose_matrix[:3, 3] = source

    intersects, _, _ = ray_box_intersection(
        source,
        beam,
        ct_frame.bounds_min_centered_mm,
        ct_frame.bounds_max_centered_mm,
    )

    _, _, centerline_distance = closest_point_on_forward_ray(
        source,
        beam,
    )

    neutral_rotation = np.column_stack(
        (
            normalize_vector(
                SIM_CT_TO_DIFFDRR
                @ np.array([0.0, -1.0, 0.0], dtype=np.float64),
                "neutral X",
            ),
            -normalize_vector(
                SIM_CT_TO_DIFFDRR
                @ SIM_REFERENCE_BEAM_CT,
                "neutral beam",
            ),
            normalize_vector(
                SIM_CT_TO_DIFFDRR
                @ np.array([1.0, 0.0, 0.0], dtype=np.float64),
                "neutral Y",
            ),
        )
    )
    validate_rotation(neutral_rotation, "neutral DiffDRR rotation")

    relative_rotation = neutral_rotation.T @ rotation
    relative_angle_deg = rotation_angle_degrees(relative_rotation)

    validation = exposure.get("validation", {})
    export_y_down = validation.get("camera_y_down_enforced", None)

    print()
    print("Direct camera-transform diagnostics")
    print("----------------------------------------")
    print("Exporter camera_y_down_enforced:", export_y_down)
    print("180-degree roll correction applied:", roll_flip_applied)
    print("Relative camera rotation from neutral:", relative_angle_deg, "deg")
    print("Exported camera-to-CT rotation:")
    print(camera_rotation_sim)

    camera = CameraGeometry(
        detector_x_ct=detector_x,
        detector_y_ct=detector_y,
        beam_direction_ct=beam,
        source_position_ct=source,
        detector_position_ct=detector,
        isocenter_position_ct=isocenter,
        sid_mm=float(sid_mm),
        registration_rotation=SIM_CT_TO_DIFFDRR,
        registration_origin_mode="direct_camera_to_ct",
        registration_score=float(centerline_distance),
        beam_intersects_ct=bool(intersects),
    )

    return pose_matrix, camera


def calculate_render_spacing(
    geometry: ImagingGeometry,
    render_width: int,
    render_height: int,
) -> tuple[float, float]:
    physical_width_mm, physical_height_mm = geometry.detector_size_mm

    return (
        physical_width_mm / render_width,
        physical_height_mm / render_height,
    )


def render_drr(
    ct_path: Path,
    pose_matrix: np.ndarray,
    geometry: ImagingGeometry,
    render_width: int,
    render_height: int,
    device: torch.device,
) -> np.ndarray:
    if not ct_path.is_file():
        raise FileNotFoundError(f"CT volume not found:\n{ct_path}")

    if render_width <= 0 or render_height <= 0:
        raise ValueError("Render dimensions must be positive.")

    spacing_x, spacing_y = calculate_render_spacing(
        geometry,
        render_width,
        render_height,
    )

    print("Loading CT volume...")

    # Keep the same DiffDRR frame convention as the previously working
    # bridge. Registration into this centered frame is now derived from
    # the exported geometry instead of a hard-coded reference pose.
    subject = read(
        ct_path,
        orientation="AP",
        center_volume=True,
    )

    renderer = DRR(
        subject,
        sdd=geometry.sdd,
        height=render_height,
        width=render_width,
        delx=spacing_x,
        dely=spacing_y,
        reverse_x_axis=True,
        renderer="siddon",
    ).to(device)

    pose_tensor = torch.tensor(
        pose_matrix,
        dtype=torch.float32,
        device=device,
    ).unsqueeze(0)

    pose = RigidTransform(pose_tensor)

    with torch.inference_mode():
        rendered = renderer(pose)

    return rendered.squeeze().detach().cpu().numpy()


def normalize_for_display(image: np.ndarray) -> np.ndarray:
    cleaned = np.nan_to_num(
        image,
        nan=0.0,
        posinf=0.0,
        neginf=0.0,
    )

    nonzero = cleaned[np.abs(cleaned) > EPSILON]

    if nonzero.size == 0:
        return np.zeros_like(cleaned, dtype=np.float32)

    low = float(np.percentile(nonzero, 0.5))
    high = float(np.percentile(nonzero, 99.5))

    if high <= low:
        return np.zeros_like(cleaned, dtype=np.float32)

    return np.clip(
        (cleaned - low) / (high - low),
        0.0,
        1.0,
    ).astype(np.float32)


def save_drr_image(
    image: np.ndarray,
    output_path: Path,
    sample_id: str,
    sid_mm: float,
    sdd_mm: float,
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    display = normalize_for_display(image)

    figure = plt.figure(figsize=(7, 7))
    plt.imshow(display, cmap="gray", vmin=0.0, vmax=1.0)
    plt.title(
        f"{sample_id}\n"
        f"SID={sid_mm:.1f} mm | SDD={sdd_mm:.1f} mm"
    )
    plt.axis("off")
    plt.tight_layout()

    figure.savefig(
        output_path,
        dpi=180,
        bbox_inches="tight",
        pad_inches=0.05,
    )
    plt.close(figure)


def print_image_statistics(image: np.ndarray) -> None:
    cleaned = np.nan_to_num(
        image,
        nan=0.0,
        posinf=0.0,
        neginf=0.0,
    )

    print()
    print("DRR statistics")
    print("----------------------------------------")
    print("Shape:", cleaned.shape)
    print("Minimum:", float(cleaned.min()))
    print("Maximum:", float(cleaned.max()))
    print("Mean:", float(cleaned.mean()))
    print("Standard deviation:", float(cleaned.std()))
    print(
        "Nonzero fraction:",
        float(np.mean(np.abs(cleaned) > EPSILON)),
    )


def save_metadata(
    exposure: dict[str, Any],
    geometry: ImagingGeometry,
    pose_matrix: np.ndarray,
    camera: CameraGeometry,
    output_path: Path,
    render_width: int,
    render_height: int,
) -> Path:
    metadata_path = output_path.with_suffix(".bridge.json")

    metadata = {
        "sample_id": exposure.get("sample_id", "unknown"),
        "anatomy": exposure.get("anatomy", "unknown"),
        "pose_convention": {
            "local_positive_x": "detector horizontal",
            "local_negative_y": "source-to-detector beam",
            "local_positive_z": "detector vertical",
        },
        "exported_geometry": {
            "source_position_world_mm": geometry.source_position.tolist(),
            "detector_center_world_mm": geometry.detector_center.tolist(),
            "detector_x_world": geometry.detector_x.tolist(),
            "detector_y_world": geometry.detector_y.tolist(),
            "beam_direction_world": geometry.detector_normal.tolist(),
            "source_to_detector_distance_mm": geometry.sdd,
            "detector_size_mm": list(geometry.detector_size_mm),
        },
        "diffdrr_camera": {
            "detector_x_ct": camera.detector_x_ct.tolist(),
            "detector_y_ct": camera.detector_y_ct.tolist(),
            "beam_direction_ct": camera.beam_direction_ct.tolist(),
            "source_position_ct_mm": camera.source_position_ct.tolist(),
            "detector_position_ct_mm": camera.detector_position_ct.tolist(),
            "isocenter_position_ct_mm": camera.isocenter_position_ct.tolist(),
            "source_to_isocenter_mm": camera.sid_mm,
            "beam_intersects_ct": camera.beam_intersects_ct,
        },
        "registration": {
            "origin_mode": camera.registration_origin_mode,
            "axis_rotation": camera.registration_rotation.tolist(),
            "score": camera.registration_score,
        },
        "detector": {
            "width_px": geometry.detector_width,
            "height_px": geometry.detector_height,
            "pixel_spacing_mm": list(geometry.pixel_spacing),
            "source_to_detector_distance_mm": geometry.sdd,
        },
        "render": {
            "width_px": render_width,
            "height_px": render_height,
        },
        "diffdrr_pose_matrix": pose_matrix.tolist(),
    }

    with metadata_path.open("w", encoding="utf-8") as file:
        json.dump(metadata, file, indent=2)

    return metadata_path


def run_bridge(
    json_path: Path,
    ct_path: Path,
    output_path: Path,
    sid_mm: float,
    render_width: int,
    render_height: int,
) -> BridgeResult:
    geometry = load_geometry(json_path)
    exposure = load_exposure_json(json_path)

    pose_matrix, camera = build_diffdrr_pose(
        geometry=geometry,
        exposure=exposure,
        ct_path=ct_path,
        sid_mm=sid_mm,
    )

    device = torch.device(
        "cuda" if torch.cuda.is_available() else "cpu"
    )

    sample_id = str(exposure.get("sample_id", json_path.stem))

    print("Geometry bridge V3.2")
    print("========================================")
    print("Device:", device)
    print("Sample:", sample_id)
    print("Anatomy:", exposure.get("anatomy", "unknown"))
    print("Expected SID:", sid_mm, "mm")
    print("Measured SDD:", geometry.sdd, "mm")
    print("Detector size:", geometry.detector_size_mm, "mm")
    print()
    print("Registration origin mode:")
    print(camera.registration_origin_mode)
    print()
    print("Registration axis rotation:")
    print(camera.registration_rotation)
    print()
    print("Registration score:")
    print(camera.registration_score)
    print()
    print("Beam intersects CT:")
    print(camera.beam_intersects_ct)
    print()
    print("Detector X in centered CT coordinates:")
    print(camera.detector_x_ct)
    print()
    print("Detector Y in centered CT coordinates:")
    print(camera.detector_y_ct)
    print()
    print("Beam direction in centered CT coordinates:")
    print(camera.beam_direction_ct)
    print()
    print("Source position in centered CT coordinates:")
    print(camera.source_position_ct)
    print()
    print("Detector position in centered CT coordinates:")
    print(camera.detector_position_ct)
    print()
    print("Closest beam point to CT center:")
    print(camera.isocenter_position_ct)
    print()
    print("Derived source-to-isocenter distance:")
    print(camera.sid_mm, "mm")
    print()
    print("DiffDRR pose matrix:")
    print(pose_matrix)
    print()

    if not camera.beam_intersects_ct:
        raise RuntimeError(
            "The exported central ray does not intersect the CT bounding box. "
            "Check the printed source, beam, registration mode, and axis "
            "rotation before rendering."
        )

    image = render_drr(
        ct_path=ct_path,
        pose_matrix=pose_matrix,
        geometry=geometry,
        render_width=render_width,
        render_height=render_height,
        device=device,
    )

    print_image_statistics(image)

    if float(np.max(np.abs(image))) <= EPSILON:
        raise RuntimeError(
            "The geometry bridge produced a blank DRR even though the "
            "central ray intersects the CT bounding box."
        )

    save_drr_image(
        image=image,
        output_path=output_path,
        sample_id=sample_id,
        sid_mm=camera.sid_mm,
        sdd_mm=geometry.sdd,
    )

    raw_path = output_path.with_suffix(".npy")
    np.save(raw_path, image.astype(np.float32))

    metadata_path = save_metadata(
        exposure=exposure,
        geometry=geometry,
        pose_matrix=pose_matrix,
        camera=camera,
        output_path=output_path,
        render_width=render_width,
        render_height=render_height,
    )

    print()
    print("Bridge rendering complete.")
    print("PNG:")
    print(output_path)
    print()
    print("Raw DRR array:")
    print(raw_path)
    print()
    print("Bridge metadata:")
    print(metadata_path)

    return BridgeResult(
        pose_matrix=pose_matrix,
        geometry=geometry,
        camera=camera,
        image=image,
        output_path=output_path,
    )


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Render simulator C-arm geometry with DiffDRR using the "
            "exported source, detector, CT transform, and NIfTI geometry."
        )
    )

    parser.add_argument(
        "--json",
        type=Path,
        default=DEFAULT_JSON_PATH,
        help="Path to the simulator exposure JSON.",
    )
    parser.add_argument(
        "--ct",
        type=Path,
        default=DEFAULT_CT_PATH,
        help="Path to the NIfTI CT volume.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_PATH,
        help="Output PNG path.",
    )
    parser.add_argument(
        "--sid",
        type=float,
        default=DEFAULT_SID_MM,
        help="Expected source-to-isocenter distance in millimetres.",
    )
    parser.add_argument(
        "--width",
        type=int,
        default=DEFAULT_RENDER_WIDTH,
        help="Rendered DRR width.",
    )
    parser.add_argument(
        "--height",
        type=int,
        default=DEFAULT_RENDER_HEIGHT,
        help="Rendered DRR height.",
    )

    return parser


def main() -> None:
    arguments = build_argument_parser().parse_args()

    run_bridge(
        json_path=arguments.json,
        ct_path=arguments.ct,
        output_path=arguments.output,
        sid_mm=arguments.sid,
        render_width=arguments.width,
        render_height=arguments.height,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print()
        print("Geometry bridge V3.2 failed:")
        print()
        traceback.print_exc()
        raise
