"use strict";

const TITULACIONES = ["PNB", "PER", "PY", "CY"];
const RUTA_DATOS = window.RUTA_DATOS || "../salida/";

// Materias de cada titulacion (en el orden del examen) y nº de preguntas de
// cada una en el examen oficial.
const ESTRUCTURA = {
  PNB: [["Nomenclatura náutica", 4], ["Elementos de amarre y fondeo", 2], ["Seguridad", 4],
        ["Legislación", 2], ["Balizamiento", 5], ["Reglamento (RIPA)", 10]],
  PER: [["Nomenclatura náutica", 4], ["Elementos de amarre y fondeo", 2], ["Seguridad", 4],
        ["Legislación", 2], ["Balizamiento", 5], ["Reglamento (RIPA)", 10],
        ["Maniobra y navegación", 2], ["Emergencias en la mar", 3], ["Meteorología", 4],
        ["Teoría de la navegación", 5], ["Carta de navegación", 4]],
  PY:  [["Seguridad en la mar", 10], ["Meteorología", 10], ["Teoría de navegación", 10],
        ["Navegación carta", 10]],
  CY:  [["Teoría de navegación", 10, 5], ["Cálculo de navegación", 10, 6], ["Meteorología", 10, 5],
        ["Inglés", 10, 5]],
};
// Tercer valor opcional = minimo de aciertos para aprobar la materia (sobre las
// preguntas oficiales). Solo se conoce para CY; en el resto no se marca apto/no apto.

function minimoMateria(tit, materia) {
  const fila = ESTRUCTURA[tit].find(m => m[0] === materia);
  return fila && fila.length > 2 ? { min: fila[2], de: fila[1] } : null;
}

const datosPorTitulacion = {};
const cargaEnCurso = {};
let explicaciones = {};   // clave de pregunta -> texto (se rellena por tandas; puede estar incompleto)

function cargaExplicaciones() {
  fetch(`${RUTA_DATOS}explicaciones.json`)
    .then(r => (r.ok ? r.json() : {}))
    .then(data => { explicaciones = data || {}; })
    .catch(() => { explicaciones = {}; });
}

function muestraExplicacion(q, esCorrecta) {
  const caja = document.getElementById("explicacion");
  caja.innerHTML = "";
  const texto = q.clave && explicaciones[q.clave];
  if (!texto) {
    caja.classList.add("oculta");
    return;
  }
  const titulo = document.createElement("strong");
  titulo.textContent = esCorrecta ? "¿Por qué es correcta?"
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

let modo = "total";               // "total" | "oficial"
let numeroPreguntasElegido = 30;
let cola = [];
let indiceActual = 0;
let respuestasDadas = [];         // letra elegida por pregunta (null = sin contestar)
let aciertos = 0;
let falladas = [];
let porMateria = {};              // "TIT|materia" -> {tit, materia, ok, total}
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

async function cargaTitulacion(tit) {
  if (datosPorTitulacion[tit]) return datosPorTitulacion[tit];
  if (cargaEnCurso[tit]) return cargaEnCurso[tit];
  cargaEnCurso[tit] = fetch(`${RUTA_DATOS}${tit}/${tit}_todas.json`)
    .then(r => {
      if (!r.ok) throw new Error(`No se pudo cargar ${tit} (HTTP ${r.status})`);
      return r.json();
    })
    .then(data => {
      // las preguntas anuladas no tienen una respuesta correcta valida
      const usable = data.filter(q => q.estado !== "anulada" && q.respuesta);
      datosPorTitulacion[tit] = usable;
      return usable;
    });
  return cargaEnCurso[tit];
}

function guardaPreferencias() {
  try {
    localStorage.setItem("test-nautica-prefs", JSON.stringify({
      tits: titulacionesSeleccionadas(),
      materias: Object.fromEntries(TITULACIONES.map(t => [t, Array.from(materiasMarcadas[t])])),
      modo, n: numeroPreguntasElegido, reporte: modoReporte,
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
  } catch (e) { /* preferencias corruptas: se ignoran */ }
}

// ---------- pantalla inicio ----------

function titulacionesSeleccionadas() {
  return Array.from(document.querySelectorAll("#opciones-titulacion input:checked")).map(i => i.value);
}

function actualizaContadorTarjeta(tit, n) {
  const el = document.querySelector(`.n-preguntas[data-tit="${tit}"]`);
  if (el) el.textContent = `${n} preguntas`;
}

function contarEnBanco(tit, materia) {
  const datos = datosPorTitulacion[tit];
  if (!datos) return null;
  return datos.filter(q => q.materia === materia).length;
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
        if (input.checked) materiasMarcadas[tit].add(materia);
        else materiasMarcadas[tit].delete(materia);
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
    cont.appendChild(grupo);
  });

  cont.querySelectorAll(".link").forEach(btn => {
    btn.addEventListener("click", () => {
      const tit = btn.dataset.tit;
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
  document.getElementById("opciones-n").classList.toggle("oculta", modo === "oficial");
  document.querySelectorAll("#opciones-modo .n-btn").forEach(b =>
    b.classList.toggle("n-btn-activo", b.dataset.modo === modo));
  document.querySelectorAll("#opciones-n .n-btn").forEach(b =>
    b.classList.toggle("n-btn-activo", parseInt(b.dataset.n, 10) === numeroPreguntasElegido));
  if (modo === "oficial") {
    el.textContent = `Saldrán ${totalOficialSeleccion()} preguntas, repartidas por materia como en el examen oficial.`;
  } else {
    el.textContent = "";
  }
}

function initPantallaInicio() {
  cargaPreferencias();
  cargaExplicaciones();

  TITULACIONES.forEach(tit => {
    cargaTitulacion(tit)
      .then(data => {
        actualizaContadorTarjeta(tit, data.length);
        pintaMaterias(); // refresca los contadores "en el banco"
      })
      .catch(err => {
        const el = document.querySelector(`.n-preguntas[data-tit="${tit}"]`);
        if (el) el.textContent = "error al cargar";
        console.error(err);
      });
  });

  document.querySelectorAll("#opciones-titulacion input").forEach(i => {
    i.addEventListener("change", () => {
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
  document.getElementById("visor-imagen").addEventListener("click", cerrarVisor);
  document.getElementById("visor-cerrar").addEventListener("click", cerrarVisor);

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
  if (!seleccion.some(t => materiasMarcadas[t].size > 0)) {
    errorEl.textContent = "Marca al menos una materia.";
    return;
  }

  const btn = document.getElementById("btn-empezar");
  btn.disabled = true;
  btn.textContent = "Cargando preguntas...";

  try {
    await Promise.all(seleccion.map(cargaTitulacion));
    cola = construyeCola(seleccion);
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
    seleccion.forEach(tit => {
      ESTRUCTURA[tit].forEach(([materia, n]) => {
        if (!materiasMarcadas[tit].has(materia)) return;
        const pool = barajar(datosPorTitulacion[tit].filter(q => q.materia === materia));
        resultado.push(...pool.slice(0, n));
      });
    });
    return resultado;
  }
  let pool = [];
  seleccion.forEach(tit => {
    pool = pool.concat(datosPorTitulacion[tit].filter(q => materiasMarcadas[tit].has(q.materia)));
  });
  pool = barajar(pool);
  const n = numeroPreguntasElegido === 0 ? pool.length : Math.min(numeroPreguntasElegido, pool.length);
  return pool.slice(0, n);
}

function repasarFalladas() {
  if (falladas.length === 0) return;
  cola = barajar(falladas.map(f => f.pregunta));
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
  document.getElementById("etiqueta-origen").textContent =
    `${q.titulacion} · ${q.materia} · ${q.convocatoria} ${q.examen} #${q.numero}`;
  document.getElementById("puntuacion-parcial").textContent =
    `Aciertos: ${aciertos}/${contestadas}`;

  document.getElementById("texto-enunciado").textContent = q.enunciado;

  const galeria = document.getElementById("galeria-anexos");
  galeria.innerHTML = "";
  if (q.requiere_anexo && q.anexos && q.anexos.length > 0) {
    galeria.classList.remove("oculta");
    q.anexos.forEach(rel => {
      const img = document.createElement("img");
      img.src = RUTA_DATOS + rel;
      img.alt = "Anexo del examen";
      img.addEventListener("click", () => abrirVisor(img.src));
      galeria.appendChild(img);
    });
  } else {
    galeria.classList.add("oculta");
  }

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

function mostrarResultado() {
  mostrarPantalla("resultado");
  const total = cola.length;
  const pct = total ? Math.round((aciertos / total) * 100) : 0;
  document.getElementById("resumen-resultado").innerHTML =
    `Has acertado <strong>${aciertos} de ${total}</strong> preguntas (<strong>${pct}%</strong>).`;

  const contMaterias = document.getElementById("resultado-materias");
  contMaterias.innerHTML = "";
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
    contMaterias.innerHTML = html + "</tbody></table>";
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
        <div class="meta">${q.titulacion} · ${escapaHtml(q.materia)} · ${q.convocatoria} ${q.examen} #${q.numero}</div>
        <div>${escapaHtml(q.enunciado)}</div>
        <div class="respuestas">
          Tu respuesta: <span class="tu">${f.elegida.toUpperCase()}) ${escapaHtml(q.opciones[f.elegida])}</span><br>
          Correcta: <span class="correcta-txt">${q.respuesta}) ${escapaHtml(q.opciones[q.respuesta.toLowerCase()])}</span>
        </div>` + (q.clave && explicaciones[q.clave]
          ? `<div class="expl-fallada">${escapaHtml(explicaciones[q.clave])}</div>` : "");
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
      convocatoria: q.convocatoria, examen: q.examen, numero: q.numero,
      enunciado: q.enunciado, opciones: q.opciones, respuesta: q.respuesta,
      explicacion: (q.clave && explicaciones[q.clave]) || "",
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
    lineas.push(`${r.titulacion} · ${r.materia} · ${r.convocatoria} ${r.examen} #${r.numero}`);
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

function abrirVisor(src) {
  document.getElementById("visor-imagen-img").src = src;
  document.getElementById("visor-imagen").classList.remove("oculta");
}
function cerrarVisor() {
  document.getElementById("visor-imagen").classList.add("oculta");
}

document.addEventListener("DOMContentLoaded", initPantallaInicio);
