# System Architecture - V2

This document describes the current deployed architecture of the AI-Guided C-Arm Positioning Simulator.

## 1. High-level runtime

The current production simulator uses four primary runtime components:

1. **Firebase-hosted React + Three.js frontend**
2. **Render-hosted FastAPI planning backend**
3. **Firebase App Check with reCAPTCHA Enterprise**
4. **Firebase AI Logic / Gemini Guidance**

```text
User
 |
 v
Firebase Hosting
 |
 v
React + Three.js frontend
 |
 +--> static patient / registration / reference-X-ray assets
 |
 +--> Firebase App Check
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

The frontend under `3DVisualizer/ciartic-app` owns the interactive simulator experience.

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

## 3. Default patient registration

Bundled registration:

```text
3DVisualizer/ciartic-app/public/default_patient_registration.json
```

Startup behavior:

1. restore browser-saved registration if present
2. otherwise fetch the bundled default registration
3. allow later save/import/export/recalibration

The current baseline contains LM0-LM16.

## 4. Patient visualization

Patient model:

```text
3DVisualizer/ciartic-app/public/medical_patient/patient.glb
```

The rendered GLB is a visual surface model. It must not be assumed to establish patient-specific anatomical registration accuracy by itself.

## 5. Planning backend

Primary production endpoint:

```text
https://c-arm-guidance-simulator.onrender.com/plan
```

Important endpoint:

```http
POST /plan
```

The planning backend receives the current C-arm pose, target information, requested projection, waypoint count, and scene-derived final-pose / geometry metadata.

The backend returns:

- start pose
- final pose
- interpolated waypoints
- planner confidence metadata
- solver mode
- explanation
- optional geometry-verification payload

## 6. Geometry verification

The frontend evaluates the live Three.js scene hierarchy and can verify:

- selected landmark relative to the central ray
- isocenter alignment
- final-pose residual
- current-vs-final pose agreement
- arrival state

The current **1 mm scene-geometry threshold** is an internal software-engineering acceptance limit. It is not evidence of 1 mm physical or clinical accuracy.

## 7. Exposure architecture

Current V2 reference images are stored in:

```text
3DVisualizer/ciartic-app/public/reference_xrays/
```

`REFERENCE_XRAY_MAP` in the frontend maps supported anatomy/projection combinations to those static files.

If a mapping is unavailable, the simulator explicitly reports that no reference image is available instead of showing an unconstrained generated image.

This deterministic mapping is preferred for the current expert-facing simulator because unconstrained image generation may produce anatomically incorrect or projection-inconsistent output.

## 8. Gemini Guidance

Firebase initialization:

```text
3DVisualizer/ciartic-app/src/firebase/firebase.js
```

Assistant component:

```text
3DVisualizer/ciartic-app/src/components/GeminiAssistant.jsx
```

Firebase provides:

- App Check
- reCAPTCHA Enterprise
- Firebase AI Logic
- Gemini model access

The assistant receives structured simulator context and is intended to explain simulator state and workflow. It is not intended as medical advice or clinical decision support.

## 9. Deployment

### Frontend

Firebase project:

```text
c-arm-guidance-simulator
```

Production Hosting URL:

```text
https://c-arm-guidance-simulator.web.app
```

The custom domain `c-armsim.com` is being migrated to Firebase Hosting.

### Planning backend

The main planning stack runs on Render and is called directly over HTTPS.

## 10. Legacy / experimental imaging code

The repository also retains experimental imaging and DiffDRR-related infrastructure in the Python research stack, including the lightweight synthetic/reference imaging service.

Those components remain useful for research development but are not required for every supported V2 reference-image exposure, because the current frontend can resolve supported reference views directly from static Firebase-hosted assets.

## 11. Current research boundary

The architecture supports simulation and engineering evaluation. It does not establish:

- clinical positioning accuracy
- patient-specific registration accuracy
- radiation-dose reduction
- diagnostic accuracy
- physical collision safety
- autonomous medical-device safety
- regulatory compliance

Those require separate experimental, physical, and clinical validation.
