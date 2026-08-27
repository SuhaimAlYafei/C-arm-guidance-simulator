export const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));

export const inverseSquare = (distanceM, referenceM = 1) => {
  const distance = Math.max(0.05, Number(distanceM) || 0.05);
  const reference = Math.max(0.05, Number(referenceM) || 1);
  return (reference * reference) / (distance * distance);
};

/**
 * Dimensionless fluoroscopy output index.
 * This is deliberately NOT a clinical dose estimate. It is a reproducible
 * engineering proxy that can later be calibrated against measured output.
 */
export const fluoroscopyOutputIndex = ({
  kvp = 80,
  tubeCurrentMa = 2.5,
  pulseRatePps = 7.5,
  pulseWidthMs = 5,
  durationS = 5,
  sourceToPatientM = 0.6,
  fieldSizeCm = 20,
} = {}) => {
  const effectiveExposureS = Math.max(0, pulseRatePps)
    * Math.max(0, durationS)
    * Math.max(0, pulseWidthMs) / 1000;
  const mas = Math.max(0, tubeCurrentMa) * effectiveExposureS;
  const beamQuality = Math.pow(Math.max(20, kvp) / 80, 2);
  const distanceFactor = inverseSquare(sourceToPatientM, 1);
  const fieldFactor = Math.pow(Math.max(1, fieldSizeCm) / 20, 2);
  return mas * beamQuality * distanceFactor * fieldFactor;
};

export const kapProxyIndex = (outputIndex, fieldSizeCm = 20) => (
  Math.max(0, Number(outputIndex) || 0) * Math.pow(Math.max(1, fieldSizeCm), 2)
);

export const scatterProxyIndex = ({
  outputIndex = 0,
  distanceFromPatientM = 1,
  angleFactor = 1,
  shieldingFactor = 1,
} = {}) => (
  Math.max(0, Number(outputIndex) || 0)
  * inverseSquare(distanceFromPatientM, 1)
  * clamp01(angleFactor)
  * clamp01(shieldingFactor)
);

export const metalArtifactSeverity = ({
  intersectingObjects = 0,
  projectedMetalWidthM = 0,
  sourceDetectorDistanceM = 0.85,
} = {}) => {
  const countTerm = clamp01(Math.max(0, intersectingObjects) / 3);
  const widthTerm = clamp01(Math.max(0, projectedMetalWidthM) / Math.max(0.1, sourceDetectorDistanceM));
  return clamp01(0.65 * countTerm + 0.35 * widthTerm);
};

export const pathLengthProxy = waypoints => {
  if (!Array.isArray(waypoints) || waypoints.length < 2) return 0;
  let total = 0;
  for (let index = 1; index < waypoints.length; index += 1) {
    const a = waypoints[index - 1]?.pose || waypoints[index - 1] || {};
    const b = waypoints[index]?.pose || waypoints[index] || {};
    total += Math.hypot(
      Number(b.cart_x || 0) - Number(a.cart_x || 0),
      Number(b.cart_z || 0) - Number(a.cart_z || 0),
      Number(b.lift || 0) - Number(a.lift || 0),
      0.35 * (Number(b.column_rot || 0) - Number(a.column_rot || 0)),
      0.35 * (Number(b.wig_wag || 0) - Number(a.wig_wag || 0)),
      0.35 * (Number(b.orbital_slide || 0) - Number(a.orbital_slide || 0)),
    );
  }
  return total;
};

export const multiObjectiveScore = ({
  minimumClearanceM = 0,
  pathLength = 0,
  artifactSeverity = 0,
  scatterIndex = 0,
} = {}) => {
  const clearanceScore = clamp01(Math.max(0, minimumClearanceM) / 0.25);
  const pathScore = 1 / (1 + Math.max(0, pathLength));
  const imageScore = 1 - clamp01(artifactSeverity);
  const radiationScore = 1 / (1 + Math.max(0, scatterIndex));

  return 100 * (
    0.45 * clearanceScore
    + 0.20 * pathScore
    + 0.20 * imageScore
    + 0.15 * radiationScore
  );
};

export const summarizeTrials = trials => {
  const list = Array.isArray(trials) ? trials : [];
  const safe = list.filter(item => item && !item.collision);
  const clearances = list
    .map(item => Number(item?.minimumClearanceM))
    .filter(Number.isFinite);

  return {
    trials: list.length,
    safe_trials: safe.length,
    collision_trials: list.length - safe.length,
    safe_rate: list.length ? safe.length / list.length : 0,
    worst_clearance_m: clearances.length ? Math.min(...clearances) : null,
    mean_clearance_m: clearances.length
      ? clearances.reduce((sum, value) => sum + value, 0) / clearances.length
      : null,
  };
};
