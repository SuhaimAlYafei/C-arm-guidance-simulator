import * as THREE from 'three';
import {
  fluoroscopyOutputIndex,
  kapProxyIndex,
  metalArtifactSeverity,
  scatterProxyIndex,
} from './researchMath.js';
import { logResearchEvent } from './researchRunLogger.js';

const MAIN_SCENE_BACKGROUND = 0xeef2f5;
const UPDATE_MS = 250;

const METAL_OBJECTS = [
  ['or_iv_pole', 'IV pole'],
  ['or_mayo_stand', 'Mayo stand'],
  ['or_instrument_trolley', 'Instrument trolley'],
  ['or_anesthesia_workstation', 'Anesthesia workstation'],
  ['or_carm_monitor_cart', 'C-arm monitor cart'],
];

const STAFF_OBJECTS = [
  ['or_surgeon', 'Surgeon'],
  ['or_scrub_nurse', 'Scrub nurse'],
];

const state = {
  scene: null,
  ready: false,
  beamFound: false,
  heatmapVisible: false,
  kvp: 80,
  tubeCurrentMa: 2.5,
  pulseRatePps: 7.5,
  pulseWidthMs: 5,
  durationS: 5,
  fieldSizeCm: 20,
  outputIndex: null,
  kapIndex: null,
  metalInFov: false,
  metalObjects: [],
  artifactSeverity: 0,
  staffScatter: [],
  maxStaffScatter: null,
  sourceToPatientM: null,
  patientThicknessM: null,
  note: 'Relative engineering indices only; not calibrated clinical dosimetry.',
  subscribers: new Set(),
};

let installed = false;
let previousRender = null;
let updateTimer = null;
let heatmapGroup = null;
let lastMetalSignature = '';
let lastExposureVisible = false;

const snapshot = () => ({
  ready: state.ready,
  beamFound: state.beamFound,
  heatmapVisible: state.heatmapVisible,
  kvp: state.kvp,
  tubeCurrentMa: state.tubeCurrentMa,
  pulseRatePps: state.pulseRatePps,
  pulseWidthMs: state.pulseWidthMs,
  durationS: state.durationS,
  fieldSizeCm: state.fieldSizeCm,
  outputIndex: state.outputIndex,
  kapIndex: state.kapIndex,
  metalInFov: state.metalInFov,
  metalObjects: [...state.metalObjects],
  artifactSeverity: state.artifactSeverity,
  staffScatter: state.staffScatter.map(item => ({ ...item })),
  maxStaffScatter: state.maxStaffScatter,
  sourceToPatientM: state.sourceToPatientM,
  patientThicknessM: state.patientThicknessM,
  note: state.note,
});

const emit = () => {
  const next = snapshot();
  state.subscribers.forEach(listener => {
    try { listener(next); } catch (error) { console.warn('[radiation intelligence] subscriber failed', error); }
  });
};

export const getRadiationSnapshot = () => snapshot();
export const subscribeRadiation = listener => {
  state.subscribers.add(listener);
  listener(snapshot());
  return () => state.subscribers.delete(listener);
};

const setNumeric = (key, value, min, max) => {
  state[key] = THREE.MathUtils.clamp(Number(value) || 0, min, max);
  logResearchEvent('radiation_parameter_changed', { parameter: key, value: state[key] });
  emit();
};

export const setRadiationKvp = value => setNumeric('kvp', value, 40, 130);
export const setRadiationTubeCurrentMa = value => setNumeric('tubeCurrentMa', value, 0.1, 20);
export const setRadiationPulseRatePps = value => setNumeric('pulseRatePps', value, 1, 30);
export const setRadiationPulseWidthMs = value => setNumeric('pulseWidthMs', value, 1, 20);
export const setRadiationDurationS = value => setNumeric('durationS', value, 0.5, 60);
export const setRadiationFieldSizeCm = value => setNumeric('fieldSizeCm', value, 5, 40);

export const setScatterHeatmapVisible = visible => {
  state.heatmapVisible = Boolean(visible);
  if (heatmapGroup) heatmapGroup.visible = state.heatmapVisible;
  emit();
};
export const toggleScatterHeatmap = () => setScatterHeatmapVisible(!state.heatmapVisible);

const isMainScene = scene => (
  scene?.background?.isColor
  && scene.background.getHex() === MAIN_SCENE_BACKGROUND
);

const findBeam = scene => {
  let beam = null;
  scene?.traverse(object => {
    if (beam || !object.isMesh) return;
    const material = object.material;
    const geometry = object.geometry;
    const color = material?.color?.getHex?.();
    if (
      geometry?.type === 'CylinderGeometry'
      && geometry?.parameters?.radialSegments === 4
      && material?.transparent
      && color === 0xffff00
    ) beam = object;
  });
  return beam;
};

const patientBox = scene => {
  const safety = scene?.getObjectByName('operating_room_safety_bubbles');
  const motion = safety?.getObjectByName('safety_patient-motion');
  const base = safety?.getObjectByName('safety_patient-table');
  const object = motion || base;
  return object ? new THREE.Box3().setFromObject(object) : null;
};

const segmentBoxHit = (start, end, box) => {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  if (length <= 1e-6) return null;
  direction.normalize();
  const ray = new THREE.Ray(start, direction);
  const hit = ray.intersectBox(box, new THREE.Vector3());
  if (!hit) return null;
  const distance = hit.distanceTo(start);
  return distance <= length ? { point: hit, distance, length } : null;
};

const beamSegment = beam => {
  if (!beam) return null;
  beam.updateMatrixWorld(true);
  const source = beam.getWorldPosition(new THREE.Vector3());
  const direction = new THREE.Vector3(0, 1, 0).applyQuaternion(beam.getWorldQuaternion(new THREE.Quaternion())).normalize();
  const worldScale = beam.getWorldScale(new THREE.Vector3());
  const sid = Math.max(0.1, Math.abs(worldScale.y));
  const detector = source.clone().addScaledVector(direction, sid);
  return { source, detector, direction, sid };
};

const objectBoxByName = (scene, name) => {
  const object = scene?.getObjectByName(name);
  if (!object) return null;
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
};

const boxProjectedWidth = box => {
  const size = box.getSize(new THREE.Vector3());
  return Math.max(size.x, size.y, size.z);
};

const angleScatterFactor = (beamDirection, patientCenter, staffPosition) => {
  const toStaff = staffPosition.clone().sub(patientCenter).normalize();
  const cosine = Math.abs(beamDirection.dot(toStaff));
  // Simplified side-scatter proxy: lateral positions receive larger weight.
  return THREE.MathUtils.clamp(0.45 + 0.55 * (1 - cosine), 0.2, 1);
};

const buildHeatmap = (scene, center) => {
  if (heatmapGroup?.parent) heatmapGroup.parent.remove(heatmapGroup);
  heatmapGroup = new THREE.Group();
  heatmapGroup.name = 'scatter_proxy_heatmap';
  heatmapGroup.visible = state.heatmapVisible;

  const spacing = 0.55;
  const radius = 0.22;
  for (let ix = -5; ix <= 5; ix += 1) {
    for (let iz = -4; iz <= 4; iz += 1) {
      const x = center.x + ix * spacing;
      const z = center.z + iz * spacing;
      const distance = Math.max(0.35, Math.hypot(x - center.x, z - center.z));
      const relative = THREE.MathUtils.clamp(1 / (distance * distance), 0, 1);
      const material = new THREE.MeshBasicMaterial({
        color: relative > 0.55 ? 0xef4444 : relative > 0.22 ? 0xf59e0b : 0x22c55e,
        transparent: true,
        opacity: 0.08 + 0.24 * relative,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const tile = new THREE.Mesh(new THREE.CircleGeometry(radius, 16), material);
      tile.rotation.x = -Math.PI / 2;
      tile.position.set(x, 0.012, z);
      heatmapGroup.add(tile);
    }
  }
  scene.add(heatmapGroup);
};

const evaluate = () => {
  const scene = state.scene;
  if (!scene) return;
  const beam = findBeam(scene);
  const segment = beamSegment(beam);
  const pBox = patientBox(scene);
  state.beamFound = Boolean(segment);
  state.ready = Boolean(segment && pBox);
  if (!segment || !pBox) {
    emit();
    return;
  }

  const patientCenter = pBox.getCenter(new THREE.Vector3());
  const patientSize = pBox.getSize(new THREE.Vector3());
  const patientHit = segmentBoxHit(segment.source, segment.detector, pBox);
  const sourceToPatientM = patientHit?.distance ?? segment.source.distanceTo(patientCenter);
  const patientThicknessM = Math.max(0.1, Math.min(patientSize.x, patientSize.y, patientSize.z));

  const outputIndex = fluoroscopyOutputIndex({
    kvp: state.kvp,
    tubeCurrentMa: state.tubeCurrentMa,
    pulseRatePps: state.pulseRatePps,
    pulseWidthMs: state.pulseWidthMs,
    durationS: state.durationS,
    sourceToPatientM,
    fieldSizeCm: state.fieldSizeCm,
  });

  const metalHits = [];
  let metalWidth = 0;
  METAL_OBJECTS.forEach(([name, label]) => {
    const box = objectBoxByName(scene, name);
    if (!box) return;
    if (segmentBoxHit(segment.source, segment.detector, box)) {
      metalHits.push(label);
      metalWidth += boxProjectedWidth(box);
    }
  });

  const severity = metalArtifactSeverity({
    intersectingObjects: metalHits.length,
    projectedMetalWidthM: metalWidth,
    sourceDetectorDistanceM: segment.sid,
  });

  const staffScatter = [];
  STAFF_OBJECTS.forEach(([name, label]) => {
    const object = scene.getObjectByName(name);
    if (!object) return;
    const position = object.getWorldPosition(new THREE.Vector3());
    const distance = Math.max(0.25, position.distanceTo(patientCenter));
    const angleFactor = angleScatterFactor(segment.direction, patientCenter, position);
    staffScatter.push({
      label,
      distance_m: distance,
      relative_scatter_index: scatterProxyIndex({
        outputIndex,
        distanceFromPatientM: distance,
        angleFactor,
        shieldingFactor: 1,
      }),
    });
  });
  staffScatter.sort((a, b) => b.relative_scatter_index - a.relative_scatter_index);

  state.outputIndex = outputIndex;
  state.kapIndex = kapProxyIndex(outputIndex, state.fieldSizeCm);
  state.metalInFov = metalHits.length > 0;
  state.metalObjects = metalHits;
  state.artifactSeverity = severity;
  state.staffScatter = staffScatter;
  state.maxStaffScatter = staffScatter[0]?.relative_scatter_index ?? null;
  state.sourceToPatientM = sourceToPatientM;
  state.patientThicknessM = patientThicknessM;

  if (!heatmapGroup) buildHeatmap(scene, patientCenter);
  if (heatmapGroup) heatmapGroup.visible = state.heatmapVisible;

  const metalSignature = metalHits.join('|');
  if (metalSignature !== lastMetalSignature) {
    lastMetalSignature = metalSignature;
    logResearchEvent('metal_fov_status', {
      metal_in_fov: state.metalInFov,
      objects: metalHits,
      artifact_severity: severity,
    });
  }

  if (beam.visible && !lastExposureVisible) {
    logResearchEvent('simulated_exposure_metrics', {
      kvp: state.kvp,
      tube_current_ma: state.tubeCurrentMa,
      pulse_rate_pps: state.pulseRatePps,
      pulse_width_ms: state.pulseWidthMs,
      duration_s: state.durationS,
      field_size_cm: state.fieldSizeCm,
      output_index: outputIndex,
      kap_proxy_index: state.kapIndex,
      metal_in_fov: state.metalInFov,
      artifact_severity: severity,
      staff_scatter: staffScatter,
      calibration_status: 'uncalibrated_relative_proxy',
    });
  }
  lastExposureVisible = Boolean(beam.visible);
  emit();
};

const captureScene = scene => {
  if (isMainScene(scene)) state.scene = scene;
};

const installRendererCapture = () => {
  previousRender = THREE.WebGLRenderer.prototype.render;
  THREE.WebGLRenderer.prototype.render = function radiationIntelligenceRender(scene, camera) {
    captureScene(scene, camera);
    return previousRender.call(this, scene, camera);
  };
};

export const installRadiationIntelligence = () => {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  installRendererCapture();
  updateTimer = window.setInterval(evaluate, UPDATE_MS);
};

installRadiationIntelligence();
