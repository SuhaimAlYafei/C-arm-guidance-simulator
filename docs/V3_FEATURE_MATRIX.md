# V3 Feature & Evidence Matrix

This matrix separates implemented simulator functionality from evidence that still requires experimental validation.

| Capability | V3 implementation | Evidence output | Current interpretation |
|---|---|---|---|
| Anatomy-aware positioning | 17-landmark registered target workflow | target/projection metadata | implemented software workflow |
| Geometry verification | central-ray + isocenter checks | error values + verified flag | internal simulator criterion only |
| Collision-aware planning | direct-path checking + staged rerouting | conflict, reroute, blocked, clearance | software-only scene validation |
| IV-pole avoidance | modeled IV pole + safety envelope | obstacle label + clearance | simulated obstacle avoidance |
| Crowded-OR testing | movable OR equipment + challenge presets | scenario-labelled paired trials | controlled simulator stress testing |
| Safety bubbles | visible collision envelopes | bubble visibility + obstacle set | visualization of modeled margins |
| Patient motion | respiratory displacement model | displacement + replan count | simulated motion perturbation |
| Motion robustness | 24-phase sweep | safe phases + worst clearance | software robustness analysis |
| Adaptive replanning | motion-aware replan workflow | adaptive status + replan count | simulator-only adaptive behavior |
| Metal-in-FOV intelligence | metal/beam intersection analysis | metal flag + artifact index | engineering proxy only |
| Radiation intelligence | relative output/KAP/scatter models | relative indices | uncalibrated proxy, not dosimetry |
| Reproducibility | structured run logging | JSON + CSV | browser-local research evidence |
| Paired award study | direct-route comparator + collision-aware outcome | live statistics + exports | designed for controlled experiments |
| Trial integrity marker | FNV-1a trial identifier | per-trial hash field | accidental-change indicator, not cryptographic proof |
| Gemini Guidance | simulator-context explanation | interactive explanation | not clinical decision support |
| Hardware integration | Arduino/prototype hooks | future HIL measurements | physical validation still required |

## Claims that are currently appropriate

- collision-aware **simulated** trajectory planning
- explicit Three.js operating-room obstacle envelopes
- reproducible software-only collision/clearance experiments
- internal simulator geometry verification
- dynamic-patient robustness experiments
- research-only relative radiation/scatter proxies

## Claims that require future physical or clinical evidence

- physical collision safety
- millimeter physical positioning accuracy
- patient safety
- clinical workflow improvement
- radiation-dose reduction
- diagnostic image-quality improvement
- autonomous clinical use
- medical-device effectiveness

## Strong next evidence milestone

Hardware-in-the-loop measurements should compare commanded versus measured pose, repeatability, physical obstacle clearance, and registration error under a predefined protocol. Physical results should be stored and reported separately from the software-only V3 benchmark.
