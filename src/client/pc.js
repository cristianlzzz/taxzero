// Pantallas de escritorio (PC): Grupos, Front Desk, Crédito, Impuestos y Administración.
import qrcode from 'qrcode-generator';
import {
  CHECKS, CHECK_GRUPO, DOCS, DOCS_GRUPO, DOC_ORDER, ESTADOS, FILE_ORDER, FMM_TIPOS, MOTIVOS, PAISES, PAISES_FREC, QUEUE, QUEUE_WORD,
  RIESGOS, TIPOS_EVENTO,
} from './catalogos.js';
import { api, dateTxt, esc, fmt, folioExp, folioGrupo, mmss } from './util.js';
import { header, state, toast } from './main.js';

let root;
let vista = null; // { ruta, datos, error }
let carga = 0;
const ui = { filtro: {}, ver: {}, checks: {} };

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
      ${rol() === 'frontdesk' ? '' : expedienteEvento(datos)}
      ${extraGrupo(g, montos, facturas)}
      ${rol() === 'impuestos' ? verificacionGrupo(datos) : ''}
      <div class="seg" role="tablist" aria-label="Filtrar por estado">${filtros.map(([k, l]) => `<button class="tab" role="tab" data-a="filtro" data-k="${k}" aria-selected="${f === k}">${l}</button>`).join('')}</div>
      <div class="tablewrap"><table><thead><tr><th>Huésped</th><th>Nacionalidad</th><th>Pasaporte</th><th>Estado</th><th>Último cambio</th><th></th></tr></thead>
      <tbody>${filas || `<tr><td colspan="6" class="empty">${expedientes.length ? 'Ningún expediente con este filtro.' : 'Aún no hay huéspedes en este grupo. Front Desk los da de alta desde su PC.'}</td></tr>`}</tbody></table></div>
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
      <div class="row mt-8">${pill(e.estado)}<span class="muted">${esc(e.nacionalidad)}</span></div></div></section>
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
        ${puedeVence(e) ? `<button class="btn sm" data-a="vence">${e.pasaporte_vence ? 'Corregir vencimiento' : 'Registrar vencimiento del pasaporte'}</button>` : ''}</div>
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
        <div class="field"><label for="h-vence">Vencimiento del pasaporte <span class="muted">(opcional)</span></label><input type="date" id="h-vence"></div>
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
  if (m.kind === 'riesgo') {
    const R = RIESGOS[m.k];
    inner = `<form class="modal" data-form="riesgo" novalidate><h2>${R.label} · ${R.sub}</h2><p class="muted">${esc(vista.datos.grupo.nombre)}</p>
      <p class="note">Ejemplos: ${esc(R.ej)}</p>
      <div class="field"><label for="ri-nota">¿Por qué este nivel?</label><textarea id="ri-nota" maxlength="500" required placeholder="Ej. Convención con agenda formal y contrato; 3 habitaciones compartidas con una sola firma."></textarea></div>
      <p class="note">Queda en la bitácora del grupo con tu nombre.</p>
      <p class="err" id="ri-err" hidden></p>
      <div class="row end"><button type="button" class="btn" data-a="cerrar-modal">Cancelar</button><button type="submit" class="btn primary">Registrar</button></div></form>`;
  }
  if (m.kind === 'vence') {
    const e = vista.datos.expediente;
    inner = `<form class="modal" data-form="vence" novalidate><h2>Vencimiento del pasaporte</h2><p class="muted">${esc(e.nombre)} ${esc(e.apellidos)} · <span class="mono">${folioExp(e.folio)}</span></p>
      <div class="field"><label for="ve-fecha">Fecha de vencimiento, tal como aparece en el pasaporte</label><input type="date" id="ve-fecha" required value="${esc(e.pasaporte_vence || '')}"></div>
      <p class="note">El pasaporte debe estar vigente en las fechas de la estancia. El cambio queda en la bitácora.</p>
      <p class="err" id="ve-err" hidden></p>
      <div class="row end"><button type="button" class="btn" data-a="cerrar-modal">Cancelar</button><button type="submit" class="btn primary">Guardar</button></div></form>`;
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
    case 'riesgo':
      abrirModal({ kind: 'riesgo', k: d.k });
      break;
    case 'vence':
      abrirModal({ kind: 'vence' });
      break;
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
  if (f.dataset.form === 'riesgo') enviarGrupo(f, 'riesgo', { nivel: state.modal.k, nota: f.querySelector('#ri-nota').value.trim() }, 'Riesgo registrado.');
  if (f.dataset.form === 'vence') enviarVence(f);
});

document.addEventListener('change', (ev) => {
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
  const up = ev.target.closest?.('[data-up]');
  if (up) subirDocGrupo(up);
  if (/^(a|ev)-pais$/.test(ev.target.id)) {
    const n = document.getElementById(`${ev.target.id}-mx`);
    if (n) n.hidden = ev.target.value !== 'MEX';
  }
  validarMotivo();
  if (ev.target.id === 'h-nac') {
    const n = document.getElementById('h-nac-mx');
    if (n) n.hidden = ev.target.value !== 'MEX';
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && state.modal && state.perfil?.rol !== 'ipad') cerrarModal();
});

document.addEventListener('input', validarMotivo);

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
    recargar();
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
