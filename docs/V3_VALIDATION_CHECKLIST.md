# V3 Pre-Release Validation Checklist

Use this checklist before merging V3 into `main` or using results in an award submission.

## Build / regression

- [ ] `npm ci`
- [ ] `npm run test:research`
- [ ] `npm run build`
- [ ] planner regression tests pass
- [ ] no new browser console errors
- [ ] Firebase App Check / Gemini works on the production domain

## Core simulator regression

- [ ] default patient registration loads on a fresh browser profile
- [ ] saved registration still overrides the default intentionally
- [ ] all 17 landmarks can be selected
- [ ] AP and lateral reference-image workflow still behaves correctly
- [ ] unsupported reference views explicitly report unavailable
- [ ] PREVIEW PATH still returns a geometry-verified result when feasible
- [ ] MOVE C-ARM reaches the stored final pose
- [ ] exposure remains locked until verified arrival

## OR collision system

- [ ] IV pole is visible in the scene
- [ ] Mayo stand is visible
- [ ] instrument trolley is visible
- [ ] anesthesia workstation / monitor / modeled staff are visible where configured
- [ ] `BUBBLES` toggle shows modeled collision envelopes
- [ ] patient/table safety envelope is included
- [ ] moving equipment moves its corresponding safety envelope
- [ ] direct collision is detected in a deliberately blocked layout
- [ ] collision-aware rerouting occurs when a feasible route exists
- [ ] infeasible final pose is blocked rather than forced
- [ ] minimum clearance is reported in the research panel

## Controlled scenario presets

- [ ] nominal reset produces the same object layout on repeated application
- [ ] IV challenge produces the same offsets on repeated application
- [ ] crowded OR challenge produces the same offsets on repeated application
- [ ] open-corridor control produces the same offsets on repeated application
- [ ] applying a preset requires a new PREVIEW PATH before trial capture

## Patient motion

- [ ] respiratory animation can be enabled/disabled
- [ ] amplitude control changes the modeled displacement
- [ ] breathing-rate control changes phase rate
- [ ] motion envelope toggles correctly
- [ ] adaptive move can stop safely in the simulator
- [ ] 24-phase robustness sweep returns a complete result

## Research evidence capture

- [ ] `AWARD STUDY` panel opens
- [ ] trial capture stores anatomy, projection, geometry and collision metadata
- [ ] scenario label and revision are stored
- [ ] direct-route conflict is distinguished from collision-aware accepted outcome
- [ ] reroute and blocked outcomes are distinguished
- [ ] minimum clearance is recorded
- [ ] geometry verification and errors are recorded
- [ ] motion context is recorded
- [ ] research-only radiation proxy context is recorded
- [ ] JSON export opens successfully
- [ ] CSV export contains one row per trial
- [ ] Markdown summary matches the stored trial statistics
- [ ] integrity identifier is present for every captured trial

## Scientific reporting guardrails

- [ ] use `planner confidence`, never `accuracy`
- [ ] call 1 mm an internal simulator geometry criterion
- [ ] call clearance `sampled simulated clearance`
- [ ] call radiation outputs uncalibrated relative engineering proxies
- [ ] do not claim physical collision safety
- [ ] do not claim clinical positioning accuracy
- [ ] do not claim dose reduction without calibrated experimental evidence
- [ ] do not claim diagnostic or medical-device validation

## Hardware-in-the-loop future stage

- [ ] define physical pose measurement method
- [ ] define registration measurement method
- [ ] define physical obstacle-clearance measurement method
- [ ] predefine acceptance criteria before collecting HIL results
- [ ] record commanded vs measured values independently
- [ ] report physical results separately from software-only V3 results
