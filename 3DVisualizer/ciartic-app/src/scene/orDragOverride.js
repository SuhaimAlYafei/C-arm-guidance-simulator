import * as THREE from 'three';
import { getOperatingRoomInteractionSnapshot } from './operatingRoomInteraction.js';

// Robust OR drag layer. The original floor-plane drag can fail for shallow
// camera angles and can race OrbitControls. This handler runs at window
// capture priority and converts mouse movement directly into world-floor
// movement using the camera's horizontal right/forward axes.
const MAIN_SCENE_BACKGROUND = 0xeef2f5;
const DRAGGABLE = new Set([
  'or_iv_pole', 'or_mayo_stand', 'or_instrument_trolley',
  'or_anesthesia_workstation', 'or_carm_monitor_cart',
  'or_surgeon', 'or_scrub_nurse',
]);
const ID_BY_NAME = {
  or_iv_pole: 'iv-pole', or_mayo_stand: 'mayo-stand',
  or_instrument_trolley: 'instrument-trolley', or_anesthesia_workstation: 'anesthesia',
  or_carm_monitor_cart: 'monitor-cart', or_surgeon: 'surgeon', or_scrub_nurse: 'scrub-nurse',
};

let scene = null;
let camera = null;
let renderer = null;
let equipment = null;
let safety = null;
let drag = null;
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

const originalRender = THREE.WebGLRenderer.prototype.render;
THREE.WebGLRenderer.prototype.render = function orDragCapture(nextScene, nextCamera) {
  if (nextScene?.background?.isColor && nextScene.background.getHex() === MAIN_SCENE_BACKGROUND) {
    scene = nextScene;
    camera = nextCamera;
    renderer = this;
    equipment = nextScene.getObjectByName('operating_room_equipment_layer');
    safety = nextScene.getObjectByName('operating_room_safety_bubbles');
  }
  return originalRender.call(this, nextScene, nextCamera);
};

const rootFor = object => {
  let current = object;
  while (current && current !== equipment) {
    if (DRAGGABLE.has(current.name)) return current;
    current = current.parent;
  }
  return null;
};

const consume = event => {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
};

const raycastRoot = event => {
  const canvas = renderer?.domElement;
  if (!canvas || !camera || !equipment) return null;
  const rect = canvas.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return null;
  ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  return raycaster.intersectObject(equipment, true).map(hit => rootFor(hit.object)).find(Boolean) || null;
};

const moveBubble = (id, dx, dz) => {
  for (const name of [`safety_${id}`, `safety_edges_${id}`]) {
    const obj = safety?.getObjectByName(name);
    if (!obj) continue;
    obj.position.x += dx;
    obj.position.z += dz;
    obj.updateMatrixWorld(true);
  }
};

window.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !getOperatingRoomInteractionSnapshot().editMode) return;
  const root = raycastRoot(event);
  // Lock camera for every left drag in edit mode, even when selection misses.
  consume(event);
  if (!root) return;
  drag = { pointerId: event.pointerId, root, id: ID_BY_NAME[root.name], x: event.clientX, y: event.clientY };
  try { renderer.domElement.setPointerCapture(event.pointerId); } catch { /* optional */ }
}, true);

window.addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  consume(event);
  const dxPx = event.clientX - drag.x;
  const dyPx = event.clientY - drag.y;
  drag.x = event.clientX;
  drag.y = event.clientY;

  // Camera-relative floor axes make dragging intuitive from any orbit angle.
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  const metersPerPixel = 0.007;
  const delta = right.multiplyScalar(dxPx * metersPerPixel)
    .add(forward.multiplyScalar(-dyPx * metersPerPixel));

  const oldX = drag.root.position.x;
  const oldZ = drag.root.position.z;
  drag.root.position.x = THREE.MathUtils.clamp(oldX + delta.x, -5.8, 5.8);
  drag.root.position.z = THREE.MathUtils.clamp(oldZ + delta.z, -3.8, 3.8);
  const dx = drag.root.position.x - oldX;
  const dz = drag.root.position.z - oldZ;
  drag.root.updateMatrixWorld(true);
  moveBubble(drag.id, dx, dz);
}, true);

const endDrag = event => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  consume(event);
  try { renderer?.domElement?.releasePointerCapture(event.pointerId); } catch { /* optional */ }
  drag = null;
  // The existing interaction layer receives future planner state and will
  // invalidate/re-check the route. Emit a synthetic layout-change signal by
  // toggling edit mode is intentionally avoided so selection stays usable.
  window.dispatchEvent(new CustomEvent('or-layout-dragged'));
};
window.addEventListener('pointerup', endDrag, true);
window.addEventListener('pointercancel', endDrag, true);
