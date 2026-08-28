import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const MAIN_SCENE_BACKGROUND = 0xeef2f5;
const EQUIPMENT_GROUP_NAME = 'operating_room_equipment_layer';

const ASSETS = [
  {
    rootName: 'or_iv_pole',
    url: '/operating_room/iv_pole.glb',
    targetHeightM: 1.9,
    rotationY: 0,
  },
  {
    rootName: 'or_surgeon',
    url: '/operating_room/surgeon.glb',
    targetHeightM: 1.72,
    rotationY: 0,
  },
  {
    rootName: 'or_scrub_nurse',
    url: '/operating_room/scrub_nurse.glb',
    targetHeightM: 1.68,
    rotationY: 0,
  },
];

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const loading = new Set();
const loaded = new Set();
let installed = false;
let originalRender = null;

const isMainSimulatorScene = scene => (
  scene?.background?.isColor
  && scene.background.getHex() === MAIN_SCENE_BACKGROUND
);

const disposeObject = object => {
  object?.traverse?.(child => {
    if (!child?.isMesh) return;
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) {
      child.material.forEach(material => material?.dispose?.());
    } else {
      child.material?.dispose?.();
    }
  });
};

const prepareModel = (scene, targetHeightM) => {
  scene.updateMatrixWorld(true);

  const firstBox = new THREE.Box3().setFromObject(scene);
  const firstSize = new THREE.Vector3();
  firstBox.getSize(firstSize);

  if (!Number.isFinite(firstSize.y) || firstSize.y <= 1e-6) {
    throw new Error('Model has no measurable height.');
  }

  const scale = targetHeightM / firstSize.y;
  scene.scale.multiplyScalar(scale);
  scene.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(scene);
  const center = new THREE.Vector3();
  scaledBox.getCenter(center);

  // Normalize the imported model around its local origin and place its lowest
  // point on the OR floor. The wrapper group remains the draggable/collision ID.
  scene.position.x -= center.x;
  scene.position.z -= center.z;
  scene.position.y -= scaledBox.min.y;

  scene.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = true;
  });

  scene.updateMatrixWorld(true);
  return scene;
};

const replaceProceduralChildren = async (root, config) => {
  if (!root || loading.has(config.rootName) || loaded.has(config.rootName)) return;
  loading.add(config.rootName);

  try {
    const gltf = await loader.loadAsync(config.url);
    const model = prepareModel(gltf.scene, config.targetHeightM);
    model.name = `${config.rootName}_realistic_glb`;
    model.rotation.y += config.rotationY || 0;
    model.userData.realisticOperatingRoomAsset = true;
    model.userData.sourceUrl = config.url;

    // Keep the existing wrapper root and its world placement. This preserves
    // the IDs expected by OR dragging, scenario presets, and collision code.
    const oldChildren = [...root.children];
    oldChildren.forEach(child => root.remove(child));
    oldChildren.forEach(disposeObject);

    root.add(model);
    root.userData.realisticAssetLoaded = true;
    root.userData.realisticAssetUrl = config.url;
    root.updateMatrixWorld(true);

    loaded.add(config.rootName);
    console.info(`[OR assets] Loaded ${config.rootName} from ${config.url}`);
  } catch (error) {
    console.error(`[OR assets] Failed to load ${config.url}`, error);
  } finally {
    loading.delete(config.rootName);
  }
};

const hydrateScene = scene => {
  if (!isMainSimulatorScene(scene)) return;
  const equipmentGroup = scene.getObjectByName(EQUIPMENT_GROUP_NAME);
  if (!equipmentGroup) return;

  ASSETS.forEach(config => {
    const root = equipmentGroup.getObjectByName(config.rootName);
    if (root && !root.userData.realisticAssetLoaded) {
      replaceProceduralChildren(root, config);
    }
  });
};

export const installRealisticOperatingRoomAssets = () => {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  originalRender = THREE.WebGLRenderer.prototype.render;
  THREE.WebGLRenderer.prototype.render = function realisticOrAssetRender(scene, camera) {
    hydrateScene(scene);
    return originalRender.call(this, scene, camera);
  };
};

installRealisticOperatingRoomAssets();
