# API Reference

## Production planning service

Base service:

```text
https://c-arm-guidance-simulator.onrender.com
```

### `POST /plan`

Plans movement from the current simulated C-arm pose to a requested final pose.

Typical request information includes:

- current C-arm pose
- target coordinates
- requested projection/view
- oblique angle
- waypoint count
- optional frontend-solved final pose
- optional scene-geometry verification payload

Typical response information includes:

- start pose
- final pose
- waypoint sequence
- planner confidence
- solver mode
- explanation
- optional geometry-verification metadata

The production V2 frontend calls this endpoint directly.

### `GET /health`

Where enabled, reports planning-service health and configuration information.

## Reference X-rays in V2

The current V2 frontend does **not** require an HTTP imaging request for every supported reference exposure.

Supported reference images are served as static Firebase Hosting assets from:

```text
3DVisualizer/ciartic-app/public/reference_xrays/
```

The frontend resolves supported anatomy/projection combinations through `REFERENCE_XRAY_MAP` in `App.jsx`.

Unsupported mappings produce an explicit no-reference-image state.

## Legacy / experimental imaging API

The repository retains experimental lightweight imaging infrastructure, including `/synthetic-xray`, for research and development.

That API should not be confused with the static reference-image path used by the current V2 frontend for supported mappings.

## Research disclaimer

These APIs support a research simulator. Their outputs are not clinically validated and must not be used to control or validate real patient imaging without appropriate engineering, safety, regulatory, and clinical validation.
