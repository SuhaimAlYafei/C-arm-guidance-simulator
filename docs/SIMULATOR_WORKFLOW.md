# Simulator Workflow

## 1. Select the imaging request

The operator chooses a procedure/body region, anatomical landmark, and projection. The interface also supports a short natural-language request that is interpreted into the structured planner controls.

## 2. Load or calibrate anatomical landmarks

The simulator uses registered anatomical landmarks on the 3D patient model. Calibration mode exposes the landmark skeleton and allows controlled adjustment before saving the registration.

## 3. Preview the path

`PREVIEW PATH` solves the requested final C-arm pose using the live Three.js scene hierarchy and checks the selected target against the simulated source-detector central ray.

A path is accepted only when the configured scene-geometry checks pass. The current simulator uses a 1 mm internal acceptance threshold for isocenter and central-ray alignment. This is a software-engineering tolerance, not a demonstrated clinical accuracy claim.

## 4. Inspect confidence and geometry

The planner reports:

- request and anatomical region
- target coordinates
- planned final pose
- confidence score
- geometry-verification state
- isocenter error
- central-ray error
- planner explanation

## 5. Move the C-arm

`MOVE C-ARM` executes the waypoint sequence in the digital twin. The final geometry is preserved from the verified scene solution rather than being silently replaced after planning.

## 6. Arrive and expose

After the system reaches the verified final pose, the workflow enters `ARRIVED`. `EXPOSE X-RAY` then requests a projection-specific simulated radiographic image.

Where a verified reference is available, the imaging service prefers deterministic anatomy/projection mapping over unconstrained image generation.

## 7. Output

The simulated fluoroscopy display shows the resulting image and supports downloading the generated/demo radiograph and associated metadata.

## Safety and scope

The workflow is for research and education. It is not approved for clinical positioning, diagnosis, treatment, radiation-dose control, or autonomous operation of real medical equipment.
