import * as THREE from 'three';
import { CONTROL_SPECS } from '../constants';

const MAIN_SCENE_BACKGROUND = 0xeef2f5;
const PLANNER_PATH_SUFFIX = '/plan';
const PLANNER_HOST_FRAGMENT = 'c-arm-guidance-simulator.onrender.com';
const SAMPLE_BUDGET_PER_MESH = 64;
const MIN_ACCEPTED_CLEARANCE_M = 0.005;
const NEAR_CLEARANCE_M = 0.08;
const LIFT_BASE_Y_M = 1.20;

const state = {
  scene: null,
  status: 'IDLE',
  reason: null,
  rerouted: false,
  minClearanceM: null,
  avoidedLabels: [],
  checkedWaypoints: 0,
  subscribers: new Set(),
};

let installed = false;
let originalFetch = null;
let previousSceneAdd = null;

const snapshot = () => ({
  status: state.status,
  reason: state.reason,
  rerouted: state.rerouted,
  minClearanceM: state.minClearanceM,
  avoidedLabels: [...state.avoidedLabels],
  checkedWaypoints: state.checkedWaypoints,
});

const emit = () => {
  const next = snapshot();
  state.subscribers.forEach(listener => {
    try {
      listener(next);
    } catch (error) {
      console.warn('[collision planner] subscriber failed', error);
    }
  });
};

const updateState = (patch) => {
  Object.assign(state, patch);
  emit();
};

export const getCollisionPlannerSnapshot = () => snapshot();

export const subscribeCollisionPlanner = (listener) => {
  state.subscribers.add(listener);
  listener(snapshot());
  return () => state.subscribers.delete(listener);
};

const inputUrl = (input) => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return '';
};

const isPlannerRequest = (input) => {
  const url = inputUrl(input);
  return url.includes(PLANNER_HOST_FRAGMENT) && url.endsWith(PLANNER_PATH_SUFFIX);
};

const findMainScene = (scene) => {
  if (!scene?.background?.isColor) return false;
  return scene.background.getHex() === MAIN_SCENE_BACKGROUND;
};

const installSceneCapture = () => {
  previousSceneAdd = THREE.Scene.prototype.add;
  THREE.Scene.prototype.add = function collisionPlannerSceneAdd(...objects) {
    const result = previousSceneAdd.apply(this, objects);
    if (findMainScene(this)) state.scene = this;
    return result;
  };
};

const firstGroupChild = (object) => object?.children?.find(child => child?.isGroup) || null;

const findCArmRoot = (scene) => {
  let best = null;
  let bestScore = -Infinity;

  scene.children.forEach(child => {
    if (!child?.isGroup) return;
    if (child.userData?.operatingRoomEnvironment || child.userData?.operatingRoomSafety) return;

    let meshCount = 0;
    let torusCount = 0;
    let cylinderCount = 0;
    child.traverse(object => {
      if (!object.isMesh) return;
      meshCount += 1;
      if (object.geometry?.type === 'TorusGeometry') torusCount += 1;
      if (object.geometry?.type === 'CylinderGeometry') cylinderCount += 1;
    });

    if (torusCount < 2 || meshCount < 8) return;
    const score = torusCount * 30 + cylinderCount * 2 + meshCount;
    if (score > bestScore) {
      best = child;
      bestScore = score;
    }
  });

  return best;
};

const resolveRig = (scene) => {
  const cartRoot = findCArmRoot(scene);
  if (!cartRoot) return null;

  const columnBase = firstGroupChild(cartRoot);
  const columnRot = firstGroupChild(columnBase);
  const lift = firstGroupChild(columnRot);
  const shoulder = firstGroupChild(lift);
  const wigWag = firstGroupChild(shoulder);
  const cSlide = firstGroupChild(wigWag);

  if (!columnBase || !columnRot || !lift || !shoulder || !wigWag || !cSlide) {
    return null;
  }

  return { cartRoot, columnRot, lift, wigWag, cSlide };
};

const saveRigState = (rig) => ({
  cartPosition: rig.cartRoot.position.clone(),
  columnRotation: rig.columnRot.rotation.clone(),
  liftPosition: rig.lift.position.clone(),
  wigWagRotation: rig.wigWag.rotation.clone(),
  slideRotation: rig.cSlide.rotation.clone(),
});

const restoreRigState = (rig, saved) => {
  rig.cartRoot.position.copy(saved.cartPosition);
  rig.columnRot.rotation.copy(saved.columnRotation);
  rig.lift.position.copy(saved.liftPosition);
  rig.wigWag.rotation.copy(saved.wigWagRotation);
  rig.cSlide.rotation.copy(saved.slideRotation);
};

const normalizePose = (pose) => ({
  lift: Number(pose?.lift ?? 0),
  column_rot: Number(pose?.column_rot ?? 0),
  wig_wag: Number(pose?.wig_wag ?? 0),
  orbital_slide: Number(pose?.orbital_slide ?? 0),
  cart_x: Number(pose?.cart_x ?? 0),
  cart_z: Number(pose?.cart_z ?? 0),
});

const applyPose = (rig, pose) => {
  const p = normalizePose(pose);
  rig.cartRoot.position.x = p.cart_x;
  rig.cartRoot.position.z = p.cart_z;
  rig.columnRot.rotation.y = p.column_rot;
  rig.lift.position.y = LIFT_BASE_Y_M + p.lift;
  rig.wigWag.rotation.z = p.wig_wag;
  rig.cSlide.rotation.x = p.orbital_slide;
};

const labelForObstacle = (id) => ({
  'iv-pole': 'IV pole',
  'mayo-stand': 'Mayo stand',
  'instrument-trolley': 'Instrument trolley',
  anesthesia: 'Anesthesia workstation',
  'monitor-cart': 'C-arm monitor cart',
  surgeon: 'Surgeon',
  'scrub-nurse': 'Scrub nurse',
  'surgical-light': 'Surgical light',
  'patient-table': 'Patient / operating table',
}[id] || id.replaceAll('-', ' '));

const obstacleEntries = (scene) => {
  const safetyGroup = scene.getObjectByName('operating_room_safety_bubbles');
  if (!safetyGroup) return [];

  safetyGroup.updateMatrixWorld(true);
  return safetyGroup.children
    .filter(child => child?.isMesh && child.name?.startsWith('safety_'))
    .map(mesh => {
      const id = mesh.name.slice('safety_'.length);
      return {
        id,
        label: labelForObstacle(id),
        box: new THREE.Box3().setFromObject(mesh),
      };
    });
};

const sampleMeshWorldPoints = (mesh, output) => {
  const attr = mesh.geometry?.attributes?.position;
  if (!attr?.count) return;

  const step = Math.max(1, Math.ceil(attr.count / SAMPLE_BUDGET_PER_MESH));
  const point = new THREE.Vector3();
  for (let index = 0; index < attr.count; index += step) {
    point.fromBufferAttribute(attr, index).applyMatrix4(mesh.matrixWorld);
    output.push(point.clone());
  }

  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  if (!box) return;

  [
    [box.min.x, box.min.y, box.min.z], [box.min.x, box.min.y, box.max.z],
    [box.min.x, box.max.y, box.min.z], [box.min.x, box.max.y, box.max.z],
    [box.max.x, box.min.y, box.min.z], [box.max.x, box.min.y, box.max.z],
    [box.max.x, box.max.y, box.min.z], [box.max.x, box.max.y, box.max.z],
  ].forEach(([x, y, z]) => output.push(new THREE.Vector3(x, y, z).applyMatrix4(mesh.matrixWorld)));
};

const sampleRigWorldPoints = (rig) => {
  const points = [];
  rig.cartRoot.traverse(object => {
    if (object.isMesh && object.visible !== false) sampleMeshWorldPoints(object, points);
  });
  return points;
};

const evaluateCurrentRig = (scene, rig, obstacles) => {
  scene.updateMatrixWorld(true);
  const points = sampleRigWorldPoints(rig);
  const collisions = [];
  let minClearanceM = Infinity;
  let closestLabel = null;

  obstacles.forEach(obstacle => {
    let obstacleMin = Infinity;
    let collides = false;
    for (const point of points) {
      if (obstacle.box.containsPoint(point)) {
        collides = true;
        obstacleMin = 0;
        break;
      }
      obstacleMin = Math.min(obstacleMin, obstacle.box.distanceToPoint(point));
    }

    if (collides) collisions.push(obstacle.label);
    if (obstacleMin < minClearanceM) {
      minClearanceM = obstacleMin;
      closestLabel = obstacle.label;
    }
  });

  return {
    collision: collisions.length > 0,
    collisions,
    minClearanceM: Number.isFinite(minClearanceM) ? minClearanceM : null,
    closestLabel,
  };
};

const evaluatePose = (scene, rig, obstacles, pose) => {
  const saved = saveRigState(rig);
  try {
    applyPose(rig, pose);
    return evaluateCurrentRig(scene, rig, obstacles);
  } finally {
    restoreRigState(rig, saved);
    scene.updateMatrixWorld(true);
  }
};

const routeStats = (scene, rig, obstacles, waypoints) => {
  const saved = saveRigState(rig);
  const hitLabels = new Set();
  let minClearanceM = Infinity;
  let closestLabel = null;

  try {
    for (const waypoint of waypoints) {
      applyPose(rig, waypoint.pose);
      const result = evaluateCurrentRig(scene, rig, obstacles);
      result.collisions.forEach(label => hitLabels.add(label));
      if ((result.minClearanceM ?? Infinity) < minClearanceM) {
        minClearanceM = result.minClearanceM ?? Infinity;
        closestLabel = result.closestLabel;
      }
    }
  } finally {
    restoreRigState(rig, saved);
    scene.updateMatrixWorld(true);
  }

  return {
    collision: hitLabels.size > 0,
    collisions: [...hitLabels],
    minClearanceM: Number.isFinite(minClearanceM) ? minClearanceM : null,
    closestLabel,
    checkedWaypoints: waypoints.length,
  };
};

const smootherstep = (value) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

const interpolate = (a, b, t) => a + (b - a) * t;

const interpolatePose = (start, end, t) => {
  const e = smootherstep(t);
  return {
    lift: interpolate(start.lift, end.lift, e),
    column_rot: interpolate(start.column_rot, end.column_rot, e),
    wig_wag: interpolate(start.wig_wag, end.wig_wag, e),
    orbital_slide: interpolate(start.orbital_slide, end.orbital_slide, e),
    cart_x: interpolate(start.cart_x, end.cart_x, e),
    cart_z: interpolate(start.cart_z, end.cart_z, e),
  };
};

const poseDistance = (a, b) => Math.hypot(
  b.lift - a.lift,
  b.cart_x - a.cart_x,
  b.cart_z - a.cart_z,
  0.35 * (b.column_rot - a.column_rot),
  0.35 * (b.wig_wag - a.wig_wag),
  0.35 * (b.orbital_slide - a.orbital_slide),
);

const dedupeControlPoses = (poses) => poses.filter((pose, index) => {
  if (index === 0) return true;
  return poseDistance(poses[index - 1], pose) > 1e-6;
});

const piecewiseWaypoints = (controlPoses, count) => {
  const controls = dedupeControlPoses(controlPoses.map(normalizePose));
  if (controls.length < 2) return [];

  const segmentWeights = [];
  let total = 0;
  for (let index = 0; index < controls.length - 1; index += 1) {
    const weight = Math.max(1e-4, poseDistance(controls[index], controls[index + 1]));
    segmentWeights.push(weight);
    total += weight;
  }

  const cumulative = [0];
  let running = 0;
  segmentWeights.forEach(weight => {
    running += weight / total;
    cumulative.push(running);
  });
  cumulative[cumulative.length - 1] = 1;

  const waypointCount = Math.max(Number(count) || 21, controls.length * 3, 15);
  const waypoints = [];

  for (let index = 0; index < waypointCount; index += 1) {
    const progress = index / (waypointCount - 1);
    let segment = cumulative.length - 2;
    for (let candidate = 0; candidate < cumulative.length - 1; candidate += 1) {
      if (progress <= cumulative[candidate + 1] + 1e-9) {
        segment = candidate;
        break;
      }
    }

    const segmentStart = cumulative[segment];
    const segmentEnd = cumulative[segment + 1];
    const localT = segmentEnd > segmentStart
      ? (progress - segmentStart) / (segmentEnd - segmentStart)
      : 0;

    waypoints.push({
      index,
      progress,
      phase: index === 0
        ? 'start'
        : index === waypointCount - 1
          ? 'final_alignment'
          : 'collision_avoidance',
      pose: interpolatePose(controls[segment], controls[segment + 1], localT),
    });
  }

  waypoints[0].pose = { ...controls[0] };
  waypoints[waypoints.length - 1].pose = { ...controls[controls.length - 1] };
  return waypoints;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const uniqueNumbers = (values) => [...new Set(values.map(value => Number(value.toFixed(5))))];

const candidateControlRoutes = (start, final) => {
  const safeLiftCandidates = uniqueNumbers([
    CONTROL_SPECS.lift.max,
    CONTROL_SPECS.lift.max - 0.08,
    clamp(Math.max(start.lift, final.lift), CONTROL_SPECS.lift.min, CONTROL_SPECS.lift.max),
  ]).filter(value => value >= CONTROL_SPECS.lift.min && value <= CONTROL_SPECS.lift.max);

  const zCandidates = uniqueNumbers([
    CONTROL_SPECS.cart_z.min + 0.05,
    CONTROL_SPECS.cart_z.max - 0.05,
    0,
    start.cart_z,
    final.cart_z,
  ]).filter(value => value >= CONTROL_SPECS.cart_z.min && value <= CONTROL_SPECS.cart_z.max);

  const candidates = [];
  safeLiftCandidates.forEach(safeLift => {
    zCandidates.forEach(corridorZ => {
      const raisedStart = { ...start, lift: safeLift };
      const corridorStart = { ...raisedStart, cart_z: corridorZ };
      const rotated = {
        ...corridorStart,
        column_rot: final.column_rot,
        wig_wag: final.wig_wag,
        orbital_slide: final.orbital_slide,
      };
      const traversed = { ...rotated, cart_x: final.cart_x };
      const approach = { ...traversed, cart_z: final.cart_z };
      const finalHeight = { ...approach, lift: final.lift };

      candidates.push([
        start,
        raisedStart,
        corridorStart,
        rotated,
        traversed,
        approach,
        finalHeight,
        final,
      ]);

      const lateralFirst = { ...start, cart_z: corridorZ };
      candidates.push([
        start,
        lateralFirst,
        { ...lateralFirst, lift: safeLift },
        rotated,
        traversed,
        approach,
        finalHeight,
        final,
      ]);
    });
  });
  return candidates;
};

const buildBlockedResponse = (sourceResponse, detail, metadata) => {
  const headers = new Headers(sourceResponse.headers);
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify({ detail, collision_avoidance: metadata }), {
    status: 409,
    statusText: 'Collision-free path unavailable',
    headers,
  });
};

const buildModifiedResponse = (sourceResponse, payload) => {
  const headers = new Headers(sourceResponse.headers);
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(payload), {
    status: sourceResponse.status,
    statusText: sourceResponse.statusText,
    headers,
  });
};

const collisionAwarePlannerResponse = async (sourceResponse) => {
  if (!sourceResponse.ok) return sourceResponse;

  const payload = await sourceResponse.clone().json();
  if (!Array.isArray(payload?.waypoints) || payload.waypoints.length < 2) return sourceResponse;

  const scene = state.scene;
  const rig = scene ? resolveRig(scene) : null;
  const obstacles = scene ? obstacleEntries(scene) : [];
  if (!scene || !rig || obstacles.length === 0) {
    updateState({
      status: 'UNAVAILABLE',
      reason: 'OR geometry is not ready; planner response was left unchanged.',
      rerouted: false,
      minClearanceM: null,
      avoidedLabels: [],
      checkedWaypoints: 0,
    });
    return sourceResponse;
  }

  updateState({ status: 'CHECKING', reason: null, rerouted: false, avoidedLabels: [] });

  const directStats = routeStats(scene, rig, obstacles, payload.waypoints);
  if (!directStats.collision && (directStats.minClearanceM ?? Infinity) >= MIN_ACCEPTED_CLEARANCE_M) {
    const metadata = {
      checked: true,
      rerouted: false,
      status: directStats.minClearanceM != null && directStats.minClearanceM <= NEAR_CLEARANCE_M ? 'NEAR' : 'CLEAR',
      minimum_clearance_m: directStats.minClearanceM,
      checked_waypoints: directStats.checkedWaypoints,
      avoided_obstacles: [],
      method: 'live_threejs_scene_sampling',
    };
    payload.collision_avoidance = metadata;
    payload.explanation = [
      ...(payload.explanation || []),
      `OR collision check passed across ${directStats.checkedWaypoints} waypoints.`,
    ];
    updateState({
      status: metadata.status === 'NEAR' ? 'DIRECT_NEAR' : 'DIRECT_CLEAR',
      reason: directStats.closestLabel ? `Closest object: ${directStats.closestLabel}` : null,
      rerouted: false,
      minClearanceM: directStats.minClearanceM,
      avoidedLabels: [],
      checkedWaypoints: directStats.checkedWaypoints,
    });
    return buildModifiedResponse(sourceResponse, payload);
  }

  const start = normalizePose(payload.start_pose || payload.waypoints[0].pose);
  const final = normalizePose(payload.final_pose || payload.waypoints[payload.waypoints.length - 1].pose);
  const finalCheck = evaluatePose(scene, rig, obstacles, final);
  if (finalCheck.collision) {
    const detail = `Target pose conflicts with ${finalCheck.collisions.join(', ')}. Reposition the OR object or choose another projection.`;
    updateState({
      status: 'BLOCKED',
      reason: detail,
      rerouted: false,
      minClearanceM: 0,
      avoidedLabels: finalCheck.collisions,
      checkedWaypoints: directStats.checkedWaypoints,
    });
    return buildBlockedResponse(sourceResponse, detail, {
      checked: true,
      rerouted: false,
      status: 'BLOCKED_FINAL_POSE',
      minimum_clearance_m: 0,
      checked_waypoints: directStats.checkedWaypoints,
      avoided_obstacles: finalCheck.collisions,
      method: 'live_threejs_scene_sampling',
    });
  }

  let best = null;
  const candidateRoutes = candidateControlRoutes(start, final);
  for (const controls of candidateRoutes) {
    const waypoints = piecewiseWaypoints(controls, payload.waypoints.length);
    const stats = routeStats(scene, rig, obstacles, waypoints);
    if (stats.collision) continue;
    if ((stats.minClearanceM ?? 0) < MIN_ACCEPTED_CLEARANCE_M) continue;

    if (!best || (stats.minClearanceM ?? 0) > (best.stats.minClearanceM ?? 0)) {
      best = { waypoints, stats };
    }
  }

  if (!best) {
    const labels = directStats.collisions.length > 0 ? directStats.collisions : [directStats.closestLabel].filter(Boolean);
    const detail = `No collision-free route was found within the simulated C-arm limits${labels.length ? `; blocked by ${labels.join(', ')}` : ''}.`;
    updateState({
      status: 'BLOCKED',
      reason: detail,
      rerouted: false,
      minClearanceM: directStats.minClearanceM,
      avoidedLabels: labels,
      checkedWaypoints: directStats.checkedWaypoints,
    });
    return buildBlockedResponse(sourceResponse, detail, {
      checked: true,
      rerouted: false,
      status: 'BLOCKED',
      minimum_clearance_m: directStats.minClearanceM,
      checked_waypoints: directStats.checkedWaypoints,
      avoided_obstacles: labels,
      method: 'live_threejs_scene_sampling',
    });
  }

  const avoided = directStats.collisions;
  payload.waypoints = best.waypoints;
  payload.collision_avoidance = {
    checked: true,
    rerouted: true,
    status: best.stats.minClearanceM != null && best.stats.minClearanceM <= NEAR_CLEARANCE_M ? 'NEAR' : 'CLEAR',
    minimum_clearance_m: best.stats.minClearanceM,
    checked_waypoints: best.stats.checkedWaypoints,
    avoided_obstacles: avoided,
    method: 'live_threejs_scene_sampling_staged_search',
  };
  payload.explanation = [
    ...(payload.explanation || []),
    `Direct path conflicted with ${avoided.join(', ')}.`,
    `Generated a scene-checked avoidance path with ${((best.stats.minClearanceM ?? 0) * 100).toFixed(1)} cm minimum sampled clearance outside the safety envelopes.`,
  ];

  updateState({
    status: 'REROUTED',
    reason: avoided.length ? `Avoided: ${avoided.join(', ')}` : 'Direct path failed clearance check.',
    rerouted: true,
    minClearanceM: best.stats.minClearanceM,
    avoidedLabels: avoided,
    checkedWaypoints: best.stats.checkedWaypoints,
  });

  return buildModifiedResponse(sourceResponse, payload);
};

const installFetchInterceptor = () => {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (!isPlannerRequest(args[0])) return response;

    try {
      return await collisionAwarePlannerResponse(response);
    } catch (error) {
      console.error('[collision planner] scene validation failed', error);
      updateState({
        status: 'ERROR',
        reason: error?.message || String(error),
        rerouted: false,
        minClearanceM: null,
        avoidedLabels: [],
        checkedWaypoints: 0,
      });
      return response;
    }
  };
};

export const installCollisionAwarePlanner = () => {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  installSceneCapture();
  installFetchInterceptor();
};

installCollisionAwarePlanner();
