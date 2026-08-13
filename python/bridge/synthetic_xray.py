from __future__ import annotations

import base64
import os
from typing import Any

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

CLOUDFLARE_IMAGE_MODEL = "@cf/bytedance/stable-diffusion-xl-lightning"

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
        "Synthetic educational medical radiograph, fluoroscopy image, grayscale X-ray. "
        f"Anatomy: {anatomy}. Laterality: {laterality_text}. Projection/view: {view}. "
        f"C-arm angulation: {angle_text}; direction: {direction_text}. "
        "Center only the requested anatomy in the detector field. Realistic normal skeletal "
        "anatomy, radiographic bone and soft-tissue contrast, clinical fluoroscopy appearance, "
        "black background, no text, no labels, no arrows, no UI, no unrelated anatomy."
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

    response = requests.post(
        _cloudflare_endpoint(account_id),
        headers={
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
        },
        json={
            "prompt": prompt,
            "num_steps": 4,
            "width": 1024,
            "height": 1024,
        },
        timeout=120,
    )
    response.raise_for_status()

    content_type = response.headers.get("content-type", "").split(";", 1)[0].strip()
    if content_type.startswith("image/"):
        return base64.b64encode(response.content).decode("ascii"), content_type

    payload: dict[str, Any] = response.json()
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
    return {
        "configured": bool(account_id and api_token),
        "provider": "cloudflare_workers_ai",
        "model": CLOUDFLARE_IMAGE_MODEL,
    }


@router.post("/synthetic-xray", response_model=SyntheticXrayResponse)
def synthetic_xray(request: SyntheticXrayRequest) -> SyntheticXrayResponse:
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
    )
