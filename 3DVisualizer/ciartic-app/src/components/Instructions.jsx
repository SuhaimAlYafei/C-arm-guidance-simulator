import React, { useState } from 'react';

const pages = [
  {
    code: '00',
    title: 'C-Arm Guidance Simulator V3',
    body: <>
      <p>This simulator combines anatomical target selection, verified simulator geometry, collision-aware operating-room routing, reference X-ray display, and AI-assisted simulator guidance.</p>
      <Note title="Core workflow">Select target / configure OR / Preview Path / review route / Move C-Arm / verify geometry / Expose X-Ray.</Note>
      <Warning>Research and educational simulation only. No physical or clinical safety, accuracy, dose, or diagnostic claim is established.</Warning>
    </>,
  },
  {
    code: '01',
    title: 'Select the imaging target',
    body: <>
      <p>Use the Automatic Path Planner to choose a procedure, body region, anatomical landmark, and projection.</p>
      <Note title="Typed request">Enter a short request such as <b>neck AP</b> or <b>left knee lateral</b>, then press <b>INTERPRET</b>.</Note>
      <Note title="Voice request">Press <b>VOICE</b>, speak the request, review the transcript, then say or press <b>ENTER</b>.</Note>
      <p>Paired anatomy should include a side when required, for example <b>left shoulder AP</b>.</p>
    </>,
  },
  {
    code: '02',
    title: 'Configure the operating room',
    body: <>
      <p>Open <b>OPERATING ROOM</b> to inspect the current collision state and reposition supported objects.</p>
      <Note title="Object controls">Select an object, then use X, Y, Z, and rotation controls. Camera movement remains independent.</Note>
      <Note title="Collision boxes">Use SHOW COLLISION BOXES when you need to inspect the software collision geometry.</Note>
      <p>After any scene change, run <b>PREVIEW PATH</b> again. The old route is no longer valid for the changed layout.</p>
    </>,
  },
  {
    code: '03',
    title: 'Preview the path',
    body: <>
      <p>Press <b>PREVIEW PATH</b>. The planner solves the target pose and the V3 scene checker evaluates the returned route against configured simulator limits and collision geometry.</p>
      <Definition term="DIRECT_CLEAR">The sampled direct route is accepted by the current simulator criteria.</Definition>
      <Definition term="DIRECT_NEAR">The direct route is accepted but approaches a configured collision threshold.</Definition>
      <Definition term="REROUTED">A direct-route conflict was detected and an alternate route was accepted.</Definition>
      <Definition term="BLOCKED">No accepted simulated route was found for the current scene and target.</Definition>
      <Warning>Minimum clearance is a software geometry metric. It is not a demonstrated physical safety distance.</Warning>
    </>,
  },
  {
    code: '04',
    title: 'Move and verify',
    body: <>
      <p>After reviewing an accepted preview, press <b>MOVE C-ARM</b>. At arrival, use the verification values rather than visual appearance alone.</p>
      <Definition term="Position residual">Difference between planned and final simulated position.</Definition>
      <Definition term="Angular residual">Difference between planned and final simulated orientation.</Definition>
      <Definition term="Geometry verification">Checks isocenter and central-ray geometry against the configured simulator criterion.</Definition>
      <Warning>The 1 mm criterion is an internal simulator engineering threshold. It is not physical or clinical positioning accuracy.</Warning>
    </>,
  },
  {
    code: '05',
    title: 'Reference X-ray',
    body: <>
      <p>After accepted arrival, <b>EXPOSE X-RAY</b> displays a matching reference image when the selected anatomy and projection are supported.</p>
      <p>If no matching reference exists, the simulator reports that instead of fabricating an image.</p>
      <Warning>Reference images are not generated from the exact current simulated pose and are not patient-specific diagnostic images.</Warning>
    </>,
  },
  {
    code: '06',
    title: 'Gemini Guidance',
    body: <>
      <p>Gemini Guidance can explain the current simulator state, planned path, selected anatomy, planner confidence, and geometry-verification output.</p>
      <p>Use it to understand the simulation. Do not treat it as clinical decision support.</p>
      <Warning>Planner confidence is not accuracy. Do not report software-only outputs as clinical validation.</Warning>
    </>,
  },
  {
    code: '07',
    title: 'Controls and project information',
    body: <>
      <Definition term="I">Open or close these instructions.</Definition>
      <Definition term="P">Toggle patient visibility.</Definition>
      <Definition term="L">Toggle landmarks.</Definition>
      <Definition term="D">Toggle debug visualization.</Definition>
      <Definition term="C">Use the supported external-hardware connection flow.</Definition>
      <p style={{marginTop:18}}>Project policies: <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy</a> / <a href="/terms.html" target="_blank" rel="noreferrer">Terms</a></p>
    </>,
  },
];

function Definition({ term, children }) {
  return <div style={definition}><div style={termStyle}>{term}</div><div>{children}</div></div>;
}

function Note({ title, children }) {
  return <div style={note}><div style={termStyle}>{title}</div><div>{children}</div></div>;
}

function Warning({ children }) {
  return <div style={warning}>{children}</div>;
}

export default function Instructions({ onClose }) {
  const [page, setPage] = useState(0);
  const current = pages[page];

  return <div style={overlay}>
    <div style={modal}>
      <header style={header}>
        <div style={{display:'flex',alignItems:'baseline',gap:14}}>
          <div style={pageCode}>{current.code}</div>
          <h2 style={title}>{current.title}</h2>
        </div>
        <button onClick={onClose} style={close} aria-label="Close instructions">X</button>
      </header>

      <main style={main}>{current.body}</main>

      <footer style={footer}>
        <div style={progress}>{page + 1} / {pages.length}</div>
        <div style={{display:'flex',gap:8}}>
          <button disabled={!page} onClick={() => setPage(p => p - 1)} style={{...button,opacity:page?1:.4}}>BACK</button>
          {page < pages.length - 1
            ? <button onClick={() => setPage(p => p + 1)} style={primaryButton}>NEXT</button>
            : <button onClick={onClose} style={primaryButton}>CLOSE MANUAL</button>}
        </div>
      </footer>
    </div>
  </div>;
}

const font = 'Arial, Helvetica, sans-serif';
const overlay = {
  position:'absolute', inset:0, zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center',
  background:'#555b5d', padding:20,
};
const modal = {
  width:860, maxWidth:'96vw', height:610, maxHeight:'92vh', display:'flex', flexDirection:'column', overflow:'hidden',
  borderRadius:2, border:'1px solid #596165', background:'#d7dad8', color:'#1d2427', boxShadow:'none', fontFamily:font,
};
const header = {
  padding:'18px 22px', display:'flex', justifyContent:'space-between', alignItems:'center',
  borderBottom:'2px solid #1d2427', background:'#c5c9c7',
};
const pageCode = {fontSize:11,fontWeight:800,letterSpacing:'.14em',color:'#566166'};
const title = {margin:0,fontSize:22,fontWeight:800,letterSpacing:'-.01em',color:'#171d20'};
const close = {
  width:34,height:34,borderRadius:2,border:'1px solid #697277',background:'#b8bfbc',color:'#1c2326',
  fontSize:13,fontWeight:800,cursor:'pointer',fontFamily:font,
};
const main = {flex:1,overflowY:'auto',padding:'24px 28px',fontSize:14,lineHeight:1.6,color:'#273034'};
const footer = {
  padding:'14px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',
  borderTop:'1px solid #7f888c',background:'#c8ccca',
};
const progress = {fontSize:11,fontWeight:700,letterSpacing:'.08em',color:'#4d585d'};
const button = {
  minWidth:88,padding:'9px 13px',borderRadius:2,border:'1px solid #6e777b',background:'#bbc1be',
  color:'#1c2326',fontWeight:800,cursor:'pointer',fontFamily:font,boxShadow:'none',transition:'none',
};
const primaryButton = {...button,background:'#29383f',borderColor:'#29383f',color:'#e6ebe9'};
const definition = {
  display:'grid',gridTemplateColumns:'150px 1fr',gap:18,padding:'10px 0',borderBottom:'1px solid #9ba2a5',
};
const note = {
  margin:'14px 0',padding:'10px 12px',border:'1px solid #7d868a',background:'#c9cdca',
};
const warning = {
  margin:'16px 0',padding:'10px 12px',border:'1px solid #765c2f',background:'#c2b591',color:'#2e281c',fontWeight:700,
};
const termStyle = {fontWeight:800,color:'#1d292e'};
