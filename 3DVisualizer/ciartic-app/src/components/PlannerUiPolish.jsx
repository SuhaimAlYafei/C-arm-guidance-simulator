import { useEffect } from 'react';

const STYLE_ID = 'carm-planner-clay-style';

const plannerCss = `
[data-carm-planner="true"] {
  width: 318px !important;
  padding: 18px !important;
  border: 1px solid rgba(255,255,255,.72) !important;
  border-radius: 24px !important;
  background:
    linear-gradient(145deg, rgba(247,243,235,.98), rgba(220,213,202,.97)) !important;
  color: #2f2b27 !important;
  box-shadow:
    18px 18px 38px rgba(66,61,55,.24),
    -8px -8px 24px rgba(255,255,255,.72),
    inset 1px 1px 0 rgba(255,255,255,.9),
    inset -1px -1px 0 rgba(119,109,97,.10) !important;
  backdrop-filter: blur(18px) saturate(.85) !important;
  -webkit-backdrop-filter: blur(18px) saturate(.85) !important;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
  overflow: hidden !important;
}

[data-carm-planner="true"] [data-planner-role="title"] {
  color: #292622 !important;
  font-size: 15px !important;
  font-weight: 900 !important;
  letter-spacing: -.025em !important;
  margin-bottom: 5px !important;
}

[data-carm-planner="true"] input,
[data-carm-planner="true"] select {
  min-height: 34px !important;
  border: 1px solid rgba(82,75,67,.10) !important;
  border-radius: 12px !important;
  background: #e9e3da !important;
  color: #302c28 !important;
  box-shadow:
    inset 3px 3px 7px rgba(93,84,73,.14),
    inset -3px -3px 7px rgba(255,255,255,.72) !important;
  outline: none !important;
}

[data-carm-planner="true"] input:focus,
[data-carm-planner="true"] select:focus {
  border-color: rgba(65,60,54,.32) !important;
  box-shadow:
    inset 3px 3px 7px rgba(93,84,73,.12),
    inset -3px -3px 7px rgba(255,255,255,.78),
    0 0 0 3px rgba(65,60,54,.08) !important;
}

[data-carm-planner="true"] button {
  min-height: 34px !important;
  border: 1px solid rgba(255,255,255,.62) !important;
  border-radius: 12px !important;
  background: linear-gradient(145deg, #f1ece4, #d7d0c5) !important;
  color: #39342f !important;
  font-weight: 850 !important;
  letter-spacing: -.01em !important;
  box-shadow:
    4px 4px 9px rgba(88,80,71,.18),
    -3px -3px 8px rgba(255,255,255,.72),
    inset 1px 1px 0 rgba(255,255,255,.72) !important;
  transition: transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease !important;
}

[data-carm-planner="true"] button:hover:not(:disabled) {
  transform: translateY(-1px) !important;
  box-shadow:
    6px 6px 12px rgba(88,80,71,.20),
    -4px -4px 10px rgba(255,255,255,.78) !important;
}

[data-carm-planner="true"] button:active:not(:disabled) {
  transform: translateY(1px) !important;
  box-shadow:
    inset 3px 3px 7px rgba(88,80,71,.16),
    inset -3px -3px 7px rgba(255,255,255,.64) !important;
}

[data-carm-planner="true"] button:disabled {
  opacity: .42 !important;
  cursor: not-allowed !important;
}

[data-carm-planner="true"] [data-planner-action="primary"] {
  background: linear-gradient(145deg, #3b3935, #242320) !important;
  color: #f7f2ea !important;
  border-color: rgba(255,255,255,.14) !important;
  box-shadow:
    5px 5px 12px rgba(44,41,37,.28),
    -3px -3px 9px rgba(255,255,255,.5) !important;
}

[data-carm-planner="true"] [data-planner-action="interpret"] {
  background: linear-gradient(145deg, #d9d1e5, #b9adc9) !important;
  color: #332d39 !important;
}

[data-carm-planner="true"] [data-planner-role="warning"] {
  padding: 9px 10px !important;
  border: 1px solid rgba(157,117,49,.16) !important;
  border-radius: 13px !important;
  background: rgba(218,196,157,.34) !important;
  color: #68522f !important;
  box-shadow: inset 2px 2px 5px rgba(116,92,54,.08) !important;
}

[data-carm-planner="true"] [data-planner-role="info"] {
  border: 1px solid rgba(88,80,70,.08) !important;
  border-radius: 14px !important;
  background: rgba(232,226,216,.78) !important;
  color: #4d4740 !important;
  box-shadow:
    inset 2px 2px 6px rgba(91,82,71,.10),
    inset -2px -2px 6px rgba(255,255,255,.58) !important;
}

[data-carm-planner="true"] [data-planner-role="status"] {
  border: 1px solid rgba(77,71,64,.10) !important;
  border-radius: 13px !important;
  background: rgba(239,234,226,.76) !important;
  color: #38332e !important;
  box-shadow: inset 2px 2px 5px rgba(81,74,66,.09) !important;
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

function tagPlanner() {
  const title = Array.from(document.querySelectorAll('div')).find(
    node => node.textContent?.trim() === 'AUTOMATIC PATH PLANNER'
  );

  if (!title?.parentElement) return false;

  const panel = title.parentElement;
  panel.dataset.carmPlanner = 'true';
  title.dataset.plannerRole = 'title';

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

  panel.querySelectorAll('button').forEach(button => {
    const label = button.textContent?.trim().toUpperCase() || '';
    delete button.dataset.plannerAction;

    if (label.includes('PREVIEW PATH') || label.includes('EXPOSE X-RAY')) {
      button.dataset.plannerAction = 'primary';
    } else if (label.includes('INTERPRET')) {
      button.dataset.plannerAction = 'interpret';
    }
  });

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
