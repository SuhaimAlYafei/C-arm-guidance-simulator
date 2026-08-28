import * as THREE from 'three';

// Compatibility bridge between the refined segmented patient collision model
// and patientMotionRuntime. The motion runtime historically initialized from
// `safety_patient-table`; V3 now uses local anatomical proxies instead.
//
// This bridge creates a TEMPORARY hidden initialization proxy from the current
// patient-torso bounds immediately before the existing motion runtime sees a
// rendered frame, then removes it immediately afterwards. It is therefore not
// left in the collision scene and cannot re-introduce the old whole-patient
// rectangular collision obstacle.

let installed = false;
let previousRender = null;

const MAIN_SCENE_BACKGROUND = 0xeef2f5;

const isMainScene = scene => (
  scene?.background?.isColor
  && scene.background.getHex() === MAIN_SCENE_BACKGROUND
);

const makeTemporaryPatientBase = safetyGroup => {
  if (!safetyGroup || safetyGroup.getObjectByName('safety_patient-table')) return null;

  const torso = safetyGroup.getObjectByName('safety_patient-torso');
  if (!torso) return null;

  torso.updateMatrixWorld(true);
  const worldBox = new THREE.Box3().setFromObject(torso);
  if (worldBox.isEmpty()) return null;

  const center = worldBox.getCenter(new THREE.Vector3());
  const size = worldBox.getSize(new THREE.Vector3());
  if (![size.x, size.y, size.z].every(Number.isFinite)) return null;

  // The temporary object only exists long enough for patientMotionRuntime to
  // derive its thoracic motion envelope. It is never a persistent obstacle.
  const geometry = new THREE.BoxGeometry(
    Math.max(size.x, 0.01),
    Math.max(size.y, 0.01),
    Math.max(size.z, 0.01),
  );
  const material = new THREE.MeshBasicMaterial({ visible: false });
  const proxy = new THREE.Mesh(geometry, material);
  proxy.name = 'safety_patient-table';
  proxy.position.copy(center);
  proxy.visible = false;
  proxy.userData.patientMotionInitializationOnly = true;
  safetyGroup.add(proxy);
  proxy.updateMatrixWorld(true);
  return proxy;
};

const removeTemporaryPatientBase = proxy => {
  if (!proxy?.userData?.patientMotionInitializationOnly) return;
  proxy.parent?.remove(proxy);
  proxy.geometry?.dispose?.();
  proxy.material?.dispose?.();
};

export const installPatientMotionCollisionBridge = () => {
  if (installed || typeof window === 'undefined' || !THREE.WebGLRenderer?.prototype?.render) return;
  installed = true;
  previousRender = THREE.WebGLRenderer.prototype.render;

  THREE.WebGLRenderer.prototype.render = function patientMotionCollisionBridgeRender(scene, camera) {
    let temporaryProxy = null;
    if (isMainScene(scene)) {
      const safetyGroup = scene.getObjectByName('operating_room_safety_bubbles');
      temporaryProxy = makeTemporaryPatientBase(safetyGroup);
    }

    try {
      return previousRender.call(this, scene, camera);
    } finally {
      removeTemporaryPatientBase(temporaryProxy);
    }
  };

  console.info('[patient motion] segmented torso compatibility bridge active');
};

installPatientMotionCollisionBridge();
