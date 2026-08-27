import React, { useEffect, useState } from 'react';
import {
  getOperatingRoomSnapshot,
  subscribeOperatingRoom,
  toggleOperatingRoomEnvironment,
  toggleSafetyBubbles,
} from '../scene/operatingRoomRuntime.js';
import {
  getOperatingRoomInteractionSnapshot,
  resetOperatingRoomLayout,
  subscribeOperatingRoomInteraction,
  toggleOperatingRoomEditMode,
} from '../scene/operatingRoomInteraction.js';
import {
  getCollisionPlannerSnapshot,
  subscribeCollisionPlanner,
} from '../scene/collisionAwarePlanner.js';
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

const btn = {
  border: '1px solid rgba(255,255,255,.18)',
  borderRadius: 8,
  background: '#1e293b',
  color: '#fff',
  padding: '8px 10px',
  fontWeight: 800,
  fontSize: 11,
  cursor: 'pointer',
};

const row = (label, value, color = '#e2e8f0') => (
  <div style={{ display:'flex', justifyContent:'space-between', gap:12, marginTop:5, fontSize:11 }}>
    <span style={{ color:'#94a3b8' }}>{label}</span>
    <strong style={{ color, textAlign:'right' }}>{value}</strong>
  </div>
);

const Slider = ({ label, value, min, max, step, suffix='', onChange }) => (
  <label style={{ display:'block', marginTop:9, color:'#cbd5e1', fontSize:11 }}>
    <div style={{ display:'flex', justifyContent:'space-between' }}><span>{label}</span><strong>{value}{suffix}</strong></div>
    <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(e.target.value)} style={{ width:'100%' }} />
  </label>
);

export default function ResearchControlDock() {
  const [panel, setPanel] = useState(null);
  const [orState, setOrState] = useState(getOperatingRoomSnapshot);
  const [interaction, setInteraction] = useState(getOperatingRoomInteractionSnapshot);
  const [planner, setPlanner] = useState(getCollisionPlannerSnapshot);
  const [motion, setMotion] = useState(getPatientMotionSnapshot);
  const [radiation, setRadiation] = useState(getRadiationSnapshot);
  const [log, setLog] = useState(getResearchLog);

  useEffect(() => subscribeOperatingRoom(setOrState), []);
  useEffect(() => subscribeOperatingRoomInteraction(setInteraction), []);
  useEffect(() => subscribeCollisionPlanner(setPlanner), []);
  useEffect(() => subscribePatientMotion(setMotion), []);
  useEffect(() => subscribeRadiation(setRadiation), []);
  useEffect(() => subscribeResearchLog(setLog), []);

  const liveClearance = Number.isFinite(interaction.liveMinClearanceM)
    ? `${Math.max(0, interaction.liveMinClearanceM * 100).toFixed(1)} cm`
    : '—';

  return (
    <>
      <div style={{ position:'fixed', left:12, bottom:10, zIndex:20000, display:'flex', gap:7, alignItems:'center', pointerEvents:'auto' }}>
        <button onClick={() => setPanel(panel === 'or' ? null : 'or')} style={{ ...btn, background: panel === 'or' ? '#0f766e' : '#0f172a', boxShadow:'0 5px 18px rgba(0,0,0,.35)' }}>🛡 OR SAFETY</button>
        <button onClick={() => setPanel(panel === 'research' ? null : 'research')} style={{ ...btn, background: panel === 'research' ? '#4338ca' : '#0f172a', boxShadow:'0 5px 18px rgba(0,0,0,.35)' }}>📊 RESEARCH LAB</button>
        <span style={{ padding:'6px 8px', borderRadius:7, background:'#052e16', border:'1px solid #22c55e', color:'#86efac', fontSize:10, fontWeight:900 }}>V3 ACTIVE</span>
      </div>

      {panel === 'or' && (
        <div style={{ position:'fixed', left:12, bottom:58, width:300, maxHeight:'72vh', overflowY:'auto', zIndex:19999, padding:12, boxSizing:'border-box', borderRadius:12, border:'1px solid rgba(45,212,191,.45)', background:'rgba(15,23,42,.97)', color:'#fff', boxShadow:'0 12px 40px rgba(0,0,0,.45)', backdropFilter:'blur(10px)', pointerEvents:'auto' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}><strong>OR SAFETY + LAYOUT</strong><button onClick={() => setPanel(null)} style={{ ...btn, padding:'3px 8px' }}>×</button></div>
          {row('Environment', orState.ready ? 'ATTACHED' : 'WAITING', orState.ready ? '#4ade80' : '#fbbf24')}
          {row('Live status', interaction.liveCollisionStatus || orState.collisionStatus || 'LOCATING')}
          {row('Live clearance', liveClearance)}
          {row('Path status', planner.status || 'IDLE')}
          {row('Checked waypoints', planner.checkedWaypoints ?? 0)}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:7, marginTop:12 }}>
            <button onClick={toggleOperatingRoomEnvironment} style={{ ...btn, background: orState.environmentVisible ? '#0f766e' : '#334155' }}>{orState.environmentVisible ? 'OR ON' : 'OR OFF'}</button>
            <button onClick={toggleSafetyBubbles} style={{ ...btn, background: orState.bubblesVisible ? '#6d28d9' : '#334155' }}>{orState.bubblesVisible ? 'BUBBLES ON' : 'BUBBLES'}</button>
            <button onClick={toggleOperatingRoomEditMode} style={{ ...btn, background: interaction.editMode ? '#d97706' : '#334155' }}>{interaction.editMode ? 'EDITING' : 'EDIT OR'}</button>
            <button onClick={resetOperatingRoomLayout} style={btn}>RESET LAYOUT</button>
          </div>
          {interaction.layoutDirty && <div style={{ marginTop:10, padding:8, borderRadius:7, background:'rgba(245,158,11,.15)', color:'#fde68a', fontSize:10, fontWeight:800 }}>LAYOUT CHANGED · PREVIEW PATH AGAIN BEFORE MOVE C-ARM</div>}
          <div style={{ marginTop:9, color:'#94a3b8', fontSize:10, lineHeight:1.4 }}>Move OR equipment in Edit mode, then rerun PREVIEW PATH. Bubbles show the collision envelopes used by the research planner.</div>
        </div>
      )}

      {panel === 'research' && (
        <div style={{ position:'fixed', left:12, bottom:58, width:330, maxHeight:'76vh', overflowY:'auto', zIndex:19999, padding:12, boxSizing:'border-box', borderRadius:12, border:'1px solid rgba(129,140,248,.5)', background:'rgba(15,23,42,.97)', color:'#fff', boxShadow:'0 12px 40px rgba(0,0,0,.45)', backdropFilter:'blur(10px)', pointerEvents:'auto' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}><div><strong>RESEARCH LAB</strong><div style={{ color:'#94a3b8', fontSize:10 }}>Adaptive digital twin · evidence capture</div></div><button onClick={() => setPanel(null)} style={{ ...btn, padding:'3px 8px' }}>×</button></div>

          <div style={{ marginTop:11, paddingTop:9, borderTop:'1px solid rgba(255,255,255,.1)' }}><strong style={{ color:'#7dd3fc', fontSize:11 }}>DYNAMIC PATIENT + REPLANNING</strong>
            {row('Displacement', `${(motion.displacementM * 1000).toFixed(1)} mm`)}
            {row('Adaptive status', motion.adaptiveStatus)}
            {row('Live replans', String(motion.replanCount))}
            <Slider label="Chest rise" value={(motion.amplitudeM * 1000).toFixed(0)} min={0} max={25} step={1} suffix=" mm" onChange={setPatientMotionAmplitudeMm} />
            <Slider label="Ventilation" value={motion.breathsPerMinute} min={6} max={24} step={1} suffix=" bpm" onChange={setPatientBreathingRate} />
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:7, marginTop:8 }}>
              <button onClick={togglePatientMotion} style={{ ...btn, background: motion.enabled ? '#0369a1' : '#334155' }}>{motion.enabled ? 'BREATHING ON' : 'START BREATHING'}</button>
              <button onClick={togglePatientMotionEnvelope} style={{ ...btn, background: motion.envelopeVisible ? '#0e7490' : '#334155' }}>{motion.envelopeVisible ? 'ENVELOPE ON' : 'SHOW ENVELOPE'}</button>
              <button onClick={startAdaptiveMove} disabled={!motion.enabled || !motion.hasPlan} style={{ ...btn, background:'#1d4ed8', opacity: motion.enabled && motion.hasPlan ? 1 : .45 }}>ADAPTIVE MOVE</button>
              <button onClick={stopAdaptiveMove} style={{ ...btn, background:'#7f1d1d' }}>STOP MOVE</button>
            </div>
            <button onClick={runRespiratoryRobustnessSweep} disabled={!motion.hasPlan} style={{ ...btn, width:'100%', marginTop:7, background:'#4c1d95', opacity:motion.hasPlan ? 1 : .45 }}>RUN 24-PHASE ROBUSTNESS SWEEP</button>
            {motion.robustnessResult && !motion.robustnessResult.error && <div style={{ marginTop:7 }}>{row('Safe phases', `${motion.robustnessResult.safe_trials}/${motion.robustnessResult.trials}`)}{row('Safe rate', `${(motion.robustnessResult.safe_rate * 100).toFixed(1)}%`)}{row('Worst clearance', motion.robustnessResult.worst_clearance_m == null ? '—' : `${(motion.robustnessResult.worst_clearance_m * 100).toFixed(1)} cm`)}</div>}
          </div>

          <div style={{ marginTop:12, paddingTop:9, borderTop:'1px solid rgba(255,255,255,.1)' }}><strong style={{ color:'#fda4af', fontSize:11 }}>METAL + RADIATION INTELLIGENCE</strong>
            {row('Metal in beam', radiation.metalInFov ? (radiation.metalObjects.join(', ') || 'YES') : 'CLEAR', radiation.metalInFov ? '#f87171' : '#4ade80')}
            {row('Artifact severity', `${(radiation.artifactSeverity * 100).toFixed(0)}%`)}
            {row('Output index', radiation.outputIndex == null ? '—' : radiation.outputIndex.toFixed(3))}
            {row('KAP proxy', radiation.kapIndex == null ? '—' : radiation.kapIndex.toFixed(2))}
            <Slider label="kVp" value={radiation.kvp} min={50} max={120} step={1} suffix=" kVp" onChange={setRadiationKvp} />
            <Slider label="Tube current" value={radiation.tubeCurrentMa} min={0.5} max={10} step={0.5} suffix=" mA" onChange={setRadiationTubeCurrentMa} />
            <Slider label="Pulse rate" value={radiation.pulseRatePps} min={1} max={15} step={0.5} suffix=" pps" onChange={setRadiationPulseRatePps} />
            <Slider label="Duration" value={radiation.durationS} min={1} max={20} step={1} suffix=" s" onChange={setRadiationDurationS} />
            <Slider label="Field size" value={radiation.fieldSizeCm} min={8} max={30} step={1} suffix=" cm" onChange={setRadiationFieldSizeCm} />
            <button onClick={toggleScatterHeatmap} style={{ ...btn, width:'100%', marginTop:7, background:radiation.heatmapVisible ? '#b45309' : '#334155' }}>{radiation.heatmapVisible ? 'SCATTER MAP ON' : 'SHOW SCATTER MAP'}</button>
            <div style={{ marginTop:7, color:'#fbbf24', fontSize:9, lineHeight:1.35 }}>Radiation values are uncalibrated engineering proxies, not mGy or mSv.</div>
          </div>

          <div style={{ marginTop:12, paddingTop:9, borderTop:'1px solid rgba(255,255,255,.1)' }}><strong style={{ color:'#86efac', fontSize:11 }}>EVIDENCE</strong>{row('Logged events', String(log.length))}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:7, marginTop:7 }}><button onClick={exportResearchLogJson} style={{ ...btn, background:'#166534' }}>EXPORT JSON</button><button onClick={exportResearchLogCsv} style={{ ...btn, background:'#166534' }}>EXPORT CSV</button></div>
            <button onClick={clearResearchLog} style={{ ...btn, width:'100%', marginTop:7 }}>CLEAR RUN LOG</button>
          </div>
        </div>
      )}
    </>
  );
}
