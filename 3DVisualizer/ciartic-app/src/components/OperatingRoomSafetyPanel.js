import React, { useEffect, useState } from 'react';
import {
  getOperatingRoomSnapshot,
  subscribeOperatingRoom,
  toggleOperatingRoomEnvironment,
  toggleSafetyBubbles,
} from '../scene/operatingRoomRuntime.js';
import {
  getCollisionPlannerSnapshot,
  subscribeCollisionPlanner,
} from '../scene/collisionAwarePlanner.js';
import {
  getOperatingRoomInteractionSnapshot,
  resetOperatingRoomLayout,
  subscribeOperatingRoomInteraction,
} from '../scene/operatingRoomInteraction.js';
import {
  getOperatingRoomTransformSnapshot,
  nudgeSelectedOperatingRoomObject,
  notifyOperatingRoomTransformReset,
  randomizeOperatingRoomLayout,
  repeatLastOperatingRoomRandomization,
  rotateSelectedOperatingRoomObject,
  selectOperatingRoomObject,
  subscribeOperatingRoomTransform,
} from '../scene/operatingRoomTransformController.js';

const h = React.createElement;

const C = {
  panel: '#d5d8d6',
  panelAlt: '#c7cbca',
  input: '#cfd3d1',
  ink: '#1b2226',
  muted: '#4f5a60',
  border: '#747d81',
  borderSoft: '#9aa1a4',
  green: '#2f5c46',
  amber: '#745726',
  red: '#7a3735',
  blue: '#294f65',
};

const font = 'Arial, Helvetica, sans-serif';

const buttonStyle = {
  border: `1px solid ${C.border}`,
  borderRadius: 2,
  background: '#bcc2bf',
  color: C.ink,
  minHeight: 34,
  padding: '7px 9px',
  fontFamily: font,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '.02em',
  cursor: 'pointer',
  boxShadow: 'none',
  transition: 'none',
};

const toneFor = status => {
  if (status === 'BLOCKED' || status === 'ERROR' || status === 'COLLISION') return C.red;
  if (status === 'REROUTED') return C.blue;
  if (status === 'DIRECT_NEAR' || status === 'WARNING' || status === 'SEARCHING') return C.amber;
  if (status === 'DIRECT_CLEAR' || status === 'CLEAR' || status === 'READY' || status === 'ATTACHED') return C.green;
  return C.ink;
};

const label = text => h('div', {
  style: {
    marginBottom: 6,
    color: C.muted,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '.12em',
    textTransform: 'uppercase',
  },
}, text);

const statusRow = (name, value, tone = toneFor(value)) => h('div', {
  style: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 12,
    alignItems: 'center',
    minHeight: 30,
    borderBottom: `1px solid ${C.borderSoft}`,
    fontFamily: font,
  },
},
  h('span', { style: { color: C.muted, fontSize: 9 } }, name),
  h('strong', { style: { color: tone, fontSize: 9, letterSpacing: '.03em' } }, value),
);

export default function OperatingRoomSafetyPanel() {
  const [open, setOpen] = useState(false);
  const [orState, setOrState] = useState(getOperatingRoomSnapshot);
  const [interaction, setInteraction] = useState(getOperatingRoomInteractionSnapshot);
  const [planner, setPlanner] = useState(getCollisionPlannerSnapshot);
  const [transform, setTransform] = useState(getOperatingRoomTransformSnapshot);

  useEffect(() => subscribeOperatingRoom(setOrState), []);
  useEffect(() => subscribeOperatingRoomInteraction(setInteraction), []);
  useEffect(() => subscribeCollisionPlanner(setPlanner), []);
  useEffect(() => subscribeOperatingRoomTransform(setTransform), []);

  const pose = transform.pose;
  const controlsReady = Boolean(transform.ready && pose);
  const liveClearance = Number.isFinite(interaction.liveMinClearanceM)
    ? `${Math.max(0, interaction.liveMinClearanceM * 100).toFixed(1)} cm`
    : Number.isFinite(orState.minClearanceM)
      ? `${Math.max(0, orState.minClearanceM * 100).toFixed(1)} cm`
      : 'N/A';
  const liveStatus = interaction.liveCollisionStatus || orState.collisionStatus || 'SEARCHING';
  const pathStatus = planner.status || 'IDLE';
  const layoutDirty = interaction.layoutDirty || transform.dirty;

  const resetAll = () => {
    resetOperatingRoomLayout();
    notifyOperatingRoomTransformReset();
  };

  const action = (text, onClick, options = {}) => h('button', {
    type: 'button',
    onClick,
    disabled: Boolean(options.disabled),
    title: options.title,
    style: {
      ...buttonStyle,
      ...(options.style || {}),
      opacity: options.disabled ? .45 : 1,
      cursor: options.disabled ? 'default' : 'pointer',
    },
  }, text);

  const move = (text, fn) => action(text, fn, { disabled: !controlsReady });

  if (!open) {
    return h('button', {
      type: 'button',
      onClick: () => setOpen(true),
      'aria-label': 'Open operating room controls',
      style: {
        ...buttonStyle,
        position: 'fixed',
        left: 14,
        bottom: 12,
        zIndex: 20000,
        minHeight: 38,
        padding: '0 13px',
        background: '#c2c7c5',
        borderColor: '#666f73',
        letterSpacing: '.09em',
      },
    }, 'OPERATING ROOM');
  }

  return h('div', {
    style: {
      position: 'fixed',
      left: 14,
      bottom: 58,
      width: 340,
      maxWidth: 'calc(100vw - 28px)',
      maxHeight: 'calc(100vh - 76px)',
      overflowY: 'auto',
      zIndex: 19999,
      padding: 14,
      boxSizing: 'border-box',
      borderRadius: 2,
      border: `1px solid ${C.border}`,
      background: C.panel,
      color: C.ink,
      boxShadow: 'none',
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
      pointerEvents: 'auto',
      fontFamily: font,
      scrollbarWidth: 'thin',
      scrollbarColor: '#7f888c transparent',
    },
  },
    h('div', {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 14,
        paddingBottom: 11,
        borderBottom: `2px solid ${C.ink}`,
      },
    },
      h('div', null,
        h('div', { style: { color: C.muted, fontSize: 8, fontWeight: 700, letterSpacing: '.14em' } }, 'DIGITAL TWIN'),
        h('div', { style: { marginTop: 3, color: C.ink, fontSize: 18, lineHeight: 1.05, fontWeight: 800 } }, 'Operating Room'),
        h('div', { style: { marginTop: 4, color: C.muted, fontSize: 9 } }, 'Collision planning and scene positioning'),
      ),
      action('X', () => setOpen(false), { style: { width: 32, minWidth: 32, padding: 0 } }),
    ),

    h('div', { style: { marginTop: 10 } },
      statusRow('Collision state', liveStatus),
      statusRow('Clearance', liveClearance, liveStatus === 'COLLISION' ? C.red : C.ink),
      statusRow('Environment', orState.ready ? 'ATTACHED' : 'WAITING', orState.ready ? C.green : C.amber),
      statusRow('Object controls', controlsReady ? 'READY' : 'WAITING', controlsReady ? C.green : C.amber),
      statusRow('Camera', 'FREE', C.green),
      statusRow('Path', pathStatus),
      statusRow('Checked waypoints', String(planner.checkedWaypoints ?? 0), C.ink),
    ),

    layoutDirty ? h('div', {
      style: {
        marginTop: 10,
        padding: '8px 9px',
        border: `1px solid ${C.amber}`,
        background: '#c2b691',
        color: '#2c261a',
        fontSize: 9,
        fontWeight: 700,
        lineHeight: 1.35,
      },
    }, 'Scene changed. Preview the path again before moving the C-arm.') : null,

    h('div', { style: { marginTop: 14 } },
      label('Scene'),
      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 } },
        action(orState.environmentVisible ? 'SCENE ON' : 'SCENE OFF', toggleOperatingRoomEnvironment),
        action(orState.bubblesVisible ? 'HIDE COLLISION BOXES' : 'SHOW COLLISION BOXES', toggleSafetyBubbles),
        action('RESET LAYOUT', resetAll, { style: { gridColumn: '1 / -1' } }),
      ),
    ),

    h('div', { style: { marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}` } },
      label('Object position'),
      h('select', {
        value: transform.selectedId,
        onChange: e => selectOperatingRoomObject(e.target.value),
        style: {
          width: '100%',
          height: 36,
          padding: '0 10px',
          borderRadius: 2,
          border: `1px solid ${C.border}`,
          outline: 'none',
          background: C.input,
          color: C.ink,
          boxShadow: 'none',
          fontFamily: font,
          fontWeight: 700,
          fontSize: 10,
        },
      }, transform.objects.map(item => h('option', { key: item.id, value: item.id }, item.label))),

      pose ? h('div', {
        style: {
          marginTop: 7,
          padding: '6px 8px',
          border: `1px solid ${C.borderSoft}`,
          color: C.muted,
          background: C.panelAlt,
          fontFamily: 'Consolas, "Courier New", monospace',
          fontSize: 8.5,
          textAlign: 'center',
        },
      }, `X ${pose.x.toFixed(2)} | Y ${pose.y.toFixed(2)} | Z ${pose.z.toFixed(2)} | R ${pose.rotationYDeg.toFixed(0)} deg`)
        : h('div', { style: { marginTop: 7, color: C.amber, fontSize: 9 } }, 'Waiting for live OR object root.'),

      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 8 } },
        move('X -', () => nudgeSelectedOperatingRoomObject('x', -0.10)),
        move('Y -', () => nudgeSelectedOperatingRoomObject('y', -0.05)),
        move('Z -', () => nudgeSelectedOperatingRoomObject('z', -0.10)),
        move('X +', () => nudgeSelectedOperatingRoomObject('x', 0.10)),
        move('Y +', () => nudgeSelectedOperatingRoomObject('y', 0.05)),
        move('Z +', () => nudgeSelectedOperatingRoomObject('z', 0.10)),
      ),

      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 } },
        move('ROTATE -15', () => rotateSelectedOperatingRoomObject(-15)),
        move('ROTATE +15', () => rotateSelectedOperatingRoomObject(15)),
      ),

      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 } },
        action('RANDOMIZE OR', () => randomizeOperatingRoomLayout(), { disabled: !transform.ready }),
        action('REPEAT SEED', repeatLastOperatingRoomRandomization, { disabled: !Number.isInteger(transform.lastRandomSeed) }),
      ),

      Number.isInteger(transform.lastRandomSeed)
        ? h('div', { style: { marginTop: 6, color: C.muted, fontSize: 8 } }, `Seed ${transform.lastRandomSeed}`)
        : null,

      h('div', { style: { marginTop: 8, color: C.muted, fontSize: 8, lineHeight: 1.45 } },
        'X and Z step 10 cm. Y step 5 cm. Rotation step 15 deg. Moving an OR object invalidates the previous route and requires Preview Path again.'),

      transform.message
        ? h('div', { style: { marginTop: 7, color: C.muted, fontSize: 8 } }, transform.message)
        : null,
    ),
  );
}
