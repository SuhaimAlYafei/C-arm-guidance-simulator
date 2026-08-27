import * as THREE from 'three';
import { CONTROL_SPECS } from '../constants';
import './collisionAwarePlanner.js';
import { logResearchEvent } from './researchRunLogger.js';
import { summarizeTrials } from './researchMath.js';

const MAIN_SCENE_BACKGROUND = 0xeef2f5;
const PLANNER_HOST_FRAGMENT = 'c-arm-guidance-simulator.onrender.com';
const PLANNER_PATH_SUFFIX = '/plan';
const SAMPLE_BUDGET_PER_MESH = 48;
const LIFT_BASE_Y_M = 1.20;
const MOVE_STEP_MS = 85;
const MIN_CLEARANCE_M = 0.005;

const state = {
  scene: null,
  safetyGroup: null,
  cArmRoot: null,
  enabled: false,
  amplitudeM: 0.015,
  breathsPerMinute: 12,
  phase: 0,
  displacementM: 0,
  envelopeVisible: false,
  ready: false,
  latestPlan: null,
  latestPlanTimestamp: null,
  adaptiveStatus: 'IDLE',
  adaptiveMessage: null,
  replanCount: 0,
  robustnessResult: null,
  subscribers: new Set(),
};

let installed = false;
let previousRender = null;
let previousFetch = null;
let animationFrame = null;
let motionStartMs = null;
let dynamicBubble = null;
let dynamicEdges = null;
let baseDynamicBox = null;
let moveTimer = null;
let activeWaypoints = [];
let activeWaypointIndex = 0;
let activeFinalPose = null;

const snapshot = () => ({
  enabled: state.enabled,
  amplitudeM: state.amplitudeM,
  breathsPerMinute: state.breathsPerMinute,
  displacementM: state.displacementM,
  phase: state.phase,
  envelopeVisible: state.envelopeVisible,
  ready: state.ready,
  hasPlan: Boolean(state.latestPlan),
  latestPlanTimestamp: state.latestPlanTimestamp,
  adaptiveStatus: state.adaptiveStatus,
  adaptiveMessage: state.adaptiveMessage,
  replanCount: state.replanCount,
  robustnessResult: state.robustnessResult,
});

const emit = () => {
  const next = snapshot();
  state.subscribers.forEach(listener => {
    try { listener(next); } catch (error) { console.warn('[patient motion] subscriber failed', error); }
  });
};

export const getPatientMotionSnapshot = () => snapshot();
export const subscribePatientMotion = listener => {
  state.subscribers.add(listener);
  listener(snapshot());
  return () => state.subscribers.delete(listener);
};

const isMainScene = scene => (
  scene?.background?.isColor
  && scene.background.getHex() === MAIN_SCENE_BACKGROUND
);

const inputUrl = input => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return '';
};

const isPlannerRequest = input => {
  const url = inputUrl(input);
  return url.includes(PLANNER_HOST_FRAGMENT) && url.endsWith(PLANNER_PATH_SUFFIX);
};

const makeDynamicEnvelope = scene => {
  const safetyGroup = scene.getObjectByName('operating_room_safety_bubbles');
  const patientBase = safetyGroup?.getObjectByName('safety_patient-table');
  if (!safetyGroup || !patientBase) return false;

  state.safetyGroup = safetyGroup;
  if (dynamicBubble && dynamicBubble.parent === safetyGroup) return true;

  const baseBox = new THREE.Box3().setFromObject(patientBase);
  const center = baseBox.getCenter(new THREE.Vector3());
  const size = baseBox.getSize(new THREE.Vector3());

  // Thoracic proxy occupies the central/upper part of the existing patient envelope.
  // Its top starts at the static envelope top and rises up to amplitudeM during inspiration.
  const thoraxWidth = Math.max(0.45, size.x * 0.82);
  const thoraxDepth = Math.max(0.55, size.z * 0.46);
  const thoraxHeight = Math.max(0.24, Math.min(0.36, size.y * 0.55));
  baseDynamicBox = new THREE.Box3(
    new THREE.Vector3(
      center.x - thoraxWidth / 2,
      baseBox.max.y - thoraxHeight,
      center.z - thoraxDepth / 2,
    ),
    new THREE.Vector3(
      center.x + thoraxWidth / 2,
      baseBox.max.y,
      center.z + thoraxDepth / 2,
    ),
  );

  const dynCenter = baseDynamicBox.getCenter(new THREE.Vector3());
  const dynSize = baseDynamicBox.getSize(new THREE.Vector3());
  const material = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
  });
  dynamicBubble = new THREE.Mesh(new THREE.BoxGeometry(dynSize.x, dynSize.y, dynSize.z), material);
  dynamicBubble.name = 'safety_patient-motion';
  dynamicBubble.position.copy(dynCenter);
  dynamicBubble.visible = state.envelopeVisible;
  dynamicBubble.renderOrder = 875;

  dynamicEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(dynSize.x, dynSize.y, dynSize.z)),
    new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.9 }),
  );
  dynamicEdges.name = 'safety_edges_patient-motion';
  dynamicEdges.position.copy(dynCenter);
  dynamicEdges.visible = state.envelopeVisible;
  dynamicEdges.renderOrder = 876;

  safetyGroup.add(dynamicBubble, dynamicEdges);
  return true;
};

const updateDynamicEnvelope = displacementM => {
  if (!dynamicBubble || !dynamicEdges || !baseDynamicBox) return;
  const baseSize = baseDynamicBox.getSize(new THREE.Vector3());
  const baseCenter = baseDynamicBox.getCenter(new THREE.Vector3());
  const extra = Math.max(0, displacementM);
  const targetHeight = baseSize.y + extra;
  const scaleY = targetHeight / baseSize.y;
  const yShift = extra / 2;

  dynamicBubble.scale.set(1, scaleY, 1);
  dynamicEdges.scale.set(1, scaleY, 1);
  dynamicBubble.position.set(baseCenter.x, baseCenter.y + yShift, baseCenter.z);
  dynamicEdges.position.copy(dynamicBubble.position);
  dynamicBubble.visible = state.envelopeVisible;
  dynamicEdges.visible = state.envelopeVisible;
  dynamicBubble.updateMatrixWorld(true);
  dynamicEdges.updateMatrixWorld(true);
};

const motionLoop = now => {
  if (motionStartMs == null) motionStartMs = now;
  const elapsedS = (now - motionStartMs) / 1000;
  const hz = Math.max(1, state.breathsPerMinute) / 60;
  const phase = (elapsedS * hz * Math.PI * 2) % (Math.PI * 2);
  const normalized = state.enabled ? (0.5 + 0.5 * Math.sin(phase - Math.PI / 2)) : 0;
  const displacement = state.enabled ? state.amplitudeM * normalized : 0;

  const changed = Math.abs(displacement - state.displacementM) > 0.0005;
  state.phase = phase;
  state.displacementM = displacement;
  updateDynamicEnvelope(displacement);
  if (changed) emit();
  animationFrame = requestAnimationFrame(motionLoop);
};

export const setPatientMotionEnabled = enabled => {
  state.enabled = Boolean(enabled);
  state.adaptiveMessage = state.enabled
    ? 'Dynamic respiratory envelope active. Adaptive MOVE will re-check the remaining path.'
    : 'Patient motion disabled.';
  logResearchEvent('patient_motion_toggle', {
    enabled: state.enabled,
    amplitude_mm: state.amplitudeM * 1000,
    breaths_per_minute: state.breathsPerMinute,
  });
  emit();
};

export const togglePatientMotion = () => setPatientMotionEnabled(!state.enabled);

export const setPatientMotionAmplitudeMm = value => {
  state.amplitudeM = THREE.MathUtils.clamp(Number(value) / 1000, 0, 0.04);
  logResearchEvent('patient_motion_amplitude', { amplitude_mm: state.amplitudeM * 1000 });
  emit();
};

export const setPatientBreathingRate = value => {
  state.breathsPerMinute = THREE.MathUtils.clamp(Number(value) || 12, 4, 30);
  logResearchEvent('patient_motion_rate', { breaths_per_minute: state.breathsPerMinute });
  emit();
};

export const setPatientMotionEnvelopeVisible = visible => {
  state.envelopeVisible = Boolean(visible);
  if (dynamicBubble) dynamicBubble.visible = state.envelopeVisible;
  if (dynamicEdges) dynamicEdges.visible = state.envelopeVisible;
  emit();
};

export const togglePatientMotionEnvelope = () => setPatientMotionEnvelopeVisible(!state.envelopeVisible);

const firstGroupChild = object => object?.children?.find(child => child?.isGroup) || null;

const findCArmRoot = scene => {
  let best = null;
  let bestScore = -Infinity;
  scene?.children?.forEach(child => {
    if (!child?.isGroup) return;
    if (child.userData?.operatingRoomEnvironment || child.userData?.operatingRoomSafety) return;
    let meshes = 0;
    let toruses = 0;
    child.traverse(object => {
      if (!object.isMesh) return;
      meshes += 1;
      if (object.geometry?.type === 'TorusGeometry') toruses += 1;
    });
    if (toruses < 2 || meshes < 8) return;
    const score = toruses * 30 + meshes;
    if (score > bestScore) {
      best = child;
      bestScore = score;
    }
  });
  return best;
};

const resolveRig = scene => {
  const cartRoot = findCArmRoot(scene);
  if (!cartRoot) return null;
  const columnBase = firstGroupChild(cartRoot);
  const columnRot = firstGroupChild(columnBase);
  const lift = firstGroupChild(columnRot);
  const shoulder = firstGroupChild(lift);
  const wigWag = firstGroupChild(shoulder);
  const cSlide = firstGroupChild(wigWag);
  if (!columnRot || !lift || !wigWag || !cSlide) return null;
  return { cartRoot, columnRot, lift, wigWag, cSlide };
};

const normalizePose = pose => ({
  lift: Number(pose?.lift ?? 0),
  column_rot: Number(pose?.column_rot ?? 0),
  wig_wag: Number(pose?.wig_wag ?? 0),
  orbital_slide: Number(pose?.orbital_slide ?? 0),
  cart_x: Number(pose?.cart_x ?? 0),
  cart_z: Number(pose?.cart_z ?? 0),
});

const currentPose = rig => ({
  lift: rig.lift.position.y - LIFT_BASE_Y_M,
  column_rot: rig.columnRot.rotation.y,
  wig_wag: rig.wigWag.rotation.z,
  orbital_slide: rig.cSlide.rotation.x,
  cart_x: rig.cartRoot.position.x,
  cart_z: rig.cartRoot.position.z,
});

const applyPose = (rig, pose) => {
  const p = normalizePose(pose);
  rig.cartRoot.position.x = p.cart_x;
  rig.cartRoot.position.z = p.cart_z;
  rig.columnRot.rotation.y = p.column_rot;
  rig.lift.position.y = LIFT_BASE_Y_M + p.lift;
  rig.wigWag.rotation.z = p.wig_wag;
  rig.cSlide.rotation.x = p.orbital_slide;
  state.scene?.updateMatrixWorld(true);
};

const obstacleBoxes = () => {
  const group = state.scene?.getObjectByName('operating_room_safety_bubbles');
  if (!group) return [];
  group.updateMatrixWorld(true);
  return group.children
    .filter(child => child?.isMesh && child.name?.startsWith('safety_'))
    .map(mesh => ({ id: mesh.name.slice(7), box: new THREE.Box3().setFromObject(mesh) }));
};

const sampleRigPoints = rig => {
  const points = [];
  rig.cartRoot.traverse(mesh => {
    if (!mesh.isMesh || mesh.visible === false) return;
    const attr = mesh.geometry?.attributes?.position;
    if (!attr?.count) return;
    const step = Math.max(1, Math.ceil(attr.count / SAMPLE_BUDGET_PER_MESH));
    const point = new THREE.Vector3();
    for (let index = 0; index < attr.count; index += step) {
      point.fromBufferAttribute(attr, index).applyMatrix4(mesh.matrixWorld);
      points.push(point.clone());
    }
  });
  return points;
};

const evaluateRig = rig => {
  state.scene.updateMatrixWorld(true);
  const points = sampleRigPoints(rig);
  const boxes = obstacleBoxes();
  let collision = false;
  let minimumClearanceM = Infinity;
  const collisions = [];
  for (const obstacle of boxes) {
    let obstacleMin = Infinity;
    for (const point of points) {
      if (obstacle.box.containsPoint(point)) {
        obstacleMin = 0;
        collision = true;
        collisions.push(obstacle.id);
        break;
      }
      obstacleMin = Math.min(obstacleMin, obstacle.box.distanceToPoint(point));
    }
    minimumClearanceM = Math.min(minimumClearanceM, obstacleMin);
  }
  return {
    collision,
    collisions,
    minimumClearanceM: Number.isFinite(minimumClearanceM) ? minimumClearanceM : null,
  };
};

const saveRig = rig => ({
  cart: rig.cartRoot.position.clone(),
  column: rig.columnRot.rotation.clone(),
  lift: rig.lift.position.clone(),
  wig: rig.wigWag.rotation.clone(),
  slide: rig.cSlide.rotation.clone(),
});

const restoreRig = (rig, saved) => {
  rig.cartRoot.position.copy(saved.cart);
  rig.columnRot.rotation.copy(saved.column);
  rig.lift.position.copy(saved.lift);
  rig.wigWag.rotation.copy(saved.wig);
  rig.cSlide.rotation.copy(saved.slide);
  state.scene.updateMatrixWorld(true);
};

const routeStats = (rig, waypoints) => {
  const saved = saveRig(rig);
  let collision = false;
  let minimumClearanceM = Infinity;
  const collisions = new Set();
  try {
    for (const waypoint of waypoints) {
      applyPose(rig, waypoint.pose || waypoint);
      const result = evaluateRig(rig);
      result.collisions.forEach(id => collisions.add(id));
      collision = collision || result.collision;
      minimumClearanceM = Math.min(minimumClearanceM, result.minimumClearanceM ?? Infinity);
    }
  } finally {
    restoreRig(rig, saved);
  }
  return {
    collision,
    collisions: [...collisions],
    minimumClearanceM: Number.isFinite(minimumClearanceM) ? minimumClearanceM : null,
  };
};

const smootherstep = value => {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

const interpolatePose = (a, b, t) => {
  const e = smootherstep(t);
  const lerp = key => THREE.MathUtils.lerp(Number(a[key] || 0), Number(b[key] || 0), e);
  return {
    lift: lerp('lift'),
    column_rot: lerp('column_rot'),
    wig_wag: lerp('wig_wag'),
    orbital_slide: lerp('orbital_slide'),
    cart_x: lerp('cart_x'),
    cart_z: lerp('cart_z'),
  };
};

const piecewise = controls => {
  const clean = controls.map(normalizePose);
  const output = [];
  clean.slice(0, -1).forEach((start, segment) => {
    const end = clean[segment + 1];
    const steps = 6;
    for (let i = segment === 0 ? 0 : 1; i <= steps; i += 1) {
      output.push({ pose: interpolatePose(start, end, i / steps), phase: 'adaptive_replan' });
    }
  });
  return output;
};

const candidateRoutes = (start, final) => {
  const safeLiftValues = [
    CONTROL_SPECS.lift.max,
    Math.max(CONTROL_SPECS.lift.min, CONTROL_SPECS.lift.max - 0.08),
  ];
  const corridorZ = [
    CONTROL_SPECS.cart_z.min + 0.06,
    0,
    CONTROL_SPECS.cart_z.max - 0.06,
  ];
  const routes = [];
  safeLiftValues.forEach(lift => corridorZ.forEach(z => {
    routes.push(piecewise([
      start,
      { ...start, lift },
      { ...start, lift, cart_z: z },
      { ...start, lift, cart_z: z, column_rot: final.column_rot, wig_wag: final.wig_wag, orbital_slide: final.orbital_slide },
      { ...final, lift, cart_z: z },
      { ...final, lift },
      final,
    ]));
  }));
  return routes;
};

const findAdaptiveReroute = (rig, start, final) => {
  let best = null;
  candidateRoutes(start, final).forEach(route => {
    const stats = routeStats(rig, route);
    if (stats.collision || (stats.minimumClearanceM ?? 0) < MIN_CLEARANCE_M) return;
    if (!best || (stats.minimumClearanceM ?? 0) > (best.stats.minimumClearanceM ?? 0)) {
      best = { route, stats };
    }
  });
  return best;
};

const finishAdaptiveMove = (status, message) => {
  if (moveTimer) clearInterval(moveTimer);
  moveTimer = null;
  activeWaypoints = [];
  activeWaypointIndex = 0;
  state.adaptiveStatus = status;
  state.adaptiveMessage = message;
  logResearchEvent('adaptive_move_finished', {
    status,
    message,
    replan_count: state.replanCount,
  });
  emit();
};

export const startAdaptiveMove = () => {
  if (!state.enabled) {
    state.adaptiveStatus = 'DISABLED';
    state.adaptiveMessage = 'Enable patient motion before using adaptive MOVE.';
    emit();
    return false;
  }
  const rig = state.scene ? resolveRig(state.scene) : null;
  const plan = state.latestPlan;
  if (!rig || !Array.isArray(plan?.waypoints) || plan.waypoints.length < 2) {
    state.adaptiveStatus = 'NO_PLAN';
    state.adaptiveMessage = 'Run PREVIEW PATH first.';
    emit();
    return false;
  }

  if (moveTimer) clearInterval(moveTimer);
  activeWaypoints = plan.waypoints.map(item => ({ ...item, pose: normalizePose(item.pose) }));
  activeWaypointIndex = 0;
  activeFinalPose = normalizePose(plan.final_pose || activeWaypoints.at(-1).pose);
  state.adaptiveStatus = 'MOVING';
  state.adaptiveMessage = 'Adaptive move running with live respiratory envelope checks.';
  state.replanCount = 0;
  logResearchEvent('adaptive_move_started', {
    waypoints: activeWaypoints.length,
    breathing_amplitude_mm: state.amplitudeM * 1000,
    breaths_per_minute: state.breathsPerMinute,
  });
  emit();

  moveTimer = window.setInterval(() => {
    if (!state.enabled) {
      finishAdaptiveMove('PAUSED', 'Patient motion was disabled during adaptive move.');
      return;
    }
    const liveRig = resolveRig(state.scene);
    if (!liveRig) {
      finishAdaptiveMove('ERROR', 'C-arm rig could not be resolved.');
      return;
    }
    if (activeWaypointIndex >= activeWaypoints.length) {
      finishAdaptiveMove('ARRIVED', 'Adaptive route completed.');
      return;
    }

    const nextWaypoint = activeWaypoints[activeWaypointIndex];
    const saved = saveRig(liveRig);
    applyPose(liveRig, nextWaypoint.pose);
    const check = evaluateRig(liveRig);
    restoreRig(liveRig, saved);

    if (check.collision || (check.minimumClearanceM ?? 0) < MIN_CLEARANCE_M) {
      const start = currentPose(liveRig);
      const reroute = findAdaptiveReroute(liveRig, start, activeFinalPose);
      if (!reroute) {
        finishAdaptiveMove(
          'BLOCKED',
          `Patient/OR motion invalidated the route; no safe simulated reroute found (${check.collisions.join(', ') || 'clearance'}).`,
        );
        return;
      }
      activeWaypoints = reroute.route;
      activeWaypointIndex = 0;
      state.replanCount += 1;
      state.adaptiveStatus = 'REPLANNED';
      state.adaptiveMessage = `Live replan #${state.replanCount}: ${(reroute.stats.minimumClearanceM * 100).toFixed(1)} cm minimum sampled clearance.`;
      logResearchEvent('adaptive_replan', {
        replan_count: state.replanCount,
        minimum_clearance_m: reroute.stats.minimumClearanceM,
        respiratory_displacement_mm: state.displacementM * 1000,
        blocked_by: check.collisions,
      });
      emit();
      return;
    }

    applyPose(liveRig, nextWaypoint.pose);
    activeWaypointIndex += 1;
  }, MOVE_STEP_MS);
  return true;
};

export const stopAdaptiveMove = () => finishAdaptiveMove('STOPPED', 'Adaptive move stopped.');

export const runRespiratoryRobustnessSweep = () => {
  const rig = state.scene ? resolveRig(state.scene) : null;
  const plan = state.latestPlan;
  if (!rig || !Array.isArray(plan?.waypoints) || !dynamicBubble) {
    state.robustnessResult = { error: 'Run PREVIEW PATH after the motion envelope is ready.' };
    emit();
    return state.robustnessResult;
  }

  const previousEnabled = state.enabled;
  const previousDisplacement = state.displacementM;
  const trials = [];
  const phases = 24;
  for (let index = 0; index < phases; index += 1) {
    const phase = (index / phases) * Math.PI * 2;
    const normalized = 0.5 + 0.5 * Math.sin(phase - Math.PI / 2);
    const displacementM = state.amplitudeM * normalized;
    updateDynamicEnvelope(displacementM);
    const stats = routeStats(rig, plan.waypoints);
    trials.push({
      phase_index: index,
      respiratory_displacement_mm: displacementM * 1000,
      collision: stats.collision,
      minimumClearanceM: stats.minimumClearanceM,
      collision_objects: stats.collisions,
    });
  }
  updateDynamicEnvelope(previousEnabled ? previousDisplacement : 0);

  const summary = summarizeTrials(trials);
  state.robustnessResult = { ...summary, phases, trials };
  logResearchEvent('respiratory_robustness_sweep', state.robustnessResult);
  emit();
  return state.robustnessResult;
};

const installPlanCapture = () => {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  previousFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await previousFetch(...args);
    if (!isPlannerRequest(args[0])) return response;
    try {
      if (response.ok) {
        const payload = await response.clone().json();
        if (Array.isArray(payload?.waypoints) && payload.waypoints.length >= 2) {
          state.latestPlan = payload;
          state.latestPlanTimestamp = new Date().toISOString();
          state.adaptiveStatus = 'PLAN_READY';
          state.adaptiveMessage = 'Latest preview captured for dynamic-motion validation.';
          logResearchEvent('plan_captured_for_motion', {
            waypoint_count: payload.waypoints.length,
            rerouted: Boolean(payload.collision_avoidance?.rerouted),
            minimum_clearance_m: payload.collision_avoidance?.minimum_clearance_m ?? null,
          });
          emit();
        }
      }
    } catch (error) {
      console.warn('[patient motion] planner capture failed', error);
    }
    return response;
  };
};

const installMoveInterceptor = () => {
  document.addEventListener('click', event => {
    if (!state.enabled || !state.latestPlan || event.defaultPrevented) return;
    const button = event.target?.closest?.('button');
    if (!button) return;
    const label = (button.textContent || '').trim().toUpperCase();
    if (!label.includes('MOVE C-ARM')) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    startAdaptiveMove();
  }, true);
};

const captureScene = scene => {
  if (!isMainScene(scene)) return;
  state.scene = scene;
  state.cArmRoot = state.cArmRoot || findCArmRoot(scene);
  const envelopeReady = makeDynamicEnvelope(scene);
  const ready = Boolean(envelopeReady && state.cArmRoot);
  if (ready !== state.ready) {
    state.ready = ready;
    emit();
  }
};

const installRendererCapture = () => {
  previousRender = THREE.WebGLRenderer.prototype.render;
  THREE.WebGLRenderer.prototype.render = function patientMotionRender(scene, camera) {
    captureScene(scene, camera);
    return previousRender.call(this, scene, camera);
  };
};

export const installPatientMotionRuntime = () => {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  installRendererCapture();
  installPlanCapture();
  installMoveInterceptor();
  animationFrame = requestAnimationFrame(motionLoop);
};

installPatientMotionRuntime();
