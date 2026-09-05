# V3 Research Demonstration Sequence

This is a technical demonstration order, not a clinical-use script.

1. Open the simulator and identify the research-only notice.
2. Show the registered anatomical landmark overlay.
3. Open **OR SAFETY** and enable **BUBBLES**.
4. Identify the IV pole and its safety envelope.
5. Open **AWARD STUDY** and apply **Nominal / reset**.
6. Select one anatomy/projection and run `PREVIEW PATH`.
7. Point out geometry verification separately from collision clearance.
8. Capture the nominal paired trial.
9. Apply **IV pole challenge** and rerun the same requested view.
10. Show whether the direct trajectory is clear, rerouted, or blocked.
11. If rerouted, identify the avoided obstacle and minimum sampled clearance.
12. Capture the IV-pole trial.
13. Apply **Crowded OR challenge** and repeat.
14. Open **RESEARCH LAB**, enable patient motion, and run the 24-phase robustness sweep.
15. Capture one dynamic-patient trial.
16. Show live study summary: direct-route conflict rate, collision-aware accepted rate, reroute rate, blocked rate, geometry-verified rate, and clearance statistics.
17. Export JSON/CSV/Markdown evidence.
18. End by stating the evidence boundary: software-only simulator results; physical/HIL validation is the next stage.

## Key technical distinction

The project evaluates two different requirements:

- **Imaging geometry:** whether the selected simulated anatomical target lies on the intended central-ray/isocenter geometry within the internal simulator criterion.
- **Trajectory clearance:** whether sampled C-arm geometry remains outside modeled patient/equipment safety envelopes along the route.

A route can satisfy one requirement and fail the other, so V3 records them separately.
