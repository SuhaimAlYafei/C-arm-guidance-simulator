# AI-Guided C-Arm Positioning Simulator

<p align="center">
  <strong>Digital-twin research platform for anatomy-aware C-arm positioning, geometry verification, waypoint planning, deterministic reference radiography, and AI-assisted simulator guidance.</strong>
</p>

<p align="center">
  <a href="https://c-arm-guidance-simulator.web.app"><strong>Live V2 Simulator</strong></a>
  ·
  <a href="docs/Home.md"><strong>Documentation</strong></a>
  ·
  <a href="docs/ARCHITECTURE.md">Architecture</a>
  ·
  <a href="docs/GETTING_STARTED.md">Getting Started</a>
  ·
  <a href="docs/RESEARCH_LIMITATIONS.md">Research Status</a>
</p>

<p align="center">
  <img alt="React" src="https://img.shields.io/badge/Frontend-React-20232A?logo=react&logoColor=61DAFB">
  <img alt="Three.js" src="https://img.shields.io/badge/3D-Three.js-black?logo=threedotjs&logoColor=white">
  <img alt="Firebase" src="https://img.shields.io/badge/Hosting-Firebase-FFCA28?logo=firebase&logoColor=black">
  <img alt="Gemini" src="https://img.shields.io/badge/AI-Gemini-4285F4?logo=google&logoColor=white">
  <img alt="FastAPI" src="https://img.shields.io/badge/API-FastAPI-009688?logo=fastapi&logoColor=white">
  <img alt="Render" src="https://img.shields.io/badge/Planner-Render-46E3B7?logo=render&logoColor=black">
  <img alt="MIT License" src="https://img.shields.io/badge/Code%20License-MIT-yellow.svg">
</p>

---

## Overview

This repository contains a research simulator for **AI-guided and geometry-aware C-arm positioning**. The V2 system combines an interactive Three.js digital twin, anatomical landmark targeting, scene-derived final-pose solving, waypoint planning, arrival verification, deterministic reference X-rays, Firebase App Check, and Gemini Guidance.

The simulator explores whether a C-arm can be guided back to a requested anatomical view in a reproducible, inspectable, and explainable simulated workflow.

> **Research simulator only.** This software is not a medical device, is not clinically validated, and must not be used for diagnosis, treatment, patient positioning, radiation control, or unsupervised operation of medical equipment.

### Live V2

**https://c-arm-guidance-simulator.web.app**

The custom domain `c-armsim.com` is being migrated to Firebase Hosting.

---

## V2 Highlights

- Interactive React + Three.js C-arm digital twin
- Procedure, body-region, anatomy, landmark, and projection workflow
- Built-in default patient registration with LM0-LM16
- Registration persistence plus calibration import/export
- Dedicated medical patient GLB for simulator visualization
- Scene-derived final-pose solving
- Central-ray and isocenter geometry checks
- Waypoint preview and C-arm motion playback
- ARRIVED-state pose and geometry verification
- Planner confidence and explanation output
- Deterministic reference X-rays for supported projections
- Explicit unsupported-view handling instead of fabricating a radiograph
- Firebase Hosting
- Firebase App Check with reCAPTCHA Enterprise
- Firebase AI Logic / Gemini Guidance
- Render-hosted FastAPI planning service
- Arduino / physical-prototype integration hooks

---

## Workflow

```text
Imaging request
      |
      v
Procedure + body region
      |
      v
Anatomical landmark + projection
      |
      v
PREVIEW PATH
      |
      v
Scene-derived target pose
      |
      v
Geometry verification
      |
      v
POST /plan -> Render FastAPI
      |
      v
Waypoint plan
      |
      v
MOVE C-ARM
      |
      v
ARRIVED
      |
      v
Arrival verification
      |
      v
EXPOSE X-RAY
      |
      +--> supported mapping --> reference radiograph
      |
      +--> unsupported mapping --> NO REFERENCE IMAGE
```

See [`docs/SIMULATOR_WORKFLOW.md`](docs/SIMULATOR_WORKFLOW.md).

---

## System Architecture

```text
                       Firebase Hosting
                             |
                             v
                 React + Three.js Simulator
                             |
            +----------------+----------------+
            |                                 |
            v                                 v
   Firebase App Check                Firebase AI Logic
   reCAPTCHA Enterprise                   Gemini
            |
            +----------------------+
                                   |
                                   v
                    Render FastAPI Planning Service
                    POST /plan
                    - pose planning
                    - waypoint generation
                    - confidence
                    - explanation
                    - geometry metadata

Browser static assets
- medical patient GLB
- default registration JSON
- reference X-ray library
```

For the detailed architecture, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Default Patient Registration

The frontend bundles:

```text
3DVisualizer/ciartic-app/public/default_patient_registration.json
```

Startup behavior is:

1. restore a locally saved registration if one exists
2. otherwise load the bundled default registration
3. allow later recalibration, import, export, and local persistence

The current baseline contains **17 anatomical landmarks (LM0-LM16)**.

---

## Patient Model

The rendered patient is loaded from:

```text
3DVisualizer/ciartic-app/public/medical_patient/patient.glb
```

The visible surface mesh is a simulator visualization asset. It must not be interpreted as proving patient-specific anatomical registration accuracy.

---

## Geometry Verification

The frontend evaluates the live Three.js scene before accepting a planned pose. The simulator can report:

- current and final C-arm pose
- pose residuals
- geometry-verification state
- isocenter error
- central-ray error
- planner confidence
- solver mode and explanation

The current **1 mm internal scene-geometry acceptance threshold** is an engineering constraint inside the software simulation. It is **not demonstrated physical or clinical accuracy**.

---

## Reference X-rays

Supported anatomy/projection combinations map to static reference images under:

```text
3DVisualizer/ciartic-app/public/reference_xrays/
```

The current library includes head/neck, torso, upper-extremity, and lower-extremity examples with AP, lateral, and selected oblique/axillary views.

When a requested mapping is unsupported, the frontend explicitly reports that no reference image is available instead of presenting an unconstrained generated image.

These files are simulator demonstration assets, not a clinically validated diagnostic dataset.

---

## Gemini Guidance

The simulator includes an AI assistant powered through Firebase AI Logic. Gemini Guidance receives structured simulator context such as:

- selected anatomy and projection
- planner state
- current and final pose
- geometry-verification metadata
- latest exposure state
- renderer/reference source information

It is intended to explain simulator state and workflow. It is **not clinical decision support**.

---

## Planning Service

Production planner endpoint:

```text
https://c-arm-guidance-simulator.onrender.com/plan
```

Primary API:

```http
POST /plan
```

The planner handles path generation, confidence/explanation output, and geometry metadata for the V2 frontend.

Legacy / experimental imaging and DiffDRR-related code remains in the repository for research development, but supported V2 reference exposures are currently resolved directly from frontend static assets.

---

## Technology Stack

**Frontend:** React, Three.js, Vite, JavaScript  
**Cloud:** Firebase Hosting, Firebase App Check, reCAPTCHA Enterprise, Firebase AI Logic, Gemini, Render  
**Backend:** Python, FastAPI, Uvicorn  
**Research stack:** PyTorch, DiffDRR-related development, scientific Python, geometry and medical-imaging utilities

---

## Running Locally

```bash
git clone https://github.com/SuhaimAlYafei/C-arm-guidance-simulator.git
cd C-arm-guidance-simulator/3DVisualizer/ciartic-app
npm install
npm run dev
```

Production build:

```bash
npm run build
```

Firebase deployment:

```bash
firebase deploy --only hosting
```

See [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md).

---

## Research Status

### Implemented

- interactive 3D C-arm simulation
- anatomy-aware target selection
- default registered landmarks
- calibration persistence and import/export
- scene-derived final-pose solving
- waypoint planning and playback
- central-ray and isocenter verification
- arrival verification
- planner confidence and explanation output
- deterministic reference radiographs
- Firebase Hosting and App Check
- Gemini Guidance
- Render-hosted planning backend
- Arduino / prototype integration hooks

### Requires further validation

- physical C-arm positioning accuracy
- physical landmark-registration error
- hardware-in-the-loop repeatability
- collision safety in real environments
- clinician comparison studies
- uncertainty calibration under real procedural conditions
- radiation-dose and workflow studies
- diagnostic performance
- regulatory and safety evaluation

No claim of clinical accuracy, radiation reduction, diagnostic performance, or autonomous medical-device capability should be inferred from the current simulator.

---

## Documentation

- [Documentation Home](docs/Home.md)
- [Getting Started](docs/GETTING_STARTED.md)
- [Simulator Workflow](docs/SIMULATOR_WORKFLOW.md)
- [System Architecture](docs/ARCHITECTURE.md)
- [API Reference](docs/API.md)
- [Research Status & Limitations](docs/RESEARCH_LIMITATIONS.md)
- [Third-Party Notices](THIRD_PARTY_NOTICES.md)

---

## License

Original repository software is distributed under the MIT License. Copyright notices for original contributors are preserved in [`LICENSE`](LICENSE).

Third-party datasets, radiographs, models, textures, and other externally sourced assets may have separate licenses or redistribution requirements. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

No repository license should be interpreted as granting clinical approval or medical-device certification.
