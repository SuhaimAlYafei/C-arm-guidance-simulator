import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const EQUIPMENT_GROUP_NAME = 'operating_room_equipment_layer';

const ASSETS = [
  { rootName: 'or_iv_pole', id: 'iv-pole', url: '/operating_room/iv_pole.glb', targetHeightM: 1.9, clearanceM: 0.13, shadows: true },
  { rootName: 'or_scrub_nurse', id: 'scrub-nurse', url: '/operating_room/scrub_nurse.glb', targetHeightM: 1.68, clearanceM: 0.16, shadows: false },
  { rootName: 'or_surgeon', id: 'surgeon', url: '/operating_room/surgeon.glb', targetHeightM: 1.72, clearanceM: 0.16, shadows: false },
];

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const hydratedRoots = new WeakSet();
const loadingRoots = new WeakSet();
const capturedGroups = new Set();
let installed = false;
let previousRender = null;
let queueRunning = false;
let discoveryLogged = false;

const disposeObject = object => {
  object?.traverse?.(child => {
    if (!child?.isMesh) return;
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach(material => material?.dispose?.());
    else child.material?.dispose?.();
  });
};

const prepareModel = (model, config) => {
  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  model.scale.set(1, 1, 1);
  model.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  if (!Number.isFinite(size.y) || size.y <= 1e-6) throw new Error('Model has no measurable height.');

  model.scale.setScalar(config.targetHeightM / size.y);
  model.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(model);
  const center = scaledBox.getCenter(new THREE.Vector3());
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
    bubble.scale.set(1, 1, 1);
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
    edges.scale.set(1, 1, 1);
    edges.updateMatrixWorld(true);
  }
};

const loadIntoRoot = async (root, config) => {
  if (!root || hydratedRoots.has(root) || loadingRoots.has(root) || root.userData.realisticAssetLoaded) return true;
  loadingRoots.add(root);

  const proceduralChildren = [...root.children];
  proceduralChildren.forEach(child => { child.visible = false; });

  try {
    console.info(`[OR assets] Loading ${config.url} into ${config.rootName}`);
    const gltf = await loader.loadAsync(config.url);
    const model = prepareModel(gltf.scene, config);
    model.name = `${config.rootName}_realistic_glb`;
    model.userData.realisticOperatingRoomAsset = true;
    model.userData.sourceUrl = config.url;

    proceduralChildren.forEach(child => root.remove(child));
    proceduralChildren.forEach(disposeObject);
    root.add(model);
    root.userData.realisticAssetLoaded = true;
    root.userData.realisticAssetUrl = config.url;
    root.updateMatrixWorld(true);
    refreshSafetyEnvelope(root, config);
    hydratedRoots.add(root);
    console.info(`[OR assets] READY ${config.rootName}`);
    return true;
  } catch (error) {
    proceduralChildren.forEach(child => { child.visible = true; });
    console.error(`[OR assets] FAILED ${config.rootName}`, error);
    return false;
  } finally {
    loadingRoots.delete(root);
  }
};

const findEquipmentGroups = scene => {
  const found = [];
  const direct = scene?.getObjectByName?.(EQUIPMENT_GROUP_NAME);
  if (direct?.isGroup) found.push(direct);

  scene?.traverse?.(object => {
    if (!object?.isGroup) return;
    if (object.name === EQUIPMENT_GROUP_NAME || object.userData?.operatingRoomEnvironment) found.push(object);
  });

  return [...new Set(found)].filter(group => group?.parent);
};

const captureSceneGroups = scene => {
  // Do not identify the simulator scene by background colour. Other runtime
  // layers may change/replace Scene.background. The OR equipment layer itself
  // is the authoritative marker for the scene we need.
  const groups = findEquipmentGroups(scene);
  if (!groups.length) return;

  groups.forEach(group => capturedGroups.add(group));
  [...capturedGroups].forEach(group => {
    if (!group?.parent) capturedGroups.delete(group);
  });

  const first = groups[0] || [...capturedGroups][0] || null;
  if (first) {
    window.__carmOperatingRoomEquipment = first;
    window.__carmOperatingRoomEquipmentGroups = capturedGroups;
  }

  if (!discoveryLogged) {
    discoveryLogged = true;
    console.info('[OR assets] FOUND operating-room equipment layer', {
      groups: groups.length,
      roots: ASSETS.map(config => ({
        name: config.rootName,
        found: Boolean(first?.getObjectByName?.(config.rootName)),
      })),
    });
  }
};

const runHydrationQueue = async () => {
  if (queueRunning) return;
  queueRunning = true;
  try {
    for (const config of ASSETS) {
      for (const group of [...capturedGroups]) {
        if (!group?.parent) continue;
        const root = group.getObjectByName(config.rootName);
        if (!root) {
          console.warn(`[OR assets] root not found: ${config.rootName}`);
          continue;
        }
        await loadIntoRoot(root, config);
      }
    }
  } finally {
    queueRunning = false;
  }
};

export const installRealisticOperatingRoomAssets = () => {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  console.info('[OR assets] content-based scene discovery installer active');

  previousRender = THREE.WebGLRenderer.prototype.render;
  THREE.WebGLRenderer.prototype.render = function realisticOrRenderCapture(scene, camera) {
    captureSceneGroups(scene);
    if (capturedGroups.size) void runHydrationQueue();
    return previousRender.call(this, scene, camera);
  };
};

installRealisticOperatingRoomAssets();
