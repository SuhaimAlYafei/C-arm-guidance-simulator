import * as THREE from 'three';
import { resetOperatingRoomLayout } from './operatingRoomInteraction.js';
import { logResearchEvent } from './researchRunLogger.js';

const MAIN_SCENE_BACKGROUND = 0xeef2f5;
const listeners = new Set();
const state = {
  scene: null,
  ready: false,
  preset: 'nominal',
  revision: 0,
  message: 'Waiting for OR scene.',
};

let installed = false;
let previousRender = null;

const PRESETS = {
  nominal: {
    label: 'Nominal / reset',
    description: 'Default operating-room layout.',
    offsets: {},
  },
  iv_challenge: {
    label: 'IV pole challenge',
    description: 'Moves the IV pole toward a likely C-arm approach corridor.',
    offsets: {
      'iv-pole': { x: -0.42, z: 0.42 },
    },
  },
  crowded_or: {
    label: 'Crowded OR challenge',
    description: 'Moves several mobile objects toward the working zone to create a constrained planning environment.',
    offsets: {
      'iv-pole': { x: -0.36, z: 0.34 },
      'mayo-stand': { x: 0.42, z: 0.30 },
      'instrument-trolley': { x: 0.52, z: -0.34 },
    },
  },
  open_corridor: {
    label: 'Open corridor control',
    description: 'Moves mobile equipment away from the central working zone.',
    offsets: {
      'iv-pole': { x: 0.75, z: -0.45 },
      'mayo-stand': { x: -0.65, z: -0.50 },
      'instrument-trolley': { x: -0.70, z: 0.55 },
    },
  },
};

const OBJECT_NAME_BY_ID = {
  'iv-pole': 'or_iv_pole',
  'mayo-stand': 'or_mayo_stand',
  'instrument-trolley': 'or_instrument_trolley',
};

const snapshot = () => ({
  ready: state.ready,
  preset: state.preset,
  revision: state.revision,
  message: state.message,
  presets: Object.fromEntries(Object.entries(PRESETS).map(([key, value]) => [key, {
    label: value.label,
    description: value.description,
  }])),
});

const emit = () => {
  const next = snapshot();
  listeners.forEach(listener => {
    try { listener(next); } catch (error) { console.warn('[award scenarios] subscriber failed', error); }
  });
};

export const getAwardScenarioSnapshot = () => snapshot();
export const subscribeAwardScenario = listener => {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
};

const isMainScene = scene => scene?.background?.isColor && scene.background.getHex() === MAIN_SCENE_BACKGROUND;

const resolveGroups = scene => {
  let equipmentGroup = scene?.getObjectByName('operating_room_environment') || null;
  let safetyGroup = scene?.getObjectByName('operating_room_safety_bubbles') || null;

  if (!equipmentGroup || !safetyGroup) {
    scene?.traverse?.(object => {
      if (!equipmentGroup && object?.userData?.operatingRoomEnvironment) equipmentGroup = object;
      if (!safetyGroup && object?.userData?.operatingRoomSafety) safetyGroup = object;
    });
  }
  return { equipmentGroup, safetyGroup };
};

const moveEnvelope = (safetyGroup, id, dx, dz) => {
  for (const name of [`safety_${id}`, `safety_edges_${id}`]) {
    const object = safetyGroup?.getObjectByName(name);
    if (!object) continue;
    object.position.x += dx;
    object.position.z += dz;
    object.updateMatrixWorld(true);
  }
};

export const applyAwardScenarioPreset = presetKey => {
  const preset = PRESETS[presetKey];
  if (!preset) return false;
  if (!state.scene) {
    state.message = 'Main Three.js scene is not ready yet.';
    emit();
    return false;
  }

  resetOperatingRoomLayout();
  const { equipmentGroup, safetyGroup } = resolveGroups(state.scene);
  if (!equipmentGroup || !safetyGroup) {
    state.message = 'Operating-room environment is not attached yet.';
    emit();
    return false;
  }

  Object.entries(preset.offsets).forEach(([id, offset]) => {
    const object = equipmentGroup.getObjectByName(OBJECT_NAME_BY_ID[id]);
    if (!object) return;
    const dx = Number(offset.x || 0);
    const dz = Number(offset.z || 0);
    object.position.x += dx;
    object.position.z += dz;
    object.updateMatrixWorld(true);
    moveEnvelope(safetyGroup, id, dx, dz);
  });

  safetyGroup.updateMatrixWorld(true);
  state.preset = presetKey;
  state.revision += 1;
  state.message = `${preset.label} applied. Run PREVIEW PATH before recording the trial.`;
  logResearchEvent('award_scenario_applied', {
    preset: presetKey,
    revision: state.revision,
    offsets: preset.offsets,
  });
  emit();
  return true;
};

const installSceneCapture = () => {
  if (installed || typeof THREE?.WebGLRenderer === 'undefined') return;
  installed = true;
  previousRender = THREE.WebGLRenderer.prototype.render;
  THREE.WebGLRenderer.prototype.render = function awardScenarioCapture(scene, camera) {
    if (isMainScene(scene)) {
      state.scene = scene;
      const { equipmentGroup, safetyGroup } = resolveGroups(scene);
      const nextReady = Boolean(equipmentGroup && safetyGroup);
      if (nextReady !== state.ready) {
        state.ready = nextReady;
        state.message = nextReady ? 'Award scenario controls ready.' : 'Waiting for OR environment.';
        emit();
      }
    }
    return previousRender.call(this, scene, camera);
  };
};

installSceneCapture();
