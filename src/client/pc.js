// Pantallas de escritorio (PC): Grupos, Front Desk, Crédito, Impuestos y Administración.
import qrcode from 'qrcode-generator';
import { DOCS, DOC_ORDER, ESTADOS, FILE_ORDER, FMM_TIPOS, PAISES, PAISES_FREC, QUEUE, QUEUE_WORD } from './catalogos.js';
import { api, dateTxt, esc, fmt, folioExp, folioGrupo, mmss } from './util.js';
import { header, state, toast } from './main.js';

let root;
let vista = null; // { ruta, datos, error }
let carga = 0;
const ui = { filtro: {}, ver: {} };

const rol = () => state.perfil.rol;
const cola = () => QUEUE[rol()] || [];

// ------------------------------------------------------------------ rutas
function rutaActual() {
  const h = location.hash.replace(/^#/, '') || '/';
  let m;
  if (h === '/grupos/nuevo') return { s: 'alta' };
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
  if (n === carga) pintar();
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
  if (ruta.s === 'exp') return api('GET', `/api/expedientes/${ruta.id}`);
  return Promise.resolve({});
}

function pintar() {
  let body;
  if (vista.error) body = `<div class="card flat center stack"><p>${esc(vista.error)}</p><div><a class="btn" href="#/">Volver a grupos</a></div></div>`;
  else if (!vista.datos) body = '<div class="loading"><span class="spinner"></span>Cargando…</div>';
  else if (vista.ruta.s === 'alta') body = altaGrupo();
  else if (vista.ruta.s === 'grupo') body = pantallaGrupo(vista.datos);
  else if (vista.ruta.s === 'exp') body = pantallaExpediente(vista.datos);
  else body = pantallaGrupos(vista.datos);
  root.innerHTML = `${header()}<main class="wrap">${body}</main>${modalHTML()}`;
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
function pantallaGrupos({ grupos }) {
  const [eyebrow, titulo, lead] = ENCABEZADOS[rol()];
  const puedeAlta = ['grupos', 'admin'].includes(rol());
  const cards = grupos
    .map((g) => {
      const c = g.conteo || {};
      const q = cola().reduce((s, k) => s + (c[k] || 0), 0);
      const counts = Object.keys(ESTADOS).filter((k) => c[k]);
      return `<a class="gcard" href="#/grupos/${g.id}">
        <span class="queue ${q ? '' : 'zero'} num">${q} ${QUEUE_WORD[rol()]}</span>
        <div><h2>${esc(g.nombre)}</h2><div class="meta"><span class="mono">${esc(g.codigo_opera || folioGrupo(g.folio))}</span> · ${dateTxt(g.llegada)} al ${dateTxt(g.salida)}</div></div>
        <div class="counts">${counts.length ? counts.map((k) => `<span class="pill ${cola().includes(k) ? 'mine' : ''}">${ESTADOS[k]} <b class="num">${c[k]}</b></span>`).join('') : '<span class="muted">Aún sin huéspedes</span>'}</div>
      </a>`;
    })
    .join('');
  return `<section class="page-head"><div><p class="eyebrow">${eyebrow}</p><h1>${titulo}</h1><p class="lead">${lead}</p></div>
      <div class="row">${puedeAlta ? '<a class="btn primary" href="#/grupos/nuevo">Dar de alta un grupo</a>' : ''}</div></section>
    ${grupos.length ? `<div class="ggrid">${cards}</div>` : `<div class="card flat empty">Todavía no hay grupos. ${puedeAlta ? 'Da de alta el primero con el botón de arriba.' : 'Grupos los da de alta desde su PC.'}</div>`}`;
}

// ------------------------------------------------------------------ alta de grupo
function altaGrupo() {
  if (!['grupos', 'admin'].includes(rol())) return '<div class="card flat empty">Solo Grupos puede dar de alta grupos.</div>';
  return `${crumbs([{ t: 'Grupos', href: '#/' }, { t: 'Alta de grupo' }])}
    <section class="page-head"><div><p class="eyebrow">Grupos</p><h1>Dar de alta un <span class="hl">grupo</span></h1><p class="lead">Front Desk da de alta a los huéspedes desde su PC una vez creado el grupo.</p></div></section>
    <form class="card stack max-820" data-form="alta">
      <div class="fgrid">
        <div class="field full"><label for="a-nombre">Nombre del grupo</label><input type="text" id="a-nombre" required maxlength="200" placeholder="Ej. Congreso Anual Woodgrove 2027"></div>
        <div class="field"><label for="a-empresa">Empresa</label><input type="text" id="a-empresa" required maxlength="200"></div>
        <div class="field"><label for="a-contacto">Contacto del grupo</label><input type="text" id="a-contacto" maxlength="200" placeholder="Nombre y cargo"></div>
        <div class="field"><label for="a-llegada">Llegada oficial</label><input type="date" id="a-llegada" required></div>
        <div class="field"><label for="a-salida">Salida oficial</label><input type="date" id="a-salida" required></div>
        <div class="field"><label for="a-est">Huéspedes estimados</label><input type="number" id="a-est" min="1" max="5000" placeholder="Ej. 450"></div>
        <div class="field"><label for="a-codigo">Código de grupo en Opera</label><input type="text" id="a-codigo" maxlength="60" placeholder="Ej. GRP-1401-WGB"></div>
      </div>
      <p class="err" id="a-err" hidden></p>
      <div class="row end"><a class="btn" href="#/">Cancelar</a><button type="submit" class="btn primary">Crear grupo</button></div>
    </form>`;
}

async function enviarAlta(f) {
  const v = (id) => f.querySelector('#' + id).value.trim();
  const err = f.querySelector('#a-err');
  const datos = {
    nombre: v('a-nombre'), empresa: v('a-empresa'), contacto: v('a-contacto'), llegada: v('a-llegada'),
    salida: v('a-salida'), estimados: v('a-est'), codigo_opera: v('a-codigo'),
  };
  let msg = '';
  if (!datos.nombre || !datos.empresa || !datos.llegada || !datos.salida) msg = 'Llena nombre, empresa, llegada y salida.';
  else if (datos.salida < datos.llegada) msg = 'La salida no puede ser antes de la llegada.';
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
function pantallaGrupo({ grupo: g, expedientes, codigos }) {
  const activos = new Map(codigos.map((c) => [c.expediente_id, c]));
  const clave = g.id;
  const f = ui.filtro[clave] || 'todos';
  const presentes = Object.keys(ESTADOS).filter((k) => expedientes.some((e) => e.estado === k));
  const enCola = (e) => cola().includes(e.estado);
  const mostrados = expedientes
    .filter((e) => f === 'todos' || (f === 'mios' ? enCola(e) : e.estado === f))
    .sort((a, b) => enCola(b) - enCola(a) || (b.actualizado_en > a.actualizado_en ? 1 : -1));
  const esFD = ['frontdesk', 'admin'].includes(rol());
  const filas = mostrados
    .map((e) => {
      const q = activos.get(e.id);
      const act = esFD && ['pendiente', 'incompleta'].includes(e.estado)
        ? `<button class="btn sm ${q ? '' : 'primary'}" data-a="qr" data-e="${e.id}">${q ? 'Ver QR activo' : 'Generar QR'}</button> `
        : '';
      return `<tr class="${enCola(e) ? 'q' : ''}">
        <td><b>${esc(e.nombre)} ${esc(e.apellidos)}</b><span class="sub mono">${folioExp(e.folio)}</span></td>
        <td>${esc(e.nacionalidad)}</td><td class="mono">${esc(e.pasaporte || '·')}</td>
        <td>${pill(e.estado)}</td><td class="muted num">${fmt(e.actualizado_en)}</td>
        <td class="tdact">${act}<a class="btn sm" href="#/expedientes/${e.id}">Abrir</a></td></tr>`;
    })
    .join('');
  const cap = QUEUE_WORD[rol()];
  const filtros = [['todos', 'Todos'], ...(cola().length ? [['mios', cap[0].toUpperCase() + cap.slice(1)]] : []), ...presentes.map((k) => [k, ESTADOS[k]])];
  return `${crumbs([{ t: 'Grupos', href: '#/' }, { t: g.nombre }])}
    <section class="page-head"><div><p class="eyebrow mono">${esc(g.codigo_opera || folioGrupo(g.folio))}</p><h1>${esc(g.nombre)}</h1></div>
      ${esFD ? `<button class="btn primary" data-a="altahues">Dar de alta un huésped</button>` : ''}</section>
    <div class="stack">
      <div class="card flat"><dl class="info">
        <div><dt>Empresa</dt><dd>${esc(g.empresa)}</dd></div>
        <div><dt>Estancia</dt><dd>${dateTxt(g.llegada)} al ${dateTxt(g.salida)}</dd></div>
        <div><dt>Huéspedes estimados</dt><dd class="num">${g.estimados ?? '·'}</dd></div>
        <div><dt>Huéspedes dados de alta</dt><dd class="num">${expedientes.length}</dd></div>
        <div><dt>Contacto</dt><dd>${esc(g.contacto || 'Sin capturar')}</dd></div>
      </dl></div>
      <div class="seg" role="tablist" aria-label="Filtrar por estado">${filtros.map(([k, l]) => `<button class="tab" role="tab" data-a="filtro" data-k="${k}" aria-selected="${f === k}">${l}</button>`).join('')}</div>
      <div class="tablewrap"><table><thead><tr><th>Huésped</th><th>Nacionalidad</th><th>Pasaporte</th><th>Estado</th><th>Último cambio</th><th></th></tr></thead>
      <tbody>${filas || `<tr><td colspan="6" class="empty">${expedientes.length ? 'Ningún expediente con este filtro.' : 'Aún no hay huéspedes en este grupo. Front Desk los da de alta desde su PC.'}</td></tr>`}</tbody></table></div>
    </div>`;
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
      : '<div class="missing">Sin capturar</div>'}</div>
    ${v ? `<div class="doc-f">v${v.version} capturada el ${fmt(v.capturado_en)} en ${esc(v.capturado_por_nombre || 'la estación de captura')}</div>` : ''}
  </article>`;
}

function docsBloque(docs) {
  if (rol() === 'impuestos') return `<div class="docs">${FILE_ORDER.map((t, i) => docCard(docs, t, i + 1)).join('')}</div>`;
  const o = rol() === 'credito' ? ['pago', 'regcard', 'pasaporte', 'fmm'] : DOC_ORDER;
  return `<div class="docs"><div class="two">${docCard(docs, o[0])}${docCard(docs, o[1])}</div><div class="two">${docCard(docs, o[2])}${docCard(docs, o[3])}</div></div>`;
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
  // Las revisiones de Grupos, Crédito e Impuestos llegan en la siguiente etapa.
  if (cola().includes(e.estado)) {
    return wrap('Revisión', '<p class="note">Este expediente está en tu bandeja. Las acciones de revisión (aprobar, devolver con motivo) se activan en la siguiente etapa.</p>');
  }
  return '';
}

function pantallaExpediente({ expediente: e, grupo: g, documentos, bitacora, codigo }) {
  const log = bitacora.map((l) => `<li><div>${esc(l.accion)}</div><div class="t">${fmt(l.ts)} · ${esc(l.usuario_nombre)} (${esc(l.rol)})</div>${l.motivo ? `<span class="m">Motivo: ${esc(l.motivo)}</span>` : ''}</li>`).join('');
  return `${crumbs([{ t: 'Grupos', href: '#/' }, { t: g.nombre, href: `#/grupos/${g.id}` }, { t: `${e.nombre} ${e.apellidos}` }])}
    <section class="page-head"><div><p class="eyebrow mono">${folioExp(e.folio)}</p><h1>${esc(e.nombre)} ${esc(e.apellidos)}</h1>
      <div class="row mt-8">${pill(e.estado)}<span class="muted">${esc(e.nacionalidad)}</span></div></div></section>
    ${e.nacionalidad_codigo === 'MEX' ? '<div class="notice mt-neg">Nacionalidad mexicana: no aplica para tax free. Grupos lo marcará como No aplica.</div>' : ''}
    ${rol() === 'impuestos' ? '<p class="note mt-neg">Documentos en el orden del archivo físico.</p>' : ''}
    <div class="exp">${docsBloque(documentos)}
      <aside class="side">
        ${accionesExp(e, codigo)}
        <div class="card"><dl class="kv">
          <dt>Pasaporte</dt><dd class="mono">${esc(e.pasaporte || 'Por capturar')}</dd>
          <dt>Nacionalidad</dt><dd>${esc(e.nacionalidad)}</dd>
          <dt>Llegada del grupo</dt><dd>${dateTxt(g.llegada)}</dd><dt>Salida del grupo</dt><dd>${dateTxt(g.salida)}</dd>
          <dt>Grupo</dt><dd class="mono">${esc(g.codigo_opera || folioGrupo(g.folio))}</dd>
        </dl></div>
        <div class="card stack"><div class="row space-between"><h3>Bitácora</h3><span class="note">No se puede editar ni borrar</span></div><ol class="log">${log}</ol></div>
      </aside></div>`;
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
      </div>
      <label class="toggle"><input type="checkbox" id="h-qr" checked> Generar su código QR al guardar</label>
      <p class="err" id="h-err" hidden></p>
      <div class="row end"><button type="button" class="btn" data-a="cerrar-modal">Cancelar</button><button type="submit" class="btn primary">Dar de alta</button></div></form>`;
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
  return `<div class="scrim" data-a="scrim">${inner}</div>`;
}

function abrirModal(m) {
  state.modal = m;
  document.querySelector('.scrim')?.remove();
  root.insertAdjacentHTML('beforeend', modalHTML());
  root.querySelector('.scrim input, .scrim select')?.focus();
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
      pasaporte: v('h-pas'), generar_qr: f.querySelector('#h-qr').checked,
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
});

document.addEventListener('change', (ev) => {
  if (ev.target.id === 'h-nac') {
    const n = document.getElementById('h-nac-mx');
    if (n) n.hidden = ev.target.value !== 'MEX';
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && state.modal && state.perfil?.rol !== 'ipad') cerrarModal();
});

setInterval(() => {
  document.querySelectorAll('[data-vence]').forEach((el) => {
    const l = new Date(el.dataset.vence).getTime() - Date.now();
    el.textContent = l > 0 ? `Vence en ${mmss(l)}` : 'Vencido. Genera otro código.';
    el.classList.toggle('low', l < 180000);
  });
}, 1000);
