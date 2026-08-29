import React, { useState } from 'react';

const pages = [
  {
    badge: 'WELCOME',
    title: 'C-Arm Guidance Simulator V3',
    body: <>
      <p>V3 combines anatomical target selection, verified simulator geometry, collision-aware operating-room routing, reference X-ray display, and AI-assisted simulator guidance.</p>
      <Callout><b>Core workflow:</b> Select target → configure OR → Preview Path → review route → Move C-Arm → verify geometry → Expose X-Ray.</Callout>
      <Warn>Research and educational simulation only. No physical or clinical safety, accuracy, dose, or diagnostic claim is established.</Warn>
    </>,
  },
  {
    badge: 'TARGET',
    title: '1. Select the Imaging Target',
    body: <>
      <p>Use the Automatic Path Planner to choose a procedure, body region, anatomical landmark, and projection.</p>
      <Card title="Typed request">You can type a short request such as <b>neck AP</b> or <b>left knee lateral</b>, then press <b>INTERPRET</b>.</Card>
      <Card title="Voice request">On supported browsers, press <b>VOICE</b>, speak the same kind of request, and the simulator will place it into the request field and run the existing interpretation step.</Card>
      <Note>Voice input does not preview a path, move the simulated C-arm, or expose an X-ray. Those actions remain separate.</Note>
    </>,
  },
  {
    badge: 'OPERATING ROOM',
    title: '2. Configure the Simulated OR',
    body: <>
      <p>Open <b>OPERATING ROOM</b> to inspect and reposition modeled obstacles such as staff, the IV pole, trolley, and other equipment.</p>
      <Card title="Object transforms">Select an object and use X/Y/Z and rotation controls. The camera remains free while equipment is repositioned.</Card>
      <Card title="Collision boxes">Show collision boxes when you want to inspect the simplified geometry used by the simulator for route checking.</Card>
      <Card title="Repeatable layouts">Randomized layouts can be repeated with the stored seed for reproducible simulator testing.</Card>
      <Note>After changing the OR layout, run <b>PREVIEW PATH</b> again. The previous path belongs to the previous scene.</Note>
    </>,
  },
  {
    badge: 'PATH',
    title: '3. Preview the Collision-Aware Path',
    body: <>
      <p>Press <b>PREVIEW PATH</b>. The planner generates a route to the selected imaging target and V3 checks the sampled path against the current simulated scene.</p>
      <Card title="DIRECT CLEAR">The sampled direct route was accepted by the current simulator collision criteria.</Card>
      <Card title="DIRECT NEAR">The route remains accepted but approaches the configured simulator clearance threshold.</Card>
      <Card title="REROUTED">A direct-route conflict was detected and an alternate simulated route was found.</Card>
      <Card title="BLOCKED">No accepted simulated route was found for the current scene and requested target.</Card>
      <Warn>Clearance is a digital-twin geometry metric, not a demonstrated real-world safety distance.</Warn>
    </>,
  },
  {
    badge: 'MOVE',
    title: '4. Move and Verify',
    body: <>
      <p>After reviewing an accepted preview, press <b>MOVE C-ARM</b>. The simulator follows the planned waypoints toward the stored final pose.</p>
      <Card title="Arrival verification">Use the reported pose residual, isocenter error, and central-ray error instead of relying on visual appearance alone.</Card>
      <Card title="Planner confidence">Planner confidence is displayed as a planning signal. It must not be described as positioning accuracy.</Card>
      <Warn>The 1 mm geometry criterion is an internal simulator engineering threshold, not physical or clinical positioning accuracy.</Warn>
    </>,
  },
  {
    badge: 'X-RAY',
    title: '5. Reference X-Ray',
    body: <>
      <p>After an accepted arrival, press <b>EXPOSE X-RAY</b>. If the selected anatomy and projection have a supported mapping, the simulator displays the corresponding reference radiograph.</p>
      <Card title="Unsupported view">If no reference exists, the simulator reports that explicitly instead of fabricating an image.</Card>
      <Warn>Reference images are simulator assets. They are not generated from the exact current pose and are not patient-specific diagnostic images.</Warn>
    </>,
  },
  {
    badge: 'GEMINI',
    title: '6. Gemini Guidance',
    body: <>
      <p>Gemini Guidance can explain the current simulator state, selected target, planned path, geometry verification, planner confidence, and reference-exposure state.</p>
      <Card title="Use it for interpretation">Ask why a route is blocked, what a status means, or what the current geometry values represent.</Card>
      <Note>Gemini Guidance explains the research simulator. It is not clinical decision support.</Note>
    </>,
  },
  {
    badge: 'CONTROLS',
    title: '7. Navigation & Shortcuts',
    body: <>
      <Card title="Camera">Left drag rotates, right drag pans, and scroll zooms. Operating-room transform controls do not intentionally lock the camera.</Card>
      <Card title="Keyboard">I: instructions · P: patient visibility · L: landmarks · D: debug visualization · C: supported external-hardware connection.</Card>
      <Card title="Normal sequence">Target → OR layout → Preview Path → route review → Move → arrival verification → reference exposure.</Card>
    </>,
  },
  {
    badge: 'READY',
    title: 'Keep the Evidence Precise',
    body: <>
      <p>The simulator is designed to make the planning process inspectable and reproducible while keeping the scientific boundary clear.</p>
      <Callout><b>Report what was measured:</b> simulator route status, sampled clearance, hard-limit compliance, geometry residuals, and planner confidence.</Callout>
      <Warn>Do not call planner confidence “accuracy.” Do not describe software-only collision or geometry results as clinical validation.</Warn>
    </>,
  },
];

function Card({ title, children }) {
  return <div style={card}><div style={cardTitle}>{title}</div><div>{children}</div></div>;
}
function Callout({ children }) { return <div style={callout}>{children}</div>; }
function Warn({ children }) { return <div style={warn}>{children}</div>; }
function Note({ children }) { return <div style={note}>{children}</div>; }

export default function Instructions({ onClose }) {
  const [page, setPage] = useState(0);
  const current = pages[page];

  return <div style={overlay}>
    <div style={modal}>
      <header style={header}>
        <div>
          <div style={badge}>{current.badge}</div>
          <h2 style={title}>{current.title}</h2>
        </div>
        <button onClick={onClose} style={close} aria-label="Close instructions">×</button>
      </header>

      <main style={main}>{current.body}</main>

      <footer style={footer}>
        <div style={dots}>
          {pages.map((_, i) => <span key={i} style={{
            width: i === page ? 24 : 7,
            height: 7,
            borderRadius: 999,
            background: i === page ? '#4a443d' : '#c3b9ad',
            boxShadow: i === page ? 'inset 1px 1px 2px rgba(0,0,0,.22)' : 'inset 1px 1px 2px rgba(92,82,72,.18)',
            transition: 'all 160ms ease',
          }} />)}
        </div>

        <div style={footerActions}>
          <span style={pageCounter}>{page + 1} / {pages.length}</span>
          <button disabled={!page} onClick={() => setPage(p => p - 1)} style={{ ...button, opacity: page ? 1 : .38 }}>Back</button>
          {page < pages.length - 1
            ? <button onClick={() => setPage(p => p + 1)} style={primaryButton}>Next →</button>
            : <button onClick={onClose} style={primaryButton}>Start Simulator</button>}
        </div>
      </footer>
    </div>
  </div>;
}

const overlay = {
  position: 'absolute', inset: 0, zIndex: 9999,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(52,48,43,.46)',
  backdropFilter: 'blur(12px) saturate(.8)',
  WebkitBackdropFilter: 'blur(12px) saturate(.8)',
  padding: 20,
};

const modal = {
  width: 880, maxWidth: '96vw', height: 630, maxHeight: '92vh',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
  borderRadius: 28,
  border: '1px solid rgba(255,255,255,.78)',
  background: 'linear-gradient(145deg, rgba(248,244,237,.99), rgba(220,213,202,.985))',
  color: '#312c27',
  boxShadow: '24px 24px 58px rgba(50,45,40,.34), -10px -10px 28px rgba(255,255,255,.60), inset 1px 1px 0 rgba(255,255,255,.94)',
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};

const header = {
  padding: '24px 30px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  borderBottom: '1px solid rgba(95,85,75,.10)',
  background: 'rgba(241,235,226,.54)',
};

const badge = {
  color: '#756b61', fontSize: 10, letterSpacing: 2.2, fontWeight: 900, marginBottom: 7,
};

const title = {
  margin: 0, color: '#29251f', fontSize: 24, lineHeight: 1.15, letterSpacing: '-.025em', fontWeight: 900,
};

const close = {
  width: 40, height: 40, borderRadius: 13,
  border: '1px solid rgba(255,255,255,.72)',
  background: 'linear-gradient(145deg,#f2ede5,#d4ccc0)',
  color: '#514941', fontSize: 22, lineHeight: 1, cursor: 'pointer',
  boxShadow: '4px 4px 10px rgba(92,82,72,.18), -3px -3px 9px rgba(255,255,255,.72)',
};

const main = {
  flex: 1, overflowY: 'auto', padding: '26px 34px 30px',
  color: '#4d463f', fontSize: 15, lineHeight: 1.68,
};

const footer = {
  padding: '16px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18,
  borderTop: '1px solid rgba(95,85,75,.10)',
  background: 'rgba(235,228,218,.58)',
};

const dots = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' };
const footerActions = { display: 'flex', alignItems: 'center', gap: 10 };
const pageCounter = { color: '#746a61', fontSize: 12, fontWeight: 750, marginRight: 2 };

const button = {
  padding: '9px 16px', borderRadius: 12,
  border: '1px solid rgba(255,255,255,.66)',
  background: 'linear-gradient(145deg,#f1ece4,#d6cec3)',
  color: '#37322d', fontWeight: 850, cursor: 'pointer',
  boxShadow: '4px 4px 10px rgba(88,80,71,.16), -3px -3px 8px rgba(255,255,255,.72)',
};

const primaryButton = {
  ...button,
  background: 'linear-gradient(145deg,#3d3934,#24221f)',
  color: '#fffaf3',
  border: '1px solid rgba(255,255,255,.14)',
  boxShadow: '5px 5px 12px rgba(44,41,37,.26), -3px -3px 9px rgba(255,255,255,.44)',
};

const card = {
  background: 'rgba(234,227,217,.78)',
  border: '1px solid rgba(92,82,72,.08)',
  borderRadius: 16,
  padding: '14px 16px', margin: '12px 0',
  color: '#4a433c',
  boxShadow: 'inset 2px 2px 6px rgba(92,82,72,.10), inset -2px -2px 6px rgba(255,255,255,.62)',
};

const cardTitle = { color: '#302b26', fontWeight: 900, marginBottom: 3 };

const callout = {
  background: 'rgba(214,205,193,.84)',
  border: '1px solid rgba(90,80,70,.12)',
  borderRadius: 16,
  padding: '15px 17px', margin: '16px 0',
  color: '#3f3933',
  boxShadow: 'inset 2px 2px 6px rgba(85,76,68,.10)',
};

const note = {
  background: 'rgba(218,211,227,.60)',
  border: '1px solid rgba(101,88,117,.12)',
  borderRadius: 16,
  padding: '13px 15px', margin: '14px 0',
  color: '#4a414f',
};

const warn = {
  background: 'rgba(221,199,160,.46)',
  border: '1px solid rgba(132,94,38,.18)',
  color: '#5c4524',
  borderRadius: 16,
  padding: '13px 15px', margin: '14px 0',
};
