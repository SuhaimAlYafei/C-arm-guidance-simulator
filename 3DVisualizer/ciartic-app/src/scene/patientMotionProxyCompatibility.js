// Compatibility bridge for the V3 respiratory-motion runtime.
//
// The collision model now uses segmented patient proxies (head/torso/pelvis/legs)
// instead of the old monolithic `safety_patient-table` box. The existing motion
// runtime historically bootstraps its thoracic envelope from that old name.
// This bridge briefly exposes the torso proxy under the legacy name so the
// runtime can measure it, then removes the alias as soon as the dynamic
// `safety_patient-motion` envelope has been created.
//
// This does not add a permanent collision obstacle and does not claim to model
// physiological chest deformation. It only restores the research-only moving
// safety-envelope experiment using the refined torso proxy.

import * as THREE from 'three';

let installed = false;
let timer = null;

const ensureBridge = () => {
  const scene = window.__carmMainScene;
  const safetyGroup = scene?.getObjectByName?.('operating_room_safety_bubbles');
  if (!safetyGroup) return false;

  const dynamic = safetyGroup.getObjectByName('safety_patient-motion');
  const legacy = safetyGroup.getObjectByName('safety_patient-table');

  if (dynamic) {
    if (legacy?.userData?.respiratoryCompatibilityAlias) {
      safetyGroup.remove(legacy);
      legacy.geometry?.dispose?.();
      legacy.material?.dispose?.();
    }
    return true;
  }

  if (legacy) return false;

  const torso = safetyGroup.getObjectByName('safety_patient-torso');
  if (!torso?.isMesh) return false;

  // Clone only the torso envelope geometry. Keep it hidden and mark it so the
  // bridge can remove it immediately after patientMotionRuntime initializes.
  const alias = new THREE.Mesh(
    torso.geometry.clone(),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  alias.name = 'safety_patient-table';
  alias.position.copy(torso.position);
  alias.quaternion.copy(torso.quaternion);
  alias.scale.copy(torso.scale);
  alias.visible = false;
  alias.userData.respiratoryCompatibilityAlias = true;
  safetyGroup.add(alias);
  safetyGroup.updateMatrixWorld(true);
  return false;
};

export const installPatientMotionProxyCompatibility = () => {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  timer = window.setInterval(() => {
    const ready = ensureBridge();
    if (ready) {
      window.clearInterval(timer);
      timer = null;
      console.info('[patient motion] segmented torso proxy READY');
    }
  }, 100);

  window.setTimeout(() => {
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
  }, 30000);
};

installPatientMotionProxyCompatibility();
