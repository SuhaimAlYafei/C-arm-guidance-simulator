import { useEffect } from 'react';

const STYLE_ID = 'carm-interface-discipline';

const css = `
[data-carm-gemini-button="true"] {
  border: 1px solid #596267 !important;
  border-radius: 2px !important;
  background: #30393e !important;
  background-image: none !important;
  color: #e2e7e5 !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  font-family: Arial, Helvetica, sans-serif !important;
  font-weight: 700 !important;
  transition: none !important;
}

[data-carm-gemini-panel="true"] {
  border: 1px solid #5f686c !important;
  border-radius: 2px !important;
  background: #30383c !important;
  background-image: none !important;
  color: #e0e5e3 !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  font-family: Arial, Helvetica, sans-serif !important;
}

[data-carm-gemini-panel="true"] *,
[data-carm-gemini-button="true"] * {
  border-radius: 2px !important;
  box-shadow: none !important;
  text-shadow: none !important;
  transition: none !important;
  font-family: Arial, Helvetica, sans-serif !important;
}

[data-carm-gemini-panel="true"] [style*="linear-gradient"],
[data-carm-gemini-button="true"] [style*="linear-gradient"] {
  background: #687176 !important;
  background-image: none !important;
}

[data-carm-gemini-panel="true"] button {
  border-radius: 2px !important;
  box-shadow: none !important;
  transition: none !important;
}

[data-carm-gemini-panel="true"] button:hover,
[data-carm-gemini-button="true"]:hover {
  transform: none !important;
}

[data-carm-gemini-panel="true"] textarea {
  border-radius: 0 !important;
  font-family: Arial, Helvetica, sans-serif !important;
}

[data-carm-gemini-panel="true"] [data-carm-ai-mark="true"] {
  background: #657075 !important;
  background-image: none !important;
  color: #eef1f0 !important;
  border: 1px solid #7b8589 !important;
  font-size: 9px !important;
  font-weight: 800 !important;
  letter-spacing: .05em !important;
}

[data-carm-gemini-panel="true"] [data-carm-live-mark="true"],
[data-carm-gemini-button="true"] [data-carm-live-mark="true"] {
  background: #496451 !important;
  border-radius: 0 !important;
}

[data-carm-skeleton="true"] {
  position: relative !important;
  min-height: 34px !important;
  color: transparent !important;
  overflow: hidden !important;
}

[data-carm-skeleton="true"] > * {
  visibility: hidden !important;
}

[data-carm-skeleton="true"]::before,
[data-carm-skeleton="true"]::after {
  content: '';
  position: absolute;
  left: 0;
  height: 7px;
  background: #697277;
}

[data-carm-skeleton="true"]::before {
  top: 7px;
  width: 72%;
}

[data-carm-skeleton="true"]::after {
  top: 20px;
  width: 46%;
}
`;

function nearestGeminiPanel(title) {
  let node = title?.parentElement;
  while (node && node !== document.body) {
    if (node.querySelector?.('textarea') && node.textContent?.includes('Gemini Guidance')) return node;
    node = node.parentElement;
  }
  return null;
}

function normalizeVisibleMarks(root) {
  if (!root) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let current = walker.nextNode();
  while (current) {
    textNodes.push(current);
    current = walker.nextNode();
  }

  textNodes.forEach(node => {
    if (node.nodeValue?.includes('✦')) node.nodeValue = node.nodeValue.replaceAll('✦', 'AI');
  });

  Array.from(root.querySelectorAll('div,span')).forEach(node => {
    if (node.textContent?.trim() === 'AI' && node.children.length === 0) {
      node.dataset.carmAiMark = 'true';
    }
    const style = window.getComputedStyle(node);
    if (style.width === '7px' && style.height === '7px') {
      node.dataset.carmLiveMark = 'true';
    }
    if (node.textContent?.trim() === 'Analyzing simulator state') {
      node.parentElement?.setAttribute('data-carm-skeleton', 'true');
    }
  });
}

function tagGemini() {
  const floating = Array.from(document.querySelectorAll('button')).find(button =>
    button.textContent?.includes('Gemini Guidance')
  );
  if (floating) {
    floating.dataset.carmGeminiButton = 'true';
    normalizeVisibleMarks(floating);
  }

  const title = Array.from(document.querySelectorAll('div')).find(node =>
    node.textContent?.trim() === 'Gemini Guidance'
  );
  const panel = nearestGeminiPanel(title);
  if (panel) {
    panel.dataset.carmGeminiPanel = 'true';
    normalizeVisibleMarks(panel);
  }
}

export default function InterfaceDiscipline() {
  useEffect(() => {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = css;
      document.head.appendChild(style);
    }

    let queued = false;
    const refresh = () => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(() => {
        queued = false;
        tagGemini();
      });
    };

    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
