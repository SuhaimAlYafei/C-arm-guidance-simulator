import * as THREE from 'three';
import { subscribeCollisionPlanner } from './collisionAwarePlanner.js';

const MAIN_SCENE_BACKGROUND = 0xeef2f5;
const LIVE_CHECK_INTERVAL_MS = 120;
const NEAR_CLEARANCE_M = 0.08;
const SAMPLE_BUDGET_PER_MESH = 64;
const ROOM_X_LIMIT = 5.8;
const ROOM_Z_LIMIT = 3.8;
const DRAG_SPEED = 0.0045;
const FALLBACK_SELECT_RADIUS_PX = 90;

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
let overlay = null;
let selectionHelper = null;
let selectedRoot = null;
let dragState = null;
let initialLayout = null;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const tmpVec = new THREE.Vector3();

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
    try { listener(next); } catch (error) { console.warn('[OR interaction] subscriber failed', error); }
  });
};

export const getOperatingRoomInteractionSnapshot = () => snapshot();
export const subscribeOperatingRoomInteraction = listener => {
  state.subscribers.add(listener);
  listener(snapshot());
  return () => state.subscribers.delete(listener);
};

const isMainSimulatorScene = scene => (
  scene?.background?.isColor && scene.background.getHex() === MAIN_SCENE_BACKGROUND
);

const safetyObjectForId = (id, edge = false) => (
  state.safetyGroup?.getObjectByName(edge ? `safety_edges_${id}` : `safety_${id}`) || null
);

const draggableRoots = () => {
  if (!state.equipmentGroup) return [];
  return Object.keys(DRAGGABLE_BY_NAME)
    .map(name => state.equipmentGroup.getObjectByName(name))
    .filter(Boolean);
};

const selectedInfo = root => root ? DRAGGABLE_BY_NAME[root.name] || null : null;

const saveLayout = () => {
  const result = {};
  for (const root of draggableRoots()) {
    const info = selectedInfo(root);
    if (!info) continue;
    result[info.id] = {
      objectName: root.name,
      position: root.position.clone(),
      quaternion: root.quaternion.clone(),
      scale: root.scale.clone(),
      bubblePosition: safetyObjectForId(info.id)?.position.clone() || null,
      edgePosition: safetyObjectForId(info.id, true)?.position.clone() || null,
    };
  }
  return result;
};

const findDraggableRoot = object => {
  let cursor = object;
  while (cursor && cursor !== state.equipmentGroup) {
    if (DRAGGABLE_BY_NAME[cursor.name]) return cursor;
    cursor = cursor.parent;
  }
  return null;
};

const updateSelectionHelper = () => {
  if (selectionHelper?.parent) selectionHelper.parent.remove(selectionHelper);
  selectionHelper = null;
  if (!state.scene || !selectedRoot || !state.editMode) return;
  selectionHelper = new THREE.BoxHelper(selectedRoot, 0xffd166);
  selectionHelper.name = 'or_layout_selection_helper';
  selectionHelper.renderOrder = 5000;
  state.scene.add(selectionHelper);
};

const selectRoot = root => {
  selectedRoot = root || null;
  const info = selectedInfo(selectedRoot);
  state.selectedId = info?.id || null;
  state.selectedLabel = info?.label || null;
  updateSelectionHelper();
  emit();
};

const canvasRect = () => state.renderer?.domElement?.getBoundingClientRect?.() || null;

const syncOverlayRect = () => {
  if (!overlay || !state.renderer?.domElement) return;
  const rect = canvasRect();
  if (!rect) return;
  Object.assign(overlay.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
};

const pointerToNdc = event => {
  const rect = canvasRect();
  if (!rect?.width || !rect?.height) return false;
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  return true;
};

const projectObjectCenterToScreen = root => {
  const rect = canvasRect();
  if (!rect || !state.camera) return null;
  const box = new THREE.Box3().setFromObject(root);
  const center = box.isEmpty() ? root.getWorldPosition(tmpVec) : box.getCenter(tmpVec);
  center.project(state.camera);
  if (center.z < -1 || center.z > 1) return null;
  return {
    x: rect.left + (center.x * 0.5 + 0.5) * rect.width,
    y: rect.top + (-center.y * 0.5 + 0.5) * rect.height,
  };
};

const pickDraggable = event => {
  if (!pointerToNdc(event) || !state.camera || !state.equipmentGroup) return null;
  raycaster.setFromCamera(pointer, state.camera);
  const hits = raycaster.intersectObject(state.equipmentGroup, true);
  for (const hit of hits) {
    const root = findDraggableRoot(hit.object);
    if (root) return root;
  }

  let best = null;
  let bestDistance = FALLBACK_SELECT_RADIUS_PX;
  for (const root of draggableRoots()) {
    const p = projectObjectCenterToScreen(root);
    if (!p) continue;
    const distance = Math.hypot(event.clientX - p.x, event.clientY - p.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = root;
    }
  }
  return best;
};

const moveSafetyEnvelope = (id, dx, dz) => {
  for (const object of [safetyObjectForId(id), safetyObjectForId(id, true)]) {
    if (!object) continue;
    object.position.x += dx;
    object.position.z += dz;
    object.updateMatrixWorld(true);
  }
};

const markLayoutDirty = label => {
  state.layoutDirty = true;
  state.layoutRevision += 1;
  state.message = `${label || 'OR object'} moved. Run PREVIEW PATH again before MOVE C-ARM.`;
};

const cameraBasisXZ = () => {
  const forward = new THREE.Vector3();
  state.camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  return { forward, right };
};

const onOverlayPointerDown = event => {
  if (!state.editMode || !(event.button === 0 || event.button === 2)) return;
  event.preventDefault();
  event.stopPropagation();

  const root = pickDraggable(event);
  if (!root) {
    selectRoot(null);
    state.message = 'No OR object selected. Click closer to a visible IV pole, stand, cart, surgeon, or nurse.';
    emit();
    return;
  }

  selectRoot(root);
  const info = selectedInfo(root);
  dragState = {
    pointerId: event.pointerId,
    root,
    info,
    lastX: event.clientX,
    lastY: event.clientY,
    moved: false,
  };
  overlay.style.cursor = 'grabbing';
  state.message = `Selected ${info.label}. Keep holding and drag.`;
  emit();
  try { overlay.setPointerCapture(event.pointerId); } catch {}
};

const onOverlayPointerMove = event => {
  if (!dragState || event.pointerId !== dragState.pointerId || !state.editMode) return;
  event.preventDefault();
  event.stopPropagation();

  const dxPx = event.clientX - dragState.lastX;
  const dyPx = event.clientY - dragState.lastY;
  dragState.lastX = event.clientX;
  dragState.lastY = event.clientY;
  if (Math.abs(dxPx) + Math.abs(dyPx) < 0.2) return;

  const { forward, right } = cameraBasisXZ();
  const worldDelta = right.multiplyScalar(dxPx * DRAG_SPEED)
    .add(forward.multiplyScalar(-dyPx * DRAG_SPEED));

  const parent = dragState.root.parent;
  const worldOrigin = parent.localToWorld(new THREE.Vector3(0, 0, 0));
  const local0 = parent.worldToLocal(worldOrigin.clone());
  const local1 = parent.worldToLocal(worldOrigin.clone().add(worldDelta));
  const delta = local1.sub(local0);

  const oldX = dragState.root.position.x;
  const oldZ = dragState.root.position.z;
  dragState.root.position.x = THREE.MathUtils.clamp(oldX + delta.x, -ROOM_X_LIMIT, ROOM_X_LIMIT);
  dragState.root.position.z = THREE.MathUtils.clamp(oldZ + delta.z, -ROOM_Z_LIMIT, ROOM_Z_LIMIT);

  const actualDx = dragState.root.position.x - oldX;
  const actualDz = dragState.root.position.z - oldZ;
  if (Math.abs(actualDx) + Math.abs(actualDz) < 1e-8) return;

  dragState.root.updateMatrixWorld(true);
  moveSafetyEnvelope(dragState.info.id, actualDx, actualDz);
  dragState.moved = true;
  if (selectionHelper) selectionHelper.update();
};

const finishOverlayDrag = event => {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  event.preventDefault();
  event.stopPropagation();
  const finished = dragState;
  dragState = null;
  overlay.style.cursor = 'grab';
  try { overlay.releasePointerCapture(event.pointerId); } catch {}
  if (finished.moved) {
    markLayoutDirty(finished.info.label);
    emit();
  }
};

const ensureOverlay = () => {
  if (overlay || typeof document === 'undefined') return;
  overlay = document.createElement('div');
  overlay.id = 'or-edit-overlay';
  Object.assign(overlay.style, {
    position: 'fixed',
    background: 'transparent',
    zIndex: '1200',
    display: 'none',
    cursor: 'grab',
    touchAction: 'none',
    userSelect: 'none',
  });
  overlay.addEventListener('pointerdown', onOverlayPointerDown);
  overlay.addEventListener('pointermove', onOverlayPointerMove);
  overlay.addEventListener('pointerup', finishOverlayDrag);
  overlay.addEventListener('pointercancel', finishOverlayDrag);
  overlay.addEventListener('contextmenu', event => event.preventDefault());
  document.body.appendChild(overlay);
  window.addEventListener('resize', syncOverlayRect);
  window.addEventListener('scroll', syncOverlayRect, true);
};

const updateOverlayVisibility = () => {
  ensureOverlay();
  if (!overlay) return;
  if (state.editMode && state.ready) {
    syncOverlayRect();
    overlay.style.display = 'block';
  } else {
    overlay.style.display = 'none';
    dragState = null;
  }
};

export const setOperatingRoomEditMode = enabled => {
  state.editMode = Boolean(enabled);
  if (!state.editMode) selectRoot(null);
  state.message = state.editMode
    ? 'EDIT OR active: camera locked. Hold LEFT or RIGHT mouse on equipment and drag.'
    : 'OR edit mode off.';
  updateOverlayVisibility();
  emit();
};

export const toggleOperatingRoomEditMode = () => setOperatingRoomEditMode(!state.editMode);

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
    if (!child?.isGroup || child.userData?.operatingRoomEnvironment || child.userData?.operatingRoomSafety) return;
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
    if (score > bestScore) { best = child; bestScore = score; }
  });
  return best;
};

const safetyEntries = () => {
  if (!state.safetyGroup) return [];
  state.safetyGroup.updateMatrixWorld(true);
  return state.safetyGroup.children
    .filter(child => child?.isMesh && child.name?.startsWith('safety_') && !child.name?.startsWith('safety_edges_'))
    .map(mesh => ({ id: mesh.name.slice('safety_'.length), box: new THREE.Box3().setFromObject(mesh) }));
};

const sampleMeshWorldPoints = (mesh, output) => {
  const attr = mesh.geometry?.attributes?.position;
  if (!attr?.count) return;
  const step = Math.max(1, Math.ceil(attr.count / SAMPLE_BUDGET_PER_MESH));
  const point = new THREE.Vector3();
  for (let i = 0; i < attr.count; i += step) {
    point.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrixWorld);
    output.push(point.clone());
  }
};

const liveCollisionCheck = () => {
  if (!state.ready || !state.scene) return;
  state.scene.updateMatrixWorld(true);
  if (!state.cArmRoot || state.cArmRoot.parent !== state.scene) state.cArmRoot = findCArmRoot(state.scene);
  if (!state.cArmRoot) return;

  const points = [];
  state.cArmRoot.traverse(object => {
    if (object.isMesh && object.visible !== false) sampleMeshWorldPoints(object, points);
  });

  let collisionId = null;
  let closestId = null;
  let minClearance = Infinity;
  for (const obstacle of safetyEntries()) {
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

  const nextStatus = collisionId ? 'COLLISION' : minClearance <= NEAR_CLEARANCE_M ? 'NEAR' : 'CLEAR';
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

const captureRuntime = (scene, camera, renderer) => {
  if (!isMainSimulatorScene(scene)) return;
  state.scene = scene;
  state.camera = camera;
  state.renderer = renderer;
  state.equipmentGroup = scene.getObjectByName('operating_room_equipment_layer');
  state.safetyGroup = scene.getObjectByName('operating_room_safety_bubbles');
  const wasReady = state.ready;
  state.ready = Boolean(state.equipmentGroup && state.safetyGroup && state.camera && state.renderer);
  if (state.ready && !initialLayout) initialLayout = saveLayout();
  if (state.ready !== wasReady) {
    updateOverlayVisibility();
    emit();
  }
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
    if (['input', 'textarea', 'select'].includes(tag) || event.repeat) return;
    if (event.key.toLowerCase() === 'e') toggleOperatingRoomEditMode();
    if (event.key === 'Escape' && state.editMode) setOperatingRoomEditMode(false);
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
    state.message = 'OR layout changed. Run PREVIEW PATH again before MOVE C-ARM.';
    emit();
  }, true);
};

const installPlannerSync = () => {
  subscribeCollisionPlanner(planner => {
    if (!state.layoutDirty || !['DIRECT_CLEAR', 'DIRECT_NEAR', 'REROUTED', 'BLOCKED'].includes(planner.status)) return;
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
  ensureOverlay();
  installRendererCapture();
  installKeyboard();
  installMoveGuard();
  installPlannerSync();
  window.setInterval(liveCollisionCheck, LIVE_CHECK_INTERVAL_MS);
};

installOperatingRoomInteraction();
