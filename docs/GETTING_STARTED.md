# Getting Started

## Prerequisites

- Git
- Node.js and npm
- Python 3

Some research-only features may require heavier scientific or medical-imaging dependencies beyond the lightweight deployed workflow.

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

The frontend contains the React/Three.js digital twin, controls, landmark registration interface, planner UI, C-arm animation, and fluoroscopy display.

## Main planning backend

From the repository root:

```bash
pip install -r python/requirements.txt
cd python
uvicorn bridge.api:app --host 0.0.0.0 --port 8000
```

The planning backend provides pose/path planning, confidence output, and geometry-verification handling. Optional DRR-related features may require additional datasets and environment configuration.

## Lightweight imaging backend

From the repository root:

```bash
pip install -r python/requirements-synthetic.txt
cd python
uvicorn bridge.synthetic_server:app --host 0.0.0.0 --port 8001
```

This service resolves anatomy + projection requests against the reference-radiograph library and is intentionally kept lightweight for fast deployment.

## Reference radiographs

Projection-specific demo images live in:

```text
python/bridge/reference_xrays/
```

Do not add patient-identifiable material. Confirm redistribution rights for externally sourced radiographs before committing them to a public repository.

## Deployed demo

The public research simulator is available at:

https://c-armsim.com
