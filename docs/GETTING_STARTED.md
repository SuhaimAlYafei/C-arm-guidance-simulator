# Getting Started

## Prerequisites

- Git
- Node.js and npm
- Python 3 for backend development
- Firebase CLI for Firebase deployment

Some research-only features may require heavier scientific or medical-imaging dependencies beyond the deployed V2 workflow.

## Clone the repository

```bash
git clone https://github.com/SuhaimAlYafei/C-arm-guidance-simulator.git
cd C-arm-guidance-simulator
```

## Frontend

```bash
cd 3DVisualizer/ciartic-app
npm install
npm run dev
```

Local Vite development normally runs at:

```text
http://localhost:5173
```

The frontend contains the React/Three.js digital twin, landmark registration, planner UI, C-arm animation, deterministic reference-X-ray display, Firebase App Check, and Gemini Guidance.

## Production build

```bash
npm run build
```

The generated frontend is written to:

```text
dist/
```

## Firebase Hosting

Configured Firebase project:

```text
c-arm-guidance-simulator
```

Deploy with:

```bash
firebase deploy --only hosting
```

Current production Hosting URL:

```text
https://c-arm-guidance-simulator.web.app
```

The custom domain `c-armsim.com` is being migrated to Firebase Hosting.

## Firebase App Check

Development builds enable the App Check debug provider through Vite's development mode.

Do not commit generated App Check debug-token values.

Production uses reCAPTCHA Enterprise through Firebase App Check.

## Gemini Guidance

Firebase AI initialization:

```text
3DVisualizer/ciartic-app/src/firebase/firebase.js
```

Assistant component:

```text
3DVisualizer/ciartic-app/src/components/GeminiAssistant.jsx
```

Gemini Guidance receives simulator context and is intended to explain the software state. It is not clinical decision support.

## Main planning backend

Production planner endpoint:

```text
https://c-arm-guidance-simulator.onrender.com/plan
```

For local backend development from the repository root:

```bash
pip install -r python/requirements.txt
cd python
uvicorn bridge.api:app --host 0.0.0.0 --port 8000
```

The planning backend provides pose/path planning, confidence output, explanation, and geometry-verification handling.

## Default registration

Bundled registration:

```text
3DVisualizer/ciartic-app/public/default_patient_registration.json
```

A saved browser calibration takes precedence over the bundled default.

## Patient model

```text
3DVisualizer/ciartic-app/public/medical_patient/patient.glb
```

## Reference X-rays

Current V2 frontend reference assets:

```text
3DVisualizer/ciartic-app/public/reference_xrays/
```

Only supported anatomy/projection mappings display reference images. Unsupported mappings intentionally produce a no-reference-image state.

## Legacy / experimental imaging service

The repository still contains lightweight imaging and DiffDRR-related research code. Those components can be run for development, but they are not required for every supported V2 reference exposure.

## Research warning

The simulator is for research, education, and engineering development. Do not use it for patient care, diagnosis, radiation control, or autonomous operation of medical equipment.
