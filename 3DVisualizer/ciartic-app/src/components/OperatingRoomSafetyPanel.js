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
  toggleOperatingRoomEditMode,
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

const baseButton = {
  border: '1px solid rgba(255,255,255,0.16)',
  borderRadius: '7px',
  padding: '7px 8px',
  color: '#fff',
  fontSize: '9px',
  fontWeight: 800,
  cursor: 'pointer',
  letterSpacing: '0.35px',
};

const routeColor = status => {
  if (status === 'BLOCKED' || status === 'ERROR') return '#f87171';
  if (status === 'REROUTED') return '#60a5fa';
  if (status === 'DIRECT_NEAR') return '#fbbf24';
  if (status === 'DIRECT_CLEAR') return '#4ade80';
  if (status === 'CHECKING') return '#c4b5fd';
  return '#94a3b8';
};

const routeLabel = status => ({
  IDLE: 'PATH: NOT CHECKED',
  CHECKING: 'PATH: CHECKING…',
  DIRECT_CLEAR: 'PATH: DIRECT + CLEAR',
  DIRECT_NEAR: 'PATH: DIRECT + NEAR',
  REROUTED: 'PATH: AUTO-REROUTED',
  BLOCKED: 'PATH: BLOCKED',
  UNAVAILABLE: 'PATH: CHECK UNAVAILABLE',
  ERROR: 'PATH: CHECK ERROR',
}[status] || `PATH: ${status}`);

const controlButton = (label, onClick, disabled = false, title = '') => h(
  'button',
  {
    type: 'button',
    onClick,
    disabled,
    title,
    style: {
      ...baseButton,
      background: disabled ? '#1e293b' : '#334155',
      opacity: disabled ? 0.48 : 1,
      cursor: disabled ? 'not-allowed' : 'pointer',
      padding: '7px 4px',
    },
  },
  label,
);

export default function OperatingRoomSafetyPanel() {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(getOperatingRoomSnapshot);
  const [planner, setPlanner] = useState(getCollisionPlannerSnapshot);
  const [interaction, setInteraction] = useState(getOperatingRoomInteractionSnapshot);
  const [transform, setTransform] = useState(getOperatingRoomTransformSnapshot);

  useEffect(() => subscribeOperatingRoom(setSnapshot), []);
  useEffect(() => subscribeCollisionPlanner(setPlanner), []);
  useEffect(() => subscribeOperatingRoomInteraction(setInteraction), []);
  useEffect(() => subscribeOperatingRoomTransform(setTransform), []);

  const liveStatus = interaction.ready
    ? interaction.liveCollisionStatus
    : snapshot.collisionStatus;
  const liveLabel = interaction.ready
    ? interaction.liveCollisionLabel
    : snapshot.collisionLabel;
  const liveClearance = interaction.ready
    ? interaction.liveMinClearanceM
    : snapshot.minClearanceM;

  const statusColor = liveStatus === 'COLLISION'
    ? '#f87171'
    : liveStatus === 'NEAR'
      ? '#fbbf24'
      : liveStatus === 'CLEAR'
        ? '#4ade80'
        : '#94a3b8';

  const statusText = liveStatus === 'COLLISION'
    ? `SAFETY CONFLICT · ${liveLabel || 'OR object'}`
    : liveStatus === 'NEAR'
      ? `NEAR · ${liveLabel || 'OR object'}`
      : liveStatus === 'CLEAR'
        ? 'LIVE POSE CLEAR'
        : 'LOCATING C-ARM…';

  const clearanceText = Number.isFinite(liveClearance)
    ? `${Math.max(0, liveClearance * 100).toFixed(1)} cm live sampled clearance`
    : 'Live scene-space check';

  const plannerClearance = Number.isFinite(planner.minClearanceM)
    ? `${Math.max(0, planner.minClearanceM * 100).toFixed(1)} cm minimum path clearance`
    : planner.checkedWaypoints
      ? `${planner.checkedWaypoints} waypoints checked`
      : 'PREVIEW PATH will run the OR check';

  const layoutDirty = interaction.layoutDirty || transform.dirty;
  const transformDisabled = !interaction.ready || !interaction.editMode;
  const pose = transform.pose;

  const resetAll = () => {
    resetOperatingRoomLayout();
    notifyOperatingRoomTransformReset();
  };

  if (!open) {
    return h(
      'button',
      {
        type: 'button',
        onClick: () => setOpen(true),
        style: {
          ...baseButton,
          position: 'fixed',
          left: '18px',
          bottom: '18px',
          zIndex: 1250,
          padding: '10px 13px',
          background: 'rgba(15,118,110,0.96)',
          border: '1px solid rgba(45,212,191,0.7)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          backdropFilter: 'blur(10px)',
        },
        title: 'Open OR collision safety and layout controls',
      },
      'OR SAFETY',
    );
  }

  return h(
    'div',
    {
      style: {
        position: 'fixed',
        left: '18px',
        bottom: '72px',
        width: '285px',
        maxWidth: 'calc(100vw - 36px)',
        maxHeight: 'calc(100vh - 110px)',
        overflowY: 'auto',
        zIndex: 1250,
        padding: '11px',
        boxSizing: 'border-box',
        borderRadius: '11px',
        border: '1px solid rgba(45,212,191,0.45)',
        background: 'rgba(15,23,42,0.97)',
        boxShadow: '0 18px 50px rgba(0,0,0,0.48)',
        color: '#fff',
        fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        backdropFilter: 'blur(12px)',
      },
    },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', position: 'sticky', top: '-11px', padding: '8px 0', background: 'rgba(15,23,42,0.98)', zIndex: 2 } },
      h('div', { style: { fontSize: '11px', fontWeight: 900, letterSpacing: '0.5px' } }, 'OR SAFETY + LAYOUT'),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '7px' } },
        h('div', {
          title: snapshot.ready && interaction.ready ? 'Operating-room environment and editor attached' : 'Waiting for simulator scene',
          style: {
            width: '8px',
            height: '8px',
            borderRadius: '999px',
            background: snapshot.ready && interaction.ready ? '#4ade80' : '#94a3b8',
            boxShadow: snapshot.ready && interaction.ready ? '0 0 8px rgba(74,222,128,0.6)' : 'none',
          },
        }),
        h('button', { type: 'button', onClick: () => setOpen(false), style: { ...baseButton, padding: '4px 7px', background: '#334155' } }, '×'),
      ),
    ),

    layoutDirty
      ? h('div', { style: { marginTop: '5px', padding: '7px', borderRadius: '6px', border: '1px solid rgba(245,158,11,0.65)', background: 'rgba(245,158,11,0.14)', color: '#fde68a', fontWeight: 900, fontSize: '8px', lineHeight: 1.35 } }, 'LAYOUT CHANGED · PREVIEW PATH AGAIN BEFORE MOVE C-ARM')
      : null,

    h('div', { style: { marginTop: '7px', padding: '7px', borderRadius: '6px', background: 'rgba(2,6,23,0.55)', border: `1px solid ${statusColor}55` } },
      h('div', { style: { color: statusColor, fontWeight: 900, fontSize: '9px' } }, statusText),
      h('div', { style: { color: '#94a3b8', fontSize: '8px', marginTop: '3px' } }, clearanceText),
    ),

    h('div', { style: { marginTop: '6px', padding: '7px', borderRadius: '6px', background: 'rgba(2,6,23,0.55)', border: `1px solid ${routeColor(planner.status)}55` } },
      h('div', { style: { color: routeColor(planner.status), fontWeight: 900, fontSize: '9px' } }, routeLabel(planner.status)),
      h('div', { style: { color: '#94a3b8', fontSize: '8px', marginTop: '3px' } }, plannerClearance),
      planner.reason ? h('div', { style: { color: '#cbd5e1', fontSize: '7.5px', marginTop: '3px', lineHeight: 1.3 } }, planner.reason) : null,
    ),

    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px', marginTop: '8px' } },
      h('button', { type: 'button', onClick: toggleOperatingRoomEnvironment, style: { ...baseButton, padding: '7px 5px', background: snapshot.environmentVisible ? '#0f766e' : '#334155' } }, snapshot.environmentVisible ? 'OR ON' : 'OR OFF'),
      h('button', { type: 'button', onClick: toggleSafetyBubbles, style: { ...baseButton, padding: '7px 5px', background: snapshot.bubblesVisible ? '#7c3aed' : '#334155' } }, snapshot.bubblesVisible ? 'BUBBLE ON' : 'BUBBLES'),
      h('button', { type: 'button', onClick: toggleOperatingRoomEditMode, disabled: !interaction.ready, style: { ...baseButton, padding: '7px 5px', background: interaction.editMode ? '#d97706' : '#334155', opacity: interaction.ready ? 1 : 0.55, cursor: interaction.ready ? 'pointer' : 'not-allowed' } }, interaction.editMode ? 'EDITING' : 'EDIT OR'),
    ),

    h('div', { style: { marginTop: '8px', padding: '8px', borderRadius: '8px', border: '1px solid rgba(96,165,250,0.28)', background: 'rgba(30,41,59,0.58)' } },
      h('div', { style: { fontSize: '9px', fontWeight: 900, color: '#bfdbfe', marginBottom: '6px' } }, 'OBJECT TRANSFORM'),
      h('select', {
        value: transform.selectedId,
        onChange: event => selectOperatingRoomObject(event.target.value),
        disabled: !interaction.ready,
        style: {
          width: '100%',
          padding: '7px',
          borderRadius: '6px',
          border: '1px solid rgba(148,163,184,0.35)',
          background: '#0f172a',
          color: '#fff',
          fontSize: '9px',
          fontWeight: 800,
          boxSizing: 'border-box',
        },
      }, transform.objects.map(item => h('option', { key: item.id, value: item.id }, item.label))),

      pose ? h('div', { style: { marginTop: '5px', color: '#94a3b8', fontSize: '7.5px', fontFamily: 'monospace' } },
        `X ${pose.x.toFixed(2)} · Y ${pose.y.toFixed(2)} · Z ${pose.z.toFixed(2)} · R ${pose.rotationYDeg.toFixed(0)}°`,
      ) : null,

      !interaction.editMode
        ? h('div', { style: { marginTop: '6px', color: '#fbbf24', fontSize: '8px', lineHeight: 1.35 } }, 'Press E or EDIT OR to enable transform controls.')
        : null,

      h('div', { style: { display: 'grid', gridTemplateColumns: '32px 1fr 1fr', gap: '5px', alignItems: 'center', marginTop: '7px' } },
        h('div', { style: { color: '#fca5a5', fontWeight: 900, fontSize: '9px', textAlign: 'center' } }, 'X'),
        controlButton('− X', () => nudgeSelectedOperatingRoomObject('x', -0.10), transformDisabled),
        controlButton('+ X', () => nudgeSelectedOperatingRoomObject('x', 0.10), transformDisabled),
        h('div', { style: { color: '#86efac', fontWeight: 900, fontSize: '9px', textAlign: 'center' } }, 'Y'),
        controlButton('− Y', () => nudgeSelectedOperatingRoomObject('y', -0.05), transformDisabled),
        controlButton('+ Y', () => nudgeSelectedOperatingRoomObject('y', 0.05), transformDisabled),
        h('div', { style: { color: '#93c5fd', fontWeight: 900, fontSize: '9px', textAlign: 'center' } }, 'Z'),
        controlButton('− Z', () => nudgeSelectedOperatingRoomObject('z', -0.10), transformDisabled),
        controlButton('+ Z', () => nudgeSelectedOperatingRoomObject('z', 0.10), transformDisabled),
      ),

      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px', marginTop: '6px' } },
        controlButton('↶ ROTATE LEFT', () => rotateSelectedOperatingRoomObject(-15), transformDisabled),
        controlButton('ROTATE RIGHT ↷', () => rotateSelectedOperatingRoomObject(15), transformDisabled),
      ),
      h('div', { style: { marginTop: '5px', color: '#64748b', fontSize: '7px', lineHeight: 1.3 } }, 'Step: X/Z 10 cm · Y 5 cm · rotation 15°. Alt + arrow keys also work for rotation/Z movement.'),
    ),

    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px', marginTop: '7px' } },
      h('button', {
        type: 'button',
        onClick: () => randomizeOperatingRoomLayout(),
        disabled: !interaction.ready,
        style: { ...baseButton, background: '#7c3aed', opacity: interaction.ready ? 1 : 0.55, cursor: interaction.ready ? 'pointer' : 'not-allowed' },
        title: 'Create a new seeded exploratory OR floor layout while keeping equipment away from the patient/table exclusion zone',
      }, '🎲 RANDOMIZE OR'),
      h('button', {
        type: 'button',
        onClick: repeatLastOperatingRoomRandomization,
        disabled: !interaction.ready || !Number.isInteger(transform.lastRandomSeed),
        style: { ...baseButton, background: '#334155', opacity: interaction.ready && Number.isInteger(transform.lastRandomSeed) ? 1 : 0.45 },
      }, 'REPEAT SEED'),
    ),

    Number.isInteger(transform.lastRandomSeed)
      ? h('div', { style: { marginTop: '4px', color: '#a78bfa', fontSize: '7.5px', fontFamily: 'monospace' } }, `Random layout seed: ${transform.lastRandomSeed}`)
      : null,

    h('button', { type: 'button', onClick: resetAll, disabled: !interaction.ready, style: { ...baseButton, width: '100%', marginTop: '6px', background: '#1e293b', opacity: interaction.ready ? 1 : 0.55, cursor: interaction.ready ? 'pointer' : 'not-allowed' } }, 'RESET OR LAYOUT'),

    interaction.message ? h('div', { style: { marginTop: '6px', color: '#cbd5e1', fontSize: '7.5px', lineHeight: 1.35 } }, interaction.message) : null,
    transform.message ? h('div', { style: { marginTop: '4px', color: '#93c5fd', fontSize: '7.5px', lineHeight: 1.35 } }, transform.message) : null,

    h('div', { style: { marginTop: '7px', color: '#94a3b8', fontSize: '7.5px', lineHeight: 1.35 } }, 'Randomize is an exploratory seeded simulator layout, not measured operating-room geometry. Every transform invalidates the old route; PREVIEW PATH must check the new scene before MOVE C-ARM.'),
  );
}
