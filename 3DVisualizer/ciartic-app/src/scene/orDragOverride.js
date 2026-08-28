// Legacy mouse-drag override intentionally disabled.
//
// OR equipment is now moved through explicit Three.js transform controls in
// operatingRoomTransformController.js. Keeping this module as a no-op avoids
// the previous window-capture pointer handlers that consumed left-click events
// and effectively locked OrbitControls/camera movement while OR edit mode was
// enabled.
//
// The simulator camera must remain freely orbitable at all times.
export const OR_DRAG_OVERRIDE_DISABLED = true;
