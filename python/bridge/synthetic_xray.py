from __future__ import annotations

import base64
import os
from pathlib import Path
from typing import Any

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

CLOUDFLARE_IMAGE_MODEL = "@cf/bytedance/stable-diffusion-xl-lightning"
REFERENCE_DIR = Path(__file__).resolve().parent / "reference_xrays"

router = APIRouter()


class SyntheticXrayRequest(BaseModel):
    anatomy: str = Field(min_length=1, max_length=80)
    view: str = Field(default="AP", min_length=1, max_length=80)
    laterality: str | None = Field(default=None, max_length=20)
    angulation_deg: float | None = Field(default=None, ge=-90.0, le=90.0)
    angulation_direction: str | None = Field(default=None, max_length=20)


class SyntheticXrayResponse(BaseModel):
    image_base64: str
    mime_type: str
    source: str
    model: str
    synthetic: bool = True
    anatomy: str
    view: str
    reference_used: bool = False
    reference_filename: str | None = None


def _normalize(value: str | None) -> str:
    return " ".join((value or "").strip().lower().replace("_", " ").replace("-", " ").split())


def _laterality(request: SyntheticXrayRequest) -> str | None:
    anatomy = _normalize(request.anatomy)
    explicit = _normalize(request.laterality)
    if explicit in {"left", "right"}:
        return explicit
    if "left" in anatomy:
        return "left"
    if "right" in anatomy:
        return "right"
    return None


def _view_key(request: SyntheticXrayRequest) -> str:
    view = _normalize(request.view)
    direction = _normalize(request.angulation_direction)

    if "axillary" in view or "axial" in view:
        return "axillary"
    if "oblique" in view or "grashey" in view:
        return "oblique"
    if "lateral" in view or view in {"lat", "side"}:
        return "lateral"
    if direction in {"cranial", "caudal"}:
        # No dedicated cranial/caudal reference library yet. Keep these out of the
        # verified-reference resolver so they cannot be mislabeled as AP.
        return direction
    if view in {
        "ap", "pa", "frontal", "front", "anterior posterior",
        "anteroposterior", "posteroanterior", "posterior anterior",
    }:
        return "ap"
    return view or "ap"


def _anatomy_key(request: SyntheticXrayRequest) -> str | None:
    anatomy = _normalize(request.anatomy)

    # Central landmarks. The frontend often includes both the clinical label and
    # the registered spine region, e.g. "Neck (Cervical Spine)".
    if any(token in anatomy for token in ("skull", "head")):
        return "skull"
    if any(token in anatomy for token in ("cervical", "neck")):
        return "cervical_spine"
    if any(token in anatomy for token in ("chest", "thorax", "thoracic", "upper spine")):
        return "chest"
    if any(token in anatomy for token in ("abdomen", "lumbar", "mid spine")):
        return "abdomen"
    if any(token in anatomy for token in ("pelvis", "pelvic", "lower spine")):
        return "pelvis"

    # Limb landmarks.
    for key in ("shoulder", "elbow", "wrist", "hand", "hip", "knee", "ankle"):
        if key in anatomy:
            return key

    # The scene landmark names the distal leg point as foot, but the verified
    # radiographs collected for that landmark are ankle views.
    if any(token in anatomy for token in ("foot", "feet")):
        return "ankle"

    return None


def _reference_filename(request: SyntheticXrayRequest) -> str | None:
    anatomy_key = _anatomy_key(request)
    view_key = _view_key(request)
    side = _laterality(request)

    if anatomy_key is None:
        return None

    # Central anatomy has no laterality in the filename.
    if anatomy_key in {"skull", "cervical_spine", "chest", "abdomen", "pelvis"}:
        candidate = f"{anatomy_key}_{view_key}.png"
        return candidate if (REFERENCE_DIR / candidate).is_file() else None

    # Limbs require left/right separation to prevent side mix-ups.
    if side not in {"left", "right"}:
        return None

    candidate = f"{side}_{anatomy_key}_{view_key}.png"
    return candidate if (REFERENCE_DIR / candidate).is_file() else None


def _reference_path(request: SyntheticXrayRequest) -> Path | None:
    filename = _reference_filename(request)
    if not filename:
        return None
    return REFERENCE_DIR / filename


def build_prompt(
    anatomy: str,
    view: str,
    laterality: str | None = None,
    angulation_deg: float | None = None,
    angulation_direction: str | None = None,
) -> str:
    laterality_text = laterality or "unspecified"
    angle_text = (
        f"{abs(angulation_deg):.1f} degrees"
        if angulation_deg is not None
        else "none"
    )
    direction_text = angulation_direction or "none"

    return (
        "Single synthetic educational grayscale radiograph only. "
        f"Anatomy: {anatomy}. Laterality: {laterality_text}. Projection/view: {view}. "
        f"C-arm angulation: {angle_text}; direction: {direction_text}. "
        "Center only the requested anatomy in the detector field. Realistic normal skeletal "
        "anatomy and radiographic contrast. No skull unless requested, no whole-body skeleton, "
        "no collage, no diagrams, no text, no labels, no arrows, no UI, no unrelated anatomy."
    )


def _cloudflare_endpoint(account_id: str) -> str:
    return (
        f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/"
        f"{CLOUDFLARE_IMAGE_MODEL}"
    )


def generate_image(prompt: str) -> tuple[str, str]:
    account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID", "").strip()
    api_token = os.getenv("CLOUDFLARE_API_TOKEN", "").strip()
    if not account_id or not api_token:
        raise RuntimeError(
            "CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN is not configured"
        )

    payload: dict[str, Any] = {
        "prompt": prompt,
        "negative_prompt": (
            "whole body skeleton, skull, torso, multiple hands, extra fingers, missing fingers, "
            "duplicate bones, collage, medical poster, diagram, infographic, text, labels, arrows, UI"
        ),
        "num_steps": 4,
        "width": 1024,
        "height": 1024,
    }

    response = requests.post(
        _cloudflare_endpoint(account_id),
        headers={
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=120,
    )
    response.raise_for_status()

    content_type = response.headers.get("content-type", "").split(";", 1)[0].strip()
    if content_type.startswith("image/"):
        return base64.b64encode(response.content).decode("ascii"), content_type

    payload = response.json()
    result = payload.get("result")

    if isinstance(result, str) and result:
        return result, "image/png"

    if isinstance(result, dict):
        image_data = result.get("image") or result.get("data")
        if isinstance(image_data, str) and image_data:
            return image_data, str(result.get("mime_type") or "image/png")

    raise RuntimeError("Cloudflare Workers AI returned no image data")


@router.get("/synthetic-xray/health")
def synthetic_xray_health() -> dict[str, Any]:
    account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID", "").strip()
    api_token = os.getenv("CLOUDFLARE_API_TOKEN", "").strip()
    reference_files = sorted(path.name for path in REFERENCE_DIR.glob("*.png"))
    return {
        "configured": bool(account_id and api_token),
        "provider": "verified_reference_library_with_cloudflare_fallback",
        "model": CLOUDFLARE_IMAGE_MODEL,
        "reference_directory": str(REFERENCE_DIR),
        "verified_reference_count": len(reference_files),
        "verified_references": reference_files,
    }


@router.post("/synthetic-xray", response_model=SyntheticXrayResponse)
def synthetic_xray(request: SyntheticXrayRequest) -> SyntheticXrayResponse:
    reference_path = _reference_path(request)

    # Every anatomy/view with a verified image uses that image deterministically.
    # This prevents generative anatomy hallucinations in expert-facing demos.
    if reference_path is not None:
        image_base64 = base64.b64encode(reference_path.read_bytes()).decode("ascii")
        return SyntheticXrayResponse(
            image_base64=image_base64,
            mime_type="image/png",
            source="verified_reference_radiograph",
            model="none",
            synthetic=False,
            anatomy=request.anatomy,
            view=request.view,
            reference_used=True,
            reference_filename=reference_path.name,
        )

    # Keep the existing Cloudflare fallback only for a view that has no verified
    # reference yet. It is explicitly marked synthetic in the response.
    prompt = build_prompt(
        anatomy=request.anatomy,
        view=request.view,
        laterality=request.laterality,
        angulation_deg=request.angulation_deg,
        angulation_direction=request.angulation_direction,
    )

    try:
        image_base64, mime_type = generate_image(prompt)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except requests.HTTPError as error:
        detail = "Cloudflare Workers AI returned an error"
        if error.response is not None:
            detail = (
                f"Cloudflare Workers AI HTTP {error.response.status_code}: "
                f"{error.response.text[:800]}"
            )
        raise HTTPException(status_code=502, detail=detail) from error
    except requests.RequestException as error:
        raise HTTPException(
            status_code=502,
            detail=f"Cloudflare Workers AI request failed: {error}",
        ) from error

    return SyntheticXrayResponse(
        image_base64=image_base64,
        mime_type=mime_type,
        source="cloudflare_sdxl_lightning",
        model=CLOUDFLARE_IMAGE_MODEL,
        synthetic=True,
        anatomy=request.anatomy,
        view=request.view,
        reference_used=False,
        reference_filename=None,
    )
