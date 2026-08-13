from __future__ import annotations

import os
from typing import Any

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image"
GEMINI_IMAGE_ENDPOINT = (
    "https://generativelanguage.googleapis.com/v1/models/"
    f"{GEMINI_IMAGE_MODEL}:generateContent"
)

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
        "Create a synthetic educational radiograph-style image for a C-arm simulator. "
        f"Anatomy: {anatomy}. Laterality: {laterality_text}. View: {view}. "
        f"Angulation: {angle_text}; direction: {direction_text}. "
        "Center the requested anatomy in a square grayscale fluoroscopy field. "
        "Use realistic normal anatomy and radiographic contrast. Do not add text, "
        "labels, arrows, interface elements, or unrelated anatomy."
    )


def generate_image(prompt: str) -> tuple[str, str]:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured")

    response = requests.post(
        GEMINI_IMAGE_ENDPOINT,
        headers={
            "x-goog-api-key": api_key,
            "Content-Type": "application/json",
        },
        json={
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseModalities": ["IMAGE"],
                "responseFormat": {
                    "image": {
                        "aspectRatio": "1:1",
                        "imageSize": "1K",
                    }
                },
            },
        },
        timeout=120,
    )
    response.raise_for_status()
    payload: dict[str, Any] = response.json()

    for candidate in payload.get("candidates", []):
        for part in (candidate.get("content") or {}).get("parts", []):
            inline_data = part.get("inlineData") or part.get("inline_data")
            if not inline_data:
                continue
            data = inline_data.get("data")
            if data:
                mime_type = (
                    inline_data.get("mimeType")
                    or inline_data.get("mime_type")
                    or "image/png"
                )
                return str(data), str(mime_type)

    raise RuntimeError("Image provider returned no image data")


@router.get("/synthetic-xray/health")
def synthetic_xray_health() -> dict[str, Any]:
    return {
        "configured": bool(os.getenv("GEMINI_API_KEY", "").strip()),
        "model": GEMINI_IMAGE_MODEL,
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
        detail = "Image provider returned an error"
        if error.response is not None:
            detail = f"Image provider HTTP {error.response.status_code}: {error.response.text[:800]}"
        raise HTTPException(status_code=502, detail=detail) from error
    except requests.RequestException as error:
        raise HTTPException(
            status_code=502,
            detail=f"Image provider request failed: {error}",
        ) from error

    return SyntheticXrayResponse(
        image_base64=image_base64,
        mime_type=mime_type,
        source="gemini_synthetic_image",
        model=GEMINI_IMAGE_MODEL,
        synthetic=True,
        anatomy=request.anatomy,
        view=request.view,
    )
