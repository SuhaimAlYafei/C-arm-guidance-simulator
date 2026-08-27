import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fluoroscopyOutputIndex,
  inverseSquare,
  kapProxyIndex,
  metalArtifactSeverity,
  multiObjectiveScore,
  pathLengthProxy,
  scatterProxyIndex,
  summarizeTrials,
} from './researchMath.js';

test('inverse-square proxy decreases with distance', () => {
  assert.ok(inverseSquare(0.5) > inverseSquare(1.0));
  assert.ok(inverseSquare(1.0) > inverseSquare(2.0));
});

test('fluoroscopy output index grows with duration and kVp', () => {
  const base = fluoroscopyOutputIndex({ durationS: 2, kvp: 80 });
  const longer = fluoroscopyOutputIndex({ durationS: 4, kvp: 80 });
  const harder = fluoroscopyOutputIndex({ durationS: 2, kvp: 100 });
  assert.ok(longer > base);
  assert.ok(harder > base);
});

test('KAP proxy grows with field area', () => {
  assert.ok(kapProxyIndex(1, 20) > kapProxyIndex(1, 10));
});

test('scatter proxy decreases with staff distance', () => {
  const near = scatterProxyIndex({ outputIndex: 2, distanceFromPatientM: 0.5 });
  const far = scatterProxyIndex({ outputIndex: 2, distanceFromPatientM: 2 });
  assert.ok(near > far);
});

test('metal artifact severity is bounded', () => {
  assert.equal(metalArtifactSeverity({ intersectingObjects: 0 }), 0);
  const severe = metalArtifactSeverity({ intersectingObjects: 10, projectedMetalWidthM: 5 });
  assert.ok(severe >= 0 && severe <= 1);
});

test('path length proxy is zero for one waypoint and positive for motion', () => {
  assert.equal(pathLengthProxy([{ pose: { cart_x: 1 } }]), 0);
  assert.ok(pathLengthProxy([
    { pose: { cart_x: 1, cart_z: 0, lift: 0 } },
    { pose: { cart_x: 2, cart_z: 0, lift: 0 } },
  ]) > 0);
});

test('multi-objective score rewards more clearance', () => {
  const low = multiObjectiveScore({ minimumClearanceM: 0.01, pathLength: 1 });
  const high = multiObjectiveScore({ minimumClearanceM: 0.20, pathLength: 1 });
  assert.ok(high > low);
});

test('trial summary reports safe rate and worst clearance', () => {
  const summary = summarizeTrials([
    { collision: false, minimumClearanceM: 0.10 },
    { collision: true, minimumClearanceM: 0 },
    { collision: false, minimumClearanceM: 0.05 },
  ]);
  assert.equal(summary.trials, 3);
  assert.equal(summary.safe_trials, 2);
  assert.equal(summary.collision_trials, 1);
  assert.equal(summary.worst_clearance_m, 0);
});
