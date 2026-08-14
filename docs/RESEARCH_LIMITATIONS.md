# Research Status and Limitations

## Current research status

The repository implements a working web-based research simulator with:

- interactive 3D C-arm visualization
- anatomical landmark registration and targeting
- projection-aware request handling
- scene-geometry pose solving
- waypoint-based movement planning
- central-ray and isocenter verification
- confidence and explanation output
- projection-specific reference-radiograph mapping
- deployed frontend and backend services

## What the current software does not establish

The current simulator does **not** by itself establish:

- clinical positioning accuracy
- reduced radiation dose
- diagnostic image quality
- improved patient outcomes
- safe autonomous control of a physical C-arm
- regulatory compliance
- collision safety in a real operating room

## Geometry tolerance

The software currently uses a **1 mm internal scene-geometry acceptance threshold** for selected alignment checks. This is an engineering constraint inside the simulated environment. It must not be presented as measured physical or clinical accuracy.

## Confidence score

Planner confidence is a software output used to summarize internal planning conditions. It is not a calibrated probability of clinical success and should not be interpreted as such without a dedicated validation study.

## Radiographic output

The lightweight imaging workflow uses projection-specific reference radiographs when available. These images are demonstration assets and do not constitute a validated clinical dataset.

## Hardware-in-the-loop work

Physical-prototype and hardware-in-the-loop development may be present in the repository, but broader quantitative validation against a real clinical C-arm remains future work unless separately documented with measured evidence.

## Future validation priorities

1. Quantitative comparison between commanded and measured physical C-arm pose
2. Repeatability testing across landmarks and projections
3. Collision-safety evaluation under representative room configurations
4. Clinician comparison studies
5. Uncertainty calibration
6. Radiation-dose and workflow studies
7. Regulatory and risk-management assessment

## Intended use

This repository is intended for research, education, software development, and simulation. It is not intended for diagnosis, treatment, patient care, or unsupervised control of medical equipment.
