# AI-Guided C-Arm Positioning Simulator

<p align="center">
  <strong>Digital-twin research platform for anatomy-aware C-arm positioning, path planning, geometry verification, and simulated fluoroscopic acquisition.</strong>
</p>

<p align="center">
  <a href="https://c-armsim.com"><strong>Live Simulator</strong></a>
  ·
  <a href="#system-architecture">Architecture</a>
  ·
  <a href="#running-locally">Run Locally</a>
  ·
  <a href="#research-status-and-limitations">Research Status</a>
</p>

<p align="center">
  <img alt="React" src="https://img.shields.io/badge/Frontend-React-20232A?logo=react&logoColor=61DAFB">
  <img alt="Three.js" src="https://img.shields.io/badge/3D-Three.js-black?logo=threedotjs&logoColor=white">
  <img alt="FastAPI" src="https://img.shields.io/badge/API-FastAPI-009688?logo=fastapi&logoColor=white">
  <img alt="Python" src="https://img.shields.io/badge/Backend-Python-3776AB?logo=python&logoColor=white">
  <img alt="Vercel" src="https://img.shields.io/badge/Frontend-Vercel-black?logo=vercel&logoColor=white">
  <img alt="Render" src="https://img.shields.io/badge/Backend-Render-46E3B7?logo=render&logoColor=black">
</p>

---

## Overview

This repository contains a research simulator for **AI-guided and geometry-aware C-arm positioning**. The system combines an interactive 3D digital twin, anatomical landmark targeting, automated pose solving, waypoint-based motion planning, geometry verification, and projection-specific simulated radiographic output.

The simulator is designed to explore a practical question in fluoroscopy-guided procedures: **can a C-arm be guided back to a desired anatomical view in a reproducible and explainable way, while reducing unnecessary manual repositioning?**

> **Research use only.** This project is not a medical device, is not clinically validated, and must not be used for diagnosis, treatment, or patient care.

### Live demo

**https://c-armsim.com**

---

## Key Features

- Interactive 3D C-arm digital twin built with React and Three.js
- Anatomical landmark selection across the head, torso, upper extremities, and lower extremities
- AP, lateral, and selected oblique projection workflows
- Scene-geometry pose solving using the live Three.js hierarchy
- Waypoint-based C-arm motion planning
- Central-ray and isocenter geometry checks before exposure
- Backend confidence reporting and planning explanations
- Projection-specific reference-radiograph library for deterministic demo output
- Separate lightweight synthetic X-ray service for fast deployment and isolation from the heavier planning stack
- FastAPI planning and imaging services
- Dataset, model-training, evaluation, and analysis utilities
- Hardware-prototype and hardware-in-the-loop development assets

---

## Simulator Workflow

```text
Clinical imaging request
        │
        ▼
Select anatomy + projection
        │
        ▼
Select / calibrate anatomical landmark
        │
        ▼
Solve C-arm target pose from live 3D scene geometry
        │
        ▼
Verify isocenter + central-ray alignment
        │
        ▼
Generate waypoint path
        │
        ▼
Move digital C-arm
        │
        ▼
ARRIVED + geometry verification
        │
        ▼
EXPOSE X-RAY
        │
        ▼
Projection-specific simulated radiographic view
```

The current frontend uses the selected anatomical landmark and projection to request the corresponding radiographic output after the C-arm reaches the planned pose.

---

## System Architecture

```text
┌────────────────────────────── Browser / Vercel ──────────────────────────────┐
│                                                                              │
│  React UI                                                                    │
│    ├─ Anatomy + projection selection                                         │
│    ├─ Three.js digital twin                                                  │
│    ├─ Landmark registration                                                  │
│    ├─ C-arm kinematics                                                       │
│    ├─ Central-ray / isocenter verification                                   │
│    └─ Fluoro display                                                         │
│                                                                              │
└───────────────────────┬──────────────────────────┬───────────────────────────┘
                        │                          │
                        │ POST /plan               │ POST /synthetic-xray
                        ▼                          ▼
┌─────────────────────────────┐      ┌───────────────────────────────────────┐
│ Main Planning Service       │      │ Lightweight Imaging Service           │
│ Render                      │      │ Render                                │
│                             │      │                                       │
│ FastAPI                     │      │ FastAPI                               │
│ ├─ pose solving             │      │ ├─ anatomy/view normalization         │
│ ├─ waypoint planning        │      │ ├─ reference-radiograph resolver      │
│ ├─ confidence calculation   │      │ └─ deterministic image response       │
│ └─ optional DRR pipeline    │      │                                       │
└─────────────────────────────┘      └───────────────────────────────────────┘
```

The imaging service is intentionally separated from the heavier planner/DRR environment. This keeps exposure requests responsive and prevents the lightweight X-ray workflow from loading the full PyTorch/CUDA/VTK/DiffDRR dependency stack during startup.

For a deeper technical view, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Anatomy and Projection Library

The simulator uses named anatomical targets and projection-specific reference images stored under:

```text
python/bridge/reference_xrays/
```

Current coverage includes major regions such as:

| Region | Examples | Views |
|---|---|---|
| Head / neck | Skull, cervical spine | AP, lateral |
| Torso | Chest, abdomen, pelvis | AP, lateral |
| Upper extremity | Shoulders, elbows, hands | AP, lateral, selected oblique |
| Lower extremity | Hips, knees, ankles | AP, lateral |

Reference selection is performed by the lightweight synthetic X-ray API using normalized anatomy, laterality, and projection names.

**Important:** reference radiographs are demonstration assets, not a validated clinical dataset. Any externally sourced image must be used only where its license or permission allows redistribution.

---

## Geometry Verification

The planner supports a frontend-solved final pose that is checked against the live Three.js scene before the backend accepts it.

The current simulator uses a **1 mm internal scene-geometry acceptance threshold** for isocenter and central-ray alignment. This value is a simulator engineering constraint only and **must not be interpreted as demonstrated clinical positioning accuracy**.

The backend can return:

- start and final C-arm pose
- interpolated path waypoints
- confidence components
- solver mode
- geometry-verification metadata
- human-readable planning explanation

---

## Repository Structure

```text
C-arm-guidance-simulator/
├── 3DVisualizer/
│   └── ciartic-app/               # React + Three.js simulator frontend
│       ├── public/                 # 3D and static assets
│       ├── src/                    # UI, scene, geometry and control logic
│       └── scripts/                # Maintenance / patch scripts
│
├── python/
│   └── bridge/
│       ├── api.py                  # Main planning / rendering FastAPI app
│       ├── synthetic_server.py     # Lightweight imaging-service entry point
│       ├── synthetic_xray.py       # Reference-radiograph resolver + API
│       ├── reference_xrays/        # Projection-specific reference images
│       └── planner/                # Pose solving, path planning, confidence
│
├── AI/                             # AI/inference-related development
├── src/                            # Training and evaluation code
├── assets/                         # Shared models/resources
├── data/                           # Datasets and prepared data
├── results/                        # Experimental outputs
├── logs/                           # Training/evaluation logs
├── Printed prototype/              # Physical-prototype assets
└── README.md
```

---

## Technology Stack

### Frontend

- React
- Three.js
- Vite
- JavaScript

### Backend

- Python
- FastAPI
- Uvicorn
- NumPy / scientific Python utilities

### Research / imaging stack

The repository also contains development paths involving:

- PyTorch
- DiffDRR
- VTK / PyVista
- medical-image processing utilities
- geometry and registration tooling

These heavier dependencies are kept separate from the lightweight X-ray service where possible.

### Deployment

- **Vercel**: web frontend
- **Render**: planning backend
- **Render**: lightweight synthetic X-ray backend

---

## API Overview

### Planning service

```http
POST /plan
```

Computes the planned C-arm path from the current pose to the requested final pose and returns waypoints, confidence information, solver metadata, and optional geometry-verification information.

```http
GET /health
```

Reports backend and registered-dataset status.

### Lightweight imaging service

```http
POST /synthetic-xray
```

Accepts anatomy, view, laterality, and optional angulation information and returns a base64-encoded simulated radiographic image.

```http
GET /synthetic-xray/health
```

Reports imaging-service configuration and reference-library status.

---

## Running Locally

### 1. Clone

```bash
git clone https://github.com/SuhaimAlYafei/C-arm-guidance-simulator.git
cd C-arm-guidance-simulator
```

### 2. Frontend

```bash
cd 3DVisualizer/ciartic-app
npm install
npm run dev
```

### 3. Main backend

From the repository root:

```bash
pip install -r python/requirements.txt
cd python
uvicorn bridge.api:app --host 0.0.0.0 --port 8000
```

> The main backend contains a heavier research stack and may require additional local datasets/environment configuration depending on the feature being used.

### 4. Lightweight imaging backend

From the repository root:

```bash
pip install -r python/requirements-synthetic.txt
cd python
uvicorn bridge.synthetic_server:app --host 0.0.0.0 --port 8001
```

The lightweight service is the recommended path when only the projection/reference-image API is needed.

---

## Research Status and Limitations

### Implemented

- interactive 3D C-arm simulation
- anatomical landmark targeting
- geometry-based final-pose verification
- automatic waypoint planning
- confidence/explanation output
- projection-specific radiographic reference mapping
- deployed web frontend and backend services

### In development / future validation

- quantitative evaluation against physical C-arm measurements
- broader hardware-in-the-loop validation
- systematic comparison with clinician positioning
- uncertainty calibration under real procedural conditions
- validated collision avoidance across representative operating-room configurations
- clinical-image and radiation-dose studies
- regulatory and safety evaluation

No claim of clinical accuracy, radiation reduction, diagnostic performance, or autonomous medical-device capability should be inferred from the current simulator.

---

## Design Principles

1. **Deterministic anatomy before generative appearance.** When a projection-specific reference is available, the simulator prioritizes anatomically appropriate deterministic output over unconstrained image generation.
2. **Geometry must be inspectable.** Target alignment, final pose, central ray, and path planning should be visible and explainable rather than hidden inside a black box.
3. **Research claims must match evidence.** Simulator tolerances and software outputs are reported as engineering properties, not clinical performance claims.
4. **Modular deployment.** Planning and imaging services are separated so changes to one subsystem do not unnecessarily destabilize the other.

---

## Development Notes

The project has evolved through multiple research prototypes. Some folders contain experimental scripts, archived outputs, and development utilities alongside the current web application. The deployed simulator primarily depends on the frontend under `3DVisualizer/ciartic-app` and the Python bridge services under `python/bridge`.

Before restructuring or deleting historical files, verify that they are not referenced by training, evaluation, deployment, or prototype workflows.

---

## Contributing

Research contributions, bug reports, reproducibility improvements, and documentation corrections are welcome. For changes involving medical images, do not commit patient-identifiable information, and confirm that the image may legally be redistributed.

---

## Acknowledgements

This project has been developed with guidance and support from mentors, clinicians, educators, and collaborators contributing to the broader research effort around AI-assisted medical imaging and C-arm positioning.

Third-party assets, libraries, datasets, and prior work remain subject to their respective licenses and attribution requirements.

---

## License

See [`LICENSE`](LICENSE) for repository licensing information. Third-party datasets, medical images, models, and assets may have separate licenses that are not granted by the repository license.
