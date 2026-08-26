# C-Arm Guidance Simulator Documentation

Welcome to the documentation hub for the **AI-Guided C-Arm Positioning Simulator V2**.

This project is a research platform for anatomy-aware C-arm positioning, live scene-geometry verification, waypoint-based path planning, deterministic reference radiography, Firebase-hosted deployment, and AI-assisted simulator guidance.

> **Research use only.** The simulator is not a medical device and is not clinically validated.

## Start here

- [Getting Started](GETTING_STARTED.md) — local setup, Firebase deployment, and backend startup
- [Simulator Workflow](SIMULATOR_WORKFLOW.md) — end-to-end operator flow
- [Architecture](ARCHITECTURE.md) — Firebase frontend, Render planner, App Check, Gemini, and asset flow
- [API Reference](API.md) — production planning endpoint and legacy imaging API notes
- [Research Status and Limitations](RESEARCH_LIMITATIONS.md) — implemented capabilities and evidence boundaries
- [Third-Party Notices](../THIRD_PARTY_NOTICES.md) — asset and dependency licensing notes

## Live system

- V2 simulator: https://c-arm-guidance-simulator.web.app
- Custom domain: `c-armsim.com` migration to Firebase Hosting in progress
- Frontend: React + Three.js + Vite
- Hosting: Firebase Hosting
- App protection: Firebase App Check + reCAPTCHA Enterprise
- AI assistant: Firebase AI Logic / Gemini Guidance
- Planning backend: FastAPI on Render

## Core workflow

```text
Select procedure / anatomy / projection
        |
        v
Load default or saved landmark registration
        |
        v
PREVIEW PATH
        |
        v
Verify central-ray and isocenter geometry
        |
        v
Plan waypoints with Render /plan
        |
        v
MOVE C-ARM
        |
        v
ARRIVED + arrival verification
        |
        v
EXPOSE X-RAY
        |
        +--> supported mapping --> reference image
        |
        +--> unsupported mapping --> no reference image
```

## Project ownership and licensing

Original repository software is distributed under the MIT License. Existing contributor notices are preserved in the repository `LICENSE` file. Third-party medical images, datasets, models, textures, and other assets remain subject to their original licenses and permissions.
