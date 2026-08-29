import { useEffect } from 'react';

const STYLE_ID = 'carm-planner-clay-style';
const VOICE_ID = 'carm-planner-voice-button';

const plannerCss = `
[data-carm-planner="true"] {
  width: 318px !important;
  padding: 18px !important;
  border: 1px solid rgba(255,255,255,.78) !important;
  border-radius: 24px !important;
  background: linear-gradient(145deg, rgba(248,244,237,.985), rgba(220,213,202,.975)) !important;
  color: #302b26 !important;
  box-shadow:
    18px 18px 38px rgba(66,61,55,.24),
    -8px -8px 24px rgba(255,255,255,.76),
    inset 1px 1px 0 rgba(255,255,255,.94),
    inset -1px -1px 0 rgba(119,109,97,.10) !important;
  backdrop-filter: blur(18px) saturate(.85) !important;
  -webkit-backdrop-filter: blur(18px) saturate(.85) !important;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
  overflow: hidden !important;
}

/* The old planner used pale blue helper text. On the ivory surface it was too
   low-contrast, so every ordinary text node now uses a dark warm neutral. */
[data-carm-planner="true"] div,
[data-carm-planner="true"] span,
[data-carm-planner="true"] label,
[data-carm-planner="true"] p,
[data-carm-planner="true"] small {
  color: #4b443d !important;
}

[data-carm-planner="true"] [data-planner-role="title"] {
  color: #27231f !important;
  font-size: 15px !important;
  font-weight: 900 !important;
  letter-spacing: -.025em !important;
  margin-bottom: 5px !important;
}

[data-carm-planner="true"] [data-planner-role="description"] {
  color: #665d54 !important;
  line-height: 1.45 !important;
}

[data-carm-planner="true"] [data-planner-role="field-label"] {
  color: #5c534b !important;
  font-weight: 800 !important;
  letter-spacing: .01em !important;
}

[data-carm-planner="true"] input,
[data-carm-planner="true"] select {
  min-height: 34px !important;
  border: 1px solid rgba(82,75,67,.10) !important;
  border-radius: 12px !important;
  background: #ebe5dc !important;
  color: #292520 !important;
  box-shadow:
    inset 3px 3px 7px rgba(93,84,73,.14),
    inset -3px -3px 7px rgba(255,255,255,.78) !important;
  outline: none !important;
}

[data-carm-planner="true"] input::placeholder {
  color: #81766b !important;
  opacity: 1 !important;
}

[data-carm-planner="true"] input:focus,
[data-carm-planner="true"] select:focus {
  border-color: rgba(65,60,54,.34) !important;
  box-shadow:
    inset 3px 3px 7px rgba(93,84,73,.12),
    inset -3px -3px 7px rgba(255,255,255,.82),
    0 0 0 3px rgba(65,60,54,.09) !important;
}

[data-carm-planner="true"] option {
  color: #292520 !important;
  background: #f4efe8 !important;
}

[data-carm-planner="true"] button {
  min-height: 34px !important;
  border: 1px solid rgba(255,255,255,.64) !important;
  border-radius: 12px !important;
  background: linear-gradient(145deg, #f2ede5, #d7d0c5) !important;
  color: #34302b !important;
  font-weight: 850 !important;
  letter-spacing: -.01em !important;
  box-shadow:
    4px 4px 9px rgba(88,80,71,.18),
    -3px -3px 8px rgba(255,255,255,.74),
    inset 1px 1px 0 rgba(255,255,255,.74) !important;
  transition: transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease !important;
}

[data-carm-planner="true"] button:hover:not(:disabled) {
  transform: translateY(-1px) !important;
  box-shadow:
    6px 6px 12px rgba(88,80,71,.20),
    -4px -4px 10px rgba(255,255,255,.80) !important;
}

[data-carm-planner="true"] button:active:not(:disabled) {
  transform: translateY(1px) !important;
  box-shadow:
    inset 3px 3px 7px rgba(88,80,71,.16),
    inset -3px -3px 7px rgba(255,255,255,.66) !important;
}

[data-carm-planner="true"] button:disabled {
  opacity: .46 !important;
  cursor: not-allowed !important;
}

[data-carm-planner="true"] [data-planner-action="primary"] {
  background: linear-gradient(145deg, #3c3934, #24221f) !important;
  color: #fffaf2 !important;
  border-color: rgba(255,255,255,.14) !important;
  box-shadow:
    5px 5px 12px rgba(44,41,37,.28),
    -3px -3px 9px rgba(255,255,255,.5) !important;
}

[data-carm-planner="true"] [data-planner-action="interpret"] {
  background: linear-gradient(145deg, #d8cfdf, #b8abc6) !important;
  color: #302936 !important;
}

[data-carm-planner="true"] [data-planner-role="voice-row"] {
  grid-template-columns: minmax(0, 1fr) auto auto !important;
  align-items: stretch !important;
}

[data-carm-planner="true"] [data-planner-action="voice"] {
  min-width: 54px !important;
  padding: 0 10px !important;
  background: linear-gradient(145deg, #e5ded4, #c9c0b4) !important;
  color: #352f29 !important;
  font-size: 9px !important;
  letter-spacing: .06em !important;
}

[data-carm-planner="true"] [data-planner-action="voice"][data-listening="true"] {
  background: linear-gradient(145deg, #6f6257, #4d453e) !important;
  color: #fffaf3 !important;
  box-shadow:
    inset 2px 2px 5px rgba(26,23,20,.22),
    0 0 0 3px rgba(103,88,75,.12) !important;
}

[data-carm-planner="true"] [data-planner-role="warning"] {
  padding: 9px 10px !important;
  border: 1px solid rgba(130,92,38,.20) !important;
  border-radius: 13px !important;
  background: rgba(218,196,157,.42) !important;
  color: #594423 !important;
  box-shadow: inset 2px 2px 5px rgba(116,92,54,.08) !important;
}

[data-carm-planner="true"] [data-planner-role="warning"] * {
  color: #594423 !important;
}

[data-carm-planner="true"] [data-planner-role="info"] {
  border: 1px solid rgba(88,80,70,.08) !important;
  border-radius: 14px !important;
  background: rgba(232,226,216,.82) !important;
  color: #403a34 !important;
  box-shadow:
    inset 2px 2px 6px rgba(91,82,71,.10),
    inset -2px -2px 6px rgba(255,255,255,.62) !important;
}

[data-carm-planner="true"] [data-planner-role="info"] * {
  color: #403a34 !important;
}

[data-carm-planner="true"] [data-planner-role="status"] {
  border: 1px solid rgba(77,71,64,.10) !important;
  border-radius: 13px !important;
  background: rgba(239,234,226,.80) !important;
  color: #332e29 !important;
  box-shadow: inset 2px 2px 5px rgba(81,74,66,.09) !important;
}

[data-carm-planner="true"] [data-planner-role="status"] * {
  color: #332e29 !important;
}

[data-carm-planner="true"] input[type="range"] {
  min-height: 0 !important;
  height: 5px !important;
  border: 0 !important;
  border-radius: 999px !important;
  background: #b8afa3 !important;
  box-shadow: inset 1px 1px 3px rgba(63,57,51,.22) !important;
  accent-color: #3a3733 !important;
}

[data-carm-planner="true"] * {
  scrollbar-width: thin;
  scrollbar-color: rgba(90,81,72,.28) transparent;
}
`;

function smallestMatching(root, predicate) {
  const matches = Array.from(root.querySelectorAll('div')).filter(predicate);
  return matches.sort((a, b) => a.textContent.length - b.textContent.length)[0] || null;
}

function setReactInputValue(input, value) {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function normalizeTranscript(text) {
  return text
    .replace(/\ba\s*p\b/gi, 'AP')
    .replace(/\bp\s*a\b/gi, 'PA')
    .replace(/\br\s*a\s*o\b/gi, 'RAO')
    .replace(/\bl\s*a\s*o\b/gi, 'LAO')
    .trim();
}

function installVoiceControl(panel) {
  const interpretButton = Array.from(panel.querySelectorAll('button')).find(
    button => button.textContent?.trim().toUpperCase() === 'INTERPRET'
  );
  const requestInput = panel.querySelector('input[type="text"]');
  const requestRow = interpretButton?.parentElement;

  if (!interpretButton || !requestInput || !requestRow) return;
  requestRow.dataset.plannerRole = 'voice-row';

  if (document.getElementById(VOICE_ID)) return;

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const voiceButton = document.createElement('button');
  voiceButton.id = VOICE_ID;
  voiceButton.type = 'button';
  voiceButton.dataset.plannerAction = 'voice';
  voiceButton.textContent = Recognition ? 'VOICE' : 'VOICE N/A';
  voiceButton.title = Recognition
    ? 'Speak an imaging request, for example “neck AP” or “left knee lateral”.'
    : 'Voice recognition is not supported by this browser.';
  voiceButton.disabled = !Recognition;

  let recognition = null;
  let resetTimer = null;

  const resetButton = (label = 'VOICE', delay = 0) => {
    if (resetTimer) window.clearTimeout(resetTimer);
    const run = () => {
      voiceButton.textContent = label;
      voiceButton.dataset.listening = 'false';
    };
    if (delay) resetTimer = window.setTimeout(run, delay);
    else run();
  };

  voiceButton.addEventListener('click', () => {
    if (!Recognition) return;

    try {
      recognition?.abort?.();
      recognition = new Recognition();
      recognition.lang = 'en-US';
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      voiceButton.textContent = 'LISTENING';
      voiceButton.dataset.listening = 'true';

      recognition.onresult = event => {
        const raw = event.results?.[0]?.[0]?.transcript || '';
        const transcript = normalizeTranscript(raw);
        if (!transcript) {
          resetButton('TRY AGAIN', 1100);
          return;
        }

        setReactInputValue(requestInput, transcript);
        voiceButton.textContent = 'GOT IT';
        voiceButton.dataset.listening = 'false';

        // Voice only feeds the existing INTERPRET workflow. It never previews,
        // moves the simulated C-arm, or triggers exposure by itself.
        window.setTimeout(() => {
          if (!interpretButton.disabled) interpretButton.click();
          resetButton('VOICE', 900);
        }, 180);
      };

      recognition.onerror = () => resetButton('TRY AGAIN', 1200);
      recognition.onend = () => {
        if (voiceButton.dataset.listening === 'true') resetButton('VOICE');
      };
      recognition.start();
    } catch {
      resetButton('TRY AGAIN', 1200);
    }
  });

  requestRow.insertBefore(voiceButton, interpretButton);
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
  return true;
}

export default function PlannerUiPolish() {
  useEffect(() => {
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
