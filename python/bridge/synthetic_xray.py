from __future__ import annotations

import os
from typing import Any

import requests

GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image"
GEMINI_IMAGE_ENDPOINT = (
    "https://generativelanguage.googleapis.com/v1/models/"
    f"{GEMINI_IMAGE_MODEL}:generateContent"
)


def build_prompt(
    anatomy: str,
    view: str,
    laterality: str | None = None,
    angulation_deg: float | None = None,
    angulation_direction: str | None = None,
) -> str:
    laterality_text = laterality or "unspecified"
    angle_text = f"{abs(angulation_deg):.1f} degrees" if angulation_deg is not None else "none"
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
                "imageConfig": {"aspectRatio": "1:1"},
            },
        },
        timeout=90,
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
                mime_type = inline_data.get("mimeType") or inline_data.get("mime_type") or "image/png"
                return str(data), str(mime_type)

    raise RuntimeError("Image provider returned no image data")
