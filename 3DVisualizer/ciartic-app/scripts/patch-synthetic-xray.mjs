import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appPath = path.resolve(here, '..', 'src', 'App.jsx');
const source = fs.readFileSync(appPath, 'utf8');

const patchMarker = 'SYNTHETIC_XRAY_ENDPOINT';
if (source.includes(patchMarker)) {
    console.log('Synthetic X-ray frontend patch already present.');
    process.exit(0);
}

const startMarker = '    const handleTakeXray = async () => {';
const endMarker = '\n    // --- ARDUINO CONNECTION ---';
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);

if (start < 0 || end < 0) {
    throw new Error('Could not locate the existing handleTakeXray block. Refusing to modify App.jsx.');
}

const replacement = `    const handleTakeXray = async () => {
        // SYNTHETIC_XRAY_ENDPOINT: AI exposure path only. Planner and C-arm geometry stay untouched.
        const shotControls = { ...controls };

        let regionKeyAtShot = "miss";
        if (srcAnchorRef.current && detAnchorRef.current) {
            srcAnchorRef.current.updateMatrixWorld(true);
            detAnchorRef.current.updateMatrixWorld(true);

            const worldSource = new THREE.Vector3();
            const worldDetector = new THREE.Vector3();
            srcAnchorRef.current.getWorldPosition(worldSource);
            detAnchorRef.current.getWorldPosition(worldDetector);

            const classification = computeBeamClassification(
                worldSource,
                worldDetector,
                patientModelRef.current,
                patientBoundsRef.current
            );
            regionKeyAtShot = classification.hit ? classification.zoneKey : "miss";
        }

        const geometry = captureExposureGeometry(
            shotControls,
            selectedAnatomy,
            regionKeyAtShot
        );

        if (!geometry) {
            alert("Exposure geometry could not be captured.");
            return;
        }

        const anatomyInfo = ANATOMICAL_TARGETS[selectedAnatomy] || ANATOMICAL_TARGETS.MANUAL;
        const projection = getProjectionConfig(
            selectedProjection,
            anatomyInfo,
            plannerObliqueAngle
        );

        const anatomyLabel =
            anatomyInfo?.shortLabel
            || anatomyInfo?.label
            || anatomyInfo?.regionLabel
            || regionKeyAtShot
            || 'anatomy';

        const fullAnatomyText = [
            anatomyInfo?.label,
            anatomyInfo?.regionLabel,
            anatomyLabel
        ].filter(Boolean).join(' ');

        const laterality = /\\bleft\\b/i.test(fullAnatomyText)
            ? 'left'
            : /\\bright\\b/i.test(fullAnatomyText)
                ? 'right'
                : null;

        const angulationDirection = selectedProjection === 'CAUDAL'
            ? 'caudal'
            : selectedProjection === 'CRANIAL'
                ? 'cranial'
                : null;

        const now = new Date();
        const sampleId = \`sample_\${now.toISOString().replace(/[:.]/g, "-")}\`;
        const annotation = {
            sample_id: sampleId,
            image_filename: \`\${sampleId}.png\`,
            captured_at_utc: now.toISOString(),
            ...geometry
        };

        setBeamActive(true);
        setCurrentAnatomy('ACQUIRING...');

        try {
            // Brief acquisition phase so exposure behaves like an imaging workflow,
            // while the actual generation time provides the processing delay.
            await new Promise(resolve => setTimeout(resolve, 650));
            setCurrentAnatomy('PROCESSING...');

            const response = await fetch(
                'https://c-arm-guidance-simulator.onrender.com/synthetic-xray',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json'
                    },
                    body: JSON.stringify({
                        anatomy: anatomyLabel,
                        view: projection?.label || selectedProjection || 'AP',
                        laterality,
                        angulation_deg: Number.isFinite(Number(projection?.angleDeg))
                            ? Number(projection.angleDeg)
                            : 0,
                        angulation_direction: angulationDirection
                    })
                }
            );

            if (!response.ok) {
                let message = \`Synthetic X-ray server returned HTTP \${response.status}\`;
                try {
                    const errorData = await response.json();
                    if (errorData?.detail) message = String(errorData.detail);
                } catch {
                    // Keep the HTTP message when the response is not JSON.
                }
                throw new Error(message);
            }

            const result = await response.json();
            if (!result.image_base64 || !result.mime_type) {
                throw new Error('Synthetic X-ray server returned no usable image.');
            }

            const xrayDataUrl = \`data:\${result.mime_type};base64,\${result.image_base64}\`;
            const completedAnnotation = {
                ...annotation,
                renderer: {
                    mode: 'ai_synthetic_radiograph',
                    provider: result.source || 'cloudflare_workers_ai',
                    model: result.model || 'unknown',
                    synthetic: true,
                    requested_anatomy: anatomyLabel,
                    requested_view: projection?.label || selectedProjection || 'AP',
                    laterality,
                    angulation_deg: Number(projection?.angleDeg || 0),
                    angulation_direction: angulationDirection
                }
            };

            setLastXray(xrayDataUrl);
            setCurrentAnatomy(String(anatomyLabel).toUpperCase());

            downloadDataUrl(xrayDataUrl, \`\${sampleId}_AI_SYNTHETIC.png\`);
            setTimeout(() => {
                downloadJson(completedAnnotation, \`\${sampleId}_AI_SYNTHETIC.json\`);
            }, 150);

            console.log('AI synthetic exposure generated:', completedAnnotation);
        } catch (error) {
            console.error('AI synthetic exposure generation failed:', error);

            // Safe demo fallback: preserve the existing landmark-aware atlas image
            // instead of leaving the monitor blank when the free AI service is unavailable.
            const fallbackDataUrl = generateLandmarkAtlasXray(
                selectedAnatomy,
                selectedProjection
            );

            const fallbackAnnotation = {
                ...annotation,
                renderer: {
                    mode: 'synthetic_landmark_atlas_fallback',
                    dataset_id: 'skeleton_atlas_v1',
                    selected_landmark: annotation.selected_landmark,
                    reason: error?.message || String(error)
                }
            };

            setLastXray(fallbackDataUrl);
            setCurrentAnatomy(String(anatomyLabel).toUpperCase());
            downloadDataUrl(fallbackDataUrl, \`\${sampleId}_SIMULATED_ATLAS.png\`);
            setTimeout(() => {
                downloadJson(fallbackAnnotation, \`\${sampleId}_SIMULATED_ATLAS.json\`);
            }, 150);
        } finally {
            setBeamActive(false);
        }
    };
`;

const patched = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(appPath, patched, 'utf8');
console.log('Applied isolated synthetic X-ray exposure patch to App.jsx.');
