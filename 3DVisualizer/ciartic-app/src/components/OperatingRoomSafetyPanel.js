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

const palette = {
  panel: '#eee9df',
  panelTop: '#f6f2ea',
  clay: '#e5ded2',
  clayLight: '#f7f3ec',
  clayDark: '#d4ccbf',
  ink: '#272521',
  muted: '#746f67',
  hairline: 'rgba(64, 57, 49, 0.10)',
  green: '#496b5a',
  amber: '#9a6d32',
  red: '#9a4f49',
  blue: '#526b84',
};

const panelShadow = '0 20px 54px rgba(40, 35, 29, 0.22), 0 3px 10px rgba(40, 35, 29, 0.10)';
const raisedShadow = '7px 7px 16px rgba(126, 116, 101, 0.20), -7px -7px 16px rgba(255, 255, 255, 0.68)';
const shallowShadow = '4px 4px 10px rgba(126, 116, 101, 0.16), -4px -4px 10px rgba(255, 255, 255, 0.55)';
const insetShadow = 'inset 2px 2px 5px rgba(126, 116, 101, 0.16), inset -2px -2px 5px rgba(255, 255, 255, 0.58)';

const baseButton = {
  appearance: 'none',
  border: '1px solid rgba(77, 69, 59, 0.08)',
  borderRadius: 13,
  background: `linear-gradient(145deg, ${palette.clayLight}, ${palette.clay})`,
  color: palette.ink,
  minHeight: 36,
  padding: '8px 10px',
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontSize: 10,
  fontWeight: 760,
  letterSpacing: '0.035em',
  cursor: 'pointer',
  boxShadow: shallowShadow,
  transition: 'transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease',
};

const sectionLabel = text => h('div', {
  style: {
    marginBottom: 8,
    color: palette.muted,
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
  },
}, text);

const statusTone = status => {
  if (status === 'BLOCKED' || status === 'ERROR' || status === 'COLLISION') return palette.red;
  if (status === 'REROUTED') return palette.blue;
  if (status === 'DIRECT_NEAR' || status === 'WARNING' || status === 'SEARCHING') return palette.amber;
  if (status === 'DIRECT_CLEAR' || status === 'CLEAR' || status === 'READY' || status === 'ATTACHED') return palette.green;
  return palette.ink;
};

const statusPill = (label, value, tone) => h('div', {
  style: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minHeight: 30,
    padding: '0 10px',
    borderRadius: 11,
    background: 'rgba(255,255,255,0.30)',
    border: `1px solid ${palette.hairline}`,
    boxShadow: insetShadow,
  },
},
  h('span', { style: { color: palette.muted, fontSize: 9, fontWeight: 680 } }, label),
  h('strong', {
    style: {
      color: tone || statusTone(value),
      fontSize: 9,
      fontWeight: 850,
      letterSpacing: '0.045em',
      textAlign: 'right',
    },
  }, value),
);

const metricCard = (label, value, tone = palette.ink) => h('div', {
  style: {
    minWidth: 0,
    padding: '11px 12px 10px',
    borderRadius: 16,
    background: `linear-gradient(145deg, ${palette.clayLight}, ${palette.clay})`,
    border: `1px solid ${palette.hairline}`,
    boxShadow: raisedShadow,
  },
},
  h('div', {
    style: {
      color: palette.muted,
      fontSize: 8,
      fontWeight: 800,
      letterSpacing: '0.11em',
      textTransform: 'uppercase',
    },
  }, label),
  h('div', {
    style: {
      marginTop: 4,
      color: tone,
      fontSize: 15,
      lineHeight: 1.05,
      fontWeight: 850,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
  }, value),
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
      : '—';
  const liveStatus = interaction.liveCollisionStatus || orState.collisionStatus || 'SEARCHING';
  const pathStatus = planner.status || 'IDLE';
  const layoutDirty = interaction.layoutDirty || transform.dirty;

  const resetAll = () => {
    resetOperatingRoomLayout();
    notifyOperatingRoomTransformReset();
  };

  const actionButton = (label, onClick, options = {}) => h('button', {
    type: 'button',
    onClick,
    disabled: Boolean(options.disabled),
    title: options.title,
    style: {
      ...baseButton,
      ...(options.style || {}),
      opacity: options.disabled ? 0.42 : 1,
      cursor: options.disabled ? 'default' : 'pointer',
    },
  }, label);

  const transformControl = (label, fn) => actionButton(label, fn, { disabled: !controlsReady });

  if (!open) {
    return h('button', {
      type: 'button',
      onClick: () => setOpen(true),
      'aria-label': 'Open operating room controls',
      style: {
        ...baseButton,
        position: 'fixed',
        left: 14,
        bottom: 12,
        zIndex: 20000,
        minHeight: 42,
        padding: '0 15px',
        borderRadius: 18,
        background: `linear-gradient(145deg, ${palette.panelTop}, ${palette.clayDark})`,
        color: palette.ink,
        boxShadow: panelShadow,
        fontSize: 10,
        letterSpacing: '0.12em',
      },
    }, 'OPERATING ROOM');
  }

  return h('div', {
    style: {
      position: 'fixed',
      left: 14,
      bottom: 64,
      width: 350,
      maxWidth: 'calc(100vw - 28px)',
      maxHeight: 'calc(100vh - 86px)',
      overflowY: 'auto',
      zIndex: 19999,
      padding: 14,
      boxSizing: 'border-box',
      borderRadius: 24,
      border: `1px solid ${palette.hairline}`,
      background: `linear-gradient(155deg, ${palette.panelTop} 0%, ${palette.panel} 52%, #e4ddd2 100%)`,
      color: palette.ink,
      boxShadow: panelShadow,
      backdropFilter: 'blur(18px) saturate(0.9)',
      WebkitBackdropFilter: 'blur(18px) saturate(0.9)',
      pointerEvents: 'auto',
      fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      scrollbarWidth: 'thin',
      scrollbarColor: '#c8c0b4 transparent',
    },
  },
  h('div', {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 14,
      padding: '3px 3px 12px',
    },
  },
    h('div', { style: { minWidth: 0 } },
      h('div', {
        style: {
          color: palette.muted,
          fontSize: 8,
          fontWeight: 820,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
        },
      }, 'Digital twin'),
      h('div', {
        style: {
          marginTop: 3,
          color: palette.ink,
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize: 21,
          lineHeight: 1.05,
          fontWeight: 600,
          letterSpacing: '-0.025em',
        },
      }, 'Operating Room'),
      h('div', {
        style: {
          marginTop: 5,
          color: palette.muted,
          fontSize: 9,
          lineHeight: 1.35,
        },
      }, 'Collision planning and scene positioning'),
    ),
    h('button', {
      type: 'button',
      onClick: () => setOpen(false),
      'aria-label': 'Close operating room controls',
      style: {
        ...baseButton,
        width: 34,
        minWidth: 34,
        height: 34,
        minHeight: 34,
        padding: 0,
        borderRadius: '50%',
        fontSize: 16,
        lineHeight: 1,
      },
    }, '×'),
  ),

  h('div', {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.15fr .85fr',
      gap: 9,
      marginBottom: 12,
    },
  },
    metricCard('Collision state', liveStatus, statusTone(liveStatus)),
    metricCard('Clearance', liveClearance, liveStatus === 'COLLISION' ? palette.red : palette.ink),
  ),

  layoutDirty ? h('div', {
    style: {
      marginBottom: 12,
      padding: '9px 11px',
      borderRadius: 13,
      background: '#e9dfce',
      border: '1px solid rgba(154,109,50,0.18)',
      boxShadow: insetShadow,
      color: '#79562d',
      fontSize: 9,
      fontWeight: 780,
      lineHeight: 1.35,
    },
  }, 'Scene changed. Preview the path again before moving the C-arm.') : null,

  h('div', {
    style: {
      padding: 11,
      borderRadius: 18,
      background: 'rgba(255,255,255,0.18)',
      border: `1px solid ${palette.hairline}`,
      boxShadow: insetShadow,
    },
  },
    sectionLabel('System'),
    h('div', { style: { display: 'grid', gap: 6 } },
      statusPill('Environment', orState.ready ? 'ATTACHED' : 'WAITING', orState.ready ? palette.green : palette.amber),
      statusPill('Object controls', controlsReady ? 'READY' : 'WAITING', controlsReady ? palette.green : palette.amber),
      statusPill('Camera', 'FREE', palette.green),
      statusPill('Path', pathStatus, statusTone(pathStatus)),
      statusPill('Checked waypoints', String(planner.checkedWaypoints ?? 0), palette.ink),
    ),
  ),

  h('div', { style: { marginTop: 14 } },
    sectionLabel('Scene'),
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } },
      actionButton(orState.environmentVisible ? 'SCENE ON' : 'SCENE OFF', toggleOperatingRoomEnvironment, {
        style: orState.environmentVisible
          ? { color: '#365246', boxShadow: `${shallowShadow}, inset 0 0 0 1px rgba(73,107,90,0.10)` }
          : {},
      }),
      actionButton(orState.bubblesVisible ? 'HIDE COLLISION BOXES' : 'SHOW COLLISION BOXES', toggleSafetyBubbles, {
        style: orState.bubblesVisible
          ? { color: '#4b5e70', boxShadow: `${shallowShadow}, inset 0 0 0 1px rgba(82,107,132,0.10)` }
          : {},
      }),
      actionButton('RESET LAYOUT', resetAll, { style: { gridColumn: '1 / -1' } }),
    ),
  ),

  h('div', {
    style: {
      marginTop: 14,
      paddingTop: 13,
      borderTop: `1px solid ${palette.hairline}`,
    },
  },
    sectionLabel('Object position'),
    h('select', {
      value: transform.selectedId,
      onChange: e => selectOperatingRoomObject(e.target.value),
      style: {
        width: '100%',
        height: 40,
        padding: '0 12px',
        borderRadius: 13,
        border: `1px solid ${palette.hairline}`,
        outline: 'none',
        background: palette.clayLight,
        color: palette.ink,
        boxShadow: insetShadow,
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        fontWeight: 720,
        fontSize: 10,
      },
    }, transform.objects.map(item => h('option', { key: item.id, value: item.id }, item.label))),

    pose ? h('div', {
      style: {
        marginTop: 8,
        padding: '7px 9px',
        borderRadius: 11,
        color: palette.muted,
        background: 'rgba(255,255,255,0.26)',
        border: `1px solid ${palette.hairline}`,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 8.5,
        textAlign: 'center',
        letterSpacing: '0.025em',
      },
    }, `X ${pose.x.toFixed(2)}   Y ${pose.y.toFixed(2)}   Z ${pose.z.toFixed(2)}   R ${pose.rotationYDeg.toFixed(0)}°`)
      : h('div', {
        style: { marginTop: 8, color: palette.amber, fontSize: 9, textAlign: 'center' },
      }, 'Waiting for the selected scene object.'),

    h('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 7,
        marginTop: 9,
      },
    },
      transformControl('X −', () => nudgeSelectedOperatingRoomObject('x', -0.10)),
      transformControl('Y −', () => nudgeSelectedOperatingRoomObject('y', -0.05)),
      transformControl('Z −', () => nudgeSelectedOperatingRoomObject('z', -0.10)),
      transformControl('X +', () => nudgeSelectedOperatingRoomObject('x', 0.10)),
      transformControl('Y +', () => nudgeSelectedOperatingRoomObject('y', 0.05)),
      transformControl('Z +', () => nudgeSelectedOperatingRoomObject('z', 0.10)),
    ),

    h('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 7,
        marginTop: 7,
      },
    },
      transformControl('ROTATE −15°', () => rotateSelectedOperatingRoomObject(-15)),
      transformControl('ROTATE +15°', () => rotateSelectedOperatingRoomObject(15)),
    ),
  ),

  h('div', {
    style: {
      marginTop: 14,
      paddingTop: 13,
      borderTop: `1px solid ${palette.hairline}`,
    },
  },
    sectionLabel('Layout'),
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } },
      actionButton('RANDOMIZE', () => randomizeOperatingRoomLayout(), { disabled: !transform.ready }),
      actionButton('REPEAT', repeatLastOperatingRoomRandomization, {
        disabled: !Number.isInteger(transform.lastRandomSeed),
      }),
    ),
    Number.isInteger(transform.lastRandomSeed)
      ? h('div', {
        style: {
          marginTop: 7,
          color: palette.muted,
          fontSize: 8,
          textAlign: 'center',
          letterSpacing: '0.06em',
        },
      }, `SEED ${transform.lastRandomSeed}`)
      : null,
  ),

  h('div', {
    style: {
      marginTop: 13,
      padding: '9px 10px 2px',
      color: palette.muted,
      fontSize: 8,
      lineHeight: 1.45,
      textAlign: 'center',
    },
  }, '10 cm X/Z · 5 cm Y · 15° rotation · camera stays free'),

  transform.message ? h('div', {
    style: {
      marginTop: 4,
      padding: '7px 9px',
      borderRadius: 10,
      color: palette.muted,
      background: 'rgba(255,255,255,0.20)',
      fontSize: 8,
      lineHeight: 1.35,
      textAlign: 'center',
    },
  }, transform.message) : null,
  );
}
