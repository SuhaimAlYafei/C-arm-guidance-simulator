import * as THREE from 'three';

/**
 * Projects point P onto the infinite line defined by A and B.
 * Returns { t, closestPoint } where closestPoint = A + t * (B - A).
 * t can be outside [0, 1].
 * 
 * @param {THREE.Vector3} P - The point to project
 * @param {THREE.Vector3} A - Start point of line
 * @param {THREE.Vector3} B - End point of line
 * @returns {{t: number, closestPoint: THREE.Vector3}}
 */
export const projectPointToLineParams = (P, A, B) => {
    const ab = new THREE.Vector3().subVectors(B, A);
    const ap = new THREE.Vector3().subVectors(P, A);
    const lenSq = ab.lengthSq();

    // Guard against A == B
    if (lenSq < 1e-12) {
        return { t: 0, closestPoint: A.clone() };
    }

    const t = ap.dot(ab) / lenSq;
    const closestPoint = new THREE.Vector3().copy(A).addScaledVector(ab, t);

    return { t, closestPoint };
};

/**
 * Calculates distance from P to the infinite line passing through A and B.
 * 
 * @param {THREE.Vector3} P 
 * @param {THREE.Vector3} A 
 * @param {THREE.Vector3} B 
 * @returns {number} Distance
 */
export const distancePointToLine = (P, A, B) => {
    const { closestPoint } = projectPointToLineParams(P, A, B);
    return P.distanceTo(closestPoint);
};


/**
 * Calculates distance from P to the segment AB.
 * Clamps t to [0, 1].
 * 
 * @param {THREE.Vector3} P 
 * @param {THREE.Vector3} A 
 * @param {THREE.Vector3} B 
 * @returns {number} Distance
 */
export const distancePointToSegment = (P, A, B) => {
    const ab = new THREE.Vector3().subVectors(B, A);
    const ap = new THREE.Vector3().subVectors(P, A);
    const lenSq = ab.lengthSq();

    if (lenSq < 1e-12) {
        return P.distanceTo(A);
    }

    let t = ap.dot(ab) / lenSq;
    t = Math.max(0, Math.min(1, t)); // Clamp

    const closestPoint = new THREE.Vector3().copy(A).addScaledVector(ab, t);
    return P.distanceTo(closestPoint);
};

/**
 * Allocation-free version of projectPointToLineParams.
 * Writes output to `outClosest`. Uses `tmpAB` and `tmpAP` as scratch.
 * 
 * @param {THREE.Vector3} P 
 * @param {THREE.Vector3} A 
 * @param {THREE.Vector3} B 
 * @param {THREE.Vector3} outClosest - Result written here
 * @param {THREE.Vector3} tmpAB - Scratch vector
 * @param {THREE.Vector3} tmpAP - Scratch vector
 * @returns {number} t (unclamped)
 */
export const projectPointToLineParamsInto = (P, A, B, outClosest, tmpAB, tmpAP) => {
    tmpAB.subVectors(B, A);
    tmpAP.subVectors(P, A);
    const lenSq = tmpAB.lengthSq();

    if (lenSq < 1e-12) {
        outClosest.copy(A);
        return 0;
    }

    const t = tmpAP.dot(tmpAB) / lenSq;
    outClosest.copy(A).addScaledVector(tmpAB, t);
    return t;
};

/**
 * Allocation-free distance to infinite line.
 * 
 * @param {THREE.Vector3} P 
 * @param {THREE.Vector3} A 
 * @param {THREE.Vector3} B 
 * @param {THREE.Vector3} tmpAB - Scratch
 * @param {THREE.Vector3} tmpAP - Scratch
 * @returns {number} Distance
 */
export const distancePointToLineNoAlloc = (P, A, B, tmpAB, tmpAP) => {
    tmpAB.subVectors(B, A); // AB
    tmpAP.subVectors(P, A); // AP

    const lenSq = tmpAB.lengthSq();
    if (lenSq < 1e-12) return P.distanceTo(A);

    // Closest point = A + t*AB. We want dist(P, Closest).
    // Can do without writing to a vector if we want, but using tmpAP is easier if we have another scratch or reuse.
    // Let's reuse tmpAP to store (Closest - P)? No, tmpAP is (P-A).
    // Closest - P = (A + t*AB) - P = (A - P) + t*AB = -AP + t*AB.

    // Reuse tmpAP for result vector: tmpAP.multiplyScalar(-1).addScaledVector(tmpAB, t)
    // distance is length of that.

    // But let's stick to the simple way: Reuse tmpAB for the projection if we can? 
    // Actually, we can just use the provided vectors if the caller gives us a 'outClosest' or we just compute distance.
    // The requirement didn't strictly say NO allocation for the return value, but "returns number".
    // "distancePointToLineNoAlloc(P, A, B, tmpAB, tmpAP)"

    // Project P onto line
    const dot = tmpAP.dot(tmpAB);
    const projLenSq = (dot * dot) / lenSq;
    const apLenSq = tmpAP.lengthSq();
    return Math.sqrt(Math.max(0, apLenSq - projLenSq));
};

/**
 * Allocation-free distance to segment.
 * 
 * @param {THREE.Vector3} P 
 * @param {THREE.Vector3} A 
 * @param {THREE.Vector3} B 
 * @param {THREE.Vector3} outClosest - Result written here (clamped)
 * @param {THREE.Vector3} tmpAB - Scratch
 * @param {THREE.Vector3} tmpAP - Scratch
 * @returns {number} Distance
 */
export const distancePointToSegmentNoAlloc = (P, A, B, outClosest, tmpAB, tmpAP) => {
    // 1. Project to infinite line (sets tmpAB = B-A)
    const t = projectPointToLineParamsInto(P, A, B, outClosest, tmpAB, tmpAP);

    // 2. Clamp t
    const tClamped = Math.max(0, Math.min(1, t));

    // 3. If t was clamped, we need to recompute the closest point
    if (t !== tClamped) {
        outClosest.copy(A).addScaledVector(tmpAB, tClamped);
    }

    // 4. Return actual distance
    return P.distanceTo(outClosest);
};

// --- DEV-ONLY SANITY TESTS ---
// Only run in development
if (import.meta.env.DEV) {
    (() => {
        const P = new THREE.Vector3(1, 1, 0);
        const A = new THREE.Vector3(0, 0, 0);
        const B = new THREE.Vector3(2, 0, 0);
        const out = new THREE.Vector3();
        const tmp1 = new THREE.Vector3();
        const tmp2 = new THREE.Vector3();

        console.log("--- Running Geometry Sanity Tests ---");

        // Case 1: Midpoint (t=0.5)
        const t1 = projectPointToLineParamsInto(new THREE.Vector3(1, 1, 0), A, B, out, tmp1, tmp2);
        if (Math.abs(t1 - 0.5) < 1e-6 && Math.abs(out.x - 1) < 1e-6) console.log("geo test 1 PASS");
        else console.error("geo test 1 FAIL", t1, out);

        // Case 2: Before A (t < 0)
        const t2 = projectPointToLineParamsInto(new THREE.Vector3(-1, 1, 0), A, B, out, tmp1, tmp2);
        if (t2 < 0 && Math.abs(out.x - (-1)) < 1e-6) console.log("geo test 2 PASS");
        else console.error("geo test 2 FAIL", t2, out);

        // Case 3: After B (t > 1)
        const t3 = projectPointToLineParamsInto(new THREE.Vector3(3, 1, 0), A, B, out, tmp1, tmp2);
        if (t3 > 1 && Math.abs(out.x - 3) < 1e-6) console.log("geo test 3 PASS");
        else console.error("geo test 3 FAIL", t3, out);

        // Case 4: Distance Segment (Clamped)
        const dist = distancePointToSegmentNoAlloc(new THREE.Vector3(3, 1, 0), A, B, out, tmp1, tmp2);
        // Closest point on segment [0,0]->[2,0] for (3,1,0) is (2,0,0). Distance is sqrt((3-2)^2 + (1-0)^2) = sqrt(2) ~ 1.414
        if (Math.abs(dist - Math.sqrt(2)) < 1e-6 && Math.abs(out.x - 2) < 1e-6) console.log("geo test 4 PASS");
        else console.error("geo test 4 FAIL", dist, out);

        console.log("--- End Geometry Sanity Tests ---");
    })();
}
