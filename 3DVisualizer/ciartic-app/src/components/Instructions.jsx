import React, { useState } from 'react';

const pages = [
  {
    badge: 'WELCOME', title: 'C-Arm Guidance Simulator V3',
    body: <><p>V3 combines anatomical target planning, verified simulated geometry, collision-aware OR routing, reference X-ray display, and research evidence tools.</p><Callout><b>Core workflow:</b> Select target → Preview Path → review collision result → Move C-Arm → verify geometry → Expose X-Ray.</Callout><Warn>Research and educational simulation only. No physical or clinical safety, accuracy, dose, or diagnostic claim is established.</Warn></>,
  },
  {
    badge: 'TARGET', title: '1. Select the Imaging Target',
    body: <><p>Choose procedure, anatomical landmark and projection in the AI Path Planner. The selected landmark defines the requested simulated imaging target.</p><Card title="Projection">Choose AP, lateral, oblique, cranial/caudal, or another available simulator projection. Projection labels do not by themselves prove correct geometry.</Card></>,
  },
  {
    badge: 'OR SAFETY', title: '2. Configure the Simulated OR',
    body: <><p>Open <b>OR SAFETY</b> to inspect and reposition simulated obstacles such as the IV pole, Mayo stand, trolley, staff and equipment.</p><Card title="Object transforms">Select an object and use X/Y/Z and rotation controls. The camera remains free while equipment is repositioned.</Card><Card title="Randomize OR">RANDOMIZE OR creates a seeded simulator layout. REPEAT SEED reproduces the last randomized layout.</Card><p>After changing the OR layout, run <b>PREVIEW PATH</b> again. A previous route is no longer evidence for the changed scene.</p></>,
  },
  {
    badge: 'COLLISION', title: '3. Preview the Collision-Aware Path',
    body: <><p>Press <b>PREVIEW PATH</b>. The normal planner first generates the requested trajectory; the V3 scene checker samples the simulated C-arm against explicit safety envelopes.</p><Card title="DIRECT_CLEAR / DIRECT_NEAR">The sampled direct route was accepted by the current simulator collision criteria.</Card><Card title="REROUTED">A direct-route conflict was detected and a staged alternative route was found.</Card><Card title="BLOCKED">No accepted simulated route was found for the current scene/target combination.</Card><Warn>Minimum clearance is a software geometry metric from the digital twin, not a demonstrated physical safety distance.</Warn></>,
  },
  {
    badge: 'MOVE', title: '4. Move and Verify Geometry',
    body: <><p>After reviewing an accepted preview, press <b>MOVE C-ARM</b>. At arrival, use the Arrival Verification card rather than visual appearance alone.</p><Card title="Geometry verification">Pose residual, isocenter error and central-ray error are evaluated against the configured internal simulator criterion.</Card><Warn>The 1 mm criterion is an internal simulator engineering acceptance threshold, not physical or clinical accuracy.</Warn></>,
  },
  {
    badge: 'X-RAY', title: '5. Reference X-Ray',
    body: <><p>After an accepted arrival, <b>EXPOSE X-RAY</b> displays a matching reference image when that anatomy/projection is supported.</p><p>If no matching reference exists, the simulator reports that instead of inventing an image.</p><Warn>Reference images are not generated from the current simulated patient pose and are not patient-specific diagnostic images.</Warn></>,
  },
  {
    badge: 'MOTION', title: '6. Respiratory Motion Research',
    body: <><p>Open <b>RESEARCH LAB</b> for the respiratory-motion experiment. START BREATHING drives a periodic <b>thoracic safety-envelope displacement</b> using the selected amplitude and cycle rate.</p><Card title="Important interpretation">This is a parameterized moving collision envelope for robustness experiments. It is not a validated biomechanical or physiological breathing model and does not deform anatomy as a clinical respiratory model would.</Card><Card title="Adaptive Move">With breathing enabled and a preview available, ADAPTIVE MOVE re-checks upcoming waypoints and searches a simulated reroute when the moving envelope invalidates the remaining route.</Card><Card title="24-phase sweep">Evaluates the captured route at 24 deterministic respiratory phases and reports software-only safe-phase rate and sampled clearance.</Card></>,
  },
  {
    badge: 'RESEARCH', title: '7. Research Lab Metrics',
    body: <><p>Research Lab exposes motion, collision, metal-in-field and radiation-related <b>proxy</b> variables for controlled simulator experiments.</p><Card title="Radiation intelligence">Output, KAP and staff-scatter values are research indices/proxies unless separately calibrated. Do not report them as measured dose.</Card><Card title="Evidence log">JSON/CSV exports preserve simulator events and parameters for reproducibility.</Card></>,
  },
  {
    badge: 'STUDY', title: '8. Award Study Mode',
    body: <><p>Use <b>AWARD STUDY</b> for structured trial capture. Apply a controlled scenario, run PREVIEW PATH, then capture the trial.</p><Card title="Paired comparison">The study records whether the direct trajectory conflicted with the simulated scene and whether collision-aware routing was accepted, rerouted, or blocked.</Card><Card title="Captured evidence">Trials can include sampled minimum clearance, checked waypoints, geometry verification, planner confidence, motion state, and research-only radiation proxies.</Card><p>Export JSON for full provenance, CSV for analysis, and Markdown for a readable snapshot. The FNV-1a marker detects accidental record changes; it is not cryptographic proof or tamper-proof authentication.</p></>,
  },
  {
    badge: 'METHOD', title: '9. How to Run a Defensible Trial',
    body: <><Card title="A">Apply a named reproducible OR scenario or record the randomization seed.</Card><Card title="B">Select the same anatomy/projection and establish the required starting condition.</Card><Card title="C">Run PREVIEW PATH and record direct conflict, reroute/block status, clearance and waypoints.</Card><Card title="D">If geometry-at-arrival is part of the experiment, complete the move and capture verification separately.</Card><Card title="E">Repeat across predefined scenarios/seeds. Do not delete inconvenient failures.</Card></>,
  },
  {
    badge: 'CONTROLS', title: '10. Navigation & Shortcuts',
    body: <><Card title="Camera">Left drag rotates, right drag pans, scroll zooms. OR object transform controls do not lock the camera.</Card><Card title="Keyboard">I: instructions · P: patient visibility · L: landmarks · D: debug visualization · C: supported external-hardware connection.</Card><p>Manual C-arm controls are useful for exploration/debugging; use the planner workflow for controlled planner experiments.</p></>,
  },
  {
    badge: 'START', title: 'Ready',
    body: <><p>For normal use: <b>Target → OR layout → Preview → collision review → Move → geometry verification → reference exposure.</b></p><p>For research: <b>freeze the protocol first</b>, use reproducible scenarios/seeds, export raw trials, and report simulator-only limitations with the results.</p><Warn>Do not call planner confidence “accuracy.” Do not describe software-only collision or geometry results as clinical validation.</Warn></>,
  },
];

function Card({ title, children }) { return <div style={card}><b>{title}</b><br />{children}</div>; }
function Callout({ children }) { return <div style={callout}>{children}</div>; }
function Warn({ children }) { return <div style={warn}>{children}</div>; }

export default function Instructions({ onClose }) {
  const [page, setPage] = useState(0);
  const current = pages[page];
  return <div style={overlay}>
    <div style={modal}>
      <header style={header}>
        <div><div style={badge}>{current.badge}</div><h2 style={{margin:0}}>{current.title}</h2></div>
        <button onClick={onClose} style={close}>×</button>
      </header>
      <main style={main}>{current.body}</main>
      <footer style={footer}>
        <div style={{display:'flex',gap:5}}>{pages.map((_,i)=><span key={i} style={{width:i===page?22:6,height:6,borderRadius:6,background:i===page?'#60a5fa':'#334155'}} />)}</div>
        <div style={{display:'flex',alignItems:'center',gap:10}}><span style={{color:'#94a3b8',fontSize:12}}>{page+1} / {pages.length}</span><button disabled={!page} onClick={()=>setPage(p=>p-1)} style={{...button,opacity:page?1:.35}}>Back</button>{page<pages.length-1?<button onClick={()=>setPage(p=>p+1)} style={{...button,background:'#2563eb'}}>Next →</button>:<button onClick={onClose} style={{...button,background:'#166534'}}>Start Simulator</button>}</div>
      </footer>
    </div>
  </div>;
}

const overlay={position:'absolute',inset:0,zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(2,6,23,.84)',backdropFilter:'blur(10px)',padding:20};
const modal={width:900,maxWidth:'96vw',height:650,maxHeight:'92vh',display:'flex',flexDirection:'column',overflow:'hidden',borderRadius:20,border:'1px solid rgba(148,163,184,.2)',background:'#111827',color:'#e5e7eb',boxShadow:'0 30px 80px rgba(0,0,0,.55)',fontFamily:'Inter,system-ui,sans-serif'};
const header={padding:'22px 28px',display:'flex',justifyContent:'space-between',alignItems:'center',borderBottom:'1px solid rgba(148,163,184,.18)',background:'#0f172a'};
const badge={color:'#60a5fa',fontSize:11,letterSpacing:2,fontWeight:900,marginBottom:7};
const close={width:38,height:38,borderRadius:10,border:'1px solid rgba(148,163,184,.25)',background:'#172033',color:'#94a3b8',fontSize:20,cursor:'pointer'};
const main={flex:1,overflowY:'auto',padding:'28px 34px',fontSize:15,lineHeight:1.65};
const footer={padding:'16px 28px',display:'flex',alignItems:'center',justifyContent:'space-between',borderTop:'1px solid rgba(148,163,184,.18)',background:'#0f172a'};
const button={padding:'9px 16px',borderRadius:9,border:'1px solid rgba(148,163,184,.25)',background:'#1e293b',color:'#f1f5f9',fontWeight:800,cursor:'pointer'};
const card={background:'#172033',border:'1px solid rgba(148,163,184,.15)',borderRadius:10,padding:'13px 15px',margin:'11px 0'};
const callout={background:'rgba(37,99,235,.12)',border:'1px solid rgba(96,165,250,.35)',borderRadius:10,padding:'14px 16px',margin:'15px 0',color:'#dbeafe'};
const warn={background:'rgba(245,158,11,.08)',border:'1px solid rgba(245,158,11,.3)',color:'#fcd34d',borderRadius:10,padding:'13px 15px',margin:'14px 0'};
