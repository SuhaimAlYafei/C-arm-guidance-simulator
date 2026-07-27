from pathlib import Path
import re
import shutil
from datetime import datetime

path = Path(r"3DVisualizer\ciartic-app\src\App.jsx")
backup = path.with_name(
    f"App.jsx.backup-dataset-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
)

shutil.copy2(path, backup)
text = path.read_text(encoding="utf-8")

new_geometry_block = r'''    const matrix4ToRows = (matrix) => {
        const e = matrix.elements;

        return [
            [e[0], e[4], e[8], e[12]],
            [e[1], e[5], e[9], e[13]],
            [e[2], e[6], e[10], e[14]],
            [e[3], e[7], e[11], e[15]]
        ];
    };

    const vectorToMillimeters = (vector) => [
        vector.x * 1000.0,
        vector.y * 1000.0,
        vector.z * 1000.0
    ];

    const captureExposureGeometry = (shotControls, anatomyKey = "unknown") => {
        if (!srcAnchorRef.current || !detAnchorRef.current) {
            console.error("Cannot capture geometry: source or detector anchor is unavailable.");
            return null;
        }

        srcAnchorRef.current.updateMatrixWorld(true);
        detAnchorRef.current.updateMatrixWorld(true);

        if (ctGroupRef.current) {
            ctGroupRef.current.updateMatrixWorld(true);
        }

        const srcPos = new THREE.Vector3();
        const detPos = new THREE.Vector3();
        const detQuat = new THREE.Quaternion();

        srcAnchorRef.current.getWorldPosition(srcPos);
        detAnchorRef.current.getWorldPosition(detPos);
        detAnchorRef.current.getWorldQuaternion(detQuat);

        // Detector and image intrinsics
        const sdd_mm = srcPos.distanceTo(detPos) * 1000.0;
        const img_width_px = 512;
        const img_height_px = 512;
        const x0_px = img_width_px / 2.0;
        const y0_px = img_height_px / 2.0;
        const delx_mm = 0.4;
        const dely_mm = 0.4;

        // Camera coordinate system
        const beam_dir_world = new THREE.Vector3()
            .subVectors(detPos, srcPos)
            .normalize();

        const X_det_world = new THREE.Vector3(1, 0, 0)
            .applyQuaternion(detQuat)
            .normalize();

        const projection = beam_dir_world
            .clone()
            .multiplyScalar(X_det_world.dot(beam_dir_world));

        const X_cam_world = X_det_world
            .clone()
            .sub(projection)
            .normalize();

        const Y_cam_world = new THREE.Vector3()
            .crossVectors(beam_dir_world, X_cam_world)
            .normalize();

        X_cam_world
            .crossVectors(Y_cam_world, beam_dir_world)
            .normalize();

        // Maintain the DiffDRR image convention: camera Y points downward
        const worldUp = new THREE.Vector3(0, 1, 0);
        let yDownEnforced = false;

        if (Y_cam_world.dot(worldUp) > 0) {
            X_cam_world.negate();
            Y_cam_world.negate();
            yDownEnforced = true;
        }

        const T_cam_to_world_m = new THREE.Matrix4()
            .makeBasis(X_cam_world, Y_cam_world, beam_dir_world);

        T_cam_to_world_m.setPosition(srcPos);

        const T_CT_to_world_m = ctGroupRef.current
            ? ctGroupRef.current.matrixWorld.clone()
            : new THREE.Matrix4().identity();

        const T_world_to_CT_m = T_CT_to_world_m.clone().invert();

        const T_cam_to_CT_m = new THREE.Matrix4().multiplyMatrices(
            T_world_to_CT_m,
            T_cam_to_world_m
        );

        // Validate the rotation basis
        const dotXY = Math.abs(X_cam_world.dot(Y_cam_world));
        const dotYZ = Math.abs(Y_cam_world.dot(beam_dir_world));
        const dotZX = Math.abs(beam_dir_world.dot(X_cam_world));

        const rotationWorld = new THREE.Matrix3().setFromMatrix4(
            T_cam_to_world_m
        );

        const rotationDeterminant = rotationWorld.determinant();

        const T_cam_to_world_mm = T_cam_to_world_m.clone();
        const T_CT_to_world_mm = T_CT_to_world_m.clone();
        const T_cam_to_CT_mm = T_cam_to_CT_m.clone();

        const camWorldPosition = new THREE.Vector3().setFromMatrixPosition(
            T_cam_to_world_mm
        );
        camWorldPosition.multiplyScalar(1000.0);
        T_cam_to_world_mm.setPosition(camWorldPosition);

        const ctWorldPosition = new THREE.Vector3().setFromMatrixPosition(
            T_CT_to_world_mm
        );
        ctWorldPosition.multiplyScalar(1000.0);
        T_CT_to_world_mm.setPosition(ctWorldPosition);

        const camCTPosition = new THREE.Vector3().setFromMatrixPosition(
            T_cam_to_CT_mm
        );
        camCTPosition.multiplyScalar(1000.0);
        T_cam_to_CT_mm.setPosition(camCTPosition);

        const controlsSnapshot = Object.fromEntries(
            Object.entries(shotControls).map(([key, value]) => [
                key,
                typeof value === "number" ? Number(value) : value
            ])
        );

        return {
            schema_version: "1.0",
            anatomy: anatomyKey,
            controls: controlsSnapshot,

            image_geometry: {
                width_px: img_width_px,
                height_px: img_height_px,
                pixel_spacing_mm: [delx_mm, dely_mm],
                principal_point_px: [x0_px, y0_px],
                source_to_detector_distance_mm: sdd_mm
            },

            source_position_world_mm: vectorToMillimeters(srcPos),
            detector_position_world_mm: vectorToMillimeters(detPos),

            beam_direction_world: [
                beam_dir_world.x,
                beam_dir_world.y,
                beam_dir_world.z
            ],

            camera_axes_world: {
                x: [X_cam_world.x, X_cam_world.y, X_cam_world.z],
                y: [Y_cam_world.x, Y_cam_world.y, Y_cam_world.z],
                z: [
                    beam_dir_world.x,
                    beam_dir_world.y,
                    beam_dir_world.z
                ]
            },

            transforms: {
                camera_to_world_mm: matrix4ToRows(T_cam_to_world_mm),
                ct_to_world_mm: matrix4ToRows(T_CT_to_world_mm),
                camera_to_ct_mm: matrix4ToRows(T_cam_to_CT_mm)
            },

            translation_camera_to_ct_mm: [
                camCTPosition.x,
                camCTPosition.y,
                camCTPosition.z
            ],

            validation: {
                rotation_determinant: rotationDeterminant,
                max_axis_dot_product: Math.max(dotXY, dotYZ, dotZX),
                orthogonal: Math.max(dotXY, dotYZ, dotZX) <= 1e-4,
                right_handed: Math.abs(rotationDeterminant - 1.0) <= 1e-4,
                camera_y_down_enforced: yDownEnforced
            },

            ct_volume_path:
                "public/CT/case-112016_BONE_H-N-UXT_3X3.nii"
        };
    };

    const downloadJson = (data, filename) => {
        const blob = new Blob(
            [JSON.stringify(data, null, 2)],
            { type: "application/json;charset=utf-8" }
        );

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = filename;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        URL.revokeObjectURL(url);
    };

    const downloadDataUrl = (dataUrl, filename) => {
        const link = document.createElement("a");

        link.href = dataUrl;
        link.download = filename;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

'''

geometry_pattern = re.compile(
    r"    const captureExposureGeometry = \(shotControls\) => \{.*?"
    r"(?=    const exportDiffDRRCSVRow =)",
    re.DOTALL
)

if not geometry_pattern.search(text):
    raise RuntimeError(
        "Could not find captureExposureGeometry(). "
        "No changes were written."
    )

text = geometry_pattern.sub(new_geometry_block, text, count=1)

new_take_xray = r'''    const handleTakeXray = () => {
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

            regionKeyAtShot = classification.hit
                ? classification.zoneKey
                : "miss";
        }

        const geometry = captureExposureGeometry(
            shotControls,
            regionKeyAtShot
        );

        if (!geometry) {
            alert("Exposure geometry could not be captured.");
            return;
        }

        setBeamActive(true);

        setTimeout(() => {
            try {
                const xrayDataUrl = generateRealisticXray(
                    shotControls,
                    regionKeyAtShot
                );

                setLastXray(xrayDataUrl);

                const sampleId = `sample_${new Date()
                    .toISOString()
                    .replace(/[:.]/g, "-")}`;

                const annotation = {
                    sample_id: sampleId,
                    image_filename: `${sampleId}.png`,
                    captured_at_utc: new Date().toISOString(),
                    ...geometry
                };

                downloadDataUrl(
                    xrayDataUrl,
                    `${sampleId}.png`
                );

                // A short delay improves reliability when the browser
                // starts two downloads from one exposure.
                setTimeout(() => {
                    downloadJson(
                        annotation,
                        `${sampleId}.json`
                    );
                }, 150);

                console.log("Dataset sample generated:", annotation);
            } catch (error) {
                console.error("Dataset sample generation failed:", error);
                alert(`Dataset sample generation failed: ${error.message}`);
            } finally {
                setBeamActive(false);
            }
        }, 450);
    };

'''

take_xray_pattern = re.compile(
    r"    const handleTakeXray = \(\) => \{.*?"
    r"(?=    // --- ARDUINO CONNECTION ---)",
    re.DOTALL
)

if not take_xray_pattern.search(text):
    raise RuntimeError(
        "Could not find handleTakeXray(). "
        "No changes were written."
    )

text = take_xray_pattern.sub(new_take_xray, text, count=1)

path.write_text(text, encoding="utf-8")

print("Patch completed successfully.")
print(f"Modified: {path}")
print(f"Backup:   {backup}")
