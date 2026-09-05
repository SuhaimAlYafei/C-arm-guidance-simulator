import { useEffect } from 'react';

const STYLE_ID = 'carm-planner-clinical-style';
const VOICE_ID = 'carm-planner-voice-button';
const LEGAL_ID = 'carm-planner-legal-links';

const plannerCss = `
[data-carm-planner="true"] {
  width: 318px !important;
  padding: 16px !important;
  border: 1px solid #6f7579 !important;
  border-radius: 2px !important;
  background: #d9dbd8 !important;
  color: #1f2528 !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  font-family: Arial, Helvetica, sans-serif !important;
  overflow: hidden !important;
}

[data-carm-planner="true"] *,
[data-carm-planner="true"] *::before,
[data-carm-planner="true"] *::after {
  box-shadow: none !important;
  text-shadow: none !important;
  transition: none !important;
}

[data-carm-planner="true"] div,
[data-carm-planner="true"] span,
[data-carm-planner="true"] label,
[data-carm-planner="true"] p,
[data-carm-planner="true"] small {
  color: #30383c !important;
}

[data-carm-planner="true"] [data-planner-role="title"] {
  color: #111619 !important;
  font-size: 15px !important;
  font-weight: 800 !important;
  letter-spacing: .01em !important;
  margin-bottom: 6px !important;
}

[data-carm-planner="true"] [data-planner-role="description"] {
  color: #4b555a !important;
  line-height: 1.4 !important;
}

[data-carm-planner="true"] [data-planner-role="field-label"] {
  color: #394247 !important;
  font-weight: 700 !important;
  letter-spacing: .02em !important;
}

[data-carm-planner="true"] input,
[data-carm-planner="true"] select {
  min-height: 34px !important;
  border: 1px solid #91979a !important;
  border-radius: 2px !important;
  background: #cfd2cf !important;
  color: #171d20 !important;
  outline: none !important;
  font-family: Arial, Helvetica, sans-serif !important;
}

[data-carm-planner="true"] input::placeholder {
  color: #626b70 !important;
  opacity: 1 !important;
}

[data-carm-planner="true"] input:focus,
[data-carm-planner="true"] select:focus {
  border-color: #1f4f6b !important;
  outline: 2px solid #879ba6 !important;
  outline-offset: 0 !important;
}

[data-carm-planner="true"] option {
  color: #171d20 !important;
  background: #d9dbd8 !important;
}

[data-carm-planner="true"] button {
  min-height: 34px !important;
  border: 1px solid #71787c !important;
  border-radius: 2px !important;
  background: #c5c9c6 !important;
  color: #1e2528 !important;
  font-family: Arial, Helvetica, sans-serif !important;
  font-weight: 700 !important;
  letter-spacing: .01em !important;
  transform: none !important;
}

[data-carm-planner="true"] button:hover:not(:disabled),
[data-carm-planner="true"] button:active:not(:disabled) {
  transform: none !important;
  background: #b9bfbc !important;
}

[data-carm-planner="true"] button:focus-visible {
  outline: 2px solid #1f4f6b !important;
  outline-offset: 1px !important;
}

[data-carm-planner="true"] button:disabled {
  opacity: .45 !important;
  cursor: not-allowed !important;
}

[data-carm-planner="true"] [data-planner-action="primary"] {
  background: #26343b !important;
  color: #e8ecea !important;
  border-color: #26343b !important;
}

[data-carm-planner="true"] [data-planner-action="interpret"] {
  background: #6a7378 !important;
  color: #eef0ee !important;
  border-color: #5c656a !important;
}

[data-carm-planner="true"] [data-planner-role="voice-row"] {
  grid-template-columns: minmax(0, 1fr) auto auto !important;
  align-items: stretch !important;
}

[data-carm-planner="true"] [data-planner-action="voice"] {
  min-width: 54px !important;
  padding: 0 10px !important;
  background: #b8bebb !important;
  color: #1b2327 !important;
  font-size: 9px !important;
  letter-spacing: .06em !important;
}

[data-carm-planner="true"] [data-planner-role="warning"] {
  padding: 9px 10px !important;
  border: 1px solid #8b6d3d !important;
  border-radius: 2px !important;
  background: #c8b891 !important;
  color: #322817 !important;
}

[data-carm-planner="true"] [data-planner-role="warning"] * {
  color: #322817 !important;
}

[data-carm-planner="true"] [data-planner-role="info"],
[data-carm-planner="true"] [data-planner-role="status"] {
  border: 1px solid #8d9396 !important;
  border-radius: 2px !important;
  background: #c9cdca !important;
  color: #242b2f !important;
}

[data-carm-planner="true"] [data-planner-role="info"] *,
[data-carm-planner="true"] [data-planner-role="status"] * {
  color: #242b2f !important;
}

[data-carm-planner="true"] input[type="range"] {
  min-height: 0 !important;
  height: 4px !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: #858c90 !important;
  accent-color: #26343b !important;
}

#${LEGAL_ID} {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid #a2a7a9;
  font: 9px/1.2 Arial, Helvetica, sans-serif;
}

#${LEGAL_ID} a {
  color: #3b464b !important;
  text-decoration: underline;
  text-underline-offset: 2px;
}
`;

function smallestMatching(root, predicate) {
  const matches = Array.from(root.querySelectorAll('div')).filter(predicate);
  return matches.sort((a, b) => a.textContent.length - b.textContent.length)[0] || null;
}

function installVoiceControl(panel) {
  const interpretButton = Array.from(panel.querySelectorAll('button')).find(
    button => button.textContent?.trim().toUpperCase() === 'INTERPRET'
  );
  const requestInput = panel.querySelector('input[type="text"]');
  const requestRow = interpretButton?.parentElement;

  if (!interpretButton || !requestInput || !requestRow) return;
  requestRow.dataset.plannerRole = 'voice-row';

  let voiceButton = document.getElementById(VOICE_ID);
  if (!voiceButton) {
    voiceButton = document.createElement('button');
    voiceButton.id = VOICE_ID;
    voiceButton.type = 'button';
    voiceButton.dataset.plannerAction = 'voice';
    voiceButton.textContent = 'VOICE';
    voiceButton.title = 'Open medical voice search';
    requestRow.insertBefore(voiceButton, interpretButton);
  }
}

function installLegalLinks(panel) {
  if (document.getElementById(LEGAL_ID)) return;
  const legal = document.createElement('div');
  legal.id = LEGAL_ID;

  const privacy = document.createElement('a');
  privacy.href = '/privacy.html';
  privacy.target = '_blank';
  privacy.rel = 'noreferrer';
  privacy.textContent = 'Privacy';

  const terms = document.createElement('a');
  terms.href = '/terms.html';
  terms.target = '_blank';
  terms.rel = 'noreferrer';
  terms.textContent = 'Terms';

  legal.append(privacy, terms);
  panel.appendChild(legal);
}

function tagPlanner() {
  const title = Array.from(document.querySelectorAll('div')).find(
    node => node.textContent?.trim() === 'AUTOMATIC PATH PLANNER'
  );

  if (!title?.parentElement) return false;

  const panel = title.parentElement;
  panel.dataset.carmPlanner = 'true';
  title.dataset.plannerRole = 'title';

  const description = smallestMatching(panel, node =>
    node.textContent?.trim().startsWith('Choose a procedure, body region')
  );
  if (description) description.dataset.plannerRole = 'description';

  const warning = smallestMatching(panel, node =>
    node.textContent?.trim().startsWith('RESEARCH SIMULATOR ONLY')
  );
  if (warning) warning.dataset.plannerRole = 'warning';

  const info = smallestMatching(panel, node => {
    const text = node.textContent || '';
    return text.includes('Beam:') && text.includes('Preset:');
  });
  if (info) info.dataset.plannerRole = 'info';

  const status = smallestMatching(panel, node =>
    node.textContent?.trim().startsWith('Status:')
  );
  if (status) status.dataset.plannerRole = 'status';

  const fieldLabels = new Set([
    'procedure',
    'body region',
    'anatomical landmark',
    'projection',
    'recommended alternatives',
  ]);

  panel.querySelectorAll('div,span,label').forEach(node => {
    if (node.children.length) return;
    const text = node.textContent?.trim().toLowerCase() || '';
    if (fieldLabels.has(text) || text.startsWith('waypoints:')) {
      node.dataset.plannerRole = 'field-label';
    }
  });

  panel.querySelectorAll('button').forEach(button => {
    if (button.id === VOICE_ID) return;
    const label = button.textContent?.trim().toUpperCase() || '';
    delete button.dataset.plannerAction;

    if (label.includes('PREVIEW PATH') || label.includes('EXPOSE X-RAY')) {
      button.dataset.plannerAction = 'primary';
    } else if (label.includes('INTERPRET')) {
      button.dataset.plannerAction = 'interpret';
    }
  });

  installVoiceControl(panel);
  installLegalLinks(panel);
  return true;
}

export default function PlannerUiPolish() {
  useEffect(() => {
    const previous = document.getElementById('carm-planner-clay-style');
    previous?.remove();

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = plannerCss;
      document.head.appendChild(style);
    }

    let queued = false;
    const refresh = () => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(() => {
        queued = false;
        tagPlanner();
      });
    };

    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  return null;
}
