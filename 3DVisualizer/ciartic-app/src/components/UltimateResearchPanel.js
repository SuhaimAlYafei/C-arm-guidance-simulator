import React, { useEffect, useState } from 'react';
import {
  getPatientMotionSnapshot,
  runRespiratoryRobustnessSweep,
  setPatientBreathingRate,
  setPatientMotionAmplitudeMm,
  startAdaptiveMove,
  stopAdaptiveMove,
  subscribePatientMotion,
  togglePatientMotion,
  togglePatientMotionEnvelope,
} from '../scene/patientMotionRuntime.js';
import {
  getRadiationSnapshot,
  setRadiationDurationS,
  setRadiationFieldSizeCm,
  setRadiationKvp,
  setRadiationPulseRatePps,
  setRadiationTubeCurrentMa,
  subscribeRadiation,
  toggleScatterHeatmap,
} from '../scene/radiationIntelligence.js';
import {
  clearResearchLog,
  exportResearchLogCsv,
  exportResearchLogJson,
  getResearchLog,
  subscribeResearchLog,
} from '../scene/researchRunLogger.js';

const h = React.createElement;

const buttonStyle = {
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: '7px',
  padding: '7px 8px',
  fontSize: '8px',
  fontWeight: 900,
  cursor: 'pointer',
  color: '#fff',
  background: '#334155',
};

const stat = (label, value, valueColor = '#e2e8f0') => h(
  'div',
  { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '8px', marginTop: '3px' } },
  h('span', { style: { color: '#94a3b8' } }, label),
  h('span', { style: { color: valueColor, fontWeight: 800, textAlign: 'right' } }, value),
);

const slider = ({ label, value, min, max, step, onChange, suffix = '' }) => h(
  'label',
  { style: { display: 'block', marginTop: '7px' } },
  h(
    'div',
    { style: { display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: '#cbd5e1' } },
    h('span', null, label),
    h('strong', null, `${Number(value).toFixed(step < 1 ? 1 : 0)}${suffix}`),
  ),
  h('input', {
    type: 'range', min, max, step, value,
    onChange: event => onChange(event.target.value),
    style: { width: '100%', margin: '3px 0 0' },
  }),
);

export default function UltimateResearchPanel() {
  const [open, setOpen] = useState(true);
  const [motion, setMotion] = useState(getPatientMotionSnapshot);
  const [radiation, setRadiation] = useState(getRadiationSnapshot);
  const [log, setLog] = useState(getResearchLog);

  useEffect(() => subscribePatientMotion(setMotion), []);
  useEffect(() => subscribeRadiation(setRadiation), []);
  useEffect(() => subscribeResearchLog(setLog), []);

  const robustness = motion.robustnessResult;
  const metalColor = radiation.metalInFov ? '#f87171' : '#4ade80';
  const motionColor = motion.adaptiveStatus === 'BLOCKED' || motion.adaptiveStatus === 'ERROR'
    ? '#f87171'
    : motion.adaptiveStatus === 'MOVING' || motion.adaptiveStatus === 'REPLANNED'
      ? '#60a5fa'
      : '#cbd5e1';

  if (!open) {
    return h(
      'button',
      {
        type: 'button',
        onClick: () => setOpen(true),
        style: {
          position: 'absolute', right: '18px', top: '92px', zIndex: 940,
          ...buttonStyle, background: '#312e81', padding: '9px 12px',
        },
      },
      'RESEARCH LAB',
    );
  }

  return h(
    'div',
    {
      style: {
        position: 'absolute', right: '18px', top: '92px', width: '270px', maxHeight: 'calc(100vh - 120px)',
        overflowY: 'auto', zIndex: 940, padding: '10px', boxSizing: 'border-box',
        border: '1px solid rgba(129,140,248,0.35)', borderRadius: '10px',
        background: 'rgba(15,23,42,0.94)', color: '#fff', boxShadow: '0 10px 32px rgba(0,0,0,0.32)',
        fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif", backdropFilter: 'blur(9px)',
      },
    },
    h(
      'div',
      { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
      h('div', null,
        h('div', { style: { fontSize: '11px', fontWeight: 950, letterSpacing: '0.5px' } }, 'RESEARCH LAB'),
        h('div', { style: { fontSize: '7px', color: '#94a3b8', marginTop: '2px' } }, 'Adaptive digital twin · evidence capture'),
      ),
      h('button', { type: 'button', onClick: () => setOpen(false), style: { ...buttonStyle, padding: '4px 7px' } }, '×'),
    ),

    h('div', { style: { marginTop: '9px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.10)' } },
      h('div', { style: { fontSize: '9px', fontWeight: 900, color: '#7dd3fc' } }, '1 · DYNAMIC PATIENT + REPLANNING'),
      stat('Respiratory displacement', `${(motion.displacementM * 1000).toFixed(1)} mm`),
      stat('Adaptive status', motion.adaptiveStatus, motionColor),
      stat('Live replans', String(motion.replanCount)),
      slider({ label: 'Chest-rise amplitude', value: motion.amplitudeM * 1000, min: 0, max: 25, step: 1, suffix: ' mm', onChange: setPatientMotionAmplitudeMm }),
      slider({ label: 'Ventilation rate', value: motion.breathsPerMinute, min: 6, max: 24, step: 1, suffix: ' bpm', onChange: setPatientBreathingRate }),
      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px', marginTop: '7px' } },
        h('button', { type: 'button', onClick: togglePatientMotion, style: { ...buttonStyle, background: motion.enabled ? '#0369a1' : '#334155' } }, motion.enabled ? 'BREATHING ON' : 'START BREATHING'),
        h('button', { type: 'button', onClick: togglePatientMotionEnvelope, style: { ...buttonStyle, background: motion.envelopeVisible ? '#0e7490' : '#334155' } }, motion.envelopeVisible ? 'ENVELOPE ON' : 'SHOW ENVELOPE'),
        h('button', { type: 'button', onClick: startAdaptiveMove, disabled: !motion.enabled || !motion.hasPlan, style: { ...buttonStyle, opacity: motion.enabled && motion.hasPlan ? 1 : 0.45, background: '#1d4ed8' } }, 'ADAPTIVE MOVE'),
        h('button', { type: 'button', onClick: stopAdaptiveMove, style: { ...buttonStyle, background: '#7f1d1d' } }, 'STOP MOVE'),
      ),
      h('button', { type: 'button', onClick: runRespiratoryRobustnessSweep, disabled: !motion.hasPlan, style: { ...buttonStyle, width: '100%', marginTop: '5px', opacity: motion.hasPlan ? 1 : 0.45, background: '#4c1d95' } }, 'RUN 24-PHASE ROBUSTNESS SWEEP'),
      robustness && !robustness.error
        ? h('div', { style: { marginTop: '6px', padding: '6px', borderRadius: '6px', background: 'rgba(76,29,149,0.20)' } },
            stat('Safe phases', `${robustness.safe_trials}/${robustness.trials}`),
            stat('Safe rate', `${(robustness.safe_rate * 100).toFixed(1)}%`),
            stat('Worst clearance', robustness.worst_clearance_m == null ? '—' : `${(robustness.worst_clearance_m * 100).toFixed(1)} cm`),
          )
        : robustness?.error
          ? h('div', { style: { marginTop: '5px', color: '#fca5a5', fontSize: '7.5px' } }, robustness.error)
          : null,
      motion.adaptiveMessage ? h('div', { style: { marginTop: '5px', color: '#cbd5e1', fontSize: '7.5px', lineHeight: 1.35 } }, motion.adaptiveMessage) : null,
    ),

    h('div', { style: { marginTop: '10px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.10)' } },
      h('div', { style: { fontSize: '9px', fontWeight: 900, color: '#fda4af' } }, '2 · METAL + RADIATION INTELLIGENCE'),
      stat('Metal in beam', radiation.metalInFov ? radiation.metalObjects.join(', ') || 'YES' : 'CLEAR', metalColor),
      stat('Artifact severity', `${(radiation.artifactSeverity * 100).toFixed(0)}%`, radiation.artifactSeverity > 0.45 ? '#f87171' : '#e2e8f0'),
      stat('Output index', radiation.outputIndex == null ? '—' : radiation.outputIndex.toFixed(3)),
      stat('KAP proxy index', radiation.kapIndex == null ? '—' : radiation.kapIndex.toFixed(2)),
      stat('Highest staff scatter', radiation.maxStaffScatter == null ? '—' : radiation.maxStaffScatter.toFixed(3)),
      slider({ label: 'kVp', value: radiation.kvp, min: 50, max: 120, step: 1, suffix: ' kVp', onChange: setRadiationKvp }),
      slider({ label: 'Tube current', value: radiation.tubeCurrentMa, min: 0.5, max: 10, step: 0.5, suffix: ' mA', onChange: setRadiationTubeCurrentMa }),
      slider({ label: 'Pulse rate', value: radiation.pulseRatePps, min: 1, max: 15, step: 0.5, suffix: ' pps', onChange: setRadiationPulseRatePps }),
      slider({ label: 'Exposure duration', value: radiation.durationS, min: 1, max: 20, step: 1, suffix: ' s', onChange: setRadiationDurationS }),
      slider({ label: 'Field size', value: radiation.fieldSizeCm, min: 8, max: 30, step: 1, suffix: ' cm', onChange: setRadiationFieldSizeCm }),
      h('button', { type: 'button', onClick: toggleScatterHeatmap, style: { ...buttonStyle, width: '100%', marginTop: '6px', background: radiation.heatmapVisible ? '#b45309' : '#334155' } }, radiation.heatmapVisible ? 'SCATTER MAP ON' : 'SHOW SCATTER MAP'),
      radiation.staffScatter.length
        ? h('div', { style: { marginTop: '5px' } }, ...radiation.staffScatter.map(item => stat(`${item.label} scatter`, item.relative_scatter_index.toFixed(3))))
        : null,
      h('div', { style: { marginTop: '5px', fontSize: '7px', color: '#fbbf24', lineHeight: 1.35 } }, 'Dose/scatter values are uncalibrated relative engineering indices. Do not interpret them as mGy, mSv, or clinical dosimetry.'),
    ),

    h('div', { style: { marginTop: '10px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.10)' } },
      h('div', { style: { fontSize: '9px', fontWeight: 900, color: '#86efac' } }, '3 · EVIDENCE / REPRODUCIBILITY'),
      stat('Logged events', String(log.length)),
      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px', marginTop: '6px' } },
        h('button', { type: 'button', onClick: exportResearchLogJson, style: { ...buttonStyle, background: '#166534' } }, 'EXPORT JSON'),
        h('button', { type: 'button', onClick: exportResearchLogCsv, style: { ...buttonStyle, background: '#166534' } }, 'EXPORT CSV'),
      ),
      h('button', { type: 'button', onClick: clearResearchLog, style: { ...buttonStyle, width: '100%', marginTop: '5px', background: '#3f3f46' } }, 'CLEAR RUN LOG'),
      h('div', { style: { marginTop: '6px', color: '#94a3b8', fontSize: '7px', lineHeight: 1.35 } }, 'Use exported runs for repeated-trial analysis: collision rate, replan count, clearance, metal-in-FOV frequency, and relative scatter under controlled scenarios.'),
    ),
  );
}
