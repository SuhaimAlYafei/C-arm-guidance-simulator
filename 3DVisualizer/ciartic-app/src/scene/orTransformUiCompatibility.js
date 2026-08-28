// Compatibility bridge for the V3 OR transform panel.
//
// The transform controller operates directly on the captured OR equipment
// groups and does not require the legacy pointer-drag renderer capture.
// React StrictMode / renderer monkey-patch ordering can leave
// operatingRoomInteraction.ready=false even while the equipment group exists,
// which incorrectly disables the X/Y/Z/rotation/randomize buttons.
//
// This bridge only unlocks those transform buttons when the real OR equipment
// group is present and the panel is in EDITING mode. The button onClick
// handlers remain the React/controller handlers; this module does not move
// scene objects itself.

const TRANSFORM_LABELS = new Set([
  'X −', 'Y −', 'Z −', 'X +', 'Y +', 'Z +',
  '↶ ROTATE', 'ROTATE ↷', '🎲 RANDOMIZE OR',
]);

const equipmentAvailable = () => Boolean(
  window.__carmOperatingRoomEquipment?.isGroup
  || (window.__carmOperatingRoomEquipmentGroups instanceof Set
    && [...window.__carmOperatingRoomEquipmentGroups].some(group => group?.isGroup && group.parent)),
);

const unlockTransformButtons = () => {
  if (!equipmentAvailable()) return;

  const buttons = [...document.querySelectorAll('button')];
  const editing = buttons.some(button => (button.textContent || '').trim() === 'EDITING');
  if (!editing) return;

  buttons.forEach(button => {
    const label = (button.textContent || '').trim();
    if (!TRANSFORM_LABELS.has(label)) return;
    button.disabled = false;
    button.removeAttribute('disabled');
    button.style.opacity = '1';
    button.style.cursor = 'pointer';
  });
};

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const observer = new MutationObserver(unlockTransformButtons);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['disabled', 'style'],
  });

  window.setInterval(unlockTransformButtons, 250);
  queueMicrotask(unlockTransformButtons);
}
