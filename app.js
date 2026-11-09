"use strict";

const TITULACIONES = ["PNB", "PER", "PY", "CY"];
const RUTA_DATOS = window.RUTA_DATOS || "../salida/";

// Materias de cada titulacion (en el orden del examen) y nº de preguntas de cada una
// en el examen oficial. El tercer valor (opcional) es el minimo de aciertos de esa materia.
const ESTRUCTURA = {
  PNB: [["Nomenclatura náutica", 4], ["Elementos de amarre y fondeo", 2], ["Seguridad", 4],
        ["Legislación", 2], ["Balizamiento", 5, 3], ["Reglamento (RIPA)", 10, 5]],
  PER: [["Nomenclatura náutica", 4], ["Elementos de amarre y fondeo", 2], ["Seguridad", 4],
        ["Legislación", 2], ["Balizamiento", 5, 3], ["Reglamento (RIPA)", 10, 5],
        ["Maniobra y navegación", 2], ["Emergencias en la mar", 3], ["Meteorología", 4],
        ["Teoría de la navegación", 5], ["Carta de navegación", 4, 2]],
  PY:  [["Seguridad en la mar", 10, 5], ["Meteorología", 10, 5], ["Teoría de navegación", 10, 5],
        ["Navegación carta", 10, 7]],
  CY:  [["Teoría de navegación", 10, 5], ["Cálculo de navegación", 10, 6], ["Meteorología", 10, 5],
        ["Inglés", 10, 5]],
};

// Criterio de aprobado del examen oficial: aciertos minimos en total y como se combinan con
// los minimos por materia ("ambos": hacen falta los dos; "global_o_materias": basta con uno).
// PNB y PER: convocatorias oficiales (Melilla, PNB 17/27 y PER 32/45, errores maximos RIPA 5,
// balizamiento 2 y carta 2). PY: Murcia. CY: minimos indicados por el usuario.
// Por indicacion del usuario, en todos los examenes hay que cumplir ambos requisitos a la vez.
const CRITERIO = {
  PNB: { min: 17, modo: "ambos" },
  PER: { min: 32, modo: "ambos" },
  PY:  { min: 28, modo: "ambos" },
  CY:  { min: 28, modo: "ambos" },
};

// materias cuyas preguntas se acompañan de las tablas de su examen (los ejercicios de calculo y
// de carta): en el modo oficial se sacan todas del mismo examen para que las tablas coincidan
const MATERIAS_CON_TABLAS = { PER: "Carta de navegación", PY: "Navegación carta", CY: "Cálculo de navegación" };

function totalExamen(tit) {
  return ESTRUCTURA[tit].reduce((t, m) => t + m[1], 0);
}

function minimoMateria(tit, materia) {
  const fila = ESTRUCTURA[tit].find(m => m[0] === materia);
  return fila && fila.length > 2 ? { min: fila[2], de: fila[1] } : null;
}

// Fuentes de los examenes (DGMM nacional y comunidades autonomas): cada titulacion tiene un
// fichero por fuente; solo se cargan las que el alumno deja marcadas
const DGMM = "DGMM (Nacional)";
let fuentesDisponibles = {};          // tit -> [{slug, nombre, preguntas, grupos}]
const fuentesDesmarcadas = new Set(); // slugs que el alumno ha quitado (por defecto, todas marcadas)
const cacheFuentes = {};              // "TIT|slug" -> Promise de las preguntas usables
let explicaciones = {};   // clave de pregunta -> texto (se rellena por tandas; puede estar incompleto)

function cargaExplicaciones() {
  fetch(`${RUTA_DATOS}explicaciones.json`)
    .then(r => (r.ok ? r.json() : {}))
    .then(data => { explicaciones = data || {}; })
    .catch(() => { explicaciones = {}; });
}

// texto explicativo de una pregunta (las del juego de palabras lo llevan incorporado)
function explicacionDe(q) {
  return q.explicacion || (q.clave && explicaciones[q.clave]) || "";
}

// etiqueta de origen de una pregunta (examen y convocatoria, o juego de palabras)
function etiquetaDe(q) {
  if (q.juego) return `${q.titulacion} · ${q.materia}`;
  const fuente = q.procedencia && q.procedencia !== DGMM ? ` · ${q.procedencia}` : "";
  return `${q.titulacion} · ${q.materia}${fuente} · ${q.convocatoria} ${q.examen} #${q.numero}`;
}

function muestraExplicacion(q, esCorrecta) {
  const caja = document.getElementById("explicacion");
  caja.innerHTML = "";
  const texto = explicacionDe(q);
  if (!texto) {
    caja.classList.add("oculta");
    return;
  }
  const titulo = document.createElement("strong");
  titulo.textContent = q.juego ? "Significado"
    : esCorrecta ? "¿Por qué es correcta?"
    : `La correcta es la ${q.respuesta.toUpperCase()}. ¿Por qué?`;
  caja.appendChild(titulo);
  texto.split(/\n\s*\n/).forEach(parrafo => {
    const p = document.createElement("p");
    p.textContent = parrafo.trim();
    caja.appendChild(p);
  });
  caja.classList.remove("oculta");
}

// materias marcadas por titulacion (por defecto todas)
const materiasMarcadas = {};
TITULACIONES.forEach(t => { materiasMarcadas[t] = new Set(ESTRUCTURA[t].map(m => m[0])); });

// "Juego de palabras en inglés" (solo CY): preguntas generadas a partir del vocabulario
// ingles_nautico.json, sin preguntas de examen; excluye al resto de materias y al modo oficial
const MATERIA_JUEGO = "Juego de palabras en inglés";
let juegoPalabras = false;
let materiasAntesJuego = null;    // materias marcadas antes de activar el juego (para restaurarlas)
let vocabulario = null;           // [{id, en, es, origen, nota?}]
let vocabularioEnCurso = null;

function cargaVocabulario() {
  if (vocabulario) return Promise.resolve(vocabulario);
  if (!vocabularioEnCurso) {
    vocabularioEnCurso = fetch(`${RUTA_DATOS}ingles_nautico.json`)
      .then(r => {
        if (!r.ok) throw new Error(`No se pudo cargar el vocabulario (HTTP ${r.status})`);
        return r.json();
      })
      .then(data => { vocabulario = data; return data; })
      .finally(() => { vocabularioEnCurso = null; });
  }
  return vocabularioEnCurso;
}

let modo = "total";               // "total" | "oficial"
let numeroPreguntasElegido = 30;
let cola = [];
let indiceActual = 0;
let respuestasDadas = [];         // letra elegida por pregunta (null = sin contestar)
let aciertos = 0;
let falladas = [];
let porMateria = {};              // "TIT|materia" -> {tit, materia, ok, total}
let esExamenOficial = false;      // el test en curso es una simulacion del examen oficial
let modoReporte = false;          // modo "reporte de errores" activado al empezar
let pantallaActual = "inicio";
let pantallaPrevia = "inicio";

// recalcula aciertos, falladas y resumen por materia a partir de las respuestas dadas
function recalcula() {
  aciertos = 0;
  falladas = [];
  porMateria = {};
  cola.forEach((q, i) => {
    const elegida = respuestasDadas[i];
    if (!elegida) return;
    const clave = `${q.titulacion}|${q.materia}`;
    if (!porMateria[clave]) porMateria[clave] = { tit: q.titulacion, materia: q.materia, ok: 0, total: 0 };
    porMateria[clave].total++;
    if (elegida === q.respuesta.toLowerCase()) {
      aciertos++;
      porMateria[clave].ok++;
    } else {
      falladas.push({ pregunta: q, elegida });
    }
  });
}

// ---------- utilidades ----------

function barajar(array) {
  const copia = array.slice();
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

function escapaHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

const datosCargados = {};   // "TIT|slug" -> preguntas ya descargadas

function fuentesActivas(tit) {
  return (fuentesDisponibles[tit] || []).filter(f => !fuentesDesmarcadas.has(f.slug));
}

function cargaFuente(tit, slug) {
  const k = `${tit}|${slug}`;
  if (!cacheFuentes[k]) {
    cacheFuentes[k] = fetch(`${RUTA_DATOS}por_fuente/${tit}/${tit}_${slug}.json`)
      .then(r => {
        if (!r.ok) throw new Error(`No se pudo cargar ${tit} (${slug}): HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        // las preguntas anuladas no tienen una respuesta correcta valida
        const usable = data.filter(q => q.estado !== "anulada" && q.respuesta);
        datosCargados[k] = usable;
        return usable;
      })
      .catch(err => { delete cacheFuentes[k]; throw err; });
  }
  return cacheFuentes[k];
}

// carga (si hace falta) las fuentes marcadas de una titulacion
async function cargaTitulacion(tit) {
  await Promise.all(fuentesActivas(tit).map(f => cargaFuente(tit, f.slug)));
  return datosDe(tit);
}

// preguntas de una titulacion de las fuentes marcadas que ya estan cargadas
function datosDe(tit) {
  let todas = [];
  fuentesActivas(tit).forEach(f => { todas = todas.concat(datosCargados[`${tit}|${f.slug}`] || []); });
  return todas;
}

function cargaFuentesDisponibles() {
  return fetch(`${RUTA_DATOS}fuentes.json`)
    .then(r => (r.ok ? r.json() : Promise.reject(new Error("No se pudo cargar fuentes.json"))))
    .then(data => { fuentesDisponibles = data; });
}

function guardaPreferencias() {
  try {
    localStorage.setItem("test-nautica-prefs", JSON.stringify({
      tits: titulacionesSeleccionadas(),
      materias: Object.fromEntries(TITULACIONES.map(t => [t, Array.from(materiasMarcadas[t])])),
      modo, n: numeroPreguntasElegido, reporte: modoReporte,
      juego: juegoPalabras, antesJuego: materiasAntesJuego,
      fuentesOff: Array.from(fuentesDesmarcadas),
    }));
  } catch (e) { /* almacenamiento no disponible: se ignora */ }
}

function cargaPreferencias() {
  try {
    const p = JSON.parse(localStorage.getItem("test-nautica-prefs"));
    if (!p) return;
    document.querySelectorAll("#opciones-titulacion input").forEach(i => {
      i.checked = (p.tits || []).includes(i.value);
    });
    TITULACIONES.forEach(t => {
      if (p.materias && Array.isArray(p.materias[t])) {
        const validas = new Set(ESTRUCTURA[t].map(m => m[0]));
        materiasMarcadas[t] = new Set(p.materias[t].filter(m => validas.has(m)));
      }
    });
    if (p.modo === "oficial" || p.modo === "total") modo = p.modo;
    if (typeof p.n === "number") numeroPreguntasElegido = p.n;
    modoReporte = p.reporte === true;
    fuentesDesmarcadas.clear();
    (Array.isArray(p.fuentesOff) ? p.fuentesOff : []).forEach(f => fuentesDesmarcadas.add(f));
    juegoPalabras = p.juego === true;
    materiasAntesJuego = p.antesJuego && typeof p.antesJuego === "object" ? p.antesJuego : null;
    if (juegoPalabras && !(p.tits || []).includes("CY")) activaJuego(false);
  } catch (e) { /* preferencias corruptas: se ignoran */ }
}

// el juego solo existe dentro de CY
function juegoActivo() {
  return juegoPalabras && titulacionesSeleccionadas().includes("CY");
}

// activa o desactiva el juego: al activarlo se desmarcan todas las materias (y se guardan para
// restaurarlas); al desactivarlo (p. ej. al quitar CY) se recuperan las que estaban marcadas
function activaJuego(on) {
  if (on === juegoPalabras) return;
  juegoPalabras = on;
  if (on) {
    materiasAntesJuego = Object.fromEntries(TITULACIONES.map(t => [t, Array.from(materiasMarcadas[t])]));
    TITULACIONES.forEach(t => { materiasMarcadas[t] = new Set(); });
    modo = "total";
  } else {
    TITULACIONES.forEach(t => {
      const previas = materiasAntesJuego && materiasAntesJuego[t];
      const validas = new Set(ESTRUCTURA[t].map(m => m[0]));
      const recuperadas = (previas || []).filter(m => validas.has(m));
      materiasMarcadas[t] = new Set(recuperadas.length ? recuperadas : Array.from(validas));
    });
    materiasAntesJuego = null;
  }
}

// el alumno elige una materia de examen mientras el juego estaba activo: el juego se desmarca
// y la selección pasa a ser solo lo que elija a partir de ahora
function abandonaJuego() {
  juegoPalabras = false;
  materiasAntesJuego = null;
}

// ---------- pantalla inicio ----------

function titulacionesSeleccionadas() {
  return Array.from(document.querySelectorAll("#opciones-titulacion input:checked")).map(i => i.value);
}

// la misma pregunta sale en varias convocatorias: `grupo` identifica todas sus apariciones
function grupoDe(q) { return q.grupo || q.clave || q.id; }

function cuentaDistintas(preguntas) {
  return new Set(preguntas.map(grupoDe)).size;
}

// una sola aparicion por grupo (al azar, mejor si el texto no viene de OCR); se saltan los grupos ya usados
function unicasPorGrupo(pool, vistos) {
  const porGrupo = new Map();
  pool.forEach(q => {
    const g = grupoDe(q);
    if (vistos && vistos.has(g)) return;
    if (!porGrupo.has(g)) porGrupo.set(g, []);
    porGrupo.get(g).push(q);
  });
  const resultado = [];
  porGrupo.forEach(qs => {
    const limpias = qs.filter(q => !q.origen_ocr);
    const fuente = limpias.length ? limpias : qs;
    resultado.push(fuente[Math.floor(Math.random() * fuente.length)]);
  });
  return resultado;
}

// casillas de «Fuente de los exámenes» (selección múltiple): todas marcadas por defecto
function pintaFuentes() {
  const cont = document.getElementById("bloque-fuentes");
  cont.innerHTML = "";
  const seleccion = titulacionesSeleccionadas();
  const porSlug = new Map();   // slug -> {nombre, n}
  TITULACIONES.forEach(tit => (fuentesDisponibles[tit] || []).forEach(f => {
    if (!porSlug.has(f.slug)) porSlug.set(f.slug, { nombre: f.nombre, n: 0 });
    if (seleccion.includes(tit)) porSlug.get(f.slug).n += f.preguntas;
  }));
  if (porSlug.size <= 1) return;   // con una sola fuente no hay nada que elegir
  const cab = document.createElement("div");
  cab.className = "grupo-cab";
  cab.innerHTML = `<strong>Fuente de los exámenes</strong>
    <span class="grupo-info">${porSlug.size} fuentes</span>
    <span class="grupo-acciones"><button type="button" class="link" data-acc="todas">todas</button> ·
    <button type="button" class="link" data-acc="ninguna">ninguna</button></span>`;
  const grupo = document.createElement("div");
  grupo.className = "grupo-materias grupo-fuentes";
  grupo.appendChild(cab);
  const chips = document.createElement("div");
  chips.className = "chips";
  porSlug.forEach((info, slug) => {
    const label = document.createElement("label");
    label.className = "chip";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !fuentesDesmarcadas.has(slug);
    input.addEventListener("change", () => {
      if (input.checked) fuentesDesmarcadas.delete(slug); else fuentesDesmarcadas.add(slug);
      cambioDeFuentes();
    });
    const span = document.createElement("span");
    span.innerHTML = `${escapaHtml(info.nombre)}<small>${info.n} preguntas${info.n === 0 ? " (de las titulaciones elegidas)" : ""}</small>`;
    label.appendChild(input);
    label.appendChild(span);
    chips.appendChild(label);
  });
  grupo.appendChild(chips);
  cont.appendChild(grupo);
  cab.querySelectorAll(".link").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.acc === "todas") fuentesDesmarcadas.clear();
      else porSlug.forEach((_, slug) => fuentesDesmarcadas.add(slug));
      cambioDeFuentes();
    });
  });
}

function cambioDeFuentes() {
  pintaFuentes();
  refrescaDatos();
  pintaMaterias();
  actualizaResumen();
  guardaPreferencias();
}

// carga en segundo plano las fuentes marcadas de las titulaciones elegidas y refresca los contadores
function refrescaDatos() {
  TITULACIONES.forEach(tit => {
    const tarjeta = document.querySelector(`.n-preguntas[data-tit="${tit}"]`);
    if (!titulacionesSeleccionadas().includes(tit)) {
      const grupos = fuentesActivas(tit).reduce((s, f) => s + f.grupos, 0);
      if (tarjeta && fuentesDisponibles[tit]) tarjeta.textContent = `${grupos} preguntas`;
      return;
    }
    if (tarjeta) tarjeta.textContent = "cargando…";
    cargaTitulacion(tit)
      .then(data => {
        actualizaContadorTarjeta(tit, cuentaDistintas(data));
        pintaMaterias(); // refresca los contadores "en el banco"
      })
      .catch(err => {
        if (tarjeta) tarjeta.textContent = "error al cargar";
        console.error(err);
      });
  });
}

function actualizaContadorTarjeta(tit, n) {
  const el = document.querySelector(`.n-preguntas[data-tit="${tit}"]`);
  if (el) el.textContent = `${n} preguntas`;
}

function contarEnBanco(tit, materia) {
  const activas = fuentesActivas(tit);
  if (activas.some(f => !datosCargados[`${tit}|${f.slug}`])) return null;
  const datos = datosDe(tit);
  return cuentaDistintas(datos.filter(q => q.materia === materia));
}

// casilla "Juego de palabras en inglés" del grupo CY
function chipJuego() {
  const label = document.createElement("label");
  label.className = "chip chip-juego";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = juegoActivo();
  input.addEventListener("change", () => {
    activaJuego(input.checked);
    pintaMaterias();
    actualizaResumen();
    guardaPreferencias();
  });
  const span = document.createElement("span");
  span.innerHTML = `${escapaHtml(MATERIA_JUEGO)}<small>vocabulario náutico inglés ↔ castellano, sin preguntas de examen` +
    (vocabulario ? ` · ${vocabulario.length} términos` : "") + "</small>";
  label.appendChild(input);
  label.appendChild(span);
  return label;
}

function pintaMaterias() {
  const cont = document.getElementById("bloque-materias");
  cont.innerHTML = "";
  const seleccion = titulacionesSeleccionadas();
  if (seleccion.length === 0) {
    cont.innerHTML = '<p class="vacio">Elige al menos una titulación.</p>';
    return;
  }
  seleccion.forEach(tit => {
    const grupo = document.createElement("div");
    grupo.className = "grupo-materias";
    const total = ESTRUCTURA[tit].reduce((s, m) => s + m[1], 0);
    grupo.innerHTML = `<div class="grupo-cab"><strong>${tit}</strong>
      <span class="grupo-info">examen de ${total} preguntas</span>
      <span class="grupo-acciones"><button type="button" class="link" data-tit="${tit}" data-acc="todas">todas</button> ·
      <button type="button" class="link" data-tit="${tit}" data-acc="ninguna">ninguna</button></span></div>
      <div class="chips"></div>`;
    const chips = grupo.querySelector(".chips");
    ESTRUCTURA[tit].forEach(([materia, nOficial]) => {
      const enBanco = contarEnBanco(tit, materia);
      const requisito = minimoMateria(tit, materia);
      const label = document.createElement("label");
      label.className = "chip";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = materiasMarcadas[tit].has(materia);
      input.addEventListener("change", () => {
        const veniaDelJuego = juegoPalabras;
        if (veniaDelJuego) abandonaJuego();
        if (input.checked) materiasMarcadas[tit].add(materia);
        else materiasMarcadas[tit].delete(materia);
        if (veniaDelJuego) pintaMaterias();
        actualizaResumen();
        guardaPreferencias();
      });
      const span = document.createElement("span");
      span.innerHTML = `${escapaHtml(materia)}<small>${nOficial} en el examen` +
        (requisito ? ` (mín. ${requisito.min} aciertos)` : "") +
        (enBanco !== null ? ` · ${enBanco} en el banco` : "") + "</small>";
      label.appendChild(input);
      label.appendChild(span);
      chips.appendChild(label);
    });
    if (tit === "CY") chips.appendChild(chipJuego());
    cont.appendChild(grupo);
  });

  cont.querySelectorAll(".link").forEach(btn => {
    btn.addEventListener("click", () => {
      const tit = btn.dataset.tit;
      if (juegoPalabras) abandonaJuego();
      materiasMarcadas[tit] = btn.dataset.acc === "todas"
        ? new Set(ESTRUCTURA[tit].map(m => m[0])) : new Set();
      pintaMaterias();
      actualizaResumen();
      guardaPreferencias();
    });
  });
}

function totalOficialSeleccion() {
  let total = 0;
  titulacionesSeleccionadas().forEach(tit => {
    ESTRUCTURA[tit].forEach(([materia, n]) => {
      if (materiasMarcadas[tit].has(materia)) total += n;
    });
  });
  return total;
}

function actualizaResumen() {
  const el = document.getElementById("resumen-seleccion");
  const juego = juegoActivo();
  if (juego) modo = "total";   // el juego de palabras no sigue el examen oficial
  document.getElementById("opciones-n").classList.toggle("oculta", modo === "oficial");
  document.querySelectorAll("#opciones-modo .n-btn").forEach(b => {
    b.classList.toggle("n-btn-activo", b.dataset.modo === modo);
    if (b.dataset.modo === "oficial") {
      b.disabled = juego;
      b.title = juego ? "No disponible en el juego de palabras en inglés" : "";
    }
  });
  document.querySelectorAll("#opciones-n .n-btn").forEach(b =>
    b.classList.toggle("n-btn-activo", parseInt(b.dataset.n, 10) === numeroPreguntasElegido));
  if (juego) {
    const total = vocabulario ? vocabulario.length : null;
    const n = total === null ? null : (numeroPreguntasElegido === 0 ? total : Math.min(numeroPreguntasElegido, total));
    el.textContent = "Juego de palabras en inglés: " + (n === null ? "preguntas" : `${n} preguntas`) +
      " de 4 opciones, mezclando inglés → castellano y castellano → inglés. No usa preguntas de examen.";
  } else if (modo === "oficial") {
    const aprobado = titulacionesSeleccionadas()
      .filter(t => ESTRUCTURA[t].every(m => materiasMarcadas[t].has(m[0])))
      .map(t => `${t} ${totalExamen(t)} preguntas, apto con ${CRITERIO[t].min} aciertos`);
    // los ejercicios de calculo y de carta necesitan las tablas del examen: solo las traen los del Ministerio
    const sinTablas = titulacionesSeleccionadas().filter(t => materiasMarcadas[t].has(MATERIAS_CON_TABLAS[t]) &&
      fuentesActivas(t).every(f => datosCargados[`${t}|${f.slug}`]) &&
      !datosDe(t).some(q => q.materia === MATERIAS_CON_TABLAS[t]));
    el.textContent = `Saldrán ${totalOficialSeleccion() - sinTablas.reduce((n, t) => n + (ESTRUCTURA[t].find(m => m[0] === MATERIAS_CON_TABLAS[t]) || [0, 0])[1], 0)} preguntas, repartidas por materia como en el examen oficial.` +
      (aprobado.length && sinTablas.length === 0 ? ` Examen completo: ${aprobado.join(" · ")}.` : "") +
      (sinTablas.length ? ` Con las fuentes elegidas no hay ejercicios de ${sinTablas.map(t => MATERIAS_CON_TABLAS[t].toLowerCase()).join(" ni de ")}: necesitan las tablas del examen y solo las traen los exámenes del Ministerio (DGMM).` : "");
  } else {
    el.textContent = "";
  }
}

function initPantallaInicio() {
  cargaPreferencias();
  cargaExplicaciones();

  cargaFuentesDisponibles()
    .then(() => { pintaFuentes(); refrescaDatos(); pintaMaterias(); actualizaResumen(); })
    .catch(err => {
      document.querySelectorAll(".n-preguntas").forEach(el => { el.textContent = "error al cargar"; });
      console.error(err);
    });

  cargaVocabulario()
    .then(() => { pintaMaterias(); actualizaResumen(); })
    .catch(err => console.error(err));

  document.querySelectorAll("#opciones-titulacion input").forEach(i => {
    i.addEventListener("change", () => {
      if (juegoPalabras && !titulacionesSeleccionadas().includes("CY")) activaJuego(false);
      pintaFuentes();
      refrescaDatos();
      pintaMaterias();
      actualizaResumen();
      guardaPreferencias();
    });
  });

  document.querySelectorAll("#opciones-modo .n-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      modo = btn.dataset.modo;
      actualizaResumen();
      guardaPreferencias();
    });
  });

  document.querySelectorAll("#opciones-n .n-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      numeroPreguntasElegido = parseInt(btn.dataset.n, 10);
      actualizaResumen();
      guardaPreferencias();
    });
  });

  initReportes();
  document.getElementById("btn-empezar").addEventListener("click", empezarTest);
  document.getElementById("btn-siguiente").addEventListener("click", siguientePregunta);
  document.getElementById("btn-anterior").addEventListener("click", anteriorPregunta);
  document.getElementById("btn-salir").addEventListener("click", salirDelExamen);
  document.getElementById("btn-nuevo-test").addEventListener("click", () => mostrarPantalla("inicio"));
  document.getElementById("btn-repetir-falladas").addEventListener("click", repasarFalladas);
  initVisor();

  pintaMaterias();
  actualizaResumen();
}

async function empezarTest() {
  const errorEl = document.getElementById("error-inicio");
  errorEl.textContent = "";
  const seleccion = titulacionesSeleccionadas();
  if (seleccion.length === 0) {
    errorEl.textContent = "Elige al menos una titulación.";
    return;
  }
  const juego = juegoActivo();
  if (!juego && !seleccion.some(t => materiasMarcadas[t].size > 0)) {
    errorEl.textContent = "Marca al menos una materia.";
    return;
  }
  if (!juego && !seleccion.some(t => fuentesActivas(t).length > 0)) {
    errorEl.textContent = "Marca al menos una fuente de exámenes.";
    return;
  }

  const btn = document.getElementById("btn-empezar");
  btn.disabled = true;
  btn.textContent = "Cargando preguntas...";

  try {
    if (juego) {
      await cargaVocabulario();
      cola = construyeColaJuego();
      esExamenOficial = false;
    } else {
      await Promise.all(seleccion.map(cargaTitulacion));
      cola = construyeCola(seleccion);
      esExamenOficial = modo === "oficial";
    }
    if (cola.length === 0) {
      errorEl.textContent = "No hay preguntas disponibles para esa selección.";
      return;
    }
    lanzaQuiz();
  } catch (err) {
    errorEl.textContent = "Error cargando las preguntas: " + err.message;
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Empezar test";
  }
}

function construyeCola(seleccion) {
  if (modo === "oficial") {
    // como el examen: por titulacion y materia, en el orden oficial
    const resultado = [];
    const vistos = new Set();   // el PNB esta dentro del PER: no repetir la misma pregunta
    const temasUsados = new Set();   // en un examen real no salen dos preguntas del mismo tema
    seleccion.forEach(tit => {
      ESTRUCTURA[tit].forEach(([materia, n]) => {
        if (!materiasMarcadas[tit].has(materia)) return;
        const delTema = datosDe(tit).filter(q => q.materia === materia);
        const bloque = MATERIAS_CON_TABLAS[tit] === materia && bloqueDeUnExamen(delTema, n, vistos);
        let elegidas;
        if (bloque) {
          // ejercicios de un mismo examen real: no se filtran por tema
          elegidas = bloque.slice(0, n);
          elegidas.forEach(q => (q.temas || []).forEach(t => temasUsados.add(t)));
        } else {
          elegidas = eligeDiversas(barajar(unicasPorGrupo(delTema, vistos)), n, temasUsados);
        }
        elegidas.forEach(q => vistos.add(grupoDe(q)));
        resultado.push(...elegidas);
      });
    });
    return resultado;
  }
  let pool = [];
  seleccion.forEach(tit => {
    pool = pool.concat(datosDe(tit).filter(q => materiasMarcadas[tit].has(q.materia)));
  });
  pool = barajar(unicasPorGrupo(pool));
  if (numeroPreguntasElegido === 0) return pool;   // todas las disponibles
  return eligeDiversas(pool, Math.min(numeroPreguntasElegido, pool.length), new Set());
}

// ---------- juego de palabras en inglés ----------

function sinTildes(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// significados alternativos de una traduccion («Encallado. Varado» -> encallado, varado)
function significados(es) {
  return sinTildes(es.replace(/\([^)]*\)/g, "")).split(/[.\/]/).map(x => x.trim()).filter(Boolean);
}

// 3 distractores que no sean tambien correctos (que no compartan significado con el termino) y,
// en lo posible, de longitud parecida
function elegirDistractores(t, haciaCastellano) {
  const propios = significados(t.es);
  const texto = o => (haciaCastellano ? o.es : o.en);
  const lon = texto(t).length;
  const candidatos = vocabulario
    .filter(o => o !== t && !significados(o.es).some(s => propios.includes(s)))
    .map(o => ({ o, puntos: Math.abs(texto(o).length - lon) + Math.random() * 8 +
      ((o.tipo === "frase") !== (t.tipo === "frase") ? 200 : 0) }))   // frases con frases, términos con términos
    .sort((a, b) => a.puntos - b.puntos);
  const usados = new Set([texto(t)]);
  const elegidos = [];
  for (const { o } of candidatos) {
    if (usados.has(texto(o))) continue;
    usados.add(texto(o));
    elegidos.push(o);
    if (elegidos.length === 3) break;
  }
  return elegidos;
}

function preguntaDePalabra(t, haciaCastellano) {
  const campo = haciaCastellano ? "es" : "en";
  const barajadas = barajar([t, ...elegirDistractores(t, haciaCastellano)]);
  const opciones = {};
  barajadas.forEach((o, i) => { opciones["abcd"[i]] = o[campo]; });
  let explicacion = `«${t.en}» significa «${t.es}».`;
  if (t.nota) explicacion += `\n\nNota: ${t.nota}`;
  return {
    id: `PAL_${t.id}_${haciaCastellano ? "en-es" : "es-en"}`,
    clave: `pal-${t.id}`,
    juego: true,
    titulacion: "CY",
    materia: MATERIA_JUEGO,
    convocatoria: "Vocabulario",
    examen: t.origen === "examen" ? "de exámenes" : "del libro",
    numero: t.id,
    enunciado: haciaCastellano ? `¿Qué significa «${t.en}»?` : `¿Cómo se dice en inglés «${t.es}»?`,
    opciones,
    respuesta: "abcd"[barajadas.indexOf(t)].toUpperCase(),
    explicacion,
    requiere_anexo: false,
    anexos: [],
    carta_papel: false,
  };
}

// una pregunta por termino, en un sentido u otro al azar
function construyeColaJuego() {
  const terminos = barajar(vocabulario);
  const n = numeroPreguntasElegido === 0 ? terminos.length : Math.min(numeroPreguntasElegido, terminos.length);
  return terminos.slice(0, n).map(t => preguntaDePalabra(t, Math.random() < 0.5));
}

// Elige n preguntas de la lista (ya barajada) sin que dos traten del mismo tema: `temas` son
// numeros de «bigramas» que identifican un tema, y dos preguntas chocan si comparten alguno.
// `usados` acumula los temas ya elegidos (en un examen, entre todas las materias). Si no quedan
// suficientes sin chocar, se completa con las que menos chocan.
function eligeDiversas(candidatas, n, usados) {
  const elegidas = [];
  const aplazadas = [];
  for (const q of candidatas) {
    if (elegidas.length >= n) break;
    if ((q.temas || []).some(t => usados.has(t))) { aplazadas.push(q); continue; }
    elegidas.push(q);
    (q.temas || []).forEach(t => usados.add(t));
  }
  while (elegidas.length < n && aplazadas.length > 0) {
    let mejor = 0;
    let menos = Infinity;
    aplazadas.forEach((q, i) => {
      const choques = (q.temas || []).filter(t => usados.has(t)).length;
      if (choques < menos) { menos = choques; mejor = i; }
    });
    const q = aplazadas.splice(mejor, 1)[0];
    elegidas.push(q);
    (q.temas || []).forEach(t => usados.add(t));
  }
  return elegidas;
}

// n preguntas del mismo examen (convocatoria + examen) entre los que tienen sus tablas
// disponibles, para que el alumno use un unico juego de tablas, como en el examen real
function bloqueDeUnExamen(preguntas, n, vistos) {
  const porExamen = new Map();
  preguntas.filter(q => q.requiere_anexo).forEach(q => {
    const k = `${q.procedencia || DGMM}|${q.convocatoria}|${q.examen}`;
    if (!porExamen.has(k)) porExamen.set(k, []);
    porExamen.get(k).push(q);
  });
  const validos = [];
  porExamen.forEach(qs => {
    const unicas = unicasPorGrupo(qs, vistos);
    if (unicas.length >= n) validos.push(unicas);
  });
  if (validos.length === 0) return null;
  return barajar(validos[Math.floor(Math.random() * validos.length)]);
}

function repasarFalladas() {
  if (falladas.length === 0) return;
  cola = barajar(falladas.map(f => f.pregunta));
  esExamenOficial = false;
  lanzaQuiz();
}

// ---------- pantalla quiz ----------

function lanzaQuiz() {
  indiceActual = 0;
  respuestasDadas = cola.map(() => null);
  recalcula();
  mostrarPantalla("quiz");
  renderPregunta();
}

function mostrarPantalla(nombre) {
  if (nombre !== pantallaActual) pantallaPrevia = pantallaActual;
  pantallaActual = nombre;
  if (nombre === "inicio") actualizaResumenReportes();
  ["inicio", "quiz", "resultado", "reportes"].forEach(p => {
    document.getElementById(`pantalla-${p}`).classList.toggle("oculta", p !== nombre);
  });
  window.scrollTo(0, 0);
}

function renderPregunta() {
  const q = cola[indiceActual];
  const elegida = respuestasDadas[indiceActual];
  const contestadas = respuestasDadas.filter(Boolean).length;

  document.getElementById("contador-pregunta").textContent =
    `Pregunta ${indiceActual + 1} de ${cola.length}`;
  document.getElementById("etiqueta-origen").textContent = etiquetaDe(q);
  document.getElementById("puntuacion-parcial").textContent =
    `Aciertos: ${aciertos}/${contestadas}`;

  document.getElementById("texto-enunciado").textContent = q.enunciado;

  const galeria = document.getElementById("galeria-anexos");
  const detalle = document.getElementById("det-anexos");
  galeria.innerHTML = "";
  detalle.open = false;
  if (q.requiere_anexo && q.anexos && q.anexos.length > 0) {
    detalle.classList.remove("oculta");
    document.getElementById("resumen-anexos").textContent =
      `📎 Tablas de este examen (${q.anexos.length} página${q.anexos.length === 1 ? "" : "s"}): pulsa para verlas`;
    const rutas = q.anexos.map(rel => RUTA_DATOS + rel);
    rutas.forEach((ruta, idx) => {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = ruta;
      img.alt = `Tabla del examen, página ${idx + 1}`;
      img.addEventListener("click", () => abrirVisor(rutas, idx));
      galeria.appendChild(img);
    });
  } else {
    detalle.classList.add("oculta");
  }
  document.getElementById("aviso-carta").classList.toggle("oculta", !q.carta_papel);

  const lista = document.getElementById("lista-opciones");
  lista.innerHTML = "";
  ["a", "b", "c", "d"].forEach(letra => {
    const btn = document.createElement("button");
    btn.className = "opcion-btn";
    btn.innerHTML = `<span class="opcion-letra">${letra.toUpperCase()}</span><span>${escapaHtml(q.opciones[letra])}</span>`;
    btn.addEventListener("click", () => elegirRespuesta(letra));
    lista.appendChild(btn);
  });

  const feedback = document.getElementById("feedback");
  feedback.textContent = "";
  feedback.className = "feedback";
  document.getElementById("explicacion").classList.add("oculta");
  if (elegida) pintaResultadoPregunta(q, elegida);

  pintaPanelReporte(q);

  document.getElementById("btn-anterior").disabled = indiceActual === 0;
  const btnSiguiente = document.getElementById("btn-siguiente");
  btnSiguiente.classList.toggle("oculta", !elegida);
  btnSiguiente.textContent = (indiceActual + 1 < cola.length) ? "Siguiente →" : "Ver resultado";
}

// marca opciones, feedback y explicacion de una pregunta ya contestada
function pintaResultadoPregunta(q, elegida) {
  const correcta = q.respuesta.toLowerCase();
  const esCorrecta = elegida === correcta;
  document.querySelectorAll(".opcion-btn").forEach((btn, idx) => {
    const letraBtn = ["a", "b", "c", "d"][idx];
    btn.disabled = true;
    if (letraBtn === correcta) btn.classList.add("correcta");
    else if (letraBtn === elegida) btn.classList.add("incorrecta");
  });
  const feedback = document.getElementById("feedback");
  if (esCorrecta) {
    feedback.textContent = "✓ Correcto";
    feedback.className = "feedback ok";
  } else {
    feedback.textContent = `✗ Incorrecto. La respuesta correcta es la ${correcta.toUpperCase()}.`;
    feedback.className = "feedback ko";
  }
  muestraExplicacion(q, esCorrecta);
}

function elegirRespuesta(letra) {
  if (respuestasDadas[indiceActual]) return;
  respuestasDadas[indiceActual] = letra;
  recalcula();
  renderPregunta();
}

function siguientePregunta() {
  if (indiceActual + 1 < cola.length) {
    indiceActual++;
    renderPregunta();
  } else {
    mostrarResultado();
  }
}

function anteriorPregunta() {
  if (indiceActual > 0) {
    indiceActual--;
    renderPregunta();
  }
}

function salirDelExamen() {
  const hechas = respuestasDadas.filter(Boolean).length;
  const aviso = hechas > 0
    ? `Vas a salir del examen. Llevas ${hechas} de ${cola.length} contestadas y se perderá el progreso. ¿Salir?`
    : "¿Salir del examen?";
  if (confirm(aviso)) mostrarPantalla("inicio");
}

// ---------- pantalla resultado ----------

// Resultado oficial de una titulacion: global y por materias. Devuelve null si el test no
// contiene el examen completo (todas las materias con todas sus preguntas).
function veredictoTitulacion(tit) {
  let puntos = 0;
  let materiasOk = true;
  const suspensas = [];
  for (const [materia, n, min] of ESTRUCTURA[tit]) {
    const f = porMateria[`${tit}|${materia}`];
    if (!f || f.total !== n) return null;
    puntos += f.ok;
    if (min && f.ok < min) { materiasOk = false; suspensas.push(`${materia} (${f.ok}/${n}, mín. ${min})`); }
  }
  const { min, modo: criterio } = CRITERIO[tit];
  const globalOk = puntos >= min;
  const apto = criterio === "ambos" ? (globalOk && materiasOk) : (globalOk || materiasOk);
  return { tit, puntos, total: totalExamen(tit), min, globalOk, materiasOk, suspensas, criterio, apto };
}

function htmlVeredicto(v) {
  const detalle = [`Total: <strong>${v.puntos} de ${v.total}</strong> (mínimo ${v.min}) ${v.globalOk ? "✓" : "✗"}`];
  const conMinimos = ESTRUCTURA[v.tit].some(m => m[2]);
  if (conMinimos) {
    detalle.push(v.materiasOk ? "Mínimos por materia: todos superados ✓"
      : `Por debajo del mínimo en: ${v.suspensas.map(escapaHtml).join("; ")} ✗`);
  }
  const regla = v.criterio === "ambos"
    ? "Para aprobar hacen falta el total mínimo y los mínimos por materia."
    : "Se aprueba con el total mínimo o con todos los mínimos por materia.";
  return `<div class="veredicto ${v.apto ? "apto" : "no-apto"}"><h3>${v.tit}: ${v.apto ? "APTO" : "NO APTO"}</h3>` +
    detalle.map(d => `<p>${d}</p>`).join("") + `<p><small>${regla}</small></p></div>`;
}

function mostrarResultado() {
  mostrarPantalla("resultado");
  const total = cola.length;
  const pct = total ? Math.round((aciertos / total) * 100) : 0;
  document.getElementById("resumen-resultado").innerHTML =
    `Has acertado <strong>${aciertos} de ${total}</strong> preguntas (<strong>${pct}%</strong>).`;

  const contMaterias = document.getElementById("resultado-materias");
  contMaterias.innerHTML = "";
  const veredictos = esExamenOficial
    ? titulacionesSeleccionadas().map(veredictoTitulacion).filter(Boolean) : [];
  const htmlVeredictos = veredictos.map(htmlVeredicto).join("");
  const filas = Object.values(porMateria);
  if (filas.length > 0) {
    const hayMinimos = filas.some(f => minimoMateria(f.tit, f.materia));
    let html = '<h2>Resultado por materia</h2><table class="tabla-materias"><thead><tr>' +
      "<th>Materia</th><th>Aciertos</th><th>Errores</th>" +
      (hayMinimos ? "<th>Mínimo</th><th>Resultado</th>" : "") + "</tr></thead><tbody>";
    filas.forEach(f => {
      const errores = f.total - f.ok;
      const etiqueta = `${f.tit} · ${escapaHtml(f.materia)}`;
      let celdasMin = "";
      if (hayMinimos) {
        const req = minimoMateria(f.tit, f.materia);
        if (!req) {
          celdasMin = "<td>—</td><td>—</td>";
        } else if (f.total === req.de) {
          const apto = f.ok >= req.min;
          celdasMin = `<td>${req.min} de ${req.de}</td>` +
            `<td class="${apto ? "apto" : "no-apto"}">${apto ? "Apto" : "No apto"}</td>`;
        } else {
          // el minimo solo es comparable si se han contestado las preguntas oficiales de la materia
          celdasMin = `<td>${req.min} de ${req.de}</td><td>—</td>`;
        }
      }
      html += `<tr class="${errores > 0 ? "con-errores" : ""}"><td>${etiqueta}</td>` +
        `<td>${f.ok}/${f.total}</td><td><strong>${errores}</strong></td>${celdasMin}</tr>`;
    });
    contMaterias.innerHTML = htmlVeredictos + html + "</tbody></table>";
  } else {
    contMaterias.innerHTML = htmlVeredictos;
  }

  const lista = document.getElementById("lista-falladas");
  lista.innerHTML = "";
  if (falladas.length > 0) {
    const titulo = document.createElement("h2");
    titulo.textContent = `Preguntas falladas (${falladas.length})`;
    lista.appendChild(titulo);

    falladas.forEach(f => {
      const q = f.pregunta;
      const div = document.createElement("div");
      div.className = "fallada-item";
      div.innerHTML = `
        <div class="meta">${escapaHtml(etiquetaDe(q))}</div>
        <div>${escapaHtml(q.enunciado)}</div>
        <div class="respuestas">
          Tu respuesta: <span class="tu">${f.elegida.toUpperCase()}) ${escapaHtml(q.opciones[f.elegida])}</span><br>
          Correcta: <span class="correcta-txt">${q.respuesta}) ${escapaHtml(q.opciones[q.respuesta.toLowerCase()])}</span>
        </div>` + (explicacionDe(q)
          ? `<div class="expl-fallada">${escapaHtml(explicacionDe(q))}</div>` : "");
      lista.appendChild(div);
    });
  }

  document.getElementById("btn-repetir-falladas").classList.toggle("oculta", falladas.length === 0);
}

// ---------- reporte de errores ----------

const CLAVE_REPORTES = "test-nautica-reportes";

function leeReportes() {
  try {
    const r = JSON.parse(localStorage.getItem(CLAVE_REPORTES));
    return r && typeof r === "object" ? r : {};
  } catch (e) { return {}; }
}

function escribeReportes(r) {
  try {
    localStorage.setItem(CLAVE_REPORTES, JSON.stringify(r));
    return true;
  } catch (e) { return false; }
}

function numReportes() { return Object.keys(leeReportes()).length; }

function textoNumReportes() {
  const n = numReportes();
  return n === 0 ? "No hay reportes guardados." : `${n} reporte${n === 1 ? "" : "s"} guardado${n === 1 ? "" : "s"}.`;
}

function actualizaResumenReportes() {
  const n = numReportes();
  document.getElementById("resumen-reportes").textContent = textoNumReportes();
  const b = document.getElementById("btn-ver-reportes");
  b.disabled = n === 0;
  b.style.opacity = n === 0 ? ".5" : "1";
  document.getElementById("btn-ver-reportes-quiz").textContent = n ? `Ver y copiar reportes (${n})` : "";
}

// rellena el panel con el reporte ya guardado de la pregunta actual (si existe)
function pintaPanelReporte(q) {
  const panel = document.getElementById("panel-reporte");
  panel.classList.toggle("oculta", !modoReporte);
  if (!modoReporte) return;
  const r = leeReportes()[q.id];
  document.getElementById("txt-reporte").value = r ? r.comentario : "";
  panel.querySelectorAll(".tipos-reporte input").forEach(c => {
    c.checked = !!(r && r.tipos.includes(c.value));
  });
  document.getElementById("estado-reporte").textContent = r ? "Reporte guardado ✓" : "";
  actualizaResumenReportes();
}

// guarda (o borra) el reporte de la pregunta actual; se llama en cada cambio
function guardaReporteActual() {
  const q = cola[indiceActual];
  if (!modoReporte || !q) return;
  const comentario = document.getElementById("txt-reporte").value.trim();
  const tipos = Array.from(document.querySelectorAll("#panel-reporte .tipos-reporte input:checked")).map(c => c.value);
  const todos = leeReportes();
  const estado = document.getElementById("estado-reporte");
  if (!comentario && tipos.length === 0) {
    delete todos[q.id];
    estado.textContent = "";
  } else {
    todos[q.id] = {
      id: q.id, clave: q.clave, titulacion: q.titulacion, materia: q.materia,
      convocatoria: q.convocatoria, examen: q.examen, numero: q.numero, procedencia: q.procedencia || DGMM,
      enunciado: q.enunciado, opciones: q.opciones, respuesta: q.respuesta,
      explicacion: explicacionDe(q),
      tipos, comentario, fecha: new Date().toISOString(),
    };
    estado.textContent = "Reporte guardado ✓";
  }
  if (!escribeReportes(todos)) estado.textContent = "No se ha podido guardar (almacenamiento del navegador no disponible)";
  actualizaResumenReportes();
}

function generaInforme() {
  const lista = Object.values(leeReportes()).sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (lista.length === 0) return "";
  const lineas = [`REPORTE DE ERRORES - Test titulaciones náuticas (${lista.length})`, ""];
  lista.forEach((r, i) => {
    lineas.push(`=== ${i + 1}/${lista.length} ===`);
    lineas.push(`ID: ${r.id} | clave: ${r.clave || "-"}`);
    lineas.push(r.materia === MATERIA_JUEGO ? `${r.titulacion} · ${r.materia} (término #${r.numero} del vocabulario)`
      : `${r.titulacion} · ${r.materia} · ${r.procedencia || DGMM} · ${r.convocatoria} ${r.examen} #${r.numero}`);
    lineas.push(`Error en: ${r.tipos.length ? r.tipos.join(", ") : "(sin indicar)"}`);
    lineas.push(`Comentario: ${r.comentario || "(sin comentario)"}`);
    lineas.push("--- Tal como se mostraba ---");
    lineas.push(r.enunciado);
    ["a", "b", "c", "d"].forEach(l => lineas.push(`${l.toUpperCase()}) ${r.opciones[l]}`));
    lineas.push(`Correcta marcada: ${String(r.respuesta).toUpperCase()}`);
    if (r.explicacion) lineas.push(`Explicación: ${r.explicacion}`);
    lineas.push("");
  });
  return lineas.join("\n");
}

function abreReportes() {
  if (pantallaActual === "quiz") guardaReporteActual();
  document.getElementById("info-reportes").textContent = textoNumReportes();
  document.getElementById("txt-informe").value = generaInforme();
  document.getElementById("msg-informe").textContent = "";
  mostrarPantalla("reportes");
}

function copiaInforme() {
  const area = document.getElementById("txt-informe");
  const msg = document.getElementById("msg-informe");
  if (!area.value) { msg.textContent = "No hay nada que copiar."; return; }
  const ok = () => { msg.textContent = "Copiado. Pégalo en el chat."; };
  const respaldo = () => {
    area.focus();
    area.select();
    try { document.execCommand("copy") ? ok() : (msg.textContent = "Selecciona el texto y copia con Ctrl+C."); }
    catch (e) { msg.textContent = "Selecciona el texto y copia con Ctrl+C."; }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(area.value).then(ok, respaldo);
  } else {
    respaldo();
  }
}

function descargaInforme() {
  const texto = document.getElementById("txt-informe").value;
  if (!texto) return;
  const url = URL.createObjectURL(new Blob([texto], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `reportes-errores-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function borraReportes() {
  const n = numReportes();
  if (n === 0) return;
  if (!confirm(`Se borrarán los ${n} reportes guardados en este navegador. ¿Seguro? (Copia antes el texto si aún no lo has enviado.)`)) return;
  escribeReportes({});
  document.getElementById("txt-informe").value = "";
  document.getElementById("info-reportes").textContent = textoNumReportes();
  document.getElementById("msg-informe").textContent = "Reportes borrados.";
  actualizaResumenReportes();
}

function initReportes() {
  const chk = document.getElementById("chk-reporte");
  chk.checked = modoReporte;
  chk.addEventListener("change", () => { modoReporte = chk.checked; guardaPreferencias(); });
  document.getElementById("txt-reporte").addEventListener("input", guardaReporteActual);
  document.querySelectorAll("#panel-reporte .tipos-reporte input").forEach(c => c.addEventListener("change", guardaReporteActual));
  document.getElementById("btn-ver-reportes").addEventListener("click", abreReportes);
  document.getElementById("btn-ver-reportes-quiz").addEventListener("click", abreReportes);
  document.getElementById("btn-copiar-informe").addEventListener("click", copiaInforme);
  document.getElementById("btn-descargar-informe").addEventListener("click", descargaInforme);
  document.getElementById("btn-borrar-reportes").addEventListener("click", borraReportes);
  document.getElementById("btn-volver-reportes").addEventListener("click", () => mostrarPantalla(pantallaPrevia));
  actualizaResumenReportes();
}

// ---------- visor de imagenes ----------

let visorLista = [];
let visorIdx = 0;

function muestraVisor() {
  const visor = document.getElementById("visor-imagen");
  document.getElementById("visor-imagen-img").src = visorLista[visorIdx];
  visor.classList.remove("ampliado");
  visor.scrollTop = 0;
  visor.scrollLeft = 0;
  document.getElementById("visor-pos").textContent = `Página ${visorIdx + 1} de ${visorLista.length}`;
  const varias = visorLista.length > 1;
  document.getElementById("visor-prev").classList.toggle("oculta", !varias);
  document.getElementById("visor-next").classList.toggle("oculta", !varias);
}

function abrirVisor(lista, idx) {
  visorLista = lista;
  visorIdx = idx;
  muestraVisor();
  document.getElementById("visor-imagen").classList.remove("oculta");
}

function cerrarVisor() {
  document.getElementById("visor-imagen").classList.add("oculta");
}

function pasaVisor(delta) {
  visorIdx = (visorIdx + delta + visorLista.length) % visorLista.length;
  muestraVisor();
}

function initVisor() {
  const visor = document.getElementById("visor-imagen");
  // clic en la imagen: alterna entre ajustada al ancho y tamaño real; clic en el fondo: cierra
  visor.addEventListener("click", e => {
    if (e.target.id === "visor-imagen-img") visor.classList.toggle("ampliado");
    else cerrarVisor();
  });
  document.getElementById("visor-cerrar").addEventListener("click", cerrarVisor);
  document.getElementById("visor-prev").addEventListener("click", e => { e.stopPropagation(); pasaVisor(-1); });
  document.getElementById("visor-next").addEventListener("click", e => { e.stopPropagation(); pasaVisor(1); });
  document.addEventListener("keydown", e => {
    if (visor.classList.contains("oculta")) return;
    if (e.key === "Escape") cerrarVisor();
    else if (e.key === "ArrowLeft") pasaVisor(-1);
    else if (e.key === "ArrowRight") pasaVisor(1);
  });
}

document.addEventListener("DOMContentLoaded", initPantallaInicio);
