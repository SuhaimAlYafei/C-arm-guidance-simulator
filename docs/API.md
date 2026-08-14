# API Reference

## Main planning service

### `GET /health`

Reports planner/backend status, registered CT availability, render dimensions, SID, and the configured maximum verified alignment error.

### `POST /plan`

Plans movement from the current C-arm pose to the requested target pose.

Key request fields include:

- current pose
- target coordinates
- projection/view
- oblique angle
- waypoint count
- optional frontend-solved final-pose override
- optional geometry-verification payload

The response includes:

- start pose
- final pose
- waypoint sequence
- confidence information
- solver mode
- explanation
- optional geometry-verification metadata

When a frontend-solved final pose is supplied, the backend requires geometry verification and rejects solutions outside the configured scene-geometry tolerance.

## Lightweight imaging service

### `GET /synthetic-xray/health`

Reports the lightweight imaging-service configuration and reference-library status.

### `POST /synthetic-xray`

Accepts a structured imaging request and returns a base64-encoded image.

Typical request fields:

```json
{
  "anatomy": "Neck (Cervical Spine)",
  "view": "AP",
  "laterality": null,
  "angulation_deg": 0,
  "angulation_direction": null
}
```

Typical response fields:

```json
{
  "image_base64": "...",
  "mime_type": "image/png",
  "source": "verified_reference_radiograph",
  "model": "none",
  "synthetic": false,
  "anatomy": "Neck (Cervical Spine)",
  "view": "AP",
  "reference_used": true
}
```

## Reference resolution

The lightweight imaging backend normalizes anatomy, laterality, and projection names, then attempts to resolve a matching image in:

```text
python/bridge/reference_xrays/
```

Examples include:

```text
cervical_spine_ap.png
chest_lateral.png
left_shoulder_oblique.png
right_knee_ap.png
```

## Research disclaimer

These APIs support a research simulator. Their outputs are not clinically validated and must not be used to control or validate real patient imaging without appropriate engineering, safety, regulatory, and clinical validation.
