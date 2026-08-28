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

const loadingRoots = new WeakSet();
const hydratedRoots = new WeakSet();
const capturedEquipmentGroups = new Set();
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
  if (!root || loadingRoots.has(root) || hydratedRoots.has(root) || root.userData.realisticAssetLoaded) return;
  loadingRoots.add(root);

  try {
    console.info(`[OR assets] Loading ${config.url} into ${config.rootName}`, root.uuid);
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

    hydratedRoots.add(root);
    console.info(`[OR assets] READY ${config.rootName}`, root.uuid);
  } catch (error) {
    console.error(`[OR assets] FAILED ${config.rootName}`, error);
  }
};

const hydrateGroup = equipmentGroup => {
  if (!equipmentGroup?.isGroup) return;
  capturedEquipmentGroups.add(equipmentGroup);
  window.__carmOperatingRoomEquipment = equipmentGroup;
  window.__carmOperatingRoomEquipmentGroups = capturedEquipmentGroups;

  ASSETS.forEach(config => {
    const root = equipmentGroup.getObjectByName(config.rootName);
    if (root && !root.userData.realisticAssetLoaded) replaceProceduralChildren(root, config);
  });
};

const hydrateAll = () => {
  [...capturedEquipmentGroups].forEach(group => {
    if (!group?.isGroup) capturedEquipmentGroups.delete(group);
    else hydrateGroup(group);
  });
  if (window.__carmOperatingRoomEquipment?.isGroup) hydrateGroup(window.__carmOperatingRoomEquipment);
};

export const installRealisticOperatingRoomAssets = () => {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  console.info('[OR assets] installer active');

  const originalAdd = THREE.Object3D.prototype.add;
  THREE.Object3D.prototype.add = function realisticOrCaptureAdd(...objects) {
    const result = originalAdd.apply(this, objects);

    if (this?.name === EQUIPMENT_GROUP_NAME) {
      capturedEquipmentGroups.add(this);
      window.__carmOperatingRoomEquipment = this;
      window.__carmOperatingRoomEquipmentGroups = capturedEquipmentGroups;
      queueMicrotask(() => hydrateGroup(this));
    }

    for (const object of objects) {
      if (object?.name === EQUIPMENT_GROUP_NAME) {
        capturedEquipmentGroups.add(object);
        window.__carmOperatingRoomEquipment = object;
        window.__carmOperatingRoomEquipmentGroups = capturedEquipmentGroups;
        queueMicrotask(() => hydrateGroup(object));
      }
    }
    return result;
  };

  timer = window.setInterval(hydrateAll, 500);

  window.addEventListener('beforeunload', () => {
    if (timer) window.clearInterval(timer);
  }, { once: true });
};

installRealisticOperatingRoomAssets();
