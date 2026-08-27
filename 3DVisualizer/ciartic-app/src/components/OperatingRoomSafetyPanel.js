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

export default function OperatingRoomSafetyPanel() {
  const [snapshot, setSnapshot] = useState(getOperatingRoomSnapshot);
  const [planner, setPlanner] = useState(getCollisionPlannerSnapshot);
  const [interaction, setInteraction] = useState(getOperatingRoomInteractionSnapshot);

  useEffect(() => subscribeOperatingRoom(setSnapshot), []);
  useEffect(() => subscribeCollisionPlanner(setPlanner), []);
  useEffect(() => subscribeOperatingRoomInteraction(setInteraction), []);

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

  return h(
    'div',
    {
      style: {
        position: 'absolute',
        left: '20px',
        top: '470px',
        width: '220px',
        zIndex: 920,
        padding: '10px',
        boxSizing: 'border-box',
        borderRadius: '9px',
        border: '1px solid rgba(255,255,255,0.18)',
        background: 'rgba(15,23,42,0.90)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
        color: '#fff',
        fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        backdropFilter: 'blur(8px)',
      },
    },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' } },
      h('div', { style: { fontSize: '11px', fontWeight: 900, letterSpacing: '0.5px' } }, 'OR SAFETY + LAYOUT'),
      h('div', {
        title: snapshot.ready && interaction.ready ? 'Operating-room environment and editor attached' : 'Waiting for simulator scene',
        style: {
          width: '8px',
          height: '8px',
          flex: '0 0 auto',
          borderRadius: '999px',
          background: snapshot.ready && interaction.ready ? '#4ade80' : '#94a3b8',
          boxShadow: snapshot.ready && interaction.ready ? '0 0 8px rgba(74,222,128,0.6)' : 'none',
        },
      }),
    ),
    interaction.layoutDirty
      ? h(
          'div',
          {
            style: {
              marginTop: '7px',
              padding: '7px',
              borderRadius: '6px',
              border: '1px solid rgba(245,158,11,0.65)',
              background: 'rgba(245,158,11,0.14)',
              color: '#fde68a',
              fontWeight: 900,
              fontSize: '8px',
              lineHeight: 1.35,
            },
          },
          'LAYOUT CHANGED · PREVIEW PATH AGAIN BEFORE MOVE C-ARM',
        )
      : null,
    h(
      'div',
      {
        style: {
          marginTop: '8px',
          padding: '7px',
          borderRadius: '6px',
          background: 'rgba(2,6,23,0.55)',
          border: `1px solid ${statusColor}55`,
        },
      },
      h('div', { style: { color: statusColor, fontWeight: 900, fontSize: '9px' } }, statusText),
      h('div', { style: { color: '#94a3b8', fontSize: '8px', marginTop: '3px' } }, clearanceText),
    ),
    h(
      'div',
      {
        style: {
          marginTop: '6px',
          padding: '7px',
          borderRadius: '6px',
          background: 'rgba(2,6,23,0.55)',
          border: `1px solid ${routeColor(planner.status)}55`,
        },
      },
      h('div', { style: { color: routeColor(planner.status), fontWeight: 900, fontSize: '9px' } }, routeLabel(planner.status)),
      h('div', { style: { color: '#94a3b8', fontSize: '8px', marginTop: '3px' } }, plannerClearance),
      planner.reason
        ? h('div', { style: { color: '#cbd5e1', fontSize: '7.5px', marginTop: '3px', lineHeight: 1.3 } }, planner.reason)
        : null,
    ),
    h(
      'div',
      { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px', marginTop: '8px' } },
      h(
        'button',
        {
          type: 'button',
          onClick: toggleOperatingRoomEnvironment,
          style: {
            ...baseButton,
            padding: '7px 5px',
            background: snapshot.environmentVisible ? '#0f766e' : '#334155',
          },
          title: 'Toggle IV pole, staff, anesthesia station, carts and surgical light (O)',
        },
        snapshot.environmentVisible ? 'OR ON' : 'OR OFF',
      ),
      h(
        'button',
        {
          type: 'button',
          onClick: toggleSafetyBubbles,
          style: {
            ...baseButton,
            padding: '7px 5px',
            background: snapshot.bubblesVisible ? '#7c3aed' : '#334155',
          },
          title: 'Toggle collision/safety envelopes (B)',
        },
        snapshot.bubblesVisible ? 'BUBBLE ON' : 'BUBBLES',
      ),
      h(
        'button',
        {
          type: 'button',
          onClick: toggleOperatingRoomEditMode,
          disabled: !interaction.ready,
          style: {
            ...baseButton,
            padding: '7px 5px',
            background: interaction.editMode ? '#d97706' : '#334155',
            opacity: interaction.ready ? 1 : 0.55,
            cursor: interaction.ready ? 'pointer' : 'not-allowed',
          },
          title: 'Edit OR layout: select and drag equipment on the floor (E)',
        },
        interaction.editMode ? 'EDITING' : 'EDIT OR',
      ),
    ),
    interaction.editMode
      ? h(
          'div',
          {
            style: {
              marginTop: '6px',
              padding: '7px',
              borderRadius: '6px',
              border: '1px solid rgba(251,191,36,0.35)',
              background: 'rgba(120,53,15,0.14)',
              color: '#fde68a',
              fontSize: '8px',
              lineHeight: 1.4,
            },
          },
          interaction.selectedLabel
            ? `Selected: ${interaction.selectedLabel}. Drag it across the floor.`
            : 'Click an IV pole, Mayo stand, trolley, anesthesia machine, monitor cart, surgeon, or scrub nurse, then drag it.',
        )
      : null,
    h(
      'button',
      {
        type: 'button',
        onClick: resetOperatingRoomLayout,
        disabled: !interaction.ready,
        style: {
          ...baseButton,
          width: '100%',
          marginTop: '6px',
          background: '#1e293b',
          opacity: interaction.ready ? 1 : 0.55,
          cursor: interaction.ready ? 'pointer' : 'not-allowed',
        },
        title: 'Restore the original OR equipment positions',
      },
      'RESET OR LAYOUT',
    ),
    interaction.message
      ? h('div', { style: { marginTop: '6px', color: '#cbd5e1', fontSize: '7.5px', lineHeight: 1.35 } }, interaction.message)
      : null,
    h(
      'div',
      { style: { marginTop: '7px', color: '#94a3b8', fontSize: '7.5px', lineHeight: 1.35 } },
      'E = edit layout · B = bubbles · O = OR equipment. Moving an object invalidates the old route; MOVE C-ARM is guarded until PREVIEW PATH checks the new layout.',
    ),
  );
}
