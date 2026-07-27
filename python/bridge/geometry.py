from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np


@dataclass(frozen=True)
class ImagingGeometry:
    source_position: np.ndarray
    detector_center: np.ndarray

    detector_x: np.ndarray
    detector_y: np.ndarray
    detector_normal: np.ndarray

    pixel_spacing: tuple[float, float]

    detector_width: int
    detector_height: int

    sdd: float

    @property
    def detector_size_mm(self) -> tuple[float, float]:
        """Physical detector width and height in millimetres."""
        spacing_x, spacing_y = self.pixel_spacing

        return (
            self.detector_width * spacing_x,
            self.detector_height * spacing_y,
        )

    @property
    def central_ray(self) -> np.ndarray:
        """Unit vector from the source toward the detector."""
        direction = self.detector_center - self.source_position
        return direction / np.linalg.norm(direction)


def _as_vector(value: Any, field_name: str) -> np.ndarray:
    """Convert a JSON array into a validated three-dimensional vector."""
    vector = np.asarray(value, dtype=np.float64)

    if vector.shape != (3,):
        raise ValueError(
            f"{field_name} must contain exactly three numbers; "
            f"received shape {vector.shape}."
        )

    if not np.all(np.isfinite(vector)):
        raise ValueError(f"{field_name} contains a non-finite value.")

    return vector


def _normalize(vector: np.ndarray, field_name: str) -> np.ndarray:
    """Return a unit-length copy of a vector."""
    magnitude = float(np.linalg.norm(vector))

    if magnitude < 1e-9:
        raise ValueError(f"{field_name} has zero or near-zero length.")

    return vector / magnitude


def load_geometry(json_path: str | Path) -> ImagingGeometry:
    """
    Load and validate one simulator exposure JSON file.

    Parameters
    ----------
    json_path:
        Path to a JSON file exported by the React C-arm simulator.

    Returns
    -------
    ImagingGeometry
        Validated physical imaging geometry.
    """
    path = Path(json_path)

    if not path.is_file():
        raise FileNotFoundError(f"Geometry JSON not found: {path}")

    try:
        with path.open("r", encoding="utf-8") as file:
            data = json.load(file)
    except json.JSONDecodeError as error:
        raise ValueError(
            f"Invalid JSON in {path}: line {error.lineno}, "
            f"column {error.colno}."
        ) from error

    try:
        source = _as_vector(
            data["source_position_world_mm"],
            "source_position_world_mm",
        )
        detector = _as_vector(
            data["detector_position_world_mm"],
            "detector_position_world_mm",
        )

        axes = data["camera_axes_world"]

        detector_x = _normalize(
            _as_vector(axes["x"], "camera_axes_world.x"),
            "camera_axes_world.x",
        )
        detector_y = _normalize(
            _as_vector(axes["y"], "camera_axes_world.y"),
            "camera_axes_world.y",
        )
        exported_normal = _normalize(
            _as_vector(axes["z"], "camera_axes_world.z"),
            "camera_axes_world.z",
        )

        image_geometry = data["image_geometry"]

        detector_width = int(image_geometry["width_px"])
        detector_height = int(image_geometry["height_px"])

        spacing = image_geometry["pixel_spacing_mm"]
        pixel_spacing = (float(spacing[0]), float(spacing[1]))

    except KeyError as error:
        raise ValueError(
            f"Required geometry field is missing: {error.args[0]}"
        ) from error
    except (TypeError, ValueError, IndexError) as error:
        raise ValueError(
            f"Invalid geometry value in {path}: {error}"
        ) from error

    if detector_width <= 0 or detector_height <= 0:
        raise ValueError("Detector pixel dimensions must be positive.")

    if pixel_spacing[0] <= 0 or pixel_spacing[1] <= 0:
        raise ValueError("Pixel spacing values must be positive.")

    source_to_detector = detector - source
    measured_sdd = float(np.linalg.norm(source_to_detector))

    if measured_sdd < 1e-6:
        raise ValueError(
            "Source position and detector position cannot be identical."
        )

    physical_normal = source_to_detector / measured_sdd

    declared_sdd = float(
        image_geometry.get(
            "source_to_detector_distance_mm",
            measured_sdd,
        )
    )

    if not np.isclose(
        measured_sdd,
        declared_sdd,
        rtol=1e-5,
        atol=1e-3,
    ):
        raise ValueError(
            "Source-to-detector distance mismatch: "
            f"positions imply {measured_sdd:.6f} mm, "
            f"but JSON declares {declared_sdd:.6f} mm."
        )

    tolerance = 1e-5

    if abs(float(np.dot(detector_x, detector_y))) > tolerance:
        raise ValueError("Detector X and Y axes are not orthogonal.")

    if abs(float(np.dot(detector_x, physical_normal))) > tolerance:
        raise ValueError("Detector X axis is not perpendicular to the beam.")

    if abs(float(np.dot(detector_y, physical_normal))) > tolerance:
        raise ValueError("Detector Y axis is not perpendicular to the beam.")

    if float(np.dot(exported_normal, physical_normal)) < 1.0 - tolerance:
        raise ValueError(
            "Exported camera Z axis does not match the physical "
            "source-to-detector direction."
        )

    handedness = float(
        np.dot(
            np.cross(detector_x, detector_y),
            physical_normal,
        )
    )

    if handedness < 1.0 - tolerance:
        raise ValueError(
            "Detector axes do not form the expected right-handed frame."
        )

    return ImagingGeometry(
        source_position=source,
        detector_center=detector,
        detector_x=detector_x,
        detector_y=detector_y,
        detector_normal=physical_normal,
        pixel_spacing=pixel_spacing,
        detector_width=detector_width,
        detector_height=detector_height,
        sdd=measured_sdd,
    )