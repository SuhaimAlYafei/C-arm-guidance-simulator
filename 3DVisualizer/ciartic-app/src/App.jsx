import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ViewHelper } from 'three/examples/jsm/helpers/ViewHelper.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { projectPointToLineParamsInto } from './utils/imagingGeometry.js';
import ControllerPanel from './components/ControllerPanel';
import Instructions from './components/Instructions';
import { CONTROL_SPECS, DEVICE_PROFILE } from './constants';

const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;

const PLANNER_URL = 'https://c-arm-guidance-simulator.onrender.com/plan';
const PLANNER_WAYPOINT_DELAY_MS = 90;

// The planner landmarks and CT-to-world transform are registered against this
// dataset. The backend must render this exact volume and must never silently
// fall back to an unrelated CT.
const CT_DATASET_ID = 'case-112016_BONE_H-N-UXT_3X3';
const CT_VOLUME_RELATIVE_PATH = 'public/CT/case-112016_BONE_H-N-UXT_3X3.nii';

// Used only when the registered CT volume is unavailable. This keeps the demo
// anatomically consistent with the selected landmark, while clearly marking
// the image as a simulated atlas result rather than a real DiffDRR.
const LANDMARK_TO_ATLAS_KEY = {
    LM0: 'lowerSpine',
    LM1: 'rightHip',
    LM2: 'rightKnee',
    LM3: 'rightFoot',
    LM4: 'leftHip',
    LM5: 'leftKnee',
    LM6: 'leftFoot',
    LM7: 'midSpine',
    LM8: 'upperSpine',
    LM9: 'neck',
    LM10: 'head',
    LM11: 'leftShoulder',
    LM12: 'leftElbow',
    LM13: 'leftHand',
    LM14: 'rightShoulder',
    LM15: 'rightElbow',
    LM16: 'rightHand'
};

const LANDMARK_ATLAS_CROP = {
    head: 0.23,
    neck: 0.25,
    upperSpine: 0.30,
    midSpine: 0.32,
    lowerSpine: 0.32,
    leftShoulder: 0.28,
    rightShoulder: 0.28,
    leftElbow: 0.25,
    rightElbow: 0.25,
    leftHand: 0.22,
    rightHand: 0.22,
    leftHip: 0.30,
    rightHip: 0.30,
    leftKnee: 0.25,
    rightKnee: 0.25,
    leftFoot: 0.23,
    rightFoot: 0.23
};
const LANDMARK_REGISTRATION_STORAGE_KEY = 'carm_patient_landmark_registration_v1';

// Scene-geometry planner acceptance limits.
// A path is rejected unless the selected landmark lies on the simulated
// source-detector central ray within this tolerance.
const SCENE_GEOMETRY_TOLERANCE_MM = 1.0;
const SCENE_GEOMETRY_HARD_REJECT_MM = 2.0;
const SIMULATOR_MIN_COLUMN_RANGE_RAD = 45 * D2R;
const LANDMARK_EDGE_IDS = [
    [10, 9], [9, 8], [8, 7], [7, 0],
    [8, 11], [11, 12], [12, 13],
    [8, 14], [14, 15], [15, 16],
    [0, 1], [1, 2], [2, 3],
    [0, 4], [4, 5], [5, 6]
];

// --- CONFIGURATION ---
const PATIENT_URL = 'https://raw.githubusercontent.com/iyad-salameh/C_arm_guidance_APAH/main/assets/patient.glb?v=3';

const realsense_URL = 'https://raw.githubusercontent.com/iyad-salameh/C_arm_guidance_APAH/main/assets/realsense.glb?v=1';
const ISO_WORLD = new THREE.Vector3(0, 1.45, 0);



// --- ANATOMY ZONE HELPER (single source of truth) ---
const ZONE_DEFS = {
    miss: { key: 'miss', label: 'MISS (OFF PATIENT)' },

    // Core axial skeleton
    head: { key: 'head', label: 'HEAD / NECK' },
    thorax: { key: 'thorax', label: 'CHEST / THORAX' },
    abdomen: { key: 'abdomen', label: 'ABDOMEN' },
    pelvis: { key: 'pelvis', label: 'PELVIS / HIP' },

    // Upper limb (both sides)
    shoulder: { key: 'shoulder', label: 'SHOULDER / CLAVICLE' },
    left_shoulder: { key: 'left_shoulder', label: 'LEFT SHOULDER' },
    right_shoulder: { key: 'right_shoulder', label: 'RIGHT SHOULDER' },
    humerus: { key: 'humerus', label: 'HUMERUS / ELBOW' },
    forearm: { key: 'forearm', label: 'FOREARM / WRIST' },
    hand: { key: 'hand', label: 'HAND / FINGERS' },

    // Lower limb
    femur: { key: 'femur', label: 'FEMUR' },
    knee: { key: 'knee', label: 'KNEE' },
    tibia: { key: 'tibia', label: 'TIBIA / FIBULA' },
    ankle: { key: 'ankle', label: 'ANKLE' },
    foot: { key: 'foot', label: 'FOOT / TOES' },
};

// Axis Mapping Config
const ANATOMY_AXES = { up: 'y', leftRight: 'x', frontBack: 'z' };



// --- 1. AXIS INFERENCE & SKELETON DEFINITION ---
// ------------------------------------------------------------------

// Detect Long/Width/Thick axes from bounds dimensions
const getInferredPatientAxes = (bounds) => {
    const s = {
        x: bounds.maxX - bounds.minX,
        y: bounds.maxY - bounds.minY,
        z: bounds.maxZ - bounds.minZ
    };
    // Sort keys by size: Descending
    const axes = Object.keys(s).sort((a, b) => s[b] - s[a]);

    return {
        long: axes[0],   // Largest (Head-Feet)
        width: axes[1],  // Medium (Left-Right)
        thick: axes[2]   // Smallest (Front-Back)
    };
};

// 1.1 LANDMARK DEFINITION (Normalized 0..1 in Patient Box)
// Coord Order: (uLong, uWidth, uThick)
// uLong: 0=Feet, 1=Head
// uWidth: 0.5=Midline.
const LANDMARKS_NORM = {
    // Spine
    "lowerSpine": new THREE.Vector3(0.44, 0.50, 0.50),
    "midSpine": new THREE.Vector3(0.62, 0.50, 0.50),
    "upperSpine": new THREE.Vector3(0.76, 0.50, 0.50),
    "neck": new THREE.Vector3(0.86, 0.50, 0.50),
    "head": new THREE.Vector3(0.95, 0.50, 0.50),

    // Legs (Right)
    "rightHip": new THREE.Vector3(0.42, 0.55, 0.50),
    "rightKnee": new THREE.Vector3(0.22, 0.55, 0.50),
    "rightFoot": new THREE.Vector3(0.05, 0.55, 0.50),

    // Legs (Left)
    "leftHip": new THREE.Vector3(0.42, 0.45, 0.50),
    "leftKnee": new THREE.Vector3(0.22, 0.45, 0.50),
    "leftFoot": new THREE.Vector3(0.05, 0.45, 0.50),

    // Arms (Right)
    "rightShoulder": new THREE.Vector3(0.76, 0.65, 0.50),
    "rightElbow": new THREE.Vector3(0.60, 0.70, 0.50),
    "rightHand": new THREE.Vector3(0.46, 0.72, 0.50),

    // Arms (Left)
    "leftShoulder": new THREE.Vector3(0.76, 0.35, 0.50),
    "leftElbow": new THREE.Vector3(0.60, 0.30, 0.50),
    "leftHand": new THREE.Vector3(0.46, 0.28, 0.50)
};

// 1.2 EDGES (Bone Segments)
const EDGES = [
    ["head", "neck"],
    ["neck", "upperSpine"],
    ["upperSpine", "midSpine"],
    ["midSpine", "lowerSpine"],
    ["lowerSpine", "leftHip"],
    ["leftHip", "leftKnee"],
    ["leftKnee", "leftFoot"],
    ["lowerSpine", "rightHip"],
    ["rightHip", "rightKnee"],
    ["rightKnee", "rightFoot"],
    ["upperSpine", "leftShoulder"],
    ["leftShoulder", "leftElbow"],
    ["leftElbow", "leftHand"],
    ["upperSpine", "rightShoulder"],
    ["rightShoulder", "rightElbow"],
    ["rightElbow", "rightHand"]
];

// 1.3 CORRECTION OFFSETS (Meters)
// Applied laterally (along Width axis) OUTWARD from midline
const OFFSETS_LOCAL_M = {
    "rightHand": 0.20, "leftHand": 0.20,
    "rightKnee": 0.12, "leftKnee": 0.12,
    "rightFoot": 0.12, "leftFoot": 0.12,
    "leftElbow": 0.05, "rightElbow": 0.05 // Minor adjustment for elbows
};

// 2. HELPERS
// ------------------------------------------------------------------

// Helper: Compute Local Position for a Landmark (with Corrections)
const landmarkLocal = (name, bounds, axes) => {
    const norm = LANDMARKS_NORM[name];
    if (!norm) return new THREE.Vector3();

    // 1. Basic Norm -> Local
    const local = new THREE.Vector3();
    const setVal = (axis, uVal) => {
        const min = bounds['min' + axis.toUpperCase()];
        const max = bounds['max' + axis.toUpperCase()];
        local[axis] = min + uVal * (max - min);
    };
    setVal(axes.long, norm.x);
    setVal(axes.width, norm.y);
    setVal(axes.thick, norm.z);

    // 2. Apply Lateral Correction
    const offset = OFFSETS_LOCAL_M[name];
    if (offset) {
        const midMin = bounds['min' + axes.width.toUpperCase()];
        const midMax = bounds['max' + axes.width.toUpperCase()];
        const midVal = (midMin + midMax) / 2;

        // Determine outward direction from the midline
        const currentW = local[axes.width];
        const dir = (currentW >= midVal) ? 1.0 : -1.0;

        local[axes.width] += offset * dir;
    }

    return local;
};

// Helper: Map Edge to ZoneKey
const getZoneKeyForEdge = (startNode, endNode, t) => {
    const key = `${startNode}-${endNode}`;

    // Spine / Torso
    if (key.includes("head") || key.includes("neck")) return ZONE_DEFS.head;
    if (key.includes("upperSpine")) return ZONE_DEFS.thorax;
    if (key.includes("midSpine")) return ZONE_DEFS.abdomen;
    if (key.includes("lowerSpine") && (key.includes("Hip") || key.includes("mid"))) return ZONE_DEFS.pelvis;

    // Legs
    if (key.includes("Hip") && key.includes("Knee")) return ZONE_DEFS.femur;
    if (key.includes("Knee") && key.includes("Foot")) {
        // T-based split
        if (t < 0.2) return ZONE_DEFS.knee;
        if (t > 0.85) return ZONE_DEFS.foot;
        return ZONE_DEFS.tibia;
    }

    // Arms
    if (key.includes("Shoulder") && key.includes("Elbow")) return ZONE_DEFS.humerus;
    if (key.includes("Elbow") && key.includes("Hand")) {
        if (t > 0.7) return ZONE_DEFS.hand;
        return ZONE_DEFS.forearm;
    }
    if (key.includes("upperSpine") && key.includes("Shoulder")) {
        if (key.includes("left")) return ZONE_DEFS.left_shoulder;
        if (key.includes("right")) return ZONE_DEFS.right_shoulder;
        return ZONE_DEFS.shoulder;
    }

    return ZONE_DEFS.miss;
};

// Math: Point to Segment Distance
const distancePointToSegment = (P, A, B) => {
    const pax = P.x - A.x, pay = P.y - A.y, paz = P.z - A.z;
    const bax = B.x - A.x, bay = B.y - A.y, baz = B.z - A.z;
    const lenSq = bax * bax + bay * bay + baz * baz;
    const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (lenSq + 1e-8)));
    const dx = pax - bax * h;
    const dy = pay - bay * h;
    const dz = paz - baz * h;
    return { d2: dx * dx + dy * dy + dz * dz, t: h, h };
};

// 3. CLASSIFIER
const classifyLocalPointBySkeleton = (pLocal, localLandmarks) => {
    let bestD2 = Infinity;
    let bestZone = ZONE_DEFS.miss;
    let bestEdgeName = "";

    // Iterate Edges
    for (const [startName, endName] of EDGES) {
        const A = localLandmarks[startName];
        const B = localLandmarks[endName];

        if (!A || !B) continue;

        const { d2, t } = distancePointToSegment(pLocal, A, B);

        if (d2 < bestD2) {
            bestD2 = d2;
            const zone = getZoneKeyForEdge(startName, endName, t);
            bestZone = zone;
            bestEdgeName = `${startName}->${endName}`;
        }
    }

    return { zone: bestZone, d2: bestD2, edge: bestEdgeName };
};

const _localV1 = new THREE.Vector3();
const _localV2 = new THREE.Vector3();
const _localDir = new THREE.Vector3();
const _localBox = new THREE.Box3();
const _entryLocal = new THREE.Vector3();
const _exitLocal = new THREE.Vector3();
const _rayLocal = new THREE.Ray();
const _tempVec = new THREE.Vector3();
const _sampleLocal = new THREE.Vector3();

const computeBeamClassification = (srcPosWorld, detPosWorld, patientModel, bounds) => {
    let zoneResult = ZONE_DEFS.miss;
    let isHitting = false;
    let normInfo = null;

    if (!patientModel || !bounds || !bounds.ready) {
        return { hit: isHitting, zone: zoneResult, zoneKey: zoneResult.key, zoneLabel: zoneResult.label, normInfo };
    }

    patientModel.updateMatrixWorld(true);

    _localV1.copy(srcPosWorld);
    patientModel.worldToLocal(_localV1);

    _localV2.copy(detPosWorld);
    patientModel.worldToLocal(_localV2);

    _localDir.subVectors(_localV2, _localV1);
    const localSid = _localDir.length();
    _localDir.normalize();
    _rayLocal.set(_localV1, _localDir);

    _localBox.min.set(bounds.minX, bounds.minY, bounds.minZ);
    _localBox.max.set(bounds.maxX, bounds.maxY, bounds.maxZ);

    const hitEntry = _rayLocal.intersectBox(_localBox, _entryLocal);

    if (hitEntry) {
        const distEntry = _entryLocal.distanceTo(_localV1);
        if (distEntry <= localSid) {
            isHitting = true;

            _tempVec.copy(_localDir).multiplyScalar(-1);
            _rayLocal.set(_localV2, _tempVec);
            const hitExit = _rayLocal.intersectBox(_localBox, _exitLocal);
            if (!hitExit) _exitLocal.copy(_entryLocal);

            const distExitFromDet = _exitLocal.distanceTo(_localV2);
            const tEntry = distEntry / localSid;
            const tExit = 1.0 - (distExitFromDet / localSid);
            const tStart = Math.max(0, tEntry);
            const tEnd = Math.min(1, tExit);

            if (tEnd > tStart) {
                const SAMPLES = 9;
                const counts = Object.create(null);
                let bestSampleEdge = "";
                let bestSampleD2 = Infinity;

                const axes = getInferredPatientAxes(bounds);
                const localLandmarks = {};
                Object.keys(LANDMARKS_NORM).forEach(key => {
                    localLandmarks[key] = landmarkLocal(key, bounds, axes);
                });

                for (let i = 0; i < SAMPLES; i++) {
                    const t = (SAMPLES > 1) ? (tStart + (tEnd - tStart) * (i / (SAMPLES - 1))) : (tStart + tEnd) * 0.5;
                    _sampleLocal.copy(_localDir).multiplyScalar(t * localSid).add(_localV1);

                    const res = classifyLocalPointBySkeleton(_sampleLocal, localLandmarks);

                    const weight = 1.0 / (res.d2 + 1e-4);
                    counts[res.zone.key] = (counts[res.zone.key] || 0) + weight;

                    if (res.d2 < bestSampleD2) {
                        bestSampleD2 = res.d2;
                        bestSampleEdge = res.edge;
                    }
                }

                let bestKey = 'miss';
                let bestWeight = -1;
                for (const key in counts) {
                    if (counts[key] > bestWeight) {
                        bestWeight = counts[key];
                        bestKey = key;
                    }
                }
                zoneResult = ZONE_DEFS[bestKey] || ZONE_DEFS.miss;
                normInfo = `${bestSampleEdge} d:${Math.sqrt(bestSampleD2).toFixed(3)}`;
            }
        }
    }

    return { hit: isHitting, zone: zoneResult, zoneKey: zoneResult.key, zoneLabel: zoneResult.label, normInfo };
};


// --- MAIN APP ---
// --- CT VISUAL DEBUGGING CONSTANTS ---
// Adjust these physical bounds to match your expected bounding box
const CT_SIZE_X_M = 0.4;
const CT_SIZE_Y_M = 0.4;
const CT_SIZE_Z_M = 0.4;

// Add tiny local-coordinate spheres representing specific anatomy points inside the CT frame
const CT_LANDMARKS = {
    head_center: new THREE.Vector3(0, 0.15, 0),
    chest_center: new THREE.Vector3(0, 0, 0),
    pelvis_center: new THREE.Vector3(0, -0.15, 0),
    left_knee: new THREE.Vector3(-0.08, -0.3, 0),
    right_knee: new THREE.Vector3(0.08, -0.3, 0)
};

// Anatomy-driven landmark catalogue in CT millimetres.
// The screenshots provide the AP central-ray X/Y intersection in the CT frame.
// The camera-source depth (-418 mm) is not the anatomy target depth, so target Z is 0 mm.
const ANATOMICAL_TARGETS = {
    MANUAL: {
        id: null,
        label: 'Manual coordinates',
        shortLabel: 'Manual',
        procedure: 'ALL',
        bodyRegion: 'MANUAL',
        regionLabel: 'Manual target',
        side: 'MIDLINE',
        x_mm: 0,
        y_mm: 0,
        z_mm: 0,
        defaultLift: null,
        defaultProjection: 'AP',
        obliqueDeg: 25,
        tiltDeg: 15,
        views: ['AP', 'LEFT_LATERAL', 'RIGHT_LATERAL', 'RAO', 'LAO', 'CRANIAL', 'CAUDAL', 'CUSTOM_OBLIQUE'],
        aliases: ['manual', 'manual target', 'coordinates']
    },
    LM0: {
        id: 0,
        label: 'Lower Spine (Lumbosacral Region)',
        shortLabel: 'Lower Spine',
        procedure: 'SPINE',
        bodyRegion: 'SPINE',
        regionLabel: 'Lumbosacral spine',
        side: 'MIDLINE',
        x_mm: 0,
        y_mm: -105,
        z_mm: 0,
        defaultLift: -0.170,
        defaultProjection: 'AP',
        obliqueDeg: 30,
        tiltDeg: 20,
        views: ['AP', 'LEFT_LATERAL', 'RIGHT_LATERAL', 'RAO', 'LAO', 'CRANIAL', 'CAUDAL'],
        aliases: ['lower spine', 'lumbosacral', 'lumbar spine', 'sacrum']
    },
    LM1: {
        id: 1,
        label: 'Right Hip',
        shortLabel: 'Right Hip',
        procedure: 'ORTHOPEDIC',
        bodyRegion: 'PELVIS',
        regionLabel: 'Pelvis / hip',
        side: 'RIGHT',
        x_mm: -53,
        y_mm: -139,
        z_mm: 0,
        defaultLift: -0.170,
        defaultProjection: 'AP',
        obliqueDeg: 30,
        tiltDeg: 15,
        views: ['AP', 'LEFT_LATERAL', 'RIGHT_LATERAL', 'RAO', 'LAO', 'CRANIAL', 'CAUDAL'],
        aliases: ['right hip', 'right pelvis']
    },
    LM2: {
        id: 2,
        label: 'Right Knee',
        shortLabel: 'Right Knee',
        procedure: 'ORTHOPEDIC',
        bodyRegion: 'LOWER_EXTREMITY',
        regionLabel: 'Lower extremity',
        side: 'RIGHT',
        x_mm: -131,
        y_mm: -490,
        z_mm: 0,
        defaultLift: -0.180,
        defaultProjection: 'AP',
        obliqueDeg: 20,
        tiltDeg: 10,
        views: ['AP', 'LEFT_LATERAL', 'RIGHT_LATERAL', 'RAO', 'LAO'],
        aliases: ['right knee']
    },
    LM3: {
        id: 3,
        label: 'Right Foot',
        shortLabel: 'Right Foot',
        procedure: 'ORTHOPEDIC',
        bodyRegion: 'LOWER_EXTREMITY',
        regionLabel: 'Lower extremity',
        side: 'RIGHT',
        x_mm: -131,
        y_mm: -700,
        z_mm: 0,
        defaultLift: -0.180,
        defaultProjection: 'AP',
        obliqueDeg: 15,
        tiltDeg: 10,
        views: ['AP', 'LEFT_LATERAL', 'RIGHT_LATERAL', 'RAO', 'LAO'],
        aliases: ['right foot', 'right ankle']
    },
    LM4: {
        id: 4,
        label: 'Left Hip',
        shortLabel: 'Left Hip',
        procedure: 'ORTHOPEDIC',
        bodyRegion: 'PELVIS',
        regionLabel: 'Pelvis / hip',
        side: 'LEFT',
        x_mm: 43,
        y_mm: -177,
        z_mm: 0,
        defaultLift: -0.170,
        defaultProjection: 'AP',
        obliqueDeg: 30,
        tiltDeg: 15,
        views: ['AP', 'LEFT_LATERAL', 'RIGHT_LATERAL', 'RAO', 'LAO', 'CRANIAL', 'CAUDAL'],
        aliases: ['left hip', 'left pelvis']
    },
    LM5: {
        id: 5,
        label: 'Left Knee',
        shortLabel: 'Left Knee',
        procedure: 'ORTHOPEDIC',
        bodyRegion: 'LOWER_EXTREMITY',
        regionLabel: 'Lower extremity',
        side: 'LEFT',
        x_mm: 147,
        y_mm: -477,
        z_mm: 0,
        defaultLift: -0.180,
        defaultProjection: 'AP',
        obliqueDeg: 20,
        tiltDeg: 10,
        views: ['AP', 'LEFT_LATERAL', 'RIGHT_LATERAL', 'RAO', 'LAO'],
        aliases: ['left knee']
    },
    LM6: {
        id: 6,
        label: 'Left Foot',
        shortLabel: 'Left Foot',
        procedure: 'ORTHOPEDIC',
        bodyRegion: 'LOWER_EXTREMITY',
        regionLabel: 'Lower extremity',
        side: 'LEFT',
        x_mm: 122,
        y_mm: -700,
        z_mm: 0,
        defaultLift: -0.180,
        defaultProjection: 'AP',
        obliqueDeg: 15,
        tiltDeg: 10,
        views: ['AP', 'LEFT_LATERAL', 'RIGHT_LATERAL', 'RAO', 'LAO'],
        aliases: ['left foot', 'left ankle']
    },
    LM7: {
        id: 7,
        label: 'Mid Spine (Thoracic Spine)',
        shortLabel: 'Mid Spine',
        procedure: 'SPINE',
        bodyRegion: 'SPINE',
        regionLabel: 'Thoracic spine',
        side: 'MIDLINE',
        x_mm: 3,
        y_mm: 182,
        z_mm: 0,
        defaultLift: -0.220,
        defaultProjection: 'AP',
        obliqueDeg: 25,
        tiltDeg: 15,
        views: ['AP', 'LEFT_LATERAL', 'RIGHT_LATERAL', 'RAO', 'LAO', 'CRANIAL', 'CAUDAL'],
        aliases: ['mid spine', 'thoracic spine', 'mid thoracic']
    },
    LM8: {
        id: 8,
        label: 'Upper Spine (Upper Thoracic Spine)',
        shortLabel: 'Upper Spine',
        procedure: 'SPINE',
        bodyRegion: 'SPINE',
        regionLabel: 'Upper thoracic spine',
        side: 'MIDLINE',
        x_mm: 3,
        y_mm: 439,
        z_mm: 0,
        defaultLift: -0.270,
        defaultProjection: 'AP',
        obliqueDeg: 25,
        tiltDeg: 20,
        views: ['AP', 'LEFT_LATERAL', 'RIGHT_LATERAL', 'RAO', 'LAO', 'CRANIAL', 'CAUDAL'],
        aliases: ['upper spine', 'upper thoracic', 'upper thoracic spine']
    },
    LM9: {
        id: 9,
        label: 'Neck (Cervical Spine)',
        shortLabel: 'Neck',
        procedure: 'SPINE',
        bodyRegion: 'HEAD_NECK',
        regionLabel: 'Cervical spine',
        side: 'MIDLINE',
        x_mm: 3,
        y_mm: 584,
        z_mm: 0,
        defaultLift: -0.300,
        defaultProjection: 'AP',
        obliqueDeg: 20,
        tiltDeg: 20,
        views: ['AP', 'LEFT_LATERAL', 'RIGHT_LATERAL', 'RAO', 'LAO', 'CRANIAL', 'CAUDAL'],
        aliases: ['neck', 'cervical spine', 'cervical']
    },
    LM10: {
        id: 10,
        label: 'Head',
        shortLabel: 'Head',
        procedure: 'HEAD_NECK',
        bodyRegion: 'HEAD_NECK',
        regionLabel: 'Head',
        side: 'MIDLINE',
        x_mm: 3,
        y_mm: 766,
        z_mm: 0,
        defaultLift: -0.300,
        defaultProjection: 'AP',
        obliqueDeg: 20,
        tiltDeg: 20,
        views: ['AP', 'LEFT_LATERAL', 'RIGHT_LATERAL', 'RAO', 'LAO', 'CRANIAL', 'CAUDAL'],
        aliases: ['head', 'skull', 'cranium']
    },
    LM11: {
        id: 11,
        label: 'Left Shoulder',
        shortLabel: 'Left Shoulder',
        procedure: 'ORTHOPEDIC',
        bodyRegion: 'UPPER_EXTREMITY',
        regionLabel: 'Shoulder',
        side: 'LEFT',
        x_mm: -183,
        y_mm: 462,
        z_mm: 0,
        defaultLift: -0.250,
        defaultProjection: 'AP',
        obliqueDeg: 20,
        tiltDeg: 15,
        views: ['AP', 'LEFT_LATERAL', 'RIGHT_LATERAL', 'RAO', 'LAO', 'CRANIAL', 'CAUDAL'],
        aliases: ['left shoulder', 'left clavicle']
    },
    LM12: {
        id: 12,
        label: 'Left Elbow',
        shortLabel: 'Left Elbow',
        procedure: 'ORTHOPEDIC',
        bodyRegion: 'UPPER_EXTREMITY',
        regionLabel: 'Upper extremity',
        side: 'LEFT',
        x_mm: -265,
        y_mm: 222,
        z_mm: 0,
        defaultLift: -0.230,
        defaultProjection: 'AP',
        obliqueDeg: 15,
        tiltDeg: 10,
        views: ['AP', 'LEFT_LATERAL', 'RIGHT_LATERAL', 'RAO', 'LAO'],
        aliases: ['left elbow']
    },
    LM13: {
        id: 13,
        label: 'Left Hand',
        shortLabel: 'Left Hand',
        procedure: 'ORTHOPEDIC',
        bodyRegion: 'UPPER_EXTREMITY',
        regionLabel: 'Upper extremity',
        side: 'LEFT',
        x_mm: -300,
        y_mm: -35,
        z_mm: 0,
        defaultLift: -0.210,
        defaultProjection: 'AP',
        obliqueDeg: 10,
        tiltDeg: 10,
        views: ['AP', 'LEFT_LATERAL', 'RIGHT_LATERAL', 'RAO', 'LAO'],
        aliases: ['left hand', 'left wrist']
    },
    LM14: {
        id: 14,
        label: 'Right Shoulder',
        shortLabel: 'Right Shoulder',
        procedure: 'ORTHOPEDIC',
        bodyRegion: 'UPPER_EXTREMITY',
        regionLabel: 'Shoulder',
        side: 'RIGHT',
        x_mm: 160,
        y_mm: 475,
        z_mm: 0,
        defaultLift: -0.250,
        defaultProjection: 'AP',
        obliqueDeg: 20,
        tiltDeg: 15,
        views: ['AP', 'LEFT_LATERAL', 'RIGHT_LATERAL', 'RAO', 'LAO', 'CRANIAL', 'CAUDAL'],
        aliases: ['right shoulder', 'right clavicle']
    },
    LM15: {
        id: 15,
        label: 'Right Elbow',
        shortLabel: 'Right Elbow',
        procedure: 'ORTHOPEDIC',
        bodyRegion: 'UPPER_EXTREMITY',
        regionLabel: 'Upper extremity',
        side: 'RIGHT',
        x_mm: 263,
        y_mm: 237,
        z_mm: 0,
        defaultLift: -0.230,
        defaultProjection: 'AP',
        obliqueDeg: 15,
        tiltDeg: 10,
        views: ['AP', 'LEFT_LATERAL', 'RIGHT_LATERAL', 'RAO', 'LAO'],
        aliases: ['right elbow']
    },
    LM16: {
        id: 16,
        label: 'Right Hand',
        shortLabel: 'Right Hand',
        procedure: 'ORTHOPEDIC',
        bodyRegion: 'UPPER_EXTREMITY',
        regionLabel: 'Upper extremity',
        side: 'RIGHT',
        x_mm: 336,
        y_mm: -21,
        z_mm: 0,
        defaultLift: -0.210,
        defaultProjection: 'AP',
        obliqueDeg: 10,
        tiltDeg: 10,
        views: ['AP', 'LEFT_LATERAL', 'RIGHT_LATERAL', 'RAO', 'LAO'],
        aliases: ['right hand', 'right wrist']
    }
};

const PROCEDURE_OPTIONS = {
    ALL: { label: 'All procedures' },
    SPINE: { label: 'Spine' },
    ORTHOPEDIC: { label: 'Orthopedic' },
    HEAD_NECK: { label: 'Head / Neck' }
};

const BODY_REGION_OPTIONS = {
    ALL: { label: 'All body regions' },
    SPINE: { label: 'Spine' },
    HEAD_NECK: { label: 'Head / Neck' },
    PELVIS: { label: 'Pelvis / Hip' },
    LOWER_EXTREMITY: { label: 'Lower Extremity' },
    UPPER_EXTREMITY: { label: 'Upper Extremity' },
    MANUAL: { label: 'Manual' }
};

const PROJECTION_OPTIONS = {
    AP: { label: 'AP', backendView: 'AP', beam: 'anterior → posterior' },
    LEFT_LATERAL: { label: 'Left lateral', backendView: 'OBLIQUE', beam: 'patient right → patient left' },
    RIGHT_LATERAL: { label: 'Right lateral', backendView: 'OBLIQUE', beam: 'patient left → patient right' },
    RAO: { label: 'RAO', backendView: 'OBLIQUE', beam: 'right anterior oblique' },
    LAO: { label: 'LAO', backendView: 'OBLIQUE', beam: 'left anterior oblique' },
    CRANIAL: { label: 'Cranial', backendView: 'AP', beam: 'cranially angulated AP' },
    CAUDAL: { label: 'Caudal', backendView: 'AP', beam: 'caudally angulated AP' },
    CUSTOM_OBLIQUE: { label: 'Custom oblique', backendView: 'OBLIQUE', beam: 'custom oblique' }
};

const getProjectionConfig = (projectionKey, anatomy, customAngleDeg = 25) => {
    const base = PROJECTION_OPTIONS[projectionKey] || PROJECTION_OPTIONS.AP;
    const obliqueDeg = Number(anatomy?.obliqueDeg ?? 25);
    const tiltDeg = Number(anatomy?.tiltDeg ?? 15);

    const angleByProjection = {
        AP: 0,
        LEFT_LATERAL: 90,
        RIGHT_LATERAL: -90,
        RAO: obliqueDeg,
        LAO: -obliqueDeg,
        CRANIAL: 0,
        CAUDAL: 0,
        CUSTOM_OBLIQUE: Number(customAngleDeg)
    };

    const wigWagByProjection = {
        CRANIAL: tiltDeg,
        CAUDAL: -tiltDeg
    };

    return {
        ...base,
        key: projectionKey,
        angleDeg: angleByProjection[projectionKey] ?? 0,
        wigWagDeg: wigWagByProjection[projectionKey] ?? 0
    };
};

const getLandmarkEntries = (procedure = 'ALL', bodyRegion = 'ALL') =>
    Object.entries(ANATOMICAL_TARGETS).filter(([key, item]) => {
        if (key === 'MANUAL') return procedure === 'ALL' && bodyRegion === 'ALL';
        const procedureMatches = procedure === 'ALL' || item.procedure === procedure || (procedure === 'HEAD_NECK' && item.bodyRegion === 'HEAD_NECK');
        const regionMatches = bodyRegion === 'ALL' || item.bodyRegion === bodyRegion;
        return procedureMatches && regionMatches;
    });

const getAvailableBodyRegions = (procedure = 'ALL') => {
    const regions = new Set(
        Object.values(ANATOMICAL_TARGETS)
            .filter(item => item.id !== null)
            .filter(item => procedure === 'ALL' || item.procedure === procedure || (procedure === 'HEAD_NECK' && item.bodyRegion === 'HEAD_NECK'))
            .map(item => item.bodyRegion)
    );
    return ['ALL', ...Array.from(regions)];
};


const App = () => {
    const mountRef = useRef(null);

    // Control States
    const [controls, setControlsRaw] = useState({
        lift: -0.178,
        column_rot: 0,
        wig_wag: 0,
        orbital_slide: 0,
        cart_x: 1.700, // Longitudinal
        cart_z: 0.600, // Lateral (New)
    });

    const setControls = (updater) => {
        setControlsRaw(prev => {
            const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };

            // Enforce limits from CONTROL_SPECS
            for (const key in CONTROL_SPECS) {
                if (next[key] !== undefined) {
                    const spec = CONTROL_SPECS[key];
                    if (spec.min !== undefined && spec.max !== undefined) {
                        let minimum = Number(spec.min);
                        let maximum = Number(spec.max);

                        if (key === 'column_rot') {
                            minimum = Math.min(minimum, -SIMULATOR_MIN_COLUMN_RANGE_RAD);
                            maximum = Math.max(maximum, SIMULATOR_MIN_COLUMN_RANGE_RAD);
                        }

                        next[key] = Math.max(minimum, Math.min(maximum, next[key]));
                    }
                }
            }
            return next;
        });
    };
    const [beamActive, setBeamActive] = useState(false);
    const [lastXray, setLastXray] = useState(null);
    const [currentAnatomy, setCurrentAnatomy] = useState("READY");
    const [debugEnabled, setDebugEnabled] = useState(false);
    const [debugReadout, setDebugReadout] = useState(null);
    const [showInstructions, setShowInstructions] = useState(true);

    // --- PATH PLANNER STATE ---
    const [plannerTarget, setPlannerTarget] = useState({
        x_mm: ANATOMICAL_TARGETS.LM9.x_mm,
        y_mm: ANATOMICAL_TARGETS.LM9.y_mm,
        z_mm: ANATOMICAL_TARGETS.LM9.z_mm
    });
    const [plannerView, setPlannerView] = useState('AP');
    const [plannerObliqueAngle, setPlannerObliqueAngle] = useState(20);
    const [selectedProcedure, setSelectedProcedure] = useState('SPINE');
    const [selectedBodyRegion, setSelectedBodyRegion] = useState('HEAD_NECK');
    const [selectedAnatomy, setSelectedAnatomy] = useState('LM9');
    const [selectedProjection, setSelectedProjection] = useState('AP');
    const [clinicalRequest, setClinicalRequest] = useState('Show the neck from the left side');
    const [plannerWaypointCount, setPlannerWaypointCount] = useState(21);
    const [plannerStatus, setPlannerStatus] = useState('IDLE');
    const [plannerResult, setPlannerResult] = useState(null);
    const [plannerError, setPlannerError] = useState('');
    const [isPlanning, setIsPlanning] = useState(false);
    const [isPathAnimating, setIsPathAnimating] = useState(false);
    const [plannerAnimationMode, setPlannerAnimationMode] = useState(null);

    // --- PATIENT LANDMARK REGISTRATION / CALIBRATION ---
    const [calibrationMode, setCalibrationMode] = useState(false);
    const [calibrationRevision, setCalibrationRevision] = useState(0);
    const [calibrationMessage, setCalibrationMessage] = useState('');
    const calibrationModeRef = useRef(false);
    const selectedAnatomyRef = useRef(selectedAnatomy);

    const plannerAbortRef = useRef(null);
    const pathAnimationCancelledRef = useRef(false);
    const plannedStartPoseRef = useRef(null);
    const activePreviewStartPoseRef = useRef(null);

    const debugEnabledRef = useRef(false);
    const lastDebugUpdateRef = useRef(0);
    const beamActiveRef = useRef(false);
    const controlsRef = useRef(controls);

    // --- CT VISUAL CALIBRATION TOGGLES ---
    const showCtAxesRef = useRef(true);
    const showCtBoxRef = useRef(true);
    const showCtLandmarksRef = useRef(true);
    const showBeamLineRef = useRef(true);
    const showBeamIntersectRef = useRef(true);

    ////////////Arduino control/////////////////

    // --- SERIAL (ARDUINO) ---
    const serialPortRef = useRef(null);
    const serialWriterRef = useRef(null);
    const lastSentRef = useRef({ w: null, c: null, t: 0 });
    const isArduinoConnectedRef = useRef(false);
    const [isArduinoConnectedUI, setIsArduinoConnectedUI] = useState(false);


    ////////////End of Arduino Control//////////////////

    const beamRegionRef = useRef("WAITING FOR PATIENT..."); // Kept for label string
    const beamZoneKeyRef = useRef('miss'); // NEW: Store key
    const beamHitRef = useRef(false);
    const beamNormYRef = useRef(null);
    const [beamRegionUI, setBeamRegionUI] = useState("WAITING FOR PATIENT...");
    const [beamZoneKeyUI, setBeamZoneKeyUI] = useState('miss'); // For header color

    const patientModelRef = useRef(null);
    const ctGroupRef = useRef(new THREE.Group()); // NEW: Represents the canonical CT volume frame
    const patientBoundsRef = useRef({ ready: false, minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 });

    const ctAxesHelperRef = useRef(null);
    const ctBoxMeshRef = useRef(null);
    const ctLandmarksGroupRef = useRef(new THREE.Group());
    const beamLineRef = useRef(null);
    const beamIntersectGroupRef = useRef(new THREE.Group());
    const targetMarkerGroupRef = useRef(new THREE.Group());


    ////Arduino code for sending functions////

    const radToDeg = (r) => (r * 180) / Math.PI;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    const sendServos = async (wigDeg, colDeg) => {
        const writer = serialWriterRef.current;
        const port = serialPortRef.current;

        if (!writer || !port || !isArduinoConnectedRef.current) return;

        const msg = `W:${Math.round(wigDeg)} C:${Math.round(colDeg)}\n`;
        const data = new TextEncoder().encode(msg);

        try {
            await writer.write(data);
        } catch (e) {
            console.warn("Serial write failed, forcing disconnect:", e);
            await disconnectArduino(); // ensure UI + refs reset
        }
    };
    ////end of arduino part for functions/////


    useEffect(() => { controlsRef.current = controls; }, [controls]);
    useEffect(() => { calibrationModeRef.current = calibrationMode; }, [calibrationMode]);
    useEffect(() => { selectedAnatomyRef.current = selectedAnatomy; }, [selectedAnatomy]);

    const refreshAnatomicalLandmarkOverlay = (selectedKey = selectedAnatomyRef.current) => {
        const anatomyGroup = anatomicalLandmarksGroupRef.current;
        if (!anatomyGroup) return;

        const landmarkItems = Object.entries(ANATOMICAL_TARGETS)
            .filter(([key, item]) => key !== 'MANUAL' && item.id !== null);

        const byId = new Map();
        landmarkItems.forEach(([key, item]) => {
            const position = new THREE.Vector3(
                Number(item.x_mm) / 1000,
                Number(item.y_mm) / 1000,
                Number(item.z_mm) / 1000 + 0.006
            );
            byId.set(item.id, position);

            const markerGroup = anatomyGroup.getObjectByName(`anatomical_landmark_${item.id}`);
            if (markerGroup) {
                markerGroup.position.copy(position);
                markerGroup.scale.setScalar(key === selectedKey && calibrationModeRef.current ? 1.45 : 1.0);
            }
        });

        const lines = anatomyGroup.getObjectByName('anatomical_landmark_connections');
        if (lines?.geometry) {
            const points = [];
            LANDMARK_EDGE_IDS.forEach(([fromId, toId]) => {
                const from = byId.get(fromId);
                const to = byId.get(toId);
                if (from && to) points.push(from.clone(), to.clone());
            });
            lines.geometry.dispose();
            lines.geometry = new THREE.BufferGeometry().setFromPoints(points);
        }
    };

    const updateRegisteredLandmark = (key, patch, message = 'Landmark updated') => {
        const target = ANATOMICAL_TARGETS[key];
        if (!target || key === 'MANUAL') return;

        ['x_mm', 'y_mm', 'z_mm'].forEach(axis => {
            if (patch[axis] !== undefined) {
                target[axis] = Number(patch[axis]);
            }
        });

        setPlannerTarget({
            x_mm: Number(target.x_mm),
            y_mm: Number(target.y_mm),
            z_mm: Number(target.z_mm)
        });
        setPlannerResult(null);
        setPlannerStatus('REGISTRATION CHANGED');
        setCalibrationRevision(value => value + 1);
        setCalibrationMessage(message);
        refreshAnatomicalLandmarkOverlay(key);
    };

    const nudgeRegisteredLandmark = (axis, deltaMm) => {
        const key = selectedAnatomyRef.current;
        const target = ANATOMICAL_TARGETS[key];
        if (!calibrationModeRef.current || !target || key === 'MANUAL') return;

        updateRegisteredLandmark(
            key,
            { [axis]: Number(target[axis]) + Number(deltaMm) },
            `${target.shortLabel}: ${axis.replace('_mm', '').toUpperCase()} ${deltaMm >= 0 ? '+' : ''}${deltaMm} mm`
        );
    };

    const buildRegistrationPayload = () => ({
        schema_version: '1.0',
        coordinate_frame: 'centred_ct_mm',
        saved_at: new Date().toISOString(),
        landmarks: Object.fromEntries(
            Object.entries(ANATOMICAL_TARGETS)
                .filter(([key, item]) => key !== 'MANUAL' && item.id !== null)
                .map(([key, item]) => [key, {
                    id: item.id,
                    label: item.label,
                    x_mm: Number(item.x_mm),
                    y_mm: Number(item.y_mm),
                    z_mm: Number(item.z_mm)
                }])
        )
    });

    const saveLandmarkRegistration = () => {
        const payload = buildRegistrationPayload();
        localStorage.setItem(LANDMARK_REGISTRATION_STORAGE_KEY, JSON.stringify(payload));
        downloadJson(payload, 'patient_registration.json');
        setCalibrationMessage('Registration saved locally and downloaded.');
        setPlannerStatus('REGISTRATION SAVED');
    };

    const applyRegistrationPayload = (payload, sourceLabel = 'registration') => {
        if (!payload?.landmarks || typeof payload.landmarks !== 'object') {
            throw new Error('Registration file does not contain a landmarks object.');
        }

        let applied = 0;
        Object.entries(payload.landmarks).forEach(([key, value]) => {
            const target = ANATOMICAL_TARGETS[key];
            if (!target || key === 'MANUAL') return;
            if (![value?.x_mm, value?.y_mm, value?.z_mm].every(Number.isFinite)) return;

            target.x_mm = Number(value.x_mm);
            target.y_mm = Number(value.y_mm);
            target.z_mm = Number(value.z_mm);
            applied += 1;
        });

        if (applied === 0) {
            throw new Error('No compatible landmarks were found in the registration file.');
        }

        const selected = ANATOMICAL_TARGETS[selectedAnatomyRef.current];
        if (selected && selectedAnatomyRef.current !== 'MANUAL') {
            setPlannerTarget({
                x_mm: Number(selected.x_mm),
                y_mm: Number(selected.y_mm),
                z_mm: Number(selected.z_mm)
            });
        }

        setCalibrationRevision(value => value + 1);
        refreshAnatomicalLandmarkOverlay();
        setPlannerResult(null);
        setPlannerStatus('REGISTRATION LOADED');
        setCalibrationMessage(`${applied} landmarks loaded from ${sourceLabel}.`);
    };

    const loadRegistrationFile = async (file) => {
        if (!file) return;
        try {
            const payload = JSON.parse(await file.text());
            applyRegistrationPayload(payload, file.name);
            localStorage.setItem(LANDMARK_REGISTRATION_STORAGE_KEY, JSON.stringify(payload));
        } catch (error) {
            setCalibrationMessage(`Load failed: ${error.message}`);
            setPlannerStatus('ERROR');
        }
    };

    const resetLandmarkRegistration = () => {
        localStorage.removeItem(LANDMARK_REGISTRATION_STORAGE_KEY);
        setCalibrationMessage('Saved registration removed. Reload the page to restore original defaults.');
        setPlannerStatus('REGISTRATION RESET');
    };

    useEffect(() => {
        try {
            const saved = localStorage.getItem(LANDMARK_REGISTRATION_STORAGE_KEY);
            if (saved) applyRegistrationPayload(JSON.parse(saved), 'browser storage');
        } catch (error) {
            console.warn('Could not restore landmark registration:', error);
        }
        // Run once after the scene and UI initialize.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Scene Graph Refs
    const cartRef = useRef(null);
    const columnRotRef = useRef(new THREE.Group());
    const liftRef = useRef(new THREE.Group());
    const wigWagRef = useRef(new THREE.Group());
    const cArmSlideRef = useRef(new THREE.Group());
    const beamRef = useRef(null);
    // const cArmModelRef = useRef(null); // Unused
    const srcAnchorRef = useRef(new THREE.Group());
    const detAnchorRef = useRef(new THREE.Group());
    const skeletonDebugRef = useRef(null); // Skeleton Debug Group
    const anatomicalLandmarksGroupRef = useRef(new THREE.Group()); // 17 configured CT landmarks

    // Depth Viewer Refs
    const realsenseModelRef = useRef(null);
    const depthCameraRef = useRef(null);
    const depthCameraHelperRef = useRef(null); // Helper for debugging
    const depthRenderTargetRef = useRef(null);
    const depthCanvasRef = useRef(null);
    const rendererRef = useRef(null);
    const depthVizSceneRef = useRef(null);
    const depthVizQuadRef = useRef(null);
    const depthVizTargetRef = useRef(null);

    // Camera Control State (Restored)
    const [controlTarget, setControlTarget] = useState('camera'); // 'camera' or 'realsense'

    // Camera State
    const [camOffset, setCamOffset] = useState({ x: 0.00, y: -0.06, z: 0.00 });
    const [camRot, setCamRot] = useState({ x: 90.0, y: 0.0, z: 180.0 });

    // RealSense State (Defaulted to current fixed values)
    const [rsOffset, setRsOffset] = useState({ x: 0.00, y: 0.67, z: 0.23 });
    const [rsRot, setRsRot] = useState({ x: 90, y: 0, z: 180 });

    // Refs for animation loop access
    const camOffsetRef = useRef(camOffset);
    const camRotRef = useRef(camRot);
    const rsOffsetRef = useRef(rsOffset);
    const rsRotRef = useRef(rsRot);

    useEffect(() => {
        camOffsetRef.current = camOffset;
        camRotRef.current = camRot;
        rsOffsetRef.current = rsOffset;
        rsRotRef.current = rsRot;
    }, [camOffset, camRot, rsOffset, rsRot]);

    // Debug Refs

    const showLandmarksRef = useRef(false);
    const hasRenderedInitialRef = useRef(false);
    const floorLabelsRef = useRef(null);

    // --- CONTINUOUS SKELETON ATLAS X-RAY ---
    const skeletonAtlasRef = useRef(null);

    // Preload the single skeleton atlas
    useEffect(() => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => {
            skeletonAtlasRef.current = img;
            console.log("Skeleton atlas loaded", img.width, img.height);
        };
        img.onerror = (e) => console.error("Failed to load skeleton atlas", e);
        img.src = '/xrays/skeleton.png';
    }, []);


    // --- DYNAMIC ANATOMY GENERATOR (ATLAS SKELETON) ---
    const generateRealisticXray = (currentControls = controls) => {
        const { cart_x, cart_z, orbital_slide, wig_wag } = currentControls;

        // If atlas isn't ready, fallback to noise
        if (!skeletonAtlasRef.current) {
            return generateNoiseXray("LOADING...");
        }

        const img = skeletonAtlasRef.current;
        const canvas = document.createElement('canvas');
        const size = 512; // Output resolution
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // --- 1. IMAGE COORDINATE MAPPING ---
        // Patient Head: cart_x ~ 0.8m -> Image Top (Y=0)
        // Patient Feet: cart_x ~ 2.5m -> Image Bottom

        // Geometry / FOV Calculation
        // Depth Camera (Perspective) is at Detector.
        // Det Y (Base) = 1.70m. Iso Y = 1.45m. Dist = 0.25m.
        // Lift moves Det Y. Dist = 0.25 + lift.
        // FOV = 58 deg.
        const lift = currentControls.lift || 0;
        const distToIso = Math.max(0.1, 0.25 + lift); // Clamp min 10cm
        // Visible height at Iso plane
        const fovMeters = 3.0 * (2 * distToIso * Math.tan(58 / 2 * (Math.PI / 180))); // Zoom out 3x (150% more than 2x)
        const pixelsPerMeter = img.height / 1.7; // Assuming atlas height represents 1.7m (Head to Toe)
        const fovPixels = fovMeters * pixelsPerMeter;

        // --- 2. TRANSFORMS (Simulate C-Arm Movement) ---
        // Mapping: cart_x (Longitudinal) -> Image Y (Spine Axis)
        // cart_z (Lateral) -> Image X (Width Axis)

        // Calibration:
        // cart_x = 0.8 (Head) -> Image Y = 0 (Top)
        // cart_x = 2.5 (Feet) -> Image Y corresponds to 1.7m
        // We center the view at the current cart_x
        const centerY = (cart_x - 0.8) * pixelsPerMeter;

        // Lateral: Z=0 is center. 
        // Image Width center = img.width / 2.
        const centerX = (img.width / 2) - (cart_z * pixelsPerMeter);

        // --- 3. RENDER ON CANVAS ---
        // Fill pure black
        ctx.fillStyle = "#050505";
        ctx.fillRect(0, 0, size, size);

        // Transform for Rotation (Orbital)
        ctx.translate(size / 2, size / 2);

        // Apply tilt rotation (wig_wag)
        const rotation = -wig_wag + Math.PI / 2;
        ctx.rotate(rotation);

        // Simulate Orbital Rotation (Pseudo-3D effect) by scaling atlas width
        const viewWidthScale = Math.max(0.2, Math.cos(orbital_slide));
        ctx.scale(viewWidthScale, 1.0); // Compress width


        // Draw Image Crop
        // We want source rect centered at (centerX, centerY) with dim (fovPixels, fovPixels)
        const sw = fovPixels / viewWidthScale; // Compensate scale to keep FOV constant
        const sh = fovPixels;
        const sx = centerX - sw / 2;
        const sy = centerY - sh / 2;

        try {
            ctx.drawImage(img, sx, sy, sw, sh, -size / 2, -size / 2, size, size);
        } catch {
            // Out of bounds safety
        }

        // --- 4. OVERLAYS (Label, Noise) ---
        // Reset transform for text
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        // Update UI state for Download Filename
        const anatomyLabel = "XRAY";
        if (anatomyLabel !== currentAnatomy) {
            setCurrentAnatomy(anatomyLabel);
        }

        // Metadata
        ctx.font = "12px monospace";
        ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        ctx.fillText(`kVp: 78  mA: 4.2`, 10, 20);

        // Orientation "R"
        ctx.font = "20px sans-serif";
        ctx.fillText("R", size - 30, size - 20);

        return canvas.toDataURL();
    };

    const generateLandmarkAtlasXray = (
        anatomyKey = selectedAnatomy,
        projectionKey = selectedProjection
    ) => {
        const image = skeletonAtlasRef.current;

        if (!image) {
            return generateNoiseXray('SKELETON ATLAS NOT LOADED');
        }

        const atlasKey = LANDMARK_TO_ATLAS_KEY[anatomyKey] || 'midSpine';
        const normalized = LANDMARKS_NORM[atlasKey] || LANDMARKS_NORM.midSpine;
        const anatomy = ANATOMICAL_TARGETS[anatomyKey] || ANATOMICAL_TARGETS.MANUAL;
        const projection = getProjectionConfig(
            projectionKey,
            anatomy,
            plannerObliqueAngle
        );

        const size = 512;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return generateNoiseXray('CANVAS ERROR');
        }

        ctx.fillStyle = '#020202';
        ctx.fillRect(0, 0, size, size);

        // LANDMARKS_NORM uses long-axis 0=feet and 1=head.
        const centerX = normalized.y * image.width;
        const centerY = (1 - normalized.x) * image.height;
        const cropRatio = LANDMARK_ATLAS_CROP[atlasKey] || 0.28;
        const cropSize = Math.max(80, image.height * cropRatio);

        let widthScale = 1;
        if (
            projectionKey === 'LEFT_LATERAL'
            || projectionKey === 'RIGHT_LATERAL'
        ) {
            widthScale = 0.55;
        } else if (
            projectionKey === 'RAO'
            || projectionKey === 'LAO'
            || projectionKey === 'CUSTOM_OBLIQUE'
        ) {
            widthScale = Math.max(
                0.62,
                Math.abs(Math.cos(Number(projection.angleDeg) * D2R))
            );
        }

        const sourceWidth = cropSize / widthScale;
        const sourceHeight = cropSize;

        const sourceX = Math.max(
            0,
            Math.min(image.width - sourceWidth, centerX - sourceWidth / 2)
        );
        const sourceY = Math.max(
            0,
            Math.min(image.height - sourceHeight, centerY - sourceHeight / 2)
        );

        ctx.save();
        ctx.translate(size / 2, size / 2);

        const displayRotation =
            projectionKey === 'CRANIAL'
                ? -8 * D2R
                : projectionKey === 'CAUDAL'
                    ? 8 * D2R
                    : 0;

        ctx.rotate(displayRotation);
        ctx.scale(widthScale, 1);

        ctx.filter = 'grayscale(1) contrast(1.7) brightness(0.85) blur(0.35px)';
        ctx.drawImage(
            image,
            sourceX,
            sourceY,
            sourceWidth,
            sourceHeight,
            -size / (2 * widthScale),
            -size / 2,
            size / widthScale,
            size
        );
        ctx.restore();

        // X-ray-style vignette.
        const vignette = ctx.createRadialGradient(
            size / 2,
            size / 2,
            size * 0.20,
            size / 2,
            size / 2,
            size * 0.72
        );
        vignette.addColorStop(0, 'rgba(255,255,255,0)');
        vignette.addColorStop(1, 'rgba(0,0,0,0.72)');
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, size, size);

        // Deterministic lightweight detector noise.
        const imageData = ctx.getImageData(0, 0, size, size);
        const pixels = imageData.data;
        for (let index = 0; index < pixels.length; index += 4) {
            const pixelIndex = index / 4;
            const noise = (
                Math.sin(pixelIndex * 12.9898 + anatomy.id * 78.233) * 43758.5453
            ) % 1;
            const delta = Math.round(noise * 5);
            pixels[index] = Math.max(0, Math.min(255, pixels[index] + delta));
            pixels[index + 1] = Math.max(0, Math.min(255, pixels[index + 1] + delta));
            pixels[index + 2] = Math.max(0, Math.min(255, pixels[index + 2] + delta));
        }
        ctx.putImageData(imageData, 0, 0);

        // Clearly mark this as a simulated fallback, not a real CT DRR.
        ctx.fillStyle = 'rgba(0,0,0,0.68)';
        ctx.fillRect(0, 0, size, 58);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 17px monospace';
        ctx.fillText(
            `${anatomy.id ?? '-'}: ${anatomy.shortLabel || anatomy.label}`,
            12,
            23
        );

        ctx.font = '12px monospace';
        ctx.fillStyle = '#fbbf24';
        ctx.fillText(
            `SIMULATED ATLAS FALLBACK | ${projection.label}`,
            12,
            44
        );

        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = '12px monospace';
        ctx.fillText('R', size - 28, size - 18);

        return canvas.toDataURL('image/png');
    };

    const generateNoiseXray = (msg) => {
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 256;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, 256, 256);
        ctx.fillStyle = "#333";
        ctx.font = "20px monospace";
        ctx.textAlign = "center";
        ctx.fillText(msg || "NO SIGNAL", 128, 128);
        return canvas.toDataURL();
    };

    const handleDownloadXray = () => {
        if (!lastXray) return;
        try {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = 1024;
                canvas.height = 1024;
                const ctx = canvas.getContext('2d');
                if (!ctx) return;

                // Fill black background (x-rays are usually black/white)
                ctx.fillStyle = '#000000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Draw image
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                canvas.toBlob((blob) => {
                    if (!blob) return;
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;

                    // Format: xray_YYYY-MM-DDTHH-mm-ss-sssZ.png
                    // Simplified ISO format replacement for clean filename
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    link.download = `xray_${timestamp}.png`;

                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                }, 'image/png');
            };
            img.src = lastXray;
        } catch (e) {
            console.error("Download failed", e);
        }
    };

    // Configurable rigid transform for CT to World alignment. Default: Identity
    // Modify this if your CT volume is not at the world origin or has a different orientation.
    // Three.js simulator world uses +Y UP. 
    // CT axis conventions are defined externally by the NIfTI affine. 
    // DiffDRR pipeline must map CT voxel coordinates to this CT frame using the NIfTI affine.

    const matrix4ToRows = (matrix) => {
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

    const captureExposureGeometry = (shotControls, anatomyKey = "unknown", beamRegionKey = "miss") => {
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

        // Use one fixed detector-image convention for every C-arm pose.
        //
        // Do not compare detector Y with world gravity. That comparison can
        // flip both detector axes by 180 degrees when the C-arm crosses
        // certain orbital angles, causing a discontinuous image orientation.
        X_cam_world.negate();
        Y_cam_world.negate();

        const yDownEnforced = true;

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

        const selectedTarget =
            ANATOMICAL_TARGETS[anatomyKey]
            || ANATOMICAL_TARGETS.MANUAL;

        return {
            schema_version: "1.1",
            anatomy: anatomyKey,
            beam_region: beamRegionKey,

            ct_dataset_id: CT_DATASET_ID,
            ct_volume_path: CT_VOLUME_RELATIVE_PATH,

            selected_landmark: {
                key: anatomyKey,
                id: selectedTarget.id,
                label: selectedTarget.label,
                x_mm: Number(selectedTarget.x_mm),
                y_mm: Number(selectedTarget.y_mm),
                z_mm: Number(selectedTarget.z_mm)
            },

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
            }
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

    const exportDiffDRRCSVRow = (headers, row) => {
        const fmt = (v) => (typeof v === "number" ? v.toFixed(6) : String(v));
        const csvContent = headers.join(',') + '\n' + row.map(fmt).join(',');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;

        const now = new Date();
        const pad = (n) => n.toString().padStart(2, '0');
        const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
        link.download = `diffdrr_pose_${timestamp}.csv`;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const selectedAnatomyInfo = (calibrationRevision, ANATOMICAL_TARGETS[selectedAnatomy] || ANATOMICAL_TARGETS.MANUAL);
    const selectedProjectionInfo = getProjectionConfig(selectedProjection, selectedAnatomyInfo, plannerObliqueAngle);
    const availableBodyRegions = getAvailableBodyRegions(selectedProcedure);
    const filteredLandmarkEntries = getLandmarkEntries(selectedProcedure, selectedBodyRegion);
    const availableProjectionKeys = selectedAnatomyInfo?.views || ANATOMICAL_TARGETS.MANUAL.views;

    const configureProjectionForAnatomy = (projectionKey, anatomy, customAngleDeg = plannerObliqueAngle) => {
        const projection = getProjectionConfig(projectionKey, anatomy, customAngleDeg);
        setPlannerView(projection.backendView);
        if (projectionKey !== 'CUSTOM_OBLIQUE') {
            setPlannerObliqueAngle(projection.angleDeg);
        }
        return projection;
    };

    const applyAnatomicalTarget = (key) => {
        const target = ANATOMICAL_TARGETS[key];
        if (!target) return;

        setSelectedAnatomy(key);
        selectedAnatomyRef.current = key;
        refreshAnatomicalLandmarkOverlay(key);
        if (key !== 'MANUAL') {
            setSelectedProcedure(target.procedure);
            setSelectedBodyRegion(target.bodyRegion);
            setPlannerTarget({ x_mm: target.x_mm, y_mm: target.y_mm, z_mm: target.z_mm });

            const nextProjection = target.views.includes(selectedProjection)
                ? selectedProjection
                : target.defaultProjection;
            setSelectedProjection(nextProjection);
            configureProjectionForAnatomy(nextProjection, target);
        }

        setPlannerResult(null);
        setPlannerError('');
        setPlannerStatus('TARGET SELECTED');
    };

    const applyProjection = (key) => {
        if (!PROJECTION_OPTIONS[key]) return;
        setSelectedProjection(key);
        configureProjectionForAnatomy(key, selectedAnatomyInfo);
        setPlannerResult(null);
        setPlannerError('');
        setPlannerStatus('VIEW SELECTED');
    };

    const selectFirstMatchingLandmark = (procedure, bodyRegion) => {
        const matches = getLandmarkEntries(procedure, bodyRegion).filter(([key]) => key !== 'MANUAL');
        if (matches.length > 0) applyAnatomicalTarget(matches[0][0]);
    };

    const handleProcedureChange = (procedure) => {
        setSelectedProcedure(procedure);
        const regions = getAvailableBodyRegions(procedure);
        const nextRegion = regions.includes(selectedBodyRegion) ? selectedBodyRegion : 'ALL';
        setSelectedBodyRegion(nextRegion);

        const current = ANATOMICAL_TARGETS[selectedAnatomy];
        const currentStillMatches = current && current.id !== null &&
            (procedure === 'ALL' || current.procedure === procedure || (procedure === 'HEAD_NECK' && current.bodyRegion === 'HEAD_NECK')) &&
            (nextRegion === 'ALL' || current.bodyRegion === nextRegion);
        if (!currentStillMatches) selectFirstMatchingLandmark(procedure, nextRegion);
    };

    const handleBodyRegionChange = (bodyRegion) => {
        setSelectedBodyRegion(bodyRegion);
        const current = ANATOMICAL_TARGETS[selectedAnatomy];
        const currentStillMatches = current && current.id !== null &&
            (selectedProcedure === 'ALL' || current.procedure === selectedProcedure || (selectedProcedure === 'HEAD_NECK' && current.bodyRegion === 'HEAD_NECK')) &&
            (bodyRegion === 'ALL' || current.bodyRegion === bodyRegion);
        if (!currentStillMatches) selectFirstMatchingLandmark(selectedProcedure, bodyRegion);
    };

    const interpretClinicalRequest = () => {
        const normalized = clinicalRequest.trim().toLowerCase();
        const aliasEntries = Object.entries(ANATOMICAL_TARGETS)
            .filter(([key]) => key !== 'MANUAL')
            .flatMap(([key, item]) => item.aliases.map(alias => ({ key, alias })))
            .sort((a, b) => b.alias.length - a.alias.length);

        const anatomyMatch = aliasEntries.find(({ alias }) => normalized.includes(alias));
        if (!anatomyMatch) {
            setPlannerError('Could not identify one of the 17 configured anatomical landmarks.');
            setPlannerStatus('ERROR');
            return;
        }

        const anatomy = ANATOMICAL_TARGETS[anatomyMatch.key];
        let projectionKey = anatomy.defaultProjection;

        if (/left\s+lateral|from\s+the\s+left|from\s+left|left[-\s]side/.test(normalized)) projectionKey = 'LEFT_LATERAL';
        else if (/right\s+lateral|from\s+the\s+right|from\s+right|right[-\s]side/.test(normalized)) projectionKey = 'RIGHT_LATERAL';
        else if (/\brao\b|right\s+anterior\s+oblique/.test(normalized)) projectionKey = 'RAO';
        else if (/\blao\b|left\s+anterior\s+oblique/.test(normalized)) projectionKey = 'LAO';
        else if (/cranial|cephalad/.test(normalized)) projectionKey = 'CRANIAL';
        else if (/caudal/.test(normalized)) projectionKey = 'CAUDAL';
        else if (/oblique/.test(normalized)) projectionKey = 'CUSTOM_OBLIQUE';
        else if (/\bap\b|anterior[-\s]posterior/.test(normalized)) projectionKey = 'AP';

        if (!anatomy.views.includes(projectionKey)) {
            projectionKey = anatomy.defaultProjection;
        }

        const degreeMatch = normalized.match(/(-?\d+(?:\.\d+)?)\s*(?:°|deg|degrees?)/);
        const customAngle = degreeMatch
            ? Math.max(-90, Math.min(90, Number(degreeMatch[1])))
            : anatomy.obliqueDeg;

        setSelectedProcedure(anatomy.procedure);
        setSelectedBodyRegion(anatomy.bodyRegion);
        setSelectedAnatomy(anatomyMatch.key);
        setPlannerTarget({ x_mm: anatomy.x_mm, y_mm: anatomy.y_mm, z_mm: anatomy.z_mm });
        setSelectedProjection(projectionKey);
        configureProjectionForAnatomy(projectionKey, anatomy, customAngle);
        if (projectionKey === 'CUSTOM_OBLIQUE') setPlannerObliqueAngle(customAngle);
        setPlannerResult(null);
        setPlannerError('');
        setPlannerStatus('REQUEST INTERPRETED');
    };

    const annotatePlannerResult = (result) => {
        const anatomy = ANATOMICAL_TARGETS[selectedAnatomy] || ANATOMICAL_TARGETS.MANUAL;
        const projection = getProjectionConfig(selectedProjection, anatomy, plannerObliqueAngle);

        // Do not overwrite any solved axis here. Changing lift/cart/rotation
        // after solving would invalidate central-ray alignment.
        return {
            ...result,
            anatomy_preset: {
                landmark_id: anatomy.id,
                landmark: anatomy.label,
                procedure: PROCEDURE_OPTIONS[anatomy.procedure]?.label || anatomy.procedure,
                body_region: anatomy.regionLabel,
                projection: projection.label,
                orbital_angle_deg: projection.angleDeg,
                wig_wag_angle_deg: projection.wigWagDeg
            },
            explanation: [
                ...(Array.isArray(result.explanation) ? result.explanation : []),
                `Registered target: ${anatomy.label}.`,
                `Projection: ${projection.label}; orbital ${projection.angleDeg.toFixed(1)}°, wig-wag ${projection.wigWagDeg.toFixed(1)}°.`,
                'No post-solve preset was allowed to overwrite the geometry-verified pose.'
            ]
        };
    };

    const getPlannerAxisLimits = (key, fallbackMinimum, fallbackMaximum) => {
        const spec = CONTROL_SPECS[key] || {};
        let minimum = Number.isFinite(Number(spec.min)) ? Number(spec.min) : fallbackMinimum;
        let maximum = Number.isFinite(Number(spec.max)) ? Number(spec.max) : fallbackMaximum;

        if (key === 'column_rot') {
            minimum = Math.min(minimum, -SIMULATOR_MIN_COLUMN_RANGE_RAD);
            maximum = Math.max(maximum, SIMULATOR_MIN_COLUMN_RANGE_RAD);
        }

        return { minimum, maximum };
    };

    const clampToPlannerAxis = (key, value, fallbackMinimum, fallbackMaximum) => {
        const { minimum, maximum } = getPlannerAxisLimits(
            key,
            fallbackMinimum,
            fallbackMaximum
        );
        return Math.max(minimum, Math.min(maximum, Number(value)));
    };

    const applyPoseDirectlyToScene = (pose) => {
        if (liftRef.current) {
            liftRef.current.position.y = 1.20 + Number(pose.lift);
        }
        if (columnRotRef.current) {
            columnRotRef.current.rotation.y = Number(pose.column_rot);
        }
        if (wigWagRef.current) {
            wigWagRef.current.rotation.z = Number(pose.wig_wag);
        }
        if (cArmSlideRef.current) {
            cArmSlideRef.current.rotation.x = Number(pose.orbital_slide);
        }
        if (cartRef.current) {
            cartRef.current.position.x = Number(pose.cart_x);
            cartRef.current.position.z = Number(pose.cart_z);
            cartRef.current.updateMatrixWorld(true);
        }
    };

    const readSceneGeometryForPose = (pose) => {
        if (
            !cartRef.current ||
            !cArmSlideRef.current ||
            !srcAnchorRef.current ||
            !detAnchorRef.current
        ) {
            throw new Error('The C-arm Three.js hierarchy is not ready yet.');
        }

        applyPoseDirectlyToScene(pose);

        const isocenterWorld = new THREE.Vector3();
        const sourceWorld = new THREE.Vector3();
        const detectorWorld = new THREE.Vector3();

        cArmSlideRef.current.getWorldPosition(isocenterWorld);
        srcAnchorRef.current.getWorldPosition(sourceWorld);
        detAnchorRef.current.getWorldPosition(detectorWorld);

        return { isocenterWorld, sourceWorld, detectorWorld };
    };

    const solveThreeByThree = (matrixColumns, vector) => {
        const augmented = [
            [matrixColumns[0].x, matrixColumns[1].x, matrixColumns[2].x, vector.x],
            [matrixColumns[0].y, matrixColumns[1].y, matrixColumns[2].y, vector.y],
            [matrixColumns[0].z, matrixColumns[1].z, matrixColumns[2].z, vector.z]
        ];

        for (let pivot = 0; pivot < 3; pivot += 1) {
            let bestRow = pivot;
            for (let row = pivot + 1; row < 3; row += 1) {
                if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[bestRow][pivot])) {
                    bestRow = row;
                }
            }

            if (Math.abs(augmented[bestRow][pivot]) < 1e-10) {
                throw new Error('C-arm translation Jacobian is singular.');
            }

            if (bestRow !== pivot) {
                [augmented[pivot], augmented[bestRow]] = [augmented[bestRow], augmented[pivot]];
            }

            const divisor = augmented[pivot][pivot];
            for (let column = pivot; column < 4; column += 1) {
                augmented[pivot][column] /= divisor;
            }

            for (let row = 0; row < 3; row += 1) {
                if (row === pivot) continue;
                const factor = augmented[row][pivot];
                for (let column = pivot; column < 4; column += 1) {
                    augmented[row][column] -= factor * augmented[pivot][column];
                }
            }
        }

        return [augmented[0][3], augmented[1][3], augmented[2][3]];
    };

    const pointToCentralRayDistance = (point, source, detector) => {
        const ray = new THREE.Vector3().subVectors(detector, source);
        const rayLengthSquared = ray.lengthSq();
        if (rayLengthSquared < 1e-12) {
            return { distance: Infinity, t: 0, closest: source.clone() };
        }

        const sourceToPoint = new THREE.Vector3().subVectors(point, source);
        const t = sourceToPoint.dot(ray) / rayLengthSquared;
        const closest = source.clone().addScaledVector(ray, t);

        return {
            distance: closest.distanceTo(point),
            t,
            closest
        };
    };

    const computeSceneGeometryPose = (currentPose, numericTarget) => {
        if (!ctGroupRef.current || !patientModelRef.current) {
            throw new Error('Patient and CT registration must finish loading before planning.');
        }

        const targetLocal = new THREE.Vector3(
            Number(numericTarget.x_mm) / 1000,
            Number(numericTarget.y_mm) / 1000,
            Number(numericTarget.z_mm) / 1000
        );

        ctGroupRef.current.updateMatrixWorld(true);
        const targetWorld = targetLocal.clone();
        ctGroupRef.current.localToWorld(targetWorld);

        const anatomy = ANATOMICAL_TARGETS[selectedAnatomy] || ANATOMICAL_TARGETS.MANUAL;
        const projection = getProjectionConfig(
            selectedProjection,
            anatomy,
            plannerObliqueAngle
        );

        const desiredOrbital = Number(projection.angleDeg) * D2R;
        const desiredWigWag = Number(projection.wigWagDeg) * D2R;

        const livePose = {
            lift: Number(currentPose.lift),
            column_rot: Number(currentPose.column_rot),
            wig_wag: Number(currentPose.wig_wag),
            orbital_slide: Number(currentPose.orbital_slide),
            cart_x: Number(currentPose.cart_x),
            cart_z: Number(currentPose.cart_z)
        };

        const originalPose = { ...livePose };

        const liftLimits = getPlannerAxisLimits('lift', -0.50, 0.50);
        const columnLimits = getPlannerAxisLimits(
            'column_rot',
            -SIMULATOR_MIN_COLUMN_RANGE_RAD,
            SIMULATOR_MIN_COLUMN_RANGE_RAD
        );
        const cartXLimits = getPlannerAxisLimits('cart_x', 0.80, 2.50);
        const cartZLimits = getPlannerAxisLimits('cart_z', 0.00, 1.20);

        const columnCandidates = new Set([
            livePose.column_rot,
            columnLimits.minimum,
            columnLimits.maximum,
            0
        ]);

        const candidateCount = 181;
        for (let index = 0; index < candidateCount; index += 1) {
            const alpha = index / (candidateCount - 1);
            columnCandidates.add(
                columnLimits.minimum
                + alpha * (columnLimits.maximum - columnLimits.minimum)
            );
        }

        const perturbation = 0.001;
        let best = null;

        try {
            for (const columnRotation of columnCandidates) {
                const basePose = {
                    ...livePose,
                    column_rot: Number(columnRotation),
                    wig_wag: desiredWigWag,
                    orbital_slide: desiredOrbital
                };

                const baseGeometry = readSceneGeometryForPose(basePose);

                const axisNames = ['lift', 'cart_x', 'cart_z'];
                const jacobianColumns = axisNames.map(axis => {
                    const perturbedPose = {
                        ...basePose,
                        [axis]: Number(basePose[axis]) + perturbation
                    };
                    const perturbedGeometry = readSceneGeometryForPose(perturbedPose);
                    return perturbedGeometry.isocenterWorld
                        .clone()
                        .sub(baseGeometry.isocenterWorld)
                        .multiplyScalar(1 / perturbation);
                });

                const requiredCorrection = targetWorld
                    .clone()
                    .sub(baseGeometry.isocenterWorld);

                const [deltaLift, deltaCartX, deltaCartZ] = solveThreeByThree(
                    jacobianColumns,
                    requiredCorrection
                );

                const rawPose = {
                    ...basePose,
                    lift: Number(basePose.lift) + deltaLift,
                    cart_x: Number(basePose.cart_x) + deltaCartX,
                    cart_z: Number(basePose.cart_z) + deltaCartZ
                };

                const candidatePose = {
                    ...rawPose,
                    lift: Math.max(liftLimits.minimum, Math.min(liftLimits.maximum, rawPose.lift)),
                    column_rot: Math.max(columnLimits.minimum, Math.min(columnLimits.maximum, rawPose.column_rot)),
                    wig_wag: clampToPlannerAxis('wig_wag', rawPose.wig_wag, -Math.PI / 4, Math.PI / 4),
                    orbital_slide: clampToPlannerAxis('orbital_slide', rawPose.orbital_slide, -Math.PI, Math.PI),
                    cart_x: Math.max(cartXLimits.minimum, Math.min(cartXLimits.maximum, rawPose.cart_x)),
                    cart_z: Math.max(cartZLimits.minimum, Math.min(cartZLimits.maximum, rawPose.cart_z))
                };

                const geometry = readSceneGeometryForPose(candidatePose);
                const isocenterErrorM = geometry.isocenterWorld.distanceTo(targetWorld);
                const rayResult = pointToCentralRayDistance(
                    targetWorld,
                    geometry.sourceWorld,
                    geometry.detectorWorld
                );

                const linearTravel =
                    Math.abs(candidatePose.lift - livePose.lift)
                    + Math.abs(candidatePose.cart_x - livePose.cart_x)
                    + Math.abs(candidatePose.cart_z - livePose.cart_z);

                const angularTravel =
                    Math.abs(candidatePose.column_rot - livePose.column_rot)
                    + 0.25 * Math.abs(candidatePose.wig_wag - livePose.wig_wag)
                    + 0.25 * Math.abs(candidatePose.orbital_slide - livePose.orbital_slide);

                const limitPenalty =
                    Math.abs(candidatePose.lift - rawPose.lift)
                    + Math.abs(candidatePose.cart_x - rawPose.cart_x)
                    + Math.abs(candidatePose.cart_z - rawPose.cart_z);

                // Geometry errors dominate the score. Motion size only selects
                // among solutions that are already equally accurate.
                const score =
                    isocenterErrorM * 1e9
                    + rayResult.distance * 1e9
                    + limitPenalty * 1e7
                    + linearTravel * 100
                    + angularTravel;

                if (!best || score < best.score) {
                    best = {
                        score,
                        pose: candidatePose,
                        geometry,
                        targetWorld: targetWorld.clone(),
                        isocenterErrorM,
                        rayDistanceM: rayResult.distance,
                        rayParameter: rayResult.t,
                        projection
                    };
                }
            }
        } finally {
            // Solving temporarily manipulates Three.js nodes synchronously.
            // Restore the live measured pose before the next browser frame.
            readSceneGeometryForPose(originalPose);
        }

        if (!best) {
            throw new Error('No C-arm scene-geometry solution was produced.');
        }

        const isocenterErrorMm = best.isocenterErrorM * 1000;
        const rayDistanceMm = best.rayDistanceM * 1000;

        if (
            isocenterErrorMm > SCENE_GEOMETRY_HARD_REJECT_MM
            || rayDistanceMm > SCENE_GEOMETRY_HARD_REJECT_MM
        ) {
            throw new Error(
                `Target is outside the current simulated mechanical workspace. `
                + `Best isocenter error: ${isocenterErrorMm.toFixed(1)} mm; `
                + `central-ray error: ${rayDistanceMm.toFixed(1)} mm.`
            );
        }

        if (
            isocenterErrorMm > SCENE_GEOMETRY_TOLERANCE_MM
            || rayDistanceMm > SCENE_GEOMETRY_TOLERANCE_MM
        ) {
            throw new Error(
                `Geometry verification did not reach the required 1.0 mm tolerance. `
                + `Isocenter error: ${isocenterErrorMm.toFixed(2)} mm; `
                + `central-ray error: ${rayDistanceMm.toFixed(2)} mm.`
            );
        }

        return {
            finalPose: best.pose,
            verification: {
                verified: true,
                tolerance_mm: SCENE_GEOMETRY_TOLERANCE_MM,
                isocenter_error_mm: Number(isocenterErrorMm.toFixed(4)),
                central_ray_error_mm: Number(rayDistanceMm.toFixed(4)),
                target_world_mm: {
                    x: Number((best.targetWorld.x * 1000).toFixed(4)),
                    y: Number((best.targetWorld.y * 1000).toFixed(4)),
                    z: Number((best.targetWorld.z * 1000).toFixed(4))
                },
                isocenter_world_mm: {
                    x: Number((best.geometry.isocenterWorld.x * 1000).toFixed(4)),
                    y: Number((best.geometry.isocenterWorld.y * 1000).toFixed(4)),
                    z: Number((best.geometry.isocenterWorld.z * 1000).toFixed(4))
                },
                source_world_mm: {
                    x: Number((best.geometry.sourceWorld.x * 1000).toFixed(4)),
                    y: Number((best.geometry.sourceWorld.y * 1000).toFixed(4)),
                    z: Number((best.geometry.sourceWorld.z * 1000).toFixed(4))
                },
                detector_world_mm: {
                    x: Number((best.geometry.detectorWorld.x * 1000).toFixed(4)),
                    y: Number((best.geometry.detectorWorld.y * 1000).toFixed(4)),
                    z: Number((best.geometry.detectorWorld.z * 1000).toFixed(4))
                }
            }
        };
    };

    useEffect(() => {
        const marker = targetMarkerGroupRef.current;
        if (!marker) return;
        const x = Number(plannerTarget.x_mm);
        const y = Number(plannerTarget.y_mm);
        const z = Number(plannerTarget.z_mm);
        marker.visible = [x, y, z].every(Number.isFinite);
        if (marker.visible) marker.position.set(x / 1000, y / 1000, z / 1000);
    }, [plannerTarget]);

    const wait = (milliseconds) =>
        new Promise(resolve => window.setTimeout(resolve, milliseconds));

    const posesMatch = (a, b) => {
        if (!a || !b) return false;

        // Encoder-style stale-plan tolerances:
        // linear axes: 2 mm; angular axes: 0.5 degrees.
        const linearToleranceM = 0.002;
        const angularToleranceRad = 0.5 * D2R;

        return ['lift', 'cart_x', 'cart_z']
            .every(key => Math.abs(Number(a[key]) - Number(b[key])) <= linearToleranceM)
            && ['column_rot', 'wig_wag', 'orbital_slide']
                .every(key => Math.abs(Number(a[key]) - Number(b[key])) <= angularToleranceRad);
    };

    const animatePlannedPath = async (waypoints, { preview = false } = {}) => {
        if (!Array.isArray(waypoints) || waypoints.length === 0) {
            throw new Error('The planner returned no waypoints.');
        }

        const startPose = { ...controlsRef.current };
        pathAnimationCancelledRef.current = false;
        activePreviewStartPoseRef.current = preview ? startPose : null;
        setIsPathAnimating(true);
        setPlannerAnimationMode(preview ? 'preview' : 'move');
        setPlannerStatus(preview ? 'PREVIEWING' : 'MOVING');

        try {
            for (const waypoint of waypoints) {
                if (pathAnimationCancelledRef.current) {
                    if (preview) {
                        setControls(startPose);
                        controlsRef.current = startPose;
                    }
                    setPlannerStatus('CANCELLED');
                    return;
                }

                if (!waypoint?.pose) continue;

                const pose = waypoint.pose;
                const nextPose = {
                    lift: Number(pose.lift),
                    column_rot: Number(pose.column_rot),
                    wig_wag: Number(pose.wig_wag),
                    orbital_slide: Number(pose.orbital_slide),
                    cart_x: Number(pose.cart_x),
                    cart_z: Number(pose.cart_z)
                };

                if (Object.values(nextPose).some(value => !Number.isFinite(value))) {
                    throw new Error(`Waypoint ${waypoint.index ?? '?'} contains an invalid pose value.`);
                }

                setControls(nextPose);
                controlsRef.current = nextPose;
                await wait(PLANNER_WAYPOINT_DELAY_MS);
            }

            if (!pathAnimationCancelledRef.current) {
                if (preview) {
                    await wait(300);
                    setControls(startPose);
                    controlsRef.current = startPose;
                    setPlannerStatus('PREVIEW READY');
                } else {
                    setPlannerStatus('ARRIVED');
                }
            }
        } finally {
            activePreviewStartPoseRef.current = null;
            setIsPathAnimating(false);
            setPlannerAnimationMode(null);
        }
    };

    const handlePreviewPath = async () => {
        if (isPlanning || isPathAnimating) return;

        const numericTarget = {
            x_mm: Number(plannerTarget.x_mm),
            y_mm: Number(plannerTarget.y_mm),
            z_mm: Number(plannerTarget.z_mm)
        };

        if (Object.values(numericTarget).some(value => !Number.isFinite(value))) {
            setPlannerError('Target X, Y, and Z must all be valid numbers.');
            setPlannerStatus('ERROR');
            return;
        }

        setPlannerError('');
        setPlannerResult(null);
        setIsPlanning(true);
        setPlannerStatus('PLANNING');
        pathAnimationCancelledRef.current = false;

        plannerAbortRef.current?.abort();
        const abortController = new AbortController();
        plannerAbortRef.current = abortController;

        const currentPose = { ...controlsRef.current };
        plannedStartPoseRef.current = currentPose;

        let sceneGeometryPlan;
        try {
            sceneGeometryPlan = computeSceneGeometryPose(currentPose, numericTarget);
        } catch (geometryError) {
            setPlannerError(geometryError?.message || String(geometryError));
            setPlannerStatus('GEOMETRY ERROR');
            setIsPlanning(false);
            return;
        }

        const requestBody = {
            current_pose: {
                lift: Number(currentPose.lift),
                column_rot: Number(currentPose.column_rot),
                wig_wag: Number(currentPose.wig_wag),
                orbital_slide: Number(currentPose.orbital_slide),
                cart_x: Number(currentPose.cart_x),
                cart_z: Number(currentPose.cart_z)
            },
            target: numericTarget,
            view: plannerView,
            oblique_angle_deg: Number(plannerObliqueAngle),
            waypoint_count: Number(plannerWaypointCount),
            final_pose_override: sceneGeometryPlan.finalPose,
            geometry_verification: sceneGeometryPlan.verification
        };

        try {
            const response = await fetch(PLANNER_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                },
                body: JSON.stringify(requestBody),
                signal: abortController.signal
            });

            if (!response.ok) {
                let message = `Planner returned HTTP ${response.status}`;
                try {
                    const errorBody = await response.json();
                    if (typeof errorBody.detail === 'string') message = errorBody.detail;
                    else if (errorBody.detail) message = JSON.stringify(errorBody.detail);
                } catch {
                    // Keep HTTP status message when the body is not JSON.
                }
                throw new Error(message);
            }

            const rawResult = await response.json();

            if (rawResult.solver_mode !== 'threejs_scene_geometry') {
                throw new Error(
                    `Backend did not use the verified Three.js scene geometry. `
                    + `Received mode: ${rawResult.solver_mode || 'missing'}.`
                );
            }

            const returnedGeometry = rawResult.geometry_verification;
            if (!returnedGeometry?.verified) {
                throw new Error('Backend did not return verified scene-geometry alignment.');
            }

            if (
                Number(returnedGeometry.isocenter_error_mm) > SCENE_GEOMETRY_TOLERANCE_MM
                || Number(returnedGeometry.central_ray_error_mm) > SCENE_GEOMETRY_TOLERANCE_MM
            ) {
                throw new Error(
                    `Returned path failed geometry tolerance: `
                    + `${Number(returnedGeometry.central_ray_error_mm).toFixed(2)} mm central-ray error.`
                );
            }

            if (rawResult.start_pose && !posesMatch(rawResult.start_pose, currentPose)) {
                throw new Error('Backend planned from a different measured pose. Replan required.');
            }

            if (!rawResult.final_pose) {
                throw new Error('The planner response did not contain a final pose.');
            }
            if (!Array.isArray(rawResult.waypoints) || rawResult.waypoints.length === 0) {
                throw new Error('The planner response did not contain a valid path.');
            }

            const result = annotatePlannerResult(rawResult);
            setPlannerResult(result);
            setPlannerStatus('PATH READY');
            setIsPlanning(false);
            await animatePlannedPath(result.waypoints, { preview: true });
        } catch (error) {
            if (error?.name === 'AbortError') {
                setPlannerStatus('CANCELLED');
                return;
            }
            console.error('Path preview failed:', error);
            setPlannerError(error?.message || String(error));
            setPlannerStatus('ERROR');
        } finally {
            setIsPlanning(false);
            if (plannerAbortRef.current === abortController) {
                plannerAbortRef.current = null;
            }
        }
    };

    const handleMovePlannedPath = async () => {
        if (isPlanning || isPathAnimating) return;
        if (!plannerResult?.waypoints?.length) {
            setPlannerError('Preview a valid path before moving the C-arm.');
            setPlannerStatus('ERROR');
            return;
        }

        if (!posesMatch(controlsRef.current, plannedStartPoseRef.current)) {
            setPlannerError('The C-arm pose changed after planning. Run PREVIEW again before moving.');
            setPlannerStatus('REPLAN REQUIRED');
            return;
        }

        setPlannerError('');
        await animatePlannedPath(plannerResult.waypoints, { preview: false });
    };

    const handleCancelPlannedPath = () => {
        pathAnimationCancelledRef.current = true;
        plannerAbortRef.current?.abort();
        plannerAbortRef.current = null;

        if (activePreviewStartPoseRef.current) {
            const restorePose = { ...activePreviewStartPoseRef.current };
            setControls(restorePose);
            controlsRef.current = restorePose;
        }

        setIsPlanning(false);
        setIsPathAnimating(false);
        setPlannerAnimationMode(null);
        setPlannerStatus('CANCELLED');
    };

    const handleTakeXray = async () => {
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

        const laterality = /\bleft\b/i.test(fullAnatomyText)
            ? 'left'
            : /\bright\b/i.test(fullAnatomyText)
                ? 'right'
                : null;

        const angulationDirection = selectedProjection === 'CAUDAL'
            ? 'caudal'
            : selectedProjection === 'CRANIAL'
                ? 'cranial'
                : null;

        const now = new Date();
        const sampleId = `sample_${now.toISOString().replace(/[:.]/g, "-")}`;
        const annotation = {
            sample_id: sampleId,
            image_filename: `${sampleId}.png`,
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
                'https://c-arm-synthetic-xray.onrender.com/synthetic-xray',
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
                let message = `Synthetic X-ray server returned HTTP ${response.status}`;
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

            const xrayDataUrl = `data:${result.mime_type};base64,${result.image_base64}`;
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

            downloadDataUrl(xrayDataUrl, `${sampleId}_AI_SYNTHETIC.png`);
            setTimeout(() => {
                downloadJson(completedAnnotation, `${sampleId}_AI_SYNTHETIC.json`);
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
            downloadDataUrl(fallbackDataUrl, `${sampleId}_SIMULATED_ATLAS.png`);
            setTimeout(() => {
                downloadJson(fallbackAnnotation, `${sampleId}_SIMULATED_ATLAS.json`);
            }, 150);
        } finally {
            setBeamActive(false);
        }
    };

    // --- ARDUINO CONNECTION ---
    const connectArduino = async () => {
        if (!("serial" in navigator)) {
            alert("Use Chrome or Edge (Web Serial required)");
            return false;
        }

        if (
            isArduinoConnectedRef.current &&
            serialWriterRef.current &&
            serialPortRef.current &&
            serialPortRef.current.writable
        ) {
            return true;
        }

        await disconnectArduino(); // reset before reconnect attempt

        try {
            const port = await navigator.serial.requestPort();  // must be user gesture
            await port.open({ baudRate: 115200 });

            serialPortRef.current = port;
            serialWriterRef.current = port.writable.getWriter();
            isArduinoConnectedRef.current = true;
            setIsArduinoConnectedUI(true);

            console.log("Arduino connected");
            return true;
        } catch (e) {
            console.warn("Connection cancelled or failed:", e);
            return false;
        }
    };

    const disconnectArduino = async () => {
        try {
            if (serialWriterRef.current) {
                serialWriterRef.current.releaseLock();
                serialWriterRef.current = null;
            }
            if (serialPortRef.current) {
                await serialPortRef.current.close();
                serialPortRef.current = null;
            }
        } catch (e) {
            console.warn("Disconnect warning:", e);
        } finally {
            isArduinoConnectedRef.current = false;
            setIsArduinoConnectedUI(false);
            console.log("Arduino disconnected");
        }
    };

    const ensureArduinoConnected = async () => {
        if (isArduinoConnectedRef.current && serialWriterRef.current)
            return true;

        return await connectArduino();
    };

    useEffect(() => {
        return () => {
            pathAnimationCancelledRef.current = true;
            plannerAbortRef.current?.abort();
        };
    }, []);

    useEffect(() => {
        const handleKeyDown = (e) => {
            // Don't spam actions if key is held down
            if (e.repeat) return;

            // Don't trigger shortcuts while typing in inputs (future-proof)
            const tag = (e.target?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

            const k = e.key.toLowerCase();

            // LANDMARK CALIBRATION. Arrow keys edit the selected landmark in
            // the registered CT frame. Shift = 5 mm; Alt = 0.1 mm.
            if (calibrationModeRef.current && selectedAnatomyRef.current !== 'MANUAL') {
                const stepMm = e.altKey ? 0.1 : (e.shiftKey ? 5 : 1);
                const calibrationKeys = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'pageup', 'pagedown'];

                if (calibrationKeys.includes(k)) {
                    e.preventDefault();
                    if (k === 'arrowleft') nudgeRegisteredLandmark('x_mm', -stepMm);
                    if (k === 'arrowright') nudgeRegisteredLandmark('x_mm', stepMm);
                    if (k === 'arrowup') nudgeRegisteredLandmark('y_mm', stepMm);
                    if (k === 'arrowdown') nudgeRegisteredLandmark('y_mm', -stepMm);
                    if (k === 'pageup') nudgeRegisteredLandmark('z_mm', stepMm);
                    if (k === 'pagedown') nudgeRegisteredLandmark('z_mm', -stepMm);
                    return;
                }
            }

            // CONNECT/DISCONNECT ARDUINO (C)
            if (k === 'c') {
                // IMPORTANT: keep it a direct user gesture (keydown) -> requestPort()
                if (isArduinoConnectedRef.current) {
                    disconnectArduino();
                } else {
                    connectArduino();
                }
                return;
            }

            // Toggle Debug
            if (k === 'd') {
                setDebugEnabled(prev => {
                    const next = !prev;
                    debugEnabledRef.current = next;
                    return next;
                });
                return;
            }

            // Toggle Landmarks
            if (k === 'l') {
                showLandmarksRef.current = !showLandmarksRef.current;
                console.log("Landmarks Toggled:", showLandmarksRef.current);
                return;
            }

            // Toggle landmark calibration mode
            if (k === 'k') {
                setCalibrationMode(previous => {
                    const next = !previous;
                    calibrationModeRef.current = next;
                    showLandmarksRef.current = next || showLandmarksRef.current;
                    queueMicrotask(() => refreshAnatomicalLandmarkOverlay());
                    return next;
                });
                return;
            }

            // Toggle Instructions
            if (k === 'i') {
                setShowInstructions(prev => !prev);
                return;
            }

            // Toggle Patient
            if (k === 'p') {
                if (patientModelRef.current) {
                    patientModelRef.current.visible = !patientModelRef.current.visible;
                    console.log("Patient Toggled:", patientModelRef.current.visible);
                }
                return;
            }

            // --- DIFFDRR CT CALIBRATION TOGGLES ---
            if (k === '1') { showCtAxesRef.current = !showCtAxesRef.current; return; }
            if (k === '2') { showCtBoxRef.current = !showCtBoxRef.current; return; }
            if (k === '3') { showCtLandmarksRef.current = !showCtLandmarksRef.current; return; }
            if (k === '4') { showBeamLineRef.current = !showBeamLineRef.current; return; }
            if (k === '5') { showBeamIntersectRef.current = !showBeamIntersectRef.current; return; }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Web Serial cleanup & disconnect listener
    useEffect(() => {
        if (!("serial" in navigator)) return;

        const onDisconnect = (event) => {
            if (serialPortRef.current && event.target === serialPortRef.current) {
                disconnectArduino();
            }
        };

        navigator.serial.addEventListener("disconnect", onDisconnect);
        return () => {
            navigator.serial.removeEventListener("disconnect", onDisconnect);
            // Best-effort cleanup on unmount
            disconnectArduino();
        };
    }, []);

    useEffect(() => {
        const currentMount = mountRef.current;
        if (!currentMount) return;

        // --- SETUP ---
        const width = currentMount.clientWidth;
        const height = currentMount.clientHeight;
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xeef2f5);
        let mounted = true; // Prevents race conditions / strict mode dual load

        const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
        camera.position.set(0, 1.6, 2.5); // Standing height, 2m from patient's feet

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        rendererRef.current = renderer;
        renderer.setSize(width, height);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        while (currentMount.firstChild) currentMount.removeChild(currentMount.firstChild);
        currentMount.appendChild(renderer.domElement);

        const orbit = new OrbitControls(camera, renderer.domElement);
        orbit.enableDamping = true;
        orbit.target.set(0, 1.0, 0.5); // Looking at patient's feet area

        // ENABLE LAYERS for Camera (0: Default, 1: Landmarks)
        camera.layers.enable(0);
        camera.layers.enable(1);

        // --- NAVIGATION GIZMO ---
        const viewHelper = new ViewHelper(camera, renderer.domElement);
        // Shadow the render method to force TOP-RIGHT and use our precise dimensions
        viewHelper.render = function (renderer) {
            const dim = 128;
            this.quaternion.copy(camera.quaternion).invert();
            this.updateMatrixWorld();

            const canvasW = renderer.domElement.clientWidth;
            const canvasH = renderer.domElement.clientHeight;

            renderer.clearDepth();
            renderer.setViewport(canvasW - dim, canvasH - dim, dim, dim);
            if (!this.gizmoCamera) {
                this.gizmoCamera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0, 4);
                this.gizmoCamera.position.set(0, 0, 2);
            }
            renderer.render(this, this.gizmoCamera);
        };

        const ambient = new THREE.AmbientLight(0xffffff, 0.7);
        scene.add(ambient);
        const sun = new THREE.DirectionalLight(0xffffff, 1.2);
        sun.position.set(5, 10, 5);
        sun.castShadow = true;
        sun.shadow.mapSize.width = 2048;
        sun.shadow.mapSize.height = 2048;
        scene.add(sun);

        // --- FLOOR ---
        const floorLoader = new THREE.TextureLoader();
        const marbleTexture = floorLoader.load('/marbleFloor.jpg');
        marbleTexture.wrapS = THREE.RepeatWrapping;
        marbleTexture.wrapT = THREE.RepeatWrapping;
        marbleTexture.repeat.set(4, 4); // Tile 4x4 times

        const floorMaterial = new THREE.MeshStandardMaterial({
            map: marbleTexture,
            roughness: 0.1, // Shiny
            metalness: 0.1
        });

        const floor = new THREE.Mesh(new THREE.PlaneGeometry(15, 10), floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        scene.add(floor);

        // Walls (15x15 room, 9m height)
        const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.8, side: THREE.DoubleSide });
        const wallHeight = 9;

        // North wall (positive Z)
        const wallNorth = new THREE.Mesh(new THREE.PlaneGeometry(15, wallHeight), wallMaterial);
        wallNorth.position.set(0, wallHeight / 2, 5.0);
        wallNorth.receiveShadow = true;
        scene.add(wallNorth);

        // South wall (negative Z)
        const wallSouth = new THREE.Mesh(new THREE.PlaneGeometry(15, wallHeight), wallMaterial);
        wallSouth.position.set(0, wallHeight / 2, -5.0);
        wallSouth.rotation.y = Math.PI;
        wallSouth.receiveShadow = true;
        scene.add(wallSouth);

        // East wall (positive X)
        const wallEast = new THREE.Mesh(new THREE.PlaneGeometry(10, wallHeight), wallMaterial);
        wallEast.position.set(7.5, wallHeight / 2, 0);
        wallEast.rotation.y = -Math.PI / 2;
        wallEast.receiveShadow = true;
        scene.add(wallEast);

        // West wall (negative X)
        const wallWest = new THREE.Mesh(new THREE.PlaneGeometry(10, wallHeight), wallMaterial);
        wallWest.position.set(-7.5, wallHeight / 2, 0);
        wallWest.rotation.y = Math.PI / 2;
        wallWest.receiveShadow = true;
        scene.add(wallWest);

        // --- DIRECTION LABELS (FLOOR) ---
        const floorLabelsGroup = new THREE.Group();
        floorLabelsGroup.visible = false;
        scene.add(floorLabelsGroup);
        floorLabelsRef.current = floorLabelsGroup;

        const createFloorLabel = (text, color, position, rotationY) => {
            const canvas = document.createElement('canvas');
            canvas.width = 512;
            canvas.height = 256;
            const context = canvas.getContext('2d');

            // Transparent background
            context.clearRect(0, 0, canvas.width, canvas.height);

            // Text styling
            context.font = 'Bold 120px Arial';
            context.fillStyle = color;
            context.textAlign = 'center';
            context.textBaseline = 'middle';

            // Outline for visibility
            context.strokeStyle = 'white';
            context.lineWidth = 10;
            context.strokeText(text, canvas.width / 2, canvas.height / 2);
            context.fillText(text, canvas.width / 2, canvas.height / 2);

            const texture = new THREE.CanvasTexture(canvas);
            texture.needsUpdate = true;
            // High quality filtering
            texture.minFilter = THREE.LinearFilter;

            // Use a Plane so it lays flat on the ground
            const labelGeo = new THREE.PlaneGeometry(3, 1.5);
            const labelMat = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                depthWrite: false // prevent z-fighting with floor if perfectly flat
            });
            const labelMesh = new THREE.Mesh(labelGeo, labelMat);

            // Position slightly above floor to prevent z-fighting
            labelMesh.position.copy(position);

            // Rotate to lay flat on ground, then apply specific Y rotation so it reads correctly
            labelMesh.rotation.x = -Math.PI / 2;
            labelMesh.rotation.z = rotationY; // Z rotates it mathematically on the plane

            floorLabelsGroup.add(labelMesh);
        };

        // Add labels near the edges of the room
        // Readability: Bottom of text faces the center of the room.
        createFloorLabel("NORTH", "#e74c3c", new THREE.Vector3(0, 0.02, 4.0), Math.PI);      // Red
        createFloorLabel("SOUTH", "#3498db", new THREE.Vector3(0, 0.02, -4.0), 0);          // Blue
        createFloorLabel("EAST", "#f1c40f", new THREE.Vector3(6.5, 0.02, 0), Math.PI / 2);  // Yellow
        createFloorLabel("WEST", "#2ecc71", new THREE.Vector3(-6.5, 0.02, 0), -Math.PI / 2); // Green

        // --- X-RAY ROOM DOOR (West Wall) ---
        const doorGroup = new THREE.Group();
        // Shift slightly inward to avoid z-fighting
        doorGroup.position.set(-7.45, 0, 0);
        doorGroup.rotation.y = Math.PI / 2; // Face into room
        scene.add(doorGroup);

        // 1. Door Frame (Stainless Steel)
        const frameW = 2.4;
        const frameH = 2.4;
        const frameD = 0.15;
        const frameGeo = new THREE.BoxGeometry(frameW, frameH, frameD);
        const frameMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.4, metalness: 0.6 });
        const frame = new THREE.Mesh(frameGeo, frameMat);
        frame.position.set(0, frameH / 2, 0);
        doorGroup.add(frame);

        // 2. Door Panel (Lead-Lined, Sliding Style)
        const doorW = 2.2;
        const doorH = 2.3;
        const doorD = 0.08;
        const doorGeo = new THREE.BoxGeometry(doorW, doorH, doorD);
        const doorMat = new THREE.MeshStandardMaterial({
            color: 0xe0e0e0, // Off-white / Medical Grey
            roughness: 0.7,
            metalness: 0.1
        });
        const door = new THREE.Mesh(doorGeo, doorMat);
        door.position.set(0.1, doorH / 2, 0.06); // Slightly offset Z (in door group space) for sliding look
        doorGroup.add(door);

        // 3. Kickplate (Chrome)
        const kickH = 0.3;
        const kickGeo = new THREE.PlaneGeometry(doorW - 0.1, kickH);
        const kickMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.2, metalness: 0.8 });
        const kick = new THREE.Mesh(kickGeo, kickMat);
        kick.position.set(0.1, kickH / 2 + 0.01, 0.06 + doorD / 2 + 0.001); // On surface of door
        doorGroup.add(kick);

        // 4. Lead Glass Window (Small, Eye Level)
        const winW = 0.3;
        const winH = 0.6;
        const winGeo = new THREE.PlaneGeometry(winW, winH);
        const winMat = new THREE.MeshPhysicalMaterial({
            color: 0x88ccaa, // Lead glass greenish
            metalness: 0.1,
            roughness: 0.1,
            transmission: 0.5, // Semi-transparent
            thickness: 0.05
        });
        const windowMesh = new THREE.Mesh(winGeo, winMat);
        windowMesh.position.set(0.1, 1.6, 0.06 + doorD / 2 + 0.002);
        doorGroup.add(windowMesh);

        // Frame for Window
        const winFrameGeo = new THREE.BoxGeometry(winW + 0.04, winH + 0.04, 0.02);
        const winFrame = new THREE.Mesh(winFrameGeo, frameMat);
        winFrame.position.set(0.1, 1.6, 0.06 + doorD / 2);
        doorGroup.add(winFrame);

        // 5. Handle (Vertical Bar)
        const handleH = 0.6;
        const handleGeo = new THREE.CylinderGeometry(0.02, 0.02, handleH, 8);
        const handle = new THREE.Mesh(handleGeo, kickMat);
        // Place on right side of door (if sliding left)
        handle.position.set(0.8, 1.1, 0.06 + doorD / 2 + 0.04);
        doorGroup.add(handle);

        // 6. Warning Light Box (Above Frame)
        const warnBoxGeo = new THREE.BoxGeometry(0.6, 0.2, 0.1);
        const warnBoxMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
        const warnBox = new THREE.Mesh(warnBoxGeo, warnBoxMat);
        warnBox.position.set(0, frameH + 0.2, 0); // Above frame
        doorGroup.add(warnBox);

        // "X-RAY IN USE" Text/Light Face
        const warnFaceGeo = new THREE.PlaneGeometry(0.5, 0.15);
        const warnFaceMat = new THREE.MeshBasicMaterial({ color: 0xff0000 }); // Red = On/Warning (or darker if off)
        const warnFace = new THREE.Mesh(warnFaceGeo, warnFaceMat);
        warnFace.position.set(0, 0, 0.051); // On surface of box
        warnBox.add(warnFace);

        // --- WEST WALL DECORATIONS (Windows, Curtains, Chairs) ---
        const westDecorGroup = new THREE.Group();
        scene.add(westDecorGroup);

        // 1. Windows (Left and Right of Door)
        const windowW = 2.4;
        const windowH = 1.8;
        const windowGeo = new THREE.PlaneGeometry(windowW, windowH);

        // Frame and glass materials
        const winGlassMat = new THREE.MeshPhysicalMaterial({
            color: 0xeef7ff, metalness: 0.1, roughness: 0.1, transmission: 0.9, transparent: true, opacity: 0.4, envMapIntensity: 1.0
        });
        const winFrameMat = new THREE.MeshStandardMaterial({ color: 0xcdd3d8, roughness: 0.4, metalness: 0.5 });
        const windowFrameGeo = new THREE.BoxGeometry(0.1, windowH + 0.1, windowW + 0.1); // Along Z axis

        // Z positions for the two windows relative to the door at Z=0
        [-3.2, 3.2].forEach(zPos => {
            // Frame
            const frame = new THREE.Mesh(windowFrameGeo, winFrameMat);
            frame.position.set(-7.48, 1.8, zPos);
            westDecorGroup.add(frame);

            // Glass
            const glass = new THREE.Mesh(windowGeo, winGlassMat);
            glass.position.set(-7.44, 1.8, zPos);
            glass.rotation.y = Math.PI / 2;
            westDecorGroup.add(glass);

            // Frame Mullions (Crossbars)
            const hBarGeo = new THREE.BoxGeometry(0.02, 0.05, windowW);
            const vBarGeo = new THREE.BoxGeometry(0.02, windowH, 0.05);

            const hBar = new THREE.Mesh(hBarGeo, winFrameMat);
            hBar.position.set(-7.45, 1.8, zPos);
            westDecorGroup.add(hBar);

            const vBar = new THREE.Mesh(vBarGeo, winFrameMat);
            vBar.position.set(-7.45, 1.8, zPos);
            westDecorGroup.add(vBar);

            // 2. Clinic Style Curtains (Semi-Open)
            // Procedural wavy curtain
            const curtainGeo = new THREE.PlaneGeometry(1.0, windowH + 0.3, 20, 1);
            const posAttr = curtainGeo.attributes.position;
            for (let i = 0; i < posAttr.count; i++) {
                const x = posAttr.getX(i);
                // add wave
                posAttr.setZ(i, Math.sin(x * 25) * 0.06);
            }
            curtainGeo.computeVertexNormals();

            const curtainMat = new THREE.MeshStandardMaterial({ color: 0xddeef8, roughness: 0.9, side: THREE.DoubleSide });

            // Left curtain
            const curtainL = new THREE.Mesh(curtainGeo, curtainMat);
            curtainL.position.set(-7.38, 1.8, zPos - windowW / 2 + 0.4);
            curtainL.rotation.y = Math.PI / 2;
            curtainL.scale.x = 0.5; // bunched up
            westDecorGroup.add(curtainL);

            // Right curtain
            const curtainR = new THREE.Mesh(curtainGeo, curtainMat);
            curtainR.position.set(-7.38, 1.8, zPos + windowW / 2 - 0.4);
            curtainR.rotation.y = Math.PI / 2;
            curtainR.scale.x = 0.5; // bunched up
            westDecorGroup.add(curtainR);
        });

        // 3. Clinic Chairs (Waiting Area Style)
        const chairMatSeat = new THREE.MeshStandardMaterial({ color: 0x34495e, roughness: 0.6 }); // Classic clinic blue
        const chairMatFrame = new THREE.MeshStandardMaterial({ color: 0xbdc3c7, roughness: 0.3, metalness: 0.6 }); // Steel

        const createChair = (x, z, rotY) => {
            const chairGroup = new THREE.Group();
            chairGroup.position.set(x, 0, z);
            chairGroup.rotation.y = rotY;

            // Seat using RoundedBoxGeometry
            const seatGeo = new RoundedBoxGeometry(0.55, 0.06, 0.5, 4, 0.02);
            const seat = new THREE.Mesh(seatGeo, chairMatSeat);
            seat.position.set(0, 0.45, 0);
            seat.castShadow = true;
            chairGroup.add(seat);

            // Backrest
            const backGeo = new RoundedBoxGeometry(0.55, 0.45, 0.06, 4, 0.02);
            const back = new THREE.Mesh(backGeo, chairMatSeat);
            back.position.set(0, 0.7, -0.22);
            back.rotation.x = -0.15; // ergonomic tilt
            back.castShadow = true;
            chairGroup.add(back);

            // Legs geometry
            const legGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.45, 8);
            [
                { x: 0.22, z: 0.2 }, { x: -0.22, z: 0.2 },
                { x: 0.22, z: -0.2 }, { x: -0.22, z: -0.2 }
            ].forEach(pos => {
                const leg = new THREE.Mesh(legGeo, chairMatFrame);
                leg.position.set(pos.x, 0.225, pos.z);
                leg.castShadow = true;
                chairGroup.add(leg);
            });

            // Armrests (Floating style)
            const armGeo = new RoundedBoxGeometry(0.06, 0.02, 0.35, 2, 0.01);
            const armLegGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.15, 8);

            [-0.32, 0.32].forEach(xPos => {
                const arm = new THREE.Mesh(armGeo, chairMatSeat);
                arm.position.set(xPos, 0.65, 0.05);
                chairGroup.add(arm);

                const armLeg = new THREE.Mesh(armLegGeo, chairMatFrame);
                armLeg.position.set(xPos, 0.55, 0.15);
                chairGroup.add(armLeg);
            });

            return chairGroup;
        };

        // Add 6 chairs (3 on each side) facing into the room (East)
        [-4.2, -3.4, -2.6, 2.6, 3.4, 4.2].forEach(zPos => {
            const chair = createChair(-6.8, zPos, Math.PI / 2); // Facing East (+X direction)
            westDecorGroup.add(chair);
        });

        // --- EAST WALL DECORATIONS (Medicine Cabinets) ---
        const eastDecorGroup = new THREE.Group();
        scene.add(eastDecorGroup);

        // Materials (Matte, subtle clinic colors)
        const cabBodyMat = new THREE.MeshStandardMaterial({ color: 0xecf0f1, roughness: 0.9, metalness: 0.05 }); // Off-white/light grey base
        const cabDoorMat = new THREE.MeshStandardMaterial({ color: 0x8ab9f1, roughness: 0.85, metalness: 0.1 }); // Soft light blue doors
        const cabDrawerMat = new THREE.MeshStandardMaterial({ color: 0x5fa1e8, roughness: 0.85, metalness: 0.1 }); // Slightly darker blue drawers
        const cabHandleMat = new THREE.MeshStandardMaterial({ color: 0x95a5a6, roughness: 0.7, metalness: 0.3 }); // Matte grey handles
        const cabGlassMat = new THREE.MeshPhysicalMaterial({
            color: 0xffffff, metalness: 0.1, roughness: 0.35, transmission: 0.7, transparent: true, opacity: 0.6
        }); // Frosted/semi-matte glass

        const createCabinet = (x, z, rotY) => {
            const cabGroup = new THREE.Group();
            cabGroup.position.set(x, 0, z);
            cabGroup.rotation.y = rotY;

            // Main Body (2.4m high, 1.2m wide, 0.5m deep)
            const bodyGeo = new THREE.BoxGeometry(1.2, 2.4, 0.5);
            const body = new THREE.Mesh(bodyGeo, cabBodyMat);
            body.position.set(0, 1.2, 0); // Bottom at Y=0
            body.castShadow = true;
            body.receiveShadow = true;
            cabGroup.add(body);

            // Bottom Kickplate (Darker grey)
            const kickMat = new THREE.MeshStandardMaterial({ color: 0x7f8c8d, roughness: 0.9 });
            const kickGeo = new THREE.BoxGeometry(1.18, 0.1, 0.48);
            const kick = new THREE.Mesh(kickGeo, kickMat);
            kick.position.set(0, 0.05, 0.01);
            cabGroup.add(kick);

            // Lower solid doors (Height 0.8m)
            const doorGeo = new THREE.BoxGeometry(0.58, 0.78, 0.04);
            // Left lower door
            const lowerDoorL = new THREE.Mesh(doorGeo, cabDoorMat);
            lowerDoorL.position.set(-0.3, 0.5, 0.25);
            cabGroup.add(lowerDoorL);
            // Right lower door
            const lowerDoorR = new THREE.Mesh(doorGeo, cabDoorMat);
            lowerDoorR.position.set(0.3, 0.5, 0.25);
            cabGroup.add(lowerDoorR);

            // Drawers (Middle section, Height 0.4m)
            const drawerGeo = new THREE.BoxGeometry(0.58, 0.18, 0.04);
            // Left drawers
            const drawerL1 = new THREE.Mesh(drawerGeo, cabDrawerMat);
            drawerL1.position.set(-0.3, 1.0, 0.25);
            cabGroup.add(drawerL1);
            const drawerL2 = new THREE.Mesh(drawerGeo, cabDrawerMat);
            drawerL2.position.set(-0.3, 1.2, 0.25);
            cabGroup.add(drawerL2);
            // Right drawers
            const drawerR1 = new THREE.Mesh(drawerGeo, cabDrawerMat);
            drawerR1.position.set(0.3, 1.0, 0.25);
            cabGroup.add(drawerR1);
            const drawerR2 = new THREE.Mesh(drawerGeo, cabDrawerMat);
            drawerR2.position.set(0.3, 1.2, 0.25);
            cabGroup.add(drawerR2);

            // Upper doors (Glass/Frosted, Height 1.0m)
            const upperFrameGeo = new THREE.BoxGeometry(0.58, 1.05, 0.04);
            const upperGlassGeo = new THREE.PlaneGeometry(0.46, 0.93);

            // Left Upper Door Frame
            const upperDoorL = new THREE.Mesh(upperFrameGeo, cabDoorMat);
            upperDoorL.position.set(-0.3, 1.85, 0.25);
            cabGroup.add(upperDoorL);
            // Left Upper Glass (Slightly in front of frame face)
            const glassL = new THREE.Mesh(upperGlassGeo, cabGlassMat);
            glassL.position.set(-0.3, 1.85, 0.271);
            cabGroup.add(glassL);

            // Right Upper Door Frame
            const upperDoorR = new THREE.Mesh(upperFrameGeo, cabDoorMat);
            upperDoorR.position.set(0.3, 1.85, 0.25);
            cabGroup.add(upperDoorR);
            // Right Upper Glass
            const glassR = new THREE.Mesh(upperGlassGeo, cabGlassMat);
            glassR.position.set(0.3, 1.85, 0.271);
            cabGroup.add(glassR);

            // Handles (Matte Grey)
            const handleGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.15, 8);

            // Lower handles
            const hLowL = new THREE.Mesh(handleGeo, cabHandleMat);
            hLowL.position.set(-0.05, 0.7, 0.28);
            cabGroup.add(hLowL);
            const hLowR = new THREE.Mesh(handleGeo, cabHandleMat);
            hLowR.position.set(0.05, 0.7, 0.28);
            cabGroup.add(hLowR);

            // Drawer handles
            const drawerHandleGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.2, 8);
            drawerHandleGeo.rotateZ(Math.PI / 2); // Horizontal
            [-0.3, 0.3].forEach(xOff => {
                [1.0, 1.2].forEach(yOff => {
                    const hDraw = new THREE.Mesh(drawerHandleGeo, cabHandleMat);
                    hDraw.position.set(xOff, yOff, 0.28);
                    cabGroup.add(hDraw);
                });
            });

            // Upper handles
            const hUpL = new THREE.Mesh(handleGeo, cabHandleMat);
            hUpL.position.set(-0.05, 1.5, 0.28);
            cabGroup.add(hUpL);
            const hUpR = new THREE.Mesh(handleGeo, cabHandleMat);
            hUpR.position.set(0.05, 1.5, 0.28);
            cabGroup.add(hUpR);

            return cabGroup;
        };

        // Place a row of cabinets along the East Wall (X = 7.5). Facing West (-X) so rotY = -Math.PI / 2
        // Wall is 10m long (-5 to 5 in Z).
        [-3.6, -2.4, -1.2, 0, 1.2, 2.4, 3.6].forEach(zPos => {
            const cab = createCabinet(7.25, zPos, -Math.PI / 2);
            eastDecorGroup.add(cab);
        });

        // Wall Decorations - Horizontal Stripes
        const stripeMaterial = new THREE.MeshStandardMaterial({ color: 0xe8eef2, roughness: 0.7 });
        const stripeHeight = 0.15;
        const stripeY = 1.2;

        // Stripe on North wall
        const stripeNorth = new THREE.Mesh(new THREE.PlaneGeometry(15, stripeHeight), stripeMaterial);
        stripeNorth.position.set(0, stripeY, 5.02);
        scene.add(stripeNorth);

        // Stripe on South wall
        const stripeSouth = new THREE.Mesh(new THREE.PlaneGeometry(15, stripeHeight), stripeMaterial);
        stripeSouth.position.set(0, stripeY, -5.02);
        stripeSouth.rotation.y = Math.PI;
        scene.add(stripeSouth);

        // --- South Wall Decorations ---
        const southDecorGroup = new THREE.Group();

        // Central panel (sleek medical display - powered off)
        const centerPanelGeo = new THREE.PlaneGeometry(2.5, 1.5);
        const centerPanelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.8 });
        const centerPanel = new THREE.Mesh(centerPanelGeo, centerPanelMat);
        centerPanel.position.set(0, 2.5, -4.96);
        southDecorGroup.add(centerPanel);

        // Accent light strip above display
        const lightStripGeo = new THREE.PlaneGeometry(2.5, 0.03);
        const lightStripMat = new THREE.MeshBasicMaterial({ color: 0x4a90e2 });
        const lightStrip = new THREE.Mesh(lightStripGeo, lightStripMat);
        lightStrip.position.set(0, 3.3, -4.96);
        southDecorGroup.add(lightStrip);

        // Vertical acoustic panels framing the display
        const acousticGeo = new THREE.PlaneGeometry(0.8, 2.5);
        const acousticMat = new THREE.MeshStandardMaterial({ color: 0xdde5ed, roughness: 0.9, metalness: 0.1 });

        const panelLeft = new THREE.Mesh(acousticGeo, acousticMat);
        panelLeft.position.set(-2.5, 2.5, -4.96);
        southDecorGroup.add(panelLeft);

        const panelRight = new THREE.Mesh(acousticGeo, acousticMat);
        panelRight.position.set(2.5, 2.5, -4.96);
        southDecorGroup.add(panelRight);

        // Add a small abstract art poster or signage placeholder on left wall
        const decorPosterGeo = new THREE.PlaneGeometry(1.2, 1.6);
        const decorPosterMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
        const decorPoster = new THREE.Mesh(decorPosterGeo, decorPosterMat);
        decorPoster.position.set(-5, 2.5, -4.96);

        // Poster accent frame
        const posterFrameGeo = new THREE.PlaneGeometry(1.24, 1.64);
        const posterFrameMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6 });
        const posterFrame = new THREE.Mesh(posterFrameGeo, posterFrameMat);
        posterFrame.position.set(-5, 2.5, -4.97);

        southDecorGroup.add(decorPoster);
        southDecorGroup.add(posterFrame);

        scene.add(southDecorGroup);


        // Stripe on East wall
        const stripeEast = new THREE.Mesh(new THREE.PlaneGeometry(10, stripeHeight), stripeMaterial);
        stripeEast.position.set(7.51, stripeY, 0);
        stripeEast.rotation.y = -Math.PI / 2;
        scene.add(stripeEast);

        // Stripe on West wall
        const stripeWest = new THREE.Mesh(new THREE.PlaneGeometry(10, stripeHeight), stripeMaterial);
        stripeWest.position.set(-7.51, stripeY, 0);
        stripeWest.rotation.y = Math.PI / 2;
        scene.add(stripeWest);

        // Medical Signage Placeholders (colored rectangles)
        const signMaterial = new THREE.MeshStandardMaterial({ color: 0x4a90e2, roughness: 0.3 });
        const signWidth = 0.8;
        const signHeight = 0.6;

        // Sign on North wall
        const signNorth = new THREE.Mesh(new THREE.PlaneGeometry(signWidth, signHeight), signMaterial);
        signNorth.position.set(-5, 2.2, 5.02);
        scene.add(signNorth);


        // Sign on East wall
        const signEast = new THREE.Mesh(new THREE.PlaneGeometry(signWidth, signHeight), signMaterial);
        signEast.position.set(7.52, 2.2, -5);
        signEast.rotation.y = -Math.PI / 2;
        scene.add(signEast);

        // Logo on North wall
        const textureLoader = new THREE.TextureLoader();
        textureLoader.load(
            '/qstssLogo.jpg',
            (texture) => {
                const logoMaterial = new THREE.MeshStandardMaterial({
                    map: texture,
                    transparent: true,
                    roughness: 0.5
                });

                // Logo facing outward (outside of room)
                const logoPlaneOut = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), logoMaterial);
                logoPlaneOut.position.set(4, 2, 5.04);
                scene.add(logoPlaneOut);

                // Logo facing inward (inside of room)
                const logoPlaneIn = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), logoMaterial.clone());
                logoPlaneIn.position.set(4, 2, 4.98);
                logoPlaneIn.rotation.y = Math.PI; // Rotate 180 degrees to face inward
                scene.add(logoPlaneIn);
            },
            undefined,
            () => {
                console.warn('Logo texture not found. Please add logo.png to the public folder.');
            }
        );

        // MOEHE Logo on North wall (inside, next to QSTSS logo)
        const textureLoader2 = new THREE.TextureLoader();
        textureLoader2.load(
            '/MOEHElogo.jpg',
            (texture) => {
                const moeheMaterial = new THREE.MeshStandardMaterial({
                    map: texture,
                    transparent: true,
                    roughness: 0.5
                });

                // Logo facing inward (inside of room)
                const moehePlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), moeheMaterial);
                moehePlane.position.set(0, 2, 4.98); // Positioned to the left of QSTSS logo
                moehePlane.rotation.y = Math.PI; // Rotate 180 degrees to face inward
                scene.add(moehePlane);
            },
            undefined,
            () => {
                console.warn('MOEHE logo texture not found.');
            }
        );

        // Warning Sign on North wall (inside, Left side)
        const textureLoader3 = new THREE.TextureLoader();
        textureLoader3.load(
            '/warningXray.png',
            (texture) => {
                const warnMaterial = new THREE.MeshStandardMaterial({
                    map: texture,
                    transparent: true,
                    roughness: 0.5
                });

                // Sign facing inward
                const warnPlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), warnMaterial);
                warnPlane.position.set(-4.5, 2, 4.98); // Positioned to the far left (Shifted 0.5m West)
                warnPlane.rotation.y = Math.PI; // Face inward
                scene.add(warnPlane);
            },
            undefined,
            () => {
                console.warn('Warning sign texture not found.');
            }
        );

        // Favicon above First Aid Box
        const textureLoader4 = new THREE.TextureLoader();
        textureLoader4.load(
            '/favicon.png',
            (texture) => {
                const favMaterial = new THREE.MeshStandardMaterial({
                    map: texture,
                    transparent: true,
                    roughness: 0.5
                });

                // Above First Aid Box (X=2, Y=1.5). Box Top ~1.7.
                // Place at Y=2.3 (Shifted 30cm up from 2.0)
                const favPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), favMaterial);
                favPlane.position.set(2, 2.3, 4.98);
                favPlane.rotation.y = Math.PI; // Face inward
                scene.add(favPlane);
            },
            undefined,
            () => {
                console.warn('Favicon texture not found.');
            }
        );




        // --- DEBUG MARKER ---
        const isoMarker = new THREE.Mesh(
            new THREE.SphereGeometry(0.05, 16, 16),
            new THREE.MeshBasicMaterial({ color: 0xff00ff })
        );
        isoMarker.position.copy(ISO_WORLD);
        scene.add(isoMarker);
        isoMarker.add(new THREE.AxesHelper(0.2));

        // --- VISUAL DEBUG HELPERS ---
        // 1. Ray Line (Source -> Detector) - Red
        const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]);
        const rayLine = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({ color: 0xff0000 }));
        rayLine.visible = false;
        scene.add(rayLine);

        // 2. Closest Point Marker (on Ray) - Yellow
        const closestPtMarker = new THREE.Mesh(
            new THREE.SphereGeometry(0.04, 16, 16),
            new THREE.MeshBasicMaterial({ color: 0xffff00 })
        );
        closestPtMarker.visible = false;
        scene.add(closestPtMarker);

        // 3. Connector Line (Iso -> Closest Point) - Green
        const connGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]);
        const connLine = new THREE.Line(connGeo, new THREE.LineBasicMaterial({ color: 0x00ff00 }));
        connLine.visible = false;
        scene.add(connLine);

        // --- DIFFDRR CT FRAME DEBUG HELPERS ---
        // CT Axes Helper mapped to CT Group
        const ctAxes = new THREE.AxesHelper(0.5);
        ctAxes.visible = false;
        ctAxesHelperRef.current = ctAxes;
        ctGroupRef.current.add(ctAxes);

        // CT Volume Bounds (Wireframe)
        const ctBoxGeo = new THREE.BoxGeometry(CT_SIZE_X_M, CT_SIZE_Y_M, CT_SIZE_Z_M);
        const ctBoxMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, wireframe: true, transparent: true, opacity: 0.3 });
        const ctBoxMesh = new THREE.Mesh(ctBoxGeo, ctBoxMat);
        ctBoxMesh.visible = false;
        ctBoxMeshRef.current = ctBoxMesh;
        ctGroupRef.current.add(ctBoxMesh);

        // CT Landmarks
        ctLandmarksGroupRef.current.visible = false;
        Object.entries(CT_LANDMARKS).forEach(([name, pt]) => {
            const sphere = new THREE.Mesh(
                new THREE.SphereGeometry(0.015, 8, 8),
                new THREE.MeshBasicMaterial({ color: 0x00ffaa, depthTest: false })
            );
            sphere.position.copy(pt);
            sphere.name = "landmark_" + name;
            ctLandmarksGroupRef.current.add(sphere);
        });
        ctGroupRef.current.add(ctLandmarksGroupRef.current);

        // Interactive CT target marker (millimetres converted to metres).
        const targetMarker = targetMarkerGroupRef.current;
        targetMarker.clear();
        const targetSphere = new THREE.Mesh(
            new THREE.SphereGeometry(0.012, 24, 24),
            new THREE.MeshBasicMaterial({ color: 0xff3344, depthTest: false })
        );
        const targetRing = new THREE.Mesh(
            new THREE.TorusGeometry(0.022, 0.0025, 12, 48),
            new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })
        );
        const targetRing2 = targetRing.clone();
        targetRing2.rotation.x = Math.PI / 2;
        targetMarker.add(targetSphere, targetRing, targetRing2);
        targetMarker.renderOrder = 999;
        targetMarker.position.set(
            Number(plannerTarget.x_mm) / 1000,
            Number(plannerTarget.y_mm) / 1000,
            Number(plannerTarget.z_mm) / 1000
        );
        ctGroupRef.current.add(targetMarker);

        // Beam Center Line (Source to Detector directly)
        const beamLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        const beamLineMat = new THREE.LineBasicMaterial({ color: 0xff8800, linewidth: 2 });
        const beamLineMesh = new THREE.Line(beamLineGeo, beamLineMat);
        beamLineMesh.visible = false;
        beamLineRef.current = beamLineMesh;
        scene.add(beamLineMesh);

        // Beam Entry/Exit Markers (CT Box Intersections)
        const entryMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, depthTest: false }); // Entry: Green
        const exitMat = new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false }); // Exit: Red
        const entrySphere = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 8), entryMat);
        const exitSphere = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 8), exitMat);
        entrySphere.name = "entry"; exitSphere.name = "exit";
        beamIntersectGroupRef.current.add(entrySphere);
        beamIntersectGroupRef.current.add(exitSphere);
        beamIntersectGroupRef.current.visible = false;
        scene.add(beamIntersectGroupRef.current);

        // --- ANATOMICAL LANDMARK OVERLAY (L key) ---
        // Keep the old skeleton debug ref empty so the physics/debug update loop
        // cannot recreate the generic pose-estimation landmarks.
        const skelGroup = new THREE.Group();
        skelGroup.visible = false;
        scene.add(skelGroup);
        skeletonDebugRef.current = skelGroup;

        // Render the exact 17 CT landmarks configured above. Because this group
        // is parented to ctGroup, the markers stay registered to the CT/patient.
        const anatomyGroup = anatomicalLandmarksGroupRef.current;
        anatomyGroup.clear();
        anatomyGroup.name = 'configured_anatomical_landmarks';
        anatomyGroup.visible = true;

        // Small numbered red discs, matching the reference body-map style.
        const makeLandmarkNumber = (number) => {
            const canvas = document.createElement('canvas');
            const size = 96;
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');

            ctx.clearRect(0, 0, size, size);
            ctx.beginPath();
            ctx.arc(size / 2, size / 2, 40, 0, Math.PI * 2);
            ctx.fillStyle = '#ff2b16';
            ctx.fill();
            ctx.lineWidth = 5;
            ctx.strokeStyle = '#8b1208';
            ctx.stroke();

            ctx.fillStyle = '#111111';
            ctx.font = '900 42px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(number), size / 2, size / 2 + 2);

            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.minFilter = THREE.LinearFilter;
            const material = new THREE.SpriteMaterial({
                map: texture,
                transparent: true,
                depthTest: false,
                depthWrite: false
            });
            const sprite = new THREE.Sprite(material);
            sprite.scale.set(0.047, 0.047, 1);
            sprite.renderOrder = 1002;
            sprite.layers.set(1);
            return sprite;
        };

        const landmarkItems = Object.entries(ANATOMICAL_TARGETS)
            .filter(([key, item]) => key !== 'MANUAL' && item.id !== null)
            .sort(([, a], [, b]) => a.id - b.id);

        const landmarkPositionById = new Map();
        landmarkItems.forEach(([, item]) => {
            landmarkPositionById.set(
                item.id,
                new THREE.Vector3(item.x_mm / 1000, item.y_mm / 1000, item.z_mm / 1000 + 0.006)
            );
        });

        // Yellow stick-figure connections used by the original landmark map.
        const edgePoints = [];
        LANDMARK_EDGE_IDS.forEach(([fromId, toId]) => {
            const from = landmarkPositionById.get(fromId);
            const to = landmarkPositionById.get(toId);
            if (from && to) edgePoints.push(from.clone(), to.clone());
        });

        const edgeGeometry = new THREE.BufferGeometry().setFromPoints(edgePoints);
        const edgeMaterial = new THREE.LineBasicMaterial({
            color: 0xffeb00,
            transparent: true,
            opacity: 0.98,
            depthTest: false,
            depthWrite: false
        });
        const skeletonLines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
        skeletonLines.name = 'anatomical_landmark_connections';
        skeletonLines.renderOrder = 1000;
        skeletonLines.layers.set(1);
        anatomyGroup.add(skeletonLines);

        landmarkItems.forEach(([, item]) => {
            const markerGroup = new THREE.Group();
            markerGroup.name = `anatomical_landmark_${item.id}`;
            markerGroup.position.copy(landmarkPositionById.get(item.id));
            markerGroup.layers.set(1);

            const numberMarker = makeLandmarkNumber(item.id);
            numberMarker.name = `${item.id}: ${item.shortLabel}`;
            markerGroup.add(numberMarker);
            anatomyGroup.add(markerGroup);
        });

        ctGroupRef.current.add(anatomyGroup);

        // --- MATERIALS ---
        const matWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
        const matOrange = new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.2 });
        const matDark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
        const matSteel = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.3, metalness: 0.6 });
        const matBlue = new THREE.MeshStandardMaterial({ color: 0x0077ff, emissive: 0x0022aa, emissiveIntensity: 0.5 });

        // --- BED ---
        const bedGroup = new THREE.Group();
        scene.add(bedGroup);

        const tableTop = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.05, 2.0, 4, 0.01), matBlue);
        tableTop.position.y = 1.35;
        tableTop.receiveShadow = true;
        bedGroup.add(tableTop);

        const legGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.35, 16);
        [{ x: 0.25, z: 0.9 }, { x: -0.25, z: 0.9 }, { x: 0.25, z: -0.9 }, { x: -0.25, z: -0.9 }].forEach(pos => {
            const leg = new THREE.Mesh(legGeo, matSteel);
            leg.position.set(pos.x, 0.675, pos.z);
            leg.castShadow = true;
            bedGroup.add(leg);
        });

        // Force Initial Render to prevent black screen if models fail
        renderer.render(scene, camera);
        hasRenderedInitialRef.current = true;

        // --- CEILING ---
        const ceilingGroup = new THREE.Group();
        ceilingGroup.position.set(0, wallHeight, 0); // Cap the room
        scene.add(ceilingGroup);

        // Main Ceiling Plane
        const ceilingMaterial = new THREE.MeshStandardMaterial({
            color: 0xfdfbf7, // Off-white/Cream
            roughness: 0.9,
            side: THREE.DoubleSide
        });
        const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(15, 10), ceilingMaterial);
        ceiling.rotation.x = Math.PI / 2; // Face down
        ceiling.receiveShadow = true;
        ceilingGroup.add(ceiling);

        // Light Panels
        const lightPanelGeo = new THREE.PlaneGeometry(1.2, 0.6);
        const lightPanelMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xffffee,
            emissiveIntensity: 0.8,
            roughness: 0.2
        });

        // Add 2 rows of lights
        for (let x = -6; x <= 6; x += 3) {
            for (let z = -3.5; z <= 3.5; z += 3.5) {
                const panel = new THREE.Mesh(lightPanelGeo, lightPanelMat);
                panel.rotation.x = Math.PI / 2;
                panel.position.set(x, -0.01, z); // Slightly below ceiling
                ceilingGroup.add(panel);
            }
        }

        // --- LOAD MODELS (Promise-based) ---
        const loader = new GLTFLoader();
        // Register extension if available (it's not in v0.182, but good practice to check/try)
        // Since we removed it from extensionsRequired, it should load with fallback materials.

        const loadModel = (url) => new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));

        Promise.allSettled([
            loadModel(PATIENT_URL),
            loadModel(realsense_URL),
            loadModel('/fire_extinguisher/scene.gltf'),
            loadModel('/first_aid_box/scene.gltf'),
            loadModel('/female_human_skeleton_-_zbrush_-_anatomy_study/scene.gltf')
        ]).then((results) => {
            if (!mounted) return;

            // Helper to get result or null
            const getModel = (index) => results[index].status === 'fulfilled' ? results[index].value : null;

            // 1. Patient
            const patientGltf = getModel(0);
            if (patientGltf) {
                const patientModel = patientGltf.scene;
                // Capture Local Bounds (before transform)
                const patientBox = new THREE.Box3().setFromObject(patientModel);
                patientBoundsRef.current = {
                    ready: true,
                    minX: patientBox.min.x, maxX: patientBox.max.x,
                    minY: patientBox.min.y, maxY: patientBox.max.y,
                    minZ: patientBox.min.z, maxZ: patientBox.max.z
                };
                patientModelRef.current = patientModel;

                const patientSize = new THREE.Vector3();
                patientBox.getSize(patientSize);
                const maxDimP = Math.max(patientSize.x, patientSize.y, patientSize.z);
                if (maxDimP > 0) {
                    const scale = 1.7 / maxDimP;
                    patientModel.scale.set(scale, scale, scale);
                }
                patientModel.rotation.set(-Math.PI / 2, 0, Math.PI);
                patientModel.position.set(0, 1.50, 0.0);
                patientModel.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
                bedGroup.add(patientModel);

                // Align the explicit CT Group exactly with the patient model
                if (ctGroupRef.current) {
                    const ctGroup = ctGroupRef.current;
                    ctGroup.position.copy(patientModel.position);
                    ctGroup.quaternion.copy(patientModel.quaternion);
                    ctGroup.scale.set(1, 1, 1); // rigid scale only for export mapping
                    bedGroup.add(ctGroup);
                    ctGroup.updateMatrixWorld(true);
                }
            } else {
                console.warn("Patient model failed to load:", results[0].reason);
            }

            // 2. Realsense
            const rsGltf = getModel(1);
            if (rsGltf) {
                const rsModel = rsGltf.scene;
                const rsBox = new THREE.Box3().setFromObject(rsModel);
                const rsSize = new THREE.Vector3();
                rsBox.getSize(rsSize);
                const maxDimR = Math.max(rsSize.x, rsSize.y, rsSize.z);
                if (maxDimR > 0) {
                    const scale = 0.15 / maxDimR;
                    rsModel.scale.set(scale, scale, scale);
                } else {
                    rsModel.scale.set(0.15, 0.15, 0.15);
                }

                // Attach directly to C-Arm Slide (Orbital Frame) so it moves with it
                // Local Position on the Arc (Near Detector)
                // Detector is at Y ~= 0.8 (cRadius). 
                // We place Camera slightly offset.
                if (cArmSlideRef.current) {
                    cArmSlideRef.current.add(rsModel);
                    // Local Coords relative to C-Slide center
                    rsModel.position.set(0.1, 0.95, 0.0);
                    rsModel.rotation.set(Math.PI / 2, 0, Math.PI);
                } else {
                    scene.add(rsModel); // Fallback
                }
                rsModel.updateMatrixWorld(true);
                rsModel.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
                // Store realsense model reference
                realsenseModelRef.current = rsModel;
            }

            // 3. Fire Extinguisher
            const fireGltf = getModel(2);
            if (fireGltf) {
                const fireModel = fireGltf.scene;
                const fireBox = new THREE.Box3().setFromObject(fireModel);
                const fireSize = new THREE.Vector3();
                fireBox.getSize(fireSize);
                const maxDimF = Math.max(fireSize.x, fireSize.y, fireSize.z);
                if (maxDimF > 0) {
                    const scale = 0.5 / maxDimF; // 50cm tall approx
                    fireModel.scale.set(scale, scale, scale);
                }
                // Reposition below First Aid Box
                fireModel.position.set(2, 1.0, 4.95);
                fireModel.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
                scene.add(fireModel);
            }

            // 4. First Aid Box
            const aidGltf = getModel(3);
            if (aidGltf) {
                const aidModel = aidGltf.scene;
                const aidBox = new THREE.Box3().setFromObject(aidModel);
                const aidSize = new THREE.Vector3();
                aidBox.getSize(aidSize);
                const maxDimA = Math.max(aidSize.x, aidSize.y, aidSize.z);
                if (maxDimA > 0) {
                    const scale = 0.4 / maxDimA; // 40cm box
                    aidModel.scale.set(scale, scale, scale);
                }
                // Midpoint between QSTSS (X=4) and MOEHE (X=0) -> X=2
                // Height Y=1.5 (Middle of wall area), Z=10m room
                aidModel.position.set(2, 1.5, 4.95);
                aidModel.rotation.y = Math.PI; // Face room
                aidModel.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
                scene.add(aidModel);
            }

            // 5. Female Skeleton
            const femSkelGltf = getModel(4);
            if (femSkelGltf) {
                const skelModel = femSkelGltf.scene;
                const skelBox = new THREE.Box3().setFromObject(skelModel);
                const skelSize = new THREE.Vector3();
                skelBox.getSize(skelSize);
                const maxDimS = skelSize.y; // Height is main dimension
                if (maxDimS > 0) {
                    const scale = 1.7 / maxDimS; // 1.7m tall
                    skelModel.scale.set(scale, scale, scale);
                }
                // Midpoint between First Aid (X=2) and MOEHE (X=0) -> X=1
                // Moved Up 1m (Y=1) and Left 3.5m (X = 1 - 3.5 = -2.5)
                skelModel.position.set(-2.5, 1.0, 4.95);
                skelModel.rotation.y = Math.PI; // Face room
                skelModel.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
                scene.add(skelModel);
            } else {
                console.warn("Skeleton model failed to load (likely missing extension support):", results[4].reason);
            }
        });

        // --- ROBOT CART (Procedural) ---
        const cartRoot = new THREE.Group();
        cartRoot.position.set(1.5, 0, 0);
        cartRoot.rotation.y = -Math.PI / 2;
        scene.add(cartRoot);
        cartRef.current = cartRoot;

        const chassis = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.5, 1.1, 4, 0.05), matWhite);
        chassis.position.y = 0.35;
        chassis.castShadow = true;
        cartRoot.add(chassis);
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.02, 1.12), matOrange);
        stripe.position.y = 0.6;
        cartRoot.add(stripe);
        // Using Sphere for wheels instead of Cylinder
        [{ x: 0.35, z: 0.35 }, { x: -0.35, z: 0.35 }, { x: 0.35, z: -0.35 }, { x: -0.35, z: -0.35 }].forEach(pos => {
            const cover = new THREE.Mesh(new THREE.SphereGeometry(0.16, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), matWhite);
            cover.position.set(pos.x, 0.15, pos.z);
            cartRoot.add(cover);
        });

        // --- KINEMATICS (Procedural) ---
        const colBaseGroup = new THREE.Group();
        colBaseGroup.position.set(0, 0.6, 0.45);
        cartRoot.add(colBaseGroup);

        const colRotGroup = new THREE.Group();
        colBaseGroup.add(colRotGroup);
        columnRotRef.current = colRotGroup;

        const columnMesh = new THREE.Mesh(new RoundedBoxGeometry(0.25, 1.15, 0.25, 4, 0.02), matWhite);
        columnMesh.position.y = 0.575;
        colRotGroup.add(columnMesh);

        const liftGroup = new THREE.Group();
        colRotGroup.add(liftGroup);
        liftRef.current = liftGroup;

        const shoulderGroup = new THREE.Group();
        shoulderGroup.position.z = 0.2;
        liftGroup.add(shoulderGroup);
        const holderBlock = new THREE.Mesh(new RoundedBoxGeometry(0.35, 0.4, 0.4, 4, 0.05), matWhite);
        holderBlock.castShadow = true;
        shoulderGroup.add(holderBlock);

        const wigWagGroup = new THREE.Group();
        wigWagGroup.position.z = 0.25;
        shoulderGroup.add(wigWagGroup);
        wigWagRef.current = wigWagGroup;

        const cRadius = 0.8;
        const cSlideGroup = new THREE.Group();
        cSlideGroup.position.set(0, 0, cRadius);
        wigWagGroup.add(cSlideGroup);
        cArmSlideRef.current = cSlideGroup;

        const torusGeo = new THREE.TorusGeometry(cRadius, 0.12, 16, 100, Math.PI);
        const cArmMesh = new THREE.Mesh(torusGeo, matWhite);
        cArmMesh.rotation.y = Math.PI / 2;
        cArmMesh.scale.z = 0.4;
        cArmMesh.rotation.z = -Math.PI / 2;
        cArmMesh.castShadow = true;
        cSlideGroup.add(cArmMesh);

        const strip = new THREE.Mesh(new THREE.TorusGeometry(cRadius, 0.125, 4, 100, Math.PI), matBlue);
        strip.rotation.y = Math.PI / 2;
        strip.scale.z = 0.1;
        strip.rotation.z = -Math.PI / 2;
        cSlideGroup.add(strip);

        // --- DETECTOR ---
        const detGroup = new THREE.Group();
        detGroup.position.set(0, cRadius, 0);
        cSlideGroup.add(detGroup);

        const detHousing = new THREE.Group();
        detHousing.rotation.set(Math.PI, 0, 0);
        detGroup.add(detHousing);

        const detNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.05, 32), matWhite);
        detNeck.position.y = 0.025;
        detHousing.add(detNeck);
        const detCollar = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.02, 16, 32), matWhite);
        detCollar.rotation.x = Math.PI / 2;
        detCollar.position.y = 0.0;
        detHousing.add(detCollar);
        const detBody = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.25, 32), matWhite);
        detBody.position.y = 0.175;
        detHousing.add(detBody);
        const detBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 32), matWhite);
        detBrim.position.y = 0.10;
        detHousing.add(detBrim);
        const detFace = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.01, 32), new THREE.MeshStandardMaterial({ color: 0x111111 }));
        detFace.position.y = 0.30;
        detHousing.add(detFace);

        // DETECTOR ANCHOR
        const detAnchor = detAnchorRef.current;
        detAnchor.position.y = 0.3;
        detHousing.add(detAnchor);

        // --- SOURCE ---
        const srcGroup = new THREE.Group();
        srcGroup.position.set(0, -cRadius, 0);
        cSlideGroup.add(srcGroup);

        const srcHousing = new THREE.Group();
        srcGroup.add(srcHousing);

        const srcCap = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.05, 0.36, 2, 0.01), matWhite);
        srcCap.position.y = 0.025;
        srcHousing.add(srcCap);
        const srcBox = new THREE.Mesh(new RoundedBoxGeometry(0.35, 0.4, 0.4, 4, 0.05), matWhite);
        srcBox.position.y = 0.05;
        srcHousing.add(srcBox);
        const coll = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.02, 0.15), matDark);
        coll.position.y = 0.26;
        srcHousing.add(coll);

        // SOURCE ANCHOR
        const srcAnchor = srcAnchorRef.current;
        srcAnchor.position.y = 0.26;
        srcHousing.add(srcAnchor);

        // BEAM PHYSICS
        // Create frustum: Source at y=0 (bottom), Detector at y=1 (top)
        // RadiusTop = 1 (Detector end), RadiusBottom = 0.05 (Source end).
        const beamGeo = new THREE.CylinderGeometry(1, 0.05, 1, 4, 1, true);
        beamGeo.translate(0, 0.5, 0); // Shift so bottom (Source) is at 0, top (Detector) is at 1
        beamGeo.rotateY(Math.PI / 4); // Align square profile to axes

        const beamMat = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false });
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.visible = false; // Start hidden

        // Attach to scene root to avoid parent transform issues (we will position/orient in world space)
        scene.add(beam);
        beamRef.current = beam;

        // --- DEPTH RENDERING SETUP ---
        // Depth Render Target (Depth Capture)
        const depthRenderTarget = new THREE.WebGLRenderTarget(512, 512); // Higher res + scaling
        depthRenderTarget.depthTexture = new THREE.DepthTexture();
        depthRenderTarget.depthTexture.type = THREE.UnsignedShortType; // Standard depth
        depthRenderTargetRef.current = depthRenderTarget;

        // Depth Visualization Setup (Quad + Shader) to convert depth to grayscale
        const depthVizScene = new THREE.Scene();
        // Ortho camera for full screen quad
        const depthVizMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tDepth: { value: depthRenderTarget.depthTexture },
                cameraNear: { value: 0.1 },
                cameraFar: { value: 2.5 }
            },
            vertexShader: `
                 varying vec2 vUv;
                 void main() {
                     vUv = uv;
                     gl_Position = vec4(position, 1.0);
                 }
             `,
            fragmentShader: `
                 #include <packing>
                 varying vec2 vUv;
                 uniform sampler2D tDepth;
                 uniform float cameraNear;
                 uniform float cameraFar;

                 float readDepth( sampler2D depthSampler, vec2 coord ) {
                     float fragCoordZ = texture2D( depthSampler, coord ).x;
                     float viewZ = perspectiveDepthToViewZ( fragCoordZ, cameraNear, cameraFar );
                     return viewZToOrthographicDepth( viewZ, cameraNear, cameraFar );
                 }
                 
                 void main() {
                     // Get linearized depth (0 = near, 1 = far)
                     float depth = readDepth( tDepth, vUv );
                     
                     // Invert so Near is White, Far is Black
                     float val = 1.0 - depth; 
                     
                     // Increase Contrast using Power Curve
                     val = pow(val, 3.0);

                     gl_FragColor = vec4( vec3( val ), 1.0 );
                 }
             `
        });
        const depthVizQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), depthVizMaterial);
        depthVizScene.add(depthVizQuad);
        depthVizSceneRef.current = depthVizScene;
        depthVizQuadRef.current = depthVizQuad;

        // Target to render the visualization into (RGBA)
        const depthVizTarget = new THREE.WebGLRenderTarget(256, 256);
        depthVizTargetRef.current = depthVizTarget;

        const depthCamera = new THREE.PerspectiveCamera(58, 1, 0.1, 2.5);
        depthCameraRef.current = depthCamera;

        // DEBUG: Add CameraHelper to visualize orientation
        const helper = new THREE.CameraHelper(depthCamera);
        scene.add(helper);
        depthCameraHelperRef.current = helper;

        // Vectors (Allocated ONCE)
        const v1 = new THREE.Vector3();
        const v2 = new THREE.Vector3();
        const vSeg = new THREE.Vector3(); // Scratch AB
        const vecToI = new THREE.Vector3(); // Scratch AP
        const closestPoint = new THREE.Vector3(); // Clamped result
        const tempVec = new THREE.Vector3(); // Unclamped result / Midpoint scratch
        const dir = new THREE.Vector3(); // Beam direction scratch
        const yAxis = new THREE.Vector3(0, 1, 0); // Reference UP for beam
        const beamAxisWorld = new THREE.Vector3(); // For debug check


        // --- NEW PRE-ALLOCATIONS FOR ROBUST ZONING ---
        // (Moved to top-level computeBeamClassification)

        let reqId;
        const animate = () => {
            reqId = requestAnimationFrame(animate);

            try {
                orbit.update();

                // PHYSICS LOOP
                if (srcAnchorRef.current && detAnchorRef.current && beamRef.current) {
                    srcAnchorRef.current.getWorldPosition(v1);
                    detAnchorRef.current.getWorldPosition(v2);
                    const distance = v1.distanceTo(v2);

                    // Beam Logic (World Space Alignment)
                    dir.subVectors(v2, v1);
                    const sid = dir.length();
                    dir.normalize();

                    beamRef.current.visible = beamActiveRef.current;
                    beamRef.current.position.copy(v1);
                    beamRef.current.quaternion.setFromUnitVectors(yAxis, dir);
                    beamRef.current.scale.set(0.2, sid, 0.2);

                    // --- DIFFDRR CT FRAME VISUAL UPDATES ---
                    if (ctAxesHelperRef.current) ctAxesHelperRef.current.visible = debugEnabledRef.current && showCtAxesRef.current;
                    if (ctBoxMeshRef.current) ctBoxMeshRef.current.visible = debugEnabledRef.current && showCtBoxRef.current;
                    if (ctLandmarksGroupRef.current) ctLandmarksGroupRef.current.visible = debugEnabledRef.current && showCtLandmarksRef.current;

                    let ctHitEntryLocalText = "N/A";
                    let ctHitExitLocalText = "N/A";
                    let ctHitStatus = "NO";

                    if (beamLineRef.current) {
                        beamLineRef.current.visible = debugEnabledRef.current && showBeamLineRef.current;
                        if (beamLineRef.current.visible) {
                            const positions = beamLineRef.current.geometry.attributes.position.array;
                            v1.toArray(positions, 0);
                            v2.toArray(positions, 3);
                            beamLineRef.current.geometry.attributes.position.needsUpdate = true;
                        }
                    }

                    if (beamIntersectGroupRef.current && ctGroupRef.current) {
                        beamIntersectGroupRef.current.visible = debugEnabledRef.current && showBeamIntersectRef.current;

                        // We must always calculate strings for UI even if markers are hidden
                        ctGroupRef.current.updateMatrixWorld(true);

                        const ctLocalV1 = v1.clone();
                        ctGroupRef.current.worldToLocal(ctLocalV1);

                        const ctLocalV2 = v2.clone();
                        ctGroupRef.current.worldToLocal(ctLocalV2);

                        const ctLocalDir = new THREE.Vector3().subVectors(ctLocalV2, ctLocalV1);
                        const ctLocalSid = ctLocalDir.length();
                        ctLocalDir.normalize();

                        const ctRayLocal = new THREE.Ray(ctLocalV1, ctLocalDir);
                        const halfX = CT_SIZE_X_M / 2.0;
                        const halfY = CT_SIZE_Y_M / 2.0;
                        const halfZ = CT_SIZE_Z_M / 2.0;
                        const ctLocalBox = new THREE.Box3(
                            new THREE.Vector3(-halfX, -halfY, -halfZ),
                            new THREE.Vector3(halfX, halfY, halfZ)
                        );

                        const ctHitEntryLocal = new THREE.Vector3();
                        const hitResult = ctRayLocal.intersectBox(ctLocalBox, ctHitEntryLocal);

                        const entrySphere = beamIntersectGroupRef.current.children.find(c => c.name === 'entry');
                        const exitSphere = beamIntersectGroupRef.current.children.find(c => c.name === 'exit');

                        if (hitResult && ctHitEntryLocal.distanceTo(ctLocalV1) <= ctLocalSid) {
                            ctHitStatus = "YES";
                            ctHitEntryLocalText = ctHitEntryLocal.toArray().map(n => n.toFixed(3)).join(", ");

                            const ctHitExitLocal = new THREE.Vector3();
                            const ctRayLocalReverse = new THREE.Ray(ctLocalV2, ctLocalDir.clone().negate());
                            const hitExitResult = ctRayLocalReverse.intersectBox(ctLocalBox, ctHitExitLocal);
                            if (!hitExitResult) ctHitExitLocal.copy(ctHitEntryLocal);

                            ctHitExitLocalText = ctHitExitLocal.toArray().map(n => n.toFixed(3)).join(", ");

                            if (beamIntersectGroupRef.current.visible) {
                                const wEntry = ctHitEntryLocal.clone();
                                ctGroupRef.current.localToWorld(wEntry);
                                entrySphere.position.copy(wEntry);
                                entrySphere.visible = true;

                                const wExit = ctHitExitLocal.clone();
                                ctGroupRef.current.localToWorld(wExit);
                                exitSphere.position.copy(wExit);
                                exitSphere.visible = true;
                            }
                        } else {
                            if (entrySphere) entrySphere.visible = false;
                            if (exitSphere) exitSphere.visible = false;
                        }
                    }


                    // --- DEBUG UPDATE ---
                    if (debugEnabledRef.current) {
                        if (isoMarker) isoMarker.visible = true;
                        rayLine.visible = true;
                        closestPtMarker.visible = true;
                        connLine.visible = true;
                        if (floorLabelsRef.current) floorLabelsRef.current.visible = true;

                        // Update Ray Line
                        const positions = rayLine.geometry.attributes.position.array;
                        v1.toArray(positions, 0);
                        v2.toArray(positions, 3);
                        rayLine.geometry.attributes.position.needsUpdate = true;

                        // Calc Geometry
                        const t = projectPointToLineParamsInto(ISO_WORLD, v1, v2, tempVec, vSeg, vecToI);
                        const tClamped = Math.max(0, Math.min(1, t));
                        closestPoint.copy(v1).addScaledVector(vSeg, tClamped);
                        closestPtMarker.position.copy(closestPoint);

                        // Update Connector
                        const connPos = connLine.geometry.attributes.position.array;
                        ISO_WORLD.toArray(connPos, 0);
                        closestPoint.toArray(connPos, 3);
                        connLine.geometry.attributes.position.needsUpdate = true;
                    } else {
                        if (isoMarker) isoMarker.visible = false;
                        rayLine.visible = false;
                        closestPtMarker.visible = false;
                        connLine.visible = false;
                        if (floorLabelsRef.current) floorLabelsRef.current.visible = false;
                    }

                    const now = performance.now();
                    if (now - lastDebugUpdateRef.current > 100) { // 10Hz
                        lastDebugUpdateRef.current = now;

                        // --- 1. ALWAYS COMPUTE BEAM REGION (Physics) ---
                        const classification = computeBeamClassification(
                            v1,
                            v2,
                            patientModelRef.current,
                            patientBoundsRef.current
                        );
                        const bounds = patientBoundsRef.current; // Needed for visuals later

                        // Update Refs & UI
                        beamZoneKeyRef.current = classification.zoneKey;
                        beamRegionRef.current = classification.zoneLabel;
                        beamHitRef.current = classification.hit;
                        beamNormYRef.current = classification.normInfo;

                        setBeamRegionUI(classification.zoneLabel);
                        setBeamZoneKeyUI(classification.zoneKey);

                        // --- UPDATE SKELETON DEBUG VISUALS (Always update for Depth View) ---
                        if (skeletonDebugRef.current) {
                            // Globally visible, filtered by Camera Layers
                            skeletonDebugRef.current.visible = true;

                            if (patientModelRef.current && bounds.ready) {
                                // Re-compute corrected nodes
                                const axes = getInferredPatientAxes(bounds);
                                const localLandmarks = {};
                                Object.keys(LANDMARKS_NORM).forEach(key => {
                                    localLandmarks[key] = landmarkLocal(key, bounds, axes);
                                });

                                // Render Spheres
                                // Render Debug Objects
                                skeletonDebugRef.current.children.forEach(child => {
                                    // 1. Is it a Landmark?
                                    const local = localLandmarks[child.name];
                                    if (local) {
                                        child.visible = true;
                                        const world = local.clone().applyMatrix4(patientModelRef.current.matrixWorld);
                                        child.position.copy(world);
                                    } else {
                                        // 2. Is it an Edge?
                                        const edge = EDGES.find(e => e.join('-') === child.name);
                                        if (edge) {
                                            const startLocal = localLandmarks[edge[0]];
                                            const endLocal = localLandmarks[edge[1]];

                                            if (startLocal && endLocal) {
                                                child.visible = true;
                                                const pos = child.geometry.attributes.position.array;

                                                // Transform to World
                                                const startWorld = startLocal.clone().applyMatrix4(patientModelRef.current.matrixWorld);
                                                const endWorld = endLocal.clone().applyMatrix4(patientModelRef.current.matrixWorld);

                                                startWorld.toArray(pos, 0);
                                                endWorld.toArray(pos, 3);
                                                child.geometry.attributes.position.needsUpdate = true;
                                            } else {
                                                child.visible = false;
                                            }
                                        } else {
                                            // Neither landmark nor edge
                                            child.visible = false;
                                        }
                                    }
                                });
                            }
                        }

                        // --- 2. DEBUG READOUT ---
                        if (debugEnabledRef.current) {
                            projectPointToLineParamsInto(ISO_WORLD, v1, v2, tempVec, vSeg, vecToI);
                            const isoRayDist = ISO_WORLD.distanceTo(tempVec);
                            const t = projectPointToLineParamsInto(ISO_WORLD, v1, v2, tempVec, vSeg, vecToI);
                            closestPoint.copy(v1).addScaledVector(vSeg, Math.max(0, Math.min(1, t)));
                            const isoSegDist = ISO_WORLD.distanceTo(closestPoint);

                            tempVec.addVectors(v1, v2).multiplyScalar(0.5);
                            const midToIso = tempVec.distanceTo(ISO_WORLD);

                            beamRef.current.updateMatrixWorld();
                            beamAxisWorld.copy(yAxis).applyQuaternion(beamRef.current.quaternion);
                            const angleDeg = beamAxisWorld.angleTo(dir) * 180 / Math.PI;

                            tempVec.set(0, 1, 0).applyMatrix4(beamRef.current.matrixWorld);
                            const beamBaseErr = tempVec.distanceTo(v2);

                            // T_cam_to_CT calculation for debug panel (MATCH EXPORTER)
                            const T_CT_to_world_dbg = ctGroupRef.current ? ctGroupRef.current.matrixWorld.clone() : new THREE.Matrix4().identity();
                            const T_world_to_CT_dbg = T_CT_to_world_dbg.clone().invert();

                            // Use WORLD quaternion for detector anchor (not local)
                            const detQuatW = new THREE.Quaternion();
                            detAnchorRef.current.getWorldQuaternion(detQuatW);

                            // Camera basis
                            const Z_c = new THREE.Vector3().subVectors(v2, v1).normalize(); // src->det (forward)
                            let X_det = new THREE.Vector3(1, 0, 0).applyQuaternion(detQuatW).normalize();

                            // Project X onto plane orthogonal to Z
                            const projX = Z_c.clone().multiplyScalar(X_det.dot(Z_c));
                            let X_c = new THREE.Vector3().subVectors(X_det, projX).normalize();

                            // Y = Z x X, then re-orthonormalize X = Y x Z
                            let Y_c = new THREE.Vector3().crossVectors(Z_c, X_c).normalize();
                            X_c = new THREE.Vector3().crossVectors(Y_c, Z_c).normalize();

                            // Enforce Y down
                            const up = new THREE.Vector3(0, 1, 0);
                            if (Y_c.dot(up) > 0) { X_c.negate(); Y_c.negate(); }

                            const T_cam2world_dbg = new THREE.Matrix4().makeBasis(X_c, Y_c, Z_c);
                            T_cam2world_dbg.setPosition(v1);

                            const T_cam_to_CT_debug = new THREE.Matrix4().multiplyMatrices(T_world_to_CT_dbg, T_cam2world_dbg);

                            const camPosCT = new THREE.Vector3().setFromMatrixPosition(T_cam_to_CT_debug);
                            const camEulerCT = new THREE.Euler().setFromRotationMatrix(T_cam_to_CT_debug);

                            const ctOriginWorld = new THREE.Vector3().setFromMatrixPosition(T_CT_to_world_dbg);
                            const ctDet = T_CT_to_world_dbg.determinant();

                            setDebugReadout({
                                src: v1.toArray().map(n => n.toFixed(3)),
                                det: v2.toArray().map(n => n.toFixed(3)),
                                sid: distance.toFixed(3),
                                midToIso: midToIso.toFixed(3),
                                isoRay: isoRayDist.toFixed(3),
                                isoSeg: isoSegDist.toFixed(3),
                                t: t.toFixed(3),
                                beamAngle: angleDeg.toFixed(3),
                                beamErr: beamBaseErr.toFixed(3),
                                beamRegion: classification.zoneLabel,
                                hitStatus: classification.hit ? "HIT" : "MISS",
                                normY: beamNormYRef.current || "NA",
                                ctOriginWorld: ctOriginWorld.toArray().map(n => n.toFixed(3)),
                                ctDet: ctDet.toFixed(3),
                                camPosCT: camPosCT.toArray().map(n => n.toFixed(3)),
                                camEulerCT: [camEulerCT.x, camEulerCT.y, camEulerCT.z].map(n => (n * 180 / Math.PI).toFixed(1)),
                                ctHitStatus: ctHitStatus,
                                ctHitEntry: ctHitEntryLocalText,
                                ctHitExit: ctHitExitLocalText
                            });
                        }
                    }
                } // End physics loop

                // --- DEPTH RENDERING ---
                // --- DEPTH RENDERING (DEBUG MODE: MANUAL CONTROL) ---
                if (detAnchorRef.current && srcAnchorRef.current && depthCameraRef.current && depthRenderTargetRef.current) {
                    detAnchorRef.current.updateMatrixWorld(true);
                    srcAnchorRef.current.updateMatrixWorld(true);

                    // Base position: Detector
                    detAnchorRef.current.getWorldPosition(v1); // Detector pos
                    srcAnchorRef.current.getWorldPosition(v2); // Source pos

                    // Calculate Beam Direction (Detector -> Source)
                    dir.subVectors(v2, v1).normalize();

                    // World Space Offsets Relative to Detector

                    // 1. Reset to Detector Position & Orientation
                    detAnchorRef.current.getWorldPosition(depthCameraRef.current.position);
                    detAnchorRef.current.getWorldQuaternion(depthCameraRef.current.quaternion);

                    // 2. Apply Dynamic Offsets (Relative to Detector) for CAMERA
                    const off = camOffsetRef.current;
                    depthCameraRef.current.translateX(off.x);
                    depthCameraRef.current.translateY(off.y);
                    depthCameraRef.current.translateZ(off.z);

                    // 3. Apply Dynamic Rotation for CAMERA
                    const rot = camRotRef.current;
                    depthCameraRef.current.rotateX(rot.x * Math.PI / 180);
                    depthCameraRef.current.rotateY(rot.y * Math.PI / 180);
                    depthCameraRef.current.rotateZ(rot.z * Math.PI / 180);

                    // 4. Apply Dynamic Transforms for REALSENSE (If attached)
                    if (realsenseModelRef.current) {
                        const rsOff = rsOffsetRef.current;
                        const rsR = rsRotRef.current;
                        realsenseModelRef.current.position.set(rsOff.x, rsOff.y, rsOff.z);
                        realsenseModelRef.current.rotation.set(
                            rsR.x * Math.PI / 180,
                            rsR.y * Math.PI / 180,
                            rsR.z * Math.PI / 180
                        );
                    }

                    // --- RENDER PASS 1: CAPTURE DEPTH (Layer 0 only) ---
                    depthCameraRef.current.layers.set(0); // Physical World
                    renderer.setRenderTarget(depthRenderTargetRef.current);
                    // Clear mainly depth
                    renderer.clear();
                    renderer.render(scene, depthCameraRef.current);
                    renderer.setRenderTarget(null);

                    // --- RENDER PASS 2: VISUALIZE DEPTH TO TEXTURE ---
                    if (depthVizSceneRef.current && depthVizTargetRef.current) {
                        renderer.setRenderTarget(depthVizTargetRef.current);
                        renderer.render(depthVizSceneRef.current, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)); // Use simple camera

                        // --- RENDER PASS 3: OVERLAY LANDMARKS (Layer 1) ---
                        // ALWAYS RENDER IN DEPTH VIEW (User Request)
                        renderer.autoClear = false; // Don't wipe the depth map we just drew

                        // CRITICAL: Temporarily remove scene background so we don't draw the grey void over our depth map
                        const oldBg = scene.background;
                        scene.background = null;

                        depthCameraRef.current.layers.set(1); // Landmarks Layer
                        renderer.render(scene, depthCameraRef.current); // Render landmarks on top

                        // Restore
                        scene.background = oldBg;
                        renderer.autoClear = true;

                        renderer.setRenderTarget(null);
                    }

                    // Restore Camera Layer State
                    depthCameraRef.current.layers.set(0);

                    depthCameraRef.current.updateMatrixWorld(true);

                    // Update debug helper
                    // Update debug helper
                    if (depthCameraHelperRef.current) {
                        depthCameraHelperRef.current.visible = debugEnabledRef.current;
                        if (debugEnabledRef.current) {
                            depthCameraHelperRef.current.update();
                        }
                    }
                }



                if (showLandmarksRef.current) {
                    camera.layers.enable(1);
                } else {
                    camera.layers.disable(1);
                }

                renderer.autoClear = true;
                renderer.render(scene, camera);

                // Draw ViewHelper on top in TOP-RIGHT corner
                const dim = 128;
                const canvasW = renderer.domElement.clientWidth;
                const canvasH = renderer.domElement.clientHeight;

                renderer.autoClear = false;
                // The override handles the viewport, but we can also set it here for clarity
                viewHelper.render(renderer);

                // Reset viewport to full screen for next frame using current dimensions
                renderer.setViewport(0, 0, canvasW, canvasH);
                renderer.autoClear = true;


            } catch (err) {
                console.error("[animate crash]", err);
                cancelAnimationFrame(reqId);
            }
        };
        animate();

        const handleResize = () => {
            if (!currentMount) return;
            const w = currentMount.clientWidth;
            const h = currentMount.clientHeight;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        };
        window.addEventListener('resize', handleResize);

        return () => {
            mounted = false;
            cancelAnimationFrame(reqId);
            window.removeEventListener('resize', handleResize);
            if (currentMount) currentMount.innerHTML = '';

            renderer.dispose();
            orbit.dispose();
            if (viewHelper) viewHelper.dispose();

            if (depthRenderTargetRef.current) {
                depthRenderTargetRef.current.dispose();
            }

            if (depthCameraHelperRef.current) {
                // Remove helper from wherever it might be attached (scene root)
                if (depthCameraHelperRef.current.parent) {
                    depthCameraHelperRef.current.parent.remove(depthCameraHelperRef.current);
                }
            }

            // Dispose scene resources
            scene.traverse((object) => {
                if (object.isMesh) {
                    object.geometry.dispose();
                    if (object.material.isMaterial) {
                        object.material.dispose();
                    } else if (Array.isArray(object.material)) {
                        object.material.forEach(m => m.dispose());
                    }
                }
            });
        };
    }, []);

    useEffect(() => {
        // Lift Logic (Procedural Robot)
        if (liftRef.current) liftRef.current.position.y = 1.20 + controls.lift;
        if (columnRotRef.current) columnRotRef.current.rotation.y = controls.column_rot;
        if (wigWagRef.current) wigWagRef.current.rotation.z = controls.wig_wag;
        if (cArmSlideRef.current) cArmSlideRef.current.rotation.x = controls.orbital_slide;
        if (cartRef.current) {
            cartRef.current.position.x = controls.cart_x;
            cartRef.current.position.z = controls.cart_z; // Apply Lateral Z
        }

        // Removed C-Arm GLB control logic to make it static
    }, [controls]);

    useEffect(() => {
        beamActiveRef.current = beamActive;
    }, [beamActive]);

    //Arduino useEffect for servo updates//

    useEffect(() => {
        const interval = setInterval(() => {
            if (!isArduinoConnectedRef.current || !serialWriterRef.current) return;

            const wRad = controlsRef.current.wig_wag;
            const cRad = controlsRef.current.column_rot;

            const wDeg = radToDeg(wRad);
            const cDeg = radToDeg(cRad);

            // Map simulator ranges to servo movement
            const wServo = clamp(90 + (wDeg / 23) * 45, 0, 180);
            const cServo = clamp(90 + (cDeg / 86) * 70, 0, 180);

            const now = performance.now();
            const last = lastSentRef.current;

            if (
                Math.abs(wServo - (last.w ?? wServo)) >= 1 ||
                Math.abs(cServo - (last.c ?? cServo)) >= 1 ||
                now - last.t > 200
            ) {
                lastSentRef.current = { w: wServo, c: cServo, t: now };
                sendServos(wServo, cServo);
            }

        }, 40); // ~25 Hz

        return () => clearInterval(interval);
    }, []);
    ////////////end of servo updates///////

    // Depth canvas update effect
    useEffect(() => {
        if (!depthCanvasRef.current) return;

        const canvas = depthCanvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Buffer for reading pixels
        const pixelBuffer = new Uint8Array(256 * 256 * 4);

        let animId;
        const updateDepthCanvas = () => {
            if (depthVizTargetRef.current && rendererRef.current) {
                // Read pixels from the VIZ target (Grayscale Depth)
                rendererRef.current.readRenderTargetPixels(
                    depthVizTargetRef.current,
                    0, 0, 256, 256,
                    pixelBuffer
                );

                // Put pixels on canvas
                const imageData = ctx.createImageData(256, 256);
                const data = imageData.data;

                // Copy buffer to imageData (need to flip Y usually, but for debug direct copy is fine)
                for (let i = 0; i < pixelBuffer.length; i++) {
                    data[i] = pixelBuffer[i];
                }

                ctx.putImageData(imageData, 0, 0);
            }

            animId = requestAnimationFrame(updateDepthCanvas);
        };
        updateDepthCanvas();

        return () => {
            if (animId) cancelAnimationFrame(animId);
        };
    }, []);

    const containerStyle = { position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', backgroundColor: '#eef2f5', fontFamily: 'sans-serif', color: '#333' };
    const xrayStyle = { position: 'absolute', top: '20px', left: '20px', width: '200px', height: '220px', backgroundColor: '#000', borderRadius: '8px', border: '2px solid #333', display: 'flex', flexDirection: 'column', overflow: 'hidden', pointerEvents: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.3)', color: '#fff' };
    const depthViewerStyle = { position: 'absolute', top: '260px', left: '20px', width: '200px', height: '200px', backgroundColor: '#000', borderRadius: '8px', border: '2px solid #333', display: 'flex', flexDirection: 'column', overflow: 'hidden', pointerEvents: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.3)', color: '#fff' };

    return (
        <div style={containerStyle}>
            {showInstructions && <Instructions onClose={() => setShowInstructions(false)} />}
            <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

            {debugEnabled && debugReadout && (
                <div style={{
                    position: 'absolute', top: '10px', right: '10px',
                    backgroundColor: 'rgba(0, 0, 0, 0.7)', color: '#0f0',
                    padding: '10px', borderRadius: '4px', fontFamily: 'monospace',
                    fontSize: '10px', pointerEvents: 'none', zIndex: 999
                }}>
                    <div><strong>DEBUG INFO</strong></div>
                    <div style={{ color: '#0ff', fontWeight: 'bold' }}>BeamRegion: {debugReadout.beamRegion}</div>
                    <div style={{ fontSize: '9px', color: '#aaa', marginBottom: '4px' }}>
                        Hit: {debugReadout.hitStatus} | NormY: {debugReadout.normY}
                    </div>
                    <hr style={{ borderColor: '#444', margin: '5px 0' }} />
                    <div>SRC: [{debugReadout.src.join(', ')}]</div>
                    <div>DET: [{debugReadout.det.join(', ')}]</div>
                    <div>SID: {debugReadout.sid} m</div>
                    <hr style={{ borderColor: '#444', margin: '5px 0' }} />
                    <div style={{ color: '#ffb3ba' }}>CT Origin World: [{debugReadout.ctOriginWorld.join(', ')}]</div>
                    <div style={{ color: '#ffb3ba' }}>CT Det Check: {debugReadout.ctDet}</div>
                    <div style={{ color: '#baffc9' }}>Cam CT Pos: [{debugReadout.camPosCT.join(', ')}]</div>
                    <div style={{ color: '#baffc9' }}>Cam CT Euler: [{debugReadout.camEulerCT.join(', ')}°]</div>
                    <div style={{ color: '#ffffaa' }}>CT Box Hit: {debugReadout.ctHitStatus}</div>
                    <div style={{ color: '#ffffaa' }}>CT Box Entry: [{debugReadout.ctHitEntry}]</div>
                    <div style={{ color: '#ffffaa' }}>CT Box Exit: [{debugReadout.ctHitExit}]</div>
                    <hr style={{ borderColor: '#444', margin: '5px 0' }} />
                    <div>MidToIso: {debugReadout.midToIso} m</div>
                    <div style={{ color: '#fff' }}>IsoRay: {debugReadout.isoRay} m</div>
                    <div>IsoSeg: {debugReadout.isoSeg} m</div>
                    <div>t: {debugReadout.t}</div>
                    <div>BeamAng: {debugReadout.beamAngle}°</div>
                    <div>BeamBaseErr: {debugReadout.beamErr} m</div>
                    <hr style={{ borderColor: '#444', margin: '5px 0' }} />
                    <div>Lift: {controls.lift.toFixed(3)}</div>
                    <div>C-Rot: {(controls.column_rot * 180 / Math.PI).toFixed(1)}°</div>
                    <div>WigWag: {(controls.wig_wag * 180 / Math.PI).toFixed(1)}°</div>
                    <div>Orbital: {(controls.orbital_slide * 180 / Math.PI).toFixed(1)}°</div>
                    <div>CartX: {controls.cart_x.toFixed(3)}</div>
                    <div>CartZ: {controls.cart_z.toFixed(3)}</div>
                </div>
            )}

            <div style={xrayStyle}>
                <div style={{ backgroundColor: '#111', borderBottom: '1px solid #333', padding: '5px 10px', fontSize: '9px', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', color: '#aaa' }}>
                    <span>FLUORO - LIVE VIEW</span>
                    <span style={{
                        color: beamZoneKeyUI === 'miss' ? '#ff3333' : '#00ffaa',
                        fontWeight: 'bold',
                        marginLeft: '10px'
                    }}>
                        {beamRegionUI}
                    </span>
                    <span>ISO: 1200</span>
                </div>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
                    {lastXray ? (
                        <img src={lastXray} alt="Xray" style={{ width: '100%', height: '100%', objectFit: 'contain', transform: 'rotate(-90deg)', filter: beamActive ? 'brightness(1.6) contrast(1.1) drop-shadow(0 0 5px white)' : 'none' }} />
                    ) : (
                        <div style={{ color: '#333', fontSize: '9px', letterSpacing: '1px' }}>
                            {beamActive ? "EXPOSING..." : (currentAnatomy === "READY" ? "READY" : currentAnatomy)}
                        </div>
                    )}
                    <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(rgba(255,255,255,0.01) 0px, transparent 1px, transparent 2px)', pointerEvents: 'none' }}></div>
                    <div style={{ position: 'absolute', bottom: '5px', left: '8px', fontSize: '8px', color: '#0f0', opacity: 0.6, fontFamily: 'monospace' }}>FPS: 30</div>
                    <div style={{ position: 'absolute', bottom: '5px', right: '8px', fontSize: '8px', color: '#fff', opacity: 0.4, textAlign: 'right' }}>ID: 4882-991<br />PATIENT: DOE, J</div>

                    {beamActive && (
                        <div style={{ position: 'absolute', top: '20px', right: '10px', color: 'red', fontSize: '9px', fontWeight: 'bold', animation: 'pulse 0.4s infinite' }}>RADIATION ON</div>
                    )}
                </div>
                {/* Download Button Moved Here */}
                <button
                    onClick={handleDownloadXray}
                    disabled={!lastXray || beamActive}
                    style={{
                        width: '100%',
                        padding: '8px',
                        backgroundColor: (!lastXray || beamActive) ? '#222' : '#444',
                        color: (!lastXray || beamActive) ? '#555' : 'white',
                        border: 'none',
                        borderTop: '1px solid #333',
                        fontSize: '9px',
                        fontWeight: 'bold',
                        cursor: (!lastXray || beamActive) ? 'not-allowed' : 'pointer',
                        transition: 'all 0.2s'
                    }}>
                    DOWNLOAD X-RAY
                </button>
            </div>

            {/* Depth Viewer */}
            <div style={depthViewerStyle}>
                <div style={{ backgroundColor: '#111', borderBottom: '1px solid #333', padding: '5px 10px', fontSize: '9px', fontWeight: 'bold', color: '#aaa' }}>
                    DEPTH VIEW - X-RAY SOURCE
                </div>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' }}>
                    <canvas
                        ref={depthCanvasRef}
                        width={256}
                        height={256}
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                </div>
            </div>

            {/* Automatic Path Planner */}
            <div
                style={{
                    position: 'absolute',
                    top: '20px',
                    right: '20px',
                    width: '270px',
                    maxHeight: 'calc(100vh - 40px)',
                    overflowY: 'auto',
                    padding: '14px',
                    backgroundColor: 'rgba(15, 23, 42, 0.94)',
                    color: '#ffffff',
                    border: '1px solid rgba(255,255,255,0.18)',
                    borderRadius: '10px',
                    boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
                    zIndex: 900,
                    fontSize: '12px',
                    boxSizing: 'border-box'
                }}
            >
                <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '4px' }}>
                    AUTOMATIC PATH PLANNER
                </div>

                <div style={{ color: '#94a3b8', fontSize: '10px', marginBottom: '10px' }}>
                    Choose a procedure, body region, landmark, and projection—or type a clinical request. Preview is required before movement.
                </div>
                <div style={{ marginBottom: '9px', padding: '6px', borderRadius: '5px', backgroundColor: 'rgba(245,158,11,0.12)', color: '#fde68a', border: '1px solid rgba(245,158,11,0.35)', fontSize: '8px', lineHeight: '1.35' }}>
                    RESEARCH SIMULATOR ONLY — validate collision limits, registration, and hardware interlocks before any physical execution.
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px', marginBottom: '8px' }}>
                    <input type="text" value={clinicalRequest} disabled={isPlanning || isPathAnimating}
                        onChange={event => setClinicalRequest(event.target.value)}
                        onKeyDown={event => { if (event.key === 'Enter') interpretClinicalRequest(); }}
                        placeholder="Show the neck from the left side"
                        style={{ padding: '7px', backgroundColor: '#111827', color: '#fff', border: '1px solid #334155', borderRadius: '5px', minWidth: 0 }} />
                    <button type="button" onClick={interpretClinicalRequest} disabled={isPlanning || isPathAnimating}
                        style={{ padding: '7px 9px', border: 'none', borderRadius: '5px', backgroundColor: '#7c3aed', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>
                        INTERPRET
                    </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '8px' }}>
                    <label>
                        <div style={{ marginBottom: '3px', color: '#cbd5e1', fontSize: '10px' }}>Procedure</div>
                        <select
                            value={selectedProcedure}
                            disabled={isPlanning || isPathAnimating}
                            onChange={event => handleProcedureChange(event.target.value)}
                            style={{ width: '100%', padding: '7px', backgroundColor: '#111827', color: '#fff', border: '1px solid #334155', borderRadius: '5px' }}
                        >
                            {Object.entries(PROCEDURE_OPTIONS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
                        </select>
                    </label>
                    <label>
                        <div style={{ marginBottom: '3px', color: '#cbd5e1', fontSize: '10px' }}>Body region</div>
                        <select
                            value={selectedBodyRegion}
                            disabled={isPlanning || isPathAnimating}
                            onChange={event => handleBodyRegionChange(event.target.value)}
                            style={{ width: '100%', padding: '7px', backgroundColor: '#111827', color: '#fff', border: '1px solid #334155', borderRadius: '5px' }}
                        >
                            {availableBodyRegions.map(key => <option key={key} value={key}>{BODY_REGION_OPTIONS[key]?.label || key}</option>)}
                        </select>
                    </label>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '8px' }}>
                    <label>
                        <div style={{ marginBottom: '3px', color: '#cbd5e1', fontSize: '10px' }}>Anatomical landmark</div>
                        <select
                            value={selectedAnatomy}
                            disabled={isPlanning || isPathAnimating}
                            onChange={event => applyAnatomicalTarget(event.target.value)}
                            style={{ width: '100%', padding: '7px', backgroundColor: '#111827', color: '#fff', border: '1px solid #334155', borderRadius: '5px' }}
                        >
                            {filteredLandmarkEntries.map(([key, item]) => <option key={key} value={key}>{item.id === null ? item.label : `${item.id}: ${item.label}`}</option>)}
                        </select>
                    </label>
                    <label>
                        <div style={{ marginBottom: '3px', color: '#cbd5e1', fontSize: '10px' }}>Projection</div>
                        <select
                            value={selectedProjection}
                            disabled={isPlanning || isPathAnimating}
                            onChange={event => applyProjection(event.target.value)}
                            style={{ width: '100%', padding: '7px', backgroundColor: '#111827', color: '#fff', border: '1px solid #334155', borderRadius: '5px' }}
                        >
                            {availableProjectionKeys.map(key => <option key={key} value={key}>{PROJECTION_OPTIONS[key]?.label || key}</option>)}
                        </select>
                    </label>
                </div>

                <div style={{ marginBottom: '8px', padding: '7px', borderRadius: '5px', backgroundColor: 'rgba(37,99,235,0.12)', color: '#bfdbfe', fontSize: '9px', lineHeight: '1.45' }}>
                    <div><strong>{selectedAnatomyInfo.label}</strong> · {selectedAnatomyInfo.regionLabel}</div>
                    <div>Beam: {selectedProjectionInfo.beam}</div>
                    <div>
                        Preset: orbital {Number(selectedProjectionInfo.angleDeg).toFixed(0)}° · wig-wag {Number(selectedProjectionInfo.wigWagDeg).toFixed(0)}° · lift {Number.isFinite(Number(selectedAnatomyInfo.defaultLift)) ? Number(selectedAnatomyInfo.defaultLift).toFixed(3) : 'manual'}
                    </div>
                </div>

                <div style={{ marginBottom: '8px', padding: '8px', borderRadius: '6px', border: calibrationMode ? '1px solid #f59e0b' : '1px solid #334155', backgroundColor: calibrationMode ? 'rgba(245,158,11,0.10)' : 'rgba(15,23,42,0.45)' }}>
                    <button
                        type="button"
                        disabled={isPlanning || isPathAnimating || selectedAnatomy === 'MANUAL'}
                        onClick={() => {
                            setCalibrationMode(previous => {
                                const next = !previous;
                                calibrationModeRef.current = next;
                                showLandmarksRef.current = next || showLandmarksRef.current;
                                queueMicrotask(() => refreshAnatomicalLandmarkOverlay());
                                return next;
                            });
                        }}
                        style={{
                            width: '100%',
                            padding: '7px',
                            border: 'none',
                            borderRadius: '5px',
                            backgroundColor: calibrationMode ? '#d97706' : '#475569',
                            color: '#fff',
                            fontWeight: 'bold',
                            cursor: selectedAnatomy === 'MANUAL' ? 'not-allowed' : 'pointer'
                        }}
                    >
                        {calibrationMode ? 'EXIT CALIBRATION' : 'CALIBRATE LANDMARK'}
                    </button>

                    {calibrationMode && selectedAnatomy !== 'MANUAL' && (
                        <>
                            <div style={{ marginTop: '7px', color: '#fde68a', fontSize: '9px', lineHeight: 1.45 }}>
                                Selected: <strong>{selectedAnatomyInfo.id}: {selectedAnatomyInfo.shortLabel}</strong><br />
                                Arrow Left/Right = X · Arrow Up/Down = Y · Page Up/Down = Z<br />
                                Shift = 5 mm · Alt = 0.1 mm
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px', marginTop: '7px' }}>
                                {[
                                    ['X−', 'x_mm', -1], ['Y+', 'y_mm', 1], ['Z+', 'z_mm', 1],
                                    ['X+', 'x_mm', 1], ['Y−', 'y_mm', -1], ['Z−', 'z_mm', -1]
                                ].map(([label, axis, delta]) => (
                                    <button
                                        key={`${axis}-${delta}-${label}`}
                                        type="button"
                                        onClick={() => nudgeRegisteredLandmark(axis, delta)}
                                        style={{ padding: '5px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#111827', color: '#fff', cursor: 'pointer', fontSize: '9px' }}
                                    >
                                        {label} 1 mm
                                    </button>
                                ))}
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px', marginTop: '7px' }}>
                                <button type="button" onClick={saveLandmarkRegistration}
                                    style={{ padding: '6px', border: 'none', borderRadius: '4px', backgroundColor: '#16a34a', color: '#fff', fontWeight: 'bold', cursor: 'pointer', fontSize: '9px' }}>
                                    SAVE REGISTRATION
                                </button>
                                <label style={{ padding: '6px', borderRadius: '4px', backgroundColor: '#2563eb', color: '#fff', fontWeight: 'bold', cursor: 'pointer', fontSize: '9px', textAlign: 'center' }}>
                                    LOAD JSON
                                    <input type="file" accept=".json,application/json" style={{ display: 'none' }}
                                        onChange={event => {
                                            loadRegistrationFile(event.target.files?.[0]);
                                            event.target.value = '';
                                        }} />
                                </label>
                            </div>

                            <button type="button" onClick={resetLandmarkRegistration}
                                style={{ width: '100%', marginTop: '5px', padding: '5px', borderRadius: '4px', border: '1px solid #ef4444', backgroundColor: 'transparent', color: '#fca5a5', cursor: 'pointer', fontSize: '8px' }}>
                                REMOVE SAVED REGISTRATION
                            </button>
                        </>
                    )}

                    {calibrationMessage && (
                        <div style={{ marginTop: '6px', color: '#cbd5e1', fontSize: '8px', lineHeight: 1.4 }}>
                            {calibrationMessage}
                        </div>
                    )}
                </div>

                {availableProjectionKeys.length > 1 && (
                    <div style={{ marginBottom: '8px' }}>
                        <div style={{ color: '#94a3b8', fontSize: '9px', marginBottom: '4px' }}>Recommended alternatives</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {availableProjectionKeys.filter(key => key !== selectedProjection).slice(0, 5).map(key => (
                                <button
                                    key={key}
                                    type="button"
                                    disabled={isPlanning || isPathAnimating}
                                    onClick={() => applyProjection(key)}
                                    style={{ padding: '4px 6px', borderRadius: '999px', border: '1px solid #475569', backgroundColor: '#111827', color: '#cbd5e1', fontSize: '8px', cursor: 'pointer' }}
                                >
                                    {PROJECTION_OPTIONS[key]?.label || key}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                        gap: '6px',
                        marginBottom: '10px'
                    }}
                >
                    {['x_mm', 'y_mm', 'z_mm'].map(axis => (
                        <label key={axis}>
                            <div style={{ marginBottom: '3px', color: '#cbd5e1', fontSize: '10px' }}>
                                {axis.replace('_mm', '').toUpperCase()} mm
                            </div>
                            <input
                                type="number"
                                step="1"
                                value={plannerTarget[axis]}
                                disabled={isPlanning || isPathAnimating}
                                onChange={event => {
                                    const value = Number(event.target.value);
                                    if (calibrationMode && selectedAnatomy !== 'MANUAL') {
                                        updateRegisteredLandmark(selectedAnatomy, { [axis]: value }, `${selectedAnatomyInfo.shortLabel} coordinate edited`);
                                        return;
                                    }

                                    setSelectedProcedure('ALL');
                                    setSelectedBodyRegion('ALL');
                                    setSelectedAnatomy('MANUAL');
                                    selectedAnatomyRef.current = 'MANUAL';
                                    setPlannerTarget(previous => ({
                                        ...previous,
                                        [axis]: value
                                    }));
                                    setPlannerResult(null);
                                }}
                                style={{
                                    width: '100%',
                                    boxSizing: 'border-box',
                                    padding: '6px',
                                    backgroundColor: '#111827',
                                    color: '#ffffff',
                                    border: '1px solid #334155',
                                    borderRadius: '5px'
                                }}
                            />
                        </label>
                    ))}
                </div>

                {selectedProjection === 'CUSTOM_OBLIQUE' && (
                    <label>
                        <div style={{ marginBottom: '3px', color: '#cbd5e1', fontSize: '10px' }}>
                            Oblique angle: {Number(plannerObliqueAngle).toFixed(0)}°
                        </div>
                        <input type="range" min="-90" max="90" step="1" value={plannerObliqueAngle}
                            disabled={isPlanning || isPathAnimating}
                            onChange={event => { setPlannerObliqueAngle(Number(event.target.value)); setPlannerView('OBLIQUE'); setPlannerResult(null); setPlannerStatus('VIEW SELECTED'); }}
                            style={{ width: '100%', marginBottom: '8px' }} />
                    </label>
                )}

                <label>
                    <div style={{ marginBottom: '3px', color: '#cbd5e1', fontSize: '10px' }}>
                        Waypoints: {plannerWaypointCount}
                    </div>
                    <input
                        type="range"
                        min="5"
                        max="61"
                        step="2"
                        value={plannerWaypointCount}
                        disabled={isPlanning || isPathAnimating}
                        onChange={event => setPlannerWaypointCount(Number(event.target.value))}
                        style={{ width: '100%', marginBottom: '10px' }}
                    />
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <button
                        type="button"
                        onClick={handlePreviewPath}
                        disabled={isPlanning || isPathAnimating}
                        style={{
                            width: '100%',
                            padding: '9px',
                            border: 'none',
                            borderRadius: '6px',
                            backgroundColor: isPlanning || isPathAnimating ? '#475569' : '#2563eb',
                            color: '#ffffff',
                            fontWeight: 'bold',
                            cursor: isPlanning || isPathAnimating ? 'not-allowed' : 'pointer'
                        }}
                    >
                        {isPlanning
                            ? 'CALCULATING...'
                            : plannerAnimationMode === 'preview'
                                ? 'PREVIEWING...'
                                : 'PREVIEW PATH'}
                    </button>

                    <button
                        type="button"
                        onClick={handleMovePlannedPath}
                        disabled={isPlanning || isPathAnimating || !plannerResult?.waypoints?.length}
                        style={{
                            width: '100%',
                            padding: '9px',
                            border: 'none',
                            borderRadius: '6px',
                            backgroundColor:
                                isPlanning || isPathAnimating || !plannerResult?.waypoints?.length
                                    ? '#475569'
                                    : '#16a34a',
                            color: '#ffffff',
                            fontWeight: 'bold',
                            cursor:
                                isPlanning || isPathAnimating || !plannerResult?.waypoints?.length
                                    ? 'not-allowed'
                                    : 'pointer'
                        }}
                    >
                        {plannerAnimationMode === 'move' ? 'MOVING...' : 'MOVE C-ARM'}
                    </button>
                </div>

                <button
                    type="button"
                    onClick={handleTakeXray}
                    disabled={
                        beamActive
                        || isPlanning
                        || isPathAnimating
                        || plannerStatus !== 'ARRIVED'
                        || !plannerResult?.geometry_verification?.verified
                        || !plannerResult?.final_pose
                        || !posesMatch(controlsRef.current, plannerResult.final_pose)
                    }
                    style={{
                        width: '100%',
                        marginTop: '7px',
                        padding: '10px',
                        border: 'none',
                        borderRadius: '6px',
                        backgroundColor:
                            beamActive
                            || isPlanning
                            || isPathAnimating
                            || plannerStatus !== 'ARRIVED'
                            || !plannerResult?.geometry_verification?.verified
                            || !plannerResult?.final_pose
                            || !posesMatch(controlsRef.current, plannerResult.final_pose)
                                ? '#475569'
                                : '#f59e0b',
                        color: '#ffffff',
                        fontWeight: 'bold',
                        cursor:
                            beamActive
                            || isPlanning
                            || isPathAnimating
                            || plannerStatus !== 'ARRIVED'
                            || !plannerResult?.geometry_verification?.verified
                            || !plannerResult?.final_pose
                            || !posesMatch(controlsRef.current, plannerResult.final_pose)
                                ? 'not-allowed'
                                : 'pointer',
                        boxShadow:
                            plannerStatus === 'ARRIVED'
                            && plannerResult?.geometry_verification?.verified
                            && plannerResult?.final_pose
                            && posesMatch(controlsRef.current, plannerResult.final_pose)
                                ? '0 0 12px rgba(245,158,11,0.35)'
                                : 'none'
                    }}
                    title={
                        plannerStatus !== 'ARRIVED'
                            ? 'Move the C-arm to the verified final pose first.'
                            : !plannerResult?.geometry_verification?.verified
                                ? 'A geometry-verified plan is required.'
                                : !plannerResult?.final_pose
                                    ? 'No final pose is available.'
                                    : !posesMatch(controlsRef.current, plannerResult.final_pose)
                                        ? 'The live pose changed. Move or replan before exposure.'
                                        : 'Capture a DiffDRR exposure at the verified pose.'
                    }
                >
                    {beamActive ? 'EXPOSING…' : 'EXPOSE X-RAY'}
                </button>

                {(isPlanning || isPathAnimating) && (
                    <button
                        type="button"
                        onClick={handleCancelPlannedPath}
                        style={{
                            width: '100%',
                            marginTop: '6px',
                            padding: '7px',
                            border: '1px solid #ef4444',
                            borderRadius: '6px',
                            backgroundColor: 'transparent',
                            color: '#fca5a5',
                            fontWeight: 'bold',
                            cursor: 'pointer'
                        }}
                    >
                        CANCEL
                    </button>
                )}

                <div style={{ marginTop: '7px', color: '#94a3b8', fontSize: '9px', lineHeight: '1.35' }}>
                    PREVIEW solves against the actual Three.js source, detector, isocenter, CT transform, and live pose. A path is rejected unless the selected landmark is on the central ray within 1 mm. EXPOSE unlocks only after arrival at the verified final pose.
                </div>

                <div style={{ marginTop: '10px', padding: '8px', backgroundColor: '#111827', borderRadius: '6px' }}>
                    <div>
                        Status:{' '}
                        <strong
                            style={{
                                color:
                                    plannerStatus === 'ERROR'
                                        ? '#f87171'
                                        : plannerStatus === 'ARRIVED'
                                            ? '#4ade80'
                                            : plannerStatus === 'CANCELLED' || plannerStatus === 'REPLAN REQUIRED'
                                                ? '#fbbf24'
                                                : '#60a5fa'
                            }}
                        >
                            {plannerStatus}
                        </strong>
                    </div>

                    {plannerResult?.confidence && (
                        <>
                            <div style={{ marginTop: '5px' }}>
                                Confidence:{' '}
                                <strong>
                                    {Number(plannerResult.confidence.percentage).toFixed(1)}%
                                </strong>
                            </div>
                            <div
                                style={{
                                    height: '6px',
                                    marginTop: '5px',
                                    backgroundColor: '#334155',
                                    borderRadius: '999px',
                                    overflow: 'hidden'
                                }}
                            >
                                <div
                                    style={{
                                        width: `${Math.max(
                                            0,
                                            Math.min(100, Number(plannerResult.confidence.percentage))
                                        )}%`,
                                        height: '100%',
                                        backgroundColor: '#22c55e'
                                    }}
                                />
                            </div>
                        </>
                    )}

                    {plannerResult && (
                        <div style={{ marginTop: '7px', color: '#e2e8f0', fontSize: '10px', lineHeight: '1.45' }}>
                            <div><strong>Request:</strong> {selectedAnatomyInfo.label} — {selectedProjectionInfo.label}</div>
                            <div><strong>Region:</strong> {selectedAnatomyInfo.regionLabel}</div>
                            <div><strong>Target:</strong> ({Number(plannerTarget.x_mm).toFixed(1)}, {Number(plannerTarget.y_mm).toFixed(1)}, {Number(plannerTarget.z_mm).toFixed(1)}) mm</div>
                            <div><strong>Preset:</strong> orbital {Number(selectedProjectionInfo.angleDeg).toFixed(1)}°, wig-wag {Number(selectedProjectionInfo.wigWagDeg).toFixed(1)}°, lift {Number.isFinite(Number(selectedAnatomyInfo.defaultLift)) ? Number(selectedAnatomyInfo.defaultLift).toFixed(3) : 'manual'}</div>
                        </div>
                    )}

                    {plannerResult?.geometry_verification?.verified && (
                        <div style={{
                            marginTop: '7px',
                            padding: '6px',
                            borderRadius: '4px',
                            border: '1px solid #22c55e',
                            backgroundColor: 'rgba(34,197,94,0.10)',
                            color: '#bbf7d0',
                            fontSize: '9px',
                            lineHeight: '1.45'
                        }}>
                            <strong>SCENE GEOMETRY VERIFIED</strong><br />
                            Isocenter error: {Number(plannerResult.geometry_verification.isocenter_error_mm).toFixed(2)} mm<br />
                            Central-ray error: {Number(plannerResult.geometry_verification.central_ray_error_mm).toFixed(2)} mm
                        </div>
                    )}

                    {plannerResult?.final_pose && (
                        <div style={{ marginTop: '7px', color: '#cbd5e1', fontSize: '10px', lineHeight: '1.5' }}>
                            <div>
                                Final orbital: {(Number(plannerResult.final_pose.orbital_slide) * R2D).toFixed(1)}°
                            </div>
                            <div>
                                Final lift: {Number(plannerResult.final_pose.lift).toFixed(3)}
                            </div>
                            <div>
                                Final wig-wag: {(Number(plannerResult.final_pose.wig_wag) * R2D).toFixed(1)}°
                            </div>
                            <div>
                                Final cart X: {Number(plannerResult.final_pose.cart_x).toFixed(3)}
                            </div>
                            <div>
                                Final cart Z: {Number(plannerResult.final_pose.cart_z).toFixed(3)}
                            </div>
                        </div>
                    )}

                    {plannerResult?.explanation?.length > 0 && (
                        <div style={{ marginTop: '7px', color: '#94a3b8', fontSize: '10px', lineHeight: '1.4' }}>
                            {plannerResult.explanation.map((line, index) => (
                                <div key={`${index}-${line}`}>{line}</div>
                            ))}
                        </div>
                    )}

                    {plannerError && (
                        <div style={{ marginTop: '7px', color: '#fca5a5', fontSize: '10px' }}>
                            {plannerError}
                        </div>
                    )}
                </div>
            </div>

            <ControllerPanel
                controls={controls}
                setControls={setControls}
                onExpose={handleTakeXray}
                beamActive={beamActive}
                ensureArduinoConnected={ensureArduinoConnected}
            />

            {debugEnabled && (
                <div style={{ position: 'absolute', bottom: '10px', left: '10px', backgroundColor: 'rgba(0,0,0,0.8)', padding: '10px', borderRadius: '5px', color: 'white', fontSize: '10px', width: '200px' }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>CONTROLS</span>
                        <div style={{ display: 'flex', gap: '5px' }}>
                            <button
                                onClick={() => setControlTarget('camera')}
                                style={{
                                    padding: '2px 5px', fontSize: '9px', cursor: 'pointer', border: 'none', borderRadius: '3px',
                                    backgroundColor: controlTarget === 'camera' ? '#0077ff' : '#444', color: 'white'
                                }}>
                                CAM
                            </button>
                            <button
                                onClick={() => setControlTarget('realsense')}
                                style={{
                                    padding: '2px 5px', fontSize: '9px', cursor: 'pointer', border: 'none', borderRadius: '3px',
                                    backgroundColor: controlTarget === 'realsense' ? '#0077ff' : '#444', color: 'white'
                                }}>
                                RS
                            </button>
                        </div>
                    </div>

                    <div style={{ marginBottom: '5px', color: '#aaa', fontSize: '9px', textAlign: 'center' }}>
                        ADJUSTING: {controlTarget === 'camera' ? "DEPTH CAMERA" : "REALSENSE MODEL"}
                    </div>

                    {controlTarget === 'camera' ? (
                        <>
                            <div style={{ marginBottom: '5px' }}>Pos X: {camOffset.x.toFixed(2)}</div>
                            <input type="range" min="-2" max="2" step="0.01" value={camOffset.x} onChange={(e) => setCamOffset({ ...camOffset, x: parseFloat(e.target.value) })} style={{ width: '100%' }} />

                            <div style={{ marginBottom: '5px' }}>Pos Y: {camOffset.y.toFixed(2)}</div>
                            <input type="range" min="-2" max="2" step="0.01" value={camOffset.y} onChange={(e) => setCamOffset({ ...camOffset, y: parseFloat(e.target.value) })} style={{ width: '100%' }} />

                            <div style={{ marginBottom: '5px' }}>Pos Z: {camOffset.z.toFixed(2)}</div>
                            <input type="range" min="-2" max="2" step="0.01" value={camOffset.z} onChange={(e) => setCamOffset({ ...camOffset, z: parseFloat(e.target.value) })} style={{ width: '100%' }} />

                            <div style={{ borderTop: '1px solid #444', margin: '5px 0' }}></div>

                            <div style={{ marginBottom: '5px' }}>Rot X: {camRot.x.toFixed(1)}°</div>
                            <input type="range" min="-180" max="180" step="0.5" value={camRot.x} onChange={(e) => setCamRot({ ...camRot, x: parseFloat(e.target.value) })} style={{ width: '100%' }} />

                            <div style={{ marginBottom: '5px' }}>Rot Y: {camRot.y.toFixed(1)}°</div>
                            <input type="range" min="-180" max="180" step="0.5" value={camRot.y} onChange={(e) => setCamRot({ ...camRot, y: parseFloat(e.target.value) })} style={{ width: '100%' }} />

                            <div style={{ marginBottom: '5px' }}>Rot Z: {camRot.z.toFixed(1)}°</div>
                            <input type="range" min="-180" max="180" step="0.5" value={camRot.z} onChange={(e) => setCamRot({ ...camRot, z: parseFloat(e.target.value) })} style={{ width: '100%' }} />
                        </>
                    ) : (
                        <>
                            <div style={{ marginBottom: '5px' }}>RS Pos X: {rsOffset.x.toFixed(2)}</div>
                            <input type="range" min="-2" max="2" step="0.01" value={rsOffset.x} onChange={(e) => setRsOffset({ ...rsOffset, x: parseFloat(e.target.value) })} style={{ width: '100%' }} />

                            <div style={{ marginBottom: '5px' }}>RS Pos Y: {rsOffset.y.toFixed(2)}</div>
                            <input type="range" min="-2" max="2" step="0.01" value={rsOffset.y} onChange={(e) => setRsOffset({ ...rsOffset, y: parseFloat(e.target.value) })} style={{ width: '100%' }} />

                            <div style={{ marginBottom: '5px' }}>RS Pos Z: {rsOffset.z.toFixed(2)}</div>
                            <input type="range" min="-2" max="2" step="0.01" value={rsOffset.z} onChange={(e) => setRsOffset({ ...rsOffset, z: parseFloat(e.target.value) })} style={{ width: '100%' }} />

                            <div style={{ borderTop: '1px solid #444', margin: '5px 0' }}></div>

                            <div style={{ marginBottom: '5px' }}>RS Rot X: {rsRot.x.toFixed(1)}°</div>
                            <input type="range" min="-180" max="180" step="0.5" value={rsRot.x} onChange={(e) => setRsRot({ ...rsRot, x: parseFloat(e.target.value) })} style={{ width: '100%' }} />

                            <div style={{ marginBottom: '5px' }}>RS Rot Y: {rsRot.y.toFixed(1)}°</div>
                            <input type="range" min="-180" max="180" step="0.5" value={rsRot.y} onChange={(e) => setRsRot({ ...rsRot, y: parseFloat(e.target.value) })} style={{ width: '100%' }} />

                            <div style={{ marginBottom: '5px' }}>RS Rot Z: {rsRot.z.toFixed(1)}°</div>
                            <input type="range" min="-180" max="180" step="0.5" value={rsRot.z} onChange={(e) => setRsRot({ ...rsRot, z: parseFloat(e.target.value) })} style={{ width: '100%' }} />
                        </>
                    )}
                </div>
            )}

            {/* Keyboard Legend - Glassmorphism Style */}
            <div style={{
                position: 'absolute',
                bottom: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                gap: '20px',
                padding: '12px 24px',
                background: 'rgba(255, 255, 255, 0.1)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                borderRadius: '16px',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
                color: '#fff',
                fontSize: '13px',
                fontWeight: '500',
                pointerEvents: 'none',
                zIndex: 1000
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <kbd style={{
                        padding: '4px 8px',
                        background: 'rgba(255, 255, 255, 0.2)',
                        borderRadius: '6px',
                        border: '1px solid rgba(255, 255, 255, 0.3)',
                        fontFamily: 'monospace',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
                    }}>I</kbd>
                    <span style={{ opacity: 0.9 }}>Instructions</span>
                </div>
                <div style={{
                    width: '1px',
                    background: 'rgba(255, 255, 255, 0.2)',
                    margin: '0 4px'
                }}></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <kbd style={{
                        padding: '4px 8px',
                        background: 'rgba(255, 255, 255, 0.2)',
                        borderRadius: '6px',
                        border: '1px solid rgba(255, 255, 255, 0.3)',
                        fontFamily: 'monospace',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
                    }}>P</kbd>
                    <span style={{ opacity: 0.9 }}>Toggle Patient</span>
                </div>
                <div style={{
                    width: '1px',
                    background: 'rgba(255, 255, 255, 0.2)',
                    margin: '0 4px'
                }}></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <kbd style={{
                        padding: '4px 8px',
                        background: 'rgba(255, 255, 255, 0.2)',
                        borderRadius: '6px',
                        border: '1px solid rgba(255, 255, 255, 0.3)',
                        fontFamily: 'monospace',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
                    }}>L</kbd>
                    <span style={{ opacity: 0.9 }}>Toggle Landmarks</span>
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <span style={{ backgroundColor: calibrationMode ? '#d97706' : '#334155', borderRadius: '4px', padding: '3px 6px', fontWeight: 'bold' }}>K</span>
                    <span style={{ opacity: 0.9 }}>Calibrate Landmark</span>
                </div>
                <div style={{
                    width: '1px',
                    background: 'rgba(255, 255, 255, 0.2)',
                    margin: '0 4px'
                }}></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <kbd style={{
                        padding: '4px 8px',
                        background: 'rgba(255, 255, 255, 0.2)',
                        borderRadius: '6px',
                        border: '1px solid rgba(255, 255, 255, 0.3)',
                        fontFamily: 'monospace',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
                    }}>D</kbd>
                    <span style={{ opacity: 0.9 }}>Toggle Debug</span>
                </div>
                <div style={{
                    width: '1px',
                    background: 'rgba(255, 255, 255, 0.2)',
                    margin: '0 4px'
                }}></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <kbd style={{
                        padding: '4px 8px',
                        background: isArduinoConnectedUI ? 'rgba(0, 255, 0, 0.3)' : 'rgba(255, 0, 0, 0.3)',
                        borderRadius: '6px',
                        border: isArduinoConnectedUI ? '1px solid rgba(0, 255, 0, 0.5)' : '1px solid rgba(255, 0, 0, 0.5)',
                        fontFamily: 'monospace',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
                    }}>C</kbd>
                    <span style={{ opacity: 0.9 }}>
                        {isArduinoConnectedUI ? "Disconnect Arduino" : "Connect Arduino"}
                    </span>
                </div>
            </div>
        </div>
    );
};

export default App;