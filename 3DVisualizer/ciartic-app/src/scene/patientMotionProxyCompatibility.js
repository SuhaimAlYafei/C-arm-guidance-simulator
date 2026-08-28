// Compatibility bridge for the V3 respiratory-motion runtime.
//
// The collision model uses segmented patient proxies (head/torso/pelvis/legs)
// instead of the old monolithic `safety_patient-table` box. The motion runtime
// still bootstraps its thoracic envelope from that legacy name, so this bridge
// exposes a hidden torso-derived alias only long enough for initialization.
// The alias is removed as soon as `safety_patient-motion` exists.
//
// This is a software-only geometric motion proxy, not a physiological model.

import * as THREE from 'three';

let installed = false;
let timer = null;

const liveOperatingRoomScene = () => {
  // Prefer the live equipment groups installed by realisticOperatingRoomAssets.
  const groups = window.__carmOperatingRoomEquipmentGroups;
  if (groups instanceof Set) {
    for (const group of groups) {
      if (group?.isGroup && group.parent) return group.parent;
    }
  }

  const equipment = window.__carmOperatingRoomEquipment;
  if (equipment?.isGroup && equipment.parent) return equipment.parent;

  // Keep this only as a fallback for builds that expose the main scene.
  return window.__carmMainScene || null;
};

const removeAlias = (alias) => {
  if (!alias?.userData?.respiratoryCompatibilityAlias || !alias.parent) return;
  alias.parent.remove(alias);
  alias.geometry?.dispose?.();
  alias.material?.dispose?.();
};

const ensureBridge = () => {
  const scene = liveOperatingRoomScene();
  const safetyGroup = scene?.getObjectByName?.('operating_room_safety_bubbles');
  if (!safetyGroup) return false;

  const dynamic = safetyGroup.getObjectByName('safety_patient-motion');
  const legacy = safetyGroup.getObjectByName('safety_patient-table');

  if (dynamic) {
    removeAlias(legacy);
    return true;
  }

  if (legacy) return false;

  const torso = safetyGroup.getObjectByName('safety_patient-torso');
  if (!torso?.isMesh) return false;

  torso.updateMatrixWorld(true);

  const alias = new THREE.Mesh(
    torso.geometry.clone(),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
    }),
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

  // Fast startup polling only. Stop permanently once the dynamic envelope is
  // established so this bridge adds no ongoing render-loop or timer overhead.
  timer = window.setInterval(() => {
    const ready = ensureBridge();
    if (!ready) return;
    window.clearInterval(timer);
    timer = null;
    console.info('[patient motion] segmented torso proxy READY');
  }, 100);

  window.setTimeout(() => {
    if (!timer) return;
    window.clearInterval(timer);
    timer = null;
    const ready = ensureBridge();
    if (!ready) console.warn('[patient motion] torso proxy initialization timed out');
  }, 15000);
};

installPatientMotionProxyCompatibility();
