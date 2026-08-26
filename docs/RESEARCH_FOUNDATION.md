# Research Foundation and Prior Work

## Purpose

The AI-Guided C-Arm Positioning Simulator V2 is an independent research simulator that develops an interactive digital-twin workflow around automated C-arm positioning, anatomical targeting, geometry verification, path planning, and simulator-state explanation.

The project should be understood in the context of prior academic work on automated fluoroscopy guidance and skeletal landmark localization.

## Foundational C-arm guidance research

A central foundation for this repository is the work of **Ahmad Arrabi and collaborators**.

### Automated C-Arm Positioning via Conformal Landmark Localization

**Authors:** Ahmad Arrabi, Jay Hwasung Jung, Jax Luo, Nathan Franssen, Scott B. Raymond, Safwan Wshah  
**Venue:** IEEE/CVF International Conference on Computer Vision Workshops (ICCVW), Advanced Perception for Autonomous Healthcare (APAH), 2025

The work studies automated C-arm navigation toward predefined anatomical landmarks using X-ray images. It combines learned 3D displacement prediction with uncertainty modeling and conformal calibration to produce confidence regions around landmark estimates.

Official implementation:

https://github.com/AhmadArrabi/C_arm_guidance_APAH

ICCV Open Access:

https://openaccess.thecvf.com/content/ICCV2025W/APAH/html/Arrabi_Automated_C-Arm_Positioning_via_Conformal_Landmark_Localization_ICCVW_2025_paper.html

### Related earlier work

Arrabi and collaborators also published **C-arm Guidance: A Self-supervised Approach to Automated Positioning During Stroke Thrombectomy**, exploring learned skeletal-landmark representations for automated C-arm guidance.

## Relationship to this repository

The current V2 simulator is not presented as the official implementation of the Arrabi papers. The official implementation remains the upstream research repository linked above.

This repository extends the broader research direction through a different engineering layer focused on interactive simulation and system integration, including:

- a Three.js C-arm digital twin
- a calibrated anatomical landmark workflow
- scene-derived source/detector/isocenter geometry
- frontend geometry verification
- waypoint-based path execution
- a Render-hosted planning API
- deterministic reference-image exposure behavior
- patient registration import/export and persistence
- hardware / Arduino integration hooks
- Firebase Hosting and application attestation
- Gemini Guidance for interpreting simulator state

## Scientific boundary

Prior research results from Arrabi et al. must not be treated as validation of every feature in this repository. Similarly, the existence of a working simulator does not establish:

- clinical positioning accuracy
- physical-device accuracy
- radiation-dose reduction
- diagnostic performance
- collision safety
- autonomous medical-device safety
- regulatory compliance

Each claim requires its own appropriate validation.

## Recommended citation of the foundational paper

```bibtex
@InProceedings{Arrabi_2025_ICCV,
  author    = {Arrabi, Ahmad and Jung, Jay Hwasung and Luo, Jax and Franssen, Nathan and Raymond, Scott B. and Wshah, Safwan},
  title     = {Automated C-Arm Positioning via Conformal Landmark Localization},
  booktitle = {Proceedings of the IEEE/CVF International Conference on Computer Vision (ICCV) Workshops},
  year      = {2025}
}
```

For exact pagination and publication metadata, use the official ICCV Open Access record.

## Attribution principle

The simulator preserves a clear distinction between:

1. **prior scholarly research and upstream implementations**, which remain credited to their original authors; and
2. **V2 simulator engineering and integration**, which are documented in this repository.

See [`ACKNOWLEDGEMENTS.md`](../ACKNOWLEDGEMENTS.md) and [`RESEARCH_LIMITATIONS.md`](RESEARCH_LIMITATIONS.md).
