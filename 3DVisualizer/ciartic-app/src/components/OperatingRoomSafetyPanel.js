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

const button = {
  border: '1px solid rgba(255,255,255,.16)',
  borderRadius: 8,
  background: '#1e293b',
  color: '#fff',
  padding: '8px 9px',
  fontSize: 10,
  fontWeight: 850,
  cursor: 'pointer',
};

const row = (label, value, color = '#e2e8f0') => h(
  'div',
  { style: { display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 5, fontSize: 10 } },
  h('span', { style: { color: '#94a3b8' } }, label),
  h('strong', { style: { color, textAlign: 'right' } }, value),
);

const routeColor = status => {
  if (status === 'BLOCKED' || status === 'ERROR') return '#f87171';
  if (status === 'REROUTED') return '#60a5fa';
  if (status === 'DIRECT_NEAR') return '#fbbf24';
  if (status === 'DIRECT_CLEAR') return '#4ade80';
  return '#cbd5e1';
};

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
      : '—';
  const liveStatus = interaction.liveCollisionStatus || orState.collisionStatus || 'SEARCHING';
  const layoutDirty = interaction.layoutDirty || transform.dirty;

  const resetAll = () => {
    resetOperatingRoomLayout();
    notifyOperatingRoomTransformReset();
  };

  if (!open) {
    return h('button', {
      type: 'button',
      onClick: () => setOpen(true),
      style: {
        ...button,
        position: 'fixed',
        left: 12,
        bottom: 10,
        zIndex: 20000,
        background: '#0f766e',
        boxShadow: '0 8px 24px rgba(0,0,0,.35)',
      },
    }, 'OR SAFETY');
  }

  const control = (label, fn) => h('button', {
    type: 'button',
    onClick: fn,
    disabled: !controlsReady,
    style: { ...button, opacity: controlsReady ? 1 : .4 },
  }, label);

  return h('div', {
    style: {
      position: 'fixed',
      left: 12,
      bottom: 58,
      width: 330,
      maxHeight: '78vh',
      overflowY: 'auto',
      zIndex: 19999,
      padding: 12,
      boxSizing: 'border-box',
      borderRadius: 12,
      border: '1px solid rgba(45,212,191,.45)',
      background: 'rgba(15,23,42,.97)',
      color: '#fff',
      boxShadow: '0 12px 40px rgba(0,0,0,.45)',
      backdropFilter: 'blur(10px)',
      pointerEvents: 'auto',
      fontFamily: 'Inter,system-ui,sans-serif',
    },
  },
  h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
    h('div', null,
      h('strong', null, 'OR SAFETY + LAYOUT'),
      h('div', { style: { color: '#94a3b8', fontSize: 9, marginTop: 2 } }, 'Direct scene transforms · camera remains free'),
    ),
    h('button', { type: 'button', onClick: () => setOpen(false), style: { ...button, padding: '3px 8px' } }, '×'),
  ),

  row('Environment', orState.ready ? 'ATTACHED' : 'WAITING', orState.ready ? '#4ade80' : '#fbbf24'),
  row('Transform root', controlsReady ? 'READY' : 'WAITING', controlsReady ? '#4ade80' : '#fbbf24'),
  row('Camera', 'FREE', '#86efac'),
  row('Live status', liveStatus),
  row('Live clearance', liveClearance),
  row('Path status', planner.status || 'IDLE', routeColor(planner.status)),
  row('Checked waypoints', String(planner.checkedWaypoints ?? 0)),

  layoutDirty ? h('div', {
    style: { marginTop: 9, padding: 8, borderRadius: 7, background: 'rgba(245,158,11,.15)', color: '#fde68a', fontSize: 9, fontWeight: 850 },
  }, 'LAYOUT CHANGED · PREVIEW PATH AGAIN BEFORE MOVE C-ARM') : null,

  h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginTop: 11 } },
    h('button', { type: 'button', onClick: toggleOperatingRoomEnvironment, style: { ...button, background: orState.environmentVisible ? '#0f766e' : '#334155' } }, orState.environmentVisible ? 'OR ON' : 'OR OFF'),
    h('button', { type: 'button', onClick: toggleSafetyBubbles, style: { ...button, background: orState.bubblesVisible ? '#6d28d9' : '#334155' } }, orState.bubblesVisible ? 'BUBBLES ON' : 'BUBBLES'),
    h('button', { type: 'button', onClick: resetAll, style: { ...button, gridColumn: '1 / -1' } }, 'RESET LAYOUT'),
  ),

  h('div', { style: { marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(96,165,250,.28)' } },
    h('strong', { style: { color: '#bfdbfe', fontSize: 10 } }, 'OBJECT TRANSFORM'),
    h('select', {
      value: transform.selectedId,
      onChange: e => selectOperatingRoomObject(e.target.value),
      style: {
        width: '100%', marginTop: 7, padding: 8, borderRadius: 7,
        border: '1px solid rgba(148,163,184,.35)', background: '#0f172a', color: '#fff', fontWeight: 800, fontSize: 10,
      },
    }, transform.objects.map(item => h('option', { key: item.id, value: item.id }, item.label))),

    pose ? h('div', { style: { marginTop: 6, color: '#94a3b8', fontFamily: 'monospace', fontSize: 9 } },
      `X ${pose.x.toFixed(2)} · Y ${pose.y.toFixed(2)} · Z ${pose.z.toFixed(2)} · R ${pose.rotationYDeg.toFixed(0)}°`,
    ) : h('div', { style: { marginTop: 6, color: '#fbbf24', fontSize: 9 } }, 'Waiting for live OR object root.'),

    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 9 } },
      control('X −', () => nudgeSelectedOperatingRoomObject('x', -0.10)),
      control('Y −', () => nudgeSelectedOperatingRoomObject('y', -0.05)),
      control('Z −', () => nudgeSelectedOperatingRoomObject('z', -0.10)),
      control('X +', () => nudgeSelectedOperatingRoomObject('x', 0.10)),
      control('Y +', () => nudgeSelectedOperatingRoomObject('y', 0.05)),
      control('Z +', () => nudgeSelectedOperatingRoomObject('z', 0.10)),
    ),
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 } },
      control('↶ ROTATE', () => rotateSelectedOperatingRoomObject(-15)),
      control('ROTATE ↷', () => rotateSelectedOperatingRoomObject(15)),
    ),
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 } },
      h('button', {
        type: 'button', onClick: () => randomizeOperatingRoomLayout(), disabled: !transform.ready,
        style: { ...button, background: '#7c3aed', opacity: transform.ready ? 1 : .4 },
      }, 'RANDOMIZE OR'),
      h('button', {
        type: 'button', onClick: repeatLastOperatingRoomRandomization,
        disabled: !Number.isInteger(transform.lastRandomSeed),
        style: { ...button, opacity: Number.isInteger(transform.lastRandomSeed) ? 1 : .4 },
      }, 'REPEAT SEED'),
    ),
    Number.isInteger(transform.lastRandomSeed)
      ? h('div', { style: { marginTop: 5, color: '#94a3b8', fontSize: 8 } }, `Seed: ${transform.lastRandomSeed}`)
      : null,
    h('div', { style: { marginTop: 7, color: '#94a3b8', fontSize: 8, lineHeight: 1.4 } },
      'X/Z step 10 cm · Y step 5 cm · rotation 15°. No edit mode or camera lock. Moving OR objects invalidates the previous route and requires PREVIEW PATH again.'),
    transform.message ? h('div', { style: { marginTop: 6, color: '#cbd5e1', fontSize: 8 } }, transform.message) : null,
  ));
}
