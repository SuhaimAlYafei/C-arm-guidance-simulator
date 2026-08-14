# C-Arm Guidance Simulator Documentation

Welcome to the documentation hub for the **AI-Guided C-Arm Positioning Simulator**.

This project is a research platform for anatomy-aware C-arm positioning, live scene-geometry verification, waypoint-based path planning, and simulated fluoroscopic output.

> **Research use only.** The simulator is not a medical device and is not clinically validated.

## Start here

- [Getting Started](GETTING_STARTED.md) — local setup and service startup
- [Simulator Workflow](SIMULATOR_WORKFLOW.md) — end-to-end operator flow
- [Architecture](ARCHITECTURE.md) — frontend, planner, imaging service, and deployment design
- [API Reference](API.md) — planning and synthetic-X-ray endpoints
- [Research Status and Limitations](RESEARCH_LIMITATIONS.md) — what is implemented, what is not yet validated

## Live system

- Simulator: https://c-armsim.com
- Frontend: React + Three.js
- Planning backend: FastAPI on Render
- Imaging backend: lightweight FastAPI service on Render

## Core workflow

```text
Select anatomy + projection
        ↓
Calibrate / load landmark registration
        ↓
Preview target pose and path
        ↓
Verify central-ray and isocenter geometry
        ↓
Move C-arm through planned waypoints
        ↓
ARRIVED
        ↓
EXPOSE X-RAY
        ↓
Projection-specific simulated radiographic output
```

## Project ownership and licensing

Repository software is distributed under the MIT License. Existing contributor notices are preserved in the repository `LICENSE` file. Third-party medical images, datasets, models, and assets remain subject to their own licenses and permissions.
