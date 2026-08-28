# AI-Guided C-Arm Positioning Simulator V3

<p align="center">
  <strong>Collision-Aware Digital Twin Planning for Safe and Repeatable C-Arm Positioning in Simulated Clinical Environments</strong>
</p>

<p align="center">
  A browser-based research simulator combining anatomy-aware C-arm positioning, verified scene geometry, collision-aware trajectory planning, a movable simulated operating-room environment, reference radiography, and AI-assisted simulator guidance.
</p>

<p align="center">
  <a href="https://c-armsim.com"><strong>Open the Live V3 Simulator</strong></a>
  · <a href="docs/Home.md"><strong>Documentation</strong></a>
  · <a href="docs/ARCHITECTURE.md">Architecture</a>
  · <a href="docs/RESEARCH_FOUNDATION.md">Research Foundation</a>
  · <a href="docs/RESEARCH_LIMITATIONS.md">Research Status</a>
</p>

<p align="center">
  <img alt="V3" src="https://img.shields.io/badge/Release-V3-2563EB">
  <img alt="Firebase Hosting" src="https://img.shields.io/badge/Hosting-Firebase-FFCA28?logo=firebase&logoColor=black">
  <img alt="Gemini" src="https://img.shields.io/badge/AI-Gemini-4285F4?logo=google&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/Frontend-React-20232A?logo=react&logoColor=61DAFB">
  <img alt="Three.js" src="https://img.shields.io/badge/3D-Three.js-black?logo=threedotjs&logoColor=white">
  <img alt="FastAPI" src="https://img.shields.io/badge/API-FastAPI-009688?logo=fastapi&logoColor=white">
  <img alt="MIT License" src="https://img.shields.io/badge/Code%20License-MIT-yellow.svg">
</p>

---

## Live V3

**Canonical website:** https://c-armsim.com  
**Firebase fallback:** https://c-arm-guidance-simulator.web.app

V3 is publicly deployed. Active V3 development is maintained on the `v3-collision-safety` branch.

> **Research and educational simulator only.** This software is not a medical device, is not clinically validated, and must not be used for diagnosis, treatment, patient positioning, radiation control, or unsupervised operation of medical equipment.

---

## V3 Research Focus

**Research question:**

> Can a collision-aware digital twin automatically generate geometrically valid C-arm trajectories to anatomical imaging targets while avoiding the patient and simulated operating-room obstacles?

V3 extends the positioning simulator from target-pose planning into environment-aware trajectory planning. The simulator models operating-room obstacles and evaluates planned motion against software collision proxies while preserving the existing geometry-verification pipeline.

Collision and clearance results are **simulation outputs**, not guarantees of real-world physical clearance or clinical safety.

---

## What V3 Adds

### Collision-aware operating-room simulation

- Simulated operating-room equipment and staff
- Real GLB assets for the IV pole, surgeon, and scrub nurse
- Direct X/Y/Z translation and rotation controls for selected OR objects
- Deterministic environment randomization and repeat/reset controls
- Safety-zone visualization
- CLEAR / WARNING / COLLISION simulator states
- Minimum-clearance reporting
- Collision-aware path checking and rerouting
- Layout-change invalidation requiring a new path preview
- Hard-limit-aware C-arm planning

### Core positioning capabilities retained

- Interactive React + Three.js C-arm digital twin
- Procedure, body-region, anatomy, landmark, and projection workflow
- Built-in LM0-LM16 patient registration
- Scene-derived target-pose solving
- Central-ray and isocenter verification
- Waypoint preview and animated movement
- ARRIVED-state pose and geometry verification
- Planner confidence and explanation output
- Deterministic reference X-rays for supported mappings
- Explicit NO REFERENCE IMAGE behavior for unsupported mappings
- Gemini Guidance using live simulator context
- Firebase Hosting and App Check
- Render-hosted FastAPI planning service

---

## V3 Workflow

```text
Imaging request
      |
      v
Anatomy + landmark + projection
      |
      v
Current digital-twin / OR layout
      |
      v
PREVIEW PATH
      |
      +--> derive target pose
      +--> verify scene geometry
      +--> evaluate hard limits
      +--> evaluate simulated obstacles
      |
      v
Collision-aware waypoint plan
      |
      +--> direct route clear --> use route
      |
      +--> direct-route conflict --> reroute / reject
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
      +--> unsupported mapping --> NO REFERENCE IMAGE
```

Changing an OR object after a trajectory is planned marks the layout dirty and requires **PREVIEW PATH** again before relying on that plan.

---

## Operating-Room Safety Layer

The V3 OR Safety interface is intentionally focused on the core experiment rather than adding large numbers of unrelated controls.

The user can select supported simulated OR objects and move them directly in the environment. The collision layer evaluates the current layout and planned C-arm path using software geometry proxies.

Reported values can include:

- environment state
- selected transform root
- live collision status
- minimum simulated clearance
- path status
- checked waypoints
- whether the OR layout has changed since the last preview

The safety bubbles and segmented patient/table proxies are engineering approximations for simulator collision testing. They are not measured physical safety envelopes.

---

## Geometry Verification

The frontend evaluates the live Three.js geometry before accepting a planned final pose. Arrival verification can report:

- current and planned C-arm pose
- position residual
- angular residual
- geometry-verification state
- isocenter error
- central-ray error
- planner confidence
- solver mode and explanation

The current **1 mm internal scene-geometry criterion** is an engineering criterion inside the simulator. It is **not physical or clinical positioning accuracy**.

Do not interpret planner confidence as accuracy. It is reported specifically as **planner confidence**.

---

## Internal Software Benchmarks

### Fixed benchmark

A reproducible 1,000-trial software benchmark using seed `23112` produced:

- internal simulator success: **99.1%**
- 9 failures associated with position residual after a Y-axis hard-limit clamp
- median position error: **0 mm**
- mean position error: **0.092631 mm**
- 95th percentile: **0 mm**
- 99th percentile: **0.003464 mm**
- maximum: **16.321717 mm**
- angular residuals: **0°** in this benchmark
- mean planner confidence: **93.124%**

### Workspace benchmark

A reproducible 5,000-trial software workspace benchmark using seed `23112` included:

| Test region | Trials | Result |
|---|---:|---|
| Nominal reachable | 3,393 | 100% internal feasible success; 100% hard-limit compliance; max residual 0 mm |
| Near-limit | 669 | 100% internal feasible success; 100% hard-limit compliance; max residual 0 mm |
| Outside workspace | 938 | 100% hard-limit compliance; median residual 43.996963 mm; max 165.213903 mm |

The outside-workspace cases are **stress/limit-handling cases**, not normal positioning failures.

> In a reproducible 5,000-trial software benchmark, all nominal reachable and near-limit feasible targets were solved within the internal simulator criterion, and all outside-workspace stress cases respected the configured hard mechanical limits. These are software-only internal results, not physical or clinical accuracy.

---

## Anatomy Classification Development

The research codebase also contains anatomy-classification development using a ConvNeXt Tiny 384 three-seed ensemble evaluated on the same patient-separated MURA development validation split.

Development validation summary:

- samples: **3,197**
- accuracy: **97.3413%**
- balanced accuracy: **96.5232%**
- macro F1: **96.9128%**
- mean confidence: **94.954%**
- all three models agreed on **98.561%** of samples

These are development-validation results, **not an untouched clinical test and not clinical validation**.

The 41 reference simulator X-rays are a separate deterministic reference library and should not be interpreted as a 41-class training dataset.

---

## Reference X-rays

Supported anatomy/projection combinations map to static reference images under:

```text
3DVisualizer/ciartic-app/public/reference_xrays/
```

When a supported mapping exists, the simulator displays the corresponding reference image and exposure metadata. Unsupported views explicitly return **NO REFERENCE IMAGE** / **NO VALIDATED REFERENCE** rather than fabricating an image.

The reference radiographs are simulator references; they are not generated from the exact current C-arm pose and are not a clinically validated diagnostic dataset.

---

## Gemini Guidance

The floating **Gemini Guidance** assistant receives structured simulator context such as:

- requested anatomy and projection
- current C-arm pose
- planned final pose
- planner confidence
- path state
- geometry-verification results
- isocenter and central-ray error
- exposure/reference-image state

Gemini is constrained to explain the simulator state and research workflow. It is not clinical decision support and should not infer positioning correctness from labels alone.

---

## Architecture

```text
                         c-armsim.com
                              |
                              v
                       Firebase Hosting
                              |
                              v
                  React + Three.js Simulator
                              |
        +---------------------+----------------------+
        |                     |                      |
        v                     v                      v
 Scene Geometry       OR Collision Layer      Gemini Guidance
        |                     |                      |
        +----------+----------+                      |
                   |                                 |
                   v                                 |
           Target / Path Request                     |
                   |                                 |
                   v                                 v
             Render FastAPI                 Firebase AI Logic
              POST /plan                         Gemini
                   |
                   v
        Waypoints + planner metadata
                   |
                   v
      Geometry + collision verification
```

Static production assets include the patient model, default registration, reference radiographs, and supported operating-room GLB assets.

---

## Planning Service

Production endpoint:

```text
https://c-arm-guidance-simulator.onrender.com/plan
```

Primary API:

```http
POST /plan
```

The production planner handles target-pose/path requests and returns waypoint and planner metadata used by the frontend verification pipeline.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Web UI | React, Vite, JavaScript |
| Digital twin / 3D | Three.js |
| OR assets | GLB / glTF, Meshopt decoding |
| Hosting | Firebase Hosting |
| Application protection | Firebase App Check, reCAPTCHA Enterprise |
| Embedded AI | Firebase AI Logic, Gemini |
| Planning API | FastAPI, Python, Uvicorn |
| Planner deployment | Render |
| Research ML | PyTorch, ConvNeXt, scientific Python |
| Hardware research | Arduino / serial integration hooks |

---

## Repository Layout

```text
C-arm-guidance-simulator/
├── 3DVisualizer/ciartic-app/
│   ├── src/App.jsx
│   ├── src/components/
│   │   ├── OperatingRoomSafetyPanel.js
│   │   └── GeminiAssistant.jsx
│   ├── src/scene/
│   │   ├── collisionAwarePlanner.js
│   │   ├── operatingRoomRuntime.js
│   │   ├── operatingRoomTransformController.js
│   │   ├── operatingRoomCollisionPolicy.js
│   │   └── realisticOperatingRoomAssets.js
│   ├── src/safety/
│   │   ├── collisionSafety.js
│   │   └── sceneSafetyObjects.js
│   ├── src/firebase/
│   └── public/
│       ├── medical_patient/
│       ├── operating_room/
│       ├── reference_xrays/
│       └── default_patient_registration.json
├── python/bridge/
├── docs/
├── AI/
├── training/
├── evaluation/
├── data/
├── results/
├── Printed prototype/
├── ACKNOWLEDGEMENTS.md
├── CITATION.cff
├── THIRD_PARTY_NOTICES.md
└── README.md
```

---

## Run Locally

```bash
git clone https://github.com/SuhaimAlYafei/C-arm-guidance-simulator.git
cd C-arm-guidance-simulator
git checkout v3-collision-safety
cd 3DVisualizer/ciartic-app
npm install
npm run dev
```

Research tests:

```bash
npm run test:research
```

Production build:

```bash
npm run build
```

Planner tests on Windows from the repository root:

```powershell
$env:PYTHONPATH="python"
py -m unittest bridge.planner.test_path_planner -v
```

Firebase deployment:

```bash
firebase deploy --only hosting
```

---

## Research Foundation and Credit

This project builds on the research direction established by **Ahmad Arrabi and collaborators** in automated C-arm guidance and anatomical landmark localization.

A central research foundation is:

> **Ahmad Arrabi, Jay Hwasung Jung, Jax Luo, Nathan Franssen, Scott B. Raymond, Safwan Wshah.**  
> *Automated C-Arm Positioning via Conformal Landmark Localization.*  
> IEEE/CVF International Conference on Computer Vision Workshops (ICCVW), Advanced Perception for Autonomous Healthcare (APAH), 2025.

- Research repository: https://github.com/AhmadArrabi/C_arm_guidance_APAH
- Paper: https://openaccess.thecvf.com/content/ICCV2025W/APAH/html/Arrabi_Automated_C-Arm_Positioning_via_Conformal_Landmark_Localization_ICCVW_2025_paper.html
- arXiv: https://arxiv.org/abs/2510.16160

This simulator is an **independent extension** of that research direction and should not be described as the official implementation of the paper. Credit for the underlying research and upstream work remains with the original authors.

See [`docs/RESEARCH_FOUNDATION.md`](docs/RESEARCH_FOUNDATION.md) and [`ACKNOWLEDGEMENTS.md`](ACKNOWLEDGEMENTS.md).

---

## Current Research Status and Limitations

### Implemented in software

- interactive 3D C-arm digital twin
- anatomy-aware target selection
- patient landmark registration
- scene-derived target-pose solving
- waypoint planning and playback
- central-ray and isocenter verification
- arrival verification
- movable simulated OR obstacles
- collision proxies and safety bubbles
- collision-aware trajectory checking/rerouting
- deterministic OR randomization/repeat/reset controls
- reference-radiograph workflow
- Gemini simulator guidance
- Firebase production deployment
- Render planning backend

### Still requires independent validation

- physical C-arm positioning accuracy
- real-world obstacle geometry and clearance
- physical landmark-registration error
- hardware-in-the-loop repeatability
- collision safety on actual equipment
- clinician comparison studies
- uncertainty calibration in real procedures
- radiation-dose/workflow outcomes
- diagnostic performance
- regulatory and safety evaluation

No claim of clinical accuracy, physical collision avoidance, radiation reduction, diagnostic performance, or autonomous medical-device capability should be inferred from V3.

---

## Public Asset and Attribution Note

Third-party models, datasets, radiographs, textures, and other external assets can carry licenses or redistribution requirements separate from this repository's code license. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

Before redistributing externally sourced OR GLB assets, their exact source URLs and license terms should be verified and documented. Inclusion in the simulator does not by itself establish redistribution rights.

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

## License

Original repository software is distributed under the MIT License with preserved contributor notices in [`LICENSE`](LICENSE).

Third-party assets and research materials may have separate terms. The cited Arrabi research and upstream implementation remain the work of their original authors. Google/Firebase/Gemini technologies are technology dependencies and their use does not imply endorsement.

No repository license or simulator result should be interpreted as medical-device approval or clinical certification.
