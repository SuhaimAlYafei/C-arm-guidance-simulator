import React, { useCallback, useEffect, useRef, useState } from 'react';

const VOICE_BUTTON_ID = 'carm-planner-voice-button';

const MEDICAL_TERMS = [
  'cervical spine', 'c spine', 'neck', 'skull', 'head', 'chest', 'abdomen', 'pelvis',
  'left hip', 'right hip', 'left knee', 'right knee', 'left ankle', 'right ankle',
  'left shoulder', 'right shoulder', 'left elbow', 'right elbow', 'left hand', 'right hand',
  'spine', 'hip', 'knee', 'ankle', 'shoulder', 'elbow', 'hand',
  'ap', 'pa', 'lateral', 'left lateral', 'right lateral', 'rao', 'lao', 'cranial', 'caudal',
  'fluoroscopy', 'c arm', 'projection', 'landmark',
];

const PAIRED_ANATOMY = ['shoulder', 'elbow', 'hand', 'hip', 'knee', 'ankle'];

function normalizeMedicalRequest(value) {
  let text = String(value || '')
    .replace(/[,.!?;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const rules = [
    [/\ba\s+p\b/gi, 'AP'],
    [/\bp\s+a\b/gi, 'PA'],
    [/\br\s+a\s+o\b/gi, 'RAO'],
    [/\bl\s+a\s+o\b/gi, 'LAO'],
    [/\bc\s*[- ]?spine\b/gi, 'cervical spine'],
    [/\bcervical\s+spine\b/gi, 'neck'],
    [/\bcervical\b/gi, 'neck'],
    [/\bx\s*ray\b/gi, 'x-ray'],
  ];

  rules.forEach(([pattern, replacement]) => {
    text = text.replace(pattern, replacement);
  });

  return text.replace(/\s+/g, ' ').trim();
}

function medicalScore(transcript, confidence = 0) {
  const normalized = normalizeMedicalRequest(transcript).toLowerCase();
  let score = Number.isFinite(confidence) ? confidence * 2 : 0;

  MEDICAL_TERMS.forEach(term => {
    if (normalized.includes(term)) score += term.includes(' ') ? 3 : 1.5;
  });

  if (/\b(ap|pa|rao|lao|lateral|cranial|caudal)\b/i.test(normalized)) score += 3;
  if (/\b(left|right)\b/i.test(normalized)) score += 1;
  return score;
}

function bestAlternative(result) {
  const alternatives = [];
  for (let i = 0; i < result.length; i += 1) {
    const alt = result[i];
    alternatives.push({
      transcript: alt.transcript || '',
      confidence: Number.isFinite(alt.confidence) ? alt.confidence : 0,
    });
  }

  alternatives.sort((a, b) =>
    medicalScore(b.transcript, b.confidence) - medicalScore(a.transcript, a.confidence)
  );

  return alternatives[0]?.transcript?.trim() || '';
}

function setNativeInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function findPlanner() {
  return document.querySelector('[data-carm-planner="true"]');
}

function findRequestInput() {
  const panel = findPlanner();
  if (!panel) return null;
  return Array.from(panel.querySelectorAll('input[type="text"], input:not([type])'))[0] || null;
}

function findInterpretButton() {
  const panel = findPlanner();
  if (!panel) return null;
  return Array.from(panel.querySelectorAll('button')).find(
    button => button.textContent?.trim().toUpperCase() === 'INTERPRET'
  ) || null;
}

function pairedAnatomyNeedsSide(text) {
  const lower = text.toLowerCase();
  if (/\b(left|right)\b/.test(lower)) return null;
  return PAIRED_ANATOMY.find(term => new RegExp(`\\b${term}\\b`, 'i').test(lower)) || null;
}

export default function MedicalVoiceSearch() {
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [message, setMessage] = useState('Say an imaging request, then say ENTER.');
  const [error, setError] = useState('');
  const [supported, setSupported] = useState(true);

  const recognitionRef = useRef(null);
  const finalTextRef = useRef('');
  const openRef = useRef(false);
  const submittedRef = useRef(false);
  const startingRef = useRef(false);

  const stopRecognition = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    startingRef.current = false;
    setListening(false);
    if (!recognition) return;
    try { recognition.onend = null; } catch {}
    try { recognition.stop(); } catch {}
  }, []);

  const close = useCallback(() => {
    openRef.current = false;
    submittedRef.current = false;
    stopRecognition();
    setOpen(false);
    setInterim('');
    setError('');
  }, [stopRecognition]);

  const submit = useCallback((rawText) => {
    const normalized = normalizeMedicalRequest(rawText || finalTextRef.current);
    if (!normalized) {
      setError('No request was captured. Speak again.');
      return false;
    }

    const missingSide = pairedAnatomyNeedsSide(normalized);
    if (missingSide) {
      setError(`Include left or right for ${missingSide}. Example: left ${missingSide} AP.`);
      setMessage('Repeat the full request, then say ENTER.');
      return false;
    }

    const input = findRequestInput();
    const interpret = findInterpretButton();
    if (!input || !interpret) {
      setError('The path planner is not ready.');
      return false;
    }

    submittedRef.current = true;
    stopRecognition();
    setNativeInputValue(input, normalized);
    setTranscript(normalized);
    setMessage('Submitting request');

    window.setTimeout(() => {
      interpret.click();
      close();
    }, 120);

    return true;
  }, [close, stopRecognition]);

  const startRecognition = useCallback(() => {
    if (!openRef.current || submittedRef.current || startingRef.current) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSupported(false);
      setListening(false);
      setError('Voice recognition is unavailable in this browser. Use Chrome or Edge, or type the request.');
      return;
    }

    setSupported(true);
    startingRef.current = true;

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 5;

    const englishLanguage = (navigator.languages || [navigator.language || 'en-US'])
      .find(lang => /^en[-_]/i.test(lang));
    recognition.lang = englishLanguage || 'en-US';

    recognition.onstart = () => {
      startingRef.current = false;
      setListening(true);
      setError('');
      setMessage('Listening. Say the request, then say ENTER.');
    };

    recognition.onresult = event => {
      let interimText = '';

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const phrase = result.isFinal
          ? bestAlternative(result)
          : (result[0]?.transcript || '').trim();

        if (!phrase) continue;

        if (!result.isFinal) {
          interimText += `${phrase} `;
          continue;
        }

        const clean = phrase.trim();
        const lower = clean.toLowerCase().replace(/[.!?,]+$/g, '').trim();

        if (/^(cancel|close|stop)$/.test(lower)) {
          close();
          return;
        }

        if (/^(enter|submit|go)$/.test(lower)) {
          submit(finalTextRef.current);
          return;
        }

        const commandMatch = clean.match(/^(.*?)(?:\s+)(enter|submit|go)[.!?,]*$/i);
        if (commandMatch) {
          const beforeCommand = commandMatch[1].trim();
          const combined = [finalTextRef.current, beforeCommand].filter(Boolean).join(' ').trim();
          finalTextRef.current = combined;
          setTranscript(combined);
          setInterim('');
          submit(combined);
          return;
        }

        finalTextRef.current = [finalTextRef.current, clean].filter(Boolean).join(' ').trim();
        setTranscript(finalTextRef.current);
        setError('');
      }

      setInterim(interimText.trim());
    };

    recognition.onerror = event => {
      startingRef.current = false;
      setListening(false);
      if (event.error === 'aborted') return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setError('Microphone permission is blocked. Allow microphone access and try again.');
        return;
      }
      if (event.error === 'no-speech') {
        setMessage('No speech detected. Listening again.');
        return;
      }
      if (event.error === 'phrases-not-supported') {
        setMessage('Listening with standard recognition.');
        return;
      }
      setError(`Voice recognition error: ${event.error || 'unknown'}`);
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      startingRef.current = false;
      setListening(false);
      if (!openRef.current || submittedRef.current) return;
      window.setTimeout(() => {
        if (openRef.current && !submittedRef.current) startRecognition();
      }, 220);
    };

    try {
      recognition.start();
    } catch (err) {
      startingRef.current = false;
      setListening(false);
      setError(err?.message || 'Could not start voice recognition.');
    }
  }, [close, submit]);

  const openVoice = useCallback(() => {
    finalTextRef.current = '';
    submittedRef.current = false;
    openRef.current = true;
    setTranscript('');
    setInterim('');
    setError('');
    setMessage('Say an imaging request, then say ENTER.');
    setOpen(true);
    window.setTimeout(startRecognition, 80);
  }, [startRecognition]);

  useEffect(() => {
    const interceptVoiceButton = event => {
      const target = event.target?.closest?.(`#${VOICE_BUTTON_ID}`);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      openVoice();
    };

    document.addEventListener('click', interceptVoiceButton, true);
    return () => document.removeEventListener('click', interceptVoiceButton, true);
  }, [openVoice]);

  useEffect(() => () => stopRecognition(), [stopRecognition]);

  if (!open) return null;

  const visibleTranscript = [transcript, interim].filter(Boolean).join(' ').trim();

  return (
    <div style={styles.overlay} role="dialog" aria-modal="true" aria-label="Medical voice search">
      <div style={styles.shell}>
        <div style={styles.header}>
          <div>
            <div style={styles.eyebrow}>MEDICAL VOICE INPUT</div>
            <div style={styles.title}>{listening ? 'Listening' : supported ? 'Voice search' : 'Voice unavailable'}</div>
          </div>
          <button type="button" onClick={close} style={styles.close} aria-label="Close voice search">X</button>
        </div>

        <div style={styles.statusLine}>
          <span style={{...styles.statusMark, background:listening ? '#2f5c46' : '#747d81'}} />
          <span>{message}</span>
        </div>

        <div style={styles.transcriptBox}>
          {visibleTranscript
            ? <div style={styles.transcript}>{transcript}<span style={styles.interim}>{interim ? ` ${interim}` : ''}</span></div>
            : <div style={styles.placeholder}>Example: neck AP / left knee lateral</div>}
        </div>

        {error ? <div style={styles.error}>{error}</div> : null}

        <div style={styles.actions}>
          <button
            type="button"
            onClick={() => {
              finalTextRef.current = '';
              setTranscript('');
              setInterim('');
              setError('');
              setMessage('Listening. Say the request, then say ENTER.');
            }}
            style={styles.secondaryButton}
          >
            CLEAR
          </button>
          <button
            type="button"
            onClick={() => submit(visibleTranscript)}
            disabled={!visibleTranscript}
            style={{ ...styles.enterButton, opacity: visibleTranscript ? 1 : .4 }}
          >
            ENTER
          </button>
        </div>

        <div style={styles.footerNote}>
          Standard browser speech recognition / five alternatives / medical vocabulary reranking / manual confirmation available
        </div>
      </div>
    </div>
  );
}

const font = 'Arial, Helvetica, sans-serif';
const styles = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 50000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 24, background: '#555b5d', fontFamily: font,
  },
  shell: {
    width: 620, maxWidth: '94vw', boxSizing: 'border-box', padding: 22, borderRadius: 2,
    background: '#d6d9d7', color: '#1b2226', border: '1px solid #687176', boxShadow: 'none', textAlign: 'left',
  },
  header: {
    display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:16,paddingBottom:14,borderBottom:'2px solid #1b2226',
  },
  close: {
    width: 34, height: 34, borderRadius: 2, border: '1px solid #6f777b', background: '#bbc1be',
    color: '#1b2226', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: font,
  },
  eyebrow: { fontSize: 9, letterSpacing: '.14em', fontWeight: 800, color: '#566166', marginBottom: 6 },
  title: { fontSize: 25, lineHeight: 1.05, fontWeight: 800, color: '#171d20' },
  statusLine: {
    display:'flex',alignItems:'center',gap:8,minHeight:34,borderBottom:'1px solid #91999d',fontSize:12,color:'#3f4a4f',
  },
  statusMark: { width: 8, height: 8, borderRadius: 0, display:'inline-block' },
  transcriptBox: {
    minHeight: 110, padding: '18px 16px', marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
    background: '#c9cdcb', border: '1px solid #838c90', borderRadius: 2, boxShadow: 'none',
  },
  transcript: { fontSize: 24, lineHeight: 1.35, fontWeight: 700, letterSpacing: '-.01em', color: '#20272a' },
  interim: { color: '#697277', fontWeight: 500 },
  placeholder: { fontSize: 15, color: '#5b666b' },
  error: {
    marginTop: 10, padding: '9px 10px', borderRadius: 2, background: '#c3b493',
    border: '1px solid #755a2f', color: '#2d261a', fontSize: 12, fontWeight: 700,
  },
  actions: { display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 8, marginTop: 14 },
  secondaryButton: {
    minHeight: 42, borderRadius: 2, border: '1px solid #6e777b', background: '#bbc1be', color: '#1b2226',
    fontWeight: 800, cursor: 'pointer', boxShadow: 'none', fontFamily: font,
  },
  enterButton: {
    minHeight: 42, borderRadius: 2, border: '1px solid #29383f', background: '#29383f', color: '#e7ecea',
    fontWeight: 800, cursor: 'pointer', boxShadow: 'none', fontFamily: font,
  },
  footerNote: { marginTop: 12, paddingTop:10, borderTop:'1px solid #9aa2a5', fontSize: 9, lineHeight: 1.45, color: '#59656a' },
};
