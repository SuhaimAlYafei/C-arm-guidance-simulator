import React from 'react';

const STATUS_COLORS = {
  CLEAR: '#22c55e',
  WARNING: '#f59e0b',
  COLLISION: '#ef4444',
  UNKNOWN: '#94a3b8',
};

export default function SafetyStatusPanel({
  visible,
  onToggle,
  result,
  ivPoleEnabled = true,
  onToggleIVPole,
}) {
  const status = result?.status || 'UNKNOWN';
  const color = STATUS_COLORS[status] || STATUS_COLORS.UNKNOWN;
  const clearance = Number(result?.minimumClearanceMm);

  return (
    <div
      style={{
        position: 'absolute',
        right: 24,
        bottom: 92,
        zIndex: 2500,
        width: 250,
        padding: 12,
        borderRadius: 12,
        background: 'rgba(15,23,42,0.94)',
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 12px 36px rgba(0,0,0,0.35)',
        color: '#fff',
        fontFamily: 'Inter, system-ui, sans-serif',
        backdropFilter: 'blur(14px)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5 }}>
            COLLISION SAFETY
          </div>
          <div style={{ marginTop: 3, fontSize: 9, color: '#94a3b8' }}>
            Internal simulator clearance monitor
          </div>
        </div>

        <div
          style={{
            alignSelf: 'flex-start',
            padding: '4px 7px',
            borderRadius: 999,
            border: `1px solid ${color}`,
            color,
            fontSize: 9,
            fontWeight: 800,
          }}
        >
          {status}
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: 10, lineHeight: 1.45 }}>
        <strong>Minimum clearance:</strong>{' '}
        {Number.isFinite(clearance) ? `${clearance.toFixed(0)} mm` : '—'}
      </div>

      {result?.closest && (
        <div style={{ marginTop: 4, color: '#cbd5e1', fontSize: 9, lineHeight: 1.4 }}>
          Closest: {result.closest.proxy} → {result.closest.obstacle}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginTop: 10 }}>
        <button
          type="button"
          onClick={onToggle}
          style={{
            padding: '8px 9px',
            borderRadius: 8,
            border: visible ? '1px solid #60a5fa' : '1px solid #475569',
            background: visible ? 'rgba(59,130,246,0.18)' : 'rgba(255,255,255,0.04)',
            color: '#fff',
            cursor: 'pointer',
            fontSize: 9,
            fontWeight: 700,
          }}
        >
          {visible ? 'HIDE BUBBLES' : 'SHOW BUBBLES'}
        </button>

        <button
          type="button"
          onClick={onToggleIVPole}
          style={{
            padding: '8px 9px',
            borderRadius: 8,
            border: ivPoleEnabled ? '1px solid #a78bfa' : '1px solid #475569',
            background: ivPoleEnabled ? 'rgba(139,92,246,0.17)' : 'rgba(255,255,255,0.04)',
            color: '#fff',
            cursor: 'pointer',
            fontSize: 9,
            fontWeight: 700,
          }}
        >
          {ivPoleEnabled ? 'IV POLE ON' : 'IV POLE OFF'}
        </button>
      </div>

      <div style={{ marginTop: 8, color: '#64748b', fontSize: 8, lineHeight: 1.35 }}>
        Safety envelopes and proxy clearances are software-only research tools, not validated physical collision guarantees.
      </div>
    </div>
  );
}
