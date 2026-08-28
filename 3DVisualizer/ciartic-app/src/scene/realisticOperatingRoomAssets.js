import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const EQUIPMENT_GROUP_NAME = 'operating_room_equipment_layer';

// Keep the IV pole immediate because it is central to the collision experiment.
// Staff assets are much heavier, so load them sequentially after first render.
const ASSETS = [
  { rootName: 'or_iv_pole', id: 'iv-pole', url: '/operating_room/iv_pole.glb', targetHeightM: 1.9, clearanceM: 0.13, delayMs: 0, shadows: true },
  { rootName: 'or_scrub_nurse', id: 'scrub-nurse', url: '/operating_room/scrub_nurse.glb', targetHeightM: 1.68, clearanceM: 0.16, delayMs: 450, shadows: false },
  { rootName: 'or_surgeon', id: 'surgeon', url: '/operating_room/surgeon.glb', targetHeightM: 1.72, clearanceM: 0.16, delayMs: 1100, shadows: false },
];

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const loadingRoots = new WeakSet();
const hydratedRoots = new WeakSet();
const scheduledRoots = new WeakSet();
const capturedEquipmentGroups = new Set();
let installed = false;
let startupTimer = null;
let originalAdd = null;

const disposeObject = object => {
  object?.traverse?.(child => {
    if (!child?.isMesh) return;
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach(m => m?.dispose?.());
    else child.material?.dispose?.();
  });
};

const prepareModel = (model, config) => {
  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  model.scale.set(1, 1, 1);
  model.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (!Number.isFinite(size.y) || size.y <= 1e-6) throw new Error('Model has no measurable height.');

  model.scale.setScalar(config.targetHeightM / size.y);
  model.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(model);
  const center = new THREE.Vector3();
  scaledBox.getCenter(center);
  model.position.set(-center.x, -scaledBox.min.y, -center.z);

  model.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = Boolean(config.shadows);
    object.receiveShadow = Boolean(config.shadows);
    object.frustumCulled = true;
  });
  model.updateMatrixWorld(true);
  return model;
};

const refreshSafetyEnvelope = (root, config) => {
  const scene = root?.parent?.parent;
  const safetyGroup = scene?.getObjectByName?.('operating_room_safety_bubbles');
  if (!safetyGroup) return;

  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root).expandByScalar(config.clearanceM);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  const bubble = safetyGroup.getObjectByName(`safety_${config.id}`);
  if (bubble?.isMesh) {
    bubble.geometry?.dispose?.();
    bubble.geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
    bubble.position.copy(center);
    bubble.rotation.set(0, 0, 0);
    bubble.updateMatrixWorld(true);
  }

  const edges = safetyGroup.getObjectByName(`safety_edges_${config.id}`);
  if (edges?.isLineSegments) {
    edges.geometry?.dispose?.();
    const boxGeometry = new THREE.BoxGeometry(size.x, size.y, size.z);
    edges.geometry = new THREE.EdgesGeometry(boxGeometry);
    boxGeometry.dispose();
    edges.position.copy(center);
    edges.rotation.set(0, 0, 0);
    edges.updateMatrixWorld(true);
  }
};

const replaceProceduralChildren = async (root, config) => {
  if (!root || loadingRoots.has(root) || hydratedRoots.has(root) || root.userData.realisticAssetLoaded) return;
  loadingRoots.add(root);

  try {
    console.info(`[OR assets] Loading ${config.url} into ${config.rootName}`, root.uuid);
    const gltf = await loader.loadAsync(config.url);
    const model = prepareModel(gltf.scene, config);
    model.name = `${config.rootName}_realistic_glb`;
    model.userData.realisticOperatingRoomAsset = true;
    model.userData.sourceUrl = config.url;

    const oldChildren = [...root.children];
    oldChildren.forEach(child => root.remove(child));
    oldChildren.forEach(disposeObject);
    root.add(model);
    root.userData.realisticAssetLoaded = true;
    root.userData.realisticAssetUrl = config.url;
    root.updateMatrixWorld(true);

    refreshSafetyEnvelope(root, config);
    hydratedRoots.add(root);
    console.info(`[OR assets] READY ${config.rootName}`, root.uuid);
  } catch (error) {
    console.error(`[OR assets] FAILED ${config.rootName}`, error);
  } finally {
    loadingRoots.delete(root);
  }
};

const scheduleHydration = (root, config) => {
  if (!root || root.userData.realisticAssetLoaded || scheduledRoots.has(root)) return;
  scheduledRoots.add(root);

  const run = () => replaceProceduralChildren(root, config);
  if (config.delayMs <= 0) {
    queueMicrotask(run);
    return;
  }

  window.setTimeout(() => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(run, { timeout: 1600 });
    } else {
      run();
    }
  }, config.delayMs);
};

const hydrateGroup = equipmentGroup => {
  if (!equipmentGroup?.isGroup || !equipmentGroup.parent) return;
  capturedEquipmentGroups.add(equipmentGroup);
  window.__carmOperatingRoomEquipment = equipmentGroup;
  window.__carmOperatingRoomEquipmentGroups = capturedEquipmentGroups;

  ASSETS.forEach(config => {
    const root = equipmentGroup.getObjectByName(config.rootName);
    if (root) scheduleHydration(root, config);
  });
};

const pruneGroups = () => {
  [...capturedEquipmentGroups].forEach(group => {
    if (!group?.isGroup || !group.parent) capturedEquipmentGroups.delete(group);
  });
};

const allKnownRootsScheduled = () => {
  pruneGroups();
  if (!capturedEquipmentGroups.size) return false;
  for (const group of capturedEquipmentGroups) {
    for (const config of ASSETS) {
      const root = group.getObjectByName(config.rootName);
      if (root && !root.userData.realisticAssetLoaded && !scheduledRoots.has(root)) return false;
    }
  }
  return true;
};

export const installRealisticOperatingRoomAssets = () => {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  console.info('[OR assets] optimized installer active');

  originalAdd = THREE.Object3D.prototype.add;
  THREE.Object3D.prototype.add = function realisticOrCaptureAdd(...objects) {
    const result = originalAdd.apply(this, objects);

    if (this?.name === EQUIPMENT_GROUP_NAME) hydrateGroup(this);
    objects.forEach(object => {
      if (object?.name === EQUIPMENT_GROUP_NAME) hydrateGroup(object);
    });
    return result;
  };

  // Bounded startup discovery instead of a permanent 500 ms polling loop.
  let attempts = 0;
  startupTimer = window.setInterval(() => {
    attempts += 1;
    pruneGroups();
    capturedEquipmentGroups.forEach(hydrateGroup);
    if (allKnownRootsScheduled() || attempts >= 20) {
      window.clearInterval(startupTimer);
      startupTimer = null;
    }
  }, 300);

  window.addEventListener('beforeunload', () => {
    if (startupTimer) window.clearInterval(startupTimer);
  }, { once: true });
};

installRealisticOperatingRoomAssets();
