# Research Status and Limitations

## Current implementation

The V2 repository currently implements:

- interactive Three.js C-arm simulation
- patient visualization
- 17-landmark default registration
- registration persistence and calibration
- anatomy-aware targeting
- projection-aware requests
- scene-derived final-pose solving
- waypoint planning and playback
- central-ray verification
- isocenter verification
- arrival verification
- planner confidence and explanation output
- deterministic reference X-rays
- Firebase Hosting
- Firebase App Check
- Gemini Guidance
- Render planning backend
- Arduino / hardware-development hooks

## What the current software does not establish

The current simulator does **not** by itself establish:

- physical C-arm positioning accuracy
- clinical positioning accuracy
- patient-specific registration accuracy
- reduced radiation dose
- diagnostic image quality
- improved patient outcomes
- collision safety in a real operating room
- safe autonomous control of a physical C-arm
- regulatory compliance

## Geometry tolerance

The software currently uses a **1 mm internal scene-geometry acceptance threshold** for selected alignment checks.

This is an engineering constraint inside the simulated coordinate system. It must not be presented as measured physical or clinical accuracy.

## Planner confidence

Planner confidence is a software output used to summarize internal planning conditions.

It is not a calibrated probability of procedural or clinical success and should not be interpreted as such without dedicated validation.

## Reference radiographs

Reference images are simulator demonstration assets and do not constitute a validated diagnostic dataset.

Unsupported views may deliberately display no reference image.

## Gemini Guidance

Gemini receives structured simulator context and can explain software state and workflow.

AI output can be incorrect. It must not be used for diagnosis, treatment, patient management, radiation decisions, or clinical positioning.

## Patient model

The visible GLB is a simulator visualization asset.

A visually realistic surface does not establish anatomical or patient-specific registration accuracy.

## Hardware and hardware-in-the-loop work

Physical-prototype, Arduino, and hardware-in-the-loop development may be represented in the repository, but broader quantitative validation against a real clinical C-arm remains future work unless separately documented with measured evidence.

## Future validation priorities

1. Quantitative comparison between commanded and measured physical C-arm pose
2. Repeatability testing across landmarks and projections
3. Physical landmark-registration error measurement
4. Collision-safety evaluation under representative room configurations
5. Clinician comparison studies
6. Uncertainty calibration
7. Radiation-dose and workflow studies
8. Hardware-in-the-loop validation
9. Regulatory and risk-management assessment

## Intended use

This repository is intended for research, education, software development, and simulation. It is not intended for diagnosis, treatment, patient care, radiation control, or unsupervised control of medical equipment.
