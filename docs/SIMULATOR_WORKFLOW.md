# Simulator Workflow - V2

## 1. Open the simulator

The Firebase-hosted application loads the digital twin, patient visualization, registration data, and simulator controls.

## 2. Registration

If a browser-saved registration exists, it is restored.

Otherwise the bundled default registration is loaded from:

```text
/default_patient_registration.json
```

The current baseline includes LM0-LM16.

## 3. Select the imaging request

Choose the procedure/body region, anatomical landmark, and projection. The interface can also interpret a short natural-language request into the structured simulator controls.

## 4. Preview the path

Press `PREVIEW PATH`.

The frontend uses the live Three.js scene to solve and verify the requested target geometry, then sends the planning request to the production Render `/plan` service.

A path is accepted only when the configured scene-geometry checks pass.

The current 1 mm internal threshold is a software-engineering tolerance inside the simulator, not a demonstrated clinical accuracy claim.

## 5. Inspect planner and geometry information

The simulator can report:

- request and anatomy
- target coordinates
- planned final pose
- planner confidence
- geometry-verification state
- isocenter error
- central-ray error
- planning explanation

## 6. Move the C-arm

Press `MOVE C-ARM`.

The digital C-arm follows the waypoint sequence returned by the planner.

## 7. Arrival verification

At the final waypoint the simulator evaluates the achieved pose against the planned final pose and geometry information.

A successful workflow reaches:

```text
ARRIVED
```

## 8. Exposure

Press `EXPOSE X-RAY`.

If `REFERENCE_XRAY_MAP` contains a supported anatomy/projection mapping, the frontend displays the corresponding static reference radiograph from `public/reference_xrays/`.

If the mapping does not exist, the interface explicitly reports that no reference image is available instead of fabricating a radiograph.

## 9. Output

The fluoroscopy display shows the selected reference image when available and records exposure metadata such as anatomy, projection, planner status, geometry-verification state, and renderer/reference source.

## 10. Gemini Guidance

Gemini Guidance can explain simulator state, planning information, geometry verification, and the latest exposure information supplied to it by the application.

It is not a clinical decision-support system.

## 11. Calibration tools

Landmarks can be recalibrated, saved locally, exported, and imported for simulator research.

## Safety and scope

This workflow is for research, education, and engineering development. It is not approved for clinical positioning, diagnosis, treatment, radiation-dose control, or autonomous operation of real medical equipment.
