import React, { useEffect, useMemo, useRef, useState } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

/*
  PANEG–MoCA supervisado v1.7 (dashboard explicable)
  ------------------------------------------------------------
  Prototipo técnico alineado con las guías MoCA 8.1 y 8.3.
  No sustituye autorización de uso, capacitación/certificación
  ni validación psicométrica de la adaptación digital.

  Para estandarización final coloque los estímulos autorizados en:
    public/stimuli/moca81/{trail.png,cube.png,animal1.png,animal2.png,animal3.png}
    public/stimuli/moca83/{trail.png,bed.png,animal1.png,animal2.png,animal3.png}

  Para audio pregrabado (recomendado), coloque archivos en:
    public/audio/moca81/*.mp3
    public/audio/moca83/*.mp3
  Si un archivo no existe, se usa síntesis de voz del navegador como respaldo.
*/


const publicAsset = (relativePath) => {
  const clean = String(relativePath || '').replace(/^\.?\//, '');
  if (typeof window !== 'undefined' && window.location.hostname.includes('github.io')) {
    return `/web/paneg/${clean}`;
  }
  const viteBase = typeof import.meta !== 'undefined' ? import.meta.env?.BASE_URL : './';
  const base = viteBase && viteBase !== '/' ? viteBase : './';
  return `${base.endsWith('/') ? base : `${base}/`}${clean}`;
};

const firebaseConfig = {
  apiKey: 'AIzaSyBrS7SpfCx2FUs3VohKMZAofdDwheo33aY',
  authDomain: 'paneg-bd.firebaseapp.com',
  projectId: 'paneg-bd',
  storageBucket: 'paneg-bd.firebasestorage.app',
  messagingSenderId: '359193449567',
  appId: '1:359193449567:web:2b7a82b5ceb115e1b677ea',
  measurementId: 'G-1RPEJZ3HFM',
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const appId = 'paneg-bd';
const RESULTS_PATH = ['artifacts', appId, 'data', 'moca_results', 'results'];
const PROTOCOL_PROFILES_PATH = ['artifacts', appId, 'data', 'paneg_protocol', 'profiles'];
const PROTOCOL_EXPOSURE_LOGS_PATH = ['artifacts', appId, 'data', 'paneg_protocol', 'exposure_logs'];
const PROTOCOL_INTERVIEWS_PATH = ['artifacts', appId, 'data', 'paneg_protocol', 'interviews'];
const SETTINGS_DOC_PATH = ['artifacts', appId, 'data', 'settings'];
const DEFAULT_EVALUATOR_PASSWORD = 'paneg2025';
const PASSWORD_HASH_STORAGE_KEY = 'paneg.evaluatorPasswordHash';

const hashText = async (value = '') => {
  const text = String(value);
  if (typeof window !== 'undefined' && window.crypto?.subtle && window.TextEncoder) {
    const encoded = new TextEncoder().encode(text);
    const digest = await window.crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  // Respaldo para navegadores sin Web Crypto. No debe usarse como seguridad fuerte.
  return `plain:${text}`;
};

const getDefaultEvaluatorPasswordHash = () => hashText(DEFAULT_EVALUATOR_PASSWORD);

const getEvaluatorPasswordHash = async () => {
  const localHash = typeof window !== 'undefined' ? window.localStorage.getItem(PASSWORD_HASH_STORAGE_KEY) : '';
  try {
    const snap = await getDoc(doc(db, ...SETTINGS_DOC_PATH));
    const remoteHash = snap.exists() ? snap.data()?.evaluatorPasswordHash : '';
    if (remoteHash) {
      if (typeof window !== 'undefined') window.localStorage.setItem(PASSWORD_HASH_STORAGE_KEY, remoteHash);
      return remoteHash;
    }
  } catch (error) {
    console.warn('No se pudo leer la contraseña remota de investigadores; se usará respaldo local.', error);
  }
  return localHash || getDefaultEvaluatorPasswordHash();
};

const saveEvaluatorPasswordHash = async (passwordHash) => {
  await setDoc(doc(db, ...SETTINGS_DOC_PATH), {
    evaluatorPasswordHash: passwordHash,
    updatedAt: Date.now(),
  }, { merge: true });
  if (typeof window !== 'undefined') window.localStorage.setItem(PASSWORD_HASH_STORAGE_KEY, passwordHash);
};

const LETTER_SEQUENCE = 'FBACMNAAJKLBAFAKDEAAAJAMOFAAB'.split('');
const TARGET_A_COUNT = LETTER_SEQUENCE.filter((letter) => letter === 'A').length;

const VERSION_CONFIG = {
  Pretest: {
    label: 'Pretest',
    version: '8.1',
    theme: 'blue',
    folder: 'moca81',
    copyTitle: 'Cubo',
    copyImage: publicAsset('stimuli/moca81/cube.png'),
    trailImage: publicAsset('stimuli/moca81/trail.png'),
    animalImages: [
      publicAsset('stimuli/moca81/animal1.png'),
      publicAsset('stimuli/moca81/animal2.png'),
      publicAsset('stimuli/moca81/animal3.png'),
    ],
    animalAnswers: [
      ['leon'],
      ['rinoceronte', 'rino'],
      ['camello', 'dromedario'],
    ],
    clockText: '11:10',
    words: ['ROSTRO', 'SEDA', 'TEMPLO', 'CLAVEL', 'ROJO'],
    forwardDigits: ['2', '1', '8', '5', '4'],
    backwardDigits: ['7', '4', '2'],
    backwardExpected: '247',
    serialStart: 100,
    sentences: [
      'Solo sé que le toca a Juan ayudar hoy.',
      'El gato siempre se esconde debajo del sofá cuando hay perros en la habitación.',
    ],
    fluencyLetter: 'F',
    abstractionPairs: [
      ['Tren', 'Bicicleta'],
      ['Regla', 'Reloj'],
    ],
    abstractionAccepted: [
      ['medio de transporte', 'medios de transporte', 'medio de locomocion', 'medios de locomocion', 'para viajar', 'transporte'],
      ['instrumento de medicion', 'instrumentos de medicion', 'para medir', 'medicion'],
    ],
    categoryCues: {
      ROSTRO: 'parte del cuerpo',
      SEDA: 'tipo de tela',
      TEMPLO: 'tipo de edificio',
      CLAVEL: 'tipo de flor',
      ROJO: 'color',
    },
    multipleChoice: {
      ROSTRO: ['nariz', 'rostro', 'mano'],
      SEDA: ['tela vaquera', 'seda', 'algodón'],
      TEMPLO: ['templo', 'escuela', 'hospital'],
      CLAVEL: ['rosa', 'clavel', 'tulipán'],
      ROJO: ['rojo', 'azul', 'verde'],
    },
  },
  Postest: {
    label: 'Postest',
    version: '8.3',
    theme: 'teal',
    folder: 'moca83',
    copyTitle: 'Cama',
    copyImage: publicAsset('stimuli/moca83/bed.png'),
    trailImage: publicAsset('stimuli/moca83/trail.png'),
    animalImages: [
      publicAsset('stimuli/moca83/animal1.png'),
      publicAsset('stimuli/moca83/animal2.png'),
      publicAsset('stimuli/moca83/animal3.png'),
    ],
    animalAnswers: [
      ['caballo', 'poni', 'yegua', 'potro'],
      ['tigre'],
      ['pato'],
    ],
    clockText: '10:05',
    words: ['PIERNA', 'ALGODÓN', 'ESCUELA', 'TOMATE', 'BLANCO'],
    forwardDigits: ['2', '4', '8', '1', '5'],
    backwardDigits: ['4', '2', '7'],
    backwardExpected: '724',
    serialStart: 60,
    sentences: [
      'El niño paseaba a su perro en el parque después de medianoche.',
      'El artista terminó su pintura en el momento exacto para la exhibición.',
    ],
    fluencyLetter: 'B',
    abstractionPairs: [
      ['Martillo', 'Desarmador'],
      ['Cerillos', 'Lámpara'],
    ],
    abstractionAccepted: [
      ['herramienta', 'herramientas', 'carpinteria', 'construccion', 'instrumentos de trabajo', 'instrumento de trabajo'],
      ['luz', 'luminosos', 'iluminacion', 'alumbrado'],
    ],
    categoryCues: {
      PIERNA: 'parte del cuerpo',
      'ALGODÓN': 'tipo de tela',
      ESCUELA: 'edificio público',
      TOMATE: 'tipo de alimento',
      BLANCO: 'color',
    },
    multipleChoice: {
      PIERNA: ['mano', 'pierna', 'cara'],
      'ALGODÓN': ['seda', 'algodón', 'naylon'],
      ESCUELA: ['escuela', 'hospital', 'biblioteca'],
      TOMATE: ['lechuga', 'tomate', 'zanahoria'],
      BLANCO: ['morado', 'blanco', 'verde'],
    },
  },
};

const normalize = (value = '') =>
  String(value)
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zñ0-9\s]/g, '')
    .replace(/\s+/g, ' ');


const toUpper = (value = '') => String(value).toLocaleUpperCase('es-MX');
const digitsOnly = (value = '', maxLength = null) => {
  const clean = String(value || '').replace(/\D/g, '');
  return maxLength ? clean.slice(0, maxLength) : clean;
};
const lettersOnly = (value = '', maxLength = null) => {
  const clean = String(value || '')
    .replace(/[0-9]/g, '')
    .replace(/[^a-zA-ZáéíóúÁÉÍÓÚüÜñÑ\s.,;:¿?¡!()"'\-]/g, '')
    .replace(/\s+/g, ' ');
  const trimmed = maxLength ? clean.slice(0, maxLength) : clean;
  return toUpper(trimmed);
};
const ORIENTATION_CONTEXT = {
  acceptedPlaces: ['UNIVERSIDAD AUTÓNOMA DE NAYARIT', 'UAN', 'UNIDAD ACADÉMICA DE ECONOMÍA', 'UNIDAD ACADÉMICA DE SISTEMAS COMPUTACIONALES'],
  acceptedCities: ['TEPIC', 'TEPIC NAYARIT'],
};
const isAcceptedOrientationText = (value = '', accepted = []) => {
  const current = normalize(value);
  return Boolean(current) && accepted.some((item) => {
    const target = normalize(item);
    return current === target || current.includes(target) || target.includes(current);
  });
};
const MAX_FLUENCY_AUDIO_BYTES = 600000;
const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

const analyzeFluencyTranscript = (transcript = '', targetLetter = '') => {
  const tokens = String(transcript)
    .split(/[\s,.;:!?¡¿()\[\]{}\-_/\\]+/)
    .map((token) => normalize(token))
    .filter(Boolean);
  const seen = new Set();
  const validCandidates = [];
  const repeated = [];
  const wrongInitial = [];
  const tooShort = [];
  const numbers = [];
  const target = normalize(targetLetter);

  tokens.forEach((token) => {
    if (/^\d+$/.test(token)) {
      numbers.push(token);
      return;
    }
    if (token.length < 2) {
      tooShort.push(token);
      return;
    }
    if (!token.startsWith(target)) {
      wrongInitial.push(token);
      return;
    }
    if (seen.has(token)) {
      repeated.push(token);
      return;
    }
    seen.add(token);
    validCandidates.push(token);
  });

  return {
    tokens,
    validCandidates,
    repeated,
    wrongInitial,
    tooShort,
    numbers,
    suggestedPoint: validCandidates.length >= 11 ? 1 : 0,
  };
};

const countExactWords = (responses = [], expected = []) => {
  const remaining = expected.map(normalize);
  let count = 0;
  responses.forEach((response) => {
    const index = remaining.indexOf(normalize(response));
    if (index >= 0) {
      count += 1;
      remaining.splice(index, 1);
    }
  });
  return count;
};

const suggestedNamingScore = (record, config) =>
  (record.naming || []).reduce((sum, response, index) => {
    const valid = (config.animalAnswers[index] || []).map(normalize);
    return sum + (valid.includes(normalize(response)) ? 1 : 0);
  }, 0);

const suggestedRepetitionScore = (record, config) =>
  config.sentences.reduce(
    (sum, sentence, index) =>
      sum + (normalize(record.language?.[`sentence${index + 1}`]) === normalize(sentence) ? 1 : 0),
    0,
  );

const suggestedAbstractionScore = (record, config) =>
  config.abstractionAccepted.reduce((sum, accepted, index) => {
    const answer = normalize(record.abstraction?.[`pair${index + 1}`]);
    const correct = accepted.some((option) => {
      const normalizedOption = normalize(option);
      return answer === normalizedOption || answer.includes(normalizedOption);
    });
    return sum + (correct ? 1 : 0);
  }, 0);

const cleanFirestore = (value) => {
  if (value === undefined) return null;
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(cleanFirestore);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined && typeof item !== 'function')
        .map(([key, item]) => [key, cleanFirestore(item)]),
    );
  }
  return value;
};

const todayParts = () => {
  const now = new Date();
  return {
    day: now.getDate(),
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    weekday: now
      .toLocaleDateString('es-MX', { weekday: 'long' })
      .toLowerCase(),
  };
};

const initialConsent = {
  read: false,
  participate: false,
  audio: false,
  adult: false,
  participantName: '',
  acceptedAt: null,
  version: 'PANEG-CI-1.0',
};

const initialAnswers = (phase, version) => ({
  phase,
  version,
  participant: {
    name: '',
    age: '',
    educationYears: '',
    group: 'Experimental (Uso de IAGen)',
    birthDate: '',
    sex: '',
  },
  consent: { ...initialConsent },
  trail: { drawing: null, pointsAuto: 0 },
  copyDrawing: null,
  clockDrawing: null,
  naming: ['', '', ''],
  memoryTrial1: ['', '', '', '', ''],
  memoryTrial2: ['', '', '', '', ''],
  attention: {
    forward: '',
    backward: '',
    vigilanceHits: 0,
    vigilanceFalseAlarms: 0,
    vigilanceOmissions: TARGET_A_COUNT,
    serial7: ['', '', '', '', ''],
  },
  language: {
    sentence1: '',
    sentence2: '',
    fluencyTranscript: '',
    fluencyWordCountSuggested: 0,
    fluencyAudioDataUrl: '',
    fluencyAudioMime: '',
    fluencyAudioSize: 0,
  },
  abstraction: {
    example: '',
    promptUsed: false,
    pair1: '',
    pair2: '',
  },
  delayedRecall: {
    free: ['', '', '', '', ''],
    category: {},
    multipleChoice: {},
    cuesActivated: false,
    cuesActivatedAt: null,
  },
  orientation: {
    day: '',
    month: '',
    year: '',
    weekday: '',
    place: '',
    city: '',
  },
  administration: {
    supervised: true,
    instructionRepeatCount: {},
    startedAt: null,
    completedAt: null,
    memoryLearningCompletedAt: null,
    delayedRecallStartedAt: null,
    fluencyStartedAt: null,
    fluencyFinishedAt: null,
    fluencyDurationSeconds: null,
    audioMode: 'browser-synthesis-fallback',
  },
});

function PageHeader({ phase, version, progress, theme, onGoHome, onGoEvaluator }) {
  return (
    <header className="fixed left-0 right-0 top-0 z-20 border-b bg-white px-5 py-4 shadow-sm">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4">
        <h1 className="font-black text-slate-900">PANEG · {phase} v{version}</h1>
        <div className="min-w-[160px] flex-1">
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div className={`h-full ${theme === 'blue' ? 'bg-blue-600' : 'bg-teal-600'}`} style={{ width: `${progress}%` }} />
          </div>
        </div>
        <span className="text-xs font-bold">{progress}%</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={onGoHome} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">Tests</button>
          <button type="button" onClick={onGoEvaluator} className="rounded-lg bg-violet-700 px-3 py-2 text-xs font-black text-white hover:bg-violet-800">Investigadores</button>
        </div>
      </div>
    </header>
  );
}

function PageCard({ children }) {
  return <div className="mx-auto w-full max-w-4xl rounded-3xl bg-white p-6 shadow-xl md:p-10">{children}</div>;
}

function NextStepButton({ disabled = false, onClick, children = 'Siguiente', themeClass }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`mt-8 w-full rounded-xl py-4 font-black text-white disabled:opacity-40 ${themeClass}`}>
      {children}
    </button>
  );
}

function TrailDrawingCanvas({ image, value, onChange }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(canvas.clientWidth, 320);
    const height = 420;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#2563eb';
    if (value) {
      const saved = new Image();
      saved.onload = () => ctx.drawImage(saved, 0, 0, width, height);
      saved.src = value;
    }
  }, []);

  const point = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const start = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    canvasRef.current.setPointerCapture?.(event.pointerId);
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = point(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    drawingRef.current = true;
  };
  const move = (event) => {
    if (!drawingRef.current) return;
    event.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = point(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const stop = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    onChange(canvasRef.current.toDataURL('image/png'));
  };
  const clear = () => {
    const canvas = canvasRef.current;
    const ratio = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
    onChange(null);
  };

  return (
    <div>
      <div className="relative mx-auto h-[420px] max-w-2xl overflow-hidden rounded-2xl border-2 border-slate-300 bg-white">
        <img src={image} alt="Plantilla autorizada de alternancia" className="pointer-events-none absolute inset-0 h-full w-full object-contain p-3" />
        <canvas ref={canvasRef} onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onPointerLeave={stop} className="absolute inset-0 h-full w-full touch-none" />
      </div>
      <p className="mt-3 text-sm text-slate-500">Trace una línea continua sobre la plantilla. Puede corregir inmediatamente antes de pasar a la actividad siguiente.</p>
      <button type="button" onClick={clear} className="mt-3 rounded-lg bg-slate-200 px-4 py-2 font-bold text-slate-700">Borrar y reiniciar trazo</button>
    </div>
  );
}

function DrawingCanvas({ value, onChange, label }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(canvas.clientWidth, 320);
    const height = 320;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#0f172a';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    if (value) {
      const image = new Image();
      image.onload = () => ctx.drawImage(image, 0, 0, width, height);
      image.src = value;
    }
  }, []);

  const coordinates = (event) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const source = event.touches?.[0] || event;
    return { x: source.clientX - rect.left, y: source.clientY - rect.top };
  };

  const start = (event) => {
    event.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = coordinates(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    drawingRef.current = true;
  };

  const move = (event) => {
    if (!drawingRef.current) return;
    event.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = coordinates(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stop = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    onChange(canvasRef.current.toDataURL('image/png'));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    onChange(null);
  };

  return (
    <div className="w-full">
      <p className="mb-2 text-sm font-bold text-slate-600">{label}</p>
      <canvas
        ref={canvasRef}
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={stop}
        onMouseLeave={stop}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={stop}
        className="h-80 w-full touch-none rounded-xl border-2 border-slate-300 bg-white shadow-inner"
      />
      <button type="button" onClick={clear} className="mt-2 text-sm font-bold text-red-600">
        Borrar dibujo
      </button>
    </div>
  );
}

function StimulusImage({ src, alt }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex h-48 w-full items-center justify-center rounded-xl border-2 border-dashed border-orange-300 bg-orange-50 p-4 text-center text-sm font-bold text-orange-700">
        Falta instalar el estímulo autorizado: {src}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      className="max-h-56 w-full rounded-xl border border-slate-200 bg-white object-contain p-3"
    />
  );
}

function ScoreInput({ label, max, value, onChange }) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-xl border border-violet-200 bg-violet-50 p-3">
      <span className="font-black text-violet-950">{label} <span className="font-normal text-violet-700">(0–{max})</span></span>
      <input
        type="number"
        min="0"
        max={max}
        className="w-20 rounded-lg border-2 border-violet-200 bg-white p-2 text-center font-black"
        value={value}
        onChange={(event) => onChange(Math.max(0, Math.min(max, Number(event.target.value))))}
      />
    </label>
  );
}

function TrailEvidence({ stimulus, drawing }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded-xl border bg-white p-3">
        <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Plantilla y trazo superpuesto</p>
        <div className="relative h-72 overflow-hidden rounded-lg border bg-white">
          <img src={stimulus} alt="Plantilla de alternancia" className="absolute inset-0 h-full w-full object-contain p-2" />
          {drawing && <img src={drawing} alt="Trazo del participante" className="absolute inset-0 h-full w-full object-fill" />}
        </div>
      </div>
      <div className="rounded-xl border bg-slate-50 p-3 text-sm text-slate-700">
        <p className="font-black">Criterio de evaluación</p>
        <p className="mt-2">Secuencia 1–A–2–B–3–C–4–D–5–E, sin cruces, sin unir E con 1 y con autocorrección inmediata cuando corresponda.</p>
      </div>
    </div>
  );
}

function DrawingEvidence({ stimulus, drawing, stimulusLabel, responseLabel = 'Dibujo del participante' }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded-xl border bg-white p-3">
        <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">{stimulusLabel}</p>
        {stimulus ? <img src={stimulus} alt={stimulusLabel} className="h-64 w-full rounded-lg border bg-white object-contain p-2" /> : <div className="flex h-64 items-center justify-center rounded-lg border bg-slate-50 p-5 text-center text-sm font-bold text-slate-600">La guía no muestra un reloj modelo. El participante debe dibujarlo de memoria con la hora indicada.</div>}
      </div>
      <div className="rounded-xl border bg-white p-3">
        <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">{responseLabel}</p>
        {drawing ? <img src={drawing} alt={responseLabel} className="h-64 w-full rounded-lg border bg-white object-contain" /> : <div className="flex h-64 items-center justify-center text-slate-400">Sin dibujo guardado</div>}
      </div>
    </div>
  );
}

function AudioButton({ src, text, disabled, onceKey, played, onPlayed, label = 'Escuchar estímulo', speechRate = 0.9 }) {
  const [playing, setPlaying] = useState(false);
  const play = async () => {
    if (disabled || playing || played) return;
    setPlaying(true);
    const finish = () => {
      setPlaying(false);
      onPlayed?.(onceKey);
    };

    try {
      if (src) {
        const audio = new Audio(src);
        audio.onended = finish;
        audio.onerror = () => {
          if (!('speechSynthesis' in window)) throw new Error('Audio no disponible');
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = 'es-MX';
          utterance.rate = speechRate;
          utterance.onend = finish;
          utterance.onerror = finish;
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utterance);
        };
        await audio.play();
      } else if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'es-MX';
        utterance.rate = speechRate;
        utterance.onend = finish;
        utterance.onerror = finish;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      } else {
        finish();
        alert('Este navegador no dispone de reproducción de voz. Instale los archivos de audio pregrabados.');
      }
    } catch (error) {
      console.error(error);
      finish();
    }
  };

  return (
    <button
      type="button"
      onClick={play}
      disabled={disabled || playing || played}
      className="rounded-xl bg-indigo-600 px-5 py-3 font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      {playing ? 'Reproduciendo…' : played ? 'Estímulo reproducido' : label}
    </button>
  );
}

function Countdown({ active, seconds, onFinish }) {
  const [remaining, setRemaining] = useState(seconds);
  useEffect(() => setRemaining(seconds), [seconds, active]);
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => {
      setRemaining((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          onFinish?.();
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [active, onFinish]);
  return <span className="text-4xl font-black tabular-nums text-slate-800">{remaining}s</span>;
}

const consentText = {
  title: 'Consentimiento informado para participar en el estudio',
  body: [
    ['Responsable e institución', 'La investigación es conducida por el Dr. Oscar Gabriel Vizcaino Monroy, de la Universidad Autónoma de Nayarit.'],
    ['Objetivo del estudio', 'El propósito de esta investigación es analizar cómo el uso de herramientas de inteligencia artificial generativa puede influir en el desempeño de estudiantes universitarios en diversas tareas académicas.'],
    ['Población participante', 'Este estudio está dirigido exclusivamente a personas adultas de 18 años o más. No participarán menores de edad.'],
    ['Actividades y duración', 'Se le solicitará responder una evaluación cognitiva que incluye actividades de escucha, respuesta verbal, identificación de imágenes, cálculo y dibujo. La duración estimada es de 10 a 20 minutos.'],
    ['Participación voluntaria', 'Su participación es completamente voluntaria. Puede retirarse en cualquier momento, solicitar una pausa o decidir no responder alguna actividad, sin sanción ni consecuencia académica, laboral o personal.'],
    ['Confidencialidad y anonimato', 'La información será identificada mediante un folio y utilizada únicamente con fines académicos y de investigación. Los resultados se comunicarán de manera agrupada procurando que ninguna persona sea identificada.'],
    ['Riesgos y beneficios', 'No se anticipan riesgos físicos significativos. Algunas actividades pueden generar cansancio, frustración o incomodidad leve. No se garantiza un beneficio directo; los resultados pueden contribuir al conocimiento sobre inteligencia artificial y educación.'],
    ['Grabación de voz', 'Algunas respuestas pueden grabarse únicamente si usted lo autoriza por separado. La grabación se utilizará para revisar y puntuar las tareas y no se compartirá fuera del equipo autorizado.'],
    ['Conservación de datos', 'Los datos y, cuando corresponda, las grabaciones autorizadas se conservarán durante un año a partir de su recolección. Después serán eliminados o anonimizados conforme al protocolo de investigación y las disposiciones institucionales aplicables.'],
    ['Contacto', 'Para dudas sobre el estudio, su participación o el tratamiento de sus datos, puede comunicarse con el Dr. Oscar Gabriel Vizcaino Monroy al correo oscar.vizcaino@uan.edu.mx o al teléfono 311-110-51-49.'],
  ],
};


function ScoringGuide({ title = "Cómo calificar según la guía", children }) {
  return (
    <details className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
      <summary className="cursor-pointer font-black text-slate-900">{title}</summary>
      <div className="mt-3 space-y-2 leading-relaxed">{children}</div>
    </details>
  );
}

const clampScore = (value, min = 0, max = 30) => Math.max(min, Math.min(max, Number(value || 0)));

const classifyTotal = (total, complete = true) => {
  if (!complete || total === null || total === undefined || Number.isNaN(Number(total))) {
    return {
      label: 'Datos insuficientes',
      tone: 'slate',
      short: 'Aún no hay puntaje final revisado.',
      action: 'Complete y guarde la revisión profesional para generar la interpretación.',
    };
  }
  const score = Number(total);
  if (score >= 26) {
    return {
      label: 'Rango esperado',
      tone: 'green',
      short: 'El puntaje global se ubica por arriba del punto de referencia general del MoCA.',
      action: 'Mantener interpretación como tamizaje y revisar la distribución por dominios.',
    };
  }
  if (score >= 23) {
    return {
      label: 'Resultado limítrofe',
      tone: 'amber',
      short: 'El puntaje global se ubica cerca del punto de referencia y requiere revisión cuidadosa.',
      action: 'Verifique errores por dominio, condiciones de aplicación, escolaridad y necesidad de valoración profesional.',
    };
  }
  return {
    label: 'Posible alteración cognitiva',
    tone: 'red',
    short: 'El puntaje global es compatible con una alerta de tamizaje cognitivo.',
    action: 'No emitir diagnóstico desde PANEG; derivar a interpretación clínica/profesional y revisar evidencias.',
  };
};

const toneClasses = {
  green: 'border-green-200 bg-green-50 text-green-900',
  amber: 'border-amber-200 bg-amber-50 text-amber-900',
  red: 'border-red-200 bg-red-50 text-red-900',
  slate: 'border-slate-200 bg-slate-50 text-slate-800',
};

const attentionBreakdown = (record, currentCfg) => {
  const forward = normalize(record?.attention?.forward).replace(/\s/g, '');
  const backward = normalize(record?.attention?.backward).replace(/\s/g, '');
  const forwardPoint = forward === currentCfg.forwardDigits.join('') ? 1 : 0;
  const backwardPoint = backward === currentCfg.backwardExpected ? 1 : 0;
  const vigilanceErrors = Number(record?.attention?.vigilanceFalseAlarms || 0) + Number(record?.attention?.vigilanceOmissions || 0);
  const vigilancePoint = vigilanceErrors <= 1 ? 1 : 0;
  let serialCorrect = 0;
  let previous = currentCfg.serialStart;
  (record?.attention?.serial7 || []).forEach((raw) => {
    const value = Number(raw);
    if (Number.isFinite(value) && value === previous - 7) serialCorrect += 1;
    if (Number.isFinite(value)) previous = value;
  });
  const serialPoints = serialCorrect >= 4 ? 3 : serialCorrect >= 2 ? 2 : serialCorrect === 1 ? 1 : 0;
  return {
    forwardPoint,
    backwardPoint,
    vigilancePoint,
    serialCorrect,
    serialPoints,
    vigilanceErrors,
    total: forwardPoint + backwardPoint + vigilancePoint + serialPoints,
  };
};


// Funciones globales usadas por el tablero inferior.
// Antes estaban dentro del componente App; por eso el botón "Abrir detalle"
// podía dejar la pantalla en blanco al intentar llamar scoreObjective/buildFinalScore
// desde componentes definidos fuera de App.
const scoreObjective = (record = {}) => {
  const currentCfg = Object.values(VERSION_CONFIG).find((item) => item.version === record?.version) || VERSION_CONFIG.Pretest;
  const attention = attentionBreakdown(record, currentCfg);

  const freeNormalized = (record?.delayedRecall?.free || []).map(normalize);
  const freeCorrect = currentCfg.words.filter((word) => freeNormalized.includes(normalize(word))).length;
  let categoryCorrect = 0;
  let choiceCorrect = 0;
  currentCfg.words.forEach((word) => {
    if (freeNormalized.includes(normalize(word))) return;
    if (normalize(record?.delayedRecall?.category?.[word]) === normalize(word)) categoryCorrect += 1;
    else if (normalize(record?.delayedRecall?.multipleChoice?.[word]) === normalize(word)) choiceCorrect += 1;
  });
  const mis = freeCorrect * 3 + categoryCorrect * 2 + choiceCorrect;

  const today = todayParts();
  const orientation = [
    Number(record?.orientation?.day) === today.day,
    Number(record?.orientation?.month) === today.month,
    Number(record?.orientation?.year) === today.year,
    normalize(record?.orientation?.weekday) === normalize(today.weekday),
    Boolean(record?.orientation?.place?.trim?.()),
    Boolean(record?.orientation?.city?.trim?.()),
  ].filter(Boolean).length;

  return { attention: attention.total, freeRecall: freeCorrect, mis, orientation };
};

const buildFinalScore = (record = {}) => {
  const objective = scoreObjective(record);
  const manualScores = record?.manualScores || {};
  const manualTotal = ['trail', 'copy', 'clock', 'naming', 'repetition', 'fluency', 'abstraction']
    .reduce((sum, key) => sum + Number(manualScores[key] || 0), 0);
  const base = manualTotal + objective.attention + objective.freeRecall + objective.orientation;
  const educationAdjustment = Number(record?.participant?.educationYears) <= 12 ? 1 : 0;
  return {
    objective,
    base,
    educationAdjustment,
    total: Math.min(30, base + educationAdjustment),
    complete: Boolean(record?.evaluatorReviewed),
  };
};

const buildDomainScores = (manualScores = {}, objective = {}) => {
  const manual = {
    trail: clampScore(manualScores.trail, 0, 1),
    copy: clampScore(manualScores.copy, 0, 1),
    clock: clampScore(manualScores.clock, 0, 3),
    naming: clampScore(manualScores.naming, 0, 3),
    repetition: clampScore(manualScores.repetition, 0, 2),
    fluency: clampScore(manualScores.fluency, 0, 1),
    abstraction: clampScore(manualScores.abstraction, 0, 2),
  };
  return [
    { key: 'visuospatial', label: 'Visuoespacial / ejecutiva', score: manual.trail + manual.copy + manual.clock, max: 5 },
    { key: 'naming', label: 'Denominación', score: manual.naming, max: 3 },
    { key: 'attention', label: 'Atención', score: clampScore(objective.attention, 0, 6), max: 6 },
    { key: 'language', label: 'Lenguaje', score: manual.repetition + manual.fluency, max: 3 },
    { key: 'abstraction', label: 'Abstracción', score: manual.abstraction, max: 2 },
    { key: 'memory', label: 'Recuerdo diferido', score: clampScore(objective.freeRecall, 0, 5), max: 5 },
    { key: 'orientation', label: 'Orientación', score: clampScore(objective.orientation, 0, 6), max: 6 },
  ];
};

const buildItemEvidence = (record, manualScores = {}, currentCfg) => {
  const attention = attentionBreakdown(record, currentCfg);
  const fluency = analyzeFluencyTranscript(record?.language?.fluencyTranscript || '', currentCfg.fluencyLetter);
  return [
    { label: 'Alternancia', score: clampScore(manualScores.trail, 0, 1), max: 1, detail: 'Secuencia y cruces' },
    { label: currentCfg.copyTitle, score: clampScore(manualScores.copy, 0, 1), max: 1, detail: 'Copia visuoconstructiva' },
    { label: 'Reloj', score: clampScore(manualScores.clock, 0, 3), max: 3, detail: `Hora ${currentCfg.clockText}` },
    { label: 'Denominación', score: clampScore(manualScores.naming, 0, 3), max: 3, detail: 'Animales' },
    { label: 'Dígitos directos', score: attention.forwardPoint, max: 1, detail: (record?.attention?.forward || '—') },
    { label: 'Dígitos inversos', score: attention.backwardPoint, max: 1, detail: (record?.attention?.backward || '—') },
    { label: 'Vigilancia A', score: attention.vigilancePoint, max: 1, detail: `${attention.vigilanceErrors} error(es)` },
    { label: 'Restas seriadas', score: attention.serialPoints, max: 3, detail: `${attention.serialCorrect} resta(s) correcta(s)` },
    { label: 'Repetición', score: clampScore(manualScores.repetition, 0, 2), max: 2, detail: 'Frases' },
    { label: `Fluidez ${currentCfg.fluencyLetter}`, score: clampScore(manualScores.fluency, 0, 1), max: 1, detail: `${fluency.validCandidates.length} candidatas` },
    { label: 'Abstracción', score: clampScore(manualScores.abstraction, 0, 2), max: 2, detail: 'Categorías' },
    { label: 'Recuerdo libre', score: clampScore(record?.objectiveScores?.freeRecall ?? 0, 0, 5), max: 5, detail: 'Sin pistas' },
    { label: 'Orientación', score: clampScore(record?.objectiveScores?.orientation ?? 0, 0, 6), max: 6, detail: 'Fecha/lugar' },
  ];
};

const findPairedRecord = (records = [], selected) => {
  if (!selected) return null;
  const selectedName = normalize(selected.participant?.name || selected.consent?.participantName || '');
  return records.find((record) => {
    const recordName = normalize(record.participant?.name || record.consent?.participantName || '');
    return record.id !== selected.id && selectedName && recordName === selectedName && record.phase !== selected.phase;
  }) || null;
};

const getStoredFinalTotal = (record) => (record?.finalScore?.complete ? Number(record.finalScore.total) : null);

const buildPrePostComparison = (selected, selectedFinal, pairedRecord) => {
  const selectedTotal = Number(selectedFinal?.total ?? 0);
  const pairedTotal = getStoredFinalTotal(pairedRecord);
  const preTotal = selected?.phase === 'Pretest' ? selectedTotal : pairedTotal;
  const postTotal = selected?.phase === 'Postest' ? selectedTotal : pairedTotal;
  const delta = preTotal !== null && preTotal !== undefined && postTotal !== null && postTotal !== undefined ? postTotal - preTotal : null;
  return { preTotal, postTotal, delta, pairedRecord, pairedReviewed: pairedTotal !== null };
};

const buildInterpretation = (finalScore, domains, comparison) => {
  const classification = classifyTotal(finalScore?.total, true);
  const lowDomains = domains.filter((domain) => domain.max && domain.score / domain.max < 0.75);
  const strongDomains = domains.filter((domain) => domain.max && domain.score / domain.max >= 0.9);
  const trend = comparison?.delta === null
    ? 'Aún no hay una comparación pretest-postest revisada para este participante.'
    : comparison.delta > 0
      ? `Se observa incremento global de +${comparison.delta} punto(s) entre pretest y postest.`
      : comparison.delta < 0
        ? `Se observa disminución global de ${comparison.delta} punto(s) entre pretest y postest.`
        : 'El puntaje global se mantiene estable entre pretest y postest.';
  return {
    classification,
    trend,
    strengths: strongDomains.map((domain) => `${domain.label} (${domain.score}/${domain.max})`),
    alerts: lowDomains.map((domain) => `${domain.label} (${domain.score}/${domain.max})`),
    narrative: `${classification.short} ${trend}`,
    recommendation: `${classification.action} Este texto es orientativo, no diagnóstico, y debe ser validado por el evaluador responsable.`,
  };
};

const downloadEvaluatorReport = ({ record, finalScore, domains, interpretation, comparison }) => {
  const safeName = normalize(record?.participant?.name || 'participante').replace(/\s+/g, '_') || 'participante';
  const lines = [
    'PANEG - Reporte de revisión cognitiva',
    '=====================================',
    `Participante: ${record?.participant?.name || 'Sin nombre'}`,
    `Fase: ${record?.phase} · MoCA ${record?.version}`,
    `Fecha de revisión: ${new Date().toLocaleString('es-MX')}`,
    '',
    `Puntaje base: ${finalScore.base}/30`,
    `Ajuste por escolaridad: +${finalScore.educationAdjustment}`,
    `Total: ${finalScore.total}/30`,
    `Clasificación orientativa: ${interpretation.classification.label}`,
    `Pretest: ${comparison.preTotal ?? 'Sin dato'} · Postest: ${comparison.postTotal ?? 'Sin dato'} · Cambio: ${comparison.delta ?? 'Sin dato'}`,
    '',
    'Dominios:',
    ...domains.map((domain) => `- ${domain.label}: ${domain.score}/${domain.max}`),
    '',
    'Análisis automático orientativo:',
    interpretation.narrative,
    interpretation.recommendation,
    '',
    'Nota: PANEG es un apoyo de tamizaje/revisión para investigación. No sustituye diagnóstico clínico ni interpretación profesional.',
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `PANEG_reporte_${safeName}_${record?.phase || 'fase'}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

function MetricCard({ label, value, note, className = '' }) {
  return (
    <div className={`rounded-2xl border bg-white p-4 shadow-sm ${className}`}>
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 break-words text-2xl font-black leading-tight text-slate-900">{value}</p>
      {note && <p className="mt-1 text-xs font-bold text-slate-500">{note}</p>}
    </div>
  );
}

function DomainBars({ domains }) {
  return (
    <div className="space-y-3">
      {domains.map((domain) => {
        const pct = domain.max ? Math.round((domain.score / domain.max) * 100) : 0;
        return (
          <div key={domain.key}>
            <div className="mb-1 flex items-center justify-between text-xs font-bold text-slate-600">
              <span>{domain.label}</span><span>{domain.score}/{domain.max}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DomainRadarChart({ domains }) {
  const size = 260;
  const center = size / 2;
  const radius = 86;
  const axisPoints = domains.map((domain, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / domains.length;
    const ratio = domain.max ? domain.score / domain.max : 0;
    return {
      ...domain,
      x: center + Math.cos(angle) * radius * ratio,
      y: center + Math.sin(angle) * radius * ratio,
      axisX: center + Math.cos(angle) * radius,
      axisY: center + Math.sin(angle) * radius,
      labelX: center + Math.cos(angle) * (radius + 25),
      labelY: center + Math.sin(angle) * (radius + 25),
    };
  });
  const polygon = axisPoints.map((point) => `${point.x},${point.y}`).join(' ');
  const gridPolygon = axisPoints.map((point) => `${point.axisX},${point.axisY}`).join(' ');
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-72 w-full max-w-xs">
      <polygon points={gridPolygon} fill="none" stroke="#cbd5e1" strokeWidth="1.5" />
      {axisPoints.map((point) => <line key={point.key} x1={center} y1={center} x2={point.axisX} y2={point.axisY} stroke="#e2e8f0" />)}
      <polygon points={polygon} fill="rgba(37, 99, 235, 0.22)" stroke="#2563eb" strokeWidth="3" />
      {axisPoints.map((point) => <circle key={`${point.key}-dot`} cx={point.x} cy={point.y} r="4" fill="#2563eb" />)}
      {axisPoints.map((point) => (
        <text key={`${point.key}-label`} x={point.labelX} y={point.labelY} textAnchor="middle" dominantBaseline="middle" fontSize="9" fontWeight="700" fill="#475569">
          {point.label.split(' ')[0]}
        </text>
      ))}
    </svg>
  );
}

function EvolutionChart({ comparison }) {
  const pre = comparison.preTotal;
  const post = comparison.postTotal;
  if (pre === null || pre === undefined || post === null || post === undefined) {
    return <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm font-bold text-slate-600">Comparación pendiente: se requiere pretest y postest revisados para el mismo participante.</div>;
  }
  const deltaText = comparison.delta > 0 ? `+${comparison.delta}` : `${comparison.delta}`;
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="grid gap-3">
        {[['Pretest', pre], ['Postest', post]].map(([label, value]) => (
          <div key={label}>
            <div className="mb-1 flex justify-between text-xs font-bold text-slate-600"><span>{label}</span><span>{value}/30</span></div>
            <div className="h-4 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-teal-600" style={{ width: `${Math.round((Number(value) / 30) * 100)}%` }} /></div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-center text-sm font-black text-slate-800">Cambio pre-post: {deltaText} punto(s)</p>
    </div>
  );
}

function DomainComparisonTable({ currentDomains, pairedDomains, selectedPhase }) {
  if (!pairedDomains?.length) return null;
  const pairedByKey = Object.fromEntries(pairedDomains.map((domain) => [domain.key, domain]));
  return (
    <div className="overflow-hidden rounded-xl border bg-white">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-100"><tr><th className="p-2">Dominio</th><th>Pretest</th><th>Postest</th><th>Cambio</th></tr></thead>
        <tbody>{currentDomains.map((current) => {
          const paired = pairedByKey[current.key];
          const pre = selectedPhase === 'Pretest' ? current : paired;
          const post = selectedPhase === 'Postest' ? current : paired;
          if (!pre || !post) return null;
          const delta = post.score - pre.score;
          return <tr key={current.key} className="border-t"><td className="p-2 font-bold">{current.label}</td><td>{pre.score}/{pre.max}</td><td>{post.score}/{post.max}</td><td className={delta < 0 ? 'font-black text-red-700' : delta > 0 ? 'font-black text-green-700' : 'font-black text-slate-600'}>{delta > 0 ? `+${delta}` : delta}</td></tr>;
        })}</tbody>
      </table>
    </div>
  );
}

function ItemHeatmap({ items }) {
  const itemClass = (item) => {
    const ratio = item.max ? item.score / item.max : 0;
    if (ratio >= 1) return 'border-green-200 bg-green-50 text-green-900';
    if (ratio > 0) return 'border-amber-200 bg-amber-50 text-amber-900';
    return 'border-red-200 bg-red-50 text-red-900';
  };
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className={`rounded-xl border p-3 text-xs ${itemClass(item)}`}>
          <div className="flex justify-between gap-2"><strong>{item.label}</strong><span>{item.score}/{item.max}</span></div>
          <p className="mt-1 opacity-80">{item.detail}</p>
        </div>
      ))}
    </div>
  );
}


const getParticipantDisplayName = (record) => record?.participant?.name || record?.consent?.participantName || 'Sin nombre';

const getManualScoresForRecord = (record, currentCfg) => record?.manualScores || {
  trail: 0,
  copy: 0,
  clock: 0,
  naming: suggestedNamingScore(record, currentCfg),
  repetition: suggestedRepetitionScore(record, currentCfg),
  fluency: 0,
  abstraction: suggestedAbstractionScore(record, currentCfg),
};

const buildAnalysisDataForRecord = (record, records = [], manualOverride = null) => {
  if (!record) return null;
  const selectedCfg = Object.values(VERSION_CONFIG).find((item) => item.version === record.version) || VERSION_CONFIG.Pretest;
  const activeManual = manualOverride || getManualScoresForRecord(record, selectedCfg);
  const objective = scoreObjective(record);
  const finalScore = buildFinalScore({ ...record, manualScores: activeManual, evaluatorReviewed: true });
  const domains = buildDomainScores(activeManual, objective);
  const pairedRecord = findPairedRecord(records, record);
  const pairedCfg = pairedRecord ? (Object.values(VERSION_CONFIG).find((item) => item.version === pairedRecord.version) || selectedCfg) : selectedCfg;
  const pairedManual = pairedRecord ? getManualScoresForRecord(pairedRecord, pairedCfg) : null;
  const pairedObjective = pairedRecord ? scoreObjective(pairedRecord) : null;
  const pairedDomains = pairedRecord && pairedObjective ? buildDomainScores(pairedManual, pairedObjective) : [];
  const comparison = buildPrePostComparison(record, finalScore, pairedRecord);
  const interpretation = buildInterpretation(finalScore, domains, comparison);
  const itemEvidence = buildItemEvidence({ ...record, objectiveScores: objective }, activeManual, selectedCfg);
  return { selectedCfg, objective, finalScore, domains, pairedRecord, pairedDomains, comparison, interpretation, itemEvidence };
};

const latestByCreatedAt = (records = []) => [...records].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0] || null;

const buildParticipantSummaries = (records = []) => {
  const groups = new Map();
  records.forEach((record) => {
    const name = getParticipantDisplayName(record);
    const key = normalize(name) || record.id;
    if (!groups.has(key)) groups.set(key, { key, name, records: [] });
    const group = groups.get(key);
    group.name = group.name || name;
    group.records.push(record);
  });
  return Array.from(groups.values()).map((group) => {
    const preRecords = group.records.filter((record) => record.phase === 'Pretest');
    const postRecords = group.records.filter((record) => record.phase === 'Postest');
    const pre = latestByCreatedAt(preRecords);
    const post = latestByCreatedAt(postRecords);
    const latest = latestByCreatedAt(group.records);
    const preTotal = getStoredFinalTotal(pre);
    const postTotal = getStoredFinalTotal(post);
    const latestTotal = getStoredFinalTotal(latest);
    const delta = preTotal !== null && postTotal !== null ? postTotal - preTotal : null;
    const classification = classifyTotal(latestTotal, latestTotal !== null);
    return { ...group, pre, post, latest, preTotal, postTotal, latestTotal, delta, classification };
  }).sort((a, b) => a.name.localeCompare(b.name, 'es'));
};


function ProtocolCompliancePanel({ results }) {
  const summaries = buildParticipantSummaries(results);
  const reviewed = results.filter((record) => record.finalScore?.complete).length;
  const experimental = summaries.filter((item) => String(item.latest?.participant?.group || '').includes('Experimental')).length;
  const control = summaries.filter((item) => String(item.latest?.participant?.group || '').includes('Control')).length;
  const paired = summaries.filter((item) => item.pre && item.post).length;
  const pairedReviewed = summaries.filter((item) => item.preTotal !== null && item.postTotal !== null).length;
  const missingPost = summaries.filter((item) => item.pre && !item.post).length;
  const exportProtocolCsv = () => {
    const header = ['id','participante','fase','version_moca','grupo','edad','escolaridad','sexo','fecha_nacimiento','total_final','atencion','memoria_libre','mis','orientacion','fecha_creacion'];
    const rows = results.map((record) => {
      const score = record.finalScore || {};
      const obj = record.objectiveScores || score.objective || {};
      return [
        record.id,
        record.participant?.name || '',
        record.phase || '',
        record.version || '',
        record.participant?.group || '',
        record.participant?.age || '',
        record.participant?.educationYears || '',
        record.participant?.sex || '',
        record.participant?.birthDate || '',
        score.total ?? '',
        obj.attention ?? '',
        obj.freeRecall ?? '',
        obj.mis ?? '',
        obj.orientation ?? '',
        record.createdAt ? new Date(record.createdAt).toISOString() : '',
      ];
    });
    const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((row) => row.map(escape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `PANEG_datos_moca_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="mb-6 rounded-3xl border border-violet-200 bg-white p-5 shadow-xl">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-violet-700">Control del protocolo PANEG</p>
          <h2 className="text-2xl font-black text-slate-900">Indicadores metodológicos del estudio</h2>
          <p className="mt-1 text-sm text-slate-500">Seguimiento digital del diseño pretest–postest, grupo control/experimental, revisión profesional y exportación para SPSS, R o Python.</p>
        </div>
        <button type="button" onClick={exportProtocolCsv} className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-black text-white">Exportar CSV MoCA</button>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="Participantes" value={summaries.length} note="Nombres únicos" />
        <MetricCard label="Experimental" value={experimental} note="Uso de IAGen" />
        <MetricCard label="Control" value={control} note="Actividad neutra" />
        <MetricCard label="Pares pre-post" value={paired} note="Con ambas fases" />
        <MetricCard label="Pares revisados" value={pairedReviewed} note="Listos para análisis" />
        <MetricCard label="Sin postest" value={missingPost} note={`${reviewed} registros revisados`} className={missingPost ? toneClasses.amber : toneClasses.green} />
      </div>
    </section>
  );
}


const PROTOCOL_TOOL_OPTIONS = ['ChatGPT', 'Claude', 'Gemini', 'Copilot', 'Perplexity', 'DALL-E / imagen', 'Otra'];
const PROTOCOL_TASK_OPTIONS = ['Búsqueda y síntesis', 'Redacción', 'Programación', 'Análisis de datos', 'Diseño didáctico', 'Resolución de problemas', 'Creatividad / lluvia de ideas', 'Otra'];
const PROTOCOL_FREQUENCY_OPTIONS = ['Nunca', 'Menos de una vez por semana', '1-2 días por semana', '3-4 días por semana', '5 o más días por semana', 'Diario'];
const PROTOCOL_TECH_USE_OPTIONS = ['Bajo', 'Medio', 'Alto', 'Muy alto'];
const PROTOCOL_ASSIGNED_DURATIONS = ['30', '45'];

const defaultProtocolProfile = {
  participantName: '', participantCode: '', group: 'Experimental (Uso de IAGen)', age: '', sex: '', educationYears: '',
  adult18: false, basicEducation: false, internetAccess: false, informedConsent: false,
  noModerateSevereCognitiveDx: false, noUncontrolledNeuroPsych: false, canComplyExposure: false,
  priorIAExperience: 'Ninguna', technologyUseFrequency: '', digitalHabits: '', chatgptFamiliarity: '1', toolsUsed: [], tasksIA: [],
  baselinePerception: '', selfEfficacyIA: '1', privacyConcern: '1', notes: '', matchedPairId: '',
};

const defaultExposureLog = {
  participantName: '', participantCode: '', group: 'Experimental (Uso de IAGen)', date: '', week: '1', sessionNumber: '1',
  assignedDuration: '30', actualDurationMinutes: '', frequencyThisWeek: '', toolName: 'ChatGPT', toolType: 'Texto',
  activityType: 'Búsqueda y síntesis', completed: 'Sí', selfReport: '', evidenceNote: '', observations: '',
};

const defaultInterview = {
  participantName: '', participantCode: '', date: '', phase: 'Postest', interviewer: '', transcript: '', codes: '', categories: '', analyticNotes: '',
};

const protocolKey = (record = {}) => normalize(record.participantCode || record.participantName || record.name || record.participant?.name || record.consent?.participantName || '');

const profileEligible = (profile = {}) => Boolean(
  profile.adult18 && profile.basicEducation && profile.internetAccess && profile.informedConsent &&
  profile.noModerateSevereCognitiveDx && profile.noUncontrolledNeuroPsych && profile.canComplyExposure
);

const splitList = (value = '') => String(value || '').split(/[;,\n]/).map((item) => item.trim()).filter(Boolean);
const csvEscape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const downloadCsv = (filename, header, rows) => {
  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const summarizeExposureForKey = (logs = [], key = '') => {
  const filtered = logs.filter((item) => protocolKey(item) === key);
  const totalMinutes = filtered.reduce((sum, item) => sum + Number(item.actualDurationMinutes || 0), 0);
  const assignedTotal = filtered.reduce((sum, item) => sum + Number(item.assignedDuration || 0), 0);
  const completed = filtered.filter((item) => item.completed === 'Sí').length;
  const partial = filtered.filter((item) => item.completed === 'Parcial').length;
  const compliancePct = assignedTotal ? Math.round((totalMinutes / assignedTotal) * 100) : '';
  const tools = Array.from(new Set(filtered.map((item) => item.toolName).filter(Boolean))).join('; ');
  const tasks = Array.from(new Set(filtered.map((item) => item.activityType).filter(Boolean))).join('; ');
  return { sessions: filtered.length, totalMinutes, assignedTotal, averageMinutes: filtered.length ? Math.round(totalMinutes / filtered.length) : '', completed, partial, compliancePct, tools, tasks };
};

const domainScore = (record, key) => {
  const item = (record?.domainScores || []).find((domain) => domain.key === key);
  return item ? Number(item.score) : '';
};

const buildProtocolTriangulationRows = ({ results = [], profiles = [], exposureLogs = [], interviews = [] }) => {
  const summaries = buildParticipantSummaries(results);
  const keys = new Map();
  summaries.forEach((item) => keys.set(normalize(item.name), { key: normalize(item.name), name: item.name, summary: item }));
  profiles.forEach((item) => {
    const key = protocolKey(item);
    if (!key) return;
    keys.set(key, { ...(keys.get(key) || { key, name: item.participantName || item.participantCode }), profile: item, name: item.participantName || keys.get(key)?.name || item.participantCode });
  });
  exposureLogs.forEach((item) => {
    const key = protocolKey(item);
    if (!key) return;
    keys.set(key, { ...(keys.get(key) || { key, name: item.participantName || item.participantCode }), name: item.participantName || keys.get(key)?.name || item.participantCode });
  });
  interviews.forEach((item) => {
    const key = protocolKey(item);
    if (!key) return;
    keys.set(key, { ...(keys.get(key) || { key, name: item.participantName || item.participantCode }), name: item.participantName || keys.get(key)?.name || item.participantCode });
  });
  return Array.from(keys.values()).map((entry) => {
    const key = entry.key;
    const profile = entry.profile || profiles.find((item) => protocolKey(item) === key) || {};
    const summary = entry.summary || summaries.find((item) => normalize(item.name) === key) || {};
    const exposure = summarizeExposureForKey(exposureLogs, key);
    const personInterviews = interviews.filter((item) => protocolKey(item) === key);
    const categories = Array.from(new Set(personInterviews.flatMap((item) => splitList(item.categories)))).join('; ');
    const codes = Array.from(new Set(personInterviews.flatMap((item) => splitList(item.codes)))).join('; ');
    const pre = summary.pre || null;
    const post = summary.post || null;
    return {
      key,
      participantName: entry.name || profile.participantName || summary.name || '',
      group: profile.group || summary.latest?.participant?.group || '',
      age: profile.age || summary.latest?.participant?.age || '',
      sex: profile.sex || summary.latest?.participant?.sex || '',
      educationYears: profile.educationYears || summary.latest?.participant?.educationYears || '',
      eligible: profile.id ? (profileEligible(profile) ? 'Sí' : 'No') : '',
      priorIAExperience: profile.priorIAExperience || '',
      technologyUseFrequency: profile.technologyUseFrequency || '',
      chatgptFamiliarity: profile.chatgptFamiliarity || '',
      toolsUsed: Array.isArray(profile.toolsUsed) ? profile.toolsUsed.join('; ') : '',
      tasksIA: Array.isArray(profile.tasksIA) ? profile.tasksIA.join('; ') : '',
      exposureSessions: exposure.sessions,
      exposureTotalMinutes: exposure.totalMinutes,
      exposureAverageMinutes: exposure.averageMinutes,
      exposureCompliancePct: exposure.compliancePct,
      exposureTools: exposure.tools,
      exposureTasks: exposure.tasks,
      preTotal: summary.preTotal ?? '',
      postTotal: summary.postTotal ?? '',
      deltaTotal: summary.delta ?? '',
      preAttention: domainScore(pre, 'attention'),
      postAttention: domainScore(post, 'attention'),
      preMemory: domainScore(pre, 'memory'),
      postMemory: domainScore(post, 'memory'),
      preExecutive: domainScore(pre, 'visuospatial'),
      postExecutive: domainScore(post, 'visuospatial'),
      interviewCount: personInterviews.length,
      interviewCodes: codes,
      interviewCategories: categories,
    };
  }).sort((a, b) => String(a.participantName).localeCompare(String(b.participantName), 'es'));
};

function CheckField({ label, checked, onChange }) {
  return <label className="flex items-start gap-2 rounded-lg border bg-white p-3 text-sm"><input type="checkbox" className="mt-1" checked={!!checked} onChange={(e) => onChange(e.target.checked)} /><span>{label}</span></label>;
}

function SelectArrayField({ label, options, value = [], onChange }) {
  const current = Array.isArray(value) ? value : [];
  const toggle = (option) => {
    onChange(current.includes(option) ? current.filter((item) => item !== option) : [...current, option]);
  };
  return (
    <div>
      <p className="text-sm font-black text-slate-700">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => <button type="button" key={option} onClick={() => toggle(option)} className={`rounded-full border px-3 py-1 text-xs font-black ${current.includes(option) ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600'}`}>{option}</button>)}
      </div>
    </div>
  );
}

function ProtocolResearchModule({ results, profiles, exposureLogs, interviews, onSaveProfile, onSaveLog, onSaveInterview, onDeleteProfile, onDeleteLog, onDeleteInterview }) {
  const [profileForm, setProfileForm] = useState(defaultProtocolProfile);
  const [logForm, setLogForm] = useState({ ...defaultExposureLog, date: new Date().toISOString().slice(0, 10) });
  const [interviewForm, setInterviewForm] = useState({ ...defaultInterview, date: new Date().toISOString().slice(0, 10) });
  const [activeTab, setActiveTab] = useState('perfil');
  const participantOptions = Array.from(new Set([
    ...buildParticipantSummaries(results).map((item) => item.name),
    ...profiles.map((item) => item.participantName),
    ...exposureLogs.map((item) => item.participantName),
  ].filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es'));
  const triRows = buildProtocolTriangulationRows({ results, profiles, exposureLogs, interviews });
  const eligibleCount = profiles.filter(profileEligible).length;
  const experimentalLogs = exposureLogs.filter((item) => String(item.group || '').includes('Experimental')).length;
  const averageCompliance = (() => {
    const values = triRows.map((row) => Number(row.exposureCompliancePct)).filter(Number.isFinite);
    return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : '—';
  })();
  const saveProfile = async () => {
    if (!profileForm.participantName.trim()) { alert('Capture el nombre o código del participante.'); return; }
    await onSaveProfile({ ...profileForm, participantName: toUpper(profileForm.participantName), participantKey: protocolKey(profileForm), eligible: profileEligible(profileForm) });
    setProfileForm(defaultProtocolProfile);
  };
  const saveLog = async () => {
    if (!logForm.participantName.trim() || !logForm.date || !logForm.actualDurationMinutes) { alert('Capture participante, fecha y duración real.'); return; }
    await onSaveLog({ ...logForm, participantName: toUpper(logForm.participantName), participantKey: protocolKey(logForm) });
    setLogForm({ ...defaultExposureLog, date: new Date().toISOString().slice(0, 10) });
  };
  const saveInterview = async () => {
    if (!interviewForm.participantName.trim() || !interviewForm.date || !interviewForm.transcript.trim()) { alert('Capture participante, fecha y transcripción o notas de entrevista.'); return; }
    await onSaveInterview({ ...interviewForm, participantName: toUpper(interviewForm.participantName), participantKey: protocolKey(interviewForm) });
    setInterviewForm({ ...defaultInterview, date: new Date().toISOString().slice(0, 10) });
  };
  const exportStatisticalCsv = () => {
    const header = ['participant_key','participante','grupo','edad','sexo','escolaridad','elegible','experiencia_ia_previa','frecuencia_uso_tecnologia','familiaridad_chatgpt','herramientas_ia','tareas_ia','sesiones_exposicion','minutos_totales_exposicion','minutos_promedio_sesion','cumplimiento_porcentaje','herramientas_usadas_bitacora','tareas_bitacora','pre_total','post_total','delta_total','pre_atencion','post_atencion','delta_atencion','pre_memoria','post_memoria','delta_memoria','pre_ejecutivo','post_ejecutivo','delta_ejecutivo','num_entrevistas','codigos_cualitativos','categorias_cualitativas'];
    const rows = triRows.map((row) => [row.key, row.participantName, row.group, row.age, row.sex, row.educationYears, row.eligible, row.priorIAExperience, row.technologyUseFrequency, row.chatgptFamiliarity, row.toolsUsed, row.tasksIA, row.exposureSessions, row.exposureTotalMinutes, row.exposureAverageMinutes, row.exposureCompliancePct, row.exposureTools, row.exposureTasks, row.preTotal, row.postTotal, row.deltaTotal, row.preAttention, row.postAttention, row.postAttention !== '' && row.preAttention !== '' ? Number(row.postAttention) - Number(row.preAttention) : '', row.preMemory, row.postMemory, row.postMemory !== '' && row.preMemory !== '' ? Number(row.postMemory) - Number(row.preMemory) : '', row.preExecutive, row.postExecutive, row.postExecutive !== '' && row.preExecutive !== '' ? Number(row.postExecutive) - Number(row.preExecutive) : '', row.interviewCount, row.interviewCodes, row.interviewCategories]);
    downloadCsv(`PANEG_analisis_integrado_${new Date().toISOString().slice(0,10)}.csv`, header, rows);
  };
  const exportLogsCsv = () => {
    const header = ['participante','grupo','fecha','semana','sesion','duracion_asignada','duracion_real','herramienta','tipo_herramienta','actividad','cumplimiento','autoinforme','evidencia','observaciones'];
    const rows = exposureLogs.map((item) => [item.participantName, item.group, item.date, item.week, item.sessionNumber, item.assignedDuration, item.actualDurationMinutes, item.toolName, item.toolType, item.activityType, item.completed, item.selfReport, item.evidenceNote, item.observations]);
    downloadCsv(`PANEG_bitacora_IA_${new Date().toISOString().slice(0,10)}.csv`, header, rows);
  };
  const tabButton = (id, label) => <button type="button" onClick={() => setActiveTab(id)} className={`rounded-xl px-4 py-2 text-sm font-black ${activeTab === id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>{label}</button>;
  return (
    <section className="mb-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-xl">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-slate-500">Módulo de investigación PANEG</p>
          <h2 className="text-2xl font-black text-slate-900">Variables complementarias, exposición, entrevistas y triangulación</h2>
          <p className="mt-1 max-w-4xl text-sm text-slate-500">Este módulo no modifica el MoCA. Registra variables necesarias para análisis cuasi-experimental: perfil tecnológico, criterios de inclusión/exclusión, bitácora de exposición a IA, seguimiento 4 a 6 semanas, entrevistas cualitativas y exportación integrada para ANOVA, regresión o análisis mixto.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={exportStatisticalCsv} className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-black text-white">Exportar análisis integrado</button>
          <button type="button" onClick={exportLogsCsv} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-black text-white">Exportar bitácora</button>
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="Perfiles" value={profiles.length} note={`${eligibleCount} elegibles`} />
        <MetricCard label="Sesiones IA" value={exposureLogs.length} note={`${experimentalLogs} experimentales`} />
        <MetricCard label="Cumplimiento" value={averageCompliance === '—' ? '—' : `${averageCompliance}%`} note="Minutos reales/asignados" />
        <MetricCard label="Entrevistas" value={interviews.length} note="Cualitativo" />
        <MetricCard label="Triangulados" value={triRows.filter((row) => row.preTotal !== '' || row.postTotal !== '').length} note="Con MoCA" />
        <MetricCard label="Listos análisis" value={triRows.filter((row) => row.preTotal !== '' && row.postTotal !== '' && row.exposureSessions > 0).length} note="Pre-post + exposición" />
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {tabButton('perfil', '1. Perfil y elegibilidad')}
        {tabButton('bitacora', '2. Bitácora IA')}
        {tabButton('entrevista', '3. Entrevistas')}
        {tabButton('triangulacion', '4. Triangulación')}
      </div>
      <datalist id="paneg-participants-list">{participantOptions.map((name) => <option key={name} value={name} />)}</datalist>
      {activeTab === 'perfil' && (
        <div className="mt-5 rounded-2xl border bg-slate-50 p-4">
          <h3 className="text-lg font-black text-slate-900">Encuesta sociodemográfica, hábitos tecnológicos y criterios de inclusión/exclusión</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <label className="text-sm font-black text-slate-700">Participante<input list="paneg-participants-list" className="mt-1 w-full rounded-xl border-2 p-3 font-normal uppercase" value={profileForm.participantName} onChange={(e) => setProfileForm((c) => ({ ...c, participantName: e.target.value }))} /></label>
            <label className="text-sm font-black text-slate-700">Código / emparejamiento<input className="mt-1 w-full rounded-xl border-2 p-3 font-normal uppercase" value={profileForm.participantCode} onChange={(e) => setProfileForm((c) => ({ ...c, participantCode: toUpper(e.target.value) }))} /></label>
            <label className="text-sm font-black text-slate-700">Condición<select className="mt-1 w-full rounded-xl border-2 p-3 font-normal" value={profileForm.group} onChange={(e) => setProfileForm((c) => ({ ...c, group: e.target.value }))}><option>Experimental (Uso de IAGen)</option><option>Control</option></select></label>
            <label className="text-sm font-black text-slate-700">Edad<input type="text" inputMode="numeric" className="mt-1 w-full rounded-xl border-2 p-3 font-normal" value={profileForm.age} onChange={(e) => setProfileForm((c) => ({ ...c, age: digitsOnly(e.target.value,3) }))} /></label>
            <label className="text-sm font-black text-slate-700">Sexo<select className="mt-1 w-full rounded-xl border-2 p-3 font-normal" value={profileForm.sex} onChange={(e) => setProfileForm((c) => ({ ...c, sex: e.target.value }))}><option value="">Seleccione</option><option>Mujer</option><option>Hombre</option><option>Otro / prefiere no responder</option></select></label>
            <label className="text-sm font-black text-slate-700">Escolaridad completa<input type="text" inputMode="numeric" className="mt-1 w-full rounded-xl border-2 p-3 font-normal" value={profileForm.educationYears} onChange={(e) => setProfileForm((c) => ({ ...c, educationYears: digitsOnly(e.target.value,2) }))} /></label>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <CheckField label="Tiene 18 años o más" checked={profileForm.adult18} onChange={(value) => setProfileForm((c) => ({ ...c, adult18: value }))} />
            <CheckField label="Escolaridad básica terminada" checked={profileForm.basicEducation} onChange={(value) => setProfileForm((c) => ({ ...c, basicEducation: value }))} />
            <CheckField label="Cuenta con dispositivo e internet" checked={profileForm.internetAccess} onChange={(value) => setProfileForm((c) => ({ ...c, internetAccess: value }))} />
            <CheckField label="Consentimiento informado firmado/aceptado" checked={profileForm.informedConsent} onChange={(value) => setProfileForm((c) => ({ ...c, informedConsent: value }))} />
            <CheckField label="Sin diagnóstico de deterioro cognitivo moderado/severo reportado" checked={profileForm.noModerateSevereCognitiveDx} onChange={(value) => setProfileForm((c) => ({ ...c, noModerateSevereCognitiveDx: value }))} />
            <CheckField label="Sin condición neurológica/psiquiátrica activa no controlada reportada" checked={profileForm.noUncontrolledNeuroPsych} onChange={(value) => setProfileForm((c) => ({ ...c, noUncontrolledNeuroPsych: value }))} />
            <CheckField label="Puede cumplir la exposición pautada" checked={profileForm.canComplyExposure} onChange={(value) => setProfileForm((c) => ({ ...c, canComplyExposure: value }))} />
          </div>
          <div className={`mt-4 rounded-xl p-3 text-sm font-black ${profileEligible(profileForm) ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>{profileEligible(profileForm) ? 'Participante elegible según checklist.' : 'Checklist incompleto o con criterios no cumplidos.'}</div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-sm font-black text-slate-700">Experiencia previa con IA<select className="mt-1 w-full rounded-xl border-2 p-3 font-normal" value={profileForm.priorIAExperience} onChange={(e) => setProfileForm((c) => ({ ...c, priorIAExperience: e.target.value }))}><option>Ninguna</option><option>Ocasional</option><option>Frecuente</option><option>Avanzada</option></select></label>
            <label className="text-sm font-black text-slate-700">Frecuencia de uso tecnológico<select className="mt-1 w-full rounded-xl border-2 p-3 font-normal" value={profileForm.technologyUseFrequency} onChange={(e) => setProfileForm((c) => ({ ...c, technologyUseFrequency: e.target.value }))}><option value="">Seleccione</option>{PROTOCOL_TECH_USE_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="text-sm font-black text-slate-700">Familiaridad con ChatGPT / IA 1-5<input type="text" inputMode="numeric" maxLength="1" className="mt-1 w-full rounded-xl border-2 p-3 font-normal" value={profileForm.chatgptFamiliarity} onChange={(e) => setProfileForm((c) => ({ ...c, chatgptFamiliarity: digitsOnly(e.target.value,1) }))} /></label>
            <label className="text-sm font-black text-slate-700">Autoeficacia IA 1-5<input type="text" inputMode="numeric" maxLength="1" className="mt-1 w-full rounded-xl border-2 p-3 font-normal" value={profileForm.selfEfficacyIA} onChange={(e) => setProfileForm((c) => ({ ...c, selfEfficacyIA: digitsOnly(e.target.value,1) }))} /></label>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <SelectArrayField label="Herramientas que usa o conoce" options={PROTOCOL_TOOL_OPTIONS} value={profileForm.toolsUsed} onChange={(value) => setProfileForm((c) => ({ ...c, toolsUsed: value }))} />
            <SelectArrayField label="Tipo de tareas en que usa IA" options={PROTOCOL_TASK_OPTIONS} value={profileForm.tasksIA} onChange={(value) => setProfileForm((c) => ({ ...c, tasksIA: value }))} />
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-black text-slate-700">Hábitos digitales<textarea className="mt-1 w-full rounded-xl border-2 p-3 font-normal" rows="3" value={profileForm.digitalHabits} onChange={(e) => setProfileForm((c) => ({ ...c, digitalHabits: e.target.value }))} /></label>
            <label className="text-sm font-black text-slate-700">Percepción inicial sobre IA<textarea className="mt-1 w-full rounded-xl border-2 p-3 font-normal" rows="3" value={profileForm.baselinePerception} onChange={(e) => setProfileForm((c) => ({ ...c, baselinePerception: e.target.value }))} /></label>
          </div>
          <button type="button" onClick={saveProfile} className="mt-4 rounded-xl bg-violet-700 px-5 py-3 font-black text-white">Guardar perfil / checklist</button>
          <div className="mt-5 max-h-64 overflow-auto rounded-xl border bg-white"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-slate-100"><tr><th className="p-2">Participante</th><th>Grupo</th><th>Elegible</th><th>Experiencia IA</th><th>Familiaridad</th><th>Herramientas</th><th>Acción</th></tr></thead><tbody>{profiles.map((item) => <tr key={item.id} className="border-t"><td className="p-2 font-bold">{item.participantName}</td><td>{item.group}</td><td>{profileEligible(item) ? 'Sí' : 'No'}</td><td>{item.priorIAExperience}</td><td>{item.chatgptFamiliarity}</td><td>{Array.isArray(item.toolsUsed) ? item.toolsUsed.join(', ') : ''}</td><td><button type="button" onClick={() => onDeleteProfile(item.id)} className="rounded bg-red-600 px-2 py-1 font-bold text-white">Eliminar</button></td></tr>)}</tbody></table></div>
        </div>
      )}
      {activeTab === 'bitacora' && (
        <div className="mt-5 rounded-2xl border bg-slate-50 p-4">
          <h3 className="text-lg font-black text-slate-900">Bitácora de exposición controlada a IA Generativa</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-3 xl:grid-cols-4">
            <label className="text-sm font-black text-slate-700">Participante<input list="paneg-participants-list" className="mt-1 w-full rounded-xl border-2 p-3 font-normal uppercase" value={logForm.participantName} onChange={(e) => setLogForm((c) => ({ ...c, participantName: e.target.value }))} /></label>
            <label className="text-sm font-black text-slate-700">Fecha<input type="date" className="mt-1 w-full rounded-xl border-2 p-3 font-normal" value={logForm.date} onChange={(e) => setLogForm((c) => ({ ...c, date: e.target.value }))} /></label>
            <label className="text-sm font-black text-slate-700">Semana<input type="text" inputMode="numeric" className="mt-1 w-full rounded-xl border-2 p-3 font-normal" value={logForm.week} onChange={(e) => setLogForm((c) => ({ ...c, week: digitsOnly(e.target.value,2) }))} /></label>
            <label className="text-sm font-black text-slate-700">Sesión<input type="text" inputMode="numeric" className="mt-1 w-full rounded-xl border-2 p-3 font-normal" value={logForm.sessionNumber} onChange={(e) => setLogForm((c) => ({ ...c, sessionNumber: digitsOnly(e.target.value,3) }))} /></label>
            <label className="text-sm font-black text-slate-700">Duración asignada<select className="mt-1 w-full rounded-xl border-2 p-3 font-normal" value={logForm.assignedDuration} onChange={(e) => setLogForm((c) => ({ ...c, assignedDuration: e.target.value }))}>{PROTOCOL_ASSIGNED_DURATIONS.map((item) => <option key={item} value={item}>{item} minutos</option>)}</select></label>
            <label className="text-sm font-black text-slate-700">Duración real<input type="text" inputMode="numeric" className="mt-1 w-full rounded-xl border-2 p-3 font-normal" value={logForm.actualDurationMinutes} onChange={(e) => setLogForm((c) => ({ ...c, actualDurationMinutes: digitsOnly(e.target.value,3) }))} /></label>
            <label className="text-sm font-black text-slate-700">Herramienta<select className="mt-1 w-full rounded-xl border-2 p-3 font-normal" value={logForm.toolName} onChange={(e) => setLogForm((c) => ({ ...c, toolName: e.target.value }))}>{PROTOCOL_TOOL_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="text-sm font-black text-slate-700">Actividad<select className="mt-1 w-full rounded-xl border-2 p-3 font-normal" value={logForm.activityType} onChange={(e) => setLogForm((c) => ({ ...c, activityType: e.target.value }))}>{PROTOCOL_TASK_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="text-sm font-black text-slate-700">Cumplimiento<select className="mt-1 w-full rounded-xl border-2 p-3 font-normal" value={logForm.completed} onChange={(e) => setLogForm((c) => ({ ...c, completed: e.target.value }))}><option>Sí</option><option>Parcial</option><option>No</option></select></label>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <label className="text-sm font-black text-slate-700">Autoinforme<textarea className="mt-1 w-full rounded-xl border-2 p-3 font-normal" rows="3" value={logForm.selfReport} onChange={(e) => setLogForm((c) => ({ ...c, selfReport: e.target.value }))} /></label>
            <label className="text-sm font-black text-slate-700">Evidencia / referencia<textarea className="mt-1 w-full rounded-xl border-2 p-3 font-normal" rows="3" value={logForm.evidenceNote} onChange={(e) => setLogForm((c) => ({ ...c, evidenceNote: e.target.value }))} /></label>
            <label className="text-sm font-black text-slate-700">Observaciones<textarea className="mt-1 w-full rounded-xl border-2 p-3 font-normal" rows="3" value={logForm.observations} onChange={(e) => setLogForm((c) => ({ ...c, observations: e.target.value }))} /></label>
          </div>
          <button type="button" onClick={saveLog} className="mt-4 rounded-xl bg-blue-700 px-5 py-3 font-black text-white">Guardar sesión de bitácora</button>
          <div className="mt-5 max-h-72 overflow-auto rounded-xl border bg-white"><table className="w-full min-w-[1000px] text-left text-xs"><thead className="bg-slate-100"><tr><th className="p-2">Participante</th><th>Fecha</th><th>Semana</th><th>Duración</th><th>Herramienta</th><th>Actividad</th><th>Cumplimiento</th><th>Acción</th></tr></thead><tbody>{exposureLogs.map((item) => <tr key={item.id} className="border-t"><td className="p-2 font-bold">{item.participantName}</td><td>{item.date}</td><td>{item.week}</td><td>{item.actualDurationMinutes}/{item.assignedDuration}</td><td>{item.toolName}</td><td>{item.activityType}</td><td>{item.completed}</td><td><button type="button" onClick={() => onDeleteLog(item.id)} className="rounded bg-red-600 px-2 py-1 font-bold text-white">Eliminar</button></td></tr>)}</tbody></table></div>
        </div>
      )}
      {activeTab === 'entrevista' && (
        <div className="mt-5 rounded-2xl border bg-slate-50 p-4">
          <h3 className="text-lg font-black text-slate-900">Módulo de entrevistas cualitativas</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-4">
            <label className="text-sm font-black text-slate-700">Participante<input list="paneg-participants-list" className="mt-1 w-full rounded-xl border-2 p-3 font-normal uppercase" value={interviewForm.participantName} onChange={(e) => setInterviewForm((c) => ({ ...c, participantName: e.target.value }))} /></label>
            <label className="text-sm font-black text-slate-700">Fecha<input type="date" className="mt-1 w-full rounded-xl border-2 p-3 font-normal" value={interviewForm.date} onChange={(e) => setInterviewForm((c) => ({ ...c, date: e.target.value }))} /></label>
            <label className="text-sm font-black text-slate-700">Momento<select className="mt-1 w-full rounded-xl border-2 p-3 font-normal" value={interviewForm.phase} onChange={(e) => setInterviewForm((c) => ({ ...c, phase: e.target.value }))}><option>Pretest</option><option>Intermedia</option><option>Postest</option><option>Seguimiento</option></select></label>
            <label className="text-sm font-black text-slate-700">Entrevistador<input className="mt-1 w-full rounded-xl border-2 p-3 font-normal" value={interviewForm.interviewer} onChange={(e) => setInterviewForm((c) => ({ ...c, interviewer: e.target.value }))} /></label>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-black text-slate-700">Transcripción / relato<textarea className="mt-1 w-full rounded-xl border-2 p-3 font-normal" rows="7" value={interviewForm.transcript} onChange={(e) => setInterviewForm((c) => ({ ...c, transcript: e.target.value }))} /></label>
            <div className="space-y-4">
              <label className="block text-sm font-black text-slate-700">Códigos temáticos<textarea className="mt-1 w-full rounded-xl border-2 p-3 font-normal" rows="3" placeholder="fatiga mental; dependencia; productividad" value={interviewForm.codes} onChange={(e) => setInterviewForm((c) => ({ ...c, codes: e.target.value }))} /></label>
              <label className="block text-sm font-black text-slate-700">Categorías<textarea className="mt-1 w-full rounded-xl border-2 p-3 font-normal" rows="3" placeholder="beneficios percibidos; riesgos; autorregulación" value={interviewForm.categories} onChange={(e) => setInterviewForm((c) => ({ ...c, categories: e.target.value }))} /></label>
              <label className="block text-sm font-black text-slate-700">Notas analíticas<textarea className="mt-1 w-full rounded-xl border-2 p-3 font-normal" rows="3" value={interviewForm.analyticNotes} onChange={(e) => setInterviewForm((c) => ({ ...c, analyticNotes: e.target.value }))} /></label>
            </div>
          </div>
          <button type="button" onClick={saveInterview} className="mt-4 rounded-xl bg-emerald-700 px-5 py-3 font-black text-white">Guardar entrevista</button>
          <div className="mt-5 max-h-72 overflow-auto rounded-xl border bg-white"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-slate-100"><tr><th className="p-2">Participante</th><th>Fecha</th><th>Momento</th><th>Códigos</th><th>Categorías</th><th>Acción</th></tr></thead><tbody>{interviews.map((item) => <tr key={item.id} className="border-t"><td className="p-2 font-bold">{item.participantName}</td><td>{item.date}</td><td>{item.phase}</td><td>{item.codes}</td><td>{item.categories}</td><td><button type="button" onClick={() => onDeleteInterview(item.id)} className="rounded bg-red-600 px-2 py-1 font-bold text-white">Eliminar</button></td></tr>)}</tbody></table></div>
        </div>
      )}
      {activeTab === 'triangulacion' && (
        <div className="mt-5 rounded-2xl border bg-slate-50 p-4">
          <h3 className="text-lg font-black text-slate-900">Triangulación: MoCA + exposición IA + entrevista</h3>
          <p className="mt-1 text-sm text-slate-500">La tabla une por nombre/código normalizado. Para análisis formal, use el mismo identificador de participante en MoCA, perfil, bitácora y entrevista.</p>
          <div className="mt-4 max-h-[520px] overflow-auto rounded-xl border bg-white"><table className="w-full min-w-[1500px] text-left text-xs"><thead className="sticky top-0 bg-slate-100"><tr><th className="p-2">Participante</th><th>Grupo</th><th>Elegible</th><th>Exp. IA previa</th><th>Sesiones</th><th>Minutos</th><th>Cumplimiento</th><th>Pre</th><th>Post</th><th>Δ total</th><th>Atención pre/post</th><th>Memoria pre/post</th><th>Ejecutivo pre/post</th><th>Entrevistas</th><th>Categorías</th></tr></thead><tbody>{triRows.map((row) => <tr key={row.key} className="border-t"><td className="p-2 font-bold">{row.participantName}</td><td>{row.group}</td><td>{row.eligible}</td><td>{row.priorIAExperience}</td><td>{row.exposureSessions}</td><td>{row.exposureTotalMinutes}</td><td>{row.exposureCompliancePct === '' ? '—' : `${row.exposureCompliancePct}%`}</td><td>{row.preTotal}</td><td>{row.postTotal}</td><td className={Number(row.deltaTotal) > 0 ? 'font-black text-green-700' : Number(row.deltaTotal) < 0 ? 'font-black text-red-700' : 'font-bold'}>{row.deltaTotal}</td><td>{row.preAttention}/{row.postAttention}</td><td>{row.preMemory}/{row.postMemory}</td><td>{row.preExecutive}/{row.postExecutive}</td><td>{row.interviewCount}</td><td>{row.interviewCategories}</td></tr>)}</tbody></table></div>
        </div>
      )}
    </section>
  );
}

function PowerBIResultsDashboard({ results, onOpenResults }) {
  const summaries = buildParticipantSummaries(results);
  const completed = results.filter((record) => record.finalScore?.complete && Number.isFinite(Number(record.finalScore.total)));
  const average = completed.length ? (completed.reduce((sum, record) => sum + Number(record.finalScore.total), 0) / completed.length).toFixed(1) : '—';
  const pairedCount = summaries.filter((item) => item.pre && item.post).length;
  const alerts = summaries.filter((item) => item.latestTotal !== null && item.latestTotal < 26).length;
  const expected = summaries.filter((item) => item.latestTotal !== null && item.latestTotal >= 26).length;
  return (
    <section className="rounded-3xl border bg-white p-5 shadow-xl">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-slate-500">Tablero general tipo Power BI</p>
          <h2 className="text-2xl font-black text-slate-900">Resultados integrados por participante</h2>
          <p className="mt-1 text-sm text-slate-500">PANEG agrupa automáticamente pretest y postest cuando el nombre del participante coincide.</p>
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Participantes" value={summaries.length} note="Nombres únicos" />
        <MetricCard label="Registros" value={results.length} note="Pretest + postest" />
        <MetricCard label="Promedio" value={average === '—' ? '—' : `${average}/30`} note="Solo revisados" />
        <MetricCard label="Pares pre-post" value={pairedCount} note="Seguimiento completo" />
        <MetricCard label="Alertas" value={alerts} note={`${expected} en rango esperado`} className={alerts ? toneClasses.amber : toneClasses.green} />
      </div>
      <div className="mt-6 grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="rounded-2xl border bg-slate-50 p-4">
          <h3 className="font-black text-slate-900">Matriz de seguimiento</h3>
          <div className="mt-3 max-h-[420px] overflow-auto rounded-xl border bg-white">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="p-3">Participante</th><th>Pretest</th><th>Postest</th><th>Cambio</th><th>Clasificación</th><th className="p-3">Acción</th></tr>
              </thead>
              <tbody>{summaries.map((summary) => {
                const tone = summary.classification.tone === 'green' ? 'bg-green-50 text-green-800' : summary.classification.tone === 'amber' ? 'bg-amber-50 text-amber-800' : summary.classification.tone === 'red' ? 'bg-red-50 text-red-800' : 'bg-slate-50 text-slate-700';
                return (
                  <tr key={summary.key} className="border-t align-middle">
                    <td className="p-3 font-black text-slate-900">{summary.name}<span className="block text-xs font-normal text-slate-400">{summary.records.length} registro(s)</span></td>
                    <td className="font-bold">{summary.preTotal !== null ? `${summary.preTotal}/30` : '—'}</td>
                    <td className="font-bold">{summary.postTotal !== null ? `${summary.postTotal}/30` : '—'}</td>
                    <td className={summary.delta < 0 ? 'font-black text-red-700' : summary.delta > 0 ? 'font-black text-green-700' : 'font-black text-slate-600'}>{summary.delta === null ? '—' : summary.delta > 0 ? `+${summary.delta}` : summary.delta}</td>
                    <td><span className={`rounded-full px-3 py-1 text-xs font-black ${tone}`}>{summary.classification.label}</span></td>
                    <td className="p-3"><button type="button" onClick={() => onOpenResults(summary.post || summary.pre || summary.latest)} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-black text-white">Abrir detalle</button></td>
                  </tr>
                );
              })}</tbody>
            </table>
            {summaries.length === 0 && <p className="p-10 text-center text-slate-500">Aún no hay resultados para visualizar.</p>}
          </div>
        </div>
        <div className="rounded-2xl border bg-slate-50 p-4">
          <h3 className="font-black text-slate-900">Distribución rápida</h3>
          <div className="mt-4 space-y-4">
            {[['Rango esperado', expected, summaries.length], ['Alertas / limítrofes', alerts, summaries.length], ['Pares completos', pairedCount, summaries.length]].map(([label, value, total]) => {
              const pct = total ? Math.round((Number(value) / Number(total)) * 100) : 0;
              return <div key={label}><div className="mb-1 flex justify-between text-xs font-bold text-slate-600"><span>{label}</span><span>{value}</span></div><div className="h-4 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-blue-700" style={{ width: `${pct}%` }} /></div></div>;
            })}
          </div>
          <p className="mt-5 rounded-xl bg-white p-3 text-sm text-slate-600">Use el botón Abrir detalle para desplegar abajo el panel explicable completo del participante. El listado superior se mantiene solo para revisión y eliminación.</p>
        </div>
      </div>
    </section>
  );
}

function ParticipantResultsDashboard({ record, records, manualOverride = null }) {
  const data = buildAnalysisDataForRecord(record, records, manualOverride);
  if (!data) return <PowerBIResultsDashboard results={records} onOpenResults={() => {}} />;
  return (
    <div className="space-y-5">
      <DashboardAnalysisPanel record={record} selectedCfg={data.selectedCfg} finalScore={data.finalScore} domains={data.domains} pairedDomains={data.pairedDomains} comparison={data.comparison} itemEvidence={data.itemEvidence} interpretation={data.interpretation} />
    </div>
  );
}

function DashboardAnalysisPanel({ record, selectedCfg, finalScore, domains, pairedDomains, comparison, itemEvidence, interpretation }) {
  const classification = interpretation.classification;
  const tone = toneClasses[classification.tone] || toneClasses.slate;
  return (
    <section className="rounded-3xl border-2 border-slate-200 bg-slate-50 p-4 md:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-slate-500">Panel explicable PANEG</p>
          <h3 className="mt-1 text-2xl font-black text-slate-900">Resumen, avance y análisis automático</h3>
          <p className="mt-1 text-sm text-slate-600">{record.participant?.name} · {record.phase} · MoCA {record.version} · {selectedCfg.copyTitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => window.print()} className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-black text-white">Imprimir / guardar PDF</button>
          <button type="button" onClick={() => downloadEvaluatorReport({ record, finalScore, domains, interpretation, comparison })} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-black text-white">Descargar reporte TXT</button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total provisional" value={`${finalScore.total}/30`} note={`Base ${finalScore.base} + ajuste ${finalScore.educationAdjustment}`} />
        <MetricCard label="Clasificación" value={classification.label} note="Tamizaje, no diagnóstico" className={tone} />
        <MetricCard label="MIS" value={`${finalScore.objective?.mis ?? 0}/15`} note="Índice de memoria" />
        <MetricCard label="Cambio pre-post" value={comparison.delta === null ? '—' : `${comparison.delta > 0 ? '+' : ''}${comparison.delta}`} note="Diferencia global" />
      </div>

      <div className={`mt-5 rounded-2xl border p-4 text-sm leading-relaxed ${tone}`}>
        <p className="font-black">Análisis automático tipo IA</p>
        <p className="mt-2">{interpretation.narrative}</p>
        <p className="mt-2">{interpretation.recommendation}</p>
        <p className="mt-2 text-xs opacity-80">PANEG no debe presentar el resultado como “daño cognitivo: sí/no”. Se reporta como alerta de tamizaje y requiere interpretación profesional.</p>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_280px]">
        <div className="rounded-2xl border bg-white p-4">
          <h4 className="font-black text-slate-900">Puntaje por dominios</h4>
          <div className="mt-4"><DomainBars domains={domains} /></div>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <h4 className="font-black text-slate-900">Radar cognitivo</h4>
          <DomainRadarChart domains={domains} />
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <div className="rounded-2xl border bg-white p-4">
          <h4 className="font-black text-slate-900">Evolución pretest-postest</h4>
          <div className="mt-3"><EvolutionChart comparison={comparison} /></div>
          <div className="mt-4"><DomainComparisonTable currentDomains={domains} pairedDomains={pairedDomains} selectedPhase={record.phase} /></div>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <h4 className="font-black text-slate-900">Mapa de calor por reactivo</h4>
          <div className="mt-3"><ItemHeatmap items={itemEvidence} /></div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border bg-white p-4 text-sm">
          <h4 className="font-black text-slate-900">Fortalezas observadas</h4>
          <p className="mt-2 text-slate-700">{interpretation.strengths.length ? interpretation.strengths.join('; ') : 'No se identifican dominios con desempeño ≥ 90% en esta revisión provisional.'}</p>
        </div>
        <div className="rounded-2xl border bg-white p-4 text-sm">
          <h4 className="font-black text-slate-900">Áreas a revisar</h4>
          <p className="mt-2 text-slate-700">{interpretation.alerts.length ? interpretation.alerts.join('; ') : 'No se identifican dominios por debajo de 75%.'}</p>
        </div>
      </div>
    </section>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [screen, setScreen] = useState('home');
  const [phase, setPhase] = useState('Pretest');
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState(() => initialAnswers('Pretest', '8.1'));
  const [played, setPlayed] = useState({});
  const [vigilanceActive, setVigilanceActive] = useState(false);
  const [vigilanceCurrent, setVigilanceCurrent] = useState('');
  const [vigilanceIndex, setVigilanceIndex] = useState(-1);
  const [fluencyActive, setFluencyActive] = useState(false);
  const [fluencyFinished, setFluencyFinished] = useState(false);
  const [vigilanceTapFeedback, setVigilanceTapFeedback] = useState(false);
  const [fluencyAudioUrl, setFluencyAudioUrl] = useState('');
  const [fluencyRecording, setFluencyRecording] = useState(false);
  const [fluencyMicError, setFluencyMicError] = useState('');
  const [fluencyRecognitionStatus, setFluencyRecognitionStatus] = useState('');
  const [fluencyInterimTranscript, setFluencyInterimTranscript] = useState('');
  const [microphones, setMicrophones] = useState([]);
  const [selectedMicId, setSelectedMicId] = useState('');
  const [micTestStatus, setMicTestStatus] = useState('');
  const [micTestLevel, setMicTestLevel] = useState(0);
  const mediaRecorderRef = useRef(null);
  const speechRecognitionRef = useRef(null);
  const fluencyActiveRef = useRef(false);
  const mediaChunksRef = useRef([]);
  const tappedVigilanceIndexRef = useRef(-1);
  const micPeakRef = useRef(0);
  const micMonitorFrameRef = useRef(null);
  const audioContextRef = useRef(null);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [evaluatorPassword, setEvaluatorPassword] = useState('');
  const [showEvaluatorPassword, setShowEvaluatorPassword] = useState(false);
  const [evaluatorLoginBusy, setEvaluatorLoginBusy] = useState(false);
  const [evaluatorLoginMessage, setEvaluatorLoginMessage] = useState('');
  const [evaluatorUnlocked, setEvaluatorUnlocked] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [showPasswordDialogFields, setShowPasswordDialogFields] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' });
  const [passwordChangeMessage, setPasswordChangeMessage] = useState('');
  const [passwordChangeError, setPasswordChangeError] = useState('');
  const [passwordChanging, setPasswordChanging] = useState(false);
  const [results, setResults] = useState([]);
  const [protocolProfiles, setProtocolProfiles] = useState([]);
  const [protocolExposureLogs, setProtocolExposureLogs] = useState([]);
  const [protocolInterviews, setProtocolInterviews] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedAnalysis, setSelectedAnalysis] = useState(null);
  const [manual, setManual] = useState({ trail: 0, copy: 0, clock: 0, naming: 0, repetition: 0, fluency: 0, abstraction: 0 });
  const [fluencyReviewText, setFluencyReviewText] = useState('');
  const resultsDashboardRef = useRef(null);

  const cfg = VERSION_CONFIG[phase];
  const theme = cfg.theme === 'blue' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-teal-600 hover:bg-teal-700';
  const totalSteps = 15;

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (current) => {
      if (current) {
        setUser(current);
        setAuthReady(true);
      } else {
        try {
          await signInAnonymously(auth);
        } catch (error) {
          console.error(error);
          setAuthReady(true);
        }
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!evaluatorUnlocked || !user) return undefined;
    const ref = collection(db, ...RESULTS_PATH);
    return onSnapshot(ref, (snapshot) => {
      const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      rows.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
      setResults(rows);
    });
  }, [evaluatorUnlocked, user]);

  useEffect(() => {
    if (!evaluatorUnlocked || !user) return undefined;
    const unsubProfiles = onSnapshot(collection(db, ...PROTOCOL_PROFILES_PATH), (snapshot) => {
      const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      rows.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
      setProtocolProfiles(rows);
    });
    const unsubLogs = onSnapshot(collection(db, ...PROTOCOL_EXPOSURE_LOGS_PATH), (snapshot) => {
      const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || Number(b.createdAt || 0) - Number(a.createdAt || 0));
      setProtocolExposureLogs(rows);
    });
    const unsubInterviews = onSnapshot(collection(db, ...PROTOCOL_INTERVIEWS_PATH), (snapshot) => {
      const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || Number(b.createdAt || 0) - Number(a.createdAt || 0));
      setProtocolInterviews(rows);
    });
    return () => { unsubProfiles(); unsubLogs(); unsubInterviews(); };
  }, [evaluatorUnlocked, user]);


  useEffect(() => {
    const loadMicrophones = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter((device) => device.kind === 'audioinput');
        setMicrophones(inputs);
        if (!selectedMicId && inputs[0]?.deviceId) setSelectedMicId(inputs[0].deviceId);
      } catch (error) {
        console.error(error);
      }
    };
    loadMicrophones();
    navigator.mediaDevices?.addEventListener?.('devicechange', loadMicrophones);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', loadMicrophones);
  }, [selectedMicId]);

  const testMicrophone = async () => {
    setMicTestStatus('Solicitando acceso al micrófono…');
    setMicTestLevel(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedMicId ? { deviceId: { exact: selectedMicId } } : true,
      });
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        setMicTestStatus('El navegador permitió el micrófono, pero no puede medir su nivel.');
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const context = new AudioContextClass();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let peak = 0;
      const started = performance.now();
      await new Promise((resolve) => {
        const monitor = () => {
          analyser.getByteTimeDomainData(data);
          let currentPeak = 0;
          for (const sample of data) currentPeak = Math.max(currentPeak, Math.abs(sample - 128));
          peak = Math.max(peak, currentPeak);
          setMicTestLevel(Math.min(100, Math.round(currentPeak * 4)));
          if (performance.now() - started < 4000) window.requestAnimationFrame(monitor);
          else resolve();
        };
        monitor();
      });
      stream.getTracks().forEach((track) => track.stop());
      await context.close();
      if (peak < 3) setMicTestStatus('No se detectó voz. Seleccione otro micrófono o revise que no esté silenciado.');
      else if (peak < 8) setMicTestStatus('Se detectó señal muy baja. Acérquese al micrófono o aumente el nivel de entrada.');
      else setMicTestStatus('Micrófono listo: se detectó voz correctamente.');
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMicrophones(devices.filter((device) => device.kind === 'audioinput'));
    } catch (error) {
      console.error(error);
      setMicTestStatus('No fue posible usar el micrófono. Revise el permiso del navegador y Windows.');
    }
  };

  const startPhase = () => {
    const config = VERSION_CONFIG[phase];
    setAnswers(initialAnswers(phase, config.version));
    setPlayed({});
    setStep(0);
    setSaveMessage('');
    setSaveError('');
    setFluencyActive(false);
    setFluencyFinished(false);
    setFluencyAudioUrl('');
    setFluencyRecording(false);
    setFluencyMicError('');
    setFluencyRecognitionStatus('');
    setFluencyInterimTranscript('');
    setMicTestStatus('');
    setMicTestLevel(0);
    fluencyActiveRef.current = false;
    tappedVigilanceIndexRef.current = -1;
    setScreen('consent');
  };

  const setParticipant = (key, value) => {
    let nextValue = value;
    if (key === 'name') nextValue = toUpper(value);
    if (key === 'age') nextValue = digitsOnly(value, 3);
    if (key === 'educationYears') nextValue = digitsOnly(value, 2);
    setAnswers((current) => ({ ...current, participant: { ...current.participant, [key]: nextValue } }));
  };

  const acceptConsent = () => {
    if (!answers.consent.read || !answers.consent.participate || !answers.consent.participantName.trim() || !answers.consent.adult || !answers.consent.audio) return;
    setAnswers((current) => ({
      ...current,
      consent: { ...current.consent, participantName: toUpper(current.consent.participantName.trim()), acceptedAt: new Date().toISOString() },
      participant: { ...current.participant, name: toUpper(current.consent.participantName.trim()) },
      administration: { ...current.administration, startedAt: Date.now() },
    }));
    setScreen('test');
    setStep(0);
  };

  const markPlayed = (key) => setPlayed((current) => ({ ...current, [key]: true }));

  const playTimedSequence = async (items, prefix, onComplete) => {
    if (played[prefix]) return;
    markPlayed(prefix);
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      await new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(item);
        utterance.lang = 'es-MX';
        utterance.rate = 0.82;
        utterance.onend = resolve;
        utterance.onerror = resolve;
        window.speechSynthesis.speak(utterance);
        window.setTimeout(resolve, 900);
      });
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    onComplete?.();
  };

  const startVigilance = async () => {
    if (vigilanceActive || played.vigilance) return;
    setVigilanceActive(true);
    setVigilanceCurrent('');
    setVigilanceIndex(-1);
    tappedVigilanceIndexRef.current = -1;
    setAnswers((current) => ({
      ...current,
      attention: {
        ...current.attention,
        vigilanceHits: 0,
        vigilanceFalseAlarms: 0,
        vigilanceOmissions: TARGET_A_COUNT,
      },
    }));

    window.speechSynthesis?.cancel();

    for (let index = 0; index < LETTER_SEQUENCE.length; index += 1) {
      const letter = LETTER_SEQUENCE[index];
      const startedAt = performance.now();
      setVigilanceCurrent(letter);
      setVigilanceIndex(index);
      tappedVigilanceIndexRef.current = -1;

      await new Promise((resolve) => {
        let resolved = false;
        let watchdogId = null;
        const finish = () => {
          if (resolved) return;
          resolved = true;
          if (watchdogId) window.clearTimeout(watchdogId);
          resolve();
        };

        const utterance = new SpeechSynthesisUtterance(letter.toLowerCase());
        utterance.lang = 'es-MX';
        utterance.rate = 0.62;
        utterance.pitch = 1;
        utterance.volume = 1;
        utterance.onend = finish;
        utterance.onerror = finish;

        // No se usa un corte fijo de 950 ms: cada letra debe terminar realmente
        // antes de programar la siguiente. El temporizador solo evita un bloqueo
        // excepcional del motor de voz y no cancela la secuencia normal.
        watchdogId = window.setTimeout(finish, 4000);
        window.speechSynthesis.speak(utterance);
      });

      const elapsed = performance.now() - startedAt;
      if (elapsed < 1000) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000 - elapsed));
      }
    }

    // No cancelar aquí: al llegar a este punto la última letra ya terminó.
    setVigilanceCurrent('');
    setVigilanceActive(false);
    setAnswers((current) => ({
      ...current,
      attention: {
        ...current.attention,
        vigilanceOmissions: Math.max(0, TARGET_A_COUNT - current.attention.vigilanceHits),
      },
    }));
    markPlayed('vigilance');
  };

  const tapVigilance = () => {
    if (!vigilanceActive || !vigilanceCurrent || vigilanceIndex < 0) return;
    if (tappedVigilanceIndexRef.current === vigilanceIndex) return;
    tappedVigilanceIndexRef.current = vigilanceIndex;
    setVigilanceTapFeedback(true);
    window.setTimeout(() => setVigilanceTapFeedback(false), 220);
    setAnswers((current) => ({
      ...current,
      attention: {
        ...current.attention,
        vigilanceHits: current.attention.vigilanceHits + (vigilanceCurrent === 'A' ? 1 : 0),
        vigilanceFalseAlarms: current.attention.vigilanceFalseAlarms + (vigilanceCurrent === 'A' ? 0 : 1),
      },
    }));
  };

  const startSpeechRecognition = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setFluencyRecognitionStatus('El reconocimiento automático de voz no está disponible en este navegador. Use Chrome actualizado o transcriba manualmente a partir de la grabación.');
      return;
    }
    try {
      const recognition = new Recognition();
      recognition.lang = 'es-MX';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.onstart = () => setFluencyRecognitionStatus('Reconocimiento de voz activo.');
      recognition.onresult = (event) => {
        let finalText = '';
        let interimText = '';
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const text = event.results[index][0]?.transcript || '';
          if (event.results[index].isFinal) finalText += `${text} `;
          else interimText += text;
        }
        if (finalText.trim()) {
          setAnswers((current) => ({
            ...current,
            language: {
              ...current.language,
              fluencyTranscript: toUpper(`${current.language.fluencyTranscript || ''} ${finalText}`.trim()),
            },
          }));
        }
        setFluencyInterimTranscript(toUpper(interimText));
      };
      recognition.onerror = (event) => {
        setFluencyRecognitionStatus(`Reconocimiento de voz: ${event.error || 'error'}. La revisión manual sigue disponible.`);
      };
      recognition.onend = () => {
        setFluencyInterimTranscript('');
        if (fluencyActiveRef.current) {
          try { recognition.start(); } catch (_) { /* el navegador puede estar reiniciando */ }
        } else {
          setFluencyRecognitionStatus('Reconocimiento de voz finalizado. Revise la transcripción.');
        }
      };
      speechRecognitionRef.current = recognition;
      recognition.start();
    } catch (error) {
      console.error(error);
      setFluencyRecognitionStatus('No fue posible iniciar el reconocimiento de voz.');
    }
  };

  const startFluency = async () => {
    setFluencyAudioUrl('');
    setFluencyMicError('');
    setFluencyRecognitionStatus('');
    setFluencyInterimTranscript('');
    setAnswers((current) => ({
      ...current,
      language: { ...current.language, fluencyTranscript: '' },
      administration: { ...current.administration, fluencyStartedAt: Date.now(), fluencyFinishedAt: null, fluencyDurationSeconds: null },
    }));
    fluencyActiveRef.current = true;

    if (answers.consent.audio && navigator.mediaDevices?.getUserMedia && window.MediaRecorder) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...(selectedMicId ? { deviceId: { exact: selectedMicId } } : {}),
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        micPeakRef.current = 0;
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          const audioContext = new AudioContextClass();
          const source = audioContext.createMediaStreamSource(stream);
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 2048;
          source.connect(analyser);
          const samples = new Uint8Array(analyser.fftSize);
          const monitorLevel = () => {
            analyser.getByteTimeDomainData(samples);
            let peak = 0;
            for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128));
            micPeakRef.current = Math.max(micPeakRef.current, peak);
            micMonitorFrameRef.current = window.requestAnimationFrame(monitorLevel);
          };
          monitorLevel();
          audioContextRef.current = audioContext;
        }
        const recorderOptions = { audioBitsPerSecond: 16000 };
        if (MediaRecorder.isTypeSupported?.('audio/webm;codecs=opus')) recorderOptions.mimeType = 'audio/webm;codecs=opus';
        const recorder = new MediaRecorder(stream, recorderOptions);
        mediaChunksRef.current = [];
        recorder.ondataavailable = (event) => { if (event.data?.size) mediaChunksRef.current.push(event.data); };
        recorder.onerror = (event) => setFluencyMicError(`Error de grabación: ${event.error?.message || 'desconocido'}`);
        recorder.onstop = () => {
          const blob = new Blob(mediaChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          if (micMonitorFrameRef.current) window.cancelAnimationFrame(micMonitorFrameRef.current);
          micMonitorFrameRef.current = null;
          audioContextRef.current?.close?.();
          audioContextRef.current = null;
          if (blob.size > 0) {
            const objectUrl = URL.createObjectURL(blob);
            setFluencyAudioUrl(objectUrl);
            if (blob.size <= MAX_FLUENCY_AUDIO_BYTES) {
              blobToDataUrl(blob)
                .then((dataUrl) => setAnswers((current) => ({
                  ...current,
                  language: {
                    ...current.language,
                    fluencyAudioDataUrl: dataUrl,
                    fluencyAudioMime: recorder.mimeType || 'audio/webm',
                    fluencyAudioSize: blob.size,
                  },
                })))
                .catch(() => setFluencyMicError('La grabación se creó, pero no se pudo preparar para conservarla en el registro.'));
            } else {
              setAnswers((current) => ({
                ...current,
                language: { ...current.language, fluencyAudioDataUrl: '', fluencyAudioMime: recorder.mimeType || 'audio/webm', fluencyAudioSize: blob.size },
              }));
              setFluencyMicError(`La grabación pesa ${Math.round(blob.size / 1024)} KB y puede exceder el límite seguro de Firebase. Descárguela localmente antes de salir.`);
            }
          }
          if (blob.size === 0) {
            setFluencyMicError('La grabación terminó sin datos. Verifique el micrófono y sus permisos.');
          } else if (micPeakRef.current < 3) {
            setFluencyMicError('La grabación se creó, pero no contiene una señal de voz detectable. Revise en Windows y en el navegador cuál micrófono está seleccionado antes de repetir la prueba.');
          }
          stream.getTracks().forEach((track) => track.stop());
          setFluencyRecording(false);
        };
        mediaRecorderRef.current = recorder;
        recorder.start(1000);
        setFluencyRecording(true);
        startSpeechRecognition();
      } catch (error) {
        console.error(error);
        setFluencyMicError('No fue posible acceder al micrófono. Revise el permiso del navegador y vuelva a intentar.');
      }
    } else if (answers.consent.audio) {
      setFluencyMicError('Este navegador no permite grabar audio con MediaRecorder.');
      startSpeechRecognition();
    }
    setFluencyActive(true);
  };

  const finishFluency = () => {
    fluencyActiveRef.current = false;
    setFluencyActive(false);
    setFluencyFinished(true);
    const finishedAt = Date.now();
    setAnswers((current) => {
      const startedAt = current.administration?.fluencyStartedAt || finishedAt;
      return {
        ...current,
        administration: {
          ...current.administration,
          fluencyFinishedAt: finishedAt,
          fluencyDurationSeconds: Math.round((finishedAt - startedAt) / 1000),
        },
      };
    });
    try { speechRecognitionRef.current?.stop(); } catch (_) { /* sin acción */ }
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
  };

  const scoreObjective = (record) => {
    const currentCfg = Object.values(VERSION_CONFIG).find((item) => item.version === record.version) || cfg;
    let attention = 0;
    const forward = normalize(record.attention.forward).replace(/\s/g, '');
    const backward = normalize(record.attention.backward).replace(/\s/g, '');
    if (forward === currentCfg.forwardDigits.join('')) attention += 1;
    if (backward === currentCfg.backwardExpected) attention += 1;
    const vigilanceErrors = Number(record.attention.vigilanceFalseAlarms || 0) + Number(record.attention.vigilanceOmissions || 0);
    if (vigilanceErrors <= 1) attention += 1;

    let serialCorrect = 0;
    let previous = currentCfg.serialStart;
    record.attention.serial7.forEach((raw) => {
      const value = Number(raw);
      if (Number.isFinite(value) && value === previous - 7) serialCorrect += 1;
      if (Number.isFinite(value)) previous = value;
    });
    attention += serialCorrect >= 4 ? 3 : serialCorrect >= 2 ? 2 : serialCorrect === 1 ? 1 : 0;

    const freeNormalized = record.delayedRecall.free.map(normalize);
    const freeCorrect = currentCfg.words.filter((word) => freeNormalized.includes(normalize(word))).length;
    let categoryCorrect = 0;
    let choiceCorrect = 0;
    currentCfg.words.forEach((word) => {
      if (freeNormalized.includes(normalize(word))) return;
      if (normalize(record.delayedRecall.category[word]) === normalize(word)) categoryCorrect += 1;
      else if (normalize(record.delayedRecall.multipleChoice[word]) === normalize(word)) choiceCorrect += 1;
    });
    const mis = freeCorrect * 3 + categoryCorrect * 2 + choiceCorrect;

    const today = todayParts();
    const orientation = [
      Number(record.orientation.day) === today.day,
      Number(record.orientation.month) === today.month,
      Number(record.orientation.year) === today.year,
      normalize(record.orientation.weekday) === normalize(today.weekday),
      isAcceptedOrientationText(record.orientation.place, ORIENTATION_CONTEXT.acceptedPlaces),
      isAcceptedOrientationText(record.orientation.city, ORIENTATION_CONTEXT.acceptedCities),
    ].filter(Boolean).length;

    return { attention, freeRecall: freeCorrect, mis, orientation };
  };

  const buildFinalScore = (record) => {
    const objective = scoreObjective(record);
    const manualScores = record.manualScores || {};
    const manualTotal = ['trail', 'copy', 'clock', 'naming', 'repetition', 'fluency', 'abstraction']
      .reduce((sum, key) => sum + Number(manualScores[key] || 0), 0);
    const base = manualTotal + objective.attention + objective.freeRecall + objective.orientation;
    const educationAdjustment = Number(record.participant.educationYears) <= 12 ? 1 : 0;
    return {
      objective,
      base,
      educationAdjustment,
      total: Math.min(30, base + educationAdjustment),
      complete: Boolean(record.evaluatorReviewed),
    };
  };

  const validateBeforeSave = () => {
    const p = answers.participant;
    const o = answers.orientation;
    if (!p.name || !p.age || p.educationYears === '' || !p.birthDate || !p.sex) return 'Complete nombre, edad, escolaridad, fecha de nacimiento y sexo del participante.';
    if (Number(p.age) < 18 || Number(p.age) > 120) return 'La edad debe estar entre 18 y 120 años.';
    if (Number(p.educationYears) < 0 || Number(p.educationYears) > 40) return 'La escolaridad debe estar entre 0 y 40 años completos.';
    if (!/^\d{1,2}$/.test(String(o.day)) || Number(o.day) < 1 || Number(o.day) > 31) return 'En orientación, el día del mes debe ser numérico y estar entre 1 y 31.';
    if (!/^\d{1,2}$/.test(String(o.month)) || Number(o.month) < 1 || Number(o.month) > 12) return 'En orientación, el mes debe ser numérico y estar entre 1 y 12.';
    if (!/^\d{4}$/.test(String(o.year))) return 'En orientación, el año debe capturarse con cuatro dígitos.';
    if (![o.weekday, o.place, o.city].every((item) => String(item).trim())) return 'Registre día de la semana, lugar exacto y ciudad/localidad.';
    return '';
  };

  const saveResult = async () => {
    const validation = validateBeforeSave();
    if (validation) {
      setSaveError(validation);
      return;
    }
    if (!user || !authReady) {
      setSaveError('No hay conexión autenticada con Firebase.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const completed = {
        ...answers,
        administration: { ...answers.administration, completedAt: Date.now() },
        objectiveScores: scoreObjective(answers),
        evaluatorReviewed: false,
        manualScores: null,
        createdAt: Date.now(),
        uid: user.uid,
        status: 'Pendiente de revisión profesional',
      };
      const reference = await addDoc(collection(db, ...RESULTS_PATH), cleanFirestore(completed));
      setSaveMessage(`Registro guardado. Folio: ${reference.id}`);
      setStep(15);
    } catch (error) {
      console.error(error);
      setSaveError(`${error.code || 'Error'}: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteResult = async (id) => {
    if (!window.confirm('Esta acción eliminará definitivamente el registro. ¿Continuar?')) return;
    await deleteDoc(doc(db, ...RESULTS_PATH, id));
    if (selected?.id === id) setSelected(null);
  };

  const saveManualReview = async () => {
    if (!selected) return;
    const payload = { ...selected, manualScores: manual, evaluatorReviewed: true, reviewedAt: Date.now() };
    const finalScore = buildFinalScore(payload);
    const domains = buildDomainScores(manual, finalScore.objective);
    const pairedRecord = findPairedRecord(results, selected);
    const comparison = buildPrePostComparison(selected, finalScore, pairedRecord);
    const analyticSummary = buildInterpretation(finalScore, domains, comparison);
    const selectedCfg = Object.values(VERSION_CONFIG).find((item) => item.version === selected.version) || cfg;
    const fluencyValidation = {
      fluencyValidatedTranscript: toUpper(fluencyReviewText),
      fluencyValidatedCandidates: analyzeFluencyTranscript(fluencyReviewText, selectedCfg.fluencyLetter).validCandidates.map((item) => toUpper(item)),
      fluencyValidatedAt: Date.now(),
    };
    await updateDoc(doc(db, ...RESULTS_PATH, selected.id), {
      manualScores: manual,
      evaluatorReviewed: true,
      reviewedAt: Date.now(),
      finalScore,
      domainScores: domains,
      analyticSummary,
      professionalReview: fluencyValidation,
      status: 'Revisado por evaluador',
    });
    setSelected((current) => current ? ({ ...current, manualScores: manual, evaluatorReviewed: true, reviewedAt: Date.now(), finalScore, domainScores: domains, analyticSummary, professionalReview: fluencyValidation, status: 'Revisado por evaluador' }) : current);
  };

  const saveProtocolProfile = async (payload) => {
    if (!user || !authReady) { alert('No hay conexión autenticada con Firebase.'); return; }
    await addDoc(collection(db, ...PROTOCOL_PROFILES_PATH), cleanFirestore({ ...payload, createdAt: Date.now(), uid: user.uid, module: 'profile_tech_screening' }));
  };

  const saveProtocolExposureLog = async (payload) => {
    if (!user || !authReady) { alert('No hay conexión autenticada con Firebase.'); return; }
    await addDoc(collection(db, ...PROTOCOL_EXPOSURE_LOGS_PATH), cleanFirestore({ ...payload, createdAt: Date.now(), uid: user.uid, module: 'ia_exposure_log' }));
  };

  const saveProtocolInterview = async (payload) => {
    if (!user || !authReady) { alert('No hay conexión autenticada con Firebase.'); return; }
    await addDoc(collection(db, ...PROTOCOL_INTERVIEWS_PATH), cleanFirestore({ ...payload, createdAt: Date.now(), uid: user.uid, module: 'qualitative_interview' }));
  };

  const deleteProtocolProfile = async (id) => {
    if (!window.confirm('Eliminar este perfil/checklist del protocolo?')) return;
    await deleteDoc(doc(db, ...PROTOCOL_PROFILES_PATH, id));
  };

  const deleteProtocolExposureLog = async (id) => {
    if (!window.confirm('Eliminar esta sesión de bitácora?')) return;
    await deleteDoc(doc(db, ...PROTOCOL_EXPOSURE_LOGS_PATH, id));
  };

  const deleteProtocolInterview = async (id) => {
    if (!window.confirm('Eliminar esta entrevista?')) return;
    await deleteDoc(doc(db, ...PROTOCOL_INTERVIEWS_PATH, id));
  };

  const openEvaluatorLogin = () => {
    setEvaluatorPassword('');
    setEvaluatorLoginMessage('');
    setShowEvaluatorPassword(false);
    setScreen(evaluatorUnlocked ? 'evaluator' : 'evaluatorLogin');
  };

  const goToTests = () => {
    const inStartedTest = screen === 'test' && step > 0 && step < 15;
    if (inStartedTest && !window.confirm('Hay una evaluación en curso. Si cambia de pantalla puede perder la captura no guardada. ¿Continuar?')) return;
    setScreen('phase');
  };

  const handleEvaluatorLogin = async () => {
    setEvaluatorLoginMessage('');
    if (!evaluatorPassword.trim()) {
      setEvaluatorLoginMessage('Escriba la contraseña de investigadores.');
      return;
    }
    setEvaluatorLoginBusy(true);
    try {
      const inputHash = await hashText(evaluatorPassword.trim());
      const expectedHash = await getEvaluatorPasswordHash();
      if (inputHash === expectedHash) {
        setEvaluatorUnlocked(true);
        setEvaluatorPassword('');
        setShowEvaluatorPassword(false);
        setScreen('evaluator');
      } else {
        setEvaluatorLoginMessage('Contraseña incorrecta.');
      }
    } catch (error) {
      console.error(error);
      setEvaluatorLoginMessage('No fue posible validar la contraseña. Revise la conexión o intente de nuevo.');
    } finally {
      setEvaluatorLoginBusy(false);
    }
  };

  const openPasswordDialog = () => {
    setPasswordForm({ current: '', next: '', confirm: '' });
    setPasswordChangeMessage('');
    setPasswordChangeError('');
    setShowPasswordDialogFields(false);
    setPasswordDialogOpen(true);
  };

  const changeEvaluatorPassword = async () => {
    setPasswordChangeMessage('');
    setPasswordChangeError('');
    const current = passwordForm.current.trim();
    const nextPassword = passwordForm.next.trim();
    const confirmPassword = passwordForm.confirm.trim();
    if (!current || !nextPassword || !confirmPassword) {
      setPasswordChangeError('Complete la contraseña anterior, la nueva y la confirmación.');
      return;
    }
    if (nextPassword.length < 6) {
      setPasswordChangeError('La nueva contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (nextPassword !== confirmPassword) {
      setPasswordChangeError('La nueva contraseña y su repetición no coinciden.');
      return;
    }
    if (current === nextPassword) {
      setPasswordChangeError('La nueva contraseña debe ser diferente de la anterior.');
      return;
    }
    setPasswordChanging(true);
    try {
      const expectedHash = await getEvaluatorPasswordHash();
      const currentHash = await hashText(current);
      if (currentHash !== expectedHash) {
        setPasswordChangeError('La contraseña anterior no es correcta.');
        return;
      }
      const newHash = await hashText(nextPassword);
      await saveEvaluatorPasswordHash(newHash);
      setPasswordChangeMessage('Contraseña actualizada correctamente.');
      setPasswordForm({ current: '', next: '', confirm: '' });
      window.setTimeout(() => setPasswordDialogOpen(false), 800);
    } catch (error) {
      console.error(error);
      setPasswordChangeError('No fue posible guardar la nueva contraseña. Intente nuevamente.');
    } finally {
      setPasswordChanging(false);
    }
  };

  const renderPasswordDialog = () => passwordDialogOpen && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black text-slate-900">Cambiar contraseña</h2>
            <p className="mt-1 text-sm text-slate-500">Actualice el acceso al panel de investigadores.</p>
          </div>
          <button type="button" onClick={() => setPasswordDialogOpen(false)} className="rounded-full bg-slate-100 px-3 py-1 font-black text-slate-600">×</button>
        </div>
        <div className="mt-5 space-y-4">
          <label className="block text-sm font-black text-slate-700">Contraseña anterior
            <input type={showPasswordDialogFields ? 'text' : 'password'} className="mt-2 w-full rounded-xl border-2 border-slate-200 p-3 font-normal" value={passwordForm.current} onChange={(e) => setPasswordForm((currentForm) => ({ ...currentForm, current: e.target.value }))} />
          </label>
          <label className="block text-sm font-black text-slate-700">Nueva contraseña
            <input type={showPasswordDialogFields ? 'text' : 'password'} className="mt-2 w-full rounded-xl border-2 border-slate-200 p-3 font-normal" value={passwordForm.next} onChange={(e) => setPasswordForm((currentForm) => ({ ...currentForm, next: e.target.value }))} />
          </label>
          <label className="block text-sm font-black text-slate-700">Repetir nueva contraseña
            <input type={showPasswordDialogFields ? 'text' : 'password'} className="mt-2 w-full rounded-xl border-2 border-slate-200 p-3 font-normal" value={passwordForm.confirm} onChange={(e) => setPasswordForm((currentForm) => ({ ...currentForm, confirm: e.target.value }))} />
          </label>
          <label className="flex items-center gap-2 text-sm font-bold text-slate-600"><input type="checkbox" checked={showPasswordDialogFields} onChange={(e) => setShowPasswordDialogFields(e.target.checked)} /> Mostrar contraseñas</label>
          {passwordChangeError && <p className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{passwordChangeError}</p>}
          {passwordChangeMessage && <p className="rounded-xl bg-green-50 p-3 text-sm font-bold text-green-700">{passwordChangeMessage}</p>}
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setPasswordDialogOpen(false)} className="rounded-xl border border-slate-200 px-5 py-3 font-black text-slate-700">Cancelar</button>
            <button type="button" disabled={passwordChanging} onClick={changeEvaluatorPassword} className="rounded-xl bg-violet-700 px-5 py-3 font-black text-white disabled:opacity-50">{passwordChanging ? 'Guardando…' : 'Guardar cambio'}</button>
          </div>
        </div>
      </div>
    </div>
  );

  const progress = Math.round((step / totalSteps) * 100);

  if (screen === 'home') {
    return (
      <div className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto mt-16 max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl">
          <header className="bg-gradient-to-r from-blue-900 to-violet-900 px-8 py-14 text-center text-white">
            <h1 className="text-5xl font-black">PANEG</h1>
            <p className="mt-3 text-lg">Aplicación supervisada de evaluación neurocognitiva para investigación</p>
          </header>
          <div className="grid gap-6 p-8 md:grid-cols-2">
            <button onClick={() => setScreen('phase')} className="rounded-2xl border-2 border-blue-100 bg-blue-50 p-8 text-left hover:border-blue-500">
              <span className="text-4xl">📝</span>
              <h2 className="mt-4 text-2xl font-black text-slate-900">Participante</h2>
              <p className="mt-2 text-slate-600">Consentimiento, registro y aplicación supervisada.</p>
            </button>
            <button onClick={openEvaluatorLogin} className="rounded-2xl border-2 border-violet-100 bg-violet-50 p-8 text-left hover:border-violet-500">
              <span className="text-4xl">🔬</span>
              <h2 className="mt-4 text-2xl font-black text-slate-900">Investigadores</h2>
              <p className="mt-2 text-slate-600">Revisión profesional, puntuación y gestión de registros.</p>
            </button>
          </div>
          <p className="px-8 pb-8 text-xs text-slate-500">
            Prototipo de investigación. La validez clínica y la autorización de uso requieren cumplimiento de las condiciones del titular del instrumento y validación formal.
          </p>
        </div>
      </div>
    );
  }

  if (screen === 'phase') {
    return (
      <div className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto flex max-w-5xl justify-end gap-2">
          <button type="button" onClick={() => setScreen('home')} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700">Inicio</button>
          <button type="button" onClick={openEvaluatorLogin} className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-black text-white">Investigadores</button>
        </div>
        <div className="mx-auto mt-8 max-w-xl rounded-3xl bg-white p-10 shadow-xl">
          <h2 className="text-center text-3xl font-black text-slate-900">Seleccione la fase</h2>
          <div className="mt-8 grid grid-cols-2 gap-4">
            {Object.keys(VERSION_CONFIG).map((key) => (
              <button
                key={key}
                onClick={() => setPhase(key)}
                className={`rounded-2xl border-2 p-6 font-black ${phase === key ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-200'}`}
              >
                {key}<span className="mt-2 block text-sm font-medium">MoCA {VERSION_CONFIG[key].version}</span>
              </button>
            ))}
          </div>
          <button onClick={startPhase} className={`mt-8 w-full rounded-xl py-4 font-black text-white ${theme}`}>Continuar</button>
          <button onClick={() => setScreen('home')} className="mt-4 w-full text-sm font-bold text-slate-500">Volver</button>
        </div>
      </div>
    );
  }

  if (screen === 'consent') {
    return (
      <div className="min-h-screen bg-slate-100 p-4 md:p-8">
        <div className="mx-auto mb-4 flex max-w-5xl justify-end gap-2">
          <button type="button" onClick={goToTests} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700">Tests</button>
          <button type="button" onClick={openEvaluatorLogin} className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-black text-white">Investigadores</button>
        </div>
        <div className="mx-auto max-w-3xl rounded-3xl bg-white p-6 shadow-xl md:p-10">
          <h1 className="text-3xl font-black text-slate-900">{consentText.title}</h1>
          <div className="mt-6 max-h-[55vh] space-y-5 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-5">
            {consentText.body.map(([title, text]) => (
              <section key={title}>
                <h2 className="font-black text-slate-800">{title}</h2>
                <p className="mt-1 leading-relaxed text-slate-600">{text}</p>
              </section>
            ))}
          </div>
          <div className="mt-6 space-y-4">
            <label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={answers.consent.read} onChange={(e) => setAnswers((c) => ({ ...c, consent: { ...c.consent, read: e.target.checked } }))}/><span>Declaro que leí y comprendí la información anterior.</span></label>
            <label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={answers.consent.participate} onChange={(e) => setAnswers((c) => ({ ...c, consent: { ...c.consent, participate: e.target.checked } }))}/><span>Acepto participar voluntariamente en esta investigación.</span></label>
            <label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={answers.consent.adult} onChange={(e) => setAnswers((c) => ({ ...c, consent: { ...c.consent, adult: e.target.checked } }))}/><span>Declaro que tengo 18 años o más.</span></label>
            <label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={answers.consent.audio} onChange={(e) => setAnswers((c) => ({ ...c, consent: { ...c.consent, audio: e.target.checked } }))}/><span>Autorizo, de manera independiente, la grabación de fragmentos de voz cuando el protocolo la habilite.</span></label>
            <input className="w-full rounded-xl border-2 border-slate-200 p-4 uppercase" placeholder="Nombre del participante" value={answers.consent.participantName} onChange={(e) => setAnswers((c) => ({ ...c, consent: { ...c.consent, participantName: toUpper(e.target.value) } }))}/>
            {(!answers.consent.read || !answers.consent.participate || !answers.consent.adult || !answers.consent.audio || !answers.consent.participantName.trim()) && <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800">Para continuar debe aceptar todos los consentimientos, incluida la autorización de audio, y capturar el nombre del participante.</p>}
          </div>
          <button disabled={!answers.consent.read || !answers.consent.participate || !answers.consent.adult || !answers.consent.audio || !answers.consent.participantName.trim()} onClick={acceptConsent} className={`mt-6 w-full rounded-xl py-4 font-black text-white disabled:opacity-40 ${theme}`}>Acepto y deseo continuar</button>
          <button onClick={() => setScreen('home')} className="mt-3 w-full rounded-xl py-3 font-bold text-slate-600">No acepto / salir</button>
        </div>
      </div>
    );
  }

  if (screen === 'evaluatorLogin') {
    return (
      <div className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto flex max-w-5xl justify-end gap-2">
          <button type="button" onClick={goToTests} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700">Tests</button>
          <button type="button" onClick={() => setScreen('home')} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-black text-white">Inicio</button>
        </div>
        <div className="mx-auto mt-16 max-w-md rounded-3xl bg-white p-10 shadow-xl">
          <h2 className="text-3xl font-black">Acceso de investigadores</h2>
          <p className="mt-2 text-sm text-slate-500">Ingrese la contraseña para revisar resultados y administrar registros.</p>
          <div className="mt-8">
            <label className="text-sm font-black text-slate-700">Contraseña</label>
            <div className="mt-2 flex overflow-hidden rounded-xl border-2 border-slate-200 bg-white">
              <input type={showEvaluatorPassword ? 'text' : 'password'} className="min-w-0 flex-1 p-4 outline-none" placeholder="Contraseña" value={evaluatorPassword} onChange={(e) => setEvaluatorPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleEvaluatorLogin(); }} />
              <button type="button" onClick={() => setShowEvaluatorPassword((current) => !current)} className="border-l px-4 text-sm font-black text-violet-700">{showEvaluatorPassword ? 'Ocultar' : 'Ver'}</button>
            </div>
          </div>
          {evaluatorLoginMessage && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{evaluatorLoginMessage}</p>}
          <button disabled={evaluatorLoginBusy} onClick={handleEvaluatorLogin} className="mt-4 w-full rounded-xl bg-violet-600 py-4 font-black text-white disabled:opacity-50">{evaluatorLoginBusy ? 'Validando…' : 'Ingresar'}</button>
          <button onClick={() => setScreen('home')} className="mt-4 w-full text-sm font-bold text-slate-500">Volver</button>
        </div>
      </div>
    );
  }


  const selectForProfessionalReview = (row) => {
    const rowCfg = Object.values(VERSION_CONFIG).find((item) => item.version === row.version) || cfg;
    setSelected(row);
    const existingReviewText = row.professionalReview?.fluencyValidatedTranscript || row.language?.fluencyTranscript || '';
    setManual(row.manualScores || {
      trail: 0,
      copy: 0,
      clock: 0,
      naming: suggestedNamingScore(row, rowCfg),
      repetition: suggestedRepetitionScore(row, rowCfg),
      fluency: analyzeFluencyTranscript(existingReviewText, rowCfg.fluencyLetter).suggestedPoint,
      abstraction: suggestedAbstractionScore(row, rowCfg),
    });
    setFluencyReviewText(toUpper(existingReviewText));
  };

  const openResultsDashboard = (row) => {
    if (!row) return;
    // Forzar actualización aun cuando se pulse dos veces el mismo registro
    // y desplazar hacia el tablero inferior después de que React pinte el cambio.
    setSelectedAnalysis({ ...row });
    const scrollToDashboard = () => resultsDashboardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        scrollToDashboard();
        window.setTimeout(scrollToDashboard, 180);
      });
    }
  };

  if (screen === 'evaluator') {
    return (
      <div className="min-h-screen bg-slate-100 p-4 md:p-8">
        <div className="mx-auto max-w-[1500px]">
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-black">Panel de investigadores</h1>
              <p className="mt-1 text-sm text-slate-500">Revisión profesional arriba; tablero analítico integrado en la parte inferior.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={goToTests} className="rounded-lg border border-blue-200 bg-white px-4 py-2 font-black text-blue-700 hover:bg-blue-50">Ir a tests</button>
              <button type="button" onClick={openPasswordDialog} className="rounded-lg bg-violet-700 px-4 py-2 font-black text-white hover:bg-violet-800">Cambiar contraseña</button>
              <button onClick={() => { setEvaluatorUnlocked(false); setEvaluatorPassword(''); setSelected(null); setSelectedAnalysis(null); setManual({ trail: 0, copy: 0, clock: 0, naming: 0, repetition: 0, fluency: 0, abstraction: 0 }); setScreen('home'); }} className="rounded-lg bg-slate-800 px-4 py-2 font-bold text-white">Salir</button>
            </div>
          </div>
          {renderPasswordDialog()}
          <ProtocolCompliancePanel results={results} />
          <ProtocolResearchModule results={results} profiles={protocolProfiles} exposureLogs={protocolExposureLogs} interviews={protocolInterviews} onSaveProfile={saveProtocolProfile} onSaveLog={saveProtocolExposureLog} onSaveInterview={saveProtocolInterview} onDeleteProfile={deleteProtocolProfile} onDeleteLog={deleteProtocolExposureLog} onDeleteInterview={deleteProtocolInterview} />
          <div className="grid gap-6 xl:grid-cols-[minmax(860px,1.35fr)_minmax(420px,0.65fr)]">
            <div className="rounded-2xl bg-white shadow">
              <div className="border-b p-4">
                <h2 className="text-lg font-black">Listado de participantes</h2>
                <p className="text-sm text-slate-500">Los registros se revisan desde la tabla. El tablero inferior permite abrir la vista detallada de resultados por participante.</p>
              </div>
              <div className="max-h-[52vh] overflow-y-auto overflow-x-hidden">
                <table className="w-full table-fixed text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-100 text-xs uppercase tracking-wide text-slate-500"><tr><th className="w-[32%] p-4">Participante</th><th className="w-[13%]">Fase</th><th className="w-[18%]">Estado</th><th className="w-[10%]">Total</th><th className="w-[27%] p-4">Acciones</th></tr></thead>
                  <tbody>{results.map((row) => <tr key={row.id} className="border-t align-middle hover:bg-slate-50"><td className="p-4 font-bold"><span className="block truncate text-slate-900">{row.participant?.name}</span><span className="block truncate text-xs font-normal text-slate-400" title={row.id}>{row.id}</span></td><td className="font-bold">{row.phase}<span className="block text-xs font-normal text-slate-500">MoCA {row.version}</span></td><td className="pr-2">{row.status}</td><td className="font-black">{row.finalScore?.complete ? `${row.finalScore.total}/30` : "Pendiente"}</td><td className="p-4"><div className="flex flex-row flex-nowrap items-center justify-start gap-2"><button type="button" onClick={() => selectForProfessionalReview(row)} className="min-w-[86px] rounded-lg bg-blue-600 px-3 py-2 text-sm font-black text-white">Revisar</button><button type="button" onClick={() => deleteResult(row.id)} className="min-w-[86px] rounded-lg bg-red-600 px-3 py-2 text-sm font-black text-white">Eliminar</button></div></td></tr>)}</tbody>
                </table>
                {results.length === 0 && <p className="p-10 text-center text-slate-500">No hay registros.</p>}
              </div>
            </div>
            <div className="max-h-[82vh] overflow-y-auto rounded-2xl bg-white p-6 shadow">
              {!selected ? <p className="text-slate-500">Seleccione un registro para revisar.</p> : <>
                <h2 className="text-xl font-black">Revisión profesional organizada por dominio</h2>
                <p className="mt-1 text-sm text-slate-500">{selected.participant?.name} · {selected.phase} · versión {selected.version}</p>
                {(() => {
                  const selectedCfg = Object.values(VERSION_CONFIG).find((item) => item.version === selected.version) || cfg;
                  const objective = scoreObjective(selected);
                  const provisional = buildFinalScore({ ...selected, manualScores: manual, evaluatorReviewed: true });
                  const domains = buildDomainScores(manual, objective);
                  const pairedRecord = findPairedRecord(results, selected);
                  const pairedObjective = pairedRecord ? scoreObjective(pairedRecord) : null;
                  const pairedDomains = pairedRecord?.manualScores && pairedObjective ? buildDomainScores(pairedRecord.manualScores, pairedObjective) : [];
                  const comparison = buildPrePostComparison(selected, provisional, pairedRecord);
                  const interpretation = buildInterpretation(provisional, domains, comparison);
                  const itemEvidence = buildItemEvidence({ ...selected, objectiveScores: objective }, manual, selectedCfg);
                  return <div className="mt-5 space-y-6">
                    <section className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-lg font-black">1. Visuoespacial / ejecutiva · Alternancia</h3><ScoreInput label="Alternancia" max={1} value={manual.trail} onChange={(value)=>setManual((c)=>({...c,trail:value}))}/></div>
                      <TrailEvidence stimulus={selectedCfg.trailImage} drawing={selected.trail?.drawing}/><ScoringGuide><p><strong>Asigne 1 punto</strong> únicamente si la secuencia es 1–A–2–B–3–C–4–D–5–E, sin líneas cruzadas.</p><p>Asigne 0 puntos si hay un error no autocorregido inmediatamente o si se conecta E con 1.</p></ScoringGuide>
                    </section>

                    <section className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-lg font-black">2. Visuoconstrucción · {selected.version === '8.1' ? 'Cubo' : 'Cama'}</h3><ScoreInput label={selected.version === '8.1' ? 'Cubo' : 'Cama'} max={1} value={manual.copy} onChange={(value)=>setManual((c)=>({...c,copy:value}))}/></div>
                      <DrawingEvidence stimulus={selectedCfg.copyImage} drawing={selected.copyDrawing} stimulusLabel={`Modelo de ${selected.version === '8.1' ? 'cubo' : 'cama'}`}/><ScoringGuide><p><strong>Asigne 1 punto</strong> solo si se cumplen todos los criterios: dibujo tridimensional, todas las líneas presentes, líneas conectadas con poco o ningún espacio, sin líneas añadidas, líneas relativamente paralelas y de longitud semejante, y orientación espacial conservada.</p><p>Si falla cualquiera de estos criterios, asigne 0 puntos.</p></ScoringGuide>
                    </section>

                    <section className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-lg font-black">3. Visuoconstrucción · Reloj ({selectedCfg.clockText})</h3><ScoreInput label="Reloj" max={3} value={manual.clock} onChange={(value)=>setManual((c)=>({...c,clock:value}))}/></div>
                      <DrawingEvidence drawing={selected.clockDrawing} stimulusLabel={`Instrucción: marcar ${selectedCfg.clockText}`} responseLabel="Reloj del participante"/>
                      <p className="mt-3 text-sm text-slate-600">Califique por separado contorno, números y manecillas; el valor capturado corresponde a la suma de esos tres criterios.</p><ScoringGuide><p><strong>Contorno (1):</strong> círculo o cuadrado cerrado; solo se aceptan deformaciones leves.</p><p><strong>Números (1):</strong> todos presentes, sin extras, en orden correcto y ubicados aproximadamente en sus cuadrantes; todos dentro o todos fuera del contorno.</p><p><strong>Manecillas (1):</strong> dos manecillas unidas, hora correcta, la horaria claramente más corta y ambas centradas.</p></ScoringGuide>
                    </section>

                    <section className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-lg font-black">4. Denominación</h3><ScoreInput label="Denominación" max={3} value={manual.naming} onChange={(value)=>setManual((c)=>({...c,naming:value}))}/></div>
                      <div className="grid gap-3 sm:grid-cols-3">{selectedCfg.animalImages.map((src,index)=>{const accepted=(selectedCfg.animalAnswers[index]||[]).map((item)=>toUpper(item));const correct=accepted.map(normalize).includes(normalize(selected.naming?.[index]));return <div key={src} className="rounded-xl border bg-white p-3"><img src={src} alt={`Animal ${index+1}`} className="h-36 w-full object-contain"/><p className="mt-2 text-sm"><strong>Respuesta:</strong> {selected.naming?.[index] || '—'}</p><p className={`mt-1 text-xs font-bold ${correct?'text-green-700':'text-red-700'}`}>{correct?'Coincide con respuesta aceptada':'No coincide automáticamente'}</p><p className="mt-1 text-xs text-slate-500">Aceptadas: {accepted.join(', ')}</p></div>})}</div><p className="mt-3 rounded-lg bg-emerald-100 p-2 text-sm font-bold text-emerald-900">Sugerencia automática: {suggestedNamingScore(selected,selectedCfg)}/3.</p><ScoringGuide><p>Asigne 1 punto por cada animal denominado con una respuesta aceptada para la versión aplicada.</p><p>8.1: LEÓN; RINOCERONTE; CAMELLO o DROMEDARIO. 8.3: CABALLO/PONI/YEGUA/POTRO; TIGRE; PATO.</p><p>La sugerencia automática debe confirmarse si hubo error de escritura o transcripción.</p></ScoringGuide>
                    </section>

                    <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4">
                      <h3 className="text-lg font-black">5. Memoria inmediata · sin puntuación</h3>
                      <div className="mt-3 grid gap-3 md:grid-cols-2"><div className="rounded-xl bg-white p-3"><strong>Intento 1:</strong><p>{(selected.memoryTrial1||[]).join(' / ') || '—'}</p><p className="mt-2 font-bold text-amber-700">{countExactWords(selected.memoryTrial1||[],selectedCfg.words)}/5 correctas</p></div><div className="rounded-xl bg-white p-3"><strong>Intento 2:</strong><p>{(selected.memoryTrial2||[]).join(' / ') || '—'}</p><p className="mt-2 font-bold text-amber-700">{countExactWords(selected.memoryTrial2||[],selectedCfg.words)}/5 correctas</p></div></div><ScoringGuide><p>Los dos ensayos de memoria inmediata <strong>no aportan puntos</strong>. Registre las palabras recordadas en cada intento y verifique que se hayan realizado ambos ensayos, incluso si el primero fue completo.</p></ScoringGuide>
                    </section>

                    <section className="rounded-2xl border border-orange-200 bg-orange-50/40 p-4">
                      <h3 className="text-lg font-black">6. Atención · cálculo automático</h3>
                      <div className="mt-3 grid gap-3 md:grid-cols-2"><div className="rounded-xl bg-white p-3"><p><strong>Dígitos directos:</strong> {selected.attention?.forward || '—'}</p><p><strong>Dígitos inversos:</strong> {selected.attention?.backward || '—'}</p><p className="mt-2"><strong>Vigilancia:</strong> {selected.attention?.vigilanceHits ?? 0} aciertos, {selected.attention?.vigilanceFalseAlarms ?? 0} falsas alarmas, {selected.attention?.vigilanceOmissions ?? 0} omisiones.</p></div><div className="rounded-xl bg-white p-3"><p><strong>Restas:</strong> {(selected.attention?.serial7||[]).join(' / ') || '—'}</p><p className="mt-3 text-2xl font-black">Puntaje automático: {objective.attention}/6</p></div></div><ScoringGuide><p><strong>Dígitos (0–2):</strong> 1 punto por la serie directa correcta y 1 por la inversa correcta.</p><p><strong>Vigilancia (0–1):</strong> 1 punto con 0 o 1 error total. Error total = omisiones + falsas alarmas.</p><p><strong>Restas (0–3):</strong> 0 correctas = 0; 1 correcta = 1; 2–3 correctas = 2; 4–5 correctas = 3. Evalúe cada resta respecto de la respuesta inmediatamente anterior.</p></ScoringGuide>
                    </section>

                    <section className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50/40 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-lg font-black">7. Lenguaje · Repetición</h3><ScoreInput label="Repetición" max={2} value={manual.repetition} onChange={(value)=>setManual((c)=>({...c,repetition:value}))}/></div>
                      <div className="space-y-2 rounded-xl bg-white p-3"><p><strong>Frase 1:</strong> {selected.language?.sentence1 || '—'}</p><p><strong>Frase 2:</strong> {selected.language?.sentence2 || '—'}</p><p className="mt-2 font-bold text-fuchsia-800">Sugerencia automática: {suggestedRepetitionScore(selected,selectedCfg)}/2.</p><p className="text-xs text-slate-500">Solo coincide automáticamente cuando la transcripción es exacta; confirme oralmente los errores gramaticales, omisiones o adiciones.</p></div><ScoringGuide><p>Asigne 1 punto por cada frase repetida exactamente.</p><p>Considere incorrectas las omisiones, adiciones, sustituciones, cambios gramaticales y alteraciones de singular o plural.</p></ScoringGuide>
                    </section>

                    <section className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50/40 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-lg font-black">8. Lenguaje · Fluidez con {selectedCfg.fluencyLetter}</h3><ScoreInput label="Fluidez" max={1} value={manual.fluency} onChange={(value)=>setManual((c)=>({...c,fluency:value}))}/></div>
                      <div className="rounded-xl bg-white p-3"><p className="whitespace-pre-wrap"><strong>Transcripción automática original:</strong> {selected.language?.fluencyTranscript || '—'}</p>{selected.language?.fluencyAudioDataUrl ? <div className="mt-3 rounded-xl border bg-slate-50 p-3"><p className="mb-2 text-sm font-black text-slate-700">Audio de fluidez registrado</p><audio controls src={selected.language.fluencyAudioDataUrl} className="w-full"/></div> : <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-800">No hay audio conservado en Firebase para este registro. Si el archivo excedió el límite seguro, debió descargarse localmente al terminar la prueba.</p>}<label className="mt-4 block text-sm font-black text-slate-700">Validación del investigador: deje solo las palabras/frases que considere válidas<textarea className="mt-2 w-full rounded-xl border-2 p-3 font-normal uppercase" rows="5" value={fluencyReviewText} onChange={(e)=>setFluencyReviewText(toUpper(e.target.value))}/></label>{(() => { const analysis = analyzeFluencyTranscript(fluencyReviewText || selected.language?.fluencyTranscript || '', selectedCfg.fluencyLetter); return <div className="mt-3 rounded-lg bg-indigo-50 p-3 text-sm text-indigo-950"><p><strong>Candidatas únicas tras validación:</strong> {analysis.validCandidates.length} · <strong>Punto sugerido:</strong> {analysis.suggestedPoint}/1</p><p className="mt-1"><strong>Válidas por forma:</strong> {analysis.validCandidates.length ? analysis.validCandidates.join(', ').toUpperCase() : '—'}</p><p className="mt-1"><strong>Repetidas:</strong> {analysis.repeated.length ? analysis.repeated.join(', ').toUpperCase() : '—'}</p><p className="mt-1"><strong>Otra inicial:</strong> {analysis.wrongInitial.length ? analysis.wrongInitial.join(', ').toUpperCase() : '—'}</p><p className="mt-2 text-xs">Después de editar este recuadro, ajuste manualmente el punto de fluidez y presione “Guardar revisión profesional”.</p></div>; })()}<p className="mt-2 text-sm text-slate-500">La transcripción automática es evidencia auxiliar; confirme significado, nombres propios, conjugaciones, variantes de raíz y errores del reconocimiento escuchando el audio cuando esté disponible.</p></div><ScoringGuide><p>Asigne 1 punto si produjo <strong>11 o más palabras válidas en 60 segundos</strong>.</p><p>No cuente nombres propios, números, formas conjugadas de un verbo, repeticiones ni palabras que comiencen con otra letra. Revise manualmente la transcripción automática.</p></ScoringGuide>
                    </section>

                    <section className="rounded-2xl border border-cyan-200 bg-cyan-50/40 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-lg font-black">9. Abstracción</h3><ScoreInput label="Abstracción" max={2} value={manual.abstraction} onChange={(value)=>setManual((c)=>({...c,abstraction:value}))}/></div>
                      <div className="rounded-xl bg-white p-3"><p><strong>{selectedCfg.abstractionPairs[0].join('–')}:</strong> {selected.abstraction?.pair1 || '—'}</p><p className="mt-2 text-xs text-slate-500">Aceptadas: {selectedCfg.abstractionAccepted[0].map(toUpper).join(', ')}</p><p className="mt-3"><strong>{selectedCfg.abstractionPairs[1].join('–')}:</strong> {selected.abstraction?.pair2 || '—'}</p><p className="mt-2 text-xs text-slate-500">Aceptadas: {selectedCfg.abstractionAccepted[1].map(toUpper).join(', ')}</p><p className="mt-2 text-sm">Pista utilizada: {selected.abstraction?.promptUsed ? 'Sí' : 'No'}</p><p className="mt-3 font-bold text-cyan-800">Sugerencia automática: {suggestedAbstractionScore(selected,selectedCfg)}/2.</p></div><ScoringGuide><p>Asigne 1 punto por cada pareja cuya respuesta exprese la categoría abstracta aceptada.</p><p>No acepte semejanzas concretas. En 8.1: tren–bicicleta = transporte/locomoción/para viajar; regla–reloj = medición/para medir. En 8.3: martillo–desarmador = herramientas/carpintería/construcción/instrumentos de trabajo; cerillos–lámpara = luz/iluminación.</p></ScoringGuide>
                    </section>

                    <section className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4">
                      <h3 className="text-lg font-black">10. Recuerdo diferido y MIS · cálculo automático</h3>
                      <div className="mt-3 rounded-xl bg-white p-3"><p><strong>Recuerdo libre:</strong> {(selected.delayedRecall?.free||[]).join(' / ') || '—'}</p><p className="mt-3 text-xl font-black">Recuerdo libre: {objective.freeRecall}/5 · MIS: {objective.mis}/15</p></div><ScoringGuide><p><strong>Recuerdo libre:</strong> 1 punto por cada palabra recordada espontáneamente, sin pistas.</p><p><strong>MIS:</strong> espontánea ×3; con pista de categoría ×2; con elección múltiple ×1. El MIS es una subpuntuación y no se suma de nuevo al total de 30.</p></ScoringGuide>
                    </section>

                    <section className="rounded-2xl border border-slate-300 bg-slate-50 p-4">
                      <h3 className="text-lg font-black">11. Orientación · cálculo automático</h3>
                      <p className="mt-3">{selected.orientation ? `${selected.orientation.day}/${selected.orientation.month}/${selected.orientation.year}; ${selected.orientation.weekday}; ${selected.orientation.place}; ${selected.orientation.city}` : '—'}</p><p className="mt-3 text-xl font-black">Puntaje automático: {objective.orientation}/6</p><ScoringGuide><p>Asigne 1 punto por cada dato correcto: día del mes, mes, año, día de la semana, lugar y ciudad/localidad.</p><p>La fecha y el lugar deben ser exactos; no otorgue el punto por una diferencia de un día.</p></ScoringGuide>
                    </section>

                    <section className="rounded-2xl bg-slate-900 p-5 text-white">
                      <h3 className="text-xl font-black">Resumen de puntuación</h3>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3"><div><span className="text-slate-300">Base</span><p className="text-3xl font-black">{provisional.base}</p></div><div><span className="text-slate-300">Ajuste escolaridad</span><p className="text-3xl font-black">+{provisional.educationAdjustment}</p></div><div><span className="text-slate-300">Total provisional</span><p className="text-3xl font-black">{provisional.total}/30</p></div></div>
                      <p className="mt-3 text-sm text-slate-300">El total queda definitivo al guardar la revisión profesional. No es necesario esperar a que la persona complete ambos tests; cada registro se calcula y revisa por separado.</p><div className="mt-4 rounded-xl bg-slate-800 p-3 text-sm text-slate-200"><p><strong>Ajuste por escolaridad:</strong> agregue 1 punto cuando corresponda según el criterio configurado, sin superar 30 puntos.</p><p className="mt-1"><strong>Interpretación:</strong> el resultado debe ser revisado por un profesional capacitado y no constituye por sí solo un diagnóstico.</p></div>
                    </section>
                  </div>;
                })()}
                <button onClick={saveManualReview} className="mt-6 w-full rounded-xl bg-violet-600 py-3 font-black text-white">Guardar revisión y calcular total definitivo</button>
              </>}
            </div>
          </div>
          <div ref={resultsDashboardRef} className="mt-8">
            {selectedAnalysis ? <div className="space-y-4"><button type="button" onClick={() => setSelectedAnalysis(null)} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-black text-white">Volver al tablero general</button><ParticipantResultsDashboard record={selectedAnalysis} records={results} manualOverride={selected?.id === selectedAnalysis.id ? manual : null} /></div> : <PowerBIResultsDashboard results={results} onOpenResults={openResultsDashboard} />}
          </div>
        </div>
      </div>
    );
  }

  if (screen !== 'test') return null;

  const next = () => setStep((current) => Math.min(15, current + 1));
  return (
    <div className="min-h-screen bg-slate-100 px-4 pb-10 pt-24"><PageHeader phase={phase} version={cfg.version} progress={progress} theme={cfg.theme} onGoHome={goToTests} onGoEvaluator={openEvaluatorLogin}/><PageCard>
      {step === 0 && <div><h2 className="text-3xl font-black">Registro del participante</h2><p className="mt-2 text-slate-500">La aplicación debe ser supervisada por una persona capacitada.</p><div className="mt-6 grid gap-4 md:grid-cols-2"><label className="text-sm font-bold text-slate-700">Nombre del participante<input className="mt-1 w-full rounded-xl border-2 p-4 font-normal uppercase" placeholder="NOMBRE COMPLETO" value={answers.participant.name} onChange={(e) => setParticipant('name', e.target.value)}/></label><label className="text-sm font-bold text-slate-700">Edad<input type="text" inputMode="numeric" maxLength="3" className="mt-1 w-full rounded-xl border-2 p-4 font-normal" placeholder="Ej. 21" value={answers.participant.age} onChange={(e) => setParticipant('age', e.target.value)}/></label><label className="text-sm font-bold text-slate-700">Años completos de escolaridad<input type="text" inputMode="numeric" maxLength="2" className="mt-1 w-full rounded-xl border-2 p-4 font-normal" placeholder="No incluya preescolar o kínder" value={answers.participant.educationYears} onChange={(e) => setParticipant('educationYears', e.target.value)}/><span className="mt-1 block text-xs font-normal text-slate-500">Cuente desde primaria; no incluya preescolar.</span></label><label className="text-sm font-bold text-slate-700">Fecha de nacimiento<input type="date" className="mt-1 w-full rounded-xl border-2 p-4 font-normal" value={answers.participant.birthDate} onChange={(e) => setParticipant('birthDate', e.target.value)}/></label><select className="rounded-xl border-2 p-4" value={answers.participant.sex} onChange={(e) => setParticipant('sex', e.target.value)}><option value="">Sexo</option><option>Mujer</option><option>Hombre</option><option>Otro / prefiere no responder</option></select><select className="rounded-xl border-2 p-4" value={answers.participant.group} onChange={(e) => setParticipant('group', e.target.value)}><option>Experimental (Uso de IAGen)</option><option>Control</option></select></div>{(!answers.participant.name || !answers.participant.age || Number(answers.participant.age) < 18 || Number(answers.participant.age) > 120 || answers.participant.educationYears === '' || Number(answers.participant.educationYears) < 0 || Number(answers.participant.educationYears) > 40 || !answers.participant.birthDate || !answers.participant.sex) && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800">Complete nombre, edad válida, escolaridad, fecha de nacimiento y sexo para continuar.</p>}<NextStepButton themeClass={theme} onClick={next} disabled={!answers.participant.name || !answers.participant.age || Number(answers.participant.age) < 18 || Number(answers.participant.age) > 120 || answers.participant.educationYears === '' || Number(answers.participant.educationYears) < 0 || Number(answers.participant.educationYears) > 40 || !answers.participant.birthDate || !answers.participant.sex}/></div>}

      {step === 1 && <div><h2 className="text-3xl font-black">Alternancia conceptual</h2><p className="mt-2 text-slate-500">Dibuje una línea continua alternando número y letra en orden ascendente, sin unir el final con el inicio.</p><div className="mt-6"><TrailDrawingCanvas image={cfg.trailImage} value={answers.trail.drawing} onChange={(drawing) => setAnswers((c) => ({ ...c, trail: { ...c.trail, drawing } }))}/></div><NextStepButton themeClass={theme} onClick={next} disabled={!answers.trail.drawing}/></div>}

      {step === 2 && <div><h2 className="text-3xl font-black">Copiar {cfg.copyTitle.toLowerCase()}</h2><div className="mt-6 grid gap-6 md:grid-cols-2"><StimulusImage src={cfg.copyImage} alt={`Estímulo ${cfg.copyTitle}`}/><DrawingCanvas label="Dibujo del participante" value={answers.copyDrawing} onChange={(copyDrawing) => setAnswers((c) => ({ ...c, copyDrawing }))}/></div><NextStepButton themeClass={theme} onClick={next}/></div>}

      {step === 3 && <div><h2 className="text-3xl font-black">Reloj</h2><div className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-4 font-bold text-orange-800">El examinador debe asegurarse de que no haya relojes visibles.</div><p className="mt-5 text-lg">Dibuje un reloj con todos los números y marque las <strong>{cfg.clockText}</strong>.</p><div className="mt-6"><DrawingCanvas label="Dibujo del reloj" value={answers.clockDrawing} onChange={(clockDrawing) => setAnswers((c) => ({ ...c, clockDrawing }))}/></div><NextStepButton themeClass={theme} onClick={next}/></div>}

      {step === 4 && <div><h2 className="text-3xl font-black">Denominación</h2><p className="mt-2 text-slate-500">Diga el nombre de cada animal. El examinador registra literalmente la respuesta oral.</p><div className="mt-6 grid gap-5 md:grid-cols-3">{cfg.animalImages.map((src,index)=><div key={src}><StimulusImage src={src} alt={`Animal ${index+1}`}/><input className="mt-3 w-full rounded-xl border-2 p-3" placeholder="Respuesta oral registrada" value={answers.naming[index]} onChange={(e)=>setAnswers((c)=>{const naming=[...c.naming]; naming[index]=lettersOnly(e.target.value); return {...c,naming};})}/></div>)}</div><div className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">Validación automática orientativa: {suggestedNamingScore(answers, cfg)} de 3 respuestas coinciden con las respuestas aceptadas por la guía. La revisión profesional puede corregir variantes orales o errores de transcripción.</div><NextStepButton themeClass={theme} onClick={next}/></div>}

      {step === 5 && <div><h2 className="text-3xl font-black">Memoria · primer intento</h2><p className="mt-2 text-slate-500">Las cinco palabras se presentan auditivamente, una por segundo. No deben mostrarse por escrito al participante.</p><button type="button" disabled={played.memory1} onClick={()=>playTimedSequence(cfg.words,'memory1',()=>setAnswers((c)=>({...c,administration:{...c.administration,memoryLearningCompletedAt:Date.now()}})))} className="mt-6 rounded-xl bg-indigo-600 px-6 py-4 font-black text-white disabled:opacity-50">{played.memory1?'Lista reproducida':'Escuchar lista'}</button><div className="mt-6 grid gap-3 md:grid-cols-5">{answers.memoryTrial1.map((value,index)=><input key={index} className="rounded-xl border-2 p-3 text-center uppercase" placeholder={`Palabra ${index+1}`} value={value} onChange={(e)=>setAnswers((c)=>{const memoryTrial1=[...c.memoryTrial1]; memoryTrial1[index]=lettersOnly(e.target.value); return {...c,memoryTrial1};})}/>)}</div><p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800">Registro automático del intento 1: {countExactWords(answers.memoryTrial1, cfg.words)} de 5 palabras correctas. Este ensayo no suma puntos al total MoCA.</p><NextStepButton themeClass={theme} onClick={next} disabled={!played.memory1}/></div>}

      {step === 6 && <div><h2 className="text-3xl font-black">Memoria · segundo intento</h2><p className="mt-2 text-slate-500">Repita la misma lista completa, incluso si el primer intento fue exitoso.</p><button type="button" disabled={played.memory2} onClick={()=>playTimedSequence(cfg.words,'memory2',()=>setAnswers((c)=>({...c,administration:{...c.administration,memoryLearningCompletedAt:Date.now()}})))} className="mt-6 rounded-xl bg-indigo-600 px-6 py-4 font-black text-white disabled:opacity-50">{played.memory2?'Lista reproducida':'Escuchar lista otra vez'}</button><div className="mt-6 grid gap-3 md:grid-cols-5">{answers.memoryTrial2.map((value,index)=><input key={index} className="rounded-xl border-2 p-3 text-center uppercase" placeholder={`Palabra ${index+1}`} value={value} onChange={(e)=>setAnswers((c)=>{const memoryTrial2=[...c.memoryTrial2]; memoryTrial2[index]=lettersOnly(e.target.value); return {...c,memoryTrial2};})}/>)}</div><p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800">Registro automático del intento 2: {countExactWords(answers.memoryTrial2, cfg.words)} de 5 palabras correctas. Este ensayo no suma puntos al total MoCA.</p><p className="mt-5 font-bold text-slate-700">Al terminar, informe: “Le volveré a preguntar estas palabras al final de la prueba”.</p><NextStepButton themeClass={theme} onClick={next} disabled={!played.memory2}/></div>}

      {step === 7 && <div><h2 className="text-3xl font-black">Atención · dígitos</h2><div className="mt-6 space-y-6"><section className="rounded-xl bg-slate-50 p-5"><p className="font-bold">Serie hacia delante</p><AudioButton src={publicAsset(`audio/${cfg.folder}/digits-forward.mp3`)} text={cfg.forwardDigits.join(', ')} onceKey="digitsForward" played={played.digitsForward} onPlayed={markPlayed}/><input type="text" inputMode="numeric" maxLength="5" className="mt-4 w-full rounded-xl border-2 p-3 tracking-widest" placeholder="Registrar solo dígitos" value={answers.attention.forward} onChange={(e)=>setAnswers((c)=>({...c,attention:{...c.attention,forward:digitsOnly(e.target.value,5)}}))}/><p className="mt-2 text-xs font-bold text-slate-500">Solo se aceptan números; no escriba letras ni espacios.</p></section><section className="rounded-xl bg-slate-50 p-5"><p className="font-bold">Serie hacia atrás</p><AudioButton src={publicAsset(`audio/${cfg.folder}/digits-backward.mp3`)} text={cfg.backwardDigits.join(', ')} onceKey="digitsBackward" played={played.digitsBackward} onPlayed={markPlayed}/><input type="text" inputMode="numeric" maxLength="3" className="mt-4 w-full rounded-xl border-2 p-3 tracking-widest" placeholder="Registrar solo dígitos en orden inverso" value={answers.attention.backward} onChange={(e)=>setAnswers((c)=>({...c,attention:{...c.attention,backward:digitsOnly(e.target.value,3)}}))}/><p className="mt-2 text-xs font-bold text-slate-500">Solo se aceptan números; no escriba letras ni espacios.</p></section></div><NextStepButton themeClass={theme} onClick={next} disabled={!played.digitsForward || !played.digitsBackward || answers.attention.forward.length !== 5 || answers.attention.backward.length !== 3}/></div>}

      {step === 8 && <div><h2 className="text-3xl font-black">Atención · vigilancia</h2><p className="mt-2 text-slate-500">Escuche una letra por segundo y pulse únicamente cuando oiga A. Las letras no se muestran. La secuencia contiene 29 letras y 11 letras A.</p><div className="mt-8 flex flex-col items-center"><button onClick={startVigilance} disabled={played.vigilance} className="rounded-xl bg-indigo-600 px-6 py-4 font-black text-white disabled:opacity-50">{vigilanceActive?'Secuencia en curso…':played.vigilance?'Secuencia finalizada':'Iniciar secuencia'}</button><button onPointerDown={tapVigilance} disabled={!vigilanceActive} className={`mt-10 h-40 w-40 rounded-full text-3xl font-black text-white shadow-xl transition duration-150 disabled:opacity-40 ${vigilanceTapFeedback ? 'scale-90 bg-green-600 ring-8 ring-green-200' : 'scale-100 bg-red-600'}`}>A</button><p className={`mt-3 h-6 text-sm font-bold ${vigilanceTapFeedback ? 'text-green-700' : 'text-transparent'}`}>Pulsación registrada</p><p className="mt-6 text-sm text-slate-400">Elemento {vigilanceIndex >= 0 ? vigilanceIndex + 1 : 0} de {LETTER_SEQUENCE.length}</p></div><NextStepButton themeClass={theme} onClick={next} disabled={vigilanceActive || !played.vigilance}/></div>}

      {step === 9 && <div><h2 className="text-3xl font-black">Sustracción seriada</h2><p className="mt-2 text-slate-500">Reste mentalmente 7 a partir de {cfg.serialStart}. No use dedos, lápiz, papel o calculadora. Registre cada respuesta sin corregir las anteriores.</p><div className="mt-6 inline-flex items-center rounded-2xl border border-blue-200 bg-blue-50 px-5 py-3 text-xl font-black text-blue-900"><span>Inicio: {cfg.serialStart}</span><span className="mx-3">−</span><span>7</span><span className="mx-3">=</span><span>respuesta 1</span></div><div className="mt-8 grid gap-4 md:grid-cols-5">{answers.attention.serial7.map((value,index)=><label key={index} className="text-center text-xs font-bold uppercase tracking-wide text-slate-500">Respuesta {index+1}<input type="text" inputMode="numeric" maxLength="3" className="mt-2 w-full rounded-xl border-2 p-4 text-center text-xl font-black" value={value} onChange={(e)=>setAnswers((c)=>{const serial7=[...c.attention.serial7]; serial7[index]=digitsOnly(e.target.value,3); return {...c,attention:{...c.attention,serial7}};})}/></label>)}</div><NextStepButton themeClass={theme} onClick={next} disabled={answers.attention.serial7.some((item)=>!String(item).trim())}/></div>}

      {step === 10 && <div><h2 className="text-3xl font-black">Repetición de frases</h2><p className="mt-2 text-slate-500">Cada frase se escucha una sola vez. El participante debe repetirla oralmente cuando termine el audio. El examinador transcribe después de escuchar la respuesta; no es necesario escribir mientras se reproduce la frase.</p>{cfg.sentences.map((sentence,index)=><section key={sentence} className="mt-6 rounded-xl bg-slate-50 p-5"><AudioButton src={publicAsset(`audio/${cfg.folder}/sentence-${index+1}.mp3`)} text={sentence} onceKey={`sentence${index+1}`} played={played[`sentence${index+1}`]} onPlayed={markPlayed} label={`Escuchar frase ${index+1}`} speechRate={0.85}/><textarea className="mt-4 w-full rounded-xl border-2 p-3" rows="3" placeholder="Transcripción literal de la respuesta oral, después de que el participante termine de repetir" value={answers.language[`sentence${index+1}`]} onChange={(e)=>setAnswers((c)=>({...c,language:{...c.language,[`sentence${index+1}`]:lettersOnly(e.target.value)}}))}/></section>)}<div className="mt-4 rounded-xl bg-fuchsia-50 p-3 text-sm font-bold text-fuchsia-800">Puntaje automático sugerido: {suggestedRepetitionScore(answers, cfg)}/2. La guía exige repetición exacta; la revisión profesional debe confirmar omisiones, adiciones, sustituciones y cambios gramaticales.</div><NextStepButton themeClass={theme} onClick={next} disabled={!played.sentence1 || !played.sentence2}/></div>}

      {step === 11 && (
        <div>
          <h2 className="text-3xl font-black">Fluidez verbal</h2>
          <p className="mt-2 text-slate-500">Sí: el participante debe hablar durante 60 segundos y decir el mayor número posible de palabras que comiencen con <strong>{cfg.fluencyLetter}</strong>. No debe escribir durante el minuto.</p>
          <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">La autorización de audio está activa: PANEG grabará este minuto y, cuando el navegador lo permita, transcribirá simultáneamente voz a texto.</div>

          {answers.consent.audio && (
            <div className="mt-4 rounded-xl border bg-white p-4">
              <label className="block text-sm font-black">
                Micrófono de entrada
                <select className="mt-2 w-full rounded-lg border-2 p-3 font-normal" value={selectedMicId} onChange={(e) => setSelectedMicId(e.target.value)}>
                  <option value="">Predeterminado del sistema</option>
                  {microphones.map((device, index) => (
                    <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Micrófono ${index + 1}`}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={testMicrophone} className="mt-3 rounded-lg bg-slate-800 px-4 py-2 font-bold text-white">Probar micrófono durante 4 segundos</button>
              <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-green-600 transition-all" style={{ width: `${micTestLevel}%` }} /></div>
              {micTestStatus && <p className="mt-2 text-sm font-bold text-slate-700">{micTestStatus}</p>}
            </div>
          )}

          <div className="mt-8 flex flex-col items-center">
            {!fluencyFinished && (
              <>
                <Countdown active={fluencyActive} seconds={60} onFinish={finishFluency} />
                <button type="button" onClick={startFluency} disabled={fluencyActive} className="mt-5 rounded-xl bg-indigo-600 px-6 py-4 font-black text-white disabled:opacity-50">
                  {fluencyActive ? (fluencyRecording ? 'Grabando y transcribiendo…' : 'Tiempo en curso…') : 'Iniciar 60 segundos'}
                </button>
                {fluencyActive && (
                  <div className="mt-4 w-full rounded-xl bg-slate-50 p-4 text-sm">
                    <p className="font-bold">{fluencyRecognitionStatus || 'Esperando reconocimiento de voz…'}</p>
                    {fluencyInterimTranscript && <p className="mt-2 text-slate-500">En curso: {fluencyInterimTranscript}</p>}
                    <div className="mt-3 rounded-xl border bg-white p-3">
                      <p className="text-xs font-black uppercase text-slate-500">Palabras escuchadas hasta ahora</p>
                      <p className="mt-2 whitespace-pre-wrap text-slate-800">{answers.language.fluencyTranscript || fluencyInterimTranscript || 'Aún no hay transcripción.'}</p>
                    </div>
                  </div>
                )}
              </>
            )}

            {fluencyFinished && (
              <div className="w-full">
                <p className="font-bold text-green-700">Tiempo finalizado. PANEG generó una transcripción automática cuando el navegador lo permitió; el investigador debe verificarla contra el audio.</p>
                {fluencyMicError && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{fluencyMicError}</div>}
                {fluencyRecognitionStatus && <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">{fluencyRecognitionStatus}</div>}
                {fluencyAudioUrl && (
                  <div className="mt-4 rounded-xl border bg-slate-50 p-4">
                    <audio controls src={fluencyAudioUrl} className="w-full" />
                    <a href={fluencyAudioUrl} download={`PANEG-${phase}-fluidez.webm`} className="mt-3 inline-block font-bold text-blue-700 underline">Descargar grabación local</a>
                    <p className="mt-2 text-xs text-slate-500">Si el audio pesa menos de {Math.round(MAX_FLUENCY_AUDIO_BYTES / 1024)} KB, PANEG también lo conserva dentro del registro para revisión del investigador.</p>
                  </div>
                )}
                <label className="mt-4 block text-sm font-bold text-slate-700">
                  Palabras escuchadas / transcripción editable
                  <textarea className="mt-2 w-full rounded-xl border-2 p-4 font-normal uppercase" rows="6" placeholder="La transcripción aparecerá aquí. También puede corregirse manualmente." value={answers.language.fluencyTranscript} onChange={(e) => setAnswers((c) => ({ ...c, language: { ...c.language, fluencyTranscript: toUpper(e.target.value) } }))} />
                </label>
                {(() => {
                  const analysis = analyzeFluencyTranscript(answers.language.fluencyTranscript, cfg.fluencyLetter);
                  return (
                    <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-950">
                      <p className="font-black">Análisis automático auxiliar</p>
                      <p className="mt-2">Candidatas únicas con {cfg.fluencyLetter}: <strong>{analysis.validCandidates.length}</strong> · Punto sugerido: <strong>{analysis.suggestedPoint}/1</strong></p>
                      <p className="mt-1"><strong>Válidas por forma:</strong> {analysis.validCandidates.length ? analysis.validCandidates.join(', ').toUpperCase() : 'NINGUNA'}</p>
                      <p className="mt-1"><strong>Repetidas:</strong> {analysis.repeated.length ? analysis.repeated.join(', ').toUpperCase() : 'NINGUNA'}</p>
                      <p className="mt-1"><strong>Otra inicial:</strong> {analysis.wrongInitial.length ? analysis.wrongInitial.join(', ').toUpperCase() : 'NINGUNA'}</p>
                      <p className="mt-1"><strong>Demasiado cortas o aisladas:</strong> {analysis.tooShort.length ? analysis.tooShort.join(', ').toUpperCase() : 'NINGUNA'}</p>
                      <p className="mt-2 text-xs">Este filtro elimina duplicados, números, elementos de una sola letra y palabras con otra inicial. No determina por sí solo significado, nombre propio ni conjugación verbal; esa validación permanece a cargo del investigador.</p>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
          <NextStepButton themeClass={theme} onClick={next} disabled={!fluencyFinished} />
        </div>
      )}

      {step === 12 && <div><h2 className="text-3xl font-black">Abstracción</h2><p className="mt-2 text-slate-500">La respuesta no tiene que ser una sola palabra. Debe expresar la categoría o relación común entre los dos elementos.</p><div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-5"><p className="font-bold">Ejemplo: naranja y plátano</p><input className="mt-3 w-full rounded-xl border-2 p-3" placeholder="Registrar respuesta" value={answers.abstraction.example} onChange={(e)=>setAnswers((c)=>({...c,abstraction:{...c.abstraction,example:lettersOnly(e.target.value)}}))}/><label className="mt-3 flex gap-2"><input type="checkbox" checked={answers.abstraction.promptUsed} onChange={(e)=>setAnswers((c)=>({...c,abstraction:{...c.abstraction,promptUsed:e.target.checked}}))}/><span>Se utilizó la única pista permitida en esta sección.</span></label></div>{cfg.abstractionPairs.map((pair,index)=><div key={pair.join('-')} className="mt-5 rounded-xl bg-slate-50 p-5"><p className="font-black">{pair[0]} – {pair[1]}</p><input className="mt-3 w-full rounded-xl border-2 p-3" placeholder="Respuesta oral registrada" value={answers.abstraction[`pair${index+1}`]} onChange={(e)=>setAnswers((c)=>({...c,abstraction:{...c.abstraction,[`pair${index+1}`]:lettersOnly(e.target.value)}}))}/></div>)}<div className="mt-4 rounded-xl bg-cyan-50 p-3 text-sm font-bold text-cyan-800">Puntaje automático sugerido: {suggestedAbstractionScore(answers, cfg)}/2. La revisión profesional debe confirmar respuestas equivalentes no incluidas literalmente.</div><NextStepButton themeClass={theme} onClick={()=>{setAnswers((c)=>({...c,administration:{...c.administration,delayedRecallStartedAt:Date.now()}}));next();}}/></div>}

      {step === 13 && <div><h2 className="text-3xl font-black">Recuerdo diferido</h2><p className="mt-2 text-slate-500">Primero registre únicamente las palabras recordadas espontáneamente, sin pistas. Después active las pistas; PANEG conservará el registro de que se usaron.</p><div className="mt-6 grid gap-3 md:grid-cols-5">{answers.delayedRecall.free.map((value,index)=><input key={index} className="rounded-xl border-2 p-3 text-center uppercase" placeholder={`Palabra ${index+1}`} value={value} onChange={(e)=>setAnswers((c)=>{const free=[...c.delayedRecall.free];free[index]=lettersOnly(e.target.value);return {...c,delayedRecall:{...c.delayedRecall,free}};})}/>)}</div><div className="mt-6 rounded-xl border border-indigo-200 bg-indigo-50 p-4"><label className="flex items-start gap-3 font-bold text-indigo-950"><input type="checkbox" className="mt-1" checked={!!answers.delayedRecall.cuesActivated} onChange={(e)=>setAnswers((c)=>({...c,delayedRecall:{...c.delayedRecall,cuesActivated:e.target.checked,cuesActivatedAt:e.target.checked ? (c.delayedRecall.cuesActivatedAt || Date.now()) : null}}))}/><span>Activar pistas de categoría y elección múltiple. Marque esta opción solo después de registrar el recuerdo libre.</span></label><p className="mt-2 text-xs text-indigo-800">Si activa pistas y luego borra o corrige alguna palabra, el sistema mantiene evidencia de que las pistas fueron habilitadas.</p></div>{answers.delayedRecall.cuesActivated ? <div className="mt-8 space-y-4">{cfg.words.map((word)=>{const freeFound=answers.delayedRecall.free.map(normalize).includes(normalize(word)); return <div key={word} className={`rounded-xl border p-4 ${freeFound ? 'border-slate-200 bg-slate-50' : 'border-orange-200 bg-orange-50'}`}><div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between"><p className="font-bold">{word}: pista de categoría — {cfg.categoryCues[word]}</p>{freeFound&&<span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-500">Registrada en recuerdo libre; no aplique pista</span>}</div><input disabled={freeFound} className="mt-2 w-full rounded-lg border-2 p-2 disabled:bg-slate-100" placeholder="Respuesta con pista" value={answers.delayedRecall.category[word]||''} onChange={(e)=>setAnswers((c)=>({...c,delayedRecall:{...c.delayedRecall,category:{...c.delayedRecall.category,[word]:lettersOnly(e.target.value)}}}))}/>{!freeFound && normalize(answers.delayedRecall.category[word])!==normalize(word)&&<div className="mt-3"><p className="text-sm font-bold">Elección múltiple</p><div className="mt-2 flex flex-wrap gap-2">{cfg.multipleChoice[word].map((option)=><label key={option} className="rounded-lg border bg-white px-3 py-2"><input type="radio" name={`choice-${word}`} value={option} checked={normalize(answers.delayedRecall.multipleChoice[word])===normalize(option)} onChange={(e)=>setAnswers((c)=>({...c,delayedRecall:{...c.delayedRecall,multipleChoice:{...c.delayedRecall.multipleChoice,[word]:toUpper(e.target.value)}}}))}/> <span className="ml-1 uppercase">{option}</span></label>)}</div></div>}</div>})}</div> : <p className="mt-6 rounded-xl bg-amber-50 p-4 text-sm font-bold text-amber-800">Las pistas todavía no están activadas. Registre primero el recuerdo libre y active las pistas solo cuando proceda.</p>}<NextStepButton themeClass={theme} onClick={next}/></div>}

      {step === 14 && <div><h2 className="text-3xl font-black">Orientación</h2><p className="mt-2 text-slate-500">Registre por separado día del mes, mes, año, día de la semana, lugar y ciudad. La guía asigna un punto independiente a cada componente; separarlos evita que un calendario revele la respuesta y permite calificar 0–6 correctamente.</p><div className="mt-6 grid gap-4 md:grid-cols-2"><input type="text" inputMode="numeric" maxLength="2" className="rounded-xl border-2 p-4" placeholder="Día del mes" value={answers.orientation.day} onChange={(e)=>setAnswers((c)=>({...c,orientation:{...c.orientation,day:digitsOnly(e.target.value,2)}}))}/><input type="text" inputMode="numeric" maxLength="2" className="rounded-xl border-2 p-4" placeholder="Mes" value={answers.orientation.month} onChange={(e)=>setAnswers((c)=>({...c,orientation:{...c.orientation,month:digitsOnly(e.target.value,2)}}))}/><input type="text" inputMode="numeric" maxLength="4" className="rounded-xl border-2 p-4" placeholder="Año" value={answers.orientation.year} onChange={(e)=>setAnswers((c)=>({...c,orientation:{...c.orientation,year:digitsOnly(e.target.value,4)}}))}/><input className="rounded-xl border-2 p-4 uppercase" placeholder="DÍA DE LA SEMANA" value={answers.orientation.weekday} onChange={(e)=>setAnswers((c)=>({...c,orientation:{...c.orientation,weekday:toUpper(e.target.value)}}))}/><input className="rounded-xl border-2 p-4 uppercase" placeholder="LUGAR EXACTO" value={answers.orientation.place} onChange={(e)=>setAnswers((c)=>({...c,orientation:{...c.orientation,place:toUpper(e.target.value)}}))}/><input className="rounded-xl border-2 p-4 uppercase" placeholder="CIUDAD/LOCALIDAD" value={answers.orientation.city} onChange={(e)=>setAnswers((c)=>({...c,orientation:{...c.orientation,city:toUpper(e.target.value)}}))}/></div><p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">Día, mes y año solo aceptan dígitos. Día de la semana, lugar y ciudad se guardan en mayúsculas. Para puntuar lugar y ciudad, PANEG compara contra el contexto configurado: lugar aceptado UAN / Universidad Autónoma de Nayarit / unidad académica; ciudad aceptada Tepic. Si la aplicación ocurre en otro lugar, ajuste estos criterios en el código antes de aplicar.</p>{saveError&&<p className="mt-5 rounded-xl bg-red-50 p-4 font-bold text-red-700">{saveError}</p>}<NextStepButton themeClass={theme} onClick={saveResult} disabled={saving || !authReady || !answers.orientation.day || !answers.orientation.month || !answers.orientation.year || !answers.orientation.weekday || !answers.orientation.place || !answers.orientation.city}>{saving?'Guardando…':'Guardar resultados'}</NextStepButton></div>}

      {step === 15 && <div className="py-14 text-center"><div className={`mx-auto flex h-24 w-24 items-center justify-center rounded-full text-5xl text-white ${cfg.theme==='blue'?'bg-blue-600':'bg-teal-600'}`}>✓</div><h2 className="mt-6 text-3xl font-black">Evaluación registrada</h2><p className="mt-3 text-slate-600">El resultado queda pendiente de revisión profesional antes de calcular el puntaje final.</p>{saveMessage&&<p className="mx-auto mt-5 max-w-lg rounded-xl bg-green-50 p-4 font-bold text-green-700">{saveMessage}</p>}<button onClick={()=>setScreen('home')} className="mt-8 rounded-xl bg-slate-800 px-8 py-3 font-black text-white">Volver al inicio</button></div>}
    </PageCard></div>
  );
}
