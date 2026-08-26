# Acknowledgements

The **AI-Guided C-Arm Positioning Simulator V2** combines original simulator engineering with ideas, software, infrastructure, and research contributed by the wider medical-imaging, computer-vision, and open-source communities.

## Research foundation

This project gives explicit scholarly credit to **Ahmad Arrabi and collaborators** for their work on automated C-arm guidance, skeletal landmark localization, uncertainty modeling, and conformal prediction.

A key research reference is:

> Ahmad Arrabi, Jay Hwasung Jung, Jax Luo, Nathan Franssen, Scott B. Raymond, Safwan Wshah.  
> **Automated C-Arm Positioning via Conformal Landmark Localization.**  
> IEEE/CVF International Conference on Computer Vision Workshops (ICCVW), Advanced Perception for Autonomous Healthcare (APAH), 2025.

Official implementation:

https://github.com/AhmadArrabi/C_arm_guidance_APAH

ICCV Open Access publication:

https://openaccess.thecvf.com/content/ICCV2025W/APAH/html/Arrabi_Automated_C-Arm_Positioning_via_Conformal_Landmark_Localization_ICCVW_2025_paper.html

Related prior work by Arrabi and collaborators includes **C-arm Guidance: A Self-supervised Approach to Automated Positioning During Stroke Thrombectomy**.

The original research introduced and evaluated learned approaches for C-arm guidance and anatomical landmark localization. This V2 repository extends the broader research direction into an interactive digital-twin simulator with scene-geometry verification, web path planning, registration/calibration, reference-image workflows, hardware-development hooks, and AI-assisted interpretation of simulator state.

No authorship of the cited research is claimed by this repository unless explicitly stated in the original publications.

## Google technology

V2 uses several Google technologies as production infrastructure and application capabilities:

- **Firebase Hosting** — production deployment of the V2 web application
- **Firebase App Check** — application-attestation layer
- **reCAPTCHA Enterprise** — App Check provider
- **Firebase AI Logic** — integration layer for generative AI
- **Gemini** — model family used by the embedded Gemini Guidance simulator copilot

We gratefully acknowledge the engineering teams behind these technologies for providing the platform capabilities used by the project.

Google, Firebase, Gemini, and reCAPTCHA are trademarks of their respective owners. Their use in this project does **not** imply sponsorship, endorsement, partnership, or clinical validation by Google.

## Open-source ecosystem

The simulator also depends on and benefits from open-source projects and communities including:

- React
- Three.js
- Vite
- FastAPI
- Uvicorn
- Python scientific-computing libraries
- PyTorch and related research tooling
- DiffDRR-related research tooling

Each dependency remains subject to its own license and attribution terms.

## Research and development support

The project also acknowledges the mentors, clinicians, educators, collaborators, reviewers, and institutions that support research into safer and more reproducible image-guided intervention workflows.

## Attribution policy

Where this repository includes third-party models, reference images, datasets, libraries, or prior implementations, those materials remain subject to their original licenses and ownership. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

The repository MIT License applies only to software for which the repository contributors have the necessary rights to license.
