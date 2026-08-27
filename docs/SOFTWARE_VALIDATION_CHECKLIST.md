# Software Validation Checklist

This is a software-engineering QA checklist for the simulator. It is not an ISEF research plan, abstract, poster, or presentation script.

## 1. Static OR collision avoidance

For each selected anatomy/projection scenario:

- record the direct-path waypoint count
- record minimum sampled clearance
- move one OR obstacle into the direct route
- rerun PREVIEW PATH
- record whether a reroute is found
- record rerouted minimum clearance
- repeat with IV pole, Mayo stand, monitor cart, anesthesia workstation, surgeon, and scrub nurse

Recommended engineering outputs:

- collision-detection sensitivity
- reroute success rate
- minimum-clearance distribution
- path-length change
- planning latency

## 2. Dynamic respiratory robustness

Use the built-in 24-phase robustness sweep after PREVIEW PATH.

Record:

- respiratory amplitude
- breaths per minute
- safe phases / total phases
- worst sampled clearance
- mean sampled clearance
- number of adaptive replans during an adaptive move
- whether a route becomes blocked

Repeat the same scenario at multiple amplitudes so the result can be graphed as a controlled variable rather than shown as a single demo.

## 3. Interactive OR perturbation testing

Create controlled layout perturbations with the OR editor.

For each perturbation:

- record object name
- record displacement from baseline
- invalidate the old route
- rerun PREVIEW PATH
- log direct / rerouted / blocked result
- export JSON or CSV from the Research Lab panel

## 4. Metal-in-beam checks

Place metallic OR objects in and out of the simulated source-detector path and record:

- object identity
- metal-in-FOV status
- artifact-severity proxy
- selected projection

The current artifact value is an engineering proxy and must not be described as a validated clinical artifact score.

## 5. Radiation/scatter proxy checks

Vary one parameter at a time while holding the others constant:

- kVp
- tube current
- pulse rate
- exposure duration
- field size
- staff distance from the patient

Expected sanity checks:

- longer exposure increases the output index
- higher kVp increases the output index
- larger field size increases the KAP proxy
- greater staff distance reduces the scatter proxy through inverse-square scaling

These are uncalibrated relative indices. Do not report them as mGy, mSv, or clinical KAP until the model has been calibrated against supervised measurements made with appropriate equipment and approvals.

## 6. Reproducibility

For every software release used in a competition or report, preserve:

- Git commit SHA
- simulator version
- test scenario parameters
- exported research log
- browser/runtime version
- CI result
- known limitations

## 7. Automated regression tests

The GitHub Actions workflow should pass before a release candidate is accepted:

- Node research-math unit tests
- Vite production build
- Python planner regression tests
- Python syntax compilation

## 8. Claims boundary

Do not claim any of the following unless separately validated with appropriate supervised methodology:

- clinical positioning accuracy
- physical collision-safety certification
- patient dose in mGy/mSv
- staff effective dose
- diagnostic image quality
- autonomous medical-device safety

The strongest defensible claim for the current branch is that it is a collision-aware, adaptive, research digital twin with reproducible simulated metrics and explicit validation boundaries.
