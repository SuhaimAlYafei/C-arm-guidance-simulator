# System Architecture - V2

This document describes the current deployed architecture of the **AI-Guided C-Arm Positioning Simulator V2**.

**Canonical production site:** https://c-armsim.com

## 1. High-level runtime

The production system uses four primary runtime components:

1. **Firebase-hosted React + Three.js frontend**
2. **Render-hosted FastAPI planning backend**
3. **Firebase App Check with reCAPTCHA Enterprise**
4. **Firebase AI Logic / Gemini Guidance**

```text
User
 |
 v
https://c-armsim.com
 |
 v
Firebase Hosting
 |
 v
React + Three.js frontend
 |
 +--> static patient / registration / reference-X-ray assets
 |
 +--> Firebase App Check + reCAPTCHA Enterprise
 |
 +--> Firebase AI Logic --> Gemini Guidance
 |
 +--> HTTPS POST /plan
          |
          v
      Render FastAPI
      - final-pose handling
      - waypoint planning
      - confidence
      - explanation
      - geometry metadata
```

## 2. Frontend responsibilities

The production V2 frontend lives under:

```text
3DVisualizer/ciartic-app
```

Responsibilities include:

- rendering the patient and C-arm digital twin
- anatomical landmark selection
- procedure / body-region / projection selection
- patient registration persistence and calibration
- live Three.js transform evaluation
- source / detector anchor tracking
- target alignment
- central-ray and isocenter verification
- planner request construction
- waypoint preview and playback
- arrival verification
- deterministic reference-X-ray exposure
- fluoroscopy display and metadata
- Gemini Guidance
- Arduino / hardware integration hooks

## 3. Application shell and Gemini integration

The browser entry point mounts `SimulatorShell`, which renders both the core simulator and Gemini Guidance:

```text
src/main.jsx
  -> SimulatorShell.jsx
       -> App.jsx
       -> GeminiAssistant.jsx
```

`SimulatorShell.jsx` exposes a compact simulator-state context to the assistant. The assistant is intended to interpret the simulated workflow and must not be treated as clinical decision support.

## 4. Default patient registration

Bundled registration:

```text
3DVisualizer/ciartic-app/public/default_patient_registration.json
```

Startup behavior:

1. restore browser-saved registration if present
2. otherwise fetch the bundled default registration
3. allow later save/import/export/recalibration

The baseline contains **LM0-LM16**.

## 5. Patient visualization

Patient model:

```text
3DVisualizer/ciartic-app/public/medical_patient/patient.glb
```

The rendered GLB is a visual surface model. It must not be assumed to establish patient-specific anatomical registration accuracy by itself.

## 6. Planning backend

Primary production endpoint:

```text
https://c-arm-guidance-simulator.onrender.com/plan
```

Primary API:

```http
POST /plan
```

The planning backend receives the current C-arm pose, target information, requested projection, waypoint count, and scene-derived final-pose / geometry metadata.

It can return:

- start pose
- final pose
- interpolated waypoints
- planner confidence metadata
- solver mode
- explanation
- geometry-verification payload

## 7. Geometry verification

The frontend evaluates the live Three.js scene hierarchy and can verify:

- selected landmark relative to the central ray
- isocenter alignment
- final-pose residual
- current-vs-final pose agreement
- arrival state

The current **1 mm scene-geometry threshold** is an internal software-engineering acceptance limit. It is not evidence of 1 mm physical or clinical accuracy.

## 8. Exposure architecture

Current V2 reference images are stored in:

```text
3DVisualizer/ciartic-app/public/reference_xrays/
```

`REFERENCE_XRAY_MAP` maps supported anatomy/projection combinations to those static files.

If a mapping is unavailable, the simulator explicitly reports that no reference image is available rather than showing an unconstrained generated image.

## 9. Gemini Guidance

Firebase initialization:

```text
3DVisualizer/ciartic-app/src/firebase/firebase.js
```

Assistant component:

```text
3DVisualizer/ciartic-app/src/components/GeminiAssistant.jsx
```

Application shell:

```text
3DVisualizer/ciartic-app/src/SimulatorShell.jsx
```

The Firebase integration provides:

- App Check
- reCAPTCHA Enterprise
- Firebase AI Logic
- Gemini model access

Gemini Guidance receives simulator-state context and explains the current research simulation. It is not intended as medical advice, diagnostic interpretation, or clinical decision support.

## 10. Google platform services

Google technologies are used as infrastructure and AI dependencies:

- Firebase Hosting
- Firebase App Check
- reCAPTCHA Enterprise
- Firebase AI Logic
- Gemini

Their use does not imply sponsorship, endorsement, or clinical validation by Google.

## 11. Deployment

### Frontend

Firebase project:

```text
c-arm-guidance-simulator
```

Canonical production domain:

```text
https://c-armsim.com
```

Firebase-provided fallback domain:

```text
https://c-arm-guidance-simulator.web.app
```

### Planning backend

The main planning stack runs on Render and is called directly over HTTPS.

## 12. Research lineage

The broader research direction is informed by automated C-arm guidance work from **Ahmad Arrabi and collaborators**, including *Automated C-Arm Positioning via Conformal Landmark Localization* (ICCVW APAH 2025).

The official implementation of that work is:

https://github.com/AhmadArrabi/C_arm_guidance_APAH

See [`RESEARCH_FOUNDATION.md`](RESEARCH_FOUNDATION.md) for attribution and the distinction between prior research and V2 simulator engineering.

## 13. Legacy / experimental imaging code

The repository retains experimental imaging and DiffDRR-related infrastructure in the Python research stack, including the lightweight synthetic/reference imaging service.

Those components remain useful for research development but are not required for every supported V2 reference-image exposure because the current frontend can resolve supported reference views directly from static Firebase-hosted assets.

## 14. Current research boundary

The architecture supports simulation and engineering evaluation. It does not establish:

- clinical positioning accuracy
- patient-specific registration accuracy
- radiation-dose reduction
- diagnostic accuracy
- physical collision safety
- autonomous medical-device safety
- regulatory compliance

Those require separate experimental, physical, and clinical validation.
