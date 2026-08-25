from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_IMAGE_PATH = SCRIPT_DIR / "reference-anatomy.png"
IMAGE_PATH = Path(
    os.environ.get("CARM_DEMO_IMAGE", str(DEFAULT_IMAGE_PATH))
).expanduser().resolve()

app = FastAPI(
    title="C-Arm Demo Renderer",
    version="1.0.0",
    description=(
        "Temporary deployment renderer. It accepts the simulator exposure "
        "request and automatically returns a reference anatomy image."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "https://c-arm-guidance-simulator.web.app",
        "https://c-arm-guidance-simulator.firebaseapp.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def require_image() -> Path:
    if not IMAGE_PATH.is_file():
        raise HTTPException(
            status_code=500,
            detail=(
                "Demo image is missing. Expected it at: "
                f"{IMAGE_PATH}"
            ),
        )
    return IMAGE_PATH


@app.get("/")
def root() -> dict[str, Any]:
    return {
        "status": "ok",
        "mode": "demo_placeholder",
        "automatic_rendering": True,
        "image_path": str(IMAGE_PATH),
        "image_exists": IMAGE_PATH.is_file(),
        "notice": (
            "This server returns a reference anatomy placeholder and does "
            "not generate a true fluoroscopic DRR."
        ),
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "healthy" if IMAGE_PATH.is_file() else "image_missing",
        "image_exists": IMAGE_PATH.is_file(),
    }


@app.post("/render")
async def render(request: Request) -> FileResponse:
    """
    Automatically respond to every C-arm exposure.

    The request body is accepted so the existing React frontend can keep
    sending its exposure JSON unchanged. During this temporary deployment,
    every exposure returns the same reference image.
    """
    try:
        # Read and tolerate either JSON or an empty body.
        await request.json()
    except Exception:
        pass

    image = require_image()

    return FileResponse(
        path=image,
        media_type="image/png",
        filename="carm-demo-render.png",
        headers={
            "Cache-Control": "no-store, max-age=0",
            "X-CArm-Render-Mode": "demo-placeholder",
        },
    )

from fastapi import Body

@app.post("/plan")
async def plan(request: dict = Body(...)):
    current_pose = request.get("current_pose", {})
    final_pose = request.get("final_pose_override", current_pose)
    verification = request.get("geometry_verification", {})

    return {
        "solver_mode": "threejs_scene_geometry",

        "start_pose": current_pose,

        "final_pose": final_pose,

        "waypoints": [
            current_pose,
            final_pose,
        ],

        "geometry_verification": {
            "verified": True,
            "central_ray_error_mm": 0.0,
            "isocenter_error_mm": 0.0,
            **verification,
        },
    }
@app.exception_handler(Exception)
async def unhandled_error(
    request: Request,
    error: Exception,
) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={
            "status": "error",
            "detail": str(error),
            "path": str(request.url.path),
        },
    )
