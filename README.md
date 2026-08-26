# AI-Guided C-Arm Positioning Simulator V2

<p align="center">
  <strong>A research-grade digital-twin platform for anatomy-aware C-arm positioning, geometry verification, waypoint planning, deterministic reference radiography, and AI-assisted simulator guidance.</strong>
</p>

<p align="center">
  <a href="https://c-armsim.com"><strong>Open the Live V2 Simulator</strong></a>
  ·
  <a href="docs/Home.md"><strong>Documentation</strong></a>
  ·
  <a href="docs/ARCHITECTURE.md">Architecture</a>
  ·
  <a href="docs/RESEARCH_FOUNDATION.md">Research Foundation</a>
  ·
  <a href="docs/RESEARCH_LIMITATIONS.md">Research Status</a>
</p>

<p align="center">
  <img alt="V2" src="https://img.shields.io/badge/Release-V2-2563EB">
  <img alt="Firebase Hosting" src="https://img.shields.io/badge/Hosting-Firebase-FFCA28?logo=firebase&logoColor=black">
  <img alt="Gemini" src="https://img.shields.io/badge/AI-Gemini-4285F4?logo=google&logoColor=white">
  <img alt="App Check" src="https://img.shields.io/badge/Security-App%20Check-FFCA28?logo=firebase&logoColor=black">
  <img alt="React" src="https://img.shields.io/badge/Frontend-React-20232A?logo=react&logoColor=61DAFB">
  <img alt="Three.js" src="https://img.shields.io/badge/3D-Three.js-black?logo=threedotjs&logoColor=white">
  <img alt="FastAPI" src="https://img.shields.io/badge/API-FastAPI-009688?logo=fastapi&logoColor=white">
  <img alt="Render" src="https://img.shields.io/badge/Planner-Render-46E3B7?logo=render&logoColor=black">
  <img alt="MIT License" src="https://img.shields.io/badge/Code%20License-MIT-yellow.svg">
</p>

---

## Live V2

**Canonical website:** https://c-armsim.com  
**Firebase fallback:** https://c-arm-guidance-simulator.web.app

The `main` branch is the current V2 codebase and is the source of truth for the public simulator.

> **Research simulator only.** This software is not a medical device, is not clinically validated, and must not be used for diagnosis, treatment, patient positioning, radiation control, or unsupervised operation of medical equipment.

---

## What V2 Does

The simulator combines a browser-based Three.js digital twin with anatomy registration, scene-derived C-arm geometry, waypoint planning, verified arrival state, reference-radiograph display, and an embedded Gemini simulator copilot.

### Core capabilities

- Interactive React + Three.js C-arm digital twin
- Procedure, body-region, anatomy, landmark, and projection workflow
- Built-in default registration with **17 anatomical landmarks (LM0-LM16)**
- Saved calibration persistence plus registration import/export
- Dedicated medical patient GLB for simulator visualization
- Scene-derived final-pose solving
- Central-ray and isocenter verification
- Waypoint preview and animated C-arm movement
- ARRIVED-state pose and geometry checks
- Planner confidence and human-readable explanations
- Deterministic reference X-rays for supported anatomy/projection mappings
- Explicit unsupported-view handling rather than fabricating a radiograph
- Gemini Guidance with live simulator context
- Firebase Hosting, App Check, and reCAPTCHA Enterprise
- Render-hosted FastAPI planning backend
- Arduino / physical-prototype integration hooks

---

## End-to-End Workflow

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
      +--> supported mapping --> deterministic reference radiograph
      |
      +--> unsupported mapping --> NO REFERENCE IMAGE
```

See [`docs/SIMULATOR_WORKFLOW.md`](docs/SIMULATOR_WORKFLOW.md).

---

## V2 Architecture

```text
                         c-armsim.com
                              |
                              v
                       Firebase Hosting
                              |
                              v
                  React + Three.js Simulator
                              |
          +-------------------+-------------------+
          |                                       |
          v                                       v
 Firebase App Check                       Firebase AI Logic
 reCAPTCHA Enterprise                          Gemini
          |                                       |
          +-------------------+-------------------+
                              |
                              v
                  Render FastAPI Planner
                         POST /plan
                  - target pose handling
                  - waypoint generation
                  - confidence / explanation
                  - geometry metadata

Static V2 assets served by Firebase Hosting
- medical patient GLB
- default registration JSON
- validated reference-image library
```

For implementation details, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Powered by Google Technology

V2 uses Google technologies as key parts of the web application stack:

- **Firebase Hosting** for the production frontend
- **Firebase App Check** for application attestation
- **reCAPTCHA Enterprise** as the App Check provider
- **Firebase AI Logic** for client-side generative-AI integration
- **Gemini** for the embedded **Gemini Guidance** simulator-state copilot

Gemini Guidance receives structured simulator state including the requested anatomy/projection, current C-arm pose, planned final pose, planner confidence, geometry-verification results, and latest exposure metadata. It is designed to explain the **simulation**, not provide clinical advice.

Google, Firebase, Gemini, and reCAPTCHA are trademarks of their respective owners. This project uses their technology but does not claim sponsorship, endorsement, or clinical validation by Google.

---

## Research Foundation and Credit

This project builds on the research direction established by **Ahmad Arrabi and collaborators** in automated C-arm guidance and anatomical landmark localization.

A central research foundation is:

> **Ahmad Arrabi, Jay Hwasung Jung, Jax Luo, Nathan Franssen, Scott B. Raymond, Safwan Wshah.**  
> *Automated C-Arm Positioning via Conformal Landmark Localization.*  
> IEEE/CVF International Conference on Computer Vision Workshops (ICCVW), Advanced Perception for Autonomous Healthcare (APAH), 2025.

- Official research implementation: https://github.com/AhmadArrabi/C_arm_guidance_APAH
- ICCV Open Access paper: https://openaccess.thecvf.com/content/ICCV2025W/APAH/html/Arrabi_Automated_C-Arm_Positioning_via_Conformal_Landmark_Localization_ICCVW_2025_paper.html
- Related earlier work: *C-arm Guidance: A Self-supervised Approach to Automated Positioning During Stroke Thrombectomy*

The original Arrabi research introduced automated C-arm positioning through learned anatomical landmark localization and uncertainty-aware/conformal methods. This repository extends the broader research direction into an interactive V2 digital-twin environment with scene geometry, web-based path planning, registration/calibration tooling, reference-image workflows, hardware integration hooks, Firebase deployment, and Gemini-assisted simulator interpretation.

**Credit for the underlying research ideas and original implementation remains with Ahmad Arrabi and the respective co-authors.** See [`docs/RESEARCH_FOUNDATION.md`](docs/RESEARCH_FOUNDATION.md) and [`ACKNOWLEDGEMENTS.md`](ACKNOWLEDGEMENTS.md).

---

## Default Patient Registration

V2 bundles:

```text
3DVisualizer/ciartic-app/public/default_patient_registration.json
```

Startup behavior:

1. restore a locally saved registration if one exists
2. otherwise load the bundled default registration
3. allow later recalibration, import, export, and local persistence

The baseline contains **LM0-LM16** anatomical targets.

---

## Geometry Verification

The frontend evaluates the live Three.js scene before accepting a planned pose. It can report:

- current and planned C-arm pose
- per-axis pose residuals
- geometry-verification state
- isocenter error
- central-ray error
- planner confidence
- solver mode and explanation

The current **1 mm internal scene-geometry acceptance threshold** is an engineering constraint inside the simulation. It is **not demonstrated physical or clinical positioning accuracy**.

---

## Reference X-rays

Supported anatomy/projection combinations map to static reference images under:

```text
3DVisualizer/ciartic-app/public/reference_xrays/
```

The library includes head/neck, torso, upper-extremity, and lower-extremity examples with AP, lateral, and selected oblique/axillary views.

Unsupported combinations are explicitly identified instead of being represented by an unconstrained generated image. These images are simulator assets and are not a clinically validated diagnostic dataset.

---

## Gemini Guidance

The embedded assistant is mounted in the V2 frontend as a floating **Gemini Guidance** panel. Its role is to explain current simulator state, for example:

- requested anatomy and projection
- whether a path exists
- current vs planned final C-arm pose
- geometry-verification results
- isocenter and central-ray error
- whether the simulated trajectory reached the stored final pose
- latest exposure/reference-image status

It is explicitly constrained to research/simulation interpretation and is not clinical decision support.

---

## Planning Service

Production planner:

```text
https://c-arm-guidance-simulator.onrender.com/plan
```

Primary endpoint:

```http
POST /plan
```

The Render-hosted FastAPI service handles path generation, confidence/explanation output, and geometry metadata for V2.

Experimental DiffDRR and imaging-service code remains in the repository for research development, while supported V2 reference exposures are resolved from frontend static assets.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Web UI | React, Vite, JavaScript |
| 3D / digital twin | Three.js |
| Hosting | Firebase Hosting |
| Application protection | Firebase App Check, reCAPTCHA Enterprise |
| Embedded AI | Firebase AI Logic, Gemini |
| Planning API | FastAPI, Python, Uvicorn |
| Planner deployment | Render |
| Research tooling | PyTorch, DiffDRR-related development, scientific Python, medical-imaging and geometry utilities |
| Hardware development | Arduino / serial integration hooks |

---

## Repository Layout

```text
C-arm-guidance-simulator/
├── 3DVisualizer/ciartic-app/        # Production V2 web simulator
│   ├── src/App.jsx                  # Main digital-twin application
│   ├── src/components/              # UI, controls, Gemini Guidance
│   ├── src/firebase/                # Firebase + App Check + AI initialization
│   └── public/                      # registration, patient model, reference images
├── python/bridge/                   # FastAPI planner and research bridge code
├── docs/                            # Technical and research documentation
├── AI/                              # AI/inference development assets
├── training/                        # Model-training utilities
├── evaluation/                      # Evaluation utilities
├── data/                            # Research datasets / prepared data
├── results/                         # Experimental outputs
├── Printed prototype/               # Physical-prototype assets
├── ACKNOWLEDGEMENTS.md
├── CITATION.cff
├── THIRD_PARTY_NOTICES.md
└── README.md
```

---

## Run Locally

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
- [Research Foundation & Prior Work](docs/RESEARCH_FOUNDATION.md)
- [API Reference](docs/API.md)
- [Research Status & Limitations](docs/RESEARCH_LIMITATIONS.md)
- [Acknowledgements](ACKNOWLEDGEMENTS.md)
- [Third-Party Notices](THIRD_PARTY_NOTICES.md)

---

## Acknowledgements

V2 is made possible by a combination of open research and modern cloud tooling. Particular thanks and credit go to:

- **Ahmad Arrabi and co-authors** for foundational C-arm guidance and conformal landmark-localization research
- **Google Firebase** for hosting, application protection, and AI integration infrastructure
- **Google Gemini** for the Gemini Guidance simulator-state assistant
- the open-source communities behind React, Three.js, FastAPI, PyTorch, and related scientific tooling
- mentors, clinicians, educators, and collaborators supporting the broader research effort

See [`ACKNOWLEDGEMENTS.md`](ACKNOWLEDGEMENTS.md) for full attribution.

---

## License and Attribution

Original repository software is distributed under the MIT License. Copyright notices for original contributors are preserved in [`LICENSE`](LICENSE).

Third-party datasets, radiographs, models, textures, and other externally sourced assets may have separate licenses or redistribution requirements. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

The Arrabi research papers and upstream code remain the work of their original authors and are cited for scholarly attribution. Google technologies are credited as technology dependencies; their inclusion does not imply endorsement.

No repository license should be interpreted as granting clinical approval or medical-device certification.
