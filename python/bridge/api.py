from __future__ import annotations

import base64
import json
import os
import tempfile
from pathlib import Path
from typing import Any
from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from geometry_bridge import run_bridge

from .planner.confidence import calculate_confidence
from .planner.path_planner import create_path
from .planner.pose_solver import CArmPose, TargetPoint, solve_target_pose


EXPECTED_CT_DATASET_ID = "s0777"
EXPECTED_CT_FILENAMES = (
    "ct.nii",
    "ct.nii.gz",
)

SID_MM = 850.0
RENDER_WIDTH = 256
RENDER_HEIGHT = 256
MAX_VERIFIED_ALIGNMENT_ERROR_MM = 1.0

API_DIRECTORY = Path(__file__).resolve().parent
# Expected layout: <repository>/python/bridge/api.py
REPOSITORY_ROOT = API_DIRECTORY.parents[1]


app = FastAPI(
    title="C-arm DiffDRR Renderer and Strict Dataset Planner",
    version="1.4.0",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "https://c-arm-guidance-simulator.web.app",
        "https://c-arm-guidance-simulator.firebaseapp.com",
        "https://c-arm-guidance-simulator.vercel.app",
        "https://c-armsim.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RenderRequest(BaseModel):
    exposure: dict[str, Any]


class RenderResponse(BaseModel):
    image_base64: str
    mime_type: str
    width: int
    height: int
    dataset_id: str
    ct_path: str
    selected_landmark: dict[str, Any] | None = None


class PoseModel(BaseModel):
    lift: float
    column_rot: float
    wig_wag: float
    orbital_slide: float
    cart_x: float
    cart_z: float


class TargetModel(BaseModel):
    x_mm: float
    y_mm: float
    z_mm: float


class WorldPointModel(BaseModel):
    x: float
    y: float
    z: float


class GeometryVerificationModel(BaseModel):
    verified: bool
    tolerance_mm: float
    isocenter_error_mm: float
    central_ray_error_mm: float
    target_world_mm: WorldPointModel
    isocenter_world_mm: WorldPointModel
    source_world_mm: WorldPointModel
    detector_world_mm: WorldPointModel


class PlanRequest(BaseModel):
    current_pose: PoseModel
    target: TargetModel
    view: str = "AP"
    oblique_angle_deg: float = 30.0
    waypoint_count: int = Field(default=21, ge=2, le=200)
    final_pose_override: PoseModel | None = None
    geometry_verification: GeometryVerificationModel | None = None


class PlanResponse(BaseModel):
    start_pose: dict[str, float]
    final_pose: dict[str, float]
    waypoints: list[dict[str, Any]]
    confidence: dict[str, Any]
    explanation: list[str]
    solver_mode: str
    geometry_verification: dict[str, Any] | None = None


def _candidate_ct_paths() -> list[Path]:
    """
    Return likely locations for the exact registered CT.

    CARM_CT_PATH has highest priority and may point either to the file itself
    or to a directory containing the expected filename.
    """

    candidates: list[Path] = []

    environment_path = os.getenv("CARM_CT_PATH", "").strip()
    if environment_path:
        supplied = Path(environment_path).expanduser()
        if supplied.suffix.lower() in {".nii", ".gz"}:
            candidates.append(supplied)
        else:
            for filename in EXPECTED_CT_FILENAMES:
                candidates.append(supplied / filename)

    roots = [
        REPOSITORY_ROOT / "3DVisualizer" / "ciartic-app" / "public" / "CT",
        REPOSITORY_ROOT / "ciartic-app" / "public" / "CT",
        REPOSITORY_ROOT / "public" / "CT",
        REPOSITORY_ROOT / "CT",
        Path.cwd() / "3DVisualizer" / "ciartic-app" / "public" / "CT",
        Path.cwd() / "ciartic-app" / "public" / "CT",
        Path.cwd() / "public" / "CT",
        Path.cwd() / "CT",
        Path.home() / "Downloads",
    ]

    for root in roots:
        for filename in EXPECTED_CT_FILENAMES:
            candidates.append(root / filename)

    # Deduplicate without requiring the paths to exist.
    unique: list[Path] = []
    seen: set[str] = set()

    for candidate in candidates:
        key = str(candidate).lower()
        if key not in seen:
            seen.add(key)
            unique.append(candidate)

    return unique


def resolve_registered_ct_path() -> Path:
    for candidate in _candidate_ct_paths():
        if candidate.is_file():
            return candidate.resolve()

    checked = "\n".join(f" - {path}" for path in _candidate_ct_paths())

    raise FileNotFoundError(
        "The registered head/neck CT dataset was not found.\n"
        f"Required dataset: {EXPECTED_CT_DATASET_ID}\n"
        "The renderer intentionally refused to fall back to LIDC_CT.nii.gz "
        "because that is a chest CT and produces anatomically wrong images.\n"
        "Checked:\n"
        f"{checked}\n"
        "Set CARM_CT_PATH to the correct .nii or .nii.gz file if it is stored "
        "elsewhere."
    )


def pose_from_model(model: PoseModel) -> CArmPose:
    return CArmPose(
        lift=model.lift,
        column_rot=model.column_rot,
        wig_wag=model.wig_wag,
        orbital_slide=model.orbital_slide,
        cart_x=model.cart_x,
        cart_z=model.cart_z,
    )


@app.get("/health")
def health() -> dict[str, Any]:
    try:
        ct_path = resolve_registered_ct_path()
        ct_exists = True
        ct_error = None
    except FileNotFoundError as error:
        ct_path = None
        ct_exists = False
        ct_error = str(error)

    return {
        "status": "ok" if ct_exists else "ct_missing",
        "planner_mode": "threejs_scene_geometry",
        "dataset_id": EXPECTED_CT_DATASET_ID,
        "ct_path": str(ct_path) if ct_path else None,
        "ct_exists": ct_exists,
        "ct_error": ct_error,
        "render_size": {
            "width": RENDER_WIDTH,
            "height": RENDER_HEIGHT,
        },
        "sid_mm": SID_MM,
        "maximum_verified_alignment_error_mm": MAX_VERIFIED_ALIGNMENT_ERROR_MM,
    }


@app.post("/plan", response_model=PlanResponse)
def plan(request: PlanRequest) -> PlanResponse:
    try:
        current_pose = pose_from_model(request.current_pose)

        target = TargetPoint(
            x_mm=request.target.x_mm,
            y_mm=request.target.y_mm,
            z_mm=request.target.z_mm,
        )

        if request.final_pose_override is not None:
            if request.geometry_verification is None:
                raise ValueError(
                    "A final_pose_override requires geometry_verification."
                )

            verification = request.geometry_verification
            if not verification.verified:
                raise ValueError("Scene geometry was not marked as verified.")

            if verification.tolerance_mm > MAX_VERIFIED_ALIGNMENT_ERROR_MM:
                raise ValueError(
                    "Requested geometry tolerance is weaker than the backend limit."
                )

            if (
                verification.isocenter_error_mm > MAX_VERIFIED_ALIGNMENT_ERROR_MM
                or verification.central_ray_error_mm > MAX_VERIFIED_ALIGNMENT_ERROR_MM
            ):
                raise ValueError(
                    "Verified pose exceeds the 1 mm scene-geometry limit."
                )

            final_pose = pose_from_model(request.final_pose_override)
            solver_mode = "threejs_scene_geometry"
            explanation = [
                "Used the exact final pose solved from the live Three.js hierarchy.",
                (
                    "Frontend verification: isocenter error "
                    f"{verification.isocenter_error_mm:.4f} mm; central-ray error "
                    f"{verification.central_ray_error_mm:.4f} mm."
                ),
                "Backend generated the path without recalculating the verified pose.",
            ]
            geometry_verification: dict[str, Any] | None = (
                verification.model_dump()
                if hasattr(verification, "model_dump")
                else verification.dict()
            )

        else:
            solution = solve_target_pose(
                current_pose=current_pose,
                target=target,
                view=request.view,
                oblique_angle_deg=request.oblique_angle_deg,
            )
            final_pose = solution.final_pose
            solver_mode = "live_encoder_pose_fallback"
            explanation = solution.explanation
            geometry_verification = None

        waypoints = create_path(
            current_pose=current_pose,
            final_pose=final_pose,
            waypoint_count=request.waypoint_count,
        )

        confidence = calculate_confidence(
            target=target,
            final_pose=final_pose,
        ).to_dict()

        if geometry_verification is not None:
            confidence["components"]["scene_geometry_alignment"] = 1.0
            confidence["notes"] = [
                *confidence.get("notes", []),
                "Selected target verified against the live Three.js central ray within 1 mm.",
            ]

        return PlanResponse(
            start_pose=current_pose.to_dict(),
            final_pose=final_pose.to_dict(),
            waypoints=[waypoint.to_dict() for waypoint in waypoints],
            confidence=confidence,
            explanation=explanation,
            solver_mode=solver_mode,
            geometry_verification=geometry_verification,
        )

    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Planning failed: {error}",
        ) from error


@app.post("/render", response_model=RenderResponse)
def render(request: RenderRequest) -> RenderResponse:
    exposure = request.exposure

    requested_dataset_id = str(
        exposure.get("ct_dataset_id", "")
    ).strip()

    requested_dataset_id = str(
    exposure.get("ct_dataset_id", "")
)

# TEMPORARY: allow any CT dataset ID
    resolved_dataset_id = requested_dataset_id or EXPECTED_CT_DATASET_ID

    requested_path = str(
        exposure.get("ct_volume_path", "")
    ).replace("\\", "/")

    if requested_path:
        requested_filename = requested_path.rsplit("/", 1)[-1]
       # TEMPORARY: allow any CT filename for demo use
        resolved_ct_filename = requested_filename
            

    try:
        ct_path = resolve_registered_ct_path()
    except FileNotFoundError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

    try:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temp_dir = Path(temporary_directory)
            json_path = temp_dir / "exposure.json"
            output_path = temp_dir / "render.png"

            # Record the actual resolved dataset used for reproducibility.
            render_exposure = {
                **exposure,
                "resolved_ct_dataset_id": requested_dataset_id or EXPECTED_CT_DATASET_ID,
                "resolved_ct_path": str(ct_path),
            }

            json_path.write_text(
                json.dumps(render_exposure, indent=2),
                encoding="utf-8",
            )

            run_bridge(
                json_path=json_path,
                ct_path=ct_path,
                output_path=output_path,
                sid_mm=SID_MM,
                render_width=RENDER_WIDTH,
                render_height=RENDER_HEIGHT,
            )

            if not output_path.is_file():
                raise RuntimeError(
                    "DiffDRR did not create the expected output image."
                )

            image_bytes = output_path.read_bytes()
            if not image_bytes:
                raise RuntimeError("The generated DRR image was empty.")

            encoded = base64.b64encode(image_bytes).decode("ascii")

            selected_landmark = exposure.get("selected_landmark")
            if not isinstance(selected_landmark, dict):
                selected_landmark = None

            return RenderResponse(
                image_base64=encoded,
                mime_type="image/png",
                width=RENDER_WIDTH,
                height=RENDER_HEIGHT,
               dataset_id=requested_dataset_id or EXPECTED_CT_DATASET_ID,
                ct_path=str(ct_path),
                selected_landmark=selected_landmark,
            )

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Rendering failed: {error}",
        ) from error


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "bridge.api:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )
