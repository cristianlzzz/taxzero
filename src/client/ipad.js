// Estación de captura en iPad. Solo escanea el código del huésped y toma las fotos
// de sus documentos; no muestra listas de huéspedes ni datos de otros expedientes.
import { DOCS, FMM_TIPOS } from './catalogos.js';
import { api, esc, mmss } from './util.js';
import { PROBLEMAS, procesarFoto } from './imagen.js';
import { state } from './main.js';
import qrcode from 'qrcode-generator';
import { AVISO_BORRADOR, AVISO_HUESPED, AVISO_VERSION, RUTA_AVISO, avisoHTML } from './aviso.js';

let root;
let fd = { step: 'scan' };
let camara = null; // { stream, raf }
let reloj = null;

const ERRORES = {
  CODIGO_NO_EXISTE: ['No reconocemos este código', 'Revisa que sea el código que generó Front Desk para este huésped.'],
  CODIGO_USADO: ['Este código ya se usó', 'Cada código sirve una sola vez. Pide a Front Desk que genere uno nuevo.'],
  CODIGO_VENCIDO: ['Este código venció', 'Los códigos duran 15 minutos. Pide a Front Desk que genere uno nuevo.'],
  CODIGO_SIN_CAPTURA: ['Este expediente ya no está en captura', 'Sus documentos ya se enviaron. Si falta algo, Grupos pedirá una recaptura.'],
  AVISO_PENDIENTE: ['Falta el aviso de privacidad', 'El huésped debe aceptar el aviso antes de las fotos. Escanea el código de nuevo.'],
  CAPTURA_CERRADA: ['La captura ya se cerró', 'El código venció y lo capturado se guardó. Pide a Front Desk un código nuevo para completar.'],
};

export function montar(el) {
  root = el;
  pintar();
}

export function detener() {
  pararCamara();
  clearInterval(reloj);
  reloj = null;
}

function pintar() {
  if (!root) return;
  const quien = state.perfil ? esc(state.perfil.nombre) : '';
  root.innerHTML = `<div class="station">
    <div class="station-bar"><span class="brand">Taxzero · <span class="muted">${quien}</span></span>
      ${fd.step === 'scan' ? '<button class="linkbtn" data-a="salir">Cerrar sesión</button>' : ''}</div>
    ${cuerpo()}
  </div>`;
  if (fd.step === 'scan') iniciarCamara();
  else pararCamara();
  if (['aviso', 'capture', 'summary'].includes(fd.step)) iniciarReloj();
}

// ------------------------------------------------------------------ pantallas
function cuerpo() {
  if (fd.step === 'scan') {
    return `<div class="fd-top"><div><p class="eyebrow">Estación de captura</p><h1>Escanea el QR del huésped</h1>
        <p class="muted">Front Desk genera el código desde su PC. Sirve una sola vez y vence a los 15 minutos.</p></div></div>
      <div class="vf" id="vf"><video id="cam" playsinline muted autoplay></video><span class="tag">Cámara</span>
        <div class="guide qr-target"><span></span><span></span><span></span><span></span></div><div class="scan"></div>
        <p class="hint" id="cam-hint">Acerca el código al centro del recuadro</p></div>
      <form class="manual" data-form="codigo"><label class="flabel" for="cod">¿No lee el QR? Escribe el código:</label>
        <input id="cod" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="TZ-XXXX-XXXX" maxlength="12">
        <button class="btn" type="submit">Continuar</button></form>
      ${fd.cargando ? '<p class="progress-note"><span class="spinner"></span>Abriendo la captura…</p>' : ''}`;
  }
  if (fd.step === 'error') {
    return `<div class="stack center" id="st-error">
      <div class="big-ok warn-ic"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="9"/></svg></div>
      <h1>${esc(fd.errT)}</h1><p class="muted">${esc(fd.errM)}</p><div><button class="btn lg" data-a="fdreset">Escanear otro código</button></div></div>`;
  }
  if (fd.step === 'aviso') return pantallaAviso();
  if (fd.step === 'capture') return pantallaCaptura();
  if (fd.step === 'summary') return pantallaResumen();
  if (fd.step === 'done') {
    return `<div class="stack center">
      <div class="big-ok"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
      <h1>${esc(fd.doneT)}</h1><p class="muted">${esc(fd.doneM)}</p><div><button class="btn primary lg" data-a="fdreset">Escanear al siguiente huésped</button></div></div>`;
  }
  return '';
}

// El huésped lee y acepta el aviso de privacidad antes de cualquier foto.
function qrAviso() {
  const q = qrcode(0, 'M');
  q.addData(`${location.origin}/${RUTA_AVISO}`);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 1, scalable: true, alt: 'QR del aviso de privacidad completo' });
}

function pantallaAviso() {
  const c = fd.c;
  const bloque = (l) => `<div class="card flat" lang="${l}"><h2>${esc(AVISO_HUESPED[l].titulo)}</h2><p>${avisoHTML(AVISO_HUESPED[l].texto, esc)}</p></div>`;
  return `<div class="fd-top"><div><p class="eyebrow">${esc(c.grupo)}</p><h1>${esc(c.nombre)} ${esc(c.apellidos)}</h1></div>${timerHTML()}</div>
    <div class="aviso-huesped" id="aviso-huesped">
      <p class="muted">Muestre esta pantalla al huésped. / Please read before we continue.</p>
      ${AVISO_BORRADOR ? '<p class="notice"><b>Borrador pendiente de validación del área legal.</b></p>' : ''}
      ${bloque('es')}${bloque('en')}
      <div class="qr-aviso">${qrAviso()}<p class="muted small">Aviso de privacidad completo: escanee con su teléfono.<br>Full privacy notice: scan with your phone.</p></div>
      ${fd.errAviso ? `<div class="notice">${esc(fd.errAviso)}</div>` : ''}
      <div class="fd-actions">
        <button class="btn lg" data-a="aviso-no" ${fd.guardandoAviso ? 'disabled' : ''}>No acepto / I do not accept</button>
        <button class="btn primary lg" data-a="aviso-si" ${fd.guardandoAviso ? 'disabled' : ''}>${fd.guardandoAviso ? 'Guardando…' : 'Acepto / I accept'}</button>
      </div>
    </div>`;
}

async function respuestaAviso(acepta) {
  if (fd.guardandoAviso) return;
  fd.guardandoAviso = true;
  fd.errAviso = null;
  pintar();
  try {
    await api('POST', `/api/captura/${fd.c.codigo}/aviso`, { acepta, version: AVISO_VERSION });
    fd.guardandoAviso = false;
    if (acepta) {
      fd.step = 'capture';
      pintar();
      return;
    }
    const nombre = `${fd.c.nombre} ${fd.c.apellidos}`;
    await api('POST', `/api/captura/${fd.c.codigo}/finalizar`).catch(() => undefined);
    liberarTodo();
    fd = {
      step: 'done',
      doneT: 'El huésped no aceptó el aviso de privacidad',
      doneM: `No se tomó ninguna foto de ${nombre}. Quedó anotado en su expediente. Si cambia de opinión, Front Desk puede generar otro QR.`,
    };
    pintar();
  } catch (e) {
    fd.guardandoAviso = false;
    if (e.status === 401) return;
    if (ERRORES[e.message]) return terminarPorVencimiento();
    fd.errAviso = `No se guardó la respuesta: ${e.message}`;
    pintar();
  }
}

function timerHTML() {
  const l = new Date(fd.c.vence_en).getTime() - Date.now();
  return `<span class="timer ${l < 180000 ? 'low' : ''}" data-timer>Código válido ${mmss(l)}</span>`;
}

function pantallaCaptura() {
  const c = fd.c;
  const t = c.pasos[fd.idx];
  const D = DOCS[t];
  const stepper = `<div class="steps">${c.pasos.map((s, i) => `<div class="step ${i === fd.idx ? 'on' : ''} ${fd.shots[s] ? 'ok' : ''} ${fd.skipped[s] ? 'skip' : ''}">${fd.shots[s] ? '✓ ' : ''}${DOCS[s].label}</div>`).join('')}</div>`;
  let stage;
  if (fd.procesando) {
    stage = `<div class="shoot-cta"><span class="spinner"></span><p>Preparando la foto…</p></div>`;
  } else if (!fd.cur) {
    const tipos = t === 'fmm'
      ? `<div class="seg" role="tablist" aria-label="Tipo de documento">${Object.entries(FMM_TIPOS).map(([k, l]) => `<button class="tab" role="tab" data-a="fmmtipo" data-k="${k}" aria-selected="${fd.fmmTipo === k}">${l}</button>`).join('')}</div>`
      : '';
    stage = `${tipos}<div class="shoot-cta"><p><b>${D.label}.</b> ${D.hint}</p>
        <p class="muted">Apoya el documento sobre una superficie plana, con buena luz y sin reflejos.</p>
        <label class="btn primary lg" for="foto">Tomar foto</label>
        <input id="foto" class="file-hidden" type="file" accept="image/*" capture="environment"></div>
      ${fd.errFoto ? `<div class="notice">${esc(fd.errFoto)}</div>` : ''}
      <div class="fd-actions"><button class="btn sm" data-a="skip">${esOpcional(t) ? 'Aún no lo tiene' : 'El huésped no lo trae'}</button><span></span></div>`;
  } else {
    stage = vistaPrevia(D);
  }
  return `<div class="fd-top"><div><p class="eyebrow">${esc(c.grupo)}</p><h1>${esc(c.nombre)} ${esc(c.apellidos)}</h1></div>${timerHTML()}</div>
    ${stepper}<h2>Paso ${fd.idx + 1} de ${c.pasos.length}: ${D.label}${esOpcional(t) ? ' <span class="muted">(opcional)</span>' : ''}</h2>${stage}`;
}

const esOpcional = (t) => (fd.c?.opcionales || []).includes(t);

// Motivos rápidos para guardar una foto con aviso de calidad (el último pide escribirlo).
const MOTIVOS = [
  'El documento original está así (dañado, plastificado o desgastado)',
  'Ya se repitió varias veces y no mejora',
  'El huésped no puede esperar',
  'Otro motivo',
];

// Vista previa de la foto. Si la revisión encontró problemas, se avisa antes de guardar:
// se recomienda repetirla, pero se puede guardar de todos modos indicando el motivo.
function vistaPrevia(D) {
  const cur = fd.cur;
  const subiendo = fd.subiendo;
  const problemas = cur.problemas || [];
  // Con aviso la foto se achica para que el aviso y los botones quepan sin desplazarse.
  const img = `<div class="preview ${problemas.length ? (fd.pedirMotivo ? 'con-motivo' : 'con-aviso') : ''}"><img src="${cur.url}" alt="Vista previa: ${D.label}"></div>`;
  const err = fd.errSubir ? `<div class="notice">${esc(fd.errSubir)}</div>` : '';
  const repetir = (primario, texto) => `<label class="btn ${primario ? 'primary' : ''} lg ${subiendo ? 'is-disabled' : ''}" for="foto">${texto}</label>
        <input id="foto" class="file-hidden" type="file" accept="image/*" capture="environment" ${subiendo ? 'disabled' : ''}>`;
  if (!problemas.length) {
    return `${img}<p class="muted center">Revisa que se lea todo el documento y que no esté cortado.</p>${err}
      <div class="fd-actions">${repetir(false, 'Repetir')}
        <button class="btn primary lg" data-a="usar" ${subiendo ? 'disabled' : ''}>${subiendo ? 'Guardando…' : 'Usar esta foto'}</button></div>`;
  }
  const lista = problemas.map((p) => `<li><b>${PROBLEMAS[p][0]}.</b> ${PROBLEMAS[p][1]}</li>`).join('');
  const aviso = `<div class="notice calidad" id="aviso-calidad" role="alert"><b>Revisa esta foto antes de guardarla</b>
      <ul>${lista}</ul>Si no se lee bien, Grupos tendrá que pedirle el documento otra vez al huésped.</div>`;
  if (!fd.pedirMotivo) {
    return `${img}${aviso}${err}
      <div class="fd-actions">
        <button class="btn lg" data-a="motivo-calidad" ${subiendo ? 'disabled' : ''}>Guardar de todos modos</button>
        ${repetir(true, 'Repetir foto')}</div>`;
  }
  const otro = fd.motivoSel === MOTIVOS.length - 1;
  const listo = fd.motivoSel != null && (!otro || (fd.motivoTxt || '').trim());
  return `${img}${aviso}
    <fieldset class="motivo-calidad" id="motivo-calidad"><legend>¿Por qué se guarda así? Quedará anotado en la bitácora.</legend>
      ${MOTIVOS.map((m, i) => `<label class="opt"><input type="radio" name="motivo-cal" value="${i}" ${fd.motivoSel === i ? 'checked' : ''}> ${esc(m)}</label>`).join('')}
      ${otro ? `<input id="motivo-txt" maxlength="200" placeholder="Escribe el motivo" value="${esc(fd.motivoTxt || '')}" autocomplete="off">` : ''}
    </fieldset>${err}
    <div class="fd-actions">
      <button class="btn lg" data-a="motivo-volver" ${subiendo ? 'disabled' : ''}>Volver</button>
      <button class="btn primary lg" data-a="usar" ${subiendo || !listo ? 'disabled' : ''}>${subiendo ? 'Guardando…' : 'Guardar con aviso'}</button></div>`;
}

function motivoCalidad() {
  if (!fd.cur?.problemas?.length) return '';
  const otro = fd.motivoSel === MOTIVOS.length - 1;
  return otro ? `Otro motivo: ${(fd.motivoTxt || '').trim()}` : MOTIVOS[fd.motivoSel] || '';
}

function limpiarMotivo() {
  fd.pedirMotivo = false;
  fd.motivoSel = null;
  fd.motivoTxt = '';
}

function pantallaResumen() {
  const c = fd.c;
  const faltan = c.pasos.filter((s) => !fd.shots[s] && !esOpcional(s));
  return `<div class="fd-top"><div><p class="eyebrow">Revisión antes de enviar</p><h1>${esc(c.nombre)} ${esc(c.apellidos)}</h1></div>${timerHTML()}</div>
    <div class="sumgrid">${c.pasos.map((s, i) => `<div class="sum">${fd.shots[s] ? `<img src="${fd.shots[s].url}" alt="${DOCS[s].label}">` : `<div class="missing">${esOpcional(s) ? 'Opcional, sin foto' : 'No lo trajo'}</div>`}<b>${DOCS[s].label}</b>${fd.shots[s]?.problemas?.length ? '<span class="cal-tag">Guardada con aviso</span>' : ''}<button class="btn sm" data-a="redo" data-i="${i}" ${fd.enviando ? 'disabled' : ''}>${fd.shots[s] ? 'Repetir' : 'Tomar'}</button></div>`).join('')}</div>
    ${faltan.length ? `<div class="notice">Faltan: ${faltan.map((s) => DOCS[s].label.toLowerCase()).join(', ')}. El expediente quedará como <b>Captura incompleta</b> y Front Desk tendrá que generar otro QR para completarlo.</div>` : ''}
    ${fd.errEnviar ? `<div class="notice">${esc(fd.errEnviar)}</div>` : ''}
    <div class="fd-actions"><span class="muted">Al enviar, la captura pasa a Grupos. Las fotos ya quedaron guardadas.</span>
      <button class="btn primary lg" data-a="send" ${fd.enviando ? 'disabled' : ''}>${fd.enviando ? 'Enviando…' : faltan.length ? 'Guardar como incompleta' : 'Enviar a Grupos'}</button></div>`;
}

// ------------------------------------------------------------------ cámara para el QR
async function iniciarCamara() {
  if (camara || fd.cargando) return;
  const video = document.getElementById('cam');
  const hint = document.getElementById('cam-hint');
  if (!navigator.mediaDevices?.getUserMedia) {
    if (hint) hint.textContent = 'Este navegador no permite usar la cámara. Escribe el código abajo.';
    return;
  }
  camara = { stream: null, raf: 0, activo: true };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
    if (!camara?.activo) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    camara.stream = stream;
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    // El lector de QR se descarga solo en la estación de captura.
    const { default: jsQR } = await import('jsqr');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let ultimo = 0;
    const leer = (ts) => {
      if (!camara?.activo) return;
      camara.raf = requestAnimationFrame(leer);
      if (ts - ultimo < 180 || video.readyState < 2) return;
      ultimo = ts;
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return;
      const s = Math.min(1, 720 / Math.max(w, h));
      canvas.width = Math.round(w * s);
      canvas.height = Math.round(h * s);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      const cod = r?.data?.trim().toUpperCase();
      if (cod && /^TZ-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(cod)) {
        pararCamara();
        abrirCaptura(cod);
      }
    };
    camara.raf = requestAnimationFrame(leer);
  } catch {
    camara = null;
    if (hint) hint.textContent = 'No se pudo abrir la cámara. Permite el acceso en Ajustes o escribe el código abajo.';
  }
}

function pararCamara() {
  if (!camara) return;
  camara.activo = false;
  cancelAnimationFrame(camara.raf);
  camara.stream?.getTracks().forEach((t) => t.stop());
  camara = null;
}

// ------------------------------------------------------------------ flujo de captura
async function abrirCaptura(codigo) {
  fd = { step: 'scan', cargando: true };
  pintar();
  try {
    const { captura } = await api('POST', '/api/captura/iniciar', { codigo });
    // Los pasos opcionales (gafete o constancia) van al final y no cuentan como faltantes.
    const opcionales = (captura.opcionales || []).filter((t) => DOCS[t]);
    fd = {
      step: 'aviso', c: { ...captura, pasos: [...captura.pasos, ...opcionales], opcionales }, idx: 0, shots: {}, skipped: {}, cur: null, fmmTipo: 'fmm',
    };
  } catch (e) {
    if (e.status === 401) return;
    const [t, m] = ERRORES[e.message] || ['No se pudo abrir la captura', e.message];
    fd = { step: 'error', errT: t, errM: m };
  }
  pintar();
}

async function fotoElegida(input) {
  const file = input.files?.[0];
  if (!file) return;
  fd.procesando = true;
  fd.errFoto = null;
  fd.errSubir = null;
  liberar(fd.cur);
  fd.cur = null;
  limpiarMotivo();
  pintar();
  try {
    fd.cur = await procesarFoto(file);
  } catch {
    fd.errFoto = 'No se pudo leer la foto. Vuelve a tomarla.';
  }
  fd.procesando = false;
  pintar();
}

async function usarFoto() {
  const t = fd.c.pasos[fd.idx];
  const cur = fd.cur;
  const problemas = cur.problemas || [];
  const motivo = motivoCalidad();
  if (problemas.length && !motivo) {
    fd.pedirMotivo = true;
    pintar();
    return;
  }
  fd.subiendo = true;
  fd.errSubir = null;
  pintar();
  try {
    const q = new URLSearchParams({
      exp: fd.c.expediente_id, tipo: t, ancho: cur.ancho, alto: cur.alto, nitidez: cur.nitidez,
      ...(t === 'fmm' ? { fmm: fd.fmmTipo } : {}),
      ...(problemas.length ? { calidad: problemas.join(','), motivo } : {}),
    });
    await api('POST', `/api/captura/${fd.c.codigo}/foto?${q}`, cur.blob);
    liberar(fd.shots[t]);
    fd.shots[t] = cur;
    delete fd.skipped[t];
    fd.cur = null;
    fd.subiendo = false;
    limpiarMotivo();
    avanzar();
  } catch (e) {
    fd.subiendo = false;
    if (e.status === 401) return;
    if (ERRORES[e.message]) return terminarPorVencimiento();
    fd.errSubir = `No se guardó la foto: ${e.message}`;
    pintar();
  }
}

function avanzar() {
  if (fd.volverResumen || fd.idx + 1 >= fd.c.pasos.length) {
    fd.volverResumen = false;
    fd.step = 'summary';
  } else {
    fd.idx++;
  }
  pintar();
}

async function enviar(porVencimiento = false) {
  if (fd.enviando) return;
  fd.enviando = true;
  fd.errEnviar = null;
  if (!porVencimiento) pintar();
  try {
    const r = await api('POST', `/api/captura/${fd.c.codigo}/finalizar`);
    terminar(r, porVencimiento);
  } catch (e) {
    fd.enviando = false;
    if (e.status === 401) return;
    fd.errEnviar = `No se pudo enviar: ${e.message}`;
    if (fd.step !== 'summary') fd.step = 'summary';
    pintar();
  }
}

function terminar(r, porVencimiento) {
  const nombre = `${fd.c.nombre} ${fd.c.apellidos}`;
  const faltan = (r?.faltan || []).map((t) => DOCS[t].label.toLowerCase()).join(', ');
  liberarTodo();
  if (r?.estado === 'incompleta') {
    fd = {
      step: 'done',
      doneT: porVencimiento ? 'El código venció: captura guardada como incompleta' : 'Captura guardada como incompleta',
      doneM: `Faltó: ${faltan}. Front Desk puede generar otro QR para completarlo.`,
    };
  } else {
    fd = { step: 'done', doneT: 'Expediente enviado a Grupos', doneM: `${nombre} ya está en la bandeja de Grupos para revisión.` };
  }
  pintar();
}

function terminarPorVencimiento() {
  clearInterval(reloj);
  reloj = null;
  enviar(true);
}

function iniciarReloj() {
  if (reloj) return;
  reloj = setInterval(() => {
    if (!['aviso', 'capture', 'summary'].includes(fd.step)) {
      clearInterval(reloj);
      reloj = null;
      return;
    }
    const l = new Date(fd.c.vence_en).getTime() - Date.now();
    const el = document.querySelector('[data-timer]');
    if (el) {
      el.textContent = `Código válido ${mmss(l)}`;
      el.classList.toggle('low', l < 180000);
    }
    // Si se está subiendo una foto, se espera a que termine (hay un minuto de gracia).
    if (l <= 0 && !fd.subiendo) terminarPorVencimiento();
  }, 1000);
}

function liberar(f) {
  if (f?.url) URL.revokeObjectURL(f.url);
}
function liberarTodo() {
  liberar(fd.cur);
  Object.values(fd.shots || {}).forEach(liberar);
}

// ------------------------------------------------------------------ eventos
document.addEventListener('click', (ev) => {
  if (state.perfil?.rol !== 'ipad') return;
  const el = ev.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const d = el.dataset;
  switch (d.a) {
    case 'fdreset':
      liberarTodo();
      fd = { step: 'scan' };
      pintar();
      break;
    case 'fmmtipo':
      fd.fmmTipo = d.k;
      pintar();
      break;
    case 'skip': {
      const t = fd.c.pasos[fd.idx];
      fd.skipped[t] = true;
      liberar(fd.shots[t]);
      delete fd.shots[t];
      liberar(fd.cur);
      fd.cur = null;
      limpiarMotivo();
      avanzar();
      break;
    }
    case 'usar':
      usarFoto();
      break;
    case 'motivo-calidad':
      fd.pedirMotivo = true;
      pintar();
      break;
    case 'motivo-volver':
      limpiarMotivo();
      pintar();
      break;
    case 'aviso-si':
      respuestaAviso(true);
      break;
    case 'aviso-no':
      respuestaAviso(false);
      break;
    case 'redo':
      fd.idx = +d.i;
      fd.step = 'capture';
      fd.cur = null;
      limpiarMotivo();
      fd.volverResumen = true;
      pintar();
      break;
    case 'send':
      enviar(false);
      break;
  }
});

document.addEventListener('change', (ev) => {
  if (state.perfil?.rol !== 'ipad') return;
  if (ev.target.id === 'foto') fotoElegida(ev.target);
  if (ev.target.name === 'motivo-cal') {
    fd.motivoSel = +ev.target.value;
    pintar();
    if (fd.motivoSel === MOTIVOS.length - 1) document.getElementById('motivo-txt')?.focus();
  }
});

// El botón "Guardar con aviso" se habilita en cuanto se escribe el motivo, sin repintar
// (repintar quitaría el teclado del iPad).
document.addEventListener('input', (ev) => {
  if (state.perfil?.rol !== 'ipad' || ev.target.id !== 'motivo-txt') return;
  fd.motivoTxt = ev.target.value;
  const b = document.querySelector('#motivo-calidad ~ .fd-actions [data-a="usar"]');
  if (b && !fd.subiendo) b.disabled = !fd.motivoTxt.trim();
});

document.addEventListener('submit', (ev) => {
  if (state.perfil?.rol !== 'ipad') return;
  const f = ev.target.closest('[data-form="codigo"]');
  if (!f) return;
  ev.preventDefault();
  let v = f.querySelector('#cod').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (v.startsWith('TZ')) v = v.slice(2);
  if (v.length !== 8) {
    fd = { step: 'error', ...{ errT: ERRORES.CODIGO_NO_EXISTE[0], errM: 'El código tiene el formato TZ-XXXX-XXXX.' } };
    pintar();
    return;
  }
  pararCamara();
  abrirCaptura(`TZ-${v.slice(0, 4)}-${v.slice(4)}`);
});

document.addEventListener('visibilitychange', () => {
  if (state.perfil?.rol !== 'ipad') return;
  if (document.hidden) pararCamara();
  else if (fd.step === 'scan') iniciarCamara();
});
