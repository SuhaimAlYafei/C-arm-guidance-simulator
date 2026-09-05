import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinnedModel } from 'three/addons/utils/SkeletonUtils.js';

const EQUIPMENT_GROUP_NAME = 'operating_room_equipment_layer';

const ASSETS = [
  { rootName: 'or_iv_pole', url: '/operating_room/iv_pole.glb', targetHeightM: 1.9 },
  { rootName: 'or_scrub_nurse', url: '/operating_room/scrub_nurse.glb', targetHeightM: 1.68 },
  { rootName: 'or_surgeon', url: '/operating_room/surgeon.glb', targetHeightM: 1.72 },
];

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const loadingRoots = new WeakSet();
const hydratedRoots = new WeakSet();
const hydratingGroups = new WeakSet();
const pendingGroups = new WeakSet();
const capturedEquipmentGroups = new Set();
const assetPrototypePromises = new Map();
let installed = false;

const waitForIdle = () => new Promise(resolve => {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => resolve(), { timeout: 650 });
  } else {
    window.setTimeout(resolve, 32);
  }
});

const disposeObject = object => {
  object?.traverse?.(child => {
    if (!child?.isMesh) return;
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach(m => m?.dispose?.());
    else child.material?.dispose?.();
  });
};

const loadModelClone = async config => {
  if (!assetPrototypePromises.has(config.url)) {
    assetPrototypePromises.set(
      config.url,
      loader.loadAsync(config.url).then(gltf => gltf.scene)
    );
  }

  const prototype = await assetPrototypePromises.get(config.url);
  return cloneSkinnedModel(prototype);
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

  // The staff GLBs are among the heaviest visible assets. Dynamic shadow-map
  // rendering over every mesh caused a large GPU cost on lower-power devices
  // and does not affect planner/collision geometry, so realistic OR assets use
  // direct lighting only.
  model.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = false;
    object.receiveShadow = false;
    object.frustumCulled = true;
  });

  model.updateMatrixWorld(true);
  return model;
};

const replaceProceduralChildren = async (root, config) => {
  if (!root || loadingRoots.has(root) || hydratedRoots.has(root) || root.userData.realisticAssetLoaded) return;
  loadingRoots.add(root);

  try {
    console.info(`[OR assets] Loading ${config.url} into ${config.rootName}`, root.uuid);
    const model = prepareModel(await loadModelClone(config), config.targetHeightM);
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
  } finally {
    loadingRoots.delete(root);
  }
};

const hydrateGroup = async equipmentGroup => {
  if (!equipmentGroup?.isGroup) return;

  capturedEquipmentGroups.add(equipmentGroup);
  window.__carmOperatingRoomEquipment = equipmentGroup;
  window.__carmOperatingRoomEquipmentGroups = capturedEquipmentGroups;

  if (hydratingGroups.has(equipmentGroup)) {
    pendingGroups.add(equipmentGroup);
    return;
  }

  hydratingGroups.add(equipmentGroup);

  try {
    // Decode one model at a time and yield between assets. Starting the surgeon,
    // nurse and IV pole concurrently created noticeable startup stalls.
    for (const config of ASSETS) {
      const root = equipmentGroup.getObjectByName(config.rootName);
      if (!root || root.userData.realisticAssetLoaded) continue;
      await replaceProceduralChildren(root, config);
      await waitForIdle();
    }
  } finally {
    hydratingGroups.delete(equipmentGroup);

    if (pendingGroups.has(equipmentGroup)) {
      pendingGroups.delete(equipmentGroup);
      queueMicrotask(() => hydrateGroup(equipmentGroup));
    }
  }
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
};

installRealisticOperatingRoomAssets();
