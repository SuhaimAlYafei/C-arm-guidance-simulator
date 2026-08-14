# System Architecture

This document describes the current deployed architecture of the AI-Guided C-Arm Positioning Simulator.

## 1. High-level system

The simulator is split into three main runtime components:

1. **Web frontend** — React + Three.js, deployed on Vercel.
2. **Planning backend** — FastAPI service containing the heavier planning / research stack, deployed on Render.
3. **Lightweight imaging backend** — FastAPI service responsible for projection-specific radiographic output, deployed separately on Render.

```text
User
 │
 ▼
React + Three.js frontend
 │
 ├──────── POST /plan ────────────► Planning backend
 │                                  ├─ final-pose handling
 │                                  ├─ geometry verification checks
 │                                  ├─ waypoint generation
 │                                  └─ confidence / explanation
 │
 └──── POST /synthetic-xray ─────► Imaging backend
                                    ├─ anatomy normalization
                                    ├─ laterality detection
                                    ├─ projection normalization
                                    └─ reference-radiograph resolver
```

## 2. Frontend responsibilities

The frontend under `3DVisualizer/ciartic-app` owns the interactive simulation experience.

Its responsibilities include:

- rendering the patient and C-arm digital twin
- anatomical landmark selection
- projection selection
- C-arm control state
- live Three.js transform evaluation
- source / detector anchor tracking
- target alignment
- central-ray and isocenter verification
- planner request construction
- waypoint playback
- simulated exposure workflow
- fluoroscopy display

The frontend can solve a final pose from the live Three.js hierarchy and submit the pose to the backend together with geometry-verification metadata.

## 3. Planning backend

Primary entry point:

```text
python/bridge/api.py
```

Important endpoint:

```http
POST /plan
```

The planning backend accepts the current C-arm pose, target point, requested projection, waypoint count, and optionally a frontend-verified final pose.

When a verified final pose is provided, the backend checks the supplied geometry-verification values against its acceptance limit before generating the path.

The current engineering threshold is 1 mm for the simulator's scene-geometry verification. This is an internal software acceptance limit, not a demonstrated clinical accuracy figure.

The backend returns:

- start pose
- final pose
- interpolated waypoints
- confidence metadata
- explanatory notes
- solver mode
- optional geometry-verification payload

## 4. Imaging backend

Entry point:

```text
python/bridge/synthetic_server.py
```

Resolver:

```text
python/bridge/synthetic_xray.py
```

Important endpoint:

```http
POST /synthetic-xray
```

The service accepts:

```json
{
  "anatomy": "Left Hand",
  "view": "AP",
  "laterality": "left",
  "angulation_deg": 0,
  "angulation_direction": null
}
```

The resolver normalizes the request and attempts to locate the matching image under:

```text
python/bridge/reference_xrays/
```

Examples:

```text
Left Hand + AP       -> left_hand_ap.png
Left Hand + Lateral  -> left_hand_lateral.png
Right Knee + AP      -> right_knee_ap.png
Cervical Spine + AP  -> cervical_spine_ap.png
Chest + Lateral      -> chest_lateral.png
```

This deterministic mapping is preferred for the current expert-facing demonstration because unconstrained generative image models may produce anatomically incorrect or projection-inconsistent output.

## 5. Why the imaging service is separate

The original planning/render environment includes research dependencies such as PyTorch, CUDA-related packages, VTK, PyVista, and DiffDRR. These make cold builds and imports expensive on a lightweight cloud instance.

The imaging API only needs a small dependency set, so it is deployed independently using:

```text
python/requirements-synthetic.txt
```

This separation provides:

- faster deployment
- faster service startup
- reduced coupling
- simpler failure isolation
- lower risk that an imaging change destabilizes the planner

## 6. Reference-radiograph library

The current reference library covers major anatomical regions with AP and lateral views, plus selected oblique views.

The library is intended for research demonstration and simulator visualization. It is not a validated diagnostic dataset.

Any image included in the repository should:

- contain no patient-identifiable information
- be appropriate for redistribution under its source license/permission
- be labeled consistently with the resolver naming convention
- be reviewed for anatomy and projection before use

## 7. Deployment

### Frontend

Deployed on Vercel and served through:

```text
https://c-armsim.com
```

### Planning backend

Render service for the main planning stack.

### Imaging backend

Render service for the lightweight synthetic/reference X-ray API.

The frontend calls each backend directly over HTTPS with CORS configured for the production domain.

## 8. Current research boundary

The architecture supports simulation and engineering evaluation. It does not currently establish:

- clinical positioning accuracy
- patient-specific registration accuracy
- radiation-dose reduction
- diagnostic accuracy
- autonomous device safety
- regulatory compliance

Those require separate experimental and clinical validation.
