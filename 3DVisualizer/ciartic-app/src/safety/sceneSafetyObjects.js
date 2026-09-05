import * as THREE from 'three';

const makeMaterial = (color, options = {}) =>
  new THREE.MeshStandardMaterial({
    color,
    metalness: options.metalness ?? 0.25,
    roughness: options.roughness ?? 0.5,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    depthWrite: options.depthWrite ?? true,
  });

export function createIVPole() {
  const group = new THREE.Group();
  group.name = 'iv_pole_obstacle';

  const metal = makeMaterial(0xcbd5e1, { metalness: 0.75, roughness: 0.3 });
  const dark = makeMaterial(0x334155, { metalness: 0.45, roughness: 0.45 });
  const bagMaterial = makeMaterial(0xdbeafe, {
    transparent: true,
    opacity: 0.72,
    roughness: 0.25,
  });

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.022, 1.55, 20),
    metal,
  );
  stem.position.y = 0.86;
  stem.castShadow = true;
  group.add(stem);

  const baseHub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 0.07, 20),
    dark,
  );
  baseHub.position.y = 0.07;
  baseHub.castShadow = true;
  group.add(baseHub);

  const legGeometry = new THREE.BoxGeometry(0.38, 0.035, 0.045);
  for (let i = 0; i < 4; i += 1) {
    const leg = new THREE.Mesh(legGeometry, dark);
    leg.position.y = 0.055;
    leg.rotation.y = (Math.PI / 2) * i;
    leg.castShadow = true;
    group.add(leg);
  }

  const wheelGeometry = new THREE.SphereGeometry(0.035, 12, 10);
  for (const [x, z] of [
    [0.19, 0],
    [-0.19, 0],
    [0, 0.19],
    [0, -0.19],
  ]) {
    const wheel = new THREE.Mesh(wheelGeometry, dark);
    wheel.position.set(x, 0.025, z);
    wheel.scale.y = 0.55;
    group.add(wheel);
  }

  const crossbar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.42, 16),
    metal,
  );
  crossbar.rotation.z = Math.PI / 2;
  crossbar.position.y = 1.64;
  group.add(crossbar);

  for (const x of [-0.19, 0.19]) {
    const hook = new THREE.Mesh(
      new THREE.TorusGeometry(0.035, 0.009, 10, 20, Math.PI),
      metal,
    );
    hook.rotation.z = Math.PI;
    hook.position.set(x, 1.62, 0);
    group.add(hook);
  }

  const bag = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.28, 0.055),
    bagMaterial,
  );
  bag.position.set(-0.19, 1.42, 0);
  bag.castShadow = true;
  group.add(bag);

  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(0.004, 0.004, 0.42, 8),
    bagMaterial,
  );
  tube.position.set(-0.19, 1.12, 0);
  group.add(tube);

  // Default location: beside the table, deliberately close enough that
  // collision-aware planning has something meaningful to evaluate.
  group.position.set(0.62, 0, -0.25);

  return group;
}

export function createSafetyEnvelope({
  name,
  size,
  position = new THREE.Vector3(),
  color = 0x22c55e,
  opacity = 0.16,
}) {
  const group = new THREE.Group();
  group.name = name;

  const fill = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(fill.geometry),
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.75,
    }),
  );

  group.add(fill, edges);
  group.position.copy(position);
  group.renderOrder = 50;
  group.visible = false;

  return group;
}

export function setEnvelopeStatus(envelope, status) {
  if (!envelope) return;

  const color =
    status === 'COLLISION'
      ? 0xef4444
      : status === 'WARNING'
        ? 0xf59e0b
        : 0x22c55e;

  envelope.traverse((object) => {
    if (object.material?.color) object.material.color.setHex(color);
  });
}
