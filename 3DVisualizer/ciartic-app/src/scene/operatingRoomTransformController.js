import * as THREE from 'three';
import { subscribeCollisionPlanner } from './collisionAwarePlanner.js';

const OBJECTS = [
  { id: 'iv-pole', rootName: 'or_iv_pole', label: 'IV pole' },
  { id: 'mayo-stand', rootName: 'or_mayo_stand', label: 'Mayo stand' },
  { id: 'instrument-trolley', rootName: 'or_instrument_trolley', label: 'Instrument trolley' },
  { id: 'anesthesia', rootName: 'or_anesthesia_workstation', label: 'Anesthesia workstation' },
  { id: 'monitor-cart', rootName: 'or_carm_monitor_cart', label: 'C-arm monitor cart' },
  { id: 'surgeon', rootName: 'or_surgeon', label: 'Surgeon' },
  { id: 'scrub-nurse', rootName: 'or_scrub_nurse', label: 'Scrub nurse' },
];

const ROOM_X = 2.65;
const ROOM_Z = 2.45;
const MIN_OBJECT_SPACING_M = 0.62;
const PATIENT_EXCLUSION_X = 0.95;
const PATIENT_EXCLUSION_Z = 1.35;
const DEFAULT_NUDGE_M = 0.10;
const DEFAULT_ROTATE_DEG = 15;

const state = {
  selectedId: 'iv-pole',
  dirty: false,
  revision: 0,
  lastRandomSeed: null,
  message: 'Select an OR object, then use X/Y/Z or rotation controls.',
  subscribers: new Set(),
};

const snapshot = () => ({
  selectedId: state.selectedId,
  dirty: state.dirty,
  revision: state.revision,
  lastRandomSeed: state.lastRandomSeed,
  message: state.message,
  objects: OBJECTS.map(item => ({ ...item })),
  pose: getSelectedPose(),
});

const emit = () => {
  const next = snapshot();
  state.subscribers.forEach(listener => {
    try { listener(next); } catch (error) { console.warn('[OR transform] subscriber failed', error); }
  });
};

export const getOperatingRoomTransformSnapshot = () => snapshot();
export const subscribeOperatingRoomTransform = listener => {
  state.subscribers.add(listener);
  listener(snapshot());
  return () => state.subscribers.delete(listener);
};

const equipmentGroups = () => {
  const set = window.__carmOperatingRoomEquipmentGroups;
  const groups = set instanceof Set ? [...set] : [];
  if (window.__carmOperatingRoomEquipment?.isGroup) groups.push(window.__carmOperatingRoomEquipment);
  return [...new Set(groups)].filter(group => group?.isGroup && group.parent);
};

const definition = id => OBJECTS.find(item => item.id === id) || null;
const rootsForId = id => {
  const def = definition(id);
  if (!def) return [];
  return equipmentGroups()
    .map(group => ({ group, root: group.getObjectByName(def.rootName) }))
    .filter(item => item.root);
};

const safetyPair = (group, id) => {
  const scene = group.parent;
  const safetyGroup = scene?.getObjectByName?.('operating_room_safety_bubbles');
  return {
    bubble: safetyGroup?.getObjectByName?.(`safety_${id}`) || null,
    edges: safetyGroup?.getObjectByName?.(`safety_edges_${id}`) || null,
  };
};

const syncEnvelopeTransform = (group, id, deltaPosition, deltaRotationY = 0) => {
  const { bubble, edges } = safetyPair(group, id);
  [bubble, edges].forEach(object => {
    if (!object) return;
    object.position.add(deltaPosition);
    object.rotation.y += deltaRotationY;
    object.updateMatrixWorld(true);
  });
};

const markDirty = message => {
  state.dirty = true;
  state.revision += 1;
  state.message = `${message} Run PREVIEW PATH again before MOVE C-ARM.`;
  emit();
};

export const selectOperatingRoomObject = id => {
  if (!definition(id)) return false;
  state.selectedId = id;
  state.message = `${definition(id).label} selected.`;
  emit();
  return true;
};

export const getSelectedPose = () => {
  const first = rootsForId(state.selectedId)[0]?.root;
  if (!first) return null;
  return {
    x: first.position.x,
    y: first.position.y,
    z: first.position.z,
    rotationYDeg: THREE.MathUtils.radToDeg(first.rotation.y),
  };
};

export const nudgeSelectedOperatingRoomObject = (axis, deltaM = DEFAULT_NUDGE_M) => {
  if (!['x', 'y', 'z'].includes(axis)) return false;
  const entries = rootsForId(state.selectedId);
  if (!entries.length) return false;

  entries.forEach(({ group, root }) => {
    const before = root.position.clone();
    root.position[axis] += deltaM;
    if (axis === 'x') root.position.x = THREE.MathUtils.clamp(root.position.x, -ROOM_X, ROOM_X);
    if (axis === 'z') root.position.z = THREE.MathUtils.clamp(root.position.z, -ROOM_Z, ROOM_Z);
    if (axis === 'y') root.position.y = THREE.MathUtils.clamp(root.position.y, -0.25, 1.5);
    const delta = root.position.clone().sub(before);
    root.updateMatrixWorld(true);
    syncEnvelopeTransform(group, state.selectedId, delta, 0);
  });

  markDirty(`${definition(state.selectedId)?.label || 'OR object'} moved on ${axis.toUpperCase()}.`);
  return true;
};

export const rotateSelectedOperatingRoomObject = (deltaDeg = DEFAULT_ROTATE_DEG) => {
  const entries = rootsForId(state.selectedId);
  if (!entries.length) return false;
  const deltaRad = THREE.MathUtils.degToRad(deltaDeg);

  entries.forEach(({ group, root }) => {
    root.rotation.y += deltaRad;
    root.updateMatrixWorld(true);
    syncEnvelopeTransform(group, state.selectedId, new THREE.Vector3(), deltaRad);
  });

  markDirty(`${definition(state.selectedId)?.label || 'OR object'} rotated ${deltaDeg > 0 ? 'right' : 'left'}.`);
  return true;
};

const mulberry32 = seed => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const randomSeed = () => {
  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0];
  }
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
};

const candidateIsValid = (x, z, occupied) => {
  if (Math.abs(x) < PATIENT_EXCLUSION_X && Math.abs(z) < PATIENT_EXCLUSION_Z) return false;
  return occupied.every(p => Math.hypot(x - p.x, z - p.z) >= MIN_OBJECT_SPACING_M);
};

export const randomizeOperatingRoomLayout = (seed = randomSeed()) => {
  const groups = equipmentGroups();
  if (!groups.length) return false;

  const rand = mulberry32(seed);
  const occupied = [];
  const placements = new Map();

  OBJECTS.forEach(def => {
    let chosen = null;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const x = (rand() * 2 - 1) * ROOM_X;
      const z = (rand() * 2 - 1) * ROOM_Z;
      if (candidateIsValid(x, z, occupied)) {
        chosen = { x, z, rotationY: rand() * Math.PI * 2 };
        break;
      }
    }
    if (!chosen) {
      chosen = {
        x: (rand() * 2 - 1) * ROOM_X,
        z: (rand() * 2 - 1) * ROOM_Z,
        rotationY: rand() * Math.PI * 2,
      };
    }
    occupied.push(chosen);
    placements.set(def.id, chosen);
  });

  groups.forEach(group => {
    OBJECTS.forEach(def => {
      const root = group.getObjectByName(def.rootName);
      const placement = placements.get(def.id);
      if (!root || !placement) return;
      const oldPosition = root.position.clone();
      const oldRotation = root.rotation.y;
      root.position.x = placement.x;
      root.position.z = placement.z;
      // Keep every object on its existing vertical level; randomization is a floor-layout study tool.
      root.rotation.y = placement.rotationY;
      root.updateMatrixWorld(true);
      syncEnvelopeTransform(
        group,
        def.id,
        root.position.clone().sub(oldPosition),
        root.rotation.y - oldRotation,
      );
    });
  });

  state.lastRandomSeed = seed >>> 0;
  markDirty(`OR randomized with seed ${state.lastRandomSeed}.`);
  return state.lastRandomSeed;
};

export const repeatLastOperatingRoomRandomization = () => {
  if (!Number.isInteger(state.lastRandomSeed)) return false;
  return randomizeOperatingRoomLayout(state.lastRandomSeed);
};

export const notifyOperatingRoomTransformReset = () => {
  state.dirty = true;
  state.revision += 1;
  state.message = 'OR layout reset. Run PREVIEW PATH again before MOVE C-ARM.';
  emit();
};

const installMoveGuard = () => {
  document.addEventListener('click', event => {
    if (!state.dirty) return;
    const button = event.target?.closest?.('button');
    if (!button) return;
    const text = (button.textContent || '').trim().toUpperCase();
    if (!text.includes('MOVE C-ARM')) return;
    event.preventDefault();
    event.stopPropagation();
    state.message = 'OR transform changed. Run PREVIEW PATH again before MOVE C-ARM.';
    emit();
  }, true);
};

const installKeyboard = () => {
  window.addEventListener('keydown', event => {
    const tag = (event.target?.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag) || event.repeat) return;
    if (!event.altKey) return;

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      rotateSelectedOperatingRoomObject(-DEFAULT_ROTATE_DEG);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      rotateSelectedOperatingRoomObject(DEFAULT_ROTATE_DEG);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      nudgeSelectedOperatingRoomObject('z', -DEFAULT_NUDGE_M);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      nudgeSelectedOperatingRoomObject('z', DEFAULT_NUDGE_M);
    }
  });
};

if (typeof window !== 'undefined') {
  installMoveGuard();
  installKeyboard();
  subscribeCollisionPlanner(planner => {
    if (!state.dirty) return;
    if (!['DIRECT_CLEAR', 'DIRECT_NEAR', 'REROUTED', 'BLOCKED'].includes(planner.status)) return;
    state.dirty = false;
    state.message = planner.status === 'BLOCKED'
      ? 'Randomized/edited OR checked: no safe route is currently available.'
      : 'Edited OR checked. MOVE C-ARM may use the latest previewed route.';
    emit();
  });
}
