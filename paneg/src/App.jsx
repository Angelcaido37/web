import React, { useState, useEffect, useRef, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, updateDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';

// --- CONFIGURACIÓN FIREBASE PROPIA (paneg-bd) ---
const firebaseConfig = {
  apiKey: "AIzaSyBrS7SpfCx2FUs3VohKMZAofdDwheo33aY",
  authDomain: "paneg-bd.firebaseapp.com",
  projectId: "paneg-bd",
  storageBucket: "paneg-bd.firebasestorage.app",
  messagingSenderId: "359193449567",
  appId: "1:359193449567:web:2b7a82b5ceb115e1b677ea",
  measurementId: "G-1RPEJZ3HFM"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'paneg-bd';
// Ruta válida en Firestore: artifacts/{appId}/data/moca_results/results/{documentId}

// --- CONFIGURACIÓN DINÁMICA MOCA (8.1 vs 8.3) ---
const MOCA_CONFIG = {
  'Pretest': {
    version: '8.1', color: 'blue',
    visuoTitle: 'Cubo',
    visuoInst: 'Copie el dibujo del cubo de la manera más precisa posible.',
    visuoSvg: <path d="M30,30 L70,30 L70,70 L30,70 Z M50,10 L90,10 L90,50 L50,50 Z M30,30 L50,10 M70,30 L90,10 M70,70 L90,50 M30,70 L50,50" fill="none" stroke="currentColor" strokeWidth="2"/>,
    relojInst: 'las once y diez (11:10)',
    animales: [{name: 'Animal 1', emoji: '🦁'}, {name: 'Animal 2', emoji: '🦏'}, {name: 'Animal 3', emoji: '🐪'}],
    palabras: ["ROSTRO", "SEDA", "TEMPLO", "CLAVEL", "ROJO"],
    digitsAdelante: "2 1 8 5 4", digitsAtras: "7 4 2",
    restaBase: 100,
    frases: ["Solo sé que le toca a Juan ayudar hoy", "El gato siempre se esconde debajo del sofá cuando hay perros en la habitación"],
    fluidezLetra: "F",
    absPares: [{a: 'Tren', b: 'Bicicleta'}, {a: 'Reloj', b: 'Regla'}],
    pistasCategoria: { ROSTRO: "parte del cuerpo", SEDA: "tipo de tela", TEMPLO: "tipo de edificio", CLAVEL: "tipo de flor", ROJO: "color" },
    pistasOpciones: { ROSTRO: ["nariz", "rostro", "mano"], SEDA: ["tela vaquera", "seda", "algodón"], TEMPLO: ["templo", "escuela", "hospital"], CLAVEL: ["rosa", "clavel", "tulipán"], ROJO: ["rojo", "azul", "verde"] }
  },
  'Postest': {
    version: '8.3', color: 'teal',
    visuoTitle: 'Cama',
    visuoInst: 'Copie el dibujo de la cama de la manera más precisa posible.',
    visuoSvg: <><path d="M 15 25 L 15 75 M 35 15 L 35 60 M 15 25 L 35 15 M 15 45 L 35 35" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M 15 75 L 75 75 L 90 60 L 35 60 Z" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M 75 75 L 75 85 L 90 70 L 90 60 M 15 75 L 15 85 L 75 85 M 20 60 L 35 52 L 50 52 L 35 60 Z" fill="none" stroke="currentColor" strokeWidth="2"/></>,
    relojInst: 'las diez con cinco minutos (10:05)',
    animales: [{name: 'Animal 1', emoji: '🐎'}, {name: 'Animal 2', emoji: '🐅'}, {name: 'Animal 3', emoji: '🦆'}],
    palabras: ["PIERNA", "ALGODON", "ESCUELA", "TOMATE", "BLANCO"],
    digitsAdelante: "2 4 8 1 5", digitsAtras: "4 2 7",
    restaBase: 60,
    frases: ["El niño paseaba a su perro en el parque después de medianoche", "El artista terminó su pintura en el momento exacto para la exhibición"],
    fluidezLetra: "B",
    absPares: [{a: 'Martillo', b: 'Desarmador'}, {a: 'Cerillos', b: 'Lámpara'}],
    pistasCategoria: { PIERNA: "parte del cuerpo", ALGODON: "tipo de tela", ESCUELA: "edificio público", TOMATE: "tipo de alimento", BLANCO: "color" },
    pistasOpciones: { PIERNA: ["mano", "pierna", "cara"], ALGODON: ["seda", "algodón", "naylon"], ESCUELA: ["escuela", "hospital", "biblioteca"], TOMATE: ["lechuga", "tomate", "zanahoria"], BLANCO: ["morado", "blanco", "verde"] }
  }
};
const secuenciaLetras = "FBACMNAAJKLBAFAKDEAAAJAMOFAAB".split("");

// --- UTILS ---
const normalizar = (str) => (str ? str.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "");

// Analiza la fluidez verbal: normaliza, valida la letra inicial y elimina repeticiones.

// Elimina valores undefined antes de enviar datos a Firestore.
// Firestore no acepta undefined dentro de objetos o arreglos.
const limpiarParaFirestore = (valor) => {
  if (valor === undefined) return null;
  if (valor === null) return null;
  if (Array.isArray(valor)) return valor.map(limpiarParaFirestore);
  if (typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor)
        .filter(([, v]) => v !== undefined && typeof v !== 'function')
        .map(([k, v]) => [k, limpiarParaFirestore(v)])
    );
  }
  return valor;
};

const analizarFluidez = (texto = "", letraObjetivo = "F") => {
  const letra = normalizar(letraObjetivo);
  const ingresadas = normalizar(texto)
    .split(/[\s,;:.!?¿¡()"'\n\r-]+/)
    .map((palabra) => palabra.trim())
    .filter(Boolean);

  const conLetraCorrecta = ingresadas.filter((palabra) => palabra.startsWith(letra));
  const validas = [...new Set(conLetraCorrecta)];
  const repetidas = [...new Set(
    conLetraCorrecta.filter((palabra, indice, arreglo) => arreglo.indexOf(palabra) !== indice)
  )];
  const letraIncorrecta = [...new Set(
    ingresadas.filter((palabra) => !palabra.startsWith(letra))
  )];

  return {
    ingresadas,
    validas,
    repetidas,
    letraIncorrecta,
    cantidadValidas: validas.length
  };
};

// --- CANVAS COMPONENT ---
const DrawingCanvas = ({ onSave }) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.width = canvas.offsetWidth;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#1e293b';
  }, []);

  const startDrawing = (e) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || (e.touches && e.touches[0].clientX)) - rect.left;
    const y = (e.clientY || (e.touches && e.touches[0].clientY)) - rect.top;
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || (e.touches && e.touches[0].clientX)) - rect.left;
    const y = (e.clientY || (e.touches && e.touches[0].clientY)) - rect.top;
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    onSave(canvasRef.current.toDataURL());
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    onSave(null);
  };

  return (
    <div className="flex flex-col items-center w-full">
      <canvas ref={canvasRef} onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing} onTouchStart={(e) => { e.preventDefault(); startDrawing(e); }} onTouchMove={(e) => { e.preventDefault(); draw(e); }} onTouchEnd={stopDrawing} className="w-full max-w-md bg-white border-2 border-slate-300 rounded-lg shadow-inner cursor-crosshair touch-none" />
      <button onClick={clearCanvas} className="mt-2 text-sm text-red-500 font-medium">Borrar y empezar de nuevo</button>
    </div>
  );
};

const AnimalImage = ({ name, emoji }) => (
  <div className="flex flex-col items-center justify-center w-28 h-28 sm:w-32 sm:h-32 bg-slate-100 rounded-xl border-2 border-slate-200 shadow-sm">
    <span className="text-5xl sm:text-6xl">{emoji}</span>
    <span className="text-[10px] sm:text-xs text-slate-400 mt-2 font-mono uppercase tracking-widest opacity-60">{name}</span>
  </div>
);

// --- MAIN APP ---
export default function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [appState, setAppState] = useState('home');
  
  // Participant State
  const [faseSelect, setFaseSelect] = useState('Pretest');
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState({});
  const [interactive, setInteractive] = useState({ memoriaPaso: 0, letraActual: '', letrasActivas: false, letrasTerminadas: false, fluidezActiva: false, fluidezTerminada: false, tiempoFluidez: 60, faltantesCat: [], faltantesOpc: [] });

  // Evaluator State
  const [evalPass, setEvalPass] = useState('');
  const [dbEvalPass, setDbEvalPass] = useState('paneg2025');
  const [loginError, setLoginError] = useState('');
  const [oldPass, setOldPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [passMsg, setPassMsg] = useState('');
  const [passErr, setPassErr] = useState('');
  const [resultados, setResultados] = useState([]);
  const [selectedRes, setSelectedRes] = useState(null);
  const [manualScores, setManualScores] = useState({ visuo1: 0, reloj: 0 });
  const [dashTab, setDashTab] = useState('list');

  const cfg = MOCA_CONFIG[faseSelect] || MOCA_CONFIG['Pretest'];

  // Auth Initialization
  useEffect(() => {
    let cancelled = false;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (cancelled) return;

      if (currentUser) {
        setUser(currentUser);
        setAuthReady(true);
        setAuthError('');
        return;
      }

      try {
        await signInAnonymously(auth);
      } catch (error) {
        console.error("Auth error:", error);
        setAuthError(`No fue posible iniciar la sesión anónima: ${error.code || error.message}`);
        setAuthReady(true);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Fetch Results
  useEffect(() => {
    if (appState === 'evaluator_dash' && user) {
      const q = collection(db, 'artifacts', appId, 'data', 'moca_results', 'results');
      return onSnapshot(q, (snapshot) => {
        const docs = [];
        snapshot.forEach(d => docs.push({ id: d.id, ...d.data() }));
        docs.sort((a, b) => b.timestamp - a.timestamp);
        setResultados(docs);
      }, (err) => console.error("Firestore read error:", err));
    }
  }, [appState, user]);

  // Fetch Settings (Password)
  useEffect(() => {
    if (user) {
      const confRef = doc(db, 'artifacts', appId, 'data', 'config_eval_settings');
      return onSnapshot(confRef, (snap) => {
        if (snap.exists() && snap.data().password) setDbEvalPass(snap.data().password);
      }, (err) => console.error("Config read error:", err));
    }
  }, [user]);

  // --- PARTICIPANT FLOW ---
  const initParticipant = () => {
    setFormData({
      nombre: '', edad: '', educacion: '', fase: faseSelect, grupo: 'Experimental', version: cfg.version,
      alternancia: [], visuo1Img: null, relojImg: null, animal1: '', animal2: '', animal3: '',
      numerosAdelante: '', numerosAtras: '', letrasErrores: 0, letrasAciertos: 0, restas: ['', '', '', '', ''],
      frase1: '', frase2: '', fluidez: '', similitud1: '', similitud2: '',
      recuerdoEspontaneo: ['', '', '', '', ''], recuerdoCategoria: {}, recuerdoOpcion: {}, fecha: '', lugar: '', localidad: ''
    });
    setStep(0);
    setAppState('participant_test');
  };

  const handleAlternancia = (val) => { if (!formData.alternancia.includes(val)) setFormData({ ...formData, alternancia: [...formData.alternancia, val] }); };

  const startTimer = (type) => {
    if (type === 'memoria') {
      setInteractive(prev => ({...prev, memoriaPaso: 1}));
      let i = 0;
      const t = setInterval(() => {
        if (i < cfg.palabras.length) { setInteractive(prev => ({...prev, letraActual: cfg.palabras[i]})); i++; } 
        else { clearInterval(t); setInteractive(prev => ({...prev, letraActual: '', memoriaPaso: 2})); }
      }, 1000);
    } else if (type === 'letras') {
      setInteractive(prev => ({...prev, letrasActivas: true}));
      let i = 0;
      const t = setInterval(() => {
        if (i < secuenciaLetras.length) { setInteractive(prev => ({...prev, letraActual: secuenciaLetras[i]})); i++; } 
        else { clearInterval(t); setInteractive(prev => ({...prev, letraActual: '', letrasActivas: false, letrasTerminadas: true})); }
      }, 1000);
    } else if (type === 'fluidez') {
      setInteractive(prev => ({...prev, fluidezActiva: true, tiempoFluidez: 60}));
      let time = 60;
      const t = setInterval(() => {
        time -= 1;
        setInteractive(prev => ({...prev, tiempoFluidez: time}));
        if (time <= 0) { clearInterval(t); setInteractive(prev => ({...prev, fluidezActiva: false, fluidezTerminada: true})); }
      }, 1000);
    }
  };

  const tapLetra = (e) => {
    e.preventDefault();
    if (interactive.letraActual === 'A') setFormData(p => ({ ...p, letrasAciertos: p.letrasAciertos + 1 }));
    else if (interactive.letraActual !== '') setFormData(p => ({ ...p, letrasErrores: p.letrasErrores + 1 }));
  };

  const evaluarMIS = (etapa) => {
    if (etapa === 'espontaneo') {
      const resp = formData.recuerdoEspontaneo.map(normalizar);
      const faltantes = cfg.palabras.filter(p => !resp.includes(normalizar(p)));
      if (faltantes.length > 0) { setInteractive(p => ({...p, faltantesCat: faltantes})); setStep(12.1); } else setStep(13);
    } else if (etapa === 'categoria') {
      const faltantes = interactive.faltantesCat.filter(p => normalizar(formData.recuerdoCategoria[p]) !== normalizar(p));
      if (faltantes.length > 0) { setInteractive(p => ({...p, faltantesOpc: faltantes})); setStep(12.2); } else setStep(13);
    }
  };

  const autoScore = (data, config) => {
    let pts = 0, mis = 0;
    if (JSON.stringify(data.alternancia) === JSON.stringify(['1','A','2','B','3','C','4','D','5','E'])) pts += 1;
    
    const a1 = normalizar(data.animal1), a2 = normalizar(data.animal2), a3 = normalizar(data.animal3);
    if (config.version === '8.1') {
      if (a1.includes('leon')) pts+=1; if (a2.includes('rino')) pts+=1; if (a3.includes('camel')||a3.includes('drome')) pts+=1;
    } else {
      if (a1.includes('caballo')||a1.includes('yegua')||a1.includes('poni')) pts+=1; if (a2.includes('tigre')) pts+=1; if (a3.includes('pato')) pts+=1;
    }

    const nAd = data.numerosAdelante.replace(/\s/g, ''), nAt = data.numerosAtras.replace(/\s/g, '');
    if (config.version === '8.1') { if (nAd==='21854') pts+=1; if (nAt==='742') pts+=1; } 
    else { if (nAd==='24815') pts+=1; if (nAt==='427') pts+=1; }

    if ((data.letrasErrores + (8 - data.letrasAciertos)) <= 1) pts += 1;

    let restasC = 0, current = config.restaBase;
    data.restas.forEach(r => { if (r!=='' && parseInt(r) === current - 7) restasC++; current = parseInt(r) || current; });
    if (restasC >= 4) pts += 3; else if (restasC >= 2) pts += 2; else if (restasC === 1) pts += 1;

    const f1 = normalizar(data.frase1).replace(/[.,]/g, ''), f2 = normalizar(data.frase2).replace(/[.,]/g, '');
    if (config.version === '8.1') {
      if (f1 === 'solo se que le toca a juan ayudar hoy') pts+=1;
      if (f2 === 'el gato siempre se esconde debajo del sofa cuando hay perros en la habitacion') pts+=1;
    } else {
      if (f1 === 'el nino paseaba a su perro en el parque despues de medianoche') pts+=1;
      if (f2 === 'el artista termino su pintura en el momento exacto para la exhibicion') pts+=1;
    }

    const fluidezAnalizada = analizarFluidez(data.fluidez, config.fluidezLetra);
    if (fluidezAnalizada.cantidadValidas >= 11) pts += 1;

    const s1 = normalizar(data.similitud1), s2 = normalizar(data.similitud2);
    if (config.version === '8.1') {
      if (s1.includes('transporte')||s1.includes('viaj')||s1.includes('locomocion')) pts+=1;
      if (s2.includes('medir')||s2.includes('medicion')||s2.includes('instrumento')) pts+=1;
    } else {
      if (s1.includes('herramienta')||s1.includes('carpinteria')||s1.includes('construccion')||s1.includes('instrumento')) pts+=1;
      if (s2.includes('luz')||s2.includes('iluminacion')||s2.includes('brillo')) pts+=1;
    }

    const respEsp = data.recuerdoEspontaneo.map(normalizar);
    config.palabras.forEach(p => {
      const pN = normalizar(p);
      if (respEsp.includes(pN)) { pts+=1; mis+=3; }
      else if (normalizar(data.recuerdoCategoria[p]) === pN) mis+=2;
      else if (normalizar(data.recuerdoOpcion[p]) === pN) mis+=1;
    });

    if (data.fecha) pts+=1; if (data.lugar) pts+=1; if (data.localidad) pts+=1;
    return { total: pts, misScore: mis };
  };

  const submitTest = async () => {
    setSaveError('');
    setSaveSuccess('');

    if (!authReady) {
      setSaveError('La conexión con Firebase todavía se está preparando. Espere unos segundos.');
      return;
    }

    if (!user) {
      setSaveError(authError || 'No existe una sesión autenticada para guardar el resultado.');
      return;
    }

    setGuardando(true);

    try {
      const scores = autoScore(formData, cfg);
      const fluidezAnalizada = analizarFluidez(formData.fluidez, cfg.fluidezLetra);

      const resultadoParaGuardar = limpiarParaFirestore({
        ...formData,
        userId: user.uid,
        timestamp: Date.now(),
        evaluado: false,
        puntosAuto: scores.total,
        misAuto: scores.misScore,
        fluidezAnalisis: {
          letraSolicitada: cfg.fluidezLetra,
          palabrasIngresadas: fluidezAnalizada.ingresadas,
          palabrasValidas: fluidezAnalizada.validas,
          palabrasRepetidas: fluidezAnalizada.repetidas,
          palabrasConLetraIncorrecta: fluidezAnalizada.letraIncorrecta,
          cantidadValidas: fluidezAnalizada.cantidadValidas
        }
      });

      console.log('Datos que se enviarán a Firestore:', resultadoParaGuardar);

      const referencia = await addDoc(
        collection(db, 'artifacts', appId, 'data', 'moca_results', 'results'),
        resultadoParaGuardar
      );

      setSaveSuccess(`Resultado guardado correctamente. Folio: ${referencia.id}`);
      setStep(15);
    } catch (error) {
      console.error('Error al guardar resultado:', error);
      setSaveError(`No fue posible guardar el resultado: ${error.code || 'sin-codigo'} — ${error.message || 'sin detalle'}`);
    } finally {
      setGuardando(false);
    }
  };

  // --- EVALUATOR FLOW ---
  const handleEvalLogin = () => { 
    setLoginError('');
    if (evalPass === dbEvalPass) {
      setAppState('evaluator_dash'); 
    } else { 
      setLoginError("Contraseña incorrecta"); 
    } 
  };
  
  const handleChangePassword = async () => {
    setPassMsg(''); setPassErr('');
    if (oldPass !== dbEvalPass) return setPassErr('La contraseña actual es incorrecta.');
    if (newPass.length < 4) return setPassErr('La nueva contraseña debe tener al menos 4 caracteres.');
    try {
      const confRef = doc(db, 'artifacts', appId, 'data', 'config_eval_settings');
      await setDoc(confRef, { password: newPass }, { merge: true });
      setPassMsg('¡Contraseña actualizada con éxito!');
      setOldPass(''); setNewPass('');
    } catch (e) {
      console.error(e);
      setPassErr('Error de conexión al actualizar.');
    }
  };

  const saveManual = async (id) => {
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'data', 'moca_results', 'results', id), {
        puntosManualVisuo1: manualScores.visuo1, puntosManualReloj: manualScores.reloj, evaluado: true
      });
      setSelectedRes(null);
    } catch (e) { console.error(e); }
  };

  const getTotalScore = (r, localManual = null) => {
    let esc = parseInt(r.educacion) <= 12 ? 1 : 0;
    let manual = r.evaluado ? ((r.puntosManualVisuo1||0) + (r.puntosManualReloj||0)) : (localManual ? localManual.visuo1 + localManual.reloj : 0);
    return r.puntosAuto + manual + esc;
  };

  // EVOLUTION ANALYSIS
  const groupedData = useMemo(() => {
    const groups = {};
    resultados.forEach(r => {
      const key = (r.nombre || '').toLowerCase().trim();
      if (!key) return;
      if (!groups[key]) groups[key] = { name: r.nombre, pre: null, post: null };
      if (r.fase === 'Pretest') { if (!groups[key].pre || r.timestamp > groups[key].pre.timestamp) groups[key].pre = r; }
      if (r.fase === 'Postest') { if (!groups[key].post || r.timestamp > groups[key].post.timestamp) groups[key].post = r; }
    });
    return Object.values(groups).filter(g => g.pre && g.post);
  }, [resultados]);

  // --- RENDERING ---
  if (appState === 'home') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="max-w-4xl w-full bg-white rounded-3xl shadow-2xl overflow-hidden">
          <div className="bg-slate-900 p-12 text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-blue-600/30 to-purple-600/30 z-0"></div>
            <div className="relative z-10">
              <h1 className="text-5xl font-black text-white mb-4 tracking-tight">SISTEMA PANEG</h1>
              <p className="text-slate-300 text-xl font-medium max-w-2xl mx-auto">Plataforma Unificada para el Análisis Neurocognitivo en la Era de la Inteligencia Artificial Generativa</p>
            </div>
          </div>
          <div className="p-8 sm:p-12 grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="flex flex-col items-center p-8 bg-slate-50 rounded-2xl border border-slate-200 shadow-sm">
              <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-3xl mb-6">📝</div>
              <h2 className="text-2xl font-bold text-slate-800 mb-2">Participantes</h2>
              <p className="text-slate-500 text-center text-sm mb-6">Realizar la prueba cognitiva estandarizada.</p>
              <button onClick={() => setAppState('participant_prep')} className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors">Iniciar Sesión de Prueba</button>
            </div>
            <div className="flex flex-col items-center p-8 bg-slate-50 rounded-2xl border border-slate-200 shadow-sm">
              <div className="w-16 h-16 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-3xl mb-6">🔬</div>
              <h2 className="text-2xl font-bold text-slate-800 mb-2">Investigadores</h2>
              <p className="text-slate-500 text-center text-sm mb-6">Acceder al panel de control y análisis de evolución.</p>
              <button onClick={() => setAppState('evaluator_login')} className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl transition-colors">Acceso Evaluador</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (appState === 'evaluator_login') {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-slate-200 text-center">
          <div className="w-16 h-16 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-3xl mx-auto mb-6">🔒</div>
          <h2 className="text-2xl font-bold text-slate-800 mb-6">Autenticación Requerida</h2>
          {loginError && <div className="mb-4 p-3 bg-red-50 text-red-600 font-bold rounded-lg border border-red-200">{loginError}</div>}
          <input type="password" value={evalPass} onChange={e=>setEvalPass(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-300 rounded-xl mb-6 text-center tracking-widest outline-none focus:border-purple-500" placeholder="Contraseña de investigador" />
          <button onClick={handleEvalLogin} className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-4 rounded-xl transition-colors mb-4">Ingresar al Dashboard</button>
          <button onClick={() => {setAppState('home'); setLoginError(''); setEvalPass('');}} className="text-slate-500 text-sm hover:text-slate-700 font-medium">← Volver al Inicio</button>
        </div>
      </div>
    );
  }

  if (appState === 'evaluator_dash') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <div className="bg-slate-900 text-white p-6 shadow-md flex justify-between items-center z-10 relative">
          <div><h1 className="text-2xl font-black tracking-tight">PANEG <span className="font-light text-slate-400">| Dashboard Analítico</span></h1></div>
          <div className="flex gap-4">
            <button onClick={() => setDashTab('list')} className={`px-4 py-2 rounded-lg font-bold text-sm transition-colors ${dashTab === 'list' ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>Registros</button>
            <button onClick={() => setDashTab('evolution')} className={`px-4 py-2 rounded-lg font-bold text-sm transition-colors ${dashTab === 'evolution' ? 'bg-green-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>Análisis de Evolución</button>
            <button onClick={() => setDashTab('settings')} className={`px-4 py-2 rounded-lg font-bold text-sm transition-colors ${dashTab === 'settings' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>Configuración</button>
            <button onClick={() => {setAppState('home'); setEvalPass('');}} className="px-4 py-2 bg-slate-800 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors ml-4">Cerrar Sesión</button>
          </div>
        </div>

        <div className="flex-grow p-6 sm:p-10 max-w-7xl mx-auto w-full">
          
          {dashTab === 'list' && !selectedRes && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-xs uppercase tracking-wider text-slate-500 font-bold">
                    <th className="p-5">Participante</th><th className="p-5">Versión / Fase</th><th className="p-5 text-center">Score MIS</th><th className="p-5">Estado</th><th className="p-5 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {resultados.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-5"><div className="font-bold text-slate-800">{r.nombre}</div><div className="text-xs text-slate-500">{r.edad} años | Edu: {r.educacion} | {r.grupo}</div></td>
                      <td className="p-5">
                        <span className={`inline-block px-2 py-1 rounded text-xs font-bold mr-2 ${r.fase==='Pretest'?'bg-blue-100 text-blue-800':'bg-teal-100 text-teal-800'}`}>{r.fase}</span>
                        <span className="text-xs font-mono text-slate-500">v{r.version}</span>
                      </td>
                      <td className="p-5 text-center font-black text-slate-700">{r.misAuto}/15</td>
                      <td className="p-5">{r.evaluado ? <span className="text-green-600 bg-green-50 px-2 py-1 rounded-md text-xs font-bold">✅ Evaluado</span> : <span className="text-orange-600 bg-orange-50 px-2 py-1 rounded-md text-xs font-bold">⏳ Pendiente</span>}</td>
                      <td className="p-5 text-right"><button onClick={() => {setSelectedRes(r); setManualScores({visuo1: r.puntosManualVisuo1||0, reloj: r.puntosManualReloj||0});}} className="text-purple-600 hover:text-purple-800 font-bold text-sm bg-purple-50 px-3 py-1.5 rounded-lg">Calificar</button></td>
                    </tr>
                  ))}
                  {resultados.length === 0 && <tr><td colSpan="5" className="p-10 text-center text-slate-400">Sin datos registrados</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {dashTab === 'list' && selectedRes && (
            <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-8 max-w-4xl mx-auto">
              <button onClick={() => setSelectedRes(null)} className="text-slate-500 font-bold mb-6 flex items-center gap-2 hover:text-slate-800">← Volver</button>
              <div className="flex gap-8 border-b border-slate-100 pb-8 mb-8">
                <div className="flex-1">
                  <h2 className="text-3xl font-black text-slate-800 mb-2">{selectedRes.nombre}</h2>
                  <p className="text-slate-500 font-medium mb-4">{selectedRes.edad} años • {selectedRes.educacion} años estudio • {selectedRes.grupo}</p>
                  <span className={`px-3 py-1 rounded-full text-sm font-bold ${selectedRes.fase==='Pretest'?'bg-blue-100 text-blue-800':'bg-teal-100 text-teal-800'}`}>{selectedRes.fase} (MoCA v{selectedRes.version})</span>
                </div>
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 text-center min-w-[150px]">
                  <p className="text-xs uppercase tracking-widest font-bold text-slate-500 mb-2">MoCA Total</p>
                  <div className="text-5xl font-black text-slate-800">{getTotalScore(selectedRes, manualScores)}<span className="text-2xl text-slate-400">/30</span></div>
                  {parseInt(selectedRes.educacion) <= 12 && <p className="text-[10px] text-green-600 font-bold mt-2">+1 pt escolaridad</p>}
                </div>
              </div>

              <h3 className="text-xl font-bold mb-6">Revisión Manual Visuoconstructiva</h3>
              <div className="grid grid-cols-2 gap-8 mb-8">
                <div className="border border-slate-200 p-4 rounded-xl">
                  <div className="flex justify-between mb-4"><p className="font-bold">Dibujo 1 ({selectedRes.version==='8.1'?'Cubo':'Cama'})</p><span className="text-xs bg-slate-100 px-2 py-1 rounded font-bold text-slate-500">Máx 1</span></div>
                  <div className="h-40 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-center mb-4 p-2">
                    {selectedRes.visuo1Img ? <img src={selectedRes.visuo1Img} className="max-h-full max-w-full" alt="Visuo 1"/> : <span className="text-slate-400 italic text-sm">No dibujó</span>}
                  </div>
                  <select value={manualScores.visuo1} onChange={e=>setManualScores({...manualScores, visuo1: parseInt(e.target.value)})} className="w-full p-2 border border-slate-300 rounded-lg font-bold text-slate-700 bg-white">
                    <option value={0}>0 - Incorrecto</option><option value={1}>1 - Correcto</option>
                  </select>
                </div>
                <div className="border border-slate-200 p-4 rounded-xl">
                  <div className="flex justify-between mb-4"><p className="font-bold">Reloj ({selectedRes.version==='8.1'?'11:10':'10:05'})</p><span className="text-xs bg-slate-100 px-2 py-1 rounded font-bold text-slate-500">Máx 3</span></div>
                  <div className="h-40 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-center mb-4 p-2">
                    {selectedRes.relojImg ? <img src={selectedRes.relojImg} className="max-h-full max-w-full" alt="Reloj"/> : <span className="text-slate-400 italic text-sm">No dibujó</span>}
                  </div>
                  <select value={manualScores.reloj} onChange={e=>setManualScores({...manualScores, reloj: parseInt(e.target.value)})} className="w-full p-2 border border-slate-300 rounded-lg font-bold text-slate-700 bg-white">
                    <option value={0}>0 - Nada</option><option value={1}>1 pt (1 criterio)</option><option value={2}>2 pts (2 criterios)</option><option value={3}>3 pts (Correcto total)</option>
                  </select>
                </div>
              </div>
              <button onClick={() => saveManual(selectedRes.id)} className="w-full py-4 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl transition-colors">Guardar Calificación</button>
            </div>
          )}

          {dashTab === 'evolution' && (
            <div className="space-y-8">
              <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
                <h2 className="text-2xl font-black text-slate-800 mb-2">Análisis de Evolución Neurocognitiva</h2>
                <p className="text-slate-500 mb-8">Comparativa automatizada de participantes que han completado el Pretest (MoCA 8.1) y el Postest (MoCA 8.3).</p>
                
                {groupedData.length === 0 ? (
                  <div className="p-12 text-center bg-slate-50 rounded-xl border border-dashed border-slate-300">
                    <span className="text-4xl mb-4 block">📊</span>
                    <p className="text-slate-500 font-medium">Aún no hay participantes con ambos registros (Pretest y Postest) completados para generar el análisis.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
                    <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 relative">
                      <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest text-center mb-6">Trayectorias Individuales (Puntuación Total)</h3>
                      <svg viewBox="0 0 500 350" className="w-full h-auto overflow-visible font-sans">
                        {[0, 10, 20, 26, 30].map(y => (
                          <g key={y}>
                            <line x1="40" y1={300 - (y*10)} x2="460" y2={300 - (y*10)} stroke={y===26 ? '#ef4444' : '#cbd5e1'} strokeWidth={y===26 ? 2 : 1} strokeDasharray={y===26 ? '4 4' : '0'} />
                            <text x="30" y={300 - (y*10) + 4} fontSize="12" fill={y===26 ? '#ef4444' : '#94a3b8'} textAnchor="end" fontWeight="bold">{y}</text>
                          </g>
                        ))}
                        <text x="460" y={300 - (26*10) - 6} fontSize="10" fill="#ef4444" textAnchor="end" fontWeight="bold">Umbral Normalidad (26)</text>
                        <text x="150" y="330" fontSize="14" fill="#1e293b" textAnchor="middle" fontWeight="black">PRETEST (v8.1)</text>
                        <text x="350" y="330" fontSize="14" fill="#1e293b" textAnchor="middle" fontWeight="black">POSTEST (v8.3)</text>

                        {groupedData.map((g, i) => {
                          const score1 = getTotalScore(g.pre);
                          const score2 = getTotalScore(g.post);
                          const y1 = 300 - (score1 * 10);
                          const y2 = 300 - (score2 * 10);
                          const isBetter = score2 > score1;
                          const isWorse = score2 < score1;
                          const strokeColor = isBetter ? '#10b981' : (isWorse ? '#ef4444' : '#64748b');
                          
                          return (
                            <g key={i}>
                              <line x1="150" y1={y1} x2="350" y2={y2} stroke={strokeColor} strokeWidth="3" opacity="0.7" />
                              <circle cx="150" cy={y1} r="6" fill={strokeColor} />
                              <circle cx="350" cy={y2} r="6" fill={strokeColor} />
                              <text x="135" y={y1+4} fontSize="11" fill="#475569" textAnchor="end" fontWeight="bold">{g.name.split(' ')[0]} ({score1})</text>
                              <text x="365" y={y2+4} fontSize="11" fill="#475569" textAnchor="start" fontWeight="bold">({score2})</text>
                            </g>
                          );
                        })}
                      </svg>
                    </div>

                    <div className="space-y-4">
                      <h3 className="text-lg font-bold text-slate-800 border-b border-slate-200 pb-2 mb-4">Análisis Descriptivo</h3>
                      {groupedData.map((g, i) => {
                        const preTotal = getTotalScore(g.pre);
                        const postTotal = getTotalScore(g.post);
                        const delta = postTotal - preTotal;
                        const deltaMis = g.post.misAuto - g.pre.misAuto;
                        let icon, title, color;
                        if (delta > 0) { icon = '📈'; title = 'Mejora Cognitiva'; color = 'text-green-600 bg-green-50 border-green-200'; }
                        else if (delta < 0) { icon = '📉'; title = 'Deterioro Detectado'; color = 'text-red-600 bg-red-50 border-red-200'; }
                        else { icon = '➖'; title = 'Mantenimiento'; color = 'text-slate-600 bg-slate-50 border-slate-200'; }

                        const missingEval = (!g.pre.evaluado || !g.post.evaluado) ? " (⚠️ Faltan calificaciones manuales en una o ambas pruebas)" : "";

                        return (
                          <div key={i} className={`p-4 rounded-xl border ${color}`}>
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-2xl">{icon}</span>
                              <div>
                                <p className="font-black leading-tight">{g.name} <span className="text-sm font-medium opacity-70 ml-2">({g.pre.grupo})</span></p>
                                <p className="text-xs font-bold uppercase tracking-widest">{title}</p>
                              </div>
                            </div>
                            <p className="text-sm opacity-90 leading-relaxed">
                              El participante partió de un puntaje base de <strong>{preTotal}/30</strong> y obtuvo <strong>{postTotal}/30</strong> en la prueba de seguimiento. 
                              Esto representa una diferencia de <strong>{delta > 0 ? `+${delta}` : delta} puntos</strong> en el MoCA global.
                              <br/>En la Escala de Memoria (MIS), pasó de {g.pre.misAuto}/15 a {g.post.misAuto}/15 ({deltaMis > 0 ? `+${deltaMis}` : deltaMis}).
                              <span className="text-orange-600 font-bold block mt-1">{missingEval}</span>
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {dashTab === 'settings' && (
            <div className="max-w-lg mx-auto bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
              <h2 className="text-2xl font-black text-slate-800 mb-2">Configuración</h2>
              <p className="text-slate-500 mb-8">Gestión de acceso para el panel de investigador.</p>
              
              <div className="space-y-4">
                {passMsg && <div className="p-4 bg-green-50 border border-green-200 text-green-700 font-bold rounded-xl">{passMsg}</div>}
                {passErr && <div className="p-4 bg-red-50 border border-red-200 text-red-700 font-bold rounded-xl">{passErr}</div>}
                
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Contraseña Actual</label>
                  <input type="password" value={oldPass} onChange={e=>setOldPass(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-300 rounded-xl outline-none focus:border-blue-500" placeholder="••••••••" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Nueva Contraseña</label>
                  <input type="password" value={newPass} onChange={e=>setNewPass(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-300 rounded-xl outline-none focus:border-blue-500" placeholder="••••••••" />
                </div>
                
                <button onClick={handleChangePassword} className="w-full py-4 mt-4 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-xl transition-colors">Actualizar Contraseña</button>
              </div>
            </div>
          )}

        </div>
      </div>
    );
  }

  // --- PARTICIPANT SELECTION PREP ---
  if (appState === 'participant_prep') {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 sm:p-12 rounded-3xl shadow-xl max-w-xl w-full border border-slate-200 text-center">
          <h2 className="text-3xl font-black text-slate-800 mb-4">Selección de Fase</h2>
          <p className="text-slate-500 mb-8">Por favor, indique qué evaluación va a realizar.</p>
          <div className="grid grid-cols-2 gap-4 mb-8">
            <button onClick={() => setFaseSelect('Pretest')} className={`p-6 rounded-2xl border-2 transition-all ${faseSelect==='Pretest' ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-md transform scale-105' : 'border-slate-200 text-slate-500 hover:border-blue-300'}`}>
              <div className="text-3xl mb-2">📝</div><div className="font-black text-lg">PRETEST</div><div className="text-xs mt-1">MoCA v8.1</div>
            </button>
            <button onClick={() => setFaseSelect('Postest')} className={`p-6 rounded-2xl border-2 transition-all ${faseSelect==='Postest' ? 'border-teal-600 bg-teal-50 text-teal-700 shadow-md transform scale-105' : 'border-slate-200 text-slate-500 hover:border-teal-300'}`}>
              <div className="text-3xl mb-2">🔄</div><div className="font-black text-lg">POSTEST</div><div className="text-xs mt-1">MoCA v8.3</div>
            </button>
          </div>
          <button onClick={initParticipant} className={`w-full py-4 text-white font-black rounded-xl transition-all shadow-lg ${faseSelect==='Pretest'?'bg-blue-600 hover:bg-blue-700':'bg-teal-600 hover:bg-teal-700'}`}>Continuar a Registro</button>
          <button onClick={() => setAppState('home')} className="mt-6 text-slate-500 font-bold hover:text-slate-800 text-sm">← Cancelar y Volver</button>
        </div>
      </div>
    );
  }

  // --- PARTICIPANT TEST FLOW ---
  if (appState === 'participant_test') {
    const progress = Math.round((Math.floor(step) / 14) * 100);
    const themeColor = cfg.color === 'blue' ? 'bg-blue-600' : 'bg-teal-500';
    const textColor = cfg.color === 'blue' ? 'text-blue-700' : 'text-teal-700';

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
        <div className="bg-white shadow-sm border-b border-slate-200 px-6 py-4 fixed top-0 w-full z-20 flex justify-between items-center">
          <h1 className={`text-xl font-black ${textColor}`}>PANEG <span className="font-medium text-slate-400">| {faseSelect} (v{cfg.version})</span></h1>
          <div className="w-1/3 flex items-center gap-3">
            <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden"><div className={`${themeColor} h-full transition-all duration-500`} style={{width: `${progress}%`}}></div></div>
            <span className="text-xs font-bold text-slate-400">{progress}%</span>
          </div>
        </div>

        <div className="flex-grow pt-24 pb-12 px-4 flex justify-center items-start">
          <div className="bg-white max-w-3xl w-full rounded-3xl shadow-xl border border-slate-100 p-8 sm:p-12">
            
            {step === 0 && (
              <div className="animate-fade-in">
                <h2 className="text-3xl font-black mb-8 text-center text-slate-800">Registro de Participante</h2>
                <div className="space-y-6 max-w-md mx-auto">
                  <input type="text" className="w-full p-4 bg-slate-50 border-2 border-slate-200 rounded-xl focus:border-slate-400 outline-none font-bold text-slate-700" value={formData.nombre} onChange={e=>setFormData({...formData, nombre: e.target.value})} placeholder="Nombre Completo" />
                  <div className="flex gap-4">
                    <input type="number" className="w-1/2 p-4 bg-slate-50 border-2 border-slate-200 rounded-xl outline-none font-bold text-slate-700" value={formData.edad} onChange={e=>setFormData({...formData, edad: e.target.value})} placeholder="Edad" />
                    <input type="number" className="w-1/2 p-4 bg-slate-50 border-2 border-slate-200 rounded-xl outline-none font-bold text-slate-700" value={formData.educacion} onChange={e=>setFormData({...formData, educacion: e.target.value})} placeholder="Años Estudio" />
                  </div>
                  <select className="w-full p-4 bg-slate-50 border-2 border-slate-200 rounded-xl outline-none font-bold text-slate-700" value={formData.grupo} onChange={e=>setFormData({...formData, grupo: e.target.value})}>
                    <option>Experimental (Uso de IAGen)</option><option>Control</option>
                  </select>
                </div>
                <button disabled={!formData.nombre || !formData.edad || !formData.educacion} onClick={()=>setStep(1)} className={`mt-10 w-full max-w-md mx-auto block text-white font-black py-4 rounded-xl disabled:opacity-50 ${themeColor}`}>Comenzar Evaluación</button>
              </div>
            )}

            {step === 1 && (
              <div className="text-center">
                <h2 className="text-2xl font-black mb-4">Alternancia</h2><p className="mb-8 text-slate-500 font-medium">Alterne entre números y letras en orden (1 → A → 2...).</p>
                <div className="relative w-full max-w-md mx-auto h-80 bg-slate-50 border-2 border-slate-200 rounded-2xl mb-8">
                  {[{v:'1',t:'5%',l:'10%'}, {v:'A',t:'75%',l:'15%'}, {v:'2',t:'20%',l:'35%'}, {v:'B',t:'60%',l:'45%'}, {v:'3',t:'15%',l:'60%'}, {v:'C',t:'80%',l:'70%'}, {v:'4',t:'30%',l:'80%'}, {v:'D',t:'55%',l:'90%'}, {v:'5',t:'10%',l:'90%'}, {v:'E',t:'85%',l:'40%'}].map(item => (
                    <button key={item.v} onClick={()=>handleAlternancia(item.v)} disabled={formData.alternancia.includes(item.v)} style={{top:item.t, left:item.l}} className={`absolute w-12 h-12 rounded-full font-black text-xl border-2 transition-all ${formData.alternancia.includes(item.v) ? `${themeColor} text-white scale-90` : 'bg-white text-slate-700 hover:bg-slate-100'}`}>{item.v}</button>
                  ))}
                </div>
                <button onClick={()=>setStep(2)} className="w-full max-w-xs mx-auto block bg-slate-800 text-white font-bold py-3 rounded-xl">Siguiente</button>
              </div>
            )}

            {step === 2 && (
              <div className="text-center">
                <h2 className="text-2xl font-black mb-4">{cfg.visuoTitle}</h2><p className="mb-8 text-slate-500">{cfg.visuoInst}</p>
                <div className="flex flex-col sm:flex-row justify-center gap-8 mb-8">
                  <div className="w-48 h-48 border-2 border-slate-200 bg-slate-50 flex items-center justify-center p-4 text-slate-800"><svg viewBox="0 0 100 100" className="w-full h-full">{cfg.visuoSvg}</svg></div>
                  <DrawingCanvas onSave={(img) => setFormData({...formData, visuo1Img: img})} />
                </div>
                <button onClick={()=>setStep(3)} className="w-full max-w-xs mx-auto block bg-slate-800 text-white font-bold py-3 rounded-xl">Siguiente</button>
              </div>
            )}

            {step === 3 && (
              <div className="text-center">
                <h2 className="text-2xl font-black mb-4">Reloj</h2><p className="mb-8 text-slate-500">Dibuje un reloj analógico marcando <strong className="text-slate-800">{cfg.relojInst}</strong>.</p>
                <div className="mb-8 flex justify-center"><DrawingCanvas onSave={(img) => setFormData({...formData, relojImg: img})} /></div>
                <button onClick={()=>setStep(4)} className="w-full max-w-xs mx-auto block bg-slate-800 text-white font-bold py-3 rounded-xl">Siguiente</button>
              </div>
            )}

            {step === 4 && (
              <div className="text-center">
                <h2 className="text-2xl font-black mb-4">Identificación</h2>
                <div className="grid grid-cols-3 gap-6 mb-10">
                  {[1,2,3].map(n => (
                    <div key={n} className="flex flex-col items-center">
                      <AnimalImage name={cfg.animales[n-1].name} emoji={cfg.animales[n-1].emoji} />
                      <input type="text" className={`mt-4 w-full text-center border-b-2 p-2 text-lg uppercase font-bold outline-none bg-transparent ${cfg.color==='blue'?'focus:border-blue-600':'focus:border-teal-600'}`} value={formData[`animal${n}`]} onChange={e=>setFormData({...formData, [`animal${n}`]: e.target.value})} />
                    </div>
                  ))}
                </div>
                <button onClick={()=>setStep(5)} className="w-full max-w-xs mx-auto block bg-slate-800 text-white font-bold py-3 rounded-xl">Siguiente</button>
              </div>
            )}

            {step === 5 && (
              <div className="text-center py-8">
                <h2 className="text-2xl font-black mb-8">Memoria</h2>
                <div className="h-40 flex items-center justify-center mb-8">
                  {interactive.memoriaPaso===0 && <button onClick={()=>startTimer('memoria')} className={`px-8 py-4 text-white font-black rounded-xl text-xl animate-pulse ${themeColor}`}>Iniciar Lectura</button>}
                  {interactive.memoriaPaso===1 && <h1 className="text-6xl font-black text-slate-800 uppercase">{interactive.letraActual}</h1>}
                  {interactive.memoriaPaso===2 && <p className="text-green-600 font-black text-2xl">¡Recuerde estas palabras!</p>}
                </div>
                {interactive.memoriaPaso===2 && <button onClick={()=>setStep(6)} className="w-full max-w-xs mx-auto block bg-slate-800 text-white font-bold py-3 rounded-xl">Continuar</button>}
              </div>
            )}

            {step === 6 && (
              <div className="text-center">
                <h2 className="text-2xl font-black mb-8">Secuencias</h2>
                <div className="space-y-6 text-left max-w-md mx-auto mb-8">
                  <div className="bg-slate-50 p-6 border border-slate-200 rounded-xl">
                    <p className="font-bold text-slate-700 mb-2">Escriba igual: <span className="tracking-widest bg-yellow-100 px-2 rounded">{cfg.digitsAdelante}</span></p>
                    <input type="text" inputMode="numeric" className="w-full p-3 border-2 rounded-lg text-2xl text-center tracking-[0.5em] outline-none" value={formData.numerosAdelante} onChange={e=>setFormData({...formData, numerosAdelante: e.target.value})} />
                  </div>
                  <div className="bg-slate-50 p-6 border border-slate-200 rounded-xl">
                    <p className="font-bold text-slate-700 mb-2">Escriba AL REVÉS: <span className="tracking-widest bg-yellow-100 px-2 rounded">{cfg.digitsAtras}</span></p>
                    <input type="text" inputMode="numeric" className="w-full p-3 border-2 rounded-lg text-2xl text-center tracking-[0.5em] outline-none" value={formData.numerosAtras} onChange={e=>setFormData({...formData, numerosAtras: e.target.value})} />
                  </div>
                </div>
                <button onClick={()=>setStep(7)} className="w-full max-w-xs mx-auto block bg-slate-800 text-white font-bold py-3 rounded-xl">Siguiente</button>
              </div>
            )}

            {step === 7 && (
              <div className="text-center py-4">
                <h2 className="text-2xl font-black mb-4">Vigilancia</h2><p className="mb-8 text-slate-500">Toque el botón <strong>SÓLO</strong> cuando vea la letra <strong>A</strong>.</p>
                <div className="h-64 flex flex-col items-center justify-center mb-8">
                  {!interactive.letrasActivas && !interactive.letrasTerminadas && <button onClick={()=>startTimer('letras')} className={`px-8 py-4 text-white font-black rounded-xl text-xl animate-pulse ${themeColor}`}>Comenzar</button>}
                  {interactive.letrasActivas && (
                    <><div className="h-32 flex items-center justify-center mb-4"><h1 className="text-8xl font-black">{interactive.letraActual}</h1></div>
                    <button onMouseDown={tapLetra} onTouchStart={tapLetra} className="w-32 h-32 bg-red-500 text-white font-black text-3xl rounded-full shadow-xl active:scale-90 border-4 border-white select-none">¡A!</button></>
                  )}
                  {interactive.letrasTerminadas && <p className="text-green-600 font-black text-2xl">Completado</p>}
                </div>
                {interactive.letrasTerminadas && <button onClick={()=>setStep(8)} className="w-full max-w-xs mx-auto block bg-slate-800 text-white font-bold py-3 rounded-xl">Siguiente</button>}
              </div>
            )}

            {step === 8 && (
              <div className="text-center">
                <h2 className="text-2xl font-black mb-6">Restas</h2><p className="mb-8 text-slate-500">Reste 7 a <strong>{cfg.restaBase}</strong> sucesivamente.</p>
                <div className="flex flex-wrap justify-center items-center gap-2 mb-10 bg-slate-50 p-6 rounded-xl border border-slate-100">
                  <span className="font-black text-slate-400 text-2xl">{cfg.restaBase}</span> <span className="text-slate-300 font-bold">→</span>
                  {formData.restas.map((v, i) => (
                    <React.Fragment key={i}>{i>0 && <span className="text-slate-300 font-bold">→</span>}
                      <input type="number" className="w-16 h-16 p-2 border-2 border-slate-300 rounded-xl text-center text-xl font-bold outline-none" value={v} onChange={e=>{const r=[...formData.restas]; r[i]=e.target.value; setFormData({...formData, restas: r});}} />
                    </React.Fragment>
                  ))}
                </div>
                <button onClick={()=>setStep(9)} className="w-full max-w-xs mx-auto block bg-slate-800 text-white font-bold py-3 rounded-xl">Siguiente</button>
              </div>
            )}

            {step === 9 && (
              <div className="text-center">
                <h2 className="text-2xl font-black mb-6">Repetición</h2>
                <div className="space-y-6 text-left max-w-lg mx-auto mb-8">
                  {[1,2].map(n => (
                    <div key={n} className="bg-slate-50 p-5 rounded-xl border border-slate-200">
                      <p className="font-bold italic text-slate-700 mb-3">"{cfg.frases[n-1]}"</p>
                      <input type="text" className="w-full p-3 border-2 border-white rounded-lg outline-none font-medium" value={formData[`frase${n}`]} onChange={e=>setFormData({...formData, [`frase${n}`]: e.target.value})} placeholder="Escriba exacto..." />
                    </div>
                  ))}
                </div>
                <button onClick={()=>setStep(10)} className="w-full max-w-xs mx-auto block bg-slate-800 text-white font-bold py-3 rounded-xl">Siguiente</button>
              </div>
            )}

            {step === 10 && (
              <div className="text-center">
                <h2 className="text-2xl font-black mb-4">Fluidez Verbal</h2><p className="mb-6 text-slate-500">1 minuto. Palabras con la letra <strong className="text-xl">{cfg.fluidezLetra}</strong>.</p>
                {!interactive.fluidezActiva && !interactive.fluidezTerminada && <button onClick={()=>startTimer('fluidez')} className={`px-8 py-3 text-white font-black rounded-xl animate-pulse mb-8 ${themeColor}`}>Iniciar Tiempo</button>}
                {(interactive.fluidezActiva || interactive.fluidezTerminada) && (
                  <div className="max-w-lg mx-auto mb-8 bg-slate-50 p-6 rounded-xl border border-slate-200">
                    <div className={`text-4xl font-black mb-4 ${interactive.tiempoFluidez<=10&&interactive.tiempoFluidez>0?'text-red-500':'text-slate-800'}`}>00:{interactive.tiempoFluidez<10?`0${interactive.tiempoFluidez}`:interactive.tiempoFluidez}</div>
                    <textarea rows="4" className="w-full p-4 border-2 rounded-xl font-medium outline-none resize-none" value={formData.fluidez} onChange={e=>setFormData({...formData, fluidez: e.target.value})} disabled={interactive.fluidezTerminada||!interactive.fluidezActiva} placeholder="Escriba aquí, separando por comas..."></textarea>
                    {(() => {
                      const analisis = analizarFluidez(formData.fluidez, cfg.fluidezLetra);
                      return (
                        <div className="mt-4 text-left text-sm space-y-1">
                          <p className="font-bold text-slate-700">Palabras válidas y diferentes: {analisis.cantidadValidas}</p>
                          {analisis.repetidas.length > 0 && <p className="text-orange-700">Repetidas: {analisis.repetidas.join(', ')}</p>}
                          {analisis.letraIncorrecta.length > 0 && <p className="text-red-700">No empiezan con {cfg.fluidezLetra}: {analisis.letraIncorrecta.join(', ')}</p>}
                        </div>
                      );
                    })()}
                  </div>
                )}
                {interactive.fluidezTerminada && <button onClick={()=>setStep(11)} className="w-full max-w-xs mx-auto block bg-slate-800 text-white font-bold py-3 rounded-xl">Siguiente</button>}
              </div>
            )}

            {step === 11 && (
              <div className="text-center">
                <h2 className="text-2xl font-black mb-6">Abstracción</h2>
                <div className="space-y-4 text-left max-w-md mx-auto mb-8">
                  {[1,2].map(n => (
                    <div key={n} className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex items-center justify-between">
                      <span className="font-bold text-slate-700 w-1/2">{cfg.absPares[n-1].a} - {cfg.absPares[n-1].b}</span>
                      <input type="text" className="w-1/2 p-2 border-2 border-white rounded-lg outline-none font-medium" placeholder="Son..." value={formData[`similitud${n}`]} onChange={e=>setFormData({...formData, [`similitud${n}`]: e.target.value})} />
                    </div>
                  ))}
                </div>
                <button onClick={()=>setStep(12)} className="w-full max-w-xs mx-auto block bg-slate-800 text-white font-bold py-3 rounded-xl">Siguiente</button>
              </div>
            )}

            {/* RECUERDO Y MIS */}
            {step === 12 && (
              <div className="text-center">
                <h2 className="text-2xl font-black mb-4">Recuerdo Diferido</h2><p className="mb-6 text-slate-500">Escriba las 5 palabras memorizadas.</p>
                <div className="flex flex-col gap-3 max-w-xs mx-auto mb-8">
                  {[0,1,2,3,4].map(idx => (
                    <input key={idx} type="text" className="w-full p-3 bg-slate-50 border-2 rounded-xl text-center text-lg uppercase font-bold outline-none" value={formData.recuerdoEspontaneo[idx]} onChange={e=>{const r=[...formData.recuerdoEspontaneo]; r[idx]=e.target.value; setFormData({...formData, recuerdoEspontaneo: r});}} />
                  ))}
                </div>
                <button onClick={()=>evaluarMIS('espontaneo')} className="w-full max-w-xs mx-auto block bg-slate-800 text-white font-bold py-3 rounded-xl">Evaluar</button>
              </div>
            )}

            {step === 12.1 && (
              <div className="text-center">
                <h2 className="text-2xl font-black mb-4">Pistas de Categoría</h2><p className="mb-6 text-slate-500">Faltaron algunas. Aquí hay pistas.</p>
                <div className="flex flex-col gap-4 max-w-md mx-auto mb-8 text-left">
                  {interactive.faltantesCat.map(p => (
                    <div key={p} className="bg-orange-50 p-4 border border-orange-100 rounded-xl"><p className="text-sm font-bold text-orange-800 mb-2">Es un/una: {cfg.pistasCategoria[p]}</p><input type="text" className="w-full p-2 bg-white border-2 rounded-lg uppercase font-bold outline-none" value={formData.recuerdoCategoria[p]||''} onChange={e=>setFormData({...formData, recuerdoCategoria: {...formData.recuerdoCategoria, [p]: e.target.value}})}/></div>
                  ))}
                </div>
                <button onClick={()=>evaluarMIS('categoria')} className="w-full max-w-xs mx-auto block bg-slate-800 text-white font-bold py-3 rounded-xl">Siguiente</button>
              </div>
            )}

            {step === 12.2 && (
              <div className="text-center">
                <h2 className="text-2xl font-black mb-4">Opciones</h2><p className="mb-6 text-slate-500">Seleccione la correcta.</p>
                <div className="flex flex-col gap-4 max-w-sm mx-auto mb-8 text-left">
                  {interactive.faltantesOpc.map(p => (
                    <div key={p} className="bg-purple-50 p-4 border border-purple-100 rounded-xl flex flex-col gap-2">
                      {cfg.pistasOpciones[p].map(opt => (
                        <label key={opt} className="flex items-center gap-3 p-2 bg-white rounded-lg border-2 cursor-pointer"><input type="radio" name={`opt_${p}`} value={opt} checked={formData.recuerdoOpcion[p]===opt} onChange={e=>setFormData({...formData, recuerdoOpcion: {...formData.recuerdoOpcion, [p]: e.target.value}})}/><span className="uppercase font-bold">{opt}</span></label>
                      ))}
                    </div>
                  ))}
                </div>
                <button onClick={()=>setStep(13)} className="w-full max-w-xs mx-auto block bg-slate-800 text-white font-bold py-3 rounded-xl">Siguiente</button>
              </div>
            )}

            {step === 13 && (
              <div className="text-center">
                <h2 className="text-2xl font-black mb-6">Orientación</h2>
                <div className="space-y-4 max-w-md mx-auto text-left mb-10">
                  <input type="date" className="w-full p-4 bg-slate-50 border-2 rounded-xl font-bold text-slate-700 outline-none" value={formData.fecha} onChange={e=>setFormData({...formData, fecha: e.target.value})} />
                  <input type="text" className="w-full p-4 bg-slate-50 border-2 rounded-xl font-bold text-slate-700 outline-none" placeholder="Lugar actual (Ej. Clínica)" value={formData.lugar} onChange={e=>setFormData({...formData, lugar: e.target.value})} />
                  <input type="text" className="w-full p-4 bg-slate-50 border-2 rounded-xl font-bold text-slate-700 outline-none" placeholder="Ciudad" value={formData.localidad} onChange={e=>setFormData({...formData, localidad: e.target.value})} />
                </div>
                {authError && <div className="max-w-md mx-auto mb-4 p-4 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm font-medium">{authError}</div>}
                {saveError && <div className="max-w-md mx-auto mb-4 p-4 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm font-medium">{saveError}</div>}
                {saveSuccess && <div className="max-w-md mx-auto mb-4 p-4 rounded-xl border border-green-200 bg-green-50 text-green-700 text-sm font-medium">{saveSuccess}</div>}
                <button
                  onClick={submitTest}
                  disabled={guardando || !authReady || !user}
                  className={`w-full max-w-md mx-auto block text-white font-black py-4 rounded-xl shadow-lg transform hover:-translate-y-1 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${themeColor}`}
                >
                  {guardando ? 'Guardando...' : !authReady ? 'Conectando con Firebase...' : 'Guardar Resultados'}
                </button>
              </div>
            )}

            {step === 15 && (
              <div className="text-center py-16">
                <div className={`w-24 h-24 text-white rounded-full flex items-center justify-center text-5xl mx-auto mb-6 ${themeColor}`}>✓</div>
                <h2 className="text-3xl font-black text-slate-800 mb-4">Evaluación {faseSelect} Completada</h2>
                <p className="text-slate-500 mb-8 font-medium">Sus respuestas han sido registradas para el proyecto PANEG.</p>
                <button onClick={()=>{setAppState('home'); setStep(0);}} className="px-8 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors">Volver al Inicio</button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}