import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const EQUIPMENT_GROUP_NAME = 'operating_room_equipment_layer';

const ASSETS = [
  { rootName: 'or_iv_pole', url: '/operating_room/iv_pole.glb', targetHeightM: 1.9 },
  { rootName: 'or_surgeon', url: '/operating_room/surgeon.glb', targetHeightM: 1.72 },
  { rootName: 'or_scrub_nurse', url: '/operating_room/scrub_nurse.glb', targetHeightM: 1.68 },
];

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const loading = new Set();
const loaded = new Set();
let installed = false;
let timer = null;

const disposeObject = object => {
  object?.traverse?.(child => {
    if (!child?.isMesh) return;
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach(m => m?.dispose?.());
    else child.material?.dispose?.();
  });
};

const prepareModel = (model, targetHeightM) => {
  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  model.scale.set(1, 1, 1);
  model.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (!Number.isFinite(size.y) || size.y <= 1e-6) throw new Error('Model has no measurable height.');

  model.scale.setScalar(targetHeightM / size.y);
  model.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(model);
  const center = new THREE.Vector3();
  scaledBox.getCenter(center);
  model.position.set(-center.x, -scaledBox.min.y, -center.z);

  model.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  model.updateMatrixWorld(true);
  return model;
};

const replaceProceduralChildren = async (root, config) => {
  if (!root || loading.has(config.rootName) || loaded.has(config.rootName)) return;
  loading.add(config.rootName);

  try {
    console.info(`[OR assets] Loading ${config.url}`);
    const gltf = await loader.loadAsync(config.url);
    const model = prepareModel(gltf.scene, config.targetHeightM);
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

    loaded.add(config.rootName);
    console.info(`[OR assets] READY ${config.rootName}`);
  } catch (error) {
    console.error(`[OR assets] FAILED ${config.rootName}`, error);
  } finally {
    loading.delete(config.rootName);
  }
};

const findEquipmentGroups = () => {
  const groups = [];
  const scenes = [];

  // The OR runtime owns the group but not a public scene reference, so inspect
  // the live Three.js objects reachable through renderers captured by the app.
  if (window.__carmMainScene?.isScene) scenes.push(window.__carmMainScene);

  // Fallback: the runtime's scene hook creates this named group. Object3D.add
  // below captures it immediately, independent of renderer monkey-patch order.
  if (window.__carmOperatingRoomEquipment?.isGroup) groups.push(window.__carmOperatingRoomEquipment);

  scenes.forEach(scene => {
    const group = scene.getObjectByName(EQUIPMENT_GROUP_NAME);
    if (group) groups.push(group);
  });
  return [...new Set(groups)];
};

const hydrate = () => {
  findEquipmentGroups().forEach(equipmentGroup => {
    ASSETS.forEach(config => {
      const root = equipmentGroup.getObjectByName(config.rootName);
      if (root && !root.userData.realisticAssetLoaded) replaceProceduralChildren(root, config);
    });
  });
};

export const installRealisticOperatingRoomAssets = () => {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const originalAdd = THREE.Object3D.prototype.add;
  THREE.Object3D.prototype.add = function realisticOrCaptureAdd(...objects) {
    const result = originalAdd.apply(this, objects);
    for (const object of objects) {
      if (object?.name === EQUIPMENT_GROUP_NAME) {
        window.__carmOperatingRoomEquipment = object;
        queueMicrotask(hydrate);
      }
    }
    return result;
  };

  // Retry briefly because the OR layer is created asynchronously relative to
  // React/module initialization. Stop once all three assets are hydrated.
  timer = window.setInterval(() => {
    hydrate();
    if (loaded.size === ASSETS.length) {
      window.clearInterval(timer);
      timer = null;
    }
  }, 250);

  window.setTimeout(() => {
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
    hydrate();
  }, 30000);
};

installRealisticOperatingRoomAssets();
