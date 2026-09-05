# V3 Research Protocol — Collision-Aware Digital Twin Planning

## Working research title

**Collision-Aware Digital Twin Planning for Safe and Repeatable C-Arm Positioning in Simulated Clinical Environments**

## Research purpose

The V3 study evaluates whether adding explicit operating-room obstacle models and collision-aware trajectory checking can reduce simulated direct-route conflicts while preserving the geometry requirements of anatomy-targeted C-arm positioning.

This is a software-only engineering study. It does not establish physical collision safety, clinical positioning accuracy, radiation-dose reduction, or medical-device validation.

## Research question

Can a collision-aware digital twin generate geometry-valid simulated C-arm trajectories to anatomical targets while avoiding modeled patient/equipment safety envelopes more reliably than the unmodified direct planner trajectory?

## Hypotheses

- **H1:** A measurable proportion of direct planner trajectories will conflict with modeled operating-room safety envelopes in deliberately challenging layouts.
- **H2:** Collision-aware trajectory checking and staged rerouting will reduce the number of accepted trajectories that intersect modeled safety envelopes.
- **H3:** Collision-aware rerouting can preserve the existing simulator geometry-verification requirement at the final pose.
- **H4:** Dynamic patient-motion perturbations will identify scenarios in which a static plan becomes less robust, motivating adaptive replanning.

## Independent variables

Controlled study factors may include:

- requested anatomical landmark
- requested projection
- initial C-arm pose
- IV-pole position
- Mayo-stand position
- instrument-trolley position
- anesthesia-workstation position
- monitor-cart position
- simulated staff position
- respiratory motion amplitude
- respiratory motion frequency
- selected research-only radiation proxy settings

## Dependent variables

Primary collision-planning metrics:

- direct-route conflict: yes/no
- collision-aware accepted: yes/no
- rerouted: yes/no
- blocked: yes/no
- minimum sampled clearance (mm)
- checked waypoint count
- avoided obstacle labels

Geometry metrics:

- geometry verified: yes/no
- isocenter error (mm)
- central-ray error (mm)
- planner confidence (%)

Dynamic-patient metrics:

- respiratory displacement (mm)
- adaptive replan count
- robustness-sweep safe phases
- worst sampled clearance across respiratory phases

Secondary research-only imaging proxies:

- metal-in-field status
- artifact-severity index
- relative output index
- KAP proxy index
- relative staff-scatter index

These radiation-related outputs are intentionally labeled as uncalibrated engineering proxies and must not be reported as mGy, mSv, or clinical dosimetry.

## Simulator engineering thresholds

Current internal thresholds include:

- geometry acceptance criterion: **1 mm** inside the simulator geometry-verification logic
- minimum sampled collision clearance criterion: **5 mm**
- near-clearance flag: **80 mm**

These values are software engineering thresholds, not demonstrated physical or clinical accuracy/safety limits.

## Experimental workflow

1. Select a controlled study scenario.
2. Set the desired anatomy and projection.
3. Position OR obstacles for the scenario.
4. Run `PREVIEW PATH`.
5. Allow the direct trajectory to be evaluated against the Three.js safety envelopes.
6. If the direct route conflicts, allow the staged collision-aware planner to search for an alternative path.
7. Record planner outcome, minimum sampled clearance, waypoint count, geometry verification, and relevant contextual variables.
8. Capture the trial using **AWARD STUDY**.
9. Repeat across predefined anatomy/projection/layout combinations.
10. Export the JSON/CSV evidence package and compute summary statistics.

## Recommended study design

Use repeated paired simulator trials. For every requested view, the same backend-proposed direct trajectory is first treated as the comparator and checked against the same live scene. If it violates the simulated safety envelopes, the collision-aware layer attempts a reroute. This pairing allows direct-route conflict and collision-aware outcome to be compared within the same requested imaging task.

Recommended minimum structure for a formal study:

- multiple anatomical targets
- multiple projection classes
- at least three OR-layout difficulty levels
- repeated starts per condition
- fixed documented configuration for each scenario
- deterministic naming of scenario groups
- no manual deletion of unsuccessful trials

The final sample size should be justified before formal reporting rather than selected after inspecting favorable results.

## Scenario groups

### A. Default OR layout

Purpose: establish nominal path behavior.

### B. IV-pole challenge

Place the IV pole near a direct approach corridor and quantify conflict/reroute outcomes.

### C. Crowded OR challenge

Use multiple movable OR objects to create constrained corridors.

### D. Patient-motion challenge

Use respiratory displacement and the 24-phase robustness sweep to test path sensitivity.

### E. Metal-in-FOV challenge

Use the research-only beam/metal detector to document whether modeled metallic OR equipment intersects the simulated field of view.

## Primary analysis

Report at minimum:

- number of trials
- direct-route conflict rate
- collision-aware accepted rate
- reroute rate
- blocked rate
- geometry-verified rate
- minimum, median, and 5th-percentile sampled clearance
- mean isocenter error
- mean central-ray error
- mean planner confidence

Where appropriate, report results by anatomy, projection, and scenario group rather than only as an overall average.

## Reproducibility and evidence capture

The V3 **AWARD STUDY** panel stores structured browser-local trial records and can export:

- full JSON evidence package
- flat CSV trial table
- generated Markdown study snapshot

Each captured trial includes a non-cryptographic FNV-1a integrity identifier to make accidental record changes easier to detect during analysis. It is not a security signature.

## Interpretation rules

Use the following wording conventions in reports and presentations:

- `planner confidence`, not `accuracy`
- `internal simulator geometry criterion`, not `clinical accuracy`
- `sampled collision clearance`, not `guaranteed physical clearance`
- `software-only validation`, not `clinical validation`
- `relative radiation proxy`, not `dose`
- `collision-aware simulated trajectory`, not `safe real-world trajectory`

## Next validation stage

The strongest next step after software experiments is hardware-in-the-loop validation using measured physical C-arm/prototype pose and independently measured obstacle positions. Physical results should be reported separately from software-only results.
