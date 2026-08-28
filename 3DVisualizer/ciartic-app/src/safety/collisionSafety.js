import * as THREE from 'three';

export const SAFETY_CONFIG = Object.freeze({
  warningMarginM: 0.12,
  collisionMarginM: 0.05,
  ivPoleRadiusM: 0.10,
  patientMarginM: 0.08,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function sphereToBoxClearance(center, radius, box) {
  const closest = new THREE.Vector3(
    clamp(center.x, box.min.x, box.max.x),
    clamp(center.y, box.min.y, box.max.y),
    clamp(center.z, box.min.z, box.max.z),
  );

  return center.distanceTo(closest) - radius;
}

export function createExpandedBox(object3D, marginM = 0) {
  if (!object3D) return null;
  object3D.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object3D);
  if (box.isEmpty()) return null;
  return box.expandByScalar(Math.max(0, Number(marginM) || 0));
}

export function classifyClearance(clearanceM, config = SAFETY_CONFIG) {
  if (!Number.isFinite(clearanceM)) return 'UNKNOWN';
  if (clearanceM <= 0) return 'COLLISION';
  if (clearanceM <= config.warningMarginM) return 'WARNING';
  return 'CLEAR';
}

export function evaluateProxySpheres(proxySpheres, obstacles, config = SAFETY_CONFIG) {
  let minimumClearanceM = Infinity;
  let closest = null;
  const checks = [];

  for (const proxy of proxySpheres || []) {
    if (!proxy?.center || !Number.isFinite(proxy.radiusM)) continue;

    for (const obstacle of obstacles || []) {
      if (!obstacle?.box) continue;

      const clearanceM = sphereToBoxClearance(
        proxy.center,
        proxy.radiusM,
        obstacle.box,
      );

      const status = classifyClearance(clearanceM, config);
      const record = {
        proxy: proxy.name || 'C-arm proxy',
        obstacle: obstacle.name || 'Obstacle',
        clearanceM,
        clearanceMm: clearanceM * 1000,
        status,
      };

      checks.push(record);

      if (clearanceM < minimumClearanceM) {
        minimumClearanceM = clearanceM;
        closest = record;
      }
    }
  }

  return {
    status: closest?.status || 'UNKNOWN',
    minimumClearanceM: Number.isFinite(minimumClearanceM)
      ? minimumClearanceM
      : null,
    minimumClearanceMm: Number.isFinite(minimumClearanceM)
      ? minimumClearanceM * 1000
      : null,
    closest,
    collision: checks.some((item) => item.status === 'COLLISION'),
    warning: checks.some((item) => item.status === 'WARNING'),
    checks,
  };
}

export function buildCArmProxySpheres({
  sourceWorld,
  detectorWorld,
  isocenterWorld,
  cartWorld,
}) {
  const proxies = [];

  if (sourceWorld) {
    proxies.push({
      name: 'X-ray source housing',
      center: sourceWorld.clone(),
      radiusM: 0.18,
    });
  }

  if (detectorWorld) {
    proxies.push({
      name: 'Detector housing',
      center: detectorWorld.clone(),
      radiusM: 0.22,
    });
  }

  if (isocenterWorld) {
    // A small proxy around the inner arc near the working field. This is not
    // a replacement for mesh-level collision detection; it is a conservative
    // simulator safety proxy for reproducible software benchmarking.
    proxies.push({
      name: 'C-arm working envelope',
      center: isocenterWorld.clone(),
      radiusM: 0.10,
    });
  }

  if (cartWorld) {
    proxies.push({
      name: 'Mobile cart',
      center: cartWorld.clone(),
      radiusM: 0.32,
    });
  }

  return proxies;
}

export function summarizeSafety(result) {
  if (!result || result.status === 'UNKNOWN') {
    return 'Safety clearance unavailable';
  }

  const clearance = Number(result.minimumClearanceMm);
  const formatted = Number.isFinite(clearance)
    ? `${clearance.toFixed(0)} mm minimum clearance`
    : 'clearance unavailable';

  if (result.collision) return `COLLISION — ${formatted}`;
  if (result.warning) return `WARNING — ${formatted}`;
  return `CLEAR — ${formatted}`;
}
