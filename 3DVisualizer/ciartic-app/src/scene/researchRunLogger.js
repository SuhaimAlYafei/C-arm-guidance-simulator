const STORAGE_KEY = 'carm_research_run_log_v1';
const MAX_EVENTS = 1000;

const listeners = new Set();
let events = [];

const safeWindow = () => (typeof window !== 'undefined' ? window : null);

const load = () => {
  const win = safeWindow();
  if (!win?.localStorage) return [];
  try {
    const parsed = JSON.parse(win.localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(-MAX_EVENTS) : [];
  } catch {
    return [];
  }
};

events = load();

const persist = () => {
  const win = safeWindow();
  if (!win?.localStorage) return;
  try {
    win.localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch {
    // Logging must never break the simulator.
  }
};

const emit = () => {
  const snapshot = getResearchLog();
  listeners.forEach(listener => {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn('[research logger] subscriber failed', error);
    }
  });
};

export const logResearchEvent = (type, payload = {}) => {
  const event = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    type: String(type || 'event'),
    payload,
  };
  events = [...events, event].slice(-MAX_EVENTS);
  persist();
  emit();
  return event;
};

export const getResearchLog = () => events.map(event => ({
  ...event,
  payload: event.payload && typeof event.payload === 'object'
    ? { ...event.payload }
    : event.payload,
}));

export const clearResearchLog = () => {
  events = [];
  persist();
  emit();
};

export const subscribeResearchLog = listener => {
  listeners.add(listener);
  listener(getResearchLog());
  return () => listeners.delete(listener);
};

const downloadBlob = (filename, text, mimeType) => {
  const win = safeWindow();
  if (!win?.document) return false;
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return true;
};

export const exportResearchLogJson = () => {
  const payload = {
    exported_at: new Date().toISOString(),
    schema: 'carm-research-log-v1',
    event_count: events.length,
    events: getResearchLog(),
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return downloadBlob(
    `carm-research-log-${stamp}.json`,
    JSON.stringify(payload, null, 2),
    'application/json',
  );
};

const csvEscape = value => {
  const text = value == null
    ? ''
    : typeof value === 'string'
      ? value
      : JSON.stringify(value);
  return `"${text.replaceAll('"', '""')}"`;
};

export const exportResearchLogCsv = () => {
  const lines = ['timestamp,type,payload'];
  events.forEach(event => {
    lines.push([
      csvEscape(event.timestamp),
      csvEscape(event.type),
      csvEscape(event.payload),
    ].join(','));
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return downloadBlob(
    `carm-research-log-${stamp}.csv`,
    lines.join('\n'),
    'text/csv;charset=utf-8',
  );
};

if (safeWindow()) {
  logResearchEvent('session_started', {
    user_agent: navigator?.userAgent || null,
    url: location?.href || null,
  });
}
