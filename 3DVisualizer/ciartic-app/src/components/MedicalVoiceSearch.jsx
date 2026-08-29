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
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set;

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
  const [message, setMessage] = useState('Say an imaging request, then say “enter”.');
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
      setError('I did not catch a request yet. Try again.');
      return false;
    }

    const missingSide = pairedAnatomyNeedsSide(normalized);
    if (missingSide) {
      setError(`Please include left or right for ${missingSide}. Example: “left ${missingSide} AP”.`);
      setMessage('Say the full request again, then say “enter”.');
      return false;
    }

    const input = findRequestInput();
    const interpret = findInterpretButton();
    if (!input || !interpret) {
      setError('The path planner is not ready yet.');
      return false;
    }

    submittedRef.current = true;
    stopRecognition();
    setNativeInputValue(input, normalized);
    setTranscript(normalized);
    setMessage('Submitting request…');

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
      setError('Voice search is not supported in this browser. Use Chrome or Edge, or type the request.');
      return;
    }

    setSupported(true);
    startingRef.current = true;
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 5;

    const preferredEnglish = (navigator.languages || [navigator.language || 'en-US'])
      .find(lang => /^en[-_]/i.test(lang));
    recognition.lang = preferredEnglish || 'en-US';

    // Do not set SpeechRecognition.phrases here. Chromium exposes the property
    // on some builds even when contextual phrase biasing is not supported by
    // the active recognition service, which produces a phrases-not-supported
    // error before normal transcription can begin. Medical vocabulary is
    // instead handled safely by alternative reranking + normalization below.

    recognition.onstart = () => {
      startingRef.current = false;
      setListening(true);
      setError('');
      setMessage('Listening… Say the request, then say “enter”.');
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
        setError('');
        setMessage('I did not hear anything. Listening again…');
        return;
      }
      if (event.error === 'network') {
        setError('Speech service could not connect. Check your internet connection and try again.');
        return;
      }
      if (event.error === 'audio-capture') {
        setError('No microphone was detected. Check your microphone and browser input settings.');
        return;
      }
      if (event.error === 'phrases-not-supported') {
        setError('');
        setMessage('Restarting voice recognition without phrase biasing…');
        return;
      }
      setError(`Voice recognition error: ${event.error || 'unknown error'}`);
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      startingRef.current = false;
      setListening(false);
      if (!openRef.current || submittedRef.current) return;
      window.setTimeout(() => {
        if (openRef.current && !submittedRef.current) startRecognition();
      }, 260);
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
    setMessage('Say an imaging request, then say “enter”.');
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
        <button type="button" onClick={close} style={styles.close} aria-label="Close voice search">×</button>

        <div style={styles.eyebrow}>MEDICAL VOICE SEARCH</div>
        <div style={styles.title}>{listening ? 'Listening' : supported ? 'Voice search' : 'Voice unavailable'}</div>
        <div style={styles.subtitle}>{message}</div>

        <div style={{ ...styles.mic, ...(listening ? styles.micLive : {}) }} aria-hidden="true">
          <span style={styles.micGlyph}>●</span>
        </div>

        <div style={styles.transcriptBox}>
          {visibleTranscript
            ? <div style={styles.transcript}>{transcript}<span style={styles.interim}>{interim ? ` ${interim}` : ''}</span></div>
            : <div style={styles.placeholder}>Try “neck AP” or “left knee lateral”</div>}
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
              setMessage('Listening… Say the request, then say “enter”.');
            }}
            style={styles.secondaryButton}
          >
            CLEAR
          </button>
          <button
            type="button"
            onClick={() => submit(visibleTranscript)}
            disabled={!visibleTranscript}
            style={{ ...styles.enterButton, opacity: visibleTranscript ? 1 : .38 }}
          >
            ENTER
          </button>
        </div>

        <div style={styles.footerNote}>
          Medical vocabulary assist · multiple recognition alternatives · request confirmation before planner interpretation
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 50000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 24, background: 'rgba(39,35,31,.50)', backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)', fontFamily: 'Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
  },
  shell: {
    position: 'relative', width: 660, maxWidth: '94vw', minHeight: 470,
    boxSizing: 'border-box', padding: '38px 42px 32px', borderRadius: 34,
    background: 'linear-gradient(145deg,#f8f4ed,#ddd5ca)', color: '#292521',
    border: '1px solid rgba(255,255,255,.82)',
    boxShadow: '24px 24px 56px rgba(57,51,45,.28), -10px -10px 30px rgba(255,255,255,.58), inset 1px 1px 0 rgba(255,255,255,.96)',
    textAlign: 'center',
  },
  close: {
    position: 'absolute', top: 18, right: 20, width: 40, height: 40, borderRadius: 14,
    border: '1px solid rgba(91,81,70,.10)', background: 'linear-gradient(145deg,#f1ebe2,#d7cec2)',
    color: '#39332d', fontSize: 24, lineHeight: 1, cursor: 'pointer',
    boxShadow: '4px 4px 9px rgba(76,68,60,.15), -3px -3px 8px rgba(255,255,255,.72)',
  },
  eyebrow: { fontSize: 10, letterSpacing: 2.2, fontWeight: 900, color: '#786f65', marginBottom: 8 },
  title: { fontSize: 29, lineHeight: 1.1, fontWeight: 900, letterSpacing: '-.035em', color: '#27231f' },
  subtitle: { margin: '10px auto 24px', maxWidth: 470, fontSize: 13, lineHeight: 1.45, color: '#625a52' },
  mic: {
    width: 92, height: 92, margin: '0 auto 24px', borderRadius: '50%', display: 'grid', placeItems: 'center',
    background: 'linear-gradient(145deg,#eee7dc,#cfc5b8)',
    boxShadow: '9px 9px 18px rgba(85,75,65,.20), -7px -7px 17px rgba(255,255,255,.74), inset 1px 1px 0 rgba(255,255,255,.82)',
    transition: 'transform .18s ease, box-shadow .18s ease',
  },
  micLive: {
    transform: 'scale(1.06)',
    boxShadow: '0 0 0 10px rgba(139,119,96,.10), 10px 10px 22px rgba(85,75,65,.22), -8px -8px 20px rgba(255,255,255,.78), inset 1px 1px 0 rgba(255,255,255,.86)',
  },
  micGlyph: { width: 26, height: 26, borderRadius: '50%', background: '#3a342e', color: 'transparent', boxShadow: '0 8px 0 -5px #3a342e' },
  transcriptBox: {
    minHeight: 92, padding: '20px 22px', borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#e9e2d8', border: '1px solid rgba(86,77,68,.09)',
    boxShadow: 'inset 4px 4px 10px rgba(92,82,71,.14), inset -4px -4px 10px rgba(255,255,255,.65)',
  },
  transcript: { fontSize: 24, lineHeight: 1.35, fontWeight: 750, letterSpacing: '-.025em', color: '#2c2824' },
  interim: { color: '#8a8178', fontWeight: 650 },
  placeholder: { fontSize: 17, color: '#8a8178' },
  error: {
    marginTop: 12, padding: '10px 12px', borderRadius: 13, background: 'rgba(180,128,72,.12)',
    border: '1px solid rgba(142,96,51,.14)', color: '#6d4828', fontSize: 12, fontWeight: 750,
  },
  actions: { display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 12, marginTop: 18 },
  secondaryButton: {
    minHeight: 44, borderRadius: 14, border: '1px solid rgba(255,255,255,.66)',
    background: 'linear-gradient(145deg,#f1ebe3,#d7cec2)', color: '#494139', fontWeight: 850, cursor: 'pointer',
    boxShadow: '4px 4px 10px rgba(84,74,64,.16), -3px -3px 9px rgba(255,255,255,.72)',
  },
  enterButton: {
    minHeight: 44, borderRadius: 14, border: '1px solid rgba(255,255,255,.12)',
    background: 'linear-gradient(145deg,#403a34,#25221f)', color: '#faf6ef', fontWeight: 900, cursor: 'pointer',
    boxShadow: '5px 5px 12px rgba(49,43,38,.28), -3px -3px 9px rgba(255,255,255,.42)',
  },
  footerNote: { marginTop: 15, fontSize: 10, lineHeight: 1.45, color: '#7a7168' },
};