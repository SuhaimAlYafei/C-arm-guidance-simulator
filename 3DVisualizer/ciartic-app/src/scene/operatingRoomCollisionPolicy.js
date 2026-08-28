import * as THREE from 'three';

// Collision-policy refinement for the research OR.
// A single rectangular box around the entire patient/table volume creates
// false positives for valid C-arm imaging poses because the C naturally wraps
// around the patient. Use a thin table slab plus smaller anatomical proxies.

let installed = false;
let timer = null;

const removeNamed = (group, name) => {
  const object = group?.getObjectByName(name);
  if (object?.parent) object.parent.remove(object);
};

const makeProxy = (id, center, size) => {
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  const material = new THREE.MeshBasicMaterial({
    color: 0x16c784,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `safety_${id}`;
  mesh.position.copy(center);
  mesh.renderOrder = 850;

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: 0x16c784, transparent: true, opacity: 0.78 }),
  );
  edges.name = `safety_edges_${id}`;
  edges.position.copy(center);
  edges.renderOrder = 851;
  mesh.userData.edges = edges;
  return { mesh, edges };
};

const addProxyIfMissing = (group, id, center, size) => {
  if (group.getObjectByName(`safety_${id}`)) return;
  const { mesh, edges } = makeProxy(id, center, size);
  group.add(mesh, edges);
};

const applyPolicy = () => {
  const equipment = window.__carmOperatingRoomEquipment;
  const scene = equipment?.parent;
  if (!equipment || !scene) return false;
  const safety = scene.getObjectByName('operating_room_safety_bubbles');
  if (!safety) return false;

  // The old ceiling light was a procedural placeholder and its broad envelope
  // caused irrelevant route failures. Remove both visual and collision proxy.
  removeNamed(equipment, 'or_surgical_light');
  removeNamed(safety, 'safety_surgical-light');
  removeNamed(safety, 'safety_edges_surgical-light');

  // Replace the old full patient/table rectangular envelope with a thin table
  // slab. Patient protection is represented separately by local body proxies.
  removeNamed(safety, 'safety_patient-table');
  removeNamed(safety, 'safety_edges_patient-table');
  addProxyIfMissing(
    safety,
    'operating-table',
    new THREE.Vector3(0, 1.315, 0),
    new THREE.Vector3(0.82, 0.09, 2.18),
  );

  // Neutral simulator proxies following the current supine model's registered
  // longitudinal axis. These are deliberately local instead of one giant AABB.
  addProxyIfMissing(
    safety,
    'patient-head',
    new THREE.Vector3(0, 1.54, -0.70),
    new THREE.Vector3(0.34, 0.32, 0.34),
  );
  addProxyIfMissing(
    safety,
    'patient-torso',
    new THREE.Vector3(0, 1.50, -0.25),
    new THREE.Vector3(0.58, 0.30, 0.56),
  );
  addProxyIfMissing(
    safety,
    'patient-pelvis',
    new THREE.Vector3(0, 1.47, 0.17),
    new THREE.Vector3(0.46, 0.25, 0.34),
  );
  addProxyIfMissing(
    safety,
    'patient-legs',
    new THREE.Vector3(0, 1.43, 0.58),
    new THREE.Vector3(0.38, 0.20, 0.48),
  );

  safety.updateMatrixWorld(true);
  return true;
};

export const installOperatingRoomCollisionPolicy = () => {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  timer = window.setInterval(() => {
    if (applyPolicy()) {
      window.clearInterval(timer);
      timer = null;
      console.info('[OR collision policy] refined patient/table proxies active; surgical light removed');
    }
  }, 250);
  window.setTimeout(() => {
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
    applyPolicy();
  }, 30000);
};

installOperatingRoomCollisionPolicy();
