# AI-Powered C-Arm Fluoroscopy Guidance Simulator

An AI-assisted C-arm fluoroscopy guidance simulator designed to improve radiographic positioning through digital twin simulation, 3D visualization, and deep learning–based automatic pose estimation.

This project combines medical imaging, computer vision, artificial intelligence, and interactive simulation to support research into reducing unnecessary fluoroscopic exposures while improving positioning accuracy.

---

## Features

- Interactive 3D C-arm simulator
- Digital twin of a fluoroscopy system
- AI-assisted automatic C-arm positioning
- Deep learning landmark regression
- Geometry-aware imaging pipeline
- FastAPI backend
- React + Three.js frontend
- Hardware prototype integration
- Training and evaluation utilities
- Dataset generation and annotation tools

---

## Project Structure

```
3DVisualizer/        React + Three.js frontend
python/              FastAPI backend and geometry bridge
AI/                  AI inference server
src/                 Model training and evaluation
assets/              3D models and resources
data/                Landmark datasets
logs/                Training logs and evaluation outputs
results/             Experimental results
```

---

## Technology Stack

- Python
- FastAPI
- React
- Three.js
- PyTorch
- NumPy
- OpenCV
- Vite

---

## Research Focus

The project investigates AI-guided fluoroscopy positioning using:

- Digital Twin simulation
- Landmark-based anatomical localization
- Deep learning regression
- Geometry-aware C-arm motion planning
- Automatic projection planning
- Hardware-in-the-loop simulation

The long-term objective is to reduce unnecessary radiation exposure by assisting operators in achieving optimal imaging angles efficiently.

---

## Hardware Prototype

The research includes a physical C-arm prototype synchronized with the digital simulation environment for validation of positioning algorithms.

---

## Repository Contents

- AI training scripts
- Inference pipeline
- Dataset preparation tools
- Geometry calibration
- C-arm simulator
- Evaluation scripts
- Experimental results

---

## Installation

Clone the repository

```bash
git clone https://github.com/SuhaimAlYafei/C-arm-guidance-simulator.git
```

Install dependencies

```bash
pip install -r requirements.txt
```

Frontend

```bash
cd 3DVisualizer/ciartic-app
npm install
npm run dev
```

Backend

```bash
uvicorn bridge.api:app --reload
```

---

## Future Work

- Real-time guidance
- Multi-view optimization
- Additional anatomical regions
- Improved uncertainty estimation
- Clinical validation
- Deployment as a web application

---

## Acknowledgements

This project was developed as part of ongoing research into AI-assisted medical imaging.

The repository includes work built upon previous research and development efforts. Appropriate credit should be given to all original contributors, collaborators, supervisors, and institutions involved throughout the project's development.

---

## License

See the LICENSE file for details.
