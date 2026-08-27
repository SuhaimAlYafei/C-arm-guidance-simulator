import React, { useEffect, useState } from 'react';
import {
  getOperatingRoomSnapshot,
  subscribeOperatingRoom,
  toggleOperatingRoomEnvironment,
  toggleSafetyBubbles,
} from '../scene/operatingRoomRuntime.js';

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

export default function OperatingRoomSafetyPanel() {
  const [snapshot, setSnapshot] = useState(getOperatingRoomSnapshot);

  useEffect(() => subscribeOperatingRoom(setSnapshot), []);

  const statusColor = snapshot.collisionStatus === 'COLLISION'
    ? '#f87171'
    : snapshot.collisionStatus === 'NEAR'
      ? '#fbbf24'
      : snapshot.collisionStatus === 'CLEAR'
        ? '#4ade80'
        : '#94a3b8';

  const statusText = snapshot.collisionStatus === 'COLLISION'
    ? `SAFETY CONFLICT · ${snapshot.collisionLabel || 'OR object'}`
    : snapshot.collisionStatus === 'NEAR'
      ? `NEAR · ${snapshot.collisionLabel || 'OR object'}`
      : snapshot.collisionStatus === 'CLEAR'
        ? 'CLEAR'
        : 'LOCATING C-ARM…';

  const clearanceText = Number.isFinite(snapshot.minClearanceM)
    ? `${Math.max(0, snapshot.minClearanceM * 100).toFixed(1)} cm sampled clearance`
    : 'Live scene-space check';

  return h(
    'div',
    {
      style: {
        position: 'absolute',
        left: '20px',
        top: '470px',
        width: '200px',
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
      h('div', { style: { fontSize: '11px', fontWeight: 900, letterSpacing: '0.5px' } }, 'OR SAFETY'),
      h('div', {
        title: snapshot.ready ? 'Operating-room environment attached' : 'Waiting for simulator scene',
        style: {
          width: '8px',
          height: '8px',
          flex: '0 0 auto',
          borderRadius: '999px',
          background: snapshot.ready ? '#4ade80' : '#94a3b8',
          boxShadow: snapshot.ready ? '0 0 8px rgba(74,222,128,0.6)' : 'none',
        },
      }),
    ),
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
      { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '8px' } },
      h(
        'button',
        {
          type: 'button',
          onClick: toggleOperatingRoomEnvironment,
          style: {
            ...baseButton,
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
            background: snapshot.bubblesVisible ? '#7c3aed' : '#334155',
          },
          title: 'Toggle collision/safety envelopes (B)',
        },
        snapshot.bubblesVisible ? 'BUBBLES ON' : 'BUBBLES',
      ),
    ),
    h(
      'div',
      { style: { marginTop: '7px', color: '#94a3b8', fontSize: '7.5px', lineHeight: 1.35 } },
      'B = bubbles · O = OR equipment. Simulation geometry only; not a validated physical safety system.',
    ),
  );
}
