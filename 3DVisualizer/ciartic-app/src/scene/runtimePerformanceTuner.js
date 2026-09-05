import * as THREE from 'three';

const configuredRenderers = new WeakSet();
let installed = false;

export const installRuntimePerformanceTuner = () => {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const previousRender = THREE.WebGLRenderer.prototype.render;

  THREE.WebGLRenderer.prototype.render = function performanceTunedRender(scene, camera) {
    if (!configuredRenderers.has(this)) {
      // Real-time shadow maps are visually pleasant but expensive in this scene,
      // especially with large imported staff meshes. Collision planning and
      // geometry verification do not depend on rasterized shadows.
      this.shadowMap.enabled = false;
      this.shadowMap.autoUpdate = false;

      // Keep a predictable render resolution. Three.js defaults to 1, but this
      // also protects the simulator if another module later requests a very
      // high device pixel ratio on a high-DPI display.
      if (typeof this.setPixelRatio === 'function') this.setPixelRatio(1);

      configuredRenderers.add(this);
    }

    return previousRender.call(this, scene, camera);
  };

  window.__carmPerformanceProfile = {
    realtimeShadows: false,
    pixelRatio: 1,
    reason: 'research geometry is independent of rasterized shadows',
  };
};

installRuntimePerformanceTuner();
