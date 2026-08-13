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


def _normalize(value: str | None) -> str:
    return (value or "").strip().lower().replace("_", " ")


def _is_left_hand_frontal(request: SyntheticXrayRequest) -> bool:
    anatomy = _normalize(request.anatomy)
    laterality = _normalize(request.laterality)
    view = _normalize(request.view)

    is_hand = "hand" in anatomy
    is_left = "left" in anatomy or laterality == "left"
    is_frontal = view in {"ap", "pa", "frontal", "anterior posterior", "posteroanterior"}
    return is_hand and is_left and is_frontal


def _read_reference_image(request: SyntheticXrayRequest) -> bytes | None:
    if not _is_left_hand_frontal(request):
        return None
    path = REFERENCE_DIR / "left_hand_ap.png"
    if not path.exists():
        return None
    return path.read_bytes()


def build_prompt(
    anatomy: str,
    view: str,
    laterality: str | None = None,
    angulation_deg: float | None = None,
    angulation_direction: str | None = None,
    using_reference: bool = False,
) -> str:
    laterality_text = laterality or "unspecified"
    angle_text = (
        f"{abs(angulation_deg):.1f} degrees"
        if angulation_deg is not None
        else "none"
    )
    direction_text = angulation_direction or "none"

    if using_reference:
        return (
            "Preserve the anatomy and projection of the supplied reference radiograph. "
            f"Requested anatomy: {anatomy}. Laterality: {laterality_text}. View: {view}. "
            f"C-arm angulation: {angle_text}; direction: {direction_text}. "
            "Make only subtle detector-style variation: small changes in exposure, contrast, "
            "grain/noise, and very slight positioning. Keep exactly one hand, five digits, the "
            "same wrist and carpal relationships, and the same frontal projection. Do not add "
            "or remove bones. No skull, no torso, no extra limbs, no collage, no diagrams, no "
            "text, no labels, no arrows, no UI. Output a single realistic grayscale fluoroscopy/"
            "radiograph image only."
        )

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


def generate_image(prompt: str, reference_bytes: bytes | None = None) -> tuple[str, str]:
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

    if reference_bytes:
        payload["image_b64"] = base64.b64encode(reference_bytes).decode("ascii")
        payload["strength"] = 0.12
        payload["guidance"] = 7.0

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
    reference_path = REFERENCE_DIR / "left_hand_ap.png"
    return {
        "configured": bool(account_id and api_token),
        "provider": "cloudflare_workers_ai",
        "model": CLOUDFLARE_IMAGE_MODEL,
        "left_hand_ap_reference": reference_path.exists(),
    }


@router.post("/synthetic-xray", response_model=SyntheticXrayResponse)
def synthetic_xray(request: SyntheticXrayRequest) -> SyntheticXrayResponse:
    reference_bytes = _read_reference_image(request)
    prompt = build_prompt(
        anatomy=request.anatomy,
        view=request.view,
        laterality=request.laterality,
        angulation_deg=request.angulation_deg,
        angulation_direction=request.angulation_direction,
        using_reference=reference_bytes is not None,
    )

    try:
        image_base64, mime_type = generate_image(prompt, reference_bytes)
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
        source=(
            "cloudflare_sdxl_reference_img2img"
            if reference_bytes is not None
            else "cloudflare_sdxl_lightning"
        ),
        model=CLOUDFLARE_IMAGE_MODEL,
        synthetic=True,
        anatomy=request.anatomy,
        view=request.view,
        reference_used=reference_bytes is not None,
    )
