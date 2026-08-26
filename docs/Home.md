# C-Arm Guidance Simulator V2 Documentation

Welcome to the documentation hub for the **AI-Guided C-Arm Positioning Simulator V2**.

**Canonical live simulator:** https://c-armsim.com

This project is a research platform for anatomy-aware C-arm positioning, live scene-geometry verification, waypoint-based path planning, deterministic reference radiography, Firebase-hosted deployment, and AI-assisted simulator guidance.

> **Research use only.** The simulator is not a medical device and is not clinically validated.

## Start here

- [Getting Started](GETTING_STARTED.md) — local setup, Firebase deployment, and backend startup
- [Simulator Workflow](SIMULATOR_WORKFLOW.md) — end-to-end operator flow
- [Architecture](ARCHITECTURE.md) — Firebase frontend, Render planner, App Check, Gemini, and asset flow
- [Research Foundation](RESEARCH_FOUNDATION.md) — Ahmad Arrabi's C-arm guidance research and related prior work
- [API Reference](API.md) — production planning endpoint and legacy imaging API notes
- [Research Status and Limitations](RESEARCH_LIMITATIONS.md) — implemented capabilities and evidence boundaries
- [Acknowledgements](../ACKNOWLEDGEMENTS.md) — scholarly and technology credit
- [Third-Party Notices](../THIRD_PARTY_NOTICES.md) — asset and dependency licensing notes

## Production V2 stack

- **Website:** https://c-armsim.com
- **Firebase fallback:** https://c-arm-guidance-simulator.web.app
- **Frontend:** React + Three.js + Vite
- **Hosting:** Google Firebase Hosting
- **Application protection:** Firebase App Check + reCAPTCHA Enterprise
- **AI assistant:** Firebase AI Logic + Gemini Guidance
- **Planning backend:** FastAPI on Render
- **Reference imaging:** deterministic static reference mappings for supported views

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

## Research lineage

The project explicitly credits **Ahmad Arrabi and collaborators** for foundational work in automated C-arm guidance and conformal anatomical landmark localization. The official implementation of their ICCVW 2025 APAH work is maintained at:

https://github.com/AhmadArrabi/C_arm_guidance_APAH

See [Research Foundation](RESEARCH_FOUNDATION.md) for the relationship between that research and this V2 simulator.

## Google technology acknowledgement

V2 uses Firebase Hosting, Firebase App Check, reCAPTCHA Enterprise, Firebase AI Logic, and Gemini. These technologies are credited as platform dependencies. Their use does not imply sponsorship, endorsement, or clinical validation by Google.

## Project ownership and licensing

Original repository software is distributed under the MIT License. Existing contributor notices are preserved in the repository `LICENSE` file. Third-party medical images, datasets, models, textures, and other assets remain subject to their original licenses and permissions.
