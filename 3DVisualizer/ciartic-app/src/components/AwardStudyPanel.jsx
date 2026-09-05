import React, { useEffect, useMemo, useState } from 'react';
import {
  captureAwardStudyTrial,
  clearAwardStudyTrials,
  exportAwardStudyCsv,
  exportAwardStudyJson,
  exportAwardStudyMarkdown,
  getAwardStudySnapshot,
  subscribeAwardStudy,
} from '../scene/awardStudyProtocol.js';
import {
  applyAwardScenarioPreset,
  getAwardScenarioSnapshot,
  subscribeAwardScenario,
} from '../scene/awardScenarioPresets.js';

const button = {
  border: '1px solid rgba(255,255,255,.16)',
  borderRadius: 8,
  background: '#0f172a',
  color: '#fff',
  padding: '8px 10px',
  fontSize: 10,
  fontWeight: 850,
  cursor: 'pointer',
};

const Stat = ({ label, value, color = '#e2e8f0' }) => (
  <div style={{ display:'flex', justifyContent:'space-between', gap:12, marginTop:5, fontSize:10 }}>
    <span style={{ color:'#94a3b8' }}>{label}</span>
    <strong style={{ color, textAlign:'right' }}>{value}</strong>
  </div>
);

const pct = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
const mm = value => Number.isFinite(value) ? `${value.toFixed(1)} mm` : '—';
const num = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : '—';

export default function AwardStudyPanel({ simulatorContext = {} }) {
  const [open, setOpen] = useState(false);
  const [study, setStudy] = useState(getAwardStudySnapshot);
  const [scenarioState, setScenarioState] = useState(getAwardScenarioSnapshot);
  const [scenarioKey, setScenarioKey] = useState('nominal');
  const [notes, setNotes] = useState('');
  const [lastCapturedId, setLastCapturedId] = useState(null);

  useEffect(() => subscribeAwardStudy(setStudy), []);
  useEffect(() => subscribeAwardScenario(setScenarioState), []);

  const summary = study.summary || {};
  const recent = useMemo(() => (study.trials || []).slice(-5).reverse(), [study.trials]);
  const geometryReady = simulatorContext?.planner?.geometryVerification?.verified === true;
  const plannerStatus = simulatorContext?.planner?.status || '—';
  const scenarioMeta = scenarioState.presets?.[scenarioKey] || { label: scenarioKey, description: '' };

  const applyScenario = () => {
    applyAwardScenarioPreset(scenarioKey);
  };

  const capture = () => {
    const trial = captureAwardStudyTrial({
      simulatorContext,
      scenario: scenarioMeta.label || scenarioKey,
      notes: [
        `preset=${scenarioState.preset}; preset_revision=${scenarioState.revision}`,
        notes,
      ].filter(Boolean).join(' | '),
    });
    setLastCapturedId(trial?.trial_id || null);
    setNotes('');
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Open reproducible study capture"
        style={{
          ...button,
          position:'fixed',
          left:242,
          bottom:10,
          zIndex:20001,
          background:'linear-gradient(135deg,#312e81,#7c3aed)',
          boxShadow:'0 8px 26px rgba(0,0,0,.42)',
        }}
      >
        🧪 AWARD STUDY
      </button>
    );
  }

  return (
    <div style={{
      position:'fixed', left:12, bottom:58, width:382, maxWidth:'calc(100vw - 24px)', maxHeight:'80vh',
      overflowY:'auto', zIndex:20002, padding:13, boxSizing:'border-box', borderRadius:13,
      border:'1px solid rgba(167,139,250,.55)', background:'rgba(10,15,30,.985)', color:'#fff',
      boxShadow:'0 18px 55px rgba(0,0,0,.52)', backdropFilter:'blur(14px)', fontFamily:'Inter,system-ui,sans-serif',
    }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10 }}>
        <div>
          <div style={{ fontWeight:950, fontSize:12, letterSpacing:.3 }}>AWARD STUDY MODE</div>
          <div style={{ color:'#a5b4fc', fontSize:9, marginTop:2 }}>Reproducible paired collision + geometry evidence</div>
        </div>
        <button onClick={() => setOpen(false)} style={{ ...button, padding:'4px 8px' }}>×</button>
      </div>

      <div style={{ marginTop:10, padding:9, borderRadius:9, background:'rgba(30,41,59,.75)', border:'1px solid rgba(255,255,255,.08)' }}>
        <Stat label="Current planner" value={plannerStatus} color={String(plannerStatus).includes('BLOCK') ? '#f87171' : '#93c5fd'} />
        <Stat label="Geometry verification" value={geometryReady ? 'VERIFIED' : 'NOT VERIFIED'} color={geometryReady ? '#4ade80' : '#fbbf24'} />
        <Stat label="Scenario system" value={scenarioState.ready ? 'READY' : 'WAITING'} color={scenarioState.ready ? '#4ade80' : '#fbbf24'} />
        <Stat label="Trials captured" value={String(summary.trials || 0)} />
      </div>

      <div style={{ marginTop:11, padding:9, borderRadius:9, border:'1px solid rgba(96,165,250,.28)', background:'rgba(30,58,138,.12)' }}>
        <div style={{ fontSize:10, fontWeight:900, color:'#93c5fd' }}>CONTROLLED OR SCENARIO</div>
        <select value={scenarioKey} onChange={e => setScenarioKey(e.target.value)} style={{ width:'100%', marginTop:7, padding:'8px 9px', borderRadius:8, border:'1px solid #475569', background:'#111827', color:'#fff', fontSize:10 }}>
          {Object.entries(scenarioState.presets || {}).map(([key, value]) => (
            <option key={key} value={key}>{value.label}</option>
          ))}
        </select>
        <div style={{ marginTop:5, color:'#94a3b8', fontSize:8.5, lineHeight:1.4 }}>{scenarioMeta.description}</div>
        <button disabled={!scenarioState.ready} onClick={applyScenario} style={{ ...button, width:'100%', marginTop:7, background:'#1d4ed8', opacity:scenarioState.ready ? 1 : .45 }}>
          APPLY REPRODUCIBLE PRESET
        </button>
        <div style={{ marginTop:5, color:'#fbbf24', fontSize:8.2, lineHeight:1.35 }}>{scenarioState.message}</div>
      </div>

      <label style={{ display:'block', marginTop:9, fontSize:9, color:'#cbd5e1' }}>
        Trial note (optional)
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. repeat 3, neck AP, same starting pose" style={{ width:'100%', boxSizing:'border-box', marginTop:5, padding:'8px 9px', borderRadius:8, border:'1px solid #475569', background:'#111827', color:'#fff', fontSize:10 }} />
      </label>

      <button onClick={capture} style={{ ...button, width:'100%', marginTop:10, background:'linear-gradient(135deg,#166534,#15803d)', borderColor:'#4ade80' }}>
        CAPTURE PAIRED TRIAL
      </button>
      <div style={{ marginTop:5, color:'#94a3b8', fontSize:8.5, lineHeight:1.4 }}>
        Apply a preset, run PREVIEW PATH, then capture. Each trial records direct-route conflict, collision-aware outcome, sampled clearance, geometry verification, motion state, and research-only radiation proxies.
      </div>
      {lastCapturedId && <div style={{ marginTop:6, color:'#86efac', fontSize:8 }}>Saved: {lastCapturedId}</div>}

      <div style={{ marginTop:12, paddingTop:10, borderTop:'1px solid rgba(255,255,255,.1)' }}>
        <div style={{ fontSize:10, fontWeight:900, color:'#c4b5fd' }}>LIVE STUDY SUMMARY</div>
        <Stat label="Direct-route conflict rate" value={pct(summary.direct_route_conflict_rate)} />
        <Stat label="Collision-aware accepted" value={pct(summary.collision_aware_accept_rate)} color="#4ade80" />
        <Stat label="Reroute rate" value={pct(summary.reroute_rate)} />
        <Stat label="Blocked rate" value={pct(summary.blocked_rate)} color={(summary.blocked_rate || 0) > 0 ? '#fca5a5' : '#e2e8f0'} />
        <Stat label="Geometry verified" value={pct(summary.geometry_verified_rate)} />
        <Stat label="Median clearance" value={mm(summary.median_clearance_mm)} />
        <Stat label="5th percentile clearance" value={mm(summary.p05_clearance_mm)} />
        <Stat label="Minimum clearance" value={mm(summary.minimum_clearance_mm)} />
        <Stat label="Mean planner confidence" value={Number.isFinite(summary.mean_planner_confidence_pct) ? `${summary.mean_planner_confidence_pct.toFixed(1)}%` : '—'} />
        <Stat label="Mean isocenter error" value={Number.isFinite(summary.mean_isocenter_error_mm) ? `${num(summary.mean_isocenter_error_mm,3)} mm` : '—'} />
        <Stat label="Mean central-ray error" value={Number.isFinite(summary.mean_central_ray_error_mm) ? `${num(summary.mean_central_ray_error_mm,3)} mm` : '—'} />
      </div>

      <div style={{ marginTop:12, paddingTop:10, borderTop:'1px solid rgba(255,255,255,.1)' }}>
        <div style={{ fontSize:10, fontWeight:900, color:'#86efac' }}>EXPORT EVIDENCE</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:7, marginTop:7 }}>
          <button onClick={exportAwardStudyJson} style={{ ...button, background:'#14532d' }}>FULL JSON</button>
          <button onClick={exportAwardStudyCsv} style={{ ...button, background:'#14532d' }}>TRIAL CSV</button>
          <button onClick={exportAwardStudyMarkdown} style={{ ...button, background:'#1e3a8a' }}>RESULTS .MD</button>
          <button onClick={() => { if (window.confirm('Clear all award-study trials stored in this browser?')) clearAwardStudyTrials(); }} style={{ ...button, background:'#4c0519' }}>CLEAR STUDY</button>
        </div>
      </div>

      {!!recent.length && (
        <div style={{ marginTop:12, paddingTop:10, borderTop:'1px solid rgba(255,255,255,.1)' }}>
          <div style={{ fontSize:10, fontWeight:900, color:'#7dd3fc' }}>RECENT TRIALS</div>
          {recent.map(trial => (
            <div key={trial.trial_id} style={{ marginTop:7, padding:8, borderRadius:8, background:'rgba(30,41,59,.62)', fontSize:8.5 }}>
              <div style={{ display:'flex', justifyContent:'space-between', gap:8 }}><strong>{trial.scenario}</strong><span style={{ color:'#94a3b8' }}>{trial.integrity_hash_fnv1a32}</span></div>
              <div style={{ marginTop:3, color:'#cbd5e1' }}>{trial.simulator?.anatomy || '—'} · {trial.simulator?.projection || '—'} · {trial.collision?.planner_status || '—'}</div>
              <div style={{ marginTop:2, color:trial.collision?.collision_aware_accepted ? '#86efac' : '#fca5a5' }}>
                {trial.collision?.rerouted ? 'REROUTED' : trial.collision?.blocked ? 'BLOCKED' : 'DIRECT'} · clearance {mm(trial.collision?.minimum_clearance_mm)}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop:11, padding:8, borderRadius:8, border:'1px solid rgba(245,158,11,.35)', background:'rgba(120,53,15,.16)', color:'#fde68a', fontSize:8.5, lineHeight:1.4 }}>
        Software-only research evidence. The 1 mm geometry criterion and collision-clearance thresholds are simulator engineering criteria, not demonstrated physical or clinical accuracy or safety.
      </div>
    </div>
  );
}
