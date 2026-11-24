// Expediente completo del grupo en un .zip (Impuestos y Administración), para auditorías del
// SAT o de Accor. Trae todos los documentos en su archivo original: los del evento (Grupos),
// los de Crédito y los de cada huésped, incluidas las versiones que se recapturaron.
// Los archivos se bajan uno por uno y se escriben al .zip conforme llegan; en Chrome y Edge
// se guardan directo en la carpeta que elija la persona, sin llenar la memoria del equipo.
import { DOCS, DOCS_CREDITO, DOCS_GRUPO, ESTADOS, TIPOS_EVENTO } from './catalogos.js';
import { ErrorApi, api, dateTxt, esc, fmt, folioExp, folioGrupo } from './util.js';
import { libro } from '../worker/xlsx.ts';
import { EscritorZip, nombreSeguro } from './zip.js';

const ORDEN_HUESPED = ['pasaporte', 'regcard', 'fmm', 'pago', 'constancia'];
const EXT = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.ms-excel': 'xls',
};
const SIMULTANEOS = 6;
const INTENTOS = 3;

const extDe = (mime, nombre = '') => EXT[mime] || (nombre.match(/\.([a-z0-9]{2,5})$/i)?.[1] || 'bin').toLowerCase();
const sinExt = (n) => n.replace(/\.[a-z0-9]{2,5}$/i, '');
export const nombrePaquete = (g) => nombreSeguro(g.codigo_opera || folioGrupo(g.folio), 60);

// Arma la lista de archivos del .zip (ruta dentro del .zip, de dónde se baja y la fila del índice).
export function planear(p) {
  const raiz = nombrePaquete(p.grupo);
  const lista = [];
  const n = (i) => String(i + 1).padStart(2, '0');

  DOCS_GRUPO.forEach(([tipo, etiqueta], i) => {
    for (const d of p.docs_grupo.filter((x) => x.tipo === tipo)) {
      lista.push({
        ruta: `${raiz}/1 Documentos del evento/${n(i)} ${nombreSeguro(etiqueta)} - ${nombreSeguro(sinExt(d.nombre_archivo), 60)}.${extDe(d.mime, d.nombre_archivo)}`,
        url: `/api/documentos-grupo/${d.id}/archivo`, fecha: d.subido_en, bytes: d.bytes,
        indice: ['Documentos del evento', etiqueta, d.nombre_archivo, d.subido_por_nombre, d.subido_en],
      });
    }
  });
  DOCS_CREDITO.forEach(([tipo, etiqueta], i) => {
    for (const d of p.docs_credito.filter((x) => x.tipo === tipo)) {
      const desc = d.descripcion ? ` - ${nombreSeguro(d.descripcion, 50)}` : '';
      lista.push({
        ruta: `${raiz}/2 Documentos de Credito/${n(i)} ${nombreSeguro(etiqueta)}${desc} - ${nombreSeguro(sinExt(d.nombre_archivo), 60)}.${extDe(d.mime, d.nombre_archivo)}`,
        url: `/api/documentos-credito/${d.id}/archivo`, fecha: d.subido_en, bytes: d.bytes,
        indice: ['Documentos de Crédito', etiqueta + (d.descripcion ? `: ${d.descripcion}` : ''), d.nombre_archivo, d.subido_por_nombre, d.subido_en],
      });
    }
  });
  const porExp = new Map();
  for (const d of p.documentos) {
    if (!porExp.has(d.expediente_id)) porExp.set(d.expediente_id, []);
    porExp.get(d.expediente_id).push(d);
  }
  for (const e of p.expedientes) {
    const carpeta = `${raiz}/3 Huespedes/${folioExp(e.folio)} ${nombreSeguro(`${e.apellidos}, ${e.nombre}`, 70)}`;
    const docs = porExp.get(e.id) || [];
    ORDEN_HUESPED.forEach((tipo, i) => {
      const versiones = docs.filter((d) => d.tipo === tipo).sort((a, b) => b.version - a.version);
      versiones.forEach((d, j) => {
        const etiqueta = DOCS[tipo].label;
        const vigente = j === 0;
        lista.push({
          ruta: vigente
            ? `${carpeta}/${i + 1} ${etiqueta}.${extDe(d.mime)}`
            : `${carpeta}/Versiones reemplazadas/${i + 1} ${etiqueta} (version ${d.version}).${extDe(d.mime)}`,
          url: `/api/documentos/${d.id}/imagen`, fecha: d.capturado_en, bytes: d.bytes,
          indice: [`${folioExp(e.folio)} ${e.apellidos}, ${e.nombre}`, etiqueta, vigente ? `Vigente (versión ${d.version})` : `Reemplazada (versión ${d.version})`, 'iPad de captura', d.capturado_en],
        });
      });
    });
  }
  return { raiz, lista };
}

// Índice en Excel: datos del grupo, huéspedes con su estado y la lista de todos los archivos.
export function indiceExcel(p, lista, faltantes = []) {
  const g = p.grupo;
  const ev = p.evento;
  const docsDe = new Map();
  for (const d of p.documentos) docsDe.set(d.expediente_id, (docsDe.get(d.expediente_id) || 0) + 1);
  const filas = [
    [`Expediente completo del grupo ${g.nombre}`],
    ['Grupo', `${folioGrupo(g.folio)} ${g.nombre}`],
    ['Empresa', g.empresa],
    ['Código de grupo en Opera', g.codigo_opera || ''],
    ['Llegada y salida oficiales', `${dateTxt(g.llegada)} al ${dateTxt(g.salida)}`],
    ['Evento', ev ? `${TIPOS_EVENTO[ev.tipo] || ev.tipo} de ${ev.organizador}${ev.pais ? ` (${ev.pais})` : ''}` : 'Sin capturar'],
    ['Folio de la cuenta maestra en Opera', p.folio_maestra || 'Sin capturar'],
    ['Descargado', `${fmt(p.descargado.en)} por ${p.descargado.por}`],
    ['Archivos incluidos', lista.length - faltantes.length],
  ];
  if (faltantes.length) filas.push(['Archivos que no se pudieron descargar', `${faltantes.length}: ${faltantes.map((f) => f.ruta.split('/').slice(1).join('/')).join(' | ')}`]);
  filas.push([]);
  const encHues = filas.length;
  filas.push(['Folio', 'Apellidos', 'Nombre', 'Nacionalidad', 'Pasaporte', 'Vence pasaporte', 'Estado', 'Archivos']);
  for (const e of p.expedientes) {
    filas.push([folioExp(e.folio), e.apellidos, e.nombre, e.nacionalidad, e.pasaporte || '', e.pasaporte_vence || '', ESTADOS[e.estado] || e.estado, docsDe.get(e.id) || 0]);
  }
  filas.push([]);
  const encArch = filas.length;
  filas.push(['Sección o huésped', 'Documento', 'Detalle', 'Subido por', 'Fecha', 'Archivo dentro del .zip']);
  const falta = new Set(faltantes.map((f) => f.ruta));
  for (const a of lista) {
    const [seccion, doc, detalle, por, fecha] = a.indice;
    filas.push([seccion, doc, falta.has(a.ruta) ? `${detalle} · NO SE PUDO DESCARGAR` : detalle, por, fmt(fecha), a.rutaFinal || a.ruta]);
  }
  return libro({ nombre: 'Índice', filas, negritas: [0, encHues, encArch], anchos: [34, 26, 28, 22, 18, 26, 26, 10] });
}

async function bajar(url, signal) {
  for (let intento = 1; ; intento++) {
    try {
      const res = await fetch(url, { credentials: 'same-origin', signal });
      if (res.status === 401) {
        window.dispatchEvent(new CustomEvent('tz:sesion-terminada'));
        throw new ErrorApi(401, 'Tu sesión terminó. Vuelve a entrar y descarga de nuevo.');
      }
      if (!res.ok) throw new ErrorApi(res.status, `Error ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      if (e.name === 'AbortError' || e.status === 401 || intento >= INTENTOS) throw e;
      await new Promise((r) => setTimeout(r, 800 * intento));
    }
  }
}

const mb = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toLocaleString('es-MX', { maximumFractionDigits: 1 })} GB` : `${Math.max(1, Math.round(b / 1024 ** 2)).toLocaleString('es-MX')} MB`);

// Destino del .zip. En Chrome y Edge se elige dónde guardarlo y se escribe directo al disco;
// en otros navegadores se arma en el equipo y se descarga al final.
async function elegirDestino(nombre) {
  if (window.showSaveFilePicker) {
    const h = await window.showSaveFilePicker({ suggestedName: nombre, types: [{ description: 'Archivo .zip', accept: { 'application/zip': ['.zip'] } }] });
    const w = await h.createWritable();
    return { escribir: (b) => w.write(b), cerrar: () => w.close(), cancelar: () => w.abort().catch(() => undefined) };
  }
  const partes = [];
  return {
    escribir: (b) => { partes.push(b); },
    cerrar: () => {
      const url = URL.createObjectURL(new Blob(partes, { type: 'application/zip' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    },
    cancelar: () => { partes.length = 0; },
  };
}

// Ventana de progreso propia: no se cierra por accidente al hacer clic fuera.
function ventana(grupo) {
  const el = document.createElement('div');
  el.className = 'scrim';
  el.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="zip-tit">
    <h2 id="zip-tit">Descargar expediente completo</h2><p class="muted">${esc(grupo.nombre)}</p>
    <div id="zip-cuerpo" class="stack"></div>
    <div class="row end" id="zip-botones"></div></div>`;
  document.body.appendChild(el);
  const cuerpo = el.querySelector('#zip-cuerpo');
  const botones = el.querySelector('#zip-botones');
  return {
    el,
    pintar(html, btns) {
      cuerpo.innerHTML = html;
      botones.innerHTML = btns;
      botones.querySelector('button')?.focus();
    },
    cerrar: () => el.remove(),
  };
}

export function abrirDescarga(grupo, totalHuespedes) {
  const v = ventana(grupo);
  const nombre = `${nombrePaquete(grupo)}.zip`;
  let ctrl = null;
  v.pintar(`<p>Se descargará <b>${esc(nombre)}</b> con todos los documentos del grupo en su archivo original:</p>
    <ul class="lista-zip">
      <li><b>1 Documentos del evento</b>: contrato, agenda, salones, asistentes, identificación fiscal, gafetes y rooming list.</li>
      <li><b>2 Documentos de Crédito</b>: autorización, conciliación, reportes de Opera y extraordinarios.</li>
      <li><b>3 Huéspedes</b>: una carpeta por cada uno de los ${totalHuespedes.toLocaleString('es-MX')} huéspedes con pasaporte, registration card, forma migratoria, comprobante de pago y gafete. Las fotos que se recapturaron van en "Versiones reemplazadas".</li>
      <li><b>Índice del expediente.xlsx</b>: datos del grupo, estado de cada huésped y lista de todos los archivos.</li>
    </ul>
    <div class="notice">Incluye los pasaportes de todos los huéspedes. La descarga queda registrada en la bitácora del grupo con tu nombre.</div>
    ${window.showSaveFilePicker ? '<p class="note">Elige dónde guardarlo; el archivo se va escribiendo ahí mientras se descarga.</p>' : '<p class="note">En grupos grandes la descarga puede tardar varios minutos. No cierres esta pestaña.</p>'}`,
  '<button class="btn" data-z="cerrar">Cancelar</button><button class="btn primary" data-z="ir">Descargar .zip</button>');

  v.el.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-z]');
    if (!b) return;
    if (b.dataset.z === 'cerrar') v.cerrar();
    else if (b.dataset.z === 'detener') ctrl?.abort();
    else if (b.dataset.z === 'ir') {
      b.disabled = true;
      // El selector de carpeta debe abrirse directo desde el clic.
      let destino;
      try {
        destino = await elegirDestino(nombre);
      } catch (e) {
        b.disabled = false;
        if (e.name !== 'AbortError') v.pintar(`<p class="err">${esc(e.message)}</p>`, '<button class="btn" data-z="cerrar">Cerrar</button>');
        return;
      }
      ctrl = new AbortController();
      await descargar(grupo, destino, v, ctrl.signal);
    }
  });
}

async function descargar(grupo, destino, v, signal) {
  const progreso = (txt, hechos, total) => v.pintar(
    `<p id="zip-estado" role="status">${txt}</p><progress max="${total || 1}" value="${hechos}" style="width:100%"></progress>`,
    '<button class="btn" data-z="detener">Detener</button>',
  );
  progreso('Preparando la lista de documentos…', 0, 1);
  try {
    const p = await api('GET', `/api/grupos/${grupo.id}/paquete`, undefined, { signal });
    const { raiz, lista } = planear(p);
    const total = lista.length;
    const totalBytes = lista.reduce((s, a) => s + (a.bytes || 0), 0);
    const zip = new EscritorZip(destino.escribir);
    const faltantes = [];
    let hechos = 0;
    let bytes = 0;
    // Se piden varios archivos a la vez, pero se escriben en orden.
    const pendientes = [];
    let sig = 0;
    const pedir = () => {
      if (sig < total) {
        const a = lista[sig++];
        pendientes.push(bajar(a.url, signal).then((d) => ({ a, d }), (e) => ({ a, e })));
      }
    };
    for (let i = 0; i < SIMULTANEOS; i++) pedir();
    let ultimo = 0;
    while (pendientes.length) {
      const { a, d, e } = await pendientes.shift();
      if (e) {
        if (e.name === 'AbortError' || e.status === 401) throw e;
        faltantes.push(a);
      } else {
        a.rutaFinal = await zip.agregar(a.ruta, d, new Date(a.fecha));
        bytes += d.length;
      }
      hechos++;
      pedir();
      if (Date.now() - ultimo > 250 || hechos === total) {
        ultimo = Date.now();
        progreso(`Descargando ${hechos.toLocaleString('es-MX')} de ${total.toLocaleString('es-MX')} archivos (${mb(bytes)} de ${mb(totalBytes)})…`, hechos, total);
      }
    }
    progreso('Terminando el archivo…', total, total);
    await zip.agregar(`${raiz}/Indice del expediente.xlsx`, indiceExcel(p, lista, faltantes), new Date(p.descargado.en));
    if (faltantes.length) {
      const txt = `No se pudieron descargar estos archivos. Vuelve a descargar el expediente o ábrelos desde la página:\r\n\r\n${faltantes.map((f) => f.ruta.split('/').slice(1).join('/')).join('\r\n')}\r\n`;
      await zip.agregar(`${raiz}/ARCHIVOS FALTANTES.txt`, new TextEncoder().encode(txt));
    }
    const res = await zip.terminar();
    await destino.cerrar();
    v.pintar(faltantes.length
      ? `<div class="notice">Se guardó <b>${esc(nombrePaquete(grupo))}.zip</b> con ${(total - faltantes.length).toLocaleString('es-MX')} archivos (${mb(res.bytes)}), pero <b>${faltantes.length} no se pudieron descargar</b>. Vienen listados en "ARCHIVOS FALTANTES.txt" dentro del .zip. Revisa tu conexión y vuelve a descargarlo.</div>`
      : `<p>Listo. Se guardó <b>${esc(nombrePaquete(grupo))}.zip</b> con ${total.toLocaleString('es-MX')} documentos más el índice (${mb(res.bytes)}).</p>`,
    '<button class="btn primary" data-z="cerrar">Cerrar</button>');
  } catch (e) {
    await destino.cancelar();
    const msg = e.name === 'AbortError' ? 'Se detuvo la descarga. El archivo .zip no quedó completo; descárgalo de nuevo cuando lo necesites.' : e.message;
    v.pintar(`<p class="err">${esc(msg)}</p>`, '<button class="btn" data-z="cerrar">Cerrar</button>');
  }
}
