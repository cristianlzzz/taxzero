// Pantallas de escritorio (PC): Grupos, Front Desk, Crédito, Impuestos y Administración.
import qrcode from 'qrcode-generator';
import {
  CHECKS, CHECK_GRUPO, ROLES, DOCS, DOCS_CREDITO, DOCS_GRUPO, DOC_ORDER, ESTADOS, FILE_ORDER, FMM_TIPOS, MOTIVOS, PAISES, PAISES_FREC, QUEUE, QUEUE_WORD,
  RIESGOS, TIPOS_EVENTO,
} from './catalogos.js';
import { api, dateTxt, diasEntre, esc, fmt, folioExp, folioGrupo, hoyHotel, mmss } from './util.js';
import { PIE, header, state, toast } from './main.js';
import * as importar from './importar.js';
import { abrirDescarga } from './paquete.js';

let root;
let vista = null; // { ruta, datos, error }
let carga = 0;
const ui = { filtro: {}, ver: {}, checks: {}, tablero: null, buscar: '', anio: '', impSolo: '' };

const rol = () => state.perfil.rol;
// Dar de alta desde la rooming list: Grupos (que recibe el archivo), Front Desk y Administración.
const puedeImportar = () => ['grupos', 'frontdesk', 'admin'].includes(rol());
const cola = () => QUEUE[rol()] || [];

// ------------------------------------------------------------------ rutas
function rutaActual() {
  const h = location.hash.replace(/^#/, '') || '/';
  let m;
  if (h === '/grupos/nuevo') return { s: 'alta' };
  if (h === '/usuarios') return { s: 'usuarios' };
  if (h === '/avance') return { s: 'avance' };
  if (h === '/bitacora') return { s: 'bitacora' };
  if ((m = h.match(/^\/expedientes\/([0-9a-f-]{36})\/imprimir$/))) return { s: 'imprimir', id: m[1] };
  if ((m = h.match(/^\/grupos\/([0-9a-f-]{36})\/imprimir$/))) return { s: 'imprimirgrupo', id: m[1] };
  if ((m = h.match(/^\/grupos\/([0-9a-f-]{36})\/importar$/))) return { s: 'importar', id: m[1] };
  if ((m = h.match(/^\/grupos\/([0-9a-f-]{36})$/))) return { s: 'grupo', id: m[1] };
  if ((m = h.match(/^\/expedientes\/([0-9a-f-]{36})$/))) return { s: 'exp', id: m[1] };
  return { s: 'grupos' };
}

export async function montar(el) {
  root = el;
  state.modal = null;
  const ruta = rutaActual();
  const n = ++carga;
  vista = { ruta, datos: null, error: null };
  pintar();
  try {
    vista.datos = await cargar(ruta);
  } catch (e) {
    if (e.status === 401) return;
    vista.error = e.message;
  }
  if (n !== carga) return;
  if (vista.datos && ruta.s === 'importar') importar.alEntrar(vista.datos);
  pintar();
}

async function recargar(mantenerScroll = true) {
  const y = window.scrollY;
  try {
    vista.datos = await cargar(vista.ruta);
    vista.error = null;
  } catch (e) {
    if (e.status === 401) return;
    vista.error = e.message;
  }
  pintar();
  if (mantenerScroll) window.scrollTo(0, y);
}

function cargar(ruta) {
  if (ruta.s === 'grupos') return api('GET', '/api/grupos');
  if (ruta.s === 'grupo') return api('GET', `/api/grupos/${ruta.id}`);
  if (ruta.s === 'importar') {
    if (!puedeImportar()) return Promise.reject(new Error('Tu área no da de alta huéspedes.'));
    return api('GET', `/api/grupos/${ruta.id}`);
  }
  if (ruta.s === 'exp') return api('GET', `/api/expedientes/${ruta.id}`);
  if (ruta.s === 'usuarios') return api('GET', '/api/usuarios');
  if (ruta.s === 'avance') {
    // Front Desk no tiene acceso al reporte de Avance (el servidor tampoco le entrega esos datos).
    if (rol() === 'frontdesk') return Promise.reject(new Error('Tu área no tiene acceso a esta sección.'));
    return api('GET', '/api/grupos');
  }
  if (ruta.s === 'imprimir') return api('GET', `/api/expedientes/${ruta.id}`);
  if (ruta.s === 'imprimirgrupo') {
    if (!['impuestos', 'admin'].includes(rol())) return Promise.reject(new Error('Solo Impuestos y Administración pueden imprimir los expedientes de todo el grupo.'));
    return api('GET', `/api/grupos/${ruta.id}/impresion`);
  }
  if (ruta.s === 'bitacora') return cargarBitacora();
  return Promise.resolve({});
}

function pintar() {
  let body;
  if (vista.error) body = `<div class="card flat center stack"><p>${esc(vista.error)}</p><div><a class="btn" href="#/">Volver a grupos</a></div></div>`;
  else if (!vista.datos) body = '<div class="loading"><span class="spinner"></span>Cargando…</div>';
  else if (vista.ruta.s === 'alta') body = altaGrupo();
  else if (vista.ruta.s === 'grupo') body = pantallaGrupo(vista.datos);
  else if (vista.ruta.s === 'importar') body = importar.pantallaImportar(vista.datos, crumbs);
  else if (vista.ruta.s === 'exp') body = pantallaExpediente(vista.datos);
  else if (vista.ruta.s === 'usuarios') body = pantallaUsuarios(vista.datos);
  else if (vista.ruta.s === 'avance') body = pantallaAvance(vista.datos);
  else if (vista.ruta.s === 'bitacora') body = pantallaBitacora(vista.datos);
  else if (vista.ruta.s === 'imprimir') body = pantallaImprimir(vista.datos);
  else if (vista.ruta.s === 'imprimirgrupo') body = pantallaImprimirGrupo(vista.datos);
  else body = pantallaGrupos(vista.datos);
  root.innerHTML = `${header()}<main class="wrap">${body}</main>${PIE()}${modalHTML()}`;
  if (vista.datos && vista.ruta.s === 'imprimirgrupo') seguirCargaFotos();
  // El navegador propone el título de la página como nombre del PDF al guardar:
  // el código del grupo para el expediente grupal y el nombre del huésped para el individual.
  const d = vista.datos;
  document.title = !d || vista.error ? 'TaxZero'
    : vista.ruta.s === 'imprimirgrupo' ? (d.grupo.codigo_opera || folioGrupo(d.grupo.folio))
    : vista.ruta.s === 'imprimir' ? `${d.expediente.nombre} ${d.expediente.apellidos}`
    : 'TaxZero';
}

// ------------------------------------------------------------------ piezas
function pill(estado) {
  let k = 'proc';
  if (cola().includes(estado)) k = 'mine';
  else if (estado === 'pendiente') k = '';
  else if (['incompleta', 'dev_grupos', 'dev_credito'].includes(estado)) k = 'warn';
  else if (estado === 'cerrado') k = 'done';
  else if (estado === 'no_aplica') k = 'na';
  return `<span class="pill ${k}"><i></i>${ESTADOS[estado]}</span>`;
}

function crumbs(items) {
  return `<nav class="crumbs" aria-label="Ruta">${items
    .map((it, i) => (i < items.length - 1 ? `<a href="${it.href}">${esc(it.t)}</a><span aria-hidden="true">/</span>` : `<span>${esc(it.t)}</span>`))
    .join('')}</nav>`;
}

const ENCABEZADOS = {
  frontdesk: ['Front Desk · PC', 'Huéspedes por <span class="hl">dar de alta</span> y capturar', 'Da de alta a los huéspedes de cada grupo y genera su código QR para la estación de captura.'],
  grupos: ['Grupos y convenciones', 'Expedientes por <span class="hl">revisar</span>', 'Da de alta los grupos y revisa que los documentos de cada huésped estén completos y coincidan.'],
  credito: ['Crédito', 'Expedientes por <span class="hl">validar</span>', 'Valida el pago de cada expediente y registra el monto final de devolución del grupo.'],
  impuestos: ['Impuestos', 'Expedientes por <span class="hl">cerrar</span>', 'Revisión final en el orden del archivo físico.'],
  admin: ['Administración', 'Todos los <span class="hl">grupos</span>', 'Vista general de grupos y expedientes.'],
};

// ------------------------------------------------------------------ lista de grupos
// Tablero por etapa de la estancia, según las fechas oficiales y la fecha de hoy en el hotel.
const ETAPAS = [
  ['casa', 'En casa', 'Grupos hospedados hoy: ya llegaron y aún no llega su salida oficial.'],
  ['llegar', 'Por llegar', 'Grupos con llegada oficial después de hoy, del más próximo al más lejano.'],
  ['salieron', 'Ya salieron', 'Grupos cuya salida oficial ya pasó. Aquí se terminan de revisar y cerrar sus expedientes.'],
  ['cancelados', 'Cancelados', 'Grupos cancelados por Grupos o Administración. Se conservan con sus huéspedes, documentos, motivo y bitácora.'],
  ['todos', 'Todos', 'Todos los grupos, del más reciente al más antiguo.'],
];

function etapaGrupo(g, hoy) {
  if (g.cancelado) return 'cancelados';
  if (g.llegada > hoy) return 'llegar';
  if (g.salida < hoy) return 'salieron';
  return 'casa';
}

function cuandoTxt(g, hoy) {
  const et = etapaGrupo(g, hoy);
  const d = (n, uno, hoyTxt, fut, pas) => (n === 0 ? hoyTxt : n === 1 ? uno : n > 0 ? fut.replace('#', n) : pas.replace('#', -n));
  if (et === 'cancelados') return 'Cancelado';
  if (et === 'llegar') return d(diasEntre(hoy, g.llegada), 'Llega mañana', 'Llega hoy', 'Llega en # días', '');
  if (et === 'casa') return `En casa · ${d(diasEntre(hoy, g.salida), 'sale mañana', 'sale hoy', 'sale en # días', '')}`;
  const n = diasEntre(g.salida, hoy);
  return n === 1 ? 'Salió ayer' : `Salió hace ${n} días`;
}

const ORDEN_ETAPA = {
  casa: (a, b) => a.salida.localeCompare(b.salida),
  llegar: (a, b) => a.llegada.localeCompare(b.llegada),
  salieron: (a, b) => b.salida.localeCompare(a.salida),
  cancelados: (a, b) => b.llegada.localeCompare(a.llegada),
  todos: (a, b) => b.llegada.localeCompare(a.llegada),
};

const normal = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function pantallaGrupos({ grupos }) {
  const [eyebrow, titulo, lead] = ENCABEZADOS[rol()];
  const puedeAlta = ['grupos', 'admin'].includes(rol());
  const hoy = hoyHotel();
  const q = normal(ui.buscar.trim());
  // Año de la llegada oficial. Los grupos se conservan para siempre, así que se pueden filtrar por año.
  const anios = [...new Set(grupos.map((g) => g.llegada.slice(0, 4)))].sort().reverse();
  if (ui.anio && !anios.includes(ui.anio)) ui.anio = '';
  const delAnio = ui.anio ? grupos.filter((g) => g.llegada.startsWith(ui.anio)) : grupos;
  const buscados = q ? delAnio.filter((g) => normal(`${g.nombre} ${g.empresa} ${g.codigo_opera || ''} ${folioGrupo(g.folio)}`).includes(q)) : delAnio;
  const por = { casa: [], llegar: [], salieron: [], cancelados: [], todos: buscados };
  buscados.forEach((g) => por[etapaGrupo(g, hoy)].push(g));
  // Al entrar se abre la primera etapa que tenga grupos (normalmente En casa).
  // Front Desk solo trabaja con grupos en casa o por llegar (el servidor no le entrega los que ya salieron
  // ni los cancelados).
  const etapas = rol() === 'frontdesk' ? ETAPAS.filter(([k]) => !['salieron', 'cancelados'].includes(k)) : ETAPAS;
  if (!ui.tablero || !etapas.some(([k]) => k === ui.tablero)) ui.tablero = ['casa', 'llegar', 'salieron'].find((k) => por[k].length && etapas.some(([e]) => e === k)) || 'casa';
  const et = ui.tablero;
  const lista = por[et].slice().sort(ORDEN_ETAPA[et]);
  const cards = lista
    .map((g) => {
      const c = g.conteo || {};
      const n = cola().reduce((s, k) => s + (c[k] || 0), 0);
      const counts = Object.keys(ESTADOS).filter((k) => c[k]);
      const total = Object.values(c).reduce((s, v) => s + v, 0);
      const abiertos = total - (c.cerrado || 0) - (c.no_aplica || 0);
      const etapa = etapaGrupo(g, hoy);
      const pend = etapa === 'salieron' && total
        ? `<span class="note">${abiertos ? `${abiertos} ${abiertos === 1 ? 'expediente' : 'expedientes'} sin cerrar` : 'Todos los expedientes cerrados'}</span>`
        : '';
      return `<a class="gcard" href="#/grupos/${g.id}">
        <div class="row space-between gcard-top"><span class="queue ${n ? '' : 'zero'} num">${n} ${QUEUE_WORD[rol()]}</span><span class="etapa e-${etapa}">${cuandoTxt(g, hoy)}</span></div>
        <div><h2>${esc(g.nombre)}</h2><div class="meta">${esc(g.empresa)}</div><div class="meta"><span class="mono">${esc(g.codigo_opera || folioGrupo(g.folio))}</span> · ${dateTxt(g.llegada)} al ${dateTxt(g.salida)}</div></div>
        <div class="counts">${counts.length ? counts.map((k) => `<span class="pill ${cola().includes(k) ? 'mine' : ''}">${ESTADOS[k]} <b class="num">${c[k]}</b></span>`).join('') : '<span class="muted">Aún sin huéspedes</span>'}</div>
        ${pend}
      </a>`;
    })
    .join('');
  const vacio = q || ui.anio
    ? `Ningún grupo${q ? ` de "${esc(ui.buscar.trim())}"` : ''}${ui.anio ? ` con llegada en ${ui.anio}` : ''} en ${ETAPAS.find((x) => x[0] === et)[1].toLowerCase()}.`
    : { casa: 'No hay grupos hospedados hoy.', llegar: 'No hay grupos por llegar.', salieron: 'Ningún grupo ha salido todavía.', cancelados: 'No hay grupos cancelados.', todos: 'Todavía no hay grupos.' }[et]
      + (!['salieron', 'cancelados'].includes(et) && !grupos.length ? (puedeAlta ? ' Da de alta el primero con el botón de arriba.' : ' Grupos los da de alta desde su PC.') : '');
  return `<section class="page-head"><div><p class="eyebrow">${eyebrow}</p><h1>${titulo}</h1><p class="lead">${lead}</p></div>
      <div class="row">${puedeAlta ? '<a class="btn primary" href="#/grupos/nuevo">Dar de alta un grupo</a>' : ''}</div></section>
    <div class="tablero-bar">
      <div class="seg" role="tablist" aria-label="Etapa de la estancia">${etapas.map(([k, l]) => `<button class="tab" role="tab" data-a="etapa" data-k="${k}" aria-selected="${et === k}">${l} <span class="num">${por[k].length}</span></button>`).join('')}</div>
      <div class="row tablero-filtros">
        <select id="g-anio" class="anio" aria-label="Año de llegada"><option value="">Todos los años</option>${anios.map((a) => `<option value="${a}" ${ui.anio === a ? 'selected' : ''}>${a}</option>`).join('')}</select>
        <input type="search" id="g-buscar" class="buscar" placeholder="Buscar grupo, empresa o código" size="30" value="${esc(ui.buscar)}" aria-label="Buscar grupo" autocomplete="off">
      </div>
    </div>
    <p class="note tablero-nota">${et === 'todos' && rol() === 'frontdesk' ? 'Grupos en casa y por llegar. Los grupos que ya salieron o se cancelaron no se muestran a Front Desk.' : ETAPAS.find((x) => x[0] === et)[2]}</p>
    ${lista.length ? `<div class="ggrid">${cards}</div>` : `<div class="card flat empty">${vacio}</div>`}`;
}

// ------------------------------------------------------------------ alta de grupo
function altaGrupo() {
  if (!['grupos', 'admin'].includes(rol())) return '<div class="card flat empty">Solo Grupos puede dar de alta grupos.</div>';
  return `${crumbs([{ t: 'Grupos', href: '#/' }, { t: 'Alta de grupo' }])}
    <section class="page-head"><div><p class="eyebrow">Grupos</p><h1>Dar de alta un <span class="hl">grupo</span></h1><p class="lead">Front Desk da de alta a los huéspedes desde su PC una vez creado el grupo.</p></div></section>
    <form class="card stack max-820" data-form="alta" novalidate>
      <div class="fgrid">
        <div class="field full"><label for="a-nombre">Nombre del grupo</label><input type="text" id="a-nombre" required maxlength="200" placeholder="Ej. Congreso Anual Woodgrove 2027"></div>
        <div class="field"><label for="a-empresa">Empresa</label><input type="text" id="a-empresa" required maxlength="200"></div>
        <div class="field"><label for="a-contacto">Contacto del grupo</label><input type="text" id="a-contacto" maxlength="200" placeholder="Nombre y cargo"></div>
        <div class="field"><label for="a-llegada">Llegada oficial</label><input type="date" id="a-llegada" required min="${hoyHotel()}"></div>
        <div class="field"><label for="a-salida">Salida oficial</label><input type="date" id="a-salida" required min="${hoyHotel()}"></div>
        <div class="field"><label for="a-est">Huéspedes estimados</label><input type="number" id="a-est" min="1" max="5000" placeholder="Ej. 450"></div>
        <div class="field"><label for="a-codigo">Código de grupo en Opera</label><input type="text" id="a-codigo" maxlength="60" placeholder="Ej. GRP-1401-WGB"></div>
      </div>
      <div class="stack gap-sm"><h3>Evento y organizador</h3>
        <p class="note">El estímulo solo aplica a congresos, convenciones, exposiciones o ferias con organizador residente en el extranjero. Los viajes de incentivo o recreativos no califican.</p></div>
      ${camposEvento('a')}
      <p class="err" id="a-err" hidden></p>
      <div class="row end"><a class="btn" href="#/">Cancelar</a><button type="submit" class="btn primary">Crear grupo</button></div>
    </form>`;
}

function camposEvento(px, e = null) {
  const paises = PAISES.map((p) => `<option value="${p[1]}" ${e?.pais_codigo === p[1] ? 'selected' : ''}>${esc(p[0])}</option>`).join('');
  return `<div class="fgrid">
    <div class="field"><label for="${px}-tipo">Tipo de evento</label><select id="${px}-tipo" required><option value="">Elige el tipo</option>${Object.entries(TIPOS_EVENTO).map(([k, l]) => `<option value="${k}" ${e?.tipo === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field"><label for="${px}-org">Organizador del evento</label><input type="text" id="${px}-org" maxlength="200" required value="${esc(e?.organizador || '')}" placeholder="Empresa o asociación que organiza"></div>
    <div class="field"><label for="${px}-pais">País de residencia del organizador</label><select id="${px}-pais"><option value="">Elige un país</option>${paises}</select>
      <span class="note" id="${px}-pais-mx" ${e?.pais_codigo === 'MEX' ? '' : 'hidden'}>Con organizador residente en México el estímulo no aplica.</span></div>
    <div class="field"><label for="${px}-idf">Identificación fiscal extranjera <span class="muted">(opcional)</span></label><input type="text" id="${px}-idf" maxlength="60" value="${esc(e?.id_fiscal || '')}" placeholder="Ej. EIN 12-3456789"></div>
  </div>`;
}

function leerEvento(f, px) {
  const v = (id) => f.querySelector(`#${px}-${id}`).value.trim();
  const pais = PAISES.find((p) => p[1] === v('pais'));
  return { tipo: v('tipo'), organizador: v('org'), pais_codigo: pais?.[1] || '', pais: pais?.[0] || '', id_fiscal: v('idf') };
}

async function enviarAlta(f) {
  const v = (id) => f.querySelector('#' + id).value.trim();
  const err = f.querySelector('#a-err');
  const datos = {
    nombre: v('a-nombre'), empresa: v('a-empresa'), contacto: v('a-contacto'), llegada: v('a-llegada'),
    salida: v('a-salida'), estimados: v('a-est'), codigo_opera: v('a-codigo'), evento: leerEvento(f, 'a'),
  };
  let msg = '';
  if (!datos.nombre || !datos.empresa || !datos.llegada || !datos.salida) msg = 'Llena nombre, empresa, llegada y salida.';
  else if (datos.llegada < hoyHotel()) msg = 'La llegada no puede ser anterior a hoy.';
  else if (datos.salida < datos.llegada) msg = 'La salida no puede ser antes de la llegada.';
  else if (!datos.evento.tipo || datos.evento.organizador.length < 2) msg = 'Elige el tipo de evento y escribe el organizador.';
  if (msg) {
    err.hidden = false;
    err.textContent = msg;
    return;
  }
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const { id } = await api('POST', '/api/grupos', datos);
    toast('Grupo creado. Front Desk ya puede dar de alta a sus huéspedes.');
    location.hash = `#/grupos/${id}`;
  } catch (e) {
    err.hidden = false;
    err.textContent = e.message;
    btn.disabled = false;
  }
}

// ------------------------------------------------------------------ grupo
function pantallaGrupo(datos) {
  const { grupo: g, expedientes, codigos, montos = [], facturas = [] } = datos;
  const activos = new Map(codigos.map((c) => [c.expediente_id, c]));
  const clave = g.id;
  const f = ui.filtro[clave] || 'todos';
  const presentes = Object.keys(ESTADOS).filter((k) => expedientes.some((e) => e.estado === k));
  const enCola = (e) => cola().includes(e.estado);
  // Los expedientes detenidos son parte del reporte de Avance, que Front Desk no ve.
  const detenido = (e) => rol() !== 'frontdesk' && esDetenido(e);
  const mostrados = expedientes
    .filter((e) => f === 'todos' || (f === 'mios' ? enCola(e) : f === 'detenidos' ? detenido(e) : e.estado === f))
    .sort((a, b) => enCola(b) - enCola(a) || (b.actualizado_en > a.actualizado_en ? 1 : -1));
  const cancelado = datos.cancelacion;
  // En un grupo cancelado no se dan de alta huéspedes ni se generan QR.
  const esFD = ['frontdesk', 'admin'].includes(rol()) && !cancelado;
  const esGrupos = ['grupos', 'admin'].includes(rol());
  const filas = mostrados
    .map((e) => {
      const q = activos.get(e.id);
      const act = esFD && ['pendiente', 'incompleta'].includes(e.estado)
        ? `<button class="btn sm ${q ? '' : 'primary'}" data-a="qr" data-e="${e.id}">${q ? 'Ver QR activo' : 'Generar QR'}</button> `
        : '';
      return `<tr class="${enCola(e) ? 'q' : ''}">
        <td><b>${esc(e.nombre)} ${esc(e.apellidos)}</b><span class="sub mono">${folioExp(e.folio)}</span></td>
        <td>${esc(e.nacionalidad)}</td><td class="mono">${esc(e.pasaporte || '·')}</td>
        <td>${pill(e.estado)}${detenido(e) ? `<span class="sub detenido">Sin movimiento hace ${diasSin(e.actualizado_en)} días</span>` : ''}</td><td class="muted num">${fmt(e.actualizado_en)}</td>
        <td class="tdact">${act}<a class="btn sm" href="#/expedientes/${e.id}">Abrir</a></td></tr>`;
    })
    .join('');
  const cap = QUEUE_WORD[rol()];
  const nDet = expedientes.filter(detenido).length;
  const filtros = [['todos', 'Todos'], ...(cola().length ? [['mios', cap[0].toUpperCase() + cap.slice(1)]] : []), ...(nDet ? [['detenidos', `Detenidos (${nDet})`]] : []), ...presentes.map((k) => [k, ESTADOS[k]])];
  return `${crumbs([{ t: 'Grupos', href: '#/' }, { t: g.nombre }])}
    <section class="page-head"><div><p class="eyebrow mono">${esc(g.codigo_opera || folioGrupo(g.folio))}</p><h1>${esc(g.nombre)}</h1></div>
      <div class="row">${['impuestos', 'admin'].includes(rol()) && expedientes.length ? `<a class="btn" href="#/grupos/${g.id}/imprimir">Imprimir expedientes del grupo</a><button class="btn" data-a="zipgrupo">Descargar expediente completo (.zip)</button>` : ''}
      ${rol() !== 'frontdesk' && expedientes.length ? `<a class="btn" href="/api/grupos/${g.id}/excel" data-descarga>Descargar en Excel</a>` : ''}
      ${puedeImportar() && !cancelado ? `<a class="btn ${esFD ? '' : 'primary'}" href="#/grupos/${g.id}/importar">Dar de alta desde rooming list</a>` : ''}
      ${esFD ? `<button class="btn primary" data-a="altahues">Dar de alta un huésped</button>` : ''}</div></section>
    <div class="stack">
      ${cancelado ? `<div class="notice cancelado"><b>Grupo cancelado</b> el ${fmt(cancelado.ts)} por ${esc(cancelado.registrado_por_nombre)}. Motivo: ${esc(cancelado.motivo)}<br>Se conserva toda su información. No se pueden dar de alta huéspedes ni generar QR${esGrupos ? ' mientras no lo reactives' : ''}.</div>` : ''}
      <div class="card flat stack">${esGrupos ? `<div class="row space-between"><h3>Datos del grupo</h3><div class="row"><button class="btn sm" data-a="editgrupo">Editar datos</button>${cancelado ? '<button class="btn sm" data-a="cancelgrupo" data-k="reactivar">Reactivar grupo</button>' : '<button class="btn sm warn" data-a="cancelgrupo" data-k="cancelar">Cancelar grupo</button>'}</div></div>` : ''}<dl class="info">
        <div><dt>Empresa</dt><dd>${esc(g.empresa)}</dd></div>
        <div><dt>Estancia</dt><dd>${dateTxt(g.llegada)} al ${dateTxt(g.salida)}</dd></div>
        <div><dt>Huéspedes estimados</dt><dd class="num">${g.estimados ?? '·'}</dd></div>
        <div><dt>Huéspedes dados de alta</dt><dd class="num">${expedientes.length}</dd></div>
        <div><dt>Contacto</dt><dd>${esc(g.contacto || 'Sin capturar')}</dd></div>
        ${g.codigo_opera ? `<div><dt>Código en Opera</dt><dd class="mono">${esc(g.codigo_opera)}</dd></div>` : ''}
      </dl></div>
      ${rol() === 'frontdesk' ? '' : expedienteEvento(datos)}
      ${extraGrupo(g, montos, facturas)}
      ${['credito', 'impuestos', 'admin'].includes(rol()) ? documentosCredito(datos) : ''}
      ${rol() === 'impuestos' ? verificacionGrupo(datos) : ''}
      <div class="seg" role="tablist" aria-label="Filtrar por estado">${filtros.map(([k, l]) => `<button class="tab" role="tab" data-a="filtro" data-k="${k}" aria-selected="${f === k}">${l}</button>`).join('')}</div>
      <div class="tablewrap"><table><thead><tr><th>Huésped</th><th>Nacionalidad</th><th>Pasaporte</th><th>Estado</th><th>Último cambio</th><th></th></tr></thead>
      <tbody>${filas || `<tr><td colspan="6" class="empty">${expedientes.length ? 'Ningún expediente con este filtro.' : 'Aún no hay huéspedes en este grupo. Se dan de alta desde la rooming list o uno por uno desde Front Desk.'}</td></tr>`}</tbody></table></div>
      ${datos.bitacora?.length ? `<div class="card flat stack"><div class="row space-between"><h3>Bitácora del grupo</h3><span class="note">No se puede editar ni borrar</span></div><ol class="log">${datos.bitacora.map(lineaLog).join('')}</ol></div>` : ''}
    </div>`;
}

const lineaLog = (l) => `<li><div>${esc(l.accion)}</div><div class="t">${fmt(l.ts)} · ${esc(l.usuario_nombre)} (${esc(l.rol)})</div>${l.motivo ? `<span class="m">Motivo: ${esc(l.motivo)}</span>` : ''}</li>`;

const pesoTxt = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

// Expediente del evento: datos del organizador y documentos que respaldan el estímulo.
function expedienteEvento({ evento = [], docs_grupo: docs = [] }) {
  const e = evento[evento.length - 1];
  const edita = ['grupos', 'admin'].includes(rol());
  const datosEv = e
    ? `<dl class="info">
        <div><dt>Tipo de evento</dt><dd>${TIPOS_EVENTO[e.tipo]}</dd></div>
        <div><dt>Organizador</dt><dd>${esc(e.organizador)}</dd></div>
        <div><dt>Residencia del organizador</dt><dd>${esc(e.pais || 'Sin capturar')}</dd></div>
        <div><dt>Identificación fiscal extranjera</dt><dd class="mono">${esc(e.id_fiscal || 'Sin capturar')}</dd></div>
      </dl>
      ${e.pais_codigo === 'MEX' ? '<div class="notice">El organizador es residente en México: el estímulo no aplica.</div>' : ''}
      <p class="note">Registrado por ${esc(e.registrado_por_nombre)} el ${fmt(e.ts)}${evento.length > 1 ? '. Los datos anteriores quedan en la bitácora del grupo.' : '.'}</p>`
    : '<div class="notice">Faltan los datos del evento y del organizador. Sin ellos no se puede demostrar que el evento califica.</div>';
  const filas = DOCS_GRUPO.map(([t, label, ayuda]) => {
    const arch = docs.filter((d) => d.tipo === t).reverse();
    const lista = arch.length
      ? `<ul class="files">${arch.map((d, i) => `<li><a href="/api/documentos-grupo/${d.id}/archivo" target="_blank" rel="noopener">${esc(d.nombre_archivo)}</a> <span class="note">${pesoTxt(d.bytes)} · ${fmt(d.subido_en)} · ${esc(d.subido_por_nombre)}${i ? ' · anterior' : ''}</span></li>`).join('')}</ul>`
      : '<span class="note">Falta</span>';
    const acepta = t === 'rooming' ? '.xlsx,.xls,.pdf,.jpg,.jpeg,.png' : '.pdf,.jpg,.jpeg,.png';
    const subir = edita
      ? `<label class="btn sm" for="up-${t}">${arch.length ? 'Subir otro' : 'Subir'}</label><input id="up-${t}" class="file-hidden" type="file" accept="${acepta}" data-up="${t}">`
      : '';
    return `<div class="docrow ${arch.length ? 'ok' : ''}"><div class="docrow-t"><span class="dot" aria-hidden="true"></span><div><b>${label}</b><span class="note">${ayuda}</span></div></div>
      <div class="docrow-f">${lista}</div><div class="docrow-a">${subir}</div></div>`;
  }).join('');
  const conDocs = DOCS_GRUPO.filter(([t]) => docs.some((d) => d.tipo === t)).length;
  return `<div class="card flat stack">
    <div class="row space-between"><div><p class="eyebrow">Expediente del evento</p><h2>Evento y organizador</h2></div>
      ${edita ? `<button class="btn ${e ? '' : 'primary'}" data-a="evento">${e ? 'Actualizar datos' : 'Completar datos del evento'}</button>` : ''}</div>
    ${datosEv}
    <div class="row space-between"><h3>Documentos del evento</h3><span class="note num">${conDocs} de ${DOCS_GRUPO.length} tipos con archivo</span></div>
    <p class="note">PDF o foto. El rooming list puede ir en Excel. Un archivo nuevo no reemplaza al anterior: los dos quedan guardados.</p>
    <div class="docrows">${filas}</div>
    <p class="err" id="up-err" hidden></p>
  </div>`;
}

// Crédito: documentos que respaldan la devolución y folio de la cuenta maestra en Opera.
// Impuestos y Administración los consultan; solo Crédito sube y registra.
function documentosCredito({ docs_credito: docs = [], folios_maestra: folios = [] }) {
  const sube = rol() === 'credito';
  const filas = DOCS_CREDITO.map(([t, label, ayuda]) => {
    const arch = docs.filter((d) => d.tipo === t).reverse();
    const lista = arch.length
      ? `<ul class="files">${arch.map((d, i) => `<li><a href="/api/documentos-credito/${d.id}/archivo" target="_blank" rel="noopener">${esc(d.nombre_archivo)}</a> <span class="note">${pesoTxt(d.bytes)} · ${fmt(d.subido_en)} · ${esc(d.subido_por_nombre)}${i && t !== 'extraordinario' ? ' · anterior' : ''}</span>${d.descripcion ? `<span class="note block">${esc(d.descripcion)}</span>` : ''}</li>`).join('')}</ul>`
      : `<span class="note">${t === 'extraordinario' ? 'Ninguno' : 'Falta'}</span>`;
    const acepta = t === 'autorizacion' ? '.pdf,.jpg,.jpeg,.png' : '.pdf,.xlsx,.xls,.jpg,.jpeg,.png';
    let subir = '';
    if (sube && t === 'extraordinario') subir = '<button class="btn sm" data-a="doc-extra">Agregar</button>';
    else if (sube) subir = `<label class="btn sm" for="upc-${t}">${arch.length ? 'Subir otro' : 'Subir'}</label><input id="upc-${t}" class="file-hidden" type="file" accept="${acepta}" data-upc="${t}">`;
    return `<div class="docrow ${arch.length ? 'ok' : ''}"><div class="docrow-t"><span class="dot" aria-hidden="true"></span><div><b>${label}</b><span class="note">${ayuda}</span></div></div>
      <div class="docrow-f">${lista}</div><div class="docrow-a">${subir}</div></div>`;
  }).join('');
  const u = folios[folios.length - 1];
  const anteriores = folios.slice(0, -1).reverse();
  return `<div class="card flat stack">
    <div class="row space-between"><div><p class="eyebrow">Crédito</p><h2>Devolución del grupo</h2></div>
      ${sube ? `<button class="btn ${u ? '' : 'primary'}" data-a="folio-maestra">${u ? 'Registrar otro folio' : 'Registrar folio de Opera'}</button>` : ''}</div>
    <dl class="info"><div><dt>Folio de Opera de la cuenta maestra con la devolución</dt><dd>${u ? `<span class="mono">${esc(u.folio)}</span> <span class="note">· ${fmt(u.ts)} · ${esc(u.registrado_por_nombre)}</span>${u.nota ? `<span class="note block">${esc(u.nota)}</span>` : ''}` : '<span class="muted">Sin registrar</span>'}
      ${anteriores.length ? `<span class="note block">Anteriores: ${anteriores.map((f) => esc(f.folio)).join(', ')}</span>` : ''}</dd></div></dl>
    <div class="row space-between"><h3>Documentos de Crédito</h3><span class="note">Un archivo nuevo no reemplaza al anterior</span></div>
    <div class="docrows">${filas}</div>
    <p class="err" id="upc-err" hidden></p>
  </div>`;
}

// Impuestos: lista de 10 puntos de la guía y semáforo de riesgo del grupo.
function verificacionGrupo({ verificacion = [], riesgos = [] }) {
  const estado = {};
  verificacion.forEach((v) => { estado[v.punto] = v; });
  const marcados = CHECK_GRUPO.filter((_, i) => estado[i + 1]?.marcado).length;
  const r = riesgos[riesgos.length - 1];
  const hist = riesgos.slice(0, -1).reverse().map((x) => `<li><div><s>${RIESGOS[x.nivel].label}</s> <span class="muted">(anterior)</span></div><div class="t">${fmt(x.ts)} · ${esc(x.registrado_por_nombre)}</div><span class="m nota-gris">${esc(x.nota)}</span></li>`).join('');
  return `<div class="two">
    <div class="card flat stack">
      <div class="row space-between"><div><p class="eyebrow">Control interno</p><h3>Verificación del expediente del grupo</h3></div><span class="pill ${marcados === CHECK_GRUPO.length ? 'done' : ''} num">${marcados} de ${CHECK_GRUPO.length}</span></div>
      <div class="checks">${CHECK_GRUPO.map((c, i) => `<label><input type="checkbox" data-vg="${i + 1}" ${estado[i + 1]?.marcado ? 'checked' : ''}><span>${esc(c)}${estado[i + 1] ? `<span class="note block">${estado[i + 1].marcado ? 'Marcado' : 'Desmarcado'} por ${esc(estado[i + 1].registrado_por_nombre)} · ${fmt(estado[i + 1].ts)}</span>` : ''}</span></label>`).join('')}</div>
      <p class="note">Cada marca queda guardada con tu nombre y la hora.</p>
    </div>
    <div class="card flat stack">
      <div><p class="eyebrow">Mapa de riesgo</p><h3>¿Procede o no procede?</h3></div>
      ${r ? `<div class="riesgo r-${r.nivel}"><b>${RIESGOS[r.nivel].label} · ${RIESGOS[r.nivel].sub}</b><span>${esc(r.nota)}</span><span class="note">${fmt(r.ts)} · ${esc(r.registrado_por_nombre)}</span></div>` : '<p class="muted">Sin evaluar.</p>'}
      <div class="row">${Object.entries(RIESGOS).map(([k, x]) => `<button class="btn sm" data-a="riesgo" data-k="${k}">${x.label}</button>`).join('')}</div>
      <p class="note">"¿Podría defender esto frente al SAT con expediente completo?" Si hay duda, es riesgo medio. Si no se puede probar, es riesgo alto.</p>
      ${hist ? `<ol class="log">${hist}</ol>` : ''}
    </div>
  </div>`;
}

function extraGrupo(g, montos, facturas) {
  const ultimo = montos[montos.length - 1];
  const fact = facturas[facturas.length - 1];
  if (rol() === 'credito') {
    const hist = montos.slice().reverse().map((m, i) => `<li><div>${i ? `<s>${esc(m.valor)}</s> <span class="muted">(anterior)</span>` : esc(m.valor)}</div><div class="t">${fmt(m.ts)} · ${esc(m.registrado_por_nombre)}</div><span class="m nota-gris">${esc(m.nota)}</span></li>`).join('');
    return `<div class="card flat stack">
      <div class="row space-between"><div><p class="eyebrow">Monto final de devolución del grupo</p>
        <p class="big-num num">${ultimo ? esc(ultimo.valor) : '<span class="muted">Sin registrar</span>'}</p></div>
        <button class="btn primary" data-a="monto">${ultimo ? 'Registrar un monto nuevo' : 'Registrar monto'}</button></div>
      <p class="note">Cada huésped pagó su propia cuenta; revisa su comprobante en cada expediente. La plataforma no calcula este monto: regístralo tal como lo autorizó Cuentas por pagar.</p>
      ${hist ? `<ol class="log">${hist}</ol>` : ''}</div>`;
  }
  if (rol() === 'impuestos') {
    const linea = (tipo, titulo) => {
      const fs = facturas.filter((f) => (f.tipo || 'evento') === tipo);
      const u = fs[fs.length - 1];
      return `<div><dt>${titulo}</dt><dd>${u ? `<span class="mono">${esc(u.folio)}</span> <span class="note">· ${fmt(u.ts)} · ${esc(u.registrado_por_nombre)}</span>` : '<span class="muted">Sin folio</span>'}
        ${fs.length > 1 ? `<span class="note block">Anteriores: ${fs.slice(0, -1).reverse().map((f) => esc(f.folio)).join(', ')}</span>` : ''}</dd></div>`;
    };
    return `<div class="card flat stack">
      <div class="row space-between"><div><p class="eyebrow">Facturas del grupo</p><p class="note">Días del evento con estímulo en un CFDI; días personales y consumos no vinculados al 16% en otro. Nunca en una sola factura.</p></div>
      <button class="btn" data-a="factura">Registrar folio</button></div>
      <dl class="info">${linea('evento', 'Factura del evento (estímulo)')}${linea('personal', 'Factura de días personales (16%)')}
        <div><dt>Monto registrado por Crédito</dt><dd>${ultimo ? esc(ultimo.valor) : 'Pendiente'}</dd></div></dl></div>`;
  }
  if (['grupos', 'admin'].includes(rol()) && (ultimo || fact)) {
    return `<div class="card flat"><dl class="info">
      <div><dt>Monto registrado por Crédito</dt><dd>${ultimo ? esc(ultimo.valor) : 'Sin registrar'}</dd></div>
      <div><dt>Folio de factura</dt><dd class="mono">${fact ? esc(fact.folio) : 'Sin registrar'}</dd></div></dl></div>`;
  }
  return '';
}

// ------------------------------------------------------------------ expediente
function versionActual(docs, tipo) {
  const arr = docs.filter((d) => d.tipo === tipo).sort((a, b) => a.version - b.version);
  if (!arr.length) return { arr, v: null };
  const sel = ui.ver[`${vista.ruta.id}:${tipo}`];
  return { arr, v: arr.find((x) => x.version === sel) || arr[arr.length - 1] };
}

function docCard(docs, tipo, num) {
  const { arr, v } = versionActual(docs, tipo);
  const ultima = arr[arr.length - 1];
  const vieja = v && ultima && v.version !== ultima.version;
  const vers = arr.length > 1
    ? `<div class="vers" role="group" aria-label="Versiones">${arr.slice().reverse().map((x) => `<button class="ver" data-a="ver" data-t="${tipo}" data-v="${x.version}" aria-pressed="${x.version === v.version}">v${x.version} · ${x.version === ultima.version ? 'actual' : 'reemplazada'}</button>`).join('')}</div>`
    : '';
  const sub = tipo === 'fmm' && v?.fmm_tipo ? ` <span class="muted">· ${FMM_TIPOS[v.fmm_tipo]}</span>` : '';
  return `<article class="doc">
    <div class="doc-h"><h3>${num ? `<span class="ord">${num}</span>` : ''}${DOCS[tipo].label}${sub}</h3>${vers}</div>
    <div class="doc-b">${v
      ? `${vieja ? '<span class="oldtag">Versión anterior</span>' : ''}<button class="view" data-a="zoom" data-d="${v.id}" data-t="${tipo}" aria-label="Ampliar ${DOCS[tipo].label}"><img class="paper" loading="lazy" src="/api/documentos/${v.id}/imagen" alt="${DOCS[tipo].label}, versión ${v.version}"></button>`
      : `<div class="missing">${DOCS[tipo].opcional ? 'Sin capturar (opcional)' : 'Sin capturar'}</div>`}</div>
    ${v ? `<div class="doc-f">v${v.version} capturada el ${fmt(v.capturado_en)} en ${esc(v.capturado_por_nombre || 'la estación de captura')}</div>` : ''}
  </article>`;
}

function docsBloque(docs) {
  if (rol() === 'impuestos') return `<div class="docs">${FILE_ORDER.filter((t) => t !== 'constancia' || docs.some((d) => d.tipo === t)).map((t, i) => docCard(docs, t, i + 1)).join('')}</div>`;
  const o = rol() === 'credito' ? ['pago', 'regcard', 'pasaporte', 'fmm'] : DOC_ORDER;
  return `<div class="docs"><div class="two">${docCard(docs, o[0])}${docCard(docs, o[1])}</div><div class="two">${docCard(docs, o[2])}${docCard(docs, o[3])}</div>${docCard(docs, 'constancia')}</div>`;
}

function accionesExp(e, codigo) {
  const wrap = (t, b) => `<div class="card stack"><h3>${t}</h3>${b}</div>`;
  if (['frontdesk', 'admin'].includes(rol())) {
    if (!['pendiente', 'incompleta'].includes(e.estado)) {
      return wrap('Captura', `<p class="note">La captura ya se envió. El expediente está ${ESTADOS[e.estado].toLowerCase()}.</p>`);
    }
    const recap = e.recapturar?.length ? `<div class="notice">Se pidió recapturar: ${e.recapturar.map((t) => DOCS[t].label.toLowerCase()).join(', ')}.</div>` : '';
    return wrap('Captura en iPad', `${recap}<p class="note">Genera un código QR y muéstralo en la estación de captura. Sirve una sola vez y vence a los 15 minutos.</p>
      <button class="btn primary block" data-a="qr" data-e="${e.id}">${codigo ? 'Ver QR activo' : 'Generar QR'}</button>`);
  }
  const chk = CHECKS[rol()] || [];
  const marcadas = ui.checks[e.id] || [];
  const todas = chk.length && chk.every((_, i) => marcadas.includes(i));
  const lista = chk.length
    ? `<div class="checks">${chk.map((c, i) => `<label><input type="checkbox" data-check="${i}" ${marcadas.includes(i) ? 'checked' : ''}><span>${c}</span></label>`).join('')}</div>`
    : '';
  const boton = (accion, texto) => `<button class="btn primary block" data-a="accion" data-op="${accion}" id="btn-go" ${todas ? '' : 'disabled'}>${texto}</button>`;
  const motivo = (op, texto, warn) => `<button class="btn sm ${warn ? 'warn' : ''}" data-a="motivo" data-op="${op}">${texto}</button>`;
  const nota = `<p class="note">El botón se habilita al marcar todas las verificaciones.</p>`;
  if (rol() === 'grupos') {
    if (['rev_grupos', 'dev_grupos'].includes(e.estado)) {
      const sinVence = !e.pasaporte_vence;
      return wrap('Verificación de Grupos', `${lista}${sinVence ? '<div class="notice">Registra la fecha de vencimiento del pasaporte (abajo, en los datos del huésped) para poder aprobar.</div>' : ''}
        <button class="btn primary block" data-a="accion" data-op="aprobar" id="btn-go" data-sinvence="${sinVence ? 1 : 0}" ${todas && !sinVence ? '' : 'disabled'}>Aprobar y enviar a Crédito</button>
        <div class="row">${motivo('recaptura', 'Pedir recaptura')}${motivo('no_aplica', 'No aplica')}</div>${nota}`);
    }
    if (['pendiente', 'incompleta'].includes(e.estado)) {
      return wrap('Esperando captura', `<p class="note">Front Desk genera el QR y el huésped pasa a la estación de captura.</p><div class="row">${motivo('no_aplica', 'Marcar No aplica')}</div>`);
    }
    return wrap('Sin acciones', `<p class="note">Este expediente ya no está en Grupos.</p>`);
  }
  if (rol() === 'credito') {
    if (['val_credito', 'dev_credito'].includes(e.estado)) {
      return wrap('Validación de Crédito', `${lista}${boton('validar', 'Validar y enviar a Impuestos')}
        <div class="row">${motivo('devolver_grupos', 'Devolver a Grupos', true)}</div>${nota}`);
    }
    return wrap('Sin acciones', `<p class="note">${e.estado === 'cerrado' ? 'Expediente cerrado por Impuestos.' : 'Este expediente no está en Crédito.'}</p>`);
  }
  if (rol() === 'impuestos') {
    if (e.estado === 'rev_impuestos') {
      return wrap('Revisión final', `${lista}${boton('cerrar', 'Cerrar expediente')}
        <div class="row">${motivo('devolver_credito', 'Devolver a Crédito', true)}</div>${nota}`);
    }
    if (e.estado === 'cerrado') {
      return wrap('Expediente cerrado', `<p class="note">Un expediente cerrado no se modifica. Si una auditoría lo requiere, se puede reabrir con motivo.</p><div class="row">${motivo('reabrir', 'Reabrir por auditoría')}</div>`);
    }
    return wrap('Sin acciones', `<p class="note">Este expediente todavía no llega a Impuestos.</p>`);
  }
  return '';
}

const puedeVence = (e) => ['frontdesk', 'grupos', 'admin'].includes(rol()) && ['pendiente', 'incompleta', 'rev_grupos', 'dev_grupos'].includes(e.estado);

function pantallaExpediente({ expediente: e, grupo: g, documentos, bitacora, codigo }) {
  const log = bitacora.map((l) => `<li><div>${esc(l.accion)}</div><div class="t">${fmt(l.ts)} · ${esc(l.usuario_nombre)} (${esc(l.rol)})</div>${l.motivo ? `<span class="m">Motivo: ${esc(l.motivo)}</span>` : ''}</li>`).join('');
  return `${crumbs([{ t: 'Grupos', href: '#/' }, { t: g.nombre, href: `#/grupos/${g.id}` }, { t: `${e.nombre} ${e.apellidos}` }])}
    <section class="page-head"><div><p class="eyebrow mono">${folioExp(e.folio)}</p><h1>${esc(e.nombre)} ${esc(e.apellidos)}</h1>
      <div class="row mt-8">${pill(e.estado)}<span class="muted">${esc(e.nacionalidad)}</span></div></div>
      ${documentos.length ? `<a class="btn" href="#/expedientes/${e.id}/imprimir">Imprimir expediente</a>` : ''}</section>
    ${['dev_grupos', 'dev_credito'].includes(e.estado) && bitacora[0]?.motivo ? `<div class="notice mt-neg"><b>${esc(bitacora[0].accion)}</b> por ${esc(bitacora[0].usuario_nombre)} (${esc(bitacora[0].rol)}). Motivo: ${esc(bitacora[0].motivo)}</div>` : ''}
    ${e.nacionalidad_codigo === 'MEX' ? '<div class="notice mt-neg">Nacionalidad mexicana: no aplica para tax free. Grupos lo marcará como No aplica.</div>' : ''}
    ${rol() === 'impuestos' ? '<p class="note mt-neg">Documentos en el orden del archivo físico.</p>' : ''}
    <div class="exp">${docsBloque(documentos)}
      <aside class="side">
        ${accionesExp(e, codigo)}
        <div class="card stack"><dl class="kv">
          <dt>Pasaporte</dt><dd class="mono">${esc(e.pasaporte || 'Por capturar')}</dd>
          <dt>Vence</dt><dd>${e.pasaporte_vence ? dateTxt(e.pasaporte_vence) : '<span class="muted">Sin registrar</span>'}</dd>
          <dt>Nacionalidad</dt><dd>${esc(e.nacionalidad)}</dd>
          <dt>Llegada del grupo</dt><dd>${dateTxt(g.llegada)}</dd><dt>Salida del grupo</dt><dd>${dateTxt(g.salida)}</dd>
          <dt>Grupo</dt><dd class="mono">${esc(g.codigo_opera || folioGrupo(g.folio))}</dd>
        </dl>
        ${e.pasaporte_vence && e.pasaporte_vence < g.salida ? '<div class="notice">El pasaporte vence antes de la salida del grupo. Revisa que estuviera vigente en las fechas de la estancia.</div>' : ''}
        ${puedeVence(e) ? `<div class="row"><button class="btn sm" data-a="edithues">Corregir datos del huésped</button><button class="btn sm" data-a="vence">${e.pasaporte_vence ? 'Corregir vencimiento' : 'Registrar vencimiento del pasaporte'}</button></div>` : ''}</div>
        <div class="card stack"><div class="row space-between"><h3>Bitácora</h3><span class="note">No se puede editar ni borrar</span></div><ol class="log">${log}</ol></div>
      </aside></div>`;
}

// ------------------------------------------------------------------ avance (etapa 5)
const DIAS_DETENIDO = 3;
const FINALES = ['cerrado', 'no_aplica'];
const diasSin = (ts) => Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
const esDetenido = (e) => !FINALES.includes(e.estado) && diasSin(e.actualizado_en) >= DIAS_DETENIDO;

// Columnas del avance: cada paso del flujo junta sus estados (incluye los devueltos a esa área).
const PASOS = [
  ['Por capturar', 'Front Desk', ['pendiente', 'incompleta']],
  ['En Grupos', 'Revisión', ['rev_grupos', 'dev_grupos']],
  ['En Crédito', 'Validación', ['val_credito', 'dev_credito']],
  ['En Impuestos', 'Revisión final', ['rev_impuestos']],
  ['Cerrados', '', ['cerrado']],
  ['No aplica', '', ['no_aplica']],
];

function pantallaAvance({ grupos = [] }) {
  const solo = !!ui.avSolo;
  const lista = solo ? grupos.filter((g) => g.detenidos) : grupos;
  const n = (g, estados) => estados.reduce((s, k) => s + ((g.conteo || {})[k] || 0), 0);
  const total = (g) => Object.values(g.conteo || {}).reduce((s, x) => s + x, 0);
  const celda = (v, cls = '') => `<td class="num ${cls}">${v ? v : '<span class="muted">·</span>'}</td>`;
  const filas = lista.map((g) => `<tr>
      <td><a href="#/grupos/${g.id}"><b>${esc(g.nombre)}</b></a><span class="sub"><span class="mono">${esc(g.codigo_opera || folioGrupo(g.folio))}</span> · ${dateTxt(g.llegada)} al ${dateTxt(g.salida)}</span></td>
      <td class="num">${total(g)}${g.estimados ? `<span class="sub">de ${g.estimados} estimados</span>` : ''}</td>
      ${PASOS.map(([, , est], i) => celda(n(g, est), i === PASOS.length - 2 ? 'ok' : '')).join('')}
      ${celda(g.detenidos, g.detenidos ? 'alerta' : '')}
      <td class="muted num">${g.ultimo_movimiento ? fmt(g.ultimo_movimiento) : 'Sin huéspedes'}</td></tr>`).join('');
  const totales = PASOS.map(([, , est]) => lista.reduce((s, g) => s + n(g, est), 0));
  return `<section class="page-head"><div><p class="eyebrow">Reportes</p><h1>Avance por <span class="hl">grupo</span></h1>
      <p class="lead">Cuántos expedientes hay en cada paso del flujo y cuáles llevan ${DIAS_DETENIDO} días o más sin movimiento.</p></div></section>
    <div class="stack">
      <div class="row space-between"><label class="check-inline"><input type="checkbox" data-a="av-solo" ${solo ? 'checked' : ''}> Solo grupos con expedientes detenidos</label>
        <span class="note">Detenido: no está cerrado ni marcado como No aplica, y nadie lo ha movido en ${DIAS_DETENIDO} días.</span></div>
      <div class="tablewrap"><table class="avance"><thead><tr><th>Grupo</th><th class="num">Huéspedes</th>
        ${PASOS.map(([t, sub]) => `<th class="num">${t}${sub ? `<span class="sub">${sub}</span>` : ''}</th>`).join('')}
        <th class="num">Detenidos</th><th>Último movimiento</th></tr></thead>
        <tbody>${filas || `<tr><td colspan="${PASOS.length + 4}" class="empty">${solo ? 'Ningún grupo tiene expedientes detenidos.' : 'Todavía no hay grupos.'}</td></tr>`}</tbody>
        ${lista.length > 1 ? `<tfoot><tr><td>Todos los grupos mostrados</td><td class="num">${lista.reduce((s, g) => s + total(g), 0)}</td>${totales.map((v) => `<td class="num">${v}</td>`).join('')}<td class="num">${lista.reduce((s, g) => s + (g.detenidos || 0), 0)}</td><td></td></tr></tfoot>` : ''}
      </table></div>
    </div>`;
}

// ------------------------------------------------------------------ bitácora general (etapa 5)
const AREAS = ['Administración', 'Grupos', 'Front Desk', 'iPad', 'Crédito', 'Impuestos'];

function consultaBitacora(extra = {}) {
  const f = { ...(ui.bitf || {}), ...extra };
  const q = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => { if (v !== '' && v != null) q.set(k, v); });
  return q.toString();
}

async function cargarBitacora() {
  const [b, g] = await Promise.all([api('GET', `/api/bitacora?${consultaBitacora()}`), api('GET', '/api/grupos')]);
  return { ...b, grupos: g.grupos };
}

async function masBitacora(btn) {
  btn.disabled = true;
  try {
    const b = await api('GET', `/api/bitacora?${consultaBitacora({ pagina: vista.datos.pagina + 1 })}`);
    vista.datos.filas = vista.datos.filas.concat(b.filas);
    vista.datos.hay_mas = b.hay_mas;
    vista.datos.pagina = b.pagina;
    const y = window.scrollY;
    pintar();
    window.scrollTo(0, y);
  } catch (e) {
    btn.disabled = false;
    toast(e.message);
  }
}

function pantallaBitacora({ filas = [], hay_mas, grupos = [] }) {
  if (!['admin', 'impuestos'].includes(rol())) return '<div class="card flat empty">Solo Administración e Impuestos ven la bitácora general.</div>';
  const f = ui.bitf || {};
  const sel = (v, x) => (v === x ? 'selected' : '');
  const linea = (l) => `<li><div>${esc(l.accion)}</div>
      <div class="t">${fmt(l.ts)} · ${esc(l.usuario_nombre)} (${esc(l.rol)})</div>
      ${l.grupos || l.expedientes ? `<div class="t">${l.grupos ? `<a href="#/grupos/${l.grupo_id}">${esc(l.grupos.nombre)}</a>` : ''}${l.expedientes ? ` · <a href="#/expedientes/${l.expediente_id}">${folioExp(l.expedientes.folio)} ${esc(l.expedientes.nombre)} ${esc(l.expedientes.apellidos)}</a>` : ''}</div>` : ''}
      ${l.motivo ? `<span class="m">Motivo: ${esc(l.motivo)}</span>` : ''}</li>`;
  const hayFiltro = Object.values(f).some((v) => v);
  return `<section class="page-head"><div><p class="eyebrow">Auditoría</p><h1>Bitácora <span class="hl">general</span></h1>
      <p class="lead">Todos los movimientos de todos los grupos, del más reciente al más antiguo. Nada de esto se puede editar ni borrar.</p></div>
      <a class="btn" href="/api/bitacora/excel?${consultaBitacora()}" data-descarga>Descargar en Excel</a></section>
    <div class="stack">
      <form class="card flat filtros" data-form="bitacora">
        <div class="field"><label for="bf-desde">Desde</label><input type="date" id="bf-desde" value="${esc(f.desde || '')}"></div>
        <div class="field"><label for="bf-hasta">Hasta</label><input type="date" id="bf-hasta" value="${esc(f.hasta || '')}"></div>
        <div class="field"><label for="bf-area">Área</label><select id="bf-area"><option value="">Todas</option>${AREAS.map((a) => `<option ${sel(f.area, a)}>${a}</option>`).join('')}</select></div>
        <div class="field"><label for="bf-grupo">Grupo</label><select id="bf-grupo"><option value="">Todos</option>${grupos.map((g) => `<option value="${g.id}" ${sel(f.grupo, g.id)}>${esc(g.nombre)}</option>`).join('')}</select></div>
        <div class="field"><label for="bf-persona">Persona</label><input type="text" id="bf-persona" maxlength="60" value="${esc(f.persona || '')}" placeholder="Nombre o parte del nombre"></div>
        <div class="field"><label for="bf-texto">Acción</label><input type="text" id="bf-texto" maxlength="60" value="${esc(f.texto || '')}" placeholder="Ej. Cerró, recaptura, factura"></div>
        <div class="row end full">${hayFiltro ? '<button type="button" class="btn" data-a="bit-limpiar">Quitar filtros</button>' : ''}<button type="submit" class="btn primary">Buscar</button></div>
      </form>
      <div class="card flat stack">
        ${filas.length ? `<ol class="log">${filas.map(linea).join('')}</ol>` : `<p class="muted">${hayFiltro ? 'Ningún movimiento con estos filtros.' : 'Sin movimientos todavía.'}</p>`}
        ${hay_mas ? '<div class="center"><button class="btn" data-a="bit-mas">Ver más movimientos</button></div>' : ''}
      </div>
    </div>`;
}

// ------------------------------------------------------------------ expediente para imprimir (etapa 5)
// Portada del huésped y una hoja por documento vigente, en el orden del archivo físico.
// La bitácora no se imprime: se consulta en la página.
function hojasHuesped(e, g, documentos) {
  const ultimos = FILE_ORDER.map((t) => documentos.filter((d) => d.tipo === t).sort((a, b) => b.version - a.version)[0]).filter(Boolean);
  const hojas = ultimos.map((d) => `<section class="hoja">
      <div class="hoja-t"><b>${DOCS[d.tipo].label}${d.tipo === 'fmm' && d.fmm_tipo ? ` · ${esc(FMM_TIPOS[d.fmm_tipo] || d.fmm_tipo)}` : ''}</b>
        <span>${folioExp(e.folio)} · ${esc(e.nombre)} ${esc(e.apellidos)} · versión ${d.version} · ${fmt(d.capturado_en)}</span></div>
      <img src="/api/documentos/${d.id}/imagen" alt="${DOCS[d.tipo].label}"></section>`).join('');
  return `<section class="hoja portada">
      <p class="eyebrow">Expediente tax free · Fairmont Mayakoba</p>
      <h1>${esc(e.nombre)} ${esc(e.apellidos)}</h1>
      <dl class="kv">
        <dt>Expediente</dt><dd class="mono">${folioExp(e.folio)}</dd>
        <dt>Estado</dt><dd>${ESTADOS[e.estado]}</dd>
        <dt>Nacionalidad</dt><dd>${esc(e.nacionalidad)}</dd>
        <dt>Pasaporte</dt><dd class="mono">${esc(e.pasaporte || 'Sin capturar')}</dd>
        <dt>Vence</dt><dd>${e.pasaporte_vence ? dateTxt(e.pasaporte_vence) : 'Sin registrar'}</dd>
        <dt>Grupo</dt><dd>${esc(g.nombre)} <span class="mono">(${esc(g.codigo_opera || folioGrupo(g.folio))})</span></dd>
        <dt>Estancia del grupo</dt><dd>${dateTxt(g.llegada)} al ${dateTxt(g.salida)}</dd>
        <dt>Documentos</dt><dd>${ultimos.map((d) => DOCS[d.tipo].label).join(', ') || 'Ninguno'}</dd>
      </dl>
    </section>
    ${hojas}`;
}

const impresoPor = () => `<p class="note">Impreso por ${esc(state.perfil.nombre)} el ${fmt(new Date().toISOString())}.</p>`;

function pantallaImprimir({ expediente: e, grupo: g, documentos = [] }) {
  return `<div class="print-bar no-print"><a class="btn" href="#/expedientes/${e.id}">Volver al expediente</a>
      <span class="note">Una hoja por documento, en el orden del archivo físico. Se imprime la versión vigente de cada uno.</span>
      <button class="btn primary" data-a="imprimir">Imprimir</button></div>
    <div class="impreso">${hojasHuesped(e, g, documentos).replace('</dl>', `</dl>${impresoPor()}`)}</div>`;
}

// Todos los huéspedes del grupo en un solo documento: portada del grupo, luego cada expediente
// (portada y documentos). Para guardarlo en PDF se elige "Guardar como PDF" al imprimir.
function pantallaImprimirGrupo({ grupo: g, expedientes = [], documentos = [] }) {
  const porExp = new Map();
  documentos.forEach((d) => (porExp.get(d.expediente_id) || porExp.set(d.expediente_id, []).get(d.expediente_id)).push(d));
  const conDocs = expedientes.filter((e) => porExp.has(e.id));
  const incluidos = ui.impSolo === 'cerrado' ? conDocs.filter((e) => e.estado === 'cerrado') : conDocs;
  const sinDocs = expedientes.length - conDocs.length;
  const nFotos = incluidos.reduce((s, e) => s + porExp.get(e.id).filter((d) => FILE_ORDER.includes(d.tipo)).length, 0);
  const filas = incluidos.map((e) => `<tr><td class="mono">${folioExp(e.folio)}</td><td>${esc(e.apellidos)}, ${esc(e.nombre)}</td><td>${esc(e.nacionalidad)}</td><td>${ESTADOS[e.estado]}</td></tr>`).join('');
  return `<div class="print-bar no-print"><a class="btn" href="#/grupos/${g.id}">Volver al grupo</a>
      <select id="imp-solo" class="anio" aria-label="Expedientes a incluir">
        <option value="" ${ui.impSolo ? '' : 'selected'}>Todos los expedientes con documentos (${conDocs.length})</option>
        <option value="cerrado" ${ui.impSolo === 'cerrado' ? 'selected' : ''}>Solo expedientes cerrados (${conDocs.filter((e) => e.estado === 'cerrado').length})</option>
      </select>
      <span class="note" id="imp-estado">Cargando fotos…</span>
      <button class="btn primary" data-a="imprimir" id="imp-btn" disabled>Imprimir o guardar en PDF</button></div>
    <p class="note no-print">Para guardarlo como archivo, en la ventana de impresión elige <b>Guardar como PDF</b>. Va un expediente tras otro, por apellido, con la versión vigente de cada documento.${sinDocs ? ` ${sinDocs} ${sinDocs === 1 ? 'huésped aún no tiene' : 'huéspedes aún no tienen'} documentos y no se incluyen.` : ''}</p>
    <div class="impreso" data-fotos="${nFotos}">
      <section class="hoja portada">
        <p class="eyebrow">Expedientes tax free · Fairmont Mayakoba</p>
        <h1>${esc(g.nombre)}</h1>
        <dl class="kv">
          <dt>Grupo</dt><dd class="mono">${esc(g.codigo_opera || folioGrupo(g.folio))}</dd>
          <dt>Empresa</dt><dd>${esc(g.empresa)}</dd>
          <dt>Estancia</dt><dd>${dateTxt(g.llegada)} al ${dateTxt(g.salida)}</dd>
          <dt>Expedientes</dt><dd class="num">${incluidos.length}${ui.impSolo === 'cerrado' ? ' (solo cerrados)' : ''}</dd>
        </dl>
        ${incluidos.length ? `<table class="bit-imp"><thead><tr><th>Expediente</th><th>Huésped</th><th>Nacionalidad</th><th>Estado</th></tr></thead><tbody>${filas}</tbody></table>` : '<p>Ningún expediente con este filtro.</p>'}
        ${impresoPor()}
      </section>
      ${incluidos.map((e) => hojasHuesped(e, g, porExp.get(e.id))).join('')}
    </div>`;
}

// Las fotos tardan en llegar en grupos grandes: el botón se activa cuando ya están todas.
function seguirCargaFotos() {
  const imgs = [...root.querySelectorAll('.impreso img')];
  const estado = root.querySelector('#imp-estado');
  const btn = root.querySelector('#imp-btn');
  if (!estado || !btn) return;
  const total = imgs.length;
  const listo = () => {
    const n = imgs.filter((i) => i.complete).length;
    const fallas = imgs.filter((i) => i.complete && !i.naturalWidth).length;
    if (n < total) {
      estado.textContent = `Cargando fotos: ${n} de ${total}…`;
      return;
    }
    estado.textContent = fallas ? `${fallas} ${fallas === 1 ? 'foto no se pudo cargar' : 'fotos no se pudieron cargar'}. Recarga la página antes de imprimir.` : `${total} ${total === 1 ? 'foto lista' : 'fotos listas'}.`;
    btn.disabled = false;
  };
  imgs.forEach((i) => {
    i.addEventListener('load', listo);
    i.addEventListener('error', listo);
  });
  listo();
}

// ------------------------------------------------------------------ usuarios (Administración)
function pantallaUsuarios({ usuarios = [], bitacora = [] }) {
  if (rol() !== 'admin') return '<div class="card flat empty">Solo Administración puede ver los usuarios.</div>';
  const yo = state.perfil.id;
  const filas = usuarios.map((u) => `<tr class="${u.activo ? '' : 'inactivo'}">
      <td><b>${esc(u.nombre)}</b>${u.id === yo ? ' <span class="muted">(tú)</span>' : ''}<span class="sub">${esc(u.email)}</span></td>
      <td>${esc(ROLES[u.rol].label)} <span class="muted">· ${ROLES[u.rol].where}</span></td>
      <td>${u.activo ? '<span class="pill done"><i></i>Activo</span>' : '<span class="pill na"><i></i>Desactivado</span>'}</td>
      <td class="muted num">${u.ultimo_acceso ? fmt(u.ultimo_acceso) : 'Nunca ha entrado'}</td>
      <td class="tdact">${u.id === yo ? '' : `<button class="btn sm" data-a="usr-area" data-u="${u.id}">Cambiar área</button>
        <button class="btn sm" data-a="usr-clave" data-u="${u.id}">Restablecer contraseña</button>
        ${u.activo ? `<button class="btn sm warn" data-a="usr-estado" data-u="${u.id}" data-v="0">Desactivar</button>` : `<button class="btn sm" data-a="usr-estado" data-u="${u.id}" data-v="1">Reactivar</button>`}`}</td></tr>`).join('');
  return `<section class="page-head"><div><p class="eyebrow">Administración</p><h1>Usuarios y <span class="hl">áreas</span></h1>
      <p class="lead">Cada persona entra con su propio usuario y ve solo el módulo de su área. Los usuarios no se borran: se desactivan, y todo cambio queda en la bitácora.</p></div>
      <button class="btn primary" data-a="usr-nuevo">Dar de alta un usuario</button></section>
    <div class="stack">
      <div class="tablewrap"><table><thead><tr><th>Usuario</th><th>Área</th><th>Estado</th><th>Último acceso</th><th></th></tr></thead>
        <tbody>${filas || '<tr><td colspan="5" class="empty">Sin usuarios.</td></tr>'}</tbody></table></div>
      <div class="card flat stack"><div class="row space-between"><h3>Bitácora de usuarios</h3><span class="note">No se puede editar ni borrar</span></div>
        ${bitacora.length ? `<ol class="log">${bitacora.map(lineaLog).join('')}</ol>` : '<p class="muted">Sin movimientos todavía.</p>'}</div>
    </div>`;
}

function generarClave() {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
  const nums = '23456789';
  const todo = letras + nums;
  const r = crypto.getRandomValues(new Uint32Array(12));
  let c = Array.from(r, (n) => todo[n % todo.length]);
  c[0] = letras[r[0] % letras.length];
  c[11] = nums[r[11] % nums.length];
  return c.join('');
}

const campoClave = (id, label) => `<div class="field"><label for="${id}">${label}</label>
  <div class="row nowrap"><input type="text" id="${id}" maxlength="72" autocomplete="new-password" spellcheck="false" class="mono-in" required><button type="button" class="btn sm" data-a="gen-clave" data-t="${id}">Generar</button></div>
  <span class="note">Al menos 10 caracteres, con letras y números. Entrégala a la persona en privado; podrá cambiarla desde "Cambiar contraseña".</span></div>`;

const opcionesRol = (sel) => Object.entries(ROLES).map(([k, r]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${esc(r.label)} (${r.where})</option>`).join('');

async function enviarUsuario(f, url, datos, msg) {
  const err = f.querySelector('.err');
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await api('POST', url, datos);
    state.modal = null;
    toast(msg);
    recargar();
  } catch (e) {
    err.hidden = false;
    err.textContent = e.message;
    btn.disabled = false;
  }
}

async function enviarMiClave(f) {
  const err = f.querySelector('.err');
  const actual = f.querySelector('#mc-actual').value;
  const nueva = f.querySelector('#mc-nueva').value;
  const otra = f.querySelector('#mc-otra').value;
  const fallo = (m) => {
    err.hidden = false;
    err.textContent = m;
  };
  if (!actual || !nueva) return fallo('Escribe tu contraseña actual y la nueva.');
  if (nueva !== otra) return fallo('La nueva contraseña no coincide en los dos campos.');
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await api('POST', '/api/mi-clave', { actual, nueva });
    cerrarModal();
    toast('Contraseña cambiada. Úsala la próxima vez que entres.');
  } catch (e) {
    fallo(e.message);
    btn.disabled = false;
  }
}

// ------------------------------------------------------------------ modales
function opcionesPaises() {
  const frec = PAISES_FREC.map((c) => PAISES.find((p) => p[1] === c)).filter(Boolean);
  return `<option value="">Elige un país</option><optgroup label="Más frecuentes">${frec.map((p) => `<option value="${p[1]}">${esc(p[0])}</option>`).join('')}</optgroup><optgroup label="Todos los países">${PAISES.map((p) => `<option value="${p[1]}">${esc(p[0])}</option>`).join('')}</optgroup>`;
}

function qrSVG(codigo) {
  const q = qrcode(0, 'M');
  q.addData(codigo);
  q.make();
  return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true, alt: `Código QR ${codigo}` });
}

function modalHTML() {
  const m = state.modal;
  if (!m) return '';
  let inner = '';
  if (m.kind === 'altahues') {
    const g = vista.datos.grupo;
    inner = `<form class="modal" data-form="altahues" novalidate><h2>Dar de alta un huésped</h2><p class="muted">${esc(g.nombre)}</p>
      <div class="fgrid">
        <div class="field"><label for="h-nom">Nombre(s)</label><input type="text" id="h-nom" maxlength="120" required autocomplete="off"></div>
        <div class="field"><label for="h-ape">Apellidos</label><input type="text" id="h-ape" maxlength="120" required autocomplete="off"></div>
        <div class="field"><label for="h-nac">Nacionalidad</label><select id="h-nac" required>${opcionesPaises()}</select>
          <span class="note" id="h-nac-mx" hidden>Los huéspedes de nacionalidad mexicana no aplican para tax free; Grupos lo marcará como No aplica.</span></div>
        <div class="field"><label for="h-pas">No. de pasaporte <span class="muted">(opcional)</span></label><input type="text" id="h-pas" maxlength="30" autocomplete="off"></div>
        <div class="field"><label for="h-vence">Vencimiento del pasaporte <span class="muted">(opcional)</span></label><input type="date" id="h-vence"></div>
      </div>
      <label class="toggle"><input type="checkbox" id="h-qr" checked> Generar su código QR al guardar</label>
      <p class="err" id="h-err" hidden></p>
      <div class="row end"><button type="button" class="btn" data-a="cerrar-modal">Cancelar</button><button type="submit" class="btn primary">Dar de alta</button></div></form>`;
  }
  if (m.kind === 'ofrecer-import') {
    inner = `<div class="modal" role="dialog" aria-label="Dar de alta desde la rooming list"><h2>¿Dar de alta a los huéspedes de esta rooming list?</h2>
      <p class="muted">${esc(m.file.name)}</p>
      <p>Verás una vista previa antes de confirmar: ahí eliges la nacionalidad y revisas las filas repetidas o con problemas.</p>
      <div class="row end"><button class="btn" data-a="cerrar-modal">Ahora no</button><button class="btn primary" data-a="ir-import">Ver vista previa</button></div></div>`;
  }
  if (m.kind === 'qr') {
    const restante = new Date(m.vence_en).getTime() - Date.now();
    inner = `<div class="modal" role="dialog" aria-label="Código de captura"><h2>Código de captura</h2>
      <div class="qrbox">${qrSVG(m.codigo)}<div class="stack gap-sm"><b>${esc(m.nombre)}</b><span class="muted">${esc(m.grupo)}</span>
        <span class="code">${esc(m.codigo)}</span><span class="timer ${restante < 180000 ? 'low' : ''}" data-vence="${esc(m.vence_en)}">Vence en ${mmss(restante)}</span>
        <p class="note">Escanéalo en la estación de captura o escribe el código. Sirve una sola vez. El código no contiene datos del huésped.</p></div></div>
      <div class="row end"><button class="btn" data-a="cerrar-modal">Cerrar</button></div></div>`;
  }
  if (m.kind === 'zoom') {
    inner = `<div class="modal wide" role="dialog" aria-label="${esc(DOCS[m.t].label)}"><div class="row space-between"><h2>${esc(DOCS[m.t].label)}</h2>
      <div class="zoom-tools"><button class="btn sm" data-a="zoom-real" aria-pressed="${!!m.full}">${m.full ? 'Ajustar a la pantalla' : 'Tamaño real'}</button><a class="btn sm" href="/api/documentos/${m.d}/imagen" target="_blank" rel="noopener">Abrir en otra pestaña</a><button class="btn sm" data-a="cerrar-modal">Cerrar</button></div></div>
      <div class="zoom-wrap ${m.full ? 'full' : ''}"><img class="zoom-img" src="/api/documentos/${m.d}/imagen" alt="${esc(DOCS[m.t].label)}"></div></div>`;
  }
  if (m.kind === 'motivo') {
    const M = MOTIVOS[m.op];
    const e = vista.datos.expediente;
    inner = `<form class="modal" data-form="motivo" novalidate><h2>${M.t}</h2><p class="muted">${esc(e.nombre)} ${esc(e.apellidos)} · <span class="mono">${folioExp(e.folio)}</span></p>
      <div class="field"><label for="m-sel">Motivo</label><select id="m-sel" required><option value="">Elige un motivo</option>${M.list.map((x) => `<option>${esc(x)}</option>`).join('')}<option value="__otro">Otro motivo</option></select></div>
      ${m.op === 'recaptura' ? `<div class="field"><span class="flabel">Documentos a recapturar</span><div class="checks">${DOC_ORDER.map((t) => `<label><input type="checkbox" name="rd" value="${t}"><span>${DOCS[t].label}</span></label>`).join('')}</div></div>` : ''}
      <div class="field"><label for="m-det">Detalle <span class="muted">(obligatorio si eliges "Otro motivo")</span></label><textarea id="m-det" maxlength="400"></textarea></div>
      <p class="note">El motivo queda en la bitácora del expediente y no se puede borrar.</p>
      <p class="err" id="m-err" hidden></p>
      <div class="row end"><button type="button" class="btn" data-a="cerrar-modal">Cancelar</button><button type="submit" class="btn primary" id="m-ok" disabled>${M.btn}</button></div></form>`;
  }
  if (m.kind === 'monto') {
    const g = vista.datos.grupo;
    inner = `<form class="modal" data-form="monto" novalidate><h2>Registrar monto final de devolución</h2><p class="muted">${esc(g.nombre)}</p>
      <div class="field"><label for="mo-val">Monto en USD, tal como lo autorizó Cuentas por pagar</label><input type="text" id="mo-val" inputmode="decimal" maxlength="30" placeholder="Ej. 18,450.00" required></div>
      <div class="field"><label for="mo-nota">Quién autorizó y referencia</label><textarea id="mo-nota" maxlength="500" required placeholder="Ej. Autorizado por ADOF, oficio CP-121"></textarea></div>
      ${vista.datos.montos?.length ? '<p class="note">El monto anterior seguirá visible como versión anterior.</p>' : ''}
      <p class="err" id="mo-err" hidden></p>
      <div class="row end"><button type="button" class="btn" data-a="cerrar-modal">Cancelar</button><button type="submit" class="btn primary">Registrar monto</button></div></form>`;
  }
  if (m.kind === 'factura') {
    const g = vista.datos.grupo;
    inner = `<form class="modal" data-form="factura" novalidate><h2>Registrar folio de factura</h2><p class="muted">${esc(g.nombre)}</p>
      <div class="field"><label for="fa-tipo">¿Qué ampara esta factura?</label><select id="fa-tipo"><option value="evento">Días del evento (estímulo, sin traslado de IVA)</option><option value="personal">Días personales o consumos no vinculados (16%)</option></select></div>
      <div class="field"><label for="fa-folio">Folio de la factura emitida</label><input type="text" id="fa-folio" maxlength="60" required placeholder="Ej. FMK-A 20931"></div>
      <p class="err" id="fa-err" hidden></p>
      <div class="row end"><button type="button" class="btn" data-a="cerrar-modal">Cancelar</button><button type="submit" class="btn primary">Registrar folio</button></div></form>`;
  }
  if (m.kind === 'evento') {
    const ev = vista.datos.evento || [];
    inner = `<form class="modal wide-form" data-form="evento" novalidate><h2>Datos del evento</h2><p class="muted">${esc(vista.datos.grupo.nombre)}</p>
      ${camposEvento('ev', ev[ev.length - 1])}
      ${ev.length ? '<p class="note">Los datos anteriores quedan en la bitácora del grupo.</p>' : ''}
      <p class="err" id="ev-err" hidden></p>
      <div class="row end"><button type="button" class="btn" data-a="cerrar-modal">Cancelar</button><button type="submit" class="btn primary">Guardar</button></div></form>`;
  }
  if (m.kind === 'editgrupo') {
    const g = vista.datos.grupo;
    const exps = vista.datos.expedientes || [];
    const cerrados = exps.filter((e) => e.estado === 'cerrado').length;
    const avanzados = exps.filter((e) => ['val_credito', 'rev_impuestos', 'dev_credito'].includes(e.estado)).length;
    const fijo = cerrados ? 'disabled' : '';
    const minLl = g.llegada > hoyHotel() ? `min="${hoyHotel()}"` : '';
    inner = `<form class="modal wide-form" data-form="editgrupo" novalidate><h2>Editar datos del grupo</h2><p class="muted">${esc(g.nombre)} · <span class="mono">${esc(g.codigo_opera || folioGrupo(g.folio))}</span></p>
      ${cerrados ? `<div class="notice">Este grupo ya tiene ${cerrados} ${cerrados === 1 ? 'expediente cerrado' : 'expedientes cerrados'} por Impuestos, así que la empresa y las fechas de estancia ya no se pueden cambiar. Si hay un error en ellas, Impuestos debe reabrir esos expedientes primero.</div>`
        : avanzados ? `<div class="notice">${avanzados} ${avanzados === 1 ? 'expediente ya está' : 'expedientes ya están'} en Crédito o Impuestos. Verán el cambio en la bitácora del grupo.</div>` : ''}
      <div class="fgrid">
        <div class="field full"><label for="eg-nombre">Nombre del grupo</label><input type="text" id="eg-nombre" required maxlength="200" value="${esc(g.nombre)}"></div>
        <div class="field"><label for="eg-empresa">Empresa</label><input type="text" id="eg-empresa" required maxlength="200" value="${esc(g.empresa)}" ${fijo}></div>
        <div class="field"><label for="eg-contacto">Contacto del grupo</label><input type="text" id="eg-contacto" maxlength="200" value="${esc(g.contacto || '')}" placeholder="Nombre y cargo"></div>
        <div class="field"><label for="eg-llegada">Llegada oficial</label><input type="date" id="eg-llegada" required value="${esc(g.llegada)}" ${minLl} ${fijo}></div>
        <div class="field"><label for="eg-salida">Salida oficial</label><input type="date" id="eg-salida" required value="${esc(g.salida)}" ${fijo}></div>
        <div class="field"><label for="eg-est">Huéspedes estimados</label><input type="number" id="eg-est" min="1" max="5000" value="${g.estimados ?? ''}"></div>
        <div class="field"><label for="eg-codigo">Código de grupo en Opera</label><input type="text" id="eg-codigo" maxlength="60" value="${esc(g.codigo_opera || '')}"></div>
        <div class="field full"><label for="eg-motivo">Motivo del cambio</label><input type="text" id="eg-motivo" required maxlength="500" placeholder="Ej. Error de captura en la empresa; contrato dice Northwind Medical Inc."></div>
      </div>
      <p class="note">Cada dato que cambies queda en la bitácora del grupo con el valor anterior, el nuevo, tu nombre y el motivo.</p>
      <p class="err" id="eg-err" hidden></p>
      <div class="row end"><button type="button" class="btn" data-a="cerrar-modal">Cancelar</button><button type="submit" class="btn primary">Guardar cambios</button></div></form>`;
  }
  if (m.kind === 'cancelgrupo') {
    const g = vista.datos.grupo;
    const n = (vista.datos.expedientes || []).length;
    const re = m.accion === 'reactivar';
    inner = `<form class="modal" data-form="cancelgrupo" novalidate><h2>${re ? 'Reactivar grupo' : 'Cancelar grupo'}</h2><p class="muted">${esc(g.nombre)} · <span class="mono">${esc(g.codigo_opera || folioGrupo(g.folio))}</span></p>
      ${re ? '<p>El grupo vuelve a su etapa según sus fechas y Front Desk podrá volver a dar de alta huéspedes y generar QR.</p>'
        : `<p>El grupo pasa a la pestaña Cancelados. No se borra nada${n ? `: sus ${n} ${n === 1 ? 'huésped' : 'huéspedes'} y sus documentos se conservan` : ''}. Front Desk deja de verlo y ya no se pueden dar de alta huéspedes ni generar QR.</p>`}
      <div class="field"><label for="cg-motivo">Motivo ${re ? 'de la reactivación' : 'de la cancelación'}</label><textarea id="cg-motivo" required maxlength="500" rows="3" placeholder="${re ? 'Ej. El cliente confirmó de nuevo el evento.' : 'Ej. El cliente canceló el evento por cambio de sede.'}"></textarea></div>
      <p class="note">Queda en la bitácora del grupo con tu nombre, la fecha y el motivo. ${re ? '' : 'Se puede reactivar después si fue un error.'}</p>
      <p class="err" id="cg-err" hidden></p>
      <div class="row end"><button type="button" class="btn" data-a="cerrar-modal">Volver</button><button type="submit" class="btn ${re ? 'primary' : 'warn'}">${re ? 'Reactivar grupo' : 'Cancelar grupo'}</button></div></form>`;
  }
  if (m.kind === 'folio-maestra') {
    inner = `<form class="modal" data-form="folio-maestra" novalidate><h2>Folio de Opera de la cuenta maestra</h2><p class="muted">${esc(vista.datos.grupo.nombre)}</p>
      <div class="field"><label for="fm-folio">Folio de la cuenta maestra con la devolución</label><input type="text" id="fm-folio" maxlength="60" required autocomplete="off"></div>
      <div class="field"><label for="fm-nota">Nota <span class="muted">(opcional)</span></label><textarea id="fm-nota" maxlength="500" placeholder="Ej. Ajuste aplicado el 28 nov"></textarea></div>
      ${(vista.datos.folios_maestra || []).length ? '<p class="note">El folio anterior seguirá visible.</p>' : ''}
      <p class="err" id="fm-err" hidden></p>
      <div class="row end"><button type="button" class="btn" data-a="cerrar-modal">Cancelar</button><button type="submit" class="btn primary">Registrar folio</button></div></form>`;
  }
  if (m.kind === 'doc-extra') {
    inner = `<form class="modal" data-form="doc-extra" novalidate><h2>Documento extraordinario</h2><p class="muted">${esc(vista.datos.grupo.nombre)}</p>
      <div class="field"><label for="dx-desc">¿Qué es y por qué se agrega?</label><textarea id="dx-desc" maxlength="500" required placeholder="Ej. Nota de crédito por cargo duplicado en la cuenta maestra"></textarea></div>
      <div class="field"><label for="dx-file">Archivo</label><input type="file" id="dx-file" accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png" required>
        <span class="note">PDF, Excel o foto, de menos de 20 MB.</span></div>
      <p class="note">La descripción queda junto al archivo y en la bitácora del grupo.</p>
      <p class="err" id="dx-err" hidden></p>
      <div class="row end"><button type="button" class="btn" data-a="cerrar-modal">Cancelar</button><button type="submit" class="btn primary">Subir documento</button></div></form>`;
  }
  if (m.kind === 'riesgo') {
    const R = RIESGOS[m.k];
    inner = `<form class="modal" data-form="riesgo" novalidate><h2>${R.label} · ${R.sub}</h2><p class="muted">${esc(vista.datos.grupo.nombre)}</p>
      <p class="note">Ejemplos: ${esc(R.ej)}</p>
      <div class="field"><label for="ri-nota">¿Por qué este nivel?</label><textarea id="ri-nota" maxlength="500" required placeholder="Ej. Convención con agenda formal y contrato; 3 habitaciones compartidas con una sola firma."></textarea></div>
      <p class="note">Queda en la bitácora del grupo con tu nombre.</p>
      <p class="err" id="ri-err" hidden></p>
      <div class="row end"><button type="button" class="btn" data-a="cerrar-modal">Cancelar</button><button type="submit" class="btn primary">Registrar</button></div></form>`;
  }
  if (m.kind === 'edithues') {
    const e = vista.datos.expediente;
    inner = `<form class="modal" data-form="edithues" novalidate><h2>Corregir datos del huésped</h2><p class="muted">${esc(e.nombre)} ${esc(e.apellidos)} · <span class="mono">${folioExp(e.folio)}</span></p>
      <div class="fgrid">
        <div class="field"><label for="eh-nom">Nombre(s)</label><input type="text" id="eh-nom" maxlength="120" required autocomplete="off" value="${esc(e.nombre)}"></div>
        <div class="field"><label for="eh-ape">Apellidos</label><input type="text" id="eh-ape" maxlength="120" required autocomplete="off" value="${esc(e.apellidos)}"></div>
        <div class="field"><label for="eh-nac">Nacionalidad</label><select id="eh-nac" required>${opcionesPaises().replace(`value="${e.nacionalidad_codigo}"`, `value="${e.nacionalidad_codigo}" selected`)}</select>
          <span class="note" id="eh-nac-mx" ${e.nacionalidad_codigo === 'MEX' ? '' : 'hidden'}>Los huéspedes de nacionalidad mexicana no aplican para tax free.</span></div>
        <div class="field"><label for="eh-pas">No. de pasaporte <span class="muted">(opcional)</span></label><input type="text" id="eh-pas" maxlength="30" autocomplete="off" value="${esc(e.pasaporte || '')}"></div>
        <div class="field full"><label for="eh-motivo">Motivo del cambio</label><input type="text" id="eh-motivo" required maxlength="500" placeholder="Ej. Se importó mal; el pasaporte dice Michael James"></div>
      </div>
      <p class="note">Escribe el nombre tal como aparece en el pasaporte. Cada dato que cambies queda en la bitácora del expediente con el valor anterior, el nuevo, tu nombre y el motivo.</p>
      <p class="err" id="eh-err" hidden></p>
      <div class="row end"><button type="button" class="btn" data-a="cerrar-modal">Cancelar</button><button type="submit" class="btn primary">Guardar cambios</button></div></form>`;
  }
  if (m.kind === 'vence') {
    const e = vista.datos.expediente;
    inner = `<form class="modal" data-form="vence" novalidate><h2>Vencimiento del pasaporte</h2><p class="muted">${esc(e.nombre)} ${esc(e.apellidos)} · <span class="mono">${folioExp(e.folio)}</span></p>
      <div class="field"><label for="ve-fecha">Fecha de vencimiento, tal como aparece en el pasaporte</label><input type="date" id="ve-fecha" required value="${esc(e.pasaporte_vence || '')}"></div>
      <p class="note">El pasaporte debe estar vigente en las fechas de la estancia. El cambio queda en la bitácora.</p>
      <p class="err" id="ve-err" hidden></p>
      <div class="row end"><button type="button" class="btn" data-a="cerrar-modal">Cancelar</button><button type="submit" class="btn primary">Guardar</button></div></form>`;
  }
  const usr = m.u ? (vista.datos.usuarios || []).find((x) => x.id === m.u) : null;
  if (m.kind === 'usr-nuevo') {
    inner = `<form class="modal" data-form="usr-nuevo" novalidate autocomplete="off"><h2>Dar de alta un usuario</h2>
      <div class="field"><label for="un-nombre">Nombre completo</label><input type="text" id="un-nombre" maxlength="120" required></div>
      <div class="field"><label for="un-email">Correo</label><input type="text" id="un-email" maxlength="200" inputmode="email" autocapitalize="off" spellcheck="false" required placeholder="nombre@fairmont.com"></div>
      <div class="field"><label for="un-rol">Área</label><select id="un-rol" required><option value="">Elige el área</option>${opcionesRol()}</select>
        <span class="note">Las estaciones de captura (iPad) llevan un usuario propio, por ejemplo "Estación Lobby 2".</span></div>
      ${campoClave('un-clave', 'Contraseña inicial')}
      <p class="err" hidden></p>
      <div class="row end"><button type="button" class="btn" data-a="cerrar-modal">Cancelar</button><button type="submit" class="btn primary">Dar de alta</button></div></form>`;
  }
  if (m.kind === 'usr-area' && usr) {
    inner = `<form class="modal" data-form="usr-area" novalidate><h2>Cambiar área</h2><p class="muted">${esc(usr.nombre)} · ${esc(usr.email)}</p>
      <div class="field"><label for="ua-rol">Nueva área</label><select id="ua-rol">${opcionesRol(usr.rol)}</select></div>
      <p class="note">Al cambiar de área verá solo el módulo de la nueva área desde su siguiente pantalla.</p>
      <p class="err" hidden></p>
      <div class="row end"><button type="button" class="btn" data-a="cerrar-modal">Cancelar</button><button type="submit" class="btn primary">Cambiar área</button></div></form>`;
  }
  if (m.kind === 'usr-clave' && usr) {
    inner = `<form class="modal" data-form="usr-clave" novalidate autocomplete="off"><h2>Restablecer contraseña</h2><p class="muted">${esc(usr.nombre)} · ${esc(usr.email)}</p>
      ${campoClave('uc-clave', 'Nueva contraseña')}
      <p class="note">Se cerrarán las sesiones que tenga abiertas.</p>
      <p class="err" hidden></p>
      <div class="row end"><button type="button" class="btn" data-a="cerrar-modal">Cancelar</button><button type="submit" class="btn primary">Restablecer</button></div></form>`;
  }
  if (m.kind === 'usr-estado' && usr) {
    inner = m.v
      ? `<form class="modal" data-form="usr-estado" novalidate><h2>Reactivar usuario</h2><p class="muted">${esc(usr.nombre)} · ${esc(usr.email)}</p>
        <p>Podrá volver a entrar con su contraseña actual, en el área ${esc(ROLES[usr.rol].label)}.</p><p class="err" hidden></p>
        <div class="row end"><button type="button" class="btn" data-a="cerrar-modal">Cancelar</button><button type="submit" class="btn primary">Reactivar</button></div></form>`
      : `<form class="modal" data-form="usr-estado" novalidate><h2>Desactivar usuario</h2><p class="muted">${esc(usr.nombre)} · ${esc(usr.email)}</p>
        <div class="field"><label for="ue-motivo">Motivo</label><select id="ue-motivo"><option value="">Elige un motivo</option><option>Ya no trabaja en el hotel</option><option>Cambió de departamento</option><option>Estación de captura fuera de servicio</option><option>Acceso comprometido</option></select></div>
        <p class="note">No se borra nada: su nombre sigue en las bitácoras. Se cierran sus sesiones abiertas y no podrá entrar hasta que lo reactives.</p>
        <p class="err" hidden></p>
        <div class="row end"><button type="button" class="btn" data-a="cerrar-modal">Cancelar</button><button type="submit" class="btn warn">Desactivar</button></div></form>`;
  }
  if (m.kind === 'miclave') {
    inner = `<form class="modal" data-form="miclave" novalidate><h2>Cambiar mi contraseña</h2><p class="muted">${esc(state.perfil.nombre)}</p>
      <div class="field"><label for="mc-actual">Contraseña actual</label><input type="password" id="mc-actual" autocomplete="current-password" required></div>
      <div class="field"><label for="mc-nueva">Nueva contraseña</label><input type="password" id="mc-nueva" autocomplete="new-password" maxlength="72" required>
        <span class="note">Al menos 10 caracteres, con letras y números.</span></div>
      <div class="field"><label for="mc-otra">Repite la nueva contraseña</label><input type="password" id="mc-otra" autocomplete="new-password" maxlength="72" required></div>
      <p class="err" hidden></p>
      <div class="row end"><button type="button" class="btn" data-a="cerrar-modal">Cancelar</button><button type="submit" class="btn primary">Cambiar contraseña</button></div></form>`;
  }
  return `<div class="scrim" data-a="scrim">${inner}</div>`;
}

function abrirModal(m) {
  state.modal = m;
  document.querySelector('.scrim')?.remove();
  root.insertAdjacentHTML('beforeend', modalHTML());
  root.querySelector('.scrim input, .scrim select, .scrim textarea')?.focus();
}
function cerrarModal() {
  const recargarAlCerrar = state.modal?.recargar;
  state.modal = null;
  document.querySelector('.scrim')?.remove();
  if (recargarAlCerrar) recargar();
}

async function mostrarQR(expId) {
  try {
    const { codigo } = await api('POST', `/api/expedientes/${expId}/codigo`);
    let nombre = '';
    let grupo = '';
    const d = vista.datos;
    if (d.expedientes) {
      const e = d.expedientes.find((x) => x.id === expId);
      nombre = `${e.nombre} ${e.apellidos}`;
      grupo = d.grupo.nombre;
    } else {
      nombre = `${d.expediente.nombre} ${d.expediente.apellidos}`;
      grupo = d.grupo.nombre;
    }
    abrirModal({ kind: 'qr', codigo: codigo.codigo, vence_en: codigo.vence_en, nombre, grupo, recargar: codigo.nuevo });
  } catch (e) {
    toast(e.message);
  }
}

async function enviarHuesped(f) {
  const v = (id) => f.querySelector('#' + id).value.trim();
  const err = f.querySelector('#h-err');
  const codigoPais = v('h-nac');
  const pais = PAISES.find((p) => p[1] === codigoPais);
  if (!v('h-nom') || !v('h-ape') || !pais) {
    err.hidden = false;
    err.textContent = 'Llena nombre, apellidos y nacionalidad.';
    return;
  }
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  const g = vista.datos.grupo;
  try {
    const r = await api('POST', `/api/grupos/${g.id}/huespedes`, {
      nombre: v('h-nom'), apellidos: v('h-ape'), nacionalidad_codigo: pais[1], nacionalidad: pais[0],
      pasaporte: v('h-pas'), pasaporte_vence: v('h-vence') || null, generar_qr: f.querySelector('#h-qr').checked,
    });
    toast('Huésped dado de alta.');
    if (r.codigo) {
      state.modal = null;
      abrirModal({ kind: 'qr', codigo: r.codigo.codigo, vence_en: r.codigo.vence_en, nombre: `${v('h-nom')} ${v('h-ape')}`, grupo: g.nombre, recargar: true });
    } else {
      cerrarModal();
      recargar();
    }
  } catch (e) {
    err.hidden = false;
    err.textContent = e.message;
    btn.disabled = false;
  }
}

// ------------------------------------------------------------------ eventos
document.addEventListener('click', (ev) => {
  if (!state.perfil || state.perfil.rol === 'ipad') return;
  const el = ev.target.closest('[data-a]');
  if (!el) return;
  const d = el.dataset;
  if (vista?.ruta.s === 'importar' && vista.datos && importar.manejarClic(d, vista.datos)) return;
  switch (d.a) {
    case 'scrim':
      if (ev.target === el) cerrarModal();
      break;
    case 'cerrar-modal':
      cerrarModal();
      break;
    case 'altahues':
      abrirModal({ kind: 'altahues' });
      break;
    case 'ir-import': {
      const file = state.modal?.file;
      const id = vista.datos.grupo.id;
      cerrarModal();
      if (file) importar.prepararArchivo(file);
      location.hash = `#/grupos/${id}/importar`;
      break;
    }
    case 'qr':
      mostrarQR(d.e);
      break;
    case 'filtro':
      ui.filtro[vista.datos.grupo.id] = d.k;
      pintar();
      break;
    case 'ver':
      ui.ver[`${vista.ruta.id}:${d.t}`] = +d.v;
      pintar();
      break;
    case 'zoom':
      abrirModal({ kind: 'zoom', d: d.d, t: d.t });
      break;
    case 'motivo':
      abrirModal({ kind: 'motivo', op: d.op });
      break;
    case 'monto':
      abrirModal({ kind: 'monto' });
      break;
    case 'factura':
      abrirModal({ kind: 'factura' });
      break;
    case 'evento':
      abrirModal({ kind: 'evento' });
      break;
    case 'folio-maestra':
    case 'doc-extra':
      abrirModal({ kind: d.a });
      break;
    case 'cancelgrupo':
      abrirModal({ kind: 'cancelgrupo', accion: d.k });
      break;
    case 'editgrupo':
      abrirModal({ kind: 'editgrupo' });
      break;
    case 'etapa':
      ui.tablero = d.k;
      pintar();
      break;
    case 'riesgo':
      abrirModal({ kind: 'riesgo', k: d.k });
      break;
    case 'vence':
      abrirModal({ kind: 'vence' });
      break;
    case 'edithues':
      abrirModal({ kind: 'edithues' });
      break;
    case 'usr-nuevo':
      abrirModal({ kind: 'usr-nuevo' });
      break;
    case 'usr-area':
    case 'usr-clave':
      abrirModal({ kind: d.a, u: d.u });
      break;
    case 'usr-estado':
      abrirModal({ kind: 'usr-estado', u: d.u, v: d.v === '1' });
      break;
    case 'miclave':
      abrirModal({ kind: 'miclave' });
      break;
    case 'av-solo':
      ui.avSolo = el.checked;
      pintar();
      break;
    case 'bit-mas':
      masBitacora(el);
      break;
    case 'bit-limpiar':
      ui.bitf = {};
      recargar(false);
      break;
    case 'imprimir':
      window.print();
      break;
    case 'zipgrupo':
      abrirDescarga(vista.datos.grupo, vista.datos.expedientes.length);
      break;
    case 'gen-clave': {
      const inp = document.getElementById(d.t);
      if (inp) inp.value = generarClave();
      break;
    }
    case 'accion':
      ejecutar(d.op, null, null, el);
      break;
    case 'zoom-real':
      state.modal.full = !state.modal.full;
      abrirModal(state.modal);
      break;
  }
});

document.addEventListener('submit', (ev) => {
  if (!state.perfil || state.perfil.rol === 'ipad') return;
  const f = ev.target.closest('[data-form]');
  if (!f) return;
  ev.preventDefault();
  if (f.dataset.form === 'alta') enviarAlta(f);
  if (f.dataset.form === 'altahues') enviarHuesped(f);
  if (f.dataset.form === 'motivo') enviarMotivo(f);
  if (f.dataset.form === 'monto') enviarGrupo(f, 'monto', { valor: f.querySelector('#mo-val').value.trim(), nota: f.querySelector('#mo-nota').value.trim() }, 'Monto registrado.');
  if (f.dataset.form === 'factura') enviarGrupo(f, 'factura', { folio: f.querySelector('#fa-folio').value.trim(), tipo: f.querySelector('#fa-tipo').value }, 'Folio registrado.');
  if (f.dataset.form === 'evento') enviarEvento(f);
  if (f.dataset.form === 'editgrupo') enviarEdicionGrupo(f);
  if (f.dataset.form === 'cancelgrupo') enviarCancelacionGrupo(f);
  if (f.dataset.form === 'folio-maestra') enviarGrupo(f, 'folio-maestra', { folio: f.querySelector('#fm-folio').value.trim(), nota: f.querySelector('#fm-nota').value.trim() || ' ' }, 'Folio registrado.');
  if (f.dataset.form === 'doc-extra') enviarDocExtra(f);
  if (f.dataset.form === 'riesgo') enviarGrupo(f, 'riesgo', { nivel: state.modal.k, nota: f.querySelector('#ri-nota').value.trim() }, 'Riesgo registrado.');
  if (f.dataset.form === 'vence') enviarVence(f);
  if (f.dataset.form === 'edithues') enviarEdicionHuesped(f);
  if (f.dataset.form === 'miclave') enviarMiClave(f);
  if (f.dataset.form === 'bitacora') {
    const v = (id) => f.querySelector(id).value.trim();
    ui.bitf = { desde: v('#bf-desde'), hasta: v('#bf-hasta'), area: v('#bf-area'), grupo: v('#bf-grupo'), persona: v('#bf-persona'), texto: v('#bf-texto') };
    recargar(false);
  }
  if (f.dataset.form === 'usr-nuevo') {
    enviarUsuario(f, '/api/usuarios', {
      nombre: f.querySelector('#un-nombre').value.trim(), email: f.querySelector('#un-email').value.trim(),
      rol: f.querySelector('#un-rol').value, clave: f.querySelector('#un-clave').value,
    }, 'Usuario dado de alta.');
  }
  if (f.dataset.form === 'usr-area') enviarUsuario(f, `/api/usuarios/${state.modal.u}/area`, { rol: f.querySelector('#ua-rol').value }, 'Área cambiada.');
  if (f.dataset.form === 'usr-clave') enviarUsuario(f, `/api/usuarios/${state.modal.u}/clave`, { clave: f.querySelector('#uc-clave').value }, 'Contraseña restablecida.');
  if (f.dataset.form === 'usr-estado') {
    const sel = f.querySelector('#ue-motivo');
    enviarUsuario(f, `/api/usuarios/${state.modal.u}/estado`, { activo: state.modal.v, motivo: sel ? sel.value : '' }, state.modal.v ? 'Usuario reactivado.' : 'Usuario desactivado.');
  }
});

document.addEventListener('change', (ev) => {
  if (vista?.ruta.s === 'importar' && vista.datos && importar.manejarCambio(ev.target, vista.datos)) return;
  const c = ev.target.closest?.('[data-check]');
  if (c && vista?.datos?.expediente) {
    const id = vista.datos.expediente.id;
    const i = +c.dataset.check;
    const arr = (ui.checks[id] = (ui.checks[id] || []).filter((x) => x !== i));
    if (c.checked) arr.push(i);
    const btn = document.getElementById('btn-go');
    if (btn) btn.disabled = btn.dataset.sinvence === '1' || !(CHECKS[rol()] || []).every((_, j) => arr.includes(j));
  }
  const vg = ev.target.closest?.('[data-vg]');
  if (vg) marcarPunto(vg);
  const upc = ev.target.closest?.('[data-upc]');
  if (upc) subirDocCredito(upc);
  const up = ev.target.closest?.('[data-up]');
  if (up) subirDocGrupo(up);
  if (/^(a|ev)-pais$/.test(ev.target.id)) {
    const n = document.getElementById(`${ev.target.id}-mx`);
    if (n) n.hidden = ev.target.value !== 'MEX';
  }
  validarMotivo();
  if (ev.target.id === 'g-anio') {
    ui.anio = ev.target.value;
    pintar();
  }
  if (ev.target.id === 'imp-solo') {
    ui.impSolo = ev.target.value;
    pintar();
  }
  if (ev.target.id === 'eh-nac') {
    const n = document.getElementById('eh-nac-mx');
    if (n) n.hidden = ev.target.value !== 'MEX';
  }
  if (ev.target.id === 'h-nac') {
    const n = document.getElementById('h-nac-mx');
    if (n) n.hidden = ev.target.value !== 'MEX';
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && state.modal && state.perfil?.rol !== 'ipad') cerrarModal();
});

document.addEventListener('input', (ev) => {
  validarMotivo();
  if (ev.target.id === 'g-buscar') {
    ui.buscar = ev.target.value;
    const pos = ev.target.selectionStart;
    pintar();
    const el = document.getElementById('g-buscar');
    if (el) {
      el.focus();
      el.setSelectionRange(pos, pos);
    }
  }
});

const HECHO = {
  aprobar: 'Aprobado. El expediente pasó a Crédito.',
  recaptura: 'Se pidió la recaptura. Front Desk generará un nuevo QR.',
  no_aplica: 'Marcado como No aplica.',
  validar: 'Validado. El expediente pasó a Impuestos.',
  devolver_grupos: 'Devuelto a Grupos con el motivo registrado.',
  cerrar: 'Expediente cerrado.',
  devolver_credito: 'Devuelto a Crédito con el motivo registrado.',
  reabrir: 'Expediente reabierto. El cierre anterior sigue en la bitácora.',
};

async function ejecutar(accion, motivo, docs, btn, errEl) {
  const e = vista.datos.expediente;
  if (btn) btn.disabled = true;
  try {
    await api('POST', `/api/expedientes/${e.id}/accion`, { accion, estado: e.estado, motivo, docs });
    delete ui.checks[e.id];
    state.modal = null;
    toast(HECHO[accion]);
    if (['aprobar', 'validar', 'devolver_grupos', 'devolver_credito', 'recaptura', 'no_aplica'].includes(accion)) {
      location.hash = `#/grupos/${e.grupo_id}`;
    } else {
      recargar();
    }
  } catch (err) {
    if (btn) btn.disabled = false;
    if (err.status === 409 && /Otra persona/.test(err.message)) {
      state.modal = null;
      toast(err.message);
      recargar();
      return;
    }
    if (errEl) {
      errEl.hidden = false;
      errEl.textContent = err.message;
    } else toast(err.message);
  }
}

function leerMotivo(f) {
  const sel = f.querySelector('#m-sel').value;
  const det = f.querySelector('#m-det').value.trim();
  return sel === '__otro' ? det : sel ? sel + (det ? '. ' + det : '') : '';
}

function validarMotivo() {
  const f = document.querySelector('[data-form="motivo"]');
  if (!f) return;
  const sel = f.querySelector('#m-sel').value;
  const det = f.querySelector('#m-det').value.trim();
  let ok = sel && (sel !== '__otro' || det.length >= 3);
  if (state.modal?.op === 'recaptura') ok = ok && f.querySelectorAll('input[name=rd]:checked').length > 0;
  f.querySelector('#m-ok').disabled = !ok;
}

function enviarMotivo(f) {
  const docs = [...f.querySelectorAll('input[name=rd]:checked')].map((x) => x.value);
  ejecutar(state.modal.op, leerMotivo(f), docs.length ? docs : null, f.querySelector('#m-ok'), f.querySelector('#m-err'));
}

async function enviarGrupo(f, tipo, datos, msg) {
  const err = f.querySelector('.err');
  if (Object.values(datos).some((v) => !v)) {
    err.hidden = false;
    err.textContent = 'Llena todos los campos.';
    return;
  }
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await api('POST', `/api/grupos/${vista.datos.grupo.id}/${tipo}`, datos);
    state.modal = null;
    toast(msg);
    recargar();
  } catch (e) {
    err.hidden = false;
    err.textContent = e.message;
    btn.disabled = false;
  }
}

async function enviarCancelacionGrupo(f) {
  const err = f.querySelector('#cg-err');
  const motivo = f.querySelector('#cg-motivo').value.trim();
  const accion = state.modal?.accion === 'reactivar' ? 'reactivar' : 'cancelar';
  if (motivo.length < 3) {
    err.hidden = false;
    err.textContent = accion === 'reactivar' ? 'Escribe el motivo de la reactivación.' : 'Escribe el motivo de la cancelación.';
    return;
  }
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await api('POST', `/api/grupos/${vista.datos.grupo.id}/cancelacion`, { accion, motivo });
    state.modal = null;
    toast(accion === 'reactivar' ? 'Grupo reactivado. Quedó en la bitácora.' : 'Grupo cancelado. Quedó en la bitácora y en la pestaña Cancelados.');
    recargar();
  } catch (e) {
    err.hidden = false;
    err.textContent = e.message;
    btn.disabled = false;
  }
}

async function enviarEdicionGrupo(f) {
  const v = (id) => f.querySelector('#' + id).value.trim();
  const err = f.querySelector('#eg-err');
  const g = vista.datos.grupo;
  const datos = {
    nombre: v('eg-nombre'), empresa: v('eg-empresa'), contacto: v('eg-contacto'), llegada: v('eg-llegada'),
    salida: v('eg-salida'), estimados: v('eg-est'), codigo_opera: v('eg-codigo'), motivo: v('eg-motivo'),
  };
  let msg = '';
  if (!datos.nombre || !datos.empresa || !datos.llegada || !datos.salida) msg = 'Llena nombre, empresa, llegada y salida.';
  else if (datos.salida < datos.llegada) msg = 'La salida no puede ser antes de la llegada.';
  else if (g.llegada > hoyHotel() && datos.llegada !== g.llegada && datos.llegada < hoyHotel()) msg = 'La llegada no puede ser anterior a hoy.';
  else if (datos.motivo.length < 3) msg = 'Escribe el motivo del cambio.';
  if (msg) {
    err.hidden = false;
    err.textContent = msg;
    return;
  }
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const { cambios } = await api('POST', `/api/grupos/${g.id}/datos`, datos);
    state.modal = null;
    toast(cambios === 1 ? 'Dato actualizado. El cambio quedó en la bitácora.' : `${cambios} datos actualizados. Los cambios quedaron en la bitácora.`);
    recargar();
  } catch (e) {
    err.hidden = false;
    err.textContent = e.message;
    btn.disabled = false;
  }
}

async function enviarEvento(f) {
  const err = f.querySelector('#ev-err');
  const datos = leerEvento(f, 'ev');
  if (!datos.tipo || datos.organizador.length < 2) {
    err.hidden = false;
    err.textContent = 'Elige el tipo de evento y escribe el organizador.';
    return;
  }
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await api('POST', `/api/grupos/${vista.datos.grupo.id}/evento`, datos);
    state.modal = null;
    toast('Datos del evento guardados.');
    recargar();
  } catch (e) {
    err.hidden = false;
    err.textContent = e.message;
    btn.disabled = false;
  }
}

async function enviarEdicionHuesped(f) {
  const v = (id) => f.querySelector('#' + id).value.trim();
  const err = f.querySelector('#eh-err');
  const pais = PAISES.find((p) => p[1] === v('eh-nac'));
  const falla = (m) => {
    err.hidden = false;
    err.textContent = m;
  };
  if (!v('eh-nom') || !v('eh-ape') || !pais) return falla('Escribe el nombre, los apellidos y elige la nacionalidad.');
  if (v('eh-motivo').length < 3) return falla('Escribe el motivo del cambio.');
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const { cambios } = await api('POST', `/api/expedientes/${vista.datos.expediente.id}/datos`, {
      nombre: v('eh-nom'), apellidos: v('eh-ape'), nacionalidad_codigo: pais[1], nacionalidad: pais[0], pasaporte: v('eh-pas'), motivo: v('eh-motivo'),
    });
    state.modal = null;
    toast(cambios === 1 ? 'Dato corregido.' : `${cambios} datos corregidos.`);
    recargar();
  } catch (e) {
    falla(e.message);
    btn.disabled = false;
  }
}

async function enviarVence(f) {
  const err = f.querySelector('#ve-err');
  const fecha = f.querySelector('#ve-fecha').value;
  if (!fecha) {
    err.hidden = false;
    err.textContent = 'Escribe la fecha de vencimiento.';
    return;
  }
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await api('POST', `/api/expedientes/${vista.datos.expediente.id}/vencimiento`, { fecha });
    state.modal = null;
    toast('Vencimiento registrado.');
    recargar();
  } catch (e) {
    err.hidden = false;
    err.textContent = e.message;
    btn.disabled = false;
  }
}

const MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel' };

// Sube un archivo de Crédito. Devuelve el mensaje de error o null si se guardó.
async function enviarArchivoCredito(file, tipo, descripcion = '') {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const mime = MIME[ext] || file.type;
  if (!Object.values(MIME).includes(mime)) return 'Ese tipo de archivo no se acepta. Usa PDF, Excel, JPG o PNG.';
  if (tipo === 'autorizacion' && ext.startsWith('xls')) return 'Sube la autorización firmada en PDF o como foto (JPG o PNG).';
  if (file.size > 20 * 1024 * 1024) return 'El archivo debe pesar menos de 20 MB.';
  try {
    const blob = new Blob([await file.arrayBuffer()], { type: mime });
    const q = new URLSearchParams({ tipo, nombre: file.name.slice(0, 200) });
    if (descripcion) q.set('descripcion', descripcion);
    await api('POST', `/api/grupos/${vista.datos.grupo.id}/documentos-credito?${q}`, blob);
    return null;
  } catch (e) {
    return e.message;
  }
}

async function subirDocCredito(input) {
  const file = input.files?.[0];
  if (!file) return;
  const label = input.previousElementSibling;
  if (label) {
    label.classList.add('is-disabled');
    label.textContent = 'Subiendo…';
  }
  const error = await enviarArchivoCredito(file, input.dataset.upc);
  if (!error) {
    toast('Archivo guardado.');
    return recargar();
  }
  if (label) {
    label.classList.remove('is-disabled');
    label.textContent = 'Subir';
  }
  input.value = '';
  const err = document.getElementById('upc-err');
  if (err) {
    err.hidden = false;
    err.textContent = error;
  } else toast(error);
}

async function enviarDocExtra(f) {
  const err = f.querySelector('#dx-err');
  const desc = f.querySelector('#dx-desc').value.trim();
  const file = f.querySelector('#dx-file').files?.[0];
  const mostrar = (m) => {
    err.hidden = false;
    err.textContent = m;
  };
  if (desc.length < 3) return mostrar('Describe qué es el documento.');
  if (!file) return mostrar('Elige el archivo.');
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Subiendo…';
  const error = await enviarArchivoCredito(file, 'extraordinario', desc);
  if (error) {
    btn.disabled = false;
    btn.textContent = 'Subir documento';
    return mostrar(error);
  }
  state.modal = null;
  toast('Documento guardado.');
  recargar();
}

async function subirDocGrupo(input) {
  const file = input.files?.[0];
  if (!file) return;
  const err = document.getElementById('up-err');
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const tipo = MIME[ext] || file.type;
  const fallo = (m) => {
    if (err) {
      err.hidden = false;
      err.textContent = m;
    } else toast(m);
    input.value = '';
  };
  if (!Object.values(MIME).includes(tipo)) return fallo('Ese tipo de archivo no se acepta. Usa PDF, JPG o PNG (Excel solo para el rooming list).');
  if (file.size > 20 * 1024 * 1024) return fallo('El archivo debe pesar menos de 20 MB.');
  const label = input.previousElementSibling;
  if (label) {
    label.classList.add('is-disabled');
    label.textContent = 'Subiendo…';
  }
  try {
    const blob = new Blob([await file.arrayBuffer()], { type: tipo });
    await api('POST', `/api/grupos/${vista.datos.grupo.id}/documentos?tipo=${input.dataset.up}&nombre=${encodeURIComponent(file.name.slice(0, 200))}`, blob);
    toast('Archivo guardado.');
    await recargar();
    // Con la rooming list en PDF de Opera, Excel o CSV se ofrece dar de alta a los huéspedes.
    if (input.dataset.up === 'rooming' && ['pdf', 'xlsx', 'csv'].includes(ext) && puedeImportar() && !vista.datos.cancelacion) {
      abrirModal({ kind: 'ofrecer-import', file });
    }
  } catch (e) {
    if (label) {
      label.classList.remove('is-disabled');
      label.textContent = 'Subir';
    }
    fallo(e.message);
  }
}

async function marcarPunto(input) {
  input.disabled = true;
  try {
    await api('POST', `/api/grupos/${vista.datos.grupo.id}/verificacion`, { punto: +input.dataset.vg, marcado: input.checked });
    recargar();
  } catch (e) {
    input.checked = !input.checked;
    input.disabled = false;
    toast(e.message);
  }
}

setInterval(() => {
  document.querySelectorAll('[data-vence]').forEach((el) => {
    const l = new Date(el.dataset.vence).getTime() - Date.now();
    el.textContent = l > 0 ? `Vence en ${mmss(l)}` : 'Vencido. Genera otro código.';
    el.classList.toggle('low', l < 180000);
  });
}, 1000);

importar.configurar({ pintar: () => pintar(), recargar: () => recargar() });
