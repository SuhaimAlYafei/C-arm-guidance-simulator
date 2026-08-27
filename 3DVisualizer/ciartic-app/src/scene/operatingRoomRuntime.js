import * as THREE from 'three';

const MAIN_SCENE_BACKGROUND = 0xeef2f5;
const COLLISION_INTERVAL_MS = 120;
const NEAR_CLEARANCE_M = 0.08;
const CARM_VERTEX_SAMPLE_BUDGET = 70;

const state = {
  mainScene: null,
  equipmentGroup: null,
  safetyGroup: null,
  cArmRoot: null,
  environmentVisible: true,
  bubblesVisible: false,
  ready: false,
  collisionStatus: 'SEARCHING',
  collisionLabel: null,
  minClearanceM: null,
  obstacleResults: [],
  subscribers: new Set(),
  obstacles: [],
};

let hookInstalled = false;
let collisionTimer = null;
let originalSceneAdd = null;

const snapshot = () => ({
  ready: state.ready,
  environmentVisible: state.environmentVisible,
  bubblesVisible: state.bubblesVisible,
  collisionStatus: state.collisionStatus,
  collisionLabel: state.collisionLabel,
  minClearanceM: state.minClearanceM,
  obstacleResults: state.obstacleResults.map(item => ({ ...item })),
});

const emit = () => {
  const next = snapshot();
  state.subscribers.forEach(listener => {
    try {
      listener(next);
    } catch (error) {
      console.warn('[OR runtime] subscriber failed', error);
    }
  });
};

export const getOperatingRoomSnapshot = () => snapshot();

export const subscribeOperatingRoom = (listener) => {
  state.subscribers.add(listener);
  listener(snapshot());
  return () => state.subscribers.delete(listener);
};

export const setSafetyBubblesVisible = (visible) => {
  state.bubblesVisible = Boolean(visible);
  if (state.safetyGroup) state.safetyGroup.visible = state.bubblesVisible;
  emit();
};

export const toggleSafetyBubbles = () => {
  setSafetyBubblesVisible(!state.bubblesVisible);
};

export const setOperatingRoomEnvironmentVisible = (visible) => {
  state.environmentVisible = Boolean(visible);
  if (state.equipmentGroup) state.equipmentGroup.visible = state.environmentVisible;
  emit();
};

export const toggleOperatingRoomEnvironment = () => {
  setOperatingRoomEnvironmentVisible(!state.environmentVisible);
};

const makeStandardMaterial = (color, options = {}) => new THREE.MeshStandardMaterial({
  color,
  roughness: options.roughness ?? 0.55,
  metalness: options.metalness ?? 0.15,
  transparent: options.transparent ?? false,
  opacity: options.opacity ?? 1,
});

const makeCylinderBetween = (start, end, radius, material, radialSegments = 12) => {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, length, radialSegments),
    material,
  );
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  mesh.castShadow = true;
  return mesh;
};

const addShadowFlags = (group) => {
  group.traverse(object => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return group;
};

const createIVPole = () => {
  const group = new THREE.Group();
  group.name = 'or_iv_pole';
  group.position.set(0.95, 0, -0.7);

  const steel = makeStandardMaterial(0xcbd5e1, { roughness: 0.24, metalness: 0.78 });
  const rubber = makeStandardMaterial(0x2f3640, { roughness: 0.82 });
  const bagMat = makeStandardMaterial(0xdff7ff, { transparent: true, opacity: 0.6, roughness: 0.2 });

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.85, 16), steel);
  pole.position.y = 0.98;
  group.add(pole);

  const baseHub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.08, 20), steel);
  baseHub.position.y = 0.08;
  group.add(baseHub);

  const footEnds = [
    new THREE.Vector3(0.34, 0.05, 0),
    new THREE.Vector3(-0.34, 0.05, 0),
    new THREE.Vector3(0, 0.05, 0.34),
    new THREE.Vector3(0, 0.05, -0.34),
  ];
  footEnds.forEach(end => {
    group.add(makeCylinderBetween(new THREE.Vector3(0, 0.08, 0), end, 0.016, steel, 10));
    const caster = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), rubber);
    caster.position.copy(end);
    group.add(caster);
  });

  const topBar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.48, 12), steel);
  topBar.rotation.z = Math.PI / 2;
  topBar.position.y = 1.88;
  group.add(topBar);

  [-0.2, 0.2].forEach(x => {
    const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 10), steel);
    hook.position.set(x, 1.82, 0);
    group.add(hook);
  });

  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.28, 0.055), bagMat);
  bag.position.set(-0.2, 1.58, 0.02);
  group.add(bag);

  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.55, 8), bagMat);
  tube.position.set(-0.2, 1.16, 0.02);
  group.add(tube);

  return addShadowFlags(group);
};

const createMayoStand = () => {
  const group = new THREE.Group();
  group.name = 'or_mayo_stand';
  group.position.set(-0.88, 0, -0.25);
  group.rotation.y = -0.12;

  const steel = makeStandardMaterial(0xd8dee4, { roughness: 0.22, metalness: 0.82 });
  const trayMat = makeStandardMaterial(0xe9eef2, { roughness: 0.18, metalness: 0.72 });
  const dark = makeStandardMaterial(0x4b5563, { roughness: 0.75 });

  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.045, 0.42), trayMat);
  tray.position.y = 1.17;
  group.add(tray);

  const rimFront = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.035, 0.025), steel);
  rimFront.position.set(0, 1.205, 0.2);
  group.add(rimFront);
  const rimBack = rimFront.clone();
  rimBack.position.z = -0.2;
  group.add(rimBack);

  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.92, 12), steel);
  post.position.set(0, 0.69, 0);
  group.add(post);

  const base = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.045, 0.42), steel);
  base.position.y = 0.08;
  group.add(base);

  [
    [-0.2, 0.04, -0.17], [0.2, 0.04, -0.17],
    [-0.2, 0.04, 0.17], [0.2, 0.04, 0.17],
  ].forEach(([x, y, z]) => {
    const caster = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), dark);
    caster.position.set(x, y, z);
    group.add(caster);
  });

  // Generic instrument silhouettes only; no functional detail is modeled.
  const instrumentMat = makeStandardMaterial(0xbcc5ce, { roughness: 0.18, metalness: 0.9 });
  [-0.18, -0.06, 0.08, 0.2].forEach((x, index) => {
    const instrument = new THREE.Mesh(
      new THREE.BoxGeometry(index % 2 === 0 ? 0.18 : 0.14, 0.012, 0.018),
      instrumentMat,
    );
    instrument.position.set(x, 1.205, index % 2 === 0 ? 0.05 : -0.055);
    instrument.rotation.y = index % 2 === 0 ? 0.12 : -0.16;
    group.add(instrument);
  });

  return addShadowFlags(group);
};

const createInstrumentTrolley = () => {
  const group = new THREE.Group();
  group.name = 'or_instrument_trolley';
  group.position.set(-1.25, 0, 0.88);
  group.rotation.y = 0.2;

  const steel = makeStandardMaterial(0xd1d7dc, { roughness: 0.28, metalness: 0.72 });
  const shelfMat = makeStandardMaterial(0xf1f5f9, { roughness: 0.35, metalness: 0.42 });
  const dark = makeStandardMaterial(0x334155, { roughness: 0.85 });

  [0.45, 0.9].forEach(y => {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.045, 0.48), shelfMat);
    shelf.position.y = y;
    group.add(shelf);
  });

  [
    [-0.31, -0.19], [-0.31, 0.19], [0.31, -0.19], [0.31, 0.19],
  ].forEach(([x, z]) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.84, 10), steel);
    leg.position.set(x, 0.45, z);
    group.add(leg);
    const wheel = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), dark);
    wheel.position.set(x, 0.04, z);
    group.add(wheel);
  });

  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.07, 0.28), steel);
  tray.position.set(0, 0.96, 0);
  group.add(tray);

  return addShadowFlags(group);
};

const createAnesthesiaWorkstation = () => {
  const group = new THREE.Group();
  group.name = 'or_anesthesia_workstation';
  group.position.set(0.95, 0, -1.95);
  group.rotation.y = Math.PI;

  const bodyMat = makeStandardMaterial(0xe9eef2, { roughness: 0.42, metalness: 0.18 });
  const dark = makeStandardMaterial(0x1f2937, { roughness: 0.58 });
  const screenMat = new THREE.MeshBasicMaterial({ color: 0x12334a });
  const accent = new THREE.MeshBasicMaterial({ color: 0x48d7c7 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.1, 0.5), bodyMat);
  body.position.y = 0.63;
  group.add(body);

  const console = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.18, 0.42), dark);
  console.position.set(0, 1.13, -0.03);
  console.rotation.x = -0.25;
  group.add(console);

  const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.08), dark);
  monitor.position.set(0, 1.53, 0.02);
  group.add(monitor);

  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.32), screenMat);
  screen.position.set(0, 1.53, -0.022);
  screen.rotation.y = Math.PI;
  group.add(screen);

  const waveform = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.006), accent);
  waveform.position.set(0, 1.53, -0.066);
  group.add(waveform);

  [-0.26, 0.26].forEach(x => {
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.28, 16), bodyMat);
    bottle.position.set(x, 0.22, -0.28);
    group.add(bottle);
  });

  return addShadowFlags(group);
};

const createMonitorCart = () => {
  const group = new THREE.Group();
  group.name = 'or_carm_monitor_cart';
  group.position.set(1.45, 0, 1.75);
  group.rotation.y = -2.45;

  const steel = makeStandardMaterial(0xc8d0d8, { roughness: 0.3, metalness: 0.7 });
  const dark = makeStandardMaterial(0x202a34, { roughness: 0.5 });
  const screen = new THREE.MeshBasicMaterial({ color: 0x173f5f });

  const base = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.52), steel);
  base.position.y = 0.13;
  group.add(base);

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.35, 14), steel);
  pole.position.y = 0.82;
  group.add(pole);

  [-0.34, 0.34].forEach(x => {
    const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.4, 0.08), dark);
    monitor.position.set(x, 1.44, 0);
    monitor.rotation.y = x < 0 ? 0.08 : -0.08;
    group.add(monitor);

    const display = new THREE.Mesh(new THREE.PlaneGeometry(0.49, 0.31), screen);
    display.position.set(x, 1.44, -0.041);
    display.rotation.y = Math.PI + (x < 0 ? 0.08 : -0.08);
    group.add(display);
  });

  return addShadowFlags(group);
};

const createStaffMember = ({ name, position, rotationY = 0, scrubColor = 0x178f79 }) => {
  const group = new THREE.Group();
  group.name = name;
  group.position.copy(position);
  group.rotation.y = rotationY;

  const scrubs = makeStandardMaterial(scrubColor, { roughness: 0.82 });
  const skin = makeStandardMaterial(0xc99772, { roughness: 0.86 });
  const maskMat = makeStandardMaterial(0xd8f3f2, { roughness: 0.9 });
  const shoeMat = makeStandardMaterial(0x263238, { roughness: 0.9 });

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.62, 18), scrubs);
  torso.position.y = 1.12;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 18, 14), skin);
  head.position.y = 1.58;
  group.add(head);

  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.145, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), scrubs);
  cap.position.y = 1.63;
  group.add(cap);

  const mask = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.085, 0.025), maskMat);
  mask.position.set(0, 1.55, -0.126);
  group.add(mask);

  const hip = new THREE.Vector3(0, 0.82, 0);
  const leftShoulder = new THREE.Vector3(-0.18, 1.34, 0);
  const rightShoulder = new THREE.Vector3(0.18, 1.34, 0);
  const leftHand = new THREE.Vector3(-0.28, 0.96, -0.16);
  const rightHand = new THREE.Vector3(0.28, 0.96, -0.16);
  group.add(makeCylinderBetween(leftShoulder, leftHand, 0.055, scrubs, 12));
  group.add(makeCylinderBetween(rightShoulder, rightHand, 0.055, scrubs, 12));

  const leftFoot = new THREE.Vector3(-0.11, 0.09, 0.02);
  const rightFoot = new THREE.Vector3(0.11, 0.09, 0.02);
  group.add(makeCylinderBetween(hip.clone().add(new THREE.Vector3(-0.09, 0, 0)), leftFoot, 0.07, scrubs, 12));
  group.add(makeCylinderBetween(hip.clone().add(new THREE.Vector3(0.09, 0, 0)), rightFoot, 0.07, scrubs, 12));

  [leftFoot, rightFoot].forEach(foot => {
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.07, 0.26), shoeMat);
    shoe.position.copy(foot).add(new THREE.Vector3(0, -0.02, -0.07));
    group.add(shoe);
  });

  return addShadowFlags(group);
};

const createSurgicalLight = () => {
  const group = new THREE.Group();
  group.name = 'or_surgical_light';
  group.position.set(-0.2, 0, -0.15);

  const steel = makeStandardMaterial(0xd7dde3, { roughness: 0.28, metalness: 0.72 });
  const shell = makeStandardMaterial(0xf7fafc, { roughness: 0.35, metalness: 0.18 });
  const lamp = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xfff6d6,
    emissiveIntensity: 1.1,
    roughness: 0.25,
  });

  const ceilingHub = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.12, 20), steel);
  ceilingHub.position.y = 3.55;
  group.add(ceilingHub);

  group.add(makeCylinderBetween(
    new THREE.Vector3(0, 3.5, 0),
    new THREE.Vector3(0.45, 2.92, 0.15),
    0.035,
    steel,
    14,
  ));
  group.add(makeCylinderBetween(
    new THREE.Vector3(0.45, 2.92, 0.15),
    new THREE.Vector3(0.25, 2.55, 0.05),
    0.035,
    steel,
    14,
  ));

  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.43, 0.12, 32), shell);
  head.rotation.x = Math.PI / 2;
  head.position.set(0.25, 2.5, 0.05);
  group.add(head);

  const face = new THREE.Mesh(new THREE.CircleGeometry(0.32, 32), lamp);
  face.position.set(0.25, 2.44, 0.05);
  face.rotation.x = Math.PI / 2;
  group.add(face);

  return addShadowFlags(group);
};

const makeSafetyBoxMesh = (box, id) => {
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  const material = new THREE.MeshBasicMaterial({
    color: 0x16c784,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    side: THREE.DoubleSide,
    wireframe: false,
  });

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
  mesh.position.copy(center);
  mesh.name = `safety_${id}`;
  mesh.renderOrder = 850;
  mesh.userData.safetyMaterial = material;

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)),
    new THREE.LineBasicMaterial({ color: 0x16c784, transparent: true, opacity: 0.78 }),
  );
  edges.position.copy(center);
  edges.name = `safety_edges_${id}`;
  edges.renderOrder = 851;
  mesh.userData.edges = edges;

  return { mesh, edges };
};

const addObstacle = ({ id, label, visualGroup = null, clearance = 0.12, explicitBox = null }) => {
  let box;
  if (explicitBox) {
    box = explicitBox.clone();
  } else {
    visualGroup.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(visualGroup).expandByScalar(clearance);
  }

  const bubble = makeSafetyBoxMesh(box, id);
  state.safetyGroup.add(bubble.mesh);
  state.safetyGroup.add(bubble.edges);

  state.obstacles.push({ id, label, box, bubble, visualGroup });
};

const attachEnvironment = (scene) => {
  if (!scene || scene.userData.__operatingRoomEnvironmentAttached) return;
  scene.userData.__operatingRoomEnvironmentAttached = true;

  state.mainScene = scene;
  state.cArmRoot = null;
  state.obstacles = [];

  const equipmentGroup = new THREE.Group();
  equipmentGroup.name = 'operating_room_equipment_layer';
  equipmentGroup.userData.operatingRoomEnvironment = true;
  equipmentGroup.visible = state.environmentVisible;

  const safetyGroup = new THREE.Group();
  safetyGroup.name = 'operating_room_safety_bubbles';
  safetyGroup.userData.operatingRoomSafety = true;
  safetyGroup.visible = state.bubblesVisible;

  state.equipmentGroup = equipmentGroup;
  state.safetyGroup = safetyGroup;

  const ivPole = createIVPole();
  const mayoStand = createMayoStand();
  const trolley = createInstrumentTrolley();
  const anesthesia = createAnesthesiaWorkstation();
  const monitorCart = createMonitorCart();
  const surgeon = createStaffMember({
    name: 'or_surgeon',
    position: new THREE.Vector3(-0.78, 0, 0.22),
    rotationY: Math.PI / 2.6,
    scrubColor: 0x0f8f7f,
  });
  const scrubNurse = createStaffMember({
    name: 'or_scrub_nurse',
    position: new THREE.Vector3(-1.28, 0, -0.78),
    rotationY: Math.PI / 2.1,
    scrubColor: 0x257f9a,
  });
  const surgicalLight = createSurgicalLight();

  [ivPole, mayoStand, trolley, anesthesia, monitorCart, surgeon, scrubNurse, surgicalLight]
    .forEach(object => equipmentGroup.add(object));

  if (originalSceneAdd) {
    originalSceneAdd.call(scene, equipmentGroup, safetyGroup);
  } else {
    scene.add(equipmentGroup, safetyGroup);
  }

  addObstacle({ id: 'iv-pole', label: 'IV pole', visualGroup: ivPole, clearance: 0.13 });
  addObstacle({ id: 'mayo-stand', label: 'Mayo stand', visualGroup: mayoStand, clearance: 0.1 });
  addObstacle({ id: 'instrument-trolley', label: 'Instrument trolley', visualGroup: trolley, clearance: 0.1 });
  addObstacle({ id: 'anesthesia', label: 'Anesthesia workstation', visualGroup: anesthesia, clearance: 0.15 });
  addObstacle({ id: 'monitor-cart', label: 'C-arm monitor cart', visualGroup: monitorCart, clearance: 0.12 });
  addObstacle({ id: 'surgeon', label: 'Surgeon', visualGroup: surgeon, clearance: 0.16 });
  addObstacle({ id: 'scrub-nurse', label: 'Scrub nurse', visualGroup: scrubNurse, clearance: 0.16 });
  addObstacle({ id: 'surgical-light', label: 'Surgical light', visualGroup: surgicalLight, clearance: 0.1 });

  // Existing patient/table are owned by App.jsx. This is only their safety envelope.
  addObstacle({
    id: 'patient-table',
    label: 'Patient / operating table',
    explicitBox: new THREE.Box3(
      new THREE.Vector3(-0.46, 1.27, -1.12),
      new THREE.Vector3(0.46, 1.92, 1.12),
    ),
  });

  state.ready = true;
  state.collisionStatus = 'SEARCHING';
  state.collisionLabel = null;
  state.minClearanceM = null;
  emit();
};

const findCArmRoot = (scene) => {
  let best = null;
  let bestScore = -Infinity;

  scene.children.forEach(child => {
    if (!child?.isGroup) return;
    if (child.userData?.operatingRoomEnvironment || child.userData?.operatingRoomSafety) return;

    let meshCount = 0;
    let torusCount = 0;
    let cylinderCount = 0;

    child.traverse(object => {
      if (!object.isMesh) return;
      meshCount += 1;
      if (object.geometry?.type === 'TorusGeometry') torusCount += 1;
      if (object.geometry?.type === 'CylinderGeometry') cylinderCount += 1;
    });

    if (torusCount < 2 || meshCount < 8) return;

    const score = torusCount * 20 + cylinderCount * 2 + meshCount;
    if (score > bestScore) {
      bestScore = score;
      best = child;
    }
  });

  return best;
};

const sampleMeshWorldPoints = (mesh, target = []) => {
  const position = mesh.geometry?.attributes?.position;
  if (!position || position.count === 0) return target;

  const step = Math.max(1, Math.ceil(position.count / CARM_VERTEX_SAMPLE_BUDGET));
  const point = new THREE.Vector3();
  for (let index = 0; index < position.count; index += step) {
    point.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
    target.push(point.clone());
  }

  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  if (box) {
    const corners = [
      [box.min.x, box.min.y, box.min.z], [box.min.x, box.min.y, box.max.z],
      [box.min.x, box.max.y, box.min.z], [box.min.x, box.max.y, box.max.z],
      [box.max.x, box.min.y, box.min.z], [box.max.x, box.min.y, box.max.z],
      [box.max.x, box.max.y, box.min.z], [box.max.x, box.max.y, box.max.z],
    ];
    corners.forEach(([x, y, z]) => {
      target.push(new THREE.Vector3(x, y, z).applyMatrix4(mesh.matrixWorld));
    });
  }

  return target;
};

const collectCArmSamplePoints = (root) => {
  const points = [];
  root.traverse(object => {
    if (!object.isMesh || object.visible === false) return;
    sampleMeshWorldPoints(object, points);
  });
  return points;
};

const updateBubbleColor = (obstacle, status) => {
  const hex = status === 'COLLISION'
    ? 0xef4444
    : status === 'NEAR'
      ? 0xf59e0b
      : 0x16c784;

  obstacle.bubble.mesh.material.color.setHex(hex);
  obstacle.bubble.edges.material.color.setHex(hex);
  obstacle.bubble.mesh.material.opacity = status === 'COLLISION' ? 0.22 : status === 'NEAR' ? 0.17 : 0.12;
};

const evaluateCollisions = () => {
  const scene = state.mainScene;
  if (!scene || !state.ready) return;

  scene.updateMatrixWorld(true);

  if (!state.cArmRoot || state.cArmRoot.parent !== scene) {
    state.cArmRoot = findCArmRoot(scene);
  }

  if (!state.cArmRoot) {
    if (state.collisionStatus !== 'SEARCHING') {
      state.collisionStatus = 'SEARCHING';
      state.collisionLabel = null;
      state.minClearanceM = null;
      emit();
    }
    return;
  }

  const samplePoints = collectCArmSamplePoints(state.cArmRoot);
  const results = [];

  state.obstacles.forEach(obstacle => {
    let collision = false;
    let minDistance = Infinity;

    for (const point of samplePoints) {
      if (obstacle.box.containsPoint(point)) {
        collision = true;
        minDistance = 0;
        break;
      }
      minDistance = Math.min(minDistance, obstacle.box.distanceToPoint(point));
    }

    const status = collision
      ? 'COLLISION'
      : minDistance <= NEAR_CLEARANCE_M
        ? 'NEAR'
        : 'CLEAR';

    updateBubbleColor(obstacle, status);
    results.push({
      id: obstacle.id,
      label: obstacle.label,
      status,
      clearanceM: Number.isFinite(minDistance) ? minDistance : null,
    });
  });

  const collision = results.find(item => item.status === 'COLLISION');
  const near = results
    .filter(item => item.status === 'NEAR')
    .sort((a, b) => (a.clearanceM ?? Infinity) - (b.clearanceM ?? Infinity))[0];
  const closest = results
    .filter(item => Number.isFinite(item.clearanceM))
    .sort((a, b) => a.clearanceM - b.clearanceM)[0];

  const nextStatus = collision ? 'COLLISION' : near ? 'NEAR' : 'CLEAR';
  const nextLabel = collision?.label || near?.label || null;
  const nextClearance = collision ? 0 : near?.clearanceM ?? closest?.clearanceM ?? null;

  const changed =
    nextStatus !== state.collisionStatus
    || nextLabel !== state.collisionLabel
    || Math.abs((nextClearance ?? 0) - (state.minClearanceM ?? 0)) > 0.005;

  state.collisionStatus = nextStatus;
  state.collisionLabel = nextLabel;
  state.minClearanceM = nextClearance;
  state.obstacleResults = results;

  if (changed) emit();
};

const startCollisionLoop = () => {
  if (collisionTimer) return;
  collisionTimer = window.setInterval(evaluateCollisions, COLLISION_INTERVAL_MS);
};

const installKeyboardShortcuts = () => {
  if (window.__carmOrKeyboardInstalled) return;
  window.__carmOrKeyboardInstalled = true;

  window.addEventListener('keydown', event => {
    const tag = (event.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (event.repeat) return;

    const key = event.key.toLowerCase();
    if (key === 'b') toggleSafetyBubbles();
    if (key === 'o') toggleOperatingRoomEnvironment();
  });
};

export const installOperatingRoomSceneHook = () => {
  if (hookInstalled) return;
  hookInstalled = true;

  originalSceneAdd = THREE.Scene.prototype.add;

  THREE.Scene.prototype.add = function patchedSceneAdd(...objects) {
    const result = originalSceneAdd.apply(this, objects);

    const isMainSimulatorScene =
      this.background?.isColor
      && this.background.getHex() === MAIN_SCENE_BACKGROUND;

    if (isMainSimulatorScene && !this.userData.__operatingRoomEnvironmentAttached) {
      attachEnvironment(this);
    }

    return result;
  };

  startCollisionLoop();
  installKeyboardShortcuts();
};

installOperatingRoomSceneHook();
