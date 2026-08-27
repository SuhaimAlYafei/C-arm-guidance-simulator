import * as THREE from 'three';
import { subscribeCollisionPlanner } from './collisionAwarePlanner.js';

const MAIN_SCENE_BACKGROUND = 0xeef2f5;
const LIVE_CHECK_INTERVAL_MS = 120;
const NEAR_CLEARANCE_M = 0.08;
const SAMPLE_BUDGET_PER_MESH = 64;
const ROOM_X_LIMIT = 5.8;
const ROOM_Z_LIMIT = 3.8;

const DRAGGABLE_BY_NAME = {
  or_iv_pole: { id: 'iv-pole', label: 'IV pole' },
  or_mayo_stand: { id: 'mayo-stand', label: 'Mayo stand' },
  or_instrument_trolley: { id: 'instrument-trolley', label: 'Instrument trolley' },
  or_anesthesia_workstation: { id: 'anesthesia', label: 'Anesthesia workstation' },
  or_carm_monitor_cart: { id: 'monitor-cart', label: 'C-arm monitor cart' },
  or_surgeon: { id: 'surgeon', label: 'Surgeon' },
  or_scrub_nurse: { id: 'scrub-nurse', label: 'Scrub nurse' },
};

const state = {
  scene: null,
  camera: null,
  renderer: null,
  equipmentGroup: null,
  safetyGroup: null,
  cArmRoot: null,
  ready: false,
  editMode: false,
  selectedId: null,
  selectedLabel: null,
  layoutDirty: false,
  layoutRevision: 0,
  liveCollisionStatus: 'SEARCHING',
  liveCollisionLabel: null,
  liveMinClearanceM: null,
  message: null,
  subscribers: new Set(),
};

let installed = false;
let originalRender = null;
let liveTimer = null;
let pointerDom = null;
let selectionHelper = null;
let selectedRoot = null;
let dragState = null;
let initialLayout = null;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const planeHit = new THREE.Vector3();

const snapshot = () => ({
  ready: state.ready,
  editMode: state.editMode,
  selectedId: state.selectedId,
  selectedLabel: state.selectedLabel,
  layoutDirty: state.layoutDirty,
  layoutRevision: state.layoutRevision,
  liveCollisionStatus: state.liveCollisionStatus,
  liveCollisionLabel: state.liveCollisionLabel,
  liveMinClearanceM: state.liveMinClearanceM,
  message: state.message,
});

const emit = () => {
  const next = snapshot();
  state.subscribers.forEach(listener => {
    try {
      listener(next);
    } catch (error) {
      console.warn('[OR interaction] subscriber failed', error);
    }
  });
};

export const getOperatingRoomInteractionSnapshot = () => snapshot();

export const subscribeOperatingRoomInteraction = (listener) => {
  state.subscribers.add(listener);
  listener(snapshot());
  return () => state.subscribers.delete(listener);
};

const isMainSimulatorScene = scene => (
  scene?.background?.isColor
  && scene.background.getHex() === MAIN_SCENE_BACKGROUND
);

const safetyObjectForId = (id, edge = false) => {
  const name = edge ? `safety_edges_${id}` : `safety_${id}`;
  return state.safetyGroup?.getObjectByName(name) || null;
};

const saveLayout = () => {
  if (!state.equipmentGroup || !state.safetyGroup) return null;
  const equipment = {};
  Object.entries(DRAGGABLE_BY_NAME).forEach(([name, info]) => {
    const root = state.equipmentGroup.getObjectByName(name);
    if (!root) return;
    equipment[info.id] = {
      objectName: name,
      position: root.position.clone(),
      quaternion: root.quaternion.clone(),
      scale: root.scale.clone(),
      bubblePosition: safetyObjectForId(info.id)?.position.clone() || null,
      edgePosition: safetyObjectForId(info.id, true)?.position.clone() || null,
    };
  });
  return equipment;
};

const findDraggableRoot = object => {
  let cursor = object;
  while (cursor && cursor !== state.equipmentGroup) {
    if (DRAGGABLE_BY_NAME[cursor.name]) return cursor;
    cursor = cursor.parent;
  }
  return null;
};

const selectedInfo = root => root ? DRAGGABLE_BY_NAME[root.name] || null : null;

const updateSelectionHelper = () => {
  if (!state.scene) return;
  if (selectionHelper?.parent) selectionHelper.parent.remove(selectionHelper);
  selectionHelper = null;

  if (!selectedRoot || !state.editMode) return;
  selectionHelper = new THREE.BoxHelper(selectedRoot, 0xffd166);
  selectionHelper.name = 'or_layout_selection_helper';
  selectionHelper.renderOrder = 2000;
  state.scene.add(selectionHelper);
};

const selectRoot = root => {
  selectedRoot = root || null;
  const info = selectedInfo(root);
  state.selectedId = info?.id || null;
  state.selectedLabel = info?.label || null;
  updateSelectionHelper();
  emit();
};

export const setOperatingRoomEditMode = enabled => {
  state.editMode = Boolean(enabled);
  if (!state.editMode) {
    dragState = null;
    selectRoot(null);
  } else {
    state.message = 'Edit mode: click and drag OR equipment on the floor.';
    emit();
  }
};

export const toggleOperatingRoomEditMode = () => {
  setOperatingRoomEditMode(!state.editMode);
};

const markLayoutDirty = label => {
  state.layoutDirty = true;
  state.layoutRevision += 1;
  state.message = `${label || 'OR object'} moved. Run PREVIEW PATH again before MOVE C-ARM.`;
};

const moveSafetyEnvelope = (id, deltaX, deltaZ) => {
  const bubble = safetyObjectForId(id);
  const edges = safetyObjectForId(id, true);
  if (bubble) {
    bubble.position.x += deltaX;
    bubble.position.z += deltaZ;
    bubble.updateMatrixWorld(true);
  }
  if (edges) {
    edges.position.x += deltaX;
    edges.position.z += deltaZ;
    edges.updateMatrixWorld(true);
  }
};

const pointerToNdc = event => {
  const rect = pointerDom?.getBoundingClientRect();
  if (!rect || !rect.width || !rect.height) return false;
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  return true;
};

const floorIntersection = event => {
  if (!state.camera || !pointerToNdc(event)) return null;
  raycaster.setFromCamera(pointer, state.camera);
  const hit = raycaster.ray.intersectPlane(floorPlane, planeHit);
  return hit ? planeHit.clone() : null;
};

const stopCameraGesture = event => {
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
};

const onPointerDown = event => {
  if (!state.editMode || !state.ready || !state.equipmentGroup || event.button !== 0) return;
  if (!pointerToNdc(event)) return;

  raycaster.setFromCamera(pointer, state.camera);
  const hits = raycaster.intersectObject(state.equipmentGroup, true);
  const root = hits.map(hit => findDraggableRoot(hit.object)).find(Boolean) || null;

  if (!root) {
    selectRoot(null);
    return;
  }

  stopCameraGesture(event);
  selectRoot(root);

  const hit = floorIntersection(event);
  if (!hit) return;

  const localHit = state.equipmentGroup.worldToLocal(hit.clone());
  const info = selectedInfo(root);
  dragState = {
    pointerId: event.pointerId,
    root,
    info,
    startPosition: root.position.clone(),
    offsetX: root.position.x - localHit.x,
    offsetZ: root.position.z - localHit.z,
    moved: false,
  };

  try {
    pointerDom.setPointerCapture(event.pointerId);
  } catch {
    // Pointer capture is optional.
  }
};

const onPointerMove = event => {
  if (!dragState || event.pointerId !== dragState.pointerId || !state.editMode) return;
  stopCameraGesture(event);

  const hit = floorIntersection(event);
  if (!hit) return;
  const localHit = state.equipmentGroup.worldToLocal(hit.clone());

  const nextX = THREE.MathUtils.clamp(localHit.x + dragState.offsetX, -ROOM_X_LIMIT, ROOM_X_LIMIT);
  const nextZ = THREE.MathUtils.clamp(localHit.z + dragState.offsetZ, -ROOM_Z_LIMIT, ROOM_Z_LIMIT);
  const deltaX = nextX - dragState.root.position.x;
  const deltaZ = nextZ - dragState.root.position.z;

  if (Math.abs(deltaX) < 1e-6 && Math.abs(deltaZ) < 1e-6) return;

  dragState.root.position.x = nextX;
  dragState.root.position.z = nextZ;
  dragState.root.updateMatrixWorld(true);
  moveSafetyEnvelope(dragState.info.id, deltaX, deltaZ);
  dragState.moved = true;

  if (selectionHelper) selectionHelper.update();
};

const finishDrag = event => {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  stopCameraGesture(event);

  const completed = dragState;
  dragState = null;
  try {
    pointerDom.releasePointerCapture(event.pointerId);
  } catch {
    // Ignore release failures.
  }

  if (completed.moved) {
    markLayoutDirty(completed.info.label);
    emit();
  }
};

const attachPointerDom = dom => {
  if (!dom || pointerDom === dom) return;

  if (pointerDom) {
    pointerDom.removeEventListener('pointerdown', onPointerDown, true);
    pointerDom.removeEventListener('pointermove', onPointerMove, true);
    pointerDom.removeEventListener('pointerup', finishDrag, true);
    pointerDom.removeEventListener('pointercancel', finishDrag, true);
  }

  pointerDom = dom;
  pointerDom.addEventListener('pointerdown', onPointerDown, true);
  pointerDom.addEventListener('pointermove', onPointerMove, true);
  pointerDom.addEventListener('pointerup', finishDrag, true);
  pointerDom.addEventListener('pointercancel', finishDrag, true);
};

const captureRuntime = (scene, camera, renderer) => {
  if (!isMainSimulatorScene(scene)) return;

  state.scene = scene;
  state.camera = camera;
  state.renderer = renderer;
  state.equipmentGroup = scene.getObjectByName('operating_room_equipment_layer');
  state.safetyGroup = scene.getObjectByName('operating_room_safety_bubbles');
  attachPointerDom(renderer?.domElement);

  const wasReady = state.ready;
  state.ready = Boolean(state.equipmentGroup && state.safetyGroup && state.camera && state.renderer);
  if (state.ready && !initialLayout) initialLayout = saveLayout();
  if (state.ready !== wasReady) emit();
};

export const resetOperatingRoomLayout = () => {
  if (!initialLayout || !state.equipmentGroup) return false;

  Object.entries(initialLayout).forEach(([id, saved]) => {
    const root = state.equipmentGroup.getObjectByName(saved.objectName);
    if (root) {
      root.position.copy(saved.position);
      root.quaternion.copy(saved.quaternion);
      root.scale.copy(saved.scale);
      root.updateMatrixWorld(true);
    }

    const bubble = safetyObjectForId(id);
    if (bubble && saved.bubblePosition) bubble.position.copy(saved.bubblePosition);
    const edges = safetyObjectForId(id, true);
    if (edges && saved.edgePosition) edges.position.copy(saved.edgePosition);
  });

  state.safetyGroup?.updateMatrixWorld(true);
  if (selectionHelper) selectionHelper.update();
  state.layoutDirty = true;
  state.layoutRevision += 1;
  state.message = 'OR layout reset. Run PREVIEW PATH again before MOVE C-ARM.';
  emit();
  return true;
};

const findCArmRoot = scene => {
  let best = null;
  let bestScore = -Infinity;

  scene?.children?.forEach(child => {
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

const safetyEntries = () => {
  if (!state.safetyGroup) return [];
  state.safetyGroup.updateMatrixWorld(true);
  return state.safetyGroup.children
    .filter(child => child?.isMesh && child.name?.startsWith('safety_'))
    .map(mesh => ({
      id: mesh.name.slice('safety_'.length),
      box: new THREE.Box3().setFromObject(mesh),
    }));
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

const liveCollisionCheck = () => {
  if (!state.ready || !state.scene) return;
  state.scene.updateMatrixWorld(true);

  if (!state.cArmRoot || state.cArmRoot.parent !== state.scene) {
    state.cArmRoot = findCArmRoot(state.scene);
  }
  if (!state.cArmRoot) return;

  const points = [];
  state.cArmRoot.traverse(object => {
    if (object.isMesh && object.visible !== false) sampleMeshWorldPoints(object, points);
  });

  const entries = safetyEntries();
  let collisionId = null;
  let closestId = null;
  let minClearance = Infinity;

  for (const obstacle of entries) {
    let obstacleMin = Infinity;
    for (const point of points) {
      if (obstacle.box.containsPoint(point)) {
        obstacleMin = 0;
        collisionId = obstacle.id;
        break;
      }
      obstacleMin = Math.min(obstacleMin, obstacle.box.distanceToPoint(point));
    }

    if (obstacleMin < minClearance) {
      minClearance = obstacleMin;
      closestId = obstacle.id;
    }
    if (collisionId) break;
  }

  const labelForId = id => Object.values(DRAGGABLE_BY_NAME).find(item => item.id === id)?.label
    || (id === 'patient-table' ? 'Patient / operating table' : id === 'surgical-light' ? 'Surgical light' : id?.replaceAll('-', ' '));

  const nextStatus = collisionId
    ? 'COLLISION'
    : minClearance <= NEAR_CLEARANCE_M
      ? 'NEAR'
      : 'CLEAR';
  const nextLabel = labelForId(collisionId || closestId) || null;
  const nextClearance = Number.isFinite(minClearance) ? minClearance : null;

  const changed = nextStatus !== state.liveCollisionStatus
    || nextLabel !== state.liveCollisionLabel
    || Math.abs((nextClearance ?? 0) - (state.liveMinClearanceM ?? 0)) > 0.005;

  state.liveCollisionStatus = nextStatus;
  state.liveCollisionLabel = nextLabel;
  state.liveMinClearanceM = collisionId ? 0 : nextClearance;
  if (changed) emit();
};

const installRendererCapture = () => {
  if (originalRender) return;
  originalRender = THREE.WebGLRenderer.prototype.render;
  THREE.WebGLRenderer.prototype.render = function operatingRoomRender(scene, camera) {
    captureRuntime(scene, camera, this);
    return originalRender.call(this, scene, camera);
  };
};

const installKeyboard = () => {
  window.addEventListener('keydown', event => {
    const tag = (event.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (event.repeat) return;

    if (event.key.toLowerCase() === 'e') {
      toggleOperatingRoomEditMode();
      return;
    }

    if (event.key === 'Escape' && state.editMode) {
      setOperatingRoomEditMode(false);
    }
  });
};

const installMoveGuard = () => {
  document.addEventListener('click', event => {
    const button = event.target?.closest?.('button');
    if (!button || !state.layoutDirty) return;
    const text = (button.textContent || '').trim().toUpperCase();
    if (!text.includes('MOVE C-ARM')) return;

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    state.message = 'OR layout changed. Run PREVIEW PATH again before MOVE C-ARM.';
    emit();
  }, true);
};

const installPlannerSync = () => {
  subscribeCollisionPlanner(planner => {
    if (!state.layoutDirty) return;
    if (!['DIRECT_CLEAR', 'DIRECT_NEAR', 'REROUTED', 'BLOCKED'].includes(planner.status)) return;
    state.layoutDirty = false;
    state.message = planner.status === 'BLOCKED'
      ? 'New OR layout checked: no safe route is currently available.'
      : 'New OR layout checked. MOVE C-ARM may use the latest previewed route.';
    emit();
  });
};

export const installOperatingRoomInteraction = () => {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  installRendererCapture();
  installKeyboard();
  installMoveGuard();
  installPlannerSync();
  liveTimer = window.setInterval(liveCollisionCheck, LIVE_CHECK_INTERVAL_MS);
};

installOperatingRoomInteraction();
